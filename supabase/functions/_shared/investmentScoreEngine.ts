/**
 * Variant-aware Investment Score Engine
 * -------------------------------------
 * Single source of truth for scoring inputs and weight maps used across:
 *   - generate-investment-report (composite)
 *   - fork-investment-report (financial, due diligence)
 *   - backfill-investment-scores
 *
 * Confidence-weighting: missing dimensions are excluded and the remaining
 * weights are rebalanced proportionally. If fewer than 3 dimensions have
 * usable inputs, the total score is suppressed (returns null).
 */

export interface ScoringInput {
  propertyPrice: number;
  weeklyRent: number;
  propertyType?: string;
  medianSuburbPrice?: number;
  priceGrowth1Year?: number;
  priceGrowth3Year?: number;
  vacancyRate?: number;
  daysOnMarket?: number;
  walkScore?: number;
  populationGrowth?: number;
  medianIncome?: number;
  unemploymentRate?: number;
  commuteTimeCBD?: number;
  schoolsNearby?: number;
  cashFlow?: number;
  lvr?: number;
  state?: string;
}

export type ScoreVariant = 'composite' | 'financial' | 'due_diligence';

export interface DimensionResult {
  score: number;
  weight: number;
  details: string;
  available: boolean;
}

export interface ScoreOutput {
  totalScore: number;
  grade: string;
  recommendation: string;
  variant: ScoreVariant;
  breakdown: Record<string, DimensionResult>;
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  risks: string[];
}

export function transformScoringInput(raw: any): ScoringInput {
  const property = raw?.property || {};
  const demographics = raw?.demographics || {};
  const locationIntelligence = raw?.locationIntelligence || {};
  const financials = raw?.financials || {};
  const marketData = demographics.marketData || financials.marketData || {};
  const keyMetrics = financials.keyMetrics || {};
  const commute = locationIntelligence.commute || {};
  const schools = locationIntelligence.schools || {};

  return {
    propertyPrice: property.price || 0,
    weeklyRent: property.weeklyRent || 0,
    propertyType: property.propertyType || 'house',
    medianSuburbPrice: marketData.medianPrice,
    priceGrowth1Year: marketData.priceGrowth1Year || marketData.annualGrowth,
    priceGrowth3Year: marketData.priceGrowth3Year,
    vacancyRate: marketData.vacancyRate,
    daysOnMarket: marketData.daysOnMarket,
    // RF-7.2B.1B2 — `?? ` not `|| `. A Places category whose provider call
    // failed now stores null, and `|| 0` would floor it to a measured zero
    // here. Every neighbouring line already reads the value bare; these two
    // were the outliers.
    walkScore: locationIntelligence.walkScore ?? undefined,
    populationGrowth: demographics.populationGrowth,
    medianIncome: demographics.medianIncome || demographics.medianHouseholdIncome,
    unemploymentRate: demographics.unemploymentRate,
    commuteTimeCBD: commute.durationMinutes,
    schoolsNearby: schools.schoolsWithin3km ?? undefined,
    cashFlow: keyMetrics.weeklyNet,
    lvr: keyMetrics.lvr,
    state: raw?.state || demographics.state,
  };
}

// ─── Dimension scorers (pure, available flag tracks missing inputs) ────────

function dYield(i: ScoringInput): DimensionResult {
  if (!i.weeklyRent || !i.propertyPrice) return { score: 0, weight: 0, details: 'No rent or price', available: false };
  const gy = (i.weeklyRent * 52 / i.propertyPrice) * 100;
  let score = gy >= 6 ? 100 : gy >= 5 ? 85 : gy >= 4 ? 70 : gy >= 3 ? 50 : gy >= 2 ? 30 : 10;
  if (i.cashFlow !== undefined) {
    if (i.cashFlow > 0) score = Math.min(100, score + 10);
    else if (i.cashFlow < -100) score = Math.max(0, score - 20);
  }
  return { score, weight: 0, details: `Gross yield: ${gy.toFixed(2)}%`, available: true };
}

function dCashflow(i: ScoringInput): DimensionResult {
  if (i.cashFlow === undefined) return { score: 0, weight: 0, details: 'No cashflow', available: false };
  let score = 50;
  if (i.cashFlow > 200) score = 95;
  else if (i.cashFlow > 100) score = 85;
  else if (i.cashFlow > 0) score = 75;
  else if (i.cashFlow > -100) score = 60;
  else if (i.cashFlow > -300) score = 40;
  else if (i.cashFlow > -500) score = 25;
  else score = 10;
  return { score, weight: 0, details: `Weekly net: $${i.cashFlow.toFixed(0)}`, available: true };
}

function dServiceability(i: ScoringInput): DimensionResult {
  if (i.lvr === undefined) return { score: 0, weight: 0, details: 'No LVR', available: false };
  let score = 100;
  if (i.lvr > 95) score = 25;
  else if (i.lvr > 90) score = 40;
  else if (i.lvr > 85) score = 55;
  else if (i.lvr > 80) score = 65;
  else if (i.lvr > 70) score = 80;
  else if (i.lvr > 60) score = 90;
  // An LVR band is a leverage proxy. No borrower income, living costs,
  // liabilities, rental shading or buffer rate is an input here, so this
  // dimension must never be read as a lender's serviceability assessment
  // (audit QA-17); the basis travels with the score and is printed under it.
  return { score, weight: 0, details: `LVR ${i.lvr}%; no borrower serviceability assessment is part of this score`, available: true };
}

function dGrowth(i: ScoringInput): DimensionResult {
  const g1 = i.priceGrowth1Year;
  const g3 = i.priceGrowth3Year;
  if (g1 === undefined && g3 === undefined && !i.populationGrowth) {
    return { score: 0, weight: 0, details: 'No growth data', available: false };
  }
  let score = 50;
  if (g1 !== undefined) {
    if (g1 >= 10) score += 30;
    else if (g1 >= 5) score += 20;
    else if (g1 >= 2) score += 10;
    else if (g1 < 0) score -= 10;
  }
  if (g3 !== undefined && g1 !== undefined && g3 > g1 && g3 > 15) score += 20;
  else if (g3 !== undefined && g3 > 20) score += 15;
  if (i.populationGrowth && i.populationGrowth > 2) score += 10;
  return { score: Math.min(100, score), weight: 0, details: `1yr: ${g1 ?? 'N/A'}%`, available: true };
}

function dLocation(i: ScoringInput): DimensionResult {
  if (!i.walkScore && !i.commuteTimeCBD && !i.schoolsNearby && !i.state) {
    return { score: 0, weight: 0, details: 'No location data', available: false };
  }
  let score = 0;
  if (i.walkScore) { if (i.walkScore >= 90) score += 35; else if (i.walkScore >= 70) score += 28; else if (i.walkScore >= 50) score += 18; else if (i.walkScore >= 25) score += 8; else score += 3; } else score += 12;
  if (i.commuteTimeCBD) { if (i.commuteTimeCBD <= 15) score += 30; else if (i.commuteTimeCBD <= 25) score += 25; else if (i.commuteTimeCBD <= 40) score += 18; else if (i.commuteTimeCBD <= 60) score += 10; else score += 3; } else score += 12;
  if (i.schoolsNearby) { if (i.schoolsNearby >= 8) score += 20; else if (i.schoolsNearby >= 5) score += 18; else if (i.schoolsNearby >= 3) score += 14; else if (i.schoolsNearby >= 1) score += 8; } else score += 8;
  if (i.state && ['NSW', 'VIC', 'QLD'].includes(i.state)) score += 15;
  else if (i.state && ['WA', 'SA'].includes(i.state)) score += 12;
  else if (i.state) score += 8;
  return { score: Math.min(100, score), weight: 0, details: `Walk: ${i.walkScore || 'N/A'}`, available: true };
}

function dDemand(i: ScoringInput): DimensionResult {
  if (i.vacancyRate === undefined && i.daysOnMarket === undefined && i.unemploymentRate === undefined) {
    return { score: 0, weight: 0, details: 'No demand data', available: false };
  }
  let score = 50;
  if (i.vacancyRate !== undefined) { if (i.vacancyRate < 1) score += 30; else if (i.vacancyRate < 1.5) score += 25; else if (i.vacancyRate < 2) score += 18; else if (i.vacancyRate < 3) score += 10; else if (i.vacancyRate < 4) score += 0; else if (i.vacancyRate < 5) score -= 8; else score -= 15; }
  if (i.daysOnMarket !== undefined) { if (i.daysOnMarket < 15) score += 20; else if (i.daysOnMarket < 30) score += 15; else if (i.daysOnMarket < 45) score += 10; else if (i.daysOnMarket < 60) score += 5; else if (i.daysOnMarket < 90) score -= 5; else score -= 12; }
  if (i.medianSuburbPrice) { const r = i.propertyPrice / i.medianSuburbPrice; if (r < 0.85) score += 18; else if (r < 0.95) score += 12; else if (r <= 1.05) score += 5; else if (r <= 1.15) score -= 5; else if (r <= 1.25) score -= 10; else score -= 15; }
  if (i.unemploymentRate !== undefined) { if (i.unemploymentRate < 2.5) score += 18; else if (i.unemploymentRate < 3.5) score += 12; else if (i.unemploymentRate < 4.5) score += 6; else if (i.unemploymentRate < 5.5) score += 0; else if (i.unemploymentRate < 7) score -= 8; else score -= 15; }
  return { score: Math.min(100, Math.max(0, score)), weight: 0, details: `Vacancy: ${i.vacancyRate ?? 'N/A'}%`, available: true };
}

function dRisk(i: ScoringInput): DimensionResult {
  let score = 100;
  if (i.lvr) { if (i.lvr > 95) score -= 45; else if (i.lvr > 90) score -= 35; else if (i.lvr > 85) score -= 25; else if (i.lvr > 80) score -= 18; else if (i.lvr > 70) score -= 8; else if (i.lvr <= 60) score += 5; }
  if (i.cashFlow !== undefined) { if (i.cashFlow < -400) score -= 35; else if (i.cashFlow < -300) score -= 28; else if (i.cashFlow < -200) score -= 20; else if (i.cashFlow < -100) score -= 12; else if (i.cashFlow < 0) score -= 6; else if (i.cashFlow > 150) score += 8; else if (i.cashFlow > 50) score += 4; }
  if (i.propertyType === 'unit' || i.propertyType === 'apartment') score -= 10;
  else if (i.propertyType === 'townhouse') score -= 5;
  else if (i.propertyType === 'house') score += 3;
  if (i.priceGrowth1Year && i.priceGrowth1Year > 25) score -= 25;
  else if (i.priceGrowth1Year && i.priceGrowth1Year > 20) score -= 18;
  else if (i.priceGrowth1Year && i.priceGrowth1Year > 15) score -= 10;
  if (i.vacancyRate !== undefined) { if (i.vacancyRate > 6) score -= 22; else if (i.vacancyRate > 5) score -= 16; else if (i.vacancyRate > 4) score -= 10; }
  return { score: Math.max(0, Math.min(100, score)), weight: 0, details: `LVR: ${i.lvr ?? 'N/A'}%`, available: i.lvr !== undefined || i.cashFlow !== undefined };
}

// ─── Variant weight maps ────────────────────────────────────────────────────

const COMPOSITE_WEIGHTS = { yieldScore: 15, growthScore: 40, locationScore: 25, demandScore: 15, riskScore: 5 };
const FINANCIAL_WEIGHTS = { yieldScore: 30, cashflowScore: 25, serviceabilityScore: 20, riskScore: 15, growthScore: 10 };
// tenantFitScore is gone from this map because it was never a dimension: it
// was dDemand computed twice (see scorePropertyFundamentals). Its 20 points
// return to the two real measurements they were diluting.
const DUE_DILIGENCE_WEIGHTS = { locationScore: 40, demandScore: 35, planningRiskScore: 15, liveabilityScore: 10 };

function gradeAndRec(totalScore: number): { grade: string; recommendation: string } {
  if (totalScore >= 85) return { grade: 'A+', recommendation: 'STRONG BUY' };
  if (totalScore >= 75) return { grade: 'A', recommendation: 'BUY' };
  if (totalScore >= 65) return { grade: 'B+', recommendation: 'BUY' };
  if (totalScore >= 58) return { grade: 'B', recommendation: 'HOLD/BUY' };
  if (totalScore >= 50) return { grade: 'C+', recommendation: 'HOLD' };
  if (totalScore >= 42) return { grade: 'C', recommendation: 'HOLD' };
  if (totalScore >= 32) return { grade: 'D', recommendation: 'CAUTION' };
  return { grade: 'F', recommendation: 'AVOID' };
}

function assemble(
  variant: ScoreVariant,
  dims: Record<string, DimensionResult>,
  weights: Record<string, number>,
  minAvailable = 3,
): ScoreOutput | null {
  const available = Object.entries(dims).filter(([, d]) => d.available);
  if (available.length < minAvailable) return null;
  const totalAvailWeight = available.reduce((s, [k]) => s + (weights[k] || 0), 0);
  if (totalAvailWeight <= 0) return null;

  let totalScore = 0;
  const breakdown: Record<string, DimensionResult> = {};
  for (const [key, dim] of Object.entries(dims)) {
    if (dim.available) {
      const rebalancedWeight = ((weights[key] || 0) / totalAvailWeight) * 100;
      totalScore += dim.score * (rebalancedWeight / 100);
      breakdown[key] = { ...dim, weight: Math.round(rebalancedWeight) };
    } else {
      breakdown[key] = { ...dim, weight: 0 };
    }
  }
  const rounded = Math.round(totalScore);
  const { grade, recommendation } = gradeAndRec(rounded);
  return { totalScore: rounded, grade, recommendation, variant, breakdown, strengths: [], weaknesses: [], opportunities: [], risks: [] };
}

export function scoreComposite(raw: any): ScoreOutput | null {
  const i = transformScoringInput(raw);
  if (i.propertyPrice <= 0) return null;
  return assemble('composite', {
    yieldScore: dYield(i),
    growthScore: dGrowth(i),
    locationScore: dLocation(i),
    demandScore: dDemand(i),
    riskScore: dRisk(i),
  }, COMPOSITE_WEIGHTS);
}

export function scoreFinancial(raw: any): ScoreOutput | null {
  const i = transformScoringInput(raw);
  if (i.propertyPrice <= 0) return null;
  return assemble('financial', {
    yieldScore: dYield(i),
    cashflowScore: dCashflow(i),
    serviceabilityScore: dServiceability(i),
    riskScore: dRisk(i),
    growthScore: dGrowth(i),
  }, FINANCIAL_WEIGHTS);
}

export function scorePropertyFundamentals(raw: any): ScoreOutput | null {
  const i = transformScoringInput(raw);
  if (i.propertyPrice <= 0) return null;
  // planningRisk and liveability are derived proxies from existing inputs.
  //
  // This scorer used to carry a fifth dimension, `tenantFitScore`, that was
  // literally `dDemand(i)` computed a second time — the same data counted
  // twice toward `assemble`'s three-available floor, and toward the total.
  // Combined with that floor it meant a row without BOTH real dimensions
  // (location + demand) could never score, and the Due Diligence report
  // shipped with `investment_score: null` on all 11 rows ever produced — its
  // verdict page read "Graded  at  out of 100" with the holes left in.
  //
  // Four honest dimensions now, and the floor is stated here rather than
  // inherited: at least two dimensions, of which at least one must be a real
  // measurement (location or demand) — two proxies alone are not a score.
  const planningRisk: DimensionResult = i.state
    ? { score: 70, weight: 0, details: 'Proxy: state-baseline planning risk', available: true }
    : { score: 0, weight: 0, details: 'No state data', available: false };
  const liveability: DimensionResult = i.walkScore
    ? { score: Math.min(100, (i.walkScore || 0) + 20), weight: 0, details: `WalkScore: ${i.walkScore}`, available: true }
    : { score: 0, weight: 0, details: 'No walk score', available: false };
  const location = dLocation(i);
  const demand = dDemand(i);
  if (!location.available && !demand.available) return null;
  return assemble('due_diligence', {
    locationScore: location,
    demandScore: demand,
    planningRiskScore: planningRisk,
    liveabilityScore: liveability,
  }, DUE_DILIGENCE_WEIGHTS, 2);
}

export function scoreForVariant(variant: ScoreVariant, raw: any): ScoreOutput | null {
  if (variant === 'financial') return scoreFinancial(raw);
  if (variant === 'due_diligence') return scorePropertyFundamentals(raw);
  return scoreComposite(raw);
}
