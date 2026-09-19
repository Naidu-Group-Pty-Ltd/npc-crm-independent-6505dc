import { runDcf, type DcfInputs, type DcfResult } from './dcfEngine';
export type DcfScenarioType = 'Base' | 'Conservative' | 'Optimistic' | 'Higher vacancy' | 'Higher capex' | 'Softer exit cap' | 'Higher interest rate';
export interface DcfAssessmentInputs extends DcfInputs { dataSourceMode?: 'global' | 'manualOverride' | 'aiEstimate'; initialNoiBasis?: 'actual' | 'stabilised' | 'lenderAdjusted'; leaseExpiryYear?: number; downtimeMonths?: number; relettingProbabilityPct?: number; leasingFeePct?: number; tenantIncentiveMonths?: number; annualCapex?: number; majorCapexSchedule?: Array<{ year: number; amount: number; category: string }>; exitCapSensitivityPct?: number[]; refinanceLoanMaturityYear?: number; residualBalloonLoanBalance?: number; taxDepreciationEnabled?: boolean; }
export interface DcfAssessmentResult extends DcfResult { sensitivityTable: Array<{ exitCapRatePct: number; terminalValue: number; netSaleProceeds: number }>; warnings: string[]; scenarios: Array<{ name: DcfScenarioType; result: DcfResult }> }
export function runDcfAssessment(inputs: DcfAssessmentInputs): DcfAssessmentResult {
  const warnings: string[] = [];
  const capexSchedule = [...(inputs.capexSchedule ?? [])];
  if (inputs.annualCapex != null) for (let y = 0; y < inputs.holdPeriodYears; y++) capexSchedule[y] = (capexSchedule[y] ?? 0) + inputs.annualCapex;
  for (const c of inputs.majorCapexSchedule ?? []) capexSchedule[c.year - 1] = (capexSchedule[c.year - 1] ?? 0) + c.amount;
  const downtimeLoss = inputs.downtimeMonths ? (inputs.initialNoi / 12) * inputs.downtimeMonths : 0;
  if (downtimeLoss) capexSchedule[Math.max(0, (inputs.leaseExpiryYear ?? 1) - 1)] = (capexSchedule[Math.max(0, (inputs.leaseExpiryYear ?? 1) - 1)] ?? 0) + downtimeLoss;
  if (!capexSchedule.some(Boolean)) warnings.push('Capex is zero; returns may be overstated.');
  if (!inputs.terminalCapRatePct) warnings.push('Exit assumptions are missing; DCF cannot be final.');
  const base = runDcf({ ...inputs, capexSchedule });
  const sensitivityTable = (inputs.exitCapSensitivityPct ?? [inputs.terminalCapRatePct - 0.5, inputs.terminalCapRatePct, inputs.terminalCapRatePct + 0.5]).filter(n => n > 0).map(exitCapRatePct => {
    const r = runDcf({ ...inputs, capexSchedule, terminalCapRatePct: exitCapRatePct });
    return { exitCapRatePct, terminalValue: r.terminalValue, netSaleProceeds: r.netSaleProceeds };
  });
  const scenarioDefs: Array<[DcfScenarioType, Partial<DcfInputs>]> = [['Base', {}], ['Conservative', { rentalGrowthPct: 1, vacancyAllowancePct: (inputs.vacancyAllowancePct ?? 0) + 2, terminalCapRatePct: inputs.terminalCapRatePct + 0.5 }], ['Optimistic', { rentalGrowthPct: typeof inputs.rentalGrowthPct === 'number' ? inputs.rentalGrowthPct + 1 : inputs.rentalGrowthPct, terminalCapRatePct: Math.max(0.1, inputs.terminalCapRatePct - 0.25) }], ['Higher vacancy', { vacancyAllowancePct: (inputs.vacancyAllowancePct ?? 0) + 3 }], ['Higher capex', { capexSchedule: capexSchedule.map(c => c * 1.25) }], ['Softer exit cap', { terminalCapRatePct: inputs.terminalCapRatePct + 0.75 }], ['Higher interest rate', { interestRatePct: (inputs.interestRatePct ?? 0) + 1 }]];
  return { ...base, sensitivityTable, warnings, scenarios: scenarioDefs.map(([name, patch]) => ({ name, result: runDcf({ ...inputs, capexSchedule, ...patch }) })) };
}
