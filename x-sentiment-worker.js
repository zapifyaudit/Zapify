/**
 * Zapify — X/Twitter sentiment proxy (Cloudflare Worker)
 *
 * The browser can't call the X API directly (it needs a secret bearer token
 * and doesn't send CORS headers). This worker does the search server-side and
 * returns a slim { posts: [...] } payload that index.html scores locally.
 *
 * Deploy:
 *   1. npx wrangler init zapify-sentiment  (paste this file as src/index.js)
 *   2. npx wrangler secret put X_BEARER_TOKEN
 *   3. set ALLOWED_ORIGIN in wrangler.toml [vars] to your site, e.g. https://zapify.xyz
 *   4. npx wrangler deploy
 *   5. in index.html set ZAPIFY_CONFIG.sentimentEndpoint = 'https://<worker>.workers.dev/'
 *
 * Request:  GET /?q=$SPAWND OR "0x716d3aea78a8e767b127ec0b2916dbbe7383a757"
 * Response: { posts: [{ id, text, created_at, likes, reposts, replies, author: { username, followers } }] }
 */

const CACHE_SECONDS = 120; // X recent-search is rate-limited; cache per query

export default {
  async fetch(request, env, ctx) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);

    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    // Only allow cashtags and 0x addresses joined by OR — stops the proxy being used as a general X search.
    if (!q || q.length > 200 || !/^(\$[A-Za-z][A-Za-z0-9_]{0,14}|"0x[a-f0-9]{40}")( OR (\$[A-Za-z][A-Za-z0-9_]{0,14}|"0x[a-f0-9]{40}"))*$/.test(q)) {
      return json({ error: 'invalid query' }, 400, cors);
    }

    const cache = caches.default;
    const cacheKey = new Request(`https://cache.zapify/${encodeURIComponent(q)}`);
    const hit = await cache.match(cacheKey);
    if (hit) return withHeaders(hit, cors);

    const api = new URL('https://api.x.com/2/tweets/search/recent');
    api.searchParams.set('query', `(${q}) -is:retweet`);
    api.searchParams.set('max_results', '100');
    api.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id');
    api.searchParams.set('expansions', 'author_id');
    api.searchParams.set('user.fields', 'username,public_metrics');

    const res = await fetch(api, { headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` } });
    if (!res.ok) return json({ error: `x api ${res.status}` }, 502, cors);
    const data = await res.json();

    const users = new Map((data.includes?.users || []).map(u => [u.id, u]));
    const posts = (data.data || []).map(t => {
      const u = users.get(t.author_id);
      return {
        id: t.id,
        text: t.text,
        created_at: t.created_at,
        likes: t.public_metrics?.like_count || 0,
        reposts: (t.public_metrics?.retweet_count || 0) + (t.public_metrics?.quote_count || 0),
        replies: t.public_metrics?.reply_count || 0,
        author: u ? { username: u.username, followers: u.public_metrics?.followers_count || 0 } : null
      };
    });

    const out = json({ posts }, 200, { ...cors, 'Cache-Control': `public, max-age=${CACHE_SECONDS}` });
    ctx.waitUntil(cache.put(cacheKey, out.clone()));
    return out;
  }
};

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
function withHeaders(res, headers) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) r.headers.set(k, v);
  return r;
}
