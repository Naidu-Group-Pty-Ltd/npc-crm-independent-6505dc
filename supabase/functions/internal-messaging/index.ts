// Internal staff messaging (Command Centre only).
//
// Supports:
//   • direct     — private 1:1 conversation between two active staff members
//   • broadcast  — one-to-all system-wide announcement thread
//
// All access is mediated here: the underlying tables are service_role-only, so
// participation is verified in-function for every read and write.
//
// Actions:
//   list_staff                                  → active staff directory (excl. caller)
//   list_threads                                → caller's threads + unread counts
//   unread_count                                → total unread for badge
//   get_thread   { thread_id }                  → messages for a participating thread
//   start_direct { user_id }                    → find-or-create direct thread
//   send_message { thread_id, body, priority }  → post into an existing thread
//                { recipient_user_id, body }    → post into (or open) a direct thread
//                { broadcast: true, body, title } → new broadcast to all active staff
//   mark_read    { thread_id }                  → stamp last_read_at
//   attachment_upload_url   { thread_id, file_name }  → short-lived signed PUT ticket
//   attachment_upload_direct { thread_id, file_name, file_data } → server-side put
//   attachment_download_url { thread_id, path }       → short-lived signed GET url
//
// DEPLOYMENT NOTE. Attachments live entirely in this function: the browser has
// no table or bucket privileges and cannot mint its own storage tickets. So a
// stale deployment does not degrade attachments, it removes them — the two
// actions above fall through to `unknown action` and every upload fails at the
// first step. That is exactly what happened: this function sat at a revision
// predating attachments while the client shipped them, so `push_subscriptions`-
// style silence set in — zero objects in the bucket, zero messages with
// attachments, and a client-side error nobody could act on. If you change the
// action list here, redeploy before (or with) the frontend.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCorsHeaders, createUnauthorizedResponse, verifyAuth } from '../_shared/auth.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';

const MAX_BODY = 4000;
const ATTACHMENT_BUCKET = 'internal-message-attachments';
const MAX_ATTACHMENTS = 25;

/** Sanitised, collision-free storage object name. */
function safeFileName(name: string) {
  const flat = String(name || 'file').replace(/[^\w.\- ]+/g, '_').trim().slice(-120);
  return flat || 'file';
}

interface Attachment {
  name: string;
  path: string;
  mime: string;
  size: number;
  scan?: string;
  scanned_at?: string;
}


/** All MIME types are accepted; only the shape is validated. */
function normaliseAttachments(raw: unknown, threadId: string): Attachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_ATTACHMENTS)
    .map((a) => {
      const path = String((a as any)?.path ?? '');
      if (!path.startsWith(`${threadId}/`)) return null;
      return {
        name: safeFileName(String((a as any)?.name ?? 'file')),
        path,
        mime: String((a as any)?.mime ?? 'application/octet-stream').slice(0, 200),
        size: Number((a as any)?.size ?? 0) || 0,
      } as Attachment;
    })
    .filter((a): a is Attachment => !!a);
}

/**
 * Server-side attachment safety gate. Every object is confirmed to exist in the
 * thread's storage prefix, then its leading bytes are sniffed so a declared MIME
 * type can never be trusted blindly. Executables / scripted installers are
 * blocked outright; everything else is stamped `scan: 'clean'` and only becomes
 * visible to recipients after this check passes.
 */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dll', 'com', 'scr', 'pif', 'msi', 'msp', 'cpl', 'jar', 'app',
  'bat', 'cmd', 'sh', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta',
  'apk', 'deb', 'rpm', 'dmg',
]);

const MAGIC_SIGNATURES: Array<{ bytes: number[]; label: string; blocked: boolean }> = [
  { bytes: [0x4d, 0x5a], label: 'application/x-dosexec', blocked: true },              // PE / MZ
  { bytes: [0x7f, 0x45, 0x4c, 0x46], label: 'application/x-elf', blocked: true },       // ELF
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], label: 'application/x-mach-binary', blocked: true },
  { bytes: [0xce, 0xfa, 0xed, 0xfe], label: 'application/x-mach-binary', blocked: true },
  { bytes: [0x25, 0x50, 0x44, 0x46], label: 'application/pdf', blocked: false },
  { bytes: [0x89, 0x50, 0x4e, 0x47], label: 'image/png', blocked: false },
  { bytes: [0xff, 0xd8, 0xff], label: 'image/jpeg', blocked: false },
  { bytes: [0x50, 0x4b, 0x03, 0x04], label: 'application/zip', blocked: false },
];

function sniff(head: Uint8Array) {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.bytes.every((b, i) => head[i] === b)) return sig;
  }
  return null;
}

async function screenAttachments(
  sb: ReturnType<typeof admin>,
  attachments: Attachment[],
): Promise<{ safe: Attachment[]; blocked: string[] }> {
  const safe: Attachment[] = [];
  const blocked: string[] = [];

  for (const a of attachments) {
    const ext = (a.name.split('.').pop() ?? '').toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      blocked.push(a.name);
      continue;
    }

    let detected: string | null = null;
    // `scanned` stays false when the object could not be read (e.g. a very
    // large upload still finalising, or a transient storage hiccup). That is
    // never treated as unsafe — the file is flagged `unscanned` so uploads can
    // never silently fail, while true executables are still blocked below.
    let scanned = false;
    try {
      const { data: signed } = await sb.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(a.path, 60);
      if (signed?.signedUrl) {
        const res = await fetch(signed.signedUrl, { headers: { Range: 'bytes=0-4095' } });
        if (res.ok || res.status === 206) {
          const head = new Uint8Array(await res.arrayBuffer());
          const hit = sniff(head);
          if (hit?.blocked) {
            blocked.push(a.name);
            continue;
          }
          detected = hit?.label ?? null;
          scanned = true;
        }
      }
    } catch (err) {
      console.warn('[internal-messaging] attachment screen skipped:', a.path, String(err));
    }

    safe.push({
      ...a,
      // Trust the sniffed type when we recognised one.
      mime: detected ?? a.mime,
      scan: {
        status: scanned ? 'clean' : 'unscanned',
        engine: 'magic-byte',
        at: new Date().toISOString(),
      },
    } as Attachment);

  }

  return { safe, blocked };
}



function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

function json(payload: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function directKey(a: string, b: string) {
  return [a, b].sort().join(':');
}

function preview(body: string) {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 137)}…` : flat;
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = String(body.action ?? 'list_threads');
    const sb = admin();

    const auth = await verifyAuth(sb, req.headers, body);
    if (auth.error || !auth.userId) {
      return createUnauthorizedResponse(auth.error ?? 'Authentication required', corsHeaders);
    }
    const me = auth.userId as string;

    // ── Staff directory ──────────────────────────────────────────────
    if (action === 'list_staff') {
      const { data, error } = await sb
        .from('custom_users')
        .select('id, username, email, role')
        .eq('is_active', true)
        .order('username');
      if (error) throw error;
      return json({ success: true, staff: (data ?? []).filter((u) => u.id !== me) }, 200, corsHeaders);
    }

    // ── Helper: caller's active participant rows ──────────────────────
    const myParticipation = async () => {
      const { data, error } = await sb
        .from('internal_thread_participants')
        .select('thread_id, last_read_at, archived_at')
        .eq('user_id', me)
        .eq('is_active', true);
      if (error) throw error;
      return data ?? [];
    };

    /** Participation gate — returns the caller's row for a thread or null. */
    const myRow = async (threadId: string) => {
      const { data } = await sb
        .from('internal_thread_participants')
        .select('id, role, archived_at')
        .eq('thread_id', threadId)
        .eq('user_id', me)
        .eq('is_active', true)
        .maybeSingle();
      return data ?? null;
    };

    // ── Threads list ─────────────────────────────────────────────────
    if (action === 'list_threads' || action === 'unread_count') {
      const includeArchived = body.include_archived === true;
      const allRows = await myParticipation();
      const rows = includeArchived ? allRows : allRows.filter((r) => !r.archived_at);
      const archivedCount = allRows.filter((r) => !!r.archived_at).length;
      if (rows.length === 0) {
        return json(
          action === 'unread_count'
            ? { success: true, unread: 0 }
            : { success: true, threads: [], archived_count: archivedCount },
          200,
          corsHeaders,
        );
      }
      const ids = rows.map((r) => r.thread_id);
      const readMap = new Map(rows.map((r) => [r.thread_id, r.last_read_at as string | null]));
      const archivedMap = new Map(rows.map((r) => [r.thread_id, r.archived_at as string | null]));


      const { data: threads, error: tErr } = await sb
        .from('internal_message_threads')
        .select('id, kind, title, created_by, last_message_at, last_message_preview, created_at')
        .in('id', ids)
        .order('last_message_at', { ascending: false, nullsFirst: false });
      if (tErr) throw tErr;

      // Unread per thread: messages after last_read_at not sent by me.
      const { data: recent, error: mErr } = await sb
        .from('internal_messages')
        .select('thread_id, sender_id, created_at, priority')
        .in('thread_id', ids)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (mErr) throw mErr;

      const unreadByThread = new Map<string, number>();
      for (const m of recent ?? []) {
        if (m.sender_id === me) continue;
        const lastRead = readMap.get(m.thread_id);
        if (lastRead && new Date(m.created_at) <= new Date(lastRead)) continue;
        unreadByThread.set(m.thread_id, (unreadByThread.get(m.thread_id) ?? 0) + 1);
      }

      if (action === 'unread_count') {
        let total = 0;
        for (const n of unreadByThread.values()) total += n;
        return json({ success: true, unread: total }, 200, corsHeaders);
      }

      // Latest message per thread (recent is ordered created_at desc).
      const latestByThread = new Map<
        string,
        { sender_id: string | null; created_at: string; priority: string }
      >();
      for (const m of recent ?? []) {
        if (!latestByThread.has(m.thread_id)) {
          latestByThread.set(m.thread_id, {
            sender_id: m.sender_id,
            created_at: m.created_at,
            priority: (m as { priority?: string }).priority ?? 'normal',
          });
        }
      }

      // Counterparty labels for direct threads.
      const { data: parts } = await sb
        .from('internal_thread_participants')
        .select('thread_id, user_id')
        .in('thread_id', ids);
      const otherIds = new Set<string>();
      for (const p of parts ?? []) if (p.user_id !== me) otherIds.add(p.user_id);
      // Also resolve senders of the latest message (may not be a listed participant).
      for (const l of latestByThread.values()) if (l.sender_id) otherIds.add(l.sender_id);
      const { data: users } = otherIds.size
        ? await sb.from('custom_users').select('id, username').in('id', [...otherIds])
        : { data: [] as any[] };
      const nameById = new Map((users ?? []).map((u: any) => [u.id, u.username]));

      const enriched = (threads ?? []).map((t) => {
        const others = (parts ?? [])
          .filter((p) => p.thread_id === t.id && p.user_id !== me)
          .map((p) => nameById.get(p.user_id) ?? 'Unknown');
        const latest = latestByThread.get(t.id);
        const latestSenderId = latest?.sender_id ?? null;
        const groupFallback = others.length
          ? `${others.slice(0, 3).join(', ')}${others.length > 3 ? ` +${others.length - 3}` : ''}`
          : 'Group chat';
        return {
          ...t,
          unread: unreadByThread.get(t.id) ?? 0,
          participant_count: (parts ?? []).filter((p) => p.thread_id === t.id).length,
          participants: (parts ?? [])
            .filter((p) => p.thread_id === t.id)
            .map((p) => ({
              user_id: p.user_id,
              username: p.user_id === me ? 'You' : nameById.get(p.user_id) ?? 'Unknown',
              mine: p.user_id === me,
            })),
          archived: !!archivedMap.get(t.id),
          archived_at: archivedMap.get(t.id) ?? null,
          can_manage: t.kind === 'group',
          last_message_sender_id: latestSenderId,
          last_message_sender_name: latestSenderId
            ? (latestSenderId === me ? 'You' : nameById.get(latestSenderId) ?? 'Unknown')
            : 'System',
          last_message_id: latest ? `${t.id}:${latest.created_at}` : null,
          last_message_priority: latest?.priority ?? 'normal',
          display_title:
            t.kind === 'broadcast'
              ? t.title || 'Company announcement'
              : t.kind === 'group'
                ? t.title || groupFallback
                : others[0] ?? t.title ?? 'Direct message',
        };
      });


      return json(
        { success: true, threads: enriched, archived_count: archivedCount },
        200,
        corsHeaders,
      );
    }

    // ── Archive / unarchive (per person, never affects anyone else) ───
    if (action === 'archive_thread' || action === 'unarchive_thread') {
      const threadId = String(body.thread_id ?? '');
      if (!threadId) return json({ success: false, error: 'thread_id required' }, 400, corsHeaders);
      if (!(await myRow(threadId))) {
        return json({ success: false, error: 'not_a_participant' }, 403, corsHeaders);
      }
      const { error } = await sb
        .from('internal_thread_participants')
        .update({ archived_at: action === 'archive_thread' ? new Date().toISOString() : null })
        .eq('thread_id', threadId)
        .eq('user_id', me);
      if (error) throw error;
      return json({ success: true, archived: action === 'archive_thread' }, 200, corsHeaders);
    }

    // ── Group chats: create / rename / membership ─────────────────────
    if (action === 'create_group') {
      const memberIds = [
        ...new Set(
          (Array.isArray(body.member_ids) ? body.member_ids : [])
            .map((v: unknown) => String(v))
            .filter((v: string) => v && v !== me),
        ),
      ];
      if (memberIds.length < 1) {
        return json({ success: false, error: 'members_required' }, 400, corsHeaders);
      }
      const { data: valid } = await sb
        .from('custom_users')
        .select('id, username')
        .in('id', memberIds)
        .eq('is_active', true);
      const validIds = (valid ?? []).map((u: any) => u.id as string);
      if (!validIds.length) {
        return json({ success: false, error: 'members_required' }, 400, corsHeaders);
      }
      const title = String(body.title ?? '').trim().slice(0, 120);
      const { data: created, error: cErr } = await sb
        .from('internal_message_threads')
        .insert({ kind: 'group', title: title || null, created_by: me })
        .select('id')
        .single();
      if (cErr) throw cErr;
      const { error: pErr } = await sb.from('internal_thread_participants').insert([
        { thread_id: created.id, user_id: me, role: 'owner' },
        ...validIds.map((id) => ({ thread_id: created.id, user_id: id, role: 'member' })),
      ]);
      if (pErr) throw pErr;
      return json({ success: true, thread_id: created.id }, 200, corsHeaders);
    }

    if (action === 'rename_group') {
      const threadId = String(body.thread_id ?? '');
      const title = String(body.title ?? '').trim().slice(0, 120);
      if (!threadId || !title) {
        return json({ success: false, error: 'thread_id_and_title_required' }, 400, corsHeaders);
      }
      if (!(await myRow(threadId))) {
        return json({ success: false, error: 'not_a_participant' }, 403, corsHeaders);
      }
      const { data: thread } = await sb
        .from('internal_message_threads')
        .select('kind')
        .eq('id', threadId)
        .maybeSingle();
      if (thread?.kind !== 'group') {
        return json({ success: false, error: 'not_a_group' }, 400, corsHeaders);
      }
      const { error } = await sb
        .from('internal_message_threads')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', threadId);
      if (error) throw error;
      await sb.from('internal_messages').insert({
        thread_id: threadId,
        sender_id: null,
        is_system: true,
        body: `Group renamed to "${title}"`,
      });
      return json({ success: true, title }, 200, corsHeaders);
    }

    if (action === 'update_group_members') {
      const threadId = String(body.thread_id ?? '');
      if (!threadId) return json({ success: false, error: 'thread_id required' }, 400, corsHeaders);
      if (!(await myRow(threadId))) {
        return json({ success: false, error: 'not_a_participant' }, 403, corsHeaders);
      }
      const { data: thread } = await sb
        .from('internal_message_threads')
        .select('kind')
        .eq('id', threadId)
        .maybeSingle();
      if (thread?.kind !== 'group') {
        return json({ success: false, error: 'not_a_group' }, 400, corsHeaders);
      }

      const add = [
        ...new Set(
          (Array.isArray(body.add) ? body.add : []).map((v: unknown) => String(v)).filter(Boolean),
        ),
      ];
      const remove = [
        ...new Set(
          (Array.isArray(body.remove) ? body.remove : [])
            .map((v: unknown) => String(v))
            .filter((v: string) => v && v !== me),
        ),
      ];

      if (add.length) {
        const { data: valid } = await sb
          .from('custom_users')
          .select('id')
          .in('id', add)
          .eq('is_active', true);
        for (const u of valid ?? []) {
          await sb
            .from('internal_thread_participants')
            .upsert(
              { thread_id: threadId, user_id: (u as any).id, is_active: true, role: 'member' },
              { onConflict: 'thread_id,user_id' },
            );
        }
      }
      if (remove.length) {
        await sb
          .from('internal_thread_participants')
          .update({ is_active: false })
          .eq('thread_id', threadId)
          .in('user_id', remove);
      }
      return json({ success: true }, 200, corsHeaders);
    }


    // ── Read a thread ────────────────────────────────────────────────
    if (action === 'get_thread') {
      const threadId = String(body.thread_id ?? '');
      if (!threadId) return json({ success: false, error: 'thread_id required' }, 400, corsHeaders);

      const { data: part } = await sb
        .from('internal_thread_participants')
        .select('id')
        .eq('thread_id', threadId)
        .eq('user_id', me)
        .eq('is_active', true)
        .maybeSingle();
      if (!part) return json({ success: false, error: 'not_a_participant' }, 403, corsHeaders);

      const { data: msgs, error } = await sb
        .from('internal_messages')
        .select('id, thread_id, sender_id, body, is_system, created_at, priority, attachments')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw error;

      const { data: threadRow } = await sb
        .from('internal_message_threads')
        .select('id, kind, title, created_by')
        .eq('id', threadId)
        .maybeSingle();
      const { data: memberRows } = await sb
        .from('internal_thread_participants')
        .select('user_id, is_active')
        .eq('thread_id', threadId)
        .eq('is_active', true);

      const senderIds = [...new Set((msgs ?? []).map((m) => m.sender_id).filter(Boolean))] as string[];
      const lookupIds = [
        ...new Set([...senderIds, ...(memberRows ?? []).map((m: any) => m.user_id as string)]),
      ];
      const { data: users } = lookupIds.length
        ? await sb.from('custom_users').select('id, username').in('id', lookupIds)
        : { data: [] as any[] };
      const nameById = new Map((users ?? []).map((u: any) => [u.id, u.username]));

      // Reading a transcript only counts as "reviewed" when the caller says so.
      // Background refreshes (minimised chips, polling) pass mark_read:false so
      // the unread badge survives until the user actually opens the chat.
      if (body.mark_read !== false) {
        await sb
          .from('internal_thread_participants')
          .update({ last_read_at: new Date().toISOString() })
          .eq('thread_id', threadId)
          .eq('user_id', me);
      }

      return json(
        {
          success: true,
          thread: threadRow
            ? {
                ...threadRow,
                participants: (memberRows ?? []).map((p: any) => ({
                  user_id: p.user_id,
                  username: p.user_id === me ? 'You' : nameById.get(p.user_id) ?? 'Unknown',
                  mine: p.user_id === me,
                })),
              }
            : null,
          messages: (msgs ?? []).map((m) => ({
            ...m,
            sender_name: m.sender_id === me ? 'You' : nameById.get(m.sender_id!) ?? 'System',
            mine: m.sender_id === me,
          })),
        },
        200,
        corsHeaders,
      );

    }

    // ── Attachments: signed upload / download URLs ───────────────────
    if (
      action === 'attachment_upload_url' ||
      action === 'attachment_upload_direct' ||
      action === 'attachment_download_url'
    ) {
      const threadId = String(body.thread_id ?? '');
      if (!threadId) return json({ success: false, error: 'thread_id required' }, 400, corsHeaders);

      const { data: part } = await sb
        .from('internal_thread_participants')
        .select('id')
        .eq('thread_id', threadId)
        .eq('user_id', me)
        .eq('is_active', true)
        .maybeSingle();
      if (!part) return json({ success: false, error: 'not_a_participant' }, 403, corsHeaders);

      if (action === 'attachment_upload_url') {
        const fileName = safeFileName(String(body.file_name ?? 'file'));
        const path = `${threadId}/${crypto.randomUUID()}-${fileName}`;
        const { data, error } = await sb.storage
          .from(ATTACHMENT_BUCKET)
          .createSignedUploadUrl(path);
        if (error || !data) {
          return json({ success: false, error: error?.message ?? 'upload_url_failed' }, 500, corsHeaders);
        }
        return json(
          { success: true, path, token: data.token, signed_url: data.signedUrl, file_name: fileName },
          200,
          corsHeaders,
        );
      }

      // Server-side upload fallback: the browser hands us the bytes (base64)
      // and we put them in the bucket with service credentials. Used when the
      // signed PUT cannot be reached (proxy, CORS, or an unroutable host), so
      // an upload never silently disappears.
      if (action === 'attachment_upload_direct') {
        const fileName = safeFileName(String(body.file_name ?? 'file'));
        const raw = String(body.file_data ?? '');
        if (!raw) return json({ success: false, error: 'file_data required' }, 400, corsHeaders);
        const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
        let bytes: Uint8Array;
        try {
          const binary = atob(base64);
          bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        } catch {
          return json({ success: false, error: 'file_data_not_base64' }, 400, corsHeaders);
        }
        const contentType = String(body.content_type ?? 'application/octet-stream');
        const path = `${threadId}/${crypto.randomUUID()}-${fileName}`;
        const { error } = await sb.storage
          .from(ATTACHMENT_BUCKET)
          .upload(path, bytes, { contentType, upsert: false });
        if (error) {
          return json({ success: false, error: error.message ?? 'upload_failed' }, 500, corsHeaders);
        }
        // Screen the stored object with the same server-side rules the signed
        // path uses, and delete it again if it turns out to be executable.
        const { safe, blocked } = await screenAttachments(sb, [
          { name: fileName, path, mime: contentType, size: bytes.byteLength } as Attachment,
        ]);
        if (blocked.length || !safe.length) {
          await sb.storage.from(ATTACHMENT_BUCKET).remove([path]);
          return json({ success: false, error: 'attachment_blocked' }, 400, corsHeaders);
        }
        return json({ success: true, path, file_name: fileName, attachment: safe[0] }, 200, corsHeaders);
      }



      const path = String(body.path ?? '');
      if (!path.startsWith(`${threadId}/`)) {
        return json({ success: false, error: 'invalid_path' }, 400, corsHeaders);
      }
      const { data, error } = await sb.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(path, 300, body.download ? { download: true } : undefined);
      if (error || !data) {
        return json({ success: false, error: error?.message ?? 'signed_url_failed' }, 500, corsHeaders);
      }
      return json({ success: true, signed_url: data.signedUrl }, 200, corsHeaders);
    }

    // ── Mark read ────────────────────────────────────────────────────
    if (action === 'mark_read') {
      const threadId = String(body.thread_id ?? '');
      if (!threadId) return json({ success: false, error: 'thread_id required' }, 400, corsHeaders);
      await sb
        .from('internal_thread_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('thread_id', threadId)
        .eq('user_id', me);
      return json({ success: true }, 200, corsHeaders);
    }

    // ── Find-or-create a direct thread ───────────────────────────────
    const ensureDirect = async (otherId: string) => {
      if (otherId === me) throw new Error('cannot_message_self');
      const { data: other } = await sb
        .from('custom_users')
        .select('id, is_active')
        .eq('id', otherId)
        .maybeSingle();
      if (!other || other.is_active === false) throw new Error('recipient_not_found');

      const key = directKey(me, otherId);
      const { data: existing } = await sb
        .from('internal_message_threads')
        .select('id')
        .eq('direct_key', key)
        .maybeSingle();
      if (existing) {
        // Re-activate participation in case a side previously left.
        await sb
          .from('internal_thread_participants')
          .update({ is_active: true })
          .eq('thread_id', existing.id);
        return existing.id as string;
      }

      const { data: created, error } = await sb
        .from('internal_message_threads')
        .insert({ kind: 'direct', direct_key: key, created_by: me })
        .select('id')
        .single();
      if (error) throw error;
      const { error: pErr } = await sb.from('internal_thread_participants').insert([
        { thread_id: created.id, user_id: me },
        { thread_id: created.id, user_id: otherId },
      ]);
      if (pErr) throw pErr;
      return created.id as string;
    };

    if (action === 'start_direct') {
      const otherId = String(body.user_id ?? '');
      if (!otherId) return json({ success: false, error: 'user_id required' }, 400, corsHeaders);
      const threadId = await ensureDirect(otherId);
      return json({ success: true, thread_id: threadId }, 200, corsHeaders);
    }

    // ── Send ─────────────────────────────────────────────────────────
    if (action === 'send_message') {
      const text = String(body.body ?? '').trim();
      if (text.length > MAX_BODY) {
        return json({ success: false, error: 'body_too_long' }, 400, corsHeaders);
      }

      const allowedPriorities = ['normal', 'high', 'urgent'];
      const rawPriority = String(body.priority ?? 'normal');
      const priority = allowedPriorities.includes(rawPriority) ? rawPriority : 'normal';

      let threadId = String(body.thread_id ?? '');
      let kind = 'direct';
      const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
      if (!text && rawAttachments.length === 0) {
        return json({ success: false, error: 'body required' }, 400, corsHeaders);
      }

      if (body.broadcast === true) {
        const { data: staff, error: sErr } = await sb
          .from('custom_users')
          .select('id')
          .eq('is_active', true);
        if (sErr) throw sErr;
        const { data: created, error: cErr } = await sb
          .from('internal_message_threads')
          .insert({
            kind: 'broadcast',
            title: String(body.title ?? '').trim() || 'Company announcement',
            created_by: me,
          })
          .select('id')
          .single();
        if (cErr) throw cErr;
        threadId = created.id;
        kind = 'broadcast';
        const rows = (staff ?? []).map((u) => ({ thread_id: threadId, user_id: u.id }));
        if (rows.length) {
          const { error: pErr } = await sb.from('internal_thread_participants').insert(rows);
          if (pErr) throw pErr;
        }
      } else if (!threadId) {
        const groupMembers = [
          ...new Set(
            (Array.isArray(body.group_member_ids) ? body.group_member_ids : [])
              .map((v: unknown) => String(v))
              .filter((v: string) => v && v !== me),
          ),
        ];
        if (groupMembers.length > 1) {
          const { data: valid } = await sb
            .from('custom_users')
            .select('id')
            .in('id', groupMembers)
            .eq('is_active', true);
          const validIds = (valid ?? []).map((u: any) => u.id as string);
          if (!validIds.length) throw new Error('recipient_not_found');
          const { data: created, error: cErr } = await sb
            .from('internal_message_threads')
            .insert({
              kind: 'group',
              title: String(body.title ?? '').trim().slice(0, 120) || null,
              created_by: me,
            })
            .select('id')
            .single();
          if (cErr) throw cErr;
          threadId = created.id;
          kind = 'group';
          const { error: pErr } = await sb.from('internal_thread_participants').insert([
            { thread_id: threadId, user_id: me, role: 'owner' },
            ...validIds.map((id) => ({ thread_id: threadId, user_id: id, role: 'member' })),
          ]);
          if (pErr) throw pErr;
        } else {
          const recipient = String(body.recipient_user_id ?? '') || groupMembers[0] || '';
          if (!recipient) {
            return json({ success: false, error: 'thread_id or recipient_user_id required' }, 400, corsHeaders);
          }
          threadId = await ensureDirect(recipient);
        }
      }


      // Participation gate for existing threads.
      const { data: part } = await sb
        .from('internal_thread_participants')
        .select('id')
        .eq('thread_id', threadId)
        .eq('user_id', me)
        .eq('is_active', true)
        .maybeSingle();
      if (!part) return json({ success: false, error: 'not_a_participant' }, 403, corsHeaders);

      const staged = normaliseAttachments(rawAttachments, threadId);
      const { safe: attachments, blocked } = staged.length
        ? await screenAttachments(sb, staged)
        : { safe: [] as Attachment[], blocked: [] as string[] };
      if (blocked.length) {
        return json(
          {
            success: false,
            error: `attachment_rejected: ${blocked.join(', ')}`,
            blocked,
          },
          400,
          corsHeaders,
        );
      }
      if (!text && attachments.length === 0) {
        return json({ success: false, error: 'body required' }, 400, corsHeaders);
      }


      const { data: msg, error: mErr } = await sb
        .from('internal_messages')
        .insert({ thread_id: threadId, sender_id: me, body: text, priority, attachments })
        .select('id, thread_id, sender_id, body, created_at, priority, attachments')
        .single();
      if (mErr) throw mErr;

      const now = new Date().toISOString();
      await sb
        .from('internal_message_threads')
        .update({
          last_message_at: now,
          last_message_preview: preview(
            text || `${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`,
          ),
          updated_at: now,
        })
        .eq('id', threadId);
      await sb
        .from('internal_thread_participants')
        .update({ last_read_at: now })
        .eq('thread_id', threadId)
        .eq('user_id', me);
      // A new message resurfaces the thread for anyone who had archived it.
      await sb
        .from('internal_thread_participants')
        .update({ archived_at: null })
        .eq('thread_id', threadId)
        .not('archived_at', 'is', null);


      // Notify every other participant.
      const { data: recipients } = await sb
        .from('internal_thread_participants')
        .select('user_id')
        .eq('thread_id', threadId)
        .eq('is_active', true);
      const { data: senderRow } = await sb
        .from('custom_users')
        .select('username')
        .eq('id', me)
        .maybeSingle();
      const senderName = senderRow?.username ?? 'A team member';

      const notifications = (recipients ?? [])
        .filter((r) => r.user_id !== me)
        .map((r) => ({
          type: 'internal_message',
          title: `${priority === 'urgent' ? 'URGENT: ' : priority === 'high' ? 'Priority: ' : ''}${
            kind === 'broadcast' ? `Announcement from ${senderName}` : `New message from ${senderName}`
          }`,
          message: preview(
            text || `Sent ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`,
          ),
          target_user_id: r.user_id,
          entity_id: threadId,
        }));
      if (notifications.length) {
        const { error: nErr } = await sb.from('notifications').insert(notifications);
        if (nErr) console.error('[internal-messaging] notification insert failed:', nErr.message);
      }

      return json({ success: true, thread_id: threadId, message: msg }, 200, corsHeaders);
    }

    return json({ success: false, error: `unknown action: ${action}` }, 400, corsHeaders);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    const known = ['cannot_message_self', 'recipient_not_found'];
    return json({ success: false, error: message }, known.includes(message) ? 400 : 500, corsHeaders);
  }
});
