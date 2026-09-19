import type { ClientScenario } from './clientPortfolioTypes';
import { comparePortfolioScenario } from './scenarioComparisonEngine';
import { buildClientScenarioOutputSummary } from './scenarioSyncEngine';

export function buildScenarioReportPayload(scenario: ClientScenario) {
  const comparison = comparePortfolioScenario(scenario.currentPositionSnapshot, scenario.resultingPosition);
  const assumptions = (scenario.proposedChanges as any).assumptions ?? (scenario.calculatorInputs as any).assumptions ?? {};
  const assumptionStatuses = Object.fromEntries(Object.entries(assumptions).map(([field, value]: [string, any]) => [field, value?.confidenceTag ?? value?.status ?? 'Unknown']));
  return {
    title: 'Client Portfolio Scenario Report',
    generatedAt: new Date().toISOString(),
    scenario: { scenarioId: scenario.scenarioId, clientId: scenario.clientId, scenarioName: scenario.scenarioName, scenarioType: scenario.scenarioType, status: scenario.status },
    savedScenarioOutput: buildClientScenarioOutputSummary(scenario),
    narrative: {
      currentPosition: 'Summarises the client’s verified current portfolio, liquidity, debt and servicing position before the proposed scenario.',
      proposedScenario: 'Explains the proposed acquisition, restructure or portfolio action and the calculator assumptions used.',
      portfolioImpact: 'Compares portfolio value, total debt, weighted LVR, cashflow, borrowing capacity and liquidity after the scenario.',
      risksAndMissingInformation: scenario.warnings,
      recommendedNextSteps: (scenario.calculatorOutputs as any)?.requiredNextAction ?? scenario.resultingPosition.keyConstraint,
    },
    assumptionStatuses,
    assumptionStatusLegend: ['Verified', 'Client Profile Source', 'Manual Estimate', 'AI Estimate', 'Unknown', 'Overridden', 'Specialist Review Required'],
    sections: [
      { title: 'Current Position Summary', data: comparison.current },
      { title: 'Proposed Acquisition / Restructure', data: scenario.proposedChanges },
      { title: 'Proposed Scenario Summary', data: comparison.proposed },
      { title: 'Difference Table', data: comparison.difference },
      { title: 'Impact on Portfolio Value', data: comparison.difference.totalAssetValue },
      { title: 'Impact on Debt', data: comparison.difference.totalDebt },
      { title: 'Impact on Cashflow', data: comparison.difference.preTaxCashflow },
      { title: 'Impact on Borrowing Capacity', data: comparison.difference.borrowingCapacity },
      { title: 'Risks and Missing Information', data: { riskRating: comparison.proposed.riskRating, warnings: scenario.warnings.concat(comparison.warnings) } },
      { title: 'Required Documents', data: scenario.requiredDocuments },
      { title: 'Recommended Next Steps', data: (scenario.calculatorOutputs as any)?.requiredNextAction ?? scenario.resultingPosition.keyConstraint },
      { title: 'Assumption Source Statuses', data: assumptionStatuses },
      { title: 'Audit Log', data: scenario.auditLog },
    ],
  };
}
