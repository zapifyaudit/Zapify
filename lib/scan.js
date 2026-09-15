/**
 * lib/scan.js — Re-exports shared scan orchestration utilities.
 *
 * The HTTP handler lives in api/scan.js (Vercel serverless function).
 * This file exists so other modules can import shared helpers without
 * pulling in the HTTP layer.
 */

export { analyzePosts, buildSentimentQueries } from './sentiment.js';
export { computeScore, computeSubclass } from './scoring.js';
export { computeFlowFeatures } from './funding.js';
export { probeContract } from './contract.js';
export { fetchExplorer } from './blockscout.js';
export { fetchMarket } from './dexscreener.js';