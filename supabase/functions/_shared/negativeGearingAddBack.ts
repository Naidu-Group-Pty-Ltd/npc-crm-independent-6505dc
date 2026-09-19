/**
 * Negative Gearing Add-Back — Deno mirror of `src/utils/negativeGearingAddBack.ts`.
 * Keep in sync.
 */

import type { ScenarioProperty } from './scenarioDeltaEngine.ts';

export interface NegativeGearingInput {
  investmentProperties: Array<Pick<ScenarioProperty,
    'id' | 'address' | 'monthlyRentalIncome' | 'monthlyRepayment' |
    'loanRepaymentAmount' | 'netMonthlyCashflow' | 'interestRate' | 'loanRemaining'
  >>;
  marginalTaxRate: number;
  addBackShading?: number;
  /** Phase I12 — APRA buffer in % (e.g. 3.00) for buffered-IO loss recompute. */
  bufferRatePct?: number;
}

export interface NegativeGearingResult {
  annualAddBack: number;
  perProperty: Array<{
    id: string;
    address: string;
    annualLoss: number;
    taxSaving: number;
    addBack: number;
  }>;
  notes: string[];
}

export function marginalTaxRateFor(grossAnnualIncome: number): number {
  const inc = Math.max(0, grossAnnualIncome);
  if (inc <= 18200)  return 0.00 + 0.02;
  if (inc <= 45000)  return 0.16 + 0.02;
  if (inc <= 135000) return 0.30 + 0.02;
  if (inc <= 190000) return 0.37 + 0.02;
  return 0.45 + 0.02;
}

export function computeNegativeGearingAddBack(input: NegativeGearingInput): NegativeGearingResult {
  const shading = Math.max(0, Math.min(1, input.addBackShading ?? 1));
  const mrt = Math.max(0, Math.min(0.5, input.marginalTaxRate));
  const buffer = Math.max(0, input.bufferRatePct ?? 0);
  let total = 0;
  const perProperty: NegativeGearingResult['perProperty'] = [];
  const notes: string[] = [];
  let bufferUsedFor = 0;

  for (const p of input.investmentProperties || []) {
    const monthlyRent = p.monthlyRentalIncome ?? 0;
    const recordedRepayment = p.loanRepaymentAmount ?? p.monthlyRepayment ?? 0;
    const recordedCashflow = typeof p.netMonthlyCashflow === 'number'
      ? p.netMonthlyCashflow
      : monthlyRent - recordedRepayment;

    let monthlyNet = recordedCashflow;
    let usedBuffer = false;
    if (
      buffer > 0 &&
      typeof p.interestRate === 'number' && p.interestRate > 0 &&
      typeof p.loanRemaining === 'number' && p.loanRemaining > 0
    ) {
      const ioBuffered = p.loanRemaining * ((p.interestRate + buffer) / 100 / 12);
      monthlyNet = recordedCashflow + recordedRepayment - ioBuffered;
      usedBuffer = true;
    }
    if (monthlyNet >= 0) continue;
    if (usedBuffer) bufferUsedFor++;
    const annualLoss = Math.abs(monthlyNet) * 12;
    const taxSaving = annualLoss * mrt;
    const addBack = taxSaving * shading;
    total += addBack;
    perProperty.push({
      id: p.id,
      address: p.address || p.id,
      annualLoss: Math.round(annualLoss),
      taxSaving: Math.round(taxSaving),
      addBack: Math.round(addBack),
    });
  }

  if (perProperty.length > 0) {
    const bufNote = bufferUsedFor > 0
      ? ` (loss assessed at IO + ${buffer.toFixed(2)}pp APRA buffer for ${bufferUsedFor}/${perProperty.length} ${bufferUsedFor === 1 ? 'property' : 'properties'})`
      : '';
    notes.push(
      `Negative-gearing add-back: $${Math.round(total).toLocaleString()}/yr ` +
      `from ${perProperty.length} investment ${perProperty.length === 1 ? 'property' : 'properties'} ` +
      `at marginal rate ${(mrt * 100).toFixed(1)}%${shading < 1 ? ` (shaded ${(shading * 100).toFixed(0)}%)` : ''}${bufNote}.`
    );
  }

  return { annualAddBack: Math.round(total), perProperty, notes };
}
