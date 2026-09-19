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
 * The comparison key for "the same chart".
 *
 * Case, whitespace, dash variants and thousands separators only. A directive
 * differing in any digit, label or title is a different chart and is kept —
 * this is a de-duplicator, never a summariser.
 */
export function directiveKey(directive: string): string {
  return (directive || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/(\d),(\d)/g, '$1$2');
}

/**
 * Keep the first drawing of each chart and drop the later repeats.
 *
 * First rather than last, because a report is read forwards: the earlier
 * placement is the one whose surrounding prose introduced it.
 */
export function dedupeChartDirectives(markdown: string): { markdown: string; removed: number } {
  const seen = new Set<string>();
  let removed = 0;
  const out = (markdown || '').replace(DIRECTIVE, (whole) => {
    const key = directiveKey(whole);
    if (!seen.has(key)) {
      seen.add(key);
      return whole;
    }
    removed += 1;
    return '';
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
