/**
 * Utility to retrieve the live CPI rate from the economic_data_cache table.
 * Falls back to RBA's target midpoint (2.5%) if no cached data is available.
 * 
 * CPI is an independent macroeconomic indicator — it must NEVER be derived
 * from or capped by capital growth rates.
 */

import { supabase } from '@/integrations/supabase/client';

export interface LiveCpiData {
  currentAnnualCpi: number;
  cpiProjections: CpiProjection[];
  source: string;
  retrievedAt: string | null;
  isFallback: boolean;
}

export interface CpiProjection {
  year: number;
  cpiPercent: number;
  source: string;
}

const FALLBACK_CPI = 2.5; // RBA target band midpoint

/**
 * Fetch the latest CPI data from the economic_data_cache.
 * Returns current annual CPI and 10-year projections if available.
 */
export async function getLiveCpiData(): Promise<LiveCpiData> {
  try {
    const { data: cachedData, error } = await supabase
      .from('economic_data_cache')
      .select('data, fetched_at')
      .eq('data_type', 'rba_indicators')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error || !cachedData?.data) {
      console.warn('[CPI] No cached economic data available, using fallback');
      return getFallbackCpiData();
    }

    const economicData = cachedData.data as any;
    const currentCpi = economicData?.inflation?.annual || FALLBACK_CPI;
    const cpiProjections = economicData?.cpiProjections || [];

    return {
      currentAnnualCpi: currentCpi,
      cpiProjections: cpiProjections.length > 0 ? cpiProjections : generateDefaultProjections(currentCpi),
      source: economicData?.inflation?.source || 'ABS Consumer Price Index',
      retrievedAt: cachedData.fetched_at,
      isFallback: false,
    };
  } catch (err) {
    console.error('[CPI] Error fetching live CPI data:', err);
    return getFallbackCpiData();
  }
}

/**
 * Get a single CPI rate for a specific projection year.
 * Year 0 = current, Year 1-10 = projected.
 */
export function getCpiRateForYear(cpiData: LiveCpiData, year: number): number {
  if (year <= 0) return cpiData.currentAnnualCpi;
  
  const projection = cpiData.cpiProjections.find(p => p.year === year);
  if (projection) return projection.cpiPercent;

  // If beyond available projections, use the last available or current
  const lastProjection = cpiData.cpiProjections[cpiData.cpiProjections.length - 1];
  return lastProjection?.cpiPercent ?? cpiData.currentAnnualCpi;
}

function getFallbackCpiData(): LiveCpiData {
  return {
    currentAnnualCpi: FALLBACK_CPI,
    cpiProjections: generateDefaultProjections(FALLBACK_CPI),
    source: 'RBA target band midpoint (fallback)',
    retrievedAt: null,
    isFallback: true,
  };
}

/**
 * Generate default 10-year projections converging toward RBA target (2.5%).
 * If current CPI is above target, projects a gradual decline toward target.
 * If below, projects a gradual rise.
 */
function generateDefaultProjections(currentCpi: number): CpiProjection[] {
  const target = 2.5;
  const projections: CpiProjection[] = [];
  
  for (let year = 1; year <= 10; year++) {
    // Converge toward target at ~20% per year
    const convergenceFactor = 1 - Math.pow(0.8, year);
    const projected = currentCpi + (target - currentCpi) * convergenceFactor;
    projections.push({
      year,
      cpiPercent: Math.round(projected * 10) / 10,
      source: year <= 3 ? 'RBA/Treasury near-term forecast' : 'Long-term convergence to RBA target',
    });
  }
  
  return projections;
}
