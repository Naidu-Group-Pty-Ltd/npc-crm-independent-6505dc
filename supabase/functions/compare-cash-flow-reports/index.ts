import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { reconcileStoredFinancials } from '../_shared/reports/investment/financialEngine.pure.ts';
import { readModelJson } from '../_shared/llmJson.pure.ts';
import {
  CASH_FLOW_ANALYSIS_SCHEMA,
  CASH_FLOW_ANALYSIS_SHAPE,
  attemptTimeoutMs,
  cashFlowAnalysisTokens,
  classifyCashFlowAnalysis,
  type CashFlowAnalysisReading,
} from '../_shared/reports/cashFlowComparison/analysisRequest.pure.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  const startTime = Date.now();

  try {
    const body = await req.json();
    const { 
      reportIds, 
      projectionData,
      investorProfile = 'balanced',
      timeHorizon = '10 years',
    } = body;

    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[compare-cash-flow-reports] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    // Cash Flow Comparisons is a Growth/Scale capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabase, { userId, authMethod }, 'cashflow-comparisons');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);
    console.log('[compare-cash-flow-reports] Authenticated user:', userId);

    if (!reportIds || !Array.isArray(reportIds) || reportIds.length < 2 || reportIds.length > 5) {
      return new Response(
        JSON.stringify({ error: 'Please provide 2-5 report IDs for comparison' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch all investment reports
    const { data: reports, error: fetchError } = await supabase
      .from('investment_reports')
      .select('id, property_address, financial_calculations, manual_overrides, investment_score')
      .in('id', reportIds);

    if (fetchError) {
      console.error('Error fetching reports:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch investment reports' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!reports || reports.length !== reportIds.length) {
      return new Response(
        JSON.stringify({ error: 'Some reports could not be found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Comparing cash flow projections for ${reports.length} properties...`);

    // The order the adviser chose, not the order PostgREST answered in.
    //
    // `propertyNumber` is the only handle the model has on a property in five
    // of the eight sections, and it was the position of a row in an `.in()`
    // result — an order the server never promises. The caller sends the open
    // report first and each comparison after it, which is the order every
    // column, chart and legend on that screen is already in, so the numbers in
    // the answer mean what a reader looking at the page assumes they mean.
    const byId = new Map(reports.map((row) => [row.id, row]));
    const orderedReports = (reportIds as string[])
      .map((id) => byId.get(id))
      .filter((row): row is typeof reports[number] => Boolean(row));

    // Structure data for AI analysis
    const propertiesData = orderedReports.map((report, index) => {
      // Read-boundary heal (audit F26): the model compares the figures the
      // rows store, and a historic row's projections were folded against
      // triple-charged operating costs. Reconcile before anything reads them.
      const fc = reconcileStoredFinancials(report.financial_calculations).fin || {};
      const mo = report.manual_overrides || {};
      const score = report.investment_score || {};
      const projection = projectionData?.[report.id] || {};

      return {
        propertyNumber: index + 1,
        address: report.property_address,
        
        // Financial Metrics
        purchasePrice: mo.purchasePrice || fc.purchasePrice || 0,
        weeklyRent: mo.weeklyRent || fc.weeklyRent || 0,
        // IMPORTANT: Do not default to 5% - use researched/overridden value or null
        capitalGrowthRate: mo.capitalGrowth || fc.capitalGrowth || fc.assumptions?.capitalGrowth || null,
        interestRate: mo.interestRate || fc.interestRate || 5.5,
        loanToValueRatio: mo.loanToValueRatio || fc.loanToValueRatio || 80,
        
        // Investment Score
        overallScore: score.totalScore || null,
        letterGrade: score.letterGrade || null,
        
        // 10-Year Projections (from frontend calculations)
        projections: {
          year1: projection.year1 || {},
          year5: projection.year5 || {},
          year10: projection.year10 || {},
        },
        
        // Summary metrics
        metrics: projection.metrics || {},
      };
    });

    const analysisTokens = cashFlowAnalysisTokens(reports.length);

    // The shape is asked for once, from the module that also reads it back.
    // It used to be a JSON literal in this string and nowhere else, which is
    // why nothing could check what was requested against what `toAnalysis`
    // expects.
    const prompt = `Compare the following ${reports.length} Australian investment properties over ${timeHorizon} of projected cash flow.

**INVESTOR PROFILE:** ${investorProfile}
**TIME HORIZON:** ${timeHorizon}

**PROPERTIES TO COMPARE:**
${JSON.stringify(propertiesData, null, 2)}

Answer with a single JSON object and nothing else — no preamble, no commentary
after it, and no prose outside the object. Every section below is a field of
that object.

- **executiveSummary** — two or three paragraphs: which properties perform best
  over the horizon, what actually separates them, and a quick verdict on which
  suits which kind of investor.
- **cashFlowTrajectory** — which property reaches positive cash flow soonest and
  when, which has the strongest growth in cash flow, and any property whose
  pattern is concerning.
- **capitalGrowth** — strongest equity accumulation, the best wealth-builder,
  and each property's projected value and equity at year 10.
- **yieldAnalysis** — best gross yield, best net yield, and best return over the
  horizon, each with the figure it won on.
- **riskAssessment** — the most stable projection, the highest-risk property and
  its specific risks, and break-even year with safety margin for each property.
- **investorRecommendations** — the property you would recommend to each of the
  four profiles: growth focused, income focused, balanced, risk averse.
- **finalRankings** — every property ranked best to worst for the
  ${investorProfile} profile, each with its strengths, its weaknesses and a
  one-paragraph verdict. Echo each address exactly as it was given above.
- **overallRecommendation** — the single best property and why, any property to
  avoid and why, and the scenarios under which a different property would win.

Ground every claim in the figures supplied. Where a property's capital growth
rate is null it was never researched — say so rather than assuming one.

Use exactly this structure:
${CASH_FLOW_ANALYSIS_SHAPE}`;

    // ── Ask, and keep asking in a shape the provider will accept ──────────
    //
    // The ladder is `json_schema` → `json_object` → prose, one rung per
    // attempt, because the route is not fixed: this agent key can be pointed at
    // the gateway, at OpenRouter or at a native provider from the Model Hub, and
    // support for `json_schema` varies between them. Asking for a format a
    // provider does not understand is a 400 on the request itself, which would
    // turn "the analysis is missing sections" into "the analysis does not run at
    // all" — strictly worse. Only a refusal of the FORMAT drops a rung;
    // `rungRejected` is deliberately narrow about what counts as one.
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const {
      nextRung,
      responseFormatFor,
      rungRejected,
    } = await import('../_shared/reports/propertyComparison/analysisRequest.pure.ts');
    type Rung = Parameters<typeof responseFormatFor>[0];

    const systemPrompt = (
      await (await import('../_shared/engine-prompts.ts')).resolvePrompt('comparison.cash_flow_system')
    ).text;

    const formatFor = (rung: Rung): Record<string, unknown> | undefined => {
      if (rung === 'json_schema') {
        return {
          type: 'json_schema',
          json_schema: {
            name: 'cash_flow_comparison_analysis',
            schema: CASH_FLOW_ANALYSIS_SCHEMA,
          },
        };
      }
      return responseFormatFor(rung);
    };

    let rung: Rung = 'json_schema';
    let reading: CashFlowAnalysisReading | null = null;
    let lastFailure = { status: 502, body: { error: 'AI analysis failed' } as Record<string, unknown> };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const timeoutMs = attemptTimeoutMs(Date.now() - startTime);
      if (timeoutMs <= 0) {
        console.warn('[compare-cash-flow-reports] out of time before attempt', attempt + 1);
        break;
      }

      console.log(
        `[compare-cash-flow-reports] attempt ${attempt + 1}: rung=${rung} `
        + `tokens=${analysisTokens} timeout=${timeoutMs}ms`,
      );

      const aiResponse = await callLLMRaw({
        agentKey: 'cash_flow_comparison',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        // 4,000 was the number `normalise.pure.ts` and `CASH_FLOW_COMPARISON.md`
        // both recorded as the one to worry about, for an eight-section schema
        // whose budget is shared with a reasoning model's own thinking.
        maxTokens: analysisTokens,
        responseFormat: formatFor(rung),
        timeoutMs,
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error('[compare-cash-flow-reports] model error:', aiResponse.status, errorText);

        if (rungRejected(aiResponse.status, errorText)) {
          const next = nextRung(rung);
          if (next) {
            console.warn(`[compare-cash-flow-reports] provider refused ${rung}; dropping to ${next}`);
            rung = next;
            continue;
          }
        }

        if (aiResponse.status === 429) {
          return new Response(
            JSON.stringify({ error: 'Rate limit exceeded', details: 'Too many requests. Please wait a moment and try again.' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (aiResponse.status === 402) {
          return new Response(
            JSON.stringify({ error: 'Payment required', details: 'AI credits exhausted. Please add credits to your Lovable workspace.' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ error: 'AI analysis failed', details: errorText }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const aiData = await aiResponse.json();
      // Guarded. Reading the first choice without checking there is one threw
      // a TypeError on any answer that carried none, and the handler's catch
      // reported that as "Internal server error" — a different wrong sentence
      // for the same event.
      const analysisText: string = aiData?.choices?.[0]?.message?.content ?? '';
      const finishReason: string | undefined = aiData?.choices?.[0]?.finish_reason;

      // `readModelJson` rather than a fence regex of our own. The regex here
      // required a CLOSING fence, so a cut-off answer — which has neither a
      // closing fence nor a closing brace — was handed to `JSON.parse` with the
      // opening fence still attached, and the SyntaxError about a backtick was
      // reported to the adviser as "Failed to parse AI analysis".
      const parsed = readModelJson<Record<string, unknown>>(analysisText, finishReason);

      if (parsed.ok) {
        const candidate = classifyCashFlowAnalysis(parsed.value);
        if (candidate.status !== 'unusable') {
          reading = candidate;
          break;
        }
        console.error(
          `[compare-cash-flow-reports] unusable answer (${candidate.reason}):`,
          analysisText.slice(0, 400),
        );
        lastFailure = {
          status: 502,
          body: { error: `The analysis could not be used — ${candidate.reason}.`, reason: 'unusable' },
        };
      } else {
        console.error(
          `[compare-cash-flow-reports] ${parsed.reason} (finish_reason=${finishReason ?? 'unknown'}):`,
          analysisText.slice(0, 400),
        );
        lastFailure = {
          status: 502,
          body: { error: parsed.message, reason: parsed.reason },
        };
      }

      // A shape that came back wrong is worth asking for more firmly, once.
      const next = nextRung(rung);
      if (!next) break;
      rung = next;
    }

    if (!reading) {
      return new Response(
        JSON.stringify(lastFailure.body),
        { status: lastFailure.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const analysis = reading.analysis;

    const processingTime = Date.now() - startTime;
    console.log(`Cash flow comparison analysis completed in ${processingTime}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        propertyCount: reports.length,
        investorProfile,
        analysis,
        // A partial answer is a normal arrival and is never presented as a
        // whole one: the sections that did not come back travel with it, so the
        // panel can say so rather than quietly drawing four blocks of eight.
        status: reading.status,
        missingSections: reading.missing,
        processingTimeMs: processingTime
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in compare-cash-flow-reports:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'compare-cash-flow-reports'), error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
