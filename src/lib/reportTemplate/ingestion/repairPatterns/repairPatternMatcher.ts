/**
 * repairPatternMatcher — Phase 10C.
 *
 * Deterministic matching of extracted signals to known repair patterns, and
 * resolution of the overall analysis (primary pattern, severity, confidence, and
 * downstream strategy requirements). Pure; evidence-based; non-AI.
 */
import {
  getRepairPatternDefinition,
  REPAIR_PATTERN_LIBRARY,
} from './repairPatternLibrary';
import type {
  RepairPatternDefinition,
  RepairPatternDeterministicRepairStrategy,
  RepairPatternEvidence,
  RepairPatternExportParityRequirement,
  RepairPatternId,
  RepairPatternMatch,
  RepairPatternOperatorReviewRequirement,
  RepairPatternSeverity,
  RepairPatternSignals,
  RepairPatternAiReconciliationUsefulness,
} from './repairPatternTypes';

const MATCH_THRESHOLD = 0.55;

const SEVERITY_WEIGHT: Record<RepairPatternSeverity, number> = {
  info: 1, low: 2, medium: 3, high: 4, critical: 5,
};

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return Math.round(v * 1000) / 1000;
}

function lower(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function hasCode(signals: RepairPatternSignals, keywords: string[]): boolean {
  const all = [...signals.failureCodes, ...signals.warningCodes].map((c) => c.toLowerCase());
  return all.some((code) => keywords.some((k) => code.includes(k)));
}

function inProfile(signals: RepairPatternSignals, categories: string[]): boolean {
  return signals.profileCategory !== null && categories.includes(signals.profileCategory);
}

interface Accumulator {
  score: number;
  evidence: RepairPatternEvidence[];
}

function add(acc: Accumulator, cond: boolean, weight: number, code: string, label: string, value: string | number | boolean | null, message: string): void {
  if (!cond) return;
  acc.score += weight;
  acc.evidence.push({ code, label, value, weight, message });
}

/** Score a single pattern against the signals. */
export function scoreRepairPattern(input: {
  patternId: RepairPatternId;
  signals: RepairPatternSignals;
}): {
  score: number;
  confidence: number;
  severity: RepairPatternSeverity;
  evidence: RepairPatternEvidence[];
  matched: boolean;
  message: string;
} {
  const { patternId, signals: s } = input;
  const def = getRepairPatternDefinition(patternId);
  const acc: Accumulator = { score: 0, evidence: [] };
  const vq = s.visualQaScore;
  const exp = s.exportVsSourceScore;

  switch (patternId) {
    case 'page_margin_drift':
      add(acc, vq !== null && vq < 0.9 && vq >= 0.6, 0.35, 'moderate_visual_qa', 'Moderate Visual QA', vq, 'Visual QA is moderately below target.');
      add(acc, exp !== null && exp < 0.9, 0.2, 'export_below_target', 'Export below target', exp, 'Export vs source is below target.');
      add(acc, hasCode(s, ['page', 'geometry', 'align', 'drift', 'margin']), 0.4, 'geometry_code', 'Geometry/alignment signal', true, 'A geometry/alignment failure was reported.');
      add(acc, inProfile(s, ['simple_document', 'multi_page_report', 'design_heavy', 'mixed_complex']), 0.1, 'eligible_profile', 'Eligible profile', s.profileCategory, 'Profile is eligible for margin drift.');
      break;
    case 'background_block_shift':
      add(acc, s.designRiskScore !== null && s.designRiskScore >= 0.6, 0.35, 'high_design_risk', 'High design risk', s.designRiskScore, 'Design risk is elevated.');
      add(acc, inProfile(s, ['design_heavy', 'image_heavy', 'mixed_complex']), 0.15, 'eligible_profile', 'Eligible profile', s.profileCategory, 'Profile is eligible for background shift.');
      add(acc, s.repairRequiresFallback === true || s.repairRequiresManualReview === true, 0.25, 'repair_fallback', 'Repair fallback/manual', true, 'Repair required fallback or manual review.');
      add(acc, exp !== null && exp < 0.85, 0.15, 'export_low', 'Export low', exp, 'Export vs source is low.');
      add(acc, hasCode(s, ['background', 'block', 'shift']), 0.3, 'background_code', 'Background signal', true, 'A background/block failure was reported.');
      break;
    case 'font_scale_mismatch':
      add(acc, vq !== null && vq < 0.85, 0.3, 'low_visual_qa', 'Low Visual QA', vq, 'Visual QA is below target.');
      add(acc, s.repairFinalScore !== null && s.repairFinalScore < 0.9, 0.15, 'repair_moderate', 'Repair moderate', s.repairFinalScore, 'Repair final score is moderate.');
      add(acc, hasCode(s, ['font', 'text', 'overflow', 'clip', 'line', 'typography', 'scale']), 0.4, 'typography_code', 'Typography signal', true, 'A typography failure/warning was reported.');
      break;
    case 'table_grid_drift':
      add(acc, s.tableRiskScore !== null && s.tableRiskScore >= 0.65, 0.45, 'high_table_risk', 'High table risk', s.tableRiskScore, 'Table risk is high.');
      add(acc, inProfile(s, ['table_heavy']), 0.2, 'table_profile', 'Table-heavy profile', s.profileCategory, 'Profile is table-heavy.');
      add(acc, vq !== null && vq < 0.85, 0.15, 'low_visual_qa', 'Low Visual QA', vq, 'Visual QA is below target.');
      add(acc, s.repairRequiresFallback === true || s.repairRequiresManualReview === true, 0.1, 'repair_fallback', 'Repair fallback/manual', true, 'Repair required fallback or manual review.');
      add(acc, hasCode(s, ['table', 'grid', 'row', 'column']), 0.3, 'table_code', 'Table signal', true, 'A table/grid failure was reported.');
      break;
    case 'image_crop_mismatch':
      add(acc, s.imageRiskScore !== null && s.imageRiskScore >= 0.65, 0.4, 'high_image_risk', 'High image risk', s.imageRiskScore, 'Image risk is high.');
      add(acc, inProfile(s, ['image_heavy']), 0.15, 'image_profile', 'Image-heavy profile', s.profileCategory, 'Profile is image-heavy.');
      add(acc, exp !== null && exp < 0.85, 0.2, 'export_low', 'Export low', exp, 'Export vs source is low.');
      add(acc, s.visualQaManualReviewRequired === true, 0.1, 'visual_manual_review', 'Visual manual review', true, 'Visual QA requires manual review.');
      add(acc, hasCode(s, ['image', 'crop', 'aspect', 'fit']), 0.3, 'image_code', 'Image signal', true, 'An image/crop failure was reported.');
      break;
    case 'layer_order_conflict':
      add(acc, s.designRiskScore !== null && s.designRiskScore >= 0.65, 0.35, 'high_design_risk', 'High design risk', s.designRiskScore, 'Design risk is high.');
      add(acc, hasCode(s, ['layer', 'z-order', 'z_order', 'zorder', 'order', 'background', 'stack']), 0.4, 'layer_code', 'Layering signal', true, 'A layering/z-order failure was reported.');
      add(acc, vq !== null && vq < 0.85, 0.15, 'low_visual_qa', 'Low Visual QA', vq, 'Visual QA is below target.');
      add(acc, inProfile(s, ['design_heavy', 'image_heavy', 'mixed_complex']), 0.1, 'eligible_profile', 'Eligible profile', s.profileCategory, 'Profile is eligible for layer conflict.');
      break;
    case 'ocr_text_fragments':
      add(acc, s.ocrRiskScore !== null && s.ocrRiskScore >= 0.65, 0.4, 'high_ocr_risk', 'High OCR risk', s.ocrRiskScore, 'OCR risk is high.');
      add(acc, inProfile(s, ['scanned_ocr']), 0.25, 'ocr_profile', 'Scanned/OCR profile', s.profileCategory, 'Profile is scanned/OCR.');
      add(acc, s.manualReviewLikelihood !== null && s.manualReviewLikelihood >= 0.6, 0.15, 'manual_review_likely', 'Manual review likely', s.manualReviewLikelihood, 'Manual review is likely.');
      add(acc, s.repairRequiresFallback === true || s.repairRequiresManualReview === true, 0.15, 'repair_fallback', 'Repair fallback/manual', true, 'Repair required fallback or manual review.');
      add(acc, hasCode(s, ['ocr', 'scanned', 'fragment']), 0.2, 'ocr_code', 'OCR signal', true, 'An OCR/scanned failure was reported.');
      break;
    case 'header_footer_alignment':
      add(acc, s.pageCount !== null && s.pageCount >= 3, 0.25, 'multi_page', 'Multi-page', s.pageCount, 'Import has 3+ pages.');
      add(acc, inProfile(s, ['multi_page_report', 'mixed_complex']), 0.15, 'multipage_profile', 'Multi-page profile', s.profileCategory, 'Profile is multi-page.');
      add(acc, hasCode(s, ['header', 'footer', 'repeated']), 0.4, 'header_footer_code', 'Header/footer signal', true, 'A header/footer failure was reported.');
      add(acc, vq !== null && vq < 0.9, 0.15, 'moderate_visual_qa', 'Moderate Visual QA', vq, 'Visual QA is moderately below target.');
      break;
    case 'multi_page_spacing_drift':
      add(acc, s.pageCount !== null && s.pageCount >= 3, 0.25, 'multi_page', 'Multi-page', s.pageCount, 'Import has 3+ pages.');
      add(acc, inProfile(s, ['multi_page_report', 'mixed_complex']), 0.15, 'multipage_profile', 'Multi-page profile', s.profileCategory, 'Profile is multi-page.');
      add(acc, hasCode(s, ['spacing', 'vertical', 'offset', 'space']), 0.4, 'spacing_code', 'Spacing signal', true, 'A spacing failure/warning was reported.');
      add(acc, s.repairRequiresFallback === true || s.repairRequiresManualReview === true, 0.1, 'repair_fallback', 'Repair fallback/manual', true, 'Repair required fallback or manual review.');
      add(acc, vq !== null && vq < 0.9, 0.1, 'moderate_visual_qa', 'Moderate Visual QA', vq, 'Visual QA is moderately below target.');
      break;
    case 'missing_major_visual_element':
      add(acc, vq !== null && vq < 0.6, 0.35, 'very_low_visual_qa', 'Very low Visual QA', vq, 'Visual QA is very low.');
      add(acc, exp !== null && exp < 0.6, 0.25, 'very_low_export', 'Very low export', exp, 'Export vs source is very low.');
      add(acc, inProfile(s, ['design_heavy', 'image_heavy', 'table_heavy', 'mixed_complex', 'high_risk']), 0.1, 'eligible_profile', 'Eligible profile', s.profileCategory, 'Profile is eligible for missing element.');
      add(acc, lower(s.repairStatus) === 'failed', 0.2, 'repair_failed', 'Repair failed', s.repairStatus, 'Repair failed.');
      add(acc, lower(s.goldenQualityGateStatus) === 'fail' || lower(s.goldenQualityGateStatus) === 'blocked', 0.15, 'gate_failed', 'Quality gate failed', s.goldenQualityGateStatus, 'Quality gate failed/blocked.');
      add(acc, hasCode(s, ['missing', 'artifact', 'visual', 'content']), 0.3, 'missing_code', 'Missing-content signal', true, 'A missing-content failure was reported.');
      break;
    case 'export_renderer_mismatch': {
      const editorOk = s.editorVsSourceScore !== null && s.editorVsSourceScore >= 0.85;
      add(acc, lower(s.exportParityStatus) === 'failed' || lower(s.exportParityStatus) === 'manual_required', 0.35, 'export_parity_problem', 'Export parity problem', s.exportParityStatus, 'Export parity failed or needs manual review.');
      add(acc, editorOk && exp !== null && exp < 0.8, 0.3, 'editor_ok_export_bad', 'Editor OK but export low', exp, 'Editor render is acceptable but export is low.');
      add(acc, s.exportVsEditorScore !== null && s.exportVsEditorScore < 0.85, 0.2, 'export_vs_editor_low', 'Export vs editor low', s.exportVsEditorScore, 'Export differs from editor render.');
      add(acc, hasCode(s, ['export', 'renderer']), 0.3, 'export_code', 'Export signal', true, 'An export/renderer failure was reported.');
      break;
    }
    case 'manual_review_only':
      add(acc, inProfile(s, ['high_risk', 'scanned_ocr']), 0.35, 'high_risk_profile', 'High-risk/OCR profile', s.profileCategory, 'Profile is high-risk or scanned/OCR.');
      add(acc, s.automationRiskScore !== null && s.automationRiskScore >= 0.65, 0.25, 'high_automation_risk', 'High automation risk', s.automationRiskScore, 'Automation risk is high.');
      add(acc, s.manualReviewLikelihood !== null && s.manualReviewLikelihood >= 0.7, 0.15, 'manual_review_likely', 'Manual review likely', s.manualReviewLikelihood, 'Manual review is very likely.');
      add(acc, s.repairRequiresFallback === true || s.repairRequiresManualReview === true, 0.15, 'repair_fallback', 'Repair fallback/manual', true, 'Repair required fallback or manual review.');
      add(acc, lower(s.goldenQualityGateStatus) === 'fail' || lower(s.goldenQualityGateStatus) === 'blocked', 0.15, 'gate_failed', 'Quality gate failed', s.goldenQualityGateStatus, 'Quality gate failed/blocked.');
      add(acc, lower(s.baselineOutcome) === 'degraded', 0.1, 'baseline_degraded', 'Baseline degraded', s.baselineOutcome, 'Baseline degraded.');
      break;
    default:
      break;
  }

  const score = clamp01(acc.score);
  const matched = score >= MATCH_THRESHOLD;
  let severity: RepairPatternSeverity = def?.defaultSeverity ?? 'info';
  // Escalate medium → high when strongly evidenced.
  if (severity === 'medium' && score >= 0.85) severity = 'high';
  const confidence = clamp01(Math.min(0.95, 0.35 + score * 0.5 + acc.evidence.length * 0.04));
  const message = matched
    ? `${def?.title ?? patternId} matched (score ${score}).`
    : `${def?.title ?? patternId} not matched (score ${score}).`;

  return { score, confidence, severity, evidence: acc.evidence, matched, message };
}

/** Score every library pattern against the signals. */
export function matchRepairPatterns(input: {
  signals: RepairPatternSignals;
  evidence?: RepairPatternEvidence[];
  definitions?: RepairPatternDefinition[];
}): RepairPatternMatch[] {
  const definitions = input.definitions ?? REPAIR_PATTERN_LIBRARY;
  return definitions.map((def) => {
    const scored = scoreRepairPattern({ patternId: def.patternId, signals: input.signals });
    return {
      patternId: def.patternId,
      category: def.category,
      severity: scored.severity,
      confidence: scored.confidence,
      score: scored.score,
      matched: scored.matched,
      evidence: scored.evidence,
      recommendedAction: def.recommendedAction,
      manualFallback: def.manualFallback,
      aiReconciliationUsefulness: def.aiReconciliationUsefulness,
      exportParityRequirement: def.exportParityRequirement,
      operatorReviewRequirement: def.operatorReviewRequirement,
      message: scored.message,
    };
  });
}

function matchedOnly(matches: RepairPatternMatch[]): RepairPatternMatch[] {
  return matches.filter((m) => m.matched);
}

/** Highest-score matched pattern; ties broken by severity weight. */
export function resolvePrimaryRepairPattern(
  matches: RepairPatternMatch[],
): RepairPatternMatch | null {
  const m = matchedOnly(matches);
  if (m.length === 0) return null;
  return [...m].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
  })[0];
}

/** Highest severity among matched patterns; `info` when none. */
export function resolveOverallRepairPatternSeverity(
  matches: RepairPatternMatch[],
): RepairPatternSeverity {
  const m = matchedOnly(matches);
  if (m.length === 0) return 'info';
  return m.reduce<RepairPatternSeverity>((worst, cur) =>
    SEVERITY_WEIGHT[cur.severity] > SEVERITY_WEIGHT[worst] ? cur.severity : worst, 'info');
}

/** Score-weighted average confidence of matched patterns; 0 when none. */
export function resolveOverallRepairPatternConfidence(
  matches: RepairPatternMatch[],
): number {
  const m = matchedOnly(matches);
  if (m.length === 0) return 0;
  let weightSum = 0;
  let acc = 0;
  for (const p of m) {
    weightSum += p.score;
    acc += p.score * p.confidence;
  }
  if (weightSum === 0) return 0;
  return clamp01(acc / weightSum);
}

function anyPattern(matches: RepairPatternMatch[], ids: RepairPatternId[]): boolean {
  return matchedOnly(matches).some((m) => ids.includes(m.patternId));
}

function anyCategory(matches: RepairPatternMatch[], cats: string[]): boolean {
  return matchedOnly(matches).some((m) => cats.includes(m.category));
}

function anySeverity(matches: RepairPatternMatch[], sev: RepairPatternSeverity): boolean {
  return matchedOnly(matches).some((m) => m.severity === sev);
}

/** Deterministic repair strategy from matched patterns. */
export function resolveDeterministicRepairStrategy(
  matches: RepairPatternMatch[],
  _signals: RepairPatternSignals,
): RepairPatternDeterministicRepairStrategy {
  const m = matchedOnly(matches);
  if (m.length === 0) return 'unknown';
  if (anyPattern(matches, ['manual_review_only', 'missing_major_visual_element'])) return 'blocked';
  if (anyPattern(matches, ['ocr_text_fragments'])) return 'manual_only';
  if (anyPattern(matches, ['table_grid_drift', 'image_crop_mismatch', 'layer_order_conflict'])) return 'constrained';
  if (anySeverity(matches, 'high') || anySeverity(matches, 'medium')) return 'safe_with_review';
  return 'safe';
}

/** AI reconciliation usefulness from matched patterns. */
export function resolveAiReconciliationUsefulness(
  matches: RepairPatternMatch[],
  _signals: RepairPatternSignals,
): RepairPatternAiReconciliationUsefulness {
  const m = matchedOnly(matches);
  if (m.length === 0) return 'not_needed';
  if (anyPattern(matches, ['manual_review_only', 'ocr_text_fragments'])) return 'manual_review_only';
  if (anyPattern(matches, ['table_grid_drift', 'missing_major_visual_element'])) return 'high';
  if (anySeverity(matches, 'high') || anyPattern(matches, ['background_block_shift', 'font_scale_mismatch', 'multi_page_spacing_drift', 'layer_order_conflict'])) return 'medium';
  return 'low';
}

/** Export parity requirement from matched patterns. */
export function resolveExportParityRequirement(
  matches: RepairPatternMatch[],
  _signals: RepairPatternSignals,
): RepairPatternExportParityRequirement {
  const m = matchedOnly(matches);
  if (m.length === 0) return 'not_required';
  if (anyPattern(matches, ['ocr_text_fragments', 'manual_review_only', 'missing_major_visual_element'])) return 'manual_required';
  if (anyCategory(matches, ['geometry', 'export', 'image', 'table', 'layering'])) return 'rerun_required';
  if (anySeverity(matches, 'high') || anySeverity(matches, 'medium')) return 'required';
  return 'recommended';
}

/** Operator review requirement from matched patterns. */
export function resolveOperatorReviewRequirement(
  matches: RepairPatternMatch[],
  _signals: RepairPatternSignals,
): RepairPatternOperatorReviewRequirement {
  const m = matchedOnly(matches);
  if (m.length === 0) return 'not_required';
  if (anyPattern(matches, ['manual_review_only', 'missing_major_visual_element']) || anySeverity(matches, 'critical')) return 'block_until_review';
  if (anySeverity(matches, 'high')) return 'required';
  if (anySeverity(matches, 'medium')) return 'recommended';
  return 'not_required';
}
