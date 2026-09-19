/**
 * PDF Extraction V3 · E10 — deterministic recovery planning (pdf-recovery-plan-v1).
 *
 * When an execution attempt fails, recovery chooses ONE deterministic next action:
 *   * a RETRY reuses the SAME plan and SAME route — plan id/hash never change on a
 *     retry; retries are bounded by `maxSameRouteAttempts`;
 *   * a REROUTE is a genuinely different route (degrade down the ladder). It is
 *     signalled as `reroute` and the caller MUST build a NEW plan for it —
 *     recovery never mutates the existing plan;
 *   * a raster-only fallback is always available EXCEPT when there is no source
 *     raster, in which case recovery ABORTS to manual review — never a false
 *     fallback claim.
 *
 * Pure function of (class, attempts, error code, source-raster presence, budget)
 * — no wall-clock, no randomness. Byte-identical with the Python producer.
 */
import {
  PDF_RECOVERY_PLAN_VERSION,
  SERVICE_CLASS_FAST_CPU,
  SERVICE_CLASS_HEAVY_CPU_AU,
  SERVICE_CLASS_RASTER_ONLY,
  type ExecutionAttemptV1,
  type ServiceClass,
  stableHash,
} from './pdfServiceRoutingV1.pure.ts';

export const MAX_SAME_ROUTE_ATTEMPTS = 2;

export const RECOVERY_ACTIONS = ['retry_same_route', 'reroute', 'fallback_raster_only', 'abort_manual_review'] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'provider_timeout', 'provider_rate_limited', 'provider_quota_exceeded',
  'route_target_unavailable', 'execution_timeout', 'execution_transient',
]);

const REROUTE_LADDER: Record<ServiceClass, ServiceClass> = {
  fast_cpu: SERVICE_CLASS_RASTER_ONLY,
  heavy_cpu_au: SERVICE_CLASS_FAST_CPU,
  docai_au: SERVICE_CLASS_HEAVY_CPU_AU,
  vlm_gpu_sg: SERVICE_CLASS_HEAVY_CPU_AU,
  raster_only: SERVICE_CLASS_RASTER_ONLY,
};

export interface RecoveryPlanV1 {
  version: typeof PDF_RECOVERY_PLAN_VERSION;
  action: RecoveryAction;
  from_class: ServiceClass;
  next_class: ServiceClass | null;
  same_route_attempts: number;
  max_same_route_attempts: number;
  has_source_raster: boolean;
  reason_codes: string[];
  recovery_id: string;
}

/** Decide the single next recovery action deterministically. */
export function planRecovery(
  currentClass: ServiceClass,
  attempts: ExecutionAttemptV1[],
  lastErrorCode: string | null,
  hasSourceRaster: boolean,
  maxSameRouteAttempts: number = MAX_SAME_ROUTE_ATTEMPTS,
): RecoveryPlanV1 {
  const reasons: string[] = [];
  const sameRoute = attempts.filter((a) => a.route_class === currentClass).length;
  const transient = lastErrorCode != null && TRANSIENT_ERROR_CODES.has(lastErrorCode);

  let action: RecoveryAction;
  let nextClass: ServiceClass;

  if (transient && sameRoute < maxSameRouteAttempts) {
    action = 'retry_same_route';
    nextClass = currentClass;
    reasons.push('recovery_retry_same_route');
  } else {
    nextClass = REROUTE_LADDER[currentClass] ?? SERVICE_CLASS_RASTER_ONLY;
    if (nextClass === currentClass && currentClass === SERVICE_CLASS_RASTER_ONLY) {
      if (hasSourceRaster) {
        action = 'fallback_raster_only';
        reasons.push('recovery_fallback_raster_only');
      } else {
        action = 'abort_manual_review';
        reasons.push('recovery_abort_no_source_raster');
        reasons.push('recovery_exhausted_manual_review');
      }
    } else if (nextClass === SERVICE_CLASS_RASTER_ONLY) {
      if (hasSourceRaster) {
        action = 'fallback_raster_only';
        reasons.push('recovery_reroute_new_plan');
        reasons.push('recovery_fallback_raster_only');
      } else {
        action = 'abort_manual_review';
        reasons.push('recovery_abort_no_source_raster');
      }
    } else {
      action = 'reroute';
      reasons.push('recovery_reroute_new_plan');
    }
  }

  const nextClassField = action === 'reroute' || action === 'fallback_raster_only' || action === 'retry_same_route' ? nextClass : null;
  const base = {
    version: PDF_RECOVERY_PLAN_VERSION,
    action,
    from_class: currentClass,
    next_class: nextClassField,
    same_route_attempts: sameRoute,
    max_same_route_attempts: maxSameRouteAttempts,
    has_source_raster: Boolean(hasSourceRaster),
    reason_codes: reasons,
  };
  return { ...base, recovery_id: stableHash('rcv', base) };
}
