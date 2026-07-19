Bertindaklah sebagai Principal Financial Systems Architect dan Expert Mobile UI/UX Engineer. Kita akan membangun sebuah game strategi finansial 2D berfidelitas tinggi bernama "Market Maker: The Liquidity Hunter" dari nol (absolute scratch).

Pemain berperan sebagai Tier-1 Liquidity Provider (Institution) yang memanipulasi harga untuk menyapu (sweep) stop loss para NPC retail. Seluruh kode harus siap untuk standar produksi (production-ready), sangat modular menggunakan ES Modules (import/export), dioptimalkan untuk interaksi sentuh pada perangkat Android, serta memiliki implementasi matematika yang akurat dan andal.

STRUKTUR FOLDER YANG HARUS DIBUAT

institusi-simulator/
├── package.json
├── index.html
├── src/
│   ├── main.js          # Entry Point & Game Loop 60 FPS
│   ├── engine/
│   │   ├── market.js    # Mesin Harga Inti & Closed-Loop Order Book
│   │   └── retail.js    # Arsitektur AI NPC Retail dengan 3 Pola
│   └── ui/
│       └── render.js    # Viewport HTML5 Canvas (Center-Focused Panning)

---

1. SPESIFIKASI "package.json"

- Konfigurasikan lingkungan web Node.js yang ringan menggunakan Vite.
- Gunakan ""type": "module"".
- Tambahkan script:
  - ""dev": "vite""
  - ""build": "vite build""
  - ""preview": "vite preview""
- DevDependencies:
  - ""vite": "^5.0.0""

---

2. SPESIFIKASI "index.html" (UI Mobile-First)

- Terapkan tema profesional bergaya Bloomberg/Cyberpunk dengan mode gelap:
  - Warna dasar: "#060913"
  - Gunakan font monospace secara konsisten.
- Tata letak metrik pada bagian header menggunakan CSS Grid tanpa posisi absolut:

display: grid;
grid-template-columns: repeat(5, 1fr);
gap: 10px;
width: 100%;
box-sizing: border-box;

Header harus menampilkan:

- AUM (Equity)
- PnL Today
- BID
- ASK
- SWEEPS

Pastikan tidak ada teks yang saling bertumpuk pada layar kecil.

Susunan Workspace

- Bagian atas
  
  - Container Canvas
  - Tinggi tetap "40vh"
  - Digunakan untuk grafik harga.

- Bagian tengah
  
  - Control Panel
  - Tombol besar yang ramah sentuhan dengan kontras tinggi.

KOLOM 1 (BUY SIDE)

Tombol atas:

▲ INJECT BUY

- Warna teks & border: "#00ff66"

Tombol bawah:

◆ CLOSE LONG

- Warna Amber Gold: "#ffc400"

KOLOM 2 (SELL SIDE)

Tombol atas:

▼ INJECT SELL

- Warna teks & border: "#ff3366"

Tombol bawah:

◆ CLOSE SHORT

- Warna Amber Gold: "#ffc400"

Bagian bawah

Harus terdiri dari:

- Grid riwayat transaksi bergaya MT5.
- Sebuah container modal Game Over yang tersembunyi secara default menggunakan posisi absolut.

---

3. SPESIFIKASI "src/engine/market.js" (Closed-Loop Equity Engine)

Variabel Akun

Inisialisasi:

this.balance = 100000;
this.aum = 100000;
this.pnlToday = 0;

AUM harus selalu merepresentasikan Equity secara real-time.

Struktur Posisi

this.institutionalPositions = {
    long: {
        averagePrice: 0,
        totalVolume: 0
    },
    short: {
        averagePrice: 0,
        totalVolume: 0
    }
};

Natural Drift Engine

Gunakan model Ornstein-Uhlenbeck Mean Reversion yang terikat kuat pada VWAP, kemudian kombinasikan dengan drift acak:

(Math.random() - 0.5) * vol

Jangan menggunakan gelombang sinus (sine wave).

Model Dampak Harga

Tekanan harga akibat injeksi mengikuti:

ΔP = σ × √(Volume / ADV) × direction

Slider volume hanya boleh menerima nilai antara:

- Minimum: 100
- Maksimum: 5.000 unit

Perhitungan Equity Real-Time

Pada setiap tick di dalam fungsi "update()":

Jika memiliki posisi long:

floatingPnL =
(currentPrice - averagePrice)
× totalVolume

Jika memiliki posisi short:

floatingPnL =
(averagePrice - currentPrice)
× totalVolume

Lalu wajib memperbarui:

this.aum = this.balance + floatingPnL;
this.pnlToday = this.aum - 100000;

Closed-Loop Mitigation

Ketika "mitigate(type)" dipanggil:

- Penutupan posisi harus mengeksekusi market order lawan dengan volume 1:1 melalui "injectPressure()".
- Saldo (balance) baru diperbarui saat mitigasi:

this.balance = this.aum;

Kemudian reset seluruh data posisi:

- volume = 0
- averagePrice = 0

Isolasi Inisialisasi

Saat startup:

- Buat 100 candle awal.
- Buat 40 order retail awal.

Selama proses ini:

- Jangan menjalankan "checkSweeps()".
- Jangan menghitung profit maupun loss.

Kondisi Game Over

Jika:

this.aum <= 0

maka:

- hentikan game loop,
- ubah status global:

isGameOver = true;

---

4. SPESIFIKASI "src/engine/retail.js" (AI NPC)

Kelola array posisi retail beserta stop loss (SL Cluster).

Pola AI

Patternist

- Menempatkan cluster stop loss pada jarak 0,3–1,5 unit dari level support/resistance psikologis berbentuk angka bulat.

FOMO Chaser

- Membuka market order ketika momentum melewati 2,5 standar deviasi.

Panic Trader

- Menutup posisi secara instan ketika pemain memicu fungsi dinamis:

newsShock()

---

5. SPESIFIKASI "src/ui/render.js" (Center-Focused Interactive Viewport)

- Mendukung penuh layar HiDPI melalui "devicePixelRatio".
- Implementasikan Center-Focused Panning.

Perhitungan auto-scroll ("this.currentOffsetX") harus selalu mengunci candle atau tick aktif tepat di tengah horizontal canvas:

canvas.width / 2

Separuh kanan layar (50%) harus tetap kosong sebagai ruang untuk:

- pergerakan harga berikutnya,
- garis indikator horizontal.

Tambahkan:

- event click-and-drag menggunakan mouse,
- event dual touch ("touchstart" dan "touchmove") untuk panning pada perangkat sentuh.

Layer Rendering

Harus menampilkan:

- blok FVG (Fair Value Gap) berwarna transparan,
- grid koordinat,
- candlestick hijau dan merah,
- marker segitiga posisi eksekusi,
- heatmap likuiditas horizontal dinamis:
  - Hijau = stop loss long
  - Merah = stop loss short
- lingkaran ekspansi radial ketika sweep terjadi.

---

6. SPESIFIKASI "src/main.js" (Sinkronisasi Jurnal MT5)

Mengatur:

- game loop,
- event klik,
- proses rendering setiap frame.

Sinkronisasi Dinamis Control Panel

Setiap frame, ubah label tombol mitigasi agar menampilkan PnL berjalan.

Contoh:

CLOSE LONG (+$1,200)

atau

CLOSE SHORT (-$450)

Jika tidak ada posisi terbuka:

- "disabled = true"
- "opacity = 0.3"

Isolasi Trade Log MT5

Riwayat transaksi pemain tidak boleh mencatat transaksi otomatis dari NPC atau sweep retail.

Trade history hanya boleh berisi aksi yang dilakukan langsung oleh pemain:

- BUY
- SELL
- MITIGATION

Overlay Game Over

Ketika:

market.aum <= 0

maka:

- hentikan rendering canvas,
- bekukan seluruh interaksi,
- tampilkan tulisan:

ACCOUNT MARGIN CALL
AUM LIQUIDATED
GAME OVER

---

Instruksi Akhir

Hasilkan seluruh source code lengkap dengan kualitas setara produksi (production-grade) secara file per file, sertakan header path yang jelas pada setiap file, dan jangan memotong (truncate) blok kode yang dihasilkan.
