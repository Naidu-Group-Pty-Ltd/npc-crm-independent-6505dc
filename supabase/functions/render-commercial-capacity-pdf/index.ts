/**
 * render-commercial-capacity-pdf
 *
 * The Commercial & Industrial Capacity Report, generated server-side.
 *
 * The caller sends an assessment id. Everything the document says is read here
 * — the assessment row, its current calculation run, the linked client's name,
 * the tenant's branding, the disclaimer — and the HTML is built here. That is
 * the whole difference from `render-template-pdf`, which accepts HTML: for a
 * document that states what a borrower can borrow, the contents are not the
 * browser's to decide.
 *
 * Six things make this a *path* rather than a renderer. Five are the ones
 * `render-borrowing-capacity-pdf` established, and the sixth is new here.
 *
 *  1. **Auth is a human, then that human and this assessment.** `verifyAuth`
 *     establishes the identity; every read is scoped by `user_id`, the rule the
 *     rest of this feature uses. The service-role identity is refused because
 *     it is not a person.
 *  2. **Only a completed assessment.** Enforced here, not only in the UI. A
 *     report is generated from a completed assessment's saved calculation run,
 *     so it reflects the engine and policy versions in force when the figures
 *     were produced.
 *  3. **The figures come from the stored run, never from a recomputation.**
 *     See `normalise.pure.ts` for why.
 *  4. **The brand is snapshotted, then referenced.** `upsert_report_brand_snapshot`
 *     dedupes by content fingerprint.
 *  5. **There is no fallback.** If WeasyPrint fails, this fails. A silent
 *     downgrade ships a client a document nobody approved.
 *  6. **The model is optional and the document is not.** The analysis is one
 *     section of nine. A gateway outage costs that section and is reported in
 *     the response; it does not cost the report.
 *
 * Every attempt leaves a row in `commercial_industrial_report_renders`,
 * including failures with their reason.
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAuth } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { consumeRateLimit } from '../_shared/requestSecurity.ts';
import { extractOpenAIUsage, logApiUsage } from '../_shared/logApiUsage.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';

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
  REPORT_SNAPSHOT_VERSION,
} from '../_shared/reportDesign/snapshot.pure.ts';
import { inlineAsset } from '../_shared/reportDesign/assets.pure.ts';
import { inlineBrandAssets } from '../_shared/reportDesign/fetchBrandAssets.ts';
import { formatMeasure } from '../_shared/reportDesign/measure.pure.ts';

import { buildCapacitySnapshot } from '../_shared/reports/commercialCapacity/normalise.pure.ts';
import { renderCapacityFromBrand } from '../_shared/reports/commercialCapacity/render.pure.ts';
import {
  ANALYSIS_SYSTEM_PROMPT,
  ANALYSIS_TOOL_SCHEMA,
  buildAnalysisPrompt,
  parseAnalysis,
  type AnalysisFacts,
  type CapacityAnalysis,
} from '../_shared/reports/commercialCapacity/analysis.pure.ts';
import type { CommercialCapacitySnapshot } from '../_shared/reports/commercialCapacity/payload.pure.ts';
import {
  capacityFileName,
  capacityStoragePath,
  isReportable,
  parseCapacityRequest,
  SIGNED_URL_TTL_SECONDS,
  type CapacityRenderResponse,
} from '../_shared/reports/commercialCapacity/route.pure.ts';

const PDF_BUCKET = 'client-files';

/**
 * The model, and the gateway it is reached through.
 *
 * `google/gemini-2.5-flash` is what `commercial-bc-scenario-agent` uses, and
 * this uses the same one on purpose: the report's analysis and the calculator's
 * scenario proposals are meant to read as one adviser, and two models with two
 * house styles would not.
 */
const ANALYSIS_MODEL = 'google/gemini-2.5-flash';
const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const AI_TIMEOUT_MS = 45_000;
const AI_MAX_TOKENS = 2_400;

/** How many figures the model is given. Enough to reason with; not the whole payload. */
const MAX_FACT_WARNINGS = 8;
const MAX_FACT_OUTSTANDING = 8;
const MAX_FACT_TENANCIES = 10;

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/**
 * The company block, out of the key/value table it actually lives in.
 *
 * `global_report_settings` is `(setting_key, setting_value jsonb)`. Reading it
 * as though it had `contact_details` and `disclaimer` columns is the mistake
 * that shipped every Borrowing Capacity Snapshot without an ABN — the select
 * errored and the error was never read (`BORROWING_CAPACITY.md` F17).
 */
function readReportSettings(
  rows: unknown,
  queryError: string | null,
): { contact: Record<string, unknown> | null; disclaimer: Record<string, unknown> | null } {
  if (queryError) {
    console.warn(`[render-commercial-capacity-pdf] global_report_settings unreadable: ${queryError}`);
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
 * What the model is told.
 *
 * Built from the payload, so every figure it sees is the figure the client will
 * read — already formatted by `Measure`, so it cannot round differently and
 * cannot reach a number the document does not contain.
 */
function analysisFacts(payload: CommercialCapacitySnapshot): AnalysisFacts {
  const figures: { label: string; value: string }[] = [
    { label: 'Maximum indicative capacity', value: formatMeasure(payload.headline.maximumCapacity) },
    { label: 'Requested facility', value: formatMeasure(payload.headline.requestedLoan) },
    {
      label: payload.headline.difference.value < 0 ? 'Shortfall against the request' : 'Headroom above the request',
      value: formatMeasure(payload.headline.difference),
    },
    { label: 'Required borrower contribution', value: formatMeasure(payload.headline.requiredContribution) },
    { label: 'Total project cost', value: formatMeasure(payload.transaction.totalProjectCost) },
    { label: 'Assessment rate', value: formatMeasure(payload.headline.assessmentRate) },
    { label: 'Loan term', value: formatMeasure(payload.headline.loanTerm) },
    { label: 'LVR (policy ceiling)', value: `${formatMeasure(payload.ratios.lvr)} (${formatMeasure(payload.ratios.lvrCeiling)})` },
    { label: 'DSCR (policy minimum)', value: `${formatMeasure(payload.ratios.dscr)} (${formatMeasure(payload.ratios.dscrFloor)})` },
    { label: 'ICR (policy minimum)', value: `${formatMeasure(payload.ratios.icr)} (${formatMeasure(payload.ratios.icrFloor)})` },
    { label: 'Debt yield (policy minimum)', value: `${formatMeasure(payload.ratios.debtYield)} (${formatMeasure(payload.ratios.debtYieldFloor)})` },
    { label: 'Annual surplus after debt service', value: formatMeasure(payload.headline.surplus) },
    { label: 'Surplus under rate sensitivity', value: formatMeasure(payload.headline.sensitisedSurplus) },
  ];

  if (payload.propertyIncome) {
    figures.push(
      { label: 'Net operating income', value: formatMeasure(payload.propertyIncome.netOperatingIncome) },
      { label: 'Capitalisation rate', value: formatMeasure(payload.propertyIncome.capitalisationRate) },
      { label: 'Break-even occupancy', value: formatMeasure(payload.propertyIncome.breakEvenOccupancy) },
    );
    if (payload.propertyIncome.wale) {
      figures.push({ label: 'WALE', value: `${formatMeasure(payload.propertyIncome.wale)} years` });
    }
  }

  if (payload.businessIncome) {
    figures.push(
      { label: 'Adjusted EBITDA', value: formatMeasure(payload.businessIncome.adjustedEbitda) },
      { label: 'Assessable business income', value: formatMeasure(payload.businessIncome.assessableIncome) },
      { label: 'Income verification', value: payload.businessIncome.verificationStatus },
    );
  }

  if (payload.portfolio) {
    const lvr = payload.portfolio.rows.find((r) => r.label === 'Portfolio LVR');
    if (lvr) {
      figures.push({
        label: 'Portfolio LVR before and after',
        value: `${formatMeasure(lvr.current)} → ${formatMeasure(lvr.proposed)}`,
      });
    }
  }

  if (payload.ratios.debtToEbitda) {
    figures.push({ label: 'Debt to EBITDA', value: formatMeasure(payload.ratios.debtToEbitda) });
  }

  return {
    outcome: payload.headline.outcomeLabel,
    outcomeReason: payload.headline.outcomeReason,
    segment: payload.meta.segment,
    assessmentType: payload.meta.assessmentTypeLabel,
    assetClass: payload.property.assetClass,
    location: payload.property.address,
    lenderProfile: payload.meta.lenderProfile,
    figures,
    constraints: payload.constraints.map((c) => ({
      label: c.label,
      cap: formatMeasure(c.cap),
      binding: c.binding,
      applied: c.applied,
    })),
    tenancies: (payload.propertyIncome?.tenancies ?? []).slice(0, MAX_FACT_TENANCIES).map((t) => ({
      tenant: t.tenant,
      rent: formatMeasure(t.passingRent),
      expiry: t.expiry ?? '',
    })),
    warnings: payload.warnings.slice(0, MAX_FACT_WARNINGS).map((w) => w.message),
    outstanding: payload.outstanding.slice(0, MAX_FACT_OUTSTANDING).map((o) => o.label),
  };
}

/**
 * Ask the model to read the figures.
 *
 * Returns the analysis, or a note saying why there is none. Never throws: this
 * is one section of nine, and a gateway outage must cost that section rather
 * than the report. The note travels back to the caller so "the analysis is
 * missing" has an answer at the moment somebody is about to send the document.
 */
async function generateAnalysis(
  // NOT `ReturnType<typeof createClient>`: that instantiates the generic's type
  // parameters from their CONSTRAINTS rather than their defaults, so it does not
  // describe what `createClient(url, key)` actually returns and nothing can be
  // passed to it. `SupabaseClient` with its own defaults is the accurate type.
  supabase: SupabaseClient,
  args: { payload: CommercialCapacitySnapshot; userId: string; assessmentId: string },
): Promise<{ analysis: CapacityAnalysis | null; note: string | null }> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) {
    console.warn('[render-commercial-capacity-pdf] LOVABLE_API_KEY unset; rendering without an analysis');
    return { analysis: null, note: 'The analysis service is not configured for this workspace.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const started = Date.now();

  try {
    const response = await fetch(AI_GATEWAY, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        messages: [
          { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
          { role: 'user', content: buildAnalysisPrompt(analysisFacts(args.payload)) },
        ],
        tools: [ANALYSIS_TOOL_SCHEMA],
        // Forced, not offered. This section has a structure the page depends
        // on, and parsing it back out of prose is guesswork.
        tool_choice: { type: 'function', function: { name: ANALYSIS_TOOL_SCHEMA.function.name } },
        max_tokens: AI_MAX_TOKENS,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(`[render-commercial-capacity-pdf] analysis failed: ${response.status} ${detail.slice(0, 300)}`);
      return {
        analysis: null,
        note: response.status === 429
          ? 'The analysis service was rate limited. The report was generated without it.'
          : response.status === 402
            ? 'AI credits are exhausted. The report was generated without an analysis.'
            : 'The analysis service was unavailable. The report was generated without it.',
      };
    }

    const body = await response.json();

    // Metered. An unlogged model call is an invisible spend, which is the
    // defect `render-report-qa-pdf` records inheriting and refusing to repeat.
    const usage = extractOpenAIUsage(body);
    await logApiUsage(supabase, {
      service_name: 'lovable-ai',
      endpoint: '/v1/chat/completions',
      model_used: ANALYSIS_MODEL,
      ...usage,
      response_time_ms: Date.now() - started,
      status: 'success',
      user_id: args.userId,
      metadata: {
        function: 'render-commercial-capacity-pdf',
        action: 'capacity-analysis',
        assessment_id: args.assessmentId,
      },
    });

    const call = body?.choices?.[0]?.message?.tool_calls?.[0];
    const analysis = parseAnalysis(call?.function?.arguments, {
      model: ANALYSIS_MODEL,
      // The clock lives here, at the edge, and nowhere in the pure modules.
      generatedAt: new Date().toISOString(),
    });

    return analysis
      ? { analysis, note: null }
      : {
          analysis: null,
          // Refused rather than half-accepted. `parseAnalysis` returns null for
          // anything that is not a complete analysis, and a section with two of
          // its four parts looks like something failed — because it did.
          note: 'The analysis returned did not meet the required structure and was discarded.',
        };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    console.error('[render-commercial-capacity-pdf] analysis error', error);
    return {
      analysis: null,
      note: aborted
        ? 'The analysis service timed out. The report was generated without it.'
        : 'The analysis could not be generated. The report was generated without it.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token, x-finance-session-token',
    'Access-Control-Expose-Headers': 'x-correlation-id, x-duration-ms',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, corsHeaders);

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations.
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

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
    const auth = await verifyAuth(
      supabase,
      req.headers,
      // verifyAuth's body parameter is optional, not nullable — `null` is not an
      // accepted value, so an absent body must be `undefined`.
      (body as { session_token?: string } | null) ?? undefined,
    );
    if (auth.error || !auth.userId || auth.userId === 'service_role') {
      return json({ error: auth.error || 'Authentication required' }, 401, corsHeaders);
    }
    const userId = auth.userId;

    // Commercial & Industrial is a Scale-or-add-on capability — enforced
    // server-side, not just hidden in the UI.
    const entitlement = await requireWorkspaceCapability(supabase, auth, 'commercial-industrial');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    const parsed = parseCapacityRequest(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400, corsHeaders);
    const request = parsed.request;

    const weasyprint = weasyPrintConfig((key) => Deno.env.get(key));
    if (!weasyprint) {
      // Checked before the reads: a misconfigured environment should say so,
      // not after five queries, a model call and a document build.
      return json({
        error: 'WeasyPrint is not configured (WEASYPRINT_SERVICE_URL + WEASYPRINT_SERVICE_TOKEN)',
      }, 503, corsHeaders);
    }

    // ── Read everything the document says ───────────────────────────────────

    const { data: assessment, error: assessmentError } = await supabase
      .from('commercial_industrial_assessments')
      .select('*')
      .eq('id', request.assessmentId)
      // Scoped by owner, the rule the rest of this feature uses. A row the
      // caller does not own is indistinguishable from one that does not exist,
      // which is what stops this confirming cross-tenant existence.
      .eq('user_id', userId)
      .maybeSingle();

    // A failed read is not a missing row. Selecting a column that does not
    // exist returns `{ data: null, error }`, and treating that as "not found"
    // is what turned a typo into a 404 on every client in the database
    // (`BORROWING_CAPACITY.md` F18). The error is the answer here, and it is
    // quoted.
    if (assessmentError) {
      throw new Error(`could not read the assessment: ${assessmentError.message}`);
    }
    if (!assessment) return json({ error: 'not found' }, 404, corsHeaders);

    // The product's rule, enforced here rather than only in the UI.
    if (!isReportable(assessment.status)) {
      return json({
        error: 'A report can only be generated from a completed assessment.',
        code: 'NOT_COMPLETED',
        status: assessment.status,
      }, 409, corsHeaders);
    }
    if (!assessment.current_calculation_id) {
      return json({
        error: 'This assessment has no saved calculation run to report from.',
        code: 'NO_CALCULATION',
      }, 409, corsHeaders);
    }

    const [runRes, clientRes, whitelabelRes, settingsRes] = await Promise.all([
      supabase
        .from('commercial_industrial_calculation_runs')
        .select('*')
        .eq('id', assessment.current_calculation_id)
        .eq('user_id', userId)
        .maybeSingle(),
      assessment.client_id
        ? supabase.from('clients').select(CLIENT_NAME_COLUMNS).eq('id', assessment.client_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('whitelabel_settings').select('*').limit(1).maybeSingle(),
      supabase
        .from('global_report_settings')
        .select('setting_key, setting_value')
        .in('setting_key', ['contact_details', 'professional_disclaimer']),
    ]);

    if (runRes.error) throw new Error(`could not read the calculation run: ${runRes.error.message}`);
    if (!runRes.data) {
      return json({
        error: 'The saved calculation run for this assessment could not be found.',
        code: 'NO_CALCULATION',
      }, 409, corsHeaders);
    }
    const run = runRes.data as Record<string, unknown>;

    // A client read that failed is worth a log line and nothing more: the
    // report's subject falls back to the assessment's own title, which is what
    // a standalone assessment uses anyway.
    if (clientRes.error) {
      console.warn(`[render-commercial-capacity-pdf] client unreadable: ${clientRes.error.message}`);
    }
    const clientName = clientRes.data
      ? clientDisplayName(clientRes.data as Record<string, unknown>)
      : '';

    // ── The analysis ────────────────────────────────────────────────────────
    //
    // Reused unless the caller asks for a fresh one. Persisting is what makes a
    // re-issued report say what the first one said — see the migration.

    const stored = parseAnalysis(run.analysis, {
      model: String((run.analysis as Record<string, unknown> | null)?.model ?? ANALYSIS_MODEL),
      generatedAt: String((run.analysis as Record<string, unknown> | null)?.generatedAt ?? ''),
    });

    let analysis: CapacityAnalysis | null = request.refreshAnalysis ? null : stored;
    let analysisNote: string | null = null;

    if (!request.includeAnalysis) {
      analysis = null;
      analysisNote = 'The analysis was not requested for this render.';
    } else if (!analysis) {
      // Metered per caller. A model call behind a download button is a model
      // call somebody can hold down.
      const limit = await consumeRateLimit(
        supabase, `ci-capacity-analysis:user:${userId}:hour`, 30, 3_600,
      ).catch(() => ({ allowed: true }));

      if (!limit.allowed) {
        analysisNote = 'The analysis limit for this hour has been reached. '
          + 'The report was generated without it.';
      } else {
        const provisional = buildCapacitySnapshot({
          assessment: assessment as Record<string, unknown>,
          outputs: run.outputs,
          inputs: run.inputs_snapshot,
          clientName,
          analysis: null,
        });
        const generated = await generateAnalysis(supabase, {
          payload: provisional,
          userId,
          assessmentId: String(assessment.id),
        });
        analysis = generated.analysis;
        analysisNote = generated.note;

        if (analysis) {
          // Written to the run, not the assessment: an analysis interprets a
          // specific set of figures, and a recalculation writes a new run.
          const { error: analysisWriteError } = await supabase
            .from('commercial_industrial_calculation_runs')
            .update({ analysis })
            .eq('id', run.id)
            .eq('user_id', userId);
          if (analysisWriteError) {
            // Not fatal. The document is already correct; what is lost is the
            // reuse, and a report that renders beats one that fails on a write
            // nobody is waiting for.
            console.warn(
              `[render-commercial-capacity-pdf] analysis not persisted: ${analysisWriteError.message}`,
            );
          }
        }
      }
    }

    const payload = buildCapacitySnapshot({
      assessment: assessment as Record<string, unknown>,
      outputs: run.outputs,
      inputs: run.inputs_snapshot,
      clientName,
      analysis,
    });

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
        `[render-commercial-capacity-pdf] asset ${note.key} not inlined (${note.reason}): ${note.detail}`,
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
      // Surfaced, not swallowed: "the logo did not appear" is a support ticket,
      // and *too large* / *too small* / *wrong format* are different answers.
      console.warn(
        `[render-commercial-capacity-pdf] asset ${skipped.source} skipped (${skipped.reason}): ${skipped.detail}`,
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

    // Cover art comes from the tenant's own `cover` asset and nowhere else.
    // `NPC_HOUSE_COVER_ART` is a finished NPC cover with our name burned into
    // the pixels; reaching for it here is the defect this format avoids.
    const coverArt = inlineAsset(logoConfig.cover ?? null);

    const { html, gaps } = renderCapacityFromBrand({
      payload,
      snapshot,
      disclaimer: settings.disclaimer as never,
      coverArtDataUri: coverArt.ok ? coverArt.asset.dataUri : null,
      edition: request.edition,
      reference: String(assessment.reference ?? '').slice(0, 40) || null,
    });

    // The guard runs on HTML this function built, deliberately. The assets in
    // it came from a tenant's settings form; the boundary is where the check
    // belongs, not where the trust is.
    assertSafeRenderResources(html, Deno.env.get('SUPABASE_URL') || '');

    // ── Render, store, sign ─────────────────────────────────────────────────

    const now = new Date().toISOString();
    const fileName = capacityFileName(String(assessment.reference ?? ''), now);
    const path = capacityStoragePath(String(assessment.id), fileName, now, crypto.randomUUID());

    const { data: renderRow } = await supabase
      .from('commercial_industrial_report_renders')
      .insert({
        assessment_id: assessment.id,
        calculation_run_id: run.id,
        user_id: userId,
        requested_by: userId,
        status: 'running',
        file_name: fileName,
        storage_bucket: PDF_BUCKET,
        storage_path: path,
        brand_snapshot_id: brandSnapshotId ?? null,
        brand_gaps: gaps,
        has_analysis: Boolean(analysis),
        analysis_note: analysisNote,
      })
      .select('id')
      .maybeSingle();
    renderId = (renderRow?.id as string) ?? null;

    const pdf = await renderPdf(weasyprint, html, { variant: 'pdf/a-2b', tagged: true });

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
        .from('commercial_industrial_report_renders')
        .update({ status: 'succeeded', bytes: pdf.length, page_count: pageCount, duration_ms: durationMs })
        .eq('id', renderId);
    }

    // The audit trail this feature keeps for every state change. A document
    // leaving the building is a state change.
    await supabase.from('commercial_industrial_assessment_audit_events').insert({
      assessment_id: assessment.id,
      user_id: userId,
      event_type: 'report_generated',
      detail: { renderId, fileName, pageCount, hasAnalysis: Boolean(analysis) },
      actor_id: userId,
    });

    const response: CapacityRenderResponse = {
      url: signed.signedUrl,
      fileName,
      bytes: pdf.length,
      pageCount,
      renderId,
      brandSnapshotId: (brandSnapshotId as string) ?? null,
      brandGaps: gaps,
      hasAnalysis: Boolean(analysis),
      analysisNote,
      durationMs,
    };
    return json(response, 200, corsHeaders);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[render-commercial-capacity-pdf]', message);
    if (renderId) {
      await supabase
        .from('commercial_industrial_report_renders')
        .update({
          status: 'failed',
          error: message.slice(0, 2000),
          duration_ms: Date.now() - started,
        })
        .eq('id', renderId);
    }
    // The message is the service's own where there is one. A 500 that says only
    // "render failed" costs an hour that a quoted upstream error does not.
    return json({ error: message, renderId }, 500, corsHeaders);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
