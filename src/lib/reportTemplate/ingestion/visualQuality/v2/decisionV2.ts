/**
 * E7 — the pure decision cascade. hard defects → score → output decision.
 *
 * ONE engine drives native → mixed → raster → block. At every stage the
 * hard-defect veto is consulted BEFORE the score; a weighted score can never
 * promote a page that carries an unresolved hard-veto defect. Page-raster and
 * block are the safe outcomes and are always reachable.
 */
import type { RecommendedActionV2, EvaluationStageV2 } from './contracts';
import { hasUnresolvedHardDefect, type CriticalQualityDefectV1 } from './criticalDefects';

export const NATIVE_ACCEPT_THRESHOLD = 0.90;
export const NATIVE_REVIEW_THRESHOLD = 0.80;

export interface PageDecisionInput {
  stage: EvaluationStageV2;
  score: number | null;
  defects: readonly CriticalQualityDefectV1[];
  qualityCoverageComplete: boolean;
  /** exact source-region crops exist for the failed regions (enables mixed). */
  exactRegionCropsAvailable: boolean;
  /** a valid, ready, non-blank source page raster exists (enables raster-only). */
  pageRasterAvailable: boolean;
}

export interface PageDecisionResult {
  action: RecommendedActionV2;
  outputStrategy: 'native' | 'mixed' | 'raster-only' | 'blocked';
  manualReviewRequired: boolean;
  reason: string;
}

/** Decide the action for a page at a given cascade stage. Pure + deterministic. */
export function decidePage(input: PageDecisionInput): PageDecisionResult {
  const hard = hasUnresolvedHardDefect(input.defects);
  const score = input.score;
  const coverageOk = input.qualityCoverageComplete;

  // Coverage / unscored always blocks automatic acceptance (fail-closed).
  if (!coverageOk || score == null) {
    return escalateFromMixedOrRaster(input, 'coverage_incomplete_or_unscored');
  }

  if (input.stage === 'native' || input.stage === 'post-existing-repair') {
    if (!hard && score >= NATIVE_ACCEPT_THRESHOLD) return native('accept-native', false, 'native no-defect high-score');
    if (!hard && score >= NATIVE_REVIEW_THRESHOLD) return native('accept-native-with-review', true, 'native no-defect mid-score');
    // localized region failure with exact crops → mixed; else escalate.
    if (input.exactRegionCropsAvailable) return { action: 'apply-mixed-region-fallback', outputStrategy: 'mixed', manualReviewRequired: true, reason: hard ? 'native hard defect → mixed' : 'native low score → mixed' };
    return escalateFromMixedOrRaster(input, hard ? 'native hard defect, no crops' : 'native low score, no crops');
  }

  if (input.stage === 'mixed-region') {
    if (!hard && score >= NATIVE_ACCEPT_THRESHOLD) return mixed('accept-mixed', false, 'mixed no-defect high-score');
    if (!hard && score >= NATIVE_REVIEW_THRESHOLD) return mixed('accept-mixed-with-review', true, 'mixed no-defect mid-score');
    return escalateFromMixedOrRaster(input, hard ? 'mixed hard defect' : 'mixed low score');
  }

  if (input.stage === 'page-raster') {
    if (!hard && input.pageRasterAvailable) return { action: 'accept-page-raster', outputStrategy: 'raster-only', manualReviewRequired: false, reason: 'page raster valid' };
    return blocked('page raster unavailable/unsafe');
  }

  // export stage or unknown → treat conservatively.
  return escalateFromMixedOrRaster(input, 'export-stage conservative');
}

function escalateFromMixedOrRaster(input: PageDecisionInput, reason: string): PageDecisionResult {
  if (input.pageRasterAvailable) return { action: 'apply-page-raster', outputStrategy: 'raster-only', manualReviewRequired: true, reason: `escalate: ${reason}` };
  return blocked(`no fallback: ${reason}`);
}
function native(action: RecommendedActionV2, review: boolean, reason: string): PageDecisionResult {
  return { action, outputStrategy: 'native', manualReviewRequired: review, reason };
}
function mixed(action: RecommendedActionV2, review: boolean, reason: string): PageDecisionResult {
  return { action, outputStrategy: 'mixed', manualReviewRequired: review, reason };
}
function blocked(reason: string): PageDecisionResult {
  return { action: 'block-finalization', outputStrategy: 'blocked', manualReviewRequired: true, reason };
}

// ── Document-level finalization ──────────────────────────────────────────────

export interface DocumentFinalizationInput {
  pageStrategies: Array<'native' | 'mixed' | 'raster-only' | 'blocked'>;
  anyPageManualReview: boolean;
  anyCriticalPageUnscored: boolean;
  batchCoverageComplete: boolean;
  exportParityRequired: boolean;
  exportParityAvailable: boolean;
}

export interface DocumentFinalizationResult {
  finalDecision: 'native' | 'native-review' | 'mixed' | 'mixed-review' | 'raster-only' | 'blocked';
  finalizationAllowed: boolean;
  exportAllowed: boolean;
  manualReviewRequired: boolean;
  reason: string;
}

/** Roll page decisions up to a document decision. Fail-closed. */
export function finalizeDocument(input: DocumentFinalizationInput): DocumentFinalizationResult {
  if (input.anyCriticalPageUnscored || !input.batchCoverageComplete) {
    return block('critical page unscored or incomplete coverage');
  }
  if (input.pageStrategies.some((s) => s === 'blocked')) return block('a page is blocked');
  if (input.exportParityRequired && !input.exportParityAvailable) return block('export parity required but unavailable');

  const anyRaster = input.pageStrategies.some((s) => s === 'raster-only');
  const anyMixed = input.pageStrategies.some((s) => s === 'mixed');
  const review = input.anyPageManualReview;
  if (anyRaster) return { finalDecision: 'raster-only', finalizationAllowed: true, exportAllowed: true, manualReviewRequired: review, reason: 'mixed document with raster pages' };
  if (anyMixed) return { finalDecision: review ? 'mixed-review' : 'mixed', finalizationAllowed: true, exportAllowed: true, manualReviewRequired: review, reason: 'mixed-region composition' };
  return { finalDecision: review ? 'native-review' : 'native', finalizationAllowed: true, exportAllowed: true, manualReviewRequired: review, reason: 'native document' };
}
function block(reason: string): DocumentFinalizationResult {
  return { finalDecision: 'blocked', finalizationAllowed: false, exportAllowed: false, manualReviewRequired: true, reason };
}
