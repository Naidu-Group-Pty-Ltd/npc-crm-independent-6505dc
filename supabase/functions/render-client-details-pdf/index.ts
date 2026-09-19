/**
 * render-client-details-pdf
 *
 * The client's own record, rendered server-side through WeasyPrint.
 *
 * ## What this route owns, and why it owns more than the others
 *
 * All of it. Unlike the cash flow formats, nothing about this document is
 * computed live in a modal against unsaved overrides — every figure is a
 * persisted row in one of nine tables. So the browser sends a client id and
 * nothing else, and this function reads the record itself.
 *
 * That is not only tidier, it closes a class of defect: a document produced from
 * what a component happened to have fetched is a document whose contents depend
 * on which screen it was produced from. This one does not, and it can be
 * produced without anyone opening the client at all.
 *
 * ## The gate is `client_management`, not `reports`
 *
 * Every table below is mapped to `client_management` in `TABLE_TO_MODULE_MAP`.
 * Gating on `reports` — which is what the other five render routes use, because
 * their subjects are reports — would let someone read a client's record through
 * a report route when they cannot read it directly. Then `canAccessClient` for
 * the row itself, because the module permission says *whether* someone may read
 * client records and not *which*.
 *
 * ## What it replaces
 *
 * `FormaraPDFGenerator` builds careful HTML and then rasterises every page of it
 * with html2canvas into jsPDF. The broker on the other end of "Send to Finance"
 * receives pictures of a fact-find and cannot lift a figure out of it. Three
 * more defects fall out of that same step — a resolution chosen from
 * `navigator.deviceMemory`, a two-minute cap, and our own letterhead hardcoded
 * as the cover of a white-label tenant's document — and all four are fixed here
 * by not taking the step.
 *
 * ## The legacy generator stays
 *
 * This is a second path. Both of its buttons still work and both email paths
 * still reach it.
 *
 * ## No fallback, and not metered
 *
 * If WeasyPrint fails, this fails — a silent downgrade ships a document nobody
 * approved. And no model is involved anywhere in this format, which makes it the
 * first in the programme with nothing to meter.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuthOrNativeUser } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { canAccessClient } from '../_shared/clientAccess.ts';
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
  buildClientDetails,
  ClientDetailsPayloadError,
} from '../_shared/reports/clientDetails/normalise.pure.ts';
import { renderClientDetailsFromBrand } from '../_shared/reports/clientDetails/render.pure.ts';
import { clientDetailsSections } from '../_shared/reports/clientDetails/sections.pure.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  clientDetailsFileName,
  clientDetailsReference,
  clientDetailsStoragePath,
  parseRenderRequest,
  SIGNED_URL_TTL_SECONDS,
  type ClientDetailsRenderResponse,
} from '../_shared/reports/clientDetails/route.pure.ts';

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
    console.warn(`[render-client-details-pdf] global_report_settings unreadable: ${queryError}`);
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

    // Two gates, and they answer different questions. The module permission says
    // whether this person may read client records at all; `canAccessClient` says
    // whether they may read *this* one.
    const permission = await requireModulePermission(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      'client_management',
      'can_view',
    );
    if (!permission.ok) {
      return json({ error: permission.error || 'Client view permission required' }, 403);
    }

    const allowed = await canAccessClient(
      supabase,
      { userId: auth.userId, authMethod: auth.authMethod },
      request.clientId,
    );
    // 403, not 404: the caller has already proved they may read client records,
    // so telling them this one exists but is not theirs leaks nothing they could
    // not learn from a list.
    if (!allowed) return json({ error: 'You do not have access to this client' }, 403);

    const weasyprint = weasyPrintConfig((key) => Deno.env.get(key));
    if (!weasyprint) {
      // Checked before the reads: a misconfigured environment should say so, not
      // after eleven queries and a document build.
      return json({
        error: 'WeasyPrint is not configured (WEASYPRINT_SERVICE_URL + WEASYPRINT_SERVICE_TOKEN)',
      }, 503);
    }

    // ── The record ──────────────────────────────────────────────────────────
    //
    // Nine tables, in one round trip. The same set `get-client-data` reads, and
    // `select('*')` for the same reason it does: this document prints most of
    // what these tables hold, and naming columns here would mean a second list
    // to keep in step with `normalise.pure.ts`.

    const id = request.clientId;
    const [
      clientRes, propertiesRes, employmentRes, incomeRes, incomeSourcesRes,
      assetsRes, liabilitiesRes, expensesRes, historyRes,
      whitelabelRes, settingsRes,
    ] = await Promise.all([
      supabase.from('clients').select('*').eq('id', id).maybeSingle(),
      supabase.from('client_properties').select('*').eq('client_id', id),
      supabase.from('client_employment').select('*').eq('client_id', id),
      supabase.from('client_income').select('*').eq('client_id', id),
      supabase.from('client_income_sources').select('*').eq('client_id', id).eq('is_active', true),
      supabase.from('client_assets').select('*').eq('client_id', id),
      supabase.from('client_liabilities').select('*').eq('client_id', id),
      supabase.from('client_expenses').select('*').eq('client_id', id),
      supabase.from('client_address_history').select('*').eq('client_id', id),
      supabase.from('whitelabel_settings').select('*').limit(1).maybeSingle(),
      supabase
        .from('global_report_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['contact_details', 'professional_disclaimer']),
    ]);

    // The error is checked before the data on every read. A failed query that
    // returns nothing is not an empty table, and treating it as one would print
    // a client's document with their liabilities silently missing — which for
    // this format is indistinguishable from a client who has none.
    for (const [label, res] of [
      ['clients', clientRes], ['client_properties', propertiesRes],
      ['client_employment', employmentRes], ['client_income', incomeRes],
      ['client_income_sources', incomeSourcesRes], ['client_assets', assetsRes],
      ['client_liabilities', liabilitiesRes], ['client_expenses', expensesRes],
      ['client_address_history', historyRes],
    ] as const) {
      if (res.error) throw new Error(`could not read ${label}: ${res.error.message}`);
    }

    if (!clientRes.data) return json({ error: 'not found' }, 404);

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
        `[render-client-details-pdf] asset ${note.key} not inlined (${note.reason}): ${note.detail}`,
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
        `[render-client-details-pdf] asset ${skipped.source} skipped (${skipped.reason}): ${skipped.detail}`,
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
    const details = buildClientDetails({
      client: clientRes.data,
      properties: propertiesRes.data,
      employment: employmentRes.data,
      income: incomeRes.data,
      incomeSources: incomeSourcesRes.data,
      assets: assetsRes.data,
      liabilities: liabilitiesRes.data,
      expenses: expensesRes.data,
      addressHistory: historyRes.data,
      now,
    });

    // The tenant's own cover asset and nowhere else. The legacy hardcodes
    // `/templates/npc-formara-cover.jpg` and puts our letterhead on every
    // white-label tenant's client record; this line is what closes that.
    const coverArt = inlineAsset(logoConfig.cover ?? null);
    const reference = clientDetailsReference(request.clientId);

    const { html, gaps } = renderClientDetailsFromBrand({
      details,
      snapshot,
      disclaimer: settings.disclaimer as never,
      coverArtDataUri: coverArt.ok ? coverArt.asset.dataUri : null,
      edition: request.edition,
      reference,
    });

    // The guard runs on HTML this function built, deliberately: the assets in it
    // came from a tenant's settings form, and the boundary is where the check
    // belongs, not where the trust is.
    assertSafeRenderResources(html, Deno.env.get('SUPABASE_URL') || '');

    // ── Render, store, sign ─────────────────────────────────────────────────

    const fileName = clientDetailsFileName(details.meta.clientName, now);
    const path = clientDetailsStoragePath(request.clientId, fileName, now, crypto.randomUUID());
    const sections = clientDetailsSections(details).map((s) => s.id);

    const { data: renderRow } = await supabase
      .from('client_details_renders')
      .insert({
        client_id: request.clientId,
        requested_by: auth.userId,
        status: 'running',
        file_name: fileName,
        storage_bucket: PDF_BUCKET,
        storage_path: path,
        brand_snapshot_id: brandSnapshotId ?? null,
        brand_gaps: gaps,
        property_count: details.meta.propertyCount,
        sections_included: sections,
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
        format: 'client-details',
        renderId: renderId,
        sourceId: request.clientId,
        renderedAt: now,
      },
    });

    const { error: uploadError } = await supabase.storage.from(PDF_BUCKET).upload(path, pdf, {
      contentType: 'application/pdf',
      // Never overwrite: the path carries a random segment precisely so a second
      // render cannot replace a file a broker already has a link to.
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
        .from('client_details_renders')
        .update({ status: 'succeeded', bytes: pdf.length, duration_ms: durationMs })
        .eq('id', renderId);
    }

    const response: ClientDetailsRenderResponse = {
      url: signed.signedUrl,
      fileName,
      bytes: pdf.length,
      pageCount,
      renderId,
      brandSnapshotId: (brandSnapshotId as string) ?? null,
      brandGaps: gaps,
      sections,
      propertyCount: details.meta.propertyCount,
      durationMs,
    };
    return json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[render-client-details-pdf]', message);
    if (renderId) {
      await supabase
        .from('client_details_renders')
        .update({ status: 'failed', error: message.slice(0, 2000), duration_ms: Date.now() - started })
        .eq('id', renderId);
    }
    const status = e instanceof ClientDetailsPayloadError ? 400 : 500;
    return json({ error: message, renderId }, status);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
