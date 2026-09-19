/**
 * What an investment report says, as a shape.
 *
 * ## The largest corpus in the programme, and the richest
 *
 * 1,176 rows, 1,157 completed. Unlike every format before it, the prose is not
 * the only thing worth printing: six jsonb columns carry genuinely structured,
 * genuinely chartable measurements, and the document that is being replaced
 * prints almost none of them as anything but a table.
 *
 * | column | rows | what it holds |
 * | --- | --- | --- |
 * | `property_specs` | 1,176 | beds, baths, parking, land, build, year, zoning |
 * | `economic_data` | 1,089 | cash rate, inflation, seven indicators |
 * | `location_intelligence` | 1,088 | walk score, coordinates, schools, transport |
 * | `demographics_data` | 1,078 | population, income, employment, housing |
 * | `investment_score` | 979 | total, grade, a five-way breakdown, SWOT |
 * | `financial_calculations` | **179** | loan, yields, costs, projections, sensitivity |
 *
 * The gap in that last row is the single most important fact about this format.
 * **Only 15% of reports carry any financial modelling at all**, so every
 * financial figure and every financial chart has to be conditional, and the
 * document has to say so rather than printing an empty axis.
 *
 * ## The prose has a declared spine, not a discovered one
 *
 * Unlike the Report Q&A, whose sections are whatever headings the model wrote,
 * this format's prose follows a numbered 36-section skeleton that is stable
 * across the corpus — `# 1. Location Overview` through `# 36. Demographic &
 * Economic Data`, present in 526-576 reports each. That is what makes the
 * infographics placeable: section 24 is always the sensitivity analysis, section
 * 30 is always the score breakdown, so a chart can be attached to a section by
 * its number rather than by guessing from its text.
 *
 * `SECTION_CHARTS` below is that mapping, and it is the heart of this migration.
 *
 * ## Two blocks of the prose are furniture the document already owns
 *
 * 761 reports end with `## ⚖️ PROFESSIONAL DISCLAIMER` and `## 📞 CONTACT US`
 * written into the model's own Markdown. The design system prints a company
 * page with the tenant's real contact block and the disclaimer from
 * `global_report_settings`, so leaving the model's would print both — once with
 * the tenant's actual ABN and once with whatever the model invented. They are
 * stripped, and `normalise.pure.ts` records how many characters that removed.
 */
import type { MarkdownNotices } from '../markdown.pure.ts';

/** Content shorter than this is not a section. */
export const MIN_SECTION_CHARS = 80;

/**
 * The most Markdown one section may carry.
 *
 * `report_content` runs to 338,471 characters at its largest against a 37,270
 * average, and it is one column holding all 36 sections. Per section rather than
 * per document for the reason the Market Intelligence migration found: a
 * document budget drops whole sections, and a reader would rather have all 36
 * shortened than 22 of them whole.
 */
export const MAX_SECTION_CHARS = 14_000;

/**
 * A last-resort whole-document ceiling, in estimated printed lines.
 *
 * Raised from 2,000 when the model's `{{…}}` figures started being drawn
 * instead of printed as source. Measured across the 35 reports in the corpus
 * that carry directives: **107 figures a report**, and at the widths
 * `vizFigures.pure.ts` draws them, an average of 890 lines — around 23 sheets
 * of charts that this budget previously charged nothing for and now must hold.
 *
 * 2,000 lines is 53 pages. The Compass document a client was actually sent last
 * month is **61**, so the old ceiling was already cutting sections off the end
 * of the longest reports before a single chart existed; with the figures
 * counted it would cut a third of them. 3,200 is 84 pages, which sits under the
 * archetype's own 92-page ceiling (`structure.pure.ts`) with room for the
 * per-chapter page rounding that `pagesForLines` applies on top.
 *
 * Still a last resort. `MAX_SECTION_CHARS` is the budget that should bind
 * first, for the reason recorded above it: a reader would rather have all 36
 * sections shortened than 22 of them whole.
 */
export const MAX_DOCUMENT_LINES = 3_200;

/** The corpus maximum is 36 numbered sections plus a title. */
export const MAX_SECTIONS = 60;

/** SWOT lists. The prose calls for "Top 3", the engine sometimes returns more. */
export const MAX_SWOT_ITEMS = 8;

/** Projection tables run ten years; twice that is a paste. */
export const MAX_PROJECTION_YEARS = 20;

// ── The five score dimensions ───────────────────────────────────────────────

/**
 * Exactly these five, on all 979 scored reports.
 *
 * Named here rather than discovered from the object so the score wheel's spokes
 * are in a fixed order — a wheel whose axes reorder between two reports is a
 * wheel a reader cannot compare, and `Object.keys` order is not a contract.
 */
export const SCORE_DIMENSIONS = [
  { key: 'locationScore', label: 'Location' },
  { key: 'yieldScore', label: 'Yield' },
  { key: 'growthScore', label: 'Growth' },
  { key: 'demandScore', label: 'Demand' },
  { key: 'riskScore', label: 'Risk' },
] as const;

export type ScoreDimensionKey = typeof SCORE_DIMENSIONS[number]['key'];

/**
 * The observed range of `totalScore` across the whole corpus.
 *
 * 979 scores, and **every one of them falls between 38 and 68**. 648 are grade
 * C, 201 C+, 99 D, 30 B, and exactly one B+. There is not a single A.
 *
 * This is the fact that decides how the headline score is drawn. A 0-100 gauge
 * is honest and almost useless: every property this firm has ever scored sits in
 * the same narrow band just below the middle, so the needle is in the same place
 * on every report and the reader learns nothing from it. The document therefore
 * prints the absolute gauge **and** where the property sits against its peers,
 * and says plainly that the peer set is this firm's own scored reports rather
 * than the market.
 *
 * Held as constants rather than queried per render so a document is reproducible
 * from its row alone; the route passes the live figures when it has them.
 */
export const SCORE_CORPUS = {
  count: 979,
  min: 38,
  max: 68,
  mean: 48,
  /** Grade bands, in printed order. */
  grades: [
    { grade: 'D', n: 99 },
    { grade: 'C', n: 648 },
    { grade: 'C+', n: 201 },
    { grade: 'B', n: 30 },
    { grade: 'B+', n: 1 },
  ],
} as const;

// ── The declared section spine ──────────────────────────────────────────────

/** Which infographic a numbered prose section earns, when the data supports it. */
export type SectionChart =
  | 'score-gauge'
  | 'score-wheel'
  | 'score-peers'
  | 'swot-quadrant'
  | 'amenity-bullets'
  | 'locality-map'
  | 'demographics-bars'
  | 'economic-bullets'
  | 'yield-bullets'
  | 'cost-waterfall'
  | 'sensitivity-tornado'
  | 'projection-value'
  | 'projection-rent'
  | 'projection-cashflow'
  | 'lvr-bullet'
  | 'property-tiles';

/**
 * Section number → the chart that belongs beneath it.
 *
 * Keyed on the leading number in the heading, which is what makes this reliable:
 * the headings' wording drifts ("4. Historical Rent Growth" carries trailing
 * whitespace in 538 rows, "27. Cumulative Cashflow Projections ($)" carries a
 * unit) but the numbering does not. Matching on text would have needed a fuzzy
 * rule per section; matching on the number needs none.
 *
 * A section with no entry gets no chart, and a section whose chart has no data
 * behind it gets no chart either — never an empty axis.
 */
export const SECTION_CHARTS: Readonly<Record<number, readonly SectionChart[]>> = {
  1: ['locality-map'],
  6: ['demographics-bars'],
  12: ['amenity-bullets'],
  19: ['economic-bullets'],
  21: ['yield-bullets'],
  22: ['cost-waterfall'],
  24: ['sensitivity-tornado'],
  // One fan each, not one name drawing both. Mapping sections 25 and 27 to a
  // single `projection-lines` chart that drew the value fan *and* the cash-flow
  // fan printed each of them twice — once under "Property Value Projections"
  // and again under "Cumulative Cashflow Projections". Visible immediately in a
  // render as the same chart on pages 34 and 37, and invisible in the code.
  25: ['projection-value'],
  26: ['projection-rent'],
  27: ['projection-cashflow'],
  28: ['lvr-bullet'],
  29: ['score-gauge', 'score-peers'],
  30: ['score-wheel'],
  31: ['swot-quadrant'],
};

/** Prose headings the document prints itself, and must not print twice. */
export const FURNITURE_HEADINGS = [
  'PROFESSIONAL DISCLAIMER',
  'CONTACT US',
  'REPORT TITLE',
] as const;

// ── The shapes ──────────────────────────────────────────────────────────────

/** What the property is. Present on every row in the corpus. */
export interface PropertySpecs {
  propertyType: string;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  landSqm: number | null;
  buildingSqm: number | null;
  yearBuilt: number | null;
  zoning: string;
  councilArea: string;
}

/** The five-way breakdown, the headline and the SWOT lists. */
export interface InvestmentScore {
  total: number | null;
  grade: string;
  recommendation: string;
  /** In `SCORE_DIMENSIONS` order. Absent dimensions are null, never zero. */
  /**
   * The five dimensions, as the engine records them.
   *
   * `weight` and `details` are carried because the corpus has them and the
   * document had nowhere to put them: a wheel showing five scores says nothing
   * about which of them the composite actually leaned on, and `details` is the
   * engine's own one-line reason ("Excellent walkability (90+). Limited CBD
   * access (>60 min)"). `excluded` is the engine saying a dimension had no data
   * and was left out of the total — a fact a reader of the wheel needs, and the
   * opposite of a zero.
   */
  breakdown: ReadonlyArray<{
    key: ScoreDimensionKey;
    label: string;
    value: number | null;
    weight: number | null;
    details: string;
    excluded: boolean;
  }>;
  strengths: readonly string[];
  weaknesses: readonly string[];
  opportunities: readonly string[];
  risks: readonly string[];
  /**
   * Where this score sits among the firm's own scored reports, 0-100.
   *
   * Supplied by the route, which counts it, rather than derived here — this
   * module has no database. Null when the route could not count.
   */
  percentile: number | null;
}

/** Walk score, coordinates and the amenity counts behind them. */
export interface LocationIntelligence {
  walkScore: number | null;
  lat: number | null;
  lng: number | null;
  suburb: string;
  state: string;
  postcode: string;
  /** Named categories with a count and, where the source gave one, a rating. */
  amenities: ReadonlyArray<{ label: string; count: number | null; score: number | null }>;
}

/** Population, income, employment and housing for the locality. */
export interface Demographics {
  population: number | null;
  populationGrowth: number | null;
  density: number | null;
  medianAge: number | null;
  medianHouseholdIncome: number | null;
  unemploymentRate: number | null;
  medianRent: number | null;
  ownerOccupierRate: number | null;
  renterRate: number | null;
  housingStress: number | null;
}

/** The macro backdrop. Present on 1,089 rows. */
export interface EconomicContext {
  cashRate: number | null;
  inflation: number | null;
  gdpGrowth: number | null;
  unemploymentRate: number | null;
  participationRate: number | null;
  creditGrowth: number | null;
  housePriceGrowth: number | null;
}

/** One scenario off the base case. */
export interface SensitivityPoint {
  label: string;
  value: number;
  /** Difference from the base annual position. Drives the tornado's direction. */
  delta: number;
}

/** The financial model, when the report has one. 179 of 1,176 do. */
export interface FinancialModel {
  grossYield: number | null;
  netYield: number | null;
  cashOnCash: number | null;
  lvr: number | null;
  totalInvestment: number | null;
  annualNet: number | null;
  weeklyNet: number | null;
  loanAmount: number | null;
  interestRate: number | null;
  monthlyPayment: number | null;
  /** Named annual cost lines, largest first. Drives the waterfall. */
  costs: ReadonlyArray<{ label: string; value: number }>;
  annualIncome: number | null;
  /** One-way sensitivities. Never a grid — see `normalise.pure.ts`. */
  interestSensitivity: readonly SensitivityPoint[];
  rentSensitivity: readonly SensitivityPoint[];
  /** Year-by-year series, when the model projected any. */
  projections: ReadonlyArray<{ year: number; value: number | null; rent: number | null; cumulative: number | null }>;
}

/** One numbered section of the prose. */
export interface ReportSection {
  /** The leading number, when the heading had one. Keys `SECTION_CHARTS`. */
  number: number | null;
  title: string;
  markdown: string;
  charts: readonly SectionChart[];
}

export interface InvestmentReport {
  meta: {
    reportId: string;
    propertyAddress: string;
    /** `full`, `location_only`, … as stored. */
    reportScope: string;
    reportTier: string;
    reportVariant: string;
    /** ISO instant, supplied by the caller. Nothing here has a clock. */
    preparedOn: string;
    generatedAt: string;
    /** True when the row carries a financial model at all. */
    hasFinancials: boolean;
    /** True when the row carries a score. */
    hasScore: boolean;
    sectionsShown: number;
    truncated: boolean;
  };
  /** Two or three sentences framing the report. Built from it, not written. */
  narrative: string;
  specs: PropertySpecs;
  score: InvestmentScore | null;
  location: LocationIntelligence | null;
  demographics: Demographics | null;
  economic: EconomicContext | null;
  financial: FinancialModel | null;
  sections: readonly ReportSection[];
  /** Every source the report named. Deduplicated, URLs neutralised. */
  sources: readonly string[];
  notices: Readonly<Partial<MarkdownNotices>> & {
    /** Characters removed because the document prints that furniture itself. */
    furnitureStripped: number;
    /** Sections dropped by the document budget. */
    sectionsDropped: number;
    /** Characters of prose the caps did not carry. */
    charsOmitted: number;
    /** Charts a section earned but had no data for. */
    chartsSkipped: number;
  };
}
