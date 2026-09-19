import { describe, expect, it } from 'vitest';
import { aiAdjustmentsToDeltas } from './BCScenarioAgent';

describe('aiAdjustmentsToDeltas', () => {
  it('preserves AI capital allocations in the local preview deltas', () => {
    const deltas = aiAdjustmentsToDeltas({
      consolidatedLiabilityIds: [],
      refinancedToIOPropertyIds: [],
      rateAdjustment: 0,
      incomeGrowthPercent: 0,
      expenseReductionPercent: 0,
      capitalAllocations: [{
        amount: 20_000,
        sinkType: 'liability_payoff',
        sinkTargetId: 'liability-1',
      }],
    });

    expect(deltas).toContainEqual({
      id: 'cap-alloc-0-liability_payoff',
      label: 'Allocate $20,000 → liability payoff',
      type: 'capital_allocation',
      value: 20_000,
      unit: 'absolute',
      meta: {
        sinkType: 'liability_payoff',
        sinkTargetId: 'liability-1',
        sourcePool: 'pool-default',
        offsetRatePoints: undefined,
        rateBuydownPoints: undefined,
        repaymentReductionMonthly: undefined,
      },
    });
  });
});
