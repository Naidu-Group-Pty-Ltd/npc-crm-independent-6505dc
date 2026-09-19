import type { BorrowingInputs, CovenantPressureResult } from './calculatorTypes';

export function calculateCovenantPressure(inputs: BorrowingInputs, impliedLvr: number, icr: number, dscr: number, debtYield: number): CovenantPressureResult {
  const l = inputs.lendingAssumptions;
  const lvrHeadroom = (l.maxOngoingLvrCovenant ?? l.maxLvr) - impliedLvr;
  const icrHeadroom = icr - (l.minOngoingIcrCovenant ?? l.minIcr);
  const dscrHeadroom = dscr - (l.minOngoingDscrCovenant ?? l.minDscr);
  const debtYieldHeadroom = debtYield - l.minDebtYield;
  const waleCovenantRisk = (l.minWaleCovenant ?? 0) > 0 && inputs.income.wale < (l.minWaleCovenant ?? 0) ? 'WALE below covenant' : 'No immediate WALE breach';
  const warnings: string[] = [];
  if (icrHeadroom < 0.15) warnings.push('Low ICR headroom against covenant.');
  if (lvrHeadroom < 0.05) warnings.push('Low LVR headroom against covenant.');
  const pressure = [lvrHeadroom < 0, icrHeadroom < 0, dscrHeadroom < 0, debtYieldHeadroom < 0].filter(Boolean).length;
  const status = pressure >= 2 ? 'critical' : pressure === 1 ? 'high' : warnings.length ? 'moderate' : 'low';
  return { lvrHeadroom, icrHeadroom, dscrHeadroom, debtYieldHeadroom, waleCovenantRisk, status, warnings };
}
