import { CONFIG } from './config.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function rpc(method, params) {
  let lastErr;
  for (const url of CONFIG.rpcUrls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
        });
        const j = await res.json();
        if (j && j.error) throw new Error(j.error.message || 'rpc error');
        return j ? j.result : null;
      } catch (e) { lastErr = e; await sleep(250 * (attempt + 1)); }
    }
  }
  throw lastErr;
}

export const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']).catch(() => null);