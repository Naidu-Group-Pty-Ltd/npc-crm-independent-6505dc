/**
 * convert-template-document
 *
 * An existing template goes in; a document set through the report design system
 * and bound to a report format comes out.
 *
 * ## The three steps, and why they are three requests
 *
 * `extract` parses, `propose` re-scores against a different format, `render`
 * produces the PDF. They are separate because a person sits between them:
 * binding is *suggested and then confirmed*, never silently guessed. A wrong
 * automatic binding produces a document where the "Serviceability" chapter is
 * filled with the fee schedule, which looks entirely correct and is completely
 * wrong. A visible low score is recoverable; a silent mismatch is not.
 *
 * `propose` re-reads the stored Markdown rather than the upload, so trying a
 * second format costs nothing. Parsing a PDF is the slow and expensive half.
 *
 * ## What is taken from the upload, and what is deliberately left
 *
 * Sections, their order, their nesting and whether they are tabular. Not
 * margins, not colours, not where a logo sat — those are the things the design
 * system is replacing, and carrying them across would reproduce the document
 * rather than refurbish it.
 *
 * ## The source never becomes a stored file
 *
 * The bytes arrive in the request and the extracted Markdown is stored on the
 * row. No bucket, so an abandoned conversion leaves no orphaned object — which
 * matters here because the repo's artifact retention job is dry-run by design
 * and never deletes anything.
 *
 * ## Nothing is rendered without a design system
 *
 * The palette comes from the chosen `brand_design_systems` row, resolved at
 * render time. Storing a resolved palette would freeze it against the preset it
 * was derived under, which is a bug this repo has shipped once already.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuthOrNativeUser } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { assertSafeRenderResources } from '../_shared/renderResourcePolicy.pure.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';
import { countPdfPagesAsync, renderPdf, weasyPrintConfig } from '../_shared/weasyprintClient.ts';
import {
  buildReportBrandSnapshot,
  REPORT_SNAPSHOT_VERSION,
} from '../_shared/reportDesign/snapshot.pure.ts';
import { inlineAsset } from '../_shared/reportDesign/assets.pure.ts';
import { inlineBrandAssets } from '../_shared/reportDesign/fetchBrandAssets.ts';
import { resolveReportPalette } from '../_shared/reportDesign/brandResolve.pure.ts';
import { disclaimerParagraphs } from '../_shared/reportDesign/companyBlock.pure.ts';
import {
  describeStructure,
  type ExtractedStructure,
  extractStructure,
  MAX_SOURCE_CHARS,
} from '../_shared/reports/converted/structure.pure.ts';
import {
  bindableFormats,
  formatName,
  readBindingPlan,
} from '../_shared/reports/converted/binding.pure.ts';
import { proposeBindingWithModel } from '../_shared/reports/converted/bind.ts';
import {
  planConvertedChapters,
  renderConvertedFromBrand,
} from '../_shared/reports/converted/render.pure.ts';
import { enrichChapters } from '../_shared/reports/converted/enrich.ts';
import type { ReportArchetypeId } from '../_shared/reportDesign/structure.pure.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  type ConvertChaptersResponse,
  type ConvertExtractResponse,
  type ConvertListResponse,
  type ConvertListRow,
  type ConvertProposeResponse,
  type ConvertRenderResponse,
  convertedFileName,
  convertedReference,
  convertedStoragePath,
  base64Bytes,
  parseConvertRequest,
  readDesignSystemRow,
  pdfExtractionPrompt,
  SIGNED_URL_TTL_SECONDS,
  STORAGE_BUCKET,
} from '../_shared/reports/converted/route.pure.ts';
import {
  ANTHROPIC_MESSAGES_URL,
  type AnthropicCredential,
  anthropicJsonHeaders,
} from '../_shared/anthropicRoute.pure.ts';
import { resolveAnthropicCredential } from '../_shared/anthropicCredential.ts';

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

const MODEL = 'claude-opus-4-8';
/** A forty-page template through vision extraction is not a quick call. */
const MODEL_TIMEOUT_MS = 240_000;

/**
 * The company block, out of the key/value table it lives in.
 *
 * `global_report_settings` is `(setting_key, setting_value jsonb)`. Reading it
 * as though it had `contact_details` and `disclaimer` columns is the mistake
 * that shipped every Borrowing Capacity Snapshot without an ABN.
 */
function readReportSettings(
  rows: unknown,
  queryError: string | null,
): { contact: Record<string, unknown> | null; disclaimer: Record<string, unknown> | null } {
  if (queryError) {
    console.warn(`[convert-template-document] global_report_settings unreadable: ${queryError}`);
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
 * Is this actor a superadmin?
 *
 * One helper called from both places that need it. A conversion holds whatever
 * prose was in somebody's uploaded template, and this route runs as service
 * role — the table's RLS says "owner or superadmin" but RLS is bypassed here,
 * so the rule has to be restated in code. Restating it *twice* is how the two
 * copies drift.
 */
async function actorIsSuperadmin(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
): Promise<boolean> {
  const { data: roleRows } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId);
  return (roleRows ?? []).some(
    (r: { role?: string }) => String(r?.role ?? '').toLowerCase() === 'superadmin',
  );
}

/** Base64 to bytes, without a data-URI prefix. */
function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64.replace(/^data:[^,]*,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * A PDF to Markdown, by asking Claude to transcribe it.
 *
 * The alternative — a text-layer extraction — returns the words and loses the
 * headings, and headings are the only thing `extractStructure` reads. A
 * transcription with no `##` produces a one-section document and a notice
 * saying so, which is a correct outcome and a useless one.
 *
 * Sent as a `document` content block, so a scanned template goes through the
 * same path as a native one rather than needing an OCR branch.
 */
async function pdfToMarkdown(
  credential: AnthropicCredential,
  base64: string,
  fileName: string,
): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: anthropicJsonHeaders(credential),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16_000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            { type: 'text', text: pdfExtractionPrompt(fileName) },
          ],
        }],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    return { ok: false, error: `the extraction service did not answer: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return {
      ok: false,
      error: `the extraction service refused (${response.status}): ${detail.slice(0, 300)}`,
    };
  }

  const message = await response.json().catch(() => null) as
    | { content?: Array<{ type?: string; text?: string }> }
    | null;
  const markdown = (Array.isArray(message?.content) ? message!.content : [])
    .filter((b) => b?.type === 'text')
    .map((b) => b?.text ?? '')
    .join('\n')
    .trim();

  if (!markdown) return { ok: false, error: 'nothing could be read from the PDF' };
  return { ok: true, markdown };
}

/** The shape the review screen needs, out of an extracted structure. */
function sectionRows(structure: ExtractedStructure): ConvertExtractResponse['sections'] {
  return structure.sections.map((s) => ({
    index: s.index,
    depth: s.depth,
    title: s.title,
    chars: s.chars,
    tabular: s.tabular,
  }));
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
  let conversionId: string | null = null;

  try {
    const body = await req.json().catch(() => null);

    const auth = await verifyAuthOrNativeUser(
      supabase,
      req,
      body as { session_token?: string; command_centre_session_token?: string },
    );
    if (auth.error || !auth.userId || auth.userId === 'service_role') {
      return json({ error: auth.error || 'Authentication required' }, 401);
    }

    const parsed = parseConvertRequest(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const request = parsed.request;

    const permission = await requireModulePermission(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      'templates',
      'can_edit',
    );
    if (!permission.ok) {
      return json({ error: permission.error || 'Templates edit permission required' }, 403);
    }

    // ── list ────────────────────────────────────────────────────────────────
    //
    // What makes a conversion findable again. Scoped to the caller's own rows
    // unless they are a superadmin, and every stored PDF re-signed on the way
    // out — the bucket is private and grants `authenticated` nothing, so a
    // signed URL issued here is the only way back to the file.

    if (request.action === 'list') {
      const superadmin = await actorIsSuperadmin(supabase, auth.userId);
      let query = supabase
        .from('template_conversions')
        .select(
          'id, status, source_filename, file_name, bound_format, storage_bucket, storage_path, '
          + 'page_count, bytes, bound_chapters, unfilled_chapters, appendix_sections, '
          + 'unstructured, error, created_at, fidelity, enriched_chapters, '
          + 'enrichment_model, binding_source, brand_design_systems(name)',
        )
        .order('created_at', { ascending: false })
        .limit(request.limit);
      if (!superadmin) query = query.eq('requested_by', auth.userId);

      const { data, error } = await query;
      if (error) throw new Error(`could not list template_conversions: ${error.message}`);

      const rows = (data ?? []) as Record<string, unknown>[];
      const conversions: ConvertListRow[] = await Promise.all(rows.map(async (row) => {
        const path = typeof row.storage_path === 'string' ? row.storage_path : '';
        let url: string | null = null;
        if (path) {
          // Per row, and never fatal. One conversion whose object has gone
          // missing must not blank the whole history.
          const { data: signed } = await supabase.storage
            .from(String(row.storage_bucket || STORAGE_BUCKET))
            .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
          url = signed?.signedUrl ?? null;
        }
        const boundFormat = typeof row.bound_format === 'string' ? row.bound_format : null;
        const system = row.brand_design_systems as { name?: string } | null;
        return {
          id: String(row.id ?? ''),
          status: String(row.status ?? ''),
          sourceFilename: String(row.source_filename ?? ''),
          fileName: String(row.file_name ?? ''),
          boundFormat,
          formatName: boundFormat ? formatName(boundFormat as ReportArchetypeId) : null,
          designSystemName: system?.name ?? null,
          pageCount: typeof row.page_count === 'number' ? row.page_count : null,
          bytes: typeof row.bytes === 'number' ? row.bytes : null,
          boundChapters: Number(row.bound_chapters ?? 0),
          unfilledChapters: Number(row.unfilled_chapters ?? 0),
          appendixSections: Number(row.appendix_sections ?? 0),
          enrichedChapters: Number(row.enriched_chapters ?? 0),
          fidelity: typeof row.fidelity === 'string' && row.fidelity ? row.fidelity : null,
          enrichmentModel: typeof row.enrichment_model === 'string' && row.enrichment_model
            ? row.enrichment_model
            : null,
          bindingSource: typeof row.binding_source === 'string' && row.binding_source
            ? row.binding_source
            : null,
          unstructured: row.unstructured === true,
          error: typeof row.error === 'string' && row.error ? row.error : null,
          createdAt: String(row.created_at ?? ''),
          url,
        };
      }));

      const response: ConvertListResponse = {
        action: 'list',
        conversions,
        durationMs: Date.now() - started,
      };
      return json(response);
    }

    // ── extract ─────────────────────────────────────────────────────────────

    if (request.action === 'extract') {
      let markdown: string;
      if (request.kind === 'text') {
        markdown = new TextDecoder().decode(decodeBase64(request.sourceBase64));
      } else {
        const resolved = await resolveAnthropicCredential();
        if (!resolved.ok) {
          return json({
            error: `PDF extraction is not configured: ${resolved.why}. `
              + 'A Markdown or text source converts without it.',
          }, 503);
        }
        const read = await pdfToMarkdown(resolved.credential, request.sourceBase64, request.fileName);
        if (!read.ok) return json({ error: read.error }, 502);
        markdown = read.markdown;
      }

      const structure = extractStructure(markdown, request.fileName.replace(/\.[a-z0-9]+$/i, ''));
      if (!structure.sections.length) {
        return json({
          error: 'nothing readable was found in the upload — no section reached the minimum length',
        }, 400);
      }

      const bindingCredential = await resolveAnthropicCredential();
      const proposed = await proposeBindingWithModel(
        bindingCredential.ok ? bindingCredential.credential : null, request.format, structure,
      );
      const plan = proposed.plan;
      if (proposed.note) console.info(`[convert-template-document] binding: ${proposed.note}`);

      const { data: row, error: insertError } = await supabase
        .from('template_conversions')
        .insert({
          requested_by: auth.userId,
          status: 'review',
          source_filename: request.fileName,
          // The uploaded file's own size, not the base64 the wire carried and
          // not the length of the Markdown that came back — for a PDF those are
          // three different numbers and only one of them is what a person means
          // by "how big was the file I uploaded".
          source_size_bytes: base64Bytes(request.sourceBase64),
          source_markdown: markdown.slice(0, MAX_SOURCE_CHARS),
          structure,
          binding: plan,
          bound_format: request.format,
          bound_chapters: plan.bindings.filter((b) => b.sectionIndex !== null).length,
          unfilled_chapters: plan.unfilled.length,
          appendix_sections: plan.unbound.length,
          binding_source: proposed.source,
          unstructured: structure.notices.unstructured,
        })
        .select('id')
        .maybeSingle();

      if (insertError) throw new Error(`could not record the conversion: ${insertError.message}`);
      if (!row) throw new Error('the conversion was not recorded');
      conversionId = String(row.id);

      const response: ConvertExtractResponse = {
        action: 'extract',
        conversionId,
        format: request.format,
        formatName: formatName(request.format),
        summary: describeStructure(structure),
        title: structure.title,
        sections: sectionRows(structure),
        unstructured: structure.notices.unstructured,
        flattened: structure.notices.flattened,
        tooShort: structure.notices.tooShort,
        charsOmitted: structure.notices.charsOmitted,
        labelsFolded: structure.notices.labelsFolded,
        binding: plan,
        bindingSource: proposed.source,
        bindingNote: proposed.note,
        durationMs: Date.now() - started,
      };
      return json(response);
    }

    // ── the stored conversion, for propose and render ───────────────────────

    const { data: conversion, error: readError } = await supabase
      .from('template_conversions')
      .select('id, requested_by, status, source_markdown, structure, source_filename, bound_format, binding')
      .eq('id', request.conversionId)
      .maybeSingle();

    // The error before the data. A failed query that returns nothing is not a
    // conversion that does not exist, and answering 404 to a database problem
    // sends somebody looking for the wrong thing.
    if (readError) throw new Error(`could not read template_conversions: ${readError.message}`);
    if (!conversion) return json({ error: 'not found' }, 404);

    // A conversion holds whatever prose was in somebody's uploaded template.
    // The table's RLS says the same thing; this route runs as service role and
    // so has to say it again itself.
    const isOwner = String(conversion.requested_by ?? '') === auth.userId;
    if (!isOwner && !(await actorIsSuperadmin(supabase, auth.userId))) {
      return json({ error: 'not found' }, 404);
    }

    // Only `render` stamps a failure onto the row, and only once the row is
    // known to exist and to be this caller's.
    //
    // `render` is the action that moves the row to `rendering`, so a throw
    // partway through leaves it stuck there unless the catch corrects it. A
    // failed `propose` or `chapters` changes no status and reads a conversion
    // that is perfectly fine — marking it `failed` would be a lie that outlives
    // the request.
    if (request.action === 'render') conversionId = request.conversionId;

    // Re-extracted rather than trusted. The stored `structure` column is a
    // convenience for the review screen; the binding indices are re-checked
    // against a structure derived from the Markdown, so a hand-edited jsonb
    // column cannot point a chapter at a section that is not there.
    const structure = extractStructure(
      String(conversion.source_markdown ?? ''),
      String(conversion.source_filename ?? '').replace(/\.[a-z0-9]+$/i, ''),
    );
    if (!structure.sections.length) {
      return json({ error: 'this conversion has no stored sections — re-upload the template' }, 409);
    }

    // ── chapters ────────────────────────────────────────────────────────────
    //
    // The document's chapters and the prose in them, so the browser can lay
    // them out as an editable template.
    //
    // Read from the *stored* binding rather than one the caller sends: this is
    // asked for after a render, and the answer has to describe the document
    // that was actually produced. `planConvertedChapters` is the same function
    // the renderer used, so the chapter list cannot disagree with the PDF.

    if (request.action === 'chapters') {
      const stored = typeof conversion.bound_format === 'string' ? conversion.bound_format : '';
      const legal = bindableFormats() as string[];
      if (!legal.includes(stored)) {
        return json({ error: 'this conversion has not been bound to a report format yet' }, 409);
      }
      const format = stored as ReportArchetypeId;
      const plan = readBindingPlan(conversion.binding, format, structure);

      const response: ConvertChaptersResponse = {
        action: 'chapters',
        conversionId: request.conversionId,
        title: structure.title,
        format,
        formatName: formatName(format),
        chapters: planConvertedChapters(structure, plan).map((c) => ({
          title: c.title,
          kind: c.kind,
          markdown: c.markdown,
        })),
        durationMs: Date.now() - started,
      };
      return json(response);
    }

    if (request.action === 'propose') {
      const proposeCredential = await resolveAnthropicCredential();
      const proposed = await proposeBindingWithModel(
        proposeCredential.ok ? proposeCredential.credential : null, request.format, structure,
      );
      const plan = proposed.plan;
      if (proposed.note) console.info(`[convert-template-document] binding: ${proposed.note}`);
      await supabase
        .from('template_conversions')
        .update({
          binding: plan,
          bound_format: request.format,
          bound_chapters: plan.bindings.filter((b) => b.sectionIndex !== null).length,
          unfilled_chapters: plan.unfilled.length,
          appendix_sections: plan.unbound.length,
          binding_source: proposed.source,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversionId);

      const response: ConvertProposeResponse = {
        action: 'propose',
        conversionId: request.conversionId,
        format: request.format,
        formatName: formatName(request.format),
        binding: plan,
        bindingSource: proposed.source,
        bindingNote: proposed.note,
        durationMs: Date.now() - started,
      };
      return json(response);
    }

    // ── render ──────────────────────────────────────────────────────────────

    const weasyprint = weasyPrintConfig((key) => Deno.env.get(key));
    if (!weasyprint) {
      return json({
        error: 'WeasyPrint is not configured (WEASYPRINT_SERVICE_URL + WEASYPRINT_SERVICE_TOKEN)',
      }, 503);
    }

    const plan = readBindingPlan(request.binding, request.format, structure);

    await supabase
      .from('template_conversions')
      .update({ status: 'rendering', updated_at: new Date().toISOString() })
      .eq('id', conversionId);

    const [systemRes, whitelabelRes, settingsRes] = await Promise.all([
      request.designSystemId
        ? supabase
          .from('brand_design_systems')
          .select('id, name, brand_hex, options, neutrals')
          .eq('id', request.designSystemId)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('whitelabel_settings').select('*').limit(1).maybeSingle(),
      supabase
        .from('global_report_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['contact_details', 'professional_disclaimer']),
    ]);

    if (systemRes.error) {
      throw new Error(`could not read brand_design_systems: ${systemRes.error.message}`);
    }
    // A named system that is not there is refused rather than quietly replaced
    // by the house default: somebody chose it, and a document in a different
    // design from the one chosen is worse than no document.
    if (request.designSystemId && !systemRes.data) {
      return json({ error: 'that design system no longer exists' }, 404);
    }

    // `neutrals` is the half this used to drop. Without it every document
    // printed on `PRESET_NEUTRALS` — four permutations of the same three
    // constants — whichever design system was chosen, so an import's own paper
    // and ink reached the specimen gallery and never the page.
    const { systemName, options, brandHex, neutrals } = readDesignSystemRow(systemRes.data);
    const palette = resolveReportPalette({ preset: options.preset, brandHex, neutrals });

    const whitelabel = (whitelabelRes.data ?? null) as Record<string, unknown> | null;
    const settings = readReportSettings(settingsRes.data, settingsRes.error?.message ?? null);

    // ── The template's own disclaimer, when ours will not print ─────────────
    //
    // `extractStructure` drops a trailing contact / disclaimer section because
    // `renderCompanyPage` prints the tenant's own. That was unconditional, so
    // when the tenant's was missing the document lost both and ended on a page
    // classed `page-disclaimer` with no disclaimer on it. A settings row that
    // was never written, and a query this route warns about and swallows, both
    // arrive here as `null`.
    //
    // So when nothing will replace it, the section is kept and comes through as
    // an appendix chapter. Re-derived rather than threaded through the earlier
    // extraction because only this branch reads the settings, and only this
    // branch prints.
    const willPrintDisclaimer =
      disclaimerParagraphs(settings.disclaimer as never).length > 0;
    if (!willPrintDisclaimer) {
      console.warn(
        '[convert-template-document] no professional disclaimer in global_report_settings — '
        + "keeping the template's own closing section",
      );
    }
    const renderStructure = willPrintDisclaimer ? structure : extractStructure(
      String(conversion.source_markdown ?? ''),
      String(conversion.source_filename ?? '').replace(/\.[a-z0-9]+$/i, ''),
      { keepClosingFurniture: true },
    );
    // Indices are re-checked against whichever structure will be printed. A
    // kept section is appended, so every earlier index still means what it did.
    const renderPlan = willPrintDisclaimer
      ? plan
      : readBindingPlan(request.binding, request.format, renderStructure);
    const storedLogos = (whitelabel?.logo_config ?? {}) as Record<string, string | null>;
    const themeConfig = (whitelabel?.theme_config ?? {}) as Record<string, unknown>;

    const { assets: logoConfig, notes: assetNotes } = await inlineBrandAssets(storedLogos, {
      supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
    });
    for (const note of assetNotes) {
      console.warn(
        `[convert-template-document] asset ${note.key} not inlined (${note.reason}): ${note.detail}`,
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
      capturedAt: new Date().toISOString(),
    });

    for (const skipped of skippedAssets) {
      console.warn(
        `[convert-template-document] asset ${skipped.source} skipped (${skipped.reason}): ${skipped.detail}`,
      );
    }

    const { data: brandSnapshotId } = await supabase.rpc('upsert_report_brand_snapshot', {
      _fingerprint: snapshot.fingerprint,
      _snapshot_version: REPORT_SNAPSHOT_VERSION,
      _payload: snapshot,
      _company_name: snapshot.company.name,
      _brand_hex: snapshot.brandHex,
      _source_whitelabel_setting_id: snapshot.source.whitelabelSettingId,
    });

    const coverArt = inlineAsset(logoConfig.cover ?? null);

    // ── The design pass ─────────────────────────────────────────────────────
    //
    // Everything above this point produced the same document the converter
    // always produced: the right chapters, in the right order, set in the right
    // brand, and *flat* — every passage a paragraph, because `renderMarkdown`
    // has no rule for a KPI strip or a utilisation bar.
    //
    // This is where a model decides what each passage actually is. It cannot
    // fail the render: a chapter that times out, invents a figure, or comes
    // back as one prose block simply has no entry in `enriched`, and
    // `planConvertedChapters` renders it exactly as before.
    const planned = planConvertedChapters(renderStructure, renderPlan);
    const enrichCredential = await resolveAnthropicCredential();
    const enrichment = await enrichChapters(
      enrichCredential.ok ? enrichCredential.credential : null,
      planned
        .filter((c) => c.kind !== 'unfilled')
        .map((c) => ({ id: c.id, title: c.title, markdown: c.markdown })),
      request.fidelity,
      request.compose,
    );
    for (const note of enrichment.notes) {
      console.info(`[convert-template-document] enrichment — ${note}`);
    }

    // One clock reading for the document and for its provenance stamp, so the
    // date printed on the page and the date inside the file cannot disagree.
    const renderedAt = new Date().toISOString();

    const rendered = renderConvertedFromBrand({
      structure: renderStructure,
      plan: renderPlan,
      snapshot,
      palette,
      options,
      systemName,
      disclaimer: settings.disclaimer as never,
      coverArtDataUri: coverArt.ok ? coverArt.asset.dataUri : null,
      preparedOn: renderedAt,
      reference: convertedReference(request.conversionId),
      enriched: enrichment.enriched,
      composed: enrichment.composed,
      final: request.final,
    });

    // The page band is advisory for a converted draft and lives in `bandNote`
    // instead — a draft carries appendix chapters the format never has. Every
    // other rule `validateSpine` enforces is a real defect here too.
    if (rendered.problems.length) {
      throw new Error(`document structure is invalid: ${rendered.problems.join('; ')}`);
    }

    // The prose came out of a file somebody uploaded and, for a PDF, through a
    // model. The boundary is where the check belongs.
    assertSafeRenderResources(rendered.html, Deno.env.get('SUPABASE_URL') || '');

    const fileName = convertedFileName(structure.title, request.format);
    const path = convertedStoragePath(request.conversionId, fileName);

    const pdf = await renderPdf(weasyprint, rendered.html, {
      variant: 'pdf/ua-1',
      tagged: true,
      // The conversion this draft belongs to, stamped into the PDF itself.
      // See `DocumentProvenance`. No separate `sourceId`: on this route the
      // ledger row and the source row are the same conversion.
      provenance: {
        format: 'converted',
        renderId: conversionId,
        renderedAt,
      },
    });

    // `upsert: true`: re-rendering one conversion after changing its binding is
    // the normal way this screen is used, and each render is the current draft
    // of that conversion rather than a new artefact.
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, pdf, {
      contentType: 'application/pdf',
      upsert: true,
      cacheControl: '3600',
    });
    if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);

    const { data: signed, error: signError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      throw new Error(`signing failed: ${signError?.message ?? 'no url returned'}`);
    }

    const durationMs = Date.now() - started;
    const pageCount = await countPdfPagesAsync(pdf);

    await supabase
      .from('template_conversions')
      .update({
        status: 'succeeded',
        binding: plan,
        bound_format: request.format,
        design_system_id: request.designSystemId,
        file_name: fileName,
        storage_bucket: STORAGE_BUCKET,
        storage_path: path,
        bytes: pdf.length,
        page_count: pageCount,
        bound_chapters: rendered.boundCount,
        unfilled_chapters: rendered.unfilledCount,
        appendix_sections: rendered.appendixCount,
        fidelity: request.fidelity,
        enriched_chapters: rendered.enrichedCount,
        enrichment_model: enrichment.model,
        enrichment_blocks: rendered.blockCounts,
        enrichment_notes: enrichment.notes.slice(0, 40),
        brand_snapshot_id: (brandSnapshotId as string) ?? null,
        duration_ms: durationMs,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.conversionId);

    const response: ConvertRenderResponse = {
      action: 'render',
      conversionId: request.conversionId,
      url: signed.signedUrl,
      fileName,
      bytes: pdf.length,
      pageCount,
      storagePath: path,
      brandSnapshotId: (brandSnapshotId as string) ?? null,
      brandGaps: rendered.gaps,
      designSystemName: systemName,
      chapters: rendered.chapters,
      boundCount: rendered.boundCount,
      unfilledCount: rendered.unfilledCount,
      appendixCount: rendered.appendixCount,
      bandNote: rendered.bandNote,
      fidelity: request.fidelity,
      enrichedChapters: rendered.enrichedCount,
      attemptedChapters: enrichment.chaptersAttempted,
      enrichmentModel: enrichment.model,
      blockCounts: rendered.blockCounts,
      enrichmentNotes: enrichment.notes.slice(0, 40),
      durationMs,
    };
    return json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[convert-template-document]', message);
    if (conversionId) {
      // Every attempt leaves the row saying what happened. A conversion stuck
      // at `rendering` with no error is one nobody can debug from production.
      await supabase
        .from('template_conversions')
        .update({
          status: 'failed',
          error: message.slice(0, 2000),
          duration_ms: Date.now() - started,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversionId);
    }
    return json({ error: message }, 500);
  }
});

Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
