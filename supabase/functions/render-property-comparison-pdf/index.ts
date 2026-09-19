/**
 * render-property-comparison-pdf
 *
 * The Property Comparison Analysis, typeset server-side through WeasyPrint.
 *
 * ## What changes about downloading a comparison
 *
 * The path this sits beside sends the stored row to `format-comparison-report`,
 * which calls a model to rewrite it as markdown before the browser draws it. So
 * downloading a comparison saved in March **costs tokens today** and returns
 * different prose on each attempt, and nobody can say which document a client
 * was sent.
 *
 * This route reads the row and typesets it. It asks nothing of any model, so it
 * is **not metered**, it is free to re-run, and the same row twice gives the same
 * document. That is the largest behavioural change in the migration.
 *
 * ## Six properties, the same six the other three routes hold
 *
 *  1. **Auth is a human, then an authorisation — and here the module permission
 *     is the gate rather than a fallback.** There is no `client_id` on this
 *     table; its RLS is `created_by = auth.uid()`, `created_by` is NULL on 38 of
 *     50 rows, and of the 12 that have one, none points into `auth.users`. So the
 *     stored policy matches nothing for a real caller and ownership alone would
 *     refuse three quarters of the record. `reports / can_view` is the gate —
 *     the same key `render-investment-report-pdf` applies to the reports a
 *     comparison is derived from, so a comparison cannot become a way to read
 *     what you could not read directly.
 *  2. **The client's name is read, not accepted**, through `CLIENT_NAME_COLUMNS`,
 *     and only when exactly one client resolves behind the compared reports.
 *  3. **A failed read is not a missing row.** Every query checks `error` before
 *     `data` and throws with the message the database gave. A select naming a
 *     column that does not exist returns neither, and reporting that as "not
 *     found" cost a full debugging cycle on the Snapshot.
 *  4. **The brand is snapshotted, then referenced** — `upsert_report_brand_snapshot`.
 *  5. **Resources are checked before the POST** — `assertSafeRenderResources`.
 *  6. **No fallback, and every attempt leaves a row** in
 *     `property_comparison_renders`, including which sections the record was
 *     missing and which score scale it used.
 *
 * ## It never writes to `property_comparisons`
 *
 * That table has no `pdf_file_path` and none is added. Salvaged content is a
 * read-time view: writing recovered JSON back into the seven columns would create
 * a second answer to "what did the model say" and make `structure_version = 1`
 * mean three things instead of two.
 *
 * ## The legacy stays, and its engine is not opened
 *
 * `ComparisonPDFGenerator` renders through `PixelPerfectPDFGenerator`, 3,626
 * lines of pdf-lib **shared with the investment report format**. Neither file is
 * touched by this work, and `format-comparison-report` — metering included — is
 * left exactly as it is. This is a second path beside them.
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
  buildPropertyComparison,
  ComparisonPayloadError,
} from '../_shared/reports/propertyComparison/normalise.pure.ts';
import { renderComparisonFromBrand } from '../_shared/reports/propertyComparison/render.pure.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  comparisonFileName,
  comparisonStoragePath,
  parseRenderRequest,
  SIGNED_URL_TTL_SECONDS,
  type ComparisonRenderResponse,
} from '../_shared/reports/propertyComparison/route.pure.ts';

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
    console.warn(`[render-property-comparison-pdf] global_report_settings unreadable: ${queryError}`);
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

    // Report Comparisons is a Growth/Scale capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabase, auth, 'report-comparisons');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    const parsed = parseRenderRequest(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const request = parsed.request;

    // Authorisation. A module gate leaks no row existence, so this is a 403 —
    // unlike the 404 a missing row gets below.
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

    // ── The comparison ──────────────────────────────────────────────────────

    const comparisonRes = await supabase
      .from('property_comparisons')
      .select('*')
      .eq('id', request.comparisonId)
      .maybeSingle();

    // `error` before `data`, always. A malformed select returns neither, and
    // calling that "not found" sends whoever debugs it looking for a missing row
    // that is sitting right there.
    if (comparisonRes.error) {
      throw new Error(`could not read the comparison: ${comparisonRes.error.message}`);
    }
    if (!comparisonRes.data) return json({ error: 'not found' }, 404);
    const row = comparisonRes.data as Record<string, unknown>;

    // ── Which reports it compared, and whose they are ───────────────────────
    //
    // A resolvability check rather than an access check. A comparison naming no
    // surviving report is not reproducible and the document would be about
    // nothing; some of them dangling is ordinary and is said out loud instead.
    const reportIds = (Array.isArray(row.report_ids) ? row.report_ids : [])
      .map((r) => String(r))
      .filter(Boolean);

    const notes: string[] = [];
    let clientName = '';

    if (reportIds.length) {
      const reportsRes = await supabase
        .from('investment_reports')
        .select('id, client_property_id')
        .in('id', reportIds);
      if (reportsRes.error) {
        throw new Error(`could not read the compared reports: ${reportsRes.error.message}`);
      }
      const found = (reportsRes.data ?? []) as Array<Record<string, unknown>>;
      if (!found.length) {
        return json({
          error: 'none of the reports this comparison was built from still exist, '
            + 'so it cannot be reproduced',
        }, 400);
      }
      const missing = reportIds.length - found.length;
      if (missing > 0) {
        notes.push(
          `${missing} of the ${reportIds.length} reports this comparison was built from `
          + 'is no longer in the record. The comparison is reproduced as it was saved.',
        );
      }

      // The client, only when there is exactly one. A comparison spanning two
      // clients' properties is a real thing, and naming one of them would be wrong.
      const propertyIds = found
        .map((r) => r.client_property_id)
        .filter((v): v is string => typeof v === 'string' && Boolean(v));
      if (propertyIds.length) {
        const propsRes = await supabase
          .from('client_properties')
          .select('client_id')
          .in('id', propertyIds);
        if (propsRes.error) {
          console.warn(
            `[render-property-comparison-pdf] could not resolve the client: ${propsRes.error.message}`,
          );
        }
        const clientIds = [...new Set(
          ((propsRes.data ?? []) as Array<Record<string, unknown>>)
            .map((p) => p.client_id)
            .filter((v): v is string => typeof v === 'string' && Boolean(v)),
        )];
        if (clientIds.length === 1) {
          const { data: client, error } = await supabase
            .from('clients')
            .select(CLIENT_NAME_COLUMNS)
            .eq('id', clientIds[0])
            .maybeSingle();
          // Reported rather than swallowed. This is the select that was silently
          // broken on the Snapshot route.
          if (error) {
            console.warn(`[render-property-comparison-pdf] could not read the client: ${error.message}`);
          }
          clientName = clientDisplayName(client as never);
        }
      }
    }

    // ── The brand, frozen ───────────────────────────────────────────────────

    const [whitelabelRes, settingsRes] = await Promise.all([
      supabase.from('whitelabel_settings').select('*').limit(1).maybeSingle(),
      supabase
        .from('global_report_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['contact_details', 'professional_disclaimer']),
    ]);

    const whitelabel = (whitelabelRes.data ?? null) as Record<string, unknown> | null;
    const settings = readReportSettings(settingsRes.data, settingsRes.error?.message ?? null);
    const storedLogos = (whitelabel?.logo_config ?? {}) as Record<string, string | null>;
    const themeConfig = (whitelabel?.theme_config ?? {}) as Record<string, unknown>;

    const { assets: logoConfig, notes: assetNotes } = await inlineBrandAssets(storedLogos, {
      supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
    });
    for (const note of assetNotes) {
      console.warn(
        `[render-property-comparison-pdf] asset ${note.key} not inlined (${note.reason}): ${note.detail}`,
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
        `[render-property-comparison-pdf] asset ${skipped.source} skipped (${skipped.reason}): ${skipped.detail}`,
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
    const comparison = buildPropertyComparison({ row, clientName, notes, now });

    // Cover art comes from the tenant's own `cover` asset and nowhere else.
    const coverArt = inlineAsset(logoConfig.cover ?? null);

    const { html, gaps } = renderComparisonFromBrand({
      comparison,
      snapshot,
      disclaimer: settings.disclaimer as never,
      coverArtDataUri: coverArt.ok ? coverArt.asset.dataUri : null,
      edition: request.edition,
    });

    assertSafeRenderResources(html, Deno.env.get('SUPABASE_URL') || '');

    // ── Render, store, sign ─────────────────────────────────────────────────

    const fileName = comparisonFileName(comparison.properties.length, now, comparison.meta.reference);
    const path = comparisonStoragePath(request.comparisonId, fileName, now, crypto.randomUUID());

    const { data: renderRow } = await supabase
      .from('property_comparison_renders')
      .insert({
        comparison_id: request.comparisonId,
        requested_by: auth.userId,
        status: 'running',
        file_name: fileName,
        storage_bucket: PDF_BUCKET,
        storage_path: path,
        brand_snapshot_id: brandSnapshotId ?? null,
        brand_gaps: gaps,
        property_count: comparison.properties.length,
        source_shape: comparison.provenance.shape,
        recovered_sections: comparison.provenance.recovered,
        missing_sections: comparison.provenance.missing,
        score_scale: comparison.scale?.outOf ?? null,
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
        format: 'property-comparison',
        renderId: renderId,
        sourceId: request.comparisonId,
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
        .from('property_comparison_renders')
        .update({ status: 'succeeded', bytes: pdf.length, pages: pageCount, duration_ms: durationMs })
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
      recordComplete: comparison.provenance.shape === 'columns'
        || comparison.provenance.missing.length === 0,
      missingSections: [...comparison.provenance.missing],
      scoreScale: comparison.scale?.outOf ?? null,
      durationMs,
    };
    return json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[render-property-comparison-pdf]', message);
    if (renderId) {
      await supabase
        .from('property_comparison_renders')
        .update({ status: 'failed', error: message.slice(0, 2000), duration_ms: Date.now() - started })
        .eq('id', renderId);
    }
    // A row whose sections could not be read at all is the record's fault, not
    // the server's, and says so with a 400 naming the reason.
    const status = e instanceof ComparisonPayloadError ? 400 : 500;
    return json({ error: message, renderId }, status);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
