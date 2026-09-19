/**
 * The contents page and the PDF outline name the report's own sections.
 *
 * ## What this replaces
 *
 * Both surfaces named PAGE ARCHETYPES. A real 36-page Investment Compass
 * (Chancery, `investment-compass-pb-01-chancery`, Annabelle's stored row)
 * printed an eight-row contents — *Cover · Contents · Executive dashboard ·
 * The assessment · Risk and recommendation · The report · Sources and
 * methodology · Important information* — for a body of twenty-one sections,
 * because the twenty-nine narrative sheets declare `tocContinues` and fold
 * into the one row named "The report". Everything a reader opens a contents
 * page to find was inside that row.
 *
 * The outline was worse, because WeasyPrint builds it from every `h1`–`h6`
 * and a `text-block` heading is display type bound to the record: the third
 * entry read *"AVOID - Poor investment opportunity with multiple red flags"*,
 * and the pages a reader knows as "The assessment" and "Risk and
 * recommendation" appeared under their headlines.
 *
 * Measured on that document after the change: the contents prints 22 rows
 * whose folios are 1, 2, 3, 4, 5, 6, 7, 8, 11, 14, 15, 16, 19, 21, 23, 24,
 * 29, 30, 31, 32, 35, 36 and whose 22 destinations resolve to exactly those
 * pages; the outline carries the same 22 at level 2 with the subsections
 * nested under them; and the file validates as PDF/UA-1 with zero failed
 * rules on the production print contract.
 *
 * These tests use small templates because the rules are what is being pinned.
 * The whole-document measurement lives in `docs/reports/S3_SHARED_PATH.md`.
 */
import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { NARRATIVE_INDEX_KEY, narrativeIndexFrom } from '../narrativeIndex';

const SIZE = { width: 595, height: 842 };

/** One `markdown-block` instance: the master's fixed run, one bucket each. */
const narrative = (pageIndex: number) => ({
  id: `md-${pageIndex}`,
  type: 'markdown-block',
  props: { source: '{{narrative.source}}', pageIndex, x: 40, y: 80, width: 515, height: 700 },
  overlays: [],
});

const page = (id: string, name: string, blocks: unknown[], extra: Record<string, unknown> = {}) => ({
  id, name, size: SIZE, blocks, ...extra,
});

const toc = () => ({
  id: 'toc-1', type: 'toc', props: { title: '', x: 40, y: 80, width: 515 }, overlays: [],
});

/** A block that always draws, so an archetype page is never dropped as empty. */
const label = (id: string, text: string) => ({
  id, type: 'text-block', props: { body: text, x: 40, y: 200, width: 515 }, overlays: [],
});

/**
 * Four sections that pack into four buckets, one heading each — measured on
 * the default charge model, which is what a master leaves in place. `Alpha
 * detail` is an `h3` so the depth rule has something to exclude.
 */
const BODY = 2000;
const SOURCE = [
  '# Alpha', 'a'.repeat(BODY), '',
  '## Alpha detail', 'b'.repeat(BODY), '',
  '# Beta', 'c'.repeat(BODY), '',
  '# Gamma', 'd'.repeat(BODY), '',
].join('\n');

/** The same four sections spread over eight buckets: every other one has no heading. */
const SPARSE = SOURCE.replace(/(.)\1{1999}/g, (m) => m[0].repeat(3000));

const render = (pages: unknown[], data: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) => renderTemplateToHtml(
  { version: 1, tokens: { colors: {}, fonts: {}, spacing: {} }, pages } as never,
  { data: { narrative: { source: SOURCE }, ...data }, ...opts } as never,
);

const pageSection = (html: string, index: number) => html.split(`id="tpl-page-${index}"`)[1].split('</section>')[0];

describe('the index the renderer publishes', () => {
  it('is empty rather than absent, so no reader branches on it', () => {
    expect(narrativeIndexFrom(undefined)).toEqual({ narrativePages: [], sections: [] });
    expect(narrativeIndexFrom({})).toEqual({ narrativePages: [], sections: [] });
    expect(narrativeIndexFrom({ [NARRATIVE_INDEX_KEY]: { sections: 'nope' } }))
      .toEqual({ narrativePages: [], sections: [] });
  });
});

describe('the contents page', () => {
  const pages = [
    page('p0', 'Cover', [label('c', 'Prepared for a client')]),
    page('p1', 'Contents', [toc()]),
    page('p2', 'The report', [narrative(0)]),
    page('p3', 'The report (2)', [narrative(1)], { tocContinues: true }),
    page('p4', 'The report (3)', [narrative(2)], { tocContinues: true }),
    page('p5', 'The report (4)', [narrative(3)], { tocContinues: true }),
    page('p6', 'Important information', [label('i', 'This report is general in nature')]),
  ];

  it('names the report\'s sections instead of the page that carries them', () => {
    const contents = pageSection(render(pages).html, 1);
    expect(contents).toContain('Alpha');
    expect(contents).toContain('Beta');
    expect(contents).toContain('Gamma');
    // The archetype pages keep the names their designer gave them…
    expect(contents).toContain('Cover');
    expect(contents).toContain('Important information');
    // …and a narrative sheet contributes none of its own.
    expect(contents).not.toContain('The report');
  });

  it('prints the folio of the page the section actually landed on', () => {
    const contents = pageSection(render(pages).html, 1);
    const rows = [...contents.matchAll(/>(\d+\. [^<]+)<\/[as]><span[^>]*>(\d*)</g)]
      .map((m) => `${m[1]} @ ${m[2]}`);
    expect(rows).toEqual([
      '1. Cover @ 1',
      '2. Contents @ 2',
      '3. Alpha @ 3',
      '4. Beta @ 5',
      '5. Gamma @ 6',
      '6. Important information @ 7',
    ]);
  });

  it('links a section row to the heading itself, not to the top of the sheet', () => {
    const { html } = render(pages);
    const hrefs = [...pageSection(html, 1).matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.filter((h) => h.startsWith('tpl-page-'))).toEqual(['tpl-page-0', 'tpl-page-1', 'tpl-page-6']);
    const sectionHrefs = hrefs.filter((h) => !h.startsWith('tpl-page-'));
    expect(sectionHrefs).toHaveLength(3);
    // Every destination is an id the document actually carries.
    for (const id of sectionHrefs) expect(html).toContain(`id="${id}"`);
  });

  it('lists the run\'s own top level only, unless the master asks for more', () => {
    expect(pageSection(render(pages).html, 1)).not.toContain('Alpha detail');

    const deep = pages.map((pg) => (pg.id === 'p1'
      ? page('p1', 'Contents', [{ ...toc(), props: { ...toc().props, sectionDepth: 2 } }])
      : pg));
    expect(pageSection(render(deep).html, 1)).toContain('Alpha detail');
  });

  it('behaves exactly as before on a document with no narrative in it', () => {
    const contents = pageSection(render([
      page('p0', 'Cover', [label('c', 'Prepared for a client')]),
      page('p1', 'Contents', [toc()]),
      page('p2', 'Findings', [label('f', 'What we found')]),
      page('p3', 'Findings (2)', [label('f2', 'What we found, continued')], { tocContinues: true }),
    ], { narrative: { source: '' } }).html, 1);
    expect(contents).toContain('1. Cover');
    expect(contents).toContain('3. Findings');
    expect(contents).not.toContain('Findings (2)');
  });
});

describe('the PDF outline', () => {
  const pages = [
    page('p0', 'Cover', [{
      id: 'h-0', type: 'text-block',
      props: { heading: '{{verdict}}', x: 40, y: 200, width: 515 }, overlays: [],
    }]),
    ...[0, 1, 2, 3].map((i) => page(`p${i + 1}`, i ? `The report (${i + 1})` : 'The report',
      [narrative(i)], i ? { tocContinues: true } : {})),
  ];
  const data = { narrative: { source: SPARSE }, verdict: 'AVOID — do not buy' };

  it('gives a page with no narrative its own name, beside the sections', () => {
    const { html } = render(pages, data);
    expect(html).toContain('bookmark-label:&#39;Cover&#39;');
    expect(html).toContain('bookmark-level:2');
  });

  it('never lets a sheet the narrative drew on announce itself', () => {
    const { html } = render(pages, data);
    expect(html).not.toContain('bookmark-label:&#39;The report');
  });

  it('refuses a bound headline as a section name', () => {
    // `{{recommendation.headline}}` resolving to "AVOID — …" was the third
    // outline entry in every Compass. The element and its heading role are
    // untouched; only its claim to name a part of the document is withdrawn.
    const { html } = render(pages, data);
    expect(html).toContain('>AVOID — do not buy</h2>');
    expect(html).toContain('bookmark-level:none');
  });

  it('emits no outline property at all when bookmarks are turned off', () => {
    const { html } = render(pages, data, { includeBookmarks: false });
    expect(html).not.toContain('bookmark-label');
    expect(html).not.toContain('bookmark-level');
  });
});
