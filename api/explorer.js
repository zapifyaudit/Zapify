/**
 * Zapify — Blockscout Explorer Serverless Proxy
 * GET /api/explorer?path=/tokens/0x.../holders
 */

const BASE_URL = process.env.BLOCKSCOUT_API_URL || 'https://robinhoodchain.blockscout.com/api/v2';
const cache = new Map();
const CACHE_TTL_MS = 60_000;

export default async function handler(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const path = (req.query.path || '').trim();
  if (!path || !path.startsWith('/') || path.includes('..')) {
    return res.status(400).json({ error: 'Invalid path parameter' });
  }

  // Cache check
  const cacheKey = path.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json(cached.data);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);

  try {
    const upstreamRes = await fetch(BASE_URL + path, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      },
      signal: ctrl.signal
    });
    clearTimeout(timer);

    if (upstreamRes.status === 404) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (!upstreamRes.ok) {
      return res.status(502).json({ error: `Blockscout HTTP ${upstreamRes.status}` });
    }

    const data = await upstreamRes.json();
    cache.set(cacheKey, { ts: Date.now(), data });

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json(data);
  } catch (err) {
    clearTimeout(timer);
    return res.status(502).json({ error: err.message || 'Blockscout fetch failed' });
  }
}
