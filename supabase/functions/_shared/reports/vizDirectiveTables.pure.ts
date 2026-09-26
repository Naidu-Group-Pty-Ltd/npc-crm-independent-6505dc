/**
 * A figure a presentation cannot draw is tabulated, never dropped.
 *
 * The generator's prompt asks the model to write its charts as `{{bars: …}}`,
 * `{{heatmap: …}}` and ten more kinds, and the design-system renderer draws
 * them. The standard (pdf-lib) presentation cannot, and until now it REMOVED
 * every directive at paint time — correct as far as it went (a directive's
 * source must never print), but the prose that introduced the figure stayed:
 * "The matrix below groups the main amenities by type" printed on two of the
 * audited 291 Stone Mason Drive documents with nothing below it (QA-33), and
 * the amenity data the model had gathered went out with the drawing.
 *
 * Every kind carries tabular data — labels and values, phases and
 * milestones, a grid — so each is written back as a Markdown table (or, for
 * the one-figure kinds, a labelled line) that the standard presentation
 * already knows how to set. The numbers are the directive's own, verbatim;
 * nothing is computed. A directive the shared parser refuses is removed
 * exactly as before, because an unparseable payload holds no data to keep.
 *
 * Deno-compatible: imports a sibling only.
 */
import { glanceRows } from './glanceStrip.pure.ts';
import {
  parseVizDirective,
  VIZ_DIRECTIVE_KINDS,
  VIZ_DIRECTIVE_RE_G,
  isPlaceholderValue,
  splitRefusedItem,
  type VizDirective,
} from './vizDirectives.pure.ts';

const cell = (v: unknown): string => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/**
 * The rows a refused directive contributes, with the absences left out.
 *
 * A promise of a figure is a figure, which is why a refused item becomes a
 * ROW rather than vanishing. But an item whose value is `n/a` promised no
 * figure — it stated an absence — and the owner's rule is that a placeholder
 * never reaches a client document. Page 20 of the 9 Hollow Street Compass
 * (20 Sep 2026) printed `Victoria dwellings benchmark n/a` beside a subject
 * price and a suburb median, and `stripPlaceholderRows` could not remove it:
 * the row is built here, at render time, and never exists as markdown the
 * scrub reads.
 *
 * Where nothing survives, the caller draws nothing — an absence is omitted,
 * never worded.
 */
export function refusedRows(sources: readonly string[]): string[][] {
  const rows = sources
    .map((src) => splitRefusedItem(src))
    .filter((r) => !isPlaceholderValue(r.value))
    .map((r) => [r.label, r.value]);
  // A comparison with one side left is not a comparison: two or more items
  // named and fewer than two surviving draws nothing (60 Lawley Street,
  // 25 Sep 2026 — see the same rule in `vizFigures.pure.ts`).
  return sources.length >= 2 && rows.length < 2 ? [] : rows;
}

function table(headers: string[], rows: string[][]): string[] {
  if (!rows.length) return [];
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ];
}

const caption = (title?: string): string[] => (title ? [`**${cell(title)}**`, ''] : []);

/**
 * A caption travels only with the table it names.
 *
 * Every case below used to write `[...caption(title), ...table(…)]`, and
 * `table()` answers `[]` when nothing survives — so a directive whose rows
 * were all placeholders, or a comparison with one side left, came out as its
 * caption alone: page 14 of the 60 Lawley Street Compass would have read
 * **Visible competing Houses in Spalding** in bold over nothing at all, a
 * heading promising competing stock with no stock under it. A table with a
 * caption is byte-identical to before.
 */
const captioned = (title: string | undefined, rows: string[]): string[] =>
  (rows.length ? [...caption(title), ...rows] : []);

/** The Markdown a directive becomes, or null when it holds nothing to keep. */
export function directiveAsMarkdown(d: VizDirective): string | null {
  let lines: string[] = [];
  switch (d.kind) {
    case 'bars':
      // `sources` is present only where the parser refused an item, and it is
      // every item in the model's own order — so the table carries the labels
      // the figure could not plot rather than silently shortening the list.
      lines = captioned(d.title, table(['Item', d.unit ? `Value (${d.unit})` : 'Value'],
        d.refused?.length
          ? refusedRows(d.sources ?? [])
          : d.items.map((i) => [i.label, i.display ?? fmt(i.value)])));
      break;
    case 'donut':
      lines = captioned(d.title, table(['Segment', 'Share'],
        d.refused?.length
          ? refusedRows(d.sources ?? [])
          : d.segments.map((s) => [s.label, s.display ?? fmt(s.value)])));
      if (lines.length && d.center && !d.refused?.length) {
        lines.push('', `_${cell(d.center)}${d.centerSub ? ` — ${cell(d.centerSub)}` : ''}_`);
      }
      break;
    case 'gauge':
      lines = [`**${cell(d.label ?? 'Reading')}:** ${fmt(d.value)} / ${fmt(d.max)}${d.caption ? ` — ${cell(d.caption)}` : ''}`];
      break;
    case 'glance':
      // The glyph is an INPUT vocabulary. This presentation used to print it
      // raw, so the same finding read `- ✓ Metro access` here and
      // `Strength  Metro access` in the design-system render. One mapping,
      // imported rather than repeated.
      lines = glanceRows(d.items).map((r) => `- ${cell(r.tag)} — ${cell(r.text)}`);
      break;
    case 'heatmap': {
      const cols = d.colLabels.length ? d.colLabels : d.grid[0]?.map((_, i) => `Column ${i + 1}`) ?? [];
      const rows = d.grid.map((r, ri) => [d.rowLabels[ri] ?? `Row ${ri + 1}`, ...cols.map((_, ci) => (r[ci] === undefined ? '' : fmt(r[ci])))]);
      // The title is the header's first cell rather than a caption above it:
      // a grid of bare bands is only readable with its scale beside it, and
      // the standard presentation omits a numeric grid whose header carries no
      // unit or scale (`looksAnonymousNumericGrid`).
      lines = table([d.title ?? 'Item', ...cols], rows);
      break;
    }
    case 'margin': {
      const head = [d.heading, d.label].filter(Boolean).map(cell).join(' — ');
      if (!head && !d.note) return null;
      lines = [`_${[head, d.note ? cell(d.note) : ''].filter(Boolean).join(': ')}_`];
      break;
    }
    case 'pictograph':
      lines = [`**${cell(d.label ?? 'Count')}:** ${fmt(d.filled)} of ${fmt(d.total)}${d.sub ? ` — ${cell(d.sub)}` : ''}`];
      break;
    case 'quadrant':
      lines = captioned(d.title, table(['Item', d.xLabel ?? 'X', d.yLabel ?? 'Y'],
        d.points.map((p) => [p.label, fmt(p.x), fmt(p.y)])));
      break;
    case 'tiles': {
      const withSub = d.tiles.some((t) => t.sub);
      lines = captioned(d.title, table(withSub ? ['Item', 'Value', 'Note'] : ['Item', 'Value'],
        d.tiles.map((t) => (withSub ? [t.label, t.value, t.sub ?? ''] : [t.label, t.value]))));
      break;
    }
    case 'timeline':
      lines = captioned(d.title, table(['Phase', 'Milestone'], d.items.map((i) => [i.phase, i.label])));
      break;
    case 'waterfall':
      lines = captioned(d.title, table(['Step', 'Amount'],
        d.items.map((i) => [i.total ? `**${cell(i.label)}**` : i.label, fmt(i.value)])));
      break;
    case 'wheel':
      lines = captioned(d.title, table(['Dimension', `Score (of ${fmt(d.max)})`],
        d.labels.map((l, i) => [l, d.scores[i] === undefined ? '' : fmt(d.scores[i])])));
      break;
  }
  const body = lines.join('\n').trim();
  return body ? body : null;
}

export interface TabulationResult {
  markdown: string;
  /** Directives written back as tables or lines. */
  tabulated: number;
  /** Directives the parser refused, removed as before. */
  removed: number;
}

/**
 * Replace every directive in `content` with its table. A directive alone on
 * its line becomes a block of its own; one inside a sentence is lifted out
 * onto the following lines so the sentence keeps reading.
 */
export function tabulateVizDirectives(content: string): TabulationResult {
  if (!content || !content.includes('{{')) return { markdown: content, tabulated: 0, removed: 0 };
  let tabulated = 0;
  let removed = 0;
  const out = content.replace(VIZ_DIRECTIVE_RE_G, (whole, rawKind: string, body: string) => {
    if (!(VIZ_DIRECTIVE_KINDS as readonly string[]).includes(String(rawKind).toLowerCase())) return whole;
    const parsed = parseVizDirective(rawKind, body ?? '');
    const md = parsed ? directiveAsMarkdown(parsed) : null;
    if (!md) { removed += 1; return ''; }
    tabulated += 1;
    return `\n\n${md}\n\n`;
  });
  const markdown = tabulated || removed
    ? out.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n')
    : out;
  return { markdown, tabulated, removed };
}
