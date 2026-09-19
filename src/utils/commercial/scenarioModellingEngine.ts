import type { BorrowingResult } from './borrowing/calculatorTypes';
import { summarizeClientPortfolio } from './clientPortfolioEngine';
import type { ClientProfile, ClientScenario, PortfolioPositionSummary, ScenarioStatus, ScenarioType } from './clientPortfolioTypes';

export interface ProposedScenarioInputs {
  scenarioName: string;
  scenarioType: ScenarioType;
  status?: ScenarioStatus;
  purchasePrice: number;
  proposedDebt: number;
  requiredEquity: number;
  annualNoi: number;
  annualDebtService: number;
  annualCashflow?: number;
  selectedProperty?: string;
  borrowingResult?: BorrowingResult;
  acquisitionCosts?: number;
  cashInjection?: number;
  releasedEquity?: number;
  stressNoiReductionPct?: number;
}

const n = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const hasAnyLiability = (client: ClientProfile) => Object.entries(client.liabilities ?? {}).some(([key, value]) => key !== 'annualDebtService' && n(value) > 0);
const monthsLiquidity = (liquidity: number, annualDebtService: number): number | null => liquidity < 0 ? null : annualDebtService > 0 ? liquidity / (annualDebtService / 12) : null;

export function calculateScenarioReliability(client: ClientProfile): 'Full' | 'Indicative' | 'Limited' {
  if (!hasAnyLiability(client)) return 'Limited';
  if (client.businessFinancials?.ebitdaNpbt == null || !client.businessFinancials?.financialsAvailable) return 'Indicative';
  return 'Full';
}

export function buildScenarioWarnings(client: ClientProfile, proposed: PortfolioPositionSummary, inputs: ProposedScenarioInputs): string[] {
  const warnings: string[] = [];
  const updatedAt = client.lastUpdated ? new Date(client.lastUpdated).getTime() : 0;
  if (!updatedAt || Date.now() - updatedAt > 90 * 24 * 60 * 60 * 1000) warnings.push('Client profile data is stale; refresh assets, liabilities, income and liquidity before relying on scenario results.');
  if (!hasAnyLiability(client)) warnings.push('Liabilities are missing; scenario cannot be marked fully reliable.');
  if (client.businessFinancials?.ebitdaNpbt == null || !client.businessFinancials?.financialsAvailable) warnings.push('Business financials missing; business servicing cannot be applied.');
  if (proposed.postSettlementLiquidity < 0) warnings.push('Post-settlement liquidity is negative; liquidity months are N/A until funding is confirmed.');
  if (proposed.postSettlementLiquidity < 0) warnings.push('Proposed acquisition creates an equity shortfall; purchase ability must be Red.');
  const structures = (client.ownershipStructures ?? []).join(' ').toLowerCase();
  if (/(smsf|trust|company)/.test(structures)) warnings.push('Specialist review required for SMSF, trust or company ownership structure.');
  if (inputs.borrowingResult?.warnings?.some(w => /estimate|estimated|AI/i.test(String(w)))) warnings.push('Scenario uses estimated assumptions; final report must disclose AI-estimated assumptions.');
  return Array.from(new Set(warnings));
}

export function applyScenarioChanges(current: PortfolioPositionSummary, inputs: ProposedScenarioInputs): PortfolioPositionSummary {
  const proposed = { ...current };
  const purchasePrice = n(inputs.purchasePrice);
  const proposedDebt = n(inputs.proposedDebt);
  const requiredEquity = n(inputs.requiredEquity);
  const annualNoi = n(inputs.annualNoi);
  const annualDebtService = n(inputs.annualDebtService);
  const cashInjection = n(inputs.cashInjection);
  const equityRelease = n(inputs.releasedEquity);

  if (inputs.scenarioType === 'Sell Existing Asset') {
    proposed.totalAssetValue -= purchasePrice;
    proposed.commercialAssetValue = Math.max(0, proposed.commercialAssetValue - purchasePrice);
    proposed.totalDebt = Math.max(0, proposed.totalDebt - proposedDebt);
    proposed.commercialDebt = Math.max(0, proposed.commercialDebt - proposedDebt);
    proposed.annualNoi = Math.max(0, proposed.annualNoi - annualNoi);
    proposed.annualDebtService = Math.max(0, proposed.annualDebtService - annualDebtService);
    proposed.availableLiquidity += Math.max(0, purchasePrice - proposedDebt);
  } else {
    proposed.totalAssetValue += purchasePrice;
    proposed.commercialAssetValue += inputs.scenarioType.includes('Commercial') || inputs.scenarioType.includes('Related-Party') ? purchasePrice : 0;
    proposed.industrialAssetValue += inputs.scenarioType.includes('Industrial') || inputs.scenarioType.includes('Owner-Occupied') ? purchasePrice : 0;
    proposed.totalDebt += proposedDebt + equityRelease;
    proposed.commercialDebt += proposedDebt + equityRelease;
    proposed.annualNoi += inputs.scenarioType === 'Vacancy / Rent Stress' ? -Math.abs(annualNoi) : annualNoi;
    proposed.annualDebtService += annualDebtService;
    proposed.availableLiquidity = current.availableLiquidity - requiredEquity + cashInjection + equityRelease;
  }

  proposed.requiredEquity = requiredEquity;
  proposed.postSettlementLiquidity = proposed.availableLiquidity;
  proposed.netEquity = proposed.totalAssetValue - proposed.totalDebt;
  proposed.weightedLvr = proposed.totalAssetValue > 0 ? proposed.totalDebt / proposed.totalAssetValue : null;
  proposed.portfolioIcr = proposed.annualDebtService > 0 ? proposed.annualNoi / proposed.annualDebtService : null;
  proposed.portfolioDscr = proposed.annualDebtService > 0 ? (proposed.annualNoi + proposed.annualBusinessIncome) / proposed.annualDebtService : null;
  proposed.debtYield = proposed.totalDebt > 0 ? proposed.annualNoi / proposed.totalDebt : null;
  proposed.preTaxCashflow = current.preTaxCashflow + (inputs.annualCashflow ?? (annualNoi - annualDebtService));
  proposed.afterTaxCashflow = proposed.preTaxCashflow * 0.7;
  proposed.borrowingCapacity = Math.max(0, (proposed.annualNoi + proposed.annualBusinessIncome) * 6 - proposed.totalDebt);
  proposed.keyConstraint = inputs.borrowingResult?.bindingConstraint ?? (proposed.postSettlementLiquidity < 0 ? 'Equity / liquidity shortfall' : 'Portfolio scenario');
  proposed.riskRating = proposed.postSettlementLiquidity < 0 || (proposed.weightedLvr != null && proposed.weightedLvr > 0.8) ? 'red' : (proposed.weightedLvr != null && proposed.weightedLvr > 0.7) || (proposed.portfolioDscr != null && proposed.portfolioDscr < 1.25) ? 'amber' : 'green';
  return proposed;
}

export function buildClientScenario(client: ClientProfile, inputs: ProposedScenarioInputs): ClientScenario {
  const current = summarizeClientPortfolio(client);
  const proposed = applyScenarioChanges(current, inputs);
  const now = new Date().toISOString();
  const scenarioId = `scenario-${Date.now()}`;
  const liquidityMonths = monthsLiquidity(proposed.postSettlementLiquidity, proposed.annualDebtService);
  const warnings = buildScenarioWarnings(client, proposed, inputs);
  return {
    scenarioId,
    clientId: client.clientId,
    scenarioName: inputs.scenarioName,
    scenarioType: inputs.scenarioType,
    status: inputs.status ?? 'Draft',
    createdAt: now,
    createdBy: 'Calculator user',
    currentPositionSnapshot: current,
    proposedChanges: { ...inputs, reliability: calculateScenarioReliability(client), postSettlementLiquidityMonths: liquidityMonths ?? 'N/A' },
    resultingPosition: proposed,
    calculatorInputs: { selectedProperty: inputs.selectedProperty, scenarioType: inputs.scenarioType },
    calculatorOutputs: inputs.borrowingResult,
    warnings,
    requiredDocuments: ['Updated asset values', 'Loan statements', 'Business financials', 'Bank statements', 'Scenario approval confirmation'],
    reportSummary: `${inputs.scenarioName}: borrowing capacity movement ${Math.round(proposed.borrowingCapacity - current.borrowingCapacity).toLocaleString('en-AU')}; post-settlement liquidity ${liquidityMonths == null ? 'N/A' : Math.round(proposed.postSettlementLiquidity).toLocaleString('en-AU')}.`,
    auditLog: [{ timestamp: now, user: 'Calculator user', action: 'Scenario generated', source: 'Commercial / Industrial calculator', scenarioId }],
  };
}
