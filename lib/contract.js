import { rpc, call } from './robinhood.js';
import { ZERO, DEAD, lc } from './utils.js';
import { CONFIG } from './config.js';

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

export async function probeContract(addr) {
  try {
    const [code, chainIdHex] = await Promise.all([
      rpc('eth_getCode', [addr, 'latest']).catch(() => null),
      rpc('eth_chainId', []).catch(() => null)
    ]);

    if (chainIdHex && parseInt(chainIdHex, 16) !== CONFIG.chainId) {
      // If chainId returned does not match, log warning
      console.warn('RPC chainId mismatch:', chainIdHex);
    }

    if (code === '0x') return { isContract: false };
    if (!code) return null; // RPC failed or timed out

    const [nameR, symR, decR, supR, ownR, gOwnR, slot] = await Promise.all([
      call(addr, SEL.name), call(addr, SEL.symbol), call(addr, SEL.decimals), call(addr, SEL.totalSupply),
      call(addr, SEL.owner), call(addr, SEL.getOwner),
      rpc('eth_getStorageAt', [addr, EIP1967_IMPL_SLOT, 'latest']).catch(() => null)
    ]);

    const impl = decodeAddress(slot);
    const proxyImpl = impl && impl !== ZERO ? impl : null;
    let scanCode = lc(code);

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
  } catch (err) {
    console.warn('probeContract error:', err.message);
    return null;
  }
}