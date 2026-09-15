import { CONFIG } from './config.js';
import { safeUrl, lc } from './utils.js';

export async function fetchMarket(addr) {
  let pairs = await fetch(`https://api.dexscreener.com/tokens/v1/${CONFIG.dexChain}/${addr}`)
    .then(r => r.json()).catch(() => null);

  if (!Array.isArray(pairs)) {
    const j = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`)
      .then(r => r.json()).catch(() => ({ pairs: [] }));
    pairs = (j?.pairs || []);
  }

  pairs = pairs.filter(p => p.chainId === CONFIG.dexChain);
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  
  const primary = pairs[0] || null;
  const socials = [];
  
  for (const p of pairs) {
    for (const s of p.info?.socials || []) { const u = safeUrl(s.url); if (u) socials.push({ type: s.type || s.platform, url: u }); }
    for (const w of p.info?.websites || []) { const u = safeUrl(w.url); if (u) socials.push({ type: 'website', url: u }); }
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
    pairCreatedAt: primary?.pairCreatedAt || null,
    symbol: primary?.baseToken && lc(primary.baseToken.address) === lc(addr) ? primary.baseToken.symbol : primary?.quoteToken?.symbol,
    dexUrl: primary ? safeUrl(primary.url) : null,
    socials: uniq
  };
}