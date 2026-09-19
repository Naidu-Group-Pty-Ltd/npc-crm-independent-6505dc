/**
 * PDF Extraction V3 · E11 — review action contract builders + client-side guards.
 *
 * The client BUILDS an action request and performs optimistic guardrails, but the
 * SERVER is the sole authority: it derives the actor identity, re-checks
 * permission, validates expected-state hashes and applies the change. The client
 * never supplies an actor id, a provider id, a service URL, a processor id or a
 * model name. `force-native` can never erase a hard defect; `force-source-crop`
 * requires a crop; `force-page-raster` requires a source raster;
 * `request-provider-recovery` carries only a server-issued option id.
 */
import {
  PDF_REVIEW_ACTION_VERSION,
  type PdfReviewActionV1,
  type ReviewActionKind,
} from './contracts';

/** High-risk actions that require explicit operator permission + confirmation. */
export const HIGH_RISK_ACTIONS: ReadonlySet<ReviewActionKind> = new Set([
  'force-native', 'force-source-crop', 'force-page-raster',
  'request-provider-recovery', 'request-same-target-retry', 'request-recovery-plan',
]);

/** Actions that only affect the review workspace (never final output / export). */
export const PREVIEW_ONLY_ACTIONS: ReadonlySet<ReviewActionKind> = new Set([
  'preview-native-reconstruction', 'show-source-reference',
]);

export interface BuildReviewActionInput {
  importId: string;
  templateId?: string | null;
  action: ReviewActionKind;
  pageId?: string | null;
  pageNumber?: number | null;
  regionId?: string | null;
  planId?: string | null;
  planHash?: string | null;
  renderPlanHash?: string | null;
  currentOverrideId?: string | null;
  qualityReportHash?: string | null;
  reason?: string | null;
  hardDefectsAcknowledged?: boolean;
  requestedRecoveryOptionId?: string | null;
  clientRequestId: string;
}

const MAX_REASON_LEN = 500;

function sanitizeReason(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  // Plain text only; strip control chars and cap length. No HTML is ever executed.
  const cleaned = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, MAX_REASON_LEN);
}

/**
 * Build a validated review action request. Returns the action with a `problems`
 * list; a non-empty list means the client should NOT send it (server would
 * reject anyway). The actor identity is deliberately absent — the server derives
 * it from the authenticated session.
 */
export function buildReviewAction(input: BuildReviewActionInput): PdfReviewActionV1 {
  const problems: string[] = [];
  const reason = sanitizeReason(input.reason);

  if (!input.importId) problems.push('missing_import_id');
  if (!input.clientRequestId) problems.push('missing_client_request_id');

  // Force-native must acknowledge hard defects and give a reason when defects exist.
  if (input.action === 'force-native' && input.hardDefectsAcknowledged !== true) {
    problems.push('force_native_requires_hard_defect_acknowledgement');
  }
  if (input.action === 'force-native' && !reason) {
    problems.push('force_native_requires_reason');
  }
  // Provider recovery must reference a server-issued option id — never a raw provider.
  if (input.action === 'request-provider-recovery' && !input.requestedRecoveryOptionId) {
    problems.push('provider_recovery_requires_option_id');
  }

  return {
    version: PDF_REVIEW_ACTION_VERSION,
    actionId: `act-${input.clientRequestId}`,
    importId: input.importId,
    templateId: input.templateId ?? null,
    action: input.action,
    scope: {
      pageId: input.pageId ?? null,
      pageNumber: typeof input.pageNumber === 'number' ? input.pageNumber : null,
      regionId: input.regionId ?? null,
    },
    expectedState: {
      planId: input.planId ?? null,
      planHash: input.planHash ?? null,
      renderPlanHash: input.renderPlanHash ?? null,
      currentOverrideId: input.currentOverrideId ?? null,
      qualityReportHash: input.qualityReportHash ?? null,
    },
    reason,
    hardDefectsAcknowledged: input.hardDefectsAcknowledged === true,
    requestedRecoveryOptionId: input.requestedRecoveryOptionId ?? null,
    clientRequestId: input.clientRequestId,
    problems,
  };
}

/**
 * Client-side precondition gate for a HIGH-RISK action. Returns a reason code when
 * the action must be blocked in the UI (the server still re-checks authoritatively).
 * This is a UX guardrail, NOT authorization.
 */
export function guardHighRiskAction(
  action: ReviewActionKind,
  ctx: {
    hasUnresolvedHardDefects: boolean;
    cropAvailable: boolean;
    sourceRasterAvailable: boolean;
    hardDefectsAcknowledged: boolean;
    reasonProvided: boolean;
  },
): string | null {
  switch (action) {
    case 'force-native':
      if (ctx.hasUnresolvedHardDefects && !ctx.hardDefectsAcknowledged) return 'unacknowledged_hard_defects';
      if (ctx.hasUnresolvedHardDefects && !ctx.reasonProvided) return 'reason_required';
      return null;
    case 'force-source-crop':
      return ctx.cropAvailable ? null : 'crop_unavailable';
    case 'force-page-raster':
      return ctx.sourceRasterAvailable ? null : 'source_raster_unavailable';
    default:
      return null;
  }
}

/** Whether an action, if applied, keeps the automatic quality gate FAILED. */
export function keepsGateFailed(action: ReviewActionKind, hadUnresolvedHardDefects: boolean): boolean {
  // A force-native over unresolved hard defects is an operator override — the
  // automatic gate remains failed and E12 must not treat it as an automatic pass.
  return action === 'force-native' && hadUnresolvedHardDefects;
}
