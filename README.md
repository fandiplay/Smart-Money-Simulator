# Market Maker: The Liquidity Hunter 🎯

> **Simulasi Market Maker 2D — Strategi Keuangan & Likuiditas**

Sebuah game simulasi **market maker / liquidity hunter** berbasis web dengan mekanisme **order book**, **price impact model**, dan **AI retail NPC traders**. Dibangun dengan HTML5 Canvas murni — tanpa framework rendering.

---

## 🧠 Konsep Permainan

Anda berperan sebagai **institutional trader** (market maker) yang dapat menyuntikkan tekanan beli/jual ke dalam pasar. Tujuan: **memanage posisi, membaca likuiditas retail, dan menghindari margin call**.

Pasar bergerak secara **Ornstein–Uhlenbeck mean reversion** dengan **price impact** non-linear. Setiap injeksi yang Anda lakukan mempengaruhi harga dan menyapu stop loss para pedagang retail NPC.

### Mekanisme Inti

1. **Inject Buy/Sell** — Tekan tombol untuk menyuntikkan tekanan pasar searah.
2. **Price Impact** — Semakin besar volume, semakin besar dampak ke harga:  
   `ΔP = σ × √(Volume / ADV) × direction`
3. **Close Long/Short** — Tutup posisi dengan market order, realisasi PnL.
4. **Sweep Likuiditas** — Harga yang menembus **stop loss retail** akan menambah skor *sweep* Anda.
5. **Game Over** — Jika AUM (Equity) mencapai 0, akun terkena **margin call**.

---

## 🏗️ Arsitektur Proyek

```
institusi-simulator/
├── index.html              # UI layout + styling (Bloomberg/Cyberpunk theme)
├── package.json            # Vite dev server & build
├── src/
│   ├── main.js             # Entry point, game loop (60 FPS), event binding
│   ├── engine/
│   │   ├── market.js       # Market engine: price, order book, AUM, PnL
│   │   └── retail.js       # AI NPC retail traders (3 behavioural patterns)
│   └── ui/
│       └── render.js       # HTML5 Canvas renderer: candlestick, FVG, heatmap
└── README.md
```

---

## ⚙️ Engine

### `src/engine/market.js` — Closed-Loop Equity Engine

| Fitur | Detail |
|-------|--------|
| **Price Model** | Ornstein-Uhlenbeck mean reversion + random drift |
| **Price Impact** | `σ × √(Volume / ADV)`, directional |
| **Spread** | Bid/Ask = ±0.02 dari mid price |
| **Candles** | 1 candle/detik, max 500 candles |
| **AUM / PnL** | Floating PnL = posisi × (harga pasar − harga rata-rata) |
| **Position Mgmt** | Long & Short, weighted average entry |
| **Mitigation** | Market order lawan, realisasi PnL, update balance |

### `src/engine/retail.js` — AI Retail NPC Behaviour

Tiga tipe NPC dengan pola berbeda:

1. **Patternist** 🧩 — Menempatkan stop loss di dekat **level psikologis** (angka bulat). Jarak SL: 0.3–1.5 unit.
2. **FOMO Chaser** 🚀 — Masuk pasar saat **momentum** melebihi **2.5 standar deviasi**. Membuka 1–3 order baru.
3. **Panic Trader** 😱 — Langsung menutup posisi saat *news shock* dipicu.

> Retail order di-refill otomatis hingga 40 order aktif.

---

## 🎨 Renderer

### `src/ui/render.js` — HTML5 Canvas Viewport

| Layer | Deskripsi |
|-------|-----------|
| Grid | Minor & major grid lines |
| Candlestick | OHLC dengan warna bullish/bearish |
| FVG Blocks | Fair Value Gap antara candle berurutan |
| Liquidity Heatmap | Simulasi kluster likuiditas |
| Sweep Effects | Radial ring animasi saat terjadi sweep |
| Execution Markers | Triangle marker di harga eksekusi |
| Price Axis | Skala harga di sisi kanan |
| Center Line | Referensi auto-scroll (latest candle di tengah) |

**Fitur Navigasi:**
- Auto-scroll ke candle terbaru (center-focused)
- **Drag** (mouse) & **swipe** (touch) untuk panning horizontal
- HiDPI support via `devicePixelRatio`

---

## 🕹️ Cara Bermain

### Tombol

| Tombol | Fungsi |
|--------|--------|
| ▲ **INJECT BUY** | Suntik tekanan beli — harga naik, buka posisi long |
| ▼ **INJECT SELL** | Suntik tekanan jual — harga turun, buka posisi short |
| ◆ **CLOSE LONG** | Tutup posisi long, realisasi PnL |
| ◆ **CLOSE SHORT** | Tutup posisi short, realisasi PnL |
| **Volume Slider** | Atur volume injeksi (100–5,000) |

### Metrik Header

| Metrik | Arti |
|--------|------|
| **AUM** | Total ekuitas (balance + floating PnL) |
| **PnL** | Laba/rugi hari ini |
| **BID** | Harga bid saat ini |
| **ASK** | Harga ask saat ini |
| **SWEEPS** | Jumlah stop loss retail yang tersapu |

---

## 🚀 Menjalankan

```bash
# Install dependencies
npm install

# Development server (hot reload)
npm run dev

# Build production
npm run build

# Preview production build
npm run preview
```

Proyek menggunakan **Vite** sebagai bundler/dev server. Buka `http://localhost:5173` setelah menjalankan `npm run dev`.

---

## 📦 Tech Stack

| Teknologi | Penggunaan |
|-----------|------------|
| **Vanilla JS (ES Modules)** | Seluruh logika game |
| **HTML5 Canvas 2D** | Rendering chart & UI |
| **Vite** | Dev server & build tool |
| **CSS Grid** | Layout responsif |

---

## 🧪 Strategi & Tips

1. **Baca Likuiditas** — Perhatikan level-level psikologis (angka bulat) tempat Patternist memasang SL.
2. **Gunakan Momentum** — FOMO Chaser aktif saat volatilitas tinggi. Manfaatkan untuk memperkuat pergerakan.
3. **Manage Risk** — Jangan oversize. Volume besar = impact besar, tapi juga exposure besar.
4. **Sweep Hunting** — Targetkan harga yang mendekati kluster stop loss untuk meningkatkan skor sweep.
5. **Close Tepat Waktu** — Floating PnL bisa berbalik. Realisasi profit sebelum mean reversion terjadi.

---

## 🎯 Game Over

Jika **AUM ≤ 0**, permainan berakhir dengan **Margin Call**. Semua posisi likuidasi. Tekan **RESTART** untuk memulai ulang.

---

## 📄 Lisensi

Proyek ini dibuat untuk tujuan edukasi dan simulasi strategi pasar keuangan.

---

> **Disclaimer:** Ini adalah simulasi/ game edukasi. Tidak ada uang sungguhan yang dipertaruhkan. Semua data pasar adalah sintetis.