/**
 * ==========================================================================
 *  src/main.js  —  Entry Point & Game Loop (60 FPS)
 * ==========================================================================
 *  Manages:
 *    - Game loop at 60 FPS via requestAnimationFrame
 *    - UI event bindings (inject buy/sell, close positions, volume slider)
 *    - Dynamic control panel labels (PnL display) and disabled states
 *    - Trade log (MT5-style) for player actions only
 *    - Game over overlay
 * ==========================================================================
 */

import { marketEngine } from './engine/market.js';
import { retailNPCs } from './engine/retail.js';
import ChartRenderer from './ui/render.js';

// ========================================================================
//  DOM REFERENCES
// ========================================================================

const canvas = document.getElementById('chart-canvas');
const canvasContainer = document.getElementById('canvas-container');

// Metrics
const metricAUM = document.getElementById('metric-aum');
const metricPnL = document.getElementById('metric-pnl');
const metricBid = document.getElementById('metric-bid');
const metricAsk = document.getElementById('metric-ask');
const metricSweeps = document.getElementById('metric-sweeps');

// Control buttons
const btnInjectBuy = document.getElementById('btn-inject-buy');
const btnInjectSell = document.getElementById('btn-inject-sell');
const btnCloseLong = document.getElementById('btn-close-long');
const btnCloseShort = document.getElementById('btn-close-short');

// Volume slider
const volumeSlider = document.getElementById('volume-slider');
const volumeDisplay = document.getElementById('volume-display');

// Trade log
const tradeLogEntries = document.getElementById('trade-log-entries');

// Game Over
const gameOverOverlay = document.getElementById('game-over-overlay');
const restartBtn = document.getElementById('restart-btn');

// ========================================================================
//  STATE
// ========================================================================

/** @type {ChartRenderer} */
let renderer = null;

/** @type {boolean} Game running flag. */
let isRunning = false;

/** @type {boolean} Game over flag. */
let isGameOver = false;

/** @type {number|null} requestAnimationFrame ID. */
let animFrameId = null;

/** @type {number} Last tick timestamp for delta calculation. */
let lastTickTime = 0;

/** @type {number} Tick interval in ms (target: ~16.67ms for 60 FPS). */
const TICK_INTERVAL = 1000 / 60;

// ========================================================================
//  INITIALIZATION
// ========================================================================

/**
 * Boot the game: initialize engine, renderer, bind events, start loop.
 */
function init() {
  // Initialize market engine
  marketEngine.initialize();

  // Initialize renderer
  renderer = new ChartRenderer(canvas);
  renderer.resize();

  // Bind UI events
  bindEvents();

  // Start game loop
  isRunning = true;
  isGameOver = false;
  lastTickTime = performance.now();
  gameLoop(lastTickTime);
}

/**
 * Reset the game to initial state.
 */
function resetGame() {
  // Stop current loop
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  // Reset engine
  marketEngine.reset();
  retailNPCs.reset();
  retailNPCs.initialize(marketEngine.currentPrice);

  // Reset renderer
  if (renderer) {
    renderer.resize();
  }

  // Reset UI
  gameOverOverlay.classList.remove('active');
  isGameOver = false;
  isRunning = true;
  lastTickTime = performance.now();

  // Clear trade log
  tradeLogEntries.innerHTML = '';

  // Update UI immediately
  updateUI();

  // Restart loop
  gameLoop(lastTickTime);
}

// ========================================================================
//  GAME LOOP
// ========================================================================

/**
 * Main game loop running at 60 FPS via requestAnimationFrame.
 * @param {number} timestamp
 */
function gameLoop(timestamp) {
  if (!isRunning) return;

  animFrameId = requestAnimationFrame(gameLoop);

  const delta = timestamp - lastTickTime;

  if (delta >= TICK_INTERVAL) {
    lastTickTime = timestamp - (delta % TICK_INTERVAL);

    // Check game over
    if (marketEngine.aum <= 0) {
      triggerGameOver();
      return;
    }

    // Update market engine
    marketEngine.update();

    // Update retail NPCs
    retailNPCs.update(marketEngine.currentPrice, marketEngine.currentPrice - (marketEngine.candles.length > 1 ? marketEngine.candles[marketEngine.candles.length - 1].close : marketEngine.currentPrice));

    // Update UI
    updateUI();

    // Render chart
    const state = marketEngine.getState();
    renderer.render(state);
  }
}

// ========================================================================
//  UI UPDATE
// ========================================================================

/**
 * Update all UI elements based on current engine state.
 */
function updateUI() {
  const state = marketEngine.getState();

  // --- Header Metrics ---
  metricAUM.textContent = formatCurrency(state.aum);
  metricAUM.className = 'metric-value' + (state.aum >= 100000 ? '' : ' negative');

  metricPnL.textContent = formatCurrency(state.pnlToday, true);
  metricPnL.className = 'metric-value' + (state.pnlToday >= 0 ? ' positive' : ' negative');

  metricBid.textContent = state.bid.toFixed(2);
  metricAsk.textContent = state.ask.toFixed(2);
  metricSweeps.textContent = String(state.sweepCount);

  // --- Dynamic Button Labels & States ---
  const longPos = state.longVolume > 0;
  const shortPos = state.shortVolume > 0;

  // Close Long: show floating PnL if position exists
  if (longPos) {
    const longPnL = (state.currentPrice - state.longAvgPrice) * state.longVolume;
    btnCloseLong.textContent = `◆ CLOSE LONG ${formatCurrency(longPnL, true)}`;
    btnCloseLong.disabled = false;
    btnCloseLong.style.opacity = '1';
  } else {
    btnCloseLong.textContent = '◆ CLOSE LONG';
    btnCloseLong.disabled = true;
    btnCloseLong.style.opacity = '0.3';
  }

  // Close Short: show floating PnL if position exists
  if (shortPos) {
    const shortPnL = (state.shortAvgPrice - state.currentPrice) * state.shortVolume;
    btnCloseShort.textContent = `◆ CLOSE SHORT ${formatCurrency(shortPnL, true)}`;
    btnCloseShort.disabled = false;
    btnCloseShort.style.opacity = '1';
  } else {
    btnCloseShort.textContent = '◆ CLOSE SHORT';
    btnCloseShort.disabled = true;
    btnCloseShort.style.opacity = '0.3';
  }

  // Volume slider display
  volumeDisplay.textContent = formatNumber(parseInt(volumeSlider.value, 10));
}

// ========================================================================
//  EVENT BINDING
// ========================================================================

/**
 * Bind all UI interaction events.
 */
function bindEvents() {
  // --- Inject Buy ---
  btnInjectBuy.addEventListener('click', () => {
    if (isGameOver) return;
    const volume = parseInt(volumeSlider.value, 10);
    marketEngine.injectPressure(volume, 'buy');
    appendTradeLog('BUY', volume, marketEngine.currentPrice, 0);
    updateUI();
  });

  // --- Inject Sell ---
  btnInjectSell.addEventListener('click', () => {
    if (isGameOver) return;
    const volume = parseInt(volumeSlider.value, 10);
    marketEngine.injectPressure(volume, 'sell');
    appendTradeLog('SELL', volume, marketEngine.currentPrice, 0);
    updateUI();
  });

  // --- Close Long ---
  btnCloseLong.addEventListener('click', () => {
    if (isGameOver) return;
    const result = marketEngine.mitigate('long');
    if (result) {
      appendTradeLog('MITIGATION', marketEngine.tradeHistory[marketEngine.tradeHistory.length - 1].volume, result.price, result.pnl);
      updateUI();
    }
  });

  // --- Close Short ---
  btnCloseShort.addEventListener('click', () => {
    if (isGameOver) return;
    const result = marketEngine.mitigate('short');
    if (result) {
      appendTradeLog('MITIGATION', marketEngine.tradeHistory[marketEngine.tradeHistory.length - 1].volume, result.price, result.pnl);
      updateUI();
    }
  });

  // --- Volume Slider ---
  volumeSlider.addEventListener('input', () => {
    volumeDisplay.textContent = formatNumber(parseInt(volumeSlider.value, 10));
  });

  // --- Window Resize ---
  window.addEventListener('resize', () => {
    if (renderer) {
      renderer.resize();
    }
  });

  // --- Restart Button ---
  restartBtn.addEventListener('click', resetGame);
}

// ========================================================================
//  TRADE LOG (MT5-style)
// ========================================================================

/**
 * Append a trade entry to the trade history log.
 * Only records player-initiated actions: BUY, SELL, MITIGATION.
 *
 * @param {string} type   — 'BUY' | 'SELL' | 'MITIGATION'
 * @param {number} volume
 * @param {number} price
 * @param {number} pnl
 */
function appendTradeLog(type, volume, price, pnl) {
  const row = document.createElement('div');
  row.className = 'trade-row';

  const time = new Date();
  const timeStr = time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const typeClass = type === 'BUY' ? 'buy-type' : type === 'SELL' ? 'sell-type' : 'close-type';
  const pnlClass = pnl >= 0 ? 'positive' : 'negative';

  row.innerHTML = `
    <span class="trade-type ${typeClass}">${type}</span>
    <span>${formatNumber(volume)}</span>
    <span>${price.toFixed(2)}</span>
    <span class="trade-pnl ${pnlClass}">${formatCurrency(pnl, true)}</span>
    <span>${timeStr}</span>
  `;

  // Insert at top
  tradeLogEntries.insertBefore(row, tradeLogEntries.firstChild);

  // Limit to 50 entries
  while (tradeLogEntries.children.length > 50) {
    tradeLogEntries.removeChild(tradeLogEntries.lastChild);
  }
}

// ========================================================================
//  GAME OVER
// ========================================================================

/**
 * Trigger game over state: freeze canvas, show overlay.
 */
function triggerGameOver() {
  isGameOver = true;
  isRunning = false;

  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  gameOverOverlay.classList.add('active');

  // Disable all control buttons
  btnInjectBuy.disabled = true;
  btnInjectSell.disabled = true;
  btnCloseLong.disabled = true;
  btnCloseShort.disabled = true;
}

// ========================================================================
//  FORMATTING HELPERS
// ========================================================================

/**
 * Format a number with commas.
 * @param {number} n
 * @returns {string}
 */
function formatNumber(n) {
  return n.toLocaleString('en-US');
}

/**
 * Format a currency value.
 * @param {number} value
 * @param {boolean} showSign  — Whether to prepend +/-
 * @returns {string}
 */
function formatCurrency(value, showSign = false) {
  const prefix = showSign ? (value >= 0 ? '+' : '') : '';
  return `${prefix}$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ========================================================================
//  BOOT
// ========================================================================

// Start the game when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
