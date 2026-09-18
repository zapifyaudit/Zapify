# Zapify — Project Report & Architecture Overview

**Versi:** 1.0  
**Jaringan:** Robinhood Chain Mainnet (Chain ID 4663)  
**Tagline:** *Read the contract. Read the room.*

---

## 1. Deskripsi Proyek

**Zapify** adalah platform *token risk scanner* yang dirancang khusus untuk trader di **Robinhood Chain mainnet (Chain ID 4663)**. Di pasar kripto yang bergerak cepat, trader ritel sering kali terjebak dalam 3 ancaman utama (*Fast chain. Faster traps*):
1. **Hidden Switches:** Kontrak pintar yang memiliki fungsi tersembunyi (minting tanpa batas, blacklist dompet, peningkatan pajak hingga 100%).
2. **Bundled / Clustered Buyers:** Pembeli awal yang didanai dari satu dompet sumber (*funding parent*) yang sama untuk menciptakan *fake volume* atau *insider cornering*.
3. **Manufactured Hype:** Kampanye *shill* copy-paste di media sosial 𝕏 (Twitter) oleh bot dengan pengikut sedikit.

Zapify menyelesaikan masalah ini dalam **satu kali scan** dengan menganalisis token dari dua lensa utama secara bersamaan: **On-Chain Data** dan **𝕏 (Twitter) Sentiment**.

---

## 2. Alur Kerja Aplikasi (App Flow)

```
[ Pengguna ] ── Paste CA (0x...) ──> [ scan.html / app.js ]
                                            │
                                  POST /api/scan (Parallel Execution)
                                            │
         ┌──────────────────┬───────────────┼───────────────┬──────────────────┐
         ▼                  ▼               ▼               ▼                  ▼
  [ Contract RPC ]   [ Explorer API ] [ DexScreener ] [ Funding Graph ] [ 𝕏 Sentiment ]
  - eth_getCode      - Blockscout v2  - Liquidity     - Trace 12 buyers - Lexicon score
  - eth_call         - Holders        - 24h Txns      - Funder cluster  - Spam filter
  - EIP-1967 proxy   - Verification   - Social links  - Same block buy  - Scam mention
  - Selector scan    - Creator        - Pair age      - Dev selling     - Engagement wt
         │                  │               │               │                  │
         └──────────────────┴───────────────┼───────────────┴──────────────────┘
                                            ▼
                               [ Scoring Engine (lib/scoring.js) ]
                               - Weight Sum: round(100 * (1 - e^(-Σw / 14)))
                               - Hard Gates Check (Score min 80)
                               - Subclass: Extraction / Coordinated / Organic
                                            │
                                  POST /api/scan Response
                                            │
                                            ▼
                               [ UI Render (public/app.js) ]
                               - Hero Summary & Risk Score
                               - Switchboard & Market Stats
                               - Holder Stack & Funding SVG Graph
                               - Tone Scale & Findings List
                               - Fire-and-forget Save to Supabase
```

---

## 3. Komponen Utama & Teknologi

| Layer | Teknologi | Deskripsi |
|---|---|---|
| **Frontend** | HTML5, CSS3 (Archivo font, CSS Custom Properties), Native JS (ES6+) | Tanpa framework berat, super cepat, aksesibel (`aria-live`, `prefers-reduced-motion`). |
| **Serverless API** | Vercel Serverless Functions (Node.js) | Endpoint `/api/scan`, `/api/sentiment`, `/api/history`, `/api/wallet/nonce`, `/api/wallet/verify`. |
| **Blockchain Client** | Ethers.js v6 & JSON-RPC | Terkoneksi ke RPC Robinhood Chain (`chain_id=4663`) dan Blockscout v2 API. |
| **Database** | Supabase (PostgreSQL) | Menyimpan riwayat scan (`scans`), temuan (`findings`), dan autentikasi dompet SIWE (`wallets`, `wallet_nonces`). |
| **Analisis 𝕏** | X API v2 Proxy (Vercel / Cloudflare Worker) | Algoritma skoring Leksikon Kripto dengan penalti negasi dan duplikasi teks. |

---

## 4. Matriks Aturan Skoring (31 Risk Codes)

Skor dihitung dari akumulasi bobot temuan risiko dengan rumus:
$$\text{Skor} = \text{round}\left(100 \times \left(1 - e^{-\frac{\Sigma \text{bobot}}{14}}\right)\right)$$

Setiap **Hard Gate (⛔)** yang terpicu akan memaksa skor minimum menjadi **80 (High Risk)**.

| Kode Risiko | Bobot | Severity | Kategori | Kondisi Pemicu |
|---|---|---|---|---|
| `NO_SELLS` ⛔ | 10 | High | Market | 24 jam transaksi: Buys ≥ 25 dan Sells = 0 (Honeypot) |
| `WHALE_MAJORITY` ⛔ | 8 | High | Holder | Dompet non-pool terbesar memegang > 50% supply |
| `NO_DEX_PAIR` | 6 | High | Market | Tidak ditemukan trading pair di Robinhood DEX |
| `VERY_LOW_LIQUIDITY` | 6 | High | Market | Likuiditas total < $1,000 USD |
| `MINT_AUTHORITY` 5 | 5 | High | Contract | Fungsi minting terdeteksi dan Owner masih aktif |
| `BLACKLIST_FUNCTION` | 5 | High | Contract | Fungsi blacklist terdeteksi dan Owner masih aktif |
| `SELLS_SUPPRESSED` | 5 | High | Market | Buys ≥ 40 dan rasio sell/buy < 5% |
| `SHARED_FUNDING_PARENT` | 5 | High | Funding | ≥ 60% pembeli sampel berasal dari 1 *funder* |
| `DEPLOYER_FUNDED_BUYERS` | 5 | High | Funding | ≥ 10% pembeli didanai langsung oleh deployer |
| `CLUSTER_DOMINANCE` | 5 | High | Funding | Cluster dompet terkoordinasi memegang ≥ 70% pembeli |
| `SCAM_MENTIONS_ON_X` | 5 | High | Sentiment | ≥ 3 postingan di 𝕏 menyebut rug/scam/honeypot |
| `UPGRADEABLE_PROXY` | 4 | High | Contract | Menggunakan EIP-1967 Proxy (kontrak bisa diubah) |
| `MUTABLE_TAX` | 4 | High | Contract | Fungsi ubah pajak terdeteksi dan Owner aktif |
| `DEV_SELLING` | 4 | High | Funding | Deployer melakukan transaksi sell ke pool |
| `UNVERIFIED_SOURCE` | 4 | Medium | Contract | Source code tidak terverifikasi di Blockscout |
| `TOP_HOLDER_CONCENTRATION` | 4 | Medium | Holder | Dompet terbesar memegang > 10% supply |
| `TRADING_SWITCH` | 3 | Medium | Contract | Fungsi matikan trading terdeteksi & Owner aktif |
| `LOW_LIQUIDITY` | 3 | Medium | Market | Likuiditas < $10,000 USD |
| `TOP10_CONCENTRATION` | 3 | Medium | Holder | Top 10 dompet non-pool memegang > 60% supply |
| `SAME_BLOCK_CONCENTRATION` | 3 | Medium | Funding | ≥ 30% buy terjadi dalam 1 block yang sama |
| `UNIFORM_BUY_SIZES` | 3 | Medium | Funding | Koefisien variasi (CV) ukuran buy ≤ 0.05 |
| `NEGATIVE_SENTIMENT` | 3 | Medium | Sentiment | ≥ 10 post di 𝕏 dengan skor nada < -0.2 |
| `COPY_PASTE_SHILLING` | 3 | Medium | Sentiment | ≥ 10 post dengan tingkat duplikasi teks > 40% |
| `PAUSABLE` | 2 | Medium | Contract | Fungsi pause terdeteksi dan Owner aktif |
| `FRESH_WALLETS_RATIO` | 2 | Medium | Funding | ≥ 60% pembeli menggunakan dompet < 24 jam |
| `COORDINATED_BUYING` | 2 | Medium | Funding | Cluster dompet 30%–69% |
| `OWNER_ACTIVE` | 2 | Low | Contract | Ownership belum di-renounce |
| `FEW_HOLDERS` | 2 | Low | Holder | Jumlah holder non-pool < 50 dompet |
| `NO_SOCIALS` | 2 | Low | Market | Tidak ada tautan website/Twitter di DexScreener |
| `TX_LIMITS` | 1 | Low | Contract | Batas transaksi per dompet bisa diubah |
| `NEW_PAIR` | 1 | Low | Market | Umur pair DEX < 24 jam |

---

## 5. Klasifikasi Subclass Token

1. **Extraction:** `funding_parent_share >= 60%` atau `cluster_dominance >= 70%` (Pola ekstraksi likuiditas cepat).
2. **Coordinated:** `funding_parent_share >= 20%` atau `cluster_dominance >= 30%` (Pembelian terkoordinasi kelompok).
3. **Organic:** Selain dua kondisi di atas (Sebaran pembeli alami).
