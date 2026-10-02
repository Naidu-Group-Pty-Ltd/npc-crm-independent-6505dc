/**
 * The Snapshot on the two shapes two production documents had (§16).
 *
 * Both were reviewed page by page on 28 Sep 2026. One client had no income
 * recorded, and the document presented $0, "DTI 0.0x", a red "Limited" and
 * advice to pay down debts she did not have. The other was limited by the
 * DTI, with a healthy surplus, and the document:
 *  - printed a working that did not reach its own surplus;
 *  - printed a 10.7x ratio beside a single $455,000 liability;
 *  - printed seventeen engine assumption strings;
 *  - cut an address to "…Gunnedah, 2...";
 *  - ran to eight pages, one holding only a liabilities total and one only a
 *    "Worth knowing" callout.
 *
 * `fixtures/productionShapes.ts` carries those shapes with invented figures.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import { mastheadFor, resolveCompanyBlock } from '@/lib/reportDesign/companyBlock.pure';
import { formatMeasure } from '@/lib/reportDesign/measure.pure';

import { buildSnapshot, incomeLabel } from '../normalise.pure';
import { curateBasis, tidyMoney } from '../basis.pure';
import { renderSnapshotBody } from '../render.pure';
import { titleCase } from '../normalise.pure';
import { SAMPLE_ASSESSMENT, SAMPLE_GLOBAL_SETTINGS, SAMPLE_SCENARIO_PRESETS } from './fixtures/sampleAssessment';
import {
  DTI_LIMITED_ASSESSMENT,
  DTI_LIMITED_ENGINE_AUDIT_TRAIL,
  DTI_LIMITED_ENGINE_EXPLANATION,
  ENGINE_PROPERTY_LABEL,
  NO_INCOME_ASSESSMENT,
} from './fixtures/productionShapes';
import { MEMO_CHAPTER_CLASS, SECTION_SUBHEAD_CLASS } from '@/lib/reportDesign/primitives.pure';

const contact = SAMPLE_GLOBAL_SETTINGS.contactDetails as never;
const html = (payload: ReturnType<typeof buildSnapshot>) => renderSnapshotBody({
  payload,
  palette: resolveReportPalette({ preset: 'signature' }),
  company: resolveCompanyBlock(contact, SAMPLE_GLOBAL_SETTINGS.disclaimer as never),
  masthead: mastheadFor(contact),
});
/** Visible text, tags stripped, entities that matter decoded. */
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const dti = buildSnapshot({ clientName: 'Sam Example', assessment: DTI_LIMITED_ASSESSMENT });
const none = buildSnapshot({ clientName: 'Dana Example', assessment: NO_INCOME_ASSESSMENT });

describe('the working adds up', () => {
  it('reaches the stored surplus line by line', () => {
    const rows = dti.ledger;
    const at = (label: string) => rows.find((r) => r.label === label)!;
    // Every line from after-tax income to the surplus is a subtraction.
    const afterTax = at('After-tax income').amount.value;
    const deductions = rows
      .slice(rows.indexOf(at('After-tax income')) + 1, rows.indexOf(at('Monthly surplus')))
      .reduce((sum, r) => sum + r.amount.value, 0);
    expect(afterTax + deductions).toBe(at('Monthly surplus').amount.value);
    // …and income less tax is the after-tax figure.
    expect(at('Assessed income, a month').amount.value + at('Less income tax and Medicare levy').amount.value)
      .toBe(afterTax);
  });

  it('names the difference the engine adds to expenses', () => {
    const line = dti.ledger.find((r) => r.label === 'Less property costs not covered by rent')!;
    expect(formatMeasure(line.amount)).toBe('-$1,150/mo');
  });

  it('states the capacity as the loan the surplus repays, with the rate and term in its label', () => {
    const last = dti.ledger[dti.ledger.length - 1];
    expect(last.label).toBe('Maximum borrowing capacity (the surplus, repaid at 9.50% over 30 years)');
    expect(formatMeasure(last.amount)).toBe('$441,146');
    expect(dti.ledger.some((r) => /Assessment Rate Applied|^Loan Term$/.test(r.label))).toBe(false);
  });

  it('never colours by sign a line that is not adverse', () => {
    for (const r of dti.ledger) {
      if (r.direction === 'adverse') expect(r.amount.value).toBeLessThan(0);
    }
  });
});

describe('the rating, explained', () => {
  it('says the ratio is what limited it, beside a positive surplus', () => {
    expect(dti.narrative).toContain('limited because the debt-to-income ratio is 9.3x; the surplus itself is positive');
    expect(dti.narrative).toContain('$441,146: the loan a monthly surplus of $3,709 repays at an assessment rate of 9.50% over 30 years');
  });

  it('shows the ratio’s working, including the debt the liabilities table does not list', () => {
    expect(dti.debtToIncome?.includesPropertyLoans).toBe(true);
    const body = text(html(dti));
    expect(body).toContain('9.3x is every debt the assessment counted, divided by $158,640 of annual income');
    expect(body).toContain('about $1,030,000 already owed, including the loans on properties held');
  });

  it('puts the stress rate beside the stress-tested figure', () => {
    expect(text(html(dti))).toContain('At 10.50%: $405,510');
  });
});

describe('no income recorded', () => {
  const body = text(html(none));

  it('says what is missing instead of presenting an assessment', () => {
    expect(none.income.recorded).toBe(false);
    expect(none.narrative).toContain('No income is recorded for Dana Example');
    expect(body).toContain('No income recorded');
  });

  it('draws no serviceability band that nothing was assessed to reach (§21)', () => {
    // The basis still names the serviceability rule it applied; what goes is
    // the band, which is a judgement nothing was assessed to reach.
    expect(html(none)).not.toMatch(/>\s*Serviceability\s*<\/[^>]+>\s*<[^>]+>\s*Limited/);
    expect(body).not.toMatch(/\bLimited\b/);
    expect(text(html(dti))).toMatch(/Serviceability\s+Limited/);
  });

  it('says what to do about it once, in the advice', () => {
    expect(body.match(/recalculate/g)).toHaveLength(1);
  });

  it('prints no ratio over zero income and no stress test of nothing', () => {
    expect(none.headline.dti).toBeNull();
    expect(none.headline.stressTested).toBeNull();
    expect(body).not.toMatch(/0\.0x/);
    expect(body).not.toMatch(/Stress tested \$0/);
  });

  it('prints no income table holding only a total', () => {
    expect(body).not.toContain('Income, before and after shading');
  });

  /**
   * §21. The section's standfirst was one sentence for every document, and
   * promised "every income component" and "every liability" over a callout and
   * two figures. The callout's bridge to the expenses went with it: the
   * standfirst says what the section applies, once.
   */
  it('promises in its standfirst only what the section draws', () => {
    expect(body).not.toContain('Every income component');
    expect(body).not.toContain('every liability with its servicing');
    expect(body).toContain('The living expenses and commitments the assessment applied.');
    expect(body).not.toContain('The living expenses below are what it applied.');
  });

  it('advises recording the income, and not paying down debts that do not exist', () => {
    expect(none.recommendations).toEqual([
      'Record the household’s income and recalculate: with no income on the record, no capacity can be assessed.',
    ]);
    expect(body).not.toMatch(/high-interest/);
  });
});

describe('the basis, in the report’s words', () => {
  const body = text(html(dti));

  it('carries none of the engine’s machine-room phrasing', () => {
    for (const phrase of ['SHADED', 'APS 220', 'max of policy', 'zeroed below', 'income-scaled', 'Default APRA', 'P&I at']) {
      expect(body, phrase).not.toContain(phrase);
    }
  });

  it('prints no money with cents or without a separator', () => {
    expect(body).not.toMatch(/\$\d[\d,]*\.\d/);
    expect(body).not.toMatch(/\$\d{4,}\b/);
    expect(tidyMoney('$137,462.8/yr and $1000/mo')).toBe('$137,463/yr and $1,000/mo');
  });

  it('does not repeat the assessment terms', () => {
    const labels = dti.assumptions.map((a) => a.label);
    expect(labels).not.toContain('Buffer Rate');
    expect(labels).not.toContain('Assessment Rate');
    expect(labels).not.toContain('Loan Term');
  });

  it('prints a setting only where it applied', () => {
    const labels = (mode: string, card: boolean) => curateBasis(
      [
        { key: 'Conservative Surplus Floor', value: '$1000/mo (zeroed below)' },
        { key: 'Credit Card Servicing', value: '3.0% of limit' },
      ],
      { grossIncome: 1, calculationMode: mode, hasCreditCard: card, hasPropertyIncome: false, showsDti: true },
      titleCase,
    ).map((r) => r.label);
    expect(labels('bank', false)).toEqual([]);
    expect(labels('conservative', true)).toEqual(['Minimum surplus (conservative policy)', 'Credit cards serviced at']);
  });

  it('follows the working it qualifies, and leaves the scenarios to end the document', () => {
    const h = html(dti);
    expect(h.indexOf('On what basis')).toBeGreaterThan(h.indexOf('How the capacity is built'));
    const withScenarios = html(buildSnapshot({
      clientName: 'A. & J. Sample',
      assessment: SAMPLE_ASSESSMENT,
      scenarioPresets: SAMPLE_SCENARIO_PRESETS,
    }));
    expect(withScenarios.indexOf('data-chapter-title="On what basis"'))
      .toBeLessThan(withScenarios.indexOf('data-chapter-title="Scenario comparison"'));
  });
});

describe('the property income label', () => {
  it('drops the engine’s cut and its ellipsis', () => {
    expect(incomeLabel(ENGINE_PROPERTY_LABEL)).toBe('Property cash flow — 14 Wattle Grove Sampleton');
    expect(incomeLabel('Positive Cash Flow (37 Fairview Street Gunnedah, 2...)'))
      .toBe('Property cash flow — 37 Fairview Street Gunnedah');
  });

  it('keeps a label the engine did not cut, and every other label as recorded', () => {
    expect(incomeLabel('Positive Cash Flow (1 Short St...)')).toBe('Property cash flow — 1 Short St');
    expect(incomeLabel('Positive Cash Flow (14 Wattle Grove Sampleton, NSW 2380)'))
      .toBe('Property cash flow — 14 Wattle Grove Sampleton, NSW 2380');
    expect(incomeLabel('Primary Salary')).toBe('Primary Salary');
  });

  it('is written whole by the engine from now on', () => {
    const engine = readFileSync(
      resolve(__dirname, '../../../../../supabase/functions/calculate-borrowing-capacity/index.ts'),
      'utf8',
    );
    expect(engine).toContain('component: `Positive Cash Flow (${property.address || \'Property\'})`');
    expect(engine).not.toMatch(/Positive Cash Flow \(\$\{property\.address\?\.substring/);
  });
});

describe('the flow', () => {
  const h = html(dti);

  it('runs its sections on rather than opening a page for each', () => {
    const chapters = [...h.matchAll(/<section class="chapter([^"]*)"/g)].map((m) => m[1]);
    expect(chapters[0]).not.toContain('run-on');
    for (const c of chapters.slice(1)) expect(c).toContain('run-on');
  });

  it('keeps the short tables whole, and the working and each callout too', () => {
    // A table is kept whole by its estimated height (`tableKeeping.pure.ts`),
    // the working and the callouts by their own wrapper; the chart cannot split
    // by its own rule (`.chart-figure { page-break-inside: avoid }`).
    expect((h.match(/class="table-block keep-together"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((h.match(/<div class="keep-together">/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(h).toMatch(/<figure class="chart-figure[^"]*"[\s\S]*?Capacity and headroom/);
  });

  it('sets its sections as memo sections, with subheads one step below the title (§21)', () => {
    const chapters = [...h.matchAll(/<section class="chapter([^"]*)"/g)].map((m) => m[1]);
    for (const c of chapters) expect(c).toContain(MEMO_CHAPTER_CLASS);
    const subheads = [...h.matchAll(/<h2([^>]*)>/g)].map((m) => m[1]);
    expect(subheads.length).toBeGreaterThan(0);
    for (const attrs of subheads) expect(attrs).toContain(SECTION_SUBHEAD_CLASS);
  });

  it('states the proposed loan once, in the opening paragraph (§21)', () => {
    // The chart's bar carries its own figure inside the drawing; in the text
    // the loan is the opening paragraph's, once.
    expect(text(h).match(/\$400,000/g)).toHaveLength(1);
    expect(text(h)).not.toContain('of the assessed capacity, which falls within the limit');
  });

  it('prints no engine " - " join anywhere a reader looks', () => {
    expect(text(h)).not.toMatch(/[a-z] - [a-z]/i);
  });
});

/**
 * A recalculated assessment: the DTI-limited client as the engine writes it
 * today, with its own explanation and audit trail (§21). The two documents read
 * on 28 Sep predated both, and every rule below was found on this shape.
 */
describe('a recalculated assessment (§21)', () => {
  const recalculated = buildSnapshot({
    clientName: 'Sam Example',
    assessment: { ...DTI_LIMITED_ASSESSMENT, audit_trail: DTI_LIMITED_ENGINE_AUDIT_TRAIL, explanation: DTI_LIMITED_ENGINE_EXPLANATION },
    auditTrail: DTI_LIMITED_ENGINE_AUDIT_TRAIL,
    explanation: DTI_LIMITED_ENGINE_EXPLANATION,
  });
  const h = html(recalculated);
  const t = text(h);
  const audit = h.slice(h.indexOf('>Provided<'));
  const row = (label: string) => {
    const at = audit.indexOf(`>${label}<`);
    expect(at, label).toBeGreaterThan(-1);
    return audit.slice(at, audit.indexOf('</tr>', at));
  };

  it('prints the working once, in its own words, and never the engine\'s step-by-step', () => {
    expect(t).not.toContain('How this was calculated');
    for (const shorthand of ['commitment(s)', 'source(s)', '→', 'RED band', 'property CF', 'via override', '/ $164,400']) {
      expect(t, shorthand).not.toContain(shorthand);
    }
    // The explanation is still read, for the template catalogue.
    expect(recalculated.explanation?.steps).toHaveLength(8);
    expect(t).toContain('How the capacity is built');
  });

  it('says a property\'s shortfall reduces capacity', () => {
    expect(row('Property costs not covered by rent — 22 Example Road Sampleton NSW 2380')).toContain('Reduces');
  });

  it('says the stress test moved nothing, and by how much it would', () => {
    const stress = row('Stress test');
    expect(stress).not.toContain('Reduces');
    expect(stress).toContain('-$35,636');
    expect(stress).toContain('At the assessment rate plus 1%');
  });

  it('prints none of the engine\'s category totals', () => {
    expect(t).not.toContain('$417,550');
    expect(t).not.toContain('$45,838');
    expect(recalculated.audit?.summary).toEqual({ transformations: expect.anything() });
  });

  it('labels every row by what it holds, and states every rule in words', () => {
    expect(row('Income after tax and the Medicare levy')).toContain('26.4% of assessable income');
    expect(row('Medicare levy, within the tax above')).toContain('2% of gross income');
    expect(row('Property cash flow — 14 Wattle Grove Sampleton')).toContain('80% counted');
    expect(row('Mortgage')).toContain('Assessed repayment');
    expect(t).not.toMatch(/Neg CF|Income Tax|Medicare Levy|\$2450\/mo|Layered on expenses|above assessment/);
  });

  it('gives the living-expense row the document\'s own method, not the engine\'s', () => {
    // The Calculator sends its figure as an explicit amount, so the engine
    // writes "Method: Declared" whatever was applied (§20). The column says
    // what was applied, and the terms, the expenses and the audit read it once.
    const onHem = buildSnapshot({
      clientName: 'Sam Example',
      assessment: { ...DTI_LIMITED_ASSESSMENT, expense_method: 'hem' },
      auditTrail: DTI_LIMITED_ENGINE_AUDIT_TRAIL,
    });
    const living = onHem.audit!.groups.flatMap((g) => g.rows).find((r) => r.label === 'Living expenses')!;
    expect(living.rule).toBe('HEM benchmark');
    expect(onHem.expenses.method).toBe('HEM benchmark');
  });
});

/**
 * §21. A total row its own rows do not reach is the one figure a reader can
 * check and find wrong. The calculator sends its own totals, so where they and
 * the recorded lines disagree the table names both, and the chart whose centre
 * states the total is not drawn over segments that add up to something else.
 */
describe('a table that foots', () => {
  const sample = buildSnapshot({ clientName: 'A. & J. Sample', assessment: SAMPLE_ASSESSMENT });
  const edited = buildSnapshot({
    clientName: 'A. & J. Sample',
    assessment: { ...SAMPLE_ASSESSMENT, gross_annual_income: 196_000, shaded_annual_income: 181_400, existing_commitments_monthly: 1_610 },
  });

  it('prints one total where the lines reach it, with the capitalised premium as a line', () => {
    const h = html(sample);
    expect(h).toContain('Lenders mortgage insurance, added to the loan');
    expect(h).toMatch(/>Total</);
    expect(h).not.toContain('Used in this assessment');
    expect(h).not.toContain('Two totals');
    expect(h).toContain('Assessed income by component');
  });

  it('names both totals where the calculator\'s differ from the lines, and says which the working uses', () => {
    const h = html(edited);
    expect(h.match(/Total of the lines above/g)).toHaveLength(2);
    expect(h.match(/Used in this assessment/g)).toHaveLength(2);
    const t = text(h).replace(/&#39;/g, "'");
    expect(t).toContain("This assessment was run on the calculator's income: $196,000 pa gross, $181,400 pa of it assessed.");
    expect(t).toContain('The lines recorded for the household come to $186,000 pa and $171,400 pa.');
    expect(t).toContain("This assessment was run on the calculator's commitments of $1,610/mo.");
    expect(h).not.toContain('Assessed income by component');
  });

  it('labels the mortgage insurance in the report\'s words, and its net figure only where it is proven', () => {
    const h = html(sample);
    expect(h).toContain('Loan-to-value ratio');
    expect(h).toContain('Capacity left for the purchase');
    expect(h).not.toContain('LVR at trigger');
    expect(h).not.toContain('Net for purchase');
    const unproven = html(buildSnapshot({ clientName: 'X', assessment: { ...SAMPLE_ASSESSMENT, net_purchase_capacity: 942_000 } }));
    expect(unproven).not.toContain('Capacity left for the purchase');
  });

  it('calls an income with no lines the figure the assessment ran on, never a total of nothing', () => {
    const typed = buildSnapshot({
      clientName: 'X',
      assessment: { ...SAMPLE_ASSESSMENT, income_breakdown: [], assumptions: {} },
    });
    expect(typed.income.recorded).toBe(true);
    expect(typed.income.rows).toEqual([]);
    const h = html(typed);
    const incomeTable = h.slice(h.indexOf('Income, before and after shading'), h.indexOf('</table>', h.indexOf('Income, before and after shading')));
    expect(incomeTable).toContain('Used in this assessment');
    expect(incomeTable).not.toMatch(/>Total</);
    expect(text(h)).toContain('The income the assessment ran on, and every liability with its servicing.');
  });

  it('says a deducted premium is paid from the loan, never from the deposit', () => {
    const t = text(html(buildSnapshot({ clientName: 'X', assessment: { ...SAMPLE_ASSESSMENT, lmi_mode: 'display_deduction' } })));
    expect(t).toContain('The premium is paid from the loan, so the capacity is unchanged and less of it is left for the purchase.');
    expect(t).not.toMatch(/taken from the deposit/);
  });
});
