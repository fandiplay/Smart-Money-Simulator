/**
 * ==========================================================================
 *  src/engine/retail.js  —  AI NPC Retail Traders
 * ==========================================================================
 *  Manages retail NPC orders with three distinct AI behavioural patterns:
 *    - Patternist   : Places SL clusters 0.3–1.5 units from round-number levels.
 *    - FOMO Chaser  : Opens market orders when momentum exceeds 2.5 std dev.
 *    - Panic Trader : Closes positions instantly when newsShock() is triggered.
 * ==========================================================================
 */

/**
 * @typedef {'patternist'|'fomo'|'panic'} NPCType
 */

/**
 * @typedef {Object} RetailOrder
 * @property {number} id
 * @property {NPCType} type
 * @property {'long'|'short'} direction
 * @property {number} entryPrice
 * @property {number} stopLoss
 * @property {number} volume
 * @property {boolean} isActive
 * @property {number} timestamp
 */

/**
 * Maximum number of retail orders in the system.
 * @type {number}
 */
const MAX_RETAIL_ORDERS = 40;

/**
 * The standard deviation threshold for FOMO chasers.
 * @type {number}
 */
const FOMO_STD_THRESHOLD = 2.5;

/**
 * Price range around psychological levels for Patternist SL placement.
 * @type {[number, number]}
 */
const PATTERNIST_SL_RANGE = [0.3, 1.5];

class RetailNPCManager {
  constructor() {
    /** @type {RetailOrder[]} */
    this.orders = [];

    /** @type {number} Auto-incrementing ID counter. */
    this._nextId = 1;

    /** @type {number[]} Price history window for std dev calculation. */
    this._priceHistory = [];

    /** @type {number} Max price history buffer size. */
    this._maxHistorySize = 100;
  }

  /**
   * Initialize retail orders at game start.
   * @param {number} currentPrice
   */
  initialize(currentPrice) {
    this.orders = [];
    this._nextId = 1;
    this._priceHistory = [];

    for (let i = 0; i < 40; i++) {
      this._createRandomOrder(currentPrice);
    }
  }

  /**
   * Update retail NPC behaviour each tick.
   * Called from the main game loop.
   * @param {number} currentPrice
   * @param {number} momentum  — Price change rate for FOMO detection.
   */
  update(currentPrice, momentum) {
    // Track price history for std dev
    this._priceHistory.push(currentPrice);
    if (this._priceHistory.length > this._maxHistorySize) {
      this._priceHistory.shift();
    }

    // FOMO Chaser logic: check momentum
    this._updateFomoChasers(currentPrice, momentum);

    // Refill orders to maintain count
    while (this.orders.filter(o => o.isActive).length < MAX_RETAIL_ORDERS) {
      this._createRandomOrder(currentPrice);
    }
  }

  /**
   * Trigger a news shock event — all Panic Traders close immediately.
   * @param {number} currentPrice
   * @returns {number} Number of Panic Trader orders closed.
   */
  newsShock(currentPrice) {
    let closedCount = 0;
    for (const order of this.orders) {
      if (order.isActive && order.type === 'panic') {
        order.isActive = false;
        closedCount++;
      }
    }
    return closedCount;
  }

  /**
   * Check if current price sweeps any retail stop losses.
   * @param {number} currentPrice
   * @returns {Array<{orderId: number, type: NPCType, volume: number}>}
   */
  checkSweeps(currentPrice) {
    const swept = [];

    for (const order of this.orders) {
      if (!order.isActive) continue;

      let hit = false;
      if (order.direction === 'long') {
        // Long positions have SL below entry → price drops to SL
        if (currentPrice <= order.stopLoss) {
          hit = true;
        }
      } else {
        // Short positions have SL above entry → price rises to SL
        if (currentPrice >= order.stopLoss) {
          hit = true;
        }
      }

      if (hit) {
        order.isActive = false;
        swept.push({
          orderId: order.id,
          type: order.type,
          volume: order.volume,
          price: order.stopLoss,
        });
      }
    }

    return swept;
  }

  /**
   * Get all active retail orders.
   * @returns {RetailOrder[]}
   */
  getActiveOrders() {
    return this.orders.filter(o => o.isActive);
  }

  /**
   * Get all retail orders (active and inactive).
   * @returns {RetailOrder[]}
   */
  getAllOrders() {
    return this.orders;
  }

  /**
   * Reset all orders.
   */
  reset() {
    this.orders = [];
    this._nextId = 1;
    this._priceHistory = [];
  }

  // ========================================================================
  //  PRIVATE METHODS
  // ========================================================================

  /**
   * Create a single retail order with a random AI pattern.
   * @param {number} currentPrice
   */
  _createRandomOrder(currentPrice) {
    const types = ['patternist', 'fomo', 'panic'];
    const type = types[Math.floor(Math.random() * types.length)];
    const direction = Math.random() < 0.5 ? 'long' : 'short';

    let entryPrice, stopLoss;

    switch (type) {
      case 'patternist':
        // Place near psychological levels (round numbers)
        entryPrice = this._generatePatternistEntry(currentPrice, direction);
        stopLoss = this._generatePatternistSL(entryPrice, direction);
        break;

      case 'fomo':
        // Open at current price (momentum-checked in _updateFomoChasers)
        entryPrice = currentPrice + (Math.random() - 0.5) * 0.5;
        stopLoss = this._generateStandardSL(entryPrice, direction);
        break;

      case 'panic':
        entryPrice = currentPrice + (Math.random() - 0.5) * 0.3;
        stopLoss = this._generateStandardSL(entryPrice, direction);
        break;

      default:
        entryPrice = currentPrice;
        stopLoss = this._generateStandardSL(entryPrice, direction);
    }

    const volume = Math.floor(Math.random() * 500) + 50;

    this.orders.push({
      id: this._nextId++,
      type,
      direction,
      entryPrice: Math.max(0.01, entryPrice),
      stopLoss: Math.max(0.01, stopLoss),
      volume,
      isActive: true,
      timestamp: Date.now(),
    });
  }

  /**
   * Generate entry price near a psychological (round-number) level.
   * @param {number} currentPrice
   * @param {'long'|'short'} direction
   * @returns {number}
   */
  _generatePatternistEntry(currentPrice, direction) {
    // Find nearest round number
    const roundLevel = Math.round(currentPrice);
    const offset = (Math.random() - 0.5) * 0.8;
    return roundLevel + offset;
  }

  /**
   * Generate stop loss 0.3–1.5 units away from entry.
   * @param {number} entryPrice
   * @param {'long'|'short'} direction
   * @returns {number}
   */
  _generatePatternistSL(entryPrice, direction) {
    const distance = PATTERNIST_SL_RANGE[0] + Math.random() * (PATTERNIST_SL_RANGE[1] - PATTERNIST_SL_RANGE[0]);
    if (direction === 'long') {
      return entryPrice - distance;
    } else {
      return entryPrice + distance;
    }
  }

  /**
   * Generate a standard stop loss (wider).
   * @param {number} entryPrice
   * @param {'long'|'short'} direction
   * @returns {number}
   */
  _generateStandardSL(entryPrice, direction) {
    const distance = 0.5 + Math.random() * 2.0;
    if (direction === 'long') {
      return entryPrice - distance;
    } else {
      return entryPrice + distance;
    }
  }

  /**
   * Update FOMO chasers: open orders when momentum exceeds 2.5 std dev.
   * @param {number} currentPrice
   * @param {number} momentum
   */
  _updateFomoChasers(currentPrice, momentum) {
    const std = this._calculateStd();
    if (std === 0) return;

    const zScore = Math.abs(momentum) / std;

    if (zScore > FOMO_STD_THRESHOLD) {
      // Open new FOMO orders
      const count = Math.floor(Math.random() * 3) + 1;
      for (let i = 0; i < count; i++) {
        const direction = momentum > 0 ? 'long' : 'short';
        const volume = Math.floor(Math.random() * 300) + 50;
        const entryPrice = currentPrice;
        const stopLoss = this._generateStandardSL(entryPrice, direction);

        this.orders.push({
          id: this._nextId++,
          type: 'fomo',
          direction,
          entryPrice,
          stopLoss,
          volume,
          isActive: true,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Calculate standard deviation of recent price history.
   * @returns {number}
   */
  _calculateStd() {
    const n = this._priceHistory.length;
    if (n < 10) return 0;

    const mean = this._priceHistory.reduce((a, b) => a + b, 0) / n;
    const variance = this._priceHistory.reduce((sum, val) => sum + (val - mean) ** 2, 0) / n;
    return Math.sqrt(variance);
  }
}

// Singleton export
export const retailNPCs = new RetailNPCManager();
