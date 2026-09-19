/**
 * The three charts, and the specific ways each of them can lie.
 *
 * Every assertion here corresponds to something a real render did wrong before
 * it was fixed. None would have failed a "does it produce SVG" test.
 */
import { describe, expect, it } from 'vitest';

import { buildClientDetails } from '../normalise.pure';
import {
  expenseCompositionChart as rawExpenseCompositionChart,
  incomeAgainstCommitmentsChart as rawIncomeAgainstCommitmentsChart,
  MIN_DONUT_SEGMENTS,
  valueAgainstDebtChart as rawValueAgainstDebtChart,
} from '../charts.pure';
import { decodedChart } from '@/lib/reportDesign/__tests__/chartSvg';

// See the note in the sibling cash-flow-comparison spec.
const expenseCompositionChart = decodedChart(rawExpenseCompositionChart);
const incomeAgainstCommitmentsChart = decodedChart(rawIncomeAgainstCommitmentsChart);
const valueAgainstDebtChart = decodedChart(rawValueAgainstDebtChart);
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';
import { resolveSnapshotBrand } from '@/lib/reportDesign/documentBrand.pure';

const NOW = '2026-08-02T00:00:00.000Z';
const ID = '11111111-1111-4111-8111-111111111111';

const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', brandColour: '#B8873A', preset: 'signature' },
  capturedAt: NOW,
});
const { palette } = resolveSnapshotBrand({ snapshot });

const build = (over: Record<string, unknown> = {}) => buildClientDetails({
  client: { id: ID, primary_first_name: 'Ada', primary_surname: 'Lovelace' },
  now: NOW,
  ...over,
});

const EARNING = {
  employment: [{ contact_type: 'primary', gross_annual_salary: 180_000 }],
  expenses: [
    { expense_category: 'groceries', monthly_amount: 1_200, frequency: 'monthly' },
    { expense_category: 'utilities', monthly_amount: 400, frequency: 'monthly' },
    { expense_category: 'transport', monthly_amount: 600, frequency: 'monthly' },
    { expense_category: 'insurance', monthly_amount: 300, frequency: 'monthly' },
  ],
};

describe('income against commitments', () => {
  /** The one place in the suite where a bullet is genuinely the right shape. */
  it('draws when there is both an income and something committed', () => {
    const svg = incomeAgainstCommitmentsChart(build(EARNING), palette);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Income');
  });

  it('draws nothing with no income, and nothing with no commitments', () => {
    expect(incomeAgainstCommitmentsChart(build(), palette)).toBe('');
    expect(incomeAgainstCommitmentsChart(
      build({ employment: [{ contact_type: 'primary', gross_annual_salary: 180_000 }] }),
      palette,
    )).toBe('');
  });

  /**
   * `renderBullet` right-aligns its label and sub into a 138-unit gutter and
   * clips what does not fit. The first render put "AGAINST $54,739/MO
   * COMMITTED" half off the left edge of the page, so the figure moved to the
   * caption where there is room for it.
   */
  it('keeps its labels inside the gutter and puts the figures in the caption', () => {
    const svg = incomeAgainstCommitmentsChart(build(EARNING), palette);
    const labels = [...svg.matchAll(/<text[^>]*text-anchor="end"[^>]*>([^<]+)<\/text>/g)]
      .map((m) => m[1]);
    for (const label of labels) expect(label.length).toBeLessThanOrEqual(12);
    expect(svg).toMatch(/<figcaption>[\s\S]*\$[\d,]+[\s\S]*<\/figcaption>/);
  });
});

describe('where the money goes', () => {
  it(`draws nothing below ${MIN_DONUT_SEGMENTS} categories`, () => {
    expect(expenseCompositionChart(build({
      expenses: [
        { expense_category: 'groceries', monthly_amount: 100, frequency: 'monthly' },
        { expense_category: 'utilities', monthly_amount: 100, frequency: 'monthly' },
      ],
    }), palette)).toBe('');
  });

  /**
   * The caption once named total commitments — $54,739 — beside a ring that
   * summed only household expenses, $32,010. A sentence disagreeing with the
   * chart above it by $22,729. Caught by reading the rendered page.
   */
  it('captions the ring with the ring\'s own total', () => {
    // The liability matters to this fixture: without one, commitments and the
    // expense total coincide and the assertion cannot tell them apart. Found by
    // reverting the fix and watching the test pass anyway.
    const p = build({
      ...EARNING,
      liabilities: [{ liability_type: 'personal_loan', current_balance: 20_000, monthly_repayment: 500 }],
    });
    expect(p.position.commitmentsMonthly.value).toBe(3_000);

    const caption = /<figcaption>([\s\S]*?)<\/figcaption>/
      .exec(expenseCompositionChart(p, palette))?.[1] ?? '';
    expect(caption).toContain('$2,500');
    expect(caption).not.toContain('$3,000');
    expect(caption).toContain('4 expense categories');
  });

  /** Gathered, not dropped — so the ring still sums to what they spend. */
  it('gathers the tail rather than losing it', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      expense_category: `cat_${i}`,
      monthly_amount: 100 + i * 10,
      frequency: 'monthly',
    }));
    const svg = expenseCompositionChart(build({ expenses: many }), palette);
    expect(svg).toContain('other categories');
  });

  /**
   * `renderDonut`'s default centre is the first segment's share and its default
   * sub-label is that segment's *name* — a category, not a total.
   */
  it('states its own centre rather than taking the default', () => {
    const svg = expenseCompositionChart(build(EARNING), palette);
    expect(svg).toContain('LARGEST');
    expect(svg).toMatch(/>\d+%</);
  });
});

describe('value against what is owed', () => {
  const HOLDINGS = {
    properties: [
      { property_type: 'owner_occupied', address: 'Home, Suburbia', value: 900_000, loan_remaining: 300_000 },
      { property_type: 'investment', address: 'Unit 7, 118 Mariners Quay, Newstead', value: 600_000, loan_remaining: 580_000 },
    ],
  };

  /**
   * `renderBars` colours by `|value| / max` when no tone is given, so the
   * largest *debt* would be drawn as the strongest, greenest bar in the chart.
   */
  it('gives value and debt their own tones rather than letting size decide', () => {
    const svg = valueAgainstDebtChart(build(HOLDINGS), palette);
    expect(svg).toContain(palette.positive);
    expect(svg).toContain(palette.negative);
  });

  it('includes the home, because what is theirs is a question about everything', () => {
    const svg = valueAgainstDebtChart(build(HOLDINGS), palette);
    expect(svg).toContain('Home');
    // And it uses the same short address the portfolio matrix heads its columns
    // with, so the two pages name the same property the same way.
    expect(svg).toContain('Unit 7, 118 Mariners Quay');
  });

  it('scales every bar against one maximum, so two holdings are comparable', () => {
    const svg = valueAgainstDebtChart(build(HOLDINGS), palette);
    const widths = [...svg.matchAll(/<rect x="\d+" y="[\d.]+" width="([\d.]+)" height="12"/g)]
      .map((m) => Number(m[1]));
    // Four bars plus their four tracks. The $600k value must be visibly shorter
    // than the $900k one; per-bar scaling would draw them identically.
    expect(new Set(widths).size).toBeGreaterThan(2);
  });

  it('draws nothing when no property has a value', () => {
    expect(valueAgainstDebtChart(build(), palette)).toBe('');
    expect(valueAgainstDebtChart(build({
      properties: [{ property_type: 'investment', address: 'A', value: 0 }],
    }), palette)).toBe('');
  });
});
