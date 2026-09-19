import { describe, expect, it } from 'vitest';
import { resolveCashFlowFinancialSummary } from './financialSummary';
import type { InvestmentReport } from './types';

const report = (overrides: Partial<InvestmentReport>): InvestmentReport => ({
  id: 'report-1',
  property_address: '1 Test Street, Sydney NSW 2000',
  property_listing_id: null,
  created_at: '2026-08-15T00:00:00.000Z',
  ...overrides,
});

describe('resolveCashFlowFinancialSummary', () => {
  it('uses the lightweight list projection when present', () => {
    expect(resolveCashFlowFinancialSummary(report({
      cash_flow_purchase_price: 845000,
      cash_flow_weekly_rent: 720,
    }))).toEqual({ purchasePrice: 845000, weeklyRent: 720 });
  });

  it('resolves canonical nested report financials', () => {
    expect(resolveCashFlowFinancialSummary(report({
      financial_calculations: {
        initialCosts: { propertyValue: 910000 },
        income: { weeklyRent: 780 },
      },
    }))).toEqual({ purchasePrice: 910000, weeklyRent: 780 });
  });

  it('keeps manual overrides ahead of historical financial aliases', () => {
    expect(resolveCashFlowFinancialSummary(report({
      manual_overrides: { purchasePrice: '875,000', weeklyRent: '$745' },
      financial_calculations: { purchasePrice: 800000, weekly_rent: 700 },
    }))).toEqual({ purchasePrice: 875000, weeklyRent: 745 });
  });
});