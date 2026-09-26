import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  admissibleInputs,
  claimPermits,
  policyStamp,
  PRODUCTION_SCORING_AUTHORITY,
  type ClaimPermits,
  NOT_ASSESSED_REASON,
  OVERALL_GRADE_UNAVAILABLE,
  type ScoredDimension,
  type ScoringPolicyStamp,
} from '../_shared/reports/market/scoringInputPolicy.pure.ts';
// ME-8 (15 Sep 2026) — Scoring V2 is the production grade engine. This service
// reaches it through the activation module and through nothing else: the
// engine's own modules are never imported here, which is what keeps "V1
// relabelled as V2" a compile error rather than a convention.
import {
  SCORING_V2_ACTIVATION,
  dwellingTypeFor,
  scoreForProduction,
  type ProductionScoringInput,
} from '../_shared/reports/market/scoringV2Production.pure.ts';
// IPV-1.1.0 (16 Sep 2026) — Location's verification is DERIVED from the
// enrichment's own RF-7.2B acquisition stamp, in this service, never read
// from a request field a caller could assert.
import { verifiedLocationInputs } from '../_shared/reports/market/locationInputVerification.pure.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface InvestmentScoringInput {
  propertyPrice: number;
  weeklyRent: number;
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
  propertyType?: string;
  /**
   * Inputs verified for this property, by name — **internal and test use only.**
   *
   * It widens what a dimension may COUNT and does nothing to who may GRADE:
   * the scoring authority is decided separately, so verifying inputs can never
   * make the legacy methodology authoritative again. Genuinely trusted evidence
   * is destined for Scoring V2 after an explicit activation, not for V1.
   *
   * Not propagated by the live request path: `transformInputData` rebuilds the
   * nested request shape field by field and does not carry this through, and no
   * caller sets it. Present so the policy can be exercised directly.
   */
  verifiedInputs?: string[];
}

interface DimensionScore {
  score: number;
  weight: number;
  details: string;
  hasData: boolean;
  dataPoints: string[]; // names of real inputs present (drives confidence)
  excluded?: boolean;   // true if dimension was dropped from the headline score
}

interface InvestmentScore {
  totalScore: number | null;
  grade: string;
  recommendation: string;
  breakdown: {
    yieldScore: DimensionScore;
    growthScore: DimensionScore;
    locationScore: DimensionScore;
    demandScore: DimensionScore;
    riskScore: DimensionScore;
  };
  coverage: {
    dimensionsScored: number;
    totalDimensions: number;
    coverageRatio: number;       // 0..1
    weightCovered: number;       // sum of nominal weights of scored dims (0..1)
    dataInsufficient: boolean;   // true when < 3 dimensions had data
    partialLabel: string;        // e.g. "Score based on 3 of 5 dimensions"
    cotalityReady: true;         // structural marker: drop-in for cotality-service envelopes
  };
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  risks: string[];
  /** How this run decided what could count, and whether a grade was issued. */
  policy?: ScoringPolicyStamp;
  /** The client-facing statement where no grade may be issued; null when one was. */
  evidenceStatement?: { heading: string; value: string; explanation: string } | null;
  /** Per-dimension reason, in the client's words, for each dimension not assessed. */
  notAssessed?: Record<string, string>;
  /** What the record offered before the policy ruled, for the audit trail. */
  dataPointsPresented?: Record<string, string[]>;
}

// Minimum number of dimensions required to publish a quantitative headline score.
// Below this, the renderer should fall back to qualitative SWOT only.
const MIN_DIMENSIONS_FOR_HEADLINE_SCORE = 3;

// Transform nested input structure to flat structure expected by scoring logic
function transformInputData(rawInput: any): InvestmentScoringInput {
  // Handle both flat and nested input structures for backward compatibility
  if (rawInput.propertyPrice !== undefined) {
    // Already in flat format
    return rawInput as InvestmentScoringInput;
  }

  // Extract from nested structure
  const property = rawInput.property || {};
  const demographics = rawInput.demographics || {};
  const locationIntelligence = rawInput.locationIntelligence || {};
  const financials = rawInput.financials || {};

  // Extract market data from demographics or financial data
  const marketData = demographics.marketData || financials.marketData || {};
  
  // Extract key metrics from financials
  const keyMetrics = financials.keyMetrics || {};
  
  // Extract location amenities.
  //
  // RF-7.2B.1B2 — `?? ` rather than `|| `, and never a `0` floor. A Places
  // category whose provider call FAILED now stores null, and `null || 0`
  // would hand this scorer a measured zero: `hasNum(0)` is true, so the
  // dimension counts as EVIDENCED, while `if (input.walkScore)` is falsy, so
  // it scores nothing — a livability score depressed by an outage nobody
  // measured. A successful zero is preserved (`0 ?? undefined` is `0`), which
  // is the whole distinction. The sibling builder below already read
  // `|| undefined`; these two lines were the pair that did not.
  const walkScore = locationIntelligence.walkScore ?? undefined;
  const schools = locationIntelligence.schools || {};
  const commute = locationIntelligence.commute || {};
  
  return {
    propertyPrice: property.price || 0,
    weeklyRent: property.weeklyRent || 0,
    propertyType: property.propertyType || 'house',
    medianSuburbPrice: marketData.medianPrice || undefined,
    priceGrowth1Year: marketData.priceGrowth1Year || marketData.annualGrowth || undefined,
    priceGrowth3Year: marketData.priceGrowth3Year || undefined,
    vacancyRate: marketData.vacancyRate || undefined,
    daysOnMarket: marketData.daysOnMarket || undefined,
    walkScore,
    populationGrowth: demographics.populationGrowth || undefined,
    medianIncome: demographics.medianIncome || demographics.medianHouseholdIncome || undefined,
    unemploymentRate: demographics.unemploymentRate || undefined,
    commuteTimeCBD: commute.durationMinutes || undefined,
    schoolsNearby: schools.schoolsWithin3km ?? undefined,
    cashFlow: keyMetrics.weeklyNet || undefined,
    lvr: keyMetrics.lvr || undefined,
    state: rawInput.state || demographics.state || undefined
  };
}


/**
 * The Scoring V2 request, read from the same nested shape the generator has
 * always posted plus the two fields it now adds: `subject` (the trusted
 * geography the evidence was keyed on) and `marketEvidence` (the points its
 * adapters extracted — Domain suburb performance, the ABS population series).
 *
 * The buyer's position is read exactly where V1 read it (`financials.
 * keyMetrics.lvr`, `.weeklyNet`) and reaches Finance Suitability only. The
 * location inputs are read with the same `??` semantics the RF-7.2B.1B2 gate
 * pins on `transformInputData`, and the input policy decides whether they may
 * count (today: no, until repaired).
 */
function productionInputFrom(rawInput: any, now: Date): ProductionScoringInput {
  const property = rawInput.property || {};
  const financials = rawInput.financials || {};
  const locationIntelligence = rawInput.locationIntelligence || {};
  const keyMetrics = financials.keyMetrics || {};
  const locationVerification = verifiedLocationInputs(
    rawInput.locationIntelligence ?? null,
    rawInput.locationSubject && typeof rawInput.locationSubject === 'object'
      ? rawInput.locationSubject
      : {},
  );
  console.log(
    `📍 Location verification: [${locationVerification.verified.join(', ') || 'none'}]`
    + (locationVerification.notes.length ? ` — ${locationVerification.notes.join('; ')}` : ''),
  );
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null;

  const propertyType = str(property.propertyType);
  const subjectIn = rawInput.subject && typeof rawInput.subject === 'object' ? rawInput.subject : {};
  const marketIn = rawInput.marketEvidence && typeof rawInput.marketEvidence === 'object' ? rawInput.marketEvidence : {};
  const points = marketIn.points && typeof marketIn.points === 'object' ? marketIn.points : {};
  const providersConsulted = Array.isArray(marketIn.providersConsulted) ? marketIn.providersConsulted : [];
  const providersUnavailable = Array.isArray(marketIn.providersUnavailable)
    ? marketIn.providersUnavailable.filter((u: unknown) => u && typeof u === 'object')
    : [];

  return {
    subject: {
      suburb: str(subjectIn.suburb),
      postcode: str(subjectIn.postcode),
      state: str(subjectIn.state) ?? str(rawInput.state),
      dwellingType: dwellingTypeFor(propertyType),
      resolvedFrom: str(subjectIn.resolvedFrom) as ProductionScoringInput['subject']['resolvedFrom'],
    },
    market: { points, providersConsulted, providersUnavailable },
    property: {
      price: (num(property.price) ?? 0) > 0 ? num(property.price) : null,
      weeklyRent: (num(property.weeklyRent) ?? 0) > 0 ? num(property.weeklyRent) : null,
      annualOutgoings: num(financials.expenses?.annualTotal) ?? null,
      propertyType,
    },
    finance: {
      lvr: num(keyMetrics.lvr),
      weeklyCashFlow: num(keyMetrics.weeklyNet),
    },
    location: {
      walkScore: locationIntelligence.walkScore ?? null,
      commuteTimeCBD: locationIntelligence.commute?.durationMinutes ?? null,
      /*
       * Where that commute was measured TO, as `location-intelligence-service`
       * recorded it. An enrichment written before the destination was stored
       * carries none, and `scoreLocation` then behaves exactly as it did.
       *
       * `urbanCentre.pure.ts` has the reason: Golden Square's commute was
       * measured to Melbourne at 114 minutes and scored 0 of 100 on a
       * property five minutes from Bendigo's CBD.
       */
      commuteDestination: locationIntelligence.commute?.destination
        ? {
          label: locationIntelligence.commute.destination as string,
          ownCentre: (locationIntelligence.commute.destinationOwnCentre ?? 'unknown') as
            'yes' | 'no' | 'unknown',
        }
        : null,
      schoolsNearby: locationIntelligence.schools?.schoolsWithin3km ?? null,
      /*
       * The per-category counts and distances the enrichment already
       * publishes. `scoreLocation` prefers these over `walkScore`, because
       * the composite is five capped terms over lookups that cap at ten
       * results and 62.8% of the corpus lands at 90 or above, while distance
       * saturates nowhere. `?? null` rather than `|| null`, and no `[]`
       * floor: an empty array would be read as "measured, nothing found".
       */
      amenities: Array.isArray(locationIntelligence.amenities)
        ? locationIntelligence.amenities
        : null,
    },
    // DERIVED from the enrichment's RF-7.2B acquisition stamp, never read
    // from the request: the stamp must name the same subject the caller is
    // scoring (`locationSubject`, restated by the generator) and the stage
    // that produced each reading must have run. A stampless enrichment —
    // every row persisted before RF-7.2B — verifies nothing and scores
    // exactly as before. The wiring event the input policy required is
    // recorded in `scoringInputPolicy.pure.ts` (IPV 1.1.0) and the rule
    // lives in `locationInputVerification.pure.ts`.
    verifiedInputs: locationVerification.verified,
    locationPointRefusal: locationVerification.pointRefusal ?? null,
    evidenceWithheldReason: str(rawInput.evidenceWithheldReason),
    now,
  };
}


// ============= AREA SCORING TYPES & LOGIC =============

interface AreaScoringInput {
  scope: 'suburb' | 'zipcode' | 'state';
  priceGrowth1Year?: number;
  priceGrowth3Year?: number;
  medianPrice?: number;
  vacancyRate?: number;
  daysOnMarket?: number;
  populationGrowth?: number;
  medianIncome?: number;
  unemploymentRate?: number;
  walkScore?: number;
  schoolsNearby?: number;
  commuteTimeCBD?: number;
  state?: string;
  rentalYield?: number;
  supplyPipeline?: number; // new dwellings approved
  infrastructureSpend?: number; // nearby infrastructure investment
}

interface AreaScore {
  totalScore: number | null;
  grade: string;
  recommendation: string;
  scoreType: 'area';
  scope: string;
  breakdown: {
    marketMomentum: DimensionScore;
    economicStrength: DimensionScore;
    livability: DimensionScore;
    rentalMarket: DimensionScore;
    futureOutlook: DimensionScore;
  };
  coverage: {
    dimensionsScored: number;
    totalDimensions: number;
    coverageRatio: number;
    weightCovered: number;
    dataInsufficient: boolean;
    partialLabel: string;
    cotalityReady: true;
  };
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  risks: string[];
}

function transformAreaInput(rawInput: any): AreaScoringInput {
  const demographics = rawInput.demographics || {};
  const locationIntelligence = rawInput.locationIntelligence || {};
  const marketData = demographics.marketData || {};

  return {
    scope: rawInput.scope || 'suburb',
    priceGrowth1Year: marketData.priceGrowth1Year || marketData.annualGrowth || undefined,
    priceGrowth3Year: marketData.priceGrowth3Year || undefined,
    medianPrice: marketData.medianPrice || undefined,
    vacancyRate: marketData.vacancyRate || undefined,
    daysOnMarket: marketData.daysOnMarket || undefined,
    populationGrowth: demographics.populationGrowth || undefined,
    medianIncome: demographics.medianIncome || demographics.medianHouseholdIncome || undefined,
    unemploymentRate: demographics.unemploymentRate || undefined,
    walkScore: locationIntelligence.walkScore || undefined,
    schoolsNearby: locationIntelligence.schools?.schoolsWithin3km || undefined,
    commuteTimeCBD: locationIntelligence.commute?.durationMinutes || undefined,
    state: rawInput.state || demographics.state || undefined,
    rentalYield: marketData.rentalYield || marketData.grossRentalYield || undefined,
    supplyPipeline: demographics.supplyPipeline || undefined,
    infrastructureSpend: demographics.infrastructureSpend || undefined,
  };
}

/**
 * Confidence-weighted aggregator.
 *
 * Each dimension declares hasData (does it have any real inputs?). Dimensions
 * with no data are dropped from the headline score and their weight is
 * proportionally redistributed across the remaining dimensions. If fewer than
 * MIN_DIMENSIONS_FOR_HEADLINE_SCORE dimensions have data, the headline score
 * is suppressed (totalScore = null) and consumers should fall back to the
 * qualitative SWOT only.
 *
 * Cotality-ready: when the cotality-service starts returning live envelopes
 * for growth / vacancy / DOM / median price / unemployment etc., hasData
 * simply flips true on the relevant dimensions and the math works unchanged.
 */
function aggregateDimensions<K extends string>(
  dims: Record<K, { score: number; details: string; hasData: boolean; dataPoints: string[] }>,
  weights: Record<K, number>,
): {
  totalScore: number | null;
  breakdown: Record<K, DimensionScore>;
  coverage: InvestmentScore['coverage'];
} {
  const keys = Object.keys(dims) as K[];
  const scored = keys.filter((k) => dims[k].hasData);
  const weightCovered = scored.reduce((s, k) => s + weights[k], 0);

  const dataInsufficient = scored.length < MIN_DIMENSIONS_FOR_HEADLINE_SCORE || weightCovered <= 0;

  let totalScore: number | null = null;
  if (!dataInsufficient) {
    const weighted = scored.reduce((s, k) => s + dims[k].score * (weights[k] / weightCovered), 0);
    totalScore = Math.round(Math.max(0, Math.min(100, weighted)));
  }

  const breakdown = {} as Record<K, DimensionScore>;
  for (const k of keys) {
    const d = dims[k];
    breakdown[k] = {
      score: d.score,
      // effective weight after rebalance (0 if excluded), expressed as %
      weight: d.hasData && !dataInsufficient ? Math.round((weights[k] / weightCovered) * 100) : 0,
      details: d.details,
      hasData: d.hasData,
      dataPoints: d.dataPoints,
      excluded: !d.hasData,
    };
  }

  const partialLabel = dataInsufficient
    ? `Insufficient data — qualitative review only (${scored.length} of ${keys.length} dimensions)`
    : scored.length === keys.length
      ? `Full coverage (${keys.length} of ${keys.length} dimensions)`
      : `Partial score: ${scored.length} of ${keys.length} dimensions`;

  return {
    totalScore,
    breakdown,
    coverage: {
      dimensionsScored: scored.length,
      totalDimensions: keys.length,
      coverageRatio: scored.length / keys.length,
      weightCovered,
      dataInsufficient,
      partialLabel,
      cotalityReady: true,
    },
  };
}

function calculateAreaScore(input: AreaScoringInput): AreaScore {
  const marketMomentum = calcMarketMomentum(input);
  const economicStrength = calcEconomicStrength(input);
  const livability = calcLivability(input);
  const rentalMarket = calcRentalMarket(input);
  const futureOutlook = calcFutureOutlook(input);

  // Per-dimension data presence (real inputs only — no defaults counted).
  const hasNum = (v: any) => typeof v === 'number' && !Number.isNaN(v);


  const mmPoints: string[] = [];
  if (hasNum(input.priceGrowth1Year)) mmPoints.push('priceGrowth1Year');
  if (hasNum(input.priceGrowth3Year)) mmPoints.push('priceGrowth3Year');
  if (hasNum(input.daysOnMarket)) mmPoints.push('daysOnMarket');

  const esPoints: string[] = [];
  if (hasNum(input.unemploymentRate)) esPoints.push('unemploymentRate');
  if (hasNum(input.medianIncome)) esPoints.push('medianIncome');
  if (hasNum(input.populationGrowth)) esPoints.push('populationGrowth');

  const livPoints: string[] = [];
  if (hasNum(input.walkScore)) livPoints.push('walkScore');
  if (hasNum(input.schoolsNearby)) livPoints.push('schoolsNearby');
  if (hasNum(input.commuteTimeCBD)) livPoints.push('commuteTimeCBD');

  const rmPoints: string[] = [];
  if (hasNum(input.vacancyRate)) rmPoints.push('vacancyRate');
  if (hasNum(input.rentalYield)) rmPoints.push('rentalYield');

  const foPoints: string[] = [];
  if (hasNum(input.populationGrowth)) foPoints.push('populationGrowth');
  if (hasNum(input.infrastructureSpend)) foPoints.push('infrastructureSpend');
  if (hasNum(input.supplyPipeline)) foPoints.push('supplyPipeline');
  if (hasNum(input.priceGrowth1Year)) foPoints.push('priceGrowth1Year');

  const dims = {
    marketMomentum: { ...marketMomentum, hasData: mmPoints.length > 0, dataPoints: mmPoints },
    economicStrength: { ...economicStrength, hasData: esPoints.length > 0, dataPoints: esPoints },
    livability: { ...livability, hasData: livPoints.length > 0, dataPoints: livPoints },
    rentalMarket: { ...rentalMarket, hasData: rmPoints.length > 0, dataPoints: rmPoints },
    futureOutlook: { ...futureOutlook, hasData: foPoints.length > 0, dataPoints: foPoints },
  };

  const weights = {
    marketMomentum: 0.30,
    economicStrength: 0.25,
    livability: 0.15,
    rentalMarket: 0.15,
    futureOutlook: 0.15,
  };

  const { totalScore, breakdown, coverage } = aggregateDimensions(dims, weights);

  const { grade, recommendation } = coverage.dataInsufficient
    ? { grade: 'N/A', recommendation: `Insufficient quantitative data for ${input.scope} grade — see qualitative review below` }
    : determineAreaGrade(totalScore as number, input.scope);

  const swot = analyzeAreaSWOT(input, { marketMomentum, economicStrength, livability, rentalMarket, futureOutlook });

  return {
    totalScore,
    grade,
    recommendation,
    scoreType: 'area',
    scope: input.scope,
    breakdown,
    coverage,
    ...swot,
  };
}


function calcMarketMomentum(input: AreaScoringInput): { score: number; details: string } {
  let score = 50;
  const factors: string[] = [];
  const g1 = input.priceGrowth1Year || 0;
  const g3 = input.priceGrowth3Year || 0;

  if (g1 >= 10) { score += 30; factors.push('Strong 1yr growth (10%+)'); }
  else if (g1 >= 5) { score += 20; factors.push('Good 1yr growth (5-10%)'); }
  else if (g1 >= 2) { score += 10; factors.push('Moderate 1yr growth (2-5%)'); }
  else if (g1 < 0) { score -= 15; factors.push('Negative 1yr growth'); }

  if (g3 > 20) { score += 15; factors.push('Strong 3yr trend'); }
  else if (g3 > 10) { score += 8; factors.push('Solid 3yr trend'); }

  if (input.daysOnMarket !== undefined) {
    if (input.daysOnMarket < 25) { score += 10; factors.push('Fast-moving market'); }
    else if (input.daysOnMarket > 70) { score -= 10; factors.push('Slow market liquidity'); }
  }

  return { score: Math.min(100, Math.max(0, score)), details: factors.join('. ') || 'Moderate market momentum' };
}

function calcEconomicStrength(input: AreaScoringInput): { score: number; details: string } {
  let score = 50;
  const factors: string[] = [];

  if (input.unemploymentRate !== undefined) {
    if (input.unemploymentRate < 3) { score += 25; factors.push('Very low unemployment (<3%)'); }
    else if (input.unemploymentRate < 4.5) { score += 15; factors.push('Low unemployment'); }
    else if (input.unemploymentRate > 6) { score -= 15; factors.push('High unemployment (>6%)'); }
  }

  if (input.medianIncome) {
    if (input.medianIncome > 100000) { score += 20; factors.push('High median income'); }
    else if (input.medianIncome > 75000) { score += 10; factors.push('Above-average income'); }
    else if (input.medianIncome < 50000) { score -= 10; factors.push('Below-average income'); }
  }

  if (input.populationGrowth !== undefined) {
    if (input.populationGrowth > 3) { score += 15; factors.push('Strong population growth (>3%)'); }
    else if (input.populationGrowth > 1.5) { score += 8; factors.push('Good population growth'); }
    else if (input.populationGrowth < 0) { score -= 10; factors.push('Population decline'); }
  }

  return { score: Math.min(100, Math.max(0, score)), details: factors.join('. ') || 'Average economic indicators' };
}

function calcLivability(input: AreaScoringInput): { score: number; details: string } {
  let score = 0;
  const factors: string[] = [];

  // Walk score (max 35)
  if (input.walkScore) {
    if (input.walkScore >= 80) { score += 35; factors.push('Excellent walkability'); }
    else if (input.walkScore >= 60) { score += 25; factors.push('Good walkability'); }
    else if (input.walkScore >= 40) { score += 15; factors.push('Some walkability'); }
    else { score += 5; factors.push('Car-dependent'); }
  } else { score += 15; }

  // Schools (max 25)
  if (input.schoolsNearby) {
    if (input.schoolsNearby >= 6) { score += 25; factors.push('Excellent school access'); }
    else if (input.schoolsNearby >= 3) { score += 18; factors.push('Good school access'); }
    else { score += 8; factors.push('Limited school access'); }
  } else { score += 10; }

  // Commute (max 25)
  if (input.commuteTimeCBD) {
    if (input.commuteTimeCBD <= 20) { score += 25; factors.push('Excellent CBD access'); }
    else if (input.commuteTimeCBD <= 40) { score += 18; factors.push('Good CBD access'); }
    else if (input.commuteTimeCBD <= 60) { score += 10; factors.push('Moderate CBD access'); }
    else { score += 3; factors.push('Distant from CBD'); }
  } else { score += 10; }

  // State bonus (max 15)
  if (input.state && ['NSW', 'VIC', 'QLD'].includes(input.state)) { score += 15; }
  else if (input.state && ['WA', 'SA'].includes(input.state)) { score += 10; }
  else { score += 5; }

  return { score: Math.min(100, score), details: factors.join('. ') || 'Average livability' };
}

function calcRentalMarket(input: AreaScoringInput): { score: number; details: string } {
  let score = 50;
  const factors: string[] = [];

  if (input.vacancyRate !== undefined) {
    if (input.vacancyRate < 1) { score += 30; factors.push('Extremely tight vacancy (<1%)'); }
    else if (input.vacancyRate < 2) { score += 20; factors.push('Tight rental market (<2%)'); }
    else if (input.vacancyRate < 3) { score += 10; factors.push('Balanced rental market'); }
    else if (input.vacancyRate > 4) { score -= 15; factors.push('Oversupplied rental market'); }
  }

  if (input.rentalYield !== undefined) {
    if (input.rentalYield >= 6) { score += 20; factors.push('Exceptional area yield (6%+)'); }
    else if (input.rentalYield >= 4.5) { score += 12; factors.push('Strong area yield (4.5-6%)'); }
    else if (input.rentalYield >= 3) { score += 5; factors.push('Average area yield'); }
    else { score -= 10; factors.push('Low area yield (<3%)'); }
  }

  return { score: Math.min(100, Math.max(0, score)), details: factors.join('. ') || 'Average rental market' };
}

function calcFutureOutlook(input: AreaScoringInput): { score: number; details: string } {
  let score = 50;
  const factors: string[] = [];

  if (input.populationGrowth !== undefined) {
    if (input.populationGrowth > 3) { score += 20; factors.push('High population growth fuels demand'); }
    else if (input.populationGrowth > 1.5) { score += 10; factors.push('Healthy population growth'); }
    else if (input.populationGrowth < 0) { score -= 15; factors.push('Shrinking population a concern'); }
  }

  if (input.infrastructureSpend !== undefined && input.infrastructureSpend > 0) {
    score += 15; factors.push('Active infrastructure investment');
  }

  if (input.supplyPipeline !== undefined) {
    if (input.supplyPipeline > 5000) { score -= 10; factors.push('High dwelling supply pipeline'); }
    else if (input.supplyPipeline > 2000) { score += 5; factors.push('Moderate new supply'); }
  }

  // Market overheating risk
  const g1 = input.priceGrowth1Year || 0;
  if (g1 > 20) { score -= 15; factors.push('Overheating risk from rapid growth'); }
  else if (g1 > 15) { score -= 8; factors.push('Growth pace may cool'); }

  return { score: Math.min(100, Math.max(0, score)), details: factors.join('. ') || 'Neutral future outlook' };
}

function determineAreaGrade(score: number, scope: string): { grade: string; recommendation: string } {
  const scopeLabel = scope === 'state' ? 'State' : scope === 'zipcode' ? 'Postcode' : 'Suburb';
  if (score >= 85) return { grade: 'A+', recommendation: `PRIME ${scopeLabel.toUpperCase()} - Outstanding investment fundamentals across all area metrics` };
  if (score >= 75) return { grade: 'A', recommendation: `STRONG ${scopeLabel.toUpperCase()} - Excellent area with solid growth and economic drivers` };
  if (score >= 65) return { grade: 'B+', recommendation: `PROMISING ${scopeLabel.toUpperCase()} - Good area with favorable market dynamics` };
  if (score >= 55) return { grade: 'B', recommendation: `STABLE ${scopeLabel.toUpperCase()} - Moderate investment appeal, monitor trends` };
  if (score >= 45) return { grade: 'C+', recommendation: `MIXED ${scopeLabel.toUpperCase()} - Some positives but notable concerns exist` };
  if (score >= 35) return { grade: 'C', recommendation: `EMERGING ${scopeLabel.toUpperCase()} - Below average with limited near-term appeal` };
  return { grade: 'D', recommendation: `WEAK ${scopeLabel.toUpperCase()} - Significant challenges across key area metrics` };
}

function analyzeAreaSWOT(input: AreaScoringInput, scores: any) {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];
  const risks: string[] = [];

  if (scores.marketMomentum.score >= 70) strengths.push('Strong market momentum and price growth');
  if (scores.economicStrength.score >= 70) strengths.push('Robust local economy and employment');
  if (scores.livability.score >= 70) strengths.push('High livability with good amenities');
  if (scores.rentalMarket.score >= 70) strengths.push('Tight rental market with strong yields');

  if (scores.marketMomentum.score < 40) weaknesses.push('Weak or declining market momentum');
  if (scores.economicStrength.score < 40) weaknesses.push('Economic headwinds or high unemployment');
  if (scores.rentalMarket.score < 40) weaknesses.push('Oversupplied rental market');

  if (input.populationGrowth && input.populationGrowth > 2) opportunities.push('Strong population growth driving long-term demand');
  if (input.infrastructureSpend && input.infrastructureSpend > 0) opportunities.push('Infrastructure investment boosting area appeal');
  if (input.vacancyRate !== undefined && input.vacancyRate < 1.5) opportunities.push('Tight vacancy creating rental growth opportunity');

  const g1 = input.priceGrowth1Year || 0;
  if (g1 > 15) risks.push('Rapid price growth may indicate market cooling ahead');
  if (input.unemploymentRate && input.unemploymentRate > 5) risks.push('Elevated unemployment poses economic risk');
  if (input.supplyPipeline && input.supplyPipeline > 4000) risks.push('Large development pipeline may suppress price growth');

  return { strengths, weaknesses, opportunities, risks };
}

// ============= MAIN SERVER =============

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  console.log('Investment scoring service invoked with method:', req.method);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json();
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[investment-scoring-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[investment-scoring-service] Authenticated user: ${userId}`);
    
    const rawInput: any = body;
    console.log('Raw input received:', JSON.stringify(rawInput, null, 2));

    // Route to area scoring if scope is provided
    const scope = rawInput.scope;
    if (scope && ['suburb', 'zipcode', 'state'].includes(scope)) {
      console.log(`📊 Area scoring mode: ${scope}`);
      const areaInput = transformAreaInput(rawInput);
      console.log('Transformed area input:', JSON.stringify(areaInput, null, 2));
      const areaScore = calculateAreaScore(areaInput);
      return new Response(JSON.stringify({ success: true, data: areaScore }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ME-8 — the production grade engine. Every property scoring request is
    // answered by Scoring V2 while the activation record approves it; the
    // legacy V1 path below is retained as the recorded methodology of the
    // stored corpus and for the area scorer, and is never reached for a
    // property while `approved` is true.
    if (SCORING_V2_ACTIVATION.approved) {
      const record = scoreForProduction(productionInputFrom(rawInput, new Date()));
      console.log(
        `📊 Scoring V2 (${record.policy.methodologyVersion}): `
        + `${record.policy.gradeIssued ? `grade ${record.grade} at ${record.totalScore}` : 'grade withheld'} — `
        + `measured ${record.policy.measuredDimensions.join(', ') || 'nothing'}`
        + (record.gradeGaps.length ? `; gaps: ${record.gradeGaps.map((g) => `${g.dimension} (${g.detail})`).join('; ')}` : '')
        // Eligibility 5.0.0: the letter follows the score, and where the
        // evidence alone would not carry it the caution travels beside it.
        + (record.evidenceCaution ? `; caution (evidence alone carries ${record.evidenceCaution.supports}): ${record.evidenceCaution.cautions.join(' ')}` : ''),
      );
      return new Response(JSON.stringify({ success: true, data: record }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Property-specific scoring (legacy V1 — unreached while V2 is approved)
    const input: InvestmentScoringInput = transformInputData(rawInput);
    console.log('Transformed input for scoring:', JSON.stringify(input, null, 2));

    const investmentScore = calculateInvestmentScore(input);
    
    return new Response(JSON.stringify({ 
      success: true, 
      data: investmentScore 
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in investment scoring service:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to calculate investment score';
    return new Response(JSON.stringify({ 
      error: errorMessage,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function calculateInvestmentScore(input: InvestmentScoringInput): InvestmentScore {
  // Calculate individual component scores (0-100)
  const yieldScore = calculateYieldScore(input);
  const growthScore = calculateGrowthScore(input);
  const locationScore = calculateLocationScore(input);
  const demandScore = calculateDemandScore(input);
  const riskScore = calculateRiskScore(input);

  const hasNum = (v: any) => typeof v === 'number' && !Number.isNaN(v);

  // Per-dimension data presence (no defaults masquerading as signal).
  // Cotality-ready: when cotality-service envelopes land, these flip true.
  const yieldPoints: string[] = [];
  if (hasNum(input.propertyPrice) && input.propertyPrice > 0) yieldPoints.push('propertyPrice');
  if (hasNum(input.weeklyRent) && input.weeklyRent > 0) yieldPoints.push('weeklyRent');
  if (hasNum(input.cashFlow)) yieldPoints.push('cashFlow');
  // Yield needs BOTH price and rent to be meaningful
  const yieldHasData = yieldPoints.includes('propertyPrice') && yieldPoints.includes('weeklyRent');

  const growthPoints: string[] = [];
  if (hasNum(input.priceGrowth1Year)) growthPoints.push('priceGrowth1Year');
  if (hasNum(input.priceGrowth3Year)) growthPoints.push('priceGrowth3Year');
  if (hasNum(input.populationGrowth)) growthPoints.push('populationGrowth');

  const locationPoints: string[] = [];
  if (hasNum(input.walkScore)) locationPoints.push('walkScore');
  if (hasNum(input.commuteTimeCBD)) locationPoints.push('commuteTimeCBD');
  if (hasNum(input.schoolsNearby) && (input.schoolsNearby as number) > 0) locationPoints.push('schoolsNearby');

  const demandPoints: string[] = [];
  if (hasNum(input.vacancyRate)) demandPoints.push('vacancyRate');
  if (hasNum(input.daysOnMarket)) demandPoints.push('daysOnMarket');
  if (hasNum(input.medianSuburbPrice) && (input.medianSuburbPrice as number) > 0) demandPoints.push('medianSuburbPrice');
  if (hasNum(input.unemploymentRate)) demandPoints.push('unemploymentRate');

  const riskPoints: string[] = [];
  if (hasNum(input.lvr)) riskPoints.push('lvr');
  if (hasNum(input.cashFlow)) riskPoints.push('cashFlow');
  if (hasNum(input.vacancyRate)) riskPoints.push('vacancyRate');
  if (hasNum(input.daysOnMarket)) riskPoints.push('daysOnMarket');
  if (hasNum(input.priceGrowth1Year)) riskPoints.push('priceGrowth1Year');

  // The forward-only policy decides what may actually count. An input is
  // admitted only when the dimension OWNS it and it is either operator-entered
  // or declared verified — so a per-state walk-score template, a fabricated
  // commute and a buyer's own leverage all stop reaching a property grade.
  // Refused inputs remain visible in `dataPointsPresented` for the audit trail.
  const verified = Array.isArray(input.verifiedInputs) ? input.verifiedInputs : [];
  const admitted = (dimension: ScoredDimension, presented: string[]) =>
    admissibleInputs(dimension, presented, verified);

  const yieldAdmitted = admitted('yield', yieldPoints);
  const growthAdmitted = admitted('growth', growthPoints);
  const locationAdmitted = admitted('location', locationPoints);
  const demandAdmitted = admitted('demand', demandPoints);
  const riskAdmitted = admitted('risk', riskPoints);

  // Yield still needs BOTH price and rent; the policy narrows what may be
  // counted, it never relaxes a dimension's own requirement.
  const yieldStillHasData = yieldHasData
    && yieldAdmitted.includes('propertyPrice') && yieldAdmitted.includes('weeklyRent');

  const dims = {
    yieldScore: { ...yieldScore, hasData: yieldStillHasData, dataPoints: yieldAdmitted },
    growthScore: { ...growthScore, hasData: growthAdmitted.length > 0, dataPoints: growthAdmitted },
    locationScore: { ...locationScore, hasData: locationAdmitted.length > 0, dataPoints: locationAdmitted },
    demandScore: { ...demandScore, hasData: demandAdmitted.length > 0, dataPoints: demandAdmitted },
    riskScore: { ...riskScore, hasData: riskAdmitted.length > 0, dataPoints: riskAdmitted },
  };

  const presentedByDimension: Record<string, string[]> = {
    yieldScore: yieldPoints, growthScore: growthPoints, locationScore: locationPoints,
    demandScore: demandPoints, riskScore: riskPoints,
  };

  const weights = {
    yieldScore: 0.15,
    growthScore: 0.40,   // capital appreciation potential
    locationScore: 0.25,
    demandScore: 0.15,
    riskScore: 0.05,
  };

  const { totalScore: computedTotal, breakdown, coverage } = aggregateDimensions(dims, weights);

  const measuredNow = (Object.keys(dims) as Array<keyof typeof dims>)
    .filter((k) => dims[k].hasData)
    .map((k) => k.replace(/Score$/, '') as ScoredDimension);

  // The authority decides WHICH ENGINE may publish a grade, before any question
  // of whether the evidence would support one. Gating inputs alone left a
  // trapdoor: verify three of them later and the legacy methodology becomes the
  // production grade engine again without anyone deciding that it should.
  const policy = policyStamp(
    measuredNow, !coverage.dataInsufficient, new Date(), PRODUCTION_SCORING_AUTHORITY,
  );

  // No authorised engine means no overall figure at all — a composite from an
  // unauthorised methodology is the same claim as its grade.
  const totalScore = policy.gradeIssued ? computedTotal : null;
  const { grade, recommendation } = policy.gradeIssued
    ? determineGradeAndRecommendation(computedTotal as number, input)
    : {
        grade: 'N/A',
        recommendation: OVERALL_GRADE_UNAVAILABLE.explanation,
      };

  // Analyze SWOT. Qualitative output still works on sparse data — but a claim
  // that restates an unauthorised assessment is withheld with the number it
  // restates, so the authority boundary cannot be walked around in prose.
  const permits = claimPermits({
    authority: policy.authority,
    measuredDimensions: policy.measuredDimensions,
    admittedInputs: [
      ...yieldAdmitted, ...growthAdmitted, ...locationAdmitted,
      ...demandAdmitted, ...riskAdmitted,
    ],
  });
  const { strengths, weaknesses, opportunities, risks } = analyzeSWOT(input, {
    yieldScore,
    growthScore,
    locationScore,
    demandScore,
    riskScore,
  }, permits);

  // What a client is told where no grade may be issued, and why each absent
  // dimension is absent. Composed once here so the viewer, the PDF and the
  // stored row cannot disagree about it.
  const evidenceStatement = !policy.gradeIssued
    ? {
        heading: OVERALL_GRADE_UNAVAILABLE.heading,
        value: OVERALL_GRADE_UNAVAILABLE.value,
        explanation: OVERALL_GRADE_UNAVAILABLE.explanation,
      }
    : null;
  const notAssessed = (Object.keys(dims) as Array<keyof typeof dims>)
    .filter((k) => !dims[k].hasData)
    .reduce<Record<string, string>>((acc, k) => {
      const dim = k.replace(/Score$/, '') as ScoredDimension;
      acc[dim] = NOT_ASSESSED_REASON[dim];
      return acc;
    }, {});

  return {
    totalScore,
    grade,
    recommendation,
    breakdown,
    coverage,
    strengths,
    weaknesses,
    opportunities,
    risks,
    policy,
    evidenceStatement,
    notAssessed,
    dataPointsPresented: presentedByDimension,
  };
}



function calculateYieldScore(input: InvestmentScoringInput) {
  const annualRent = (input.weeklyRent || 0) * 52;
  const grossYield = (annualRent / input.propertyPrice) * 100;
  
  let score = 0;
  let details = '';

  if (grossYield >= 6) {
    score = 100;
    details = 'Exceptional yield (6%+) - Strong positive cash flow';
  } else if (grossYield >= 5) {
    score = 85;
    details = 'Excellent yield (5-6%) - Good cash flow potential';
  } else if (grossYield >= 4) {
    score = 70;
    details = 'Good yield (4-5%) - Adequate cash flow';
  } else if (grossYield >= 3) {
    score = 50;
    details = 'Average yield (3-4%) - Moderate cash flow';
  } else if (grossYield >= 2) {
    score = 30;
    details = 'Below average yield (2-3%) - Limited cash flow';
  } else {
    score = 10;
    details = 'Poor yield (<2%) - Negative cash flow likely';
  }

  // Adjust based on actual cash flow if provided
  if (input.cashFlow !== undefined) {
    if (input.cashFlow > 0) {
      score = Math.min(100, score + 10);
    } else if (input.cashFlow < -100) {
      score = Math.max(0, score - 20);
    }
  }

  return { score, details };
}

function calculateGrowthScore(input: InvestmentScoringInput) {
  let score = 50; // Base score
  let details = '';

  // Historical growth indicators
  const growth1y = input.priceGrowth1Year || 0;
  const growth3y = input.priceGrowth3Year || 0;

  if (growth1y >= 10) {
    score += 30;
    details = 'Strong recent growth (10%+ p.a.)';
  } else if (growth1y >= 5) {
    score += 20;
    details = 'Good recent growth (5-10% p.a.)';
  } else if (growth1y >= 2) {
    score += 10;
    details = 'Moderate recent growth (2-5% p.a.)';
  } else if (growth1y < 0) {
    score -= 10;
    details = 'Negative recent growth';
  }

  // 3-year trend
  if (growth3y > growth1y && growth3y > 15) {
    score += 20;
    details += ' with accelerating momentum';
  } else if (growth3y > 20) {
    score += 15;
    details += ' and strong 3-year track record';
  }

  // Population growth influence
  if (input.populationGrowth && input.populationGrowth > 2) {
    score += 10;
    details += '. Strong population growth driving demand';
  }

  return { score: Math.min(100, score), details };
}

function calculateLocationScore(input: InvestmentScoringInput) {
  let score = 0;
  const factors: string[] = [];

  // Walk score (max 35 points) - improved thresholds
  if (input.walkScore) {
    if (input.walkScore >= 90) {
      score += 35;
      factors.push('Excellent walkability (90+)');
    } else if (input.walkScore >= 70) {
      score += 28;
      factors.push('Very good walkability (70-89)');
    } else if (input.walkScore >= 50) {
      score += 18;
      factors.push('Good walkability (50-69)');
    } else if (input.walkScore >= 25) {
      score += 8;
      factors.push('Car-dependent location');
    } else {
      score += 3;
      factors.push('Very car-dependent location');
    }
  } else {
    score += 12; // Reduced default assumption
  }

  // CBD commute time (max 30 points) - improved granularity
  if (input.commuteTimeCBD) {
    if (input.commuteTimeCBD <= 15) {
      score += 30;
      factors.push('Excellent CBD access (<15 min)');
    } else if (input.commuteTimeCBD <= 25) {
      score += 25;
      factors.push('Very good CBD access (15-25 min)');
    } else if (input.commuteTimeCBD <= 40) {
      score += 18;
      factors.push('Good CBD access (25-40 min)');
    } else if (input.commuteTimeCBD <= 60) {
      score += 10;
      factors.push('Moderate CBD access (40-60 min)');
    } else {
      score += 3;
      factors.push('Limited CBD access (>60 min)');
    }
  } else {
    score += 12; // Reduced default assumption
  }

  // Schools nearby (max 20 points) - improved scoring
  if (input.schoolsNearby) {
    if (input.schoolsNearby >= 8) {
      score += 20;
      factors.push('Exceptional school access (8+)');
    } else if (input.schoolsNearby >= 5) {
      score += 18;
      factors.push('Excellent school access (5-7)');
    } else if (input.schoolsNearby >= 3) {
      score += 14;
      factors.push('Good school access (3-4)');
    } else if (input.schoolsNearby >= 1) {
      score += 8;
      factors.push('School access available (1-2)');
    } else {
      score += 0;
      factors.push('Limited school access');
    }
  } else {
    score += 8; // Reduced default assumption
  }

  // State capital premium (max 15 points)
  if (input.state && ['NSW', 'VIC', 'QLD'].includes(input.state)) {
    score += 15;
    factors.push('Major capital city location');
  } else if (input.state && ['WA', 'SA'].includes(input.state)) {
    score += 12;
    factors.push('Capital city location');
  } else if (input.state && ['TAS', 'ACT', 'NT'].includes(input.state)) {
    score += 8;
    factors.push('Regional capital location');
  }

  const details = factors.join('. ');
  return { score: Math.min(100, score), details };
}

function calculateDemandScore(input: InvestmentScoringInput) {
  let score = 50; // Base score
  const factors: string[] = [];

  // Vacancy rate (max 30 points) - improved granularity
  if (input.vacancyRate !== undefined) {
    if (input.vacancyRate < 1) {
      score += 30;
      factors.push('Very tight rental market (<1% vacancy)');
    } else if (input.vacancyRate < 1.5) {
      score += 25;
      factors.push('Tight rental market (1-1.5% vacancy)');
    } else if (input.vacancyRate < 2) {
      score += 18;
      factors.push('Strong rental market (1.5-2% vacancy)');
    } else if (input.vacancyRate < 3) {
      score += 10;
      factors.push('Balanced rental market (2-3% vacancy)');
    } else if (input.vacancyRate < 4) {
      score += 0;
      factors.push('Adequate rental market (3-4% vacancy)');
    } else if (input.vacancyRate < 5) {
      score -= 8;
      factors.push('Softening rental market (4-5% vacancy)');
    } else {
      score -= 15;
      factors.push('Oversupplied rental market (>5% vacancy)');
    }
  }

  // Days on market (max 20 points) - improved granularity
  if (input.daysOnMarket !== undefined) {
    if (input.daysOnMarket < 15) {
      score += 20;
      factors.push('Very fast selling market (<15 DOM)');
    } else if (input.daysOnMarket < 30) {
      score += 15;
      factors.push('Fast selling market (15-30 DOM)');
    } else if (input.daysOnMarket < 45) {
      score += 10;
      factors.push('Good selling pace (30-45 DOM)');
    } else if (input.daysOnMarket < 60) {
      score += 5;
      factors.push('Average selling pace (45-60 DOM)');
    } else if (input.daysOnMarket < 90) {
      score -= 5;
      factors.push('Slow selling market (60-90 DOM)');
    } else {
      score -= 12;
      factors.push('Very slow selling market (>90 DOM)');
    }
  }

  // Price relative to suburb median - improved granularity
  if (input.medianSuburbPrice) {
    const priceRatio = input.propertyPrice / input.medianSuburbPrice;
    if (priceRatio < 0.85) {
      score += 18;
      factors.push('Significantly below median pricing - excellent value');
    } else if (priceRatio < 0.95) {
      score += 12;
      factors.push('Below median pricing - good value');
    } else if (priceRatio <= 1.05) {
      score += 5;
      factors.push('At median pricing - fair value');
    } else if (priceRatio <= 1.15) {
      score -= 5;
      factors.push('Above median pricing');
    } else if (priceRatio <= 1.25) {
      score -= 10;
      factors.push('Premium pricing (15-25% above median)');
    } else {
      score -= 15;
      factors.push('Significant premium pricing (>25% above median)');
    }
  }

  // Employment factors - improved granularity
  if (input.unemploymentRate !== undefined) {
    if (input.unemploymentRate < 2.5) {
      score += 18;
      factors.push('Very low unemployment area (<2.5%)');
    } else if (input.unemploymentRate < 3.5) {
      score += 12;
      factors.push('Low unemployment area (2.5-3.5%)');
    } else if (input.unemploymentRate < 4.5) {
      score += 6;
      factors.push('Below average unemployment (3.5-4.5%)');
    } else if (input.unemploymentRate < 5.5) {
      score += 0;
      factors.push('Average unemployment (4.5-5.5%)');
    } else if (input.unemploymentRate < 7) {
      score -= 8;
      factors.push('Above average unemployment (5.5-7%)');
    } else {
      score -= 15;
      factors.push('High unemployment area (>7%)');
    }
  }

  const details = factors.join('. ');
  return { score: Math.min(100, Math.max(0, score)), details };
}

function calculateRiskScore(input: InvestmentScoringInput) {
  let score = 100; // Start at 100, deduct for risks
  const riskFactors: string[] = [];
  const positiveFactors: string[] = [];

  // LVR risk assessment - improved granularity
  if (input.lvr) {
    if (input.lvr > 95) {
      score -= 45;
      riskFactors.push('Extreme LVR (>95%) creates very high leverage risk');
    } else if (input.lvr > 90) {
      score -= 35;
      riskFactors.push('Very high LVR (90-95%) creates significant leverage risk');
    } else if (input.lvr > 85) {
      score -= 25;
      riskFactors.push('High LVR (85-90%) increases leverage risk with LMI required');
    } else if (input.lvr > 80) {
      score -= 18;
      riskFactors.push('Elevated LVR (80-85%) requires LMI consideration');
    } else if (input.lvr > 70) {
      score -= 8;
      riskFactors.push('Moderate LVR (70-80%)');
    } else if (input.lvr > 60) {
      score -= 0;
      positiveFactors.push('Good LVR (60-70%) provides equity buffer');
    } else {
      score += 5; // Bonus for very conservative LVR
      positiveFactors.push('Conservative LVR (<60%) provides strong safety buffer');
    }
  }

  // Cash flow risk - improved penalties for severe negative cash flow
  if (input.cashFlow !== undefined) {
    if (input.cashFlow < -400) {
      score -= 35;
      riskFactors.push('Critical negative cash flow (>$400/week) requires substantial ongoing funding');
    } else if (input.cashFlow < -300) {
      score -= 28;
      riskFactors.push('Severe negative cash flow ($300-400/week) requires significant funding');
    } else if (input.cashFlow < -200) {
      score -= 20;
      riskFactors.push('High negative cash flow ($200-300/week) creates funding pressure');
    } else if (input.cashFlow < -100) {
      score -= 12;
      riskFactors.push('Moderate negative cash flow ($100-200/week) requires contribution');
    } else if (input.cashFlow < 0) {
      score -= 6;
      riskFactors.push('Minor negative cash flow (<$100/week)');
    } else if (input.cashFlow > 150) {
      score += 8;
      positiveFactors.push('Strong positive cash flow (>$150/week) provides excellent income buffer');
    } else if (input.cashFlow > 50) {
      score += 4;
      positiveFactors.push('Positive cash flow provides income buffer');
    }
  }

  // Property type risk
  if (input.propertyType === 'unit' || input.propertyType === 'apartment') {
    score -= 10;
    riskFactors.push('Unit/apartment carries strata risks and potential oversupply');
  } else if (input.propertyType === 'townhouse') {
    score -= 5;
    riskFactors.push('Townhouse carries some strata considerations');
  } else if (input.propertyType === 'house') {
    score += 3;
    positiveFactors.push('House typically offers better long-term capital growth');
  }

  // Market overheating risk
  if (input.priceGrowth1Year && input.priceGrowth1Year > 25) {
    score -= 25;
    riskFactors.push('Extreme growth (>25% p.a.) suggests significant market overheating');
  } else if (input.priceGrowth1Year && input.priceGrowth1Year > 20) {
    score -= 18;
    riskFactors.push('Very rapid growth (20-25% p.a.) suggests market overheating');
  } else if (input.priceGrowth1Year && input.priceGrowth1Year > 15) {
    score -= 10;
    riskFactors.push('Rapid growth (15-20% p.a.) may indicate cooling ahead');
  }

  // Vacancy risk - improved
  if (input.vacancyRate !== undefined) {
    if (input.vacancyRate > 6) {
      score -= 22;
      riskFactors.push('Very high vacancy (>6%) signals weak rental demand');
    } else if (input.vacancyRate > 5) {
      score -= 16;
      riskFactors.push('High vacancy (5-6%) indicates oversupplied market');
    } else if (input.vacancyRate > 4) {
      score -= 10;
      riskFactors.push('Elevated vacancy (4-5%) suggests softening demand');
    } else if (input.vacancyRate < 1) {
      score += 5;
      positiveFactors.push('Very tight rental market (<1% vacancy) strongly supports income');
    } else if (input.vacancyRate < 1.5) {
      score += 3;
      positiveFactors.push('Tight rental market (<1.5% vacancy) supports rental income');
    }
  }

  // Days on market risk - improved
  if (input.daysOnMarket !== undefined) {
    if (input.daysOnMarket > 120) {
      score -= 15;
      riskFactors.push('Very extended selling time (>120 days) indicates weak demand');
    } else if (input.daysOnMarket > 90) {
      score -= 10;
      riskFactors.push('Extended selling time (90-120 days) indicates soft demand');
    } else if (input.daysOnMarket > 60) {
      score -= 5;
      riskFactors.push('Longer selling time (60-90 days) suggests slower market');
    }
  }

  // Build overall risk assessment
  let details = '';
  if (riskFactors.length > 0) {
    details = 'Risk Factors: ' + riskFactors.join('. ');
    if (positiveFactors.length > 0) {
      details += '. Mitigating Factors: ' + positiveFactors.join('. ');
    }
  } else if (positiveFactors.length > 0) {
    details = 'Low risk profile. ' + positiveFactors.join('. ');
  } else {
    details = 'Moderate risk profile with balanced characteristics';
  }

  return { score: Math.max(0, Math.min(100, score)), details };
}

function determineGradeAndRecommendation(score: number, input: InvestmentScoringInput) {
  let grade = '';
  let recommendation = '';

  if (score >= 85) {
    grade = 'A+';
    recommendation = 'STRONG BUY - Excellent investment opportunity with strong fundamentals across all metrics';
  } else if (score >= 75) {
    grade = 'A';
    recommendation = 'BUY - Very good investment with solid potential for both income and capital growth';
  } else if (score >= 65) {
    grade = 'B+';
    recommendation = 'BUY - Good investment opportunity with favorable metrics in most areas';
  } else if (score >= 58) {
    grade = 'B';
    recommendation = 'HOLD/BUY - Moderate investment potential, consider your personal circumstances';
  } else if (score >= 50) {
    grade = 'C+';
    recommendation = 'HOLD - Above average investment with some positive indicators, monitor closely';
  } else if (score >= 42) {
    grade = 'C';
    recommendation = 'HOLD - Average investment with mixed indicators, monitor market conditions';
  } else if (score >= 32) {
    grade = 'D';
    recommendation = 'CAUTION - Below average investment, significant concerns identified';
  } else {
    grade = 'F';
    recommendation = 'AVOID - Poor investment opportunity with multiple red flags';
  }

  return { grade, recommendation };
}

/**
 * The qualitative reading — every claim gated by what may actually be said.
 *
 * `permits` decides per claim, because the claims have different sources: some
 * restate a dimension score, some restate an input, and some restate a fact the
 * operator supplied. Only the last kind survives when no methodology is
 * authorised. See `claimPermits` for why a sentence is an assessment.
 */
function analyzeSWOT(input: InvestmentScoringInput, scores: any, permits: ClaimPermits) {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const opportunities: string[] = [];
  const risks: string[] = [];

  // Strengths
  if (permits.fromDimensionScore('yield') && scores.yieldScore.score >= 70) {
    strengths.push('Strong rental yield providing good cash flow');
  }
  if (permits.fromDimensionScore('growth') && scores.growthScore.score >= 70) {
    strengths.push('Solid capital growth track record');
  }
  if (permits.fromDimensionScore('location') && scores.locationScore.score >= 70) {
    strengths.push('Excellent location with strong amenities');
  }
  if (permits.fromInput('walkScore') && input.walkScore && input.walkScore >= 80) {
    strengths.push('High walkability score enhancing liveability');
  }

  // Weaknesses
  if (permits.fromDimensionScore('yield') && scores.yieldScore.score < 50) {
    weaknesses.push('Below average rental yield may require owner contribution');
  }
  if (permits.fromDimensionScore('growth') && scores.growthScore.score < 50) {
    weaknesses.push('Limited historical capital growth');
  }
  // Buyer leverage is owned by `finance` and admitted to NO dimension, so this
  // never fires — by design. A borrowing position is not a property weakness:
  // it belongs to Finance Suitability and the financial analysis, where the
  // figure itself remains fully available. Kept here, permanently gated,
  // because deleting it would hide that the decision was made.
  if (permits.fromInput('lvr') && input.lvr && input.lvr > 80) {
    weaknesses.push('High leverage increases financial risk');
  }
  if (permits.fromInput('vacancyRate') && input.vacancyRate && input.vacancyRate > 4) {
    weaknesses.push('Higher than ideal vacancy rate in the area');
  }

  // Opportunities
  if (permits.fromInput('populationGrowth') && input.populationGrowth && input.populationGrowth > 2) {
    opportunities.push('Strong population growth driving future demand');
  }
  /*
   * NO VALUATION OF THE SUBJECT.
   *
   * This pushed 'Priced below suburb median - potential for value
   * appreciation', and it reached page 4 of the Compass delivered for
   * 9 Hollow Street on 21 Sep 2026, printed under "Opportunities Noted".
   *
   * `MARKET_FIGURES_IN_THE_REPORT.md` rule 6 forbids it by name: "A median
   * describes a market, not this property. The rule forbids 'below the
   * median', 'above market' and 'under-priced' by name, because that
   * comparison is what the report made." The appreciation clause is a second
   * claim on top of the first - an inference about this property's future
   * price drawn from one comparison against a market average.
   *
   * The comparison is not suppressed, it is relocated: the median is drawn as
   * a market figure with its geography, period and publisher beside it, under
   * the rule that a benchmark never borrows the subject's authority. What is
   * gone is the report telling a client their property is cheap.
   */
  if (permits.fromInput('unemploymentRate') && input.unemploymentRate && input.unemploymentRate < 3.5) {
    opportunities.push('Low unemployment supporting rental demand');
  }
  if (permits.fromDimensionScore('location') && permits.fromDimensionScore('yield')
      && scores.locationScore.score >= 70 && scores.yieldScore.score < 60) {
    opportunities.push('Strong location may drive future capital growth');
  }

  // Risks
  if (permits.fromInput('priceGrowth1Year') && input.priceGrowth1Year && input.priceGrowth1Year > 15) {
    risks.push('Rapid recent price growth may indicate market cooling ahead');
  }
  // Holding cash flow is likewise the buyer's, owned by `finance` and admitted
  // to no dimension, so this never fires either. The figure belongs to the
  // holding analysis, not to a verdict about the asset.
  if (permits.fromInput('cashFlow') && input.cashFlow && input.cashFlow < -150) {
    risks.push('Significant negative cash flow requiring ongoing funding');
  }
  if (permits.fromInput('daysOnMarket') && input.daysOnMarket && input.daysOnMarket > 80) {
    risks.push('Extended selling times may indicate softer market');
  }
  // Dwelling type and state are not scoring inputs and never carry a verdict:
  // the property type selects a risk schema and contributes nothing, and there
  // is no state premium. This claim is exactly that verdict in words, so it is
  // withheld unless a future methodology earns it through a classified input.

  return { strengths, weaknesses, opportunities, risks };
}