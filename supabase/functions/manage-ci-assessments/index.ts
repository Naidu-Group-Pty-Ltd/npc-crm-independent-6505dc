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
//   search_clients | create_client | link_client | unlink_client
//   client_workspace | intended_client
//   archive | restore | deletion_preview | delete | audit
//   list_documents | documents_library | client_documents | document_url
//   record_template_document
//
// Client association is deliberately a separate, explicit operation. Nothing
// else in this file writes a client_id. The client an assessment was *started
// for* is recorded as an audit event (`client_intended`), never as a link — see
// the `create` and `intended_client` operations.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { summariseUploads } from '../_shared/ciAssessments/uploads.pure.ts';
import {
  decideDeletion, deletionNeedsTypedConfirmation, statusAfterRestore, type RenderFact,
} from '../_shared/ciAssessments/deletion.pure.ts';
import { clientSearchFilters, newClientProblem, sameEmail } from '../_shared/ciAssessments/clientRecords.pure.ts';
import { REGISTER_PROPERTY_ID_PATH, isUuid } from '../_shared/ciAssessments/registerLink.pure.ts';
import {
  DOCUMENT_LINK_TTL_SECONDS,
  FALLBACK_DOCUMENT_FILE_NAME,
  clientLinkedAt,
  documentStorage,
  documentsForClient,
  isDocumentLedger,
  isGenuineTemplateJob,
  labelDocuments,
  mayReadDocument,
  projectIssuedDocuments,
  templateJobAssessmentId,
  type CapacityRenderRow,
  type ClientLinkRow,
  type TemplateJobRow,
} from '../_shared/ciAssessments/documents.pure.ts';

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
  | 'client_workspace' | 'intended_client'
  | 'archive' | 'restore' | 'deletion_preview' | 'delete' | 'audit'
  | 'list_documents' | 'documents_library' | 'client_documents' | 'document_url' | 'record_template_document';

/**
 * The module whose `can_delete` permission governs deleting an assessment.
 *
 * `commercial` is the key every Commercial & Industrial route is guarded by
 * (`ModuleGuard moduleKey="commercial"`), so the authority to delete is granted
 * where the authority to open the module already is. Superadmins pass inside
 * `requireModulePermission`; a lookup that fails refuses.
 */
const DELETE_PERMISSION_MODULE = 'commercial';

/**
 * What the document readers select from each ledger — the columns
 * `documents.pure.ts` reads, and no more. `storage_path` travels to the
 * projection (it decides `downloadable`) and never to the browser.
 */
const RENDER_DOCUMENT_COLUMNS =
  'id, assessment_id, status, file_name, storage_bucket, storage_path, bytes, page_count, has_analysis, analysis_note, error, created_at';
const TEMPLATE_DOCUMENT_COLUMNS =
  'id, status, file_name, storage_path, bytes, page_count, template_name, error, created_at, requested_by, metadata';
const LINK_HISTORY_COLUMNS = 'assessment_id, client_id, linked_at, unlinked_at';

/** Assessment ids per ledger query, and rows per batch. */
const LEDGER_ID_BATCH = 50;
const LEDGER_ROWS_PER_BATCH = 500;

/** How many of the caller's assessments Generated Reports reads documents for. */
const DOCUMENT_LIBRARY_ASSESSMENTS = 500;

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
  /** `create_client` — read at the operation, and now declared where it is read. */
  firstName?: string;
  surname?: string;
  email?: string;
  mobile?: string;
  /** `create` — the existing client the assessment is being prepared for. */
  intendedClientId?: string;
  /** `list` — only assessments started from this property-register entry. */
  propertyId?: string;
  /** `delete` — the reference, typed back, for a completed assessment. */
  confirmReference?: string;
  /** `document_url` — which ledger recorded the document, and its row. */
  ledger?: string;
  documentId?: string;
  /** `record_template_document` — where `render-template-pdf` stored the file. */
  storagePath?: string;
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

  /**
   * A missing relation, as PostgREST and Postgres each report it.
   *
   * PostgREST refuses a relation absent from its schema cache before the
   * statement is planned, so the wire answer is `PGRST205`, not the Postgres
   * `42P01` — see CLAUDE.md on why both spellings are accepted.
   */
  const isMissingRelation = (error: { code?: string } | null | undefined) => (
    error?.code === 'PGRST205' || error?.code === '42P01'
  );

  /**
   * The facts `decideDeletion` rules on, read fresh for this request.
   *
   * A read that FAILED is not a row that is ABSENT: any error throws, and the
   * request refuses rather than deleting on the strength of a query that did
   * not answer. The one exception is a render ledger that does not exist on
   * this deployment yet — a table that is not there holds no renders, and its
   * foreign key cannot refuse the delete either.
   */
  async function gatherDeletionFacts(existing: Record<string, any>) {
    const [links, renders, templateJobs, runs, scenarios] = await Promise.all([
      supabase
        .from('commercial_industrial_assessment_client_links')
        .select('id', { count: 'exact', head: true })
        .eq('assessment_id', existing.id),
      supabase
        .from('commercial_industrial_report_renders')
        .select('status, created_at')
        .eq('assessment_id', existing.id)
        .limit(200),
      // A document drawn through a report template is recorded here, with the
      // assessment named in metadata and no foreign key to refuse anything.
      supabase
        .from('template_render_jobs')
        .select('status, created_at')
        .eq('mode', 'final')
        .eq('metadata->>report_id', existing.id)
        .limit(200),
      supabase
        .from('commercial_industrial_calculation_runs')
        .select('id', { count: 'exact', head: true })
        .eq('assessment_id', existing.id),
      supabase
        .from('commercial_industrial_assessment_scenarios')
        .select('id', { count: 'exact', head: true })
        .eq('assessment_id', existing.id),
    ]);
    if (links.error) throw links.error;
    if (runs.error) throw runs.error;
    if (scenarios.error) throw scenarios.error;
    if (renders.error && !isMissingRelation(renders.error)) throw renders.error;
    if (templateJobs.error && !isMissingRelation(templateJobs.error)) throw templateJobs.error;

    const toFact = (ledger: RenderFact['ledger']) => (row: { status: unknown; created_at: unknown }): RenderFact => ({
      status: String(row.status ?? ''),
      createdAt: String(row.created_at ?? ''),
      ledger,
    });

    return {
      facts: {
        status: String(existing.status),
        clientId: (existing.client_id as string | null) ?? null,
        clientLinkCount: links.count ?? 0,
        renders: [
          ...(renders.error ? [] : (renders.data ?? []).map(toFact('capacity_report'))),
          ...(templateJobs.error ? [] : (templateJobs.data ?? []).map(toFact('template'))),
        ],
      },
      counts: {
        calculationRuns: runs.count ?? 0,
        scenarios: scenarios.count ?? 0,
      },
    };
  }

  /**
   * Whether this caller may delete assessments at all.
   *
   * Where an administrator manages per-user permissions for the module, delete
   * is the `can_delete` they granted (superadmins pass). Where the deployment
   * manages none — no `dashboard_modules` row for it, so the module is opened by
   * the plan alone, exactly as `ModuleGuard` opens it — the owner may delete
   * their own assessments, which is who may already archive them. Ownership is
   * enforced either way: every assessment this function touches is the
   * caller's own.
   *
   * A permission lookup that throws is a refusal, never a pass.
   */
  async function mayDelete(): Promise<boolean> {
    try {
      const decision = await requireModulePermission(supabase, auth, DELETE_PERMISSION_MODULE, 'can_delete');
      return decision.ok || decision.reason_code === 'module_not_registered';
    } catch {
      return false;
    }
  }

  /**
   * The client an assessment was prepared for: the client chosen when it was
   * started, or created from inside it, whichever happened last. Null when
   * neither did.
   *
   * Read from the audit trail on purpose. It is the record of a decision, and
   * it must never be mistaken for the link — only `link_client` writes one.
   */
  async function latestClientIntent(assessmentId: string) {
    const { data, error } = await supabase
      .from('commercial_industrial_assessment_audit_events')
      .select('event_type, detail, created_at')
      .eq('assessment_id', assessmentId)
      .in('event_type', ['client_intended', 'client_created'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const clientId = (data?.detail as Record<string, unknown> | null)?.clientId;
    if (!data || typeof clientId !== 'string') return null;
    return {
      clientId,
      source: data.event_type === 'client_created' ? 'created' as const : 'intended' as const,
      recordedAt: String(data.created_at),
    };
  }

  /**
   * Both report ledgers, and the link history, for a set of assessments.
   *
   * `scope` names each assessment's OWNER, because a template job counts only
   * when the owner requested it (`isGenuineTemplateJob`). The ids are read in
   * batches so a long list cannot grow a request URL past what the gateway
   * accepts.
   *
   * A ledger table missing from this deployment holds no documents, and says so
   * by being empty rather than by taking the page down. Any other failed read
   * throws: a failed read is not an empty ledger, and reporting "no documents"
   * for an assessment that has them is the answer this module exists to stop.
   */
  async function readDocumentLedgers(scope: ReadonlyArray<{ id: string; userId: string }>) {
    const owners = new Map(scope.map((row) => [row.id, row.userId]));
    const ids = [...owners.keys()];
    if (!ids.length) {
      return { renders: [] as CapacityRenderRow[], templateJobs: [] as TemplateJobRow[], links: [] as ClientLinkRow[] };
    }
    const batches: string[][] = [];
    for (let at = 0; at < ids.length; at += LEDGER_ID_BATCH) batches.push(ids.slice(at, at + LEDGER_ID_BATCH));

    const [renderPages, jobPages, linkPages] = await Promise.all([
      Promise.all(batches.map((batch) => supabase
        .from('commercial_industrial_report_renders')
        .select(RENDER_DOCUMENT_COLUMNS)
        .in('assessment_id', batch)
        .order('created_at', { ascending: false })
        .limit(LEDGER_ROWS_PER_BATCH))),
      Promise.all(batches.map((batch) => supabase
        .from('template_render_jobs')
        .select(TEMPLATE_DOCUMENT_COLUMNS)
        .eq('mode', 'final')
        .in('metadata->>report_id', batch)
        .order('created_at', { ascending: false })
        .limit(LEDGER_ROWS_PER_BATCH))),
      Promise.all(batches.map((batch) => supabase
        .from('commercial_industrial_assessment_client_links')
        .select(LINK_HISTORY_COLUMNS)
        .in('assessment_id', batch)
        .limit(LEDGER_ROWS_PER_BATCH))),
    ]);

    const rowsOf = <T>(
      pages: ReadonlyArray<{ data: unknown; error: { code?: string; message?: string } | null }>,
      optional: boolean,
    ): T[] => {
      const rows: T[] = [];
      for (const page of pages) {
        if (page.error) {
          if (optional && isMissingRelation(page.error)) continue;
          throw page.error;
        }
        rows.push(...((page.data ?? []) as T[]));
      }
      return rows;
    };

    const templateJobs = rowsOf<TemplateJobRow>(jobPages, true).filter((job) => {
      const assessmentId = templateJobAssessmentId(job);
      const owner = assessmentId ? owners.get(assessmentId) : undefined;
      return Boolean(assessmentId && owner && isGenuineTemplateJob(job, { id: assessmentId, userId: owner }));
    });

    return {
      renders: rowsOf<CapacityRenderRow>(renderPages, true),
      templateJobs,
      links: rowsOf<ClientLinkRow>(linkPages, false),
    };
  }

  /**
   * Every document drawn for ONE client, from both report ledgers.
   *
   * Reading documents through the assessments linked NOW moved a client's
   * history to whichever client an assessment was relinked to, while each PDF
   * still names the first (G7), and never saw a document drawn through a report
   * template (G4). This follows the link history instead: an assessment linked
   * to this client at any time contributes the documents drawn WHILE it was,
   * and nothing drawn for anybody else.
   *
   * `linkedNow` saves a read for the assessments the caller already has;
   * `history` is the client's link rows, current and closed.
   */
  async function documentsForClientRecord(
    clientId: string,
    linkedNow: ReadonlyArray<Record<string, any>>,
    history: ReadonlyArray<{ assessment_id: string }>,
  ) {
    const known = new Map<string, Record<string, any>>(linkedNow.map((row) => [String(row.id), row]));
    const everLinked = [...new Set([...known.keys(), ...history.map((row) => row.assessment_id)])];
    const missing = everLinked.filter((id) => !known.has(id));
    for (let at = 0; at < missing.length; at += LEDGER_ID_BATCH) {
      const { data: moved, error: movedError } = await supabase
        .from('commercial_industrial_assessments')
        .select('id, user_id, reference, title')
        .in('id', missing.slice(at, at + LEDGER_ID_BATCH));
      if (movedError) throw movedError;
      for (const row of (moved ?? []) as Array<Record<string, any>>) known.set(String(row.id), row);
    }
    const scope = everLinked
      .map((id) => known.get(id))
      .filter((row): row is Record<string, any> => Boolean(row))
      .map((row) => ({ id: String(row.id), userId: String(row.user_id), reference: row.reference, title: row.title }));
    const ledgers = await readDocumentLedgers(scope);
    return labelDocuments(documentsForClient(projectIssuedDocuments(ledgers), clientId), scope);
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
        // The assessments started from one property-register entry — what the
        // property's own page lists. See `registerLink.pure.ts` for why the
        // link lives inside the payload's property section.
        if (body.propertyId != null && body.propertyId !== '') {
          if (!isUuid(body.propertyId)) return fail('propertyId is not valid', 400, corsHeaders, 'INVALID_PROPERTY');
          query = query.eq(REGISTER_PROPERTY_ID_PATH, body.propertyId);
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

        // The client the assessment is being prepared for, when one was named.
        // Checked before anything is written: a client this caller cannot
        // reach is refused, not recorded. This is an intent, not a link — the
        // link is still made on the final step, after reconciliation.
        let intendedClientId: string | null = null;
        if (body.intendedClientId != null && body.intendedClientId !== '') {
          if (!isUuid(body.intendedClientId)) {
            return fail('intendedClientId is not valid', 400, corsHeaders, 'INVALID_CLIENT');
          }
          const client = await loadReachableClient(body.intendedClientId);
          if (!client) return fail('Client not found', 404, corsHeaders, 'CLIENT_NOT_FOUND');
          intendedClientId = body.intendedClientId;
        }

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
        if (intendedClientId) {
          await writeAudit(data.id, 'client_intended', { clientId: intendedClientId, source: 'new_assessment' });
        }
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
        //
        // One condition per word, all of which must hold, so "Marcus Chen"
        // finds Marcus Chen — the whole string matched against one field at a
        // time found nobody, and an adviser who cannot find a client creates
        // them again. See `clientRecords.pure.ts`.
        for (const filter of clientSearchFilters(String(body.search ?? ''))) {
          query = query.or(filter);
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

        // Both names, because `clients` stores both as NOT NULL. This used to
        // accept either and write `null` into the other, so a single-name
        // client failed as an opaque 500 after the form had accepted it.
        const problem = newClientProblem({ firstName, surname, email });
        if (problem) return fail(problem.message, 400, corsHeaders, problem.code);

        // Duplicate guard on exact email: creating "the same client twice"
        // from the linking step is the likeliest mistake this screen invites.
        //
        // The database narrows the candidates (`ilike`, where `_` is a
        // wildcard) and `sameEmail` decides, so a near-miss never blocks.
        // The book is checked whole, because a duplicate is a duplicate
        // whoever it belongs to — but the existing record is only NAMED to a
        // caller who may reach it. Anyone else is told what to do rather than
        // to search for somebody their search can never show them.
        if (email) {
          const { data: candidates, error: dupError } = await supabase
            .from('clients')
            .select('id, primary_email')
            .ilike('primary_email', email)
            .limit(10);
          if (dupError) throw dupError;
          const duplicate = (candidates ?? []).find((row: { primary_email: string | null }) => sameEmail(row.primary_email, email));
          if (duplicate) {
            const reachable = await loadReachableClient(
              String(duplicate.id),
              'id, primary_first_name, primary_surname, primary_email, primary_mobile, updated_at',
            );
            if (reachable) {
              return json({
                success: false,
                code: 'DUPLICATE_EMAIL',
                error: 'A client with this email address already exists. Use their existing record instead.',
                existingClient: reachable,
              }, 409, corsHeaders);
            }
            return fail(
              'A client with this email address is already in the client book, but not one assigned to you. '
                + 'Ask an administrator to assign them to you, then link them here.',
              409, corsHeaders, 'DUPLICATE_EMAIL_UNREACHABLE',
            );
          }
        }

        const { data: created, error: createError } = await supabase
          .from('clients')
          .insert({
            primary_first_name: firstName,
            primary_surname: surname,
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

        // A link is one open row. Relinking is reachable only through the API
        // (the workspace unlinks first), and it used to leave the previous row
        // open — a history showing one assessment linked to two clients at
        // once. Close whatever is open before opening the new one.
        const { error: closeError } = await supabase
          .from('commercial_industrial_assessment_client_links')
          .update({ unlinked_by: userId, unlinked_at: new Date().toISOString() })
          .eq('assessment_id', existing.id)
          .is('unlinked_at', null);
        if (closeError) throw closeError;

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
        // Unlinking writes `completed` below, which on an archived assessment
        // would leave it `completed` while still carrying `archived_at`.
        if (existing.status === 'archived') {
          return fail('An archived assessment cannot be unlinked. Restore it first.', 409, corsHeaders, 'NOT_EDITABLE');
        }

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
        } else {
          // Nothing is linked now, but something may have been: the documents
          // below follow the link HISTORY, so it is read either way.
          const { data: historic, error: historicError } = await supabase
            .from('commercial_industrial_assessment_client_links')
            .select('id, assessment_id, linked_at, unlinked_at, applied_changes')
            .eq('client_id', body.clientId)
            .order('linked_at', { ascending: false })
            .limit(100);
          if (historicError) throw historicError;
          links = historic ?? [];
        }

        // `renders` above is the legacy reading — the direct route's rows for
        // the assessments linked NOW — kept only because a frontend published
        // before this server still reads it. `documents` is the one to read.
        const documents = await documentsForClientRecord(
          body.clientId,
          (assessments ?? []) as Array<Record<string, any>>,
          links as Array<{ assessment_id: string }>,
        );

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
            // Created from an assessment's own linking step, or named as the
            // client an assessment was started for.
            supabase
              .from('commercial_industrial_assessment_audit_events')
              .select('assessment_id')
              .in('event_type', ['client_created', 'client_intended'])
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
          data: { client, assessments: assessmentRows, runs, renders, documents, links, uploads, candidates },
        }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      case 'archive':
      case 'restore': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        const archiving = body.operation === 'archive';
        // Idempotent: archiving an archived assessment would record `archived`
        // as the status to restore to, and restoring a live one has nothing
        // to undo.
        const isArchived = existing.status === 'archived' || Boolean(existing.archived_at);
        if (archiving === isArchived) return json({ success: true, data: existing }, 200, corsHeaders);

        // Restore returns to the status held before archiving. It used to set
        // `draft` for every unlinked assessment, so a completed assessment that
        // was archived and restored lost its completion — and its report —
        // without a word. See `statusAfterRestore`.
        let nextStatus = 'archived';
        if (!archiving) {
          const { data: archivedEvent, error: eventError } = await supabase
            .from('commercial_industrial_assessment_audit_events')
            .select('detail')
            .eq('assessment_id', existing.id)
            .eq('event_type', 'assessment_archived')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (eventError) throw eventError;
          nextStatus = statusAfterRestore({
            recordedStatus: (archivedEvent?.detail as Record<string, unknown> | null)?.previousStatus,
            clientId: existing.client_id ?? null,
            currentCalculationId: existing.current_calculation_id ?? null,
          });
        }

        const { data, error } = await supabase
          .from('commercial_industrial_assessments')
          .update({
            archived_at: archiving ? new Date().toISOString() : null,
            status: nextStatus,
            updated_by: userId,
            version: Number(existing.version) + 1,
          })
          .eq('id', existing.id)
          .eq('user_id', userId)
          .select()
          .single();
        if (error) throw error;

        await writeAudit(
          existing.id,
          archiving ? 'assessment_archived' : 'assessment_restored',
          archiving ? { previousStatus: existing.status } : { restoredStatus: nextStatus },
        );
        return json({ success: true, data }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // The client an assessment is being prepared for, before it is linked.
      //
      // Returns the client only where the caller may reach them. The link step
      // uses this to start where the adviser left off — the client named when
      // the assessment was started, or created from its intake step — instead
      // of asking them to search again for somebody they already chose.
      case 'intended_client': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        const intent = await latestClientIntent(existing.id);
        if (!intent) return json({ success: true, data: null }, 200, corsHeaders);
        const client = await loadReachableClient(
          intent.clientId,
          'id, primary_first_name, primary_surname, primary_email, primary_mobile, updated_at',
        );
        return json({
          success: true,
          data: { clientId: intent.clientId, source: intent.source, recordedAt: intent.recordedAt, client: client ?? null },
        }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // Whether an assessment may be deleted, and what deleting it removes.
      //
      // The dialog asks this before it offers the button, so a refusal is a
      // sentence with a reason and an alternative rather than a failed click.
      // The same facts are gathered again by `delete` itself — this answer is
      // advice, and the delete is the authority.
      case 'deletion_preview': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        const [{ facts, counts }, permitted] = await Promise.all([gatherDeletionFacts(existing), mayDelete()]);
        const verdict = decideDeletion(facts);
        return json({
          success: true,
          data: {
            ...verdict,
            permitted,
            typedConfirmation: deletionNeedsTypedConfirmation(String(existing.status)),
            reference: existing.reference,
            title: existing.title,
            status: existing.status,
            counts,
          },
        }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // Permanently delete an assessment.
      //
      // Only the owner (every query here is scoped by user_id), only with
      // `can_delete` on the module, and only an assessment that never left its
      // owner's working set — never linked to a client, no report ever
      // requested from it. Everything else is refused with the reason and
      // archiving offered instead; see `deletion.pure.ts`. The database cascades
      // the calculation runs, scenarios, link history and audit trail, and its
      // own `ON DELETE RESTRICT` on the report ledger stands behind the check.
      case 'delete': {
        if (!body.assessmentId) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        if (!(await mayDelete())) {
          return fail(
            'You do not have permission to delete Commercial & Industrial assessments. Archive it instead, or ask an administrator.',
            403, corsHeaders, 'FORBIDDEN',
          );
        }

        const { facts, counts } = await gatherDeletionFacts(existing);
        const verdict = decideDeletion(facts);
        if (!verdict.allowed) {
          return json({
            success: false,
            code: 'DELETION_REFUSED',
            block: verdict.block,
            error: verdict.message,
            archiveOffered: verdict.archiveOffered,
          }, 409, corsHeaders);
        }

        if (
          deletionNeedsTypedConfirmation(String(existing.status))
          && String(body.confirmReference ?? '').trim().toUpperCase() !== String(existing.reference).toUpperCase()
        ) {
          return fail(
            `Type the reference ${existing.reference} to delete a completed assessment.`,
            400, corsHeaders, 'CONFIRMATION_REQUIRED',
          );
        }

        // Scoped by version as well as owner: an assessment that changed
        // between the checks above and this statement is not deleted.
        const { data: deleted, error: deleteError } = await supabase
          .from('commercial_industrial_assessments')
          .delete()
          .eq('id', existing.id)
          .eq('user_id', userId)
          .eq('version', existing.version)
          .select('id');
        if (deleteError) {
          // A report render began after the checks: the ledger's RESTRICT held,
          // which is the answer rather than a fault.
          if (deleteError.code === '23001' || deleteError.code === '23503') {
            return json({
              success: false,
              code: 'DELETION_REFUSED',
              block: 'report_requested',
              error: 'A report was requested from this assessment while it was being deleted, so it has been kept. '
                + 'Archive it instead.',
              archiveOffered: true,
            }, 409, corsHeaders);
          }
          throw deleteError;
        }
        if (!deleted || deleted.length === 0) {
          return json({
            success: false,
            code: 'VERSION_CONFLICT',
            error: 'This assessment changed while it was being deleted. Reload it and try again.',
          }, 409, corsHeaders);
        }

        // The assessment's own audit trail went with it, by design. The act of
        // deleting is recorded here, in the function log: `activity_logs`'
        // action vocabulary is a Postgres enum with no value for it, and what is
        // deleted is by construction a working draft that never reached a
        // client or a document.
        console.info('[manage-ci-assessments] assessment deleted', JSON.stringify({
          assessmentId: existing.id,
          reference: existing.reference,
          status: existing.status,
          segment: existing.segment,
          assessmentType: existing.assessment_type,
          calculationRuns: counts.calculationRuns,
          scenarios: counts.scenarios,
          deletedBy: userId,
          deletedAt: new Date().toISOString(),
        }));

        return json({ success: true, data: { id: existing.id, reference: existing.reference } }, 200, corsHeaders);
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
      // Every document this assessment has issued, from both report ledgers —
      // including the ones that failed, and why. See `documents.pure.ts`.
      case 'list_documents': {
        if (!isUuid(body.assessmentId)) return fail('assessmentId is required', 400, corsHeaders);
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        const ledgers = await readDocumentLedgers([{ id: existing.id, userId: existing.user_id }]);
        return json({ success: true, data: projectIssuedDocuments(ledgers) }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // Every document the caller's own assessments have issued — Generated
      // Reports' Commercial & Industrial tab. Scoped to the caller's
      // assessments, the rule every list in this module follows.
      case 'documents_library': {
        const { data: assessments, error: assessmentsError } = await supabase
          .from('commercial_industrial_assessments')
          .select('id, user_id, reference, title, status, segment, archived_at')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(DOCUMENT_LIBRARY_ASSESSMENTS);
        if (assessmentsError) throw assessmentsError;
        const rows = ((assessments ?? []) as Array<Record<string, any>>).map((row) => ({
          id: String(row.id), userId: String(row.user_id), reference: row.reference, title: row.title,
        }));

        const ledgers = await readDocumentLedgers(rows);
        const documents = labelDocuments(projectIssuedDocuments(ledgers), rows);

        // The name of the client each document was drawn for — only where this
        // caller may still reach that client. A document keeps its client
        // either way; a name the caller may no longer see is not sent.
        const clientIds = [...new Set(documents.map((doc) => doc.clientId).filter((id): id is string => Boolean(id)))];
        let clients: unknown[] = [];
        if (clientIds.length) {
          let query = supabase
            .from('clients')
            .select('id, primary_first_name, primary_surname')
            .in('id', clientIds.slice(0, 200));
          if (await resolveClientScope() === 'own') query = query.or(clientOwnershipFilter(userId));
          const { data: clientRows, error: clientError } = await query;
          if (clientError) throw clientError;
          clients = clientRows ?? [];
        }

        return json({ success: true, data: { documents, clients } }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // The documents drawn for one client — the client record's Reports tab.
      // Access follows the client, exactly as `client_workspace` does.
      case 'client_documents': {
        if (!isUuid(body.clientId)) return fail('clientId is required', 400, corsHeaders);
        const client = await loadReachableClient(body.clientId);
        if (!client) return fail('Client not found', 404, corsHeaders, 'CLIENT_NOT_FOUND');

        const [linkedRes, historyRes] = await Promise.all([
          supabase
            .from('commercial_industrial_assessments')
            .select('id, user_id, reference, title')
            .eq('client_id', body.clientId)
            .limit(100),
          supabase
            .from('commercial_industrial_assessment_client_links')
            .select('assessment_id')
            .eq('client_id', body.clientId)
            .limit(100),
        ]);
        if (linkedRes.error) throw linkedRes.error;
        if (historyRes.error) throw historyRes.error;

        const documents = await documentsForClientRecord(
          body.clientId,
          (linkedRes.data ?? []) as Array<Record<string, any>>,
          (historyRes.data ?? []) as Array<{ assessment_id: string }>,
        );
        return json({ success: true, data: documents }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // A short-lived link to one issued document's file.
      //
      // The owner may read any of their assessment's documents. Anyone else
      // only through a client they may reach, and only a document drawn while
      // the assessment was linked to that client (`mayReadDocument`). Anything
      // else is answered exactly as a document that does not exist.
      case 'document_url': {
        const ledger = body.ledger;
        if (!isUuid(body.assessmentId) || !isDocumentLedger(ledger) || !isUuid(body.documentId)) {
          return fail('assessmentId, ledger and documentId are required', 400, corsHeaders);
        }

        const { data: assessment, error: assessmentError } = await supabase
          .from('commercial_industrial_assessments')
          .select('id, user_id')
          .eq('id', body.assessmentId)
          .maybeSingle();
        if (assessmentError) throw assessmentError;
        if (!assessment) return fail('Document not found', 404, corsHeaders, 'NOT_FOUND');

        let row: (CapacityRenderRow | TemplateJobRow) | null = null;
        if (ledger === 'capacity_report') {
          const { data, error } = await supabase
            .from('commercial_industrial_report_renders')
            .select(RENDER_DOCUMENT_COLUMNS)
            .eq('id', body.documentId)
            .eq('assessment_id', assessment.id)
            .maybeSingle();
          if (error) throw error;
          row = (data as CapacityRenderRow | null) ?? null;
        } else {
          const { data, error } = await supabase
            .from('template_render_jobs')
            .select(TEMPLATE_DOCUMENT_COLUMNS)
            .eq('id', body.documentId)
            .eq('mode', 'final')
            .eq('metadata->>report_id', assessment.id)
            .maybeSingle();
          if (error) throw error;
          const job = (data as TemplateJobRow | null) ?? null;
          row = job && isGenuineTemplateJob(job, { id: assessment.id, userId: assessment.user_id }) ? job : null;
        }
        if (!row) return fail('Document not found', 404, corsHeaders, 'NOT_FOUND');

        const callerOwnsAssessment = assessment.user_id === userId;
        let allowed = callerOwnsAssessment;
        if (!allowed && isUuid(body.clientId)) {
          const client = await loadReachableClient(body.clientId);
          if (client) {
            const { data: links, error: linksError } = await supabase
              .from('commercial_industrial_assessment_client_links')
              .select(LINK_HISTORY_COLUMNS)
              .eq('assessment_id', assessment.id)
              .limit(LEDGER_ROWS_PER_BATCH);
            if (linksError) throw linksError;
            allowed = mayReadDocument({
              callerOwnsAssessment,
              viaClientId: body.clientId,
              clientReachable: true,
              documentClientId: clientLinkedAt((links ?? []) as ClientLinkRow[], assessment.id, row.created_at),
            });
          }
        }
        if (!allowed) return fail('Document not found', 404, corsHeaders, 'NOT_FOUND');

        const stored = documentStorage(ledger, row);
        if (!stored) {
          return fail('This document has no stored file to download.', 409, corsHeaders, 'NOT_DOWNLOADABLE');
        }
        const { data: signed, error: signError } = await supabase.storage
          .from(stored.bucket)
          .createSignedUrl(stored.path, DOCUMENT_LINK_TTL_SECONDS);
        if (signError || !signed?.signedUrl) {
          console.error('[manage-ci-assessments] document could not be signed', ledger, row.id, signError?.message);
          return fail('The stored document could not be fetched. Try again shortly.', 502, corsHeaders, 'STORAGE_UNAVAILABLE');
        }
        return json({
          success: true,
          data: {
            url: signed.signedUrl,
            fileName: row.file_name?.trim() || FALLBACK_DOCUMENT_FILE_NAME,
            expiresInSeconds: DOCUMENT_LINK_TTL_SECONDS,
          },
        }, 200, corsHeaders);
      }

      // ---------------------------------------------------------------------
      // The audit event for a document drawn through a report template.
      //
      // `render-commercial-capacity-pdf` writes `report_generated` itself; a
      // template render happens in a function that knows nothing of
      // assessments, so the app reports it here and this function checks the
      // report against the ledger before recording anything: the job must be a
      // finished FINAL render of THIS assessment, requested by its owner, at
      // the path the app names. Written once per job however often it is
      // reported.
      case 'record_template_document': {
        const storagePath = typeof body.storagePath === 'string' ? body.storagePath.trim() : '';
        if (!isUuid(body.assessmentId) || !storagePath) {
          return fail('assessmentId and storagePath are required', 400, corsHeaders);
        }
        const existing = await loadOwned(body.assessmentId);
        if (!existing) return fail('Assessment not found', 404, corsHeaders, 'NOT_FOUND');

        const { data: job, error: jobError } = await supabase
          .from('template_render_jobs')
          .select('id, status, file_name, template_name, page_count, requested_by, metadata')
          .eq('storage_path', storagePath)
          .eq('mode', 'final')
          .eq('requested_by', userId)
          .eq('metadata->>report_id', existing.id)
          .maybeSingle();
        if (jobError) throw jobError;
        if (!job || job.status !== 'succeeded') {
          return fail('No finished template document matches that file.', 404, corsHeaders, 'NOT_FOUND');
        }

        const { data: prior, error: priorError } = await supabase
          .from('commercial_industrial_assessment_audit_events')
          .select('id')
          .eq('assessment_id', existing.id)
          .eq('event_type', 'report_generated')
          .eq('detail->>templateJobId', job.id)
          .limit(1);
        if (priorError) throw priorError;
        if (!prior?.length) {
          await writeAudit(existing.id, 'report_generated', {
            route: 'template',
            templateJobId: job.id,
            fileName: job.file_name,
            templateName: job.template_name ?? null,
            pageCount: job.page_count ?? null,
            clientId: existing.client_id ?? null,
          });
        }
        return json({ success: true, data: { recorded: true } }, 200, corsHeaders);
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
