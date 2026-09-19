/**
 * render-market-intelligence-pdf
 *
 * A Market Intelligence report, rendered server-side through WeasyPrint.
 *
 * ## What this route owns
 *
 * The reading. Every word this document prints is already one jsonb column on
 * one row of `marketing_intelligence_reports` — eight layers of model prose, an
 * executive summary, a sixty-second briefing, an actionable strategy, a CTA, a
 * dated events array and a citation list — so the browser sends a report id and
 * this function reads the rest.
 *
 * That is a change from the legacy, which casts `report.report_data` straight to
 * its own interface with no validation and typesets whatever arrives
 * (`MarketIntelligenceHistoryModal.tsx:70`).
 *
 * ## It finally writes `pdf_storage_path`
 *
 * `dispatch-marketing-reports:323` pulls a PDF from that column to attach it to
 * a scheduled marketing email. **Nothing has ever written it.** Measured against
 * production: six reports, zero paths, and the `marketing-reports` bucket — which
 * the DDL created alongside the table in April — holds zero objects. So the
 * first time that dispatch runs it attaches nothing, silently.
 *
 * `persist` therefore defaults to on, and the storage path is stable per report
 * rather than carrying a random segment: `pdf_storage_path` is one column
 * holding one location, and the dispatch reads whatever is there. A re-render
 * replaces the file, which is what "the current PDF for this report" means.
 *
 * ## One gate, and it is `marketing_analytics`
 *
 * These reports are not client-scoped — there is no `client_id` on the table and
 * no per-row sharing to resolve, which is why this route has no equivalent of
 * the Q&A resolver. Whoever may read the Marketing Analytics module may read its
 * reports. `requireModulePermission` already lets a superadmin through, so there
 * is nothing to add for that either.
 *
 * ## What it replaces
 *
 * `MarketIntelligencePDFGenerator.ts`, a browser-side jsPDF class driven from
 * two call sites. Between them: a table of contents built from `includedLayers`
 * that lists sections the document does not print — six of the record's 46 layer
 * bodies are empty strings, so the numbering silently drifts — a correlation
 * block that has never been persisted and so vanishes on any re-download, and no
 * ceiling at all on a layer that reached 244,332 characters.
 *
 * ## The legacy path stays
 *
 * `MarketIntelligencePDFGenerator.ts` and both buttons that drive it remain
 * reachable and are not deprecated. `legacyPathStays.spec.ts` asserts it.
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
import { buildMarketIntelligenceReport } from '../_shared/reports/marketIntelligence/normalise.pure.ts';
import { renderMarketIntelligenceFromBrand } from '../_shared/reports/marketIntelligence/render.pure.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  marketIntelligenceFileName,
  marketIntelligenceReference,
  marketIntelligenceStoragePath,
  type MarketIntelligenceRenderResponse,
  parseRenderRequest,
  SIGNED_URL_TTL_SECONDS,
  STORAGE_BUCKET,
} from '../_shared/reports/marketIntelligence/route.pure.ts';

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
    console.warn(`[render-market-intelligence-pdf] global_report_settings unreadable: ${queryError}`);
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
    if (auth.error || !auth.userId) {
      return json({ error: auth.error || 'Authentication required' }, 401);
    }

    // An anonymous internal credential may not render on its own authority —
    // a bare auth.userId === 'service_role' is refused exactly as before. The
    // one internal caller with business here is the scheduled dispatch, and
    // it acts FOR a person: it names the schedule's creator, and the
    // marketing permission below is checked against that user, exactly as if
    // they had pressed the button themselves. The delegated authMethod is
    // deliberately not 'service_role', so requireModulePermission cannot
    // short-circuit past the real check.
    let actorId = auth.userId;
    let actorAuthMethod: string | null | undefined = auth.authMethod;
    if (auth.userId === 'service_role') {
      const onBehalfOf = typeof (body as Record<string, unknown>)?.onBehalfOfUserId === 'string'
        ? String((body as Record<string, unknown>).onBehalfOfUserId).trim()
        : '';
      if (!onBehalfOf) {
        return json({ error: auth.error || 'Authentication required' }, 401);
      }
      actorId = onBehalfOf;
      actorAuthMethod = 'delegated_internal';
    }

    const parsed = parseRenderRequest(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const request = parsed.request;

    const permission = await requireModulePermission(
      supabase,
      { userId: actorId, authMethod: actorAuthMethod },
      'marketing_analytics',
      'can_view',
    );
    if (!permission.ok) {
      return json({ error: permission.error || 'Marketing Analytics view permission required' }, 403);
    }

    const weasyprint = weasyPrintConfig((key) => Deno.env.get(key));
    if (!weasyprint) {
      // Checked before the reads: a misconfigured environment should say so, not
      // after three queries and a document build.
      return json({
        error: 'WeasyPrint is not configured (WEASYPRINT_SERVICE_URL + WEASYPRINT_SERVICE_TOKEN)',
      }, 503);
    }

    // ── The record ──────────────────────────────────────────────────────────

    const id = request.reportId;
    const [reportRes, whitelabelRes, settingsRes] = await Promise.all([
      supabase
        .from('marketing_intelligence_reports')
        .select(
          'id, status, report_period, report_type, audience_segment, '
          + 'include_advisory_strategy, generated_at, report_data, pdf_storage_path',
        )
        .eq('id', id)
        .maybeSingle(),
      supabase.from('whitelabel_settings').select('*').limit(1).maybeSingle(),
      supabase
        .from('global_report_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['contact_details', 'professional_disclaimer']),
    ]);

    // The error is checked before the data. A failed query that returns nothing
    // is not a report with no payload, and treating it as one would answer "this
    // report has no stored payload" to what is actually a database problem.
    if (reportRes.error) {
      throw new Error(`could not read marketing_intelligence_reports: ${reportRes.error.message}`);
    }
    if (!reportRes.data) return json({ error: 'not found' }, 404);

    const row = reportRes.data as Record<string, unknown>;

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
        `[render-market-intelligence-pdf] asset ${note.key} not inlined (${note.reason}): ${note.detail}`,
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
        `[render-market-intelligence-pdf] asset ${skipped.source} skipped (${skipped.reason}): ${skipped.detail}`,
      );
    }

    // ── Build the document ──────────────────────────────────────────────────

    const now = new Date().toISOString();
    const built = buildMarketIntelligenceReport({
      row,
      preparedOn: now,
      // The masthead the brand snapshot resolved, so the editorial strip that
      // removes the model's own duplicate tagline knows whose name to look for.
      brandName: snapshot.company.name,
      // The one payload field the caller may set, already constrained to the
      // three the format knows by `parseRenderRequest`. It selects between
      // blocks of copy this repo owns; it supplies none.
      audienceOverride: request.audience,
    });
    // A refusal here is about what the record holds, not about this function —
    // "this report is generating, not completed" is something the caller can act
    // on, and is a 400 rather than a 500 for that reason.
    if (!built.ok) return json({ error: built.error }, 400);
    const report = built.report;

    const { data: brandSnapshotId } = await supabase.rpc('upsert_report_brand_snapshot', {
      _fingerprint: snapshot.fingerprint,
      _snapshot_version: REPORT_SNAPSHOT_VERSION,
      _payload: snapshot,
      _company_name: snapshot.company.name,
      _brand_hex: snapshot.brandHex,
      _source_whitelabel_setting_id: snapshot.source.whitelabelSettingId,
    });

    // The tenant's own cover asset. The legacy has none at all — it fills page
    // one with a hardcoded navy and sets the brand name as text — so this gives
    // the format a tenant cover for the first time rather than replacing ours.
    const coverArt = inlineAsset(logoConfig.cover ?? null);

    const rendered = renderMarketIntelligenceFromBrand({
      report,
      snapshot,
      disclaimer: settings.disclaimer as never,
      coverArtDataUri: coverArt.ok ? coverArt.asset.dataUri : null,
      edition: request.edition,
      reference: marketIntelligenceReference(id),
    });

    // A spine that violates its own archetype is a defect, not a preference. The
    // section list here is decided by which layers came back with content, so
    // this can genuinely happen at runtime.
    if (rendered.problems.length) {
      throw new Error(`document structure is invalid: ${rendered.problems.join('; ')}`);
    }

    // The guard runs on HTML this function built, deliberately: the prose in it
    // is model output and the assets came from a tenant's settings form, so the
    // boundary is where the check belongs.
    assertSafeRenderResources(rendered.html, Deno.env.get('SUPABASE_URL') || '');

    // ── Render, store, sign ─────────────────────────────────────────────────

    const fileName = marketIntelligenceFileName(
      report.meta.reportPeriod,
      report.meta.audienceSegment,
    );
    const path = marketIntelligenceStoragePath(id, fileName);

    const { data: renderRow } = await supabase
      .from('market_intelligence_renders')
      .insert({
        report_id: id,
        requested_by: auth.userId,
        status: 'running',
        report_type: report.meta.reportType,
        audience_segment: report.meta.audienceSegment,
        file_name: fileName,
        storage_bucket: STORAGE_BUCKET,
        storage_path: path,
        brand_snapshot_id: brandSnapshotId ?? null,
        brand_gaps: rendered.gaps,
        sections_included: rendered.sections,
        layers_shown: report.meta.layersShown,
        layers_empty: report.meta.layersEmpty,
        sections_dropped: rendered.dropped.length,
        chars_omitted: rendered.charsOmitted,
        persisted: request.persist,
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
        format: 'market-intelligence',
        renderId: renderId,
        sourceId: request.reportId,
        renderedAt: now,
      },
    });

    // `upsert: true`, unlike every other format in the programme, and the stable
    // path above is why. `pdf_storage_path` names the current PDF for this
    // report; a second render produces the current one.
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

    // ── The column the email dispatch reads ─────────────────────────────────
    //
    // Written after the upload succeeded, so the column can never point at a
    // file that is not there. Not fatal on failure: the caller has a working
    // signed URL either way, and throwing away a rendered document because one
    // column could not be updated helps nobody.

    let persisted = false;
    if (request.persist) {
      const { error: pathError } = await supabase
        .from('marketing_intelligence_reports')
        .update({ pdf_storage_path: path })
        .eq('id', id);
      if (pathError) {
        console.warn(
          `[render-market-intelligence-pdf] could not set pdf_storage_path: ${pathError.message}`,
        );
      } else {
        persisted = true;
      }
    }

    const durationMs = Date.now() - started;
    const pageCount = await countPdfPagesAsync(pdf);

    if (renderId) {
      await supabase
        .from('market_intelligence_renders')
        .update({
          status: 'succeeded',
          bytes: pdf.length,
          page_count: pageCount,
          duration_ms: durationMs,
          persisted,
        })
        .eq('id', renderId);
    }

    const response: MarketIntelligenceRenderResponse = {
      url: signed.signedUrl,
      fileName,
      bytes: pdf.length,
      pageCount,
      renderId,
      brandSnapshotId: (brandSnapshotId as string) ?? null,
      brandGaps: rendered.gaps,
      sections: rendered.sections,
      dropped: rendered.dropped,
      emptyLayers: rendered.emptyLayers,
      reportPeriod: report.meta.reportPeriod,
      audienceSegment: report.meta.audienceSegment,
      persisted,
      storagePath: persisted ? path : null,
      durationMs,
    };
    return json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[render-market-intelligence-pdf]', message);
    if (renderId) {
      // Every attempt leaves a row, succeeded or failed. A render path with no
      // record of its failures is one nobody can debug from production.
      await supabase
        .from('market_intelligence_renders')
        .update({
          status: 'failed',
          error: message.slice(0, 2000),
          duration_ms: Date.now() - started,
        })
        .eq('id', renderId);
    }
    // No fallback. The legacy generator produces a different document, and
    // silently substituting it would send somebody something nobody chose.
    return json({ error: message }, 500);
  }
});

Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
