/**
 * Which sections a page of the preview carries.
 *
 * Found in a real browser against the owner's answer (30 Sep 2026): page 9
 * opens on the end of the suburb shortlist — its running head says so — and
 * the financial framework starts halfway down it. The caption named only the
 * section that STARTS on the page, so "Edit this section" beside the
 * shortlist's own table led to the wrong words. A page names everything it
 * carries, and everything the document bookmarks ends what came before it.
 */
import { describe, expect, it } from 'vitest';
import { placeSections, sectionsOnPage, TOP_BAND } from '../previewSections';

/** The owner's sixteen-page answer, as the document's own bookmarks place it. */
const OUTLINE = [
  { title: 'Contents', page: 2, top: 0.08 },
  { title: 'Executive Summary', page: 3, top: 0.1 },
  { title: 'Client Investment Mandate', page: 4, top: 0.1 },
  { title: 'Recommended Acquisition Strategy', page: 4, top: 0.62 },
  { title: 'Market Priority and Suburb Research Shortlist', page: 5, top: 0.1 },
  { title: 'Financial Assessment Framework', page: 9, top: 0.55 },
  { title: 'Next Steps', page: 14, top: 0.1 },
  { title: 'Important information', page: 16, top: 0.1 },
];
const SECTIONS = [
  'Executive Summary',
  'Client Investment Mandate',
  'Recommended Acquisition Strategy',
  'Market Priority and Suburb Research Shortlist',
  'Financial Assessment Framework',
  'Next Steps',
];

const places = placeSections(SECTIONS, OUTLINE);
const on = (page: number) => sectionsOnPage(places, OUTLINE, page).map((p) => p.title);

describe('placeSections', () => {
  it('places each section by its own bookmark, and leaves one the document does not mark unplaced', () => {
    expect(places.map((p) => [p.page, p.top])).toEqual([[3, 0.1], [4, 0.1], [4, 0.62], [5, 0.1], [9, 0.55], [14, 0.1]]);
    const missing = placeSections(['Executive Summary', 'An appendix nobody bookmarked'], OUTLINE);
    expect(missing[1]).toMatchObject({ page: null, top: null, outlineIndex: null });
  });

  it('matches in order, so a title used twice is placed at each of its own pages', () => {
    const outline = [
      { title: 'Notes', page: 3, top: 0.1 },
      { title: 'Body', page: 4, top: 0.1 },
      { title: 'notes', page: 7, top: 0.1 },
    ];
    expect(placeSections(['Notes', 'Body', 'Notes'], outline).map((p) => p.page)).toEqual([3, 4, 7]);
  });

  it('reads a title the same through case and spacing', () => {
    expect(placeSections(['  next   steps '], OUTLINE)[0].page).toBe(14);
  });
});

describe('sectionsOnPage', () => {
  it('names no section on the cover or the contents page', () => {
    expect(on(1)).toEqual([]);
    expect(on(2)).toEqual([]);
  });

  it('gives a page to the section that starts in its top band', () => {
    expect(on(3)).toEqual(['Executive Summary']);
    expect(on(5)).toEqual(['Market Priority and Suburb Research Shortlist']);
  });

  it('names both halves of a page a section starts part-way down', () => {
    expect(on(4)).toEqual(['Client Investment Mandate', 'Recommended Acquisition Strategy']);
    expect(on(9)).toEqual(['Market Priority and Suburb Research Shortlist', 'Financial Assessment Framework']);
  });

  it('carries a section over the pages it runs on to', () => {
    expect(on(7)).toEqual(['Market Priority and Suburb Research Shortlist']);
    expect(on(12)).toEqual(['Financial Assessment Framework']);
  });

  it('ends the last section at the closing page, which is nobody\'s section', () => {
    expect(on(15)).toEqual(['Next Steps']);
    expect(on(16)).toEqual([]);
  });

  it('names what runs on as well where a bookmark does not say how far down it points', () => {
    const outline = [...OUTLINE];
    outline[5] = { ...outline[5], top: null };
    const unplaced = placeSections(SECTIONS, outline);
    expect(sectionsOnPage(unplaced, outline, 9).map((p) => p.title))
      .toEqual(['Market Priority and Suburb Research Shortlist', 'Financial Assessment Framework']);
  });

  it('draws the top band where a section heading sits under the running head', () => {
    expect(TOP_BAND).toBeGreaterThan(0.1);
    expect(TOP_BAND).toBeLessThan(0.3);
  });
});
