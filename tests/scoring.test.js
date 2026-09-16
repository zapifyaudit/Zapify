import { computeScore, computeSubclass, WEIGHTS } from '../lib/scoring.js';

function assert(condition, message) {
  if (!condition) throw new Error('Assertion failed: ' + message);
}

console.log('Testing Scoring Engine...');

// Test 1: Empty findings
const s0 = computeScore([]);
assert(s0.value === 0 && s0.verdict === 'Low risk', 'Zero findings should yield score 0');

// Test 2: Low risk findings
const s1 = computeScore([{ code: 'TX_LIMITS' }, { code: 'NEW_PAIR' }]);
assert(s1.value > 0 && s1.value < 30 && s1.verdict === 'Low risk', 'Small weights should be Low risk');

// Test 3: Hard gate triggers min score 80
const sGate = computeScore([{ code: 'MINT_AUTHORITY' }]); // weight 5 alone would be ~30, but hard gate forces >= 80
assert(sGate.value >= 80 && sGate.verdict === 'High risk', 'Hard gate MINT_AUTHORITY must enforce min score 80');

// Test 4: Subclass detection
const subOrganic = computeSubclass({ funding_parent_share: 0.1, cluster_dominance: 0.1 });
assert(subOrganic === 'Organic', 'Low cluster/funding share should be Organic');

const subCoord = computeSubclass({ funding_parent_share: 0.25, cluster_dominance: 0.2 });
assert(subCoord === 'Coordinated', 'Medium cluster/funding share should be Coordinated');

const subExtract = computeSubclass({ funding_parent_share: 0.65, cluster_dominance: 0.5 });
assert(subExtract === 'Extraction', 'High cluster/funding share should be Extraction');

// Test 5: Coordinated buying produces weight 2, score > 0 (not 0)
const sCoord = computeScore([{ code: 'COORDINATED_BUYING', severity: 'medium' }]);
assert(sCoord.value === 13 && sCoord.verdict === 'Low risk', 'COORDINATED_BUYING should yield score 13');

// Test 6: CLUSTER_DOMINANCE is a hard gate
const sDominance = computeScore([{ code: 'CLUSTER_DOMINANCE', severity: 'high' }]);
assert(sDominance.value >= 80 && sDominance.verdict === 'High risk', 'CLUSTER_DOMINANCE must trigger hard gate (>=80)');

console.log('✅ Scoring engine tests passed!');
