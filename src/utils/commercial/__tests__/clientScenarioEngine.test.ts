import { describe, expect, it } from 'vitest';
import { buildClientScenario, comparePortfolioScenario, summarizeClientPortfolio } from '..';
import { testClientProfiles } from './fixtures/clientProfile';

describe('Client portfolio scenario engine', () => {
  it('summarises current portfolio and compares proposed acquisition scenario', () => {
    const client = testClientProfiles[0];
    const current = summarizeClientPortfolio(client);
    const scenario = buildClientScenario(client, { scenarioName: 'Acquire warehouse', scenarioType: 'Acquire Industrial Asset', purchasePrice: 2_000_000, proposedDebt: 1_200_000, requiredEquity: 900_000, annualNoi: 140_000, annualDebtService: 95_000 });
    const comparison = comparePortfolioScenario(current, scenario.resultingPosition);
    expect(current.totalAssetValue).toBeGreaterThan(0);
    expect(comparison.proposed.totalAssetValue - comparison.current.totalAssetValue).toBe(2_000_000);
    expect(comparison.difference.totalDebt).toBe(1_200_000);
    expect(comparison.difference.requiredEquity).toBe(900_000);
    expect(scenario.auditLog.length).toBeGreaterThan(0);
    expect(scenario.requiredDocuments).toContain('Business financials');
  });
});
