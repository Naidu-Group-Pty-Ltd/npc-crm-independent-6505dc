/**
 * Project a stored `portfolio_analysis_reports` row into the binding vocabulary
 * a Portfolio Performance Review template uses.
 *
 * ## Read from the table, not from a summary of it
 *
 * Every shape below was read off the live table across all 21 stored reports.
 * The prose in particular is not what its names suggest:
 * `analysis.executiveSummary` is an **object**, not a paragraph, and
 * `strategicRecommendations` is an object of four horizon buckets rather than a
 * list. Binding either as a string would have printed `[object Object]` on a
 * client's page — the modern equivalent of the "plausible-looking wrong output"
 * `docs/reports/BORROWING_CAPACITY.md` records.
 *
 *  - `portfolioMetrics` — totalValue, totalEquity, totalDebt, totalProperties,
 *    investmentCount, ownerOccupiedCount, rentalCount, averageLVR,
 *    averageYield, netMonthlyCashflow, totalMonthlyRentalIncome,
 *    totalMonthlyExpenses, personalExpenses, bestPerformer, worstPerformer.
 *  - `propertyAnalyses` — an **array** of per-property objects: address, value,
 *    loan, equity, lvr, grossYield, netMonthlyCashflow, annualCashflow,
 *    cashOnCashReturn, propertyType, lenderName, interestRate,
 *    ownershipPercentage, portfolioContribution, isOwnerOccupied.
 *
 *    Two things about that array are only visible from the data. **`lvr` and
 *    `grossYield` are numeric strings** — `"83.7"`, `"6.74"` — on all 66
 *    elements, so they are coerced rather than read; a projection that took
 *    them as numbers would publish nothing and blank two columns of the
 *    inventory. And **11 of the 66 have `netMonthlyCashflow`, `annualCashflow`
 *    and `monthlyRentalIncome` all JSON null** (owner-occupied holdings with no
 *    rental data). Those stay absent. `$0` a month is a claim, and it is the
 *    wrong one.
 *  - `analysis.executiveSummary` — `{ healthScore, overallHealth, keyStrengths,
 *    keyConcerns, primaryRecommendation }`, where the two `key*` fields are
 *    arrays of strings and `primaryRecommendation` is a string.
 *  - `analysis.financialHealth` — `{ analysis, cashflowStatus,
 *    debtServiceability, equityPosition, lvrRisk }`, all strings.
 *  - `analysis.riskAssessment` — `{ overallRiskLevel, concentrationRisk,
 *    vacancyRisk, interestRateSensitivity }` as strings, plus `marketRisks`
 *    (2-4) and `mitigationStrategies` (4-5) as **arrays** of strings. Nothing
 *    in the names says which is which; this was read off the table.
 *  - `analysis.strategicRecommendations` — `{ priorityActions, shortTerm,
 *    mediumTerm, longTerm }`, **all four arrays** of strings, 3-4 and 1-4.
 *  - `bestPerformer` / `worstPerformer` are whole property rows **or null**, so
 *    they are projected only when present.
 *
 * ## Units
 *
 * Measured across all 21 reports: `average_lvr` 33.17–86.57 and `average_yield`
 * 4.24–10.35 are whole-number percent, and the `percent` filter formats without
 * multiplying, so they pass through untouched. `health_score` is 25–90 — a score
 * **out of 100**, not a percentage; it is projected as a number and labelled
 * "/100" rather than set with `| percent`.
 *
 * ## What is deliberately absent
 *
 *  - `client.*` beyond the stored `client_name`. The row has `client_id`;
 *    resolving a contact is a join the caller can do.
 *  - `analysis.personalizedNarrative` and the other prose objects whose internal
 *    shape is not asserted here — projected only where the leaf is a string, so
 *    an object never reaches a template as `[object Object]`.
 */

import { buildPortfolioReview } from './reports/portfolio/normalise.pure.ts';
import type { NarrativeBlock, PortfolioReview } from './reports/portfolio/payload.pure.ts';
import { formatDelta, formatMeasure, type Measure } from './reportDesign/measure.pure.ts';

export interface PortfolioRowLike {
  client_name?: string | null;
  health_score?: number | string | null;
  overall_health?: string | null;
  portfolio_value?: number | string | null;
  total_equity?: number | string | null;
  net_monthly_cashflow?: number | string | null;
  total_properties?: number | string | null;
  average_lvr?: number | string | null;
  average_yield?: number | string | null;
  report_data?: unknown;
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

/** A string, and only a string. An object here would print `[object Object]`. */
function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s || undefined;
}

function strList(v: unknown): string[] {
  return arr(v).map((x) => str(x)).filter((x): x is string => !!x);
}

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

/** One row of the property inventory. */
function projectProperty(raw: unknown): Record<string, unknown> {
  const p = obj(raw);
  const line: Record<string, unknown> = {};
  put(line, 'address', str(p.address));
  put(line, 'propertyType', str(p.propertyType));
  put(line, 'value', num(p.value));
  put(line, 'loan', num(p.loan));
  put(line, 'equity', num(p.equity));
  put(line, 'lvr', num(p.lvr));
  put(line, 'grossYield', num(p.grossYield));
  put(line, 'monthlyRentalIncome', num(p.monthlyRentalIncome));
  put(line, 'monthlyExpenses', num(p.monthlyExpenses));
  put(line, 'netMonthlyCashflow', num(p.netMonthlyCashflow));
  put(line, 'annualCashflow', num(p.annualCashflow));
  put(line, 'cashOnCashReturn', num(p.cashOnCashReturn));
  put(line, 'interestRate', num(p.interestRate));
  put(line, 'lenderName', str(p.lenderName));
  put(line, 'ownershipPercentage', num(p.ownershipPercentage));
  put(line, 'portfolioContribution', num(p.portfolioContribution));
  if (typeof p.isOwnerOccupied === 'boolean') line.isOwnerOccupied = p.isOwnerOccupied;
  return line;
}

/** A best/worst performer, which is a whole property row or null. */
function projectPerformer(raw: unknown): Record<string, unknown> {
  const p = obj(raw);
  const out: Record<string, unknown> = {};
  put(out, 'address', str(p.address));
  put(out, 'propertyType', str(p.property_type) ?? str(p.propertyType));
  put(out, 'value', num(p.value));
  put(out, 'netMonthlyCashflow', num(p.net_monthly_cashflow) ?? num(p.netMonthlyCashflow));
  put(out, 'lender', str(p.lender_name) ?? str(p.lenderName));
  return out;
}

/**
 * The voice catalogue's own portfolio vocabulary.
 *
 * `portfolio-review` is a shipping template that predates all of this and binds
 * `portfolio.count`, `portfolio.lvr`, `portfolio.holdings.0.net` and so on. It
 * carries `report_type: 'portfolio'`, so the moment this format gained an
 * adapter it became production-ready — and a production-ready template bound to
 * a vocabulary nothing publishes renders a client's portfolio as blanks. That is
 * the exact defect `docs/reports/COVERAGE.md` records against the Compass
 * masters, and flipping the switch without this would have reintroduced it.
 *
 * Only mechanical restatements are published here. `lvr` and `grossYield` are
 * ratios of two stored totals, which is arithmetic rather than estimation;
 * `holdings` is `propertyAnalyses` under the older key names.
 *
 * Four leaves the template binds are deliberately left unresolved, because the
 * stored analysis has no counterpart and a plausible-looking guess on a client's
 * page is worse than a gap:
 *
 *  - `portfolio.growth12m` — no growth series is stored at portfolio level.
 *  - `portfolio.scores.*` — four rated category notes the analysis never writes.
 *  - `portfolio.recommendation.{headline,body}` — the analysis has one
 *    recommendation string, not a headline and a body, and splitting one into
 *    two invents an emphasis nobody wrote.
 *  - `portfolio.actions.*.{owner,timing}` — `priorityActions` is a list of
 *    strings with no owner and no due date attached.
 *
 * `portfolio-comparison` also carries `report_type: 'portfolio'` and binds
 * `drag.*`, `ranking.*` and `equity.*` — per-property growth, maintenance
 * history and equity-release scenarios. None of that is in
 * `portfolio_analysis_reports` at all, so it stays a preview-only document in
 * practice whatever the card says.
 */
function voiceAliases(
  metrics: Record<string, unknown>,
  exec: Record<string, unknown>,
  fin: Record<string, unknown>,
  recs: Record<string, unknown>,
  properties: Record<string, unknown>[],
  totals: { value?: number; debt?: number; monthlyRentalIncome?: number; annualCashflow?: number },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'count', num(metrics.totalProperties));
  put(out, 'netCashFlow', totals.annualCashflow);

  if (totals.value) {
    put(out, 'lvr', totals.debt === undefined ? undefined : (totals.debt / totals.value) * 100);
    // Weighted on value, which is what "gross yield" means for a portfolio and
    // is not the same number as `averageYield` (the mean of the per-property
    // yields). Both are correct; publishing the mean under this name would be
    // quietly answering a different question.
    put(out, 'grossYield', totals.monthlyRentalIncome === undefined
      ? undefined
      : ((totals.monthlyRentalIncome * MONTHS_PER_YEAR) / totals.value) * 100);
  }

  const holdings = properties.map((p) => {
    const h: Record<string, unknown> = {};
    put(h, 'address', p.address);
    put(h, 'value', p.value);
    put(h, 'debt', p.loan);
    put(h, 'equity', p.equity);
    put(h, 'yield', p.grossYield);
    put(h, 'net', p.annualCashflow);
    return h;
  }).filter((h) => Object.keys(h).length > 0);
  if (holdings.length) out.holdings = holdings;

  const strength = strList(exec.keyStrengths);
  const watch = strList(exec.keyConcerns);
  if (strength.length) out.strength = strength;
  if (watch.length) out.watch = watch;
  put(out, 'narrative', str(fin.analysis));

  const actions = strList(recs.priorityActions);
  if (actions.length) out.actions = actions.map((action) => ({ action }));

  return out;
}

export interface ProjectedPortfolio {
  portfolio: Record<string, unknown>;
  properties: Record<string, unknown>[];
  summary: Record<string, unknown>;
  health: Record<string, unknown>;
  risk: Record<string, unknown>;
  actions: Record<string, unknown>;
  client: Record<string, unknown>;
  report: Record<string, unknown>;
}

export function projectPortfolio(row: PortfolioRowLike): ProjectedPortfolio {
  const data = obj(row.report_data);
  const metrics = obj(data.portfolioMetrics);
  const analysis = obj(data.analysis);
  const exec = obj(analysis.executiveSummary);
  const fin = obj(analysis.financialHealth);
  const riskRaw = obj(analysis.riskAssessment);
  const recs = obj(analysis.strategicRecommendations);

  // ── headline portfolio figures ────────────────────────────────────────────
  const monthlyCashflow = num(row.net_monthly_cashflow) ?? num(metrics.netMonthlyCashflow);
  const portfolio: Record<string, unknown> = {};
  // Typed columns win over the jsonb copy: they are what the list view reads.
  put(portfolio, 'value', num(row.portfolio_value) ?? num(metrics.totalValue));
  put(portfolio, 'equity', num(row.total_equity) ?? num(metrics.totalEquity));
  put(portfolio, 'debt', num(metrics.totalDebt));
  put(portfolio, 'propertyCount', num(row.total_properties) ?? num(metrics.totalProperties));
  put(portfolio, 'investmentCount', num(metrics.investmentCount));
  put(portfolio, 'ownerOccupiedCount', num(metrics.ownerOccupiedCount));
  put(portfolio, 'averageLvr', num(row.average_lvr) ?? num(metrics.averageLVR));
  put(portfolio, 'averageYield', num(row.average_yield) ?? num(metrics.averageYield));
  put(portfolio, 'monthlyCashflow', monthlyCashflow);
  put(portfolio, 'annualCashflow', monthlyCashflow === undefined ? undefined : monthlyCashflow * MONTHS_PER_YEAR);
  put(portfolio, 'monthlyRentalIncome', num(metrics.totalMonthlyRentalIncome));
  put(portfolio, 'monthlyExpenses', num(metrics.totalMonthlyExpenses));

  const best = projectPerformer(metrics.bestPerformer);
  if (Object.keys(best).length) portfolio.bestPerformer = best;
  const worst = projectPerformer(metrics.worstPerformer);
  if (Object.keys(worst).length) portfolio.worstPerformer = worst;

  // ── the inventory ─────────────────────────────────────────────────────────
  const properties = arr(data.propertyAnalyses)
    .map(projectProperty)
    .filter((p) => Object.keys(p).length > 0);

  // ── model-authored assessment ─────────────────────────────────────────────
  // `health_score` is 25-90 across the sample: a score out of 100, NOT a
  // percentage. It is labelled "/100" rather than set with `| percent`.
  const summary: Record<string, unknown> = {};
  put(summary, 'healthScore', num(row.health_score) ?? num(exec.healthScore));
  put(summary, 'overallHealth', str(row.overall_health) ?? str(exec.overallHealth));
  put(summary, 'primaryRecommendation', str(exec.primaryRecommendation));
  const strengths = strList(exec.keyStrengths);
  const concerns = strList(exec.keyConcerns);
  if (strengths.length) summary.strengths = strengths;
  if (concerns.length) summary.concerns = concerns;

  const health: Record<string, unknown> = {};
  put(health, 'analysis', str(fin.analysis));
  put(health, 'cashflowStatus', str(fin.cashflowStatus));
  put(health, 'debtServiceability', str(fin.debtServiceability));
  put(health, 'equityPosition', str(fin.equityPosition));
  put(health, 'lvrRisk', str(fin.lvrRisk));

  // The stored key names are kept verbatim rather than shortened, and that is
  // not laziness. `risk` is a namespace the voice templates already use for the
  // client's risk *profile* — `{{risk.vacancy}}` is "Reaction to 3 months
  // vacancy", a tolerance statement — so publishing a portfolio vacancy-risk
  // assessment under the same leaf would silently replace it wherever both
  // vocabularies share a data object (the preview sample being the obvious one).
  // Mirroring `riskAssessment`'s own names sidesteps every collision and makes
  // each binding traceable back to the column it came from.
  // Four of these are strings and two are **arrays of strings**, measured across
  // all 21 stored reports rather than inferred from the names — and the names
  // do not tell you which is which. `marketRisks` (2-4 entries) and
  // `mitigationStrategies` (4-5) are lists on every row; `concentrationRisk`,
  // `vacancyRisk` and `interestRateSensitivity` are single sentences on every
  // row, despite reading like they would pluralise the same way.
  //
  // Getting this wrong is silent in both directions: bound as prose an array
  // prints `[object Object]`, and refused as a non-string it prints nothing at
  // all. The first draft here did the second, which would have left two of the
  // risk page's five fields blank on every report ever generated.
  const risk: Record<string, unknown> = {};
  put(risk, 'overallRiskLevel', str(riskRaw.overallRiskLevel));
  put(risk, 'concentrationRisk', str(riskRaw.concentrationRisk));
  put(risk, 'vacancyRisk', str(riskRaw.vacancyRisk));
  put(risk, 'interestRateSensitivity', str(riskRaw.interestRateSensitivity));
  const marketRisks = strList(riskRaw.marketRisks);
  const mitigations = strList(riskRaw.mitigationStrategies);
  if (marketRisks.length) risk.marketRisks = marketRisks;
  if (mitigations.length) risk.mitigationStrategies = mitigations;

  // All four are arrays of strings on all 21 rows — the three horizons included,
  // which read like single statements and are not. `priorityActions` runs 3-4
  // entries and each horizon 1-4.
  const actions: Record<string, unknown> = {};
  for (const key of ['priorityActions', 'shortTerm', 'mediumTerm', 'longTerm'] as const) {
    const list = strList(recs[key]);
    if (list.length) actions[key === 'priorityActions' ? 'priority' : key] = list;
  }

  // The older vocabulary the shipping voice template binds. Its names are
  // disjoint from the ones above — `count` against `propertyCount`, `lvr`
  // against `averageLvr`, `netCashFlow` against `annualCashflow` — because they
  // are not always the same statistic, and one key answering two questions is
  // how a portfolio's weighted LVR comes to be printed as its mean.
  Object.assign(portfolio, voiceAliases(metrics, exec, fin, recs, properties, {
    value: num(portfolio.value),
    debt: num(portfolio.debt),
    monthlyRentalIncome: num(portfolio.monthlyRentalIncome),
    annualCashflow: num(portfolio.annualCashflow),
  }));

  const client: Record<string, unknown> = {};
  put(client, 'name', str(row.client_name) ?? str(data.clientName));

  const report: Record<string, unknown> = {};
  put(report, 'generatedDate', str(row.updated_at) ?? str(row.created_at) ?? str(data.generatedAt));

  return { portfolio, properties, summary, health, risk, actions, client, report };
}

// ─────────────────────────────────────────────────────────────────────────────
// The legacy document's own structure, restated
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collection caps for the document-shaped section, measured by running all 21
 * stored reports (paired with each client's newest completed review, the join
 * `render-portfolio-review-pdf` itself performs) through the legacy
 * `buildPortfolioReview`:
 *
 *  | collection          | max in production | cap |
 *  | ------------------- | ----------------- | --- |
 *  | verdicts            | 4                 | 6   |
 *  | projection assumpts | 6                 | 8   |
 *  | scenarios           | 4 (of legacy 12)  | 6   |
 *  | review findings     | 5                 | 8   |
 *  | merged action rows  | 21 (of legacy 24) | 24  |
 *
 * The action rows keep the legacy's own cap: they are published for the
 * cascade (a custom template, or the day a page model can paginate them) and
 * bound nowhere in the seeded masters — twenty-one rows of 345-character
 * titles measured out at over two fixed-position pages, and a six-row excerpt
 * of a priority-ordered list would silently drop the review's own entries.
 */
export const DOCUMENT_CAPS = {
  verdicts: 6,
  projectionAssumptions: 8,
  scenarios: 6,
  reviewFindings: 8,
  actionRows: 24,
} as const;

/** `formatMeasure`, as absence rather than an em dash mid-template. */
function fm(m: Measure | null | undefined): string | undefined {
  if (!m || m.unit === 'none') return undefined;
  const s = formatMeasure(m);
  return s === '' || s === '—' ? undefined : s;
}

/** A built narrative block, published in its own composition. */
function projectNarrativeBlock(block: NarrativeBlock | null): Record<string, unknown> | undefined {
  if (!block) return undefined;
  const out: Record<string, unknown> = {};
  if (block.paragraphs.length) out.paragraphs = [...block.paragraphs];
  if (block.facts.length) out.facts = block.facts.map((f) => ({ label: f.label, value: f.value }));
  if (block.bullets.length) {
    out.groups = block.bullets.map((g) => ({ label: g.label, items: [...g.items] }));
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The legacy document's sections, from `buildPortfolioReview` itself.
 *
 * Everything here goes through the legacy normaliser rather than being
 * re-derived — the built narrative's sentences, the band vocabulary, a
 * verdict's pairing of ranking with review score, a scenario's impact split
 * into delta and level. A second implementation of any of it would drift, and
 * the drift would read as a different assessment of the same portfolio.
 *
 * Published under the format's own `portfolio.*` namespace (and two additive
 * `summary` leaves), because the shared sample data is one object serving
 * every format's preview: `market`, `review` and `scenarios` all mean
 * something else to another catalogue, and a colliding leaf previews one
 * format's prose on another format's page.
 */
export function projectPortfolioDocument(doc: PortfolioReview): {
  portfolio: Record<string, unknown>;
  summary: Record<string, unknown>;
} {
  const portfolio: Record<string, unknown> = {};
  const summary: Record<string, unknown> = {};

  // ── the headline, in the document's own vocabulary ───────────────────────
  put(summary, 'band', doc.headline.band === 'unrated' ? undefined : doc.headline.band);
  put(summary, 'bandLabel', doc.headline.bandLabel === 'Not rated' ? undefined : doc.headline.bandLabel);

  // The built two-sentence description — figures restated from the totals, so
  // it cannot disagree with the tables beside it. Not `portfolio.narrative`,
  // which the shipping voice template already binds as the financial-health
  // analysis prose.
  put(portfolio, 'overview', str(doc.narrative));
  if (doc.notes.length) portfolio.notes = [...doc.notes];

  // ── the narrative sections, as the legacy composes them ──────────────────
  put(portfolio, 'composition', projectNarrativeBlock(doc.composition));
  put(portfolio, 'market', projectNarrativeBlock(doc.market));
  put(portfolio, 'growth', projectNarrativeBlock(doc.growth));

  // ── per-property verdicts: the ranking beside the review's rubric ────────
  if (doc.verdicts.length) {
    const rows = doc.verdicts.slice(0, DOCUMENT_CAPS.verdicts).map((v) => {
      const row: Record<string, unknown> = {};
      put(row, 'address', str(v.address));
      put(row, 'rating', str(v.rating));
      put(row, 'scoreLabel', fm(v.score));
      put(row, 'recommendation', str(v.recommendation));
      put(row, 'strategicRole', str(v.strategicRole));
      put(row, 'outlook', str(v.outlook));
      if (v.strengths.length) row.strengths = [...v.strengths];
      if (v.concerns.length) row.concerns = [...v.concerns];
      // The review's own classification of the same property, attributed —
      // the two sources are produced independently and do disagree, and the
      // disagreement is something the reader should see.
      put(row, 'reviewClassification', v.review ? str(v.review.classification) : undefined);
      return row;
    }).filter((r) => Object.keys(r).length > 0);
    if (rows.length) {
      portfolio.verdicts = { rows };
      put(portfolio.verdicts as Record<string, unknown>, 'rowCount', doc.verdicts.length);
    }
  }

  // ── forward-looking blocks, figures formatted by the engine ──────────────
  if (doc.projection) {
    const p: Record<string, unknown> = {};
    put(p, 'yearsLabel', fm(doc.projection.years));
    put(p, 'valueLabel', fm(doc.projection.projectedValue));
    put(p, 'equityLabel', fm(doc.projection.projectedEquity));
    put(p, 'cashflowLabel', fm(doc.projection.projectedMonthlyCashflow));
    put(p, 'summary', str(doc.projection.summary));
    const assumptions = doc.projection.assumptions.slice(0, DOCUMENT_CAPS.projectionAssumptions);
    if (assumptions.length) p.assumptions = [...assumptions];
    if (Object.keys(p).length) portfolio.projection = p;
  }

  if (doc.capacity) {
    const c: Record<string, unknown> = {};
    put(c, 'estimatedLabel', fm(doc.capacity.estimatedCapacity));
    put(c, 'deployedLabel', fm(doc.capacity.totalDebtDeployed));
    put(c, 'availableLabel', fm(doc.capacity.availableCapacity));
    put(c, 'utilisationLabel', fm(doc.capacity.utilisation));
    put(c, 'commentary', str(doc.capacity.commentary));
    if (Object.keys(c).length) portfolio.capacity = c;
  }

  // ── the review's what-ifs: a delta and a level, never one number ─────────
  if (doc.scenarios.length) {
    const rows = doc.scenarios.slice(0, DOCUMENT_CAPS.scenarios).map((s) => {
      const row: Record<string, unknown> = {};
      put(row, 'name', str(s.name));
      put(row, 'description', str(s.description));
      // Signed, so a reader can tell the change from the position without
      // reading the column head; a zero delta is an em dash, never `+$0`.
      put(row, 'changeLabel', s.cashFlowChange.unit === 'none' ? undefined : formatDelta(s.cashFlowChange));
      put(row, 'resultLabel', fm(s.newNetCashflow));
      return row;
    }).filter((r) => typeof r.name === 'string');
    if (rows.length) portfolio.scenarios = { rows };
  }

  // ── the review beside the analysis ───────────────────────────────────────
  if (doc.review) {
    const r: Record<string, unknown> = {};
    put(r, 'statusLabel', str(doc.review.status));
    put(r, 'reviewedOn', str(doc.review.reviewedOn));
    put(r, 'nextReviewDue', str(doc.review.nextReviewDue ?? undefined));
    put(r, 'riskLevel', str(doc.review.riskLevel));
    put(r, 'summary', str(doc.review.summary));
    if (doc.review.scores.length) {
      r.scores = doc.review.scores
        .map((s) => ({ label: s.label, scoreLabel: fm(s.score) }))
        .filter((s) => s.scoreLabel);
    }
    const findings = doc.review.findings.slice(0, DOCUMENT_CAPS.reviewFindings);
    if (findings.length) r.findings = [...findings];
    if (Object.keys(r).length) portfolio.review = r;
  }

  // ── the merged action plan, for the cascade ──────────────────────────────
  // Analysis horizons and review recommendations in one priority-ordered
  // list, exactly as `toActions` merges them. Not `portfolio.actions`: the
  // voice template binds that as an array, and an object would break it.
  if (doc.actions.length) {
    portfolio.actionPlan = {
      rows: doc.actions.slice(0, DOCUMENT_CAPS.actionRows).map((a) => {
        const row: Record<string, unknown> = {};
        put(row, 'title', str(a.title));
        put(row, 'detail', str(a.detail));
        put(row, 'priorityLabel', str(a.priorityLabel));
        put(row, 'category', str(a.category));
        put(row, 'sourceLabel', a.source === 'review' ? 'The review' : 'The analysis');
        if (a.steps.length) row.steps = [...a.steps];
        return row;
      }),
    };
  }

  return { portfolio, summary };
}

/**
 * Merge the projection into a binding-context `data` object.
 *
 * `reviewRow` is the client's newest **completed** `portfolio_reviews` row, or
 * null — the join `render-portfolio-review-pdf` performs before it builds the
 * same document. The caller does the join for the same reason it hands the
 * Borrowing Capacity projection a client row: a pure module does not query,
 * and which review counts is the route's stated contract, not a guess made
 * here. Without it the document still builds; the review section, its
 * scenarios and its per-property scores are simply absent, which is exactly
 * how the legacy route renders `includeReview: false`.
 */
export function applyPortfolioProjection(
  data: Record<string, any>,
  row: PortfolioRowLike,
  reviewRow?: Record<string, unknown> | null,
): Record<string, any> {
  const p = projectPortfolio(row);
  const merge = (key: string, extra: Record<string, unknown>) => {
    if (!Object.keys(extra).length) return;
    data[key] = { ...obj(data[key]), ...extra };
  };
  merge('portfolio', p.portfolio);
  merge('summary', p.summary);
  merge('health', p.health);
  merge('risk', p.risk);
  merge('actions', p.actions);
  merge('client', p.client);
  merge('report', p.report);
  if (p.properties.length) data.properties = p.properties;

  /*
   * The document-shaped section goes through the legacy `buildPortfolioReview`
   * itself. It throws on a row with no holdings — a portfolio review of no
   * properties is a different document, and `generate-portfolio-analysis`
   * refuses to produce one — so a row that cannot build a document publishes
   * none of these namespaces rather than a fabricated shell.
   */
  try {
    const doc = buildPortfolioReview({
      report: row as Record<string, unknown>,
      review: reviewRow ?? null,
      clientName: str(row.client_name) ?? 'the client',
      now: str(row.updated_at) ?? str(row.created_at) ?? '',
    });
    const extras = projectPortfolioDocument(doc);
    merge('portfolio', extras.portfolio);
    merge('summary', extras.summary);
  } catch {
    // A row the legacy engine refuses is a row these sections stay absent for.
  }

  return data;
}
