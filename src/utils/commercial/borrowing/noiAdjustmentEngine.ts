import type { BorrowingInputs, NoiResult, RiskOverlayResult } from './calculatorTypes';

const pct = (v: number) => Math.max(0, v) / 100;
const sum = (values: number[]) => values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
const money = (value: unknown, { allowNegative = false }: { allowNegative?: boolean } = {}) => {
  if (value === '' || value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s%]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return !allowNegative && parsed < 0 ? null : parsed;
};
const optional = (value: unknown, ready: boolean, opts?: { allowNegative?: boolean }) => money(value, opts) ?? (ready ? 0 : null);

export function calculateNoi(inputs: BorrowingInputs, overlay?: Pick<RiskOverlayResult, 'noiHaircutPct'>): NoiResult {
  const i = inputs.income;
  const grossPassingRent = money(i.grossPassingRent);
  const vacancyAllowancePct = money(i.vacancyAllowancePct);
  const ready = grossPassingRent !== null && vacancyAllowancePct !== null;
  const otherIncome = optional(i.otherIncome, ready) ?? 0;
  const recoveredOutgoings = optional(i.recoveredOutgoings, ready) ?? 0;
  const marketRent = optional(i.marketRent, ready) ?? grossPassingRent ?? 0;
  const potentialGrossIncome = ready ? grossPassingRent + otherIncome : 0;
  const vacancyLoss = potentialGrossIncome * pct(vacancyAllowancePct ?? 0);
  const effectiveGrossIncome = potentialGrossIncome - vacancyLoss + recoveredOutgoings;
  const simpleTotalOperatingExpenses = optional(i.nonRecoverableExpenses, ready);
  const itemisedOperatingExpenses = ready ? sum([i.councilRates, i.water, i.landTax, i.insurance, i.strataOwnersCorp, i.managementFees, i.repairsMaintenance, i.utilities, i.cleaning, i.security, i.otherExpenses].map(v => optional(v, true) ?? 0)) : 0;
  const totalOperatingExpenses = simpleTotalOperatingExpenses && itemisedOperatingExpenses === 0 ? simpleTotalOperatingExpenses : itemisedOperatingExpenses;
  const actualNoi = effectiveGrossIncome - totalOperatingExpenses;
  const stabilisedNoi = ((marketRent + otherIncome) * (1 - pct(vacancyAllowancePct ?? 0))) + recoveredOutgoings - totalOperatingExpenses;

  const adjustments: Array<{ label: string; amount: number }> = [];
  if ((optional(i.incentivesAdjustment, ready, { allowNegative: true }) ?? 0) > 0) adjustments.push({ label: 'Incentives / rent-free adjustment', amount: optional(i.incentivesAdjustment, ready, { allowNegative: true }) ?? 0 });
  if ((optional(i.tenantArrearsAdjustment, ready, { allowNegative: true }) ?? 0) > 0) adjustments.push({ label: 'Tenant arrears adjustment', amount: optional(i.tenantArrearsAdjustment, ready, { allowNegative: true }) ?? 0 });
  if (i.rentOverMarket === 'yes' && i.percentageAboveMarket && i.percentageAboveMarket > 0) adjustments.push({ label: 'Over-market rent haircut', amount: (grossPassingRent ?? 0) * pct(i.percentageAboveMarket) });
  if (i.wale > 0 && i.wale < 2) adjustments.push({ label: 'Short WALE haircut', amount: actualNoi * 0.05 });
  if (i.tenantCovenant === 'newBusiness' || i.tenantCovenant === 'weakUnknown') adjustments.push({ label: 'Tenant covenant haircut', amount: actualNoi * 0.075 });
  if (i.tenantCovenant === 'relatedParty' || inputs.purchaserStructure.relatedPartyTenant || inputs.dealProfile.acquisitionPurpose === 'relatedPartyLease') adjustments.push({ label: 'Related-party lease haircut', amount: actualNoi * 0.05 });
  if (overlay?.noiHaircutPct) adjustments.push({ label: 'Asset risk overlay haircut', amount: actualNoi * overlay.noiHaircutPct });

  const lenderAdjustedNoi = actualNoi - sum(adjustments.map(a => a.amount));
  const selectedNoi = i.noiBasis === 'actual' ? actualNoi : i.noiBasis === 'stabilised' ? stabilisedNoi : lenderAdjustedNoi;
  return { potentialGrossIncome, vacancyLoss, effectiveGrossIncome, totalOperatingExpenses, actualNoi, stabilisedNoi, lenderAdjustedNoi, selectedNoi, adjustments: adjustments.map(a => `${a.label}: -${Math.round(a.amount).toLocaleString('en-AU')}`) };
}
