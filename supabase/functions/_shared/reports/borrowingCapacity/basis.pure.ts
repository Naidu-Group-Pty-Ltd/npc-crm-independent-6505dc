/**
 * The settings an assessment was run under, as a reader reads them.
 *
 * `calculate-borrowing-capacity` stores seventeen assumption strings
 * (`assumptionItems`, `index.ts`) and the Snapshot printed every one verbatim,
 * under the engine's own keys. Read off two production documents on
 * 28 Sep 2026:
 *
 *  - "Serviceability Basis — After-Tax of SHADED (assessable) income";
 *    "DTI Denominator (APS 220)"; "Existing Loan Stress Rate — P&I at 9.50%
 *    (max of policy 9.5% and assessment rate 9.50%)" — the machine room.
 *  - "$192,378.24/yr" and "$137,462.8/yr" beside "$192,378" two pages away,
 *    and "$1000/mo" with no separator.
 *  - Buffer rate, assessment rate and loan term printed twice, a table apart,
 *    once as "3.00%" and once as "3%".
 *  - "Conservative Surplus Floor $1000/mo (zeroed below)" on an assessment run
 *    in bank mode, where no floor applied; "Marginal Tax Rate 0%" and
 *    "DTI Denominator $0/yr" on a record with no income.
 *
 * So each key the engine writes has a reading here: a label in the report's
 * words, a value tidied, and a rule for when it is worth printing at all. A
 * figure the document states elsewhere (assessable and after-tax income are in
 * the working; buffer, rate and term are in the terms) is not repeated. A key
 * this module does not know is printed as it came, title-cased — an assumption
 * nobody reads is worse than one read in the engine's words.
 *
 * Pure: no clock, no I/O.
 */

/** What the curation depends on, read from the rest of the record. */
export interface BasisFacts {
  /** Gross income. Zero means no income was recorded. */
  grossIncome: number;
  /** `bank` or `conservative`, as the assessment stored it. */
  calculationMode: string | null;
  /** Whether any liability on the record is a credit card. */
  hasCreditCard: boolean;
  /** Whether any income component comes from property. */
  hasPropertyIncome: boolean;
  /** Whether the document states a DTI at all. */
  showsDti: boolean;
}

export interface BasisRow {
  label: string;
  value: string;
}

/** `After-Tax Income Used` → `aftertaxincomeused`. Keys are matched loosely. */
const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** `1234567` → `1,234,567`. By hand: `toLocaleString` depends on the runtime's ICU build. */
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** `$192,378.24` → `$192,378`; `$1000` → `$1,000`. */
export function tidyMoney(text: string): string {
  return text.replace(/\$\s?(\d[\d,]*)(\.\d+)?/g, (_m, whole: string, frac: string | undefined) => {
    const n = Number(whole.replace(/,/g, '')) + (frac ? Number(frac) : 0);
    return Number.isFinite(n) ? `$${grouped(Math.round(n))}` : _m;
  });
}

/** `/yr` → ` a year`, `/mo` → ` a month`, in prose values. */
const perPeriod = (text: string) =>
  text.replace(/\/yr\b/g, ' a year').replace(/\/mo\b/g, ' a month');

/** The first percentage in a string, as written: `P&I at 9.50% (…)` → `9.50%`. */
const firstPercent = (text: string) => /(\d+(?:\.\d+)?)\s?%/.exec(text)?.[1] ?? null;

/**
 * One entry per engine key.
 *
 * `null` from `read` means "do not print this": a figure stated elsewhere, a
 * setting that did not apply, or a value that says nothing on this record.
 */
const READINGS: Record<string, (value: string, f: BasisFacts) => BasisRow | null> = {
  policyprofile: (v) => ({
    label: 'Lender policy',
    value: v === 'Default APRA' ? 'Standard (APRA serviceability buffer)' : v,
  }),
  serviceabilitybasis: () => ({
    label: 'Serviceability',
    value: 'After tax, on the income a lender counts',
  }),
  // Stated in the assessment terms, a table away.
  bufferrate: () => null,
  assessmentrate: () => null,
  loanterm: () => null,
  hembenchmark: (v) => ({
    label: 'HEM living-expense benchmark',
    value: perPeriod(tidyMoney(v.replace(/\s*\(income-scaled\)\s*/i, ''))) + (/income-scaled/i.test(v) ? ', scaled to income' : ''),
  }),
  repaymenttype: (v) => ({
    label: 'Repayments assessed as',
    value: /principal\s*&\s*interest/i.test(v) ? 'Principal and interest' : v,
  }),
  rentalexpenseratio: (v, f) => (f.hasPropertyIncome
    ? { label: 'Rental expenses allowed', value: `${v.trim()} of rent` }
    : null),
  existingloanstressrate: (v) => {
    const pct = firstPercent(v);
    return {
      label: 'Existing loans assessed at',
      value: pct ? `${Number(pct).toFixed(2)}%, principal and interest` : v,
    };
  },
  taxyear: (v) => {
    const m = /^(\d{4})-(\d{2})\s*\(incl\.\s*([\d.]+%)\s*Medicare Levy\)$/i.exec(v.trim());
    return {
      label: 'Tax rates',
      value: m ? `${m[1]}–${m[2]}, including the ${m[3]} Medicare levy` : v,
    };
  },
  // Both are figures of the working, which prints them from the same record.
  assessableincomeshaded: () => null,
  aftertaxincomeused: () => null,
  dtidenominatoraps220: (v, f) => (f.showsDti
    ? { label: 'Income used for the debt-to-income ratio', value: perPeriod(tidyMoney(v)) }
    : null),
  marginaltaxrate: (v, f) => (f.grossIncome > 0 && firstPercent(v) !== '0'
    ? { label: 'Marginal tax rate', value: v.trim() }
    : null),
  stresstestincrement: (v) => {
    const pct = firstPercent(v);
    return {
      label: 'Stress test',
      value: pct ? `+${Number(pct).toFixed(2)}% on the assessment rate` : v,
    };
  },
  creditcardservicing: (v, f) => (f.hasCreditCard
    ? { label: 'Credit cards serviced at', value: v.replace(/\bof limit\b/i, 'of the limit, a month') }
    : null),
  // Applies only in conservative mode, where a surplus under the floor is
  // zeroed. On a bank-mode assessment nothing was floored.
  conservativesurplusfloor: (v, f) => (f.calculationMode === 'conservative'
    ? { label: 'Minimum surplus (conservative policy)', value: perPeriod(tidyMoney(v.replace(/\s*\(zeroed below\)\s*/i, ''))) }
    : null),
};

/** `credit_card` → `Credit Card`, `hem_benchmark` → `HEM Benchmark`. */
function fallbackLabel(key: string, titleCase: (s: string) => string): string {
  return titleCase(key);
}

/**
 * The curated basis.
 *
 * `items` is the stored list — `{ key, value }` as the engine writes it. The
 * caller passes `titleCase` so an unknown key is cased by the same rule the
 * rest of the document uses.
 */
export function curateBasis(
  items: readonly { key: string; value: string }[],
  facts: BasisFacts,
  titleCase: (s: string) => string,
): BasisRow[] {
  const out: BasisRow[] = [];
  const seen = new Set<string>();
  for (const { key, value } of items) {
    const k = keyOf(key);
    if (seen.has(k)) continue;
    seen.add(k);
    const read = READINGS[k];
    const row = read
      ? read(value, facts)
      : { label: fallbackLabel(key, titleCase), value: tidyMoney(value) };
    if (row && row.value.trim()) out.push(row);
  }
  return out;
}

/**
 * The after-tax income the engine used, read from its own assumption string.
 *
 * The row does not store it as a number — only as `"$137,462.8/yr (on shaded
 * income)"` — and it is the figure the monthly surplus is built from, so the
 * working cannot foot without it. Read, never recomputed: a recomputation runs
 * today's tax table against a row written under last year's.
 */
export function afterTaxIncomeFrom(items: readonly { key: string; value: string }[]): number | null {
  return moneyFrom(items, 'aftertaxincomeused');
}

/** The income the DTI was divided by (APS 220), when the engine recorded it. */
export function dtiDenominatorFrom(items: readonly { key: string; value: string }[]): number | null {
  return moneyFrom(items, 'dtidenominatoraps220');
}

/** The stress-test increment in percentage points, when recorded. */
export function stressIncrementFrom(items: readonly { key: string; value: string }[]): number | null {
  const item = items.find((i) => keyOf(i.key) === 'stresstestincrement');
  const pct = item ? firstPercent(item.value) : null;
  const n = pct === null ? NaN : Number(pct);
  return Number.isFinite(n) ? n : null;
}

function moneyFrom(items: readonly { key: string; value: string }[], key: string): number | null {
  const item = items.find((i) => keyOf(i.key) === key);
  if (!item) return null;
  const m = /\$\s?(\d[\d,]*(?:\.\d+)?)/.exec(item.value);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
