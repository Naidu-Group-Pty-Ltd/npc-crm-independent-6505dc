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
  let address = m[1].trim();
  const cut = Boolean(m[2]) && m[1].length === ENGINE_ADDRESS_CUT;
  if (cut) {
    const comma = address.lastIndexOf(',');
    const space = address.lastIndexOf(' ');
    const at = comma > 0 ? comma : space > 0 ? space : address.length;
    address = address.slice(0, at).trim();
  }
  address = address.replace(/[\s,]+$/, '');
  return address && address !== 'Property'
    ? `Property cash flow — ${address}`
    : 'Property cash flow';
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
  const storedDti = num(a.dti_ratio);
  const stressTested = num(a.stress_tested_capacity);
  const band = toBand(a.serviceability_band);

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
          netForPurchase: num(a.net_purchase_capacity) === null ? null : aud(num(a.net_purchase_capacity)!),
          mode: lmiMode === 'debt_capitalised' ? 'debt_capitalised' : 'display_deduction',
        }
      : null;

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
      recorded: incomeRecorded,
    },
    debtToIncome,
    expenses: {
      method: expenseMethodLabel(firstText(a.expense_method)),
      monthlyLiving: audPerMonth(livingExpenses),
      monthlyCommitments: audPerMonth(commitments),
      liabilities: liabilityRows,
    },
    ledger,
    recommendations: presentAdviceList(asStringList(a.recommendations), adviceFacts, { leadWithIncome: true }),
    warnings: presentAdviceList(asStringList(a.warnings), adviceFacts),
    explanation: toExplanationSection(source.explanation),
    audit: toAuditSection(source.auditTrail),
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
}): DebtToIncome | null {
  if (p.dti === null || p.dti <= 0 || p.denominator === null || p.denominator <= 0) return null;
  // The ratio is stored to two decimals, so the debt behind it is known to
  // within half a cent of income per dollar — about ±$1,000 on a $200,000
  // income. Rounded to $10,000 and labelled "about", never stated to the dollar.
  const total = p.dti * p.denominator;
  const existing = Math.max(0, total - p.capacity);
  const rounded = Math.round(existing / 10_000) * 10_000;
  return {
    ratio: ratio(p.dti),
    income: audPerYear(p.denominator),
    capacity: aud(p.capacity),
    existingDebt: rounded > 0 ? aud(rounded) : null,
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
