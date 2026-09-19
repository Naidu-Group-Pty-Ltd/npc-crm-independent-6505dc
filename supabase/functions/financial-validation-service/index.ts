import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { calculateStampDuty } from '../_shared/stampDuty/engine.pure.ts';
import { AUSTRALIAN_STATES, type AustralianState } from '../_shared/stampDuty/types.pure.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface ValidationInput {
  propertyValue: number;
  weeklyRent: number;
  stampDuty: number;
  councilRates: number;
  annualCosts?: any;
  state: string;
  propertyType?: string;
}

interface ValidationFlag {
  type: 'warning' | 'error' | 'info';
  severity: 'critical' | 'high' | 'medium' | 'low';
  field: string;
  message: string;
  value: number | string;
  expected_range?: string;
  recommendation?: string;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  console.log('Financial validation service invoked with method:', req.method);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json();
    const input: ValidationInput = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[financial-validation-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[financial-validation-service] Authenticated user: ${userId}`);
    console.log('Validating financial calculations for:', input);

    const validationFlags = validateFinancialCalculations(input);
    
    return new Response(JSON.stringify({ 
      success: true, 
      data: {
        isValid: validationFlags.filter(f => f.type === 'error').length === 0,
        flags: validationFlags,
        qualityScore: calculateQualityScore(validationFlags)
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in financial validation service:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to validate financial calculations';
    return new Response(JSON.stringify({ 
      error: errorMessage,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function validateFinancialCalculations(input: ValidationInput): ValidationFlag[] {
  const flags: ValidationFlag[] = [];

  // 1. STAMP DUTY — measured against the CANONICAL schedule, not a band
  //
  // RF-7.2B.1B0. This used to judge duty against a hand-written table of
  // percentage bands kept in this file, which is a second implementation of a
  // figure CLAUDE.md says lives in exactly one place. The two disagreed
  // constantly, and the band was the one that was wrong: a stored NSW duty of
  // $19,162 on $555,000 — 3.453%, the canonical 2026-27 answer to the dollar —
  // fell below this file's own 3.5% floor and was flagged `critical` with the
  // recommendation "verify stamp duty calculation uses correct progressive
  // brackets", against a calculation that had used them.
  //
  // Swept against the engine over $150k-$2m in $10k steps: NSW 117 of 186
  // prices spuriously critical (62.9%, from $300k to $1.87m), ACT 42, QLD 19,
  // NT 16, VIC 5. Each one cost 20 points of the quality score.
  //
  // Duty in this product is produced by `_shared/stampDuty`, so comparing
  // against that engine is comparing like with like and a real difference is a
  // real defect. The tolerance is for ROUNDING only — deliberately tight,
  // because widening a tolerance until it stops complaining is how a check
  // stops checking.
  const dutyState = AUSTRALIAN_STATES.includes(String(input.state ?? '').toUpperCase() as AustralianState)
    ? String(input.state).toUpperCase() as AustralianState
    : null;
  if (dutyState && input.propertyValue > 0) {
    const canonical = calculateStampDuty({
      propertyValue: input.propertyValue,
      state: dutyState,
      // Investment reports. The engine's own note: no Australian jurisdiction
      // levies a separate investor surcharge at acquisition — the investor
      // position is expressed by WHICH SCALE applies, not by an add-on.
      intent: 'investor',
      category: 'established',
    });
    // A state with no loaded schedule assesses zero; that is a fact about the
    // schedule table, not a finding about this report's arithmetic.
    if (canonical.totalDuty > 0) {
      const difference = Math.abs(input.stampDuty - canonical.totalDuty);
      const tolerance = Math.max(2, canonical.totalDuty * 0.001);
      if (difference > tolerance) {
        flags.push({
          type: 'error',
          severity: 'critical',
          field: 'stamp_duty',
          message:
            `Stamp duty of $${Math.round(input.stampDuty).toLocaleString('en-AU')} does not match the `
            + `${canonical.scheduleYear} ${dutyState} schedule, which assesses `
            + `$${Math.round(canonical.totalDuty).toLocaleString('en-AU')} on a purchase price of `
            + `$${Math.round(input.propertyValue).toLocaleString('en-AU')}`,
          value: input.stampDuty,
          expected_range: `$${Math.round(canonical.totalDuty).toLocaleString('en-AU')} (${dutyState} ${canonical.scheduleYear})`,
          recommendation:
            'Recalculate through the canonical stamp-duty engine, or record the concession or '
            + 'surcharge that explains the difference.',
        });
      }
    }
  }

  // 2. COUNCIL RATES VALIDATION ($1,000 - $5,000 typical range for residential)
  if (input.councilRates < 800 || input.councilRates > 6000) {
    const severity = input.councilRates < 500 || input.councilRates > 8000 ? 'high' : 'medium';
    flags.push({
      type: severity === 'high' ? 'error' : 'warning',
      severity,
      field: 'council_rates',
      message: `Council rates of $${input.councilRates.toLocaleString()} are ${input.councilRates < 800 ? 'unusually low' : 'unusually high'}`,
      value: input.councilRates,
      expected_range: '$1,000 - $5,000 annually',
      recommendation: 'Verify with local council actual rates for this property'
    });
  }

  // 3. GROSS RENTAL YIELD VALIDATION (2% - 8% typical range)
  const annualRent = input.weeklyRent * 52;
  const grossYield = (annualRent / input.propertyValue) * 100;
  
  if (grossYield < 1.5 || grossYield > 10) {
    flags.push({
      type: grossYield < 1 || grossYield > 12 ? 'error' : 'warning',
      severity: grossYield < 1 || grossYield > 12 ? 'high' : 'medium',
      field: 'rental_yield',
      message: `Gross yield of ${grossYield.toFixed(2)}% is ${grossYield < 1.5 ? 'very low' : 'very high'} for Australian property market`,
      value: grossYield,
      expected_range: '2.5% - 7% typical range',
      recommendation: grossYield < 1.5 
        ? 'Verify rent estimate is accurate - may indicate capital city premium property'
        : 'Verify rent estimate is realistic - may indicate regional or high-yield area'
    });
  }

  // 4. WATER RATES VALIDATION ($800 - $2,000 typical)
  if (input.annualCosts?.waterRates) {
    if (input.annualCosts.waterRates < 600 || input.annualCosts.waterRates > 2500) {
      flags.push({
        type: 'warning',
        severity: 'low',
        field: 'water_rates',
        message: `Water rates of $${input.annualCosts.waterRates} are outside typical range`,
        value: input.annualCosts.waterRates,
        expected_range: '$800 - $1,800 annually',
        recommendation: 'Verify with local water authority'
      });
    }
  }

  // 5. LANDLORD INSURANCE VALIDATION (0.5% - 2% of annual rent)
  if (input.annualCosts?.landlordInsurance) {
    const insurancePercentage = (input.annualCosts.landlordInsurance / annualRent) * 100;
    if (insurancePercentage < 0.3 || insurancePercentage > 3) {
      flags.push({
        type: 'warning',
        severity: 'low',
        field: 'landlord_insurance',
        message: `Landlord insurance of ${insurancePercentage.toFixed(2)}% of annual rent is outside typical range`,
        value: input.annualCosts.landlordInsurance,
        expected_range: '0.8% - 1.5% of annual rent',
        recommendation: 'Review insurance quotes for this property type and location'
      });
    }
  }

  // 6. PROPERTY MANAGEMENT FEES VALIDATION (6% - 10% of rent typical)
  if (input.annualCosts?.propertyManagement) {
    const managementPercentage = (input.annualCosts.propertyManagement / annualRent) * 100;
    if (managementPercentage < 4 || managementPercentage > 12) {
      flags.push({
        type: 'warning',
        severity: 'low',
        field: 'property_management',
        message: `Property management fee of ${managementPercentage.toFixed(2)}% is ${managementPercentage < 4 ? 'very low' : 'very high'}`,
        value: input.annualCosts.propertyManagement,
        expected_range: '6% - 9% of annual rent',
        recommendation: managementPercentage > 10 
          ? 'Consider negotiating or comparing with other property managers'
          : 'Verify this includes all standard management services'
      });
    }
  }

  // 7. STRATA FEES VALIDATION (units only, $3,000 - $8,000 typical)
  if (input.propertyType === 'unit' && input.annualCosts?.strataFees) {
    if (input.annualCosts.strataFees < 2000 || input.annualCosts.strataFees > 10000) {
      flags.push({
        type: 'warning',
        severity: 'medium',
        field: 'strata_fees',
        message: `Strata fees of $${input.annualCosts.strataFees.toLocaleString()} are ${input.annualCosts.strataFees < 2000 ? 'unusually low' : 'unusually high'}`,
        value: input.annualCosts.strataFees,
        expected_range: '$3,000 - $7,000 annually',
        recommendation: input.annualCosts.strataFees > 8000
          ? 'High strata fees may indicate building issues or extensive amenities - review strata report'
          : 'Verify actual strata fees from body corporate'
      });
    }
  }

  // 8. MAINTENANCE COSTS VALIDATION ($1,000 - $3,000 typical for residential)
  if (input.annualCosts?.maintenance) {
    if (input.annualCosts.maintenance < 500 || input.annualCosts.maintenance > 5000) {
      flags.push({
        type: 'info',
        severity: 'low',
        field: 'maintenance',
        message: `Annual maintenance budget of $${input.annualCosts.maintenance.toLocaleString()} is ${input.annualCosts.maintenance < 500 ? 'very low' : 'high'}`,
        value: input.annualCosts.maintenance,
        expected_range: '$1,200 - $2,500 annually',
        recommendation: input.annualCosts.maintenance < 800
          ? 'Consider budgeting 0.5-1% of property value for maintenance'
          : 'High budget may be appropriate for older properties'
      });
    }
  }

  return flags;
}


function calculateQualityScore(flags: ValidationFlag[]): number {
  let score = 100;
  
  for (const flag of flags) {
    if (flag.type === 'error') {
      score -= flag.severity === 'critical' ? 20 : 10;
    } else if (flag.type === 'warning') {
      score -= flag.severity === 'high' ? 10 : flag.severity === 'medium' ? 5 : 2;
    } else if (flag.type === 'info') {
      score -= 1;
    }
  }
  
  return Math.max(0, score);
}
