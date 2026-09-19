/**
 * ME-4 — the Dimension Ownership Matrix.
 *
 * Every input the scoring system may read, with **exactly one** primary owner,
 * the dimensions forbidden from reading it, and the reason. Declarative and
 * enforceable: `dimensionOwnershipSpec.test.ts` reads the ME-3 modules' source
 * and fails when a scorer touches evidence it does not own, so "measure one
 * characteristic once" is checked rather than promised.
 *
 * ## What the live engine actually does (measured 2026-09-08)
 *
 * Extracting each dimension scorer's body from `investment-scoring-service`
 * and listing the `input.*` it reads gives five inputs read by two dimensions:
 *
 * | input | read by | verdict |
 * | --- | --- | --- |
 * | `vacancyRate` | Demand, Risk | **duplicate** — Risk's own reason string says *"weak rental demand"* |
 * | `daysOnMarket` | Demand, Risk | **duplicate** — Risk's string says *"indicates weak demand"* |
 * | `cashFlow` | Yield, Risk | **duplicate** — the ME-3 yield double-count; already removed from Yield |
 * | `priceGrowth1Year` | Growth, Risk | **declared exception**, see {@link DECLARED_EXCEPTIONS} |
 * | `propertyPrice` | Yield, Demand | not a duplicate: a yield denominator and a price-to-median ratio are different quantities. The Demand use is a VALUATION characteristic and moves out of Demand regardless. |
 *
 * `populationGrowth` is read by exactly one dimension — but the wrong one. It
 * sits in `calculateGrowthScore`, adding 10 points on the stated grounds that
 * it *"drives demand"*, inside the dimension that measures capital growth.
 * People arriving is a reason to expect demand, not evidence that values rose.
 *
 * ## Two rules
 *
 * **An owner is the dimension whose QUESTION the input answers**, not the one
 * that happens to read it first. Vacancy answers "can this be let?", which is
 * Demand's question; Risk asking it again does not make Risk a co-owner.
 *
 * **A shared input needs a declared exception, never silence.** Where one
 * measurement legitimately informs two dimensions, it is listed below with its
 * rationale and its measured magnitude, so the composite's behaviour is a
 * design decision on the record rather than an accident nobody noticed.
 */

/** The five scored dimensions, plus the two homes for evidence none of them owns. */
export type Dimension = 'growth' | 'demand' | 'yield' | 'location' | 'risk';

/**
 * Where an input belongs when no scored dimension owns it.
 *
 * `valuation` and `economic` are real analytical concerns that are not
 * dimensions of this composite; `none` means the input should not be scored at
 * all. Naming them beats deleting the row, because a reader asking "why isn't
 * the median price scored?" gets an answer.
 */
export type NonDimensionOwner = 'valuation' | 'economic' | 'finance' | 'none';

export interface OwnershipEntry {
  /** The input, named as `MarketEvidence` names it where it exists there. */
  input: string;
  owner: Dimension | NonDimensionOwner;
  /** Why this owner and not another — the question the input answers. */
  rationale: string;
  /** Dimensions that must never score it. Empty when nothing contests it. */
  forbiddenTo: ReadonlyArray<Dimension>;
}

export const DIMENSION_OWNERSHIP: ReadonlyArray<OwnershipEntry> = [
  // --- Growth: capital movement, and only capital movement -----------------
  { input: 'growth1Year', owner: 'growth', forbiddenTo: ['demand', 'location', 'yield'],
    rationale: 'Capital movement over one horizon.' },
  { input: 'growth3YearCagr', owner: 'growth', forbiddenTo: ['demand', 'location', 'yield'],
    rationale: 'Capital movement over one horizon.' },
  { input: 'growth5YearCagr', owner: 'growth', forbiddenTo: ['demand', 'location', 'yield'],
    rationale: 'Capital movement over one horizon.' },
  { input: 'growth10YearCagr', owner: 'growth', forbiddenTo: ['demand', 'location', 'yield'],
    rationale: 'Capital movement over one horizon.' },
  { input: 'priceSeries', owner: 'growth', forbiddenTo: ['demand', 'location', 'yield', 'risk'],
    rationale: 'The path the CAGRs are blind to; consistency is measured on it.' },
  { input: 'benchmarkGrowth1Year', owner: 'growth', forbiddenTo: ['demand', 'location', 'yield', 'risk'],
    rationale: 'The wider market the subject is judged against.' },
  { input: 'benchmarkGrowth3YearCagr', owner: 'growth', forbiddenTo: ['demand', 'location', 'yield', 'risk'],
    rationale: 'The wider market the subject is judged against.' },
  { input: 'benchmarkGrowth5YearCagr', owner: 'growth', forbiddenTo: ['demand', 'location', 'yield', 'risk'],
    rationale: 'The wider market the subject is judged against.' },

  // --- Demand: whether the market wants it -------------------------------
  { input: 'vacancyRate', owner: 'demand', forbiddenTo: ['risk', 'yield'],
    rationale: 'Answers "can this be let?". Yield measures the rent LEVEL; this measures whether it lets at all.' },
  { input: 'daysOnMarket', owner: 'demand', forbiddenTo: ['risk'],
    rationale: 'Answers "how hard do buyers compete?".' },
  { input: 'vendorDiscount', owner: 'demand', forbiddenTo: ['risk'],
    rationale: 'The same question as days on market, through a second lens.' },
  { input: 'auctionClearanceRate', owner: 'demand', forbiddenTo: ['risk'],
    rationale: 'The same question again, through a third lens.' },
  { input: 'salesCount', owner: 'demand', forbiddenTo: ['growth'],
    rationale: 'Turnover; meaningful only against stock advertised.' },
  { input: 'listingActivity', owner: 'demand', forbiddenTo: ['growth'],
    rationale: 'Stock on market, the denominator of absorption.' },
  { input: 'populationGrowth', owner: 'demand', forbiddenTo: ['growth'],
    rationale: 'A demand DRIVER. People arriving is not evidence that values rose, and it must never inflate Capital Growth.' },

  // --- Yield: the rental return, measured once ----------------------------
  { input: 'weeklyRent', owner: 'yield', forbiddenTo: ['demand'],
    rationale: 'The rent level against the basis amount.' },
  { input: 'medianRent', owner: 'yield', forbiddenTo: ['demand'],
    rationale: 'The market rent level; the same characteristic as the property’s own rent.' },
  { input: 'basisAmount', owner: 'yield', forbiddenTo: [],
    rationale: 'The yield denominator. Its BASIS is part of the call, never defaulted.' },
  { input: 'annualOutgoings', owner: 'yield', forbiddenTo: ['risk'],
    rationale: 'A property operating cost, so it belongs to the unlevered return.' },

  // --- Location: where it is, not how its market performed ----------------
  { input: 'walkScore', owner: 'location', forbiddenTo: [],
    rationale: 'Amenity accessibility on foot.' },
  { input: 'commuteTimeCBD', owner: 'location', forbiddenTo: [],
    rationale: 'Accessibility to employment; a property of the place, not of its market.' },
  { input: 'schoolsNearby', owner: 'location', forbiddenTo: [],
    rationale: 'Amenity that is fixed to the site and cannot be inferred from market performance.' },
  { input: 'state', owner: 'none', forbiddenTo: ['location', 'growth', 'demand', 'yield', 'risk'],
    rationale:
      'NOT a locational characteristic. The live scorer awards up to 15 points by state — every property '
      + 'in NSW gets the same 15 whether it is in Mosman or 700 km inland, and prints "Major capital city '
      + 'location" for a rural address. That is a market-strength proxy assigned by postcode prefix, and it '
      + 'is audit §48’s failure in miniature.' },

  // --- Risk: what could go wrong that nothing else has counted ------------
  //
  // Model D (ME-5.1, adopted into the composition at shadow 2.1.0): Risk owns
  // property-level risk observations (hazard, planning, condition, strata,
  // supply concentration, delivery), read through the per-class schema in
  // `../risk/propertyRiskSchema.pure.ts`. The three rows below moved OUT of
  // the dimension:
  { input: 'lvr', owner: 'finance', forbiddenTo: ['growth', 'demand', 'yield', 'location', 'risk'],
    rationale:
      'Leverage is the BUYER’s position, not the property’s. 1 Boxer Drive, Wyndham Vale carries two '
      + 'same-day reports at the same price, one at 80% LVR and one at 90% — under the old model that was '
      + '12.8 points of Risk for a number an operator typed. Read only by the Finance Suitability reading, '
      + 'which is structurally unable to reach the composite.' },
  { input: 'weeklyCashFlow', owner: 'finance', forbiddenTo: ['growth', 'demand', 'yield', 'location', 'risk'],
    rationale:
      'Serviceability. A fact about the loan, the deposit and the tax position — never about the property. '
      + 'Disclosed twice, scored nowhere: the Finance Suitability band, and Yield’s holding-cash-flow signal.' },
  { input: 'propertyType', owner: 'risk', forbiddenTo: ['growth', 'demand', 'yield', 'location'],
    rationale:
      'SELECTS the property-risk schema (which questions apply to a house, a unit, a land purchase) and '
      + 'contributes zero points — Model D’s first rule. An asset-type score was a type bonus wearing a '
      + 'risk label, and the placeholder "Residential Property" was collecting the house reading.' },

  // --- Owned by nothing this composite scores -----------------------------
  { input: 'medianPrice', owner: 'valuation', forbiddenTo: ['demand', 'growth'],
    rationale: 'Price relative to a median is VALUE, not demand. It counted towards Demand’s hasData and was never scored.' },
  { input: 'benchmarkMedianPrice', owner: 'valuation', forbiddenTo: ['demand', 'growth'],
    rationale: 'The same characteristic at a wider geography.' },
  { input: 'unemploymentRate', owner: 'economic', forbiddenTo: ['demand', 'risk'],
    rationale: 'A labour-market fact, not a property-market one.' },
];

/**
 * Inputs one dimension owns but another may legitimately read, and why.
 *
 * The brief's rule: an input may materially affect two dimensions only where
 * that is *explicitly designed and documented*. This is that document, and a
 * test asserts nothing outside it is shared.
 */
export const DECLARED_EXCEPTIONS: ReadonlyArray<{
  input: string;
  owner: Dimension;
  alsoRead: Dimension;
  rationale: string;
  /** Which direction the second reader moves the score, so the two cannot silently agree. */
  direction: 'opposes' | 'reinforces';
  magnitude: string;
}> = [
  {
    input: 'growth1Year',
    owner: 'growth',
    alsoRead: 'risk',
    direction: 'opposes',
    rationale:
      'Growth rewards realised twelve-month performance; Risk prices the probability that it reverses. '
      + 'A market that has run hard is genuinely more likely to correct, so these are different economic '
      + 'questions about one number rather than the same reward twice — and they move the composite in '
      + 'OPPOSITE directions, which is what distinguishes a designed interaction from a double-count.',
    magnitude:
      'At 22% growth: momentum contributes about +4.0 composite points via Growth (0.40 × 0.10 × 100) '
      + 'against about −0.9 via Risk (0.05 × 18). Growth dominates roughly 4:1, so the risk term '
      + 'refines the reading and cannot invert it.',
  },
];

/** The owner of an input, or null when the matrix does not name it. */
export function ownerOf(input: string): Dimension | NonDimensionOwner | null {
  return DIMENSION_OWNERSHIP.find((e) => e.input === input)?.owner ?? null;
}

/** May `dimension` read `input`? Owners may; declared exceptions may; nobody else. */
export function mayRead(dimension: Dimension, input: string): boolean {
  const entry = DIMENSION_OWNERSHIP.find((e) => e.input === input);
  if (!entry) return false;
  if (entry.owner === dimension) return true;
  return DECLARED_EXCEPTIONS.some((x) => x.input === input && x.alsoRead === dimension);
}

/** Every input a dimension owns. */
export function inputsOwnedBy(dimension: Dimension | NonDimensionOwner): ReadonlyArray<string> {
  return DIMENSION_OWNERSHIP.filter((e) => e.owner === dimension).map((e) => e.input);
}
