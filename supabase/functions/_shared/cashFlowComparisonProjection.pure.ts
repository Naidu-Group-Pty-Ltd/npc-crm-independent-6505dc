/**
 * Project a normalised `CashFlowComparison` payload into the binding vocabulary
 * a Cash Flow Comparison template uses.
 *
 * ## It restates, and normalises nothing
 *
 * Like the Property Comparison and the Client Details Form before it, this
 * format already has a normaliser — `_shared/reports/cashFlowComparison/` —
 * feeding `render-cash-flow-comparison-pdf`. Every hard question about this
 * document is answered there: that every metric is derived server-side and none
 * accepted, that the two break-evens are named apart, that a model block whose
 * shape does not match the schema is dropped rather than coerced, and that model
 * prose names no property. `docs/reports/CASH_FLOW_COMPARISON.md` is that
 * reader's contract, and this restates its output.
 *
 * ## There is no adapter, and this file is the reason there could be one later
 *
 * The other six formats on the family system each read a stored artefact. This
 * one has **nothing to read**, and it is worth being exact about why, because
 * "add an adapter" looks like a small piece of work from the outside:
 *
 *  - **The projections are never persisted.** They are the browser's, computed
 *    by a ~100-line chained cascade in `CashFlowAnalysisModal`. The contract's
 *    §1 explains why a second server-side implementation would be worse than
 *    none: a comparison is only worth anything if every property in it was
 *    computed by one implementation.
 *  - **The analysis is never persisted, and structurally cannot be.**
 *    `cash_flow_analyses` holds **0 rows** and carries 12 RLS policies; its
 *    INSERT check requires `auth.role() = 'authenticated'` while this
 *    application signs in through `custom_users`, so every save is refused —
 *    and its SELECT policy would hide the row from its own author even if one
 *    succeeded. That is F1, recorded and deliberately not fixed here.
 *  - **The render ledger stores no payload.** It has begun to fill — one
 *    succeeded render as of August 2026 — and records `primary_report_id` and
 *    `compared_report_ids`, but neither the projections nor the analysis
 *    (§9); its only SELECT policy is `has_role(auth.uid(), 'superadmin')` —
 *    which the browser client cannot satisfy for the same `custom_users`
 *    reason. A ledger row names which reports were compared, not what the
 *    comparison said.
 *
 * The obvious substitute is the one this codebase already uses for the 10 Year
 * Cash Flow: `investment_reports.financial_calculations.projections`, on 162
 * reports. It does not work here, and not for a scoping reason. That series
 * carries eight fields a year — value, loan, equity, rent, cash flow,
 * cumulative, roi — while **every headline measure in this document is built on
 * `afterTaxAnnual`**: total return, ROI, cash-on-cash, the equity multiple and
 * both break-even years. The stored series models no tax at all. Filling those
 * fields to make the shape fit would put an invented after-tax position on a
 * client's page, which is the one thing this programme exists to prevent.
 *
 * So the 50 masters are preview-only, honestly marked, and this module is what
 * an adapter would call on the day a comparison is persisted somewhere a
 * template can reach. Nothing else would need to change.
 *
 * ## Every `Measure` is unwrapped
 *
 * The payload carries `{ value, unit, precision }` so its own renderer can
 * format a figure with its unit. A template binds a raw number and applies
 * `| currency` or `| percent` itself. Publishing the object renders
 * `[object Object]`.
 *
 * ## What the masters may not do with what is published here
 *
 * Three rules come from the contract rather than from the data, and the
 * catalogue spec asserts each:
 *
 *  1. **Model prose names no property.** `propertyNumber` in the producer's
 *     schema indexes a list built by mapping over the result of an unordered
 *     `IN` query — an ordering that existed inside one function call and was
 *     never recorded. Rankings are the exception, matched on an address the
 *     model was instructed to echo; one that matches nothing keeps `property:
 *     null` and prints its own text.
 *  2. **`avoid` is not on the ranking page.** Naming a property to avoid beside
 *     the ranking, in a document an adviser may hand to a client considering
 *     that property, is a different act from ranking it last.
 *  3. **`highestRisk` stays prose.** An award for being the worst is not a
 *     category anyone wins.
 */

import type {
  CashFlowComparison,
  ComparedProperty,
  CategoryWinner,
  AnalysisRanking,
  AnalysisNote,
  InvestorMatch,
} from './reports/cashFlowComparison/payload.pure.ts';
import { formatMeasure } from './reportDesign/measure.pure.ts';

/** Matches `MIN_COMPARED_PROPERTIES` / `MAX_COMPARED_PROPERTIES`. */
export const MIN_PROPERTIES = 2;
export const MAX_PROPERTIES = 5;

interface MeasureLike { value?: unknown }

function measure(m: unknown): number | undefined {
  if (m === null || m === undefined) return undefined;
  const v = (m as MeasureLike).value;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s || undefined;
}

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** A model sentence, with whatever figure it attached. Never a property. */
function projectNote(n: AnalysisNote | null | undefined): Record<string, unknown> | undefined {
  if (!n) return undefined;
  const out: Record<string, unknown> = {};
  put(out, 'reason', str(n.reason));
  put(out, 'detail', str(n.detail));
  return Object.keys(out).length ? out : undefined;
}

function projectProperty(p: ComparedProperty): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out.number = p.number;
  put(out, 'address', str(p.address));
  put(out, 'shortAddress', str(p.shortAddress));
  // The primary is *marked*, never privileged: it sits in the same rows as the
  // rest and the column header says which one the adviser had open.
  out.marker = p.isPrimary ? 'Opened' : '';

  const o = p.outcome;
  put(out, 'cumulativeAfterTax', measure(o.cumulativeAfterTax));
  put(out, 'capitalGain', measure(o.capitalGain));
  put(out, 'endingValue', measure(o.endingValue));
  put(out, 'endingEquity', measure(o.endingEquity));
  put(out, 'totalReturn', measure(o.totalReturn));
  put(out, 'initialInvestment', measure(o.initialInvestment));
  put(out, 'roi', measure(o.roi));
  put(out, 'annualisedRoi', measure(o.annualisedRoi));
  put(out, 'cashOnCash', measure(o.cashOnCash));
  put(out, 'equityMultiple', measure(o.equityMultiple));
  put(out, 'grossYield', measure(o.grossYield));
  put(out, 'netYield', measure(o.netYield));
  put(out, 'capitalGrowthRate', measure(o.capitalGrowthRate));

  /**
   * The two break-evens, named apart and never merged.
   *
   * The modal calls "break-even" the year *cumulative* cash flow turns
   * non-negative; the 10 Year Cash Flow format calls it the year *annual* cash
   * flow does. Both are true, they are rarely the same year, and neither screen
   * could see the other. The pages print both with a note saying which is
   * which — so a null here is "never, within the term", which is why it is
   * published as a word rather than left absent for a template to guess at.
   */
  out.firstPositiveYear = num(o.firstPositiveYear) ?? 'Not within term';
  out.paybackYear = num(o.paybackYear) ?? 'Not within term';

  // The year rows, so a table can walk one property's term.
  //
  // `afterTaxCumulative` is a running sum rather than a stored field, and it is
  // computed here rather than accepted for the same reason every other metric
  // is derived: the outcome's `cumulativeAfterTax` is the same addition, and
  // two sources for one relationship is how a document says one number in a
  // KPI strip and a different one in a table three pages later.
  const years = p.projection?.years ?? [];
  let running = 0;
  const rows = years.map((y) => {
    const row: Record<string, unknown> = {};
    put(row, 'year', num(y.year));
    put(row, 'propertyValue', measure(y.propertyValue));
    put(row, 'loanBalance', measure(y.loanBalance));
    put(row, 'equity', measure(y.equity));
    const afterTax = measure(y.afterTaxAnnual);
    put(row, 'afterTaxAnnual', afterTax);
    if (afterTax !== undefined) {
      running += afterTax;
      row.afterTaxCumulative = running;
    }
    return row;
  });
  if (rows.length) out.years = rows;

  return out;
}

function projectWinner(
  w: CategoryWinner,
  shortAddressOf: (n: number | null) => string | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'key', str(w.key));
  put(out, 'label', str(w.label));
  put(out, 'value', measure(w.value));
  // The clear air to second place. A win by $400 over ten years is not a
  // difference a client should act on, and a ranked table alone cannot say so.
  put(out, 'margin', measure(w.margin));
  /*
   * The figure and the margin, formatted with their own units. The eight
   * categories mix dollars, percent and years in one column, so a template
   * cannot pick one filter for the table — the label arrives composed, the
   * way the legacy wins table's own `show()` composes it. The raw numbers
   * stay published beside them for a chart or a custom binding.
   */
  put(out, 'valueLabel', w.value ? formatMeasure(w.value) : undefined);
  put(out, 'marginLabel', w.margin ? formatMeasure(w.margin) : undefined);
  /*
   * The leader, resolved to the street line — the legacy table's own cell.
   * The raw number was published here once, and a master printing "1" as a
   * winner's name is a database index on a client's page; scoreboard winners
   * are computed server-side over the real property list, so unlike the model
   * prose this pointer is safe to resolve. A tie says so in the legacy's own
   * words rather than awarding array order.
   */
  out.winner = shortAddressOf(w.property) ?? 'No clear leader';
  put(out, 'winnerNumber', num(w.property));
  out.lowerIsBetter = w.lowerIsBetter ? 'Yes' : 'No';
  return out;
}

function projectRanking(r: AnalysisRanking): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  out.rank = r.rank;
  put(out, 'address', str(r.statedAddress));
  // Deliberately not a Measure and never printed with a denominator: the
  // producer's schema names no scale, and the legacy generator printed `/100`
  // regardless. A number with no stated scale is printed as one.
  put(out, 'score', num(r.score));
  put(out, 'verdict', str(r.verdict));
  /**
   * A whole sentence, and absent when the ranking matched.
   *
   * Not a flag and not an empty string with a separator in front of it: the
   * masters set this straight after the verdict, so it has to read as prose on
   * the page and disappear completely when there is nothing to say. `put` drops
   * an empty string, so a matched ranking publishes no key at all and the
   * binding resolves to nothing.
   */
  if (r.property === null) {
    out.matched = 'The analysis named an address that matches none of the properties compared.';
  }
  if (r.strengths.length) out.strengths = [...r.strengths];
  if (r.weaknesses.length) out.weaknesses = [...r.weaknesses];
  return out;
}

function projectMatch(m: InvestorMatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'key', str(m.key));
  put(out, 'label', str(m.label));
  put(out, 'reason', str(m.note?.reason));
  put(out, 'detail', str(m.note?.detail));
  return out;
}

export interface ProjectedCashFlowComparison {
  cashFlowComparison: Record<string, unknown>;
  client: Record<string, unknown>;
  report: Record<string, unknown>;
}

export function projectCashFlowComparison(
  comparison: CashFlowComparison,
): ProjectedCashFlowComparison {
  const c = comparison;
  const out: Record<string, unknown> = {};

  out.propertyCount = c.meta.propertyCount;
  out.termYears = c.meta.termYears;
  put(out, 'investorProfile', str(c.meta.investorProfileLabel) ?? str(c.meta.investorProfile));
  put(out, 'narrative', str(c.narrative));
  put(out, 'preparedOn', str(c.meta.preparedOn));
  // The first eight characters of the primary report id, uppercased — printed
  // on the cover foot and in the filename, because a date alone does not
  // separate two comparisons run on the same day, which is the normal case.
  const primary = str(c.meta.primaryReportId);
  if (primary) out.reference = primary.slice(0, 8).toUpperCase();

  const properties = c.properties.map(projectProperty);
  if (properties.length) out.properties = properties;

  /**
   * The ranking, best first on ten-year total return.
   *
   * A separate array from `properties`, which is in display order: the document
   * ranks on one axis and lists on another, and a template that sorted a
   * display list would have to know which.
   */
  const byNumber = new Map(properties.map((p) => [p.number as number, p]));
  const ranked = c.scoreboard.order
    .map((n, i) => {
      const p = byNumber.get(n);
      if (!p) return null;
      return { ...p, rank: i + 1 };
    })
    .filter((p) => p !== null);
  if (ranked.length) out.ranked = ranked;

  const scoreboard: Record<string, unknown> = {};
  /**
   * What separates first from second, as a share of first's total return.
   *
   * The document leads with this rather than with the winner's figure: a 40%
   * gap is a decision and a 2% gap is a coin toss, and a ranked list of five
   * numbers says neither. Null — the leader returned nothing — reads as a word.
   */
  const lead = measure(c.scoreboard.leadMargin);
  scoreboard.leadMargin = lead ?? 'Too close to separate';
  scoreboard.hasLeadMargin = lead !== undefined;
  const winners = c.scoreboard.winners.map((w) => projectWinner(w, (n) => {
    if (n === null) return undefined;
    const p = c.properties.find((x) => x.number === n);
    return p ? p.shortAddress : undefined;
  }));
  if (winners.length) scoreboard.winners = winners;
  out.scoreboard = scoreboard;

  // ── the model half, each block independently present ─────────────────────
  //
  // `compare-cash-flow-reports` asks for eight sections with `maxTokens: 4000`,
  // and a response that closed its braces early still parses — so a partial
  // analysis is a normal arrival rather than a fault. Gating the blocks
  // together would drop three present sections because a fourth ran out of
  // budget, which is why each is published on its own.
  const a = c.analysis;
  out.hasAnalysis = a !== null;
  if (a) {
    const analysis: Record<string, unknown> = {};
    put(analysis, 'summary', str(a.summary));
    if (a.rankings.length) analysis.rankings = a.rankings.map(projectRanking);
    if (a.investorMatches.length) analysis.investorMatches = a.investorMatches.map(projectMatch);
    if (a.missing.length) analysis.missing = [...a.missing];

    if (a.trajectory) {
      const t: Record<string, unknown> = {};
      put(t, 'fastestPositive', projectNote(a.trajectory.fastestPositive));
      put(t, 'strongestGrowth', projectNote(a.trajectory.strongestGrowth));
      const concerns = a.trajectory.concerns.map(projectNote).filter(Boolean);
      if (concerns.length) t.concerns = concerns;
      if (Object.keys(t).length) analysis.trajectory = t;
    }
    if (a.capitalGrowth) {
      const g: Record<string, unknown> = {};
      put(g, 'strongestEquity', projectNote(a.capitalGrowth.strongestEquity));
      put(g, 'wealthBuilder', projectNote(a.capitalGrowth.wealthBuilder));
      if (Object.keys(g).length) analysis.capitalGrowth = g;
    }
    if (a.yields) {
      const y: Record<string, unknown> = {};
      put(y, 'bestGross', projectNote(a.yields.bestGross));
      put(y, 'bestNet', projectNote(a.yields.bestNet));
      put(y, 'bestRoi', projectNote(a.yields.bestRoi));
      if (Object.keys(y).length) analysis.yields = y;
    }
    if (a.risk) {
      const r: Record<string, unknown> = {};
      put(r, 'mostStable', projectNote(a.risk.mostStable));
      // Prose, and never a scoreboard entry or a chart segment.
      put(r, 'highestRisk', projectNote(a.risk.highestRisk));
      if (a.risk.risks.length) r.risks = [...a.risk.risks];
      if (Object.keys(r).length) analysis.risk = r;
    }
    if (a.recommendation) {
      const rec: Record<string, unknown> = {};
      put(rec, 'best', projectNote(a.recommendation.best));
      // `avoid` is published, and the masters draw it on the risk page rather
      // than the ranking page. See the header.
      const avoid = a.recommendation.avoid.map(projectNote).filter(Boolean);
      if (avoid.length) rec.avoid = avoid;
      if (a.recommendation.scenarios.length) rec.scenarios = [...a.recommendation.scenarios];
      if (Object.keys(rec).length) analysis.recommendation = rec;
    }
    out.analysis = analysis;
  }

  const client: Record<string, unknown> = {};
  // Present only when exactly one client resolves across the properties. A
  // comparison spanning two clients' shortlists is a real thing an adviser
  // does, and naming one of them would be wrong.
  put(client, 'name', str(c.meta.clientName));

  const report: Record<string, unknown> = {};
  put(report, 'generatedDate', str(c.meta.preparedOn));

  return { cashFlowComparison: out, client, report };
}

/**
 * Merge the projection into a binding-context `data` object.
 *
 * `cashFlowComparison` rather than `comparison`: the Property Comparison owns
 * that namespace in the one shared preview sample, and the two formats are
 * different documents about different things.
 */
export function applyCashFlowComparisonProjection(
  data: Record<string, any>,
  comparison: CashFlowComparison,
): Record<string, any> {
  const p = projectCashFlowComparison(comparison);
  const merge = (key: string, extra: Record<string, unknown>) => {
    if (!Object.keys(extra).length) return;
    const existing = data[key];
    data[key] = {
      ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
      ...extra,
    };
  };
  merge('cashFlowComparison', p.cashFlowComparison);
  merge('client', p.client);
  merge('report', p.report);
  return data;
}
