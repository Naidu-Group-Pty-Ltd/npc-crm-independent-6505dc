/**
 * Composite → Fork Split Registry
 * --------------------------------
 * Source of truth for how a composite Investment Report's H2 sections are
 * routed and re-titled when forked into the two client-facing variants:
 *
 *   1. Client Investment Feasibility & Financial Performance Report  (FIN)
 *   2. Property & Location Due Diligence Report                       (PLDD)
 *
 * The composite registry (compassSectionRegistry.ts) is unchanged — composite
 * generation continues as the single source of truth. This module only
 * controls the deterministic split applied AFTER generation by the
 * `fork-investment-report` edge function.
 *
 * Frontend mirror: src/lib/reports/reportSplitRegistry.ts — keep in sync.
 *
 * Routing rule semantics
 *   - target: 'financial'      → emit only into FIN
 *   - target: 'due_diligence'  → emit only into PLDD
 *   - target: 'both'           → emit into both, with the variant-specific
 *                                heading and a lens hint pre-pended
 *   - rule:   'verbatim'       → keep section body unchanged
 *             'financial_lens' → prepend the financial lens framing line
 *             'property_lens'  → prepend the property/DD lens framing line
 *             'summarise_only' → cap to first ~200 words + "see other report"
 *             'drop'           → omit entirely
 */

export type ForkVariant = 'financial' | 'due_diligence';
export type SplitTarget = ForkVariant | 'both';
export type ReframeRule =
  | 'verbatim'
  | 'financial_lens'
  | 'property_lens'
  | 'summarise_only'
  | 'drop';

export interface SplitRoute {
  /** Lowercase pattern matched against the composite H2 heading text. */
  match: string[];
  target: SplitTarget;
  /** Heading title used in the FIN report (when target is 'financial' or 'both'). */
  newHeadingFinancial?: string;
  /** Heading title used in the PLDD report (when target is 'due_diligence' or 'both'). */
  newHeadingDueDiligence?: string;
  /** Ordinal in FIN (1-based). */
  ordinalFinancial?: number;
  /** Ordinal in PLDD (1-based). */
  ordinalDueDiligence?: number;
  /** How to transform the body. */
  rule: ReframeRule;
  notes?: string;
}

// ─── FIN report structure (Report 1 — 17 sections) ──────────────────────────
export const FIN_REPORT_TITLE = 'Client Investment Feasibility & Financial Performance Report';
export const FIN_REPORT_SUBTITLE =
  'Cashflow, lending, yield, sensitivity, projections and portfolio suitability assessment.';

export const FIN_SECTION_ORDER: { ordinal: number; heading: string }[] = [
  { ordinal: 1,  heading: 'Client Investment Decision Summary' },
  { ordinal: 2,  heading: 'Financial Input Snapshot' },
  { ordinal: 3,  heading: 'Price, Rent & Yield Market Positioning' },
  { ordinal: 4,  heading: 'Purchase Costs & Annual Holding Cost Breakdown' },
  { ordinal: 5,  heading: 'Rental Assessment, Gross Yield & Net Yield' },
  { ordinal: 6,  heading: 'Loan Structure, Repayments & Cashflow Impact' },
  { ordinal: 7,  heading: 'Vacancy Risk, Tenant Income & Rent Sustainability' },
  { ordinal: 8,  heading: 'Sensitivity & Scenario Testing' },
  { ordinal: 9,  heading: '10-Year Cashflow, Equity & Growth Projection' },
  { ordinal: 10, heading: 'Resale Liquidity & Exit Strategy' },
  { ordinal: 11, heading: 'Financial Risk Dashboard' },
  { ordinal: 12, heading: 'Financial Investment Scorecard' },
  { ordinal: 13, heading: 'Investor Suitability Profile' },
  { ordinal: 14, heading: 'Financial SWOT: Returns, Risk & Holding Capacity' },
  /*
   * 15 is new. Suitability (13) says what the asset demands and the SWOT (14)
   * balances it; the Holding Strategy says what to DO about it across the
   * hold — the base case, the break-even rent, the end of an interest-only
   * term, the lending ratio that gates a refinance. It goes before the
   * recommendation because a recommendation that has not said how the thing is
   * held is a verdict with no plan under it.
   *
   * Inserted here rather than appended, and only the two ordinals after it
   * moved, because every `composed(N)` and `routed('financial', N)` in
   * `sectionRegistry.pure.ts` is this list's ordinal and a wholesale renumber
   * would have touched seven of them for no gain.
   */
  { ordinal: 15, heading: 'Holding Strategy' },
  { ordinal: 16, heading: 'Financial Recommendation & Portfolio Fit' },
  { ordinal: 17, heading: 'Assumptions, Verification Items & Adviser Disclaimer' },
];

// ─── PLDD report structure (Report 2 — 15 sections) ─────────────────────────
export const PLDD_REPORT_TITLE = 'Property & Location Due Diligence Report';
export const PLDD_REPORT_SUBTITLE =
  'Property fundamentals, suburb profile, tenant demand, planning context and local risk assessment.';

export const PLDD_SECTION_ORDER: { ordinal: number; heading: string }[] = [
  /*
   * Fifteen sections, and the six ordinals that are missing are missing on
   * purpose.
   *
   * This list described the PRE-v3.0 composite, which wrote a separate
   * heading for suburb character, SEIFA, employment, tenant demand,
   * infrastructure and the supply pipeline. The v4.0 Compass merges every one
   * of those into another section, so measured on 20 Sep 2026 SEVEN of the
   * seventeen declared here could not be produced from a current parent at
   * all: they were slots a document could only ever leave empty.
   *
   * A derived document cannot carry more sections than its source offers, so
   * each merges exactly where the Compass merged it and the carrier's heading
   * names what it now carries. The gaps at 5, 8, 10, 11, 12 and 14 are left
   * rather than renumbered, for the reason `FIN_SECTION_ORDER` gives at its
   * own 15: every `routed('dueDiligence', N)` in `sectionRegistry.pure.ts` is
   * one of these ordinals, and a wholesale renumber would touch them all for
   * no gain.
   *
   * The legacy ROUTES are kept and re-pointed rather than deleted, because a
   * pre-v3.0 parent — and there are 1,199 stored reports — does still write
   * those headings, and `assembleForVariant` joins two routes that name one
   * slot instead of discarding one.
   */
  { ordinal: 1,  heading: 'Client Property & Location Snapshot' },
  /*
   * 1.5, composed. The document's own opening argument — what kind of
   * purchase the land use table makes this, how the market has moved, what
   * supply it meets, what decides it — so the chapters below read as its
   * evidence. Between two ordinals rather than a renumber, for the reason the
   * gaps below are kept: every `routed('dueDiligence', N)` is one of these.
   */
  { ordinal: 1.5, heading: 'The Opportunity in Strategic Terms' },
  { ordinal: 2,  heading: 'Core Property Facts & Physical Profile' },
  { ordinal: 3,  heading: 'Dwelling, Suburb Character & Occupier Appeal' },
  { ordinal: 4,  heading: 'Position Within the Locality & Infrastructure Context' },
  { ordinal: 6,  heading: 'Amenity Maturity & Daily Liveability' },
  { ordinal: 7,  heading: 'Transport, Commute & Daily Movement' },
  { ordinal: 9,  heading: 'Population, Socioeconomics, Employment & Tenant Demand' },
  { ordinal: 13, heading: 'Planning, Zoning and Title Due Diligence' },
  { ordinal: 15, heading: 'Climate, Environmental, Insurance, Crime and Safety Risk' },
  { ordinal: 16, heading: 'Market Position, Competitive Landscape & Supply Pipeline' },
  /*
   * 17 is new, and it is the last Compass section that was routed nowhere.
   *
   * The Financial report composes its own exit section WITH the modelled
   * equity path. This document gets the same composer with no finance on the
   * record, so it carries what the sales register recorded — the settled
   * count, the median, the length of the series, each cited — and says
   * plainly that days on market, time to sell and buyer depth are not held.
   * That is a due-diligence fact rather than modelling, which is why it may
   * sit in a tier declaring `financialModelling: false`.
   *
   * It goes here, straight after the market section it reads from and before
   * the risk register, so the four ordinals below it each moved by one. That
   * is a renumber `FIN_SECTION_ORDER`'s own 15 warns against — but the
   * warning is about the `routed(…, N)` refs in `sectionRegistry.pure.ts`,
   * there are three of them here, and a spec now fails when a route's ordinal
   * and this list's disagree. Appending it after the recommendation would
   * have put the resale case after the document's own conclusion.
   */
  { ordinal: 17, heading: 'Resale Liquidity & Exit Outlook' },
  { ordinal: 18, heading: 'Property & Location Risk Dashboard' },
  /*
   * 18-20 are new, and they are the document's own purpose.
   *
   * `tierContent.pure.ts` has said since the tier existed that the strategic
   * document carries `dueDiligenceRegister: true`, and its standfirst calls
   * it "the verification register". This list stopped at 17, so a section
   * routed anywhere past it had no slot: the checklist was pointed at the
   * risk dashboard's heading and de-duplicated away, and the recommendation
   * went to the Financial report alone. Measured on a real fork, the Due
   * Diligence document carried neither.
   *
   * The order matches `sectionRegistry`'s `strategic` placements (20, 21, 22)
   * so the two statements of this document's shape cannot disagree — which is
   * what the drift at FIN 15 cost.
   */
  { ordinal: 19, heading: 'Due Diligence Checklist' },
  { ordinal: 20, heading: 'Monitoring & Review Plan' },
  { ordinal: 21, heading: 'Final Recommendation' },
];

// ─── Lens framing strings ───────────────────────────────────────────────────
export const FIN_LENS_PREAMBLE =
  '_Reading this through a financial lens — focus on contribution, yield, repayments, serviceability and exit. The full property and locality narrative lives in the **Property & Location Due Diligence Report**._';

export const PLDD_LENS_PREAMBLE =
  '_Reading this through a property and locality lens — focus on liveability, planning, demand and resale appeal. The full cashflow, lending and projection modelling lives in the **Client Investment Feasibility & Financial Performance Report**._';

// ─── Per-variant footers / disclaimers ──────────────────────────────────────
export const FIN_FOOTER_DISCLAIMER =
  'This Financial Performance Report contains indicative figures based on assumptions disclosed in the Assumptions & Verification section. Numbers are subject to client-specific verification by a licensed mortgage broker, accountant and conveyancer before any commitment. This document is not personal financial product advice.';

export const PLDD_FOOTER_DISCLAIMER =
  'This Due Diligence Report summarises publicly available property, locality, planning, demographic and risk information at the time of writing. All items flagged for verification must be independently confirmed (planning certificate, title, overlays, building inspection, insurance) before contract. This document is not legal or financial advice.';

// ─── Routing table (composite H2 → variant routing) ─────────────────────────
// match[] entries are lowercased substring matches applied to the H2 heading.
// First matching rule wins, so order is meaningful.

export const SPLIT_ROUTES: SplitRoute[] = [
  // ── Executive / verdict ──
  {
    match: ['executive summary', 'executive verdict', 'executive strengths', 'overall recommendation', 'overall assessment', 'investment recommendation'],
    target: 'both',
    newHeadingFinancial: 'Client Investment Decision Summary',
    newHeadingDueDiligence: 'Client Property & Location Snapshot',
    ordinalFinancial: 1,
    ordinalDueDiligence: 1,
    rule: 'verbatim',
    notes: 'Replaces generic executive content — both reports lead with a tailored summary.',
  },

  // ── Property snapshot / core facts ──
  {
    match: ['property snapshot', 'property-level information', 'property & locality snapshot', 'property and locality snapshot', 'core property facts'],
    target: 'both',
    newHeadingFinancial: 'Financial Input Snapshot',
    newHeadingDueDiligence: 'Core Property Facts & Physical Profile',
    ordinalFinancial: 2,
    ordinalDueDiligence: 2,
    rule: 'verbatim',
  },
  {
    match: ['dwelling layout', 'functional fit', 'property fit within the suburb', 'property fit'],
    target: 'due_diligence',
    newHeadingDueDiligence: 'Dwelling, Suburb Character & Occupier Appeal',
    ordinalDueDiligence: 3,
    rule: 'property_lens',
  },

  // ── Locality / position ──
  {
    match: ['position within', 'road access', 'why this location matters', 'location overview'],
    target: 'due_diligence',
    newHeadingDueDiligence: 'Position Within the Locality & Infrastructure Context',
    ordinalDueDiligence: 4,
    rule: 'property_lens',
  },
  {
    match: ['suburb character', 'community identity', 'lifestyle', 'retail, healthcare & lifestyle amenity'],
    target: 'due_diligence',
    // Merged away on a v4.0 Compass; the route is kept and re-pointed at the
    // carrier, because a legacy parent still writes this heading.
    newHeadingDueDiligence: 'Dwelling, Suburb Character & Occupier Appeal',
    ordinalDueDiligence: 3,
    rule: 'property_lens',
  },

  // ── Amenity / education / healthcare ──
  {
    // 'amenity & access' is the v3.0 merged section (education + retail/health/
    // lifestyle + transport). It already matches on 'amenity'; the transport
    // rule below is now unreachable for the merged heading, which is correct —
    // one source section cannot feed two PLDD sections.
    match: ['amenity & access', 'amenity', 'education', 'schools', 'healthcare', 'parks', 'community facilities', 'education & family amenity'],
    target: 'due_diligence',
    newHeadingDueDiligence: 'Amenity Maturity & Daily Liveability',
    ordinalDueDiligence: 6,
    rule: 'property_lens',
  },

  // ── Transport ──
  {
    match: ['transport', 'commute', 'public transport', 'connectivity & transport', 'transport & connectivity'],
    target: 'due_diligence',
    newHeadingDueDiligence: 'Transport, Commute & Daily Movement',
    ordinalDueDiligence: 7,
    rule: 'property_lens',
  },

  // ── Socioeconomic / SEIFA ──
  {
    match: ['seifa', 'socioeconomic', 'tenant & buyer profile', 'demographics & demand drivers'],
    target: 'due_diligence',
    // Merged away on a v4.0 Compass; the route is kept and re-pointed at the
    // carrier, because a legacy parent still writes this heading.
    newHeadingDueDiligence: 'Population, Socioeconomics, Employment & Tenant Demand',
    ordinalDueDiligence: 9,
    rule: 'property_lens',
  },

  // ── Population / household ──
  {
    /*
     * 'demand drivers' is the v3.0 merged section (population + tenant/buyer +
     * employment). It matched no rule before this line, and
     * `routeCompositeSection` returning null drops a section from both derived
     * variants without a word.
     *
     * `target: 'both'` finishes that catch-up. `tenantDemand` declares
     * 'Vacancy Risk, Tenant Income & Rent Sustainability' as `required` on
     * the financial tier at FIN 7, and its only source on a v4.0 Compass is
     * this merged section — so with the Due Diligence half fixed and the
     * Financial half left behind, FIN 7 was the eighth slot nothing could
     * fill. Who rents here and how exposed the rent is to them leaving is a
     * financial question as much as a locational one; it is the same prose
     * read through the other lens, which is what `rule` and the two headings
     * are for.
     */
    match: ['demand drivers', 'population', 'household', 'demographic', 'population & housing demand'],
    target: 'both',
    newHeadingFinancial: 'Vacancy Risk, Tenant Income & Rent Sustainability',
    newHeadingDueDiligence: 'Population, Socioeconomics, Employment & Tenant Demand',
    ordinalFinancial: 7,
    ordinalDueDiligence: 9,
    rule: 'property_lens',
  },

  // ── Employment / income ──
  {
    match: ['employment', 'job growth', 'income', 'employment & economic linkages', 'employment hubs'],
    target: 'both',
    newHeadingFinancial: 'Vacancy Risk, Tenant Income & Rent Sustainability',
    // Merged away on a v4.0 Compass; the route is kept and re-pointed at the
    // carrier, because a legacy parent still writes this heading.
    newHeadingDueDiligence: 'Population, Socioeconomics, Employment & Tenant Demand',
    ordinalFinancial: 7,
    ordinalDueDiligence: 9,
    rule: 'verbatim',
    notes: 'Same employment data, two lenses — financial framing for FIN, demand framing for PLDD.',
  },

  // ── Tenant persona ──
  {
    match: ['target tenant', 'tenant persona', 'tenant stickiness', 'occupier personas', 'primary and secondary tenant'],
    target: 'due_diligence',
    // Merged away on a v4.0 Compass; the route is kept and re-pointed at the
    // carrier, because a legacy parent still writes this heading.
    newHeadingDueDiligence: 'Population, Socioeconomics, Employment & Tenant Demand',
    ordinalDueDiligence: 9,
    rule: 'property_lens',
  },

  // ── Future buyer / resale ──
  {
    match: ['future buyer', 'buyer comparison', 'resale appeal'],
    target: 'both',
    newHeadingFinancial: 'Resale Liquidity & Exit Strategy',
    // `propertyFit`'s purpose already covers occupier appeal and it is the
    // carrier now, so a legacy parent's separate heading joins it there.
    newHeadingDueDiligence: 'Dwelling, Suburb Character & Occupier Appeal',
    ordinalFinancial: 10,
    ordinalDueDiligence: 3,
    rule: 'verbatim',
  },

  // ── Planning / zoning ──
  {
    match: ['planning', 'zoning', 'overlay', 'covenant', 'title'],
    target: 'due_diligence',
    newHeadingDueDiligence: 'Planning, Zoning and Title Due Diligence',
    ordinalDueDiligence: 13,
    rule: 'property_lens',
  },

  // ── Infrastructure / growth ──
  {
    match: ['infrastructure', 'growth corridor', 'future infrastructure', 'suburb/corridor context'],
    target: 'due_diligence',
    // Merged away on a v4.0 Compass; the route is kept and re-pointed at the
    // carrier, because a legacy parent still writes this heading.
    newHeadingDueDiligence: 'Position Within the Locality & Infrastructure Context',
    ordinalDueDiligence: 4,
    rule: 'property_lens',
  },

  // ── Environmental / climate / crime ──
  {
    match: ['climate', 'environmental', 'bushfire', 'flood', 'crime', 'safety', 'insurance'],
    target: 'due_diligence',
    newHeadingDueDiligence: 'Climate, Environmental, Insurance, Crime and Safety Risk',
    ordinalDueDiligence: 15,
    rule: 'property_lens',
  },

  // ── Supply / competitive ──
  {
    match: ['competitive landscape', 'supply pipeline', 'supply & development pipeline'],
    target: 'due_diligence',
    // Merged away on a v4.0 Compass; the route is kept and re-pointed at the
    // carrier, because a legacy parent still writes this heading.
    newHeadingDueDiligence: 'Market Position, Competitive Landscape & Supply Pipeline',
    ordinalDueDiligence: 16,
    rule: 'property_lens',
  },

  // ── Risk dashboard split ──
  {
    match: ['risk dashboard', 'risk summary', 'key risks before proceeding'],
    target: 'both',
    newHeadingFinancial: 'Financial Risk Dashboard',
    newHeadingDueDiligence: 'Property & Location Risk Dashboard',
    ordinalFinancial: 11,
    ordinalDueDiligence: 18,
    rule: 'verbatim',
    notes: 'Same source dashboard, two views — FIN keeps financial rows, PLDD keeps property/location rows.',
  },

  // ── FIN-only: market positioning / rental ──
  {
    /*
     * Both documents. The Compass merges `supplyPipeline` INTO Market
     * Positioning, and the Due Diligence document declares a competitive
     * landscape section — so routing this to the Financial report alone left
     * that section with no possible source on any current parent. What each
     * document takes from it differs by lens, which is what `rule` is for.
     */
    match: ['market positioning', 'how the property sits in the local market', 'current market performance', 'market analysis'],
    target: 'both',
    newHeadingFinancial: 'Price, Rent & Yield Market Positioning',
    newHeadingDueDiligence: 'Market Position, Competitive Landscape & Supply Pipeline',
    ordinalFinancial: 3,
    ordinalDueDiligence: 16,
    rule: 'financial_lens',
  },
  {
    match: ['purchase & ongoing costs', 'purchase and ongoing costs'],
    target: 'financial',
    newHeadingFinancial: 'Purchase Costs & Annual Holding Cost Breakdown',
    ordinalFinancial: 4,
    rule: 'financial_lens',
  },
  {
    match: ['rental assessment', 'yield calculation'],
    target: 'financial',
    newHeadingFinancial: 'Rental Assessment, Gross Yield & Net Yield',
    ordinalFinancial: 5,
    rule: 'financial_lens',
  },
  {
    match: ['loan structure', 'repayment analysis'],
    target: 'financial',
    newHeadingFinancial: 'Loan Structure, Repayments & Cashflow Impact',
    ordinalFinancial: 6,
    rule: 'financial_lens',
  },
  {
    match: ['sensitivity analysis', 'interest rate sensitivity', 'structural cashflow deficit', 'scenario testing'],
    target: 'financial',
    newHeadingFinancial: 'Sensitivity & Scenario Testing',
    ordinalFinancial: 8,
    rule: 'financial_lens',
  },
  {
    match: ['10-year investment projection', 'capital appreciation potential', 'leveraged equity', '10-year cashflow'],
    target: 'financial',
    newHeadingFinancial: '10-Year Cashflow, Equity & Growth Projection',
    ordinalFinancial: 9,
    rule: 'financial_lens',
  },
  {
    match: ['investor suitability', 'who this property suits'],
    target: 'financial',
    newHeadingFinancial: 'Investor Suitability Profile',
    ordinalFinancial: 13,
    rule: 'financial_lens',
  },
  {
    match: ['swot analysis', 'swot'],
    target: 'financial',
    newHeadingFinancial: 'Financial SWOT: Returns, Risk & Holding Capacity',
    ordinalFinancial: 14,
    rule: 'financial_lens',
  },
  /*
   * Both documents carry the call.
   *
   * This was `target: 'financial'`, so the Due Diligence report — the only
   * document a buyer reads before contract — ended on its risk dashboard with
   * nothing telling them what to do about it, and `sectionRegistry`'s
   * `strategic` placement honestly recorded the consequence as
   * `depth: 'optional', producer: null`. Every other tier carries a
   * recommendation; this one was not a decision, it was the routing table's
   * omission written down.
   *
   * The FIN ordinal is 16 and not 15. `FIN_SECTION_ORDER` gained `Holding
   * Strategy` at 15, which moved this to 16 and the verification page to 17,
   * and the three ordinals below were left where they were — so the routed
   * recommendation arrived at the composed Holding Strategy's ordinal and
   * `mergeComposedChapters`, which evicts a routed section by ORDINAL, deleted
   * it. Measured: with a strategy record present the Financial Analysis Report
   * had no recommendation at all, and `replacedByComposedChapters` named it.
   */
  {
    match: ['financial recommendation', 'final recommendation', 'final conclusion'],
    target: 'both',
    newHeadingFinancial: 'Financial Recommendation & Portfolio Fit',
    newHeadingDueDiligence: 'Final Recommendation',
    ordinalFinancial: 16,
    ordinalDueDiligence: 21,
    rule: 'verbatim',
  },

  /*
   * The checklist is the Due Diligence report's own section, not a second
   * name for its risk dashboard.
   *
   * It used to carry `newHeadingDueDiligence: 'Property & Location Risk
   * Dashboard'` — the heading the risk route already uses — and
   * `assembleForVariant` de-duplicates by HEADING, keeping the longer body.
   * So the parent's verification list was not merely retitled, it was
   * DELETED: driven through the real fork, `- [ ] Obtain a s.10.7 planning
   * certificate` reached the Financial report and reached nothing at all in
   * the document whose own footer says every flagged item "must be
   * independently confirmed … before contract".
   */
  {
    match: ['due diligence checklist', 'due diligence'],
    target: 'both',
    newHeadingFinancial: 'Assumptions, Verification Items & Adviser Disclaimer',
    newHeadingDueDiligence: 'Due Diligence Checklist',
    ordinalFinancial: 17,
    ordinalDueDiligence: 19,
    rule: 'verbatim',
  },

  /*
   * Disclaimer / appendix — the Financial report's verification page only.
   *
   * The Due Diligence side of this route was the third section pointed at
   * 'Property & Location Risk Dashboard', so the parent's source notes were
   * destroyed by the same de-duplication (measured: `ABS Census 2021 (read
   * 7 Aug 2026)` reached neither document). It is not routed to the Due
   * Diligence report at all now, because that document does not lack the
   * material: `provenance`'s `strategic` placement composes its disclaimer
   * (`PLDD_FOOTER_DISCLAIMER`) and the fork copies the parent's
   * `sources_content` onto the child as its own column. Routing it here as
   * well put a disclaimer under a risk dashboard's name.
   */
  {
    match: ['professional disclaimer', 'disclaimer', 'source appendix', 'appendix'],
    target: 'financial',
    newHeadingFinancial: 'Assumptions, Verification Items & Adviser Disclaimer',
    ordinalFinancial: 17,
    rule: 'verbatim',
  },
];

export interface RoutingDecision {
  route: SplitRoute | null;
  matchedHeading: string;
}

export function routeCompositeSection(heading: string): RoutingDecision {
  const norm = (heading || '').toLowerCase().trim().replace(/^#+\s*/, '');
  for (const route of SPLIT_ROUTES) {
    for (const pattern of route.match) {
      if (norm.includes(pattern)) return { route, matchedHeading: heading };
    }
  }
  return { route: null, matchedHeading: heading };
}

/** Normalise structural numbering glitches (e.g. TOC "01 Executive Strengths" vs body "01 Executive Summary"). */
export function normaliseStructuralHeading(raw: string): string {
  return raw.replace(/^\s*\d+\s*[—\-:.]?\s*/, '').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// DB-overlay loader
// ─────────────────────────────────────────────────────────────────────────────
// Constants above are fallback defaults. At runtime the loader reads
// report_engine_config rows (config_key='split_routes' / 'split_metadata' /
// 'split_section_order_fin' / 'split_section_order_pldd') and overlays them on
// top. Agent edits these via staged proposals → inspector apply_proposal
// upserts into report_engine_config. No new table required.

// deno-lint-ignore-file no-explicit-any
export interface LoadedSplitRegistry {
  routes: SplitRoute[];
  finSectionOrder: { ordinal: number; heading: string }[];
  plddSectionOrder: { ordinal: number; heading: string }[];
  finTitle: string;
  finSubtitle: string;
  plddTitle: string;
  plddSubtitle: string;
  finLensPreamble: string;
  plddLensPreamble: string;
  finFooter: string;
  plddFooter: string;
  source: { routes: 'default' | 'db'; metadata: 'default' | 'db'; section_orders: 'default' | 'db' };
  routeCompositeSection: (heading: string) => RoutingDecision;
}

function makeRouter(routes: SplitRoute[]) {
  return (heading: string): RoutingDecision => {
    const norm = (heading || '').toLowerCase().trim().replace(/^#+\s*/, '');
    for (const route of routes) {
      for (const pattern of route.match) {
        if (norm.includes(pattern)) return { route, matchedHeading: heading };
      }
    }
    return { route: null, matchedHeading: heading };
  };
}

export async function loadSplitRegistry(supabase: any): Promise<LoadedSplitRegistry> {
  let routes: SplitRoute[] = SPLIT_ROUTES;
  let finOrder = FIN_SECTION_ORDER;
  let plddOrder = PLDD_SECTION_ORDER;
  let finTitle = FIN_REPORT_TITLE;
  let finSubtitle = FIN_REPORT_SUBTITLE;
  let plddTitle = PLDD_REPORT_TITLE;
  let plddSubtitle = PLDD_REPORT_SUBTITLE;
  let finLens = FIN_LENS_PREAMBLE;
  let plddLens = PLDD_LENS_PREAMBLE;
  let finFooter = FIN_FOOTER_DISCLAIMER;
  let plddFooter = PLDD_FOOTER_DISCLAIMER;
  const source: LoadedSplitRegistry['source'] = { routes: 'default', metadata: 'default', section_orders: 'default' };

  try {
    const { data } = await supabase
      .from('report_engine_config')
      .select('config_key, value')
      .in('config_key', ['split_routes', 'split_metadata', 'split_section_order_fin', 'split_section_order_pldd']);

    for (const row of (data as any[]) ?? []) {
      if (row.config_key === 'split_routes' && Array.isArray(row.value)) {
        const valid = (row.value as any[]).filter((r) => r && Array.isArray(r.match) && typeof r.target === 'string' && typeof r.rule === 'string');
        if (valid.length) { routes = valid as SplitRoute[]; source.routes = 'db'; }
      } else if (row.config_key === 'split_section_order_fin' && Array.isArray(row.value)) {
        finOrder = row.value as any[]; source.section_orders = 'db';
      } else if (row.config_key === 'split_section_order_pldd' && Array.isArray(row.value)) {
        plddOrder = row.value as any[]; source.section_orders = 'db';
      } else if (row.config_key === 'split_metadata' && row.value && typeof row.value === 'object') {
        const m = row.value as any;
        if (typeof m.fin_title === 'string') finTitle = m.fin_title;
        if (typeof m.fin_subtitle === 'string') finSubtitle = m.fin_subtitle;
        if (typeof m.pldd_title === 'string') plddTitle = m.pldd_title;
        if (typeof m.pldd_subtitle === 'string') plddSubtitle = m.pldd_subtitle;
        if (typeof m.fin_lens_preamble === 'string') finLens = m.fin_lens_preamble;
        if (typeof m.pldd_lens_preamble === 'string') plddLens = m.pldd_lens_preamble;
        if (typeof m.fin_footer === 'string') finFooter = m.fin_footer;
        if (typeof m.pldd_footer === 'string') plddFooter = m.pldd_footer;
        source.metadata = 'db';
      }
    }
  } catch (e) {
    console.warn('[reportSplitRegistry] DB overlay failed, using defaults:', (e as Error).message);
  }

  return {
    routes,
    finSectionOrder: finOrder,
    plddSectionOrder: plddOrder,
    finTitle, finSubtitle, plddTitle, plddSubtitle,
    finLensPreamble: finLens,
    plddLensPreamble: plddLens,
    finFooter, plddFooter,
    source,
    routeCompositeSection: makeRouter(routes),
  };
}

/** In-code defaults as a JSON bundle — used by the agent's "reset" tool. */
export function defaultSplitRegistryBundle() {
  return {
    routes: SPLIT_ROUTES,
    section_order_fin: FIN_SECTION_ORDER,
    section_order_pldd: PLDD_SECTION_ORDER,
    metadata: {
      fin_title: FIN_REPORT_TITLE,
      fin_subtitle: FIN_REPORT_SUBTITLE,
      pldd_title: PLDD_REPORT_TITLE,
      pldd_subtitle: PLDD_REPORT_SUBTITLE,
      fin_lens_preamble: FIN_LENS_PREAMBLE,
      pldd_lens_preamble: PLDD_LENS_PREAMBLE,
      fin_footer: FIN_FOOTER_DISCLAIMER,
      pldd_footer: PLDD_FOOTER_DISCLAIMER,
    },
  };
}
