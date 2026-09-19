/**
 * RF-7.2A — data assurance. Additive only; nothing in production changed.
 *
 * RF-7.1 proved CURRENT-PATH PARITY. This file pins the findings of the
 * SEMANTIC audit, and it does so in two different registers that must not be
 * confused:
 *
 *  • **Rules** — things that are true and must stay true (the contract reads no
 *    untrusted market blob; a derived figure carries its basis; `put()` is the
 *    absent-stays-absent guarantee).
 *
 *  • **Characterisations** — things that are true today and are NOT ideal (a
 *    formatter turns `null` into `0`; the narrative reconciler covers nine
 *    facts and no market statistic). These are pinned so that changing them is
 *    a deliberate, reviewed act rather than a side effect.
 *
 * A characterisation failing does not mean the code broke. It means behaviour
 * this programme measured has moved, and the move needs approval.
 *
 * Every measurement quoted here was taken by execution against the live
 * database on 2026-09-11 and is recorded in
 * `INVESTMENT_REPORT_DATA_CONTRADICTIONS.md`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveBindable } from '@/lib/reportTemplate/bindingResolver';
import { labelFor, grossYield, netYield } from '../../../../supabase/functions/_shared/reports/metrics/propertyMetrics.pure';
import { buildReportFactContract, factLeaves } from '@/lib/reports/contract/reportFactContract.pure';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
const AT = new Date('2026-09-11T00:00:00.000Z');

// ---------------------------------------------------------------------------
// RULES — true, and must stay true
// ---------------------------------------------------------------------------

/** Comments explain why a source is NOT read, so the rule is about CODE. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the contract reads no untrusted market source', () => {
  const CONTRACT = stripComments(
    read('supabase/functions/_shared/reports/contract/reportFactContract.pure.ts'),
  );

  it('names none of the generated or defective market blobs', () => {
    // `demographics_data` and `economic_data` carry generated figures on 855
    // and 1,035 rows; the Location trio is measured defective (audit §69).
    for (const blob of [
      'demographics_data', 'economic_data', 'location_intelligence',
      'walkScore', 'commuteTimeCBD', 'schoolsNearby', 'qualityScore',
    ]) {
      expect(CONTRACT, `the contract must not read ${blob}`).not.toContain(blob);
    }
  });

  it('publishes no market statistic at all, so none can be mislabelled', () => {
    const c = buildReportFactContract({ report: { id: 'x' }, observedAt: AT });
    const names = factLeaves(c).map((l) => l.name);
    for (const forbidden of ['population', 'medianIncome', 'medianRent', 'unemployment', 'cashRate', 'crime', 'climate']) {
      expect(names.some((n) => n.toLowerCase().includes(forbidden.toLowerCase())), forbidden).toBe(false);
    }
  });

  it('sources every geography fact from report_geography, never free text', () => {
    const c = buildReportFactContract({
      report: { id: 'x', property_address: '10 Example St, Traralgon VIC 3844' },
      geography: { suburb: 'Traralgon', state: 'VIC', postcode: '3844' },
      observedAt: AT,
    });
    for (const { name, fact } of factLeaves(c).filter((l) => l.name.startsWith('geography.'))) {
      if (fact.status === 'present') expect(fact.owner, name).toBe('public.report_geography');
    }
    expect(stripComments(
      read('supabase/functions/_shared/reports/contract/reportFactContract.pure.ts'),
    )).not.toContain('property_address');
  });
});

describe('a derived figure carries the basis it was measured on', () => {
  it('labels a yield with its denominator', () => {
    expect(labelFor('grossYield', 'purchase')).toBe('Gross yield (on purchase price)');
    expect(labelFor('grossYield', 'value')).toBe('Gross yield (on current value)');
    expect(labelFor('netYield', 'purchase')).toBe('Net yield (on purchase price)');
  });

  it('keeps origination and current LVR as different labels', () => {
    expect(labelFor('originationLvr')).toBe('LVR at settlement');
    expect(labelFor('currentLvr')).toBe('Current LVR');
    expect(labelFor('originationLvr')).not.toBe(labelFor('currentLvr'));
  });

  it('refuses a ratio whose denominator is absent rather than returning zero', () => {
    expect(grossYield({ annualRent: 33800, basisAmount: 0, basis: 'purchase' })).toBeNull();
    expect(netYield({ annualRent: 33800, annualOperatingCosts: 10400, basisAmount: 0, basis: 'purchase' })).toBeNull();
  });

  it('carries the basis through the contract onto the fact', () => {
    const c = buildReportFactContract({
      report: {
        id: 'x',
        manual_overrides: { purchasePrice: 700000, weeklyRent: 650 },
        financial_calculations: { annualCosts: { totalAnnualExcludingLandTax: 10400 } },
      },
      observedAt: AT,
    });
    expect(c.derived.grossYield.basis).toBe('Gross yield (on purchase price)');
    expect(c.derived.netYield.basis).toBe('Net yield (on purchase price)');
  });
});

describe('`put()` is the absent-stays-absent guarantee and must keep refusing three values', () => {
  const PROJECTION = read('supabase/functions/_shared/reportBindingProjection.pure.ts');

  it('still refuses undefined, null and the empty string', () => {
    // This single line is what stops a formatter printing "$0" for an unknown
    // figure — see the characterisation below. It is load-bearing.
    expect(PROJECTION).toContain("if (value !== undefined && value !== null && value !== '') target[key] = value;");
  });
});

// ---------------------------------------------------------------------------
// CHARACTERISATIONS — true today, NOT ideal, pinned so a change is deliberate
// ---------------------------------------------------------------------------

/**
 * RESOLVED BY RF-7.2B.
 *
 * These two assertions previously pinned the hazard as it stood: a formatter
 * ran BEFORE the null check, `Number(null)` is `0`, and an unknown LVR rendered
 * `0%`. They were written as characterisations precisely so that changing the
 * behaviour would have to be deliberate — and RF-7.2B §18 changed it under an
 * explicit instruction to.
 *
 * They are kept, inverted, rather than deleted: the defect they describe is the
 * kind that returns, and the record of what it looked like is worth more than a
 * clean file. `REPORT_NULL_AND_VISIBILITY_POLICY.md` carries the full table.
 */
describe('RESOLVED (was a characterisation): a formatter no longer turns absence into zero', () => {
  const ctx = (financials: Record<string, unknown>) =>
    ({ data: { financials }, tokens: { colors: {}, fonts: {}, spacing: {} } }) as never;

  it('renders a missing key as empty — the state `put()` actually produces', () => {
    expect(resolveBindable('{{financials.lvr | percent:0}}', ctx({}))).toBe('');
    expect(resolveBindable('{{financials.weeklyRent | currency}}', ctx({}))).toBe('');
  });

  it('now renders an explicit null as empty, where it used to render "0%" and "$0"', () => {
    expect(resolveBindable('{{financials.lvr | percent:0}}', ctx({ lvr: null }))).toBe('');
    expect(resolveBindable('{{financials.weeklyRent | currency}}', ctx({ weeklyRent: null }))).toBe('');
    expect(resolveBindable('{{financials.lvr | percent:0}}', ctx({ lvr: '' }))).toBe('');
  });

  it('now distinguishes a genuine zero from an absence', () => {
    const absent = resolveBindable('{{financials.weeklyRent | currency}}', ctx({ weeklyRent: null }));
    const real = resolveBindable('{{financials.weeklyRent | currency}}', ctx({ weeklyRent: 0 }));
    expect(absent).toBe('');
    expect(real).toBe('$0');
    expect(absent).not.toBe(real);
  });
});

describe('CHARACTERISATION: the narrative reconciler covers nine facts and no market statistic', () => {
  const FACTS = read('supabase/functions/_shared/reports/investment/factReconciliation.pure.ts');

  it('reconciles exactly the nine property and finance facts', () => {
    for (const f of [
      'bedrooms', 'bathrooms', 'carSpaces', 'purchasePrice', 'weeklyRent',
      'landSizeSqm', 'grossYieldPct', 'netYieldPct', 'lvrPct',
    ]) {
      expect(FACTS, `CanonicalFacts must keep ${f}`).toContain(`${f}?:`);
    }
  });

  it('reconciles NO market statistic — which is why §1 and §3 passed through it', () => {
    // Pinned as a finding, not as a desirable state. Extending this is
    // RF-7.2B+ work, and only after the injected facts are themselves sound:
    // reconciling prose against injected facts proves faithfulness, not truth.
    for (const absent of ['population', 'medianIncome', 'cashRate', 'unemploymentRate', 'crimeRate']) {
      expect(FACTS, `${absent} is not reconciled today`).not.toContain(`${absent}?:`);
    }
  });

  it('states that its three derived facts are on the purchase-price basis', () => {
    expect(FACTS).toContain('PURCHASE-PRICE basis');
  });
});

describe('CHARACTERISATION: the binding language permits business logic', () => {
  const RESOLVER = read('src/lib/reportTemplate/bindingResolver.ts');

  it('still supports inline expressions, which the authority boundary forbids a template to use', () => {
    // 0 of the 4 active investment templates use it. The capability is the
    // finding: a template that computed a fact could disagree with another.
    expect(RESOLVER).toContain('Inline expression');
    expect(RESOLVER).toMatch(/headRaw\.startsWith\('='\)/);
  });
});

// ---------------------------------------------------------------------------
// The RF-7.2A documents must keep saying what was measured
// ---------------------------------------------------------------------------

describe('the audit record states its measurements rather than impressions', () => {
  const CONTRA = read('docs/reports/INVESTMENT_REPORT_DATA_CONTRADICTIONS.md');

  it('records the demographics finding with its evidence', () => {
    expect(CONTRA).toContain('0 of 616');
    expect(CONTRA).toContain('r = 0.0394');
    expect(CONTRA).toContain('87 of 206');
  });

  it('records the cash-rate finding with its evidence', () => {
    expect(CONTRA).toContain('1,084 of 1,121');
    expect(CONTRA).toContain('0.75 percentage points');
  });

  it('states that nothing was repaired', () => {
    expect(CONTRA).toContain('Production behaviour changed by RF-7.2A: NONE.');
  });

  it('never claims a fix was applied to a stored report', () => {
    for (const forbidden of ['we corrected', 'has been repaired', 'now reads the real']) {
      expect(CONTRA.toLowerCase()).not.toContain(forbidden);
    }
  });
});
