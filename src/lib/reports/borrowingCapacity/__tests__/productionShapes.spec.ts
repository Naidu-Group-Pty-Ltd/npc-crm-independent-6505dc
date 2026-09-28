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
import { SAMPLE_GLOBAL_SETTINGS } from './fixtures/sampleAssessment';
import {
  DTI_LIMITED_ASSESSMENT,
  ENGINE_PROPERTY_LABEL,
  NO_INCOME_ASSESSMENT,
} from './fixtures/productionShapes';

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

  it('prints no ratio over zero income and no stress test of nothing', () => {
    expect(none.headline.dti).toBeNull();
    expect(none.headline.stressTested).toBeNull();
    expect(body).not.toMatch(/0\.0x/);
    expect(body).not.toMatch(/Stress tested \$0/);
  });

  it('prints no income table holding only a total', () => {
    expect(body).not.toContain('Income, before and after shading');
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

  it('comes last, after the working it qualifies', () => {
    const h = html(dti);
    expect(h.indexOf('On what basis')).toBeGreaterThan(h.indexOf('From income to maximum capacity'));
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

  it('keeps the chart with its sentence, and the short tables whole', () => {
    expect(h).toMatch(/<div class="keep-together">[\s\S]*?Capacity and headroom[\s\S]*?Proposed loan/);
    expect((h.match(/class="keep-together"/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('prints no engine " - " join anywhere a reader looks', () => {
    expect(text(h)).not.toMatch(/[a-z] - [a-z]/i);
  });
});
