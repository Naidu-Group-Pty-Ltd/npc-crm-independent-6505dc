/**
 * The contents page names the report's SECTIONS, not the master's page slots.
 *
 * `ctx.pages` carries the master's own page names, so a Compass contents page
 * listed "The report", "The report (2)" … twenty-two times — a page archetype
 * repeated, which tells a reader looking for Planning nothing at all. The real
 * sections are headings inside the flowing narrative, and where each one lands
 * is not knowable until it has been packed against the template's geometry.
 *
 * It is knowable then, and from what the packer already produced: this walks
 * the buckets it returned. Exercised against markdown put through the real
 * renderer rather than hand-written HTML, because the point is to read what
 * the pipeline emits — a hand-written `<h2>` would pass while the real one
 * changed shape underneath it.
 */
import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import {
  packMarkdownPages,
  sectionIndexFromBuckets,
} from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';

const SOURCE = [
  '# Location Overview',
  '',
  'Kellyville sits on the Sydney Metro Northwest corridor.',
  '',
  '## Transport and access',
  '',
  'The nearest station is a measured distance rather than a claim.',
  '',
  '## **Planning** controls',
  '',
  'The instrument is named by the register that answered.',
  '',
  '# Market Analysis',
  '',
  'Median prices come from the open-data register.',
].join('\n');

const index = (linesPerPage: number) =>
  sectionIndexFromBuckets(packMarkdownPages(renderMarkdown(SOURCE).blocks, linesPerPage));

describe('the sections a packed narrative actually holds', () => {
  it('names every heading, in the order it is set', () => {
    expect(index(500).map((s) => s.label)).toEqual([
      'Location Overview',
      'Transport and access',
      'Planning controls',
      'Market Analysis',
    ]);
  });

  it('reads the level the rendered heading carries', () => {
    const levels = index(500).map((s) => s.level);
    expect(levels[0]).toBeLessThan(levels[1]);
    expect(levels[0]).toBe(levels[3]);
  });

  it('takes the words that printed, not the source line', () => {
    // `## **Planning** controls` prints "Planning controls". The emphasis
    // carried the words; it is not part of them.
    const planning = index(500).find((s) => s.label.startsWith('Planning'));
    expect(planning?.label).toBe('Planning controls');
    expect(planning?.label).not.toContain('*');
    expect(planning?.label).not.toContain('<');
  });

  it('carries the heading’s own id, so an entry lands on the section', () => {
    for (const s of index(500)) {
      expect(s.id).toBeTruthy();
      // The id the renderer minted, present in the html it emitted.
      expect(renderMarkdown(SOURCE).blocks.some((b) => b.html.includes(`id="${s.id}"`))).toBe(true);
    }
  });

  it('answers in buckets, because only the renderer knows the page', () => {
    // Packed tight, the sections spread across buckets; packed loose they do
    // not. Either way the number is a bucket and the caller maps it.
    const tight = index(4);
    const loose = index(500);
    expect(Math.max(...loose.map((s) => s.bucket))).toBe(0);
    expect(Math.max(...tight.map((s) => s.bucket))).toBeGreaterThan(0);
    // No section is invented or lost by packing differently.
    expect(tight.map((s) => s.label)).toEqual(loose.map((s) => s.label));
  });

  it('is empty for a narrative with no headings, rather than inventing one', () => {
    const plain = renderMarkdown('Just a paragraph, and then another one.').blocks;
    expect(sectionIndexFromBuckets(packMarkdownPages(plain, 500))).toEqual([]);
  });
});
