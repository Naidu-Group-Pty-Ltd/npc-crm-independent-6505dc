/**
 * Historical capital growth estimates by Australian state/territory.
 * Based on long-term median property price growth data (10-20 year averages).
 * These are used as smart defaults when no manual capital growth rate is entered,
 * particularly for New Build properties where historical comparables may be limited.
 */

interface GrowthEstimate {
  capitalGrowthPercent: number;
  cpiGrowthPercent: number;
  rentalGrowthPercent: number;
  source: string;
  label: string;
}

// Long-term average annual growth rates by state (conservative estimates)
const STATE_GROWTH_ESTIMATES: Record<string, GrowthEstimate> = {
  NSW: {
    capitalGrowthPercent: 6.5,
    cpiGrowthPercent: 3.0,
    rentalGrowthPercent: 3.5,
    source: '20-year median (NSW)',
    label: 'New South Wales',
  },
  VIC: {
    capitalGrowthPercent: 5.8,
    cpiGrowthPercent: 3.0,
    rentalGrowthPercent: 3.2,
    source: '20-year median (VIC)',
    label: 'Victoria',
  },
  QLD: {
    capitalGrowthPercent: 5.5,
    cpiGrowthPercent: 3.0,
    rentalGrowthPercent: 3.8,
    source: '20-year median (QLD)',
    label: 'Queensland',
  },
  SA: {
    capitalGrowthPercent: 5.0,
    cpiGrowthPercent: 3.0,
    rentalGrowthPercent: 3.3,
    source: '20-year median (SA)',
    label: 'South Australia',
  },
  WA: {
    capitalGrowthPercent: 4.5,
    cpiGrowthPercent: 3.0,
    rentalGrowthPercent: 3.5,
    source: '20-year median (WA)',
    label: 'Western Australia',
  },
  TAS: {
    capitalGrowthPercent: 5.2,
    cpiGrowthPercent: 3.0,
    rentalGrowthPercent: 3.6,
    source: '20-year median (TAS)',
    label: 'Tasmania',
  },
  NT: {
    capitalGrowthPercent: 3.5,
    cpiGrowthPercent: 3.0,
    rentalGrowthPercent: 3.0,
    source: '20-year median (NT)',
    label: 'Northern Territory',
  },
  ACT: {
    capitalGrowthPercent: 5.5,
    cpiGrowthPercent: 3.0,
    rentalGrowthPercent: 3.2,
    source: '20-year median (ACT)',
    label: 'Australian Capital Territory',
  },
};

const NATIONAL_AVERAGE: GrowthEstimate = {
  capitalGrowthPercent: 5.0,
  cpiGrowthPercent: 3.0,
  rentalGrowthPercent: 3.3,
  source: 'National average',
  label: 'Australia (National)',
};

/**
 * Detect state abbreviation from address string
 */
function detectStateFromAddress(address: string): string | null {
  if (!address) return null;
  const upper = address.toUpperCase();
  
  const statePatterns: [string, RegExp][] = [
    ['NSW', /\bNSW\b|\bNEW SOUTH WALES\b/],
    ['VIC', /\bVIC\b|\bVICTORIA\b/],
    ['QLD', /\bQLD\b|\bQUEENSLAND\b/],
    ['SA', /\bSA\b|\bSOUTH AUSTRALIA\b/],
    ['WA', /\bWA\b|\bWESTERN AUSTRALIA\b/],
    ['TAS', /\bTAS\b|\bTASMANIA\b/],
    ['NT', /\bNT\b|\bNORTHERN TERRITORY\b/],
    ['ACT', /\bACT\b|\bAUSTRALIAN CAPITAL TERRITORY\b/],
  ];
  
  for (const [code, pattern] of statePatterns) {
    if (pattern.test(upper)) return code;
  }
  return null;
}

/**
 * Get capital growth estimate for a property address.
 * Returns state-specific historical data or national average.
 */
export function getLocalityGrowthEstimate(propertyAddress: string): GrowthEstimate & { stateCode: string | null } {
  const stateCode = detectStateFromAddress(propertyAddress);
  const estimate = stateCode ? STATE_GROWTH_ESTIMATES[stateCode] : NATIONAL_AVERAGE;
  return { ...estimate, stateCode };
}

/**
 * Get a recommended CPI growth rate.
 * CPI is an independent macroeconomic indicator and is NOT derived from capital growth.
 * Returns the locality-based CPI estimate (which should be populated from live data).
 */
export function getDerivedCpiGrowth(
  _capitalGrowthPercent: number | null,
  propertyAddress: string
): { cpiPercent: number; source: string } {
  const locality = getLocalityGrowthEstimate(propertyAddress);
  
  return {
    cpiPercent: locality.cpiGrowthPercent,
    source: locality.source,
  };
}
