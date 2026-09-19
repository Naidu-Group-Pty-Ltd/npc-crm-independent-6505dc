import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withReportMetering, resolveUserId, buildIdempotencyKey } from '../_shared/reportMetering.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { readModelJson } from '../_shared/llmJson.pure.ts';
import {
  impactFor,
  portfolioRateSensitivity,
  projectPortfolio,
  readProjectionScenario,
  sensitivityUnavailableText,
  type PortfolioLoanInput,
} from '../_shared/reports/portfolio/deterministicFacts.pure.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface ClientProperty {
  id: string;
  property_type: string;
  address: string;
  value: number | null;
  loan_remaining: number | null;
  interest_rate: number | null;
  ownership_percentage: number | null;
  monthly_interest_repayment: number | null;
  monthly_body_corporate: number | null;
  monthly_council_rates: number | null;
  monthly_water_rates: number | null;
  monthly_repairs_maintenance: number | null;
  monthly_property_management: number | null;
  monthly_landlord_insurance: number | null;
  monthly_building_insurance: number | null;
  monthly_rental_income: number | null;
  weekly_rental_income: number | null;
  total_monthly_expenditure: number | null;
  net_monthly_cashflow: number | null;
  loan_repayment_amount: number | null;
  loan_repayment_frequency: string | null;
  lender_name: string | null;
  // Fetched by `select('*')` and read by the deterministic facts helper. It
  // was absent from this interface while the row carried it, which is how the
  // repayment structure stayed invisible to everything typed.
  repayment_type: string | null;
}

interface ClientData {
  id: string;
  primary_first_name: string;
  primary_surname: string;
  secondary_first_name: string | null;
  secondary_surname: string | null;
  marital_status: string | null;
  dependents_count: number | null;
  primary_email: string | null;
  primary_mobile: string | null;
  current_address: string | null;
  living_situation: string | null;
  total_portfolio_value: number | null;
  total_debt: number | null;
  total_monthly_income: number | null;
  total_monthly_expenditure: number | null;
  total_monthly_rental_income: number | null;
  net_monthly_cash_flow: number | null;
  borrowing_capacity: number | null;
  equity_release: number | null;
}


/**
 * Ask for JSON as JSON, and fall back to asking in prose if the provider
 * refuses the field.
 *
 * `compare-investment-reports` learned this the hard way and built a ladder
 * for it: a provider that cannot do `response_format` answers 4xx naming the
 * field, and dropping the request is right — but ONLY for that reason. A 429,
 * a 402 or a 5xx is about capacity, credit or health, and retrying without the
 * format would answer a question nobody asked. `rungRejected` is that rule,
 * imported rather than restated.
 *
 * Without this, adding `response_format` to a path that is already broken
 * risks trading a truncated answer for no answer at all. The reader below
 * handles a fenced response either way, so the fallback loses nothing.
 */
async function callForJson(args: Record<string, unknown>) {
  const { callLLMRaw } = await import('../_shared/llmRouter.ts');
  const withFormat = await callLLMRaw({ ...args, responseFormat: { type: 'json_object' } } as any);
  if (withFormat.ok) return withFormat;

  const { rungRejected } = await import('../_shared/reports/propertyComparison/analysisRequest.pure.ts');
  const body = await withFormat.text().catch(() => '');
  if (!rungRejected(withFormat.status, body)) return withFormat;

  console.warn('[generate-portfolio-analysis] provider refused response_format; asking in prose');
  return await callLLMRaw(args as any);
}

const __portfolioHandler = async (req: Request): Promise<Response> => {
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
    // Initialize Supabase client first (needed for auth check)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { 
      clientId,
      // Audit item 10 — the AI Insights card on a client's AI tab.
      //
      // `'insights'` asks for the five short fields that card renders rather
      // than the fourteen-section review. It reuses everything below it:
      // the same authentication, the same portfolio-analysis entitlement, the
      // same server-side assembly of the client's properties and metrics, and
      // the same metered router call under the same agent key. Default
      // `'full'`, so every existing caller is untouched.
      mode = 'full',
      investorProfile = 'general',
      analysisDepth = 'comprehensive',
      includeProjections = true,
      projectionYears = 10,
      includeOwnerOccupied = true,
      // New configuration parameters
      analysisConfig = {},
      customInstructions = ''
    } = body;

    // Extract configuration settings with defaults
    const {
      riskTolerance = null,
      investmentStrategy = null,
      timeHorizon = null,
      growthRateAssumption = null,
      interestRateScenario = null,
      equityStrategy = null,
      debtReductionPriority = null,
      nextPropertyPreference = null,
      taxOptimizationPriority = null,
      retirementTimeline = null,
      marketOutlook = null
    } = analysisConfig;
    // SECURITY: Verify authentication (enforced - TODO removed)
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log(`[generate-portfolio-analysis] Auth failed for client ${clientId}:`, authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    } else {
      console.log(`[generate-portfolio-analysis] Authenticated user: ${userId}`);
    }

    // Portfolio Analysis is a Scale-or-add-on capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabase, { userId, authMethod }, 'portfolio-analysis');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    if (!clientId) {
      return new Response(
        JSON.stringify({ error: 'Client ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📊 Starting portfolio analysis for client: ${clientId}`);
    console.log(`📋 Received analysisConfig:`, JSON.stringify(analysisConfig));
    console.log(`📋 Extracted investor profile values:`, JSON.stringify({ riskTolerance, investmentStrategy, timeHorizon, growthRateAssumption, interestRateScenario, equityStrategy, debtReductionPriority, nextPropertyPreference, taxOptimizationPriority, retirementTimeline, marketOutlook }));

    // Fetch client data
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (clientError || !client) {
      console.error('Error fetching client:', clientError);
      return new Response(
        JSON.stringify({ error: 'Client not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch all client properties
    const { data: properties, error: propertiesError } = await supabase
      .from('client_properties')
      .select('*')
      .eq('client_id', clientId)
      .order('value', { ascending: false });

    if (propertiesError) {
      console.error('Error fetching properties:', propertiesError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch client properties' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!properties || properties.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No properties found for this client' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${properties.length} properties for analysis`);

    // Fetch all supplementary client financial data in parallel
    const [
      { data: incomeSources },
      { data: employment },
      { data: expenses },
      { data: liabilities },
      { data: assets },
      { data: additionalContacts },
      { data: bcDataArr },
    ] = await Promise.all([
      supabase.from('client_income_sources').select('*').eq('client_id', clientId).eq('is_active', true).order('display_order'),
      supabase.from('client_employment').select('*').eq('client_id', clientId).eq('is_current', true),
      supabase.from('client_expenses').select('*').eq('client_id', clientId),
      supabase.from('client_liabilities').select('*').eq('client_id', clientId),
      supabase.from('client_assets').select('*').eq('client_id', clientId),
      supabase.from('client_additional_contacts').select('*').eq('client_id', clientId).order('display_order'),
      supabase.from('borrowing_capacity_assessments').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(1),
    ]);

    const bcData = bcDataArr && bcDataArr.length > 0 ? bcDataArr[0] : null;

    console.log(`📋 Supplementary data fetched: ${incomeSources?.length || 0} income sources, ${employment?.length || 0} employment records, ${expenses?.length || 0} expenses, ${liabilities?.length || 0} liabilities, ${assets?.length || 0} assets, ${additionalContacts?.length || 0} additional contacts`);
    console.log(`Include owner-occupied in calculations: ${includeOwnerOccupied}`);


    // Helper to check if property is owner-occupied
    const isOwnerOccupied = (propertyType: string) => 
      propertyType?.toLowerCase() === 'owner_occupied' || 
      propertyType?.toLowerCase() === 'owner-occupied' ||
      propertyType?.toLowerCase() === 'ppor';

    // Helper to check if property is a rental (client is tenant)
    const isRentalProperty = (propertyType: string) =>
      propertyType?.toLowerCase() === 'rental';

    // Separate properties by type
    const investmentProperties = properties.filter(p => 
      !isOwnerOccupied(p.property_type) && !isRentalProperty(p.property_type)
    );
    const ownerOccupiedProperties = properties.filter(p => isOwnerOccupied(p.property_type));
    const rentalProperties = properties.filter(p => isRentalProperty(p.property_type));
    
    // Properties owned by client (excludes rental where they're a tenant)
    const ownedProperties = properties.filter(p => !isRentalProperty(p.property_type));
    
    // Determine which properties to include in portfolio totals (owned properties only)
    const propertiesForTotals = includeOwnerOccupied ? ownedProperties : investmentProperties;
    
    // Calculate personal expenses from rental properties
    const personalExpenses = {
      totalMonthlyRentPaid: rentalProperties.reduce((sum, p) => sum + (Number(p.monthly_rental_income) || 0), 0),
      rentalProperties: rentalProperties.map(p => ({
        address: p.address,
        monthlyRent: Number(p.monthly_rental_income) || 0,
        weeklyRent: Number(p.weekly_rental_income) || 0,
      })),
    };
    
    const portfolioMetrics = {
      totalProperties: ownedProperties.length,
      investmentCount: investmentProperties.length,
      ownerOccupiedCount: ownerOccupiedProperties.length,
      rentalCount: rentalProperties.length,
      includeOwnerOccupied,
      // Portfolio totals based on toggle (only owned properties)
      totalValue: propertiesForTotals.reduce((sum, p) => sum + (Number(p.value) || 0), 0),
      totalDebt: propertiesForTotals.reduce((sum, p) => sum + (Number(p.loan_remaining) || 0), 0),
      totalEquity: 0,
      averageLVR: 0,
      // Cash flow always from investment properties only
      totalMonthlyRentalIncome: investmentProperties.reduce((sum, p) => sum + (Number(p.monthly_rental_income) || 0), 0),
      totalMonthlyExpenses: propertiesForTotals.reduce((sum, p) => sum + (Number(p.total_monthly_expenditure) || 0), 0),
      netMonthlyCashflow: investmentProperties.reduce((sum, p) => sum + (Number(p.net_monthly_cashflow) || 0), 0),
      // Personal expenses (rent paid as tenant)
      personalExpenses,
      averageYield: 0,
      bestPerformer: null as ClientProperty | null,
      worstPerformer: null as ClientProperty | null,
    };

    portfolioMetrics.totalEquity = portfolioMetrics.totalValue - portfolioMetrics.totalDebt;
    portfolioMetrics.averageLVR = portfolioMetrics.totalValue > 0 
      ? (portfolioMetrics.totalDebt / portfolioMetrics.totalValue) * 100 
      : 0;

    // Calculate average yield for investment properties
    if (investmentProperties.length > 0) {
      const yields = investmentProperties
        .filter(p => p.value && p.weekly_rental_income)
        .map(p => (Number(p.weekly_rental_income) * 52 / Number(p.value)) * 100);
      portfolioMetrics.averageYield = yields.length > 0 
        ? yields.reduce((a, b) => a + b, 0) / yields.length 
        : 0;
    }

    // Find best and worst performers by net cashflow
    if (investmentProperties.length > 0) {
      const sortedByPerformance = [...investmentProperties].sort(
        (a, b) => (Number(b.net_monthly_cashflow) || 0) - (Number(a.net_monthly_cashflow) || 0)
      );
      portfolioMetrics.bestPerformer = sortedByPerformance[0];
      portfolioMetrics.worstPerformer = sortedByPerformance[sortedByPerformance.length - 1];
    }

    // Generate property-level analysis with property-type awareness
    const propertyAnalyses = properties.map((prop, index) => {
      const value = Number(prop.value) || 0;
      const loan = Number(prop.loan_remaining) || 0;
      const equity = value - loan;
      const lvr = value > 0 ? (loan / value) * 100 : 0;
      const ownerOccupied = isOwnerOccupied(prop.property_type);
      
      // Investment-specific metrics (only calculate for investment properties)
      const weeklyRent = ownerOccupied ? 0 : (Number(prop.weekly_rental_income) || 0);
      const annualRent = weeklyRent * 52;
      const grossYield = (!ownerOccupied && value > 0) ? (annualRent / value) * 100 : null;
      const monthlyIncome = ownerOccupied ? 0 : (Number(prop.monthly_rental_income) || 0);
      const monthlyExpenses = Number(prop.total_monthly_expenditure) || 0;
      // For owner-occupied: use actual net_monthly_cashflow from DB (includes loan repayments + expenses)
      // rather than hardcoding to zero — these are real outgoings the client has
      const netCashflow = Number(prop.net_monthly_cashflow) || 0;
      const cashOnCashReturn = (!ownerOccupied && equity > 0) ? ((netCashflow * 12) / equity) * 100 : null;

      return {
        propertyNumber: index + 1,
        address: prop.address,
        propertyType: prop.property_type,
        isOwnerOccupied: ownerOccupied,
        value,
        loan,
        equity,
        lvr: lvr.toFixed(1),
        ownershipPercentage: prop.ownership_percentage || 100,
        // Lender & repayment details
        lenderName: prop.lender_name || null,
        loanRepaymentAmount: prop.loan_repayment_amount || null,
        loanRepaymentFrequency: prop.loan_repayment_frequency || null,
        interestRate: prop.interest_rate || null,
        monthlyInterestRepayment: prop.monthly_interest_repayment || null,
        // For owner-occupied: yield/cash-on-cash are N/A, but expenses and cashflow are real
        grossYield: grossYield !== null ? grossYield.toFixed(2) : 'N/A',
        monthlyRentalIncome: ownerOccupied ? null : monthlyIncome,
        monthlyExpenses,
        netMonthlyCashflow: netCashflow,
        annualCashflow: netCashflow * 12,
        cashOnCashReturn: cashOnCashReturn !== null ? cashOnCashReturn.toFixed(2) : 'N/A',
        portfolioContribution: portfolioMetrics.totalValue > 0 
          ? ((value / portfolioMetrics.totalValue) * 100).toFixed(1) 
          : '0',
      };
    });

    // Build configuration context for the AI
    const configLabels: Record<string, Record<string, string>> = {
      riskTolerance: { conservative: 'Conservative', moderate: 'Moderate', aggressive: 'Aggressive' },
      investmentStrategy: { capital_growth: 'Capital Growth', cash_flow: 'Cash Flow', balanced: 'Balanced', wealth_accumulation: 'Wealth Accumulation' },
      timeHorizon: { short: 'Short-term (1-3 years)', medium: 'Medium-term (3-7 years)', long: 'Long-term (7-15 years)', multi_generational: 'Multi-generational (15+ years)' },
      growthRateAssumption: { conservative: 'Conservative (3-4%)', moderate: 'Moderate (5-6%)', optimistic: 'Optimistic (7-8%)' },
      interestRateScenario: { current: 'Current Rates', plus_1: '+1% Stress Test', plus_2: '+2% Stress Test' },
      equityStrategy: { aggressive: 'Aggressive Leveraging', moderate: 'Moderate Redeployment', conservative: 'Conservative (Low LVR)' },
      debtReductionPriority: { aggressive: 'Aggressive Paydown', interest_only: 'Interest-Only Focus', balanced: 'Balanced Approach' },
      nextPropertyPreference: { growth: 'Growth Suburbs', yield: 'High Yield Areas', regional: 'Regional Focus', metro: 'Metro Focus', none: 'No Recommendation Needed' },
      taxOptimizationPriority: { high: 'High (Maximize Deductions)', medium: 'Medium', low: 'Low (Focus on Cash Flow)' },
      marketOutlook: { bullish: 'Bullish', neutral: 'Neutral', bearish: 'Bearish' }
    };

    // Build configuration context string
    let configContext = '';
    if (riskTolerance) configContext += `- Risk Tolerance: ${configLabels.riskTolerance[riskTolerance]}\n`;
    if (investmentStrategy) configContext += `- Investment Strategy: ${configLabels.investmentStrategy[investmentStrategy]}\n`;
    if (timeHorizon) configContext += `- Time Horizon: ${configLabels.timeHorizon[timeHorizon]}\n`;
    if (growthRateAssumption) configContext += `- Growth Rate Assumption: ${configLabels.growthRateAssumption[growthRateAssumption]}\n`;
    if (interestRateScenario) configContext += `- Interest Rate Scenario: ${configLabels.interestRateScenario[interestRateScenario]}\n`;
    if (equityStrategy) configContext += `- Equity Strategy: ${configLabels.equityStrategy[equityStrategy]}\n`;
    if (debtReductionPriority) configContext += `- Debt Reduction Priority: ${configLabels.debtReductionPriority[debtReductionPriority]}\n`;
    if (nextPropertyPreference) configContext += `- Next Property Preference: ${configLabels.nextPropertyPreference[nextPropertyPreference]}\n`;
    if (taxOptimizationPriority) configContext += `- Tax Optimization Priority: ${configLabels.taxOptimizationPriority[taxOptimizationPriority]}\n`;
    if (retirementTimeline) configContext += `- Years Until Retirement: ${retirementTimeline} years\n`;
    if (marketOutlook) configContext += `- Market Outlook: ${configLabels.marketOutlook[marketOutlook]}\n`;

    console.log(`📋 Built configContext for prompt injection:`, configContext || '(empty - no investor profile values set)');

    // ========================================================================
    // DETERMINISTIC FACTS — computed here, and never asked of the model.
    //
    // Everything below comes from the record. The model is given these as
    // authoritative context and asked to EXPLAIN them; its JSON schema no
    // longer contains a field for any of them, so there is nothing to
    // overwrite and nothing to reconcile. See
    // `docs/reports/PORTFOLIO_TRUST_BOUNDARY.md`.
    // ========================================================================
    const toLoanInput = (p: ClientProperty): PortfolioLoanInput => ({
      loanRemaining: p.loan_remaining,
      interestRate: p.interest_rate,
      repaymentType: p.repayment_type,
      loanRepaymentAmount: p.loan_repayment_amount,
      loanRepaymentFrequency: p.loan_repayment_frequency,
    });

    const investmentSensitivity = portfolioRateSensitivity(investmentProperties.map(toLoanInput));
    const ownerOccupiedSensitivity = portfolioRateSensitivity(ownerOccupiedProperties.map(toLoanInput));

    const projection = projectPortfolio({
      currentPortfolioValue: portfolioMetrics.totalValue,
      currentDebt: portfolioMetrics.totalDebt,
      scenario: readProjectionScenario(growthRateAssumption),
      horizonYears: projectionYears,
    });
    // The prompt has always shown a growth percentage; it now shows the one the
    // arithmetic used rather than a second copy of the same intent.
    const growthRate = projection.assumptions.annualCapitalGrowthPercent;

    // Borrowing capacity: the assessment record already holds the deterministic
    // figures, so the model is not asked to restate them either. Absent
    // assessment means an absent block, not a zeroed one.
    const capacityFacts = bcData && Number.isFinite(Number(bcData.borrowing_capacity))
      ? (() => {
          const estimated = Number(bcData.borrowing_capacity);
          const deployed = portfolioMetrics.totalDebt;
          return {
            estimatedCapacity: Math.round(estimated),
            totalDebtDeployed: Math.round(deployed),
            availableCapacity: Math.round(estimated - deployed),
            utilisationPercentage: estimated > 0
              ? Math.round((deployed / estimated) * 100 * 10) / 10
              : null,
          };
        })()
      : null;

    const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;
    const sensitivityLines = (label: string, s: ReturnType<typeof portfolioRateSensitivity>, currentLabel: string, currentValue: number | null) => {
      if (!s.available) return `${label}: ${sensitivityUnavailableText(s.unavailableReason)}`;
      return [
        `${label}:`,
        `  - ${currentLabel}: ${currentValue === null ? 'not available' : money(currentValue)} per month`,
        `  - If rates rise 1%: ${money(impactFor(s, 1)!)} per month (negative means worse off)`,
        `  - If rates rise 2%: ${money(impactFor(s, 2)!)} per month (negative means worse off)`,
        `  - Covers ${s.loansCovered} loan(s), ${money(s.balanceCovered)} of debt`,
      ].join('\n');
    };

    const deterministicFactsBlock = [
      '**CALCULATED FIGURES — THESE ARE AUTHORITATIVE. EXPLAIN THEM; DO NOT RECALCULATE OR RESTATE THEM AS YOUR OWN NUMBERS.**',
      'Every dollar amount you quote must come from this block or from the portfolio data above. Do not derive new financial figures.',
      '',
      sensitivityLines(
        'INTEREST RATE SENSITIVITY — investment properties',
        investmentSensitivity,
        'Current net monthly cashflow',
        portfolioMetrics.netMonthlyCashflow,
      ),
      sensitivityLines(
        'INTEREST RATE SENSITIVITY — owner-occupied properties',
        ownerOccupiedSensitivity,
        'Current monthly repayment',
        ownerOccupiedSensitivity.currentMonthlyRepayment,
      ),
      '',
      `${projectionYears}-YEAR PROJECTION (${projection.assumptions.scenario} scenario):`,
      projection.projectedPortfolioValue === null
        ? '  - Not available: the portfolio has no recorded value.'
        : [
            `  - Projected portfolio value: ${money(projection.projectedPortfolioValue)}`,
            projection.projectedEquity === null
              ? '  - Projected equity: not available (debt not recorded)'
              : `  - Projected equity: ${money(projection.projectedEquity)}`,
            '  - Projected monthly cashflow: NOT PROJECTED. No rent or expense growth rate is recorded for this portfolio. Do not estimate one.',
            ...projection.assumptions.statements.map((s) => `  - Assumption: ${s}`),
          ].join('\n'),
      '',
      capacityFacts === null
        ? 'BORROWING CAPACITY: no assessment on record. Do not estimate a capacity.'
        : [
            'BORROWING CAPACITY UTILISATION:',
            `  - Estimated capacity: ${money(capacityFacts.estimatedCapacity)}`,
            `  - Debt deployed: ${money(capacityFacts.totalDebtDeployed)}`,
            `  - Available: ${money(capacityFacts.availableCapacity)}`,
            capacityFacts.utilisationPercentage === null
              ? '  - Utilisation: not available'
              : `  - Utilisation: ${capacityFacts.utilisationPercentage}%`,
          ].join('\n'),
    ].join('\n');

    console.log(
      `📊 Deterministic facts — investment sensitivity: ${investmentSensitivity.available ? 'available' : investmentSensitivity.unavailableReason}; `
      + `owner-occupied: ${ownerOccupiedSensitivity.available ? 'available' : ownerOccupiedSensitivity.unavailableReason}; `
      + `projection: ${projection.assumptions.scenario} ${growthRate}% over ${projectionYears}y`,
    );

    // --- Build supplementary data sections for the prompt ---

    // Household information
    const hasSecondary = client.secondary_first_name && client.secondary_surname;
    let householdSection = `- Primary Applicant: ${client.primary_first_name} ${client.primary_surname}`;
    if (client.marital_status) householdSection += `\n- Marital Status: ${client.marital_status}`;
    if (client.dependents_count !== null && client.dependents_count !== undefined) householdSection += `\n- Dependents: ${client.dependents_count}`;
    if (hasSecondary) householdSection += `\n- Secondary Applicant: ${client.secondary_first_name} ${client.secondary_surname}`;
    if (additionalContacts && additionalContacts.length > 0) {
      householdSection += `\n- Additional Contacts: ${additionalContacts.map((c: any) => `${c.first_name} ${c.surname} (${c.relationship})`).join(', ')}`;
    }
    // Living situation & address
    if (client.living_situation) householdSection += `\n- Living Situation: ${client.living_situation}`;
    if (client.current_address) householdSection += `\n- Current Address: ${client.current_address}`;
    if (client.residential_status) householdSection += `\n- Residential Status: ${client.residential_status}`;
    // Review dates
    if (client.last_review_date) householdSection += `\n- Last Review Date: ${client.last_review_date}`;
    if (client.next_review_due) householdSection += `\n- Next Review Due: ${client.next_review_due}`;
    if (client.review_frequency) householdSection += `\n- Review Frequency: ${client.review_frequency}`;

    // Income breakdown
    let incomeSection = '';
    if (incomeSources && incomeSources.length > 0) {
      const totalGrossAnnual = incomeSources.reduce((sum: number, s: any) => sum + (Number(s.gross_annual_amount) || 0), 0);
      // Also sum all sub-components (bonus, commission, OT etc.) that are additional to gross_annual_amount
      const totalBonuses = incomeSources.reduce((sum: number, s: any) => sum + (Number(s.bonus) || 0), 0);
      const totalCommissions = incomeSources.reduce((sum: number, s: any) => sum + (Number(s.commission) || 0), 0);
      const totalOT = incomeSources.reduce((sum: number, s: any) => sum + (Number(s.overtime_essential) || 0) + (Number(s.overtime_non_essential) || 0), 0);
      const totalAllIncome = totalGrossAnnual + totalBonuses + totalCommissions + totalOT;
      
      incomeSection = `\n**INCOME BREAKDOWN (${incomeSources.length} sources):**\n`;
      incomeSection += `- TOTAL HOUSEHOLD GROSS ANNUAL INCOME: $${totalAllIncome.toLocaleString()}\n`;
      incomeSection += `  (Base: $${totalGrossAnnual.toLocaleString()}`;
      if (totalBonuses > 0) incomeSection += ` + Bonuses: $${totalBonuses.toLocaleString()}`;
      if (totalCommissions > 0) incomeSection += ` + Commissions: $${totalCommissions.toLocaleString()}`;
      if (totalOT > 0) incomeSection += ` + Overtime: $${totalOT.toLocaleString()}`;
      incomeSection += `)\n`;
      
      incomeSources.forEach((src: any) => {
        const contactLabel = src.contact_type === 'primary' ? client.primary_first_name : 
          src.contact_type === 'secondary' && hasSecondary ? client.secondary_first_name : src.contact_type;
        incomeSection += `- [${contactLabel}] ${src.source_type} (${src.source_category}): $${(Number(src.gross_annual_amount) || 0).toLocaleString()}/yr`;
        if (src.source_name) incomeSection += ` — ${src.source_name}`;
        if (src.bonus) incomeSection += ` (incl. bonus: $${Number(src.bonus).toLocaleString()})`;
        if (src.commission) incomeSection += ` (incl. commission: $${Number(src.commission).toLocaleString()})`;
        if (src.overtime_essential) incomeSection += ` (incl. essential OT: $${Number(src.overtime_essential).toLocaleString()})`;
        if (src.overtime_non_essential) incomeSection += ` (incl. non-essential OT: $${Number(src.overtime_non_essential).toLocaleString()})`;
        if (src.allowance) incomeSection += ` (incl. allowance: $${Number(src.allowance).toLocaleString()})`;
        incomeSection += `\n`;
      });
    } else {
      // Fallback to legacy flat field
      incomeSection = `\n**INCOME:**\n- Total Monthly Income (legacy): $${(client.total_monthly_income || 0).toLocaleString()}\n`;
    }

    // Employment details
    let employmentSection = '';
    if (employment && employment.length > 0) {
      employmentSection = `\n**EMPLOYMENT:**\n`;
      employment.forEach((emp: any) => {
        const contactLabel = emp.contact_type === 'primary' ? client.primary_first_name :
          emp.contact_type === 'secondary' && hasSecondary ? client.secondary_first_name : emp.contact_type;
        employmentSection += `- [${contactLabel}] ${emp.employment_type || 'N/A'} — ${emp.occupation_role || 'N/A'} at ${emp.employer_name || 'N/A'}`;
        if (emp.gross_annual_salary) employmentSection += `, Gross Salary: $${Number(emp.gross_annual_salary).toLocaleString()}/yr`;
        employmentSection += `\n`;
      });
    }

    // Expenses
    let expensesSection = '';
    if (expenses && expenses.length > 0) {
      const totalMonthlyExpenses = expenses.reduce((sum: number, e: any) => sum + (Number(e.monthly_amount) || 0), 0);
      const essentialExpenses = expenses.filter((e: any) => e.is_essential);
      const discretionaryExpenses = expenses.filter((e: any) => !e.is_essential);
      expensesSection = `\n**LIVING EXPENSES (Total: $${totalMonthlyExpenses.toLocaleString()}/mo):**\n`;
      if (essentialExpenses.length > 0) {
        expensesSection += `Essential ($${essentialExpenses.reduce((s: number, e: any) => s + (Number(e.monthly_amount) || 0), 0).toLocaleString()}/mo): `;
        expensesSection += essentialExpenses.map((e: any) => `${e.expense_category}: $${(Number(e.monthly_amount) || 0).toLocaleString()}`).join(', ') + `\n`;
      }
      if (discretionaryExpenses.length > 0) {
        expensesSection += `Discretionary ($${discretionaryExpenses.reduce((s: number, e: any) => s + (Number(e.monthly_amount) || 0), 0).toLocaleString()}/mo): `;
        expensesSection += discretionaryExpenses.map((e: any) => `${e.expense_category}: $${(Number(e.monthly_amount) || 0).toLocaleString()}`).join(', ') + `\n`;
      }
    }

    // Liabilities (non-property)
    let liabilitiesSection = '';
    if (liabilities && liabilities.length > 0) {
      const totalLiabilityBalance = liabilities.reduce((sum: number, l: any) => sum + (Number(l.current_balance) || 0), 0);
      const totalLiabilityRepayments = liabilities.reduce((sum: number, l: any) => sum + (Number(l.monthly_repayment) || 0), 0);
      liabilitiesSection = `\n**NON-PROPERTY LIABILITIES (Total Balance: $${totalLiabilityBalance.toLocaleString()}, Total Repayments: $${totalLiabilityRepayments.toLocaleString()}/mo):**\n`;
      liabilities.forEach((l: any) => {
        liabilitiesSection += `- ${l.liability_type}: Balance $${(Number(l.current_balance) || 0).toLocaleString()}`;
        if (l.monthly_repayment) liabilitiesSection += `, Repayment $${Number(l.monthly_repayment).toLocaleString()}/mo`;
        if (l.interest_rate) liabilitiesSection += `, Rate ${l.interest_rate}%`;
        if (l.provider_name) liabilitiesSection += ` (${l.provider_name})`;
        liabilitiesSection += `\n`;
      });
    }

    // Non-property assets
    let assetsSection = '';
    if (assets && assets.length > 0) {
      const totalAssetValue = assets.reduce((sum: number, a: any) => sum + (Number(a.value) || 0), 0);
      assetsSection = `\n**NON-PROPERTY ASSETS (Total: $${totalAssetValue.toLocaleString()}):**\n`;
      assets.forEach((a: any) => {
        assetsSection += `- ${a.asset_type}: $${(Number(a.value) || 0).toLocaleString()}`;
        if (a.description) assetsSection += ` — ${a.description}`;
        if (a.institution_name) assetsSection += ` (${a.institution_name})`;
        assetsSection += `\n`;
      });
    }

    // Build AI analysis prompt
    // ── Audit item 10: the AI Insights card ───────────────────────────────
    //
    // "Generate AI Insights" answered `Failed to generate insights: Not found`
    // for everyone, every time, and had never once worked. The card composed
    // its whole prompt in the browser and posted it to `report-qa` with
    // `action: 'chat'` — an action whose policy is `access: 'write'`, meaning
    // it authorises against a Report Q&A CONVERSATION. The card has no
    // conversation, so `if (!conversationId) return denyResponse()` answered
    // 404, and 404 is deliberate there: a caller must not be able to tell a
    // conversation they cannot reach from one that does not exist. A correct
    // refusal, to a question that should never have been asked of it.
    //
    // Two things were wrong beyond the 404. A card on the Clients page
    // required the unrelated `report_qa` module permission and spent Report
    // Q&A's shared paid quota (30/hour). And the prompt was assembled by the
    // browser, so the endpoint was being used as a free-text model proxy.
    //
    // Both go away here: this function already authorises the CLIENT, already
    // reads the portfolio from the database, and already meters under
    // `portfolio_analysis`. The browser now sends a client id and nothing
    // else.
    if (mode === 'insights') {
      const topProperties = ownedProperties.slice(0, 12).map((p) => ({
        address: p.address,
        value: Number(p.value) || 0,
        loan: Number(p.loan_remaining) || 0,
        monthlyRent: Number(p.monthly_rental_income) || 0,
        netMonthlyCashflow: Number(p.net_monthly_cashflow) || 0,
        type: p.property_type,
      }));

      const insightsPrompt = `Analyse this Australian property investment portfolio.

Client: ${client.primary_first_name ?? ''} ${client.primary_surname ?? ''}
Properties: ${portfolioMetrics.totalProperties} (${portfolioMetrics.investmentCount} investment, ${portfolioMetrics.ownerOccupiedCount} owner-occupied)
Portfolio value: $${Math.round(portfolioMetrics.totalValue).toLocaleString('en-AU')}
Total debt: $${Math.round(portfolioMetrics.totalDebt).toLocaleString('en-AU')}
Equity: $${Math.round(portfolioMetrics.totalEquity).toLocaleString('en-AU')}
Average LVR: ${portfolioMetrics.averageLVR.toFixed(1)}%
Average gross yield: ${portfolioMetrics.averageYield.toFixed(2)}%
Net monthly cash flow: $${Math.round(portfolioMetrics.netMonthlyCashflow).toLocaleString('en-AU')}

Properties:
${topProperties.map((p) => `- ${p.address} (${p.type}): value $${p.value.toLocaleString('en-AU')}, loan $${p.loan.toLocaleString('en-AU')}, rent $${p.monthlyRent.toLocaleString('en-AU')}/mo, net $${p.netMonthlyCashflow.toLocaleString('en-AU')}/mo`).join('\n') || '- none recorded'}

Respond with ONLY this JSON:
{
  "summary": "2-3 sentence overall assessment",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "opportunities": ["opportunity 1", "opportunity 2"],
  "risks": ["risk 1", "risk 2"],
  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3"]
}`;

      const insightsResponse = await callForJson({
        agentKey: 'portfolio_analysis',
        messages: [
          {
            role: 'system',
            content: (await (await import('../_shared/engine-prompts.ts')).resolvePrompt('portfolio_analysis.system')).text,
          },
          { role: 'user', content: insightsPrompt },
        ],
        temperature: 0.7,
        // 1,200 was sized for the five short fields this card renders, which
        // was right for the answer and wrong for the call: `gemini-2.5-pro` is
        // a REASONING model and its thinking is billed as completion tokens,
        // spent before a character of the answer is written. Production spent
        // 1,196 of 1,200 and produced 184 characters — one truncated sentence.
        maxTokens: 4000,
      });

      if (!insightsResponse.ok) {
        const detail = await insightsResponse.text();
        console.error('[generate-portfolio-analysis] insights model error:', insightsResponse.status, detail);
        return new Response(
          JSON.stringify(
            insightsResponse.status === 429
              ? { error: 'Rate limit exceeded', details: 'Please wait and try again.' }
              : { error: 'AI analysis failed', details: detail },
          ),
          {
            status: insightsResponse.status === 429 ? 429 : 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          },
        );
      }

      const insightsData = await insightsResponse.json();
      const insightsText = insightsData.choices?.[0]?.message?.content ?? '';
      // `readModelJson` rather than a fence regex of our own. The regex here
      // required a CLOSING fence, so a cut-off answer — which has neither a
      // closing fence nor a closing brace — fell through to a raw match that
      // could not succeed either, and the operator was told the model had not
      // answered in JSON when it had, and had simply been stopped mid-word.
      const insightsRead = readModelJson<Record<string, unknown>>(
        insightsText,
        insightsData.choices?.[0]?.finish_reason,
      );
      if (!insightsRead.ok) {
        console.error(
          `[generate-portfolio-analysis] insights ${insightsRead.reason}:`,
          insightsText.slice(0, 400),
        );
        return new Response(
          JSON.stringify({ error: insightsRead.message, reason: insightsRead.reason }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ success: true, insights: insightsRead.value }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const prompt = `You are an expert Australian property portfolio analyst and trusted advisor. Analyze this client's entire property portfolio and provide a comprehensive, consultative analysis that builds trust and demonstrates expertise.

**CLIENT & HOUSEHOLD INFORMATION:**
${householdSection}
- Investor Profile: ${investorProfile}
${incomeSection}${employmentSection}${expensesSection}${liabilitiesSection}${assetsSection}${bcData ? `
**BORROWING CAPACITY ASSESSMENT:**
- Estimated Borrowing Capacity: $${(bcData.borrowing_capacity || 0).toLocaleString()}
- Stress-Tested Capacity: $${(bcData.stress_tested_capacity || 0).toLocaleString()}
- Monthly Surplus: $${(bcData.monthly_surplus || 0).toLocaleString()}
- Serviceability Band: ${bcData.serviceability_band || 'Unknown'}
- DTI Ratio: ${bcData.dti_ratio || 'N/A'}
- Assessment Rate: ${bcData.assessment_rate || 'N/A'}%
- Gross Annual Income (assessed): $${(bcData.gross_annual_income || 0).toLocaleString()}
- Shaded Annual Income: $${(bcData.shaded_annual_income || 0).toLocaleString()}
- Living Expenses (monthly): $${(bcData.living_expenses_monthly || 0).toLocaleString()}
- Existing Commitments (monthly): $${(bcData.existing_commitments_monthly || 0).toLocaleString()}
` : ''}
${configContext ? `**ANALYSIS CONFIGURATION:**
The following preferences have been set to tailor this analysis:
${configContext}
IMPORTANT: You MUST incorporate these preferences into your analysis, recommendations, and projections. Adjust your risk assessments, strategy suggestions, and growth assumptions accordingly.

` : ''}${customInstructions ? `**CUSTOM INSTRUCTIONS FROM ADVISOR:**
The advisor has provided the following specific instructions for this report. You MUST incorporate these preferences, tone adjustments, and specific guidance into the analysis and recommendations:
${customInstructions}

` : ''}**PORTFOLIO SUMMARY:**
- Total Properties: ${portfolioMetrics.totalProperties}
- Investment Properties: ${portfolioMetrics.investmentCount}
- Owner Occupied: ${portfolioMetrics.ownerOccupiedCount}
- Total Portfolio Value: $${portfolioMetrics.totalValue.toLocaleString()}
- Total Debt: $${portfolioMetrics.totalDebt.toLocaleString()}
- Total Equity: $${portfolioMetrics.totalEquity.toLocaleString()}
- Average LVR: ${portfolioMetrics.averageLVR.toFixed(1)}%
- Monthly Rental Income: $${portfolioMetrics.totalMonthlyRentalIncome.toLocaleString()}
- Monthly Expenses: $${portfolioMetrics.totalMonthlyExpenses.toLocaleString()}
- Net Monthly Cashflow: $${portfolioMetrics.netMonthlyCashflow.toLocaleString()}
- Average Gross Yield: ${portfolioMetrics.averageYield.toFixed(2)}%

**INDIVIDUAL PROPERTY ANALYSIS:**
${JSON.stringify(propertyAnalyses, null, 2)}

**IMPORTANT CONTEXT:**
- Owner-occupied properties should be evaluated differently from investment properties
- Do NOT penalize owner-occupied properties for lack of rental income, yield, or cash flow
- Owner-occupied properties should be scored on: equity position, LVR, and capital growth potential
- Investment properties should be scored on: yield, cash flow, LVR, and capital growth

**ANALYSIS REQUIREMENTS:**
Provide a comprehensive, consultative portfolio analysis. The tone should be warm, professional, and trust-building — as if you are part of the client's dedicated property advisory team preparing a personalised review. CRITICAL: Always use "we/our/us" framing (e.g. "We are pleased to present...", "Our team has reviewed...", "We recommend..."). NEVER use first-person singular "I/my" — this report is sent on behalf of a team, not an individual. Justify every assessment with data-driven reasoning. Even for underperforming portfolios, frame findings constructively with clear pathways to improvement.

${deterministicFactsBlock}

Provide analysis with these sections:

1. PERSONALISED NARRATIVE - A warm opening statement and portfolio journey summary
2. EXECUTIVE SUMMARY - Health assessment, strengths, concerns, recommendation
3. PORTFOLIO COMPOSITION - Asset allocation, diversification, property mix
4. PROPERTY STRATEGIC CONTEXT - For EACH property: strategic role (Growth Asset/Income Generator/Equity Builder/Lifestyle Asset), capital growth analysis, and individual 2-3 sentence outlook
5. FINANCIAL HEALTH - Cashflow, equity, serviceability, LVR risk
6. PROPERTY RANKINGS - Performance ranking with strengths, concerns, recommendations
7. RISK ASSESSMENT - Concentration, interest rate, vacancy, market risks with mitigation strategies
8. INTEREST RATE SENSITIVITY ON LENDER RATES - Show how changes to lender interest rates affect monthly repayments and cashflow. Break this down into TWO sections: (a) Investment Properties - impact on rental cashflow, and (b) Owner-Occupied Properties (home loans) - impact on personal loan repayments. Use plain English that a non-expert would understand (e.g. "If your lender increased your interest rate by 1%, your monthly home loan repayment would increase by $X, bringing your total monthly repayment to $Y"). Calculate impacts based on actual loan balances and current interest rates from the property data provided
9. MARKET CONDITIONS - This is a KEY SECTION that must be rich and detailed (minimum 3 substantial paragraphs). Cover: (a) Where Australia sits in the current property market cycle (recovery, growth, peak, correction) with supporting evidence, (b) RBA monetary policy — current cash rate, recent decisions, forward guidance, and what economists/major banks are forecasting for the next 12-18 months, (c) How these macro conditions specifically affect THIS client's portfolio — connect the dots between rate movements, borrowing capacity, property values, and rental demand in their specific markets, (d) Credit and lending environment — are banks tightening or loosening? What does APRA's stance mean for refinancing or new purchases? Write this section as a bird's-eye economic briefing that helps the client understand WHY their portfolio is performing the way it is.
10. GROWTH OPPORTUNITIES - Equity release, refinancing, next purchase, optimization. Be specific with dollar amounts and scenarios.
11. ${projectionYears}-YEAR PROJECTIONS - Value, equity, cashflow projections (${growthRate}% growth)${interestRateScenario && interestRateScenario !== 'current' ? ` with stress test for ${configLabels.interestRateScenario[interestRateScenario]}` : ''}. Use plain language to explain what these numbers mean for the client in practical terms (e.g. "In 10 years, your portfolio is estimated to be worth $X, meaning you would have built approximately $Y in equity - that's roughly $Z more than today")
12. ACTION PLAN - Next 12-month prioritised actions and optimisation scenarios
13. BORROWING CAPACITY UTILISATION - Deployed vs available capacity analysis
14. STRATEGIC RECOMMENDATIONS - Short/medium/long-term with priority actions

Format your response as valid JSON with this structure:
{
  "personalizedNarrative": {
    "openingStatement": "string (warm, client-facing paragraph framing this as their portfolio health check)",
    "portfolioJourney": "string (where they stand today - equity position, portfolio composition, market context)"
  },
  "executiveSummary": {
    "overallHealth": "string (Excellent/Good/Fair/Poor)",
    "healthScore": number (0-100),
    "keyStrengths": ["string (be specific with dollar amounts)"],
    "keyConcerns": ["string (be specific with dollar amounts)"],
    "primaryRecommendation": "string"
  },
  "compositionAnalysis": {
    "assetAllocation": "string",
    "diversificationScore": number (0-100),
    "propertyMixAssessment": "string",
    "recommendations": ["string"]
  },
  "propertyStrategicContext": [
    {
      "address": "string",
      "strategicRole": "string (Growth Asset/Income Generator/Equity Builder/Lifestyle Asset/Development Pipeline)",
      "capitalGrowthAnalysis": "string (historical and forward-looking growth commentary)",
      "individualOutlook": "string (2-3 sentences on suburb trends and demand drivers)"
    }
  ],
  "financialHealth": {
    "cashflowStatus": "string (Positive/Neutral/Negative)",
    "equityPosition": "string (Strong/Moderate/Weak)",
    "debtServiceability": "string (Comfortable/Manageable/Stressed)",
    "lvrRisk": "string (Low/Medium/High)",
    "analysis": "string"
  },
  "propertyRankings": [
    {
      "rank": number,
      "address": "string",
      "performanceRating": "string (Star/Good/Average/Underperformer)",
      "strengths": ["string"],
      "concerns": ["string"],
      "recommendation": "string"
    }
  ],
  "riskAssessment": {
    "overallRiskLevel": "string (Low/Medium/High)",
    "concentrationRisk": "string",
    "interestRateSensitivity": "string",
    "vacancyRisk": "string",
    "marketRisks": ["string"],
    "mitigationStrategies": ["string"]
  },
  "interestRateSensitivity": {
    "investmentProperties": {
      "commentary": "string (plain English explanation of what rate rises mean for rental income vs expenses. Use ONLY the calculated figures supplied above; if they are unavailable, say so plainly and do not estimate)"
    },
    "ownerOccupiedProperties": {
      "commentary": "string (plain English explanation of what rate rises mean for home loan repayments. Use ONLY the calculated figures supplied above; if they are unavailable, say so plainly and do not estimate)"
    },
    "combinedCommentary": "string (overall summary in plain English)"
  },
  "marketConditions": {
    "marketCycleSummary": "string (detailed 2-3 paragraph analysis of where Australia sits in the property cycle, with evidence and historical context)",
    "rbaOutlook": "string (detailed 2-3 paragraph analysis covering current cash rate, recent RBA decisions, forward guidance, major bank forecasts for the next 12-18 months, and what this means for mortgage holders and property investors)",
    "lendingEnvironment": "string (1-2 paragraphs on APRA regulations, bank lending appetite, credit conditions, and implications for refinancing or new purchases)",
    "clientPositioning": "string (1-2 paragraphs connecting ALL of the above macro factors specifically to THIS client's portfolio — how do these conditions affect their properties, their borrowing power, and their strategy?)"
  },
  "growthOpportunities": {
    "equityReleaseOptions": ["string"],
    "refinancingOpportunities": ["string"],
    "nextPurchaseRecommendations": ["string"],
    "optimizationStrategies": ["string"]
  },
  "projections": {
    "plainEnglishSummary": "string (2-3 sentences explaining what the SUPPLIED projection figures mean in everyday language for the client. Quote only the calculated values given above. Do not state a projected cashflow — none is calculated)"
  },
  "actionPlan": {
    "twelveMonthActions": ["string (concrete, prioritised actions)"],
    "optimisationScenarios": ["string (if-then improvement scenarios with dollar amounts)"]
  },
  "borrowingCapacityUtilisation": {
    "commentary": "string (interpret the supplied capacity figures; if no assessment is on record, say so and do not estimate a capacity)"
  },
  "strategicRecommendations": {
    "shortTerm": ["string"],
    "mediumTerm": ["string"],
    "longTerm": ["string"],
    "priorityActions": ["string"]
  }
}`;

    // Call Lovable AI
    console.log('Calling LLM router for portfolio analysis...');
    const aiResponse = await callForJson({
      agentKey: 'portfolio_analysis',
      messages: [
        {
          role: 'system',
          content: (await (await import('../_shared/engine-prompts.ts')).resolvePrompt('portfolio_analysis.system')).text,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      // Same reasoning-model arithmetic as the insights call above: 8,000 was
      // sized for a fourteen-section document and production spent 7,996 of it
      // — four short of the ceiling on every run — because the model's own
      // thinking is billed against the same budget. `request_timeout` is
      // raised alongside this, because a longer answer is a longer call.
      maxTokens: 14000,
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Lovable AI error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded', details: 'Please wait and try again.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'AI analysis failed', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const analysisText = aiData.choices[0].message.content;

    // Parse JSON response.
    //
    // This was `JSON.parse` behind a fence regex that required a CLOSING
    // fence. Every answer in production arrived truncated, so the regex never
    // matched, the raw ```json text went to `JSON.parse`, and the function
    // threw `Unexpected token '`'` — a crash rather than a refusal, which is
    // why the button reported a bare 500 with nothing to act on.
    const analysisRead = readModelJson<Record<string, unknown>>(
      analysisText,
      aiData.choices?.[0]?.finish_reason,
    );
    if (!analysisRead.ok) {
      console.error(`[generate-portfolio-analysis] analysis ${analysisRead.reason}`);
      console.log('Raw response:', String(analysisText).slice(0, 1000));
      return new Response(
        JSON.stringify({ error: analysisRead.message, reason: analysisRead.reason }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const analysis = analysisRead.value as any;

    // ========================================================================
    // CONTROLLED FINAL ASSEMBLY
    //
    // The model's schema no longer contains any of these fields, so nothing is
    // being overwritten — the deterministic values are simply written into the
    // persisted shape that existing consumers read. Model prose is carried
    // through untouched beside them.
    //
    // The stored shape is deliberately unchanged: `PortfolioAnalysisPDFGenerator`
    // reads `analysis.interestRateSensitivity.investmentProperties.*` and
    // `normalise.pure.ts` reads `analysis.projections.*`. What changed is who
    // produces the numbers, not where they live.
    //
    // `null` means the record could not establish the figure. It is never a
    // zero — a zeroed rate shock reads as "rates rising costs you nothing".
    // ========================================================================
    const modelSensitivity = (analysis?.interestRateSensitivity ?? {}) as any;
    analysis.interestRateSensitivity = {
      investmentProperties: {
        // ONE authority for this figure: the portfolio metric computed above.
        // The model used to transcribe it, and on one stored report was $492
        // a month out from the value sitting beside it in the same object.
        currentMonthlyCashflow: portfolioMetrics.netMonthlyCashflow,
        plusOnePercentImpact: impactFor(investmentSensitivity, 1),
        plusTwoPercentImpact: impactFor(investmentSensitivity, 2),
        available: investmentSensitivity.available,
        unavailableReason: investmentSensitivity.unavailableReason,
        unavailableExplanation: investmentSensitivity.available
          ? null
          : sensitivityUnavailableText(investmentSensitivity.unavailableReason),
        loansCovered: investmentSensitivity.loansCovered,
        balanceCovered: investmentSensitivity.balanceCovered,
        commentary: typeof modelSensitivity?.investmentProperties?.commentary === 'string'
          ? modelSensitivity.investmentProperties.commentary : '',
      },
      ownerOccupiedProperties: {
        currentMonthlyRepayment: ownerOccupiedSensitivity.currentMonthlyRepayment,
        plusOnePercentImpact: impactFor(ownerOccupiedSensitivity, 1),
        plusTwoPercentImpact: impactFor(ownerOccupiedSensitivity, 2),
        available: ownerOccupiedSensitivity.available,
        unavailableReason: ownerOccupiedSensitivity.unavailableReason,
        unavailableExplanation: ownerOccupiedSensitivity.available
          ? null
          : sensitivityUnavailableText(ownerOccupiedSensitivity.unavailableReason),
        loansCovered: ownerOccupiedSensitivity.loansCovered,
        balanceCovered: ownerOccupiedSensitivity.balanceCovered,
        commentary: typeof modelSensitivity?.ownerOccupiedProperties?.commentary === 'string'
          ? modelSensitivity.ownerOccupiedProperties.commentary : '',
      },
      combinedCommentary: typeof modelSensitivity?.combinedCommentary === 'string'
        ? modelSensitivity.combinedCommentary : '',
    };

    analysis.projections = {
      years: projection.assumptions.horizonYears,
      projectedPortfolioValue: projection.projectedPortfolioValue,
      projectedDebt: projection.projectedDebt,
      projectedEquity: projection.projectedEquity,
      // Never projected — no rent or expense growth rate is recorded, and
      // capital growth is not rental growth.
      projectedMonthlyCashflow: null,
      // The assumptions shown are the assumptions used, from one object.
      assumptions: projection.assumptions.statements,
      assumptionDetail: projection.assumptions,
      plainEnglishSummary: typeof analysis?.projections?.plainEnglishSummary === 'string'
        ? analysis.projections.plainEnglishSummary : '',
    };

    analysis.borrowingCapacityUtilisation = capacityFacts === null
      ? null
      : {
          ...capacityFacts,
          commentary: typeof analysis?.borrowingCapacityUtilisation?.commentary === 'string'
            ? analysis.borrowingCapacityUtilisation.commentary : '',
        };

    // Score bounds — the two figures the model IS the authority for. A score
    // outside 0-100 is not a judgement this product can render, so it is
    // dropped rather than clamped: clamping 250 to 100 would publish an
    // excellent rating the model never gave.
    const boundedScore = (v: unknown): number | null => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
    };
    if (analysis?.executiveSummary) {
      analysis.executiveSummary.healthScore = boundedScore(analysis.executiveSummary.healthScore);
    }
    if (analysis?.compositionAnalysis) {
      analysis.compositionAnalysis.diversificationScore = boundedScore(analysis.compositionAnalysis.diversificationScore);
    }

    const processingTime = Date.now() - startTime;
    console.log(`✅ Portfolio analysis completed in ${processingTime}ms`);

    // Build borrowing capacity response object from already-fetched data
    // Return the full assessment data including breakdowns for comprehensive PDF rendering
    let borrowingCapacity = null;
    if (bcData) {
      borrowingCapacity = {
        borrowingCapacity: bcData.borrowing_capacity || 0,
        monthlySurplus: bcData.monthly_surplus || 0,
        serviceabilityBand: (bcData.serviceability_band || 'unknown').toLowerCase(),
        dtiRatio: bcData.dti_ratio || 0,
        stressTestedCapacity: bcData.stress_tested_capacity || 0,
        assessmentRate: bcData.assessment_rate || 0,
        grossAnnualIncome: bcData.gross_annual_income || 0,
        shadedAnnualIncome: bcData.shaded_annual_income || 0,
        livingExpenses: bcData.living_expenses_monthly || 0,
        existingCommitments: bcData.existing_commitments_monthly || 0,
        recommendations: Array.isArray(bcData.recommendations) ? bcData.recommendations : [],
        warnings: Array.isArray(bcData.warnings) ? bcData.warnings : [],
        calculatedAt: bcData.created_at,
        // Full assessment data for comprehensive PDF rendering
        incomeBreakdown: bcData.income_breakdown || [],
        expenseBreakdown: bcData.expense_breakdown || {},
        liabilityBreakdown: bcData.liability_breakdown || [],
        expenseMethod: bcData.expense_method || 'hybrid',
        interestRateUsed: bcData.interest_rate_used || null,
        bufferRate: bcData.buffer_rate || null,
        loanTermYears: bcData.loan_term_years || 30,
        proposedLoanAmount: bcData.proposed_loan_amount || null,
        proposedLvr: bcData.proposed_lvr || null,
        assumptions: bcData.assumptions || [],
      };
      console.log('✓ Borrowing capacity assessment found (with full breakdowns)');
    } else {
      console.log('ℹ No borrowing capacity assessment found for client');
    }

    // Return comprehensive response
    return new Response(
      JSON.stringify({
        success: true,
        clientId,
        clientName: `${client.primary_first_name} ${client.primary_surname}`,
        portfolioMetrics,
        propertyAnalyses,
        analysis,
        borrowingCapacity,
        generatedAt: new Date().toISOString(),
        processingTimeMs: processingTime,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Portfolio analysis error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'generate-portfolio-analysis'), error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

Deno.serve(withReportMetering(async (body, req) => {
  if (!body) return null;
  const userId = await resolveUserId(req, body);
  if (!userId) return null;
  const idempotencyKey = buildIdempotencyKey('portfolio', [
    body?.clientId,
    body?.investorProfile,
    body?.analysisDepth,
    body?.projectionYears,
    new Date().toISOString().slice(0, 10),
  ]);
  return {
    kind: 'report.portfolio-review' as const,
    userId,
    idempotencyKey,
    estimateOptions: { aiNarrative: true, extraSections: body?.includeProjections ? 1 : 0 },
    requestPayload: { clientId: body?.clientId, investorProfile: body?.investorProfile },
  };
}, __portfolioHandler));
