/**
 * An absence may not be rated — and a chart that says it rates one is not drawn.
 *
 * ## What page 23 of the 9 Hollow Street Compass printed
 *
 * ```
 *   Risk exposure index (1=Low, 5=High, Not assessed shown as 5)
 *
 *                Exposure level
 *   Crime            3    3    3    4    4    4    5
 *
 *   Risk | Exposure level | Evidence chip | Due-diligence focus
 *   Crime | Not assessed | Unverified | State crime register and local police data
 * ```
 *
 * The register beneath the drawing is correct: crime exposure was **not
 * assessed**. The drawing above it plots that same risk on a 1–5 exposure
 * scale — and the title states the convention that made it possible, *Not
 * assessed shown as 5*, which puts an unmeasured risk at the top of the scale
 * it shares with the measured ones.
 *
 * `PLANNING_CONTROLS_IN_THE_REPORT.md` §9 already paid for this once, in
 * words: *an absence may not be RATED*. `Not assessed` is the level, and never
 * Low, Minimal, Negligible or Favourable — and never High either. What that
 * section closed was the STATEMENT. This closes the DRAWING, where the same
 * conclusion is reached without a sentence to catch it: a number on a scale is
 * read as a measurement however it got there, and a reader has no way to tell
 * an absence dressed as a 5 from a risk that was measured at 5.
 *
 * ## The rule
 *
 * **A chart whose own text declares an absence-to-value convention is
 * withheld from the drawing.** The whole series goes, not the rated cells:
 * once one value on the scale carries two meanings, every cell at that value
 * is ambiguous, and a risk chart with its top readings quietly removed reads
 * as a property with no high risks. There is no repair available — the
 * convention destroyed the distinction the chart would need to be corrected
 * by — so the honest outcome is not to draw it.
 *
 * Nothing is lost on the document that found this: the summary register three
 * lines below carries every risk with its exposure and its evidence reading,
 * which is the statement the chart was a decoration of.
 *
 * ## Three bounds
 *
 * **It fires on a CONFESSION, never on a guess.** The directive's own text has
 * to state the mapping — an absence word, a connective that means *is drawn
 * as*, and a number. A chart that rates an absence silently is invisible to
 * this and belongs to the generator's instructions, which say so; an
 * instruction is a request and this is the guarantee, so the two are not
 * alternatives.
 *
 * **A count of absences is not a convention.** `Risks not assessed: 3` is a
 * fact about the register, so the connective is required and a bare number
 * after the phrase is not enough.
 *
 * **Nothing is worded in its place.** An absence is omitted rather than
 * explained — §8 of `RUNTIME_CONSOLIDATION.md` — so a withheld chart leaves
 * no note, no caption and no placeholder, and the blank lines that held it
 * close up behind it.
 *
 * Measured across the three Compass reports issued on 20 Sep 2026
 * (9 Hollow Street, 1 Crestview Avenue, 97 Poole Road): **1 directive
 * withheld, on the one page that carried the confession**, and every other
 * chart in all three documents byte-identical.
 */
import { VIZ_DIRECTIVE_RE_G } from '../vizDirectives.pure.ts';

/**
 * The words a document uses for "we did not measure this".
 *
 * Read off the vocabularies this repository already fixes rather than
 * invented: `RISK_EXPOSURE_LEVELS`' own `Not assessed`, the five planning
 * absences (`not_served` / `not_integrated` / `licence_restricted` /
 * `none_at_point` / `unavailable`), and the placeholder words
 * `stripPlaceholderRows` already refuses on a client page.
 */
export const ABSENCE_WORDS: readonly string[] = [
  'not assessed',
  'unassessed',
  'not available',
  'unavailable',
  'not measured',
  'unmeasured',
  'not searched',
  'not retrieved',
  'not recorded',
  'not reported',
  'not stated',
  'not known',
  'not held',
  'unknown',
  'no data',
  'no reading',
  'nil data',
  'missing',
  'n/a',
  'n.a.',
];

/**
 * The verbs that mean "is drawn as". Without one of these the phrase is a
 * statement about the register rather than about the chart.
 */
const CONNECTIVE = String.raw`(?:=|(?:is|are|was|were)?\s*(?:shown|showing|displayed|drawn|plotted|charted|graphed|counted|treated|scored|rated|mapped|recorded|set|appears?|entered)\s*(?:as|at|to|=)?|as)`;

const ABSENCE_ALT = ABSENCE_WORDS
  .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, String.raw`\s+`))
  .join('|');

/** `Not assessed shown as 5`, `no data = 0`, `unknown treated as 3`. */
const FORWARD = new RegExp(
  String.raw`(?:^|[^a-z])((?:${ABSENCE_ALT}))\s*${CONNECTIVE}\s*(\d+(?:\.\d+)?)`,
  'i',
);

/** The legend order: `5 = Not assessed`, `0 means no data`. */
const REVERSE = new RegExp(
  String.raw`(\d+(?:\.\d+)?)\s*(?:=|:|means|meaning|denotes|indicates)\s*((?:${ABSENCE_ALT}))(?![a-z])`,
  'i',
);

export interface DeclaredAbsenceRating {
  /** The confession, exactly as the document wrote it. */
  readonly phrase: string;
  /** The absence word inside it. */
  readonly word: string;
  /** The value the absence was drawn at. */
  readonly value: number;
}

/**
 * The absence-to-value convention a piece of chart text declares, or `null`.
 *
 * Judged on the raw text rather than on a parsed directive, because the
 * convention lives in a title, a caption or an axis legend — none of which
 * every kind carries a typed field for — and because a directive the parser
 * refused still reached the page as a promise of a figure.
 */
export function declaredAbsenceRating(text: string): DeclaredAbsenceRating | null {
  const s = String(text ?? '');
  if (!s) return null;
  const fwd = FORWARD.exec(s);
  if (fwd) return { phrase: fwd[0].replace(/^[^a-z0-9]+/i, '').trim(), word: fwd[1].trim(), value: Number(fwd[2]) };
  const rev = REVERSE.exec(s);
  if (rev) return { phrase: rev[0].trim(), word: rev[2].trim(), value: Number(rev[1]) };
  return null;
}

export interface WithheldChart {
  /** The directive's kind, as written. */
  readonly kind: string;
  /** The convention it declared. */
  readonly rating: DeclaredAbsenceRating;
  /** The directive, clipped, so a render can be audited without the payload. */
  readonly directive: string;
}

export interface RatedAbsenceResult {
  readonly markdown: string;
  readonly withheld: readonly WithheldChart[];
}

/**
 * Removing a block leaves the blank lines that surrounded it. Three or more
 * newlines become two — a paragraph break — so a withheld drawing does not
 * leave a hole on the page where it stood.
 */
const collapseBlankRuns = (markdown: string): string =>
  markdown.replace(/[ \t]*\n(?:[ \t]*\n){2,}/g, '\n\n');

/**
 * Withhold every chart that says it draws an absence as a value.
 *
 * Returns the source unchanged, and an empty list, for a document in which no
 * chart carries the confession — which is every document that was already
 * right, byte for byte.
 */
export function withholdRatedAbsenceCharts(markdown: string): RatedAbsenceResult {
  if (!markdown) return { markdown: '', withheld: [] };
  const withheld: WithheldChart[] = [];
  const out = markdown.replace(VIZ_DIRECTIVE_RE_G, (whole, kind: string, body: string) => {
    const rating = declaredAbsenceRating(String(body));
    if (!rating) return whole;
    withheld.push({ kind: String(kind).toLowerCase(), rating, directive: whole.slice(0, 160) });
    return '';
  });
  return withheld.length ? { markdown: collapseBlankRuns(out), withheld } : { markdown, withheld: [] };
}
