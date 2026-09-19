import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { calculateStampDuty } from '../_shared/stampDuty/index.pure.ts';
import { coerceState, resolveSchedule } from '../_shared/stampDuty/scheduleStore.ts';
// Every figure this service publishes is computed by the pure engine, which
// is where the arithmetic is documented and pinned by tests. This file only
// orchestrates: auth, the stamp-duty schedule, the CPI cache, HTTP.
import {
  calculateAnnualCosts,
  calculateKeyMetrics,
  calculateSensitivityAnalysis,
  describeLoanStructure,
  generateProjections,
  getInterestRateByLVR,
  ledgerForInput,
  occupancyWeeksOf,
  type CpiProjection,
  type LoanCalculationInput,
} from '../_shared/reports/investment/financialEngine.pure.ts';
import { cpiProjectionsFromMeasured, quarterLabel } from '../_shared/rbaReading.pure.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  console.log('Financial calculator service invoked with method:', req.method);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim();
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // SECURITY: Verify authentication
    const body = await req.json();
    const input: LoanCalculationInput = body;

    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[financial-calculator-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[financial-calculator-service] Authenticated user: ${userId}`);
    console.log('Calculating financial projections for:', input);

    const calculations = await calculateFinancialProjections(input, supabase);

    return new Response(JSON.stringify({
      success: true,
      data: calculations
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in financial calculator service:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to calculate financial projections';
    return new Response(JSON.stringify({
      error: errorMessage,
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function calculateFinancialProjections(input: LoanCalculationInput, supabase: any) {
  const {
    propertyValue,
    deposit,
    loanTerm,
    weeklyRent,
    state,
    propertyType,
    isFirstHomeBuyer = false,
    isNewBuild = false,
    buildType,
    borrowerType = 'investor'
  } = input;

  // Calculate LVR
  const loanAmount = propertyValue - deposit;
  const lvr = (loanAmount / propertyValue) * 100;

  // Get interest rate - use provided rate or fetch LVR-based rate
  const rateInfo = getInterestRateByLVR(lvr, borrowerType, input.interestRate);
  const interestRate = rateInfo.rate;

  // ONE loan ledger for every figure that follows — payment, lifetime
  // interest, the projection balances and the sensitivity — at the frequency
  // the loan repays and for the product the case states. `monthlyPayment` is
  // the first month's repayment: interest alone during an interest-only
  // period, the amortising repayment otherwise (QA-04, QA-05).
  const ledger = ledgerForInput({ ...input, interestRate });
  const monthlyPayment = ledger.firstMonthlyPayment;
  const occupancyWeeks = occupancyWeeksOf(input);

  // Calculate stamp duty with FHB concessions
  const stampDutyResult = await calculateStampDutyWithConcessions(
    propertyValue,
    state,
    supabase,
    isFirstHomeBuyer,
    isNewBuild,
    borrowerType,
    buildType,
  );

  // Calculate ongoing costs. Reviewed figures arrive as INPUT so the totals,
  // projections, sensitivity and metrics all describe them — see
  // overrides.pure.ts for why they must never be splatted over the output.
  const annualCosts = calculateAnnualCosts(propertyValue, weeklyRent, state, propertyType, input.annualCostOverrides, occupancyWeeks);

  // Generate 10-year projections with scenarios
  // If a custom capital growth rate is provided (e.g., from Perplexity research), use it
  // Otherwise, use standard scenario-based rates
  const customCapitalGrowth = input.capitalGrowthRate ? input.capitalGrowthRate / 100 : null;
  const customRentGrowth = input.rentGrowthRate ? input.rentGrowthRate / 100 : null;

  // Fetch live CPI projections from cached economic data
  const cpiProjections = await fetchCpiProjections(supabase);
  const customCpiGrowth = input.cpiGrowthRate ? input.cpiGrowthRate / 100 : null;

  // The growth each scenario is built at, stated ONCE and published beside
  // the series. The report's prose used to hard-code "2% / 4% / 6%" while the
  // series were built at the researched rate ±2 points (QA-10).
  const scenarioGrowth = customCapitalGrowth !== null ? {
    // When custom rate provided, use it as the "moderate" scenario with ±2% for conservative/optimistic
    conservative: { capitalGrowth: Math.max(0, customCapitalGrowth - 0.02), rentGrowth: customRentGrowth || 0.025 },
    moderate: { capitalGrowth: customCapitalGrowth, rentGrowth: customRentGrowth || 0.03 },
    optimistic: { capitalGrowth: customCapitalGrowth + 0.02, rentGrowth: customRentGrowth || 0.035 },
  } : {
    // Default scenario-based rates when no custom rate provided
    conservative: { capitalGrowth: 0.02, rentGrowth: 0.02 },
    moderate: { capitalGrowth: 0.04, rentGrowth: 0.03 },
    optimistic: { capitalGrowth: 0.06, rentGrowth: 0.04 },
  };
  const scenarios = {
    conservative: generateProjections({ ...input, interestRate }, monthlyPayment, annualCosts, scenarioGrowth.conservative.capitalGrowth, scenarioGrowth.conservative.rentGrowth, customCpiGrowth, cpiProjections),
    moderate: generateProjections({ ...input, interestRate }, monthlyPayment, annualCosts, scenarioGrowth.moderate.capitalGrowth, scenarioGrowth.moderate.rentGrowth, customCpiGrowth, cpiProjections),
    optimistic: generateProjections({ ...input, interestRate }, monthlyPayment, annualCosts, scenarioGrowth.optimistic.capitalGrowth, scenarioGrowth.optimistic.rentGrowth, customCpiGrowth, cpiProjections),
  };
  const pctOf = (fraction: number) => Math.round(fraction * 10000) / 100;

  // The upfront position is stated once: these exact lines appear in
  // initialCosts AND fund the cash-on-cash denominator, so the total a
  // report prints always foots against the lines printed above it. An
  // operator-supplied duty or conveyancing figure replaces the estimate in
  // those lines — the schedule assessment is still reported beside it.
  const stampDuty = input.stampDutyOverride ?? stampDutyResult.stampDuty;
  const legalFees = input.legalFeesOverride ?? 1500;
  const inspectionFees = 500;
  const totalUpfront = deposit + stampDuty + rateInfo.lmiEstimate + legalFees + inspectionFees;

  // Calculate key metrics
  const metrics = calculateKeyMetrics(
    { ...input, interestRate },
    monthlyPayment,
    annualCosts,
    totalUpfront
  );

  return {
    initialCosts: {
      propertyValue,
      deposit,
      loanAmount,
      stampDuty,
      stampDutyConcession: stampDutyResult.concession,
      stampDutyBeforeConcession: stampDutyResult.originalAmount,
      fhbEligible: stampDutyResult.fhbEligible,
      // Surfaced so a report can state which financial year's schedule it was
      // assessed against rather than presenting the figure as timeless.
      stampDutyScheduleYear: stampDutyResult.scheduleYear,
      stampDutyScheduleSource: stampDutyResult.scheduleSource,
      lmi: rateInfo.lmiEstimate,
      lmiRequired: rateInfo.lmiRequired,
      legalFees,
      inspectionFees,
      totalUpfront
    },
    loanDetails: {
      monthlyPayment,
      // Lifetime interest on THIS schedule — a 30-year P&I total used to be
      // printed under an "interest only" label (QA-04).
      totalInterest: Math.round(ledger.totalInterest),
      weeklyPayment: monthlyPayment * 12 / 52,
      annualPayment: Math.round(ledger.years[0]?.payments ?? monthlyPayment * 12),
      lvr: Math.round(lvr * 100) / 100,
      lvrTier: rateInfo.lvrTier,
      interestRate: rateInfo.rate,
      rateSource: rateInfo.source,
      borrowerType,
      // The product the arithmetic ran, so the label and the schedule are one
      // fact rather than a display override over unrelated figures.
      loanAmount,
      loanTerm,
      loanType: ledger.loanType,
      interestOnlyPeriod: ledger.interestOnlyYears,
      /**
       * True when the loan said interest-only and no term was recorded, so the
       * ledger used `ASSUMED_INTEREST_ONLY_YEARS`. Published because a reader
       * who sees a five-year interest-only period is entitled to know whether
       * anybody stated it — `structure` says so in words, this says so in a
       * field.
       */
      interestOnlyPeriodAssumed: ledger.interestOnlyYearsAssumed,
      /** The month's interest on the opening balance — what an interest-only period repays. */
      interestOnlyPayment: Math.round((loanAmount * rateInfo.rate / 100 / 12) * 100) / 100,
      amortisingMonthlyPayment: Math.round(ledger.amortisingMonthlyPayment * 100) / 100,
      structure: describeLoanStructure(ledger),
      repaymentBasis: 'monthly ledger',
    },
    // Persist the exact rental input used by every projection. Downstream cash-flow
    // cards and exports read this canonical path, including reports without manual
    // overrides, so the displayed figure cannot drift from the generated series.
    income: {
      weeklyRent,
      annualRent: weeklyRent * 52,
      /** `weeklyRent × occupancyWeeks` — what the cash flow receives (QA-06). */
      effectiveAnnualRent: Math.round(weeklyRent * occupancyWeeks),
      occupancyWeeks,
    },
    annualCosts,
    // The scenario each output was built under, declared once (QA-02, QA-10):
    // occupancy, the fee convention, the growth timing and the growth rates
    // behind each projection scenario. The generator overlays its own
    // `capitalGrowth` / `cpiGrowth` here; these keys are additive.
    assumptions: {
      occupancyWeeks,
      feeBasis: 'collected_rent',
      growthTiming: 'Year-1 figures carry one year of growth; settlement is year 0.',
      scenarioGrowth: {
        conservative: { capitalGrowth: pctOf(scenarioGrowth.conservative.capitalGrowth), rentGrowth: pctOf(scenarioGrowth.conservative.rentGrowth) },
        moderate: { capitalGrowth: pctOf(scenarioGrowth.moderate.capitalGrowth), rentGrowth: pctOf(scenarioGrowth.moderate.rentGrowth) },
        optimistic: { capitalGrowth: pctOf(scenarioGrowth.optimistic.capitalGrowth), rentGrowth: pctOf(scenarioGrowth.optimistic.rentGrowth) },
      },
      loanStructure: describeLoanStructure(ledger),
    },
    keyMetrics: metrics,
    projections: scenarios,
    sensitivityAnalysis: calculateSensitivityAnalysis({ ...input, interestRate }, monthlyPayment, annualCosts),
    interestRateInfo: rateInfo
  };
}

// ============================================
// STAMP DUTY WITH FIRST HOME BUYER CONCESSIONS
// ============================================

interface StampDutyResult {
  stampDuty: number;
  originalAmount: number;
  concession: number;
  fhbEligible: boolean;
  concessionType: string;
  /** Financial year of the schedule used, so a report can cite its basis. */
  scheduleYear: string;
  /** Whether the figures came from the cache or the schedule shipped in code. */
  scheduleSource: 'cache' | 'built-in';
}

/**
 * Stamp duty for the projection.
 *
 * This used to be ~480 lines: eight bracket functions, eight first-home-buyer
 * concession functions, and a cache reader — a third independent copy of the
 * rates alongside `src/utils/` and the `_shared/` "mirror". All three disagreed
 * with each other and none matched the revenue offices. It now delegates to the
 * one engine, with the cache consulted through `resolveSchedule` so an
 * administrator can publish a correction without a deploy.
 */
async function calculateStampDutyWithConcessions(
  propertyValue: number,
  state: string,
  supabase: any,
  isFirstHomeBuyer: boolean,
  isNewBuild: boolean,
  borrowerType: 'owner_occupier' | 'investor' = 'investor',
  buildType?: 'existing_property' | 'new_build' | 'land_only',
): Promise<StampDutyResult> {
  const jurisdiction = coerceState(state);
  const { schedule, source, rejectedReason } = await resolveSchedule(jurisdiction, supabase);
  if (rejectedReason) {
    console.warn(`[financial-calculator-service] ${jurisdiction} using built-in schedule: ${rejectedReason}`);
  }

  // WHAT is being bought. `vacant_land` has always existed in the engine and
  // every state schedule declares a `vacantLand` first-home concession; this
  // caller computed only two of the three, so those schedules were
  // unreachable. Category affects first-home relief only — verified by
  // execution across every state and price for a non-FHB buyer, zero
  // differences — so a non-FHB assessment is unchanged by this line.
  const category = buildType === 'land_only'
    ? 'vacant_land'
    : (buildType === 'new_build' || isNewBuild) ? 'new' : 'established';

  // WHO is buying. `borrowerType` already picks the interest rate on this same
  // request; the duty assessment hardcoded `owner_occupier` and so put an
  // investor on the owner-occupier scale. Measured 2026-09-07: 143 stored
  // reports declare an investor, and in QLD that understated duty by exactly
  // $7,175 at every price tested (ACT $2,992; VIC $3,100 below its $550k
  // owner-occupier ceiling; the other five states share one scale).
  const intent = borrowerType === 'owner_occupier' ? 'owner_occupier' : 'investor';

  // Duty before relief, so the response can still report what the concession
  // was worth. The engine is asked twice rather than reverse-engineering the
  // gross figure from the net one.
  const gross = calculateStampDuty({
    propertyValue,
    state: jurisdiction,
    intent,
    category,
    schedule,
  });

  const assessed = calculateStampDuty({
    propertyValue,
    state: jurisdiction,
    intent,
    category,
    isFirstHomeBuyer,
    schedule,
  });

  const concession = Math.max(0, gross.totalDuty - assessed.totalDuty);

  return {
    stampDuty: assessed.totalDuty,
    originalAmount: gross.totalDuty,
    concession,
    fhbEligible: isFirstHomeBuyer && concession > 0,
    concessionType: isFirstHomeBuyer
      ? (concession > 0 ? assessed.notes.join('; ') : `No first home concession applies in ${jurisdiction} at this value`)
      : 'none',
    scheduleYear: assessed.scheduleYear,
    scheduleSource: source,
  };
}

/**
 * The 10-year CPI path expenses are indexed against: a named assumption
 * (`cpiProjectionsFromMeasured`, the one implementation) converging from
 * the measured year-ended CPI — G1's own GCPIAGYP, loaded from the RBA
 * statistical tables — toward the RBA target midpoint. This used to read a
 * 24-hour cache of a search model's answer and, failing that, run the same
 * convergence arithmetic silently, labelled nowhere; a projection whose
 * label claims a forecast nobody read is a fabrication, so the label now
 * says "Assumption" on every year, including the no-reading flat path.
 */
async function fetchCpiProjections(supabase: any): Promise<CpiProjection[]> {
  try {
    const { data: rows, error } = await supabase
      .from('rba_observations')
      .select('obs_date, value')
      .eq('series_id', 'GCPIAGYP')
      .order('obs_date', { ascending: false })
      .limit(1);

    if (error || !rows || rows.length === 0) {
      console.log('[financial-calculator] No measured CPI loaded — flat target-midpoint assumption');
      return cpiProjectionsFromMeasured(null);
    }

    const latest = rows[0] as { obs_date: string; value: unknown };
    const value = Number(latest.value);
    if (!Number.isFinite(value)) return cpiProjectionsFromMeasured(null);
    return cpiProjectionsFromMeasured({
      value,
      period: latest.obs_date.slice(0, 7),
      periodLabel: quarterLabel(latest.obs_date),
    });
  } catch (err) {
    console.error('[financial-calculator] Error reading measured CPI:', err);
    return cpiProjectionsFromMeasured(null);
  }
}
