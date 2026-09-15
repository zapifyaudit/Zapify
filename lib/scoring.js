import { lc } from './utils.js';

export const WEIGHTS = {
  NO_SELLS: 10, WHALE_MAJORITY: 8, NO_DEX_PAIR: 6, VERY_LOW_LIQUIDITY: 6,
  MINT_AUTHORITY: 5, BLACKLIST_FUNCTION: 5, SELLS_SUPPRESSED: 5, SHARED_FUNDING_PARENT: 5,
  DEPLOYER_FUNDED_BUYERS: 5, CLUSTER_DOMINANCE: 5, SCAM_MENTIONS_ON_X: 5,
  UPGRADEABLE_PROXY: 4, MUTABLE_TAX: 4, DEV_SELLING: 4,
  UNVERIFIED_SOURCE: 4, TOP_HOLDER_CONCENTRATION: 4,
  TRADING_SWITCH: 3, LOW_LIQUIDITY: 3, TOP10_CONCENTRATION: 3, SAME_BLOCK_CONCENTRATION: 3,
  UNIFORM_BUY_SIZES: 3, NEGATIVE_SENTIMENT: 3, COPY_PASTE_SHILLING: 3,
  PAUSABLE: 2, FRESH_WALLETS_RATIO: 2, COORDINATED_BUYING: 2,
  OWNER_ACTIVE: 2, FEW_HOLDERS: 2, NO_SOCIALS: 2,
  TX_LIMITS: 1, NEW_PAIR: 1
};

export function computeScore(findings) {
  let totalWeight = 0;
  let hasHardGate = false;

  const hardGates = ['NO_SELLS', 'WHALE_MAJORITY', 'NO_DEX_PAIR', 'VERY_LOW_LIQUIDITY', 'MINT_AUTHORITY', 'BLACKLIST_FUNCTION', 'SELLS_SUPPRESSED', 'SHARED_FUNDING_PARENT', 'DEPLOYER_FUNDED_BUYERS', 'CLUSTER_DOMINANCE', 'SCAM_MENTIONS_ON_X'];

  for (const f of findings) {
    totalWeight += (WEIGHTS[f.code] || 0);
    if (hardGates.includes(f.code)) hasHardGate = true;
  }

  let score = Math.round(100 * (1 - Math.exp(-totalWeight / 14)));
  if (hasHardGate && score < 80) score = 80; // Hard gate enforcement

  let verdict = 'Low risk';
  if (score >= 60) verdict = 'High risk';
  else if (score >= 30) verdict = 'Caution';

  return { value: score, verdict };
}

export function computeSubclass(flowFeatures) {
  if (!flowFeatures) return 'Unknown';
  if (flowFeatures.funding_parent_share >= 0.6 || flowFeatures.cluster_dominance >= 0.7) return 'Extraction';
  if (flowFeatures.funding_parent_share >= 0.2 || flowFeatures.cluster_dominance >= 0.3) return 'Coordinated';
  return 'Organic';
}