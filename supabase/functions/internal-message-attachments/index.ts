// Dedicated attachment transport for internal staff messaging.
// Kept separate from `internal-messaging` so attachment releases cannot be
// shadowed by a stale deployment of the main messaging function.
import { createClient } from 'npm:@supabase/supabase-js@2.45.0';
import { createCorsHeaders, createUnauthorizedResponse, verifyAuth } from '../_shared/auth.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
import { internalError } from '../_shared/errorResponse.ts';

const BUCKET = 'internal-message-attachments';
// JSON/base64 adds about 33% overhead and Edge requests have a platform body
// ceiling. Stay comfortably below it; larger files use signed streaming.
const DIRECT_MAX_BYTES = 3 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dll', 'com', 'scr', 'pif', 'msi', 'msp', 'cpl', 'jar', 'app',
  'bat', 'cmd', 'sh', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta',
  'apk', 'deb', 'rpm', 'dmg',
]);

function response(payload: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function safeFileName(value: unknown) {
  const flat = String(value || 'file').replace(/[^\w.\- ]+/g, '_').trim().slice(-120);
  return flat || 'file';
}

function decodeBase64(raw: string): Uint8Array | null {
  try {
    const value = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return response({ success: false, error: 'method_not_allowed' }, 405, cors);
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(cors, csrf);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return response({ success: false, error: 'service_not_configured' }, 500, cors);

    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const auth = await verifyAuth(db, req.headers, body);
    if (auth.error || !auth.userId) {
      return createUnauthorizedResponse(auth.error ?? 'Authentication required', cors);
    }

    const operation = String(body.operation ?? '');
    const threadId = String(body.thread_id ?? '');
    if (!threadId) return response({ success: false, error: 'thread_id_required' }, 400, cors);

    const { data: participant } = await db
      .from('internal_thread_participants')
      .select('id')
      .eq('thread_id', threadId)
      .eq('user_id', auth.userId)
      .eq('is_active', true)
      .maybeSingle();
    if (!participant) return response({ success: false, error: 'not_a_participant' }, 403, cors);

    if (operation === 'upload_direct') {
      const fileName = safeFileName(body.file_name);
      const extension = (fileName.split('.').pop() ?? '').toLowerCase();
      if (BLOCKED_EXTENSIONS.has(extension)) {
        return response({ success: false, error: 'attachment_type_blocked' }, 400, cors);
      }
      const bytes = decodeBase64(String(body.file_data ?? ''));
      if (!bytes) return response({ success: false, error: 'invalid_file_data' }, 400, cors);
      if (bytes.byteLength > DIRECT_MAX_BYTES) {
        return response({ success: false, error: 'direct_upload_too_large', use_ticket: true }, 413, cors);
      }

      const contentType = String(body.content_type ?? 'application/octet-stream').slice(0, 200);
      const path = `${threadId}/${crypto.randomUUID()}-${fileName}`;
      const { error } = await db.storage.from(BUCKET).upload(path, bytes, {
        contentType,
        upsert: false,
      });
      if (error) return response({ success: false, error: error.message }, 500, cors);

      return response({
        success: true,
        attachment: {
          name: fileName,
          path,
          mime: contentType,
          size: bytes.byteLength,
          scan: { status: 'unscanned', engine: 'transport-gate', at: new Date().toISOString() },
        },
      }, 200, cors);
    }

    if (operation === 'upload_ticket') {
      const fileName = safeFileName(body.file_name);
      const extension = (fileName.split('.').pop() ?? '').toLowerCase();
      if (BLOCKED_EXTENSIONS.has(extension)) {
        return response({ success: false, error: 'attachment_type_blocked' }, 400, cors);
      }
      const path = `${threadId}/${crypto.randomUUID()}-${fileName}`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) return response({ success: false, error: error?.message ?? 'ticket_failed' }, 500, cors);
      const raw = data.signedUrl ?? '';
      const signedUrl = raw.startsWith('http')
        ? raw
        : `${url}/storage/v1${raw.startsWith('/') ? '' : '/'}${raw}`;
      return response({ success: true, path, token: data.token, signed_url: signedUrl, file_name: fileName }, 200, cors);
    }

    // Authoritative attachment send. Uploading and then asking a second,
    // independently deployed function to copy attachment metadata proved too
    // fragile. This operation verifies the stored objects and creates the
    // message with its attachment JSON in one database insert, so there is no
    // intermediate "green upload but invisible message" state.
    if (operation === 'send') {
      const text = String(body.message_body ?? '').trim();
      const priorityValues = new Set(['normal', 'high', 'urgent']);
      const requestedPriority = String(body.priority ?? 'normal');
      const priority = priorityValues.has(requestedPriority) ? requestedPriority : 'normal';
      const incoming = Array.isArray(body.attachments) ? body.attachments : [];
      if (text.length > 4000) return response({ success: false, error: 'body_too_long' }, 400, cors);
      if (!text && !incoming.length) return response({ success: false, error: 'body_or_attachment_required' }, 400, cors);

      const cleaned: Record<string, unknown>[] = [];
      for (const raw of incoming.slice(0, 25)) {
        const item = (raw ?? {}) as Record<string, unknown>;
        const path = String(item.path ?? '');
        if (!path.startsWith(`${threadId}/`)) continue;
        const name = safeFileName(item.name);
        const extension = (name.split('.').pop() ?? '').toLowerCase();
        if (BLOCKED_EXTENSIONS.has(extension)) continue;
        const { data: object, error: objectError } = await db.storage.from(BUCKET).download(path);
        if (objectError || !object) continue;
        const bytes = new Uint8Array(await object.slice(0, 16).arrayBuffer());
        const executable = bytes[0] === 0x4d && bytes[1] === 0x5a;
        if (executable) {
          await db.storage.from(BUCKET).remove([path]);
          continue;
        }
        cleaned.push({
          name,
          path,
          mime: String(item.mime ?? object.type ?? 'application/octet-stream').slice(0, 200),
          size: Number(item.size ?? object.size ?? 0) || 0,
          scan: { status: 'clean', engine: 'attachment-send-gate', at: new Date().toISOString() },
        });
      }
      if (incoming.length && cleaned.length !== incoming.slice(0, 25).length) {
        return response({ success: false, error: 'one_or_more_attachments_rejected' }, 400, cors);
      }

      const { data: message, error: messageError } = await db
        .from('internal_messages')
        .insert({ thread_id: threadId, sender_id: auth.userId, body: text, priority, attachments: cleaned })
        .select('id, thread_id, sender_id, body, created_at, priority, attachments')
        .single();
      if (messageError || !message) {
        return response({ success: false, error: messageError?.message ?? 'message_create_failed' }, 500, cors);
      }

      const now = new Date().toISOString();
      await db.from('internal_message_threads').update({
        last_message_at: now,
        last_message_preview: text.slice(0, 180) || `${cleaned.length} attachment${cleaned.length === 1 ? '' : 's'}`,
        updated_at: now,
      }).eq('id', threadId);
      await db.from('internal_thread_participants').update({ last_read_at: now })
        .eq('thread_id', threadId).eq('user_id', auth.userId);
      await db.from('internal_thread_participants').update({ archived_at: null })
        .eq('thread_id', threadId).not('archived_at', 'is', null);

      const { data: sender } = await db.from('custom_users').select('username')
        .eq('id', auth.userId).maybeSingle();
      const { data: recipients } = await db.from('internal_thread_participants').select('user_id')
        .eq('thread_id', threadId).eq('is_active', true).neq('user_id', auth.userId);
      const notificationRows = (recipients ?? []).map((recipient) => ({
        type: 'internal_message',
        title: `New message from ${sender?.username ?? 'A team member'}`,
        message: text.slice(0, 180) || `Sent ${cleaned.length} attachment${cleaned.length === 1 ? '' : 's'}`,
        target_user_id: recipient.user_id,
        entity_id: threadId,
      }));
      if (notificationRows.length) await db.from('notifications').insert(notificationRows);

      return response({ success: true, thread_id: threadId, message }, 200, cors);
    }

    // Bind already-uploaded objects to a message row. This is the delivery
    // guarantee: even if the main messaging deployment is behind and drops the
    // `attachments` payload, the transport can still persist them so both the
    // sender and every recipient see and download the files.
    if (operation === 'attach') {
      const messageId = String(body.message_id ?? '');
      if (!messageId) return response({ success: false, error: 'message_id_required' }, 400, cors);
      const incoming = Array.isArray(body.attachments) ? body.attachments : [];

      const cleaned: Record<string, unknown>[] = [];
      for (const raw of incoming.slice(0, 25)) {
        const item = (raw ?? {}) as Record<string, unknown>;
        const path = String(item.path ?? '');
        if (!path.startsWith(`${threadId}/`)) continue;
        const name = safeFileName(item.name);
        const extension = (name.split('.').pop() ?? '').toLowerCase();
        if (BLOCKED_EXTENSIONS.has(extension)) continue;
        // Confirm the object actually exists before advertising it.
        const { data: probe } = await db.storage.from(BUCKET).createSignedUrl(path, 30);
        if (!probe?.signedUrl) continue;
        cleaned.push({
          name,
          path,
          mime: String(item.mime ?? 'application/octet-stream').slice(0, 200),
          size: Number(item.size ?? 0) || 0,
          scan: item.scan ?? { status: 'unscanned', engine: 'transport-gate', at: new Date().toISOString() },
        });
      }
      if (!cleaned.length) return response({ success: false, error: 'no_valid_attachments' }, 400, cors);

      const { data: message } = await db
        .from('internal_messages')
        .select('id, thread_id, sender_id, attachments')
        .eq('id', messageId)
        .maybeSingle();
      if (!message || message.thread_id !== threadId) {
        return response({ success: false, error: 'message_not_found' }, 404, cors);
      }
      if (message.sender_id !== auth.userId) {
        return response({ success: false, error: 'not_message_sender' }, 403, cors);
      }

      const existing = Array.isArray(message.attachments) ? message.attachments : [];
      const byPath = new Map<string, Record<string, unknown>>();
      for (const item of [...existing, ...cleaned] as Record<string, unknown>[]) {
        const key = String(item?.path ?? '');
        if (key) byPath.set(key, item);
      }
      const merged = [...byPath.values()];

      const { data: updated, error: updateError } = await db
        .from('internal_messages')
        .update({ attachments: merged })
        .eq('id', messageId)
        .select('id, thread_id, sender_id, body, created_at, priority, attachments')
        .single();
      if (updateError) return response({ success: false, error: updateError.message }, 500, cors);

      return response({ success: true, message: updated, attachments: merged }, 200, cors);
    }

    // Read-side delivery guarantee. `get_thread` on the main messaging function
    // has repeatedly shipped behind, dropping the `attachments` column from its
    // projection — which rendered as an empty grey bubble. The client hydrates
    // from here instead, so attachment visibility never depends on that deploy.
    if (operation === 'hydrate') {
      const { data: rows, error: rowsError } = await db
        .from('internal_messages')
        .select('id, attachments')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(500);
      if (rowsError) return response({ success: false, error: rowsError.message }, 500, cors);
      const map: Record<string, unknown[]> = {};
      for (const row of rows ?? []) {
        const list = Array.isArray(row.attachments) ? row.attachments : [];
        if (list.length) map[row.id as string] = list;
      }
      return response({ success: true, attachments_by_message: map }, 200, cors);
    }

    if (operation === 'download_ticket') {

      const path = String(body.path ?? '');
      if (!path.startsWith(`${threadId}/`)) return response({ success: false, error: 'invalid_path' }, 400, cors);
      const options = body.download === true ? { download: true } : undefined;
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 300, options);
      if (error || !data) return response({ success: false, error: error?.message ?? 'ticket_failed' }, 500, cors);
      return response({ success: true, signed_url: data.signedUrl }, 200, cors);
    }

    return response({ success: false, error: 'unknown_operation' }, 400, cors);
  } catch (error) {
    console.error('[internal-message-attachments]', error);
    return response({ ...internalError(error, 'internal-message-attachments'), success: false }, 500, cors);
  }
});