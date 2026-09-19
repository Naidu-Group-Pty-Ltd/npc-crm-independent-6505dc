import type { TenYearCashFlowResult } from './tenYearCashFlowTypes';
export function generateTenYearCashFlowCommentary(result: TenYearCashFlowResult): string {
  const s = result.summary;
  if (result.mode === 'ownerOccupier') return `Owner-occupier projection compares ownership cost with leasing avoided. Year 1 net saving/cost is ${Math.round(s.ownerOccupierNetSavingCost ?? 0).toLocaleString('en-AU')} and business DSCR is ${s.businessDscr == null ? 'N/A because business financials are not verified' : `${s.businessDscr.toFixed(2)}x`}. Tax assumptions remain indicative until accountant review.`;
  if (result.mode === 'relatedPartyLease') return `Related-party lease projection separates property entity, operating business and group views. Internal rent is shown separately and neutralised in the group view before tax/entity effects. Market rent support and specialist review remain required unless verified.`;
  return `Investor projection models NOI, leasing costs, capex, debt service, tax impact, equity growth and terminal value over 10 years. Year 1 after-tax cashflow is ${Math.round(s.year1AfterTaxCashflow).toLocaleString('en-AU')} and Year 10 equity is ${Math.round(s.year10Equity).toLocaleString('en-AU')}.`;
}
