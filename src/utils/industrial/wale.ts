/**
 * WALE for industrial — weighted by income and by GLA.
 */
export interface IndustrialTenancyLite {
  base_rent_pa: number;
  gla_sqm?: number | null;
  lease_end?: string | Date | null;
  status?: string;
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

function yearsUntil(date: string | Date | null | undefined, asOf: Date): number {
  if (!date) return 0;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 0;
  return Math.max(0, (d.getTime() - asOf.getTime()) / MS_PER_YEAR);
}

export interface IndustrialWaleResult {
  waleByIncome: number;
  waleByArea: number;
  totalIncome: number;
  totalArea: number;
  occupiedCount: number;
}

export function calculateIndustrialWale(
  tenancies: IndustrialTenancyLite[],
  asOf: Date = new Date()
): IndustrialWaleResult {
  const active = tenancies.filter(t => (t.status ?? 'occupied') !== 'vacant');
  let incNum = 0, areaNum = 0, totalIncome = 0, totalArea = 0;
  for (const t of active) {
    const yrs = yearsUntil(t.lease_end ?? null, asOf);
    const rent = Number(t.base_rent_pa) || 0;
    const area = Number(t.gla_sqm) || 0;
    incNum += rent * yrs;
    areaNum += area * yrs;
    totalIncome += rent;
    totalArea += area;
  }
  return {
    waleByIncome: totalIncome > 0 ? Number((incNum / totalIncome).toFixed(2)) : 0,
    waleByArea: totalArea > 0 ? Number((areaNum / totalArea).toFixed(2)) : 0,
    totalIncome,
    totalArea,
    occupiedCount: active.length,
  };
}
