/**
 * ==========================================================================
 *  src/engine/market.js  —  Closed-Loop Equity Engine & Order Book
 * ==========================================================================
 *  Implements:
 *    - Ornstein-Uhlenbeck mean reversion + random drift
 *    - Price impact model: ΔP = σ × √(Volume / ADV) × direction
 *    - Real-time AUM / PnL calculation
 *    - Position management (long / short)
 *    - Closed-loop mitigation (market order close)
 *    - Game over detection
 * ==========================================================================
 */

import { retailNPCs } from './retail.js';

/**
 * ADV (Average Daily Volume) constant used in price impact formula.
 * @type {number}
 */
const ADV = 100000;

/**
 * Volatility constant for price movement and impact.
 * @type {number}
 */
const SIGMA = 0.015;

/**
 * Mean reversion speed (theta) for the Ornstein-Uhlenbeck process.
 * @type {number}
 */
const THETA = 0.02;

/**
 * Mean price level for mean reversion.
 * @type {number}
 */
const MEAN_PRICE = 100;

/**
 * Number of initial candles to generate at startup.
 * @type {number}
 */
const INITIAL_CANDLES = 100;

/**
 * Candle duration in milliseconds (1 second for faster gameplay).
 * @type {number}
 */
const CANDLE_DURATION_MS = 1000;

/**
 * @typedef {Object} Candle
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} volume
 * @property {number} timestamp
 */

/**
 * @typedef {Object} Position
 * @property {number} averagePrice
 * @property {number} totalVolume
 */

/**
 * @typedef {Object} TradeRecord
 * @property {string} type  — 'BUY' | 'SELL' | 'MITIGATION'
 * @property {number} volume
 * @property {number} price
 * @property {number} pnl
 * @property {number} timestamp
 */

class MarketEngine {
  constructor() {
    /** @type {number} Account balance (cash). */
    this.balance = 100000;

    /** @type {number} AUM (Equity = balance + floating PnL). */
    this.aum = 100000;

    /** @type {number} Today's PnL (AUM - initial capital). */
    this.pnlToday = 0;

    /** @type {{ long: Position, short: Position }} */
    this.institutionalPositions = {
      long: { averagePrice: 0, totalVolume: 0 },
      short: { averagePrice: 0, totalVolume: 0 },
    };

    /** @type {number} Current mid price. */
    this.currentPrice = MEAN_PRICE;

    /** @type {number} Current bid price. */
    this.bid = MEAN_PRICE - 0.02;

    /** @type {number} Current ask price. */
    this.ask = MEAN_PRICE + 0.02;

    /** @type {Candle[]} Historical candle data. */
    this.candles = [];

    /** @type {Candle|null} Current (active) candle being built. */
    this.currentCandle = null;

    /** @type {number} Accumulated sweep count. */
    this.sweepCount = 0;

    /** @type {TradeRecord[]} Player-initiated trade history only. */
    this.tradeHistory = [];

    /** @type {number} Last update timestamp for candle generation. */
    this.lastCandleTime = 0;

    /** @type {number} Tick counter for drift. */
    this.tickCount = 0;

    /** @type {boolean} Whether we are in the initialization phase. */
    this._initializing = true;
  }

  // ========================================================================
  //  INITIALIZATION
  // ========================================================================

  /**
   * Boot the market engine: generate initial candles + retail orders.
   * No sweep checking or PnL calculation during this phase.
   */
  initialize() {
    this._initializing = true;

    // Generate 100 initial candles
    const now = Date.now();
    for (let i = 0; i < INITIAL_CANDLES; i++) {
      const timestamp = now - (INITIAL_CANDLES - i) * CANDLE_DURATION_MS;
      const candle = this._generateCandle(timestamp);
      this.candles.push(candle);
    }

    // Seed the current price from last candle close
    const lastCandle = this.candles[this.candles.length - 1];
    this.currentPrice = lastCandle.close;
    this.bid = this.currentPrice - 0.02;
    this.ask = this.currentPrice + 0.02;

    // Create 40 initial retail orders
    retailNPCs.initialize(this.currentPrice);

    this._initializing = false;
  }

  // ========================================================================
  //  UPDATE LOOP  (called every tick ~16ms for 60 FPS)
  // ========================================================================

  /**
   * Main update function. Advances price, updates candles, computes equity.
   * @returns {void}
   */
  update() {
    if (this.aum <= 0) return;

    this.tickCount++;

    // --- Natural Drift (Ornstein-Uhlenbeck + random walk) ---
    this._applyNaturalDrift();

    // --- Update bid/ask spread ---
    this.bid = this.currentPrice - 0.02;
    this.ask = this.currentPrice + 0.02;

    // --- Update current candle ---
    this._updateCandle();

    // --- Compute floating PnL and AUM ---
    this._computeEquity();

    // --- Check sweeps (only if not initializing) ---
    if (!this._initializing) {
      this._checkSweeps();
    }

    // --- Game over check ---
    if (this.aum <= 0) {
      this.aum = 0;
      return;
    }
  }

  // ========================================================================
  //  PRICE IMPACT — Inject buy/sell pressure
  // ========================================================================

  /**
   * Inject directional pressure into the market.
   * ΔP = σ × √(Volume / ADV) × direction
   *
   * @param {number} volume  — Volume to inject (100–5000)
   * @param {'buy'|'sell'} direction
   * @returns {number} The price at which the injection was executed.
   */
  injectPressure(volume, direction) {
    const clampedVolume = Math.max(100, Math.min(5000, volume));
    const dir = direction === 'buy' ? 1 : -1;
    const impact = SIGMA * Math.sqrt(clampedVolume / ADV) * dir;

    const executionPrice = this.currentPrice + impact;

    // Update position
    if (direction === 'buy') {
      const pos = this.institutionalPositions.long;
      if (pos.totalVolume === 0) {
        pos.averagePrice = executionPrice;
        pos.totalVolume = clampedVolume;
      } else {
        // Weighted average
        const totalCost = pos.averagePrice * pos.totalVolume + executionPrice * clampedVolume;
        pos.totalVolume += clampedVolume;
        pos.averagePrice = totalCost / pos.totalVolume;
      }
    } else {
      const pos = this.institutionalPositions.short;
      if (pos.totalVolume === 0) {
        pos.averagePrice = executionPrice;
        pos.totalVolume = clampedVolume;
      } else {
        const totalCost = pos.averagePrice * pos.totalVolume + executionPrice * clampedVolume;
        pos.totalVolume += clampedVolume;
        pos.averagePrice = totalCost / pos.totalVolume;
      }
    }

    // Apply price impact to current price
    this.currentPrice += impact;

    // Record trade
    this._recordTrade(direction === 'buy' ? 'BUY' : 'SELL', clampedVolume, executionPrice, 0);

    return executionPrice;
  }

  // ========================================================================
  //  MITIGATION — Close position via market order
  // ========================================================================

  /**
   * Close (mitigate) an open position using a market order in the opposite direction.
   * Updates balance to current AUM and resets position data.
   *
   * @param {'long'|'short'} type  — Which position to close.
   * @returns {{ pnl: number, price: number }|null} Result or null if no position.
   */
  mitigate(type) {
    const pos = this.institutionalPositions[type];
    if (!pos || pos.totalVolume === 0) {
      return null;
    }

    const closingVolume = pos.totalVolume;
    const direction = type === 'long' ? 'sell' : 'buy';

    // Execute opposing market order
    const dir = direction === 'buy' ? 1 : -1;
    const impact = SIGMA * Math.sqrt(closingVolume / ADV) * dir;
    const executionPrice = this.currentPrice + impact;
    this.currentPrice += impact;

    // Calculate PnL for the closing trade
    let pnl = 0;
    if (type === 'long') {
      pnl = (executionPrice - pos.averagePrice) * closingVolume;
    } else {
      pnl = (pos.averagePrice - executionPrice) * closingVolume;
    }

    // Update balance to current AUM
    this.balance = this.aum;

    // Reset position
    pos.averagePrice = 0;
    pos.totalVolume = 0;

    // Record trade
    this._recordTrade('MITIGATION', closingVolume, executionPrice, pnl);

    return { pnl, price: executionPrice };
  }

  // ========================================================================
  //  UTILITY
  // ========================================================================

  /**
   * Get current state snapshot for UI updates.
   * @returns {Object}
   */
  getState() {
    return {
      aum: this.aum,
      pnlToday: this.pnlToday,
      bid: this.bid,
      ask: this.ask,
      currentPrice: this.currentPrice,
      sweepCount: this.sweepCount,
      longVolume: this.institutionalPositions.long.totalVolume,
      longAvgPrice: this.institutionalPositions.long.averagePrice,
      shortVolume: this.institutionalPositions.short.totalVolume,
      shortAvgPrice: this.institutionalPositions.short.averagePrice,
      candles: this.candles,
      currentCandle: this.currentCandle,
      isGameOver: this.aum <= 0,
    };
  }

  /**
   * Reset the engine for a new game.
   */
  reset() {
    this.balance = 100000;
    this.aum = 100000;
    this.pnlToday = 0;
    this.institutionalPositions = {
      long: { averagePrice: 0, totalVolume: 0 },
      short: { averagePrice: 0, totalVolume: 0 },
    };
    this.currentPrice = MEAN_PRICE;
    this.bid = MEAN_PRICE - 0.02;
    this.ask = MEAN_PRICE + 0.02;
    this.candles = [];
    this.currentCandle = null;
    this.sweepCount = 0;
    this.tradeHistory = [];
    this.lastCandleTime = 0;
    this.tickCount = 0;
    this._initializing = true;
    this.initialize();
  }

  // ========================================================================
  //  PRIVATE METHODS
  // ========================================================================

  /**
   * Apply natural drift using Ornstein-Uhlenbeck mean reversion + random noise.
   */
  _applyNaturalDrift() {
    const dt = 1 / 60; // ~16ms tick
    const ouDrift = THETA * (MEAN_PRICE - this.currentPrice) * dt;
    const randomDrift = (Math.random() - 0.5) * SIGMA * 0.3;
    this.currentPrice += ouDrift + randomDrift;

    // Prevent negative prices
    if (this.currentPrice < 0.01) {
      this.currentPrice = 0.01;
    }
  }

  /**
   * Generate a complete candle with OHLC from current price.
   * @param {number} timestamp
   * @returns {Candle}
   */
  _generateCandle(timestamp) {
    const base = this.currentPrice;
    const halfSpread = SIGMA * 0.4;
    const open = base + (Math.random() - 0.5) * halfSpread;
    const close = base + (Math.random() - 0.5) * halfSpread;
    const high = Math.max(open, close) + Math.random() * halfSpread * 0.5;
    const low = Math.min(open, close) - Math.random() * halfSpread * 0.5;
    const volume = Math.floor(Math.random() * 2000) + 500;

    return {
      open: Math.max(0.01, open),
      high: Math.max(0.01, high),
      low: Math.max(0.01, low),
      close: Math.max(0.01, close),
      volume,
      timestamp,
    };
  }

  /**
   * Update or create the current active candle.
   */
  _updateCandle() {
    const now = Date.now();

    if (!this.currentCandle) {
      this.currentCandle = {
        open: this.currentPrice,
        high: this.currentPrice,
        low: this.currentPrice,
        close: this.currentPrice,
        volume: 0,
        timestamp: now,
      };
      this.lastCandleTime = now;
      return;
    }

    // Update OHLC
    this.currentCandle.high = Math.max(this.currentCandle.high, this.currentPrice);
    this.currentCandle.low = Math.min(this.currentCandle.low, this.currentPrice);
    this.currentCandle.close = this.currentPrice;
    this.currentCandle.volume += Math.floor(Math.random() * 50);

    // Check if candle should close (every CANDLE_DURATION_MS)
    if (now - this.lastCandleTime >= CANDLE_DURATION_MS) {
      // Close current candle and push to history
      const closedCandle = { ...this.currentCandle };
      this.candles.push(closedCandle);

      // Keep only last 500 candles for performance
      if (this.candles.length > 500) {
        this.candles = this.candles.slice(-500);
      }

      // Start new candle
      this.currentCandle = {
        open: this.currentPrice,
        high: this.currentPrice,
        low: this.currentPrice,
        close: this.currentPrice,
        volume: 0,
        timestamp: now,
      };
      this.lastCandleTime = now;
    }
  }

  /**
   * Compute floating PnL and update AUM/PnL.
   */
  _computeEquity() {
    if (this._initializing) return;

    let floatingPnL = 0;

    const longPos = this.institutionalPositions.long;
    const shortPos = this.institutionalPositions.short;

    if (longPos.totalVolume > 0) {
      floatingPnL += (this.currentPrice - longPos.averagePrice) * longPos.totalVolume;
    }

    if (shortPos.totalVolume > 0) {
      floatingPnL += (shortPos.averagePrice - this.currentPrice) * shortPos.totalVolume;
    }

    this.aum = this.balance + floatingPnL;
    this.pnlToday = this.aum - 100000;
  }

  /**
   * Check for stop loss sweeps against retail NPCs.
   */
  _checkSweeps() {
    if (this._initializing) return;

    const sweepEvents = retailNPCs.checkSweeps(this.currentPrice);
    if (sweepEvents.length > 0) {
      this.sweepCount += sweepEvents.length;
    }
  }

  /**
   * Record a player-initiated trade to history.
   * @param {string} type
   * @param {number} volume
   * @param {number} price
   * @param {number} pnl
   */
  _recordTrade(type, volume, price, pnl) {
    this.tradeHistory.push({
      type,
      volume,
      price,
      pnl,
      timestamp: Date.now(),
    });

    // Keep last 100 trades
    if (this.tradeHistory.length > 100) {
      this.tradeHistory = this.tradeHistory.slice(-100);
    }
  }
}

// Singleton export
export const marketEngine = new MarketEngine();
