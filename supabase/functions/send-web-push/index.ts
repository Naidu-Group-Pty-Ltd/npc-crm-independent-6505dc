// Web Push dispatcher — invoked by the `dispatch_web_push_on_notification` DB trigger.
// WP-04 hardened: caller supplies only `notification_id`; every user-visible
// field is derived from the notifications row via service role. URL is
// validated against an allowlist. Idempotency is enforced against
// push_delivery_log so retries never fan out duplicate pushes.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { resolveVapidSubject } from '../_shared/vapidSubject.pure.ts';
import webpush from 'https://esm.sh/web-push@3.6.7';
import { verifySignedInternal, securityJsonError } from '../_shared/requestSecurity.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SubscriberType = 'staff' | 'client_portal' | 'finance_portal' | 'solicitor_portal';
const VALID_SUBSCRIBERS: readonly SubscriberType[] = ['staff', 'client_portal', 'finance_portal', 'solicitor_portal'];

/**
 * Each portal keeps its own notification table with its own column names, and
 * this function used to read `public.notifications` unconditionally. The portal
 * triggers passed it a `client_portal_notifications.id`, the lookup found
 * nothing, and every portal push answered "No target" — silently, for as long
 * as the feature has existed.
 *
 * `recipientColumn` is null for client_portal because that table addresses a
 * CLIENT, not a portal user; recipients are fanned out from client_portal_users.
 */
const SOURCES: Record<SubscriberType, {
  table: string;
  titleColumn: string;
  bodyColumn: string;
  linkColumn: string | null;
  typeColumn: string;
  recipientColumn: string | null;
}> = {
  staff: {
    table: 'notifications', titleColumn: 'title', bodyColumn: 'message',
    linkColumn: 'link', typeColumn: 'type', recipientColumn: 'target_user_id',
  },
  client_portal: {
    table: 'client_portal_notifications', titleColumn: 'title', bodyColumn: 'message',
    linkColumn: 'action_url', typeColumn: 'type', recipientColumn: null,
  },
  finance_portal: {
    table: 'finance_portal_notifications', titleColumn: 'title', bodyColumn: 'body',
    linkColumn: 'link_path', typeColumn: 'notification_type', recipientColumn: 'portal_user_id',
  },
  solicitor_portal: {
    table: 'solicitor_portal_notifications', titleColumn: 'title', bodyColumn: 'body',
    linkColumn: 'link_path', typeColumn: 'notification_type', recipientColumn: 'solicitor_user_id',
  },
};

interface DispatchPayload {
  notification_id: string;
  /** Which portal's table to read. Defaults to staff for backwards compatibility. */
  source?: SubscriberType;
  attempt_id?: string;
}

/**
 * URL allowlist: accept in-app paths ("/foo/bar"), same-app absolute URLs, and
 * reject dangerous schemes (javascript:, data:, vbscript:, file:) plus
 * external origins. Fails closed to "/" if the persisted metadata is unsafe.
 */
function sanitizeUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return '/';
  const trimmed = raw.trim();
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '/';
    // Restrict to the app's own public host, if configured. Otherwise reject
    // any absolute URL (relative in-app paths are the intended shape).
    const allowedHost = (Deno.env.get('WEB_PUSH_ALLOWED_HOST') || '').trim().toLowerCase();
    if (!allowedHost) return '/';
    return u.hostname.toLowerCase() === allowedHost ? u.pathname + u.search + u.hash : '/';
  } catch {
    return '/';
  }
}

function clamp(text: unknown, max: number): string {
  const s = typeof text === 'string' ? text : '';
  return s.length > max ? s.slice(0, max) : s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Read the body ONCE: the HMAC path signs the exact bytes, so it cannot be
  // re-read after `req.json()`.
  const rawBody = await req.text();

  try {
    // Auth: the signed internal envelope, and only that (WP-12).
    //
    // This used to try a raw `x-internal-edge-secret` compare first and fall
    // back to the signed check. Reading that header here is what WP-12 forbids:
    // a bearer-style shared secret is replayable, carries no caller identity and
    // no body binding, so it cannot be reasoned about the way the HMAC envelope
    // can. Every caller already sends the envelope —
    // `dispatch_web_push_for_portal_notification` and the staff dispatcher both
    // build their headers with `public.cron_signed_internal_headers(...)`, which
    // signs the method, target, body and declared caller — so dropping the
    // static path removes a redundant weaker credential rather than a
    // capability. `verifySignedInternal` binds the signature to `rawBody` and
    // restricts the declared caller to the two below; it fails closed when
    // INTERNAL_EDGE_SECRET is short or absent.
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const signed = await verifySignedInternal(authClient, req, rawBody, [
      'notifications_trigger',
      'pg_cron',
    ]);
    if (!signed.ok) return securityJsonError(401, 'unauthorized');

    const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY');
    const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      console.error('[send-web-push] VAPID keys not configured');
      return securityJsonError(503, 'service_unavailable');
    }
    // The contact a push service uses about THIS sender. `mailto:` and
    // `https:` are both valid (RFC 8292 §2.1) and the prefix that stood here
    // corrupted the second: `https://x` became `mailto:https://x`. Every
    // deployment of this platform is its own sender with its own key pair, so
    // the subject is its own site or its own address — see
    // `_shared/vapidSubject.pure.ts` for why there is no default any more.
    const subject = resolveVapidSubject(Deno.env.get('VAPID_SUBJECT_EMAIL'));
    if (!subject.ok) {
      console.error(`[send-web-push] VAPID subject ${subject.reason}: ${subject.detail}`);
      return securityJsonError(503, 'service_unavailable');
    }
    webpush.setVapidDetails(subject.subject, VAPID_PUBLIC, VAPID_PRIVATE);

    let payload: DispatchPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return securityJsonError(400, 'invalid_request');
    }
    const notificationId = typeof payload?.notification_id === 'string' ? payload.notification_id.trim() : '';
    if (!/^[0-9a-fA-F-]{16,64}$/.test(notificationId)) {
      return securityJsonError(400, 'invalid_request');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Derive every field server-side from the persisted row, in whichever
    // portal's table the caller named. `source` selects the table only — the
    // CONTENT is never taken from the request.
    const requested = payload?.source;
    const subscriberType: SubscriberType =
      VALID_SUBSCRIBERS.includes(requested as SubscriberType) ? (requested as SubscriberType) : 'staff';
    const src = SOURCES[subscriberType];

    const columns = [
      'id', src.titleColumn, src.bodyColumn, src.typeColumn,
      ...(src.linkColumn ? [src.linkColumn] : []),
      ...(src.recipientColumn ? [src.recipientColumn] : []),
      ...(subscriberType === 'client_portal' ? ['client_id'] : []),
    ];
    const { data: notif, error: notifErr } = await supabase
      .from(src.table)
      .select([...new Set(columns)].join(', '))
      .eq('id', notificationId)
      .maybeSingle();

    if (notifErr) {
      console.error('[send-web-push] notification lookup failed', src.table, notifErr.message);
      return securityJsonError(503, 'service_unavailable');
    }
    if (!notif) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: 'No such notification' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    /*
     * Through `unknown`, which is what the compiler asks for: the row comes
     * back as a PostgREST union that can be a `GenericStringError`, and that
     * has no string index signature to narrow from. Types are erased at
     * runtime, so this is the same object it always was.
     *
     * Not part of the AML work — the edge type-check ratchet fails on it for
     * every branch cut from main, so the AML PR carrying it is incidental.
     */
    const row = notif as unknown as Record<string, unknown>;

    // Recipients. Most tables address one user. `client_portal_notifications`
    // addresses a CLIENT, so it fans out to that client's active portal users —
    // which is why it has no recipient column of its own.
    let recipientIds: string[] = [];
    if (subscriberType === 'client_portal') {
      const { data: portalUsers } = await supabase
        .from('client_portal_users')
        .select('id')
        .eq('client_id', row.client_id as string)
        .eq('status', 'active');
      recipientIds = (portalUsers ?? []).map((u: { id: string }) => u.id);
    } else if (src.recipientColumn && row[src.recipientColumn]) {
      recipientIds = [row[src.recipientColumn] as string];
    }

    if (recipientIds.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: 'No target' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const title = clamp(row[src.titleColumn], 120) || 'Notification';
    const body = clamp(row[src.bodyColumn], 400);
    const url = sanitizeUrl(src.linkColumn ? row[src.linkColumn] : null);
    const category = clamp(row[src.typeColumn], 64) || null;

    const { data: subs, error } = await supabase

      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', recipientIds)
      .eq('subscriber_type', subscriberType)
      .eq('is_active', true);

    if (error) throw error;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, message: 'No subscriptions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Idempotency: skip subscriptions that already have a successful delivery
    // recorded for this notification_id. Protects retries + duplicate trigger fires.
    const { data: existing } = await supabase
      .from('push_delivery_log')
      .select('subscription_id')
      .eq('notification_id', notificationId)
      .eq('status', 'sent');
    const already = new Set((existing ?? []).map((r: any) => r.subscription_id));
    const targets = subs.filter((s) => !already.has(s.id));

    if (targets.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, total: subs.length, skipped: 'idempotent' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pushPayload = JSON.stringify({
      title,
      body,
      url,
      category,
      notification_id: notificationId,
    });

    const results = await Promise.all(
      targets.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            pushPayload,
          );
          await supabase.from('push_delivery_log').insert({
            subscription_id: sub.id,
            user_id: sub.user_id,
            notification_id: notificationId,
            status: 'sent',
            status_code: 201,
            payload_title: title,
          });
          return { id: sub.id, ok: true };
        } catch (err: any) {
          const code = err?.statusCode || 0;
          if (code === 404 || code === 410) {
            await supabase.from('push_subscriptions').update({ is_active: false }).eq('id', sub.id);
          }
          await supabase.from('push_delivery_log').insert({
            subscription_id: sub.id,
            user_id: sub.user_id,
            notification_id: notificationId,
            status: 'failed',
            status_code: code,
            // Redact provider error details from client-visible responses; only log server-side.
            error_message: String(err?.body || err?.message || err).slice(0, 500),
            payload_title: title,
          });
          return { id: sub.id, ok: false };
        }
      }),
    );

    const sent = results.filter((r) => r.ok).length;
    return new Response(JSON.stringify({ success: true, sent, total: subs.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[send-web-push] error', err);
    return securityJsonError(503, 'service_unavailable');
  }
});
