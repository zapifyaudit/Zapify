import { CONFIG } from './config.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function rpc(method, params, timeoutMs = 4500) {
  let lastErr;
  for (const url of CONFIG.rpcUrls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: ctrl.signal
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (j && j.error) throw new Error(j.error.message || 'rpc error');
        return j ? j.result : null;
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        await sleep(150 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

export const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']).catch(() => null);