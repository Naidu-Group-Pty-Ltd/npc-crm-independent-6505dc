import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { getBrandConfig } from '../_shared/brand-config.ts';
import { publishableGrade } from '../_shared/reports/investment/scoreSections.pure.ts';
import { withReportMetering, resolveUserId, buildIdempotencyKey } from '../_shared/reportMetering.ts';
import { insertTargetedNotification } from '../_shared/notify.ts';
import { compassSections, financialSections, COMPASS_PAGE_BAND, EDITORIAL_LABELS, type CompassSectionDefinition as CanonicalSectionDefinition } from '../_shared/compassSectionRegistry.ts';
import { compassDocumentContract } from '../_shared/reports/investment/compassDocumentContract.pure.ts';
import { postProcessReportMarkdown } from '../_shared/compassPostProcessor.ts';
import { demographicsStatBlocks } from '../_shared/reports/censusPromptBlocks.pure.ts';
import { planningStatBlocks } from '../_shared/reports/planningPromptBlocks.pure.ts';
import {
  buildPlanningFacts,
  planningFactBlocks,
  renderPlanningControls,
} from '../_shared/planning/planningFacts.pure.ts';
import {
  buildInfrastructureEvidence,
  infrastructureRules,
  renderInfrastructureOutlook,
} from '../_shared/planning/infrastructureEvidence.pure.ts';
import {
  projectsNear,
  publishedProjectRules,
  renderPublishedProjects,
  type RegisterSearch,
  PUBLISHED_PROJECT_COVERAGE,
} from '../_shared/planning/publishedProjectRegister.pure.ts';
import { withPlanningEvidence } from '../_shared/reports/location/planningEvidenceRecord.pure.ts';
import { crimeStatBlocks } from '../_shared/reports/crimePromptBlocks.pure.ts';
import { climateStatBlocks } from '../_shared/reports/climatePromptBlocks.pure.ts';
import { macroEconomicBlock } from '../_shared/reports/macroPromptBlocks.pure.ts';
import { activateSafeGenerationInputs, subjectPostcodeOf } from '../_shared/reports/contract/safeGenerationInputs.pure.ts';
import { resolveOneReportGeography } from '../_shared/geography/resolveOneReportGeography.ts';
import {
  assessEnrichmentReuse,
  nextAcquisitionAttempt,
  recordAcquisitionAttempt,
} from '../_shared/reports/location/locationEnrichmentReuse.pure.ts';
import { AcquisitionRecorder } from '../_shared/reports/acquisitionLedger.pure.ts';
import {
  classifyProgress,
  describeHandoff,
  mayTouchRow,
} from '../_shared/reports/investment/runProgress.pure.ts';
import {
  CALL_CEILING_MS,
  acquisitionWindowMs,
  type AcquisitionBudgetInput,
  type CallClass,
} from '../_shared/reports/investment/acquisitionBudget.pure.ts';
import {
  ACQUISITION_STAMP_KEY,
  acquisitionStamp,
  inputRevisionOf,
  planReuse,
  type AcquisitionSubject,
} from '../_shared/reports/investment/acquisitionReuse.pure.ts';
import {
  coordinateProvenance,
  enrichmentCoordinate,
  ledgerOutcomeFor,
  recoveredCoordinate,
  type SubjectCoordinate,
} from '../_shared/reports/location/planningCoordinate.pure.ts';
import { geocodeAddress } from '../_shared/geocode/geocoder.ts';
import { claimSupportRules } from '../_shared/reports/investment/chartEvidence.pure.ts';
import {
  resolveCrimePostcodeAuthority,
  CRIME_EVIDENCE_WITHHELD_NOTE,
} from '../_shared/reports/location/crimePostcodeAuthority.pure.ts';
import { auditMarketClaims, claimFaultToFlag } from '../_shared/reports/contract/marketClaimAudit.pure.ts';
import {
  auditGovernedNarrativeAuthority,
  remediateGovernedNarrative,
  governedRemediatedFlag,
  subjectPostcodeForAudit,
  type GovernedRemoval,
  governedAuthorityBlocks,
  governedCategoryDirective,
  governedFaultToFlag,
} from '../_shared/reports/contract/governedNarrativeAuthority.pure.ts';
import { regionalTrendBlocks } from '../_shared/reports/regionalPromptBlocks.pure.ts';
import { runQAValidation } from '../_shared/compassQAValidator.ts';
import { correctUnsupportedEvidenceClaims } from '../_shared/reports/investment/evidenceClaims.pure.ts';
import { startRun as traceStartRun, recordChunk as traceRecordChunk, finishRun as traceFinishRun, packetKeysAttached as tracePacketKeys } from '../_shared/generation-trace.ts';
import { buildInvestmentReportMeteringParts } from '../_shared/investmentReportMeteringKey.ts';
import { cumulativeCashFlow, fmtCashFlow, impliedOpexFromSeries, seriesLvrPercent } from '../_shared/reports/investment/financialEngine.pure.ts';
import {
  financialWarningsForPrompt,
  interestOnlyMonthlyPaymentFor,
  projectionAssumptionLinesForPrompt,
  sensitivityRowsForPrompt,
} from '../_shared/reports/investment/promptFinancials.pure.ts';
import { recordedScoreValues, suppressUnrecordedScores, suppressUnrecordedVerdictVisuals } from '../_shared/reports/investment/scoreClaims.pure.ts';
import { investmentScorePromptBlock, overallRecommendationLine } from '../_shared/reports/investment/scorePromptBlock.pure.ts';
import { abbreviateState, domainCategoryFor, dwellingTypeFor } from '../_shared/reports/market/domainEvidence.pure.ts';
import { populationGrowthPoint } from '../_shared/reports/market/populationGrowthEvidence.pure.ts';
import { rentalMarketEvidence } from '../_shared/reports/market/rentalMarketEvidence.pure.ts';
import { EVIDENCE_KEYS, emptyEvidence, mergeEvidence, type EvidenceSubject, type MarketEvidence } from '../_shared/reports/market/marketEvidence.pure.ts';
import { openDataSalesPoints, salesRegisterSourcesFor } from '../_shared/reports/market/openDataSalesEvidence.pure.ts';
import {
  buildMarketFacts, marketFactRules, renderMarketFacts, suppressUnevidencedMarketSeries,
} from '../_shared/reports/market/marketFactBlocks.pure.ts';
import {
  describeSubjectPrice, subjectPriceLine, subjectPriceRules,
} from '../_shared/reports/investment/subjectPrice.pure.ts';
import {
  composeStrategySections,
  readStrategyRecord,
  strategySectionRules,
} from '../_shared/reports/investment/strategyPositions.pure.ts';
import { ENRICHMENT_STAMP } from '../_shared/reports/location/locationEnrichmentReuse.pure.ts';
import { transportCountReading } from '../_shared/transportReading.pure.ts';
import { readSalesRegister } from '../_shared/reports/market/salesRegisterRead.ts';
import type { SalesRegisterState } from '../_shared/reports/market/openData/salesRegister.pure.ts';
import { describeLandArea } from '../_shared/reports/investment/landAreaScope.pure.ts';
import { applyDisplayOverrides, buildAnnualCostOverrides, normalisePropertyType, toFiniteNumber } from '../_shared/reports/investment/overrides.pure.ts';
import { composePropertySpecs } from '../_shared/reports/investment/propertyRecord.pure.ts';
import { reconcileNearestSchool, reconcileSchoolDistances } from '../_shared/reports/schoolDistance.pure.ts';
import { reconcileFacts, factFindingToFlag } from '../_shared/reports/investment/factReconciliation.pure.ts';
import { financeIdentityBreaches } from '../_shared/reports/metrics/propertyMetrics.pure.ts';
import {
  absentRentDirective,
  resolveRentalEvidence,
  statedYield,
} from '../_shared/reports/investment/rentalEvidence.pure.ts';
const INTERNAL_EDGE_SECRET = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();

// ============================================================================
// WALL-CLOCK BUDGET
// ============================================================================
// The Supabase edge runtime terminates an invocation at ~150s. A full Compass
// report is a dozen sections at 9-37s each, so a single invocation can never
// finish one — it used to be killed around section 6, leaving `status` stuck on
// 'processing' with `report_generation_runs.status` still 'running' and no error
// anywhere. Instead of racing the ceiling we stop before it and report progress
// honestly; the caller resumes with `continueFrom: true`.
//
// Budget stops us STARTING a section we predict we cannot finish. The reserve
// covers post-processing (schema validation, dedup, DB write) on the run that
// does complete the final section.
const SECTION_LOOP_BUDGET_MS = 110_000;
const POST_PROCESSING_RESERVE_MS = 25_000;
// Fallback estimate before we have measured a section in this run.
const DEFAULT_SECTION_ESTIMATE_MS = 30_000;

// Per-call ceilings for the model, and the clock every call answers to.
//
// These used to be 150s/120s — longer than the entire edge invocation, so one
// hung call could still blow the whole run past the platform ceiling before
// the between-sections budget guard could fire. They were then cut to 60s/45s
// on the reading that "observed section latency is 9-37s" — which was true of
// the 2,500-token sections and false of the closing one. Measured on the
// generation trace, 15 Sep 2026: "Risks & Recommendations" (three headings,
// 4,000 tokens, a 68 KB prompt) took 40-110s whenever it completed, so the
// full-prompt attempt timed out at 60s on every run, the compact retry then
// ran with whatever was left, and 43 invocations for two reports were killed
// by the platform with no status written — the report's widget read
// "Section 12 of 12 · 10h 45m elapsed".
//
// The fix is not a bigger constant. Every call is given the window it can
// actually have: the run's own deadline (`SECTION_CALL_HARD_STOP_MS`, inside
// the watchdog's 130s inner timeout and the platform's ~150s kill), less the
// post-processing reserve on the closing section, less a reserve for the
// compact retry while a full-prompt attempt is still worth making. A
// full-prompt attempt that cannot get its measured floor is skipped for the
// compact prompt rather than spent on a timeout foretold, and a call with no
// window left is DEFERRED to the next invocation — reported as a hand-off,
// never as a failed section.
const SECTION_REQUEST_TIMEOUT_MS = 90_000;
const SECTION_CONTINUATION_TIMEOUT_MS = 45_000;
/** The compact prompt completes in 15-46s measured; this bounds it. */
const SECTION_EMERGENCY_TIMEOUT_MS = 60_000;
/** Below this window the full prompt has never completed; go straight to the compact one. */
const SECTION_FULL_PROMPT_MIN_WINDOW_MS = 60_000;
/** Held back from a full-prompt attempt so a compact retry still fits after it. */
const SECTION_SECOND_ATTEMPT_RESERVE_MS = 30_000;
/** No model call is started with less than this. */
const SECTION_MIN_CALL_WINDOW_MS = 20_000;
/** From the run's start: the last moment a model call may still be in flight. */
const SECTION_CALL_HARD_STOP_MS = 125_000;
/**
 * Held back from acquisition so the research that DID land can be persisted.
 *
 * Research nobody banked is research the next invocation buys again, which is
 * how one report came to re-purchase eighty Google calls across eleven resumes.
 */
const ACQUISITION_CHECKPOINT_RESERVE_MS = 5_000;
/** Below this an acquisition call is not worth starting. */
const ACQUISITION_MIN_CALL_MS = 1_500;
/** The error a section returns when it made no call for want of a window. */
const SECTION_BUDGET_DEFERRED = 'SECTION_BUDGET_DEFERRED';

// ============================================================================
// REPORT SECTION DEFINITIONS - SYNCED WITH DATABASE TEMPLATE STRUCTURE
// ============================================================================
// These section definitions match the "Investor Compass Structure v2" template
// stored in report_structure_templates table. They serve as:
// 1. Fallback when template parsing fails
// 2. Validation reference for dynamic parsing
// 3. Performance tuning (maxTokens, requiredKeywords)
// ============================================================================

interface ReportSectionDefinition {
  id: string;
  name: string;
  sections: string[];  // H2 headings from template that belong to this group
  maxTokens: number;
  minContentLength: number;
  /** Upper bound in characters. Optional: the legacy scope templates set none. */
  maxContentLength?: number;
  requiredKeywords: string[];
}

/**
 * Headings a single section may carry before it counts as over-structured.
 *
 * Production ran at 96 headings a report across 17 sections — 24.6 `##`, 68.1
 * `###`, 2.9 `####`. The floor of three in `validateSectionContent` is part of
 * why: a section with two findings still had to invent a third heading to clear
 * it. Six leaves room for a genuinely structured section (an H2 plus four or
 * five sub-heads) and flags the ones padding to a number.
 */
const MAX_SECTION_HEADINGS = 6;

/** Same five labels the registry forbids; used to flag a section in the log. */
const EDITORIAL_LABEL_PROBE = new RegExp(
  `^\\s*(?:#{1,6}\\s*)?(?:\\*\\*|__)?\\s*(?:${EDITORIAL_LABELS
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})\\b`,
  'i',
);

// FALLBACK HARDCODED SECTIONS - Matches database template "Investor Compass Structure v2"
// These 12 groups contain all 26 H2 sections from the template, logically grouped for generation
const DEFAULT_REPORT_SECTIONS: ReportSectionDefinition[] = [
  {
    id: 'section0',
    name: 'Executive Summary',
    sections: ['Executive Summary'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['investment', 'property', 'recommendation', 'score'],
  },
  {
    id: 'section1',
    name: 'Location Overview',
    sections: ['Location Overview'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['suburb', 'community', 'transport', 'lifestyle'],
  },
  {
    id: 'section2',
    name: 'Market & Economics',
    sections: ['Current Market Performance', 'Current Economic Context'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['market', 'cash rate', 'inflation', 'growth'],
  },
  {
    id: 'section3',
    name: 'Demographics & Demand',
    sections: ['Demographics & Demand Drivers'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['population', 'income', 'employment', 'household'],
  },
  {
    id: 'section4',
    name: 'Education & Healthcare',
    sections: ['Schools & Education', 'Healthcare & Shopping'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['school', 'education', 'hospital', 'healthcare'],
  },
  {
    id: 'section5',
    name: 'Recreation & Transport',
    sections: ['Recreational Amenities', 'Transport & Accessibility'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['recreation', 'park', 'transport', 'commute'],
  },
  {
    id: 'section6',
    name: 'Environment & Safety',
    sections: ['Environmental Risks & Climate', 'Crime & Safety'],
    maxTokens: 4000,
    minContentLength: 3500,
    requiredKeywords: ['flood', 'bushfire', 'crime', 'safety'],
  },
  {
    id: 'section7',
    name: 'Property & Zoning',
    // Updated: Strategic Assessment, Top 3 Opportunities, and Top 3 Risks now under Property-Level Information
    sections: ['Property-Level Information', 'Strategic Assessment', 'Capital Appreciation Potential', 'Leveraged Equity Accumulation', 'Sustained Employment Growth', 'Structural Cashflow Deficit', 'Interest Rate Sensitivity', 'Environmental Risk'],
    maxTokens: 5000,
    minContentLength: 4500,
    requiredKeywords: ['property', 'zoning', 'land', 'strategic', 'opportunity', 'risk'],
  },
  {
    id: 'section8',
    name: 'Costs & Rental',
    sections: ['Purchase & Ongoing Costs (Annual)', 'Rental Assessment & Yield Calculation'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['purchase', 'stamp duty', 'rent', 'yield'],
  },
  {
    id: 'section9',
    name: 'Loan & Sensitivity',
    sections: ['Loan Structure & Repayment Analysis', 'Sensitivity Analysis'],
    maxTokens: 2500,
    minContentLength: 2500,
    requiredKeywords: ['loan', 'repayment', 'cashflow', 'sensitivity'],
  },
  {
    id: 'section10',
    name: 'Projections & SWOT',
    // Removed: Top 3 Opportunities (moved to Property-Level Information)
    sections: ['10-Year Investment Projections', 'Investment Score Analysis', 'SWOT Analysis Summary'],
    maxTokens: 3000,
    minContentLength: 3000,
    requiredKeywords: ['projection', 'swot', 'score'],
  },
  {
    id: 'section11',
    name: 'Risks & Recommendations',
    // Removed: Top 3 Risks (moved to Property-Level Information)
    sections: ['Investment Recommendations', 'Final Conclusion', 'PROFESSIONAL DISCLAIMER'],
    maxTokens: 4000,
    minContentLength: 3000,
    requiredKeywords: ['recommendation', 'conclusion'],
  }
];

// ============================================================================
// SUBURB REPORT SECTIONS - Fallback for suburb-scope reports
// ============================================================================
const DEFAULT_SUBURB_SECTIONS: ReportSectionDefinition[] = [
  {
    id: 'suburb_section0',
    name: 'Executive Summary',
    sections: ['Executive Summary'],
    maxTokens: 2000,
    minContentLength: 1500,
    requiredKeywords: ['suburb', 'investment', 'thesis'],
  },
  {
    id: 'suburb_section1',
    name: 'Suburb Profile',
    sections: ['Suburb Profile', 'Location & Profile'],
    maxTokens: 2500,
    minContentLength: 2000,
    requiredKeywords: ['suburb', 'character', 'geographic', 'LGA'],
  },
  {
    id: 'suburb_section2',
    name: 'Market Analysis & Trends',
    sections: ['Market Analysis', 'Price Trends & Growth'],
    maxTokens: 3000,
    minContentLength: 2500,
    requiredKeywords: ['median', 'growth', 'clearance', 'price'],
  },
  {
    id: 'suburb_section3',
    name: 'Rental Market',
    sections: ['Rental Market Deep Dive'],
    maxTokens: 2500,
    minContentLength: 2000,
    requiredKeywords: ['rent', 'yield', 'vacancy', 'demand'],
  },
  {
    id: 'suburb_section4',
    name: 'Demographics & Economics',
    sections: ['Demographics & Economics'],
    maxTokens: 2500,
    minContentLength: 2000,
    requiredKeywords: ['population', 'income', 'employment', 'household'],
  },
  {
    id: 'suburb_section5',
    name: 'Location & Amenities',
    sections: ['Location & Amenities', 'Infrastructure & Amenities'],
    maxTokens: 2500,
    minContentLength: 2000,
    requiredKeywords: ['transport', 'school', 'shopping', 'healthcare'],
  },
  {
    id: 'suburb_section6',
    name: 'Supply & Development',
    sections: ['Supply & Development Pipeline'],
    maxTokens: 2000,
    minContentLength: 1500,
    requiredKeywords: ['development', 'DA', 'rezoning', 'supply'],
  },
  {
    id: 'suburb_section7',
    name: 'Risk & Safety',
    sections: ['Risk Assessment', 'Crime & Safety'],
    maxTokens: 2500,
    minContentLength: 2000,
    requiredKeywords: ['flood', 'bushfire', 'crime', 'risk'],
  },
  {
    id: 'suburb_section8',
    name: 'Investment Score & SWOT',
    sections: ['Investment Score & SWOT', 'SWOT Analysis'],
    maxTokens: 2500,
    minContentLength: 2000,
    requiredKeywords: ['score', 'strength', 'weakness', 'opportunity'],
  },
  {
    id: 'suburb_section9',
    name: 'Comparative Context & Disclaimer',
    sections: ['Comparative Context', 'Disclaimer'],
    maxTokens: 2500,
    minContentLength: 2000,
    requiredKeywords: ['comparison', 'benchmark', 'disclaimer'],
  },
];

// ============================================================================
// POSTCODE REPORT SECTIONS - Fallback for postcode-scope reports
// ============================================================================
const DEFAULT_POSTCODE_SECTIONS: ReportSectionDefinition[] = [
  {
    id: 'postcode_section0',
    name: 'Executive Summary',
    sections: ['Executive Summary'],
    maxTokens: 2000,
    minContentLength: 1500,
    requiredKeywords: ['postcode', 'investment', 'thesis'],
  },
  {
    id: 'postcode_section1',
    name: 'Zone Profile',
    sections: ['Zone Profile'],
    maxTokens: 2000,
    minContentLength: 1500,
    requiredKeywords: ['suburbs', 'LGA', 'boundaries', 'zone'],
  },
  {
    id: 'postcode_section2',
    name: 'Market Overview',
    sections: ['Market Overview'],
    maxTokens: 2500,
    minContentLength: 2000,
    requiredKeywords: ['median', 'clearance', 'stock', 'market'],
  },
  {
    id: 'postcode_section3',
    name: 'Suburb-by-Suburb Breakdown',
    sections: ['Suburb-by-Suburb Breakdown'],
    maxTokens: 3000,
    minContentLength: 2500,
    requiredKeywords: ['suburb', 'comparison', 'standout'],
  },
  {
    id: 'postcode_section4',
    name: 'Price Trends & Rental Market',
    sections: ['Price Trends & Growth', 'Rental Market'],
    maxTokens: 3000,
    minContentLength: 2500,
    requiredKeywords: ['growth', 'benchmark', 'rent', 'yield', 'vacancy'],
  },
  {
    id: 'postcode_section5',
    name: 'Demographics & Infrastructure',
    sections: ['Demographics & Economics', 'Infrastructure & Development'],
    maxTokens: 2500,
    minContentLength: 2000,
    requiredKeywords: ['population', 'income', 'projects', 'transport'],
  },
  {
    id: 'postcode_section6',
    name: 'Risk & Investment Score',
    sections: ['Risk Assessment', 'Investment Score & Hotspot Identification'],
    maxTokens: 3000,
    minContentLength: 2500,
    requiredKeywords: ['risk', 'hazard', 'score', 'hotspot', 'SWOT'],
  },
  {
    id: 'postcode_section7',
    name: 'Disclaimer',
    sections: ['Disclaimer'],
    maxTokens: 1500,
    minContentLength: 500,
    requiredKeywords: ['disclaimer'],
  },
];

// ============================================================================
// STATEWIDE REPORT SECTIONS - Fallback for statewide-scope reports
// ============================================================================
const DEFAULT_STATEWIDE_SECTIONS: ReportSectionDefinition[] = [
  {
    id: 'statewide_section0',
    name: 'Executive Summary',
    sections: ['Executive Summary'],
    maxTokens: 2500,
    minContentLength: 2000,
    requiredKeywords: ['state', 'investment', 'climate'],
  },
  {
    id: 'statewide_section1',
    name: 'State Economic Overview',
    sections: ['State Economic Overview'],
    maxTokens: 3000,
    minContentLength: 2500,
    requiredKeywords: ['GDP', 'employment', 'population', 'migration'],
  },
  {
    id: 'statewide_section2',
    name: 'Property Market Overview',
    sections: ['Property Market Overview'],
    maxTokens: 2500,
    minContentLength: 2000,
    requiredKeywords: ['median', 'clearance', 'listings', 'market'],
  },
  {
    id: 'statewide_section3',
    name: 'Regional Comparison',
    sections: ['Regional Comparison'],
    maxTokens: 3000,
    minContentLength: 2500,
    requiredKeywords: ['metro', 'regional', 'top', 'bottom'],
  },
  {
    id: 'statewide_section4',
    name: 'Price Trends & Rental Market',
    sections: ['Price Trends & Affordability', 'Rental Market'],
    maxTokens: 3000,
    minContentLength: 2500,
    requiredKeywords: ['growth', 'affordability', 'vacancy', 'yield'],
  },
  {
    id: 'statewide_section5',
    name: 'Policy & Infrastructure',
    sections: ['Government Policy & Regulation', 'Infrastructure Pipeline'],
    maxTokens: 3000,
    minContentLength: 2500,
    requiredKeywords: ['stamp duty', 'land tax', 'projects', 'infrastructure'],
  },
  {
    id: 'statewide_section6',
    name: 'Risk & Hotspots',
    sections: ['Risk & Macro Factors', 'Investment Hotspots'],
    maxTokens: 3500,
    minContentLength: 3000,
    requiredKeywords: ['interest rate', 'supply', 'hotspot', 'SWOT'],
  },
  {
    id: 'statewide_section7',
    name: 'Disclaimer',
    sections: ['Disclaimer'],
    maxTokens: 1500,
    minContentLength: 500,
    requiredKeywords: ['disclaimer'],
  },
];

// Helper: get default sections by scope
function getDefaultSectionsForScope(scope: string): ReportSectionDefinition[] {
  switch (scope) {
    case 'suburb': return [...DEFAULT_SUBURB_SECTIONS];
    case 'postcode': return [...DEFAULT_POSTCODE_SECTIONS];
    case 'statewide': return [...DEFAULT_STATEWIDE_SECTIONS];
    default: return [...DEFAULT_REPORT_SECTIONS];
  }
}

function normaliseGenerationTier(_raw: unknown): 'compass-40' | 'financial-analysis' {
  // Composite-first strategy: only the Compass-40 composite is ever generated.
  // Client-facing FIN / PLDD variants are derived post-hoc by fork-investment-report.
  // The 'financial-analysis' standalone tier is intentionally retired here.
  return 'compass-40';
}

/**
 * Turn a registry section into a generation chunk.
 *
 * `maxTokens` used to be `maxWordCount * 4` (capped at 5,000) and was then
 * multiplied by 1.6 again for Compass — handing a 650-word section about 4,160
 * tokens, roughly 3,100 words, **4.8× its own cap**. The budget was not a
 * budget.
 *
 * It is now derived from the cap with a margin that is deliberately generous
 * rather than tight: `docs/reports/INVESTMENT.md` records mid-sentence
 * truncation as a live defect, and the `finish_reason === 'length'`
 * continuation pass exists because of it. Cutting a section off at the token
 * limit produces a broken sentence on a client's page, which is worse than a
 * long section. The cap is enforced by the prompt, by `maxContentLength` here,
 * and finally by the post-processor — never by truncation.
 */
function canonicalSectionsToGenerationSections(
  canonicalSections: CanonicalSectionDefinition[],
  prefix: string,
): ReportSectionDefinition[] {
  return canonicalSections.map((section, index) => {
    // ~6 chars a word, ×1.5 for the tables and directives that are not narrative
    // and so are not charged against `maxWordCount`.
    const maxContentLength = Math.round(section.maxWordCount * 9);
    // The floor is derived from the same number as the ceiling and then held
    // below half of it. Independently clamped floors and ceilings is how the
    // old pair ended up with a 600-char floor on a 60-word cover page — a
    // section penalised for being short at the length it was asked to be.
    const minContentLength = Math.min(
      Math.round(maxContentLength * 0.5),
      Math.max(300, section.maxWordCount * 2),
    );
    return {
      id: `${prefix}${index}`,
      name: section.name,
      sections: [section.name],
      // Deliberately above what `maxContentLength` allows: ~9 chars a word is
      // ~2.25 tokens a word, so ×3 leaves the model room to finish its last
      // sentence rather than being cut mid-thought at the token limit.
      // Truncation is a defect on a client's page (`INVESTMENT.md`); a long
      // section is not — the ceiling is enforced by the prompt, by
      // `maxContentLength` and finally by the post-processor, never here.
      maxTokens: Math.min(4000, Math.max(900, Math.round(section.maxWordCount * 3))),
      minContentLength,
      maxContentLength,
      requiredKeywords: section.sourceHeadings.slice(0, 3).map((heading) => heading.split(/\s+/)[0]?.toLowerCase()).filter(Boolean),
    };
  });
}

function getCanonicalSectionsForTier(tier: 'compass-40' | 'financial-analysis'): ReportSectionDefinition[] {
  return tier === 'financial-analysis'
    ? canonicalSectionsToGenerationSections(financialSections(), 'financialSection')
    : canonicalSectionsToGenerationSections(compassSections(), 'compassSection');
}

function buildCanonicalTemplateContext(tier: 'compass-40' | 'financial-analysis'): string {
  const sections = tier === 'financial-analysis' ? financialSections() : compassSections();
  const title = tier === 'financial-analysis'
    ? 'Financial Analysis Report Structure'
    // Read from the band rather than written, because the registry's page
    // budget is the thing that decides it and a literal beside it is how the
    // two come to disagree. v3.0 said 38 against a 23-page document.
    : `Investment Location & Property Fit Report Structure (${COMPASS_PAGE_BAND.min}–${COMPASS_PAGE_BAND.max} pages)`;

  const compassStyleRules = tier === 'compass-40' ? [
    '',
    '## MANDATORY WRITING STYLE — data first, no commentary blocks',
    'Every section follows the same three steps, repeated as many times as it has findings:',
    '1. **State the finding** in the sentence that introduces the data — one sentence, specific, with the number in it.',
    '2. **Show the data** — a figure, a table, or a short list.',
    '3. **Move on** to the next finding.',
    '',
    'A paragraph that follows a table or a figure and restates it is the single',
    'thing this report must not contain. If a sentence would begin "this means",',
    '"in other words", "for an investor this suggests" or similar, delete it: the',
    'finding belongs in the sentence that introduced the data, not underneath it.',
    '',
    '## FORBIDDEN LABELS — these must not appear anywhere, in any form',
    `- Never write ${EDITORIAL_LABELS.map((l) => `"${l}"`).join(', ')}.`,
    '- That applies to all three forms: as a heading (`### NPC view`), as a bold',
    '  lead-in (`**What This Means**`), and as a bare line above a paragraph.',
    '- There is no permitted number of these. Not one per section, not one per report.',
    '- Advisory judgement belongs in exactly two places: the Executive Verdict and the',
    '  Final Recommendation. In both it is written as continuous prose with no label.',
    '',
    '## HARD EXCLUSIONS (Compass / Location & Property Fit Report)',
    '- DO NOT include deposit, stamp duty, LMI, LVR, gross/net yield, loan amount, interest rate, monthly/annual repayments, cashflow, sensitivity, 10-year projections, capital growth %, equity-after-X-years, depreciation, negative gearing, land tax. ALL financial modelling lives in the separate Financial Analysis Report.',
    // The asking price and the indicative rent are NOT on that list, and the
    // line that used to put them there contradicted three things at once: the
    // tier policy (`identityFigures` is true on every tier — what the property
    // costs is a fact about the asset the way its land size is), the document
    // itself (the cover band and the dashboard both print them), and Market
    // Positioning, whose whole job is to place this property in its market and
    // which cannot do it without naming the price. What may not happen is the
    // ANALYSIS of them, and the KPI-row form, both of which the next two lines
    // and the sanitiser hold.
    '- The asking price and the indicative weekly rent MAY be stated, as facts about the property, in a sentence. They may not be analysed — no yield from them, no repayment on them, no projection of them — and they may not be set as a KPI row or a table of figures.',
    '- DO NOT include a dashboard / KPI row of financial figures in the Executive Verdict or anywhere else.',
    '- DO NOT emit `[citation]`, `[source needed]`, `[TBD]` or any placeholder. Either name the real source inline, or omit the claim and let the Source Appendix carry it.',
    '- DO NOT repeat education, transport or employment content across sections. Each is rendered ONCE, in the section that owns it.',
    '- DO NOT include transition paragraphs ("As we move into…", "Building on the above…", "This flows naturally…"). Start the next finding.',
    '',
    '## LENGTH AND STRUCTURE',
    '- Respect the per-section word ceiling given above. It is a ceiling, not a target to reach: a section that says what it has to say in half of it is finished.',
    '- At most 4 `###` sub-headings in a section. A sub-heading carries a group of findings, not a single paragraph.',
    '- At most 2 visualisations per section, each showing data that is not also in a table on the same page.',
    '- Finish every sentence and every paragraph. If you are running out of room, close the section cleanly rather than stopping mid-thought.',
    '',
    '## CONSISTENCY CHECKS',
    '- Bed / bath / car / land size stated in the Property & Locality Snapshot MUST match every later reference (Property Fit, Risk Dashboard, Final Recommendation).',
    '- Property type (house / townhouse / unit) MUST be identical everywhere it is mentioned.',
    '',
    '## RECOMMENDATION FORMAT',
    'The Final Recommendation opens with one of three labels on its own line — **Proceed**, **Proceed with caution**, or **Not suitable** — then 150–250 words of continuous unlabelled rationale tied to location, tenant demand and risk, then the immediate actions as a short list. No financial verdict.',
    '',
  ].join('\n') : '';

  return [
    `# ${title}`,
    '',
    ...sections.flatMap((section) => [
      `## ${section.name}`,
      `- Page budget: ${section.pageBudget}`,
      `- Purpose: ${section.purpose}`,
      `- Narrative word ceiling: ${section.maxWordCount} (a ceiling, not a target)`,
      section.visualComponents.length ? `- Required visual/data components: ${section.visualComponents.join(', ')}` : '- Required visual/data components: narrative only',
      '',
    ]),
    compassStyleRules,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Compass-40 content sanitizer
//
// Compass-40 is the "Location & Property Fit" report. Even with the prompt
// overlay + canonical section list, Perplexity occasionally leaks financial
// KPI rows ("Purchase Price | $681,000"), KPI dashboard tiles, citation
// placeholders ("[1][2]") and stops mid-sentence when it hits max_tokens.
// This sanitizer scrubs the leaks and trims trailing partial sentences so
// the rendered PDF never shows a half-finished paragraph.
// ─────────────────────────────────────────────────────────────────────────────
const COMPASS40_FORBIDDEN_LINE_PATTERNS: RegExp[] = [
  /^[\s>*\-]*\**\s*(Estimated\s+)?Purchase\s+Price\b/i,
  /^[\s>*\-]*\**\s*(Estimated\s+)?Weekly\s+Rent\b/i,
  /^[\s>*\-]*\**\s*Loan[-\s]?to[-\s]?Value\b/i,
  /^[\s>*\-]*\**\s*LVR\b/i,
  /^[\s>*\-]*\**\s*(Gross|Net)\s+(Rental\s+)?Yield\b/i,
  /^[\s>*\-]*\**\s*Annual\s+Rental\s+Income\b/i,
  /^[\s>*\-]*\**\s*Loan\s+Amount\b/i,
  /^[\s>*\-]*\**\s*Interest\s+Rate\b/i,
  /^[\s>*\-]*\**\s*Capital\s+Growth\b/i,
  /^[\s>*\-]*\**\s*Deposit\s+Required\b/i,
  /^[\s>*\-]*\**\s*Stamp\s+Duty\b/i,
  /^[\s>*\-]*\**\s*Monthly\s+Repayment\b/i,
  /^[\s>*\-]*\**\s*Cashflow\b/i,
  /^[\s>*\-]*\**\s*Negative(ly)?\s+Geared\b/i,
  /^[\s>*\-]*\**\s*Investment\s+Grade\b/i,
  /^[\s>*\-]*\**\s*Total\s+Investment\s+Score\b/i,
  /^[\s>*\-]*\**\s*(Growth|Location|Yield|Demand|Risk)\s+Score\b/i,
];

// Table rows / KPI cells we should drop wholesale. Also used to detect entire
// financial tables (any matching cell taints the whole table block).
const COMPASS40_FORBIDDEN_CELL_PATTERNS: RegExp[] = [
  /\|\s*\$\d[\d,]*\s*\|/,
  /\|\s*[Ll][Vv][Rr]\s*\|/,
  /\|\s*(Gross|Net)\s+Yield\s*\|/i,
  /\|\s*Weekly\s+Rent\s*\|/i,
  /\|\s*(Estimated\s+)?Purchase\s+Price\s*\|/i,
  /\|\s*Loan\s+Amount\s*\|/i,
  /\|\s*Interest\s+Rate\s*\|/i,
  /\|\s*Stamp\s+Duty\s*\|/i,
  /\|\s*Score\s*\(?\/?\s*100/i,
  /\|\s*Weight\s*\|/i,
  /\|\s*(Total\s+)?Investment\s+Score\s*\|/i,
  /\|\s*Investment\s+Grade\s*\|/i,
  /\|\s*Recommendation\s*\|/i,
  /\|\s*HOLD\b/i,
  /\|\s*Capital\s+Growth\b/i,
  /\|\s*(Growth|Location|Yield|Demand|Risk)\s+Score\s*\|/i,
  /\|\s*Contribution\s+to\s+Total\s*\|/i,
];

// Whole sections (H2/H3) that must be dropped under Compass-40.
const COMPASS40_FORBIDDEN_HEADINGS: RegExp[] = [
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?Investment\s+Highlights\s*$/i,
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?Key\s+Findings\s*$/i,
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?Headline\s+Scores?\s*$/i,
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?Overall\s+Investment\s+Profile\s*$/i,
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?Overall\s+Investment\s+Position\s*$/i,
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?Investment\s+Score\s+Analysis\s*$/i,
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?Macro\s+Investment\s+Scorecard\s*$/i,
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?Property\s+Snapshot\s*[-–—]?\s*Non[-\s]?Financial\s*$/i,
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?Property\s+Snapshot\s*$/i,
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?Category\s+Breakdown\b/i,
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?(Growth|Location|Yield|Demand|Risk)\s+Score\b/i,
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?Investment\s+Recommendation\s*$/i,
  // The commentary labels, when the model reaches for a heading. This catches
  // them per-section during generation; `compassPostProcessor.stripEditorialBlocks`
  // catches the bold and bare-line forms across the whole document afterwards.
  /^#{1,4}\s*(?:\d+(?:\.\d+)*\.?\s+)?(?:What\s+This\s+Means(?:\s+for\s+You)?|Why\s+This\s+Matters(?:\s+for\s+Investors)?|What\s+to\s+Watch|Key\s+Takeaways?|NPC\s+(?:View|Take)|Our\s+View)\b/i,
];

// Sentences containing these are dropped (financial leaks in prose).
const COMPASS40_FORBIDDEN_SENTENCE_REGEX =
  /\b(LVR|loan-to-value|gross\s+(rental\s+)?yield|net\s+(rental\s+)?yield|rental\s+yield|cash\s*flow|cashflow|negatively?\s+geared|negative\s+gearing|stamp\s+duty|interest\s+rate|monthly\s+repayment|annual\s+repayment|purchase\s+price|deposit\s+required|loan\s+amount|weekly\s+rent|annual\s+rent|investment\s+grade|hold\s+recommendation|out[-\s]?of[-\s]?pocket|capital\s+growth\s*:|sensitivity\s+analysis|negative\s+cashflow|tipping\s+in\s+cash)\b/i;

// Bullet/line-level leak (no period required) — drops short bullets that pair a
// finance keyword with a $ amount or % figure (e.g. "Gross rental yield: 3.74%").
const COMPASS40_FORBIDDEN_BULLET_REGEX =
  /\b(yield|rent|LVR|loan|deposit|stamp\s+duty|purchase\s+price|cashflow|cash\s+flow|interest\s+rate|capital\s+growth|repayment|land\s+tax|annual\s+(rental\s+)?income|annual\s+costs?|negatively?\s+geared|investment\s+grade|total\s+investment\s+score)\b[^.\n]{0,80}(\$[\d,]+|\d+(\.\d+)?\s*%)/i;

// Adjacent word/phrase duplications that the model occasionally produces in headings
// (e.g. "Industry 4 Industry & Employment Structure", "Amenity Amenity & Livability",
//  "SEIFA IFA & Socio-Economic", "Key Strengths Key Strengths & Watch Points").
export function dedupeRepeatedWords(s: string): string {
  if (!s) return s;
  let out = s;
  // "Word N Word" -> "Word"
  out = out.replace(/\b(\w+)\s+\d+\s+\1\b/gi, '$1');
  // "Phrase N Phrase" (1-3 word phrase with intervening digit)
  out = out.replace(/\b((?:\w+\s+){1,3}\w+)\s+\d+\s+\1\b/gi, '$1');
  // "Word Word" -> "Word" / "Phrase Phrase" -> "Phrase"
  for (let i = 0; i < 2; i++) {
    out = out.replace(/\b((?:\w+\s+){0,3}\w+)\s+\1\b/gi, '$1');
  }
  // ", Competition , Competition" -> ", Competition"
  out = out.replace(/(\b\w+\b)\s*,\s*\1\b/gi, '$1');
  // "SEIFA IFA" -> "SEIFA" (second word is a >=3 char suffix of the first)
  out = out.replace(/\b(\w*?)(\w{3,})\s+\2\b/gi, '$1$2');
  return out.replace(/\s{2,}/g, ' ').trim();
}

function sanitizeCompass40Content(raw: string): string {
  if (!raw) return raw;
  const rawLines = raw.split('\n');

  // ---- Pass 1: collect line metadata, group table blocks ----
  type Block = { kind: 'line' | 'table'; lines: string[]; startIdx: number };
  const blocks: Block[] = [];
  let i = 0;
  while (i < rawLines.length) {
    const t = rawLines[i].trim();
    if (t.startsWith('|')) {
      const tbl: string[] = [];
      const startIdx = i;
      while (i < rawLines.length && rawLines[i].trim().startsWith('|')) {
        tbl.push(rawLines[i]);
        i++;
      }
      blocks.push({ kind: 'table', lines: tbl, startIdx });
    } else {
      blocks.push({ kind: 'line', lines: [rawLines[i]], startIdx: i });
      i++;
    }
  }

  // ---- Pass 2: filter blocks ----
  const kept: string[] = [];
  let inForbiddenSection = false;
  const seenH2Topics = new Set<string>();
  const topicOf = (heading: string): string | null => {
    const h = heading.toLowerCase();
    if (/\b(transport|connectivity|commute|rail|road network)\b/.test(h)) return 'transport';
    if (/\bpopulation\s+(growth|trends)\b/.test(h)) return 'population';
    if (/\beducation\b/.test(h) && /\bfamily\b/.test(h)) return 'education-family';
    return null;
  };

  for (const blk of blocks) {
    if (blk.kind === 'table') {
      // Drop the entire table if ANY row matches a forbidden cell/header.
      const tainted = blk.lines.some(
        (ln) =>
          COMPASS40_FORBIDDEN_CELL_PATTERNS.some((p) => p.test(ln)) ||
          COMPASS40_FORBIDDEN_LINE_PATTERNS.some((p) => p.test(ln.replace(/^\|\s*/, '')))
      );
      if (tainted || inForbiddenSection) continue;

      // SEIFA validation: drop table if (a) all deciles identical (templated),
      // (b) any row's text label contradicts its decile direction, or
      // (c) the table is self-flagged as "Illustrative" / "Scenario".
      const isSeifa = blk.lines.some((ln) => /\b(SEIFA|IRSAD|IRSD|IEO|IER)\b/i.test(ln));
      if (isSeifa) {
        const deciles = blk.lines
          .map((ln) => ln.match(/\|\s*(\d{1,2})\s*\/\s*10\s*\|/))
          .filter(Boolean)
          .map((m) => parseInt(m![1], 10));
        if (deciles.length >= 3 && new Set(deciles).size === 1) continue;
        const contradicts = blk.lines.some((ln) => {
          const m = ln.match(/\|\s*(\d{1,2})\s*\/\s*10\s*\|.*\|\s*([^|]+?)\s*\|?\s*$/);
          if (!m) return false;
          const dec = parseInt(m[1], 10);
          const label = m[2].toLowerCase();
          if (dec >= 7 && /\bdisadvantag/.test(label) && !/low|moderate\s+to\s+low/.test(label)) return true;
          if (dec <= 3 && /\badvantag/.test(label) && !/dis/.test(label)) return true;
          return false;
        });
        if (contradicts) continue;
      }
      kept.push(...blk.lines);
      continue;
    }

    const line = blk.lines[0];
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      if (COMPASS40_FORBIDDEN_HEADINGS.some((p) => p.test(trimmed))) {
        inForbiddenSection = true;
        continue;
      }
      // Topic-collision dedup for H2 headings (transport, population, ...).
      const level = headingMatch[1].length;
      const cleanHeading = dedupeRepeatedWords(headingMatch[2]);
      const topic = level <= 2 ? topicOf(cleanHeading) : null;
      if (topic && seenH2Topics.has(topic)) {
        inForbiddenSection = true;
        continue;
      }
      if (topic) seenH2Topics.add(topic);
      inForbiddenSection = false;
      kept.push(`${headingMatch[1]} ${cleanHeading}`);
      continue;
    }
    if (inForbiddenSection) continue;

    // Line-start forbidden patterns (e.g. "Estimated Purchase Price ...").
    if (COMPASS40_FORBIDDEN_LINE_PATTERNS.some((p) => p.test(line))) continue;

    // Bullet-level financial leak ($X or N% paired with finance keyword).
    if (COMPASS40_FORBIDDEN_BULLET_REGEX.test(line)) continue;

    // Sentence-level financial leak scrub for prose lines.
    if (line && /[.!?]/.test(line)) {
      const sentences = line.split(/(?<=[.!?])\s+/);
      const scrubbed = sentences.filter((s) => !COMPASS40_FORBIDDEN_SENTENCE_REGEX.test(s));
      if (scrubbed.length === 0) continue;
      kept.push(scrubbed.join(' '));
      continue;
    }

    kept.push(line);
  }

  let out = kept.join('\n');

  /*
   * Strip Perplexity-style inline citation markers like [1], [2], [1][3].
   *
   * A marker between two word characters leaves a SPACE, not nothing. The
   * model emits `location[1]and dwelling` — the marker attaches to the word
   * before it and the next word follows with no space of its own — so removing
   * it outright printed `**Top strengths (locationand dwelling):**` on page 2
   * of the 17 Sep 2026 regeneration of 262 Pallas Street. Verified in the
   * stored bytes: `20 737472656e67746873 20 28 6c6f636174696f6e 616e64 20`,
   * with nothing between "location" and "and".
   *
   * Everywhere else the marker goes outright, so `rate[1].` does not become
   * `rate .`; the boundary is what decides, not the marker.
   */
  out = out.replace(/(\w)\[\d+\](?:\[\d+\])*(\w)/g, '$1 $2');
  out = out.replace(/\[\d+\](?:\[\d+\])*/g, '');

  // Strip placeholder tokens
  out = out.replace(/\[(citation(?:\s+needed)?|source(?:\s+needed)?|TBD|placeholder)\]/gi, '');
  out = out.replace(/\((citation(?:\s+needed)?|source(?:\s+needed)?|TBD|placeholder)\)/gi, '');

  // Strip leaked binding labels left in prose (e.g. "Interest Rate: 6.5%",
  // "Capital Growth: 5% per annum") — these come from the override-injection.
  out = out.replace(/\b(Interest Rate|Capital Growth(?:\s+Rate)?|LVR|Loan[-\s]?to[-\s]?Value(?:\s+Ratio)?|Purchase Price|Weekly Rent|Loan Amount|Stamp Duty|Deposit|CPI Growth Rate)\s*:\s*\$?[\d.,]+\s*%?\s*(?:per\s+annum|p\.?\s*a\.?)?\s*\)?/gi, '');
  // Drop stray placeholder strings the model never resolved (e.g. "Medical Centre Name").
  out = out.replace(/\b(Medical Centre|School|Suburb|Hospital|Park|Station|Shopping Centre)\s+Name\b/gi, '');

  // Drop orphaned "What This Means" labels with no body before next heading.
  out = out.replace(
    /(^|\n)(?:>\s*)?\**\s*(?:#{1,4}\s*)?(?:WHAT\s+THIS\s+MEANS|What\s+This\s+Means)\s*:?\s*\**\s*(?:[-–—]{1,3})?\s*(?=\n\s*(?:#{1,4}\s|$))/g,
    '$1'
  );

  // Trim trailing partial sentence (when model hit max_tokens mid-thought).
  out = trimDanglingSentence(out);

  // Collapse 3+ blank lines that result from dropped rows.
  out = out.replace(/\n{3,}/g, '\n\n').trimEnd();

  // Drop self-flagged "Illustrative" / "Scenario" disclaimers that follow
  // SEIFA or other data tables (these admit the numbers are fabricated).
  out = out.replace(/\([^)]*\b(Illustrative|Consistent\s+Scenario|Indicative\s+Scenario|Hypothetical)\b[^)]*\)/gi, '');

  // Cross-section dedup: drop a markdown table if an identical row signature
  // appeared earlier in the same content blob (e.g. "Family demand strength
  // vs trade-offs" table rendered twice).
  const seenTableSig = new Set<string>();
  out = out.split(/\n\n+/).filter((para) => {
    if (!/^\s*\|/.test(para)) return true;
    const sig = para
      .split('\n')
      .filter((l) => l.trim().startsWith('|') && !/^\s*\|[\s\-:|]+\|\s*$/.test(l))
      .map((l) => l.replace(/\s+/g, ' ').trim().toLowerCase())
      .slice(0, 4)
      .join('||');
    if (!sig) return true;
    if (seenTableSig.has(sig)) return false;
    seenTableSig.add(sig);
    return true;
  }).join('\n\n');

  return out;
}

function trimDanglingSentence(text: string): string {
  if (!text) return text;
  if (/[.!?")\]}]\s*$/.test(text)) return text;
  const lastTerminator = Math.max(
    text.lastIndexOf('. '),
    text.lastIndexOf('! '),
    text.lastIndexOf('? '),
    text.lastIndexOf('.\n'),
    text.lastIndexOf('!\n'),
    text.lastIndexOf('?\n'),
  );
  if (lastTerminator > text.length - 800 && lastTerminator > 200) {
    return text.slice(0, lastTerminator + 1).trimEnd();
  }
  return text;
}

// Dynamic sections - populated from database template at runtime
let REPORT_SECTIONS: ReportSectionDefinition[] = [...DEFAULT_REPORT_SECTIONS];

// ============================================================================
// CAPITAL GROWTH EXTRACTION - Extract researched capital growth from AI content
// ============================================================================
// Perplexity is instructed to research capital growth when not provided.
// This function extracts that researched value from the generated content.
// ============================================================================

/**
 * Extracts capital growth rate from AI-generated report content
 * Looks for patterns like "5.2% capital growth", "capital appreciation of 4.5%", etc.
 * Returns null if no valid rate is found
 */
function extractCapitalGrowthFromContent(content: string): number | null {
  if (!content) return null;
  
  // Pattern priority order - most specific first
  const patterns = [
    // "capital growth rate of X%", "capital growth of X%"
    /capital\s+growth\s+(?:rate\s+)?(?:of\s+)?(\d+(?:\.\d+)?)\s*%/gi,
    // "X% capital growth", "X% annual capital growth"
    /(\d+(?:\.\d+)?)\s*%\s*(?:annual\s+)?capital\s+growth/gi,
    // "annual appreciation of X%", "property appreciation of X%"
    /(?:annual|property)\s+appreciation\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*%/gi,
    // "X% annual appreciation"
    /(\d+(?:\.\d+)?)\s*%\s*annual\s+(?:property\s+)?appreciation/gi,
    // "median price growth of X%", "historical growth of X%"
    /(?:median\s+price|historical)\s+growth\s+(?:of\s+)?(\d+(?:\.\d+)?)\s*%/gi,
    // "X-X% annual growth" - take the average
    /(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*%\s*(?:annual\s+)?(?:capital\s+)?growth/gi,
  ];
  
  for (const pattern of patterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      // Handle range patterns (e.g., "4-6%")
      if (match[2] !== undefined) {
        const low = parseFloat(match[1]);
        const high = parseFloat(match[2]);
        if (!isNaN(low) && !isNaN(high) && low >= 0 && low <= 20 && high >= 0 && high <= 20) {
          const avg = (low + high) / 2;
          console.log(`📊 Extracted capital growth range: ${low}%-${high}%, using average: ${avg}%`);
          return avg;
        }
      } else {
        const rate = parseFloat(match[1]);
        // Validate: capital growth should typically be between 0% and 15%
        if (!isNaN(rate) && rate >= 0 && rate <= 15) {
          console.log(`📊 Extracted capital growth rate: ${rate}%`);
          return rate;
        }
      }
    }
  }
  
  console.log('⚠️ Could not extract capital growth rate from content');
  return null;
}

// ============================================================================
// DYNAMIC TEMPLATE PARSING
// ============================================================================
// Extracts H2 section headings from database template and groups them
// into generation sections while preserving the template's order
// ============================================================================

interface ParsedTemplateStructure {
  headings: string[];
  sections: ReportSectionDefinition[];
  templateName: string;
  templateId: string;
}

/**
 * Parses the template content to extract H2 headings and create section definitions
 * Falls back to DEFAULT_REPORT_SECTIONS if parsing fails
 */
function parseTemplateStructure(
  templateContent: string,
  templateName: string = 'Unknown',
  templateId: string = ''
): ParsedTemplateStructure {
  try {
    // Extract all H2 headings (## Heading)
    const h2Pattern = /^## ([^\n]+)/gm;
    const headings: string[] = [];
    let match;
    
    while ((match = h2Pattern.exec(templateContent)) !== null) {
      const heading = match[1].trim();
      // Skip empty or very short headings
      if (heading.length > 2) {
        headings.push(heading);
      }
    }
    
    console.log(`📋 Parsed ${headings.length} H2 headings from template "${templateName}"`);
    
    if (headings.length < 5) {
      console.log('⚠️ Too few headings found, using default sections');
      return {
        headings: [],
        sections: DEFAULT_REPORT_SECTIONS,
        templateName,
        templateId
      };
    }
    
    // Group headings into logical sections based on keywords and order
    const sections = groupHeadingsIntoSections(headings);
    
    console.log(`✓ Created ${sections.length} generation sections from template`);
    sections.forEach((s, i) => {
      console.log(`  Section ${i}: ${s.name} → [${s.sections.join(', ')}]`);
    });
    
    return {
      headings,
      sections,
      templateName,
      templateId
    };
  } catch (error) {
    console.error('⚠️ Template parsing error:', error);
    return {
      headings: [],
      sections: DEFAULT_REPORT_SECTIONS,
      templateName,
      templateId
    };
  }
}

/**
 * Groups extracted headings into logical generation sections
 * Maintains order from template while grouping related topics
 */
function groupHeadingsIntoSections(headings: string[]): ReportSectionDefinition[] {
  // Keyword mapping for section grouping
  const sectionKeywordMap: Record<string, { keywords: string[], name: string, requiredKeywords: string[], maxTokens: number, minContentLength: number }> = {
    'executive': {
      keywords: ['executive', 'summary', 'overview report'],
      name: 'Executive Summary',
      requiredKeywords: ['investment', 'property', 'recommendation', 'score'],
      maxTokens: 2500,
      minContentLength: 2500
    },
    'location': {
      keywords: ['location', 'suburb character'],
      name: 'Location Overview',
      requiredKeywords: ['suburb', 'community', 'lifestyle'],
      maxTokens: 2500,
      minContentLength: 2500
    },
    'market': {
      keywords: ['market', 'economic', 'economy'],
      name: 'Market & Economics',
      requiredKeywords: ['market', 'cash rate', 'growth'],
      maxTokens: 2500,
      minContentLength: 2500
    },
    'demographics': {
      keywords: ['demographic', 'demand', 'population'],
      name: 'Demographics & Demand',
      requiredKeywords: ['population', 'income', 'employment'],
      maxTokens: 2500,
      minContentLength: 2500
    },
    'education': {
      keywords: ['school', 'education', 'healthcare', 'hospital', 'shopping'],
      name: 'Education & Healthcare',
      requiredKeywords: ['school', 'education', 'healthcare'],
      maxTokens: 2500,
      minContentLength: 2500
    },
    'recreation': {
      keywords: ['recreation', 'transport', 'accessibility', 'amenities', 'commute'],
      name: 'Recreation & Transport',
      requiredKeywords: ['recreation', 'transport', 'commute'],
      maxTokens: 2500,
      minContentLength: 2500
    },
    'environment': {
      keywords: ['environment', 'climate', 'crime', 'safety', 'flood', 'bushfire', 'risk'],
      name: 'Environment & Safety',
      requiredKeywords: ['flood', 'crime', 'safety'],
      maxTokens: 4000,
      minContentLength: 3500
    },
    'property': {
      // Updated: Property section now includes Strategic Assessment, Opportunities, and Risks subsections
      keywords: ['property-level', 'property level', 'zoning', 'land size', 'building', 'strategic assessment', 'capital appreciation', 'leveraged equity', 'employment growth', 'cashflow deficit', 'interest rate sensitivity', 'environmental risk'],
      name: 'Property & Zoning',
      requiredKeywords: ['property', 'zoning', 'strategic', 'opportunity', 'risk'],
      maxTokens: 5000,
      minContentLength: 4500
    },
    'costs': {
      keywords: ['purchase', 'ongoing costs', 'rental', 'yield', 'stamp duty'],
      name: 'Costs & Rental',
      requiredKeywords: ['purchase', 'rent', 'yield'],
      maxTokens: 2500,
      minContentLength: 2500
    },
    'loan': {
      keywords: ['loan', 'repayment', 'sensitivity', 'cashflow', 'mortgage'],
      name: 'Loan & Sensitivity',
      requiredKeywords: ['loan', 'repayment', 'cashflow'],
      maxTokens: 2500,
      minContentLength: 2500
    },
    'projections': {
      // Removed: Top 3 Opportunities (now under Property section)
      keywords: ['projection', 'swot', 'investment score', '10-year', 'ten year'],
      name: 'Projections & SWOT',
      requiredKeywords: ['projection', 'swot'],
      maxTokens: 3000,
      minContentLength: 3000
    },
    'recommendations': {
      // Removed: Top 3 Risks (now under Property section)
      keywords: ['recommendation', 'conclusion', 'final', 'suitability'],
      name: 'Risks & Recommendations',
      requiredKeywords: ['recommendation', 'conclusion'],
      maxTokens: 4000,
      minContentLength: 3000
    }
  };
  
  // Group headings by matching keywords
  const groups: Record<string, string[]> = {};
  const usedHeadings = new Set<string>();
  
  // First pass: assign headings to groups based on keyword matches
  for (const heading of headings) {
    const headingLower = heading.toLowerCase();
    
    for (const [groupKey, config] of Object.entries(sectionKeywordMap)) {
      if (config.keywords.some(kw => headingLower.includes(kw))) {
        if (!groups[groupKey]) {
          groups[groupKey] = [];
        }
        groups[groupKey].push(heading);
        usedHeadings.add(heading);
        break; // Assign to first matching group
      }
    }
  }
  
  // Second pass: assign unmatched headings to nearest logical group
  for (const heading of headings) {
    if (!usedHeadings.has(heading)) {
      // Default unmatched headings to 'recommendations' section
      if (!groups['recommendations']) {
        groups['recommendations'] = [];
      }
      groups['recommendations'].push(heading);
      console.log(`  Unmatched heading "${heading}" → recommendations`);
    }
  }
  
  // Build final section definitions in correct order
  const orderedKeys = ['executive', 'location', 'market', 'demographics', 'education', 'recreation', 'environment', 'property', 'costs', 'loan', 'projections', 'recommendations'];
  const sections: ReportSectionDefinition[] = [];
  
  for (let i = 0; i < orderedKeys.length; i++) {
    const key = orderedKeys[i];
    const config = sectionKeywordMap[key];
    const groupHeadings = groups[key] || [];
    
    // Only include section if it has headings OR use fallback from defaults
    if (groupHeadings.length > 0) {
      sections.push({
        id: `section${i}`,
        name: config.name,
        sections: groupHeadings,
        maxTokens: config.maxTokens,
        minContentLength: config.minContentLength,
        requiredKeywords: config.requiredKeywords
      });
    } else {
      // Use fallback from defaults if no headings matched
      const defaultSection = DEFAULT_REPORT_SECTIONS.find(s => s.id === `section${i}`);
      if (defaultSection) {
        sections.push(defaultSection);
      }
    }
  }
  
  return sections;
}

// Section validation helper — is this section the right size and shape?
//
// This is the only gate that runs inside the generation loop, and until v3.0
// every rule in it pushed one way: too short scored a penalty, fewer than three
// headings scored a penalty, and NOTHING had an upper bound. A model asked to
// clear a floor with no ceiling clears it by a wide margin, which is how a
// report with a 9,170-word budget came to run at ~21,000. The bounds below are
// symmetric now.
function validateSectionContent(
  sectionDef: typeof REPORT_SECTIONS[0],
  content: string
): { isValid: boolean; issues: string[]; score: number } {
  const issues: string[] = [];
  let score = 100;

  // Check minimum content length
  const contentLength = content?.length || 0;
  if (contentLength < sectionDef.minContentLength) {
    issues.push(`Content too short: ${contentLength} chars (min: ${sectionDef.minContentLength})`);
    score -= 30;
  }

  // And the ceiling, which is the half that was missing. `maxContentLength` is
  // derived from the section's own word cap, so this cannot drift from it.
  const maxContentLength = sectionDef.maxContentLength ?? 0;
  if (maxContentLength > 0 && contentLength > maxContentLength) {
    issues.push(`Content too long: ${contentLength} chars (max: ${maxContentLength})`);
    score -= 20;
  }

  // Check for required keywords (case-insensitive)
  const contentLower = (content || '').toLowerCase();
  const missingKeywords = (sectionDef.requiredKeywords || []).filter(
    kw => !contentLower.includes(kw.toLowerCase())
  );

  if (missingKeywords.length > 0) {
    issues.push(`Missing content areas: ${missingKeywords.join(', ')}`);
    score -= missingKeywords.length * 10;
  }

  // Check for structural elements (headings, tables). One heading is structure;
  // three was a floor the model met by inventing sub-headings, and 68 `###` a
  // report was the structural half of the noise this change removes.
  const headingCount = (content?.match(/^#{1,3}\s+/gm) || []).length;
  if (headingCount < 1) {
    issues.push(`Insufficient structure: only ${headingCount} headings found`);
    score -= 15;
  } else if (headingCount > MAX_SECTION_HEADINGS) {
    issues.push(`Over-structured: ${headingCount} headings (max ${MAX_SECTION_HEADINGS})`);
    score -= 10;
  }

  // Commentary labels. The post-processor strips these before the report is
  // stored; flagging here means a section that produces them is visible in the
  // generation log rather than only in the diff between raw and stored content.
  const editorialHits = (content || '')
    .split('\n')
    .filter((line) => EDITORIAL_LABEL_PROBE.test(line)).length;
  if (editorialHits > 0) {
    issues.push(`Contains ${editorialHits} editorial commentary label(s); they will be stripped`);
    score -= 10;
  }
  
  // Check for data presentation (tables with |)
  const hasDataTables = content?.includes('|') && content?.includes('---');
  if (!hasDataTables && sectionDef.id !== 'section4') {
    issues.push('No data tables found');
    score -= 10;
  }
  
  return {
    isValid: score >= 60, // Threshold for acceptable content
    issues,
    score: Math.max(0, score)
  };
}

// ============================================================================
// ROBUSTNESS INFRASTRUCTURE - Circuit Breaker, Retry with Jitter, Timeouts
// ============================================================================

// Circuit breaker state for tracking failed services
const circuitBreaker = new Map<string, { failures: number; lastFailure: number; isOpen: boolean }>();
const CIRCUIT_BREAKER_THRESHOLD = 2; // Open after 2 failures
const CIRCUIT_BREAKER_RESET_MS = 30000; // Reset after 30 seconds

function isCircuitOpen(serviceName: string): boolean {
  const state = circuitBreaker.get(serviceName);
  if (!state) return false;
  
  // Check if circuit should reset
  if (state.isOpen && Date.now() - state.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
    state.isOpen = false;
    state.failures = 0;
    return false;
  }
  
  return state.isOpen;
}

function recordServiceFailure(serviceName: string): void {
  const state = circuitBreaker.get(serviceName) || { failures: 0, lastFailure: 0, isOpen: false };
  state.failures++;
  state.lastFailure = Date.now();
  
  if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    state.isOpen = true;
    console.log(`🔴 Circuit breaker OPEN for ${serviceName} after ${state.failures} failures`);
  }
  
  circuitBreaker.set(serviceName, state);
}

function recordServiceSuccess(serviceName: string): void {
  circuitBreaker.delete(serviceName);
}

// Helper function to add jitter to prevent thundering herd
function getRetryDelayWithJitter(attempt: number, baseDelayMs: number = 2000): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 1000; // 0-1000ms random jitter
  return Math.min(exponentialDelay + jitter, 15000); // Cap at 15 seconds
}

// Helper function to fetch with timeout and circuit breaker
async function fetchWithTimeout(
  url: string, 
  options: RequestInit, 
  timeoutMs: number = 90000,
  serviceName?: string
): Promise<Response> {
  // Check circuit breaker
  if (serviceName && isCircuitOpen(serviceName)) {
    throw new Error(`Circuit breaker open for ${serviceName}, skipping request`);
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`⏱️ Request timeout after ${timeoutMs}ms, aborting...`);
    controller.abort();
  }, timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (serviceName && response.ok) {
      recordServiceSuccess(serviceName);
    }
    
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (serviceName) {
      recordServiceFailure(serviceName);
    }
    
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000} seconds`);
    }
    throw error;
  }
}

// Wrapper for parallel API calls with graceful degradation
interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  serviceName: string;
}

async function fetchServiceWithFallback<T>(
  serviceName: string,
  fetchFn: () => Promise<T | null>,
  fallbackValue: T | null = null
): Promise<ServiceResult<T>> {
  if (isCircuitOpen(serviceName)) {
    console.log(`⏭️ Skipping ${serviceName} (circuit breaker open)`);
    return { success: false, error: 'Circuit breaker open', serviceName, data: fallbackValue || undefined };
  }
  
  try {
    const startTime = Date.now();
    const result = await fetchFn();
    const duration = Date.now() - startTime;
    
    if (result) {
      console.log(`✓ ${serviceName} completed in ${duration}ms`);
      recordServiceSuccess(serviceName);
      return { success: true, data: result, serviceName };
    } else {
      console.log(`⚠️ ${serviceName} returned no data (${duration}ms)`);
      return { success: false, error: 'No data returned', serviceName, data: fallbackValue || undefined };
    }
  } catch (error: any) {
    console.log(`❌ ${serviceName} failed:`, error?.message || 'Unknown error');
    recordServiceFailure(serviceName);
    return { success: false, error: error?.message, serviceName, data: fallbackValue || undefined };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EDITORIAL PRIMITIVES — shortcodes the WeasyPrint renderer converts into
// pull-quotes, sidenotes, multi-column blocks, SVG visualisations, footnotes
// and cross-references. Inject this block into every generator prompt so the
// model knows the exact syntax. Keep terse — the model just needs the contract.
// ─────────────────────────────────────────────────────────────────────────────
const EDITORIAL_PRIMITIVES_BLOCK = `
**EDITORIAL PRIMITIVES (VISUAL-FIRST — USE THESE TO REPLACE DENSE PROSE)**

You may emit these block-level shortcodes inside the markdown. The renderer
converts them to print-quality typography and inline SVG. Visuals are not optional:
each chapter should carry one opener strip plus multiple in-flow visualisations.
Keep pull-quotes rare, but use data visuals wherever they replace a paragraph or
table. Each shortcode must sit on its own line(s), with a blank line before and after.

1. PULL QUOTE — for one striking sentence that summarises the chapter's thesis.
\`\`\`
::: pullquote
A weighted score of 78/100 places this property in the top quartile for combined yield and growth.
:::
\`\`\`

2. SIDENOTE — short aside that hangs in the right margin (≤25 words).
\`\`\`
::: sidenote
Council rezoning to MU3 was gazetted March 2026, lifting permissible density.
:::
\`\`\`

3. GAUGE — single-metric score visualisation (0–100 unless max specified).
   Format: \`{{gauge: VALUE[/MAX] | LABEL | CAPTION}}\`
\`\`\`
{{gauge: 78 | Investment Score | Weighted composite}}
\`\`\`

4. WATERFALL — cash-flow build-up. Use \`+\` / \`-\` for movements, \`=\` for totals.
   Numbers can include $ signs and commas; they will be parsed.
\`\`\`
{{waterfall: Gross Rent +28000, Interest -19500, Outgoings -4200, Tax shield +1100, Net =5400}}
\`\`\`

5. HEATMAP — m×n matrix; rows separated by \`/\`, cells by \`,\`.
   Format: \`{{heatmap: VALUES | rows=A,B,C | cols=X,Y,Z | title=…}}\`
\`\`\`
{{heatmap: 5.2,6.1,7.4 / 4.8,5.9,6.7 / 3.1,4.0,5.2 | rows=2024,2025,2026 | cols=Q1,Q2,Q3 | title=Suburb Growth %}}
\`\`\`

6. SCORECARD — named dimensions each scored out of 100 (2+ scores). Drawn as
   horizontal bars on a common baseline; never as a radar or spider chart.
   Format: \`{{wheel: s1,s2,s3,… | labels=L1,L2,L3,… | max=100 | title=…}}\`
\`\`\`
{{wheel: 78,64,82,71,55 | labels=Yield,Growth,Risk,Demand,Infra | title=Score Breakdown}}
\`\`\`

7. FOOTNOTES — for source citations or methodology notes. Use \`[^id]\` at the
   call-site and \`[^id]: text\` on its own line for the definition.
\`\`\`
The 5-year capital growth rate sits at 7.2%[^abs1].

[^abs1]: ABS Cat. 6416.0, residential property price indexes, March 2026.
\`\`\`

8. CROSS-REFERENCE — auto-resolves to the printed page number.
   Format: \`[[see:#chapter-anchor-id]]\` or \`[[see:#id|custom prefix]]\`
\`\`\`
For full risk methodology [[see:#ch-risk-analysis]].
\`\`\`

9. SECTION DIVIDER — full-bleed dark "chapter break" page with one oversized
   statistic. Use AT MOST ONCE per chapter, only when a single headline number
   genuinely anchors the section's argument (e.g. "78" for an investment score,
   "4.8%" for a yield, "$28k" for projected first-year cash flow).
   Format:
\`\`\`
::: divider stat="78" label="Composite investment score" eyebrow="Chapter 04 · Verdict"
Why this property earns a top-quartile rating.
:::
\`\`\`

10. QUOTE PAGE — full-bleed paper-toned page with a single editorial pull-quote
    on its own spread. Use AT MOST ONCE per report, reserved for the most
    important strategic line (e.g. our thesis on the suburb, RBA commentary).
    Format:
\`\`\`
::: quote-page attribution="RBA Statement on Monetary Policy, May 2026" eyebrow="Market context"
"Housing demand remains underpinned by population growth running well above the long-run average."
:::
\`\`\`

11. STAT BLOCK — inline oversized statistic that breaks up dense prose. Use for
    a key in-flow number that doesn't warrant a full divider page.
    Format: \`::: stat label="…" unit="%" sub="…"  \\n  4.8  \\n  :::\`
\`\`\`
::: stat label="Median rental yield" unit="%" sub="Suburb median, 12-mo trailing"
4.8
:::
\`\`\`

12. HORIZONTAL BARS — Tufte-style ranked comparator for MEASURED quantities:
    prices against a median, distances, travel times, counts, shares, rates.
    Each row = label + value, and every value must be one supplied to you.
    Values can be raw numbers, percentages (e.g. \`70%\`), or money (\`$1.2M\`, \`450k\`).
    NOT a scorecard: do not rank qualities by numbers you assign, and do not set
    \`max=100\` on a chart whose values you chose — see the rating rule below.
    Format: \`{{bars: Label1 70, Label2 45%, Label3 $1.2M | title=… | unit=%}}\`
\`\`\`
{{bars: Subject $565k, Suburb median $498k, Regional median $451k | title=Price against the market | unit=$}}
\`\`\`

13. QUADRANT MATRIX — 2×2 scatter for trade-off framing (Risk×Return, Yield×Growth,
    Cost×Speed). Append \`*\` to a point to highlight (gold). Quadrant labels (q1..q4)
    label corners clockwise from top-right.
    Format: \`{{quadrant: x,y "label", x,y "label"* | xlabel=Yield | ylabel=Growth | xmax=10 | ymax=10 | q1=Sweet spot | q2=Capital play | q3=Avoid | q4=Income play | title=…}}\`
\`\`\`
{{quadrant: 7.4,8.1 "This property"*, 5.2,6.8 "Suburb median", 4.1,5.5 "Metro median" | xlabel=Yield % | ylabel=Growth % | xmax=10 | ymax=10 | q1=Sweet spot | q2=Capital play | q3=Avoid | q4=Income play | title=Yield vs Growth}}
\`\`\`

14. PICTOGRAPH — icon-array showing "K of N". Killer for tenure mix, demographics,
    ownership ratios. \`icon\` is \`person\`, \`house\` or \`dollar\`.
    Format: \`{{pictograph: FILLED/TOTAL | label=… | sub=… | icon=person | cols=10}}\`
\`\`\`
{{pictograph: 3/10 | label=Renter share | sub=3 in 10 dwellings are tenanted | icon=person | cols=10}}
\`\`\`

15. AT-A-GLANCE STRIP — 3-4 cell editorial strip that opens a chapter. Each cell:
    "<symbol> <text>". Symbols: ✓ strength, ⚠ watch, ▲ trend up, ▼ trend down, ◆ metric, ★ verdict.
    Use ONCE at the very top of each chapter (right after the H2) to compress the
    "TL;DR" so the reader doesn't have to wade through prose to find the verdict.
    Format: \`{{glance: ✓ Strong fundamentals | ⚠ Vacancy uptick | ◆ Yield 4.8% | ★ Buy with caveats}}\`
\`\`\`
{{glance: ✓ Top-quartile growth | ⚠ Body-corporate fees rising | ◆ Median $1.18M | ★ Hold 7-10y}}
\`\`\`

16. INLINE SPARKLINE — tiny chart that flows next to prose. Use inside a sentence
    to show a trend ("yields ~~[4.2,4.4,4.6,4.5,4.8]~~ now 4.8%"). 5-12 numbers ideal.
    Format: \`~~[v1,v2,v3,…]~~\`
\`\`\`
Median values have climbed steadily ~~[820,860,910,980,1050,1180]~~ over six years.
\`\`\`

17. DONUT / RING — composition chart for mixes (tenure, demographics, capital
    allocation, expense shares). Center number is the headline slice.
    Format: \`{{donut: SliceA value, SliceB value, … | title=… | center=58% | centerSub=Owner-occupied}}\`
\`\`\`
{{donut: Owner-occupied 58, Renter 32, Other 10 | title=Tenure mix | center=58% | centerSub=Owner-occupied}}
\`\`\`

18. SUBURB TILES — small-multiples grid that reads like a faux-choropleth. Use
    for "this suburb + 3-7 adjacent suburbs" comparisons. \`int=0..1\` shades the
    tile (higher = stronger). \`sub\` lives in quotes.
    Format: \`{{tiles: Label value sub="…" int=0.7, Label value sub="…" int=0.5 | title=… | cols=4}}\`
\`\`\`
{{tiles: Hawthorn $1.42M sub="↑ 6.4% YoY" int=0.85, Kew $1.61M sub="↑ 5.1% YoY" int=0.70, Camberwell $1.28M sub="↑ 4.8% YoY" int=0.60, Glen Iris $1.19M sub="↑ 3.2% YoY" int=0.45 | title=Adjacent suburbs · median house | cols=4}}
\`\`\`

19. MARGIN MICRO-CHART — editorial sidenote with a tiny sparkline. Use to flag
    a single supporting datum without breaking prose flow. Keep \`note\` to one line.
    Format: \`{{margin: Title | spark=v1,v2,v3,… | note=One-line context | label=Context}}\`
\`\`\`
{{margin: Median rent, last six quarters | spark=v1,v2,v3,v4,v5,v6 | note=One line of context, from the figures in this report. | label=Rental watch}}
\`\`\`

20. TIMELINE RIBBON — infrastructure / delivery pipeline. Use instead of a list
    of projects and timing windows.
    Format: \`{{timeline: Existing "Station access", 0-2y "Road upgrade", 3-5y "Hospital stage", 5y+ "Town centre renewal" | title=Infrastructure pipeline}}\`

21. BIG-NUMBER KPI STRIPS — when a sentence says "median grew from X to Y" or
    compares 3 headline metrics, use stat blocks / gauges / bars rather than prose.
    Use \`::: stat\` for a single in-flow number, \`{{bars}}\` for X vs suburb vs metro,
    and \`~~[…]~~\` beside any trend sentence.

VISUAL-FIRST RULES (CRITICAL):
- Every chapter MUST open with a \`{{glance: …}}\` strip immediately after the H2.
- **At most 2 visualisations per chapter**, drawn from the full library
  (gauge / bars / quadrant / pictograph / donut / tiles / heatmap / wheel /
  waterfall / margin / timeline / stat / inline sparkline), each showing data
  that is not also in a table on the same page. Prose INTRODUCES a visualisation
  and never restates it afterwards.
- Any "median grew from X to Y" / trend sentence MUST include either \`~~[…]~~\` inline or a \`::: stat\` callout nearby.
- Any "subject vs suburb vs metro/state" comparison MUST use \`{{bars: Subject X, Suburb Y, Metro Z | title=…}}\`.
- **A RATING YOU INVENTED MAY NOT BE DRAWN, IN ANY PRIMITIVE.** A 0-100 rating is a SCORE, and the only scores that exist are the ones supplied to you above — the Investment Score and the dimensions the engine actually scored. Do NOT mint a rating for appeal, suitability, confidence, affordability, land quality, certainty, risk, "focus", "emphasis" or any other attribute, and do NOT draw one as a \`{{gauge}}\`, a \`{{wheel}}\`, a \`{{bars}}\`, a \`{{heatmap}}\`, a \`{{radar}}\` or anything else. In particular: do NOT write \`max=100\` on a chart whose numbers you chose. Where no score was supplied, state the finding in WORDS and draw no chart of it. A number on a scale is read as a measurement however it is drawn, and the reader has no way to tell one you assigned from one that was calculated.
- Any list of 3+ ranked metrics MUST be rendered as \`{{bars: …}}\` instead of a table — where the metrics are MEASURED quantities that came from the data supplied to you (distances, counts, prices, shares, times, rates), each carrying its own real unit. A list of qualities you are ranking yourself is not a set of metrics: write it as prose or as a table with the reasons in it.
- Any "X of Y households / dwellings / buyers" stat MUST use \`{{pictograph: …}}\`.
- Any composition / share-of-total (tenure mix, age bands, expense split, capital
  allocation) MUST use \`{{donut: …}}\` instead of a table.
- Any suburb × metric matrix MUST use \`{{heatmap: …}}\` — with measured values in their own units, never scores you assigned.
- An infrastructure/project pipeline is drawn with \`{{timeline: …}}\` — and ONLY from items in the Infrastructure & Development Outlook table, using the dates that table carries. With no evidenced items, draw no timeline.
- Any "subject suburb vs N nearby suburbs" comparison MUST use \`{{tiles: …}}\`.
- Any trade-off between two dimensions (yield vs growth, risk vs return) MUST use
  \`{{quadrant: …}}\`. Highlight the subject property with a trailing \`*\`.
- Use \`{{margin: …}}\` to push secondary context off the main column instead of
  parenthetical asides — saves prose and adds visual rhythm.
- Use \`~~[…]~~\` inline sparklines liberally for any time-series mentioned in prose.
- **EVERY FIGURE STATES ITS BASIS, IN WORDS THE READER CAN SEE.** A number drawn on a page is read as a measurement, so the sentence introducing a chart — or the line immediately under it — must name where the numbers came from: the DATASET or register (ABS Census, SEIFA, the RBA, the state crime register, the planning register, the recorded calculation), the PERIOD it covers, the GEOGRAPHY it describes, and the UNITS. Write it plainly, e.g. "Tenure mix, ABS Census 2021, postal area 2794." or "Year-one cash position from the recorded calculation, before tax." Where you cannot name a dataset, a period or a modelled basis, do not draw the figure: state the finding in words. This applies to every occupier or tenure mix, every evidence or source breakdown, every readiness or fit reading and every risk chart.
- All shortcodes must use REAL figures from the data provided. Never fabricate.
- If a visualisation would duplicate a table on the same page, choose the visualisation.
- Cross-references must point to a chapter heading that actually exists.
- Footnote definitions must appear in the same section as the call.
- Section dividers and quote pages BREAK THE PAGE — only use when a moment of
  pause genuinely serves the reader. Never two in a row.
`;

const textEncoder = new TextEncoder();
const PERPLEXITY_MESSAGE_HARD_LIMIT_BYTES = 100_000;
const PERPLEXITY_SAFE_USER_MESSAGE_BYTES = 70_000;
const PERPLEXITY_SAFE_SYSTEM_MESSAGE_BYTES = 35_000;
const DOCUMENT_CONTEXT_MAX_BYTES = 24_000;
const TEMPLATE_CONTEXT_MAX_BYTES = 12_000;

function byteLength(value: string): number {
  return textEncoder.encode(value).length;
}

function sliceHeadByBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (byteLength(value.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return value.slice(0, lo);
}

function sliceTailByBytes(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  let lo = 0;
  let hi = value.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (byteLength(value.slice(value.length - mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return value.slice(value.length - lo);
}

function compactPromptContext(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function limitPromptContext(value: string, maxBytes: number, label: string, mode: 'head' | 'tail' | 'head-tail' = 'head-tail'): string {
  const compacted = compactPromptContext(value);
  const originalBytes = byteLength(compacted);
  if (originalBytes <= maxBytes) return compacted;

  const notice = `\n\n[${label} truncated from ${originalBytes.toLocaleString()} bytes to stay within Perplexity's ${PERPLEXITY_MESSAGE_HARD_LIMIT_BYTES / 1000}KB message limit. Prioritise extracted specifications and request fresh web research for missing details.]\n\n`;
  const remaining = Math.max(0, maxBytes - byteLength(notice));
  let text: string;
  if (mode === 'head') {
    text = sliceHeadByBytes(compacted, remaining) + notice;
  } else if (mode === 'tail') {
    text = notice + sliceTailByBytes(compacted, remaining);
  } else {
    const headBudget = Math.floor(remaining * 0.62);
    const tailBudget = remaining - headBudget;
    text = `${sliceHeadByBytes(compacted, headBudget)}${notice}${sliceTailByBytes(compacted, tailBudget)}`;
  }
  console.log(`✂️ ${label} trimmed: ${originalBytes} → ${byteLength(text)} bytes`);
  return text;
}

// Helper function to generate a single section via API with retry logic

async function generateReportSection(
  sectionDef: typeof REPORT_SECTIONS[0],
  basePrompt: string,
  /**
   * Context that may never be trimmed.
   *
   * The base prompt is ~92 KB and `limitPromptContext` cuts it to ~53 KB on
   * EVERY section (62% head, 38% tail), so a block in the middle of it is
   * dropped — measured on 262 Pallas Street, 17 Sep 2026, where every section
   * logged `92129 → ~52830`. The planning controls table and the infrastructure
   * evidence table sat in that middle while the rule that refers to them
   * ("ONLY from items in the Infrastructure & Development Outlook table") sat
   * in the section instructions, which are never trimmed. The model was left
   * holding a rule about a table it could not see, and filled the gap from live
   * web research: a zone, an overlay absence and a four-item delivery pipeline
   * that no register in this platform had answered.
   *
   * What a client document may state about planning is not allowed to depend on
   * a byte boundary, so this is budgeted for FIRST, placed after the trimmed
   * base prompt, and carried into the emergency compact prompt as well.
   */
  pinnedContext: string,
  systemMessage: string,
  perplexityApiKey: string,
  previousSections: string,
  propertyAddress: string,
  enhancedData: any,
  maxRetries: number = 2,
  /** Absolute time (ms) by which every model call for this section must be over; null = unbounded. */
  deadlineAt: number | null = null,
): Promise<{ content: string; citations: any[]; error?: string }> {
  // For section10 (Projections & SWOT), inject explicit investment score data
  let investmentScoreContext = '';
  if ((sectionDef.id === 'section10' || sectionDef.name.toLowerCase().includes('score')) && enhancedData?.investmentScore) {
    const score = enhancedData.investmentScore;
    console.log('📊 Injecting investment score data into section10 (Projections & SWOT):', {
      totalScore: score.totalScore,
      grade: score.grade,
      recommendation: score.recommendation
    });
    
    // No placeholder is handed to the model, because a placeholder handed to
    // a model is one it copies into the client's prose ("N/A/100" on real
    // reports). A dimension the engine did not score is left out, and a record
    // whose policy issued no grade states no grade and no total —
    // `publishableGrade` is the one rule that decides.
    const publishedGrade = publishableGrade(score);
    const dimensionLines = ([
      ['Growth', 'growthScore', 40], ['Location', 'locationScore', 25], ['Yield', 'yieldScore', 15],
      ['Demand', 'demandScore', 15], ['Risk', 'riskScore', 5],
    ] as const).map(([label, key, defaultWeight]) => {
      const d = score.breakdown?.[key];
      const scored = typeof d?.score === 'number' && d?.excluded !== true && d?.hasData !== false;
      return scored ? `- ${label} Score: ${d.score}/100 (Weight: ${d.weight ?? defaultWeight}%)` : null;
    }).filter((line): line is string => line !== null);
    investmentScoreContext = `
**INVESTMENT SCORE DATA (USE THESE EXACT VALUES):**
${publishedGrade
    ? `- Total Investment Score: ${score.totalScore}/100\n- Investment Grade: ${publishedGrade}\n- Recommendation: ${score.recommendation}`
    : '- No overall grade or total score is issued for this property. Do NOT state a grade, a score out of 100, or that a grade is unavailable — write the section without one.'}
${dimensionLines.join('\n')}
${score.strengths?.length ? `- Strengths: ${score.strengths.join(', ')}` : ''}
${score.weaknesses?.length ? `- Weaknesses: ${score.weaknesses.join(', ')}` : ''}
${score.opportunities?.length ? `- Opportunities: ${score.opportunities.join(', ')}` : ''}
${score.risks?.length ? `- Risks: ${score.risks.join(', ')}` : ''}

**CRITICAL: You MUST include the Investment Score Analysis section with the EXACT values above. Do NOT skip this section or use placeholder values.**

`;
  }

  const sectionInstructions = `

---
**SECTION GENERATION TASK:**
You are generating ONLY the following sections of a comprehensive investment report:
${sectionDef.sections.map(s => `- ${s}`).join('\n')}

${investmentScoreContext}${previousSections ? `**CONTEXT FROM PREVIOUS SECTIONS (for consistency — you MUST reuse the same figures for distances, risk levels, SEIFA scores, population, labor force, cashflow, and LVR/deposit):**
${previousSections.substring(Math.max(0, previousSections.length - 6000))}
` : ''}

**CRITICAL INSTRUCTIONS:**
1. Generate ONLY the sections listed above - no introduction, no conclusion beyond what's specified
 2. Follow the exact markdown formatting with ## for main section headings and ### for subsections
3. Use tables ONLY when a visual shortcode cannot express the data. Prefer \`{{bars}}\`, \`{{heatmap}}\`, \`{{donut}}\`, \`{{tiles}}\`, \`{{timeline}}\`, \`{{gauge}}\`, \`{{pictograph}}\`, and inline \`~~[…]~~\` sparklines over tables or long paragraphs.
4. NEVER follow a visual, table or data point with a paragraph explaining it. State the finding in the sentence that INTRODUCES the data, then show the data, then move on. Do not write ${EDITORIAL_LABELS.map((l) => `"${l}"`).join(', ')} — not as a heading, not as a bold lead-in, not as a bare line. There is no permitted number of these.
5. Lead each section with a \`{{glance: …}}\` strip carrying the section's own findings — not a description of what the section will cover.
6. Be thorough and accurate, but compress prose aggressively; every paragraph must add a fact that is not already on the page.
7. Start immediately with the first section heading - no preamble
8. Use contextual comparisons (e.g., "30% above the state average") to make numbers meaningful
9. End the section when its findings are stated. No transition sentence, no summary of what was just said, no preview of what comes next.
${sectionDef.id === 'section10' ? '10. MUST include the Investment Score Analysis section with the exact score values provided above' : ''}

**CROSS-SECTION CONSISTENCY (MANDATORY):**
- If previous sections mentioned specific distances, SEIFA scores, risk ratings, population figures, or cashflow numbers, you MUST use the EXACT same values. Do NOT introduce contradicting figures.
- If you compare a metric to a benchmark (e.g., yield vs national average), verify the comparison is mathematically correct BEFORE writing it. If 4.13% < 4.2%, say "slightly below", never "exceeds".
- Use ONLY the single financial scenario from the PRE-CALCULATED section (one LVR, one deposit amount). Do not introduce alternative scenarios unless explicitly creating a labelled comparison table.
- Do NOT fabricate hyper-specific percentages for infrastructure impact (e.g., "9.2% uplift"). Use ranges or qualitative language unless citing a specific study.
- If a property is negatively geared, describe it honestly as "growth-focused with negative cashflow" — never as "balanced growth + income".
- All time-sensitive economic data must include "as at [Month Year]".

${EDITORIAL_PRIMITIVES_BLOCK}

Generate the ${sectionDef.name} sections now:`;
  // Pinned context is never trimmed: its bytes come off the budget before the
  // base prompt is measured, and it is concatenated after the trim rather than
  // inside it. See the parameter's own note for what reached a client document
  // when this block was merely early in the base prompt.
  const pinnedBlock = pinnedContext.trim() ? `\n\n---\n\n${pinnedContext.trim()}\n` : '';
  const pinnedBytes = byteLength(pinnedBlock);
  const sectionInstructionBytes = byteLength(sectionInstructions);
  const basePromptBudget = Math.max(0, PERPLEXITY_SAFE_USER_MESSAGE_BYTES - sectionInstructionBytes - pinnedBytes - 2_000);
  const safeBasePrompt = limitPromptContext(basePrompt, basePromptBudget, `Base prompt for ${sectionDef.name}`);
  /*
   * Logged on every section, trimmed or not.
   *
   * `limitPromptContext` speaks only when it CUTS, so a run that fits silently
   * looks the same as a run with no budget at all — and the question that
   * matters after the legacy template and the COMPASS-40 overlay came out of
   * this prompt (~81 KB between them) is whether the trim still engages. If
   * `trimmed` reads false on every section, nothing the evidence pack carries
   * can be lost to a byte boundary; if it starts reading true, the pack is what
   * is at risk and it is the next thing to pin.
   */
  console.log(
    `📏 ${sectionDef.name}: base ${byteLength(basePrompt)}B (budget ${basePromptBudget}B, `
    + `trimmed ${byteLength(safeBasePrompt) < byteLength(basePrompt)}), `
    + `pinned ${pinnedBytes}B, instructions ${sectionInstructionBytes}B`,
  );
  let sectionPrompt = `${safeBasePrompt}${pinnedBlock}${sectionInstructions}`;
  if (byteLength(sectionPrompt) > PERPLEXITY_SAFE_USER_MESSAGE_BYTES) {
    const reducedBaseBudget = Math.max(0, PERPLEXITY_SAFE_USER_MESSAGE_BYTES - sectionInstructionBytes - pinnedBytes - 500);
    sectionPrompt = `${limitPromptContext(basePrompt, reducedBaseBudget, `Base prompt fallback for ${sectionDef.name}`, 'head-tail')}${pinnedBlock}${sectionInstructions}`;
  }
  if (byteLength(sectionPrompt) > PERPLEXITY_SAFE_USER_MESSAGE_BYTES) {
    console.warn(`⚠️ Section instructions alone are close to Perplexity's message limit for ${sectionDef.name}; applying final tail-preserving trim.`);
    sectionPrompt = limitPromptContext(sectionPrompt, PERPLEXITY_SAFE_USER_MESSAGE_BYTES, `Final section prompt for ${sectionDef.name}`, 'tail');
  }
  const safeSystemMessage = limitPromptContext(systemMessage, PERPLEXITY_SAFE_SYSTEM_MESSAGE_BYTES, 'System prompt', 'head');
  const emergencySectionPromptUnbounded = `Generate ONLY this investment report section for ${propertyAddress}: ${sectionDef.name}.

Required headings:
${sectionDef.sections.map(s => `## ${s}`).join('\n')}

Use Australian property advisory language, real web research via Perplexity, concise markdown, inline source names, and no placeholders. Keep figures internally consistent. If exact supplied context is unavailable because the source packet was too large, research the suburb/property details live and state uncertainty rather than inventing facts.
${pinnedBlock}
${investmentScoreContext ? limitPromptContext(investmentScoreContext, 5_000, `Emergency investment score context for ${sectionDef.name}`, 'head') : ''}

Previous-section consistency hints:
${previousSections ? sliceTailByBytes(previousSections, 4_000) : 'None'}

Start now with the first heading.`;
  // The compact prompt is the one that runs when the full one was refused as
  // too large, so it is exactly where a correctness rule must not go missing.
  // The pinned block sits in its head, which `head-tail` keeps.
  const emergencySectionPrompt = byteLength(emergencySectionPromptUnbounded) > PERPLEXITY_SAFE_USER_MESSAGE_BYTES
    ? limitPromptContext(emergencySectionPromptUnbounded, PERPLEXITY_SAFE_USER_MESSAGE_BYTES, `Emergency section prompt for ${sectionDef.name}`, 'head-tail')
    : emergencySectionPromptUnbounded;
  console.log(`📏 Prompt size for ${sectionDef.name}: user=${byteLength(sectionPrompt)} bytes, system=${byteLength(safeSystemMessage)} bytes`);

  // Retry loop with improved backoff and jitter
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // The window THIS attempt may have, from the run's deadline. See the
    // constants: a full-prompt attempt keeps a reserve for the compact retry,
    // a window below the full prompt's measured floor goes straight to the
    // compact prompt, and no window at all is a deferral, not a failure.
    const remainingMs = deadlineAt === null ? Number.POSITIVE_INFINITY : deadlineAt - Date.now();
    if (remainingMs < SECTION_MIN_CALL_WINDOW_MS) {
      console.warn(
        `⏱️ No window left for ${sectionDef.name} (attempt ${attempt}, `
        + `${Number.isFinite(remainingMs) ? Math.round(remainingMs / 1000) : '∞'}s remaining) — deferring to the next invocation.`,
      );
      return { content: '', citations: [], error: SECTION_BUDGET_DEFERRED };
    }
    const fullPromptWindowMs = remainingMs - SECTION_SECOND_ATTEMPT_RESERVE_MS;
    const useCompactPrompt = attempt > 1 || fullPromptWindowMs < SECTION_FULL_PROMPT_MIN_WINDOW_MS;
    const attemptTimeoutMs = useCompactPrompt
      ? Math.min(SECTION_EMERGENCY_TIMEOUT_MS, remainingMs)
      : Math.min(SECTION_REQUEST_TIMEOUT_MS, fullPromptWindowMs);
    try {
      console.log(
        `📝 Generating section: ${sectionDef.name}... (attempt ${attempt}/${maxRetries}, `
        + `window ${Math.round(attemptTimeoutMs / 1000)}s${useCompactPrompt ? ', compact prompt' : ''})`,
      );
      const userPromptForAttempt = useCompactPrompt ? emergencySectionPrompt : sectionPrompt;
      if (useCompactPrompt) {
        console.log(`🧯 Using emergency compact prompt for ${sectionDef.name}: ${byteLength(userPromptForAttempt)} bytes`);
      }
      
      const systemPromptForAttempt = useCompactPrompt
        ? 'You are an Australian property investment analyst. Produce concise, sourced markdown and never invent exact figures.'
        : safeSystemMessage;
      const response = await fetchWithTimeout('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${perplexityApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sonar-pro',
          max_tokens: sectionDef.maxTokens,
          temperature: 0.1,
          messages: [
            { role: 'system', content: systemPromptForAttempt },
            { role: 'user', content: userPromptForAttempt }
          ]
        }),
      }, attemptTimeoutMs, 'perplexity-api'); // bounded to the window this attempt actually has, with circuit breaker tracking

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Section ${sectionDef.id} API error (attempt ${attempt}):`, response.status, errorText);
        
        const isPromptTooLarge = response.status === 400 && /content exceeds maximum length|100KB|maximum length/i.test(errorText);
        // If prompt is too large, rate limited or server error, wait and retry with jitter
        if ((isPromptTooLarge || response.status === 429 || response.status >= 500) && attempt < maxRetries) {
          if (isPromptTooLarge) console.warn(`🧯 Perplexity rejected ${sectionDef.name} prompt as too large; retrying with emergency compact prompt.`);
          const waitTime = getRetryDelayWithJitter(attempt, response.status === 429 ? 5000 : 3000);
          console.log(`⏳ Waiting ${(waitTime/1000).toFixed(1)}s before retry (with jitter)...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        return { content: '', citations: [], error: `API error ${response.status}: ${errorText}` };
      }

      const data = await response.json();
      let content = data.choices?.[0]?.message?.content || '';
      const citations = data.citations || [];
      let finishReason = data.choices?.[0]?.finish_reason || '';

      // Log Perplexity API usage
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sbLog = createClient(supabaseUrl, supabaseKey);
      const pUsage = data.usage;
      await logApiUsage(sbLog, {
        service_name: 'perplexity',
        endpoint: '/chat/completions',
        model_used: 'sonar-pro',
        prompt_tokens: pUsage?.prompt_tokens || 0,
        completion_tokens: pUsage?.completion_tokens || 0,
        tokens_used: pUsage?.total_tokens || 0,
        status: 'success',
        metadata: { function: 'generate-investment-report', section: sectionDef.name },
      });

      console.log(`✓ Section ${sectionDef.name} generated: ${content.length} chars (finish_reason=${finishReason})`);

      // CONTINUATION: if the model stopped because it hit max_tokens, ask it
      // to continue from where it left off so the last paragraph isn't cut
      // off on the final PDF page. Up to 2 continuation rounds per section.
      let continuationRounds = 0;
      // Treat content as truncated if API said so OR the tail ends mid-thought:
      //   • trailing comma / colon / dash / ellipsis
      //   • dangling "First,", "Second," etc.
      //   • last paragraph is suspiciously short for a real conclusion
      const endsMidThought = (s: string): boolean => {
        const tail = s.trimEnd().slice(-200);
        if (!tail) return false;
        if (/[,:;\-–—]$/.test(tail)) return true;
        if (/\.{3}$/.test(tail) || /…$/.test(tail)) return true;
        if (/\b(First|Second|Third|Finally|In summary|Importantly|Crucially),?\s*$/i.test(tail)) return true;
        if (!/[.!?")\]}]$/.test(tail)) return true;
        return false;
      };
      while ((finishReason === 'length' || endsMidThought(content)) && continuationRounds < 2) {
        // A continuation answers to the same deadline: it is never started
        // into a window it cannot finish in, because a truncated tail is a
        // smaller defect than a run killed with nothing written.
        const continuationWindowMs = deadlineAt === null
          ? SECTION_CONTINUATION_TIMEOUT_MS
          : Math.min(SECTION_CONTINUATION_TIMEOUT_MS, deadlineAt - Date.now() - 5_000);
        if (continuationWindowMs < 15_000) {
          console.log(`   continuation skipped for ${sectionDef.name}: no window left (${Math.round(continuationWindowMs / 1000)}s)`);
          break;
        }
        continuationRounds++;
        console.log(`↪️  Section ${sectionDef.name} appears truncated (finish=${finishReason}) — continuation round ${continuationRounds}`);
        const tail = content.slice(-1200);
        const continuePrompt = `You were writing the "${sectionDef.name}" section of an investment report and were cut off mid-thought. Continue writing from EXACTLY where you stopped. Do NOT repeat any earlier text, do NOT restart the section, do NOT add a preamble. Simply resume the next words and finish the section cleanly.\n\nLast 1200 characters you produced (your reply will be appended directly after the final character):\n\n${tail}`;
        try {
          const contResp = await fetchWithTimeout('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${perplexityApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'sonar-pro',
              max_tokens: Math.min(2500, sectionDef.maxTokens),
              temperature: 0.1,
              messages: [
                { role: 'system', content: safeSystemMessage },
                { role: 'user', content: sectionPrompt },
                { role: 'assistant', content: limitPromptContext(content, 50_000, `Continuation prior content for ${sectionDef.name}`, 'tail') },
                { role: 'user', content: continuePrompt },
              ],
            }),
          }, continuationWindowMs, 'perplexity-api');
          if (!contResp.ok) {
            console.warn(`   continuation HTTP ${contResp.status} — stopping continuation loop`);
            break;
          }
          const contData = await contResp.json();
          const addition = contData.choices?.[0]?.message?.content || '';
          finishReason = contData.choices?.[0]?.finish_reason || '';
          if (!addition.trim()) {
            console.warn('   continuation returned empty content — stopping');
            break;
          }
          // Strip any echoed overlap with the existing tail before appending.
          let joinedAddition = addition;
          const maxOverlap = Math.min(120, addition.length);
          for (let k = maxOverlap; k > 12; k--) {
            if (content.endsWith(addition.slice(0, k))) {
              joinedAddition = addition.slice(k);
              break;
            }
          }
          content = content + joinedAddition;
          console.log(`   continuation added ${joinedAddition.length} chars (new total ${content.length}, finish=${finishReason})`);
        } catch (contErr: any) {
          console.warn('   continuation call failed:', contErr?.message);
          break;
        }
      }

      return { content, citations };
    } catch (error: any) {
      console.error(`❌ Error generating section ${sectionDef.id} (attempt ${attempt}):`, error?.message);
      
      // Retry on timeout or network errors with jitter
      if (attempt < maxRetries) {
        const waitTime = getRetryDelayWithJitter(attempt, 2000);
        console.log(`⏳ Waiting ${(waitTime/1000).toFixed(1)}s before retry (with jitter)...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      return { content: '', citations: [], error: error?.message };
    }
  }
  
  return { content: '', citations: [], error: 'Max retries exceeded' };
}

// Helper function to update report status to failed
async function markReportFailed(reportId: string | null, errorMessage: string): Promise<void> {
  if (!reportId) return;
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    if (supabaseUrl && supabaseKey) {
      const client = createClient(supabaseUrl, supabaseKey);
      await client
        .from('investment_reports')
        .update({ 
          status: 'failed',
          error_message: errorMessage,
          updated_at: new Date().toISOString()
        })
        .eq('id', reportId);
      
      // Also update auto_report_generation_log if this was an auto-generated report
      await client
        .from('auto_report_generation_log')
        .update({
          status: 'failed',
          error_message: `Report generation failed: ${errorMessage}`,
          completed_at: new Date().toISOString()
        })
        .eq('report_id', reportId);
      
      console.log(`✓ Marked report ${reportId} as failed: ${errorMessage}`);
    }
  } catch (updateError) {
    console.error('Error updating report status to failed:', updateError);
  }
}

const __investmentReportHandler = async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  // Wall-clock reference for the section budget. The Supabase edge runtime kills
  // an invocation at ~150s; a Compass report needs several times that. Before this
  // existed the loop simply ran until the platform killed it mid-section, which
  // left the row stuck at 'processing' forever with no error recorded. We now
  // stop voluntarily and hand the rest to the next caller (cron watchdog or the
  // browser pump). See docs/reports/INVESTMENT_REPORT_RESUME.md.
  const runStartedAt = Date.now();

  /**
   * True once the acquisition phase gave up its remaining work to protect the
   * section loop. Distinguishes "research ran long" from "a model call failed"
   * in the hand-off, which are different problems with different remedies.
   */
  let acquisitionExhaustedThisRun = false;

  /**
   * The run clock, as the acquisition calls see it.
   *
   * `perCallCeilingMs` is supplied per dependency by `acquisitionBudgetFor`.
   * The reserves are what stop a slow provider consuming the invocation: the
   * section loop keeps enough to start one model call, and the checkpoint keeps
   * enough to persist what research DID land — research that is not persisted
   * is research the next invocation has to buy again.
   */
  const acquisitionBudgetBase = (): Omit<AcquisitionBudgetInput, 'perCallCeilingMs'> => ({
    runStartedAt,
    now: Date.now(),
    hardStopMs: SECTION_CALL_HARD_STOP_MS,
    sectionReserveMs: SECTION_MIN_CALL_WINDOW_MS,
    checkpointReserveMs: ACQUISITION_CHECKPOINT_RESERVE_MS,
    minCallMs: ACQUISITION_MIN_CALL_MS,
  });

  /**
   * A call's own ceiling, before the run's clock is applied.
   *
   * A dependency class picks a default; a number is the site's own declared
   * budget, kept verbatim. Both are CEILINGS — `acquisitionWindowMs` takes the
   * smaller of this and what the invocation can actually spare, so declaring 45s
   * for a planning register that needs it cannot overrun the run, and clamping
   * it to a class default would quietly buy speed with evidence.
   */
  const acquisitionBudgetFor = (ceiling: CallClass | number): AcquisitionBudgetInput => ({
    ...acquisitionBudgetBase(),
    perCallCeilingMs: typeof ceiling === 'number' ? ceiling : CALL_CEILING_MS[ceiling],
  });

  /**
   * An acquisition call, bounded by the run's own clock.
   *
   * Delegates to `fetchWithTimeout` so the circuit breaker still applies — one
   * fetch wrapper, not two. What this adds is the window: `fetchWithTimeout`
   * defaults to 90s, which is most of an invocation that must also write
   * fifteen sections, so leaving a call site to its default is how the section
   * loop ends up with nothing.
   *
   * When no window remains the call is NOT made and a synthetic 598 is
   * returned, which every call site's existing `!response.ok` branch records as
   * a FAILURE rather than as an empty answer. That is the conservative side and
   * the correct one: we did not ask, so we know nothing, and the dependency
   * stays outstanding for the next invocation instead of being written into the
   * record as an absence. See `acquisitionBudget.pure.ts`.
   */
  const NO_WINDOW_STATUS = 598;
  const acquisitionFetch = async (
    url: string,
    options: RequestInit,
    ceiling: CallClass | number,
    serviceName: string,
  ): Promise<Response> => {
    const windowMs = acquisitionWindowMs(acquisitionBudgetFor(ceiling));
    if (windowMs === null) {
      acquisitionExhaustedThisRun = true;
      console.log(
        `⏳ ${serviceName}: no window left in this invocation (${Math.round((Date.now() - runStartedAt) / 1000)}s elapsed) — ` +
        `deferred to the next one. NOT recorded as an absence.`
      );
      return new Response(null, { status: NO_WINDOW_STATUS });
    }
    return await fetchWithTimeout(url, options, windowMs, serviceName);
  };

  /**
   * Start an acquisition call now, and read it where its answer is handled.
   *
   * A promise that rejects before anything awaits it is an unhandled
   * rejection, which Deno treats as fatal. The no-op `catch` marks it handled
   * and swallows nothing: the call site awaits the ORIGINAL promise, so the
   * same error still surfaces inside the same `try` it always did.
   */
  const startAcquisition = (
    url: string,
    options: RequestInit,
    ceiling: CallClass | number,
    serviceName: string,
  ): Promise<Response> => {
    const pending = acquisitionFetch(url, options, ceiling, serviceName);
    pending.catch(() => {});
    return pending;
  };

  /**
   * A non-ok answer is never "the provider holds nothing".
   *
   * The phase-1 wrappers read `if (response.ok) { … } return null`, and a null
   * there reaches `fetchServiceWithFallback` as the string "No data returned",
   * which `acquisitionLedger.fromServiceResult` maps to
   * `unavailable_in_coverage` — *the provider answered and holds nothing for
   * this subject*. That is a statement about the property, and an HTTP 500 or a
   * call we never made is not entitled to make it.
   *
   * Throwing instead lands in the same wrapper's catch, which records
   * `requested_failed` and leaves the dependency outstanding. `return null`
   * still means what it always meant: the service answered 200 and said it
   * holds nothing here, which is real and worth printing.
   */
  const assertAcquisitionAnswered = (response: Response, serviceName: string): void => {
    if (response.status === NO_WINDOW_STATUS) {
      throw new Error(
        `${serviceName} was not attempted: no window left in this invocation. Not an absence.`,
      );
    }
    if (!response.ok) {
      throw new Error(`${serviceName} answered HTTP ${response.status}`);
    }
  };

  console.log('Investment report function invoked with method:', req.method);
  
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight request');
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for internal-pipeline callers (HMAC/internal secret, no session cookie).
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  /*
   * Declared OUTSIDE the `try` below, because the CATCH reads it.
   *
   * `let requestBody` used to sit inside that try block, and a `catch` is a
   * SIBLING of the block it guards, not a child of it — so
   * `if (requestBody?.reportId)`, the first statement of the error path,
   * threw `ReferenceError: requestBody is not defined` before the handler
   * could return its own 500.
   *
   * That is why every server error reached the browser as a CORS / network
   * failure. The response this handler builds carries `corsHeaders`; the
   * bare 500 the platform serves when a handler throws does not, so the
   * browser discarded it and `fetch` rejected with "Failed to fetch". The
   * real message — and the "status = failed" write beside it — never
   * happened. Measured 2026-09-19: 23 of 23 POSTs, 100%.
   */
  let requestBody: any;

  try {
    console.log('Starting investment report generation...');
    
    // Parse request body
    try {
      requestBody = await req.json();
      console.log('Request body parsed successfully');
    } catch (parseError) {
      console.error('Error parsing request body:', parseError);
      return new Response(JSON.stringify({ 
        error: 'Invalid JSON in request body',
        success: false 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // SECURITY: Verify authentication
    // IMPORTANT: trim() secrets to avoid subtle "Invalid JWT" errors if newline/whitespace was copied into env vars.
    const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
    const supabaseServiceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
    const supabaseAnonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, requestBody);
    if (authError) {
      console.log('[generate-investment-report] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log('[generate-investment-report] Authenticated user:', userId);
    
    let { reportId, propertyAddress, propertyDetails, continueFrom, singleSection } = requestBody;
    // Get scope from request, with fallback to existing report's scope for continuation/chunked calls
    let reportScope = propertyDetails?.queryType || 'address';
    let isAreaReport = ['suburb', 'postcode', 'statewide', 'zipcode'].includes(reportScope);
    
    // Flag to indicate if we're continuing from existing content
    const isContinuation = continueFrom === true;
    // Flag for chunked mode - generate one section per call to avoid platform timeouts
    const isSingleSectionMode = singleSection === true;
    console.log('Continuation mode:', isContinuation, '| Single-section mode:', isSingleSectionMode);
    
    // UNIFIED DOCUMENT CONTENT: Accept both scrapedContent (URL scrape) AND pdfContent (PDF upload)
    // This ensures consistent content injection regardless of the input source
    const scrapedContent = propertyDetails?.scrapedContent || null;
    const pdfContent = propertyDetails?.pdfContent || null;
    const documentContent = scrapedContent || pdfContent || null; // Unified content variable
    
    const sourceUrl = propertyDetails?.sourceUrl || null;
    const fromUrlScrape = propertyDetails?.fromUrlScrape || false;
    const fromPdfUpload = propertyDetails?.fromPdfUpload || false;
    const contentSource = fromUrlScrape ? 'URL Scrape' : (fromPdfUpload ? 'PDF Upload' : 'Manual Entry');
    
    console.log('=== REPORT GENERATION REQUEST ===');
    console.log('Report ID:', reportId);
    console.log('Property address:', propertyAddress);
    console.log('Report scope:', reportScope);
    console.log('Content source:', contentSource);
    console.log('From URL scrape:', fromUrlScrape);
    console.log('From PDF upload:', fromPdfUpload);
    console.log('Scraped content available:', !!scrapedContent, scrapedContent ? `(${scrapedContent.length} chars)` : '');
    console.log('PDF content available:', !!pdfContent, pdfContent ? `(${pdfContent.length} chars)` : '');
    console.log('Unified document content available:', !!documentContent, documentContent ? `(${documentContent.length} chars)` : '');
    console.log('Source URL:', sourceUrl);
    
    // Log all property details for debugging
    if (propertyDetails) {
      console.log('Property details received:');
      console.log('  - Price:', propertyDetails.price);
      console.log('  - Beds:', propertyDetails.beds);
      console.log('  - Baths:', propertyDetails.baths);
      console.log('  - Car spaces:', propertyDetails.carSpaces);
      console.log('  - Land size:', propertyDetails.landSizeSqm);
      console.log('  - Build size:', propertyDetails.buildSizeSqm);
      console.log('  - Property type:', propertyDetails.propertyType);
      console.log('  - Postcode:', propertyDetails.postcode);
      console.log('  - State:', propertyDetails.state);
      console.log('  - Suburb:', propertyDetails.suburb);
      console.log('  - Weekly rent:', propertyDetails.weeklyRent);
      console.log('  - Is new build:', propertyDetails.isNewBuild);
    }
    
    // If reportId is provided but no propertyAddress, fetch it from the existing report (for retries)
    if (reportId && !propertyAddress) {
      console.log('Fetching property address from existing report for retry...');
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && supabaseKey) {
        const client = createClient(supabaseUrl, supabaseKey);
        const { data: existingReport, error: fetchError } = await client
          .from('investment_reports')
          .select('property_address')
          .eq('id', reportId)
          .single();
        
        if (fetchError || !existingReport?.property_address) {
          console.error('Failed to fetch property address for retry:', fetchError);
          await markReportFailed(reportId, 'Could not find existing report for retry');
          return new Response(JSON.stringify({ 
            error: 'Could not find existing report for retry',
            success: false 
          }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        propertyAddress = existingReport.property_address;
        console.log('Fetched property address from existing report:', propertyAddress);
      }
    }
    
    if (!propertyAddress) {
      console.error('Property address is missing');
      await markReportFailed(reportId, 'Property address is required');
      return new Response(JSON.stringify({ 
        error: 'Property address is required',
        success: false 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client for database updates
    let supabaseClient = null;
    let existingManualOverrides = null;
    /**
     * RF-7.2B.1B1 — did this run REUSE the banked location enrichment, or buy
     * a fresh one? Declared at handler scope because the enrichment decision and
     * the early write are thousands of lines apart, and the write needs to know:
     * a reused object must not be rewritten, a re-acquired one must be, or its
     * incremented attempt count never persists and the bounded retry never
     * reaches its bound.
     */
    let locationEnrichmentReused = false;
    /**
     * S2 — the enrichment as MEASURED, kept back from the Client-Safe Gate.
     *
     * The gate disowns four location paths, and three of them —
     * `walkScore`, `commute` and `schools.schoolsWithin3km` — are exactly the
     * three readings `verifiedLocationInputs` may count. That is correct for
     * the NARRATIVE, which is what the gate is for; it is wrong for the
     * RECORD, because the gated object is what used to be persisted as
     * `location_intelligence`, and `assessEnrichmentReuse` checks the
     * acquisition stamp — which survives the gate — so every later resume
     * re-served the stripped copy and scored Location on an enrichment with
     * nothing left in it to verify. The report then carried
     * "No location readings (walk score, commute, schools) were presented for
     * this run" beside a stamp reading `places: complete, commute: measured`,
     * and its own remedy ("regenerate the report") reproduced the same result.
     *
     * So the gate's output still goes to the model and the record keeps what
     * was measured. Nothing here widens what a client document may say: every
     * narrative boundary applies `DISOWNED_LOCATION_PATHS` for itself.
     */
    let measuredLocationIntelligence: unknown = null;
    // Track which enhanced fields are already persisted on the report (so we don't overwrite them)
    let existingEnhancedFields: {
      investmentScore?: any;
      financials?: any;
      demographics?: any;
      economics?: any;
      locationIntelligence?: any;
    } = {};

    /**
     * The section plan already on the row, if any.
     *
     * Learning it for the first time is durable progress — the widget cannot
     * draw "of 15" without it — while re-writing the same number is not. The
     * hand-off needs the distinction; see `runProgress.pure.ts`.
     */
    let existingTotalSections: number | null = null;

    // Get pre-generation overrides from request (passed from frontend)
    const frontendManualOverrides = propertyDetails?.manualOverrides || null;
    if (frontendManualOverrides && Object.keys(frontendManualOverrides).length > 0) {
      console.log('📝 Received pre-generation overrides from frontend:', Object.keys(frontendManualOverrides).length, 'fields');
      console.log('  Override keys:', Object.keys(frontendManualOverrides).join(', '));
    }
    
    // Variables for continuation mode
    let existingReportContent = '';
    let completedSectionIndices: number[] = [];
    
    if (reportId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && supabaseKey) {
        supabaseClient = createClient(supabaseUrl, supabaseKey);
        
        // Fetch existing report data (including content for continuation)
        const { data: existingReport } = await supabaseClient
          .from('investment_reports')
          .select('manual_overrides, report_content, property_address, last_completed_section, total_sections, investment_score, financial_calculations, demographics_data, economic_data, location_intelligence, report_scope, report_tier, generation_engine')
          .eq('id', reportId)
          .single();
        
        if (
          existingReport?.property_address
          && propertyAddress
          && existingReport.property_address.trim().toLowerCase() !== propertyAddress.trim().toLowerCase()
        ) {
          console.warn('[generate-investment-report] Rejected property address mismatch for report:', reportId);
          return new Response(JSON.stringify({
            error: 'Property address does not match the existing report',
            success: false,
          }), {
            status: 409,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // CRITICAL: If queryType wasn't passed (e.g., chunked regeneration), use the existing report's scope
        if (existingReport?.report_scope && reportScope === 'address' && !propertyDetails?.queryType) {
          reportScope = existingReport.report_scope;
          isAreaReport = ['suburb', 'postcode', 'statewide', 'zipcode'].includes(reportScope);
          console.log(`📋 Restored report_scope from existing report: ${reportScope} (isAreaReport: ${isAreaReport})`);
        }
        
        if (existingReport?.manual_overrides) {
          existingManualOverrides = existingReport.manual_overrides;
          console.log('📝 Fetched existing manual overrides from DB:', Object.keys(existingManualOverrides).length, 'fields');
        }

        if (existingReport?.report_tier && !propertyDetails?.reportTier) {
          propertyDetails = {
            ...(propertyDetails || {}),
            reportTier: existingReport.report_tier,
          };
          console.log(`📋 Restored report_tier from existing report: ${existingReport.report_tier}`);
        }

        // CRITICAL: Restore generation_engine from the DB record when the caller
        // didn't send it (auto-resume / continuation paths don't pass
        // propertyDetails). Without this the engine silently falls back to
        // 'legacy' on every resume, flipping a compass-40 run mid-flight and
        // vice-versa — i.e. the user's explicit engine selection is not
        // respected.
        if (existingReport?.generation_engine && !propertyDetails?.generationEngine) {
          const storedEngine = existingReport.generation_engine === 'compass-40' ? 'compass-40' : 'legacy';
          propertyDetails = {
            ...(propertyDetails || {}),
            generationEngine: storedEngine,
          };
          console.log(`⚙️ Restored generation_engine from existing report: ${storedEngine}`);
        }

        // Capture existing enhanced fields so we can avoid overwriting already-persisted values
        if (existingReport) {
          existingEnhancedFields = {
            investmentScore: (existingReport as any).investment_score,
            financials: (existingReport as any).financial_calculations,
            demographics: (existingReport as any).demographics_data,
            economics: (existingReport as any).economic_data,
            locationIntelligence: (existingReport as any).location_intelligence,
          };
          const storedTotal = Number((existingReport as any).total_sections);
          existingTotalSections = Number.isFinite(storedTotal) && storedTotal > 0 ? storedTotal : null;
        }
        
        // If continuing, use the stored last_completed_section index for reliable resume
        if (isContinuation && existingReport?.report_content) {
          const lastCompletedSection = existingReport.last_completed_section || 0;
          
          console.log('🔄 CONTINUATION MODE: Checking section progress');
          console.log('   Existing content length:', existingReport.report_content.length, 'chars');
          console.log('   Last completed section (from DB):', lastCompletedSection);
          
          // A report banked under a different section list cannot be resumed.
          //
          // `last_completed_section` is a raw index into the CURRENT registry,
          // so a row stopped at 8 of 17 that resumed under the 12-section v3.0
          // list would splice sections 8-11 of the new structure onto sections
          // 0-7 of the old one — a document with two Population sections, no
          // Demand Drivers, and no way to tell from the row that anything went
          // wrong. `total_sections` records which list the banked content was
          // written against, so the mismatch is detectable; when it does not
          // match, the report starts again rather than being stitched together.
          //
          // This costs one full regeneration, and only for reports in flight
          // across the deploy. Reports already `completed` are never resumed.
          const storedTotal = Number((existingReport as any).total_sections) || 0;
          const registryTotal = /^(compass|compass-40)$/i.test(String((existingReport as any).report_tier ?? 'compass'))
            ? compassSections().length
            : 0;
          const registryChanged = storedTotal > 0 && registryTotal > 0 && storedTotal !== registryTotal;
          if (registryChanged) {
            console.log(
              `   ⚠️ Section list changed since this report was banked ` +
              `(stored total_sections=${storedTotal}, registry now ${registryTotal}). ` +
              `Regenerating from scratch — resuming would splice two different structures together.`,
            );
          }

          // CRITICAL FIX: Only use existing content for TRUE resume (last_completed_section > 0)
          // If last_completed_section is 0, this is a FRESH REGENERATION - do NOT prepend old content
          if (lastCompletedSection > 0 && !registryChanged) {
            existingReportContent = existingReport.report_content;
            console.log('   ✓ RESUME mode: Using existing content as base');
            
            // Build completed section indices from the stored value
            // All sections from 0 to lastCompletedSection-1 are complete (0-indexed section IDs)
            // If lastCompletedSection = 5, then sections 0,1,2,3,4 are complete
            for (let idx = 0; idx < lastCompletedSection; idx++) {
              completedSectionIndices.push(idx);
            }
            
            console.log(`   Completed sections: ${completedSectionIndices.length}/${REPORT_SECTIONS.length}`);
            console.log(`   Will resume from section: ${lastCompletedSection} (${REPORT_SECTIONS[lastCompletedSection]?.name || 'END'})`);
          } else {
            // Fresh regeneration: either last_completed_section was reset to 0,
            // or the section list changed underneath a partially generated
            // report. Do NOT use existing content - start completely fresh.
            existingReportContent = '';
            completedSectionIndices.length = 0;
            console.log(
              registryChanged
                ? '   🔄 FRESH REGENERATION mode: section list changed, discarding partial content'
                : '   🔄 FRESH REGENERATION mode: Starting from scratch (last_completed_section=0)',
            );
            console.log('   Old content will be discarded, generating all sections fresh');
          }
          
          // Use property address from existing report if not provided
          if (!propertyAddress && existingReport.property_address) {
            propertyAddress = existingReport.property_address;
            console.log('   Using property address from existing report:', propertyAddress);
          }
        }
        
        // Update status to processing
        await supabaseClient
          .from('investment_reports')
          .update({ status: 'processing' })
          .eq('id', reportId);
        
        console.log('Updated report status to processing');
      }
    }
    
    // Merge overrides: frontend takes precedence over existing DB overrides
    const mergedOverrides = {
      ...(existingManualOverrides || {}),
      ...(frontendManualOverrides || {})
    };
    const hasOverrides = Object.keys(mergedOverrides).length > 0;
    if (hasOverrides) {
      console.log('🔀 Merged overrides total:', Object.keys(mergedOverrides).length, 'fields');
    }
    
    // ============================================================================
    // CRITICAL: Define effective values ONCE at the top and use consistently
    // These values respect the override hierarchy and are used throughout
    // ============================================================================
    const effectivePurchasePrice = mergedOverrides.purchasePrice || propertyDetails?.price || 0;
    const effectiveWeeklyRent = mergedOverrides.weeklyRent || propertyDetails?.weeklyRent || 0;
    const effectiveLvr = mergedOverrides.loanToValueRatio || propertyDetails?.loanToValueRatio || 80;
    
    // CRITICAL: Deposit value handling - check both mergedOverrides and propertyDetails
    // Parse as number since frontend may send as string
    const rawDepositValue = mergedOverrides.depositValue ?? propertyDetails?.depositValue ?? null;
    const parsedDepositValue = rawDepositValue !== null ? parseFloat(String(rawDepositValue)) : NaN;
    const effectiveDepositValue = !isNaN(parsedDepositValue) && parsedDepositValue > 0 
      ? parsedDepositValue 
      : (effectivePurchasePrice * ((100 - effectiveLvr) / 100));
    
    console.log('📦 Deposit Value Debug:');
    console.log(`  Raw from mergedOverrides: ${mergedOverrides.depositValue}`);
    console.log(`  Raw from propertyDetails: ${propertyDetails?.depositValue}`);
    console.log(`  Parsed value: ${parsedDepositValue}`);
    console.log(`  Effective deposit: $${effectiveDepositValue?.toLocaleString()}`);
    
    // Callers spell the physical facts differently — the listing carries
    // `beds`/`baths`/`carSpaces`, the report form `landSizeSqm`, the intake
    // projection `bedrooms`, the specs column `parking`/`land_size_sqm` — and
    // every site below read exactly one spelling. Measured: 0 of the last 43
    // reports persisted a bedroom count while 651 older ones did. One
    // normalisation, once, before anything reads a fact.
    if (propertyDetails) {
      const firstFinite = (...values: unknown[]) => {
        for (const v of values) {
          const n = typeof v === 'string' ? Number(v) : v;
          if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
        }
        return undefined;
      };
      propertyDetails.beds = firstFinite(propertyDetails.beds, propertyDetails.bedrooms);
      propertyDetails.baths = firstFinite(propertyDetails.baths, propertyDetails.bathrooms);
      propertyDetails.carSpaces = firstFinite(propertyDetails.carSpaces, propertyDetails.parking, propertyDetails.car_spaces);
      propertyDetails.landSizeSqm = firstFinite(propertyDetails.landSizeSqm, propertyDetails.landSize, propertyDetails.land_size_sqm);
      propertyDetails.buildSizeSqm = firstFinite(propertyDetails.buildSizeSqm, propertyDetails.buildingSize, propertyDetails.building_size_sqm);
    }

    const effectiveInterestRate = mergedOverrides.interestRate || propertyDetails?.interestRate || 6.5;
    const effectiveLoanTerm = mergedOverrides.loanTermYears || propertyDetails?.loanTermYears || 30;
    const effectiveIsFirstHomeBuyer = mergedOverrides.isFirstHomeBuyer || false;
    // ONE property-type answer for every service on this request.
    //
    // Three call sites sent `propertyDetails?.propertyType || 'house'` — the
    // raw string, with a silent fallback — while `overrides.pure.ts`
    // normalised separately. `apartment` therefore never matched the only
    // test the engine and the validation service make (`=== 'unit'`), so
    // neither drew the strata estimate nor validated it; 264 of 1,071 stored
    // reports carry a type outside the engine's vocabulary.
    //
    // `?? raw` rather than `?? 'house'` is the point. A type that will not
    // resolve stays unresolved: `residential property` matches no branch and
    // draws no adjustment, which is the honest neutral. Defaulting it to a
    // house would award the scoring service's +3 house bonus to 145 reports
    // nobody has classified.
    const sourcePropertyType = (propertyDetails?.propertyType ?? mergedOverrides.propertyType) as unknown;
    const effectivePropertyType = normalisePropertyType(sourcePropertyType)
      ?? (typeof sourcePropertyType === 'string' && sourcePropertyType.trim()
        ? sourcePropertyType.trim().toLowerCase()
        : undefined);
    const effectiveBuildType = mergedOverrides.buildType || (propertyDetails?.isNewBuild ? 'new_build' : 'existing_property');
    const effectiveIsNewBuild = effectiveBuildType === 'new_build';
    const effectiveIsLandOnly = effectiveBuildType === 'land_only';
    const effectiveLandSizeSqm = mergedOverrides.landSizeSqm || propertyDetails?.landSizeSqm || null;
    // QA-21: what the recorded area is an area OF travels with the figure —
    // a strata townhouse's 1.25 ha is the scheme's site, not the lot — and an
    // unresolved scope may not feed a land-content, redevelopment or
    // valuation argument. `landAreaScope.pure.ts` is the one rule.
    const landAreaReading = describeLandArea({
      landSizeSqm: typeof effectiveLandSizeSqm === 'number' ? effectiveLandSizeSqm : Number(effectiveLandSizeSqm) || null,
      lotAreaSqm: mergedOverrides.lotAreaSqm ?? propertyDetails?.lotAreaSqm ?? null,
      propertyType: mergedOverrides.propertyType ?? propertyDetails?.propertyType ?? null,
      isStrata: /\b(unit|apartment|townhouse|villa|strata|flat|terrace|duplex)\b/i.test(String(mergedOverrides.propertyType ?? propertyDetails?.propertyType ?? '')),
    });
    const effectiveBuildSizeSqm = effectiveIsLandOnly ? null : (mergedOverrides.buildSizeSqm || propertyDetails?.buildSizeSqm || null);
    // A FACT and a MODELLING DEFAULT are different things. `effectiveBeds`
    // used to be `… || 3`, so a property whose bedroom count was never
    // captured was asserted as "3 bedrooms" in the prompt's specification
    // table — which is how a real report stated "3 bedrooms" three times
    // about a four-bedroom subject (audit F17). The fact is now null when
    // unknown and the prose says so; the scorer and the rent lookup, which
    // need a number to model with, take the default separately and nothing
    // that reaches a page reads it.
    const effectiveBeds = effectiveIsLandOnly ? 0 : (mergedOverrides.bedrooms || propertyDetails?.beds || null);
    const effectiveBaths = effectiveIsLandOnly ? 0 : (mergedOverrides.bathrooms || propertyDetails?.baths || null);
    const modelledBeds = effectiveIsLandOnly ? 0 : (effectiveBeds ?? 3);
    const modelledBaths = effectiveIsLandOnly ? 0 : (effectiveBaths ?? 2);
    
    // Zoning is resolved from the planning enrichment AND the operator's
    // overrides together, by `buildPlanningFacts` below — which runs after the
    // enrichment rather than here, because this point in the run is before a
    // coordinate has been verified and therefore before anything could have
    // been retrieved. Eight `effectiveZoning*` constants used to be computed
    // here from the overrides alone and handed to a prompt that had no other
    // source, which is why a report on a property whose zone the state's own
    // layer would have answered printed placeholders instead.
    
    console.log('📊 EFFECTIVE VALUES (after merging overrides):');
    console.log(`  Purchase Price: $${effectivePurchasePrice?.toLocaleString()} ${mergedOverrides.purchasePrice ? '(OVERRIDE)' : '(from property)'}`);
    console.log(`  Weekly Rent: $${effectiveWeeklyRent} ${mergedOverrides.weeklyRent ? '(OVERRIDE)' : '(from property)'}`);
    console.log(`  LVR: ${effectiveLvr}% ${mergedOverrides.loanToValueRatio ? '(OVERRIDE)' : '(default)'}`);
    console.log(`  Interest Rate: ${effectiveInterestRate}% ${mergedOverrides.interestRate ? '(OVERRIDE)' : '(default)'}`);
    console.log(`  Build Type: ${effectiveBuildType}`);
    console.log(`  Is New Build: ${effectiveIsNewBuild}`);
    console.log(`  Is Land Only: ${effectiveIsLandOnly}`);

    // Check for Perplexity API key
    const perplexityApiKey = Deno.env.get('PERPLEXITY_API_KEY');
    console.log('Perplexity API key configured:', !!perplexityApiKey);
    
    if (!perplexityApiKey) {
      console.error('Perplexity API key not found in environment');
      const errorMsg = 'Perplexity API key not configured. Please set PERPLEXITY_API_KEY in Supabase secrets.';
      await markReportFailed(reportId, errorMsg);
      return new Response(JSON.stringify({ 
        error: errorMsg,
        success: false 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Determine analysis mode and format input query
    let analysisMode = 'address'; // Default mode
    let formattedInput = propertyAddress;
    let detectedSuburb = null;
    let detectedPostcode = null;
    let detectedState = null;
    
    // Extract postcode and state from input
    const postcodeMatch = propertyAddress.match(/\b(\d{4})\b/);
    const stateMatch = propertyAddress.match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT|Western Australia|New South Wales|Victoria|Queensland|South Australia|Tasmania|Northern Territory|Australian Capital Territory)\b/i);
    
    if (postcodeMatch) {
      detectedPostcode = postcodeMatch[1];
    }
    if (stateMatch) {
      const stateInput = stateMatch[1].toUpperCase();
      // Convert full state names to abbreviations
      const stateMap: Record<string, string> = {
        'WESTERN AUSTRALIA': 'WA',
        'NEW SOUTH WALES': 'NSW',
        'VICTORIA': 'VIC',
        'QUEENSLAND': 'QLD',
        'SOUTH AUSTRALIA': 'SA',
        'TASMANIA': 'TAS',
        'NORTHERN TERRITORY': 'NT',
        'AUSTRALIAN CAPITAL TERRITORY': 'ACT'
      };
      detectedState = stateMap[stateInput] || stateInput;
    }
    
    // Detect analysis mode
    if (/^\d{4}$/.test(propertyAddress.trim()) || /postcode\s+\d{4}/i.test(propertyAddress)) {
      // Pure postcode mode
      analysisMode = 'postcode';
      const postcode = postcodeMatch ? postcodeMatch[1] : propertyAddress.trim();
      // Require state for postcode to avoid ambiguity
      if (!detectedState) {
        console.warn('⚠️ Postcode provided without state, defaulting to NSW');
        detectedState = 'NSW';
      }
      formattedInput = `Postcode ${postcode}, ${detectedState}, Australia`;
    } else if (propertyAddress.match(/^[A-Za-z\s]+(?:,\s*(?:\d{4}|NSW|VIC|QLD|WA|SA|TAS|NT|ACT))+/i)) {
      // Suburb mode: Suburb name followed by postcode and/or state
      // Examples: "Bondi, 2026, NSW" or "Bondi NSW 2026" or "Bondi, NSW"
      analysisMode = 'suburb';
      const parts = propertyAddress.split(',').map((p: string) => p.trim());
      detectedSuburb = parts[0];
      
      // Require both postcode and state for suburb to avoid ambiguity
      if (!detectedPostcode || !detectedState) {
        console.warn('⚠️ Suburb provided without complete postcode/state information');
        if (!detectedState) {
          detectedState = 'NSW'; // Default fallback
        }
      }
      
      formattedInput = `${detectedSuburb}${detectedPostcode ? ', ' + detectedPostcode : ''}${detectedState ? ', ' + detectedState : ''}, Australia`;
      console.log('Suburb analysis mode detected:', { suburb: detectedSuburb, postcode: detectedPostcode, state: detectedState });
    } else if (/(western australia|wa|new south wales|nsw|victoria|vic|queensland|qld|south australia|sa|tasmania|tas|northern territory|nt|australian capital territory|act)$/i.test(propertyAddress.trim())) {
      // State-wide mode: ends with just a state name
      analysisMode = 'state';
      formattedInput = propertyAddress;
    } else {
      // Default to address mode
      analysisMode = 'address';
    }

    console.log('Analysis mode:', analysisMode);
    console.log('Formatted input:', formattedInput);
    console.log('Analysis details:', { suburb: detectedSuburb, postcode: detectedPostcode, state: detectedState });

    // Fetch enhanced data from multiple sources
    console.log('Fetching enhanced data from multiple APIs...');
    
    interface EnhancedData {
      demographics?: any;
      economics?: any;
      financials?: any;
      locationIntelligence?: any;
      investmentScore?: any;
      domainData?: any;
      riskAssessment?: any;
      seifaData?: any;
      crimeStatistics?: any;
      employmentData?: any;
      climateData?: any;
      schoolData?: any;
      planningData?: any;
      regionalTrends?: any;
      /**
       * The measured market points and who was asked, as
       * `{ points, providersConsulted, providersUnavailable }`.
       *
       * Declared because it is now read twice — by the scoring call it was
       * built for, and by `buildMarketFacts` for the prose, which is the whole
       * point of recording it rather than passing it.
       */
      marketEvidence?: any;
    }
    
    let enhancedData: EnhancedData = {};

    /**
     * What this invocation adopted from its own earlier one, if anything.
     *
     * Held rather than acted on immediately because the acquisition ledger is
     * last-write-wins and every reused dependency still reaches its call site,
     * which records a skip — so the provenance is written once, at the end.
     */
    let reusePlan: ReturnType<typeof planReuse> | null = null;

    /**
     * What the acquisition this run performs is ABOUT.
     *
     * Declared at handler scope because it is written inside the acquisition
     * block and read at `traceStartRun`, which sits outside it — the stamp and
     * the packet have to describe the same subject or the reuse decision is
     * made against the wrong facts.
     */
    let acquisitionSubject: AcquisitionSubject | null = null;

    /**
     * Already held for this subject — do not buy it twice.
     *
     * Only ever true for a value `planReuse` admitted, which means it came from
     * this report's own earlier invocation, for this address, inside its shelf
     * life. A dependency that was never acquired, or failed, or expired, is
     * absent here and is fetched exactly as before.
     */
    const alreadyHeld = (key: keyof EnhancedData): boolean =>
      enhancedData[key] !== undefined && enhancedData[key] !== null;

    /*
     * The coordinate the planning registers and the published-project register
     * are asked at, resolved once and qualified once. Declared here beside
     * `enhancedData` because both producers read it and they sit in different
     * blocks — see the resolution below for what it closes and why only a
     * parcel-grade match is usable.
     */
    let subjectCoordinate: SubjectCoordinate | null = null;
    let coordinateRefusal: { refusal: string; detail: string; tried: string[] } | null = null;

    /**
     * What happened when this run asked for each piece of evidence.
     *
     * Declared here rather than inside the enrichment try block because the
     * ledger has to survive a throw: a run that died halfway through its
     * producers is exactly the run whose reader most needs to know which
     * ones were reached.
     */
    const acquisition = new AcquisitionRecorder();

    /**
     * RF-7.2B.1 §2 — the subject's TRUSTED geography, resolved from the
     * verified coordinate during this run rather than read back from a sweep
     * that has not visited this report yet. Declared out here because the
     * Client-Safe Gate below the data block is what consumes it.
     */
    let subjectGeography: Record<string, unknown> | null = null;
    /** How it was obtained, for the ledger and the run log. */
    let geographyResolution: { source: string; status: string; requeried: boolean } = {
      source: 'none', status: 'unresolved', requeried: false,
    };

    // Declare suburb/state/postcode OUTSIDE try block so they're accessible in reportContent
    let postcode = detectedPostcode;
    let state = detectedState || 'NSW';
    let suburb = detectedSuburb;

    // RF-7.2B.1B1 — which postcode may SELECT client-facing crime evidence.
    //
    // `detectedPostcode` is `propertyAddress.match(/\b(\d{4})\b/)` — the first
    // four-digit token in a free-text string, which cannot tell a postcode from
    // a builder-stock lot number and has no way to say it is unsure.
    // `propertyDetails.postcode` is a field the caller filled in; the generator
    // has always received it and logged it, and has never read it for this.
    //
    // The geography is not resolved yet at intake, and tracing every production
    // origin of `propertyDetails.postcode` proved it is NOT independently
    // structured — `auto-report-webhook` falls through to an address parse, a
    // suburb-name database lookup and a hardcoded suburb table. So nothing is
    // trusted at intake today and this call does not go out; the condition is
    // computed rather than hardcoded so a genuinely authoritative origin would
    // re-enable it without another change here.
    //
    // Deliberately narrow: this decides which AREA is described, and never
    // touches F4, which decides whether a rate may be divided at all.
    const crimePostcodeAtIntake = resolveCrimePostcodeAuthority({
      structuredPostcode: propertyDetails?.postcode,
      freeTextPostcode: detectedPostcode,
      state,
    });
    console.log(`🔎 Crime evidence postcode at intake: ${crimePostcodeAtIntake.note}`);
    
    try {
      // Use detected values from earlier, or extract from formatted input
      
      // If not detected earlier, try to extract from formatted input
      if (!postcode) {
        const postcodeMatch = formattedInput.match(/\b(\d{4})\b/);
        postcode = postcodeMatch ? postcodeMatch[1] : null;
      }
      if (!state || state === 'NSW') {
        const stateMatch = formattedInput.match(/\b(NSW|VIC|QLD|WA|SA|TAS|NT|ACT)\b/i);
        if (stateMatch) state = stateMatch[1].toUpperCase();
      }
      if (!suburb) {
        // Extract suburb from address (everything between street and state/postcode)
        const suburbMatch = formattedInput.match(/,\s*([A-Za-z\s]+)(?:,|\s+(?:NSW|VIC|QLD|WA|SA|TAS|NT|ACT))/i);
        suburb = suburbMatch ? suburbMatch[1].trim().toLowerCase().replace(/\s+/g, '-') : null;
      } else {
        // Convert suburb to URL-friendly format if not already
        suburb = suburb.toLowerCase().replace(/\s+/g, '-');
      }
      
      console.log('Using for API calls:', { suburb, postcode, state });

      // ──────────────────────────────────────────────────────────────────
      // RESEARCH BOUGHT ONCE
      //
      // A fifteen-section report takes several invocations, and every one of
      // them re-ran the whole acquisition phase: the same planning registers,
      // the same climate grid, the same Domain call, for the same property,
      // minutes apart. That is not just spend — it is the reason so few
      // sections fit in an invocation, because acquisition eats the budget the
      // section loop needs.
      //
      // Nothing new is stored to fix it. `traceStartRun` has always persisted
      // this object to `report_generation_runs.data_packet` AFTER the
      // acquisition block, so the research is already durable; what was
      // missing was a statement of what it describes. `planReuse` reads that
      // stamp and refuses per dependency — no stamp, a different subject,
      // changed inputs where they matter, an expired shelf life, or simply no
      // stored value. Every legacy packet is unstamped, so every existing
      // report acquires exactly as it did.
      //
      // This is emphatically NOT "skip acquisition on continuation": that
      // would reuse a result acquired for somewhere else, and freeze a
      // four-second silence as a permanent absence.
      acquisitionSubject = {
        address: propertyAddress,
        postcode: postcode ?? null,
        state: state ?? null,
        inputRevision: inputRevisionOf(mergedOverrides as Record<string, unknown>),
      };
      if (isContinuation && reportId && supabaseClient) {
        try {
          const { data: priorRun } = await supabaseClient
            .from('report_generation_runs')
            .select('data_packet, started_at')
            .eq('report_id', reportId)
            .not('data_packet', 'is', null)
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const plan = planReuse({
            storedPacket: (priorRun?.data_packet ?? null) as Record<string, unknown> | null,
            subject: acquisitionSubject,
            nowMs: Date.now(),
          });

          if (Object.keys(plan.values).length > 0) {
            enhancedData = { ...enhancedData, ...plan.values };
            // The ledger entries are written at the END of the block, not
            // here: the recorder's rule is last-write-wins, and a reused
            // dependency still passes its own call site, which records a skip.
            reusePlan = plan;
          }
          console.log(
            `♻️ Acquisition reuse: ${Object.keys(plan.values).length} of `
            + `${plan.entries.length} dependencies adopted`
            + (plan.stamped ? '' : ' (no stamp on the stored packet — nothing reused)')
          );
        } catch (reuseError: any) {
          // Reuse is an optimisation. Failing to read the previous packet must
          // never stop a report being produced — it just costs the calls again.
          console.warn('♻️ Acquisition reuse unavailable (non-blocking):', reuseError?.message);
        }
      }

      // ============================================================================
      // PHASE 1: PARALLEL INDEPENDENT DATA FETCHING
      // These services don't depend on each other, so fetch them all simultaneously
      // ============================================================================
      console.log('🚀 Starting PARALLEL data fetch (Phase 1)...');
      const phase1StartTime = Date.now();
      
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      // IMPORTANT: Use service role key for internal service-to-service calls
      // The anon key has role='anon' which fails verifyAuth in sub-functions
      // Service role is recognized by verifyAuth as a valid internal caller
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${INTERNAL_EDGE_SECRET}`,
        ...(supabaseAnonKey ? { 'apikey': supabaseAnonKey } : {})
      };

      // Define all Phase 1 fetch promises
      const phase1Promises = [
        // 1. Domain market data is keyed on the TRUSTED geography — the suburb,
        // state and postal area resolved from the verified coordinate — which
        // does not exist yet in phase 1. It is fetched after geography
        // resolution below, beside the scoring call it feeds; a free-text
        // suburb and a parsed four-digit token may not select a market
        // (`crimePostcodeAuthority.pure.ts` records why). This slot keeps the
        // results array aligned with serviceNames.
        Promise.resolve({ success: false, serviceName: 'domain-data-service', error: 'Missing trusted geography (fetched after geography resolution)' }),

        // 2. ABS demographic data
        (postcode && !alreadyHeld('demographics')) ? fetchServiceWithFallback('abs-data-service', async () => {
          const response = await acquisitionFetch(`${supabaseUrl}/functions/v1/abs-data-service`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ postcode, state })
          }, 30000, 'abs-data-service');
          assertAcquisitionAnswered(response, 'abs-data-service');
          if (response.ok) {
            const data = await response.json();
            return data.success ? data.data : null;
          }
          return null;
        }) : Promise.resolve({ success: false, serviceName: 'abs-data-service', error: 'Missing postcode' }),

        // 3. RBA economic data
        !alreadyHeld('economics') ? fetchServiceWithFallback('rba-data-service', async () => {
          const response = await acquisitionFetch(`${supabaseUrl}/functions/v1/rba-data-service`, {
            method: 'POST',
            headers
          }, 20000, 'rba-data-service');
          assertAcquisitionAnswered(response, 'rba-data-service');
          if (response.ok) {
            const data = await response.json();
            return data.data || null;
          }
          return null;
        }) : Promise.resolve({ success: false, serviceName: 'rba-data-service', error: "Missing — held from this report's own earlier invocation" }),

        // 4. SEIFA socioeconomic data
        (postcode && !alreadyHeld('seifaData')) ? fetchServiceWithFallback('abs-seifa-service', async () => {
          const response = await acquisitionFetch(`${supabaseUrl}/functions/v1/abs-seifa-service`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ postcode, state })
          }, 25000, 'abs-seifa-service');
          assertAcquisitionAnswered(response, 'abs-seifa-service');
          if (response.ok) {
            const data = await response.json();
            return data.success ? data.data : null;
          }
          return null;
        }) : Promise.resolve({ success: false, serviceName: 'abs-seifa-service', error: 'Missing postcode' }),

        // 5. Crime statistics
        //
        // RF-7.2B.1B1 — keyed on a postcode whose PROVENANCE is trusted, never
        // on `propertyAddress.match(/\b(\d{4})\b/)`. That expression takes the
        // first four-digit token in the address, which for builder stock is the
        // LOT number: measured over the corpus, 30 of 418 addresses parse the
        // wrong token and 17 of those land on a real postcode ("Lot 2267 Hunza
        // Road, Truganina, VIC 3029" parses 2267, which is in NSW). Nothing was
        // ever served wrong only because the crime service also filters on
        // state and no Victorian register is loaded — containment by accident,
        // which stops the day VIC loads.
        //
        // The geography has not been resolved at this point in the run, so the
        // only trusted source available here is a STRUCTURED postcode the caller
        // supplied as a field. Where there is none this call does not go out at
        // all, and the re-key below picks it up once the coordinate lands.
        (suburb && state && crimePostcodeAtIntake.trusted && !alreadyHeld('crimeStatistics'))
          ? fetchServiceWithFallback('crime-statistics-service', async () => {
          const response = await acquisitionFetch(`${supabaseUrl}/functions/v1/crime-statistics-service`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ suburb, state, postcode: crimePostcodeAtIntake.postcode })
          }, 30000, 'crime-statistics-service');
          assertAcquisitionAnswered(response, 'crime-statistics-service');
          if (response.ok) {
            const data = await response.json();
            return data.success ? data.data : null;
          }
          return null;
        }) : Promise.resolve({
          success: false,
          serviceName: 'crime-statistics-service',
          error: suburb && state ? crimePostcodeAtIntake.note : 'Missing suburb/state',
        }),

        // 6. Employment data
        (state && !alreadyHeld('employmentData')) ? fetchServiceWithFallback('abs-employment-service', async () => {
          const response = await acquisitionFetch(`${supabaseUrl}/functions/v1/abs-employment-service`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ suburb, state, postcode })
          }, 25000, 'abs-employment-service');
          assertAcquisitionAnswered(response, 'abs-employment-service');
          if (response.ok) {
            const data = await response.json();
            return data.success ? data.data : null;
          }
          return null;
        }) : Promise.resolve({ success: false, serviceName: 'abs-employment-service', error: 'Missing state' }),

        // 7. Climate data is coordinate-keyed (SILO grid) and the verified
        // coordinate does not exist yet in phase 1 — it is fetched after
        // location intelligence below. This slot keeps the results array
        // aligned with serviceNames.
        Promise.resolve({ success: false, serviceName: 'climate-data-service', error: 'Missing coordinates (fetched after location intelligence)' }),
      ];

      // Execute all Phase 1 fetches in parallel
      const phase1Results = await Promise.allSettled(phase1Promises);
      const phase1Duration = Date.now() - phase1StartTime;
      
      // Process Phase 1 results
      let successCount = 0;
      let failCount = 0;
      
      phase1Results.forEach((result, index) => {
        const serviceNames = ['domain', 'demographics', 'economics', 'seifaData', 'crimeStatistics', 'employmentData', 'climateData'];
        const serviceName = serviceNames[index];
        
        // The settled union mixes ServiceResult<any> with a bare error shape that
        // carries no `data`, so read the payload through the widened result — the
        // truthiness check below is what actually decides whether it is present.
        const fulfilled = result.status === 'fulfilled'
          ? (result.value as ServiceResult<any>)
          : null;
        // The producer name `data_sources` and the acquisition ledger use,
        // which is not always the name of the service that answered.
        const producerNames: Record<string, string> = {
          domain: 'marketData',
          demographics: 'demographics',
          economics: 'economics',
          seifaData: 'seifa',
          crimeStatistics: 'crimeStatistics',
          employmentData: 'employment',
          climateData: 'climate',
        };
        const producer = producerNames[serviceName] ?? serviceName;
        if (fulfilled && fulfilled.success && fulfilled.data) {
          enhancedData = { ...enhancedData, [serviceName === 'domain' ? 'domainData' : serviceName]: fulfilled.data };
          successCount++;
          acquisition.fromServiceResult(producer, fulfilled, { service: fulfilled.serviceName });
        } else {
          failCount++;
          const reason = result.status === 'rejected' 
            ? result.reason?.message 
            : (result.value as ServiceResult<any>).error;
          if (reason && !reason.includes('Missing')) {
            console.log(`  ⚠️ ${serviceName}: ${reason}`);
          }
          // A rejected promise, a `Missing …` precondition and a provider that
          // answered nothing are three different things and were all one null.
          // The two coordinate-keyed slots are re-recorded in phase 2 where
          // they are genuinely fetched; last write wins, so a skip recorded
          // here never survives a real attempt later in the same run.
          if (result.status === 'rejected') {
            acquisition.failed(producer, String(result.reason?.message ?? 'The fetch threw and reported no message'), `${serviceName}-service`);
          } else if (typeof reason === 'string' && /^missing\b/i.test(reason.trim())) {
            acquisition.skipped(producer, reason, `${serviceName}-service`);
          } else if (typeof reason === 'string' && reason.trim() && !fulfilled?.success) {
            acquisition.fromServiceResult(producer, fulfilled ?? { success: false, error: reason }, {
              service: (fulfilled as ServiceResult<any> | null)?.serviceName ?? `${serviceName}-service`,
            });
          } else {
            acquisition.fromServiceResult(producer, fulfilled, { service: `${serviceName}-service` });
          }
        }
      });
      
      console.log(`✓ Phase 1 complete in ${phase1Duration}ms: ${successCount} succeeded, ${failCount} skipped/failed`);

      // ============================================================================
      // PHASE 2: SEQUENTIAL DEPENDENT DATA FETCHING
      // These services depend on Phase 1 results or each other
      // ============================================================================
      console.log('🔄 Starting Phase 2 (dependent services)...');

      // Fetch risk assessment data (can use coordinates from location intelligence)
      if (postcode && state && !alreadyHeld('riskAssessment')) {
        try {
          const riskResponse = await acquisitionFetch(`${supabaseUrl}/functions/v1/risk-assessment-service`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ 
              suburb: suburb || 'unknown',
              state: state,
              postcode: postcode
            })
          }, 25000, 'risk-assessment-service');
          
          if (riskResponse.ok) {
            const riskData = await riskResponse.json();
            if (riskData.success && riskData.data) {
              enhancedData = { ...enhancedData, riskAssessment: riskData.data };
              console.log('✓ Risk assessment data fetched');
              acquisition.answered('riskAssessment', 'Retrieved and used', 'risk-assessment-service');
            } else {
              acquisition.empty('riskAssessment', 'The risk service answered and holds nothing for this location', 'risk-assessment-service');
            }
          } else {
            acquisition.failed('riskAssessment', `risk-assessment-service answered HTTP ${riskResponse.status}`, 'risk-assessment-service');
          }
        } catch (error: any) {
          console.log('⚠️ Risk assessment skipped:', error?.message?.substring(0, 50));
          acquisition.failed('riskAssessment', String(error?.message ?? 'The risk request threw and reported no message'), 'risk-assessment-service');
        }
      } else {
        acquisition.skipped('riskAssessment', 'No postcode and state were resolved, and the risk register is keyed on both', 'risk-assessment-service');
      }

      // NOTE: ABS demographics and RBA economics are now fetched in Phase 1 parallel block above

      // Fetch rent from cache if not provided
      let weeklyRent = propertyDetails?.weeklyRent;
      let rentSource = 'user_input';
      
      if (!weeklyRent && suburb && state) {
        try {
          console.log('📊 Weekly rent not provided, fetching from SQM Research cache...');
          const rentResponse = await acquisitionFetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/sqm-rent-service`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
                // The gateway requires a JWT; verifyAuth uses the separate internal credential.
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'x-internal-edge-secret': INTERNAL_EDGE_SECRET,
                ...(supabaseAnonKey ? { 'apikey': supabaseAnonKey } : {})
            },
            body: JSON.stringify({
              suburb: suburb.replace(/-/g, ' '),
              state: state,
              postcode: postcode || '',
              // Deliberately NOT `effectivePropertyType`. This selects a
              // published rent SERIES, so its vocabulary is the market data's
              // rather than the engine's — mapping `villa` onto `townhouse`
              // here would change which rent is looked up, which is a
              // different question from what the duty and cost engines model.
              propertyType: propertyDetails?.propertyType?.toLowerCase() || 'house',
              bedrooms: modelledBeds
            })
          }, 'register', 'sqm-rent-service');
          
          if (rentResponse.ok) {
            const rentData = await rentResponse.json();
            if (rentData.success && rentData.data?.medianWeeklyRent) {
              weeklyRent = rentData.data.medianWeeklyRent;
              rentSource = rentData.source === 'cache' ? 'sqm_cache' : 'sqm_scraped';
              console.log(`✓ Median weekly rent from ${rentSource}: $${weeklyRent}`);
            } else {
              console.log('⚠️ No rent data available from SQM Research');
            }
          }
        } catch (error: any) {
          console.log('⚠️ SQM rent lookup failed:', error?.message || 'Unknown error');
        }
      }
      
      // Calculate financial projections if property details available
      // Use effective values defined at the top (which already include overrides)
      if (effectivePurchasePrice > 0) {
        try {
          // Use effective values that were defined at the top (already include overrides)
          const calcWeeklyRent = effectiveWeeklyRent || weeklyRent || 0;
          
          console.log('📊 Financial calculator inputs (using top-level effective values):');
          console.log(`  Property Value: $${effectivePurchasePrice.toLocaleString()}`);
          console.log(`  Deposit: $${effectiveDepositValue.toLocaleString()} (LVR: ${effectiveLvr}%)`);
          console.log(`  Interest Rate: ${effectiveInterestRate}%`);
          console.log(`  Loan Term: ${effectiveLoanTerm} years`);
          console.log(`  Weekly Rent: $${calcWeeklyRent}`);
          console.log(`  First Home Buyer: ${effectiveIsFirstHomeBuyer}`);
          console.log(`  New Build: ${effectiveIsNewBuild}`);
          
          const financialResponse = await acquisitionFetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/financial-calculator-service`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${INTERNAL_EDGE_SECRET}`,
              ...(supabaseAnonKey ? { 'apikey': supabaseAnonKey } : {})
            },
            body: JSON.stringify({
              propertyValue: effectivePurchasePrice,
              deposit: effectiveDepositValue,
              interestRate: effectiveInterestRate,
              loanTerm: effectiveLoanTerm,
              weeklyRent: calcWeeklyRent,
              weeklyRentSource: rentSource,
              state: state,
              // ONE property-type vocabulary. This used to send the raw string
              // with a silent `|| 'house'`, while `overrides.pure.ts`
              // normalised separately — so `apartment` reached the engine as
              // `apartment`, never matched its only test (`=== 'unit'`) and
              // never drew the strata estimate. `undefined` for an
              // unrecognised type is deliberate: an unresolved type is not a
              // house, and the engine already treats a non-unit as no strata.
              propertyType: normalisePropertyType(sourcePropertyType),
              isFirstHomeBuyer: effectiveIsFirstHomeBuyer,
              isNewBuild: effectiveIsNewBuild,
              // WHAT is being bought, so the duty engine can reach its
              // vacant-land schedules. Until now the build type reached only
              // the model, as prose telling it to skip the rental sections,
              // while the engine assessed residential duty regardless.
              buildType: effectiveBuildType,
              // Reviewed figures go INTO the engine so the totals, series,
              // sensitivity and metrics all describe them; splatting them
              // over the response afterwards (the old way) left every
              // downstream figure describing the formula estimates.
              // (toFiniteNumber, not the local toNumberOr — that const is
              // declared later in this handler and would be TDZ here.)
              ...((toFiniteNumber(mergedOverrides.capitalGrowth) ?? 0) > 0
                ? { capitalGrowthRate: toFiniteNumber(mergedOverrides.capitalGrowth) } : {}),
              ...((toFiniteNumber(mergedOverrides.cpiGrowthRate) ?? 0) > 0
                ? { cpiGrowthRate: toFiniteNumber(mergedOverrides.cpiGrowthRate) } : {}),
              ...(buildAnnualCostOverrides(mergedOverrides)
                ? { annualCostOverrides: buildAnnualCostOverrides(mergedOverrides) } : {}),
              ...(toFiniteNumber(mergedOverrides.stampDuty) !== undefined
                ? { stampDutyOverride: toFiniteNumber(mergedOverrides.stampDuty) } : {}),
              ...(toFiniteNumber(mergedOverrides.solicitorFees) !== undefined
                ? { legalFeesOverride: toFiniteNumber(mergedOverrides.solicitorFees) } : {}),
              // The loan product and the occupancy go INTO the engine too, so
              // the schedule, the lifetime interest, the year-1 position and
              // the sensitivity all describe the case the report states —
              // they used to be display overrides over P&I, 52-week arithmetic
              // (QA-04, QA-06).
              ...(mergedOverrides.loanType ? { loanType: mergedOverrides.loanType } : {}),
              ...(toFiniteNumber(mergedOverrides.interestOnlyPeriodYears) !== undefined
                ? { interestOnlyYears: toFiniteNumber(mergedOverrides.interestOnlyPeriodYears) } : {}),
              ...(toFiniteNumber(mergedOverrides.occupancyRate) !== undefined
                ? { occupancyWeeks: toFiniteNumber(mergedOverrides.occupancyRate) } : {}),
            })
          }, 'local', 'financial-calculator-service');
          
          if (financialResponse.ok) {
            const financialData = await financialResponse.json();
            
            // The modelled overrides already went INTO the calculator call
            // above; only the fields the engine does not model (tax
            // treatment, occupancy display, build splits, loan labels) are
            // merged onto the result. The old splat loop wrote every
            // override over the response's leaves, which is how stored rows
            // came to carry overridden line items beside totals, series and
            // metrics computed from the formula estimates.
            if (hasOverrides) {
              console.log('🔀 Applying display-only overrides to fresh financial calculations');
              enhancedData = {
                ...enhancedData,
                financials: applyDisplayOverrides(financialData.data, mergedOverrides)
              };
            } else {
              enhancedData = { ...enhancedData, financials: financialData.data };
            }
            
            console.log('Financial calculations completed successfully');
            acquisition.answered('financials', 'Computed by the financial engine from the recorded inputs', 'financial-calculation-service');
            
            // Run validation on financial calculations - USE EFFECTIVE VALUES
            try {
              const validationResponse = await acquisitionFetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/financial-validation-service`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  // The gateway requires a JWT; verifyAuth uses the separate internal credential.
                  'Authorization': `Bearer ${supabaseAnonKey}`,
                  'x-internal-edge-secret': INTERNAL_EDGE_SECRET,
                  ...(supabaseAnonKey ? { 'apikey': supabaseAnonKey } : {})
                },
                body: JSON.stringify({
                  propertyValue: effectivePurchasePrice,
                  weeklyRent: effectiveWeeklyRent || weeklyRent,
                  stampDuty: financialData.data.initialCosts.stampDuty,
                  councilRates: financialData.data.annualCosts.councilRates,
                  annualCosts: financialData.data.annualCosts,
                  state: state,
                  propertyType: effectivePropertyType
                })
              }, 'local', 'financial-validation-service');
              
              if (validationResponse.ok) {
                const validationData = await validationResponse.json();
                enhancedData = { ...enhancedData, validation: validationData.data };
                console.log('✓ Financial validation completed:', {
                  qualityScore: validationData.data.qualityScore,
                  flagCount: validationData.data.flags.length
                });
                
                // Log any critical validation errors
                const criticalFlags = validationData.data.flags.filter((f: any) => f.severity === 'critical');
                if (criticalFlags.length > 0) {
                  console.warn('⚠️ CRITICAL validation issues detected:', criticalFlags);
                }
              }
            } catch (validationError: any) {
              console.warn('⚠️ Validation service failed (non-blocking):', validationError?.message);
            }
          }
        } catch (error: any) {
          console.log('Financial calculations failed:', error?.message || 'Unknown error');
        }
      }

      // ==================================================================
      // RF-7.2B.1B1 — a deterministic enrichment is bought ONCE per report
      // ==================================================================
      // This block used to run on every resume. `existingEnhancedFields.
      // locationIntelligence` was read only when deciding what to WRITE, so the
      // fetch was unguarded — and one enrichment is EIGHT Google calls (1
      // geocode + 6 Places Nearby + 1 Distance Matrix, confirmed by the
      // production ledger's exact 6:1 Places:DistanceMatrix ratio). The
      // 2026-09-12 health check resumed eleven times; on a working geocode that
      // is 88 calls for one report, 80 of them re-buying an answer that cannot
      // change, because the property does not move between resumes.
      //
      // Reuse is refused unless the stored object can PROVE it describes this
      // subject: the acquisition stamp names the address, postcode and state it
      // was acquired for, and every row written before this change has no stamp
      // and therefore re-fetches exactly as it does today. A failed enrichment
      // is never persisted in the first place (`success: false` carries no
      // `data`), so this can never freeze the live F1 outage into place.
      const enrichmentSubject = {
        address: formattedInput,
        postcode,
        state,
      };
      const reuse = assessEnrichmentReuse(
        existingEnhancedFields.locationIntelligence,
        enrichmentSubject,
      );
      if (reuse.reuse) {
        locationEnrichmentReused = true;
        enhancedData = {
          ...enhancedData,
          locationIntelligence: existingEnhancedFields.locationIntelligence,
        };
        console.log(`♻️ ${reuse.note}`);
        acquisition.answered(
          'locationIntelligence',
          `Reused the enrichment this report already holds: ${reuse.note}`,
          'location-intelligence-service',
        );
      } else {
      // Fetch location intelligence data
      try {
        console.log(`Fetching location intelligence for: ${formattedInput} (${reuse.verdict})`);
        const locationResponse = await acquisitionFetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/location-intelligence-service`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${INTERNAL_EDGE_SECRET}`,
            ...(supabaseAnonKey ? { 'apikey': supabaseAnonKey } : {})
          },
          body: JSON.stringify({
            address: formattedInput,
            postcode: postcode,
            state: state
          })
        }, 'vendor', 'location-intelligence-service');
        
        if (locationResponse.ok) {
          const locationData = await locationResponse.json();
          
          if (locationData.success && locationData.data) {
            // RF-7.2B.1B1 — carry the attempt count forward. A partial
            // acquisition is retried a bounded number of times and then
            // accepted, so a persistently failing amenity category cannot
            // re-buy all eight calls on every remaining resume.
            enhancedData = {
              ...enhancedData,
              locationIntelligence: recordAcquisitionAttempt(
                locationData.data,
                nextAcquisitionAttempt(
                  existingEnhancedFields.locationIntelligence,
                  enrichmentSubject,
                ),
              ),
            };
            console.log('✓ Location intelligence data fetched successfully');
            acquisition.answered('locationIntelligence', 'Retrieved and used', 'location-intelligence-service');
            
            if (locationData.usingMockData) {
              console.warn('⚠️ Using mock location data:', locationData.message);
            }
          } else {
            console.warn('⚠️ Location intelligence returned no data');
            acquisition.empty(
              'locationIntelligence',
              'The location service answered and returned nothing for this address',
              'location-intelligence-service',
            );
          }
        } else {
          const errorText = await locationResponse.text();
          console.error('❌ Location intelligence API error:', locationResponse.status, errorText);
          // The body is the provider's own words and is what an operator needs
          // to tell a geocoder refusal from a boot failure; it is bounded here
          // because a ledger entry is read by a person, not parsed.
          acquisition.failed(
            'locationIntelligence',
            `location-intelligence-service answered HTTP ${locationResponse.status}: ${String(errorText).slice(0, 200)}`,
            'location-intelligence-service',
          );
        }
      } catch (error: any) {
        console.error('❌ Location intelligence fetch failed:', error?.message || 'Unknown error');
        acquisition.failed(
          'locationIntelligence',
          String(error?.message ?? 'The location request threw and reported no message'),
          'location-intelligence-service',
        );
      }
      }

      // ======================================================================
      // RF-7.2B.1 §2 — PRE-GENERATION GEOGRAPHY RESOLUTION
      // ======================================================================
      // The order this establishes:
      //
      //   trusted coordinate → GEOGRAPHY → trusted POA → ABS → gate → snapshot
      //
      // The verified coordinate is the first trustworthy thing this function
      // holds about WHERE the property is. Everything before it is the
      // customer's typed address, which is exactly what produced the untrusted
      // postcode the phase-1 ABS calls were keyed on: `propertyAddress.match(
      // /\b(\d{4})\b/)` takes the first four digits in a free-text string.
      //
      // Until now the Client-Safe Gate's postal-area cross-check read
      // `report_geography`, which is written by a sweep that self-selects
      // reports whose `location_intelligence` is ALREADY PERSISTED — so a
      // first generation never had a row and its demographics failed closed,
      // while a regeneration of the same property got area statistics. Same
      // property, two different documents, decided by whether a batch job had
      // been past. That is the inconsistency this closes.
      //
      // There is no second geography algorithm: `resolveOneReportGeography` is
      // the sweep's own per-report body, and the sweep now calls it too.
      //
      // What it does NOT do: restore data by trusting something weaker. An
      // unresolved coordinate leaves `subjectGeography` null and the gate
      // withholds, exactly as it does today. Nothing here reads the free-text
      // suburb or postcode, borrows a neighbour's geography, or invents a
      // demographic figure.
      const subjectCoords = enhancedData.locationIntelligence?.coordinates;
      const subjectLat = Number(subjectCoords?.lat);
      const subjectLng = Number(subjectCoords?.lng);
      if (reportId && supabaseClient) {
        try {
          const geoOutcome = await resolveOneReportGeography({
            supabase: supabaseClient,
            reportId,
            latitude: Number.isFinite(subjectLat) ? subjectLat : null,
            longitude: Number.isFinite(subjectLng) ? subjectLng : null,
          });
          geographyResolution = {
            source: 'pre_generation', status: geoOutcome.status, requeried: false,
          };
          if (geoOutcome.writeError) {
            // The row could not be persisted. The RESOLUTION is still sound —
            // it came from the same point-in-polygon — so this run uses it and
            // the sweep will write it later. Storage is not authority.
            console.warn(
              `⚠️ report_geography write failed (${geoOutcome.writeError}) — `
              + 'resolution used for this run; the sweep will persist it.',
            );
          }
          subjectGeography = geoOutcome.row === null ? null : {
            postcode: geoOutcome.row.postcode,
            status: geoOutcome.row.status,
            suburb: geoOutcome.row.suburb,
            state: geoOutcome.row.state,
          };
          console.log(
            `🗺️ Geography resolved before the gate: ${geoOutcome.status}`
            + (geoOutcome.row?.postcode ? ` (POA ${geoOutcome.row.postcode})` : ''),
          );
        } catch (error: any) {
          // Total: a resolution that cannot be made is an absence, never a
          // failed report. The gate withholds and the document says so.
          console.warn(
            '⚠️ Pre-generation geography resolution failed:',
            error?.message || 'Unknown error',
          );
        }
      }

      // Where the boundary service disagrees with the typed address, the ABS
      // payloads fetched in phase 1 describe SOMEBODY ELSE'S postal area. They
      // are re-fetched for the subject's own POA — and where that cannot be
      // done, the wrong-area payload is DROPPED rather than kept: the gate
      // would refuse it on the POA cross-check anyway, and carrying it forward
      // into the snapshot would store a figure about the wrong place.
      //
      // All THREE postal-area payloads move together. `abs-employment-service`
      // projects the same `abs_census_poa` row as the demographics, and
      // `industryTable` prints from it independently, so re-keying two of the
      // three would put a 3024 population table beside a 3338 industry mix on
      // one page. The gate withholds them as one for the same reason.
      const trustedPostcode = subjectPostcodeOf(subjectGeography);
      // The trusted-POA re-query overwrites all three ABS reads, so it is
      // skipped only when all three are already held — a reused value came
      // from a run where this same re-query had already happened, and a
      // partial reuse is better served by letting it run than by leaving two
      // of the three keyed on the postcode we have stopped believing.
      const absAllReused = alreadyHeld('demographics')
        && alreadyHeld('seifaData')
        && alreadyHeld('employmentData');
      if (trustedPostcode && trustedPostcode !== postcode && !absAllReused) {
        const trustedState = typeof subjectGeography?.state === 'string' && subjectGeography.state
          ? subjectGeography.state as string
          : state;
        console.log(
          `📍 Trusted POA ${trustedPostcode} differs from the address-derived `
          + `${postcode ?? '(none)'} — re-querying ABS demographics, SEIFA and employment.`,
        );
        const requery = async (fn: string, payload: Record<string, unknown>) => {
          try {
            const res = await acquisitionFetch(`${supabaseUrl}/functions/v1/${fn}`, {
              method: 'POST',
              headers,
              body: JSON.stringify(payload),
            }, 30000, fn);
            if (!res.ok) return null;
            const body = await res.json();
            return body?.success ? body.data : null;
          } catch (_e) {
            return null;
          }
        };
        const [absAgain, seifaAgain, employmentAgain] = await Promise.all([
          requery('abs-data-service', { postcode: trustedPostcode, state: trustedState }),
          requery('abs-seifa-service', { postcode: trustedPostcode, state: trustedState }),
          // This one also takes a suburb. The TRUSTED suburb, from the same
          // boundary answer — never the free-text one, which belongs to the
          // postcode we have just stopped believing.
          requery('abs-employment-service', {
            suburb: typeof subjectGeography?.suburb === 'string' ? subjectGeography.suburb : null,
            state: trustedState,
            postcode: trustedPostcode,
          }),
        ]);
        enhancedData.demographics = absAgain ?? undefined;
        enhancedData.seifaData = seifaAgain ?? undefined;
        enhancedData.employmentData = employmentAgain ?? undefined;
        geographyResolution = { ...geographyResolution, requeried: true };
        console.log(
          `↻ ABS re-query for POA ${trustedPostcode}: demographics `
          + `${absAgain ? 'retrieved' : 'unavailable (withheld)'}, SEIFA `
          + `${seifaAgain ? 'retrieved' : 'unavailable (withheld)'}, employment `
          + `${employmentAgain ? 'retrieved' : 'unavailable (withheld)'}.`,
        );
      }

      // ==================================================================
      // RF-7.2B.1B0-F4 — the crime rate's denominator is ADMITTED EVIDENCE
      // ==================================================================
      // `crime-statistics-service` used to read `abs_census_poa.population`
      // itself, keyed on whatever postcode it was handed. With geography
      // unresolved that was the untrusted postcode scraped out of the address,
      // so the service restored a population the Client-Safe Gate had withheld
      // — and production report 0ec278ea printed "10,891 offences per 100,000"
      // (1,144 / 10,504) on a page that also said population for 2794 was
      // "explicitly unavailable and must not be substituted".
      //
      // TWO conditions, both necessary and neither sufficient:
      //
      //   (1) TRUSTED GEOGRAPHY — `subjectPostcodeOf(subjectGeography)` is the
      //       boundary service's own POA. An unresolved coordinate yields
      //       none, so a free-text postcode can never reach this at all.
      //
      //   (2) CANONICAL ADMISSION — the population is taken from
      //       `enhancedData.demographics`, which is the payload
      //       `abs-data-service` produced and the evidence layer admitted
      //       (re-keyed onto the trusted POA above where the two differed).
      //       Where that payload is absent the demographics were withheld,
      //       and the denominator is withheld with them.
      //
      // Holding a correct postcode is deliberately NOT enough. Nothing here
      // reads a population table: doing so is what made the crime module a
      // second door onto evidence the report had already refused, and the
      // whole repair is that the only population that can reach a rate is one
      // the report itself is willing to state.
      const crimePoa = subjectPostcodeOf(subjectGeography);
      const admittedPop = (enhancedData.demographics as {
        population?: { total?: unknown; source?: unknown; referencePeriod?: unknown };
      } | undefined)?.population;
      const admittedPopValue = typeof admittedPop?.total === 'number'
        && Number.isFinite(admittedPop.total) && admittedPop.total > 0
        ? admittedPop.total
        : null;
      // RF-7.2B.1B1 — now the coordinate has landed, the canonical POA outranks
      // whatever intake had. Two things follow, and they are separate from F4:
      // this decides WHICH AREA the counts describe, F4 decides whether they may
      // be DIVIDED by a population.
      const crimeAuthority = resolveCrimePostcodeAuthority({
        geographyPostcode: crimePoa,
        structuredPostcode: propertyDetails?.postcode,
        freeTextPostcode: detectedPostcode,
        state,
      });
      if (crimeAuthority.trusted
        && crimeAuthority.postcode !== crimePostcodeAtIntake.postcode) {
        // Either intake had nothing trusted and now we do, or the POA disagrees
        // with the structured field. Counts only — the rate, if it is owed, is
        // added by the admitted-population call below.
        try {
          const recount = await acquisitionFetch(`${supabaseUrl}/functions/v1/crime-statistics-service`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              suburb: typeof subjectGeography?.suburb === 'string' ? subjectGeography.suburb : suburb,
              state,
              postcode: crimeAuthority.postcode,
            }),
          }, 20000, 'crime-statistics-service');
          if (recount.ok) {
            const body = await recount.json();
            if (body?.success && body.data) {
              enhancedData = { ...enhancedData, crimeStatistics: body.data };
              console.log(`📍 ${crimeAuthority.note}`);
            }
          }
        } catch (error: any) {
          console.warn('⚠️ Crime re-key skipped:', error?.message?.substring(0, 80));
        }
      } else if (!crimeAuthority.trusted && enhancedData.crimeStatistics) {
        // Nothing authoritative ties this property to a postcode. Withheld
        // rather than risked: the danger is not a missing number, it is a real,
        // current, correctly sourced number about the wrong town.
        enhancedData = { ...enhancedData, crimeStatistics: undefined };
        console.log(`⛔ ${crimeAuthority.note} ${CRIME_EVIDENCE_WITHHELD_NOTE}`);
      }

      if (crimePoa && admittedPopValue && (state === 'NSW' || state === 'SA')) {
        try {
          const crimeAgain = await acquisitionFetch(`${supabaseUrl}/functions/v1/crime-statistics-service`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              suburb: typeof subjectGeography?.suburb === 'string' ? subjectGeography.suburb : suburb,
              state,
              postcode: crimePoa,
              population: {
                value: admittedPopValue,
                // Provenance travels from the admitted payload rather than
                // being asserted here, so the served rate describes the
                // denominator the report is actually relying on.
                source: typeof admittedPop?.source === 'string' && admittedPop.source
                  ? admittedPop.source
                  : 'abs_census_poa',
                geography: crimePoa,
                grain: 'postcode',
                vintage: typeof admittedPop?.referencePeriod === 'string' && admittedPop.referencePeriod
                  ? admittedPop.referencePeriod
                  : '2021 Census usual residents',
              },
            }),
          }, 20000, 'crime-statistics-service');
          if (crimeAgain.ok) {
            const body = await crimeAgain.json();
            if (body?.success && body.data) {
              enhancedData = { ...enhancedData, crimeStatistics: body.data };
              console.log(`✓ Crime rate admitted for POA ${crimePoa} (population ${admittedPopValue}, from admitted demographics).`);
            }
          }
        } catch (error: any) {
          // Never fails the report: the first crime call already supplied the
          // counts, and this only ever ADDS a rate.
          console.warn('⚠️ Crime rate admission skipped:', error?.message?.substring(0, 80));
        }
      } else if (crimePoa && (state === 'NSW' || state === 'SA')) {
        console.log(
          `↺ POA ${crimePoa} is trusted but no population was admitted — `
          + 'crime counts stand, no per-capita rate.',
        );
      }

      // Planning & development intelligence — zoning, parcel, state
      // development instruments and DA activity from the jurisdiction's own
      // planning services. It keys on the verified coordinate the location
      // step just resolved, so a report with no trustworthy coordinate gets
      // an honest absence rather than another jurisdiction's zone.
      //
      // This guard is why the Cowra report printed planning content with no
      // planning source: the location enrichment produced nothing, so there was
      // no coordinate, so the call was never made — silently, with no error, no
      // log line and no key in `data_sources` at all. The report then filled the
      // gap from the prompt template. Every branch below now records what
      // happened, because "we did not ask" and "the register holds nothing
      // here" are opposite statements about a property.
      /*
       * The coordinate that may ask a register about THIS property.
       *
       * This used to be `enhancedData.locationIntelligence?.coordinates` and
       * nothing else, which is an in-memory working object belonging to the
       * run that is executing. Measured over the 105 stored reports in the
       * verification corpus: 5 carry a coordinate, and **0 carry a planning
       * key in `data_sources`** — including all five that have one.
       * `23 MACKAY Street, Moranbah QLD 4744`, generated 2026-09-08 (two days
       * after `planning-data-service` went live), holds
       * `{lat: -22.006014, lng: 148.0590271}` on its `location_intelligence`
       * column and `{}` in `enhanced_data`. The coordinate the report already
       * owned sat one column away from a guard that read `undefined`.
       *
       * That is `rawPropertyType`'s defect on the coordinate: every Compass is
       * finished by the resume worker, `enhancedData` starts empty on that
       * run, `assessEnrichmentReuse` rightly refuses an unstamped stored
       * enrichment, and when the live enrichment then fails — Google refused
       * every geocode from 12 Sep 2026 — four producers go quiet at once with
       * nothing but a skip line to show for it.
       *
       * So where this run's own enrichment produced no coordinate, the address
       * is geocoded through the shared chain (cache first, then Nominatim,
       * then the ABS locality centroid, then Google only where an operator
       * lists it). `planningCoordinate.pure.ts` then QUALIFIES the answer:
       * only a match at the address may select a planning control, because a
       * control is an attribute of the parcel and a street or suburb point may
       * sit on the road reserve or on the neighbour's lot. A coarser match is
       * a named refusal, never a stand-in — `crimePostcodeAuthority`'s rule in
       * another register.
       *
       * Climate and the regional read deliberately keep their own guard below:
       * they answer different questions with different evidence rules, and
       * widening this beyond the two producers that were asked about is not
       * this change's to make.
       */
      const resolvedAt = new Date().toISOString();
      subjectCoordinate = enrichmentCoordinate(enhancedData.locationIntelligence, resolvedAt);
      if (!subjectCoordinate) {
        if (!formattedInput || !String(formattedInput).trim()) {
          coordinateRefusal = {
            refusal: 'no_address',
            detail: 'This run was given no address to resolve',
            tried: [],
          };
        } else if (!supabaseClient) {
          coordinateRefusal = {
            refusal: 'provider_unavailable',
            detail: 'No database client was available to read the geocode cache',
            tried: [],
          };
        } else {
          try {
            const recovery = await geocodeAddress(
              supabaseClient,
              { address: String(formattedInput), suburb: null, state, postcode },
              { feature: 'planning-coordinate-recovery' },
            );
            const judged = recoveredCoordinate(recovery, resolvedAt);
            if (judged.usable) {
              subjectCoordinate = judged.coordinate;
              console.log('📍 Coordinate recovered for the registers:', coordinateProvenance(judged.coordinate));
            } else {
              coordinateRefusal = { refusal: judged.refusal, detail: judged.detail, tried: judged.tried };
            }
          } catch (error: any) {
            coordinateRefusal = {
              refusal: 'provider_unavailable',
              detail: String(error?.message ?? 'The recovery geocode threw and reported no message'),
              tried: [],
            };
          }
        }
        if (coordinateRefusal) {
          console.log('📍 No parcel-grade coordinate:', coordinateRefusal.refusal, '—', coordinateRefusal.detail);
        }
      }
      if (subjectCoordinate) {
        const provenance = coordinateProvenance(subjectCoordinate);
        acquisition.record({
          producer: 'subjectCoordinate',
          outcome: 'answered',
          detail: provenance
            ?? 'The coordinate this run\'s own location enrichment resolved for this address',
          service: subjectCoordinate.source === 'geocode_recovery' ? 'geocode-chain' : 'location-intelligence-service',
        });
      } else if (coordinateRefusal) {
        acquisition.record({
          producer: 'subjectCoordinate',
          outcome: ledgerOutcomeFor(coordinateRefusal.refusal as any),
          detail: coordinateRefusal.detail,
          service: 'geocode-chain',
        });
      }

      // ──────────────────────────────────────────────────────────────────
      // ONE WAVE, NOT FOUR QUEUES
      //
      // Planning, climate, regional trends and Domain depend on the geography
      // that has just resolved and on nothing else, and were awaited one after
      // another — so the invocation paid 45 + 40 + 30 + 30 seconds of ceiling
      // IN SERIES inside a run whose whole hard stop is 125s. Started together
      // they cost the slowest of them instead of the sum.
      //
      // Only the REQUEST moves. Every answer is still read, recorded and bound
      // exactly where it was and in the same order, by the same code — so the
      // acquisition ledger and `enhancedData` are written in one sequence
      // whatever order the network answers in, and a wave is not a second way
      // to assemble the record.
      //
      // The QLD crime re-key deliberately stays behind planning: it is keyed on
      // the cadastre's LGA, which is planning's own answer. A dependency is not
      // made concurrent by wishing.
      // ──────────────────────────────────────────────────────────────────
      const planningCoords = subjectCoordinate;
      const climateCoords = enhancedData.locationIntelligence?.coordinates;
      const regionalCoords = enhancedData.locationIntelligence?.coordinates;
      const marketPostcode = subjectPostcodeOf(subjectGeography);
      const marketSuburb = typeof subjectGeography?.suburb === 'string' && subjectGeography.suburb.trim()
        ? subjectGeography.suburb.trim() : null;
      const marketState = abbreviateState(typeof subjectGeography?.state === 'string' ? subjectGeography.state : null)
        ?? abbreviateState(state);

      const planningRequest = (!alreadyHeld('planningData') && planningCoords?.lat && planningCoords?.lng)
        ? startAcquisition(`${supabaseUrl}/functions/v1/planning-data-service`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              latitude: planningCoords.lat,
              longitude: planningCoords.lng,
              state: state,
              postcode: postcode,
            }),
          }, 45000, 'planning-data-service')
        : null;
      const climateRequest = (!alreadyHeld('climateData') && climateCoords?.lat && climateCoords?.lng)
        ? startAcquisition(`${supabaseUrl}/functions/v1/climate-data-service`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              latitude: climateCoords.lat,
              longitude: climateCoords.lng,
              state: state,
              suburb: suburb,
              postcode: postcode,
            }),
          }, 40000, 'climate-data-service')
        : null;
      const regionalRequest = (!alreadyHeld('regionalTrends') && regionalCoords?.lat && regionalCoords?.lng)
        ? startAcquisition(`${supabaseUrl}/functions/v1/abs-regional-service`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              latitude: regionalCoords.lat,
              longitude: regionalCoords.lng,
              state: state,
              suburb: suburb,
              postcode: postcode,
            }),
          }, 30000, 'abs-regional-service')
        : null;
      const domainRequest = (!isAreaReport && !alreadyHeld('domainData') && marketPostcode && marketSuburb && marketState)
        ? startAcquisition(`${supabaseUrl}/functions/v1/domain-data-service`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              suburb: marketSuburb,
              state: marketState,
              postcode: marketPostcode,
              propertyCategory: domainCategoryFor(effectivePropertyType),
              propertyType: effectivePropertyType,
            }),
          }, 30000, 'domain-data-service')
        : null;

      if (planningRequest) {
        const planningStart = Date.now();
        try {
          const planningResponse = await planningRequest;
          if (planningResponse.ok) {
            const planningBody = await planningResponse.json();
            if (planningBody.success && planningBody.data) {
              enhancedData = { ...enhancedData, planningData: planningBody.data };
              console.log('✓ Planning data fetched:', { jurisdiction: planningBody.data.jurisdiction });
              acquisition.record({
                producer: 'planning',
                outcome: 'answered',
                detail: `Retrieved from the ${planningBody.data.jurisdiction ?? 'jurisdiction'} planning layers`,
                service: 'planning-data-service',
                ms: Date.now() - planningStart,
              });
            } else {
              acquisition.empty(
                'planning',
                'The planning service answered and returned no controls for this coordinate',
                'planning-data-service',
              );
            }
          } else {
            acquisition.failed(
              'planning',
              `planning-data-service answered HTTP ${planningResponse.status}`,
              'planning-data-service',
            );
          }
        } catch (error: any) {
          console.log('⚠️ Planning data skipped:', error?.message?.substring(0, 80));
          acquisition.failed('planning', String(error?.message ?? 'The planning request threw and reported no message'), 'planning-data-service');
        }
      } else {
        // Four different sentences, and the ledger must not collapse them: a
        // register asked at the parcel and holding nothing there is a fact
        // about the property, and none of these is that.
        acquisition.record({
          producer: 'planning',
          outcome: ledgerOutcomeFor((coordinateRefusal?.refusal ?? 'no_address') as any),
          detail: coordinateRefusal
            ? `The planning registers are queried by coordinate, and none was usable: ${coordinateRefusal.detail}`
            : 'The planning registers are queried by coordinate, and none was resolved for this property',
          service: 'planning-data-service',
        });
      }

      // Climate is read from SILO at the verified coordinate, which exists
      // only now — the phase-1 slot above deliberately skipped.
      if (climateRequest) {
        try {
          const climateResponse = await climateRequest;
          if (climateResponse.ok) {
            const climateBody = await climateResponse.json();
            if (climateBody.success && climateBody.data) {
              enhancedData = { ...enhancedData, climateData: climateBody.data };
              console.log('✓ Climate reading fetched (SILO grid cell)');
              acquisition.answered('climate', 'Retrieved from the SILO grid cell at the verified coordinate', 'climate-data-service');
            } else {
              acquisition.empty('climate', 'The climate service answered and holds no reading for this grid cell', 'climate-data-service');
            }
          } else {
            acquisition.failed('climate', `climate-data-service answered HTTP ${climateResponse.status}`, 'climate-data-service');
          }
        } catch (error: any) {
          console.log('⚠️ Climate reading skipped:', error?.message?.substring(0, 80));
          acquisition.failed('climate', String(error?.message ?? 'The climate request threw and reported no message'), 'climate-data-service');
        }
      } else {
        acquisition.skipped('climate', 'No verified coordinate was resolved, and SILO is read by grid cell', 'climate-data-service');
      }

      // Regional trends (the SA2's measured population series and growth)
      // are likewise coordinate-keyed: the service resolves the containing
      // SA2 and serves its own ERP series.
      if (regionalRequest) {
        try {
          const regionalResponse = await regionalRequest;
          if (regionalResponse.ok) {
            const regionalBody = await regionalResponse.json();
            if (regionalBody.success && regionalBody.data) {
              enhancedData = { ...enhancedData, regionalTrends: regionalBody.data };
              console.log('✓ Regional trends fetched (SA2):', regionalBody.data?.sa2?.name);
            }
          }
        } catch (error: any) {
          console.log('⚠️ Regional trends skipped:', error?.message?.substring(0, 80));
        }
      }

      // QLD's crime register is LGA-keyed and the phase-1 crime call ran
      // before any LGA was known — so once the cadastre has named the shire,
      // ask again with it. NSW resolves in phase 1 by postcode; this second
      // ask exists only for the LGA-keyed register.
      const qldLga = enhancedData.planningData?.parcel?.status === 'ok'
        ? enhancedData.planningData?.parcel?.lga
        : null;
      if (!enhancedData.crimeStatistics && state === 'QLD' && qldLga) {
        try {
          const crimeResponse = await acquisitionFetch(`${supabaseUrl}/functions/v1/crime-statistics-service`, {
            method: 'POST',
            headers,
            // RF-7.2B.1B1 — the LGA is QLD's own published grain and comes from
            // the cadastre, which keys on the verified coordinate, so this path
            // is not a cross-grain substitution and is reachable only once the
            // geography has resolved. The postcode travelling beside it is
            // still the authoritative one rather than the free-text parse.
            body: JSON.stringify({
              suburb, state, postcode: crimeAuthority.postcode, lga: qldLga,
            })
          }, 20000, 'crime-statistics-service');
          if (crimeResponse.ok) {
            const crimeBody = await crimeResponse.json();
            if (crimeBody.success && crimeBody.data) {
              enhancedData = { ...enhancedData, crimeStatistics: crimeBody.data };
              console.log('✓ QLD crime statistics fetched via cadastre LGA:', qldLga);
            }
          }
        } catch (error: any) {
          console.log('⚠️ QLD crime retry skipped:', error?.message?.substring(0, 80));
        }
      }

      // ======================================================================
      // MARKET EVIDENCE FOR THE GRADE — keyed on the trusted geography only
      // ======================================================================
      // Scoring V2 (ME-8) grades on measured suburb evidence: Domain's suburb
      // performance series (median sold price by year → the growth horizons,
      // plus days on market, sales and listings) and the ABS resident
      // population series the regional service already served for the
      // property's SA2. Both are asked for the SUBJECT the boundary service
      // resolved, never for the typed suburb or the parsed postcode — the
      // same rule the crime evidence answers to — so where the geography did
      // not resolve, no evidence is sought and the grade says why.
      const marketPoints: Record<string, unknown> = {};
      const providersConsulted: string[] = [];
      const providersUnavailable: Array<{ provider: string; reason: string }> = [];
      let evidenceWithheldReason: string | null = null;
      if (!isAreaReport) {
        if (domainRequest) {
          providersConsulted.push('domain');
          try {
            const domainResponse = await domainRequest;
            const domainBody = domainResponse.ok ? await domainResponse.json() : null;
            if (domainBody?.success && domainBody.data) {
              enhancedData = { ...enhancedData, domainData: domainBody.data };
              const points = domainBody.data.evidence?.points;
              if (points && typeof points === 'object') Object.assign(marketPoints, points);
              console.log(`✓ Domain suburb performance for ${marketSuburb} ${marketState} ${marketPostcode}: ${Object.keys(points ?? {}).length} evidence points`);
            } else {
              const reason = domainBody?.refusal?.summary
                ?? domainBody?.error
                ?? `HTTP ${domainResponse.status} from domain-data-service`;
              providersUnavailable.push({ provider: 'domain', reason });
              console.log(`⚠️ Domain suburb performance unavailable: ${reason}`);
            }
          } catch (error: any) {
            providersUnavailable.push({ provider: 'domain', reason: error?.message || 'request failed' });
            console.log('⚠️ Domain suburb performance skipped:', error?.message?.substring(0, 120));
          }
        } else {
          evidenceWithheldReason = 'the property\'s geography did not resolve to a trusted suburb, state and postcode, so no suburb market evidence was sought';
          console.log(`⛔ Market evidence not sought: ${evidenceWithheldReason}`);
        }

        // Open-data sales registers — the zero-cost growth stack
        // (docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md). Queensland's register
        // is keyed by local government area, which the cadastre names for
        // the verified coordinate; New South Wales's by postcode, which the
        // boundary service resolved. Nothing is asked for a typed suburb or a
        // parsed token — the rule Domain and the crime evidence answer to.
        // Where Domain also answered, the finer point wins per measure
        // (`mergeEvidence`), so a suburb series outranks a council one.
        // Every source the state has, finest grain first (`salesRegisterSourcesFor`):
        // a suburb series for Victoria and South Australia, a council series
        // for Queensland, a postcode series for New South Wales, and beneath
        // all of them the ABS state series — read only where nothing finer
        // answered, so the floor never displaces a real local reading and a
        // Queensland or New South Wales report reads exactly as before.
        const registerSources = salesRegisterSourcesFor(marketState);
        if (registerSources.length) {
          const cadastreLga = enhancedData.planningData?.parcel?.status === 'ok'
            && typeof enhancedData.planningData?.parcel?.lga === 'string'
            ? enhancedData.planningData.parcel.lga.trim() : '';
          const registerSubject: EvidenceSubject = {
            suburb: marketSuburb,
            postcode: marketPostcode,
            state: marketState,
            dwellingType: dwellingTypeFor(effectivePropertyType),
            resolvedFrom: marketPostcode ? 'coordinate' : null,
          };
          let registerAnswered = false;
          for (const registerSource of registerSources) {
            if (registerAnswered) break;
            // The area each grain is asked for comes from the trusted geography
            // or the cadastre — never a typed suburb or a parsed token.
            const area = registerSource.areaKind === 'suburb' ? marketSuburb
              : registerSource.areaKind === 'lga' ? cadastreLga
              : registerSource.areaKind === 'postcode' ? marketPostcode
              : marketState;
            providersConsulted.push(registerSource.provider);
            if (!area) {
              providersUnavailable.push({
                provider: registerSource.provider,
                reason: registerSource.areaKind === 'suburb' ? 'the geography resolved to no suburb'
                  : registerSource.areaKind === 'lga' ? 'the cadastre named no local government area for the verified coordinate'
                  : registerSource.areaKind === 'postcode' ? 'the geography resolved to no postal area'
                  : 'the geography resolved to no state',
              });
              continue;
            }
            const registerNotes: string[] = [];
            try {
              const register = await readSalesRegister(supabase, { state: marketState as SalesRegisterState, areaKind: registerSource.areaKind, area });
              if (!register.rows.length) {
                registerNotes.push(`the register holds no rows for ${registerSource.areaKind} ${area} (load it with market-sales-ingest)`);
              } else {
                const answer = openDataSalesPoints({
                  subject: registerSubject,
                  askedDwelling: dwellingTypeFor(effectivePropertyType),
                  areaKind: registerSource.areaKind,
                  area: register.areaLabel ?? area,
                  rows: register.rows,
                  benchmarkRows: register.benchmarkRows,
                  nationalRows: register.nationalRows,
                  source: registerSource,
                });
                if (!Object.keys(answer.points).length) {
                  registerNotes.push(...answer.notes);
                } else {
                  // Merge per measure: a finer, dwelling-matched point wins,
                  // whichever provider it came from.
                  const held = Object.assign(emptyEvidence(registerSubject), marketPoints) as MarketEvidence;
                  const offered = Object.assign(emptyEvidence(registerSubject), answer.points) as MarketEvidence;
                  const merged = mergeEvidence(registerSubject, [held, offered]) as unknown as Record<string, unknown>;
                  for (const key of EVIDENCE_KEYS) {
                    if (merged[key] !== undefined) marketPoints[key] = merged[key];
                  }
                  evidenceWithheldReason = null;
                  registerAnswered = true;
                  console.log(
                    `✓ Open-data sales register (${registerSource.provider}) for ${registerSource.areaKind} ${register.areaLabel ?? area}: `
                    + `${Object.keys(answer.points).length} evidence points to ${answer.latestPeriod}`
                    + (answer.dwellingTypeMatched ? '' : ' (dwelling type not matched)')
                    + (register.capturedAt ? ` (archive capture ${register.capturedAt.slice(0, 10)})` : ''),
                  );
                }
              }
            } catch (error: any) {
              registerNotes.push(`${registerSource.areaKind} ${area}: ${error?.message || 'register read failed'}`);
            }
            if (!registerAnswered) {
              providersUnavailable.push({ provider: registerSource.provider, reason: registerNotes.join('; ') || 'no register series answered' });
              console.log(`⚠️ Open-data sales register (${registerSource.provider}) unavailable: ${registerNotes.join('; ')}`);
            }
          }
        }

        // Population growth — a demand DRIVER — from the SA2 series the
        // regional service served for the verified coordinate. Nothing new is
        // fetched; the point is computed from the series already held.
        const regionalPopulation = enhancedData.regionalTrends?.population;
        const regionalSa2 = enhancedData.regionalTrends?.sa2;
        const erpSeries = Array.isArray(regionalPopulation?.series) ? regionalPopulation.series : null;
        if (erpSeries && typeof regionalSa2?.name === 'string' && regionalSa2.name) {
          providersConsulted.push('abs_erp');
          const populationPoint = populationGrowthPoint(erpSeries, { name: regionalSa2.name, level: 'sa2' });
          if (populationPoint) {
            marketPoints.populationGrowth = populationPoint;
            console.log(`✓ Population growth point for SA2 ${regionalSa2.name}: ${populationPoint.value}% p.a.`);
          } else {
            providersUnavailable.push({ provider: 'abs_erp', reason: `the ABS series for SA2 ${regionalSa2.name} is too short to compute a growth rate` });
          }
        } else if (!isAreaReport) {
          providersUnavailable.push({ provider: 'abs_erp', reason: 'no SA2 population series was served for the verified coordinate' });
        }

        /*
         * The suburb's own rent and vacancy — the MARKET's, not the subject's.
         *
         * `sqm-rent-service` has always answered with three figures and this
         * generator read one of them, conditionally: the call was made only
         * where the operator supplied no rent, and the answer stood in for the
         * SUBJECT'S rent. `vacancyRate` was dropped on every call, and nothing
         * anywhere assigned `evidence.medianRent`.
         *
         * Both cost real points. Vacancy is 0.30 of the Demand dimension — its
         * largest component — and the suburb median rent is the denominator
         * `scoreIncomeAdvantage` needs; without it the income dimension falls
         * back to a declared national frontier that does not describe a Sydney
         * market. See `rentalMarketEvidence.pure.ts` for the measurement.
         *
         * It is asked unconditionally, because it is evidence about the MARKET
         * and whether the operator typed a rent has no bearing on whether the
         * market published one. The service is cache-first
         * (`median_rent_cache`), so a second look inside one run is a cache
         * read rather than a second scrape.
         *
         * `SUPABASE_ANON_KEY` is read here rather than reused: the generator's
         * other copies are declared inside blocks that do not contain this one,
         * and reaching for one of those is the scoping fault that served 23
         * consecutive 500s on 19 Sep (`INVESTMENT_REPORT_RESUME.md` §7).
         */
        if (marketSuburb && marketState) {
          providersConsulted.push('sqm_research');
          try {
            const rentAnonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
            const rentMarketResponse = await acquisitionFetch(
              `${Deno.env.get('SUPABASE_URL')}/functions/v1/sqm-rent-service`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${rentAnonKey}`,
                  'x-internal-edge-secret': INTERNAL_EDGE_SECRET,
                  ...(rentAnonKey ? { 'apikey': rentAnonKey } : {}),
                },
                body: JSON.stringify({
                  suburb: marketSuburb.replace(/-/g, ' '),
                  state: marketState,
                  postcode: marketPostcode || '',
                  propertyType: (effectivePropertyType || 'house').toLowerCase(),
                  bedrooms: modelledBeds,
                }),
              },
              'register',
              'sqm-rent-service',
            );
            if (rentMarketResponse.ok) {
              const rentBody = await rentMarketResponse.json();
              const rentProjected = rentalMarketEvidence(
                rentBody?.success ? rentBody.data : null,
                {
                  suburb: marketSuburb,
                  postcode: marketPostcode,
                  state: marketState,
                  dwellingType: dwellingTypeFor(effectivePropertyType),
                  resolvedFrom: marketPostcode ? 'coordinate' : null,
                },
                new Date(),
              );
              for (const [rentKey, rentPoint] of Object.entries(rentProjected.points)) {
                if (rentPoint) marketPoints[rentKey] = rentPoint;
              }
              if (rentProjected.missing.length) {
                providersUnavailable.push({ provider: 'sqm_research', reason: rentProjected.missing.join('; ') });
              }
              console.log(
                `✓ Rental market evidence: rent ${rentProjected.points.medianRent ? `$${rentProjected.points.medianRent.value}` : 'none'}`
                + `, vacancy ${rentProjected.points.vacancyRate ? `${rentProjected.points.vacancyRate.value}%` : 'none'}`,
              );
            } else {
              providersUnavailable.push({ provider: 'sqm_research', reason: `the rental market service answered ${rentMarketResponse.status}` });
            }
          } catch (error: any) {
            // Never fails the report: the evidence is absent and says so.
            providersUnavailable.push({
              provider: 'sqm_research',
              reason: `the rental market service could not be reached: ${error?.message || 'unknown error'}`,
            });
          }
        }
      }

      /*
       * The evidence is RECORDED before it is scored.
       *
       * `marketPoints` used to exist only as an argument to the scoring call,
       * so it survived nowhere: not on the row, not for the resume worker, and
       * not for the prose. Two consequences followed — the market discussion
       * had no figures and supplied its own, and a report resumed after the
       * enrichment block had run could not have got them even if it looked.
       *
       * Stored before the scoring fetch rather than after it, because a
       * scoring failure must not take the evidence with it: what was measured
       * was measured whether or not a grade came back.
       */
      enhancedData = {
        ...enhancedData,
        marketEvidence: { points: marketPoints, providersConsulted, providersUnavailable },
      };

      // Calculate investment score - property OR area scoring
      if (!isAreaReport && effectivePurchasePrice > 0) {
        // Property-specific scoring
        try {
          console.log('📊 Investment scoring inputs (using effective values):');
          console.log(`  Price: $${effectivePurchasePrice.toLocaleString()}`);
          console.log(`  Weekly Rent: $${effectiveWeeklyRent}`);
          
          const scoreResponse = await acquisitionFetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/investment-scoring-service`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${INTERNAL_EDGE_SECRET}`,
              ...(supabaseAnonKey ? { 'apikey': supabaseAnonKey } : {})
            },
            body: JSON.stringify({
              property: {
                price: effectivePurchasePrice,
                // The scorer derives a yield from this, so handing it 0 for a
                // property whose rent came from the market lookup scored it as
                // earning nothing. Same resolution the calculator used —
                // `financials.income.weeklyRent` is the exact rental input
                // every projection describes. (Declared inline rather than
                // hoisting `rentalEvidence` up here: this handler already has
                // a documented TDZ trap from a const declared further down.)
                weeklyRent: effectiveWeeklyRent
                  || toFiniteNumber(enhancedData.financials?.income?.weeklyRent)
                  || 0,
                propertyType: effectivePropertyType,
                bedrooms: modelledBeds,
                bathrooms: modelledBaths
              },
              demographics: enhancedData.demographics,
              locationIntelligence: enhancedData.locationIntelligence,
              financials: enhancedData.financials,
              // ME-8 — what Scoring V2 grades on: the subject the evidence was
              // keyed to, and the evidence points the adapters extracted.
              subject: {
                suburb: marketSuburb,
                postcode: marketPostcode,
                state: marketState ?? state,
                dwellingType: dwellingTypeFor(effectivePropertyType),
                resolvedFrom: marketPostcode ? 'coordinate' : null,
              },
              marketEvidence: { points: marketPoints, providersConsulted, providersUnavailable },
              evidenceWithheldReason,
              // IPV-1.1.0 — the subject the location enrichment was acquired
              // for (RF-7.2B), restated so the scoring service can check the
              // enrichment's acquisition stamp names THIS property before
              // Location's inputs may count. The service derives the
              // verification itself; nothing here asserts trust.
              locationSubject: enrichmentSubject,
            })
          }, 'local', 'investment-scoring-service');
          
          if (scoreResponse.ok) {
            const scoreData = await scoreResponse.json();
            if (scoreData?.success && scoreData?.data) {
              enhancedData = { ...enhancedData, investmentScore: scoreData.data };
              console.log('✓ Investment score calculated:', scoreData.data?.grade ?? 'withheld', scoreData.data?.totalScore ?? '');
              if (Array.isArray(scoreData.data?.gradeGaps) && scoreData.data.gradeGaps.length) {
                console.log('  Grade gaps:', scoreData.data.gradeGaps.map((g: any) => `${g.dimension}: ${g.detail}`).join(' | '));
              }
              // A WITHHELD grade is an answer, not a failure: the engine ran,
              // measured what it could and declined to publish a letter. The
              // ledger records the attempt; the withholding is the scoring
              // policy's own reading and is published separately.
              acquisition.answered('investmentScore', 'Scored by the investment scoring service', 'investment-scoring-service');
            } else if (scoreData) {
              enhancedData = { ...enhancedData, investmentScore: scoreData };
              console.log('✓ Investment score (direct):', scoreData?.grade, scoreData?.totalScore);
              acquisition.answered('investmentScore', 'Scored by the investment scoring service', 'investment-scoring-service');
            } else {
              acquisition.empty('investmentScore', 'The scoring service answered with no body', 'investment-scoring-service');
            }
          } else {
            const errorText = await scoreResponse.text();
            console.error('❌ Investment scoring service error:', scoreResponse.status, errorText);
            acquisition.failed('investmentScore', `investment-scoring-service answered HTTP ${scoreResponse.status}: ${String(errorText).slice(0, 200)}`, 'investment-scoring-service');
          }
        } catch (error: any) {
          console.error('❌ Investment score calculation failed:', error?.message || 'Unknown error');
          acquisition.failed('investmentScore', String(error?.message ?? 'The scoring request threw and reported no message'), 'investment-scoring-service');
        }
      } else if (isAreaReport) {
        // Area-level scoring (suburb/postcode/statewide)
        // `reportScope` IS the request's `queryType` — L2344 reads
        // `propertyDetails?.queryType` into it, and `isAreaReport` is derived
        // from it one line later. `queryType` is not a binding in this
        // function, so this branch threw a ReferenceError on every suburb,
        // postcode and statewide report.
        const areaScope = reportScope === 'suburb' ? 'suburb' : reportScope === 'zipcode' ? 'zipcode' : 'state';
        console.log(`📊 Area scoring for scope: ${areaScope} (isAreaReport: ${isAreaReport}, reportScope: ${reportScope})`);
        console.log(`📊 Area scoring input data - demographics keys: ${Object.keys(enhancedData.demographics || {}).join(', ') || 'NONE'}`);
        console.log(`📊 Area scoring input data - locationIntelligence keys: ${Object.keys(enhancedData.locationIntelligence || {}).join(', ') || 'NONE'}`);
        
        let areaScoreCalculated = false;
        
        // Try service call first
        try {
          const scoreResponse = await acquisitionFetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/investment-scoring-service`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${INTERNAL_EDGE_SECRET}`,
              ...(supabaseAnonKey ? { 'apikey': supabaseAnonKey } : {})
            },
            body: JSON.stringify({
              scope: areaScope,
              demographics: enhancedData.demographics || {},
              locationIntelligence: enhancedData.locationIntelligence || {},
              state: state || undefined
            })
          }, 'local', 'investment-scoring-service');
          
          console.log(`📊 Area scoring service response status: ${scoreResponse.status}`);
          
          if (scoreResponse.ok) {
            const scoreData = await scoreResponse.json();
            console.log(`📊 Area scoring response: success=${scoreData?.success}, hasData=${!!scoreData?.data}, grade=${scoreData?.data?.grade}`);
            if (scoreData?.success && scoreData?.data) {
              enhancedData = { ...enhancedData, investmentScore: scoreData.data };
              areaScoreCalculated = true;
              console.log('✓ Area score calculated via service:', scoreData.data?.grade, scoreData.data?.totalScore);
              acquisition.answered('investmentScore', 'Scored by the investment scoring service', 'investment-scoring-service');
            }
          } else {
            const errorText = await scoreResponse.text();
            console.error('❌ Area scoring service error:', scoreResponse.status, errorText);
            acquisition.failed('investmentScore', `investment-scoring-service answered HTTP ${scoreResponse.status}: ${String(errorText).slice(0, 200)}`, 'investment-scoring-service');
          }
        } catch (error: any) {
          console.error('❌ Area scoring service call failed:', error?.message || 'Unknown error');
          acquisition.failed('investmentScore', String(error?.message ?? 'The scoring request threw and reported no message'), 'investment-scoring-service');
        }
        
        // FALLBACK: Calculate area score inline if service call failed
        if (!areaScoreCalculated) {
          console.log('📊 Falling back to inline area scoring calculation...');
          try {
            const demographics = enhancedData.demographics || {};
            const locationIntelligence = enhancedData.locationIntelligence || {};
            const marketData = demographics.marketData || {};
            
            // Simple inline area scoring
            let totalScore = 50; // Base score
            const factors: string[] = [];
            const strengths: string[] = [];
            const weaknesses: string[] = [];
            
            // Market momentum (30%)
            let marketScore = 50;
            if (marketData.priceGrowth1Year > 5) { marketScore += 20; strengths.push('Strong price growth'); }
            else if (marketData.priceGrowth1Year < 0) { marketScore -= 20; weaknesses.push('Declining prices'); }
            if (marketData.daysOnMarket < 30) { marketScore += 10; strengths.push('Fast-selling market'); }
            
            // Economic strength (25%)
            let economicScore = 50;
            if (demographics.unemploymentRate < 4) { economicScore += 15; strengths.push('Low unemployment'); }
            else if (demographics.unemploymentRate > 7) { economicScore -= 15; weaknesses.push('High unemployment'); }
            if (demographics.populationGrowth > 1.5) { economicScore += 10; strengths.push('Growing population'); }
            
            // Livability (15%)
            let livabilityScore = 50;
            if (locationIntelligence.walkScore > 70) { livabilityScore += 20; strengths.push('High walkability'); }
            
            // Rental market (15%)
            let rentalScore = 50;
            if (marketData.vacancyRate < 2) { rentalScore += 20; strengths.push('Tight rental market'); }
            else if (marketData.vacancyRate > 5) { rentalScore -= 15; weaknesses.push('High vacancy rate'); }
            
            // Future outlook (15%)
            let futureScore = 50;
            
            totalScore = Math.round(
              marketScore * 0.30 + economicScore * 0.25 + livabilityScore * 0.15 + rentalScore * 0.15 + futureScore * 0.15
            );
            totalScore = Math.max(0, Math.min(100, totalScore));
            
            // Determine grade
            let grade = 'C';
            let recommendation = 'HOLD';
            if (totalScore >= 80) { grade = 'A'; recommendation = 'PRIME SUBURB'; }
            else if (totalScore >= 70) { grade = 'B+'; recommendation = 'STRONG AREA'; }
            else if (totalScore >= 60) { grade = 'B'; recommendation = 'SOLID AREA'; }
            else if (totalScore >= 50) { grade = 'C+'; recommendation = 'HOLD'; }
            else if (totalScore >= 40) { grade = 'C'; recommendation = 'MONITOR'; }
            else { grade = 'D'; recommendation = 'CAUTION'; }
            
            enhancedData = {
              ...enhancedData,
              investmentScore: {
                totalScore,
                grade,
                recommendation,
                scoreType: 'area',
                scope: areaScope,
                breakdown: {
                  marketMomentum: { score: marketScore, weight: 30, details: 'Inline calculation' },
                  economicStrength: { score: economicScore, weight: 25, details: 'Inline calculation' },
                  livability: { score: livabilityScore, weight: 15, details: 'Inline calculation' },
                  rentalMarket: { score: rentalScore, weight: 15, details: 'Inline calculation' },
                  futureOutlook: { score: futureScore, weight: 15, details: 'Inline calculation' },
                },
                strengths,
                weaknesses,
                opportunities: [],
                risks: [],
              }
            };
            console.log('✓ Inline area score calculated:', grade, totalScore);
          } catch (inlineError: any) {
            console.error('❌ Inline area scoring also failed:', inlineError?.message);
          }
        }
        
        console.log(`📊 Final investmentScore after area scoring: ${enhancedData.investmentScore ? 'SET' : 'NULL'} (grade: ${enhancedData.investmentScore?.grade || 'N/A'})`);
      }

      // NOTE: SEIFA, Crime, Employment, and Climate data are now fetched in Phase 1 parallel block above

      // Fetch school data
      if (suburb && state && postcode && !alreadyHeld('schoolData')) {
        try {
          console.log('Fetching school data for:', suburb, state, postcode);
          
          // Extract coordinates from location intelligence if available
          const latitude = enhancedData.locationIntelligence?.coordinates?.lat;
          const longitude = enhancedData.locationIntelligence?.coordinates?.lng;
          
          const schoolResponse = await acquisitionFetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/school-data-service`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${INTERNAL_EDGE_SECRET}`,
              ...(supabaseAnonKey ? { 'apikey': supabaseAnonKey } : {})
            },
            body: JSON.stringify({ 
              suburb: suburb,
              state: state,
              postcode: postcode,
              latitude: latitude || undefined,
              longitude: longitude || undefined
            })
          }, 'register', 'school-data-service');
          
          if (schoolResponse.ok) {
            const schoolData = await schoolResponse.json();
            if (schoolData.success && schoolData.data) {
              enhancedData = { ...enhancedData, schoolData: schoolData.data };
              console.log('✓ School data fetched successfully');
              console.log(`  Found ${schoolData.data.summary?.totalSchools || 0} schools in ${postcode}`);
            }
          }
        } catch (error: any) {
          console.log('School data fetch failed:', error?.message || 'Unknown error');
        }
      }


    } catch (error: any) {
      console.log('Enhanced data fetch failed, proceeding with basic analysis:', error?.message || 'Unknown error');
    }

    // ── The measurement this incident needed and did not have ──────────────
    //
    // `traceStartRun` is called AFTER this block, so `report_generation_runs`
    // has never once included the acquisition phase in its own clock. That is
    // why "21 minutes at 0 of 15" could not be attributed to anything from the
    // record: the only phase that could have consumed the invocation was the
    // one phase nothing timed.
    //
    // One structured line, greppable in the edge logs, costing nothing. It is
    // deliberately a log and not a column: the run trace's schema is a contract
    // with its own readers, and a number nobody has asked to store does not
    // earn a migration.
    // The reuse provenance goes in LAST. `AcquisitionRecorder` is
    // last-write-wins and a reused dependency still passes its own call site,
    // which records a skip — so writing it here is what makes the ledger say
    // the true thing: this report acquired it, for this subject, earlier.
    if (reusePlan) {
      for (const entry of reusePlan.entries) {
        if (!entry.decision.reuse) continue;
        acquisition.record({
          producer: entry.producer,
          outcome: 'answered',
          detail:
            "Reused from this report's own earlier invocation, acquired "
            + `${entry.decision.ageHours.toFixed(1)}h ago for the same subject`,
          service: 'acquisition-reuse',
        });
      }
    }

    const acquisitionMs = Date.now() - runStartedAt;
    console.log(
      `⏱️ acquisition finished at +${(acquisitionMs / 1000).toFixed(1)}s of the run's `
      + `${Math.round(SECTION_CALL_HARD_STOP_MS / 1000)}s budget · `
      + `${isContinuation ? 'continuation' : 'first invocation'}`
      + (acquisitionExhaustedThisRun
        ? ' · SOME CALLS DEFERRED for want of a window — not recorded as absences'
        : '')
    );

    // ========================================================================
    // RF-7.2B.1 — CLIENT-SAFE GATE ACTIVATION
    // ========================================================================
    // Everything below this line reads gated facts. The gate sits HERE, on the
    // object, rather than at each of the four base prompts, because a fact that
    // is not on `enhancedData` cannot reach a prompt that interpolates
    // `enhancedData` — whichever prompt it is, and however it is written later.
    //
    // It is deliberately placed AFTER the scoring calls above: the investment
    // score engine reads `walkScore`, `commute.durationMinutes` and
    // `schools.schoolsWithin3km`, and re-pointing it would silently move every
    // new report's score. That belongs to the scoring programme, not here.
    //
    // From this point the sanitised object is what the prompts compose from AND
    // what is persisted, so the stored report snapshot carries no disowned fact
    // either.
    //
    // The subject's TRUSTED geography, for the postal-area cross-check: a real
    // ABS retrieval for POA 3338 is authoritative about somebody else's suburb
    // if this property sits in 3024. The point-in-polygon resolution is the
    // platform's authority on that; the address-derived postcode this function
    // computed is not, which is the whole reason the check exists.
    //
    // `subjectGeography` is normally resolved during THIS run, from the
    // verified coordinate, immediately after location intelligence — see the
    // pre-generation block above. The stored-row read below is the fallback for
    // the one case that block cannot cover: a run where the resolution itself
    // failed (transport, or a coordinate that was never verified). Reading a
    // row an earlier sweep wrote is the behaviour this function already had, so
    // the fallback cannot make a report worse than it was.
    if (subjectGeography === null && reportId && supabaseClient) {
      const { data: geoRow, error: geoError } = await supabaseClient
        .from('report_geography')
        .select('postcode, status, suburb, state')
        .eq('report_id', reportId)
        .maybeSingle();
      if (geoError) {
        console.log(`⚠️ report_geography read failed (${geoError.message}) — area statistics will fail closed.`);
      } else if (geoRow) {
        subjectGeography = geoRow as Record<string, unknown>;
        geographyResolution = {
          ...geographyResolution, source: 'stored_row', status: String(geoRow.status ?? 'unknown'),
        };
      }
    }

    const safeGeneration = activateSafeGenerationInputs({
      enhancedData,
      geography: subjectGeography,
      geographyProvenance: {
        source: geographyResolution.source,
        status: geographyResolution.status,
        absRequeried: geographyResolution.requeried,
      },
      cashRateTarget: (enhancedData as any)?.economics?.cashRateTarget ?? null,
      cashRateMonthlyAverage: null,
      capturedAt: new Date().toISOString(),
    });
    // Kept BEFORE the assignment below: `safeGeneration.enhancedData` is the
    // narrative input, and from here on `enhancedData.locationIntelligence` is
    // missing the three readings the scorer needs. See the declaration.
    measuredLocationIntelligence = enhancedData.locationIntelligence ?? null;
    enhancedData = safeGeneration.enhancedData as typeof enhancedData;
    const removedForNarrative = safeGeneration.removed.filter((r) => r.hadValue);
    console.log(
      `🛡️ Client-Safe Gate active (${safeGeneration.snapshot.assuranceVersion}) — `
      + `${removedForNarrative.length} disowned fact(s) withheld from the narrative`
      + (removedForNarrative.length ? `: ${removedForNarrative.map((r) => r.path).join(', ')}` : '')
      + `; demographics ${safeGeneration.demographicsKept ? 'retained' : 'withheld'}.`,
    );

    // ============================================================================
    // DATA AVAILABILITY SUMMARY - Graceful Degradation Report
    // ============================================================================
    const dataAvailability = {
      demographics: !!enhancedData.demographics,
      economics: !!enhancedData.economics,
      financials: !!enhancedData.financials,
      locationIntelligence: !!enhancedData.locationIntelligence,
      investmentScore: !!enhancedData.investmentScore,
      domainData: !!enhancedData.domainData,
      riskAssessment: !!enhancedData.riskAssessment,
      seifaData: !!enhancedData.seifaData,
      crimeStatistics: !!enhancedData.crimeStatistics,
      employmentData: !!enhancedData.employmentData,
      climateData: !!enhancedData.climateData,
      schoolData: !!enhancedData.schoolData
    };
    
    const availableServices = Object.entries(dataAvailability).filter(([_, v]) => v).map(([k]) => k);
    const unavailableServices = Object.entries(dataAvailability).filter(([_, v]) => !v).map(([k]) => k);
    
    console.log('\n📊 === DATA AVAILABILITY SUMMARY ===');
    console.log(`✅ Available (${availableServices.length}): ${availableServices.join(', ') || 'None'}`);
    console.log(`⚠️ Unavailable (${unavailableServices.length}): ${unavailableServices.join(', ') || 'None'}`);
    console.log(`📈 Data completeness: ${Math.round((availableServices.length / 12) * 100)}%`);
    
    // Circuit breaker status
    if (circuitBreaker.size > 0) {
      console.log('🔴 Circuit breakers active:', Array.from(circuitBreaker.keys()).join(', '));
    }
    console.log('=================================\n');

    // Build year context string for suburb analysis
    let yearContextString = '';
    if (propertyDetails?.dataYearType === 'single' && propertyDetails?.dataYear) {
      yearContextString = `\n\n**CRITICAL DATA YEAR REQUIREMENT:**
Focus the analysis on data from the year ${propertyDetails.dataYear}. All statistics, market data, demographics, and trends should be sourced from or reference ${propertyDetails.dataYear} data where available. Clearly indicate when data from ${propertyDetails.dataYear} is used vs. when more recent or older data is substituted.`;
      console.log('📅 Single year context:', propertyDetails.dataYear);
    } else if (propertyDetails?.dataYearType === 'range' && propertyDetails?.dataYearStart && propertyDetails?.dataYearEnd) {
      yearContextString = `\n\n**CRITICAL DATA YEAR RANGE REQUIREMENT:**
Analyze trends and data spanning from ${propertyDetails.dataYearStart} to ${propertyDetails.dataYearEnd}. 
- Include year-over-year comparisons across this period
- Show growth/decline trends from ${propertyDetails.dataYearStart} to ${propertyDetails.dataYearEnd}
- Compare early period (${propertyDetails.dataYearStart}-${Math.floor((propertyDetails.dataYearStart + propertyDetails.dataYearEnd) / 2)}) vs. recent period (${Math.ceil((propertyDetails.dataYearStart + propertyDetails.dataYearEnd) / 2)}-${propertyDetails.dataYearEnd})
- Clearly label data sources with their respective years
- Highlight significant changes or inflection points within the ${propertyDetails.dataYearEnd - propertyDetails.dataYearStart + 1}-year period`;
      console.log('📅 Year range context:', propertyDetails.dataYearStart, '-', propertyDetails.dataYearEnd);
    }

    // Create enhanced prompt with additional data
    // Suburb-specific prompt for suburb investment analysis
    const suburbPrompt = `You are an expert Australian suburb analyst creating comprehensive suburb investment snapshots.
Your goal is to generate a professional suburb-level investment analysis report.

**SUBURB TO ANALYZE: ${formattedInput}**
${yearContextString}

${propertyDetails ? `Context: ${propertyDetails.propertyType || 'Property'} analysis in this suburb${propertyDetails.landSizeSqm ? `, typical land size: ${propertyDetails.landSizeSqm}m²` : ''}${propertyDetails.buildSizeSqm ? `, typical build size: ${propertyDetails.buildSizeSqm}m²` : ''}` : ''}

**CRITICAL - MANDATORY SUBURB REPORT STRUCTURE:**

Follow this exact structure for suburb-level analysis:

# REPORT TITLE
Suburb Investment Snapshot: [SUBURB NAME], [STATE]

# 1. Location & Profile
- Suburb overview and character
- Distance to CBD/major employment centers (e.g., "12km north of Sydney CBD")
- Statistical areas: SA2, SA3, SA4, LGA
- Suburb type (beachside, urban, suburban, regional)
- Lifestyle description
- Key attractions and features
- Development status and trends

# 2. Property Market Data
**Current Market Snapshot (use most recent data):**

| Property Type | Median Price | Median Rent (Weekly) | Gross Yield | Annual Growth |
|--------------|--------------|---------------------|-------------|---------------|
| Houses | $XXX,XXX | $XXX | X.XX% | +/-X.X% |
| Units | $XXX,XXX | $XXX | X.XX% | +/-X.X% |

**Market Activity:**
| Metric | Houses | Units |
|--------|---------|-------|
| Sales Volume (12 months) | XX | XX |
| Days on Market | XX | XX |
| Stock on Market | XX | XX |
| Vacancy Rate | X.X% | X.X% |

# 3. Market Performance
**5-Year Price Growth:**
| Property Type | 1-Year | 3-Year | 5-Year | Peak Growth Period |
|--------------|--------|--------|--------|-------------------|
| Houses | +/-X.X% | +/-XX.X% | +/-XX.X% | [period] |
| Units | +/-X.X% | +/-XX.X% | +/-XX.X% | [period] |

**Rental Growth History:**
| Property Type | 1-Year | 3-Year | 5-Year |
|--------------|--------|--------|--------|
| Houses | +/-X.X% | +/-XX.X% | +/-XX.X% |
| Units | +/-X.X% | +/-XX.X% | +/-XX.X% |

[Include market cycle analysis and trends]

# 4. Demographics

${demographicsStatBlocks(enhancedData)}

${regionalTrendBlocks(enhancedData)}

# 5. Infrastructure & Amenities
**Education:**
| School Name | Type | Level | Distance | Rating/ICSEA |
|------------|------|-------|----------|--------------|

**Transport:**
| Mode | Details |
|------|---------|
| Train Stations | [names, from the measured stops above] |
| Bus Routes | [from the measured stops above] |
| Major Roads | [list] |

Do NOT state a Walk Score, an "access score", a CBD commute time or a service
frequency here. None of them is measured for this area — the walk score and
transport score were withdrawn because they described the state rather than the
address — and a scored row with no source is an invitation to invent one.

**Shopping & Services:**
| Facility Type | Nearest | Distance | Details |
|--------------|---------|----------|---------|
| Shopping Center | [name] | XXkm | [description] |
| Supermarkets | [names] | XXkm | - |
| Cafes/Restaurants | XX+ venues | within XXkm | - |

**Healthcare:**
| Facility | Name | Distance |
|----------|------|----------|
| Hospital | [name] | XXkm |
| Medical Centers | XX facilities | within XXkm |

**Recreation:**
| Facility Type | Count | Details |
|--------------|-------|---------|
| Parks | XX | [names] |
| Beaches | XX | [names] |
| Sports Facilities | XX | [types] |

# 6. Investment Insights
**Market Strengths:**
- [Key advantages for investors]
- [Growth drivers]
- [Demand factors]

**Considerations:**
- [Risks or challenges]
- [Market competition]
- [Supply dynamics]

**Buyer Profile:**
[Who typically buys here and why]

**Rental Demand:**
[Who rents here, typical lease terms, vacancy patterns]

**Capital Growth Outlook:**
[Short and medium term price expectations with reasoning]

**Rental Yield Outlook:**
[Income potential and rental growth expectations]

# 7. Environmental & Risk Factors

${climateStatBlocks(enhancedData)}

# 8. Crime & Safety

${crimeStatBlocks(enhancedData)}

---

**DATA QUALITY REQUIREMENTS:**
- Use live data where available from ABS, Domain, CoreLogic, state authorities
- Clearly mark estimated or inferred data points
- Include data sources and "as of" dates for all statistics
- Prioritize recent data (last 12 months preferred)

**OUTPUT STYLE:**
- Use markdown tables extensively for data presentation
- Include horizontal rulers (---) between major sections
- Professional, data-driven language
- Specific numbers, percentages, dollar amounts
- Actionable insights for investors
- No code blocks or JSON formatting

Produce a comprehensive suburb investment snapshot following the structure above with specific Australian market data.`;

    // ============================================================================
    // POSTCODE / ZIP CODE ANALYSIS PROMPT
    // ============================================================================
    const postcodePrompt = `You are an expert Australian property market analyst creating comprehensive postcode-zone investment analysis reports.
Your goal is to generate a professional postcode-level analysis covering all suburbs within the zone.

**POSTCODE TO ANALYZE: ${formattedInput}**
${yearContextString}

${propertyDetails ? `Context: ${propertyDetails.propertyType || 'General'} market analysis for this postcode zone` : ''}

**CRITICAL - MANDATORY POSTCODE REPORT STRUCTURE:**

Follow this exact structure for postcode-level analysis:

# REPORT TITLE
Postcode Investment Analysis: ${formattedInput}

# 1. Executive Summary
- Postcode investment thesis
- Key takeaways and overall market assessment

# 2. Zone Profile
- List of all suburbs within this postcode
- LGA(s) and geographic boundaries
- Zone character and overview

# 3. Market Overview
**Aggregated Market Data:**

| Property Type | Median Price | Annual Growth | Gross Yield | DOM |
|--------------|--------------|---------------|-------------|-----|
| Houses | $XXX,XXX | +/-X.X% | X.XX% | XX |
| Units | $XXX,XXX | +/-X.X% | X.XX% | XX |

**Market Activity:**
- Auction clearance rates
- Stock on market levels
- Sales volume trends

# 4. Suburb-by-Suburb Breakdown
| Suburb | Median House Price | Median Unit Price | Annual Growth | Gross Yield | Vacancy Rate | DOM |
|--------|-------------------|-------------------|---------------|-------------|--------------|-----|

[Include ALL suburbs in the postcode with comprehensive data]

**Standout Performers:**
- Identify top-performing suburbs with reasoning

# 5. Price Trends & Growth
**Postcode-Wide Historical Trends:**
| Period | Houses Growth | Units Growth | Metro Average | State Average |
|--------|-------------|-------------|---------------|---------------|
| 1-Year | +/-X.X% | +/-X.X% | +/-X.X% | +/-X.X% |
| 3-Year | +/-XX.X% | +/-XX.X% | +/-XX.X% | +/-XX.X% |
| 5-Year | +/-XX.X% | +/-XX.X% | +/-XX.X% | +/-XX.X% |

# 6. Rental Market
**Aggregate Rental Data:**
| Property Type | Median Weekly Rent | Annual Rent Growth | Vacancy Rate |
|--------------|-------------------|-------------------|--------------|

**Suburb-Level Yield Comparison:**
| Suburb | Median Rent | House Yield | Unit Yield |
|--------|------------|-------------|------------|

# 7. Demographics & Economics
- Population & growth across the zone
- Income & employment data
- Household profile

# 8. Infrastructure & Development
- Major projects & transport upgrades affecting this postcode
- Rezoning & development pipeline
- Impact on property values

# 9. Risk Assessment
- Zone-level hazard mapping (flood, bushfire)
- Market diversification analysis
- Crime & safety overview

# 10. Investment Score & Hotspot Identification
- Zone investment score
- Best value suburbs within the postcode (with data-driven reasoning)
- SWOT Analysis (minimum 8 bullet points per category)

# 11. Disclaimer
[Standard professional disclaimer]

---

**DATA QUALITY REQUIREMENTS:**
- Use live data where available from ABS, Domain, CoreLogic, state authorities
- Clearly mark estimated or inferred data points
- Include data sources and "as of" dates
- Compare against metro and state benchmarks throughout

**OUTPUT STYLE:**
- Use markdown tables extensively
- Include horizontal rulers (---) between major sections
- Professional, data-driven language
- Specific numbers, percentages, dollar amounts
- Actionable insights for investors
- No code blocks or JSON formatting

Produce a comprehensive postcode investment analysis following the structure above with specific Australian market data.`;

    // ============================================================================
    // STATEWIDE ANALYSIS PROMPT
    // ============================================================================
    const statewidePrompt = `You are an expert Australian property market economist creating comprehensive state-level investment analysis reports.
Your goal is to generate a professional statewide market analysis covering macro-economic conditions, regional comparisons, and investment opportunities.

**STATE TO ANALYZE: ${formattedInput}**
${yearContextString}

**CRITICAL - MANDATORY STATEWIDE REPORT STRUCTURE:**

Follow this exact structure for state-level analysis:

# REPORT TITLE
Statewide Investment Analysis: ${formattedInput}

# 1. Executive Summary
- State investment climate summary
- Key takeaways and macro assessment

# 2. State Economic Overview
**Economic Indicators:**
| Metric | Value | National Average | Trend |
|--------|-------|-----------------|-------|
| GSP/GDP Growth | X.X% | X.X% | [trend] |
| Unemployment Rate | X.X% | X.X% | [trend] |
| Population Growth | X.X% | X.X% | [trend] |
| Net Interstate Migration | +/-XX,XXX | - | [trend] |
| Net Overseas Migration | +XX,XXX | - | [trend] |

**Major Industries:**
[Top 5-10 industries by employment share]

# 3. Property Market Overview
**State-Wide Market Data:**
| Property Type | Median Price | Annual Growth | Gross Yield | DOM | Total Listings |
|--------------|--------------|---------------|-------------|-----|----------------|
| Houses | $XXX,XXX | +/-X.X% | X.XX% | XX | XX,XXX |
| Units | $XXX,XXX | +/-X.X% | X.XX% | XX | XX,XXX |

- Auction clearance rates (state average)
- Total listings volume & trend

# 4. Regional Comparison
**Metro vs Regional Performance:**
| Region | Median House Price | Annual Growth | Yield | Vacancy | Population Growth |
|--------|-------------------|---------------|-------|---------|-------------------|

**Top 10 Performing Areas:**
| Rank | Area/Suburb | Median Price | 12-Month Growth | Key Driver |
|------|------------|--------------|-----------------|------------|

**Bottom 10 Performing Areas:**
| Rank | Area/Suburb | Median Price | 12-Month Growth | Key Concern |
|------|------------|--------------|-----------------|-------------|

# 5. Price Trends & Affordability
**State Growth vs National Benchmarks:**
| Period | State Houses | State Units | National Houses | National Units |
|--------|-------------|-------------|-----------------|----------------|
| 1-Year | +/-X.X% | +/-X.X% | +/-X.X% | +/-X.X% |
| 3-Year | +/-XX.X% | +/-XX.X% | +/-XX.X% | +/-XX.X% |
| 5-Year | +/-XX.X% | +/-XX.X% | +/-XX.X% | +/-XX.X% |
| 10-Year | +/-XX.X% | +/-XX.X% | +/-XX.X% | +/-XX.X% |

**Affordability Index:**
[Housing affordability metrics, price-to-income ratios]

# 6. Rental Market
**State Vacancy Rates:**
| Region | Current Vacancy | 12-Month Ago | 5-Year Average |
|--------|----------------|-------------|----------------|

**Rental Growth by Region:**
| Region | Weekly Rent (Houses) | Annual Growth | Weekly Rent (Units) | Annual Growth |
|--------|---------------------|---------------|--------------------|----|

**Rental Yield by Region:**
| Region | House Yield | Unit Yield | State Average |
|--------|------------|------------|---------------|

# 7. Government Policy & Regulation
- Stamp duty thresholds and rates
- Land tax thresholds and rates
- First home buyer schemes and grants
- Planning reforms and zoning changes
- Foreign investment rules (if applicable)

# 8. Infrastructure Pipeline
**Major State Projects:**
| Project | Budget | Completion | Impact Region | Property Impact |
|---------|--------|------------|---------------|-----------------|

**Investment Impact Zones:**
[Areas most likely to benefit from infrastructure spending]

# 9. Risk & Macro Factors
**Interest Rate Sensitivity:**
[Impact of RBA rate changes on state market]

**Supply Pipeline Risk:**
[New housing supply vs demand balance]

**Population Growth Corridors:**
[Where population is heading and property demand implications]

# 10. Investment Hotspots
**Top Opportunity Regions/Suburbs:**
| Rank | Area | Why It's a Hotspot | Entry Price | Growth Forecast | Yield |
|------|------|-------------------|-------------|-----------------|-------|

**Hotspot Reasoning:**
[Detailed data-driven explanation for each hotspot]

**State-Level SWOT Analysis:**
- Strengths (minimum 8 points)
- Weaknesses (minimum 8 points)
- Opportunities (minimum 8 points)
- Threats (minimum 8 points)

# 11. Disclaimer
[Standard professional disclaimer]

---

**DATA QUALITY REQUIREMENTS:**
- Use live data where available from ABS, Domain, CoreLogic, state authorities, RBA
- Compare all metrics against national benchmarks
- Include data sources and "as of" dates
- Focus on macro trends and their property market implications

**OUTPUT STYLE:**
- Use markdown tables extensively for data presentation
- Include horizontal rulers (---) between major sections
- Professional, economist-level language
- Specific numbers, percentages, dollar amounts
- Actionable insights for investors
- No code blocks or JSON formatting

Produce a comprehensive statewide investment analysis following the structure above with specific Australian market data.`;

    // STRICT REFERENCE TEMPLATE - Based on the advisory's Investment Report format
    // This template enforces the exact structure, length, content, and sources matching the reference PDF
    
    // ============================================================================
    // STANDARDIZED PROPERTY TYPE - Consistent terminology throughout report
    // ============================================================================
    /*
     * The type the prompt is told, and the type the record holds, are one
     * answer.
     *
     * This read `propertyDetails?.propertyType` alone. Every Compass report is
     * finished by the resume worker, which calls back with `{reportId,
     * propertyAddress, continueFrom}` and no `propertyDetails` at all — so on
     * the run that writes the document, this was always `''`. On 262 Pallas
     * Street the operator had recorded `propertyType: 'house'`, the spec column
     * stored `"house"` and page 3 of the PDF printed it, while the model was
     * told the type was not stated and wrote a paragraph about the record not
     * stating it. `sourcePropertyType` is the one answer this module already
     * resolved (request first, then the operator's overrides).
     */
    const rawPropertyType = (typeof sourcePropertyType === 'string' ? sourcePropertyType : '').toLowerCase();
    const isStrataProperty = rawPropertyType.includes('unit') || rawPropertyType.includes('apartment') || 
                            rawPropertyType.includes('flat') || rawPropertyType.includes('townhouse') ||
                            rawPropertyType.includes('villa') || rawPropertyType.includes('studio');
    const standardizedPropertyType = isStrataProperty 
      ? (rawPropertyType.includes('apartment') ? 'Apartment' : 
         rawPropertyType.includes('townhouse') ? 'Townhouse' :
         rawPropertyType.includes('villa') ? 'Villa' :
         rawPropertyType.includes('studio') ? 'Studio Apartment' : 'Unit')
      : (rawPropertyType.includes('house') ? 'House' :
         rawPropertyType.includes('duplex') ? 'Duplex' :
         rawPropertyType || null);

    // ME-6: `'Residential Property'` is a PROSE fallback and must never become
    // the stored fact. It reads to every downstream consumer as a real value,
    // so an unknown type was written down as a plausible-looking string and
    // could not afterwards be told apart from a genuine one. Measured on the
    // trusted corpus: 204 of 867 reports carry no resolvable dwelling type
    // (`residential property` 81, `other` 28, absent 95), and only 4 of those
    // could be recovered from anywhere in the record — the rest is simply gone,
    // because the placeholder is all that was ever kept.
    //
    // Two values from here on. `resolvedPropertyType` is the FACT and is null
    // when nothing authoritative is known; `propertyTypeLabel` is for prose the
    // model reads, where a readable phrase is wanted and no fact is asserted.
    const resolvedPropertyType: string | null = standardizedPropertyType;
    // QA-22: "Residential Property" read as a fact and the later sections
    // reverted to it ("Residential Property form aligned with local housing
    // preferences") after earlier ones had named a strata townhouse from the
    // listing. Where the record holds no type, the model is told that, and
    // told to carry whatever type the documents state through every section.
    /*
     * An instruction must never occupy a value slot.
     *
     * `propertyTypeLabel` used to BE the instruction when nothing resolved, and
     * it was interpolated into `| Property Type | … |` table cells and a
     * `- Property Type: …` line. On the 17 Sep 2026 regeneration of 262 Pallas
     * Street the model did the only reasonable thing with a value it was handed
     * and quoted it back:
     *
     *   The property type is recorded as **"Not stated in the record — if the
     *   property documents name the dwelling type, use that exact type in every
     *   section, never write 'Residential Property'"**, signalling that all
     *   future references in this report will follow the formal dwelling
     *   description…
     *
     * — a prompt directive printed as a fact about somebody's house. So the
     * value slot now carries the fact or NOTHING (the row and the line are
     * omitted, per the standing rule that an absence is omitted rather than
     * worded), and the instruction lives in the rules where it always belonged.
     */
    const propertyTypeLabel = resolvedPropertyType ?? '';
    const propertyTypeRule = resolvedPropertyType
      ? `3. PROPERTY TYPE: Use the standardized property type "${resolvedPropertyType}" consistently throughout the report - never switch terminology.`
      : '3. PROPERTY TYPE: the record does not state the dwelling type. Do NOT name one, do NOT write "Residential Property", '
        + 'and do NOT print a property-type row, cell or bullet at all — leave it out with the sentence that would have carried '
        + 'it. If the property documents name the dwelling type, use that exact type in every section.';

    console.log(`🏠 Property Type Standardization: "${rawPropertyType}" → "${resolvedPropertyType ?? '(unknown — stored as null)'}" (isStrata: ${isStrataProperty})`);
    
    // ============================================================================
    // PRE-CALCULATED YIELD VALUES - Recalculated using OVERRIDDEN expense values
    // These values MUST be used exactly in the report, not recalculated by AI
    // ============================================================================
    // ONE rent, resolved once. `effectiveWeeklyRent` knows only what a person
    // typed; the market lookup lands in `financials.income.weeklyRent`, which
    // is the exact rental input every projection describes. Those were two
    // different rents in two different scopes, and the lookup could never
    // reach the document — which is how 83 stored reports came to print a
    // `0.00%` yield beside projections built on a real rent. See
    // `_shared/reports/investment/rentalEvidence.pure.ts`.
    const rentalEvidence = resolveRentalEvidence({
      overrideWeeklyRent: mergedOverrides.weeklyRent,
      listingWeeklyRent: propertyDetails?.weeklyRent,
      calculatedWeeklyRent: enhancedData.financials?.income?.weeklyRent,
      occupancyWeeks: mergedOverrides.occupancyRate,
    });
    const effectiveOccupancyRate = rentalEvidence.occupancyWeeks; // weeks per year
    // The rent every line quotes. Identical to the old `effectiveWeeklyRent`
    // wherever one was typed or carried, so a report with rental evidence is
    // unchanged to the digit.
    const quotedWeeklyRent = rentalEvidence.weeklyRent;
    // Arithmetic still needs a number: management fees are a percentage OF the
    // rent, so no rent means no fee, exactly as before. Only the figures a
    // reader is shown become absent rather than zero.
    const annualRentIncome = rentalEvidence.annualRent ?? 0;

    // Coerce potentially string-based overrides to numbers (prevents incorrect totals like "1000" + "1500")
    const toNumberOr = (value: any, fallback: number): number => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const n = parseFloat(String(value));
      return Number.isFinite(n) ? n : fallback;
    };

    // The interest-only repayment the prompt's loan tables quote. The
    // calculator writes `loanDetails.interestOnlyPayment` now; a record
    // written before it did derives it from its own loan amount and rate —
    // every interest-only row used to read `$0` because the key was never
    // written anywhere (QA-04).
    if (enhancedData?.financials?.loanDetails && toFiniteNumber(enhancedData.financials.loanDetails.interestOnlyPayment) === undefined) {
      const ioMonthly = interestOnlyMonthlyPaymentFor(enhancedData.financials);
      if (ioMonthly !== undefined) enhancedData.financials.loanDetails.interestOnlyPayment = ioMonthly;
    }

    // A yield is a fact about rent. With no rent established there is no
    // yield, and `0.00%` is not that — it is the claim that the property earns
    // nothing, which then travelled into the prompt under an order to use it
    // exactly. `null` here means the figure is omitted and said to be
    // unavailable; the record's own figure is still accepted as a fallback,
    // but only when it is a real one.
    //
    // The `.toFixed(2)` is deliberate and must stay. Routing this through
    // `propertyMetrics.grossYield` would be the tidier call, but its
    // `Math.round(x * 100) / 100` disagrees with `toFixed` on half-way values
    // — measured, 2,763 of 2,207,223 realistic (rent, price) pairs, e.g.
    // 1.105 printing as 1.10 here and 1.11 there. That is 0.125% of documents
    // shifted by a hundredth for no reader's benefit.
    const recordedYield = (v: unknown): string | null => {
      const n = toFiniteNumber(v);
      return n !== undefined && n > 0 ? n.toFixed(2) : null;
    };
    const preCalculatedGrossYield = rentalEvidence.established && effectivePurchasePrice > 0
      ? ((annualRentIncome / effectivePurchasePrice) * 100).toFixed(2)
      : recordedYield(enhancedData.financials?.keyMetrics?.grossRentalYield);
    
    // CRITICAL FIX: Recalculate Net Yield using OVERRIDDEN expense values
    // Net Yield = (Annual Rent - Total Annual Costs) / Purchase Price * 100
    // Extract effective annual costs from merged overrides (use ?? to respect explicit 0)
    const effectiveCouncilRates = toNumberOr(mergedOverrides.councilRates ?? enhancedData.financials?.annualCosts?.councilRates, 2500);
    const effectiveWaterRates = toNumberOr(mergedOverrides.waterRates ?? enhancedData.financials?.annualCosts?.waterRates, 1000);
    const effectiveStrataFees = toNumberOr(mergedOverrides.bodyCorporateFees ?? enhancedData.financials?.annualCosts?.strataFees, 0);
    const effectiveLandlordInsurance = toNumberOr(mergedOverrides.buildingLandlordInsurance ?? enhancedData.financials?.annualCosts?.landlordInsurance, 1800);
    const effectiveMaintenance = toNumberOr(mergedOverrides.repairsMaintenance ?? enhancedData.financials?.annualCosts?.maintenance, 1500);
    const effectiveLandTax = toNumberOr(mergedOverrides.landTax ?? enhancedData.financials?.annualCosts?.landTax, 0);
    // The engine's default is 7%; this fallback used to say 8, so a record
    // with no stated percentage was described with one fee in the engine and
    // another in the prose.
    const effectivePmPercent = toNumberOr(mergedOverrides.propertyManagementFees ?? enhancedData.financials?.annualCosts?.propertyManagementPercent, 7);
    const effectivePmDollar = Math.round(annualRentIncome * (effectivePmPercent / 100));
    const effectiveLettingFees = toNumberOr(mergedOverrides.lettingFees ?? enhancedData.financials?.annualCosts?.lettingFees, 0);

    // ONE cost base for the net yield: the engine's `totalAnnualExcludingLandTax`
    // where the engine ran (reviewed figures go into it, so it already
    // describes them), and the same line items — letting fees INCLUDED —
    // where it did not. This sum used to omit letting fees while the KPI's
    // did not, so one page printed a formula that resolved to 2.41% beside a
    // KPI reading 2.34%, exactly the $900 letting fee apart (QA-07).
    const engineNetYieldCosts = toFiniteNumber(enhancedData.financials?.annualCosts?.totalAnnualExcludingLandTax);
    const totalAnnualCostsForNetYield = engineNetYieldCosts !== undefined
      ? engineNetYieldCosts
      : effectiveCouncilRates + effectiveWaterRates + effectiveStrataFees +
        effectiveLandlordInsurance + effectiveMaintenance + effectivePmDollar + effectiveLettingFees;

    // Same rule, and it bites harder here: with no rent, rent-less-costs is
    // just the costs, so the old code printed a CONFIDENT NEGATIVE yield —
    // a number that looks like analysis and is an artefact of a missing input.
    // The engine's own yield is preferred where it exists: the KPI, the
    // formula table and the prose then quote one metric object.
    const engineNetYield = recordedYield(enhancedData.financials?.keyMetrics?.netRentalYield);
    const preCalculatedNetYield = rentalEvidence.established && effectivePurchasePrice > 0
      ? (engineNetYield ?? (((annualRentIncome - totalAnnualCostsForNetYield) / effectivePurchasePrice) * 100).toFixed(2))
      : engineNetYield;
    
    console.log(`📊 Pre-calculated Yields: Gross=${statedYield(preCalculatedGrossYield)}, Net=${statedYield(preCalculatedNetYield)} (rent source: ${rentalEvidence.source})`);
    console.log(`📊 Net Yield Calculation: ($${annualRentIncome} rent - $${totalAnnualCostsForNetYield} costs) / $${effectivePurchasePrice} = ${preCalculatedNetYield}%`);
    console.log(`📊 Annual Costs Breakdown: Council=$${effectiveCouncilRates}, Water=$${effectiveWaterRates}, Strata=$${effectiveStrataFees}, Insurance=$${effectiveLandlordInsurance}, Maintenance=$${effectiveMaintenance}, PM=$${effectivePmDollar}`);
    console.log(`📅 Occupancy: ${effectiveOccupancyRate} weeks/year (${((effectiveOccupancyRate/52)*100).toFixed(0)}%)`);
    console.log(`📊 Land Tax Override: $${effectiveLandTax} (will be injected into prompt)`);

    // Cash-flow narrative figures are derived FROM the projections series so
    // the prose can never disagree with the table it introduces — the table
    // below transcribes the series verbatim. The helpers live in
    // financialEngine.pure.ts beside the arithmetic that writes the series.
    const annualLoanPayments = Math.round((enhancedData.financials?.loanDetails?.monthlyPayment || 0) * 12);
    const moderateSeries: any[] = Array.isArray(enhancedData.financials?.projections?.moderate)
      ? enhancedData.financials.projections.moderate
      : [];
    const opexYear1 = impliedOpexFromSeries(moderateSeries[0], annualLoanPayments)
      ?? toNumberOr(enhancedData.financials?.annualCosts?.totalAnnual, totalAnnualCostsForNetYield + effectiveLandTax);
    const opexYear10 = impliedOpexFromSeries(moderateSeries[9], annualLoanPayments) ?? opexYear1;
    const cumConservative = cumulativeCashFlow(enhancedData.financials?.projections?.conservative);
    const cumModerate = cumulativeCashFlow(enhancedData.financials?.projections?.moderate);
    const cumOptimistic = cumulativeCashFlow(enhancedData.financials?.projections?.optimistic);
    const allScenariosCashNegative = cumConservative < 0 && cumModerate < 0 && cumOptimistic < 0;

    // The distances the RECORD will keep. `location-intelligence-service` and
    // `school-data-service` each measure their own, and both used to reach the
    // report — the prompt quoted the second while every stored, projected and
    // rendered surface reads the first, so a client read "0.29 km" from a
    // record holding 0.21. See `_shared/reports/schoolDistance.pure.ts`.
    const storedSchools = enhancedData.locationIntelligence?.schools?.topSchools;

    // The planning record this report may state.
    //
    // `planning-data-service` has answered since 2026-09-06 and the fetch
    // above has always stored its answer on `enhancedData.planningData` —
    // but the zoning SECTION of this prompt read none of it. It was a
    // template of bracketed placeholders (`[XX]%` site coverage, `[X]m`
    // setbacks, "Refer to LEP", "typically 450m²") handed to a model with
    // nothing to fill them from, so the model filled them: 450 m², 8.5 m and
    // 0.5:1 reached a client's document as though they were measurements.
    // It also named New South Wales instruments on a Queensland property.
    //
    // The table below is composed from what was retrieved, the operator's
    // audited overrides outrank it, and a control nobody published prints
    // which absence it is rather than a number.
    const planningFacts = buildPlanningFacts({
      planningData: enhancedData.planningData,
      overrides: {
        zoningCode: mergedOverrides.zoningCode,
        zoningDescription: mergedOverrides.zoningDescription,
        permittedUses: mergedOverrides.permittedUses,
        developmentPotential: mergedOverrides.developmentPotential,
        zoningOverlays: mergedOverrides.zoningOverlays,
        minimumLotSize: mergedOverrides.minimumLotSize,
        maximumHeight: mergedOverrides.maximumHeight,
        floorSpaceRatio: mergedOverrides.floorSpaceRatio,
      },
    });
    const planningControlsTable = renderPlanningControls(planningFacts);
    const planningSectionRules = planningFactBlocks(planningFacts);
    // The infrastructure and development this report may describe.
    //
    // The same shape as the planning controls above: the enrichment already
    // holds evidenced development facts — Queensland's declared instruments
    // at this coordinate, New South Wales' DA register for this council — and
    // the outlook sections used none of them. What the prompt offered instead
    // was a worked example naming a metro line that opened in a year it
    // invented, an opportunity bullet about "planned residential and
    // commercial developments", and a directive requiring a pipeline ribbon
    // whether or not a single project was evidenced.
    const infrastructure = buildInfrastructureEvidence({ planningData: enhancedData.planningData });
    const infrastructureTable = renderInfrastructureOutlook(infrastructure);
    const infrastructureSectionRules = infrastructureRules(infrastructure);

    /*
     * And the major public projects no machine-readable register carries.
     *
     * `PROGRAMME_PUBLISHERS` records that seven of the eight jurisdictions
     * publish their forward programme as budget papers and agency pages rather
     * than a feed, and marks them `ingested: false`. Honest, and on its own it
     * means a New South Wales report names no infrastructure project at all —
     * on 48 Redfern Street, Cowra, a $110.2m hospital 1.09 km away that opened
     * while the report was being written.
     *
     * A row in this register is RECORDED from the responsible authority's own
     * dated pages, never retrieved from a feed, and it says so on the page.
     * Keyed on the verified coordinate, so a report with no trustworthy
     * coordinate names no project rather than one near a guess.
     */
    // The same qualified coordinate the planning registers were asked at, for
    // the same reason: "keyed on the verified coordinate" was keyed on an
    // in-memory object the resume run does not have, so this register named no
    // project on 105 of 105 stored reports. A recovered coordinate is accepted
    // only at parcel grade, so a project is still never named near a guess.
    const publishedProjectCoords = subjectCoordinate;
    const nearbyPublishedProjects = publishedProjectCoords?.lat && publishedProjectCoords?.lng
      ? projectsNear(publishedProjectCoords.lat, publishedProjectCoords.lng, 15)
      : [];
    // Searched, or not searched — and the register now says which on the page.
    // An empty result used to render the empty string and tell the model "no
    // major public project ... is recorded", which asserts a search happened;
    // it was returned identically on the 105 stored reports where no
    // coordinate existed and no search was possible.
    const publishedProjectSearch: RegisterSearch = publishedProjectCoords
      ? { searched: true, radiusKm: 15, coordinateSource: publishedProjectCoords.source }
      : {
          searched: false,
          reason: coordinateRefusal
            ? `the register is swept by coordinate and none was usable — ${coordinateRefusal.detail}.`
            : 'the register is swept by coordinate and none was resolved for this property.',
        };
    const publishedProjectBlock = renderPublishedProjects(nearbyPublishedProjects, publishedProjectSearch);
    const publishedProjectSectionRules = publishedProjectRules(nearbyPublishedProjects, publishedProjectSearch);
    acquisition.record({
      producer: 'publishedProjects',
      outcome: publishedProjectSearch.searched
        ? (nearbyPublishedProjects.length ? 'answered' : 'unavailable_in_coverage')
        : ledgerOutcomeFor((coordinateRefusal?.refusal ?? 'no_address') as any),
      detail: publishedProjectSearch.searched
        ? (nearbyPublishedProjects.length
          ? `Recorded within 15 km: ${nearbyPublishedProjects.map((n) => n.project.name).join('; ')}`
          : 'The register was swept within 15 km of the verified coordinate and holds nothing there')
        : publishedProjectSearch.reason,
      service: 'published-project-register',
    });
    console.log(
      `🏗️ Published projects within 15 km: ${nearbyPublishedProjects.length}`
      + (nearbyPublishedProjects.length
        ? ` (${nearbyPublishedProjects.map((n) => `${n.project.name} ${n.distanceKm.toFixed(1)}km`).join('; ')})`
        : ''),
    );

    /*
     * And the market evidence, which reached the SCORING SERVICE and nothing
     * else.
     *
     * `marketPoints` is posted to `investment-scoring-service` and the grade
     * comes back; no prompt has ever been handed a median. So the prose
     * supplied its own — 18 Annabelle Crescent stated a $1.96m suburb median,
     * a "high-$1.8m to ~$2.0m" range, "high-$700k to low-$800k" unit medians,
     * "$900" median weekly rent and "low single digits" growth, and
     * `market_fact_snapshot` holds not one market price. The construction
     * gives it away: *is consistently reported*, *data sets report*, *is
     * called* — an agentless passive is what a sentence uses when it has no
     * source to name.
     *
     * Exactly the shape of the planning defect: the service answered, the
     * answer was stored, and the section that needed it read none of it.
     */
    /*
     * Which price, and whose.
     *
     * `effectivePurchasePrice` is
     * `mergedOverrides.purchasePrice || propertyDetails?.price || 0` and the
     * prompt labelled it "**Asking price:**" on either rung. On 18 Annabelle
     * Crescent the first rung answers — an adviser's accepted $1,490,000, the
     * figure `initialCosts.propertyValue` models, `loanAmount` is 80% of and
     * `keyMetrics.lvr: 80` agrees with — so an accepted modelling input was
     * handed to the model as the market's asking price. The model then wrote a
     * "price guide around $1.55m" that appears in no field of the record,
     * contradicts the accepted input by $60,000, and became the Executive
     * Verdict's central claim when compared against an unsourced median.
     *
     * Nothing here changes WHICH figure is used — that figure carries the
     * loan, the LVR, every projection and the Cash Flow. What changes is that
     * it is named by the rung it came from, and that no second price may be
     * supplied beside it.
     */
    const subjectPrice = describeSubjectPrice({
      overridePurchasePrice: mergedOverrides.purchasePrice,
      listingPrice: propertyDetails?.price,
    });
    const subjectPriceSectionRules = subjectPriceRules(subjectPrice);
    console.log('💲 Subject price:', { basis: subjectPrice.basis, value: subjectPrice.value });

    const marketFacts = buildMarketFacts({ marketEvidence: enhancedData.marketEvidence });
    const marketTable = renderMarketFacts(marketFacts);
    const marketSectionRules = marketFactRules(marketFacts);
    console.log('📈 Market evidence for the prose:', {
      stated: marketFacts.rows.filter((r) => !r.benchmark).length,
      benchmarks: marketFacts.rows.filter((r) => r.benchmark).length,
      withheld: marketFacts.withheld.length,
      unavailable: marketFacts.unavailable.length,
      evidenceMissing: marketFacts.evidenceMissing,
    });
    /*
     * `propertySpecs` and `dataSources` are composed HERE, not at the row
     * write two thousand lines below, because the strategy record beneath
     * them reads both — `StrategyRowInput` names them as
     * `investment_reports.property_specs` and `.data_sources`.
     *
     * They used to be declared inside the `if (reportId && supabaseClient)`
     * block that writes the row, which is a CHILD of this one, so the two
     * shorthand properties below resolved to nothing and the handler threw
     * `ReferenceError: propertySpecs is not defined` the moment acquisition
     * finished — before section 1 was ever attempted. Every POST to this
     * function answered 500 from 2026-09-19 12:00 until this was fixed.
     *
     * Hoisting stores the same values: every input is a `const` settled by
     * L5397, and `enhancedData`'s last assignment is L4716 — so the objects
     * built here are the objects that block used to build. Only the
     * `sourceStamp` timestamps move, from the end of the run to here.
     */
    // Prepare property specs from property details
    // The normalised spellings (see the fact normalisation above): this used
    // to read `.landSize` / `.buildingSize` / `.parking` while every caller
    // sent `landSizeSqm` / `buildSizeSqm` / `carSpaces`, so three of the
    // nine specs were null on every row whatever the caller knew.
    // The MERGED facts, not the listing's alone. Every value below was
    // already resolved above by merging `manual_overrides` over
    // `propertyDetails` — and this block used to persist the un-merged half,
    // so the answer was computed, used to build the prompt and the duty
    // assessment, and then discarded at the moment of writing it down: 127
    // land sizes, 122 build sizes and 144 car-space counts an operator had
    // supplied were stored as null, and `property_type` was the literal
    // `'Residential Property'` on 84. See
    // `_shared/reports/investment/propertyRecord.pure.ts`.
    const propertySpecs = composePropertySpecs({
      propertyType: effectivePropertyType ?? resolvedPropertyType,
      landSizeSqm: effectiveLandSizeSqm,
      buildSizeSqm: effectiveBuildSizeSqm,
      beds: effectiveBeds,
      baths: effectiveBaths,
      carSpaces: mergedOverrides.carSpaces ?? propertyDetails?.carSpaces,
      // Both rungs of the old chain were keys nothing writes: the override
      // registry spells it `constructionYear` and the generator sends
      // `propertyDetails.constructionYear`, so `property_specs.year_built`
      // was null on all 1,230 stored reports while 32 of them held the
      // value one object away.
      yearBuilt: mergedOverrides.constructionYear
        ?? mergedOverrides.yearBuilt
        ?? propertyDetails?.constructionYear
        ?? propertyDetails?.yearBuilt,
      // An operator's own record first, then what the jurisdiction's layer
      // answered, then whatever the listing carried. `spec_zoning` and
      // `spec_council` were null on every report ever generated because
      // only the first of those three was ever consulted.
      zoning: mergedOverrides.zoningCode
        ?? (planningFacts.zoning.status === 'stated' ? planningFacts.zoning.value : null)
        ?? propertyDetails?.zoning,
      councilArea: mergedOverrides.councilArea ?? planningFacts.council ?? propertyDetails?.councilArea,
    });
    
    // Prepare data sources tracking. Every source the generation ATTEMPTED
    // is recorded — present with its provenance, or null.
    //
    // That null used to be the whole answer, under a comment reading "a null
    // is a fact ('we asked and got nothing'), never an error". It could not
    // be: the composition reads `enhancedData.X`, which is the RESULT, and a
    // result says nothing about the attempt. Five different things arrived
    // here as one null — never asked, asked and failed, answered and lost,
    // answered and empty, answered and used — and on the Cowra report six
    // producers were null beside `errorsEncountered: 0`.
    //
    // `_acquisition` is the ledger that tells them apart. The nulls below are
    // unchanged, so nothing downstream moves; what is added is the record
    // that lets a reader and an operator know which of the five they have.
    const sourceStamp = (source: string, confidence: number) => ({
      source,
      confidence,
      timestamp: new Date().toISOString()
    });
    const dataSources = {
      demographics: enhancedData.demographics ? {
        source: 'abs',
        confidence: enhancedData.demographics.data_quality === 'live' ? 1.0 : 0.6,
        timestamp: new Date().toISOString()
      } : null,
      financials: enhancedData.financials ? sourceStamp('calculated', 1.0) : null,
      marketData: enhancedData.domainData ? sourceStamp('domain', 0.9) : null,
      locationIntelligence: enhancedData.locationIntelligence ? sourceStamp('google_maps', 0.95) : null,
      economics: enhancedData.economics ? sourceStamp('rba', 0.9) : null,
      seifa: enhancedData.seifaData ? sourceStamp('abs_seifa', 0.9) : null,
      crimeStatistics: enhancedData.crimeStatistics ? sourceStamp('state_crime_data', 0.8) : null,
      employment: enhancedData.employmentData ? sourceStamp('abs_employment', 0.9) : null,
      climate: enhancedData.climateData ? sourceStamp('climate_service', 0.8) : null,
      riskAssessment: enhancedData.riskAssessment ? sourceStamp('risk_assessment', 0.85) : null,
      investmentScore: enhancedData.investmentScore ? sourceStamp('scoring_engine', 1.0) : null,
      // Planning was fetched on every report and named in none of them, so
      // the coverage disclosure counted a source the run had spent. It
      // carries its own provenance rather than a bare confidence: which
      // jurisdiction answered, which council, whether a zone was retrieved,
      // and the retrieval stamp the readings were taken under.
      planning: enhancedData.planningData ? {
        source: 'jurisdiction_planning_layers',
        confidence: planningFacts.zoning.status === 'stated' ? 0.9 : 0.5,
        timestamp: planningFacts.retrievedAt ?? new Date().toISOString(),
        jurisdiction: planningFacts.jurisdiction,
        council: planningFacts.council,
        zoneStatus: planningFacts.zoning.status,
        zone: planningFacts.zoning.value,
        zoneSource: planningFacts.zoning.source,
        zoneLicence: planningFacts.zoning.licence,
        zoneEffectiveDate: planningFacts.zoning.effectiveDate,
        verification: planningFacts.verification,
        verificationUrl: planningFacts.zoning.sourceUrl,
      } : null
    };

    /*
     * The three strategy sections this document owns, composed rather than
     * asked for.
     *
     * `carriesModelling: false` — the Compass does not carry the analysis of a
     * purchase (`TIER_FRAMEWORK.md` Decision E), so every entry that would
     * state a yield, a weekly position, a lending ratio or an equity figure is
     * simply not produced. The Financial report composes the same sections
     * from the same module with the modelling on.
     *
     * The planning and transport readings come off the objects this run has
     * already built, not off the row — the row is written after this point.
     */
    const compassStrategyRecord = readStrategyRecord(
      {
        propertyAddress,
        propertySpecs,
        financialCalculations: enhancedData.financials,
        investmentScore: enhancedData.investmentScore,
        dataSources,
        locationIntelligence: measuredLocationIntelligence ?? enhancedData.locationIntelligence,
      },
      {
        market: marketFacts,
        price: subjectPrice,
        carriesModelling: false,
        measuredAt: (measuredLocationIntelligence ?? enhancedData.locationIntelligence)
          ?.[ENRICHMENT_STAMP]?.acquiredAt ?? null,
        // The count with a radius that is TRUE of it. The stored key is
        // `stopsWithin1km` and its value is the count within 1,600 m.
        transport: transportCountReading(
          (measuredLocationIntelligence ?? enhancedData.locationIntelligence)?.transport,
        ),
      },
    );
    const compassStrategySections = composeStrategySections(compassStrategyRecord, [
      { id: 'exitStrategy', heading: 'Resale Liquidity & Exit Outlook' },
      { id: 'swot', heading: 'SWOT Analysis' },
      { id: 'monitoring', heading: 'Monitoring & Review Plan' },
    ]);
    const strategySectionsMarkdown = compassStrategySections.map((x) => x.markdown).join('\n\n');
    const strategyRules = strategySectionRules(compassStrategyRecord);
    console.log('🧭 Strategy sections composed:', compassStrategySections.map((x) => ({
      id: x.id, chars: x.markdown.length,
    })));
    console.log('🏗️ Infrastructure evidence:', {
      items: infrastructure.items.length,
      dwellings: infrastructure.pipelineDwellings?.total ?? null,
      evidenced: infrastructure.anyEvidenced,
    });
    console.log('📐 Planning facts:', {
      jurisdiction: planningFacts.jurisdiction,
      council: planningFacts.council,
      zone: planningFacts.zoning.value,
      zoneStatus: planningFacts.zoning.status,
      stated: planningFacts.anyStated,
    });

    /**
     * What this report may state about planning and infrastructure — pinned.
     *
     * These four pieces used to sit inside `propertyPrompt`, about a quarter of
     * the way through it, under two headings of their own. That put them in the
     * band `limitPromptContext` drops: the base prompt measured 92,129 bytes on
     * 262 Pallas Street and every section trimmed it to ~52,830 (62% head, 38%
     * tail), so the authority for the planning readings was cut while the rule
     * that points at it survived in the section instructions, which are never
     * trimmed. A model holding "name only items in the Infrastructure &
     * Development Outlook table" with no such table in front of it filled the
     * gap from live search, and the document asserted a zone, an absence of
     * flood, bushfire and heritage overlays, and a four-item delivery pipeline
     * — every one of them from a portal or a news page rather than from a
     * register this platform read.
     *
     * Pinned context is budgeted for before the base prompt and concatenated
     * after the trim, so it reaches every section whole. It is ~5.6 KB.
     */
    /**
     * How to CITE this evidence — and it rides with the evidence.
     *
     * The two headings below are prompt scaffolding. A reader never sees
     * them, so a reference to one is a pointer into nothing. Measured across
     * the delivered suite: nine of ten documents carry at least one, and one
     * Compass carries nine — `[Zoning & Planning notes]` ×5,
     * `[Infrastructure section]` ×2, `[Zoning & Planning table]`,
     * `[Infrastructure table]` — set mid-sentence in the client's prose:
     * "…must factor into rental and resale expectations.[Infrastructure
     * section] The recorded 680 new dwellings…". The second subject shows the
     * other form, `[Property.com.au]` and `[View.com.au]`: a source named as a
     * bracketed token rather than in the sentence.
     *
     * Both are the same fault — a citation written as a marker — and the
     * remedy is not to delete the marker. The claims behind them are
     * supported: the planning and infrastructure tables are appended VERBATIM
     * to the finished document under `## Planning controls and development
     * registers`, so there is a real section to point at and a real publisher
     * to name. Stripping the brackets would leave the sentence unsourced,
     * which is worse than an ugly one that is sourced.
     *
     * So the rule says what a reference must look like instead, and it sits
     * INSIDE the pinned context: a rule about how to cite this evidence is
     * worthless in the part of the prompt that gets trimmed away from it.
     */
    const planningCitationRule = [
      '## How to refer to this evidence in the report',
      '',
      'The two headings in this block are part of your instructions. The reader',
      'never sees them, so **never write a bracketed pointer** such as',
      '`[Zoning & Planning table]`, `[Infrastructure section]`,',
      '`[Zoning & Planning notes]` or `[Infrastructure table]`. A bracket like',
      'that lands mid-sentence in a client document and refers to nothing they',
      'can open.',
      '',
      'Refer to it in the sentence instead, in one of exactly two ways:',
      '',
      '1. **Name the publisher and its currency**, which the table beside you',
      '   already carries — "the NSW Planning Portal\'s Principal Planning',
      '   Layers, current at 7 August 2026" — or',
      '2. **Name the report\'s own section**: these tables are reproduced in',
      '   full at the end of this report under *Planning controls and',
      '   development registers*.',
      '',
      'The same rule covers every other source. A source is named in the',
      'sentence — "listed on realestate.com.au" — and never as a bracketed',
      'token like `[Property.com.au]`. If a claim has no source you can name',
      'in prose, it has no source, and it does not belong in the report.',
    ].join('\n');

    const pinnedPlanningContext = [
      '# Zoning & Planning Analysis — the controls retrieved for this property',
      planningControlsTable,
      planningSectionRules,
      '# Infrastructure & Development Outlook — what the registers answered',
      infrastructureTable,
      infrastructureSectionRules,
      // Recorded from official publications rather than retrieved from a
      // register, and pinned for the same reason everything else here is:
      // it is the AUTHORITY for a set of figures and dates, and a rule that
      // survives while its evidence is trimmed is the §6 defect.
      ...(publishedProjectBlock
        ? ['# Major public projects near this property — recorded from their publisher\'s own pages',
          publishedProjectBlock]
        : []),
      publishedProjectSectionRules,
      // The market evidence rides the same pin, for the same reason: the base
      // prompt measured 92,129 bytes on 262 Pallas Street and every section
      // trimmed it to ~52,830, so anything that is the AUTHORITY for a figure
      // must come off the budget before the base prompt is measured and be
      // concatenated after the trim. A rule that survives while its evidence
      // is cut is the §6 defect, and it produced a report that named no source
      // because it had none to name.
      '# Market Evidence — the figures retrieved for this market',
      marketTable,
      marketSectionRules,
      // The subject's own price rides the same pin as the market's figures,
      // for the same reason: it is the authority for a number, and an
      // authority that `limitPromptContext` can cut while its rule survives is
      // §6's defect.
      subjectPriceSectionRules,
      /*
       * The strategy sections are composed and appended to the document, so
       * the model never writes them — but it does write the sections AROUND
       * them, and a SWOT quadrant restated in the executive verdict with the
       * provenance dropped is how a composed fact becomes an unsourced claim.
       * The rules ride the pin for the same reason the market's do.
       */
      strategyRules,
      planningCitationRule,
      /*
       * And the PROSE half of the chart evidence contract.
       *
       * `enforceChartEvidence` removes an unsupported directive on every read
       * path, which is right for a structure and impossible for a sentence:
       * this programme's rule is that prose is never regex-scrubbed, because a
       * regex deletes the qualification with the claim and a half-deleted
       * sentence is worse than the claim was.
       *
       * So the sentence is governed at the prompt instead, from the SAME
       * inventory the drawings are judged against. One inventory, two
       * consumers — otherwise the page and the sentence beside it disagree
       * about what the record holds, which is exactly what happened when the
       * occupier donut was withdrawn and "roughly 45% of tenants are families"
       * stayed in the paragraph above it.
       *
       * Built from what this RUN holds rather than from a stored row, because
       * the row does not exist yet; the shape is the one
       * `readEvidenceInventory` produces so the two cannot drift.
       */
      claimSupportRules({
        recordedScores: Array.isArray(enhancedData.investmentScore?.breakdown)
          ? enhancedData.investmentScore.breakdown
            .map((b: { score?: unknown }) => Number(b?.score))
            .filter((n: number) => Number.isFinite(n))
          : [],
        demographics: !!enhancedData.demographics,
        marketData: !!enhancedData.domainData,
        location: !!enhancedData.locationIntelligence,
        // What the Client-Safe Gate withheld for this report, from the same
        // `marketFacts` the market table renders — so the prose rule and the
        // page name the same withheld facts.
        withheldFacts: (marketFacts.withheld ?? [])
          .map((w: { label?: unknown; name?: unknown }) => String(w?.label ?? w?.name ?? ''))
          .filter(Boolean),
      }),
    ].join('\n\n');
    console.log(`📌 Pinned planning/infrastructure/market context: ${pinnedPlanningContext.length} chars`);

    const _brandPp = await getBrandConfig();
    const propertyPrompt = `You are an expert Australian property investment analyst for ${_brandPp.companyName}.

You write one section at a time. The section you are asked for, and its length,
are set out at the end of this prompt; everything before that is the document's
contract and the evidence you may draw on.

**PROPERTY TO ANALYSE: ${formattedInput}**

${propertyTypeRule}

${compassDocumentContract(_brandPp.companyName)}

# ═══════════════════════════════════════════════════════════════════════
# THE EVIDENCE PACK — everything this report is allowed to state
# ═══════════════════════════════════════════════════════════════════════

This is the whole of the retrieved record for this property. A figure that is
not below was not retrieved, and the rule above applies to it: omit the
sentence rather than supply the figure.

Where a block below says a reading is absent, unavailable or not served, that
is the finding — report it as a fact about the check, never as a fact about
the property.

---

## The property, as recorded

**Address:** ${formattedInput}

| Property Characteristic | Value |
|------------------------|-------|
${propertyTypeLabel ? `| Property Type | ${propertyTypeLabel} |` : ''}
${[
  // Each of these rows used to carry a placeholder the model was asked to
  // expand: `'Estimated XXX-XXX m² (typical for suburb)'`,
  // `'X (typical for property type)'`, `'X-X spaces'`, `'Estimated XXXX-XXXX'`
  // and, for condition, the flat assertion `'Good to excellent'` about a
  // property nobody had inspected. Measured across the corpus: 169 documents
  // print an "Estimated N–N m²" land size and 201 assert
  // `| Condition | Good to excellent |`. On three sampled reports the stated
  // range is roughly DOUBLE the land size the operator had recorded, and the
  // council rates, land tax and rent comparables are then reasoned from it —
  // `38 Larcom Crescent` says ~500 m² throughout against a recorded 255.
  [landAreaReading?.label ?? 'Land size', landAreaReading?.value ?? null],
  ['Bedrooms', effectiveBeds || null],
  ['Bathrooms', effectiveBaths || null],
  ['Parking', mergedOverrides.carSpaces ?? propertyDetails?.carSpaces ?? null],
  ['Year Built', mergedOverrides.yearBuilt ?? propertyDetails?.yearBuilt ?? null],
  ['Condition', propertyDetails?.condition ?? null],
].filter(([, v]) => v !== null && v !== undefined && v !== '')
 .map(([k, v]) => `| ${k} | ${v} |`).join('\n')}
${isStrataProperty && propertyTypeLabel ? `| Strata Type | ${propertyTypeLabel} within strata scheme |` : ''}
${landAreaReading?.note ? `\n_${landAreaReading.note}_\n` : ''}

The table above contains every physical attribute on record for this property.
Do not add a row to it, and do not state a land size, floor area, bedroom or
bathroom count, parking count, year built or condition that is not in it — not
as an estimate, not as a range, and not as what is "typical for the suburb".
Where an attribute is absent you may say it is not recorded, and you may
discuss the suburb's housing stock in general terms provided you do not
attribute any of it to this property. Nobody has inspected this property, so
no statement about its condition, its compliance or its maintenance history
is available to you.

---

## Where it is

${planningStatBlocks(enhancedData)}

${regionalTrendBlocks(enhancedData)}

---

## The economy around it

${macroEconomicBlock(enhancedData)}

---

## Who lives there

${demographicsStatBlocks(enhancedData)}

---

## Schools

**Catchment evidence rule:** a school catchment is an enrolment-area fact
settled only by the department's address-based School Finder or written
school/department confirmation, with its date. Where the sources available to
you disagree (listing vs. portal vs. department), present EACH source's claim,
name the source, and mark the catchment "unverified — sources conflict"; never
select one. A travel claim ("short drive", "manageable commute") is written
only with its mode, origin, distance and duration from a measured route;
otherwise omit it.

${(() => {
  const summary = enhancedData.schoolData?.summary;
  const nearest = reconcileNearestSchool(enhancedData.schoolData?.nearestSchool, storedSchools);
  const top = reconcileSchoolDistances(enhancedData.schoolData?.topSchools, storedSchools).slice(0, 5);
  const all = reconcileSchoolDistances(enhancedData.schoolData?.allSchools, storedSchools).slice(0, 10);
  const rows = (list: any[]) => list.map((x: any) => `| ${x.name} | ${x.distance} km | ${x.type ?? '—'} |`).join('\n');
  const parts: string[] = [];
  if (typeof summary?.totalSchools === 'number') parts.push(`Schools found in the postcode: **${summary.totalSchools}**.`);
  if (nearest?.name) {
    parts.push(`Nearest: **${nearest.name}**${nearest.distance ? `, ${nearest.distance} km` : ''}`
      + `${enhancedData.schoolData?.nearestSchool?.type ? ` (${enhancedData.schoolData.nearestSchool.type})` : ''}.`);
  }
  const list = top.length ? top : all;
  if (list.length) parts.push(`\n| School | Distance | Type |\n|---|---|---|\n${rows(list)}`);
  if (!parts.length) {
    return 'No school register reading was retrieved for this property. Say that no school data '
      + 'was retrieved; do NOT name a school, state a distance, a rating or a catchment, and do '
      + 'NOT describe the area as well or poorly served by schools.';
  }
  return `${parts.join('\n')}\n\nEvery school named in the report must be one of these, at the distance stated here. `
    + 'A school rating is not retrieved and must not be stated.';
})()}

---

## Healthcare, shopping and recreation

${(() => {
  const li: any = enhancedData.locationIntelligence ?? {};
  const rows: string[] = [];
  const add = (label: string, count: unknown, nearest: unknown) => {
    // `absent is never zero` — a failed Places category stores null and a
    // reached-but-empty one stores 0, so a number is a measurement and
    // anything else is a category nobody reached.
    if (typeof count !== 'number') return;
    rows.push(`| ${label} | ${count} within 5 km | ${typeof nearest === 'string' && nearest ? nearest : '—'} |`);
  };
  add('Healthcare facilities', li.healthcare?.facilitiesWithin5km, li.healthcare?.nearestHospital);
  add('Supermarkets', li.lifestyle?.supermarkets, li.lifestyle?.nearestSupermarket);
  add('Shopping centres', li.lifestyle?.shoppingCenters, li.lifestyle?.nearestShoppingCenter);
  add('Parks and recreation', li.lifestyle?.parks, li.lifestyle?.nearestPark);
  add('Restaurants and cafés', li.lifestyle?.restaurants, null);
  if (!rows.length) {
    return 'No amenity reading was retrieved for this property. Say that amenity data was not '
      + 'retrieved; do NOT state a count, a distance or a named facility, and do NOT describe '
      + 'the area as well or poorly served.';
  }
  return `| Category | Count | Nearest |\n|---|---|---|\n${rows.join('\n')}\n\n`
    + 'A count of zero here is a measurement and may be reported as one — a rural address with no '
    + 'hospital within five kilometres is a fact worth printing. A category absent from this table '
    + 'was not measured and must not be described either way.';
})()}

---

## Getting about

${(() => {
  const t: any = enhancedData.locationIntelligence?.transport ?? {};
  const parts: string[] = [];
  if (t.nearestStation) parts.push(`Nearest public transport stop on record: **${t.nearestStation}**${t.stationDistance ? `, ${t.stationDistance}` : ''}.`);
  if (Array.isArray(t.transportTypes) && t.transportTypes.length) parts.push(`Modes recorded: ${t.transportTypes.join(', ')}.`);
  if (t.commuteToCbd) parts.push(`Measured commute: ${t.commuteToCbd}.`);
  if (!parts.length) {
    return 'No public-transport reading was retrieved for this property. Say that transport data '
      + 'was not retrieved; do NOT name a station, state a distance or a commute time, and do NOT '
      + 'call the area well served or car-dependent. Car dependence is a finding that needs a '
      + 'measurement like any other.';
  }
  return `${parts.join('\n\n')}\n\nA stop found is a fact about this area; no stop found is a fact about the `
    + 'FEEDS that were loaded. Neither is a score, and no service frequency or mode quality was measured.';
})()}

---

## Environment and climate

${climateStatBlocks(enhancedData)}

---

## Crime and safety

${crimeStatBlocks(enhancedData)}

---

## What is offered, and what it rents for

${subjectPriceLine(subjectPrice)}

${rentalEvidence.established && quotedWeeklyRent
  ? `**Indicative weekly rent:** $${quotedWeeklyRent} a week (${rentalEvidence.source}).`
  : '**Indicative weekly rent:** not established for this property.'}
${absentRentDirective(rentalEvidence)}

These two figures are facts about the property and may be stated ONCE, in the
property snapshot. They may not be analysed: no yield, no LVR, no loan, no
cash flow, no projection, no comparison against a modelled return. That
analysis is the Financial Analysis Report for this property, and a reader who
wants it is better served by being told where it is than by being given half
of it here.
`;

    // Select the appropriate prompt based on report scope
    let prompt = reportScope === 'suburb' ? suburbPrompt
      : reportScope === 'postcode' ? postcodePrompt
      : reportScope === 'statewide' ? statewidePrompt
      : propertyPrompt;

    // RF-7.2B.1A — appended HERE, after the scope has chosen, rather than
    // inside any one of the four templates above.
    //
    // This is the same reasoning that put the Client-Safe Gate on the object
    // instead of on each prompt: there are four base prompts, a report reaches
    // exactly one of them, and a rule written into one is a rule three scopes
    // do not have. Withheld demographics can occur on any scope, so the
    // directive has to sit where the four converge. Empty string when every
    // governed category is admissible, so a healthy prompt is unchanged.
    prompt += governedCategoryDirective(safeGeneration.snapshot);

    // For area reports, inject explicit exclusion instructions to prevent property-level sections
    if (isAreaReport) {
      const areaExclusionInstructions = `
---
**CRITICAL: AREA-LEVEL ANALYSIS ONLY — NO PROPERTY-SPECIFIC SECTIONS**

This is a ${reportScope.toUpperCase()}-level area analysis report. You MUST NOT include any of the following property-specific sections or content:

- ❌ Loan Repayment calculations or tables
- ❌ Cash Flow Analysis or Projections (weekly/monthly/annual)
- ❌ 10-Year Cash Flow Projection tables
- ❌ Mortgage / Loan Scenarios
- ❌ Stamp Duty calculations
- ❌ Depreciation schedules
- ❌ Rental Yield calculations for a specific property
- ❌ Property Snapshot tables with specific purchase price, weekly rent, LVR, etc.
- ❌ Net/Gross Rental Yield for a single property
- ❌ Acquisition Cost breakdowns
- ❌ Annual Operating Cost breakdowns for a single property
- ❌ Negative Gearing / Tax Benefit calculations
- ❌ Equity Growth projections for a single property

Instead, focus EXCLUSIVELY on area-level analysis:
- ✅ Median prices, rental yields, and vacancy rates for the area
- ✅ Supply pipeline and development activity
- ✅ Demographics and population trends
- ✅ Infrastructure and government investment
- ✅ Market momentum and growth trends
- ✅ Comparative suburb/region analysis
- ✅ Investment hotspot identification
- ✅ Zoning and planning considerations
- ✅ SWOT analysis at the area level

---

`;
      prompt = areaExclusionInstructions + prompt;
      console.log('✅ Area-level exclusion instructions injected for scope:', reportScope);
    }
    
    // If document content is available (from URL scrape OR PDF upload), prepend it to the prompt for context
    if (documentContent) {
      const contentSourceLabel = fromPdfUpload ? 'PDF Document' : (sourceUrl || 'Property Listing');
      console.log(`📄 Injecting ${fromPdfUpload ? 'PDF' : 'scraped'} property listing content into prompt...`);
      console.log(`   Content source: ${contentSourceLabel}`);
      console.log(`   Content length: ${documentContent.length} characters`);
      
      // Build a summary of extracted property details
      // The GOVERNED physical attributes — bedrooms, bathrooms, parking, land
      // and floor area, year built, condition — are deliberately NOT listed
      // here. The specification table further down already carries every one
      // the record holds, and `effectiveBeds` and its siblings already fall
      // back to this same extraction to build it. Repeating them here put the
      // same attribute in front of the model twice, from two sources, with no
      // statement of which governs — and where the record held none, this
      // block was the only one that spoke.
      //
      // Measured on 18 Annabelle Crescent: `property_specs` holds
      // `bedrooms: null, bathrooms: null, parking: 2`, so the specification
      // table printed a Parking row and no Bedrooms or Bathrooms row — and
      // the document still said "marketed as a 3-bedroom, 1-bathroom, 2-car
      // house" twice, then said in its own Property Fit section that "the
      // property record contains no bedroom or bathroom count". One document,
      // both claims.
      const extractedDetailsSummary: string[] = [];
      if (propertyDetails?.price) extractedDetailsSummary.push(`Price: $${propertyDetails.price.toLocaleString()}`);
      if (propertyDetails?.propertyType) extractedDetailsSummary.push(`Property Type: ${propertyDetails.propertyType}`);
      if (propertyDetails?.suburb) extractedDetailsSummary.push(`Suburb: ${propertyDetails.suburb}`);
      if (propertyDetails?.postcode) extractedDetailsSummary.push(`Postcode: ${propertyDetails.postcode}`);
      if (propertyDetails?.state) extractedDetailsSummary.push(`State: ${propertyDetails.state}`);
      if (propertyDetails?.weeklyRent) extractedDetailsSummary.push(`Weekly Rent: $${propertyDetails.weeklyRent}`);
      if (propertyDetails?.isNewBuild) extractedDetailsSummary.push(`New Build: Yes`);
      if (propertyDetails?.landPrice) extractedDetailsSummary.push(`Land Price: $${propertyDetails.landPrice.toLocaleString()}`);
      if (propertyDetails?.buildPrice) extractedDetailsSummary.push(`Build Price: $${propertyDetails.buildPrice.toLocaleString()}`);
      
      const extractedDetailsText = extractedDetailsSummary.length > 0 
        ? `\n\n**EXTRACTED PROPERTY SPECIFICATIONS:**\n${extractedDetailsSummary.join('\n')}\n`
        : '';
      
      // Use different instructions based on content source
      /**
       * ONE list, and it defers to the record on the attributes the record
       * governs.
       *
       * There were two near-identical lists here, and both opened by naming
       * the listing "the PRIMARY source of truth for this property's
       * specifications" and instructing the model to "extract and use the
       * EXACT property specifications from the listing (bedrooms, bathrooms,
       * land size, price)". Further down, the specification table says the
       * opposite in terms: "The table above contains every physical attribute
       * on record for this property … do not state a land size, floor area,
       * bedroom or bathroom count, parking count, year built or condition
       * that is not in it."
       *
       * Two statements of one rule is how the two come to disagree, and this
       * pair disagreed in the worst possible arrangement: `documentContextSection`
       * is PREPENDED, so the listing's instruction sits at the head of the
       * prompt where `limitPromptContext` never trims it, while the table's
       * prohibition sits downstream in the part that can be trimmed away.
       *
       * A listing ADVERTISES; the record GOVERNS. The listing keeps everything
       * only it can supply — the description, the features, the renovations,
       * the selling points, the address as written, the suburb and postcode —
       * and the price instruction is untouched, because what a price is used
       * for is settled by the financial engine and not by this prompt.
       */
      const RECORD_GOVERNS_PHYSICAL_ATTRIBUTES = `
**The physical attributes of this property do NOT come from this listing.**
Bedroom and bathroom counts, parking, land area, floor area, year built and
condition are taken from the "every physical attribute on record" table below
and from nowhere else — not from this listing's specifications, not from a
number written in its description, and not from anything above. Where that
table carries no row for an attribute, the attribute is NOT RECORDED: say so
if it matters, and never supply it from here. A listing's own figures are the
agent's marketing copy, and this report does not repeat them as facts about
the asset.`;
      /**
       * A description is evidence of what was ADVERTISED, never of the asset.
       *
       * The list below used to say "Include all relevant property features,
       * upgrades, and selling points" and "Note any specific renovations,
       * improvements, or unique characteristics" — with no instruction to say
       * where any of it came from, three lines under a rule declaring
       * CONDITION to be governed by the record. The record holds no condition
       * field at all, so that rule resolves to "not recorded" on every
       * property in the corpus, and the two statements contradict each other
       * in one numbered list.
       *
       * Measured on the Cowra Compass (11 Sep 2026): the document asserts
       * "Well-presented renovated home", "a detached, renovated 3-bedroom
       * residential home" and "given the renovated interiors" — three
       * unattributed claims about the condition of somebody's house, sourced
       * to nothing, in a document a client acts on. §2 of the acceptance
       * standard names `Renovated` as a factual claim precisely because it
       * carries no digit and reads as description.
       *
       * So the listing keeps everything only it can supply, and every one of
       * those things arrives ATTRIBUTED: the sentence says the listing says
       * it. That is a true sentence about evidence the report actually holds,
       * and it is the same rule `claimSupportRules` states for the prose —
       * one rule, in the two places the model reads.
       */
      const sourceLabel = fromPdfUpload ? 'PDF-UPLOADED LISTING' : 'URL-SCRAPED LISTING';
      const sourceNoun = fromPdfUpload ? 'document' : 'listing';
      const sourceSpecificInstructions = `**CRITICAL INSTRUCTIONS FOR THIS ${sourceLabel}:**
1. The above content came from the property ${sourceNoun}, and is the primary source for its DESCRIPTION, features and selling points
2. ${RECORD_GOVERNS_PHYSICAL_ATTRIBUTES}
3. Use the property address exactly as shown in the ${sourceNoun}
4. A ${sourceNoun} is an ADVERTISEMENT. Its features, upgrades and selling points are evidence of what the seller states, not of the property's condition — so carry them ATTRIBUTED, in the sentence that uses them ("the ${sourceNoun} describes …", "the ${sourceNoun} states …"), and never as an assertion of your own. Write "renovated", "updated", "well presented", "as new" or any other characterisation of condition ONLY in that attributed form
5. If a price is mentioned (guide, asking, or range), use it for financial calculations
6. Renovations, improvements and unique characteristics the ${sourceNoun} names are carried the same way, under the same attribution, and a reader is told the property has not been inspected for this report
7. Consider the property description when assessing investment potential
8. Verify the suburb/postcode from the ${sourceNoun} for accurate location analysis${fromPdfUpload ? `
9. For new builds: Use the land + build package price for total property value` : ''}`;
      
      const limitedDocumentContent = limitPromptContext(
        String(documentContent),
        DOCUMENT_CONTEXT_MAX_BYTES,
        `${fromPdfUpload ? 'PDF' : 'Scraped'} listing content`,
        'head-tail'
      );
      const documentContextSection = `
---
**PROPERTY LISTING DATA (SOURCE: ${contentSourceLabel})**

The following is the available content ${fromPdfUpload ? 'extracted from the property listing PDF' : 'scraped from the property listing'}. Use it for the property's DESCRIPTION, features and the specific information the listing mentions — not for its physical attributes, which the specification table below governs. If this block was truncated, fill gaps from the record and fresh web research without inventing facts:

${limitedDocumentContent}
${extractedDetailsText}
---

${sourceSpecificInstructions}

---

`;
      prompt = documentContextSection + prompt;
      console.log(`✓ ${fromPdfUpload ? 'PDF' : 'Scraped'} content injected with extracted details. New prompt length:`, prompt.length);
    } else {
      console.log('ℹ️ No document content available - generating report from property address and web search only');
    }

    // ========== MANUAL OVERRIDES INJECTION ==========
    // Only inject property-level overrides for address-scope reports
    // Area reports (suburb/postcode/statewide) do NOT use property-level overrides
    // isAreaReport already defined at top of function
    const manualOverrides = isAreaReport ? null : (propertyDetails?.manualOverrides || null);
    // Compass is a NON-financial location/property-fit report. Injecting
    // financial labels (Purchase Price: $X, Interest Rate: 6.5%, Capital Growth:
    // 5% p.a.) caused the model to regurgitate them verbatim into narrative
    // prose. For every Compass tier we strip every financial override line at the
    // source so the LLM never sees them.
    // Use the report tier rather than the caller-selected generation engine:
    // omitted tiers default to Compass and the legacy engine remains selectable.
    const __compassReport = ['compass', 'compass-40'].includes(propertyDetails?.reportTier || 'compass');
    const __FINANCIAL_OVERRIDE_KEYS = new Set<string>([
      'purchasePrice','landPrice','buildPrice','weeklyRent','depositValue',
      'loanToValueRatio','interestRate','loanType','loanTermYears','loanAmount',
      'interestOnlyPeriodYears','repaymentFrequency','extraRepaymentPerMonth','offsetBalance',
      'capitalGrowth','cpiGrowthRate',
      'stampDuty','solicitorFees','agentFee','isFirstHomeBuyer',
      'bodyCorporateFees','strataAdminFund','strataSinkingFund','strataSpecialLevies',
      'landTax','councilRates','waterRates','buildingLandlordInsurance',
      'propertyManagementFees','repairsMaintenance','lettingFees',
      'depreciation','taxRate','occupancyRate','marketValueNow',
    ]);
    if (__compassReport && manualOverrides) {
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(manualOverrides)) {
        if (!__FINANCIAL_OVERRIDE_KEYS.has(k)) filtered[k] = v;
      }
      const dropped = Object.keys(manualOverrides).length - Object.keys(filtered).length;
      if (dropped > 0) {
        console.log(`🛡️ Compass: stripped ${dropped} financial override keys from prompt context`);
      }
      Object.keys(manualOverrides).forEach((k) => {
        if (!filtered.hasOwnProperty(k)) delete (manualOverrides as Record<string, unknown>)[k];
      });
    }
    if (manualOverrides && Object.keys(manualOverrides).length > 0) {
      console.log('📝 Injecting manual overrides into prompt...');
      const overrideLines: string[] = [];
      
      // Build Type
      if (manualOverrides.buildType) {
        const buildTypeLabels: Record<string, string> = {
          'new_build': 'New Build (House & Land Package)',
          'existing_property': 'Existing Property',
          'land_only': 'Land Only (Vacant Land - No Structure)'
        };
        overrideLines.push(`Build Type: ${buildTypeLabels[manualOverrides.buildType] || manualOverrides.buildType}`);
      }
      
      // Property Values
      if (manualOverrides.purchasePrice) overrideLines.push(`Purchase Price: $${manualOverrides.purchasePrice.toLocaleString()}`);
      if (manualOverrides.landPrice) overrideLines.push(`Land Price: $${manualOverrides.landPrice.toLocaleString()}`);
      if (manualOverrides.buildPrice) overrideLines.push(`Build Price: $${manualOverrides.buildPrice.toLocaleString()}`);
      if (manualOverrides.weeklyRent) overrideLines.push(`Weekly Rent: $${manualOverrides.weeklyRent}`);
      if (manualOverrides.depositValue) overrideLines.push(`Deposit: $${manualOverrides.depositValue.toLocaleString()}`);
      
      // Loan Settings
      if (manualOverrides.loanToValueRatio) overrideLines.push(`Loan-to-Value Ratio (LVR): ${manualOverrides.loanToValueRatio}%`);
      if (manualOverrides.interestRate) overrideLines.push(`Interest Rate: ${manualOverrides.interestRate}%`);
      if (manualOverrides.loanType) overrideLines.push(`Loan Type: ${manualOverrides.loanType === 'interest_only' ? 'Interest Only' : 'Principal & Interest'}`);
      if (manualOverrides.loanTermYears) overrideLines.push(`Loan Term: ${manualOverrides.loanTermYears} years`);
      if (manualOverrides.loanAmount) overrideLines.push(`Loan Amount: $${manualOverrides.loanAmount.toLocaleString()}`);
      if (manualOverrides.interestOnlyPeriodYears) overrideLines.push(`Interest-Only Period: ${manualOverrides.interestOnlyPeriodYears} years`);
      if (manualOverrides.repaymentFrequency) overrideLines.push(`Repayment Frequency: ${manualOverrides.repaymentFrequency}`);
      if (manualOverrides.extraRepaymentPerMonth) overrideLines.push(`Extra Repayment/Month: $${manualOverrides.extraRepaymentPerMonth}`);
      if (manualOverrides.offsetBalance) overrideLines.push(`Offset Balance: $${manualOverrides.offsetBalance.toLocaleString()}`);
      
      // Growth Assumptions
      if (manualOverrides.capitalGrowth) overrideLines.push(`Capital Growth Rate: ${manualOverrides.capitalGrowth}% p.a.`);
      if (manualOverrides.cpiGrowthRate) overrideLines.push(`CPI Growth Rate: ${manualOverrides.cpiGrowthRate}% p.a.`);
      
      // Acquisition Costs
      if (manualOverrides.stampDuty) overrideLines.push(`Stamp Duty: $${manualOverrides.stampDuty.toLocaleString()}`);
      if (manualOverrides.solicitorFees) overrideLines.push(`Solicitor Fees: $${manualOverrides.solicitorFees.toLocaleString()}`);
      if (manualOverrides.agentFee) overrideLines.push(`Agent Fee/Commission: $${manualOverrides.agentFee.toLocaleString()}`);
      if (manualOverrides.isFirstHomeBuyer) overrideLines.push(`First Home Buyer: Yes (apply stamp duty concessions)`);
      
      // Annual Expenses
      if (manualOverrides.bodyCorporateFees) overrideLines.push(`Body Corporate/Strata Fees: $${manualOverrides.bodyCorporateFees.toLocaleString()} p.a.`);
      if (manualOverrides.strataAdminFund) overrideLines.push(`Strata Admin Fund: $${manualOverrides.strataAdminFund.toLocaleString()} p.a.`);
      if (manualOverrides.strataSinkingFund) overrideLines.push(`Strata Sinking Fund: $${manualOverrides.strataSinkingFund.toLocaleString()} p.a.`);
      if (manualOverrides.strataSpecialLevies) overrideLines.push(`Strata Special Levies: $${manualOverrides.strataSpecialLevies.toLocaleString()} p.a.`);
      if (manualOverrides.landTax) overrideLines.push(`Land Tax: $${manualOverrides.landTax.toLocaleString()} p.a.`);
      if (manualOverrides.councilRates) overrideLines.push(`Council Rates: $${manualOverrides.councilRates.toLocaleString()} p.a.`);
      if (manualOverrides.waterRates) overrideLines.push(`Water Rates: $${manualOverrides.waterRates.toLocaleString()} p.a.`);
      if (manualOverrides.buildingLandlordInsurance) overrideLines.push(`Building/Landlord Insurance: $${manualOverrides.buildingLandlordInsurance.toLocaleString()} p.a.`);
      if (manualOverrides.propertyManagementFees) overrideLines.push(`Property Management Fees: ${manualOverrides.propertyManagementFees}%`);
      if (manualOverrides.repairsMaintenance) overrideLines.push(`Repairs & Maintenance: $${manualOverrides.repairsMaintenance.toLocaleString()} p.a.`);
      if (manualOverrides.lettingFees) overrideLines.push(`Letting Fees: $${manualOverrides.lettingFees.toLocaleString()} p.a.`);
      
      // Cash Flow Analysis
      if (manualOverrides.depreciation) overrideLines.push(`Depreciation: $${manualOverrides.depreciation.toLocaleString()} p.a.`);
      if (manualOverrides.taxRate) overrideLines.push(`Marginal Tax Rate: ${manualOverrides.taxRate}%`);
      // CLARIFIED: Occupancy rate is in WEEKS per year, NOT percentage
      if (manualOverrides.occupancyRate) overrideLines.push(`Occupancy Rate: ${manualOverrides.occupancyRate} WEEKS per year (equals ${((manualOverrides.occupancyRate/52)*100).toFixed(0)}% annual occupancy - DO NOT confuse with ${manualOverrides.occupancyRate}%)`);
      if (manualOverrides.marketValueNow) overrideLines.push(`Current Market Value: $${manualOverrides.marketValueNow.toLocaleString()}`);
      
      // Property Specs
      if (manualOverrides.landSizeSqm) overrideLines.push(`Land Size: ${manualOverrides.landSizeSqm} sqm`);
      if (manualOverrides.buildSizeSqm) overrideLines.push(`Build Size: ${manualOverrides.buildSizeSqm} sqm`);
      
      // New Build Specifics
      if (manualOverrides.buildType === 'new_build') {
        if (manualOverrides.constructionDurationMonths) overrideLines.push(`Construction Duration: ${manualOverrides.constructionDurationMonths} months`);
        if (manualOverrides.constructionYear) overrideLines.push(`Construction Year: ${manualOverrides.constructionYear}`);
        
        // Construction Stage Percentages
        const stagePercentages: string[] = [];
        if (manualOverrides.stageDepositPercent) stagePercentages.push(`Deposit: ${manualOverrides.stageDepositPercent}%`);
        if (manualOverrides.stageSlabPercent) stagePercentages.push(`Slab: ${manualOverrides.stageSlabPercent}%`);
        if (manualOverrides.stageFramePercent) stagePercentages.push(`Frame: ${manualOverrides.stageFramePercent}%`);
        if (manualOverrides.stageLockupPercent) stagePercentages.push(`Lockup: ${manualOverrides.stageLockupPercent}%`);
        if (manualOverrides.stageFixingPercent) stagePercentages.push(`Fixing: ${manualOverrides.stageFixingPercent}%`);
        if (manualOverrides.stageCompletionPercent) stagePercentages.push(`Completion: ${manualOverrides.stageCompletionPercent}%`);
        if (stagePercentages.length > 0) {
          overrideLines.push(`Construction Stage Payment Schedule: ${stagePercentages.join(', ')}`);
        }
        
        // Construction Schedule Preset Mode
        if (manualOverrides.schedulePreset) {
          const presetDescriptions: Record<string, string> = {
            'rapid': 'Rapid Front-Load (accelerated early stages)',
            'even': 'Even Distribution (equal monthly spread)',
            'custom': 'Custom Timing (user-defined month positions)'
          };
          overrideLines.push(`Construction Schedule Mode: ${presetDescriptions[manualOverrides.schedulePreset] || manualOverrides.schedulePreset}`);
        }
        
        // Custom Stage Months (when custom schedule preset is used)
        if (manualOverrides.schedulePreset === 'custom' && manualOverrides.customStageMonths) {
          const stageNames = ['Deposit', 'Slab', 'Frame', 'Lockup', 'Fixing', 'Completion'];
          const stageTiming: string[] = [];
          for (const [index, month] of Object.entries(manualOverrides.customStageMonths)) {
            const stageName = stageNames[parseInt(index)] || `Stage ${index}`;
            stageTiming.push(`${stageName}: Month ${month}`);
          }
          if (stageTiming.length > 0) {
            overrideLines.push(`Custom Stage Timing: ${stageTiming.join(', ')}`);
          }
        }
      }
      
      // Land Only Specifics - Add special instructions
      if (manualOverrides.buildType === 'land_only') {
        overrideLines.push(`\n**LAND ONLY PROPERTY ANALYSIS NOTES:**`);
        overrideLines.push(`- This is VACANT LAND with no existing structure - use "Vacant Land" as the Property Type throughout`);
        overrideLines.push(`- NO rental income should be calculated (no dwelling exists) - DO NOT include Weekly Rent, Rental Yield, Occupancy rows in any tables`);
        overrideLines.push(`- NO depreciation applies (no building to depreciate)`);
        overrideLines.push(`- REMOVE all rental-related rows from Property Snapshot and financial tables (Weekly Rent, Gross Rental Yield, Net Rental Yield, Rental Income, Occupancy Rate)`);
        overrideLines.push(`- Focus on DEVELOPMENT POTENTIAL and zoning analysis`);
        overrideLines.push(`- Use VACANT LAND stamp duty rates (often different from residential)`);
        overrideLines.push(`- Key metrics: Land value appreciation, holding costs (council rates, land tax), development feasibility`);
        overrideLines.push(`- SKIP the entire "Rental Assessment & Yield Calculation" section - this section does not apply to vacant land`);
        overrideLines.push(`- SKIP the "Cashflow Analysis" section - vacant land generates no rental cashflow`);
        if (manualOverrides.zoningCode) overrideLines.push(`- Zoning Code: ${manualOverrides.zoningCode}`);
        if (manualOverrides.developmentPotential) overrideLines.push(`- Development Potential: ${manualOverrides.developmentPotential}`);
      }
      
      if (overrideLines.length > 0) {
        const overridesSection = `
---
**PRE-GENERATION MANUAL OVERRIDES (USE THESE VALUES EXACTLY):**

The following values have been manually specified by the user. Use these EXACT values in your calculations and report - do NOT estimate or override these with AI-fetched data:

${overrideLines.join('\n')}

**IMPORTANT:** These manual overrides take precedence over any data fetched from external sources. Apply them directly to all financial calculations, projections, and cost analyses.

---

`;
        prompt = overridesSection + prompt;
        console.log(`✓ Manual overrides injected (${overrideLines.length} values). New prompt length:`, prompt.length);
      }
      
      // If capital growth was NOT manually overridden, instruct Perplexity to dynamically research it
      if (!manualOverrides.capitalGrowth) {
        const capitalGrowthResearchInstruction = `
---
**CAPITAL GROWTH RATE - REQUIRED RESEARCH:**

The capital growth rate was NOT provided by the user. You MUST:
1. Research and fetch the historical capital growth rate for this specific suburb/area
2. Use reliable sources like CoreLogic, PropTrack, Domain, or local council data
3. Calculate an appropriate capital growth projection based on:
   - Historical 5-10 year median price trends for the suburb
   - Current market conditions and growth trajectory
   - Comparison to broader metropolitan/regional averages
4. Cite the source and timeframe of your capital growth data
5. Use this researched value in ALL financial calculations and 10-year projections

DO NOT default to 0% or any arbitrary value. The capital growth rate is critical for accurate investment analysis.

---

`;
        prompt = capitalGrowthResearchInstruction + prompt;
        console.log('✓ Capital growth research instruction injected (no manual override provided)');
      }
    } else {
      console.log('ℹ️ No manual overrides provided');
      
      // When no overrides at all, still instruct Perplexity to research capital growth
      const capitalGrowthResearchInstruction = `
---
**CAPITAL GROWTH RATE - REQUIRED RESEARCH:**

No capital growth rate was provided. You MUST research and determine an appropriate capital growth rate for this property's suburb/area:
1. Fetch historical capital growth data from CoreLogic, PropTrack, Domain, or similar reliable sources
2. Analyze 5-10 year median price trends for the suburb
3. Consider current market conditions and growth trajectory
4. Use this researched value in ALL financial calculations and 10-year projections
5. Cite your source and the timeframe of the data

DO NOT default to 0% or any arbitrary value. The capital growth rate is critical for accurate investment analysis.

---

`;
      prompt = capitalGrowthResearchInstruction + prompt;
      console.log('✓ Capital growth research instruction injected (no overrides provided)');
    }

    // ========== DIRECT TEMPLATE INJECTION (Hard Enforced) ==========
    // Fetch AI structure template directly from database - bypasses RAG similarity search
    let templateContext = '';
    /**
     * True when `templateContext` is the registry's own structure guide rather
     * than an uploaded `report_structure_templates` row. It decides whether
     * the byte cap applies — see the note at the injection site.
     */
    let templateContextIsCanonical = false;
    let compass40OverlayActive = false;
    try {
      console.log('🔍 Fetching AI structure template directly from database...');

      const rawTier = propertyDetails?.reportTier || 'compass';
      const requestedEngine = propertyDetails?.generationEngine;
      const isCompassTier = rawTier === 'compass' || rawTier === 'compass-40';
      // The report tier is the authoritative data-minimization boundary. An
      // engine preference must never downgrade a non-financial Compass report.
      const generationEngine = isCompassTier || requestedEngine === 'compass-40'
        ? 'compass-40'
        : 'legacy';
      compass40OverlayActive = generationEngine === 'compass-40';
      if (compass40OverlayActive && propertyDetails?.generationEngine !== 'compass-40') {
        propertyDetails = { ...(propertyDetails || {}), generationEngine: 'compass-40' };
        console.log('⚙️ Compass-tier report promoted to compass-40 engine for prompt-size safety');
      }
      console.log(`⚙️ Generation engine: ${generationEngine} (compass-40 overlay: ${compass40OverlayActive}, tier: ${rawTier})`);
      const tierMapping: Record<string, string> = {
        'compass-40': 'compass',
        'briefing': 'executive',
        'compass': 'compass',
        'snapshot': 'snapshot',
        'executive': 'executive',
        'financial': 'financial',
        'financial-analysis': 'financial',
      };
      const reportTier = tierMapping[rawTier] || rawTier;
      const scopeCategoryMap: Record<string, string> = {
        'suburb': 'suburb',
        'postcode': 'postcode',
        'statewide': 'statewide',
      };
      const reportCategory = scopeCategoryMap[reportScope] || 'investment';

      console.log(`📋 Tier mapping: "${rawTier}" → "${reportTier}"`);

      // ── COMPASS-40 SHORT-CIRCUIT ──────────────────────────────────────────
      // When the user picks the Compass-40 engine we DO NOT load the legacy
      // 12-group section list or the legacy DB AI-structure template. The
      // legacy template is what was forcing financial KPI rows, P&I cashflow,
      // 10-year projections and the duplicate "Property Snapshot" pages into
      // the output. Instead we use the canonical Compass registry (no
      // financials) and a thin canonical template context. The Compass-40
      // overlay below still runs on top to enforce style rules.
      //
      // The ×1.6 token bump that used to be applied here is gone. It was added
      // against mid-sentence truncation, but it compounded with a maxTokens
      // already set at 4× the word cap, so a 650-word section was given room
      // for about 3,100. The headroom now lives in the single derivation in
      // `canonicalSectionsToGenerationSections`, where it can be reasoned about
      // against the cap it is a multiple of.
      if (compass40OverlayActive) {
        REPORT_SECTIONS = getCanonicalSectionsForTier('compass-40');
        templateContext = buildCanonicalTemplateContext('compass-40');
        templateContextIsCanonical = true;
        console.log(`✓ Compass-40: using canonical ${REPORT_SECTIONS.length}-section registry (legacy template bypassed)`);
      } else {
        // Always start from legacy default sections; legacy engine reuses this base.
        REPORT_SECTIONS = getDefaultSectionsForScope(reportScope);

        const templateClient = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        let { data: templates, error: templateError } = await templateClient
          .from('report_structure_templates')
          .select('id, name, parsed_content, report_tier, report_category')
          .eq('template_type', 'ai_structure')
          .eq('is_active', true)
          .order('priority', { ascending: false });

        if (templateError) {
          console.log('⚠️ Template query error:', templateError.message);
        } else if (templates && templates.length > 0) {
          let selectedTemplate = templates.find(t =>
            t.report_tier === reportTier && t.report_category === reportCategory
          ) || templates.find(t =>
            t.report_tier === reportTier && !t.report_category
          ) || templates.find(t =>
            !t.report_tier && t.report_category === reportCategory
          ) || templates.find(t =>
            !t.report_tier && !t.report_category
          ) || templates[0];

          if (selectedTemplate?.parsed_content) {
            templateContext = selectedTemplate.parsed_content;
            console.log(`✓ Template loaded: "${selectedTemplate.name}"`);
            console.log(`  Tier: ${selectedTemplate.report_tier || 'any'}, Category: ${selectedTemplate.report_category || 'any'}`);
            console.log(`  Content size: ${templateContext.length} chars`);

            console.log('\n📋 Parsing template structure...');
            const parsedStructure = parseTemplateStructure(
              templateContext,
              selectedTemplate.name,
              selectedTemplate.id
            );

            if (parsedStructure.sections.length > 0) {
              REPORT_SECTIONS = parsedStructure.sections;
              console.log(`✓ REPORT_SECTIONS updated with ${REPORT_SECTIONS.length} sections from template`);
              console.log(`  Template headings found: ${parsedStructure.headings.length}`);
            } else {
              console.log('⚠️ Template parsing returned no sections, using DEFAULT_REPORT_SECTIONS');
              REPORT_SECTIONS = getDefaultSectionsForScope(reportScope);
            }
          } else {
            console.log('⚠️ Template found but parsed_content is empty');
            REPORT_SECTIONS = getDefaultSectionsForScope(reportScope);
          }
        } else {
          console.log('ℹ️ No active AI structure templates found in database');
          REPORT_SECTIONS = getDefaultSectionsForScope(reportScope);
        }
      }
    } catch (templateError: any) {
      console.log('⚠️ Template fetch failed (non-critical):', templateError?.message || 'Unknown error');
      REPORT_SECTIONS = getDefaultSectionsForScope(reportScope);
    }


    // Inject template context into prompt if available
    if (templateContext) {
      /*
       * The CANONICAL guide is never trimmed, and this cap was cutting it.
       *
       * `TEMPLATE_CONTEXT_MAX_BYTES` is 12,000 and exists for the OTHER source
       * of this string: `report_structure_templates.parsed_content`, a row an
       * operator uploaded, of no bounded size. The canonical guide is built
       * here from the section registry, so its size is a fact about our own
       * code — and v4.0's two new sections took it to 12,397 bytes.
       *
       * Measured 17 Sep 2026: at `mode: 'head'` that cut **665 bytes off the
       * END** of every Compass run's guide — the CONSISTENCY CHECKS block
       * (bed/bath/car/land size and property type must match everywhere) and
       * the whole RECOMMENDATION FORMAT block — and put in their place a
       * notice instructing the model to "request fresh web research for
       * missing details". That is §6 of `PLANNING_CONTROLS_IN_THE_REPORT.md`
       * happening again in a different place: a control lost to a byte
       * boundary, and a licence to invent offered in its stead.
       *
       * Two of those controls had just been carried over from the deleted
       * COMPASS-40 overlay on the ground that removing a ceremony must not
       * remove a control. They were being removed by arithmetic.
       */
      const limitedTemplateContext = templateContextIsCanonical
        ? templateContext
        : limitPromptContext(templateContext, TEMPLATE_CONTEXT_MAX_BYTES, 'Reference template structure', 'head');
      const templateSection = `
---
**REFERENCE TEMPLATE STRUCTURE (Follow this structure closely):**

The following is extracted from your reference templates. Use this structure and formatting as a guide for generating the report. If the template was truncated, follow the section-generation task and canonical rules as the authority:

${limitedTemplateContext}

---

`;
      prompt = templateSection + prompt;
      console.log('✓ Template context injected into prompt. New length:', prompt.length);
    }

    /*
     * The COMPASS-40 overlay and its banner were removed here (17 Sep 2026).
     *
     * They were a SECOND section contract, ~3.9 KB, appended after everything
     * else and so never trimmed. Written against the legacy 38-section
     * document, they named sections the canonical registry no longer has
     * ("Population & Development Trends", "Suburb Character & Lifestyle",
     * "Property-Level Information", "Risk Summary", "SEIFA / Socioeconomic
     * Profile"), gave PAGE caps that fought the registry's WORD ceilings
     * ("Transport — ONE 2-3 page section" against a 450-word budget), and
     * named neither of the two sections v4.0 added — so the model could be
     * asked for "Planning, Zoning & What Is Mapped Over the Land" and handed,
     * as the last thing it read, a list of the document's sections that did
     * not contain it.
     *
     * REMOVING A CEREMONY MUST NOT REMOVE A CONTROL, and every control they
     * held is in `buildCanonicalTemplateContext` above, which is injected on
     * the same runs: the forbidden editorial labels in all three forms with no
     * permitted number, the financial exclusions, the placeholder and citation
     * prohibitions, render-each-topic-once, no transition paragraphs, the word
     * ceiling with its sub-heading and visualisation caps, the bed/bath/car/
     * land-size and property-type consistency checks, and the Final
     * Recommendation format. The one line only the banner had — finish every
     * sentence rather than stopping mid-thought — moved there with them.
     *
     * The one thing that did NOT move is the pair they were wrong about: the
     * asking price and the indicative rent. See the note in the guide.
     */
    // ========== END RAG TEMPLATE CONTEXT INJECTION ==========
    
    const _brandSys = await getBrandConfig();
    const _brandName = _brandSys.companyName;
    const areaSystemMessages: Record<string, string> = {
      'suburb': `You are a trusted property investment advisor at ${_brandName} writing suburb-level analysis for clients who may not have a finance background. Lead with clear, plain-English insights and use supporting data selectively — never dump raw statistics without context. Explain what numbers mean in practical terms (e.g., "growing 40% faster than the metro average, which signals strong demand"). Use tables only for direct comparisons, not for listing single values. Every section should feel like advice from a knowledgeable friend, not an academic paper. Still be thorough and accurate — but prioritise readability and actionable takeaways.`,
      'postcode': `You are a trusted property investment advisor at ${_brandName} writing postcode-zone analysis for clients who may not have a finance background. Compare suburbs within the zone using clear narrative language. Use comparison tables sparingly and only when they genuinely aid understanding. Lead each section with the key insight before supporting it with data. Explain implications in practical terms — what does this mean for an investor considering this area?`,
      'statewide': `You are a trusted property investment advisor at ${_brandName} writing statewide macro analysis for clients who may not have a finance background. Provide a bird's-eye view of the state's property market in accessible, conversational language. Use data to support narrative points, not as the centrepiece. Focus on what matters to investors: where the opportunities are, what risks to watch, and how macro trends translate to real-world investment decisions.`,
    };
    const systemMessageDefault = areaSystemMessages[reportScope] || `You are a trusted property investment advisor at ${_brandName} writing a premium client-facing report. Your reader is a potential property investor who may not have a finance or economics background.

WRITING STYLE RULES:
1. Lead every section with a clear, plain-English insight or takeaway BEFORE presenting any data
2. Use a warm, professional, consultative tone — like a knowledgeable advisor speaking to a client
3. State what a figure means in the sentence that introduces it. NEVER add a paragraph after a table or data point that explains it — no "What This Means", "Why this matters", "What to watch", "Key takeaway" or "NPC view", as a heading, a bold lead-in or a bare line
4. Use tables ONLY for direct comparisons or financial breakdowns (max 5-6 rows). Never use a table when a well-written sentence would suffice
5. Replace jargon with plain language or briefly define technical terms on first use (e.g., "gross rental yield — the annual rent as a percentage of the property price")
6. Use contextual comparisons to make numbers meaningful (e.g., "This is 15% above the state average" rather than just stating the number)
7. Include brief connecting sentences between sections for narrative flow
8. Never use placeholders like "N/A", "not available" or "XX", and never tell the reader that data is missing — state only the figures supplied and leave out any that are not
9. Use the EXACT expense values provided in the PRE-CALCULATED ANNUAL COSTS section — do not substitute with defaults
10. Every section is MANDATORY — do not skip any

DATA INTEGRITY & CONSISTENCY RULES (CRITICAL — VIOLATIONS DESTROY REPORT CREDIBILITY):
11. SINGLE SOURCE OF TRUTH: When a specific data point is stated (e.g., station distance, SEIFA score, flood risk level, labor force size), you MUST use the IDENTICAL value in every section of the report. Never contradict yourself across sections.
12. BENCHMARK COMPARISONS MUST BE MATHEMATICALLY CORRECT: If you say a value "exceeds" or "outperforms" a benchmark, the value MUST actually be higher. If 4.13% yield is compared to a 4.2% national average, that is BELOW average — say "slightly below" or "competitive with", never "exceeds". Double-check every comparison statement.
13. ONE FINANCIAL SCENARIO: Use a SINGLE deposit/LVR scenario consistently throughout the report. Do NOT switch between 10% and 20% deposit, or 80% and 90% LVR, without explicitly labelling them as separate scenarios in a dedicated comparison table. The PRIMARY scenario uses the values from the PRE-CALCULATED section.
14. RISK RATINGS MUST BE CONSISTENT: If flood risk is stated as "Moderate" in the Environmental section, it must remain "Moderate" everywhere. Never contradict a risk rating (e.g., "moderate" then "low/none" then "unverified") — pick the most accurate assessment from the data provided and use it consistently.
15. NO FABRICATED PRECISION: Do not invent hyper-specific statistics like "9.2% growth uplift from station upgrade" or "8.2% transport-driven uplift" unless you can cite a specific study. Use ranges ("5-8% historically") or qualitative language ("significant positive impact") instead. Overly precise unsourced claims feel fabricated and undermine trust.
20. DATE-STAMP TIME-SENSITIVE DATA: For economic indicators (cash rate, CPI, unemployment), always include "as at [Month Year]" so readers know the currency of the data.

This report should feel like a polished advisory document that inspires confidence, not a data spreadsheet.`;

    // Runtime overrides (resolution order, first hit wins):
    //  1. report_engine_config(config_key='prompt:investment_report.system.<scope>', scope='default')  ← Prompt Library
    //  2. report_engine_config(config_key='prompt:investment_report.system.default', scope='default')  ← Prompt Library fallback
    //  3. report_engine_config(config_key='system_message', scope=<scope>)                              ← legacy Engine Config
    //  4. report_engine_config(config_key='system_message', scope='default')                            ← legacy Engine Config fallback
    //  5. in-code areaSystemMessages[<scope>] / systemMessageDefault
    let systemMessage = systemMessageDefault;
    let systemMessageOverrideScope: string | null = null;
    try {
      const scopeKey = `prompt:investment_report.system.${reportScope}`;
      const defaultKey = 'prompt:investment_report.system.default';
      const [{ data: promptRows }, { data: cfgRows }] = await Promise.all([
        supabase
          .from('report_engine_config')
          .select('config_key, value')
          .in('config_key', [scopeKey, defaultKey])
          .eq('scope', 'default'),
        supabase
          .from('report_engine_config')
          .select('scope, value')
          .eq('config_key', 'system_message')
          .in('scope', [reportScope, 'default']),
      ]);
      const promptScoped = (promptRows ?? []).find((r: any) => r.config_key === scopeKey);
      const promptDefault = (promptRows ?? []).find((r: any) => r.config_key === defaultKey);
      const legacyScoped = (cfgRows ?? []).find((r: any) => r.scope === reportScope);
      const legacyDefault = (cfgRows ?? []).find((r: any) => r.scope === 'default');
      const pick = promptScoped || (areaSystemMessages[reportScope] ? null : promptDefault) || legacyScoped || legacyDefault;
      const pickSource = pick === promptScoped ? `prompt-library:${reportScope}`
        : pick === promptDefault ? 'prompt-library:default'
        : pick === legacyScoped ? `engine-config:${reportScope}`
        : pick === legacyDefault ? 'engine-config:default'
        : null;
      const rawValue = pick ? (typeof pick.value === 'string' ? pick.value : (pick.value?.text ?? pick.value?.value ?? null)) : null;
      if (rawValue && typeof rawValue === 'string' && rawValue.trim()) {
        systemMessage = rawValue
          .replace(/\{\{brand_name\}\}/g, _brandName)
          .replace(/\{\{scope\}\}/g, reportScope || '');
        systemMessageOverrideScope = pickSource;
        console.log(`✏️  system prompt override from ${pickSource}`);
      }
    } catch (cfgErr) {
      console.warn('system prompt override lookup failed (fail-open):', cfgErr);
    }


    console.log('=== MULTI-SECTION REPORT GENERATION ===');
    console.log('Report scope:', reportScope);
    console.log('Base prompt length:', prompt.length);
    console.log('Document content included:', !!documentContent);
    console.log('Template context included:', !!templateContext);
    console.log('Content source:', contentSource);
    console.log('Continuation mode:', isContinuation);
    console.log('Completed sections to skip:', completedSectionIndices);
    console.log('Generating report in', REPORT_SECTIONS.length, 'sections...');

    // Generate report in multiple sections
    let combinedContent = '';
    let allCitations: any[] = [];
    let generationErrors: string[] = [];
    // Ensures enhanced data (score/financials/etc.) is persisted once per request in chunked mode
    let enhancedDataPersisted = false;
    
    // Handle continuation mode: start with existing content if available
    if (isContinuation && existingReportContent && existingReportContent.length > 0) {
      combinedContent = existingReportContent;
      console.log('🔄 Starting from existing content:', combinedContent.length, 'chars');
      
      // Ensure content ends with proper separator for appending new sections
      if (!combinedContent.trim().endsWith('---')) {
        combinedContent = combinedContent.trim() + '\n\n---\n\n';
      }
    } else {
      // Fresh generation: Add report header
      const reportHeader = `# ${_brandName.toUpperCase()}

YOUR DEDICATED PROPERTY PARTNER

# Investment Report: ${formattedInput}

---

`;
      combinedContent = reportHeader;
    }

    // Track section quality for final validation
    const sectionResults: Array<{ id: string; name: string; content: string; valid: boolean; score: number; attempts: number }> = [];

    // Durable progress this invocation banked, for the hand-off. See
    // `_shared/reports/investment/runProgress.pure.ts`: a write that carries
    // nothing new still stamps `updated_at` through the table's trigger and
    // blinds every stall detector watching the row, so the hand-off has to know
    // what it actually achieved before it decides whether to write at all.
    let acquisitionFieldsBankedThisRun = 0;
    const sectionPlanNewlyKnown = existingTotalSections === null;

    // ============================================================================
    // EARLY ENHANCED DATA PERSISTENCE
    // Persist scoring + calculations before section generation so chunked/resume calls
    // don't miss the one-time "first section" persistence condition.
    // ============================================================================
    if (reportId && supabaseClient) {
      try {
        const earlyUpdate: any = { updated_at: new Date().toISOString() };

        // Only write fields that are currently missing on the report row
        if (!existingEnhancedFields.investmentScore && enhancedData?.investmentScore) {
          earlyUpdate.investment_score = enhancedData.investmentScore;
        }
        if (!existingEnhancedFields.financials && enhancedData?.financials) {
          earlyUpdate.financial_calculations = enhancedData.financials;
        }
        if (!existingEnhancedFields.demographics && enhancedData?.demographics) {
          earlyUpdate.demographics_data = enhancedData.demographics;
        }
        if (!existingEnhancedFields.economics && enhancedData?.economics) {
          earlyUpdate.economic_data = enhancedData.economics;
        }
        // RF-7.2B.1B1 — also write it when this run RE-ACQUIRED it. The guard
        // below is "don't overwrite what is already banked", which is right for
        // a reused enrichment (it is the same object) and wrong for a retried
        // one: a partial acquisition that was bought again would never persist
        // its incremented attempt count, so the bounded retry would never reach
        // its bound and the amplification would return.
        if (enhancedData?.locationIntelligence
          && (!existingEnhancedFields.locationIntelligence || !locationEnrichmentReused)) {
          // The measured object, not the gated one — see
          // `measuredLocationIntelligence`. The fallback covers a path that
          // reached here without the gate having run.
          earlyUpdate.location_intelligence = measuredLocationIntelligence
            ?? enhancedData.locationIntelligence;
        }
        // The snapshot goes down with the first enhanced write, so a run that is
        // killed at the wall-clock budget still leaves the provenance of what it
        // had already put in front of a reader.
        earlyUpdate.market_fact_snapshot = safeGeneration.snapshot;

        // Counted BEFORE the write so a zero-progress hand-off can tell the
        // truth about what this invocation banked. `updated_at` is always in
        // the payload, so it never counts as a field.
        acquisitionFieldsBankedThisRun = Object.keys(earlyUpdate)
          .filter((k) => k !== 'updated_at').length;
        const hasAnyEnhancedField = Object.keys(earlyUpdate).length > 1;
        const alreadyHasAnyEnhancedField = !!(
          existingEnhancedFields.investmentScore ||
          existingEnhancedFields.financials ||
          existingEnhancedFields.demographics ||
          existingEnhancedFields.economics ||
          existingEnhancedFields.locationIntelligence
        );

        if (hasAnyEnhancedField) {
          console.log('💾 Early persistence: saving enhanced data to DB before section generation...');
          await supabaseClient
            .from('investment_reports')
            .update(earlyUpdate)
            .eq('id', reportId);
          enhancedDataPersisted = true;
          console.log('✓ Early enhanced data saved:', Object.keys(earlyUpdate).filter(k => k !== 'updated_at').join(', '));
        } else {
          // If the DB already has enhanced fields, treat them as persisted for this run
          enhancedDataPersisted = alreadyHasAnyEnhancedField;
        }
      } catch (earlyPersistError: any) {
        console.warn('⚠️ Early enhanced data persistence failed (non-blocking):', earlyPersistError?.message);
      }
    }
    
    // ============================================================================
    // AREA REPORT SECTION EXCLUSION
    // For suburb/postcode/statewide reports, filter out property-specific financial sections
    // These sections require property-level data (purchase price, loan details, etc.)
    // that don't apply to area-level analysis
    // ============================================================================
    const AREA_EXCLUDED_SECTION_KEYWORDS = [
      'costs & rental', 'loan & sensitivity', 'projections & swot',
      'assumptions', 'cash flow', 'cashflow', 'loan structure', 'repayment',
      'sensitivity analysis', 'purchase & ongoing', 'rental assessment',
      '10-year', 'ten-year', 'ten year', 'operating costs',
      'initial purchase', 'annual costs', 'financial analysis',
      'mortgage', 'stamp duty calculation', 'depreciation',
      'negative gearing', 'tax benefit', 'equity growth projection'
    ];

    const filteredSections = isAreaReport
      ? REPORT_SECTIONS.filter(s => {
          const nameLower = s.name.toLowerCase();
          const sectionHeadingsLower = s.sections.map(h => h.toLowerCase());
          const isExcluded = AREA_EXCLUDED_SECTION_KEYWORDS.some(kw =>
            nameLower.includes(kw) || sectionHeadingsLower.some(h => h.includes(kw))
          );
          if (isExcluded) {
            console.log(`⏭️ AREA REPORT: Excluding property-level section: "${s.name}" [${s.sections.join(', ')}]`);
          }
          return !isExcluded;
        })
      : REPORT_SECTIONS;

    console.log(`📋 Sections to generate: ${filteredSections.length}/${REPORT_SECTIONS.length}${isAreaReport ? ` (${REPORT_SECTIONS.length - filteredSections.length} excluded for area report)` : ''}`);

    // === OBSERVABILITY: start a generation run row (best-effort, never throws) ===
    const _traceSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const _traceRunId: string | null = await traceStartRun(_traceSb, {
      report_id: reportId ?? null,
      scope: reportScope ?? null,
      variant: (requestBody as any)?.variant ?? null,
      engine_version: 'composite-v1',
      trigger_source: isContinuation ? 'chunked-resume' : 'generate',
      template_ids: [],
      system_prompt: systemMessage,
      // The packet carries a statement of WHAT it describes, so a later
      // invocation can decide per dependency whether it may reuse any of it.
      // `report_generation_runs.data_packet` was already persisting this
      // object on every run; what it could not say was which property, under
      // which accepted inputs, and when. See `acquisitionReuse.pure.ts`.
      data_packet: (enhancedData && acquisitionSubject)
        ? {
            ...enhancedData,
            [ACQUISITION_STAMP_KEY]: acquisitionStamp(
              acquisitionSubject,
              new Date().toISOString(),
            ),
          }
        : (enhancedData ?? null),
      model: 'sonar-pro',
    });
    if (_traceRunId) console.log(`🔭 generation-trace run started: ${_traceRunId}`);

    // Rolling average of section wall time, used to predict whether the next
    // section fits in what is left of the budget.
    const sectionDurationsMs: number[] = [];
    let budgetExhausted = false;
    let lastCompletedSectionIndex = completedSectionIndices.length
      ? Math.max(...completedSectionIndices) + 1
      : 0;

    for (let i = 0; i < filteredSections.length; i++) {
      const sectionDef = filteredSections[i];
      const _chunkStart = Date.now();

      // CONTINUATION MODE: Skip already-completed sections
      if (isContinuation && completedSectionIndices.includes(i)) {
        console.log(`\n⏭️ Skipping section ${i + 1}/${filteredSections.length}: ${sectionDef.name} (already complete)`);
        sectionResults.push({
          id: sectionDef.id,
          name: sectionDef.name,
          content: '[Retained from previous generation]',
          valid: true,
          score: 100,
          attempts: 0
        });
        continue;
      }

      // === WALL-CLOCK BUDGET GUARD ===
      // Only ever bail BETWEEN sections, and only once this run has banked at
      // least one section — otherwise a resume that starts near the ceiling
      // could spin forever making no progress.
      const elapsedMs = Date.now() - runStartedAt;
      const predictedSectionMs = sectionDurationsMs.length
        ? sectionDurationsMs.reduce((a, b) => a + b, 0) / sectionDurationsMs.length
        : DEFAULT_SECTION_ESTIMATE_MS;
      const isLastSection = i === filteredSections.length - 1;
      // The final section is followed by post-processing, so it needs more room.
      const requiredMs = predictedSectionMs + (isLastSection ? POST_PROCESSING_RESERVE_MS : 0);

      if (sectionDurationsMs.length > 0 && elapsedMs + requiredMs > SECTION_LOOP_BUDGET_MS) {
        console.log(
          `⏱️ Wall-clock budget reached after ${Math.round(elapsedMs / 1000)}s ` +
          `(next section needs ~${Math.round(requiredMs / 1000)}s, budget ${SECTION_LOOP_BUDGET_MS / 1000}s). ` +
          `Stopping at section ${lastCompletedSectionIndex}/${filteredSections.length} and handing off to resume.`
        );
        budgetExhausted = true;
        break;
      }

      console.log(`\n📄 Generating section ${i + 1}/${filteredSections.length}: ${sectionDef.name}`);
      
      // Pass context from previous sections for consistency
      const previousContext = combinedContent.length > 500 ? combinedContent.substring(combinedContent.length - 2000) : '';
      
      // === SECTION GENERATION WITH VALIDATION AND RETRY ===
      let bestContent = '';
      let bestScore = 0;
      let sectionAttempts = 0;
      let sectionDeferred = false;
      const maxSectionAttempts = 2; // Retry once if content is insufficient
      // Every model call for this section answers to the run's clock: the
      // hard stop, less the post-processing reserve when this is the closing
      // section, because what follows the last section has to fit too.
      const sectionDeadlineAt = runStartedAt + SECTION_CALL_HARD_STOP_MS
        - (isLastSection ? POST_PROCESSING_RESERVE_MS : 0);
      
      for (let attempt = 1; attempt <= maxSectionAttempts; attempt++) {
        sectionAttempts = attempt;
        if (attempt > 1 && Date.now() > sectionDeadlineAt - SECTION_MIN_CALL_WINDOW_MS) {
          console.log(`⏱️ No window for a validation retry of ${sectionDef.name}; keeping the best attempt.`);
          break;
        }
        
        const result = await generateReportSection(
          sectionDef,
          prompt,
          pinnedPlanningContext,
          systemMessage,
          perplexityApiKey,
          previousContext,
          formattedInput,
          enhancedData,
          2,
          sectionDeadlineAt,
        );
        
        if (result.error === SECTION_BUDGET_DEFERRED) {
          // Not a failure: no call was made because no window was left. The
          // section is handed to the next invocation untouched.
          sectionDeferred = true;
          break;
        }
        if (result.error) {
          console.error(`⚠️ Section ${sectionDef.name} attempt ${attempt} failed:`, result.error);
          if (attempt === maxSectionAttempts) {
            generationErrors.push(`${sectionDef.name}: ${result.error}`);
          }
          continue;
        }
        
        if (result.content) {
          // Clean the content
          let cleanContent = result.content
            .replace(/^(Here|I will|Let me|Now|The following).*?:\s*/im, '')
            .replace(/^(Certainly|Sure|Of course).*?\n/im, '')
            .trim();

          // Compass-40: scrub financial leaks, citation markers, dangling sentences.
          if (compass40OverlayActive) {
            const before = cleanContent.length;
            cleanContent = sanitizeCompass40Content(cleanContent);
            if (cleanContent.length !== before) {
              console.log(`🧼 Compass-40 sanitizer: ${before} → ${cleanContent.length} chars (section "${sectionDef.name}")`);
            }
          }

          
          // Validate section content
          const validation = validateSectionContent(sectionDef, cleanContent);
          console.log(`📊 Section ${sectionDef.name} validation (attempt ${attempt}):`, {
            contentLength: cleanContent.length,
            minRequired: sectionDef.minContentLength,
            score: validation.score,
            isValid: validation.isValid,
            issues: validation.issues.length > 0 ? validation.issues : 'None'
          });
          
          // Keep the best attempt
          if (validation.score > bestScore) {
            bestContent = cleanContent;
            bestScore = validation.score;
            allCitations = [...allCitations, ...result.citations];
          }
          
          // If valid, no need to retry
          if (validation.isValid) {
            console.log(`✓ Section ${sectionDef.name} passed validation with score ${validation.score}`);
            break;
          } else if (attempt < maxSectionAttempts) {
            console.log(`⚠️ Section ${sectionDef.name} below threshold (score: ${validation.score}), retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retry
          }
        }
      }
      // === END SECTION GENERATION WITH VALIDATION ===
      
      // Use best content from all attempts
      if (bestContent) {
        // === CAPITAL GROWTH EXTRACTION: Extract researched capital growth from content ===
        // If capital growth was not manually overridden, try to extract the researched value from the AI-generated content
        if (!hasOverrides || !manualOverrides?.capitalGrowth) {
          const extractedCapitalGrowth = extractCapitalGrowthFromContent(bestContent);
          if (extractedCapitalGrowth !== null && enhancedData?.financials) {
            console.log(`📈 Extracted researched capital growth rate: ${extractedCapitalGrowth}%`);
            
            // Ensure assumptions object exists
            if (!enhancedData.financials.assumptions) {
              enhancedData.financials.assumptions = {};
            }
            
            // Only set if not already set by manual override
            if (!enhancedData.financials.assumptions.capitalGrowth) {
              enhancedData.financials.assumptions.capitalGrowth = extractedCapitalGrowth;
              console.log(`✓ Capital growth rate set in financials: ${extractedCapitalGrowth}%`);
            }
          }
        }
        // === END CAPITAL GROWTH EXTRACTION ===
        
        combinedContent += bestContent + '\n\n---\n\n';

        // === OBSERVABILITY: record this chunk ===
        await traceRecordChunk(_traceSb, _traceRunId, {
          section_key: sectionDef.id,
          section_label: sectionDef.name,
          ordinal: i,
          phase: sectionAttempts > 1 ? 'retry' : 'first-pass',
          model: 'sonar-pro',
          system_prompt: systemMessage,
          user_prompt: `[section ${sectionDef.name}] basePrompt sha-skipped (len=${prompt.length})`,
          attached_packet_keys: enhancedData ? Object.keys(enhancedData).filter((k) => !k.startsWith('_')) : [],
          response: bestContent,
          retry_count: sectionAttempts - 1,
          status: 'completed',
          latency_ms: Date.now() - _chunkStart,
        });
        
        sectionResults.push({
          id: sectionDef.id,
          name: sectionDef.name,
          content: bestContent,
          valid: bestScore >= 60,
          score: bestScore,
          attempts: sectionAttempts
        });
        
        // === PROGRESSIVE SAVE: Save after each section ===
        // CRITICAL: Save last_completed_section for reliable resume functionality
        if (reportId && supabaseClient) {
          try {
            const completedSectionIndex = i + 1; // Section i is now complete (0-indexed to 1-indexed)
            console.log(`💾 Progressive save after section ${completedSectionIndex}/${filteredSections.length}...`);
            
            // Build progressive update payload
            // Persist `total_sections` so the front-end progress widget can
            // show the actual chunk count for the engine that ran (legacy
            // groups headings dynamically and the count varies between
            // templates; Compass-40 is a fixed 17). Without this the widget
            // falls back to the tier-based default and may misreport totals.
            const progressiveUpdatePayload: any = {
              report_content: combinedContent,
              last_completed_section: completedSectionIndex,
              total_sections: filteredSections.length,
              updated_at: new Date().toISOString()
            };
            
            // CRITICAL: Save enhanced data (including investment_score) on FIRST section completion
            // This ensures scores are persisted early, even if chunked generation is interrupted
            let didAttachEnhancedData = false;
            if (!enhancedDataPersisted && enhancedData) {
              console.log('📊 First generated section in this run - saving enhanced data to DB...');
              if (enhancedData.investmentScore) {
                progressiveUpdatePayload.investment_score = enhancedData.investmentScore;
                console.log('  ✓ Saving investment_score:', enhancedData.investmentScore?.grade, enhancedData.investmentScore?.totalScore);
                didAttachEnhancedData = true;
              }
              if (enhancedData.financials) {
                progressiveUpdatePayload.financial_calculations = enhancedData.financials;
                console.log('  ✓ Saving financial_calculations');
                didAttachEnhancedData = true;
              }
              if (enhancedData.demographics) {
                progressiveUpdatePayload.demographics_data = enhancedData.demographics;
                console.log('  ✓ Saving demographics_data');
                didAttachEnhancedData = true;
              }
              if (enhancedData.economics) {
                progressiveUpdatePayload.economic_data = enhancedData.economics;
                console.log('  ✓ Saving economic_data');
                didAttachEnhancedData = true;
              }
              if (enhancedData.locationIntelligence) {
                progressiveUpdatePayload.location_intelligence = measuredLocationIntelligence
                  ?? enhancedData.locationIntelligence;
                console.log('  ✓ Saving location_intelligence');
                didAttachEnhancedData = true;
              }
              // Every write that attaches enhanced data attaches its provenance
              // with it, so the snapshot and the blobs can never describe
              // different runs.
              progressiveUpdatePayload.market_fact_snapshot = safeGeneration.snapshot;
            }
            
            await supabaseClient
              .from('investment_reports')
              .update(progressiveUpdatePayload)
              .eq('id', reportId);
            console.log(`✓ Progress saved: ${combinedContent.length} chars, last_completed_section=${completedSectionIndex}`);
            // Feed the budget predictor and remember how far we actually got,
            // so a budget-exhausted return can report the true section count.
            sectionDurationsMs.push(Date.now() - _chunkStart);
            lastCompletedSectionIndex = completedSectionIndex;

            if (didAttachEnhancedData) {
              enhancedDataPersisted = true;
            }
            
            // === SINGLE-SECTION MODE: Return immediately after saving one section ===
            // This allows the frontend to call again for the next section, avoiding platform timeouts
            if (isSingleSectionMode) {
              const isFullyComplete = completedSectionIndex >= filteredSections.length;
              console.log(`🔧 Single-section mode: Completed section ${completedSectionIndex}/${filteredSections.length}`);
              
              if (!isFullyComplete) {
                // Return immediately - UI will call again for next section
                return new Response(JSON.stringify({
                  success: true,
                  message: `Section ${completedSectionIndex}/${filteredSections.length} completed`,
                  sectionCompleted: completedSectionIndex,
                  totalSections: filteredSections.length,
                  isComplete: false,
                  contentLength: combinedContent.length
                }), {
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
              }
              // If all sections complete, continue to post-processing below
              console.log('✅ All sections complete in single-section mode, proceeding to finalization...');
            }
            // === END SINGLE-SECTION MODE ===
          } catch (saveError: any) {
            console.warn(`⚠️ Progressive save failed (non-blocking):`, saveError?.message);
          }
        }
        // === END PROGRESSIVE SAVE ===
      } else if (sectionDeferred && !bestContent) {
        // A DEFERRAL — the section made no model call because the run had no
        // window left for one. It is a budget hand-off exactly like the
        // between-sections guard's, and is reported as one: progress stands
        // where it was, no error is written over the row, and the caller
        // (browser pump or watchdog) invokes again. Writing "failed after N
        // attempts" here is what turned a full window into ten hours of
        // retries that each ran out of the same window.
        console.log(
          `⏱️ Section ${sectionDef.name} deferred at ${Math.round((Date.now() - runStartedAt) / 1000)}s — `
          + 'handing off to resume with no attempt spent.',
        );
        if (isSingleSectionMode) {
          await traceFinishRun(_traceSb, _traceRunId, { status: 'completed' });
          return new Response(JSON.stringify({
            success: true,
            isComplete: false,
            resumeRequired: true,
            deferred: true,
            sectionCompleted: lastCompletedSectionIndex,
            totalSections: filteredSections.length,
            contentLength: combinedContent.length,
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        budgetExhausted = true;
        break;
      } else {
        // No content generated for this section at all - still save progress
        sectionResults.push({
          id: sectionDef.id,
          name: sectionDef.name,
          content: '',
          valid: false,
          score: 0,
          attempts: sectionAttempts
        });
        
        // === PROGRESSIVE SAVE ON FAILURE: Save current state even if section failed ===
        // This allows continuation from last successful section
        // Note: last_completed_section is NOT incremented on failure (keeps last good value)
        if (reportId && supabaseClient && combinedContent.length > 0) {
          try {
            console.log(`💾 Progressive save after section ${i + 1} failure (preserving progress)...`);
            await supabaseClient
              .from('investment_reports')
              .update({
                report_content: combinedContent,
                // Don't update last_completed_section - it should stay at the last successfully completed section
                updated_at: new Date().toISOString(),
                error_message: `Section ${sectionDef.name} failed to generate after ${sectionAttempts} attempts`
              })
              .eq('id', reportId);
            console.log(`✓ Progress preserved: ${combinedContent.length} chars before failed section (last_completed_section unchanged)`);
          } catch (saveError: any) {
            console.warn(`⚠️ Failed section save error (non-blocking):`, saveError?.message);
          }
        }

        // === SINGLE-SECTION MODE: return on failure too ===
        // The success path returns after one section; without the same return
        // here a failed section fell through and the loop carried on generating
        // every remaining section in the same invocation — precisely the
        // platform-timeout behaviour single-section mode exists to prevent.
        if (isSingleSectionMode) {
          console.log(`🔧 Single-section mode: section ${i + 1}/${filteredSections.length} failed, returning for retry`);
          await traceFinishRun(_traceSb, _traceRunId, { status: 'failed', error: `Section ${sectionDef.name} produced no content` });
          return new Response(JSON.stringify({
            success: false,
            error: `Section ${sectionDef.name} failed to generate after ${sectionAttempts} attempts`,
            sectionCompleted: lastCompletedSectionIndex,
            totalSections: filteredSections.length,
            isComplete: false,
            resumeRequired: true,
            contentLength: combinedContent.length,
          }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Adaptive delay between sections to avoid rate limiting
      // Use jitter to prevent thundering herd
      if (i < filteredSections.length - 1) {
        const baseDelay = 500;
        const jitter = Math.random() * 500; // 0-500ms jitter
        await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
      }
    }

    // === BUDGET HANDOFF ===
    // We stopped short of the last section on purpose. Everything generated so
    // far is already persisted by the progressive save above, and the row stays
    // 'processing' so the watchdog (or the browser pump) picks it up. Returning
    // 200 with resumeRequired is what distinguishes "more work to do" from the
    // old silent kill, where the caller learned nothing at all.
    if (budgetExhausted) {
      const remaining = filteredSections.length - lastCompletedSectionIndex;

      // What this invocation actually banked, decided before anything is
      // written. `sectionDurationsMs` counts sections completed by THIS run —
      // `lastCompletedSectionIndex` is the absolute position and is already
      // non-zero on a continuation that banks nothing.
      const progress = classifyProgress({
        sectionsWrittenThisRun: sectionDurationsMs.length,
        acquisitionFieldsBanked: acquisitionFieldsBankedThisRun,
        sectionPlanNewlyKnown,
      });
      const handoff = describeHandoff(progress, false, sectionDurationsMs.length === 0
        ? (acquisitionExhaustedThisRun ? 'acquisition_exhausted_invocation' : 'no_section_window')
        : 'no_section_window');

      console.log(
        `🔁 Handing off after ${lastCompletedSectionIndex}/${filteredSections.length} sections ` +
        `(${remaining} remaining, ${combinedContent.length} chars banked; ` +
        `this run: ${progress.kind}${progress.made ? '' : ' — NOTHING BANKED'})`
      );
      await traceFinishRun(_traceSb, _traceRunId, {
        status: 'paused',
        error: `Wall-clock budget reached at section ${lastCompletedSectionIndex}/${filteredSections.length}`,
      });

      // ONLY write the row when this invocation advanced the record.
      //
      // `investment_reports` carries a BEFORE UPDATE trigger
      // (`update_investment_reports_updated_at`) that stamps `updated_at` on
      // ANY write, so a status write with nothing new in it refreshes the
      // staleness clock that both stall detectors read — the watchdog's
      // `updated_at < now() - interval '2 minutes'` and the widget's
      // three-minute no-progress window. That is what let the 18 Annabelle
      // Crescent run sit at 0 of 15 for 21 minutes while every surface
      // reported it healthy. Omitting the column from the payload would not
      // help; the trigger does not read the payload. Not writing is the only
      // way to let the clock age, and letting it age is what hands the run to
      // the watchdog — whose own `resume_attempts < 8` then bounds it.
      if (reportId && supabaseClient && mayTouchRow(progress)) {
        await supabaseClient
          .from('investment_reports')
          .update({
            status: 'processing',
            error_message: null,
            total_sections: filteredSections.length,
            updated_at: new Date().toISOString(),
          })
          .eq('id', reportId)
          // A run already in flight when the operator pressed Stop still
          // finishes its section and lands this write afterwards. Without this
          // predicate it re-wrote `processing` over the cancellation — the row
          // went back to looking live, and the watchdog, which claims exactly
          // `status = 'processing'`, would then resurrect work a person had
          // explicitly stopped. Matching only the states a live run can be in
          // makes the write a no-op against a cancelled, failed or completed
          // row, atomically and with no read to race against.
          .in('status', ['pending', 'processing']);
      } else if (reportId) {
        console.log(
          '⏸️ No durable progress this invocation — leaving the row untouched so ' +
          'the staleness clock can age and the watchdog can claim it.'
        );
      }

      return new Response(JSON.stringify({
        // `success` still describes the INVOCATION (it did not crash). What a
        // caller must key on to advance a section is `sectionCompleted` and
        // `durableProgress`, never this flag — see `sectionWasWritten`.
        success: true,
        message: progress.made
          ? `Generated ${lastCompletedSectionIndex}/${filteredSections.length} sections; resume required`
          : `No section could be written in this invocation (${handoff.state === 'no_progress' ? handoff.reason : 'unknown'}); resume required`,
        sectionCompleted: lastCompletedSectionIndex,
        totalSections: filteredSections.length,
        isComplete: false,
        resumeRequired: true,
        state: handoff.state,
        durableProgress: handoff.durableProgress,
        ...(handoff.state === 'no_progress' ? { noProgressReason: handoff.reason } : {}),
        contentLength: combinedContent.length,
        // What the research phase cost this invocation, so speed can be
        // measured from the network tab rather than from edge-log access.
        acquisitionMs,
        sectionMsThisRun: sectionDurationsMs,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === FINAL VALIDATION SUMMARY ===
    const totalScore = sectionResults.reduce((sum, s) => sum + s.score, 0);
    const avgScore = Math.round(totalScore / sectionResults.length);
    const invalidSections = sectionResults.filter(s => !s.valid);
    
    console.log('\n📊 === REPORT GENERATION QUALITY SUMMARY ===');
    console.log(`Total content length: ${combinedContent.length} chars`);
    console.log(`Average section score: ${avgScore}/100`);
    console.log(`Sections passed: ${sectionResults.filter(s => s.valid).length}/${sectionResults.length}`);
    
    if (invalidSections.length > 0) {
      console.log('⚠️ Sections with quality issues:');
      invalidSections.forEach(s => {
        console.log(`  - ${s.name}: score ${s.score}, ${s.content.length} chars, ${s.attempts} attempts`);
      });
    }
    
    // Store quality metadata for debugging
    const qualityMetadata = {
      generatedAt: new Date().toISOString(),
      totalContentLength: combinedContent.length,
      averageScore: avgScore,
      sectionScores: sectionResults.map(s => ({ id: s.id, name: s.name, score: s.score, valid: s.valid, attempts: s.attempts })),
      invalidSectionCount: invalidSections.length,
      errorsEncountered: generationErrors.length
    };
    console.log('📋 Quality metadata:', JSON.stringify(qualityMetadata));
    // === END FINAL VALIDATION ===

    // Enhanced content validation with stricter minimum threshold
    const MINIMUM_TOTAL_CONTENT = 45000; // Based on analysis of good reports (50k+ chars)
    
    if (combinedContent.length < 5000) {
      const errorMsg = `Report generation produced insufficient content (${combinedContent.length} chars). Errors: ${generationErrors.join('; ')}`;
      console.error('❌', errorMsg);
      await markReportFailed(reportId, errorMsg);
      return new Response(JSON.stringify({ 
        error: errorMsg,
        success: false 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Warn if content is below ideal threshold but still usable
    if (combinedContent.length < MINIMUM_TOTAL_CONTENT) {
      console.warn(`⚠️ Report content (${combinedContent.length} chars) is below ideal threshold (${MINIMUM_TOTAL_CONTENT} chars)`);
      console.warn(`   This may result in fewer pages. Average score: ${avgScore}/100`);
      // Add a validation flag for low content
      generationErrors.push(`Content below ideal threshold: ${combinedContent.length} chars (recommended: ${MINIMUM_TOTAL_CONTENT}+)`);
    }

    console.log(`\n✓ Multi-section generation complete`);
    console.log(`  Total content length: ${combinedContent.length} chars`);
    console.log(`  Total citations: ${allCitations.length}`);
    console.log(`  Sections with errors: ${generationErrors.length}`);
    console.log(`  Quality assessment: ${avgScore >= 70 ? '✅ Good' : avgScore >= 50 ? '⚠️ Acceptable' : '❌ Below Standard'}`);


    let reportContent = combinedContent;
    
    // ========== DEDUPLICATE HEADERS ==========
    // The AI sometimes generates duplicate company headers and report titles
    // This removes all occurrences except the first one
    console.log('🧹 Deduplicating headers from report content...');
    
    // Helper function to remove duplicate header patterns
    const deduplicateHeaders = (content: string): string => {
      // Patterns to deduplicate (keep only first occurrence)
      const headerPatterns = [
        // Company name header (with # or without)
        /^#?\s*NAIDU PROPERTY CONSULTING SERVICES\s*$/gim,
        // Company slogan
        /^YOUR DEDICATED PROPERTY PARTNER\s*$/gim,
        // Investment Report title (with # or without, captures the address)
        /^#?\s*Investment Report:\s*.+$/gim,
      ];
      
      let result = content;
      
      for (const pattern of headerPatterns) {
        // Find all matches
        const matches = result.match(pattern);
        if (matches && matches.length > 1) {
          console.log(`  Found ${matches.length} occurrences of pattern, keeping first only`);
          // Keep only the first occurrence by replacing subsequent ones
          let count = 0;
          result = result.replace(pattern, (match) => {
            count++;
            return count === 1 ? match : '';
          });
        }
      }
      
      // Clean up excessive newlines and separators left after removal
      result = result
        .replace(/\n{4,}/g, '\n\n\n') // Max 3 consecutive newlines
        .replace(/(\n---\s*){2,}/g, '\n---\n') // Remove duplicate separators
        .replace(/^\s*---\s*\n\s*---/gm, '---') // Clean adjacent separators
        .trim();
      
      return result;
    };
    
    const beforeDedup = reportContent.length;
    reportContent = deduplicateHeaders(reportContent);
    const afterDedup = reportContent.length;
    console.log(`✓ Header deduplication complete: ${beforeDedup} → ${afterDedup} chars (removed ${beforeDedup - afterDedup} chars)`);
    // ========== END DEDUPLICATE HEADERS ==========
    
    // Filter out reasoning sections from Sonar Deep Research model
    // Remove content between reasoning markers and thinking blocks
    reportContent = reportContent
      .replace(/```thinking[\s\S]*?```/gi, '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/\*\*Reasoning:\*\*[\s\S]*?(?=\*\*|$)/gi, '')
      .replace(/\*\*Analysis:\*\*[\s\S]*?(?=\*\*|$)/gi, '')
      .replace(/\*\*Thought process:\*\*[\s\S]*?(?=\*\*|$)/gi, '')
      .replace(/Let me analyze[\s\S]*?(?=\n\n|\*\*|$)/gi, '')
      .replace(/I need to[\s\S]*?(?=\n\n|\*\*|$)/gi, '')
      .replace(/First, I'll[\s\S]*?(?=\n\n|\*\*|$)/gi, '')
      .replace(/To provide[\s\S]*?(?=\n\n|\*\*|$)/gi, '')
      .trim();

    // ========== POST-PROCESSING SANITIZATION ==========
    // Fix HTML entities that may have been introduced during generation
    reportContent = reportContent
      // Fix common HTML entities
      .replace(/&#x26;/g, '&')
      .replace(/&#x27;/g, "'")
      .replace(/&#x22;/g, '"')
      .replace(/&#x3C;/g, '<')
      .replace(/&#x3E;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      // Fix erroneous semicolons in text
      .replace(/(\w);(\s)/g, '$1,$2')
      // Remove stray page numbers appearing as standalone lines
      .replace(/^\d{1,3}\s*$/gm, '')
      // Remove pagination artifacts like "Page X of Y"
      .replace(/^Page\s+\d+\s*(of\s+\d+)?\s*$/gim, '')
      // Remove empty methodology sections (heading with no content before next heading)
      .replace(/#{2,3}\s*Methodology\s*Notes?\s*\n+(?=#{1,3}\s|\n*$)/gi, '')
      // Clean up excessive whitespace left after removals
      .replace(/\n{4,}/g, '\n\n\n')
      .replace(/(\n---\s*){2,}/g, '\n---\n')
      .trim();
    console.log('✓ Post-processing sanitization complete');
    // ========== END POST-PROCESSING SANITIZATION ==========

    // ========== COMPASS POST-PROCESSOR + QA ==========
    //
    // This is the seam that was missing. `compassPostProcessor` and
    // `compassQAValidator` were written, tested and imported by exactly one
    // caller — `condense-investment-report`, which makes the derived snapshot
    // and briefing variants (44 rows). The generator that produced all 1,124
    // Compass reports in the table called neither, so every cap they enforce
    // applied to everything except the document a client receives. That is why
    // the report ran at 2.3× its declared budget with ~90 commentary labels.
    //
    // It runs after the sanitizer (which works line by line on a section) and
    // before the row is written, because it needs the assembled document: the
    // page-pressure ladder measures the whole thing, and a label's paragraph
    // can cross a section boundary.
    //
    // QA is recorded, never thrown. A report that exists and is over its band
    // is more use to everyone than no report; `validation_flags` is where a
    // finding belongs, and the row carries the rest of its quality metadata
    // there already.
    /*
     * A score the record does not hold does not reach the page.
     *
     * `suppressUnrecordedScores` had exactly one call site — the condense
     * fork — so the derived Briefing was cleaned and the parent, which is the
     * document a client receives, was not. This route measured the same thing
     * with `recordedScoreValues` and filed a FINDING: QA is recorded, never
     * thrown, so the sentence carrying an invented "68/100" was detected and
     * printed anyway.
     *
     * Run unconditionally, above the overlay branch, because a switch that
     * turns a correctness control off is not a switch about formatting. The
     * removal is by SENTENCE, and composed tables printing recorded figures
     * are untouched.
     */
    const scoreGuard = suppressUnrecordedScores(reportContent, {
      recorded: recordedScoreValues(enhancedData.investmentScore),
    });
    if (scoreGuard.removed.length) {
      reportContent = scoreGuard.markdown;
      console.log(
        `✓ Score guard: ${scoreGuard.removed.length} unrecorded score claim(s) removed — `
        + scoreGuard.removed.map((r) => JSON.stringify(r.text)).join(', '),
      );
    }
    /*
     * The same rule, on the two primitives a model draws as a verdict.
     *
     * The sentence guard above skips any line beginning `{{`, on the reasoning
     * that a directive is composed from recorded numbers. That is true of the
     * ones the generator writes and false of the ones the MODEL writes: on 262
     * Pallas Street it drew `{{gauge: 85 | Land Appeal}}`, `{{gauge: 82 |
     * Large-block lifestyle appeal}}` and a five-value risk `{{wheel}}` on a
     * record that issues no grade at all — and a gauge over 100 prints a
     * verdict band, so "85 · STRONG" reached the page as a measurement.
     */
    const visualGuard = suppressUnrecordedVerdictVisuals(reportContent, {
      recorded: recordedScoreValues(enhancedData.investmentScore),
    });
    if (visualGuard.removed.length) {
      reportContent = visualGuard.markdown;
      console.log(
        `✓ Visual guard: ${visualGuard.removed.length} unrecorded verdict visual(s) removed — `
        + visualGuard.removed.map((r) => `${r.kind}(${r.values.join(',')})`).join(', '),
      );
    }

    /*
     * The same guard for a market SERIES, which the one above cannot see.
     *
     * `suppressUnrecordedVerdictVisuals` judges `gauge` and `wheel` always and
     * `bars`/`heatmap`/`radar` where they declare `max=100`. Every other
     * primitive is unjudged, and on 18 Annabelle Crescent the growth section
     * drew `{{margin: … | spark=9.6,7.1,5.9,4.8,3.5 | label=Growth profile}}`:
     * the first three values are the endpoints of two unsourced ranges in the
     * prose beside it, and 4.8 and 3.5 appear nowhere in the document or the
     * record. A reader sees a measured decline.
     */
    const marketVisualGuard = suppressUnevidencedMarketSeries(reportContent, marketFacts);
    if (marketVisualGuard.removed.length) {
      reportContent = marketVisualGuard.markdown;
      console.log(
        `✓ Market series guard: ${marketVisualGuard.removed.length} chart(s) removed whose figures the `
        + 'market evidence table does not state — '
        + marketVisualGuard.removed.map((r) => `${r.kind}[${r.matchedOn}](${r.values.join(',')})`).join(', '),
      );
    }

    /*
     * A detected error is not a corrected report.
     *
     * The three guards above remove a claim; `runQAValidation` below only
     * REPORTS one, and the comment beside it says why — "a report that exists
     * and is over its band is more use to everyone than no report". That is
     * right for a page band and wrong for two of its findings, which are not
     * statements about a document's shape but material claims about somebody's
     * property that nothing in this report supports:
     *
     *   portal-sourced-hazard-clearance — "no bushfire, flood or heritage
     *     overlays … [Property.com.au, 119, 120, 137 and 139 Redfern Street
     *     profiles]", measured on 48 Redfern Street. A listing is not a
     *     planning authority and a neighbouring parcel is not this one.
     *
     *   unpublished-delivery-horizon — a {{timeline:}} placing named projects
     *     in "0-2y", when every date the registers publish is a decision or a
     *     declaration and none is a delivery date.
     *
     * Both were detected, filed in `validation_flags` and printed anyway. They
     * are corrected here, by the sentence and by the stop, and what went is
     * logged and stored — a correction that leaves no trace is a document that
     * looks like it never carried the claim. It runs unconditionally and above
     * the overlay branch for the same reason the score guard does: a switch
     * that turns a correctness control off is not a switch about formatting.
     */
    const claimGuard = correctUnsupportedEvidenceClaims(reportContent);
    if (claimGuard.removed.length) {
      reportContent = claimGuard.markdown;
      for (const r of claimGuard.removed) {
        console.log(`✓ Claim guard [${r.rule}]: removed ${JSON.stringify(r.text.slice(0, 160))}`);
      }
    }

    let compassQa: ReturnType<typeof runQAValidation> | null = null;
    if (compass40OverlayActive) {
      const beforePost = reportContent.length;
      const { markdown, report: postReport } = postProcessReportMarkdown(reportContent, 'compass-40');
      reportContent = markdown;
      // The prose may print the recorded score and its scored dimensions,
      // and no other (QA-18); a claim outside that set is reported here.
      compassQa = runQAValidation(reportContent, 'compass-40', {
        recordedScores: recordedScoreValues(enhancedData.investmentScore),
      });

      console.log(
        `✓ Compass post-processor: ${beforePost} → ${reportContent.length} chars, ` +
        `${postReport.editorialBlocksRemoved} editorial block(s) removed (${postReport.editorialWordsRemoved} words), ` +
        `${postReport.sectionsTrimmed.length} section(s) trimmed, ` +
        `trims applied: [${postReport.trimsApplied.join(', ') || 'none'}], ` +
        `${postReport.initialEstimatedPages} → ${postReport.finalEstimatedPages} est. pages`,
      );
      console.log(
        `✓ Compass QA: ${compassQa.passed ? 'passed' : 'FAILED'} — ` +
        `${compassQa.estimatedPages} est. pages, ${compassQa.wordCount} words, ` +
        `${compassQa.findings.filter((f) => f.severity === 'error').length} error(s), ` +
        `${compassQa.findings.filter((f) => f.severity === 'warning').length} warning(s)`,
      );
      for (const finding of compassQa.findings) {
        console.log(`   [${finding.severity}] ${finding.rule}: ${finding.message}`);
      }
    }
    // ========== END COMPASS POST-PROCESSOR + QA ==========

    /*
     * The planning and infrastructure evidence, on the page, verbatim.
     *
     * Handing a model a table and asking it to reproduce one is how a table
     * comes back paraphrased, re-ordered or with a row the source never had.
     * These two are composed by `renderPlanningControls` and
     * `renderInfrastructureOutlook` from what the registers answered, and they
     * are appended AFTER the post-processor so no word cap can trim a row of
     * evidence out of a client's document.
     *
     * Property reports only: the readings are taken at the property's own
     * coordinate, and a suburb or postcode report has no parcel to state them
     * about.
     *
     * One consequence worth knowing: this lands after `runQAValidation`, so the
     * page estimate that QA logs and files is the prose's, not the document's.
     * That is the deliberate order — the alternative is letting a word cap trim
     * a row of evidence — and the block is a fixed ~3.7 KB, about one page.
     */
    if (!isAreaReport) {
      reportContent += `\n\n---\n\n## Planning controls and development registers\n\n`
        + `### Planning controls retrieved for this property\n\n${planningControlsTable}\n\n`
        + `### Infrastructure and development retrieved for this property\n\n${infrastructureTable}\n`;
      // Appended verbatim for the reason the two tables above are: asking a
      // model to reproduce a table is how a table comes back paraphrased, and
      // every date and figure here is one an authority published.
      if (publishedProjectBlock) {
        reportContent += `\n### Major public projects near this property\n\n`
          + `${publishedProjectBlock}\n`
          + `**What this register covers.** ${PUBLISHED_PROJECT_COVERAGE.join(' ')}\n`;
      }
      console.log(
        `📋 Appended retrieved planning + infrastructure evidence `
        + `(${planningControlsTable.length + infrastructureTable.length + publishedProjectBlock.length} chars)`,
      );
    }

    /*
     * The strategy sections, on the page, composed.
     *
     * Appended for the same two reasons the evidence tables above are. They
     * are COMPOSED from the record rather than written, so asking a model to
     * reproduce them is asking for a paraphrase of a quadrant; and landing
     * after the post-processor means no word cap can trim an entry — and every
     * entry carries the fact it rests on, so trimming one removes a source
     * rather than a flourish.
     *
     * Property reports only, like the tables: a suburb report has no lot to
     * state a land size, a zone or a lending ratio about.
     */
    if (!isAreaReport && strategySectionsMarkdown.trim()) {
      reportContent += `\n\n---\n\n${strategySectionsMarkdown}\n`;
      console.log(
        `🧭 Appended composed strategy sections (${strategySectionsMarkdown.length} chars, `
        + `${compassStrategySections.length} sections)`,
      );
    }


    // Extract citations and sources from the response
    const citations = allCitations;
    const searchResults: any[] = [];
    
    // Format sources section
    let sourcesContent = '';
    if (citations.length > 0 || searchResults.length > 0) {
      sourcesContent = '\n\n## SOURCES & REFERENCES\n\n';
      
      if (citations.length > 0) {
        sourcesContent += '### Citations:\n';
        // Deduplicate citations
        const uniqueCitations = [...new Set(citations.map((c: any) => c.url || c.title || c))];
        uniqueCitations.forEach((citation: any, index: number) => {
          sourcesContent += `${index + 1}. ${citation}\n`;
        });
        sourcesContent += '\n';
      }
      
      if (searchResults.length > 0) {
        sourcesContent += '### Additional Sources:\n';
        searchResults.forEach((result: any, index: number) => {
          const title = result.title || 'Source';
          const url = result.url || '';
          sourcesContent += `${index + 1}. [${title}](${url})\n`;
        });
      }
    }

    console.log('Report generated successfully, content length:', reportContent.length);
    console.log('Citations found:', citations.length);

    // Validate report structure against schema
    console.log('🔍 Validating report structure...');
    let schemaValidationFlags: any[] = [];
    
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
      
      if (supabaseUrl && supabaseAnonKey) {
        const schemaValidatorClient = createClient(supabaseUrl, supabaseAnonKey);
        
        const { data: schemaValidation, error: schemaError } = await schemaValidatorClient.functions.invoke(
          'report-schema-validator',
          {
            body: { reportContent }
          }
        );
        
        if (schemaError) {
          console.error('Schema validation error:', schemaError);
        } else if (schemaValidation) {
          console.log('✓ Schema validation complete');
          console.log('Schema valid:', schemaValidation.valid);
          console.log('Schema issues found:', schemaValidation.issues?.length || 0);
          
          // Convert schema issues to validation flags
          if (schemaValidation.issues && schemaValidation.issues.length > 0) {
            schemaValidationFlags = schemaValidation.issues.map((issue: any) => ({
              type: 'schema',
              severity: issue.severity || 'medium',
              field: issue.section || 'structure',
              message: issue.message,
              value: issue.details || null
            }));
          }
        }
      }
    } catch (validationError) {
      console.error('Error during schema validation:', validationError);
      // Continue without blocking report generation
    }

    // Update database if reportId provided
    if (reportId && supabaseClient) {
      console.log('Updating report in database with ID:', reportId);
      
      // `propertySpecs` and `dataSources` are composed ABOVE, before the
      // strategy record that reads them. One binding, so the row that is
      // written and the record the prose is composed from cannot disagree.

      /**
       * The acquisition ledger for this run.
       *
       * Built last so a producer fetched late — climate and planning are keyed
       * on a coordinate that does not exist in phase 1 — is recorded at its
       * real outcome rather than at the skip that was true earlier.
       *
       * `unaccounted` is the part that earns its keep over time: a producer
       * added to the pipeline and not recorded here appears in that list rather
       * than silently becoming another unexplained null.
       */
      const acquisitionLedger = acquisition.build();
      (dataSources as Record<string, unknown>)._acquisition = acquisitionLedger;
      console.log(
        `📒 Acquisition: ${acquisitionLedger.tally.answered} answered, `
        + `${acquisitionLedger.tally.never_requested} never requested, `
        + `${acquisitionLedger.tally.requested_failed} failed, `
        + `${acquisitionLedger.tally.unavailable_in_coverage} empty, `
        + `${acquisitionLedger.tally.retrieved_not_bound} lost`
        + (acquisitionLedger.unaccounted.length
          ? ` — UNACCOUNTED: ${acquisitionLedger.unaccounted.join(', ')}`
          : ''),
      );

      // Fact reconciliation: does the written analysis agree with the record
      // it rides on? Findings DISCLOSE (validation_flags → the viewer's
      // coverage note); they never gate completion — a report that never
      // finishes is worse than one carrying a named warning. Report-level
      // rule, so comparative prose about other properties cannot trip it.
      let factFlags: Array<ReturnType<typeof factFindingToFlag>> = [];
      // Kept separate from `factFlags` because it answers a different question
      // and carries its own flag type; both land in `allValidationFlags`.
      let claimFlags: Array<ReturnType<typeof claimFaultToFlag>> = [];
      let governedFlags: Array<ReturnType<typeof governedFaultToFlag>
        | ReturnType<typeof governedRemediatedFlag>> = [];
      try {
        const factNum = (v: unknown): number | undefined => {
          const n = toFiniteNumber(v);
          return n !== undefined && n > 0 ? n : undefined;
        };
        const factFindings = reconcileFacts(reportContent, {
          bedrooms: factNum(mergedOverrides.bedrooms) ?? factNum(propertyDetails?.beds),
          bathrooms: factNum(mergedOverrides.bathrooms) ?? factNum(propertyDetails?.baths),
          carSpaces: factNum(mergedOverrides.carSpaces) ?? factNum(propertyDetails?.carSpaces),
          purchasePrice: factNum(mergedOverrides.purchasePrice) ?? factNum(propertyDetails?.price),
          weeklyRent: factNum(mergedOverrides.weeklyRent) ?? factNum(propertyDetails?.weeklyRent),
          landSizeSqm: factNum(mergedOverrides.landSizeSqm) ?? factNum(propertyDetails?.landSize),
          // The three figures the prompt does not merely supply but ORDERS the
          // use of — "PRE-CALCULATED FINANCIAL VALUES (USE THESE EXACTLY - DO
          // NOT RECALCULATE)". These exact variables are what the prompt
          // interpolates, so the reconciliation reads the same number the
          // model was handed rather than a second computation of it, which is
          // the whole point: a second computation would only prove that two
          // formulas agree.
          grossYieldPct: toFiniteNumber(preCalculatedGrossYield),
          netYieldPct: toFiniteNumber(preCalculatedNetYield),
          lvrPct: toFiniteNumber(effectiveLvr),
        });
        factFlags = factFindings.map(factFindingToFlag);

        // RF-7.2B.1 §7 — the other question the reconciliation above does not
        // ask. That one checks whether the prose agrees with the record; this
        // checks whether a figure it agrees with has been given a label the
        // source does not support: a postal-area count called a suburb's, a
        // 2021 Census figure called current, a monthly average called the rate
        // in force. It discloses; nothing here fails a report.
        const claimFaults = auditMarketClaims(reportContent, safeGeneration.snapshot.facts);
        if (claimFaults.length > 0) {
          console.log(`🔍 Market-claim audit: ${claimFaults.length} finding(s) — `
            + claimFaults.map((f) => `${f.fact}/${f.kind}`).join(', '));
        }
        claimFlags = claimFaults.map(claimFaultToFlag);

        // RF-7.2B.1A — the question neither of the two above can ask.
        //
        // `auditMarketClaims` is VALUE-anchored: it finds a figure the
        // snapshot holds and checks the words around it. A WITHHELD fact has
        // no value to anchor on, so a figure invented in its place is
        // invisible to it — and its header assumed "the fact reconciliation
        // already looks for" that, which `factReconciliation.pure.ts` does
        // not. Measured on two reports generated 2026-09-11 with
        // `market.demographics` absent: both stated a population, one citing
        // the ABS Census for a figure that disagrees with the ABS Census.
        //
        // This pass is CATEGORY-anchored, and it BLOCKS rather than
        // disclosing: the other two describe a fact the report holds, this
        // one finds a fact the report does not hold at all.
        const governedContext = {
          subjectPostcode: subjectPostcodeForAudit(safeGeneration.snapshot, propertyAddress),
        };
        let governedFaults = auditGovernedNarrativeAuthority(
          reportContent, safeGeneration.snapshot, governedContext,
        );
        // RF-7.2B.1A.2 — a report is REPAIRED, not withheld.
        //
        // The audit proved the more reliable control: a search-grounded model
        // will occasionally still reach for a public figure whatever the
        // prompt says. Withholding the finished document from the client was
        // never the product, so the unsupported claim comes OUT and the
        // report continues. Deterministic, no model, no network, and bounded
        // at two passes — the second drops the disclosure in case the
        // disclosure itself is what the re-audit objected to, and anything
        // still standing after that blocks exactly as before.
        const governedRemovals: GovernedRemoval[] = [];
        if (governedFaults.length > 0) {
          console.error(
            `\u26d4 Governed-authority audit: ${governedFaults.length} finding(s) — `
            + governedFaults.map((f) => `${f.category}/${f.kind}`).join(', ')
            + ' — attempting remediation',
          );
          const pass1 = remediateGovernedNarrative(
            reportContent, safeGeneration.snapshot, governedContext,
          );
          if (pass1.changed) {
            reportContent = pass1.text;
            governedRemovals.push(...pass1.removed);
            governedFaults = auditGovernedNarrativeAuthority(
              reportContent, safeGeneration.snapshot, governedContext,
            );
          }
          if (governedFaults.length > 0) {
            const pass2 = remediateGovernedNarrative(
              reportContent, safeGeneration.snapshot, governedContext, { disclose: false },
            );
            if (pass2.changed) {
              reportContent = pass2.text;
              governedRemovals.push(...pass2.removed);
              governedFaults = auditGovernedNarrativeAuthority(
                reportContent, safeGeneration.snapshot, governedContext,
              );
            }
          }
          console.log(
            `\u2713 Governed-authority remediation: ${governedRemovals.length} claim(s) removed, `
            + `${governedFaults.length} finding(s) remain`,
          );
        }
        // What was taken out is recorded and does NOT block; anything the
        // remediator could not clear still does.
        governedFlags = [
          ...governedRemovals.map(governedRemediatedFlag),
          ...governedFaults.map(governedFaultToFlag),
        ];
        if (governedAuthorityBlocks(governedFaults)) {
          console.error(
            '⛔ This report asserts a governed fact it does not hold. It is not client-ready.',
          );
        }

        // The other half of the same question. Above asks whether the prose
        // agrees with the record; this asks whether the record agrees with
        // ITSELF — a deposit and a loan that do not add to the purchase price,
        // or two different LVRs for one loan. Measured on 2026-09-07: 14 of
        // 143 stored reports break at least one of those, and on those reports
        // the model wrote the loan block's LVR rather than the key metrics',
        // which is how a contradiction inside the record becomes a wrong
        // number on a client's page.
        const identity = financeIdentityBreaches({
          purchasePrice: enhancedData.financials?.initialCosts?.propertyValue ?? effectivePurchasePrice,
          deposit: enhancedData.financials?.initialCosts?.deposit,
          loanAmount: enhancedData.financials?.initialCosts?.loanAmount,
          keyMetricsLvr: enhancedData.financials?.keyMetrics?.lvr,
          loanDetailsLvr: enhancedData.financials?.loanDetails?.lvr,
        });
        for (const breach of identity) {
          factFlags.push({
            type: 'fact',
            severity: 'warning',
            field: `finance_identity.${breach.rule}`,
            message: breach.message,
            value: { expected: breach.expected, found: breach.found, occurrences: 1, snippet: '' },
          });
        }

        if (factFlags.length) {
          console.warn(`⚠️ Fact reconciliation: ${factFlags.length} contradiction(s) — ${factFlags.map((f) => f.field).join(', ')}`);
        }
      } catch (factError) {
        console.warn('Fact reconciliation skipped:', factError instanceof Error ? factError.message : factError);
      }
      
      // Combine financial validation flags with schema validation flags
      const allValidationFlags = [
        ...(enhancedData.validation?.flags || []),
        ...schemaValidationFlags,
        // Prose-vs-record contradictions, from the reconciliation above.
        ...factFlags,
        // Right number, wrong label — grain, period or source (RF-7.2B.1 §7).
        ...claimFlags,
        ...governedFlags,
        // A score the record does not hold, removed before the page was
        // written. Disclosed rather than merely logged: the sentence carrying
        // it is gone from the document, so the flag is the only trace a later
        // reader has that it was ever there.
        ...(scoreGuard.removed.length ? [{
          type: 'unrecorded_score_claim',
          severity: 'warning' as const,
          field: 'report_content',
          message: `${scoreGuard.removed.length} score claim(s) the record does not hold were removed from the narrative.`,
          value: { claims: scoreGuard.removed.map((r) => r.text) },
        }] : []),
        // Add quality-based validation flags
        ...(avgScore < 70 ? [{
          type: 'quality',
          severity: 'warning',
          field: 'content_quality',
          message: `Report quality score (${avgScore}/100) below optimal threshold`,
          value: { avgScore, invalidSections: invalidSections.length }
        }] : []),
        // The 45,000-char floor below was written for the 17-section document
        // and is not a target for the v3.0 Compass, which is deliberately about
        // a third of that. Compass reports are judged by `compassQa` instead.
        ...(!compass40OverlayActive && combinedContent.length < 45000 ? [{
          type: 'quality',
          severity: 'info',
          field: 'content_length',
          message: `Report content length (${combinedContent.length} chars) may result in fewer pages`,
          value: { actual: combinedContent.length, recommended: 45000 }
        }] : []),
        /*
         * What the claim guard CORRECTED, recorded as an `info` flag.
         *
         * Nothing is concealed: a correction that leaves no trace is
         * indistinguishable from a document that never carried the claim, and
         * the record has to be able to say a sentence was removed and why. It
         * is `info` rather than a warning because nothing is outstanding — the
         * claim is gone from the document these flags describe.
         */
        ...claimGuard.removed.map((r) => ({
          type: 'correction',
          severity: 'info' as const,
          field: r.rule,
          message: `Removed an unsupported claim before the document was stored: ${r.reason}`,
          value: { rule: r.rule, removed: r.text },
        })),
        // Compass structural QA. Recorded rather than thrown — see the seam above.
        ...(compassQa ? compassQa.findings.map((f) => ({
          type: 'structure',
          severity: f.severity,
          field: f.sectionId ?? f.rule,
          message: f.message,
          value: { rule: f.rule, estimatedPages: compassQa!.estimatedPages, wordCount: compassQa!.wordCount }
        })) : [])
      ];
      
      // Prepare update object with quality metadata
      const updateData: any = {
        report_content: reportContent,
        sources_content: sourcesContent,
        demographics_data: enhancedData.demographics || null,
        economic_data: enhancedData.economics || null,
        financial_calculations: enhancedData.financials || null,
        investment_score: enhancedData.investmentScore || null,
        // …with the planning and development evidence this report was shown
        // recorded beside it. It was retrieved on every run, rendered into two
        // tables in the document, and persisted NOWHERE — so no projection,
        // template binding, regeneration or fork could read a control the
        // registers stated, and nothing could check a sentence against the
        // evidence it was written from. See `planningEvidenceRecord.pure.ts`.
        location_intelligence: withPlanningEvidence(
          measuredLocationIntelligence ?? enhancedData.locationIntelligence ?? null,
          planningFacts,
          infrastructure,
        ),
        // RF-7.2B.1 — what this report was shown, frozen at generation. Reopening
        // it must never re-read today's ABS or RBA tables and quietly restate the
        // document; the snapshot is what a later reader reconciles against.
        market_fact_snapshot: safeGeneration.snapshot,
        property_specs: propertySpecs,
        validation_flags: allValidationFlags,
        calculation_version: '1.0.0',
        data_sources: {
          ...dataSources,
          /*
           * What the market registers answered, recorded.
           *
           * It was assembled on every run, handed to the scoring service and
           * to the prose, and stored NOWHERE — so `fork-investment-report`
           * could not compose a suitability profile or an exit outlook from
           * the median and the growth the parent had been shown, and no reader
           * could reconcile a sentence against the figures behind it. Same
           * shape the generator holds, so `buildMarketFacts` reads it
           * unchanged at either end.
           */
          marketEvidence: enhancedData.marketEvidence || null,
          // Add generation quality metadata
          _generationQuality: qualityMetadata
        },
        report_scope: reportScope,
        // The engine that RAN, not the one that was asked for. This column was
        // written only by the browser, recording the caller's preference, while
        // the resolution above overrides that preference for every compass-tier
        // report — so 1,124 rows say "legacy" about documents this engine
        // produced. A record of what was requested is not a record of what
        // happened, and every reader of this column wanted the latter.
        generation_engine: compass40OverlayActive ? 'compass-40' : 'legacy',
        status: 'completed'
      };
      
      // Build initial manual overrides from extracted property data
      // This applies to ALL input methods (manual, URL scrape, PDF upload)
      const extractedOverrides: any = {};
      
      if (propertyDetails?.price) extractedOverrides.purchasePrice = propertyDetails.price;
      if (propertyDetails?.weeklyRent) extractedOverrides.weeklyRent = propertyDetails.weeklyRent;
      if (propertyDetails?.landSizeSqm) extractedOverrides.landSizeSqm = propertyDetails.landSizeSqm;
      if (propertyDetails?.buildSizeSqm) extractedOverrides.buildSizeSqm = propertyDetails.buildSizeSqm;
      if (propertyDetails?.landPrice) extractedOverrides.landPrice = propertyDetails.landPrice;
      if (propertyDetails?.buildPrice) extractedOverrides.buildPrice = propertyDetails.buildPrice;
      if (propertyDetails?.beds) extractedOverrides.bedrooms = propertyDetails.beds;
      if (propertyDetails?.baths) extractedOverrides.bathrooms = propertyDetails.baths;
      if (propertyDetails?.carSpaces) extractedOverrides.carSpaces = propertyDetails.carSpaces;
      if (propertyDetails?.isNewBuild !== undefined) extractedOverrides.isNewBuild = propertyDetails.isNewBuild;
      if (propertyDetails?.buildType) extractedOverrides.buildType = propertyDetails.buildType;
      
      // Merge all overrides: extracted < existing DB < frontend (priority order)
      // Frontend overrides (mergedOverrides already contains frontend + existing DB)
      // Now add extracted overrides as fallback
      const finalOverrides = { ...extractedOverrides, ...mergedOverrides };
      
      if (Object.keys(finalOverrides).length > 0) {
        updateData.manual_overrides = finalOverrides;
        console.log('✓ Final manual_overrides saved:', Object.keys(finalOverrides).length, 'fields');
        console.log('  Fields:', Object.keys(finalOverrides).join(', '));
      }
      
      const { error: updateError } = await supabaseClient
        .from('investment_reports')
        .update(updateData)
        .eq('id', reportId);

      if (updateError) {
        console.error('Error updating report:', updateError);
        throw new Error(`Failed to save report: ${updateError.message}`);
      }
      
      console.log('Report successfully updated in database with validation and property specs');
      
      // Add success notification
      try {
        await insertTargetedNotification(supabaseClient, {
          moduleKey: 'reports',
          notification: {
            type: 'report_generation_completed',
            title: 'Report Generated',
            message: `Investment report for ${propertyAddress} is ready to view`,
            report_id: reportId,
            entity_id: reportId,
          },
        });
        console.log('✓ Success notification created');
      } catch (notifError) {
        console.error('Failed to create notification:', notifError);
        // Don't throw - notification failure shouldn't block report completion
      }
      
      // Log data quality score
      if (enhancedData.validation) {
        console.log('📊 Report Quality Score:', enhancedData.validation.qualityScore, '/100');
      }
    }

    console.log('Report generation complete, returning response');

    // Return successful response
    const responseData = { 
      reportContent,
      sourcesContent,
      propertyAddress,
      success: true,
      isComplete: true,
      enhancedData: {
        locationIntelligence: enhancedData.locationIntelligence,
        investmentScore: enhancedData.investmentScore,
        financials: enhancedData.financials,
        demographics: enhancedData.demographics,
        economics: enhancedData.economics,
        schoolData: enhancedData.schoolData
      }
    };

    console.log('Returning successful response');
    await traceFinishRun(_traceSb, _traceRunId, { status: 'completed' });
    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    console.error('Error in generate-investment-report function:', error);
    console.error('Error stack:', error?.stack);
    
    /*
     * Best-effort bookkeeping, wrapped because AN ERROR HANDLER THAT CAN
     * THROW TURNS EVERY SERVER ERROR INTO A CORS ERROR.
     *
     * When a handler throws, the platform serves a bare 500 carrying none
     * of this function’s CORS headers, so a browser sending
     * `credentials: 'include'` discards the response and `fetch` rejects
     * with "Failed to fetch" — sending the operator to look at CORS and the
     * network while the real fault is in the code. Everything in here is
     * therefore optional. The `return` below is not.
     */
    try {
      // Update report status to failed if reportId provided
      if (requestBody?.reportId) {
        try {
          const supabaseUrl = Deno.env.get('SUPABASE_URL');
          const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          if (supabaseUrl && supabaseKey) {
            const supabaseClient = createClient(supabaseUrl, supabaseKey);
            await supabaseClient
              .from('investment_reports')
              .update({ 
                status: 'failed',
                error_message: error?.message || 'An unexpected error occurred'
              })
              .eq('id', requestBody.reportId);
          
            // Add failure notification
            await insertTargetedNotification(supabaseClient, {
              moduleKey: 'reports',
              notification: {
                type: 'report_generation_failed',
                title: 'Report Generation Failed',
                message: `Failed to generate report: ${error?.message || 'Unknown error'}`,
                report_id: requestBody.reportId,
                entity_id: requestBody.reportId,
              },
            });
          
            console.log('Updated report status to failed');
          }
        } catch (updateError) {
          console.error('Error updating report status to failed:', updateError);
        }
      }
    } catch (handlerFault) {
      // Deliberately not rethrown: the 500 below is what the caller must
      // receive, and it is the only thing here that carries CORS headers.
      console.error('The failure handler itself failed:', handlerFault);
    }
    
    const errorResponse = { 
      error: error?.message || 'An unexpected error occurred',
      success: false,
      timestamp: new Date().toISOString()
    };
    
    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

Deno.serve(withReportMetering(async (body, req) => {
  if (!body) return null;
  const userId = await resolveUserId(req, body);
  if (!userId) return null;
  const scope = body?.propertyDetails?.queryType || 'address';
  const isArea = ['suburb', 'postcode', 'statewide', 'zipcode'].includes(scope);
  const tier = (body?.propertyDetails?.tier || body?.tier || 'compass').toLowerCase();
  const kind = isArea
    ? (scope === 'suburb' ? 'report.suburb.compass'
      : scope === 'postcode' || scope === 'zipcode' ? 'report.postcode.compass'
      : 'report.investment.compass')
    : (tier === 'executive' ? 'report.investment.executive'
      : tier === 'snapshot' ? 'report.investment.snapshot'
      : tier === 'financial' ? 'report.investment.financial'
      : 'report.investment.compass');
  let reportVersion: number | string = `unresolved-${crypto.randomUUID()}`;
  if (body?.reportId) {
    const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
    const supabaseKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
    if (supabaseUrl && supabaseKey) {
      const { data } = await createClient(supabaseUrl, supabaseKey)
        .from('investment_reports')
        .select('current_version')
        .eq('id', body.reportId)
        .single();
      reportVersion = data?.current_version ?? reportVersion;
    }
  }
  // One reservation per generation version. All chunks in that version share
  // the key, but a later regeneration or changed caller-supplied inputs cannot
  // reuse the original report's paid reservation.
  const idempotencyKey = buildIdempotencyKey(
    'inv-report',
    await buildInvestmentReportMeteringParts(body, reportVersion),
  );
  return {
    kind: kind as any,
    userId,
    idempotencyKey,
    estimateOptions: { aiNarrative: true },
    requestPayload: {
      reportId: body?.reportId,
      propertyAddress: body?.propertyAddress,
      scope,
      tier,
    },
  };
}, __investmentReportHandler));
