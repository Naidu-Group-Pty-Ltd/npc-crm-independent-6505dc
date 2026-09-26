/**
 * SWOT, suitability, holding, exit and monitoring — composed from the record.
 *
 * ## The defect this exists to end
 *
 * Five pieces of content the brief calls for were each missing in a different
 * way, and three of them looked present.
 *
 * `sectionRegistry.pure.ts` already declares `swot`, `suitability` and
 * `exitStrategy`. But `swot`'s producer is `composeSwotSection`, which types
 * four lists off `investment_score`, and on the two subjects measured on
 * 18 Sep 2026 those lists hold — in total, across both properties — **two
 * strengths, three weaknesses, two opportunities and ZERO threats**:
 *
 * ```
 * 18 Annabelle Crescent   strengths []   weaknesses ["Below average rental
 *                         yield may require owner contribution",
 *                         "Measured demand in this market is soft"]
 * 262 Pallas Street       strengths ["Measured capital growth in this suburb
 *                         is strong"]
 * ```
 *
 * That is a V1 scoring artefact of one-line strings, and a SWOT drawn from it
 * is three bullets with an empty Threats heading. `suitability` and
 * `exitStrategy` are `depth: 'optional'` on the Financial tier alone with
 * `producer: routed(...)` — meaning a model writes them if it gets to them.
 * A **holding strategy** and a **monitoring plan** do not exist anywhere.
 *
 * Meanwhile the record holds a great deal that bears directly on all five and
 * that none of them reads: the market evidence table (median, one-, three-,
 * five- and ten-year growth, sales volume, each with its publisher and
 * period), the planning layer's answer with its own currency date, the
 * transport feeds' stop count and the two things they explicitly do not
 * measure, the financial engine's weekly position, the loan's structure and
 * whether its interest-only term was assumed, the score's dimensions and the
 * gaps that withheld its grade.
 *
 * So the five sections are composed from that, and every entry names the fact
 * it rests on.
 *
 * ## The rules
 *
 * 1. **No entry without a fact.** Every bullet is built from a value the
 *    record holds. There is no branch in this module that produces an entry
 *    from an absence, and none that produces one from a judgement.
 * 2. **An absence is coverage, never a quadrant entry.** A register that was
 *    not read contributes nothing to Strengths and nothing to Threats — it is
 *    named in the section's own coverage line. This is
 *    `infrastructureEvidence`'s rule (`docs/reports/PLANNING_CONTROLS_IN_THE_REPORT.md`
 *    §9) applied to a second surface: an absence may not be rated, and "no
 *    flood overlay was returned" is not a strength.
 * 3. **The modelling travels only where the tier carries it.** `finance` is
 *    null on the Compass and the Due Diligence report, and every entry that
 *    would state a yield, a weekly position, an LVR or an equity figure is
 *    then simply not produced — not softened, not rounded, not described in
 *    words. `TIER_FRAMEWORK.md` Decision E: withholding the modelling is not
 *    withholding the price.
 * 4. **Suitability states a REQUIREMENT, never a person.** What the asset
 *    demands of whoever holds it is a fact about the asset. Whether a
 *    particular investor meets it is not in this record — no personal
 *    circumstances are supplied to any report — so the section says what is
 *    required and says plainly that the match is not assessed here.
 * 5. **Liquidity is measured; equity is modelled.** How many dwellings of
 *    this kind sold in this market last quarter is a published fact. What the
 *    equity is at year five is an output of the projection under a recorded
 *    growth rate. They are different claims, they are labelled differently,
 *    and the second never appears where the modelling does not travel.
 * 6. **Monitoring names the register, its cadence and the reading that would
 *    change the conclusion** — and never promises that this platform will
 *    watch it. A review date is an instruction to a person.
 * 7. **A threshold nobody published may not produce a rating.** This is rule 2
 *    with the absence taken out of it, and it was learned here: the first
 *    version graded sales volume at 250 settled sales a quarter, a number
 *    invented in this file, and rendered against production it put "A thin
 *    market" in a client's Weaknesses column over 162 house sales in one
 *    quarter in one Sydney postcode. A count is stated; the reader grades it.
 *
 * Pure: no fetch, no Deno, no clock. Every date in the output is a date the
 * caller supplied from the record.
 */

import type { MarketFacts, MarketFactRow } from '../market/marketFactBlocks.pure.ts';
import type { EvidenceKey } from '../market/marketEvidence.pure.ts';
import {
  readScoreAssessment,
  assessmentPrecisionNote,
  type ScoreAssessmentReading,
} from '../market/scoreAssessmentReading.pure.ts';
import type { SubjectPrice } from './subjectPrice.pure.ts';
import { recordedMarketRisks } from './scoreSections.pure.ts';
import { MONTHS_LONG, MONTHS_SHORT, formatReportDateShort } from '../reportDate.pure.ts';
import { closeDoubledStops } from '../text.pure.ts';

/**
 * A date as the reader writes it: `17 Sep 2026`, never `2026-09-17`.
 *
 * Every date in these sections used to be printed with `.slice(0, 10)` — the
 * machine's form, on a page a client reads (the 23 Sep 2026 Compass for
 * 97 Poole Road carried nine of them). The value is unchanged; only how it is
 * written. Anything that is not an ISO date comes back as it was.
 */
function dayOf(iso: string | null | undefined): string {
  if (!iso) return '';
  return formatReportDateShort(iso.slice(0, 10)).replace(/^0(?=\d)/, '');
}

/** `2021-03` → `Mar 2021`, `2026-03-31` → `31 Mar 2026`, anything else unchanged. */
function periodsIn(text: string): string {
  return text
    // Found here and READ by the shared formatter (`dayOf`), never parsed.
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, (m) => dayOf(m))
    .replace(/\b(\d{4})-(\d{2})\b/g, (m, y: string, mo: string) => {
      const name = MONTHS_SHORT[Number(mo) - 1];
      return name ? `${name} ${y}` : m;
    });
}

// ─── What the sections rest on ──────────────────────────────────────────────

/** The financial engine's own figures. Null wherever the tier withholds the modelling. */
export interface StrategyFinance {
  /** `keyMetrics.grossRentalYield`, a percentage. */
  grossYield: number | null;
  /** `keyMetrics.netRentalYield`, a percentage. */
  netYield: number | null;
  /** `keyMetrics.weeklyNet` — negative means the owner contributes. */
  weeklyNet: number | null;
  /** `keyMetrics.annualNet`. */
  annualNet: number | null;
  /** `keyMetrics.lvr`, a percentage. */
  lvr: number | null;
  /** `keyMetrics.totalInvestment` — deposit plus acquisition costs. */
  upfront: number | null;
  /** `annualCosts.totalAnnual`. */
  annualCosts: number | null;
  /** `loanDetails.loanAmount`. */
  loanAmount: number | null;
  /** `loanDetails.interestRate`, a percentage. */
  interestRate: number | null;
  /** The sentence the ledger publishes for the loan. */
  loanStructure: string | null;
  /** `loanDetails.interestOnlyPeriod` in years — 0 is an explicit principal-and-interest answer. */
  interestOnlyYears: number | null;
  /** True where that term was assumed rather than recorded. */
  interestOnlyAssumed: boolean;
  /** `assumptions.capitalGrowth` — the rate the projection runs on. */
  capitalGrowth: number | null;
  /** `income.weeklyRent`. */
  weeklyRent: number | null;
  /** `keyMetrics.occupancyWeeks`. */
  occupancyWeeks: number | null;
}

/** What the planning layers answered for this property. */
export interface StrategyPlanning {
  /** The zone as the layer stated it, or null. */
  zone: string | null;
  /** `stated` | `not_served` | `none_at_point` | `not_integrated` | `licence_restricted` | `unavailable`. */
  zoneStatus: string | null;
  /** The publisher's own name for the layer. */
  zoneSource: string | null;
  /** The instrument's own currency date, as the publisher gave it. */
  zoneEffectiveDate: string | null;
  /** The council the cadastre resolved. */
  council: string | null;
  /** The sentence naming what actually settles the question. */
  verification: string | null;
  /** When this report retrieved it. */
  retrievedAt: string | null;
}

/**
 * What `_shared/transportReading.pure.ts`'s `transportCountReading` returns.
 *
 * Declared structurally rather than imported: a canonical investment module
 * may not reach into `_shared/` (`investmentSourceOfTruth.spec.ts`), so the
 * CALLER reads it and passes it in, exactly as it does the market facts and
 * the subject price.
 */
export interface StrategyTransportCount {
  /** Boarding places within `radiusMetres`, stations counted once. */
  count: number | null;
  radiusMetres: number;
  /** e.g. "117 boarding places within 1.6 km". */
  label: string | null;
  /** True where the radius had to be assumed from a legacy row. */
  radiusAssumed: boolean;
}

/**
 * What the transport feeds answered.
 *
 * ## The defect this shape exists to end
 *
 * The first version read `stopsWithin1km` straight off the stored block and
 * printed "117 public transport stops within one kilometre". That field's own
 * documentation says, in `transportReading.pure.ts`:
 *
 * > DEPRECATED NAME, KEPT FOR COMPATIBILITY. The value is the count within
 * > `radiusMetres`, which is 1,600 — not within one kilometre. … Nothing new
 * > should read it: ask `transportCountReading()`.
 *
 * Re-measured against `transport_stops` at 18 Annabelle Crescent's verified
 * coordinate (-33.7115485, 150.9586199) on 18 Sep 2026:
 *
 * | reading | value |
 * | --- | ---: |
 * | boarding places within **1,000 m** | **51** |
 * | boarding places within **1,600 m** | 116 (the row stores 117) |
 * | raw stop rows within 1,600 m | 239 |
 * | nearest boardable stop | 105.9 m |
 *
 * So the sentence overstated the density within its own stated radius by
 * **2.3 times**. The count is of PLACES rather than platforms — 239 rows
 * become 116 places — which is why it may never be called "stops" either.
 */
export interface StrategyTransport {
  /** `gtfs` where a loaded feed answered; anything else is a different source. */
  source: string | null;
  /** `stops_nearby` | `none_within_radius` | `outside_loaded_networks` | null. */
  verdict: string | null;
  /** The count, its true radius and a label that is true of both. */
  countReading: StrategyTransportCount | null;
  /** Straight-line kilometres to the nearest boarding place. Never a walk. */
  nearestKm: number | null;
  nearestName: string | null;
  /** The publisher and licence of every feed that contributed. */
  sources: string[];
  /** When the contributing feed was last loaded, ISO; null on a legacy row. */
  feedLoadedAt: string | null;
  /**
   * When THIS count was taken, ISO — the enrichment's own acquisition stamp,
   * null on a row that carries none.
   *
   * Two different dates, and the reading used to state only the first as
   * though it were both: the feed behind 18 Annabelle Crescent was loaded
   * 2026-09-07 and the count was taken 2026-09-17. "The count is as at the
   * feed's load date" is false of the measurement and true of the data under
   * it, so both are said, each as what it is.
   */
  measuredAt: string | null;
  /** The things the feeds do not publish — carried verbatim. */
  notMeasured: string[];
}

/**
 * One dimension of the investment score, fully qualified.
 *
 * ## The defect this exists to end
 *
 * `investment_score.{strengths, weaknesses, opportunities, risks}` are
 * unqualified one-liners — "Measured demand in this market is soft",
 * "Measured capital growth in this suburb is strong", "Below average rental
 * yield may require owner contribution". None names its dimension, its score,
 * the nominal points at stake, the evidence behind it, who calculated it, or
 * how the grade treats it. A reader cannot tell whether "soft" is 13 out of
 * 100 or 45, nor that the dimension carries 21 of the score's 100 points, nor
 * that two of the five dimensions were not scored at all.
 *
 * `investment_score.breakdown` holds every one of those facts and no surface
 * read it. On 18 Annabelle Crescent, measured 18 Sep 2026:
 *
 * | dimension | score | nominal | delivered | evidence |
 * | --- | ---: | ---: | ---: | --- |
 * | growth   | 56/100 | 57 | 31.9 | five-year 6.2% p.a., three-year 4.4%, twelve-month 6.3% |
 * | yield    | 23/100 | 21 |  4.8 | 2.97% gross on $1,490,000 |
 * | demand   | 13/100 | 21 |  2.7 | −0.4% annual population growth, Kellyville – East |
 * | risk     |      — |  0 |    — | excluded: no property-specific risk measurement |
 * | location |      — |  0 |    — | excluded: no location input met the verification standard |
 *
 * 31.9 + 4.8 + 2.7 = 39.4, which is the stored total of 40. So the whole score
 * is reconstructible from the breakdown, and the four lists add nothing a
 * qualified reading does not say better.
 */
export interface ScoreDimensionReading {
  /** `growth`, `yield`, `demand`, `risk`, `location` — the engine's own key. */
  key: string;
  label: string;
  /** Out of 100 for this dimension, or null where it was not scored. */
  score: number | null;
  /** The dimension's nominal points out of the score's 100. */
  nominalPoints: number;
  /** `score% × nominalPoints`, or null where not scored. */
  deliveredPoints: number | null;
  /** The evidence the engine recorded, verbatim. */
  evidence: string | null;
  /** The named inputs the engine used. */
  inputs: string[];
  /** True where the engine excluded the dimension rather than scoring it low. */
  excluded: boolean;
}

/** The stored score, read for its grade, its gaps and its per-dimension detail. */
export interface StrategyScore {
  grade: string | null;
  total: number | null;
  /** Reasons the grade was withheld or capped, as the scorer wrote them. */
  gaps: string[];
  /** Every dimension, qualified. Replaces the four unqualified lists. */
  dimensions: ScoreDimensionReading[];
  /** e.g. "Partial score: 3 of 5 dimensions". */
  coverageLabel: string | null;
  /** The share of the nominal 100 points the scored dimensions carry, 0–1. */
  weightCovered: number | null;
  /** What the engine said about a dimension it did not score, by key. */
  notAssessed: Record<string, string>;
  /** The engine that calculated it, where the row records one. */
  authority: string | null;
  /**
   * The market risks recorded with the grade (`recordedMarketRisks`) — the list
   * the verdict page's watch points read, so the SWOT's Threats cannot say
   * "none" beside a page that lists one. Optional: a record built before it
   * carries no key and every composer draws what it drew.
   */
  risks?: string[];
  /**
   * The full assessment — original nominal weights, adjusted weights,
   * contributions, composite, uncapped grade, ceiling and issued grade —
   * reconstructed by `readScoreAssessment` and passed in by the caller.
   *
   * Null where the caller supplied none, and then the table is not drawn: a
   * partial assessment is how the stored `weight` came to be printed as a
   * nominal weight and 70% as evidence coverage.
   */
  assessment: ScoreAssessmentReading | null;
}

/** The property's own recorded attributes. */
export interface StrategyProperty {
  address: string;
  propertyType: string | null;
  landSqm: number | null;
  councilArea: string | null;
  parking: number | null;
  bedrooms: number | null;
  /**
   * Recorded bathrooms and construction year, where the record holds them.
   *
   * Optional so every record built before they were read — and every caller
   * that builds one by hand — stays valid and byte-identical. They exist so a
   * layout limitation and an older build can reach the Weaknesses quadrant
   * from the RECORD: on the 25 Sep 2026 Compass for 60 Lawley Street the
   * Property Fit chapter listed "One bathroom" and "Older construction" as
   * the main limitations while the SWOT beside it said no weakness had been
   * identified, because this module never read either fact.
   */
  bathrooms?: number | null;
  yearBuilt?: number | null;
}

export interface StrategyRecord {
  property: StrategyProperty;
  price: SubjectPrice;
  market: MarketFacts;
  /** Null where this tier does not carry the analysis of a purchase. */
  finance: StrategyFinance | null;
  planning: StrategyPlanning;
  transport: StrategyTransport;
  score: StrategyScore;
  /**
   * What the site's own registers said, where the caller read them. Optional,
   * and absent on every record built before the strategic read existed, which
   * is what keeps every composer that does not read it byte-identical.
   */
  site?: StrategySite | null;
}

/** How a land use table treats a use — `landUsePermissibility`'s own words. */
export type StrategyStanding =
  | 'permitted_with_consent' | 'permitted_without_consent' | 'prohibited' | 'not_stated';

/**
 * The land use table and the development pipeline, read by the CALLER.
 *
 * A canonical investment module may not import `_shared/planning`, so the
 * reading arrives as plain data — and the planning module's own qualifying
 * sentences arrive WITH it, verbatim, because a rule stated twice is how the
 * two statements come to disagree.
 */
export interface StrategySite {
  landUse: {
    /** `instrumentAnchor(table)` — "Under <instrument>, as read on <date>,". */
    anchor: string;
    dwellingHouse: StrategyStanding;
    /** The additional residential uses the table names, each with its standing. */
    additional: Array<{ use: string; standing: StrategyStanding }>;
    /** `EXISTING_DWELLING_CAVEAT`, verbatim. */
    caveat: string;
    /** `READING_LIMIT`, verbatim. */
    limit: string;
  } | null;
  pipeline: {
    /** New dwellings stated on the applications that gave a count. */
    dwellings: number;
    council: string;
    /** The register window, as the evidence words it. */
    window: string | null;
    /** How much of the register the total was summed from. */
    rowsRead: number | null;
    totalStated: number | null;
  } | null;
}

// ─── Small shared writers ───────────────────────────────────────────────────

/*
 * Grouped by hand, never `toLocaleString`. `reportDesign/measure.pure.ts`
 * records why and a spec enforces it over every canonical investment module:
 * the same payload is formatted in Deno and in Node and their ICU builds need
 * not agree on grouping.
 */
const money = (n: number): string =>
  `$${String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const signedMoney = (n: number): string => (n < 0 ? `−${money(n)}` : money(n));
const pct = (n: number, dp = 1): string => `${n.toFixed(dp)}%`;
/*
 * "a 84% rise" — the article is decided by the SOUND of the first character,
 * and a percentage begins with a digit whose name may start with either. 8, 11
 * and 18 take "an"; every other leading digit takes "a".
 */
const article = (value: string): 'a' | 'an' => {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.startsWith('8')) return 'an';
  if (/^1[18]/.test(digits)) return 'an';
  return 'a';
};
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One entry: the claim, and the fact it rests on. Never one without the other. */
export interface PositionEntry {
  /** What a reader takes from it. */
  claim: string;
  /** The recorded figure or reading it is built from, with its provenance. */
  basis: string;
}

const writeEntries = (entries: PositionEntry[]): string[] =>
  entries.map((e) => `- **${e.claim}** ${e.basis}`);

/**
 * The market row for a measure, or null. Never a benchmark.
 *
 * `key` is typed `EvidenceKey` rather than `string` deliberately. The first
 * render of this module asked for `medianSalePrice`, `salesVolume`,
 * `rentalVacancy` and `auctionClearance` — four names the union does not
 * carry — and every one of them returned null in silence, so the SWOT drew no
 * median, the suitability profile no liquidity requirement and the monitoring
 * table no sale-price row, on a record that held all three. That is
 * `docs/aml/CASE_TENANT_COLUMN.md`'s rule in a different schema: **never name
 * a field the shape does not have**, and the way to make it impossible rather
 * than merely forbidden is to let the compiler read the union.
 */
function subjectRow(market: MarketFacts, key: EvidenceKey): MarketFactRow | null {
  return market.rows.find((r) => r.key === key && !r.benchmark) ?? null;
}

/** "the NSW Department of … median sale price of houses, postcode 2155, March 2026 quarter". */
function citeRow(row: MarketFactRow): string {
  return periodsIn(`${row.publisher} — ${row.describes}`);
}

/**
 * How many years of the published series the resale section draws.
 *
 * Ten, because ten years is the longest window any growth rate in this report
 * is measured over (`growth10YearCagr`), so the drawing and the longest figure
 * quoted from the same series describe the same stretch of time: eleven
 * points, the two ends of that window and every year between.
 */
export const PRICE_HISTORY_YEARS = 10;

/** Fewer yearly points than this is a comparison, not a history, and is not drawn. */
const MIN_PRICE_HISTORY_POINTS = 4;

/**
 * The published price history, drawn: one bar a year.
 *
 * ## Why this exists
 *
 * The 60 Lawley Street Compass (25 Sep 2026) told its reader that the price
 * history "covers 60 periods (Sep 2011 to Jun 2026)" and that "a long series
 * is what makes a growth rate a measurement rather than an impression" — a
 * sentence about the data, where an adviser shows the data. The record held
 * all sixty points under an open licence; the row that carried them wrote
 * them as their extent and dropped the rest.
 *
 * ## What it draws, and what it refuses to
 *
 *  - **Only the publisher's own figures.** Every value is a point of the
 *    stored series, as published. Nothing is smoothed, interpolated, indexed
 *    or extended, and no trend is drawn through it — which is what
 *    `CHART_IS_A_CLAIM` asks of a model, kept here by construction.
 *  - **The same quarter every year.** A quarterly series is sampled at the
 *    latest point's own quarter, so no bar is a different season from the one
 *    beside it; an annual series (every point a December figure, which is how
 *    a calendar-year median is stored) is drawn as calendar years.
 *  - **Only past the licence gate.** `series` exists only on a row that may
 *    reach a client, so a series nobody may publish is never drawn.
 *  - **All or nothing.** A missing year inside the window leaves a gap a
 *    reader would take for a year nothing sold, so a window with a hole in it
 *    is not drawn at all; neither is one of fewer than four years.
 *
 * The title names the geography because a state series in a suburb's report
 * reads as the suburb's unless it says otherwise, and the source line under it
 * names the publisher and the measure — a mean of the dwelling stock is not a
 * median sale price, and the two are not drawn under one word.
 */
export function priceHistoryChart(row: MarketFactRow | null | undefined): string | null {
  const points = [...(row?.series?.points ?? [])].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  if (points.length < MIN_PRICE_HISTORY_POINTS) return null;
  const annual = points.every((p) => p.period.endsWith('-12'));
  const quarterly = points.every((p) => ['03', '06', '09', '12'].includes(p.period.slice(5)));
  const month = points[points.length - 1].period.slice(5);
  const yearly = points.filter((p) => p.period.slice(5) === month).slice(-(PRICE_HISTORY_YEARS + 1));
  if (yearly.length < MIN_PRICE_HISTORY_POINTS) return null;
  for (let i = 1; i < yearly.length; i += 1) {
    if (Number(yearly[i].period.slice(0, 4)) !== Number(yearly[i - 1].period.slice(0, 4)) + 1) return null;
  }
  const monthIndex = Number(month) - 1;
  const monthShort = MONTHS_SHORT[monthIndex];
  const monthName = MONTHS_LONG[monthIndex];
  if (!annual && (!monthShort || !monthName)) return null;
  const items = yearly.map((p) => {
    const year = p.period.slice(0, 4);
    return `${annual ? year : `${monthShort} ${year}`} ${money(p.value)}`;
  });
  // The directive grammar's own separators may not appear in a name it carries.
  const area = String(row?.series?.area ?? '').replace(/[|{}]/g, ' ').replace(/\s+/g, ' ').trim();
  const when = annual ? 'by calendar year' : `${monthName}${quarterly ? ' quarter' : ''} of each year`;
  const title = `Published price history${area ? ` — ${area}` : ''}, ${when}`;
  return `{{bars: ${items.join(', ')} | title=${title}}}`;
}

/**
 * The count, in the radius it was actually measured over.
 *
 * "Boarding places" rather than "stops", because the count groups a station
 * and its platforms into one; and the radius comes from the reading rather
 * than from a field name, because the field name is wrong.
 */
function transportCountPhrase(t: StrategyTransportCount): string {
  const km = t.radiusMetres / 1000;
  const distance = Number.isInteger(km) ? `${km} km` : `${km.toFixed(1)} km`;
  return `${t.count} boarding ${t.count === 1 ? 'place' : 'places'} within ${distance} straight-line`;
}

/**
 * Everything the owner's correction requires a transport reading to state:
 * the exact source, the radius, the unit, the date and the measurement
 * definition — followed by what it does not establish.
 */
/**
 * The register a fallback transport reading came from, in the reader's words.
 *
 * Page 34 of the Investment Compass delivered for 9 Hollow Street on
 * 21 Sep 2026 printed the sentence below with `` `osm_amenity_register` `` set
 * in code backticks, mid-paragraph, to a client. That is the third instance of
 * one defect on this document — `vic_vpsr_suburb` where a publisher belongs
 * and `transactionVolume` where a measure's name belongs — and the rule is the
 * AML roster's: **database vocabulary never reaches the reader.**
 *
 * `plan_zone` and `plan_overlay` are deliberately untouched anywhere in this
 * report, and the distinction is the whole rule: those are **Vicmap
 * Planning's own published layer names**, which the register table cites
 * correctly as "Vicmap Planning — plan_zone (opendata.maps.vic.gov.au WFS)".
 * An identifier the PUBLISHER uses is a name. An identifier WE invented is
 * debris.
 *
 * The fallback names the kind of thing rather than the key, because the
 * sentence around it already says what matters — that this was not the
 * operator's stop file and counts a category rather than boarding places — so
 * an unrecognised source needs no identifier to read correctly.
 */
const TRANSPORT_SOURCE_NAME: Readonly<Record<string, string>> = {
  osm_amenity_register: 'a community-edited amenity register',
  amenity_register: 'a community-edited amenity register',
  places: 'a places directory',
};

export function transportSourceName(source: string | null | undefined): string {
  const key = String(source ?? '').trim();
  const named = TRANSPORT_SOURCE_NAME[key];
  if (named) return named;
  // A name a reader could already use passes through; anything that reads as
  // an identifier is replaced rather than printed.
  return key && !/^[a-z0-9]+(?:[_-][a-z0-9]+)+$/.test(key) && !/^[a-z]+[A-Z]/.test(key)
    ? key
    : 'another register';
}

function transportBasis(t: StrategyTransport): string {
  const parts: string[] = [];
  if (t.sources.length) parts.push(t.sources.join('; ') + '.');
  parts.push(
    'Counted from the transport operator\'s own published stop data, as straight-line distance from the '
    + 'property, with a station and its platforms counted as one place.',
  );
  if (t.countReading?.radiusAssumed) {
    parts.push('The search radius is not recorded for this count; the standard radius is assumed.');
  }
  // A feed-load date is not a measurement date. The count was taken when the
  // enrichment ran; the stop file behind it is current as at the feed's load.
  // Stating only the load stamp presented the publisher's currency as ours.
  if (t.measuredAt) {
    parts.push(t.feedLoadedAt
      ? `Counted on ${dayOf(t.measuredAt)}, from the operator\'s stop data current at ${dayOf(t.feedLoadedAt)}.`
      : `Counted on ${dayOf(t.measuredAt)}. The date of the operator\'s stop data behind it is not recorded.`);
  } else {
    parts.push(t.feedLoadedAt
      ? `Counted from the operator\'s stop data current at ${dayOf(t.feedLoadedAt)}; the date of the count itself is not recorded.`
      : 'Neither the date of this count nor the date of the operator\'s stop data behind it is recorded.');
  }
  if (t.nearestName && isNum(t.nearestKm)) {
    parts.push(`Nearest boarding place: ${t.nearestName}, ${t.nearestKm} km straight-line.`);
  }
  // One sentence, not the feeds' own paragraph on each thing they omit: the
  // reader needs to know the count is not a journey, and the four words say
  // it. The fuller notes stay on the reading for anyone who asks the record.
  parts.push('It does not establish mode, service frequency, walking distance or travel time.');
  return parts.join(' ');
}

// ─── 1. SWOT ────────────────────────────────────────────────────────────────

export interface Swot {
  strengths: PositionEntry[];
  weaknesses: PositionEntry[];
  opportunities: PositionEntry[];
  threats: PositionEntry[];
  /** Registers read and registers not read, so an empty quadrant is legible. */
  coverage: string[];
}

/**
 * How many years before the report a recorded build must be to be named an
 * older dwelling.
 *
 * It is a description, not a rating: the entry it gates says the age is not a
 * defect and hands the question to the building inspection. Forty years is
 * the point at which the original roof covering, wiring and plumbing of a
 * house have usually reached the end of their service lives, which is what
 * the entry tells a reader to have checked — a newer dwelling is not called
 * old, and nothing here scores or prices the age.
 */
const OLDER_DWELLING_YEARS = 40;

/**
 * Rule 1 and rule 2 in one function.
 *
 * Every push is guarded by the presence of the value it names. `coverage`
 * takes everything that could not be read — it is the only place an absence
 * appears, and it is prose rather than a quadrant.
 */
export function buildSwot(rec: StrategyRecord): Swot {
  const s: PositionEntry[] = [];
  const w: PositionEntry[] = [];
  const o: PositionEntry[] = [];
  const t: PositionEntry[] = [];
  const coverage: string[] = [];

  const g1 = subjectRow(rec.market, 'growth1Year');
  const g3 = subjectRow(rec.market, 'growth3YearCagr');
  const g5 = subjectRow(rec.market, 'growth5YearCagr');
  const g10 = subjectRow(rec.market, 'growth10YearCagr');
  const median = subjectRow(rec.market, 'medianPrice');
  const volume = subjectRow(rec.market, 'salesCount');

  // ── Market ──
  const longest = g10 ?? g5 ?? g3;
  if (longest && longest.value) {
    const horizon = longest === g10 ? 'ten years' : longest === g5 ? 'five years' : 'three years';
    s.push({
      claim: `Measured capital growth over ${horizon} of ${longest.value} a year.`,
      basis: `${citeRow(longest)}. It is a measurement of what this market did, not a forecast of what it will do.`,
    });
  }
  /*
   * The one-year rate against the longer-run average is NOT a quadrant entry.
   *
   * The first version put it in Opportunities when the latest year ran more
   * than two percentage points ahead and in Threats when it ran two behind —
   * and two points is a number invented in this file. It decided whether a
   * client read an opportunity, a threat or nothing at all, on a rendered
   * difference of 1.7 points for 262 Pallas Street. Rule 7: the comparison is
   * worth making and the verdict is not this module's to pronounce, so both
   * figures are stated together in the holding strategy, with no rating word
   * between them.
   */
  /*
   * Sales volume is deliberately NOT a quadrant entry.
   *
   * The first version of this module rated it: 250 settled sales or more was
   * "a liquid market", fewer was "a thin market". Nobody publishes that
   * threshold, and rendered against production it called 162 house sales in
   * one quarter in a single Sydney postcode "thin" — a verdict invented by
   * this file, carried into a client's Weaknesses column, sourced to a
   * register that says nothing of the kind.
   *
   * That is `docs/reports/PLANNING_CONTROLS_IN_THE_REPORT.md` §9's rule with
   * the absence taken out of it: **a threshold nobody published may not
   * produce a rating.** The volume is a fact and it is stated as one, in the
   * exit section, where a reader can judge it against a market they know.
   */
  /*
   * The price beside the market's median is CONTEXT, never a quadrant entry.
   *
   * It was an Opportunity when the price sat below the median and a Weakness
   * when above — on the 23 Sep 2026 Compass for 97 Poole Road, "9% below the
   * market's median" was the whole Opportunities quadrant. A median is the
   * middle of what sold across a postcode; the difference can be land,
   * condition, age or position, and filing it under Opportunities is the
   * valuation claim `MARKET_FIGURES_IN_THE_REPORT.md` forbids by name. Both
   * figures stay on the page (S5-F), stated side by side in the evidence
   * notes, with no verdict between them.
   */
  if (median && median.value && rec.price.value !== null) {
    const m = Number(median.value.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(m) && m > 0) {
      coverage.push(
        `The ${rec.price.basis === 'accepted_input' ? 'price this analysis is modelled on' : 'price the listing recorded'} `
        + `is ${money(rec.price.value)}; the market's median is ${median.value} (${citeRow(median)}). A median describes `
        + 'the whole market, not this dwelling, so the difference is not counted for or against the property.',
      );
    }
  }
  /*
   * The market risks recorded with the grade are Threats, in the scorer's own
   * words — the list the verdict page's watch points already print. Composing
   * a threat here would be the rating this module refuses to invent; READING
   * one the grade carries is what keeps the SWOT from saying "none identified"
   * under a verdict page that lists one (60 Lawley Street, 25 Sep 2026).
   */
  for (const risk of rec.score.risks ?? []) {
    t.push({
      claim: /[.!?]$/.test(risk) ? risk : `${risk}.`,
      basis: 'Recorded with the grade as a market risk. It describes the market, not this dwelling, and it is not '
        + 'a forecast.',
    });
  }

  // ── The dwelling itself ──
  //
  // A layout limitation and an older build are facts about THIS property, and
  // the Property Fit chapter already names them as its main limitations — so a
  // SWOT that reads only the registers and then says "no weakness identified"
  // contradicts the page before it. Each entry is drawn only where the RECORD
  // holds the fact, and says what it is not: neither is a defect, and neither
  // is a finding an inspection has made.
  const beds = rec.property.bedrooms;
  const baths = rec.property.bathrooms ?? null;
  if (isNum(baths) && isNum(beds) && baths === 1 && beds >= 3) {
    w.push({
      claim: `One bathroom serving ${beds} bedrooms.`,
      basis: 'The dwelling\'s configuration as described for this report. A single bathroom narrows the households the layout '
        + 'suits against homes of the same size that have two; it is a limitation of the layout, not a defect.',
    });
  }
  const built = rec.property.yearBuilt ?? null;
  const asOfYear = rec.transport.measuredAt ? Number(String(rec.transport.measuredAt).slice(0, 4)) : null;
  if (isNum(built) && isNum(asOfYear) && built > 1800 && asOfYear - built >= OLDER_DWELLING_YEARS) {
    w.push({
      claim: `An older dwelling, built in ${built}.`,
      basis: `Built ${asOfYear - built} years before this report. Age is not a defect; `
        + 'it is why the condition of the roof, wiring, plumbing and any later alterations is a matter for the '
        + 'building inspection rather than something this report can assume.',
    });
  }

  // ── Planning ──
  if (rec.planning.zoneStatus === 'stated' && rec.planning.zone) {
    s.push({
      claim: `The zone is confirmed on the published planning layer: ${rec.planning.zone}.`,
      basis: `${rec.planning.zoneSource ?? 'the jurisdiction planning layer'}`
        + (rec.planning.zoneEffectiveDate ? `, current at ${dayOf(rec.planning.zoneEffectiveDate)}` : '')
        + `. ${rec.planning.verification ?? ''}`.trimEnd(),
    });
  } else if (rec.planning.zoneStatus) {
    coverage.push(
      `The zone was **not read from a layer** for this property (${rec.planning.zoneStatus.replace(/_/g, ' ')})`
      + (rec.planning.council ? `, although the cadastre resolved the council as ${rec.planning.council}` : '')
      + '. Nothing here treats that as a finding either way.',
    );
  }

  // ── Transport ──
  const tCount = rec.transport.countReading;
  if (rec.transport.verdict === 'stops_nearby' && tCount && isNum(tCount.count) && tCount.count > 0) {
    s.push({
      claim: `${transportCountPhrase(tCount)}.`,
      basis: transportBasis(rec.transport),
    });
  } else if (rec.transport.verdict === 'outside_loaded_networks') {
    coverage.push(
      'The property is **outside the public transport networks whose stop data this report covers**, which is a '
      + 'limit of this report rather than a fact about the area. It is not evidence that the area is poorly served, '
      + 'and nothing in this section counts it either way; the local operator\'s published timetable shows the '
      + 'services that run near the property.',
    );
  } else if (rec.transport.source && rec.transport.source !== 'gtfs') {
    /*
     * A register count of STATIONS is not a measure of public transport
     * access, and must never be described as one. On 262 Pallas Street the
     * stored block is `{ source: 'osm_amenity_register', stationsWithin2km: 0,
     * nearestStation: null }` — a count of one amenity CATEGORY from a
     * community-edited register, not the operator's own stop file, and no
     * loaded timetable feed reaches Queensland outside the south-east.
     */
    /*
     * …and it is not the only transport evidence a report can carry, so this
     * line may not read as though it were. On the 60 Lawley Street Compass the
     * Transport chapter named Route 852 and a stop on Lawley Street from the
     * council's own published pages, while this line — and the risk register
     * after it — read as if nothing about transport was held at all. Both were
     * true of what each read; neither said which.
     */
    coverage.push(
      `Public transport was **not measured from an operator's own published stop data** for this property. The count `
      + `available comes from ${transportSourceName(rec.transport.source)}, which counts one kind of place rather than `
      + 'boarding points, so nothing here states how this property is served and no conclusion is drawn either way. A '
      + 'route or timetable described elsewhere in this report comes from the operator\'s or council\'s own published '
      + 'pages; it is not a measurement and is not scored.',
    );
  }

  // ── The modelling, where it travels ──
  const f = rec.finance;
  if (f) {
    if (isNum(f.grossYield) && isNum(f.netYield)) {
      const thin = f.grossYield < 3.5;
      (thin ? w : s).push({
        claim: thin
          ? `A thin income return: ${pct(f.grossYield, 2)} gross, ${pct(f.netYield, 2)} net.`
          : `An income return of ${pct(f.grossYield, 2)} gross, ${pct(f.netYield, 2)} net.`,
        basis: 'Computed from the recorded rent and the purchase price this analysis is modelled on, before finance '
          + 'and before tax. Net is unlevered — it carries the operating costs and not the loan.',
      });
    }
    if (isNum(f.weeklyNet) && f.weeklyNet < 0) {
      w.push({
        claim: `The position needs ${money(f.weeklyNet)} a week from the owner.`,
        basis: `${signedMoney(f.annualNet ?? f.weeklyNet * 52)} a year after operating costs and loan payments, at `
          + `${isNum(f.interestRate) ? pct(f.interestRate, 2) : 'the recorded rate'}`
          + `${f.loanStructure ? ` on ${f.loanStructure.charAt(0).toLowerCase()}${f.loanStructure.slice(1)}` : ''}. `
          + 'That is a cost of holding, met from income outside the property.',
      });
    } else if (isNum(f.weeklyNet) && f.weeklyNet >= 0) {
      s.push({
        claim: `The position covers itself: ${money(f.weeklyNet)} a week after costs and loan payments.`,
        basis: `${signedMoney(f.annualNet ?? f.weeklyNet * 52)} a year at `
          + `${isNum(f.interestRate) ? pct(f.interestRate, 2) : 'the recorded rate'}.`,
      });
    }
    if (f.interestOnlyAssumed && isNum(f.interestOnlyYears) && f.interestOnlyYears > 0) {
      t.push({
        claim: `The interest-only term is an assumption, not a recorded fact — ${f.interestOnlyYears} years.`,
        basis: 'The loan was set up as interest-only without a term, so the standard term is assumed and stated as '
          + 'an assumption. When the term ends the payment steps up to principal and interest over the '
          + 'remaining years, and the real term is the one on the loan offer.',
      });
    }
    if (isNum(f.lvr) && f.lvr >= 80 && f.lvr < 100) {
      // One multiple, computed once. The first version wrote "five times" behind
      // a literal `=== '80%'` test and rendered "reaches equity  faster" at every
      // other ratio — a sentence with a hole where its only number should be.
      const gearing = 100 / (100 - f.lvr);
      t.push({
        claim: `At ${pct(f.lvr, 0)} lending, a fall in value reaches equity ${gearing.toFixed(gearing % 1 === 0 ? 0 : 1)} times faster than it reaches the market.`,
        basis: `${money(f.loanAmount ?? 0)} borrowed against ${money(rec.price.value ?? 0)} leaves ${pct(100 - f.lvr, 0)} `
          + `of the value as the owner's. A 10% fall in value is a ${pct(10 * gearing, 0)} fall in that share. `
          + 'This is arithmetic on the recorded loan, not a prediction about values.',
      });
    }
    /*
     * The accepted CGR is NEVER described as the measured market rate.
     *
     * The first version said "The projection runs on the measured rate rather
     * than an assumed one" whenever the two agreed to within 0.05 points. They
     * agree on both subject properties — and agreement is not derivation. The
     * accepted CGR is an input recorded through the override workflow before
     * the report is generated; the register figure is a measurement of what
     * this market did. Nothing on the record says the first was taken from the
     * second, and a report that says so has invented a provenance.
     *
     * So the two are stated under the two labels the owner set, side by side,
     * and their relationship is described as agreement rather than as source.
     */
    if (isNum(f.capitalGrowth) && longest?.value) {
      const measured = parseFloat(longest.value);
      const agrees = Number.isFinite(measured) && Math.abs(f.capitalGrowth - measured) < 0.05;
      o.push({
        claim: agrees
          ? `The accepted CGR assumption and the observed market rate agree at ${pct(f.capitalGrowth, 1)} a year.`
          : `The accepted CGR assumption is ${pct(f.capitalGrowth, 1)} a year; the observed market rate is `
            + `${longest.value} a year.`,
        basis: `**Accepted CGR assumption used by the financial model:** ${pct(f.capitalGrowth, 1)} a year, set as `
          + 'an assumption for this analysis before the report was prepared, and carried unchanged into the loan, '
          + 'the cash flow and the ten-year projection. **Historical market growth observed in the approved '
          + `register:** ${longest.value} a year — ${citeRow(longest)}. They are separate facts from separate `
          + 'sources; nothing in this analysis shows that the assumption was derived from the measurement, and '
          + (agrees ? 'the two agreeing does not make it so.' : 'the difference is information rather than an error.'),
      });
    }
  } else {
    coverage.push(
      'Yield, cash flow, lending and equity are **deliberately not in this section**. They are the subject of the '
      + 'Financial Analysis Report, and this document does not carry the analysis of a purchase.',
    );
  }

  /*
   * The score's four free-text lists are NOT quadrant entries.
   *
   * "Measured demand in this market is soft" names no dimension, no score, no
   * nominal points, no evidence, no calculator and no grade treatment — and
   * rendered into a client's Weaknesses column it reads as a finding about
   * the market rather than a reading of one input. Every fact it gestures at
   * is in `breakdown`, qualified, and the section below states it there.
   */

  // ── What was not held ──
  const notHeld = (['vacancyRate', 'daysOnMarket', 'medianRent', 'auctionClearanceRate', 'vendorDiscount'] as const)
    .filter((k) => !subjectRow(rec.market, k));
  if (notHeld.length) {
    /*
     * "No published figure was held" read as a statement about the WHOLE
     * report, and on the 60 Lawley Street Compass two pages earlier quoted a
     * listing portal's days on market. Both were true: the portal figure is a
     * portal's own statistic the writer found, and this list is what the
     * registers this assessment reads hold. The sentence now says which.
     */
    coverage.push(
      'The sources checked for this report hold no figure for vacancy, days on market, advertised rent, vendor '
      + 'discount or auction clearance in this market. A figure a listing portal reports, where the report quotes '
      + 'one, is that portal\'s own statistic: it is not a measurement from those sources, it is not scored, and it '
      + 'is not counted here. Each would bear on the entries above; none is estimated, and their absence is not counted '
      + 'as a strength or a weakness.',
    );
  }
  if (rec.score.gaps.length) {
    coverage.push(
      tidySentences(`The investment score itself records ${rec.score.gaps.length === 1 ? 'a gap' : `${rec.score.gaps.length} gaps`}: `
      + `${rec.score.gaps.map((g) => g.replace(/[.\s]+$/, '')).join('; ')}.`),
    );
  }
  if (rec.score.coverageLabel) {
    coverage.push(
      `${rec.score.coverageLabel}`
      + (rec.score.weightCovered !== null
        ? `, carrying ${pct(rec.score.weightCovered * 100, 0)} of the score's nominal points`
        : '')
      + '. The dimensions and what each one rested on are set out in the appendix, under *How this grade was '
      + 'reached*.',
    );
  }

  return { strengths: s, weaknesses: w, opportunities: o, threats: t, coverage };
}

/*
 * An empty quadrant says WHAT WAS EXAMINED and what it would have taken to
 * fill it.
 *
 * "Nothing reads as a weakness" and "No threat is stated" were both
 * unqualified: a reader cannot tell whether four registers were searched and
 * came back clean or whether nothing was searched at all, and the second
 * reading is a reassurance the record does not support.
 */
const QUADRANT_NOTE: Record<keyof Omit<Swot, 'coverage'>, string> = {
  strengths: 'None identified from the market figures, the planning controls, the public transport data or the '
    + 'financial position in this report. The evidence examined is listed below.',
  weaknesses: 'None identified from the same sources or from the dwelling\'s recorded features. That is a statement '
    + 'about what was examined, not a clearance: the condition of the dwelling is for the building inspection.',
  opportunities: 'None identified: no recorded figure supports one, and none is inferred.',
  threats: 'None identified in the sources checked for this property. Sources this report does not cover are listed '
    + 'below — a source that was not checked is not a clean one.',
};

export function composeSwot(rec: StrategyRecord, heading: string): string {
  const swot = buildSwot(rec);
  const lines: string[] = [`## ${heading}`, ''];
  lines.push(
    'Each entry names the figure it rests on. Measures not published for this market, and sources this report does '
    + 'not cover, are listed under *What this rests on* rather than counted for or against the property.',
    '',
  );
  const groups: Array<[keyof Omit<Swot, 'coverage'>, string]> = [
    ['strengths', 'Strengths'],
    ['weaknesses', 'Weaknesses'],
    ['opportunities', 'Opportunities'],
    ['threats', 'Threats'],
  ];
  for (const [key, title] of groups) {
    lines.push(`### ${title}`, '');
    const entries = swot[key];
    if (entries.length) lines.push(...writeEntries(entries));
    else lines.push(`*${QUADRANT_NOTE[key]}*`);
    lines.push('');
  }
  if (swot.coverage.length) {
    lines.push('### What this rests on', '');
    for (const c of swot.coverage) lines.push(`- ${c}`);
    lines.push('');
  }
  /*
   * The grade's method is NOT part of the SWOT any more.
   *
   * `composeScoreDimensionTable` used to be appended here, which put two pages
   * of weights, contributions and rounding notes between the quadrants and the
   * Risk Dashboard — on the 60 Lawley Street Compass the SWOT ran from page 16
   * to page 18 and three quarters of it was method. The owner's structure is
   * SWOT → Risk → Due Diligence → Monitoring → Recommendation → methodology,
   * so the table is composed on its own (`composeGradeMethodology`) and the
   * generator places it in the appendix. The concise reading of the grade
   * stays on the verdict page, where it already was.
   */
  return lines.join('\n').trimEnd();
}

/**
 * How the grade was reached — the scoring method, for the appendix.
 *
 * The same table `composeSwot` used to carry, under its own sub-heading and
 * nothing else, so it can be placed where the method belongs rather than in
 * the middle of the assessment. Null where the record holds no scored
 * dimension, exactly as before.
 */
export function composeGradeMethodology(rec: StrategyRecord): string | null {
  return composeScoreDimensionTable(rec);
}

/**
 * Every score dimension, with everything a reader needs to weigh it.
 *
 * Nothing here is derived: the score, the nominal points, the evidence and the
 * inputs are the engine's own, and the delivered points are the product of two
 * of them. A dimension the engine EXCLUDED is listed with the engine's own
 * reason rather than omitted — excluding is a statement, and a table that
 * silently drops two of five rows reads as a complete score.
 */
/** The shared rule, under the name this module has always called it by. */
const tidySentences = closeDoubledStops;

export function composeScoreDimensionTable(rec: StrategyRecord): string | null {
  const a = rec.score.assessment;
  if (!a || !a.dimensions.some((d) => d.score !== null)) return null;

  const pctOf = (v: number) => `${Math.round(v * 100)}%`;
  const lines: string[] = ['### How this grade was reached', ''];
  /*
   * The intro describes the method that graded THIS record.
   *
   * It used to state the delivered-points ceiling as the live rule —
   * "it sets a ceiling the grade may not exceed. Unmeasured weight discloses
   * and caps; it never lifts" — on every record, including ones graded after
   * that ceiling was removed (S5/S6 §8). A document explaining a proportional
   * grade by a rule that was not applied to it is telling the reader
   * something false about their own report, and the same sentence on a
   * historical record is telling them the truth. So the reading carries which
   * methodology issued the grade, and the prose follows it.
   *
   * The delivered-points COLUMN goes with it: it is the superseded method's
   * own arithmetic, and on a proportional record the reading returns null for
   * every cell of it, so drawing the column would print a row of dashes
   * labelled as a measurement.
   */
  const legacyCeiling = a.methodology === 'delivered_points_ceiling';
  const unknownMethod = a.methodology === 'unknown';
  /*
   * "Reconstructed" is two different situations, and the table used to call
   * both of them "this record does not hold the adjusted weights".
   *
   * On the 60 Lawley Street Compass the record DID hold them — 50%, 31% and
   * 19% — and they are exactly the original weights renormalised over the
   * three measured dimensions. `readScoreAssessment` then uses the exact
   * fractions (31.25% rather than 31%), because they reproduce the recorded
   * composite and the rounded ones do not. So the page said the weights were
   * missing and reconstructed, and six paragraphs later said "no figure in
   * this table is re-derived" — both about one table. Where the record holds
   * the weights and the reconstruction is merely their exact form, the prose
   * says THAT; only a record that holds none is described as reconstructed.
   */
  const weightsHeld = a.dimensions
    .filter((d) => d.score !== null)
    .every((d) => typeof d.recordedWeight === 'number' && d.recordedWeight > 0);
  const exactFormOfHeld = a.weightBasis !== 'recorded' && weightsHeld;
  lines.push(
    legacyCeiling
      ? 'Five dimensions carry the method. Each has an **original weight**; where a dimension could not be scored '
        + 'its weight is redistributed across the ones that could, giving the **adjusted weight** the composite is '
        + 'built from. This grade was issued under the methodology in force at the time, which read a second '
        + 'figure — the **points delivered** at the ORIGINAL weights — as a ceiling the letter could not exceed. '
        + 'That rule has since been superseded; it is stated here because it is what produced this grade.'
      : unknownMethod
      ? 'Five dimensions carry the method. Each has an **original weight**, and the **adjusted weight** is the '
        + 'share of the composite the dimension actually carried. '
        + (a.weightBasis === 'recorded'
          ? 'The adjusted weights below are the ones the record holds, so they are the weights this grade was '
            + 'built from. '
          : exactFormOfHeld
          ? 'The adjusted weights are the ones the record holds; they are the original weights spread over the '
            + 'dimensions that were measured, and the arithmetic below uses their exact fractions rather than '
            + 'the rounded percentages the record stores. '
          : 'This record does not hold them, so they are reconstructed from the original weights of the '
            + 'dimensions that were measured. ')
        + 'The record does not state which scoring methodology issued its grade, so the grade is reported as it '
        + 'was issued, without a rule being attributed to it.'
      : a.weightBasis === 'recorded'
      ? 'Five dimensions carry the method. Each has an **original weight**; the scoring method re-spreads those '
        + 'weights across the dimensions the evidence could measure — discounted by how much of each '
        + "dimension's own method actually ran — giving the **adjusted weight** the composite is built from. "
        + 'That is why a dimension scored on part of its inputs can carry less than its original weight. The '
        + 'adjusted weights below are the ones the record holds, so they are the weights this grade was '
        + 'actually built from. A dimension that could not be assessed is disclosed rather than deducted: it '
        + 'lowers no score and caps no grade, and the scope of the assessment is stated with the result instead.'
      : exactFormOfHeld
      ? 'Five dimensions carry the method. Each has an **original weight**; where a dimension could not be scored '
        + 'its weight is redistributed across the ones that could, giving the **adjusted weight** the composite is '
        + 'built from. The adjusted weights below are the ones the record holds. They are exactly the original '
        + 'weights spread over the dimensions that were measured, so the arithmetic uses their exact fractions '
        + 'rather than the whole percentages the record stores them as. A dimension that could not be assessed '
        + 'is disclosed rather than deducted: it lowers no score and caps no grade, and the scope of the '
        + 'assessment is stated with the result instead.'
      : 'Five dimensions carry the method. Each has an **original weight**; where a dimension could not be scored '
        + 'its weight is redistributed across the ones that could, giving the **adjusted weight** the composite is '
        + 'built from. This record does not hold the adjusted weights the scoring method used, so they are reconstructed '
        + 'here from the original weights of the dimensions that were measured. A dimension that could not be '
        + 'assessed is disclosed rather than deducted: it lowers no score and caps no grade, and the scope of the '
        + 'assessment is stated with the result instead.',
    '',
    legacyCeiling
      ? '| Dimension | Score | Original weight | Adjusted weight | Contribution | Points delivered |'
      : '| Dimension | Score | Original weight | Adjusted weight | Contribution |',
    legacyCeiling ? '|---|---|---|---|---|---|' : '|---|---|---|---|---|',
  );
  for (const d of a.dimensions) {
    const score = d.score === null ? '—' : `${d.score} / 100`;
    const adjusted = d.score === null ? '— (not scored)' : pctOf(d.adjustedWeight);
    const contribution = d.contribution === null ? '—' : d.contribution.toFixed(2);
    const delivered = d.deliveredPoints === null ? '—' : d.deliveredPoints.toFixed(2);
    lines.push(legacyCeiling
      ? `| ${d.label} | ${score} | ${pctOf(d.nominalWeight)} | ${adjusted} | ${contribution} | ${delivered} |`
      : `| ${d.label} | ${score} | ${pctOf(d.nominalWeight)} | ${adjusted} | ${contribution} |`);
  }
  lines.push('');

  /*
   * The evidence is a LIST, not a seventh column.
   *
   * It was a column, and the growth cell on the first real record is 600
   * characters — five measures the engine joins into one sentence. Six numeric
   * columns beside it leave that cell about two centimetres wide on the
   * printed page, which sets one or two words a line for thirty lines and
   * takes the numbers with it. `NARRATIVE_PACKING.md`'s rule is that a block is
   * charged what it will DRAW; a cell nobody can read is the same defect one
   * level down.
   *
   * An unscored dimension carries its reason AND what would restore it: a
   * reader handed only "not assessed" cannot tell a gap in the record from a
   * finding about the property, and cannot act on either.
   */
  lines.push('**What each dimension rested on.**', '');
  for (const d of a.dimensions) {
    const what = d.score === null
      ? [d.exclusionReason ?? 'Not recorded.', d.exclusionRemedy].filter(Boolean).join(' ')
      : (d.evidence ?? 'Not recorded.');
    lines.push(`- **${d.label}.** ${tidySentences(what)}`);
  }
  lines.push('');

  // The arithmetic, stated as arithmetic, at the precision the engine used.
  const steps: string[] = [];
  if (a.compositeScore !== null) {
    /*
     * The composite is the RECORD'S, and the sentence says so.
     *
     * It used to read "**Composite score N.** The contributions come to X, and
     * the engine rounds once, on that sum" over a number this module had
     * computed itself. On the 97 Poole Road Compass of 20 Sep 2026 that
     * printed 51 on page 38 while the cover, the verdict, the risk page and
     * the assessment table printed 54 — directly above the line "No figure in
     * this table is re-derived by this report; the arithmetic above restates
     * the engine's own."
     *
     * The explanation of the arithmetic is `assessmentPrecisionNote`, which
     * already existed for exactly this and had ZERO production call sites
     * because this function wrote its own copy. One sentence, one place.
     */
    const precision = assessmentPrecisionNote(a);
    steps.push(`**Composite score ${a.compositeScore}.**${precision ? ` ${precision}` : ''}`);
  }
  if (a.uncappedGrade) {
    steps.push(`**Grade the composite alone gives: ${a.uncappedGrade}.**`);
  }
  if (legacyCeiling && a.deliveredPoints !== null && a.nominalCeiling) {
    steps.push(
      `**Points delivered ${a.deliveredPoints.toFixed(2)} of 100**, which under the methodology then in force `
      + `supported a grade no higher than **${a.nominalCeiling}**. That ceiling has since been superseded: an `
      + 'unavailable dimension is now disclosed with the result rather than deducted from it. This record keeps '
      + 'the grade it was issued, explained by the rule that issued it.',
    );
  } else if (a.methodology === 'proportional' && a.dimensionsMeasured < a.totalDimensions) {
    // The scope replaces the ceiling: the same fact, disclosed rather than deducted.
    steps.push(
      `**Assessed on ${a.dimensionsMeasured} of the ${a.totalDimensions} dimensions**, carrying `
      + `${pctOf(a.measuredNominalWeight)} of the method's original weight. The dimensions that could not be `
      + 'assessed are named above with what would restore each one; none of them lowers this result.',
    );
  }
  if (a.issuedGrade) {
    // Why a grade sits below its composite is a claim about the rule that
    // graded it, so it follows the methodology too. Where the record does not
    // state one, the difference is reported and not explained away.
    steps.push(!a.capped
      // Eligibility 5.0.0: the letter is the band of the composite, and where
      // the evidence alone would not carry it the engine's caution says what
      // the evidence is — stated here rather than deducted from the letter.
      ? (a.caution
        ? `**Grade issued: ${a.issuedGrade}**, the grade the composite gives. ${a.caution}`
        : `**Grade issued: ${a.issuedGrade}**, which the composite and the evidence behind it both support.`)
      : a.methodology === 'unknown'
        ? `**Grade issued: ${a.issuedGrade}**, below the ${a.uncappedGrade} the composite alone gives. This `
          + 'record does not state which scoring methodology issued it, so the reason for the difference is not '
          + 'reconstructed here. The grade is reported as it was issued.'
        : `**Grade issued: ${a.issuedGrade}** — held below what the composite alone would allow, because the `
          + 'evidence behind the assessed dimensions does not carry the higher letter. That is an over-claim guard '
          + 'working as designed, not a fault in the property.');
  }
  // Labelled, because an unlabelled bulleted list directly under another one
  // reads as its continuation — and these are a different KIND of statement:
  // the list above is evidence, this one is arithmetic.
  if (steps.length) {
    lines.push('**How the grade follows.**', '');
    for (const step of steps) lines.push(`- ${step}`);
    lines.push('');
  }

  lines.push(
    `**Coverage.** ${a.dimensionsMeasured} of ${a.totalDimensions} dimensions were scored, carrying `
    + `${pctOf(a.measuredNominalWeight)} of the original weight. A dimension that was not scored is not a low `
    + 'score, and each one is given its own reason.',
    '',
  );
  if (a.evidenceCoverage !== null) {
    lines.push(
      `**Evidence coverage ${pctOf(a.evidenceCoverage)}.** This is finer than the figure above: it discounts each `
      + 'scored dimension by how much of its own method actually ran, so a dimension scored on part of its inputs '
      + 'counts as part of a dimension rather than a whole one.',
      '',
    );
  }
  if (a.notRetained.length) {
    lines.push('**What this record does not retain.**', '');
    for (const n of a.notRetained) lines.push(`- ${n}`);
    lines.push('');
  }
  // The closing line may not say "nothing is re-derived" over weights this
  // report reconstructed — the contradiction the 60 Lawley Street table
  // printed. Where the weights are the record's own (whole or exact), it may.
  lines.push(
    'Calculated by the investment scoring method described above'
    + (rec.score.authority ? ` (${rec.score.authority})` : '')
    + (a.weightBasis === 'recorded' || weightsHeld
      ? '. No figure in this table is re-derived by this report; the arithmetic above restates the scoring method\'s own.'
      : '. The scores and the composite are the scoring method\'s own; the adjusted weights are reconstructed as stated '
        + 'above, because this record does not hold them.'),
    '',
  );
  return lines.join('\n').trimEnd();
}


// ─── 2. Investor suitability ────────────────────────────────────────────────

/**
 * Rule 4. Every line is a REQUIREMENT the asset imposes, drawn from a figure.
 * The last paragraph says the match is not assessed, because no report here is
 * given a person's circumstances and a document that implies otherwise is
 * advice nobody is licensed here to give.
 */
export function composeSuitability(rec: StrategyRecord, heading: string): string {
  const f = rec.finance;
  const lines: string[] = [`## ${heading}`, ''];
  lines.push(
    'What follows is what holding this asset **requires**, taken from the figures this report already carries. '
    + 'Whether a particular investor meets those requirements is not assessed here — no personal financial '
    + 'circumstances are supplied to this report, and none is assumed.',
    '',
  );

  const reqs: PositionEntry[] = [];
  if (f) {
    if (isNum(f.upfront)) {
      reqs.push({
        claim: `${money(f.upfront)} of capital at settlement.`,
        basis: 'Deposit plus the recorded acquisition costs — stamp duty, legal and the rest of the upfront schedule '
          + 'in the Financial Analysis Report.',
      });
    }
    if (isNum(f.weeklyNet) && f.weeklyNet < 0) {
      const annual = f.annualNet ?? f.weeklyNet * 52;
      reqs.push({
        claim: `${money(f.weeklyNet)} a week — ${money(annual)} a year — of income from outside the property.`,
        basis: 'The position after operating costs and loan payments at the recorded rate. It is met from salary or '
          + 'other income, every week, whether or not the property is tenanted that week.',
      });
      if (isNum(f.interestRate)) {
        // Sensitivity to the one input that moves fastest, stated as arithmetic.
        const perPointWeekly = isNum(f.loanAmount) ? (f.loanAmount * 0.01) / 52 : null;
        if (perPointWeekly !== null) {
          reqs.push({
            claim: `Room for the rate to move: each one percentage point adds ${money(perPointWeekly)} a week.`,
            basis: `${money(f.loanAmount!)} borrowed at ${pct(f.interestRate, 2)}. One point is `
              + `${money(f.loanAmount! * 0.01)} a year of additional interest while the balance is unchanged. `
              + 'This is arithmetic on the recorded loan, not a rate forecast.',
          });
        }
      }
    }
    if (isNum(f.occupancyWeeks) && isNum(f.weeklyRent)) {
      reqs.push({
        claim: `Tolerance for vacancy: every untenanted week costs ${money(f.weeklyRent)} of income and none of the costs.`,
        basis: `The projection assumes ${f.occupancyWeeks} occupied weeks a year. `
          + (f.occupancyWeeks >= 52
            ? 'That is full occupancy, which is an assumption rather than a measurement — no vacancy figure is '
              + 'published for this market in the sources checked for this report, so none is applied.'
            : `The remaining ${52 - f.occupancyWeeks} weeks are already allowed for.`),
      });
    }
    if (f.interestOnlyAssumed && isNum(f.interestOnlyYears) && f.interestOnlyYears > 0 && isNum(f.loanAmount)) {
      reqs.push({
        claim: `Capacity for the step-up when the interest-only term ends in year ${f.interestOnlyYears}.`,
        basis: 'The payment moves from interest alone to principal and interest over the remaining years. The term '
          + 'itself was assumed rather than recorded — the loan offer settles it.',
      });
    }
  }

  const g10 = subjectRow(rec.market, 'growth10YearCagr');
  const g5 = subjectRow(rec.market, 'growth5YearCagr');
  const g3 = subjectRow(rec.market, 'growth3YearCagr');
  const longest = g10 ?? g5 ?? g3;
  if (longest) {
    const years = longest === g10 ? 10 : longest === g5 ? 5 : 3;
    /*
     * An evidence window is a RISK AND MONITORING consideration, never a hold
     * requirement. The first version wrote "A horizon at least as long as the
     * evidence: 5 years", which turns the length of a published series into an
     * instruction to a person — and no report here holds the circumstances
     * that could support one.
     */
    reqs.push({
      claim: `Awareness that the growth evidence covers ${years} years, and no longer.`,
      basis: `${citeRow(longest)}. The rate is an average across that window and includes the periods inside it `
        + 'that went the other way, so a shorter holding period is exposed to one of those periods rather than to '
        + 'the average. That is a risk and monitoring consideration about the EVIDENCE. This report does not '
        + 'establish how long anybody should hold the asset, and nothing here should be read as saying so.',
    });
  }
  /*
   * A sales count is NOT a measure of liquidity, buyer depth or time to sell,
   * so it raises no requirement. It is stated as a count in the exit section
   * and nowhere converted into a tolerance an owner must have.
   */

  if (reqs.length) {
    lines.push('### What holding this asset requires', '');
    lines.push(...writeEntries(reqs));
    lines.push('');
  } else {
    lines.push(
      '*No figure in this analysis states what holding this asset requires, and none is inferred in its place.*',
      '',
    );
  }

  if (!f) {
    lines.push(
      '### What is not here', '',
      '- The capital, weekly contribution and rate sensitivity above are the subject of the **Financial Analysis '
      + 'Report** and are deliberately not restated in this document.',
      '',
    );
  }

  lines.push(
    '### The limits of this profile', '',
    '- This is a description of the asset, not a recommendation about a person. No income, tax position, existing '
    + 'portfolio, borrowing capacity, dependants, health or time horizon has been supplied to this report, and none '
    + 'is assumed.',
    '- Nothing above is personal advice, a credit assessment or a tax opinion. Those belong to a licensed adviser '
    + 'who has your circumstances in front of them.',
    '',
  );
  return lines.join('\n').trimEnd();
}

// ─── 3. Holding strategy ────────────────────────────────────────────────────

/**
 * What to DO across the hold, as against `suitability`'s what it DEMANDS.
 * Every item is an action with a date or a trigger the record can name.
 */
export function composeHoldingStrategy(rec: StrategyRecord, heading: string): string {
  const f = rec.finance;
  const lines: string[] = [`## ${heading}`, ''];
  lines.push(
    'The base case this report models, what has to stay true for it to hold, and the points at which a decision is '
    + 'actually owed. Each item names the figure or reading behind it.',
    '',
  );

  const holds: PositionEntry[] = [];
  const g1 = subjectRow(rec.market, 'growth1Year');
  const g10 = subjectRow(rec.market, 'growth10YearCagr');
  const g5 = subjectRow(rec.market, 'growth5YearCagr');
  const g3 = subjectRow(rec.market, 'growth3YearCagr');
  const longest = g10 ?? g5 ?? g3;

  if (f && isNum(f.capitalGrowth)) {
    holds.push({
      claim: `The base case grows value at the accepted CGR assumption of ${pct(f.capitalGrowth, 1)} a year.`,
      basis: 'Set as an assumption for this analysis before the report was prepared, and carried '
        + 'unchanged into the loan, the cash flow and the ten-year projection. It is a modelling input, not a '
        + 'forecast, and not a measurement of this market'
        + (longest?.value
          ? `. For comparison, historical market growth observed in the approved register is ${longest.value} a `
            + `year — ${citeRow(longest)}; that is a separate fact from a separate source.`
          : '.'),
    });
  } else if (longest?.value) {
    holds.push({
      claim: `Historical market growth observed in the approved register is ${longest.value} a year.`,
      basis: `${citeRow(longest)}. This is a measurement of what this market DID over that window. The accepted CGR `
        + 'assumption the financial model runs on is a separate input, set for this analysis, and is the Financial Analysis '
        + 'Report\'s subject; the two are never the same statement.',
    });
  }
  // The growth ladder, stated and not graded. Both figures, no verdict.
  if (g1?.value && (g3?.value || g5?.value)) {
    const longer = g3 ?? g5!;
    const years = longer === g3 ? 'three' : 'five';
    holds.push({
      claim: `The latest year and the ${years}-year average are ${g1.value} and ${longer.value}.`,
      basis: `Both from ${g1.publisher} for the same geography and dwelling split. They are stated side by side and `
        + 'not graded: no publisher sets the point at which a gap between them becomes a change of direction, and one '
        + 'period is one period either way.',
    });
  }
  if (f && isNum(f.weeklyNet) && f.weeklyNet < 0 && isNum(f.weeklyRent)) {
    // The break-even rent, stated as arithmetic on figures the record holds.
    const shortfall = Math.abs(f.weeklyNet);
    const breakEven = f.weeklyRent + shortfall;
    holds.push({
      claim: `The position turns cash-flow neutral at ${money(breakEven)} a week of rent, all else unchanged.`,
      basis: (() => {
        const rise = pct((shortfall / f.weeklyRent!) * 100, 0);
        return `${money(f.weeklyRent!)} is recorded now and the position is ${money(shortfall)} a week short, so that `
          + `is ${article(rise)} ${rise} rise in rent with costs and the rate held still. It is the point at which `
          + 'the property stops asking for a contribution, not a prediction that it reaches it.';
      })(),
    });
  }
  if (f && f.interestOnlyAssumed && isNum(f.interestOnlyYears) && f.interestOnlyYears > 0) {
    holds.push({
      claim: `Year ${f.interestOnlyYears} is a decision, not a milestone: the interest-only term ends.`,
      basis: 'Refinance, extend, or let it convert to principal and interest — each changes the weekly position. '
        + 'The term used here was assumed rather than recorded, so the first thing to confirm is the date on the '
        + 'loan offer itself.',
    });
  }
  if (f && isNum(f.lvr) && f.lvr >= 80) {
    holds.push({
      claim: `Lenders mortgage insurance and the ${pct(f.lvr, 0)} lending ratio are a refinance constraint, not just a settlement one.`,
      basis: 'Until value growth or principal repayment takes the ratio below the lender\'s threshold, refinancing '
        + 'and releasing equity are limited by it. The ratio moves with both value and balance.',
    });
  }
  if (rec.planning.zoneStatus === 'stated' && rec.planning.zone) {
    holds.push({
      claim: `The zone in force is ${rec.planning.zone}, and it can change.`,
      basis: `${rec.planning.zoneSource ?? 'the planning layer'}`
        + (rec.planning.zoneEffectiveDate ? `, current at ${dayOf(rec.planning.zoneEffectiveDate)}` : '')
        + '. A zone admits uses; it is not approval for any of them, and a planning proposal in this locality could '
        + 'change the zone without anything happening on this lot.',
    });
  }

  if (holds.length) {
    lines.push('### The base case and what holds it', '');
    lines.push(...writeEntries(holds));
    lines.push('');
  }

  const breaks: string[] = [];
  if (f && isNum(f.weeklyNet) && f.weeklyNet < 0) {
    breaks.push('The weekly contribution stops being met from income outside the property. This is the one that '
      + 'forces a sale at a time not of the owner\'s choosing, and it is the first thing a buffer is for.');
  }
  if (f && isNum(f.interestRate) && isNum(f.loanAmount)) {
    breaks.push(`The rate moves materially from ${pct(f.interestRate, 2)}. Each percentage point is `
      + `${money(f.loanAmount * 0.01)} a year on the recorded balance.`);
  }
  if (longest) {
    breaks.push(`Historical market growth observed in the approved register stops resembling ${longest.value} a `
      + `year. ${longest.publisher} publishes that series again each period, and the section below says when to `
      + 'check it. This is the market measurement, not the accepted CGR assumption — the assumption changes only '
      + 'when a new one is set for the analysis.');
  }
  if (breaks.length) {
    lines.push('### What would break it', '');
    for (const b of breaks) lines.push(`- ${b}`);
    lines.push('');
  }

  if (!f) {
    lines.push(
      '*The loan structure, the weekly position and the equity path are the subject of the Financial Analysis '
      + 'Report and are not restated here.*',
      '',
    );
  }
  return lines.join('\n').trimEnd();
}

// ─── 4. Resale liquidity and exit ───────────────────────────────────────────

/**
 * Rule 5. `liquidity` is measured and travels everywhere; `equity` is modelled
 * and travels only with `finance`.
 */
export function composeExitOutlook(rec: StrategyRecord, heading: string): string {
  const f = rec.finance;
  const lines: string[] = [`## ${heading}`, ''];
  /*
   * The introduction describes what THIS section goes on to draw.
   *
   * It promised "what the position looks like at a future year … this
   * report's own projection under the accepted CGR assumption" on every tier —
   * including the Compass, which carries no modelling at all and draws no
   * projection below (see the closing comment). On the 60 Lawley Street
   * Compass a reader was told about a model the document does not contain,
   * and that the projection lives in the Financial Analysis Report is a
   * boundary the Compass has to keep, not describe away.
   */
  const projects = Boolean(f && isNum(f.capitalGrowth) && rec.price.value !== null);
  lines.push(
    projects
      ? 'Two different questions, answered from two different kinds of evidence. **What the market recorded** comes '
        + 'from published sales records. **What the position looks like at a future year** is an output of this '
        + 'report\'s own projection under the accepted CGR assumption. The first is a count of what happened; the '
        + 'second is a model.'
      : '**What the market recorded** comes from published sales records: it is a record of what happened in this '
        + 'market, not a forecast of what a sale of this property would achieve.',
    '',
    /*
     * "Not measured anywhere in this report" was false the day a Market
     * Positioning chapter quoted a listing portal's days on market — the 60
     * Lawley Street Compass did, two pages earlier. What is true is narrower,
     * and it is what the reader needs: no register this assessment reads holds
     * such a measure, and a portal's own figure is not one.
     */
    'Neither answers *how easily this sells*. None of the sources checked for this report holds days on market, time '
    + 'to sell or buyer depth for this market. A figure a listing portal reports, where the report quotes one, is that '
    + 'portal\'s own statistic, not a measurement from those sources, and no figure below should be read as standing '
    + 'in for any of them.',
    '',
  );

  const liquidity: PositionEntry[] = [];
  const volume = subjectRow(rec.market, 'salesCount');
  const median = subjectRow(rec.market, 'medianPrice');
  const series = subjectRow(rec.market, 'priceSeries');
  if (volume?.value) {
    /*
     * The count, and only the count.
     *
     * The first version called it "the depth of the buyer pool an exit would
     * be tested against" — which is a liquidity claim, and a settled-sales
     * count is not one. It says how many transactions COMPLETED in a published
     * period; it says nothing about how many buyers were competing, how long
     * any sale took to agree, or how long one would take now.
     */
    liquidity.push({
      claim: `${volume.value} dwellings settled in the latest published quarter.`,
      basis: 'A count of completed transactions at the geography and dwelling split named — not at this street, and '
        + 'not a measure of liquidity. **Days on market, time to sell and buyer depth are not held for this market:** '
        + 'the sources checked for this report do not publish them, and nothing here estimates them.',
    });
  }
  if (median?.value) {
    liquidity.push({
      claim: `The market's middle price is ${median.value}.`,
      // "A dwelling priced far from the middle is sold to a narrower pool"
      // inferred a buyer pool from a median and a count. Nothing in this
      // record measures one, which is the liquidity claim this section
      // already says it cannot make.
      basis: 'Half of what sold went for less and half for more, across the whole geography and dwelling split named. '
        + 'How many buyers are active at any particular price is not published at this geography.',
    });
  }
  if (series?.value) {
    // "4 periods, 2021-03 to 2026-03" — the count, then the span, each said once.
    const [count, ...span] = periodsIn(series.value).split(',');
    liquidity.push({
      claim: `Published price history for this market covers ${count.trim()}${span.length ? ` (${span.join(',').trim()})` : ''}.`,
      basis: 'A long series is what makes a growth rate a measurement rather than an impression.',
    });
  }
  if (liquidity.length) {
    lines.push('### What the market recorded', '');
    lines.push(...writeEntries(liquidity));
    lines.push('');
    // The series itself, where the record holds it and may publish it — drawn
    // before the source line, so the one citation covers the drawing too.
    const history = priceHistoryChart(series);
    if (history) lines.push(history, '');
    // The source, once. Each bullet used to carry the full citation — the same
    // forty words three times in three bullets on the 23 Sep 2026 Compass.
    const sourced = [volume, median, series].filter((r): r is MarketFactRow => Boolean(r?.value));
    const cites = [...new Set(sourced.map(citeRow))];
    if (cites.length) {
      lines.push(`*Source: ${cites.join('; ')}.*`, '');
    }
    if (rec.property.landSqm) {
      lines.push(
        `*This property's land is ${rec.property.landSqm} m² — a fact about this lot, not part of the published `
        + 'figures above. Land size is one of the attributes a median cannot see, and it is among the first '
        + 'things a comparison against one has to account for.*',
        '',
      );
    }
  } else {
    lines.push(
      '### What the market recorded', '',
      '*No sales count, median or series was published for this market. Nothing is estimated in their place, and '
      + 'their absence is not evidence that the market is thin, deep, slow or fast.*',
      '',
    );
  }

  if (f && isNum(f.capitalGrowth) && rec.price.value !== null) {
    const p = rec.price.value;
    const rate = f.capitalGrowth / 100;
    const at = (y: number) => p * Math.pow(1 + rate, y);
    lines.push('### The modelled position — projection, not measurement', '');
    lines.push(
      `Value compounds from ${money(p)} at the **accepted CGR assumption** of ${pct(f.capitalGrowth, 1)} a year — `
      + 'the rate recorded on this report\'s assumptions, not a market measurement. Selling costs are not deducted; '
      + 'agent commission, marketing and legal costs all fall between these figures and a net result.',
      '',
      '| Year | Modelled value | Growth since settlement |',
      '|---|---|---|',
      `| 5 | ${money(at(5))} | ${money(at(5) - p)} |`,
      `| 10 | ${money(at(10))} | ${money(at(10) - p)} |`,
      '',
    );
    if (isNum(f.loanAmount)) {
      lines.push(
        `The loan balance at those years depends on the structure — ${f.loanStructure ?? 'as recorded'} — and the `
        + 'year-by-year balance is in the Financial Analysis Report\'s own ledger rather than recomputed here.',
        '',
      );
    }
    lines.push(
      '*Every figure in this table is a projection. It states what the recorded rate produces if it repeats, which '
      + 'no market is obliged to do, and it is not a valuation, an appraisal or a forecast.*',
      '',
    );
  }
  // Where the tier carries no modelling there is no modelled position here at
  // all — not a heading over a sentence saying it is elsewhere. The document's
  // own companion note already names where the ten-year projection is.
  return lines.join('\n').trimEnd();
}

// ─── 5. Monitoring and review ───────────────────────────────────────────────

/** One thing to re-check: the register, what it publishes, when, and what would change. */
export interface MonitorRow {
  what: string;
  register: string;
  cadence: string;
  lastRead: string;
  changesIf: string;
  /**
   * True where no register answered this for the report, so the item is a
   * FIRST check still owed rather than a reading to watch. Printed apart from
   * the readings, because "monitor" a control nobody has read yet is not a
   * plan — it is research that has not been done.
   */
  firstCheck?: boolean;
}

/**
 * Rule 6. Built from the registers this report actually read — nothing is
 * listed that the platform does not consult, and nothing here says the
 * platform will consult it on the reader's behalf.
 */
export function buildMonitorRows(rec: StrategyRecord): MonitorRow[] {
  const rows: MonitorRow[] = [];
  const median = subjectRow(rec.market, 'medianPrice');
  const g1 = subjectRow(rec.market, 'growth1Year');
  if (median) {
    rows.push({
      what: 'The market\'s median sale price and its growth',
      register: median.publisher,
      cadence: 'Quarterly, on the publisher\'s own schedule',
      lastRead: periodsIn(`${median.value ?? '—'} — ${median.describes}`),
      // "Two consecutive quarters" and "four quarters" were thresholds
      // invented in this file. Rule 7 forbids exactly that.
      changesIf: 'A median that moves away from the recorded trend is the first place a change in this market shows '
        + 'up. How far, and for how long, before it matters is a judgement for the reader and their adviser — this '
        + 'report sets no threshold, because none is published.',
    });
  }
  if (g1 && g1 !== median) {
    rows.push({
      what: 'The one-year growth rate',
      register: g1.publisher,
      cadence: 'Quarterly, from the same series',
      lastRead: g1.value ?? '—',
      changesIf: 'The shortest window the publisher reports, and therefore the one most affected by how few or how '
        + 'many dwellings happened to sell. It moves before the longer-run rates do, and it also moves when nothing '
        + 'has changed.',
    });
  }
  if (rec.planning.zoneStatus === 'stated') {
    rows.push({
      what: 'The planning control in force',
      register: rec.planning.zoneSource ?? 'the jurisdiction planning layer',
      cadence: 'On gazettal — no schedule; the layer carries its own currency date',
      lastRead: rec.planning.zoneEffectiveDate
        ? `current at ${dayOf(rec.planning.zoneEffectiveDate)}`
        : (rec.planning.retrievedAt ? `checked ${dayOf(rec.planning.retrievedAt)}` : 'checked for this report'),
      changesIf: 'A planning proposal, a new overlay or an amended instrument changes what may be built here and '
        + 'nearby. A spatial layer is indicative — a planning certificate from the council is what settles it.',
    });
  } else {
    /*
     * "On request" was printed as how often a planning control CHANGES — it
     * is how a certificate is obtained, which is a different question. The
     * control changes when the scheme is amended; what the reader needs is
     * when to look, which is before exchange and then on the events that make
     * a control matter.
     */
    rows.push({
      what: 'The planning controls that apply to the lot',
      register: rec.planning.council
        ? `${rec.planning.council} — planning certificate or property enquiry`
        : 'the council — planning certificate or property enquiry',
      cadence: 'When the council amends its planning scheme; a certificate states the controls as at the day it is '
        + 'issued',
      lastRead: 'Not confirmed in this report',
      changesIf: 'This is a first check, not a re-check: the controls have not been confirmed in this report, and a '
        + 'planning certificate or property enquiry obtained before exchange is the way to establish them. After '
        + 'that, look again before any works, a refinance or a sale, and when the council gives notice of a scheme '
        + 'amendment affecting the area.',
      firstCheck: true,
    });
  }
  if (rec.transport.verdict === 'stops_nearby' && rec.transport.countReading?.count !== null) {
    rows.push({
      what: 'Boarding places near the property',
      register: rec.transport.sources.length
        ? rec.transport.sources.join('; ')
        : 'The operator\'s published stop data',
      cadence: 'When the operator publishes updated stop data',
      lastRead: rec.transport.countReading
        ? transportCountPhrase(rec.transport.countReading)
          + (rec.transport.feedLoadedAt ? `, operator data current at ${dayOf(rec.transport.feedLoadedAt)}` : '')
        : '—',
      changesIf: 'A count changes when the network changes. Mode, service frequency, walking distance and travel '
        + 'time are not measured at all here, so a change in any of them would not show in this reading.',
    });
  }
  if (rec.finance && isNum(rec.finance.interestRate)) {
    rows.push({
      what: 'The interest rate on the loan',
      register: 'The lender\'s own schedule, and the RBA cash rate behind it',
      cadence: 'Monthly for the cash rate; on notice from the lender',
      lastRead: pct(rec.finance.interestRate, 2),
      changesIf: isNum(rec.finance.loanAmount)
        ? `Each percentage point is ${money(rec.finance.loanAmount * 0.01)} a year on the recorded balance.`
        : 'It moves the weekly position directly.',
    });
  }
  if (rec.finance && isNum(rec.finance.weeklyRent)) {
    rows.push({
      what: 'The rent actually achieved',
      register: 'The managing agent\'s statement',
      cadence: 'At each lease renewal, and monthly in the statement',
      lastRead: `${money(rec.finance.weeklyRent)} a week, recorded for this analysis`,
      changesIf: 'The gap between the recorded rent and the rent achieved is the single largest source of '
        + 'divergence between this report and the position an owner is actually in.',
    });
  }
  return rows;
}

export function composeMonitoringPlan(rec: StrategyRecord, heading: string): string {
  const rows = buildMonitorRows(rec);
  const lines: string[] = [`## ${heading}`, ''];
  lines.push(
    'A report is a reading taken on a day. Each item below is a thing that reading depends on, where it is published, '
    + 'how often it changes, and what a different answer would mean. **These are not monitored on your behalf** — '
    + 'each is a check to make, or to ask an adviser to make.',
    '',
  );
  if (!rows.length) {
    lines.push('*None of the sources this report relies on could be checked for this property, so there is nothing '
      + 'here to re-check.*');
    return lines.join('\n').trimEnd();
  }
  /*
   * One block per dependency, not a five-column table.
   *
   * This was a table, and page 36 of the 9 Hollow Street Compass is what a
   * five-column table does to a fifth column that is a paragraph. Measured on
   * that page: the four scannable cells run 16 to 65 characters and
   * `changesIf` runs to 190 — three times the other four together — so in a
   * fifth of a 510pt measure the header set as
   *
   *     What to re-Where it isHow often itAs read for this
   *     What a different answer would mean
   *     checkpublishedchangesreport
   *
   * with the body cells interleaved the same way. A reader cannot tell which
   * words belong to which column, which is the whole of what a table is for.
   *
   * `foldConstantTableColumns` already holds the neighbouring rule for the
   * nine-column infrastructure register — a column that says the same thing on
   * every row is a footnote. This is the other shape: a column that says
   * something different and long on every row is not a column at all, it is
   * the explanation the row exists to give. Nothing is dropped — every cell is
   * printed, in the same order, with the label leading and the prose given the
   * full measure.
   *
   * The two facts a reader scans for stay on one line together, because
   * "where it is published" and "how often it changes" are what turns the list
   * into something actionable.
   */
  const block = (r: MonitorRow) => {
    const read = r.lastRead && r.lastRead !== '—'
      ? ` As read for this report: ${r.lastRead}.`
      : '';
    lines.push(
      `**${r.what}**`,
      '',
      `Where it is published: ${r.register}. How often it changes: ${r.cadence}.${read}`,
      '',
      r.changesIf,
      '',
    );
  };
  /*
   * First checks and readings are two lists.
   *
   * On the 60 Lawley Street Compass the planning control — which no register
   * had answered — sat in the same list as the one-year growth rate, under an
   * introduction about re-reading figures the report already holds. A control
   * nobody has read is research still owed before exchange; it is printed
   * first and under its own name, so it cannot be mistaken for something the
   * report already knows and merely asks the reader to watch.
   */
  const firstChecks = rows.filter((r) => r.firstCheck);
  const readings = rows.filter((r) => !r.firstCheck);
  if (firstChecks.length) {
    lines.push('### First checks still owed', '');
    lines.push(
      'These were not confirmed for this report. Each is research to complete before exchange, not a reading to '
      + 'monitor.',
      '',
    );
    firstChecks.forEach(block);
  }
  if (readings.length) {
    if (firstChecks.length) lines.push('### What to re-read after purchase', '');
    readings.forEach(block);
  }
  /*
   * "Follow the slowest thing on the list" was a cadence rule invented here.
   * The publishers' schedules are facts and are in the table; what to do with
   * them is the reader's decision.
   */
  lines.push(
    'Each item states how often its publisher republishes. Re-reading anything more often than its publisher issues '
    + 'it returns the same figure. The events that make a re-read worth doing are the ones a holder already '
    + 'faces — a lease renewal, a change in the loan rate, planned works, a refinance or a sale — and each is a '
    + 'prompt to check the items above rather than a schedule this report keeps. How far behind a publication '
    + 'cycle a review may otherwise fall is a decision for the reader and their adviser.',
    '',
  );
  return lines.join('\n').trimEnd();
}

// ─── The rules the prose beside these sections must obey ────────────────────

/**
 * The rules named FIVE sections, and a Compass composes three.
 *
 * The head of this block used to read "they apply to the SWOT, the suitability
 * profile, the holding strategy, the exit outlook and the monitoring plan",
 * and rule 1 told the model all five were "COMPOSED from the record and
 * supplied to you complete". The Compass's call site composes
 * `exitStrategy`, `swot` and `monitoring` — `suitability` and
 * `holdingStrategy` are `financial:required` in `sectionRegistry.pure.ts` and
 * are declared for no other tier.
 *
 * So a model writing a Compass was told two sections exist, was shown
 * neither, and filled the gap — which is the defect §6 of
 * `DA_REGISTER_RECONCILIATION.md` already records in the other direction:
 * a rule can reach the model and its evidence not, and the model then supplies
 * the evidence. Measured on the 97 Poole Road Compass of 20 Sep 2026: it wrote
 * `Suitability Profile` and `Holding Strategy` as sections of its own on pages
 * 19-20, and `Exit Outlook` and `Monitoring Plan` beside them — the last two
 * fourteen and eighteen pages before the composed sections carrying the same
 * subjects, and contradicting them. The composed Resale Liquidity opens
 * "Neither answers how easily this sells … no figure below should be read as
 * standing in for them"; the model's Exit Outlook says "the cleanest exit path
 * is to sell into the owner-occupier market".
 *
 * The composed set is now a PARAMETER, named by its real headings, so the
 * rules and the composer cannot state two different documents. A caller that
 * passes none gets the general rules and no claim about what is supplied,
 * which is the honest reading of "this document composes nothing".
 */
export function strategySectionRules(
  rec: StrategyRecord,
  composed: ReadonlyArray<{ id: StrategySection['id']; heading: string }> = [],
): string {
  const headings = composed.map((c) => `"${c.heading}"`);
  const supplied = headings.length === 1
    ? `the section ${headings[0]}`
    : `the sections ${headings.slice(0, -1).join(', ')} and ${headings[headings.length - 1]}`;
  const head = headings.length
    ? `STRATEGY SECTION RULES — they apply to ${supplied}, and they override any example elsewhere `
      + 'in this prompt.'
    : 'STRATEGY SECTION RULES — they override any example elsewhere in this prompt.';
  const lines = [
    head,
    headings.length
      ? `1. Those ${headings.length === 1 ? 'section is' : `${headings.length} sections are`} COMPOSED from the `
        + 'record and appear in the finished document under exactly those headings. Do not write them, do not '
        + 'write a section of your own on any of those subjects under any other name, and do not restate their '
        + 'entries in prose elsewhere or add an entry of your own to any quadrant or table. EVERY OTHER section '
        + 'of this report is one you write: there is no other composed section, so do not leave a gap for one.'
      : '1. Do not restate a composed entry in prose elsewhere, and do not add an entry of your own to any '
        + 'quadrant or table.',
    '2. Every entry names the fact it rests on. If you refer to one of them in another section, carry that fact and '
    + 'its publisher with it.',
    '3. An absence is never a strength, a weakness, an opportunity or a threat. A source this report does not cover, '
    + 'and a measure nobody published, are listed under "What this rests on" and must not be turned into a finding, a '
    + 'rating or a reassurance anywhere in the report.',
    // Rule 4 used to open "The suitability profile describes what the ASSET
    // requires", on a document that has no suitability profile — which is the
    // gap this function's header records. The prohibition is general and
    // stays; the sentence that names the section is written only where the
    // section is one of the composed ones.
    (composed.some((c) => c.id === 'suitability')
      ? '4. The suitability profile describes what the ASSET requires, and no section may convert it into a '
        + 'statement about a person'
      : '4. Nothing in this report is a statement about a person')
    + ' — no "this suits you", no "ideal for first-time investors", no personal '
    + 'advice, credit assessment or tax opinion.',
    '5. A modelled figure is never written as a measured one. The year-five and year-ten values are the projection\'s '
    + 'output under a recorded growth rate; say so wherever you use them, and never call one a valuation, an '
    + 'appraisal or a forecast.',
  ];
  if (!rec.finance) {
    lines.push(
      '6. This document does not carry the analysis of a purchase. Do NOT state a yield, a weekly or annual cash '
      + 'position, a loan amount, a lending ratio, a repayment or an equity figure in any section — they belong to '
      + 'the Financial Analysis Report, and the sections above deliberately omit them.',
    );
  }
  return lines.join('\n');
}

// ─── Reading a stored report row ────────────────────────────────────────────

/**
 * One reader, two callers.
 *
 * `generate-investment-report` composes the evidence half for the Compass from
 * the enrichment it is holding; `fork-investment-report` composes the
 * modelling half for the Financial report from the stored parent row. Both
 * need the same shapes out of the same JSONB, and a second copy of this
 * mapping is how the two documents come to disagree about what the record
 * says — the defect `_shared/reports/investment/loanLedger.pure.ts` records for
 * the loan and `captureObjectsFor` records for the capture plan.
 *
 * Every field is read defensively: a report row predating any of these columns
 * answers `null`, which every composer already handles.
 */
export interface StrategyRowInput {
  /** `investment_reports.property_address`. */
  propertyAddress?: unknown;
  /** `investment_reports.property_specs`. */
  propertySpecs?: unknown;
  /** `investment_reports.financial_calculations`. */
  financialCalculations?: unknown;
  /** `investment_reports.investment_score`. */
  investmentScore?: unknown;
  /** `investment_reports.data_sources` — for the planning reading. */
  dataSources?: unknown;
  /** `investment_reports.location_intelligence` — for the transport reading. */
  locationIntelligence?: unknown;
}

export interface StrategyRowOptions {
  /** The market evidence table this tier may state. */
  market: MarketFacts;
  /** The one recorded price, already named by its rung. */
  price: SubjectPrice;
  /**
   * False on a tier that does not carry the analysis of a purchase, which
   * makes `finance` null and every modelled entry simply not produced.
   */
  carriesModelling: boolean;
  /**
   * `transportCountReading(location_intelligence.transport)`, read by the
   * caller because a canonical investment module may not import `_shared/`.
   * Null where the caller has none, and then no transport entry is produced —
   * an absence, never a count read off the deprecated field.
   */
  transport?: StrategyTransportCount | null;
  /**
   * `location_intelligence.__acquisition.acquiredAt` — when the readings on
   * this row were taken, read by the caller for the same reason `transport`
   * is: a canonical investment module may not import `_shared/`, and
   * `ENRICHMENT_STAMP` is the location domain's own storage key.
   *
   * Null where the caller has none, and then the transport sentence says the
   * date is not recorded rather than implying the feed-load date is it. A
   * caller that forgets it degrades to exactly the wording that shipped
   * before this option existed.
   */
  measuredAt?: string | null;
  /**
   * The land use table's standing and the development pipeline, read by the
   * caller from the stored planning and infrastructure evidence — for the
   * same reason `transport` is. Only the Due Diligence document's strategic
   * read uses it; absent, nothing changes.
   */
  site?: StrategySite | null;
}

const rec = (v: unknown): Record<string, unknown> | null =>
  (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null);
const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
const text = (v: unknown): string | null =>
  (typeof v === 'string' && v.trim() ? v.trim() : null);
const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map((x) => text(x)).filter((x): x is string => x !== null) : []);

/** The engine's dimension keys, in the order a reader should meet them. */
const SCORE_DIMENSIONS: ReadonlyArray<{ field: string; key: string; label: string }> = [
  { field: 'growthScore', key: 'growth', label: 'Capital growth' },
  { field: 'yieldScore', key: 'yield', label: 'Rental yield' },
  { field: 'demandScore', key: 'demand', label: 'Demand' },
  { field: 'riskScore', key: 'risk', label: 'Property risk' },
  { field: 'locationScore', key: 'location', label: 'Location' },
];

function readScoreDimensions(breakdown: unknown): ScoreDimensionReading[] {
  const b = rec(breakdown);
  if (!b) return [];
  const out: ScoreDimensionReading[] = [];
  for (const { field, key, label } of SCORE_DIMENSIONS) {
    const d = rec(b[field]);
    if (!d) continue;
    const excluded = d.excluded === true || d.hasData === false;
    const score = excluded ? null : num(d.score);
    const nominalPoints = num(d.weight) ?? 0;
    out.push({
      key,
      label,
      score,
      nominalPoints,
      deliveredPoints: score === null ? null : (score / 100) * nominalPoints,
      evidence: text(d.details),
      inputs: strings(d.dataPoints),
      excluded,
    });
  }
  return out;
}

function readNotAssessed(value: unknown): Record<string, string> {
  const n = rec(value);
  if (!n) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(n)) {
    const t = text(v);
    if (t) out[k] = t;
  }
  return out;
}

export function readStrategyRecord(row: StrategyRowInput, opts: StrategyRowOptions): StrategyRecord {
  const specs = rec(row.propertySpecs) ?? {};
  const fin = rec(row.financialCalculations) ?? {};
  const metrics = rec(fin.keyMetrics) ?? {};
  const income = rec(fin.income) ?? {};
  const costs = rec(fin.annualCosts) ?? {};
  const loan = rec(fin.loanDetails) ?? {};
  const assumptions = rec(fin.assumptions) ?? {};
  const score = rec(row.investmentScore) ?? {};
  const planning = rec(rec(row.dataSources)?.planning) ?? {};
  const transport = rec(rec(row.locationIntelligence)?.transport) ?? {};

  const finance: StrategyFinance | null = opts.carriesModelling
    ? {
      grossYield: num(metrics.grossRentalYield),
      netYield: num(metrics.netRentalYield),
      weeklyNet: num(metrics.weeklyNet),
      annualNet: num(metrics.annualNet),
      lvr: num(metrics.lvr),
      upfront: num(metrics.totalInvestment),
      annualCosts: num(costs.totalAnnual),
      loanAmount: num(loan.loanAmount),
      interestRate: num(loan.interestRate),
      loanStructure: text(loan.structure),
      interestOnlyYears: num(loan.interestOnlyPeriod),
      // An ASSUMED term is a different statement from a recorded one, and the
      // ledger already publishes which it was. Never inferred from the number.
      interestOnlyAssumed: loan.interestOnlyPeriodAssumed === true,
      capitalGrowth: num(assumptions.capitalGrowth),
      weeklyRent: num(income.weeklyRent),
      occupancyWeeks: num(metrics.occupancyWeeks) ?? num(income.occupancyWeeks),
    }
    : null;

  return {
    property: {
      address: text(row.propertyAddress) ?? '',
      propertyType: text(specs.property_type),
      landSqm: num(specs.land_size_sqm),
      councilArea: text(specs.council_area),
      parking: num(specs.parking),
      bedrooms: num(specs.bedrooms),
      bathrooms: num(specs.bathrooms),
      yearBuilt: num(specs.year_built),
    },
    price: opts.price,
    market: opts.market,
    finance,
    planning: {
      zone: text(planning.zone),
      zoneStatus: text(planning.zoneStatus),
      zoneSource: text(planning.zoneSource),
      zoneEffectiveDate: text(planning.zoneEffectiveDate),
      council: text(planning.council),
      verification: text(planning.verification),
      retrievedAt: text(planning.timestamp),
    },
    transport: {
      source: text(transport.source),
      verdict: text(transport.verdict),
      // Never `stopsWithin1km`. The caller reads `transportCountReading`,
      // which prefers `stopsWithinRadius` and hands back a radius and a label
      // that are true of the value.
      countReading: opts.transport ?? null,
      nearestKm: num(transport.distanceToStation),
      nearestName: text(transport.nearestStation),
      sources: strings(transport.sources),
      feedLoadedAt: text(transport.feedLoadedAt),
      // The enrichment's own stamp — when the readings on this row were taken.
      // Handed in by the caller; see `StrategyRowOptions.measuredAt`.
      measuredAt: text(opts.measuredAt),
      notMeasured: strings(transport.notMeasured),
    },
    score: {
      grade: text(score.grade),
      total: num(score.totalScore),
      gaps: strings(score.gradeGaps).length
        ? strings(score.gradeGaps)
        : (Array.isArray(score.gradeGaps)
          ? (score.gradeGaps as unknown[]).flatMap((g) => {
            const o = rec(g);
            const reason = o ? (text(o.reason) ?? text(o.remedy) ?? text(o.dimension)) : null;
            return reason ? [reason] : [];
          })
          : []),
      dimensions: readScoreDimensions(score.breakdown),
      coverageLabel: text(rec(score.coverage)?.partialLabel),
      weightCovered: num(rec(score.coverage)?.weightCovered),
      notAssessed: readNotAssessed(score.notAssessed),
      authority: text(rec(score.v2)?.authority),
      risks: recordedMarketRisks(row.investmentScore),
      // S5-1 item 1 — derived HERE, from the score this function already
      // holds, rather than taken as a parameter. A parameter is one a caller
      // can forget, and a forgotten one takes the whole grade-rationale table
      // off the page with nothing reporting it — the class of defect
      // `builderPortalUiMounted.spec.ts` exists for. `readScoreAssessment` is
      // total: an absent or malformed score yields a reading with no scored
      // dimension, and the composer draws no table for that.
      assessment: readScoreAssessment(row.investmentScore),
    },
    // Only where the caller read it, so a record built without it carries no
    // key at all and every composer that ignores it stays byte-identical.
    ...(opts.site ? { site: opts.site } : {}),
  };
}

/** One composed section: the heading a tier gives it and the markdown under it. */
/**
 * The five sections this module composes WHOLE from the record.
 *
 * Named once and exported, because two readers now need the set:
 * `composeStrategySections` builds them, and
 * `dropComposedSectionReproductions` uses it as the bound on which sections a
 * second copy may be dropped for. It is deliberately narrower than "every
 * `computed` section in the registry" — `tenYear` is computed too, and its
 * alias list carries sub-heading names (`Property Value Projections`,
 * `Cumulative Cashflow Projections`) that a Financial report legitimately
 * writes as sections of their own beside the canonical one.
 */
// ─── The opportunity in strategic terms ─────────────────────────────────────

/** "a, b and c"; more than four named, the rest counted. */
function listUses(uses: readonly string[]): string {
  const named = uses.length > 4 ? uses.slice(0, 3) : [...uses];
  const rest = uses.length - named.length;
  const parts = rest > 0 ? [...named, `${rest} other forms of residential accommodation`] : named;
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The benchmark row for a measure, or null. Never the subject's. */
function benchmarkRow(market: MarketFacts, key: EvidenceKey): MarketFactRow | null {
  return market.rows.find((r) => r.key === key && r.benchmark) ?? null;
}

/** The period a row's description ends on (its last ISO date), or null. */
function rowPeriod(row: MarketFactRow): string | null {
  const all = row.describes.match(/\b\d{4}-\d{2}(?:-\d{2})?\b/g);
  return all ? all[all.length - 1] : null;
}

/** A percentage row's figure as a number, or null. */
function percentOf(row: MarketFactRow | null): number | null {
  if (!row || row.value === null) return null;
  const m = /^\s*(−|-)?\s*(\d+(?:\.\d+)?)\s*%/.exec(row.value);
  if (!m) return null;
  return Number(m[2]) * (m[1] ? -1 : 1);
}

/** A register's all-capitals name set as a name: "THE HILLS SHIRE" → "The Hills Shire". */
function asName(value: string): string {
  if (value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/\b[a-z]/g, (c, at: number) => (
    at > 0 && /^(of|and|the)\b/.test(value.toLowerCase().slice(at)) ? c : c.toUpperCase()
  ));
}

/** An area, grouped by hand (never `toLocaleString` — see `money`). */
const area = (n: number): string => {
  const [whole, frac] = String(n).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`;
};

/** "A house on 497.6 m² in the R2 — Low Density Residential zone, The Hills Shire." — held facts only. */
function assetLine(rec: StrategyRecord): string | null {
  const kind = rec.property.propertyType ? rec.property.propertyType.toLowerCase() : null;
  const land = isNum(rec.property.landSqm) ? `${area(rec.property.landSqm)} m²` : null;
  const zone = rec.planning.zone;
  const councilRaw = rec.planning.council ?? rec.property.councilArea;
  const council = councilRaw ? asName(councilRaw) : null;
  if (!kind && !land && !zone) return null;
  const what = kind ? `A ${kind}` : 'A property';
  return `${what}${land ? ` on ${land}` : ''}${zone ? ` in the ${zone} zone` : ''}${council ? `, ${council}` : ''}.`;
}

/**
 * What a land use table says about the residential uses this platform asks
 * about, in one sentence — or null where it names none of them.
 *
 * "Under <instrument>, as read on <date>, a dwelling house is permitted with
 * development consent, and secondary dwellings and dual occupancies are
 * prohibited." Exported because two sections state it — the Due Diligence
 * document's strategic read and the owner-occupier's view — and one sentence
 * written twice is how the two come to say different things about one table.
 * The permitted additional uses are returned beside it rather than folded in:
 * what a permission means is each caller's own paragraph.
 */
export function landUseStanding(table: NonNullable<StrategySite['landUse']>): {
  sentence: string | null;
  dwellingStated: boolean;
  dwellingPermitted: boolean;
  prohibited: string[];
  permitted: string[];
} {
  const dwelling = table.dwellingHouse === 'permitted_with_consent'
    ? 'a dwelling house is permitted with development consent'
    : table.dwellingHouse === 'permitted_without_consent'
      ? 'a dwelling house is permitted without development consent'
      : table.dwellingHouse === 'prohibited'
        ? 'a dwelling house is prohibited'
        : null;
  const prohibited = table.additional.filter((a) => a.standing === 'prohibited').map((a) => a.use);
  const permitted = table.additional
    .filter((a) => a.standing === 'permitted_with_consent' || a.standing === 'permitted_without_consent')
    .map((a) => a.use);
  /*
   * The verb agrees with the NOUN, not with the count. A land use table names
   * its uses in the plural — "secondary dwellings", "dual occupancies" — so
   * one of them is still "are"; only the mass nouns ("multi dwelling
   * housing", "seniors housing", "shop top housing") take "is". Counting
   * printed "secondary dwellings is prohibited" wherever a table named one.
   */
  const verb = prohibited.length === 1 && /\bhousing$/i.test(prohibited[0]) ? 'is' : 'are';
  const said = [
    dwelling,
    prohibited.length ? `${listUses(prohibited)} ${verb} prohibited` : null,
  ].filter((x): x is string => x !== null);
  return {
    sentence: said.length ? `${table.anchor} ${said.join(', and ')}.` : null,
    dwellingStated: dwelling !== null,
    dwellingPermitted: table.dwellingHouse === 'permitted_with_consent'
      || table.dwellingHouse === 'permitted_without_consent',
    prohibited,
    permitted,
  };
}

/**
 * What kind of purchase the land use table makes this.
 *
 * Drawn from the TABLE, never from the land's size or the zone's name — the
 * planning programme's rule that land size is not a permission. Where the
 * table permits a dwelling house and prohibits every additional dwelling it
 * names, the consequence is stated in one sentence, because that is the
 * strategic fact a buyer most needs and the evidence chapters only imply it.
 * Where it permits one, the permission is named and no value is attached.
 */
function purchaseKind(rec: StrategyRecord): string | null {
  const asset = assetLine(rec);
  const table = rec.site?.landUse ?? null;
  if (!table) {
    if (!asset) return null;
    return `**What kind of purchase this is.** ${asset} The land use table for this property has not been confirmed, `
      + 'so nothing here says what may or may not be added to it — the council\'s planning certificate settles that.';
  }
  const { sentence, dwellingStated, dwellingPermitted, prohibited, permitted } = landUseStanding(table);
  if (!sentence && !permitted.length) {
    return asset
      ? `**What kind of purchase this is.** ${asset} The land use table does not name the residential uses this `
        + 'report asks about, so it settles nothing here — the council\'s planning certificate does.'
      : null;
  }
  const standing = sentence ?? '';
  const consequence = permitted.length
    ? `The table permits ${listUses(permitted)} with consent. A permission in the table is not an approval: whether `
      + 'this site could take one is a question for a planning professional with the survey in hand, and no value '
      + 'is attached to it here.'
    : dwellingPermitted && prohibited.length
      ? 'So this is a single-dwelling purchase: its value rests on the dwelling that stands on the land and on the '
        + 'land itself, not on adding another dwelling to it.'
      : '';
  return [
    `**What kind of purchase this is.** ${[asset, standing, consequence].filter(Boolean).join(' ')}`,
    '',
    `*${dwellingStated ? `${table.caveat} ` : ''}${table.limit}*`,
  ].join('\n');
}

/**
 * What the market has done, beside the benchmark it is judged against.
 *
 * A gap is computed only where the two rows end on the same period, because a
 * difference between windows that do not match is two facts, not one.
 */
function marketPath(rec: StrategyRecord): string | null {
  const g5 = subjectRow(rec.market, 'growth5YearCagr');
  const g5n = percentOf(g5);
  if (!g5 || g5n === null) return null;
  const parts = [`Measured price growth over five years was ${g5.value} a year (${citeRow(g5)}).`];
  const b5 = benchmarkRow(rec.market, 'benchmarkGrowth5YearCagr');
  const b5n = percentOf(b5);
  if (b5 && b5n !== null) {
    const same = rowPeriod(g5) !== null && rowPeriod(g5) === rowPeriod(b5);
    parts.push(`The benchmark it is judged against grew ${b5.value} a year (${citeRow(b5)})`
      + (same && Math.abs(g5n - b5n) >= 0.05
        ? `, so this market ${g5n < b5n ? 'trailed' : 'ran ahead of'} it by ${Math.abs(g5n - b5n).toFixed(1)} points over the same window.`
        : same ? ', so this market kept pace with it over the same window.' : '.'));
  }
  parts.push('That is a record of what happened, not a forecast of what will.');
  return `**What the market has done.** ${parts.join(' ')}`;
}

/** What it will compete with — the register's pipeline, as a floor where it is one. */
function competingSupply(rec: StrategyRecord): string | null {
  const p = rec.site?.pipeline;
  if (!p || !isNum(p.dwellings) || p.dwellings <= 0) return null;
  const count = String(Math.round(p.dwellings)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const floor = isNum(p.rowsRead) && isNum(p.totalStated) && p.rowsRead < p.totalStated;
  return `**What it competes with.** ${floor ? 'At least ' : ''}${count} new dwellings were stated on development `
    + `applications in ${p.council}${p.window ? `, ${periodsIn(p.window)}` : ''}`
    + (floor ? ` — a floor, summed from ${p.rowsRead} of the ${p.totalStated} applications the council lists.` : '.')
    + ' That is supply arriving in the same local government area, which a buyer reselling or letting a comparable '
    + 'dwelling will meet.';
}

/**
 * The strategic read the Due Diligence document opens with.
 *
 * The owner's words about the 23 Sep 2026 document for 97 Poole Road: it
 * should identify "the strategic nature of this opportunity itself rather
 * than just information pounding". Its sixteen chapters each describe one
 * register, and none said what they add up to — what kind of purchase the
 * land use table makes it, how its market has moved against the benchmark,
 * what supply it will meet, and what the decision turns on. This says that,
 * in four paragraphs, from the same record the chapters read; it rates
 * nothing, forecasts nothing and values nothing.
 *
 * Empty where the record supports none of the first three, so a record with
 * no planning, market or pipeline reading draws no section rather than a
 * section of absences.
 */
export function composeStrategicRead(rec: StrategyRecord, heading: string): string {
  const paragraphs = [purchaseKind(rec), marketPath(rec), competingSupply(rec)]
    .filter((p): p is string => p !== null);
  if (!paragraphs.length) return '';
  paragraphs.push(
    '**What decides it.** The case turns on what no published source can answer: the condition and lawful status of the '
    + 'dwelling, the title, and the council\'s planning certificate. The Due Diligence Checklist sets them out in '
    + 'the order they are owed.',
  );
  return [
    `## ${heading}`,
    '',
    'What this purchase is, what its value rests on and what the decision turns on, drawn from the sources checked '
    + 'for this report. The chapters that follow carry the evidence; this is what it adds up to.',
    '',
    ...paragraphs.flatMap((p) => [p, '']),
  ].join('\n').trimEnd() + '\n';
}

export const STRATEGY_SECTION_IDS = [
  'swot', 'suitability', 'holdingStrategy', 'exitStrategy', 'monitoring', 'strategicRead',
] as const;

export interface StrategySection {
  id: (typeof STRATEGY_SECTION_IDS)[number];
  heading: string;
  markdown: string;
}

/**
 * Compose the sections a tier asks for, in the order given.
 *
 * The caller names the headings, because a tier's label is the registry's to
 * decide and this module has no business knowing that the Compass calls the
 * exit section "Resale Liquidity & Exit Outlook" and the Financial report
 * calls it "Resale Liquidity & Exit Strategy".
 */
export function composeStrategySections(
  record: StrategyRecord,
  wanted: ReadonlyArray<{ id: StrategySection['id']; heading: string }>,
): StrategySection[] {
  const composers: Record<StrategySection['id'], (r: StrategyRecord, h: string) => string> = {
    swot: composeSwot,
    suitability: composeSuitability,
    holdingStrategy: composeHoldingStrategy,
    exitStrategy: composeExitOutlook,
    monitoring: composeMonitoringPlan,
    strategicRead: composeStrategicRead,
  };
  return wanted.map(({ id, heading }) => ({ id, heading, markdown: composers[id](record, heading) }));
}
