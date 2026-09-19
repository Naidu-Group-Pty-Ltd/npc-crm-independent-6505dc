/**
 * The Borrowing Capacity family catalogue — the second report format drawn in
 * the ten Investment Compass designs.
 *
 * The interesting assertions here are not "it parses". They are:
 *
 *  1. the masters are genuinely production-ready, not preview-only;
 *  2. every figure they bind is one the projection actually publishes;
 *  3. the sample data's totals reconcile against their own components.
 *
 * (3) earns its place. The income page prints the component lines and the total
 * on one table, so a sample whose total does not equal its parts renders a
 * visibly wrong financial document in every preview, screenshot and PDF. The
 * first draft did exactly that — four lines summing to $280,000 under a
 * $245,000 total — and the render showed it immediately.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { parseTemplate } from '@/lib/reportTemplate/templateSchema';
import { BORROWING_CAPACITY_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/borrowingCapacity';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { deriveEntryFacts } from '../../../../supabase/functions/_shared/templateLibraryCore.pure';
import { applyBorrowingCapacityProjection } from '../../../../supabase/functions/_shared/borrowingCapacityProjection.pure';
import { colourwaysForFamily, colourwayTokenOverride } from '../colourways';
import { SAMPLE_REPORT_DATA as SAMPLE } from '../sampleReportData';

const sum = (rows: any[], key: string) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

function resolves(data: Record<string, any>, path: string): boolean {
  let cur: any = data;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || !(key in cur)) return false;
    cur = cur[key];
  }
  return cur !== undefined && cur !== null && cur !== '';
}

describe('the catalogue', () => {
  it('ships fifty masters across the same ten families', () => {
    expect(BORROWING_CAPACITY_TEMPLATES).toHaveLength(50);
    expect(new Set(BORROWING_CAPACITY_TEMPLATES.map((t) => t.designMeta.familyKey)).size).toBe(10);
  });

  it('is production-ready, because the format has a real adapter', () => {
    // The whole point of building `borrowingCapacityAdapter` before this
    // catalogue. Preview-only masters would look finished and never render a
    // client's assessment.
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      expect(t.reportType, t.name).toBe('borrowing_capacity');
      expect(deriveEntryFacts({ report_type: t.reportType, schema: t.schema }).production_ready, t.name)
        .toBe(true);
    }
  });

  it('does not collide with the Investment Compass masters', () => {
    // Both catalogues use the same variant codes — `pb-01` exists in each — so
    // the slug has to carry the format. It is the primary key of a library row.
    const bc = BORROWING_CAPACITY_TEMPLATES.map((t) => t.slug);
    const ic = INVESTMENT_COMPASS_TEMPLATES.map((t) => t.slug);
    expect(new Set(bc).size).toBe(50);
    expect(bc.filter((s) => ic.includes(s))).toEqual([]);
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      expect(t.designMeta.reportFormat).toBe('borrowing-capacity');
    }
  });

  it('parses against the live schema contract', () => {
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      expect(() => parseTemplate(t.schema), t.name).not.toThrow();
    }
  });

  it('carries the cascade pages, every one conditional', () => {
    /*
     * `explanation` and `audit_trail` are columns null on every stored row —
     * the calculator's keep-update post-dates them all — and scenario presets
     * never reach a column. The legacy document's method, audit and scenario
     * sections are therefore present as **conditional** pages: they render
     * nothing today and light up per row as the data arrives, with no second
     * migration of fifty masters. An unconditional one would print its
     * furniture over empty bindings on every current assessment.
     */
    const CASCADE = [
      'How this was calculated',
      'How this was calculated, continued',
      'The audit trail',
      'Scenarios',
    ];
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      const pages = t.schema.pages as any[];
      for (const name of CASCADE) {
        const page = pages.find((p) => p.name === name);
        expect(page, `${t.name} lacks the "${name}" page`).toBeTruthy();
        expect(String((page as any).conditional ?? ''), `${t.name} "${name}" is unconditional`)
          .not.toBe('');
      }
    }
  });

  it('draws every variable-depth table under mutually exclusive depths', () => {
    /*
     * A table prints every declared row whether or not its bindings resolve,
     * so one depth rules off empty rows beneath the median report or drops
     * the deep report's tail. Each depth carries a conditional on the row
     * count, and exactly one may hold for any count the projection can
     * publish — two holding would print tables over each other, none holding
     * would drop the section.
     */
    const counts: Record<string, number[]> = {
      income: [0, 1, 2, 3, 4, 5, 6, 7],
      liabilities: [0, 1, 2, 3, 4, 5, 6],
      assumptions: [0, 1, 5, 7, 8, 11, 12, 17, 18],
      audit: [0, 1, 7, 8, 14],
      explanation: [6, 8, 9, 10],
    };
    const guards: Record<string, RegExp> = {
      income: /income\.rows\.length/, liabilities: /liabilities\.rows\.length/,
      assumptions: /assumptions\.rows\.length/, audit: /audit\.rows\.length/,
      explanation: /explanation\.steps\.length/,
    };
    for (const t of BORROWING_CAPACITY_TEMPLATES.slice(0, 5)) {
      const blocks = (t.schema.pages as any[]).flatMap((p) => (p.blocks ?? []) as any[]);
      for (const [ns, lens] of Object.entries(counts)) {
        const variants = blocks
          .map((b) => String(b.conditional ?? ''))
          .filter((cond) => guards[ns].test(cond));
        expect(variants.length, `${t.name}: no depth variants guard ${ns}`).toBeGreaterThan(1);
        for (const n of lens) {
          const key = ns === 'explanation' ? 'steps' : 'rows';
          // The projection never publishes an empty collection — `put` and the
          // length gates keep the namespace absent — so zero rows is modelled
          // as the namespace not existing, which is what a renderer sees.
          const value = n === 0 ? undefined : { [key]: Array.from({ length: n }) };
          const holding = variants.filter((cond) => {
            // The guard's own grammar: names bound, `.length` compared.
            const fn = new Function(ns, `return (${cond});`);
            return Boolean(fn(value));
          });
          expect(holding.length, `${t.name}: ${ns} with ${n} rows matches ${holding.length} depths`)
            .toBe(n === 0 ? 0 : 1);
        }
      }
    }
  });
});

describe('every bound figure has a source', () => {
  /**
   * What the projection publishes for a fully-populated assessment — the whole
   * apply, snapshot section included, over a row carrying the `explanation`
   * and `audit_trail` columns shaped as the calculator writes them.
   */
  const projected = applyBorrowingCapacityProjection({}, {
    gross_annual_income: 280000, shaded_annual_income: 263320,
    income_breakdown: [{ component: 'x', grossAmount: 1, shadedAmount: 1, shadingRate: 1 }],
    living_expenses_monthly: 6420, expense_method: 'hem',
    expense_breakdown: { declaredExpenses: 5900, hemBenchmark: 6420 },
    existing_commitments_monthly: 1840,
    liability_breakdown: [{ type: 'x', balance: 1, limit: 1, monthlyServicing: 1 }],
    interest_rate_used: 6.14, buffer_rate: 3, assessment_rate: 9.14, loan_term_years: 30,
    proposed_loan_amount: 1032000, proposed_lvr: 80, borrowing_capacity: 1180000,
    monthly_surplus: 1290, serviceability_band: 'amber', stress_tested_capacity: 1042000,
    dti_ratio: 5.95, recommendations: ['a', 'b', 'c'], warnings: ['w'],
    assumptions: { items: [{ key: 'Buffer Rate', value: '3%' }], selectedLenderName: 'Example Bank' },
    lmi_mode: 'display_deduction', lmi_amount: 21400, lmi_lvr_trigger: 80,
    explanation: {
      headline: 'x', executiveSummary: 'x', generatedAt: 'x',
      steps: [{ step: 1, title: 'x', narrative: 'x', figures: [], icon: 'income' }],
    },
    audit_trail: {
      generatedAt: 'x', summary: {},
      entries: [{
        seq: 1, category: 'income', action: 'shading_applied', label: 'x',
        rawValue: 1, assessedValue: 1, rule: 'x', delta: 0, impact: 'neutral',
      }],
    },
    updated_at: '2026-08-12T00:00:00.000Z',
  });

  it('binds only namespaces the projection publishes', () => {
    const published = new Set([
      ...Object.keys(projected), 'client', 'org', 'report',
      // Bound but never published from a row, deliberately: scenario presets
      // only ever travel in a render request, so no column exists for the
      // projection to read. The page is conditional and stays dark on every
      // assessment until one does — the cascade contract, not a defect.
      'scenarios',
    ]);
    const bound = new Set<string>();
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      for (const m of JSON.stringify(t.schema).matchAll(/\{\{\s*([a-zA-Z0-9_]+)\./g)) bound.add(m[1]);
    }
    // A namespace bound but never published renders empty on every real
    // assessment — the exact defect the Investment Compass masters shipped with.
    expect([...bound].filter((ns) => !published.has(ns))).toEqual([]);
  });

  it('publishes the snapshot namespaces that fixture exercises', () => {
    // Guards the fixture above: if the gate or the pass-through broke, the
    // namespace test would silently weaken rather than fail.
    for (const nsName of ['summary', 'utilisation', 'ledger', 'explanation', 'audit']) {
      expect(Object.keys(projected), nsName).toContain(nsName);
    }
  });
});

describe('the sample data is arithmetically honest', () => {
  const income = SAMPLE.income as any;
  const liabilities = SAMPLE.liabilities as any;
  const expenses = SAMPLE.expenses as any;
  const capacity = SAMPLE.capacity as any;
  const loan = SAMPLE.loan as any;

  it('totals the income table it prints', () => {
    expect(sum(income.items, 'grossAmount')).toBe(income.gross);
    expect(sum(income.items, 'shadedAmount')).toBe(income.shaded);
    expect(income.gross - income.shaded).toBe(income.shadingApplied);
  });

  it('totals the liabilities table it prints', () => {
    expect(sum(liabilities.items, 'monthlyServicing')).toBe(liabilities.monthly);
  });

  it('annualises consistently', () => {
    expect(expenses.monthly * 12).toBe(expenses.annual);
    expect(liabilities.monthly * 12).toBe(liabilities.annual);
    expect(capacity.monthlySurplus * 12).toBe(capacity.annualSurplus);
  });

  it('keeps the lending arithmetic self-consistent', () => {
    expect(loan.interestRate + loan.bufferRate).toBeCloseTo(loan.assessmentRate, 9);
    expect(capacity.propertyValueEstimate - loan.proposed).toBe(capacity.depositAmount);
    // A stress test that exceeded the headline capacity would be nonsense.
    expect(capacity.stressTested).toBeLessThan(capacity.borrowing);
  });
});

describe('rendering', () => {
  it('renders every master with real figures on the page', () => {
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
      expect(html, t.name).toContain('$1,180,000');
      expect(html, t.name).not.toContain('{{');
    }
  });

  // Five hundred renders (fifty masters, ten colourways each) — a catalogue,
  // not a unit. Measured 14 Sep 2026 on the merged main head: 5.2–5.8 s on a
  // loaded container against the 5 s default, so the budget is stated here
  // rather than left to the machine.
  it('changes the colour and never the layout', () => {
    const geometry = (html: string) => (html.match(/left:[\d.]+pt;top:[\d.]+pt/g) ?? []).join('|');
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      const base = geometry(renderTemplateToHtml(t.schema as any, { data: SAMPLE }).html);
      for (const cw of colourwaysForFamily(t.designMeta.familyKey)) {
        const other = geometry(renderTemplateToHtml(t.schema as any, {
          data: SAMPLE, tokenOverrides: colourwayTokenOverride(cw),
        }).html);
        expect(other, `${t.name} / ${cw.name}`).toBe(base);
      }
    }
  }, 60_000);

  it('renders the snapshot pages the sample carries, one table depth each', () => {
    const t = BORROWING_CAPACITY_TEMPLATES[0];
    const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
    // The narrative, the ledger and the utilisation verdict all reach the page.
    expect(html).toContain('maximum borrowing capacity of $1,180,000');
    expect(html).toContain('$280,000 pa');
    expect(html).toContain('The proposed loan sits inside the assessed capacity.');
    // Exactly one depth of each variable table renders — the sample's four
    // income rows and three liabilities pick one variant apiece, and a second
    // total row would mean two depths printed over each other.
    expect((html.match(/Total assessable/g) ?? []).length).toBe(1);
    expect((html.match(/Total servicing/g) ?? []).length).toBe(1);
    // The cascade pages stay dark: their columns are null on every stored row
    // and the sample says so too.
    expect(html).not.toContain('How the engine reached this figure');
    expect(html).not.toContain('What the engine adjusted');
    expect(html).not.toContain('Scenarios modelled beside this assessment');
  });

  it('drops the LMI block when LMI does not apply', () => {
    // 140 of 143 assessments have lmi_mode 'none'. The sample carries `lmi: {}`
    // so this is the path a reviewer sees.
    const t = BORROWING_CAPACITY_TEMPLATES[0];
    const { html } = renderTemplateToHtml(t.schema as any, { data: SAMPLE });
    expect(html).not.toContain('Lenders mortgage insurance');
    const withLmi = renderTemplateToHtml(t.schema as any, {
      data: { ...SAMPLE, lmi: { amount: 21400, lvrTrigger: 80, mode: 'display_deduction' } },
    }).html;
    expect(withLmi).toContain('Lenders mortgage insurance');
  });
});

describe('the cover names the applicants', () => {
  it('binds the client on all fifty covers', () => {
    // The fix has to reach every master, not the reference variant: a family
    // contributes five, and an operator picks whichever one they like.
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      const cover = JSON.stringify((t.schema.pages as any[])[0]);
      expect(cover, `${t.slug} cover does not bind the client`).toContain('{{client.name}}');
    }
    expect(BORROWING_CAPACITY_TEMPLATES).toHaveLength(50);
  });

  it('binds it as a whole slot, with no literal stranded beside it', () => {
    /*
     * `{{client.name}}` stands alone in the eyebrow rather than sitting after
     * "Prepared for". An unresolved binding renders as the empty string, so a
     * preposition beside it prints with nothing after it — the defect this
     * catalogue already carries in its risk register and contents page.
     */
    for (const t of BORROWING_CAPACITY_TEMPLATES) {
      for (const block of (t.schema.pages as any[])[0].blocks as any[]) {
        const eyebrow = String(block.props?.eyebrow ?? '');
        if (!eyebrow.includes('{{client.name}}')) continue;
        expect(eyebrow.trim(), `${t.slug} strands a literal beside the client name`)
          .toBe('{{client.name}}');
      }
    }
  });

  it('shows the name on the rendered cover, and nothing when there is none', () => {
    const t: any = BORROWING_CAPACITY_TEMPLATES[0];

    const named = renderTemplateToHtml(t.schema, {
      data: { ...SAMPLE, client: { name: 'Jane Smith & John Smith' } },
    }).html;
    expect(named).toContain('Jane Smith &amp; John Smith');

    const { client, ...noClient } = { ...SAMPLE, client: undefined } as any;
    const bare = renderTemplateToHtml(t.schema, { data: noClient }).html;
    expect(bare).not.toContain('Jane Smith');
    // The conclusion still carries the cover.
    expect(bare).toContain('tpl-page');
  });
});
