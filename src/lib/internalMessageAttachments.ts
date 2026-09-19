/**
 * Internal messaging attachments.
 *
 * Upload path
 * -----------
 * Small and medium files go through the dedicated
 * `internal-message-attachments` function, avoiding browser-to-Storage CORS
 * and proxy failures. Large files use a short-lived signed upload URL minted by
 * that same function and stream directly to Storage.
 *
 * Uploads are performed with XHR so we get real byte-level progress, an abort
 * signal, and — critically — a *retry* loop. Every retry mints a **fresh**
 * signed ticket (tokens are single-use and short-lived), so a dropped
 * connection, a token expiry mid-flight, or a transient 5xx never results in a
 * silent failure: each attempt either completes or surfaces a hard error that
 * the UI can retry manually.
 *
 * Safety
 * ------
 * The server re-inspects every uploaded object (magic-byte sniff, declared-vs-
 * actual MIME agreement, executable blocklist and — when configured — an
 * antivirus pass) inside `send_message`. Anything that fails is deleted from
 * storage and the message is rejected, so unsafe files never become visible to
 * recipients.
 *
 * Downloads always go back through the edge function so a signed URL is only
 * ever issued to a verified participant of that thread.
 */
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { SUPABASE_URL } from '@/integrations/supabase/env';

export const INTERNAL_ATTACHMENT_BUCKET = 'internal-message-attachments';
/** Every format is allowed — the server does the safety screening. */
export const INTERNAL_ATTACHMENT_ACCEPT = '*/*';
export const MAX_INTERNAL_ATTACHMENTS = 25;
/** Attempts per file (1 initial + retries), each with a brand-new ticket. */
export const UPLOAD_ATTEMPTS = 4;

export type AttachmentScanStatus = 'clean' | 'unscanned' | 'blocked' | 'legacy';

export interface AttachmentScan {
  status: AttachmentScanStatus;
  engine?: string | null;
  reason?: string | null;
  at?: string | null;
}

export interface InternalAttachment {
  name: string;
  path: string;
  mime: string;
  size: number;
  scan?: AttachmentScan | null;
}

export function formatAttachmentSize(bytes?: number | null): string {
  const n = Number(bytes ?? 0);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const call = async (payload: Record<string, unknown>) => {
  const { data, error } = await invokeSecureFunction('internal-message-attachments', payload, {
    timeoutMs: 120_000,
  });
  if (error) throw new Error(error.message || 'Request failed');
  if (data && (data as any).success === false) {
    throw new Error((data as any).error || 'Request failed');
  }
  return data as any;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Base64 payload (no data-URI prefix) for the server-side upload fallback. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export interface UploadTicket {
  path: string;
  token: string;
  signed_url?: string;
  file_name: string;
}

/** PUT the file to a signed upload URL with byte-level progress + abort. */
function putWithProgress(opts: {
  url: string;
  file: File;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', opts.url, true);
    xhr.setRequestHeader('content-type', opts.file.type || 'application/octet-stream');
    xhr.setRequestHeader('cache-control', 'max-age=3600');
    xhr.setRequestHeader('x-upsert', 'true');

    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !opts.onProgress) return;
      opts.onProgress(Math.min(0.99, e.loaded / e.total));
    };
    xhr.onload = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(1);
        resolve();
        return;
      }
      let detail = '';
      try {
        detail = JSON.parse(xhr.responseText)?.message ?? '';
      } catch {
        detail = xhr.responseText?.slice(0, 160) ?? '';
      }
      const err = new Error(detail || `Upload failed (${xhr.status})`);
      (err as any).status = xhr.status;
      reject(err);
    };
    xhr.onerror = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new Error('Network interrupted during upload'));
    };
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.onabort = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Upload cancelled', 'AbortError'));
    };
    // No client timeout: very large files may legitimately take a long time.
    xhr.timeout = 0;
    xhr.send(opts.file);
  });
}

/*
 * The project URL now comes from `@/integrations/supabase/env`, which is the
 * only module that resolves it.
 *
 * This file used to read `import.meta.env.VITE_SUPABASE_URL` inline with an
 * empty-string fallback, and that is worth remembering: when the variable was
 * undefined at build time the expression collapsed to `''`, so the "fallback"
 * produced a RELATIVE url and the upload PUT went to the app's own origin,
 * which answers with HTML. A fallback that cannot work is worse than no
 * fallback. The shared module never yields an empty string — it falls back to a
 * real project URL and strips any trailing slash — so that failure mode is gone.
 */

function ticketUrl(ticket: UploadTicket): string {
  if (ticket.signed_url && /^https?:\/\//i.test(ticket.signed_url)) return ticket.signed_url;
  const encoded = ticket.path.split('/').map(encodeURIComponent).join('/');
  return `${SUPABASE_URL}/storage/v1/object/upload/sign/${INTERNAL_ATTACHMENT_BUCKET}/${encoded}?token=${ticket.token}`;
}

/**
 * Non-retryable ticket failures (the attachment endpoint itself is unavailable
 * or the caller isn't allowed) mapped to a message that explains the fix.
 */
function fatalTicketError(error: unknown): Error | null {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  const m = msg.toLowerCase();
  if (m.includes('unknown action')) {
    return new Error('Attachment service is out of date — redeploy internal-messaging');
  }
  if (m.includes('unknown operation')) {
    return new Error('Attachment transport is out of date — redeploy internal-message-attachments');
  }
  if (m.includes('not_a_participant')) {
    return new Error('You are no longer a participant in this conversation');
  }
  if (m.includes('thread_id required')) {
    return new Error('Open or create the conversation before attaching files');
  }
  return null;
}

/**
 * Upload one file with retry + progress. Each attempt mints a fresh signed
 * ticket so an expired/consumed token can never wedge the upload.
 */
export async function uploadInternalAttachment(
  threadId: string,
  file: File,
  options: {
    onProgress?: (fraction: number) => void;
    onAttempt?: (attempt: number, attempts: number) => void;
    signal?: AbortSignal;
    attempts?: number;
  } = {},
): Promise<InternalAttachment> {
  const attempts = Math.max(1, options.attempts ?? UPLOAD_ATTEMPTS);
  let lastError: unknown = null;

  // Prefer a server-mediated upload for files that fit safely inside an Edge
  // request. This avoids browser-to-Storage CORS/proxy failures altogether and
  // uses a dedicated function that cannot be shadowed by stale messaging code.
  // Keep raw bytes below the Edge request ceiling after base64/JSON expansion.
  const DIRECT_MAX_BYTES = 3 * 1024 * 1024;
  if (!options.signal?.aborted && file.size <= DIRECT_MAX_BYTES) {
    try {
      options.onAttempt?.(1, 1);
      options.onProgress?.(0.05);
      const fileData = await fileToBase64(file);
      options.onProgress?.(0.45);
      const result = await call({
        operation: 'upload_direct',
        thread_id: threadId,
        file_name: file.name,
        content_type: file.type || 'application/octet-stream',
        file_data: fileData,
      });
      const attachment = result?.attachment as InternalAttachment | undefined;
      if (attachment?.path) {
        options.onProgress?.(1);
        return { ...attachment, name: file.name, size: file.size };
      }
      throw new Error('Attachment service returned no stored file');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastError = error;
      // Continue into signed streaming; this remains useful during a transient
      // Edge outage and is required for files above the direct request ceiling.
    }
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
    options.onAttempt?.(attempt, attempts);
    try {
      const ticket = (await call({
        operation: 'upload_ticket',
        thread_id: threadId,
        file_name: file.name,
        file_size: file.size,
        content_type: file.type || 'application/octet-stream',
      })) as UploadTicket;

      try {
        await putWithProgress({
          url: ticketUrl(ticket),
          file,
          onProgress: options.onProgress,
          signal: options.signal,
        });
      } catch (xhrError) {
        // Fall back to the SDK path once (covers proxies that mangle raw PUTs).
        if (attempt === attempts - 1) {
          const { error } = await supabase.storage
            .from(INTERNAL_ATTACHMENT_BUCKET)
            .uploadToSignedUrl(ticket.path, ticket.token, file, {
              contentType: file.type || 'application/octet-stream',
            });
          if (error) throw xhrError;
          options.onProgress?.(1);
        } else {
          throw xhrError;
        }
      }

      return {
        name: file.name,
        path: ticket.path,
        mime: file.type || 'application/octet-stream',
        size: file.size,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastError = fatalTicketError(error) ?? error;
      // A stale/misconfigured attachment service will never succeed on retry —
      // surface it immediately instead of burning every attempt.
      if (fatalTicketError(error)) break;
      if (attempt < attempts) await sleep(Math.min(8_000, 600 * 2 ** (attempt - 1)));
    }

  }

  throw new Error(
    lastError instanceof Error
      ? `${file.name}: ${lastError.message}`
      : `${file.name}: upload failed`,
  );
}

/** Upload a batch sequentially so very large files don't compete for bandwidth. */
export async function uploadInternalAttachments(
  threadId: string,
  files: File[],
  onFileDone?: (done: number, total: number, name: string) => void,
): Promise<InternalAttachment[]> {
  const out: InternalAttachment[] = [];
  const batch = files.slice(0, MAX_INTERNAL_ATTACHMENTS);
  for (let i = 0; i < batch.length; i += 1) {
    out.push(await uploadInternalAttachment(threadId, batch[i]));
    onFileDone?.(i + 1, batch.length, batch[i].name);
  }
  return out;
}

/**
 * Delivery guarantee for attachments.
 *
 * `send_message` is supposed to persist the attachment list, but if that
 * deployment is behind (or drops an item for any reason) the files exist in
 * storage while nobody can see them. This binds the uploaded objects to the
 * message row through the dedicated transport, which re-verifies participation,
 * sender ownership and object existence server-side.
 *
 * Returns the authoritative attachment list stored on the message.
 */
export async function ensureMessageAttachments(
  threadId: string,
  messageId: string | null | undefined,
  attachments: InternalAttachment[],
  persisted?: unknown,
): Promise<InternalAttachment[]> {
  if (!attachments.length) return [];
  const already = Array.isArray(persisted) ? (persisted as InternalAttachment[]) : [];
  if (already.length >= attachments.length) return already;
  if (!messageId) return already.length ? already : attachments;
  try {
    const data = await call({
      operation: 'attach',
      thread_id: threadId,
      message_id: messageId,
      attachments,
    });
    const out = data?.attachments;
    return Array.isArray(out) && out.length ? (out as InternalAttachment[]) : attachments;
  } catch (error) {
    console.warn('[internal-attachments] could not bind attachments to message', error);
    return already.length ? already : attachments;
  }
}

/**
 * Create a message and persist its uploaded objects atomically through the
 * attachment transport. This is the authoritative path whenever files exist;
 * it removes the old cross-function upload → send → repair race entirely.
 */
export async function sendInternalMessageWithAttachments(
  threadId: string,
  messageBody: string,
  attachments: InternalAttachment[],
  priority = 'normal',
) {
  if (!attachments.length) throw new Error('At least one attachment is required');
  const data = await call({
    operation: 'send',
    thread_id: threadId,
    message_body: messageBody,
    priority,
    attachments,
  });
  if (!data?.message?.id) throw new Error('Attachment message was not created');
  return data;
}

/**
 * Read-side delivery guarantee.
 *
 * The main messaging function's `get_thread` has shipped behind more than once
 * and dropped the `attachments` projection, which rendered as an empty grey
 * bubble. We re-hydrate every message's attachments from the dedicated
 * transport so visibility never depends on that deployment.
 */
export async function hydrateThreadAttachments<T extends { id: string; attachments?: InternalAttachment[] | null }>(
  threadId: string,
  messages: T[],
): Promise<T[]> {
  if (!threadId || !messages.length) return messages;
  try {
    const data = await call({ operation: 'hydrate', thread_id: threadId });
    const map = (data?.attachments_by_message ?? {}) as Record<string, InternalAttachment[]>;
    if (!Object.keys(map).length) return messages;
    return messages.map((m) =>
      map[m.id]?.length && !(m.attachments?.length)
        ? { ...m, attachments: map[m.id] }
        : m,
    );
  } catch {
    return messages;
  }
}



/**
 * Download an attachment straight to the user's device.
 *
 * No `window.open` — a blank tab is never spawned. We mint the signed URL,
 * fetch the bytes, and hand a blob URL to a hidden anchor with `download`, so
 * the browser writes the file and nothing navigates. If the fetch is blocked we
 * fall back to a same-gesture anchor click on the signed URL itself (the server
 * sets `Content-Disposition: attachment`), which also avoids a visible tab.
 */
export async function openInternalAttachment(
  threadId: string,
  attachment: Pick<InternalAttachment, 'path' | 'name'>,
  download = true,
): Promise<void> {
  const data = await call({
    operation: 'download_ticket',
    thread_id: threadId,
    path: attachment.path,
    download,
  });
  const url = data?.signed_url as string | undefined;
  if (!url) throw new Error('Could not open attachment');

  const saveAs = (href: string, revoke?: () => void) => {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = attachment.name || 'attachment';
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (revoke) setTimeout(revoke, 60_000);
  };

  try {
    const res = await fetch(url, { credentials: 'omit', mode: 'cors' });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    saveAs(objectUrl, () => URL.revokeObjectURL(objectUrl));
  } catch {
    // Signed URL already carries an attachment disposition — no tab needed.
    saveAs(url);
  }
}

export function isImageAttachment(a: InternalAttachment) {
  return (a.mime || '').startsWith('image/');
}

export function attachmentScanStatus(a: InternalAttachment): AttachmentScanStatus {
  // Older rows stored the scan verdict as a bare string.
  const raw = a.scan as unknown;
  const status = typeof raw === 'string' ? raw : (a.scan?.status as string | undefined);
  if (status === 'clean' || status === 'unscanned' || status === 'blocked') return status;
  return 'legacy';
}


/** Pull real files out of a drop / paste event (multi-file aware). */
export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.files?.length) out.push(...Array.from(dt.files));
  if (!out.length && dt.items?.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue;
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  // De-dupe identical picks (some browsers report both files and items).
  const seen = new Set<string>();
  return out.filter((f) => {
    const key = `${f.name}|${f.size}|${f.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
