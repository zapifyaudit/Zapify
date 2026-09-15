import { probeContract } from '../lib/contract.js';
import { fetchExplorer } from '../lib/blockscout.js';
import { fetchMarket } from '../lib/dexscreener.js';
import { computeFlowFeatures } from '../lib/funding.js';
import { analyzePosts, buildSentimentQueries } from '../lib/sentiment.js';
import { computeScore, computeSubclass } from '../lib/scoring.js';
import { resolveAddressType, lc, DEAD, fmtUsd, pct, safeUrl } from '../lib/utils.js';
import { saveScanHistory } from '../lib/database.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address } = req.body || {};
  const addrType = resolveAddressType(address);
  if (addrType === 'solana') {
    return res.status(400).json({ error: 'That looks like a Solana address. Zapify only reads Robinhood Chain (0x addresses).' });
  }
  if (!address || addrType !== 'evm') {
    return res.status(400).json({ error: 'Invalid EVM address. It should be 0x followed by 40 hex characters.' });
  }

  const addr = lc(address);

  // Phase 1 — parallel: contract, explorer, market
  const [contractRes, explorerRes, marketRes] = await Promise.allSettled([
    probeContract(addr),
    fetchExplorer(addr),
    fetchMarket(addr)
  ]).then(rs => rs.map(r => r.status === 'fulfilled' ? r.value : null));

  if (!contractRes?.isContract) {
    return res.status(200).json({ success: false, error: 'No contract found at this address on Robinhood Chain.' });
  }

  // Phase 2 — parallel: funding + sentiment (need phase 1 data)
  const creator = explorerRes?.creator || null;
  const pairAddresses = marketRes?.pairAddresses || new Set();
  const transfers = explorerRes?.transfers || [];

  const [flowRes, sentimentRes] = await Promise.allSettled([
    computeFlowFeatures(transfers, pairAddresses, creator),
    fetchSentimentFromWorker(contractRes.symbol, addr)
  ]);

  const flowFeatures = flowRes.status === 'fulfilled' ? flowRes.value : null;
  const sentimentData = sentimentRes.status === 'fulfilled' ? sentimentRes.value : null;

  // Phase 3 — scoring & findings
  const findings = generateFindings(contractRes, explorerRes, marketRes, flowFeatures, sentimentData, addr);
  const score = computeScore(findings);
  const subclass = computeSubclass(flowFeatures);

  const coverage = {
    ok: [contractRes, explorerRes, marketRes, flowFeatures, sentimentData].filter(Boolean).length,
    total: 5
  };

  const report = {
    success: true,
    address: addr,
    scannedAt: new Date().toISOString(),
    token: {
      name: contractRes.name,
      symbol: contractRes.symbol,
      decimals: contractRes.decimals
    },
    coverage,
    modules: {
      contract: contractRes,
      explorer: explorerRes,
      market: marketRes,
      funding: flowFeatures,
      sentiment: sentimentData
    },
    score: { ...score, subclass },
    findings
  };

  // Fire-and-forget DB save
  saveScanHistory(report).catch(() => {});

  return res.status(200).json(report);
}

// ─── Sentiment proxy ──────────────────────────────────────────────────────────

async function fetchSentimentFromWorker(symbol, addr) {
  const endpoint = process.env.SENTIMENT_ENDPOINT;
  if (!endpoint) return null;

  const queries = buildSentimentQueries(symbol, addr);
  if (!queries.length) return null;

  const q = queries.map(x => x.q).join(' OR ');
  try {
    const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const json = await res.json();
    const posts = Array.isArray(json?.posts) ? json.posts : [];
    return analyzePosts(posts);
  } catch {
    return null;
  }
}

// ─── generateFindings — all 30 risk codes from §25 ───────────────────────────

function generateFindings(c, e, m, f, s, addr) {
  const findings = [];
  const EXPLORER = `https://robinhoodchain.blockscout.com`;
  const DEX = m?.dexUrl || `https://dexscreener.com/robinhood/${addr}`;

  const add = (code, sev, title, desc, srcUrl) =>
    findings.push({ code, severity: sev, title, description: desc,
      source_url: safeUrl(srcUrl) || `${EXPLORER}/address/${addr}` });

  // ── Contract checks ──────────────────────────────────────────────────────
  const ownerActive = !c.ownerRenounced && c.hasOwnerFn;

  if (c.has.mint && ownerActive)
    add('MINT_AUTHORITY', 'high', 'Owner can mint new tokens',
      'A mint function was found in the bytecode and ownership has not been renounced.',
      `${EXPLORER}/address/${addr}`);

  if (c.has.blacklist && ownerActive)
    add('BLACKLIST_FUNCTION', 'high', 'Blacklist function active',
      'The contract can block wallets from trading. Owner is still active.',
      `${EXPLORER}/address/${addr}`);

  if (c.has.feeSetter && ownerActive)
    add('MUTABLE_TAX', 'high', 'Tax can be changed by owner',
      'Fee-setter functions detected. Active ownership means taxes can be raised to 100%.',
      `${EXPLORER}/address/${addr}`);

  if (c.has.tradingSwitch && ownerActive)
    add('TRADING_SWITCH', 'medium', 'Trading can be disabled',
      'A function to enable/disable trading exists. Owner is active.',
      `${EXPLORER}/address/${addr}`);

  if (c.has.pause && ownerActive)
    add('PAUSABLE', 'medium', 'Contract can be paused',
      'A pause() function was found and ownership has not been renounced.',
      `${EXPLORER}/address/${addr}`);

  if (c.has.txLimit && ownerActive)
    add('TX_LIMITS', 'low', 'Max transaction limits can be set',
      'Functions that set per-wallet or per-tx limits exist. Owner is active.',
      `${EXPLORER}/address/${addr}`);

  if (c.proxyImpl)
    add('UPGRADEABLE_PROXY', 'high', 'Contract is upgradeable (proxy)',
      'An EIP-1967 implementation slot was detected. The contract logic can be replaced.',
      `${EXPLORER}/address/${addr}`);

  if (ownerActive)
    add('OWNER_ACTIVE', 'low', 'Ownership not renounced',
      `Owner is ${c.owner || 'unknown'}. They can call privileged functions.`,
      `${EXPLORER}/address/${c.owner || addr}`);

  // ── Verification ─────────────────────────────────────────────────────────
  if (e && e.verified === false)
    add('UNVERIFIED_SOURCE', 'medium', 'Source code is not verified',
      'The contract source has not been verified on Blockscout. You cannot read the code.',
      `${EXPLORER}/address/${addr}#code`);

  // ── Market checks ────────────────────────────────────────────────────────
  if (m) {
    if (!m.primary)
      add('NO_DEX_PAIR', 'high', 'No DEX pair on Robinhood Chain',
        'DexScreener found no trading pairs for this token on Robinhood Chain.',
        `https://dexscreener.com/robinhood/${addr}`);
    else {
      if (m.liquidityUsd < 1000)
        add('VERY_LOW_LIQUIDITY', 'high', 'Liquidity is extremely low (< $1K)',
          `Total liquidity: ${fmtUsd(m.liquidityUsd)}. This makes the token extremely easy to manipulate.`,
          DEX);
      else if (m.liquidityUsd < 10000)
        add('LOW_LIQUIDITY', 'medium', 'Liquidity is low (< $10K)',
          `Total liquidity: ${fmtUsd(m.liquidityUsd)}.`,
          DEX);

      const buys = m.txns24?.buys || 0;
      const sells = m.txns24?.sells || 0;

      if (buys >= 25 && sells === 0)
        add('NO_SELLS', 'high', 'Honeypot pattern: 0 sells in 24h',
          `${buys} buys but zero sell transactions in the last 24 hours.`,
          DEX);
      else if (buys >= 40 && sells > 0 && (sells / buys) < 0.05)
        add('SELLS_SUPPRESSED', 'high', 'Sells are heavily suppressed',
          `${buys} buys but only ${sells} sells (${pct(sells/buys)} ratio). Possible honeypot.`,
          DEX);

      // New pair
      if (m.pairCreatedAt) {
        const ageMs = Date.now() - m.pairCreatedAt;
        if (ageMs < 86_400_000)
          add('NEW_PAIR', 'low', 'Trading pair is less than 24 hours old',
            `Created ${Math.round(ageMs / 3_600_000)} hour(s) ago. Very early-stage token.`,
            DEX);
      }

      // No socials
      if ((!m.socials || m.socials.length === 0))
        add('NO_SOCIALS', 'low', 'No website or social links',
          'DexScreener shows no website, Twitter/X, or Telegram link for this token.',
          `https://dexscreener.com/robinhood/${addr}`);
    }
  }

  // ── Holder distribution ──────────────────────────────────────────────────
  if (e && e.holders && e.holders.length > 0 && c.totalSupply) {
    const EXPLORER_HOLDERS = `${EXPLORER}/token/${addr}/token-holders`;

    // Count holders (excluding dead + pools)
    const realHolders = e.holders.filter(h => {
      const ha = lc(h.address?.hash || '');
      return !DEAD.has(ha) && !h.address?.is_contract;
    });

    if (realHolders.length < 50)
      add('FEW_HOLDERS', 'low', 'Very few token holders',
        `Only ${realHolders.length} non-contract wallets hold this token.`,
        EXPLORER_HOLDERS);

    // Find top non-dead, non-pool holder
    const topHolder = e.holders.find(h => {
      const ha = lc(h.address?.hash || '');
      return !DEAD.has(ha) && !(m?.pairAddresses?.has(ha));
    });

    if (topHolder && c.totalSupply > 0n) {
      const val = BigInt(topHolder.value || '0');
      const shareFrac = Number(val * 10000n / c.totalSupply) / 10000;

      if (shareFrac > 0.5)
        add('WHALE_MAJORITY', 'high', 'One wallet holds majority of supply',
          `The largest holder owns ${pct(shareFrac)} of supply.`,
          `${EXPLORER}/address/${topHolder.address?.hash || addr}`);
      else if (shareFrac > 0.1)
        add('TOP_HOLDER_CONCENTRATION', 'medium', 'High top-holder concentration',
          `Largest non-pool wallet holds ${pct(shareFrac)}.`,
          EXPLORER_HOLDERS);
    }

    // Top-10 concentration (excluding dead/pools)
    const top10 = e.holders
      .filter(h => !DEAD.has(lc(h.address?.hash || '')) && !(m?.pairAddresses?.has(lc(h.address?.hash || ''))))
      .slice(0, 10);
    if (top10.length >= 3 && c.totalSupply > 0n) {
      const top10sum = top10.reduce((a, h) => a + BigInt(h.value || '0'), 0n);
      const top10frac = Number(top10sum * 10000n / c.totalSupply) / 10000;
      if (top10frac > 0.6)
        add('TOP10_CONCENTRATION', 'medium', 'Top 10 wallets hold > 60% of supply',
          `The 10 largest non-pool wallets collectively hold ${pct(top10frac)}.`,
          EXPLORER_HOLDERS);
    }
  }

  // ── Funding / cluster ────────────────────────────────────────────────────
  if (f) {
    const FUNDING_SRC = `${EXPLORER}/token/${addr}/token-transfers`;

    if (f.funding_parent_share >= 0.6)
      add('SHARED_FUNDING_PARENT', 'high', 'Most buyers share a single funding wallet',
        `${pct(f.funding_parent_share)} of recent buyers were funded from one wallet.`,
        FUNDING_SRC);

    if (f.deployer_funded >= 0.1)
      add('DEPLOYER_FUNDED_BUYERS', 'high', 'Deployer funded multiple buyers',
        `${pct(f.deployer_funded)} of sampled buyers received funds directly from the deployer.`,
        FUNDING_SRC);

    if (f.cluster_dominance >= 0.7)
      add('CLUSTER_DOMINANCE', 'high', 'Coordinated wallet cluster dominates buying',
        `${pct(f.cluster_dominance)} of buyers belong to coordinated clusters (≥2 buyers, same funder).`,
        FUNDING_SRC);
    else if (f.cluster_dominance >= 0.3)
      add('COORDINATED_BUYING', 'medium', 'Moderate buyer cluster detected',
        `${pct(f.cluster_dominance)} of buyers share funders — indicates coordinated entry.`,
        FUNDING_SRC);

    if (f.same_block_ratio >= 0.3 && (f.trades?.filter(t => t.side === 'buy').length ?? 0) >= 5)
      add('SAME_BLOCK_CONCENTRATION', 'medium', 'Many buys landed in a single block',
        `${pct(f.same_block_ratio)} of recent buys occurred in the same block — typical sniping pattern.`,
        FUNDING_SRC);

    if (f.size_cv !== null && f.size_cv <= 0.05 && (f.trades?.filter(t => t.side === 'buy').length ?? 0) >= 5)
      add('UNIFORM_BUY_SIZES', 'medium', 'Buy sizes are suspiciously uniform',
        `CV of buy amounts is ${f.size_cv.toFixed(3)} — bot-like uniformity across recent buys.`,
        FUNDING_SRC);

    if (f.fresh_wallet_ratio !== null && f.fresh_wallet_ratio >= 0.6)
      add('FRESH_WALLETS_RATIO', 'medium', '60%+ of buyers used fresh wallets',
        `${pct(f.fresh_wallet_ratio)} of sampled buyers had wallets less than 24 hours old when they bought.`,
        FUNDING_SRC);

    if (f.dev_sold && creator)
      add('DEV_SELLING', 'high', 'Deployer sold into the pool',
        'The contract creator made sell transactions into a liquidity pool.',
        `${EXPLORER}/address/${creator}`);
  }

  // ── Sentiment ────────────────────────────────────────────────────────────
  if (s) {
    const sym = (contractRes?.symbol || '').replace(/[^A-Za-z0-9_]/g, '');
    const xSearch = `https://x.com/search?q=${encodeURIComponent('$' + sym + ' OR ' + addr.slice(0, 10))}`;

    if (s.scamMentions >= 3)
      add('SCAM_MENTIONS_ON_X', 'high', 'Scam reports on 𝕏',
        `${s.scamMentions} posts explicitly mention rug/scam/honeypot (not preceded by a negator).`,
        safeUrl(xSearch) || `${EXPLORER}/address/${addr}`);

    if (s.posts >= 10 && s.dupRatio > 0.4)
      add('COPY_PASTE_SHILLING', 'medium', 'Copy-paste shilling on 𝕏',
        `${pct(s.dupRatio)} of analysed posts share near-identical text — coordinated shill campaign.`,
        safeUrl(xSearch) || `${EXPLORER}/address/${addr}`);

    if (s.posts >= 10 && s.score < -0.2)
      add('NEGATIVE_SENTIMENT', 'medium', 'Negative community sentiment on 𝕏',
        `Weighted tone score is ${s.score.toFixed(2)} (Bearish). Community warnings are prevalent.`,
        safeUrl(xSearch) || `${EXPLORER}/address/${addr}`);
  }

  return findings;
}
