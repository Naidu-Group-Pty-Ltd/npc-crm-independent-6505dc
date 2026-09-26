/**
 * Compass Section Registry — Frontend mirror
 * ------------------------------------------
 * Edge functions cannot import from `src/`, so this file duplicates
 * `supabase/functions/_shared/compassSectionRegistry.ts` by design.
 *
 * DO NOT EDIT EITHER COPY ALONE. `compassRegistryParity.spec.ts` compares the
 * two section arrays field by field and fails the build on any divergence —
 * they had drifted to 672 lines against 174 with nothing checking, which is
 * what docs/reports/DESIGN_SYSTEM.md records as the cautionary case.
 *
 * Everything above COMPASS_FINANCIAL_HANDOFF_COPY is a verbatim copy of the
 * edge file, except its one import, which resolves to the same pure module
 * through the `src/` bridge. Below it are the two helpers only the frontend
 * needs (`normaliseReportTier`, `sectionCountForTier`); the edge file likewise
 * keeps `HEADING_ROUTING` / `routeHeading`, which the frontend does not use.
 */

import { riskRegisterInstruction } from './investment/riskRegister.pure';

// ─── Classification primitives ──────────────────────────────────────────────

export type SectionPriority =
  | 'Protected' // Never trim under page pressure (zoning, planning, risk, infrastructure)
  | 'High'      // Reduce narrative to summary + table before cutting
  | 'Medium'    // Condense heavily, prefer matrices
  | 'Low'       // Move to appendix / internal first
  | 'Excluded'; // Routed to Financial Analysis Report

export type ConfidenceTag =
  | 'Verified'
  | 'Indicative'
  | 'Planned'
  | 'UnderConstruction'
  | 'Unverified'
  | 'NotAvailable';

export type SectionVisualComponent =
  | 'kpiTiles'
  | 'scorecard'
  | 'strengthsWatchPoints'
  | 'infrastructureTimeline'
  | 'amenityMatrix'
  | 'riskRegister'
  | 'planningActionTable'
  | 'dueDiligenceChecklist'
  | 'confidenceChip'
  | 'narrative'
  | 'attributeTable'
  | 'trendTable'
  | 'chart';

export interface CompassSectionDefinition {
  /** Stable id (e.g. `compass.executiveSummary`). */
  id: string;
  /** 1-based ordinal in the Compass layout. */
  ordinal: number;
  /** Display title for the section. */
  name: string;
  /** Underlying H2 headings produced by the generator that map into this section. */
  sourceHeadings: string[];
  /** Target page count (page budget) in the report layout. */
  pageBudget: number;
  /** Classification flags. */
  includeInCompass: boolean;
  includeInFinancialReport: boolean;
  includeInAppendix: boolean;
  isInternalOnly: boolean;
  /** Trim priority under page-pressure logic. */
  sectionPriority: SectionPriority;
  /** Per-section maximum word count for narrative (excludes tables/visuals). */
  maxWordCount: number;
  /** Visual components this section should render. */
  visualComponents: SectionVisualComponent[];
  /** Plain-English purpose for prompt and UI tooltips. */
  purpose: string;
}

/**
 * The five labels this report must never print, in any form.
 *
 * Measured over 56 production Compass reports before they were banned: 5,043
 * occurrences, about 90 a report, carrying 24,713 characters — 16.9% of the
 * document. They are restatement, not findings: a paragraph under a table
 * saying what the table already says.
 *
 * Three forms occur and all three must be matched. Counted in that corpus:
 * `**What This Means**` (bold lead-in) 4,161, `### NPC view` (heading) 424, and
 * a bare `What to watch` line 458. The post-processor's original matcher was
 * heading-only and caught **11 of the 5,043** — 0.2% — which is why this list
 * lives here, beside the sections, rather than as a regex in one consumer.
 *
 * `compassPostProcessor.stripEditorialBlocks` removes them and
 * `compassQAValidator`'s `editorial-label` rule fails the report if any survive.
 */
export const EDITORIAL_LABELS: readonly string[] = [
  'what this means',
  'what this means for you',
  'why this matters',
  'why this matters for investors',
  'what to watch',
  'key takeaway',
  'key takeaways',
  'npc view',
  'npc take',
  'our view',
];

// ─── Investment Location & Property Fit Report (≈37 pages, 17 sections) ─────
//
// v4.1 (22 Sep 2026, W2.2) — `Infrastructure and Growth Context` (ordinal 5)
// and `Competitive Landscape and Supply Pipeline` (ordinal 12) are sections.
// Both were merged for the right reason and both now have a register behind
// them, which is the rule's other half: `infrastructureEvidence.pure.ts` and
// `nationalPipeline.pure.ts` answer for the first, and W3.1's
// `market_building_approvals` — the ABS's own monthly count of approved
// dwellings at this property's SA2 — for the second, whose whole prior
// existence in this product was the statewide prompt's
// `**Supply Pipeline Risk:** [New housing supply vs demand balance]`.
//
// The two carriers gave back what they had been writing for them (Why This
// Location Matters 900→650 words, Market Positioning 600→450) and each now
// NAMES where the subject went, because a prompt that still asks for a subject
// the section after it owns is how `Exit Outlook` and `Monitoring Plan` came
// to be written twice, contradicting each other, on one delivered document.
// 8,410 words across 35 pages → 9,010 across 37, inside the 30–38 band.
//
// v4.0 — the document has room for what it retrieves. ALL detailed financial
// modelling (purchase costs, yield, loan, cashflow, sensitivity, 10-year
// projections, land tax, equity) lives in the separate Financial Analysis
// Report and MUST NOT appear here; that rule is unchanged from v2.0, and as of
// v14 of the template library it is enforced by `tierContent.pure.ts` at the
// projection as well as in the prose.
//
// WHAT CHANGED IN v4.0, AND WHY
//
// The owner's review of the 17 Sep 2026 Compass: "the Zoning, Planning and
// Infrastructure sections are simply not good enough ... the information being
// incorporated does not provide the client with sufficiently solid, meaningful
// or valuable information", benchmarked against the legacy long-form report,
// "approximately 80 pages or more".
//
// Measured, both halves of that:
//
//   * **Zoning had no section.** 'Zoning' and 'Planning' were sourceHeadings
//     of the RISK DASHBOARD — a 500-word table whose own purpose says "the
//     table IS the section — no prose restating rows". So the controls the
//     platform retrieves had nowhere to be explained, and the reader got a
//     row. It is ordinal 8 now, with 900 words, and
//     `planningConstraints.pure.ts` gives it a register to explain.
//   * **The legacy report ran to ~110,000 characters across 27 sections in
//     ONE pass** (`df813535`, Lot 2410 Prescott Road — 338,471 characters
//     because a resume defect wrote it three times). The 17 Sep Compass is
//     38,648 across 11, against a v3.0 cap of 5,010 words. v4.0 is 8,150
//     across 15, which is what the retrieved evidence can carry honestly.
//     (v4.1 makes that 9,010 across 17 — see the note above.)
//
// Three sections were split back out because the merge had put them where
// nothing could be said: Transport (was one bullet inside a 600-word Amenity
// & Access covering schools, healthcare, retail, recreation AND transport —
// five sections and ~25,000 characters in the legacy document), Environment
// and Climate & Safety (folded into the risk table), and Planning.
//
// The v3.0 merge was the right decision for the reason it was made — the
// sections repeated each other. What changed is that there is now measured
// evidence behind each of them: a constraint register with per-control
// explanation, GTFS stops, four states of recorded crime, climate readings.
// A section with nothing behind it should be merged; a section with a
// register behind it should not.
//
// WHAT CHANGED, AND WHY
//
// v2.0 declared a 4-block writing style for every narrative section — Key
// takeaway / Why this matters / What to watch / NPC view — and the generator
// separately told the model to add a "What This Means" paragraph after *every*
// visual, table and data point. Measured against the 56 most recent reports,
// that produced **90 editorial labels a report carrying 16.9% of the
// document**, against a declared budget the report was already exceeding by
// 2.3× (86 rendered pages, ~21,000 words, against 45 declared pages and 9,170
// words).
//
// The writing style is now:
//   1. State the finding in the sentence that introduces the data.
//   2. Show the data — a figure, a table, or a short list.
//   3. Move on.
//
// There is no commentary block, and no paragraph that restates the figure
// above it. See EDITORIAL_LABELS for the exact strings this forbids and the
// two modules that enforce it.
//
// The section list is 11 client-facing sections plus back matter, down from
// 17. Two merges: Demand Drivers absorbs population, tenant/buyer and
// employment (one question — who wants to live here, and why); Amenity &
// Access absorbs education, retail/healthcare/lifestyle and transport (one
// question — what is nearby, and how long to reach it). Both are
// consolidations the v2.0 `purpose` strings already asked for and the prompt
// could not deliver, because each was a separate section. Client Reading Guide
// is gone: it was a prose contents page, and the typeset document has a real
// one.
//
// A section name here is load-bearing downstream — `TITLED_SECTION_CHARTS` in
// reports/investment/normalise.pure.ts attaches infographics by title, and
// reportSplitRegistry.ts routes derived variants by heading substring. Both
// were updated with this list; read those two before renaming anything.

export const COMPASS_40_SECTIONS: CompassSectionDefinition[] = [
  {
    // Excluded from Compass assembly (2026-09): every surface that draws this
    // narrative draws its own cover, and the model-written one rendered as a
    // SECOND cover inside the body — the firm's masthead, the words "Cover
    // Page" as a visible heading, and "Prepared for: Premium client of …" as
    // body copy, measured on a real client document. Same treatment the prose
    // contents section got, for the same reason. Stored reports that already
    // carry it are cleaned at read time by
    // `reports/investment/narrativeClean.pure.ts`.
    id: 'compass.cover',
    ordinal: 1,
    name: 'Cover Page',
    sourceHeadings: ['Cover'],
    pageBudget: 1,
    includeInCompass: false,
    includeInFinancialReport: false,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 60,
    visualComponents: [],
    purpose: 'NPC branding, report name ("Investment Location & Property Fit Report"), property address, report date.',
  },
  {
    id: 'compass.executiveVerdict',
    ordinal: 2,
    name: 'Executive Verdict',
    sourceHeadings: ['Executive Summary', 'Executive Verdict', 'Overall Assessment', 'Investment Recommendation'],
    pageBudget: 2,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 550,
    visualComponents: ['kpiTiles', 'scorecard'],
    purpose: 'The verdict, first. Open with the recommendation this document issues, exactly as your instructions give it, then the case for it: the location call, how the property fits its market, who will want to live in it, and the two or three matters that most need checking before exchange, each written as a condition of the recommendation with the check that settles it. One recommendation, stated the same way here, on the cover and in the Final Recommendation. Write it as findings, not as a preview of the sections below. NO purchase price, LVR, yield, cashflow or any financial figure — those belong in the Financial Analysis Report.',
  },
  {
    id: 'compass.propertyLocalitySnapshot',
    ordinal: 3,
    name: 'Property & Locality Snapshot',
    sourceHeadings: ['Property Snapshot', 'Property-Level Information', 'Locality Snapshot'],
    pageBudget: 2,
    includeInCompass: true,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 350,
    visualComponents: ['attributeTable', 'kpiTiles'],
    purpose: 'Facts in a table, not prose: property type, bed/bath/car, land size, dwelling configuration, estate, suburb, LGA, target occupier, locality fit. Bed/bath/car must be internally consistent throughout the whole report. NO price, rent, yield, LVR, loan or any financial field.',
  },
  {
    id: 'compass.whyLocationMatters',
    ordinal: 4,
    name: 'Why This Location Matters',
    // Infrastructure left this list for its own section (ordinal 5), with
    // every heading it had ever been written under. A heading in TWO
    // sections resolves to whichever comes first and the other silently
    // loses it — the same rule this list already answered to when
    // Transport left Amenity & Access.
    sourceHeadings: ['Location Overview', 'Why This Location Matters', 'Growth Corridor'],
    pageBudget: 3,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 650,
    visualComponents: ['narrative', 'confidenceChip'],
    purpose: 'The macro thesis and only that: where this property sits — growth corridor, master-planned estate, LGA — the economic links that hold the area, and what is CHANGING about the place. The committed and planned pipeline is the section immediately after this one (Infrastructure and Growth Context) and is not written here: name a project only where it is the REASON the location case is being made, and leave its stage, its date and its confidence to that section. NO financial figures.',
  },
  {
    id: 'compass.infrastructure',
    ordinal: 5,
    name: 'Infrastructure and Growth Context',
    /*
     * W2.2. Un-merged from `Why This Location Matters`, where it had been a
     * paragraph and a timeline inside somebody else's section.
     *
     * The rule the merge was right under — *a section with nothing behind it
     * should be merged; a section with a register behind it should not* — is
     * the reason this is now its own. `infrastructureEvidence.pure.ts` and
     * `nationalPipeline.pure.ts` answer, and the generator pins their table
     * into every section call. A retrieved project with nowhere to be
     * explained is the defect the owner's review of 17 Sep 2026 named for
     * zoning, one register along.
     *
     * Every infrastructure heading this document has ever written moved HERE
     * with it. A heading in two sections resolves to whichever comes first
     * and the other silently loses it — `buildRoutingTable` upserts, so the
     * LAST writer wins and the first disappears without a word.
     */
    sourceHeadings: [
      'Infrastructure and Growth Context',
      'Infrastructure & Development',
      'Infrastructure Pipeline',
      'Future Infrastructure',
      'Future Infrastructure & Growth Pipeline',
    ],
    pageBudget: 2,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 500,
    visualComponents: ['infrastructureTimeline', 'attributeTable', 'confidenceChip'],
    purpose:
      'The committed and planned pipeline, as its own section rather than a timeline inside the location case. One entry per NAMED project: what it is, the publisher\u2019s own status word, the milestone the publisher recorded and its date (a gazettal, a determination, a funding decision \u2014 never a forecast completion; head that column \u201cRecorded milestone\u201d), and one closing line on how far the evidence goes. The rules that bind what may be said here \u2014 an approval is never read as funding and funding never as a start on site, an absence is never RATED, a media release or a budget page is not a register entry, and the coverage limitation is stated on a full list as well as an empty one \u2014 are stated in the \u201cInfrastructure & Development Outlook\u201d block of this prompt and are deliberately not repeated here, because two statements of one rule is how the two come to disagree. Name the project, the stage and the date \u2014 not what the project means for the reader. NO financial figures, and no development potential quantified.',
  },
  {
    id: 'compass.demandDrivers',
    ordinal: 6,
    name: 'Demand Drivers',
    sourceHeadings: [
      'Demand Drivers',
      'Population & Housing Demand',
      'Population and Development Trends',
      'Tenant & Buyer Profile',
      'Demographics & Demand Drivers',
      'Target Tenant',
      'Employment & Economic Linkages',
      'Employment Hubs',
      'Sustained Employment Growth',
      'Employment & Industry',
      'Economic Context',
    ],
    pageBudget: 4,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 950,
    visualComponents: ['trendTable', 'kpiTiles', 'attributeTable'],
    purpose: 'One section answering who wants to live here and why — merged from the v2.0 population, tenant/buyer and employment sections, which repeated each other. Covers population growth and household formation, the tenant and buyer profile (household types, income brackets, a small SEIFA evidence box), and the corridor industries, major employers and employment-hub access that support that demand. Render employment ONCE, here. The supply pipeline is Competitive Landscape and Supply Pipeline and is not written here. Macro demand only — no rent or yield numbers.',
  },
  {
    id: 'compass.amenityAccess',
    ordinal: 7,
    name: 'Amenity & Access',
    // Transport left this list for its own section (ordinal 8). A heading in
    // TWO sections resolves to whichever comes first and the other silently
    // loses it — the same rule a workspace path answers to.
    sourceHeadings: [
      'Amenity & Access',
      'Schools & Education',
      'Education Infrastructure',
      'Education Profile',
      'Education Lifecycle',
      'Key Local Schools',
      'Education & Family Amenity',
      'Healthcare & Shopping',
      'Recreational Amenities',
      'Suburb Character',
      'Lifestyle',
      'Retail, Healthcare & Lifestyle Amenity',
    ],
    pageBudget: 3,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: true,
    isInternalOnly: false,
    sectionPriority: 'Medium',
    maxWordCount: 700,
    visualComponents: ['amenityMatrix', 'attributeTable'],
    purpose: 'One section answering what is nearby and how long it takes to reach — merged from the v2.0 education, retail/healthcare/lifestyle and transport sections. Lead with one table that a reader can read as a sentence: what the amenity IS, how far it is and measured how (walking, driving, straight-line), what is there NOW, and what is published as coming. Give the columns those words rather than the four bare nouns the section was specified with — "Amenity / Distance / Current / Future" is the shape of a data structure and reads as one on the page. Covers schools and childcare, healthcare, shopping and dining, parks and recreation, and rail, road, bus and real commute times including honest car-reliance. Top 3–5 per category; full school and facility lists go to the appendix. Render each ONCE.',
  },
  {
    id: 'compass.transportAccess',
    ordinal: 8,
    name: 'Transport & Connectivity',
    sourceHeadings: [
      'Transport & Connectivity',
      'Transport & Accessibility',
      'Public Transport Access',
      'Public Transport Network',
      'Commute Metrics',
      'Connectivity & Transport',
    ],
    pageBudget: 2,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 450,
    visualComponents: ['attributeTable', 'amenityMatrix'],
    purpose: 'How a household here actually moves: the nearest stops and their distance, the modes on record, and any measured commute — then honest car reliance, which is a finding that needs a measurement like every other. A stop found is a fact about this area; no stop found is not evidence of no service, because the operators\' published stop data this report covers does not reach every network — and neither is a score. Where public transport was not assessed for this property, say so once, say where the client confirms it (the operator\'s published timetable), and describe nothing else. NO financial figures.',
  },
  {
    id: 'compass.planningConstraints',
    ordinal: 9,
    name: 'Zoning, Planning and Development Considerations',
    sourceHeadings: [
      'Zoning, Planning and Development Considerations',
      // The name this section shipped under until v4.1. Kept so every stored
      // report still partitions onto this section and none of them loses its
      // planning chapter to the preamble — a heading belongs to exactly one
      // section, and retiring a name is not the same as deleting it.
      'Planning, Zoning & What Is Mapped Over the Land',
      'Zoning & Planning Analysis',
      'Planning controls and development registers',
      'Zoning',
      'Planning',
      'Planning Controls',
      'Overlays',
    ],
    pageBudget: 5,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 1100,
    visualComponents: ['planningActionTable', 'attributeTable', 'confidenceChip'],
    purpose: 'Explain the planning controls that apply to this property, as an adviser would to a buyer. Lead with the controls table: the zone and its instrument, the numeric controls the table lists — in the terms the jurisdiction\'s own instrument uses, never a control it does not use (Western Australia has no floor space ratio) — with the clause that creates each one, and every overlay or hazard mapped over the property, each with its currency date. Then explain what each control OBLIGES — not what it is called — and close with the certificate that settles it in this jurisdiction and the questions to put with it. State only what the table shows; where a published map was checked and shows nothing over the property, say it was checked; where a map was not covered by this report, say the council scheme has not been confirmed. An absence is never a clearance and a zone that admits a use is never approval for it. NO financial figures. OPEN with the property\'s identity — the lot and plan, the parcel area and its basis where the title plan states one, the local government area — because a planning finding is about a PARCEL and a reader cannot check one against an address alone. Where the parcel area is not stated, say so in its own sentence ("the surveyed area of the lot has not been confirmed; the certificate of title states it") and never write a value slot around the absence; a land size the property record carries is that record\'s figure, is named as such, and is never presented as a surveyed measurement. Then, for every control and every land use: what was FOUND, what it MEANS for this property, the PRACTICAL implication for a buyer or a holder, and what REMAINS to be verified and where. Four moves, in that order, in ordinary sentences — never as four labelled fields. Where the land use table is given it is the authority on what may be built: do not soften a prohibition into a possibility and do not infer a secondary dwelling, a dual occupancy or a subdivision from the block size, the street or the zone code. Land size is not a permission.',
  },
  {
    id: 'compass.environmentSafety',
    ordinal: 10,
    name: 'Environment, Climate & Safety',
    sourceHeadings: [
      'Environment, Climate & Safety',
      'Environmental Risks & Climate',
      'Crime & Safety',
      'Environmental Risk',
      'Climate',
    ],
    pageBudget: 2,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: true,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 650,
    visualComponents: ['attributeTable', 'confidenceChip', 'narrative'],
    purpose: 'What the environmental and crime registers returned for this area, and what each reading means for a holder — insurance, construction, liveability, tenant appeal. The two are together because both are facts about the AREA that a buyer weighs the same way, and both were folded into a risk table that had room for neither. A recorded crime count is a fact about a register and a geography, never a character assessment of the people who live there; state the period, the area and the publisher, and never compose a movement claim without a real local total beside it. Where a reading was withheld, say which and why, and print no digit. NO financial figures.',
  },
  {
    id: 'compass.marketPositioning',
    ordinal: 11,
    name: 'Market Positioning',
    sourceHeadings: ['Market Positioning', 'Current Market Performance', 'Market Analysis'],
    pageBudget: 2,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 450,
    visualComponents: ['trendTable', 'kpiTiles'],
    purpose: 'Where this property sits in the local market: medians and their movement, days on market, new-estate context, owner-occupier appeal, demand signals. Comparable and competing SUPPLY is the section immediately after this one (Competitive Landscape and Supply Pipeline) and is not written here. Qualitative growth drivers only — NO yield, cashflow, capital growth %, repayment or loan numbers.',
  },
  {
    id: 'compass.supplyPipeline',
    ordinal: 12,
    name: 'Competitive Landscape and Supply Pipeline',
    /*
     * W2.2. Un-merged from `Market Positioning`, and it is the section W3.1
     * was built for: `market_building_approvals` holds the ABS\u2019s own
     * monthly count of approved dwellings at the property\u2019s SA2, and the
     * generator pins `approvalsFactBlocks` into every section call.
     *
     * Before this it had nowhere to land. The statewide prompt carried
     * `**Supply Pipeline Risk:** [New housing supply vs demand balance]` \u2014 a
     * bracketed slot with no register behind it, which is the shape that put
     * `450 m\u00b2` and `8.5 m` into a client\u2019s document under the wrong
     * jurisdiction\u2019s instrument names.
     *
     * `Supply & Development Pipeline` was a sourceHeading of DEMAND DRIVERS
     * and an alias of `infrastructure` at the same time \u2014 two registries
     * disagreeing about where one heading goes. It belongs to exactly one
     * section, and this is it.
     */
    sourceHeadings: [
      'Supply & Development Pipeline',
      'Supply Pipeline',
      'Competitive Landscape and Supply Pipeline',
      'Competing Supply',
    ],
    pageBudget: 2,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 500,
    visualComponents: ['trendTable', 'attributeTable'],
    purpose:
      'What else is coming to market nearby, and what that does to this property\u2019s position. Lead with the approved-dwelling count for the area on record \u2014 an approval is not a completion, and a total summed from only some months is PARTIAL and says so: it is not a minimum either, because the published figures are net of amendments. Then the competing stock a reader can see: estate releases and comparable listings, named. Where there is no approvals figure, say which absence it is, in the words the supply block gives \u2014 building approvals not covered by this report, and a published series that holds no figure for this area, are different sentences and only the second is about the area. Never rate the absence, and never compute a supply-versus-demand balance the published figures do not carry. NO financial figures, no yield, no growth percentage.',
  },
  {
    id: 'compass.propertyFit',
    ordinal: 13,
    name: 'Property Fit Within the Suburb',
    sourceHeadings: ['Property Fit Within the Suburb', 'Property-Level Information', 'Strategic Assessment', 'Property Fit'],
    pageBudget: 2,
    includeInCompass: true,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 550,
    visualComponents: ['strengthsWatchPoints', 'attributeTable'],
    purpose: 'How this specific dwelling aligns with local demand: lot position, layout, land/build balance, tenant appeal, resale story, limitations. Strengths and limitations as two short lists, not as paragraphs. Bed/bath/car must match the Property & Locality Snapshot. NO valuation, yield or financial assessment.',
  },
  {
    id: 'compass.riskDashboard',
    ordinal: 14,
    name: 'Risk Dashboard',
    // Environment, crime, zoning and planning left this list for the two
    // sections that now carry them (ordinals 9 and 10). They were folded in
    // here because there was nowhere else, and a 500-word table whose own
    // purpose says "the table IS the section" is not a home for a planning
    // control or a climate reading.
    sourceHeadings: ['Risk Dashboard', 'Risk Summary', 'Key Risks Before Proceeding'],
    pageBudget: 2,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: true,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 550,
    visualComponents: ['riskRegister', 'confidenceChip'],
    // The register's shape is stated ONCE, in `riskRegister.pure.ts`, and
    // composed here. It was a verbatim string literal in this file and again
    // in the frontend mirror, so `riskRegisterInstruction()` — the function
    // whose own header calls itself "one declaration" — had zero production
    // call sites and the three copies had already drifted. See that module
    // for what the delivered documents did with the old wording.
    purpose: riskRegisterInstruction(),
  },
  {
    id: 'compass.dueDiligenceChecklist',
    ordinal: 15,
    name: 'Due Diligence Checklist',
    sourceHeadings: ['Due Diligence Checklist', 'Due Diligence', 'Investment Recommendations'],
    pageBudget: 1,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 350,
    visualComponents: ['dueDiligenceChecklist'],
    purpose: 'A plain checklist of what to verify before proceeding: planning certificate, title/covenant, overlays, insurance/BAL position, comparables, rent, contract and estate covenants. Checklist items only — one line each, no explanatory paragraphs.',
  },
  {
    id: 'compass.finalRecommendation',
    ordinal: 16,
    name: 'Final Recommendation',
    sourceHeadings: ['Final Recommendation', 'Final Conclusion', 'Investment Recommendation'],
    pageBudget: 1,
    includeInCompass: true,
    includeInFinancialReport: false,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 350,
    visualComponents: ['narrative'],
    purpose: 'Open with the recommendation this document issues, in bold on its own line, exactly as your instructions give it — the same recommendation the cover and the Executive Verdict state — then 150–250 words of continuous rationale tied to location, tenant demand and risk, with every condition the recommendation depends on kept and stated as a condition, then the immediate actions as a short list in the order they should be done. Write the rationale as one unlabelled passage: this section carried four labelled commentary blocks in v2.0 and they were 39% of it. NO financial verdict and no financial figures.',
  },
  {
    id: 'compass.disclaimer',
    ordinal: 17,
    name: 'Appendix, Source Notes & Disclaimer',
    sourceHeadings: ['PROFESSIONAL DISCLAIMER', 'Disclaimer', 'Source Appendix', 'Appendix'],
    pageBudget: 1,
    includeInCompass: true,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 300,
    visualComponents: ['narrative'],
    purpose: 'Back matter, not an analysis section: data sources, appendix listings (full school and facility lists moved out of Amenity & Access), general advice warning, report limitations. Replaces any inline "[citation]" placeholders.',
  },
];

// ─── Financial Analysis Report architecture (separate document) ─────────────

export const FINANCIAL_ANALYSIS_SECTIONS: CompassSectionDefinition[] = [
  {
    id: 'financial.cover',
    ordinal: 1,
    name: 'Cover Page',
    sourceHeadings: ['Cover'],
    pageBudget: 1,
    includeInCompass: false,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 60,
    visualComponents: [],
    purpose: 'NPC branding, "Financial Analysis Report", property address, report date.',
  },
  {
    id: 'financial.propertySnapshot',
    ordinal: 2,
    name: 'Property & Inputs Snapshot',
    sourceHeadings: ['Property Snapshot'],
    pageBudget: 1,
    includeInCompass: false,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 220,
    visualComponents: ['attributeTable', 'kpiTiles'],
    purpose: 'Address, type, configuration, purchase price, deposit, loan, rate, term assumptions.',
  },
  {
    id: 'financial.purchaseCosts',
    ordinal: 3,
    name: 'Purchase & Ongoing Costs',
    sourceHeadings: ['Purchase & Ongoing Costs (Annual)'],
    pageBudget: 2,
    includeInCompass: false,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 350,
    visualComponents: ['attributeTable', 'kpiTiles'],
    purpose: 'Stamp duty, conveyancing, building/pest, LMI, annual property expenses, land tax breakdown.',
  },
  {
    id: 'financial.yield',
    ordinal: 4,
    name: 'Rental Assessment & Yield Calculation',
    sourceHeadings: ['Rental Assessment & Yield Calculation'],
    pageBudget: 2,
    includeInCompass: false,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 350,
    visualComponents: ['kpiTiles', 'trendTable'],
    purpose: 'Weekly rent, gross yield, net yield, vacancy, management costs, yield benchmark commentary.',
  },
  {
    id: 'financial.loan',
    ordinal: 5,
    name: 'Loan Structure & Repayment Analysis',
    sourceHeadings: ['Loan Structure & Repayment Analysis'],
    pageBudget: 2,
    includeInCompass: false,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 400,
    visualComponents: ['attributeTable', 'kpiTiles'],
    purpose: 'LVR, loan amount, interest rate, product type, IO vs P&I, monthly/annual repayments.',
  },
  {
    id: 'financial.cashflow',
    ordinal: 6,
    name: 'Year-1 Cashflow & Sensitivity',
    sourceHeadings: ['Sensitivity Analysis', 'Interest Rate Sensitivity', 'Structural Cashflow Deficit'],
    pageBudget: 3,
    includeInCompass: false,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 600,
    visualComponents: ['trendTable', 'chart'],
    purpose: 'Year-1 net cashflow pre/post tax, monthly shortfall, ±1% / ±2% interest rate sensitivity.',
  },
  {
    id: 'financial.tenYear',
    ordinal: 7,
    name: '10-Year Cashflow & Equity Projections',
    sourceHeadings: ['10-Year Investment Projections', 'Capital Appreciation Potential', 'Leveraged Equity Accumulation'],
    pageBudget: 4,
    includeInCompass: false,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 700,
    visualComponents: ['trendTable', 'chart'],
    purpose: '10-year cashflow, rental projections, loan balance, equity growth, cumulative cash contributions.',
  },
  {
    id: 'financial.tax',
    ordinal: 8,
    name: 'Tax Treatment & Land Tax',
    sourceHeadings: ['Land Tax', 'Tax Treatment'],
    pageBudget: 2,
    includeInCompass: false,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 400,
    visualComponents: ['attributeTable'],
    purpose: 'Negative gearing, depreciation outline, land tax thresholds, client-specific assumptions and disclaimers.',
  },
  {
    id: 'financial.serviceability',
    ordinal: 9,
    name: 'Serviceability & Buffer',
    sourceHeadings: ['Borrowing Capacity', 'Serviceability'],
    pageBudget: 2,
    includeInCompass: false,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'High',
    maxWordCount: 400,
    visualComponents: ['kpiTiles', 'attributeTable'],
    purpose: 'Client serviceability headroom, recommended cash buffer, lender stress test assumptions.',
  },
  {
    id: 'financial.recommendation',
    ordinal: 10,
    name: 'Financial Recommendation',
    sourceHeadings: ['Financial Recommendation'],
    pageBudget: 1,
    includeInCompass: false,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 280,
    visualComponents: ['narrative'],
    purpose: 'Financial suitability verdict tied to client serviceability, buffers and cashflow capacity.',
  },
  {
    id: 'financial.disclaimer',
    ordinal: 11,
    name: 'Disclaimer & Source Appendix',
    sourceHeadings: ['PROFESSIONAL DISCLAIMER', 'Disclaimer'],
    pageBudget: 1,
    includeInCompass: false,
    includeInFinancialReport: true,
    includeInAppendix: false,
    isInternalOnly: false,
    sectionPriority: 'Protected',
    maxWordCount: 300,
    visualComponents: ['narrative'],
    purpose: 'General advice warning, source data, methodology notes. Not personal financial advice.',
  },
];

// ─── Word-cap governance (component-level, from §7 of the brief) ────────────

// `whatThisMeansBox` is gone with the boxes themselves — see EDITORIAL_LABELS.
// `executiveSummaryTotal` halved with the section's own cap.
export const COMPASS_WORD_CAPS = {
  executiveSummaryTotal: { min: 300, max: 450 },
  sectionOpeningTakeaway: { min: 35, max: 50 },
  standardParagraph: { min: 45, max: 80 },
  amenityCategorySummary: { min: 40, max: 70 },
  riskItemExplanation: { min: 25, max: 45 },
  planningItemExplanation: { min: 40, max: 70 },
  finalRecommendation: { min: 150, max: 250 },
} as const;

// ─── Page-pressure trim order (§6, §11 of the brief) ────────────────────────
// Applied in sequence when rendered page count exceeds the target band.
// Sections with sectionPriority === 'Protected' are NEVER touched.
//
// `collapseDecisionBoxes` is gone: it collapsed duplicate boxes down to one,
// and there is no longer a permitted first one. `stripEditorialBlocks` removes
// all of them unconditionally, before page pressure is even measured.
//
// `reduceEconomicContext` and `reduceLifestyle` now name the sections that
// absorbed the ones they used to target — they addressed `compass.economicContext`
// and `compass.suburbCharacter`, neither of which has existed since v2.0, so
// both steps have been no-ops for their whole life.

export const PAGE_PRESSURE_TRIM_ORDER: ReadonlyArray<{
  id: string;
  description: string;
}> = [
  { id: 'transitions',          description: 'Strip repeated transition paragraphs ("As we move into…").' },
  { id: 'capListsToTop5',       description: 'Cap school / amenity / transport lists to top 5 records.' },
  { id: 'mergeDuplicateDemographics', description: 'Merge duplicate demographic/employment commentary.' },
  { id: 'moveListsToAppendix',  description: 'Move long lists to appendix / internal view.' },
  { id: 'reduceDemandDrivers',  description: 'Reduce Demand Drivers to one page.' },
  { id: 'reduceAmenityAccess',  description: 'Reduce Amenity & Access to one page.' },
];

// ─── Protected section ids (never trim under page pressure) ─────────────────
//
// DERIVED from the field, because it was a second spelling of it and the two
// had drifted. `sectionPriority: 'Protected'` is the declaration — the trim
// order above says so in those words — and this list was a hand-written copy
// of the same fact, which `PAGE_PRESSURE_TRIM_ORDER` and `compassPostProcessor`
// actually read. Measured before this change: **four sections declared
// `Protected` and were absent from the set** — `compass.planningConstraints`
// (1,100 words, the largest section in the document and the one the owner's
// 17 Sep 2026 review named), `compass.environmentSafety`, `compass.cover` and
// `compass.disclaimer`. So `capListsToTop5` was free to cut a planning
// register of eleven overlays down to five bullets, on the section that exists
// to explain them.
//
// This is the rule the risk-register instruction, `strategySectionRules` and
// `AML_COMMAND_REFRESH_EVENT` each paid for: **a rule written at both ends is
// how the two ends drift.** Adding a section here is now impossible to forget,
// because there is nothing to add.
export const PROTECTED_SECTION_IDS: ReadonlySet<string> = new Set(
  COMPASS_40_SECTIONS.filter((s) => s.sectionPriority === 'Protected').map((s) => s.id),
);

export const COMPASS_FINANCIAL_HANDOFF_COPY =
  'This Compass Report focuses on macro suitability, suburb fundamentals, planning considerations and property-positioning factors. Detailed cashflow, lending structure, tax position, yield and 10-year financial modelling should be reviewed separately in the Financial Analysis Report.';

/**
 * Accepted page band for QA (20–26).
 *
 * The v2.0 band was 38–42 and the page budgets summed to 45, so the band was
 * never reachable from the budgets even in principle. Production rendered at
 * 86. The budgets above now sum to 23, which is inside this band with room for
 * the part-full chapter tail every chaptered document pays per section.
 */
export const COMPASS_PAGE_BAND = { min: 30, max: 38 } as const;

export const COMPASS_40_PAGE_BUDGET = COMPASS_40_SECTIONS.reduce((s, x) => s + x.pageBudget, 0);
export const FINANCIAL_PAGE_BUDGET  = FINANCIAL_ANALYSIS_SECTIONS.reduce((s, x) => s + x.pageBudget, 0);

export const compassSections = (): CompassSectionDefinition[] =>
  COMPASS_40_SECTIONS.filter((s) => s.includeInCompass).sort((a, b) => a.ordinal - b.ordinal);

export const financialSections = (): CompassSectionDefinition[] =>
  FINANCIAL_ANALYSIS_SECTIONS.filter((s) => s.includeInFinancialReport).sort((a, b) => a.ordinal - b.ordinal);

export function totalWordBudget(tier: 'compass-40' | 'financial-analysis'): number {
  const list = tier === 'compass-40' ? compassSections() : financialSections();
  return list.reduce((sum, s) => sum + s.maxWordCount, 0);
}

/**
 * Normalise the many tier aliases used across the codebase
 * (`compass`, `compass-40`, `strategic`, `briefing`, `snapshot`, `financial`,
 *  `financial-analysis`) to one of the two registry tiers.
 */
export type NormalisedTier = 'compass-40' | 'financial-analysis';

export function normaliseReportTier(raw: unknown): NormalisedTier {
  const t = String(raw ?? '').toLowerCase().trim();
  if (t.startsWith('financial')) return 'financial-analysis';
  // Everything else (compass / strategic / briefing / snapshot / unknown) maps to Compass.
  return 'compass-40';
}

/**
 * How many generation chunks the chunked-regeneration loop should run.
 *
 * This is a **fallback only**. A report row persists its own `total_sections`
 * at generation time, and every caller must prefer that: a row generated under
 * a 17-section registry keeps converging against 17 even after this returns 12,
 * which is what stops an in-flight report becoming a chimera of two section
 * lists. See `progress/selectors.pure.ts` and `useChunkedRegeneration.ts`.
 *
 * ## It counts what is GENERATED, never what is declared
 *
 * This read `COMPASS_40_SECTIONS.length` — the RAW array — while the generator
 * loops `compassSections()`, the array FILTERED on `includeInCompass`. The two
 * agreed until `compass.cover` was excluded in 2026-09 (a model-written cover
 * was printing as a second cover inside the body), and from that day the
 * fallback said 15 where the server wrote 14.
 *
 * One off-by-one, three symptoms on one screen, measured on the 97 Poole Road
 * regeneration of 20 Sep 2026:
 *
 *   * the card read `12/15` while the widget beside it read `Section 12 of 14`
 *     — the hook resolves the total ONCE at kickoff and falls back to this,
 *     the widget re-reads the row every poll and gets the server's 14;
 *   * the loop ran a fifteenth iteration against a server that has fourteen;
 *   * and `last_completed_section >= totalSections` was `14 >= 15`, so a run
 *     that had written every section it was asked for threw
 *     "Report regeneration incomplete" and stamped the row `failed`.
 *
 * The document was complete throughout. Only the verdict was wrong.
 *
 * Financial is untouched by this — 11 declared, 11 generated — which is exactly
 * why it went unseen: the defect can only appear on a tier that excludes a
 * section, and only the Compass does.
 */
export function sectionCountForTier(raw: unknown): number {
  return normaliseReportTier(raw) === 'financial-analysis'
    ? financialSections().length
    : compassSections().length;
}
