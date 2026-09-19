/**
 * The rent a report is entitled to quote, and what to print when there isn't one.
 *
 * ## The defect this exists to end
 *
 * Measured 2026-09-07: **83 stored reports print a `0.00%` rental yield**, in
 * shapes like `| Gross Rental Yield | $0 ÷ $390,000 × 100 | 0.00% |`. 74 of
 * them had no rent supplied by the customer. A yield of zero is not the
 * absence of a yield — it is the claim that a property earns nothing — and it
 * flowed onward: the annual income line printed `$0`, the net yield printed a
 * negative number that was really just the costs, and the model was then told
 * to "USE THESE EXACTLY - DO NOT RECALCULATE".
 *
 * ## Why it happened: two rents, in two scopes
 *
 * The generator resolved the rent **twice**, and only one of them could see a
 * looked-up value.
 *
 *  - `effectiveWeeklyRent = overrides.weeklyRent || propertyDetails.weeklyRent
 *    || 0` sits at the top of the handler and is what every prompt line and
 *    both pre-calculated yields read. It knows only what a person typed.
 *  - `calcWeeklyRent = effectiveWeeklyRent || weeklyRent || 0` sits inside the
 *    enrichment block, where `weeklyRent` may have been filled from the market
 *    lookup. It is what the calculator, the projections and every stored
 *    figure describe.
 *
 * `weeklyRent` is declared inside that block and is out of scope by the time
 * the prompt is assembled, so the lookup could never reach the document. Four
 * prompt lines had already been patched by hand with
 * `effectiveWeeklyRent || enhancedData.financials?.income?.weeklyRent ||
 * 'XXX'` — someone had seen the symptom — but the yields, the annual income
 * and four further lines were not, and a per-line patch cannot fix a figure
 * that is computed once from the wrong variable.
 *
 * ## The rule
 *
 * **There is one rent.** It is resolved once, from the same chain the
 * calculator used, and it carries whether it is established at all. When it is
 * not, every figure derived from it is ABSENT rather than zero, and the prompt
 * says so instead of handing the model a nought to reason from.
 *
 * Ordering is the calculator's own, so a report whose rent was typed or
 * carried by the listing resolves to exactly the number it resolves to today:
 * override, then listing, then the rent the projections actually used.
 *
 * Nothing here fetches, reads a clock, or randomises.
 */

/** Where the rent a report quotes actually came from. */
export type RentEvidenceSource =
  /** A figure the operator typed on the override form. */
  | 'override'
  /** A figure carried by the listing or the property record. */
  | 'listing'
  /** The rent the financial engine used, including a market lookup. */
  | 'market_lookup'
  /** Nothing established it. */
  | 'none';

export interface RentalEvidenceInput {
  /** `mergedOverrides.weeklyRent`. */
  readonly overrideWeeklyRent?: unknown;
  /** `propertyDetails.weeklyRent`. */
  readonly listingWeeklyRent?: unknown;
  /**
   * `financials.income.weeklyRent` — the exact rental input every projection
   * describes. The calculator persists it for precisely this reason, and it is
   * the only place the market lookup survives into.
   */
  readonly calculatedWeeklyRent?: unknown;
  /** `mergedOverrides.occupancyRate`, in WEEKS per year, not a percentage. */
  readonly occupancyWeeks?: unknown;
}

export interface RentalEvidence {
  /** Dollars per week, or null when nothing established one. */
  readonly weeklyRent: number | null;
  /** `weeklyRent × occupancyWeeks`, or null. Never 0 standing in for null. */
  readonly annualRent: number | null;
  readonly occupancyWeeks: number;
  readonly source: RentEvidenceSource;
  /** True exactly when a figure may be quoted. */
  readonly established: boolean;
}

/**
 * Weeks let per year. 52 is the industry convention for an investment
 * analysis and is what the prompt's own calculation rules state; it is a
 * modelling assumption rather than an observation, which is why it is named
 * here rather than buried in an expression.
 */
export const DEFAULT_OCCUPANCY_WEEKS = 52;

/** What a reader sees where a figure would be, when there is no evidence. */
export const NOT_ESTABLISHED = 'Not established';

const positiveNumber = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Resolve the one rent, in the calculator's own order.
 *
 * A property genuinely let at $0 a week does not exist; every zero in this
 * chain means "not captured", which is why the guard is `> 0` rather than
 * `!= null`. That is also what makes the resolution safe to adopt: where a
 * rent was typed or carried, this returns the same number the old expression
 * did, so a report with rental evidence is unchanged to the digit.
 */
export function resolveRentalEvidence(input: RentalEvidenceInput): RentalEvidence {
  const occupancyWeeks = positiveNumber(input.occupancyWeeks) ?? DEFAULT_OCCUPANCY_WEEKS;

  const candidates: Array<[RentEvidenceSource, number | null]> = [
    ['override', positiveNumber(input.overrideWeeklyRent)],
    ['listing', positiveNumber(input.listingWeeklyRent)],
    ['market_lookup', positiveNumber(input.calculatedWeeklyRent)],
  ];

  for (const [source, weeklyRent] of candidates) {
    if (weeklyRent !== null) {
      return {
        weeklyRent,
        annualRent: Math.round(weeklyRent * occupancyWeeks * 100) / 100,
        occupancyWeeks,
        source,
        established: true,
      };
    }
  }

  return { weeklyRent: null, annualRent: null, occupancyWeeks, source: 'none', established: false };
}

// ---------------------------------------------------------------------------
// Saying it on the page
// ---------------------------------------------------------------------------

/**
 * A percentage, or the honest absence of one.
 *
 * The `%` sign belongs INSIDE this function. Every call site used to read
 * `${preCalculatedGrossYield}%`, so a null there would have printed
 * "null%" — the shape of a defect rather than a disclosure.
 */
export function statedYield(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? NOT_ESTABLISHED : `${value}%`;
}

/**
 * Thousands separators without asking the runtime what country it is in.
 *
 * `toLocaleString()` with no locale takes the reader's machine, which is how
 * an Australian reporting entity came to print `8/29/2029`; the investment
 * modules are held to a stricter version of that rule and may not name it at
 * all. This is the same expression `figures.pure.ts` and
 * `financialEngine.pure.ts` already use.
 */
const grouped = (n: number): string =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A dollar figure, or the honest absence of one. */
export function statedMoney(value: number | null | undefined): string {
  return value === null || value === undefined
    ? NOT_ESTABLISHED
    : `$${grouped(Math.round(value))}`;
}

/** `$650`, or the honest absence of one. */
export function statedWeeklyRent(evidence: RentalEvidence): string {
  return evidence.weeklyRent === null
    ? NOT_ESTABLISHED
    : `$${grouped(Math.round(evidence.weeklyRent))}`;
}

/**
 * The instruction that has to travel WITH an absent yield.
 *
 * A model handed a blank where a number should be will fill it — that is what
 * it is for. The old code handed it `0.00%` and an order to use the figure
 * exactly; handing it "Not established" without also forbidding an estimate
 * simply moves the invention one step later. This is deliberately phrased as
 * what to write instead, because an instruction with no permitted action is
 * one a model routes around.
 */
export function absentRentDirective(evidence: RentalEvidence): string {
  if (evidence.established) return '';
  return [
    '',
    '**NO RENTAL EVIDENCE FOR THIS PROPERTY.** No weekly rent was supplied and no',
    'market rent could be established, so the gross yield, the net yield and the',
    'annual rental income are NOT AVAILABLE for this report.',
    '',
    '- Do NOT estimate, infer or substitute a rent, a yield or a rental income.',
    '- Where a yield or rental figure would appear, write "Not established" and',
    '  state in one sentence that no rental evidence was available.',
    '- You MAY still discuss rental demand, tenant profile and market conditions',
    '  qualitatively, provided you attach no number to this property\'s rent.',
    '',
  ].join('\n');
}

/**
 * Does a stored `income` block establish a rent at all?
 *
 * ## Why this is here and not inlined at each renderer
 *
 * The rule above stops the GENERATOR quoting a rent it does not have. It said
 * nothing about the figures DERIVED from that rent on the way back out, and
 * the read path kept them: measured 2026-09-07 against
 * `Lot 2267 Hunza Road TRUGANINA`, whose `income` is null outright,
 * `composeFinancialChapters` renders
 *
 *     ## Rental Assessment, Gross Yield & Net Yield
 *     Recorded rental income and the yields it produces against the purchase price.
 *     | Gross rental yield | 4.05% |
 *     | Net rental yield   | 2.57% |
 *
 * — a section headed "Recorded rental income" containing none, because the
 * weekly and annual rows correctly suppressed themselves while the two
 * figures computed FROM them did not. The absence discipline was applied to
 * the inputs and not to what depends on them, which is the one arrangement
 * that reads as a working page while asserting a return on an income the
 * record does not hold. 16 stored reports are in that state.
 *
 * So the question is asked once, here, and the three renderers that print a
 * yield ask it rather than each deciding — the same reason `healFinanceIdentity`
 * lives beside the engine rather than in every reader.
 *
 * A zero rent is NOT establishment. `income.weeklyRent === 0` is the shape the
 * original defect wrote, and treating it as evidence would readmit every
 * `0.00%` this module exists to have removed.
 */
export function rentIsEstablished(income: unknown): boolean {
  if (income === null || typeof income !== 'object') return false;
  const r = income as Record<string, unknown>;
  const positive = (v: unknown): boolean => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : NaN;
    return Number.isFinite(n) && n > 0;
  };
  return positive(r.weeklyRent)
    || positive(r.annualRent)
    || positive(r.grossAnnualRent)
    || positive(r.annual);
}
