/**
 * Industrial yields — passing, market and equivalent.
 */
export interface IndustrialYieldInputs {
  passingNoi: number;
  marketNoi: number;
  price: number;
}

export interface IndustrialYieldResult {
  passingYield: number;
  reversionaryYield: number;
  equivalentYield: number;
}

export function industrialCapRate(noi: number, price: number): number {
  if (!price || price <= 0) return 0;
  return Number(((noi / price) * 100).toFixed(2));
}

export function calculateIndustrialYields({ passingNoi, marketNoi, price }: IndustrialYieldInputs): IndustrialYieldResult {
  const passing = industrialCapRate(passingNoi, price);
  const reversionary = industrialCapRate(marketNoi, price);
  const equivalent = Number(((passing + reversionary) / 2).toFixed(2));
  return { passingYield: passing, reversionaryYield: reversionary, equivalentYield: equivalent };
}

export function industrialValueFromCap(noi: number, capPct: number): number {
  if (!capPct || capPct <= 0) return 0;
  return Number((noi / (capPct / 100)).toFixed(2));
}
