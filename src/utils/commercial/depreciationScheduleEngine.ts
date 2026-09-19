export function annualDepreciation(totalDepreciableAmount: number, effectiveLifeYears: number): number {
  return effectiveLifeYears > 0 ? totalDepreciableAmount / effectiveLifeYears : 0;
}
