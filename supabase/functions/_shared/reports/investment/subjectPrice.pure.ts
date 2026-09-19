/**
 * The subject property's price: which figure, called what, and on whose word.
 *
 * ## The defect this exists to end
 *
 * The prompt said, on every property:
 *
 * ```
 * **Asking price:** $1,490,000
 * ```
 *
 * and the figure behind it is
 * `mergedOverrides.purchasePrice || propertyDetails?.price || 0` — the
 * operator's **accepted modelling input** first, the listing's recorded price
 * second, labelled identically either way.
 *
 * For 18 Annabelle Crescent the first rung answers: `manual_overrides`
 * carries `purchasePrice: 1490000`, which is what `initialCosts.propertyValue`
 * models, what `loanAmount: 1192000` is exactly 80% of, and what
 * `keyMetrics.lvr: 80` agrees with. So an adviser's accepted input was handed
 * to the model as the market's asking price.
 *
 * The model then wrote something else:
 *
 * > On listings data, 18 Annabelle Crescent is currently marketed as a
 * > 3-bedroom … house … with a price guide around **$1.55m**. That guide
 * > positions the property **below the prevailing Kellyville house median**
 *
 * $1.55m appears in no field of the record. It contradicts the accepted input
 * by $60,000, it is sourced to "listings data" that named nobody, and the
 * Executive Verdict's central claim is built on comparing it against an
 * equally unsourced median. A reader is left with a document whose narrative
 * price and whose Financial report disagree.
 *
 * ## The rules
 *
 * 1. **A price is labelled by whose figure it is.** An accepted modelling
 *    input recorded by an adviser and a price a seller advertised are
 *    different facts, and calling both "asking price" is what let one be read
 *    as the other. `describeSubjectPrice` names the rung it came from.
 * 2. **`purchasePrice` and `propertyValue` keep their meanings.** They are
 *    separate fields answering separate questions — what the analysis is
 *    modelled on, and what the property is assessed to be worth — and neither
 *    is ever written over the other to make them agree. On Annabelle they
 *    differ by $10,000 and that difference is information.
 * 3. **The record's price is the only price.** There is no second price guide,
 *    marketed range or "listed at" figure to be supplied from a search, a
 *    listing portal or the model's own knowledge.
 * 4. **A comparison against a SOURCED median is legitimate and is not a
 *    valuation.** The defect was never the comparison — it was comparing an
 *    unsourced $1.55m against an unsourced $1.96m. Where the market evidence
 *    table carries a median, saying how the price sits against it is useful
 *    analysis, provided the publisher, geography, dwelling split and period
 *    travel with it and the sentence stops at describing the difference.
 *    "Undervalued", "a bargain", "good buying" and any inferred equity or
 *    margin are conclusions this report does not make.
 *
 * Pure: no fetch, no Deno, no clock.
 */

/** Where the figure came from, which is what decides how it is named. */
export type SubjectPriceBasis =
  /** An adviser recorded it for this assessment; the whole model runs on it. */
  | 'accepted_input'
  /** The listing record carried it — the figure the property was marketed at. */
  | 'listing_record'
  /** Neither rung answered. */
  | 'not_recorded';

export interface SubjectPrice {
  basis: SubjectPriceBasis;
  /** The figure, or null where nothing was recorded. */
  value: number | null;
  /** How the prompt and the page name it. */
  label: string;
  /** One clause saying whose figure it is. Null when nothing was recorded. */
  provenance: string | null;
}

/*
 * Grouped by hand rather than with `toLocaleString('en-AU')`.
 *
 * `reportDesign/measure.pure.ts` records the reason and a spec enforces it
 * across every canonical investment module: the same payload is formatted in
 * Deno and in Node, their ICU builds need not agree on grouping, and these
 * strings are asserted in tests.
 */
const money = (n: number): string =>
  `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const positive = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

export interface SubjectPriceInput {
  /** `manual_overrides.purchasePrice` — the accepted modelling input. */
  overridePurchasePrice?: unknown;
  /** `propertyDetails.price` — what the listing recorded. */
  listingPrice?: unknown;
}

/**
 * The one figure, named by its rung.
 *
 * The precedence is deliberately the generator's own
 * (`overrides.purchasePrice || propertyDetails?.price`) — nothing here changes
 * WHICH figure is used, because that figure is what every projection, the
 * loan, the LVR and the Cash Flow already rest on. What changes is that the
 * answer now says which of the two it is.
 */
export function describeSubjectPrice(input: SubjectPriceInput): SubjectPrice {
  const accepted = positive(input.overridePurchasePrice);
  if (accepted !== null) {
    return {
      basis: 'accepted_input',
      value: accepted,
      label: 'Purchase price this analysis is modelled on',
      provenance: 'recorded by the adviser for this assessment — it is the figure every '
        + 'projection, the loan and the lending ratio in the Financial Analysis Report are built on',
    };
  }
  const listed = positive(input.listingPrice);
  if (listed !== null) {
    return {
      basis: 'listing_record',
      value: listed,
      label: 'Price recorded on the listing',
      provenance: 'the figure carried on the property record for this listing',
    };
  }
  return { basis: 'not_recorded', value: null, label: 'Purchase price', provenance: null };
}

/** The line the prompt and the snapshot carry. */
export function subjectPriceLine(price: SubjectPrice): string {
  return price.value === null
    ? `**${price.label}:** not recorded.`
    : `**${price.label}:** ${money(price.value)} — ${price.provenance}.`;
}

/**
 * The rule that stops a second price appearing.
 *
 * Rule 3. Stated as a prohibition WITH the permitted form, because a
 * prohibition on its own is one a model routes around — the lesson the Compass
 * document contract already records, and the reason the last attempt produced
 * a $1.55m guide rather than silence.
 */
export function subjectPriceRules(price: SubjectPrice): string {
  const head = 'SUBJECT PRICE RULES FOR THE WHOLE REPORT — they apply in every section, including the '
    + 'executive verdict, the snapshot, risk registers and summaries, and they override anything a live '
    + 'web search returns.';
  if (price.value === null) {
    return [
      head,
      '1. No price is recorded for this property. Do NOT state one — not an asking price, a price guide, a '
      + 'marketed range, a "listed at" figure, an estimated value or a recent sale price — and do not supply '
      + 'one from a listing portal, a news page, a live web search or your own knowledge.',
      '2. Do NOT describe the property as priced above, below or in line with anything. With no recorded '
      + 'price there is nothing to compare.',
    ].join('\n');
  }
  const named = `${price.label.toLowerCase()} of ${money(price.value)}`;
  return [
    head,
    `1. This property has exactly ONE recorded price: the ${named}, ${price.provenance}. State it with that `
    + 'label, and say whose figure it is.',
    '2. Do NOT state a second price. No price guide, marketed range, "listed at", "on the market for", '
    + 'estimated value or recent sale price other than the figure above — not from a listing portal, a news '
    + 'page, a live web search or your own knowledge. If you believe a different figure is advertised, that '
    + 'belief is not a retrieval and does not go in the report.',
    '3. You MAY compare this price with a median the market evidence table carries, and it is useful to do so '
    + '\u2014 but only that one, and only carrying its own limitations: name the publisher, the geography, the '
    + 'dwelling split and the period beside the comparison, because a suburb median of all houses is not a '
    + 'statement about this house. Do NOT compare it against a median, a "prevailing" level or a "typical" '
    + 'figure the table does not carry.',
    '3a. A comparison is a description, never a valuation. Say what the difference IS and what could explain it '
    + '(land size, condition, age, position, the spread any median hides). Do NOT conclude that the property is '
    + '"undervalued", "a bargain", "priced below its worth", "good buying" or "cheap", and do not infer equity, '
    + 'an instant gain or a margin from the gap. This report does not value the property, and a median is the '
    + 'middle of what sold rather than a measure of what this dwelling is worth.',
    price.basis === 'accepted_input'
      ? '4. This figure is the adviser’s accepted input, not an advertised price. Do NOT call it the '
        + '"asking price", the "list price" or the "guide" — it is what the analysis is modelled on, and the '
        + 'two are different facts about the property.'
      : '4. This figure is what the listing recorded. Do NOT present it as a valuation, an appraisal or an '
        + 'assessment of what the property is worth.',
  ].join('\n');
}
