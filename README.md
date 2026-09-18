<div align="center">

<img src="./public/logo.png" width="130" height="130" alt="Zapify Logo" />

# ZAPIFY

**Dual-Engine Token Security & Social Sentiment Intelligence on Robinhood Chain**

🌐 **Live Application:** [https://zapify-beta.vercel.app](https://zapify-beta.vercel.app)

*Read the contract. Read the room. Audit the bytecode. Award the verdict.*

[![Live Site](https://img.shields.io/badge/Website-zapify--beta.vercel.app-CCFF00?style=flat-square&logo=googlechrome&logoColor=0D0D0A&labelColor=0D0D0A)](https://zapify-beta.vercel.app)
[![Network](https://img.shields.io/badge/Network-Robinhood%20Chain%20·%204663-1A9E4B?style=flat-square&labelColor=0D0D0A)](#-architecture--telemetry-pipeline)
[![Standard](https://img.shields.io/badge/Standard-ERC--20%20·%20Bytecode%20Heuristics-38C172?style=flat-square&labelColor=0D0D0A)](#-what-we-check-the-5-audit-vectors)
[![Runtime](https://img.shields.io/badge/Runtime-Node.js%20·%20Vercel%20Serverless%20·%20Ethers.js%20v6-E9E4D6?style=flat-square&labelColor=0D0D0A)](#-tech-stack)
[![Design](https://img.shields.io/badge/Design-Neo--Brutalist%20Cyberpunk%20·%20Motion%20Spring-CCFF00?style=flat-square&logoColor=0D0D0A&labelColor=0D0D0A)](#-frontend-features--motion-system)
[![Rubric](https://img.shields.io/badge/Scoring-Asymptotic%20Formula%20·%20Hard%20Gates-E0A82E?style=flat-square&labelColor=0D0D0A)](#-the-zapify-risk-scoring-rubric)
[![Tests](https://img.shields.io/badge/Tests-Passing%20(100%25)-38C172?style=flat-square&labelColor=0D0D0A)](#-test-suite)
[![GitHub](https://img.shields.io/badge/GitHub-zapifyaudit%2FZapify-181717?style=flat-square&logo=github&logoColor=white)](https://github.com/zapifyaudit/Zapify)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square&labelColor=0D0D0A)](#-license)

</div>

---

**Zapify** ([zapify-beta.vercel.app](https://zapify-beta.vercel.app)) is an institutional-grade token risk scanner, bytecode security auditor, and real-time social room sentiment intelligence engine built specifically for tokens launched on the **Robinhood Chain** mainnet (Chain ID `4663`).

**Read the contract. Read the room.** Zapify addresses the dual nature of crypto traps: code-level honeypots and social-level coordinated manipulation. By evaluating deterministic on-chain contract bytecode in parallel with live off-chain social sentiment on 𝕏, Zapify provides traders, capital allocators, and researchers with an objective second opinion within seconds.

---

## 🏛️ Core Value Proposition

In high-velocity blockchain ecosystems like Robinhood Chain, new tokens launch and move within minutes. Traders face severe information asymmetry:
* **The Chart Fallacy:** DexScreener charts show price green candles while the underlying contract contains a hidden mint function or blacklist freeze.
* **The Social Echo Chamber:** Coordinated bot swarms on 𝕏 fabricate organic hype around a token whose dev-funded Sybil cluster holds 70% of the circulating supply.
* **Siloed Tools:** Existing tools force traders to open 4 tabs (an explorer, a chart, a scanner, and Twitter) while the rug occurs in block time.

Zapify unifies security diagnostics into one authoritative terminal:

* **Dual-Lens Verification:** Code reality vs. social perception evaluated simultaneously in a single scan.
* **Deep Bytecode & Selector Heuristics:** Direct RPC query auditing owner capabilities, proxy delegate calls, mint functions, fee manipulators, and trading halts.
* **Algorithmic Sybil & Buyer Funding Graph:** Tracing recent token buyers backwards through Blockscout v2 to detect coordinated wallet rings funded by the same origin account.
* **Asymptotic Mathematical Scoring with Hard-Gates:** Non-linear risk scoring formula with ⛔ hard-gate penalties that force a minimum score of 80 (High Risk) on critical traps regardless of passing checks.
* **Zero Hype Manipulation:** Sentiment never lowers a risk score — organic hype validates interest, but bad code always fails.

---

## 🔍 What We Check: The 5 Audit Vectors

Paste any Robinhood Chain contract address (`0x…`) and Zapify executes five parallel diagnostic modules:

| Audit Module | Telemetry Source | Risk Vectors Checked |
|---|---|---|
| **1. Contract Bytecode** | Robinhood Chain RPC (`eth_call`, `eth_getCode`) | Heuristic selector scans: `mint()`, `setFee()`, `blacklist()`, `pause()`, owner privileges, proxy storage slots (`EIP-1967`), open mintable supply, self-destruct patterns. |
| **2. Explorer Verification** | Blockscout v2 REST API | Source code verification status, compiler version, optimization runs, creator address, total token holders, top 10 holder concentration percentage. |
| **3. Market & Liquidity** | DexScreener Public API | Active liquidity pools, pair creation age, base/quote token reserves, 24h volume, tx buy/sell count, liquidity-to-FDV ratio. |
| **4. Buyer Funding Graph** | Blockscout Internal & ERC-20 Transfers | Recent 12 buyers traced to origin funders, cluster identification, shared dev funding sources, coordinated sniper rings. |
| **5. 𝕏 Social Sentiment** | 𝕏 API v2 via Proxy Worker | Recent ticker posts, positive vs negative keyword ratio, bot shill repetition filters, influencer account authority. |

---

## 🔑 The Zapify Risk Scoring Rubric

Token risk is quantified on an asymptotic scale from **0 to 100** using a non-linear exponential saturation formula:

$$\text{Score} = \text{round}\left(100 \times \left(1 - e^{-\frac{\sum \text{weight}}{14}}\right)\right)$$

Where:
* $\sum \text{weight}$ is the aggregate sum of penalty weights triggered by active risk findings.
* The divisor constant ($14$) ensures a balanced, mathematically sound curvature: minor issues accumulate moderately, while multiple red flags trigger exponential escalation.

### ⛔ Hard-Gate Gating Mechanism

Critical high-danger traps bypass normal weight accumulation and **force a minimum risk score of 80**:

$$\text{If any finding is flagged with ⛔ Hard Gate} \implies \text{Score} = \max(\text{calculated\_score}, 80)$$

Hard-gate conditions include:
- `UNVERIFIED_CONTRACT` (Source code not published on Blockscout)
- `MINTABLE_TOKEN` (Owner or contract retains unconstrained minting privileges)
- `BLACKLIST_DETECTED` (Contract has selective transfer blocking / honeypot mechanism)
- `CREATOR_HOLDS_EXCESSIVE` (Deployer holds $>50\%$ of token supply)
- `ZERO_LIQUIDITY` (No accessible DEX liquidity pool exists)

### Score Verdict Distribution

```
Score:  0 – 29   ──►  🟢  LOW RISK   (Clean contract bytecode, dispersed holders, verified source)
Score: 30 – 59   ──►  🟡  CAUTION    (Concentrated holders, new pool, unrenounced owner, or low liquidity)
Score: 60 – 100  ──►  🔴  HIGH RISK   (Bytecode traps, honeypot risk, Sybil clusters, or unverified source)
```

---

## 🖥️ Application Features & Architecture

The application at [zapify-beta.vercel.app](https://zapify-beta.vercel.app) is engineered as a zero-latency, high-performance single-page web terminal:

1. **Cyberpunk Command Center (`#scan`):**
   - Instant single-line contract input with checksum validation and quick-paste button.
   - Sample token quick-chips to benchmark verified tokens vs known honeypot structures.
   - Network status pill with live neon lime pulse pinging Robinhood Chain RPC (Chain ID `4663`).

2. **Live Telemetry Pipeline & Sonar Radar:**
   - Visual 5-step diagnostic runner displaying real-time inspection states.
   - Active scanning beam and animated radar scanner pulse.

3. **Dynamic Verdict Deck & Risk Radar:**
   - Gigantic numeric score counter with dynamic color-coded ambient aura (`on-low`, `on-med`, `on-high`).
   - Risk breakdown bar visualizing contribution weights across Contract, Liquidity, Holders, Network, and Social vectors.
   - Mathematical formula explanation dynamically rendered with active weights.

4. **Interactive Findings Register:**
   - Pill filter controls (`All`, `High`, `Medium`, `Low`, `Passed`).
   - Detailed finding cards with severity badges, technical explanations, and mitigation context.

5. **Direct On-Chain Evidence Dock (`#evidence`):**
   - Direct clickable deep-links to the token on **Blockscout**, the liquidity pool on **DexScreener**, and the live search query on **𝕏**.

6. **Neo-Brutalist Micro-Interactions & Motion System:**
   - Spring physics curves (`cubic-bezier(0.16, 1, 0.3, 1)`) on interactive components.
   - Ambient floating gradient orbs in dark and light sections.
   - 3D hover-lift physics on cards, step counters, and data links.
   - Smooth SVG accordion animation with 45° rotating indicator pills.

---

## 🏗️ Architecture & Telemetry Pipeline

```
Browser Client (index.html / public/app.js)
  │
  ├─► POST /api/scan { address: "0x..." }
  │     │
  │     ├── [Parallel Dispatch]
  │     │     ├─► lib/contract.js     ──► Robinhood Chain RPC (eth_call, bytecode)
  │     │     ├─► lib/blockscout.js    ──► Blockscout API v2 (verification, holders)
  │     │     ├─► lib/dexscreener.js   ──► DexScreener API (pairs, liquidity, volume)
  │     │     ├─► lib/funding.js       ──► Blockscout Transfer Graph (Sybil clusters)
  │     │     └─► lib/sentiment.js     ──► 𝕏 API Proxy (posts, shill ratio)
  │     │
  │     ├── lib/scoring.js             ──► Asymptotic formula + Hard-gate evaluation
  │     └── Return JSON Payload        ──► Complete unified scan report
  │
  ├─► GET /api/sentiment?q=$TICKER     ──► 𝕏 API v2 Search Proxy
  ├─► GET /api/history?wallet=0x...    ──► Supabase Scan History
  └─► POST /api/wallet/verify          ──► SIWE MetaMask Wallet Authentication
```

*Fault-tolerant design: If one telemetry source experiences latency or rate limiting, the engine gracefully degrades that module's coverage without blocking the remaining audit vectors.*

---

## 📁 Repository Structure

```
├── api/                        # Vercel Serverless Function Endpoints
│   ├── wallet/
│   │   ├── nonce.js            # SIWE one-time cryptographic nonce generator
│   │   └── verify.js           # EIP-191 signature verifier & session issuer
│   ├── explorer.js             # Blockscout RPC & API relay
│   ├── history.js              # Historical scan query resolver
│   ├── scan.js                 # Primary unified scan orchestrator
│   └── sentiment.js            # 𝕏 API v2 proxy endpoint
├── lib/                        # Core Audit & Diagnostic Engines
│   ├── blockscout.js           # Explorer verification & token holder extractor
│   ├── config.js               # Network constants, RPC URLs & environment variables
│   ├── contract.js             # Bytecode heuristic scanner & selector analyzers
│   ├── database.js             # Supabase client wrapper & query helpers
│   ├── dexscreener.js          # DEX pool discovery & liquidity analytics
│   ├── funding.js              # Reverse buyer funding graph & Sybil cluster tracer
│   ├── robinhood.js            # Chain RPC provider & fallback connections
│   ├── scan.js                 # Multi-engine coordinator & aggregator
│   ├── scoring.js              # Mathematical scoring formula & hard-gate rules
│   ├── sentiment.js            # Natural language processing for 𝕏 posts & sentiment
│   ├── utils.js                # Formatting, address normalization & error handlers
│   └── validation.js           # EVM address checksum & zero-address validator
├── public/                     # Static Web Assets (Public Distribution)
│   ├── app.js                  # Client application logic & DOM state machine
│   ├── index.html              # Unified Single-Page Application
│   ├── scan.html               # Dedicated scanner console fallback
│   ├── logo.png                # Cyberpunk hexagon lightning brand asset (1024x1024)
│   ├── favicon.ico             # Multi-resolution browser tab icon (16, 32, 48px)
│   ├── favicon.png             # Modern 32x32 PNG favicon
│   └── apple-touch-icon.png    # Mobile home screen bookmark icon (180x180)
├── sql/                        # Relational Database Schemas
│   └── schema.sql              # Supabase PostgreSQL schema for scans, findings & wallets
├── tests/                      # Automated Unit & Integration Test Suite
│   ├── scoring.test.js         # Formula curvature, weights & hard-gate assertions
│   ├── sentiment.test.js       # Shill filter & keyword sentiment classification tests
│   └── validation.test.js      # 5-scenario EVM address validator tests
├── index.html                  # Root landing & scanner application entry point
├── scan.html                   # Root standalone scanner entry point
├── logo.png                    # High-res root brand asset
├── package.json                # Project dependencies, scripts & metadata
├── vercel.json                 # Serverless function execution limits & route rewrites
└── README.md                   # Comprehensive project documentation
```

---

## 💻 Tech Stack

### Frontend & UI
- **Architecture:** Single-Page Vanilla JavaScript (ES Modules) with Zero Build Bloat.
- **Design System:** Custom Neo-Brutalist Cyberpunk Design Tokens (Archivo font, High-contrast Ink `#0D0D0A`, Cyber Neon Lime `#CCFF00`, Danger Crimson `#C8102E`).
- **Motion & Physics:** Hardware-accelerated CSS animations (`@keyframes`), custom cubic-bezier spring curves (`cubic-bezier(0.16, 1, 0.3, 1)`), staggered scroll reveal triggers, and interactive hover transformations.
- **Branding Assets:** Precision-engineered hexagonal cyberpunk lightning badge with responsive SVGs and multi-density favicons.

### Backend & Serverless
- **Runtime:** Node.js (v18+) ES Modules.
- **Hosting / Compute:** Vercel Serverless Edge Functions (`maxDuration: 15s`).
- **Web3 / RPC:** [Ethers.js v6](https://docs.ethers.org/v6/) for bytecode extraction and RPC interactions.
- **Database:** Supabase (PostgreSQL) with Row-Level Security (RLS) for scan history and wallet nonces.
- **External APIs:** Blockscout v2 REST API, DexScreener Public API, 𝕏 API v2 (via proxy).

### Quality & Testing
- **Test Runner:** Native Node.js Test Assertion Suite.
- **Coverage:** Address validation edge cases, mathematical scoring thresholds, hard-gate activations, and sentiment scoring accuracy.

---

## ⚙️ Getting Started

### Prerequisites
- **Node.js:** v18.0.0 or higher
- **Git:** Installed and configured
- **Package Manager:** npm or yarn

### Quick Start

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/zapifyaudit/Zapify.git
   cd Zapify
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the project root:

   Configure the desired services:
   ```env
   # Core RPC & Explorer (Defaults are pre-configured for Robinhood Chain)
   ROBINHOOD_RPC_URL="https://rpc.robinhoodchain.com"
   BLOCKSCOUT_API_URL="https://robinhoodchain.blockscout.com/api/v2"

   # Social Sentiment (Optional - required for live X scanning)
   X_BEARER_TOKEN="your-x-api-bearer-token"
   SENTIMENT_ENDPOINT="/api/sentiment"

   # Supabase Database (Optional - required for saving scan history)
   SUPABASE_URL="https://your-project.supabase.co"
   SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-role-key"
   ```

4. **Run the Test Suite:**
   ```bash
   npm test
   ```
   *Executes address validation tests, scoring engine calculations, and sentiment analyzers.*

5. **Start Local Development:**
   ```bash
   # Using Vercel CLI (recommended for serverless API emulation)
   npx vercel dev
   
   # Or serve static assets locally
   npx serve .
   ```
   Open `http://localhost:3000` in your browser.

---

## 📡 API Endpoints

Zapify exposes clean, headless serverless endpoints for programmatic risk analysis:

### 1. Execute Contract Risk Scan
```http
POST /api/scan
Content-Type: application/json

{
  "address": "0x0000000000000000000000000000000000000000"
}
```
**Sample Response:**
```json
{
  "address": "0x...",
  "score": 14,
  "verdict": "Low risk",
  "hardGate": false,
  "coverage": "5/5",
  "token": {
    "name": "Standard Token",
    "symbol": "STD",
    "decimals": 18,
    "totalSupply": "1000000000000000000000000"
  },
  "findings": [
    {
      "code": "OWNER_RENOUNCED",
      "severity": "pass",
      "title": "Ownership renounced",
      "detail": "Contract owner is set to zero address."
    }
  ],
  "breakdown": {
    "contract": 0,
    "liquidity": 5,
    "holders": 0,
    "network": 0,
    "sentiment": 0
  }
}
```

### 2. Live Social Sentiment
```http
GET /api/sentiment?q=$STD
```

### 3. Scan History
```http
GET /api/history?wallet=0x...
```

---

## 🛡️ Embeddable Shield Badges

Token developers and communities can display their real-time Zapify security verdict badge directly in their project `README.md`:

```markdown
<!-- Replace with your token's contract address -->
[![Zapify Security Audit](https://img.shields.io/badge/Zapify-Verified%20Clean-CCFF00?style=flat-square&logo=shield&labelColor=0D0D0A)](https://zapify-beta.vercel.app/#0xYOUR_CONTRACT_ADDRESS)
```

---

## 📄 License & Disclaimer

### Disclaimer
**Not financial advice.** Zapify is an algorithmic security screening and social analysis tool. Token ownership, creator wallets, liquidity locks, and market behavior can change at any time after an audit is generated. Always perform independent verification and inspect contracts on-chain before committing capital.

### License
Distributed under the **MIT License**. See `LICENSE` for more information.

---

<div align="center">
Built for the <b>Robinhood Chain</b> Ecosystem • © 2026 Zapify
</div>
