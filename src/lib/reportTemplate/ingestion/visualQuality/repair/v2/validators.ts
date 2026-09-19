/**
 * E8 — runtime validators for the persisted repair contracts (pure).
 *
 * Reject wrong versions, non-finite numbers, signed/Blob/object URLs, raw image
 * buffers, arbitrary/forbidden operation kinds, and any persisted shape carrying
 * source text or financial values. Deterministic; never mutates input.
 */
import {
  DETERMINISTIC_REPAIR_OPERATION_V2_VERSION, DETERMINISTIC_REPAIR_PLAN_V2_VERSION,
  REPAIR_CANDIDATE_VERSION, REPAIR_ATTEMPT_AUDIT_VERSION,
  type DeterministicRepairOperationV2, type DeterministicRepairPlanV2, type RepairCandidateV1, type RepairAttemptAuditV1,
} from './contracts';
import { isForbiddenOperationKind } from './operationPolicy';

const SIGNED_URL_RE = /^(https?|blob|data):/i;

export function validateOperation(op: unknown): string[] {
  const problems: string[] = [];
  if (!op || typeof op !== 'object') return ['operation_invalid'];
  const o = op as DeterministicRepairOperationV2;
  if (o.version !== DETERMINISTIC_REPAIR_OPERATION_V2_VERSION) problems.push('operation_version_invalid');
  if (isForbiddenOperationKind(o.kind)) problems.push('forbidden_operation_kind');
  problems.push(...scanForbidden(o.before), ...scanForbidden(o.after), ...scanForbidden(o.bounds));
  for (const [, v] of Object.entries(o.bounds ?? {})) if (typeof v === 'number' && !Number.isFinite(v)) problems.push('non_finite_bound');
  return dedupe(problems);
}

export function validatePlan(plan: unknown): string[] {
  const problems: string[] = [];
  if (!plan || typeof plan !== 'object') return ['plan_invalid'];
  const p = plan as DeterministicRepairPlanV2;
  if (p.version !== DETERMINISTIC_REPAIR_PLAN_V2_VERSION) problems.push('plan_version_invalid');
  if (!Array.isArray(p.operations)) problems.push('plan_operations_invalid');
  else { if (p.operations.length > (p.candidateBudget?.maxOperationCount ?? 6)) problems.push('plan_operation_count_exceeds_budget'); for (const op of p.operations) problems.push(...validateOperation(op).map((x) => `op:${x}`)); }
  problems.push(...scanForbidden({ ...p, operations: undefined }));
  return dedupe(problems);
}

export function validateCandidate(candidate: unknown): string[] {
  const problems: string[] = [];
  if (!candidate || typeof candidate !== 'object') return ['candidate_invalid'];
  const c = candidate as RepairCandidateV1;
  if (c.version !== REPAIR_CANDIDATE_VERSION) problems.push('candidate_version_invalid');
  if (c.estimatedEditability != null && !inRange(c.estimatedEditability)) problems.push('editability_out_of_range');
  if (!Number.isFinite(c.deterministicCost)) problems.push('non_finite_cost');
  problems.push(...scanForbidden(c));
  return dedupe(problems);
}

export function validateAudit(audit: unknown): string[] {
  const problems: string[] = [];
  if (!audit || typeof audit !== 'object') return ['audit_invalid'];
  const a = audit as RepairAttemptAuditV1;
  if (a.version !== REPAIR_ATTEMPT_AUDIT_VERSION) problems.push('audit_version_invalid');
  for (const s of [a.beforeScore, a.afterScore]) if (s != null && !inRange(s)) problems.push('audit_score_out_of_range');
  problems.push(...scanForbidden(a));
  return dedupe(problems);
}

function scanForbidden(value: unknown, depth = 0): string[] {
  if (depth > 6 || value == null) return [];
  if (typeof value === 'string') return SIGNED_URL_RE.test(value) ? ['signed_url_persisted'] : [];
  if (value instanceof Uint8Array || value instanceof Uint8ClampedArray || (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)) return ['raw_image_buffer_persisted'];
  if (Array.isArray(value)) return value.flatMap((v) => scanForbidden(v, depth + 1));
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if ('data' in o && 'width' in o && 'height' in o && (o.data instanceof Uint8ClampedArray || Array.isArray(o.data))) return ['raw_image_buffer_persisted'];
    return Object.entries(o).flatMap(([k, v]) => (k === 'ref' || k === 'artifactPath' ? [] : scanForbidden(v, depth + 1)));
  }
  return [];
}
function inRange(n: number): boolean { return Number.isFinite(n) && n >= 0 && n <= 1; }
function dedupe(a: string[]): string[] { return [...new Set(a)]; }
