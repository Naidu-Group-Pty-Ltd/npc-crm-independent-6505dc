/**
 * Shared helper for emitting Finance Portal notifications.
 * Service-role only — call from edge functions that already have an authenticated context.
 *
 * Sends a notification to portal users assigned to the given client, respecting each
 * recipient's `finance_partner_notification_prefs` (channel routing + quiet hours).
 *
 * Chunk 10 wiring:
 *  - Per-user, per-event-type channel filter (in_app / email / push). Missing prefs
 *    row → default-allow in_app only.
 *  - Quiet-hours suppression of non-urgent events (skip insert entirely). Urgent
 *    events ALWAYS deliver regardless of quiet hours.
 *  - `is_enabled = false` → mute that event for that user.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import {
  hasFinancePortalPermission,
  type FinancePortalPermissionAction,
} from "./finance-portal-permissions.ts";

export interface FinancePortalNotificationInput {
  client_id: string;
  notification_type: string;
  title: string;
  body?: string;
  link_path?: string;
  metadata?: Record<string, any>;
  /** If provided, do NOT notify this portal user (avoid notifying the actor). */
  exclude_portal_user_id?: string;
  /** Override urgency. Defaults to URGENT_EVENTS lookup. */
  urgent?: boolean;
  /** Portal that produced the event. Command Centre callers must opt in explicitly. */
  origin_portal?: 'command_center' | 'client_portal' | 'finance_portal' | 'system';
  related_entity_type?: string;
  related_entity_id?: string;
  finance_file_id?: string;
  correlation_id?: string;
  /** Restrict recipients to users with this effective module permission. */
  required_permission?: {
    key: string;
    action: FinancePortalPermissionAction;
    /** Preserve legacy modules where an absent permission entry means allowed. */
    default_allow_when_unconfigured?: boolean;
  };
}

/** Events that bypass quiet hours — must reach broker in real time. */
const URGENT_EVENTS = new Set([
  'unconditional_approval',
  'settlement_imminent',
  'settlement_at_risk',
  'lender_decline',
  'risk_critical',
  'document_overdue',
  'condition_overdue',
]);

interface PrefRow {
  finance_contact_id: string;
  event_type: string;
  channels: string[] | null;
  quiet_hours_start: string | null; // 'HH:MM:SS'
  quiet_hours_end: string | null;
  timezone: string | null;
  is_enabled: boolean;
}

function inQuietHours(pref: PrefRow): boolean {
  if (!pref.quiet_hours_start || !pref.quiet_hours_end) return false;
  const tz = pref.timezone || 'Australia/Sydney';
  let nowParts: { hour: string; minute: string };
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    nowParts = {
      hour: fmt.find(p => p.type === 'hour')?.value || '00',
      minute: fmt.find(p => p.type === 'minute')?.value || '00',
    };
  } catch {
    return false; // bad timezone string — fail open
  }
  const nowMin = parseInt(nowParts.hour, 10) * 60 + parseInt(nowParts.minute, 10);
  const [sh, sm] = pref.quiet_hours_start.split(':').map(n => parseInt(n, 10));
  const [eh, em] = pref.quiet_hours_end.split(':').map(n => parseInt(n, 10));
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin === endMin) return false;
  // Window may wrap midnight
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

export async function notifyFinancePortalAssignees(
  input: FinancePortalNotificationInput
): Promise<{ inserted: number; skipped: number; error?: string }> {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const isUrgent = input.urgent ?? URGENT_EVENTS.has(input.notification_type);

    const { data: assignments, error: aErr } = await supabase
      .from('finance_portal_client_assignments')
      .select('finance_user_id, permissions, finance_portal_users!inner(id, is_active, revoked_at, finance_contact_id, global_permissions)')
      .eq('client_id', input.client_id);

    if (aErr) return { inserted: 0, skipped: 0, error: aErr.message };

    type Recipient = { portalUserId: string; financeContactId: string | null };
    const recipients: Recipient[] = (assignments || [])
      .map((a: any) => ({
        portalUserId: a.finance_user_id as string,
        financeContactId: (a.finance_portal_users?.finance_contact_id ?? null) as string | null,
        active: a.finance_portal_users?.is_active && !a.finance_portal_users?.revoked_at,
        hasRequiredPermission: !input.required_permission || hasFinancePortalPermission(
          a.finance_portal_users?.global_permissions,
          a.permissions,
          input.required_permission.key,
          input.required_permission.action,
          input.required_permission.default_allow_when_unconfigured,
        ),
      }))
      .filter((r: any) =>
        r.portalUserId &&
        r.portalUserId !== input.exclude_portal_user_id &&
        r.active &&
        r.hasRequiredPermission
      );

    if (recipients.length === 0) return { inserted: 0, skipped: 0 };

    // Load prefs for all recipients in one query
    const contactIds = recipients.map(r => r.financeContactId).filter(Boolean) as string[];
    const prefsByContact = new Map<string, PrefRow>();
    if (contactIds.length > 0) {
      const { data: prefs } = await supabase
        .from('finance_partner_notification_prefs')
        .select('finance_contact_id, event_type, channels, quiet_hours_start, quiet_hours_end, timezone, is_enabled')
        .in('finance_contact_id', contactIds)
        .eq('event_type', input.notification_type);
      for (const p of (prefs || [])) prefsByContact.set(p.finance_contact_id, p as PrefRow);
    }

    const rows: any[] = [];
    let skipped = 0;
    for (const r of recipients) {
      const pref = r.financeContactId ? prefsByContact.get(r.financeContactId) : undefined;

      // Default-allow in_app when no pref row exists
      const channels: string[] = pref?.channels && pref.channels.length > 0 ? pref.channels : ['in_app'];
      const inAppEnabled = channels.includes('in_app');

      if (pref && pref.is_enabled === false) { skipped++; continue; }
      if (!inAppEnabled) { skipped++; continue; }
      if (pref && !isUrgent && inQuietHours(pref)) { skipped++; continue; }

      rows.push({
        portal_user_id: r.portalUserId,
        client_id: input.client_id,
        notification_type: input.notification_type,
        origin_portal: input.origin_portal || 'system',
        target_portal: 'finance_portal',
        notification_domain: 'finance',
        command_centre_authorised: true,
        related_entity_type: input.related_entity_type || null,
        related_entity_id: input.related_entity_id || null,
        finance_file_id: input.finance_file_id || null,
        correlation_id: input.correlation_id || null,
        title: input.title,
        body: input.body || null,
        link_path: input.link_path || null,
        metadata: {
          ...(input.metadata || {}),
          delivered_channels: channels,
          urgent: isUrgent,
        },
      });

      // NOTE: email + push channel fan-out is intentionally NOT done here.
      // Those dispatchers (send-transactional-email, web-push) consume from
      // finance_portal_notifications via downstream cron + the existing
      // notification dispatcher. Recording the intent in metadata lets the
      // dispatcher honour the per-event routing matrix without changing this
      // helper's contract.
    }

    if (rows.length === 0) return { inserted: 0, skipped };

    const { error: iErr } = await supabase
      .from('finance_portal_notifications')
      .insert(rows);

    if (iErr) return { inserted: 0, skipped, error: iErr.message };
    return { inserted: rows.length, skipped };
  } catch (err: any) {
    return { inserted: 0, skipped: 0, error: err.message || 'notification failed' };
  }
}
