/**
 * render-cash-flow-pdf
 *
 * The 10 Year Cash Flow Analysis, rendered server-side through WeasyPrint.
 *
 * ## What this route owns, and what it does not
 *
 * It does **not** own the arithmetic. `CashFlowAnalysisModal` lets an adviser
 * override any of ten fields in any of ten years and does not persist those
 * overrides until they save, so a server that recomputed from
 * `investment_reports.financial_calculations` would render a different ten years
 * from the one the adviser just reviewed. The browser sends the projection it is
 * showing; `normalise.pure.ts` refuses anything that is not one.
 *
 * It owns everything else, and everything else is where the legacy generator
 * goes wrong: the brand (a raster cover with our company name on a white-label
 * tenant's report), the colours (`#c9a55a` written into the source), the layout
 * (a twelve-column matrix squeezed into portrait), the typography, the
 * disclaimer's point size, storage, signing, and a row per attempt.
 *
 * ## The legacy generator stays
 *
 * This is a second path. `exportSingleReportPDF`, `exportComparisonPDF` and
 * `exportAiAnalysisPDF` are untouched in the modal, and the UI offers this one
 * beside them rather than instead of them.
 *
 * ## No fallback
 *
 * If WeasyPrint fails, this fails. A silent downgrade ships a client a document
 * nobody approved — the same rule `render-borrowing-capacity-pdf` and
 * `render-investment-report-pdf` hold to.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuthOrNativeUser } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { CLIENT_NAME_COLUMNS, clientDisplayName } from '../_shared/clientName.ts';
import { assertSafeRenderResources } from '../_shared/renderResourcePolicy.pure.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';
import { countPdfPagesAsync, renderPdf, weasyPrintConfig, WeasyPrintServiceError } from '../_shared/weasyprintClient.ts';
import { functionStatusFor } from '../_shared/renderFailure.pure.ts';
import {
  buildReportBrandSnapshot,
  issuerDisclaimerSetting,
  REPORT_SNAPSHOT_VERSION,
} from '../_shared/reportDesign/snapshot.pure.ts';
import { deploymentKind } from '../_shared/emailIdentity.pure.ts';
import { inlineAsset } from '../_shared/reportDesign/assets.pure.ts';
import { inlineBrandAssets } from '../_shared/reportDesign/fetchBrandAssets.ts';
import { buildProjection, CashFlowPayloadError } from '../_shared/reports/cashFlow/normalise.pure.ts';
import { renderCashFlowFromBrand } from '../_shared/reports/cashFlow/render.pure.ts';
import { resolveRequestedDesign } from '../_shared/reports/templateDesignRead.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  cashFlowFileName,
  cashFlowStoragePath,
  parseRenderRequest,
  SIGNED_URL_TTL_SECONDS,
  type CashFlowRenderResponse,
} from '../_shared/reports/cashFlow/route.pure.ts';

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
    console.warn(`[render-cash-flow-pdf] global_report_settings unreadable: ${queryError}`);
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

    // The same gate `render-investment-report-pdf` applies to the same report.
    // Authentication is not authorisation: every staff member is authenticated.
    const permission = await requireModulePermission(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      'reports',
      'can_view',
    );
    if (!permission.ok) {
      return json({ error: permission.error || 'Report view permission required' }, 403);
    }

    const weasyprint = weasyPrintConfig((key) => Deno.env.get(key));
    if (!weasyprint) {
      // Checked before the reads: a misconfigured environment should say so,
      // not after three queries and a document build.
      return json({
        error: 'WeasyPrint is not configured (WEASYPRINT_SERVICE_URL + WEASYPRINT_SERVICE_TOKEN)',
      }, 503);
    }

    // ── Read what the caller may not state ──────────────────────────────────

    const [reportRes, whitelabelRes, settingsRes] = await Promise.all([
      supabase
        .from('investment_reports')
        .select('id, property_address, client_property_id')
        .eq('id', request.reportId)
        .maybeSingle(),
      supabase.from('whitelabel_settings').select('*').limit(1).maybeSingle(),
      supabase
        .from('global_report_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['contact_details', 'professional_disclaimer']),
    ]);

    if (!reportRes.data) return json({ error: 'not found' }, 404);
    const report = reportRes.data as Record<string, unknown>;

    // The client's name is a nicety on the cover, not an access decision — the
    // permission check above is the access decision. A report with no client
    // attached renders without a "prepared for" line rather than failing.
    let clientName = '';
    if (report.client_property_id) {
      const { data: property } = await supabase
        .from('client_properties')
        .select('client_id')
        .eq('id', report.client_property_id)
        .maybeSingle();
      if (property?.client_id) {
        const { data: client, error } = await supabase
          .from('clients')
          .select(CLIENT_NAME_COLUMNS)
          .eq('id', property.client_id)
          .maybeSingle();
        // Reported rather than swallowed. This select named three columns that
        // do not exist on `clients` and nobody noticed, because a name missing
        // from a cover looks like a report with no client attached.
        if (error) {
          console.warn(`[render-cash-flow-pdf] could not read the client: ${error.message}`);
        }
        clientName = clientDisplayName(client);
      }
    }

    // ── The brand, frozen ───────────────────────────────────────────────────

    const whitelabel = (whitelabelRes.data ?? null) as Record<string, unknown> | null;
    const settings = readReportSettings(settingsRes.data, settingsRes.error?.message ?? null);
    const storedLogos = (whitelabel?.logo_config ?? {}) as Record<string, string | null>;
    const themeConfig = (whitelabel?.theme_config ?? {}) as Record<string, unknown>;

    const { assets: logoConfig, notes: assetNotes } = await inlineBrandAssets(storedLogos, {
      supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
    });
    for (const note of assetNotes) {
      console.warn(`[render-cash-flow-pdf] asset ${note.key} not inlined (${note.reason}): ${note.detail}`);
    }

    // A clone never prints the house's name, contact details or wording,
    // whatever its settings rows say; the prime reads them as stored
    // (`issuerIdentity.pure.ts`).
    const reportDeployment = { prime: deploymentKind(Deno.env.get('SUPABASE_URL')) === 'prime' };
    const { snapshot, skippedAssets } = buildReportBrandSnapshot({
      deployment: reportDeployment,
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
        `[render-cash-flow-pdf] asset ${skipped.source} skipped (${skipped.reason}): ${skipped.detail}`,
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
    const projection = buildProjection({
      source: request.projection,
      propertyAddress: String(report.property_address ?? ''),
      clientName,
      now,
    });

    // Cover art comes from the tenant's own `cover` asset and nowhere else.
    const coverArt = inlineAsset(logoConfig.cover ?? null);

    // The design the caller chose, if any. The words, figures and pages are
    // the report's own whatever it names; a design that cannot be honoured is
    // answered with the standard one and a sentence saying why, never with a
    // failed document (`templateDesignRead.ts`).
    const { design, echo: designEcho } = await resolveRequestedDesign(supabase, {
      reference: request.design,
      reportType: 'cashflow',
      actor: { userId: auth.userId, authMethod: auth.authMethod },
      route: 'render-cash-flow-pdf',
    });

    const { html, gaps } = renderCashFlowFromBrand({
      projection,
      snapshot,
      disclaimer: issuerDisclaimerSetting(settings.disclaimer, snapshot, reportDeployment) as never,
      coverArtDataUri: coverArt.ok ? coverArt.asset.dataUri : null,
      edition: request.edition,
      reference: request.reportId.slice(0, 8).toUpperCase(),
      design,
    });

    // The guard runs on HTML this function built, deliberately: the assets in
    // it came from a tenant's settings form, and the boundary is where the
    // check belongs, not where the trust is.
    assertSafeRenderResources(html, Deno.env.get('SUPABASE_URL') || '');

    // ── Render, store, sign ─────────────────────────────────────────────────

    const fileName = cashFlowFileName(String(report.property_address ?? ''), now);
    const path = cashFlowStoragePath(request.reportId, fileName, now, crypto.randomUUID());

    const { data: renderRow } = await supabase
      .from('cash_flow_renders')
      .insert({
        report_id: request.reportId,
        requested_by: auth.userId,
        status: 'running',
        file_name: fileName,
        storage_bucket: PDF_BUCKET,
        storage_path: path,
        brand_snapshot_id: brandSnapshotId ?? null,
        brand_gaps: gaps,
        term_years: projection.meta.termYears,
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
        format: 'cash-flow-projection',
        renderId: renderId,
        sourceId: request.reportId,
        renderedAt: now,
      },
    });

    const { error: uploadError } = await supabase.storage.from(PDF_BUCKET).upload(path, pdf, {
      contentType: 'application/pdf',
      // Never overwrite: the path carries a random segment precisely so a
      // second render cannot replace a file someone already has a link to.
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
        .from('cash_flow_renders')
        .update({ status: 'succeeded', bytes: pdf.length, duration_ms: durationMs })
        .eq('id', renderId);
    }

    const response: CashFlowRenderResponse = {
      url: signed.signedUrl,
      path,
      fileName,
      bytes: pdf.length,
      pageCount,
      renderId,
      brandSnapshotId: (brandSnapshotId as string) ?? null,
      brandGaps: gaps,
      durationMs,
      design: designEcho,
    };
    return json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[render-cash-flow-pdf]', message);
    if (renderId) {
      await supabase
        .from('cash_flow_renders')
        .update({ status: 'failed', error: message.slice(0, 2000), duration_ms: Date.now() - started })
        .eq('id', renderId);
    }
    // A malformed projection is the caller's fault and says so with a 400; the
    // message names the field, because "invalid payload" costs an hour that
    // "years[3].rentalIncome must be a finite number" does not. A failure the
    // render SERVICE answered is passed on classified (503 when the engine
    // did not answer, 502 when it refused or failed) with its kind, so the
    // page can say what happened instead of printing the service's HTML.
    if (e instanceof WeasyPrintServiceError) {
      return json({
        error: message, code: e.kind, upstreamStatus: e.upstreamStatus, retriable: e.retriable, renderId,
      }, functionStatusFor(e.kind));
    }
    const status = e instanceof CashFlowPayloadError ? 400 : 500;
    return json({ error: message, renderId }, status);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
