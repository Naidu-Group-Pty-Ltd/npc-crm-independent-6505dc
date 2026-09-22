/**
 * The section registry — one constitution for every investment-report tier.
 *
 * Law 3 of the tier framework (docs/reports/TIER_FRAMEWORK.md): *structure is
 * selected by section id, never by matching heading strings; a declared section
 * with no producer fails CI.* This module is the first half of that law. The
 * second half is `sectionRegistry.spec.ts`, which refuses to let a declaration
 * here be a wish.
 *
 * ## What it replaces
 *
 * Structure was defined in SIX places that competed, and no two agreed:
 *
 *   1. `generate-investment-report`'s `DEFAULT_REPORT_SECTIONS` — 12 generation
 *      groups naming 26 H2s, plus three more lists for the other scopes;
 *   2. `compassSectionRegistry.ts` — 12 `compass.*` + 11 `financial.*` ids;
 *   3. `reportSplitRegistry.ts` — FIN's 16 and PLDD's 17, routed by heading
 *      substring;
 *   4. `condense-investment-report`'s `TIER_CONFIG[*].sections`;
 *   5. the `structureGuide` prose inside the same object;
 *   6. a ninth heading list typed inline at the snapshot's trim call site.
 *
 * Number 4 was read by **nothing** — and the snapshot's copy of it was wrong,
 * declaring `Top Opportunities & Risks` and `Recommendation` where the guide
 * beside it asked for `Top 3 Opportunities`, `Top 3 Risks` and `Quick
 * Recommendation`, and omitting two more headings the guide asks for. Six
 * declared entries against nine real ones, in the same object literal.
 *
 * ## Why the sections are fine-grained, and tiers merge them
 *
 * The registry is the **union** of every section any tier draws, and a tier
 * that draws one heading where another draws four says so with `merged`. That
 * shape is forced by the corpus rather than chosen:
 *
 *  - The Due Diligence tier splits demand across four headings (socioeconomic,
 *    population, employment, tenant demand) and risk across two (environmental,
 *    and the dashboard). The Compass draws one `Demand Drivers` and one `Risk
 *    Dashboard`. A registry with only the coarse ids cannot emit PLDD's heading
 *    list; one with only the fine ids cannot emit the Compass's.
 *  - The Compass v3.0 cut folded six sections into two, and that fact lived in
 *    a code comment. Which is why the compass-40 engine shipped a report
 *    carrying the **unmerged** v2.0 sections — `Population & Housing Demand`,
 *    `Tenant & Buyer Profile`, `Employment & Economic Linkages`, `Education &
 *    Family Amenity`, `Retail, Healthcare & Lifestyle Amenity`, `Transport &
 *    Connectivity` — plus two sections the registry marks `includeInCompass:
 *    false`, and nothing noticed. Of five runs of that engine, three produced
 *    three different structures.
 *
 * Two more things a flat list could not express, both measured:
 *
 *  - **A tier renames a section.** One "purchase and holding costs" section is
 *    `Purchase & Ongoing Costs (Annual)` to the generator, `Purchase Costs &
 *    Annual Holding Cost Breakdown` to FIN, and `Purchase & Ongoing Costs` in
 *    the briefings production holds. The label belongs to the *placement*.
 *  - **A section is not always markdown.** The cover, the property identity
 *    table and the key-figures strip are drawn by the template from the binding
 *    projection. A definition that only knows `##` headings cannot say a tier
 *    has them, which is how "the spine is mandatory in every tier" stayed
 *    unenforceable.
 *
 * ## What a declaration is worth
 *
 * FIN declares 16 sections; two — `10-Year Cashflow, Equity & Growth
 * Projection` and `Financial Investment Scorecard` — had never appeared in any
 * of the 11 financial reports ever produced. PLDD declares 17; six consecutive
 * ones, `Planning, Zoning and Title Due Diligence` among them, appear on 1 of
 * 11, on the tier whose whole promise is due diligence. Nothing measured
 * either, because a list of strings cannot be asked whether anything makes them.
 * Hence `producer` on every placement, and a spec that resolves each one.
 *
 * ## What this module is NOT, yet
 *
 * Phase 2 makes the registry the thing the other definitions are *checked
 * against*; Phase 3 makes it the thing they are *assembled from*, and deletes
 * heading-string matching. So `aliases` is populated from measured production
 * headings and `sectionIdForHeading` works, but nothing routes on it yet —
 * `reportSplitRegistry` still owns the fork's substring routing and
 * `compassSectionRegistry` still owns the generator's prompt. Both are now
 * pinned to this file, so they can drift only by failing CI.
 *
 * Deno-parsed: no `@/` aliases, explicit `.ts` extensions. Bridged for the
 * browser at `src/lib/reports/investment/sectionRegistry.pure.ts`.
 */

// ─── Tiers ──────────────────────────────────────────────────────────────────

/**
 * The five tiers stored in `investment_reports.report_tier`.
 *
 * `strategic` is the stored value for what a reader is shown as the **Due
 * Diligence Report** — decision B of the framework. The rename is a label
 * change and lands in Phase 4 with the tier's own cover identity; the stored
 * value never changes, because rows carry it.
 *
 * Comparison is the framework's sixth tier and is deliberately absent: it is
 * not an `investment_reports` row at all — it lives in `property_comparisons`
 * with its own producer — and declaring a tier whose sections this module
 * cannot ground would be the fiction the registry exists to remove. Phase 5
 * brings it in with the storage it needs.
 *
 * One tier has two routes to it and this file describes one of them.
 * `report_tier = 'financial'` is reachable by forking a Compass (11 rows) and,
 * in principle, by condensing one — `condense-investment-report`'s TIER_CONFIG
 * carries a `financial` guide. That second route has produced **zero** rows, so
 * the financial placements below name the fork's routed and composed producers,
 * which is what the corpus actually holds. If the condense route is ever used,
 * its headings and these must be reconciled rather than allowed to be a seventh
 * competing definition.
 */
export const REPORT_TIERS = ['compass', 'briefing', 'snapshot', 'financial', 'strategic'] as const;
export type ReportTier = (typeof REPORT_TIERS)[number];

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * Where the facts in this section come from, and therefore what may validate
 * them. The framework's provenance classes.
 *
 * A table cell may hold only `measured` / `computed` / `recorded` values, never
 * `authored` — law 1 restated as a property of the section rather than of a
 * sentence.
 */
export type Provenance = 'measured' | 'computed' | 'recorded' | 'authored';

/** Where the section is drawn in a given tier. */
export type Surface =
  /** A `##` section inside `report_content`. */
  | 'markdown'
  /** Drawn by the template from the binding projection; no heading in the prose. */
  | 'document';

/**
 * How strongly a tier commits to a section.
 *
 *  - `spine`    — one of the five sections every tier carries. Never absent,
 *                 never optional, never merged away.
 *  - `required` — the tier promises it; it needs a producer.
 *  - `optional` — drawn when the record supports it; absence is not a defect.
 *  - `merged`   — this tier carries the substance inside another section, named
 *                 by `mergedInto`. An absence of a heading, not of the content.
 *
 * A tier absent from `tiers` is **excluded**: it deliberately does not carry
 * the section, and a producer emitting it there is the defect.
 */
export type Depth = 'spine' | 'required' | 'optional' | 'merged';

/**
 * What actually makes the section, and where to look for it.
 *
 *  - `composed`   — a pure function writes the markdown from the record.
 *  - `authored`   — a model writes it under a named guide. The spec asserts the
 *                   guide really asks for this heading: an authored section
 *                   whose prompt never names it is a section nobody will write.
 *  - `routed`     — carried over from a parent document by the split registry.
 *  - `projection` — bound by the template from `reportBindingProjection`.
 */
export type ProducerKind = 'composed' | 'authored' | 'routed' | 'projection';

export interface SectionProducer {
  kind: ProducerKind;
  ref: string;
}

export interface TierPlacement {
  depth: Depth;
  /** Position within the tier, 1-based. Absent only when `depth` is `merged`. */
  order?: number;
  /** The heading this tier gives it. Required for `markdown`, absent otherwise. */
  label?: string;
  /** Defaults to `markdown`. */
  surface?: Surface;
  /** Only, and always, when `depth` is `merged`. */
  mergedInto?: SectionId;
  /**
   * What makes it here. `null` is an honest declaration that nothing does yet —
   * every null on a `spine` or `required` placement must appear in
   * PRODUCER_GAPS, and a new one fails CI.
   */
  producer: SectionProducer | null;
}

export interface SectionDefinition {
  id: SectionId;
  /** The name this section goes by when a tier does not rename it. */
  canonicalLabel: string;
  provenance: Provenance;
  /**
   * Every heading production has actually carried for this section.
   *
   * Measured from the `##` headings of the 1,199 stored reports, which is why
   * the list is untidy: numbered and unnumbered forms of one name, trailing
   * colons, and the emoji headings 746 legacy Compass reports carry.
   * `partitionByRegistry` reads them so no consumer keeps its own regex — which
   * is how `TITLED_SECTION_CHARTS`, `SPLIT_ROUTES` and `sourceHeadings` became
   * three opinions about the same heading.
   *
   * **An alias is a heading a document uses as a SECTION. A sub-heading is
   * not an alias.** The legacy generator promotes its sub-headings to H2 —
   * `Strengths`, `Weaknesses`, `Opportunities` and `Threats` under SWOT;
   * `Market Commentary:` and `Yield Commentary:` under their sections; the
   * whole `11.1 …` / `15.1 …` family — and listing those here would make each
   * one OPEN a section, fragmenting one SWOT into four. They are absorbed by
   * `partitionByRegistry` into the section that was open when they appeared,
   * which puts them exactly where they belong and costs nothing.
   */
  aliases: readonly string[];
  /** Absent tier ⇒ excluded from that tier. */
  tiers: Partial<Record<ReportTier, TierPlacement>>;
  purpose: string;
}

// ─── Section ids ────────────────────────────────────────────────────────────

export const SECTION_IDS = [
  // the spine
  'identity',
  'verdict',
  'propertyIdentity',
  'keyFigures',
  'provenance',
  'assumptions',
  // location & market
  'locationCase',
  'infrastructure',
  'suburbCharacter',
  'marketPosition',
  'supplyPipeline',
  // demand
  'population',
  'socioeconomic',
  'employment',
  'tenantDemand',
  // amenity & access
  'amenityAccess',
  'education',
  'transport',
  // the property
  'propertyFit',
  'dwelling',
  'planning',
  // risk
  'riskDashboard',
  'environmentalRisk',
  'dueDiligenceChecklist',
  // the financial model
  'purchaseHolding',
  'rentalYield',
  'loan',
  'sensitivity',
  'tenYear',
  'scorecard',
  'swot',
  'exitStrategy',
  'suitability',
  'holdingStrategy',
  'monitoring',
  // the close
  'opportunities',
  'risks',
  'recommendation',
  // snapshot furniture
  'marketStats',
  'financialSnapshot',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

// ─── Producer refs, spelled once ────────────────────────────────────────────

/** An ordinal `composeFinancialChapters` emits; the spec runs it and checks. */
const composed = (ordinal: number): SectionProducer => ({
  kind: 'composed',
  ref: `financialChapters.pure.ts#${ordinal}`,
});

const composedFn = (fn: string): SectionProducer => ({
  kind: 'composed',
  ref: `scoreSections.pure.ts#${fn}`,
});

/** A named composer in a module other than `scoreSections`. */
const composedFrom = (file: string, fn: string): SectionProducer => ({
  kind: 'composed',
  ref: `${file}#${fn}`,
});

export type AuthoringGuide = 'condense.briefing' | 'condense.snapshot' | 'generator.compass';

const authored = (guide: AuthoringGuide): SectionProducer => ({ kind: 'authored', ref: guide });

const routed = (variant: 'financial' | 'dueDiligence', ordinal: number): SectionProducer => ({
  kind: 'routed',
  ref: `split.${variant}#${ordinal}`,
});

/**
 * A binding-projection namespace.
 *
 * The name before the dot must be one `applyInvestmentProjection` actually
 * merges — `property`, `financials`, `assumptions`, `recommendation`, `summary`,
 * `report`, `narrative`. The first draft of this file named `keyFigures.*` and
 * `sources.*`, neither of which exists, which is precisely the failure mode a
 * producer field is for: a structure definition asserting something is drawn by
 * machinery that was never written.
 */
const projection = (path: string): SectionProducer => ({ kind: 'projection', ref: path });

/**
 * The disclaimer `fork-investment-report` appends to both variants.
 *
 * Not routed and not authored — `renderVariantMarkdown` writes `## Disclaimer`
 * with the variant's own footer, unconditionally, which is why it is the one
 * heading on 11 of 11 financial and 11 of 11 strategic reports while six of
 * PLDD's declared sections are on one.
 */
const forkDisclaimer: SectionProducer = {
  kind: 'composed',
  ref: 'supabase/functions/fork-investment-report/index.ts#renderVariantMarkdown',
};

/** A section a tier folds into another one. Carries no heading and no producer. */
const merged = (into: SectionId): TierPlacement => ({
  depth: 'merged',
  mergedInto: into,
  producer: null,
});

// ─── The matrix ─────────────────────────────────────────────────────────────

export const SECTION_REGISTRY: readonly SectionDefinition[] = [
  // ── The spine ────────────────────────────────────────────────────────────
  {
    id: 'identity',
    canonicalLabel: 'Cover & report identity',
    provenance: 'recorded',
    aliases: ['Cover', 'Cover Page', 'Contents & Reading Guide', 'Client Reading Guide'],
    purpose:
      'Who issued it, what it is, which property, when. Drawn by the template on every tier — the model-written cover was excluded from Compass assembly in 2026-09 because it rendered as a second cover inside the body.',
    tiers: {
      compass: { depth: 'spine', order: 1, surface: 'document', producer: projection('report.*') },
      briefing: { depth: 'spine', order: 1, surface: 'document', producer: projection('report.*') },
      snapshot: { depth: 'spine', order: 1, surface: 'document', producer: projection('report.*') },
      financial: { depth: 'spine', order: 1, surface: 'document', producer: projection('report.*') },
      strategic: { depth: 'spine', order: 1, surface: 'document', producer: projection('report.*') },
    },
  },
  {
    id: 'keyFigures',
    canonicalLabel: 'Key figures',
    provenance: 'computed',
    aliases: [],
    purpose:
      'Price, rent, gross yield, weekly position — four Computed facts on the verdict page. Decision A of the framework keeps this on the Compass; detailed modelling stays in the Financial tier.',
    tiers: {
      compass: { depth: 'spine', order: 2, surface: 'document', producer: projection('financials.*') },
      briefing: { depth: 'spine', order: 2, surface: 'document', producer: projection('financials.*') },
      snapshot: { depth: 'spine', order: 2, surface: 'document', producer: projection('financials.*') },
      financial: { depth: 'spine', order: 2, surface: 'document', producer: projection('financials.*') },
      strategic: { depth: 'spine', order: 2, surface: 'document', producer: projection('financials.*') },
    },
  },
  {
    id: 'verdict',
    canonicalLabel: 'Executive Verdict',
    provenance: 'authored',
    aliases: [
      'Executive Verdict', 'Executive Summary', '1. Executive Summary', 'Overall Assessment',
      'Investment Recommendation', 'Investment Score',
      'Client Investment Decision Summary', 'Client Property & Location Snapshot',
    ],
    purpose:
      'The verdict first: the call, the score and grade, the coverage it rests on, and the two or three things that would change it.',
    tiers: {
      compass: { depth: 'spine', order: 3, label: 'Executive Verdict', producer: authored('generator.compass') },
      briefing: { depth: 'spine', order: 3, label: 'Executive Summary', producer: authored('condense.briefing') },
      // Composed, not asked of the model: the guide it replaces said
      // `Recommendation: [BUY/HOLD/SELL]` while the engine issues HOLD,
      // CAUTION, HOLD/BUY or BUY — SELL is never issued and CAUTION is never
      // offered, so answering the guide meant changing the verdict.
      snapshot: { depth: 'spine', order: 5, label: 'Investment Score', producer: composedFn('composeVerdictSection') },
      financial: { depth: 'spine', order: 3, label: 'Client Investment Decision Summary', producer: routed('financial', 1) },
      strategic: { depth: 'spine', order: 3, label: 'Client Property & Location Snapshot', producer: routed('dueDiligence', 1) },
    },
  },
  {
    id: 'propertyIdentity',
    canonicalLabel: 'Property & Locality Snapshot',
    provenance: 'recorded',
    aliases: [
      'Property & Locality Snapshot', 'Property Snapshot', 'Property-Level Information',
      '5. Property-Level Information', 'Locality Snapshot', 'Property Summary',
      'Property Overview', 'Property Snapshot — Non-Financial',
      'Core Property Facts & Physical Profile', 'Financial Input Snapshot',
    ],
    purpose:
      'The property as facts in a table — type, bed/bath/car, land, configuration, suburb, LGA. Recorded, never authored, and internally consistent everywhere it appears.',
    // MEASURED 2026-09-06, across all 1,199 stored reports. `property_specs`
    // carries nine attributes and the projection publishes all of them; six
    // have never held a value on any report:
    //
    //   property_type      1,071        parking              0
    //   bedrooms             651        year_built           0
    //   bathrooms            633        building_size_sqm    0
    //                                   land_size_sqm        0
    //                                   council_area         0
    //                                   zoning               0
    //
    // So this spine section is substantially empty on every document the
    // product has ever issued: `property.landArea`, `property.buildingArea`,
    // `property.yearBuilt`, `property.zoning` and `property.council` resolve to
    // nothing, and `configuration` renders without a car count because parking
    // is always absent. It is not a wiring fault — no table in the schema holds
    // residential land size, council area or zoning — so the fix is data the
    // platform does not acquire, upstream of the reporting engine.
    //
    // Recorded here rather than in a document because this is the section that
    // promises those rows, and law 2 is that a labelled row is a promise a
    // figure follows it.
    tiers: {
      compass: { depth: 'spine', order: 4, label: 'Property & Locality Snapshot', producer: authored('generator.compass') },
      briefing: { depth: 'spine', order: 4, surface: 'document', producer: projection('property.*') },
      snapshot: { depth: 'spine', order: 3, label: 'Property Summary', producer: authored('condense.snapshot') },
      financial: { depth: 'spine', order: 4, label: 'Financial Input Snapshot', producer: routed('financial', 2) },
      strategic: { depth: 'spine', order: 4, label: 'Core Property Facts & Physical Profile', producer: routed('dueDiligence', 2) },
    },
  },
  {
    id: 'provenance',
    canonicalLabel: 'Appendix, Source Notes & Disclaimer',
    provenance: 'recorded',
    aliases: [
      'Appendix, Source Notes & Disclaimer', 'PROFESSIONAL DISCLAIMER',
      '⚖️ PROFESSIONAL DISCLAIMER', 'Disclaimer', 'Source Appendix', 'Appendix',
      'Market Data Sources', 'Market Data Sources & Data Transparency',
      'Sources & Data Transparency', '13. Sources & Data Transparency', 'Data Sources',
      'Data Transparency Statement', 'SOURCES & REFERENCES', 'Disclaimer & Data Limitations',
    ],
    purpose:
      'What the document rests on and what it is not: sources with dates and the advice disclaimer. A source that was not used is omitted rather than listed.',
    tiers: {
      compass: { depth: 'spine', order: 90, label: 'Appendix, Source Notes & Disclaimer', producer: authored('generator.compass') },
      briefing: { depth: 'spine', order: 90, label: 'Market Data Sources', producer: authored('condense.briefing') },
      snapshot: { depth: 'spine', order: 11, label: 'Market Data Sources', producer: authored('condense.snapshot') },
      financial: { depth: 'spine', order: 21, label: 'Disclaimer', producer: forkDisclaimer },
      strategic: { depth: 'spine', order: 90, label: 'Disclaimer', producer: forkDisclaimer },
    },
  },
  {
    id: 'assumptions',
    canonicalLabel: 'Base Assumptions',
    provenance: 'recorded',
    aliases: [
      'Base Assumptions', 'Projection Assumptions', 'Financial Assumptions & Data Sources',
      'Assumptions, Verification Items & Adviser Disclaimer',
    ],
    purpose:
      'The inputs every figure rests on — growth, CPI, occupancy, rate — and the items a client must independently verify. Separate from the disclaimer because they answer different questions, and the Financial report carries both.',
    tiers: {
      compass: merged('provenance'),
      briefing: merged('provenance'),
      financial: { depth: 'required', order: 20, label: 'Assumptions, Verification Items & Adviser Disclaimer', producer: routed('financial', 17) },
    },
  },

  // ── Location & market ────────────────────────────────────────────────────
  {
    id: 'locationCase',
    canonicalLabel: 'Why This Location Matters',
    provenance: 'measured',
    aliases: [
      'Why This Location Matters', 'Location Overview', '1. Location Overview',
      'Position Within the Locality', 'Location & Demand', 'Growth Corridor',
      'Location & Profile', 'Suburb Profile',
    ],
    purpose: 'The case for the location itself: where it sits, what is changing, and why that matters to this purchase.',
    tiers: {
      compass: { depth: 'required', order: 5, label: 'Why This Location Matters', producer: authored('generator.compass') },
      briefing: { depth: 'required', order: 5, label: 'Location & Demand', producer: authored('condense.briefing') },
      // Carries the infrastructure pipeline, as 'Why This Location Matters' does on the Compass.
      strategic: { depth: 'required', order: 6, label: 'Position Within the Locality & Infrastructure Context', producer: routed('dueDiligence', 4) },
    },
  },
  {
    id: 'infrastructure',
    canonicalLabel: 'Infrastructure and Growth Context',
    provenance: 'measured',
    aliases: [
      'Infrastructure and Growth Context', 'Future Infrastructure',
      'Future Infrastructure & Growth Pipeline', 'Infrastructure & Development',
      'Infrastructure Pipeline',
      // `Supply & Development Pipeline` LEFT this list for `supplyPipeline`,
      // which is what that heading is actually about. It was claimed here and
      // as a sourceHeading of the Compass's DEMAND DRIVERS at the same time —
      // two registries disagreeing about where one heading goes, which
      // resolves to whichever is read first and loses the other silently.
    ],
    purpose: 'The committed and planned pipeline — what is funded, what is announced, and when each lands.',
    tiers: {
      /*
       * W2.2. Its own section on the Compass, no longer a timeline inside
       * `Why This Location Matters`.
       *
       * The merge was right when it was made and the rule that justified it is
       * the rule that ends it: *a section with nothing behind it should be
       * merged; a section with a register behind it should not.*
       * `infrastructureEvidence.pure.ts` and `nationalPipeline.pure.ts` answer
       * now, and the generator pins their table into every section call — so a
       * retrieved project had a source, a status word and a currency date, and
       * nowhere to be explained.
       *
       * Order 6 was the one gap in the Compass's declared sequence, and it is
       * where this belongs: the location case, then what is committed to it,
       * then who wants to live there.
       */
      compass: { depth: 'required', order: 6, label: 'Infrastructure and Growth Context', producer: authored('generator.compass') },
      briefing: merged('locationCase'),
      // Merged where the Compass USED to merge it. The briefing is four pages
      // and the strategic tier draws it inside `Position Within the Locality &
      // Infrastructure Context`, which is a real heading carrying it — neither
      // is the Compass's defect, so neither changes here.
      strategic: merged('locationCase'),
    },
  },
  {
    id: 'suburbCharacter',
    canonicalLabel: 'Suburb Character, Lifestyle & Occupier Appeal',
    provenance: 'measured',
    aliases: ['Suburb Character, Lifestyle & Occupier Appeal', 'Suburb Character & Lifestyle'],
    purpose: 'What living there is actually like, and who that appeals to.',
    tiers: {
      compass: merged('propertyFit'),
      briefing: merged('propertyFit'),
      // Merged where the Compass merges it — see `propertyFit`'s strategic placement.
      strategic: merged('propertyFit'),
    },
  },
  {
    id: 'marketPosition',
    canonicalLabel: 'Market Positioning',
    provenance: 'measured',
    aliases: [
      'Market Positioning', 'Market Position', 'Current Market Performance',
      'Current Market Performance (Q3/Q4 2025)', 'Market Analysis', 'Market Activity',
      'Market KPIs', '2. Market KPIs', 'Market Performance & Macro Demand',
      'Historical Price Growth Table', 'Historical Rent Growth Table',
      'Comparable Market Evidence', '8. Comparable Market Evidence',
      'Recent Comparable Sales', 'Recent Comparable Rentals', 'Price Trends & Growth',
      'Price, Rent & Yield Market Positioning',
      // Measured at H1 across the corpus 2026-09-07 (see `detectSectionLevel`):
      // the legacy 36-section document writes its market material as
      // `3. Historical Price Growth` / `4. Historical Rent Growth`, without the
      // `Table` suffix the registry already knew, on 577 and 575 reports. The
      // suffixed forms stay — they are the same section under the H2 cohort's
      // spelling.
      'Historical Price Growth', 'Historical Rent Growth',
      'Property Market Data', 'Market Performance',
    ],
    purpose: 'Where this property sits in its local market — medians, growth, days on market, and the comparables that anchor them.',
    tiers: {
      compass: { depth: 'required', order: 12, label: 'Market Positioning', producer: authored('generator.compass') },
      briefing: { depth: 'required', order: 7, label: 'Market Position', producer: authored('condense.briefing') },
      financial: { depth: 'required', order: 5, label: 'Price, Rent & Yield Market Positioning', producer: routed('financial', 3) },
      // The carrier, not the merged one: on the Compass `supplyPipeline` merges
      // INTO this section, and the strategic tier had the arrow the other way
      // round — so the Due Diligence document declared a supply-pipeline
      // section and the routing table sent Market Positioning to the Financial
      // report alone, leaving it empty.
      strategic: { depth: 'required', order: 18, label: 'Market Position, Competitive Landscape & Supply Pipeline', producer: routed('dueDiligence', 16) },
    },
  },
  {
    id: 'supplyPipeline',
    canonicalLabel: 'Competitive Landscape and Supply Pipeline',
    provenance: 'measured',
    aliases: [
      'Competitive Landscape and Supply Pipeline',
      // Taken from `infrastructure`, which held it while meaning something
      // else, and from the Compass registry's DEMAND DRIVERS, which held it at
      // the same time. A heading belongs to exactly ONE section.
      'Supply & Development Pipeline', 'Supply Pipeline', 'Competing Supply',
    ],
    purpose: 'What else is coming to market nearby, and what that does to this property’s position.',
    tiers: {
      /*
       * W2.2, and the section W3.1 was built for: `market_building_approvals`
       * holds the ABS's own monthly count of approved dwellings at this
       * property's SA2, and `approvalsFactBlocks` is pinned into every section
       * call. Before it, the statewide prompt carried `**Supply Pipeline
       * Risk:** [New housing supply vs demand balance]` — a bracketed slot
       * with no register behind it.
       *
       * It sits directly after `marketPosition` (12) and before the exit
       * outlook, which is the reading order a purchaser needs: where this
       * property sits, what will compete with it, then how easily it sells.
       * Everything from 13 down shifted by one to make the room.
       */
      compass: { depth: 'required', order: 13, label: 'Competitive Landscape and Supply Pipeline', producer: authored('generator.compass') },
      briefing: merged('marketPosition'),
      // The strategic tier draws it inside `Market Position, Competitive
      // Landscape & Supply Pipeline`, a heading that names it — unchanged.
      strategic: merged('marketPosition'),
    },
  },

  // ── Demand ───────────────────────────────────────────────────────────────
  // The Compass draws these four as one `Demand Drivers`; the Due Diligence
  // tier draws them separately. `population` carries the merged placement
  // because it is the heading the Compass's own registry gives it.
  {
    id: 'population',
    canonicalLabel: 'Demand Drivers',
    provenance: 'measured',
    aliases: [
      'Demand Drivers', 'Demographics & Demand Drivers', '3. Demographics & Demand Drivers',
      'Population & Household Characteristics', 'Population & Development Trends',
      'Population & Housing Demand', 'Population, Household Growth & Demographic Fit',
      'Demographics & Economics', 'Demographics, SEIFA, Employment & Demand',
      // The H1 cohort's own spellings, on 572 and 18 reports.
      'Demographic & Economic Data', 'Demographics',
    ],
    purpose: 'Who wants to live here and why — population, household formation and the demographic fit for this dwelling.',
    tiers: {
      compass: { depth: 'required', order: 7, label: 'Demand Drivers', producer: authored('generator.compass') },
      briefing: merged('locationCase'),
      // Carries socioeconomic, employment and tenant demand, as 'Demand Drivers' does on the Compass.
      strategic: { depth: 'required', order: 11, label: 'Population, Socioeconomics, Employment & Tenant Demand', producer: routed('dueDiligence', 9) },
    },
  },
  {
    id: 'socioeconomic',
    canonicalLabel: 'Socioeconomic Profile & SEIFA Interpretation',
    provenance: 'measured',
    aliases: ['Socioeconomic Profile & SEIFA Interpretation', 'Socioeconomic Profile'],
    purpose: 'SEIFA deciles read as what they mean for tenant quality, arrears risk and resale depth.',
    tiers: {
      compass: merged('population'),
      briefing: merged('locationCase'),
      // Merged where the Compass merges it — see `propertyFit`'s strategic placement.
      strategic: merged('population'),
    },
  },
  {
    id: 'employment',
    canonicalLabel: 'Employment, Income & Affordability Profile',
    provenance: 'measured',
    aliases: [
      'Employment, Income & Affordability Profile', 'Employment & Economic Linkages',
      'Major Industries & Job Growth', 'Employment & Industry Breakdown',
      'Job Growth Trends', 'Current Economic Context', 'Economic Context',
      'Population & Employment Statistics',
      'State Economic Overview',
    ],
    purpose: 'What people there do for a living, what they earn, and whether this price is affordable against it.',
    tiers: {
      compass: merged('population'),
      briefing: merged('locationCase'),
      // Merged where the Compass merges it — see `propertyFit`'s strategic placement.
      strategic: merged('population'),
    },
  },
  {
    id: 'tenantDemand',
    canonicalLabel: 'Tenant Demand and Occupier Personas',
    provenance: 'measured',
    aliases: [
      'Tenant Demand and Occupier Personas', 'Tenant & Buyer Profile',
      'Rental Market Deep Dive', 'Rental Market',
      'Vacancy Risk, Tenant Income & Rent Sustainability',
    ],
    purpose: 'Who rents here, what they will pay, and how exposed the rent is to them leaving.',
    tiers: {
      compass: merged('population'),
      briefing: merged('locationCase'),
      financial: { depth: 'required', order: 9, label: 'Vacancy Risk, Tenant Income & Rent Sustainability', producer: routed('financial', 7) },
      // Merged where the Compass merges it — see `propertyFit`'s strategic placement.
      strategic: merged('population'),
    },
  },

  // ── Amenity & access ─────────────────────────────────────────────────────
  {
    id: 'amenityAccess',
    canonicalLabel: 'Amenity & Access',
    provenance: 'measured',
    aliases: [
      'Amenity & Access', 'Amenity & Livability Matrix', 'Amenity Maturity & Daily Liveability',
      'Amenity Summary', 'Healthcare & Shopping', 'Retail, Healthcare & Lifestyle Amenity',
      'Recreational Amenities', 'Major Recreational Complexes', 'Recreation & Parks',
      'Shopping & Dining Facilities', 'Healthcare Facilities',
      'Infrastructure & Amenities', '4. Infrastructure & Amenities',
      'Amenities & Infrastructure', 'Location & Amenities',
      // `12. Amenity Scores`, on 578 reports — the most-carried heading in the
      // corpus that the registry could not name until the H1 half of it was
      // measured.
      'Amenity Scores',
    ],
    purpose: 'What is nearby and how good it is — retail, healthcare, recreation and everyday liveability.',
    tiers: {
      compass: { depth: 'required', order: 8, label: 'Amenity & Access', producer: authored('generator.compass') },
      briefing: { depth: 'required', order: 6, label: 'Amenity & Access', producer: authored('condense.briefing') },
      strategic: { depth: 'required', order: 8, label: 'Amenity Maturity & Daily Liveability', producer: routed('dueDiligence', 6) },
    },
  },
  {
    id: 'education',
    canonicalLabel: 'Schools & Education',
    provenance: 'measured',
    aliases: [
      'Schools & Education', 'Education & Family Amenity', 'Education & Family Demand',
      'Education Facilities', 'Education Infrastructure Summary',
    ],
    purpose: 'Catchments, the schools in them and what that does to family demand.',
    tiers: {
      compass: merged('amenityAccess'),
      briefing: merged('amenityAccess'),
      strategic: merged('amenityAccess'),
    },
  },
  {
    id: 'transport',
    canonicalLabel: 'Transport, Commute & Daily Movement',
    provenance: 'measured',
    aliases: [
      'Transport, Commute & Daily Movement', 'Transport & Accessibility',
      'Transport & Connectivity', 'Connectivity & Transport', 'Public Transport Network',
    ],
    purpose: 'Real commute times to the places people actually go, and what the road and rail plans change.',
    tiers: {
      // v4.0: its own section on the Compass. It was merged into a 600-word
      // Amenity & Access that also carried schools, healthcare, retail and
      // recreation — five sections and ~25,000 characters in the legacy
      // long-form document — so transport was a bullet. A section with
      // nothing behind it should be merged and one with a register behind it
      // should not; `transport_stops` carries 185,177 GTFS stops.
      compass: { depth: 'required', order: 9, label: 'Transport & Connectivity', producer: authored('generator.compass') },
      briefing: merged('amenityAccess'),
      strategic: { depth: 'required', order: 9, label: 'Transport, Commute & Daily Movement', producer: routed('dueDiligence', 7) },
    },
  },

  // ── The property ─────────────────────────────────────────────────────────
  {
    id: 'propertyFit',
    canonicalLabel: 'Property Fit Within the Suburb',
    provenance: 'authored',
    aliases: [
      'Property Fit Within the Suburb', 'Property Fit', 'Strategic Assessment',
      'Future Buyer and Resale Appeal', 'Investment Suitability Screening',
      'Key Strengths & Watch Points',
    ],
    purpose: 'How this dwelling aligns with local demand — position, land/build balance, occupier appeal and its limitations.',
    tiers: {
      compass: { depth: 'required', order: 15, label: 'Property Fit Within the Suburb', producer: authored('generator.compass') },
      briefing: { depth: 'required', order: 8, label: 'Property Fit', producer: authored('condense.briefing') },
      /*
       * The Due Diligence document mirrors the Compass's merges, because it
       * is MADE of the Compass.
       *
       * This placement is where that rule was clearest: `propertyFit` was
       * `routed('dueDiligence', 12)` as 'Future Buyer and Resale Appeal',
       * while the routing table sent the Compass's own 'Property Fit Within
       * the Suburb' to PLDD 3 — so one source section was claimed by two
       * declared sections, the route decided, and 12 stood empty for ever.
       *
       * Underneath that sat the real fault. The Due Diligence order still
       * described the PRE-v3.0 composite: measured 20 Sep 2026, SEVEN of its
       * seventeen declared sections could not be produced from a v4.0
       * Compass at all, because v4.0 merged their sources away
       * (`suburbCharacter` and `dwelling` into this section, `socioeconomic`,
       * `employment` and `tenantDemand` into Demand Drivers, `infrastructure`
       * into Why This Location Matters, `supplyPipeline` into Market
       * Positioning). A derived document cannot carry more sections than its
       * source offers, so each of the seven now merges exactly where the
       * Compass merged it, and the carrier's label names what it carries —
       * which is what the Compass did when `population` became 'Demand
       * Drivers'.
       *
       * Nothing is lost and nothing is invented: the prose was always inside
       * the carrier, and the only change is that the document stops promising
       * a heading its source cannot fill. The LEGACY routes are kept and
       * re-pointed rather than deleted, because a pre-v3.0 parent does still
       * write those headings and `assembleForVariant` now joins two routes
       * that name one slot instead of discarding one of them.
       */
      strategic: { depth: 'required', order: 5, label: 'Dwelling, Suburb Character & Occupier Appeal', producer: routed('dueDiligence', 3) },
    },
  },
  {
    id: 'dwelling',
    canonicalLabel: 'Dwelling Layout & Functional Fit',
    provenance: 'recorded',
    aliases: ['Dwelling Layout & Functional Fit'],
    purpose: 'The floor plan as a functional claim: layout, orientation, storage, and who the configuration suits.',
    tiers: {
      compass: merged('propertyFit'),
      briefing: merged('propertyFit'),
      // Merged where the Compass merges it — see `propertyFit`'s strategic placement.
      strategic: merged('propertyFit'),
    },
  },
  {
    id: 'planning',
    canonicalLabel: 'Planning, Zoning and Title Due Diligence',
    provenance: 'measured',
    aliases: [
      'Planning, Zoning and Title Due Diligence', 'Zoning', 'Planning', 'Property & Zoning',
      'Zoning & Planning Analysis',
      'Zoning, Planning and Development Considerations',
      'Planning, Zoning & What Is Mapped Over the Land',
      'Government Policy & Regulation',
    ],
    purpose:
      'Zone, overlays, easements, title, and what must be confirmed on the certificate before contract. On the Due Diligence tier this is the defining section — and nothing can currently produce it; see the gap below.',
    tiers: {
      // v4.0 — THE GAP DECLARED HERE IS CLOSED, and what closed it is worth
      // recording because the reasoning below was right when it was written.
      //
      // It read: "COMPOSITION cannot, because the record holds no planning
      // data. Measured across all 1,199 stored reports: `property_specs`
      // carries a `zoning` key on 1,071 of them and a zoning VALUE on
      // **zero** ... The platform does not acquire this data, so the fix is
      // upstream of the reporting engine and cannot be made here."
      //
      // The fix WAS made upstream. `planning-data-service` has answered since
      // 2026-09-06 and `planningConstraints.pure.ts` (17 Sep 2026) added the
      // registers that carry the controls themselves: NSW answers height,
      // floor space ratio, minimum lot size, heritage, bushfire, flood,
      // landslide and acid sulfate soils with the clause and currency date of
      // each; Victoria answers every overlay at the point; Queensland answers
      // the regional plan and the priority living areas; Tasmania answers both
      // overlay layers. The Compass therefore has a planning section (ordinal
      // 8 in `compassSectionRegistry`) and the routing this comment said could
      // not exist now has something to route.
      //
      // The strategic tier keeps `producer: null` on purpose: a Due Diligence
      // report's planning section also needs TITLE and easements, which no
      // register here reads. Half a section declared as a whole one is the
      // failure this registry exists to stop.
      compass: { depth: 'required', order: 10, label: 'Zoning, Planning and Development Considerations', producer: authored('generator.compass') },
      briefing: merged('riskDashboard'),
      strategic: { depth: 'required', order: 15, label: 'Planning, Zoning and Title Due Diligence', producer: null },
    },
  },

  // ── Risk ─────────────────────────────────────────────────────────────────
  {
    id: 'riskDashboard',
    canonicalLabel: 'Risk Dashboard',
    provenance: 'measured',
    aliases: [
      'Risk Dashboard', 'Risk Summary', 'Risk Assessment', '7. Risk Assessment',
      'Risk Overview', 'Key Risks Before Proceeding', 'Risk & Macro Factors',
      'Financial Risk Dashboard', 'Property & Location Risk Dashboard',
    ],
    purpose: 'Every risk in one table with a level, why it matters and the check that would settle it. Protected under page pressure.',
    tiers: {
      compass: { depth: 'required', order: 17, label: 'Risk Dashboard', producer: authored('generator.compass') },
      briefing: { depth: 'required', order: 9, label: 'Risk Overview', producer: authored('condense.briefing') },
      financial: { depth: 'required', order: 14, label: 'Financial Risk Dashboard', producer: routed('financial', 11) },
      strategic: { depth: 'required', order: 20, label: 'Property & Location Risk Dashboard', producer: routed('dueDiligence', 18) },
    },
  },
  {
    id: 'environmentalRisk',
    canonicalLabel: 'Climate, Environmental, Insurance, Crime and Safety Risk',
    provenance: 'measured',
    aliases: [
      'Climate, Environmental, Insurance, Crime and Safety Risk',
      'Environmental Risks & Climate', 'Environmental Risks', 'Environmental Risk',
      'Crime & Safety', 'Crime Statistics', 'Crime Breakdown by Category',
      'Crime Profile Analysis', 'Crime Trends', 'Climate Profile',
      'Climate Risk Commentary', 'Extreme Weather Risk Assessment',
      'Crime, Climate & Environmental Risk Register',
      // 446 and 17 reports at H1. `Crime Breakdown by Category` above is the
      // same section under the spelling the H2 cohort uses.
      'Crime Breakdown', 'Environmental & Risk Factors',
    ],
    purpose: 'Flood, bushfire, heat, coastal and crime — each with its source, its measured level and its insurance consequence.',
    tiers: {
      // v4.0: its own section. Climate, environment and crime were folded
      // into the Risk Dashboard, a 500-word table whose own purpose says "the
      // table IS the section", which had room for a row each. Four states of
      // recorded crime and a climate reading are behind it now.
      compass: { depth: 'required', order: 11, label: 'Environment, Climate & Safety', producer: authored('generator.compass') },
      briefing: merged('riskDashboard'),
      // 17, not 19: every strategic order is its PLDD ordinal + 2, and these
      // two had drifted into each other's places.
      strategic: { depth: 'required', order: 17, label: 'Climate, Environmental, Insurance, Crime and Safety Risk', producer: routed('dueDiligence', 15) },
    },
  },
  {
    id: 'dueDiligenceChecklist',
    canonicalLabel: 'Due Diligence Checklist',
    provenance: 'recorded',
    aliases: ['Due Diligence Checklist', 'Due Diligence', 'Investment Recommendations'],
    purpose: 'What must be verified before contract, as a list somebody can work through.',
    tiers: {
      compass: { depth: 'required', order: 18, label: 'Due Diligence Checklist', producer: authored('generator.compass') },
      /*
       * `required`, with a producer, from 20 Sep 2026.
       *
       * It was `optional` with `producer: null` — an honest record of what
       * the routing table did rather than a decision. `optional` is the one
       * depth `PRODUCER_GAPS` does not police, so the document defined by its
       * verification register declared that register's absence "not a
       * defect", and nothing asked. The route now gives it its own heading
       * and PLDD ordinal 18 instead of the risk dashboard's name.
       */
      strategic: { depth: 'required', order: 21, label: 'Due Diligence Checklist', producer: routed('dueDiligence', 19) },
    },
  },

  // ── The financial model ──────────────────────────────────────────────────
  // Every one of these is `composed` in the tiers that carry it as prose: typed
  // from `financial_calculations` through `reconcileStoredFinancials`, so a
  // chapter and a KPI tile cannot disagree about a number. Law 1.
  //
  // The Compass carries none of them — it is the location and property case,
  // and detailed modelling belongs to the Financial tier. That is a rule of the
  // Compass registry too, and both are now pinned to this one.
  //
  // **And so does the Briefing, from 18 Sep 2026 (S5/S6 §4).** It carried all
  // five, and that contradicted three statements this platform already made
  // about the same document — the sentence directly above, and both halves of
  // `TIER_CONTENT.briefing`: `financialModelling: false`, which withholds 32
  // bindings and drops three master pages, and a companion note printed on the
  // cover reading *"the financial position in the Financial Analysis Report"*.
  // So the templated pages withheld the modelling, the cover said it was in
  // another document, and the markdown body then printed it.
  //
  // Measured on row 89b451f6 (the retained Briefing) the five composed to
  // **3,156 characters over 73 table rows**, including the weekly repayment,
  // total interest over the term, the ten-year value/rent/cashflow/equity/LVR
  // series and the equity bridge. Four of the five are BYTE-IDENTICAL to the
  // Financial Analysis Report's; only `tenYear` differs, and only because
  // `scenarios: 'primary'` drops the alternate cases. That is not a condensed
  // financial position, it is the Financial report's own chapters inside a
  // second document — which is the test `TIER_FRAMEWORK` Decision E sets:
  // a reader could not name this document from its contents page.
  //
  // The Briefing keeps the ASSESSMENT — the score breakdown and the SWOT —
  // because that is what it is for, and the price and indicative rent still
  // reach it through `identityFigures`. Nothing is lost that is not named on
  // its own cover. Stored Briefings are untouched: this decides what the next
  // one contains, never what an issued one said.
  {
    id: 'purchaseHolding',
    canonicalLabel: 'Purchase Costs & Annual Holding Cost Breakdown',
    provenance: 'computed',
    aliases: [
      'Purchase Costs & Annual Holding Cost Breakdown', 'Purchase & Ongoing Costs (Annual)',
      'Purchase & Ongoing Costs', 'Costs for Investors', '6. Costs for Investors',
      'Cost Breakdown Analysis',
      // The legacy Compass's section 9 is one container over costs, yield, loan
      // and cashflow. It resolves to the head of the group it contains, the
      // same way the Compass's merged `Demand Drivers` resolves to `population`.
      'Financial Analysis',
    ],
    purpose: 'What it costs to buy and what it costs to hold, per year, from the recorded calculation.',
    tiers: {
      financial: { depth: 'required', order: 6, label: 'Purchase Costs & Annual Holding Cost Breakdown', producer: composed(4) },
    },
  },
  {
    id: 'rentalYield',
    canonicalLabel: 'Rental Assessment, Gross Yield & Net Yield',
    provenance: 'computed',
    aliases: [
      'Rental Assessment, Gross Yield & Net Yield', 'Rental Assessment & Yield Calculation',
      'Gross & Net Yield Calculation',
    ],
    purpose: 'Rent, gross yield and net yield after the holding costs above.',
    tiers: {
      financial: { depth: 'required', order: 7, label: 'Rental Assessment, Gross Yield & Net Yield', producer: composed(5) },
    },
  },
  {
    id: 'loan',
    canonicalLabel: 'Loan Structure, Repayments & Cashflow Impact',
    provenance: 'computed',
    aliases: [
      'Loan Structure, Repayments & Cashflow Impact', 'Loan Structure & Repayment Analysis',
      'Loan Analysis (P&I and Interest-Only)', 'LVR Projections', 'Cashflow Analysis',
      'Projected Loan-to-Value Ratio (LVR) - Year 10',
      // The legacy document splits the loan across three H1 sections, 574
      // reports each. `Interest-Only Loan` is deliberately bare so the
      // qualifier rule reaches `Interest-Only Loan (First 5 Years)`; the cost is
      // that the same words used as a colon sub-heading on 17 reports open a
      // second `loan` occurrence, which the storage step carries in document
      // order rather than merging.
      'Principal & Interest Loan', 'Interest-Only Loan', 'Final Loan-to-Value Ratio (LVR)',
    ],
    purpose: 'Loan size, LVR, repayments on both structures, and the weekly position that falls out of them.',
    tiers: {
      financial: { depth: 'required', order: 8, label: 'Loan Structure, Repayments & Cashflow Impact', producer: composed(6) },
    },
  },
  {
    id: 'sensitivity',
    canonicalLabel: 'Sensitivity & Scenario Testing',
    provenance: 'computed',
    aliases: [
      'Sensitivity & Scenario Testing', 'Sensitivity Analysis', 'Interest Rate Sensitivity',
      'Structural Cashflow Deficit',
      // The legacy generator's own longer spellings of the same two sections.
      // Not reachable by the qualifier rule, which deliberately refuses a bare
      // space as a separator.
      'Interest Rate Sensitivity and Debt Serviceability Pressure',
      'Structural Cashflow Deficit Requiring Ongoing Investor Capital Support',
    ],
    purpose: 'What a rate move or a rent move does to the position — the recorded grid, not a re-derivation.',
    tiers: {
      financial: { depth: 'required', order: 10, label: 'Sensitivity & Scenario Testing', producer: composed(8) },
    },
  },
  {
    id: 'tenYear',
    canonicalLabel: '10-Year Cashflow, Equity & Growth Projection',
    provenance: 'computed',
    aliases: [
      '10-Year Cashflow, Equity & Growth Projection', '10-Year Investment Projections',
      '10-Year Projection Scenarios', '10. 10-Year Projection Scenarios',
      '10-Year Projection Commentary', 'Property Value Projections',
      'Rental Income Projections', 'Cumulative Cashflow Projections',
      'Capital Appreciation Potential', 'Leveraged Equity Accumulation',
      'Leveraged Equity Accumulation Through Debt Reduction',
      // `Projection Assumptions` was here AND on `assumptions`, whose entry
      // comes first — so it has always resolved there and this list silently
      // lost it. A heading belongs to exactly one section; removing the
      // duplicate changes no resolution (asserted over all 251 aliases) and
      // removes the trap.
    ],
    purpose: 'Value, rent, cashflow and equity year by year under the recorded scenarios.',
    tiers: {
      financial: { depth: 'required', order: 11, label: '10-Year Cashflow, Equity & Growth Projection', producer: composed(9) },
    },
  },
  {
    id: 'exitStrategy',
    canonicalLabel: 'Resale Liquidity & Exit Outlook',
    provenance: 'computed',
    aliases: [
      'Resale Liquidity & Exit Outlook', 'Resale Liquidity & Exit Strategy', 'Equity & Exit Scenarios',
      'Resale Liquidity',
      // Written by the model on the 97 Poole Road Compass of 20 Sep 2026 as a
      // section of its own, fourteen pages before the composed one. An alias
      // is how this registry says "that is this section under another name",
      // and without it the heading resolved to NOTHING — so the fork dropped
      // it from both children and nothing could see it was a second copy.
      'Exit Outlook', 'Exit Strategy',
    ],
    purpose:
      'Two questions answered from two kinds of evidence: how deep the market an exit would be tested against is '
      + '(measured, from a published register) and what the position looks like at year five and year ten '
      + '(modelled, under the recorded growth rate). The measured half reaches the Compass; the modelled half is '
      + 'the Financial report\'s.',
    tiers: {
      compass: { depth: 'required', order: 14, label: 'Resale Liquidity & Exit Outlook', producer: composedFrom('strategyPositions.pure.ts', 'composeExitOutlook') },
      financial: { depth: 'required', order: 13, label: 'Resale Liquidity & Exit Strategy', producer: composedFrom('strategyPositions.pure.ts', 'composeExitOutlook') },
      /*
       * The Due Diligence document carries it too, from 20 Sep 2026 — and
       * carries a DIFFERENT half of it.
       *
       * This was the last Compass section routed nowhere: the Financial
       * report composes its own copy and the split registry matched no
       * pattern for 'resale liquidity' or 'exit outlook', so the strategic
       * tier had no placement at all and the document said nothing about
       * exit. `composeExitOutlook` is built in two halves and already knows
       * the difference — "what the market recorded" is cited register
       * evidence, and the equity path at year five and ten is a projection.
       * The fork composes this one from a record with `finance: null`, so
       * the modelled half prints its own sentence saying it belongs to the
       * Financial Analysis Report, which is the branch
       * `carriesModelling: false` has always taken on the Compass.
       *
       * Same composer, one implementation, and the tier decides what it may
       * say — rather than a second exit section written for this document.
       */
      strategic: { depth: 'required', order: 19, label: 'Resale Liquidity & Exit Outlook', producer: composedFrom('strategyPositions.pure.ts', 'composeExitOutlook') },
    },
  },
  {
    id: 'scorecard',
    canonicalLabel: 'Investment Score Breakdown',
    provenance: 'computed',
    aliases: [
      'Investment Score Breakdown', 'Investment Score Analysis', 'Score Breakdown',
      'Score Breakdown (simplified)', 'Overall Investment Score', '11. Overall Investment Score',
      'Macro Investment Scorecard', 'Financial Investment Scorecard',
      'Investment Score & SWOT', 'Investment Score & Hotspot Identification',
    ],
    purpose:
      'The score by dimension with its weights — every row a Computed figure, and a dimension with no data omitted rather than scored zero.',
    tiers: {
      compass: { depth: 'optional', order: 21, surface: 'document', producer: projection('recommendation.gradedDetailLine') },
      briefing: { depth: 'required', order: 16, label: 'Investment Score Breakdown', producer: composedFn('composeScoreBreakdownSection') },
      // Composed: the guide listed all five dimensions with no omission rule
      // beside it, and the record withholds the ones it could not score.
      snapshot: { depth: 'required', order: 6, label: 'Score Breakdown', producer: composedFn('composeScoreDimensionsSection') },
      financial: { depth: 'required', order: 15, label: 'Financial Investment Scorecard', producer: composed(12) },
    },
  },
  {
    id: 'swot',
    canonicalLabel: 'SWOT Analysis',
    provenance: 'computed',
    aliases: ['SWOT Analysis', 'SWOT Analysis Summary', 'Financial SWOT: Returns, Risk & Holding Capacity'],
    purpose:
      'Strengths, weaknesses, opportunities and threats — every entry naming the recorded figure or register '
      + 'reading it rests on, and an absence appearing as coverage rather than in a quadrant. Never re-authored. '
      + 'The Compass draws the location and market half; the modelling half travels only to the Financial report.',
    tiers: {
      compass: { depth: 'required', order: 16, label: 'SWOT Analysis', producer: composedFrom('strategyPositions.pure.ts', 'composeSwot') },
      briefing: { depth: 'required', order: 17, label: 'SWOT Analysis', producer: composedFn('composeSwotSection') },
      financial: { depth: 'required', order: 17, label: 'Financial SWOT: Returns, Risk & Holding Capacity', producer: composed(14) },
    },
  },
  {
    id: 'suitability',
    canonicalLabel: 'Investor Suitability Profile',
    provenance: 'computed',
    aliases: [
      'Investor Suitability Profile',
      // The 97 Poole Road Compass wrote it under the short name. It resolves
      // now so the Financial report's fork can route it and so QA can say
      // which document it belongs to; it stays OUT of the Compass, which is
      // where it was written.
      'Suitability Profile',
    ],
    purpose:
      'What holding this asset REQUIRES — capital at settlement, weekly contribution, room for the rate to move, '
      + 'vacancy tolerance, horizon. It describes the asset and never a person: no report here is given anybody\'s '
      + 'circumstances, so the match is stated as not assessed rather than implied.',
    tiers: {
      financial: { depth: 'required', order: 16, label: 'Investor Suitability Profile', producer: composedFrom('strategyPositions.pure.ts', 'composeSuitability') },
    },
  },
  {
    id: 'holdingStrategy',
    canonicalLabel: 'Holding Strategy',
    provenance: 'computed',
    aliases: ['Holding Strategy', 'Hold Strategy & Decision Points'],
    purpose:
      'The base case, what has to keep holding for it, and the points at which a decision is actually owed — the '
      + 'break-even rent, the end of an interest-only term, the lending ratio that gates a refinance. Suitability '
      + 'says what the asset demands; this says what to do about it across the hold.',
    tiers: {
      financial: { depth: 'required', order: 18, label: 'Holding Strategy', producer: composedFrom('strategyPositions.pure.ts', 'composeHoldingStrategy') },
    },
  },
  {
    id: 'monitoring',
    canonicalLabel: 'Monitoring & Review Plan',
    provenance: 'computed',
    aliases: [
      'Monitoring & Review Plan', 'Review & Monitoring Plan', 'What to Re-check and When',
      // Same document, same cause. See `exitStrategy`.
      'Monitoring Plan',
    ],
    purpose:
      'Every register this report was built from, how often its publisher republishes, what it said on the day, '
      + 'and what a different answer would mean. It belongs to the two EVIDENCE documents; the Financial report '
      + 'carries the same duty inside its holding strategy\'s "what would break it", so no reader meets the list '
      + 'twice. It never promises that this platform watches anything.',
    tiers: {
      compass: { depth: 'required', order: 19, label: 'Monitoring & Review Plan', producer: composedFrom('strategyPositions.pure.ts', 'composeMonitoringPlan') },
      strategic: { depth: 'required', order: 22, label: 'Monitoring & Review Plan', producer: composedFrom('strategyPositions.pure.ts', 'composeMonitoringPlan') },
    },
  },

  // ── The close ────────────────────────────────────────────────────────────
  {
    id: 'opportunities',
    canonicalLabel: 'Top 3 Opportunities',
    provenance: 'authored',
    aliases: ['Top 3 Opportunities', 'Top 3 Investment Opportunities', 'Key Opportunities & Risks', '12. Key Opportunities & Risks'],
    purpose: 'The three things that could go better than the base case, each in a sentence or two.',
    tiers: {
      briefing: { depth: 'required', order: 18, label: 'Top 3 Opportunities', producer: authored('condense.briefing') },
      snapshot: { depth: 'required', order: 8, label: 'Top 3 Opportunities', producer: authored('condense.snapshot') },
    },
  },
  {
    id: 'risks',
    canonicalLabel: 'Top 3 Risks',
    provenance: 'authored',
    aliases: ['Top 3 Risks', 'Top 3 Investment Risks'],
    purpose: 'The three things most likely to go worse, each with what would show it early.',
    tiers: {
      briefing: { depth: 'required', order: 19, label: 'Top 3 Risks', producer: authored('condense.briefing') },
      snapshot: { depth: 'required', order: 9, label: 'Top 3 Risks', producer: authored('condense.snapshot') },
    },
  },
  {
    id: 'recommendation',
    canonicalLabel: 'Final Recommendation',
    provenance: 'authored',
    aliases: [
      'Final Recommendation', 'Final Conclusion', 'Recommendation', 'Quick Recommendation',
      'Financial Recommendation', 'Financial Recommendation & Portfolio Fit',
    ],
    purpose: 'The call, the rationale in a paragraph, and the immediate actions. Proceed / proceed with caution / not suitable.',
    tiers: {
      compass: { depth: 'required', order: 20, label: 'Final Recommendation', producer: authored('generator.compass') },
      briefing: { depth: 'required', order: 20, label: 'Recommendation', producer: authored('condense.briefing') },
      snapshot: { depth: 'required', order: 10, label: 'Quick Recommendation', producer: authored('condense.snapshot') },
      financial: { depth: 'required', order: 19, label: 'Financial Recommendation & Portfolio Fit', producer: routed('financial', 16) },
      // `required` from 20 Sep 2026: the recommendation route is `both` now,
      // so this document ends on the call rather than on its risk dashboard.
      // Every other tier carried one; this tier's `optional`/null was the
      // routing table's omission written down, not a decision about the
      // document.
      strategic: { depth: 'required', order: 23, label: 'Final Recommendation', producer: routed('dueDiligence', 21) },
    },
  },

  // ── Snapshot furniture ───────────────────────────────────────────────────
  {
    id: 'marketStats',
    canonicalLabel: 'Key Market Stats',
    provenance: 'measured',
    aliases: ['Key Market Stats', 'Key Highlights'],
    purpose:
      'A short metric table — median price, yield, vacancy, growth, days on market, walk score. Only metrics whose value is known: a labelled row is a promise that a figure follows it.',
    tiers: {
      snapshot: { depth: 'required', order: 4, label: 'Key Market Stats', producer: authored('condense.snapshot') },
    },
  },
  {
    id: 'financialSnapshot',
    canonicalLabel: 'Financial Snapshot',
    provenance: 'computed',
    aliases: ['Financial Snapshot'],
    purpose: 'Price, weekly rent, gross and net yield, annual cashflow and the ten-year value — from the recorded figures only.',
    tiers: {
      snapshot: { depth: 'required', order: 7, label: 'Financial Snapshot', producer: composedFrom('financialChapters.pure.ts', 'composeFinancialSnapshotSection') },
    },
  },
];

// ─── The frozen gap list ────────────────────────────────────────────────────

/**
 * `tier:sectionId` pairs a tier promises and nothing yet produces.
 *
 * Keyed by tier and section the way `edge-missing-names.txt` is keyed by file
 * and identifier, and for the same reason: a count baseline absorbs a
 * regression as long as something else is fixed in the same commit. A NEW gap
 * fails the spec; closing one means deleting its line, so the list can only
 * shrink.
 *
 * It is empty — every `spine` and `required` placement names a producer that
 * resolves. That is a statement about the DECLARATION, and the corpus says
 * something separate and worse: the `routed` producers for the Due Diligence
 * tier's planning, tenant-demand, resale, infrastructure and supply sections
 * exist and are correct, and still put `Planning, Zoning and Title Due
 * Diligence` on 1 of 11 documents — because routing depends on the *parent*
 * carrying a heading the rule can match, and the Compass parent carries its
 * planning content merged inside Risk Dashboard. Phase 3 removes that
 * dependency by assembling from stored sections instead of re-reading a sibling
 * document; law 4 is the rule it is enforcing.
 */
export const PRODUCER_GAPS: readonly string[] = [
  // The Due Diligence tier's defining section, with nothing able to produce it.
  // Routing cannot (the Compass parent folds planning into Risk Dashboard, so
  // there is no section to route) and composition cannot (the record holds no
  // planning data: a zoning VALUE on 0 of 1,199 reports, `council_area` and
  // `land_size_sqm` present-but-empty on every row, and no planning, zoning,
  // overlay, title or environmental key anywhere in `location_intelligence`).
  // No table in the schema carries residential zoning either, so this is a data
  // the platform does not acquire, and the fix is upstream of the reporting
  // engine. See the placement in `planning` for the full measurement.
  'strategic:planning',
];

// ─── Readers ────────────────────────────────────────────────────────────────

const byId = new Map<SectionId, SectionDefinition>(SECTION_REGISTRY.map((s) => [s.id, s]));

export function section(id: SectionId): SectionDefinition {
  const found = byId.get(id);
  // Unreachable from TypeScript; this catches a JavaScript caller.
  if (!found) throw new Error(`Unknown report section id: ${id}`);
  return found;
}

export interface PlacedSection {
  id: SectionId;
  definition: SectionDefinition;
  placement: TierPlacement;
  /** The heading this tier gives it, or the canonical label. */
  label: string;
  order: number;
  surface: Surface;
}

/**
 * Every section a tier draws — spine, required and optional — in tier order.
 *
 * Merged sections are absent: their substance is inside the section named by
 * `mergedInto`, and returning them would make a caller draw a heading the tier
 * deliberately does not have.
 */
export function sectionsForTier(tier: ReportTier): PlacedSection[] {
  return SECTION_REGISTRY.flatMap((definition) => {
    const placement = definition.tiers[tier];
    if (!placement || placement.depth === 'merged') return [];
    return [{
      id: definition.id,
      definition,
      placement,
      label: placement.label ?? definition.canonicalLabel,
      order: placement.order ?? 0,
      surface: placement.surface ?? 'markdown',
    }];
  }).sort((a, b) => a.order - b.order);
}

/**
 * The headings a tier's `report_content` may carry, in order.
 *
 * This is what `trimToDeclaredSections` is handed. Sections drawn by the
 * template (`surface: 'document'`) are excluded, because they never appear as a
 * `##` heading and listing them would make the trim keep prose the tier does
 * not want.
 */
export function markdownHeadingsForTier(tier: ReportTier): string[] {
  return sectionsForTier(tier).filter((s) => s.surface === 'markdown').map((s) => s.label);
}

/**
 * The subset of those a MODEL is expected to write.
 *
 * Separate from the whole list because the two behave differently under a trim:
 * the composed chapters are appended by us and therefore always match, so
 * "something survived the trim" is satisfied by our own output and says nothing
 * about whether the model followed the guide. A briefing whose prose was
 * entirely discarded is financial tables with no case attached to them, and
 * that is the state worth refusing to ship.
 */
export function authoredHeadingsForTier(tier: ReportTier): string[] {
  return sectionsForTier(tier)
    .filter((s) => s.surface === 'markdown' && s.placement.producer?.kind === 'authored')
    .map((s) => s.label);
}

/** The five spine sections, in tier order. Never empty, on any tier. */
export function spineForTier(tier: ReportTier): PlacedSection[] {
  return sectionsForTier(tier).filter((s) => s.placement.depth === 'spine');
}

/** Sections a tier folds into another, with the section that carries each. */
export function mergesForTier(tier: ReportTier): Array<{ id: SectionId; into: SectionId }> {
  return SECTION_REGISTRY.flatMap((definition) => {
    const placement = definition.tiers[tier];
    return placement?.depth === 'merged' && placement.mergedInto
      ? [{ id: definition.id, into: placement.mergedInto }]
      : [];
  });
}

/**
 * Strip a heading down to what identifies it.
 *
 * Case, a leading ordinal, a leading emoji and a trailing colon all vary across
 * the corpus for the same section — `1. Location Overview`, `⚖️ PROFESSIONAL
 * DISCLAIMER` and `Market Commentary:` are bare headings with decoration — and
 * every consumer that rolled its own normalisation counted them separately.
 *
 * An ordinal is EITHER multi-level (`11.1 `) OR punctuated (`9. `, `12) `), and
 * never a bare number followed by a space. The first version required the
 * punctuation, so `9. Financial Analysis` normalised and `11.1 Public Transport
 * Network` did not — and the legacy generator numbers its sub-sections in
 * exactly that second style, which cost 3.5 points of instance coverage on its
 * own. Simply making the punctuation optional goes too far the other way and
 * eats the leading number of a real name: `2026 Market Review` would normalise
 * to `market review`. No corpus heading has that shape today, which is why it
 * is worth closing now rather than after one does.
 */
export function normaliseHeading(heading: string): string {
  return (heading || '')
    .replace(/^[^\p{Letter}\p{Number}]+/u, '')
    .replace(/^(?:\d+(?:\.\d+)+|\d+[.)])\s+/, '')
    .replace(/\s*:\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const aliasIndex = new Map<string, SectionId>();
for (const definition of SECTION_REGISTRY) {
  const names = [definition.canonicalLabel, ...definition.aliases];
  for (const placement of Object.values(definition.tiers)) {
    if (placement.label) names.push(placement.label);
  }
  for (const name of names) {
    const key = normaliseHeading(name);
    // First declaration wins. Several sections legitimately share an alias —
    // `Investment Recommendations` is the Compass's due-diligence checklist and
    // reads as the briefing's recommendation — and silently reassigning it to
    // whichever section was declared last is how a routing table develops an
    // opinion nobody wrote down. Declaration order is the tie-break, and the
    // spec prints the collisions so they stay deliberate.
    if (key && !aliasIndex.has(key)) aliasIndex.set(key, definition.id);
  }
}

/**
 * Aliases longest-first, so a qualified heading matches the most specific name.
 *
 * `Sensitivity Analysis (interest rate, rent, vacancy)` must resolve through
 * `Sensitivity Analysis` and not through some shorter alias that also happens to
 * prefix it. Sorting once here is what makes the qualifier rule below safe.
 */
const aliasesByLength = [...aliasIndex.keys()].sort((a, b) => b.length - a.length);

/**
 * A known name followed by a parenthetical or dashed qualifier.
 *
 * The corpus is full of these — `Property Value Projections (AUD)`, `Cashflow
 * Analysis - Interest-Only Scenario (Year 1)`, `Education Facilities (Extended
 * List)` — and they are the same section as the bare name with a unit, a
 * scenario or a scope bolted on. Worth 4.0 points of instance coverage.
 *
 * The separator must be a bracket or a dash with a space around it, never a
 * bare space: `Market Positioning` prefixes `Market Position` and matching on a
 * space alone would let any section swallow a longer, different one.
 */
function qualifiedMatch(normalised: string): SectionId | null {
  for (const alias of aliasesByLength) {
    if (
      normalised.startsWith(`${alias} (`) ||
      normalised.startsWith(`${alias} - `) ||
      normalised.startsWith(`${alias} – `) ||
      normalised.startsWith(`${alias} — `) ||
      normalised.startsWith(`${alias}: `)
    ) {
      return aliasIndex.get(alias) ?? null;
    }
  }
  return null;
}

/**
 * Which section a heading belongs to, or null.
 *
 * Exact match after normalisation, then the qualifier rule. **Null is a real
 * answer and callers must handle it** — measured over the 1,199-row corpus,
 * 966 distinct H2 headings resolve to 38 sections, and the residue is not
 * noise: it is the legacy generator's SUB-headings promoted to H2
 * (`Strengths`, `Market Commentary:`, `15.1 Loan Assumptions`) plus furniture
 * that is not a section at all (`📞 CONTACT US`, on 761 reports). See
 * `partitionByRegistry` for the rule that keeps them.
 */
export function sectionIdForHeading(heading: string): SectionId | null {
  const key = normaliseHeading(heading);
  return aliasIndex.get(key) ?? qualifiedMatch(key);
}

/** Every normalised heading the registry knows, with the section that owns it. */
export function knownHeadings(): ReadonlyMap<string, SectionId> {
  return aliasIndex;
}

// ─── Partitioning a stored document by section ──────────────────────────────

/**
 * Whether a heading's own numbering says it is a SUB-heading.
 *
 * The legacy generator numbers top-level sections `1.` … `13.` and their
 * sub-sections `11.1`, `15.1`, `4.2`. That depth is real information and the
 * normaliser throws it away, which matters because a sub-heading's *text* often
 * resolves perfectly well: `11.1 Public Transport Network` reduces to `public
 * transport network`, a genuine alias of `transport`. Treating it as a section
 * would cut the parent section in half at that point.
 *
 * So depth decides, and text does not get a vote: two or more levels is a
 * sub-heading, whatever it says.
 */
export function isSubHeadingByNumbering(heading: string): boolean {
  return /^\s*\d+\.\d+[.)]?\s+/.test(heading || '');
}

export interface PartitionedSection {
  id: SectionId;
  /** The heading as the document actually spelled it. */
  heading: string;
  /** Everything under it, including any unrecognised sub-headings. */
  body: string;
}

export interface DocumentPartition {
  /** Anything before the first recognised section — a title block, usually. */
  preamble: string;
  sections: PartitionedSection[];
  /**
   * Unrecognised headings AT the section level, with the section that absorbed
   * each. Never dropped. Headings deeper than the section level are ordinary
   * sub-structure and are not reported — the corpus averages 36 H3s a
   * document, so reporting them would bury the signal this field exists for.
   */
  absorbed: Array<{ heading: string; into: SectionId | null }>;
  /** The heading level this document uses for its sections. See `detectSectionLevel`. */
  level: SectionHeadingLevel;
}

/** Markdown heading level at which a document names its sections. */
export type SectionHeadingLevel = 1 | 2;

export interface SectionLevelVerdict {
  level: SectionHeadingLevel;
  /** Registry sections resolved at each candidate level. */
  resolved: Record<SectionHeadingLevel, number>;
}

/**
 * Decide which heading level a document uses for its sections, by asking which
 * level's headings actually resolve to registry sections.
 *
 * **This exists because the corpus is bimodal and the first version of the
 * partition only saw half of it.** Measured across all 1,192 stored reports
 * carrying content (2026-09-07):
 *
 * | cohort | reports | avg H1 | avg H2 | avg H3 |
 * |---|---|---|---|---|
 * | H2-poor | 698 (58.6%) | **33.2** | 1.8 | 2.0 |
 * | H2-rich | 494 (41.4%) | 9.8 | 19.2 | 36.3 |
 *
 * The H2-poor majority writes its sections as H1 — `# 1. Location Overview`
 * through `# 36. Demographic & Economic Data` — and carries at most a
 * `## 📞 CONTACT US` / `## ⚖️ PROFESSIONAL DISCLAIMER` pair at H2. A partition
 * hard-coded to `##` finds **zero** sections in those documents and returns the
 * entire report as preamble, which is indistinguishable from a report with no
 * structure at all. 51.8% of the corpus has furniture-only H2s and a further
 * 6.2% has no H2 whatsoever.
 *
 * Resolution count is the signal rather than heading count: H3 sub-headings
 * outnumber sections in the H2-rich cohort, so "most headings" would pick the
 * wrong level. A tie resolves to 2, which preserves the behaviour every
 * document verified before this measurement relied on.
 */
export function detectSectionLevel(markdown: string): SectionLevelVerdict {
  const resolved: Record<SectionHeadingLevel, number> = { 1: 0, 2: 0 };
  for (const line of (markdown || '').split('\n')) {
    const m = /^(#{1,2})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (!m) continue;
    const level = (m[1].length === 1 ? 1 : 2) as SectionHeadingLevel;
    const text = m[2];
    if (isSubHeadingByNumbering(text)) continue;
    if (sectionIdForHeading(text)) resolved[level] += 1;
  }
  return { level: resolved[1] > resolved[2] ? 1 : 2, resolved };
}

/**
 * Split a stored `report_content` into registry sections.
 *
 * **An unrecognised heading is content belonging to the section above it, never
 * a section and never a deletion.** That rule is the whole design, and it is
 * forced by measurement rather than chosen: of 966 distinct H2 headings in the
 * corpus, resolution reaches 68.2% of instances, and essentially all of the
 * remainder are sub-headings the legacy generator emitted at H2 — `Strengths`,
 * `Weaknesses`, `Opportunities`, `Market Commentary:`, `15.1 Cashflow
 * Commentary`, `11.1 Public Transport Network`. A partition that dropped what
 * it could not name would discard nearly a third of every legacy document.
 *
 * The same rule is why this returns `absorbed`: an unrecognised heading is
 * kept, and also *reported*, so a new one showing up in production is visible
 * rather than silently swallowed.
 *
 * Text before the first recognised heading is the preamble — legacy documents
 * open with an H1 title block and often a `📞 CONTACT US` H2, and attributing
 * those to whichever section happens to follow would put marketing furniture
 * inside a client's verdict.
 *
 * **A section id may appear more than once, and repeats are kept in order.**
 * Measured on production briefing `89b451f6`: 29 headings resolving to 21
 * distinct sections, with `marketPosition` four times, `tenYear` three times,
 * and `loan`, `scorecard` and `environmentalRisk` twice each — the legacy
 * document spreads one section across several headings. Collapsing them here
 * would silently reorder a client's document and merge bodies that were written
 * apart; whether to fold them, and how, is a decision for the storage step that
 * consumes this, not for the reader that splits the text.
 *
 * Verified against four real documents spanning both engines and three tiers
 * (39.6k, 48.4k, 14.4k and 51.6k characters): every one round-trips with its
 * non-whitespace content conserved exactly.
 */
export function partitionByRegistry(
  markdown: string,
  forceLevel?: SectionHeadingLevel,
): DocumentPartition {
  // The level is a property of the document, not a constant. Hard-coding `##`
  // is what made the first version blind to 59% of the corpus.
  const level = forceLevel ?? detectSectionLevel(markdown).level;
  const headingAtLevel = level === 1 ? /^#[ \t]+(.+?)[ \t]*$/ : /^##[ \t]+(.+?)[ \t]*$/;

  const lines = (markdown || '').split('\n');
  const sections: PartitionedSection[] = [];
  const absorbed: DocumentPartition['absorbed'] = [];
  const preamble: string[] = [];
  let current: { id: SectionId; heading: string; body: string[] } | null = null;

  for (const line of lines) {
    const at = headingAtLevel.exec(line);
    if (at) {
      // Numbering outranks text. `11.1 Public Transport Network` resolves to
      // `transport` on its words alone, and opening a section there would split
      // section 11 in two at its own sub-heading.
      const id = isSubHeadingByNumbering(at[1]) ? null : sectionIdForHeading(at[1]);
      if (id) {
        if (current) sections.push({ id: current.id, heading: current.heading, body: current.body.join('\n').trim() });
        current = { id, heading: at[1], body: [] };
        continue;
      }
      // Unrecognised at the section level: keep the heading where it stands,
      // inside whatever is open, and report it so a genuinely new section
      // heading is visible rather than silently swallowed.
      absorbed.push({ heading: at[1], into: current?.id ?? null });
      (current ? current.body : preamble).push(line);
      continue;
    }
    // Everything else — prose, tables, and headings at any other level — is
    // content of the section that is open. A `##` inside an H1-sectioned
    // document is sub-structure, not a section.
    (current ? current.body : preamble).push(line);
  }
  if (current) sections.push({ id: current.id, heading: current.heading, body: current.body.join('\n').trim() });

  return { preamble: preamble.join('\n').trim(), sections, absorbed, level };
}
