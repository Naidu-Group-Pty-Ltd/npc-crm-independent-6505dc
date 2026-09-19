import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withReportMetering, resolveUserId, buildIdempotencyKey } from '../_shared/reportMetering.ts';
import { reconcileStoredFinancials } from '../_shared/reports/investment/financialEngine.pure.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

/**
 * The analysis loop's wall-clock bounds live in
 * `_shared/reports/propertyComparison/analysisRequest.pure.ts`
 * (`ANALYSIS_BUDGET_MS` et al.), beside the request they bound.
 *
 * The binding ceiling is the BROWSER's, not the gateway's: the client aborts
 * at 150s, and `resolveAnalysisDeadline` measures from the moment the metering
 * wrapper first saw the request — because auth, the price lookup and the
 * reserve run before this handler's clock starts, and on 2026-08-26 they took
 * 115 seconds between them. That run finished, stored its row and charged for
 * it nine seconds after the client had already given up.
 */

/**
 * How many times to ask.
 *
 * A response that is not an analysis is stochastic, so asking again is the
 * remedy — but the budget above is the real limit: at three properties a single
 * attempt has been observed at 75s, so in practice this bound is reached only on
 * the small, fast comparisons where a retry is free.
 */
const MAX_ANALYSIS_ATTEMPTS = 3;

type ComparableReportType = 'compass' | 'financial' | 'strategic' | 'snapshot' | 'briefing';
const comparableReportTypes = new Set<ComparableReportType>(['compass', 'financial', 'strategic', 'snapshot', 'briefing']);

// `report_tier` is the persisted canonical field. Do not infer comparison type
// from titles or presentation metadata in a request supplied by the browser.
const normalizeComparableReportType = (report: { report_tier?: unknown }): ComparableReportType | null => {
  const tier = typeof report.report_tier === 'string' ? report.report_tier.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  const aliases: Record<string, ComparableReportType> = {
    compass: 'compass', composite: 'compass', investment: 'compass', investment_report: 'compass', full: 'compass',
    financial: 'financial', fin: 'financial', financial_report: 'financial',
    strategic: 'strategic', strategy: 'strategic', pldd: 'strategic', property_level_due_diligence: 'strategic', due_diligence: 'strategic',
    snapshot: 'snapshot', snap: 'snapshot', snp: 'snapshot', overview: 'snapshot', quick_snapshot: 'snapshot',
    briefing: 'briefing', brief: 'briefing', brf: 'briefing', client_briefing: 'briefing',
  };
  const normalized = aliases[tier];
  return normalized && comparableReportTypes.has(normalized) ? normalized : null;
};

const __compareInvestmentReportsHandler = async (req: Request): Promise<Response> => {
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
      analysisDepth = 'comprehensive', 
      investorProfile = 'general',
      timeHorizon = '5-7 years',
      riskTolerance = 'moderate',
      customWeights,
      templateId
    } = body;

    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[compare-investment-reports] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    // Report Comparisons is a Growth/Scale capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabase, { userId, authMethod }, 'report-comparisons');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);
    console.log('[compare-investment-reports] Authenticated user:', userId);

    const weightKeys = ['growth', 'location', 'yield', 'demand', 'risk'];
    if (!customWeights || typeof customWeights !== 'object' ||
      weightKeys.some((key) => !Number.isInteger(customWeights[key]) || customWeights[key] < 0 || customWeights[key] > 100) ||
      weightKeys.reduce((total, key) => total + customWeights[key], 0) !== 100) {
      return new Response(JSON.stringify({ error: 'Applied scoring weights must contain five whole-number values totalling 100%.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!reportIds || !Array.isArray(reportIds) || reportIds.length < 2 || reportIds.length > 5) {
      return new Response(
        JSON.stringify({ error: 'Please provide 2-5 report IDs for comparison' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (new Set(reportIds).size !== reportIds.length || reportIds.some((id) => typeof id !== 'string' || !id.trim())) {
      return new Response(JSON.stringify({ error: 'Each selected report must be unique and valid' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Fetch all investment reports
    const { data: reports, error: fetchError } = await supabase
      .from('investment_reports')
      .select('*')
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

    if (reports.some((report) => report.is_archived || report.status !== 'completed')) {
      return new Response(JSON.stringify({ error: 'Selected reports must be active and completed' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const reportTypes = new Set(reports.map(normalizeComparableReportType));
    if (reportTypes.size !== 1 || reportTypes.has(null)) {
      return new Response(JSON.stringify({ error: 'Selected reports must all be the same report type.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const comparisonType = [...reportTypes][0] as ComparableReportType;

    console.log(`Comparing ${reports.length} properties...`);

    // Extract property addresses and determine states
    const propertyAddresses = reports.map(r => r.property_address);
    
    // Extract states from addresses with improved pattern matching
    const extractedStates = reports.map(r => {
      const address = r.property_address;
      
      // Try multiple patterns to extract state
      // Pattern 1: State code followed by postcode (e.g., "VIC 3000", "NSW 2000")
      let match = address.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+\d{4}\b/i);
      if (match) return match[1].toUpperCase();
      
      // Pattern 2: State code in parentheses or brackets (e.g., "(VIC)", "[WA]")
      match = address.match(/[\(\[](NSW|VIC|QLD|WA|SA|TAS|ACT|NT)[\)\]]/i);
      if (match) return match[1].toUpperCase();
      
      // Pattern 3: State code at end of address (e.g., "Street, Suburb VIC")
      match = address.match(/,\s*(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)$/i);
      if (match) return match[1].toUpperCase();
      
      // Pattern 4: Any occurrence of state code with word boundaries
      match = address.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i);
      if (match) return match[1].toUpperCase();
      
      // Try to extract from property_specs if available
      if (r.property_specs && typeof r.property_specs === 'object') {
        const specs = r.property_specs as any;
        if (specs.state) return specs.state.toUpperCase();
      }
      
      return null;
    }).filter(state => state !== null) as string[];
    
    // Get unique states, preserving empty array if no states found
    const propertyStates = extractedStates.length > 0 
      ? [...new Set(extractedStates)]
      : [];

    // Generate accurate report title
    const statesText = propertyStates.length === 0 
      ? 'MIXED STATES' 
      : propertyStates.length === 1 
        ? propertyStates[0]
        : propertyStates.join(' & ');
    
    // The family leads the title — "COMPASS COMPARISON ANALYSIS", "BRIEFING
    // COMPARISON ANALYSIS", "SNAPSHOT COMPARISON ANALYSIS" — so a stored row is
    // identifiable everywhere the title surfaces (library card, viewer, PDFs).
    // Nothing parses this string; existing rows keep their old titles.
    const reportTitle = `${comparisonType.toUpperCase()} COMPARISON ANALYSIS - ${reports.length} PROPERTIES, ${statesText}`;
    
    console.log(`Generated title: ${reportTitle}`);
    console.log(`Property states extracted: ${propertyStates.length > 0 ? propertyStates.join(', ') : 'none found'}`);

    // Structure data for AI analysis
    // IMPORTANT: investment_reports stores nested JSONB. Field paths verified 2026-05-19:
    //   financial_calculations.initialCosts.{propertyValue, buildPrice, landPrice, loanAmount, stampDuty, lmi, totalUpfront, deposit, lvr}
    //   financial_calculations.income.weeklyRent
    //   financial_calculations.keyMetrics.{grossRentalYield, netRentalYield, weeklyNet, annualNet, cashOnCashReturn, totalInvestment, lvr}
    //   financial_calculations.loanDetails.{interestRate, monthlyPayment, weeklyPayment, loanType, lvrTier, totalInterest}
    //   financial_calculations.projections.{conservative,moderate,optimistic}[year-1].{annualRent,cashFlow,equity,propertyValue,roi}
    //   financial_calculations.assumptions.{capitalGrowth, occupancyWeeks}
    //   investment_score.{totalScore, grade, recommendation, strengths[], weaknesses[], risks[], opportunities[]}
    //   investment_score.breakdown.{yieldScore,growthScore,locationScore,demandScore,riskScore}.{score,weight,details}
    const propertiesData = reports.map((report, index) => {
      const investmentScore: any = (typeof report.investment_score === 'object' && report.investment_score !== null) ? report.investment_score : {};
      const breakdown: any = investmentScore.breakdown || {};
      // Read-boundary heal (audit F26): the comparison reasons over figures
      // the row stores, and a historic row's projections were folded against
      // triple-charged operating costs. Reconcile before anything reads them.
      const financials: any = (typeof report.financial_calculations === 'object' && report.financial_calculations !== null)
        ? reconcileStoredFinancials(report.financial_calculations).fin ?? {}
        : {};
      const initialCosts: any = financials.initialCosts || {};
      const income: any = financials.income || {};
      const keyMetrics: any = financials.keyMetrics || {};
      const loanDetails: any = financials.loanDetails || {};
      const projections: any = financials.projections || {};
      const moderate: any[] = Array.isArray(projections.moderate) ? projections.moderate : [];
      const assumptions: any = financials.assumptions || {};
      const demographics: any = (typeof report.demographics_data === 'object' && report.demographics_data !== null) ? report.demographics_data : {};
      const location: any = (typeof report.location_intelligence === 'object' && report.location_intelligence !== null) ? report.location_intelligence : {};
      const economics: any = (typeof report.economic_data === 'object' && report.economic_data !== null) ? report.economic_data : {};

      // Derive missing values from real data
      const weeklyRent = income.weeklyRent ?? null;
      const occupancyWeeks = assumptions.occupancyWeeks ?? 50;
      const annualRent = weeklyRent != null ? Math.round(weeklyRent * occupancyWeeks) : null;
      const weeklyNet = keyMetrics.weeklyNet ?? null;
      // Monthly cash flow derived using exact 52/12 multiplier (project standard)
      const monthlyCashFlow = weeklyNet != null ? Math.round(weeklyNet * (52 / 12)) : null;
      const year5 = moderate.find((y) => y?.year === 5) || moderate[4] || null;
      const year10 = moderate.find((y) => y?.year === 10) || moderate[9] || null;

      // Trim reportText aggressively — it must NOT be the source of differentiation.
      // We keep a small slice only as a last-resort context hint.
      const reportText = (report.report_content || '').substring(0, 800);

      return {
        propertyNumber: index + 1,
        address: report.property_address,
        reportTextSnippet: reportText,

        // Investment Scoring (from real schema)
        overallScore: investmentScore.totalScore ?? null,
        letterGrade: investmentScore.grade ?? null,
        recommendation: investmentScore.recommendation ?? null,
        scoreBreakdown: {
          yield: breakdown.yieldScore?.score ?? null,
          growth: breakdown.growthScore?.score ?? null,
          location: breakdown.locationScore?.score ?? null,
          demand: breakdown.demandScore?.score ?? null,
          risk: breakdown.riskScore?.score ?? null,
        },
        scoreDetails: {
          yield: breakdown.yieldScore?.details ?? null,
          growth: breakdown.growthScore?.details ?? null,
          location: breakdown.locationScore?.details ?? null,
          demand: breakdown.demandScore?.details ?? null,
          risk: breakdown.riskScore?.details ?? null,
        },

        // Financial Metrics (from nested schema)
        financialMetrics: {
          purchasePrice: initialCosts.propertyValue ?? null,
          buildPrice: initialCosts.buildPrice ?? null,
          landPrice: initialCosts.landPrice ?? null,
          loanAmount: initialCosts.loanAmount ?? loanDetails.loanAmount ?? null,
          lvr: keyMetrics.lvr ?? loanDetails.lvr ?? initialCosts.lvr ?? null,
          stampDuty: initialCosts.stampDuty ?? null,
          lmi: initialCosts.lmi ?? null,
          totalUpfront: initialCosts.totalUpfront ?? null,
          weeklyRent,
          annualRent,
          grossRentalYield: keyMetrics.grossRentalYield ?? null,
          netRentalYield: keyMetrics.netRentalYield ?? null,
          weeklyNet,
          annualNet: keyMetrics.annualNet ?? null,
          monthlyCashFlow,
          cashOnCashReturn: keyMetrics.cashOnCashReturn ?? null,
          interestRate: loanDetails.interestRate ?? null,
          weeklyLoanPayment: loanDetails.weeklyPayment ?? null,
          capitalGrowthAssumption: assumptions.capitalGrowth ?? null,
          year5: year5 ? {
            cashFlow: year5.cashFlow ?? null,
            equity: year5.equity ?? null,
            propertyValue: year5.propertyValue ?? null,
            roi: year5.roi ?? null,
          } : null,
          year10: year10 ? {
            cashFlow: year10.cashFlow ?? null,
            equity: year10.equity ?? null,
            propertyValue: year10.propertyValue ?? null,
            roi: year10.roi ?? null,
            cumulativeCashFlow: year10.cumulativeCashFlow ?? null,
          } : null,
        },

        // Location Intelligence
        //
        // S2 — `walkScore` is withheld here, not absent from the record.
        // The Client-Safe Gate disowns it (`DISOWNED_LOCATION_PATHS`) as a
        // bespoke composite published under a third party's product name, and
        // it stopped reaching this payload only because the generator used to
        // persist the GATED enrichment. The record now keeps what was measured
        // so Location can be scored, which puts the field back within reach of
        // this projection — so the gate is applied here instead, at the
        // boundary where a model is handed the figure. `transitScore` and the
        // three counts below are not disowned; they are simply absent from
        // every enrichment this platform writes, and a null is the honest
        // reading for a field nothing fills.
        locationData: {
          walkScore: null,
          transitScore: location.transitScore ?? null,
          schoolRating: location.averageSchoolRating ?? null,
          nearbySchools: location.schoolsNearby ?? null,
          amenitiesCount: location.amenitiesNearby ?? null,
          distanceToCity: location.distanceToCity ?? null,
        },

        // Demographics (often null — surface as N/A, do NOT fabricate)
        demographics: {
          population: demographics.population ?? null,
          medianIncome: demographics.medianIncome ?? null,
          medianAge: demographics.medianAge ?? null,
          employmentRate: demographics.employmentRate ?? null,
          housingAffordability: demographics.housingAffordability ?? null,
        },

        // Qualitative — from real schema (no swotAnalysis nesting)
        risks: Array.isArray(investmentScore.risks) ? investmentScore.risks : [],
        strengths: Array.isArray(investmentScore.strengths) ? investmentScore.strengths : [],
        weaknesses: Array.isArray(investmentScore.weaknesses) ? investmentScore.weaknesses : [],
        opportunities: Array.isArray(investmentScore.opportunities) ? investmentScore.opportunities : [],

        // Market Data
        marketData: {
          vacancyRate: economics.vacancyRate ?? null,
          supplyGrowth: economics.supplyGrowth ?? null,
          interestRate: economics.cashRate ?? null,
        },
      };
    });

    const prompt = `You are an expert Australian property investment analyst comparing ${reports.length} investment properties for a client.

**REPORT METADATA:**
- Properties: ${propertyAddresses.join(' | ')}
- States: ${propertyStates.join(', ')}
- Report Title: ${reportTitle}

**CRITICAL STRUCTURE REQUIREMENTS:**
This comparison MUST contain ALL of the following 10 sections in exact order. Missing sections will cause report rejection:
1. EXECUTIVE SUMMARY (2-3 paragraphs)
2. OVERALL RANKINGS (complete table with all properties)
3. FINANCIAL PERFORMANCE COMPARISON (4 sub-sections: yield, cash flow, ROI, value)
4. LOCATION INTELLIGENCE COMPARISON (4 sub-sections: infrastructure, growth corridor, schools, lifestyle)
5. RISK-ADJUSTED RECOMMENDATIONS (risk levels for all properties)
6. INVESTOR PROFILE MATCHING (match each property to investor types)
7. MARKET TIMING & STRATEGY (buy order, holding periods, exit strategies)
8. COMPETITIVE ADVANTAGES (3-5 advantages per property)
9. RED FLAGS & CONCERNS (specific concerns per property with severity ratings)
10. FINAL RECOMMENDATION (best overall, runners-up, properties to avoid/reconsider)

    **DATA QUALITY INSTRUCTIONS:**
    - **SCORING SCALE**: ALL finalScore values MUST be on a 0-100 scale (e.g., 85.2, not 8.5). PREFER the overallScore provided in the data. If overallScore is null, compute from scoreBreakdown using standard weights (yield 15, growth 40, location 25, demand 15, risk 5) — never invent.
    - **STRICT GROUNDING**: Every numeric claim MUST come from structured fields under financialMetrics / scoreBreakdown / scoreDetails / locationData. If a field is null, write "Data unavailable" — do NOT estimate or back-fill from reportTextSnippet.
    - **NO PARAPHRASING**: reportTextSnippet is context only. You MUST NOT copy, paraphrase, or restate it across multiple properties. Differentiate properties ONLY on structured metric differences (purchasePrice, grossRentalYield, weeklyNet, monthlyCashFlow, year5/year10 roi, scoreBreakdown deltas, schoolRating, lvr, interestRate, capitalGrowthAssumption).
    - **TIED SCORES**: If two or more properties share the same overallScore, do NOT duplicate strengths/concerns text. Explicitly note the tie and differentiate on underlying scoreBreakdown numbers and financialMetrics deltas (e.g. "Ties Property 3 on overall but leads on grossRentalYield 4.31% vs 3.82%").
    - **DIFFERENTIATION REQUIREMENT**: primaryStrengths, primaryConcerns, competitiveAdvantages and redFlags MUST be unique per property. Cite the specific numeric metric that justifies each bullet (e.g. "Strong yield 4.31% gross vs basket avg 3.95%"). Generic statements that could apply to every property are forbidden.
    - **MISSING DATA**: If demographics or marketData fields are null, omit them. Do not fabricate medianIncome, vacancyRate, etc.
    ${customWeights ? `- **CUSTOM SCORING WEIGHTS**: Apply these custom weights when ranking: Growth ${customWeights.growth}%, Location ${customWeights.location}%, Yield ${customWeights.yield}%, Demand ${customWeights.demand}%, Risk ${customWeights.risk}%` : ''}
    
    **ANALYSIS DEPTH:** ${analysisDepth}
    **INVESTOR PROFILE:** ${investorProfile}
    **TIME HORIZON:** ${timeHorizon}
    **RISK TOLERANCE:** ${riskTolerance}
    ${customWeights ? `**CUSTOM WEIGHTS:** Growth ${customWeights.growth}%, Location ${customWeights.location}%, Yield ${customWeights.yield}%, Demand ${customWeights.demand}%, Risk ${customWeights.risk}%` : ''}

    **PROPERTIES TO COMPARE:**
    ${JSON.stringify(propertiesData, null, 2)}

Provide a detailed comparative analysis including:

1. EXECUTIVE SUMMARY (2-3 paragraphs)
   - Quick overview of the comparison
   - Key finding and top recommendation
   - Critical factors that differentiate these properties

2. OVERALL RANKINGS
   For each property, provide:
   - Final rank (1st, 2nd, 3rd, etc.)
   - Final score (MUST be 0-100 scale - use the overallScore provided in data when available, or calculate based on comprehensive analysis)
   - Primary strengths (3-5 key strengths)
   - Primary concerns (3-5 key concerns)
   - Best suited for (specific investor type)

3. FINANCIAL PERFORMANCE COMPARISON
   - Which property offers best rental yield?
   - Which has strongest cash flow?
   - Which has best ROI projections?
   - Which offers best value for money?
   - Compare entry costs vs expected returns

4. LOCATION INTELLIGENCE COMPARISON
   - Which location has best infrastructure?
   - Which is in the strongest growth corridor?
   - Which has best schools and amenities?
   - Which has best lifestyle factors?
   - Compare accessibility and convenience

5. RISK-ADJUSTED RECOMMENDATIONS
   - Rank properties by risk level (low to high)
   - Identify specific risks for each property
   - Which property is safest for conservative investors?
   - Which offers best risk/reward balance?

6. INVESTOR PROFILE MATCHING
   For each property, identify the ideal investor:
   - Cash Flow Focused Investor
   - Capital Growth Investor
   - Balanced Portfolio Investor
   - First-Time Investor
   - Experienced Investor

7. MARKET TIMING & STRATEGY
   - Which property to prioritize (buy first)?
   - Recommended holding periods for each
   - Exit strategy considerations
   - Portfolio sequencing if buying multiple

8. COMPETITIVE ADVANTAGES
   For each property, list 3-5 unique selling points or competitive advantages

9. RED FLAGS & CONCERNS
   For each property, identify potential deal-breakers or areas requiring due diligence

10. FINAL RECOMMENDATION
    - Which is THE best property overall and why?
    - Which are close runner-ups?
    - Which to avoid or reconsider?
    - Alternative scenarios: "If your goal is X, then choose Y"

Format your response as valid JSON with this structure:
{
  "executiveSummary": "string",
  "rankings": [
    {
      "propertyNumber": number,
      "address": "string",
      "rank": number,
      "finalScore": number (CRITICAL: Must be 0-100 scale. Use overallScore from data when available, or calculate comprehensively. Example: 85.5, not 8.5),
      "primaryStrengths": ["string", "string", "string"],
      "primaryConcerns": ["string", "string", "string"],
      "bestSuitedFor": "string"
    }
  ],
  "financialComparison": {
    "bestYield": { "propertyNumber": number, "value": "string", "reason": "string" },
    "bestCashFlow": { "propertyNumber": number, "value": "string", "reason": "string" },
    "bestROI": { "propertyNumber": number, "value": "string", "reason": "string" },
    "bestValue": { "propertyNumber": number, "reason": "string" }
  },
  "locationComparison": {
    "bestInfrastructure": { "propertyNumber": number, "reason": "string" },
    "bestGrowthCorridor": { "propertyNumber": number, "reason": "string" },
    "bestSchools": { "propertyNumber": number, "reason": "string" },
    "bestLifestyle": { "propertyNumber": number, "reason": "string" }
  },
  "riskComparison": {
    "lowestRisk": { "propertyNumber": number, "reason": "string" },
    "highestRisk": { "propertyNumber": number, "reason": "string" },
    "bestRiskReward": { "propertyNumber": number, "reason": "string" },
    "riskLevels": [{ "propertyNumber": number, "riskLevel": "string", "specificRisks": ["string"] }]
  },
  "investorMatches": [
    {
      "propertyNumber": number,
      "investorTypes": ["string"],
      "reasoning": "string"
    }
  ],
  "marketTiming": {
    "buyFirst": { "propertyNumber": number, "reason": "string" },
    "holdingPeriods": [{ "propertyNumber": number, "recommendedPeriod": "string", "reason": "string" }],
    "exitStrategies": [{ "propertyNumber": number, "strategy": "string" }]
  },
  "competitiveAdvantages": [
    {
      "propertyNumber": number,
      "advantages": ["string"]
    }
  ],
  "redFlags": [
    {
      "propertyNumber": number,
      "concerns": ["string"],
      "severity": "string"
    }
  ],
  "finalRecommendation": {
    "bestOverall": { "propertyNumber": number, "reason": "string" },
    "runners": [{ "propertyNumber": number, "reason": "string" }],
    "avoid": [{ "propertyNumber": number, "reason": "string" }],
    "alternativeScenarios": [{ "scenario": "string", "recommendation": number, "reason": "string" }]
  }
}`;

    // ── Ask the model, and read what came back ────────────────────────────
    //
    // Three things used to go wrong here, and each one alone left a client with
    // a report missing nine of its ten sections — 30 of the 53 stored
    // comparisons, including the most recent.
    //
    //  * The budget was a flat `maxTokens: 12000` shared with the model's own
    //    reasoning. `report_comparison` is assigned a thinking model, which
    //    spends thousands of that allowance before it writes a character, so the
    //    answer was cut off. The damage tracked the property count exactly — 0
    //    of 7 two-property comparisons, 16 of 17 five-property ones — which is
    //    an output ceiling, not a model that could not answer.
    //  * Nothing asked for JSON except the prose. 8 stored rows still carry a
    //    fence and 4 close their own brace and still do not parse.
    //  * Every one of those outcomes was stored as a success: 200,
    //    `success: true`, seven NULL columns, no retry and nothing said.
    //
    // The shape is now asked for as a schema, the room is fitted to the job, a
    // response that is not an analysis is a failed attempt rather than a stored
    // document, and what is stored is always one of the two shapes the readers
    // know. `analysisRequest.pure.ts` carries the reasoning for each.
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const { resolvePrompt } = await import('../_shared/engine-prompts.ts');
    const {
      comparisonOutputTokens,
      nextRung,
      preferReading,
      readAnalysisResponse,
      resolveAnalysisDeadline,
      responseFormatFor,
      rungRejected,
    } = await import('../_shared/reports/propertyComparison/analysisRequest.pure.ts');
    type Rung = 'json_schema' | 'json_object' | 'none';
    type Reading = ReturnType<typeof readAnalysisResponse>;

    const systemPrompt = (await resolvePrompt('comparison.report_system')).text;
    const outputTokens = comparisonOutputTokens(reports.length);

    const deadline = resolveAnalysisDeadline(
      startTime,
      req.headers.get('x-metering-received-at'),
    );
    if (deadline.preHandlerMs > 15_000) {
      console.warn(
        `[comparison] ${Math.round(deadline.preHandlerMs / 1000)}s elapsed before the handler `
        + `started (metering/auth); ${Math.round(deadline.roomMs / 1000)}s left for the analysis`
      );
    }
    // A run whose answer cannot reach the browser is worse than a refusal: it
    // is generated, stored and charged, and the person who asked is told it
    // timed out. Refuse instead — `success: false` releases the reservation,
    // so this costs the caller nothing and says what to do.
    if (deadline.tooLate) {
      console.error(
        `[comparison] refusing to start: ${Math.round(deadline.preHandlerMs / 1000)}s was spent `
        + `before the handler and only ${Math.round(deadline.roomMs / 1000)}s remains`
      );
      return new Response(
        JSON.stringify({
          success: false,
          retryable: true,
          error: 'The billing service is responding slowly and there is no longer enough time '
            + 'to produce this comparison in this request. You have not been charged — please try again.',
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const deadlineAt = deadline.deadlineAt;

    console.log(
      `Calling the comparison model for ${reports.length} properties `
      + `(up to ${outputTokens} output tokens, ${Math.round(deadline.roomMs / 1000)}s budget)...`
    );

    let rung: Rung = 'json_schema';
    let best: Reading | null = null;
    let bestText = '';
    let attempts = 0;
    let lastError = '';

    // Bounded three ways — attempts, the wall clock, and the ladder — so the
    // loop cannot fail to end and cannot outlive the invocation around it.
    while (attempts < MAX_ANALYSIS_ATTEMPTS && Date.now() < deadlineAt) {
      const attemptStartedAt = Date.now();
      const remainingMs = deadlineAt - attemptStartedAt;

      let aiResponse: Awaited<ReturnType<typeof callLLMRaw>>;
      try {
        aiResponse = await callLLMRaw({
          agentKey: 'report_comparison',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          // The model, its temperature and its reasoning effort stay the
          // operator's, from `agent_model_assignments`. Only the room the answer
          // needs is decided here, because only this side knows how much of a
          // document is being asked for.
          maxTokens: outputTokens,
          responseFormat: responseFormatFor(rung),
          // A hung provider must not eat the invocation: the guard that would
          // have caught it has to run inside the time it is guarding. The floor
          // wins when the budget is nearly spent — a timeout shorter than the
          // shortest useful call aborts a request that was going to succeed, and
          // the overrun it allows is bounded by the floor itself.
          timeoutMs: Math.max(20_000, remainingMs),
          deadlineAt,
        });
      } catch (fetchErr) {
        lastError = fetchErr instanceof Error ? fetchErr.message : 'Unknown fetch error';
        console.error(`[comparison] provider call threw (attempt ${attempts + 1}):`, lastError);
        attempts += 1;
        if (attempts >= MAX_ANALYSIS_ATTEMPTS || Date.now() >= deadlineAt) break;
        continue;
      }

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();

        // A provider that cannot do this response_format is a fact about the
        // provider, not about the request: drop one rung of the guarantee and
        // ask again. It does not spend an attempt, because nothing was
        // generated. Capacity, credit and health are deliberately excluded —
        // weakening the schema for a 429 would quietly degrade every later call.
        if (rungRejected(aiResponse.status, errorText)) {
          const next = nextRung(rung);
          if (next) {
            console.warn(
              `[comparison] provider refused response_format '${rung}' `
              + `(${aiResponse.status}); falling back to '${next}'`
            );
            rung = next;
            continue;
          }
        }

        if (aiResponse.status === 429) {
          attempts += 1;
          const backoffMs = attempts * 3000;
          if (attempts < MAX_ANALYSIS_ATTEMPTS && Date.now() + backoffMs < deadlineAt) {
            console.log(`[comparison] rate limited, retrying in ${backoffMs / 1000}s...`);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
          return new Response(
            JSON.stringify({ success: false, error: 'Rate limit exceeded. Please wait a moment and try again.' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (aiResponse.status === 402) {
          return new Response(
            JSON.stringify({ success: false, error: 'AI credits exhausted. Please add credits to your Lovable workspace.' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        lastError = errorText;
        console.error(`[comparison] provider error (attempt ${attempts + 1}):`, aiResponse.status, errorText);
        attempts += 1;
        if (attempts >= MAX_ANALYSIS_ATTEMPTS || Date.now() >= deadlineAt) break;
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      attempts += 1;
      const aiData = await aiResponse.json();
      const analysisText = aiData?.choices?.[0]?.message?.content;
      const reading = readAnalysisResponse(analysisText);
      if (preferReading(best, reading) === reading) {
        best = reading;
        bestText = typeof analysisText === 'string' ? analysisText : '';
      }

      if (reading.status === 'complete') break;

      lastError = reading.reason
        || `the model returned ${reading.present.length} of ${reading.present.length + reading.missing.length} sections`;
      console.warn(
        `[comparison] attempt ${attempts} was ${reading.status}: ${lastError}`
        + (reading.missing.length ? ` (missing: ${reading.missing.join(', ')})` : '')
      );

      // A rung that produced nothing usable is suspect. Some gateways accept a
      // `response_format` they cannot actually honour and answer anyway, and
      // that failure is indistinguishable from a bad answer — so weaken the ask
      // before spending another attempt on it. The worst case of an unsupported
      // schema is then the behaviour this function had before, never the loss of
      // the comparison itself.
      if (reading.status === 'unusable') {
        const next = nextRung(rung);
        if (next) {
          console.warn(`[comparison] nothing usable under response_format '${rung}'; weakening to '${next}'`);
          rung = next;
        }
      }

      // Only start another attempt if one of this size still fits. A retry the
      // invocation cannot finish returns nothing at all, which is worse than the
      // partial answer already in hand.
      const attemptMs = Date.now() - attemptStartedAt;
      if (Date.now() + attemptMs >= deadlineAt) {
        console.warn('[comparison] no room in the budget for another attempt; keeping the best answer so far');
        break;
      }
    }

    // Nothing usable came back. Return a failure rather than storing a row that
    // says a comparison exists: `decideMeteringOutcome` releases the reservation
    // on a body like this, so a comparison that could not be produced costs the
    // caller nothing — and no phantom appears in the library.
    if (!best || best.status === 'unusable') {
      const why = best?.reason || lastError || 'the model did not return a usable comparison';
      console.error('[comparison] no usable analysis after', attempts, 'attempt(s):', why);
      return new Response(
        JSON.stringify({
          success: false,
          error: `The comparison could not be produced: ${why}. Please try again.`,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const analysis = best.analysis as Record<string, any>;

    // ── Which shape this row is stored in ─────────────────────────────────
    //
    // There are two, and the readers — `normalise.pure.ts` for the typeset PDF,
    // the viewer, the legacy formatter — decide between them by looking at the
    // columns. A row that is neither is what made the newest comparison in the
    // table unreadable by all three, so the choice is made here, once.
    //
    //   columns  the response parsed whole. A section that is absent is
    //            ordinary absence — the analysis had nothing to say — and the
    //            document drops it silently, as the other formats do.
    //   raw      the response did not parse whole. The model's own text is kept
    //            intact so `salvage.pure.ts` can read it back, and the document
    //            names what was lost rather than quietly printing less.
    //
    // Never a parsed fragment with NULL columns: that is neither shape, and it
    // is what one attempt in three produced.
    const storeRaw = best.status === 'partial' && best.truncated && bestText.trim() !== '';
    if (storeRaw) {
      console.warn(
        `[comparison] storing the raw response for recovery — read back `
        + `${best.present.length} section(s), missing: ${best.missing.join(', ') || 'none'}`
      );
    } else {
      console.log(
        `[comparison] analysis ${best.status} — ${best.present.length} section(s) stored`
        + (best.missing.length ? `, absent: ${best.missing.join(', ')}` : '')
      );
    }

    const processingTime = Date.now() - startTime;

    // Get user ID for created_by field - reuse userId from verifyAuth above
    let createdByUserId: string | null = userId || null;

    // Store comparison in database with metadata
    const { data: comparisonData, error: insertError } = await supabase
      .from('property_comparisons')
      .insert({
        report_ids: reportIds,
        property_count: reports.length,
        property_addresses: propertyAddresses,
        property_states: propertyStates,
        report_title: reportTitle,
        comparison_type: comparisonType,
        structure_version: 1,
        // On the raw path every structured column stays NULL on purpose: that is
        // what tells `normalise.pure.ts` to salvage `executive_summary` and
        // report what it could not read, instead of printing a shorter document
        // and calling it whole.
        executive_summary: storeRaw
          ? bestText
          : (typeof analysis.executiveSummary === 'string' ? analysis.executiveSummary.trim() : null),
        rankings: storeRaw ? null : analysis.rankings,
        financial_comparison: storeRaw ? null : analysis.financialComparison,
        location_comparison: storeRaw ? null : analysis.locationComparison,
        risk_comparison: storeRaw ? null : analysis.riskComparison,
        investor_matches: storeRaw ? null : analysis.investorMatches,
        // The producer names this section two ways; `readAnalysisResponse` has
        // already folded `finalRecommendation` into the name the column uses.
        recommendations: storeRaw ? null : analysis.recommendations,
        red_flags: storeRaw ? null : analysis.redFlags,
        analysis_depth: analysisDepth,
        investor_profile: investorProfile,
        created_by: userId,
        model_used: 'google/gemini-2.5-flash',
        processing_time_ms: processingTime,
        analysis_summary: JSON.stringify({
          timeHorizon,
          riskTolerance,
          customWeights,
          templateId: typeof templateId === 'string' ? templateId : null
        })
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error storing comparison:', insertError);
      console.error('Insert error details:', JSON.stringify(insertError, null, 2));
    }

    console.log(`Comparison completed in ${processingTime}ms`);

    // `incomplete` / `missingSections` rather than `isComplete: false`: the
    // metering wrapper reads that flag as "one chunk of a longer run landed" and
    // HOLDS the reservation open. This run is over either way, so it commits —
    // the caller received a document, and the only question the browser still
    // has is whether to say a section is absent.
    return new Response(
      JSON.stringify({
        success: true,
        comparisonId: comparisonData?.id,
        propertyCount: reports.length,
        analysis,
        ...(best.status === 'complete' ? {} : {
          incomplete: true,
          missingSections: best.missing,
          recoveredSections: best.present,
          truncated: best.truncated,
        }),
        processingTimeMs: processingTime
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Comparison error:', error);
    return new Response(
      JSON.stringify({ error: 'Unable to generate comparison. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

Deno.serve(withReportMetering(async (body, req) => {
  if (!body) return null;
  const userId = await resolveUserId(req, body);
  if (!userId) return null;
  const reportIds: string[] = Array.isArray(body?.reportIds) ? body.reportIds : [];
  return {
    kind: 'report.qualitative-regen' as const,
    userId,
    idempotencyKey: buildIdempotencyKey('compare-inv', [
      reportIds.slice().sort().join(','),
      body?.analysisDepth,
      body?.timeHorizon,
      body?.riskTolerance,
    ]),
    estimateOptions: { aiNarrative: true, multiplier: Math.max(1, reportIds.length) },
    requestPayload: {
      reportCount: reportIds.length,
      analysisDepth: body?.analysisDepth,
    },
  };
}, __compareInvestmentReportsHandler));
