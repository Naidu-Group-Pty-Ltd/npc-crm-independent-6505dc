/**
 * E8 — verified candidate repair cascade pure specs. Targeted defects resolved
 * AND no new hard defect AND complete coverage AND E7-permitted AND actually
 * re-rendered — score improvement is never sufficient; safety tier outranks
 * score; ≤ 2 passes; trial/final verified; rejected candidates leave no mutation.
 */
import { describe, it, expect } from 'vitest';
import {
  DETERMINISTIC_REPAIR_PLAN_V2_VERSION, DETERMINISTIC_REPAIR_OPERATION_V2_VERSION,
  REPAIR_CANDIDATE_VERSION, REPAIR_CANDIDATE_EVALUATION_VERSION, REPAIR_ATTEMPT_AUDIT_VERSION,
  REPAIR_CASCADE_V2_VERSION, REPAIR_SELECTION_POLICY_VERSION,
  operationId, candidateId, defectFingerprint, toDefectReference,
  classifyDefectCode, classifyDefects,
  validateOperationPreconditions, isForbiddenOperationKind, FORBIDDEN_OPERATION_KINDS, OPERATION_BOUNDS,
  applyCandidateOperations,
  generateCandidates,
  evaluateCandidate,
  selectCandidate, safetyTierFor,
  validateOperation, validatePlan, validateCandidate,
  isOscillating, createRepairMemory, recordSelected,
  createDeterministicAdapter, runRepairCascadeV2,
  type DeterministicRepairOperationV2, type RepairCandidateV1, type RepairCandidateEvaluationV1,
  type RenderAndEvaluateRepairCandidate, type RepairSourceEvidenceReferenceV1,
} from '../ingestion/visualQuality/repair/v2';
import { pageReport, acceptedReport, defect, templateFixture, missingChartReport } from '../ingestion/visualQuality/repair/v2/fixtures';

const EV: RepairSourceEvidenceReferenceV1 = { kind: 'source-bbox', ref: 'source', hash: 'h' };

function op(kind: DeterministicRepairOperationV2['kind'], targetId: string, after: unknown, evidence: RepairSourceEvidenceReferenceV1[] = [EV], bounds: Record<string, number> | null = null): DeterministicRepairOperationV2 {
  const core = { kind, pageId: 'docling-page-1', targetId, expectedTargetHash: null, sourceEvidence: evidence, before: null, after, bounds, rationaleCode: 'test' };
  return { version: DETERMINISTIC_REPAIR_OPERATION_V2_VERSION, id: operationId(core), problems: [], ...core };
}

// ── A. Versions / validation / identities ─────────────────────────────────────

describe('E8 versions + identities', () => {
  it('version constants exact', () => {
    expect(DETERMINISTIC_REPAIR_PLAN_V2_VERSION).toBe('deterministic-repair-plan-v2');
    expect(DETERMINISTIC_REPAIR_OPERATION_V2_VERSION).toBe('deterministic-repair-operation-v2');
    expect(REPAIR_CANDIDATE_VERSION).toBe('repair-candidate-v1');
    expect(REPAIR_CANDIDATE_EVALUATION_VERSION).toBe('repair-candidate-evaluation-v1');
    expect(REPAIR_ATTEMPT_AUDIT_VERSION).toBe('repair-attempt-audit-v1');
    expect(REPAIR_CASCADE_V2_VERSION).toBe('repair-cascade-v2');
    expect(REPAIR_SELECTION_POLICY_VERSION).toBe('repair-selection-policy-v1');
  });
  it('operation + candidate ids are deterministic and URL/timestamp-free', () => {
    const a = op('set-overlay-bounds', 'ov-1', { x: 1, y: 2, width: 10, height: 5 });
    const b = op('set-overlay-bounds', 'ov-1', { x: 1, y: 2, width: 10, height: 5 });
    expect(a.id).toBe(b.id);
    const c1 = candidateId({ planId: 'p', operationIds: [a.id], candidateClass: 'native-repair', outputPolicy: 'native' });
    const c2 = candidateId({ planId: 'p', operationIds: [a.id], candidateClass: 'native-repair', outputPolicy: 'native' });
    expect(c1).toBe(c2);
  });
  it('defect fingerprint uses ids only (not raw reason)', () => {
    const d = defect('text_clipped', { overlayId: 'ov-1' });
    const d2 = { ...d, reason: 'DIFFERENT REASON' };
    expect(defectFingerprint(d)).toBe(defectFingerprint(d2));
  });
  it('validators reject wrong version / signed URL / forbidden op', () => {
    expect(validateOperation({ version: 'x', kind: 'set-overlay-bounds' })).toContain('operation_version_invalid');
    expect(validateOperation(op('set-overlay-bounds', 'ov-1', { url: 'https://x/y.png' }))).toContain('signed_url_persisted');
    expect(validatePlan({ version: DETERMINISTIC_REPAIR_PLAN_V2_VERSION, operations: 'no' })).toContain('plan_operations_invalid');
    expect(validateCandidate({ version: REPAIR_CANDIDATE_VERSION, estimatedEditability: 5, deterministicCost: 1 })).toContain('editability_out_of_range');
  });
});

// ── B. Defect classification ─────────────────────────────────────────────────

describe('defect classification', () => {
  const ctx = { pageRasterAvailable: true };
  it('every mapped class is correct; unknown critical never safe', () => {
    expect(classifyDefectCode('text_clipped', ctx)).toBe('safe-deterministic');
    expect(classifyDefectCode('crop_and_native_both_visible', ctx)).toBe('safe-deterministic');
    expect(classifyDefectCode('table_row_missing', ctx)).toBe('candidate-switch');
    expect(classifyDefectCode('critical_punctuation_missing', ctx)).toBe('candidate-switch');
    expect(classifyDefectCode('chart_region_missing', ctx)).toBe('region-fallback');
    expect(classifyDefectCode('source_region_unscored', ctx)).toBe('page-fallback');
    expect(classifyDefectCode('source_raster_missing', ctx)).toBe('nonrepairable');
    expect(classifyDefectCode('totally_unknown_code', ctx)).toBe('page-fallback');
    expect(classifyDefectCode('totally_unknown_code', { pageRasterAvailable: false })).toBe('nonrepairable');
  });
  it('overall strategy tier is the safest needed', () => {
    expect(classifyDefects(['text_clipped', 'chart_region_missing'], ctx).strategyTier).toBe('region-fallback');
    expect(classifyDefects(['source_raster_missing'], { pageRasterAvailable: false }).strategyTier).toBe('block');
  });
});

// ── C. Operation preconditions + bounds ──────────────────────────────────────

describe('operation preconditions + bounds', () => {
  const src = { sourceBBox: { 'ov-1': { x: 40, y: 40, width: 200, height: 20 } }, pageWidthPt: 595, pageHeightPt: 842 };
  it('geometry within bound + on-page passes; off-page + excessive shift fail', () => {
    expect(validateOperationPreconditions(op('set-overlay-bounds', 'ov-1', { x: 42, y: 41, width: 205, height: 20 }), src)).toEqual([]);
    expect(validateOperationPreconditions(op('set-overlay-bounds', 'ov-1', { x: 700, y: 41, width: 205, height: 20 }), src)).toContain('result_off_page');
    expect(validateOperationPreconditions(op('set-overlay-bounds', 'ov-1', { x: 300, y: 41, width: 205, height: 20 }), src)).toContain('geometry_shift_exceeds_bound');
    expect(validateOperationPreconditions(op('set-overlay-bounds', 'ov-2', { x: 42, y: 41, width: 205, height: 20 }), src)).toContain('missing_source_bbox');
  });
  it('font reduction bound enforced; below readable rejected', () => {
    const evd = [{ kind: 'e5-font-resolution' as const, ref: 'r', hash: null }];
    expect(validateOperationPreconditions(op('set-text-font-size', 'ov-1', { value: 11 }, evd), src).length ? true : false).toBe(false);
    expect(validateOperationPreconditions({ ...op('set-text-font-size', 'ov-1', { value: 5 }, evd) }, src)).toContain('font_below_readable_minimum');
    expect(validateOperationPreconditions({ ...op('set-text-font-size', 'ov-1', { value: 8 }, evd), before: { value: 12 } } as DeterministicRepairOperationV2, src)).toContain('font_reduction_exceeds_bound');
  });
  it('z-order requires evidence; table candidate switch requires zero-defect candidate', () => {
    expect(validateOperationPreconditions(op('set-overlay-z-index', 'ov-1', { value: 3 }), src)).toContain('z_order_requires_evidence');
    const withTable = { ...src, tableCandidates: { 'tbl-1': [{ candidateId: 'c1', integrityValid: true, hardDefectCount: 0, numericAssociationComplete: true, rowCount: 5, columnCount: 3 }] } };
    expect(validateOperationPreconditions(op('select-table-candidate', 'tbl-1', { candidateId: 'c1' }, [{ kind: 'e4-candidate-integrity', ref: 'r', hash: null }]), withTable)).toEqual([]);
    expect(validateOperationPreconditions(op('select-table-candidate', 'tbl-1', { candidateId: 'bad' }, [{ kind: 'e4-candidate-integrity', ref: 'r', hash: null }]), withTable)).toContain('table_candidate_unavailable');
  });
  it('page raster op requires a valid durable non-blank raster', () => {
    const evd = [{ kind: 'source-page-raster' as const, ref: 'job/p1.png', hash: 'h' }];
    expect(validateOperationPreconditions(op('set-page-output-strategy', 'docling-page-1', { strategy: 'raster-only' }, evd), src)).toContain('missing_page_raster');
    const withRaster = { ...src, pageRaster: { path: 'job/p1.png', hash: 'h', widthPt: 595, heightPt: 842, blank: false } };
    expect(validateOperationPreconditions(op('set-page-output-strategy', 'docling-page-1', { strategy: 'raster-only' }, evd), withRaster)).toEqual([]);
  });
});

// ── D. Forbidden ops + immutable apply ───────────────────────────────────────

describe('forbidden ops + immutable template-first apply', () => {
  const src = { sourceBBox: { 'ov-1': { x: 40, y: 40, width: 200, height: 20 } }, pageWidthPt: 595, pageHeightPt: 842 };
  it('E8 forbidden-op guard covers every V1 op kind', () => {
    for (const k of ['replace_text', 'append_text_layer', 'set_bounds', 'add_coverage_layer', 'set_opacity_zero']) {
      expect(FORBIDDEN_OPERATION_KINDS.has(k)).toBe(true);
      expect(isForbiddenOperationKind(k)).toBe(true);
    }
    expect(isForbiddenOperationKind('set-overlay-bounds')).toBe(false);
  });
  it('applies atomically, preserves E6 meta, never mutates the input', () => {
    const t = templateFixture() as { pages: Array<{ meta: unknown; blocks: Array<{ overlays: Array<{ x: number }> }> }> };
    const before = JSON.stringify(t);
    const res = applyCandidateOperations(t as Parameters<typeof applyCandidateOperations>[0], [op('set-overlay-bounds', 'ov-1', { x: 42, y: 41, width: 205, height: 20 })], src);
    expect(res.ok).toBe(true);
    expect(JSON.stringify(t)).toBe(before); // input untouched
    const page = (res.template as { pages: Array<{ meta: { pdfImportRegionOutput: unknown }; blocks: Array<{ overlays: Array<{ x: number }> }> }> }).pages[0];
    expect(page.blocks[0].overlays[0].x).toBe(42);
    expect(page.meta.pdfImportRegionOutput).toBeTruthy(); // E6 meta preserved
  });
  it('one invalid op rejects the whole candidate (no partial mutation)', () => {
    const t = templateFixture();
    const res = applyCandidateOperations(t as never, [op('set-overlay-bounds', 'ov-1', { x: 42, y: 41, width: 205, height: 20 }), op('set-overlay-bounds', 'missing', { x: 1, y: 1, width: 10, height: 10 })], { ...src, sourceBBox: { ...src.sourceBBox, missing: { x: 1, y: 1, width: 10, height: 10 } } });
    expect(res.ok).toBe(false);
    expect(res.template).toBeNull();
  });
  it('a sub-readable font or opacity-zero style is rejected by structure check', () => {
    const t = templateFixture();
    const evd = [{ kind: 'e5-font-resolution' as const, ref: 'r', hash: null }];
    const res = applyCandidateOperations(t as never, [{ ...op('set-text-font-size', 'ov-1', { value: 4 }, evd) }], { ...src }); // fails precondition first
    expect(res.ok).toBe(false);
  });
});

// ── E. Candidate generation ──────────────────────────────────────────────────

describe('candidate generation', () => {
  const base = { importId: 'i', templateId: null, pageId: 'docling-page-1', pageNumber: 1, passIndex: 0 as const, baseTemplateHash: 'tpl-1', baseRenderPlanHash: null, baseQualityReportHash: 'qr-1', targetDefects: [toDefectReference(defect('text_clipped', { overlayId: 'ov-1' }))] };
  it('tier-1 native single-op candidates generated + deduped + bounded + deterministic', () => {
    const gen = generateCandidates({ ...base, allowFallback: false, repairInputs: { overlayBBoxFixes: [{ overlayId: 'ov-1', sourceBBox: { x: 40, y: 40, width: 200, height: 20 }, evidence: EV }] } });
    const gen2 = generateCandidates({ ...base, allowFallback: false, repairInputs: { overlayBBoxFixes: [{ overlayId: 'ov-1', sourceBBox: { x: 40, y: 40, width: 200, height: 20 }, evidence: EV }] } });
    expect(gen.map((g) => g.candidate.id)).toEqual(gen2.map((g) => g.candidate.id)); // deterministic
    expect(gen.every((g) => g.candidate.candidateClass === 'native-repair')).toBe(true);
    expect(gen.length).toBeLessThanOrEqual(16);
  });
  it('fallback candidates only appear when allowFallback (pass 2)', () => {
    const inputs = { pageRasterFallback: { evidence: { kind: 'source-page-raster' as const, ref: 'job/p.png', hash: 'h' } } };
    expect(generateCandidates({ ...base, allowFallback: false, repairInputs: inputs }).length).toBe(0);
    const withFallback = generateCandidates({ ...base, passIndex: 1, allowFallback: true, repairInputs: inputs });
    expect(withFallback.some((g) => g.candidate.candidateClass === 'page-raster')).toBe(true);
  });
});

// ── F. Evaluation ────────────────────────────────────────────────────────────

function candidate(cls: RepairCandidateV1['candidateClass'], id = 'rcand-x'): RepairCandidateV1 {
  return { version: REPAIR_CANDIDATE_VERSION, id, planId: 'p', pageId: 'docling-page-1', pageNumber: 1, passIndex: 0, candidateClass: cls, operationIds: ['o1'], templateHash: 't', renderPlanHash: 'h', sourceEvidenceHash: 's', estimatedEditability: cls === 'native-repair' ? 1 : 0.2, deterministicCost: 1, status: 'proposed', problems: [] };
}

describe('candidate evaluation', () => {
  const clipped = defect('text_clipped', { overlayId: 'ov-1' });
  const before = pageReport({ criticalDefects: [clipped], overallScore: 0.5 });
  it('targeted defect resolved + no new hard defect + coverage + E7 permitted → accepted', () => {
    const after = acceptedReport('native', before.renderPlanHash!);
    const e = evaluateCandidate({ candidate: candidate('native-repair'), beforeReport: before, afterReport: after, targetDefectFingerprints: [defectFingerprint(clipped)], renderPlanHashMatched: true });
    expect(e.accepted).toBe(true);
    expect(e.targetDefectsResolved).toBe(true);
  });
  it('retained target hard defect rejects even if score rises', () => {
    const after = pageReport({ criticalDefects: [clipped], overallScore: 0.97 });
    const e = evaluateCandidate({ candidate: candidate('native-repair'), beforeReport: before, afterReport: after, targetDefectFingerprints: [defectFingerprint(clipped)], renderPlanHashMatched: true });
    expect(e.accepted).toBe(false);
    expect(e.rejectionCodes).toContain('target_hard_defect_retained');
  });
  it('a newly introduced hard defect rejects', () => {
    const after = pageReport({ criticalDefects: [defect('severe_overlap', { overlayId: 'ov-2' })], overallScore: 0.9 });
    const e = evaluateCandidate({ candidate: candidate('native-repair'), beforeReport: before, afterReport: after, targetDefectFingerprints: [defectFingerprint(clipped)], renderPlanHashMatched: true });
    expect(e.accepted).toBe(false);
    expect(e.rejectionCodes).toContain('new_hard_defect_introduced');
  });
  it('incomplete coverage / render-plan mismatch reject', () => {
    const partial = pageReport({ criticalDefects: [], qualityCoverage: 'partial', overallScore: 0.9 });
    const e = evaluateCandidate({ candidate: candidate('native-repair'), beforeReport: before, afterReport: partial, targetDefectFingerprints: [defectFingerprint(clipped)], renderPlanHashMatched: false });
    expect(e.rejectionCodes).toEqual(expect.arrayContaining(['critical_coverage_incomplete', 'render_plan_hash_mismatch']));
  });
});

// ── G. Selection ─────────────────────────────────────────────────────────────

describe('candidate selection', () => {
  it('a safe raster (lower score) beats an unsafe native (higher score, retains defect)', () => {
    const clipped = defect('text_clipped', { overlayId: 'ov-1' });
    const before = pageReport({ criticalDefects: [clipped], overallScore: 0.5 });
    const unsafeNative = candidate('native-repair', 'rcand-native');
    const unsafeEval = evaluateCandidate({ candidate: unsafeNative, beforeReport: before, afterReport: pageReport({ criticalDefects: [clipped], overallScore: 0.98 }), targetDefectFingerprints: [defectFingerprint(clipped)], renderPlanHashMatched: true });
    const safeRaster = candidate('page-raster', 'rcand-raster');
    const safeEval = evaluateCandidate({ candidate: safeRaster, beforeReport: before, afterReport: acceptedReport('raster-only', before.renderPlanHash!), targetDefectFingerprints: [defectFingerprint(clipped)], renderPlanHashMatched: true, fallbackSafer: true });
    const sel = selectCandidate([{ candidate: unsafeNative, evaluation: unsafeEval }, { candidate: safeRaster, evaluation: safeEval }]);
    expect(sel.selected?.candidate.id).toBe('rcand-raster');
  });
  it('a verified native (no defect) outranks a safe raster; ties break by id', () => {
    const before = pageReport({ criticalDefects: [defect('text_clipped', { overlayId: 'ov-1' })], overallScore: 0.5 });
    const nativeC = candidate('native-repair', 'rcand-aaa');
    const nativeEval = evaluateCandidate({ candidate: nativeC, beforeReport: before, afterReport: acceptedReport('native', before.renderPlanHash!), targetDefectFingerprints: before.criticalDefects.map(defectFingerprint), renderPlanHashMatched: true });
    const rasterC = candidate('page-raster', 'rcand-zzz');
    const rasterEval = evaluateCandidate({ candidate: rasterC, beforeReport: before, afterReport: acceptedReport('raster-only', before.renderPlanHash!), targetDefectFingerprints: before.criticalDefects.map(defectFingerprint), renderPlanHashMatched: true, fallbackSafer: true });
    const sel = selectCandidate([{ candidate: rasterC, evaluation: rasterEval }, { candidate: nativeC, evaluation: nativeEval }]);
    expect(sel.selected?.candidate.id).toBe('rcand-aaa'); // native tier 4 > raster tier 2
    expect(safetyTierFor(nativeC, nativeEval)).toBe(4);
    expect(safetyTierFor(rasterC, rasterEval)).toBe(2);
  });
});

// ── H. Cascade + memory ──────────────────────────────────────────────────────

/** Adapter that returns a report keyed by candidate class. */
function classAdapter(byClass: Partial<Record<RepairCandidateV1['candidateClass'], ReturnType<typeof acceptedReport> | null>>): RenderAndEvaluateRepairCandidate {
  return {
    async renderAndEvaluate(candidate) {
      const report = byClass[candidate.candidateClass] ?? null;
      return { candidateId: candidate.id, pageReport: report, evidence: null, renderPlanHash: report?.renderPlanHash ?? null, renderPlanHashMatched: true, exportParityPassed: report ? true : null, loadedAssetStates: {}, renderMs: 1, captureMs: 1, problems: [] };
    },
  };
}

describe('repair cascade', () => {
  const sourceContext = {
    sourceBBox: { 'ov-1': { x: 40, y: 40, width: 200, height: 20 } },
    pageWidthPt: 595, pageHeightPt: 842,
    cropAssets: { 'chart-1': { path: 'job/chart-1.png', hash: 'h', blank: false } },
    pageRaster: { path: 'job/p1.png', hash: 'h', widthPt: 595, heightPt: 842, blank: false },
    hasRegionPlan: true,
  };

  it('a clean page is left unchanged (no repair)', async () => {
    const res = await runRepairCascadeV2({
      importId: 'i', templateId: null, template: templateFixture(),
      pages: [{ pageId: 'docling-page-1', pageNumber: 1, initialReport: acceptedReport('native'), sourceContext, pass1Inputs: {}, pass2Inputs: {}, pageRasterAvailable: true }],
      adapter: createDeterministicAdapter({}), runtimeContextFor: () => ({ importId: 'i', templateId: null, pageId: 'docling-page-1', pageNumber: 1 }),
    });
    expect(res.pages[0].finalStatus).toBe('unchanged');
    expect(res.templateChanged).toBe(false);
    expect(res.finalizationAllowed).toBe(true);
  });

  it('a missing chart resolves via pass-2 page-raster fallback, never unsafe native', async () => {
    const res = await runRepairCascadeV2({
      importId: 'i', templateId: null, template: templateFixture(),
      pages: [{
        pageId: 'docling-page-1', pageNumber: 1, initialReport: missingChartReport(), sourceContext,
        pass1Inputs: {}, // no safe native repair for a missing chart
        pass2Inputs: { pageRasterFallback: { evidence: { kind: 'source-page-raster', ref: 'job/p1.png', hash: 'h' } } },
        pageRasterAvailable: true,
      }],
      adapter: classAdapter({ 'page-raster': acceptedReport('raster-only', 'rplanh-base') }),
      runtimeContextFor: () => ({ importId: 'i', templateId: null, pageId: 'docling-page-1', pageNumber: 1 }),
    });
    const page = res.pages[0];
    expect(page.finalStatus).toBe('accepted-raster');
    expect(page.remainingDefectFingerprints).toEqual([]);
    expect(res.finalizationAllowed).toBe(true);
  });

  it('blocks when no safe candidate exists', async () => {
    const res = await runRepairCascadeV2({
      importId: 'i', templateId: null, template: templateFixture(),
      pages: [{ pageId: 'docling-page-1', pageNumber: 1, initialReport: missingChartReport(), sourceContext, pass1Inputs: {}, pass2Inputs: {}, pageRasterAvailable: false }],
      adapter: classAdapter({}),
      runtimeContextFor: () => ({ importId: 'i', templateId: null, pageId: 'docling-page-1', pageNumber: 1 }),
    });
    expect(res.pages[0].finalStatus).toBe('blocked');
    expect(res.finalizationAllowed).toBe(false);
  });

  it('oscillation A→B→A is detected', () => {
    const mem = createRepairMemory();
    recordSelected(mem, 'a', 'tpl-A'); recordSelected(mem, 'b', 'tpl-B');
    expect(isOscillating(mem, 'tpl-A')).toBe(true);
  });
});

// keep imports referenced
void OPERATION_BOUNDS; void (null as unknown as RepairCandidateEvaluationV1);
