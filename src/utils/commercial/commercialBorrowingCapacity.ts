/**
 * Commercial Borrowing Capacity Engine
 *
 * Unlike the residential BC engine (DTI / HEM driven), commercial lenders
 * size the loan against the property's own income via ICR and DSCR, capped
 * by a per-security LVR ceiling.
 *
 *   ICR  = NOI / Annual Interest          (typ. min 1.50x)
 *   DSCR = NOI / Annual Debt Service P&I  (typ. min 1.25 - 1.35x)
 *
 * The supportable loan is the LESSER of:
 *   - Loan implied by ICR target  (interest-only test)
 *   - Loan implied by DSCR target (amortising P&I test)
 *   - LVR cap × property value
 *
 * Sponsor liquidity / net worth tests can also gate the result.
 */
import { annualInterest, annualPI, maxLoanByIcr } from './icrDscrCalculator';

export interface CommercialBcInputs {
  /** Net Operating Income (annual, AUD) */
  noi: number;
  /** Property "as is" market value */
  propertyValue: number;
  /** Quoted contract rate % (e.g. 7.25) */
  interestRatePct: number;
  /** Assessment buffer added to the contract rate (default 1.0%) */
  bufferPct?: number;
  /** Loan term in years for the P&I (DSCR) test (default 25) */
  loanTermYears?: number;
  /** Lender LVR ceiling for this asset class (default 0.65) */
  maxLvr?: number;
  /** Minimum ICR the lender requires (default 1.50) */
  minIcr?: number;
  /** Minimum DSCR the lender requires (default 1.25) */
  minDscr?: number;
  /** Optional sponsor liquidity test — loan cap = liquidity × multiplier */
  sponsorLiquidity?: number;
  /** Multiplier applied to sponsor liquidity (default 0 = test disabled) */
  sponsorLiquidityMultiplier?: number;
}

export type BindingConstraint = 'icr' | 'dscr' | 'lvr' | 'liquidity' | 'none';

export interface CommercialBcResult {
  /** Final supportable loan after all caps */
  maxLoan: number;
  /** Implied LVR at maxLoan */
  impliedLvr: number;
  /** Which test is the binding constraint */
  bindingConstraint: BindingConstraint;
  /** Component caps (uncapped sub-results) */
  caps: {
    icrCap: number;
    dscrCap: number;
    lvrCap: number;
    liquidityCap: number | null;
  };
  /** Coverage ratios at the final maxLoan */
  coverageAtMax: {
    icr: number;
    dscr: number;
    annualInterest: number;
    annualDebtService: number;
  };
  /** Assessment rate actually used (rate + buffer) */
  assessmentRatePct: number;
  /** Pass / warn / fail traffic light */
  band: 'green' | 'amber' | 'red';
  /** Plain-English notes / warnings */
  notes: string[];
}

/** Inverse of `annualPI` — max loan such that the assessed P&I equals `noi / minDscr`. */
function maxLoanByDscr(noi: number, assessRatePct: number, termYears: number, minDscr: number): number {
  if (noi <= 0 || assessRatePct <= 0 || minDscr <= 0) return 0;
  const targetAnnualPI = noi / minDscr;
  if (termYears <= 0) {
    // Interest-only fallback
    return targetAnnualPI / (assessRatePct / 100);
  }
  const r = assessRatePct / 100 / 12;
  const n = termYears * 12;
  const monthlyTarget = targetAnnualPI / 12;
  // monthly = loan * r / (1 - (1+r)^-n)  →  loan = monthly * (1 - (1+r)^-n) / r
  if (r === 0) return monthlyTarget * n;
  return monthlyTarget * (1 - Math.pow(1 + r, -n)) / r;
}

export function calculateCommercialBc(inputs: CommercialBcInputs): CommercialBcResult {
  const buffer = inputs.bufferPct ?? 1.0;
  const termYears = inputs.loanTermYears ?? 25;
  const maxLvr = inputs.maxLvr ?? 0.65;
  const minIcr = inputs.minIcr ?? 1.5;
  const minDscr = inputs.minDscr ?? 1.25;
  const liquidityMult = inputs.sponsorLiquidityMultiplier ?? 0;

  const assessmentRatePct = Math.max(0, inputs.interestRatePct + buffer);

  const icrCap = Math.max(0, maxLoanByIcr(inputs.noi, assessmentRatePct, minIcr));
  const dscrCap = Math.max(0, maxLoanByDscr(inputs.noi, assessmentRatePct, termYears, minDscr));
  const lvrCap = Math.max(0, inputs.propertyValue * maxLvr);
  const liquidityCap = liquidityMult > 0 && inputs.sponsorLiquidity != null
    ? Math.max(0, inputs.sponsorLiquidity * liquidityMult)
    : null;

  const candidates: Array<{ key: BindingConstraint; value: number }> = [
    { key: 'icr', value: icrCap },
    { key: 'dscr', value: dscrCap },
    { key: 'lvr', value: lvrCap },
  ];
  if (liquidityCap != null) candidates.push({ key: 'liquidity', value: liquidityCap });

  const binding = candidates.reduce((min, c) => (c.value < min.value ? c : min), candidates[0]);
  const maxLoan = Math.max(0, Math.round(binding.value));
  const bindingConstraint: BindingConstraint = maxLoan === 0 ? 'none' : binding.key;

  const interest = annualInterest(maxLoan, assessmentRatePct);
  const debtService = annualPI(maxLoan, assessmentRatePct, termYears);
  const icrAtMax = interest > 0 ? Number((inputs.noi / interest).toFixed(2)) : 0;
  const dscrAtMax = debtService > 0 ? Number((inputs.noi / debtService).toFixed(2)) : 0;
  const impliedLvr = inputs.propertyValue > 0 ? Number((maxLoan / inputs.propertyValue).toFixed(4)) : 0;

  let band: 'green' | 'amber' | 'red' = 'red';
  if (maxLoan > 0 && icrAtMax >= minIcr && dscrAtMax >= minDscr && impliedLvr <= maxLvr) {
    band = icrAtMax >= minIcr + 0.25 && dscrAtMax >= minDscr + 0.1 ? 'green' : 'amber';
  }

  const notes: string[] = [];
  notes.push(`Assessment rate ${assessmentRatePct.toFixed(2)}% (contract ${inputs.interestRatePct.toFixed(2)}% + ${buffer.toFixed(2)}% buffer).`);
  notes.push(`Binding constraint: ${bindingConstraint.toUpperCase()}.`);
  if (bindingConstraint === 'lvr') notes.push(`Loan limited by LVR ceiling of ${(maxLvr * 100).toFixed(0)}%.`);
  if (bindingConstraint === 'icr') notes.push(`Loan limited by minimum ICR of ${minIcr.toFixed(2)}x.`);
  if (bindingConstraint === 'dscr') notes.push(`Loan limited by minimum DSCR of ${minDscr.toFixed(2)}x.`);
  if (bindingConstraint === 'liquidity') notes.push(`Loan limited by sponsor liquidity × ${liquidityMult}x.`);
  if (maxLoan === 0) notes.push('NOI is insufficient to service any commercial debt at these settings.');

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
