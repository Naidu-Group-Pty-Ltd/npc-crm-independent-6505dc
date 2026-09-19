import type { TenYearCashFlowYear } from './tenYearCashFlowTypes';
export function summarizeRelatedPartyLease(years: TenYearCashFlowYear[]) {
  const y1 = years[0]; const y10 = years[9] ?? y1;
  return { year1PropertyEntityCashflow: y1?.propertyEntityCashflow ?? 0, year1OperatingBusinessOccupancyCost: y1?.operatingBusinessOccupancyCost ?? 0, year1GroupCashflow: y1?.groupCashflow ?? 0, groupDscr: y1?.groupDscr ?? null, cumulativeGroupBenefit: y10?.cumulativeGroupBenefit ?? 0 };
}
