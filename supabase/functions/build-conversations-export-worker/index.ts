/**
 * build-conversations-export-worker
 *
 * Background worker invoked by start-conversations-export.
 * Reads the export_jobs row for job_id, paginates through every
 * conversation + every message (no 1000-row cap, with retries),
 * builds a CSV or XLSX, uploads to the `qa_exports` storage bucket,
 * generates a signed URL, and finalizes the job row.
 *
 * Service-role only (called via x-internal-call).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { strToU8, zipSync } from 'https://esm.sh/fflate@0.8.2';
import { createCorsHeaders } from '../_shared/auth.ts';
import { verifyInternal } from '../_shared/auth_v2.ts';
import { isCorrespondence, mapChannelType } from '../_shared/ghlConversationMap.pure.ts';

const PAGE_SIZE = 1000;             // pagination page size for messages
const IN_CHUNK_SIZE = 100;           // max IDs per .in() call (URL length limit)
const MESSAGE_CONVERSATION_CHUNK_SIZE = 50; // conversation IDs per message batch
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24h
const STORAGE_BUCKET = 'qa_exports';

const HEADERS = [
  'Conversation #', 'Message #', 'Client Name', 'Client Email',
  'Channel', 'Contact ID (GHL)', 'Conversation ID (GHL)', 'Message ID (GHL)',
  'Direction', 'Sender', 'Date', 'Time', 'Timestamp (ISO)',
  'Message Type', 'Status', 'Body', 'Attachments',
];

/**
 * The channel vocabulary is `mapChannelType`, imported rather than restated.
 *
 * This file held a FOURTH copy of that table and it had drifted furthest: no
 * `mail`, no `whats_app`, no numeric forms, and — the one that showed — no
 * `type_activity_*` and no `type_call`, so `map[lower] || lower` passed those
 * straight through and the Channel column of a client's exported spreadsheet
 * printed the raw `type_activity_opportunity`.
 */

function pad2(n: number) { return String(n).padStart(2, '0'); }
function fmtDate(d: Date) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function fmtTime(d: Date) {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function timeMs(value: string | null | undefined): number {
  return value ? new Date(value).getTime() || 0 : 0;
}

function parseValidDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function xmlEscape(value: any): string {
  return String(value ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
}

function buildXlsxBuffer(rows: any[][]): Uint8Array {
  const allRows = [HEADERS, ...rows];
  const sheetRows = allRows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const cells = row.map((cell, colIndex) => {
      const ref = `${columnName(colIndex)}${rowNumber}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
    }).join('');
    return `<row r="${rowNumber}">${cells}</row>`;
  }).join('');

  const cols = HEADERS.map((h, index) => {
    const width = Math.min(Math.max(h.length + 2, 14), 60);
    const col = index + 1;
    return `<col min="${col}" max="${col}" width="${width}" customWidth="1"/>`;
  }).join('');

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${sheetRows}</sheetData></worksheet>`;
  const now = new Date().toISOString();

  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'),
    'docProps/app.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Conversation Export</Application></Properties>'),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>NPC Services</dc:creator><cp:lastModifiedBy>NPC Services</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Message History" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'xl/styles.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': strToU8(worksheet),
  }, { level: 6 });
}

async function withRetry<T>(label: string, fn: () => PromiseLike<T> | T, attempts = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e: any) {
      lastErr = e;
      const wait = 500 * Math.pow(2, i);
      console.warn(`[worker] ${label} attempt ${i + 1} failed: ${e?.message}. Retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let jobId: string | null = null;

  try {
    // WP-12 Phase B: capture the raw body once so verifyInternal's signed-envelope
    // hash matches. Passing '' broke every signed cron/service call under
    // INTERNAL_STRICT_SIGNED=true.
    const rawBody = await req.text();
    let parsedBody: any = {};
    try { parsedBody = rawBody ? JSON.parse(rawBody) : {}; } catch { parsedBody = {}; }
    jobId = parsedBody.job_id;

    // AUTH-002: internal-only gate via a real credential (signed envelope or,
    // during rollout, INTERNAL_EDGE_SECRET / service-role key).
    const internal = await verifyInternal(supabase, req, rawBody, {
      strict: true,
      allowedCallers: ['start-conversations-export'],
    });
    if (!internal.ok) {
      return new Response(
        JSON.stringify({ success: false, error: 'Internal-only endpoint' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }


    if (!jobId) {
      return new Response(
        JSON.stringify({ success: false, error: 'job_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Load job
    const { data: job, error: jobErr } = await supabase
      .from('export_jobs').select('*').eq('id', jobId).maybeSingle();
    if (jobErr || !job) throw new Error(`Job not found: ${jobErr?.message || jobId}`);

    if (job.status !== 'pending') {
      console.log(`[worker] job ${jobId} already in status=${job.status}; skipping`);
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const conversationIds: string[] = job.scope?.conversation_ids || [];
    const fileFormat: 'csv' | 'xlsx' = job.file_format;

    await supabase.from('export_jobs').update({
      status: 'processing',
      started_at: new Date().toISOString(),
    }).eq('id', jobId);

    // ── 1. Fetch all conversation rows in pages of 1000 by id ──
    const conversations: any[] = [];
    for (let i = 0; i < conversationIds.length; i += IN_CHUNK_SIZE) {
      const chunk = conversationIds.slice(i, i + IN_CHUNK_SIZE);
      const { data, error } = await withRetry('fetch conversations', () =>
        supabase.from('ghl_conversations')
          .select('id, ghl_conversation_id, ghl_contact_id, channel_type, client_id')
          .in('id', chunk)
      );
      if (error) throw new Error(`conversations fetch failed: ${error.message}`);
      conversations.push(...(data || []));
    }
    console.log(`[worker] loaded ${conversations.length} conversations`);

    // ── 2. Resolve client names/emails ──
    const clientIds = [...new Set(conversations.map((c) => c.client_id).filter(Boolean))];
    const clientMap = new Map<string, { name: string; email: string | null }>();
    for (let i = 0; i < clientIds.length; i += IN_CHUNK_SIZE) {
      const chunk = clientIds.slice(i, i + IN_CHUNK_SIZE);
      const { data, error } = await withRetry('fetch clients', () =>
        supabase.from('clients')
          .select('id, primary_first_name, primary_surname, primary_email')
          .in('id', chunk)
      );
      if (error) throw new Error(`clients fetch failed: ${error.message}`);
      (data || []).forEach((c: any) => {
        const name = [c.primary_first_name, c.primary_surname].filter(Boolean).join(' ').trim() || 'Unknown';
        clientMap.set(c.id, { name, email: c.primary_email || null });
      });
    }

    // ── 3. For each conversation, page ALL messages (no 1000 cap) ──
    const rows: any[][] = [];
    let totalMessages = 0;
    let processed = 0;
    let lastProgressUpdate = 0;

    // Sort conversations by input order so the export numbering matches the dashboard view
    const idOrderIndex = new Map<string, number>();
    conversationIds.forEach((id, i) => idOrderIndex.set(id, i + 1));
    conversations.sort((a, b) =>
      (idOrderIndex.get(a.id) || 0) - (idOrderIndex.get(b.id) || 0));

    for (let chunkStart = 0; chunkStart < conversations.length; chunkStart += MESSAGE_CONVERSATION_CHUNK_SIZE) {
      const conversationChunk = conversations.slice(chunkStart, chunkStart + MESSAGE_CONVERSATION_CHUNK_SIZE);
      const chunkConversationIds = conversationChunk.map((conv) => conv.id);
      const messagesByConversation = new Map<string, any[]>();
      let from = 0;

      // Page through all messages for this conversation chunk in batches.
      // This avoids one DB round-trip per conversation while still bypassing
      // the default 1000-row cap.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await withRetry(`messages chunk=${chunkStart} from=${from}`, () =>
          supabase.from('ghl_conversation_messages')
            .select('conversation_id, ghl_message_id, direction, sender_name, ghl_date_added, content_type, message_status, body, attachment_urls, channel_type, created_at')
            .in('conversation_id', chunkConversationIds)
            .order('ghl_date_added', { ascending: true })
            .order('created_at', { ascending: true })
            .range(from, from + PAGE_SIZE - 1)
        );
        if (error) throw new Error(`messages fetch failed (chunk ${chunkStart}): ${error.message}`);
        const page = data || [];
        page.forEach((message: any) => {
          const list = messagesByConversation.get(message.conversation_id) || [];
          list.push(message);
          messagesByConversation.set(message.conversation_id, list);
        });
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      for (const conv of conversationChunk) {
        const idx = idOrderIndex.get(conv.id) || 0;
        const clientInfo = conv.client_id ? clientMap.get(conv.client_id) : null;
        const clientName = clientInfo?.name || (conv.client_id ? 'Unknown' : 'Unlinked Contact');
        const clientEmail = clientInfo?.email || '';
        const entries = (messagesByConversation.get(conv.id) || []).sort((a, b) =>
          timeMs(a.ghl_date_added) - timeMs(b.ghl_date_added)
          || timeMs(a.created_at) - timeMs(b.created_at)
        );

        // `/conversations/{id}/messages` returns ENTRIES, and GHL interleaves
        // its own activity records among them — "Opportunity updated", an
        // appointment title, "DnD enabled by customer", a call with a null
        // body. Measured on the prime 13 Sep 2026: 4,753 of 13,255 rows, 36%.
        //
        // This sheet is called Message History and is the artefact that leaves
        // the building, so it holds what the thread holds. `isCorrespondence`
        // is the same decision both staff surfaces and the finance portal make
        // — one implementation, so an export can never disagree with the
        // screen the operator launched it from. Nothing is deleted: the rows
        // stay in the table, and the placeholder below SAYS how many were left
        // out rather than dropping them silently.
        const msgs = entries.filter((m: any) => isCorrespondence(m.channel_type));
        const withheldEntries = entries.length - msgs.length;

      if (msgs.length === 0) {
        rows.push([
          idx, 0, clientName, clientEmail,
          mapChannelType(conv.channel_type), conv.ghl_contact_id || '',
          conv.ghl_conversation_id || '', '', '', '', '', '', '', '', '',
          withheldEntries > 0
            ? `(no messages — ${withheldEntries} CRM activity ${withheldEntries === 1 ? 'entry' : 'entries'} not exported)`
            : '(no messages)',
          '',
        ]);
      } else {
        msgs.forEach((m, i) => {
          const d = parseValidDate(m.ghl_date_added);
          rows.push([
            idx, i + 1, clientName, clientEmail,
            mapChannelType(m.channel_type || conv.channel_type),
            conv.ghl_contact_id || '', conv.ghl_conversation_id || '',
            m.ghl_message_id || '', m.direction || '', m.sender_name || '',
            d ? fmtDate(d) : '', d ? fmtTime(d) : '',
            d ? d.toISOString() : '', m.content_type || '',
            m.message_status || '', m.body || '',
            (m.attachment_urls || []).join(' | '),
          ]);
        });
      }
      totalMessages += msgs.length;
      processed++;

      // Throttle progress updates (every 10 convs or 2s, whichever comes first)
      const now = Date.now();
      if (processed % 10 === 0 || processed === conversations.length || now - lastProgressUpdate > 2000) {
        lastProgressUpdate = now;
        await supabase.from('export_jobs').update({
          processed_items: processed,
          total_messages: totalMessages,
        }).eq('id', jobId);
      }
    }
    }

    console.log(`[worker] built ${rows.length} rows from ${processed} conversations (${totalMessages} messages)`);

    // ── 4. Build the file ──
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `conversations-full-history-${ts}.${fileFormat}`;
    const storagePath = `exports/${jobId}/${fileName}`;

    let fileBuffer: Uint8Array;
    let contentType: string;
    if (fileFormat === 'csv') {
      const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [HEADERS, ...rows].map((r) => r.map(escape).join(',')).join('\n');
      fileBuffer = new TextEncoder().encode('\uFEFF' + csv);
      contentType = 'text/csv';
    } else {
      fileBuffer = buildXlsxBuffer(rows);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }

    // ── 5. Upload to storage ──
    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, fileBuffer, { contentType, upsert: true });
    if (uploadErr) throw new Error(`storage upload failed: ${uploadErr.message}`);

    // WP-06 Phase B — bind the export object to its owner so future reads
    // authorize through storage_object_bindings.
    const { error: bindErr } = await supabase.from('storage_object_bindings').upsert({
      bucket: STORAGE_BUCKET,
      object_path: storagePath,
      resource_type: 'export_job',
      resource_id: jobId,
      client_id: null,
      owner_user_id: job.created_by ?? null,
      sensitivity: 'sensitive',
      created_by: job.created_by ?? null,
    }, { onConflict: 'bucket,object_path' });
    if (bindErr) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
      throw new Error(`binding create failed: ${bindErr.message}`);
    }

    // ── 6. Signed URL ──
    const { data: signedData, error: signedErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    if (signedErr || !signedData?.signedUrl) {
      throw new Error(`signed URL failed: ${signedErr?.message || 'no url'}`);
    }

    const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();

    await supabase.from('export_jobs').update({
      status: 'completed',
      processed_items: processed,
      total_messages: totalMessages,
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      file_size_bytes: fileBuffer.byteLength,
      signed_url: signedData.signedUrl,
      signed_url_expires_at: expiresAt,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);

    console.log(`[worker] job ${jobId} completed: ${storagePath} (${fileBuffer.byteLength} bytes)`);

    return new Response(JSON.stringify({ success: true, storage_path: storagePath }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error(`[worker] FAILED for job=${jobId}:`, msg);
    if (jobId) {
      try {
        await supabase.from('export_jobs').update({
          status: 'failed',
          error_summary: msg.substring(0, 2000),
          completed_at: new Date().toISOString(),
        }).eq('id', jobId);
      } catch {}
    }
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
