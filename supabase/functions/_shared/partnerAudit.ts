/**
 * Phase 6 — Partner compliance audit writer.
 *
 * Centralised, never-throwing writer for `partner_compliance_audit_events`.
 * The hash chain (prev_hash / row_hash) is sealed by a DB trigger, keyed on
 * `chain_key` (defaults to the agreement id, or 'global' when unscoped).
 */

export type PartnerAuditScope =
  | 'agreement'
  | 'referral'
  | 'consent'
  | 'undertaking'
  | 'banking'
  | 'clawback'
  | 'commission'
  | 'statement'
  | 'incident'
  | 'retention'
  | 'termination'
  | 'system';

export type PartnerAuditSeverity = 'info' | 'notice' | 'warn' | 'critical';

export type PartnerAuditCategory =
  | 'data_change'
  | 'lifecycle'
  | 'sensitive_access'
  | 'consent'
  | 'export'
  | 'security'
  | 'privacy'
  | 'retention'
  | 'system';

export interface PartnerAuditInput {
  agreement_id?: string | null;
  referral_id?: string | null;
  scope_type: PartnerAuditScope;
  scope_id?: string | null;
  actor_type?: 'team_user' | 'finance_partner' | 'client' | 'system' | 'superadmin';
  actor_id?: string | null;
  actor_label?: string | null;
  severity?: PartnerAuditSeverity;
  category?: PartnerAuditCategory;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  fields_touched?: string[] | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  ip_address?: string | null;
  user_agent?: string | null;
  retention_class?: 'standard_7y' | 'extended_10y';
}

export function partnerRequestFingerprint(req: Request): {
  ip_address: string | null;
  user_agent: string | null;
} {
  const h = req.headers;
  const fwd = h.get('x-forwarded-for');
  return {
    ip_address: (fwd ? fwd.split(',')[0].trim() : null) || h.get('x-real-ip') || h.get('cf-connecting-ip') || null,
    user_agent: h.get('user-agent'),
  };
}

export async function recordPartnerAudit(supabase: any, evt: PartnerAuditInput): Promise<void> {
  try {
    await supabase.from('partner_compliance_audit_events').insert({
      chain_key: evt.agreement_id || 'global',
      agreement_id: evt.agreement_id ?? null,
      referral_id: evt.referral_id ?? null,
      scope_type: evt.scope_type,
      scope_id: evt.scope_id ?? null,
      actor_type: evt.actor_type ?? 'team_user',
      actor_id: evt.actor_id ?? null,
      actor_label: evt.actor_label ?? null,
      severity: evt.severity ?? 'info',
      category: evt.category ?? 'data_change',
      action: evt.action,
      target_type: evt.target_type ?? null,
      target_id: evt.target_id ?? null,
      fields_touched: evt.fields_touched ?? null,
      description: evt.description ?? null,
      metadata: evt.metadata ?? {},
      ip_address: evt.ip_address ?? null,
      user_agent: evt.user_agent ?? null,
      retention_class: evt.retention_class ?? 'standard_7y',
    });
  } catch (err) {
    console.warn('[partner-audit] insert failed', err);
  }
}

/**
 * Verify continuity of a chain. Only checks prev_hash linkage (row_hash is
 * computed server-side by the trigger and cannot be recomputed in Deno without
 * duplicating the exact digest input, which the DB owns).
 */
export async function verifyPartnerAuditChain(
  supabase: any,
  chainKey: string,
): Promise<{ ok: boolean; total: number; broken_at?: string | null }> {
  const { data, error } = await supabase
    .from('partner_compliance_audit_events')
    .select('id, prev_hash, row_hash, created_at')
    .eq('chain_key', chainKey)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) return { ok: false, total: 0, broken_at: 'query_error' };
  const rows = data || [];
  let prev: string | null = null;
  for (const r of rows) {
    if ((r.prev_hash || null) !== prev) return { ok: false, total: rows.length, broken_at: r.id };
    if (!r.row_hash) return { ok: false, total: rows.length, broken_at: r.id };
    prev = r.row_hash;
  }
  return { ok: true, total: rows.length, broken_at: null };
}
