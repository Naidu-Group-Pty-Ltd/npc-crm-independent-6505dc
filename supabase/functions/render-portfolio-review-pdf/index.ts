/**
 * render-portfolio-review-pdf
 *
 * The Portfolio Performance Review, typeset server-side through WeasyPrint.
 *
 * ## What this route owns
 *
 * All of it. Unlike the Cash Flow route — which has to take its projection from
 * the browser, because the modal holds overrides the adviser has not saved —
 * everything this document says is already in two rows. The caller sends an
 * identifier; the route reads the report, the client's name, the review and the
 * brand, and nothing about the contents is the caller's to choose.
 *
 * ## Six properties, the same six the other two hold
 *
 *  1. **Auth is a human, then that human and this client.** The gateway JWT
 *     check is off across this project to support the custom session flow, so
 *     `verifyAuthOrNativeUser` establishes the identity and `canAccessClient`
 *     establishes the relationship. Neither implies the other, and 759 of 766
 *     clients have a null `created_by`, so ownership alone would refuse almost
 *     everyone — hence the `portfolio_reports / can_view` fallback.
 *  2. **The client's name is read, not accepted**, through `CLIENT_NAME_COLUMNS`.
 *     Spelling those columns by hand is what shipped the Snapshot's 404.
 *  3. **A failed read is not a missing row.** Every query checks `error` before
 *     `data` and throws with the message the database gave. A `select` naming a
 *     column that does not exist returns no data and no row, and reporting that
 *     as "not found" cost a full debugging cycle on the Snapshot.
 *  4. **The brand is snapshotted, then referenced.** `upsert_report_brand_snapshot`
 *     dedupes by content fingerprint.
 *  5. **Resources are checked before the POST.** `assertSafeRenderResources` runs
 *     even though this function built the HTML: an asset arrives from a tenant's
 *     settings form, and the guard belongs on the boundary, not on the trust.
 *  6. **No fallback, and every attempt leaves a row** in `portfolio_review_renders`.
 *
 * ## It is not metered
 *
 * `generate-portfolio-analysis` runs under `withReportMetering` because it
 * reserves tokens and asks a model. Typesetting a row that already exists asks
 * nothing of any model, so re-rendering a saved report is free and the UI shows
 * no cost estimate beside it.
 *
 * ## It does not touch `pdf_file_path`
 *
 * That column is what *publish to client portal* reads
 * (`manage-client-data/index.ts:540–609`). Overwriting it would silently change
 * which document every future publication sends, without anyone choosing that.
 * This path records itself in its own ledger and returns a signed URL; switching
 * what the portal publishes stays a separate, deliberate decision.
 *
 * ## The legacy generator stays
 *
 * `PortfolioAnalysisPDFGenerator` is not touched by this work at all — it has no
 * importable blob entry point to call, so there is nothing to share and nothing
 * to break. This is a second path beside it.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuthOrNativeUser } from '../_shared/auth.ts';
import { canAccessClient } from '../_shared/clientAccess.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { CLIENT_NAME_COLUMNS, clientDisplayName } from '../_shared/clientName.ts';
import { assertSafeRenderResources } from '../_shared/renderResourcePolicy.pure.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';
import { countPdfPagesAsync, renderPdf, weasyPrintConfig } from '../_shared/weasyprintClient.ts';
import {
  buildReportBrandSnapshot,
  REPORT_SNAPSHOT_VERSION,
} from '../_shared/reportDesign/snapshot.pure.ts';
import { inlineAsset } from '../_shared/reportDesign/assets.pure.ts';
import { inlineBrandAssets } from '../_shared/reportDesign/fetchBrandAssets.ts';
import {
  buildPortfolioReview,
  PortfolioPayloadError,
} from '../_shared/reports/portfolio/normalise.pure.ts';
import { renderPortfolioFromBrand } from '../_shared/reports/portfolio/render.pure.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  parseRenderRequest,
  portfolioFileName,
  portfolioStoragePath,
  SIGNED_URL_TTL_SECONDS,
  type PortfolioRenderResponse,
} from '../_shared/reports/portfolio/route.pure.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token, x-finance-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PDF_BUCKET = 'client-files';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

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
    console.warn(`[render-portfolio-review-pdf] global_report_settings unreadable: ${queryError}`);
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

    const weasyprint = weasyPrintConfig((key) => Deno.env.get(key));
    if (!weasyprint) {
      // Checked before the reads: a misconfigured environment should say so,
      // not after four queries and a document build.
      return json({
        error: 'WeasyPrint is not configured (WEASYPRINT_SERVICE_URL + WEASYPRINT_SERVICE_TOKEN)',
      }, 503);
    }

    // ── The report, and who it belongs to ───────────────────────────────────

    const reportRes = await supabase
      .from('portfolio_analysis_reports')
      .select('id, client_id, report_data, overall_health, created_at, status')
      .eq('id', request.reportId)
      .maybeSingle();

    // `error` before `data`, always. A malformed select returns neither, and
    // calling that "not found" sends whoever debugs it looking for a missing
    // row that is sitting right there.
    if (reportRes.error) {
      throw new Error(`could not read the portfolio report: ${reportRes.error.message}`);
    }
    if (!reportRes.data) return json({ error: 'not found' }, 404);
    const report = reportRes.data as Record<string, unknown>;

    const clientId = typeof report.client_id === 'string' ? report.client_id : '';
    if (!clientId) {
      throw new Error('the portfolio report names no client');
    }

    // Authorisation, not authentication. Ownership first, then the module
    // permission, because almost every client row has a null `created_by`.
    const actor = { userId: auth.userId, authMethod: auth.authMethod };
    if (!await canAccessClient(supabase, actor, clientId)) {
      const staff = await requireModulePermission(supabase, actor, 'portfolio_reports', 'can_view');
      // 404 rather than 403: whether a given report exists is itself something
      // a caller with no relationship to the client is not entitled to learn.
      if (!staff.ok) return json({ error: 'not found' }, 404);
    }

    // ── Everything else the document says ───────────────────────────────────

    const [clientRes, reviewRes, whitelabelRes, settingsRes] = await Promise.all([
      supabase.from('clients').select(CLIENT_NAME_COLUMNS).eq('id', clientId).maybeSingle(),
      request.includeReview
        ? supabase
          .from('portfolio_reviews')
          .select('*')
          .eq('client_id', clientId)
          .eq('status', 'completed')
          .order('review_date', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('whitelabel_settings').select('*').limit(1).maybeSingle(),
      supabase
        .from('global_report_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['contact_details', 'professional_disclaimer']),
    ]);

    // The client's name is on the cover of a document addressed to them, so a
    // failure to read it is a failure, not a cosmetic gap. This is the read that
    // was silently broken on the Snapshot route.
    if (clientRes.error) {
      throw new Error(`could not read the client: ${clientRes.error.message}`);
    }
    const clientName = clientDisplayName(clientRes.data as never);
    if (!clientName) {
      throw new Error('the client record holds no name to address this review to');
    }

    // The review is optional by design — the document is whole without one — so
    // a failed read degrades to "no review" and says so in the log rather than
    // refusing to render.
    if (reviewRes.error) {
      console.warn(
        `[render-portfolio-review-pdf] could not read the review: ${reviewRes.error.message}`,
      );
    }
    const review = (reviewRes.data ?? null) as Record<string, unknown> | null;

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
        `[render-portfolio-review-pdf] asset ${note.key} not inlined (${note.reason}): ${note.detail}`,
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
        `[render-portfolio-review-pdf] asset ${skipped.source} skipped (${skipped.reason}): ${skipped.detail}`,
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

    // ── Build the document ──────────────────────────────────────────────────

    const now = new Date().toISOString();
    const portfolio = buildPortfolioReview({ report, review, clientName, now });

    // Cover art comes from the tenant's own `cover` asset and nowhere else. The
    // legacy's cover is page 0 of `NPC_PDF_Template-6.pdf` — a raster with our
    // company name in the pixels, which on a white-label tenant's report prints
    // two company names on one page.
    const coverArt = inlineAsset(logoConfig.cover ?? null);

    const { html, gaps } = renderPortfolioFromBrand({
      review: portfolio,
      snapshot,
      disclaimer: settings.disclaimer as never,
      coverArtDataUri: coverArt.ok ? coverArt.asset.dataUri : null,
      edition: request.edition,
    });

    assertSafeRenderResources(html, Deno.env.get('SUPABASE_URL') || '');

    // ── Render, store, sign ─────────────────────────────────────────────────

    const fileName = portfolioFileName(clientName, now);
    const path = portfolioStoragePath(clientId, fileName, now, crypto.randomUUID());

    const { data: renderRow } = await supabase
      .from('portfolio_review_renders')
      .insert({
        report_id: request.reportId,
        client_id: clientId,
        review_id: (review?.id as string) ?? null,
        requested_by: auth.userId,
        status: 'running',
        file_name: fileName,
        storage_bucket: PDF_BUCKET,
        storage_path: path,
        brand_snapshot_id: brandSnapshotId ?? null,
        brand_gaps: gaps,
        holdings: portfolio.holdings.length,
      })
      .select('id')
      .maybeSingle();
    renderId = (renderRow?.id as string) ?? null;

    const pdf = await renderPdf(weasyprint, html, {
      variant: 'pdf/ua-1',
      tagged: true,
      // The ledger row and the source row, stamped into the PDF itself.
      // See `DocumentProvenance` — a delivered file could not be traced
      // back to the render that produced it.
      provenance: {
        format: 'portfolio-performance',
        renderId: renderId,
        sourceId: request.reportId,
        renderedAt: now,
      },
    });

    const { error: uploadError } = await supabase.storage.from(PDF_BUCKET).upload(path, pdf, {
      contentType: 'application/pdf',
      // Never overwrite: the path carries a random segment precisely so a second
      // render cannot replace a file someone already has a link to.
      upsert: false,
      cacheControl: '3600',
    });
    if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);

    const { data: signed, error: signError } = await supabase.storage
      .from(PDF_BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      throw new Error(`signing failed: ${signError?.message ?? 'no url returned'}`);
    }

    const durationMs = Date.now() - started;
    const pageCount = await countPdfPagesAsync(pdf);

    if (renderId) {
      await supabase
        .from('portfolio_review_renders')
        .update({ status: 'succeeded', bytes: pdf.length, pages: pageCount, duration_ms: durationMs })
        .eq('id', renderId);
    }

    const response: PortfolioRenderResponse = {
      url: signed.signedUrl,
      path,
      fileName,
      bytes: pdf.length,
      pageCount,
      renderId,
      brandSnapshotId: (brandSnapshotId as string) ?? null,
      brandGaps: gaps,
      reviewIncluded: Boolean(portfolio.review),
      durationMs,
    };
    return json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[render-portfolio-review-pdf]', message);
    if (renderId) {
      await supabase
        .from('portfolio_review_renders')
        .update({ status: 'failed', error: message.slice(0, 2000), duration_ms: Date.now() - started })
        .eq('id', renderId);
    }
    // A report whose `report_data` holds no properties is the row's fault, not
    // the server's, and says so with a 400 naming the field — "invalid payload"
    // costs an hour that "report_data.propertyAnalyses is empty" does not.
    const status = e instanceof PortfolioPayloadError ? 400 : 500;
    return json({ error: message, renderId }, status);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
