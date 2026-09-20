import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import { packMarkdownPages } from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import { NARRATIVE_CHAPTER_SLOTS, headingText, runningChapters } from '../runningChapters.pure';
import { breakPoints, fitLines } from '../../../../supabase/functions/_shared/reportDesign/charts.pure';

const pack = (md: string, lines = 8) =>
  packMarkdownPages(renderMarkdown(md).blocks, lines);

describe('the chapter in force when a page opens', () => {
  it('names the chapter, not the document', () => {
    // The defect: `Part 08 · Report` through `Part 33 · Report` over a body
    // that moves through four unrelated chapters.
    const md = [
      '## Executive Verdict', 'A'.repeat(400), '', 'B'.repeat(400), '',
      '## Demand Drivers', 'C'.repeat(400), '', 'D'.repeat(400),
    ].join('\n');
    const chapters = runningChapters(pack(md, 6), 'Report');
    expect(new Set(chapters).size).toBeGreaterThan(1);
    expect(chapters[0]).toBe('Executive Verdict');
    expect(chapters[chapters.length - 1]).toBe('Demand Drivers');
  });

  it('carries a chapter forward across its continuation pages', () => {
    // A page of continuing prose belongs to the chapter that opened before it.
    // Printing nothing there would be worse than printing "Report".
    const md = ['## Zoning, Planning and Development Considerations',
      ...Array.from({ length: 8 }, (_, i) => `${'x'.repeat(300)} ${i}\n`)].join('\n');
    const chapters = runningChapters(pack(md, 4), 'Report');
    expect(chapters.length).toBeGreaterThan(2);
    for (const c of chapters) expect(c).toBe('Zoning, Planning and Development Considerations');
  });

  it('a page ending with a new heading keeps the chapter it spent its body in', () => {
    // The head names where the READER is on that page, and two lines of a new
    // heading at the foot is not where they have been.
    const md = ['## First', 'p'.repeat(600), '', '## Second', 'q'.repeat(600)].join('\n');
    const chapters = runningChapters(pack(md, 10), 'Report');
    expect(chapters[0]).toBe('First');
  });

  it('falls back before the first heading, and never prints a marker', () => {
    const chapters = runningChapters(pack('Opening prose with no heading at all.'), 'Investment Compass');
    expect(chapters).toEqual(['Investment Compass']);
    for (const c of chapters) expect(c).not.toMatch(/\{\{|\}\}/);
  });

  it('ignores a deep subsection — a running head is a chapter, not an H4', () => {
    const md = ['## Planning', 'a'.repeat(200), '', '#### A tiny aside', 'b'.repeat(200)].join('\n');
    expect(new Set(runningChapters(pack(md, 30), 'Report'))).toEqual(new Set(['Planning']));
  });

  it('falls back rather than setting a heading too long for a running head', () => {
    const long = `## ${'Very long chapter title '.repeat(6)}`;
    const chapters = runningChapters(pack(`${long}\n\nbody`, 30), 'Report');
    expect(chapters[0]).toBe('Report');
  });

  it('reads the heading\'s words, with inline markup and entities resolved', () => {
    // With a body under it: `renderMarkdown` drops a heading that promises
    // analysis the page does not deliver, which is a rule of its own.
    const [h] = renderMarkdown('## **Risk** & *Return*\n\nSome prose.').blocks;
    expect(headingText(h)).toBe('Risk & Return');
  });

  it('an empty packing yields no chapters rather than one empty string', () => {
    expect(runningChapters([], 'Report')).toEqual([]);
  });
});

describe('it travels the same route as the page count', () => {
  it('the projection publishes an estimate beside `pages`', () => {
    const src = readFileSync('supabase/functions/_shared/reportBindingProjection.pure.ts', 'utf8');
    // Padded to the masters' declared allowance, with the document's own name
    // as the pad — an empty string is indistinguishable from an unresolved
    // binding, which is exactly what `reportBindingProjection.spec.ts` counts.
    expect(src).toContain("runningChapters(packed, fallbackChapter, NARRATIVE_CHAPTER_SLOTS)");
    expect(src).toContain('projectReportNarrative(row.report_content, undefined, identity.title)');
    // Packed ONCE. Two packings of one source is how a count and a head
    // disagree about which page a chapter starts on.
    expect(src.match(/packNarrativePages\(blocks, profile, linesPerPage\)/g)).toHaveLength(1);
  });

  it('the pre-pass overwrites it at the template\'s own geometry', () => {
    const src = readFileSync('src/lib/reportTemplate/narrativePlan.ts', 'utf8');
    expect(src).toContain('writes[`${nsPath}.chapters`] = runningChapters(finalPages');
    // Written where the true page count is written, in the same pass.
    const count = src.indexOf('writes[pagesPath] = count;');
    const chapters = src.indexOf('.chapters`] = runningChapters');
    expect(chapters).toBeGreaterThan(count);
  });
});

describe('the master binds it, and drops the heading that said nothing', () => {
  const src = readFileSync('scripts/template-library/investmentCompass/templates.ts', 'utf8');

  /*
   * This assertion passed while 39 of the 50 masters drew `Part 05 · Report`
   * on every page of the body.
   *
   * `furniture()` branches on `navigation_style`: a RAILED family draws the
   * part and the section, and a RUNNING-HEAD family draws the part and
   * DISCARDS the section. So the chapter was passed in on all fifty and drawn
   * on eleven, and a source-level check of the call site could not see the
   * difference — the argument is there, and on 39 masters it goes nowhere.
   *
   * The call sites still carry it, and are still checked here, because the
   * railed half reads it. What a source string cannot vouch for is now
   * asserted against the BUILT masters, in
   * `templateLibrary/__tests__/runningHeadFitsTheChapter.spec.ts`: that every
   * master names the chapter by one route or the other, and that the marker
   * fits the two lines the rule reserves.
   */
  it('the running head takes the chapter rather than the word "Report"', () => {
    expect(src).toContain("furniture(DOCUMENT_LABEL, reportPart, '{{narrative.chapters.0}}', reportChapter(0))");
    expect(src).toContain('furniture(DOCUMENT_LABEL, reportPart, `{{narrative.chapters.${i}}}`, reportChapter(i))');
    expect(src).not.toContain("furniture(DOCUMENT_LABEL, reportPart, 'The report')");
    /*
     * The running-head half is the chapter ALONE.
     *
     * The first version of this passed the part number as a prefix, which
     * fixed the 29 pages reading `Part 05 · Report` and produced 26 pages
     * reading `Part 07 · <chapter>` instead. The body is one part, so across
     * it the part number says where you are twenty-six times and says nothing;
     * the chapter says it once per chapter. The part structure is on the
     * contents page, which is where it varies.
     */
    expect(src).toContain('const reportChapter = (i: number): string => `{{narrative.chapters.${i}}}`;');
    expect(src).not.toContain("`${reportPart.split(' · ')[0]} · {{narrative.chapters.${i}}}`");
  });

  it('the body no longer opens on a heading naming the document', () => {
    expect(src).not.toContain("heading: 'The report',");
  });

  it('the first page and the continuations state one box, not two', () => {
    expect(src).toContain('const narrativeHeight = remainingAfter([], contentTop());');
  });
});

describe('a chart label breaks at a hyphen rather than being cut mid-word', () => {
  // Page 9 of the Cowra Compass printed `Agriculture-dominat…` in a tile.
  // `fitLines` split on whitespace only, so a hyphenated compound was ONE
  // token that never wrapped and got truncated at the end of the function.
  it('breaks a hyphenated compound and keeps the hyphen on the first line', () => {
    const lines = fitLines('Agriculture-dominated', 100, 5, 2);
    expect(lines.join('')).not.toContain('…');
    expect(lines.join('')).toBe('Agriculture-dominated');
    expect(lines[0].endsWith('-')).toBe(true);
  });

  it('never breaks a numeric range, which would turn one range into two numbers', () => {
    expect(breakPoints('2025-26')).toEqual(['2025-26']);
    expect(breakPoints('3-5y')).toEqual(['3-5y']);
    // With room for it, it sets on one line rather than across two.
    expect(fitLines('2025-26', 60, 5, 2)).toEqual(['2025-26']);
  });

  it('breaks a slashed pair the same way', () => {
    expect(breakPoints('Land/Building')).toEqual(['Land/', 'Building']);
  });

  it('a piece after a break joins with no space — it is one word, broken', () => {
    expect(fitLines('cost-effective housing', 200, 5, 2).join(' ')).toContain('cost-effective');
  });

  it('a genuinely over-long single word still truncates rather than overrunning', () => {
    const [line] = fitLines('Supercalifragilisticexpialidocious', 20, 5, 1);
    expect(line.endsWith('…')).toBe(true);
  });

  it('plain whitespace wrapping is unchanged', () => {
    expect(breakPoints('Regional service hub')).toEqual(['Regional', 'service', 'hub']);
  });
});

describe('the slots the catalogue binds all have a source', () => {
  it('pads to the masters\' allowance, because an unbound index is a defect', () => {
    // The Compass masters declare 40 conditional body pages, so the catalogue
    // binds `narrative.chapters.0` … `.39`. A path a master binds and a real
    // row cannot answer is what `reportBindingProjection.spec.ts` exists to
    // catch, and its own history says the answer is to give the index a source
    // or stop binding it. Here the first is right: a page past the body's end
    // never draws, so the slot costs nothing.
    const short = pack('## Only Chapter\n\nOne short paragraph.', 40);
    expect(short.length).toBe(1);
    const padded = runningChapters(short, 'Investment Compass', NARRATIVE_CHAPTER_SLOTS);
    expect(padded).toHaveLength(NARRATIVE_CHAPTER_SLOTS);
    expect(padded[0]).toBe('Only Chapter');
    // Every pad is the document's own name — never the empty string, which is
    // indistinguishable from an unresolved binding to anything that counts them.
    for (const c of padded.slice(1)) expect(c).toBe('Investment Compass');
  });

  it('without a slot count it is exactly one entry per packed page', () => {
    const pages = pack('## A\n\n' + 'x'.repeat(600) + '\n\n## B\n\n' + 'y'.repeat(600), 6);
    expect(runningChapters(pages, 'Report')).toHaveLength(pages.length);
  });

  it('never truncates a body longer than the allowance', () => {
    const many = Array.from({ length: 12 }, (_, i) => `## Chapter ${i}\n\n${'z'.repeat(400)}`).join('\n\n');
    const pages = pack(many, 4);
    expect(pages.length).toBeGreaterThan(3);
    expect(runningChapters(pages, 'Report', 3)).toHaveLength(pages.length);
  });
});
