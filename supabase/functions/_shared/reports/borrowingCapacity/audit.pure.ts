/**
 * Reading an audit entry.
 *
 * `calculate-borrowing-capacity` records every transformation it applies as
 * `{ category, action, label, rawValue, assessedValue, delta, impact, rule }`
 * — seven fields, of which two are bare numbers whose meaning lives entirely in
 * the other five. The shipping report ignores those five, prints both numbers
 * as dollars, and colours the delta by its arithmetic sign.
 *
 * Two things follow from that, and this module is both of them:
 *
 *  1. **Units** (`BORROWING_CAPACITY.md` F2, F13). The unit of `rawValue` is a
 *     function of `(category, action)` — and for liability entries it is not
 *     the same unit as `assessedValue`, which is why their delta is nonsense.
 *  2. **Direction** (F6). Whether a change helped or hurt the client is also a
 *     function of `(category, action)`, not of the sign of the delta. A HEM
 *     floor that adds $700 to assessed expenses has a *positive* delta and
 *     *reduces* capacity.
 *
 * Both tables are keyed by the action strings the Edge Function actually emits.
 * `auditCoverage.spec.ts` reads that file and fails if it emits one this module
 * does not know — so a new audit entry surfaces as a red test, not as a silent
 * grey row in a client's report.
 */

import type { Measure, Unit } from '../../reportDesign/measure.pure.ts';
import { NO_MEASURE, subtract } from '../../reportDesign/measure.pure.ts';

export type AuditCategory =
  | 'income'
  | 'expense'
  | 'liability'
  | 'property'
  | 'tax'
  | 'policy'
  | 'constraint';

/** The entry as the Edge Function writes it. Numbers, no units. */
export interface RawAuditEntry {
  seq: number;
  category: AuditCategory;
  action: string;
  label: string;
  rawValue: number;
  assessedValue: number;
  rule: string;
  impact: 'increase' | 'decrease' | 'neutral';
  delta: number;
  note?: string;
}

/**
 * Did this move the client toward or away from being able to borrow?
 *
 * `neutral` is used for two different situations and that is deliberate: a row
 * that records a fact rather than a movement, and a row whose polarity is not
 * known. Both should render without a colour, because a wrong colour on a
 * lending document is worse than no colour.
 */
export type Direction = 'favourable' | 'adverse' | 'neutral';

/**
 * Polarity: does a **larger `assessedValue`** help the client?
 *
 *   `+1` — yes (assessed income, after-tax income, stress-tested capacity)
 *   `-1` — no  (expenses, servicing, levies, rates, capitalised LMI)
 *    `0` — the row states a fact; there is no movement to colour
 *
 * Keyed `category/action`. Every entry below is traceable to an `audit.add(…)`
 * call site in `supabase/functions/calculate-borrowing-capacity/index.ts`; the
 * line numbers are current as of Phase 1 and are a starting point for the
 * search, not an index.
 */
const POLARITY: Readonly<Record<string, -1 | 0 | 1>> = {
  // `assessedValue` is the shaded income — more of it is more capacity. (:1647)
  'income/shading_applied': 1,
  // `assessedValue` is after-tax income, not tax paid. (:1652)
  'tax/tax_calculated': 1,
  // …but here it *is* the levy charged, so the polarity flips inside the same
  // category. This pair is the reason the table is keyed by action. (:1653)
  'tax/medicare_levy_applied': -1,
  // Assessed living expenses. Higher is worse. (:1655–1656)
  'expense/hem_benchmark_applied': -1,
  'expense/declared_expenses_used': -1,
  'expense/override_applied': -1,
  // `assessedValue` is the property's monthly cashflow, negative for a
  // negatively-geared property. Less negative is better. (:1659)
  'property/negative_cf_layered': 1,
  // `assessedValue` is monthly servicing. All servicing reduces capacity. (:1665)
  'liability/credit_card_limit_rate': -1,
  'liability/hecs_threshold_applied': -1,
  'liability/pi_conversion': -1,
  'liability/assessment_rate_applied': -1,
  // Which lender's policy was used. A statement, with two zeroes. (:1639)
  'policy/lender_profile_selected': 0,
  // A rate override. Higher rate, less capacity. (:1641–1642)
  'policy/override_applied': -1,
  // LMI added to the debt. (:1670)
  'constraint/lmi_capitalised': -1,
  // `assessedValue` is the stress-tested capacity — a level, and more is
  // better, even though the entry always records a reduction. (:1674)
  'constraint/stress_test_applied': 1,
};

/**
 * The unit of each side of the entry.
 *
 * Note the `liability/*` rows: `rawValue` is a **balance** and `assessedValue`
 * is a **monthly repayment**. That is not a modelling choice made here — it is
 * what `audit.add('liability', action, l.type, l.balance || 0, l.monthlyServicing, …)`
 * writes. Recording the two units honestly is what makes `auditDelta` refuse to
 * subtract them (F13).
 */
const UNITS: Readonly<Record<string, { raw: Unit; assessed: Unit }>> = {
  'income/shading_applied': { raw: 'aud/year', assessed: 'aud/year' },
  'tax/tax_calculated': { raw: 'aud/year', assessed: 'aud/year' },
  'tax/medicare_levy_applied': { raw: 'aud/year', assessed: 'aud/year' },
  'expense/hem_benchmark_applied': { raw: 'aud/month', assessed: 'aud/month' },
  'expense/declared_expenses_used': { raw: 'aud/month', assessed: 'aud/month' },
  'expense/override_applied': { raw: 'aud/month', assessed: 'aud/month' },
  'property/negative_cf_layered': { raw: 'aud/month', assessed: 'aud/month' },
  'liability/credit_card_limit_rate': { raw: 'aud', assessed: 'aud/month' },
  'liability/hecs_threshold_applied': { raw: 'aud', assessed: 'aud/month' },
  'liability/pi_conversion': { raw: 'aud', assessed: 'aud/month' },
  'liability/assessment_rate_applied': { raw: 'aud', assessed: 'aud/month' },
  'policy/lender_profile_selected': { raw: 'none', assessed: 'none' },
  'policy/override_applied': { raw: 'percent', assessed: 'percent' },
  'constraint/lmi_capitalised': { raw: 'aud', assessed: 'aud' },
  'constraint/stress_test_applied': { raw: 'aud', assessed: 'aud' },
};

const key = (category: string, action: string) => `${category}/${action}`;

/** Every `category/action` this module knows. The coverage test reads it. */
export const KNOWN_AUDIT_ACTIONS: readonly string[] = Object.keys(UNITS).sort();

/**
 * True when the units and the polarity are both known.
 *
 * An unknown entry still renders — with its label, its rule and its own two
 * numbers unformatted-as-currency — but without a delta and without a colour.
 */
export const isKnownAuditAction = (category: string, action: string): boolean =>
  key(category, action) in UNITS && key(category, action) in POLARITY;

/**
 * The units of an entry's two values. Unknown entries get `none`, which
 * renders as an em dash — the honest output when we cannot say what the number
 * means.
 */
export function auditUnits(category: string, action: string): { raw: Unit; assessed: Unit } {
  return UNITS[key(category, action)] ?? { raw: 'none', assessed: 'none' };
}

/**
 * The entry's two values, as measures.
 *
 * `rawValue`/`assessedValue` are read with `??` rather than `||` so a genuine
 * zero survives — `medicare_levy_applied` and `negative_cf_layered` both record
 * a real `rawValue` of 0 (F10).
 */
export function auditMeasures(entry: RawAuditEntry): { raw: Measure; assessed: Measure } {
  const units = auditUnits(entry.category, entry.action);
  const rawValue = entry.rawValue ?? 0;
  const assessedValue = entry.assessedValue ?? 0;
  return {
    raw: units.raw === 'none' ? NO_MEASURE : { value: rawValue, unit: units.raw },
    assessed: units.assessed === 'none' ? NO_MEASURE : { value: assessedValue, unit: units.assessed },
  };
}

/**
 * The change, or `null` when there is no meaningful one.
 *
 * `null` for the liability rows, whose two sides are a balance and a monthly
 * repayment; `null` for unknown actions; `null` for the lender-profile row.
 * The Edge Function's own `entry.delta` is deliberately not used — it is
 * `assessedValue - rawValue` computed without regard to units, which is where
 * the −$409,520 comes from.
 */
export function auditDelta(entry: RawAuditEntry): Measure | null {
  const { raw, assessed } = auditMeasures(entry);
  if (raw.unit === 'none' || assessed.unit === 'none') return null;
  return subtract(assessed, raw);
}

/**
 * Whether the entry helped or hurt the client.
 *
 * For an entry whose two sides share a unit, this is `impact` — the direction
 * the engine recorded — read through the action's polarity.
 *
 * For an entry whose sides do **not** share a unit, `impact` is worthless.
 * `AuditTrailBuilder.add` sets it from the sign of `assessedValue - rawValue`,
 * and for a liability row that subtraction is a monthly repayment minus a
 * balance (F13): $240 − $8,000 is negative, so the engine records `decrease`,
 * so a naive reading concludes that adding a credit card **increases** the
 * client's capacity. The first real render of this document said exactly that.
 *
 * When there is no comparable delta the entry states a level rather than a
 * movement, and the polarity alone answers the question: a liability's assessed
 * servicing is a cost, and a cost is adverse.
 */
export function auditDirection(entry: RawAuditEntry): Direction {
  const polarity = POLARITY[key(entry.category, entry.action)] ?? 0;
  if (polarity === 0) return 'neutral';

  if (auditDelta(entry) === null) return polarity > 0 ? 'favourable' : 'adverse';

  if (entry.impact === 'neutral') return 'neutral';
  const increased = entry.impact === 'increase';
  return (polarity > 0) === increased ? 'favourable' : 'adverse';
}
