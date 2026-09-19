/**
 * Enrichment — the reader, the guards, and what the blocks render as.
 *
 * The thing being tested is a defence against a model, so every guard here is
 * checked by handing it the thing it exists to refuse. A guard asserted only on
 * good input is a guard nobody has run.
 *
 * The two false-positive tests matter as much as the rejections. A faithfulness
 * check that fires on `9.440000000000001` — a value this codebase produces
 * whenever a rate is summed before it is displayed — would reject every honest
 * answer, and a quota that demands a chart from three paragraphs of prose is how
 * invented data gets into a client document.
 */
import { describe, expect, it } from 'vitest';

import {
  blockLines,
  checkQuota,
  DEFAULT_FIDELITY,
  ENRICHMENT_JSON_SCHEMA,
  enrichedLines,
  enrichedText,
  enrichmentPrompt,
  enrichmentRetryPrompt,
  isDesigned,
  BLOCK_KINDS,
  LEAF_BLOCK_KINDS,
  MAX_BLOCKS_PER_CHAPTER,
  MIN_DONUT_SEGMENTS,
  MIN_ENRICH_CHARS,
  parseEnrichment,
  partitionForEnrichment,
  readFidelity,
  tooShortNote,
  type EnrichedBlock,
} from '../enrich.pure';
import { renderEnrichedBlocks } from '../renderBlocks.pure';
import {
  BARE_INTEGER_FLOOR,
  canonicaliseFigure,
  checkFaithful,
  extractFigures,
} from '../faithfulness.pure';
import { chartContext } from '../../../../../supabase/functions/_shared/reportDesign/charts.pure';
import { resolveReportPalette } from '../../../../../supabase/functions/_shared/reportDesign/brandResolve.pure';

const CTX = chartContext(resolveReportPalette({ preset: 'signature', brandHex: '#1F4E79' }));

/** What a good answer for a Borrowing Capacity chapter looks like. */
const GOOD = {
  blocks: [
    { kind: 'lede', text: 'The assessment concluded a maximum capacity of $856,932.' },
    {
      kind: 'kpi',
      cells: [
        { label: 'Assessment rate', value: '9.44%' },
        { label: 'Maximum loan', value: '$856,932' },
        { label: 'Monthly surplus', value: '$1,240', tone: 'positive' },
      ],
    },
    {
      kind: 'table',
      caption: 'Income by source',
      columns: [{ label: 'Source' }, { label: 'Annual', align: 'right' }],
      rows: [
        { cells: ['Salary', '$180,000'] },
        { cells: ['Rental', '$42,000'] },
        { cells: ['Total', '$222,000'], total: true },
      ],
      signedColumns: [1],
    },
    { kind: 'bullet', label: 'Proposed loan', value: 76, max: 100, sub: 'of capacity' },
    { kind: 'callout', tone: 'caution', label: 'Assumed', text: 'Rates hold at 9.44%.' },
  ],
};

describe('reading a model answer', () => {
  it('reads a well-formed chapter into blocks, in order', () => {
    const { blocks, notes } = parseEnrichment(GOOD);
    expect(blocks.map((b) => b.kind)).toEqual(['lede', 'kpi', 'table', 'bullet', 'callout']);
    expect(notes).toEqual([]);
  });

  it('never throws, whatever it is handed', () => {
    for (const bad of [null, undefined, 42, 'blocks', [], {}, { blocks: null }, { blocks: [null, 3] }]) {
      expect(() => parseEnrichment(bad as never)).not.toThrow();
    }
  });

  it('returns nothing rather than something partial when there are no blocks', () => {
    const { blocks, notes } = parseEnrichment({ blocks: [] });
    expect(blocks).toEqual([]);
    expect(notes.join(' ')).toContain('no blocks');
  });

  it('refuses a chapter that is only a lede', () => {
    // The lede is furniture. A chapter reduced to one is a chapter whose
    // content was deleted, and falling back to the flat Markdown is right.
    const { blocks, notes } = parseEnrichment({
      blocks: [{ kind: 'lede', text: 'This chapter sets out the position.' }],
    });
    expect(blocks).toEqual([]);
    expect(notes.join(' ')).toContain('lede and nothing else');
  });

  it('drops an unknown block kind and says which', () => {
    const { blocks, notes } = parseEnrichment({
      blocks: [{ kind: 'sankey', data: [] }, ...GOOD.blocks],
    });
    expect(blocks.map((b) => b.kind)).not.toContain('sankey');
    expect(notes.join(' ')).toContain('sankey');
  });

  it('caps a chapter that returns more blocks than one can be', () => {
    const many = Array.from({ length: MAX_BLOCKS_PER_CHAPTER + 5 }, (_, i) => ({
      kind: 'prose', markdown: `Paragraph ${i}. It carries a sentence of real length.`,
    }));
    const { blocks, notes } = parseEnrichment({ blocks: many });
    expect(blocks).toHaveLength(MAX_BLOCKS_PER_CHAPTER);
    expect(notes.join(' ')).toContain('past the');
  });
});

describe('the degenerate-block guards', () => {
  // Each of these renders as `''` from its primitive, so without the reader a
  // refused chart leaves a hole the page budget has already been charged for.

  it('refuses a donut of two segments', () => {
    const { blocks, notes } = parseEnrichment({
      blocks: [{
        kind: 'donut',
        segments: [{ label: 'Salary', value: 60 }, { label: 'Rental', value: 40 }],
      }],
    });
    expect(blocks).toEqual([]);
    expect(notes.join(' ')).toContain(`needs ${MIN_DONUT_SEGMENTS}`);
  });

  it('accepts a donut of three', () => {
    const { blocks } = parseEnrichment({
      blocks: [{
        kind: 'donut',
        segments: [
          { label: 'Salary', value: 60 }, { label: 'Rental', value: 30 }, { label: 'Other', value: 10 },
        ],
      }, { kind: 'prose', markdown: 'A paragraph so the lede rule does not apply.' }],
    });
    expect(blocks[0].kind).toBe('donut');
  });

  it('refuses a KPI strip of one', () => {
    const { blocks, notes } = parseEnrichment({
      blocks: [{ kind: 'kpi', cells: [{ label: 'Rate', value: '9.44%' }] }],
    });
    expect(blocks).toEqual([]);
    expect(notes.join(' ')).toContain('KPI strip of 1');
  });

  it('refuses a bar chart of one, and one where every bar is zero', () => {
    const one = parseEnrichment({ blocks: [{ kind: 'bars', items: [{ label: 'A', value: 5 }] }] });
    expect(one.blocks).toEqual([]);

    const flat = parseEnrichment({
      blocks: [{ kind: 'bars', items: [{ label: 'A', value: 0 }, { label: 'B', value: 0 }] }],
    });
    expect(flat.blocks).toEqual([]);
    expect(flat.notes.join(' ')).toContain('every value is zero');
  });

  it('refuses a bullet with neither a target nor a maximum', () => {
    // `renderBullet` floors its max at the value, so this draws a full bar and
    // says "100%" of nothing.
    const { blocks, notes } = parseEnrichment({
      blocks: [{ kind: 'bullet', label: 'Proposed loan', value: 76 }],
    });
    expect(blocks).toEqual([]);
    expect(notes.join(' ')).toContain('neither a target nor a maximum');
  });

  it('keeps a callout that has a body but no label, and titles it from its tone', () => {
    // A real conversion filled its notes with `block 0: a callout missing its
    // label or body`. The bodies were there; the labels were not. Discarding a
    // block that carries real content because nobody titled it is the wrong
    // trade — the tone already says what the block is.
    const { blocks, notes } = parseEnrichment({
      blocks: [
        { kind: 'callout', tone: 'caution', text: 'Rates are assumed to hold at 9.44%.' },
        { kind: 'callout', tone: 'negative', text: 'The position is short by $1,240 a month.' },
        { kind: 'sidenote', text: 'A buffer is added to the advertised rate.' },
      ],
    });
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => (b.kind === 'callout' || b.kind === 'sidenote') && b.label))
      .toEqual(['Caution', 'Shortfall', 'Note']);
    expect(notes.join(' ')).not.toContain('missing its label');
  });

  it('still refuses a callout with a label and no body', () => {
    // The other half of the old guard, and it stays: a title with nothing under
    // it renders as an empty box.
    const { blocks, notes } = parseEnrichment({
      blocks: [{ kind: 'callout', tone: 'caution', label: 'Assumed', text: '   ' }],
    });
    expect(blocks).toEqual([]);
    expect(notes.join(' ')).toContain('no body');
  });

  it('prefers the model\'s own label to the default', () => {
    const { blocks } = parseEnrichment({
      blocks: [
        { kind: 'callout', tone: 'caution', label: 'Assumed', text: 'Rates hold.' },
        { kind: 'prose', markdown: 'A paragraph so the lede rule does not apply.' },
      ],
    });
    expect(blocks[0].kind === 'callout' && blocks[0].label).toBe('Assumed');
  });

  it('refuses a table with no rows and one with no columns', () => {
    expect(parseEnrichment({
      blocks: [{ kind: 'table', columns: [{ label: 'A' }], rows: [] }],
    }).blocks).toEqual([]);
    expect(parseEnrichment({
      blocks: [{ kind: 'table', columns: [], rows: [{ cells: ['x'] }] }],
    }).blocks).toEqual([]);
  });

  it('pads a ragged row rather than losing it', () => {
    // A transcription that omits an empty trailing cell is the commonest shape
    // of ragged table, and it is not worth a dropped row.
    const { blocks } = parseEnrichment({
      blocks: [{
        kind: 'table',
        columns: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
        rows: [{ cells: ['one'] }, { cells: ['two', 'three', 'four', 'five'] }],
      }],
    });
    const table = blocks[0];
    expect(table.kind).toBe('table');
    if (table.kind !== 'table') return;
    expect(table.rows[0].cells).toEqual(['one', '', '']);
    expect(table.rows[1].cells).toEqual(['two', 'three', 'four']);
  });

  it('drops a signed-column index that points at no column', () => {
    const { blocks } = parseEnrichment({
      blocks: [{
        kind: 'table',
        columns: [{ label: 'A' }, { label: 'B' }],
        rows: [{ cells: ['x', 'y'] }],
        signedColumns: [1, 9, -1],
      }],
    });
    const table = blocks[0];
    if (table.kind !== 'table') throw new Error('expected a table');
    expect(table.signedColumns).toEqual([1]);
  });
});

describe('rendering blocks through the real primitives', () => {
  const { blocks } = parseEnrichment(GOOD);
  const rendered = renderEnrichedBlocks(blocks, CTX, 'cv0');

  it('produces the design system\'s own markup, not paragraph soup', () => {
    // The whole failure this replaces: a KPI strip that arrived as a table and
    // a progress bar that arrived as `<p>Proposed loan 76%</p>`.
    expect(rendered.html).toContain('class="kpi-strip"');
    expect(rendered.html).toContain('<table class="data"');
    expect(rendered.html).toContain('class="callout tone-caution"');
    expect(rendered.html).toContain('<svg');
    expect(rendered.dropped).toEqual([]);
  });

  it('marks the total row and the signed column', () => {
    expect(rendered.html).toContain('class="total"');
  });

  it('escapes a callout body, which the primitive does not', () => {
    // `renderCallout` takes raw HTML by design, so the escaping is this
    // module's job and is the one asymmetry in the file.
    const { blocks: b } = parseEnrichment({
      blocks: [
        { kind: 'callout', tone: 'neutral', label: 'Note <b>', text: 'Rates <script>alert(1)</script> hold.' },
        { kind: 'prose', markdown: 'A paragraph so the lede rule does not apply.' },
      ],
    });
    const html = renderEnrichedBlocks(b, CTX, 'x').html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Note &lt;b&gt;');
  });

  it('escapes a sidenote body too', () => {
    const { blocks: b } = parseEnrichment({
      blocks: [
        { kind: 'sidenote', label: 'Definition', text: 'A buffer is <em>added</em> to the rate.' },
        { kind: 'prose', markdown: 'A paragraph so the lede rule does not apply.' },
      ],
    });
    expect(renderEnrichedBlocks(b, CTX, 'x').html).toContain('&lt;em&gt;');
  });

  it('keeps paragraph breaks in a callout body', () => {
    const { blocks: b } = parseEnrichment({
      blocks: [
        { kind: 'callout', tone: 'neutral', label: 'Two', text: 'First point.\n\nSecond point.' },
        { kind: 'prose', markdown: 'A paragraph so the lede rule does not apply.' },
      ],
    });
    const html = renderEnrichedBlocks(b, CTX, 'x').html;
    expect(html).toContain('<p>First point.</p>');
    expect(html).toContain('<p>Second point.</p>');
  });

  it('costs what it renders', () => {
    expect(rendered.lines).toBe(enrichedLines(blocks));
    for (const b of blocks) expect(blockLines(b), b.kind).toBeGreaterThan(0);
  });

  it('renders nothing at all for no blocks, without throwing', () => {
    expect(renderEnrichedBlocks([], CTX, 'x')).toEqual({ html: '', lines: 0, dropped: [] });
  });
});

describe('faithfulness', () => {
  const SOURCE = 'Assessment rate 9.44%. Maximum capacity $856,932. Surplus $1,240 per month '
    + 'across 3 scenarios, assessed 2026.';

  it('passes an answer that only uses the chapter\'s figures', () => {
    const v = checkFaithful(SOURCE, 'Maximum loan $856,932 at 9.44%, surplus $1,240.');
    expect(v.ok).toBe(true);
    expect(v.invented).toEqual([]);
  });

  it('catches a total the chapter never totalled', () => {
    // The dangerous failure. It looks authoritative and it is wrong.
    const v = checkFaithful(SOURCE, 'Total commitments $2,480 per month.');
    expect(v.ok).toBe(false);
    expect(v.invented.map((f) => f.token)).toContain('$2,480');
    expect(v.reason).toContain('$2,480');
  });

  it('does not fire on a float this codebase actually produces', () => {
    // `9.440000000000001` is what summing a rate before displaying it gives.
    // A check that rejects it rejects every honest answer.
    const v = checkFaithful('The rate is 9.440000000000001%.', 'Assessment rate 9.44%');
    expect(v.ok).toBe(true);
  });

  it('treats a formatted figure and its bare form as one', () => {
    expect(checkFaithful('Capacity $856,932.', 'Capacity 856932').ok).toBe(true);
    expect(checkFaithful('Capacity 856932.', 'Capacity $856,932.00').ok).toBe(true);
  });

  it('ignores small integers a model writes legitimately', () => {
    // "the two scenarios", "three conditions" — flagging these makes every
    // chapter fail at `connective` and `rewrite`.
    const v = checkFaithful('One scenario was modelled.', 'Across 2 of the 3 cases, all 11 rows.');
    expect(v.ok).toBe(true);
    expect(extractFigures(`Across ${BARE_INTEGER_FLOOR} cases`)).toEqual([]);
  });

  it('does not ignore a large bare integer', () => {
    const v = checkFaithful('Nothing numeric here.', 'A capacity of 856932.');
    expect(v.ok).toBe(false);
  });

  it('ignores a bare year but not a currency amount that looks like one', () => {
    expect(checkFaithful('Assessed in March.', 'The 2026 assessment.').ok).toBe(true);
    expect(checkFaithful('Assessed in March.', 'A fee of $2,026.').ok).toBe(false);
  });

  it('refuses a rescaled rate, because rescaling is computing', () => {
    expect(checkFaithful('The rate is 0.0944 as a fraction.', 'Assessment rate 9.44%').ok).toBe(false);
  });

  it('reads a parenthesised negative as negative', () => {
    expect(canonicaliseFigure('(2,000)')).toBe(-2000);
    expect(canonicaliseFigure('-$1,234.50')).toBe(-1234.5);
    expect(canonicaliseFigure('9.44%')).toBe(9.44);
    expect(canonicaliseFigure('not a number')).toBeNull();
  });

  it('checks the figures inside chart values, not only inside sentences', () => {
    // A figure the model put in `items[].value` is exactly as invented as one
    // it put in a sentence, and `enrichedText` is what makes that true.
    const blocks: EnrichedBlock[] = [
      { kind: 'bars', items: [{ label: 'Salary', value: 180000 }, { label: 'Rental', value: 99999 }] },
    ];
    const v = checkFaithful('Salary 180000 and rental 42000.', enrichedText(blocks));
    expect(v.ok).toBe(false);
    expect(v.invented.map((f) => f.value)).toContain(99999);
  });

  it('does not read a bullet\'s maximum as a claim about the client', () => {
    // The defect this exists to stop. A real conversion rejected *Capacity at a
    // glance* — the flagship chapter, twice, then fell back to flat prose —
    // with `it contains 1 figure the chapter does not: 100`. The chapter says
    // "76% utilisation" and contains no 100. The model had done exactly the
    // right thing: a `bullet` of 76 against a scale of 100.
    //
    // `max` is the axis, not an assertion. A wrong max mis-scales a bar; a
    // wrong value misstates a figure, and only the second is worth throwing a
    // chapter away for.
    const blocks: EnrichedBlock[] = [
      { kind: 'bullet', label: 'Proposed loan', value: 76, max: 100, sub: 'of capacity' },
    ];
    const v = checkFaithful('Utilisation is 76% of assessed capacity.', enrichedText(blocks));
    expect(v.ok).toBe(true);
    expect(enrichedText(blocks)).not.toContain('100');
  });

  it('still checks a bullet\'s value and its target', () => {
    // The other two numbers on a bullet are claims — "you are at 88" and "the
    // policy limit is 80" are both statements about the client.
    const badValue: EnrichedBlock[] = [{ kind: 'bullet', label: 'Proposed loan', value: 88, max: 100 }];
    expect(checkFaithful('Utilisation is 76% of capacity.', enrichedText(badValue)).ok).toBe(false);

    const badTarget: EnrichedBlock[] = [
      { kind: 'bullet', label: 'Proposed loan', value: 76, target: 8_432, max: 100 },
    ];
    const v = checkFaithful('Utilisation is 76% of capacity.', enrichedText(badTarget));
    expect(v.ok).toBe(false);
    expect(v.invented.map((f) => f.value)).toContain(8432);
  });

  it('allows the output to omit what the source had', () => {
    // Only one direction is checked, on purpose: omission is visible, invention
    // is not.
    expect(checkFaithful(SOURCE, 'Maximum loan $856,932.').ok).toBe(true);
  });
});

describe('the content quota', () => {
  const TABULAR = 'Income:\n\n| Source | Annual |\n| --- | --- |\n| Salary | $180,000 |';

  it('catches a chapter wrapped in one prose block', () => {
    // Valid, parses cleanly, and is exactly the flat output this replaces.
    const v = checkQuota(TABULAR, [{ kind: 'prose', markdown: TABULAR }]);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('table');
    expect(v.designed).toBe(0);
  });

  it('passes as soon as one block is designed', () => {
    const v = checkQuota(TABULAR, [
      { kind: 'prose', markdown: 'Some prose.' },
      { kind: 'kpi', cells: [{ label: 'A', value: '1' }, { label: 'B', value: '2' }] },
    ]);
    expect(v.ok).toBe(true);
    expect(v.designed).toBe(1);
  });

  it('does not demand a chart from a chapter that has nothing to promote', () => {
    // The escape hatch. Demanding a chart from three paragraphs of prose is how
    // invented data gets into a client document.
    const prose = 'Capacity is assessed against a servicing buffer above the advertised rate, '
      + 'on the household income and commitments recorded at application.';
    const v = checkQuota(prose, [{ kind: 'prose', markdown: prose }]);
    expect(v.ok).toBe(true);
    expect(v.reason).toContain('no table or figure');
  });

  it('does demand one when the source carries figures but no table', () => {
    const v = checkQuota('The maximum capacity is $856,932 at 9.44%.', [
      { kind: 'prose', markdown: 'The maximum capacity is $856,932 at 9.44%.' },
    ]);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('figures');
  });

  it('counts every non-prose block as designed', () => {
    const kinds: EnrichedBlock[] = [
      { kind: 'lede', text: 'x' },
      { kind: 'prose', markdown: 'x' },
    ];
    expect(kinds.filter(isDesigned).map((b) => b.kind)).toEqual(['lede']);
  });
});

describe('which chapters are worth asking about', () => {
  const chapter = (title: string, chars: number) => ({ title, markdown: 'x'.repeat(chars) });

  it('skips a chapter too short to have anything to design', () => {
    // A real conversion spent fourteen of its twenty calls on fragments —
    // `DTI Ratio` at 61 characters, `Stress Test` at 78 — and got back "the
    // model returned no blocks" fourteen times.
    const { work, skipped } = partitionForEnrichment([
      chapter('Capacity at a glance', 900),
      chapter('DTI Ratio', 61),
      chapter('Stress Test', 78),
    ]);
    expect(work.map((c) => c.title)).toEqual(['Capacity at a glance']);
    expect(skipped.map((c) => c.title)).toEqual(['DTI Ratio', 'Stress Test']);
  });

  it('says a skipped chapter was skipped rather than letting it read as a failure', () => {
    // "4 of 6 designed" with nothing else said means two chapters failed. They
    // did not; they were never asked.
    expect(tooShortNote(chapter('Warnings', 42)))
      .toBe('Warnings: too short to design (42 characters)');
  });

  it('drops an empty chapter without calling it a skip', () => {
    // An unfilled chapter has no source. There is nothing to tell anybody.
    const { work, skipped } = partitionForEnrichment([chapter('Audit trail', 0), { title: 'Blank', markdown: '   \n  ' }]);
    expect(work).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it('measures the trimmed length, at the floor exactly', () => {
    const { work } = partitionForEnrichment([
      { title: 'On it', markdown: `\n\n${'x'.repeat(MIN_ENRICH_CHARS)}\n\n` },
      { title: 'Under it', markdown: 'x'.repeat(MIN_ENRICH_CHARS - 1) },
    ]);
    expect(work.map((c) => c.title)).toEqual(['On it']);
  });
});

describe('fidelity and the prompts', () => {
  it('falls back to the conservative level for anything unrecognised', () => {
    expect(readFidelity('rewrite')).toBe('rewrite');
    expect(readFidelity('connective')).toBe('connective');
    for (const bad of [undefined, null, '', 'creative', 7, {}]) {
      expect(readFidelity(bad), String(bad)).toBe(DEFAULT_FIDELITY);
    }
    expect(DEFAULT_FIDELITY).toBe('restructure');
  });

  it('locks the figures at every level', () => {
    for (const f of ['restructure', 'connective', 'rewrite'] as const) {
      const p = enrichmentPrompt('Capacity at a glance', 'Rate 9.44%.', f);
      expect(p, f).toContain('must appear');
      expect(p, f).toContain('$856,932 stays $856,932');
    }
  });

  it('forbids new sentences at restructure and permits a lede at connective', () => {
    expect(enrichmentPrompt('C', 'x', 'restructure')).toContain('may not write a new sentence');
    expect(enrichmentPrompt('C', 'x', 'connective')).toContain('one opening `lede` sentence');
    expect(enrichmentPrompt('C', 'x', 'rewrite')).toContain('rewrite the prose');
  });

  it('names the one failure the prompt exists to prevent', () => {
    // A short prompt produced a single `prose` block every time.
    expect(enrichmentPrompt('C', 'x', 'restructure')).toContain('is a failed answer');
  });

  it('carries the chapter and its title into the prompt', () => {
    const p = enrichmentPrompt('Income and commitments', 'Salary $180,000.', 'restructure');
    expect(p).toContain('Income and commitments');
    expect(p).toContain('Salary $180,000.');
  });

  it('hands the rejection back verbatim on the retry', () => {
    const r = enrichmentRetryPrompt('C', 'x', 'restructure', 'every block came back as prose');
    expect(r).toContain('rejected because every block came back as prose');
    // Still the whole original prompt — a retry that drops the vocabulary asks
    // the model to guess it.
    expect(r).toContain('is a failed answer');
  });

  it('describes every block kind in the schema it enforces', () => {
    const props = ENRICHMENT_JSON_SCHEMA.properties.blocks.items.properties;
    expect([...props.kind.enum].sort()).toEqual([...BLOCK_KINDS].sort());
    // The reason this is asserted against the const rather than a number: the
    // schema is what the model is *allowed* to say, and a kind the reader
    // understands but the schema omits is a primitive nobody can reach. That is
    // exactly how a nine-word vocabulary ended up in front of a design system
    // with thirty primitives in it.
    for (const kind of ['waterfall', 'gauge', 'decision', 'quote', 'row']) {
      expect(props.kind.enum, kind).toContain(kind);
    }
  });

  it('lets a row hold every kind except another row', () => {
    // Two levels of nesting is a layout engine, and a model that can nest rows
    // inside rows produces documents nobody can budget the pages for.
    const inner = ENRICHMENT_JSON_SCHEMA.properties.blocks.items.properties.blocks.items;
    expect([...inner.properties.kind.enum].sort()).toEqual([...LEAF_BLOCK_KINDS].sort());
    expect(inner.properties.kind.enum).not.toContain('row');
  });
});

describe('the primitives the vocabulary used to hide', () => {
  // The design system ships around thirty primitives and twelve chart types.
  // The schema in front of it named nine. A natively designed report of the
  // same figures used a waterfall, a row of cards and a pair of note boxes —
  // every one of which already existed here and none of which a model could
  // ask for. These specs are the guard against that happening again.

  const filler = { kind: 'prose', markdown: 'A paragraph so the lede rule does not apply.' };

  it('reads a waterfall, which is the shape a build-up chapter wants', () => {
    const { blocks } = parseEnrichment({
      blocks: [{
        kind: 'waterfall',
        caption: 'From gross income to capacity',
        items: [
          { label: 'Gross income', value: 223698 },
          { label: 'Shading', value: -19739 },
          { label: 'Living expenses', value: -40320 },
          { label: 'Assessed', value: 163639, total: true },
        ],
      }, filler],
    });
    const w = blocks[0];
    expect(w.kind).toBe('waterfall');
    if (w.kind !== 'waterfall') return;
    expect(w.items).toHaveLength(4);
    expect(w.items[1].value).toBe(-19739);
    expect(w.items[3].total).toBe(true);
  });

  it('refuses a waterfall of two, which is a subtraction', () => {
    const { blocks, notes } = parseEnrichment({
      blocks: [{
        kind: 'waterfall',
        items: [{ label: 'In', value: 100 }, { label: 'Out', value: -40 }],
      }],
    });
    expect(blocks).toEqual([]);
    expect(notes.join(' ')).toContain('waterfall of 2');
  });

  it('refuses a gauge with no ceiling to read against', () => {
    // Same defect `bullet` has: the primitive floors its max at the value, so a
    // gauge without one draws a full arc and says 100% of nothing.
    const { blocks, notes } = parseEnrichment({
      blocks: [{ kind: 'gauge', value: 76 }],
    });
    expect(blocks).toEqual([]);
    expect(notes.join(' ')).toContain('no maximum');
  });

  it('reads a decision box and a pull quote', () => {
    const { blocks } = parseEnrichment({
      blocks: [
        { kind: 'decision', text: 'Reduce the personal loan before applying.' },
        { kind: 'quote', text: 'The position is limited.', attribution: 'Assessment' },
      ],
    });
    expect(blocks.map((b) => b.kind)).toEqual(['decision', 'quote']);
    // A decision box without a label still has one — it is a named furniture
    // slot, not a free heading.
    expect(blocks[0].kind === 'decision' && blocks[0].label).toBe('What this means');
  });
});

describe('a row, which is the only layout the model may choose', () => {
  const cell = (label: string, value: string) =>
    ({ kind: 'kpi', cells: [{ label, value }, { label: `${label} basis`, value: 'assessed' }] });

  it('sets two or three blocks across the page', () => {
    const { blocks } = parseEnrichment({
      blocks: [{
        kind: 'row',
        blocks: [cell('Capacity', '$856,932'), cell('Surplus', '$7,168'), cell('DTI', '10.6x')],
      }],
    });
    const row = blocks[0];
    expect(row.kind).toBe('row');
    if (row.kind !== 'row') return;
    expect(row.blocks).toHaveLength(3);
  });

  it('does not let a row hold another row', () => {
    // Two levels of nesting is a layout engine.
    const { blocks } = parseEnrichment({
      blocks: [{
        kind: 'row',
        blocks: [
          cell('Capacity', '$856,932'),
          { kind: 'row', blocks: [cell('A', '1'), cell('B', '2')] },
          cell('DTI', '10.6x'),
        ],
      }],
    });
    const row = blocks[0];
    if (row.kind !== 'row') throw new Error('expected a row');
    expect(row.blocks.map((b) => b.kind)).toEqual(['kpi', 'kpi']);
  });

  it('unwraps a row of one rather than printing a block with a margin on it', () => {
    const { blocks, notes } = parseEnrichment({
      blocks: [{ kind: 'row', blocks: [cell('Capacity', '$856,932')] }, { kind: 'prose', markdown: 'x' }],
    });
    expect(blocks[0].kind).toBe('kpi');
    expect(notes.join(' ')).toContain('row of 1');
  });

  it('costs a row as its tallest column, not as the sum', () => {
    // Summing them would charge three cards as twelve lines when they print as
    // four, which is how a spine claims a page count the document has not.
    const three: EnrichedBlock[] = [{
      kind: 'row',
      blocks: [
        { kind: 'kpi', cells: [{ label: 'A', value: '1' }, { label: 'B', value: '2' }] },
        { kind: 'kpi', cells: [{ label: 'C', value: '3' }, { label: 'D', value: '4' }] },
      ],
    }];
    expect(enrichedLines(three)).toBe(blockLines(three[0]));
    expect(blockLines(three[0])).toBe(4);
  });

  it('counts a row as designed only when something inside it is', () => {
    // A row of three prose blocks is three paragraphs in columns, which is not
    // design, it is a newspaper accident.
    const prose: EnrichedBlock = {
      kind: 'row',
      blocks: [{ kind: 'prose', markdown: 'a' }, { kind: 'prose', markdown: 'b' }],
    };
    const kpis: EnrichedBlock = {
      kind: 'row',
      blocks: [
        { kind: 'prose', markdown: 'a' },
        { kind: 'kpi', cells: [{ label: 'A', value: '1' }, { label: 'B', value: '2' }] },
      ],
    };
    expect(isDesigned(prose)).toBe(false);
    expect(isDesigned(kpis)).toBe(true);
  });

  it('checks the figures inside a row exactly as it checks them outside one', () => {
    const row: EnrichedBlock[] = [{
      kind: 'row',
      blocks: [
        { kind: 'kpi', cells: [{ label: 'Capacity', value: '$856,932' }, { label: 'Rate', value: '9.44%' }] },
        { kind: 'kpi', cells: [{ label: 'Surplus', value: '$99,999' }, { label: 'Term', value: '30 years' }] },
      ],
    }];
    const v = checkFaithful('Capacity $856,932 at 9.44% over 30 years.', enrichedText(row));
    expect(v.ok).toBe(false);
    expect(v.invented.map((f) => f.token)).toContain('$99,999');
  });

  it('renders through the twelve-column grid, with each chart sized to its column', () => {
    const { blocks } = parseEnrichment({
      blocks: [{
        kind: 'row',
        blocks: [
          { kind: 'kpi', cells: [{ label: 'A', value: '1' }, { label: 'B', value: '2' }] },
          { kind: 'bars', items: [{ label: 'X', value: 10 }, { label: 'Y', value: 4 }] },
        ],
      }],
    });
    const html = renderEnrichedBlocks(blocks, CTX, 'r').html;
    expect(html).toContain('class="grid-12"');
    expect(html).toContain('col-8');
    expect(html).toContain('col-4');
    expect(html).toContain('<svg');
  });
});
