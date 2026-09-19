/**
 * importIntelligenceClassifier — Phase 10B.
 *
 * Converts extracted signals into a deterministic profile category, risk level,
 * 0..1 scores, and downstream strategy recommendations. Pure and non-AI.
 */
import type {
  ImportIntelligenceProfileCategory,
  ImportIntelligenceRiskLevel,
  ImportIntelligenceScores,
  ImportIntelligenceSignals,
  ImportIntelligenceRecommendations,
  ImportIntelligenceEvidence,
} from './importIntelligenceTypes';

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 1000) / 1000;
}

function lower(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// --- sub-score helpers -----------------------------------------------------

function pageCountRisk(pageCount: number | null): number | null {
  if (pageCount === null) return null;
  if (pageCount <= 1) return 0.1;
  if (pageCount === 2) return 0.2;
  if (pageCount <= 4) return 0.4;
  if (pageCount <= 7) return 0.6;
  return 0.85;
}

function tableRiskFromCount(count: number | null): number | null {
  if (count === null) return null;
  if (count === 0) return 0;
  if (count <= 2) return 0.35;
  if (count <= 5) return 0.65;
  return 0.9;
}

function imageRiskFromCount(count: number | null): number | null {
  if (count === null) return null;
  if (count === 0) return 0;
  if (count <= 2) return 0.3;
  if (count <= 5) return 0.6;
  return 0.85;
}

function designRiskFromSignals(signals: ImportIntelligenceSignals): number | null {
  if (signals.designComplexityEstimate !== null) return signals.designComplexityEstimate;
  let score = 0;
  let evidence = false;
  const imageRisk = imageRiskFromCount(signals.imageCountEstimate);
  if (imageRisk !== null) {
    score += imageRisk * 0.6;
    evidence = true;
  }
  if (signals.visualQaScore !== null && signals.visualQaScore < 0.85) {
    score += 0.25;
    evidence = true;
  }
  if (signals.repairRequiresFallback === true || signals.repairRequiresManualReview === true) {
    score += 0.2;
    evidence = true;
  }
  return evidence ? clamp01(score) : null;
}

function visualQaRisk(signals: ImportIntelligenceSignals): number | null {
  if (signals.visualQaScore === null) return null;
  return clamp01(1 - signals.visualQaScore);
}

function repairRisk(signals: ImportIntelligenceSignals): number | null {
  const status = lower(signals.repairStatus);
  let score: number | null = null;
  const bump = (v: number) => {
    score = Math.max(score ?? 0, v);
  };
  if (status === 'failed') bump(0.9);
  if (signals.repairRequiresFallback === true) bump(0.6);
  if (signals.repairRequiresManualReview === true) bump(0.6);
  if (signals.repairFinalScore !== null && signals.repairFinalScore < 0.85) bump(0.4);
  if (status === 'completed' && score === null) return 0;
  return score === null ? null : clamp01(score);
}

function exportParityRisk(signals: ImportIntelligenceSignals): number | null {
  const status = lower(signals.exportParityStatus);
  let score: number | null = null;
  const bump = (v: number) => {
    score = Math.max(score ?? 0, v);
  };
  if (status === 'failed') bump(0.9);
  if (status === 'manual_required') bump(0.5);
  if (signals.exportVsSourceScore !== null && signals.exportVsSourceScore < 0.85) bump(0.3);
  if (status === 'completed' && score === null) return 0;
  return score === null ? null : clamp01(score);
}

// --- scores ----------------------------------------------------------------

const COMPLEXITY_WEIGHTS = {
  pageCount: 0.15,
  table: 0.15,
  image: 0.12,
  design: 0.18,
  ocr: 0.15,
  visualQa: 0.1,
  repair: 0.1,
  exportParity: 0.05,
};

/** Weighted 0..1 complexity from the available sub-risks (null sub-scores ignored). */
export function calculateImportComplexityScore(
  signals: ImportIntelligenceSignals,
): number | null {
  const parts: Array<[number, number | null]> = [
    [COMPLEXITY_WEIGHTS.pageCount, pageCountRisk(signals.pageCount)],
    [COMPLEXITY_WEIGHTS.table, tableRiskFromCount(signals.tableCountEstimate)],
    [COMPLEXITY_WEIGHTS.image, imageRiskFromCount(signals.imageCountEstimate)],
    [COMPLEXITY_WEIGHTS.design, designRiskFromSignals(signals)],
    [COMPLEXITY_WEIGHTS.ocr, signals.ocrLikelihood],
    [COMPLEXITY_WEIGHTS.visualQa, visualQaRisk(signals)],
    [COMPLEXITY_WEIGHTS.repair, repairRisk(signals)],
    [COMPLEXITY_WEIGHTS.exportParity, exportParityRisk(signals)],
  ];
  let weightSum = 0;
  let acc = 0;
  for (const [weight, score] of parts) {
    if (score === null) continue;
    weightSum += weight;
    acc += weight * score;
  }
  if (weightSum === 0) return null;
  return clamp01(acc / weightSum);
}

/** 0..1 automation risk; null only when no risk-bearing signal is present. */
export function calculateAutomationRiskScore(
  signals: ImportIntelligenceSignals,
): number | null {
  let score = 0;
  let evidence = false;
  const complexity = calculateImportComplexityScore(signals);
  if (complexity !== null) {
    score += complexity * 0.35;
    evidence = true;
  }
  if (signals.ocrLikelihood !== null) {
    score += signals.ocrLikelihood * 0.2;
    evidence = true;
  }
  if (signals.visualQaManualReviewRequired === true) {
    score += 0.25;
    evidence = true;
  }
  if (signals.repairRequiresFallback === true) {
    score += 0.2;
    evidence = true;
  }
  if (signals.repairRequiresManualReview === true) {
    score += 0.15;
    evidence = true;
  }
  if (lower(signals.repairStatus) === 'failed') {
    score += 0.3;
    evidence = true;
  }
  const exportStatus = lower(signals.exportParityStatus);
  if (exportStatus === 'failed') {
    score += 0.3;
    evidence = true;
  } else if (exportStatus === 'manual_required') {
    score += 0.15;
    evidence = true;
  }
  const gate = lower(signals.goldenQualityGateStatus);
  if (gate === 'fail' || gate === 'blocked') {
    score += 0.3;
    evidence = true;
  }
  if (lower(signals.baselineOutcome) === 'degraded') {
    score += 0.15;
    evidence = true;
  }
  return evidence ? clamp01(score) : null;
}

/** 0..1 likelihood a human review is needed; null when no relevant signal. */
export function calculateManualReviewLikelihood(
  signals: ImportIntelligenceSignals,
): number | null {
  let score = 0;
  let evidence = false;
  const bump = (v: number) => {
    score += v;
    evidence = true;
  };
  if (signals.visualQaManualReviewRequired === true) bump(0.4);
  if (signals.repairRequiresManualReview === true) bump(0.3);
  if (signals.ocrLikelihood !== null && signals.ocrLikelihood >= 0.65) bump(0.3);
  const design = designRiskFromSignals(signals);
  if (design !== null && design >= 0.65) bump(0.2);
  const table = tableRiskFromCount(signals.tableCountEstimate);
  if (table !== null && table >= 0.65) bump(0.2);
  if (lower(signals.exportParityStatus) === 'manual_required') bump(0.2);
  const gate = lower(signals.goldenQualityGateStatus);
  if (gate === 'warning' || gate === 'fail' || gate === 'blocked') bump(0.2);
  return evidence ? clamp01(score) : null;
}

/** 0..1 confidence based on how many independent evidence groups are present. */
export function calculateImportProfileConfidence(
  signals: ImportIntelligenceSignals,
  evidence?: ImportIntelligenceEvidence[],
): number {
  let coverage = 0;
  if (signals.pageCount !== null) coverage += 0.15;
  if (signals.hasVisualQuality) coverage += 0.2;
  if (signals.hasRepairAudit) coverage += 0.2;
  if (signals.hasExportParity) coverage += 0.15;
  if (signals.tableCountEstimate !== null || signals.imageCountEstimate !== null) coverage += 0.15;
  if (signals.goldenQualityGateStatus !== null || (signals.goldenFailureCount ?? null) !== null) coverage += 0.15;
  if (evidence && evidence.length >= 3) coverage += 0.05;
  // A known import with a page count is never zero-confidence.
  if (signals.pageCount !== null) coverage = Math.max(coverage, 0.2);
  return clamp01(Math.min(coverage, 0.98));
}

// --- category & risk -------------------------------------------------------

/** Deterministic profile category from signals + scores. */
export function resolveImportProfileCategory(input: {
  signals: ImportIntelligenceSignals;
  scores: ImportIntelligenceScores;
}): ImportIntelligenceProfileCategory {
  const { signals, scores } = input;
  const table = scores.tableRiskScore ?? 0;
  const image = scores.imageRiskScore ?? 0;
  const design = scores.designRiskScore ?? 0;
  const ocr = scores.ocrRiskScore ?? 0;
  const automation = scores.automationRiskScore ?? 0;
  const complexity = scores.complexityScore ?? 0;
  const confidence = scores.confidence ?? 0;
  const pageCount = signals.pageCount ?? 0;
  const gate = lower(signals.goldenQualityGateStatus);

  // 1. high_risk
  if (automation >= 0.85) return 'high_risk';
  if ((gate === 'fail' || gate === 'blocked') && (signals.goldenFailureCount ?? 0) > 0) return 'high_risk';
  if (lower(signals.repairStatus) === 'failed' && signals.visualQaScore !== null && signals.visualQaScore < 0.7) {
    return 'high_risk';
  }

  // 9 (early). Insufficient evidence to classify confidently.
  if (confidence < 0.35) return 'unknown';

  const highCount = [table, image, design, ocr].filter((v) => v >= 0.65).length;

  // 3. mixed_complex
  if (highCount >= 2 && complexity >= 0.65) return 'mixed_complex';

  // 2. scanned_ocr
  if (ocr >= 0.75 && !(table >= 0.65 || image >= 0.65 || design >= 0.65)) return 'scanned_ocr';
  if (ocr >= 0.75 && signals.textDensityEstimate !== null && signals.textDensityEstimate < 0.2) {
    return 'scanned_ocr';
  }

  // 4/5/6. dominant single risk
  if (table >= 0.65 && table >= image && table >= design && table >= ocr) return 'table_heavy';
  if (image >= 0.65 && image >= table && image >= design && image >= ocr) return 'image_heavy';
  if (design >= 0.65 && design >= table && design >= image && design >= ocr) return 'design_heavy';

  // 7. multi_page_report
  if (
    pageCount >= 3 &&
    complexity >= 0.35 && complexity <= 0.75 &&
    table < 0.65 && image < 0.65 && ocr < 0.65 && design < 0.65
  ) {
    return 'multi_page_report';
  }

  // 8. simple_document
  if (
    pageCount <= 2 &&
    complexity < 0.35 &&
    automation < 0.35 &&
    signals.visualQaManualReviewRequired !== true &&
    signals.repairRequiresFallback !== true
  ) {
    return 'simple_document';
  }

  return 'unknown';
}

/** Deterministic risk level from scores alone. */
export function resolveImportRiskLevel(
  scores: ImportIntelligenceScores,
): ImportIntelligenceRiskLevel {
  const automation = scores.automationRiskScore;
  const manual = scores.manualReviewLikelihood;
  const complexity = scores.complexityScore;
  const confidence = scores.confidence;

  if (automation !== null && automation >= 0.85) return 'critical';
  if ((automation !== null && automation >= 0.65) || (manual !== null && manual >= 0.75)) return 'high';
  if ((automation !== null && automation >= 0.35) || (complexity !== null && complexity >= 0.45)) return 'medium';
  if (automation !== null && automation < 0.35 && confidence !== null && confidence >= 0.35) return 'low';
  return 'unknown';
}

// --- recommendations -------------------------------------------------------

/** Strategy recommendations from category + risk + scores + signals. */
export function buildImportIntelligenceRecommendations(input: {
  profileCategory: ImportIntelligenceProfileCategory;
  riskLevel: ImportIntelligenceRiskLevel;
  scores: ImportIntelligenceScores;
  signals: ImportIntelligenceSignals;
}): ImportIntelligenceRecommendations {
  const { profileCategory, riskLevel, scores, signals } = input;
  const automation = scores.automationRiskScore ?? 0;
  const visualQaLow = (signals.visualQaScore !== null && signals.visualQaScore < 0.85)
    || (signals.repairFinalScore !== null && signals.repairFinalScore < 0.85);

  switch (profileCategory) {
    case 'simple_document':
      return {
        visualQaStrategy: 'recommended',
        repairStrategy: 'allow',
        aiReconciliationStrategy: 'not_needed',
        exportParityStrategy: 'recommended',
        operatorStrategy: 'proceed',
      };
    case 'design_heavy':
      return {
        visualQaStrategy: 'required',
        repairStrategy: 'allow_with_review',
        aiReconciliationStrategy: automation >= 0.5 ? 'recommended' : 'optional',
        exportParityStrategy: 'required',
        operatorStrategy: 'review_before_apply',
      };
    case 'multi_page_report':
      return {
        visualQaStrategy: 'required',
        repairStrategy: 'allow_with_review',
        aiReconciliationStrategy: 'optional',
        exportParityStrategy: 'required',
        operatorStrategy: 'review_before_apply',
      };
    case 'table_heavy':
      return {
        visualQaStrategy: 'required',
        repairStrategy: 'allow_with_review',
        aiReconciliationStrategy: visualQaLow ? 'recommended' : 'optional',
        exportParityStrategy: 'required',
        operatorStrategy: 'review_before_apply',
      };
    case 'image_heavy':
      return {
        visualQaStrategy: 'required',
        repairStrategy: 'allow_with_review',
        aiReconciliationStrategy: 'optional',
        exportParityStrategy: 'required',
        operatorStrategy: 'review_before_apply',
      };
    case 'scanned_ocr':
      return {
        visualQaStrategy: 'required',
        repairStrategy: 'manual_only',
        aiReconciliationStrategy: 'manual_review',
        exportParityStrategy: 'manual_required',
        operatorStrategy: 'manual_review_required',
      };
    case 'mixed_complex':
      return {
        visualQaStrategy: 'required',
        repairStrategy: 'allow_with_review',
        aiReconciliationStrategy: 'recommended',
        exportParityStrategy: 'required',
        operatorStrategy: riskLevel === 'high' || riskLevel === 'critical'
          ? 'manual_review_required'
          : 'review_before_apply',
      };
    case 'high_risk':
      return {
        visualQaStrategy: 'required',
        repairStrategy: riskLevel === 'critical' ? 'blocked' : 'manual_only',
        aiReconciliationStrategy: riskLevel === 'critical' ? 'blocked' : 'manual_review',
        exportParityStrategy: 'manual_required',
        operatorStrategy: 'block_until_review',
      };
    case 'unknown':
    default:
      return {
        visualQaStrategy: 'required',
        repairStrategy: 'allow_with_review',
        aiReconciliationStrategy: 'optional',
        exportParityStrategy: 'recommended',
        operatorStrategy: 'review_before_apply',
      };
  }
}

// --- top-level classify ----------------------------------------------------

/** Classify signals into category, risk, scores, and recommendations. */
export function classifyImportIntelligenceProfile(input: {
  signals: ImportIntelligenceSignals;
  evidence?: ImportIntelligenceEvidence[];
}): {
  profileCategory: ImportIntelligenceProfileCategory;
  riskLevel: ImportIntelligenceRiskLevel;
  scores: ImportIntelligenceScores;
  recommendations: ImportIntelligenceRecommendations;
  warnings: string[];
  blockers: string[];
} {
  const { signals, evidence } = input;

  const scores: ImportIntelligenceScores = {
    complexityScore: calculateImportComplexityScore(signals),
    ocrRiskScore: signals.ocrLikelihood,
    tableRiskScore: tableRiskFromCount(signals.tableCountEstimate),
    imageRiskScore: imageRiskFromCount(signals.imageCountEstimate),
    designRiskScore: designRiskFromSignals(signals),
    automationRiskScore: calculateAutomationRiskScore(signals),
    manualReviewLikelihood: calculateManualReviewLikelihood(signals),
    confidence: calculateImportProfileConfidence(signals, evidence),
  };

  const profileCategory = resolveImportProfileCategory({ signals, scores });

  let riskLevel = resolveImportRiskLevel(scores);
  const gate = lower(signals.goldenQualityGateStatus);
  if (gate === 'fail' || gate === 'blocked') riskLevel = 'critical';
  if (profileCategory === 'high_risk' && riskLevel !== 'critical') riskLevel = 'high';

  const recommendations = buildImportIntelligenceRecommendations({
    profileCategory, riskLevel, scores, signals,
  });

  const warnings: string[] = [];
  const blockers: string[] = [];
  if (scores.confidence !== null && scores.confidence < 0.35) warnings.push('low_profile_confidence');
  if (profileCategory === 'unknown') warnings.push('profile_category_unknown');

  return { profileCategory, riskLevel, scores, recommendations, warnings, blockers };
}
