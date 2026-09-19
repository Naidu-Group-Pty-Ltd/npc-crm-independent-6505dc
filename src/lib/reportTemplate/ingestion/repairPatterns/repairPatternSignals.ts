/**
 * repairPatternSignals — Phase 10C.
 *
 * Deterministic extraction of repair-pattern signals from the import intelligence
 * profile, snapshot, and QA/repair/export/golden/quality-gate/triage summaries.
 * Never reads or stores raw PDF/OCR text.
 */
import type {
  RepairPatternEvidence,
  RepairPatternSignals,
} from './repairPatternTypes';

/** Clamp any value to a finite number in [0, 1], or null. Accepts numeric strings. */
export function clampRepairPatternScore(value: unknown): number | null {
  const n = coerceRepairPatternNumber(value);
  if (n === null) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Coerce to boolean, or null. Accepts "true"/"false" (case-insensitive). */
export function coerceRepairPatternBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return null;
}

/** Coerce to a finite number, or null. Accepts numeric strings. */
export function coerceRepairPatternNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Read a nested value at `path`, or undefined. Never throws. */
export function readRepairPatternPath(source: unknown, path: string[]): unknown {
  let cur: any = source;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function pick<T>(coerce: (v: unknown) => T | null, cands: unknown[]): T | null {
  for (const c of cands) {
    const r = coerce(c);
    if (r !== null && r !== undefined) return r;
  }
  return null;
}

function collectSchemaBlocks(templateSchema: unknown): Array<Record<string, unknown>> {
  const pages = readRepairPatternPath(templateSchema, ['pages']);
  if (!Array.isArray(pages)) return [];
  const blocks: Array<Record<string, unknown>> = [];
  for (const page of pages) {
    const pageBlocks = (page as any)?.blocks ?? (page as any)?.elements ?? (page as any)?.children;
    if (Array.isArray(pageBlocks)) {
      for (const b of pageBlocks) if (b && typeof b === 'object') blocks.push(b as Record<string, unknown>);
    }
  }
  return blocks;
}

function descriptor(block: Record<string, unknown>): string {
  return [block.type, block.kind, block.name, block.role, block.blockType]
    .filter((p) => typeof p === 'string')
    .map((p) => (p as string).toLowerCase())
    .join(' ');
}

/** 0..1 estimate of schema layering complexity from positioned/z-indexed elements. */
export function estimateSchemaLayerComplexity(templateSchema: unknown): number | null {
  const blocks = collectSchemaBlocks(templateSchema);
  if (blocks.length === 0) return null;
  let positioned = 0;
  for (const b of blocks) {
    const d = descriptor(b);
    const hasZ = b.zIndex !== undefined || b.z_index !== undefined || (b as any).layer !== undefined;
    const isAbsolute = typeof (b as any).position === 'string' && String((b as any).position).toLowerCase() === 'absolute';
    if (hasZ || isAbsolute || d.includes('background') || d.includes('image')) positioned += 1;
  }
  // Cap: 20 positioned/layered elements → 1.0.
  const raw = positioned / 20;
  return raw > 1 ? 1 : Math.round(raw * 1000) / 1000;
}

/** 0..1 estimate that repeated header/footer regions exist across a multi-page schema. */
export function estimateRepeatedHeaderFooterRisk(
  templateSchema: unknown,
  pageCount: number | null,
): number | null {
  if (pageCount === null || pageCount < 2) return null;
  const blocks = collectSchemaBlocks(templateSchema);
  if (blocks.length === 0) return null;
  let repeated = 0;
  for (const b of blocks) {
    const d = descriptor(b);
    if (d.includes('header') || d.includes('footer')) repeated += 1;
  }
  if (repeated === 0) return 0;
  // More repeated regions across more pages → higher risk, capped.
  const raw = (repeated / pageCount) * 0.5 + (pageCount >= 3 ? 0.3 : 0.1);
  return raw > 1 ? 1 : Math.round(raw * 1000) / 1000;
}

function collectGateCodes(report: unknown, status: 'fail' | 'warning'): string[] {
  const gates = readRepairPatternPath(report, ['gates']);
  const out: string[] = [];
  if (Array.isArray(gates)) {
    for (const g of gates) {
      const s = coerceString((g as any)?.status);
      const id = coerceString((g as any)?.id);
      if (s === status && id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** Gate ids whose status is `fail`. */
export function extractFailureCodesFromQualityGateReport(report: unknown): string[] {
  return collectGateCodes(report, 'fail');
}

/** Gate ids whose status is `warning`. */
export function extractWarningCodesFromQualityGateReport(report: unknown): string[] {
  return collectGateCodes(report, 'warning');
}

/** Failure/signal codes from a failure triage summary (defensive across shapes). */
export function extractFailureCodesFromTriage(triage: unknown): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = coerceString(v);
    if (s && !out.includes(s)) out.push(s);
  };
  const signals = readRepairPatternPath(triage, ['signals']);
  if (Array.isArray(signals)) {
    for (const s of signals) {
      push((s as any)?.code ?? s);
    }
  }
  const failures = readRepairPatternPath(triage, ['failures']);
  if (Array.isArray(failures)) for (const f of failures) push((f as any)?.code ?? f);
  const recs = readRepairPatternPath(triage, ['recommendations']);
  if (Array.isArray(recs)) for (const r of recs) push((r as any)?.code ?? (r as any)?.action);
  return out;
}

function pushEvidence(
  list: RepairPatternEvidence[],
  code: string,
  label: string,
  value: string | number | boolean | null,
  weight: number,
  message: string,
): void {
  list.push({ code, label, value, weight, message });
}

/** Extract deterministic repair-pattern signals + evidence from all inputs. */
export function extractRepairPatternSignals(input: {
  importId?: string | null;
  templateId?: string | null;
  sourceFilename?: string | null;
  snapshot?: unknown;
  importIntelligenceProfile?: unknown;
  visualQualitySummary?: unknown;
  repairSummary?: unknown;
  exportParitySummary?: unknown;
  goldenRegressionSummary?: unknown;
  qualityGateReport?: unknown;
  triageSummary?: unknown;
  templateSchema?: unknown;
}): {
  signals: RepairPatternSignals;
  evidence: RepairPatternEvidence[];
  warnings: string[];
  blockers: string[];
} {
  const snap = input.snapshot;
  const profile = input.importIntelligenceProfile;
  const vq = input.visualQualitySummary;
  const repair = input.repairSummary;
  const exportParity = input.exportParitySummary;
  const golden = input.goldenRegressionSummary;

  const evidence: RepairPatternEvidence[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  const importId = coerceString(input.importId)
    ?? coerceString(readRepairPatternPath(snap, ['importId']))
    ?? coerceString(readRepairPatternPath(profile, ['importId']));
  const templateId = coerceString(input.templateId)
    ?? coerceString(readRepairPatternPath(snap, ['templateId']))
    ?? coerceString(readRepairPatternPath(profile, ['templateId']));
  const sourceFilename = coerceString(input.sourceFilename)
    ?? coerceString(readRepairPatternPath(snap, ['sourceFilename']))
    ?? coerceString(readRepairPatternPath(profile, ['sourceFilename']));

  const hasProfile = profile !== undefined && profile !== null;
  const hasRepair = repair !== undefined && repair !== null;
  if (!hasProfile) warnings.push('missing_import_intelligence_profile');
  if (vq === undefined || vq === null) warnings.push('missing_visual_quality_summary');
  if (!hasRepair) warnings.push('missing_repair_summary');
  if (exportParity === undefined || exportParity === null) warnings.push('missing_export_parity_summary');

  if (!importId) blockers.push('import_id_missing');
  if (!hasProfile && !snap && !hasRepair) blockers.push('profile_and_repair_evidence_missing');

  // Import intelligence
  const profileCategory = coerceString(readRepairPatternPath(profile, ['profileCategory']));
  const importRiskLevel = coerceString(readRepairPatternPath(profile, ['riskLevel']));
  const importConfidence = coerceRepairPatternNumber(readRepairPatternPath(profile, ['confidence']));
  const tableRiskScore = clampRepairPatternScore(readRepairPatternPath(profile, ['scores', 'tableRiskScore']));
  const imageRiskScore = clampRepairPatternScore(readRepairPatternPath(profile, ['scores', 'imageRiskScore']));
  const designRiskScore = clampRepairPatternScore(readRepairPatternPath(profile, ['scores', 'designRiskScore']));
  const ocrRiskScore = clampRepairPatternScore(readRepairPatternPath(profile, ['scores', 'ocrRiskScore']));
  const automationRiskScore = clampRepairPatternScore(readRepairPatternPath(profile, ['scores', 'automationRiskScore']));
  const manualReviewLikelihood = clampRepairPatternScore(readRepairPatternPath(profile, ['scores', 'manualReviewLikelihood']));

  // Page
  const pageCount = pick(coerceRepairPatternNumber, [
    readRepairPatternPath(snap, ['importPageCount']),
    readRepairPatternPath(profile, ['signals', 'pageCount']),
    (() => {
      const pages = readRepairPatternPath(input.templateSchema, ['pages']);
      return Array.isArray(pages) ? pages.length : undefined;
    })(),
  ]);
  const isMultiPage = pageCount !== null ? pageCount > 1 : null;

  // Visual QA
  const visualQaScore = pick(coerceRepairPatternNumber, [
    readRepairPatternPath(snap, ['visualQaScore']),
    readRepairPatternPath(vq, ['overallScore']),
    readRepairPatternPath(profile, ['signals', 'visualQaScore']),
  ]);
  const visualQaManualReviewRequired = pick(coerceRepairPatternBoolean, [
    readRepairPatternPath(snap, ['visualQaManualReviewRequired']),
    readRepairPatternPath(vq, ['manualReviewRequired']),
    readRepairPatternPath(profile, ['signals', 'visualQaManualReviewRequired']),
  ]);
  if (visualQaScore !== null && visualQaScore < 0.85) {
    pushEvidence(evidence, 'low_visual_qa_score', 'Low Visual QA score', visualQaScore, 0.5, `Visual QA score is ${visualQaScore}.`);
  }
  if (visualQaManualReviewRequired === true) {
    pushEvidence(evidence, 'visual_manual_review_required', 'Visual QA manual review', true, 0.7, 'Visual QA requires manual review.');
  }

  // Repair
  const repairStatus = pick(coerceString, [
    readRepairPatternPath(snap, ['repairStatus']),
    readRepairPatternPath(repair, ['repairStatus']),
  ]);
  const repairFinalScore = pick(coerceRepairPatternNumber, [
    readRepairPatternPath(snap, ['repairFinalScore']),
    readRepairPatternPath(repair, ['finalScore']),
  ]);
  const repairRequiresFallback = pick(coerceRepairPatternBoolean, [
    readRepairPatternPath(snap, ['repairRequiresFallback']),
    readRepairPatternPath(repair, ['requiresFallback']),
  ]);
  const repairRequiresManualReview = pick(coerceRepairPatternBoolean, [
    readRepairPatternPath(snap, ['repairRequiresManualReview']),
    readRepairPatternPath(repair, ['requiresManualReview']),
  ]);
  if (repairRequiresFallback === true) {
    pushEvidence(evidence, 'repair_requires_fallback', 'Repair fallback required', true, 0.6, 'Repair requires a fallback path.');
  }
  if ((repairStatus ?? '').toLowerCase() === 'failed') {
    pushEvidence(evidence, 'repair_failed', 'Repair failed', repairStatus, 0.7, 'Repair failed.');
  }

  // Export parity
  const exportParityStatus = pick(coerceString, [
    readRepairPatternPath(snap, ['exportParityStatus']),
    readRepairPatternPath(exportParity, ['status']),
  ]);
  const exportVsSourceScore = pick(coerceRepairPatternNumber, [
    readRepairPatternPath(snap, ['exportVsSourceScore']),
    readRepairPatternPath(exportParity, ['exportVsSourceScore']),
  ]);
  const editorVsSourceScore = pick(coerceRepairPatternNumber, [
    readRepairPatternPath(snap, ['editorVsSourceScore']),
    readRepairPatternPath(exportParity, ['editorVsSourceScore']),
  ]);
  const exportVsEditorScore = pick(coerceRepairPatternNumber, [
    readRepairPatternPath(snap, ['exportVsEditorScore']),
    readRepairPatternPath(exportParity, ['exportVsEditorScore']),
  ]);
  if ((exportParityStatus ?? '').toLowerCase() === 'failed') {
    pushEvidence(evidence, 'export_parity_failed', 'Export parity failed', exportParityStatus, 0.6, 'Export parity failed.');
  }
  if (exportVsSourceScore !== null && exportVsSourceScore < 0.85) {
    pushEvidence(evidence, 'export_parity_below_threshold', 'Export parity below threshold', exportVsSourceScore, 0.4, `Export vs source score is ${exportVsSourceScore}.`);
  }

  // AI reconciliation
  const aiReconciliationStatus = pick(coerceString, [
    readRepairPatternPath(snap, ['aiReconciliationStatus']),
    readRepairPatternPath(readRepairPatternPath(input, ['aiReconciliationSummary']), ['status']),
  ]);
  const aiReconciliationRecommendation = pick(coerceString, [
    readRepairPatternPath(snap, ['aiReconciliationRecommendation']),
  ]);

  // Risk-score evidence
  if (tableRiskScore !== null && tableRiskScore >= 0.65) pushEvidence(evidence, 'high_table_risk', 'High table risk', tableRiskScore, 0.5, 'Table risk is high.');
  if (imageRiskScore !== null && imageRiskScore >= 0.65) pushEvidence(evidence, 'high_image_risk', 'High image risk', imageRiskScore, 0.5, 'Image risk is high.');
  if (designRiskScore !== null && designRiskScore >= 0.65) pushEvidence(evidence, 'high_design_risk', 'High design risk', designRiskScore, 0.5, 'Design risk is high.');
  if (ocrRiskScore !== null && ocrRiskScore >= 0.65) pushEvidence(evidence, 'high_ocr_risk', 'High OCR risk', ocrRiskScore, 0.6, 'OCR risk is high.');

  // Golden regression
  const goldenQualityGateStatus = pick(coerceString, [
    readRepairPatternPath(golden, ['qualityGateStatus']),
  ]);
  const goldenFailures = readRepairPatternPath(golden, ['failures']);
  const goldenWarnings = readRepairPatternPath(golden, ['warnings']);
  const goldenFailureCount = Array.isArray(goldenFailures) ? goldenFailures.length : null;
  const goldenWarningCount = Array.isArray(goldenWarnings) ? goldenWarnings.length : null;
  const baselineOutcome = pick(coerceString, [
    readRepairPatternPath(golden, ['baselineComparison', 'outcome']),
    readRepairPatternPath(input, ['goldenRegressionSummary', 'baselineOutcome']),
  ]);
  if ((goldenQualityGateStatus ?? '').toLowerCase() === 'fail' || (goldenQualityGateStatus ?? '').toLowerCase() === 'blocked') {
    pushEvidence(evidence, 'quality_gate_failed', 'Quality gate failed', goldenQualityGateStatus, 0.6, `Golden quality gate is ${goldenQualityGateStatus}.`);
  }
  if ((baselineOutcome ?? '').toLowerCase() === 'degraded') {
    pushEvidence(evidence, 'baseline_degraded', 'Baseline degraded', baselineOutcome, 0.5, 'Baseline comparison degraded.');
  }

  // Quality gate + triage codes
  const failureCodes = [
    ...extractFailureCodesFromQualityGateReport(input.qualityGateReport),
    ...extractFailureCodesFromTriage(input.triageSummary),
  ].filter((c, i, arr) => arr.indexOf(c) === i);
  const warningCodes = extractWarningCodesFromQualityGateReport(input.qualityGateReport);

  // Schema-derived
  const layerComplexity = estimateSchemaLayerComplexity(input.templateSchema);
  if (layerComplexity !== null && layerComplexity >= 0.5) {
    pushEvidence(evidence, 'layer_complexity_high', 'Layer complexity high', layerComplexity, 0.4, 'Schema has many layered/positioned elements.');
  }
  const headerFooterRisk = estimateRepeatedHeaderFooterRisk(input.templateSchema, pageCount);
  if (headerFooterRisk !== null && headerFooterRisk >= 0.4) {
    pushEvidence(evidence, 'repeated_header_footer_risk', 'Repeated header/footer risk', headerFooterRisk, 0.4, 'Repeated header/footer regions detected across pages.');
  }

  if (evidence.length === 0) warnings.push('insufficient_pattern_evidence');

  const signals: RepairPatternSignals = {
    importId,
    templateId,
    sourceFilename,
    profileCategory,
    importRiskLevel,
    importConfidence,
    pageCount,
    isMultiPage,
    visualQaScore,
    visualQaManualReviewRequired,
    repairStatus,
    repairFinalScore,
    repairRequiresFallback,
    repairRequiresManualReview,
    exportParityStatus,
    exportVsSourceScore,
    editorVsSourceScore,
    exportVsEditorScore,
    aiReconciliationStatus,
    aiReconciliationRecommendation,
    tableRiskScore,
    imageRiskScore,
    designRiskScore,
    ocrRiskScore,
    automationRiskScore,
    manualReviewLikelihood,
    goldenQualityGateStatus,
    goldenWarningCount,
    goldenFailureCount,
    baselineOutcome,
    failureCodes,
    warningCodes,
  };

  return {
    signals,
    evidence,
    warnings: warnings.filter((w, i, a) => a.indexOf(w) === i),
    blockers: blockers.filter((b, i, a) => a.indexOf(b) === i),
  };
}
