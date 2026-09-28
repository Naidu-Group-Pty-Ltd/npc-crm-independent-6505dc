import { extractSolicitorSessionCredential, validateSolicitorPortalHeaders } from './solicitorSessionToken.ts';
import { resolveHashedSolicitorSession } from './solicitorSessions.ts';

/**
 * Shared Solicitor Portal session resolution + permission merging.
 *
 * Every `solicitor-portal-*` edge function funnels through `resolveSolicitorSession`
 * so there is exactly ONE place that decides whether a caller is a valid,
 * non-revoked solicitor and what they are allowed to touch. Later phases
 * (matters, dates, documents) must not re-implement this.
 */

export interface SolicitorSessionUser {
  id: string;
  firm_id: string;
  email: string;
  name: string;
  phone: string | null;
  position: string | null;
  portal_role: string;
  must_change_password: boolean;
  has_accepted_terms: boolean;
  has_completed_onboarding: boolean;
  last_seen_at: string | null;
  current_terms_version: string | null;
  has_accepted_current_terms: boolean;
  has_completed_mandatory_onboarding: boolean;
  firm: {
    id: string;
    name: string;
    trading_name: string | null;
    practising_states: string[];
    is_active: boolean;
  } | null;
}

export interface SolicitorSessionResult {
  ok: boolean;
  status: number;
  error?: string;
  user?: SolicitorSessionUser;
  session_id?: string;
  legacy_token?: string;
}

/** Permission matrix shape: { key: { view, edit, delete } } */
export type PermissionMatrix = Record<string, { view?: boolean; edit?: boolean; delete?: boolean }>;
export type TriStateDecision = 'inherit' | 'allow' | 'deny';
export type TriStatePermissionMatrix = Record<string, Partial<Record<'view' | 'edit' | 'delete', TriStateDecision>>>;

export interface SolicitorMatterAccess {
  id: string;
  solicitor_user_id: string;
  legal_matter_id: string;
  firm_id: string;
  access_role: string;
  permissions: TriStatePermissionMatrix;
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
}

/**
 * Keys that are ALWAYS denied to solicitors, regardless of any stored matrix.
 * Tri-portal separation: legal practitioners never see the client's financial
 * position or any restricted AML/SMR record.
 */
export const SOLICITOR_FORBIDDEN_KEYS = new Set<string>([
  'income',
  'expenses',
  'assets',
  'liabilities',
  'employment',
  'borrowing_capacity',
  'commissions',
  'smr',
  'aml_restricted',
]);

export const SOLICITOR_PERMISSION_KEYS = [
  'matters',
  'critical_dates',
  'documents',
  'searches',
  'disbursements',
  'parties',
  'contract',
  'messages',
  'client_tasks',
  'settlement',
  'finance_status',
  'audit',
] as const;

/**
 * Permission keys that default to ALLOW when no matrix row exists yet. Matches
 * the Finance Portal's "null = legacy behaviour" convention so newly shipped
 * capabilities are not silently locked out for existing assignments.
 */
const DEFAULT_ALLOW_KEYS = new Set<string>(SOLICITOR_PERMISSION_KEYS);

export async function resolveSolicitorSession(
  supabase: any,
  headers: Headers,
  body?: Record<string, unknown>,
): Promise<SolicitorSessionResult> {
  const credential = extractSolicitorSessionCredential(headers, body);
  if (!credential) {
    return { ok: false, status: 401, error: 'Session token is required' };
  }
  if (!validateSolicitorPortalHeaders(headers, credential.source !== 'cookie')) return { ok: false, status: 401, error: 'Invalid or expired session' };
  const hashedSession = await resolveHashedSolicitorSession(supabase, credential.token);
  let legacyToken: string | undefined;
  let userId = hashedSession?.solicitor_user_id;
  if (!userId && credential.source !== 'cookie') {
    const { data: legacy } = await supabase.from('solicitor_portal_users')
      .select('id').eq('session_token', credential.token).gt('session_expires_at', new Date().toISOString()).maybeSingle();
    userId = legacy?.id;
    if (userId) legacyToken = credential.token;
  }
  if (!userId) return { ok: false, status: 401, error: 'Invalid or expired session' };
  const { data: user, error } = await supabase.from('solicitor_portal_users')
    .select(`
      id, firm_id, email, name, phone, position, portal_role,
      is_active, revoked_at, session_expires_at, must_change_password,
      has_accepted_terms, has_completed_onboarding, last_seen_at,
      solicitor_firms:firm_id (id, name, trading_name, practising_states, is_active)
    `)
    .eq('id', userId)
    .maybeSingle();

  if (error || !user) {
    return { ok: false, status: 401, error: 'Invalid or expired session' };
  }
  if (!user.is_active || user.revoked_at) {
    return { ok: false, status: 403, error: 'Your access has been revoked. Please contact your administrator.' };
  }
  if (legacyToken && (!user.session_expires_at || new Date(user.session_expires_at) < new Date())) {
    return { ok: false, status: 401, error: 'Session expired' };
  }

  const firm = (user as any).solicitor_firms || null;
  if (!firm || !firm.is_active) {
    return { ok: false, status: 403, error: 'The linked legal practice is no longer active.' };
  }
  const { data: terms } = await supabase.from('portal_terms_versions').select('id, version')
    .eq('portal', 'solicitor').is('retired_at', null).lte('effective_at', new Date().toISOString())
    .order('effective_at', { ascending: false }).limit(1).maybeSingle();
  const [{ data: acceptance }, { data: onboarding }] = await Promise.all([
    terms ? supabase.from('portal_terms_acceptances').select('id').eq('terms_version_id', terms.id).eq('solicitor_user_id', user.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from('solicitor_onboarding_steps').select('mandatory, completed_at').eq('solicitor_user_id', user.id),
  ]);
  const mandatorySteps = (onboarding || []).filter((step: any) => step.mandatory);
  const mandatoryComplete = mandatorySteps.length > 0
    && mandatorySteps.every((step: any) => !!step.completed_at);

  return {
    ok: true,
    status: 200,
    session_id: hashedSession?.id,
    legacy_token: legacyToken,
    user: {
      id: user.id,
      firm_id: user.firm_id,
      email: user.email,
      name: user.name,
      phone: user.phone ?? null,
      position: user.position ?? null,
      portal_role: user.portal_role,
      must_change_password: !!user.must_change_password,
      has_accepted_terms: !!user.has_accepted_terms,
      has_completed_onboarding: !!user.has_completed_onboarding,
      last_seen_at: user.last_seen_at ?? null,
      current_terms_version: terms?.version ?? null,
      has_accepted_current_terms: !!terms && !!acceptance,
      has_completed_mandatory_onboarding: mandatoryComplete,
      firm: {
        id: firm.id,
        name: firm.name,
        trading_name: firm.trading_name ?? null,
        practising_states: firm.practising_states ?? [],
        is_active: !!firm.is_active,
      },
    },
  };
}

export function solicitorGovernanceError(user: SolicitorSessionUser): string | null {
  if (user.must_change_password) return 'password_rotation_required';
  if (!user.has_accepted_current_terms) return 'terms_acceptance_required';
  if (!user.has_completed_mandatory_onboarding) return 'onboarding_required';
  return null;
}

/**
 * OR-merge the solicitor's global baseline with their per-client override.
 * `null` on either side means "not configured" and falls back to the
 * default-allow behaviour for known keys.
 */
export function mergePermissions(
  baseline: PermissionMatrix | null | undefined,
  perClient: PermissionMatrix | null | undefined,
): PermissionMatrix {
  const out: PermissionMatrix = {};
  for (const key of SOLICITOR_PERMISSION_KEYS) {
    const b = baseline?.[key];
    const c = perClient?.[key];
    if (!b && !c) {
      const allow = DEFAULT_ALLOW_KEYS.has(key);
      out[key] = { view: allow, edit: allow && key !== 'finance_status' && key !== 'audit', delete: false };
      continue;
    }
    out[key] = {
      view: !!(b?.view || c?.view),
      edit: !!(b?.edit || c?.edit),
      delete: !!(b?.delete || c?.delete),
    };
  }
  return out;
}

/**
 * Resolve the effective permission matrix for one solicitor + client pair, and
 * confirm the client is actually assigned to them. Returns `null` when the
 * solicitor has no assignment for that client (treat as 403).
 *
 * No function in this repository calls it any more, and it must not be used
 * to decide what a solicitor may see: a practice on the matter-access cutover
 * is governed by per-matter grants, which a per-client matrix cannot express,
 * and calling it there is how the board, the KPIs and the notifications came
 * to answer for the wrong model. `readAccessibleMatterIds` is that decision.
 * It stays exported because a clone receives this module and its callers by
 * cascade, and a clone whose functions arrived a cascade later would fail to
 * boot on a missing export.
 */
export async function resolveClientPermissions(
  supabase: any,
  solicitorUserId: string,
  clientId: string,
): Promise<PermissionMatrix | null> {
  const [{ data: assignment }, { data: baselineRow }] = await Promise.all([
    supabase
      .from('solicitor_portal_client_assignments')
      .select('permissions')
      .eq('solicitor_user_id', solicitorUserId)
      .eq('client_id', clientId)
      .maybeSingle(),
    supabase
      .from('solicitor_portal_default_permissions')
      .select('permissions')
      .eq('solicitor_user_id', solicitorUserId)
      .maybeSingle(),
  ]);

  if (!assignment) return null;
  return mergePermissions(baselineRow?.permissions ?? null, assignment.permissions ?? null);
}

export function can(
  matrix: PermissionMatrix | null,
  key: string,
  level: 'view' | 'edit' | 'delete' = 'view',
): boolean {
  if (SOLICITOR_FORBIDDEN_KEYS.has(key)) return false;
  if (!matrix) return false;
  return !!matrix[key]?.[level];
}

/** Phase 1 cutover is on by default; set false only for an emergency rollback. */
export function isMatterAccessV1Enabled(): boolean {
  return (Deno.env.get('SOLICITOR_MATTER_ACCESS_V1') || 'true').toLowerCase() !== 'false';
}

function baselineDecision(value: unknown): boolean {
  return value === true || value === 'allow';
}

/** Matter allow/deny wins; inherit falls through to a deny-by-default baseline. */
export function resolveTriStatePermissions(
  baseline: PermissionMatrix | TriStatePermissionMatrix | null | undefined,
  matter: TriStatePermissionMatrix | null | undefined,
): PermissionMatrix {
  const result: PermissionMatrix = {};
  for (const key of SOLICITOR_PERMISSION_KEYS) {
    result[key] = {};
    for (const level of ['view', 'edit', 'delete'] as const) {
      const override = matter?.[key]?.[level];
      result[key][level] = override === 'allow'
        ? true
        : override === 'deny'
          ? false
          : baselineDecision(baseline?.[key]?.[level]);
    }
  }
  return result;
}

/**
 * Which access model governs one practice's solicitors right now:
 * `rollback` whenever SOLICITOR_MATTER_ACCESS_V1 is off, otherwise the
 * practice's own rollout mode, and `cutover` where it has none.
 *
 * The per-matter check and the matter list both read it from here. Until
 * 28 Sep 2026 the list read the environment flag alone, so a practice its
 * rollout row held on the legacy assignments had its lists built from grants
 * it was not governed by. A matter could be listed that would not open, or
 * open while no list named it.
 *
 * `error` is the lookup's own failure. The per-matter check reads a failed
 * lookup as `cutover`, as it always has, which refuses a legacy practice's
 * matters rather than widening anybody's. The list reports it instead.
 */
async function readMatterAccessMode(
  supabase: any,
  solicitorFirmId: string,
): Promise<{ mode: string; error: string | null }> {
  if (!isMatterAccessV1Enabled()) return { mode: 'rollback', error: null };
  const { data: modeValue, error } = await supabase.rpc('resolve_cross_portal_feature_mode', { _firm_id: solicitorFirmId, _feature_key: 'solicitor_matter_access_v2' });
  return { mode: String(modeValue || 'cutover'), error: error ? (error.message ?? String(error)) : null };
}

export async function matterAccessMode(supabase: any, solicitorFirmId: string): Promise<string> {
  return (await readMatterAccessMode(supabase, solicitorFirmId)).mode;
}

export async function resolveSolicitorMatterAccess(
  supabase: any,
  solicitorUserId: string,
  solicitorFirmId: string,
  legalMatterId: string,
): Promise<SolicitorMatterAccess | null> {
  const mode = await matterAccessMode(supabase, solicitorFirmId);
  const { data: matter } = await supabase.from('legal_matters').select('id,client_id,firm_id').eq('id',legalMatterId).maybeSingle();
  if (!matter || !matter.firm_id || matter.firm_id !== solicitorFirmId) return null;
  const [{ data: target }, { data: assignment }] = await Promise.all([
    supabase.from('solicitor_matter_access').select('id,solicitor_user_id,legal_matter_id,firm_id,access_role,permissions,valid_from,valid_until,revoked_at').eq('solicitor_user_id',solicitorUserId).eq('legal_matter_id',legalMatterId).eq('firm_id',solicitorFirmId).is('revoked_at',null).maybeSingle(),
    supabase.from('solicitor_portal_client_assignments').select('id,permissions,assigned_at').eq('solicitor_user_id',solicitorUserId).eq('client_id',matter.client_id).maybeSingle(),
  ]);
  const now=Date.now();
  const targetActive=!!target&&!!target.valid_from&&new Date(target.valid_from).getTime()<=now&&(!target.valid_until||new Date(target.valid_until).getTime()>now);
  const legacyActive=!!assignment;
  if (['shadow','dual_read','dual_write'].includes(mode)) {
    await supabase.rpc('record_cross_portal_dual_read',{_firm_id:solicitorFirmId,_feature_key:'solicitor_matter_access_v2',_subject_type:'matter_access',_subject_id:legalMatterId,_legacy:{granted:legacyActive},_target:{granted:targetActive},_mismatch_fields:legacyActive===targetActive?[]:['granted'],_correlation_id:crypto.randomUUID()});
  }
  if (mode === 'cutover') return targetActive ? target as SolicitorMatterAccess : null;
  if (!assignment) return null;
  return { id:`legacy:${assignment.id}`,solicitor_user_id:solicitorUserId,legal_matter_id:legalMatterId,firm_id:solicitorFirmId,access_role:'team_member',permissions:assignment.permissions??{},valid_from:assignment.assigned_at,valid_until:null,revoked_at:null };
}

export async function resolveMatterPermissions(
  supabase: any,
  access: SolicitorMatterAccess,
): Promise<PermissionMatrix> {
  const { data: baseline } = await supabase
    .from('solicitor_portal_default_permissions')
    .select('permissions')
    .eq('solicitor_user_id', access.solicitor_user_id)
    .maybeSingle();
  if (access.id.startsWith('legacy:')) {
    return mergePermissions(baseline?.permissions ?? null, access.permissions as PermissionMatrix);
  }
  const resolved = resolveTriStatePermissions(baseline?.permissions ?? null, access.permissions ?? null);
  if (access.access_role === 'read_only') {
    for (const permission of Object.values(resolved)) {
      permission.edit = false;
      permission.delete = false;
    }
  }
  return resolved;
}

/** Which matters a solicitor may see, or why that could not be read. */
export type AccessibleMatterRead =
  | { ok: true; ids: string[] }
  | { ok: false; error: string };

/** UUIDs per `.in()` filter, so a request URL stays well inside the gateway's limit. */
const MATTER_ID_CHUNK = 100;
/** PostgREST answers at most this many rows to one request, whatever was asked. */
const MATTER_PAGE = 1000;

function chunked<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/**
 * Every row a query answers, one page at a time. `page` must order by a
 * unique column, or two pages can overlap and a third miss a row.
 *
 * The grants and the assignments were read in one request each until
 * 28 Sep 2026, and PostgREST answers at most a thousand rows to one request,
 * so a solicitor past a thousand lost the rest without a word. Grants reach
 * that sooner than it sounds: an expired grant is still an unrevoked row, and
 * the window is judged after the read.
 */
async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<{ ok: true; rows: T[] } | { ok: false; error: string }> {
  const rows: T[] = [];
  for (let from = 0; ; from += MATTER_PAGE) {
    const { data, error } = await page(from, from + MATTER_PAGE - 1);
    if (error) return { ok: false, error: error.message ?? String(error) };
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < MATTER_PAGE) return { ok: true, rows };
  }
}

/** `legal_matters.id` of every matter in the practice whose `column` is one of `values`. */
async function mattersInPractice(
  supabase: any,
  solicitorFirmId: string,
  column: 'id' | 'client_id',
  values: readonly string[],
): Promise<AccessibleMatterRead> {
  const ids = new Set<string>();
  for (const part of chunked(values, MATTER_ID_CHUNK)) {
    const read = await readAllPages<{ id: string }>((from, to) => supabase.from('legal_matters').select('id')
      .in(column, part).eq('firm_id', solicitorFirmId)
      .order('id', { ascending: true }).range(from, to));
    if (!read.ok) return { ok: false, error: `matters: ${read.error}` };
    read.rows.forEach((row) => ids.add(row.id));
  }
  return { ok: true, ids: [...ids] };
}

/**
 * Every matter this solicitor may VIEW under each of `permissionKeys`.
 *
 * It decides the way `resolveSolicitorMatterAccess` and
 * `resolveMatterPermissions` decide for one matter: the same mode, the same
 * grants or assignments, the same baseline, the same practice. So a matter a
 * list names is a matter that opens, and the reverse. On the legacy model that
 * includes the assignment's own denials. The list used to return every matter
 * of every assigned client whatever the key, so a solicitor whose assignment
 * denied `messages` still had the client's threads listed.
 *
 * A read that fails is reported, never answered as an empty list. "We could
 * not read your access" and "you have access to nothing" are different
 * answers, and the conflict search records the second as a clear.
 */
export async function readAccessibleMatterIds(
  supabase: any,
  solicitorUserId: string,
  solicitorFirmId: string,
  permissionKeys: string | readonly string[] = 'matters',
): Promise<AccessibleMatterRead> {
  const keys = typeof permissionKeys === 'string' ? [permissionKeys] : [...permissionKeys];
  if (keys.length === 0) return { ok: false, error: 'no permission key was named' };
  const allowsEvery = (matrix: PermissionMatrix) => keys.every((key) => can(matrix, key, 'view'));
  try {
    const modeRead = await readMatterAccessMode(supabase, solicitorFirmId);
    if (modeRead.error) return { ok: false, error: `access mode: ${modeRead.error}` };
    const mode = modeRead.mode;
    const { data: baselineRow, error: baselineError } = await supabase
      .from('solicitor_portal_default_permissions').select('permissions')
      .eq('solicitor_user_id', solicitorUserId).maybeSingle();
    if (baselineError) return { ok: false, error: `baseline permissions: ${baselineError.message ?? String(baselineError)}` };
    const baseline = baselineRow?.permissions ?? null;

    if (mode === 'cutover') {
      const grants = await readAllPages<any>((from, to) => supabase
        .from('solicitor_matter_access')
        .select('id, legal_matter_id, permissions, valid_from, valid_until')
        .eq('solicitor_user_id', solicitorUserId)
        .eq('firm_id', solicitorFirmId)
        .is('revoked_at', null)
        .order('id', { ascending: true }).range(from, to));
      if (!grants.ok) return { ok: false, error: `matter grants: ${grants.error}` };
      const now = Date.now();
      const granted = [...new Set(grants.rows
        .filter((row: any) => row.valid_from && new Date(row.valid_from).getTime() <= now
          && (!row.valid_until || new Date(row.valid_until).getTime() > now))
        .filter((row: any) => allowsEvery(resolveTriStatePermissions(baseline, row.permissions ?? null)))
        .map((row: any) => row.legal_matter_id as string))];
      // A grant does not outlive the matter's practice: the per-matter check
      // refuses a matter outside it, so the list does too.
      return await mattersInPractice(supabase, solicitorFirmId, 'id', granted);
    }

    const assignments = await readAllPages<any>((from, to) => supabase
      .from('solicitor_portal_client_assignments')
      .select('id, client_id, permissions')
      .eq('solicitor_user_id', solicitorUserId)
      .order('id', { ascending: true }).range(from, to));
    if (!assignments.ok) return { ok: false, error: `client assignments: ${assignments.error}` };
    const clientIds = [...new Set(assignments.rows
      .filter((row: any) => row.client_id && allowsEvery(mergePermissions(baseline, row.permissions ?? null)))
      .map((row: any) => row.client_id as string))];
    return await mattersInPractice(supabase, solicitorFirmId, 'client_id', clientIds);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * `readAccessibleMatterIds` for a caller that scopes what it shows with the
 * answer: the matters page, the documents, the threads, the board. A failed
 * read THROWS, and the caller's handler answers it as an error.
 *
 * It used to answer an empty list, and before 28 Sep 2026 it did not read the
 * errors at all, so a lost connection drew "no matters", "no documents" and
 * "no messages" as statements about the solicitor. An empty list is still
 * the safe side for what a page SHOWS, but it is not the true side for what
 * a page SAYS. A caller that phrases the failure itself calls
 * `readAccessibleMatterIds` instead.
 */
export async function listAccessibleMatterIds(
  supabase: any,
  solicitorUserId: string,
  solicitorFirmId: string,
  permissionKeys: string | readonly string[] = 'matters',
): Promise<string[]> {
  const read = await readAccessibleMatterIds(supabase, solicitorUserId, solicitorFirmId, permissionKeys);
  if (read.ok) return read.ids;
  throw new Error(`The matters this solicitor can see could not be read: ${read.error}`);
}

/**
 * List every client_id this solicitor is assigned to.
 *
 * Like `resolveClientPermissions`, this has no caller here and stays exported
 * only for clones mid-cascade. An assignment list is not an access list: it
 * ignores the practice's rollout mode and the assignment's own denials.
 */
export async function listAssignedClientIds(
  supabase: any,
  solicitorUserId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('solicitor_portal_client_assignments')
    .select('client_id')
    .eq('solicitor_user_id', solicitorUserId);
  return (data || []).map((r: any) => r.client_id);
}

/** Append an entry to the solicitor activity log. Never throws. */
export async function logSolicitorActivity(
  supabase: any,
  entry: {
    solicitor_user_id?: string | null;
    firm_id?: string | null;
    actor_user_id?: string | null;
    actor_type?: string;
    action: string;
    client_id?: string | null;
    legal_matter_id?: string | null;
    entity_type?: string | null;
    entity_id?: string | null;
    metadata?: Record<string, unknown> | null;
    ip_address?: string | null;
    user_agent?: string | null;
    visible_to_client?: boolean;
  },
): Promise<void> {
  let auditWritten = false;
  try {
    const { error } = await supabase.from('solicitor_portal_activity_log').insert({ actor_type: 'solicitor_user', ...entry });
    if (error) throw error;
    auditWritten = true;
  } catch (e) {
    console.error('[solicitor-portal] activity log failed:', e);
  }
  const dimensions = {
    _correlation_id: crypto.randomUUID(), _request_id: entry.entity_id ?? null,
    _actor_type: entry.actor_type ?? 'solicitor_user', _actor_id: entry.solicitor_user_id ?? entry.actor_user_id ?? null,
    _portal: 'solicitor', _case_id: null, _matter_id: entry.legal_matter_id ?? null, _firm_id: entry.firm_id ?? null, _duration_ms: null,
  };
  await supabase.rpc('record_portal_operational_event', auditWritten ? {
    ...dimensions, _event_name: 'solicitor_command', _severity: 'info', _success: true,
    _metadata: { action: entry.action, entity_type: entry.entity_type ?? null },
  } : {
    ...dimensions, _event_name: 'mandatory_audit_write_failure', _severity: 'critical', _success: false,
    _metadata: { action: entry.action, error_code: 'activity_log_write_failed' },
  });
}
export function requestIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}
