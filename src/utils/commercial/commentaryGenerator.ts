import type { CommercialIndustrialDealProfile } from './commercialDealState';
export const commentarySections = ['Borrowing Outcome','Credit Assessment','Purchase Ability','Net Operating Income Assessment','Capitalisation Rate / Valuation Assessment','Interest Coverage Ratio / Debt Service Coverage Ratio Assessment','Goods and Services Tax Assessment','Discounted Cash Flow / Return Assessment','Asset-Specific Risk','Borrower / Structure Risk','Missing Information','Fix-the-Deal Summary','Recommended Next Action'] as const;
export function generateAssessmentCommentary(profile: CommercialIndustrialDealProfile): Record<(typeof commentarySections)[number], string> {
  const hasAi = Object.values(profile.aiEstimateMetadata).some(e => e.confidenceTag === 'AI Estimate');
  return Object.fromEntries(commentarySections.map(section => [section, `${section}: Output is based on verified, estimated and unknown assumptions currently held in the connected commercial/industrial deal profile.${hasAi ? ' AI estimates are labelled for feasibility and require verification before final reliance.' : ''}`])) as Record<(typeof commentarySections)[number], string>;
}
