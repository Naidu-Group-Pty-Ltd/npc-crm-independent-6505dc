/**
 * A converted document, laid out as an editable template.
 *
 * The editor's schema has no reflow — every overlay is an absolute box on a
 * fixed page — so the two things that can go wrong here are geometry (a box
 * that falls off the paper, or overlaps the next one) and colour (a hardcoded
 * value that will not re-theme). Both are asserted.
 */
import { describe, expect, it } from 'vitest';
import {
  buildConvertedTemplate,
  CONTENT_WIDTH,
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  paginateProse,
} from '../convertedTemplateSchema.pure';
import { ReportTemplateSchema } from '../templateSchema';

const prose = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    `Capacity is assessed against a servicing buffer of ${(3 + i * 0.1).toFixed(2)}% above the `
    + 'advertised rate, on the household income and commitments recorded at application.')
    .join('\n\n');

const build = (chapters: Parameters<typeof buildConvertedTemplate>[0]['chapters']) =>
  buildConvertedTemplate({
    title: 'Borrowing Power Assessment',
    formatName: 'Borrowing Capacity Assessment',
    systemName: 'Warm Editorial',
    chapters,
  });

describe('buildConvertedTemplate', () => {
  it('produces a template the editor can parse', () => {
    // The builder already parses before returning; re-parsing here is what
    // catches a change that makes the output valid-looking but not valid.
    const template = build([{ title: 'Position Summary', kind: 'bound', markdown: prose(2) }]);
    expect(() => ReportTemplateSchema.parse(template)).not.toThrow();
    expect(template.version).toBe(1);
  });

  it('opens with a cover and gives every chapter at least one page', () => {
    const template = build([
      { title: 'Position Summary', kind: 'bound', markdown: prose(2) },
      { title: 'Serviceability', kind: 'unfilled', markdown: '' },
      { title: 'Fee Schedule', kind: 'appendix', markdown: prose(2) },
    ]);
    expect(template.pages[0].name).toBe('Cover');
    expect(template.pages).toHaveLength(4);
  });

  it('gives an unfilled chapter a page and a line saying why it is empty', () => {
    // Dropping it would change the format's own structure, which is the thing
    // binding exists to preserve.
    const template = build([{ title: 'Serviceability', kind: 'unfilled', markdown: '' }]);
    const text = JSON.stringify(template);
    expect(template.pages).toHaveLength(2);
    expect(text).toContain('prints this chapter from its own data');
  });

  it('splits a chapter longer than a page across numbered pages', () => {
    const template = build([{ title: 'Fee Schedule', kind: 'appendix', markdown: prose(40) }]);
    const names = template.pages.map((p) => p.name);
    expect(names.filter((n) => n.includes('Fee Schedule')).length).toBeGreaterThan(1);
    expect(names.some((n) => n.includes('(1/'))).toBe(true);
  });

  it('keeps every overlay inside the printable page', () => {
    // An overlay taller than the paper is one whose handles cannot be reached
    // in the editor, and one that prints off the bottom.
    const template = build([
      { title: 'Position Summary', kind: 'bound', markdown: prose(30) },
      { title: 'Fee Schedule', kind: 'appendix', markdown: prose(3) },
    ]);
    for (const page of template.pages) {
      expect(page.size).toEqual({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
      for (const block of page.blocks) {
        for (const overlay of block.overlays) {
          expect(overlay.x).toBeGreaterThanOrEqual(MARGIN);
          expect(overlay.width).toBeLessThanOrEqual(CONTENT_WIDTH);
          expect(overlay.y + overlay.height).toBeLessThanOrEqual(PAGE_HEIGHT);
        }
      }
    }
  });

  it('names no colour of its own — every reference is a token', () => {
    // A hardcoded hex here would be a converted template that cannot re-theme,
    // and one the style ratchet is right to object to.
    const template = build([{ title: 'Position Summary', kind: 'bound', markdown: prose(2) }]);
    const pagesOnly = JSON.stringify(template.pages);
    expect(pagesOnly).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(pagesOnly).toContain('token:');
  });

  it('resolves every token it references against the template it ships', () => {
    // `resolveBindable` falls back to the literal string for a missing key, so
    // an unreferenced token silently sets body copy in a font called
    // "token:heading".
    const template = build([{ title: 'Position Summary', kind: 'bound', markdown: prose(2) }]);
    const used = new Set(
      [...JSON.stringify(template.pages).matchAll(/token:([a-zA-Z0-9_-]+)/g)].map((m) => m[1]),
    );
    const known = new Set([
      ...Object.keys(template.tokens.colors ?? {}),
      ...Object.keys(template.tokens.fonts ?? {}),
      ...Object.keys(template.tokens.spacing ?? {}),
    ]);
    for (const key of used) expect(known.has(key), `token:${key}`).toBe(true);
  });

  it('is deterministic — the same input builds the same template', () => {
    const chapters = [{ title: 'Position Summary', kind: 'bound' as const, markdown: prose(2) }];
    expect(JSON.stringify(build(chapters))).toBe(JSON.stringify(build(chapters)));
  });
});

describe('paginateProse', () => {
  it('breaks on paragraph boundaries', () => {
    const chunks = paginateProse(prose(20), 10);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.trim()).toBe(chunk);
  });

  it('cuts a single over-long paragraph rather than overflowing', () => {
    // One pasted fee schedule with no blank lines in it does this.
    const chunks = paginateProse('word '.repeat(4_000), 8);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('returns nothing for nothing', () => {
    expect(paginateProse('', 10)).toEqual([]);
    expect(paginateProse('   \n\n  ', 10)).toEqual([]);
  });
});
