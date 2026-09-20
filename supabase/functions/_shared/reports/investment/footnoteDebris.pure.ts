/**
 * A footnote marker with nothing it can refer to.
 *
 * ## What reached the page
 *
 * Five sentences of the Investment Compass issued for 97 Poole Road,
 * Kellyville on 20 Sep 2026 ended in a bare digit, set in the body face at
 * body size, glued to the full stop before it:
 *
 * ```
 * p21  …which medians do not capture.12 Median house prices in postcode 2155…
 * p21  …over both the short and medium term.2 The 4-period median price series…
 * p22  …rather than a thinly traded niche.2 This volume is specific to the…
 * p22  …according to the Australian Bureau of Statistics.4 This very modest…
 * p23  …than as a safety score.3 Latest recorded counts by offence category…
 * ```
 *
 * ## The document DOES carry footnotes, and that is the whole difficulty
 *
 * The first reading of this defect recorded "the document carries no
 * footnotes, so each digit refers to nothing". Measured against the delivered
 * file rather than against a fixture of it, that is wrong: page 36 carries a
 * `Notes` list of four entries, drawn by `markdown.pure.ts` from `[^id]:`
 * definitions the stored body holds. So the guard below returned true, and
 * this module was a NO-OP on the one document it was written for — the five
 * markers shipped, and a spec asserting `hasFootnoteApparatus(DELIVERED)` was
 * false was asserting a property of a fixture shorter than the product.
 *
 * Reading the digits against that list is what settles the rule:
 *
 * ```
 * p21  .12  -> there are four notes; 12 is not one of them
 * p21  .2   -> note 2 is the ABS population series; the sentence is house values
 * p22  .2   -> note 2 again; the sentence is sales volume
 * p22  .4   -> note 4 IS the population note              (correct)
 * p23  .3   -> note 3 IS the crime note                   (correct)
 * ```
 *
 * Two of five land, two land on the wrong source, one lands on nothing. A
 * bare digit beside a rendered apparatus is therefore WORSE than one beside
 * no apparatus at all: a reader follows it into the Notes list and arrives at
 * the wrong publisher.
 *
 * ## What wrote them, established by execution rather than inferred
 *
 * Every other form a citation could take survives the pipeline VISIBLY
 * different, so none of them can be the source. Driven through the real
 * write-path stripper in `generate-investment-report` and then through
 * `renderMarkdown`:
 *
 * ```
 * capture.[12] Median     -> capture. Median            (stripped, correctly)
 * capture.[^12] Median    -> capture.[^12] Median       (numeric id kept as prose)
 * capture.¹² Median       -> capture.¹² Median          (superscripts survive)
 * capture.\[12\] Median   -> capture.\[12\] Median
 * capture.**[12]** Median -> capture.* Median
 * capture.<sup>12</sup>   -> capture.&lt;sup&gt;12&lt;/sup&gt;
 * capture.(12) Median     -> capture.(12) Median
 * capture.12 Median       -> capture.12 Median          <- the only match
 * ```
 *
 * So the model wrote the marker as a bare digit with no markup at all, which
 * is what a writer does when it wants a superscript and the format has none.
 * The generator's prompt asks for `[^id]` (line 1569) and its stripper already
 * handles `[1]`, `[1][2]` and `[citation]` — this is the one form neither
 * reaches, and it is the form that shipped.
 *
 * ## Why this is not the prose scrub this repository forbids
 *
 * Two things hold it apart, and both are checkable rather than argued.
 *
 * **It is conditional on the document, and on WHICH KIND of apparatus.** The
 * two kinds do not behave alike, which is the correction above. An apparatus
 * the RENDERER draws is keyed on `[^id]` and set as superscripts: a bare digit
 * in body copy is not one of its markers and can never become one, so it is
 * debris there as surely as in a document with no notes. An apparatus the
 * MODEL wrote literally — a `**Notes**` line, or `[1] text` entries — has no
 * markup of its own, so the bare digits may be the only thing pointing at it
 * and the document is left entirely alone, markers and all. The document says
 * which case it is; nothing here is configured.
 *
 * **A digit between two sentences is in neither of them.** Removing it cannot
 * change a claim, a figure or a source, which is what makes this punctuation
 * rather than prose — the distinction `rewriteScaffoldingPointers` draws in
 * those words one file over.
 *
 * ## The shape, and why each bound is there
 *
 * A sentence end, then one or two digits, then the start of the next sentence:
 *
 *  - **at least three lowercase letters** immediately before the stop, which
 *    is what a word ends with and what an abbreviation does not — it is the
 *    bound that keeps `No.3 Smith Street`, `Fig.2` and `p.12` out;
 *  - the token before the stop is not in `ABBREVIATIONS`, a closed list, for
 *    the longer abbreviations three letters admits;
 *  - **one or two digits**, because footnotes run 1..99 and a third digit is
 *    a number;
 *  - then whitespace and a capital letter, or the end of the block — a new
 *    sentence, never a continuing phrase.
 *
 * Measured over the 38 pages of the document above: 5 matches, all five the
 * markers, 0 false positives. `s.10.7 planning certificate`, `(CC BY 4.0)`,
 * `api.apps1.nsw.gov.au` and `Clause 4.3` are all excluded by shape.
 *
 * One document is not a distribution, and this file does not pretend
 * otherwise: the bounds are chosen to fail closed — a marker left standing is
 * the defect that shipped, an edited sentence would be worse.
 */

/**
 * Words that end in three or more lowercase letters, take a full stop, and are
 * abbreviations rather than sentence ends. A closed list: each one is a form
 * that could otherwise precede a figure.
 */
export const ABBREVIATIONS: readonly string[] = [
  'approx', 'para', 'vol', 'fig', 'sec', 'art', 'chap', 'ref', 'ave',
  'est', 'max', 'min', 'inc', 'ltd', 'pty', 'etc', 'nos', 'apt', 'dept',
];

const ABBR = new Set(ABBREVIATIONS);

/**
 * A marker: a sentence end, one or two digits, and the next sentence.
 *
 * Group 1 is the word the sentence ended on, so the abbreviation test reads
 * the token rather than guessing from the match.
 */
const MARKER = /([A-Za-z]*[a-z]{3})\.(\d{1,2})(?=\s+[A-Z“"(]|\s*$)/gm;

/**
 * Which kind of footnote apparatus a body carries, if any.
 *
 * `literal` is a list the MODEL wrote out — a `**Notes**` lead-in, or `[1]
 * text` entries as `resolveFootnotes` emits. It has no markers of its own, so
 * a bare digit in the prose may be the only thing referring to it.
 *
 * `rendered` is a `[^id]: text` definition, which `markdown.pure.ts` draws as
 * a `Notes` heading and an ordered list, and whose markers it sets from the
 * `[^id]` references themselves. A bare digit is not one of those markers.
 *
 * A body carrying both answers `literal`: that is the conservative side.
 */
export type FootnoteApparatus = 'none' | 'literal' | 'rendered';

export function footnoteApparatusOf(markdown: string): FootnoteApparatus {
  if (!markdown) return 'none';
  if (/^\s*\*\*Notes\*\*\s*$/m.test(markdown)) return 'literal';
  if (/^\s*\[\d{1,2}\]\s+\S/m.test(markdown)) return 'literal';
  if (/^\s*\[\^[^\]\s]{1,40}\]:/m.test(markdown)) return 'rendered';
  return 'none';
}

/** A document that carries footnotes of either kind. */
export function hasFootnoteApparatus(markdown: string): boolean {
  return footnoteApparatusOf(markdown) !== 'none';
}

export interface FootnoteDebrisResult {
  readonly markdown: string;
  /** One entry per marker removed, in document order: the word and the digits. */
  readonly removed: ReadonlyArray<{ after: string; marker: string }>;
}

/**
 * Remove footnote markers from a document that has no footnotes.
 *
 * Returns the source unchanged, and an empty list, for a document whose
 * apparatus is a list the model wrote literally, or one carrying no marker.
 */
export function stripFootnoteDebris(markdown: string): FootnoteDebrisResult {
  if (!markdown || footnoteApparatusOf(markdown) === 'literal') {
    return { markdown: markdown ?? '', removed: [] };
  }
  const removed: Array<{ after: string; marker: string }> = [];
  const out = markdown.replace(MARKER, (whole, word: string, digits: string) => {
    if (ABBR.has(word.toLowerCase())) return whole;
    removed.push({ after: word, marker: digits });
    return `${word}.`;
  });
  return removed.length ? { markdown: out, removed } : { markdown, removed: [] };
}
