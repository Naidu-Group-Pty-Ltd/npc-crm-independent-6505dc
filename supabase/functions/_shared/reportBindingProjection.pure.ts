/**
 * Project a stored `investment_reports` row into the binding vocabulary the
 * seeded template catalogue actually uses.
 *
 * ## Why this exists
 *
 * The catalogue and the adapter disagreed about names, and nothing said so.
 * Measured against the 50 Investment Compass masters and 1,182 production
 * reports: **79 of their 80 bindings resolved to nothing**. The only survivor
 * was `property.zoning`, because that is the one key whose spelling happened to
 * match. Three independent causes:
 *
 *  - **Case.** Templates bind `property.yearBuilt`, `property.type`,
 *    `property.landArea`; `property_specs` stores `year_built`,
 *    `property_type`, `land_size_sqm`.
 *  - **Depth.** Templates bind `financials.grossYield` and
 *    `financials.weeklyRent`; the stored object nests those under
 *    `keyMetrics.grossRentalYield` and `income.weeklyRent`. The adapter's
 *    `flatten()` is `{ ...obj }` — a shallow spread that never flattened a path.
 *  - **Location.** Templates bind `property.address`; the adapter publishes it
 *    as `report.address`.
 *
 * This is why `docs/reports/COVERAGE.md` records **zero of 1,162 investment
 * reports** rendered by this system: the templates were never wrong-looking in
 * preview, because preview runs on `SAMPLE_REPORT_DATA`, which is written in
 * the catalogue's vocabulary rather than the database's.
 *
 * The projection is **additive**. Callers merge it over the raw namespaces, so
 * `property.year_built` and `financials.keyMetrics` keep working for anything
 * already bound to them.
 *
 * ## The rule this module is built on
 *
 * **Project what exists; leave absent what does not.** A key is emitted only
 * when its source is present, so an unmapped binding renders empty exactly as
 * it does today rather than printing a fabricated number. "A misread number in
 * a client's financial report is this programme's top risk" — inventing one is
 * strictly worse than leaving the line blank.
 *
 * Deliberately NOT projected, because no source exists in the row (verified
 * against production, not assumed — do not "helpfully" fill these in):
 *
 *  - `financials.breakEvenRent` — derivable in principle, but it is a NEW
 *    financial claim rather than a restatement of a stored one. It belongs in
 *    the calculator that owns the numbers, not in a display projection.
 *  - `financials.narrative`, `financials.fundingNote`, `summary.narrative`,
 *    `property.rationale` — prose with no dedicated column.
 *  - `market.*` — `location_intelligence` holds amenities, commute,
 *    coordinates, healthcare, lifestyle, schools, transport and walkScore. It
 *    carries no postcode, state, suburb count or market narrative.
 *  - `assumptions.rentalGrowth` — `assumptions` holds capitalGrowth, cpiGrowth
 *    and occupancyWeeks. CPI is not rental growth and must not stand in for it.
 *  - `assumptions.taxRate` — `cashFlow.taxRate` is null across the sample.
 *  - `assumptions.sellingCosts`, `financials.loanFees` — no source. (LMI is not
 *    a loan fee.)
 *  - `risks.N.why`, `risks.N.action`, `recommendation.rationale` —
 *    `investment_score.risks` is an array of plain **strings** and
 *    `investment_score.recommendation` is a single **string**. There is no
 *    second field to put in those columns.
 *  - `property.suburb`, `property.condition`, `property.tenancy` — no column.
 *    Suburb is parseable from the address string, and that is exactly the kind
 *    of guess that puts the wrong suburb on a client's report.
 *  - `author.*`, `client.*` — there is no `profiles` table for an adviser and
 *    no client-name column on this row (`client_property_id` is set on 2 of the
 *    1,182). The masters no longer bind either.
 *  - `property.images.*` — no adapter emits photographs; see
 *    `docs/template-library/07-investment-compass-families.md`.
 *
 * `org.*` was on that list until August 2026 and should not have been. The
 * sentence "organisation data lives outside this row" is true of the *row* and
 * was read for four months as though it meant no source existed. One does —
 * `whitelabel_settings`, the table the Branding page writes — and every adapter
 * now merges it. See `organisationProjection.pure.ts`.
 *
 * ## What the templates stopped binding
 *
 * The list above was, for most of its entries, a list of things the catalogue
 * bound anyway. Measured against a report taken verbatim from production, **49
 * of the masters' 80 paths resolved to nothing** — and an unresolved binding
 * renders as the empty string, so a page of them is a page of labels with
 * nothing beside them, not a page that looks broken.
 *
 * The masters were re-pointed rather than the projection widened, because the
 * entries above genuinely have no source and inventing one is the worse
 * outcome. Two got a real source instead:
 *
 *  - `assessment` — `investment_score.breakdown`, five weighted dimensions with
 *    a score and a `details` sentence each. It replaced a three-row risk
 *    register bound to `risks.0..2` when `risks` never holds more than one, and
 *    a narrative page whose four paragraphs all bound `market.*`.
 *  - `tenYear.equitySeries` — `financial_calculations.projections.moderate`, on
 *    162 reports. The projection page's chart bound it and nothing published
 *    it, so the one chart in the format drew an empty plot on every report.
 *
 * ## Units
 *
 * Percentages are stored as whole-number percent (gross yield 0–7.51, interest
 * rate 3.0–6.5, capital growth 0–26.6 across 400 sampled reports), and the
 * `percent` filter formats without multiplying (`6.5` → `"6.50%"`). So
 * percentages pass through untouched. Getting this backwards is a 100× error on
 * a client's financial report, which is why it was measured rather than
 * inferred.
 *
 * Weekly figures are `annual / 52` — a unit conversion, not a model.
 *
 * `annualRent` is the CONTRACTUAL rent (`weeklyRent × 52`, or the record's own
 * `income.annualRent`), because that is the basis the stored yields rest on and
 * the figure a template prints as a bare "p.a." beside the weekly rent. It used
 * to be `weeklyRent × occupancyWeeks` — a third quantity agreeing with neither
 * the record nor the yield beside it. The occupancy assumption keeps its own
 * figure under `annualRentAtOccupancy`; `rentBasis.pure.ts` decides both, and
 * the composed financial chapters read the same module so the tile and the
 * table cannot drift.
 */
import { assessmentReadings } from './reports/investment/assessmentReadings.pure.ts';
import { REPORT_BODY_LIMITS, renderMarkdown } from './reports/markdown.pure.ts';
import {
  DEFAULT_LINES_PER_PAGE,
  packMarkdownPages,
  packNarrativePages,
  resolveNarrativeProfile,
} from './reports/markdownPaging.pure.ts';
import { stripBakedCover } from './reports/investment/narrativeClean.pure.ts';
import { NARRATIVE_CHAPTER_SLOTS, runningChapters } from './reports/runningChapters.pure.ts';
import { planningChartContext, vizDirectiveRenderer } from './reports/vizFigures.pure.ts';
import { reconcileStoredFinancials } from './reports/investment/financialEngine.pure.ts';
import { readAnnualRent } from './reports/investment/rentBasis.pure.ts';
import { rentIsEstablished } from './reports/investment/rentalEvidence.pure.ts';
import { gradedDetailLine, gradedLine, publishableGrade } from './reports/investment/scoreSections.pure.ts';
import { OVERALL_GRADE_UNAVAILABLE } from './reports/market/scoringInputPolicy.pure.ts';
import { DOCUMENT_IDENTITY, documentTitleForTier } from './reports/investment/tierIdentity.pure.ts';
import { contentPolicyFor } from './reports/investment/tierContent.pure.ts';

/** Loose row shape — the caller passes the `investment_reports` row as stored. */
export interface InvestmentReportRowLike {
  property_address?: string | null;
  report_tier?: string | null;
  property_specs?: Record<string, unknown> | null;
  manual_overrides?: Record<string, unknown> | null;
  financial_calculations?: Record<string, unknown> | null;
  investment_score?: Record<string, unknown> | null;
  updated_at?: string | null;
  created_at?: string | null;
  [k: string]: unknown;
}

const WEEKS_PER_YEAR = 52;

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** A finite number, or undefined. Strings are accepted because jsonb numerics arrive as either. */
function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** A non-empty trimmed string, or undefined. */
function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : [];
}

/** Per-week from a per-year figure. Undefined in, undefined out. */
function weekly(annual: number | undefined): number | undefined {
  return annual === undefined ? undefined : annual / WEEKS_PER_YEAR;
}

/**
 * The sum of cost components, or undefined where the record states none.
 *
 * A component the record does not carry contributes nothing rather than
 * zero — `rentalEvidence`'s rule applied to costs — so a sum over
 * components that are all absent is itself absent, and `put` then omits the
 * key rather than publishing a figure nobody stated. A component that IS
 * present contributes even at zero, because a stated nil is a fact.
 */
function sumCosts(...parts: unknown[]): number | undefined {
  let total: number | undefined;
  for (const part of parts) {
    const value = num(part);
    if (value === undefined) continue;
    total = (total ?? 0) + value;
  }
  return total;
}

/**
 * Assign only defined values.
 *
 * This is the whole "absent stays absent" rule in one function: writing
 * `undefined` onto the object would still create the key, and a template that
 * finds the key renders whatever it holds rather than falling through to empty.
 */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

/** `3 bed · 2 bath · 1 car`, from whichever parts are present. */
function configuration(spec: (...keys: string[]) => unknown): string | undefined {
  const parts: string[] = [];
  const bed = num(spec('bedrooms'));
  const bath = num(spec('bathrooms'));
  const car = num(spec('parking', 'carSpaces', 'car_spaces'));
  if (bed !== undefined) parts.push(`${bed} bed`);
  if (bath !== undefined) parts.push(`${bath} bath`);
  if (car !== undefined) parts.push(`${car} car`);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * The verdict as a figure: `HOLD`, not the sentence that explains it.
 *
 * `investment_score.recommendation` is one string carrying both — "HOLD -
 * Above average investment with some positive indicators, monitor closely",
 * 69 characters on average and 78 at its longest. A KPI cell is a quarter of
 * the cover's measure, about 28mm, and a sentence that long needs five lines
 * in it: rendered through WeasyPrint the cover's VERDICT cell ran past the
 * band's bottom rule, which struck through its last line.
 *
 * The split is exact rather than a guess. Every one of the 988 scored reports
 * is either `ACTION - sentence` or the bare action, and the vocabulary is four
 * words:
 *
 * | action | with a sentence | bare |
 * | --- | ---: | ---: |
 * | `HOLD` | 799 | 56 |
 * | `CAUTION` | 98 | 1 |
 * | `HOLD/BUY` | 24 | 9 |
 * | `BUY` | 1 | 0 |
 *
 * The longest action is eight characters. A string that does not match the
 * pattern is returned whole — the caller gets the same thing `headline` would
 * have given it, which is what it printed before this existed.
 */
function recommendationAction(headline: string | undefined): string | undefined {
  if (!headline) return undefined;
  const match = /^([A-Z][A-Za-z/ ]{1,20}?)\s+-\s+\S/.exec(headline);
  return match ? match[1].trim() : headline;
}

/**
 * The verdict CLAIM, separated from the coverage sentence appended after it.
 *
 * This paragraph used to end "`headline` is untouched, and the page-3 verdict
 * block still sets the whole sentence, where there is a full measure to set it
 * in." That was true when it was written and measured — the vocabulary in
 * `RECOMMENDATION_BY_GRADE` runs 59 to **89** characters, which sets in two
 * lines at the verdict page's 27pt.
 *
 * `qualifyRecommendation` then began appending a second sentence whenever the
 * run measured fewer than all five dimensions:
 *
 *     HOLD - Average investment with mixed indicators, monitor market
 *     conditions. Assessed on 4 of 5 dimensions: capital growth, location,
 *     rental yield and demand.
 *
 * **156 characters**, measured on the 42 Patya Circuit report of 19 Sep 2026.
 * That needs five lines where the block declares two, and the masters position
 * every block at an absolute `y` — so it did not overflow the page, it printed
 * ON TOP of the KPI band beneath it. `$1,975,000` and `$850` were struck
 * through by the heading's last two lines, and the strapline under them was
 * unreadable. `callout(…, 72)` and `decision(…, 104)` are the declared heights
 * it broke.
 *
 * Nothing is dropped and nothing is truncated. The appended sentence is split
 * off at the boundary `qualifyRecommendation` itself creates, and the CLAIM
 * alone binds the heading.
 *
 * The scope sentence is not published. It was, as `scopeNote`, "so a master
 * may set it at body size where it belongs" — and no master ever did: across
 * `scripts/template-library/`, the six `{{recommendation.*}}` paths any master
 * binds are `action`, `grade`, `gradedDetailLine`, `gradedLine`, `headline`
 * and `rationale`. Nothing is lost by dropping it, for the reason the sentence
 * above already gave: `gradedLine` names the same dimensions one line below,
 * and it IS drawn — the 9 Hollow Street Compass of 20 Sep 2026 prints
 * "Graded B+ at 65 out of 100, weighted across yield, growth and location —
 * 3 of the 5 assessment dimensions" on pages 3 and 5. Publishing a second copy
 * for a master to draw would put the coverage on the page twice.
 *
 * `splitVerdictScope` still returns the scope: the split is what keeps it out
 * of the heading, and a caller that wants it has it.
 *
 * The split is exact rather than a guess: it matches only the sentence that
 * appender writes, anchored at the end. Anything else is returned whole, which
 * is what every caller had before this existed.
 */
export function splitVerdictScope(
  headline: string | undefined,
): { claim: string | undefined; scope: string | undefined } {
  if (!headline) return { claim: undefined, scope: undefined };
  const match = /^(.*?)\.\s+(Assessed on \d+ of \d+ dimensions:[^.]*\.)\s*$/s.exec(headline.trim());
  if (!match) return { claim: headline, scope: undefined };
  return { claim: `${match[1].trim()}.`, scope: match[2].trim() };
}

/**
 * The specification, read from the two columns it actually lives in.
 *
 * This mirrors `reports/investment/normalise.pure.ts`'s `toSpecs`, which took
 * the same fallback when the flowing report was measured against production —
 * and it had to be mirrored here because the templated path is a different
 * reader of the same two columns, and it was still reading only one of them.
 * Counted on the whole table, 2026-08-16:
 *
 * | field | `property_specs` | `financial_calculations.propertySpecs` |
 * | --- | ---: | ---: |
 * | land size | **0** of 1,187 | 114, as `landSizeSqm` |
 * | building size | **0** | 114, as `buildSizeSqm` |
 * | parking | **0** | 34, as `carSpaces` |
 * | property type | 1,059 | 34, as `propertyType` |
 * | year built / zoning / council | **0** | absent |
 *
 * So `property.landArea` and `property.buildingArea` were unresolvable on every
 * one of the 1,187 rows through this projection, while the record held both on
 * 114 of them. Note `buildSizeSqm`: not `building_size_sqm`, not
 * `buildingSizeSqm` — both of which read naturally and neither of which exists
 * on any row.
 *
 * `property_specs` wins wherever it holds a value: it is the column the intake
 * writes, and the other is a by-product of the finance run.
 */
function specReader(
  ...sources: Array<Record<string, unknown>>
): (...keys: string[]) => unknown {
  return (...keys: string[]): unknown => {
    // Source order is precedence, and it is checked source-by-source rather
    // than key-by-key: the first SOURCE that answers any of the keys wins, so
    // a stored spec is never overridden by an operator's entry for the same
    // attribute under a different spelling.
    for (const source of sources) {
      for (const key of keys) {
        const v = source[key];
        if (v !== undefined && v !== null && v !== '') return v;
      }
    }
    return undefined;
  };
}

/**
 * What each Investment tier's document is CALLED, and the line under its
 * cover title. One vocabulary, translated here and bound by the masters —
 * never spelled per family, because ten families times five layouts is how
 * one wording change becomes fifty edits.
 */
/**
 * The tier vocabulary lives beside the investment modules (`tierIdentity.pure.ts`)
 * so the file-name rule can import it as a sibling; it is re-exported here for
 * every reader that already resolves it through the projection.
 */
export { DOCUMENT_IDENTITY, documentTitleForTier };
export { contentPolicyFor };

export interface ProjectedNamespaces {
  property: Record<string, unknown>;
  financials: Record<string, unknown>;
  assumptions: Record<string, unknown>;
  recommendation: Record<string, unknown>;
  summary: Record<string, unknown>;
  risks: Record<string, unknown>[];
  /** The five weighted score dimensions, where the row carries a score. */
  assessment: Record<string, unknown>[];
  opportunities: string[];
  /** `{ label, value }` per year, for the projection page's chart. */
  equitySeries: Array<{ label: string; value: number }>;
  report: Record<string, unknown>;
  /**
   * The report the model actually wrote — its own sections, in its own order.
   *
   * See `projectReportNarrative`. `source` is Markdown for `markdown-block`;
   * `pages` is how many pages it needs at the master's line budget, computed
   * with the same `packMarkdownPages` the block uses.
   */
  narrative: Record<string, unknown>;
}

/**
 * `report_content` as a bindable body, and the pages it needs.
 *
 * ## What was missing
 *
 * Every namespace above comes from a jsonb column the calculator wrote —
 * `investment_score`, `financial_calculations`, `property_specs`. None of them
 * is the report. The report is `report_content`: the document the model writes
 * against the configured `report_structure_templates` guide, and the thing an
 * operator means by "the report structure".
 *
 * Measured 2026-08-16 on one address generated at all five tiers, the model
 * writes a full document every time —
 *
 * | tier | headings | opens with |
 * | --- | ---: | --- |
 * | `snapshot` | 9 | Property Summary |
 * | `briefing` | 39 | Location Overview |
 * | `financial` | 42 | Client Investment Decision Summary |
 * | `strategic` | 80 | Property & Location Due Diligence Report |
 * | `compass` | 107 | Executive Verdict |
 *
 * — and **not one of those sections reached a page**. `{{sections.*}}` is bound
 * by 0 of the 13 active `report_templates` rows, and this projection published
 * nothing from `report_content` at all, so a template rendered the scorecard on
 * a fixed page sequence and the report itself was simply absent.
 *
 * ## Why the whole body rather than per-section bindings
 *
 * A section-per-binding shape needs the template to know the section ids, and
 * they are not knowable: they come from whichever guide is configured, they
 * differ per tier, and the guides are edited in the product. A master binding
 * `{{sections.executive_verdict.body}}` is a master that breaks when somebody
 * renames a heading.
 *
 * The body is carried whole instead, by the mechanism this programme already
 * uses for the two other model-authored formats: conditional pages, each
 * holding one bucket of the same source, sized by `packMarkdownPages`. See
 * `markdownPaging.pure.ts` for why the block and this function must be the same
 * arithmetic.
 */
export function projectReportNarrative(
  content: unknown,
  linesPerPage: number = DEFAULT_LINES_PER_PAGE,
  /** What a running head says on a page whose chapter cannot be determined. */
  fallbackChapter = '',
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const raw = typeof content === 'string' ? content.trim() : '';
  if (!raw) return out;

  // The baked masthead and "Cover Page" section come out before anything else
  // reads this narrative — every surface draws its own cover now, and the
  // baked one rendered as a second cover inside the body of a templated
  // document. See `narrativeClean.pure.ts` for what is (and is not) matched.
  const source = stripBakedCover(raw).text.trim();
  if (!source) return out;

  // The chart directives the generator's prompt demands are an instruction to
  // the renderer, and `markdown.pure.ts` drops one it cannot draw rather than
  // printing its source. Nothing to strip here: a directive that survives to
  // the block is drawn or dropped there, in one place.
  put(out, 'source', source);

  // The calibrated narrative profile — the SAME resolution the markdown block
  // makes, so the page count this publishes and the buckets the block draws
  // cannot disagree. `linesPerPage` doubles as the schema sentinel: the value
  // deployed masters bake (34) resolves to the calibrated budgets.
  const profile = resolveNarrativeProfile('investment');
  // The SAME directive accounting the block makes. The block draws the
  // figures in the template's palette; this side draws them in the planning
  // greys and keeps only the line charge — `figureLines` reads the SVG's own
  // geometry, so the two sides charge identical counts whatever each paints
  // with. Without this the count ignored every figure while the block drew
  // them, which is exactly the one-line drift this module's header forbids.
  const blocks = renderMarkdown(source, {
    // The SAME limits the block reads. `markdown.pure.ts` defaults all three
    // to bounds sized for one chat answer, and this side estimating pages from
    // a 65,536-character, 400-block prefix while the block draws 131,072 and
    // 1,600 is exactly the one-line drift this module's header forbids.
    ...REPORT_BODY_LIMITS,
    charging: profile?.charging,
    renderDirective: vizDirectiveRenderer(planningChartContext()),
  }).blocks;
  const packed = profile
    ? packNarrativePages(blocks, profile, linesPerPage)
    : packMarkdownPages(blocks, linesPerPage);
  put(out, 'pages', packed.length || undefined);
  // The chapter each body page is in, for its running head.
  //
  // An ESTIMATE, exactly like `pages` beside it: this side has no template in
  // hand, so the page breaks — and therefore which chapter a page opens in —
  // are the calibrated profile's rather than the chosen master's.
  // `planNarrative` overwrites both from the real geometry in one pass, and
  // they travel together for that reason.
  // Padded to the masters' declared allowance so every `narrative.chapters.N`
  // the catalogue binds has a source. The pad is the fallback a running head
  // takes when the chapter cannot be determined, and the pages it covers never
  // draw — their conditional is `narrative.pages > n`.
  if (packed.length) {
    put(out, 'chapters', runningChapters(packed, fallbackChapter, NARRATIVE_CHAPTER_SLOTS));
  }
  return out;
}

/**
 * Build the catalogue-vocabulary view of one stored report.
 *
 * Every namespace returned is partial by design; merge it over the raw ones.
 */
/**
 * Options for a caller that is not rendering the row as its own document.
 *
 * `tier` overrides the row's. It exists for ONE caller and the reason matters:
 * `condense-investment-report` projects the PARENT Compass to assemble the
 * facts block for a Briefing or a Snapshot, and a Snapshot's whole purpose is
 * the figures. Keying the withholding on the row being read would have handed
 * the Snapshot's prompt a parent with no modelling in it and quietly emptied
 * the one tier that exists to carry it. The document being PRODUCED decides
 * what may be published, so the producer names its own tier.
 */
export interface ProjectionOptions {
  /** The tier of the document being produced, when it is not the row's own. */
  tier?: string | null;
}

export function projectInvestmentReport(
  row: InvestmentReportRowLike,
  options: ProjectionOptions = {},
): ProjectedNamespaces {
  const specs = obj(row.property_specs);
  // Stored financials are reconciled before anything reads them: historic
  // rows carry the pre-fix fold's inflated series and totals that do not
  // foot against their own lines. See reconcileStoredFinancials — exact,
  // component-derived, and a no-op on a post-fix row.
  const fin = obj(reconcileStoredFinancials(obj(row.financial_calculations)).fin);
  const score = obj(row.investment_score);

  const initial = obj(fin.initialCosts);
  const income = obj(fin.income);
  const metrics = obj(fin.keyMetrics);
  const loan = obj(fin.loanDetails);
  const costs = obj(fin.annualCosts);
  const assumptions = obj(fin.assumptions);

  // ── property ──────────────────────────────────────────────────────────────
  // Three sources, in precedence order, and the third one is a repair.
  //
  // `property_specs` is what the generator wrote and what every template binds.
  // Measured across all 1,199 stored reports, six of its nine attributes have
  // never held a value: parking, year_built, building_size_sqm, land_size_sqm,
  // council_area and zoning are empty on every row.
  //
  // Four of those six were never missing. Operators type them into the manual
  // inputs panel and they land in `manual_overrides` — land size on 150
  // reports, build size on 145, car spaces on 155, construction year on 29 —
  // under different spellings (`landSizeSqm`/`landSize`,
  // `buildSizeSqm`/`buildSize`, `carSpaces`, `constructionYear`) from the ones
  // `property_specs` uses. Nothing ever copied them across, so a Property
  // Identity table rendered blank on 150 reports whose operator had entered the
  // land size by hand.
  //
  // This is healed on READ, the same way `reconcileStoredFinancials` heals the
  // financial fold above: the stored row is never rewritten, every report
  // already issued gains the figure its operator supplied, and the write path
  // is fixed separately. Overrides come LAST, so a real stored spec always
  // wins.
  //
  // Zoning and council area are the other two, and no source has them — not
  // specs, not overrides, not any table in the schema. See
  // docs/reports/PROPERTY_ATTRIBUTE_ACQUISITION.md.
  const spec = specReader(specs, obj(fin.propertySpecs), obj(row.manual_overrides));
  const property: Record<string, unknown> = {};
  put(property, 'address', str(row.property_address));
  put(property, 'type', str(spec('property_type', 'propertyType')));
  put(property, 'yearBuilt', num(spec('year_built', 'yearBuilt', 'constructionYear')) ?? str(spec('year_built', 'yearBuilt', 'constructionYear')));
  put(property, 'landArea', num(spec('land_size_sqm', 'landSizeSqm', 'landSize')));
  put(property, 'buildingArea', num(spec('building_size_sqm', 'buildingSizeSqm', 'buildSizeSqm', 'buildSize')));
  put(property, 'zoning', str(spec('zoning')));
  put(property, 'council', str(spec('council_area', 'councilArea')));
  put(property, 'configuration', configuration(spec));

  // ── financials ────────────────────────────────────────────────────────────
  // ── the cash-flow table has to FOOT ──────────────────────────────────────
  //
  // The engine subtracts EIGHT annual cost components from the net position
  // (`financialEngine.calculateAnnualCosts`: council rates, water rates,
  // landlord insurance, property management, maintenance, land tax, strata,
  // letting fees). This projection published FOUR, and the masters bind
  // exactly what is published — so "Net position" carried costs no row
  // listed and the table could not be added up.
  //
  // Measured on 262 Pallas Street, Maryborough (16 Sep 2026): the printed
  // rows came to $10,780 against a net position built on $12,880, and the
  // $2,100 a reader could not find was `waterRates` 1,600 + `lettingFees`
  // 500. Worse, the row is LABELLED "Council and water rates" while it bound
  // `councilRates` alone, so the omission was hiding behind a label that
  // promised the very figure it left out.
  //
  // Two of the eight now join the row whose label already claims them, and
  // the rest are published in their own right:
  //
  //   * water rates join council rates — the row says "Council and water
  //     rates" and now means it;
  //   * letting fees join management — both are the managing agent's fee,
  //     which is how a statement groups them;
  //   * land tax and strata are their own line (`annualOtherCosts`), because
  //     neither is maintenance and folding them anywhere would be a false
  //     label. They are zero on a sub-threshold house and material on a unit.
  //
  // `reportBindingProjection.spec.ts` asserts the four printed lines plus
  // the other line equal the engine's own `totalAnnual` over the stored
  // shape, so a ninth component added upstream fails a test instead of
  // silently reopening the gap.
  const annualRates = sumCosts(costs.councilRates, costs.waterRates);
  const annualInsurance = num(costs.landlordInsurance);
  const annualManagement = sumCosts(costs.propertyManagement, costs.lettingFees);
  const annualMaintenance = num(costs.maintenance);
  const annualOtherCosts = sumCosts(costs.landTax, costs.strataFees);
  const weeklyRent = num(income.weeklyRent);
  const occupancyWeeks = num(assumptions.occupancyWeeks);
  const monthlyPayment = num(loan.monthlyPayment);

  const financials: Record<string, unknown> = {};
  put(financials, 'purchasePrice', num(initial.propertyValue));
  put(financials, 'stampDuty', num(initial.stampDuty));
  put(financials, 'legalFees', num(initial.legalFees));
  put(financials, 'inspectionFees', num(initial.inspectionFees));
  // Published so a page listing the upfront lines can foot to `totalCost`,
  // which the reconciliation derives from exactly these lines.
  put(financials, 'lmi', num(initial.lmi));
  put(financials, 'totalCost', num(initial.totalUpfront));
  put(financials, 'deposit', num(initial.deposit));
  put(financials, 'loanAmount', num(loan.loanAmount) ?? num(initial.loanAmount));
  put(financials, 'weeklyRent', weeklyRent);
  // Two annual rents, named apart, from the module the composed chapters also
  // ask. `annualRent` is the CONTRACTUAL rent, because that is what the yields
  // below rest on (measured: 149 of 153 stored gross yields are `weeklyRent ×
  // 52`, and 18 of 18 stored `income.annualRent` values are too) and because
  // this is the figure a template prints as a bare "p.a." beside the weekly
  // rent. It used to be `weeklyRent × occupancyWeeks`, which agreed with
  // neither: on 62 of 153 reports the KPI tile's annual rent could not produce
  // the gross yield printed with it, by $1,832 on average and $2,600 at worst.
  //
  // The occupancy assumption keeps its figure under its own name. And where a
  // report states no occupancy at all — 44 of 170 with a weekly rent — the
  // contractual reading still answers, so the tile's "p.a." note stops
  // rendering as the empty string.
  const rent = readAnnualRent(income, assumptions);
  put(financials, 'annualRent', rent.contractual);
  put(financials, 'annualRentAtOccupancy', rent.atOccupancy);
  put(financials, 'annualRentAtOccupancyLabel', rent.occupancyLabel);
  // The gap between the two, as a deduction, so a cash flow table that opens
  // on the contractual rent can still foot to the net position the engine
  // built on the occupied one. `atOccupancy` is undefined at 52 weeks and
  // where no assumption is carried, which is exactly when there is no gap to
  // state — 62 of 153 reports assume under 52 and on those the income row and
  // the net position were built on different rents with nothing between them
  // to explain the difference.
  put(financials, 'annualVacancyAllowance',
    rent.contractual !== undefined && rent.atOccupancy !== undefined
      ? rent.contractual - rent.atOccupancy
      : undefined);
  put(financials, 'weeklyVacancyAllowance',
    rent.contractual !== undefined && rent.atOccupancy !== undefined
      ? weekly(rent.contractual - rent.atOccupancy)
      : undefined);
  // A yield rests on a rent. Where the record establishes none, these describe
  // nothing — and this projection is the widest of the four readers, feeding
  // every bound template AND the recorded-facts block the model is handed, so
  // an unfounded yield published here becomes a figure the model then repeats
  // as authoritative. One rule, `rentIsEstablished`, asked by all four.
  const yieldIsFounded = rentIsEstablished(income);
  put(financials, 'grossYield', yieldIsFounded ? num(metrics.grossRentalYield) : undefined);
  put(financials, 'netYield', yieldIsFounded ? num(metrics.netRentalYield) : undefined);
  put(financials, 'cashOnCash', num(metrics.cashOnCashReturn));
  put(financials, 'weeklyNet', num(metrics.weeklyNet));
  put(financials, 'annualNet', num(metrics.annualNet));
  put(financials, 'lvr', num(metrics.lvr) ?? num(loan.lvr));
  put(financials, 'totalInvestment', num(metrics.totalInvestment));
  put(financials, 'weeklyRepayment', num(loan.weeklyPayment));
  // The ledger's own annual figure first. `monthlyPayment * 12` is a second
  // opinion about a number `loanLedger` already computed and stored, and the
  // two disagree wherever the schedule is not twelve equal months — an
  // interest-only period, a rounded final instalment — while "Net position"
  // below is built on the ledger's. A repayments row that cannot be
  // subtracted from the rent to reach the net position is the same class of
  // defect as the missing cost rows above.
  put(financials, 'annualRepayment',
    num(loan.annualPayment) ?? (monthlyPayment === undefined ? undefined : monthlyPayment * 12));
  put(financials, 'annualRates', annualRates);
  put(financials, 'weeklyRates', weekly(annualRates));
  put(financials, 'annualInsurance', annualInsurance);
  put(financials, 'weeklyInsurance', weekly(annualInsurance));
  put(financials, 'annualManagement', annualManagement);
  put(financials, 'weeklyManagement', weekly(annualManagement));
  put(financials, 'annualMaintenance', annualMaintenance);
  put(financials, 'weeklyMaintenance', weekly(annualMaintenance));
  // Land tax and strata, under a label that is true of both, and published
  // only where they come to something. Both are nil on an ordinary
  // owner-occupier-grade house — 262 Pallas carries 0 and 0 — and a fifth row
  // reading "$0" is a line the reader has to discount rather than read. It
  // costs the reconciliation nothing: a suppressed line is nil, so the four
  // printed rows still foot to the engine's total.
  const otherCostsStated = annualOtherCosts === undefined || annualOtherCosts === 0
    ? undefined
    : annualOtherCosts;
  put(financials, 'annualOtherCosts', otherCostsStated);
  put(financials, 'weeklyOtherCosts', weekly(otherCostsStated));
  put(financials, 'annualCosts', num(costs.totalAnnual));

  // ── assumptions ───────────────────────────────────────────────────────────
  const assumptionsOut: Record<string, unknown> = {};
  put(assumptionsOut, 'capitalGrowth', num(assumptions.capitalGrowth));
  put(assumptionsOut, 'interestRate', num(loan.interestRate));
  put(assumptionsOut, 'occupancyWeeks', occupancyWeeks);
  // Vacancy as whole-number percent, matching how every other rate is stored.
  put(assumptionsOut, 'vacancy', occupancyWeeks === undefined
    ? undefined
    : ((WEEKS_PER_YEAR - occupancyWeeks) / WEEKS_PER_YEAR) * 100);

  // ── verdict, risks, summary ───────────────────────────────────────────────
  // `investment_score.recommendation` is one string; there is no rationale
  // field, so `recommendation.rationale` stays absent rather than echoing the
  // headline back at the reader.
  const recommendation: Record<string, unknown> = {};
  // On a record that may state no grade, the scorer writes the client-facing
  // EXPLANATION where a recommendation would go — two sentences, 143
  // characters — and every selectable master binds `headline` at display size
  // (27pt on the verdict page) with `gradedLine` as the sentence under it. RS-3
  // set the policy's short form, "Not available — insufficient verified
  // evidence", as that headline. The owner's rule (14 Sep 2026) is that
  // neither "N/A" nor "unavailable" ever reaches a client document, so an
  // ungraded record publishes NO verdict at all: headline, action and the
  // verdict sentence are absent, the verdict block draws nothing
  // (`textBlock.html.ts`), the cover's Verdict cell is dropped, and the
  // narrative's own recommendation prose is what the reader gets. A graded
  // record is untouched. The operator's on-screen viewer still says the grade
  // was withheld and why — that surface is not the document.
  const storedRecommendation = str(score.recommendation);
  const ungradedStatement = storedRecommendation?.trim() === OVERALL_GRADE_UNAVAILABLE.explanation;
  const storedHeadline = ungradedStatement ? undefined : storedRecommendation;
  // The coverage sentence leaves the display slot and keeps its own name. See
  // `splitVerdictScope`: this is the page-3 overlap, and it is fixed here
  // rather than in a master because every selectable master binds `headline`.
  const verdict = splitVerdictScope(storedHeadline);
  const headline = verdict.claim;
  put(recommendation, 'headline', headline);
  // `scopeNote` is deliberately NOT published — see `splitVerdictScope`. No
  // master binds it, and `gradedLine` below already names the same dimensions.
  // A binding nothing draws is not a feature waiting for one; a dormant field
  // is one line away from printing the coverage twice.
  put(recommendation, 'action', recommendationAction(headline));
  // The grade and its score go through the ONE rule that decides whether this
  // record may state a grade at all. This used to be `str(score.grade)`, which
  // published the scorer's own `'N/A'` sentinel verbatim: every selectable
  // template bound it into `'{{recommendation.grade}} · {{…score}} out of
  // 100'` and printed "Assessment grade  N/A · out of 100" on the client's
  // method page, on a record whose `policy.gradeIssued` is `false`.
  //
  // The score travels with it. A number out of 100 beside no grade is the
  // same claim wearing one fewer word, and `gradedLine` has always refused
  // both together.
  /**
   * The four readings, kept apart — owner correction of 17 Sep 2026.
   *
   * A cover read "assessment performance F · 40" while the assessment page
   * said the composite would be a C. Both are in this record and both are
   * true; one label was carrying two of them. They are published under their
   * own names so a master binds the one it means, and every one is absent
   * where the record does not hold it.
   *
   * `recommendation.grade` is untouched: it is still the ONE rule that decides
   * whether this record may state a grade at all, and these sit beside it.
   */
  const readings = assessmentReadings(score as never);
  put(recommendation, 'measuredScore', readings.measuredScore ?? undefined);
  put(recommendation, 'measuredGrade', readings.measuredGrade ?? undefined);
  put(recommendation, 'measuredLine', readings.measuredScore !== null && readings.measuredGrade
    ? `${Math.round(readings.measuredScore)} · ${readings.measuredGrade}`
    : undefined);
  put(recommendation, 'coveragePercent', readings.coveragePercent ?? undefined);
  put(recommendation, 'coverageLabel', readings.coveragePercent === null
    ? undefined
    : `${readings.coveragePercent}%`);
  put(recommendation, 'criteriaMeasuredLine', readings.criteriaMeasured !== null && readings.criteriaTotal !== null
    ? `${readings.criteriaMeasured} of ${readings.criteriaTotal}`
    : undefined);
  put(recommendation, 'gradeCapped', readings.capped ? true : undefined);
  put(recommendation, 'capExplanation', readings.capExplanation ?? undefined);
  put(recommendation, 'conclusionLine', readings.conclusionLine ?? undefined);
  put(recommendation, 'supportsConclusion', readings.supportsConclusion ? true : undefined);
  put(recommendation, 'weightRoundingNote', readings.weightRoundingNote ?? undefined);

  const gradePublishable = publishableGrade(score);
  put(recommendation, 'grade', gradePublishable);
  put(recommendation, 'score', gradePublishable === undefined ? undefined : num(score.totalScore));
  // The verdict sentence, composed here so it exists only when the record can
  // say it. The templates used to interpolate grade and score into a literal
  // ("Graded {{grade}} at {{score}} out of 100, weighted across growth,
  // location, yield, demand and risk"), which printed with the holes left in
  // on every row without a score — and misstated the weighting for variant
  // scores, whose dimensions are not the composite five. `gradedLine` names
  // the dimensions this score actually carries; absent grade or score, the
  // binding is absent and the sentence is not drawn.
  put(recommendation, 'gradedLine', ungradedStatement ? undefined : gradedLine(score));
  put(recommendation, 'gradedDetailLine', gradedDetailLine(score));

  const strengths = strArray(score.strengths);
  const weaknesses = strArray(score.weaknesses);
  const summary: Record<string, unknown> = {};
  if (strengths.length) summary.strength = strengths;
  if (weaknesses.length) summary.watch = weaknesses;

  // Objects rather than bare strings, because the catalogue binds `risks.N.risk`.
  //
  // There is never more than ONE. Measured across all 1,182 reports:
  // `investment_score.risks` is an array on 985 of them and its length runs
  // **0 to 1** — never 2, never 3. The catalogue drew a three-row register, so
  // rows two and three were blank on every report ever produced, and the `why`
  // and `ddAction` columns were blank on all three because a risk is a plain
  // string with no such fields. The register now reads `assessment` below.
  const risks = strArray(score.risks).map((risk) => ({ risk }));

  // ── the scored breakdown, which is what this report actually computed ──────
  //
  // `investment_score.breakdown` holds five weighted dimensions — growth (40),
  // location (25), yield (15), demand (15), risk (5) — each with a `score`, its
  // `weight` and a `details` sentence explaining the score. That `details` is
  // the only per-dimension prose the record carries, and nothing bound it.
  //
  // It is published under its own key rather than folded into `risks` because
  // it is not a risk register: it is the scorecard the grade is computed from,
  // and `riskScore` is one row of five. `details` is empty on the dimensions the
  // scorer had no data for — `demandScore` and `growthScore` on the sampled
  // rows — so each entry is only emitted where it says something.
  const breakdown = obj(score.breakdown);
  /**
   * The engine's per-criterion coverage, keyed for the scorecard.
   *
   * `breakdown` carries the score and the weight; only `v2.dimensions` carries
   * how much of each criterion's own method the evidence reached. Read as a
   * lookup rather than by index, because the two lists are ordered
   * independently and pairing them positionally is how a figure ends up
   * against the wrong label.
   */
  const v2Dimensions: Record<string, unknown> = {};
  for (const d of (Array.isArray((obj(score.v2)).dimensions) ? (obj(score.v2)).dimensions as unknown[] : [])) {
    const key = str(obj(d).key);
    if (key) v2Dimensions[key] = d;
  }
  /*
   * Resolved here rather than beside the document identity below, because the
   * scorecard needs it: a dimension's own explanation can be financial
   * modelling. See `MODELLING_DETAIL_DIMENSIONS`.
   *
   * The document being produced decides what may be published — the row's own
   * tier for every caller but the condense fork. See `ProjectionOptions`.
   */
  const storedTier = String(row.report_tier ?? 'compass').trim().toLowerCase();
  /**
   * ONE resolved tier, read by everything tier-dependent.
   *
   * `options.tier` used to reach `contentPolicyFor` and nothing else, so a
   * condense fork producing a Financial Analysis from a Compass parent got
   * the Financial content policy and the PARENT's title, standfirst and
   * `report.tier` on every page — the defect the identity block below says
   * was closed, reopened by a second reading of the same question ten lines
   * apart. Measured: `projectInvestmentReport(row, { tier: 'financial' })` on
   * a stored Compass answered `documentTitle: "Investment Compass"` while
   * publishing all thirty financial bindings.
   */
  const tier = String(options.tier ?? storedTier).trim().toLowerCase();
  const policy = contentPolicyFor(tier);

  /**
   * Dimensions whose `details` sentence states financial modelling.
   *
   * Narrow by construction and keyed on the dimension rather than matched on
   * the text, for the reason `MODELLING_KEYS` is a list: a regex over a
   * model-adjacent sentence either misses a phrasing or eats a legitimate
   * one, and both are silent. Growth, Location, Demand and Risk explain
   * themselves in market and locality terms and are published on every tier.
   */
  const MODELLING_DETAIL_DIMENSIONS = new Set(['yieldScore']);

  const DIMENSIONS: Array<{ key: string; label: string }> = [
    { key: 'growthScore', label: 'Growth' },
    { key: 'locationScore', label: 'Location' },
    { key: 'yieldScore', label: 'Yield' },
    { key: 'demandScore', label: 'Demand' },
    { key: 'riskScore', label: 'Risk' },
  ];
  /**
   * A dimension the engine did not score prints as such, not as 50.
   *
   * `investment_score.breakdown.<dim>` carries `excluded: true`,
   * `hasData: false` and `weight: 0` when the engine had nothing to score with
   * — and a **placeholder `score` of 50 sitting in the field regardless**. The
   * scorecard bound `score` and `weight` straight through, so the page printed
   *
   *     Growth   50   0%
   *     Demand   50   0%
   *
   * which is a fabricated figure against a weight that says it counted for
   * nothing. Measured 2026-08-16: 9 of the 988 scored reports are in that
   * state, on `growthScore` and `demandScore`, and on every one of the 9 the
   * placeholder is exactly 50 and the weight exactly 0. Small, and a number a
   * client would read as an assessment.
   *
   * `normalise.pure.ts`'s `toScore` already refuses to plot it — "the engine is
   * saying it had no data, and plotting it would put a fabricated point on the
   * wheel". This is the same refusal for the templated path.
   *
   * The row used to stay, reading "Not assessed" beside a dash, on the theory
   * that a four-row table where the reader was told there are five dimensions
   * reads as cut for space. The owner's rule (14 Sep 2026) is that no
   * placeholder — "N/A", "unavailable", a dash, "not assessed" — reaches a
   * client document, so an unscored dimension now publishes NOTHING bindable:
   * no label, no score, no weight, no details. Its entry keeps its position
   * (the risk register binds `assessment.4.details` by index) and its
   * `scored: false`, and the scorecard row draws nothing
   * (`rowsWithSomethingToSay`). The verdict sentence already names only the
   * dimensions the score carries, so the shorter table and the sentence agree.
   */
  /**
   * The engine writes its thresholds into its own explanation — "Good
   * walkability (50-69)", "Moderate LVR (70-80%)" — and those parenthetical
   * scoring bands are the engine talking to itself, not to a client. A reader
   * outside the industry gets the words; the band edges belong to the
   * methodology page, not a scorecard cell.
   */
  const humaniseScoreDetail = (detail: string | undefined): string | undefined => {
    if (!detail) return detail;
    const cleaned = detail
      .replace(/\s*\((?:[<>~≤≥]?\s*\d+[\d.,]*\s*(?:[-–—]|to)\s*\d+[\d.,]*\s*%?|\d+[\d.,]*\s*\+?\s*%?)\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return cleaned || detail;
  };

  const assessment = DIMENSIONS.map(({ key, label }) => {
    const d = obj(breakdown[key]);
    const score = num(d.score);
    const weight = num(d.weight);
    const scored = !(d.excluded === true || d.hasData === false);
    const entry: Record<string, unknown> = {};
    put(entry, 'scored', scored);
    if (scored) {
      put(entry, 'label', label);
      put(entry, 'score', score);
      put(entry, 'weight', weight);
      put(entry, 'scoreLabel', score !== undefined ? String(Math.round(score)) : undefined);
      put(entry, 'weightLabel', weight !== undefined ? `${Math.round(weight)}%` : undefined);
      /**
       * How much of the criterion's own method was measured.
       *
       * The scorecard's fourth column used to bind `details`, which is the
       * criterion's RATIONALE — and for Yield that rationale IS the modelling
       * ("4.52% gross yield on a $575,000 purchase price"), so a tier that
       * withholds modelling left the cell blank. A labelled empty cell is a
       * promise unkept. Coverage is a fact about the METHOD rather than about
       * the purchase, so it is publishable on every tier, and it is read off
       * the record rather than composed.
       */
      // `breakdown` keys a criterion `growthScore`; `v2.dimensions` keys it
      // `growth`. Pairing them by position instead would put a figure against
      // the wrong label the first time either list reorders.
      const coverage = num(obj(v2Dimensions[key.replace(/Score$/, '')]).coverage);
      put(entry, 'measuredOn', coverage === undefined
        ? undefined
        : coverage >= 1 ? 'Full method' : `${Math.round(coverage * 100)}% of method`);
      // A dimension's own explanation can BE the modelling. The Yield
      // scorer's reads `4.52% gross yield on a $575,000 purchase price.` —
      // a yield, computed against the price, in one sentence — and it was
      // printed on page 4 of a Compass that publishes neither. Withholding
      // `financials.grossYield` and leaving its rationale on the scorecard
      // is the same figure through a second door.
      //
      // The dimension keeps its label, its score and its weight: it was
      // measured and it carries weight in the grade, and saying so is not
      // modelling. What goes is the arithmetic behind it, which belongs in
      // the Financial Analysis with the rest.
      if (policy.financialModelling || !MODELLING_DETAIL_DIMENSIONS.has(key)) {
        put(entry, 'details', humaniseScoreDetail(str(d.details)));
      }
    }
    return entry;
    // A dimension the record does not carry at all has no score AND no
    // exclusion flag; it is absent from the engine's output rather than
    // withheld by it, so it is not a row.
  }).filter((e) => e.score !== undefined || e.scored === false);

  const opportunities = strArray(score.opportunities);

  // ── the ten-year equity curve the chart page has always asked for ─────────
  //
  // `scenarioChart` on the projection page binds `tenYear.equitySeries`, and
  // **nothing published `tenYear`** — so the one chart in the Investment
  // Compass drew an empty plot on every report.
  //
  // The series is right here, in the same column the financials come from:
  // `financial_calculations.projections.moderate`, ten years of
  // `{ year, equity }`, on 162 of the 1,182 reports. The other 1,020 store no
  // projection at all, and for those the key stays absent and the chart renders
  // as it does today rather than as a flat line at zero — which would be a
  // forecast, and a wrong one.
  //
  // Equity rather than value or cash flow: it is what the block's own caption
  // says ("property value less loan balance"), it is positive on all 4,860
  // stored elements, and every chart primitive a family resolves to can draw
  // it. See `cashFlowProjection.pure.ts` for the rest of that series.
  const projections = obj(fin.projections);
  const moderate = Array.isArray(projections.moderate) ? projections.moderate : [];
  const equitySeries = moderate
    .map((y) => {
      const year = num(obj(y).year);
      const equity = num(obj(y).equity);
      return year !== undefined && equity !== undefined
        ? { label: `Yr ${year}`, value: equity }
        : null;
    })
    .filter((p): p is { label: string; value: number } => p !== null);

  const report: Record<string, unknown> = {};
  put(report, 'generatedDate', str(row.updated_at) ?? str(row.created_at));
  // ── the document's own name ────────────────────────────────────────────────
  // The Investment masters serve FOUR document kinds — the compass tier plus
  // the financial, snapshot, briefing and strategic tiers all resolve to this
  // page sequence — and the composer's identity strings (cover eyebrow,
  // wordmark, running head, running foot) used to be the literal words
  // "Investment Compass". So a Financial Analysis rendered as an Investment
  // Compass on every one of its pages, and no template choice could say
  // otherwise. The masters bind `report.documentTitle` / `report.standfirst`
  // now, and THIS is the one place the tier is translated into them; an
  // unrecognised or absent tier reads as compass, which is what the ranking's
  // default document has always been.
  const identity = DOCUMENT_IDENTITY[tier] ?? DOCUMENT_IDENTITY.compass;
  put(report, 'tier', tier);
  put(report, 'documentTitle', identity.title);
  // The standfirst comes from the CONTENT policy, not from the identity table,
  // because it is a promise about what the document holds. The Compass's read
  // "What the property is, what it costs to hold, and what the assessment
  // concluded" — which promised the financial modelling the Compass does not
  // carry, on the cover, above a page sequence that then drew it.
  put(report, 'standfirst', policy.standfirst);
  put(report, 'companionNote', policy.companionNote ?? undefined);
  put(report, 'drawsFinancialModelling', policy.financialModelling);

  /*
   * What the tier may publish.
   *
   * This is the authority, and it is HERE rather than in a renderer because
   * this projection is what every template is bound from: withholding a
   * namespace once reaches all 500 seeded masters, every future one, and both
   * render routes, while a fix inside one composer reaches one composer.
   *
   * `compassSectionRegistry.ts` has said since v2.0 that a Compass carries no
   * financial modelling and the generator obeys it — the prose has no
   * financial section in it. The MASTERS drew it anyway, from these bindings,
   * so the Compass opened on purchase price, gross yield, LVR and a ten-year
   * equity projection. One rule, one module, both ends.
   *
   * Withholding the modelling is not withholding the price: `identityFigures`
   * keeps the asking price and the indicative rent on every tier, because they
   * are facts about the asset in the way its land size is. What leaves is the
   * analysis of a PURCHASE — yield, LVR, loan structure, cash flow, the
   * ten-year series — and a block bound only to those draws nothing, which is
   * how a conditional page drops cleanly rather than printing labelled holes.
   */
  const MODELLING_KEYS = [
    'grossYield', 'netYield', 'cashOnCash', 'lvr', 'weeklyNet', 'annualNet',
    'loanAmount', 'weeklyRepayment', 'annualRepayment', 'stampDuty', 'legalFees',
    'inspectionFees', 'lmi', 'totalCost', 'deposit', 'totalInvestment',
    'annualRates', 'weeklyRates', 'annualInsurance', 'weeklyInsurance',
    'annualManagement', 'weeklyManagement', 'annualMaintenance', 'weeklyMaintenance',
    'annualOtherCosts', 'weeklyOtherCosts', 'annualCosts',
    'annualVacancyAllowance', 'weeklyVacancyAllowance',
  ] as const;
  const financialsOut = policy.financialModelling
    ? financials
    : Object.fromEntries(
      Object.entries(financials).filter(([k]) => !(MODELLING_KEYS as readonly string[]).includes(k)),
    );
  // The modelled assumptions go with the modelling: a capital-growth rate and
  // an interest rate on a location report are an analysis nobody asked for.
  const assumptionsPublished = policy.financialModelling ? assumptionsOut : {};

  return {
    property,
    financials: financialsOut,
    assumptions: assumptionsPublished,
    recommendation,
    summary,
    risks,
    assessment,
    opportunities,
    // The ten-year equity chart is modelling by definition. Absent rather than
    // empty, so a master's conditional drops the page instead of drawing an
    // axis with no series on it.
    equitySeries: policy.financialModelling ? equitySeries : [],
    report,
    // The document's own name is what a running head says on a page whose
    // chapter cannot be determined — before the first heading, and on the
    // pages a master declares that this body does not reach.
    narrative: projectReportNarrative(row.report_content, undefined, identity.title),
  };
}

/**
 * Merge the projection over an existing binding-context `data` object.
 *
 * Raw namespaces win nothing and lose nothing: existing keys are preserved and
 * projected keys are layered on top, so `property.year_built` and
 * `property.yearBuilt` both resolve afterwards.
 */
export function applyInvestmentProjection(
  data: Record<string, any>,
  row: InvestmentReportRowLike,
  options: ProjectionOptions = {},
): Record<string, any> {
  const p = projectInvestmentReport(row, options);
  const merge = (key: string, extra: Record<string, unknown>) => {
    if (!Object.keys(extra).length) return;
    data[key] = { ...obj(data[key]), ...extra };
  };
  merge('property', p.property);
  merge('financials', p.financials);
  merge('assumptions', p.assumptions);
  merge('recommendation', p.recommendation);
  merge('summary', p.summary);
  merge('report', p.report);
  // The report the model wrote. Absent — not empty — when the row carries no
  // content, so the narrative pages are conditional on something real: 4 of the
  // 1,187 stored reports have no body at all.
  merge('narrative', p.narrative);
  if (p.risks.length) data.risks = p.risks;
  // Absent rather than empty, so a template can make the block conditional.
  if (p.assessment.length) data.assessment = p.assessment;
  if (p.opportunities.length) data.opportunities = p.opportunities;
  // Absent on the 1,020 reports that store no projection, so the chart is empty
  // rather than flat at zero.
  if (p.equitySeries.length) {
    data.tenYear = { ...obj(data.tenYear), equitySeries: p.equitySeries };
  }
  return data;
}
