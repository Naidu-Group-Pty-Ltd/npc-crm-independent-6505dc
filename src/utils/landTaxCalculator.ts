/**
 * Australian Land Tax Calculator
 * Calculates annual land tax based on state, owner type, and taxable land value
 * Based on 2025 state legislation rates
 */

import { supabase } from '@/integrations/supabase/client';

export type LandTaxOwnerType = 'individual' | 'company_trust' | 'trust' | 'absentee';

export interface LandTaxInput {
  state: string;
  ownerType: LandTaxOwnerType;
  taxableLandValue: number;
  isWAMetro?: boolean; // For WA MRIT calculation
}

export interface LandTaxResult {
  annualLandTax: number;
  baseTax: number;
  marginalTax: number;
  fixedCharge: number;
  mritAddon: number; // WA only
  effectiveRate: number;
  bracket: {
    lowerBound: number;
    upperBound: number;
    marginalRate: number;
  } | null;
  notes: string;
}

export interface LandTaxRateBracket {
  id: string;
  state: string;
  owner_type: string;
  lower_bound: number;
  upper_bound: number;
  base_tax: number;
  marginal_rate: number;
  marginal_threshold: number;
  fixed_charge: number;
  notes: string | null;
}

// Owner type display labels for UI
export const OWNER_TYPE_LABELS: Record<LandTaxOwnerType, string> = {
  individual: 'Individual / Joint Owners',
  company_trust: 'Company / Family Trust',
  trust: 'Trust (surcharge rates)',
  absentee: 'Absentee Owner / Foreign',
};

// Get available owner types for a state
export function getOwnerTypesForState(state: string): LandTaxOwnerType[] {
  switch (state) {
    case 'NSW':
      return ['individual', 'company_trust'];
    case 'VIC':
      return ['individual', 'trust', 'absentee'];
    case 'QLD':
      return ['individual', 'company_trust', 'absentee'];
    case 'WA':
    case 'TAS':
    case 'ACT':
    case 'NT':
      return ['individual'];
    case 'SA':
      return ['individual', 'trust'];
    default:
      return ['individual'];
  }
}

/**
 * Calculate land tax using database rate tables
 */
export async function calculateLandTax(input: LandTaxInput): Promise<LandTaxResult> {
  const { state, ownerType, taxableLandValue, isWAMetro = false } = input;

  console.log('🏠 Land Tax Calculator - Input:', input);

  // Handle NT (no land tax)
  if (state === 'NT') {
    return {
      annualLandTax: 0,
      baseTax: 0,
      marginalTax: 0,
      fixedCharge: 0,
      mritAddon: 0,
      effectiveRate: 0,
      bracket: null,
      notes: 'No land tax in Northern Territory.',
    };
  }

  if (taxableLandValue <= 0) {
    return {
      annualLandTax: 0,
      baseTax: 0,
      marginalTax: 0,
      fixedCharge: 0,
      mritAddon: 0,
      effectiveRate: 0,
      bracket: null,
      notes: 'Land value must be greater than zero.',
    };
  }

  try {
    // Fetch the applicable rate bracket from database
    const { data: brackets, error } = await supabase
      .from('land_tax_rates')
      .select('*')
      .eq('state', state)
      .eq('owner_type', ownerType)
      .lte('lower_bound', taxableLandValue)
      .gt('upper_bound', taxableLandValue)
      .order('lower_bound', { ascending: true })
      .limit(1);

    if (error) {
      console.error('Error fetching land tax rates:', error);
      throw error;
    }

    if (!brackets || brackets.length === 0) {
      console.warn(`No bracket found for ${state}/${ownerType}/${taxableLandValue}`);
      return {
        annualLandTax: 0,
        baseTax: 0,
        marginalTax: 0,
        fixedCharge: 0,
        mritAddon: 0,
        effectiveRate: 0,
        bracket: null,
        notes: `No applicable rate bracket found for ${state}.`,
      };
    }

    const bracket = brackets[0] as LandTaxRateBracket;
    console.log('📊 Found bracket:', bracket);

    // Calculate: BaseTax + (MarginalRate × (LandValue - MarginalThreshold)) + FixedCharge
    const baseTax = Number(bracket.base_tax) || 0;
    const marginalRate = Number(bracket.marginal_rate) || 0;
    const marginalThreshold = Number(bracket.marginal_threshold) || 0;
    const fixedCharge = Number(bracket.fixed_charge) || 0;

    const marginalTax = marginalRate > 0 
      ? Math.max(0, marginalRate * (taxableLandValue - marginalThreshold))
      : 0;

    let landTax = baseTax + marginalTax + fixedCharge;

    // Calculate WA MRIT addon if applicable
    let mritAddon = 0;
    if (state === 'WA' && isWAMetro && landTax > 0) {
      // MRIT = 0.14% of land value above $300,000
      const mritThreshold = 300000;
      if (taxableLandValue > mritThreshold) {
        mritAddon = 0.0014 * (taxableLandValue - mritThreshold);
      }
    }

    const totalTax = Math.round(landTax + mritAddon);
    const effectiveRate = taxableLandValue > 0 ? (totalTax / taxableLandValue) * 100 : 0;

    console.log('💰 Land Tax Calculation:', {
      baseTax,
      marginalTax,
      fixedCharge,
      mritAddon,
      totalTax,
      effectiveRate: effectiveRate.toFixed(3) + '%',
    });

    return {
      annualLandTax: totalTax,
      baseTax,
      marginalTax: Math.round(marginalTax),
      fixedCharge,
      mritAddon: Math.round(mritAddon),
      effectiveRate: parseFloat(effectiveRate.toFixed(3)),
      bracket: {
        lowerBound: Number(bracket.lower_bound),
        upperBound: Number(bracket.upper_bound),
        marginalRate,
      },
      notes: bracket.notes || '',
    };
  } catch (error) {
    console.error('Land tax calculation error:', error);
    // Return fallback calculation using hardcoded rates
    return calculateLandTaxFallback(input);
  }
}

/**
 * Fallback calculation using hardcoded rates (if database unavailable)
 */
function calculateLandTaxFallback(input: LandTaxInput): LandTaxResult {
  const { state, taxableLandValue } = input;
  
  // Simplified fallback - just use basic thresholds
  let landTax = 0;
  let notes = 'Using fallback calculation (database unavailable).';

  switch (state) {
    case 'NSW':
      if (taxableLandValue > 1075000) {
        landTax = 100 + 0.016 * (Math.min(taxableLandValue, 6571000) - 1075000);
        if (taxableLandValue > 6571000) {
          landTax = 88036 + 0.02 * (taxableLandValue - 6571000);
        }
      }
      break;
    case 'VIC':
      if (taxableLandValue > 300000) {
        landTax = 1350 + 0.003 * (taxableLandValue - 300000);
      }
      break;
    case 'QLD':
      if (taxableLandValue > 600000) {
        landTax = 500 + 0.01 * (taxableLandValue - 600000);
      }
      break;
    case 'WA':
      if (taxableLandValue > 420000) {
        landTax = 300 + 0.0025 * (taxableLandValue - 420000);
      }
      break;
    case 'SA':
      if (taxableLandValue > 833000) {
        landTax = 0.005 * (taxableLandValue - 833000);
      }
      break;
    case 'TAS':
      if (taxableLandValue > 125000) {
        landTax = 50 + 0.0045 * (taxableLandValue - 125000);
      }
      break;
    case 'ACT':
      landTax = 1693 + 0.0054 * taxableLandValue; // Simplified ACT
      break;
    default:
      landTax = 0;
  }

  return {
    annualLandTax: Math.round(landTax),
    baseTax: 0,
    marginalTax: Math.round(landTax),
    fixedCharge: 0,
    mritAddon: 0,
    effectiveRate: taxableLandValue > 0 ? parseFloat(((landTax / taxableLandValue) * 100).toFixed(3)) : 0,
    bracket: null,
    notes,
  };
}

/**
 * Synchronous calculation for immediate UI feedback (uses fallback rates)
 */
export function calculateLandTaxSync(input: LandTaxInput): LandTaxResult {
  return calculateLandTaxFallback(input);
}

/**
 * Detect state from Australian address
 */
export function detectStateFromAddress(address: string): string | null {
  if (!address) return null;
  
  const upperAddress = address.toUpperCase();
  const statePatterns: Record<string, RegExp[]> = {
    NSW: [/\bNSW\b/, /\sNSW\s*\d{4}/, /,\s*NSW\s/, /NEW SOUTH WALES/],
    VIC: [/\bVIC\b/, /\sVIC\s*\d{4}/, /,\s*VIC\s/, /VICTORIA/],
    QLD: [/\bQLD\b/, /\sQLD\s*\d{4}/, /,\s*QLD\s/, /QUEENSLAND/],
    WA: [/\bWA\b/, /\sWA\s*\d{4}/, /,\s*WA\s/, /WESTERN AUSTRALIA/],
    SA: [/\bSA\b/, /\sSA\s*\d{4}/, /,\s*SA\s/, /SOUTH AUSTRALIA/],
    TAS: [/\bTAS\b/, /\sTAS\s*\d{4}/, /,\s*TAS\s/, /TASMANIA/],
    ACT: [/\bACT\b/, /\sACT\s*\d{4}/, /,\s*ACT\s/, /AUSTRALIAN CAPITAL/],
    NT: [/\bNT\b/, /\sNT\s*\d{4}/, /,\s*NT\s/, /NORTHERN TERRITORY/],
  };

  for (const [state, patterns] of Object.entries(statePatterns)) {
    if (patterns.some(p => p.test(upperAddress))) {
      return state;
    }
  }

  return null;
}

/**
 * Check if a WA postcode is in the Perth metro area (for MRIT)
 */
export function isWAMetroPostcode(postcode: string): boolean {
  const code = parseInt(postcode, 10);
  // Perth metro postcodes roughly 6000-6199
  return code >= 6000 && code <= 6199;
}
