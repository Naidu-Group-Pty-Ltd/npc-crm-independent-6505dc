/**
 * A labelled BLOCK is a promise that a figure follows it.
 *
 * `derivedHygiene.stripPlaceholderRows` enforces that rule on table rows and
 * has since the Executive Briefing shipped 87 "N/A" cells. This module carries
 * the same rule into the two block types it never covered — the oversized stat
 * card and the chart directive — and into the PARENT document, which
 * `stripPlaceholderRows` has never been called on.
 *
 * ## 1. The stat card with no value
 *
 * `::: stat` draws the largest single element on a page. Measured 2026-09-07
 * across the 24 Compass reports that use it, **23 of 71 cards (32%) carry a
 * label, a unit and a sub-caption and no value**, on 15 of the 24 reports.
 * Verbatim from the newest report (`28 Bligh Street, Muswellbrook`):
 *
 * ```
 * ::: stat label="Nearest station access" unit="m" sub="Muswellbrook Station from local transport references"
 *
 * :::
 * ```
 *
 * The renderer draws `stat-value` unconditionally, so what a client receives is
 * not a blank space — it is an oversized **"m"**, or an oversized **"/100"**,
 * set in display type with a caption underneath explaining what it measures.
 * The unit becomes the statistic.
 *
 * A card with nothing to state is not drawn. Not a dash, not a zero, not the
 * unit on its own — the same answer this programme gives everywhere else.
 *
 * ## 2. The chart drawn twice
 *
 * The generator's prompt tells it to render each figure once. It does not
 * always: 5 of the 26 chart-bearing reports since June repeat a directive, 7
 * redundant draws in all. They are NEAR-identical rather than identical — a
 * different dash character, `3,120` against `3120` — which is why the prompt's
 * own instruction and an exact-match comparison both miss them.
 *
 * Normalisation is therefore the whole mechanism, and it is deliberately
 * narrow: case, whitespace, dash variants and thousands separators. Two charts
 * that differ in any VALUE remain two charts.
 *
 * ## Where this runs
 *
 * Both passes are pure and are applied on the WRITE path (the parent's
 * post-processor and the derived reports' hygiene, so nothing new is stored)
 * and on the READ path (the PDF renderer, so the 15 reports already carrying an
 * empty card are repaired for every reader without a migration). That is the
 * same asymmetry `healFinanceIdentity` settled on, and for the same reason: a
 * repair that only helps future documents leaves the ones already sent.
 *
 * One predicate, imported by both ends. Two implementations of "is this card
 * empty" is how the two ends come to disagree.
 */

import { partitionCode } from './printableGlyphs.pure.ts';
import { parseVizDirective } from '../vizDirectives.pure.ts';

export interface BlockScrubResult {
  markdown: string;
  /** Stat cards dropped for having no value. */
  emptyStatCards: number;
  /** Chart directives dropped as a repeat of one already drawn. */
  duplicateDirectives: number;
}

/**
 * The fence a stat card opens with, its attributes, its body and its close.
 * Anchored per line, because a `:::` inside prose is not a fence.
 */
const STAT_BLOCK = /^:::[ \t]*stat[ \t]*([^\n]*)\n([\s\S]*?)\n?^:::[ \t]*$/gm;

/**
 * Does this stat card state anything?
 *
 * The body is the value. Attributes are not: a label names the figure, a unit
 * qualifies it and a sub-caption explains it, and none of the three IS one.
 */
export function statCardHasValue(body: string): boolean {
  return (body || '').replace(/\s+/g, '') !== '';
}

/**
 * Drop every stat card whose body states nothing.
 *
 * The card goes whole — heading, unit and caption with it. Keeping the label
 * and dropping only the value would leave the promise standing with nothing
 * behind it, which is the defect rather than the fix.
 */
export function stripEmptyStatCards(markdown: string): { markdown: string; removed: number } {
  let removed = 0;
  const out = (markdown || '').replace(STAT_BLOCK, (whole, _attrs: string, body: string) => {
    if (statCardHasValue(body)) return whole;
    removed += 1;
    return '';
  });
  return { markdown: removed ? collapseBlankRuns(out) : out, removed };
}

/** The directive kinds that draw a figure, and may therefore be drawn twice. */
const CHART_KINDS = ['bars', 'line', 'donut', 'gauge', 'pie', 'area', 'columns', 'scatter'] as const;

const DIRECTIVE = new RegExp(`\\{\\{(?:${CHART_KINDS.join('|')})[ \\t]*:[^}]*\\}\\}`, 'g');

/**
 * Segments of a directive body that CAPTION the drawing rather than describe
 * it. Everything else — the payload, `max`, `unit` — changes what a reader
 * takes from the chart and stays in the key.
 */
const CAPTION_OPTION = /^(?:title|caption)\s*=/i;

/**
 * The comparison key for "the same chart".
 *
 * Case, whitespace, dash variants and thousands separators — and NOT the
 * title. A directive differing in any digit, label, unit or maximum is a
 * different chart and is kept; this is a de-duplicator, never a summariser.
 *
 * ## Why the title leaves the key
 *
 * It was in it, and the 97 Poole Road Compass of 20 Sep 2026 is what that
 * cost. The identical three bars `Other offences 22 | Robbery 16 | Arson 9`
 * were drawn on pages 20, 23, 24 AND 25 under four different titles:
 *
 *   Recorded offence counts in the latest period (selected categories)
 *   Latest recorded counts by offence category
 *   Recorded offence counts, The Hills Shire
 *   Recorded offence counts · The Hills Shire crime data reference period
 *
 * and `$1,650,000 | $1,808,000 | $1,110,000` on pages 21, 29 and 31 under
 * three more. Eight drawings, two datasets. Normalising the whole directive
 * meant a caption was enough to make a repeat look new, so the pass that
 * exists to stop exactly this saw seven distinct charts.
 *
 * **The data is the chart.** A caption is what a section calls it, and a
 * reader meeting the same three bars four times in six pages does not read
 * four findings — they read a broken document.
 */
export function directiveKey(directive: string): string {
  const body = /^\{\{[a-zA-Z_]+[ \t]*:([\s\S]*)\}\}$/.exec((directive || '').trim());
  const source = body
    ? body[1].split('|').filter((seg) => !CAPTION_OPTION.test(seg.trim())).join('|')
    : (directive || '');
  return source
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/(\d),(\d)/g, '$1$2');
}

/**
 * A drawn point's identity: the year its label names, where it names one, and
 * otherwise the whole label — with the value it draws.
 *
 * The year is the part of a period label that means something. "2026 Main
 * series", "2026" and "2026 (projected)" are one bar in one series; a label
 * with no year is compared whole, so two categories are never mistaken for
 * each other because they share a word.
 */
function pointKey(label: string, value: number): string {
  const year = /\b(1[89]\d{2}|20\d{2})\b/.exec(label)?.[1];
  return `${year ?? label.toLowerCase().replace(/\s+/g, ' ').trim()}=${value}`;
}

/** The points a `bars` directive draws, and the options that change its reading. */
function barSeries(directive: string): { points: string[]; options: string } | null {
  const m = /^\{\{\s*bars\s*:([\s\S]*)\}\}$/i.exec(directive.trim());
  if (!m) return null;
  const parsed = parseVizDirective('bars', m[1]);
  if (!parsed || parsed.kind !== 'bars' || parsed.items.length < 3) return null;
  return {
    points: parsed.items.map((i) => pointKey(i.label, i.value)),
    options: `${parsed.max ?? ''}|${(parsed.unit ?? '').toLowerCase()}`,
  };
}

/** Every point of `later` in `earlier`, in the same order. */
function isRedrawOf(later: readonly string[], earlier: readonly string[]): boolean {
  let at = 0;
  for (const p of later) {
    while (at < earlier.length && earlier[at] !== p) at += 1;
    if (at === earlier.length) return false;
    at += 1;
  }
  return true;
}

/**
 * Keep the first drawing of each chart and drop the later repeats.
 *
 * First rather than last, because a report is read forwards: the earlier
 * placement is the one whose surrounding prose introduced it.
 *
 * ## A series redrawn under other labels is the same chart
 *
 * The 23 Sep 2026 Due Diligence report for 97 Poole Road drew the Kellyville–
 * East population projection three times: five bars from the 2021 base to
 * 2041, then the same four projected years labelled "2026 Main series", then
 * the five again labelled "2026". The values were identical to the person;
 * the key compared labels verbatim, so each looked new. A `bars` directive is
 * now also dropped where EVERY point it draws — by year where the label names
 * one, by whole label otherwise, and with its value — was already drawn, in
 * the same order, by an earlier bar chart with the same unit and maximum.
 * Three points at least, and never the other way round: a later chart that
 * ADDS a point is kept, because dropping it would lose that point.
 */
export function dedupeChartDirectives(markdown: string): { markdown: string; removed: number } {
  const seen = new Set<string>();
  const drawn: Array<{ points: string[]; options: string }> = [];
  let removed = 0;
  const out = (markdown || '').replace(DIRECTIVE, (whole) => {
    const key = directiveKey(whole);
    if (seen.has(key)) {
      removed += 1;
      return '';
    }
    const series = barSeries(whole);
    if (series && drawn.some((d) => d.options === series.options && isRedrawOf(series.points, d.points))) {
      removed += 1;
      return '';
    }
    seen.add(key);
    if (series) drawn.push(series);
    return whole;
  });
  return { markdown: removed ? collapseBlankRuns(out) : out, removed };
}

/**
 * Removing a block leaves the blank lines that surrounded it. Three or more
 * newlines become two — a paragraph break — so a dropped card does not leave a
 * hole in the page where it stood.
 */
function collapseBlankRuns(markdown: string): string {
  return markdown.replace(/[ \t]*\n(?:[ \t]*\n){2,}/g, '\n\n');
}

/** Both passes, in the order a document is cleaned: drop, then de-duplicate. */
export function scrubBlocks(markdown: string): BlockScrubResult {
  const cards = stripEmptyStatCards(markdown);
  const charts = dedupeChartDirectives(cards.markdown);
  return {
    markdown: charts.markdown,
    emptyStatCards: cards.removed,
    duplicateDirectives: charts.removed,
  };
}

/**
 * W4.6 — a list marker with nothing after it.
 *
 * Page 16 of the 9 Hollow Street Compass drew **four empty bullets**: a
 * bullet glyph, indented, with no words beside it. A marker is drawn from the
 * list style rather than from the item's content, so an item holding nothing
 * still prints its dot and still takes its line — which reads as a list whose
 * entries failed to load.
 *
 * Nothing removed them. Driven through the real read path, every one survived
 * to the end: `stripPlaceholderRows` judges table rows, `stripEmptyStatCards`
 * judges stat cards, `dropEmptySections` judges headings, and an item inside a
 * list is none of those.
 *
 * ## Why this is not the prose scrub §8 forbids
 *
 * **There is no prose.** An item with nothing after its marker carries no
 * word, no figure, no claim and no source, so there is nothing for this to
 * change — which is a stronger version of the argument the footnote rule had
 * to make, where a digit at least existed. A spec asserts that every surviving
 * line is byte-identical and that only whole empty-marker lines are ever
 * dropped.
 *
 * ## Three bounds
 *
 * **A parent is never orphaned from its child.** An empty marker followed by a
 * more-indented line is a parent whose children carry the content — removing
 * it would promote them into the list above or strand them entirely — so it is
 * kept. Measured against the ordinary shape a model writes, where an empty
 * parent is rare and a trailing empty sibling is the common debris.
 *
 * **A task list is not empty.** `- [ ]` and `- [x]` have content after the
 * marker; the pattern requires the line to end at the marker, so neither
 * matches.
 *
 * **Code is a quotation.** The partition is `printableGlyphs.pure.ts`'s, which
 * is asserted to reproduce its input byte-for-byte over thirteen shapes,
 * imported rather than re-implemented for the reason everything else here is:
 * two readings of one grammar is how the two come to disagree.
 */
/** `-`, `*`, `+`, `1.`, `1)` and nothing else on the line. */
const EMPTY_ITEM_RE = /^([ \t]*)(?:[-*+]|\d{1,3}[.)])[ \t]*$/;

/** How much a line is indented, tabs counted as four. */
function indentOf(line: string): number {
  const m = /^[ \t]*/.exec(line);
  return (m?.[0] ?? '').replace(/\t/g, '    ').length;
}

export interface EmptyListItemResult {
  markdown: string;
  /** The lines removed, as written, so a caller can say what went. */
  removed: string[];
  /** Empty markers kept because a more-indented line depends on them. */
  keptAsParents: number;
}

export function stripEmptyListItems(markdown: string): EmptyListItemResult {
  if (!markdown || !markdown.split('\n').some((l) => EMPTY_ITEM_RE.test(l))) {
    return { markdown, removed: [], keptAsParents: 0 };
  }
  const removed: string[] = [];
  let keptAsParents = 0;

  const out = partitionCode(markdown).map(([text, isCode]) => {
    if (isCode) return text;
    const lines = text.split('\n');
    const kept = lines.filter((line, i) => {
      if (!EMPTY_ITEM_RE.test(line)) return true;
      // Look past blank lines to the next line that says anything.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      const next = j < lines.length ? lines[j] : null;
      if (next !== null && next.trim() !== '' && indentOf(next) > indentOf(line)) {
        keptAsParents += 1;
        return true;
      }
      removed.push(line);
      return false;
    });
    return kept.join('\n');
  }).join('');

  return removed.length
    ? { markdown: out.replace(/\n{3,}/g, '\n\n'), removed, keptAsParents }
    : { markdown, removed: [], keptAsParents };
}
