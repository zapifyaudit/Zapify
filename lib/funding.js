import { traceFunding, isHubAddress } from './blockscout.js';
import { DEAD, lc } from './utils.js';
import { CONFIG } from './config.js';

function stdDev(arr) {
  if (!arr.length) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}

function extractTrades(transfers, pairAddresses) {
  const isMarket = (party, addr) => pairAddresses.has(addr) || party?.is_contract === true;
  const trades = [];
  for (const t of transfers) {
    const from = lc(t.from?.hash), to = lc(t.to?.hash);
    const dec = parseInt(t.total?.decimals ?? t.token?.decimals ?? 18, 10);
    const amount = Number(t.total?.value || 0) / 10 ** dec;
    const base = { amount, block: t.block_number ?? t.block, ts: t.timestamp ? Date.parse(t.timestamp) : null, tx: t.transaction_hash || t.tx_hash };
    if (isMarket(t.from, from) && !isMarket(t.to, to) && !DEAD.has(to)) trades.push({ ...base, side: 'buy', trader: to });
    else if (!isMarket(t.from, from) && isMarket(t.to, to) && !DEAD.has(from)) trades.push({ ...base, side: 'sell', trader: from });
  }
  return trades.reverse();
}

export async function computeFlowFeatures(transfers, pairAddresses, creator) {
  const trades = extractTrades(transfers, pairAddresses);
  const buys = trades.filter(t => t.side === 'buy');
  const buyers = [...new Map(buys.map(b => [b.trader, b])).values()].slice(0, CONFIG.maxFundingLookups);
  
  if (buyers.length < 3) return null;

  const funding = {};
  await Promise.all(buyers.map(async b => { funding[b.trader] = await traceFunding(b.trader); }));

  const groups = {};
  for (const b of buyers) {
    const f = funding[b.trader];
    if (f?.funder && !f.funderIsContract) (groups[f.funder] ||= []).push(b.trader);
  }

  for (const parent of Object.keys(groups)) {
    if (groups[parent].length >= 2 && parent !== creator && await isHubAddress(parent)) {
      delete groups[parent];
    }
  }

  const n = buyers.length;
  const maxGroup = Math.max(0, ...Object.values(groups).map(g => g.length));
  const clustered = Object.values(groups).filter(g => g.length >= 2).reduce((s, g) => s + g.length, 0);
  const deployerFunded = creator ? buyers.filter(b => funding[b.trader]?.funder === creator).length : 0;

  let fresh = 0, freshKnown = 0;
  for (const b of buyers) {
    const f = funding[b.trader];
    if (!f) continue;
    freshKnown++;
    if (!f.manyTx && f.oldTimestamp && b.ts && b.ts - f.oldTimestamp < 86_400_000 && b.ts - f.oldTimestamp >= 0) fresh++;
  }

  const perBlock = {};
  for (const b of buys) perBlock[b.block] = (perBlock[b.block] || 0) + 1;
  const sizes = buys.map(b => b.amount).filter(x => x > 0);
  const mean = sizes.reduce((a, b) => a + b, 0) / (sizes.length || 1);

  return {
    trades,
    buyersAnalyzed: n,
    funding_parent_share: maxGroup / n,
    deployer_funded: deployerFunded / n,
    cluster_dominance: clustered / n,
    fresh_wallet_ratio: freshKnown ? fresh / freshKnown : null,
    same_block_ratio: buys.length ? Math.max(...Object.values(perBlock)) / buys.length : 0,
    size_cv: sizes.length >= 5 && mean > 0 ? stdDev(sizes) / mean : null,
    dev_sold: creator ? trades.some(t => t.side === 'sell' && t.trader === creator) : false
  };
}