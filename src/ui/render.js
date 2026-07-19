/**
 * ==========================================================================
 *  src/ui/render.js  —  HTML5 Canvas Viewport with Center-Focused Panning
 * ==========================================================================
 *  Features:
 *    - HiDPI support via devicePixelRatio
 *    - Center-focused auto-scroll (latest candle at canvas.width/2)
 *    - Right half (50%) reserved as empty space for future price movement
 *    - Click-and-drag (mouse) + dual touch panning
 *    - Layer rendering: FVG blocks, coordinate grid, candlesticks,
 *      execution markers, liquidity heatmap, radial sweep expansion
 * ==========================================================================
 */

/**
 * @typedef {import('../engine/market.js').Candle} Candle
 */

/**
 * Colour palette matching the Bloomberg/Cyberpunk theme.
 */
const COLORS = {
  bg: '#060913',
  grid: '#111827',
  gridMajor: '#1a2340',
  bullish: '#00ff66',
  bearish: '#ff3366',
  fvg: 'rgba(74, 106, 176, 0.12)',
  fvgBorder: 'rgba(74, 106, 176, 0.25)',
  text: '#6b7a9e',
  textBright: '#ffffff',
  liquidityLong: 'rgba(0, 255, 102, 0.15)',
  liquidityShort: 'rgba(255, 51, 102, 0.15)',
  sweepRing: 'rgba(255, 196, 0, 0.4)',
  executionMarker: '#ffc400',
};

/**
 * Candle dimensions.
 */
const CANDLE_WIDTH = 6;
const CANDLE_GAP = 2;
const CANDLE_TOTAL = CANDLE_WIDTH + CANDLE_GAP;

class ChartRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;

    /** @type {CanvasRenderingContext2D} */
    this.ctx = canvas.getContext('2d');

    /** @type {number} Canvas logical width (CSS pixels). */
    this.width = 0;

    /** @type {number} Canvas logical height (CSS pixels). */
    this.height = 0;

    /** @type {number} Horizontal pan offset in pixels. */
    this.currentOffsetX = 0;

    /** @type {number} Minimum allowed offset X (clamp to left edge). */
    this._minOffsetX = 0;

    /** @type {number} Maximum allowed offset X. */
    this._maxOffsetX = 0;

    /** @type {boolean} Is the user currently dragging. */
    this._isDragging = false;

    /** @type {number} Last drag X position. */
    this._lastDragX = 0;

    /** @type {Array<{x: number, y: number, radius: number, alpha: number}>} */
    this._sweepEffects = [];

    /** @type {number} Top padding for price axis. */
    this._paddingTop = 20;

    /** @type {number} Bottom padding. */
    this._paddingBottom = 20;

    /** @type {number} Price axis width (right side). */
    this._axisWidth = 60;

    /** @type {number|null} Internal price range for scaling. */
    this._priceMin = null;
    this._priceMax = null;

    // Bind event handlers
    this._bindEvents();
  }

  /**
   * Resize the canvas backing store for HiDPI.
   * Must be called whenever the container size changes.
   */
  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.width = rect.width;
    this.height = rect.height;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ========================================================================
  //  MAIN RENDER LOOP
  // ========================================================================

  /**
   * Render one frame.
   * @param {Object} state  — Market state snapshot from marketEngine.getState().
   */
  render(state) {
    const { ctx } = this;
    const w = this.width;
    const h = this.height;

    // --- Clear ---
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    if (!state || state.candles.length === 0) return;

    // Calculate auto-scroll offset to keep latest data in center
    this._updateAutoScroll(state);

    // Compute visible price range
    this._computePriceRange(state);

    // --- Draw grid ---
    this._drawGrid(w, h);

    // --- Draw liquidity heatmap ---
    this._drawLiquidityHeatmap(state, w, h);

    // --- Draw FVG blocks ---
    this._drawFVGBlocks(state, w, h);

    // --- Draw candlesticks ---
    this._drawCandlesticks(state, w, h);

    // --- Draw sweep effects ---
    this._drawSweepEffects(w, h);

    // --- Draw execution markers ---
    this._drawExecutionMarkers(state, w, h);

    // --- Draw price axis ---
    this._drawPriceAxis(w, h);

    // --- Draw center line ---
    this._drawCenterLine(w, h);
  }

  // ========================================================================
  //  EVENT BINDING (Mouse + Touch)
  // ========================================================================

  /**
   * Bind mouse and touch events for panning.
   */
  _bindEvents() {
    // Mouse events
    this.canvas.addEventListener('mousedown', (e) => this._onDragStart(e.clientX));
    window.addEventListener('mousemove', (e) => this._onDragMove(e.clientX));
    window.addEventListener('mouseup', () => this._onDragEnd());

    // Touch events
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this._onDragStart(e.touches[0].clientX);
      }
    }, { passive: true });

    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        this._onDragMove(e.touches[0].clientX);
      }
    }, { passive: true });

    this.canvas.addEventListener('touchend', () => this._onDragEnd(), { passive: true });
  }

  /**
   * @param {number} clientX
   */
  _onDragStart(clientX) {
    this._isDragging = true;
    this._lastDragX = clientX;
  }

  /**
   * @param {number} clientX
   */
  _onDragMove(clientX) {
    if (!this._isDragging) return;

    const delta = clientX - this._lastDragX;
    this._lastDragX = clientX;

    this.currentOffsetX += delta;
    this._clampOffsetX();
  }

  _onDragEnd() {
    this._isDragging = false;
  }

  // ========================================================================
  //  INTERNAL RENDERING HELPERS
  // ========================================================================

  /**
   * Update auto-scroll offset: always place the latest candle at center.
   * @param {Object} state
   */
  _updateAutoScroll(state) {
    const totalCandles = state.candles.length + (state.currentCandle ? 1 : 0);
    const lastIdx = totalCandles - 1;

    // Desired offset so that the latest candle (lastIdx) lands exactly at canvas center.
    // _indexToX(lastIdx) = lastIdx * CANDLE_TOTAL - offset + width/2
    // We want: lastIdx * CANDLE_TOTAL - offset + width/2 = width/2
    // => offset = lastIdx * CANDLE_TOTAL
    const desiredOffset = lastIdx * CANDLE_TOTAL;

    // Only auto-scroll if user is not dragging
    if (!this._isDragging) {
      this.currentOffsetX = desiredOffset;
    }

    // Clamp: min offset = first candle at center; max offset = latest candle at center
    this._minOffsetX = 0;
    this._maxOffsetX = Math.max(0, lastIdx * CANDLE_TOTAL);

    this._clampOffsetX();
  }

  /**
   * Clamp offsetX to valid range.
   */
  _clampOffsetX() {
    this.currentOffsetX = Math.max(this._minOffsetX, Math.min(this._maxOffsetX, this.currentOffsetX));
  }

  /**
   * Compute visible price range from visible candles.
   * @param {Object} state
   */
  _computePriceRange(state) {
    const w = this.width - this._axisWidth;
    const startIdx = Math.max(0, Math.floor((this.currentOffsetX - w) / CANDLE_TOTAL));
    const endIdx = Math.min(state.candles.length, Math.ceil((this.currentOffsetX + w) / CANDLE_TOTAL));

    let min = Infinity;
    let max = -Infinity;

    for (let i = startIdx; i < endIdx && i < state.candles.length; i++) {
      const c = state.candles[i];
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
    }

    if (state.currentCandle) {
      if (state.currentCandle.low < min) min = state.currentCandle.low;
      if (state.currentCandle.high > max) max = state.currentCandle.high;
    }

    // Add padding
    const padding = (max - min) * 0.1 || 1;
    this._priceMin = min - padding;
    this._priceMax = max + padding;
  }

  /**
   * Map price to Y coordinate.
   * @param {number} price
   * @param {number} h
   * @returns {number}
   */
  _priceToY(price, h) {
    const range = this._priceMax - this._priceMin;
    if (range === 0) return h / 2;
    return this._paddingTop + ((this._priceMax - price) / range) * (h - this._paddingTop - this._paddingBottom);
  }

  /**
   * Map candle index to X coordinate.
   * @param {number} index
   * @returns {number}
   */
  _indexToX(index) {
    return index * CANDLE_TOTAL - this.currentOffsetX + this.width / 2;
  }

  /**
   * Draw grid lines.
   * @param {number} w
   * @param {number} h
   */
  _drawGrid(w, h) {
    const { ctx } = this;
    const range = this._priceMax - this._priceMin;
    const step = Math.pow(10, Math.floor(Math.log10(range)) - 1);
    const start = Math.floor(this._priceMin / step) * step;

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;

    for (let price = start; price <= this._priceMax; price += step) {
      const y = this._priceToY(price, h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w - this._axisWidth, y);
      ctx.stroke();
    }

    // Major grid lines (every 5 steps)
    ctx.strokeStyle = COLORS.gridMajor;
    for (let price = start; price <= this._priceMax; price += step * 5) {
      const y = this._priceToY(price, h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w - this._axisWidth, y);
      ctx.stroke();
    }
  }

  /**
   * Draw candlesticks.
   * @param {Object} state
   * @param {number} h
   */
  _drawCandlesticks(state, h) {
    const { ctx } = this;
    const allCandles = [...state.candles];
    if (state.currentCandle) {
      allCandles.push(state.currentCandle);
    }

    for (let i = 0; i < allCandles.length; i++) {
      const c = allCandles[i];
      const x = this._indexToX(i);

      // Skip if outside visible area
      if (x < -CANDLE_TOTAL || x > this.width + CANDLE_TOTAL) continue;

      const openY = this._priceToY(c.open, h);
      const closeY = this._priceToY(c.close, h);
      const highY = this._priceToY(c.high, h);
      const lowY = this._priceToY(c.low, h);

      const isBullish = c.close >= c.open;

      ctx.strokeStyle = isBullish ? COLORS.bullish : COLORS.bearish;
      ctx.fillStyle = isBullish ? COLORS.bullish : COLORS.bearish;
      ctx.lineWidth = 1;

      // Wick
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(openY, closeY);
      const bodyBottom = Math.max(openY, closeY);
      const bodyHeight = Math.max(1, bodyBottom - bodyTop);

      ctx.fillRect(x - CANDLE_WIDTH / 2, bodyTop, CANDLE_WIDTH, bodyHeight);
    }
  }

  /**
   * Draw FVG (Fair Value Gap) blocks.
   * @param {Object} state
   * @param {number} w
   * @param {number} h
   */
  _drawFVGBlocks(state, w, h) {
    const { ctx } = this;
    const candles = state.candles;

    // Detect FVGs between consecutive candles
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];

      const gapTop = Math.min(prev.close, curr.open);
      const gapBottom = Math.max(prev.close, curr.open);
      const hasGapUp = curr.open > prev.close;
      const hasGapDown = curr.open < prev.close;

      if (!hasGapUp && !hasGapDown) continue;

      const x1 = this._indexToX(i - 1) + CANDLE_WIDTH / 2;
      const x2 = this._indexToX(i) - CANDLE_WIDTH / 2;
      const y1 = this._priceToY(hasGapUp ? gapTop : gapBottom, h);
      const y2 = this._priceToY(hasGapUp ? gapBottom : gapTop, h);

      if (x2 < 0 || x1 > this.width) continue;

      ctx.fillStyle = COLORS.fvg;
      ctx.strokeStyle = COLORS.fvgBorder;
      ctx.lineWidth = 1;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }
  }

  /**
   * Draw liquidity heatmap.
   * @param {Object} state
   * @param {number} w
   * @param {number} h
   */
  _drawLiquidityHeatmap(state, w, h) {
    const { ctx } = this;

    // For now, simulate liquidity clusters based on recent price levels
    // In a full implementation, this would read from retail NPC stop loss clusters
    const levelCount = 8;
    const range = this._priceMax - this._priceMin;

    for (let i = 0; i < levelCount; i++) {
      const price = this._priceMin + (range * (i + 1)) / (levelCount + 1);
      const y = this._priceToY(price, h);
      const intensity = Math.random() * 0.3 + 0.1;

      // Alternate between long and short liquidity
      const isLong = i % 2 === 0;
      ctx.fillStyle = isLong ? COLORS.liquidityLong : COLORS.liquidityShort;

      const bandHeight = range / levelCount * this._priceToY(this._priceMin, 0) / 10;
      ctx.fillRect(0, y - bandHeight / 2, w - this._axisWidth, bandHeight);
    }
  }

  /**
   * Draw sweep expansion effects (radial rings).
   * @param {number} w
   * @param {number} h
   */
  _drawSweepEffects(w, h) {
    const { ctx } = this;

    // Age effects
    this._sweepEffects = this._sweepEffects.filter(effect => effect.alpha > 0);

    for (const effect of this._sweepEffects) {
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.sweepRing;
      ctx.lineWidth = 2;
      ctx.globalAlpha = effect.alpha;
      ctx.stroke();

      // Fill
      ctx.fillStyle = COLORS.sweepRing;
      ctx.globalAlpha = effect.alpha * 0.2;
      ctx.fill();

      // Decay
      effect.radius += 2;
      effect.alpha -= 0.02;
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Draw execution markers.
   * @param {Object} state
   * @param {number} w
   * @param {number} h
   */
  _drawExecutionMarkers(state, w, h) {
    const { ctx } = this;

    // Draw markers for player trades in the visible range
    if (!state.candles || state.candles.length === 0) return;

    // Get the most recent trade price for a marker
    const lastCandle = state.currentCandle || state.candles[state.candles.length - 1];
    const x = this._indexToX(state.candles.length - (state.currentCandle ? 0 : 1));
    const y = this._priceToY(lastCandle.close, h);

    ctx.fillStyle = COLORS.executionMarker;
    ctx.beginPath();

    // Triangle marker pointing at the execution
    const size = 6;
    ctx.moveTo(x, y - size);
    ctx.lineTo(x - size, y + size);
    ctx.lineTo(x + size, y + size);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Draw price axis on the right side.
   * @param {number} w
   * @param {number} h
   */
  _drawPriceAxis(w, h) {
    const { ctx } = this;
    const axisX = w - this._axisWidth;
    const range = this._priceMax - this._priceMin;
    const step = Math.pow(10, Math.floor(Math.log10(range)) - 1);
    const start = Math.floor(this._priceMin / step) * step;

    // Axis background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(axisX, 0, this._axisWidth, h);

    // Axis line
    ctx.strokeStyle = COLORS.gridMajor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX, 0);
    ctx.lineTo(axisX, h);
    ctx.stroke();

    // Price labels
    ctx.fillStyle = COLORS.text;
    ctx.font = '10px "Courier New", monospace';
    ctx.textAlign = 'right';

    for (let price = start; price <= this._priceMax; price += step) {
      const y = this._priceToY(price, h);
      ctx.fillText(price.toFixed(2), w - 4, y + 3);
    }
  }

  /**
   * Draw center reference line.
   * @param {number} w
   * @param {number} h
   */
  _drawCenterLine(w, h) {
    const { ctx } = this;
    const centerX = w / 2;

    ctx.strokeStyle = 'rgba(107, 122, 158, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ========================================================================
  //  PUBLIC EFFECT TRIGGERS
  // ========================================================================

  /**
   * Trigger a sweep visual effect at the given coordinates.
   * @param {number} x
   * @param {number} y
   */
  triggerSweepEffect(x, y) {
    this._sweepEffects.push({
      x,
      y,
      radius: 5,
      alpha: 0.8,
    });
  }
}

export default ChartRenderer;
