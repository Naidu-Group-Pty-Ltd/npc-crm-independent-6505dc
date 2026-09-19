/**
 * PDF Extraction V3 · E8 — Deterministic Repair & Verified Candidate Selection.
 *
 * A repair candidate is acceptable ONLY when: the targeted defects are resolved
 * AND no new hard defect is introduced AND critical coverage stays complete AND
 * E7 permits the final decision AND the actual output was re-rendered and
 * re-measured. Score improvement is useful, never sufficient. SOURCE FIDELITY
 * OUTRANKS EDITABILITY. E8 never invents content, never appends invisible text
 * or blank placeholders, never uses `locked`/opacity-zero/off-page as
 * suppression, and never bypasses the E7 hard-defect veto.
 *
 * All identities are deterministic (FNV over structural fields only — no
 * timestamps, no signed/Blob/object URLs, no DOM handles). Contracts are
 * JSON-safe; inputs are never mutated.
 */
import { fnv1a32 } from '../../../../pdfImport/sourceSceneGraphV2.pure';
import type { VisualPageQualityReportV2 } from '../../v2/contracts';
import type { CriticalQualityDefectCode, CriticalQualityDefectV1 } from '../../v2/criticalDefects';

export const DETERMINISTIC_REPAIR_PLAN_V2_VERSION = 'deterministic-repair-plan-v2';
export const DETERMINISTIC_REPAIR_OPERATION_V2_VERSION = 'deterministic-repair-operation-v2';
export const REPAIR_CANDIDATE_VERSION = 'repair-candidate-v1';
export const REPAIR_CANDIDATE_EVALUATION_VERSION = 'repair-candidate-evaluation-v1';
export const REPAIR_ATTEMPT_AUDIT_VERSION = 'repair-attempt-audit-v1';
export const REPAIR_CASCADE_V2_VERSION = 'repair-cascade-v2';
export const REPAIR_SELECTION_POLICY_VERSION = 'repair-selection-policy-v1';

// ── Defect reference + fingerprint ───────────────────────────────────────────

export interface RepairDefectReferenceV1 {
  code: CriticalQualityDefectCode | string;
  scope: string;
  pageId: string | null; pageNumber: number | null;
  regionId: string | null; overlayId: string | null; sourceRunId: string | null;
  fingerprint: string;
  hardVeto: boolean;
}

/** Deterministic fingerprint: code + scope + ids only (never raw reason/value). */
export function defectFingerprint(d: Pick<CriticalQualityDefectV1, 'code' | 'scope' | 'pageId' | 'regionId' | 'overlayId' | 'sourceRunId'>): string {
  const key = [d.code, d.scope, d.pageId ?? '', d.regionId ?? '', d.overlayId ?? '', d.sourceRunId ?? ''].join('~');
  return `qd-${fnv1a32(key)}`;
}

export function toDefectReference(d: CriticalQualityDefectV1): RepairDefectReferenceV1 {
  return {
    code: d.code, scope: d.scope, pageId: d.pageId, pageNumber: d.pageNumber,
    regionId: d.regionId, overlayId: d.overlayId, sourceRunId: d.sourceRunId,
    fingerprint: defectFingerprint(d), hardVeto: d.hardVeto,
  };
}

// ── Source-evidence reference + precondition ─────────────────────────────────

export type SourceEvidenceKind =
  | 'source-scene-graph' | 'source-bbox' | 'source-typography-run' | 'source-table-topology'
  | 'e4-candidate-integrity' | 'e5-font-resolution' | 'e6-region-policy' | 'e6-ownership'
  | 'source-crop' | 'source-page-raster' | 'e7-dom-geometry' | 'e7-defect';

export interface RepairSourceEvidenceReferenceV1 {
  kind: SourceEvidenceKind;
  ref: string;         // durable id/path/hash — never a signed URL
  hash: string | null;
}

export interface RepairPreconditionV1 { code: string; satisfied: boolean; detail: string }

// ── Operation V2 ─────────────────────────────────────────────────────────────

export type RepairOperationKind =
  // geometry
  | 'set-overlay-bounds' | 'set-page-size'
  // text fit
  | 'set-text-font-size' | 'set-text-line-height' | 'set-text-letter-spacing'
  | 'set-text-word-spacing' | 'set-text-padding' | 'set-text-white-space'
  // stacking
  | 'set-overlay-z-index'
  // image/crop
  | 'set-image-fit' | 'set-image-bounds'
  // table
  | 'set-table-column-widths' | 'set-table-row-heights' | 'select-table-candidate'
  // typography
  | 'select-typography-resolution'
  // composition
  | 'suppress-overlay' | 'restore-overlay-from-plan' | 'apply-region-render-plan' | 'set-region-output-strategy'
  // page policy
  | 'set-page-output-strategy';

export interface DeterministicRepairOperationV2 {
  version: typeof DETERMINISTIC_REPAIR_OPERATION_V2_VERSION;
  id: string;
  kind: RepairOperationKind;
  pageId: string;
  targetId: string;
  expectedTargetHash: string | null;
  sourceEvidence: RepairSourceEvidenceReferenceV1[];
  before: unknown;
  after: unknown;
  bounds: Record<string, number> | null;
  rationaleCode: string;
  problems: string[];
}

/** Deterministic operation id: kind + page + target + before/after + evidence. */
export function operationId(op: Omit<DeterministicRepairOperationV2, 'id' | 'version' | 'problems'>): string {
  const key = [
    op.kind, op.pageId, op.targetId, op.expectedTargetHash ?? '',
    stableJson(op.before), stableJson(op.after), stableJson(op.bounds ?? null),
    op.sourceEvidence.map((e) => `${e.kind}:${e.ref}:${e.hash ?? ''}`).sort().join('|'),
  ].join('~');
  return `rop-${fnv1a32(key)}`;
}

// ── Plan V2 ──────────────────────────────────────────────────────────────────

export type RepairClass =
  | 'geometry' | 'text-fit' | 'z-order' | 'asset-fit' | 'suppression'
  | 'table-candidate' | 'typography-candidate' | 'region-policy' | 'page-policy' | 'combined-safe';

export interface DeterministicRepairPlanV2 {
  version: typeof DETERMINISTIC_REPAIR_PLAN_V2_VERSION;
  id: string;
  importId: string; templateId: string | null;
  baseTemplateHash: string; baseRenderPlanHash: string | null; baseQualityReportHash: string;
  pageId: string; pageNumber: number; passIndex: 0 | 1;
  targetDefects: RepairDefectReferenceV1[];
  repairClass: RepairClass;
  operations: DeterministicRepairOperationV2[];
  expectedResolvedDefectCodes: string[];
  forbiddenNewDefectCodes: string[];
  sourceEvidenceRefs: RepairSourceEvidenceReferenceV1[];
  preconditions: RepairPreconditionV1[];
  candidateBudget: { maxCandidates: number; maxRenderMs: number; maxOperationCount: number };
  complete: boolean; problems: string[];
}

export function planId(input: {
  baseTemplateHash: string; baseQualityReportHash: string; pageId: string; passIndex: 0 | 1;
  targetDefects: RepairDefectReferenceV1[]; operations: DeterministicRepairOperationV2[];
}): string {
  const key = [
    DETERMINISTIC_REPAIR_PLAN_V2_VERSION, input.baseTemplateHash, input.baseQualityReportHash,
    input.pageId, String(input.passIndex),
    [...input.targetDefects.map((d) => d.fingerprint)].sort().join(','),
    [...input.operations.map((o) => o.id)].sort().join(','),
  ].join('~');
  return `rplan-${fnv1a32(key)}`;
}

// ── Candidate V1 ─────────────────────────────────────────────────────────────

export type CandidateClass = 'native-repair' | 'alternative-table' | 'alternative-typography' | 'mixed-region' | 'page-raster';

export type CandidateStatus =
  | 'proposed' | 'invalid' | 'rendered' | 'evaluated' | 'rejected' | 'selected' | 'applied' | 'rolled-back';

export interface RepairCandidateV1 {
  version: typeof REPAIR_CANDIDATE_VERSION;
  id: string; planId: string;
  pageId: string; pageNumber: number; passIndex: 0 | 1;
  candidateClass: CandidateClass;
  operationIds: string[];
  templateHash: string; renderPlanHash: string | null;
  sourceEvidenceHash: string;
  estimatedEditability: number | null;
  deterministicCost: number;
  status: CandidateStatus;
  problems: string[];
}

export function candidateId(input: { planId: string; operationIds: string[]; candidateClass: CandidateClass; outputPolicy: string }): string {
  const key = [input.planId, [...input.operationIds].join(','), input.candidateClass, input.outputPolicy].join('~');
  return `rcand-${fnv1a32(key)}`;
}

// ── Candidate evaluation V1 ──────────────────────────────────────────────────

export interface RepairCandidateEvaluationV1 {
  version: typeof REPAIR_CANDIDATE_EVALUATION_VERSION;
  candidateId: string;
  beforeReport: VisualPageQualityReportV2;
  afterReport: VisualPageQualityReportV2 | null;
  beforeDefectFingerprints: string[];
  afterDefectFingerprints: string[];
  resolvedDefectFingerprints: string[];
  retainedDefectFingerprints: string[];
  introducedDefectFingerprints: string[];
  targetDefectsResolved: boolean;
  newHardDefectIntroduced: boolean;
  criticalCoverageComplete: boolean;
  beforeScore: number | null; afterScore: number | null; scoreDelta: number | null;
  beforeOutputStrategy: string; afterOutputStrategy: string | null;
  renderPlanHashMatched: boolean;
  exportParityPassed: boolean | null;
  permittedByE7: boolean;
  selectionTier: number | null;
  accepted: boolean;
  rejectionCodes: string[];
  problems: string[];
}

// ── Attempt audit V1 ─────────────────────────────────────────────────────────

export interface RepairAttemptAuditV1 {
  version: typeof REPAIR_ATTEMPT_AUDIT_VERSION;
  planId: string; candidateId: string; passIndex: 0 | 1;
  operationIds: string[]; targetDefectFingerprints: string[]; sourceEvidenceHashes: string[];
  baselineTemplateHash: string; candidateTemplateHash: string;
  baselineRenderPlanHash: string | null; candidateRenderPlanHash: string | null;
  beforeScore: number | null; afterScore: number | null;
  beforeStrategy: string; afterStrategy: string | null;
  resolvedDefectFingerprints: string[]; retainedDefectFingerprints: string[]; introducedDefectFingerprints: string[];
  coverage: string; e7Decision: string;
  status: 'selected' | 'rejected' | 'rolled-back';
  rejectionCodes: string[]; elapsedMs: number | null; deterministicCost: number;
}

// ── Cascade result V2 ────────────────────────────────────────────────────────

export type RepairFinalStatus = 'accepted-native' | 'accepted-mixed' | 'accepted-raster' | 'unchanged' | 'blocked';

export interface RepairPageResultV2 {
  pageId: string; pageNumber: number;
  passesAttempted: number;
  candidatesProposed: number; candidatesEvaluated: number; candidatesRejected: number;
  selectedCandidateId: string | null;
  finalStatus: RepairFinalStatus;
  finalStrategy: string;
  targetDefectFingerprints: string[]; resolvedDefectFingerprints: string[]; remainingDefectFingerprints: string[];
  initialScore: number | null; finalScore: number | null;
  audits: RepairAttemptAuditV1[];
  problems: string[];
}

export interface RepairCascadeResultV2 {
  version: typeof REPAIR_CASCADE_V2_VERSION;
  importId: string; templateId: string | null;
  templateChanged: boolean;
  pages: RepairPageResultV2[];
  finalizationAllowed: boolean; exportAllowed: boolean; manualReviewRequired: boolean;
  problems: string[];
}

// ── Shared deterministic helpers ─────────────────────────────────────────────

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortValue((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

const SIGNED_URL_RE = /^(https?|blob|data):/i;
/** Deterministic template hash over a JSON-safe projection (URLs stripped). */
export function hashTemplateProjection(projection: unknown): string {
  return `tpl-${fnv1a32(stripUrls(stableJson(projection)))}`;
}
function stripUrls(s: string): string { return s.replace(/(https?|blob|data):\/\/[^"'\s]+/gi, 'URL'); }
export { SIGNED_URL_RE };
export type { VisualPageQualityReportV2, CriticalQualityDefectV1, CriticalQualityDefectCode };
