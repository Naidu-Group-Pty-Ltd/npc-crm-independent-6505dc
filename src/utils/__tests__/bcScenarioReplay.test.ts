import { describe, expect, it } from 'vitest';
import {
  buildPersistedBcScenarioV2,
  buildSnapshotHashes,
  computeScenarioDrift,
  stableHash,
} from '../bcScenarioReplay';
import type { BorrowingCapacityInput, BorrowingCapacityResult } from '../borrowingCapacityCalculations';

const baseInputs: BorrowingCapacityInput = {
  grossAnnualIncome: 180_000,
  shadedAnnualIncome: 160_000,
  monthlyLivingExpenses: 4_500,
  monthlyCommitments: 1_500,
  interestRate: 6,
  bufferRate: 3,
  loanTermYears: 30,
  totalDebtBalances: 400_000,
};

const result: BorrowingCapacityResult & { assessmentId: string; calculatedAt: string } = {
  assessmentId: 'assessment-1234567890',
  calculatedAt: '2026-06-07T00:00:00.000Z',
  borrowingCapacity: 500_000,
  monthlySurplus: 4_000,
  serviceabilityBand: 'green',
  stressTestedCapacity: 450_000,
  dtiRatio: 5.1,
  assessmentRate: 9,
  recommendations: [],
  warnings: [],
  afterTaxAnnualIncome: 120_000,
  monthlyAfterTaxIncome: 10_000,
};

const properties = [{
  id: 'prop-1',
  address: '1 Test Street',
  propertyType: 'investment',
  currentValue: 500_000,
  loanRemaining: 300_000,
  monthlyRepayment: 2_400,
}];

const liabilities = [{
  id: 'card-1',
  type: 'credit_card',
  label: 'Credit Card',
  balance: 20_000,
  monthlyServicing: 750,
}];

describe('bcScenarioReplay', () => {
  it('hashes equivalent objects deterministically regardless of key order', () => {
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
  });

  it('builds replayable v2 payloads with base assessment, snapshots, deltas and acquisition context', () => {
    const replay = buildPersistedBcScenarioV2({
      scenarioName: 'Purchase target',
      baseInputs,
      baseResult: result,
      adjustedInputs: baseInputs,
      resultSnapshot: result,
      scenarioDeltas: [{ id: 'income', label: 'Income +10%', type: 'income_change', value: 10, unit: 'percent' }],
      acquisition: { enabled: true, state: 'NSW', intent: 'investor', cashOnHand: 150_000, targetPurchasePrice: 500_000 },
      acquisitionCapacity: null,
      validationIssues: [],
      capitalLedger: null,
      properties,
      liabilities,
      incomeComponents: [],
      createdAt: '2026-06-07T01:00:00.000Z',
    });

    expect(replay.schemaVersion).toBe(2);
    expect(replay.baseAssessmentId).toBe('assessment-1234567890');
    expect(replay.scenario.deltas).toHaveLength(1);
    expect(replay.scenario.adjustedInputs.totalDebtBalances).toBe(400_000);
    expect(replay.scenario.acquisition?.targetPurchasePrice).toBe(500_000);
    expect(replay.createdFrom.snapshotHashes.combined).toMatch(/^[0-9a-f]{8}$/);
    expect(replay.audit.evidenceCompleteness).toBe('complete');
  });

  it('detects drift when current base inputs or source snapshots change', () => {
    const replay = buildPersistedBcScenarioV2({
      scenarioName: 'Debt payoff',
      baseInputs,
      baseResult: result,
      adjustedInputs: baseInputs,
      resultSnapshot: result,
      scenarioDeltas: [{ id: 'card-1', label: 'Pay card', type: 'liability_payoff', value: 20_000, unit: 'absolute' }],
      validationIssues: [],
      properties,
      liabilities,
      incomeComponents: [],
    });

    expect(computeScenarioDrift(replay, { baseInputs, properties, liabilities, incomeComponents: [] }).isStale).toBe(false);

    const changedInputs = { ...baseInputs, grossAnnualIncome: 190_000 };
    const drift = computeScenarioDrift(replay, { baseInputs: changedInputs, properties, liabilities, incomeComponents: [] });

    expect(drift.isStale).toBe(true);
    expect(drift.changed).toContain('baseInputs');
    expect(drift.changed).toContain('combined');
    expect(buildSnapshotHashes({ baseInputs: changedInputs, properties, liabilities, incomeComponents: [] }).combined)
      .not.toBe(replay.createdFrom.snapshotHashes.combined);
  });
});
