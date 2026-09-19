import { computeIdleExpiry, hashSessionToken } from './sessionHash.ts';

export const SOLICITOR_SESSION_ABSOLUTE_HOURS = 12;
export const SOLICITOR_SESSION_IDLE_MINUTES = 30;
export const GENERIC_AUTH_ERROR = 'Invalid email or password';

export interface IssuedSolicitorSession { id: string; token: string; absoluteExpiresAt: Date; idleExpiresAt: Date }
const rawToken = () => `${crypto.randomUUID()}-${crypto.randomUUID()}-${crypto.randomUUID()}`;
const requestIp = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
const fingerprint = async (kind: string, value: string | null) => value ? hashSessionToken(`${kind}:${value}`) : null;

export async function issueSolicitorSession(supabase: any, userId: string, req: Request, options: { legacyMigrated?: boolean; deviceLabel?: string } = {}): Promise<IssuedSolicitorSession> {
  const token = rawToken();
  const tokenHash = await hashSessionToken(token);
  if (!tokenHash) throw new Error('Session hashing unavailable');
  const now = new Date();
  const absoluteExpiresAt = new Date(now.getTime() + SOLICITOR_SESSION_ABSOLUTE_HOURS * 3_600_000);
  const idleExpiresAt = computeIdleExpiry(now, SOLICITOR_SESSION_IDLE_MINUTES);
  const { data, error } = await supabase.from('solicitor_portal_sessions').insert({
    solicitor_user_id: userId, token_hash: tokenHash,
    absolute_expires_at: absoluteExpiresAt.toISOString(), idle_expires_at: idleExpiresAt.toISOString(),
    last_used_at: now.toISOString(), ip_hash: await fingerprint('ip', requestIp(req)),
    user_agent_hash: await fingerprint('ua', req.headers.get('user-agent')),
    device_label: options.deviceLabel?.slice(0, 120) || null,
    legacy_migrated_at: options.legacyMigrated ? now.toISOString() : null,
  }).select('id').single();
  if (error || !data) throw error || new Error('Session creation failed');
  return { id: data.id, token, absoluteExpiresAt, idleExpiresAt };
}

export async function resolveHashedSolicitorSession(supabase: any, token: string): Promise<any | null> {
  const tokenHash = await hashSessionToken(token);
  if (!tokenHash) return null;
  const { data } = await supabase.from('solicitor_portal_sessions')
    .select('id, solicitor_user_id, absolute_expires_at, idle_expires_at, revoked_at')
    .eq('token_hash', tokenHash).maybeSingle();
  if (!data || data.revoked_at) return null;
  const now = new Date();
  if (new Date(data.absolute_expires_at) <= now || new Date(data.idle_expires_at) <= now) return null;
  const slid = computeIdleExpiry(now, SOLICITOR_SESSION_IDLE_MINUTES);
  const idleExpiresAt = slid > new Date(data.absolute_expires_at) ? new Date(data.absolute_expires_at) : slid;
  const { data: touched } = await supabase.from('solicitor_portal_sessions').update({ last_used_at: now.toISOString(), idle_expires_at: idleExpiresAt.toISOString() }).eq('id', data.id).is('revoked_at', null).select('id').maybeSingle();
  if (!touched) return null;
  return data;
}

export async function revokeSolicitorSession(supabase: any, sessionId: string, reason: string): Promise<void> {
  const { error } = await supabase.from('solicitor_portal_sessions').update({ revoked_at: new Date().toISOString(), revoked_reason: reason }).eq('id', sessionId).is('revoked_at', null);
  if (error) throw error;
}
export async function revokeAllSolicitorSessions(supabase: any, userId: string, reason: string): Promise<number> {
  const { data, error } = await supabase.from('solicitor_portal_sessions').update({ revoked_at: new Date().toISOString(), revoked_reason: reason }).eq('solicitor_user_id', userId).is('revoked_at', null).select('id');
  if (error) throw error;
  return (data || []).length;
}
export async function auditSolicitorIdentity(supabase: any, req: Request, entry: { userId?: string | null; firmId?: string | null; action: string; sessionId?: string | null; metadata?: Record<string, unknown> }): Promise<void> {
  const { error } = await supabase.from('solicitor_portal_activity_log').insert({ solicitor_user_id: entry.userId || null, firm_id: entry.firmId || null, actor_user_id: entry.userId || null, actor_type: entry.userId ? 'solicitor_user' : 'system', action: entry.action, entity_type: 'session', entity_id: entry.sessionId || null, metadata: entry.metadata || {}, ip_address: requestIp(req), user_agent: req.headers.get('user-agent') || null });
  if (error) console.error('[solicitor-identity-audit] insert failed', error);
}
