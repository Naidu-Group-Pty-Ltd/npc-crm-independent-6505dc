/**
 * Industrial Borrowing Capacity Engine
 *
 * Same shape as commercial BC but tuned to industrial defaults:
 *   ICR  ≥ 1.75x   (lenders prefer stronger interest coverage on industrial)
 *   DSCR ≥ 1.35x
 *   LVR  ≤ 0.60–0.65
 */
import { annualInterest, annualPI, maxLoanByIcr } from '../commercial/icrDscrCalculator';

export interface IndustrialBcInputs {
  noi: number;
  propertyValue: number;
  interestRatePct: number;
  bufferPct?: number;
  loanTermYears?: number;
  maxLvr?: number;
  minIcr?: number;
  minDscr?: number;
  sponsorLiquidity?: number;
  sponsorLiquidityMultiplier?: number;
}

export type IndustrialBindingConstraint = 'icr' | 'dscr' | 'lvr' | 'liquidity' | 'none';

export interface IndustrialBcResult {
  maxLoan: number;
  impliedLvr: number;
  bindingConstraint: IndustrialBindingConstraint;
  caps: { icrCap: number; dscrCap: number; lvrCap: number; liquidityCap: number | null };
  coverageAtMax: { icr: number; dscr: number; annualInterest: number; annualDebtService: number };
  assessmentRatePct: number;
  band: 'green' | 'amber' | 'red';
  notes: string[];
}

function maxLoanByDscr(noi: number, assessRatePct: number, termYears: number, minDscr: number): number {
  if (noi <= 0 || assessRatePct <= 0 || minDscr <= 0) return 0;
  const targetAnnualPI = noi / minDscr;
  if (termYears <= 0) return targetAnnualPI / (assessRatePct / 100);
  const r = assessRatePct / 100 / 12;
  const n = termYears * 12;
  const monthlyTarget = targetAnnualPI / 12;
  if (r === 0) return monthlyTarget * n;
  return monthlyTarget * (1 - Math.pow(1 + r, -n)) / r;
}

export function calculateIndustrialBc(inputs: IndustrialBcInputs): IndustrialBcResult {
  const buffer = inputs.bufferPct ?? 1.0;
  const termYears = inputs.loanTermYears ?? 20;
  const maxLvr = inputs.maxLvr ?? 0.60;
  const minIcr = inputs.minIcr ?? 1.75;
  const minDscr = inputs.minDscr ?? 1.35;
  const liquidityMult = inputs.sponsorLiquidityMultiplier ?? 0;
  const assessmentRatePct = Math.max(0, inputs.interestRatePct + buffer);

  const icrCap = Math.max(0, maxLoanByIcr(inputs.noi, assessmentRatePct, minIcr));
  const dscrCap = Math.max(0, maxLoanByDscr(inputs.noi, assessmentRatePct, termYears, minDscr));
  const lvrCap = Math.max(0, inputs.propertyValue * maxLvr);
  const liquidityCap = liquidityMult > 0 && inputs.sponsorLiquidity != null
    ? Math.max(0, inputs.sponsorLiquidity * liquidityMult)
    : null;

  const candidates: Array<{ key: IndustrialBindingConstraint; value: number }> = [
    { key: 'icr', value: icrCap },
    { key: 'dscr', value: dscrCap },
    { key: 'lvr', value: lvrCap },
  ];
  if (liquidityCap != null) candidates.push({ key: 'liquidity', value: liquidityCap });

  const binding = candidates.reduce((min, c) => (c.value < min.value ? c : min), candidates[0]);
  const maxLoan = Math.max(0, Math.round(binding.value));
  const bindingConstraint: IndustrialBindingConstraint = maxLoan === 0 ? 'none' : binding.key;

  const interest = annualInterest(maxLoan, assessmentRatePct);
  const debtService = annualPI(maxLoan, assessmentRatePct, termYears);
  const icrAtMax = interest > 0 ? Number((inputs.noi / interest).toFixed(2)) : 0;
  const dscrAtMax = debtService > 0 ? Number((inputs.noi / debtService).toFixed(2)) : 0;
  const impliedLvr = inputs.propertyValue > 0 ? Number((maxLoan / inputs.propertyValue).toFixed(4)) : 0;

  let band: 'green' | 'amber' | 'red' = 'red';
  if (maxLoan > 0 && icrAtMax >= minIcr && dscrAtMax >= minDscr && impliedLvr <= maxLvr) {
    band = icrAtMax >= minIcr + 0.25 && dscrAtMax >= minDscr + 0.15 ? 'green' : 'amber';
  }

  const notes: string[] = [];
  notes.push(`Assessment rate ${assessmentRatePct.toFixed(2)}% (contract ${inputs.interestRatePct.toFixed(2)}% + ${buffer.toFixed(2)}% buffer).`);
  notes.push(`Binding constraint: ${bindingConstraint.toUpperCase()}.`);
  if (bindingConstraint === 'lvr') notes.push(`Loan limited by LVR ceiling of ${(maxLvr * 100).toFixed(0)}%.`);
  if (bindingConstraint === 'icr') notes.push(`Loan limited by minimum ICR of ${minIcr.toFixed(2)}x.`);
  if (bindingConstraint === 'dscr') notes.push(`Loan limited by minimum DSCR of ${minDscr.toFixed(2)}x.`);
  if (bindingConstraint === 'liquidity') notes.push(`Loan limited by sponsor liquidity × ${liquidityMult}x.`);
  if (maxLoan === 0) notes.push('NOI is insufficient to service any industrial debt at these settings.');

  return {
    maxLoan,
    impliedLvr,
    bindingConstraint,
    caps: {
      icrCap: Math.round(icrCap),
      dscrCap: Math.round(dscrCap),
      lvrCap: Math.round(lvrCap),
      liquidityCap: liquidityCap != null ? Math.round(liquidityCap) : null,
    },
    coverageAtMax: {
      icr: icrAtMax,
      dscr: dscrAtMax,
      annualInterest: Math.round(interest),
      annualDebtService: Math.round(debtService),
    },
    assessmentRatePct: Number(assessmentRatePct.toFixed(2)),
    band,
    notes,
  };
}
