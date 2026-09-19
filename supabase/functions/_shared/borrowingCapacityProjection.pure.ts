/**
 * Project a stored `borrowing_capacity_assessments` row into the binding
 * vocabulary a Borrowing Capacity Snapshot template uses.
 *
 * ## Read from the table, not from a summary of it
 *
 * `docs/reports/BORROWING_CAPACITY.md` records what happens when this is done
 * from memory: four drafts of that format's test fixture invented shapes —
 * `source` for `component`, `liability` for `type`, a percentage where the code
 * wanted a 0–1 fraction, an `lmi_mode` of `capitalised` where the column holds
 * `debt_capitalised` — "and every one produced a page of plausible-looking
 * wrong output". So every shape below was read off the live table across all
 * 143 assessments rather than inferred:
 *
 *  - `income_breakdown` is an **array** of `{ component, grossAmount,
 *    shadedAmount, shadingRate }`. Present on 140 of 143.
 *  - `liability_breakdown` is an **array** of `{ type, balance, limit,
 *    monthlyServicing }`. Present on 117 of 143.
 *  - `expense_breakdown` is an **object** of `{ declaredExpenses, hemBenchmark }`.
 *  - `recommendations` is an **array of plain strings**, on all 143.
 *  - `warnings` is a Postgres `text[]`, non-empty on 41.
 *  - `assumptions` has held two shapes: a bare `{key, value}[]` on 86 rows and,
 *    on the other 57, an object whose `items` is that array beside the
 *    calculator's flags — `selectedLenderName`, `calculationMode`,
 *    `dtiCapEnabled`, `dtiCapLimit`, `isFirstHomeBuyer`, `lmiMode`,
 *    `lmiDepositAmount`, `lmiPropertyValue`, `proposedRentalIncome`. The
 *    lender name lives only on the object shape (26 of those 57 have one).
 *  - `explanation` and `audit_trail` are columns, **null on all 143 stored
 *    rows** — the calculator's keep-update that writes them post-dates every
 *    stored assessment. They are passed through to `buildSnapshot` and
 *    projected when present, so the format's "How this was calculated" and
 *    audit pages light up per row as new runs land; a template binding them
 *    must stay conditional.
 *
 * ## Units
 *
 * Rates are stored as whole-number percent, measured across all 143 rows:
 * `interest_rate_used` 2.5–6.5, `assessment_rate` 5.5–9.5, `buffer_rate` 0–3,
 * `proposed_lvr` 80, `dti_ratio` 0–11.9. The `percent` filter formats without
 * multiplying, so they pass through untouched. `dti_ratio` is a **multiple**
 * (×11.9 of income), not a percentage — it is projected as a number and should
 * be set with `| fixed` rather than `| percent`.
 *
 * Monetary columns are dollars. `living_expenses_monthly` and
 * `existing_commitments_monthly` are **monthly**, and the annualised forms below
 * are `× 12` — arithmetic, not a model.
 *
 * ## What is deliberately absent
 *
 *  - `net_purchase_capacity` is populated on **3 of 143**, so it is emitted only
 *    when present rather than defaulted to zero. Zero would read as "you can
 *    buy nothing", which is a different claim from "not calculated".
 *  - `explanation.*` and `audit.*` on rows stored before the calculator's
 *    keep-update — null there, as above, and projected only when present.
 *
 * ## The applicants
 *
 * `client.*` used to be absent for the reason above — the row carries
 * `client_id` and not a name, and guessing one is not this module's job. The
 * caller does the join and hands the names in, which is the arrangement
 * `comparisonProjection` already uses.
 *
 * It is worth doing here in a way it was not for the investment reports: all
 * **143 of 143** assessments carry a `client_id` that resolves to a real
 * `clients` row, and all 143 of those carry both a first name and a surname.
 *
 * The name itself comes from `clientName.ts` rather than being formatted here.
 * That module already owns the four columns the table actually has — the two
 * legacy routes each invented their own spelling and one of them 404'd every
 * client in the database — and it already decides that the document names the
 * **primary** applicant, falling back to the secondary, because the Snapshot's
 * filename is built from the same call. 33 of the 143 are joint; naming both
 * here would put a different name on the cover from the one on the file.
 */

import { clientDisplayName, type ClientNameRow } from './clientName.ts';
import { buildSnapshot } from './reports/borrowingCapacity/normalise.pure.ts';
import type {
  BorrowingCapacitySnapshot,
  Band,
} from './reports/borrowingCapacity/payload.pure.ts';
import { formatDelta, formatMeasure, type Measure } from './reportDesign/measure.pure.ts';

export interface BorrowingCapacityRowLike {
  gross_annual_income?: number | string | null;
  shaded_annual_income?: number | string | null;
  income_breakdown?: unknown;
  living_expenses_monthly?: number | string | null;
  expense_method?: string | null;
  expense_breakdown?: unknown;
  existing_commitments_monthly?: number | string | null;
  liability_breakdown?: unknown;
  interest_rate_used?: number | string | null;
  buffer_rate?: number | string | null;
  assessment_rate?: number | string | null;
  loan_term_years?: number | string | null;
  proposed_loan_amount?: number | string | null;
  proposed_lvr?: number | string | null;
  borrowing_capacity?: number | string | null;
  monthly_surplus?: number | string | null;
  serviceability_band?: string | null;
  stress_tested_capacity?: number | string | null;
  dti_ratio?: number | string | null;
  recommendations?: unknown;
  warnings?: unknown;
  assumptions?: unknown;
  lmi_amount?: number | string | null;
  lmi_mode?: string | null;
  lmi_lvr_trigger?: number | string | null;
  property_value_estimate?: number | string | null;
  deposit_amount?: number | string | null;
  net_purchase_capacity?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  [k: string]: unknown;
}

const MONTHS_PER_YEAR = 12;

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s || undefined;
}

function strList(v: unknown): string[] {
  return arr(v).map((x) => str(x)).filter((x): x is string => !!x);
}

/** Assign only defined values, so an absent source stays an absent binding. */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

export interface ProjectedBorrowingCapacity {
  capacity: Record<string, unknown>;
  income: Record<string, unknown>;
  expenses: Record<string, unknown>;
  liabilities: Record<string, unknown>;
  loan: Record<string, unknown>;
  lmi: Record<string, unknown>;
  assumptions: Record<string, unknown>;
  recommendations: string[];
  warnings: string[];
  report: Record<string, unknown>;
}

export function projectBorrowingCapacity(row: BorrowingCapacityRowLike): ProjectedBorrowingCapacity {
  const assumptions = obj(row.assumptions);
  const expenseBreakdown = obj(row.expense_breakdown);

  const monthlyExpenses = num(row.living_expenses_monthly);
  const monthlyCommitments = num(row.existing_commitments_monthly);

  // ── capacity ──────────────────────────────────────────────────────────────
  const capacity: Record<string, unknown> = {};
  put(capacity, 'borrowing', num(row.borrowing_capacity));
  put(capacity, 'stressTested', num(row.stress_tested_capacity));
  // 3 of 143 rows carry this. Absent is not zero.
  put(capacity, 'netPurchase', num(row.net_purchase_capacity));
  put(capacity, 'monthlySurplus', num(row.monthly_surplus));
  put(capacity, 'annualSurplus', monthlySurplusAnnual(row));
  put(capacity, 'band', str(row.serviceability_band));
  put(capacity, 'bandLabel', bandLabel(str(row.serviceability_band)));
  // A multiple of income, not a percentage. Set it with `| fixed`.
  put(capacity, 'dti', num(row.dti_ratio));
  put(capacity, 'depositAmount', num(row.deposit_amount));
  put(capacity, 'propertyValueEstimate', num(row.property_value_estimate));

  // ── income ────────────────────────────────────────────────────────────────
  const income: Record<string, unknown> = {};
  const gross = num(row.gross_annual_income);
  const shaded = num(row.shaded_annual_income);
  put(income, 'gross', gross);
  put(income, 'shaded', shaded);
  // What the shading cost, stated rather than left for the reader to subtract.
  put(income, 'shadingApplied', gross !== undefined && shaded !== undefined ? gross - shaded : undefined);
  const items = arr(row.income_breakdown).map((raw) => {
    const it = obj(raw);
    const line: Record<string, unknown> = {};
    put(line, 'component', str(it.component));
    put(line, 'grossAmount', num(it.grossAmount));
    put(line, 'shadedAmount', num(it.shadedAmount));
    put(line, 'shadingRate', num(it.shadingRate));
    return line;
  }).filter((l) => Object.keys(l).length > 0);
  if (items.length) income.items = items;

  // ── expenses ──────────────────────────────────────────────────────────────
  const expenses: Record<string, unknown> = {};
  put(expenses, 'monthly', monthlyExpenses);
  put(expenses, 'annual', monthlyExpenses === undefined ? undefined : monthlyExpenses * MONTHS_PER_YEAR);
  put(expenses, 'method', str(row.expense_method));
  put(expenses, 'methodLabel', expenseMethodLabel(str(row.expense_method)));
  put(expenses, 'declared', num(expenseBreakdown.declaredExpenses));
  put(expenses, 'hemBenchmark', num(expenseBreakdown.hemBenchmark));

  // ── liabilities ───────────────────────────────────────────────────────────
  const liabilities: Record<string, unknown> = {};
  put(liabilities, 'monthly', monthlyCommitments);
  put(liabilities, 'annual', monthlyCommitments === undefined ? undefined : monthlyCommitments * MONTHS_PER_YEAR);
  const liabilityItems = arr(row.liability_breakdown).map((raw) => {
    const it = obj(raw);
    const line: Record<string, unknown> = {};
    put(line, 'type', str(it.type));
    put(line, 'balance', num(it.balance));
    put(line, 'limit', num(it.limit));
    put(line, 'monthlyServicing', num(it.monthlyServicing));
    return line;
  }).filter((l) => Object.keys(l).length > 0);
  if (liabilityItems.length) liabilities.items = liabilityItems;

  // ── loan ──────────────────────────────────────────────────────────────────
  const loan: Record<string, unknown> = {};
  put(loan, 'proposed', num(row.proposed_loan_amount));
  put(loan, 'lvr', num(row.proposed_lvr));
  put(loan, 'termYears', num(row.loan_term_years));
  put(loan, 'interestRate', num(row.interest_rate_used));
  put(loan, 'bufferRate', num(row.buffer_rate));
  put(loan, 'assessmentRate', num(row.assessment_rate));
  put(loan, 'lender', str(assumptions.selectedLenderName));

  // ── LMI (3 of 143 rows) ───────────────────────────────────────────────────
  const lmiMode = str(row.lmi_mode);
  const lmi: Record<string, unknown> = {};
  if (lmiMode && lmiMode !== 'none') {
    put(lmi, 'mode', lmiMode);
    put(lmi, 'amount', num(row.lmi_amount));
    put(lmi, 'lvrTrigger', num(row.lmi_lvr_trigger));
    put(lmi, 'depositAmount', num(assumptions.lmiDepositAmount));
    put(lmi, 'propertyValue', num(assumptions.lmiPropertyValue));
  }

  // ── stated assumptions ────────────────────────────────────────────────────
  const assumptionsOut: Record<string, unknown> = {};
  put(assumptionsOut, 'lender', str(assumptions.selectedLenderName));
  put(assumptionsOut, 'calculationMode', str(assumptions.calculationMode));
  put(assumptionsOut, 'dtiCapLimit', num(assumptions.dtiCapLimit));
  put(assumptionsOut, 'proposedRentalIncome', num(assumptions.proposedRentalIncome));
  if (typeof assumptions.dtiCapEnabled === 'boolean') assumptionsOut.dtiCapEnabled = assumptions.dtiCapEnabled;
  if (typeof assumptions.isFirstHomeBuyer === 'boolean') assumptionsOut.isFirstHomeBuyer = assumptions.isFirstHomeBuyer;

  const report: Record<string, unknown> = {};
  put(report, 'generatedDate', str(row.updated_at) ?? str(row.created_at));

  return {
    capacity,
    income,
    expenses,
    liabilities,
    loan,
    lmi,
    assumptions: assumptionsOut,
    recommendations: strList(row.recommendations),
    warnings: strList(row.warnings),
    report,
  };
}

function monthlySurplusAnnual(row: BorrowingCapacityRowLike): number | undefined {
  const m = num(row.monthly_surplus);
  return m === undefined ? undefined : m * MONTHS_PER_YEAR;
}

/**
 * The serviceability band, in words.
 *
 * The column holds `green` / `amber` / `red` across all 143 rows. Those are
 * fine as a state and wrong as a label on a client's page — "red" tells a reader
 * they have failed something without saying what.
 */
function bandLabel(band: string | undefined): string | undefined {
  switch (band) {
    case 'green': return 'Comfortable';
    case 'amber': return 'Serviceable with limited headroom';
    case 'red': return 'Constrained';
    default: return undefined;
  }
}

/** `declared` / `hem` are the two stored methods. */
function expenseMethodLabel(method: string | undefined): string | undefined {
  switch (method) {
    case 'declared': return 'Declared living expenses';
    case 'hem': return 'HEM benchmark';
    default: return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The legacy document's own structure, restated
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collection caps for the snapshot-shaped section, measured across all 143
 * stored assessments run through the legacy normaliser itself:
 *
 *  | collection        | max in production | cap |
 *  | ----------------- | ----------------- | --- |
 *  | income rows       | 7                 | 8   |
 *  | liability rows    | 6                 | 8   |
 *  | assumption rows   | 17                | 18  |
 *  | ledger rows       | 8 (fixed)         | 10  |
 *
 * `explanation` and `audit_trail` are columns null on every stored row (the
 * calculator's keep-update post-dates them all), so their caps are sized from
 * the **producer** rather than production: `generateExplanationServer` emits
 * eight unconditional steps plus one for a non-default lender policy and one
 * for LMI — ten is its ceiling, and a cap of eight was silently cutting the
 * stress test and the band off the end. The audit builder writes one entry per
 * adjustment and has no ceiling at all, so its cap is the row count the page
 * fits and the projection says what it left out (`omissionNote`) rather than
 * omitting silently. `scenarios` genuinely has no stored producer — presets
 * only ever travel in a render request — so its binding stays dark on every
 * row; the cap exists for the day a column does.
 */
export const SNAPSHOT_CAPS = {
  incomeRows: 8,
  liabilityRows: 8,
  assumptionRows: 18,
  ledgerRows: 10,
  explanationSteps: 10,
  figuresPerStep: 6,
  auditRows: 14,
  scenarioRows: 6,
} as const;

function fm(m: Measure | null | undefined): string | undefined {
  if (!m) return undefined;
  const s = formatMeasure(m);
  return s === '' ? undefined : s;
}

/** The same vocabulary `capacity.bandLabel` uses, for the payload's Band. */
function payloadBandLabel(band: Band | undefined): string | undefined {
  switch (band) {
    case 'strong': return 'Comfortable';
    case 'moderate': return 'Serviceable with limited headroom';
    case 'limited': return 'Constrained';
    default: return undefined;
  }
}

/**
 * The audit table's category captions, restating the legacy render's own map
 * (`render.pure.ts` keeps its `CATEGORY_CAPTION` private). An unknown category
 * passes through as itself, exactly as the legacy table shows it.
 */
const AUDIT_CATEGORY_CAPTION: Record<string, string> = {
  income: 'Income',
  tax: 'Tax',
  expense: 'Expenses',
  property: 'Property cashflow',
  liability: 'Liabilities',
  constraint: 'Constraints',
  policy: 'Lender policy',
};

function auditCategoryCaption(category: string): string {
  return AUDIT_CATEGORY_CAPTION[category] ?? category;
}

/**
 * The legacy Snapshot document, restated for templates.
 *
 * ## Why this goes through the legacy normaliser
 *
 * `projectBorrowingCapacity` above reads the raw row, and stays — the seeded
 * masters bind its vocabulary. But the raw row is not the document: the legacy
 * engine's `buildSnapshot` is where the narrative is written, the ledger is
 * assembled, a liability's display label is composed from kind and provider,
 * and utilisation is judged. Re-deriving any of that here would be a second
 * copy that drifts. So this section is a projection of the **snapshot payload**
 * — the exact structure the shipping document renders — published additively
 * beside the raw-row vocabulary.
 *
 * ## What cascades to absent, and why that is correct
 *
 * `explanation`, `audit` and `scenarios` are parameters the stored row cannot
 * supply (computed, returned, never persisted — F12). They project to nothing
 * today, the masters' pages for them are conditional, and the day the
 * calculator starts persisting them the pages appear with no further change.
 * That is the cascade working, not a gap.
 */
export function projectBorrowingCapacitySnapshot(
  snapshot: BorrowingCapacitySnapshot,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const ns = (key: string): Record<string, unknown> => (out[key] ??= {});

  // ── the executive summary, as the legacy engine writes it ────────────────
  // Longest across the 143: 606 characters. A whole paragraph, never a
  // fragment — the narrative carries its own figures through `formatMeasure`.
  put(ns('summary'), 'narrative', str(snapshot.narrative));

  // ── headline figures the raw-row section does not carry ──────────────────
  // DTI is on all 143 rows; the raw projection predates it.
  if (snapshot.headline.dti) {
    put(ns('capacity'), 'dti', snapshot.headline.dti.value);
    put(ns('capacity'), 'dtiLabel', fm(snapshot.headline.dti));
  }
  put(ns('report'), 'lenderName', str(snapshot.meta.lenderName));

  // ── utilisation: the proposed loan against the assessed capacity ─────────
  // Present on 66 of 143. `verdict` is a whole sentence for the same reason
  // every omission note is: a template concatenating around a boolean strands
  // its literal when the value is absent.
  if (snapshot.utilisation) {
    const u = snapshot.utilisation;
    const util = ns('utilisation');
    put(util, 'proposedLoan', u.proposedLoan.value);
    put(util, 'capacity', u.capacity.value);
    put(util, 'shareLabel', fm(u.share));
    util.withinCapacity = u.withinCapacity;
    put(util, 'verdict', u.withinCapacity
      ? 'The proposed loan sits inside the assessed capacity.'
      : 'The proposed loan exceeds the assessed capacity.');
  }

  // ── income rows, in the legacy engine's own composition ──────────────────
  const incomeRows = snapshot.income.rows.slice(0, SNAPSHOT_CAPS.incomeRows)
    .map((r) => {
      const row: Record<string, unknown> = {};
      put(row, 'label', str(r.label));
      put(row, 'gross', r.gross.value);
      put(row, 'shaded', r.shaded.value);
      put(row, 'shadingLabel', fm(r.shading));
      return row;
    })
    .filter((r) => Object.keys(r).length > 0);
  if (incomeRows.length) {
    ns('income').rows = incomeRows;
    put(ns('income'), 'rowCount', snapshot.income.rows.length);
  }

  // ── liabilities, with the display label the legacy document composes ─────
  // Kind plus provider, joined here so a template cannot strand a separator
  // beside an absent provider.
  const liabilityRows = snapshot.expenses.liabilities
    .slice(0, SNAPSHOT_CAPS.liabilityRows)
    .map((l) => {
      const row: Record<string, unknown> = {};
      put(row, 'label', l.provider ? `${l.kind} · ${l.provider}` : l.kind);
      put(row, 'balance', l.balance?.value);
      put(row, 'limit', l.limit?.value);
      put(row, 'servicing', l.monthlyServicing.value);
      put(row, 'note', str(l.note));
      return row;
    })
    .filter((r) => Object.keys(r).length > 0);
  if (liabilityRows.length) {
    ns('liabilities').rows = liabilityRows;
    put(ns('liabilities'), 'rowCount', snapshot.expenses.liabilities.length);
  }

  // ── the assessment ledger ─────────────────────────────────────────────────
  // `amountLabel` is the formatted measure, units and all — "$302,640 pa"
  // beside "-$2,200/mo" is the point of the ledger, and a bare `| currency`
  // filter would erase the distinction.
  const ledgerRows = snapshot.ledger.slice(0, SNAPSHOT_CAPS.ledgerRows)
    .map((l) => {
      const row: Record<string, unknown> = {};
      put(row, 'label', str(l.label));
      put(row, 'amountLabel', fm(l.amount));
      put(row, 'direction', str(l.direction));
      put(row, 'emphasis', str(l.emphasis));
      return row;
    })
    .filter((r) => typeof r.label === 'string' && typeof r.amountLabel === 'string');
  if (ledgerRows.length) ns('ledger').rows = ledgerRows;

  // ── assumptions, as label/value rows ─────────────────────────────────────
  const assumptionRows = snapshot.assumptions
    .slice(0, SNAPSHOT_CAPS.assumptionRows)
    .map((a) => {
      const row: Record<string, unknown> = {};
      put(row, 'label', str(a.label));
      put(row, 'value', str(a.value));
      return row;
    })
    .filter((r) => typeof r.label === 'string' && typeof r.value === 'string');
  if (assumptionRows.length) {
    ns('assumptions').rows = assumptionRows;
    put(ns('assumptions'), 'rowCount', snapshot.assumptions.length);
  }

  // ── how the engine reached this (column null on stored rows; cascades) ───
  if (snapshot.explanation && snapshot.explanation.steps.length) {
    const e = ns('explanation');
    put(e, 'headline', str(snapshot.explanation.headline));
    e.steps = snapshot.explanation.steps.slice(0, SNAPSHOT_CAPS.explanationSteps)
      .map((s) => {
        const step: Record<string, unknown> = {};
        put(step, 'title', str(s.title));
        put(step, 'narrative', str(s.narrative));
        const figures = s.figures.slice(0, SNAPSHOT_CAPS.figuresPerStep)
          .map((f) => ({ label: f.label, valueLabel: fm(f.value) }))
          .filter((f) => f.label && f.valueLabel);
        if (figures.length) step.figures = figures;
        return step;
      });
  }

  // ── the audit trail (column null on every stored row; cascades per run) ──
  // The label is composed as the legacy table's item cell — category caption,
  // em-rule, entry label — and the delta goes through `formatDelta`, so a
  // change is signed and "did not move" is an em dash rather than `+$0`.
  if (snapshot.audit && snapshot.audit.groups.length) {
    const rows = snapshot.audit.groups
      .flatMap((g) => g.rows.map((r) => ({ category: g.category, r })))
      .slice(0, SNAPSHOT_CAPS.auditRows)
      .map(({ category, r }) => {
        const row: Record<string, unknown> = {};
        put(row, 'label', `${auditCategoryCaption(category)} — ${r.label}`);
        put(row, 'category', str(r.category));
        put(row, 'action', str(r.action));
        put(row, 'rule', str(r.rule));
        put(row, 'note', str(r.note));
        put(row, 'rawLabel', fm(r.raw));
        put(row, 'assessedLabel', fm(r.assessed));
        put(row, 'deltaLabel', r.delta ? formatDelta(r.delta) : '—');
        put(row, 'direction', str(r.direction));
        return row;
      })
      .filter((r) => Object.keys(r).length > 0);
    if (rows.length) {
      const audit = ns('audit');
      audit.rows = rows;
      const total = snapshot.audit.groups.reduce((n, g) => n + g.rows.length, 0);
      if (total > SNAPSHOT_CAPS.auditRows) {
        put(audit, 'omissionNote',
          `${total - SNAPSHOT_CAPS.auditRows} further audit entries are not shown in this edition.`);
      }
    }
  }

  // ── scenarios (no stored producer at all — presets never reach a column) ─
  if (snapshot.scenarios && snapshot.scenarios.length) {
    ns('scenarios').rows = snapshot.scenarios.slice(0, SNAPSHOT_CAPS.scenarioRows)
      .map((s) => {
        const row: Record<string, unknown> = {};
        put(row, 'name', str(s.name));
        put(row, 'capacity', s.capacity.value);
        put(row, 'surplus', s.monthlySurplus.value);
        put(row, 'bandLabel', payloadBandLabel(s.band));
        put(row, 'changeLabel', fm(s.change));
        // Joined here, so a table cell is one string and a template cannot
        // strand a separator against an empty tail.
        put(row, 'adjustments', s.adjustments.length ? s.adjustments.join(' · ') : undefined);
        return row;
      })
      .filter((r) => Object.keys(r).length > 0);
  }

  return out;
}

/**
 * Merge the projection into a binding-context `data` object.
 *
 * `client` is supplied by the caller because the assessment row carries a
 * `client_id` and not a name; see the header. It is published only when there
 * is a name to publish, so a template binding `{{client.name}}` renders nothing
 * rather than a fragment when there is not — and, more to the point, an object
 * published with an empty string in it would make a page conditional on
 * `client` draw blank instead of dropping out.
 */
export function applyBorrowingCapacityProjection(
  data: Record<string, any>,
  row: BorrowingCapacityRowLike,
  client?: ClientNameRow | null,
): Record<string, any> {
  const p = projectBorrowingCapacity(row);
  const name = clientDisplayName(client);
  if (name) data.client = { ...obj(data.client), name };
  const merge = (key: string, extra: Record<string, unknown>) => {
    if (!Object.keys(extra).length) return;
    data[key] = { ...obj(data[key]), ...extra };
  };
  merge('capacity', p.capacity);
  merge('income', p.income);
  merge('expenses', p.expenses);
  merge('liabilities', p.liabilities);
  merge('loan', p.loan);
  merge('lmi', p.lmi);
  merge('assumptions', p.assumptions);
  merge('report', p.report);
  if (p.recommendations.length) data.recommendations = p.recommendations;
  if (p.warnings.length) data.warnings = p.warnings;

  /*
   * The legacy document's structure, on top of the raw row.
   *
   * Built through the legacy engine's own `buildSnapshot`, so the narrative,
   * the ledger and the composed labels are the shipping document's and not a
   * second copy. Gated on the row carrying a capacity figure: `buildSnapshot`
   * on an empty row manufactures a ledger of zeros and a narrative that says
   * "$0", and a fabricated figure on a client's page is worse than an absent
   * section.
   *
   * The narrative names its subject, so an assessment whose client cannot be
   * resolved reads "the applicant" rather than losing the paragraph — the
   * legacy route's own fallback is the placeholder 'Client', which reads as a
   * mail-merge failure on a page of prose.
   */
  if (num(row.borrowing_capacity) !== undefined) {
    /*
     * `audit_trail` and `explanation` are columns the calculator has written
     * since its keep-update landed, null on every row stored before it — so
     * they are passed through rather than assumed, and the pages bound to them
     * light up per row as the data arrives. Scenario presets have no column at
     * all (they only ever travel in a render request), so `scenarios.*` has no
     * producer here and its page stays dark by construction.
     */
    const snapshot = buildSnapshot({
      clientName: name || 'the applicant',
      assessment: row as never,
      auditTrail: row.audit_trail,
      explanation: row.explanation,
    });
    const extras = projectBorrowingCapacitySnapshot(snapshot);
    for (const [key, value] of Object.entries(extras)) merge(key, value);
  }
  return data;
}
