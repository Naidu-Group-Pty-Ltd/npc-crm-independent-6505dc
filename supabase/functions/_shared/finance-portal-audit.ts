/**
 * Finance Portal Audit Logger (Chunk 8)
 *
 * Centralised writer for `purchase_file_audit_events`. Captures sensitive-data
 * access, high-risk actions, exports, and security events with a tamper-evident
 * hash chain (handled by DB trigger).
 *
 * Usage:
 *   await recordAuditEvent(supabase, {
 *     purchase_file_id,
 *     client_id,
 *     actor_type: 'finance_partner',
 *     actor_finance_user_id,
 *     category: 'sensitive_access',
 *     action: 'view_broker_notes',
 *     fields_accessed: ['broker_notes'],
 *     ip_address, user_agent,
 *   });
 *
 * Never throws — audit logging must never block the primary operation.
 */

export type AuditActorType = 'finance_partner' | 'client' | 'team_user' | 'system' | 'superadmin';
export type AuditSeverity = 'info' | 'notice' | 'warn' | 'critical';
export type AuditCategory =
  | 'sensitive_access'
  | 'security'
  | 'document'
  | 'decision'
  | 'system'
  | 'data_change'
  | 'export'
  | 'consent';

export interface AuditEventInput {
  purchase_file_id?: string | null;
  client_id?: string | null;
  client_deal_id?: string | null;
  actor_type: AuditActorType;
  actor_finance_user_id?: string | null;
  actor_team_user_id?: string | null;
  actor_client_id?: string | null;
  severity?: AuditSeverity;
  category: AuditCategory;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  fields_accessed?: string[] | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  ip_address?: string | null;
  user_agent?: string | null;
  retention_class?: 'standard_7y' | 'extended_10y';
}

export function extractRequestFingerprint(req: Request): { ip_address: string | null; user_agent: string | null } {
  const h = req.headers;
  const fwd = h.get('x-forwarded-for');
  const ip =
    (fwd ? fwd.split(',')[0].trim() : null) ||
    h.get('x-real-ip') ||
    h.get('cf-connecting-ip') ||
    null;
  return { ip_address: ip, user_agent: h.get('user-agent') };
}

export async function recordAuditEvent(supabase: any, evt: AuditEventInput): Promise<void> {
  try {
    await supabase.from('purchase_file_audit_events').insert({
      purchase_file_id: evt.purchase_file_id ?? null,
      client_id: evt.client_id ?? null,
      client_deal_id: evt.client_deal_id ?? null,
      actor_type: evt.actor_type,
      actor_finance_user_id: evt.actor_finance_user_id ?? null,
      actor_team_user_id: evt.actor_team_user_id ?? null,
      actor_client_id: evt.actor_client_id ?? null,
      severity: evt.severity ?? 'info',
      category: evt.category,
      action: evt.action,
      target_type: evt.target_type ?? null,
      target_id: evt.target_id ?? null,
      fields_accessed: evt.fields_accessed ?? null,
      description: evt.description ?? null,
      metadata: evt.metadata ?? {},
      ip_address: evt.ip_address ?? null,
      user_agent: evt.user_agent ?? null,
      retention_class: evt.retention_class ?? 'standard_7y',
    });
  } catch (err) {
    // Audit must never break primary flow
    console.warn('[finance-portal-audit] insert failed', err);
  }
}

/**
 * Verify the hash chain for a purchase file.
 * Recomputes each row's hash and confirms continuity. Returns { ok, broken_at }.
 */
export async function verifyAuditChain(
  supabase: any,
  purchaseFileId: string | null,
): Promise<{ ok: boolean; total: number; broken_at?: string }> {
  const query = supabase
    .from('purchase_file_audit_events')
    .select('id, prev_hash, row_hash, purchase_file_id, actor_type, actor_finance_user_id, actor_team_user_id, actor_client_id, category, action, target_type, target_id, metadata, created_at')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  const { data, error } = purchaseFileId
    ? await query.eq('purchase_file_id', purchaseFileId)
    : await query.is('purchase_file_id', null);

  if (error) return { ok: false, total: 0, broken_at: 'query_error' };
  const rows = data || [];
  let prev: string | null = null;

  for (const r of rows) {
    if ((r.prev_hash || null) !== prev) {
      return { ok: false, total: rows.length, broken_at: r.id };
    }
    // Recompute hash via RPC
    const { data: hash } = await supabase.rpc('compute_audit_row_hash', {
      _prev_hash: prev,
      _purchase_file_id: r.purchase_file_id,
      _actor_type: r.actor_type,
      _actor_id: r.actor_finance_user_id || r.actor_team_user_id || r.actor_client_id || null,
      _category: r.category,
      _action: r.action,
      _target_type: r.target_type,
      _target_id: r.target_id,
      _metadata: r.metadata ?? {},
      _created_at: r.created_at,
    });
    if (hash !== r.row_hash) {
      return { ok: false, total: rows.length, broken_at: r.id };
    }
    prev = r.row_hash;
  }
  return { ok: true, total: rows.length };
}
