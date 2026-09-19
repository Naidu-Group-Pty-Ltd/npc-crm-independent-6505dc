/**
 * A number in this report is never just a number.
 *
 * The shipping Snapshot puts every value through one currency formatter, so
 * the audit trail tells a client their assessment rate went from **$6 to $9**
 * when it went from 6.15% to 8.65% (`BORROWING_CAPACITY.md` F2). The formatter
 * is not the bug — the bug is that by the time the formatter sees the value,
 * the unit is gone.
 *
 * A `Measure` keeps the unit attached to the value all the way to the page.
 * Nothing in this format renders a bare number.
 *
 * There is no dependency here, deliberately: this module must load in Deno,
 * in Vite and in a test with nothing else present.
 */

/**
 * Units this report actually uses. Each one was read off a real value in
 * `calculate-borrowing-capacity` or the assessment row — none is speculative.
 */
export type Unit =
  /** A dollar amount with no period attached: a balance, a capacity, an LMI premium. */
  | 'aud'
  /** A dollar amount per month: servicing, living expenses, surplus. */
  | 'aud/month'
  /** A dollar amount per year: gross income, shaded income, tax. */
  | 'aud/year'
  /**
   * A dollar amount per week.
   *
   * The Cash Flow projection's headline: an Australian investor asks what a
   * property costs them a week, and the legacy generator prints that figure
   * beside an annual one with nothing to tell them apart.
   */
  | 'aud/week'
  /**
   * A percentage **already scaled**: `8.65` renders `8.65%`. Interest rates,
   * buffer rates and LVRs are stored this way.
   */
  | 'percent'
  /**
   * A percentage stored as a **0–1 fraction**: `0.8` renders `80%`. Income
   * shading is stored this way, and the difference between this and `percent`
   * is why a shading rate of 0.8 has been printed as "1%" and as "80%" by two
   * different generators reading the same column.
   */
  | 'rate'
  /** A multiple: `5.4` renders `5.4x`. DTI. */
  | 'ratio'
  /** A term in whole years. */
  | 'years'
  /** A plain count of things. */
  | 'count'
  /**
   * The row carries no number. `audit.add('policy', 'lender_profile_selected',
   * …, 0, 0, …)` is a real entry whose two zeroes mean "not applicable", and
   * rendering them as `$0 → $0` is worse than rendering nothing.
   */
  | 'none';

export interface Measure {
  readonly value: number;
  readonly unit: Unit;
  /**
   * Decimal places. Omitted means the unit's default — see `DEFAULT_PRECISION`.
   * Set it when a specific figure needs more or fewer than its unit normally
   * gets (a shading rate of 87.5%, say).
   */
  readonly precision?: number;
}

/** What each unit renders with when the `Measure` does not say otherwise. */
export const DEFAULT_PRECISION: Readonly<Record<Unit, number>> = {
  aud: 0,
  'aud/month': 0,
  'aud/year': 0,
  'aud/week': 0,
  percent: 2,
  rate: 0,
  ratio: 1,
  years: 0,
  count: 0,
  none: 0,
};

// ── Constructors ────────────────────────────────────────────────────────────
// Short names because call sites are dense: `aud(row.borrowing_capacity)`
// reads better than `measure(row.borrowing_capacity, 'aud')` fifty times over.

export const aud = (value: number, precision?: number): Measure => ({ value, unit: 'aud', precision });
export const audPerMonth = (value: number, precision?: number): Measure => ({ value, unit: 'aud/month', precision });
export const audPerYear = (value: number, precision?: number): Measure => ({ value, unit: 'aud/year', precision });
export const audPerWeek = (value: number, precision?: number): Measure => ({ value, unit: 'aud/week', precision });
export const percent = (value: number, precision?: number): Measure => ({ value, unit: 'percent', precision });
export const rate = (value: number, precision?: number): Measure => ({ value, unit: 'rate', precision });
export const ratio = (value: number, precision?: number): Measure => ({ value, unit: 'ratio', precision });
export const years = (value: number): Measure => ({ value, unit: 'years' });
export const count = (value: number): Measure => ({ value, unit: 'count' });
export const NO_MEASURE: Measure = { value: 0, unit: 'none' };

/** True for every unit that is money, whatever its period. */
export const isMoney = (unit: Unit): boolean =>
  unit === 'aud' || unit === 'aud/month' || unit === 'aud/year' || unit === 'aud/week';

/**
 * Two measures can be compared — subtracted, shown as a before/after pair —
 * only if they share a unit.
 *
 * This is not pedantry. `audit.add('liability', …, l.balance, l.monthlyServicing, …)`
 * puts a $412,000 balance and a $2,480 monthly repayment in one entry and
 * subtracts them, and the report prints the resulting −$409,520 as though it
 * meant something (F13). Both are money; they are not the same unit.
 */
export const comparable = (a: Measure, b: Measure): boolean => a.unit === b.unit;

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Group thousands with commas.
 *
 * Hand-rolled rather than `toLocaleString('en-AU')` because the same payload is
 * formatted in Deno (Edge Function) and in Node (tests, client bridge), and
 * their ICU builds do not have to agree — Node ships full ICU, Deno's grouping
 * for some locales has changed between releases. A golden that depends on the
 * runtime's locale data is a golden that fails on someone else's machine.
 */
function group(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return out;
}

function fixed(value: number, precision: number): { sign: string; body: string } {
  const negative = value < 0 || Object.is(value, -0);
  const abs = Math.abs(value);
  const asFixed = abs.toFixed(precision);
  const [whole, fraction] = asFixed.split('.');
  const body = fraction ? `${group(whole)}.${fraction}` : group(whole);
  // `-0.4` at precision 0 rounds to `0`; calling that "-$0" is noise.
  const meaningful = Number(asFixed) !== 0;
  return { sign: negative && meaningful ? '-' : '', body };
}

const precisionOf = (m: Measure): number => m.precision ?? DEFAULT_PRECISION[m.unit];

/**
 * Render a measure for the page.
 *
 * `emDash` is what a `none` measure renders as; the default is an em dash
 * because that is what a table cell with nothing in it should show.
 */
export function formatMeasure(m: Measure, emDash = '—'): string {
  if (m.unit === 'none') return emDash;
  if (!Number.isFinite(m.value)) return emDash;

  const p = precisionOf(m);

  switch (m.unit) {
    case 'aud':
    case 'aud/month':
    case 'aud/year':
    case 'aud/week': {
      const { sign, body } = fixed(m.value, p);
      // The space before `pa` is non-breaking: in a narrow table column a
      // normal space lets the line break between the figure and its period, so
      // `$20,000` lands on one line and `pa` on the next.
      const suffix = m.unit === 'aud/month'
        ? '/mo'
        : m.unit === 'aud/week'
          ? '/wk'
          : m.unit === 'aud/year' ? '\u00A0pa' : '';
      return `${sign}$${body}${suffix}`;
    }
    case 'percent': {
      const { sign, body } = fixed(m.value, p);
      return `${sign}${body}%`;
    }
    case 'rate': {
      const { sign, body } = fixed(m.value * 100, p);
      return `${sign}${body}%`;
    }
    case 'ratio': {
      const { sign, body } = fixed(m.value, p);
      return `${sign}${body}x`;
    }
    case 'years': {
      const { sign, body } = fixed(m.value, p);
      return `${sign}${body} ${Math.abs(m.value) === 1 ? 'year' : 'years'}`;
    }
    case 'count': {
      const { sign, body } = fixed(m.value, p);
      return `${sign}${body}`;
    }
  }
}

/**
 * The period a unit carries, as a column header would say it.
 *
 * Empty for everything that has no period. Pairs with `formatAmount`: a column
 * of annual figures should say "per year" once in its header rather than
 * repeating " pa" down forty rows.
 */
export function periodLabel(unit: Unit): string {
  if (unit === 'aud/month') return 'per month';
  if (unit === 'aud/week') return 'per week';
  if (unit === 'aud/year') return 'per year';
  return '';
}

/**
 * Render a measure **without** its period suffix.
 *
 * Only for a column whose header already states the period. Anywhere the value
 * stands alone — a KPI, a sentence, a callout — use `formatMeasure`, because a
 * bare `$4,820` next to a bare `$186,000` is exactly the ambiguity this module
 * exists to remove.
 */
export function formatAmount(m: Measure, emDash = '—'): string {
  const period = periodLabel(m.unit);
  const rendered = formatMeasure(m, emDash);
  if (!period) return rendered;
  const suffix = m.unit === 'aud/month' ? '/mo' : m.unit === 'aud/week' ? '/wk' : '\u00A0pa';
  return rendered.replace(suffix, '');
}

/**
 * Render a change. Always signed, so a reader can tell a delta from a level
 * without reading the column header.
 *
 * A zero delta renders as the em dash rather than `+$0` — "this did not move"
 * is the fact, and `+$0` states it as though something happened.
 */
export function formatDelta(m: Measure, emDash = '—'): string {
  if (m.unit === 'none' || !Number.isFinite(m.value)) return emDash;
  const p = precisionOf(m);
  // Rounded on the **rendered** scale, not the stored one.
  //
  // A `rate` is a 0–1 fraction that prints ×100, so a portfolio LVR moving
  // from 56.5% to 64.1% is a stored delta of 0.0762 — and `0.0762.toFixed(0)`
  // is `0`. This branch reported "did not move" for every rate change smaller
  // than half of one, which is every rate change there is. Found by reading a
  // rendered page: the LVR column said 57% → 64%, change "—".
  const scaled = m.unit === 'rate' ? m.value * 100 : m.value;
  if (Number(Math.abs(scaled).toFixed(p)) === 0) return emDash;
  const rendered = formatMeasure(m, emDash);
  return m.value > 0 ? `+${rendered}` : rendered;
}

/**
 * Subtract two measures, refusing when the units differ.
 *
 * Returns `null` rather than throwing: the caller is normalising data it did
 * not write, and one nonsensical audit row must not take the document down.
 * A `null` delta renders as the em dash, which is the honest answer.
 */
export function subtract(assessed: Measure, raw: Measure): Measure | null {
  if (!comparable(assessed, raw)) return null;
  return {
    value: assessed.value - raw.value,
    unit: assessed.unit,
    precision: assessed.precision ?? raw.precision,
  };
}
