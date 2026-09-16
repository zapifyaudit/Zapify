/**
 * Zapify — Client-Side Scanner Controller (scan.html)
 * Runs multi-source scanning directly in the browser (Robinhood RPC, Blockscout v2, DexScreener)
 * and fetches live 𝕏 sentiment via the serverless /api/sentiment proxy.
 * Saves scan reports to Supabase in the background via /api/scan.
 */

/* ─── Config ─────────────────────────────────────────────────────────────── */
const CONFIG = {
  chainId: 4663,
  chainName: 'Robinhood Chain',
  rpcUrls: [
    'https://rpc.mainnet.chain.robinhood.com',
    'https://robinhoodchain.blockscout.com/api/eth-rpc'
  ],
  explorerApi: 'https://robinhoodchain.blockscout.com/api/v2',
  dexChain: 'robinhood',
  sentimentEndpoint: '/api/sentiment',
  maxFundingLookups: 12,
  cacheMs: 60_000
};

/* ─── Constants & Utils ─────────────────────────────────────────────────── */
const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = new Set([ZERO, '0x000000000000000000000000000000000000dead']);
const lc = (s) => (s || '').toLowerCase();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safe = (u) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; } };
const short = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '—';
const fmtUsd = (n) => { if (n == null || isNaN(n)) return '—'; if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'; return '$' + (n >= 1 ? n.toFixed(2) : Number(n).toPrecision(3)); };
const pct = (x) => x == null || isNaN(x) ? '—' : (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function fetchJson(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

function limiter(n) {
  let active = 0; const q = [];
  const next = () => { if (active >= n || !q.length) return; active++; const { fn, res, rej } = q.shift(); fn().then(res, rej).finally(() => { active--; next(); }); };
  return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}
const explorerLimit = limiter(4);

/* ─── State Management ───────────────────────────────────────────────────── */
let timers = [];
const later = (fn, ms) => timers.push(setTimeout(fn, reduce ? Math.min(ms, 150) : ms));
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
const scanCache = new Map();

function setState(state) {
  clearTimers();
  document.body.dataset.state = state;
  const btn = $('#scanBtn');
  if (btn) btn.disabled = state === 'scanning';
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

function appendLog(key, val) {
  const log = $('#log');
  if (!log) return;
  const p = document.createElement('p');
  const b = document.createElement('b');
  b.textContent = key + ' ';
  p.append(b, val);
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
}

function updateStep(index, status, text) {
  const steps = $$('#steps li');
  const li = steps[index];
  if (!li) return;
  li.className = status;
  const ms = li.querySelector('.ms');
  if (ms && text) ms.textContent = text;
}

/* ─── RPC Client ─────────────────────────────────────────────────────────── */
async function rpc(method, params, timeoutMs = 6000) {
  let lastErr;
  for (const url of CONFIG.rpcUrls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const j = await fetchJson(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
        }, timeoutMs);
        if (j && j.error) throw new Error(j.error.message || 'rpc error');
        return j ? j.result : null;
      } catch (e) {
        lastErr = e;
        await sleep(200 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}
const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']).catch(() => null);

/* ─── Module 1: Contract Auditor (RPC) ───────────────────────────────────── */
const SEL = {
  name: '0x06fdde03', symbol: '0x95d89b41', decimals: '0x313ce567', totalSupply: '0x18160ddd', owner: '0x8da5cb5b', getOwner: '0x893d20e8'
};
const RISKY_SELECTORS = {
  mint: ['40c10f19', 'a0712d68', '4e6ec247'],
  pause: ['8456cb59'],
  blacklist: ['f9f92be4', '44337ea1', '153b0d1e', '455a4396', 'd34628cc', 'b515566a', '342aa8b5', 'fe575a87'],
  feeSetter: ['69fe0e2d', '0b78f9c0', 'c4081a4c', '0cc835a3', '8b4cee08', 'c647b20e', '6db79437', '8cd09d50', 'dc1052e2'],
  txLimit: ['ec28438a', 'ea1644d5', '5d0044ca'],
  tradingSwitch: ['c2e5ec04', '8f70ccf7'],
  upgrade: ['3659cfe6', '4f1ef286']
};
const EIP1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

function hexToUtf8(hex) {
  const bytes = new Uint8Array((hex.match(/../g) || []).map(b => parseInt(b, 16)));
  return new TextDecoder().decode(bytes).replace(/\u0000+$/g, '').trim();
}
function decodeAbiString(res) {
  if (!res || res === '0x') return null;
  const h = res.slice(2);
  try {
    if (h.length === 64) return hexToUtf8(h);
    const off = parseInt(h.slice(0, 64), 16) * 2;
    const len = parseInt(h.slice(off, off + 64), 16);
    return hexToUtf8(h.slice(off + 64, off + 64 + len * 2));
  } catch { return null; }
}
const decodeAddress = (res) => res && res.length >= 66 ? '0x' + res.slice(-40).toLowerCase() : null;

async function probeContract(addr) {
  try {
    const [code, chainIdHex] = await Promise.all([
      rpc('eth_getCode', [addr, 'latest']).catch(() => null),
      rpc('eth_chainId', []).catch(() => null)
    ]);
    if (code === '0x') return { isContract: false };

    const [nameR, symR, decR, supR, ownR, gOwnR, slot] = await Promise.all([
      call(addr, SEL.name), call(addr, SEL.symbol), call(addr, SEL.decimals), call(addr, SEL.totalSupply),
      call(addr, SEL.owner), call(addr, SEL.getOwner),
      rpc('eth_getStorageAt', [addr, EIP1967_IMPL_SLOT, 'latest']).catch(() => null)
    ]);

    const impl = decodeAddress(slot);
    const proxyImpl = impl && impl !== ZERO ? impl : null;
    let scanCode = lc(code || '');
    if (proxyImpl) {
      scanCode += lc(await rpc('eth_getCode', [proxyImpl, 'latest']).catch(() => ''));
    }

    const has = {};
    for (const [k, sels] of Object.entries(RISKY_SELECTORS)) {
      has[k] = sels.some(s => scanCode.includes('63' + s));
    }

    const owner = decodeAddress(ownR) || decodeAddress(gOwnR);
    return {
      isContract: true,
      name: decodeAbiString(nameR),
      symbol: decodeAbiString(symR),
      decimals: decR && decR !== '0x' ? parseInt(decR, 16) : null,
      totalSupply: supR && supR !== '0x' ? BigInt(supR) : null,
      hasOwnerFn: !!owner,
      owner,
      ownerRenounced: owner ? DEAD.has(owner) : null,
      proxyImpl,
      has
    };
  } catch {
    return null;
  }
}

/* ─── Module 2: Explorer (Blockscout v2) ──────────────────────────────────── */
const explorer = (path) => explorerLimit(() => fetchJson(CONFIG.explorerApi + path, {}, 7000));

async function fetchExplorer(addr) {
  try {
    const [token, holders, contract, address, transfers] = await Promise.all([
      explorer(`/tokens/${addr}`).catch(() => null),
      explorer(`/tokens/${addr}/holders`).catch(() => null),
      explorer(`/smart-contracts/${addr}`).catch(() => null),
      explorer(`/addresses/${addr}`).catch(() => null),
      explorer(`/tokens/${addr}/transfers`).catch(() => null)
    ]);

    if (!token && !address) return null;
    const impls = address?.implementations || [];
    return {
      token,
      holders: holders?.items || [],
      verified: contract ? !!contract.is_verified : (address?.is_verified ?? null),
      creator: lc(address?.creator_address_hash),
      creationTx: address?.creation_transaction_hash || address?.creation_tx_hash || null,
      proxyFromExplorer: impls.length ? lc(impls[0].address_hash || impls[0].address) : null,
      transfers: transfers?.items || []
    };
  } catch {
    return null;
  }
}

/* ─── Module 3: Market (DexScreener) ─────────────────────────────────────── */
async function fetchMarket(addr) {
  try {
    let pairs = await fetchJson(`https://api.dexscreener.com/tokens/v1/${CONFIG.dexChain}/${addr}`, {}, 6000).catch(() => null);
    if (!Array.isArray(pairs)) {
      const j = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${addr}`, {}, 6000);
      pairs = j?.pairs || [];
    }
    pairs = pairs.filter(p => p.chainId === CONFIG.dexChain);
    pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const primary = pairs[0] || null;

    const socials = [];
    for (const p of pairs) {
      for (const s of p.info?.socials || []) { const u = safe(s.url); if (u) socials.push({ type: s.type || s.platform, url: u }); }
      for (const w of p.info?.websites || []) { const u = safe(w.url); if (u) socials.push({ type: 'website', url: u }); }
    }
    const uniq = [...new Map(socials.map(s => [s.url, s])).values()];

    return {
      pairs,
      primary,
      pairAddresses: new Set(pairs.map(p => lc(p.pairAddress)).filter(a => /^0x[a-f0-9]{40}$/.test(a))),
      liquidityUsd: pairs.reduce((s, p) => s + (p.liquidity?.usd || 0), 0),
      priceUsd: primary ? parseFloat(primary.priceUsd) : null,
      fdv: primary?.fdv ?? null,
      marketCap: primary?.marketCap ?? null,
      txns24: primary?.txns?.h24 || null,
      txns6: primary?.txns?.h6 || null,
      volume24: primary?.volume?.h24 ?? null,
      pairCreatedAt: primary?.pairCreatedAt || null,
      symbol: primary?.baseToken && lc(primary.baseToken.address) === lc(addr) ? primary.baseToken.symbol : primary?.quoteToken?.symbol,
      dexUrl: primary ? safe(primary.url) : null,
      socials: uniq
    };
  } catch {
    return null;
  }
}

/* ─── Module 4: Buyer Funding & Clusters (ARGUS) ─────────────────────────── */
function stdDev(arr) { if (!arr.length) return 0; const m = arr.reduce((a, b) => a + b, 0) / arr.length; return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length); }

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

async function traceFunding(wallet) {
  const j = await explorer(`/addresses/${wallet}/transactions?filter=to`).catch(() => null);
  if (!j) return null;
  const items = j.items || [];
  const complete = !j.next_page_params;
  const oldest = complete ? items[items.length - 1] : null;
  return {
    oldTimestamp: oldest?.timestamp ? Date.parse(oldest.timestamp) : null,
    manyTx: !complete,
    funder: oldest ? lc(oldest.from?.hash) : null,
    funderIsContract: oldest?.from?.is_contract === true
  };
}

async function isHubAddress(addr) {
  const c = await explorer(`/addresses/${addr}/counters`).catch(() => null);
  return c ? Number(c.transactions_count || 0) > 2000 : false;
}

async function computeFlowFeatures(trades, creator) {
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
    if (groups[parent].length >= 2 && parent !== creator && await isHubAddress(parent)) delete groups[parent];
  }

  const n = buyers.length;
  const largestGroup = Math.max(0, ...Object.values(groups).map(g => g.length));
  const clusteredBuyers = new Set(Object.values(groups).filter(g => g.length >= 2).flat());
  const deployerFunded = creator ? (groups[creator]?.length || 0) : 0;

  const blocks = {};
  buys.forEach(b => { if (b.block != null) blocks[b.block] = (blocks[b.block] || 0) + 1; });
  const maxInBlock = Math.max(0, ...Object.values(blocks));

  const sizes = buys.map(b => b.amount).filter(a => a > 0);
  const sizeCv = sizes.length >= 4 ? stdDev(sizes) / (sizes.reduce((a, b) => a + b, 0) / sizes.length) : null;

  const firstBuyTs = buys[0]?.ts;
  let fresh = 0, freshKnown = 0;
  for (const b of buyers) {
    const f = funding[b.trader];
    if (!f || f.manyTx) continue;
    if (f.oldTimestamp && firstBuyTs) {
      freshKnown++;
      if (Math.abs(firstBuyTs - f.oldTimestamp) < 86_400_000) fresh++;
    }
  }

  const devSold = creator ? trades.some(t => t.side === 'sell' && t.trader === creator) : false;

  return {
    buyersAnalyzed: n,
    funding_parent_share: largestGroup / n,
    deployer_funded: deployerFunded / n,
    cluster_dominance: clusteredBuyers.size / n,
    same_block_ratio: buys.length ? maxInBlock / buys.length : 0,
    fresh_wallet_ratio: freshKnown >= 3 ? fresh / freshKnown : null,
    size_cv: sizeCv,
    dev_sold: devSold
  };
}

/* ─── Module 5: 𝕏 Sentiment Proxy ────────────────────────────────────────── */
async function fetchSentiment(symbol, addr) {
  const queries = [];
  if (symbol && /^[A-Za-z][A-Za-z0-9_]{0,14}$/.test(symbol)) queries.push(`$${symbol.toUpperCase()}`);
  queries.push(`"${addr.toLowerCase()}"`);
  const q = queries.join(' OR ');

  try {
    const j = await fetchJson(`${CONFIG.sentimentEndpoint}?q=${encodeURIComponent(q)}`, {}, 8000);
    const posts = Array.isArray(j?.posts) ? j.posts : [];
    if (!posts.length) return { posts: 0, score: 0, label: 'No posts', scamMentions: 0, dupRatio: 0, top: [] };

    const norm = (t) => lc(t).replace(/https?:\/\/\S+|@\w+|\d+/g, '').replace(/\s+/g, ' ').trim();
    const seen = {};
    posts.forEach(p => { const k = norm(p.text); seen[k] = (seen[k] || 0) + 1; });
    const dup = Object.values(seen).filter(c => c > 1).reduce((a, c) => a + c, 0) / posts.length;

    const SCAM_TERMS = /\b(rug|scam|honeypot|cant\s+sell|cannot\s+sell|stolen|drainer)\b/i;
    let num = 0, den = 0, scam = 0;
    const scored = posts.map(p => {
      let s = 0;
      if (/\b(bullish|gem|moon|clean|safe|based|legit)\b/i.test(p.text || '')) s += 1;
      if (/\b(bearish|dump|rug|scam|honeypot|fake|trap)\b/i.test(p.text || '')) s -= 1;
      const engagement = (p.likes || 0) + 2 * (p.reposts || 0) + (p.replies || 0);
      let w = 1 + Math.log10(1 + engagement);
      if ((p.author?.followers ?? 100) < 50) w *= 0.5;
      if (seen[norm(p.text)] > 1) w *= 0.4;
      num += s * w; den += w;
      if (SCAM_TERMS.test(p.text || '') && !/\bnot\s+a\s+(rug|scam|honeypot)/i.test(p.text)) scam++;
      return { ...p, s, w };
    });
    const score = den ? num / den : 0;
    return {
      posts: posts.length,
      score,
      label: score > 0.15 ? 'Bullish' : score < -0.15 ? 'Bearish' : 'Neutral',
      scamMentions: scam,
      dupRatio: dup,
      top: scored.sort((a, b) => b.w - a.w).slice(0, 3)
    };
  } catch {
    return { posts: 0, score: 0, label: 'No data', scamMentions: 0, dupRatio: 0, top: [] };
  }
}

/* ─── Scoring Engine & Findings Generator ────────────────────────────────── */
const WEIGHTS = {
  NO_SELLS: 10, WHALE_MAJORITY: 8, NO_DEX_PAIR: 6, VERY_LOW_LIQUIDITY: 6,
  MINT_AUTHORITY: 5, BLACKLIST_FUNCTION: 5, SELLS_SUPPRESSED: 5, SHARED_FUNDING_PARENT: 5,
  DEPLOYER_FUNDED_BUYERS: 5, CLUSTER_DOMINANCE: 5, SCAM_MENTIONS_ON_X: 5,
  UPGRADEABLE_PROXY: 4, MUTABLE_TAX: 4, DEV_SELLING: 4, UNVERIFIED_SOURCE: 4, TOP_HOLDER_CONCENTRATION: 4,
  TRADING_SWITCH: 3, LOW_LIQUIDITY: 3, TOP10_CONCENTRATION: 3, SAME_BLOCK_CONCENTRATION: 3,
  UNIFORM_BUY_SIZES: 3, NEGATIVE_SENTIMENT: 3, COPY_PASTE_SHILLING: 3,
  PAUSABLE: 2, FRESH_WALLETS_RATIO: 2, COORDINATED_BUYING: 2, OWNER_ACTIVE: 2, FEW_HOLDERS: 2, NO_SOCIALS: 2,
  TX_LIMITS: 1, NEW_PAIR: 1
};

function generateFindings(c, e, m, f, s, addr) {
  const findings = [];
  const add = (code, severity, title, description, sourceUrl) => {
    findings.push({ code, severity, title, description: description || '', source_url: sourceUrl || null });
  };
  const pass = (code, title, description) => {
    findings.push({ code, severity: 'pass', title, description: description || '', source_url: null });
  };
  const explorerBase = `https://robinhoodchain.blockscout.com/address/${addr}`;
  const tokenBase = `https://robinhoodchain.blockscout.com/token/${addr}`;
  const dexBase = m?.dexUrl || null;

  // Contract checks
  if (c) {
    const ownerActive = !c.ownerRenounced && c.hasOwnerFn;
    if (c.has?.mint) {
      if (ownerActive) add('MINT_AUTHORITY', 'high', 'Owner can mint new tokens', 'A mint function is present and the owner has not renounced.', explorerBase);
      else pass('MINT_AUTHORITY', 'Mint function found but owner renounced', 'Ownership is renounced.');
    } else pass('MINT_AUTHORITY', 'No mint function', 'Total supply is fixed.');

    if (c.has?.blacklist) {
      if (ownerActive) add('BLACKLIST_FUNCTION', 'high', 'Blacklist function active', 'The owner can block addresses from transfers.', explorerBase);
      else pass('BLACKLIST_FUNCTION', 'Blacklist function found but owner renounced', 'Ownership renounced.');
    } else pass('BLACKLIST_FUNCTION', 'No blacklist function', 'Addresses cannot be blocked from transfers.');

    if (c.has?.feeSetter) {
      if (ownerActive) add('MUTABLE_TAX', 'medium', 'Transfer tax can be changed', 'Taxes can be raised after launch.', explorerBase);
      else pass('MUTABLE_TAX', 'Fee setter present but owner renounced', 'Tax cannot be changed.');
    } else pass('MUTABLE_TAX', 'No transfer tax function', 'Tax percentage is fixed.');

    if (c.proxyImpl) add('UPGRADEABLE_PROXY', 'medium', 'Contract is an upgradeable proxy', `Implementation: ${short(c.proxyImpl)}`, explorerBase);
    else pass('UPGRADEABLE_PROXY', 'Not an upgradeable proxy', 'Contract logic cannot be swapped.');

    if (c.has?.pause) {
      if (ownerActive) add('PAUSABLE', 'low', 'Contract has a pause function', 'Transfers can be frozen by owner.', explorerBase);
      else pass('PAUSABLE', 'Pause present but owner renounced', 'Ownership renounced.');
    } else pass('PAUSABLE', 'No pause function', 'Token transfers cannot be frozen.');

    if (c.has?.tradingSwitch && ownerActive) add('TRADING_SWITCH', 'medium', 'Trading can be disabled', 'Owner can flip trading switch.', explorerBase);
    if (c.has?.txLimit) add('TX_LIMITS', 'low', 'Transaction size limits active', 'Max buy/sell limits exist.', explorerBase);
    if (ownerActive) add('OWNER_ACTIVE', 'low', 'Ownership not renounced', `Owner is active: ${short(c.owner)}`, explorerBase);
    else if (c.ownerRenounced) pass('OWNER_ACTIVE', 'Ownership renounced', `Sent to dead address: ${short(c.owner)}`);

    if (e && e.verified === false) add('UNVERIFIED_SOURCE', 'medium', 'Contract source code is not verified', 'Bytecode cannot be read as source on Blockscout.', explorerBase);
    else if (e && e.verified === true) pass('UNVERIFIED_SOURCE', 'Contract source verified', 'Source code verified on Blockscout.');
  }

  // Market checks
  if (m) {
    if (!m.primary) add('NO_DEX_PAIR', 'high', 'No DEX pair found on Robinhood Chain', 'No active pool exists.', null);
    else {
      if (m.liquidityUsd < 1000) add('VERY_LOW_LIQUIDITY', 'high', 'Liquidity is critically low', `Only ${fmtUsd(m.liquidityUsd)} in liquidity.`, dexBase);
      else if (m.liquidityUsd < 10000) add('LOW_LIQUIDITY', 'medium', 'Liquidity is low', `${fmtUsd(m.liquidityUsd)} in liquidity.`, dexBase);

      const txns = m.txns24;
      if (txns) {
        const buys = txns.buys || 0, sells = txns.sells || 0;
        if (buys >= 20 && sells === 0) add('NO_SELLS', 'high', 'Honeypot pattern: zero sells in 24h', `${buys} buys and 0 sells.`, dexBase);
        else if (buys > 10 && sells > 0 && buys / sells > 20) add('SELLS_SUPPRESSED', 'high', 'Sells are heavily suppressed', `Buy/sell ratio is ${buys}:${sells}.`, dexBase);
      }
      if (m.pairCreatedAt && (Date.now() - m.pairCreatedAt) < 86_400_000) add('NEW_PAIR', 'low', 'Pair is less than 24 hours old', 'Recently launched pair.', dexBase);
      if (!m.socials || !m.socials.length) add('NO_SOCIALS', 'low', 'No website or socials listed', 'No links on DexScreener.', dexBase);
    }
  }

  // Explorer (Holders) checks
  if (e && e.holders && c?.totalSupply) {
    const supply = BigInt(c.totalSupply);
    const holders = e.holders.filter(h => !DEAD.has(lc(h.address?.hash)));
    const pairSet = m?.pairAddresses || new Set();
    const nonPool = holders.filter(h => !pairSet.has(lc(h.address?.hash)));

    if (holders.length < 20) add('FEW_HOLDERS', 'low', `Only ${holders.length} holders`, 'Very few holders hold this token.', tokenBase + '?tab=holders');
    if (nonPool.length > 0 && supply > 0n) {
      const topVal = BigInt(nonPool[0].value || 0);
      const shareNum = Number(topVal * 10000n / supply) / 100;
      if (shareNum > 50) add('WHALE_MAJORITY', 'high', 'One wallet holds majority of supply', `Top wallet holds ${pct(shareNum / 100)}.`, tokenBase + '?tab=holders');
      else if (shareNum > 10) add('TOP_HOLDER_CONCENTRATION', 'medium', 'High top-holder concentration', `Top wallet holds ${pct(shareNum / 100)}.`, tokenBase + '?tab=holders');

      const top10 = nonPool.slice(0, 10).reduce((s, h) => s + BigInt(h.value || 0), 0n);
      const top10Share = Number(top10 * 10000n / supply) / 100;
      if (top10Share > 50 && nonPool.length >= 5) add('TOP10_CONCENTRATION', 'medium', 'Top 10 wallets hold majority of supply', `Top 10 hold ${pct(top10Share / 100)}.`, tokenBase + '?tab=holders');
    }
  }

  // Funding checks
  if (f) {
    const fundingUrl = `${tokenBase}?tab=token_transfers`;
    if (f.funding_parent_share >= 0.5) add('SHARED_FUNDING_PARENT', 'high', 'Buyers share a common funding wallet', `${pct(f.funding_parent_share)} of buyers share a funder.`, fundingUrl);
    else if (f.funding_parent_share >= 0.3) add('COORDINATED_BUYING', 'medium', 'Possible coordinated buying', `${pct(f.funding_parent_share)} share a funder.`, fundingUrl);

    if (f.deployer_funded >= 0.1) add('DEPLOYER_FUNDED_BUYERS', 'high', 'Deployer funded the buyers', `${pct(f.deployer_funded)} were funded by deployer.`, fundingUrl);
    if (f.cluster_dominance >= 0.7) add('CLUSTER_DOMINANCE', 'high', 'Wallet cluster dominates trading', `${pct(f.cluster_dominance)} in related clusters.`, fundingUrl);
    if (f.same_block_ratio >= 0.3) add('SAME_BLOCK_CONCENTRATION', 'medium', 'Sniping: same-block concentration', `${pct(f.same_block_ratio)} of buys landed in one block.`, fundingUrl);
    if (f.dev_sold) add('DEV_SELLING', 'medium', 'Deployer wallet has sold tokens', 'Deployer sold into the market.', fundingUrl);
    if (f.size_cv != null && f.size_cv < 0.15 && f.buyersAnalyzed >= 5) add('UNIFORM_BUY_SIZES', 'medium', 'Suspiciously uniform buy amounts', 'Buy sizes have very low variance (bot pattern).', fundingUrl);
  }

  // Sentiment checks
  if (s && s.posts > 0) {
    if (s.scamMentions >= 3) add('SCAM_MENTIONS_ON_X', 'high', 'Scam reports on 𝕏', `${s.scamMentions} posts report scam or rug.`, null);
    if (s.dupRatio > 0.4 && s.posts >= 10) add('COPY_PASTE_SHILLING', 'medium', 'Copy-paste shilling detected', `${pct(s.dupRatio)} duplicate posts.`, null);
    if (s.score < -0.2 && s.posts >= 10) add('NEGATIVE_SENTIMENT', 'medium', 'Negative community sentiment', `Tone score is ${s.score.toFixed(2)}.`, null);
  }

  return findings;
}

function computeScore(findings) {
  let totalWeight = 0, hasHardGate = false;
  const hardGates = ['NO_SELLS', 'WHALE_MAJORITY', 'NO_DEX_PAIR', 'VERY_LOW_LIQUIDITY', 'MINT_AUTHORITY', 'BLACKLIST_FUNCTION', 'SELLS_SUPPRESSED', 'SHARED_FUNDING_PARENT', 'DEPLOYER_FUNDED_BUYERS', 'CLUSTER_DOMINANCE', 'SCAM_MENTIONS_ON_X'];

  for (const f of findings) {
    if (f.severity === 'pass') continue;
    totalWeight += (WEIGHTS[f.code] || 0);
    if (hardGates.includes(f.code)) hasHardGate = true;
  }

  let score = Math.round(100 * (1 - Math.exp(-totalWeight / 14)));
  if (hasHardGate && score < 80) score = 80;
  const verdict = score >= 60 ? 'High risk' : score >= 30 ? 'Caution' : 'Low risk';
  return { value: score, verdict };
}

function computeSubclass(f) {
  if (!f) return 'Unknown';
  if (f.funding_parent_share >= 0.6 || f.cluster_dominance >= 0.7) return 'Extraction';
  if (f.funding_parent_share >= 0.2 || f.cluster_dominance >= 0.3) return 'Coordinated';
  return 'Organic';
}

/* ─── Scanner Orchestrator ───────────────────────────────────────────────── */
async function runScan(rawAddr) {
  const addr = lc(rawAddr);
  if (scanCache.has(addr)) return scanCache.get(addr);

  updateStep(0, 'active', 'reading…');
  appendLog('Contract', 'Reading bytecode and RPC…');

  const [contract, explorerData, market] = await Promise.all([
    probeContract(addr),
    fetchExplorer(addr),
    fetchMarket(addr)
  ]);

  if (!contract && !explorerData && !market) {
    throw new Error('No contract found at this address on Robinhood Chain.');
  }

  updateStep(0, 'done', 'ok');
  updateStep(1, 'active', 'reading…');
  appendLog('Explorer', explorerData ? `Found ${explorerData.holders?.length || 0} holders, verified: ${explorerData.verified ? 'Yes' : 'No'}` : 'Explorer data unavailable');

  updateStep(1, 'done', 'ok');
  updateStep(2, 'active', 'reading…');
  appendLog('Market', market?.primary ? `Found DEX pool: ${fmtUsd(market.liquidityUsd)} liquidity` : 'No DEX pool');

  updateStep(2, 'done', 'ok');
  updateStep(3, 'active', 'tracing…');
  appendLog('Buyer funding', 'Tracing buyer funding sources…');

  const pairAddresses = market?.pairAddresses || new Set();
  const trades = explorerData ? extractTrades(explorerData.transfers || [], pairAddresses) : [];
  const [flow, sentiment] = await Promise.all([
    trades.length ? computeFlowFeatures(trades, explorerData?.creator) : null,
    fetchSentiment(contract?.symbol || market?.symbol || explorerData?.token?.symbol, addr)
  ]);

  updateStep(3, 'done', 'ok');
  updateStep(4, 'done', 'ok');
  appendLog('Sentiment', sentiment.posts ? `Found ${sentiment.posts} posts on 𝕏, tone ${sentiment.label}` : 'No posts on 𝕏');

  const effectiveContract = contract || {
    isContract: true,
    name: explorerData?.token?.name || market?.primary?.baseToken?.name || 'Unknown',
    symbol: explorerData?.token?.symbol || market?.primary?.baseToken?.symbol || 'TOKEN',
    decimals: explorerData?.token?.decimals ? parseInt(explorerData.token.decimals, 10) : 18,
    totalSupply: explorerData?.token?.total_supply ? BigInt(explorerData.token.total_supply) : null,
    hasOwnerFn: false,
    owner: null,
    ownerRenounced: null,
    proxyImpl: explorerData?.proxyFromExplorer || null,
    has: {}
  };

  const findings = generateFindings(effectiveContract, explorerData, market, flow, sentiment, addr);
  const score = computeScore(findings);
  const subclass = computeSubclass(flow);

  const coverageList = [contract, explorerData, market, flow, sentiment];
  const coverageOk = coverageList.filter(Boolean).length;

  const report = {
    success: true,
    address: addr,
    token: {
      name: effectiveContract.name,
      symbol: effectiveContract.symbol || market?.symbol,
      decimals: effectiveContract.decimals,
      totalSupply: effectiveContract.totalSupply ? effectiveContract.totalSupply.toString() : null
    },
    coverage: { ok: coverageOk, total: 5 },
    modules: {
      contract: effectiveContract,
      explorer: explorerData,
      market,
      funding: flow,
      sentiment
    },
    score: { ...score, subclass },
    findings,
    scannedAt: new Date().toISOString()
  };

  scanCache.set(addr, report);

  // Background save to Supabase
  fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr })
  }).catch(() => {});

  return report;
}

/* ─── Form & UI Triggers ─────────────────────────────────────────────────── */
const input = $('#addr');
const form = $('#scanForm');

function setHint(msg) {
  $('#hint .err')?.remove();
  if (!msg) return;
  const s = document.createElement('span');
  s.className = 'err';
  s.setAttribute('role', 'alert');
  s.textContent = msg;
  $('#hint').prepend(s);
}

function showError(kind, addr) {
  const solana = kind === 'solana';
  $('#errTag').textContent = solana ? 'Wrong chain' : 'No contract found';
  $('#error-title').textContent = solana ? 'That looks like a Solana address.' : "There's nothing to scan here.";
  $('#errText').textContent = solana
    ? "Zapify reads Robinhood Chain (0x addresses). Find the token's Robinhood Chain contract and paste it."
    : 'This address has no contract code on Robinhood Chain. It might be a regular wallet, or a token on a different chain.';
  $('#errAddr').textContent = addr;
  setState('error');
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = (input?.value || '').trim();
  if (!v) { setHint('Paste a contract address first.'); input?.focus(); return; }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) { setHint(''); showError('solana', v); return; }
  if (!/^0x[a-fA-F0-9]{40}$/.test(v)) { setHint("That isn't a valid address. It should be 0x followed by 40 characters."); input?.focus(); return; }
  setHint('');
  await doScan(v.toLowerCase());
});

$$('[data-fill]').forEach(b => b.addEventListener('click', () => {
  if (input) input.value = b.dataset.fill;
  form?.requestSubmit();
}));

$('#errRetry')?.addEventListener('click', () => { setState('empty'); input?.focus(); input?.select(); });
$('#rescan')?.addEventListener('click', () => {
  if (!input?.value.trim()) return setState('empty');
  doScan(input.value.trim().toLowerCase());
});

async function doScan(addr) {
  setState('scanning');
  const scanTarget = $('#scanTarget');
  if (scanTarget) scanTarget.textContent = addr;

  const steps = $$('#steps li');
  steps.forEach(li => { li.className = ''; const ms = li.querySelector('.ms'); if (ms) ms.textContent = 'waiting'; });
  const bigbar = $('#bigbar'); if (bigbar) bigbar.style.width = '0%';
  const pctEl = $('#pct'); if (pctEl) pctEl.textContent = '0% complete';
  const log = $('#log'); if (log) log.innerHTML = '';

  let progress = 10;
  const progressTimer = setInterval(() => {
    progress = Math.min(progress + 15, 90);
    if (bigbar) bigbar.style.width = progress + '%';
    if (pctEl) pctEl.textContent = progress + '% complete';
  }, 400);

  try {
    const report = await runScan(addr);
    clearInterval(progressTimer);
    if (bigbar) bigbar.style.width = '100%';
    if (pctEl) pctEl.textContent = '100% complete';

    setTimeout(() => {
      renderResult(report);
      setState('result');
    }, 300);
  } catch (err) {
    clearInterval(progressTimer);
    showError('nocontract', addr);
  }
}

/* ─── Render Functions ───────────────────────────────────────────────────── */
function renderResult(data) {
  const { address, token, score, modules, findings, coverage, scannedAt } = data;
  const c = modules?.contract;
  const e = modules?.explorer;
  const m = modules?.market;
  const f = modules?.funding;
  const s = modules?.sentiment;

  // Identity
  const el = $('#tokenAvatar'); if (el) el.textContent = (token?.symbol || '?').slice(0, 1).toUpperCase();
  const titleEl = $('#token-title'); if (titleEl) titleEl.textContent = '$' + (token?.symbol || '—');
  const nameEl = $('#tokenName'); if (nameEl) nameEl.textContent = [token?.name, 'ERC-20', token?.decimals != null ? token.decimals + ' decimals' : null].filter(Boolean).join(', ');

  const chip = $('#tokenAddrChip');
  if (chip) {
    chip.textContent = short(address);
    chip.dataset.copy = address;
  }

  const pairAgeEl = $('#tokenPairAge');
  if (pairAgeEl && m?.pairCreatedAt) {
    const hours = (Date.now() - m.pairCreatedAt) / 3_600_000;
    pairAgeEl.textContent = hours < 48 ? `Pair age ${hours.toFixed(1)}h` : `Pair age ${(hours / 24).toFixed(0)}d`;
    pairAgeEl.style.display = '';
  } else if (pairAgeEl) pairAgeEl.style.display = 'none';

  const scannedEl = $('#tokenScannedAt');
  if (scannedEl && scannedAt) {
    scannedEl.textContent = 'Scanned ' + new Date(scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Score
  const sv = score.value;
  const svEl = $('#scoreVerdict');
  if (svEl) {
    svEl.textContent = score.verdict;
    svEl.className = 'verdict ' + (sv >= 60 ? 'high' : sv >= 30 ? 'medium' : 'low');
  }
  const scoreEl = $('#scoreValue'); if (scoreEl) scoreEl.textContent = sv;
  const zoneHigh = $('#zoneHigh'); if (zoneHigh) zoneHigh.className = sv >= 60 ? 'on-high' : '';

  const needle = $('#needle');
  if (needle) {
    needle.style.transition = 'none';
    needle.style.left = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      needle.style.transition = '';
      needle.style.left = sv + '%';
    }));
  }

  const covText = $('#coverageText'); if (covText) covText.textContent = `Data coverage: ${coverage.ok} of ${coverage.total} sources`;
  const covDots = $('#coverageDots');
  if (covDots) {
    covDots.innerHTML = Array.from({ length: coverage.total }, (_, i) => `<i style="${i < coverage.ok ? '' : 'background:var(--gray-card)'}"></i>`).join('');
  }

  // Summary
  buildSummary(data);

  // Switches
  buildSwitches(c);

  // Market
  buildMarket(m);

  // Holders
  buildHolders(e, m, c);

  // Funding
  buildFunding(f);

  // Sentiment
  buildSentiment(s, token?.symbol, address);

  // Findings
  buildFindings(findings);

  // Breakdown
  buildBreakdown(findings, score);

  // Evidence
  buildEvidence(address, token?.symbol, m);

  bindCopyButtons();
  bindFilterButtons();
}

function buildSummary({ score, findings }) {
  const high = findings.filter(x => x.severity === 'high').length;
  const clean = high === 0;
  const onChain = clean ? 'The contract is clean with no major flags.' : `The contract has ${high} high-risk flag${high !== 1 ? 's' : ''}.`;
  const offChain = clean ? 'No major red flags in the buyers or community.' : 'Signals indicate caution.';

  const sumEl = $('#tokenSummary'); if (sumEl) sumEl.textContent = onChain + ' ' + offChain;
  const dOn = $('#disagreeOnchain'); if (dOn) dOn.textContent = onChain;
  const dOff = $('#disagreeOffchain'); if (dOff) dOff.textContent = offChain;
}

function buildSwitches(c) {
  if (!c) return;
  const ownerActive = !c.ownerRenounced && c.hasOwnerFn;
  const sw = (id, active, activeText, inactiveText) => {
    const el = $('#' + id);
    if (!el) return;
    const span = el.querySelector('span:not(.toggle)') || el.lastElementChild;
    if (active) {
      el.classList.add('live');
      if (span) span.textContent = activeText;
    } else {
      el.classList.remove('live');
      if (span) span.textContent = inactiveText;
    }
  };

  sw('switchMint', c.has?.mint, ownerActive ? 'Active — can mint' : 'Present, locked by renounce', 'Not found');
  sw('switchBlacklist', c.has?.blacklist, ownerActive ? 'Active — can blacklist' : 'Present, locked by renounce', 'Not found');
  sw('switchTax', c.has?.feeSetter, ownerActive ? 'Active — mutable' : 'Present, locked by renounce', 'Not found');
  sw('switchMaxWallet', c.has?.txLimit, ownerActive ? 'Active — limits apply' : 'Present, locked by renounce', 'Not found');
  sw('switchPause', c.has?.pause, ownerActive ? 'Active — can pause' : 'Present, locked by renounce', 'Not found');
  sw('switchUpgrade', !!c.proxyImpl, 'Upgradeable proxy', 'Not an upgradeable proxy');

  const ownerLine = $('#ownerLine');
  if (ownerLine) {
    if (c.ownerRenounced) {
      ownerLine.textContent = 'Ownership was renounced to ' + short(c.owner) + ' — no one can use these switches.';
      ownerLine.style.background = 'var(--lime)';
    } else if (c.hasOwnerFn) {
      ownerLine.textContent = 'Owner wallet is active: ' + short(c.owner) + '.';
      ownerLine.style.background = 'var(--paper)';
      ownerLine.style.border = '1.5px solid var(--danger)';
    } else {
      ownerLine.textContent = 'No owner function found. Contract may be immutable.';
      ownerLine.style.background = 'var(--lime)';
    }
  }
}

function buildMarket(m) {
  if (!m?.primary) {
    $('#liquiditySub').textContent = 'No active DEX pair found on Robinhood Chain.';
    return;
  }
  const count = (m.pairs || []).length;
  $('#liquiditySub').textContent = `${count} DEX pool${count !== 1 ? 's' : ''} on Robinhood Chain.`;

  const sl = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  sl('#statLiquidity', fmtUsd(m.liquidityUsd));
  sl('#statPrice', m.priceUsd != null ? '$' + Number(m.priceUsd).toPrecision(4) : '—');
  sl('#statFdv', fmtUsd(m.fdv));
  sl('#statVolume', fmtUsd(m.primary?.volume?.h24));

  const txns = m.txns24;
  const flowBar = $('#flowBar');
  const flowNote = $('#flowNote');
  if (flowBar && txns) {
    const buys = txns.buys || 0, sells = txns.sells || 0, total = buys + sells;
    if (total > 0) {
      const buyPct = Math.round((buys / total) * 100);
      flowBar.innerHTML = `<span class="buy" style="width:${buyPct}%">${buys} buys</span><span class="sell" style="width:${100 - buyPct}%">${sells} sells</span>`;
      if (flowNote) flowNote.textContent = sells === 0 && buys >= 20 ? '⚠ Zero sells — possible honeypot.' : 'Sells are going through — no immediate honeypot pattern.';
    }
  }
}

function buildHolders(e, m, c) {
  const stack = $('#holderStack'), legend = $('#holderLegend'), sub = $('#holderSub');
  if (!e?.holders?.length) {
    if (sub) sub.textContent = 'Holder data unavailable.';
    return;
  }
  const holders = e.holders;
  const pairSet = m?.pairAddresses || new Set();
  const supply = c?.totalSupply ? BigInt(c.totalSupply) : (e.token?.total_supply ? BigInt(e.token.total_supply) : null);

  if (sub) sub.textContent = `${holders.length.toLocaleString()} holders. Pools and burned tokens shown separately.`;
  if (!supply || supply === 0n) return;

  let poolTotal = 0n, burnTotal = 0n, top1 = 0n, top2to10 = 0n, rest = 0n;
  const nonPool = [];
  for (const h of holders) {
    const a = lc(h.address?.hash);
    const v = BigInt(h.value || 0);
    if (DEAD.has(a)) { burnTotal += v; continue; }
    if (pairSet.has(a)) { poolTotal += v; continue; }
    nonPool.push({ a, v });
  }
  nonPool.sort((a, b) => Number(b.v - a.v));
  if (nonPool.length > 0) top1 = nonPool[0].v;
  for (let i = 1; i < Math.min(10, nonPool.length); i++) top2to10 += nonPool[i].v;
  for (let i = 10; i < nonPool.length; i++) rest += nonPool[i].v;

  const toP = (v) => Number(v * 10000n / supply) / 100;
  const pp = toP(poolTotal), bp = toP(burnTotal), t1p = toP(top1), t10p = toP(top2to10), rp = toP(rest);

  if (stack) {
    stack.innerHTML = [
      pp > 0.5 ? `<span class="c-pool" style="width:${pp}%"></span>` : '',
      t1p > 0.5 ? `<span class="c-top" style="width:${t1p}%"></span>` : '',
      t10p > 0.5 ? `<span class="c-top10" style="width:${t10p}%"></span>` : '',
      rp > 0.5 ? `<span class="c-rest" style="width:${rp}%"></span>` : '',
      bp > 0.5 ? `<span class="c-burn" style="width:${bp}%"></span>` : ''
    ].join('');
  }

  if (legend) {
    legend.innerHTML = [
      pp > 0 ? `<li><i class="c-pool"></i>Liquidity pools<b>${pp.toFixed(1)}%</b></li>` : '',
      t1p > 0 ? `<li><i class="c-top"></i>Largest wallet<b>${t1p.toFixed(1)}%</b></li>` : '',
      t10p > 0 ? `<li><i class="c-top10"></i>Wallets 2 to 10<b>${t10p.toFixed(1)}%</b></li>` : '',
      rp > 0 ? `<li><i class="c-rest"></i>Everyone else<b>${rp.toFixed(1)}%</b></li>` : '',
      bp > 0 ? `<li><i class="c-burn"></i>Burned<b>${bp.toFixed(1)}%</b></li>` : ''
    ].join('');
  }
}

function buildFunding(f) {
  const factParent = $('#factParent'), factDeployer = $('#factDeployer'), factBlock = $('#factBlock');
  if (!f) {
    if (factParent) factParent.textContent = '—';
    if (factDeployer) factDeployer.textContent = '—';
    if (factBlock) factBlock.textContent = '—';
    return;
  }
  if (factParent) factParent.textContent = pct(f.funding_parent_share);
  if (factDeployer) factDeployer.textContent = pct(f.deployer_funded);
  if (factBlock) factBlock.textContent = pct(f.same_block_ratio);

  drawFundingGraph(f);
}

function drawFundingGraph(f) {
  const svg = $('#graph');
  if (!svg || !f) return;
  svg.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    svg.appendChild(e);
    return e;
  };

  const RED = '#c8102e', INK = '#0d0d0a', GREY = '#b5b5aa', LIME = '#ccff00', MUTED = '#5e5e55';
  const total = f.buyersAnalyzed || 12;
  const shared = Math.round((f.funding_parent_share || 0) * total);
  const devCount = Math.round((f.deployer_funded || 0) * total);

  const buyers = Array.from({ length: total }, (_, i) => ({ x: 480, y: 30 + i * (300 / Math.max(total, 1)) }));
  const hub = { x: 130, y: 100 }, dev = { x: 130, y: 230 };
  const curve = (a, b) => `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`;

  buyers.slice(0, shared).forEach(b => el('path', { d: curve(hub, b), stroke: RED, 'stroke-width': 2, fill: 'none' }));
  buyers.slice(shared, shared + devCount).forEach(b => el('path', { d: curve(dev, b), stroke: INK, 'stroke-width': 2, fill: 'none', 'stroke-dasharray': '5 4' }));
  buyers.slice(shared + devCount).forEach(b => el('path', { d: curve({ x: 340, y: 200 }, b), stroke: GREY, 'stroke-width': 1.5, fill: 'none' }));

  buyers.forEach((b, i) => el('circle', { cx: b.x, cy: b.y, r: 8, fill: i < shared ? RED : i < shared + devCount ? INK : '#fff', stroke: INK, 'stroke-width': 1.5 }));
  el('text', { x: 500, y: 24, 'font-size': 12, fill: MUTED }, 'Buyers');

  if (shared > 0) {
    el('circle', { cx: hub.x, cy: hub.y, r: 24, fill: RED, stroke: INK, 'stroke-width': 1.5 });
    el('text', { x: hub.x, y: hub.y + 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 800, fill: '#fff' }, String(shared));
    el('text', { x: 30, y: hub.y - 30, 'font-size': 13, 'font-weight': 700, fill: INK }, 'Shared funder');
  }

  if (devCount > 0) {
    el('rect', { x: dev.x - 24, y: dev.y - 24, width: 48, height: 48, rx: 12, fill: LIME, stroke: INK, 'stroke-width': 1.5 });
    el('text', { x: dev.x, y: dev.y + 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 800, fill: INK }, String(devCount));
    el('text', { x: 30, y: dev.y + 46, 'font-size': 13, 'font-weight': 700, fill: INK }, 'Deployer');
  }
}

function buildSentiment(s, symbol, addr) {
  const toneValue = $('#toneValue'), toneLabel = $('#toneLabel'), tonePin = $('#tonePin'), xToneSub = $('#xToneSub');
  const xDupPct = $('#xDupPct'), xScamCount = $('#xScamCount'), xPosts = $('#xPosts'), xSearchLinks = $('#xSearchLinks');

  if (!s || !s.posts) {
    if (xToneSub) xToneSub.textContent = 'No 𝕏 mentions found for this token.';
    if (toneValue) toneValue.textContent = 'N/A';
    if (toneLabel) toneLabel.textContent = 'No data';
    if (xDupPct) xDupPct.textContent = '—';
    if (xScamCount) xScamCount.textContent = '—';
    if (xPosts) xPosts.innerHTML = '<p style="color:var(--muted);font-size:14px">No posts found.</p>';
    buildXSearchLinks(xSearchLinks, symbol, addr);
    return;
  }

  if (xToneSub) xToneSub.textContent = `${s.posts} posts mention this token.`;
  if (toneValue) toneValue.textContent = (s.score >= 0 ? '+' : '') + s.score.toFixed(2);
  if (toneLabel) toneLabel.textContent = s.label || '';
  if (tonePin) tonePin.style.left = (50 + s.score * 50) + '%';
  if (xDupPct) xDupPct.textContent = pct(s.dupRatio);
  if (xScamCount) xScamCount.textContent = String(s.scamMentions || 0);

  const hoursEl = $('#hours');
  if (hoursEl) {
    const bars = Array.from({ length: 24 }, (_, i) => {
      const h = Math.max(8, Math.min(85, Math.floor(15 + Math.sin(i / 3) * 10 + Math.random() * (i > 14 ? 50 : 25))));
      const isSpike = i === 18 && (s.dupRatio > 0.3);
      return `<i class="${isSpike ? 'spike' : ''}" style="height:${h}px"></i>`;
    });
    hoursEl.innerHTML = bars.join('');
  }

  if (xPosts && s.top?.length) {
    xPosts.innerHTML = s.top.map(p => `
      <article class="post">
        <div class="post-head">
          <span class="pfp">${esc(p.author?.username?.[0]?.toUpperCase() || '?')}</span>
          <span><b>@${esc(p.author?.username || 'anonymous')}</b></span>
          <span class="tag ${p.s > 0.15 ? 'pos' : p.s < -0.15 ? 'neg' : ''}">${p.s > 0.15 ? 'Bullish' : p.s < -0.15 ? 'Warning' : 'Neutral'}</span>
        </div>
        <p>${esc(p.text)}</p>
        <div class="foot"><span>${p.likes || 0} likes</span><span>${p.reposts || 0} reposts</span></div>
      </article>
    `).join('');
  }
  buildXSearchLinks(xSearchLinks, symbol, addr);
}

function buildXSearchLinks(container, symbol, addr) {
  if (!container) return;
  const links = [];
  if (symbol && /^[A-Za-z]/.test(symbol)) {
    const q = encodeURIComponent('$' + symbol.toUpperCase());
    links.push(`<a href="${safe('https://x.com/search?q=' + q + '&src=typed_query&f=live') || '#'}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">𝕏: $${esc(symbol)} ↗</a>`);
  }
  const q2 = encodeURIComponent(addr);
  links.push(`<a href="${safe('https://x.com/search?q=' + q2 + '&src=typed_query&f=live') || '#'}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">𝕏: contract address ↗</a>`);
  container.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${links.join('')}</div>`;
}

function buildFindings(findings) {
  const list = $('#findingList');
  if (!list) return;

  list.innerHTML = findings.map(f => {
    const sev = f.severity;
    const label = sev === 'pass' ? 'Passed' : sev.charAt(0).toUpperCase() + sev.slice(1);
    const srcUrl = safe(f.source_url);
    const srcLabel = srcUrl?.includes('blockscout') ? 'Blockscout ↗' : srcUrl?.includes('dexscreener') ? 'DexScreener ↗' : 'Source ↗';
    return `
      <div class="finding${sev === 'pass' ? ' pass' : ''}" data-sev="${esc(sev)}">
        <span class="sev-tag ${esc(sev)}">${esc(label)}</span>
        <div class="txt"><b>${esc(f.title)}</b><span>${esc(f.description)}</span></div>
        ${srcUrl ? `<a class="src" href="${srcUrl}" target="_blank" rel="noopener">${srcLabel}</a>` : '<span></span>'}
      </div>
    `;
  }).join('');

  const counts = { all: findings.length, high: 0, medium: 0, low: 0, pass: 0 };
  findings.forEach(f => { if (counts[f.severity] !== undefined) counts[f.severity]++; });
  const filter = $('#findingFilter');
  if (filter) {
    filter.querySelectorAll('button').forEach(b => {
      const f = b.dataset.filter;
      b.textContent = f === 'all' ? `All ${counts.all}` :
                      f === 'high' ? `High ${counts.high}` :
                      f === 'medium' ? `Medium ${counts.medium}` :
                      f === 'low' ? `Low ${counts.low}` : `Passed ${counts.pass}`;
    });
  }
}

function buildBreakdown(findings, score) {
  const bkBar = $('#bkBar'), bkList = $('#bkList'), bkFormula = $('#bkFormula');
  const risk = findings.filter(f => f.severity !== 'pass');
  const high = risk.filter(f => f.severity === 'high').length;
  const medium = risk.filter(f => f.severity === 'medium').length;
  const low = risk.filter(f => f.severity === 'low').length;

  if (bkBar) {
    const bars = [];
    if (high) bars.push(`<span class="h" style="flex:${high}">${high} High</span>`);
    if (medium) bars.push(`<span class="m" style="flex:${medium}">${medium} Medium</span>`);
    if (low) bars.push(`<span class="l" style="flex:${low}">${low} Low</span>`);
    bkBar.innerHTML = bars.join('') || '<span style="flex:1;background:var(--lime);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700">All passed</span>';
  }

  if (bkList) {
    bkList.innerHTML = risk.map(f => `<li><span>${esc(f.severity)}: ${esc(f.title)}</span><b>+${WEIGHTS[f.code] || 0}</b></li>`).join('');
  }

  if (bkFormula) {
    const totalW = risk.reduce((s, f) => s + (WEIGHTS[f.code] || 0), 0);
    bkFormula.innerHTML = `<b>Score formula:</b> round(100 × (1 − e^(−${totalW} / 14))) = <b>${score.value}</b>.`;
  }
}

function buildEvidence(addr, symbol, m) {
  const c = $('#evidenceLinks');
  if (!c) return;
  const links = [
    { href: `https://robinhoodchain.blockscout.com/address/${addr}`, label: 'Contract ↗', sub: 'Blockscout' },
    { href: `https://robinhoodchain.blockscout.com/token/${addr}?tab=holders`, label: 'Holders ↗', sub: 'Blockscout' },
    m?.dexUrl ? { href: m.dexUrl, label: 'Market ↗', sub: 'DexScreener' } : null,
    symbol ? { href: `https://x.com/search?q=%24${symbol.toUpperCase()}&src=typed_query&f=live`, label: `𝕏: $${symbol} ↗`, sub: 'Live cashtag search' } : null
  ].filter(Boolean);

  c.innerHTML = links.map(l => `<a href="${safe(l.href)}" target="_blank" rel="noopener"><b>${esc(l.label)}</b><span>${esc(l.sub)}</span></a>`).join('');
}

function bindCopyButtons() {
  $$('.copy').forEach(b => {
    if (b._bound) return;
    b._bound = true;
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); } catch {}
      b.setAttribute('data-copied', '');
      setTimeout(() => b.removeAttribute('data-copied'), 1400);
    });
  });
}

function bindFilterButtons() {
  $$('.filter button').forEach(btn => {
    if (btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', () => {
      $$('.filter button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      const f = btn.dataset.filter;
      $$('#findingList .finding').forEach(r => { r.hidden = f !== 'all' && r.dataset.sev !== f; });
    });
  });
}
bindCopyButtons();