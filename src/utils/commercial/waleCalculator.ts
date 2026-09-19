/**
 * Weighted Average Lease Expiry (WALE)
 * Industry standard: WALE by income and WALE by area.
 */

export interface LeaseLite {
  base_rent_pa: number;
  nla_sqm?: number | null;
  lease_end?: string | Date | null;
  status?: string;
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

function yearsUntil(date: string | Date | null | undefined, asOf: Date): number {
  if (!date) return 0;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 0;
  const diff = d.getTime() - asOf.getTime();
  return Math.max(0, diff / MS_PER_YEAR);
}

export interface WaleResult {
  waleByIncome: number;
  waleByArea: number;
  totalIncome: number;
  totalArea: number;
  occupiedCount: number;
}

export function calculateWale(leases: LeaseLite[], asOf: Date = new Date()): WaleResult {
  const active = leases.filter(l => (l.status ?? 'occupied') !== 'vacant');
  let incomeNumerator = 0;
  let areaNumerator = 0;
  let totalIncome = 0;
  let totalArea = 0;

  for (const l of active) {
    const years = yearsUntil(l.lease_end ?? null, asOf);
    const rent = Number(l.base_rent_pa) || 0;
    const area = Number(l.nla_sqm) || 0;
    incomeNumerator += rent * years;
    areaNumerator += area * years;
    totalIncome += rent;
    totalArea += area;
  }

  return {
    waleByIncome: totalIncome > 0 ? Number((incomeNumerator / totalIncome).toFixed(2)) : 0,
    waleByArea: totalArea > 0 ? Number((areaNumerator / totalArea).toFixed(2)) : 0,
    totalIncome,
    totalArea,
    occupiedCount: active.length,
  };
}
