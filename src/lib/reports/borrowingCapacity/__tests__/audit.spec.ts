/**
 * Reading an audit entry: units, and whether a change helped or hurt.
 *
 * The last block in this file is the important one. `audit.pure.ts` keys two
 * tables on the `(category, action)` pairs the Edge Function emits, and a table
 * keyed on strings written somewhere else goes stale silently — a new audit
 * entry would simply render grey and unitless in a client's report, and nothing
 * would say so. So the test reads the Edge Function and checks both directions:
 * every action it emits is known here, and every action known here is one it
 * emits.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  auditDelta,
  auditDirection,
  auditMeasures,
  auditUnits,
  isKnownAuditAction,
  KNOWN_AUDIT_ACTIONS,
  type RawAuditEntry,
} from '../audit.pure';
import { formatDelta, formatMeasure } from '@/lib/reportDesign/measure.pure';

const REPO = resolve(__dirname, '../../../../..');
const ENGINE = resolve(REPO, 'supabase/functions/calculate-borrowing-capacity/index.ts');

const entry = (over: Partial<RawAuditEntry>): RawAuditEntry => ({
  seq: 1,
  category: 'income',
  action: 'shading_applied',
  label: 'Rental income',
  rawValue: 20_000,
  assessedValue: 16_000,
  rule: '80% shading',
  impact: 'decrease',
  delta: -4_000,
  ...over,
});

describe('units', () => {
  /**
   * The finding. `audit.add('policy', 'override_applied', 'Interest Rate
   * Override', activePolicy.loanDefaults.interestRate, overrides.interestRate,
   * …)` carries two rates; the shipping report prints "$6 → $9, +$3".
   */
  it('reads a rate override as a rate, not as money (F2)', () => {
    const e = entry({
      category: 'policy',
      action: 'override_applied',
      label: 'Interest Rate Override',
      rawValue: 6.15,
      assessedValue: 8.65,
      impact: 'increase',
      delta: 2.5,
    });
    const { raw, assessed } = auditMeasures(e);
    expect(formatMeasure(raw)).toBe('6.15%');
    expect(formatMeasure(assessed)).toBe('8.65%');
    expect(formatDelta(auditDelta(e)!)).toBe('+2.50%');
  });

  it('reads income shading as annual money and expenses as monthly', () => {
    expect(auditUnits('income', 'shading_applied')).toEqual({ raw: 'aud/year', assessed: 'aud/year' });
    expect(auditUnits('expense', 'hem_benchmark_applied')).toEqual({ raw: 'aud/month', assessed: 'aud/month' });
  });

  /**
   * `audit.add('liability', action, l.type, l.balance || 0, l.monthlyServicing, …)`
   * — a balance on one side, a monthly repayment on the other. Their difference
   * is not a quantity, and the shipping report prints it anyway.
   */
  it('refuses a delta between a balance and a monthly repayment (F13)', () => {
    const e = entry({
      category: 'liability',
      action: 'credit_card_limit_rate',
      label: 'Credit Card',
      rawValue: 8_000,
      assessedValue: 240,
      impact: 'decrease',
      delta: -7_760,
    });
    const { raw, assessed } = auditMeasures(e);
    expect(formatMeasure(raw)).toBe('$8,000');
    expect(formatMeasure(assessed)).toBe('$240/mo');
    expect(auditDelta(e)).toBeNull();
  });

  /**
   * `audit.add('policy', 'lender_profile_selected', 'Lender Profile', 0, 0, …)`
   * records which policy was used. Its two zeroes are not amounts.
   */
  it('renders a fact-only entry as em dashes rather than $0 → $0 (F14)', () => {
    const e = entry({
      category: 'policy',
      action: 'lender_profile_selected',
      label: 'Lender Profile',
      rawValue: 0,
      assessedValue: 0,
      impact: 'neutral',
      delta: 0,
    });
    const { raw, assessed } = auditMeasures(e);
    expect(formatMeasure(raw)).toBe('—');
    expect(formatMeasure(assessed)).toBe('—');
    expect(auditDelta(e)).toBeNull();
  });

  it('does not invent units for an action it has never seen', () => {
    const e = entry({ category: 'income', action: 'something_new' });
    expect(isKnownAuditAction('income', 'something_new')).toBe(false);
    expect(auditUnits('income', 'something_new')).toEqual({ raw: 'none', assessed: 'none' });
    expect(auditDelta(e)).toBeNull();
    expect(auditDirection(e)).toBe('neutral');
  });

  /**
   * `medicare_levy_applied` and `negative_cf_layered` both record a real
   * `rawValue` of 0. Every `||`-based reader in the repo turns that into
   * something else (F10).
   */
  it('keeps a genuine zero', () => {
    const e = entry({
      category: 'tax',
      action: 'medicare_levy_applied',
      label: 'Medicare Levy',
      rawValue: 0,
      assessedValue: 3_720,
      impact: 'increase',
      delta: 3_720,
    });
    expect(formatMeasure(auditMeasures(e).raw)).toBe(`$0\u00A0pa`);
    expect(formatDelta(auditDelta(e)!)).toBe(`+$3,720\u00A0pa`);
  });
});

describe('direction', () => {
  /**
   * The finding. A HEM floor adds $700 to assessed expenses — a *positive*
   * delta that *reduces* capacity. The shipping report colours it green.
   */
  it('calls a HEM floor adverse even though its delta is positive (F6)', () => {
    expect(
      auditDirection(entry({
        category: 'expense',
        action: 'hem_benchmark_applied',
        rawValue: 4_120,
        assessedValue: 4_820,
        impact: 'increase',
        delta: 700,
      })),
    ).toBe('adverse');
  });

  it('calls income shading adverse — same effect, opposite sign', () => {
    expect(auditDirection(entry({ impact: 'decrease' }))).toBe('adverse');
    expect(auditDirection(entry({ impact: 'increase' }))).toBe('favourable');
  });

  /**
   * Polarity is per-action, not per-category: `tax_calculated` reports
   * after-tax income (more is better) and `medicare_levy_applied` reports the
   * levy charged (more is worse), in the same category.
   */
  it('flips polarity within the tax category', () => {
    const taxed = { category: 'tax' as const, impact: 'decrease' as const };
    expect(auditDirection(entry({ ...taxed, action: 'tax_calculated' }))).toBe('adverse');
    expect(auditDirection(entry({ ...taxed, action: 'medicare_levy_applied' }))).toBe('favourable');
  });

  it('calls a rate override adverse when the rate goes up', () => {
    expect(
      auditDirection(entry({ category: 'policy', action: 'override_applied', impact: 'increase' })),
    ).toBe('adverse');
  });

  it('leaves a fact-only entry uncoloured', () => {
    expect(
      auditDirection(entry({ category: 'policy', action: 'lender_profile_selected', impact: 'neutral' })),
    ).toBe('neutral');
  });
});

// ── Coverage against the engine ─────────────────────────────────────────────

/**
 * Split a call's argument list on top-level commas, respecting nesting and all
 * three string forms. The Edge Function passes template literals and ternaries
 * as arguments, so a naive `split(',')` reads the wrong thing.
 */
function splitArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      current += c;
      if (c === '\\') { current += text[++i] ?? ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; current += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += c;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/** The balanced argument text of every `audit.add(...)` call in `source`. */
function auditAddCalls(source: string): string[] {
  const calls: string[] = [];
  const needle = 'audit.add(';
  let from = 0;
  for (;;) {
    const at = source.indexOf(needle, from);
    if (at === -1) break;
    let i = at + needle.length;
    let depth = 1;
    let quote: string | null = null;
    for (; i < source.length && depth > 0; i++) {
      const c = source[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '(') depth++;
      if (c === ')') depth--;
    }
    calls.push(source.slice(at + needle.length, i - 1));
    from = i;
  }
  return calls;
}

const QUOTED = /'([a-z][a-z0-9_]*)'/g;

/**
 * Every `category/action` pair the engine emits.
 *
 * The second argument is usually a literal. For liabilities it is a local
 * `action` whose ternary lists four of them, so an identifier is resolved by
 * finding its `const … =` and taking every quoted literal out of it.
 */
function emittedPairs(source: string): Set<string> {
  const pairs = new Set<string>();
  for (const call of auditAddCalls(source)) {
    const args = splitArgs(call);
    const category = args[0]?.match(/^'([a-z]+)'$/)?.[1];
    if (!category) continue;

    const actionArg = args[1] ?? '';
    const literal = actionArg.match(/^'([a-z0-9_]+)'$/)?.[1];
    if (literal) { pairs.add(`${category}/${literal}`); continue; }

    // A ternary passed inline, or an identifier assigned just above.
    let expression = actionArg;
    if (/^[A-Za-z_$][\w$]*$/.test(actionArg)) {
      const assignment = new RegExp(`(?:const|let)\\s+${actionArg}\\s*=([\\s\\S]*?);`).exec(source);
      expression = assignment?.[1] ?? '';
    }
    // Both forms are ternaries whose *conditions* also contain string literals
    // — `expenseMethodUsed === 'hem' ? 'hem_benchmark_applied' : …`. Only the
    // branches are actions, so drop what is being compared against.
    expression = expression
      .replace(/[!=]==?\s*'[^']*'/g, '')
      .replace(/\.includes\(\s*'[^']*'\s*\)/g, '');
    for (const [, action] of expression.matchAll(QUOTED)) pairs.add(`${category}/${action}`);
  }
  return pairs;
}

describe('coverage against calculate-borrowing-capacity', () => {
  const source = readFileSync(ENGINE, 'utf8');
  const emitted = [...emittedPairs(source)].sort();

  it('found the engine and its audit calls', () => {
    // A scanner that silently matches nothing would make both assertions below
    // pass for the wrong reason.
    expect(auditAddCalls(source).length).toBeGreaterThanOrEqual(11);
    expect(emitted.length).toBeGreaterThanOrEqual(14);
  });

  it('knows the units and polarity of every entry the engine emits', () => {
    const unknown = emitted.filter((pair) => !KNOWN_AUDIT_ACTIONS.includes(pair));
    expect(
      unknown,
      'calculate-borrowing-capacity emits audit entries audit.pure.ts has no unit or '
        + 'polarity for. They would render grey and unitless in a client\'s report. '
        + 'Add them to UNITS and POLARITY.',
    ).toEqual([]);
  });

  it('carries no entry the engine has stopped emitting', () => {
    const stale = KNOWN_AUDIT_ACTIONS.filter((pair) => !emitted.includes(pair));
    expect(
      stale,
      'audit.pure.ts describes audit entries the engine no longer emits — remove them, '
        + 'or find out where they went.',
    ).toEqual([]);
  });
});
