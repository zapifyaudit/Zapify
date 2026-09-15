export const ZERO = '0x0000000000000000000000000000000000000000';
export const DEAD = new Set([ZERO, '0x000000000000000000000000000000000000dead']);
export const lc = (s) => (s || '').toLowerCase();

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

export function safeUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' ? x.href : null;
  } catch { return null; }
}

export function shortAddr(a) {
  return a ? a.slice(0, 6) + '…' + a.slice(-4) : '—';
}

export function fmtUsd(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + Number(n).toPrecision(3);
}

export function pct(x) {
  if (x == null || isNaN(x)) return '—';
  return (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
}

export function resolveAddressType(address) {
  const a = (address || '').trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) return 'evm';
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) return 'solana';
  return 'unknown';
}