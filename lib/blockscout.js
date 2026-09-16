import { CONFIG } from './config.js';
import { lc } from './utils.js';

export async function explorer(path, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(CONFIG.explorerApi + path, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Blockscout HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export async function fetchExplorer(addr) {
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
}

export async function traceFunding(wallet) {
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

export async function isHubAddress(addr) {
  const c = await explorer(`/addresses/${addr}/counters`).catch(() => null);
  return c ? Number(c.transactions_count || 0) > 2000 : false;
}