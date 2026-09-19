/**
 * Scenario and stress testing.
 *
 * A scenario is a *named mutation* of the base payload, not a copy of the
 * assessment. That keeps the comparison honest — the engine can always state
 * exactly which assumption changed, because the change is the scenario's
 * definition rather than a diff of two hand-edited documents.
 */

import { toWholeDollars } from './money';
import { runAssessment, type AssessmentResult, type RunAssessmentOptions } from './engine';
import type { AssessmentPayload } from './types';

export type ScenarioKey =
  | 'base'
  | 'higher_rate'
  | 'lower_rent'
  | 'vacancy'
  | 'higher_opex'
  | 'valuation_reduction'
  | 'shorter_amortisation'
  | 'altered_loan'
  | 'altered_deposit'
  | 'interest_only'
  | 'principal_and_interest'
  | 'custom';

export interface ScenarioDefinition {
  key: ScenarioKey;
  label: string;
  description: string;
  /** Human description of the single assumption that moved. */
  changedAssumption: string;
  apply: (payload: AssessmentPayload) => AssessmentPayload;
}

/** Structured-clone a payload without dragging in a dependency. */
function clone(payload: AssessmentPayload): AssessmentPayload {
  return JSON.parse(JSON.stringify(payload)) as AssessmentPayload;
}

export interface ScenarioParameters {
  ratePointsIncrease: number;
  rentReductionPercent: number;
  vacancyPercent: number;
  opexIncreasePercent: number;
  valuationReductionPercent: number;
  amortisationYears: number;
  loanAmount: number;
  depositAmount: number;
}

export const DEFAULT_SCENARIO_PARAMETERS: ScenarioParameters = {
  ratePointsIncrease: 2,
  rentReductionPercent: 10,
  vacancyPercent: 15,
  opexIncreasePercent: 20,
  valuationReductionPercent: 10,
  amortisationYears: 15,
  loanAmount: 0,
  depositAmount: 0,
};

export function buildScenarioDefinitions(
  parameters: ScenarioParameters = DEFAULT_SCENARIO_PARAMETERS,
): ScenarioDefinition[] {
  return [
    {
      key: 'base',
      label: 'Base case',
      description: 'The assessment exactly as entered.',
      changedAssumption: 'None — this is the reference case.',
      apply: (payload) => payload,
    },
    {
      key: 'higher_rate',
      label: `Rate +${parameters.ratePointsIncrease}%`,
      description: 'Contract rate rises, lifting both the contract and assessment cost of debt.',
      changedAssumption: `Contract interest rate increased by ${parameters.ratePointsIncrease} percentage points.`,
      apply: (payload) => {
        const next = clone(payload);
        next.loan.actualRatePercent += parameters.ratePointsIncrease;
        return next;
      },
    },
    {
      key: 'lower_rent',
      label: `Rent −${parameters.rentReductionPercent}%`,
      description: 'Passing rent reverts below the current level on review or re-letting.',
      changedAssumption: `Every tenancy rent reduced by ${parameters.rentReductionPercent}%.`,
      apply: (payload) => {
        const next = clone(payload);
        const factor = 1 - parameters.rentReductionPercent / 100;
        next.lease.tenancies = next.lease.tenancies.map((tenancy) => ({
          ...tenancy,
          annualRent: tenancy.annualRent * factor,
        }));
        return next;
      },
    },
    {
      key: 'vacancy',
      label: `Vacancy ${parameters.vacancyPercent}%`,
      description: 'A structural vacancy allowance is applied to the asset.',
      changedAssumption: `Vacancy allowance set to ${parameters.vacancyPercent}%.`,
      apply: (payload) => {
        const next = clone(payload);
        next.lease.vacancyAllowancePercent = Math.max(
          next.lease.vacancyAllowancePercent, parameters.vacancyPercent,
        );
        return next;
      },
    },
    {
      key: 'higher_opex',
      label: `Operating costs +${parameters.opexIncreasePercent}%`,
      description: 'Outgoings, rates and maintenance rise above the budgeted level.',
      changedAssumption: `Recoverable and non-recoverable outgoings increased by ${parameters.opexIncreasePercent}%.`,
      apply: (payload) => {
        const next = clone(payload);
        const factor = 1 + parameters.opexIncreasePercent / 100;
        next.lease.recoverableOutgoings *= factor;
        next.lease.nonRecoverableOutgoings *= factor;
        return next;
      },
    },
    {
      key: 'valuation_reduction',
      label: `Valuation −${parameters.valuationReductionPercent}%`,
      description: 'The bank valuation comes in below the contract price.',
      changedAssumption: `Current valuation reduced by ${parameters.valuationReductionPercent}%.`,
      apply: (payload) => {
        const next = clone(payload);
        const factor = 1 - parameters.valuationReductionPercent / 100;
        const base = next.property.currentValuation > 0
          ? next.property.currentValuation
          : next.property.purchasePrice;
        next.property.currentValuation = base * factor;
        return next;
      },
    },
    {
      key: 'shorter_amortisation',
      label: `Amortisation ${parameters.amortisationYears} years`,
      description: 'The lender requires a faster principal reduction profile.',
      changedAssumption: `Amortisation term shortened to ${parameters.amortisationYears} years.`,
      apply: (payload) => {
        const next = clone(payload);
        next.loan.amortisationYears = parameters.amortisationYears;
        return next;
      },
    },
    {
      key: 'interest_only',
      label: 'Interest only',
      description: 'The facility is written interest-only for its term.',
      changedAssumption: 'Repayment type changed to interest only.',
      apply: (payload) => {
        const next = clone(payload);
        next.loan.repaymentType = 'interestOnly';
        return next;
      },
    },
    {
      key: 'principal_and_interest',
      label: 'Principal and interest',
      description: 'The facility amortises from day one.',
      changedAssumption: 'Repayment type changed to principal and interest.',
      apply: (payload) => {
        const next = clone(payload);
        next.loan.repaymentType = 'principalAndInterest';
        next.loan.interestOnlyPeriodYears = 0;
        return next;
      },
    },
    ...(parameters.loanAmount > 0 ? [{
      key: 'altered_loan' as const,
      label: 'Altered loan amount',
      description: 'The requested facility is resized.',
      changedAssumption: `Requested loan changed to ${parameters.loanAmount.toLocaleString('en-AU')}.`,
      apply: (payload: AssessmentPayload) => {
        const next = clone(payload);
        next.loan.requestedLoan = parameters.loanAmount;
        return next;
      },
    }] : []),
    ...(parameters.depositAmount > 0 ? [{
      key: 'altered_deposit' as const,
      label: 'Altered contribution',
      description: 'The borrower contributes a different amount of their own funds.',
      changedAssumption: `Deposit / contribution changed to ${parameters.depositAmount.toLocaleString('en-AU')}.`,
      apply: (payload: AssessmentPayload) => {
        const next = clone(payload);
        next.property.depositOrContribution = parameters.depositAmount;
        return next;
      },
    }] : []),
  ];
}

export interface ScenarioOutcome {
  key: ScenarioKey;
  label: string;
  changedAssumption: string;
  result: AssessmentResult;
  comparison: {
    maximumIndicativeLoan: number;
    lvr: number;
    dscr: number;
    icr: number;
    annualDebtService: number;
    borrowerContribution: number;
    fundingGap: number;
    netCashFlow: number;
    outcomeLabel: string;
    bindingConstraint: string;
    /** Signed movement against the base case. */
    deltaMaximumLoan: number;
    deltaDscr: number;
    deltaNetCashFlow: number;
  };
  keyWarnings: string[];
}

/**
 * Run the base case plus every requested scenario and return them side by side.
 * The base case is always index 0 and every delta is struck against it.
 */
export function runScenarios(
  payload: AssessmentPayload,
  keys: ScenarioKey[],
  options: RunAssessmentOptions & { parameters?: ScenarioParameters } = {},
): ScenarioOutcome[] {
  const definitions = buildScenarioDefinitions(options.parameters ?? DEFAULT_SCENARIO_PARAMETERS);
  const wanted = ['base' as ScenarioKey, ...keys.filter((key) => key !== 'base')];

  const selected = wanted
    .map((key) => definitions.find((definition) => definition.key === key))
    .filter((definition): definition is ScenarioDefinition => Boolean(definition));

  const runOptions: RunAssessmentOptions = {
    organisationPolicy: options.organisationPolicy,
    asAt: options.asAt,
  };

  const results = selected.map((definition) => ({
    definition,
    result: runAssessment(definition.apply(payload), runOptions),
  }));

  const base = results[0]?.result;

  return results.map(({ definition, result }) => {
    const maximumIndicativeLoan = toWholeDollars(result.serviceability.maximumIndicativeLoanCents);
    const netCashFlow = toWholeDollars(result.portfolioImpact.proposed.netCashFlowCents);
    const dscr = result.serviceability.proposedDscr;

    return {
      key: definition.key,
      label: definition.label,
      changedAssumption: definition.changedAssumption,
      result,
      comparison: {
        maximumIndicativeLoan,
        lvr: result.transaction.proposedLvr,
        dscr,
        icr: result.serviceability.proposedIcr,
        annualDebtService: toWholeDollars(result.transaction.annualDebtServiceCents),
        borrowerContribution: toWholeDollars(result.transaction.borrowerContributionCents),
        fundingGap: toWholeDollars(result.transaction.fundingGapCents),
        netCashFlow,
        outcomeLabel: result.outcomeLabel,
        bindingConstraint: result.serviceability.bindingConstraintLabel,
        deltaMaximumLoan: base
          ? maximumIndicativeLoan - toWholeDollars(base.serviceability.maximumIndicativeLoanCents)
          : 0,
        deltaDscr: base ? Number((dscr - base.serviceability.proposedDscr).toFixed(4)) : 0,
        deltaNetCashFlow: base
          ? netCashFlow - toWholeDollars(base.portfolioImpact.proposed.netCashFlowCents)
          : 0,
      },
      keyWarnings: result.warnings
        .filter((warning) => warning.severity !== 'info')
        .slice(0, 4)
        .map((warning) => warning.message),
    };
  });
}
