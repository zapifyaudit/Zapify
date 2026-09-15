# Zapify: Developer Brief

**Versi:** 1.0, 15 September 2026
**Status:** Landing page dan scanner client-side sudah berjalan. Sentimen 𝕏 live masih menunggu proxy di-deploy.
**File:** `index.html` (halaman dan mesin scan), `x-sentiment-worker.js` (proxy X API)

---

## 1. Ringkasan produk

Zapify adalah scanner risiko token untuk **Robinhood Chain mainnet (chain ID 4663)**. Satu kali tempel contract address (CA) menghasilkan satu laporan yang membaca token dari dua sisi:

1. **On-chain:** kekuasaan owner di kontrak, likuiditas, sebaran holder, dan pola pendanaan pembeli.
2. **Di 𝕏:** nada percakapan, jejak keluhan scam, dan shilling copy-paste.

Hasilnya berupa skor 0–100, verdict (Low risk, Caution, atau High risk), dan daftar temuan yang menjelaskan setiap poin skor.

**Pengguna utama:** trader ritel di Robinhood Chain yang ingin cek cepat sebelum membeli token baru.
**Tugas utama halaman:** membuat pengunjung menempelkan CA dan membaca laporannya.

### Narasi

| Elemen | Isi |
|---|---|
| Tagline | **Read the contract. Read the room.** |
| Janji | Satu scan, dua lensa (on-chain dan 𝕏), setiap red flag dijelaskan. |
| Masalah | *Fast chain. Faster traps.* Tiga jebakan: hidden switches, bundled buyers, manufactured hype. |
| Prinsip | **Hype never lowers your score.** Sentimen positif tidak pernah menurunkan risiko. |
| Kepercayaan | Read-only, tanpa koneksi wallet. Setiap laporan menampilkan data coverage dan tautan ke sumber. |
| Footer | *A second opinion for every Robinhood Chain token.* |

**Aturan copy yang harus dijaga:**
- Jangan menulis klaim yang tidak bisa dibuktikan, seperti jumlah pengguna, "accurate", atau "guaranteed safe".
- Disclaimer "Not financial advice" wajib ada.
- Fitur Telegram sudah dihapus. Jangan ditambahkan kembali sampai bot-nya benar-benar ada.

---

## 2. Arsitektur

```
Browser (index.html)
 ├─ runScan(address)
 │   ├─ probeContract()      → Robinhood RPC (fallback: Blockscout eth-rpc)
 │   ├─ fetchExplorer()      → Blockscout API v2
 │   ├─ fetchMarket()        → DexScreener (chain slug: robinhood)
 │   ├─ computeFlowFeatures()→ Blockscout (riwayat pendanaan pembeli)
 │   └─ fetchSentiment()     → sentimentEndpoint (Cloudflare Worker) → X API v2
 ├─ scoreReport()            → aturan berbobot + hard gate
 └─ renderReport()           → hero (ringkas) & #scan (lengkap)
```

Semua modul berjalan paralel dan boleh gagal sendiri-sendiri. Modul yang gagal dicatat di `r.status`, lalu ditampilkan sebagai **Data coverage** (jumlah modul `ok` dibagi 5).

### Konfigurasi (`ZAPIFY_CONFIG` di `index.html`)

| Key | Nilai | Catatan |
|---|---|---|
| `chainId` | `4663` | RPC yang mengembalikan chain ID lain akan ditolak. |
| `rpcUrls` | `rpc.mainnet.chain.robinhood.com`, lalu `robinhoodchain.blockscout.com/api/eth-rpc` | RPC publik dibatasi rate-nya. Untuk produksi, pakai provider berbayar. |
| `explorerApi` | `https://robinhoodchain.blockscout.com/api/v2` | Explorer resmi. |
| `dexChain` | `robinhood` | Slug chain di DexScreener. |
| `sentimentEndpoint` | `''` | Isi dengan URL worker untuk mengaktifkan sentimen live. |
| `maxFundingLookups` | `12` | Batas jumlah pembeli yang dilacak pendanaannya. |
| `cacheMs` | `60000` | Cache hasil scan per alamat, disimpan di memori. |

---

## 3. Modul scan

### 3.1 Contract auditor (RPC)
- `eth_getCode`: kalau hasilnya kosong, scan dihentikan dengan pesan "No contract found".
- `name`, `symbol`, `decimals`, `totalSupply`, `owner()`/`getOwner()` dibaca lewat `eth_call`.
- **Proxy:** membaca slot implementasi EIP-1967, lalu bytecode implementasinya ikut dipindai. Blockscout `implementations` dipakai sebagai cadangan.
- **Pemindaian selector** dengan mencari pola `PUSH4` (`63` + selector) di bytecode:

| Grup | Fungsi |
|---|---|
| mint | `mint(address,uint256)`, `mint(uint256)`, `_mint(address,uint256)` |
| blacklist | `blacklist`, `addToBlacklist`, `setBlacklist`, `blacklistAddress`, `addBots`, `setBots`, `setBot`, `isBlacklisted` |
| feeSetter | `setFee`, `setFees`, `setTaxFee`, `setBuyFee`, `setSellFee`, `setTaxes`, `updateFees`, `setSellTax`, `setBuyTax` |
| tradingSwitch | `setTradingEnabled(bool)`, `setTrading(bool)` |
| pause | `pause()` |
| txLimit | `setMaxTxAmount`, `setMaxWalletSize`, `setMaxWallet` |

Fungsi-fungsi berbahaya ini hanya dihitung sebagai risiko kalau owner **belum** di-renounce, atau kalau kontrak tidak punya fungsi `owner()` sama sekali.

> Keterbatasan: pemindaian selector adalah heuristik. Nama fungsi yang tidak umum dan kontrol akses berbasis role (`AccessControl`) bisa lolos.

### 3.2 Explorer (Blockscout v2)
Endpoint yang dipakai: `/tokens/{a}`, `/tokens/{a}/holders`, `/smart-contracts/{a}`, `/addresses/{a}`, `/tokens/{a}/transfers`, `/addresses/{a}/transactions?filter=to`, `/addresses/{a}/counters`. Permintaan dibatasi maksimal 4 sekaligus.

### 3.3 Market (DexScreener)
- Endpoint utama: `/tokens/v1/robinhood/{a}`. Cadangannya `/latest/dex/tokens/{a}`, dengan hasil disaring ke `chainId === 'robinhood'`.
- Data yang diambil: likuiditas total, harga, FDV, transaksi 24 jam, umur pair, dan socials/website. Hanya URL `https:` yang diterima.

### 3.4 Sebaran holder
Pool, kontrak (locker/router), dan alamat burn (`0x0…0`, `0x…dEaD`) tidak dihitung. Yang dihitung: porsi wallet terbesar dan porsi top 10.

### 3.5 Funding graph dan cluster (port dari ARGUS)
Logika ini diambil dari `ARGUS/packages/core/src/engine/features.ts` dan `scorer.ts` (REGIME W14):

1. Sekitar 50 transfer token terbaru diklasifikasikan. Transfer dari kontrak/pool ke EOA dihitung sebagai **buy**, dan sebaliknya sebagai **sell**.
2. Untuk maksimal 12 pembeli unik, diambil transaksi masuk paling awal. Pengirimnya dianggap sebagai **funder**.
3. Pembeli dikelompokkan berdasarkan funder. Funder dengan lebih dari 2.000 transaksi (exchange atau bridge) tidak dihitung sebagai cluster.
4. Fitur yang dihitung: `funding_parent_share`, `deployer_funded`, `cluster_dominance`, `fresh_wallet_ratio` (umur wallet di bawah 24 jam saat membeli), `same_block_ratio`, `size_cv` (koefisien variasi ukuran buy), dan `dev_sold`.

**Perbedaan dengan ARGUS:**
- ARGUS memakai 20 pembeli *pertama*. Zapify memakai jendela transfer *terbaru* karena mengambil pembeli pertama butuh paginasi penuh.
- Di ARGUS, jalur EVM untuk fitur ini masih berupa nilai hardcode. Zapify menghitungnya dari data asli.

### 3.6 Sentimen 𝕏
- **Query:** `$TICKER OR "0x<ca lowercase>"`. Cashtag tidak boleh diawali angka, jadi format `$0X716D…` tidak akan menemukan apa-apa di X.
- **Skor per post:** kamus istilah kripto (positif/negatif), negasi dalam jarak 2 token (misalnya "not a rug"), dan penalti untuk frasa "can't sell".
- **Bobot per post:** `1 + log10(1 + likes + 2×reposts + replies)`. Bobot dikali 0,5 kalau followers di bawah 50, dan dikali 0,4 kalau teksnya duplikat.
- **Output:** `score` (−1 sampai 1), `label`, `scamMentions`, `dupRatio`, dan 3 post dengan bobot tertinggi.
- **Tanpa `sentimentEndpoint`:** modul hanya menampilkan tautan pencarian X, dan skor tidak terpengaruh.

**Kontrak API proxy:**
```
GET {sentimentEndpoint}?q=$SPAWND OR "0x716d…a757"
→ { "posts": [ { "id", "text", "created_at", "likes", "reposts", "replies",
                 "author": { "username", "followers" } } ] }
```

> Catatan: repo `bimoadis/Pulse` tidak bisa diakses (404 atau private). Modul ini ditulis ulang tanpa melihat kode Pulse. Kalau Pulse memakai provider lain (misalnya xAI), cukup ganti isi worker selama format respons di atas tetap sama.

---

## 4. Skoring

`skor = round(100 × (1 − e^(−Σbobot / 14)))`. Kalau ada **hard gate** yang terpicu, skor minimal 80.

| Verdict | Rentang |
|---|---|
| Low risk | 0–29 |
| Caution | 30–59 |
| High risk | 60–100 |

| Kode | Bobot | Severity | Kondisi |
|---|---|---|---|
| NO_SELLS ⛔ | 10 | high | buys 24 jam ≥ 25 dan sells = 0 |
| WHALE_MAJORITY ⛔ | 8 | high | wallet terbesar > 50% |
| NO_DEX_PAIR | 6 | high | tidak ada pair di Robinhood |
| VERY_LOW_LIQUIDITY | 6 | high | likuiditas < $1K |
| MINT_AUTHORITY | 5 | high | ada fungsi mint dan owner aktif |
| BLACKLIST_FUNCTION | 5 | high | ada fungsi blacklist dan owner aktif |
| SELLS_SUPPRESSED | 5 | high | buys ≥ 40 dan rasio sell/buy < 5% |
| SHARED_FUNDING_PARENT | 5 | high | parent share ≥ 60% |
| DEPLOYER_FUNDED_BUYERS | 5 | high | didanai deployer ≥ 10% |
| CLUSTER_DOMINANCE | 5 | high | cluster ≥ 70% |
| SCAM_MENTIONS_ON_X | 5 | high | ≥ 3 post menyebut rug/scam/honeypot |
| UPGRADEABLE_PROXY | 4 | high | ada implementasi proxy |
| MUTABLE_TAX | 4 | high | ada fungsi pengubah pajak dan owner aktif |
| DEV_SELLING | 4 | high | deployer menjual ke pool |
| UNVERIFIED_SOURCE | 4 | medium | source code tidak terverifikasi |
| TOP_HOLDER_CONCENTRATION | 4 | medium | wallet terbesar > 10% |
| TRADING_SWITCH | 3 | medium | trading bisa dimatikan |
| LOW_LIQUIDITY | 3 | medium | likuiditas < $10K |
| TOP10_CONCENTRATION | 3 | medium | top 10 > 60% |
| SAME_BLOCK_CONCENTRATION | 3 | medium | ≥ 30% buy di satu blok (minimal 5 pembeli) |
| UNIFORM_BUY_SIZES | 3 | medium | CV ukuran buy ≤ 0,05 (minimal 5 buy) |
| NEGATIVE_SENTIMENT | 3 | medium | ≥ 10 post dan skor < −0,2 |
| COPY_PASTE_SHILLING | 3 | medium | ≥ 10 post dan duplikat > 40% |
| PAUSABLE | 2 | medium | ada fungsi pause dan owner aktif |
| FRESH_WALLETS_RATIO | 2 | medium | ≥ 60% wallet berumur < 24 jam |
| COORDINATED_BUYING | 2 | medium | cluster 30–69% |
| OWNER_ACTIVE | 2 | low | owner belum di-renounce |
| FEW_HOLDERS | 2 | low | holder < 50 |
| NO_SOCIALS | 2 | low | tidak ada website atau socials |
| TX_LIMITS | 1 | low | limit transaksi bisa diubah |
| NEW_PAIR | 1 | low | umur pair < 24 jam |

⛔ = hard gate

**Subclass** (dari ARGUS):
- `extraction`: parent share ≥ 60% atau cluster ≥ 70%
- `coordinated`: parent share ≥ 20% atau cluster ≥ 30%
- `organic`: selain dua kondisi di atas

---

## 5. Frontend

- **Warna:** `--lime #ccff00`, `--ink #0d0d0a`, `--gray-card #1a1a16`, `--gray-text #b9b9ae`, `--white #fff`. Tambahan: paper `#f5f5f0`, muted `#5e5e55`, line `#e6e6de`, danger `#c8102e`.
- **Aturan kontras:** lime tidak pernah dipakai sebagai warna teks di atas putih. Lime hanya untuk latar, atau untuk teks di atas ink.
- **Tipografi:** Archivo (variable). Headline memakai `font-stretch:118%` dan weight 800, body memakai lebar normal.
- **Struktur halaman:** Nav → Hero (headline, scan ringkas, sample report) → *Fast chain. Faster traps.* (band ink) → *Two lenses, one scan* → *From paste to verdict* → *Scan before you buy* (scan lengkap) → FAQ → Footer.
- **Satu elemen menonjol:** kartu sample report di hero, dengan bayangan lime yang offset. Isinya token fiktif dan diberi label "not real data".
- **Aksesibilitas:** `aria-live` untuk status dan hasil scan, `:focus-visible`, dukungan `prefers-reduced-motion`, dan menu mobile dengan `aria-expanded`.
- **Keamanan:** semua string dari luar (nama token, isi post, URL) di-escape atau divalidasi sebelum ditampilkan. Ini sudah diuji dengan nama token yang berisi tag `<img onerror>`.
- `index.mp4` tidak lagi dipakai.

---

## 6. Deploy

1. **Halaman:** hosting statis mana pun (Cloudflare Pages, Vercel, Netlify). Tidak perlu build step.
2. **Proxy sentimen:**
   ```bash
   npx wrangler init zapify-sentiment   # tempel x-sentiment-worker.js ke src/index.js
   npx wrangler secret put X_BEARER_TOKEN
   # wrangler.toml → [vars] ALLOWED_ORIGIN = "https://domain-anda"
   npx wrangler deploy
   ```
   Setelah itu, isi `ZAPIFY_CONFIG.sentimentEndpoint` dengan URL worker. Endpoint `search/recent` di X API memerlukan paket berbayar. Worker hanya menerima query berupa cashtag atau CA, dan menyimpan cache selama 120 detik.
3. **Produksi:** ganti RPC ke provider berbayar yang mendukung chain 4663, karena RPC publik akan membalas 429 saat trafik tinggi. Pertimbangkan API key Blockscout PRO (`api.blockscout.com`, `chain_id=4663`).

---

## 7. Pengujian

**Sudah dilakukan:**
- Uji end-to-end dengan data RPC, Blockscout, DexScreener, dan sentimen tiruan. Semua aturan terpicu sesuai harapan, dan pengecekan XSS lolos.
- Tampilan dicek di viewport 1300px dan 390px.

**Belum dilakukan (wajib sebelum rilis):**
- [ ] Scan CA asli di browser, termasuk contoh `0x716d3aea78a8e767b127ec0b2916dbbe7383a757`. Lingkungan pengembangan tidak punya akses ke domain Robinhood Chain.
- [ ] Pastikan RPC publik dan Blockscout mengizinkan CORS dari domain produksi.
- [ ] Bandingkan hasil scan dengan token yang diketahui aman dan token yang diketahui rug, lalu kalibrasi bobot.
- [ ] Uji proxy sentimen dengan token X API asli.

**Kriteria diterima:**
- Alamat tidak valid dan alamat Solana menampilkan pesan error yang jelas.
- Kalau satu sumber data mati, laporan tetap muncul dan coverage-nya turun.
- Waktu scan kurang dari 10 detik pada koneksi normal.

---

## 8. Keterbatasan dan roadmap

| Prioritas | Item |
|---|---|
| P0 | Kalibrasi bobot memakai dataset token nyata di Robinhood Chain. |
| P0 | Pindahkan pemanggilan RPC ke backend (rate limit, API key, cache bersama). |
| P1 | **Simulasi jual sungguhan** (eth_call ke router Uniswap v4 dengan state override) untuk menggantikan heuristik "0 sells". |
| P1 | Analisis 20 pembeli **pertama** (paginasi transfer sampai awal), sesuai ARGUS. |
| P1 | Riwayat deployer: token lain yang pernah dibuat dan nasibnya (aturan `DEV_BAD_HISTORY` di ARGUS). |
| P2 | Database wallet bermasalah (`KNOWN_BAD_ACTORS` di ARGUS). |
| P2 | Cek peniru Stock Token terhadap daftar kontrak resmi Robinhood (`registry.ts` di ARGUS masih berisi alamat placeholder). |
| P2 | Deteksi kontrol akses berbasis role, bukan hanya `owner()`. |
| P3 | Halaman laporan yang bisa dibagikan (`/t/{address}`). |
