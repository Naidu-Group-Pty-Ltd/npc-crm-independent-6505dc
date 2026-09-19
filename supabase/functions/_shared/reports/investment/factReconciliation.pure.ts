/**
 * Fact reconciliation — does the prose agree with the record?
 *
 * A generated report carries two statements of the same property: the typed
 * columns (property_specs, manual overrides, the calculator's inputs) and
 * whatever the model wrote. Nothing ever compared them, so a report could
 * describe a four-bedroom home over a specs block that says three and no
 * machine would notice. This module is the comparison.
 *
 * It DISCLOSES, it does not gate: findings become `validation_flags`
 * entries (`type: 'fact'`) recorded on the report and surfaced in the
 * viewer's data-coverage disclosure. Feeding findings back into a
 * regeneration retry is deliberately not done here — a mistuned detector
 * driving model retries costs tokens and stability, so the detector earns
 * production mileage first.
 *
 * The detection rule is REPORT-LEVEL, not occurrence-level: a fact is
 * contradicted only when the recorded value never appears in the prose in
 * that fact's vocabulary AND a different value appears repeatedly. Prose
 * legitimately discusses other properties ("compared with four-bedroom
 * stock nearby"), so a single divergent mention is not a finding — this
 * trades missed single-mention errors for a near-zero false-positive rate,
 * the right trade for a disclosure surface.
 */

export interface CanonicalFacts {
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  purchasePrice?: number;
  weeklyRent?: number;
  landSizeSqm?: number;
  // ---------------------------------------------------------------------
  // Derived figures. Everything above is an INPUT — something a person
  // typed or a listing carried — and for a long time those were the only
  // facts reconciled. But a client acts on the derived ones, and they were
  // checked by nothing: `runQAValidation`'s seven rules are page band,
  // keyword presence, placeholders, editorial labels, duplicate headings
  // and section counts, every one of them structural.
  //
  // These three are the strongest possible reconciliation targets because
  // the prompt does not merely supply them, it ORDERS their use:
  // "PRE-CALCULATED FINANCIAL VALUES (USE THESE EXACTLY - DO NOT
  // RECALCULATE)". A divergence is therefore not a difference of opinion
  // about method — it is the model having overridden an explicit
  // instruction, which is worth telling somebody about.
  //
  // All three are on the PURCHASE-PRICE basis, because that is what the
  // generator computes (`effectivePurchasePrice`) and what it puts in the
  // packet. A yield quoted on current value is a different, also-correct
  // figure — see `_shared/reports/metrics/propertyMetrics.pure.ts` — and
  // comparing across bases would manufacture findings rather than find
  // them. If a report ever quotes a value-basis yield, this must learn the
  // difference before it judges it.
  // ---------------------------------------------------------------------
  /** Gross rental yield on the purchase price, as a percentage. */
  grossYieldPct?: number;
  /** Net rental yield on the purchase price, as a percentage. */
  netYieldPct?: number;
  /** The single loan-to-value ratio the report was told to use. */
  lvrPct?: number;
}

export interface FactFinding {
  fact: keyof CanonicalFacts;
  expected: number;
  /** The divergent value the prose repeats. */
  found: number;
  /** How many times the divergent value appears in the fact's vocabulary. */
  occurrences: number;
  /** ±40 chars around the first divergent mention. */
  snippet: string;
}

const toCount = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

const parseMoney = (raw: string, unit?: string): number => {
  const n = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(n)) return NaN;
  return /^m(illion)?$/i.test(unit ?? '') ? n * 1_000_000 : n;
};

interface Mention {
  value: number;
  index: number;
  /** Length of the whole matched phrase, so a snippet frames what was read. */
  length: number;
}

/**
 * How close a written figure has to be to count as the recorded one.
 *
 * `relative` is right for money and areas, where a price of $737,000 written
 * as "$740,000" is the same statement. It is WRONG for a percentage: gross
 * yield 4.83 against a 2% relative band is ±0.097, which rejects the entirely
 * ordinary prose rounding "5%". Percentages therefore carry an absolute band,
 * measured against the corpus rather than chosen — see the yield and LVR
 * detectors below.
 */
type Tolerance = { readonly relative: number } | { readonly absolute: number };

const within = (t: Tolerance, expected: number, value: number): boolean =>
  'absolute' in t
    ? Math.abs(value - expected) <= t.absolute
    : Math.abs(value - expected) <= t.relative * Math.max(1, Math.abs(expected));

const snippetAt = (text: string, index: number, length: number): string => {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
};

/**
 * Collect every mention matching `re` (which must expose the numeric value
 * in group 1, and may expose a magnitude unit in group 2).
 */
function collect(text: string, re: RegExp, money = false): Mention[] {
  const out: Mention[] = [];
  for (const m of text.matchAll(re)) {
    // A prose minus can be a hyphen, a real minus sign or an en dash. Dropping
    // the sign turns every negatively geared property's net yield into its
    // positive twin, which is how a detector manufactures findings on exactly
    // the reports that most need reading — 62 of the production corpus's net
    // yield mentions are negative.
    const raw = m[1].replace(/,/g, '').replace(/^[−–]/, '-');
    const value = money ? parseMoney(raw, m[2]) : Number(raw);
    if (Number.isFinite(value)) {
      out.push({ value, index: m.index ?? 0, length: m[0].length });
    }
  }
  return out;
}

/**
 * The report-level rule: contradicted when no mention matches the record
 * (within tolerance) and some other value recurs at least `minRepeats`
 * times. Returns the modal divergent value.
 */
function judge(
  fact: keyof CanonicalFacts,
  expected: number,
  mentions: Mention[],
  text: string,
  tolerance: Tolerance,
  minRepeats: number,
): FactFinding | null {
  if (!mentions.length) return null;
  if (mentions.some((m) => within(tolerance, expected, m.value))) return null;

  const counts = new Map<number, Mention[]>();
  for (const m of mentions) {
    const bucket = counts.get(m.value) ?? [];
    bucket.push(m);
    counts.set(m.value, bucket);
  }
  let best: { value: number; list: Mention[] } | null = null;
  for (const [value, list] of counts) {
    if (!best || list.length > best.list.length) best = { value, list };
  }
  if (!best || best.list.length < minRepeats) return null;

  return {
    fact,
    expected,
    found: best.value,
    occurrences: best.list.length,
    snippet: snippetAt(text, best.list[0].index, best.list[0].length),
  };
}

/** Like `toCount`, but a derived figure may legitimately be negative. */
const toFinite = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

// ---------------------------------------------------------------------------
// Yield vocabulary
//
// One shape decided the gap: `| Gross Rental Yield | $33,800 ÷ $700,000 × 100
// | 4.83% |` is the single most common way this corpus states the figure (543
// of 2,153 gross mentions), so the pattern has to cross a working column to
// reach the answer. It is bounded three ways. It cannot cross a newline, so a
// table header never reaches the row beneath it. It cannot cross a `%`, so the
// first percentage after the label is the one read and a comparison column is
// out of reach. And it cannot cross a second `yield`, which is what keeps "the
// gross yield of 4.83% and net yield of 3.39%" from filing 3.39 under gross —
// the shape `gross yield and N%` occurs 20 times.
//
// `\byield\b` also excludes the plural. "Suburb gross yields sit below 4%" is
// a statement about the market, not about this property, and 109 such
// mentions were in scope before the boundary was tightened.
//
// A wide gap alone is not enough, and the corpus long tail is what proved it:
// "gross rental yield provides substantial buffering against interest rate
// increases. A 1%" read the figure as 1, and "net rental yield reflects the
// balance between rental income ($27,500 annually at 96%" read it as the
// occupancy. Both are sentences, not statements of the figure. So the gap is
// admitted two ways and no others. A WORKING gap may be long but has to hand
// the value over with a delimiter — a table pipe, a label's colon, or an
// equation's `=` — which is what "$33,800 ÷ $700,000 × 100 | " and
// "[($450 × 52) − ($1,500 + …)] / $590,000 = " both do. An ADJACENT gap has
// room for "of", "at", "is", a bracket or nothing at all, and no room for a
// clause. Every prose false positive above dies on the same rule: a verb
// cannot introduce the number.
// ---------------------------------------------------------------------------
const PERCENT_VALUE = String.raw`([-−–]?\d[\d,]*(?:\.\d+)?)\s*%`;
const YIELD_GAP =
  // A working column or an equation, handing the value over by delimiter.
  String.raw`(?:(?:(?!yield)[^\n\r%]){0,70}?[|=:]\s*\**\s*` +
  // …or the label sitting straight against its own number.
  String.raw`|[\s*]{0,3}(?:of|at|is|~|\()?[\s*]{0,3})`;
const GROSS_YIELD_RE = new RegExp(
  String.raw`\bgross(?:\s+rental)?\s+yield\b${YIELD_GAP}${PERCENT_VALUE}`, 'gi');
const NET_YIELD_RE = new RegExp(
  String.raw`\bnet(?:\s+rental)?\s+yield\b${YIELD_GAP}${PERCENT_VALUE}`, 'gi');

// ---------------------------------------------------------------------------
// LVR vocabulary — the one place a value-after-label rule had to be refused
//
// LVR prose is not like yield prose. Measured over the corpus, the value the
// reader is being given sits BEFORE the label far more often than after it
// ("a $560,000 loan (80% LVR, 6.5% interest)"), and the ordinary connectives
// point at something else entirely: `LVR, 6.5%` is the interest rate,
// `LVR at 6.5%` is the interest rate, `banks cap LVR at 80%` is policy, and
// `an LVR of 65%` after growth is a projection. A value-after-label rule with
// prose connectives read 22 of 57 reports as contradicted; almost all of it
// was the detector.
//
// So the label-first form is admitted only through a STRUCTURAL connector —
// `:`, `|` or `=` — which is a table cell or a labelled field and never a
// sentence. Coverage doubled (57 reports to 115) and disagreement fell to 10,
// all of which turned out to be real.
// ---------------------------------------------------------------------------
const LVR_LABEL = String.raw`(?:\bLVR\b|\bloan[-\s]?to[-\s]?value(?:\s+ratio)?\b)`;
const LVR_VALUE_FIRST_RE = new RegExp(
  String.raw`(\d[\d,]*(?:\.\d+)?)\s*%\s*\**\s*${LVR_LABEL}`, 'gi');
const LVR_LABEL_FIRST_RE = new RegExp(
  String.raw`${LVR_LABEL}\s*\**\s*[:|=]\s*\**\s*(\d[\d,]*(?:\.\d+)?)\s*%`, 'gi');

/**
 * Is this LVR label the ten-year projection's, rather than the loan's?
 *
 * `| Final LVR | 52% |` is the last row of the cash-flow table and it is
 * correct — it is the CURRENT LVR after a decade of amortisation and growth,
 * a different quantity from the origination LVR the record holds (see
 * `_shared/reports/metrics/propertyMetrics.pure.ts`). Judging it against the
 * settlement figure would report the projection working as a contradiction.
 */
const PROJECTION_QUALIFIER = /\b(final|projected|future|exit|remaining|current|ending|year|yr)\b[^a-z]{0,4}$/i;
const precededByProjection = (text: string, index: number): boolean =>
  PROJECTION_QUALIFIER.test(text.slice(Math.max(0, index - 26), index));

/** Sentence-ish window around an index, for context-anchored money facts. */
const hasContextNearby = (text: string, index: number, context: RegExp): boolean => {
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + 120);
  return context.test(text.slice(start, end));
};

export function reconcileFacts(markdown: string, facts: CanonicalFacts): FactFinding[] {
  const text = String(markdown ?? '');
  if (!text.trim()) return [];
  const findings: FactFinding[] = [];

  // Two forms of a counted mention, and the separator matters. "3-bedroom" and
  // "3 bedroom" are the count; "Bedrooms: 3 - Bathrooms: 2" is a LIST, and a
  // `[\s-]*` bridge read its " - " as a hyphen — so the bedroom count leaked
  // into the bathroom match and a report whose specs were correct was flagged
  // (measured: 1 false positive in 18 production reports, this shape exactly).
  // One optional separator character is what a compound noun allows. The
  // label-first form ("Bathrooms: 2") is how every generated spec table
  // states the fact, and it has to count as the recorded value appearing.
  const counted: Array<[keyof CanonicalFacts, RegExp, RegExp]> = [
    ['bedrooms', /\b(\d{1,2})(?:\s|-)?bed(?:room)?s?\b/gi, /\bbed(?:room)?s?\s*[:=]\s*\**\s*(\d{1,2})\b/gi],
    ['bathrooms', /\b(\d{1,2})(?:\s|-)?bath(?:room)?s?\b/gi, /\bbath(?:room)?s?\s*[:=]\s*\**\s*(\d{1,2})\b/gi],
    [
      'carSpaces',
      /\b(\d{1,2})(?:\s|-)?(?:car[\s-]*(?:space|park|port)s?|garage(?:\s+space)?s?)\b/gi,
      /\b(?:car[\s-]*(?:space|park|port)s?|garage(?:\s+space)?s?|parking)\s*[:=]\s*\**\s*(\d{1,2})\b/gi,
    ],
  ];
  for (const [fact, countFirst, labelFirst] of counted) {
    const expected = toCount(facts[fact]);
    if (expected === undefined) continue;
    const mentions = [...collect(text, countFirst), ...collect(text, labelFirst)];
    const finding = judge(fact, expected, mentions, text, { relative: 0 }, 2);
    if (finding) findings.push(finding);
  }

  const price = toCount(facts.purchasePrice);
  if (price !== undefined && price > 0) {
    const PRICE_CONTEXT = /purchas|asking|list(?:ed|ing)?\s+price|acquisition|buy(?:ing)?\s+price|sale\s+price|contract\s+price/i;
    const mentions = collect(
      text,
      /\$\s?([\d,]+(?:\.\d+)?)\s*(million|m\b)?/gi,
      true,
    ).filter((m) => m.value >= 50_000 && hasContextNearby(text, m.index, PRICE_CONTEXT));
    const finding = judge('purchasePrice', price, mentions, text, { relative: 0.02 }, 2);
    if (finding) findings.push(finding);
  }

  const rent = toCount(facts.weeklyRent);
  if (rent !== undefined && rent > 0) {
    const mentions = collect(text, /\$\s?([\d,]+)\s*(?:per\s+week|\/\s*week|\/?\s*wk\b|pw\b|p\/w|weekly)/gi);
    const finding = judge('weeklyRent', rent, mentions, text, { relative: 0.05 }, 2);
    if (finding) findings.push(finding);
  }

  const land = toCount(facts.landSizeSqm);
  if (land !== undefined && land > 0) {
    const LAND_CONTEXT = /\bland\b|\bblock\b|\blot\b|\bsite\b|\ballotment\b/i;
    const mentions = collect(text, /([\d,]+(?:\.\d+)?)\s*(?:sqm|m2|m²|square\s+met(?:re|er)s?)/gi)
      .filter((m) => hasContextNearby(text, m.index, LAND_CONTEXT));
    const finding = judge('landSizeSqm', land, mentions, text, { relative: 0.05 }, 2);
    if (finding) findings.push(finding);
  }

  // -------------------------------------------------------------------------
  // Derived figures. Every pattern below was written against the vocabulary
  // the corpus actually uses, not against the vocabulary the prompt asks for
  // — measured over 1,072 stored reports on 2026-09-07. The shapes that
  // decided each rule are recorded beside it.
  // -------------------------------------------------------------------------
  const YIELD_BAND: Tolerance = { absolute: 0.25 };
  for (const [fact, re] of [
    ['grossYieldPct', GROSS_YIELD_RE],
    ['netYieldPct', NET_YIELD_RE],
  ] as Array<[keyof CanonicalFacts, RegExp]>) {
    const expected = toFinite(facts[fact]);
    if (expected === undefined) continue;
    const finding = judge(fact, expected, collect(text, re), text, YIELD_BAND, 2);
    if (finding) findings.push(finding);
  }

  const lvr = toFinite(facts.lvrPct);
  if (lvr !== undefined && lvr > 0) {
    const mentions = [
      ...collect(text, LVR_VALUE_FIRST_RE),
      ...collect(text, LVR_LABEL_FIRST_RE).filter((m) => !precededByProjection(text, m.index)),
    ];
    // Half a point. An LVR is quoted whole ("80%") or to one place, and the
    // ratios a lender actually distinguishes are 5 points apart, so a band
    // wider than this stops separating 80 from 85.
    const finding = judge('lvrPct', lvr, mentions, text, { absolute: 0.5 }, 2);
    if (finding) findings.push(finding);
  }

  return findings;
}

/** A finding, in the shape `validation_flags` already stores and renders. */
export function factFindingToFlag(f: FactFinding): {
  type: 'fact';
  severity: 'warning';
  field: string;
  message: string;
  value: { expected: number; found: number; occurrences: number; snippet: string };
} {
  const LABELS: Record<keyof CanonicalFacts, string> = {
    bedrooms: 'bedroom count',
    bathrooms: 'bathroom count',
    carSpaces: 'car spaces',
    purchasePrice: 'purchase price',
    weeklyRent: 'weekly rent',
    landSizeSqm: 'land size',
    grossYieldPct: 'gross rental yield',
    netYieldPct: 'net rental yield',
    lvrPct: 'loan-to-value ratio',
  };
  // A bare "3.39" reads as a count. The unit belongs to the figure.
  const PERCENTAGES = new Set<keyof CanonicalFacts>(['grossYieldPct', 'netYieldPct', 'lvrPct']);
  const say = (n: number) => (PERCENTAGES.has(f.fact) ? `${n}%` : String(n));
  return {
    type: 'fact',
    severity: 'warning',
    field: String(f.fact),
    message: `The written analysis repeatedly states a ${LABELS[f.fact]} of ${say(f.found)} but the property record says ${say(f.expected)}.`,
    value: { expected: f.expected, found: f.found, occurrences: f.occurrences, snippet: f.snippet },
  };
}
