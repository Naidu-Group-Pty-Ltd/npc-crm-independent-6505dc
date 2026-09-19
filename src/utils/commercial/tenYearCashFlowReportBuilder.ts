import type { TenYearCashFlowResult } from './tenYearCashFlowTypes';

export interface TenYearCashFlowReportPayload {
  title: string;
  generatedAt: string;
  sections: Array<{ title: string; data: unknown }>;
  disclaimer: string[];
}

export function buildTenYearCashFlowReportPayload(result: TenYearCashFlowResult): TenYearCashFlowReportPayload {
  const assumptionsByStatus = Object.values(result.assumptions).reduce<Record<string, string[]>>((acc, assumption) => {
    acc[assumption.status] = [...(acc[assumption.status] ?? []), assumption.key];
    return acc;
  }, {});
  const modeTitle = result.mode === 'investor' ? '10-Year Investor Cash Flow Table' : result.mode === 'ownerOccupier' ? '10-Year Owner-Occupier Cash Flow Table' : 'Related-Party Lease Analysis';
  return {
    title: 'Commercial / Industrial 10-Year Cash Flow Report',
    generatedAt: new Date().toISOString(),
    sections: [
      { title: 'Cover / Branding', data: { reportType: 'Commercial / Industrial 10-Year Cash Flow' } },
      { title: 'Executive Summary', data: result.summary },
      { title: 'Transaction Snapshot', data: { assetDomain: result.inputs.assetDomain, assetSubtype: result.inputs.assetSubtype, state: result.inputs.state, purchasePrice: result.inputs.purchasePrice } },
      { title: 'Input Summary', data: result.inputs },
      { title: 'Acquisition / Funds-to-Complete', data: { purchasePrice: result.inputs.purchasePrice, gstSettlementCashflow: result.inputs.gstSettlementCashflow, gstEconomicCost: result.inputs.gstEconomicCost, totalAcquisitionCosts: result.inputs.totalAcquisitionCosts, totalCostBase: result.inputs.totalCostBase, loanAmount: result.inputs.loanAmount, requiredEquity: result.inputs.requiredEquity, availableEquity: result.inputs.availableEquity, postSettlementLiquidity: result.inputs.postSettlementLiquidity } },
      ...(result.inputs.stagedScheduleEnabled ? [{ title: 'Construction / Fit-Out Schedule', data: { stagedScheduleEnabled: true } }] : []),
      { title: modeTitle, data: result.years },
      { title: 'Valuation / Equity / LVR Summary', data: result.years.map(y => ({ year: y.year, propertyValue: y.propertyValue, loanBalance: y.closingLoanBalance, equity: y.equityPosition, lvr: y.lvr })) },
      { title: 'ICR / DSCR / Debt-Yield Summary', data: result.years.map(y => ({ year: y.year, icr: y.icr, dscr: y.dscr, debtYield: y.debtYield })) },
      { title: 'Tax / Depreciation Summary', data: result.years.map(y => ({ year: y.year, taxableIncome: y.taxableIncome, taxPayableBenefit: y.taxPayableBenefit })) },
      { title: 'GST Summary', data: { gstSettlementCashflow: result.inputs.gstSettlementCashflow, gstEconomicCost: result.inputs.gstEconomicCost } },
      { title: 'DCF / Exit Summary', data: { terminalValue: result.summary.terminalValue, leveredIrr: result.summary.leveredIrr, unleveredIrr: result.summary.unleveredIrr, equityMultiple: result.summary.equityMultiple } },
      { title: 'Risk Summary', data: { status: result.summary.riskStatus, warnings: result.warnings } },
      { title: 'AI-Estimated Assumptions', data: assumptionsByStatus['AI Estimate'] ?? [] },
      { title: 'Required Verification Documents', data: result.requiredDocuments },
      { title: 'Disclaimer', data: 'See disclaimer section.' },
    ],
    disclaimer: [
      'This is general information only and is not financial, tax, legal or credit advice.',
      'Projections are based on assumptions and estimates that may change.',
      'Commercial/industrial values, rents, cap rates, vacancy, GST and tax outcomes can change.',
      'GST and tax assumptions must be confirmed by an accountant and/or solicitor.',
      'Lending outcomes are subject to lender approval, valuation and policy.',
      'AI estimates are indicative only until verified.',
      'Clients should obtain independent financial, legal, tax and lending advice before making decisions.',
    ],
  };
}
