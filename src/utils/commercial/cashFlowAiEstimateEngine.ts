import type { TenYearCashFlowInputs } from './tenYearCashFlowTypes';

export type CashFlowAiEstimateAction = {
  id: string;
  label: string;
  field: keyof TenYearCashFlowInputs;
  source: 'AI Estimate' | 'Research Engine';
  specialistReviewRecommended?: boolean;
};

export type CashFlowAiEstimatePreview = CashFlowAiEstimateAction & {
  suggestedValue: number;
  suggestedRange: [number, number];
  confidenceLevel: 'Low' | 'Medium' | 'High';
  sourceBasis: string;
  tabsDataPointsUsed: string[];
  missingData: string[];
  riskNotes: string[];
  specialistReviewRecommended: boolean;
};

export const INSUFFICIENT_CASH_FLOW_AI_CONTEXT_MESSAGE = 'More property, income, lease or market information is required before this assumption can be estimated.';

export const cashFlowAiEstimateActions: CashFlowAiEstimateAction[] = [
  { id: 'rentGrowth', label: 'Estimate rent growth', field: 'rentGrowthPct', source: 'Research Engine' },
  { id: 'vacancyAllowance', label: 'Estimate vacancy allowance', field: 'vacancyAllowancePct', source: 'Research Engine' },
  { id: 'outgoingsGrowth', label: 'Estimate outgoings growth', field: 'outgoingsGrowthPct', source: 'Research Engine' },
  { id: 'capexReserve', label: 'Estimate capex reserve', field: 'annualCapexReserve', source: 'AI Estimate', specialistReviewRecommended: true },
  { id: 'majorCapexTiming', label: 'Estimate major capex timing', field: 'majorCapexYear', source: 'AI Estimate', specialistReviewRecommended: true },
  { id: 'leaseDowntime', label: 'Estimate lease downtime', field: 'downtimeMonths', source: 'Research Engine' },
  { id: 'tenantIncentives', label: 'Estimate tenant incentives', field: 'incentiveMonths', source: 'Research Engine' },
  { id: 'terminalCapRate', label: 'Estimate terminal cap rate', field: 'terminalCapRatePct', source: 'Research Engine' },
  { id: 'capitalGrowth', label: 'Estimate capital growth', field: 'capitalGrowthPct', source: 'Research Engine' },
  { id: 'sellingCosts', label: 'Estimate selling costs', field: 'sellingCostPct', source: 'AI Estimate' },
  { id: 'taxSensitivity', label: 'Estimate tax sensitivity', field: 'taxRatePct', source: 'AI Estimate', specialistReviewRecommended: true },
];

export const cashFlowAiEstimateButtons = cashFlowAiEstimateActions.map(action => action.label);

const hasNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, decimals = 2) => Number(value.toFixed(decimals));

export function createCashFlowAiEstimatePreview(
  action: CashFlowAiEstimateAction,
  inputs: TenYearCashFlowInputs,
  context: Record<string, boolean>,
): CashFlowAiEstimatePreview | null {
  const tabsDataPointsUsed = [
    context.propertyProfile && 'Property profile',
    context.propertyScrape && 'Property scrape',
    context.noiTab && 'NOI tab',
    context.capRateTab && 'Cap Rate tab',
    context.gstTab && 'GST tab',
    context.icrDscrTab && 'ICR / DSCR tab',
    context.borrowingCapacity && 'Borrowing Capacity tab',
    context.dcfTab && 'DCF tab',
    context.researchEngine && 'Research engine',
    context.savedScenarios && 'Saved scenarios',
  ].filter(Boolean) as string[];

  const missingData = [
    !context.propertyProfile && 'Property profile details',
    !context.noiTab && !hasNumber(inputs.passingRent) && 'NOI / passing rent evidence',
    !context.researchEngine && 'Current market research evidence',
    !context.dcfTab && ['terminalCapRatePct', 'capitalGrowthPct', 'sellingCostPct'].includes(String(action.field)) && 'DCF exit assumptions',
    action.specialistReviewRecommended && 'Specialist supporting evidence',
  ].filter(Boolean) as string[];

  const enoughGeneralContext = tabsDataPointsUsed.length >= 2 && (hasNumber(inputs.purchasePrice) || hasNumber(inputs.passingRent) || hasNumber(inputs.propertyValue));
  if (!enoughGeneralContext) return null;

  const marketStrength = context.researchEngine || context.dcfTab || context.capRateTab;
  let suggestedValue = Number(inputs[action.field] ?? 0);
  let suggestedRange: [number, number] = [suggestedValue, suggestedValue];

  switch (action.field) {
    case 'rentGrowthPct':
      suggestedValue = clamp(inputs.rentGrowthPct || inputs.marketRentGrowthPct || 3, 1, 5);
      suggestedRange = [round(Math.max(0, suggestedValue - 1)), round(suggestedValue + 1)];
      break;
    case 'vacancyAllowancePct':
      suggestedValue = clamp(inputs.vacancyAllowancePct || 5, 2, 10);
      suggestedRange = [round(Math.max(0, suggestedValue - 2)), round(suggestedValue + 3)];
      break;
    case 'outgoingsGrowthPct':
      suggestedValue = clamp(inputs.outgoingsGrowthPct || inputs.expenseGrowthPct || 3, 2, 6);
      suggestedRange = [round(suggestedValue - 1), round(suggestedValue + 1.5)];
      break;
    case 'annualCapexReserve':
      suggestedValue = Math.max(inputs.annualCapexReserve || inputs.purchasePrice * 0.0025, inputs.assetDomain === 'industrial' ? 10000 : 5000);
      suggestedRange = [round(suggestedValue * 0.75, 0), round(suggestedValue * 1.5, 0)];
      break;
    case 'majorCapexYear':
      suggestedValue = clamp(inputs.majorCapexYear || 5, 1, 10);
      suggestedRange = [Math.max(1, suggestedValue - 2), Math.min(10, suggestedValue + 2)];
      break;
    case 'downtimeMonths':
      suggestedValue = clamp(inputs.downtimeMonths || 3, 1, 12);
      suggestedRange = [Math.max(0, suggestedValue - 1), suggestedValue + 3];
      break;
    case 'incentiveMonths':
      suggestedValue = clamp(inputs.incentiveMonths || 1, 0, 12);
      suggestedRange = [Math.max(0, suggestedValue - 1), suggestedValue + 2];
      break;
    case 'terminalCapRatePct':
      suggestedValue = clamp(inputs.terminalCapRatePct || inputs.selectedCapRatePct || 6.75, 3, 12);
      suggestedRange = [round(suggestedValue - 0.5), round(suggestedValue + 0.75)];
      break;
    case 'capitalGrowthPct':
      suggestedValue = clamp(inputs.capitalGrowthPct || 2.5, 0, 5);
      suggestedRange = [round(Math.max(0, suggestedValue - 1)), round(suggestedValue + 1)];
      break;
    case 'sellingCostPct':
      suggestedValue = clamp(inputs.sellingCostPct || 2, 1, 4);
      suggestedRange = [round(suggestedValue - 0.5), round(suggestedValue + 1)];
      break;
    case 'taxRatePct':
      suggestedValue = clamp(inputs.taxRatePct || 30, 0, 47);
      suggestedRange = [suggestedValue, suggestedValue];
      break;
  }

  const confidenceLevel = marketStrength && missingData.length <= 1 ? 'High' : tabsDataPointsUsed.length >= 3 ? 'Medium' : 'Low';
  return {
    ...action,
    suggestedValue: round(suggestedValue, action.field === 'annualCapexReserve' ? 0 : 2),
    suggestedRange,
    confidenceLevel,
    sourceBasis: `${action.source} preview using available linked cash-flow context. No value is applied until accepted by the user.`,
    tabsDataPointsUsed,
    missingData: missingData.length ? missingData : ['None identified from available context.'],
    riskNotes: [
      'Estimate is unverified until reviewed and marked verified by a user.',
      action.field === 'taxRatePct' ? 'Tax sensitivity should be confirmed by an accountant before client reliance.' : 'Market and lease evidence should be retained before client reliance.',
    ],
    specialistReviewRecommended: Boolean(action.specialistReviewRecommended || action.field === 'taxRatePct' || confidenceLevel === 'Low'),
  };
}
