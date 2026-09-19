import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A genuine zero is a finding. An absence is not a zero, and it is not a word.
 *
 * These are two opposite failures and this file exists because the product has
 * shipped both. `if (value)` collapses a measured `0` into "missing", so a
 * **breakeven** weekly cash flow, a **cash purchase** carrying no loan and a
 * rate held at **0%** all disappeared from the client's band as though the
 * record did not know them. And in the other direction, a record that knows
 * nothing must not be given a placeholder: 84 of 1,072 stored reports print a
 * `0.00%` yield because the rent was never established, and the certification
 * record printed `Assessment grade  N/A · out of 100` on every selectable
 * template.
 *
 * The rule these tests pin:
 *
 * | the record holds | the client sees |
 * | --- | --- |
 * | an authoritative `0` | `$0` / `0.0%` — it is the answer |
 * | nothing | no tile at all — not `N/A`, not a dash, not a fabricated `$0` |
 *
 * The decision comes from `presenceOf` (the platform's three-state authority)
 * and, for anything resting on rent, from `rentIsEstablished`. Nothing here
 * calculates a replacement so that a card can stay visible.
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

const CONTENT = [
  '# Investment Report: 9 Test Street, Cowra NSW 2794',
  '',
  '## Investment Overview',
  '',
  'The holding position for this property is set out below, with the acquisition',
  'and the annual return stated against the contract price.',
  '',
].join('\n');

const reportWith = (financialData: unknown) => ({
  id: 'zero-vs-missing',
  address: '9 Test Street, Cowra NSW 2794',
  content: CONTENT,
  created_at: '2026-09-14T00:00:00.000Z',
  enhanced_data: { financialData, investmentScore: {} },
});

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

/**
 * Two readings of one document.
 *
 * `flat` has its whitespace removed, which is how a label and its figure are
 * asserted without depending on where pdfjs split the text run. `spaced` keeps
 * the spaces, because word boundaries are the whole mechanism of the
 * placeholder scan below.
 */
async function drawn(
  financialData: unknown,
  /*
   * The tier the document is drawn at.
   *
   * Every assertion in this file is about the difference between an
   * AUTHORITATIVE ZERO and a MISSING VALUE, which is a question about the
   * record. `tierContent.pure.ts` answers a separate question — what a tier's
   * document may publish at all — and since seed v14 a Compass publishes no
   * deposit, loan, duty, LVR or yield, because that modelling is the Financial
   * Analysis Report. Drawing these fixtures as a Compass would test the tier
   * rule and say nothing about zero-versus-missing, so they are drawn at the
   * tier that carries the modelling. `compassKpiContentParity.spec.ts` asserts
   * the tier half.
   */
  reportTier: 'compass' | 'financial' = 'financial',
): Promise<{ flat: string; spaced: string }> {
  const { generateInvestmentPdfBlob } = await import('../investmentPdfDocument');
  const { blob } = await generateInvestmentPdfBlob({
    report: reportWith(financialData) as any, reportTier,
  });
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false,
  }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    out += c.items.map((it: any) => it.str ?? '').join(' ') + '\n';
  }
  return { flat: out.replace(/\s+/g, ''), spaced: out };
}

/** Every placeholder a client document may never contain. */
const FORBIDDEN = [
  'N/A', 'NA', 'Unavailable', 'Not available', 'Unknown', 'null', 'undefined',
  'NaN', 'TBD', 'TBC', 'Not provided', 'Data unavailable', 'No data',
];

/**
 * Whole-token, never substring — and the reason is in this file's own history.
 *
 * The first version of this helper scanned the whitespace-stripped text for
 * `'NA'` and failed every case, because the letterhead reads **NAIDU PROPERTY
 * CONSULTING SERVICES**. That is exactly the failure mode the mandate names:
 * a sentinel rule must not destroy legitimate words that merely share letters.
 * So the scan is anchored on word boundaries and run over the SPACED text.
 */
function assertNoPlaceholder(spaced: string, where: string) {
  for (const token of FORBIDDEN) {
    const pattern = new RegExp(
      `(^|[\\s>(\\[,:;|])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s<)\\],:;|.])`,
      token === 'NaN' ? '' : 'i',
    );
    expect(pattern.test(spaced), `${where} must not render the placeholder "${token}"`)
      .toBe(false);
  }
}

describe('an authoritative zero is preserved; a missing value is omitted', () => {
  /**
   * §11 — Weekly Net Cash Flow. `$0` is a breakeven investment outcome and one
   * of the most consequential things the band can say.
   */
  it('renders a breakeven weekly cash flow as $0, and omits it when absent', async () => {
    const breakeven = await drawn({
      income: { weeklyRent: 445 },
      keyMetrics: { weeklyNet: 0, lvr: 80, grossRentalYield: 4.17 },
      initialCosts: { propertyValue: 555000, deposit: 111000 },
    });
    expect(breakeven.flat).toContain('WEEKLYNETCASHFLOW');
    expect(breakeven.flat, 'a measured breakeven must print as $0').toContain('$0');
    assertNoPlaceholder(breakeven.spaced, 'the breakeven document');

    const absent = await drawn({
      income: { weeklyRent: 445 },
      keyMetrics: { lvr: 80, grossRentalYield: 4.17 },
      initialCosts: { propertyValue: 555000, deposit: 111000 },
    });
    expect(absent.flat, 'an absent cash flow takes its whole tile with it')
      .not.toContain('WEEKLYNETCASHFLOW');
    assertNoPlaceholder(absent.spaced, 'the absent-cash-flow document');
  }, 180_000);

  /** §11 — Capital Growth. A stated 0% forecast is a position, not a gap. */
  it('renders a 0% capital growth assumption, and omits it when absent', async () => {
    const zero = await drawn({
      income: { weeklyRent: 445 },
      keyMetrics: { lvr: 80, grossRentalYield: 4.17 },
      initialCosts: { propertyValue: 555000, deposit: 111000 },
      assumptions: { capitalGrowth: 0 },
    });
    expect(zero.flat).toContain('CAPITALGROWTH');
    expect(zero.flat).toContain('0.0%');
    assertNoPlaceholder(zero.spaced, 'the zero-growth document');

    const absent = await drawn({
      income: { weeklyRent: 445 },
      keyMetrics: { lvr: 80, grossRentalYield: 4.17 },
      initialCosts: { propertyValue: 555000, deposit: 111000 },
      assumptions: {},
    });
    expect(absent.flat).not.toContain('CAPITALGROWTH');
  }, 180_000);

  /**
   * §11 — the yields, which are the reason this rule exists.
   *
   * A computed `0.00%` on an established rent is a finding. A stored `0` with
   * NO rent established is the `0.00%` defect, and must produce no tile at all
   * rather than a zero or a placeholder.
   */
  it('renders a 0.00% yield on an established rent, and omits it when no rent is established', async () => {
    const founded = await drawn({
      income: { weeklyRent: 445, annualRent: 23140 },
      keyMetrics: { grossRentalYield: 0, netRentalYield: 0, lvr: 80 },
      initialCosts: { propertyValue: 555000, deposit: 111000 },
    });
    expect(founded.flat).toContain('GROSSYIELD');
    expect(founded.flat).toContain('0.00%');
    assertNoPlaceholder(founded.spaced, 'the zero-yield document');

    const unfounded = await drawn({
      income: {},
      keyMetrics: { grossRentalYield: 0, netRentalYield: 0, lvr: 80 },
      initialCosts: { propertyValue: 555000, deposit: 111000 },
    });
    expect(unfounded.flat, 'an unfounded yield draws no tile').not.toContain('GROSSYIELD');
    expect(unfounded.flat).not.toContain('NETYIELD');
    expect(unfounded.flat, 'and never the stored zero').not.toContain('0.00%');
    assertNoPlaceholder(unfounded.spaced, 'the unfounded-yield document');
  }, 180_000);

  /**
   * §11 — LVR and the loan. An unleveraged acquisition is a fact about the
   * transaction; calling it "missing" would describe a cash purchase as an
   * unknown one.
   */
  it('preserves a 0% LVR and a $0 loan as the cash purchase they describe', async () => {
    const cash = await drawn({
      income: { weeklyRent: 445 },
      keyMetrics: { lvr: 0, grossRentalYield: 4.17 },
      initialCosts: { propertyValue: 555000, deposit: 555000, loanAmount: 0 },
      loanDetails: { loanAmount: 0, interestRate: 0 },
    });
    expect(cash.flat).toContain('LVR');
    expect(cash.flat).toContain('0.0%');
    expect(cash.flat).toContain('LOANAMOUNT');
    expect(cash.flat).toContain('INTERESTRATE');
    expect(cash.flat).toContain('0.00%');
    assertNoPlaceholder(cash.spaced, 'the cash-purchase document');

    const noFinancing = await drawn({
      income: { weeklyRent: 445 },
      keyMetrics: { grossRentalYield: 4.17 },
      initialCosts: { propertyValue: 555000, deposit: 555000 },
    });
    expect(noFinancing.flat, 'an absent LVR is omitted').not.toContain('LVR');
    expect(noFinancing.flat).not.toContain('LOANAMOUNT');
  }, 180_000);

  /**
   * §11 — the layout reflows around what exists.
   *
   * A record holding two facts draws two tiles, not a twelve-position grid
   * with ten holes in it. The band is drawn four to a row, so the assertion
   * that matters is that no label is drawn without its figure.
   */
  it('reflows around the values that exist, drawing no empty or placeholder tile', async () => {
    const sparse = await drawn({
      initialCosts: { propertyValue: 555000, deposit: 111000 },
      income: {},
      keyMetrics: {},
    });
    expect(sparse.flat).toContain('PURCHASEPRICE');
    expect(sparse.flat).toContain('DEPOSIT');
    for (const absent of [
      'WEEKLYRENT', 'GROSSYIELD', 'NETYIELD', 'LVR', 'LOANAMOUNT',
      'INTERESTRATE', 'WEEKLYNETCASHFLOW', 'TOTALUPFRONT', 'CAPITALGROWTH',
    ]) {
      expect(sparse.flat, `${absent} has no authoritative value and must draw nothing`)
        .not.toContain(absent);
    }
    assertNoPlaceholder(sparse.spaced, 'the sparse document');
  }, 180_000);

  /**
   * §5 — stamp duty is the one tile where a zero needs a second question, and
   * the answer comes from the canonical engine's own schedule stamp rather
   * than from a recalculation here.
   */
  it('keeps a $0 duty the canonical engine calculated, and drops an uncalculated zero', async () => {
    const calculated = await drawn({
      income: { weeklyRent: 445 },
      keyMetrics: { grossRentalYield: 4.17 },
      initialCosts: {
        propertyValue: 555000, deposit: 111000,
        stampDuty: 0, stampDutyScheduleYear: '2026-27', stampDutyScheduleSource: 'cache',
      },
    });
    expect(calculated.flat).toContain('STAMPDUTY');
    assertNoPlaceholder(calculated.spaced, 'the zero-duty document');

    const uncalculated = await drawn({
      income: { weeklyRent: 445 },
      keyMetrics: { grossRentalYield: 4.17 },
      initialCosts: { propertyValue: 555000, deposit: 111000, stampDuty: 0 },
    });
    expect(uncalculated.flat, 'a zero with no schedule stamp is not an established liability')
      .not.toContain('STAMPDUTY');
  }, 180_000);
});
