/**
 * Turning a chapter's transcribed Markdown into *designed* blocks.
 *
 * ## The thing this fixes
 *
 * A converted Borrowing Capacity Snapshot came back reading far worse than the
 * PDF it was made from, and the reason was not the transcription. Claude
 * returned 6,311 characters of Markdown in eleven seconds with every pipe table
 * and every figure intact. What happened next was `renderMarkdown(...).html` and
 * nothing else — one call, no charts imported at all. `renderMarkdown` knows
 * headings, lists, emphasis, blockquotes and pipe tables; **every other line
 * becomes a `<p>`**. So the source's KPI strip arrived as a three-column table
 * and its utilisation bar arrived as a paragraph reading `Proposed loan 76%`.
 *
 * The design system it was supposedly converting *onto* has `renderKpiStrip`,
 * `renderCallout`, `renderSidenote` and a dozen charts. None of them were
 * reachable from a converted document, because nothing decided which one a
 * given passage wanted. That decision is the design work, and it is what this
 * module asks a model for.
 *
 * ## Typed blocks, not HTML
 *
 * The model returns a list of blocks from a **closed vocabulary**, each one
 * mapping to exactly one primitive (`row` to the twelve-column grid), and
 * `renderBlocks.pure.ts` renders them.
 * The model never emits HTML, never chooses a colour, never sets a size. It
 * says "these four figures are a KPI strip" and the design system decides what
 * a KPI strip looks like under the chosen brand.
 *
 * That split is what makes this safe to run on model output at all: the widest
 * thing a compromised or confused answer can do is pick the wrong block, which
 * looks wrong and is not dangerous. Every string still goes through
 * `escapeHtml` in the primitives, and every number is checked against the
 * source by `faithfulness.pure.ts` before any of it is rendered.
 *
 * ## How wide the vocabulary is, and why it widened
 *
 * It began at nine kinds, on the reasoning that a transcription rarely yields
 * the shapes the richer primitives want and that offering them to a model with
 * a page of prose and a target to hit invites it to invent the data that would
 * justify one. Layout was excluded outright as "the design system's decision,
 * not the model's".
 *
 * A natively designed report of the same figures settled that argument. It put
 * three headline cards *across* the page, built the capacity up as a waterfall,
 * and set two short note boxes side by side — and every one of those primitives
 * already existed here, unreachable, because this schema did not name them. The
 * document that resulted from the narrow schema was not more faithful; it was
 * the same content stacked in one column down the left of every page.
 *
 * So: the content kinds now cover what the design system can actually draw, and
 * `row` is the one *layout* kind. The original worry stands and is answered by
 * the guards rather than by the omission — a waterfall whose steps do not add
 * up fails `checkFaithful` exactly as an invented figure in a sentence does.
 * What is still excluded is anything needing data a transcription cannot carry:
 * heatmaps, calendars, micro-maps and score wheels want coordinates, dates and
 * dimensions that no uploaded template supplies.
 *
 * ## Fidelity
 *
 * Three levels, chosen per conversion, all of which lock the figures:
 *
 * - `restructure` — the same words, in better form. No new prose at all.
 * - `connective` — may additionally write short ledes and sub-headings, so a
 *   chapter reads as one argument rather than a list of parts.
 * - `rewrite` — may rewrite prose in house voice.
 *
 * The default is `restructure`, because a converter that quietly improves
 * somebody's template is not a converter and the person who uploaded it has not
 * yet said otherwise.
 *
 * Pure. The prompts are diffable, the reader is testable against hand-written
 * fixtures, and no part of this file makes a network call — `enrich.ts` beside
 * it does that.
 */
import type { CalloutTone, ValueTone } from '../../reportDesign/primitives.pure.ts';
import { CHARS_PER_LINE } from '../markdown.pure.ts';
import { renderMarkdown } from '../markdown.pure.ts';

/** How much licence the model has with the words. Figures are locked at all. */
export type ConversionFidelity = 'restructure' | 'connective' | 'rewrite';

export const FIDELITIES: readonly ConversionFidelity[] = ['restructure', 'connective', 'rewrite'];

export const DEFAULT_FIDELITY: ConversionFidelity = 'restructure';

/** Anything else — including `undefined` — is the conservative level. */
export function readFidelity(raw: unknown): ConversionFidelity {
  return FIDELITIES.includes(raw as ConversionFidelity)
    ? raw as ConversionFidelity
    : DEFAULT_FIDELITY;
}

// ── The vocabulary ──────────────────────────────────────────────────────────

export interface KpiBlockCell {
  label: string;
  /** Pre-formatted, exactly as it appeared. The kit does not format. */
  value: string;
  foot?: string;
  tone?: ValueTone;
}

export interface TableBlockColumn {
  label: string;
  align?: 'left' | 'right';
}

export interface TableBlockRow {
  /** One per column, in order. Short rows are padded, long ones truncated. */
  cells: string[];
  /** Renders with the total rule and weight. */
  total?: boolean;
}

export interface BarBlockItem {
  label: string;
  value: number;
  /** What to print beside the bar. The source's own string, when it had one. */
  display?: string;
  tone?: 'positive' | 'caution' | 'negative' | 'accent';
}

export type EnrichedBlock =
  | { kind: 'lede'; text: string }
  | { kind: 'kpi'; cells: KpiBlockCell[] }
  | {
    kind: 'table';
    caption?: string;
    columns: TableBlockColumn[];
    rows: TableBlockRow[];
    /** Column indices whose values carry a sign. Financial tables. */
    signedColumns?: number[];
  }
  | { kind: 'callout'; tone: CalloutTone; label: string; text: string }
  | { kind: 'sidenote'; label: string; text: string }
  | { kind: 'bars'; title?: string; unit?: string; caption?: string; items: BarBlockItem[] }
  | {
    kind: 'donut';
    title?: string;
    centerLabel?: string;
    centerSub?: string;
    caption?: string;
    segments: Array<{ label: string; value: number }>;
  }
  | {
    kind: 'bullet';
    label?: string;
    sub?: string;
    caption?: string;
    value: number;
    target?: number;
    max?: number;
  }
  | {
    kind: 'waterfall';
    caption?: string;
    unit?: string;
    items: Array<{ label: string; value: number; total?: boolean }>;
  }
  | { kind: 'gauge'; value: number; max?: number; label?: string; caption?: string }
  | { kind: 'decision'; label: string; text: string }
  | { kind: 'quote'; text: string; attribution?: string }
  | { kind: 'prose'; markdown: string }
  | {
    /**
     * Two or three blocks set across the measure instead of down it.
     *
     * The one *layout* kind, and the reason the vocabulary was widened. A
     * natively designed report of the same data put three KPI cards across the
     * page and a pair of note boxes side by side; our documents could only ever
     * stack, one thing under another, which is most of why our pages read as
     * half-empty and theirs read as composed.
     *
     * Rows do not nest — a row holds leaf blocks only. Two levels of nesting is
     * a layout engine, and a model that can nest rows inside rows produces
     * documents nobody can budget the pages for.
     */
    kind: 'row';
    blocks: EnrichedLeafBlock[];
  };

/** Every block that may sit inside a `row`: all of them except `row` itself. */
export type EnrichedLeafBlock = Exclude<EnrichedBlock, { kind: 'row' }>;

export type EnrichedBlockKind = EnrichedBlock['kind'];

/** The kinds a `row` may hold. */
export const LEAF_BLOCK_KINDS = [
  'lede', 'kpi', 'table', 'callout', 'sidenote', 'bars', 'donut', 'bullet',
  'waterfall', 'gauge', 'decision', 'quote', 'prose',
] as const satisfies readonly EnrichedLeafBlock['kind'][];

export const BLOCK_KINDS: readonly EnrichedBlockKind[] = [...LEAF_BLOCK_KINDS, 'row'];

/** How many blocks may sit across one row. Four across an A4 measure is soup. */
export const MIN_ROW_BLOCKS = 2;
export const MAX_ROW_BLOCKS = 3;

/**
 * A block that is not `prose` is design work. This is how enrichment is judged.
 *
 * A `row` counts when anything inside it does — a row of three prose blocks is
 * three paragraphs in columns, which is not design, it is a newspaper accident.
 */
export function isDesigned(block: EnrichedBlock): boolean {
  if (block.kind === 'row') return block.blocks.some(isDesigned);
  return block.kind !== 'prose';
}

// ── Limits ──────────────────────────────────────────────────────────────────
//
// Every one of these is a bound on what one chapter of model output can cost to
// render, in the same spirit as the caps in `markdown.pure.ts`. A chapter that
// exceeds one is trimmed and the trim is recorded, never rejected — a chapter
// that renders slightly short beats a chapter that falls back to flat prose.

/** More than this and the model is padding, not designing. */
export const MAX_BLOCKS_PER_CHAPTER = 24;
export const MIN_KPI_CELLS = 2;
export const MAX_KPI_CELLS = 4;
export const MAX_TABLE_COLUMNS = 12;
export const MAX_TABLE_ROWS = 60;
export const MAX_BAR_ITEMS = 12;
export const MIN_BAR_ITEMS = 2;
/** Below three segments a donut is a pie chart of one thing and a gap. */
export const MIN_DONUT_SEGMENTS = 3;
export const MAX_DONUT_SEGMENTS = 8;
/**
 * A waterfall of two steps is a subtraction, which a KPI pair says better.
 * `renderWaterfall` refuses more than `MAX_WATERFALL_ITEMS` of its own accord;
 * this is the floor that makes the shape worth drawing at all.
 */
export const MIN_WATERFALL_STEPS = 3;
export const MAX_WATERFALL_STEPS = 10;
/**
 * Below this a chapter has nothing to design, and asking costs eleven seconds.
 *
 * Not a quality bar — a floor on whether the question is worth putting. A
 * 55-character sub-section is a sentence; the honest answer to "lay this out as
 * designed blocks" is "it is a sentence", which is what the model kept saying:
 * a real conversion spent fourteen of its twenty calls on fragments and filled
 * its notes with `the model returned no blocks`.
 *
 * Set just above the longest fragment that run produced (`Additional
 * Assumptions`, 776 characters, is a real table and sits well above it;
 * `Capacity Derivation` at 126 does not). Folding sub-sections into their
 * parents removes most of these anyway — this catches the genuinely tiny
 * top-level section, like a two-line `Warnings`.
 */
export const MIN_ENRICH_CHARS = 220;

/** A lede is the sentence that opens a chapter. Longer is a paragraph. */
export const MAX_LEDE_CHARS = 240;
export const MAX_LABEL_CHARS = 80;
export const MAX_VALUE_CHARS = 40;
export const MAX_CALLOUT_CHARS = 900;
export const MAX_PROSE_CHARS = 12_000;

const CALLOUT_TONES: readonly CalloutTone[] = [
  'neutral', 'positive', 'caution', 'negative', 'informative',
];
/**
 * What a callout calls itself when the model gives it no label.
 *
 * One word each, taking the tone at its word — a `caution` block is a caution
 * whether or not anybody titled it.
 */
const CALLOUT_DEFAULT_LABEL: Record<CalloutTone, string> = {
  neutral: 'Note',
  positive: 'Worth knowing',
  caution: 'Caution',
  negative: 'Shortfall',
  informative: 'For reference',
};

const VALUE_TONES: readonly ValueTone[] = ['neutral', 'positive', 'negative'];
const BAR_TONES: readonly NonNullable<BarBlockItem['tone']>[] = [
  'positive', 'caution', 'negative', 'accent',
];

// ── The schema the model is held to ─────────────────────────────────────────

/**
 * The tool schema, beside the reader that validates its output.
 *
 * Co-located deliberately, following `brandDesign/system.pure.ts`: the shape
 * asked for and the shape accepted cannot drift when they are forty lines
 * apart, and drift is the failure mode of every "the model returns JSON"
 * integration whose prompt lives in its route.
 *
 * Table rows are `string[]` positional rather than keyed objects. A keyed row
 * requires the model to repeat a key exactly across sixty rows, and one typo
 * turns a cell blank; positions cannot be misspelled, and `renderBlocks`
 * assigns the keys the primitive needs.
 */
/**
 * Everything a block may carry, whatever kind it is.
 *
 * One flat property bag rather than a discriminated union, because the API's
 * tool schema has no `oneOf` on a discriminant that a model reliably honours,
 * and `readBlock` is the real validator either way. The descriptions carry the
 * per-kind meaning; the reader enforces it.
 *
 * Extracted to a const so that `row.blocks` can reuse it verbatim minus `row`.
 * Two hand-maintained copies of this would drift within a week.
 */
const BLOCK_PROPERTIES = {
  text: {
    type: 'string',
    description: 'lede: the opening sentence. callout/sidenote/decision: the body. quote: the sentence.',
  },
  markdown: { type: 'string', description: 'prose: Markdown, passed through unchanged.' },

  cells: {
    type: 'array',
    description: `kpi: ${MIN_KPI_CELLS}\u2013${MAX_KPI_CELLS} headline figures.`,
    items: {
      type: 'object',
      required: ['label', 'value'],
      properties: {
        label: { type: 'string', description: 'What the figure is. Two or three words.' },
        value: { type: 'string', description: 'The figure exactly as the source wrote it, including $ , % and any sign.' },
        foot: { type: 'string', description: 'One short qualifier beneath.' },
        tone: { type: 'string', enum: VALUE_TONES },
      },
    },
  },

  caption: { type: 'string', description: 'table/chart: what it shows. One line.' },
  columns: {
    type: 'array',
    description: 'table: the header row.',
    items: {
      type: 'object',
      required: ['label'],
      properties: {
        label: { type: 'string' },
        align: { type: 'string', enum: ['left', 'right'], description: 'right for figures.' },
      },
    },
  },
  rows: {
    type: 'array',
    description: 'table: body rows, cells positional and aligned to columns.',
    items: {
      type: 'object',
      required: ['cells'],
      properties: {
        cells: { type: 'array', items: { type: 'string' } },
        total: { type: 'boolean', description: 'A summed row. Gets the total rule.' },
      },
    },
  },
  signedColumns: {
    type: 'array',
    description: 'table: zero-based indices of columns whose values may be negative.',
    items: { type: 'integer' },
  },

  tone: { type: 'string', enum: CALLOUT_TONES, description: 'callout: which of the five.' },
  label: {
    type: 'string',
    description: 'callout/sidenote/decision: the heading on it. bullet/gauge: what is being measured.',
  },
  attribution: { type: 'string', description: 'quote: who said it, when the source says.' },

  title: { type: 'string', description: 'bars/donut: the chart title.' },
  unit: { type: 'string', description: 'bars/waterfall: what the values are in.' },
  items: {
    type: 'array',
    description: `bars: ${MIN_BAR_ITEMS}\u2013${MAX_BAR_ITEMS} labelled magnitudes. `
      + `waterfall: ${MIN_WATERFALL_STEPS}\u2013${MAX_WATERFALL_STEPS} steps that add up, `
      + 'signed, with `total: true` on any line that restates the running sum.',
    items: {
      type: 'object',
      required: ['label', 'value'],
      properties: {
        label: { type: 'string' },
        value: { type: 'number', description: 'The figure as a plain number, no symbols. Negative for a deduction.' },
        display: { type: 'string', description: 'bars: how the source printed it, e.g. "$1,240 /mo".' },
        tone: { type: 'string', enum: BAR_TONES },
        total: { type: 'boolean', description: 'waterfall: this step is a running total, not a movement.' },
      },
    },
  },
  segments: {
    type: 'array',
    description: `donut: ${MIN_DONUT_SEGMENTS}\u2013${MAX_DONUT_SEGMENTS} parts of one whole.`,
    items: {
      type: 'object',
      required: ['label', 'value'],
      properties: {
        label: { type: 'string' },
        value: { type: 'number' },
      },
    },
  },
  centerLabel: { type: 'string', description: 'donut: the figure in the hole.' },
  centerSub: { type: 'string', description: 'donut: the word under it.' },

  value: { type: 'number', description: 'bullet/gauge: where the measure stands.' },
  target: { type: 'number', description: 'bullet: the marker to compare against.' },
  max: { type: 'number', description: 'bullet/gauge: the top of the scale. Required for a gauge.' },
  sub: { type: 'string', description: 'bullet: the qualifier under the label.' },
} as const;

export const ENRICHMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['blocks'],
  properties: {
    blocks: {
      type: 'array',
      description: 'The chapter, in order, as designed blocks.',
      items: {
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: BLOCK_KINDS },
          blocks: {
            type: 'array',
            description:
              `row: ${MIN_ROW_BLOCKS}\u2013${MAX_ROW_BLOCKS} blocks set across the page instead `
              + 'of down it. Use for a set of headline figures, or a pair of short notes that '
              + 'answer each other. Rows do not nest.',
            items: {
              type: 'object',
              required: ['kind'],
              properties: {
                kind: { type: 'string', enum: LEAF_BLOCK_KINDS },
                ...BLOCK_PROPERTIES,
              },
            },
          },
          ...BLOCK_PROPERTIES,
        },
      },
    },
  },
} as const;

// ── Reading the answer ──────────────────────────────────────────────────────

export interface EnrichmentResult {
  blocks: EnrichedBlock[];
  /**
   * Everything the reader changed or refused, in words.
   *
   * Stored on the conversion row and shown on the review screen. A guard that
   * silently drops a block teaches nobody anything; the note is how a person
   * finds out the model tried to draw a two-segment donut.
   */
  notes: string[];
}

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Multi-line strings keep their breaks — prose and callout bodies need them. */
const block = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[ \t]+$/gm, '').trim().slice(0, max) : '';

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  allowed.includes(v as T) ? v as T : undefined;

/**
 * Read one block, or refuse it with a reason.
 *
 * Every kind has a *non-degenerate* condition, and it is checked here rather
 * than in the renderer. The charts already return `''` on degenerate input —
 * `renderDonut` on two segments, `renderBars` on none — so without this a
 * refused chart would leave a silent hole where a paragraph used to be, and the
 * line budget would have already been charged for it. Refusing here means the
 * content falls back to prose instead of vanishing.
 */
function readBlock(
  raw: unknown,
  notes: string[],
  at: number,
  /** False inside a `row`, where a nested row would be a layout engine. */
  allowRow = true,
): EnrichedBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = oneOf(r.kind, allowRow ? BLOCK_KINDS : LEAF_BLOCK_KINDS);
  if (!kind) {
    notes.push(`block ${at}: unknown kind "${String(r.kind).slice(0, 40)}"`);
    return null;
  }

  switch (kind) {
    case 'row': {
      const inner = (Array.isArray(r.blocks) ? r.blocks : [])
        .slice(0, MAX_ROW_BLOCKS)
        .map((b, i) => readBlock(b, notes, at, false))
        .filter((b): b is EnrichedLeafBlock => b !== null && b.kind !== 'row');
      if (inner.length < MIN_ROW_BLOCKS) {
        // A row of one is a block with a margin on it, and a row of none is a
        // hole the page budget has already been charged for.
        notes.push(`block ${at}: a row of ${inner.length} — needs ${MIN_ROW_BLOCKS}`);
        return inner[0] ?? null;
      }
      return { kind, blocks: inner };
    }

    case 'waterfall': {
      const items = (Array.isArray(r.items) ? r.items : [])
        .slice(0, MAX_WATERFALL_STEPS)
        .flatMap((i) => {
          const it = (i ?? {}) as Record<string, unknown>;
          const label = str(it.label, MAX_LABEL_CHARS);
          const value = num(it.value);
          if (!label || value === null) return [];
          return [{ label, value, ...(it.total === true ? { total: true } : {}) }];
        });
      if (items.length < MIN_WATERFALL_STEPS) {
        notes.push(`block ${at}: a waterfall of ${items.length} — needs ${MIN_WATERFALL_STEPS}`);
        return null;
      }
      return {
        kind,
        items,
        caption: str(r.caption, MAX_LABEL_CHARS) || undefined,
        unit: str(r.unit, MAX_VALUE_CHARS) || undefined,
      };
    }

    case 'gauge': {
      const value = num(r.value);
      if (value === null) { notes.push(`block ${at}: a gauge with no value`); return null; }
      const max = num(r.max);
      // `renderGauge` floors its max at the value, so a gauge without one draws
      // a full arc and says "100%" of nothing — the same defect `bullet` has.
      if (max === null || max <= 0) {
        notes.push(`block ${at}: a gauge with no maximum to read against`);
        return null;
      }
      return {
        kind, value, max,
        label: str(r.label, MAX_LABEL_CHARS) || undefined,
        caption: str(r.caption, MAX_LABEL_CHARS) || undefined,
      };
    }

    case 'decision': {
      const text = block(r.text, MAX_CALLOUT_CHARS);
      if (!text) { notes.push(`block ${at}: a decision box with no body`); return null; }
      return { kind, label: str(r.label, MAX_LABEL_CHARS) || 'What this means', text };
    }

    case 'quote': {
      const text = str(r.text, MAX_CALLOUT_CHARS);
      if (!text) { notes.push(`block ${at}: an empty quote`); return null; }
      return {
        kind, text,
        attribution: str(r.attribution, MAX_LABEL_CHARS) || undefined,
      };
    }

    case 'lede': {
      const text = str(r.text, MAX_LEDE_CHARS);
      if (!text) { notes.push(`block ${at}: an empty lede`); return null; }
      return { kind, text };
    }

    case 'kpi': {
      const cells = (Array.isArray(r.cells) ? r.cells : [])
        .slice(0, MAX_KPI_CELLS)
        .map((c) => {
          const cell = (c ?? {}) as Record<string, unknown>;
          return {
            label: str(cell.label, MAX_LABEL_CHARS),
            value: str(cell.value, MAX_VALUE_CHARS),
            foot: str(cell.foot, MAX_LABEL_CHARS) || undefined,
            tone: oneOf(cell.tone, VALUE_TONES),
          };
        })
        .filter((c) => c.label && c.value);
      if (cells.length < MIN_KPI_CELLS) {
        notes.push(`block ${at}: a KPI strip of ${cells.length} — needs ${MIN_KPI_CELLS}`);
        return null;
      }
      return { kind, cells };
    }

    case 'table': {
      const columns = (Array.isArray(r.columns) ? r.columns : [])
        .slice(0, MAX_TABLE_COLUMNS)
        .map((c) => {
          const col = (c ?? {}) as Record<string, unknown>;
          return { label: str(col.label, MAX_LABEL_CHARS), align: oneOf(col.align, ['left', 'right'] as const) };
        })
        .filter((c) => c.label);
      if (!columns.length) { notes.push(`block ${at}: a table with no columns`); return null; }

      const rows = (Array.isArray(r.rows) ? r.rows : [])
        .slice(0, MAX_TABLE_ROWS)
        .map((x) => {
          const row = (x ?? {}) as Record<string, unknown>;
          const cells = (Array.isArray(row.cells) ? row.cells : [])
            .slice(0, columns.length)
            .map((c) => str(c, MAX_VALUE_CHARS * 4));
          // Ragged rows are padded rather than dropped. A transcription that
          // omits an empty trailing cell is the single most common shape of
          // ragged table, and it is not a defect worth losing a row over.
          while (cells.length < columns.length) cells.push('');
          return { cells, total: row.total === true };
        })
        .filter((x) => x.cells.some((c) => c));
      if (!rows.length) { notes.push(`block ${at}: a table with no rows`); return null; }

      const signedColumns = (Array.isArray(r.signedColumns) ? r.signedColumns : [])
        .map((i) => num(i))
        .filter((i): i is number => i !== null && Number.isInteger(i) && i >= 0 && i < columns.length);

      return {
        kind,
        caption: str(r.caption, MAX_LABEL_CHARS * 2) || undefined,
        columns,
        rows,
        signedColumns: signedColumns.length ? signedColumns : undefined,
      };
    }

    case 'callout':
    case 'sidenote': {
      const text = block(r.text, MAX_CALLOUT_CHARS);
      // The body is the block. Without it there is nothing to render and the
      // label alone is a heading over a hole.
      if (!text) { notes.push(`block ${at}: a ${kind} with no body`); return null; }

      const tone = oneOf(r.tone, CALLOUT_TONES) ?? 'neutral';
      // A missing label is not a reason to throw the body away.
      //
      // This used to require both, and a real conversion filled its notes with
      // `a callout missing its label or body` — the model returns a warning
      // with its text and no heading often enough that the rule was costing
      // real callouts rather than catching bad ones. The tone already says what
      // kind of thing it is, so it can name itself.
      const label = str(r.label, MAX_LABEL_CHARS)
        || (kind === 'callout' ? CALLOUT_DEFAULT_LABEL[tone] : 'Note');
      return kind === 'callout' ? { kind, tone, label, text } : { kind, label, text };
    }

    case 'bars': {
      const items = (Array.isArray(r.items) ? r.items : [])
        .slice(0, MAX_BAR_ITEMS)
        .flatMap((x): BarBlockItem[] => {
          const item = (x ?? {}) as Record<string, unknown>;
          const label = str(item.label, MAX_LABEL_CHARS);
          const value = num(item.value);
          if (!label || value === null) return [];
          return [{
            label,
            value,
            display: str(item.display, MAX_VALUE_CHARS) || undefined,
            tone: oneOf(item.tone, BAR_TONES),
          }];
        });
      if (items.length < MIN_BAR_ITEMS) {
        notes.push(`block ${at}: a bar chart of ${items.length} — needs ${MIN_BAR_ITEMS}`);
        return null;
      }
      // Every bar zero is a chart of a flat line. `renderBars` divides by a max
      // it floors at 1, so it draws nothing visible and says nothing true.
      if (items.every((i) => i.value === 0)) {
        notes.push(`block ${at}: a bar chart where every value is zero`);
        return null;
      }
      return {
        kind,
        title: str(r.title, MAX_LABEL_CHARS) || undefined,
        unit: str(r.unit, MAX_VALUE_CHARS) || undefined,
        caption: str(r.caption, MAX_LABEL_CHARS * 2) || undefined,
        items,
      };
    }

    case 'donut': {
      const segments = (Array.isArray(r.segments) ? r.segments : [])
        .slice(0, MAX_DONUT_SEGMENTS)
        .flatMap((x): Array<{ label: string; value: number }> => {
          const seg = (x ?? {}) as Record<string, unknown>;
          const label = str(seg.label, MAX_LABEL_CHARS);
          const value = num(seg.value);
          return label && value !== null && value > 0 ? [{ label, value }] : [];
        });
      if (segments.length < MIN_DONUT_SEGMENTS) {
        notes.push(`block ${at}: a donut of ${segments.length} — needs ${MIN_DONUT_SEGMENTS}`);
        return null;
      }
      return {
        kind,
        title: str(r.title, MAX_LABEL_CHARS) || undefined,
        centerLabel: str(r.centerLabel, MAX_VALUE_CHARS) || undefined,
        centerSub: str(r.centerSub, MAX_LABEL_CHARS) || undefined,
        caption: str(r.caption, MAX_LABEL_CHARS * 2) || undefined,
        segments,
      };
    }

    case 'bullet': {
      const value = num(r.value);
      const target = num(r.target);
      const max = num(r.max);
      if (value === null) { notes.push(`block ${at}: a bullet with no value`); return null; }
      // A bullet with neither a target nor a scale is one number on a bar of
      // arbitrary length. `renderBullet` would floor the max at the value
      // itself and draw a full bar, which reads as "100%" of nothing.
      if (target === null && (max === null || max <= 0)) {
        notes.push(`block ${at}: a bullet with neither a target nor a maximum`);
        return null;
      }
      return {
        kind,
        label: str(r.label, MAX_LABEL_CHARS) || undefined,
        sub: str(r.sub, MAX_LABEL_CHARS) || undefined,
        caption: str(r.caption, MAX_LABEL_CHARS * 2) || undefined,
        value,
        target: target ?? undefined,
        max: max !== null && max > 0 ? max : undefined,
      };
    }

    case 'prose': {
      const markdown = block(r.markdown, MAX_PROSE_CHARS);
      if (!markdown) { notes.push(`block ${at}: empty prose`); return null; }
      return { kind, markdown };
    }
  }
}

/**
 * Read a tool call's arguments into blocks.
 *
 * Never throws and never returns a partially-valid block. A caller that gets
 * zero blocks back falls through to plain-Markdown rendering, which is what
 * the converter did for every chapter before this module existed — so the worst
 * outcome of enrichment failing entirely is exactly today's output.
 */
export function parseEnrichment(raw: unknown): EnrichmentResult {
  const notes: string[] = [];
  const list = Array.isArray((raw as { blocks?: unknown })?.blocks)
    ? (raw as { blocks: unknown[] }).blocks
    : [];

  if (!list.length) {
    return { blocks: [], notes: ['the model returned no blocks'] };
  }

  const blocks: EnrichedBlock[] = [];
  const over = list.length - MAX_BLOCKS_PER_CHAPTER;
  list.slice(0, MAX_BLOCKS_PER_CHAPTER).forEach((raw, i) => {
    const parsed = readBlock(raw, notes, i);
    if (parsed) blocks.push(parsed);
  });
  if (over > 0) notes.push(`${over} block${over === 1 ? '' : 's'} past the ${MAX_BLOCKS_PER_CHAPTER}-block cap were dropped`);

  // A chapter of one lede is a chapter with its content deleted. The lede is
  // furniture; on its own it is not an enrichment of anything.
  if (blocks.length === 1 && blocks[0].kind === 'lede') {
    notes.push('the model returned a lede and nothing else');
    return { blocks: [], notes };
  }

  return { blocks, notes };
}

// ── What a chapter of blocks costs to print ─────────────────────────────────
//
// Mirroring `markdown.pure.ts` so the two accountings cannot disagree: a
// paragraph is `ceil(chars / 65)` lines plus half a line of leading, a heading
// is 2, a table is its rows plus 3. The chart figures are measured rather than
// derived — 12 lines is a `chartFigure` at the sizes `charts.pure.ts` enforces,
// checked against a render.

const textLines = (s: string) => Math.ceil(Math.max(1, s.length) / CHARS_PER_LINE);

/** Printed lines one block costs. Used to budget pages before rendering. */
export function blockLines(b: EnrichedBlock): number {
  switch (b.kind) {
    case 'lede': return textLines(b.text) + 1;
    case 'kpi': return 4;
    case 'table': return b.rows.length + 3 + (b.caption ? 1 : 0);
    case 'callout':
    case 'sidenote': return textLines(b.text) + 2;
    case 'bars': return 12;
    case 'donut': return 14;
    case 'bullet': return 6;
    case 'waterfall': return 14;
    case 'gauge': return 12;
    case 'decision': return textLines(b.text) + 3;
    case 'quote': return textLines(b.text) + 2;
    // The tallest column decides the row's height; that is what a row *is*.
    // Summing them would charge three KPI cards as twelve lines when they print
    // as four, which is how a spine claims a page count the document has not.
    case 'row': return Math.max(...b.blocks.map(blockLines), 1);
    case 'prose': return renderMarkdown(b.markdown, { idPrefix: 'cost' }).lines;
  }
}

export function enrichedLines(blocks: readonly EnrichedBlock[]): number {
  return blocks.reduce((n, b) => n + blockLines(b), 0);
}

/**
 * Every string a set of blocks will print, joined.
 *
 * The faithfulness check needs the text of the output and has no business
 * knowing the block union; walking it here means a tenth block kind is caught
 * by the compiler in one place rather than silently escaping the check by being
 * forgotten in a second. Chart values are stringified because a figure the
 * model put in `items[].value` is exactly as invented as one it put in a
 * sentence.
 */
export function enrichedText(blocks: readonly EnrichedBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case 'lede': parts.push(b.text); break;
      case 'kpi':
        for (const c of b.cells) parts.push(c.label, c.value, c.foot ?? '');
        break;
      case 'table':
        if (b.caption) parts.push(b.caption);
        for (const c of b.columns) parts.push(c.label);
        for (const r of b.rows) parts.push(...r.cells);
        break;
      case 'callout':
      case 'sidenote': parts.push(b.label, b.text); break;
      case 'bars':
        parts.push(b.title ?? '', b.unit ?? '', b.caption ?? '');
        for (const i of b.items) parts.push(i.label, i.display ?? '', String(i.value));
        break;
      case 'donut':
        parts.push(b.title ?? '', b.centerLabel ?? '', b.centerSub ?? '', b.caption ?? '');
        for (const s of b.segments) parts.push(s.label, String(s.value));
        break;
      case 'bullet':
        parts.push(b.label ?? '', b.sub ?? '', b.caption ?? '', String(b.value));
        if (b.target !== undefined) parts.push(String(b.target));
        // `max` is deliberately absent, and it is the one exclusion in here.
        //
        // It is the chart's *axis*, not a claim about anybody's finances. The
        // commonest bullet by far is "the proposed loan is 76% of capacity" —
        // `value: 76, max: 100` — and 100 is not in the chapter, because no
        // chapter says "100". The faithfulness check saw an invented figure,
        // rejected the chapter, retried, rejected it again, and fell the whole
        // thing back to flat prose. On a real conversion that destroyed
        // "Capacity at a glance": the single most important chapter of the
        // report, deleted by its own guard, for the scale of a bar.
        //
        // The exposure this creates is bounded and visible: a wrong `max`
        // mis-scales one bar. A wrong `value` or `target` misstates a figure,
        // and those two stay checked.
        break;
      case 'waterfall':
        parts.push(b.caption ?? '', b.unit ?? '');
        for (const i of b.items) parts.push(i.label, String(i.value));
        break;
      case 'gauge':
        parts.push(b.label ?? '', b.caption ?? '', String(b.value));
        // `max` is the axis, not a claim — the same exclusion as `bullet`, and
        // for the same reason: it destroyed a chapter once already.
        break;
      case 'decision':
      case 'quote': parts.push(('label' in b ? b.label : ''), b.text); break;
      case 'row':
        // A figure inside a row is exactly as invented as one outside it.
        parts.push(enrichedText(b.blocks));
        break;
      case 'prose': parts.push(b.markdown); break;
    }
  }
  return parts.filter(Boolean).join('\n');
}

// ── The content quota ───────────────────────────────────────────────────────

export interface QuotaVerdict {
  ok: boolean;
  /** What was missed, phrased so it can be handed straight back to the model. */
  reason: string;
  designed: number;
}

/** A pipe table in the source. */
const SOURCE_TABLE = /^\s*\|.*\|\s*$/m;
/** A figure worth promoting: currency, a percentage, or a grouped thousand. */
const SOURCE_FIGURE = /\$\s?\d|(?:\d[\d,]*\.?\d*)\s?%|\b\d{1,3}(?:,\d{3})+\b/;

/**
 * Did this chapter actually get designed?
 *
 * Borrowed wholesale from `designBrief.pure.ts › validateBriefSynthesis`, which
 * already does exactly this for the design agent: ask for a quantity of real
 * content, count it, and retry once naming what was missed. The failure it
 * catches is the one that costs the most and looks the least like a failure —
 * a model that answers the letter of the request by wrapping the whole chapter
 * in a single `prose` block. That is valid, parses cleanly, and produces
 * precisely the flat output this feature exists to replace.
 *
 * The escape hatch matters as much as the rule: a chapter whose source is three
 * paragraphs with no table and no figure in it has *nothing* to promote, and
 * demanding a chart from it is how invented data gets into a client document.
 * Such a chapter passes with all-prose output, and says so.
 */
export function checkQuota(sourceMarkdown: string, blocks: readonly EnrichedBlock[]): QuotaVerdict {
  const designed = blocks.filter(isDesigned).length;
  if (designed > 0) return { ok: true, reason: '', designed };

  const source = String(sourceMarkdown ?? '');
  const hasTable = SOURCE_TABLE.test(source);
  const hasFigure = SOURCE_FIGURE.test(source);
  if (!hasTable && !hasFigure) {
    return { ok: true, reason: 'the source is prose with no table or figure to promote', designed };
  }

  const missed = [hasTable ? 'a table' : '', hasFigure ? 'figures' : '']
    .filter(Boolean).join(' and ');
  return {
    ok: false,
    reason: `the source contains ${missed} and every block came back as prose`,
    designed,
  };
}

// ── A lede that is just the title again ─────────────────────────────────────

/** Case, punctuation and spacing removed, so only the words are compared. */
const bareWords = (v: string): string =>
  String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Drop an opening `lede` that only restates the chapter's title.
 *
 * A real render printed *How the capacity is built* as a chapter header and
 * then, immediately under it, a lede reading "How the capacity is built". The
 * model is not wrong to do it — a chapter whose source begins with its own
 * heading gives it nothing else to open with — but the page says the same thing
 * twice in two sizes, which is the tell of a document nobody laid out.
 *
 * Only the *first* block, and only on an exact word match. A lede that expands
 * on the title is the thing the lede is for and stays.
 */
export function dropRedundantLede(
  blocks: readonly EnrichedBlock[],
  chapterTitle: string,
): EnrichedBlock[] {
  const first = blocks[0];
  if (!first || first.kind !== 'lede' || blocks.length < 2) return [...blocks];
  const title = bareWords(chapterTitle);
  return title && bareWords(first.text) === title ? blocks.slice(1) : [...blocks];
}

// ── What is worth asking about ──────────────────────────────────────────────

/** The shape the partition needs. `enrich.ts`'s `ChapterToEnrich` satisfies it. */
export interface EnrichableChapter {
  title: string;
  markdown: string;
}

export interface EnrichmentPartition<T> {
  /** Long enough to design. These are the calls that get made. */
  work: T[];
  /** Has content, but not enough of it. Reported, never silently dropped. */
  skipped: T[];
}

/**
 * Split chapters into the ones worth a model call and the ones that are not.
 *
 * Pure and here rather than inline in `enrich.ts` for one reason: `enrich.ts`
 * reads `Deno.env` at module scope, so a spec cannot import it, and a floor
 * that decides how much a conversion costs should not be a rule nobody can
 * run. Empty chapters are dropped outright — an unfilled chapter has no source
 * to design and is not a skip anybody needs telling about.
 */
export function partitionForEnrichment<T extends EnrichableChapter>(
  chapters: readonly T[],
): EnrichmentPartition<T> {
  const work: T[] = [];
  const skipped: T[] = [];
  for (const chapter of chapters) {
    const length = chapter.markdown.trim().length;
    if (length === 0) continue;
    (length >= MIN_ENRICH_CHARS ? work : skipped).push(chapter);
  }
  return { work, skipped };
}

/** Why a chapter was not attempted, in the same voice as the guards' notes. */
export function tooShortNote(chapter: EnrichableChapter): string {
  return `${chapter.title}: too short to design (${chapter.markdown.trim().length} characters)`;
}

// ── Prompts ─────────────────────────────────────────────────────────────────

/** The fidelity rule as a sentence, for a prompt that is not `enrichmentPrompt`. */
export function FIDELITY_RULE_FOR(fidelity: ConversionFidelity): string {
  return FIDELITY_RULES[fidelity];
}

const FIDELITY_RULES: Record<ConversionFidelity, string> = {
  restructure:
    'Use only words that are already in the chapter. You may drop words, split a '
    + 'sentence across a label and a value, or lift a phrase into a caption or a '
    + 'callout label. You may not write a new sentence. If a block needs a label '
    + 'and the chapter has none, take the nearest heading or phrase.',
  connective:
    'Use the chapter\'s own words for everything that carries meaning. You may '
    + 'additionally write one opening `lede` sentence and short connecting '
    + 'sub-headings, so the chapter reads as one argument rather than a list of '
    + 'parts. Do not rewrite the chapter\'s existing sentences.',
  rewrite:
    'You may rewrite the prose in a plain, direct advisory voice — short '
    + 'sentences, no marketing language, no adjectives doing work a figure should '
    + 'do. Keep every claim the chapter makes; do not add one it does not.',
};

/** The one rule that does not vary, stated separately because it never bends. */
export const FIGURE_RULE =
  'Every number, percentage, currency amount and date in your output must appear '
  + 'in the chapter above, character for character where it is a formatted value '
  + '($856,932 stays $856,932). Do not compute a new figure, do not round one, do '
  + 'not total a column the chapter did not total. This is checked '
  + 'automatically and a chapter that invents a figure is thrown away.';

/**
 * What the model is asked, for one chapter.
 *
 * Long, and each paragraph is load-bearing. The short version of this prompt —
 * "turn this into blocks" — produced a `prose` block containing the entire
 * chapter, every time, which is the exact output this feature replaces.
 */
export function enrichmentPrompt(
  chapterTitle: string,
  markdown: string,
  fidelity: ConversionFidelity,
): string {
  return `You are laying out one chapter of a property finance report.

The chapter is called "${chapterTitle.slice(0, 120)}". Here is what it says, as
transcribed from the client's existing document:

---
${markdown.slice(0, MAX_PROSE_CHARS)}
---

Return the same chapter as an ordered list of typed blocks. Deciding which block
each passage wants is the whole task — a chapter returned as one \`prose\` block
is a failed answer, because that is what the system already does without you.

The blocks, and when each is right:

- \`kpi\` — two to four headline figures the chapter leads with. This is the
  single most valuable one. A row of "Assessment rate 9.44%, Maximum loan
  $856,932, Surplus $1,240/mo" is a KPI strip, not a table.
- \`table\` — genuinely tabular data: a list of rows that share columns. Keep the
  source's own column order. Mark a summed row \`total\`. Set \`align: "right"\`
  on columns of figures and list them in \`signedColumns\` when a value can be
  negative.
- \`bullet\` — one measure against a target or a ceiling. "Proposed loan is 76%
  of capacity" is a bullet: value 76, max 100. Text like this arrives as a bare
  sentence and is the most commonly missed block.
- \`bars\` — two or more labelled magnitudes worth comparing side by side:
  income by source, liabilities by type.
- \`donut\` — three or more parts of one whole, where the parts sum to something
  the chapter names.
- \`callout\` — a warning, a condition, a caveat, an "assuming that…". Choose the
  tone honestly: \`caution\` for a risk, \`negative\` for a shortfall,
  \`positive\` for a headroom, \`informative\` for a note, \`neutral\` otherwise.
- \`sidenote\` — a definition or an aside that supports the argument without
  interrupting it.
- \`waterfall\` — a figure built up or worn down step by step, where the steps
  add to a stated total: gross income, less shading, less expenses, less
  commitments, giving the surplus. Deductions are negative; put \`total: true\`
  on any line that restates the running sum. This is the shape a "how the
  capacity is built" chapter almost always wants and prose almost always hides.
- \`gauge\` — one figure against a ceiling where the *proportion* is the point
  and there is no second measure to compare it with. Needs \`max\`. Prefer
  \`bullet\` when the chapter names a target as well.
- \`decision\` — "what this means" or "what would move this". One per chapter at
  most, and only when the chapter genuinely draws a conclusion.
- \`quote\` — a sentence from the source worth setting apart because everything
  else turns on it.
- \`lede\` — one sentence opening the chapter. At most one, and only first. It
  must say something the chapter's own title does not.
- \`prose\` — everything that is genuinely paragraphs. Use it freely for real
  prose; just do not use it for something above.

And one that is not content but layout:

- \`row\` — two or three of the blocks above, set **across** the page instead of
  down it, in its \`blocks\` array. Three \`kpi\` blocks of one cell each become
  three cards in a line; a \`callout\` beside a \`sidenote\` becomes a pair of
  notes that answer each other. Use it wherever things belong together and each
  is short — a page of blocks stacked one under another is the difference
  between a document that looks composed and one that looks generated. Rows do
  not nest.

Rules:

- ${FIGURE_RULE}
- ${FIDELITY_RULES[fidelity]}
- Keep the chapter's order. A reader should be able to follow your blocks against
  the original top to bottom.
- Do not invent a chart the data does not support. A donut needs three real
  parts; a bar chart needs two real magnitudes; a waterfall needs steps that
  genuinely add up. If it is not there, use prose.
- Fill the page. A chapter that comes back as four short blocks stacked down the
  left prints as a mostly empty sheet. Where two or three things are short and
  related, put them in a \`row\`.
- Do not emit HTML, colours, sizes or CSS. The design system decides how each
  block looks.`;
}

/**
 * The one retry, naming what was missed.
 *
 * One, not several: a model that returns all-prose twice is telling us the
 * chapter is prose, and a third attempt costs a person eleven more seconds to
 * arrive at the same place. `designBrief.pure.ts` settled on the same number
 * for the same reason.
 */
export function enrichmentRetryPrompt(
  chapterTitle: string,
  markdown: string,
  fidelity: ConversionFidelity,
  problem: string,
): string {
  return `${enrichmentPrompt(chapterTitle, markdown, fidelity)}

A previous attempt at this chapter was rejected because ${problem}.

Look again at the chapter above and find what it actually contains. Read the
figures out of the sentences, not only out of the tables. Then return blocks
that use them.`;
}
