import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { applyInvestmentProjection } from '../../../../../supabase/functions/_shared/reportBindingProjection.pure';

/**
 * One choice of audience, one set of figures — whichever presentation draws it.
 *
 * An owner-occupier's copy withholds every figure that describes a letting
 * (`audienceContent.pure.ts`). The chosen template learns that from the
 * projection; the standard presentation from `presentation.audience`. Two
 * implementations of one rule is how they come to disagree, so this draws the
 * standard document and reads its text back, and asserts it against the
 * PROJECTION the templates are bound to — the same method
 * `compassKpiContentParity.spec.ts` uses for the tier.
 */
vi.mock('@/hooks/useGlobalReportSettings', async (orig) => ({
  ...(await orig() as object),
  fetchGlobalReportSettings: async () => ({
    contactDetails: {
      company_name: 'Test Co', phone: '', email: '', website: '', address: '', abn: '',
    },
    disclaimer: { text: 'Test disclaimer.', font_size: 'medium', is_enabled: true },
  }),
}));

/** The Cowra certification subject's stored financial block, as the tier parity spec uses it. */
const COWRA_FINANCIALS = {
  income: { weeklyRent: 445, annualRent: 23140 },
  keyMetrics: {
    lvr: 80, annualNet: -23383, weeklyNet: -450, netRentalYield: 1.85,
    totalInvestment: 132462, cashOnCashReturn: -17.65, grossRentalYield: 4.17,
  },
  assumptions: { cpiGrowth: 3.2, capitalGrowth: 0.1, occupancyWeeks: 50 },
  loanDetails: {
    lvr: 80, loanAmount: 444000, loanType: 'interest_only', interestRate: 6.5,
    weeklyPayment: 647.63, monthlyPayment: 2806.38, interestOnlyPeriod: 2,
  },
  initialCosts: {
    lmi: 0, deposit: 111000, legalFees: 1800, stampDuty: 19162, loanAmount: 444000,
    totalUpfront: 132462, propertyValue: 555000, inspectionFees: 500,
  },
};

const CONTENT = [
  '# Investment Report: 9 Test Street, Cowra NSW 2794',
  '',
  '## Investment Overview',
  '',
  'The holding position for this property is set out below, with the acquisition',
  'and the annual return stated against the contract price.',
  '',
  '## Market Context',
  '',
  'Regional demand has been steady across the reporting period, with listing volumes',
  'and days on market both tracking close to their five-year averages.',
  '',
].join('\n');

const report = {
  id: 'audience-parity',
  address: '9 Test Street, Cowra NSW 2794',
  content: CONTENT,
  created_at: '2026-09-13T00:00:00.000Z',
  enhanced_data: { financialData: COWRA_FINANCIALS, investmentScore: {} },
};

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? input);
    if (url.startsWith('/')) {
      const file = path.resolve(process.cwd(), 'public', url.replace(/^\//, ''));
      if (!fs.existsSync(file)) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(fs.readFileSync(file)), { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

async function drawnText(
  reportTier: 'compass' | 'financial',
  audience: 'investor' | 'owner_occupier',
): Promise<string> {
  const { generateInvestmentPdfBlob } = await import('../investmentPdfDocument');
  const { blob } = await generateInvestmentPdfBlob({ report: report as any, reportTier, presentation: { audience } });
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false,
  }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out += content.items.map((it: any) => it.str ?? '').join('') + '\n';
  }
  return out.replace(/\s+/g, '');
}

function bound(tier: 'compass' | 'financial', audience: 'investor' | 'owner_occupier') {
  const ctx = applyInvestmentProjection(
    { report: {}, brand: {} } as Record<string, unknown>,
    { financial_calculations: COWRA_FINANCIALS, report_tier: tier } as never,
    { audience },
  ) as Record<string, any>;
  return (ctx.financials ?? {}) as Record<string, number | undefined>;
}

const money = (n: number) => '$' + Number(n).toLocaleString('en-AU', { maximumFractionDigits: 0 });

describe("an owner-occupier's figures, in both presentations", () => {
  it('leads the Financial Analysis with buying and borrowing, never the letting', async () => {
    const flat = await drawnText('financial', 'owner_occupier');
    const figures = bound('financial', 'owner_occupier');
    for (const key of ['weeklyRent', 'grossYield', 'netYield', 'weeklyNet', 'cashOnCash']) {
      expect(figures, key).not.toHaveProperty(key);
    }
    for (const withheld of ['WEEKLYRENT', 'GROSSYIELD', 'NETYIELD', 'WEEKLYNETCASHFLOW']) {
      expect(flat, `${withheld} describes a letting`).not.toContain(withheld);
    }
    for (const kept of ['PURCHASEPRICE', 'DEPOSIT', 'LOANAMOUNT', 'LVR', 'INTERESTRATE', 'STAMPDUTY', 'TOTALUPFRONT']) {
      expect(flat, `${kept} is a figure a home buyer pays or borrows`).toContain(kept);
    }
    expect(flat).toContain(money(figures.purchasePrice!).replace(/\s+/g, ''));
    expect(flat).toContain(money(figures.loanAmount!).replace(/\s+/g, ''));
  }, 180_000);

  it("keeps the price on an owner-occupier's Compass, as the template does", async () => {
    const flat = await drawnText('compass', 'owner_occupier');
    const figures = bound('compass', 'owner_occupier');
    expect(figures).not.toHaveProperty('weeklyRent');
    expect(flat).toContain('PURCHASEPRICE');
    expect(flat).toContain(money(figures.purchasePrice!).replace(/\s+/g, ''));
    expect(flat).not.toContain('WEEKLYRENT');
  }, 180_000);

  it("draws the investor's band exactly as before", async () => {
    const flat = await drawnText('compass', 'investor');
    expect(flat).toContain('PURCHASEPRICE');
    expect(flat).toContain('WEEKLYRENT');
    expect(bound('compass', 'investor')).toHaveProperty('weeklyRent', 445);
  }, 180_000);
});
