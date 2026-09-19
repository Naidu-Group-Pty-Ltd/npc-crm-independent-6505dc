export const DEFAULT_COMPARISON_WEIGHTS = Object.freeze({
  growth: 30,
  location: 25,
  yield: 20,
  demand: 15,
  risk: 10,
} as const);

export type ComparisonWeights = { [K in keyof typeof DEFAULT_COMPARISON_WEIGHTS]: number };

export const DEFAULT_COMPARISON_SETTINGS = Object.freeze({
  investorProfile: 'general',
  analysisDepth: 'comprehensive',
  timeHorizon: '5-7 years',
  riskTolerance: 'moderate',
} as const);

export const cloneComparisonWeights = (weights: ComparisonWeights = DEFAULT_COMPARISON_WEIGHTS): ComparisonWeights => ({ ...weights });

export const validateComparisonWeights = (weights: unknown) => {
  const keys = Object.keys(DEFAULT_COMPARISON_WEIGHTS) as Array<keyof ComparisonWeights>;
  if (!weights || typeof weights !== 'object') return { total: 0, isValid: false, message: 'All five scoring weights are required.' };
  const candidate = weights as Partial<ComparisonWeights>;
  const values = keys.map((key) => candidate[key]);
  if (values.some((value) => !Number.isInteger(value) || (value as number) < 0 || (value as number) > 100)) {
    return { total: 0, isValid: false, message: 'Each scoring weight must be a whole number between 0% and 100%.' };
  }
  const total = values.reduce<number>((sum, value) => sum + (value as number), 0);
  return total === 100
    ? { total, isValid: true, message: '' }
    : { total, isValid: false, message: `Total: ${total}% — adjust the weights to equal 100%.` };
};

export const comparisonWeightsEqual = (left: ComparisonWeights, right: ComparisonWeights) =>
  (Object.keys(DEFAULT_COMPARISON_WEIGHTS) as Array<keyof ComparisonWeights>).every((key) => left[key] === right[key]);

export type ComparisonTemplateSettings = {
  investorProfile: string;
  analysisDepth: string;
  timeHorizon: string;
  riskTolerance: string;
  appliedWeights: ComparisonWeights;
  reportFamily: 'investment_comparison';
};

export const parseComparisonTemplateSettings = (settings: unknown): ComparisonTemplateSettings | null => {
  if (!settings || typeof settings !== 'object') return null;
  const value = settings as Record<string, unknown>;
  const weights = value.appliedWeights ?? value.customWeights;
  const validation = validateComparisonWeights(weights);
  if (!validation.isValid || (value.reportFamily && value.reportFamily !== 'investment_comparison')) return null;
  return {
    investorProfile: typeof value.investorProfile === 'string' ? value.investorProfile : DEFAULT_COMPARISON_SETTINGS.investorProfile,
    analysisDepth: typeof value.analysisDepth === 'string' ? value.analysisDepth : DEFAULT_COMPARISON_SETTINGS.analysisDepth,
    timeHorizon: typeof value.timeHorizon === 'string' ? value.timeHorizon : DEFAULT_COMPARISON_SETTINGS.timeHorizon,
    riskTolerance: typeof value.riskTolerance === 'string' ? value.riskTolerance : DEFAULT_COMPARISON_SETTINGS.riskTolerance,
    appliedWeights: cloneComparisonWeights(weights as ComparisonWeights),
    reportFamily: 'investment_comparison',
  };
};
