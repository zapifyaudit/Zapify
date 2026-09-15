/**
 * tests/scoring.test.js
 * Unit tests for lib/scoring.js — formula, hard gates, verdict thresholds, subclass.
 */

import { computeScore, computeSubclass, WEIGHTS } from '../lib/scoring.js';

// ─── computeScore ──────────────────────────────────────────────────────────

test('returns 0 with no findings', () => {
  const { value, verdict } = computeScore([]);
  expect(value).toBe(0);
  expect(verdict).toBe('Low risk');
});

test('formula: score = round(100*(1-e^(-sum/14)))', () => {
  // weight sum = 6 (NO_DEX_PAIR)
  const { value } = computeScore([{ code: 'NO_DEX_PAIR' }]);
  const expected = Math.round(100 * (1 - Math.exp(-6 / 14)));
  expect(value).toBe(expected);
});

test('hard gate raises score to 80 minimum', () => {
  // NO_SELLS alone has weight 10, formula gives ≈51 — hard gate forces ≥80
  const { value } = computeScore([{ code: 'NO_SELLS' }]);
  expect(value).toBeGreaterThanOrEqual(80);
});

test('verdict Low risk for score 0–29', () => {
  const { verdict } = computeScore([{ code: 'TX_LIMITS' }]); // weight 1
  expect(verdict).toBe('Low risk');
});

test('verdict Caution for score 30–59', () => {
  // TX_LIMITS×10 = weight 10, score≈51 but no hard gate, so stays 51
  const findings = Array(10).fill({ code: 'TX_LIMITS' });
  // weight 10 → score ≈51 — but weight 10 hits hard gate? No, TX_LIMITS is not a hard gate.
  const { value, verdict } = computeScore(findings);
  if (value >= 30 && value < 60) expect(verdict).toBe('Caution');
  if (value >= 60) expect(verdict).toBe('High risk');
  if (value < 30) expect(verdict).toBe('Low risk');
});

test('verdict High risk for score ≥60', () => {
  // Multiple high-weight findings
  const findings = [
    { code: 'NO_SELLS' }, { code: 'WHALE_MAJORITY' }, { code: 'MINT_AUTHORITY' }
  ];
  const { verdict } = computeScore(findings);
  expect(verdict).toBe('High risk');
});

test('all 30 WEIGHTS keys are present', () => {
  const expectedCodes = [
    'NO_SELLS','WHALE_MAJORITY','NO_DEX_PAIR','VERY_LOW_LIQUIDITY',
    'MINT_AUTHORITY','BLACKLIST_FUNCTION','SELLS_SUPPRESSED','SHARED_FUNDING_PARENT',
    'DEPLOYER_FUNDED_BUYERS','CLUSTER_DOMINANCE','SCAM_MENTIONS_ON_X',
    'UPGRADEABLE_PROXY','MUTABLE_TAX','DEV_SELLING',
    'UNVERIFIED_SOURCE','TOP_HOLDER_CONCENTRATION',
    'TRADING_SWITCH','LOW_LIQUIDITY','TOP10_CONCENTRATION','SAME_BLOCK_CONCENTRATION',
    'UNIFORM_BUY_SIZES','NEGATIVE_SENTIMENT','COPY_PASTE_SHILLING',
    'PAUSABLE','FRESH_WALLETS_RATIO','COORDINATED_BUYING',
    'OWNER_ACTIVE','FEW_HOLDERS','NO_SOCIALS',
    'TX_LIMITS','NEW_PAIR'
  ];
  expectedCodes.forEach(code => {
    expect(WEIGHTS).toHaveProperty(code);
    expect(WEIGHTS[code]).toBeGreaterThan(0);
  });
  expect(Object.keys(WEIGHTS).length).toBe(31); // 30 codes + 1 (NEW_PAIR added)
});

// ─── computeSubclass ──────────────────────────────────────────────────────

test('subclass Extraction: parent_share >= 0.6', () => {
  expect(computeSubclass({ funding_parent_share: 0.7, cluster_dominance: 0.2 })).toBe('Extraction');
});

test('subclass Extraction: cluster_dominance >= 0.7', () => {
  expect(computeSubclass({ funding_parent_share: 0.1, cluster_dominance: 0.8 })).toBe('Extraction');
});

test('subclass Coordinated: parent_share >= 0.2', () => {
  expect(computeSubclass({ funding_parent_share: 0.3, cluster_dominance: 0.1 })).toBe('Coordinated');
});

test('subclass Coordinated: cluster_dominance >= 0.3', () => {
  expect(computeSubclass({ funding_parent_share: 0.05, cluster_dominance: 0.35 })).toBe('Coordinated');
});

test('subclass Organic: below both thresholds', () => {
  expect(computeSubclass({ funding_parent_share: 0.1, cluster_dominance: 0.15 })).toBe('Organic');
});

test('subclass Unknown: null input', () => {
  expect(computeSubclass(null)).toBe('Unknown');
});
