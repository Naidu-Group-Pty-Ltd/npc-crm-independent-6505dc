import type { PortfolioPositionSummary, ScenarioComparison } from './clientPortfolioTypes';

export type MovementIndicator = 'improves' | 'weakens' | 'neutral';
export interface ScenarioComparisonRow { key: keyof PortfolioPositionSummary; label: string; current: number | string | null; proposed: number | string | null; difference: number | string | null; kind?: 'money' | 'pct' | 'ratio' | 'text' | 'risk'; indicator: MovementIndicator; }

const diffNum = (a: number, b: number) => b - a;
const diffNullable = (a: number | null, b: number | null) => a == null || b == null ? null : b - a;
const riskScore = (r: unknown) => r === 'green' ? 1 : r === 'amber' ? 2 : r === 'red' ? 3 : 2;
const lowerIsBetter = new Set<keyof PortfolioPositionSummary>(['totalDebt', 'residentialDebt', 'commercialDebt', 'businessDebt', 'equipmentVehicleFinance', 'weightedLvr', 'annualDebtService', 'requiredEquity']);
const higherIsBetter = new Set<keyof PortfolioPositionSummary>(['totalAssetValue', 'residentialAssetValue', 'commercialAssetValue', 'industrialAssetValue', 'shareLiquidInvestmentValue', 'cashOffsets', 'netEquity', 'annualGrossIncome', 'annualRentalIncome', 'annualNoi', 'annualBusinessIncome', 'portfolioIcr', 'portfolioDscr', 'debtYield', 'availableLiquidity', 'postSettlementLiquidity', 'preTaxCashflow', 'afterTaxCashflow', 'borrowingCapacity']);

function indicator(key: keyof PortfolioPositionSummary, diff: number | string | null, current?: unknown, proposed?: unknown): MovementIndicator {
  if (key === 'riskRating') {
    const movement = riskScore(proposed) - riskScore(current);
    return movement < 0 ? 'improves' : movement > 0 ? 'weakens' : 'neutral';
  }
  if (typeof diff !== 'number' || Math.abs(diff) < 0.000001) return 'neutral';
  if (higherIsBetter.has(key)) return diff > 0 ? 'improves' : 'weakens';
  if (lowerIsBetter.has(key)) return diff < 0 ? 'improves' : 'weakens';
  return 'neutral';
}

export function buildScenarioComparisonRows(current: PortfolioPositionSummary, proposed: PortfolioPositionSummary): ScenarioComparisonRow[] {
  const defs: Array<[keyof PortfolioPositionSummary, string, ScenarioComparisonRow['kind']?]> = [
    ['totalAssetValue', 'Total asset value'], ['residentialAssetValue', 'Total residential asset value'], ['commercialAssetValue', 'Total commercial asset value'], ['industrialAssetValue', 'Total industrial asset value'], ['shareLiquidInvestmentValue', 'Share / liquid investment value'], ['cashOffsets', 'Cash / offsets'], ['totalDebt', 'Total debt'], ['residentialDebt', 'Residential debt'], ['commercialDebt', 'Commercial debt'], ['businessDebt', 'Business debt'], ['equipmentVehicleFinance', 'Equipment / vehicle finance'], ['netEquity', 'Net equity'], ['weightedLvr', 'Weighted LVR', 'pct'], ['annualGrossIncome', 'Annual gross income'], ['annualRentalIncome', 'Annual rental income'], ['annualNoi', 'Annual NOI'], ['annualBusinessIncome', 'Annual business income'], ['annualDebtService', 'Annual debt service'], ['portfolioIcr', 'Portfolio ICR', 'ratio'], ['portfolioDscr', 'Portfolio DSCR', 'ratio'], ['debtYield', 'Debt yield', 'pct'], ['availableLiquidity', 'Available liquidity'], ['requiredEquity', 'Required equity'], ['postSettlementLiquidity', 'Post-settlement liquidity'], ['preTaxCashflow', 'Pre-tax cashflow'], ['afterTaxCashflow', 'After-tax cashflow'], ['riskRating', 'Risk rating', 'risk'], ['borrowingCapacity', 'Borrowing capacity'], ['keyConstraint', 'Key constraint', 'text'],
  ];
  return defs.map(([key, label, kind]) => {
    const currentValue = current[key] as any;
    const proposedValue = proposed[key] as any;
    const difference = typeof currentValue === 'number' && typeof proposedValue === 'number' ? diffNum(currentValue, proposedValue) : (currentValue == null || proposedValue == null ? diffNullable(currentValue, proposedValue) : proposedValue);
    return { key, label, current: currentValue, proposed: proposedValue, difference, kind: kind ?? 'money', indicator: indicator(key, difference, currentValue, proposedValue) };
  });
}

export function comparePortfolioScenario(current: PortfolioPositionSummary, proposed: PortfolioPositionSummary): ScenarioComparison {
  const difference: PortfolioPositionSummary = { totalAssetValue: diffNum(current.totalAssetValue, proposed.totalAssetValue), residentialAssetValue: diffNum(current.residentialAssetValue, proposed.residentialAssetValue), commercialAssetValue: diffNum(current.commercialAssetValue, proposed.commercialAssetValue), industrialAssetValue: diffNum(current.industrialAssetValue, proposed.industrialAssetValue), shareLiquidInvestmentValue: diffNum(current.shareLiquidInvestmentValue, proposed.shareLiquidInvestmentValue), cashOffsets: diffNum(current.cashOffsets, proposed.cashOffsets), totalDebt: diffNum(current.totalDebt, proposed.totalDebt), residentialDebt: diffNum(current.residentialDebt, proposed.residentialDebt), commercialDebt: diffNum(current.commercialDebt, proposed.commercialDebt), businessDebt: diffNum(current.businessDebt, proposed.businessDebt), equipmentVehicleFinance: diffNum(current.equipmentVehicleFinance, proposed.equipmentVehicleFinance), netEquity: diffNum(current.netEquity, proposed.netEquity), weightedLvr: diffNullable(current.weightedLvr, proposed.weightedLvr), annualGrossIncome: diffNum(current.annualGrossIncome, proposed.annualGrossIncome), annualRentalIncome: diffNum(current.annualRentalIncome, proposed.annualRentalIncome), annualNoi: diffNum(current.annualNoi, proposed.annualNoi), annualBusinessIncome: diffNum(current.annualBusinessIncome, proposed.annualBusinessIncome), annualDebtService: diffNum(current.annualDebtService, proposed.annualDebtService), portfolioIcr: diffNullable(current.portfolioIcr, proposed.portfolioIcr), portfolioDscr: diffNullable(current.portfolioDscr, proposed.portfolioDscr), debtYield: diffNullable(current.debtYield, proposed.debtYield), availableLiquidity: diffNum(current.availableLiquidity, proposed.availableLiquidity), requiredEquity: diffNum(current.requiredEquity, proposed.requiredEquity), postSettlementLiquidity: diffNum(current.postSettlementLiquidity, proposed.postSettlementLiquidity), preTaxCashflow: diffNum(current.preTaxCashflow, proposed.preTaxCashflow), afterTaxCashflow: diffNum(current.afterTaxCashflow, proposed.afterTaxCashflow), riskRating: proposed.riskRating, borrowingCapacity: diffNum(current.borrowingCapacity, proposed.borrowingCapacity), keyConstraint: proposed.keyConstraint };
  const rows = buildScenarioComparisonRows(current, proposed);
  const improves = rows.filter(r => r.indicator === 'improves').length;
  const weakens = rows.filter(r => r.indicator === 'weakens').length;
  const status = weakens > improves ? 'weakens' : improves > weakens ? 'improves' : 'mixed';
  return { current, proposed, difference, status, warnings: proposed.postSettlementLiquidity < 0 ? ['Post-settlement liquidity is negative; do not commit without funding plan.'] : [] };
}
