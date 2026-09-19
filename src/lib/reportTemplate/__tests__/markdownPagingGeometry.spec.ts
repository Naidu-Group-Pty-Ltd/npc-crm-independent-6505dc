/**
 * The geometry packer's three page-filling rules, in the units they act on.
 *
 * Measured on the sparse reference report through the real journey
 * (14 Sep 2026), before these: a risk table pushed whole left 67% of a page
 * white above it, a checklist 57%, a source table 73%, and the last page of
 * the narrative carried three lines. A figure that did not fit did the same
 * on the long report. None of that is a charge-model error — every block was
 * charged what it drew — it is what a packer that only ever pushes does.
 */
import { describe, expect, it } from 'vitest';
import {
  BOUNDARY_SPLIT_MIN_ROWS, BOUNDARY_SPLIT_TALL_LINES, MAX_FLOATED, TAIL_ABSORB_LINES, packMarkdownPages, packNarrativeGeometry, tailMinLines,
} from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import type { MarkdownBlock, MarkdownTableMeta } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import type { NarrativeGeometry } from '../../../../supabase/functions/_shared/reports/narrativeGeometry.pure';

const para = (lines: number, id = 'p'): MarkdownBlock => ({ kind: 'paragraph', html: `<p>${id}</p>`, lines });
const heading = (id = 'h'): MarkdownBlock => ({ kind: 'heading', html: `<h2>${id}</h2>`, lines: 1.6 });
const figure = (lines: number, id = 'f'): MarkdownBlock => ({ kind: 'figure', html: `<figure>${id}</figure>`, lines });
const table = (rows: number, rowLines = 1.4, headLines = 2): MarkdownBlock => {
  const meta: MarkdownTableMeta = {
    cols: [{ key: 'c0', label: 'A', align: 'left' }, { key: 'c1', label: 'B', align: 'left' }],
    rows: Array.from({ length: rows }, (_, i) => ({ c0: `r${i}`, c1: `v${i}` })),
    signedKeys: [],
    rowLines: Array.from({ length: rows }, () => rowLines),
    headLines,
  };
  return { kind: 'table', html: '<table>…</table>', lines: headLines + rows * rowLines, table: meta };
};

const ids = (page: readonly MarkdownBlock[]) => page.map((b) => /<\w+>([^<]*)</.exec(b.html)?.[1] ?? b.kind);
const lines = (page: readonly MarkdownBlock[]) => page.reduce((n, b) => n + b.lines, 0);

const GEOMETRY: NarrativeGeometry = {
  bodyPt: 9.5, lineHeight: 1.55, widthPt: 459, charsPerLine: 96, firstPageLines: 34, contLines: 40,
};

describe('a figure that does not fit floats past the prose that follows it', () => {
  it('opens the next page with the figure, and the prose fills the page it left', () => {
    const pages = packMarkdownPages([para(30, 'a'), figure(16, 'chart'), para(8, 'b'), para(20, 'c')], 40, { floatFigures: true });
    expect(ids(pages[0])).toEqual(['a', 'b']);
    expect(ids(pages[1])).toEqual(['chart', 'c']);
  });

  it('never drifts into the next section — a heading closes the page and the figure leads', () => {
    const pages = packMarkdownPages([para(30, 'a'), figure(16, 'chart'), para(6, 'b'), heading('next'), para(10, 'c')], 40, { floatFigures: true });
    expect(ids(pages[0])).toEqual(['a', 'b']);
    expect(ids(pages[1])).toEqual(['chart', 'next', 'c']);
  });

  it('a figure at the very end still lands, on a page of its own', () => {
    const pages = packMarkdownPages([para(30, 'a'), figure(16, 'chart')], 40, { floatFigures: true });
    expect(ids(pages[0])).toEqual(['a']);
    expect(ids(pages[1])).toEqual(['chart']);
  });

  it('carries at most MAX_FLOATED figures, and never one taller than a page', () => {
    const tall = figure(50, 'tall');
    const pages = packMarkdownPages([para(30, 'a'), tall, para(5, 'b')], 40, { floatFigures: true });
    // Too tall to float: it breaks the page the old way and takes its own.
    expect(ids(pages[0])).toEqual(['a']);
    expect(ids(pages[1])).toEqual(['tall']);
    expect(MAX_FLOATED).toBe(2);
  });

  it('is off unless asked for — the legacy packer pushes, byte for byte', () => {
    const pages = packMarkdownPages([para(30, 'a'), figure(16, 'chart'), para(8, 'b')], 40);
    expect(ids(pages[0])).toEqual(['a']);
    expect(ids(pages[1])).toEqual(['chart', 'b']);
  });
});

describe('a table meets a page boundary', () => {
  it('splits at the boundary when the room left holds its head and some rows, repeating the head', () => {
    const t = table(10);
    const pages = packMarkdownPages([para(28, 'a'), t], 40, { splitAtBoundary: true });
    expect(pages).toHaveLength(2);
    expect(pages[0][1].kind).toBe('table');
    expect(pages[0][1].table!.rows.length).toBeGreaterThanOrEqual(2);
    expect(pages[1][0].kind).toBe('table');
    const carried = pages[0][1].table!.rows.length + pages[1][0].table!.rows.length;
    expect(carried).toBe(10);
    // The first chunk fits the room it was cut for.
    expect(lines(pages[0])).toBeLessThanOrEqual(40);
  });

  it('a short table is pushed whole rather than orphaned', () => {
    const t = table(BOUNDARY_SPLIT_MIN_ROWS - 1);
    // Room for a cut (8 lines; the table needs 9), but too few rows to survive one.
    const pages = packMarkdownPages([para(32, 'a'), t], 40, { splitAtBoundary: true });
    expect(ids(pages[0])).toEqual(['a']);
    expect(pages[1][0].table!.rows.length).toBe(BOUNDARY_SPLIT_MIN_ROWS - 1);
  });

  it('too little room is not worth a cut', () => {
    const t = table(10);
    const pages = packMarkdownPages([para(35, 'a'), t], 40, { splitAtBoundary: true });
    expect(ids(pages[0])).toEqual(['a']);
    expect(pages[1][0].table!.rows.length).toBe(10);
  });

  it('a TALL two-row table meets the boundary too — each row is a paragraph and stands under its own head', () => {
    // The sparse reference report's risk register: two rows of 10.5 lines
    // under a two-line head, after twenty lines of prose on a forty-line page.
    // Pushed whole it left half a page white and stood alone on the next.
    const t = table(2, 10.5, 2);
    expect(t.lines).toBeGreaterThanOrEqual(BOUNDARY_SPLIT_TALL_LINES);
    const pages = packMarkdownPages([para(20, 'a'), t], 40, { splitAtBoundary: true });
    expect(pages[0].map((b) => b.kind)).toEqual(['paragraph', 'table']);
    expect(pages[0][1].table!.rows.length).toBe(1);
    expect(pages[1][0].table!.rows.length).toBe(1);
    // The head repeats; the caption does not.
    expect(pages[0][1].table!.headLines).toBe(2);
    expect(pages[1][0].table!.headLines).toBe(2);
  });

  it('a tall two-row table whose first row does not fit the room is still pushed whole', () => {
    const t = table(2, 10.5, 2);
    // Ten lines of room: the head and the first row need 12.5 — a cut would only put two heads on the next page.
    const pages = packMarkdownPages([para(30, 'a'), t], 40, { splitAtBoundary: true });
    expect(ids(pages[0])).toEqual(['a']);
    expect(pages[1][0].table!.rows.length).toBe(2);
  });

  it('a TALL list of few items meets the boundary too', () => {
    // Five paragraph-long bullets (five lines each) after twenty lines of prose
    // on a forty-line page: four fit the room, the fifth continues.
    const items = Array.from({ length: 5 }, (_, i) => ({ depth: 0, text: `Item ${i} ${'x'.repeat(400)}` }));
    const charge = (its: readonly { depth: number; text: string }[]) => its.length * 5;
    const block: MarkdownBlock = { kind: 'list', html: '<ul>…</ul>', lines: 25, list: { items, ordered: false, start: 1 } };
    const pages = packMarkdownPages([para(20, 'a'), block], 40, { splitLists: charge, splitAtBoundary: true });
    expect(pages[0].map((b) => b.kind)).toEqual(['paragraph', 'list']);
    expect(pages[0][1].list!.items).toHaveLength(4);
    expect(pages[1][0].list!.items).toHaveLength(1);
  });

  it('a short two-row table is never split', () => {
    const t = table(2, 1.4, 2);
    const pages = packMarkdownPages([para(38, 'a'), t], 40, { splitAtBoundary: true });
    expect(ids(pages[0])).toEqual(['a']);
    expect(pages[1][0].table!.rows.length).toBe(2);
  });
});

describe('a tail of a few lines is folded onto the page before it', () => {
  it('absorbs a last bucket at or under the allowance', () => {
    const pages = packMarkdownPages([para(38, 'a'), para(2, 'tail')], 40, { absorbTail: true });
    expect(pages).toHaveLength(1);
    expect(ids(pages[0])).toEqual(['a', 'tail']);
    expect(TAIL_ABSORB_LINES).toBe(3);
  });

  it('leaves a real last page alone', () => {
    const pages = packMarkdownPages([para(38, 'a'), para(10, 'b')], 40, { absorbTail: true });
    expect(pages).toHaveLength(2);
  });

  it('never absorbs into nothing — a one-page document is untouched', () => {
    const pages = packMarkdownPages([para(2, 'only')], 40, { absorbTail: true });
    expect(pages).toHaveLength(1);
  });
});

describe('a paragraph that does not fit is cut at a sentence', () => {
  const charge = (chars: number) => Math.max(1, Math.ceil(chars / 50)) + 0.4;
  const sentences = Array.from({ length: 8 }, (_, i) => `Sentence number ${i + 1} runs on for a while to fill the measure.`);
  const prose = (): MarkdownBlock => ({ kind: 'paragraph', html: `<p>${sentences.join(' ')}</p>`, lines: charge(sentences.join(' ').length) });

  it('fills the room with the head and opens the next page with the tail, nothing lost', () => {
    const pages = packMarkdownPages([para(33, 'a'), prose()], 40, { splitParagraphs: charge });
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(2);
    expect(lines(pages[0])).toBeLessThanOrEqual(40);
    const head = pages[0][1].html;
    const tail = pages[1][0].html;
    expect(head.startsWith('<p>Sentence number 1')).toBe(true);
    expect(tail.endsWith('measure.</p>')).toBe(true);
    // Re-joined, the two parts are the paragraph.
    const joined = `${head.slice(3, -4)} ${tail.slice(3, -4)}`;
    expect(joined).toBe(sentences.join(' '));
  });

  it('never cuts inside an inline tag or leaves a widow', () => {
    const html = `<p><strong>${sentences[0]} ${sentences[1]}</strong> ${sentences[2]} ${sentences[3]}</p>`;
    const block: MarkdownBlock = { kind: 'paragraph', html, lines: charge(html.replace(/<[^>]+>/g, '').length) };
    const pages = packMarkdownPages([para(37, 'a'), block], 40, { splitParagraphs: charge });
    // Three lines of room: the only honest cut leaves fewer than two lines on one side, so it is pushed whole.
    expect(pages[0]).toHaveLength(1);
    expect(pages[1][0].html).toBe(html);
  });

  it('is off unless asked for', () => {
    const pages = packMarkdownPages([para(33, 'a'), prose()], 40);
    expect(pages[0]).toHaveLength(1);
  });
});

describe('a list taller than the room it has is split by top-level item', () => {
  const charge = (items: readonly { depth: number; text: string }[]) => items.length * 2 + 0.4;
  const list = (n: number): MarkdownBlock => {
    const items = Array.from({ length: n }, (_, i) => ({ depth: 0, text: `Point ${i + 1} of the list` }));
    return { kind: 'list', html: `<ul>${items.map((it) => `<li>${it.text}</li>`).join('')}</ul>`, lines: charge(items), list: { items, ordered: false, start: 1 } };
  };

  it('a list taller than a page is cut into page-sized chunks, nothing lost', () => {
    const pages = packMarkdownPages([list(30)], 40, { splitLists: charge });
    expect(pages.length).toBeGreaterThan(1);
    const carried = pages.flat().flatMap((b) => b.list!.items);
    expect(carried.map((it) => it.text)).toEqual(list(30).list!.items.map((it) => it.text));
    for (const page of pages) expect(lines(page)).toBeLessThanOrEqual(40);
  });

  it('a nested item travels with its parent', () => {
    const items = [
      { depth: 0, text: 'Parent one' }, { depth: 1, text: 'child' }, { depth: 1, text: 'child' },
      { depth: 0, text: 'Parent two' }, { depth: 1, text: 'child' },
      { depth: 0, text: 'Parent three' }, { depth: 1, text: 'child' }, { depth: 1, text: 'child' },
      { depth: 0, text: 'Parent four' },
    ];
    const block: MarkdownBlock = { kind: 'list', html: '<ul>…</ul>', lines: charge(items), list: { items, ordered: false, start: 1 } };
    const pages = packMarkdownPages([para(30, 'a'), block], 40, { splitLists: charge, splitAtBoundary: true });
    for (const page of pages) {
      const first = page.find((b) => b.kind === 'list')?.list?.items[0];
      if (first) expect(first.depth).toBe(0);
    }
    expect(pages.flat().flatMap((b) => b.list?.items ?? []).length).toBe(items.length);
  });

  it('an ordered list keeps counting across the cut', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ depth: 0, text: `Step ${i + 1}` }));
    const block: MarkdownBlock = { kind: 'list', html: '<ol>…</ol>', lines: charge(items), list: { items, ordered: true, start: 1 } };
    const pages = packMarkdownPages([para(30, 'a'), block], 40, { splitLists: charge, splitAtBoundary: true });
    const chunks = pages.flat().filter((b) => b.kind === 'list');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].list!.start).toBe(1 + chunks[0].list!.items.length);
    expect(chunks[1].html).toContain(`start="${chunks[1].list!.start}"`);
  });

  it('is off unless asked for', () => {
    const pages = packMarkdownPages([list(30)], 40);
    expect(pages).toHaveLength(1);
  });
});

describe('the last page is never a stub', () => {
  const listCharge = (items: readonly { depth: number; text: string }[]) => items.length * 3;
  const list = (n: number, id = 'list'): MarkdownBlock => {
    const items = Array.from({ length: n }, (_, i) => ({ depth: 0, text: `${id} ${i + 1}` }));
    return { kind: 'list', html: `<ul>${id}</ul>`, lines: listCharge(items), list: { items, ordered: false, start: 1 } };
  };
  const byText = (its: readonly { depth: number; text: string }[]) => its.reduce((n, it) => n + it.text.length, 0);
  const uneven = (lines: number[], id = 'uneven'): MarkdownBlock => {
    const items = lines.map((n) => ({ depth: 0, text: 'x'.repeat(n) }));
    return { kind: 'list', html: `<ul>${id}</ul>`, lines: byText(items), list: { items, ordered: false, start: 1 } };
  };

  it('a boundary cut that would leave a stub is made shorter, so the last page holds an ending', () => {
    // Long report, Midnight (RS-4): a seven-item list met the boundary with
    // sixteen lines of room; the cut left two bullets alone on a page 84% white.
    const stub = packMarkdownPages([para(24, 'a'), list(7)], 40, { splitAtBoundary: true, splitLists: listCharge });
    expect(stub).toHaveLength(2);
    expect(lines(stub[1])).toBeLessThan(tailMinLines(40));
    const ending = packMarkdownPages([para(24, 'a'), list(7)], 40, { splitAtBoundary: true, splitLists: listCharge, balanceTail: true });
    expect(ending).toHaveLength(2);
    expect(ending[0][1].list!.items).toHaveLength(4);
    expect(ending[1][0].list!.items).toHaveLength(3);
    expect(lines(ending[1])).toBeGreaterThanOrEqual(tailMinLines(40));
  });

  it('judges the stub on the cut that is made, not on the room — a cut lands on whole items', () => {
    // Twenty lines of room for a 23-line list: three lines short on paper,
    // but the cut lands on whole items and leaves five behind.
    const cut = packMarkdownPages([para(20, 'a'), uneven([6, 6, 6, 5])], 40, { splitAtBoundary: true, splitLists: byText });
    expect(lines(cut[1])).toBe(5);
    const ending = packMarkdownPages([para(20, 'a'), uneven([6, 6, 6, 5])], 40, { splitAtBoundary: true, splitLists: byText, balanceTail: true });
    expect(ending[0][1].list!.items).toHaveLength(2);
    expect(lines(ending[1])).toBe(11);
  });

  it('a head of one item is not a head — the list opens the last page whole', () => {
    const pages = packMarkdownPages([para(24, 'a'), uneven([7, 7, 7], 'tall')], 40, { splitAtBoundary: true, splitLists: byText, balanceTail: true });
    expect(ids(pages[0])).toEqual(['a']);
    expect(ids(pages[1])).toEqual(['tall']);
  });

  it('a paragraph is cut shorter for the same reason, or pushed whole when no honest cut is left', () => {
    const charge = (chars: number) => Math.max(1, Math.ceil(chars / 50)) + 0.4;
    const sentences = (n: number) => Array.from({ length: n }, (_, i) => `Sentence number ${i + 1} runs on for a while to fill the measure.`);
    const prose = (n: number): MarkdownBlock => ({ kind: 'paragraph', html: `<p>${sentences(n).join(' ')}</p>`, lines: charge(sentences(n).join(' ').length) });
    // Fifteen lines of room: the cut leaves six and a half behind.
    const stub = packMarkdownPages([para(25, 'a'), prose(16)], 40, { splitParagraphs: charge });
    expect(lines(stub[1])).toBeLessThan(tailMinLines(40));
    const ending = packMarkdownPages([para(25, 'a'), prose(16)], 40, { splitParagraphs: charge, balanceTail: true });
    expect(ending[0]).toHaveLength(2);
    expect(lines(ending[1])).toBeGreaterThanOrEqual(tailMinLines(40));
    const joined = `${ending[0][1].html.slice(3, -4)} ${ending[1][0].html.slice(3, -4)}`;
    expect(joined).toBe(sentences(16).join(' '));
    // Six lines of room for ten: shorter than an honest cut, so it goes whole.
    const cut = packMarkdownPages([para(34, 'a'), prose(8)], 40, { splitParagraphs: charge });
    expect(cut[0]).toHaveLength(2);
    const whole = packMarkdownPages([para(34, 'a'), prose(8)], 40, { splitParagraphs: charge, balanceTail: true });
    expect(whole[0]).toHaveLength(1);
    expect(whole[1][0].html).toBe(prose(8).html);
  });

  it('the page before gives up only what the ending needs', () => {
    // Twenty-eight lines of room for an eleven-item list: the cut is one item
    // shorter, and the page before stays four-fifths full.
    const pages = packMarkdownPages([para(12, 'a'), list(11)], 40, { splitAtBoundary: true, splitLists: listCharge, balanceTail: true });
    expect(pages).toHaveLength(2);
    expect(pages[0][1].list!.items).toHaveLength(8);
    expect(pages[1][0].list!.items).toHaveLength(3);
    expect(lines(pages[1])).toBe(9);
  });

  it('a short last page draws whole blocks down, and a heading comes with what it introduced', () => {
    const blocks = () => [para(30, 'a'), heading('h'), para(8, 'b'), para(5, 'tail')];
    const stub = packMarkdownPages(blocks(), 40, { keepWithNext: true });
    expect(ids(stub[1])).toEqual(['tail']);
    const pages = packMarkdownPages(blocks(), 40, { keepWithNext: true, balanceTail: true });
    expect(ids(pages[0])).toEqual(['a']);
    expect(ids(pages[1])).toEqual(['h', 'b', 'tail']);
  });

  it('never moves a table, a cut piece, or more than the page before can spare', () => {
    const tabled = packMarkdownPages([para(20, 'a'), table(10), para(5, 'tail')], 40, { balanceTail: true });
    expect(tabled[0].map((b) => b.kind)).toEqual(['paragraph', 'table']);
    expect(ids(tabled[1])).toEqual(['tail']);
    const spare = packMarkdownPages([para(12, 'a'), para(26, 'b'), para(5, 'c')], 40, { balanceTail: true });
    expect(ids(spare[0])).toEqual(['a', 'b']);
    expect(ids(spare[1])).toEqual(['c']);
  });

  it('is off unless asked for, and on for every geometry-packed run', () => {
    expect(tailMinLines(GEOMETRY.contLines)).toBe(8);
    const geometry = packNarrativeGeometry([para(24, 'a'), heading('h'), para(6, 'b'), para(5, 'tail')], GEOMETRY);
    expect(ids(geometry[0])).toEqual(['a']);
    expect(ids(geometry[1])).toEqual(['h', 'b', 'tail']);
  });
});

describe('packNarrativeGeometry', () => {
  it('packs to the first and continuation capacities with every page-filling rule on', () => {
    const blocks = [para(30, 'a'), figure(12, 'chart'), para(6, 'b'), para(30, 'c'), para(2, 'tail')];
    const pages = packNarrativeGeometry(blocks, GEOMETRY);
    expect(lines(pages[0])).toBeLessThanOrEqual(GEOMETRY.firstPageLines);
    for (const page of pages.slice(1, -1)) expect(lines(page)).toBeLessThanOrEqual(GEOMETRY.contLines);
    // The figure floated past `b`; the tail was absorbed.
    expect(ids(pages[0])).toEqual(['a']);
    expect(ids(pages[1])).toEqual(['chart', 'b']);
    expect(ids(pages[pages.length - 1])).toContain('tail');
  });
});
