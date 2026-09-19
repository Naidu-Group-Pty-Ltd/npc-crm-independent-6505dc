import { describe, expect, it } from 'vitest';
import { applyCommercialScenarioProposal } from '../scenarioApplyEngine';
import { applyPortfolioImportToggles, summarizeClientPortfolio } from '../clientPortfolioEngine';
import { testClientProfiles } from './fixtures/clientProfile';

const client = testClientProfiles[0];

describe('commercial borrowing capacity unified data flow', () => {
  it('selecting a client profile exposes client details and current portfolio data', () => {
    const summary = summarizeClientPortfolio(client);
    expect(client.clientName).toBe('Synthetic Portfolio Test Client');
    expect(client.residentialAssets).toHaveLength(1);
    expect(client.commercialAssets).toHaveLength(1);
    expect(client.industrialAssets).toHaveLength(1);
    expect(summary.totalAssetValue).toBeGreaterThan(0);
    expect(summary.annualGrossIncome).toBeGreaterThan(0);
  });

  it('import current portfolio respects active portfolio toggles', () => {
    const filtered = applyPortfolioImportToggles(client, {
      residential: false,
      industrial: false,
      shares: false,
      cash: false,
      liabilities: false,
      businessFinancials: false,
      income: false,
    });
    const summary = summarizeClientPortfolio(filtered);
    expect(filtered.residentialAssets).toHaveLength(0);
    expect(filtered.industrialAssets).toHaveLength(0);
    expect(summary.shareLiquidInvestmentValue).toBe(0);
    expect(summary.cashOffsets).toBe(0);
    expect(summary.businessDebt).toBe(0);
    expect(summary.annualGrossIncome).toBe(0);
  });

  it('client-profile scenario mode uses toggled portfolio data in current position', () => {
    const withAll = summarizeClientPortfolio(applyPortfolioImportToggles(client, { residential: true, commercial: true, industrial: true }));
    const commercialOnly = summarizeClientPortfolio(applyPortfolioImportToggles(client, { residential: false, industrial: false }));
    expect(commercialOnly.totalAssetValue).toBeLessThan(withAll.totalAssetValue);
    expect(commercialOnly.residentialAssetValue).toBe(0);
    expect(commercialOnly.industrialAssetValue).toBe(0);
  });

  it('selecting an AI scenario option cascades values into calculator fields', () => {
    const changes: Record<string, string> = {};
    const changed = applyCommercialScenarioProposal({
      name: 'Recommended warehouse acquisition',
      reasoning: 'Use cash offsets as liquidity and refinance existing debt.',
      estimatedImpact: '+$250k capacity',
      executionRisk: 'medium',
      evidenceRequired: ['Loan statements'],
      adjustments: {
        scenarioType: 'Multi-Asset Strategy',
        purchasePrice: 3_250_000,
        proposedLoan: 2_050_000,
        availableEquity: 900_000,
        sponsorLiquidity: 250_000,
        businessEbitda: 520_000,
        businessDebt: 180_000,
        marketRent: 240_000,
        vacancy: 4,
        minDscr: 1.35,
      },
    }, {
      setScenarioType: (v) => { changes.scenarioType = v; },
      setPurchasePrice: (v) => { changes.purchasePrice = v; },
      setProposedLoan: (v) => { changes.proposedLoan = v; },
      setAvailableEquity: (v) => { changes.availableEquity = v; },
      setSponsorLiquidity: (v) => { changes.sponsorLiquidity = v; },
      setBusinessEbitda: (v) => { changes.businessEbitda = v; },
      setBusinessDebt: (v) => { changes.businessDebt = v; },
      setMarketRent: (v) => { changes.marketRent = v; },
      setVacancy: (v) => { changes.vacancy = v; },
      setMinDscr: (v) => { changes.minDscr = v; },
    });
    expect(changed).toEqual(expect.arrayContaining(['scenarioType', 'purchasePrice', 'proposedLoan', 'availableEquity', 'sponsorLiquidity', 'businessEbitda', 'businessDebt', 'marketRent', 'vacancy', 'minDscr']));
    expect(changes.purchasePrice).toBe('3250000');
    expect(changes.scenarioType).toBe('Multi-Asset Strategy');
  });
});
