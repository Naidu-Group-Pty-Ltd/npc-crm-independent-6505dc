/**
 * fork-investment-report
 * ----------------------
 * Takes a completed Compass-base Investment Report and deterministically produces
 * two derived client-facing reports:
 *
 *   - 'financial'      → Client Investment Feasibility & Financial Performance
 *   - 'strategic'      → Property & Location strategic assessment
 *
 * The forks are real `investment_reports` rows linked back to the composite
 * via `derived_from_report_id`. No new LLM calls are made; routing is
 * data-driven via reportSplitRegistry. Idempotent — re-running refreshes
 * existing child rows instead of duplicating them.
 *
 * Request:
 *   { composite_report_id: string; variants?: ('financial' | 'strategic')[] }
 *
 * Response:
 *   { ok: true, financial?: { id, ... }, strategic?: { id, ... } }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createForbiddenResponse, createUnauthorizedResponse } from '../_shared/auth.ts';
import { actorIsSuperadmin, requireModulePermission } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  loadSplitRegistry,
  type ForkVariant,
} from '../_shared/reportSplitRegistry.ts';
// The deterministic half — routing, the section contracts, the composed
// chapters and the hygiene pass — lives beside the other investment modules so
// it can be run, tested and rendered outside a deployed Deno runtime. It used
// to be 257 lines of this file, reachable only by reading its own source.
import { composeForkDocuments, countCompositeSections } from '../_shared/reports/investment/forkSplit.pure.ts';
import { runQAValidation } from '../_shared/compassQAValidator.ts';
import { enforceChartEvidence, readEvidenceInventory } from '../_shared/reports/investment/chartEvidence.pure.ts';
import { correctUnsupportedEvidenceClaims } from '../_shared/reports/investment/evidenceClaims.pure.ts';
import { scoreFinancial, scorePropertyFundamentals } from '../_shared/investmentScoreEngine.ts';
import { variantScoreUnderPolicy } from '../_shared/reports/market/variantScorePolicy.pure.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { readPropertyFacts } from '../_shared/reports/investment/propertyRecord.pure.ts';
import { readStrategyRecord } from '../_shared/reports/investment/strategyPositions.pure.ts';
import { ENRICHMENT_STAMP } from '../_shared/reports/location/locationEnrichmentReuse.pure.ts';
import { transportCountReading } from '../_shared/transportReading.pure.ts';
import { buildMarketFacts } from '../_shared/reports/market/marketFactBlocks.pure.ts';
import { describeSubjectPrice } from '../_shared/reports/investment/subjectPrice.pure.ts';
import { reconcileStoredFinancials } from '../_shared/reports/investment/financialEngine.pure.ts';
async function loadComposite(supabase: any, id: string) {
  const { data, error } = await supabase
    .from('investment_reports')
    .select('id, property_address, property_listing_id, client_property_id, canonical_property_key, generated_by, report_content, financial_calculations, demographics_data, economic_data, location_intelligence, data_sources, property_specs, manual_overrides, status, report_variant, report_tier, sources_content, investment_score, generation_engine, report_scope')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load composite: ${error.message}`);
  if (!data) throw new Error(`Composite report ${id} not found`);
  // `composite` is a legacy storage value for the Compass base engine. New
  // records persist `compass`; accept both so historical reports remain usable.
  if (data.report_variant !== 'composite' && data.report_variant !== 'compass') {
    throw new Error(`Report ${id} is not a Compass base report (variant=${data.report_variant})`);
  }
  if (data.status !== 'completed') {
    throw new Error(`Composite report ${id} is not yet completed (status=${data.status})`);
  }
  return data;
}

/**
 * The service-role client bypasses RLS, so a caller-selected report must be
 * scoped explicitly before any report content is loaded or changed.
 */
async function canForkComposite(
  supabase: any,
  id: string,
  userId: string,
  authMethod?: string,
): Promise<boolean> {
  if (authMethod === 'service_role' || userId === 'service_role') return true;
  if (await actorIsSuperadmin(supabase, userId)) return true;

  const { data: report, error } = await supabase
    .from('investment_reports')
    .select('generated_by, client_property_id')
    .eq('id', id)
    .maybeSingle();
  if (error || !report) return false;
  if (report.generated_by === userId) return true;
  if (!report.client_property_id) return false;

  const { data: clientProperty } = await supabase
    .from('client_properties')
    .select('client_id')
    .eq('id', report.client_property_id)
    .maybeSingle();
  if (!clientProperty?.client_id) return false;

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientProperty.client_id)
    .or(`created_by.eq.${userId},assigned_team_user_id.eq.${userId}`)
    .maybeSingle();
  return !!client;
}

type PersistedVariant = 'financial' | 'strategic';

async function findExistingFork(supabase: any, parentId: string, variant: PersistedVariant) {
  const { data, error } = await supabase
    .from('investment_reports')
    .select('id')
    .eq('derived_from_report_id', parentId)
    .eq('report_variant', variant)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to locate existing ${variant} report: ${error.message}`);
  return data?.id || null;
}

/**
 * The child's score: the variant scorer's answer when it can compute, carrying
 * the parent's four qualitative lists (the engine leaves them empty and they
 * are facts about the property, not about the weighting) — and the parent's
 * own composite score when the variant scorer cannot. The verdict, the grade
 * and the score are spine-mandatory in every tier, and writing null here is
 * what put "Graded  at  out of 100" on every Due Diligence report ever
 * produced. A refresh must never overwrite a good score with nothing.
 *
 * Under the forward-only scoring policy the grade itself is the PARENT's
 * decision, never this function's: see `variantScoreUnderPolicy`. A withheld
 * reading with its evidence statement is not "nothing" — every renderer
 * composes from it — so the rule above still holds.
 */
function resolveVariantScore(variant: ForkVariant, scoreInputRaw: any, parent: any) {
  const variantScore = variant === 'financial'
    ? scoreFinancial(scoreInputRaw)
    : scorePropertyFundamentals(scoreInputRaw);
  const parentScore = parent.investment_score && typeof parent.investment_score === 'object'
    ? parent.investment_score
    : null;
  // A fork MINTS no grade. This used to return the V1 variant grade whenever
  // the scorer could produce one, with no policy stamp — so on 15 Sep 2026
  // the Financial fork of 291 Stone Mason Drive wrote D · CAUTION · 39/100
  // seven minutes after the composite scorer had withheld the grade for the
  // same parent under the forward-only policy, and the Generated Reports
  // card showed that D as the property's grade. The property's grade is the
  // parent's decision; the child restates it (issued or withheld), keeps its
  // own dimensions as non-authoritative measured analysis, and carries the
  // parent's SWOT where it has none. See `variantScorePolicy.pure.ts`.
  return variantScoreUnderPolicy({ variantScore, parentScore, now: new Date() });
}

/**
 * QA findings, in the shape `validation_flags` already carries.
 *
 * The column is the platform's existing readiness mechanism: `render-template-pdf`
 * and `get-portal-client-data` both read it through
 * `governedAuthorityBlockFromFlags` before a document reaches a client. Until
 * now the fork ran its QA, printed the findings to a log nobody reads,
 * persisted the children and answered `ok: true` — so a child carrying a
 * material error was indistinguishable, at every downstream boundary, from
 * one that passed.
 *
 * A QA error is written as a blocking flag and a warning as a non-blocking
 * one, which is exactly the distinction those readers already make. Nothing is
 * deleted and nothing is refused: the work is persisted, the audit trail is
 * the flag, and the decision about whether to issue belongs to the operator.
 */
const FORK_QA_FLAG_TYPE = 'fork_qa';

function qaFlagsFor(qa: { findings: Array<{ severity: string; rule: string; message: string }> } | null) {
  if (!qa) return [];
  return qa.findings.map((f) => ({
    type: FORK_QA_FLAG_TYPE,
    severity: f.severity === 'error' ? 'critical' : 'medium',
    field: f.rule,
    message: f.message,
    value: { blocking: f.severity === 'error', category: f.rule, source: 'fork-investment-report' },
  }));
}

async function upsertFork(
  supabase: any,
  parent: any,
  variant: ForkVariant,
  persistedVariant: PersistedVariant,
  reportContent: string,
  score: any,
  qa: { findings: Array<{ severity: string; rule: string; message: string }> } | null = null,
) {
  const existingId = await findExistingFork(supabase, parent.id, persistedVariant);
  const sourcesContent = parent.sources_content || null;

  const sharedFields = {
    report_content: reportContent,
    sources_content: sourcesContent,
    investment_score: score,
    financial_calculations: parent.financial_calculations,
    demographics_data: parent.demographics_data,
    economic_data: parent.economic_data,
    location_intelligence: parent.location_intelligence,
    property_specs: parent.property_specs,
    manual_overrides: parent.manual_overrides,
    variant_generated_at: new Date().toISOString(),
    report_tier: persistedVariant,
    // The engine that produced the substance is the parent's — this function
    // slices and composes, it does not generate. Left unwritten, the column
    // defaulted to 'legacy' on every child, including the four forked from a
    // compass-40 parent on 2026-09-04, so nothing reading engine truth off a
    // child row could ever see the truth.
    generation_engine: parent.generation_engine ?? 'legacy',
    // The child's own QA result, in the column the render and portal
    // boundaries already read. A pass writes an empty array rather than
    // leaving the previous run's flags standing on a refreshed fork.
    validation_flags: qaFlagsFor(qa),
    status: 'completed',
  };

  if (existingId) {
    const { data, error } = await supabase
      .from('investment_reports')
      .update(sharedFields)
      .eq('id', existingId)
      .select('id, report_variant, derived_from_report_id, variant_generated_at')
      .maybeSingle();
    if (error) throw new Error(`Failed to refresh ${variant} fork: ${error.message}`);
    return { ...data, refreshed: true };
  }

  const { data, error } = await supabase
    .from('investment_reports')
    .insert({
      property_address: parent.property_address,
      property_listing_id: parent.property_listing_id,
      client_property_id: parent.client_property_id,
      canonical_property_key: parent.canonical_property_key,
      generated_by: parent.generated_by,
      report_scope: parent.report_scope,
      report_variant: persistedVariant,
      derived_from_report_id: parent.id,
      // Both linkage columns — history split the family across
      // derived_from_report_id (fork) and parent_report_id (condense), so
      // the two engines could not see each other's children. New rows carry
      // both; readers resolve the union either way (subReportFamily.pure.ts).
      parent_report_id: parent.id,
      ...sharedFields,
    })
    .select('id, report_variant, derived_from_report_id, variant_generated_at')
    .maybeSingle();
  if (error) throw new Error(`Failed to insert ${variant} fork: ${error.message}`);
  return { ...data, created: true };
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));

    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[fork-investment-report] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    const compositeId = body.composite_report_id || body.compositeReportId || body.reportId;
    const requestedVariants = Array.isArray(body.variants) && body.variants.length > 0 ? body.variants : ['financial', 'strategic'];
    const variants = [...new Set(requestedVariants.filter(
      (variant: unknown): variant is PersistedVariant => variant === 'financial' || variant === 'strategic',
    ))];
    if (!variants.length) throw new Error('At least one valid client report pathway is required');
    if (!compositeId) {
      return new Response(JSON.stringify({ error: 'composite_report_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const permission = await requireModulePermission(
      supabase,
      { userId, authMethod },
      'generated_reports',
      'can_edit',
    );
    if (!permission.ok) {
      return createForbiddenResponse('Generated reports edit permission required', corsHeaders);
    }

    if (!await canForkComposite(supabase, compositeId, userId!, authMethod)) {
      return createForbiddenResponse('You are not authorised to fork this report', corsHeaders);
    }

    console.log('[fork-investment-report] Authenticated fork request', {
      userId: userId?.substring?.(0, 8) || userId,
      authMethod,
      compositeId,
    });

    const parent = await loadComposite(supabase, compositeId);

    if (countCompositeSections(parent.report_content || '') === 0) {
      return new Response(JSON.stringify({ error: 'Composite has no H2 sections to fork' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load DB-overlaid split registry (falls back to in-code defaults)
    const registry = await loadSplitRegistry(supabase);
    console.log('[fork-investment-report] Split registry source:', registry.source);

    // Build the scoring input raw from parent's stored JSON. The price and
    // rent live where the calculator writes them — initialCosts.propertyValue
    // and income.weeklyRent — with the operator's override winning; the old
    // top-level reads (`financial_calculations.purchasePrice`) named paths
    // the record never had, so every fork was scored against $0.
    const fin = parent.financial_calculations || {};
    const overrides = parent.manual_overrides || {};
    const scoreInputRaw = {
      property: {
        // `property_specs.price` and `.weeklyRent` were read here and have
        // NEVER been written by any writer — the spec block has only ever held
        // `land_size_sqm`, `building_size_sqm`, `bedrooms`, `bathrooms`,
        // `parking`, `year_built`, `property_type`, `zoning`, `council_area`.
        // JSONB does not error on a key that is not there, so the read yielded
        // `undefined`, `Number(undefined)` yielded `NaN`, and the `||` chain
        // silently took the next rung. Same class as the `aml.cases.tenant_id`
        // sweep, with nothing to report it.
        price: Number(overrides.purchasePrice)
          || Number(fin.initialCosts?.propertyValue)
          || Number(fin.purchasePrice)
          || 0,
        weeklyRent: Number(overrides.weeklyRent)
          || Number(fin.income?.weeklyRent)
          || Number(fin.weeklyRent)
          || 0,
        // The record's own answer, healed on read. This read
        // `property_specs?.propertyType` — a key the writer spells
        // `property_type` — then fell through to that key, which is the
        // literal `'Residential Property'` on every report since June 2026,
        // while the operator's own `propertyType` sat in `overrides`,
        // destructured two lines above. `dRisk` is the only consumer
        // (`unit|apartment` −10, `townhouse` −5, `house` +3) and it is
        // weighted 15% on the financial fork: measured, a unit graded B at 60
        // where the record says C+ at 57. No strata property has been forked
        // yet, so the exposure is latent — and armed.
        // Only the strata case changes. `normalisedType` is undefined for an
        // unclassified record, and `investmentScoreEngine` line 68 is
        // `property.propertyType || 'house'` — so passing undefined would
        // DEFAULT to a house and award `dRisk`'s +3, where the old expression
        // passed the truthy `'Residential Property'` placeholder and got a
        // neutral. That would be a score change in the inflating direction,
        // and scoring is a separate decision the author has open. So the two
        // rungs below preserve the previous behaviour exactly: an
        // unclassifiable-but-present type stays neutral, an empty record still
        // resolves to 'house'.
        //
        // The engine's own `|| 'house'` is the real defect — it turns
        // "unclassified" into a house bonus, and `property_specs` is empty on
        // 100% of current reports — but it belongs to the scoring work, not
        // here.
        propertyType: readPropertyFacts(parent.property_specs, overrides).normalisedType
          ?? parent.property_specs?.property_type
          ?? 'house',
      },
      demographics: parent.demographics_data || {},
      locationIntelligence: parent.location_intelligence || {},
      financials: fin,
      // `property_specs.state` is a third key no writer emits.
      state: parent.demographics_data?.state,
    };

    const financialScore = resolveVariantScore('financial', scoreInputRaw, parent);
    const strategicScore = resolveVariantScore('due_diligence', scoreInputRaw, parent);

    // Both documents, composed. The Financial variant's chapters are typed
    // from the recorded calculation rather than sliced from prose — a
    // Compass-40 parent carries no financial sections to route, which is how
    // the "Financial Performance Report" came to hold one dollar sign while
    // its own row held the whole model — and they replace any routed prose
    // about the same money. See `forkSplit.pure.ts`.
    /*
     * The record the strategy sections are composed from.
     *
     * `carriesModelling: true` because this is the Financial report — the
     * Compass composes the same sections from the same module with `finance`
     * null, and `TIER_FRAMEWORK.md` Decision E is what makes that one
     * parameter rather than two implementations.
     *
     * The market evidence is read from `data_sources.marketEvidence`, which
     * the generator records on the row. A parent written before it did carries
     * none, `buildMarketFacts` answers `evidenceMissing`, and each composer
     * simply produces the entries that do not need it — which is the honest
     * outcome and not an empty heading.
     */
    /*
     * One record, so the tables and the prose state one figure.
     *
     * Measured on the stored Financial Analysis for 48 Redfern Street, Cowra
     * (18 Sep 2026), by executing both paths against the real row:
     *
     *   stored    keyMetrics: annualNet -23,383  weeklyNet -450
     *   reconciled keyMetrics: annualNet -24,273  weeklyNet -467
     *   weeklyRent 445, occupancyWeeks 50 -> contractual 23,140, occupied
     *   22,250; the gap is 890 a year, which is 17.12 a week.
     *
     * `reconcileStoredFinancials` RE-BASES the metrics from the contractual
     * rent onto `weeklyRent x occupancyWeeks`, which is `calculateKeyMetrics`'
     * own definition. `composeFinancialChapters` calls it and printed
     * `| Weekly net position | -$467 |` twice; `readStrategyRecord` did not,
     * and the prose two pages later said "$450 a week - $23,383 a year".
     *
     * Both figures are defensible and the document named them the same thing,
     * which is the defect. Nothing here changes an assumption or a formula: it
     * hands the SAME record to both producers, so a reader is given one
     * quantity — and the row that prints it now names the basis it rests on.
     */
    const reconciledFinancials =
      reconcileStoredFinancials(parent.financial_calculations).fin ?? parent.financial_calculations;

    const strategyRecord = readStrategyRecord(
      {
        propertyAddress: parent.property_address,
        propertySpecs: parent.property_specs,
        financialCalculations: reconciledFinancials,
        investmentScore: parent.investment_score,
        dataSources: parent.data_sources,
        locationIntelligence: parent.location_intelligence,
      },
      {
        measuredAt: (parent.location_intelligence as any)?.[ENRICHMENT_STAMP]?.acquiredAt ?? null,
        market: buildMarketFacts({ marketEvidence: (parent.data_sources as any)?.marketEvidence }),
        price: describeSubjectPrice({
          overridePurchasePrice: (parent.manual_overrides as any)?.purchasePrice,
          listingPrice: (parent.property_specs as any)?.price,
        }),
        carriesModelling: true,
        transport: transportCountReading((parent.location_intelligence as any)?.transport),
      },
    );

    const docs = composeForkDocuments({
      registry,
      parentContent: parent.report_content || '',
      propertyAddress: parent.property_address,
      financialCalculations: reconciledFinancials,
      financialScore,
      composeFinancial: variants.includes('financial'),
      strategy: strategyRecord,
      generatedOn: new Date().toISOString(),
    });
    const financialOut = docs.financial;
    const dueDiligenceOut = docs.dueDiligence;

    /*
     * QA on the ASSEMBLED child, which this path did not do at all.
     *
     * The generator validates its finished markdown and the condenser
     * validates its composed document; the fork validated nothing — so a
     * material claim error in the parent's prose (rule 13's hazard clearance
     * on a listing's authority is the measured one) travelled into the
     * Financial Analysis and the Due Diligence with nothing reading either.
     * One bad sentence became three documents and only the first was checked.
     *
     * It runs on `markdown` — the composed document, after routing and the
     * composed chapters — because that is what a client receives, and a rule
     * about what a document says has to read the document.
     *
     * The tier is the CHILD's, never the parent's: a Compass's page band and
     * financial exclusion asserted over a Financial Analysis is the defect
     * `condenseCompose` already records, and it produced sixteen errors on a
     * correct document.
     */
    /*
     * The correction runs FIRST, and on the child.
     *
     * A fork routes the parent's prose, so a parent generated before the claim
     * guard existed hands its hazard-clearance sentence to both children —
     * every time somebody forks it, for as long as it is on the table. Nothing
     * here rewrites the parent (its stored row is untouched, and a historical
     * document is a record); what is corrected is the NEW document this call
     * is producing, which is the one a client is about to receive.
     *
     * Ordering: correct, then validate. QA then measures what the client gets,
     * so a surviving finding is a real one rather than one the corrector had
     * already discharged.
     */
    const financialClaims = correctUnsupportedEvidenceClaims(financialOut.markdown);
    const strategicClaims = correctUnsupportedEvidenceClaims(dueDiligenceOut.markdown);

    /*
     * The chart-evidence contract, on the CHILD as it is written.
     *
     * A fork copies the parent's prose and its directives, so an unsupported
     * graphic in a Compass becomes an unsupported graphic in the Financial
     * Analysis and the Due Diligence report forked from it — three documents
     * carrying one defect. The three guards that judged figures all ran in
     * `generate-investment-report` and nowhere else, which is why they had
     * never once reached a child.
     *
     * It judges against the PARENT's record because that is the record the
     * content was written from and the record every child inherits.
     */
    const forkEvidence = readEvidenceInventory(parent);
    const financialEvidence = enforceChartEvidence(financialClaims.markdown, forkEvidence);
    const strategicEvidence = enforceChartEvidence(strategicClaims.markdown, forkEvidence);
    for (const [variant, judged] of [['financial', financialEvidence], ['strategic', strategicEvidence]] as const) {
      for (const f of judged.findings) {
        console.log(
          `[fork-investment-report] chart evidence ${variant} [${f.verdict}] ${f.kind}: ${f.reason}`,
        );
      }
    }

    const financialMarkdown = financialEvidence.markdown;
    const strategicMarkdown = strategicEvidence.markdown;
    for (const [variant, corrected] of [['financial', financialClaims], ['strategic', strategicClaims]] as const) {
      for (const r of corrected.removed) {
        console.log(
          `[fork-investment-report] claim guard ${variant} [${r.rule}]: removed `
          + JSON.stringify(r.text.slice(0, 160)),
        );
      }
    }

    const forkQa = {
      financial: variants.includes('financial')
        ? runQAValidation(financialMarkdown, 'financial-analysis') : null,
      strategic: variants.includes('strategic')
        ? runQAValidation(strategicMarkdown, 'strategic') : null,
    };
    for (const [variant, qa] of Object.entries(forkQa)) {
      if (!qa) continue;
      const errors = qa.findings.filter((f) => f.severity === 'error');
      console.log(
        `[fork-investment-report] QA ${variant}: ${qa.passed ? 'passed' : 'FAILED'} — `
        + `${errors.length} error(s), ${qa.findings.length - errors.length} warning(s)`,
      );
      for (const f of qa.findings) console.log(`   [${f.severity}] ${f.rule}: ${f.message}`);
    }

    /*
     * A logged error is not an outcome.
     *
     * `ok: true` says the fork ran; it has never said the children are fit to
     * send, and a caller reading only the status could not tell a clean child
     * from one carrying a contradiction the validator had just named. The two
     * questions are now answered separately: `ok` is whether the operation
     * succeeded, `client_ready` is whether anything blocking was found, and
     * `blocking_findings` says what.
     */
    const blockingFindings = Object.entries(forkQa).flatMap(([variant, qa]) =>
      (qa?.findings ?? [])
        .filter((f) => f.severity === 'error')
        .map((f) => ({ variant, rule: f.rule, message: f.message })));
    if (blockingFindings.length) {
      console.warn(
        `[fork-investment-report] NOT client-ready: ${blockingFindings.length} blocking finding(s) `
        + 'written to validation_flags on the affected child',
      );
    }

    const generated = await Promise.all(variants.map(async (variant) => {
      if (variant === 'financial') {
        return ['financial', await upsertFork(
          supabase, parent, 'financial', 'financial', financialMarkdown, financialScore, forkQa.financial,
        )] as const;
      }
      return ['strategic', await upsertFork(
        supabase, parent, 'due_diligence', 'strategic', strategicMarkdown, strategicScore, forkQa.strategic,
      )] as const;
    }));
    const result = Object.fromEntries(generated);

    return new Response(
      JSON.stringify({
        ok: true,
        // Whether the documents may be issued, which `ok` has never answered.
        client_ready: blockingFindings.length === 0,
        blocking_findings: blockingFindings,
        composite_report_id: parent.id,
        ...result,
        section_counts: {
          composite: docs.compositeSections,
          financial: variants.includes('financial') ? docs.financial.sections : 0,
          strategic: variants.includes('strategic') ? docs.dueDiligence.sections : 0,
        },
        qa: forkQa,
        // What the claim guard took out of each child, so a caller can see the
        // correction rather than a document that looks like it never carried it.
        // What the chart-evidence contract withheld from each child, so a
        // caller sees the correction rather than a document that looks like it
        // never carried the graphic.
        chart_evidence: {
          financial: variants.includes('financial') ? financialEvidence.findings : null,
          strategic: variants.includes('strategic') ? strategicEvidence.findings : null,
        },
        claim_corrections: {
          financial: variants.includes('financial') ? financialClaims.removed : null,
          strategic: variants.includes('strategic') ? strategicClaims.removed : null,
        },
        composed_financial_chapters: docs.composedChapters,
        routed_sections_replaced_by_record: docs.replacedByComposedChapters,
        hygiene: {
          financial: variants.includes('financial')
            ? { editorial_blocks_removed: financialOut.editorialBlocksRemoved, placeholder_rows_removed: financialOut.placeholderRowsRemoved }
            : null,
          strategic: variants.includes('strategic')
            ? { editorial_blocks_removed: dueDiligenceOut.editorialBlocksRemoved, placeholder_rows_removed: dueDiligenceOut.placeholderRowsRemoved }
            : null,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[fork-investment-report]', err);
    return new Response(JSON.stringify(internalError(err, 'fork-investment-report')), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
