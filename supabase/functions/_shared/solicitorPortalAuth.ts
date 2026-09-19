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

export async function resolveSolicitorMatterAccess(
  supabase: any,
  solicitorUserId: string,
  solicitorFirmId: string,
  legalMatterId: string,
): Promise<SolicitorMatterAccess | null> {
  const { data: modeValue } = await supabase.rpc('resolve_cross_portal_feature_mode', { _firm_id: solicitorFirmId, _feature_key: 'solicitor_matter_access_v2' });
  const mode = isMatterAccessV1Enabled() ? String(modeValue || 'cutover') : 'rollback';
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

export async function listAccessibleMatterIds(
  supabase: any,
  solicitorUserId: string,
  solicitorFirmId: string,
  permissionKey: string = 'matters',
): Promise<string[]> {
  if (!isMatterAccessV1Enabled()) {
    const clientIds = await listAssignedClientIds(supabase, solicitorUserId);
    if (!clientIds.length) return [];
    const { data: matters } = await supabase.from('legal_matters').select('id')
      .in('client_id', clientIds).eq('firm_id', solicitorFirmId);
    return (matters || []).map((row: any) => row.id);
  }
  const { data } = await supabase
    .from('solicitor_matter_access')
    .select('id, legal_matter_id, access_role, permissions, valid_from, valid_until')
    .eq('solicitor_user_id', solicitorUserId)
    .eq('firm_id', solicitorFirmId)
    .is('revoked_at', null);
  const { data: baseline } = await supabase
    .from('solicitor_portal_default_permissions').select('permissions')
    .eq('solicitor_user_id', solicitorUserId).maybeSingle();
  const now = Date.now();
  return (data || [])
    .filter((row: any) => row.valid_from && new Date(row.valid_from).getTime() <= now
      && (!row.valid_until || new Date(row.valid_until).getTime() > now))
    .filter((row: any) => can(resolveTriStatePermissions(baseline?.permissions ?? null, row.permissions), permissionKey, 'view'))
    .map((row: any) => row.legal_matter_id);
}

/** List every client_id this solicitor is assigned to. */
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
