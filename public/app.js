/**
 * public/app.js — Zapify scanner client
 * Connects scan.html to the /api/scan serverless function.
 * All rendering uses the real API response — no dummy data.
 */

/* ─── Utilities ──────────────────────────────────────────────────────────── */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EXPLORER = 'https://robinhoodchain.blockscout.com';
const DEX_BASE  = 'https://dexscreener.com/robinhood';
const X_SEARCH  = 'https://x.com/search?q=';

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function fmtUsd(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  if (n >= 1) return '$' + Number(n).toFixed(2);
  return '$' + Number(n).toPrecision(3);
}
function pct(x) {
  if (x == null || isNaN(x)) return '—';
  return (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
}
function shortAddr(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : '—'; }
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}
function safeHref(url, fallback = '#') {
  try { const u = new URL(url); return u.protocol === 'https:' ? u.href : fallback; } catch { return fallback; }
}

/* ─── State machine ──────────────────────────────────────────────────────── */
let _currentData = null;
let _timers = [];
const later = (fn, ms) => _timers.push(setTimeout(fn, REDUCE ? Math.min(ms, 80) : ms));
const clearTimers = () => { _timers.forEach(clearTimeout); _timers = []; };

function setState(state) {
  clearTimers();
  document.body.dataset.state = state;
  const btn = $('#scanBtn');
  if (btn) btn.disabled = state === 'scanning';
  window.scrollTo({ top: 0, behavior: REDUCE ? 'auto' : 'smooth' });
}

/* ─── Scan pipeline ──────────────────────────────────────────────────────── */
async function initiateScan(address) {
  setState('scanning');
  clearScanUI(address);

  const steps = $$('#steps li');
  // Animate all steps as "active" immediately (real progress via SSE not available)
  steps.forEach((li, i) => {
    later(() => { li.className = 'active'; li.querySelector('.ms').textContent = 'reading…'; }, 100 + i * 180);
  });

  try {
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address })
    });

    const data = await response.json();

    // Mark all steps done
    steps.forEach((li, i) => {
      later(() => {
        li.className = 'done';
        li.querySelector('.ms').textContent = '✓';
      }, 120 + i * 120);
    });
    updateBar(100);

    if (!response.ok || !data.success) {
      later(() => showError(data.error || 'Scan failed', address, data?.type), 700);
      return;
    }

    _currentData = data;
    appendLog('Score', `${data.score.verdict} — ${data.score.value}/100 (subclass: ${data.score.subclass})`);
    later(() => {
      renderResult(data);
      setState('result');
    }, 800);

  } catch (err) {
    setState('error');
    setErrorContent('Network error — the API could not be reached.', address);
  }
}

function clearScanUI(address) {
  const target = $('#scanTarget');
  if (target) target.textContent = address;
  const log = $('#log');
  if (log) log.innerHTML = '';
  updateBar(0);
  const steps = $$('#steps li');
  steps.forEach(li => { li.className = ''; li.querySelector('.ms').textContent = 'waiting'; });
}

function updateBar(pct) {
  const bar = $('#bigbar');
  const pctEl = $('#pct');
  if (bar) bar.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '% complete';
}

function appendLog(key, msg) {
  const log = $('#log');
  if (!log) return;
  const p = document.createElement('p');
  const b = document.createElement('b');
  b.textContent = key;
  p.append(b, ' ' + msg);
  log.appendChild(p);
  log.scrollTop = log.scrollHeight;
}

/* ─── Error handling ─────────────────────────────────────────────────────── */
function showError(message, address, type) {
  const isSolana = type === 'solana' || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address || '');
  const isNoContract = /no contract/i.test(message);

  setErrorContent(
    isSolana ? 'Wrong chain'
      : isNoContract ? 'No contract found'
      : 'Scan error',
    address,
    isSolana ? 'That looks like a Solana address.'
      : isNoContract ? "There's nothing to scan here."
      : 'Something went wrong.',
    message
  );
  setState('error');
}

function setErrorContent(tag, address, title, detail) {
  const tagEl = $('#errTag');
  const titleEl = $('#error-title');
  const textEl = $('#errText');
  const addrEl = $('#errAddr');
  if (tagEl) tagEl.textContent = tag || 'Error';
  if (titleEl) titleEl.textContent = title || 'Something went wrong.';
  if (textEl) textEl.textContent = detail || '';
  if (addrEl) addrEl.textContent = address || '';
}

/* ─── Main render ────────────────────────────────────────────────────────── */
function renderResult(data) {
  const { token, address, score, findings, modules, coverage, scannedAt } = data;
  const { contract: c, explorer: e, market: m, funding: f, sentiment: s } = modules || {};

  // ── Token identity ──────────────────────────────────────────────────────
  const sym = escHtml(token?.symbol || '???');
  const name = escHtml(token?.name || 'Unknown token');

  const titleEl = $('#token-title');
  if (titleEl) titleEl.textContent = '$' + (token?.symbol || '???');

  const nameEl = $('.name');
  if (nameEl) nameEl.textContent = `${name}, ERC-20${token?.decimals != null ? ', ' + token.decimals + ' decimals' : ''}`;

  // Avatar initial
  const avatar = $('.avatar');
  if (avatar) {
    avatar.textContent = (token?.symbol || '?')[0].toUpperCase();
  }

  // Chips: address, chain, pair age, scan time
  const copyChip = $('.copy[data-copy]');
  if (copyChip) {
    copyChip.dataset.copy = address;
    copyChip.setAttribute('aria-label', `Copy contract address ${address}`);
    copyChip.textContent = shortAddr(address);
  }

  // Pair age chip
  const chips = $$('.meta .chip');
  if (chips[2] && m?.pairCreatedAt) {
    const ageMs = Date.now() - m.pairCreatedAt;
    chips[2].textContent = 'Pair age ' + (ageMs < 3600000
      ? Math.round(ageMs / 60000) + 'min'
      : Math.round(ageMs / 3600000) + 'h');
  }
  if (chips[3] && scannedAt) {
    const d = new Date(scannedAt);
    chips[3].textContent = 'Scanned ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Verdict / score ─────────────────────────────────────────────────────
  const scoreVal = score?.value ?? 0;
  const verdictText = score?.verdict ?? 'Low risk';
  const verdictClass = scoreVal >= 60 ? 'high' : scoreVal >= 30 ? 'medium' : 'low';

  const scoreBig = $('.score-big span');
  if (scoreBig) scoreBig.textContent = scoreVal;

  const verdictEl = $('.score-top .verdict');
  if (verdictEl) {
    verdictEl.className = `verdict ${verdictClass}`;
    verdictEl.textContent = verdictText;
  }

  // Coverage dots
  const covSpan = $('.coverage span');
  if (covSpan) covSpan.textContent = `Data coverage: ${coverage?.ok ?? 0} of ${coverage?.total ?? 5} sources`;

  const dots = $$('.coverage .dots i');
  dots.forEach((dot, i) => {
    dot.style.background = i < (coverage?.ok ?? 0) ? 'var(--lime)' : 'var(--gray-card)';
  });

  // Needle animation
  setTimeout(() => {
    const needle = $('#needle');
    if (needle) needle.style.left = scoreVal + '%';
    const zones = $$('.zones span');
    if (zones[2]) zones[2].classList.toggle('on-high', scoreVal >= 60);
  }, REDUCE ? 0 : 120);

  // ── Summary strip ───────────────────────────────────────────────────────
  renderSummary(data, c, e, m, f, s);

  // ── On-chain lens ───────────────────────────────────────────────────────
  renderSwitchboard(c);
  renderMarket(m, address);
  renderHolders(e, m, c, address);
  renderFunding(f, address, c?.owner);

  // ── X lens ─────────────────────────────────────────────────────────────
  renderSentiment(s, token?.symbol, address);

  // ── Findings list ───────────────────────────────────────────────────────
  renderFindings(findings || []);

  // ── Breakdown ───────────────────────────────────────────────────────────
  renderBreakdown(findings || []);

  // ── Evidence links ──────────────────────────────────────────────────────
  renderEvidence(address, token?.symbol, m);
}

/* ─── Summary ────────────────────────────────────────────────────────────── */
function renderSummary(data, c, e, m, f, s) {
  const summaryEl = $('.summary');
  if (!summaryEl) return;

  const parts = [];
  if (c?.ownerRenounced) parts.push('The contract is <strong>ownership-renounced</strong>');
  else if (c?.hasOwnerFn) parts.push('The <strong>owner is still active</strong>');

  if (f?.cluster_dominance >= 0.6) {
    parts.push(`<strong>${pct(f.cluster_dominance)} of buyers</strong> trace back to a common funder`);
  } else if (f?.funding_parent_share >= 0.4) {
    parts.push(`<strong>${pct(f.funding_parent_share)} of recent buyers</strong> share a single funding wallet`);
  }

  if (s?.dupRatio > 0.3 && s?.posts >= 10) {
    parts.push(`<strong>${pct(s.dupRatio)} of 𝕏 posts</strong> are copy-paste`);
  }

  if (!parts.length) {
    summaryEl.innerHTML = 'Scan complete. Review the findings below for a full breakdown.';
  } else {
    summaryEl.innerHTML = parts.join('. ') + '.';
  }

  // "but" strip
  const dgSides = $$('.dg-side p');
  if (dgSides.length >= 2) {
    const contractBits = [];
    if (c?.ownerRenounced) contractBits.push('Ownership renounced');
    if (!c?.has?.mint) contractBits.push('No mint function');
    if (!c?.has?.blacklist) contractBits.push('No blacklist');
    if (e?.verified) contractBits.push('Source verified');
    dgSides[0].textContent = contractBits.length
      ? contractBits.join(', ') + '.'
      : 'Contract data unavailable.';

    const buyerBits = [];
    if (f?.cluster_dominance >= 0.3) buyerBits.push(`${pct(f.cluster_dominance)} of buyers are clustered`);
    if (s?.dupRatio > 0.3) buyerBits.push(`${pct(s.dupRatio)} of 𝕏 posts are duplicated`);
    if (f?.dev_sold) buyerBits.push('Deployer has sold');
    dgSides[1].textContent = buyerBits.length
      ? buyerBits.join(', and ') + '.'
      : 'No major buyer or sentiment signals.';
  }
}

/* ─── Switchboard ────────────────────────────────────────────────────────── */
function renderSwitchboard(c) {
  if (!c) return;
  const ownerActive = !c.ownerRenounced && c.hasOwnerFn;
  const switches = $$('.switch');
  const defs = [
    { key: 'mint',         label: 'Mint' },
    { key: 'blacklist',    label: 'Blacklist' },
    { key: 'feeSetter',    label: 'Change tax' },
    { key: 'txLimit',      label: 'Max wallet' },
    { key: 'pause',        label: 'Pause' },
    { key: 'upgrade',      label: 'Upgradeable' },
  ];
  defs.forEach((def, i) => {
    const sw = switches[i];
    if (!sw) return;
    const present = c.has?.[def.key] ?? false;
    const live = present && ownerActive;
    sw.className = 'switch' + (live ? ' live' : '');
    const spanEl = sw.querySelector('span:last-child');
    if (spanEl) {
      if (!present) spanEl.textContent = 'Not found';
      else if (c.ownerRenounced) spanEl.textContent = 'Present, locked by renounce';
      else spanEl.textContent = 'Present — owner active';
    }
  });

  // Owner line
  const ownerLine = $('.owner-line');
  if (ownerLine) {
    if (c.ownerRenounced) {
      ownerLine.style.display = '';
      ownerLine.textContent = 'Ownership was renounced to 0x0000…dEaD, so no one can use these switches.';
    } else if (c.hasOwnerFn && c.owner) {
      ownerLine.style.display = '';
      ownerLine.style.background = 'var(--danger)';
      ownerLine.style.color = 'var(--white)';
      ownerLine.textContent = `Owner is active: ${c.owner}`;
    } else {
      ownerLine.style.display = 'none';
    }
  }
}

/* ─── Market ─────────────────────────────────────────────────────────────── */
function renderMarket(m, address) {
  const subEl = document.querySelector('.card:nth-of-type(2) .sub');
  const statsEl = document.querySelector('.stats');
  const flowBarEl = document.querySelector('.flow-bar');
  const flowSmall = document.querySelector('.flow small');

  if (!m || !m.primary) {
    if (subEl) subEl.textContent = 'No DEX pair found on Robinhood Chain.';
    if (statsEl) statsEl.innerHTML = '<div><span>Liquidity</span><b>—</b></div><div><span>Price</span><b>—</b></div><div><span>FDV</span><b>—</b></div><div><span>24h vol</span><b>—</b></div>';
    return;
  }

  if (subEl) {
    const n = m.pairs?.length || 1;
    subEl.textContent = `${n} pool${n > 1 ? 's' : ''} on Robinhood Chain.`;
  }

  if (statsEl) {
    const cells = statsEl.querySelectorAll('div');
    const vals = [fmtUsd(m.liquidityUsd), m.priceUsd ? '$' + m.priceUsd : '—', fmtUsd(m.fdv), '—'];
    // 24h volume from DexScreener
    const vol24 = m.primary?.volume?.h24;
    if (vol24 != null) vals[3] = fmtUsd(vol24);
    cells.forEach((cell, i) => {
      const b = cell.querySelector('b');
      if (b && vals[i]) b.textContent = vals[i];
    });
  }

  if (flowBarEl && m.txns24) {
    const buys = m.txns24.buys || 0;
    const sells = m.txns24.sells || 0;
    const total = buys + sells || 1;
    const buyPct = Math.round(buys / total * 100);
    const sellPct = 100 - buyPct;
    const buySpan = flowBarEl.querySelector('.buy');
    const sellSpan = flowBarEl.querySelector('.sell');
    if (buySpan) { buySpan.style.width = buyPct + '%'; buySpan.textContent = buys + ' buys'; }
    if (sellSpan) { sellSpan.style.width = sellPct + '%'; sellSpan.textContent = sells + ' sells'; }
    flowBarEl.setAttribute('aria-label', `${buys} buys and ${sells} sells in the last 24 hours`);
    if (flowSmall) {
      if (sells === 0 && buys >= 25) {
        flowSmall.textContent = '⚠ Zero sells — possible honeypot. Buys may not be reversible.';
        flowSmall.style.color = 'var(--danger)';
      } else {
        flowSmall.textContent = 'Sells are going through — no honeypot pattern in 24h trades.';
        flowSmall.style.color = '';
      }
    }
  }
}

/* ─── Holders ─────────────────────────────────────────────────────────────── */
function renderHolders(e, m, c, address) {
  const card = $$('.card')[2]; // 3rd card = holder spread
  if (!card || !e?.holders?.length) return;

  const subEl = card.querySelector('.sub');
  const stackEl = card.querySelector('.stack');
  const legendEl = card.querySelector('.legend');

  const DEAD_SET = new Set(['0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead']);

  const totalSupply = c?.totalSupply;
  if (!totalSupply) return;

  let poolPct = 0, topPct = 0, top10Pct = 0, burnPct = 0;

  let rankedWallets = [];
  e.holders.forEach(h => {
    const ha = (h.address?.hash || '').toLowerCase();
    const val = BigInt(h.value || '0');
    const frac = Number(val * 10000n / totalSupply) / 10000;
    if (DEAD_SET.has(ha)) { burnPct += frac; return; }
    if (m?.pairAddresses?.has(ha) || h.address?.is_contract) { poolPct += frac; return; }
    rankedWallets.push({ addr: ha, frac });
  });

  if (rankedWallets.length > 0) topPct = rankedWallets[0].frac;
  if (rankedWallets.length > 1) top10Pct = rankedWallets.slice(1, 10).reduce((s, w) => s + w.frac, 0);

  const restPct = Math.max(0, 1 - poolPct - topPct - top10Pct - burnPct);

  if (subEl) subEl.textContent = `${e.holders.length}+ holders. Pools and burned tokens are shown separately.`;

  if (stackEl) {
    const spans = stackEl.querySelectorAll('span');
    const vals = [poolPct, topPct, top10Pct, restPct, burnPct];
    spans.forEach((span, i) => { span.style.width = Math.max(0, vals[i] * 100).toFixed(1) + '%'; });
    stackEl.setAttribute('aria-label', `Supply: pools ${pct(poolPct)}, largest wallet ${pct(topPct)}, wallets 2–10 ${pct(top10Pct)}, everyone else ${pct(restPct)}, burned ${pct(burnPct)}`);
  }

  if (legendEl) {
    const items = legendEl.querySelectorAll('li');
    const labels = [
      ['Liquidity pools', pct(poolPct)],
      ['Largest wallet', pct(topPct)],
      ['Wallets 2 to 10', pct(top10Pct)],
      ['Everyone else', pct(restPct)],
      ['Burned', pct(burnPct)],
    ];
    items.forEach((li, i) => {
      const b = li.querySelector('b');
      const t = li.childNodes[1]; // text node after <i>
      if (b) b.textContent = labels[i][1];
      if (t) t.textContent = labels[i][0];
    });
  }
}

/* ─── Funding graph ──────────────────────────────────────────────────────── */
function renderFunding(f, tokenAddr, creator) {
  if (!f) return;
  const factsEl = $$('.card')[3]?.querySelector('.facts');
  if (factsEl) {
    const cells = factsEl.querySelectorAll('div');
    const vals = [
      [pct(f.funding_parent_share), 'of buyers share one funder', f.funding_parent_share >= 0.5],
      [pct(f.deployer_funded), 'were funded by the deployer', f.deployer_funded >= 0.1],
      [pct(f.same_block_ratio), 'of buys landed in one block', f.same_block_ratio >= 0.3],
    ];
    cells.forEach((cell, i) => {
      if (!vals[i]) return;
      const [val, label, isBad] = vals[i];
      const b = cell.querySelector('b');
      const span = cell.querySelector('span');
      if (b) b.textContent = val;
      if (span) span.textContent = label;
      cell.className = isBad ? 'bad' : '';
    });
  }

  // Draw SVG graph with real data
  drawFundingGraph(f, tokenAddr, creator);
}

function drawFundingGraph(f, tokenAddr, creator) {
  const svg = $('#graph');
  if (!svg) return;
  svg.innerHTML = ''; // clear

  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    svg.appendChild(e);
    return e;
  };

  const RED = '#c8102e', INK = '#0d0d0a', GREY = '#b5b5aa', LIME = '#ccff00', MUTED = '#5e5e55';
  const font = { 'font-family': 'Archivo,Helvetica,Arial,sans-serif' };

  const buyers = Array.from({ length: f.buyersAnalyzed || 12 }, (_, i) => ({ x: 480, y: 30 + i * 25 }));
  const hub = { x: 130, y: 105 };
  const dev = { x: 130, y: 232 };
  const curve = (a, b) => `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}`;

  const n = buyers.length || 1;
  const hubCount = Math.round(f.funding_parent_share * n);
  const devCount = Math.round(f.deployer_funded * n);
  const indepCount = n - hubCount - devCount;

  buyers.slice(0, hubCount).forEach(b => mk('path', { d: curve(hub, b), stroke: RED, 'stroke-width': 2, fill: 'none' }));
  buyers.slice(hubCount, hubCount + devCount).forEach(b => mk('path', { d: curve(dev, b), stroke: INK, 'stroke-width': 2, fill: 'none', 'stroke-dasharray': '5 4' }));
  buyers.slice(hubCount + devCount).forEach((b, i) => {
    const indep = { x: 345, y: 235 + i * 25 };
    mk('path', { d: curve(indep, b), stroke: GREY, 'stroke-width': 1.5, fill: 'none' });
    mk('circle', { cx: indep.x, cy: indep.y, r: 5, fill: GREY });
  });

  buyers.forEach((b, i) =>
    mk('circle', { cx: b.x, cy: b.y, r: 8, fill: i < hubCount ? RED : i < hubCount + devCount ? INK : '#fff', stroke: INK, 'stroke-width': 1.5 }));

  mk('text', { ...font, x: 500, y: 34, 'font-size': 12, fill: MUTED }, 'Buyers');

  if (hubCount > 0) {
    mk('circle', { cx: hub.x, cy: hub.y, r: 24, fill: RED, stroke: INK, 'stroke-width': 1.5 });
    mk('text', { ...font, x: hub.x, y: hub.y + 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 800, fill: '#fff' }, String(hubCount));
    mk('text', { ...font, x: 30, y: 52, 'font-size': 14, 'font-weight': 700, fill: INK }, 'Shared funder');
  }
  if (devCount > 0 && creator) {
    mk('rect', { x: dev.x - 24, y: dev.y - 24, width: 48, height: 48, rx: 12, fill: LIME, stroke: INK, 'stroke-width': 1.5 });
    mk('text', { ...font, x: dev.x, y: dev.y + 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 800, fill: INK }, String(devCount));
    mk('text', { ...font, x: 30, y: dev.y + 50, 'font-size': 14, 'font-weight': 700, fill: INK }, 'Deployer');
    mk('text', { ...font, x: 30, y: dev.y + 66, 'font-size': 12, fill: MUTED }, shortAddr(creator));
  }
  if (indepCount > 0) {
    mk('text', { ...font, x: 345, y: 220, 'text-anchor': 'middle', 'font-size': 12, fill: MUTED }, 'Separate funders');
  }
}

/* ─── Sentiment ──────────────────────────────────────────────────────────── */
function renderSentiment(s, symbol, address) {
  const xCol = $('.x-col');
  if (!xCol) return;

  const toneReadEl = xCol.querySelector('.tone-read b');
  const toneLabelEl = xCol.querySelector('.tone-read span');
  const tonePinEl = xCol.querySelector('#tonePin');
  const subEl = xCol.querySelector('.card .sub');
  const noteEl = xCol.querySelector('.note');

  const xQuery = encodeURIComponent('$' + (symbol || '') + ' OR ' + address.slice(0, 10));
  const xLink = `${X_SEARCH}${xQuery}`;

  if (!s) {
    if (toneReadEl) toneReadEl.textContent = '—';
    if (toneLabelEl) toneLabelEl.textContent = 'Sentiment unavailable';
    if (subEl) subEl.innerHTML = `<a href="${escHtml(xLink)}" target="_blank" rel="noopener">Search on 𝕏 ↗</a>`;
    if (noteEl) noteEl.textContent = 'Configure SENTIMENT_ENDPOINT to enable live X sentiment.';
    return;
  }

  if (toneReadEl) toneReadEl.textContent = (s.score >= 0 ? '+' : '') + s.score.toFixed(2);
  if (toneLabelEl) toneLabelEl.className = 'muted';
  if (toneLabelEl) toneLabelEl.textContent = s.label || '';
  if (subEl) subEl.textContent = `${s.posts} post${s.posts !== 1 ? 's' : ''} mention $${escHtml(symbol || '')} or its contract.`;

  // Tone pin: map -1..1 → 0%..100%
  if (tonePinEl) {
    setTimeout(() => { tonePinEl.style.left = (50 + s.score * 50) + '%'; }, REDUCE ? 0 : 800);
  }

  // Shill / scam facts
  const factsEl = xCol.querySelector('.facts');
  if (factsEl) {
    const cells = factsEl.querySelectorAll('div');
    if (cells[0]) { cells[0].querySelector('b').textContent = pct(s.dupRatio); cells[0].querySelector('span').textContent = 'Copy-paste posts'; if (s.dupRatio > 0.4) cells[0].className = 'warn'; }
    if (cells[1]) { cells[1].querySelector('b').textContent = s.scamMentions; cells[1].querySelector('span').textContent = 'Posts calling it a rug or scam'; if (s.scamMentions >= 3) cells[1].className = 'bad'; }
  }

  // Top posts
  renderPosts(s.top || [], xCol.querySelector('.posts'));
}

function renderPosts(posts, container) {
  if (!container) return;
  container.innerHTML = '';
  if (!posts.length) {
    container.innerHTML = '<p class="muted" style="font-size:14px">No high-weight posts found.</p>';
    return;
  }
  posts.forEach(p => {
    const tag = p.s > 0.1 ? `<span class="tag pos">Bullish</span>`
      : p.s < -0.1 ? `<span class="tag neg">Warning</span>`
      : '';
    const dupTag = p.w < 0.5 ? `<span class="tag dup">Low weight (dup/low followers)</span>` : '';
    const article = document.createElement('article');
    article.className = 'post' + (p.w < 0.5 ? ' dup' : '');
    article.innerHTML = `
      <div class="post-head">
        <span class="pfp">${escHtml((p.author?.username || 'U')[0].toUpperCase())}</span>
        <span><b>@${escHtml(p.author?.username || 'unknown')}</b>
          <span class="muted">${Number(p.author?.followers || 0).toLocaleString()} followers</span>
        </span>
        ${tag}${dupTag}
      </div>
      <p>${escHtml(p.text || '')}</p>
      <div class="foot">
        <span>${p.likes || 0} likes</span>
        <span>${p.reposts || 0} reposts</span>
        <span>${p.created_at ? timeAgo(Date.parse(p.created_at)) : ''}</span>
      </div>`;
    container.appendChild(article);
  });
}

/* ─── Findings ───────────────────────────────────────────────────────────── */
function renderFindings(findings) {
  const list = $('#findingList');
  if (!list) return;
  list.innerHTML = '';

  if (!findings.length) {
    list.innerHTML = '<div class="finding pass" data-sev="pass"><span class="sev-tag pass">Passed</span><div class="txt"><b>No risk flags triggered</b><span>All checks returned clean.</span></div></div>';
    return;
  }

  findings.forEach(f => {
    const sevClass = f.severity === 'high' ? 'high' : f.severity === 'medium' ? 'medium' : 'low';
    const div = document.createElement('div');
    div.className = 'finding';
    div.dataset.sev = sevClass;
    const srcLabel = f.source_url && f.source_url !== '#' ? 'Source ↗' : '—';
    const srcHref = safeHref(f.source_url, '#');
    div.innerHTML = `
      <span class="sev-tag ${sevClass}">${escHtml(f.severity.charAt(0).toUpperCase() + f.severity.slice(1))}</span>
      <div class="txt">
        <b>${escHtml(f.title)}</b>
        <span>${escHtml(f.description || '')}</span>
      </div>
      <a class="src" href="${escHtml(srcHref)}" target="_blank" rel="noopener">${srcLabel}</a>`;
    list.appendChild(div);
  });

  updateFindingFilters();
}

function updateFindingFilters() {
  const counts = { all: 0, high: 0, medium: 0, low: 0, pass: 0 };
  $$('#findingList .finding').forEach(f => {
    counts.all++;
    const sev = f.dataset.sev || 'pass';
    if (counts[sev] !== undefined) counts[sev]++;
  });
  $$('.filter button').forEach(b => {
    const k = b.dataset.filter;
    const c = counts[k] || 0;
    b.textContent = `${k.charAt(0).toUpperCase() + k.slice(1)} ${c}`;
  });
}

/* ─── Breakdown ──────────────────────────────────────────────────────────── */
function renderBreakdown(findings) {
  const bkBar = $('.bk-bar');
  const bkList = $('.bk-list');
  const formulaEl = $('.formula b');

  const high = findings.filter(f => f.severity === 'high');
  const med  = findings.filter(f => f.severity === 'medium');
  const low  = findings.filter(f => f.severity === 'low');
  const total = findings.length || 1;

  if (bkBar) {
    const spans = bkBar.querySelectorAll('span');
    const groups = [[high, 'h'], [med, 'm'], [low, 'l']];
    groups.forEach(([arr, cls], i) => {
      if (spans[i]) {
        spans[i].style.flex = arr.length;
        spans[i].textContent = arr.length ? arr.length + ' ' + ['High','Med','Low'][i] : '';
        spans[i].style.display = arr.length ? '' : 'none';
      }
    });
  }

  if (bkList) {
    const lis = bkList.querySelectorAll('li');
    const rows = [
      ...high.map(f => [`High — ${f.code}`, '']),
      ...med.map(f => [`Med — ${f.code}`, '']),
      ...low.map(f => [`Low — ${f.code}`, '']),
    ].slice(0, lis.length);
    lis.forEach((li, i) => {
      if (rows[i]) li.innerHTML = `<span>${escHtml(rows[i][0])}</span>`;
      else li.style.display = 'none';
    });
  }

  if (formulaEl && _currentData?.score) {
    formulaEl.textContent = `Score = round(100 × (1 − e^(−Σw/14))) = ${_currentData.score.value}`;
  }
}

/* ─── Evidence links ─────────────────────────────────────────────────────── */
function renderEvidence(address, symbol, m) {
  const evidenceEl = $('.evidence');
  if (!evidenceEl) return;
  const anchors = evidenceEl.querySelectorAll('a');
  const sym = (symbol || '').replace(/[^A-Za-z0-9_]/g, '');

  const links = [
    { href: `${EXPLORER}/address/${address}`, label: 'Contract', sub: 'Blockscout' },
    { href: `${EXPLORER}/token/${address}/token-holders`, label: 'Holders', sub: 'Blockscout' },
    { href: m?.dexUrl || `${DEX_BASE}/${address}`, label: 'Market', sub: 'DexScreener' },
    { href: sym ? `${X_SEARCH}${encodeURIComponent('$' + sym)}` : `${X_SEARCH}${encodeURIComponent(address)}`, label: '𝕏: ' + (sym ? '$' + sym : shortAddr(address)), sub: 'Live search' },
  ];

  anchors.forEach((a, i) => {
    if (!links[i]) return;
    a.href = safeHref(links[i].href, '#');
    const b = a.querySelector('b');
    const s = a.querySelector('span');
    if (b) b.textContent = links[i].label;
    if (s) s.textContent = links[i].sub;
  });
}

/* ─── Event listeners ────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const form = $('#scanForm');
  const input = $('#addr');
  const hintArea = $('#hint');

  function setHint(msg) {
    hintArea?.querySelector('.err')?.remove();
    if (!msg) return;
    const s = document.createElement('span');
    s.className = 'err';
    s.setAttribute('role', 'alert');
    s.textContent = msg;
    hintArea?.prepend(s);
  }

  function validateAndScan(value) {
    const v = (value || '').trim();
    if (!v) { setHint('Paste a contract address first.'); input?.focus(); return; }

    // Solana
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) {
      setHint('');
      setErrorContent('Wrong chain', v, 'That looks like a Solana address.',
        'Zapify reads Robinhood Chain, which uses 0x addresses. Find the token\'s Robinhood Chain contract and paste that instead.');
      setState('error');
      return;
    }

    // Too short
    if (/^0x/i.test(v) && v.length < 42) {
      setHint(`Address too short (${v.length} chars). Need 0x + 40 hex characters.`);
      input?.focus();
      return;
    }

    // Not EVM
    if (!/^0x[a-fA-F0-9]{40}$/.test(v)) {
      setHint("That isn't a valid address. It should be 0x followed by exactly 40 hex characters.");
      input?.focus();
      return;
    }

    setHint('');
    initiateScan(v);
  }

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    validateAndScan(input?.value);
  });

  // Data-fill chips
  $$('[data-fill]').forEach(b => b.addEventListener('click', () => {
    if (input) input.value = b.dataset.fill;
    validateAndScan(b.dataset.fill);
  }));

  // Error retry buttons
  $('#errRetry')?.addEventListener('click', () => { setState('empty'); input?.focus(); input?.select(); });
  $('#errBack')?.addEventListener('click', () => { setState('empty'); input?.focus(); });

  // Rescan
  $('#rescan')?.addEventListener('click', () => {
    const v = input?.value.trim();
    if (v) validateAndScan(v);
  });

  // Copy chips
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.copy[data-copy]');
    if (!chip) return;
    navigator.clipboard.writeText(chip.dataset.copy).catch(() => {});
    chip.setAttribute('data-copied', '');
    setTimeout(() => chip.removeAttribute('data-copied'), 1400);
  });

  // Finding filter buttons
  $$('.filter button').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      const f = btn.dataset.filter;
      $$('#findingList .finding').forEach(row => {
        row.hidden = f !== 'all' && row.dataset.sev !== f;
      });
    });
  });
});