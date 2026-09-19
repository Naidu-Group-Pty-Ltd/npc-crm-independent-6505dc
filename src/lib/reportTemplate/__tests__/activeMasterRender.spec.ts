import { describe, expect, it, vi } from 'vitest';
import { PRIVATE_BANKING_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { renderTemplateToBlob } from '../pdfRenderer';
import { getBlockRendererCapabilities } from '../blocks';

/**
 * The browser presentation renderer against a REAL production master.
 *
 * `Chancery` is the `Private Banking — Chancery` row that is active and
 * default for both `investment` and `investment_compass` — 50 declared pages,
 * 40 of them narrative, the highest-volume format in the product. The library
 * builds it here from the same source the seed writes, so this measures the
 * geometry production actually holds rather than a fixture written to pass.
 */
const master = (): any => (PRIVATE_BANKING_TEMPLATES as any[]).find((t) => t.name === 'Chancery');

const NARRATIVE = [
  '## Location Overview',
  '',
  'The property sits in an established pocket with **strong** transport access.',
  '',
  '| Metric | Value |',
  '| --- | --- |',
  '| Purchase price | $700,000 |',
  '| Gross yield | 4.83% |',
  '',
  '- Two bus routes within 400 m',
  '- Hospital 2.1 km away',
  '',
  '{{bars: Transport 80, Schools 70, Retail 55}}',
  '',
  '> Independent valuation was not commissioned for this report.',
  '',
].join('\n');

const DATA = {
  report: { type: 'investment_compass', title: 'Investment Compass' },
  narrative: { source: NARRATIVE, pages: 2 },
  org: { name: 'NPC Services' },
  property: { address: '12 Example Street, Cowra NSW 2794' },
};

const blockTypesOf = (schema: any): string[] => {
  const out = new Set<string>();
  for (const page of schema.pages ?? []) for (const b of page.blocks ?? []) out.add(b.type);
  return [...out].sort();
};

describe('a real production master, drawn in the browser', () => {
  it('has a full jsPDF renderer for every block type it carries', () => {
    const partial = blockTypesOf(master().schema).filter(
      (type) => getBlockRendererCapabilities(type).jspdf !== 'full',
    );
    expect(partial).toEqual([]);
  });

  it('draws without meeting a block type it has no renderer for', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const blob = renderTemplateToBlob(master().schema, { data: DATA });
      expect(blob.size).toBeGreaterThan(0);
      const complaints = warn.mock.calls
        .map((c) => c.map(String).join(' '))
        .filter((m) => m.includes('No renderer for block type'));
      expect(complaints).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * The narrative is the half of this document a model writes, and it reaches
   * the page through `markdown-block` — 215 instances across seven active
   * templates, and the one block type this renderer could not draw when it was
   * restored.
   */
  it('puts the model-authored narrative on the page', async () => {
    const blob = renderTemplateToBlob(master().schema, { data: DATA });
    const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
    expect(pdf).toContain('Location Overview');       // a heading
    expect(pdf).toContain('established pocket');       // body prose
    expect(pdf).toContain('strong');                   // an emphasised run
    expect(pdf).toContain('Purchase price');           // a table row
    expect(pdf).toContain('Two bus routes within 400'); // a list item
    expect(pdf).toContain('Independent valuation');    // a blockquote callout
    expect(pdf).toContain('Transport');                // a chart label
  });

  it('grows with the narrative rather than drawing a fixed document', async () => {
    // The renderer counts the narrative's pages itself (`planNarrative`), so
    // the projection's estimate cannot shrink the document — only a shorter
    // narrative can. A one-paragraph body against the full one.
    const short = renderTemplateToBlob(master().schema, {
      data: { ...DATA, narrative: { source: NARRATIVE.split('\n\n')[0], pages: 0 } },
    });
    const long = renderTemplateToBlob(master().schema, { data: DATA });
    expect(long.size).toBeGreaterThan(short.size);
  });
});
