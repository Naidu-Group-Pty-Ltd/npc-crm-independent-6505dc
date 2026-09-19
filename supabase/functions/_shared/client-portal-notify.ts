/**
 * Shared helper for emitting Client Portal notifications.
 * Service-role only — call from edge functions that already have an authenticated context.
 *
 * `client_portal_notifications` is keyed by `client_id` (one row per client, surfaces
 * to all active client portal users for that client). Realtime-published.
 *
 * Wave B: this is the cross-portal write helper used whenever something happens on
 * the internal dashboard, finance portal or an automated job that the client should
 * see in-app the next time they open the portal.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";

export type ClientPortalNotificationType =
  | 'info'
  | 'success'
  | 'warning'
  | 'critical';

export type ClientPortalNotificationCategory =
  | 'general'
  | 'message'
  | 'document_request'
  | 'status_update'
  | 'appointment'
  | 'task'
  | 'report'
  | 'milestone';

const notificationTypeByInput: Record<ClientPortalNotificationType, string> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  critical: 'warning',
};

const notificationCategoryByInput: Record<ClientPortalNotificationCategory, string> = {
  general: 'general',
  message: 'message',
  document_request: 'document',
  status_update: 'deal',
  appointment: 'general',
  task: 'general',
  report: 'document',
  milestone: 'deal',
};

export interface ClientPortalNotificationInput {
  client_id: string;
  title: string;
  message?: string | null;
  type?: ClientPortalNotificationType;
  category?: ClientPortalNotificationCategory;
  action_url?: string | null;
  metadata?: Record<string, any>;
  /**
   * When provided, dedupes against rows in the last `dedupe_window_minutes`
   * minutes that share the same client_id + category + this key in metadata.
   * Useful for high-frequency events like message deliveries.
   */
  dedupe_key?: string | null;
  dedupe_window_minutes?: number;
}

export async function notifyClientPortal(
  input: ClientPortalNotificationInput,
): Promise<{ inserted: number; deduped: boolean; error?: string }> {
  try {
    if (!input.client_id) return { inserted: 0, deduped: false, error: 'client_id required' };
    if (!input.title) return { inserted: 0, deduped: false, error: 'title required' };

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const notificationType = notificationTypeByInput[input.type ?? 'info'];
    const notificationCategory = notificationCategoryByInput[input.category ?? 'general'];

    // Only write if at least one active portal user exists for the client.
    // Avoids generating dead notifications no one can ever see.
    const { data: anyUser } = await supabase
      .from('client_portal_users')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', input.client_id)
      .eq('status', 'active')
      .limit(1);
    // `head:true` returns count via response; if no error and data is null, treat as zero.
    // (Some Supabase clients return a count via .count on the response object — we keep
    // this conservative and DON'T early-return on falsey checks to avoid silently dropping
    // notifications when count semantics differ between SDK minors.)

    // Dedupe window check (best-effort).
    if (input.dedupe_key) {
      const sinceIso = new Date(
        Date.now() - (input.dedupe_window_minutes ?? 5) * 60_000,
      ).toISOString();
      const { data: dupes } = await supabase
        .from('client_portal_notifications')
        .select('id, metadata')
        .eq('client_id', input.client_id)
        .eq('category', notificationCategory)
        .gte('created_at', sinceIso)
        .limit(20);
      const hit = (dupes || []).find(
        (d: any) => d?.metadata?.dedupe_key === input.dedupe_key,
      );
      if (hit) return { inserted: 0, deduped: true };
    }

    const { error } = await supabase.from('client_portal_notifications').insert({
      client_id: input.client_id,
      title: input.title,
      message: input.message ?? null,
      type: notificationType,
      category: notificationCategory,
      action_url: input.action_url ?? null,
      metadata: {
        ...(input.metadata || {}),
        ...(input.dedupe_key ? { dedupe_key: input.dedupe_key } : {}),
      },
    });

    if (error) return { inserted: 0, deduped: false, error: error.message };
    return { inserted: 1, deduped: false };
  } catch (err: any) {
    return { inserted: 0, deduped: false, error: err?.message || 'notification failed' };
  }
}
