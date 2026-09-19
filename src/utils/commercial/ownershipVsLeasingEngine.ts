import type { TenYearCashFlowYear } from './tenYearCashFlowTypes';
export function summarizeOwnershipVsLeasing(years: TenYearCashFlowYear[]) {
  const y1 = years[0]; const y10 = years[9] ?? y1;
  return { year1NetSavingCostVsLeasing: y1?.netSavingCostVsLeasing ?? 0, cumulativeRentAvoided: y10?.cumulativeLeasingCostAvoided ?? 0, cumulativeOwnershipBenefit: (y10?.cumulativeLeasingCostAvoided ?? 0) + (y10?.equityCreated ?? 0) + (y10?.cumulativeNetSavingCost ?? 0) };
}
