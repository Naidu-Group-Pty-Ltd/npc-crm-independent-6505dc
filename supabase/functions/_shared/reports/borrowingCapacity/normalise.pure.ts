/**
 * Raw records in, one `BorrowingCapacitySnapshot` out.
 *
 * Today this normalisation exists three times — inline in the draw loop of
 * `BorrowingCapacityPDFReport.tsx`, and again in private adapters inside
 * `borrowingCapacityPdfSections.ts` and `borrowingCapacityPdfLibSections.ts`.
 * All three are the same four-deep `||` fallback chain, copied. They agree on
 * the field names (`BORROWING_CAPACITY.md` F9), which means they also agree on
 * the bug: `||` treats a legitimate `0` as absent, so income the lender does
 * not count at all is reported to the client as fully assessed (F10).
 *
 * This module is that chain, written once, with `??`.
 *
 * It is pure: no fetch, no clock, no `Math.random`. Everything that varies
 * between runs is an argument. That is what lets a test assert on a whole
 * document without rendering one.
 */

import { composeAdvisorSection } from './strategyRationale.pure.ts';
import type { Measure } from '../../reportDesign/measure.pure.ts';
import {
  aud,
  audPerMonth,
  audPerYear,
  count,
  formatMeasure,
  percent,
  rate,
  ratio,
  years,
} from '../../reportDesign/measure.pure.ts';
import type { AuditCategory, RawAuditEntry } from './audit.pure.ts';
import { auditDelta, auditDirection, auditMeasures, isKnownAuditAction } from './audit.pure.ts';
import { HIGH_INTEREST_DEBT, presentAdviceList } from './advice.pure.ts';
import {
  afterTaxIncomeFrom,
  curateBasis,
  dtiDenominatorFrom,
  stressIncrementFrom,
} from './basis.pure.ts';
import type {
  AuditRow,
  AuditSection,
  Band,
  BorrowingCapacitySnapshot,
  DebtToIncome,
  ExplanationSection,
  IncomeRow,
  LedgerRow,
  LiabilityRow,
  LmiSection,
  ScenarioRow,
  UtilisationSection,
} from './payload.pure.ts';

// ── Reading untyped records safely ──────────────────────────────────────────

type Rec = Record<string, unknown>;

const asRec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * A finite number, or `null`.
 *
 * `null` rather than `0`, because those are different facts and the whole point
 * of this module is to stop conflating them. Numeric strings are accepted —
 * `numeric` columns arrive as strings through some client paths.
 */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** The first argument that is a real number. Zero counts. */
function firstNum(...values: unknown[]): number | null {
  for (const v of values) {
    const n = num(v);
    if (n !== null) return n;
  }
  return null;
}

/** The first argument that is a non-empty string. */
function firstText(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

const asStringList = (v: unknown): string[] =>
  asArray(v)
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      const text = firstText(asRec(item).text, asRec(item).message, asRec(item).label);
      return text ?? '';
    })
    .filter((s) => s.length > 0);

/**
 * Terms that are acronyms, not words.
 *
 * Without this, `hem_benchmark` title-cases to "Hem Benchmark" — which is what
 * the first render of this document printed, and it reads as a surname.
 */
const ACRONYMS = new Set(['hem', 'lvr', 'lmi', 'dti', 'payg', 'hecs', 'abn', 'apra', 'p&i', 'io', 'ppr']);

/** `credit_card` → `Credit Card`; `hem_benchmark` → `HEM Benchmark`. */
export function titleCase(s: string): string {
  return s
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .map((word) => (ACRONYMS.has(word.toLowerCase())
      ? word.toUpperCase()
      : word.replace(/^\w/, (c) => c.toUpperCase())))
    .join(' ');
}

// ── Inputs ──────────────────────────────────────────────────────────────────

/**
 * A `borrowing_capacity_assessments` row. Every field optional because the row
 * really is that permissive — half the columns are nullable and two of the
 * things the report renders are not columns at all.
 */
export type AssessmentRow = Rec;

export interface SnapshotSource {
  /** Already cased for display. Casing rules live with the caller, not here. */
  clientName: string;
  assessment: AssessmentRow;
  /**
   * The audit trail.
   *
   * **Not a column.** `calculate-borrowing-capacity` computes it and returns it
   * in the response, but its `insert` does not persist it — so every generator
   * that reads it off the stored row gets `undefined`, and the audit page has
   * never appeared in a shipping PDF (F12). It is a parameter here precisely so
   * the caller has to decide where it comes from.
   */
  auditTrail?: unknown;
  /** Same story as `auditTrail`: computed, returned, never stored. */
  explanation?: unknown;
  /** Saved what-if presets, when the export came from the scenario modeller. */
  scenarioPresets?: unknown;
  /** ISO-8601 fallback when the row has no `created_at`. Passed in so this stays pure. */
  now?: string;
}

// ── Band ────────────────────────────────────────────────────────────────────

/**
 * The row stores a colour name. Map it to the judgement it stands for; anything
 * unrecognised is `limited`, which is the cautious reading.
 */
export function toBand(stored: unknown): Band {
  switch (typeof stored === 'string' ? stored.toLowerCase() : '') {
    case 'green':
    case 'strong':
      return 'strong';
    case 'amber':
    case 'moderate':
      return 'moderate';
    default:
      return 'limited';
  }
}

// ── Breakdown rows ──────────────────────────────────────────────────────────

/**
 * One income component.
 *
 * The producer (`calculateIncomeBreakdown`) writes
 * `{ component, grossAmount, shadingRate, shadedAmount }` with `shadingRate` a
 * **0–1 fraction**. The older `client_income_sources` shape is also accepted
 * because rows written before that producer existed are still in the table.
 */
export function toIncomeRow(raw: unknown): IncomeRow | null {
  const r = asRec(raw);
  const gross = firstNum(r.grossAmount, r.gross_annual_amount, r.input_amount);
  if (gross === null) return null;

  // `??`, not `||`: a shading rate of 0 is a lender counting none of this
  // income, and the report must say 0%, not fall through to 100%.
  const shadingRate = firstNum(r.shadingRate, r.custom_shading_rate, r.default_shading_rate) ?? 1;
  const shaded = firstNum(r.shadedAmount, r.shaded_amount) ?? gross * shadingRate;

  return {
    label: incomeLabel(firstText(r.component, r.source_name, r.label, r.source_type) ?? 'Income'),
    gross: audPerYear(gross),
    shading: rate(shadingRate),
    shaded: audPerYear(shaded),
  };
}

/**
 * The width the engine cuts a property address to in an income label.
 *
 * `calculateIncomeBreakdown` writes `Positive Cash Flow (${address.substring(0, 30)}...)`
 * — the ellipsis appended whether or not anything was cut — and the page
 * printed it as written: "Positive Cash Flow (37 Fairview Street Gunnedah, 2...)",
 * a postcode's first digit and three dots, in the first column of the table a
 * client reads their income from.
 */
export const ENGINE_ADDRESS_CUT = 30;

const POSITIVE_CASH_FLOW = /^Positive Cash Flow \((.*?)(\.\.\.|…)?\)$/;

/**
 * An income component's label, as a reader reads it.
 *
 * Only the engine's property label is rewritten; every other label is the
 * record's own words. The address keeps what the engine kept — nothing is
 * looked up. A label is taken to have been CUT only when it carries the
 * engine's ellipsis and exactly `ENGINE_ADDRESS_CUT` characters of address
 * (a shorter one carried the ellipsis with nothing removed); then the partial
 * last segment — "2", the first digit of a postcode — is dropped at the last
 * comma, or failing that the last space, so what prints is a whole place name
 * rather than a fragment of one. The engine writes the whole address since
 * 28 Sep 2026, with no ellipsis, and that label is left whole.
 */
export function incomeLabel(raw: string): string {
  const m = POSITIVE_CASH_FLOW.exec(raw.trim());
  if (!m) return raw;
  const address = engineAddress(m[1], Boolean(m[2]) && m[1].length === ENGINE_ADDRESS_CUT);
  return address && address !== 'Property'
    ? `Property cash flow — ${address}`
    : 'Property cash flow';
}

/**
 * An address the engine wrote into a label, as a whole place name.
 *
 * Where the engine CUT it, the partial last segment — "2", the first digit of
 * a postcode — is dropped at the last comma, or failing that the last space.
 * Nothing is looked up: the address keeps only what the engine kept.
 */
function engineAddress(raw: string, cut: boolean): string {
  let address = raw.trim();
  if (cut) {
    const comma = address.lastIndexOf(',');
    const space = address.lastIndexOf(' ');
    const at = comma > 0 ? comma : space > 0 ? space : address.length;
    address = address.slice(0, at).trim();
  }
  return address.replace(/[\s,]+$/, '');
}

const RENT_EXPENSE = /^Rent Expense \((.*?)(\.\.\.|…)?\)$/;

/**
 * A liability's kind, as a reader reads it.
 *
 * `calculateLiabilityBreakdown` writes the rent a household pays on the home it
 * lives in as `Rent Expense (${address.substring(0, 30)}...)` — the same cut,
 * and the same ellipsis appended whether or not anything was cut, that the
 * income label carried (`incomeLabel`) — so a client who rents read their
 * liabilities table as "Rent Expense (14 Wattle Grove Sampleton, NSW...)".
 * It reads "Rent — 14 Wattle Grove Sampleton" now; every other kind is the
 * record's own word, title-cased.
 */
export function liabilityKindLabel(raw: string): string {
  const m = RENT_EXPENSE.exec(raw.trim());
  if (!m) return titleCase(raw);
  const address = engineAddress(m[1], Boolean(m[2]) && m[1].length === ENGINE_ADDRESS_CUT);
  return address && address !== 'Rental' ? `Rent — ${address}` : 'Rent';
}

/**
 * The expense method, named for a reader.
 *
 * The engine stores `hem`, `declared_higher` (declared, because it was above
 * the benchmark) and `declared` (an amount entered with the assessment), and
 * rows older than it hold `hybrid`. "HEM" alone on a client's page is an
 * acronym with no noun.
 */
export function expenseMethodLabel(stored: string | null): string {
  switch ((stored ?? '').toLowerCase()) {
    case 'hem': return 'HEM benchmark';
    case 'declared_higher': return 'Declared (above HEM)';
    case 'declared': return 'Declared';
    // "Hybrid" is the stored word for the rule, not a reading of it (§21).
    case 'hybrid': return 'Higher of HEM and declared';
    case '': return 'HEM benchmark';
    default: return titleCase(stored ?? '');
  }
}

/** One liability. `balance` stays `null` when there is none — a $0 balance is a fact. */
export function toLiabilityRow(raw: unknown): LiabilityRow | null {
  const r = asRec(raw);
  const servicing = firstNum(r.monthlyServicing, r.monthly_repayment, r.monthly_servicing);
  const balance = firstNum(r.balance, r.current_balance);
  if (servicing === null && balance === null) return null;

  const kindText = firstText(r.type, r.liability_type) ?? 'Liability';
  const provider = firstText(r.label, r.provider_name, r.provider);
  const kind = liabilityKindLabel(kindText);
  const limit = firstNum(r.limit, r.credit_limit);

  return {
    kind,
    // The producer writes the provider into `label`; when it holds the same
    // text as the kind there is nothing to add and repeating it reads badly.
    provider: provider && provider !== kind && provider !== kindText ? provider : null,
    balance: balance === null ? null : aud(balance),
    limit: limit === null ? null : aud(limit),
    monthlyServicing: audPerMonth(servicing ?? 0),
    note: firstText(r.calculationNote, r.note),
  };
}

// ── Audit ───────────────────────────────────────────────────────────────────

/** The order the report groups audit entries in. */
export const AUDIT_CATEGORY_ORDER: readonly AuditCategory[] = [
  'income',
  'tax',
  'expense',
  'property',
  'liability',
  'constraint',
  'policy',
];

/**
 * The width the engine cuts a property address to in the label of a
 * negatively geared property's audit entry — `Neg CF: ${address.substring(0, 40)}`,
 * cut with no ellipsis to say so (`calculateNegativePropertyCashFlows`).
 */
export const ENGINE_SHORTFALL_ADDRESS_CUT = 40;

const NEG_CF = /^Neg CF:\s*(.*)$/i;

const SHORTFALL_LABEL = 'Property costs not covered by rent';

/**
 * Every audit entry's label, in the report's words, keyed `category/action` as
 * `audit.pure.ts` keys its units and polarity.
 *
 * The engine labels its entries for a log: "Income Tax" over a row whose two
 * values are income before and after tax, "Medicare Levy" beside it as though
 * it were charged on top, "Neg CF: 22 Example Road…" for a property's
 * shortfall. Each reads here as what the row actually holds, so the row needs
 * no category beside it to be understood (`render.pure.ts` prints none).
 * `normalise.spec.ts` fails on a known action with no reading here, so a new
 * entry the engine grows surfaces as a red test, not as a log's word on a
 * client's page.
 */
export const AUDIT_LABEL: Readonly<Record<string, (label: string) => string>> = {
  'income/shading_applied': (label) => incomeLabel(label),
  'tax/tax_calculated': () => 'Income after tax and the Medicare levy',
  'tax/medicare_levy_applied': () => 'Medicare levy, within the tax above',
  'expense/hem_benchmark_applied': () => 'Living expenses',
  'expense/declared_expenses_used': () => 'Living expenses',
  'expense/override_applied': () => 'Living expenses',
  'property/negative_cf_layered': (label) => {
    const m = NEG_CF.exec(label.trim());
    const address = m ? engineAddress(m[1], m[1].length >= ENGINE_SHORTFALL_ADDRESS_CUT) : '';
    return address && address !== 'Investment Property' ? `${SHORTFALL_LABEL} — ${address}` : SHORTFALL_LABEL;
  },
  'liability/credit_card_limit_rate': (label) => liabilityKindLabel(label),
  'liability/hecs_threshold_applied': (label) => liabilityKindLabel(label),
  'liability/pi_conversion': (label) => liabilityKindLabel(label),
  'liability/assessment_rate_applied': (label) => liabilityKindLabel(label),
  'policy/lender_profile_selected': () => 'Lender policy',
  'policy/override_applied': (label) => (/buffer/i.test(label)
    ? 'Servicing buffer'
    : /interest/i.test(label) ? 'Interest rate' : label),
  'constraint/lmi_capitalised': () => 'Lenders mortgage insurance, added to the loan',
  'constraint/stress_test_applied': () => 'Stress test',
};

const PERCENT_RULE = (suffix: string) => new RegExp(`^\\+?(\\d+(?:\\.\\d+)?)%\\s*${suffix}$`, 'i');

/**
 * Every audit entry's rule, in the report's words.
 *
 * The engine's rules are a log's shorthand — "$2450/mo servicing" with no
 * thousands separator, "Layered on expenses", "+1% above assessment" — and the
 * living-expense rule is not even the engine's to state: the Calculator sends
 * the figure its chosen method produced as an explicit amount, so the engine
 * wrote "Method: Declared" over a client who declared $0 and was assessed on
 * HEM, while the same document's terms said "HEM benchmark". That row takes
 * the document's own reading of the method (`expenseMethod`), so the two cannot
 * disagree. A rule this module cannot read is printed as written.
 */
export function auditRule(category: string, action: string, rule: string, expenseMethod: string | null): string {
  const key = `${category}/${action}`;
  const text = rule.trim();
  const pct = (suffix: string) => PERCENT_RULE(suffix).exec(text)?.[1] ?? null;
  switch (key) {
    case 'income/shading_applied': {
      const n = pct('shading');
      return n !== null ? `${n}% counted` : text;
    }
    case 'tax/tax_calculated': {
      const n = pct('effective rate');
      return n !== null ? `${n}% of assessable income` : text;
    }
    case 'tax/medicare_levy_applied': {
      const n = pct('of gross');
      return n !== null ? `${n}% of gross income` : text;
    }
    case 'expense/hem_benchmark_applied':
    case 'expense/declared_expenses_used':
    case 'expense/override_applied': {
      if (expenseMethod) return expenseMethod;
      const m = /^Method:\s*(.+)$/i.exec(text);
      return m ? expenseMethodLabel(m[1].trim().toLowerCase().replace(/\s+/g, '_')) : text;
    }
    case 'property/negative_cf_layered':
      return 'Added to living expenses';
    case 'liability/credit_card_limit_rate':
      return 'Serviced on the card limit';
    case 'liability/hecs_threshold_applied':
      return 'Repayment set by income';
    case 'liability/pi_conversion':
      return 'Assessed as principal and interest';
    case 'liability/assessment_rate_applied':
      return 'Assessed repayment';
    case 'policy/override_applied':
      return /^manual override$/i.test(text) ? 'Set by the adviser' : text;
    case 'constraint/lmi_capitalised': {
      const m = /^\+?\$(\d+(?:\.\d+)?)\/mo servicing$/i.exec(text);
      return m ? `Adds ${formatMeasure(audPerMonth(Number(m[1])))} of servicing` : text;
    }
    case 'constraint/stress_test_applied': {
      const n = pct('above assessment');
      return n !== null ? `At the assessment rate plus ${n}%` : text;
    }
    default:
      return text;
  }
}

function toAuditRow(raw: unknown, expenseMethod: string | null): AuditRow | null {
  const r = asRec(raw);
  const category = typeof r.category === 'string' ? (r.category as AuditCategory) : null;
  const action = typeof r.action === 'string' ? r.action : null;
  if (!category || !action) return null;

  const entry: RawAuditEntry = {
    seq: num(r.seq) ?? 0,
    category,
    action,
    label: firstText(r.label) ?? titleCase(action),
    rawValue: num(r.rawValue) ?? 0,
    assessedValue: num(r.assessedValue) ?? 0,
    rule: firstText(r.rule) ?? '',
    impact: r.impact === 'increase' || r.impact === 'decrease' ? r.impact : 'neutral',
    delta: num(r.delta) ?? 0,
    note: firstText(r.note) ?? undefined,
  };

  const { raw: rawMeasure, assessed } = auditMeasures(entry);
  const label = AUDIT_LABEL[`${category}/${action}`];
  return {
    seq: entry.seq,
    label: label ? label(entry.label) : entry.label,
    category,
    action,
    rule: auditRule(category, action, entry.rule, expenseMethod),
    note: entry.note ?? null,
    raw: rawMeasure,
    assessed,
    delta: auditDelta(entry),
    direction: auditDirection(entry),
    known: isKnownAuditAction(category, action),
  };
}

/**
 * The audit trail as the report reads it.
 *
 * `expenseMethod` is the document's own reading of the living-expense method
 * (`expenseMethodLabel` of the stored column), for the rule of the
 * living-expense row (`auditRule`).
 */
export function toAuditSection(raw: unknown, opts: { expenseMethod?: string | null } = {}): AuditSection | null {
  const trail = asRec(raw);
  const rows = asArray(trail.entries)
    .map((entry) => toAuditRow(entry, opts.expenseMethod ?? null))
    .filter((r): r is AuditRow => r !== null)
    .sort((a, b) => a.seq - b.seq);
  if (rows.length === 0) return null;

  const summary = asRec(trail.summary);
  const groups = AUDIT_CATEGORY_ORDER.map((category) => ({
    category,
    rows: rows.filter((r) => r.category === category),
  })).filter((g) => g.rows.length > 0);

  // Any category the engine grows that this module has not been told about
  // still reaches the page, appended after the known ones.
  const seen = new Set<string>(AUDIT_CATEGORY_ORDER);
  for (const row of rows) {
    if (seen.has(row.category)) continue;
    seen.add(row.category);
    groups.push({ category: row.category, rows: rows.filter((r) => r.category === row.category) });
  }

  return {
    groups,
    // The engine's four category totals are not read. Its liability "total"
    // is the sum of each liability's monthly repayment less its BALANCE
    // ($417,550 against a $420,000 mortgage — F13 again, one level up), and
    // its tax total adds the Medicare levy to an after-tax figure that already
    // nets it. The summary strip that printed them is gone (§21); the count
    // is the one figure here that means what it says.
    summary: {
      transformations: count(num(summary.totalTransformations) ?? rows.length),
    },
  };
}

// ── Explanation ─────────────────────────────────────────────────────────────

export function toExplanationSection(raw: unknown): ExplanationSection | null {
  const report = asRec(raw);
  const steps = asArray(report.steps)
    .map((rawStep) => {
      const s = asRec(rawStep);
      const title = firstText(s.title);
      if (!title) return null;
      return {
        title,
        narrative: firstText(s.narrative, s.detail) ?? '',
        // The engine has already formatted these into strings; there is no
        // unit left to recover, so they travel as prose. Phase 2's job is to
        // stop the engine formatting them in the first place.
        figures: asArray(s.figures)
          .map((rawFig) => {
            const f = asRec(rawFig);
            const label = firstText(f.label);
            const value = num(f.value);
            if (!label || value === null) return null;
            return { label, value: aud(value) };
          })
          .filter((f): f is { label: string; value: Measure } => f !== null),
      };
    })
    .filter((s): s is { title: string; narrative: string; figures: { label: string; value: Measure }[] } => s !== null);

  const headline = firstText(report.headline, report.summary);
  if (steps.length === 0 && !headline) return null;
  return { headline, steps };
}

// ── Scenarios ───────────────────────────────────────────────────────────────

/**
 * Describe how a scenario's inputs differ from the base case.
 *
 * Every comparison is guarded on **both** sides being real numbers. The
 * shipping generator subtracts unguarded, so a preset that carries a field the
 * base case does not prints `Rate NaN%`. It cannot happen with a well-formed
 * preset — `adjustedInputs` is typed as a whole `BorrowingCapacityInput` — but
 * "the type says it cannot happen" is not a reason to subtract `undefined`.
 */
export function describeAdjustments(baseInputs: unknown, scenarioInputs: unknown): string[] {
  const base = asRec(baseInputs);
  const scenario = asRec(scenarioInputs);
  const out: string[] = [];

  const relative = (field: string, label: string) => {
    const b = num(base[field]);
    const s = num(scenario[field]);
    if (b === null || s === null || b === 0 || b === s) return;
    const change = percent(((s - b) / b) * 100, 0);
    out.push(`${label} ${change.value > 0 ? '+' : ''}${formatMeasure(change)}`);
  };

  const absolute = (field: string, label: string, make: (v: number) => Measure) => {
    const b = num(base[field]);
    const s = num(scenario[field]);
    if (b === null || s === null || b === s) return;
    const delta = make(s - b);
    out.push(`${label} ${delta.value > 0 ? '+' : ''}${formatMeasure(delta)}`);
  };

  // A rate is stated from and to. "Rate +1.00%" beside "Income +10%" put a
  // change in percentage points next to a relative change in the same notation,
  // and the two cannot be told apart on the page (§21).
  const fromTo = (field: string, label: string, make: (v: number) => Measure) => {
    const b = num(base[field]);
    const s = num(scenario[field]);
    if (b === null || s === null || b === s) return;
    out.push(`${label} ${formatMeasure(make(b))} → ${formatMeasure(make(s))}`);
  };

  relative('grossAnnualIncome', 'Income');
  relative('monthlyLivingExpenses', 'Living expenses');
  absolute('monthlyCommitments', 'Commitments', (v) => audPerMonth(v));
  fromTo('interestRate', 'Interest rate', (v) => percent(v));
  fromTo('loanTermYears', 'Loan term', (v) => years(v));

  return out;
}

function toScenarioRow(raw: unknown, baseCapacity: number | null, baseInputs: unknown): ScenarioRow | null {
  const preset = asRec(raw);
  const result = asRec(preset.result);
  const capacity = num(result.borrowingCapacity);
  if (capacity === null) return null;

  const isBase = preset.isBase === true;
  const change = !isBase && baseCapacity !== null ? aud(capacity - baseCapacity) : null;

  const details: string[] = [];
  const adjustments = isBase ? [] : describeAdjustments(baseInputs, preset.adjustedInputs);
  // A rate lever is the same fact as the rate change the adjustments already
  // print, so it is not listed again as a strategy action — the rate-rise
  // scenario read "Changed: Rate +1.00%" over "Strategy actions: Interest rate
  // (1.00%)" (§21). Every other action is a step the client takes, which the
  // changed inputs do not name.
  const rateShown = adjustments.some((a) => a.startsWith('Interest rate '));
  const deltas = asArray(preset.scenarioDeltas)
    .filter((d) => !(rateShown && asRec(d).type === 'rate_change'));
  if (deltas.length > 0) {
    const described = deltas.slice(0, 5).map((rawDelta) => {
      const d = asRec(rawDelta);
      const label = firstText(d.label) ?? titleCase(firstText(d.type) ?? 'Scenario adjustment');
      const value = num(d.value);
      if (value === null) return label;
      const unit = d.unit === 'percent' ? percent(value) : d.unit === 'ratio' ? ratio(value) : aud(value);
      return `${label} (${formatMeasure(unit)})`;
    });
    details.push(
      `Strategy actions: ${described.join(' · ')}${deltas.length > 5 ? ' · …' : ''}`,
    );
  }

  // Purchase power, against the client's target price where the scenario set
  // one: the in-browser generator always said "target $650,000 met" or "short
  // by …", and this document dropped it, though whether a scenario clears the
  // target is what the scenario is for (§20, §21). A target with neither a
  // "met" nor a shortfall says nothing — never "short by $0".
  const acquisition = asRec(preset.acquisitionCapacity);
  const maxPurchase = num(acquisition.maxPurchasePrice);
  if (maxPurchase !== null) {
    const target = num(acquisition.targetPurchasePrice);
    const shortfall = num(acquisition.shortfallToTarget);
    const againstTarget = target === null || target <= 0
      ? ''
      : acquisition.meetsTarget === true
        ? `, which clears the ${formatMeasure(aud(target))} target`
        : shortfall !== null && shortfall > 0
          ? `, ${formatMeasure(aud(shortfall))} short of the ${formatMeasure(aud(target))} target`
          : '';
    details.push(`Purchase power: up to ${formatMeasure(aud(maxPurchase))}${againstTarget}.`);
  }

  // The advisor's reasoning, read through the same composer the Strategy
  // Rationale uses so the Snapshot and the brief word it identically. A
  // preset is a browser payload, so the fields are read defensively.
  const advisorRaw = asRec(preset.advisorRationale);
  const advisor = isBase ? null : composeAdvisorSection(
    typeof advisorRaw.reasoning === 'string'
      ? {
          scenarioName: firstText(advisorRaw.scenarioName) ?? firstText(preset.name) ?? 'Scenario',
          reasoning: advisorRaw.reasoning,
          executionRisk: advisorRaw.executionRisk === 'low' || advisorRaw.executionRisk === 'medium' || advisorRaw.executionRisk === 'high'
            ? advisorRaw.executionRisk
            : null,
          evidenceRequired: asArray(advisorRaw.evidenceRequired).filter((e): e is string => typeof e === 'string'),
          rejectedLevers: asArray(advisorRaw.rejectedLevers).map((r) => {
            const rec = asRec(r);
            return { lever: firstText(rec.lever) ?? '', reason: firstText(rec.reason) ?? '' };
          }),
          adjustedSince: advisorRaw.adjustedSince === true,
        }
      : null,
  );

  return {
    name: firstText(preset.name) ?? 'Scenario',
    capacity: aud(capacity),
    monthlySurplus: audPerMonth(num(result.monthlySurplus) ?? 0),
    band: toBand(result.serviceabilityBand),
    change,
    adjustments,
    details,
    ...(advisor ? { advisor } : {}),
  };
}

export function toScenarioRows(raw: unknown): ScenarioRow[] | null {
  const presets = asArray(raw);
  const base = presets.find((p) => asRec(p).isBase === true);
  const others = presets.filter((p) => asRec(p).isBase !== true);
  if (others.length === 0) return null;

  const baseCapacity = num(asRec(asRec(base).result).borrowingCapacity);
  const baseInputs = asRec(base).adjustedInputs;

  const rows: ScenarioRow[] = [];
  const baseRow = base ? toScenarioRow(base, null, baseInputs) : null;
  if (baseRow) rows.push(baseRow);
  for (const preset of others) {
    const row = toScenarioRow(preset, baseCapacity, baseInputs);
    if (row) rows.push(row);
  }
  return rows.length > 0 ? rows : null;
}

// ── Footing ─────────────────────────────────────────────────────────────────

/**
 * The smallest difference a reader can see. Both sides are sums of unrounded
 * figures, so lines that agree to the cent are the same figure.
 */
export const FOOTING_TOLERANCE = 1;

export const PROPOSED_RENT_LABEL = 'Proposed property rent';
export const CAPITALISED_LMI_LABEL = 'Lenders mortgage insurance, added to the loan';

/**
 * The proposed property's rent, as the calculator counts it.
 *
 * `BorrowingCapacityModal` adds the rent to the gross income it sends, and
 * `gross × (1 − vacancy) × shading − 12 × the interest-only offset`, floored at
 * nothing, to the assessed income. It stores the setting with the assessment
 * (`assumptions.proposedRentalIncome`) exactly when it did so. The engine's
 * breakdown is read from the client's records and never lists the rent, so the
 * income table of a client assessed with one fell short of its own total by
 * this line (§21). Null where no rent was proposed, or the setting cannot say
 * what was counted.
 */
export function proposedRentRow(raw: unknown): IncomeRow | null {
  const r = asRec(raw);
  const amount = num(r.inputAmount);
  const shading = num(r.shadingRate);
  if (amount === null || amount <= 0 || shading === null) return null;
  const perYear = r.frequency === 'weekly' ? 52 : r.frequency === 'monthly' ? 12 : 1;
  const gross = amount * perYear;
  const vacancy = num(r.vacancyRate) ?? 0;
  const offsetMonthly = num(r.interestOnlyOffset) ?? 0;
  const assessed = Math.max(0, gross * (1 - vacancy / 100) * shading - offsetMonthly * 12);
  return {
    label: PROPOSED_RENT_LABEL,
    gross: audPerYear(gross),
    // The share counted, after the vacancy and the offset as well as the
    // shading — the column is headed "Assessed at", not "Shading".
    shading: rate(assessed / gross),
    shaded: audPerYear(assessed),
  };
}

/**
 * The monthly repayment on a premium capitalised onto the loan: the premium
 * amortised at the assessment rate over the term. `calculate-borrowing-capacity`
 * adds it to the commitments it assesses and lists no liability for it, so the
 * liabilities table of a client with capitalised LMI fell short of its total by
 * this line (§21). Null where it cannot be computed.
 */
export function capitalisedLmiRepayment(premium: number, assessmentRate: number, loanTermYears: number): number | null {
  const monthly = assessmentRate / 100 / 12;
  const periods = loanTermYears * 12;
  if (!(premium > 0) || !(monthly > 0) || !(periods > 0)) return null;
  const growth = Math.pow(1 + monthly, periods);
  return (premium * monthly * growth) / (growth - 1);
}

/**
 * What the income lines add up to, where it is not what the assessment used.
 *
 * The calculator sends its own totals (`grossAnnualIncome`,
 * `shadedAnnualIncome`) and the engine stores them beside a breakdown it reads
 * from the client's records, so the two can disagree: a figure edited in the
 * calculator, a scenario applied when the assessment was run. A total row its
 * rows do not reach is the one thing a reader can check and find wrong, so the
 * table states both. Null where they agree, or where nothing is itemised.
 */
export function incomeItemsTotal(
  lines: readonly IncomeRow[],
  gross: number,
  shaded: number,
): { gross: Measure; shaded: Measure } | null {
  if (!lines.length) return null;
  const linesGross = lines.reduce((sum, r) => sum + r.gross.value, 0);
  const linesShaded = lines.reduce((sum, r) => sum + r.shaded.value, 0);
  return Math.abs(linesGross - gross) < FOOTING_TOLERANCE && Math.abs(linesShaded - shaded) < FOOTING_TOLERANCE
    ? null
    : { gross: audPerYear(linesGross), shaded: audPerYear(linesShaded) };
}

/**
 * The calculator's "Net for Purchase", where the row's figure is it.
 *
 * Both the calculator and the engine write `max(0, capacity − premium)`; a
 * stored figure that is anything else cannot be accounted for from the page,
 * so it is not printed.
 */
export function provenNetForPurchase(stored: number | null, capacity: number, premium: number): Measure | null {
  if (stored === null) return null;
  return Math.abs(stored - Math.max(0, capacity - premium)) < FOOTING_TOLERANCE ? aud(stored) : null;
}

/** The same for the commitments. */
export function commitmentItemsTotal(lines: readonly LiabilityRow[], commitments: number): Measure | null {
  if (!lines.length) return null;
  const linesTotal = lines.reduce((sum, l) => sum + l.monthlyServicing.value, 0);
  return Math.abs(linesTotal - commitments) < FOOTING_TOLERANCE ? null : audPerMonth(linesTotal);
}

// ── Assumptions ─────────────────────────────────────────────────────────────

/** The column has held an array and an object-with-`items` at different times. */
export function toAssumptions(raw: unknown): { label: string; value: string }[] {
  const source = Array.isArray(raw) ? raw : asArray(asRec(raw).items);
  return source
    .map((item) => {
      const r = asRec(item);
      const label = firstText(r.key, r.label);
      const value = firstText(r.value) ?? (num(r.value) !== null ? String(num(r.value)) : null);
      return label && value ? { label: titleCase(label), value } : null;
    })
    .filter((a): a is { label: string; value: string } => a !== null);
}

// ── The document ────────────────────────────────────────────────────────────

/**
 * Build the whole payload.
 *
 * Never throws. A row missing everything still produces a valid document with
 * zeroes and empty sections — a report that renders and says nothing is
 * recoverable; a report generation that throws in a client's browser is not.
 */
export function buildSnapshot(source: SnapshotSource): BorrowingCapacitySnapshot {
  const a = source.assessment ?? {};

  const grossIncome = num(a.gross_annual_income) ?? 0;
  const shadedIncome = num(a.shaded_annual_income) ?? grossIncome;
  const livingExpenses = num(a.living_expenses_monthly) ?? 0;
  const commitments = num(a.existing_commitments_monthly) ?? 0;
  const capacity = num(a.borrowing_capacity) ?? 0;
  const surplus = num(a.monthly_surplus) ?? 0;
  const interestRate = num(a.interest_rate_used) ?? 0;
  const bufferRate = num(a.buffer_rate) ?? 0;
  // The column is `GENERATED ALWAYS AS (interest_rate_used + buffer_rate)`, but
  // the What-If path builds a synthetic row by hand and sets it directly.
  const assessmentRate = num(a.assessment_rate) ?? interestRate + bufferRate;
  const loanTermYears = num(a.loan_term_years) ?? 30;
  const storedDti = num(a.dti_ratio);
  const stressTested = num(a.stress_tested_capacity);
  const band = toBand(a.serviceability_band);
  // One reading of the living-expense method, for the terms, the expenses and
  // the audit row that applied it (`auditRule`).
  const expenseMethod = expenseMethodLabel(firstText(a.expense_method));

  // No income on the record. The engine still answers — capacity $0, DTI 0.0x,
  // a band — and a document that prints those as an assessment tells a client
  // they were assessed and found wanting, when nothing was assessed.
  const incomeRecorded = grossIncome > 0 || shadedIncome > 0;
  // A ratio over zero income is undefined, not 0.0x (the engine returns 0 when
  // its denominator is 0).
  const dti = incomeRecorded ? storedDti : null;

  const incomeRows = asArray(a.income_breakdown)
    .map(toIncomeRow)
    .filter((r): r is IncomeRow => r !== null);
  const liabilityRows = asArray(a.liability_breakdown)
    .map(toLiabilityRow)
    .filter((r): r is LiabilityRow => r !== null);

  const proposedLoan = num(a.proposed_loan_amount);
  const utilisation: UtilisationSection | null =
    proposedLoan !== null && proposedLoan > 0 && capacity > 0
      ? {
          proposedLoan: aud(proposedLoan),
          capacity: aud(capacity),
          share: rate(proposedLoan / capacity),
          withinCapacity: proposedLoan <= capacity,
        }
      : null;

  const lmiMode = typeof a.lmi_mode === 'string' ? a.lmi_mode : 'none';
  const lmiPremium = num(a.lmi_amount) ?? 0;
  const lmi: LmiSection | null =
    lmiMode !== 'none' && lmiPremium > 0
      ? {
          premium: aud(lmiPremium),
          lvr: num(a.lmi_lvr_trigger) === null ? null : percent(num(a.lmi_lvr_trigger)!, 1),
          propertyValue: num(a.property_value_estimate) === null ? null : aud(num(a.property_value_estimate)!),
          deposit: num(a.deposit_amount) === null ? null : aud(num(a.deposit_amount)!),
          // The calculator's "Net for Purchase": the capacity less the premium,
          // the share of the loan left once the premium is paid. Printed only
          // where the stored figure is that, to the dollar (§21).
          netForPurchase: provenNetForPurchase(num(a.net_purchase_capacity), capacity, lmiPremium),
          mode: lmiMode === 'debt_capitalised' ? 'debt_capitalised' : 'display_deduction',
        }
      : null;

  // ── What the tables add up to (§21) ───────────────────────────────────────
  // The calculator sends its own totals and the engine stores them beside a
  // breakdown read from the client's records. Two lines it adds are recorded
  // elsewhere on the row and are printed as lines; anything still between the
  // printed lines and the totals is stated, never absorbed.
  const proposedRent = proposedRentRow(asRec(a.assumptions).proposedRentalIncome);
  const incomeLines = proposedRent ? [...incomeRows, proposedRent] : incomeRows;
  const lmiRepayment = lmiMode === 'debt_capitalised'
    ? capitalisedLmiRepayment(lmiPremium, assessmentRate, loanTermYears)
    : null;
  const capitalisedLmi: LiabilityRow | null = lmiRepayment === null
    ? null
    : {
        kind: CAPITALISED_LMI_LABEL,
        provider: null,
        balance: aud(lmiPremium),
        limit: null,
        monthlyServicing: audPerMonth(lmiRepayment),
        note: null,
      };
  const commitmentLines = capitalisedLmi ? [...liabilityRows, capitalisedLmi] : liabilityRows;

  // ── What the engine recorded about itself ─────────────────────────────────
  const assumptionsRec = asRec(a.assumptions);
  const assumptionItems = assumptionItemsOf(a.assumptions);
  const calculationMode = firstText(assumptionsRec.calculationMode);
  const afterTaxAnnual = afterTaxIncomeFrom(assumptionItems);
  const stressIncrement = stressIncrementFrom(assumptionItems);

  const ledger = buildLedger({
    grossIncome,
    shadedIncome,
    afterTaxAnnual,
    livingExpenses,
    commitments,
    surplus,
    capacity,
    assessmentRate,
    loanTermYears,
    calculationMode,
  });

  const debtToIncome = buildDebtToIncome({
    dti,
    capacity,
    denominator: dtiDenominatorFrom(assumptionItems) ?? (grossIncome > 0 ? grossIncome : null),
    listedDebt: liabilityRows.reduce((sum, l) => sum + (l.balance?.value ?? 0), 0),
    capitalisedPremium: capitalisedLmi ? lmiPremium : 0,
  });

  const assumptions = assumptionItems.length
    ? curateBasis(assumptionItems, {
        grossIncome,
        calculationMode,
        hasCreditCard: liabilityRows.some((l) => /credit/i.test(l.kind)),
        hasPropertyIncome: incomeRows.some((r) => /property|rent/i.test(r.label)),
        showsDti: dti !== null,
      }, titleCase)
    : [];
  const lenderName = firstText(assumptionsRec.selectedLenderName);

  const adviceFacts = {
    grossIncome,
    commitmentsMonthly: commitments,
    liabilityCount: liabilityRows.length,
    hasHighInterestDebt: liabilityRows.some((l) => HIGH_INTEREST_DEBT.test(l.kind)),
    dti,
    surplusMonthly: surplus,
  };

  return {
    meta: {
      clientName: source.clientName,
      assessedOn: firstText(a.created_at) ?? source.now ?? '',
      assessmentId: firstText(a.id),
      lenderName,
    },
    headline: {
      capacity: aud(capacity),
      monthlySurplus: audPerMonth(surplus),
      band,
      // A stress test of a $0 capacity is a second $0, not a finding.
      stressTested: stressTested === null || capacity <= 0 ? null : aud(stressTested),
      stressRate: stressIncrement === null || capacity <= 0 ? null : percent(assessmentRate + stressIncrement),
      dti: dti === null ? null : ratio(dti),
      assessmentRate: percent(assessmentRate),
      interestRate: percent(interestRate),
      bufferRate: percent(bufferRate),
      loanTerm: years(loanTermYears),
    },
    narrative: buildNarrative({
      clientName: source.clientName,
      capacity,
      assessmentRate,
      loanTermYears,
      surplus,
      dti,
      band,
      incomeRecorded,
      livingExpenses,
      utilisation,
      lmi,
    }),
    utilisation,
    lmi,
    assumptions,
    income: {
      gross: audPerYear(grossIncome),
      shaded: audPerYear(shadedIncome),
      rows: incomeRows,
      proposedRent,
      itemsTotal: incomeRecorded ? incomeItemsTotal(incomeLines, grossIncome, shadedIncome) : null,
      recorded: incomeRecorded,
    },
    debtToIncome,
    expenses: {
      method: expenseMethod,
      monthlyLiving: audPerMonth(livingExpenses),
      monthlyCommitments: audPerMonth(commitments),
      liabilities: liabilityRows,
      capitalisedLmi,
      itemsTotal: commitmentItemsTotal(commitmentLines, commitments),
    },
    ledger,
    recommendations: presentAdviceList(asStringList(a.recommendations), adviceFacts, { leadWithIncome: true }),
    warnings: presentAdviceList(asStringList(a.warnings), adviceFacts),
    explanation: toExplanationSection(source.explanation),
    audit: toAuditSection(source.auditTrail, { expenseMethod }),
    scenarios: toScenarioRows(source.scenarioPresets),
  };
}

/** The stored `{ key, value }` list, in either of the two shapes the column has held. */
function assumptionItemsOf(raw: unknown): { key: string; value: string }[] {
  const source = Array.isArray(raw) ? raw : asArray(asRec(raw).items);
  return source
    .map((item) => {
      const r = asRec(item);
      const key = firstText(r.key, r.label);
      const value = firstText(r.value) ?? (num(r.value) !== null ? String(num(r.value)) : null);
      return key && value ? { key, value } : null;
    })
    .filter((i): i is { key: string; value: string } => i !== null);
}

// ── The working ─────────────────────────────────────────────────────────────

/**
 * From income to capacity, in lines that add up.
 *
 * The first version of this table printed gross income, shaded income, living
 * expenses, commitments and the surplus — and the lines did not reach the
 * surplus. On a production assessment: $192,378 of income, less $2,511 and
 * $2,800 a month, printed beside a surplus of $4,791, which is $5,929 a month
 * short of what those lines imply. Two things were missing, and both are the
 * engine's own arithmetic (`calculateBorrowingCapacity`):
 *
 *  - **Tax.** The surplus is built from after-tax income. The row does not
 *    store it as a number, only inside the assumption the engine writes
 *    ("After-Tax Income Used — $137,462.8/yr"), so it is read from there
 *    (`afterTaxIncomeFrom`) and never recomputed against today's tax table.
 *  - **Property costs.** The engine adds the negative cash flow of properties
 *    held to living expenses (`totalLivingExpenses = livingExpenses +
 *    negativePropertyCashFlows`) and stores only the base figure. In bank mode
 *    that is the whole of the difference, so it is printed as that line.
 *
 * So every line is monthly and the rows foot to the surplus; the capacity is
 * then the surplus as a repayment, with the rate and term in its label rather
 * than as two more rows of a money column. A conservative-mode assessment
 * applies a multiplier and floors, so the difference there is named as the
 * policy's adjustment. Where the after-tax figure was never recorded, or the
 * difference runs the wrong way, nothing is invented: the table falls back to
 * the figures the record holds, which do not claim to add up.
 */
function buildLedger(p: {
  grossIncome: number;
  shadedIncome: number;
  afterTaxAnnual: number | null;
  livingExpenses: number;
  commitments: number;
  surplus: number;
  capacity: number;
  assessmentRate: number;
  loanTermYears: number;
  calculationMode: string | null;
}): LedgerRow[] {
  const capacityLine: LedgerRow = {
    label: `Maximum borrowing capacity (the surplus, repaid at ${formatMeasure(percent(p.assessmentRate))} over ${p.loanTermYears} years)`,
    amount: aud(p.capacity),
    emphasis: 'total',
    direction: 'neutral',
  };
  const surplusLine: LedgerRow = {
    label: 'Monthly surplus',
    amount: audPerMonth(p.surplus),
    emphasis: 'subtotal',
    direction: p.surplus >= 0 ? 'favourable' : 'adverse',
  };

  const monthly = (annual: number) => Math.round(annual / 12);
  const assessedMonthly = monthly(p.shadedIncome);

  if (p.afterTaxAnnual !== null) {
    const afterTaxMonthly = monthly(p.afterTaxAnnual);
    const taxMonthly = assessedMonthly - afterTaxMonthly;
    const residual = afterTaxMonthly - p.livingExpenses - p.commitments - p.surplus;
    // Rounding the annual figures to whole months can leave a dollar either way.
    const foots = residual >= -2;
    if (foots) {
      const rows: LedgerRow[] = [
        { label: 'Assessed income, a month', amount: audPerMonth(assessedMonthly), emphasis: 'normal', direction: 'favourable' },
      ];
      if (taxMonthly > 0) {
        rows.push({ label: 'Less income tax and Medicare levy', amount: audPerMonth(-taxMonthly), emphasis: 'normal', direction: 'adverse' });
      }
      rows.push(
        { label: 'After-tax income', amount: audPerMonth(afterTaxMonthly), emphasis: 'subtotal', direction: 'favourable' },
        { label: 'Less living expenses', amount: audPerMonth(-p.livingExpenses), emphasis: 'normal', direction: 'adverse' },
        { label: 'Less existing commitments', amount: audPerMonth(-p.commitments), emphasis: 'normal', direction: 'adverse' },
      );
      if (residual > 2) {
        rows.push({
          label: p.calculationMode === 'conservative'
            ? 'Less the conservative policy’s adjustments'
            : 'Less property costs not covered by rent',
          amount: audPerMonth(-residual),
          emphasis: 'normal',
          direction: 'adverse',
        });
      }
      rows.push(surplusLine, capacityLine);
      return rows;
    }
  }

  // The record cannot show its working: the figures it holds, stated as such.
  return [
    { label: 'Gross annual income', amount: audPerYear(p.grossIncome), emphasis: 'normal', direction: 'favourable' },
    { label: 'Assessed (shaded) annual income', amount: audPerYear(p.shadedIncome), emphasis: 'normal', direction: 'favourable' },
    { label: 'Living expenses', amount: audPerMonth(-p.livingExpenses), emphasis: 'normal', direction: 'adverse' },
    { label: 'Existing commitments', amount: audPerMonth(-p.commitments), emphasis: 'normal', direction: 'adverse' },
    { ...surplusLine, label: 'Monthly surplus, after tax' },
    capacityLine,
  ];
}

/** The ratio's working, when there is a ratio to explain. */
function buildDebtToIncome(p: {
  dti: number | null;
  capacity: number;
  denominator: number | null;
  listedDebt: number;
  /** A premium capitalised onto the loan: the engine counts it as debt, and nobody owes it yet. */
  capitalisedPremium: number;
}): DebtToIncome | null {
  if (p.dti === null || p.dti <= 0 || p.denominator === null || p.denominator <= 0) return null;
  // The ratio is stored to two decimals, so the debt behind it is known to
  // within half a cent of income per dollar — about ±$1,000 on a $200,000
  // income. Rounded to $10,000 and labelled "about", never stated to the dollar.
  const total = p.dti * p.denominator;
  const existing = Math.max(0, total - p.capacity - p.capitalisedPremium);
  const rounded = Math.round(existing / 10_000) * 10_000;
  return {
    ratio: ratio(p.dti),
    income: audPerYear(p.denominator),
    capacity: aud(p.capacity),
    existingDebt: rounded > 0 ? aud(rounded) : null,
    capitalisedPremium: p.capitalisedPremium > 0 ? aud(p.capitalisedPremium) : null,
    // More than the listed liabilities by a margin rounding cannot explain: the
    // engine also counts the loans on properties held, which that table omits.
    includesPropertyLoans: existing - p.listedDebt > 20_000,
  };
}

/**
 * The executive-summary paragraph.
 *
 * It opens as the shipping report always has, so Phase 5's golden diff compares
 * typography and layout rather than wording — and then says what the figures
 * mean together: that the capacity is the loan the surplus repays, and, where
 * the rating is limited with a positive surplus, that the ratio is what limited
 * it. The figures inside go through `formatMeasure`, so the rate reads `8.65%`
 * and not `$9`.
 */
function buildNarrative(p: {
  clientName: string;
  capacity: number;
  assessmentRate: number;
  loanTermYears: number;
  surplus: number;
  dti: number | null;
  band: Band;
  incomeRecorded: boolean;
  livingExpenses: number;
  utilisation: UtilisationSection | null;
  lmi: LmiSection | null;
}): string {
  if (!p.incomeRecorded) {
    return `No income is recorded for ${p.clientName}, so this assessment cannot produce a borrowing capacity. `
      + `It applied living expenses of ${formatMeasure(aud(p.livingExpenses))} a month against no income, which is `
      + 'why the capacity reads $0. Recording the household’s income and recalculating is what produces a figure.';
  }

  const bandWord = p.band === 'strong' ? 'strong' : p.band === 'moderate' ? 'moderate' : 'limited';
  const rateAndTerm = `an assessment rate of ${formatMeasure(percent(p.assessmentRate))} over ${p.loanTermYears} years`;
  const parts: string[] = [];

  if (p.surplus > 0 && p.capacity > 0) {
    parts.push(
      `Based on the financial information provided, ${p.clientName} has an estimated maximum `
        + `borrowing capacity of ${formatMeasure(aud(p.capacity))}: the loan a monthly surplus of `
        + `${formatMeasure(aud(p.surplus))} repays at ${rateAndTerm}.`,
    );
  } else {
    parts.push(
      `Based on the financial information provided, ${p.clientName} has an estimated maximum `
        + `borrowing capacity of ${formatMeasure(aud(p.capacity))}. Assessed at ${rateAndTerm}, `
        + `the monthly surplus is ${formatMeasure(aud(p.surplus))}, which leaves nothing to repay a new loan.`,
    );
  }

  const dtiText = p.dti === null ? '' : formatMeasure(ratio(p.dti));
  if (p.band === 'limited' && p.surplus > 0 && p.dti !== null) {
    // The engine rates a position limited when the surplus is nil or the ratio
    // is at or above its threshold. With a positive surplus, the ratio is the
    // reason — and a reader seeing "Limited" beside a healthy surplus is owed it.
    parts.push(`Serviceability is assessed as limited because the debt-to-income ratio is ${dtiText}; the surplus itself is positive.`);
  } else {
    parts.push(
      `Serviceability is assessed as ${bandWord}`
        + (p.dti === null ? '.' : `, with a debt-to-income ratio of ${dtiText}.`),
    );
  }

  if (p.utilisation) {
    parts.push(
      `The proposed loan of ${formatMeasure(p.utilisation.proposedLoan)} is `
        + `${formatMeasure(p.utilisation.share)} of the assessed capacity and `
        + `${p.utilisation.withinCapacity ? 'falls within' : 'exceeds'} the limit.`,
    );
  }

  // The calculator's own account of the two modes: a capitalised premium is
  // added to the debt; a deducted one is paid from the loan, so the capacity is
  // unchanged and less of it is left for the purchase. The sentence used to say
  // the deducted premium came from the deposit (§21).
  if (p.lmi) {
    parts.push(
      p.lmi.mode === 'debt_capitalised'
        ? `An estimated Lenders Mortgage Insurance premium of ${formatMeasure(p.lmi.premium)} is added `
          + 'to the loan: the debt-to-income ratio counts it, and its repayment is one of the commitments.'
        : `An estimated Lenders Mortgage Insurance premium of ${formatMeasure(p.lmi.premium)} is paid `
          + 'from the loan, leaving '
          + (p.lmi.netForPurchase ? `${formatMeasure(p.lmi.netForPurchase)} of the capacity` : 'less of the capacity')
          + ' for the purchase.',
    );
  }

  return parts.join(' ');
}
