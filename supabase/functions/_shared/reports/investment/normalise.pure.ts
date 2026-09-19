/**
 * Reading an investment report row.
 *
 * Six jsonb columns and one very large Markdown column, none of which has a
 * schema the database enforces. Every reader here is defensive in the same way
 * the other seven normalisers are: a missing branch produces `null`, never a
 * zero, because a zero is a measurement and a null is an absence, and the
 * document draws them differently — a chart with a null is not drawn at all,
 * while a chart with a zero claims the property scored nothing.
 *
 * ## The sensitivity data is one-way, and that decides the chart
 *
 * `sensitivityAnalysis` holds two independent objects — `interestRateChanges`
 * with three scenarios and `rentChanges` with three — and **not** a grid. The
 * generator being replaced draws a heatmap from them, which asks a reader to
 * read a cross-product ("rent +10% *and* rates +1%") that was never computed.
 * The design system's `renderHeatmap` would make the same false claim more
 * beautifully. So this module returns two one-way series and the document draws
 * a tornado, which is what one-way sensitivity data actually is.
 *
 * ## The projections are three scenarios, not one line
 *
 * `projections` holds `conservative`, `moderate` and `optimistic`, each a
 * ten-year array. Printing only the moderate case — which is what a single line
 * would do — throws away the range, and the range is the point of a projection.
 * The document draws all three as a fan.
 */
import { markdownToPlainText, sanitiseGlyphs } from '../markdown.pure.ts';
import { neutraliseUrls } from '../text.pure.ts';
import { reconcileStoredFinancials } from './financialEngine.pure.ts';
import { rentIsEstablished } from './rentalEvidence.pure.ts';
import {
  type Demographics,
  type EconomicContext,
  FURNITURE_HEADINGS,
  type FinancialModel,
  type InvestmentReport,
  type InvestmentScore,
  type LocationIntelligence,
  MAX_PROJECTION_YEARS,
  MAX_SECTIONS,
  MAX_SWOT_ITEMS,
  MIN_SECTION_CHARS,
  type PropertySpecs,
  type ReportSection,
  SCORE_DIMENSIONS,
  SECTION_CHARTS,
  type SectionChart,
  type ScoreDimensionKey,
  type SensitivityPoint,
} from './payload.pure.ts';

export interface ReportRow {
  id?: unknown;
  status?: unknown;
  property_address?: unknown;
  report_content?: unknown;
  sources_content?: unknown;
  report_scope?: unknown;
  report_tier?: unknown;
  report_variant?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  property_specs?: unknown;
  investment_score?: unknown;
  location_intelligence?: unknown;
  demographics_data?: unknown;
  economic_data?: unknown;
  financial_calculations?: unknown;
  [key: string]: unknown;
}

export interface BuildInput {
  row: ReportRow;
  /** ISO instant. Passed in — this module has no clock. */
  preparedOn: string;
  /**
   * Where this report's score sits among the firm's own, 0-100.
   *
   * Counted by the route, which has a database; null when it could not. Never
   * derived here, and never invented — a percentile the reader cannot trust is
   * worse than no percentile.
   */
  scorePercentile?: number | null;
}

export type BuildResult =
  | { ok: true; report: InvestmentReport }
  | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * A literal, for use inside a constructed pattern.
 *
 * The version this replaced was written as a regex literal inside a template
 * literal's interpolation and had lost a level of escaping in both the class
 * and the replacement — it matched a metacharacter followed by two backslashes
 * and a bracket, which is to say nothing. Harmless, because the only strings
 * passed through it are `FURNITURE_HEADINGS`, which contain no metacharacter;
 * a trap for the next heading added to that list.
 */
const escapeRegExp = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A finite number, or null. Strings are parsed; empty and `N/A` are null. */
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,\s%]/g, '');
    if (!cleaned || /^n\/?a$/i.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A short field: glyph-sanitised, URL-neutralised, collapsed and capped. */
const short = (v: unknown, max: number): string =>
  neutraliseUrls(sanitiseGlyphs(str(v)).text).replace(/\s+/g, ' ').trim().slice(0, max).trim();

/** A list of short strings, deduplicated, capped. */
function list(v: unknown, max: number, chars = 400): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const text = short(typeof item === 'string' ? item : (isRecord(item) ? item.text ?? item.label : ''), chars);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

// ── The prose ───────────────────────────────────────────────────────────────

/**
 * Remove the blocks the document prints itself.
 *
 * 761 reports carry `## ⚖️ PROFESSIONAL DISCLAIMER` and `## 📞 CONTACT US` in
 * the model's own Markdown. The design system's closing page prints the
 * tenant's real contact block and the disclaimer from `global_report_settings`,
 * so leaving these prints both — once with the tenant's actual ABN and once with
 * whatever the model wrote, which is the worse of the two to be wrong.
 *
 * Matched on the heading text with any leading pictograph tolerated, because the
 * emoji is not stable across the corpus and the words are.
 *
 * ## The end of the block is the end of the *input*, not the end of a line
 *
 * The first render of this format put the model's disclaimer and its phone
 * number in the body of chapter 37, under the heading "Demographic & Economic
 * Data". The block's tail was written `[\s\S]*?(?=\n#{1,4}\s|$)` under the `m`
 * flag — which `^` needs, to find a heading at the start of a line. Under `m`,
 * `$` is the end of a *line*, and a lazy quantifier stops at the first position
 * where its lookahead can match: the newline immediately after the heading. So
 * the heading was removed and every word beneath it was kept, then swept into
 * whichever section preceded it.
 *
 * `removed` was greater than zero throughout — it counted the heading — so
 * nothing about the result looked wrong from the outside. It was found by
 * rendering the document and reading page 48.
 *
 * `$(?![\s\S])` is end-of-line with nothing after it: the end of the input,
 * under `m` or without it.
 */
export function stripFurniture(markdown: string): { text: string; removed: number } {
  if (!markdown) return { text: '', removed: 0 };
  let out = markdown;
  for (const heading of FURNITURE_HEADINGS) {
    if (heading === 'REPORT TITLE') continue;
    const pattern = new RegExp(
      `^#{1,4}\\s*[^\\n#]{0,8}?${escapeRegExp(heading)}\\b[\\s\\S]*?(?=\\n#{1,4}\\s|$(?![\\s\\S]))`,
      'gim',
    );
    out = out.replace(pattern, '');
  }
  const cleaned = out.replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleaned, removed: Math.max(0, markdown.length - cleaned.length) };
}

/** `# 24. Sensitivity Analysis` → `{ number: 24, title: 'Sensitivity Analysis' }`. */
export function parseHeading(line: string): { number: number | null; title: string } | null {
  const m = /^#{1,2}\s+(.+?)\s*$/.exec(line);
  if (!m) return null;
  const raw = short(m[1], 160);
  if (!raw) return null;
  const numbered = /^(\d{1,2})[.)]\s*(.+)$/.exec(raw);
  if (numbered) {
    const n = Number(numbered[1]);
    return { number: Number.isFinite(n) ? n : null, title: numbered[2].trim() || raw };
  }
  return { number: null, title: raw };
}

/**
 * Split the prose into its numbered sections.
 *
 * Splits on `#` and `##` together rather than `#` alone. The corpus uses `#` for
 * the 36 numbered sections and `##` for the two furniture blocks, but 256
 * reports also carry unnumbered `##` sections — "Location Overview", "Current
 * Market Performance" — that are real content and would otherwise be swallowed
 * into whichever numbered section happened to precede them.
 */
export function splitSections(markdown: string): ReportSection[] {
  const lines = markdown.split('\n');
  const sections: ReportSection[] = [];
  let current: { number: number | null; title: string; body: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.body.join('\n').trim();
    // A heading with nothing under it is not a section. The corpus has these
    // where the model emitted a heading and then ran out of tokens.
    if (body.length >= MIN_SECTION_CHARS) {
      sections.push({
        number: current.number,
        title: current.title,
        markdown: body,
        charts: current.number !== null ? (SECTION_CHARTS[current.number] ?? []) : [],
      });
    }
    current = null;
  };

  for (const line of lines) {
    const heading = parseHeading(line);
    if (heading) {
      flush();
      // `# REPORT TITLE` is the document's own title, printed on the cover.
      if (/^REPORT TITLE$/i.test(heading.title)) continue;
      current = { number: heading.number, title: heading.title, body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  flush();

  return attachChartsByTitle(sections.slice(0, MAX_SECTIONS));
}

/**
 * Which infographic belongs under which section, when nothing is numbered.
 *
 * ## Why this exists
 *
 * `SECTION_CHARTS` keys the fourteen named infographics on the generator's own
 * section numbers — `24: ['sensitivity-tornado']` — and that was right for the
 * format it was read off. The generator has since stopped numbering. Measured
 * over the whole corpus:
 *
 * | reports | numbered headings |
 * | --- | --- |
 * | 1,147 without `{{…}}` figures | 733 numbered |
 * | **35 with them — every current report** | **0 numbered** |
 *
 * So on every report the product makes today, `SECTION_CHARTS[null]` is
 * nothing, and not one of the fourteen charts drawn from the structured jsonb
 * columns reaches the page. Those columns are the whole reason the migration
 * exists: the score breakdown, the household profile, the cost lines and the
 * projections appear nowhere else in the document.
 *
 * ## The rule
 *
 * Title keywords, read off the section names the current generator actually
 * writes — `Executive Verdict`, `Risk Dashboard`, `Population & Housing
 * Demand`, `Financial Input Snapshot` — and **each chart attaches at most
 * once**, to the first section that matches it. Order in this list is the
 * order the charts are claimed in, not a priority: two sections that both
 * mention amenity get one bullet chart between them, under the first.
 *
 * A chart still only draws if `chartHasData` says its column is populated, so
 * a generous pattern costs nothing but a counted skip. That asymmetry is
 * deliberate — a missed chart is invisible, a spurious one cannot happen.
 */
export const TITLED_SECTION_CHARTS: ReadonlyArray<{
  chart: SectionChart;
  test: RegExp;
}> = [
  { chart: 'score-gauge', test: /executive verdict|decision summary|investment score/i },
  { chart: 'score-wheel', test: /risk dashboard|score breakdown/i },
  { chart: 'score-peers', test: /market positioning|yield market/i },
  { chart: 'locality-map', test: /why this location|position within the locality|locality snapshot|location snapshot/i },
  { chart: 'demographics-bars', test: /demand drivers|population|household growth|demographic/i },
  { chart: 'economic-bullets', test: /demand drivers|employment|economic linkage|income & affordability|socioeconomic/i },
  { chart: 'amenity-bullets', test: /amenity|access|retail|healthcare|lifestyle|education|transport|connectivity/i },
  { chart: 'yield-bullets', test: /financial input snapshot|price, rent & yield/i },
  { chart: 'cost-waterfall', test: /feasibility|financial performance|cash ?flow/i },
  { chart: 'sensitivity-tornado', test: /vacancy risk|rent sustainability|sensitivity/i },
  { chart: 'swot-quadrant', test: /property fit|suburb character|occupier appeal|dwelling layout/i },
  { chart: 'lvr-bullet', test: /portfolio fit|loan structure|\blvr\b/i },
  { chart: 'projection-value', test: /projection|ten[- ]year|10[- ]year/i },
];

/**
 * Charts a single section may claim at once.
 *
 * The v3.0 registry merges six sections into two, and both merges collapse
 * several of the patterns above onto one title. `Demand Drivers` matches
 * `demographics-bars` *and* `economic-bullets`; `Amenity & Access` matches
 * `amenity-bullets` and would match more if the patterns were wider. With the
 * one-chart-per-section shape the old loop had, the second and third chart on a
 * merged section were dropped on the floor — the section is one section now,
 * but it still carries three sections' worth of data, and the charts are drawn
 * from structured jsonb columns that appear nowhere else in the document.
 *
 * Two is the cap because the prompt's own limit is two visualisations a
 * section: a page carrying the model's two figures plus three of ours is the
 * page-economy problem this release exists to fix, pointing the other way.
 */
export const MAX_CHARTS_PER_SECTION = 2;

/**
 * Attach the named charts by title, but only for a report with no numbering.
 *
 * A numbered report keeps `SECTION_CHARTS` exactly as it was: 733 reports in
 * the corpus are numbered, they render correctly today, and a title heuristic
 * that overrode a number the generator stated would be a guess replacing a
 * fact.
 */
export function attachChartsByTitle(sections: ReportSection[]): ReportSection[] {
  if (sections.some((s) => s.number !== null)) return sections;

  const claimed = new Set<SectionChart>();
  return sections.map((section) => {
    const charts = TITLED_SECTION_CHARTS
      .filter((entry) => !claimed.has(entry.chart) && entry.test.test(section.title))
      .filter((entry) => !supersededByDirective(entry.chart, section.markdown))
      .slice(0, MAX_CHARTS_PER_SECTION)
      .map((entry) => { claimed.add(entry.chart); return entry.chart; });
    return charts.length ? { ...section, charts } : section;
  });
}

/**
 * Directives that plot the same stored numbers a named chart would.
 *
 * Read off a render: `Executive Verdict` carried the model's own
 * `{{gauge: 61 | Location & Property Fit}}`, and the title rule then attached
 * `score-gauge`, which draws 61 out of 100 from the score column. The chapter
 * printed the same needle at the same value on two consecutive pages.
 *
 * Only these two, and only because the model is *given* those numbers: a gauge
 * it writes is the composite score and a wheel it writes is the five
 * dimensions. A `{{bars}}` in a demographics section is not necessarily the
 * demographics bars, so `demographics-bars` is not in this table — suppressing
 * a chart drawn from a structured column on the strength of an unrelated bar
 * chart would lose real content to avoid a resemblance.
 */
const SUPERSEDING_DIRECTIVE: Partial<Record<SectionChart, RegExp>> = {
  'score-gauge': /\{\{\s*gauge\s*:/i,
  'score-wheel': /\{\{\s*wheel\s*:/i,
};

function supersededByDirective(chart: SectionChart, markdown: string): boolean {
  const pattern = SUPERSEDING_DIRECTIVE[chart];
  return Boolean(pattern && pattern.test(markdown));
}

// ── The structured columns ──────────────────────────────────────────────────

/**
 * The property specification — from two columns, because it lives in two.
 *
 * `property_specs` is present on all 1,182 rows with exactly the snake_case
 * keys this function reads, which is why nothing ever looked wrong. What it
 * mostly holds is nulls:
 *
 * | field | populated in `property_specs` | in `financial_calculations.propertySpecs` |
 * | --- | ---: | ---: |
 * | land size | **0** | 110 |
 * | building size | **0** | 109 (as `buildSizeSqm`) |
 * | bedrooms | 651 | 0 |
 * | property type | 1,054 | 34 |
 *
 * So the spec table has never printed a land or building size on any report in
 * the corpus, and the two dimensions a reader of a property report looks for
 * first were sitting one column over under different names. `buildSizeSqm` is
 * the one to note: not `building_size_sqm`, not `buildingSizeSqm`, both of
 * which this function already accepted and neither of which exists.
 *
 * `property_specs` wins wherever it has a value — it is the column the intake
 * writes and the other is a by-product of the finance run.
 */
export function toSpecs(raw: unknown, fallbackRaw?: unknown): PropertySpecs {
  const s = isRecord(raw) ? raw : {};
  const f = isRecord(fallbackRaw) ? fallbackRaw : {};
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (s[key] !== undefined && s[key] !== null) return s[key];
    }
    for (const key of keys) {
      if (f[key] !== undefined && f[key] !== null) return f[key];
    }
    return undefined;
  };
  return {
    propertyType: short(pick('property_type', 'propertyType'), 60),
    bedrooms: num(pick('bedrooms')),
    bathrooms: num(pick('bathrooms')),
    parking: num(pick('parking', 'carSpaces', 'car_spaces')),
    landSqm: num(pick('land_size_sqm', 'landSizeSqm')),
    buildingSqm: num(pick('building_size_sqm', 'buildingSizeSqm', 'buildSizeSqm')),
    yearBuilt: num(pick('year_built', 'yearBuilt')),
    zoning: short(pick('zoning'), 40),
    councilArea: short(pick('council_area', 'councilArea'), 80),
  };
}

export function toScore(raw: unknown, percentile: number | null): InvestmentScore | null {
  if (!isRecord(raw)) return null;
  const breakdownRaw = isRecord(raw.breakdown) ? raw.breakdown : {};
  // A dimension is an object, not a number, on **every one of the 985 scored
  // reports in the corpus**:
  //
  //     "locationScore": { "score": 58, "weight": 56, "hasData": true,
  //                        "excluded": false, "details": "Excellent
  //                        walkability (90+). Limited CBD access (>60 min)." }
  //
  // `num()` on that returns null, so the five-way breakdown read as five nulls
  // and `chartHasData('score-wheel')` — which needs three — was false on every
  // report ever generated. The wheel is the one drawing in this document that
  // comes from the scoring engine rather than from the model's prose, and it
  // has never been on a page. The bare-number branch stays because nothing
  // proves an older row cannot hold one, and it costs one `typeof`.
  const breakdown = SCORE_DIMENSIONS.map((d) => {
    const cell = breakdownRaw[d.key];
    const record = isRecord(cell) ? cell : null;
    const excluded = record?.excluded === true || record?.hasData === false;
    return {
      key: d.key as ScoreDimensionKey,
      label: d.label,
      // An excluded dimension has no score to plot, whatever number is sitting
      // in the field: the engine is saying it had no data and left it out of
      // the total. Plotting it would put a fabricated point on the wheel.
      value: excluded ? null : num(record ? record.score : cell),
      weight: num(record?.weight),
      details: short(record?.details, 300),
      excluded,
    };
  });
  const total = num(raw.totalScore);
  // A score object with neither a total nor one populated dimension is not a
  // score — it is an empty shell the engine wrote before it failed.
  if (total === null && breakdown.every((b) => b.value === null)) return null;
  return {
    total,
    grade: short(raw.grade, 8),
    recommendation: short(raw.recommendation, 600),
    breakdown,
    strengths: list(raw.strengths, MAX_SWOT_ITEMS),
    weaknesses: list(raw.weaknesses, MAX_SWOT_ITEMS),
    opportunities: list(raw.opportunities, MAX_SWOT_ITEMS),
    risks: list(raw.risks, MAX_SWOT_ITEMS),
    percentile: percentile === null || !Number.isFinite(percentile)
      ? null
      : Math.max(0, Math.min(100, Math.round(percentile))),
  };
}

/** Amenity categories, from whichever branch of the payload carries them. */
function toAmenities(loc: Record<string, unknown>): LocationIntelligence['amenities'] {
  const out: Array<{ label: string; count: number | null; score: number | null }> = [];
  const push = (label: string, count: unknown, score: unknown) => {
    const c = num(count);
    const s = num(score);
    if (c === null && s === null) return;
    out.push({ label, count: c, score: s });
  };

  const schools = isRecord(loc.schools) ? loc.schools : {};
  push('Schools within 3km', schools.schoolsWithin3km, null);
  const transport = isRecord(loc.transport) ? loc.transport : {};
  push('Transport stops', transport.stopsWithin1km ?? transport.nearbyStops, transport.score);
  const healthcare = isRecord(loc.healthcare) ? loc.healthcare : {};
  push('Healthcare', healthcare.facilitiesWithin5km ?? healthcare.nearbyFacilities, healthcare.score);
  const lifestyle = isRecord(loc.lifestyle) ? loc.lifestyle : {};
  push('Lifestyle & retail', lifestyle.venuesWithin2km ?? lifestyle.nearbyVenues, lifestyle.score);

  // `amenities` is an array in the corpus, not an object. Counted by category.
  if (Array.isArray(loc.amenities) && loc.amenities.length) {
    const byType = new Map<string, number>();
    for (const item of loc.amenities) {
      if (!isRecord(item)) continue;
      const type = short(item.type ?? item.category ?? item.label, 40) || 'Other';
      byType.set(type, (byType.get(type) ?? 0) + 1);
    }
    for (const [label, count] of [...byType].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      push(label, count, null);
    }
  }
  return out;
}

export function toLocation(raw: unknown, address: string): LocationIntelligence | null {
  if (!isRecord(raw)) return null;
  const coords = isRecord(raw.coordinates) ? raw.coordinates : {};
  const amenities = toAmenities(raw);
  const walkScore = num(raw.walkScore);
  const lat = num(coords.lat);
  const lng = num(coords.lng);
  if (walkScore === null && lat === null && !amenities.length) return null;

  // The suburb, state and postcode are not their own columns — they are the
  // tail of the address, which is the only place the corpus records them.
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const tail = parts.length > 1 ? parts[parts.length - 1] : '';
  const m = /^(.*?)\s*([A-Z]{2,3})\s*(\d{4})$/.exec(tail);
  return {
    walkScore,
    lat,
    lng,
    suburb: short(raw.suburb ?? (m ? m[1] : (parts.length > 1 ? parts[parts.length - 2] : '')), 60),
    state: short(raw.state ?? (m ? m[2] : ''), 4),
    postcode: short(raw.postcode ?? (m ? m[3] : ''), 6),
    amenities,
  };
}

export function toDemographics(raw: unknown): Demographics | null {
  if (!isRecord(raw)) return null;
  const pop = isRecord(raw.population) ? raw.population : {};
  const inc = isRecord(raw.income) ? raw.income : {};
  const hou = isRecord(raw.housing) ? raw.housing : {};
  const out: Demographics = {
    population: num(pop.total),
    populationGrowth: num(pop.growth),
    density: num(pop.density),
    medianAge: num(inc.medianAge),
    medianHouseholdIncome: num(inc.medianHouseholdIncome),
    unemploymentRate: num(inc.unemploymentRate),
    medianRent: num(hou.medianRent),
    ownerOccupierRate: num(hou.ownerOccupierRate),
    renterRate: num(hou.renterRate),
    housingStress: num(hou.housingStress),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

export function toEconomic(raw: unknown): EconomicContext | null {
  if (!isRecord(raw)) return null;
  const ind = isRecord(raw.indicators) ? raw.indicators : {};
  const out: EconomicContext = {
    cashRate: num(raw.cashRate),
    inflation: num(raw.inflation),
    gdpGrowth: num(ind.gdpGrowth),
    unemploymentRate: num(ind.unemploymentRate),
    participationRate: num(ind.participationRate),
    creditGrowth: num(ind.creditGrowth),
    housePriceGrowth: num(ind.housePriceGrowth),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

/** `plus10Percent` → `Rent +10%`. The keys are the only labels the data has. */
function scenarioLabel(key: string, subject: string): string {
  const m = /^(plus|minus)(\d+)Percent$/.exec(key);
  if (!m) return `${subject} ${key}`;
  return `${subject} ${m[1] === 'plus' ? '+' : '−'}${m[2]}%`;
}

/**
 * One-way sensitivities, as deltas from the base position.
 *
 * The stored values are absolute annual positions under each scenario. A reader
 * comparing "−36,557" with "−29,539" has to do the subtraction themselves; the
 * delta is the thing the chart is about, so it is computed here where the base
 * is known rather than in the renderer where it is not.
 */
function toSensitivity(raw: unknown, subject: string, base: number | null): SensitivityPoint[] {
  if (!isRecord(raw)) return [];
  const points: SensitivityPoint[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const v = num(value);
    if (v === null) continue;
    points.push({ label: scenarioLabel(key, subject), value: v, delta: base === null ? 0 : v - base });
  }
  // Worst first, so the tornado reads top-down from the biggest downside.
  return points.sort((a, b) => a.value - b.value).slice(0, 8);
}

/** Named annual cost lines, largest first, for the waterfall. */
function toCosts(raw: unknown): Array<{ label: string; value: number }> {
  if (!isRecord(raw)) return [];
  const LABELS: Record<string, string> = {
    councilRates: 'Council rates',
    waterRates: 'Water rates',
    landlordInsurance: 'Insurance',
    propertyManagement: 'Management',
    maintenance: 'Maintenance',
    strataFees: 'Strata',
    landTax: 'Land tax',
    lettingFees: 'Letting fees',
  };
  const out: Array<{ label: string; value: number }> = [];
  for (const [key, label] of Object.entries(LABELS)) {
    const v = num(raw[key]);
    if (v === null || v === 0) continue;
    out.push({ label, value: Math.abs(v) });
  }
  return out.sort((a, b) => b.value - a.value);
}

/**
 * The ten-year scenarios.
 *
 * Only the moderate case lands in the typed series, because that is the case the
 * prose's own tables use. The other two reach the document through the scenario
 * fan, which reads them from the raw payload — keeping three parallel arrays in
 * this interface would put a rendering decision in the payload contract.
 */
function toProjections(raw: unknown): FinancialModel['projections'] {
  if (!isRecord(raw)) return [];
  const rows = Array.isArray(raw.moderate) ? raw.moderate : [];
  const out: Array<{ year: number; value: number | null; rent: number | null; cumulative: number | null }> = [];
  for (const row of rows.slice(0, MAX_PROJECTION_YEARS)) {
    if (!isRecord(row)) continue;
    const year = num(row.year);
    if (year === null) continue;
    out.push({
      year,
      value: num(row.propertyValue),
      rent: num(row.annualRent),
      cumulative: num(row.cumulativeCashFlow),
    });
  }
  return out;
}

export function toFinancial(raw: unknown): FinancialModel | null {
  if (!isRecord(raw)) return null;
  const km = isRecord(raw.keyMetrics) ? raw.keyMetrics : {};
  const loan = isRecord(raw.loanDetails) ? raw.loanDetails : {};
  const costs = isRecord(raw.annualCosts) ? raw.annualCosts : {};
  const income = isRecord(raw.income) ? raw.income : {};
  const sens = isRecord(raw.sensitivityAnalysis) ? raw.sensitivityAnalysis : {};

  const annualNet = num(km.annualNet);
  // A yield rests on a rent. Where the record establishes none, the stored
  // yield describes nothing and travels no further — the same rule
  // `financialChapters` applies to the FIN table, asked of the one module
  // that owns it so the WeasyPrint document and the composed chapters cannot
  // disagree about whether a yield exists.
  const foundedYield = rentIsEstablished(income);
  const model: FinancialModel = {
    grossYield: foundedYield ? num(km.grossRentalYield) : null,
    netYield: foundedYield ? num(km.netRentalYield) : null,
    cashOnCash: num(km.cashOnCashReturn),
    lvr: num(km.lvr ?? loan.lvr),
    totalInvestment: num(km.totalInvestment),
    annualNet,
    weeklyNet: num(km.weeklyNet),
    loanAmount: num(loan.loanAmount),
    interestRate: num(loan.interestRate),
    monthlyPayment: num(loan.monthlyPayment),
    costs: toCosts(costs),
    annualIncome: num(income.annualRent ?? income.grossAnnualRent ?? income.annual),
    interestSensitivity: toSensitivity(sens.interestRateChanges, 'Rate', annualNet),
    rentSensitivity: toSensitivity(sens.rentChanges, 'Rent', annualNet),
    projections: toProjections(raw.projections),
  };

  const populated = model.grossYield !== null || model.lvr !== null
    || model.costs.length > 0 || model.projections.length > 0;
  return populated ? model : null;
}

/** The three scenario series, straight off the payload, for the fan. */
export function scenarioSeries(
  raw: unknown,
  field: 'propertyValue' | 'cumulativeCashFlow' | 'annualRent',
): Array<{ label: string; values: number[] }> {
  if (!isRecord(raw)) return [];
  const NAMES: Array<[string, string]> = [
    ['conservative', 'Conservative'],
    ['moderate', 'Moderate'],
    ['optimistic', 'Optimistic'],
  ];
  const out: Array<{ label: string; values: number[] }> = [];
  for (const [key, label] of NAMES) {
    const rows = Array.isArray((raw as Record<string, unknown>)[key])
      ? (raw as Record<string, unknown>)[key] as unknown[]
      : [];
    const values: number[] = [];
    for (const row of rows.slice(0, MAX_PROJECTION_YEARS)) {
      if (!isRecord(row)) continue;
      const v = num(row[field]);
      if (v !== null) values.push(v);
    }
    if (values.length >= 2) out.push({ label, values });
  }
  return out;
}

/** Sources, from the separate column the corpus keeps them in. */
export function toSources(raw: unknown): string[] {
  const text = str(raw);
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split('\n')) {
    // The column's own furniture is not a citation.
    //
    // `sources_content` opens `## SOURCES & REFERENCES` / `### Citations:` and
    // usually carries a third `### Additional Sources:` in the middle. All
    // three are longer than the eight-character floor, so all three were being
    // counted and printed: a chapter of 19 URLs was captioned "21 cited" and
    // its table's first two rows were the headings above it. Measured over the
    // whole corpus — 1,114 reports carry the first two, 777 the third, and
    // **those three strings are the only non-URL lines in the column**.
    if (/^\s*#{1,6}\s/.test(line)) continue;
    const cleaned = short(line.replace(/^[-*\d.)\s]+/, ''), 300);
    if (cleaned.length < 8 || seen.has(cleaned.toLowerCase())) continue;
    seen.add(cleaned.toLowerCase());
    out.push(cleaned);
    if (out.length >= 60) break;
  }
  return out;
}

/** Two or three sentences framing the report. Built from it, not written. */
export function narrativeFor(
  address: string,
  sections: number,
  grade: string,
  hasFinancials: boolean,
): string {
  const where = address ? ` for ${address}` : '';
  const graded = grade ? ` The location and property fit score a ${grade}.` : '';
  const money = hasFinancials
    ? ' Purchase costs, loan structure and a ten-year projection are modelled from the figures supplied.'
    : ' No financial model was run for this report, so it carries no yield, loan or projection figures.';
  return `An investment location and property fit assessment${where}, in ${
    sections === 1 ? 'one section' : `${sections} sections`
  }.${graded}${money}`;
}

const uuidLike = (v: unknown): string => {
  const s = str(v).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : '';
};

/**
 * Build the report.
 *
 * Refuses rather than renders when the row has nothing to say: no id, a status
 * that is not `completed`, or no prose and no structured columns at all. A cover
 * page and a disclaimer page with nothing between them is a file somebody sends
 * before noticing.
 */
export function buildInvestmentReport(input: BuildInput): BuildResult {
  const rawRow = input.row ?? {};
  // Stored financials are reconciled before anything reads them — historic
  // rows carry the pre-fix fold's inflated series (see
  // reconcileStoredFinancials); the healed object feeds the typed model AND
  // the scenario fan, which reads `projections` off this same row.
  const row = {
    ...rawRow,
    financial_calculations: reconcileStoredFinancials(rawRow.financial_calculations).fin,
  };
  const reportId = uuidLike(row.id);
  if (!reportId) return { ok: false, error: 'report id missing' };

  const status = str(row.status);
  if (status && status !== 'completed') {
    return { ok: false, error: `this report is ${status}, not completed` };
  }

  const address = short(row.property_address, 200);
  const rawProse = str(row.report_content);
  const stripped = stripFurniture(sanitiseGlyphs(rawProse).text);
  const sections = splitSections(stripped.text);

  const specs = toSpecs(
    row.property_specs,
    isRecord(row.financial_calculations) ? row.financial_calculations.propertySpecs : null,
  );
  const score = toScore(row.investment_score, input.scorePercentile ?? null);
  const location = toLocation(row.location_intelligence, address);
  const demographics = toDemographics(row.demographics_data);
  const economic = toEconomic(row.economic_data);
  const financial = toFinancial(row.financial_calculations);

  const hasAnything = sections.length > 0 || score !== null || location !== null
    || demographics !== null || financial !== null;
  if (!hasAnything) return { ok: false, error: 'this report has no content to typeset' };

  return {
    ok: true,
    report: {
      meta: {
        reportId,
        propertyAddress: address,
        reportScope: short(row.report_scope, 40),
        reportTier: short(row.report_tier, 40),
        reportVariant: short(row.report_variant, 40),
        preparedOn: input.preparedOn,
        generatedAt: str(row.created_at) || input.preparedOn,
        hasFinancials: financial !== null,
        hasScore: score !== null,
        sectionsShown: sections.length,
        truncated: false,
      },
      narrative: narrativeFor(address, sections.length, score?.grade ?? '', financial !== null),
      specs,
      score,
      location,
      demographics,
      economic,
      financial,
      sections,
      sources: toSources(row.sources_content),
      notices: {
        furnitureStripped: stripped.removed,
        sectionsDropped: 0,
        charsOmitted: 0,
        chartsSkipped: 0,
      },
    },
  };
}
