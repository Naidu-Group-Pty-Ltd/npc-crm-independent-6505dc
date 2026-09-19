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
import type {
  AuditRow,
  AuditSection,
  Band,
  BorrowingCapacitySnapshot,
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
    label: firstText(r.component, r.source_name, r.label, r.source_type) ?? 'Income',
    gross: audPerYear(gross),
    shading: rate(shadingRate),
    shaded: audPerYear(shaded),
  };
}

/** One liability. `balance` stays `null` when there is none — a $0 balance is a fact. */
export function toLiabilityRow(raw: unknown): LiabilityRow | null {
  const r = asRec(raw);
  const servicing = firstNum(r.monthlyServicing, r.monthly_repayment, r.monthly_servicing);
  const balance = firstNum(r.balance, r.current_balance);
  if (servicing === null && balance === null) return null;

  const kindText = firstText(r.type, r.liability_type) ?? 'Liability';
  const provider = firstText(r.label, r.provider_name, r.provider);
  const kind = titleCase(kindText);
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

function toAuditRow(raw: unknown): AuditRow | null {
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
  return {
    seq: entry.seq,
    label: entry.label,
    category,
    action,
    rule: entry.rule,
    note: entry.note ?? null,
    raw: rawMeasure,
    assessed,
    delta: auditDelta(entry),
    direction: auditDirection(entry),
    known: isKnownAuditAction(category, action),
  };
}

export function toAuditSection(raw: unknown): AuditSection | null {
  const trail = asRec(raw);
  const rows = asArray(trail.entries)
    .map(toAuditRow)
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
    summary: {
      // Shading and adjustments are annual/monthly sums the engine already
      // took; they are money, and `aud` is the only honest unit for a total
      // that mixes periods.
      incomeShading: aud(num(summary.totalIncomeShading) ?? 0),
      expenseAdjustments: aud(num(summary.totalExpenseAdjustments) ?? 0),
      liabilityAdjustments: aud(num(summary.totalLiabilityAdjustments) ?? 0),
      taxImpact: aud(num(summary.totalTaxImpact) ?? 0),
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

  relative('grossAnnualIncome', 'Income');
  relative('monthlyLivingExpenses', 'Expenses');
  absolute('monthlyCommitments', 'Commitments', (v) => audPerMonth(v));
  absolute('interestRate', 'Rate', (v) => percent(v));
  absolute('loanTermYears', 'Term', (v) => years(v));

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
  const deltas = asArray(preset.scenarioDeltas);
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

  const acquisition = asRec(preset.acquisitionCapacity);
  const maxPurchase = num(acquisition.maxPurchasePrice);
  if (maxPurchase !== null) {
    details.push(`Purchase power: max ${formatMeasure(aud(maxPurchase))}.`);
  }

  return {
    name: firstText(preset.name) ?? 'Scenario',
    capacity: aud(capacity),
    monthlySurplus: audPerMonth(num(result.monthlySurplus) ?? 0),
    band: toBand(result.serviceabilityBand),
    change,
    adjustments: isBase ? [] : describeAdjustments(baseInputs, preset.adjustedInputs),
    details,
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
  const dti = num(a.dti_ratio);
  const stressTested = num(a.stress_tested_capacity);
  const band = toBand(a.serviceability_band);

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
          netForPurchase: num(a.net_purchase_capacity) === null ? null : aud(num(a.net_purchase_capacity)!),
          mode: lmiMode === 'debt_capitalised' ? 'debt_capitalised' : 'display_deduction',
        }
      : null;

  const ledger: LedgerRow[] = [
    { label: 'Gross Annual Income', amount: audPerYear(grossIncome), emphasis: 'normal', direction: 'favourable' },
    { label: 'Shaded Annual Income', amount: audPerYear(shadedIncome), emphasis: 'normal', direction: 'favourable' },
    // A deduction is adverse whatever sign it is printed with. The shipping
    // report prints these in red because the numbers are negated, and prints a
    // HEM increase in green because its delta is positive — the same event,
    // two colours (F6).
    { label: 'Living Expenses', amount: audPerMonth(-livingExpenses), emphasis: 'normal', direction: 'adverse' },
    { label: 'Existing Commitments', amount: audPerMonth(-commitments), emphasis: 'normal', direction: 'adverse' },
    { label: 'Monthly Surplus', amount: audPerMonth(surplus), emphasis: 'normal', direction: surplus >= 0 ? 'favourable' : 'adverse' },
    { label: 'Assessment Rate Applied', amount: percent(assessmentRate), emphasis: 'normal', direction: 'neutral' },
    { label: 'Loan Term', amount: years(loanTermYears), emphasis: 'normal', direction: 'neutral' },
    { label: 'Maximum Borrowing Capacity', amount: aud(capacity), emphasis: 'total', direction: 'neutral' },
  ];

  const assumptions = toAssumptions(a.assumptions);
  const lenderName = firstText(asRec(a.assumptions).selectedLenderName);

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
      stressTested: stressTested === null ? null : aud(stressTested),
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
    },
    expenses: {
      method: titleCase(firstText(a.expense_method) ?? 'hem'),
      monthlyLiving: audPerMonth(livingExpenses),
      monthlyCommitments: audPerMonth(commitments),
      liabilities: liabilityRows,
    },
    ledger,
    recommendations: asStringList(a.recommendations),
    warnings: asStringList(a.warnings),
    explanation: toExplanationSection(source.explanation),
    audit: toAuditSection(source.auditTrail),
    scenarios: toScenarioRows(source.scenarioPresets),
  };
}

/**
 * The executive-summary paragraph.
 *
 * Kept close to the sentences the shipping report writes, so Phase 5's golden
 * diff compares typography and layout rather than wording. The figures inside
 * it go through `formatMeasure`, so the rate reads `8.65%` and not `$9`.
 */
function buildNarrative(p: {
  clientName: string;
  capacity: number;
  assessmentRate: number;
  loanTermYears: number;
  surplus: number;
  dti: number | null;
  band: Band;
  utilisation: UtilisationSection | null;
  lmi: LmiSection | null;
}): string {
  const bandWord = p.band === 'strong' ? 'strong' : p.band === 'moderate' ? 'moderate' : 'limited';
  const parts = [
    `Based on the financial information provided, ${p.clientName} has an estimated maximum `
      + `borrowing capacity of ${formatMeasure(aud(p.capacity))}.`,
    `This assessment was conducted using an assessment rate of ${formatMeasure(percent(p.assessmentRate))} `
      + `over a ${p.loanTermYears}-year loan term, resulting in a monthly surplus of `
      + `${formatMeasure(audPerMonth(p.surplus))}`
      + (p.dti === null ? '.' : ` and a debt-to-income ratio of ${formatMeasure(ratio(p.dti))}.`),
    `The overall serviceability position is assessed as ${bandWord}.`,
  ];

  if (p.utilisation) {
    parts.push(
      `The proposed loan of ${formatMeasure(p.utilisation.proposedLoan)} represents `
        + `${formatMeasure(p.utilisation.share)} of the available capacity and `
        + `${p.utilisation.withinCapacity ? 'falls within' : 'exceeds'} the assessed borrowing limit.`,
    );
  }

  if (p.lmi) {
    parts.push(
      p.lmi.mode === 'debt_capitalised'
        ? `An estimated Lenders Mortgage Insurance premium of ${formatMeasure(p.lmi.premium)} has been `
          + 'capitalised onto the loan, increasing total debt obligations and factored into the DTI calculation.'
        : `An estimated Lenders Mortgage Insurance premium of ${formatMeasure(p.lmi.premium)} applies, `
          + 'reducing the net amount available for property purchase'
          + (p.lmi.netForPurchase ? ` to ${formatMeasure(p.lmi.netForPurchase)}.` : '.'),
    );
  }

  return parts.join(' ');
}
