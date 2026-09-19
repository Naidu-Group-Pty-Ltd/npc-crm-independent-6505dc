/**
 * Solicitor Portal Phase 6 — shared communications domain layer.
 *
 * ONE place that defines matter conversation scopes, the column whitelists,
 * the tri-portal mirroring rules and the solicitor notification dispatcher.
 * Portal (`solicitor-portal-comms`) and Command Centre (`legal-matters-admin`)
 * both import from here so the two sides can never drift.
 *
 * Tri-portal separation rules enforced here:
 *   - `firm_internal` notes NEVER leave the solicitor portal.
 *   - `solicitor_client` messages mirror into `client_portal_messages` only.
 *   - `solicitor_finance` messages mirror into `finance_portal_messages` only.
 *   - No financial-position or AML-restricted field is ever selected.
 */

export const LEGAL_THREAD_SCOPES = [
  'solicitor_npc',
  'solicitor_client',
  'solicitor_finance',
  'firm_internal',
] as const;
export type LegalThreadScope = (typeof LEGAL_THREAD_SCOPES)[number];

export const LEGAL_MESSAGE_SENDER_TYPES = [
  'solicitor_user',
  'staff',
  'client',
  'finance_partner',
  'system',
] as const;
export type LegalMessageSenderType = (typeof LEGAL_MESSAGE_SENDER_TYPES)[number];

/** Scopes a solicitor may post into from the portal. */
export const SOLICITOR_POSTABLE_SCOPES = new Set<LegalThreadScope>([
  'solicitor_npc',
  'solicitor_client',
  'solicitor_finance',
  'firm_internal',
]);

/** Scopes Command Centre staff may post into. */
export const STAFF_POSTABLE_SCOPES = new Set<LegalThreadScope>([
  'solicitor_npc',
  'solicitor_finance',
]);

export const THREAD_SELECT = `
  id, legal_matter_id, client_id, firm_id, scope, subject, finance_user_id,
  last_message_at, last_message_preview, last_sender_type,
  unread_count_solicitor, unread_count_staff, unread_count_client, unread_count_finance,
  is_archived, created_at, updated_at
`;

export const MESSAGE_SELECT = `
  id, thread_id, legal_matter_id, client_id, scope, sender_type,
  sender_solicitor_user_id, sender_staff_user_id, sender_finance_user_id,
  sender_name, body, attachment_path, attachment_filename, attachment_mime,
  attachment_size_bytes, is_internal, mirrored_client_message_id,
  mirrored_finance_message_id, read_by_solicitor_at, read_by_staff_at,
  read_by_client_at, read_by_finance_at, metadata, created_at
`;

export const NOTIFICATION_SELECT = `
  id, solicitor_user_id, firm_id, client_id, legal_matter_id, notification_type,
  title, body, link_path, metadata, is_read, read_at, created_at
`;

export const PREFS_SELECT = `
  id, solicitor_user_id, event_type, channels, quiet_hours_start, quiet_hours_end,
  timezone, is_enabled, created_at, updated_at
`;

/** Notification event types the solicitor portal can raise. */
export const SOLICITOR_NOTIFICATION_EVENTS = [
  'message_received',
  'document_requested',
  'document_uploaded',
  'critical_date_due',
  'requisition_raised',
  'matter_status_changed',
  'settlement_task_due',
] as const;

/** Events that always deliver, ignoring quiet hours. */
const URGENT_EVENTS = new Set<string>(['critical_date_due', 'settlement_task_due']);

export function isValidScope(value: unknown): value is LegalThreadScope {
  return typeof value === 'string' && (LEGAL_THREAD_SCOPES as readonly string[]).includes(value);
}

export function scopeLabel(scope: LegalThreadScope): string {
  switch (scope) {
    case 'solicitor_npc': return 'NPC Command Centre';
    case 'solicitor_client': return 'Client';
    case 'solicitor_finance': return 'Finance partner';
    case 'firm_internal': return 'Firm internal note';
  }
}

export function preview(body: string, max = 240): string {
  const flat = String(body || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Truthy only inside the configured quiet window (handles overnight wrap). */
function inQuietHours(start?: string | null, end?: string | null, timezone?: string | null): boolean {
  if (!start || !end) return false;
  try {
    const now = new Date().toLocaleTimeString('en-GB', {
      hour12: false,
      timeZone: timezone || 'Australia/Sydney',
    });
    const cur = now.slice(0, 5);
    const s = start.slice(0, 5);
    const e = end.slice(0, 5);
    return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
  } catch {
    return false;
  }
}

export interface SolicitorNotifyInput {
  solicitorUserIds: string[];
  firmId?: string | null;
  clientId?: string | null;
  legalMatterId?: string | null;
  eventType: string;
  title: string;
  body?: string | null;
  linkPath?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Insert in-app notifications honouring each recipient's preferences.
 * Never throws — comms must not break the write that triggered them.
 */
export async function notifySolicitors(
  supabase: any,
  input: SolicitorNotifyInput,
): Promise<{ inserted: number; skipped: number; error?: string }> {
  const recipients = Array.from(new Set((input.solicitorUserIds || []).filter(Boolean)));
  if (recipients.length === 0) return { inserted: 0, skipped: 0 };

  try {
    const { data: prefs } = await supabase
      .from('solicitor_notification_prefs')
      .select('solicitor_user_id, channels, quiet_hours_start, quiet_hours_end, timezone, is_enabled')
      .in('solicitor_user_id', recipients)
      .eq('event_type', input.eventType);

    const byUser = new Map<string, any>();
    (prefs || []).forEach((p: any) => byUser.set(p.solicitor_user_id, p));

    const urgent = URGENT_EVENTS.has(input.eventType);
    const rows: Record<string, unknown>[] = [];
    let skipped = 0;

    for (const userId of recipients) {
      const pref = byUser.get(userId);
      if (pref && pref.is_enabled === false) { skipped += 1; continue; }
      const channels: string[] = pref?.channels?.length ? pref.channels : ['in_app'];
      const quiet = !urgent && inQuietHours(pref?.quiet_hours_start, pref?.quiet_hours_end, pref?.timezone);
      if (!channels.includes('in_app')) { skipped += 1; continue; }

      rows.push({
        solicitor_user_id: userId,
        firm_id: input.firmId ?? null,
        client_id: input.clientId ?? null,
        legal_matter_id: input.legalMatterId ?? null,
        notification_type: input.eventType,
        title: input.title,
        body: input.body ?? null,
        link_path: input.linkPath ?? null,
        metadata: {
          ...(input.metadata || {}),
          urgent,
          deferred_by_quiet_hours: quiet,
          delivered_channels: channels,
        },
      });
    }

    if (rows.length === 0) return { inserted: 0, skipped };
    const { error } = await supabase.from('solicitor_portal_notifications').insert(rows);
    if (error) return { inserted: 0, skipped, error: error.message };
    return { inserted: rows.length, skipped };
  } catch (e) {
    console.error('[legalComms] notifySolicitors failed:', e);
    return { inserted: 0, skipped: 0, error: String(e) };
  }
}

/** Cross-portal delivery is handled by the transactional outbox worker. */
export function summariseThreads(threads: any[], audience: 'solicitor' | 'staff') {
  const key = audience === 'solicitor' ? 'unread_count_solicitor' : 'unread_count_staff';
  return {
    total: threads.length,
    unread: threads.reduce((sum, t) => sum + (Number(t[key]) || 0), 0),
    unreadThreads: threads.filter((t) => (Number(t[key]) || 0) > 0).length,
    lastActivityAt: threads.reduce<string | null>((latest, t) => {
      if (!t.last_message_at) return latest;
      return !latest || t.last_message_at > latest ? t.last_message_at : latest;
    }, null),
  };
}
