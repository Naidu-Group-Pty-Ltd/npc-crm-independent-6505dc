/**
 * The insert gate added to `manage-templates`.
 *
 * Two jobs, in this order of importance:
 *
 *   1. **Prove the existing Builder is unaffected.** The first describe block
 *      replays the exact payloads the Builder's "New template" and branch flows
 *      construct. If any of those start failing, the gate is wrong, not the
 *      Builder.
 *   2. Prove the gate actually closes the hole — an insert can no longer create
 *      a template that `resolve_report_template()` would pick for a live report.
 */
import { describe, it, expect } from 'vitest';
import {
  insertGoesLive,
  validateReportTemplateInsert,
  type InsertGuardActor,
} from '../../../../supabase/functions/_shared/reportTemplateInsertGuard.pure';

/** Mirrors `PRODUCTION_REPORT_TEMPLATE_TYPES` in the broker. */
const hasAdapter = (t: unknown) => ['investment', 'compass', 'investment_compass',
  'investment_report', 'property_investment'].includes(String(t ?? '').trim().toLowerCase());

const ORDINARY: InsertGuardActor = { isSuperadmin: false, userId: 'user-1' };
const SUPERADMIN: InsertGuardActor = { isSuperadmin: true, userId: 'admin-1' };
const SERVICE: InsertGuardActor = { isSuperadmin: false, userId: 'service_role' };

const guard = (payload: Record<string, unknown>, actor = ORDINARY) =>
  validateReportTemplateInsert(payload, actor, hasAdapter);

// ═══════════════════════════════════════════════════════════════════════════
// Regression guard: the existing Builder must be completely unaffected.
// ═══════════════════════════════════════════════════════════════════════════

describe('existing Builder flows are unaffected', () => {
  /** Exactly what `useReportTemplates.ts` create sends. */
  const builderCreate = (over: Record<string, unknown> = {}) => ({
    name: 'Untitled template',
    description: null,
    report_type: null,
    tier: null,
    schema: { version: 1, tokens: {}, slots: {}, pages: [] },
    config: {},
    version: 1,
    is_active: false,
    is_default: false,
    ...over,
  });

  /** Exactly what `TemplateBranchingDialog.tsx` sends — a full row spread. */
  const branchInsert = (source: Record<string, unknown> = {}) => ({
    // ...src
    name: 'Source — draft',
    description: 'desc',
    report_type: 'investment',
    tier: 'compass',
    variant: null,
    schema: { version: 1, tokens: {}, slots: {}, pages: [] },
    config: {},
    custom_css: null,
    engine: 'weasyprint',
    scope: 'global',
    priority: 0,
    agency_id: null,
    owner_user_id: null,
    thumbnail_url: null,
    active_theme: 'light',
    brand_kit_id: null,
    ...source,
    // explicit overrides the dialog applies
    id: undefined,
    parent_template_id: 'src-id',
    branch_label: 'draft',
    is_draft: true,
    approval_status: 'draft',
    is_active: false,
    is_default: false,
    locked_for_review: false,
    locked_at: null,
    locked_by: null,
    version: 1,
    created_by: null,
    created_at: undefined,
    updated_at: undefined,
  });

  it('allows "New template" for an ordinary user with templates:edit', () => {
    expect(guard(builderCreate())).toBeNull();
  });

  it('allows "New template" carrying a report type and tier', () => {
    expect(guard(builderCreate({ report_type: 'investment', tier: 'compass' }))).toBeNull();
    expect(guard(builderCreate({ report_type: 'suburb', tier: 'snapshot' }))).toBeNull();
  });

  it('allows branching a global template', () => {
    expect(guard(branchInsert())).toBeNull();
  });

  it('allows branching a template the user owns', () => {
    expect(guard(branchInsert({ scope: 'user', owner_user_id: 'user-1' }))).toBeNull();
  });

  it('allows a superadmin to branch an agency-scoped template', () => {
    // Only a superadmin can read one to branch it in the first place.
    expect(guard(branchInsert({ scope: 'agency', agency_id: 'agency-a' }), SUPERADMIN)).toBeNull();
  });

  it('allows both Builder flows for a superadmin too', () => {
    expect(guard(builderCreate(), SUPERADMIN)).toBeNull();
    expect(guard(branchInsert(), SUPERADMIN)).toBeNull();
  });

  it('allows internal service callers, which already passed a strict gate', () => {
    expect(guard(builderCreate(), SERVICE)).toBeNull();
    expect(guard(branchInsert({ scope: 'agency' }), SERVICE)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The hole this gate closes.
// ═══════════════════════════════════════════════════════════════════════════

describe('creating a live template', () => {
  const live = (over: Record<string, unknown> = {}) => ({
    name: 'Injected',
    report_type: 'investment',
    approval_status: 'approved',
    schema: { version: 1, pages: [] },
    is_active: true,
    ...over,
  });

  it('blocks an ordinary user from creating an ACTIVE template', () => {
    const problem = guard(live());
    expect(problem?.code).toBe('template_activation_blocked');
    expect(problem?.status).toBe(403);
  });

  it('blocks an ordinary user from creating a DEFAULT template', () => {
    const problem = guard(live({ is_active: false, is_default: true }));
    expect(problem?.code).toBe('template_activation_blocked');
    expect(problem?.status).toBe(403);
  });

  it('blocks a superadmin creating an active template that is not approved', () => {
    const problem = guard(live({ approval_status: 'draft' }), SUPERADMIN);
    expect(problem?.code).toBe('template_activation_blocked');
    expect(problem?.status).toBe(422);
  });

  it('blocks a superadmin creating an active template with no report type', () => {
    const problem = guard(live({ report_type: null }), SUPERADMIN);
    expect(problem?.code).toBe('template_activation_blocked');
    expect(problem?.message).toMatch(/report type/i);
  });

  it('blocks a superadmin creating an active template whose type has no adapter', () => {
    const problem = guard(live({ report_type: 'suburb' }), SUPERADMIN);
    expect(problem?.code).toBe('template_activation_blocked');
    expect(problem?.detail).toEqual({ reportType: 'suburb' });
  });

  it('allows a superadmin creating an approved, adapter-backed active template', () => {
    // The one legitimate path. It still has to pass renderer validation in the
    // broker, which is applied separately.
    expect(guard(live(), SUPERADMIN)).toBeNull();
  });

  it('applies the same rules to is_default as to is_active', () => {
    expect(guard(live({ is_active: false, is_default: true, report_type: 'suburb' }), SUPERADMIN)?.code)
      .toBe('template_activation_blocked');
    expect(guard(live({ is_active: false, is_default: true }), SUPERADMIN)).toBeNull();
  });
});

describe('insertGoesLive', () => {
  it('is true only for an explicit boolean true', () => {
    expect(insertGoesLive({ is_active: true })).toBe(true);
    expect(insertGoesLive({ is_default: true })).toBe(true);
    expect(insertGoesLive({ is_active: false, is_default: false })).toBe(false);
    expect(insertGoesLive({})).toBe(false);
  });

  it('does not treat truthy lookalikes as live', () => {
    // Postgres would coerce these, but the gate should not have to guess.
    // Anything that is not exactly `true` stays inactive, and the column
    // default is false.
    expect(insertGoesLive({ is_active: 'true' })).toBe(false);
    expect(insertGoesLive({ is_active: 1 })).toBe(false);
  });
});

describe('privilege escalation on the other fields', () => {
  it('blocks an ordinary user creating a pre-approved template', () => {
    const problem = guard({ name: 'x', approval_status: 'approved' });
    expect(problem?.code).toBe('template_approval_blocked');
    expect(problem?.status).toBe(403);
  });

  it('allows an explicit draft, which is what the branch flow sends', () => {
    expect(guard({ name: 'x', approval_status: 'draft' })).toBeNull();
  });

  it('allows an omitted approval_status, which is what create sends', () => {
    expect(guard({ name: 'x' })).toBeNull();
  });

  it('lets a superadmin create a pre-approved template', () => {
    expect(guard({ name: 'x', approval_status: 'approved' }, SUPERADMIN)).toBeNull();
  });

  it('blocks an ordinary user claiming another user as owner', () => {
    const problem = guard({ name: 'x', scope: 'user', owner_user_id: 'someone-else' });
    expect(problem?.code).toBe('template_owner_blocked');
    expect(problem?.status).toBe(403);
  });

  it('allows a user naming themselves as owner', () => {
    expect(guard({ name: 'x', scope: 'user', owner_user_id: 'user-1' })).toBeNull();
  });

  it('allows a null owner, which is what both Builder flows send', () => {
    expect(guard({ name: 'x', owner_user_id: null })).toBeNull();
    expect(guard({ name: 'x' })).toBeNull();
  });

  it('blocks an ordinary user creating an agency-scoped template', () => {
    const problem = guard({ name: 'x', scope: 'agency', agency_id: 'agency-a' });
    expect(problem?.code).toBe('template_scope_blocked');
    expect(problem?.status).toBe(403);
  });

  it('allows global and user scope for an ordinary user', () => {
    expect(guard({ name: 'x', scope: 'global' })).toBeNull();
    expect(guard({ name: 'x', scope: 'user', owner_user_id: 'user-1' })).toBeNull();
  });

  it('lets a superadmin do all of it', () => {
    expect(guard({ name: 'x', scope: 'agency', agency_id: 'a' }, SUPERADMIN)).toBeNull();
    expect(guard({ name: 'x', scope: 'user', owner_user_id: 'anyone' }, SUPERADMIN)).toBeNull();
  });
});

describe('gate ordering', () => {
  it('reports the activation problem first when several rules are broken', () => {
    // The activation rule is the one with the production blast radius, so it
    // should be what the caller is told about.
    const problem = guard({
      name: 'x', is_active: true, approval_status: 'approved',
      scope: 'agency', owner_user_id: 'someone-else', report_type: 'investment',
    });
    expect(problem?.code).toBe('template_activation_blocked');
  });
});
