/**
 * E8 — bounded, deterministic, tiered candidate generation (pure).
 *
 * Transforms explicit source-evidence-backed repair inputs (assembled by the
 * cascade from E7 defects + E3/E4/E5/E6 evidence — never invented here) into a
 * bounded, deduplicated set of candidates. Never combinatorial: single-op
 * candidates first, then narrowly-grouped same-region candidates, then verified
 * switches, then mixed fallback, then page raster. Tier 0 baseline is always
 * present but can never be "repaired" while it retains a target hard defect.
 */
import {
  DETERMINISTIC_REPAIR_OPERATION_V2_VERSION, REPAIR_CANDIDATE_VERSION,
  operationId, candidateId, planId,
  type DeterministicRepairOperationV2, type RepairOperationKind, type RepairCandidateV1,
  type RepairDefectReferenceV1, type RepairSourceEvidenceReferenceV1, type CandidateClass,
  type DeterministicRepairPlanV2, DETERMINISTIC_REPAIR_PLAN_V2_VERSION,
} from './contracts';

export const CANDIDATE_BUDGET = { maxCandidatesPerPass: 8, absoluteMaxCandidates: 16, maxOperationsPerCandidate: 6, maxRenderMs: 8000 } as const;

// ── Repair inputs (source-evidence-backed; assembled upstream) ───────────────

export interface OverlayBBoxFix { overlayId: string; sourceBBox: { x: number; y: number; width: number; height: number }; expectedTargetHash?: string | null; evidence: RepairSourceEvidenceReferenceV1 }
export interface TextFix { overlayId: string; expectedTargetHash?: string | null; lineHeight?: number; letterSpacing?: number; wordSpacing?: number; fontSize?: { before: number; after: number }; whiteSpace?: string; evidence: RepairSourceEvidenceReferenceV1 }
export interface ZOrderFix { overlayId: string; zIndex: number; evidence: RepairSourceEvidenceReferenceV1 }
export interface ImageFitFix { overlayId: string; fit: string; evidence: RepairSourceEvidenceReferenceV1 }
export interface SuppressionFix { overlayId: string; evidence: RepairSourceEvidenceReferenceV1 }
export interface TableSwitch { overlayId: string; candidateId: string; evidence: RepairSourceEvidenceReferenceV1 }
export interface TypographySwitch { overlayId: string; resolutionId: string; evidence: RepairSourceEvidenceReferenceV1 }
export interface RegionCropFallback { regionId: string; crop: { regionId: string; bbox: { x: number; y: number; width: number; height: number }; artifactPath: string; assetId: string | null; sha256: string | null; cropRole: 'final-output' }; renderPlanHash: string; evidence: RepairSourceEvidenceReferenceV1 }
export interface PageRasterFallback { policy?: Record<string, unknown>; evidence: RepairSourceEvidenceReferenceV1 }

export interface RepairInputs {
  overlayBBoxFixes?: OverlayBBoxFix[];
  textFixes?: TextFix[];
  zOrderFixes?: ZOrderFix[];
  imageFitFixes?: ImageFitFix[];
  suppressions?: SuppressionFix[];
  tableSwitches?: TableSwitch[];
  typographySwitches?: TypographySwitch[];
  regionCropFallbacks?: RegionCropFallback[];
  pageRasterFallback?: PageRasterFallback | null;
}

export interface CandidateGenerationInput {
  importId: string; templateId: string | null;
  pageId: string; pageNumber: number; passIndex: 0 | 1;
  baseTemplateHash: string; baseRenderPlanHash: string | null; baseQualityReportHash: string;
  targetDefects: RepairDefectReferenceV1[];
  repairInputs: RepairInputs;
  /** pass 2 unlocks mixed/page fallback; pass 1 is native + verified switches. */
  allowFallback: boolean;
}

export interface GeneratedCandidate { candidate: RepairCandidateV1; operations: DeterministicRepairOperationV2[]; plan: DeterministicRepairPlanV2 }

function mkOp(kind: RepairOperationKind, pageId: string, targetId: string, before: unknown, after: unknown, evidence: RepairSourceEvidenceReferenceV1[], rationaleCode: string, bounds: Record<string, number> | null = null, expectedTargetHash: string | null = null): DeterministicRepairOperationV2 {
  const core = { kind, pageId, targetId, expectedTargetHash, sourceEvidence: evidence, before, after, bounds, rationaleCode };
  return { version: DETERMINISTIC_REPAIR_OPERATION_V2_VERSION, id: operationId(core), problems: [], ...core };
}

function mkCandidate(input: CandidateGenerationInput, cls: CandidateClass, ops: DeterministicRepairOperationV2[], outputPolicy: string, cost: number, editability: number | null): GeneratedCandidate {
  const plan: DeterministicRepairPlanV2 = {
    version: DETERMINISTIC_REPAIR_PLAN_V2_VERSION,
    id: planId({ baseTemplateHash: input.baseTemplateHash, baseQualityReportHash: input.baseQualityReportHash, pageId: input.pageId, passIndex: input.passIndex, targetDefects: input.targetDefects, operations: ops }),
    importId: input.importId, templateId: input.templateId,
    baseTemplateHash: input.baseTemplateHash, baseRenderPlanHash: input.baseRenderPlanHash, baseQualityReportHash: input.baseQualityReportHash,
    pageId: input.pageId, pageNumber: input.pageNumber, passIndex: input.passIndex,
    targetDefects: input.targetDefects, repairClass: repairClassFor(cls),
    operations: ops, expectedResolvedDefectCodes: [...new Set(input.targetDefects.map((d) => String(d.code)))],
    forbiddenNewDefectCodes: [...new Set(input.targetDefects.filter((d) => d.hardVeto).map((d) => String(d.code)))],
    sourceEvidenceRefs: ops.flatMap((o) => o.sourceEvidence),
    preconditions: [], candidateBudget: { maxCandidates: CANDIDATE_BUDGET.maxCandidatesPerPass, maxRenderMs: CANDIDATE_BUDGET.maxRenderMs, maxOperationCount: CANDIDATE_BUDGET.maxOperationsPerCandidate },
    complete: true, problems: [],
  };
  const id = candidateId({ planId: plan.id, operationIds: ops.map((o) => o.id), candidateClass: cls, outputPolicy });
  const candidate: RepairCandidateV1 = {
    version: REPAIR_CANDIDATE_VERSION, id, planId: plan.id,
    pageId: input.pageId, pageNumber: input.pageNumber, passIndex: input.passIndex,
    candidateClass: cls, operationIds: ops.map((o) => o.id),
    templateHash: '', renderPlanHash: null, sourceEvidenceHash: hashEvidence(ops),
    estimatedEditability: editability, deterministicCost: cost, status: 'proposed', problems: [],
  };
  return { candidate, operations: ops, plan };
}

function repairClassFor(cls: CandidateClass): DeterministicRepairPlanV2['repairClass'] {
  switch (cls) {
    case 'native-repair': return 'combined-safe';
    case 'alternative-table': return 'table-candidate';
    case 'alternative-typography': return 'typography-candidate';
    case 'mixed-region': return 'region-policy';
    case 'page-raster': return 'page-policy';
    default: return 'combined-safe';
  }
}
function hashEvidence(ops: DeterministicRepairOperationV2[]): string {
  const key = ops.flatMap((o) => o.sourceEvidence.map((e) => `${e.kind}:${e.ref}:${e.hash ?? ''}`)).sort().join('|');
  return `sev-${key.length}-${key ? key.slice(0, 24) : 'none'}`;
}

/** Generate the bounded, deduplicated candidate set for one page/pass. */
export function generateCandidates(input: CandidateGenerationInput): GeneratedCandidate[] {
  const ri = input.repairInputs;
  const out: GeneratedCandidate[] = [];
  const pid = input.pageId;

  // Tier 1 — low-risk native single-op candidates.
  for (const f of ri.overlayBBoxFixes ?? []) {
    out.push(mkCandidate(input, 'native-repair', [mkOp('set-overlay-bounds', pid, f.overlayId, null, f.sourceBBox, [f.evidence], 'restore_source_bbox', null, f.expectedTargetHash ?? null)], 'native', 2, 1));
  }
  for (const f of ri.textFixes ?? []) {
    const ops: DeterministicRepairOperationV2[] = [];
    if (f.lineHeight != null) ops.push(mkOp('set-text-line-height', pid, f.overlayId, null, { value: f.lineHeight }, [f.evidence], 'restore_source_line_height', null, f.expectedTargetHash ?? null));
    if (f.letterSpacing != null) ops.push(mkOp('set-text-letter-spacing', pid, f.overlayId, null, { value: f.letterSpacing }, [f.evidence], 'restore_source_tracking'));
    if (f.whiteSpace != null) ops.push(mkOp('set-text-white-space', pid, f.overlayId, null, { value: f.whiteSpace }, [f.evidence], 'restore_white_space'));
    if (f.fontSize != null) ops.push(mkOp('set-text-font-size', pid, f.overlayId, { value: f.fontSize.before }, { value: f.fontSize.after }, [f.evidence], 'bounded_font_fit', { min: 6 }));
    if (ops.length) out.push(mkCandidate(input, 'native-repair', ops.slice(0, 6), 'native', 2, 1));
  }
  for (const f of ri.zOrderFixes ?? []) out.push(mkCandidate(input, 'native-repair', [mkOp('set-overlay-z-index', pid, f.overlayId, null, { value: f.zIndex }, [f.evidence], 'source_paint_order')], 'native', 2, 1));
  for (const f of ri.imageFitFixes ?? []) out.push(mkCandidate(input, 'native-repair', [mkOp('set-image-fit', pid, f.overlayId, null, { value: f.fit }, [f.evidence], 'source_crop_fit')], 'native', 2, 1));
  // suppression is a single grouped composition candidate (reapply E6 plan).
  if ((ri.suppressions ?? []).length) {
    const ops = (ri.suppressions ?? []).slice(0, 6).map((s) => mkOp('suppress-overlay', pid, s.overlayId, null, {}, [s.evidence], 'reapply_e6_suppression'));
    out.push(mkCandidate(input, 'native-repair', ops, 'native', 1, 1));
  }

  // Tier 2 — verified candidate switches.
  for (const s of ri.tableSwitches ?? []) out.push(mkCandidate(input, 'alternative-table', [mkOp('select-table-candidate', pid, s.overlayId, null, { candidateId: s.candidateId }, [s.evidence], 'verified_e4_candidate')], 'native', 3, 0.8));
  for (const s of ri.typographySwitches ?? []) out.push(mkCandidate(input, 'alternative-typography', [mkOp('select-typography-resolution', pid, s.overlayId, null, { resolutionId: s.resolutionId }, [s.evidence], 'verified_e5_resolution')], 'native', 3, 0.8));

  // Tier 3 — mixed region fallback (only when fallback allowed).
  if (input.allowFallback && (ri.regionCropFallbacks ?? []).length) {
    const ops = (ri.regionCropFallbacks ?? []).slice(0, 6).map((c) => mkOp('set-region-output-strategy', pid, c.regionId, null, { strategy: 'source-crop', crop: c.crop, renderPlanHash: c.renderPlanHash }, [c.evidence], 'exact_source_crop'));
    out.push(mkCandidate(input, 'mixed-region', ops, 'mixed', 4, 0.3));
  }

  // Tier 4 — page raster (only when fallback allowed).
  if (input.allowFallback && ri.pageRasterFallback) {
    out.push(mkCandidate(input, 'page-raster', [mkOp('set-page-output-strategy', pid, pid, null, { strategy: 'raster-only', policy: ri.pageRasterFallback.policy ?? {} }, [ri.pageRasterFallback.evidence], 'page_raster_fallback')], 'raster-only', 5, 0));
  }

  return dedupeAndBound(out);
}

function dedupeAndBound(cands: GeneratedCandidate[]): GeneratedCandidate[] {
  const seen = new Set<string>(); const out: GeneratedCandidate[] = [];
  // deterministic order: tier/cost then candidate id.
  const ordered = [...cands].sort((a, b) => a.candidate.deterministicCost - b.candidate.deterministicCost || a.candidate.id.localeCompare(b.candidate.id));
  for (const c of ordered) {
    if (seen.has(c.candidate.id)) continue;
    seen.add(c.candidate.id);
    out.push(c);
    if (out.length >= CANDIDATE_BUDGET.absoluteMaxCandidates) break;
  }
  return out;
}
