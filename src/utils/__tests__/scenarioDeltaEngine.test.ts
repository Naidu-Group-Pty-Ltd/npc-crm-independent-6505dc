import { describe, expect, it } from 'vitest';
import { calculateBorrowingCapacity, type BorrowingCapacityInput } from '../borrowingCapacityCalculations';
import { runScenarioWithInputs, type ScenarioContext } from '../scenarioDeltaEngine';
import type { ScenarioDelta } from '../borrowingCapacityTypes';

const baseInputs: BorrowingCapacityInput = {
  grossAnnualIncome: 180_000,
  shadedAnnualIncome: 160_000,
  monthlyLivingExpenses: 4_500,
  monthlyCommitments: 1_500,
  interestRate: 6,
  bufferRate: 3,
  loanTermYears: 30,
  totalDebtBalances: 400_000,
  dtiCapEnabled: false,
  dtiCapLimit: 6,
};

function baseContext(overrides: Partial<ScenarioContext> = {}): ScenarioContext {
  const baseResult = calculateBorrowingCapacity(baseInputs);
  return {
    baseInputs,
    baseResult,
    properties: [
      {
        id: 'prop-1',
        address: '1 Test Street',
        propertyType: 'investment',
        currentValue: 500_000,
        loanRemaining: 300_000,
        monthlyRepayment: 2_400,
        loanRepaymentAmount: 2_400,
        netMonthlyCashflow: -200,
        interestRate: 6,
      },
    ],
    liabilities: [
      {
        id: 'card-1',
        type: 'credit_card',
        label: 'Credit Card',
        balance: 20_000,
        limit: 25_000,
        monthlyServicing: 750,
      },
    ],
    ...overrides,
  };
}

describe('scenarioDeltaEngine Phase 1 invariants', () => {
  it('keeps a no-delta scenario identical to the base result and inputs', () => {
    const ctx = baseContext();
    const { result, inputs, issues } = runScenarioWithInputs('No changes', [], ctx);

    expect(issues).toEqual([]);
    expect(inputs).toMatchObject(baseInputs);
    expect(result.borrowingCapacity).toBe(ctx.baseResult.borrowingCapacity);
    expect(result.monthlySurplus).toBe(ctx.baseResult.monthlySurplus);
    expect(result.capacityChange.absolute).toBe(0);
  });

  it('applies income growth through adjusted inputs and increases capacity', () => {
    const ctx = baseContext();
    const deltas: ScenarioDelta[] = [{
      id: 'income-10',
      label: 'Income +10%',
      type: 'income_change',
      value: 10,
      unit: 'percent',
    }];

    const { result, inputs } = runScenarioWithInputs('Income growth', deltas, ctx);

    expect(inputs.grossAnnualIncome).toBe(198_000);
    expect(result.borrowingCapacity).toBeGreaterThan(ctx.baseResult.borrowingCapacity);
  });

  it('floors expense reductions at HEM when the lender profile enforces it', () => {
    const ctx = baseContext({ hemBenchmark: 4_000 });
    const deltas: ScenarioDelta[] = [{
      id: 'expense-cut',
      label: 'Cut expenses 50%',
      type: 'expense_change',
      value: -50,
      unit: 'percent',
    }];

    const { inputs, issues } = runScenarioWithInputs('HEM floor', deltas, ctx);

    expect(inputs.monthlyLivingExpenses).toBe(4_000);
    expect(issues.some(issue => issue.severity === 'warning' && issue.message.includes('HEM benchmark'))).toBe(true);
  });

  it('treats unknown entity-bound deltas as blocking errors and excludes them from math', () => {
    const ctx = baseContext();
    const deltas: ScenarioDelta[] = [{
      id: 'missing-liability',
      label: 'Pay off missing liability',
      type: 'liability_payoff',
      value: 10_000,
      unit: 'absolute',
    }];

    const { result, inputs, issues } = runScenarioWithInputs('Unknown liability', deltas, ctx);

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', deltaId: 'missing-liability' }));
    expect(result.deltas).toEqual([]);
    expect(inputs.monthlyCommitments).toBe(baseInputs.monthlyCommitments);
    expect(result.borrowingCapacity).toBe(ctx.baseResult.borrowingCapacity);
  });

  it('applies liability payoff to both commitments and DTI debt balances', () => {
    const ctx = baseContext();
    const deltas: ScenarioDelta[] = [{
      id: 'card-1',
      label: 'Pay off card',
      type: 'liability_payoff',
      value: 20_000,
      unit: 'absolute',
    }];

    const { result, inputs } = runScenarioWithInputs('Pay off card', deltas, ctx);

    expect(inputs.monthlyCommitments).toBe(750);
    expect(inputs.totalDebtBalances).toBe(380_000);
    expect(result.borrowingCapacity).toBeGreaterThan(ctx.baseResult.borrowingCapacity);
  });

  it('applies valuation changes before equity release so downstream release math sees the new value', () => {
    const ctx = baseContext({ acquisition: { cashOnHand: 0, lmiMode: 'display_deduction' } });
    const deltas: ScenarioDelta[] = [
      {
        id: 'prop-1',
        label: 'Revalue property',
        type: 'property_value_change',
        value: 600_000,
        unit: 'absolute',
        meta: { basis: 'desktop', source: 'test valuation' },
      },
      {
        id: 'prop-1',
        label: 'Release to 80%',
        type: 'equity_release',
        value: 0.8,
        unit: 'ratio',
        meta: { targetLVR: 0.8, deploymentPercent: 1, repaymentType: 'interest_only' },
      },
    ];

    const { effect, inputs } = runScenarioWithInputs('Revalue then release', deltas, ctx);

    expect(effect.releasedCapital).toBeGreaterThanOrEqual(179_000);
    expect(inputs.totalDebtBalances).toBe(580_000);
  });

  it('applies funded liability payoff allocations from explicit cash sources', () => {
    const ctx = baseContext({
      acquisition: { cashOnHand: 25_000, lmiMode: 'display_deduction' },
    });
    const deltas: ScenarioDelta[] = [{
      id: 'funded-card-payoff',
      label: 'Funded card payoff',
      type: 'capital_allocation',
      value: 20_000,
      unit: 'absolute',
      meta: { sinkType: 'liability_payoff', sinkTargetId: 'card-1', sourcePool: 'pool-default' },
    }];

    const { result, inputs, issues } = runScenarioWithInputs('Funded payoff', deltas, ctx);

    expect(issues).not.toContainEqual(expect.objectContaining({ severity: 'error' }));
    expect(inputs.monthlyCommitments).toBe(750);
    expect(inputs.totalDebtBalances).toBe(380_000);
    expect(result.capitalLedger?.pools['pool-default']?.remainder).toBe(5_000);
    expect(result.borrowingCapacity).toBeGreaterThan(ctx.baseResult.borrowingCapacity);
  });

  it('blocks liability payoff allocations that do not have an explicit capital source', () => {
    const ctx = baseContext();
    const deltas: ScenarioDelta[] = [{
      id: 'unfunded-card-payoff',
      label: 'Unfunded card payoff',
      type: 'capital_allocation',
      value: 20_000,
      unit: 'absolute',
      meta: { sinkType: 'liability_payoff', sinkTargetId: 'card-1', sourcePool: 'pool-default' },
    }];

    const { result, inputs, issues } = runScenarioWithInputs('Unfunded payoff', deltas, ctx);

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', deltaId: 'unfunded-card-payoff' }));
    expect(inputs.monthlyCommitments).toBe(baseInputs.monthlyCommitments);
    expect(inputs.totalDebtBalances).toBe(baseInputs.totalDebtBalances);
    expect(result.capitalLedger?.pools['pool-default']?.overcommitted).toBe(true);
    expect(result.borrowingCapacity).toBe(ctx.baseResult.borrowingCapacity);
  });

  it('adds funding-source traces and policy warnings when equity release funds liability payoff', () => {
    const ctx = baseContext();
    const deltas: ScenarioDelta[] = [
      {
        id: 'prop-1',
        label: 'Release equity',
        type: 'equity_release',
        value: 0.9,
        unit: 'ratio',
        meta: { targetLVR: 0.9, deploymentPercent: 1, repaymentType: 'interest_only' },
      },
      {
        id: 'borrowed-funded-card-payoff',
        label: 'Pay card with released equity',
        type: 'capital_allocation',
        value: 20_000,
        unit: 'absolute',
        meta: { sinkType: 'liability_payoff', sinkTargetId: 'card-1', sourcePool: 'pool-default' },
      },
    ];

    const { result, inputs, issues } = runScenarioWithInputs('Borrowed funded payoff', deltas, ctx);

    expect(issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      deltaId: 'borrowed-funded-card-payoff',
    }));
    /*
     * Commitments RISE. This asserted they fall below the $1,500 base, which
     * contradicts the warning and the "Policy check" note the same test
     * demands two lines below — retiring a $750/mo card with money borrowed at
     * the assessed rate is exactly the move those two exist to flag.
     *
     *     base commitments                      1,500
     *     + release drawn against prop-1        1,125   $150,000 @ (6 + 3)% IO
     *     − card servicing retired               -750
     *     =                                     1,875
     *
     * The release is assessed interest-only at the contracted rate plus the
     * APRA buffer, which is what makes the borrowed dollar cost more to
     * service than the card dollar it repays. Both legs are pinned separately
     * below so a break says which one moved.
     */
    const releaseOnly = runScenarioWithInputs('Release only', [deltas[0]], baseContext());
    expect(releaseOnly.inputs.monthlyCommitments).toBe(2_625);
    expect(inputs.monthlyCommitments).toBe(1_875);
    expect(inputs.monthlyCommitments)
      .toBe(releaseOnly.inputs.monthlyCommitments - 750);
    expect(inputs.monthlyCommitments).toBeGreaterThan(baseInputs.monthlyCommitments);
    expect(result.capitalLedger?.pools['pool-default']?.sinks[0]?.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('Funding source trace')]),
    );
    expect(result.capitalLedger?.pools['pool-default']?.sinks[0]?.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('Policy check')]),
    );
  });

  it('treats funded payoff allocations with missing liability targets as blocking errors', () => {
    const ctx = baseContext({
      acquisition: { cashOnHand: 25_000, lmiMode: 'display_deduction' },
    });
    const deltas: ScenarioDelta[] = [{
      id: 'missing-funded-payoff-target',
      label: 'Funded payoff missing target',
      type: 'capital_allocation',
      value: 10_000,
      unit: 'absolute',
      meta: { sinkType: 'liability_payoff', sinkTargetId: 'missing-card', sourcePool: 'pool-default' },
    }];

    const { inputs, issues } = runScenarioWithInputs('Missing funded payoff target', deltas, ctx);

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', deltaId: 'missing-funded-payoff-target' }));
    expect(inputs.monthlyCommitments).toBe(baseInputs.monthlyCommitments);
    expect(inputs.totalDebtBalances).toBe(baseInputs.totalDebtBalances);
  });

  it('blocks debt recycling against non-owner-occupied debt even when cash funded', () => {
    const ctx = baseContext({
      acquisition: { cashOnHand: 30_000, lmiMode: 'display_deduction' },
    });
    const deltas: ScenarioDelta[] = [{
      id: 'bad-debt-recycle',
      label: 'Recycle investment debt',
      type: 'capital_allocation',
      value: 20_000,
      unit: 'absolute',
      meta: { sinkType: 'debt_recycle', sinkTargetId: 'prop-1', sourcePool: 'pool-default' },
    }];

    const { result, issues } = runScenarioWithInputs('Invalid debt recycle', deltas, ctx);

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', deltaId: 'bad-debt-recycle' }));
    expect(result.validationIssues).toContainEqual(expect.objectContaining({ severity: 'error', deltaId: 'bad-debt-recycle' }));
    expect(result.capitalLedger?.pools['pool-default']?.sinks[0]?.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('Debt recycling target must be an owner-occupied')]),
    );
  });

  it('allows debt recycling when own cash funds an owner-occupied loan target', () => {
    const ctx = baseContext({
      acquisition: { cashOnHand: 30_000, lmiMode: 'display_deduction' },
      properties: [{
        id: 'prop-oo',
        address: '1 Home Street',
        propertyType: 'owner_occupied',
        currentValue: 900_000,
        loanRemaining: 500_000,
        monthlyRepayment: 3_200,
        loanRepaymentAmount: 3_200,
        netMonthlyCashflow: 0,
        interestRate: 6,
      }],
    });
    const deltas: ScenarioDelta[] = [{
      id: 'good-debt-recycle',
      label: 'Recycle owner occupied debt',
      type: 'capital_allocation',
      value: 20_000,
      unit: 'absolute',
      meta: { sinkType: 'debt_recycle', sinkTargetId: 'prop-oo', sourcePool: 'pool-default' },
    }];

    const { result, issues } = runScenarioWithInputs('Valid debt recycle', deltas, ctx);

    expect(issues).not.toContainEqual(expect.objectContaining({ severity: 'error' }));
    expect(result.capitalLedger?.pools['pool-default']?.sinks[0]?.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('Funding source trace')]),
    );
    expect(result.capitalLedger?.pools['pool-default']?.sinks[0]?.notes).toEqual(
      expect.arrayContaining([expect.stringContaining('Debt-recycle')]),
    );
  });

  it('computes acquisition capacity with target feasibility when acquisition context is enabled', () => {
    const ctx = baseContext({
      acquisition: {
        state: 'NSW',
        intent: 'investor',
        category: 'established',
        lmiMode: 'display_deduction',
        cashOnHand: 150_000,
        targetPurchasePrice: 400_000,
      },
    });

    const { result } = runScenarioWithInputs('Acquisition target', [], ctx);

    expect(result.acquisitionCapacity).not.toBeNull();
    expect(result.acquisitionCapacity?.targetPurchasePrice).toBe(400_000);
    expect(result.acquisitionCapacity?.maxPurchasePrice).toBeGreaterThan(400_000);
    expect(result.acquisitionCapacity?.meetsTarget).toBe(true);
    expect(result.acquisitionCapacity?.loanRequiredForPurchase).toBeGreaterThan(0);
  });

  it('surfaces overcommitted capital allocations as blocking errors', () => {
    const ctx = baseContext();
    const deltas: ScenarioDelta[] = [
      {
        id: 'prop-1',
        label: 'Release to 80%',
        type: 'equity_release',
        value: 0.8,
        unit: 'ratio',
        meta: { targetLVR: 0.8, deploymentPercent: 1, repaymentType: 'interest_only' },
      },
      {
        id: 'alloc-too-large',
        label: 'Over allocate',
        type: 'capital_allocation',
        value: 500_000,
        unit: 'absolute',
        meta: { sinkType: 'liability_payoff', sinkTargetId: 'card-1', sourcePool: 'pool-default' },
      },
    ];

    const { result, issues } = runScenarioWithInputs('Over allocate', deltas, ctx);

    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', deltaId: 'alloc-too-large' }));
    expect(result.validationIssues).toContainEqual(expect.objectContaining({ severity: 'error', deltaId: 'alloc-too-large' }));
  });
});
