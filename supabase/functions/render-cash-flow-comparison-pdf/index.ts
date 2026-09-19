/**
 * render-cash-flow-comparison-pdf
 *
 * The Cash Flow Comparison Analysis, rendered server-side through WeasyPrint.
 *
 * ## Where the numbers come from, and why not from here
 *
 * The same boundary `render-cash-flow-pdf` holds, for a reason that gets
 * *stronger* with a comparison rather than weaker.
 *
 * For the report the adviser has open, the argument is the one
 * `docs/reports/CASH_FLOW.md` §1 makes: `CashFlowAnalysisModal` lets them
 * override ten fields in any of ten years and does not persist those overrides
 * until they save, so a server that recomputed would render a different ten
 * years from the one they just reviewed.
 *
 * For the peers that argument does not hold on its own — their projections are
 * built from `manual_overrides` and `financial_calculations`, both persisted. The
 * reason they still come from the browser is that a comparison is only worth
 * anything if **every property in it was computed by one implementation**. The
 * modal's chained cascade is around a hundred lines of year-on-year compounding
 * (`CashFlowAnalysisModal.tsx:560-660`); a second copy on the server would agree
 * with it until the day it did not, and the first symptom would be a client
 * document ranking two properties in an order the screen did not.
 *
 * So the browser owns the arithmetic and the server owns the **document**: the
 * brand, the company block, the disclaimer, the typography, the page geometry,
 * storage, signing, and a row per attempt. It also owns the *identities* — every
 * address printed here is read from `investment_reports`, never from the caller.
 *
 * ## The legacy generators stay
 *
 * `exportComparisonPDF` and `exportAiAnalysisPDF` are untouched in the modal and
 * the UI offers this beside them rather than instead of them.
 *
 * ## Not metered
 *
 * Typesetting figures the browser already computed asks nothing of any model.
 * The analysis, when there is one, was paid for once when the adviser generated
 * it and is not regenerated here — so re-downloading is free and produces the
 * same document twice.
 *
 * ## No fallback
 *
 * If WeasyPrint fails, this fails. A silent downgrade ships a client a document
 * nobody approved.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuthOrNativeUser } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
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
  buildComparison,
  CashFlowComparisonPayloadError,
} from '../_shared/reports/cashFlowComparison/normalise.pure.ts';
import { renderComparisonFromBrand } from '../_shared/reports/cashFlowComparison/render.pure.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  comparisonFileName,
  comparisonReference,
  comparisonStoragePath,
  parseRenderRequest,
  SIGNED_URL_TTL_SECONDS,
  type ComparisonRenderResponse,
} from '../_shared/reports/cashFlowComparison/route.pure.ts';

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
 * `global_report_settings` is `(setting_key, setting_value jsonb)`. Reading it as
 * though it had `contact_details` and `disclaimer` columns is the mistake that
 * shipped every Borrowing Capacity Snapshot without an ABN.
 */
function readReportSettings(
  rows: unknown,
  queryError: string | null,
): { contact: Record<string, unknown> | null; disclaimer: Record<string, unknown> | null } {
  if (queryError) {
    console.warn(`[render-cash-flow-comparison-pdf] global_report_settings unreadable: ${queryError}`);
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

    // Cash Flow Comparisons is a Growth/Scale capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabase, auth, 'cashflow-comparisons');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    const parsed = parseRenderRequest(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const request = parsed.request;

    // The same gate `render-cash-flow-pdf` and `render-investment-report-pdf`
    // apply to the same underlying reports, so a comparison cannot become a way
    // to read a report you could not read directly. `compare-cash-flow-reports`,
    // which reads the same financials to write its analysis, checks only that
    // the caller is authenticated — that gap is recorded in the contract
    // document and is not this route's to close.
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
      // Checked before the reads: a misconfigured environment should say so, not
      // after four queries and a document build.
      return json({
        error: 'WeasyPrint is not configured (WEASYPRINT_SERVICE_URL + WEASYPRINT_SERVICE_TOKEN)',
      }, 503);
    }

    // ── Read what the caller may not state ──────────────────────────────────

    const reportIds = request.properties.map((x) => x.reportId);

    const [reportsRes, whitelabelRes, settingsRes] = await Promise.all([
      supabase
        .from('investment_reports')
        .select('id, property_address, client_property_id')
        .in('id', reportIds),
      supabase.from('whitelabel_settings').select('*').limit(1).maybeSingle(),
      supabase
        .from('global_report_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['contact_details', 'professional_disclaimer']),
    ]);

    // The error is checked before the data, on every read. A failed query that
    // returns no rows is not a missing row, and treating it as one is the defect
    // that cost a full debugging cycle on the Snapshot.
    if (reportsRes.error) throw new Error(`could not read the reports: ${reportsRes.error.message}`);

    const rows = (reportsRes.data ?? []) as Record<string, unknown>[];
    const byId = new Map(rows.map((r) => [String(r.id), r]));

    // Every property or none. Dropping an unresolvable one would produce a
    // four-property document from a five-property request, with nothing on the
    // page saying so — and a column of someone's financial projection cannot be
    // labelled from a caller-supplied string.
    const missing = reportIds.filter((id) => !byId.has(id));
    if (missing.length) {
      return json({
        error: `these reports could not be found: ${missing.join(', ')}`,
      }, 404);
    }

    // ── The client, when there is exactly one ───────────────────────────────
    //
    // A comparison spanning two clients' properties is a real thing an adviser
    // does, and naming one of them on the cover would be wrong. So: one distinct
    // client resolves to a "Prepared for" line, zero or several to nothing.
    const propertyIds = [...new Set(
      rows.map((r) => r.client_property_id).filter(Boolean).map(String),
    )];
    let clientName = '';
    if (propertyIds.length) {
      const { data: properties, error: propertyError } = await supabase
        .from('client_properties')
        .select('id, client_id')
        .in('id', propertyIds);
      if (propertyError) {
        console.warn(
          `[render-cash-flow-comparison-pdf] could not read client properties: ${propertyError.message}`,
        );
      }
      const propertyRows = (properties ?? []) as Record<string, unknown>[];
      const clientIds = [...new Set(
        propertyRows.map((x) => x.client_id).filter(Boolean).map(String),
      )];
      if (clientIds.length === 1) {
        const { data: client, error } = await supabase
          .from('clients')
          .select(CLIENT_NAME_COLUMNS)
          .eq('id', clientIds[0])
          .maybeSingle();
        // Reported rather than swallowed: a name missing from a cover looks
        // exactly like a comparison with no client attached.
        if (error) {
          console.warn(`[render-cash-flow-comparison-pdf] could not read the client: ${error.message}`);
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
    for (const assetNote of assetNotes) {
      console.warn(
        `[render-cash-flow-comparison-pdf] asset ${assetNote.key} not inlined (${assetNote.reason}): ${assetNote.detail}`,
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
        `[render-cash-flow-comparison-pdf] asset ${skipped.source} skipped (${skipped.reason}): ${skipped.detail}`,
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
    const comparison = buildComparison({
      properties: request.properties.map((entry) => ({
        reportId: entry.reportId,
        address: String(byId.get(entry.reportId)?.property_address ?? ''),
        isPrimary: entry.reportId === request.primaryReportId,
        projection: entry.projection,
      })),
      primaryReportId: request.primaryReportId,
      clientName,
      investorProfile: request.investorProfile,
      analysis: request.analysis,
      now,
    });

    // Cover art comes from the tenant's own `cover` asset and nowhere else.
    const coverArt = inlineAsset(logoConfig.cover ?? null);
    const reference = comparisonReference(request.primaryReportId);

    const { html, gaps } = renderComparisonFromBrand({
      comparison,
      snapshot,
      disclaimer: settings.disclaimer as never,
      coverArtDataUri: coverArt.ok ? coverArt.asset.dataUri : null,
      edition: request.edition,
      reference,
    });

    // The guard runs on HTML this function built, deliberately: half of it came
    // from a model, by way of a browser. `normalise.pure.ts` neutralises URL
    // schemes in that half precisely so a citation in model prose does not fail
    // the whole render here.
    assertSafeRenderResources(html, Deno.env.get('SUPABASE_URL') || '');

    // ── Render, store, sign ─────────────────────────────────────────────────

    const fileName = comparisonFileName(comparison.properties.length, now, reference);
    const path = comparisonStoragePath(request.primaryReportId, fileName, now, crypto.randomUUID());
    const missingSections = comparison.analysis ? [...comparison.analysis.missing] : [];

    const { data: renderRow } = await supabase
      .from('cash_flow_comparison_renders')
      .insert({
        primary_report_id: request.primaryReportId,
        compared_report_ids: reportIds,
        property_count: comparison.properties.length,
        investor_profile: comparison.meta.investorProfile,
        has_ai_analysis: Boolean(comparison.analysis),
        ai_sections_missing: missingSections,
        term_years: comparison.meta.termYears,
        requested_by: auth.userId,
        status: 'running',
        file_name: fileName,
        storage_bucket: PDF_BUCKET,
        storage_path: path,
        brand_snapshot_id: brandSnapshotId ?? null,
        brand_gaps: gaps,
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
        format: 'cash-flow-comparison',
        renderId: renderId,
        sourceId: request.primaryReportId,
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
        .from('cash_flow_comparison_renders')
        .update({ status: 'succeeded', bytes: pdf.length, duration_ms: durationMs })
        .eq('id', renderId);
    }

    const response: ComparisonRenderResponse = {
      url: signed.signedUrl,
      fileName,
      bytes: pdf.length,
      pageCount,
      renderId,
      brandSnapshotId: (brandSnapshotId as string) ?? null,
      brandGaps: gaps,
      propertyCount: comparison.properties.length,
      hasAnalysis: Boolean(comparison.analysis),
      missingSections,
      durationMs,
    };
    return json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[render-cash-flow-comparison-pdf]', message);
    if (renderId) {
      await supabase
        .from('cash_flow_comparison_renders')
        .update({ status: 'failed', error: message.slice(0, 2000), duration_ms: Date.now() - started })
        .eq('id', renderId);
    }
    // A malformed payload is the caller's fault and says so with a 400; the
    // message names the property and the field, because "invalid payload" costs
    // an hour that "properties[2] (12 Elm St): years[3].rentalIncome must be a
    // finite number" does not.
    const status = e instanceof CashFlowComparisonPayloadError ? 400 : 500;
    return json({ error: message, renderId }, status);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
