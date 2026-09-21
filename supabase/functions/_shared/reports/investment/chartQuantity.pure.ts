/**
 * A chart is a measurement, or it is not drawn as one.
 *
 * Both rules below were read off the twelve quantitative directives in the
 * Investment Compass delivered for 9 Hollow Street, Golden Square on
 * 21 Sep 2026, driven through the real parser rather than eyeballed. Every
 * fixture in `chartQuantity.spec.ts` is one of those twelve, verbatim.
 *
 * ## Rule one — a flag set is not a quantity
 *
 * Five of the twelve plot nothing but 0 and 1:
 *
 * ```
 * {{bars: GRZ zoning verified 1, Overlays mapped 0, Overlays checked list 1
 *        | title=Planning controls evidence snapshot | unit=index}}
 * {{bars: Zone GRZ (General Residential Zone) 1, Overlays checked & none
 *        mapped at coordinate 1, Land use table & certificate not yet read 1
 *        | title=Planning evidence snapshot | unit=index}}
 * {{heatmap: 1,0 / 1,0 | rows=Zone,Overlays | cols=Checked,Not in layer}}
 * ```
 *
 * On the page the third of those draws **three identical full-length bars**,
 * and the first draws `Overlays mapped` as a bar of zero height beside two
 * full ones — which a reader takes as *no overlays*, when what the register
 * actually says is that overlays were CHECKED and none were mapped at the
 * coordinate. That is a retrieval result stated as a count of zero, which is
 * the `rentalEvidence` rule — **absent is never zero** — committed in ink.
 *
 * A bar's length is the only thing a bar chart says. These carry no length
 * worth reading: what the reader needs is in the labels, and the labels are
 * already in the prose and in the appended planning and transport registers
 * beside them. So the drawing is withheld whole, and — as with
 * `withholdRatedAbsenceCharts`, whose rule this is — **nothing is worded in
 * its place**.
 *
 * It fires on a CONFESSION, never on a guess. Two things must both be true:
 * every plotted value is a flag (0, 1, or nothing the parser could read), AND
 * the directive's own text says it is not a measurement — by declaring a unit
 * that is not a unit (`index`, `Zone code`, `Descriptor`) or by naming a
 * retrieval state on an axis (`Checked`, `Not in layer`). A genuine count that
 * happens to read 1 and 0 — `{{bars: Hospitals 1, Universities 0 |
 * unit=facilities}}` — declares a real unit and is drawn exactly as it is
 * today.
 *
 * ## Rule two — a value cut out of a sentence is not this item's value
 *
 * This one is worse, because the chart draws and looks correct.
 *
 * ```
 * {{bars: Healthcare 10 within 5 km, Shopping centres 10 within 5 km,
 *        Parks & recreation 9 within 5 km, Restaurants & cafés 10 within 5 km
 *        | title=Local amenity counts within 5 km | unit=facilities}}
 * ```
 *
 * The grammar is `Label Value`, and the model wrote a sentence. The parser
 * takes the last number, so every item's value is **5** — the RADIUS — and
 * the counts 10, 10, 9 and 10 are discarded into the labels, which are then
 * left reading `Healthcare 10 within`. The page draws four identical bars
 * under a title promising amenity counts, on a document whose own enrichment
 * measured four different ones. The climate chart is the same cut:
 * `Annual rainfall vs local normal 683.1mm vs 511.3mm` plots **511.3**, the
 * long-run normal, and throws away the 683.1 the title is about.
 *
 * The tell is the label, and it is exact: **a label ending in a connective is
 * a sentence the parser cut, not a label.** `Healthcare 10 within` ends on
 * *within*; `Annual rainfall vs local normal 683.1mm vs` ends on *vs*. No
 * legitimate chart label ends in a preposition, and the label must also still
 * carry a number — proof that a figure was left behind in it — so
 * `3-bedroom houses` beside a value of 620000 is untouched, and so is
 * `Minimum lot size 450 m²`, which `chartUnits.labelStatedUnit` already reads
 * the other way round.
 *
 * Nothing is dropped and nothing is guessed. The label and the display are
 * re-joined into the phrase the model wrote and set as the table it always
 * was, split at its first number:
 *
 * ```
 * | Healthcare                     | 10 within 5 km      |
 * | Annual rainfall vs local normal| 683.1mm vs 511.3mm  |
 * ```
 *
 * Which is the reading the model intended, and the one the drawing destroyed.
 * This is `tabulateMixedUnitCharts`' rule — a promise of a figure is a figure,
 * so a directive the presentation cannot honour is set as its own data rather
 * than deleted behind the sentence that introduced it.
 *
 * ## What it does not do
 *
 * **It does not guess which number was meant.** Both halves of every row are
 * the model's own characters, moved; no value is recomposed, chosen or
 * dropped.
 *
 * **It does not withhold a chart whose every value is merely identical.** Two
 * quarters that genuinely measured the same thing are a dull chart, not a
 * false one, and withholding it would lose real data. Both all-equal series in
 * the document that found this are caught by a rule above on their own
 * evidence, so nothing is left standing by leaving that out.
 *
 * **It is byte-identical on a document whose charts measure something**, which
 * is what lets the read path adopt it for every report already stored.
 */
import { VIZ_DIRECTIVE_RE_G, parseVizDirective } from '../vizDirectives.pure.ts';
import { ABSENCE_WORDS } from './ratedAbsence.pure.ts';

/**
 * Words a `unit=` can carry that name no quantity.
 *
 * A unit says what is being counted or measured — dollars, facilities, metres,
 * minutes, per cent. These say the opposite: that the number beside them is a
 * marker standing in for a state. `held_but_unscoreable` is the same finding
 * one level up — a retrieved control is a fact, never a rating — and this is
 * that rule applied to a drawing.
 */
export const NON_UNIT_WORDS: readonly string[] = [
  'index',
  'indices',
  'code',
  'codes',
  'descriptor',
  'descriptors',
  'status',
  'statuses',
  'flag',
  'flags',
  'indicator',
  'indicators',
  'boolean',
  'bool',
  'binary',
  'marker',
  'markers',
  'tick',
  'ticks',
  'yes/no',
  'y/n',
  'true/false',
  'present/absent',
];

/**
 * Words on an axis that describe the SEARCH rather than the property.
 *
 * Deliberately short, and every entry is a retrieval verb. The absence
 * vocabulary `ratedAbsence` already fixed is imported rather than repeated,
 * because two lists of the same words is how the two come to disagree.
 */
const RETRIEVAL_WORDS: readonly string[] = [
  'checked',
  'unchecked',
  'verified',
  'unverified',
  'retrieved',
  'searched',
  'screened',
  'mapped',
  'unmapped',
  'integrated',
  'read',
  'check',
  'in layer',
  'on file',
];

const word = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, String.raw`\s+`);

const NON_UNIT_RE = new RegExp(String.raw`(?:^|[^a-z])(?:${NON_UNIT_WORDS.map(word).join('|')})(?![a-z])`, 'iu');

const RETRIEVAL_RE = new RegExp(
  String.raw`(?:^|[^a-z])(?:${[...RETRIEVAL_WORDS, ...ABSENCE_WORDS].map(word).join('|')})(?![a-z])`,
  'iu',
);

/** `unit=index`, `unit=Zone code`, `unit=Descriptor` — a marker, not a unit. */
export function nonMeasurementUnit(unit: string | undefined): boolean {
  const u = String(unit ?? '').trim();
  return !!u && NON_UNIT_RE.test(u);
}

/** `Checked`, `Not in layer`, `Overlays mapped`, `not yet read`. */
export function namesARetrievalState(labels: ReadonlyArray<string>): boolean {
  return labels.some((l) => RETRIEVAL_RE.test(String(l ?? '')));
}

/**
 * Is every plotted value a flag?
 *
 * An empty series counts, and deliberately: a bars directive the parser could
 * read no number out of has nothing to draw at all, and reaches the page as a
 * title over an empty plot. It is still only withheld where the directive also
 * confesses, which for the one in the document is `unit=Descriptor`.
 */
export function isFlagSeries(values: ReadonlyArray<number>): boolean {
  return values.every((v) => v === 0 || v === 1);
}

/**
 * The connectives a cut sentence dangles on.
 *
 * A label is a noun phrase. One that ends in a preposition or a conjunction
 * ended because something took the rest of it, and in a chart directive the
 * only thing that takes the rest of a label is the value parser.
 */
const CONNECTIVE_TAIL = /(?:^|[\s(])(?:within|vs\.?|versus|of|to|at|per|in|from|over|under|and|or|by|across|near|between|against|with|than)\s*$/iu;

/** …and the proof a figure was left behind in it. */
const CARRIES_A_NUMBER = /\d/u;

/**
 * Was this item's label cut off mid-sentence by the value parser?
 *
 * Both halves are required. The connective on its own would take a label
 * somebody wrote as `Growth to`, which carries no lost figure; the number on
 * its own would take `3-bedroom houses`, which is an ordinary label.
 */
export function labelIsACutSentence(label: string): boolean {
  const s = String(label ?? '').trim();
  return CARRIES_A_NUMBER.test(s) && CONNECTIVE_TAIL.test(s);
}

export interface WithheldFlagChart {
  readonly kind: string;
  /** Why it was withheld: the non-unit, or the retrieval state it named. */
  readonly reason: 'non_unit' | 'retrieval_state';
  readonly title?: string;
  /** The directive, clipped, so a render can be audited without the payload. */
  readonly directive: string;
}

export interface TabulatedSentenceChart {
  readonly kind: string;
  readonly title?: string;
  /** The item labels, as the parser left them, that proved the cut. */
  readonly cut: readonly string[];
}

export interface ChartQuantityResult {
  readonly markdown: string;
  readonly withheld: readonly WithheldFlagChart[];
  readonly tabulated: readonly TabulatedSentenceChart[];
}

/** Escape a cell so a value carrying a pipe cannot break the table. */
const cell = (s: string) => s.replace(/\|/gu, '\\|').trim();

/**
 * Removing a block leaves the blank lines that surrounded it. Three or more
 * newlines become two, so a withheld drawing leaves no hole on the page.
 */
const collapseBlankRuns = (markdown: string): string =>
  markdown.replace(/[ \t]*\n(?:[ \t]*\n){2,}/gu, '\n\n');

/**
 * Put an item back together and cut it where the reader would.
 *
 * `label + display` is the phrase the model wrote; the row splits at its first
 * number, which is where the subject ends and the measurement begins. Where
 * there is no subject before the first number the whole phrase stays in the
 * left cell rather than being rearranged.
 */
export function cutSentenceRow(
  item: { label: string; value: number; display?: string },
): { label: string; display: string } {
  const label = String(item.label ?? '').trim();
  const shown = String(item.display ?? '').trim() || String(item.value);
  const phrase = `${label} ${shown}`.replace(/\s+/gu, ' ').trim();
  const at = phrase.search(/\d/u);
  if (at <= 0) return { label: phrase, display: '' };
  const head = phrase.slice(0, at).replace(/[\s:·•,-]+$/u, '').trim();
  const tail = phrase.slice(at).trim();
  return head ? { label: head, display: tail } : { label: phrase, display: '' };
}

/**
 * Set a chart as a table, title leading as a bold line.
 *
 * A heading would enter the document's own outline and change its contents
 * page, and this is a presentation repair rather than a restructuring — the
 * same choice `tabulateMixedUnitCharts` makes, for the same reason.
 */
function tabulate(
  title: string | undefined,
  rows: ReadonlyArray<{ label: string; display: string }>,
): string {
  const head = title ? `**${cell(title)}**\n\n` : '';
  const valued = rows.some((r) => r.display);
  if (!valued) return `${head}${rows.map((r) => `- ${r.label}`).join('\n')}`;
  return `${head}| Item | Value |\n| --- | --- |\n`
    + rows.map((r) => `| ${cell(r.label)} | ${cell(r.display)} |`).join('\n');
}

/**
 * The values a directive plots, the labels it names them with, and its title.
 *
 * The title is read HERE rather than off the directive at the call site,
 * because only some of the twelve kinds declare one — a gauge has a `label`
 * and a margin has a `heading` — and reading `d.title` off the union is a type
 * error the app's own typecheck cannot see, since `supabase/functions` is
 * outside its project.
 */
function seriesOf(
  d: ReturnType<typeof parseVizDirective>,
): { values: number[]; labels: string[]; title?: string } | null {
  if (!d) return null;
  if (d.kind === 'bars') {
    return {
      values: d.items.map((i) => i.value),
      labels: d.items.map((i) => i.label),
      title: d.title,
    };
  }
  if (d.kind === 'heatmap') {
    return { values: d.grid.flat(), labels: [...d.rowLabels, ...d.colLabels], title: d.title };
  }
  /*
   * A sparkline is the same defect at the smallest size the document draws.
   * Page 17 of that Compass carried `{{margin: Overlay check basis |
   * spark=1,0}}` — a two-point trend from "checked" to "not mapped", which is
   * a line drawn between two states rather than between two measurements.
   */
  if (d.kind === 'margin') {
    return {
      values: d.spark ?? [],
      labels: [d.heading, d.label, d.note].filter((x): x is string => !!x),
      title: d.heading,
    };
  }
  return null;
}

/**
 * Withhold every flag chart and tabulate every cut sentence.
 *
 * Returns the source unchanged, and two empty lists, for a document whose
 * charts all measure something — which is every document that was already
 * right, byte for byte.
 */
export function enforceChartQuantity(markdown: string): ChartQuantityResult {
  if (!markdown) return { markdown: '', withheld: [], tabulated: [] };
  const withheld: WithheldFlagChart[] = [];
  const tabulated: TabulatedSentenceChart[] = [];

  const out = markdown.replace(VIZ_DIRECTIVE_RE_G, (whole, kind: string, body: string) => {
    const k = String(kind).toLowerCase();
    const d = parseVizDirective(kind, body);
    const series = seriesOf(d);
    if (!d || !series) return whole;

    if (isFlagSeries(series.values) && (d.kind !== 'margin' || series.values.length)) {
      const unit = d.kind === 'bars' ? d.unit : undefined;
      const reason = nonMeasurementUnit(unit)
        ? 'non_unit'
        : namesARetrievalState(series.labels)
          ? 'retrieval_state'
          : null;
      if (reason) {
        withheld.push({ kind: k, reason, title: series.title, directive: whole.slice(0, 160) });
        return '';
      }
    }

    // A cut sentence is a property of a labelled item, so only `bars` can
    // carry one: a heatmap's numbers never share a cell with its labels.
    if (d.kind === 'bars' && d.items.length) {
      const cut = d.items.filter((i) => labelIsACutSentence(i.label)).map((i) => i.label);
      if (cut.length) {
        tabulated.push({ kind: k, title: d.title, cut });
        return tabulate(d.title, d.items.map(cutSentenceRow));
      }
    }

    return whole;
  });

  if (!withheld.length && !tabulated.length) return { markdown, withheld: [], tabulated: [] };
  return { markdown: collapseBlankRuns(out), withheld, tabulated };
}
