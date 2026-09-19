/**
 * render-report-qa-pdf
 *
 * A Report Q&A conversation, rendered server-side through WeasyPrint.
 *
 * ## What this route owns
 *
 * The reading. Everything this document prints is a persisted row —
 * `report_qa_conversations` holds the title, the grounding documents and the
 * model's write-up; `report_qa_messages` holds every exchange with its citations
 * and the model that answered — so the browser sends a conversation id and a
 * subject, and this function reads the rest.
 *
 * That is a change from the legacy, which posts the messages up from browser
 * state (`ReportQA.tsx:2042`) and typesets whatever arrives. A transcript the
 * caller supplies is a transcript the caller can edit, and this document's whole
 * claim is that it is a record of what was asked and what was said.
 *
 * ## Two gates, and neither is `reports`
 *
 * `permissions.ts:37-38` maps both Q&A tables to the `report_qa` module, so that
 * is the key that governs them; gating on `reports` — which is what the other
 * five render routes use, because their subjects are reports — would let someone
 * read a conversation through a report route they could not read directly. Then
 * `resolveReportQaAccess`, the resolver every other Q&A action already routes
 * through, for the conversation itself. This function does not invent a second
 * ownership rule; owner, share and superadmin are decided in one place.
 *
 * ## The only route in the programme that can call a model
 *
 * `structured` renders `report_qa_conversations.structured_report`, and only 28
 * of 244 conversations have one. When it is missing and the caller asked for it,
 * this route generates it the way `summarize-conversation` does — and **meters
 * it**, which that action does not. The result is persisted, so the second
 * render of the same conversation is free.
 *
 * Generation is opt-in (`generateIfMissing`). Spending tokens is something a
 * caller asks for, not something a render does on its way past.
 *
 * ## What it replaces
 *
 * Four PDF implementations across three libraries — three jsPDF copies of one
 * template that have drifted apart, and a pdf-lib transcript. Between them:
 * three filename conventions, two unrelated hardcoded palettes, our own cover
 * art on a white-label tenant's document, and `sanitizeForPDF` throwing away
 * every non-ASCII character, which costs smart punctuation in 389 of the record's
 * 562 answers.
 *
 * ## The legacy paths stay
 *
 * All four still draw their documents, all three buttons still work, and the
 * `.txt` / `.csv` / `.md` / `.json` exports are untouched — the last of which is
 * what this document's truncation notice points at.
 *
 * ## No fallback
 *
 * If WeasyPrint fails, this fails. A silent downgrade to the raster path would
 * send somebody a document nobody chose.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuthOrNativeUser } from '../_shared/auth.ts';
import { actorIsSuperadmin, requireModulePermission } from '../_shared/authz.ts';
import { resolveReportQaAccess } from '../_shared/reportQaAccess.ts';
import { assertSafeRenderResources } from '../_shared/renderResourcePolicy.pure.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';
import { countPdfPagesAsync, renderPdf, weasyPrintConfig } from '../_shared/weasyprintClient.ts';
import { extractOpenAIUsage, logApiUsage } from '../_shared/logApiUsage.ts';
import {
  buildReportBrandSnapshot,
  REPORT_SNAPSHOT_VERSION,
} from '../_shared/reportDesign/snapshot.pure.ts';
import { inlineAsset } from '../_shared/reportDesign/assets.pure.ts';
import { inlineBrandAssets } from '../_shared/reportDesign/fetchBrandAssets.ts';
import { buildReportQaDocument } from '../_shared/reports/reportQa/normalise.pure.ts';
import { renderReportQaFromBrand } from '../_shared/reports/reportQa/render.pure.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  parseRenderRequest,
  reportQaFileName,
  reportQaReference,
  reportQaStoragePath,
  SIGNED_URL_TTL_SECONDS,
  STORAGE_BUCKET,
  type ReportQaRenderResponse,
} from '../_shared/reports/reportQa/route.pure.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token, x-finance-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * The company block, out of the key/value table it lives in.
 *
 * `global_report_settings` is `(setting_key, setting_value jsonb)`. Reading it as
 * though it had `contact_details` and `disclaimer` columns is the mistake that
 * shipped every Borrowing Capacity Snapshot without an ABN.
 */
function readReportSettings(
  rows: unknown,
  queryError: string | null,
): { contact: Record<string, unknown> | null; disclaimer: Record<string, unknown> | null } {
  if (queryError) {
    console.warn(`[render-report-qa-pdf] global_report_settings unreadable: ${queryError}`);
  }
  let contact: Record<string, unknown> | null = null;
  let disclaimer: Record<string, unknown> | null = null;
  for (const row of (Array.isArray(rows) ? rows : []) as Record<string, unknown>[]) {
    const value = row.setting_value;
    if (!value || typeof value !== 'object') continue;
    if (row.setting_key === 'contact_details') contact = value as Record<string, unknown>;
    else if (row.setting_key === 'professional_disclaimer') disclaimer = value as Record<string, unknown>;
  }
  return { contact, disclaimer };
}

/**
 * The structured write-up, when the conversation has none stored.
 *
 * The same call `summarize-conversation` makes — the same gateway, the same
 * model, the same eight-section brief — with two differences. It is **metered**,
 * which that action is not, and the answer is persisted so the next render of
 * this conversation costs nothing.
 *
 * Returns null rather than throwing when the model is unavailable: a
 * conversation with no write-up is a 400 the caller can act on, and dressing a
 * gateway outage as a 500 tells them nothing about what to do next.
 */
async function generateStructuredReport(
  supabase: ReturnType<typeof createClient>,
  args: {
    conversationId: string;
    title: string;
    reportNames: readonly string[];
    companyName: string;
    turns: ReadonlyArray<{ question: string; answer: string }>;
    userId: string;
  },
): Promise<string | null> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) {
    console.warn('[render-report-qa-pdf] LOVABLE_API_KEY unset; cannot generate a structured report');
    return null;
  }

  const transcript = args.turns
    .flatMap((t) => [t.question ? `**Advisor:**\n${t.question}` : '', `**AI Analyst:**\n${t.answer}`])
    .filter(Boolean)
    .join('\n\n---\n\n');

  const prompt = `You are a professional report writer for ${args.companyName}, an Australian property investment advisory firm.

You have been given a raw Q&A conversation transcript between a property advisor and an AI analyst about investment property reports. Transform it into a polished, structured analytical report suitable for client presentation.

## INSTRUCTIONS
1. Extract ALL key insights, findings, data points, and recommendations from the conversation
2. Organize them into a professional report structure
3. Remove conversational artifacts (greetings, "thank you", repetition, back-and-forth)
4. Preserve ALL numerical data, statistics, and specific details mentioned
5. Write in a professional third-person analytical tone
6. Use proper markdown formatting with headings, bullet points, and tables where appropriate
7. Do not include links or URLs

## REQUIRED REPORT STRUCTURE
Use the following sections (skip any that have no relevant content):

# ${args.title || 'Investment Analysis Report'}

## Executive Summary
## Property Overview
## Financial Analysis
## Market & Location Insights
## Risk Assessment
## Opportunities & Strengths
## Recommendations
## Additional Notes

Reports analysed: ${args.reportNames.join(', ') || 'N/A'}

## RAW CONVERSATION TRANSCRIPT
${transcript}`;

  const started = Date.now();
  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-5.2',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert report writer. Transform raw conversations into polished, structured reports. Output only the final markdown report, no preamble.',
        },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: 8192,
    }),
  });

  if (!response.ok) {
    console.error(`[render-report-qa-pdf] summarise failed: ${response.status}`);
    return null;
  }

  const payload = await response.json();
  const usage = extractOpenAIUsage(payload);

  // Metered. `summarize-conversation` makes this same call and logs nothing,
  // which is how an unbounded gpt-5.2 spend became invisible. A new route is
  // not the place to inherit that.
  await logApiUsage(supabase, {
    service_name: 'openai',
    endpoint: '/v1/chat/completions',
    model_used: 'gpt-5.2',
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    tokens_used: usage.total_tokens,
    response_time_ms: Date.now() - started,
    status: 'success',
    user_id: args.userId,
    metadata: {
      function: 'render-report-qa-pdf',
      action: 'summarize-conversation',
      conversation_id: args.conversationId,
    },
  });

  const text = payload?.choices?.[0]?.message?.content;
  return typeof text === 'string' && text.trim() ? text : null;
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // SEC5-CSRF: reject cross-site cookie-authenticated invocations.
  //
  // This function authenticates through `verifyAuthOrNativeUser`, which reads
  // the `__Host-session_token` cookie and nothing else — and that cookie is
  // issued `SameSite=None`, so a page on any origin can make the browser send
  // it. `_shared/auth.ts` states the rule: a function that accepts the cookie
  // MUST also run `enforceCsrf`. Twelve did not, because
  // `check-csrf-coverage.mjs` tested `/\bverifyAuth\b/`, which cannot match
  // `verifyAuthOrNativeUser` — so the gate reported full coverage while
  // reporting on none of them. No-cookie and GET/HEAD/OPTIONS callers pass
  // through untouched.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const started = Date.now();
  let renderId: string | null = null;

  try {
    const body = await req.json().catch(() => null);

    // Identity first: nothing below this line runs for an anonymous caller, and
    // the service-role identity is refused because it is not a person.
    const auth = await verifyAuthOrNativeUser(
      supabase,
      req,
      body as { session_token?: string; command_centre_session_token?: string },
    );
    if (auth.error || !auth.userId || auth.userId === 'service_role') {
      return json({ error: auth.error || 'Authentication required' }, 401);
    }

    const parsed = parseRenderRequest(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const request = parsed.request;

    // Two gates, answering different questions: whether this person may read Q&A
    // conversations at all, and whether they may read *this* one.
    const permission = await requireModulePermission(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      'report_qa',
      'can_view',
    );
    if (!permission.ok) {
      return json({ error: permission.error || 'Report Q&A view permission required' }, 403);
    }

    // The resolver takes superadmin as a flag rather than looking it up, so it
    // has to be supplied here — without it a superadmin passes the module gate
    // and is then refused by the conversation gate, which is not what either
    // rule says.
    const access = await resolveReportQaAccess(supabase, {
      actorId: auth.userId,
      isSuperadmin: await actorIsSuperadmin(supabase, auth.userId),
      conversationId: request.conversationId,
    });
    // 403, not 404: the caller has already proved they may read conversations,
    // so saying this one is not theirs leaks nothing a list would not.
    if (access.role === 'denied' || !access.conversation) {
      return json({ error: 'You do not have access to this conversation' }, 403);
    }

    const weasyprint = weasyPrintConfig((key) => Deno.env.get(key));
    if (!weasyprint) {
      // Checked before the reads: a misconfigured environment should say so, not
      // after four queries, a model call and a document build.
      return json({
        error: 'WeasyPrint is not configured (WEASYPRINT_SERVICE_URL + WEASYPRINT_SERVICE_TOKEN)',
      }, 503);
    }

    // ── The record ──────────────────────────────────────────────────────────

    const id = request.conversationId;
    const [conversationRes, messagesRes, whitelabelRes, settingsRes] = await Promise.all([
      supabase
        .from('report_qa_conversations')
        .select('id, title, report_names, structured_report, created_at')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('report_qa_messages')
        .select('id, role, content, edited_content, created_at, model_provider, model_version, citations')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true }),
      supabase.from('whitelabel_settings').select('*').limit(1).maybeSingle(),
      supabase
        .from('global_report_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['contact_details', 'professional_disclaimer']),
    ]);

    // The error is checked before the data on every read. A failed query that
    // returns nothing is not an empty conversation, and treating it as one would
    // print a transcript with exchanges silently missing — indistinguishable,
    // on the page, from a conversation that never had them.
    for (const [label, res] of [
      ['report_qa_conversations', conversationRes],
      ['report_qa_messages', messagesRes],
    ] as const) {
      if (res.error) throw new Error(`could not read ${label}: ${res.error.message}`);
    }
    if (!conversationRes.data) return json({ error: 'not found' }, 404);

    const conversation = conversationRes.data as Record<string, unknown>;
    const messages = (messagesRes.data ?? []) as Record<string, unknown>[];

    // ── The brand, frozen ───────────────────────────────────────────────────

    const whitelabel = (whitelabelRes.data ?? null) as Record<string, unknown> | null;
    const settings = readReportSettings(settingsRes.data, settingsRes.error?.message ?? null);
    const storedLogos = (whitelabel?.logo_config ?? {}) as Record<string, string | null>;
    const themeConfig = (whitelabel?.theme_config ?? {}) as Record<string, unknown>;

    const { assets: logoConfig, notes: assetNotes } = await inlineBrandAssets(storedLogos, {
      supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
    });
    for (const note of assetNotes) {
      console.warn(
        `[render-report-qa-pdf] asset ${note.key} not inlined (${note.reason}): ${note.detail}`,
      );
    }

    const { snapshot, skippedAssets } = buildReportBrandSnapshot({
      whitelabel: whitelabel
        ? {
            id: String(whitelabel.id ?? ''),
            themeVersion: Number(whitelabel.theme_version ?? 0) || null,
            companyName: String(whitelabel.company_name ?? ''),
            tradingName: String(themeConfig.tradingName ?? ''),
            brandColour: String(themeConfig.brandColour ?? whitelabel.primary_color ?? ''),
            preset: String(themeConfig.reportPreset ?? ''),
            assets: logoConfig,
          }
        : null,
      contact: settings.contact as never,
      document: {
        confidentiality: String(themeConfig.reportConfidentiality ?? ''),
        preparedBy: String(whitelabel?.company_name ?? ''),
      },
      // The clock lives here, at the edge, and nowhere in the pure modules.
      capturedAt: new Date().toISOString(),
    });

    for (const skipped of skippedAssets) {
      console.warn(
        `[render-report-qa-pdf] asset ${skipped.source} skipped (${skipped.reason}): ${skipped.detail}`,
      );
    }

    // ── The write-up, generated only if it was asked for ────────────────────

    let generated = false;
    if (
      request.subject === 'structured'
      && !String(conversation.structured_report ?? '').trim()
      && request.generateIfMissing
    ) {
      const draft = buildReportQaDocument({
        conversation,
        messages,
        subject: 'transcript',
        preparedOn: new Date().toISOString(),
      });
      if (draft.ok) {
        const text = await generateStructuredReport(supabase, {
          conversationId: id,
          title: String(conversation.title ?? ''),
          reportNames: draft.document.grounding.reportNames,
          companyName: snapshot.company.name,
          turns: draft.document.turns.map((t) => ({ question: t.question, answer: t.answer })),
          userId: auth.userId,
        });
        if (text) {
          conversation.structured_report = text;
          generated = true;
          // Persisted so the second render of this conversation is free. A
          // failure to cache is not a failure to render.
          const { error: cacheError } = await supabase
            .from('report_qa_conversations')
            .update({ structured_report: text })
            .eq('id', id);
          if (cacheError) {
            console.warn(`[render-report-qa-pdf] could not cache structured report: ${cacheError.message}`);
          }
        }
      }
    }

    // ── Build the document ──────────────────────────────────────────────────

    const now = new Date().toISOString();
    const built = buildReportQaDocument({
      conversation,
      messages,
      subject: request.subject,
      messageId: request.messageId,
      preparedOn: now,
    });
    // A refusal here is about what the record holds, not about this function —
    // "no structured report stored" is something the caller can act on.
    if (!built.ok) return json({ error: built.error }, 400);
    const document = built.document;

    const { data: brandSnapshotId } = await supabase.rpc('upsert_report_brand_snapshot', {
      _fingerprint: snapshot.fingerprint,
      _snapshot_version: REPORT_SNAPSHOT_VERSION,
      _payload: snapshot,
      _company_name: snapshot.company.name,
      _brand_hex: snapshot.brandHex,
      _source_whitelabel_setting_id: snapshot.source.whitelabelSettingId,
    });

    // The tenant's own cover asset and nowhere else. Three of the four legacy
    // generators hardcode `/templates/npc-qa-cover.jpg`, and the fourth copies
    // page one of a single global `report_structure_templates` row.
    const coverArt = inlineAsset(logoConfig.cover ?? null);

    const rendered = renderReportQaFromBrand({
      document,
      snapshot,
      disclaimer: settings.disclaimer as never,
      coverArtDataUri: coverArt.ok ? coverArt.asset.dataUri : null,
      edition: request.edition,
      reference: reportQaReference(id),
    });

    // A spine that violates its own archetype is a defect, not a preference.
    // This format's sections are discovered from model output, so it is the one
    // place in the programme where that can happen at runtime.
    if (rendered.problems.length) {
      throw new Error(`document structure is invalid: ${rendered.problems.join('; ')}`);
    }

    // The guard runs on HTML this function built, deliberately: the prose in it
    // is model output and the assets came from a tenant's settings form, so the
    // boundary is where the check belongs.
    assertSafeRenderResources(rendered.html, Deno.env.get('SUPABASE_URL') || '');

    // ── Render, store, sign ─────────────────────────────────────────────────

    const fileName = reportQaFileName(document.meta.title, request.subject, now);
    const path = reportQaStoragePath(id, fileName, now, crypto.randomUUID());

    const { data: renderRow } = await supabase
      .from('report_qa_renders')
      .insert({
        conversation_id: id,
        message_id: request.messageId,
        subject: request.subject,
        requested_by: auth.userId,
        status: 'running',
        file_name: fileName,
        storage_bucket: STORAGE_BUCKET,
        storage_path: path,
        brand_snapshot_id: brandSnapshotId ?? null,
        brand_gaps: rendered.gaps,
        sections_included: rendered.sections,
        turn_count: document.meta.turnCount,
        turns_shown: rendered.turnsShown,
        truncated: rendered.truncated,
        generated_summary: generated,
      })
      .select('id')
      .maybeSingle();
    renderId = (renderRow?.id as string) ?? null;

    const pdf = await renderPdf(weasyprint, rendered.html, {
      variant: 'pdf/ua-1',
      tagged: true,
      // The ledger row and the source row, stamped into the PDF itself.
      // See `DocumentProvenance` — a delivered file could not be traced
      // back to the render that produced it.
      provenance: {
        format: 'report-qa',
        renderId: renderId,
        sourceId: request.messageId,
        renderedAt: now,
      },
    });

    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, pdf, {
      contentType: 'application/pdf',
      // Never overwrite: the path carries a random segment precisely so a second
      // render cannot replace a file somebody already has a link to.
      upsert: false,
      cacheControl: '3600',
    });
    if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);

    const { data: signed, error: signError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      throw new Error(`signing failed: ${signError?.message ?? 'no url returned'}`);
    }

    // ── Optionally, into the conversation ───────────────────────────────────
    //
    // The shape `PDFAttachmentMessage.tsx:39` already reads, so the in-place
    // email compose works against this document without changing. Written after
    // the upload succeeded, so a message can never point at a file that is not
    // there.

    let attachment: ReportQaRenderResponse['attachment'] = null;
    if (request.attachToConversation) {
      const { data: messageRow, error: attachError } = await supabase
        .from('report_qa_messages')
        .insert({
          conversation_id: id,
          role: 'assistant',
          content: `A typeset PDF of this conversation is attached: ${fileName}`,
          model_provider: 'system',
          attachments: [{
            name: fileName,
            url: signed.signedUrl,
            size: pdf.length,
            type: 'application/pdf',
            path,
            bucket: STORAGE_BUCKET,
          }],
        })
        .select('id')
        .maybeSingle();
      if (attachError) {
        // Not fatal. The file exists and the caller has its URL; failing the
        // whole render because a chat message could not be written would throw
        // away a document that was produced successfully.
        console.warn(`[render-report-qa-pdf] could not attach to conversation: ${attachError.message}`);
      } else if (messageRow?.id) {
        attachment = {
          messageId: String(messageRow.id),
          name: fileName,
          url: signed.signedUrl,
          size: pdf.length,
        };
      }
    }

    const durationMs = Date.now() - started;
    const pageCount = await countPdfPagesAsync(pdf);

    if (renderId) {
      await supabase
        .from('report_qa_renders')
        .update({
          status: 'succeeded',
          bytes: pdf.length,
          page_count: pageCount,
          duration_ms: durationMs,
        })
        .eq('id', renderId);
    }

    const response: ReportQaRenderResponse = {
      url: signed.signedUrl,
      fileName,
      bytes: pdf.length,
      pageCount,
      renderId,
      brandSnapshotId: (brandSnapshotId as string) ?? null,
      brandGaps: rendered.gaps,
      sections: rendered.sections,
      subject: request.subject,
      turnCount: document.meta.turnCount,
      turnsShown: rendered.turnsShown,
      truncated: rendered.truncated,
      generated,
      attachment,
      durationMs,
    };
    return json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[render-report-qa-pdf]', message);
    if (renderId) {
      await supabase
        .from('report_qa_renders')
        .update({ status: 'failed', error: message.slice(0, 2000), duration_ms: Date.now() - started })
        .eq('id', renderId);
    }
    return json({ error: message, renderId }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
