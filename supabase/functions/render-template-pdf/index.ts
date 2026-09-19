/**
 * render-template-pdf  (Phase 11)
 *
 * Accepts a pre-compiled HTML payload (from `renderTemplateToHtml`), forwards
 * to the WeasyPrint microservice with configurable PDF/A + tagged options,
 * uploads the resulting PDF to storage, records a row in
 * `public.template_render_jobs`, and returns a 24h signed URL.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuthOrNativeUser } from '../_shared/auth.ts';
import { assertSafeRenderResources } from '../_shared/renderResourcePolicy.pure.ts';
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { governedAuthorityBlockFromFlags } from "../_shared/reports/contract/governedNarrativeAuthority.pure.ts";
import {
  MAX_HTML_BYTES,
  renderPdf,
  toPdfVariant,
  weasyPrintConfig,
  WeasyPrintServiceError,
  type PdfVariant,
} from "../_shared/weasyprintClient.ts";
import { functionStatusFor } from "../_shared/renderFailure.pure.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token, x-finance-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PDF_BUCKET = 'investment-reports';

/**
 * The renderer call, the timeout, the two token variable names and the
 * no-fallback rule now live in `_shared/weasyprintClient.ts`, because a second
 * render path needed all four and a second copy of them is how two paths come
 * to disagree about what a 504 means.
 */
async function callWeasyPrint(
  html: string,
  variant: PdfVariant,
  tagged: boolean,
  optimizeImages: boolean,
): Promise<Uint8Array> {
  const config = weasyPrintConfig((key) => Deno.env.get(key));
  if (!config) {
    throw new Error('WeasyPrint service not configured (set WEASYPRINT_SERVICE_URL + WEASYPRINT_SERVICE_TOKEN)');
  }
  return renderPdf(config, html, { variant, tagged, optimizeImages });
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

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let jobId: string | null = null;
  let templateId: string | null = null;
  let requestedBy: string | null = null;
  // Hoisted so the catch can record a failure that happened before the job row
  // was inserted. `file_name` is NOT NULL on the table, so a placeholder is what
  // makes the pre-render failure recordable at all.
  let fileName = 'template-render.pdf';
  let mode = 'preview';
  const started = Date.now();

  try {
    if (req.headers.get('content-length') && Number(req.headers.get('content-length')) > MAX_HTML_BYTES) {
      return new Response(JSON.stringify({ error: 'payload too large' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return new Response(JSON.stringify({ error: 'invalid json' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The gateway JWT check is intentionally disabled to support the custom
    // session flow, so enforce a verified human identity before accepting HTML
    // or invoking the privileged renderer/storage client.
    const auth = await verifyAuthOrNativeUser(supabase, req, payload as { session_token?: string; command_centre_session_token?: string });
    if (auth.error || !auth.userId || auth.userId === 'service_role') {
      return new Response(JSON.stringify({ error: auth.error || 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    requestedBy = auth.userId;

    const html: string = String(payload.html ?? '');
    if (!html.trim()) {
      return new Response(JSON.stringify({ error: 'html is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Metadata BEFORE the resource assertion, so a refusal is attributable.
    //
    // `templateId` used to be read after it, which meant a document rejected at
    // the boundary wrote no `template_render_jobs` row (the insert is further
    // down) AND no `template_events` row (that insert is guarded on
    // `templateId`). A render refused here therefore left no trace anywhere: the
    // caller saw a 500, fell back to its legacy generator, and the ledger said
    // the render had never been attempted. Every design-system render this
    // product made between 11 and 14 August 2026 failed exactly that way — all
    // 500 seeded masters carry a Google Fonts `@import` — and finding it took a
    // local reproduction rather than a query. These four lines are strings off
    // an authenticated caller's own payload; reading them early costs nothing
    // and is what makes the refusal visible.
    fileName = String(payload.fileName || 'template-preview.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    templateId = payload.templateId ? String(payload.templateId) : null;
    const templateName: string | null = payload.templateName ? String(payload.templateName).slice(0, 200) : null;
    mode = payload.mode === 'final' ? 'final' : 'preview';

    /*
     * The SECOND render path for the Investment report, and the one tried
     * FIRST.
     *
     * `produceInvestmentDocument` asks `tryTemplateDocument` before it asks
     * `render-investment-report-pdf`, so gating only the legacy route left the
     * preferred path open. This is not theoretical and not dormant: measured
     * 2026-09-12, `report_templates` carries three active `investment_compass`
     * rows plus one `investment`, and `template_render_jobs` holds ELEVEN
     * succeeded `final`-mode Investment Compass renders, the most recent
     * 2026-09-04. The adapter loads the report through `get-investment-reports`
     * and chunks `report_content` into `sections.*` bindings, so the prose a
     * governed block is about travels this way intact.
     *
     * This function is otherwise format-agnostic — it is handed compiled HTML
     * and draws it for all ten formats — so the check is scoped by the caller
     * naming a report, and asks only about a row that is actually an investment
     * report. Nothing else changes for the other nine.
     *
     * `preview` is deliberately exempt. A preview is the operator looking at
     * their own draft inside the builder; the thing being refused is a finished
     * client document.
     *
     * Failing open is the same rule the other two gates follow and for the same
     * reason: an unreadable row or absent flags must not withhold the 1,190
     * stored reports that predate this.
     */
    const boundReportId = typeof payload.reportId === 'string' && payload.reportId.trim()
      ? payload.reportId.trim()
      : null;
    if (mode === 'final' && boundReportId) {
      const { data: boundReport, error: boundErr } = await supabase
        .from('investment_reports')
        .select('id, validation_flags')
        .eq('id', boundReportId)
        .maybeSingle();
      // A read that FAILED is not a row that is ABSENT. It still fails open —
      // withholding a document because a lookup broke is the worse failure —
      // but it is SAID, because a silently discarded error is the exact class
      // this repository has been bitten by (`aml.cases`' phantom `tenant_id`,
      // the fifty-eight sweep). An id that names no investment report is the
      // ordinary case for the other nine formats and is not an error.
      if (boundErr) {
        console.warn(
          `[render-template-pdf] client-readiness lookup failed for ${boundReportId} `
          + `(${boundErr.code ?? 'no code'}) — rendering, because a failed read must not `
          + 'withhold a document',
        );
      }
      const governedBlock = governedAuthorityBlockFromFlags(
        (boundReport as Record<string, unknown> | null)?.validation_flags,
      );
      if (governedBlock.blocked) {
        console.error(
          `⛔ [render-template-pdf] refused ${boundReportId}: governed-authority block (`
          + `${governedBlock.categories.join(', ')})`,
        );
        return new Response(JSON.stringify({
          error: 'report_not_client_ready',
          reason: 'governed_authority_block',
          categories: governedBlock.categories,
          message:
            'This report asserts a governed fact it does not hold — a figure was stated for a '
            + "category the report's own record shows as unavailable. It is retained for review "
            + 'with its validation evidence, but cannot be issued as a client document until the '
            + 'claim is removed or the underlying data becomes available.',
        }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // WeasyPrint resolves image, stylesheet, and font URLs from its own network.
    // Enforce the resource boundary here even if an earlier importer or caller
    // failed to normalize an asset.
    assertSafeRenderResources(html, Deno.env.get('SUPABASE_URL') || '');
    const variant: PdfVariant = toPdfVariant(payload.pdfVariant);
    const tagged: boolean = payload.tagged !== false;
    const optimizeImages: boolean = payload.optimizeImages !== false;
    // The report a FINAL document is of, for the ledger. The gate above read
    // it already; recording it on the job row is what lets a finalisation be
    // found again by report rather than by guessing from a file name.
    const reportIdForLedger: string | null = boundReportId;
    const themeId: string | null = payload.themeId ? String(payload.themeId).slice(0, 80) : null;
    const pageMasterId: string | null = payload.pageMasterId ? String(payload.pageMasterId).slice(0, 80) : null;
    const pageCount: number | null = Number.isFinite(payload.pageCount) ? Number(payload.pageCount) : null;
    const assetCount: number | null = Number.isFinite(payload.assetCount) ? Number(payload.assetCount) : null;

    // Pre-insert job row (status=running)
    const { data: jobRow, error: jobErr } = await supabase
      .from('template_render_jobs')
      .insert({
        template_id: templateId,
        template_name: templateName,
        requested_by: requestedBy,
        mode,
        pdf_variant: variant,
        tagged,
        theme_id: themeId,
        page_master_id: pageMasterId,
        page_count: pageCount,
        asset_count: assetCount,
        file_name: fileName,
        status: 'running',
        metadata: {
          optimize_images: optimizeImages,
          html_bytes: html.length,
          ...(reportIdForLedger ? { report_id: reportIdForLedger } : {}),
        },
      })
      .select('id')
      .single();
    if (jobErr) {
      console.warn('[render-template-pdf] failed to insert job row:', jobErr.message);
    } else {
      jobId = jobRow.id as string;
    }

    const pdfBytes = await callWeasyPrint(html, variant, tagged, optimizeImages);

    const path = `template-builder/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${fileName}`;
    const { error: upErr } = await supabase.storage.from(PDF_BUCKET).upload(path, pdfBytes, {
      contentType: 'application/pdf',
      upsert: false,
      cacheControl: '3600',
    });
    if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

    const { data: signed, error: signErr } = await supabase.storage
      .from(PDF_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24); // 24h
    if (signErr || !signed?.signedUrl) throw new Error(`sign failed: ${signErr?.message ?? 'no url'}`);

    const duration = Date.now() - started;
    if (jobId) {
      await supabase
        .from('template_render_jobs')
        .update({
          status: 'succeeded',
          storage_path: path,
          signed_url: signed.signedUrl,
          signed_url_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          bytes: pdfBytes.length,
          duration_ms: duration,
        })
        .eq('id', jobId);
    }

    // Phase 14 — analytics event
    if (templateId) {
      supabase.from('template_events').insert({
        template_id: templateId,
        event_type: 'render_success',
        actor_id: requestedBy,
        metadata: {
          mode, pdf_variant: variant, bytes: pdfBytes.length,
          duration_ms: duration, theme_id: themeId, page_master_id: pageMasterId,
          page_count: pageCount, asset_count: assetCount, file_name: fileName,
        },
      }).then(() => {}, () => {});
    }

    return new Response(
      JSON.stringify({
        url: signed.signedUrl,
        // The storage path as well as the signed URL: a caller that publishes
        // the document points a portal at THIS path rather than uploading the
        // same bytes a second time. One finalisation, one stored PDF.
        path,
        fileName,
        mode,
        templateId,
        bytes: pdfBytes.length,
        jobId,
        pdfVariant: variant,
        tagged,
        durationMs: duration,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[render-template-pdf]', msg);
    if (jobId) {
      await supabase
        .from('template_render_jobs')
        .update({
          status: 'failed',
          error: msg.slice(0, 2000),
          duration_ms: Date.now() - started,
        })
        .eq('id', jobId);
    } else if (requestedBy) {
      // Failed before the job row existed — the resource boundary, a malformed
      // payload, an unreachable renderer. Record it anyway. A render that
      // leaves no row reads, to every query anyone will run, exactly like a
      // render nobody asked for; that is what hid this for three days. Guarded
      // on `requestedBy` so an unauthenticated request still writes nothing.
      const { error: recordErr } = await supabase
        .from('template_render_jobs')
        .insert({
          template_id: templateId,
          requested_by: requestedBy,
          mode,
          file_name: fileName,
          status: 'failed',
          error: msg.slice(0, 2000),
          duration_ms: Date.now() - started,
          metadata: { failed_before_render: true },
        });
      if (recordErr) {
        console.warn('[render-template-pdf] could not record pre-render failure:', recordErr.message);
      }
    }
    // Phase 14 — analytics event (failure)
    try {
      if (templateId) {
        await supabase.from('template_events').insert({
          template_id: templateId,
          event_type: 'render_failed',
          actor_id: requestedBy,
          metadata: { error: msg.slice(0, 500), duration_ms: Date.now() - started },
        });
      }
    } catch (_) {}
    // A failure the render SERVICE answered is passed on classified — 503
    // when the engine did not answer, 502 when it refused or failed — with
    // its kind and upstream status, so the caller can tell "the engine is
    // down" from "this document is bad". It used to be re-badged as this
    // function's own 500 with the service's HTML page inside the message.
    if (e instanceof WeasyPrintServiceError) {
      return new Response(JSON.stringify({
        error: msg, code: e.kind, upstreamStatus: e.upstreamStatus, retriable: e.retriable, jobId,
      }), {
        status: functionStatusFor(e.kind),
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: msg, jobId }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
