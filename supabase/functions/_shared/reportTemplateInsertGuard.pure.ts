/**
 * Insert-time authorisation gate for `report_templates`.
 *
 * ## The gap this closes
 *
 * `manage-templates` validates report-template writes thoroughly — but only on
 * `update`. `validateReportTemplateUpdate` enforces "superadmin AND approved
 * AND the report type has a production adapter AND the schema renders" before a
 * template may go live. The `insert` branch had no equivalent: it passed the
 * caller's payload straight to Postgres.
 *
 * That mattered because `resolve_report_template()` selects
 * `WHERE report_type = $1 AND is_active = true`. Anyone with `templates:edit`
 * could therefore insert a row that was active from birth and have it picked as
 * the template for live customer PDFs, skipping every gate the update path
 * applies.
 *
 * ## Why the rules below cannot break the existing Builder
 *
 * Only two call sites insert into `report_templates` through this broker:
 *
 *   1. `useReportTemplates.ts` — the Builder's "New template" button, which
 *      sends `is_active: false, is_default: false` and no `scope`,
 *      `owner_user_id` or `approval_status`.
 *   2. `TemplateBranchingDialog.tsx` — branch creation, which sends
 *      `is_active: false, is_default: false, approval_status: 'draft'` and
 *      inherits `scope` / `owner_user_id` from a row the caller could already
 *      read (global, or user-scoped and their own).
 *
 * Every rule here is a no-op for both payloads. That is asserted directly in
 * `reportTemplateInsertGuard.spec.ts`, which replays the exact objects both
 * call sites build.
 *
 * Kept Deno-free so the frontend test suite can execute it — the same pattern
 * as `claudeReconstruct.pure.ts` and `templateLibraryCore.pure.ts`.
 */

export interface InsertGuardActor {
  isSuperadmin: boolean;
  /** Verified session user id, or 'service_role' for internal callers. */
  userId: string | null;
}

export interface InsertGuardProblem {
  code: string;
  message: string;
  status: number;
  detail?: unknown;
}

/** Truthy only for an explicit `true`; `'true'`, `1` and `undefined` are not. */
function isExplicitlyTrue(value: unknown): boolean {
  return value === true;
}

/**
 * A row is "going live" when it is created already active or already the
 * default for its report type. Both put it in the resolver's candidate set
 * without ever passing through the update path's gate.
 */
export function insertGoesLive(payload: Record<string, unknown>): boolean {
  return isExplicitlyTrue(payload.is_active) || isExplicitlyTrue(payload.is_default);
}

/**
 * Validate a `report_templates` insert.
 *
 * Returns `null` when the insert may proceed. Callers still run the existing
 * schema normalisation and renderer validation — this gate is about
 * *authorisation*, not about whether the payload is well-formed.
 *
 * `hasProductionAdapter` is injected rather than imported so this module stays
 * free of the broker's internals and the test can drive both branches.
 */
export function validateReportTemplateInsert(
  payload: Record<string, unknown>,
  actor: InsertGuardActor,
  hasProductionAdapter: (reportType: unknown) => boolean,
): InsertGuardProblem | null {
  const isService = actor.userId === 'service_role';
  // Internal service callers already passed a strict gate upstream. Treating
  // them as privileged here matches requireModulePermission's own behaviour.
  const privileged = actor.isSuperadmin || isService;

  // ── 1. Creating a live template ────────────────────────────────────────────
  // This is the rule with the production blast radius. It deliberately mirrors
  // validateReportTemplateUpdate so insert and update cannot diverge.
  if (insertGoesLive(payload)) {
    if (!privileged) {
      return {
        code: 'template_activation_blocked',
        message: 'superadmin required to create an active or default report template',
        status: 403,
      };
    }
    const approvalStatus = String(payload.approval_status ?? 'draft');
    if (approvalStatus !== 'approved') {
      return {
        code: 'template_activation_blocked',
        message: 'Template must be approved before it can be created as active or default.',
        status: 422,
        detail: { approvalStatus },
      };
    }
    if (!payload.report_type) {
      return {
        code: 'template_activation_blocked',
        message: 'Template must have a report type before it can be created as active or default.',
        status: 422,
      };
    }
    if (!hasProductionAdapter(payload.report_type)) {
      return {
        code: 'template_activation_blocked',
        message: `Template report type "${String(payload.report_type)}" does not have a production Template Builder adapter yet.`,
        status: 422,
        detail: { reportType: payload.report_type },
      };
    }
  }

  // ── 2. Creating an already-approved template ───────────────────────────────
  // Defence in depth: approval is a control-plane decision, and a row that
  // arrives pre-approved has skipped the review it claims to have had.
  // Rejected rather than silently coerced — quietly rewriting a caller's
  // payload hides the intent from whoever has to debug it later.
  if (!privileged && payload.approval_status !== undefined
      && String(payload.approval_status) !== 'draft') {
    return {
      code: 'template_approval_blocked',
      message: 'Templates must be created in draft. Request approval after creating it.',
      status: 403,
      detail: { approvalStatus: payload.approval_status },
    };
  }

  // ── 3. Claiming someone else's ownership ───────────────────────────────────
  // `owner_user_id` decides who can read a user-scoped template
  // (applyReportTemplateReadScope). Letting a caller name another user's id
  // would let them plant a template in that user's list, or hide one from
  // their own.
  if (!privileged && payload.owner_user_id != null && payload.owner_user_id !== actor.userId) {
    return {
      code: 'template_owner_blocked',
      message: 'A template can only be created under your own ownership.',
      status: 403,
    };
  }

  // ── 4. Creating an agency-scoped template ──────────────────────────────────
  // Agency scope is superadmin control-plane only, because there is no
  // authoritative user-to-agency membership relation to check against. This is
  // the same position migration 20260726143000 takes on reads.
  if (!privileged && payload.scope !== undefined && String(payload.scope) === 'agency') {
    return {
      code: 'template_scope_blocked',
      message: 'Agency-scoped templates can only be created by a superadmin.',
      status: 403,
    };
  }

  return null;
}
