# Zapify

> **Read the contract. Read the room.**  
> Token risk scanner for Robinhood Chain mainnet (chain ID 4663).

One scan, two lenses — on-chain data and 𝕏 sentiment — every red flag explained.

---

## What it does

Paste a contract address → Zapify runs five checks in parallel:

| Module | Data source |
|---|---|
| Contract | Robinhood Chain RPC (bytecode, owner, proxy slot) |
| Explorer | Blockscout v2 API (holders, verification, creator) |
| Market | DexScreener (pools, liquidity, 24h trades, socials) |
| Buyer funding | Blockscout (traces up to 12 recent buyers to their funders) |
| Sentiment | 𝕏 API v2 via proxy worker (posts, tone, shill filter) |

Results are scored `0–100` using a weighted formula with hard gates, and given a verdict: **Low risk**, **Caution**, or **High risk**.

---

## Architecture

```
Browser (scan.html + /public/app.js)
  └─ POST /api/scan
       ├─ lib/contract.js    → Robinhood RPC (fallback: Blockscout eth-rpc)
       ├─ lib/blockscout.js  → Blockscout API v2
       ├─ lib/dexscreener.js → DexScreener
       ├─ lib/funding.js     → Blockscout (buyer funding graph)
       └─ lib/sentiment.js   → analyzePosts() on data from SENTIMENT_ENDPOINT
            ↑
            api/sentiment.js  → X API v2 (server-side, bearer token)
```

All modules run in parallel. A failed module degrades coverage but never prevents a result.

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/yourname/zapify.git
cd zapify
npm install
```

### 2. Environment variables

```bash
cp .env.example .env
# Fill in the values:
```

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | Optional | Scan history & wallet auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Supabase server-side key |
| `X_BEARER_TOKEN` | Optional | X API v2 bearer token for `GET /api/sentiment` |
| `SENTIMENT_ENDPOINT` | Optional | URL of the Cloudflare sentiment worker (or `/api/sentiment`) |
| `ALLOWED_ORIGIN` | Optional | CORS origin for sentiment proxy |
| `ROBINHOOD_RPC_URL` | Optional | Override RPC (default: public endpoint) |
| `BLOCKSCOUT_API_URL` | Optional | Override explorer API URL |

### 3. Dev server

```bash
npm run dev     # starts vercel dev on http://localhost:3000
```

---

## Sentiment proxy (X API)

Two options:

**Option A — Vercel function** (already included):  
Set `X_BEARER_TOKEN` in environment.  
Point `SENTIMENT_ENDPOINT=/api/sentiment` — note: the scanner calls this from the **backend** in `api/scan.js`.

**Option B — Cloudflare Worker** (lower latency, better caching):  
```bash
npx wrangler init zapify-sentiment
# paste x-sentiment-worker.js into src/index.js
npx wrangler secret put X_BEARER_TOKEN
npx wrangler deploy
# Set SENTIMENT_ENDPOINT to the deployed worker URL
```

> The X API `search/recent` endpoint requires the **Basic** paid plan ($100/mo).

---

## Scoring

```
score = round(100 × (1 − e^(−Σweight / 14)))
```

Hard-gate findings (⛔) force a minimum score of **80**.

| Verdict | Score range |
|---|---|
| Low risk | 0–29 |
| Caution | 30–59 |
| High risk | 60–100 |

30 risk codes are checked. See `DEV-BRIEF (1).md` §4 for the full weight table.

---

## Database (optional)

Run `sql/schema.sql` against your Supabase project to create the required tables:
- `scans` — one row per address
- `findings` — one row per finding per scan
- `wallet_nonces` — MetaMask SIWE nonces
- `wallets` — authenticated wallets
- `wallet_scans` — links wallets to their scan history

---

## Wallet auth (MetaMask)

1. `GET /api/wallet/nonce?address=0x…` → returns a one-time nonce (expires 5 min)
2. User signs: `"Sign in to Zapify\n\nNonce: {nonce}"` with MetaMask
3. `POST /api/wallet/verify` `{ address, signature }` → verifies and returns session token

---

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/scan` | POST | Main scanner. Body: `{ address: "0x…" }` |
| `/api/sentiment` | GET | X API proxy. Query: `?q=$TICKER` |
| `/api/history` | GET | Scan history. Query: `?wallet=0x…` |
| `/api/wallet/nonce` | GET | Request sign-in nonce. Query: `?address=0x…` |
| `/api/wallet/verify` | POST | Verify signature. Body: `{ address, signature }` |

---

## Tests

```bash
npm test
```

Tests cover: scoring formula, hard gates, verdict thresholds, subclass logic, address validation (5 scenarios), and sentiment analysis.

---

## Deployment

1. Push to GitHub and import into Vercel.
2. Add environment variables in Vercel dashboard.
3. For production, replace the public RPC with a paid provider (Alchemy, Infura, etc.) to avoid 429 errors.

---

## Limitations

- Selector scanning is heuristic — non-standard function names may be missed.
- Funding analysis uses the most **recent** 50 transfers (not the first 20 buyers as ARGUS does), since full pagination would be too slow.
- X sentiment requires a paid X API plan.

---

*Not financial advice. Always verify on-chain.*
