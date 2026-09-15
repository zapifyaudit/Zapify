/**
 * api/sentiment.js — Vercel serverless function
 * Proxies X API v2 recent search and returns posts in the standard format.
 *
 * GET /api/sentiment?q=<query>
 *
 * Response: { posts: [ { id, text, created_at, likes, reposts, replies,
 *                        author: { username, followers } } ] }
 *
 * Accepted queries: cashtag ($TICKER) or contract address (0x…)
 * Results are cached in-memory for 120 seconds per query.
 */

const CACHE = new Map(); // query → { expires, data }
const CACHE_TTL = 120_000; // 2 minutes

// Only allow cashtags or 0x addresses as queries
const ALLOWED_QUERY_RE = /^(\$[A-Z]{1,10}|0x[a-f0-9]{40})(\s+OR\s+(\$[A-Z]{1,10}|0x[a-f0-9]{40}))*$/i;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Query (q) is required' });
  if (!ALLOWED_QUERY_RE.test(q)) {
    return res.status(400).json({ error: 'Query must be a cashtag or contract address' });
  }

  // Enforce CORS origin if configured
  const origin = req.headers.origin || '';
  const allowed = process.env.ALLOWED_ORIGIN || '';
  if (allowed && origin && origin !== allowed) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const bearer = process.env.X_BEARER_TOKEN;
  if (!bearer) {
    // Not configured — return empty rather than error so scanner still works
    return res.status(200).json({ posts: [], note: 'X_BEARER_TOKEN not configured' });
  }

  // Cache hit?
  const cached = CACHE.get(q);
  if (cached && cached.expires > Date.now()) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  try {
    const url = new URL('https://api.twitter.com/2/tweets/search/recent');
    url.searchParams.set('query', q + ' lang:en -is:retweet');
    url.searchParams.set('max_results', '100');
    url.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id');
    url.searchParams.set('user.fields', 'public_metrics,username');
    url.searchParams.set('expansions', 'author_id');

    const xRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(8000)
    });

    if (xRes.status === 429) {
      return res.status(429).json({ error: 'X API rate limit reached. Try again later.' });
    }
    if (!xRes.ok) {
      return res.status(200).json({ posts: [], error: `X API returned ${xRes.status}` });
    }

    const json = await xRes.json();
    const tweets = json.data || [];
    const users = (json.includes?.users || []).reduce((m, u) => (m[u.id] = u, m), {});

    const posts = tweets.map(t => {
      const u = users[t.author_id] || {};
      return {
        id: t.id,
        text: t.text,
        created_at: t.created_at,
        likes: t.public_metrics?.like_count || 0,
        reposts: t.public_metrics?.retweet_count || 0,
        replies: t.public_metrics?.reply_count || 0,
        author: {
          username: u.username || 'unknown',
          followers: u.public_metrics?.followers_count || 0
        }
      };
    });

    const result = { posts };
    CACHE.set(q, { expires: Date.now() + CACHE_TTL, data: result });
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(result);

  } catch (err) {
    return res.status(200).json({ posts: [], error: 'Failed to reach X API' });
  }
}