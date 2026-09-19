// Commercial & Industrial finance assessment API.
//
// Every read and write is mediated here: RLS on the assessment tables admits
// service_role only, so a browser cannot reach them directly. This function
// authenticates the caller, scopes every query by user_id, validates payloads
// independently of the client, and writes an audit event for anything that
// changes state.
//
// Operations:
//   list | get | create | autosave | update_section | run_calculation
//   list_calculations | save_scenario | list_scenarios | complete
//   search_clients | link_client | unlink_client | archive | restore | audit
//
// Client association is deliberately a separate, explicit operation. Nothing
// else in this file writes a client_id.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { summariseUploads } from '../_shared/ciAssessments/uploads.pure.ts';

/**
 * Client ownership filter, matching the model used by `get-client-data`:
 * a client is reachable when the caller created it or is the assigned team
 * member.
 *
 * This is the *fallback* scope, not the whole model. The platform's client
 * tables are also reachable by staff holding view permission on the Clients
 * module — that is the rule `render-borrowing-capacity-pdf` and the client
 * workspace itself apply — and the first shipped version of this function
 * omitted it, so the linking step showed each adviser only the clients they
 * personally created. `resolveClientScope` below restores the platform rule:
 * module-permission holders (and superadmins, inside `requireModulePermission`)
 * see every client; everyone else falls back to ownership. Still fail-closed —
 * a permission lookup that errors narrows to ownership, never widens.
 */
const clientOwnershipFilter = (userId: string) =>
  `created_by.eq.${userId},assigned_team_user_id.eq.${userId}`;

type Operation =
  | 'list' | 'get' | 'create' | 'autosave' | 'update_section' | 'rename'
  | 'run_calculation' | 'list_calculations'
  | 'save_scenario' | 'list_scenarios'
  | 'complete' | 'search_clients' | 'create_client' | 'link_client' | 'unlink_client'
  | 'client_workspace'
  | 'archive' | 'restore' | 'audit';

const VALID_STATUSES = new Set([
  'draft', 'data_entry', 'ready_to_calculate', 'calculated',
  'requires_review', 'completed', 'linked', 'archived',
]);

/**
 * Statuses whose working payload may be edited: everything but archived.
 *
 * This used to stop at `requires_review`, so a completed assessment refused
 * every edit — "An assessment with status \"completed\" cannot be edited.
 * Reopen it first" — with no reopen anywhere in the product. A deal does not
 * stop moving because an assessment was marked complete: a valuation lands, a
 * rate moves, a tenant is re-signed, and the assessment has to take it.
 *
 * What completion actually protects is the **calculation run**, and that is
 * protected by the run itself: every run stores its own `inputs_snapshot`,
 * `policy_snapshot` and `outputs`, and reports are produced from the stored run
 * rather than from the working payload. Editing the payload of a completed
 * assessment therefore changes what the *next* calculation will say and
 * nothing about what the last one said. The workspace shows when the two have
 * diverged; running the calculation again reconciles them.
 *
 * Archived is the one refusal, and it has a documented way back — restore.
 */
const EDITABLE_STATUSES = new Set([
  'draft', 'data_entry', 'ready_to_calculate', 'calculated', 'requires_review',
  'completed', 'linked',
]);

/**
 * Statuses a *client* may assign through an update.
 *
 * Narrower than the set above, and deliberately so: `completed` is reached
 * through the `complete` operation (which requires a calculation run) and
 * `linked` through `link_client` (which requires a reachable client). Letting
 * an autosave set either would let the browser claim a state the server never
 * checked the preconditions for.
 */
const ASSIGNABLE_STATUSES = new Set([
  'draft', 'data_entry', 'ready_to_calculate', 'calculated', 'requires_review',
]);

const VALID_SEGMENTS = new Set(['commercial', 'industrial']);

/** Caps that keep a hostile or runaway client from writing an unbounded document. */
const MAX_PAYLOAD_BYTES = 1_500_000;
const MAX_LIST_LIMIT = 200;
const MAX_COLLECTION_LENGTH = 250;

interface RequestBody {
  operation: Operation;
  assessmentId?: string;
  clientId?: string;
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  section?: string;
  sectionData?: unknown;
  outputs?: Record<string, unknown>;
  inputsSnapshot?: Record<string, unknown>;
  policySnapshot?: Record<string, unknown>;
  scenarioKey?: string;
  scenarioLabel?: string;
  changedAssumption?: string;
  parameters?: Record<string, unknown>;
  reconciliationItems?: unknown[];
  appliedChanges?: unknown[];
  expectedVersion?: number;
  status?: string;
  search?: string;
  segment?: string;
  limit?: number;
  offset?: number;
  session_token?: string;
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function fail(message: string, status: number, cors: Record<string, string>, code?: string) {
  return json({ success: false, error: message, code }, status, cors);
}

/** A stable, human-quotable reference. Not a security token — just a label. */
function buildReference(): string {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `CI-${stamp}-${random}`;
}

/**
 * Server-side payload validation, independent of anything the client checked.
 * Bounds only — a draft is allowed to be incomplete, never nonsensical.
 */
function validatePayload(payload: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (payload == null) return { ok: true, value: {} };
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'payload must be an object' };
  }

  const serialised = JSON.stringify(payload);
  if (serialised.length > MAX_PAYLOAD_BYTES) {
    return { ok: false, error: 'Assessment payload exceeds the maximum supported size' };
  }

  const record = payload as Record<string, any>;

  const collections: Array<[string, unknown]> = [
    ['ownership.entities', record?.ownership?.entities],
    ['income.periods', record?.income?.periods],
    ['income.addbacks', record?.income?.addbacks],
    ['portfolio.assets', record?.portfolio?.assets],
    ['portfolio.liabilities', record?.portfolio?.liabilities],
    ['lease.tenancies', record?.lease?.tenancies],
    ['provenance', record?.provenance],
  ];
  for (const [name, value] of collections) {
    if (value == null) continue;
    if (!Array.isArray(value)) return { ok: false, error: `${name} must be an array` };
    if (value.length > MAX_COLLECTION_LENGTH) {
      return { ok: false, error: `${name} exceeds the maximum of ${MAX_COLLECTION_LENGTH} entries` };
    }
  }

  // Reject non-finite numbers anywhere in the document: they serialise to null
  // in JSON and would silently become zero on the next read.
  const seen = new WeakSet<object>();
  const scan = (node: unknown, path: string): string | null => {
    if (typeof node === 'number') {
      return Number.isFinite(node) ? null : `${path} is not a finite number`;
    }
    if (node && typeof node === 'object') {
      if (seen.has(node as object)) return `${path} contains a circular reference`;
      seen.add(node as object);
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const error = scan(child, path ? `${path}.${key}` : key);
        if (error) return error;
      }
    }
    return null;
  };
  const scanError = scan(payload, '');
  if (scanError) return { ok: false, error: scanError };

  return { ok: true, value: record };
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return fail('Invalid JSON', 400, corsHeaders, 'INVALID_JSON');
  }

  const auth = await verifyAuth(supabase, req.headers, { session_token: body.session_token });
  if (auth.error || !auth.userId) {
    return createUnauthorizedResponse(auth.error || 'Authentication required', corsHeaders);
  }
  const userId = auth.userId;

  // Commercial & Industrial is a Scale-or-add-on capability — enforced
  // server-side, not just hidden in the UI.
  const entitlement = await requireWorkspaceCapability(supabase, auth, 'commercial-industrial');
  if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);


  if (!body.operation) {
    return fail('operation is required', 400, corsHeaders, 'MISSING_OPERATION');
  }

  // -------------------------------------------------------------------------
  // Helpers scoped to the authenticated caller.
  // -------------------------------------------------------------------------

  /**
   * Load an assessment the caller owns. Returns null rather than throwing so
   * the caller can answer 404 without distinguishing "does not exist" from
   * "belongs to someone else" — that distinction leaks cross-tenant existence.
   */
  async function loadOwned(assessmentId: string) {
    const { data, error } = await supabase
      .from('commercial_industrial_assessments')
      .select('*')
      .eq('id', assessmentId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  /**
   * Whether this caller may reach every client, or only their own.
   *
   * Resolved at most once per request, and only on the operations that touch
   * the clients table — `requireModulePermission` costs three reads and most
   * operations never need it. A lookup failure resolves to the ownership
   * scope: an errored permission check must narrow, never widen.
   */
  let clientScopeCache: 'all' | 'own' | null = null;
  async function resolveClientScope(): Promise<'all' | 'own'> {
    if (clientScopeCache) return clientScopeCache;
    try {
      const staff = await requireModulePermission(supabase, auth, 'clients', 'can_view');
      clientScopeCache = staff.ok ? 'all' : 'own';
    } catch {
      clientScopeCache = 'own';
    }
    return clientScopeCache;
  }

  /**
   * Load a client the caller may reach, or null.
   *
   * Null covers "does not exist" and "not yours" alike, deliberately — the
   * distinction would confirm the existence of another user's record.
   */
  async function loadReachableClient(clientId: string, columns = 'id') {
    let query = supabase.from('clients').select(columns).eq('id', clientId);
    if (await resolveClientScope() === 'own') {
      query = query.or(clientOwnershipFilter(userId));
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  }

  async function writeAudit(assessmentId: string, eventType: string, detail: Record<string, unknown> = {}) {
    // Best effort: an audit write must never fail the user's operation, but a
    // failure has to be visible in the logs.
    const { error } = await supabase
      .from('commercial_industrial_assessment_audit_events')
      .insert({
        assessment_id: assessmentId,
        user_id: userId,
        event_type: eventType,
        detail,
        actor_id: userId,
      });
    if (error) console.error('[manage-ci-assessments] audit write failed', eventType);
  }

  try {
    switch (body.operation) {
      // ---------------------------------------------------------------------
      case 'list': {
        const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Number(body.limit) || 50));
        const offset = Math.max(0, Number(body.offset) || 0);

        let query = supabase
          .from('commercial_industrial_assessments')
          .select(
            'id, reference, title, status, segment, assessment_type, requested_loan, '
            + 'maximum_indicative_loan, proposed_lvr, proposed_dscr, outcome, binding_constraint, '
            + 'client_id, linked_at, current_calculation_id, version, created_at, updated_at, archived_at',
            { count: 'exact' },
          )
          .eq('user_id', userId);

        if (body.status && VALID_STATUSES.has(body.status)) {
          query = query.eq('status', body.status);
        } else if (body.status !== 'archived') {
          query = query.is('archived_at', null);
        }
        if (body.segment && VALID_SEGMENTS.has(body.segment)) {
          query = query.eq('segment', body.segment);
        }
        if (body.search && body.search.trim()) {
          // Escape PostgREST's `or` filter separators so a search string cannot
          // inject additional conditions.
          const term = body.search.trim().slice(0, 120).replace(/[,()\\]/g, ' ');
          query = query.or(`title.ilike.%${term}%,reference.ilike.%${term}%`);
        }

        const { data, error, count } = await query
          .order('updated_at', { ascending: false })
          .range(offset, offset + limit - 1);
        if (error) throw error;
        return json({ success: true, data, total: count ?? 0, limit, offset }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      case 'get': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const assessment = await loadOwned(body.assessmentId);
        if (!assessment) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        const { data: latestRun } = await supabase
          .from('commercial_industrial_calculation_runs')
          .select('*')
          .eq('assessment_id', assessment.id)
          .eq('user_id', userId)
          .eq('scenario_key', 'base')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        return json({ success: true, data: { assessment, latestRun: latestRun ?? null } }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      case 'create': {
        const validated = validatePayload(body.payload);
        if (!validated.ok) return fail(validated.error, 400, corsHeaders, 'INVALID_PAYLOAD');

        const segment = VALID_SEGMENTS.has(String(body.segment)) ? body.segment : 'commercial';
        const title = String(body.data?.title ?? 'Untitled assessment').slice(0, 300);
        const assessmentType = String(body.data?.assessmentType ?? 'commercial_investment').slice(0, 60);

        const { data, error } = await supabase
          .from('commercial_industrial_assessments')
          .insert({
            user_id: userId,
            reference: buildReference(),
            title,
            status: 'draft',
            segment,
            assessment_type: assessmentType,
            payload: validated.value,
            created_by: userId,
            updated_by: userId,
          })
          .select()
          .single();
        if (error) throw error;

        await writeAudit(data.id, 'assessment_created', { segment, assessmentType });
        return json({ success: true, data }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // Autosave. Guarded by an optimistic-concurrency version so two open
      // tabs cannot silently overwrite one another.
      case 'autosave':
      case 'update_section': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        if (!EDITABLE_STATUSES.has(existing.status)) {
          return fail(
            `An assessment with status "${existing.status}" cannot be edited. Restore it first.`,
            409, corsHeaders, 'NOT_EDITABLE',
          );
        }

        if (
          body.expectedVersion != null
          && Number(body.expectedVersion) !== Number(existing.version)
        ) {
          return json({
            success: false,
            code: 'VERSION_CONFLICT',
            error: 'This assessment was changed elsewhere. Reload to pick up the latest version.',
            currentVersion: existing.version,
          }, 409, corsHeaders);
        }

        const validated = validatePayload(body.payload);
        if (!validated.ok) return fail(validated.error, 400, corsHeaders, 'INVALID_PAYLOAD');

        const update: Record<string, unknown> = {
          payload: validated.value,
          version: Number(existing.version) + 1,
          updated_by: userId,
        };
        if (body.data?.title != null) update.title = String(body.data.title).slice(0, 300);
        if (body.segment && VALID_SEGMENTS.has(body.segment)) update.segment = body.segment;
        if (body.data?.assessmentType != null) {
          update.assessment_type = String(body.data.assessmentType).slice(0, 60);
        }
        if (existing.status === 'draft') update.status = 'data_entry';
        if (body.status && VALID_STATUSES.has(body.status) && ASSIGNABLE_STATUSES.has(body.status)) {
          update.status = body.status;
        }
        // A completed or linked assessment keeps its status through an edit.
        // Demoting it would revoke the report and unlink the client because a
        // figure moved, which is the opposite of what editing one is for.
        if (!ASSIGNABLE_STATUSES.has(existing.status)) delete update.status;

        const { data, error } = await supabase
          .from('commercial_industrial_assessments')
          .update(update)
          .eq('id', existing.id)
          .eq('user_id', userId)
          .eq('version', existing.version)
          .select()
          .single();
        if (error) throw error;
        if (!data) {
          return json({
            success: false, code: 'VERSION_CONFLICT',
            error: 'This assessment was changed elsewhere. Reload to pick up the latest version.',
          }, 409, corsHeaders);
        }

        // Section edits are audited; plain autosaves are not, or the audit log
        // becomes a keystroke recorder rather than a record of decisions.
        if (body.operation === 'update_section' && body.section) {
          await writeAudit(existing.id, 'section_updated', { section: String(body.section).slice(0, 80) });
        }
        return json({ success: true, data }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      /**
       * Rename — the title, and nothing else.
       *
       * Deliberately outside the `EDITABLE_STATUSES` gate that governs
       * `autosave`. That gate protects the *figures*: a completed assessment's
       * calculation run snapshots its own inputs, outputs and policy, and
       * letting a stray autosave move the working payload underneath it would
       * make the run describe something that no longer exists. A title is a
       * label on the folder, not a number in the file — "Test" has to be able
       * to become "45 Industrial Drive" after the work is done, which is
       * exactly when its real name is known.
       *
       * The payload is not touched, so there is no version race to lose and no
       * expectedVersion to send. Archived is the one refusal: an archived
       * assessment is restored first.
       */
      case 'rename': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        if (existing.status === 'archived') {
          return fail('An archived assessment cannot be renamed. Restore it first.', 409, corsHeaders, 'NOT_EDITABLE');
        }

        const title = String(body.data?.title ?? '').trim().slice(0, 300);
        if (!title) return fail('A name is required', 400, corsHeaders, 'INVALID_TITLE');
        if (title === existing.title) return json({ success: true, data: existing }, 200, corsHeaders);

        const { data, error } = await supabase
          .from('commercial_industrial_assessments')
          .update({ title, updated_by: userId, version: Number(existing.version) + 1 })
          .eq('id', existing.id)
          .eq('user_id', userId)
          .select()
          .single();
        if (error) throw error;

        await writeAudit(existing.id, 'assessment_renamed', {
          from: String(existing.title ?? '').slice(0, 300), to: title,
        });
        return json({ success: true, data }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // Calculation runs are immutable and always append.
      case 'run_calculation': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        if (!body.outputs || typeof body.outputs !== 'object') {
          return fail('outputs are required', 400, corsHeaders, 'MISSING_OUTPUTS');
        }
        const inputs = validatePayload(body.inputsSnapshot ?? existing.payload);
        if (!inputs.ok) return fail(inputs.error, 400, corsHeaders, 'INVALID_PAYLOAD');

        const outputs = body.outputs as Record<string, any>;
        const summary = (outputs.summary ?? {}) as Record<string, any>;
        const scenarioKey = String(body.scenarioKey ?? 'base').slice(0, 60);

        const { data: run, error: runError } = await supabase
          .from('commercial_industrial_calculation_runs')
          .insert({
            assessment_id: existing.id,
            user_id: userId,
            engine_version: String(outputs.engineVersion ?? 'unknown').slice(0, 40),
            policy_version: String(outputs.policyVersion ?? 'unknown').slice(0, 40),
            scenario_key: scenarioKey,
            inputs_snapshot: inputs.value,
            policy_snapshot: body.policySnapshot ?? outputs.policy ?? {},
            outputs,
            outcome: outputs.outcome ? String(outputs.outcome).slice(0, 60) : null,
            binding_constraint: summary.bindingConstraint ? String(summary.bindingConstraint).slice(0, 80) : null,
            maximum_indicative_loan: Number.isFinite(summary.maximumIndicativeLoan)
              ? summary.maximumIndicativeLoan : null,
            created_by: userId,
          })
          .select()
          .single();
        if (runError) throw runError;

        // Only the base scenario advances the assessment's own headline figures.
        if (scenarioKey === 'base') {
          const nextStatus = outputs.outcome === 'requires_specialist_review'
            || outputs.outcome === 'insufficient_information'
            ? 'requires_review'
            : 'calculated';

          const { error: updateError } = await supabase
            .from('commercial_industrial_assessments')
            .update({
              current_calculation_id: run.id,
              // Re-running on a completed or linked assessment updates its
              // figures and leaves it completed or linked — the run it points
              // at moves forward, its place in the workflow does not.
              status: ASSIGNABLE_STATUSES.has(existing.status) ? nextStatus : existing.status,
              requested_loan: Number.isFinite(summary.requestedLoan) ? summary.requestedLoan : null,
              maximum_indicative_loan: Number.isFinite(summary.maximumIndicativeLoan)
                ? summary.maximumIndicativeLoan : null,
              proposed_lvr: Number.isFinite(summary.proposedLvr) ? summary.proposedLvr : null,
              proposed_dscr: Number.isFinite(summary.proposedDscr) ? summary.proposedDscr : null,
              outcome: outputs.outcome ? String(outputs.outcome).slice(0, 60) : null,
              binding_constraint: summary.bindingConstraint ? String(summary.bindingConstraint).slice(0, 80) : null,
              updated_by: userId,
            })
            .eq('id', existing.id)
            .eq('user_id', userId);
          if (updateError) throw updateError;
        }

        await writeAudit(existing.id, 'calculation_run', {
          runId: run.id,
          scenarioKey,
          engineVersion: run.engine_version,
          policyVersion: run.policy_version,
          outcome: run.outcome,
        });

        return json({ success: true, data: run }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      case 'list_calculations': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        const { data, error } = await supabase
          .from('commercial_industrial_calculation_runs')
          .select('id, engine_version, policy_version, scenario_key, outcome, binding_constraint, maximum_indicative_loan, created_at, created_by')
          .eq('assessment_id', existing.id)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        return json({ success: true, data }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      case 'save_scenario': {
        if (!body.assessmentId || !body.scenarioKey) {
          return fail('assessmentId and scenarioKey are required', 400, corsHeaders);
        }
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        const scenarioKey = String(body.scenarioKey).slice(0, 60);
        const { data: current } = await supabase
          .from('commercial_industrial_assessment_scenarios')
          .select('id')
          .eq('assessment_id', existing.id)
          .eq('user_id', userId)
          .eq('scenario_key', scenarioKey)
          .maybeSingle();

        const row = {
          assessment_id: existing.id,
          user_id: userId,
          scenario_key: scenarioKey,
          label: String(body.scenarioLabel ?? scenarioKey).slice(0, 200),
          changed_assumption: body.changedAssumption ? String(body.changedAssumption).slice(0, 500) : null,
          parameters: body.parameters ?? {},
          latest_outputs: body.outputs ?? null,
          created_by: userId,
        };

        const { data, error } = current
          ? await supabase
            .from('commercial_industrial_assessment_scenarios')
            .update(row).eq('id', current.id).eq('user_id', userId).select().single()
          : await supabase
            .from('commercial_industrial_assessment_scenarios')
            .insert(row).select().single();
        if (error) throw error;

        await writeAudit(existing.id, 'scenario_saved', { scenarioKey });
        return json({ success: true, data }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      case 'list_scenarios': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        const { data, error } = await supabase
          .from('commercial_industrial_assessment_scenarios')
          .select('*')
          .eq('assessment_id', existing.id)
          .eq('user_id', userId)
          .order('created_at', { ascending: true });
        if (error) throw error;
        return json({ success: true, data }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      case 'complete': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        // Completion requires a calculation. Without one there is nothing to
        // complete — the assessment has no result to stand behind.
        if (!existing.current_calculation_id) {
          return fail(
            'Run a calculation before completing the assessment.',
            409, corsHeaders, 'NO_CALCULATION',
          );
        }

        const { data, error } = await supabase
          .from('commercial_industrial_assessments')
          .update({ status: 'completed', updated_by: userId, version: Number(existing.version) + 1 })
          .eq('id', existing.id)
          .eq('user_id', userId)
          .select()
          .single();
        if (error) throw error;

        await writeAudit(existing.id, 'assessment_completed', {
          calculationId: existing.current_calculation_id,
        });
        return json({ success: true, data }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // Client search for the final linking step.
      //
      // Reuses the repository's client-access model rather than inventing one:
      // a client is reachable when the caller created it or is the assigned
      // team member, and superadmins see all. This function only ever narrows
      // that scope, never widens it.
      case 'search_clients': {
        const term = String(body.search ?? '').trim().slice(0, 120);
        let query = supabase
          .from('clients')
          .select('id, primary_first_name, primary_surname, primary_email, primary_mobile, updated_at');
        // Staff holding Clients-module view permission search the whole book,
        // which is the platform's rule everywhere else clients appear. Others
        // see the clients they created or are assigned to.
        if (await resolveClientScope() === 'own') {
          query = query.or(clientOwnershipFilter(userId));
        }

        // Filter in the database, not after a truncated fetch — filtering a
        // 25-row page in memory would hide any client outside that page.
        if (term) {
          const safe = term.replace(/[,()\\*]/g, ' ');
          query = query.or(
            `primary_first_name.ilike.%${safe}%,primary_surname.ilike.%${safe}%,primary_email.ilike.%${safe}%`,
          );
        }

        const { data, error } = await query
          .order('updated_at', { ascending: false })
          .limit(25);
        if (error) throw error;

        return json({ success: true, data: data ?? [] }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // Create a client from the linking step.
      //
      // A minimal person record, in the shape the platform's other creation
      // paths write (`ai-dashboard-agent`, the CRM form): name, contact
      // details, `pipeline_status: 'lead'`, owned by the creator. The caller
      // prefill comes from the assessment payload, but nothing is written the
      // user did not see on screen first — the UI shows an editable form, and
      // this operation stores exactly what was submitted.
      //
      // Deliberately does NOT link. Creation and linking stay two audited
      // steps, so a failed link never strands a half-made client, and the
      // reconciliation flow runs identically for a new client and an old one.
      case 'create_client': {
        const firstName = String(body.firstName ?? '').trim().slice(0, 120);
        const surname = String(body.surname ?? '').trim().slice(0, 120);
        const email = String(body.email ?? '').trim().slice(0, 254);
        const mobile = String(body.mobile ?? '').trim().slice(0, 40);

        if (!firstName && !surname) {
          return fail('A first name or surname is required', 400, corsHeaders, 'MISSING_NAME');
        }
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          return fail('The email address is not valid', 400, corsHeaders, 'INVALID_EMAIL');
        }

        // Duplicate guard on exact email: creating "the same client twice"
        // from the linking step is the likeliest mistake this screen invites,
        // and the search a click away already finds the existing record.
        if (email) {
          const { data: existingClient, error: dupError } = await supabase
            .from('clients')
            .select('id, primary_first_name, primary_surname')
            .ilike('primary_email', email)
            .limit(1)
            .maybeSingle();
          if (dupError) throw dupError;
          if (existingClient) {
            return fail(
              'A client with this email already exists — search for them instead.',
              409, corsHeaders, 'DUPLICATE_EMAIL',
            );
          }
        }

        const { data: created, error: createError } = await supabase
          .from('clients')
          .insert({
            primary_first_name: firstName || null,
            primary_surname: surname || null,
            primary_email: email || null,
            primary_mobile: mobile || null,
            pipeline_status: 'lead',
            ghl_sync_status: 'pending',
            created_by: userId,
          })
          .select('id, primary_first_name, primary_surname, primary_email, primary_mobile, updated_at')
          .single();
        if (createError) throw createError;

        // When the creation happened inside an assessment's linking step, the
        // assessment's audit trail records it — a client record appearing out
        // of a finance workflow is exactly what an audit trail is for.
        if (typeof body.assessmentId === 'string' && body.assessmentId) {
          const owned = await loadOwned(body.assessmentId);
          if (owned) {
            await writeAudit(owned.id, 'client_created', {
              clientId: created.id,
              source: 'ci_linking_step',
            });
          }
        }

        return json({ success: true, data: created }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // Linking is explicit, audited and never silent. The reconciliation
      // decision set is stored verbatim alongside what was actually applied.
      case 'link_client': {
        if (!body.assessmentId || !body.clientId) {
          return fail('assessmentId and clientId are required', 400, corsHeaders);
        }
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        if (existing.status !== 'completed' && existing.status !== 'linked') {
          return fail(
            'Complete the assessment before linking it to a client.',
            409, corsHeaders, 'NOT_COMPLETED',
          );
        }

        // Confirm the caller may reach this client — their own, or any client
        // when they hold Clients-module view permission. A client they cannot
        // see is reported as not found, not as forbidden.
        const client = await loadReachableClient(String(body.clientId));
        if (!client) return fail('Client not found', 404, corsHeaders, 'CLIENT_NOT_FOUND');

        const reconciliationItems = Array.isArray(body.reconciliationItems)
          ? body.reconciliationItems.slice(0, 500) : [];
        const appliedChanges = Array.isArray(body.appliedChanges)
          ? body.appliedChanges.slice(0, 500) : [];

        const { data: link, error: linkError } = await supabase
          .from('commercial_industrial_assessment_client_links')
          .insert({
            assessment_id: existing.id,
            client_id: body.clientId,
            user_id: userId,
            reconciliation_items: reconciliationItems,
            applied_changes: appliedChanges,
            linked_by: userId,
          })
          .select()
          .single();
        if (linkError) throw linkError;

        const { data, error } = await supabase
          .from('commercial_industrial_assessments')
          .update({
            client_id: body.clientId,
            status: 'linked',
            linked_at: new Date().toISOString(),
            linked_by: userId,
            updated_by: userId,
            version: Number(existing.version) + 1,
          })
          .eq('id', existing.id)
          .eq('user_id', userId)
          .select()
          .single();
        if (error) throw error;

        await writeAudit(existing.id, 'client_linked', {
          clientId: body.clientId,
          linkId: link.id,
          itemsReviewed: reconciliationItems.length,
          changesApplied: appliedChanges.length,
        });

        return json({ success: true, data, link }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      case 'unlink_client': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');
        if (!existing.client_id) return fail('Assessment is not linked to a client', 409, corsHeaders);

        // The link row survives — unlinking closes it, it does not erase it.
        await supabase
          .from('commercial_industrial_assessment_client_links')
          .update({ unlinked_by: userId, unlinked_at: new Date().toISOString() })
          .eq('assessment_id', existing.id)
          .eq('client_id', existing.client_id)
          .is('unlinked_at', null);

        const { data, error } = await supabase
          .from('commercial_industrial_assessments')
          .update({
            client_id: null, status: 'completed', linked_at: null, linked_by: null,
            updated_by: userId, version: Number(existing.version) + 1,
          })
          .eq('id', existing.id)
          .eq('user_id', userId)
          .select()
          .single();
        if (error) throw error;

        await writeAudit(existing.id, 'client_unlinked', { previousClientId: existing.client_id });
        return json({ success: true, data }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // Everything Commercial & Industrial that touches one client, in one
      // read: the linked assessments, their calculation runs, their generated
      // report renders and the link history. Powers the client profile's
      // Commercial / Industrial tab.
      //
      // Access follows the *client*, not assessment ownership. The tab lives
      // on the client's profile, which the caller reached under the clients
      // module's own rules — a colleague's assessment linked to a client you
      // may see is part of that client's record, exactly as their reports and
      // files tabs already behave. Assessment ownership still governs editing:
      // every mutating operation in this function stays scoped by user_id.
      case 'client_workspace': {
        if (!body.clientId || typeof body.clientId !== 'string') {
          return fail('clientId is required', 400, corsHeaders);
        }
        const client = await loadReachableClient(
          body.clientId,
          'id, primary_first_name, primary_surname, primary_email, primary_mobile',
        );
        if (!client) return fail('Client not found', 404, corsHeaders, 'CLIENT_NOT_FOUND');

        const { data: assessments, error: assessError } = await supabase
          .from('commercial_industrial_assessments')
          // `provenance` is the payload's record of where each value came
          // from, and it is the only trace the intake pack leaves in the
          // database — the workbook and its supporting files are read in the
          // browser and never uploaded. Selecting the one JSON path rather
          // than the whole payload keeps a 1.5MB document out of the response.
          .select('id, user_id, reference, title, status, segment, assessment_type, requested_loan, maximum_indicative_loan, proposed_lvr, proposed_dscr, outcome, binding_constraint, current_calculation_id, linked_at, created_at, updated_at, archived_at, provenance:payload->provenance')
          .eq('client_id', body.clientId)
          .order('updated_at', { ascending: false })
          .limit(100);
        if (assessError) throw assessError;

        const ids = (assessments ?? []).map((row: { id: string }) => row.id);

        let runs: unknown[] = [];
        let renders: unknown[] = [];
        let links: unknown[] = [];
        if (ids.length) {
          const [runsRes, rendersRes, linksRes] = await Promise.all([
            supabase
              .from('commercial_industrial_calculation_runs')
              .select('id, assessment_id, scenario_key, outcome, binding_constraint, maximum_indicative_loan, engine_version, policy_version, created_at')
              .in('assessment_id', ids)
              .order('created_at', { ascending: false })
              .limit(200),
            supabase
              .from('commercial_industrial_report_renders')
              .select('id, assessment_id, status, file_name, page_count, bytes, has_analysis, analysis_note, created_at')
              .in('assessment_id', ids)
              .order('created_at', { ascending: false })
              .limit(100),
            supabase
              .from('commercial_industrial_assessment_client_links')
              .select('id, assessment_id, linked_at, unlinked_at, applied_changes')
              .eq('client_id', body.clientId)
              .order('linked_at', { ascending: false })
              .limit(100),
          ]);
          if (runsRes.error) throw runsRes.error;
          // The renders table postdates the assessments feature; a deployment
          // that has not applied its migration yet should degrade to an empty
          // list here, not take the whole tab down.
          if (rendersRes.error) {
            console.warn('[manage-ci-assessments] renders unreadable:', rendersRes.error.message);
          }
          if (linksRes.error) throw linksRes.error;
          runs = runsRes.data ?? [];
          renders = rendersRes.data ?? [];
          links = linksRes.data ?? [];
        }

        /**
         * Assessments that belong to this client but are not linked to them.
         *
         * The reported symptom was a client profile reading "No Commercial &
         * Industrial assessments linked" for a client who had been *created
         * from* an assessment minutes earlier — true, and useless. Two records
         * establish the relationship without a link: the audit event written
         * when a client is created from the linking step, and any historical
         * link that was later removed. Both are surfaced so the tab can say
         * which assessment it means and offer the step that links it.
         *
         * Read-only and best-effort — a failure here costs a prompt, not the
         * tab, which is why it is not thrown.
         */
        let candidates: unknown[] = [];
        try {
          const [createdRes, historicRes] = await Promise.all([
            supabase
              .from('commercial_industrial_assessment_audit_events')
              .select('assessment_id')
              .eq('event_type', 'client_created')
              .eq('detail->>clientId', body.clientId)
              .limit(50),
            supabase
              .from('commercial_industrial_assessment_client_links')
              .select('assessment_id')
              .eq('client_id', body.clientId)
              .not('unlinked_at', 'is', null)
              .limit(50),
          ]);

          const linked = new Set(ids);
          const candidateIds = [
            ...(createdRes.data ?? []).map((row: { assessment_id: string }) => row.assessment_id),
            ...(historicRes.data ?? []).map((row: { assessment_id: string }) => row.assessment_id),
          ].filter((id) => id && !linked.has(id));

          if (candidateIds.length) {
            const { data: rows } = await supabase
              .from('commercial_industrial_assessments')
              .select('id, reference, title, status, segment, requested_loan, maximum_indicative_loan, updated_at')
              // Still scoped to the caller's own assessments: the client is
              // reachable, which says nothing about whose assessment this is.
              .eq('user_id', userId)
              .in('id', Array.from(new Set(candidateIds)))
              .is('archived_at', null)
              .order('updated_at', { ascending: false })
              .limit(25);
            candidates = rows ?? [];
          }
        } catch (candidateError) {
          console.warn('[manage-ci-assessments] candidates unreadable:', candidateError);
        }

        // What was read into each assessment, one row per document rather than
        // the payload's one entry per field. See `uploads.pure.ts`.
        const uploads = (assessments ?? []).flatMap(
          (row: Record<string, unknown>) => summariseUploads(String(row.id), row.provenance),
        );

        // The provenance array has done its job; it must not travel on to the
        // browser, where it would be an unbounded field-by-field payload.
        const assessmentRows = (assessments ?? []).map((row: Record<string, unknown>) => {
          const { provenance: _provenance, ...rest } = row;
          return rest;
        });

        return json({
          success: true,
          data: { client, assessments: assessmentRows, runs, renders, links, uploads, candidates },
        }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      case 'archive':
      case 'restore': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        const archiving = body.operation === 'archive';
        const { data, error } = await supabase
          .from('commercial_industrial_assessments')
          .update({
            archived_at: archiving ? new Date().toISOString() : null,
            status: archiving ? 'archived' : (existing.client_id ? 'linked' : 'draft'),
            updated_by: userId,
            version: Number(existing.version) + 1,
          })
          .eq('id', existing.id)
          .eq('user_id', userId)
          .select()
          .single();
        if (error) throw error;

        await writeAudit(existing.id, archiving ? 'assessment_archived' : 'assessment_restored', {});
        return json({ success: true, data }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      case 'audit': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        const { data, error } = await supabase
          .from('commercial_industrial_assessment_audit_events')
          .select('id, event_type, detail, actor_id, created_at')
          .eq('assessment_id', existing.id)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(200);
        if (error) throw error;
        return json({ success: true, data }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      default:
        return fail(`Unknown operation: ${body.operation}`, 400, corsHeaders, 'UNKNOWN_OPERATION');
    }
  } catch (err) {
    // Log the detail server-side; return a generic message so a database error
    // never leaks schema or row detail to the browser.
    console.error('[manage-ci-assessments] request failed', body.operation, err);
    return fail('Assessment request failed', 500, corsHeaders, 'INTERNAL_ERROR');
  }
});
