/**
 * Cookie-authenticated data gateway (ES256 remediation).
 *
 * ## Why this exists
 *
 * `_shared/jwt.ts` mints HS256 tokens signed with `JWT_SECRET`. Both Supabase
 * projects moved to ES256 signing keys (JWKS publishes ES256; the HS256 key is
 * `previously_used`), so those tokens are rejected. The browser therefore holds
 * no usable RLS token, `clientForToken(null)` sends no Authorization header at
 * all, and every direct PostgREST query from the 16 affected modules runs as
 * `anon` against tables whose RLS is enabled — silently returning empty instead
 * of failing.
 *
 * The fix is not to re-sign tokens. It is to stop the browser needing one: the
 * browser keeps its existing secure custom-session cookie, and protected reads
 * and writes come through here, where the session is verified and authority is
 * resolved server-side.
 *
 * ## What this is NOT
 *
 * It is not a generic service-role proxy. A generic proxy would hand every
 * caller full service-role authority and delete RLS as a control. Instead each
 * table is listed explicitly below with the authority rule that its RLS policy
 * already expresses, and anything not listed is refused. Adding a table here is
 * a deliberate, reviewable act.
 *
 * ## The rules, taken from the live policies
 *
 *   - module permission  -> `requireModulePermission`, the same primitive every
 *     other Edge Function uses. Mirrors `current_user_can_view/edit/delete(...)`.
 *   - owner scoped       -> a mandatory server-side filter on the owning column,
 *     appended to whatever the caller sent. PostgREST ANDs repeated filters, so
 *     a caller cannot widen it.
 *   - staff role         -> membership of `user_roles` in the named roles.
 *
 * ## Deliberately excluded
 *
 *   - `email_copilot_emails`: its SELECT policy is a four-branch predicate over
 *     `clients.created_by`, `created_by`, `owner_user_id`, `mailbox_source` and
 *     null-ness. Reproducing that as filters would be an approximation, and an
 *     approximation of an access rule is a security defect. It stays on its
 *     existing path until it is modelled properly.
 *   - `agency_agreements`: RLS is enabled with ZERO policies, so it is deny-all
 *     except service-role. Routing it through here would silently grant access
 *     that no policy ever authorised. It needs an intended rule first.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';

type Action = 'can_view' | 'can_edit' | 'can_delete';

interface TableRule {
  /** Module permission required, mirroring current_user_can_*(). */
  module?: string;
  /** Column that must equal the resolved user id. Applied as a mandatory filter. */
  ownerColumn?: string;
  /**
   * Column stamped with the caller on INSERT only.
   *
   * Unlike `ownerColumn` this is not an access rule: it does not narrow reads,
   * and — the reason it is a separate field — it is not rewritten on UPDATE.
   * `created_by` records who made the row, and a colleague saving an edit must
   * not become its author.
   */
  insertOwnerColumn?: string;
  /** Reads allowed to any verified session (policy is `true`). */
  openRead?: boolean;
  /** Staff roles permitted, checked against user_roles. */
  roles?: string[];
  /**
   * A mandatory PostgREST filter expression reproducing a policy that is more
   * than a single owner column. Built per-request because some branches need a
   * server-side lookup first. Appended like any other mandatory filter, so the
   * caller cannot widen it.
   */
  buildFilter?: (admin: SupabaseClientLike, userId: string) => Promise<string>;
}

/** The narrow slice of the client surface this module uses. */
type SupabaseClientLike = ReturnType<typeof createClient>;

/**
 * `email_copilot_emails` — the complete SELECT/UPDATE/DELETE predicate, branch
 * for branch, from the live policy:
 *
 *   (client_id IS NOT NULL AND EXISTS (SELECT 1 FROM clients c
 *        WHERE c.id = client_id AND c.created_by::text = auth.uid()::text))
 *   OR created_by    = auth.uid()
 *   OR owner_user_id = auth.uid()
 *   OR (client_id IS NULL AND (mailbox_source IS DISTINCT FROM 'personal'
 *        OR (owner_user_id IS NULL AND created_by IS NULL)))
 *
 * The EXISTS branch is resolved first into the set of client ids this user
 * created, because PostgREST cannot express a correlated EXISTS inside an OR.
 * Note `IS DISTINCT FROM 'personal'` is true for NULL, so that branch is
 * `mailbox_source.is.null` OR `mailbox_source.neq.personal` — `neq` alone would
 * silently drop NULL rows and narrow the rule.
 */
async function emailCopilotFilter(admin: SupabaseClientLike, userId: string): Promise<string> {
  const { data: owned } = await admin.from('clients').select('id').eq('created_by', userId);
  const ids = (owned ?? []).map((c: { id: string }) => c.id);

  const branches = [
    `created_by.eq.${userId}`,
    `owner_user_id.eq.${userId}`,
    'and(client_id.is.null,or(mailbox_source.is.null,mailbox_source.neq.personal,'
      + 'and(owner_user_id.is.null,created_by.is.null)))',
  ];
  if (ids.length) branches.unshift(`and(client_id.not.is.null,client_id.in.(${ids.join(',')}))`);
  return `or=(${branches.join(',')})`;
}

/** Every table reachable through this gateway. Absent table => refused. */
const TABLES: Record<string, TableRule> = {
  charts:                  { module: 'charts' },
  depreciation_comps:      { module: 'depreciation_comps' },
  generated_reports:       { module: 'generated_reports' },
  global_report_settings:  { module: 'settings', openRead: true },
  whitelabel_settings:     { module: 'white_label', openRead: true },
  chart_configurations:    { openRead: true, module: 'charts' },
  template_components:     { module: 'templates', ownerColumn: 'created_by', openRead: true },
  template_comments:       { ownerColumn: 'author_id', openRead: true },
  // `created_by` is stamped on creation because a workflow dispatched by a
  // captured event has no operator: it is the recorded author whose authority
  // its steps run under, and whom a notification falls back to. A workflow with
  // no author can still be built and test-run; it just cannot address anyone
  // when it runs unattended, and the step says so.
  workflows:               { roles: ['superadmin', 'admin'], insertOwnerColumn: 'created_by' },
  workflow_runs:           { roles: ['superadmin', 'admin'] },
  workflow_run_steps:      { roles: ['superadmin', 'admin'] },
  workflow_trigger_events: { roles: ['superadmin', 'admin'] },

  // Full ownership predicate, every branch — see emailCopilotFilter.
  email_copilot_emails:    { module: 'email_copilot', buildFilter: emailCopilotFilter },

  /*
   * Two report formats whose records the browser cannot see, for reasons that
   * have nothing to do with what their policies intend.
   *
   * `marketing_intelligence_reports` grants SELECT to `authenticated` with
   * `USING (true)`, and `report_qa_conversations` / `_messages` to PUBLIC with
   * `USING (true)` — but this app's identity is a custom HttpOnly cookie, so
   * the browser client is anon, and the Q&A tables have had their table-level
   * GRANT to anon revoked on top (`42501 permission denied`). Measured
   * 2026-08-16: 0 of 6 market intelligence reports and 0 of 253 Q&A
   * conversations were readable, and both formats had rendered no
   * design-system document at all.
   *
   * `openRead: true` is what those policies already say — any verified session
   * may read — so this reproduces the intended rule rather than widening it.
   * For the Q&A tables it is strictly narrower: their policy is PUBLIC, and a
   * verified session is not. The module on each is that format's own
   * (`marketing_analytics`, `report_qa`), which gates writes; reads are exempt
   * under `openRead` precisely because the policy being reproduced does not
   * gate them either.
   */
  marketing_intelligence_reports: { module: 'marketing_analytics', openRead: true },
  report_qa_conversations:        { module: 'report_qa', openRead: true },
  report_qa_messages:             { module: 'report_qa', openRead: true },

  /*
   * The report-structure guides the Investment adapter reads to line its
   * `sections.*` ids up with the Cascade contract.
   *
   * SELECT is `auth.role() = 'authenticated'` and every write policy is
   * admin/superadmin, so the rule is both halves of that: open to any verified
   * session for reads, and the two roles for writes. Reading it as the browser
   * client returned 0 of the 4 published guides for every user.
   */
  report_structure_templates: { roles: ['superadmin', 'admin'], openRead: true },

  /**
   * `agency_agreements` carries RLS with ZERO policies, i.e. deny-all except
   * service-role, so the feature is broken for everyone today. Any rule is a
   * widening, so this is the narrowest one that makes the feature work at all:
   * the `agreements` module permission AND rows the caller created.
   *
   * Deliberately NOT team- or client-wide. If agreements need to be visible to
   * colleagues, that is a product decision and a policy, not something to infer
   * here — widening later is safe, narrowing after release is not.
   */
  agency_agreements:       { module: 'agreements', ownerColumn: 'created_by' },

  /*
   * Agreement blueprint catalogue for the Gamma send flow. RLS-W2 scoped every
   * verb to `authenticated` — but this app's browser client is anon (custom
   * HttpOnly cookie identity), so both the Agreements page's template manager
   * and the Send Agreement dialog's template picker read zero rows and the
   * picker never rendered. Reads reproduce the open-to-any-verified-session
   * policy; writes additionally require the agreements module, which is the
   * page the manager lives on.
   */
  gamma_agreement_templates: { module: 'agreements', openRead: true },

  /*
   * The client tag vocabulary and the assignments that attach it to a client.
   *
   * Reported as "add a tag says: new row violates row-level security policy for
   * table client_tags". It was the whole feature, not one button: the RLS-W2
   * hardening pass scoped every verb on both tables to `service_role`, and this
   * app's browser identity is a custom HttpOnly cookie, so the client is anon.
   * Anon SELECT is FILTERED rather than refused, so the tag list came back `[]`
   * and read as "no tags exist"; the INSERT is the one verb that says so out
   * loud, which is why that is the half that got reported.
   *
   * A `TO authenticated` policy would NOT have fixed it. It would deploy
   * cleanly, read like a fix and change nothing at all, because the browser is
   * never `authenticated` here — the exact shape of failure this gateway's
   * header was written about.
   *
   * The rule is the one the product owner authorised: **any verified staff
   * session** may read the vocabulary, create a tag and assign one. So no
   * module and no role — deliberately, and it is still strictly narrower than
   * what these tables shipped with (`FOR ALL USING (true)`, reachable by anon),
   * because it requires a verified session and an allow-listed origin.
   * Authorship is recorded on creation and never rewritten, so the register
   * says who introduced a tag and who attached it.
   */
  client_tags:             { insertOwnerColumn: 'created_by' },
  client_tag_assignments:  { insertOwnerColumn: 'assigned_by' },
};

const READ_METHODS = new Set(['GET', 'HEAD']);

function actionFor(method: string): Action {
  if (READ_METHODS.has(method)) return 'can_view';
  if (method === 'DELETE') return 'can_delete';
  return 'can_edit';
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const cors = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  // Cookie-authenticated mutations must carry an allow-listed Origin.
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Identity comes only from the session cookie. Nothing in the body or query
  // string is trusted to name a user, a role or a tenant.
  const auth = await verifyAuth(admin, req.headers, {});
  if (auth.error || !auth.userId || auth.userId === 'service_role') {
    return json({ error: auth.error || 'Authentication required', code: 'auth_required' }, 401);
  }
  const userId = auth.userId;

  const url = new URL(req.url);
  const table = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const rule = TABLES[table];
  if (!rule) return json({ error: 'Resource not available through this gateway', table }, 404);

  const action = actionFor(req.method);
  const isRead = READ_METHODS.has(req.method);

  // `openRead` exempts reads here for the same reason it does below for the
  // module and the owner column: it marks a table whose SELECT policy is
  // genuinely open to any verified session, and a gateway stricter than the
  // policy it reproduces refuses rows Postgres would have returned. No table
  // declared both until `report_structure_templates`, whose reads are
  // `authenticated` and whose writes are admin-only.
  if (rule.roles && !(isRead && rule.openRead)) {
    const { data: roleRows } = await admin
      .from('user_roles').select('role').eq('user_id', userId);
    const held = new Set((roleRows ?? []).map((r: { role: string }) => r.role));
    if (!rule.roles.some((r) => held.has(r))) {
      return json({ error: 'Forbidden', code: 'role_required' }, 403);
    }
  }

  // `openRead` mirrors a policy of `true` for SELECT; writes still need the module.
  if (rule.module && !(isRead && rule.openRead)) {
    const permitted = await requireModulePermission(
      admin, { userId, authMethod: auth.authMethod ?? 'session' }, rule.module, action,
    );
    if (!permitted.ok) return json({ error: 'Forbidden', code: 'module_permission_required' }, 403);
  }

  // Rebuild the PostgREST request. The caller's filters are preserved, then the
  // mandatory ownership filter is APPENDED — PostgREST ANDs repeated params, so
  // a caller cannot widen its own scope by sending a competing filter.
  const target = new URL(`${Deno.env.get('SUPABASE_URL')}/rest/v1/${table}`);
  url.searchParams.forEach((v, k) => target.searchParams.append(k, v));

  // Owner scoping applies to reads as well as writes. The only exception is a
  // table whose SELECT policy is genuinely `true` (openRead) — there the owner
  // column still constrains writes but must not narrow reads, or the gateway
  // would be stricter than the policy it is reproducing.
  if (rule.ownerColumn && !(isRead && rule.openRead)) {
    target.searchParams.append(rule.ownerColumn, `eq.${userId}`);
  }

  // A multi-branch policy contributes its own mandatory filter.
  if (rule.buildFilter) {
    const expr = await rule.buildFilter(admin, userId);
    const eq = expr.indexOf('=');
    target.searchParams.append(expr.slice(0, eq), expr.slice(eq + 1));
  }

  const forwardHeaders: Record<string, string> = {
    apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
    'Content-Type': req.headers.get('content-type') ?? 'application/json',
  };
  for (const h of ['prefer', 'range', 'range-unit', 'accept', 'accept-profile', 'content-profile']) {
    const v = req.headers.get(h);
    if (v) forwardHeaders[h] = v;
  }

  // A write that sets the owning column must set it to the caller, never to a
  // value the browser chose.
  let body: string | undefined;
  if (!isRead && req.body) {
    const raw = await req.text();
    // `ownerColumn` is stamped on every write it governs; `insertOwnerColumn`
    // only on creation, so an edit by a colleague does not reassign authorship.
    const stampColumn = rule.ownerColumn
      ?? (req.method === 'POST' ? rule.insertOwnerColumn : undefined);
    if (raw && stampColumn) {
      try {
        const parsed = JSON.parse(raw);
        const stamp = (row: Record<string, unknown>) => ({ ...row, [stampColumn]: userId });
        body = JSON.stringify(Array.isArray(parsed) ? parsed.map(stamp) : stamp(parsed));
      } catch { body = raw; }
    } else {
      body = raw;
    }
  }

  const upstream = await fetch(target.toString(), { method: req.method, headers: forwardHeaders, body });
  const text = await upstream.text();
  const out = new Headers(cors);
  for (const h of ['content-type', 'content-range', 'content-location', 'prefer-applied']) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(text, { status: upstream.status, headers: out });
});
