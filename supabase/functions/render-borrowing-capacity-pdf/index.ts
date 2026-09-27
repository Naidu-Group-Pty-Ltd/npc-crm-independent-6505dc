/**
 * render-borrowing-capacity-pdf
 *
 * The Borrowing Capacity Snapshot, generated server-side.
 *
 * The caller sends a client id. Everything the document says is read here — the
 * assessment row, the client's name, the tenant's branding, the disclaimer —
 * and the HTML is built here. That is the whole difference from
 * `render-template-pdf`, which accepts HTML: for a document that tells someone
 * how much they can borrow, the contents are not the browser's to decide.
 *
 * The five things that make this a *path* rather than a renderer:
 *
 *  1. **Auth is a human, then that human and this client.** The gateway JWT
 *     check is off across this project to support the custom session flow, so
 *     `verifyAuthOrNativeUser` establishes the identity and `canAccessClient`
 *     establishes the relationship. Neither implies the other.
 *  2. **The brand is snapshotted, then referenced.** `upsert_report_brand_snapshot`
 *     dedupes by content fingerprint, so re-rendering an unchanged brand reuses
 *     the row rather than writing thousands of identical ones.
 *  3. **Resources are checked before the POST.** `assertSafeRenderResources`
 *     runs even though this function built the HTML itself: an asset arrives
 *     from a tenant's settings, and the guard is on the boundary, not on trust.
 *  4. **There is no fallback.** If WeasyPrint fails, this fails. A silent
 *     downgrade ships a client a document nobody approved.
 *  5. **Every attempt leaves a row.** A failure writes its reason to
 *     `borrowing_capacity_renders`, which is the difference between "the client
 *     says the PDF never arrived" and an answer.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuthOrNativeUser } from '../_shared/auth.ts';
import { canAccessClient } from '../_shared/clientAccess.ts';
import { requireModulePermission } from '../_shared/authz.ts';

import { CLIENT_NAME_COLUMNS, clientDisplayName } from '../_shared/clientName.ts';
import { assertSafeRenderResources } from '../_shared/renderResourcePolicy.pure.ts';
import { withRequestOrigin } from '../_shared/corsOrigin.ts';
import {
  countPdfPagesAsync,
  renderPdf,
  weasyPrintConfig,
} from '../_shared/weasyprintClient.ts';
import {
  buildReportBrandSnapshot,
  issuerDisclaimerSetting,
  REPORT_SNAPSHOT_VERSION,
} from '../_shared/reportDesign/snapshot.pure.ts';
import { deploymentKind } from '../_shared/emailIdentity.pure.ts';
import { inlineAsset } from '../_shared/reportDesign/assets.pure.ts';
import { inlineBrandAssets } from '../_shared/reportDesign/fetchBrandAssets.ts';
import { buildSnapshot } from '../_shared/reports/borrowingCapacity/normalise.pure.ts';
import { renderSnapshotFromBrand } from '../_shared/reports/borrowingCapacity/render.pure.ts';
import { resolveRequestedDesign } from '../_shared/reports/templateDesignRead.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  parseRenderRequest,
  SIGNED_URL_TTL_SECONDS,
  snapshotFileName,
  snapshotStoragePath,
  type SnapshotRenderResponse,
} from '../_shared/reports/borrowingCapacity/route.pure.ts';

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
 * The company block, out of the key/value table it actually lives in.
 *
 * `global_report_settings` is `(setting_key, setting_value jsonb)` — there is no
 * `contact_details` column and no `disclaimer` column. Selecting them by name
 * returned an error rather than a row, and because the error was never read,
 * every Snapshot went out with no ABN, no phone, no address and the house
 * disclaimer instead of the firm's. `render-investment-report-pdf` has always
 * read it the way below; this is the same read.
 *
 * A failure here is reported, not thrown: a document with a thinner closing page
 * is worth having, and `brandGaps` already tells the caller what is missing.
 */
function readReportSettings(
  rows: unknown,
  queryError: string | null,
): { contact: Record<string, unknown> | null; disclaimer: Record<string, unknown> | null } {
  if (queryError) {
    console.warn(`[render-borrowing-capacity-pdf] global_report_settings unreadable: ${queryError}`);
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

    // …and then this person against this client. Authentication is not
    // authorisation: every staff member is authenticated. Ownership is the fast
    // path; staff who hold view permission on the Clients module are also
    // entitled to render for a client they neither created nor were assigned.
    const actor = { userId: auth.userId, authMethod: auth.authMethod };
    if (!await canAccessClient(supabase, actor, request.clientId)) {
      const staff = await requireModulePermission(supabase, actor, 'clients', 'can_view');
      if (!staff.ok) return json({ error: 'not found' }, 404);
    }


    const weasyprint = weasyPrintConfig((key) => Deno.env.get(key));
    if (!weasyprint) {
      // Checked before the reads: a misconfigured environment should say so,
      // not after four queries and a document build.
      return json({
        error: 'WeasyPrint is not configured (WEASYPRINT_SERVICE_URL + WEASYPRINT_SERVICE_TOKEN)',
      }, 503);
    }

    // ── Read everything the document says ───────────────────────────────────

    const assessmentQuery = supabase
      .from('borrowing_capacity_assessments')
      .select('*')
      .eq('client_id', request.clientId);

    const [clientRes, assessmentRes, whitelabelRes, settingsRes] = await Promise.all([
      supabase.from('clients').select(CLIENT_NAME_COLUMNS).eq('id', request.clientId).maybeSingle(),
      request.assessmentId
        ? assessmentQuery.eq('id', request.assessmentId).maybeSingle()
        : assessmentQuery.order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('whitelabel_settings').select('*').limit(1).maybeSingle(),
      supabase
        .from('global_report_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['contact_details', 'professional_disclaimer']),
    ]);

    // A failed read is not a missing row. Selecting a column that does not
    // exist returns `{ data: null, error }`, and treating that as "not found"
    // is what turned a typo into a 404 on every client in the database — see
    // `CLIENT_NAME_COLUMNS`. The error is the answer here, and it is quoted.
    for (const [what, res] of [['client', clientRes], ['assessment', assessmentRes]] as const) {
      if (res.error) {
        throw new Error(`could not read the ${what}: ${res.error.message}`);
      }
    }

    if (!clientRes.data) return json({ error: 'not found' }, 404);
    if (!assessmentRes.data) {
      return json({ error: 'no borrowing capacity assessment for this client' }, 409);
    }

    const assessment = assessmentRes.data as Record<string, unknown>;
    // `clientDisplayName` returns '' for a row with no name on it, so the cover
    // and the filename decide what to do about that rather than the reader. On
    // this document they say "Client", which is what the filename has always
    // fallen back to.
    const clientName = clientDisplayName(clientRes.data as Record<string, unknown>) || 'Client';

    // ── The brand, frozen ───────────────────────────────────────────────────

    const whitelabel = (whitelabelRes.data ?? null) as Record<string, unknown> | null;
    const settings = readReportSettings(settingsRes.data, settingsRes.error?.message ?? null);
    const storedLogos = (whitelabel?.logo_config ?? {}) as Record<string, string | null>;
    const themeConfig = (whitelabel?.theme_config ?? {}) as Record<string, unknown>;

    // The branding form stores URLs; the snapshot builder only accepts bytes.
    // Without this step every asset is rejected as `not-a-data-uri` and the
    // document carries no company mark at all.
    const { assets: logoConfig, notes: assetNotes } = await inlineBrandAssets(storedLogos, {
      supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
    });
    for (const note of assetNotes) {
      console.warn(
        `[render-borrowing-capacity-pdf] asset ${note.key} not inlined (${note.reason}): ${note.detail}`,
      );
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
      // Surfaced, not swallowed: "the logo did not appear" is a support ticket,
      // and *too large* / *too small* / *wrong format* are different answers.
      console.warn(
        `[render-borrowing-capacity-pdf] asset ${skipped.source} skipped (${skipped.reason}): ${skipped.detail}`,
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

    const payload = buildSnapshot({
      clientName,
      assessment,
      // Persisted since migration 20260814000000. Before it, both are null and
      // the two pages they drive are simply absent — which is what every
      // shipping Snapshot has looked like until now (F12).
      auditTrail: assessment.audit_trail ?? null,
      explanation: assessment.explanation ?? null,
      scenarioPresets: request.scenarioPresets,
      now: new Date().toISOString(),
    });

    // Cover art comes from the tenant's own `cover` asset and nowhere else.
    // `NPC_HOUSE_COVER_ART` is a finished NPC cover with our name burned into
    // the pixels; reaching for it here is the defect this format is removing.
    const coverArt = inlineAsset(logoConfig.cover ?? null);

    // The design the caller chose, if any. The words, figures and pages are
    // the report's own whatever it names; a design that cannot be honoured is
    // answered with the standard one and a sentence saying why, never with a
    // failed document (`templateDesignRead.ts`).
    const { design, echo: designEcho } = await resolveRequestedDesign(supabase, {
      reference: request.design,
      reportType: 'borrowing_capacity',
      actor: actor,
      route: 'render-borrowing-capacity-pdf',
    });

    const { html, gaps } = renderSnapshotFromBrand({
      payload,
      snapshot,
      disclaimer: issuerDisclaimerSetting(settings.disclaimer, snapshot, reportDeployment) as never,
      coverArtDataUri: coverArt.ok ? coverArt.asset.dataUri : null,
      edition: request.edition,
      reference: String(assessment.id ?? '').slice(0, 8).toUpperCase() || null,
      design,
    });

    // The guard runs on HTML this function built, deliberately. The assets in
    // it came from a tenant's settings form; the boundary is where the check
    // belongs, not where the trust is.
    assertSafeRenderResources(html, Deno.env.get('SUPABASE_URL') || '');

    // ── Render, store, sign ─────────────────────────────────────────────────

    const now = new Date().toISOString();
    const fileName = snapshotFileName(clientName, now);
    const path = snapshotStoragePath(request.clientId, fileName, now, crypto.randomUUID());

    const { data: renderRow } = await supabase
      .from('borrowing_capacity_renders')
      .insert({
        assessment_id: assessment.id ?? null,
        client_id: request.clientId,
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
        format: 'borrowing-capacity',
        renderId: renderId,
        sourceId: String(assessment.id ?? '') || null,
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
        .from('borrowing_capacity_renders')
        .update({ status: 'succeeded', bytes: pdf.length, duration_ms: durationMs })
        .eq('id', renderId);
    }

    const response: SnapshotRenderResponse = {
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
    console.error('[render-borrowing-capacity-pdf]', message);
    if (renderId) {
      await supabase
        .from('borrowing_capacity_renders')
        .update({
          status: 'failed',
          error: message.slice(0, 2000),
          duration_ms: Date.now() - started,
        })
        .eq('id', renderId);
    }
    // The message is the service's own where there is one. A 500 that says only
    // "render failed" costs an hour that a quoted upstream error does not.
    return json({ error: message, renderId }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
