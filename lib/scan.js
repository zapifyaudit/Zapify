import { probeContract } from '../lib/contract.js';
import { fetchExplorer, traceFunding, isHubAddress } from '../lib/blockscout.js';
import { fetchMarket } from '../lib/dexscreener.js';
import { computeFlowFeatures } from '../lib/funding.js';
import { analyzePosts, buildSentimentQueries } from '../lib/sentiment.js';
import { computeScore, computeSubclass } from '../lib/scoring.js';
import { resolveAddressType, lc, DEAD, fmtUsd, pct, safeUrl } from '../lib/utils.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address } = req.body;
  if (!address || resolveAddressType(address) !== 'evm') {
    return res.status(400).json({ error: 'Invalid EVM address' });
  }

  const addr = lc(address);
  const results = await Promise.allSettled([
    probeContract(addr),
    fetchExplorer(addr),
    fetchMarket(addr)
  ]);

  const [contractRes, explorerRes, marketRes] = results.map(r => r.status === 'fulfilled' ? r.value : null);
  const contractErr = results[0].status === 'rejected' ? results[0].reason : null;

  if (!contractRes?.isContract) {
    return res.status(200).json({ success: false, error: "No contract found at this address." });
  }

  // Step 2: Funding & Sentiment (Dependent on initial data)
  const creator = explorerRes?.creator;
  const pairAddresses = marketRes?.pairAddresses || new Set();
  const transfers = explorerRes?.transfers || [];
  
  const [flowRes, sentimentRes] = await Promise.allSettled([
    computeFlowFeatures(transfers, pairAddresses, creator),
    fetchSentimentProxy(contractRes.symbol, addr) // Internal helper
  ]);

  const flowFeatures = flowRes.status === 'fulfilled' ? flowRes.value : null;
  const sentimentData = sentimentRes.status === 'fulfilled' ? sentimentRes.value : null;

  // Scoring & Findings Generation
  const findings = generateFindings(contractRes, explorerRes, marketRes, flowFeatures, sentimentData);
  const score = computeScore(findings);
  const subclass = computeSubclass(flowFeatures);

  const coverage = {
    ok: [contractRes, explorerRes, marketRes, flowFeatures, sentimentData].filter(Boolean).length,
    total: 5
  };

  const report = {
    success: true,
    address: addr,
    token: { name: contractRes.name, symbol: contractRes.symbol, decimals: contractRes.decimals },
    coverage,
    modules: { contract: contractRes, explorer: explorerRes, market: marketRes, funding: flowFeatures, sentiment: sentimentData },
    score: { ...score, subclass },
    findings
  };

  // Save to DB (fire and forget)
  saveScanHistory(report).catch(() => {});

  return res.status(200).json(report);
}

async function fetchSentimentProxy(symbol, addr) {
  // Since X API needs backend token, we simulate the worker call or call X API directly here.
  // For this example, we return null to indicate it's not configured or unavailable,
  // allowing the UI to fallback to search links.
  return null; 
}

function generateFindings(c, e, m, f, s) {
  const findings = [];
  const add = (code, sev, title, desc, src) => findings.push({ code, severity: sev, title, description: desc, source_url: src });

  // Contract
  if (c.has.mint && !c.ownerRenounced) add('MINT_AUTHORITY', 'high', 'Owner can mint new tokens', 'Mint function found and owner is active.', '#');
  if (c.has.blacklist && !c.ownerRenounced) add('BLACKLIST_FUNCTION', 'high', 'Blacklist function active', 'Owner can blacklist wallets.', '#');
  if (c.has.feeSetter && !c.ownerRenounced) add('MUTABLE_TAX', 'high', 'Tax can be changed', 'Owner can alter fees.', '#');
  if (c.proxyImpl) add('UPGRADEABLE_PROXY', 'high', 'Contract is upgradeable', 'Logic can be replaced.', '#');
  if (!c.ownerRenounced && c.hasOwnerFn) add('OWNER_ACTIVE', 'low', 'Ownership not renounced', 'Owner can change contract state.', '#');

  // Market
  if (m) {
    if (!m.primary) add('NO_DEX_PAIR', 'high', 'No DEX pair found', 'Token is not traded on Robinhood DEXes.', '#');
    if (m.liquidityUsd < 1000) add('VERY_LOW_LIQUIDITY', 'high', 'Liquidity is extremely low', `< $1K liquidity.`, '#');
    else if (m.liquidityUsd < 10000) add('LOW_LIQUIDITY', 'medium', 'Liquidity is low', `< $10K liquidity.`, '#');
    // Simplified buy/sell check
    const buys = m.txns24?.buys || 0;
    const sells = m.txns24?.sells || 0;
    if (buys >= 25 && sells === 0) add('NO_SELLS', 'high', 'Honeypot pattern: 0 sells', `${buys} buys but 0 sells.`, '#');
  }

  // Holders
  if (e && e.holders.length > 0 && c.totalSupply) {
    const topHolder = e.holders.find(h => !DEAD.has(lc(h.address?.hash))); // simplified
    if (topHolder) {
      const share = Number(BigInt(topHolder.value) * 100n / c.totalSupply) / 100;
      if (share > 50) add('WHALE_MAJORITY', 'high', 'Whale dominance', `Top wallet holds ${pct(share/100)}.`, '#');
      else if (share > 10) add('TOP_HOLDER_CONCENTRATION', 'medium', 'High top holder concentration', `Top wallet holds ${pct(share/100)}.`, '#');
    }
  }

  // Funding
  if (f) {
    if (f.funding_parent_share >= 0.6) add('SHARED_FUNDING_PARENT', 'high', 'Shared funding wallet', `${pct(f.funding_parent_share)} of buyers share funder.`, '#');
    if (f.deployer_funded >= 0.1) add('DEPLOYER_FUNDED_BUYERS', 'high', 'Deployer funded buyers', `${pct(f.deployer_funded)} funded by deployer.`, '#');
    if (f.cluster_dominance >= 0.7) add('CLUSTER_DOMINANCE', 'high', 'Wallet cluster dominance', `${pct(f.cluster_dominance)} clustered.`, '#');
    if (f.same_block_ratio >= 0.3) add('SAME_BLOCK_CONCENTRATION', 'medium', 'Same block buying', `${pct(f.same_block_ratio)} in one block.`, '#');
    if (f.dev_sold) add('DEV_SELLING', 'high', 'Deployer selling', 'Deployer sold into pool.', '#');
  }

  // Sentiment
  if (s) {
    if (s.scamMentions >= 3) add('SCAM_MENTIONS_ON_X', 'high', 'Scam reports on 𝕏', `${s.scamMentions} posts mention rug/scam.`, '#');
    if (s.dupRatio > 0.4 && s.posts >= 10) add('COPY_PASTE_SHILLING', 'medium', 'Copy-paste shilling', `${pct(s.dupRatio)} duplicated text.`, '#');
    if (s.score < -0.2 && s.posts >= 10) add('NEGATIVE_SENTIMENT', 'medium', 'Negative sentiment', 'Community tone is bearish/warning.', '#');
  }

  return findings;
}

async function saveScanHistory(report) {
  // Implementation using Supabase client omitted for brevity
  // Insert into 'scans' and 'findings' tables
}