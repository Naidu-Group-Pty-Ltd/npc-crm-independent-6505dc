/**
 * Sections composed from the stored `investment_score` record.
 *
 * The score object is the one place the platform records how a verdict was
 * reached — grade, total, weighted dimension breakdown, and the four
 * strengths / weaknesses / opportunities / risks lists. Three surfaces used
 * to restate it by hand and each got something wrong:
 *
 *  - the verdict page's subtitle hardcoded "weighted across growth, location,
 *    yield, demand and risk", which misstates every variant score (the
 *    financial variant weighs cashflow and serviceability; the due-diligence
 *    variant weighs planning risk and liveability) — and printed
 *    "Graded  at  out of 100" with the holes left in whenever the record
 *    carried no score at all, which was every Strategic fork ever produced;
 *  - the Briefing asked a model to tabulate the breakdown from prose that
 *    never states it, and got N/A;
 *  - SWOT existed only as model improvisation, while the record's own four
 *    lists went unread.
 *
 * So the sentence and the sections are composed here, once, from the record —
 * and only when the record can actually say them. An absent score produces
 * no sentence and no section, never a sentence with holes.
 */

import { num, str } from './figures.pure.ts';
import { closeDoubledStops } from '../text.pure.ts';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** How each breakdown key reads in prose. Unknown keys fall back to a de-camelled label. */
export const DIMENSION_LABELS: Readonly<Record<string, string>> = {
  yieldScore: 'yield',
  growthScore: 'growth',
  locationScore: 'location',
  demandScore: 'demand',
  riskScore: 'risk',
  cashflowScore: 'cash flow',
  // What the engine MEASURES for this key is an LVR band, not a borrower's
  // capacity to service the loan (income, expenses, liabilities, a buffer
  // rate — none is an input). The audit of 291 Stone Mason Drive (QA-17)
  // found "Serviceability 80/100" read as a lender's assessment; the label
  // now names the proxy, and `scoreBasisLine` prints what each score rests on.
  serviceabilityScore: 'serviceability (LVR proxy)',
  tenantFitScore: 'tenant fit',
  planningRiskScore: 'planning risk',
  liveabilityScore: 'liveability',
};

export function dimensionLabel(key: string): string {
  const known = DIMENSION_LABELS[key];
  if (known) return known;
  return key
    .replace(/Score$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
}

interface BreakdownEntry {
  key: string;
  label: string;
  weight: number | undefined;
  score: number | undefined;
  /** The engine's own statement of what the score rests on (`details`), when it wrote one. */
  basis: string | undefined;
}

/**
 * Did the engine actually score this dimension?
 *
 * The one predicate for that question, because there were three readings of it
 * and one of them was wrong. `investment_score.breakdown.<dim>` carries
 * `excluded: true`, `hasData: false` and `weight: 0` when the engine had
 * nothing to score with — **and a placeholder `score` of 50 sitting in the
 * field regardless**. A reader that takes `.score` without asking this question
 * publishes that 50 as a measurement.
 *
 * `reportBindingProjection` asked it (`excluded === true || hasData === false`)
 * and `breakdownEntries` asked it (`(hasData ?? available) !== false` plus a
 * zero-weight test); `render-investment-report-pdf`'s
 * `extractScoreBreakdownItems` asked nothing at all, and drew the Executive
 * Summary's "Score drivers" bar chart from the raw entries. Rendered against
 * `6 Acer Court` — a record whose demand and growth dimensions are both
 * excluded — the chart plotted five bars: risk 60, yield 10, location 65,
 * **demand 50, growth 50**. The two fabricated bars sit mid-range between the
 * real ones, so nothing about the chart looks wrong.
 *
 * Exported so the renderer asks this rather than a fourth version of it.
 */
export function dimensionWasScored(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  // Generator-written breakdowns carry `hasData`; engine-written ones carry
  // `available`. Either being explicitly false means the dimension was not
  // scored and must not be tabulated as though it were.
  if (raw.excluded === true) return false;
  const flag = raw.hasData ?? raw.available;
  if (flag === false) return false;
  // A dimension that POSITIVELY says it has data was measured, and the weight
  // is not consulted.
  //
  // The zero-weight test below is right for a run that issued a grade — there,
  // an available dimension always carries a positive renormalised weight, so a
  // zero means it contributed nothing. It was wrong for a run that WITHHELD
  // one: `scoringV2Production` wrote `weight: 0` on every dimension whenever
  // `gradeIssued` was false, so all ten withheld rows in production carry
  // growth, yield and demand as `hasData: true, excluded: false, weight: 0` —
  // measured, and reported by this predicate as unscored. Every dimension
  // table on a withheld report was therefore empty, which told the reader
  // nothing about what HAD been measured at exactly the moment that is the
  // only thing worth telling them.
  //
  // The producer no longer writes that contradiction; this ordering also
  // repairs the rows that already carry it, with no migration and without
  // inventing a weight the run never formed.
  if (flag === true) return true;
  // Neither flag present — a legacy row. A dimension the engine gave no weight
  // contributed nothing to the total.
  const weight = num(raw.weight);
  return !(weight !== undefined && weight <= 0);
}

/**
 * Whether this score's own run authorised what it is about to be asked for.
 *
 * These read the stamp the scoring service wrote (`policy.*`) rather than
 * re-deriving the decision from the authority rules. Two reasons. The stamp
 * records what THAT run decided, and re-deriving it later is how a stored
 * result and a renderer come to disagree. And the investment composers may not
 * import from `market/` — a boundary `investmentSourceOfTruth.spec.ts`
 * enforces — which is the right boundary: a renderer consumes a decision, it
 * does not participate in making one.
 *
 * **Absent means historical.** A score issued before the policy carries no
 * stamp and renders exactly as it always did; withholding there would rewrite
 * what a client was already sent.
 */
function scorePolicy(score: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(score.policy) ? score.policy : null;
}

export function dimensionScoresMayBeShown(score: Record<string, unknown>): boolean {
  const policy = scorePolicy(score);
  return policy === null || policy.dimensionScoresAuthoritative !== false;
}

function overallGradeMayBeShown(score: Record<string, unknown>): boolean {
  const policy = scorePolicy(score);
  return policy === null || policy.gradeIssued !== false;
}

/**
 * The dimensions that actually carried data, in stored order.
 *
 * Empty when the score's authority may not publish dimension scores. A
 * dimension score is an ASSESSMENT produced by a methodology, and a new report
 * scored under `unavailable` has no authorised methodology — so presenting
 * V1's per-dimension numbers there would be publishing a legacy assessment
 * under the current product's name. A legacy snapshot keeps its own, because
 * that is what the client was sent.
 *
 * This says nothing about deterministic metrics: a gross yield percentage is a
 * calculation over verified inputs, it comes from the finance block rather than
 * from here, and it is published whenever it is supported.
 */
function breakdownEntries(score: unknown): BreakdownEntry[] {
  if (!isRecord(score) || !isRecord(score.breakdown)) return [];
  if (!dimensionScoresMayBeShown(score)) return [];
  const out: BreakdownEntry[] = [];
  for (const [key, raw] of Object.entries(score.breakdown)) {
    if (!isRecord(raw)) continue;
    if (!dimensionWasScored(raw)) continue;
    out.push({ key, label: dimensionLabel(key), weight: num(raw.weight), score: num(raw.score), basis: str(raw.details) ?? str(raw.basis) });
  }
  return out;
}

/**
 * "Graded B at 58 out of 100, weighted across growth, location, yield, demand
 * and risk." — or undefined when the record cannot say it. The weighting
 * clause names the dimensions this score actually carries, so a financial or
 * due-diligence variant score describes its own weights rather than the
 * composite's.
 */
/**
 * The grade a client document may print, or `undefined`.
 *
 * One rule, stated here because it was stated in two places and skipped in a
 * third. The Report Fact Contract already refused a grade whose policy did not
 * issue one AND refused the literal `'N/A'`; `gradedLine` refused on the
 * policy alone; and `reportBindingProjection` published `str(score.grade)`
 * verbatim — so on the certification record, whose `investment_score` carries
 * `grade: 'N/A'` beside `policy.gradeIssued: false`, every selectable template
 * printed **"Assessment grade  N/A · out of 100"** on the client's method
 * page.
 *
 * `'N/A'` is refused HERE, on this one field, rather than in `presenceOf` —
 * which deliberately treats `n/a` as possible real content, because a zoning
 * of "None" and a street called "Na" exist. A scoring grade is a closed
 * vocabulary; a stored `'N/A'` in it is the scorer's own sentinel for "no
 * grade was issued", never a grade.
 */
export function publishableGrade(score: unknown): string | undefined {
  if (!isRecord(score)) return undefined;
  if (!overallGradeMayBeShown(score)) return undefined;
  const grade = str(score.grade);
  if (!grade || grade.trim().toUpperCase() === 'N/A') return undefined;
  return grade;
}

/** Whether this record's authority permits publishing an overall grade at all. */
export function gradeMayBePublished(score: unknown): boolean {
  return isRecord(score) && overallGradeMayBeShown(score);
}

/**
 * How many of the assessment's dimensions carried this score, where the record
 * says and the answer is fewer than all of them.
 *
 * Read from `coverage`, which every scored record has carried since long
 * before the publication policy — so a historical row qualifies exactly as a
 * new one does, with no migration and no field invented for it.
 *
 * Null where the record does not say, or where every dimension was assessed:
 * **a full assessment is not qualified at all**, and a caveat printed on every
 * verdict is a caveat nobody reads.
 */
function assessedOfTotal(score: Record<string, unknown>): { scored: number; total: number } | null {
  const coverage = isRecord(score.coverage) ? score.coverage : undefined;
  if (!coverage) return null;
  const scored = num(coverage.dimensionsScored);
  const total = num(coverage.totalDimensions);
  if (scored === undefined || total === undefined) return null;
  if (!Number.isFinite(scored) || !Number.isFinite(total) || total <= 0) return null;
  if (scored >= total) return null;
  return { scored, total };
}

export function gradedLine(score: unknown): string | undefined {
  if (!isRecord(score)) return undefined;
  // An unauthorised engine states no verdict, whatever it computed.
  if (!overallGradeMayBeShown(score)) return undefined;
  const grade = str(score.grade);
  const total = num(score.totalScore);
  if (!grade || total === undefined) return undefined;
  const head = `Graded ${grade} at ${Math.round(total)} out of 100`;

  // S5/S6 §8 — a qualified score carries its qualification wherever it goes.
  //
  // This sentence is bound by every selectable template on the verdict page
  // and again on the closing card, and it stated a grade with no indication
  // that dimensions were unassessed. A reader counting three names in the
  // weighting clause has no way to know there should be five, so the
  // incompleteness has to be said rather than left to be inferred from a
  // list's length — which is the same rule the score line itself answers to.
  const of = assessedOfTotal(score);
  const qualifier = of ? ` — ${of.scored} of the ${of.total} assessment dimensions` : '';

  const dims = breakdownEntries(score).map((d) => d.label);
  if (dims.length < 2) return `${head}${qualifier}.`;
  const clause = dims.length === 2
    ? `${dims[0]} and ${dims[1]}`
    : `${dims.slice(0, -1).join(', ')} and ${dims[dims.length - 1]}`;
  return `${head}, weighted across ${clause}${qualifier}.`;
}

/** The graded line plus the pointer to the assessment page, for the closing card. */
export function gradedDetailLine(score: unknown): string | undefined {
  const line = gradedLine(score);
  if (!line) return undefined;
  return `${line} The weighted dimensions behind that grade are set out on the assessment page.`;
}

/**
 * `## <heading>` with grade / score / recommendation lines and the weighted
 * dimension table — or null when the record holds no score. Rows appear only
 * for dimensions that carried data (a labelled row is a promise).
 */
/**
 * The verdict itself — grade, score, the record's own recommendation, and the
 * coverage note where the score does not rest on every dimension.
 *
 * Null when the record carries no grade or no total: a verdict section with no
 * verdict in it is a heading over nothing.
 *
 * The coverage line is not a new disclosure. `InvestmentReportViewer` has
 * always shown `investment_score.coverage.partialLabel` whenever
 * `coverageRatio < 1`, and `InvestmentGradeSummary` shows it too — so staff
 * looking at the record are told the score is partial and the client reading
 * the generated document was not. Same field, same words, one more surface.
 */
function verdictLines(score: Record<string, unknown>): string[] | null {
  const grade = str(score.grade);
  const total = num(score.totalScore);
  if (!grade || total === undefined) return null;

  const lines = [`**Grade:** ${grade} · **Score:** ${Math.round(total)}/100`];
  const rec = str(score.recommendation);
  if (rec) lines.push('', `**Recommendation:** ${rec}`);

  const coverage = isRecord(score.coverage) ? score.coverage : undefined;
  const ratio = coverage ? num(coverage.coverageRatio) : undefined;
  const partial = coverage ? str(coverage.partialLabel) : undefined;
  if (partial && ratio !== undefined && ratio < 1) lines.push('', `_${partial}._`);

  // Eligibility 5.0.0: the letter follows the score, and where the evidence
  // alone would not carry it the run's own sentence says what it is. Printed
  // under the grade it qualifies, in the run's words.
  const caution = evidenceCautionLine(score);
  if (caution) lines.push('', `_${caution}_`);

  return lines;
}

/**
 * The run's own caution beside an ISSUED grade (eligibility 5.0.0), or
 * undefined. Where the evidence alone would not carry the letter the score
 * gives, the scoring service records one sentence saying what the evidence is
 * — "Capital growth is measured for Western Australia as a whole…" — and a
 * surface that prints the grade prints it beside it. Never without a grade:
 * a caution about a letter nobody prints qualifies nothing.
 */
export function evidenceCautionLine(score: unknown): string | undefined {
  if (!isRecord(score) || !publishableGrade(score)) return undefined;
  const caution = isRecord(score.evidenceCaution) ? str(score.evidenceCaution.statement) : undefined;
  return caution?.trim() ? caution.trim() : undefined;
}

/**
 * What each published score rests on, in the engine's own words.
 *
 * "Publish the score definition and input coverage with any weighted result"
 * (QA-17): the engine records a `details` string per dimension ("Gross yield:
 * 3.60%", "LVR proxy: 80% — no borrower serviceability assessment") and until
 * now nothing printed it, so a reader could not tell a measured dimension
 * from a proxy. Empty when no dimension carries a basis, so a legacy record
 * renders exactly as before.
 */
/*
 * One line per dimension, not one line for all of them.
 *
 * This printed `_Scored from: yield — … ; demand — … ; growth — … ;
 * location — …._` — every dimension's evidence joined into a single italic
 * paragraph, eleven lines on the 23 Sep 2026 Snapshot and Briefing for 97
 * Poole Road, with "p.a.." where two of the engine's sentences met. The words
 * are the engine's and are unchanged; what changed is that a reader can find
 * the dimension they are looking for. The lead-in is the Compass grade table's
 * own, so the two documents name the list the same way.
 */
export function scoreBasisLine(score: unknown): string | undefined {
  if (!isRecord(score)) return undefined;
  const dims = breakdownEntries(score).filter((d) => d.score !== undefined && d.basis);
  if (!dims.length) return undefined;
  const sentence = (text: string) => {
    const t = closeDoubledStops(text.trim());
    const opened = t.charAt(0).toUpperCase() + t.slice(1);
    return /[.!?]$/.test(opened) ? opened : `${opened}.`;
  };
  const title = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);
  return [
    '**What each dimension rested on.**',
    '',
    ...dims.map((d) => `- **${title(d.label)}.** ${sentence(d.basis!)}`),
  ].join('\n');
}

/** The weighted dimensions table. Empty when the record scored none of them. */
function dimensionLines(score: Record<string, unknown>): string[] {
  const dims = breakdownEntries(score).filter((d) => d.score !== undefined);
  if (!dims.length) return [];
  const rows = ['| Dimension | Weight | Score |', '| --- | --- | --- |'];
  for (const d of dims) {
    const label = d.label.charAt(0).toUpperCase() + d.label.slice(1);
    rows.push(`| ${label} | ${d.weight !== undefined ? `${Math.round(d.weight)}%` : '—'} | ${Math.round(d.score!)}/100 |`);
  }
  const basis = scoreBasisLine(score);
  if (basis) rows.push('', basis);
  return rows;
}

/**
 * Grade, score and recommendation on their own — the Snapshot's `Investment
 * Score` section, which the tier used to ask a model to write.
 *
 * That guide said `Recommendation: [BUY/HOLD/SELL]`. The engine's actual
 * vocabulary is `HOLD` (855 reports), `CAUTION` (99), `HOLD/BUY` (33) and `BUY`
 * (2): **`SELL` is never issued, `CAUTION` is never offered, and `HOLD/BUY`
 * cannot be spelled in three words.** A model asked to choose one of three from
 * a record that says a fourth must change the recommendation to answer.
 */
export function composeVerdictSection(score: unknown, heading: string): string | null {
  if (!isRecord(score)) return null;
  const body = verdictLines(score);
  return body ? [`## ${heading}`, '', ...body].join('\n') + '\n' : null;
}

/**
 * The dimensions table on its own — the Snapshot's `Score Breakdown`.
 *
 * The guide it replaces listed `Growth, Location, Yield, Demand, Risk` with no
 * omission rule beside it, while the two sections either side of it had one.
 * The record withholds a dimension it could not score — `excluded: true`,
 * `weight: 0` and a placeholder `score` of 50 that is not a score — on 16 of
 * the 17 reports generated since August 2026. A model handed three figures and
 * told to produce five rows fills the other two.
 */
export function composeScoreDimensionsSection(score: unknown, heading: string): string | null {
  if (!isRecord(score)) return null;
  const rows = dimensionLines(score);
  return rows.length ? [`## ${heading}`, '', ...rows].join('\n') + '\n' : null;
}

/** Verdict and dimensions under one heading — the Briefing's `scorecard`. */
export function composeScoreBreakdownSection(
  score: unknown,
  heading: string,
): string | null {
  if (!isRecord(score)) return null;
  const body = verdictLines(score);
  if (!body) return null;

  const rows = dimensionLines(score);
  const lines = [`## ${heading}`, '', ...body];
  if (rows.length) lines.push('', ...rows);
  return lines.join('\n') + '\n';
}

/**
 * What the verdict page lists to WATCH, beside what the grade credits.
 *
 * The master binds `summary.watch` and the projection filled it from
 * `weaknesses` alone. A record whose scored dimensions are all strong has
 * none, so the column was empty on exactly the reports where a reader most
 * needs the qualification — page 3 of the 60 Lawley Street Compass
 * (25 Sep 2026) printed an A+ and one strength ("Measured capital growth …
 * is strong", measured for Western Australia as a whole) with no watch point
 * at all, while the record held both a risk the scorer had recorded and the
 * run's own caution that the growth evidence is state-wide.
 *
 * Read in the record's own words, in this order, never composed:
 *
 *  1. the scorer's weaknesses — unchanged, so every record that had them
 *     prints exactly what it printed before;
 *  2. the scorer's risks;
 *  3. the run's evidence caution, where a grade is published beside it.
 *
 * Nothing is invented to fill the column: a record holding none of the three
 * still draws no watch point.
 *
 * **Only a V2 record's risks are read.** The production engine writes market
 * risks alone — rapid recent growth, extended selling times — whereas the
 * retired V1 scorer's list carries statements about the purchase ("Significant
 * negative cash flow requiring ongoing funding"), and the Compass does not
 * carry the analysis of a purchase. A record with no `v2` block keeps exactly
 * the column it always had.
 */
export function verdictWatchPoints(score: unknown): string[] {
  if (!isRecord(score)) return [];
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : [];
  const weaknesses = list(score.weaknesses);
  if (weaknesses.length || !isRecord(score.v2)) return weaknesses;
  const out = [...recordedMarketRisks(score)];
  const caution = evidenceCautionLine(score);
  if (caution) out.push(caution);
  return [...new Set(out)];
}

/**
 * The market risks the scorer recorded with a V2 grade, in its own words — or
 * none.
 *
 * One reader for the two places a client meets them: the verdict page's
 * watch points (above) and the SWOT's Threats (`buildSwot`). The 60 Lawley
 * Street Compass (25 Sep 2026) printed "Rapid recent price growth may indicate
 * market cooling ahead" as a consideration on its verdict page and "None
 * identified" under Threats fifteen pages later, because the SWOT never read
 * the list the verdict page did. V2 alone, for the reason `verdictWatchPoints`
 * gives: the retired V1 scorer's list carries statements about a PURCHASE.
 */
export function recordedMarketRisks(score: unknown): string[] {
  if (!isRecord(score) || !isRecord(score.v2) || !Array.isArray(score.risks)) return [];
  return [...new Set(score.risks.map((x) => str(x)).filter((x): x is string => !!x))];
}

/**
 * `## <heading>` with the record's own strengths / weaknesses / opportunities
 * / threats lists — groups with nothing recorded are omitted, and a score
 * carrying none of the four produces no section at all.
 */
export function composeSwotSection(score: unknown, heading: string): string | null {
  if (!isRecord(score)) return null;
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : [];
  const groups: Array<[string, string[]]> = [
    ['Strengths', list(score.strengths)],
    ['Weaknesses', list(score.weaknesses)],
    ['Opportunities', list(score.opportunities)],
    ['Threats', list(score.risks)],
  ];
  if (!groups.some(([, items]) => items.length > 0)) return null;

  const lines: string[] = [`## ${heading}`, ''];
  for (const [name, items] of groups) {
    if (!items.length) continue;
    lines.push(`### ${name}`, '');
    for (const item of items) lines.push(`- ${item}`);
    lines.push('');
  }
  return lines.join('\n');
}
