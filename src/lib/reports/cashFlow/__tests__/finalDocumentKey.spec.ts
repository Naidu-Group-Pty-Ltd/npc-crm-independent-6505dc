import { describe, expect, it } from 'vitest';
import { cashFlowFinalKey } from '../finalDocumentKey';
import type { WireProjection, WireProjectionYear } from '../requestCashFlowPdf';

const year = (n: number, over: Partial<WireProjectionYear> = {}): WireProjectionYear => ({
  year: n, calendarYear: 2026 + n, propertyValue: 700_000 + n * 35_000, loanBalance: 560_000 - n * 9_000,
  rentalIncome: 33_800 + n * 1_000, grossYield: 4.83, netYield: 3.4, expenses: 9_800, interestRate: 6.1,
  interest: 34_000, principal: 9_000, preTaxAnnual: -10_000, afterTaxAnnual: -6_500, depreciation: 8_000,
  taxRefund: 3_500, taxEffect: 3_500, landTax: 0, capitalGrowth: 5, cpiGrowth: 3, ...over,
});

const wire = (over: Partial<WireProjection> = {}): WireProjection => ({
  acquisition: {
    purchasePrice: 700_000, marketValue: 700_000, deposit: 140_000, loanAmount: 560_000,
    loanTermYears: 30, interestRate: 6.1, loanType: 'Principal & Interest', weeklyRent: 650,
    costs: [{ label: 'Stamp duty', amount: 27_000 }],
  },
  years: [year(1), year(2)],
  assumptions: [{ label: 'Capital growth', value: '5% p.a.' }],
  notes: [],
  ...over,
});

describe('the key a finalised Cash Flow document is filed under', () => {
  it('is the same for the same series, scenario and template', () => {
    const a = cashFlowFinalKey({ wire: wire(), scenario: 'moderate', selectedTemplateId: 'tpl-1' });
    const b = cashFlowFinalKey({ wire: wire(), scenario: 'moderate', selectedTemplateId: 'tpl-1' });
    expect(a).toBe(b);
    expect(a).toMatch(/^cashflow:[0-9a-f]{8}:\d+$/);
  });

  it('does not depend on the order a year was assembled in', () => {
    const reordered = wire();
    // Rebuild year 1 with its keys in a different insertion order.
    const y = reordered.years[0];
    reordered.years[0] = Object.fromEntries(Object.entries(y).reverse()) as WireProjectionYear;
    expect(cashFlowFinalKey({ wire: reordered, scenario: null, selectedTemplateId: null }))
      .toBe(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: null }));
  });

  it('changes when one cell of one year moves — an override is a different document', () => {
    const moved = wire({ years: [year(1), year(2, { rentalIncome: 34_801 })] });
    expect(cashFlowFinalKey({ wire: moved, scenario: null, selectedTemplateId: null }))
      .not.toBe(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: null }));
  });

  it('changes with the scenario label the series proves', () => {
    expect(cashFlowFinalKey({ wire: wire(), scenario: 'moderate', selectedTemplateId: null }))
      .not.toBe(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: null }));
  });

  it('changes with the template choice, so a re-chosen template is produced afresh', () => {
    expect(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: 'tpl-1' }))
      .not.toBe(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: 'tpl-2' }));
  });

  it('changes with the design a held report is drawn in', () => {
    expect(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: null, designTemplateId: 'tpl-1' }))
      .not.toBe(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: null, designTemplateId: null }));
  });

  it('tells a template\'s pages from the same template worn as a design — two documents', () => {
    expect(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: 'tpl-1', designTemplateId: null }))
      .not.toBe(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: null, designTemplateId: 'tpl-1' }));
  });

  it('treats "no design" the same however it is spelled', () => {
    expect(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: null }))
      .toBe(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: null, designTemplateId: null }));
  });

  it('treats "no template" the same however it is spelled', () => {
    expect(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: undefined }))
      .toBe(cashFlowFinalKey({ wire: wire(), scenario: null, selectedTemplateId: null }));
  });
});
