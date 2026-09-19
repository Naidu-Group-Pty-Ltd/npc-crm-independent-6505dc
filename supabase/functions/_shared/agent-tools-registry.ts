/**
 * Side-effect module that registers all Report Q&A agent tools into the
 * shared `_shared/agent-tools.ts` registry.
 *
 * Phase 2.2 — calculator tools (yield, LVR, repayment, cash flow,
 * scenario delta, stamp duty), plus auto-extract from report context
 * and edge-function-backed deep calculators (financial-calculator-service,
 * calculate-borrowing-capacity, estimate-property-expenses).
 *
 * Phase 2.3 will add live-data tools (ABS, Domain, climate, crime, etc).
 */

// deno-lint-ignore-file no-explicit-any

import { registerTool, type AgentToolContext } from './agent-tools.ts';
import {
  calculateMortgageRepayment,
  calculateYield,
  calculateLvr,
  calculateCashFlow,
  calculateScenarioDelta,
  extractMetricsFromReports,
  extractReportMetrics,
} from './calculators.ts';
import { calculateStampDuty } from './stampDutyCalculator.ts';

// ---------------------------------------------------------------------------
// Helper: pull defaults from the report context so tools can fill missing
// args automatically (option a — auto-extract). Callers can still override
// any argument explicitly (option b — inline form).
// ---------------------------------------------------------------------------
function reportDefaults(ctx: AgentToolContext) {
  const merged = extractMetricsFromReports((ctx.reportContents as any) || []);
  return merged;
}

function pick<T>(explicit: T | undefined | null, fallback: T | undefined): T | undefined {
  return explicit != null ? explicit : fallback;
}

// ---------------------------------------------------------------------------
// 1. extract_report_metrics
// ---------------------------------------------------------------------------
registerTool({
  name: 'extract_report_metrics',
  description:
    'Extract headline numbers (property value, weekly rent, loan amount, deposit, interest rate, postcode, state, address) directly from the attached report(s). Use this first whenever the user asks a calculation question without supplying numbers — it returns the values the model should plug into other calculator tools.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(_args, ctx) {
    const result = reportDefaults(ctx);
    return {
      ...result,
      source: 'attached_reports',
      report_count: ctx.reportContents?.length || 0,
    };
  },
});

// ---------------------------------------------------------------------------
// 2. calculate_yield
// ---------------------------------------------------------------------------
registerTool({
  name: 'calculate_yield',
  description:
    'Calculate gross and (optionally) net rental yield for a property. Auto-fills missing values from the attached report(s). Returns gross_yield_percent and, if annual_expenses provided, net_yield_percent.',
  parameters: {
    type: 'object',
    properties: {
      property_value: { type: 'number', description: 'Property purchase/valuation price (AUD). Omit to auto-extract from report.' },
      weekly_rent: { type: 'number', description: 'Weekly rent (AUD). Omit to auto-extract or supply annual_rent instead.' },
      annual_rent: { type: 'number', description: 'Annual rent (AUD). Optional alternative to weekly_rent.' },
      annual_expenses: { type: 'number', description: 'Total annual holding costs (rates, insurance, PM, maintenance). Required for net yield.' },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    return calculateYield({
      property_value: pick(args.property_value, d.property_value) ?? 0,
      weekly_rent: pick(args.weekly_rent, d.weekly_rent),
      annual_rent: pick(args.annual_rent, d.annual_rent),
      annual_expenses: args.annual_expenses,
    });
  },
});

// ---------------------------------------------------------------------------
// 3. calculate_lvr
// ---------------------------------------------------------------------------
registerTool({
  name: 'calculate_lvr',
  description:
    'Calculate Loan-to-Value Ratio (LVR), flag whether LMI is likely, and report the deposit gap needed to reach 80% LVR. Supply any two of loan_amount/property_value/deposit; the third is derived.',
  parameters: {
    type: 'object',
    properties: {
      property_value: { type: 'number' },
      loan_amount: { type: 'number' },
      deposit: { type: 'number' },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    return calculateLvr({
      property_value: pick(args.property_value, d.property_value) ?? 0,
      loan_amount: pick(args.loan_amount, d.loan_amount),
      deposit: pick(args.deposit, d.deposit),
    });
  },
});

// ---------------------------------------------------------------------------
// 4. calculate_mortgage_repayment
// ---------------------------------------------------------------------------
registerTool({
  name: 'calculate_mortgage_repayment',
  description:
    'Calculate periodic mortgage repayments (weekly/fortnightly/monthly), monthly equivalent, annual total, and total interest over the loan term. Supports principal_and_interest or interest_only loans.',
  parameters: {
    type: 'object',
    properties: {
      loan_amount: { type: 'number' },
      annual_rate_percent: { type: 'number' },
      loan_term_years: { type: 'number' },
      frequency: { type: 'string', enum: ['weekly', 'fortnightly', 'monthly'] },
      loan_type: { type: 'string', enum: ['principal_interest', 'interest_only'] },
      io_term_years: { type: 'number', description: 'Years of interest-only period (if loan_type=interest_only).' },
    },
    required: ['loan_amount', 'annual_rate_percent', 'loan_term_years'],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    return calculateMortgageRepayment({
      loan_amount: pick(args.loan_amount, d.loan_amount) ?? 0,
      annual_rate_percent: pick(args.annual_rate_percent, d.interest_rate_percent) ?? 0,
      loan_term_years: pick(args.loan_term_years, d.loan_term_years) ?? 30,
      frequency: args.frequency,
      loan_type: args.loan_type,
      io_term_years: args.io_term_years,
    });
  },
});

// ---------------------------------------------------------------------------
// 5. calculate_cash_flow
// ---------------------------------------------------------------------------
registerTool({
  name: 'calculate_cash_flow',
  description:
    'Calculate weekly/monthly/annual property cash flow after rent, repayments, vacancy, and holding expenses. Either supply explicit repayments OR loan terms (loan_amount + annual_rate_percent + loan_term_years) and the tool will compute them.',
  parameters: {
    type: 'object',
    properties: {
      weekly_rent: { type: 'number' },
      annual_rent: { type: 'number' },
      annual_repayments: { type: 'number' },
      monthly_repayments: { type: 'number' },
      loan_amount: { type: 'number' },
      annual_rate_percent: { type: 'number' },
      loan_term_years: { type: 'number' },
      loan_type: { type: 'string', enum: ['principal_interest', 'interest_only'] },
      annual_expenses: { type: 'number', description: 'Total annual expenses override (replaces breakdown).' },
      council_rates: { type: 'number' },
      water_rates: { type: 'number' },
      property_management_percent: { type: 'number', description: 'PM fee as % of rent (default 7).' },
      insurance: { type: 'number' },
      strata: { type: 'number' },
      maintenance: { type: 'number' },
      vacancy_weeks: { type: 'number', description: 'Assumed vacancy weeks per year (default 2).' },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    return calculateCashFlow({
      weekly_rent: pick(args.weekly_rent, d.weekly_rent),
      annual_rent: pick(args.annual_rent, d.annual_rent),
      annual_repayments: args.annual_repayments,
      monthly_repayments: args.monthly_repayments,
      loan_amount: pick(args.loan_amount, d.loan_amount),
      annual_rate_percent: pick(args.annual_rate_percent, d.interest_rate_percent),
      loan_term_years: pick(args.loan_term_years, d.loan_term_years),
      loan_type: args.loan_type,
      annual_expenses: args.annual_expenses,
      council_rates: args.council_rates,
      water_rates: args.water_rates,
      property_management_percent: args.property_management_percent,
      insurance: args.insurance,
      strata: args.strata,
      maintenance: args.maintenance,
      vacancy_weeks: args.vacancy_weeks,
    });
  },
});

// ---------------------------------------------------------------------------
// 6. calculate_stamp_duty
// ---------------------------------------------------------------------------
registerTool({
  name: 'calculate_stamp_duty',
  description:
    'Calculate Australian stamp duty (transfer duty) for a property purchase. Returns base duty, FHB concession, foreign/investor surcharges, total duty, and effective rate. Supports all 8 states/territories.',
  parameters: {
    type: 'object',
    properties: {
      property_value: { type: 'number' },
      state: { type: 'string', enum: ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT'] },
      intent: { type: 'string', enum: ['owner_occupier', 'investor'] },
      category: { type: 'string', enum: ['established', 'new', 'vacant_land'] },
      is_first_home_buyer: { type: 'boolean' },
      is_foreign_buyer: { type: 'boolean' },
      off_the_plan_construction_fraction: { type: 'number', description: 'VIC only — fraction (0–1) of price representing future construction.' },
    },
    required: ['property_value', 'state', 'intent'],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    return calculateStampDuty({
      propertyValue: pick(args.property_value, d.property_value) ?? 0,
      state: (args.state || d.state) as any,
      intent: args.intent,
      category: args.category,
      isFirstHomeBuyer: args.is_first_home_buyer,
      isForeignBuyer: args.is_foreign_buyer,
      offThePlanConstructionFraction: args.off_the_plan_construction_fraction,
    });
  },
});

// ---------------------------------------------------------------------------
// 7. calculate_scenario_delta
// ---------------------------------------------------------------------------
registerTool({
  name: 'calculate_scenario_delta',
  description:
    'Compare two mortgage scenarios (e.g. rate +1%, switch to interest-only, weekly vs monthly repayments) and report the monthly/annual/lifetime-interest delta. Use to answer "what if" questions.',
  parameters: {
    type: 'object',
    properties: {
      loan_amount: { type: 'number' },
      loan_term_years: { type: 'number' },
      baseline: {
        type: 'object',
        properties: {
          annual_rate_percent: { type: 'number' },
          loan_type: { type: 'string', enum: ['principal_interest', 'interest_only'] },
          frequency: { type: 'string', enum: ['weekly', 'fortnightly', 'monthly'] },
        },
        required: ['annual_rate_percent'],
        additionalProperties: false,
      },
      scenario: {
        type: 'object',
        properties: {
          annual_rate_percent: { type: 'number' },
          loan_type: { type: 'string', enum: ['principal_interest', 'interest_only'] },
          frequency: { type: 'string', enum: ['weekly', 'fortnightly', 'monthly'] },
          io_term_years: { type: 'number' },
        },
        additionalProperties: false,
      },
    },
    required: ['loan_amount', 'loan_term_years', 'baseline', 'scenario'],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    return calculateScenarioDelta({
      loan_amount: pick(args.loan_amount, d.loan_amount) ?? 0,
      loan_term_years: pick(args.loan_term_years, d.loan_term_years) ?? 30,
      baseline: args.baseline,
      scenario: args.scenario,
    });
  },
});

// ---------------------------------------------------------------------------
// 8. analyze_property_financials (edge-fn-backed)
//    Calls the full financial-calculator-service for a multi-year projection.
// ---------------------------------------------------------------------------
registerTool({
  name: 'analyze_property_financials',
  description:
    'Run a full multi-year property financial analysis using live interest rates, LVR-tiered pricing, projected capital growth, rent growth, equity build-up and cash flow. Heavier than individual calculators — use when the user asks for a 5/10-year outlook or ROI projection.',
  parameters: {
    type: 'object',
    properties: {
      property_value: { type: 'number' },
      deposit: { type: 'number' },
      weekly_rent: { type: 'number' },
      state: { type: 'string', enum: ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT'] },
      property_type: { type: 'string', enum: ['house', 'unit', 'townhouse'] },
      loan_term_years: { type: 'number' },
      interest_rate_percent: { type: 'number', description: 'Override interest rate. Omit to use live LVR-tiered rates.' },
      borrower_type: { type: 'string', enum: ['owner_occupier', 'investor'] },
      is_first_home_buyer: { type: 'boolean' },
      is_new_build: { type: 'boolean' },
      capital_growth_rate_percent: { type: 'number' },
      cpi_growth_rate_percent: { type: 'number' },
      rent_growth_rate_percent: { type: 'number' },
    },
    required: ['property_value', 'state'],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    const propertyValue = pick(args.property_value, d.property_value) ?? 0;
    const weeklyRent = pick(args.weekly_rent, d.weekly_rent) ?? 0;
    const deposit = pick(args.deposit, d.deposit) ?? Math.round(propertyValue * 0.2);
    const { data, error } = await ctx.supabase.functions.invoke('financial-calculator-service', {
      body: {
        propertyValue,
        deposit,
        weeklyRent,
        state: args.state || d.state,
        propertyType: args.property_type || 'house',
        loanTerm: args.loan_term_years ?? d.loan_term_years ?? 30,
        interestRate: args.interest_rate_percent ?? d.interest_rate_percent,
        borrowerType: args.borrower_type || 'investor',
        isFirstHomeBuyer: args.is_first_home_buyer,
        isNewBuild: args.is_new_build,
        capitalGrowthRate: args.capital_growth_rate_percent,
        cpiGrowthRate: args.cpi_growth_rate_percent,
        rentGrowthRate: args.rent_growth_rate_percent,
      },
    });
    if (error) throw new Error(`financial-calculator-service failed: ${error.message}`);
    return data;
  },
});

// ---------------------------------------------------------------------------
// 9. estimate_borrowing_capacity (edge-fn-backed)
// ---------------------------------------------------------------------------
registerTool({
  name: 'estimate_borrowing_capacity',
  description:
    'Estimate the borrower\'s maximum borrowing capacity using the unified policy engine (net contribution model, lender shading, LVR caps). Use when the user asks "how much can I borrow?" or "what\'s my serviceability?".',
  parameters: {
    type: 'object',
    properties: {
      client_id: { type: 'string', description: 'Optional client UUID to pull income/liabilities from the database.' },
      gross_annual_income: { type: 'number' },
      partner_gross_annual_income: { type: 'number' },
      monthly_living_expenses: { type: 'number' },
      existing_monthly_repayments: { type: 'number' },
      dependants: { type: 'number' },
      target_property_value: { type: 'number' },
      target_state: { type: 'string', enum: ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT'] },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const { data, error } = await ctx.supabase.functions.invoke('calculate-borrowing-capacity', {
      body: {
        clientId: args.client_id,
        grossAnnualIncome: args.gross_annual_income,
        partnerGrossAnnualIncome: args.partner_gross_annual_income,
        monthlyLivingExpenses: args.monthly_living_expenses,
        existingMonthlyRepayments: args.existing_monthly_repayments,
        dependants: args.dependants,
        targetPropertyValue: args.target_property_value,
        targetState: args.target_state,
      },
    });
    if (error) throw new Error(`calculate-borrowing-capacity failed: ${error.message}`);
    return data;
  },
});

// ---------------------------------------------------------------------------
// 10. estimate_property_expenses (edge-fn-backed)
// ---------------------------------------------------------------------------
registerTool({
  name: 'estimate_property_expenses',
  description:
    'Estimate annual holding expenses for a property (council rates, water, insurance, PM, maintenance, strata if applicable) based on postcode/state and property type.',
  parameters: {
    type: 'object',
    properties: {
      property_value: { type: 'number' },
      weekly_rent: { type: 'number' },
      state: { type: 'string', enum: ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT'] },
      postcode: { type: 'string' },
      property_type: { type: 'string', enum: ['house', 'unit', 'townhouse'] },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    const { data, error } = await ctx.supabase.functions.invoke('estimate-property-expenses', {
      body: {
        propertyValue: pick(args.property_value, d.property_value),
        weeklyRent: pick(args.weekly_rent, d.weekly_rent),
        state: args.state || d.state,
        postcode: args.postcode || d.postcode,
        propertyType: args.property_type || 'house',
      },
    });
    if (error) throw new Error(`estimate-property-expenses failed: ${error.message}`);
    return data;
  },
});

// ===========================================================================
// Phase 2.3 — Live-data tools
// Each wraps an existing edge function (ABS, Domain, climate, crime,
// location intelligence, listing scraper) so the agent can fetch
// suburb-level market context on demand. All auto-fill suburb/state/
// postcode from the attached report(s) when not specified.
// ===========================================================================

const AU_STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT'] as const;

async function invokeService(
  ctx: AgentToolContext,
  fnName: string,
  body: Record<string, any>,
): Promise<any> {
  const { data, error } = await ctx.supabase.functions.invoke(fnName, { body });
  if (error) throw new Error(`${fnName} failed: ${error.message}`);
  if (data && data.success === false) {
    throw new Error(`${fnName} error: ${data.error || 'unknown'}`);
  }
  return data?.data ?? data;
}

// 11. get_abs_demographics --------------------------------------------------
registerTool({
  name: 'get_abs_demographics',
  description:
    'Fetch ABS Census demographics (population, median age, household income, family composition, education) for a suburb/postcode. Auto-fills suburb/state/postcode from the report when omitted.',
  parameters: {
    type: 'object',
    properties: {
      suburb: { type: 'string' },
      state: { type: 'string', enum: [...AU_STATES] },
      postcode: { type: 'string' },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    return invokeService(ctx, 'abs-data-service', {
      suburb: args.suburb ?? d.suburb,
      state: args.state ?? d.state,
      postcode: args.postcode ?? d.postcode,
    });
  },
});

// 12. get_abs_seifa ---------------------------------------------------------
registerTool({
  name: 'get_abs_seifa',
  description:
    'Fetch ABS SEIFA socio-economic index scores (IRSAD, IRSD, IER, IEO) and decile rankings for a postcode. Indicates relative advantage/disadvantage.',
  parameters: {
    type: 'object',
    properties: {
      postcode: { type: 'string' },
      state: { type: 'string', enum: [...AU_STATES] },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    return invokeService(ctx, 'abs-seifa-service', {
      postcode: args.postcode ?? d.postcode,
      state: args.state ?? d.state,
    });
  },
});

// 13. get_abs_employment ----------------------------------------------------
registerTool({
  name: 'get_abs_employment',
  description:
    'Fetch ABS labour-force employment data (employment/unemployment/participation rates, top industries, median income) for a state and suburb/postcode.',
  parameters: {
    type: 'object',
    properties: {
      suburb: { type: 'string' },
      state: { type: 'string', enum: [...AU_STATES] },
      postcode: { type: 'string' },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    return invokeService(ctx, 'abs-employment-service', {
      suburb: args.suburb ?? d.suburb,
      state: args.state ?? d.state,
      postcode: args.postcode ?? d.postcode,
    });
  },
});

// 14. get_climate_risk ------------------------------------------------------
registerTool({
  name: 'get_climate_risk',
  description:
    'Fetch climate and natural-hazard risk data (flood, bushfire, cyclone, heatwave, coastal erosion) for a suburb/postcode.',
  parameters: {
    type: 'object',
    properties: {
      suburb: { type: 'string' },
      state: { type: 'string', enum: [...AU_STATES] },
      postcode: { type: 'string' },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    return invokeService(ctx, 'climate-data-service', {
      suburb: args.suburb ?? d.suburb,
      state: args.state ?? d.state,
      postcode: args.postcode ?? d.postcode,
    });
  },
});

// 15. get_crime_statistics --------------------------------------------------
registerTool({
  name: 'get_crime_statistics',
  description:
    'Fetch crime statistics (overall rate, breakdown by category, trend vs state average) for a suburb/postcode.',
  parameters: {
    type: 'object',
    properties: {
      suburb: { type: 'string' },
      state: { type: 'string', enum: [...AU_STATES] },
      postcode: { type: 'string' },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    return invokeService(ctx, 'crime-statistics-service', {
      suburb: args.suburb ?? d.suburb,
      state: args.state ?? d.state,
      postcode: args.postcode ?? d.postcode,
    });
  },
});

// 16. get_domain_market_stats ----------------------------------------------
registerTool({
  name: 'get_domain_market_stats',
  description:
    'Fetch Domain suburb performance statistics (12-month median price, growth, days on market, sales volume, rental yield) for houses or units.',
  parameters: {
    type: 'object',
    properties: {
      suburb: { type: 'string' },
      state: { type: 'string', enum: [...AU_STATES] },
      postcode: { type: 'string' },
      property_category: { type: 'string', enum: ['house', 'unit'] },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    return invokeService(ctx, 'domain-data-service', {
      suburb: args.suburb ?? d.suburb,
      state: args.state ?? d.state,
      postcode: args.postcode ?? d.postcode,
      propertyCategory: args.property_category || 'house',
    });
  },
});

// 17. get_location_intelligence --------------------------------------------
registerTool({
  name: 'get_location_intelligence',
  description:
    'Fetch location intelligence for an address: commute times, nearby amenities (schools, transport, shopping, healthcare), walkability score, and proximity rankings.',
  parameters: {
    type: 'object',
    properties: {
      address: { type: 'string' },
      suburb: { type: 'string' },
      state: { type: 'string', enum: [...AU_STATES] },
      postcode: { type: 'string' },
    },
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    const address = args.address ?? d.address;
    if (!address) throw new Error('address required (and not found in report)');
    return invokeService(ctx, 'location-intelligence-service', {
      address,
      suburb: args.suburb ?? d.suburb,
      state: args.state ?? d.state,
      postcode: args.postcode ?? d.postcode,
    });
  },
});

// 18. scrape_property_listing ----------------------------------------------
registerTool({
  name: 'scrape_property_listing',
  description:
    'Queue an asynchronous scrape of a public property listing URL (realestate.com.au, domain.com.au, etc.). Returns a job ID and queued status without waiting for the scrape to finish. Use when the user pastes a listing URL.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Public listing URL.' },
    },
    required: ['url'],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    if (!args.url) throw new Error('url is required');
    const queued = await invokeService(ctx, 'scrape-property-listing', { url: args.url });
    if (!queued?.jobId) throw new Error('scrape-property-listing did not return a job id');
    return {
      jobId: queued.jobId,
      status: queued.status || 'queued',
      message: 'The property scrape was queued and will continue asynchronously.',
    };
  },
});

// ---------------------------------------------------------------------------
// 19. run_property_scenarios (composite scenario modeling — Phase 2.4)
//     Computes a baseline cash-flow + N user-defined scenario variants in one
//     call so the model can answer "what if rates rise 1% AND rent drops 10%"
//     without chaining many tool calls.
// ---------------------------------------------------------------------------
registerTool({
  name: 'run_property_scenarios',
  description:
    'Run multi-scenario "what-if" modelling on a single property: returns the baseline cash-flow + repayments plus N user-defined scenario variants (rate change, rent change, vacancy spike, expense change, loan-type switch, repayment frequency change). Use for "what if rates rise 1%", "what if rent drops 10% and vacancy doubles", or sensitivity tables. Each variant returns full cash-flow numbers and the delta vs baseline.',
  parameters: {
    type: 'object',
    properties: {
      baseline: {
        type: 'object',
        description: 'Baseline assumptions. Missing values auto-fill from the attached report.',
        properties: {
          property_value: { type: 'number' },
          weekly_rent: { type: 'number' },
          loan_amount: { type: 'number' },
          annual_rate_percent: { type: 'number' },
          loan_term_years: { type: 'number' },
          loan_type: { type: 'string', enum: ['principal_interest', 'interest_only'] },
          annual_expenses: { type: 'number' },
          property_management_percent: { type: 'number' },
          vacancy_weeks: { type: 'number' },
        },
        additionalProperties: false,
      },
      scenarios: {
        type: 'array',
        description: 'List of scenario variants. Each entry inherits unspecified fields from the baseline.',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Short human label, e.g. "Rates +1%" or "Rent -10% & vacancy 6wk".' },
            rate_delta_percent: { type: 'number', description: 'Add to baseline annual_rate_percent (e.g. 1 = +1%).' },
            annual_rate_percent: { type: 'number', description: 'Absolute rate override (mutually exclusive with rate_delta_percent).' },
            rent_change_percent: { type: 'number', description: 'Percentage change to weekly_rent (e.g. -10 = drop 10%).' },
            weekly_rent: { type: 'number', description: 'Absolute weekly rent override.' },
            vacancy_weeks: { type: 'number' },
            expense_change_percent: { type: 'number', description: 'Percentage change applied to total annual expenses.' },
            annual_expenses: { type: 'number', description: 'Absolute expense override.' },
            loan_type: { type: 'string', enum: ['principal_interest', 'interest_only'] },
            frequency: { type: 'string', enum: ['weekly', 'fortnightly', 'monthly'] },
          },
          required: ['label'],
          additionalProperties: false,
        },
        minItems: 1,
        maxItems: 6,
      },
    },
    required: ['scenarios'],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const d = reportDefaults(ctx);
    const b = args.baseline || {};
    const baseInputs = {
      property_value: pick(b.property_value, d.property_value) ?? 0,
      weekly_rent: pick(b.weekly_rent, d.weekly_rent) ?? 0,
      loan_amount: pick(b.loan_amount, d.loan_amount) ?? 0,
      annual_rate_percent: pick(b.annual_rate_percent, d.interest_rate_percent) ?? 6.0,
      loan_term_years: pick(b.loan_term_years, d.loan_term_years) ?? 30,
      loan_type: (b.loan_type || 'principal_interest') as 'principal_interest' | 'interest_only',
      annual_expenses: b.annual_expenses,
      property_management_percent: b.property_management_percent,
      vacancy_weeks: b.vacancy_weeks ?? 2,
    };

    const computeOne = (overrides: any) => {
      const rate = overrides.annual_rate_percent ??
        (baseInputs.annual_rate_percent + (overrides.rate_delta_percent ?? 0));
      const weeklyRent = overrides.weekly_rent ??
        baseInputs.weekly_rent * (1 + ((overrides.rent_change_percent ?? 0) / 100));
      const vacancyWeeks = overrides.vacancy_weeks ?? baseInputs.vacancy_weeks;
      const loanType = overrides.loan_type ?? baseInputs.loan_type;
      const frequency = (overrides.frequency ?? 'monthly') as 'weekly' | 'fortnightly' | 'monthly';

      let annualExpenses = overrides.annual_expenses ?? baseInputs.annual_expenses;
      if (annualExpenses == null && overrides.expense_change_percent != null) {
        // Apply % delta to default expense profile by computing baseline cashflow first
        const baseCF = calculateCashFlow({
          weekly_rent: baseInputs.weekly_rent,
          loan_amount: baseInputs.loan_amount,
          annual_rate_percent: baseInputs.annual_rate_percent,
          loan_term_years: baseInputs.loan_term_years,
          loan_type: baseInputs.loan_type,
          annual_expenses: baseInputs.annual_expenses,
          property_management_percent: baseInputs.property_management_percent,
          vacancy_weeks: baseInputs.vacancy_weeks,
        });
        annualExpenses = Math.round(baseCF.annual_expenses_total * (1 + overrides.expense_change_percent / 100));
      }

      const repayment = calculateMortgageRepayment({
        loan_amount: baseInputs.loan_amount,
        annual_rate_percent: rate,
        loan_term_years: baseInputs.loan_term_years,
        loan_type: loanType,
        frequency,
      });
      const cashflow = calculateCashFlow({
        weekly_rent: weeklyRent,
        loan_amount: baseInputs.loan_amount,
        annual_rate_percent: rate,
        loan_term_years: baseInputs.loan_term_years,
        loan_type: loanType,
        annual_expenses: annualExpenses,
        property_management_percent: baseInputs.property_management_percent,
        vacancy_weeks: vacancyWeeks,
      });
      return {
        inputs: { annual_rate_percent: rate, weekly_rent: Math.round(weeklyRent), vacancy_weeks: vacancyWeeks, loan_type: loanType, frequency, annual_expenses: annualExpenses ?? cashflow.annual_expenses_total },
        repayment,
        cashflow,
      };
    };

    const baseline = computeOne({});
    const scenarios = (args.scenarios as any[]).map((s) => {
      const result = computeOne(s);
      return {
        label: s.label,
        ...result,
        delta_vs_baseline: {
          monthly_repayment: Math.round((result.repayment.monthly_equivalent - baseline.repayment.monthly_equivalent) * 100) / 100,
          annual_cash_flow: result.cashflow.annual_cash_flow - baseline.cashflow.annual_cash_flow,
          weekly_cash_flow: result.cashflow.weekly_cash_flow - baseline.cashflow.weekly_cash_flow,
        },
      };
    });

    return {
      baseline,
      scenarios,
      summary:
        `Baseline weekly cash flow $${baseline.cashflow.weekly_cash_flow.toLocaleString()}. ` +
        scenarios.map((s) => `${s.label}: $${s.cashflow.weekly_cash_flow.toLocaleString()}/wk (Δ $${s.delta_vs_baseline.weekly_cash_flow.toLocaleString()})`).join('; ') + '.',
    };
  },
});

// ---------------------------------------------------------------------------
// 20. create_client_reminder (Phase 4 — action handoff)
//     Lets the agent create a follow-up reminder / task tied to a client.
//     Uses the existing client_reminders table so it shows up in the normal
//     reminders pipeline + notifications.
// ---------------------------------------------------------------------------
registerTool({
  name: 'create_client_reminder',
  description:
    'Create a follow-up reminder or task tied to a client. Use when the user says "remind me to call X next week", "schedule a follow-up", "create a task to review this in 30 days", etc. Returns the reminder ID. Requires client_id to be passed in or available on the conversation; otherwise, asks the user to specify a client.',
  parameters: {
    type: 'object',
    properties: {
      client_id: { type: 'string', description: 'UUID of the client. Falls back to the conversation\'s linked client when omitted.' },
      title: { type: 'string', description: 'Short title (e.g. "Call about Lismore deal").' },
      description: { type: 'string', description: 'Optional longer description / notes for the reminder.' },
      due_date: { type: 'string', description: 'ISO-8601 timestamp for when the reminder is due (e.g. 2026-06-01T09:00:00Z).' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Priority. Defaults to medium.' },
      reminder_type: { type: 'string', enum: ['follow_up', 'call', 'email', 'meeting', 'review', 'other'], description: 'Type of reminder.' },
    },
    required: ['title', 'due_date'],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    let clientId: string | null = args.client_id || null;
    // Fall back to conversation's linked client_id
    if (!clientId && ctx.conversationId) {
      const { data: conv } = await ctx.supabase
        .from('report_qa_conversations')
        .select('client_id')
        .eq('id', ctx.conversationId)
        .maybeSingle();
      clientId = conv?.client_id || null;
    }
    if (!clientId) {
      throw new Error('client_id is required — link this conversation to a client or pass client_id explicitly.');
    }
    if (!ctx.userId) throw new Error('userId required to create reminder.');

    const { data, error } = await ctx.supabase
      .from('client_reminders')
      .insert({
        client_id: clientId,
        title: args.title,
        description: args.description || null,
        due_date: args.due_date,
        priority: args.priority || 'medium',
        reminder_type: args.reminder_type || 'follow_up',
        status: 'pending',
        created_by: ctx.userId,
        assigned_to: [ctx.userId],
        reminder_scope: 'client',
      })
      .select('id, title, due_date, priority')
      .single();

    if (error) throw new Error(`Failed to create reminder: ${error.message}`);
    return {
      reminder_id: data.id,
      title: data.title,
      due_date: data.due_date,
      priority: data.priority,
      summary: `Created ${data.priority} priority reminder "${data.title}" due ${new Date(data.due_date).toLocaleString('en-AU')}.`,
    };
  },
});

// Re-export for convenience / type-checking from importers.
export { extractReportMetrics };
