/**
 * Governed narrative authority — a withheld fact may not be re-sourced.
 *
 * ## The defect this closes, measured in production
 *
 * RF-7.2B.1's Client-Safe Gate withholds demographics, SEIFA and employment
 * when no trusted geography is available. Two reports generated on 2026-09-11
 * through the real pipeline (`09f8569e…` Cowra, `3fbbcfe6…` Muswellbrook) had
 * `market.demographics` recorded `absent` in `market_fact_snapshot` — and both
 * documents then stated demographic figures anyway:
 *
 *   "According to the Australian Bureau of Statistics 2021 Census,
 *    Muswellbrook township recorded 12,272 residents, with a median age of 35"
 *
 * `abs_census_poa` for POA 2333 holds **13,795** and median age **36**. The
 * figures are not the platform's; they came from the section generator, which
 * is Perplexity `sonar-pro` — a SEARCH-GROUNDED model. Withholding the
 * authoritative number did not remove the claim, it removed the source: the
 * prompt still asked for a demographics section, so the model searched, and
 * wrote what it found under an ABS citation at a geography nobody asked for
 * (township, SA2, LGA, ERP — never the subject postal area).
 *
 * Three things were true at once and each was necessary:
 *
 *  1. **The withholding never reached the prompt.** `safeGeneration.removed`
 *     was `console.log`ged and nothing else, so the model was never told a
 *     category was unavailable, only handed a context without it.
 *  2. **The post-generation audit could not see it.** `auditMarketClaims` is
 *     VALUE-anchored — it finds a number it already holds and checks the prose
 *     around it (`if (fact.status !== 'present') continue`). A withheld fact
 *     has no value to anchor on, so nothing was checked.
 *  3. **Each half assumed the other covered it.** `marketClaimAudit`'s header
 *     said a mention of a withheld figure was "a different defect that the
 *     fact reconciliation already looks for". It does not:
 *     `factReconciliation.pure.ts` contains no occurrence of `withheld`,
 *     `absent`, `demographic` or `population`. Neither module covered it.
 *
 * ## The invariant
 *
 * **A governed market fact may be narrated quantitatively only when an
 * admissible corresponding fact exists in `market_fact_snapshot`.**
 *
 * This module is both halves of that, deliberately in ONE file: the directive
 * the prompt carries and the audit that checks the result read the same
 * category table. Two copies of "which categories are governed" is exactly how
 * the two modules above drifted apart.
 *
 * ## Why detection is sentence-scoped
 *
 * A governed TERM alone is not a claim — "tenants are typically local workers,
 * families and retirees rather than transient short-stay populations" says
 * nothing quantitative and must pass. A NUMBER alone is not a claim either —
 * "the near-1,000 m² land size" is the property's own fact. The claim is the
 * two together, in one sentence. Scoping to the sentence rather than a
 * character window is what stops a land size three clauses away from being
 * read as a population count.
 *
 * Bare four-digit years are excluded from what counts as quantitative, because
 * "the 2021 Census" beside the word "population" is an attribution, not a
 * figure. A genuine population of exactly 2,021 people written without its
 * separator would be missed; that is the conservative side of the trade and it
 * is preferred to blocking a report for citing a census year.
 *
 * Pure: no Deno, no DOM, no network, no clock.
 */

import type { MarketFactSnapshot, SnapshotFact } from './safeGenerationInputs.pure.ts';

export const GOVERNED_NARRATIVE_AUTHORITY_VERSION = '1.0.0';

export type GovernedCategory = 'demographics' | 'seifa' | 'employment';

/** How a category stands for one report. */
export type CategoryStanding = 'admissible' | 'withheld';

export type GovernedFaultKind =
  | 'substituted_figure'
  | 'false_attribution'
  | 'cross_grain_substitution';

export interface GovernedClaimFault {
  readonly category: GovernedCategory;
  /** The specific figure, so two missing figures in one category both report. */
  readonly topic: string;
  readonly kind: GovernedFaultKind;
  /** The sentence the claim was found in, trimmed for a reviewer. */
  readonly excerpt: string;
  readonly message: string;
}

/**
 * Authority is per FACT, not per category — proved from the gate, not assumed.
 *
 * `activateSafeGenerationInputs` emits one snapshot fact per narrated metric:
 *
 *     for (const metric of SNAPSHOT_ABS_METRICS)
 *       facts.push(gateFact({ name: metric.name,
 *                             value: readPath(demographics, metric.path), … }))
 *
 * A path the ABS row does not carry yields an ABSENT fact standing beside
 * present siblings, so `population` present with `medianAge` absent is a state
 * the gate can really produce. SEIFA is looser still — `if (!isRecord(
 * seifa[index])) continue` emits NO fact for a missing index — and industry
 * shares are capped at `SNAPSHOT_INDUSTRY_ROWS`, so an unlisted industry has
 * no fact either.
 *
 * The categories are therefore NOT atomic, and a category-level reading would
 * let one present figure authorise every absent one beside it: exactly the
 * substitution this module exists to refuse, performed with the module's own
 * blessing. Standing is resolved per topic, against the facts that topic owns.
 *
 * A topic with `owns: null` has no fact of its own in the snapshot vocabulary
 * — average household size is narrated but never snapshotted individually — so
 * it is evidenced by the category roll-up instead. That keeps a healthy report
 * free to state it while a withheld one still cannot invent it.
 */
interface TopicSpec {
  readonly topic: string;
  readonly category: GovernedCategory;
  readonly label: string;
  /** Snapshot facts that evidence this topic; null = the category roll-up does. */
  readonly owns: ((factName: string) => boolean) | null;
  /** Governed labels as they appear in prose. */
  readonly terms: RegExp;
}

/** The roll-up each category carries, used only by `owns: null` topics. */
const UMBRELLA: Record<GovernedCategory, string> = {
  demographics: 'market.demographics',
  seifa: 'market.demographics',
  employment: 'market.demographics',
};

const TOPICS: readonly TopicSpec[] = [
  {
    topic: 'population',
    category: 'demographics',
    label: 'resident population',
    owns: (n) => n === 'market.population' || n === 'abs.population',
    terms: /\b(population|residents?)\b/gi,
  },
  {
    topic: 'medianAge',
    category: 'demographics',
    label: 'median age',
    owns: (n) => n === 'market.medianAge' || n === 'abs.medianAge',
    terms: /\bmedian age\b/gi,
  },
  {
    topic: 'income',
    category: 'demographics',
    label: 'median income',
    owns: (n) =>
      n === 'market.medianHouseholdIncomeWeekly'
      || n === 'abs.medianHouseholdIncomeAnnual'
      || n === 'abs.medianWeeklyIncome',
    terms: /\bmedian (?:weekly |annual )?(?:household |personal |family )?income\b/gi,
  },
  {
    topic: 'medianRent',
    category: 'demographics',
    label: 'median rent',
    owns: (n) => n === 'market.medianRentWeekly',
    terms: /\bmedian rent\b/gi,
  },
  {
    topic: 'medianMortgage',
    category: 'demographics',
    label: 'median mortgage repayment',
    owns: (n) => n === 'market.medianMortgageMonthly',
    terms: /\bmedian mortgage\b/gi,
  },
  {
    topic: 'tenure',
    category: 'demographics',
    label: 'tenure split',
    owns: (n) => n === 'market.ownerOccupierRate' || n === 'market.renterRate',
    // Plurals matter: the defect corpus contains a model-drawn occupier-mix
    // chart reading `Local owner-occupiers 35`, which asserts an
    // owner-occupier RATE, and `owner[- ]occupier` alone does not match it.
    terms: /\b(owner[-\u2010\u2011\u2012\u2013\u2014 ]occupiers?|renters?|rented dwellings?|tenure)\b/gi,
  },
  {
    topic: 'householdSize',
    category: 'demographics',
    label: 'average household size',
    owns: null,
    terms: /\bhousehold size\b/gi,
  },
  {
    topic: 'seifaIrsd',
    category: 'seifa',
    label: 'the IRSD index',
    owns: (n) => n === 'abs.seifa.irsd' || n === 'abs.seifa.irsdDecile',
    terms: /\birsd\b/gi,
  },
  {
    topic: 'seifaIrsad',
    category: 'seifa',
    label: 'the IRSAD index',
    owns: (n) => n === 'abs.seifa.irsad' || n === 'abs.seifa.irsadDecile',
    terms: /\birsad\b/gi,
  },
  {
    topic: 'seifaIer',
    category: 'seifa',
    label: 'the IER index',
    owns: (n) => n === 'abs.seifa.ier' || n === 'abs.seifa.ierDecile',
    terms: /\bier\b/gi,
  },
  {
    topic: 'seifaIeo',
    category: 'seifa',
    label: 'the IEO index',
    owns: (n) => n === 'abs.seifa.ieo' || n === 'abs.seifa.ieoDecile',
    terms: /\bieo\b/gi,
  },
  {
    topic: 'seifaGeneral',
    category: 'seifa',
    label: 'SEIFA socio-economic ranking',
    owns: (n) => n.startsWith('abs.seifa.'),
    terms: /\b(seifa|socio[-\u2010\u2011\u2012\u2013\u2014 ]economic (?:index|advantage|disadvantage)|decile)\b/gi,
  },
  {
    topic: 'unemployment',
    category: 'employment',
    label: 'the unemployment rate',
    owns: (n) => n === 'abs.unemploymentRate' || n === 'market.unemploymentRate',
    terms: /\bunemployment rate\b/gi,
  },
  {
    topic: 'participation',
    category: 'employment',
    label: 'the labour-force participation rate',
    owns: (n) => n === 'abs.labourForceParticipation' || n === 'market.participationRate',
    terms: /\bparticipation rate\b/gi,
  },
  {
    topic: 'labourForce',
    category: 'employment',
    label: 'the labour force',
    owns: (n) => n === 'abs.labourForce' || n === 'abs.employmentRate',
    terms: /\b(labour force|labor force|employed residents?|employment rate)\b/gi,
  },
  {
    topic: 'industryShare',
    category: 'employment',
    label: 'workforce composition by industry',
    owns: (n) => n.startsWith('abs.industryShare.'),
    terms: /\b(industry share|workforce|largest (?:single )?industry|employing)\b/gi,
  },
];

/** What each category's directive forbids, named rather than gestured at. */
const CATEGORY_BANNED: Record<GovernedCategory, readonly string[]> = {
  demographics: [
    'a population or resident count',
    'a median age',
    'a median household, personal or family income',
    'a median rent or mortgage figure',
    'an owner-occupier, renter or tenure percentage',
  ],
  seifa: [
    'a SEIFA score or decile',
    'an IRSD, IRSAD, IER or IEO figure',
    'a socio-economic ranking expressed as a number',
  ],
  employment: [
    'an unemployment or participation rate',
    'a labour-force or employed-persons count',
    'an industry share or workforce percentage',
  ],
};

const CATEGORY_LABEL: Record<GovernedCategory, string> = {
  demographics: 'resident demographics',
  seifa: 'SEIFA socio-economic indexes',
  employment: 'workforce and employment composition',
};

const ALL_CATEGORIES: readonly GovernedCategory[] = ['demographics', 'seifa', 'employment'];

/** Attribution to an official statistical source. */
const ATTRIBUTION =
  /\b(australian bureau of statistics|\babs\b|census|\bnema\b|areasearch|id\.community|profile\.id)\b/i;

/** A geography that is not the subject postal area. */
const OTHER_GRAIN =
  /\b(sa2|sa3|sa4|\blga\b|local government area|township|shire|erp|estimated resident population|statistical area)\b/i;

/**
 * A quantitative token. Currency, percentages and separated thousands are
 * always quantitative; a bare integer counts too, except where it is a plain
 * four-digit year (see the header for why that trade is taken this way).
 */
const QUANT = /\$\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\b\d+(?:\.\d+)?\b/g;

/**
 * A figure this sentence has already attributed to something that is NOT a
 * governed category — the property's own facts and the deal's finance.
 *
 * Checked against the text immediately BEFORE each figure, because that is
 * where the attribution sits: "the local tenant population and was purchased
 * for $555,000" carries a governed term and a figure in one sentence, and the
 * figure is the purchase price. Without this the detector blocks a report for
 * quoting what the customer paid.
 *
 * Deliberately absent from this list: income, rent as a MEDIAN, tenure and
 * anything else that is itself a governed category — `median rent` and
 * `median household income` must keep firing.
 */
const NON_GOVERNED_ATTRIBUTION =
  /\b(purchased|purchase price|bought|sold|sale price|price|valued at|valuation|leased at|let at|rented at|renting at|asking rent|rents for|stamp duty|solicitor|conveyanc|loan|deposit|lvr|loan[- ]to[- ]value|interest rate|repayment|land size|block of|build size|floor area|bedrooms?|bathrooms?|car spaces?|settlement|occupancy|insurance|council rates|water rates|strata|body corporate|management fee|letting fee|depreciation|yield|cash flow|per week|per annum|m²|sqm|square metres)\b[^.]{0,34}$/i;

/**
 * The SAME attribution, on the other side of the figure.
 *
 * RF-7.2B.1A.1. Production writes the property's own measurements value-first
 * — "The property's large 988 m² land size drives demand from families and
 * long-term renters" — and the lookbehind sees only "The property's large ",
 * which carries no attribution at all. The report was blocked for quoting its
 * own land size beside the word "renters". The fixture above is that exact
 * sentence.
 *
 * Anchored at `^`, so only the text IMMEDIATELY after the figure can exempt
 * it: a governed term elsewhere in the sentence cannot reach back and excuse a
 * figure that is genuinely a demographic claim. A unit of measure is allowed
 * between the number and the noun, because that is how the phrase reads.
 */
const NON_GOVERNED_ATTRIBUTION_AFTER =
  /^\s*(?:m²|m2|sqm|sq\.?\s?m|square metres?|ha|hectares?|%|p\.?a\.?|per week|per annum|per month)?[\s,.\-–—]*\b(purchase price|purchased|bought|sold|sale price|price|valuation|stamp duty|solicitor|conveyanc|loan|deposit|lvr|loan[- ]to[- ]value|interest rate|repayment|land size|land area|block|build size|floor area|bedrooms?|bathrooms?|car spaces?|settlement|occupancy|insurance|council rates|water rates|strata|body corporate|management fee|letting fee|depreciation|yield|cash flow)\b/i;

/**
 * The street number of an address, and a measured distance or duration.
 *
 * RF-7.2B.1A.1, found by replaying the retained production report rather than
 * by inspection. Four more units were refused over prose like "48 Redfern
 * Street sits within an established residential pocket of Cowra, giving
 * residents close access to local parks" — the STREET NUMBER read as a figure
 * beside the word "residents" — and "sports fields within roughly 1–3
 * kilometres, and river-corridor recreation reachable with a short 5–10 minute
 * drive". An address and an amenity distance are not demographic claims.
 *
 * Both are anchored immediately after the figure. `years` is deliberately NOT
 * a duration here: "a median age of 36 years" must keep firing.
 */
const STREET_ADDRESS_AFTER =
  /^\s+[A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*)*\s+(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Place|Pl|Crescent|Cres|Way|Lane|Ln|Parade|Pde|Terrace|Tce|Close|Circuit|Cct|Boulevard|Blvd|Highway|Hwy|Esplanade|Esp)\b/;
const MEASUREMENT_AFTER =
  /^\s*(?:[–—-]\s*\d+(?:\.\d+)?\s*)?(?:km|kilometres?|kms|metres?|minutes?|mins?|hours?|hrs?|months?|weeks?|days?)\b/i;

/** Characters of context examined for that attribution, either side. */
const ATTRIBUTION_LOOKBEHIND = 46;
const ATTRIBUTION_LOOKAHEAD = 34;

/**
 * Recorded-crime evidence this platform actually loads (`crime_reference`).
 *
 * RF-7.2B.1A.1. A crime rate is quoted "per 100,000 residents", and a crime
 * count sits beside the word "incidents" — so a BOCSAR sentence carries a
 * governed term and several figures, and was blocked as a demographic claim.
 * Crime is a different, genuinely loaded source; it is not demographics.
 *
 * The exemption needs BOTH halves and is deliberately not a keyword pass:
 * the unit must carry recognised crime-source evidence, AND the individual
 * figure must sit in crime or rate context. "BOCSAR reports 1,144 offences;
 * the population is 13,795" therefore still blocks on the population figure,
 * because its own window names no crime.
 */
const CRIME_SOURCE =
  /\b(bocsar|qps|queensland police|sapol|nt police|police force|recorded criminal incidents?|recorded offences?|criminal incidents?|recorded crime|crime rate|offence rate)\b/i;

/**
 * "per 100,000 residents" is a RATE DENOMINATOR, not a population claim.
 *
 * Masked out before a crime unit is judged, because it otherwise supplies both
 * a figure (100,000) and a governed term ("residents") to a sentence that is
 * about offences. Replaced with spaces rather than removed so every remaining
 * offset still lines up.
 */
const RATE_DENOMINATOR = /per\s+100,?000\s+(?:residents?|people|persons|population)/gi;

/**
 * How close a governed term must be to a figure, inside a crime unit, for that
 * figure to be a demographic claim rather than a crime statistic.
 *
 * The rule is inverted here on purpose. A window that merely LOOKED for crime
 * vocabulary near the figure exempted "BOCSAR records 1,144 offences; the
 * median age is 41" — "offences" sat 15 characters from the 41. Asking instead
 * whether a GOVERNED term is adjacent cannot be satisfied by an unrelated
 * crime word elsewhere in the sentence.
 */
const CRIME_GOVERNED_PROXIMITY = 24;

/**
 * There is deliberately NO disclosure or negation exemption.
 *
 * RF-7.2B.1A.1 first carried one: a unit naming an explicit absence
 * ("could not be established") was exempt while no surviving figure sat within
 * 40 characters of the topic it disclaimed. The adversarial pass then showed
 * the distance IS the evasion — state the term once, push the figure past the
 * window, and an unsupported claim rides through on the disclaimer:
 *
 *   "Median age could not be established from authoritative sources for this
 *    particular postal area, but other commentary sources put it at about 41."
 *   "Population statistics could not be established ... and after considerable
 *    additional desktop review the number appears to be 12,272."
 *   "SEIFA scores could not be established ... though secondary commentary
 *    elsewhere indicates a score of about 947."
 *
 * All three passed on a 40-character window, and any fixed window has the same
 * hole one clause further out. The rule is therefore GONE rather than widened:
 * it could only ever permit, the production disclosure needs no exemption
 * because the subject-postcode rule already leaves it with no figure at all,
 * and deleting the parameter removes the thing there was to game.
 *
 * A disclosure carrying a genuinely unexempt figure now blocks. That is the
 * conservative side of a client-delivery gate, and it is a shape production
 * has never produced.
 */

/** Context a claim unit is judged in. */
export interface GovernedAuditContext {
  /** The subject property's own postcode, when the report names one. */
  readonly subjectPostcode?: string | null;
}

/**
 * Is this four-digit token the subject property's own postcode, in postcode
 * position?
 *
 * RF-7.2B.1A.1. "the specific 2794 postal area" read as a figure, so naming
 * the postal area that has no data was itself treated as stating a figure for
 * it. Deliberately NOT "four-digit numbers are harmless": the token must equal
 * the subject postcode AND sit immediately beside a postcode marker, so a real
 * four-digit governed figure — "a population of 2794 residents" — is still a
 * figure even when the postcode happens to be 2794.
 */
function isSubjectPostcode(
  token: string, before: string, after: string, subjectPostcode: string | null | undefined,
): boolean {
  if (!subjectPostcode || token !== subjectPostcode) return false;
  return /\b(?:nsw|vic|qld|sa|wa|tas|nt|act)\s*$/i.test(before)
    || /\b(?:postcode|postal area|poa)\s*$/i.test(before)
    || /^\s*(?:postal area|postcode|poa)\b/i.test(after);
}

/** Is a term for any withheld topic within `CRIME_GOVERNED_PROXIMITY` of this figure? */
function governedTermNear(
  sentence: string, index: number, length: number, withheld: readonly TopicSpec[],
): boolean {
  for (const spec of withheld) {
    const terms = new RegExp(spec.terms.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = terms.exec(sentence)) !== null) {
      const gap = index >= m.index
        ? index - (m.index + m[0].length)
        : m.index - (index + length);
      if (gap <= CRIME_GOVERNED_PROXIMITY) return true;
    }
  }
  return false;
}

interface Figure { readonly token: string; readonly index: number; readonly length: number; }

/**
 * The figures in this unit that ARE a claim — every exemption applied.
 *
 * Replaces the boolean `hasQuantitativeAssertion`: the disclosure rule needs
 * to know WHERE the surviving figures are, not merely whether any exist.
 */
function unexemptFigures(
  sentence: string, ctx: GovernedAuditContext, withheld: readonly TopicSpec[] = TOPICS,
): Figure[] {
  const out: Figure[] = [];
  const crimeSourced = CRIME_SOURCE.test(sentence);
  // Judge a crime unit with its rate denominators blanked, so the idiom cannot
  // donate a figure or a governed word to the sentence it qualifies.
  const judged = crimeSourced
    ? sentence.replace(RATE_DENOMINATOR, (m) => ' '.repeat(m.length))
    : sentence;
  QUANT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = QUANT.exec(judged)) !== null) {
    const raw = match[0];
    const token = raw.trim();
    const bare = token.replace(/[\s,$%]/g, '');
    const decorated = /[$%]/.test(token) || /,/.test(token);
    if (!decorated && /^(?:19|20)\d{2}$/.test(bare)) continue; // a year, not a figure

    const idx = match.index;
    const before = judged.slice(Math.max(0, idx - ATTRIBUTION_LOOKBEHIND), idx);
    const after = judged.slice(idx + raw.length, idx + raw.length + ATTRIBUTION_LOOKAHEAD);

    if (NON_GOVERNED_ATTRIBUTION.test(before)) continue;      // the deal's figure, stated label-first
    if (NON_GOVERNED_ATTRIBUTION_AFTER.test(after)) continue; // ...and value-first
    if (STREET_ADDRESS_AFTER.test(after)) continue;           // a street number
    if (MEASUREMENT_AFTER.test(after)) continue;              // a distance or a duration
    if (isSubjectPostcode(bare, before, after, ctx.subjectPostcode)) continue;
    // In a crime unit a figure is an offence count or a rate unless a governed
    // term is sitting right next to it.
    if (crimeSourced && !governedTermNear(judged, idx, raw.length, withheld)) continue;
    out.push({ token, index: idx, length: raw.length });
  }
  return out;
}



/**
 * Split into claim-sized units. Sentences, but newlines end a unit too: a
 * markdown table row and a `{{bars: …}}` visual directive each assert on their
 * own line without a full stop, and both carry figures.
 */
interface ClaimUnitSpan {
  /** The unit exactly as `claimUnits` would have produced it. */
  readonly text: string;
  /** Offsets of the TRIMMED unit within the original document. */
  readonly start: number;
  readonly end: number;
  /** Where the next unit begins — the separator belongs to this unit. */
  readonly nextStart: number;
}

/**
 * The same split, with offsets kept.
 *
 * RF-7.2B.1A.2. Remediation has to remove exactly the units the audit
 * condemns, and `claimUnits` threw the positions away — so the remediator
 * would have had to re-derive them and the two would have drifted the first
 * time either split changed. One segmentation, two readers.
 */
function claimUnitSpans(text: string): ClaimUnitSpan[] {
  const out: { text: string; start: number; end: number; nextStart: number }[] = [];
  const SEP = /\n+|(?<=[.!?])\s+/g;
  const push = (from: number, to: number, nextStart: number) => {
    const raw = text.slice(from, to);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;
    out.push({ text: trimmed, start: from + lead, end: from + lead + trimmed.length, nextStart });
  };
  let cursor = 0;
  let m: RegExpExecArray | null;
  SEP.lastIndex = 0;
  while ((m = SEP.exec(text)) !== null) {
    push(cursor, m.index, m.index + m[0].length);
    cursor = m.index + m[0].length;
  }
  push(cursor, text.length, text.length);
  return out;
}

function claimUnits(text: string): string[] {
  return claimUnitSpans(text).map((u) => u.text);
}

const trim = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 240);

/**
 * Where ONE topic stands: admissible only where the snapshot holds a PRESENT
 * fact that evidences that topic specifically.
 *
 * A topic with no fact of its own in the snapshot at all reads `withheld`,
 * not `admissible` — absence of evidence is the whole condition this guards.
 */
function standingOf(spec: TopicSpec, facts: readonly SnapshotFact[]): CategoryStanding {
  if (spec.owns === null) {
    const umbrella = UMBRELLA[spec.category];
    for (const fact of facts) {
      if (fact.name === umbrella && fact.status === 'present') return 'admissible';
    }
    return 'withheld';
  }
  for (const fact of facts) {
    if (!spec.owns(fact.name)) continue;
    if (fact.status === 'present') return 'admissible';
  }
  return 'withheld';
}

/** Every governed topic and where it stands for this report. */
export function governedTopicStanding(
  snapshot: Pick<MarketFactSnapshot, 'facts'> | null | undefined,
): Record<string, CategoryStanding> {
  const facts = snapshot?.facts ?? [];
  const out: Record<string, CategoryStanding> = {};
  for (const spec of TOPICS) out[spec.topic] = standingOf(spec, facts);
  return out;
}

/**
 * Category standing, kept for the directive and for reporting.
 *
 * A category is `admissible` only when EVERY topic in it is — because the
 * directive it drives says "this category is not available", and saying that
 * while one of its figures is genuinely held would be false. Enforcement does
 * not read this: the audit resolves per topic, so a partially-present category
 * still refuses exactly the figures it cannot evidence.
 */
export function governedCategoryStanding(
  snapshot: Pick<MarketFactSnapshot, 'facts'> | null | undefined,
): Record<GovernedCategory, CategoryStanding> {
  const facts = snapshot?.facts ?? [];
  const out = {} as Record<GovernedCategory, CategoryStanding>;
  for (const category of ALL_CATEGORIES) {
    const topics = TOPICS.filter((t) => t.category === category);
    out[category] = topics.every((t) => standingOf(t, facts) === 'admissible')
      ? 'admissible'
      : 'withheld';
  }
  return out;
}

/**
 * The directive the prompt carries when a governed category is unavailable.
 *
 * Returns '' when every category is admissible, so a healthy report's prompt
 * is byte-identical to what it is today. Modelled on `absentRentDirective`,
 * which already establishes the shape: name the absence, forbid the
 * substitution specifically, and keep qualitative discussion open — a
 * prohibition with no permitted action is one a model routes around.
 */
export function governedCategoryDirective(
  snapshot: Pick<MarketFactSnapshot, 'facts'> | null | undefined,
): string {
  const topicStanding = governedTopicStanding(snapshot);
  const withheldTopics = TOPICS.filter((t) => topicStanding[t.topic] === 'withheld');
  if (withheldTopics.length === 0) return '';

  const lines: string[] = [
    '',
    '**GOVERNED DATA UNAVAILABLE FOR THIS PROPERTY.** The figures below could not',
    'be established for the subject property from an authoritative source, so this',
    'report does NOT have them. They are unavailable, not merely missing from the',
    'context above.',
    '',
  ];

  // Named per CATEGORY where the whole category is gone, and per FIGURE where
  // only some of it is: "demographics are unavailable" is misleading on a
  // report that genuinely holds the population and is missing only the median
  // age, and a directive that misdescribes the data is one a model discounts.
  const categoryStanding = governedCategoryStanding(snapshot);
  for (const category of ALL_CATEGORIES) {
    const missing = withheldTopics.filter((t) => t.category === category);
    if (missing.length === 0) continue;
    if (categoryStanding[category] === 'withheld'
        && missing.length === TOPICS.filter((t) => t.category === category).length) {
      lines.push(`- **${CATEGORY_LABEL[category]} — NOT AVAILABLE.** Do not state:`);
      for (const banned of CATEGORY_BANNED[category]) lines.push(`    - ${banned};`);
    } else {
      lines.push(`- **${CATEGORY_LABEL[category]} — PARTLY AVAILABLE.** These specific`);
      lines.push('  figures are NOT held for this property and must not be stated:');
      for (const t of missing) lines.push(`    - ${t.label};`);
      lines.push('  Figures in this category that ARE supplied above may be used normally.');
    }
  }

  lines.push(
    '',
    'For every category listed above, in this report:',
    '',
    '- Do NOT search for, look up, recall or derive a replacement figure. A figure',
    '  obtained from a web search, a statistical publication, an encyclopaedia, a',
    '  council or agency profile, or your own knowledge is NOT a substitute and must',
    '  not appear.',
    '- Do NOT substitute a different geography. A figure for an SA2, an SA3, an LGA,',
    '  a shire, a township, an urban centre, an ERP series or any area other than the',
    '  subject property\'s own postal area is NOT a substitute and must not appear.',
    '- Do NOT attribute any figure to the ABS, the Census, or any statistical agency',
    '  in this report for these categories. No such figure is held for this property.',
    '- Where such a figure would have appeared, leave it out, together with the sentence',
    '  that would have carried it. Do NOT write "Not available", "N/A", "unavailable" or',
    '  any placeholder, and do NOT tell the reader that a figure is missing, withheld or',
    '  could not be established: a client document states what is known and is silent',
    '  about what is not.',
    '- Do NOT manufacture a distribution. No percentage split, composition chart,',
    '  donut, bar or pie of household types, life stages, tenure or workforce mix,',
    '  and no "indicative", "approximate", "typical" or "estimated" numeric profile.',
    '  Labelling an invented split as indicative does not make it qualitative — a',
    '  reader sees a chart of demographic percentages either way. Do not emit a',
    '  {{donut: …}}, {{bars: …}} or {{pie: …}} directive for any category above.',
    '- You MAY still discuss the area qualitatively — its role, its amenity, the kind',
    '  of tenant it attracts, the character of local demand — provided you attach NO',
    '  number to any category listed above.',
    '',
  );
  return lines.join('\n');
}

/**
 * The subject property's own postcode, for `GovernedAuditContext`.
 *
 * Read from the snapshot's resolved geography where one exists, and otherwise
 * from the trailing four digits of the address the report was written about —
 * which is the case that matters, because an unresolved geography is exactly
 * when these categories are withheld and the postcode still appears in prose.
 */
export function subjectPostcodeForAudit(
  snapshot: { geography?: { postcode?: unknown } } | null | undefined,
  propertyAddress?: unknown,
): string | null {
  const resolved = snapshot?.geography?.postcode;
  if (typeof resolved === 'string' && /^\d{4}$/.test(resolved.trim())) return resolved.trim();
  if (typeof resolved === 'number' && /^\d{4}$/.test(String(resolved))) return String(resolved);
  if (typeof propertyAddress !== 'string') return null;
  const matches = propertyAddress.match(/\b\d{4}\b/g);
  return matches && matches.length > 0 ? matches[matches.length - 1] : null;
}

/**
 * Audit the finished prose for governed claims the snapshot cannot support.
 *
 * Category-anchored, where `auditMarketClaims` is value-anchored: it asks
 * whether the text asserts a category for which no admissible fact exists,
 * which is precisely the question a withheld fact makes unanswerable by
 * looking for its value.
 */
export function auditGovernedNarrativeAuthority(
  reportText: unknown,
  snapshot: Pick<MarketFactSnapshot, 'facts'> | null | undefined,
  context: GovernedAuditContext = {},
): GovernedClaimFault[] {
  if (typeof reportText !== 'string' || reportText.trim() === '') return [];
  const standing = governedTopicStanding(snapshot);
  const withheld = TOPICS.filter((t) => standing[t.topic] === 'withheld');
  if (withheld.length === 0) return [];

  const faults: GovernedClaimFault[] = [];
  for (const unit of claimUnits(reportText)) faults.push(...faultsForUnit(unit, withheld, context));

  // One fault of each kind per category is enough to send a reviewer to the
  // text; the same finding twenty times is how a flag list stops being read.
  const seen = new Set<string>();
  return faults.filter((f) => {
    const key = `${f.topic}|${f.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Every governed fault in ONE claim unit.
 *
 * RF-7.2B.1A.2. Extracted verbatim from the audit loop so the remediator
 * removes exactly what the audit condemns. Two implementations of "is this
 * unit a claim" would disagree the first time either changed, and the failure
 * mode is the worst available: prose deleted that was never at fault, or a
 * fabrication left in because the remover judged it differently.
 */
function faultsForUnit(
  unit: string,
  withheld: readonly TopicSpec[],
  context: GovernedAuditContext,
): GovernedClaimFault[] {
  const faults: GovernedClaimFault[] = [];
  {
    const figures = unexemptFigures(unit, context, withheld);
    if (figures.length === 0) return faults;
    for (const spec of withheld) {
      spec.terms.lastIndex = 0;
      if (!spec.terms.test(unit)) continue;

      if (ATTRIBUTION.test(unit)) {
        faults.push({
          category: spec.category,
          topic: spec.topic,
          kind: 'false_attribution',
          excerpt: trim(unit),
          message:
            `A figure for ${spec.label} is attributed to an official statistical source, `
            + 'but no such figure is held for this property — the category was withheld '
            + 'because trusted geography was unavailable. The attribution cannot be honoured.',
        });
        continue;
      }

      if (OTHER_GRAIN.test(unit)) {
        faults.push({
          category: spec.category,
          topic: spec.topic,
          kind: 'cross_grain_substitution',
          excerpt: trim(unit),
          message:
            `A figure for ${spec.label} is stated for a different geography (an SA2, LGA, `
            + 'township, shire or ERP series) in place of the subject property\'s own postal '
            + 'area. A neighbouring grain is not a substitute for the area that was withheld.',
        });
        continue;
      }

      faults.push({
        category: spec.category,
        topic: spec.topic,
        kind: 'substituted_figure',
        excerpt: trim(unit),
        message:
          `A quantitative claim about ${spec.label} appears in the report, but the snapshot `
          + 'holds no admissible fact for that category. A governed fact may be narrated '
          + 'quantitatively only where the report actually holds it.',
      });
    }
  }
  return faults;
}

/**
 * What the report says instead, per category.
 *
 * RF-7.2B.1A.2. Deliberately carries NO figure of any kind, so the re-audit
 * cannot condemn the repair — and states the limitation as a fact about the
 * METHOD rather than about the area, because "the area is unremarkable" would
 * be an invention of a different kind. It is client-facing prose: no flag
 * names, no codes, no markers — and, since 14 Sep 2026, no confession either.
 * These sentences used to read "… was not available for this analysis";
 * measured on the newest production reports (12 Sep 2026) that wording, and
 * the model's echoes of it, was the commonest "not available" a client saw.
 * The owner's rule is that neither "N/A" nor "unavailable" reaches a client
 * document, so each sentence now says what the analysis RESTS ON instead of
 * what it lacks. Both statements are true; only one belongs in the document.
 */
const EVIDENCE_GAP_DISCLOSURE: Record<GovernedCategory, string> = {
  demographics:
    'This analysis does not rely on postcode-level demographic statistics; conclusions '
    + 'about the resident profile are drawn from the area\'s observed character and local '
    + 'market evidence.',
  seifa:
    'This analysis does not rely on a socio-economic index for the postal area; no ranking '
    + 'or index-based conclusions are drawn.',
  employment:
    'This analysis does not rely on postcode-level workforce and employment statistics; '
    + 'conclusions about employment-driven demand are drawn from the area\'s observed '
    + 'economic character.',
};

/** A unit the remediator removed, kept for the audit trail. */
export interface GovernedRemoval {
  readonly category: GovernedCategory;
  readonly topic: string;
  readonly kind: GovernedFaultKind;
  readonly excerpt: string;
}

export interface GovernedRemediation {
  /** The document with every condemned claim unit removed. */
  readonly text: string;
  readonly removed: readonly GovernedRemoval[];
  readonly disclosed: readonly GovernedCategory[];
  readonly changed: boolean;
}

/**
 * A unit that carries document STRUCTURE rather than prose.
 *
 * A table row, a chart directive, a heading or a list marker cannot host a
 * replacement sentence without corrupting the thing it belongs to, so those
 * are deleted and the disclosure goes to a prose unit instead.
 */
const STRUCTURAL_UNIT = /^\s*(?:\||\{\{|#{1,6}\s|[-*+]\s|>\s|\d+\.\s)/;

/**
 * Remove every governed claim the snapshot cannot support, and say why once.
 *
 * RF-7.2B.1A.2. The audit proved more reliable than the prompt: a
 * search-grounded model will occasionally still reach for a public figure, and
 * the product cannot be "generated, then withheld from the client". So the
 * unsupported claim is taken OUT and the document continues.
 *
 * Three rules carry it.
 *
 * **The whole claim unit goes.** The production sentence that forced this —
 * "Public profiles describe Cowra as a town of around 10,000 residents with a
 * predominance of detached houses, a meaningful share of owner-occupiers and a
 * material rental sector" — mixes an unsupported population count with
 * qualitative tenure commentary whose provenance is the same "public
 * profiles". Salvaging the half that reads acceptably would keep a claim whose
 * source was never good enough. Correct omission beats fabricated precision.
 *
 * **Nothing is rewritten, only deleted or replaced by a fixed sentence.** No
 * model is asked to repair the prose: sending a search-grounded model back
 * into the same environment is how the defect was produced. The replacement is
 * a constant, so it cannot invent a second figure.
 *
 * **It is deterministic and bounded.** One pass over the spans, no loop, no
 * network, no randomness — the caller re-audits and may run it once more with
 * `disclose: false` as a fallback, and blocks if even that is not clean.
 */
export function remediateGovernedNarrative(
  reportText: unknown,
  snapshot: Pick<MarketFactSnapshot, 'facts'> | null | undefined,
  context: GovernedAuditContext = {},
  options: { readonly disclose?: boolean } = {},
): GovernedRemediation {
  const empty: GovernedRemediation = {
    text: typeof reportText === 'string' ? reportText : '',
    removed: [], disclosed: [], changed: false,
  };
  if (typeof reportText !== 'string' || reportText.trim() === '') return empty;
  const standing = governedTopicStanding(snapshot);
  const withheld = TOPICS.filter((t) => standing[t.topic] === 'withheld');
  if (withheld.length === 0) return empty;

  const spans = claimUnitSpans(reportText);
  const condemned: { span: ClaimUnitSpan; faults: GovernedClaimFault[] }[] = [];
  for (const span of spans) {
    const faults = faultsForUnit(span.text, withheld, context);
    if (faults.length > 0) condemned.push({ span, faults });
  }
  if (condemned.length === 0) return empty;

  const removed: GovernedRemoval[] = [];
  for (const { faults } of condemned) {
    for (const f of faults) {
      removed.push({ category: f.category, topic: f.topic, kind: f.kind, excerpt: f.excerpt });
    }
  }

  // One disclosure per affected category, and never a second copy of one the
  // document already makes.
  const disclose = options.disclose !== false;
  const categories: GovernedCategory[] = [];
  if (disclose) {
    for (const { faults } of condemned) {
      for (const f of faults) {
        if (categories.includes(f.category)) continue;
        if (reportText.includes(EVIDENCE_GAP_DISCLOSURE[f.category])) continue;
        categories.push(f.category);
      }
    }
  }
  // The sentence replaces the first PROSE unit removed; a table row, chart
  // directive or heading is deleted outright and the disclosure moves on.
  const hostIndex = categories.length === 0
    ? -1
    : condemned.findIndex((c) => !STRUCTURAL_UNIT.test(c.span.text));
  const replacement = ALL_CATEGORIES
    .filter((c) => categories.includes(c))
    .map((c) => EVIDENCE_GAP_DISCLOSURE[c])
    .join(' ');

  let out = '';
  let cursor = 0;
  condemned.forEach((c, i) => {
    out += reportText.slice(cursor, c.span.start);
    if (i === hostIndex) out += replacement;
    // The separator that followed the unit is consumed with it, so deleting a
    // sentence does not leave a double space and deleting a directive does not
    // leave a blank line — except where the unit is being replaced, which is
    // in-place and keeps the document's shape exactly.
    cursor = i === hostIndex ? c.span.end : c.span.nextStart;
  });
  out += reportText.slice(cursor);

  // Nothing structural was rewritten, so the only tidying needed is the
  // paragraph break a deleted stand-alone line can leave behind.
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');

  // A disclosure that found no prose host still has to be said.
  if (categories.length > 0 && hostIndex === -1) {
    out = `${out.trimEnd()}\n\n${replacement}\n`;
  }

  return { text: out, removed, disclosed: categories, changed: true };
}

/**
 * The same flag, recording a claim that was REMOVED rather than one standing.
 *
 * `blocking: false` — the document no longer carries it, so there is nothing
 * to withhold; `governedAuthorityBlockFromFlags` reads exactly this field, so
 * a remediated report passes the delivery gate while the trail of what was
 * taken out, and why, stays on the row.
 */
export function governedRemediatedFlag(removal: GovernedRemoval): {
  type: string;
  severity: string;
  field: string;
  message: string;
  value: Record<string, unknown>;
} {
  return {
    type: GOVERNED_AUTHORITY_FLAG_TYPE,
    severity: 'warning',
    field: `governed.${removal.category}`,
    message:
      `An unsupported claim about ${removal.category} was removed from the report before `
      + 'completion, because the snapshot holds no admissible fact for it. The evidence gap '
      + 'is disclosed in the document instead.',
    value: {
      kind: removal.kind,
      category: removal.category,
      topic: removal.topic,
      excerpt: removal.excerpt,
      blocking: false,
      readiness: 'remediated',
      remediation: 'claim_removed',
      version: GOVERNED_NARRATIVE_AUTHORITY_VERSION,
    },
  };
}

/**
 * Does this set of faults block the report from being treated as client-ready?
 *
 * Every fault of this class blocks. The category exists because the claim is
 * unsupported by anything the platform holds, and an unsupported factual claim
 * about a customer's property is not a disclosure-grade finding.
 */
export function governedAuthorityBlocks(faults: readonly GovernedClaimFault[]): boolean {
  return faults.length > 0;
}

/** Named once: both writers and the delivery gate must agree on this string. */
export const GOVERNED_AUTHORITY_FLAG_TYPE = 'governed_authority';

/**
 * Is this report blocked, read from its STORED `validation_flags`?
 *
 * The delivery gate cannot re-run the audit — it holds a row, not a snapshot
 * and a draft — so it reads the verdict the generator recorded. Same rule,
 * one spelling of the flag type, so a gate and a writer cannot drift.
 *
 * Unreadable or absent flags are NOT a block: this refuses a report that
 * demonstrably asserts what it does not hold, and every report generated
 * before this existed has no such flag. Failing open here is deliberate —
 * failing closed would withhold 1,190 stored reports on no evidence.
 */
export function governedAuthorityBlockFromFlags(flags: unknown): {
  blocked: boolean;
  categories: string[];
} {
  if (!Array.isArray(flags)) return { blocked: false, categories: [] };
  const categories: string[] = [];
  for (const flag of flags) {
    if (typeof flag !== 'object' || flag === null) continue;
    const row = flag as Record<string, unknown>;
    if (row.type !== GOVERNED_AUTHORITY_FLAG_TYPE) continue;
    const value = typeof row.value === 'object' && row.value !== null
      ? row.value as Record<string, unknown>
      : {};
    if (value.blocking !== true) continue;
    const category = typeof value.category === 'string' ? value.category : 'unknown';
    if (!categories.includes(category)) categories.push(category);
  }
  return { blocked: categories.length > 0, categories };
}

/** The shape `validation_flags` already carries, so these sit beside the rest. */
export function governedFaultToFlag(fault: GovernedClaimFault): {
  type: string;
  severity: string;
  field: string;
  message: string;
  value: Record<string, unknown>;
} {
  return {
    type: GOVERNED_AUTHORITY_FLAG_TYPE,
    // `critical`, and blocking with it. `high` is the band `market_claim` uses
    // for a fact that is real but described wrongly; this band is for a fact
    // the report does not have at all.
    severity: 'critical',
    field: `governed.${fault.category}`,
    message: fault.message,
    value: {
      kind: fault.kind,
      category: fault.category,
      topic: fault.topic,
      excerpt: fault.excerpt,
      blocking: true,
      readiness: 'blocked',
      version: GOVERNED_NARRATIVE_AUTHORITY_VERSION,
    },
  };
}
