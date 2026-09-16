import { analyzePosts, buildSentimentQueries } from '../lib/sentiment.js';

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

console.log('Testing Sentiment Engine...');

// Test 1: Empty posts
const s0 = analyzePosts([]);
assert(s0.posts === 0 && s0.score === 0, 'Zero posts should yield 0 score');

// Test 2: Bullish posts
const sBullish = analyzePosts([
  { text: 'Great project, bullish and safe! Audited by team.', likes: 10, reposts: 5, author: { username: 'trader1', followers: 1000 } },
  { text: 'Undervalued gem, solid liquidity and based dev!', likes: 20, reposts: 2, author: { username: 'gem_hunter', followers: 500 } }
]);
assert(sBullish.score > 0.15 && sBullish.label === 'Bullish', 'Positive words should score Bullish');

// Test 3: Scam terms
const sScam = analyzePosts([
  { text: 'This is a rug pull! Scam dev dumped everything!', likes: 5, reposts: 1, author: { username: 'victim1', followers: 100 } },
  { text: 'Honeypot token, cannot sell my tokens! Avoid!', likes: 8, reposts: 3, author: { username: 'victim2', followers: 200 } }
]);
assert(sScam.scamMentions >= 2, 'Scam terms must be counted');
assert(sScam.score < 0, 'Scam terms should yield negative score');

// Test 4: Query building
const q = buildSentimentQueries('HOPPY', '0x7e57a1b2c3d4e5f60718293a4b5c6d7e8f901234');
assert(q.some(x => x.q === '$HOPPY'), 'Queries must contain cashtag $HOPPY');
assert(q.some(x => x.q === '0x7e57a1b2c3d4e5f60718293a4b5c6d7e8f901234'), 'Queries must contain contract address');

console.log('✅ Sentiment engine tests passed!');
