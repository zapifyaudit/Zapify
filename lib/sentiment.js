import { lc, shortAddr } from './utils.js';

const LEX_POS = { moon: 1, mooning: 1, bullish: 1.5, gem: 1, lfg: 1, based: .5, legit: 1.5, solid: 1, strong: 1, ath: 1, breakout: 1, undervalued: 1, love: .8, hodl: .8, hold: .3, holding: .5, early: .6, send: .6, sending: .8, locked: .8, renounced: .8, audited: 1, safe: .8, community: .4, buying: .6, bought: .5, '10x': .8, '100x': .8, pumping: .6 };
const LEX_NEG = { rug: -3, rugged: -3, rugpull: -3, scam: -3, scammer: -3, honeypot: -3, fraud: -3, drained: -2.5, exploit: -2, exploited: -2, hacked: -2, dump: -1.5, dumped: -1.5, dumping: -1.5, dev: 0, dead: -1.5, bearish: -1.5, fake: -2, avoid: -2, warning: -1.2, careful: -1, jeet: -.8, jeets: -.8, bundled: -2, bundle: -1.5, sniped: -1, snipers: -1, insider: -1.2, insiders: -1.2, ponzi: -2.5, sus: -1.2, exit: -1, sold: -.5, selling: -.5, tax: -.6, blacklisted: -2 };
const SCAM_TERMS = /\b(rug(ged|pull)?|scam(mer)?|honeypot|drained|fraud|exploit(ed)?|can'?t\s+sell|cannot\s+sell|unable\s+to\s+sell)\b/i;
const NEGATORS = new Set(['not', 'no', 'never', "isn't", 'isnt', "ain't", 'aint', 'zero', 'without']);

function scorePostText(text) {
  const toks = lc(text).replace(/https?:\/\/\S+/g, ' ').match(/[a-z0-9']+/g) || [];
  let s = 0;
  toks.forEach((w, i) => {
    let v = LEX_POS[w] ?? LEX_NEG[w] ?? 0;
    if (!v) return;
    if (NEGATORS.has(toks[i - 1]) || NEGATORS.has(toks[i - 2])) v = -v * 0.6;
    s += v;
  });
  if (/\bcan'?t\s+sell|cannot\s+sell|unable\s+to\s+sell/i.test(text)) s -= 3;
  return Math.max(-1, Math.min(1, s / 3));
}

export function analyzePosts(posts) {
  if (!posts.length) return { posts: 0, score: 0, label: 'No posts', scamMentions: 0, dupRatio: 0, top: [] };
  
  const norm = (t) => lc(t).replace(/https?:\/\/\S+|@\w+|\d+/g, '').replace(/\s+/g, ' ').trim();
  const seen = {};
  posts.forEach(p => { const k = norm(p.text); seen[k] = (seen[k] || 0) + 1; });
  const dup = Object.values(seen).filter(c => c > 1).reduce((a, c) => a + c, 0) / posts.length;

  let num = 0, den = 0, scam = 0;
  const scored = posts.map(p => {
    const s = scorePostText(p.text || '');
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
    top: scored.sort((a, b) => b.w - a.w).filter((p, i, arr) => arr.findIndex(q => norm(q.text) === norm(p.text)) === i).slice(0, 3)
  };
}

export function buildSentimentQueries(symbol, addr) {
  const out = [];
  const sym = (symbol || '').replace(/[^A-Za-z0-9_]/g, '');
  if (/^[A-Za-z][A-Za-z0-9_]{0,14}$/.test(sym)) out.push({ label: '$' + sym.toUpperCase(), q: '$' + sym.toUpperCase() });
  out.push({ label: shortAddr(addr), q: lc(addr) });
  return out;
}