/**
 * What each tier's document CONTAINS — the one place that decides it.
 *
 * `compassSectionRegistry.ts` has said since v2.0 that "ALL detailed financial
 * modelling (purchase costs, yield, loan, cashflow, sensitivity, 10-year
 * projections, land tax, equity) lives in the separate Financial Analysis
 * Report and MUST NOT appear here", and every Compass section's `purpose`
 * repeats it: *NO purchase price, LVR, yield, cashflow or any financial
 * figure*. The generator obeys it — the prose a model writes for a Compass
 * carries no financial section at all.
 *
 * And the document a client opens led with three pages of it.
 *
 * The rule was written in the registry and enforced on the PROSE, while the
 * two renderers each drew the financial block from `financial_calculations`
 * for every tier. `render-investment-report-pdf` reads the tier at line ~2997
 * and uses it for the document's LABEL and nothing else; the Investment
 * Compass masters carry an executive KPI dashboard, an acquisition-and-cash-flow
 * page and a ten-year equity chart in a page sequence that serves all five
 * tiers. So the Compass opened on purchase price, weekly rent, gross yield,
 * LVR and a ten-year equity projection, and the Financial Analysis carried the
 * location case — each report answering the other's question.
 *
 * That is the class this repository keeps paying for: a rule stated in one
 * module and a second implementation that never read it. The remedy is the
 * same one every time — ONE module both implementations import.
 *
 * Three rules.
 *
 * **A tier is a PURPOSE, not a length.** The Compass is not a Financial
 * Analysis with fewer pages; it answers a different question, and the honest
 * test of the split is whether a reader could tell which document they are
 * holding from the contents page alone.
 *
 * **Withholding modelling is not withholding the price.** A location report
 * that will not say what the property costs is coy rather than focused, so
 * `identityFigures` stays true on every tier: the asking price and the
 * indicative rent are facts ABOUT the property, on the snapshot, in the same
 * way its land size is. What leaves the Compass is the MODELLING — yield,
 * LVR, loan structure, cash flow, sensitivity, the ten-year projection — which
 * is an analysis of a purchase rather than a description of an asset.
 *
 * **An unrecognised tier reads as the Compass**, which is the ranking's
 * default document, and is what every other tier-keyed table here does.
 *
 * Deno-compatible: no imports.
 */

export interface TierContentPolicy {
  /**
   * Yield, LVR, loan structure, cash flow, sensitivity, the ten-year equity
   * projection — the analysis of a purchase.
   */
  financialModelling: boolean;
  /**
   * Purchase price and indicative rent as facts about the property, on the
   * snapshot. True on every tier: see rule 2.
   */
  identityFigures: boolean;
  /**
   * The planning, zoning, overlay and hazard register with its explanations,
   * and the amenity and access detail behind it.
   */
  locationDepth: boolean;
  /** The verification register — what must be confirmed before contract. */
  dueDiligenceRegister: boolean;
  /** What the document says it is for, under its title. */
  standfirst: string;
  /** One line naming where the material this tier does not carry lives. */
  companionNote: string | null;
  /**
   * The front matter is one page that flows into the report's own body.
   *
   * Every tier this platform produces today: the verdict, the figures and
   * the property facts close up around what the record holds, and the body
   * opens in the room they leave — measured on the five documents issued for
   * 97 Poole Road on 23 Sep 2026, the verdict page was 54% white on every
   * tier and the Compass's three pages after it 66-74%. `composite`, the
   * pre-tier document nothing produces any more, keeps the page sequence its
   * stored reports were written for.
   */
  continuousFrontMatter: boolean;
}

export const TIER_CONTENT: Readonly<Record<string, TierContentPolicy>> = {
  compass: {
    financialModelling: false,
    identityFigures: true,
    locationDepth: true,
    dueDiligenceRegister: true,
    standfirst: 'Where the property is, who wants to live there, what is mapped over the land, and what the assessment concluded.',
    companionNote: 'Purchase costs, yield, loan structure, cash flow and the ten-year projection are set out in the Financial Analysis Report for this property.',
    continuousFrontMatter: true,
  },
  financial: {
    financialModelling: true,
    identityFigures: true,
    locationDepth: false,
    dueDiligenceRegister: false,
    standfirst: 'What it costs to buy and hold, what it returns, and how the position moves over ten years.',
    companionNote: 'The location case, the planning controls mapped over the land and the risk register are set out in the Investment Compass for this property.',
    continuousFrontMatter: true,
  },
  strategic: {
    // A due-diligence report verifies; it does not model. Its financial
    // question is "what has been assumed", which the Financial Analysis
    // answers in full.
    financialModelling: false,
    identityFigures: true,
    locationDepth: true,
    dueDiligenceRegister: true,
    standfirst: 'What must be verified before contract: the property and location risks at depth, and the checks that settle them.',
    companionNote: 'The financial position is set out in the Financial Analysis Report for this property.',
    continuousFrontMatter: true,
  },
  briefing: {
    financialModelling: false,
    identityFigures: true,
    locationDepth: false,
    dueDiligenceRegister: false,
    standfirst: 'The assessment, condensed for a decision.',
    companionNote: 'The full assessment is in the Investment Compass, and the financial position in the Financial Analysis Report.',
    continuousFrontMatter: true,
  },
  snapshot: {
    // The snapshot's whole purpose is the figures — its own standfirst has
    // said so since the tier existed.
    financialModelling: true,
    identityFigures: true,
    locationDepth: false,
    dueDiligenceRegister: false,
    standfirst: 'The numbers that matter and a short assessment.',
    companionNote: 'The location case is in the Investment Compass, and the full modelling in the Financial Analysis Report.',
    continuousFrontMatter: true,
  },
  composite: {
    // The pre-tier document, and the only one that legitimately carries both:
    // 1,000-odd stored reports predate the split and must render as they were
    // written. Nothing produces `composite` today.
    financialModelling: true,
    identityFigures: true,
    locationDepth: true,
    dueDiligenceRegister: true,
    standfirst: 'The property, the location, the financial position and the assessment.',
    companionNote: null,
    continuousFrontMatter: false,
  },
};

/** The policy for a stored tier or variant word. Unrecognised reads as Compass. */
export function contentPolicyFor(tier: string | null | undefined): TierContentPolicy {
  const key = String(tier ?? '').trim().toLowerCase();
  // `due_diligence` is the fork's argument; `strategic` is what it persists.
  const resolved = key === 'due_diligence' ? 'strategic' : key;
  return TIER_CONTENT[resolved] ?? TIER_CONTENT.compass;
}

/**
 * Whether this tier's document may draw financial modelling.
 *
 * A named predicate rather than a property read at each call site, because
 * there are a dozen of them across two renderers and a negated boolean is
 * exactly the shape that gets inverted in one of them.
 */
export const drawsFinancialModelling = (tier: string | null | undefined): boolean =>
  contentPolicyFor(tier).financialModelling;
