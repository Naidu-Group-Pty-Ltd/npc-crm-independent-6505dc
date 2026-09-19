import { describe, expect, it } from 'vitest';
import { renderTemplateToBlob } from '../pdfRenderer';
import type { ReportTemplate } from '../templateSchema';

/**
 * The Report Presentation Renderer, restored from history and brought level
 * with what ACTIVE production templates require.
 *
 * The two drifts pinned here are the two that the sixteen live
 * `report_templates` rows actually exercise — eight bind `{{partNumber}}` and
 * six declare `tocContinues` — measured from the schemas rather than assumed.
 */

const TOKENS = {
  colors: { ink: '#1A1A1A', primary: '#BF9B50', line: '#E4E4E7', surface: '#FFFFFF' },
  fonts: { body: 'Helvetica', heading: 'Helvetica' },
  spacing: { sm: 4, md: 8, lg: 16 },
};

const page = (id: string, blocks: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  size: { width: 595, height: 842 },
  blocks,
  ...extra,
});

const textBlock = (id: string, content: string, y = 100) => ({
  id,
  type: 'text-block',
  props: { body: content, x: 40, y, width: 515, bodySize: 12 },
  overlays: [],
});

const render = (template: unknown, data: Record<string, unknown> = {}) =>
  renderTemplateToBlob(template as ReportTemplate, { data });

/** Text drawn into the document, read off the uncompressed content stream. */
const drawn = async (blob: Blob): Promise<string> =>
  Buffer.from(await blob.arrayBuffer()).toString('latin1');

describe('the presentation renderer walks pages', () => {
  it('draws only the pages whose conditional holds', async () => {
    const tpl = {
      name: 'T', tokens: TOKENS,
      pages: [
        page('a', [textBlock('t1', 'ALWAYS')]),
        page('b', [textBlock('t2', 'CONDITIONAL')], { conditional: 'narrative.pages >= 1' }),
      ],
    };
    expect(await drawn(render(tpl, {}))).not.toContain('CONDITIONAL');
    expect(await drawn(render(tpl, { narrative: { pages: 2 } }))).toContain('CONDITIONAL');
  });

  it('always produces a valid PDF, even when every page is conditional away', () => {
    const blob = render({
      name: 'T', tokens: TOKENS,
      pages: [page('a', [textBlock('t1', 'X')], { conditional: 'never.at.all' })],
    });
    expect(blob.size).toBeGreaterThan(0);
  });

  /**
   * Counted over the pages that RENDER, so a running head cannot keep counting
   * pages a conditional dropped. The renderer resolved this to nothing at all
   * before this was restored, on eight of the sixteen active templates.
   */
  it('numbers parts over the visible pages, and only for pages that opt in', async () => {
    const tpl = {
      name: 'T', tokens: TOKENS,
      pages: [
        page('cover', [textBlock('c', 'Cover')]),
        page('one', [textBlock('p1', 'Part {{partNumber}} of {{partCount}}')]),
        page('skipped', [textBlock('p2', 'Part {{partNumber}}')], { conditional: 'nothing.here' }),
        page('two', [textBlock('p3', 'Part {{partNumber}} of {{partCount}}')]),
      ],
    };
    const text = await drawn(render(tpl, {}));
    // The cover opts out, so the two parts are 1 and 2 — not 2 and 4.
    expect(text).toContain('Part 1 of 2');
    expect(text).toContain('Part 2 of 2');
    expect(text).not.toContain('Part 3');
  });

  it('numbers pages over the visible pages too', async () => {
    const tpl = {
      name: 'T', tokens: TOKENS,
      pages: [
        page('a', [textBlock('n1', 'Page {{pageNumber}} of {{pageCount}}')]),
        page('b', [textBlock('n2', 'Page {{pageNumber}} of {{pageCount}}')], { conditional: 'no' }),
        page('c', [textBlock('n3', 'Page {{pageNumber}} of {{pageCount}}')]),
      ],
    };
    const text = await drawn(render(tpl, {}));
    expect(text).toContain('Page 1 of 2');
    expect(text).toContain('Page 2 of 2');
  });

  /**
   * A section that runs over two pages declares the second a continuation, and
   * the contents block folds it into the entry above. The renderer used to
   * pass `id` and `name` alone, so every continuation arrived as `undefined`
   * and the contents listed one entry per sheet.
   */
  it('carries tocContinues to the contents block', async () => {
    const toc = { id: 'toc', type: 'toc', props: { title: 'Contents', x: 40, y: 80, width: 515 }, overlays: [] };
    const tpl = {
      name: 'T', tokens: TOKENS,
      pages: [
        page('contents', [toc]),
        page('report', [textBlock('r1', 'Body')], { name: 'The report' }),
        page('report-2', [textBlock('r2', 'More')], { name: 'The report', tocContinues: true }),
        page('sources', [textBlock('s1', 'Sources')], { name: 'Sources' }),
      ],
    };
    const text = await drawn(render(tpl, {}));
    expect(text).toContain('2. The report');
    expect(text).toContain('3. Sources');
    // The continuation folded, so nothing is numbered 4.
    expect(text).not.toContain('4. ');
  });
});

describe('a block is drawn only when all three of its gates allow it', () => {
  const tpl = (block: Record<string, unknown>) => ({
    name: 'T', tokens: TOKENS,
    pages: [page('a', [{ ...textBlock('t', 'DRAWN'), ...block }])],
  });

  it('draws an ordinary block', async () => {
    expect(await drawn(render(tpl({})))).toContain('DRAWN');
  });

  it('skips a block whose conditional fails', async () => {
    expect(await drawn(render(tpl({ conditional: 'absent.thing' })))).not.toContain('DRAWN');
  });

  /**
   * `hidden` and `visibility` were honoured by the HTML renderer and not by
   * this one, so an author's hidden block was absent from the HTML document
   * and present in the PDF of the same template. Both now ask
   * `renderVisibility`.
   */
  it('skips a hidden block, as the HTML renderer already did', async () => {
    expect(await drawn(render(tpl({ hidden: true })))).not.toContain('DRAWN');
  });

  it('honours a visibility rule in both directions', async () => {
    const when = { visibility: { mode: 'when', expr: 'flag' } };
    const unless = { visibility: { mode: 'unless', expr: 'flag' } };
    expect(await drawn(render(tpl(when), { flag: true }))).toContain('DRAWN');
    expect(await drawn(render(tpl(when), { flag: false }))).not.toContain('DRAWN');
    expect(await drawn(render(tpl(unless), { flag: true }))).not.toContain('DRAWN');
    expect(await drawn(render(tpl(unless), { flag: false }))).toContain('DRAWN');
  });
});
