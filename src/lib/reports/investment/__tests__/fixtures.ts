/**
 * An investment report row, of the shape the corpus actually holds.
 *
 * This format is the largest in the programme — a 36-section prose skeleton
 * with up to sixteen infographics attached to it by section number — and until
 * this file existed it was the only one of the ten with no fixture at all. Its
 * archetype's page band was pinned from ad-hoc renders during the migration and
 * then nothing in the repo could reproduce them, which meant five chart
 * primitives (`renderScoreWheel`, `renderMicroMap`, `renderSeriesFan`,
 * `renderTiles`, `renderNamedChart`) existed for a document nothing constructed.
 *
 * Everything here is fictional. The *shapes* are taken from the record —
 * `payload.pure.ts` documents the column-by-column counts they were measured
 * from — because a fixture that does not match the payload's real branch
 * structure tests the fixture rather than the format.
 *
 * Two facts about the corpus decide what the variants below are for:
 *
 * - **Only 15% of rows carry any financial modelling.** `withoutFinancials()`
 *   is therefore the *ordinary* report, not the degenerate one, and the
 *   document has to say so on the page rather than printing an empty axis.
 * - **Every score ever recorded falls between 38 and 68**, and 979 of 1,176
 *   rows have one at all. `withoutScore()` is the other common shortfall.
 */

/** Fixed instants. Nothing in this programme has a clock. */
export const PREPARED_ON = '2026-08-02T00:00:00.000Z';
export const GENERATED_AT = '2026-07-28T04:15:00.000Z';

export const REPORT_ID = '7f3c1d2e-9a4b-4c1e-8f6a-2b5d9e0c7a41';
export const ADDRESS = '18 Marlowe Parade, Kirribeck NSW 2287';

/**
 * One paragraph of body prose, long enough to set a measure and wrap.
 *
 * No two calls produce the same text, and that is the point rather than a
 * nicety. The first version of this cycled three clauses out of a pool of six,
 * so a 46-page render repeated itself on 33 pages and the critique rubric's
 * only `high` rule — `duplicate-block` — fired 33 times on the fixture and
 * could not have seen a real one. A fixture that repeats itself makes the
 * strongest check in the harness useless for the document it is checking.
 *
 * The three slots are drawn from three lists of different, coprime lengths, so
 * the combination does not recur until far beyond any document this format can
 * produce.
 */
const OBSERVED = [
  'the catchment absorbed 240 new dwellings without a measurable rise in days on market',
  'rents cleared the suburb median at each of the last four renewals',
  'the vacancy rate has held under one per cent for six consecutive quarters',
  'building approvals in the twelve months to June are down 18% on the prior year',
  'the two nearest comparable sales settled above their guides',
  'the station upgrade is funded and scheduled for the 2028 financial year',
  'the median holding period in this postcode is eight years and lengthening',
  'three of the last five listings sold before their first open',
  'the rental pool has shifted toward families and away from share households',
  'land values rose faster than improved values in each of the last three assessments',
  'the council has not varied the height limit on this street since 2011',
];

const WHY = [
  'a four-bedroom house here competes with very little of the same shape',
  'the loan on a property of this price is serviceable at the buffer rate',
  'a tenant in this catchment has few alternatives inside the same school zone',
  'the yield gap against the metropolitan median has narrowed to 40 basis points',
  'the cost of holding has risen faster than rent in every year since 2023',
  'stock at this price point turns over roughly twice a decade',
  'insurance in this postcode reprices annually and has risen three years running',
];

const CAVEAT = [
  'None of this is a forecast; it is what the sources at the back of this report held on the day it was generated.',
  'These are recorded figures, not projections, and they describe the past rather than the year ahead.',
  'The measurement is as good as its source, and the sources are named at the back.',
  'Read this as the position on the date of generation; nothing here anticipates a policy change.',
  'This is what the data showed. What it will show next quarter is not knowable from it.',
];

const para = (seed: number): string => {
  const n = Math.abs(seed);
  return `On the evidence available, ${OBSERVED[n % OBSERVED.length]}. That matters here `
    + `because ${WHY[n % WHY.length]}, and the same records show `
    + `${OBSERVED[(n * 3 + 5) % OBSERVED.length]}. ${CAVEAT[n % CAVEAT.length]}`;
};

/** Leads for a bold-led bullet or paragraph — the corpus bolds 14.7 lines a section. */
const BULLET_LEADS = [
  'Vacancy', 'Days on market', 'Median rent', 'Stock on market', 'Approvals',
  'Owner-occupier share', 'Travel time', 'School catchment', 'Land value',
  'Insurance', 'Holding period', 'Buyer depth', 'Yield gap', 'Rate exposure',
  'Zoning', 'Comparable sales', 'Household size',
];

/**
 * A fifth clause, so a paragraph reaches the length the *current* format writes.
 *
 * Thirteen entries, which shares no factor with the 11, 7 and 5 above, so the
 * combined period is 5,005 paragraphs — an order of magnitude more than any
 * document this format can produce.
 */
const QUALIFIER = [
  'The figure is drawn from the twelve months to June and has not been seasonally adjusted',
  'Two of the four comparable sales used here settled before the most recent rate decision',
  'The catchment boundary used is the one the department published in March, not the older line',
  'Where a range is quoted the lower bound is the one the council will hold to',
  'The series was rebased in 2024, so anything before that is not directly comparable',
  'This counts dwellings approved rather than dwellings completed, and the gap is widening',
  'The rental figure is advertised rent, which runs slightly ahead of achieved rent',
  'Only sales with a disclosed price are counted; withdrawn listings are excluded',
  'The measure is a median rather than a mean, so a single large transaction cannot move it',
  'Population here is usual residents, not the larger night-time or worker population',
  'The travel time assumes an off-peak departure and no service disruption',
  'The insurance estimate is a market quote and not a bound premium',
  'Land value is the unimproved figure the Valuer General records, not a sale price',
];

/**
 * A paragraph at the length this format's paragraphs actually run.
 *
 * Measured over the 546 sections in the 35 current reports: a section is 7,838
 * characters carrying 11.5 paragraphs, 4.3 sub-headings, 6.7 bullets and **6.9
 * chart directives**. Net of the furniture that leaves about 480 characters a
 * paragraph, against the 350 `para` produces — which is right for the *numbered*
 * format, whose 36 sections average 1,035 characters, and wrong for this one.
 */
const richPara = (seed: number): string => {
  const n = Math.abs(seed);
  // Every second paragraph opens on a bold lead. The corpus averages 14.7
  // bold-carrying lines a section against the seven the bullets alone give,
  // and the difference is this: the model leads a paragraph with its subject
  // as often as it leads a bullet. Bold is heavier ink, so a fixture without
  // it measures lighter than the document it stands for.
  const lead = n % 2 === 0 ? '' : `**${BULLET_LEADS[n % BULLET_LEADS.length]}.** `;
  return `${lead}${para(n)} ${QUALIFIER[n % QUALIFIER.length]}.`;
};

/** Sub-headings, so a section has the internal structure a real one has. */
const SUBHEADS = [
  'What the record shows',
  'How it compares to the suburb',
  'Where the risk sits',
  'What a tenant sees',
  'The supply position',
  'What has changed since the last review',
  'How durable this looks',
  'What would change the assessment',
  'The comparison set',
  'What is not in the data',
  'How this affects holding cost',
  'The practical implication',
  'Where the numbers disagree',
];


const bullet = (seed: number): string => {
  const n = Math.abs(seed);
  return `- **${BULLET_LEADS[n % BULLET_LEADS.length]}** — ${OBSERVED[n % OBSERVED.length]}.`;
};

/** The 36-section prose skeleton, as the model writes it. */
const SECTION_TITLES: ReadonlyArray<[number, string]> = [
  [1, 'Location Overview'],
  [2, 'Suburb Profile'],
  [3, 'Historical Price Growth'],
  [4, 'Historical Rent Growth'],
  [5, 'Current Market Performance'],
  [6, 'Demographics'],
  [7, 'Employment & Industry'],
  [8, 'Transport & Access'],
  [9, 'Schools & Education'],
  [10, 'Healthcare'],
  [11, 'Retail & Lifestyle'],
  [12, 'Amenity Summary'],
  [13, 'Planning & Zoning'],
  [14, 'Development Pipeline'],
  [15, 'Supply & Demand'],
  [16, 'Rental Market'],
  [17, 'Owner-Occupier Market'],
  [18, 'Comparable Sales'],
  [19, 'Economic Context'],
  [20, 'Base Assumptions'],
  [21, 'Yield Calculations'],
  [22, 'Annual Holding Costs'],
  [23, 'Loan Structure'],
  [24, 'Sensitivity Analysis'],
  [25, 'Property Value Projections'],
  [26, 'Rental Income Projections'],
  [27, 'Cumulative Cashflow Projections ($)'],
  [28, 'Loan-to-Value Over Time'],
  [29, 'Investment Score'],
  [30, 'Score Breakdown'],
  [31, 'Strengths, Weaknesses, Opportunities & Risks'],
  [32, 'Risk Register'],
  [33, 'Exit Considerations'],
  [34, 'Tax & Structuring Notes'],
  [35, 'Recommended Next Steps'],
  [36, 'Demographic & Economic Data'],
];

/**
 * The prose column.
 *
 * Carries the two furniture blocks the document prints itself — 761 rows in the
 * corpus do — so `stripFurniture` has something real to remove and the closing
 * page cannot end up printed twice.
 */
export function reportContent(sections = SECTION_TITLES.length): string {
  const body = SECTION_TITLES.slice(0, sections).map(([n, title]) => {
    // Five seeds per section, never shared with a neighbour. Two paragraphs and
    // three bullets drawn from `n + 3` gave section n's second paragraph to
    // section n + 3's first, so a third of the document repeated the page three
    // sheets back — the same class of noise the pooled clauses caused, arriving
    // by a different route.
    const s = n * 5;
    const extra = n === 21 || n === 31 || n === 35
      ? `\n\n- ${para(s + 2).slice(0, 90)}\n- ${para(s + 3).slice(0, 90)}\n- ${para(s + 4).slice(0, 90)}`
      : '';
    const table = n === 18
      ? '\n\n| Address | Sold | Price |\n| --- | --- | ---: |\n'
        + '| 4 Marlowe Parade | Mar 2026 | $902,000 |\n'
        + '| 21 Cardigan Street | Feb 2026 | $874,500 |\n'
        + '| 9 Marlowe Parade | Dec 2025 | $918,000 |'
      : '';
    return `# ${n}. ${title}\n\n${para(s)}\n\n${para(s + 1)}${extra}${table}`;
  }).join('\n\n');

  return `# REPORT TITLE\n\nInvestment Location & Property Fit — ${ADDRESS}\n\n${body}\n\n`
    + '## ⚖️ PROFESSIONAL DISCLAIMER\n\nThis document is general information only and does '
    + 'not constitute personal advice. It must be read with the disclosures at the back.\n\n'
    + '## 📞 CONTACT US\n\nCall the office on 00 0000 0000 or reply to the email this '
    + 'report arrived with.\n';
}

const SOURCES = [
  'Australian Bureau of Statistics — Census of Population and Housing, 2021',
  'Australian Bureau of Statistics — Building Approvals, monthly series',
  'Reserve Bank of Australia — Statement on Monetary Policy, May 2026',
  'NSW Valuer General — Land Value Summary, 2026',
  'Kirribeck City Council — Local Environmental Plan, consolidated 2025',
  'Transport for NSW — Patronage by station, quarterly release',
  'Department of Education — School enrolment and catchment data, 2026',
  'CoreLogic — Suburb median and days-on-market series, June 2026',
];

/**
 * `sources_content` is a text column, and it opens with its own headings.
 *
 * 1,114 rows carry `## SOURCES & REFERENCES` and `### Citations:`; 777 also
 * carry `### Additional Sources:` partway down. They are the only non-URL lines
 * in the column, and counting them is what captioned a chapter of 19 citations
 * "21 cited" and printed two headings as its first two rows.
 */
export const sourcesContent = [
  '',
  '## SOURCES & REFERENCES',
  '',
  '### Citations:',
  ...SOURCES.slice(0, 5).map((s, i) => `${i + 1}. ${s}`),
  '',
  '### Additional Sources:',
  ...SOURCES.slice(5).map((s, i) => `${i + 6}. ${s}`),
].join('\n');

/** How many real citations `sourcesContent` carries. */
export const SOURCE_COUNT = SOURCES.length;

/**
 * `property_specs`, as the column is actually populated.
 *
 * Land and building size are null here because they are null on **every one of
 * the 1,182 rows** — the two dimensions a reader of a property report looks for
 * first live in `financial_calculations.propertySpecs`, under different names.
 * A fixture that filled them in was the reason the spec table looked complete
 * in every test and printed neither on a client's page.
 */
const PROPERTY_SPECS = {
  property_type: 'House',
  bedrooms: 4,
  bathrooms: 2,
  parking: null,
  land_size_sqm: null,
  building_size_sqm: null,
  year_built: 2004,
  zoning: 'R2 Low Density',
  council_area: 'Kirribeck City Council',
};

/** The other half of the specification. Note `buildSizeSqm`, not `building…`. */
const FINANCIAL_PROPERTY_SPECS = {
  landSizeSqm: 612,
  buildSizeSqm: 198,
  carSpaces: 2,
  propertyType: 'House',
};

/** Inside the observed 38-68 band. A score outside it would be fiction. */
const INVESTMENT_SCORE = {
  totalScore: 61,
  grade: 'C+',
  recommendation:
    'Suitable as a yield holding for an investor with a five-to-seven year horizon and '
    + 'the capacity to absorb a rate rise of one per cent without refinancing.',
  /**
   * A dimension is an object, not a number.
   *
   * The first version of this fixture wrote `locationScore: 68`, which reads
   * perfectly and is a shape **no row in the corpus has ever held**: all 985
   * scored reports carry `{ score, weight, details, hasData, excluded }`. The
   * normaliser read the bare number, the fixture agreed with it, and the score
   * wheel — the one drawing in this document that comes from the scoring engine
   * rather than the model's prose — had never been on a page.
   */
  breakdown: {
    locationScore: {
      score: 68, weight: 30, hasData: true, excluded: false,
      details: 'Rail within 900m. Two primary schools in catchment. Walk score 63.',
    },
    yieldScore: {
      score: 57, weight: 25, hasData: true, excluded: false,
      details: 'Gross yield 3.74% against a 4.10% suburb median.',
    },
    growthScore: {
      score: 62, weight: 20, hasData: true, excluded: false,
      details: 'Land value growth outran improved value in each of three assessments.',
    },
    demandScore: {
      score: 71, weight: 15, hasData: true, excluded: false,
      details: 'Vacancy under 1% across six quarters. Four-bedroom stock under-supplied.',
    },
    riskScore: {
      score: 49, weight: 10, hasData: true, excluded: false,
      details: 'Single major employer in the catchment. Insurance repricing annually.',
    },
  },
  strengths: [
    'Vacancy under one per cent across six quarters.',
    'Four-bedroom stock is under-supplied in the catchment.',
    'Two primary schools and one high school inside the catchment.',
    'Rail access within nine hundred metres.',
  ],
  weaknesses: [
    'Land value has outrun rent for three consecutive years.',
    'The building is twenty-two years old and has not been renovated.',
    'Insurance has risen at each of the last three renewals.',
  ],
  opportunities: [
    'A dual-occupancy application is permissible under the current LEP.',
    'The station upgrade is funded and scheduled inside the horizon.',
    'A cosmetic renovation would lift rent to the top of the range.',
  ],
  risks: [
    'A further rate rise would move this holding to negative cash flow.',
    'Two hundred and forty dwellings are approved within two kilometres.',
    'The catchment is exposed to a single major employer.',
  ],
};

const LOCATION_INTELLIGENCE = {
  walkScore: 63,
  coordinates: { lat: -32.9241, lng: 151.7008 },
  schools: { schoolsWithin3km: 7 },
  transport: { stopsWithin1km: 12, score: 74 },
  healthcare: { facilitiesWithin5km: 9, score: 68 },
  lifestyle: { venuesWithin2km: 31, score: 71 },
  amenities: [
    ...Array.from({ length: 6 }, () => ({ type: 'Cafe' })),
    ...Array.from({ length: 4 }, () => ({ type: 'Supermarket' })),
    ...Array.from({ length: 3 }, () => ({ type: 'Park' })),
    ...Array.from({ length: 2 }, () => ({ type: 'Gym' })),
  ],
};

const DEMOGRAPHICS = {
  population: { total: 18_420, growth: 1.8, density: 1_240 },
  income: { medianAge: 36, medianHouseholdIncome: 98_600, unemploymentRate: 4.1 },
  housing: { medianRent: 640, ownerOccupierRate: 58.2, renterRate: 38.4, housingStress: 12.7 },
};

const ECONOMIC_DATA = {
  cashRate: 3.85,
  inflation: 2.9,
  indicators: {
    gdpGrowth: 2.1,
    unemploymentRate: 4.3,
    participationRate: 66.8,
    creditGrowth: 5.2,
    housePriceGrowth: 4.6,
  },
};

/** Ten years of one scenario. */
const series = (growth: number, rentGrowth: number, base: number) =>
  Array.from({ length: 10 }, (_, i) => ({
    year: i + 1,
    propertyValue: Math.round(890_000 * (1 + growth) ** (i + 1)),
    annualRent: Math.round(33_280 * (1 + rentGrowth) ** (i + 1)),
    cumulativeCashFlow: Math.round(base * (i + 1) + 320 * (i + 1) ** 2),
  }));

export const PROJECTIONS = {
  conservative: series(0.025, 0.02, -6_400),
  moderate: series(0.045, 0.03, -4_100),
  optimistic: series(0.065, 0.04, -1_800),
};

const FINANCIAL_CALCULATIONS = {
  keyMetrics: {
    grossRentalYield: 3.74,
    netRentalYield: 2.41,
    cashOnCashReturn: -2.9,
    lvr: 80,
    totalInvestment: 231_400,
    annualNet: -6_720,
    weeklyNet: -129,
  },
  loanDetails: { loanAmount: 712_000, interestRate: 6.15, monthlyPayment: 4_337, lvr: 80 },
  income: { annualRent: 33_280 },
  annualCosts: {
    councilRates: 2_480,
    waterRates: 1_140,
    landlordInsurance: 1_980,
    propertyManagement: 2_330,
    maintenance: 2_670,
    strataFees: 0,
    landTax: 1_620,
    lettingFees: 640,
  },
  sensitivityAnalysis: {
    interestRateChanges: {
      minus1Percent: 400,
      plus1Percent: -13_840,
      plus2Percent: -20_960,
    },
    rentChanges: {
      minus10Percent: -10_048,
      plus5Percent: -5_056,
      plus10Percent: -3_392,
    },
  },
  projections: PROJECTIONS,
  propertySpecs: FINANCIAL_PROPERTY_SPECS,
};

export interface RowOverrides {
  [key: string]: unknown;
}

/**
 * The complete row: prose, every structured column, and a financial model.
 *
 * This is the 15% case, and the one that exercises every chart. It is the
 * fixture that gets rendered and looked at.
 */
export function reportRow(over: RowOverrides = {}): Record<string, unknown> {
  return {
    id: REPORT_ID,
    status: 'completed',
    property_address: ADDRESS,
    report_content: reportContent(),
    sources_content: sourcesContent,
    report_scope: 'full',
    report_tier: 'premium',
    report_variant: 'standard',
    created_at: GENERATED_AT,
    updated_at: GENERATED_AT,
    property_specs: PROPERTY_SPECS,
    investment_score: INVESTMENT_SCORE,
    location_intelligence: LOCATION_INTELLIGENCE,
    demographics_data: DEMOGRAPHICS,
    economic_data: ECONOMIC_DATA,
    financial_calculations: FINANCIAL_CALCULATIONS,
    ...over,
  };
}

/** The ordinary report: 85% of the corpus carries no financial model. */
export const withoutFinancials = (over: RowOverrides = {}) =>
  reportRow({ financial_calculations: null, ...over });

/** 197 rows were never scored. */
export const withoutScore = (over: RowOverrides = {}) =>
  reportRow({ investment_score: null, ...over });

/** A location-only report: no prose past the locality work, and no money. */
export const locationOnly = (over: RowOverrides = {}) =>
  reportRow({
    report_scope: 'location_only',
    report_content: reportContent(12),
    financial_calculations: null,
    ...over,
  });

/**
 * The format the generator writes **today**.
 *
 * The v3.0 Compass: eleven named sections plus back matter, no numbering
 * anywhere, and a chart directive under most of them. Measured over the corpus:
 * of the reports carrying `{{…}}` figures — every current one — **not one has a
 * numbered heading**, against 733 of the 1,147 older reports that do. Both
 * shapes are real and both are fixtured, because the numbered path still serves
 * two-thirds of the archive.
 *
 * This list is the registry's `compassSections()` in order, and it must stay
 * that way. The whole point of `currentFormat()` is that the harness measures
 * the document a client receives this week — `docs/reports/INVESTMENT.md` §5
 * and §7 are both about what happens when this fixture and production disagree
 * (a fixture 8.3× thinner per section than the real thing, and every
 * page-economy number in the programme taken against it).
 *
 * The directives are verbatim in form and fictional in content.
 */
export const CURRENT_SECTION_TITLES: readonly string[] = [
  'Executive Verdict',
  'Property & Locality Snapshot',
  'Why This Location Matters',
  'Demand Drivers',
  'Amenity & Access',
  'Market Positioning',
  'Property Fit Within the Suburb',
  'Risk Dashboard',
  'Due Diligence Checklist',
  'Final Recommendation',
  'Appendix, Source Notes & Disclaimer',
];

/**
 * One directive per section, none of them repeated.
 *
 * The same rule the prose follows, and for the same reason recorded above
 * `OBSERVED`: a fixture that repeats itself makes `duplicate-block` — the
 * critique rubric's only `high` finding — useless for the document it is
 * checking. Cycling seven directives over sixteen sections put the identical
 * gauge on pages 7 and 17 and fired the rule five times on the fixture alone.
 */
const glanceFor = (i: number, title: string): string =>
  `{{glance: \u2713 ${title} holds up on the evidence | \u25c6 Established 4-bed House `
  + `| \u26a0 Watch the ${['insurance', 'supply', 'employment', 'rates'][i % 4]} line `
  + `| \u2605 Weighting: ${['strong', 'adequate', 'mixed', 'thin'][i % 4]}}}`;

/**
 * One of the seven plottable kinds, chosen by a running index.
 *
 * The glance is separate because the generator's prompt mandates it as the
 * *opener* of every section \u2014 "Every chapter MUST open with a `{{glance: \u2026}}`
 * strip" \u2014 so it cannot be one entry in a rotation that might place it in the
 * middle.
 *
 * Same kind and same value recur only when the index differs by
 * `lcm(7, 34) = 238`, and the document uses 96 of them, so no two figures in
 * this fixture draw the same chart.
 */
const figureFor = (n: number, title: string): string => {
  const v = 52 + ((n * 7) % 34);
  switch (n % 7) {
    case 0:
      return `{{gauge: ${v} | ${title} score | Weighted against the firm's own record}}`;
    case 1:
      return `{{bars: Town centre access ${v}, Highway connectivity ${v - 9}, `
        + `Active transport ${v - 17} | title=${title} pillars | max=100 | unit=%}}`;
    case 2:
      return `{{donut: Detached ${v}, Semi/terrace ${100 - v - 14}, Units 14 `
        + `| title=${title} mix | center=${v}% | centerSub=Detached}}`;
    case 3:
      return `{{tiles: Kirribeck ${v} sub="Quiet streets, large yards" int=0.7${n % 9}, `
        + `Marlowe Point ${v - 11} sub="Rail, schools, retail" int=0.6${n % 9} `
        + `| title=${title} across nearby markets | cols=3}}`;
    case 4:
      return `{{timeline: Existing "Rail within 900m", 0-2y "Forecourt upgrade stage ${v}", `
        + `3-5y "Arterial widening stage ${v}" | title=${title} pipeline}}`;
    case 5:
      return `{{wheel: ${v},${v - 4},${v + 6},${v - 12},${v + 2} `
        + `| labels=Location,Yield,Growth,Demand,Risk | max=100 | title=${title} dimensions}}`;
    default:
      return `{{pictograph: ${(n % 8) + 2}/10 | label=${title} | `
        + `sub=Share of the catchment this applies to | icon=house | cols=10}}`;
  }
};

/**
 * The prose column, at the density the generator actually writes.
 *
 * Composition measured across the **546 sections in the 35 current reports**,
 * not chosen:
 *
 * | per section | corpus | here |
 * | --- | ---: | ---: |
 * | characters | 7,838 | ~7,800 |
 * | paragraphs | 11.5 | 12 |
 * | `###` sub-headings | 4.3 | 4 |
 * | bullets | 6.7 | 7 |
 * | **chart directives** | **6.9** | **7** |
 *
 * The first version of this gave each section one directive and two paragraphs
 * \u2014 958 characters against a 7,938-character median, **8.3\u00d7 thin**. Every
 * page-economy measurement taken on this format was therefore taken on a
 * document one-eighth the density of the one a client receives, and it read as
 * a layout fault: 0.065 median ink and seventeen sparse pages. The fixture
 * agreed with the code and disagreed with the database, which is the same
 * failure as the score breakdown and the spec table one level up.
 *
 * The three running counters are what keep it non-repeating, and each stays
 * under its generator's period: 192 paragraphs against 5,005, 112 bullets
 * against 187, 96 figures against 238. So no line of this document is printed
 * twice, and `duplicate-block` \u2014 the rubric's only `high` rule \u2014 stays able to
 * see a real repeat.
 */
export function currentFormatContent(): string {
  let p = 0;
  let b = 0;
  let f = 0;
  const P = () => richPara(p++);
  const B = () => bullet(b++);

  const body = CURRENT_SECTION_TITLES.map((title, i) => {
    const F = () => figureFor(f++, title);
    const sub = (k: number) => `### ${SUBHEADS[(i * 5 + k) % SUBHEADS.length]}`;
    // One table in the document, not one per section: the corpus averages 0.5
    // table *lines* a section, so tables are rare rather than routine.
    const table = i === 9
      ? '\n\n| Comparable | Sold | Price |\n| --- | --- | ---: |\n'
        + '| 4 Marlowe Parade | Mar 2026 | $902,000 |\n'
        + '| 21 Cardigan Street | Feb 2026 | $874,500 |\n'
        + '| 9 Marlowe Parade | Dec 2025 | $918,000 |'
      : '';

    return [
      `## ${title}`,
      glanceFor(i, title),
      P(), P(),
      sub(0),
      P(), F(), P(),
      [B(), B(), B()].join('\n'),
      sub(1),
      P(), F(), P(), F(), P(),
      sub(2),
      F(), P(), P(),
      [B(), B(), B(), B()].join('\n'),
      sub(3),
      P(), F(), P(), F(), P(),
    ].join('\n\n') + table;
  }).join('\n\n');

  return `# Property & Location Due Diligence Report\n\n_${ADDRESS}_\n\n${body}\n`;
}

/** A row in the shape the product produces now. */
export const currentFormat = (over: RowOverrides = {}) =>
  reportRow({ report_content: currentFormatContent(), ...over });

/** The smallest thing this format will still typeset. */
export const minimal = (over: RowOverrides = {}) => ({
  id: REPORT_ID,
  status: 'completed',
  property_address: ADDRESS,
  report_content: `# 1. Location Overview\n\n${para(1)}\n\n${para(4)}`,
  created_at: GENERATED_AT,
  property_specs: PROPERTY_SPECS,
  ...over,
});
