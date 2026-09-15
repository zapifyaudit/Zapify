/**
 * tests/sentiment.test.js
 * Unit tests for lib/sentiment.js — post scoring, dedup ratio, scam detection.
 */

import { analyzePosts, buildSentimentQueries } from '../lib/sentiment.js';

// ─── analyzePosts ─────────────────────────────────────────────────────────

test('empty posts returns zero state', () => {
  const r = analyzePosts([]);
  expect(r.posts).toBe(0);
  expect(r.score).toBe(0);
  expect(r.scamMentions).toBe(0);
  expect(r.dupRatio).toBe(0);
});

test('positive text pushes score above 0', () => {
  const posts = [{ text: '$TOKEN bullish gem solid', likes: 10, reposts: 0, replies: 0, author: { followers: 500 } }];
  const r = analyzePosts(posts);
  expect(r.score).toBeGreaterThan(0);
});

test('rug/scam text increments scamMentions', () => {
  const posts = [
    { text: 'this is a rug pull', likes: 0, reposts: 0, replies: 0, author: { followers: 100 } },
    { text: 'total scam avoid', likes: 0, reposts: 0, replies: 0, author: { followers: 100 } },
    { text: 'honeypot confirmed', likes: 0, reposts: 0, replies: 0, author: { followers: 100 } },
  ];
  const r = analyzePosts(posts);
  expect(r.scamMentions).toBeGreaterThanOrEqual(3);
});

test('"not a rug" does not count as scam mention', () => {
  const posts = [{ text: 'not a rug, checked the contract', likes: 0, reposts: 0, replies: 0, author: { followers: 100 } }];
  const r = analyzePosts(posts);
  expect(r.scamMentions).toBe(0);
});

test('"can\'t sell" penalises score', () => {
  const good = [{ text: 'token is amazing', likes: 5, reposts: 0, replies: 0, author: { followers: 200 } }];
  const bad  = [{ text: "I can't sell my tokens", likes: 5, reposts: 0, replies: 0, author: { followers: 200 } }];
  const rGood = analyzePosts(good);
  const rBad  = analyzePosts(bad);
  expect(rBad.score).toBeLessThan(rGood.score);
});

test('duplicate posts inflate dupRatio', () => {
  const text = 'Buy $TOKEN now 100x gem LFG';
  const posts = Array(5).fill(null).map(() => ({
    text, likes: 0, reposts: 0, replies: 0, author: { followers: 12 }
  }));
  const r = analyzePosts(posts);
  expect(r.dupRatio).toBeGreaterThan(0.5);
});

test('low-follower posts get halved weight (not error)', () => {
  const posts = [{ text: 'bullish', likes: 0, reposts: 0, replies: 0, author: { followers: 10 } }];
  expect(() => analyzePosts(posts)).not.toThrow();
});

// ─── buildSentimentQueries ────────────────────────────────────────────────

test('valid symbol produces cashtag query', () => {
  const qs = buildSentimentQueries('HOPPY', '0x7e57a1b2c3d4e5f60718293a4b5c6d7e8f901234');
  expect(qs.some(q => q.q === '$HOPPY')).toBe(true);
});

test('numeric-only symbol skipped (cashtag restriction)', () => {
  const qs = buildSentimentQueries('1234', '0x7e57a1b2c3d4e5f60718293a4b5c6d7e8f901234');
  expect(qs.every(q => !q.q.startsWith('$'))).toBe(true);
});

test('address query is always included', () => {
  const addr = '0x7e57a1b2c3d4e5f60718293a4b5c6d7e8f901234';
  const qs = buildSentimentQueries('', addr);
  expect(qs.some(q => q.q.startsWith('0x'))).toBe(true);
});
