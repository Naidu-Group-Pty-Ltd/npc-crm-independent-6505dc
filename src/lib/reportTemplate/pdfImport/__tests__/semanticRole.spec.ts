/**
 * Keeping the source's own classification.
 *
 * Two rules carry the weight here. A label this module has not been taught
 * returns null rather than a default, because "body copy" asserted over an
 * unlabelled box is a classification nobody made — and the non-Docling import
 * paths emit no labels at all. And a heading tag is the ONLY thing that puts a
 * heading in the exported PDF's structure tree, so `headingTagFor` is the
 * decision the whole stage turns on.
 */
import { describe, it, expect } from 'vitest';
import {
  annotateFromSource,
  headingTagFor,
  figureAltText,
  MAX_HEADING_LEVEL,
  SEMANTIC_ANNOTATION_VERSION,
} from '../semanticRole.pure';

describe('annotateFromSource', () => {
  it.each([
    ['title', 'title'],
    ['section_header', 'heading'],
    ['paragraph', 'body'],
    ['text', 'body'],
    ['list_item', 'listItem'],
    ['caption', 'caption'],
    ['footnote', 'footnote'],
    ['page_header', 'pageHeader'],
    ['page_footer', 'pageFooter'],
    ['code', 'code'],
    ['formula', 'formula'],
    ['equation', 'formula'],
    ['picture', 'figure'],
    ['table', 'table'],
  ])('maps the Docling label %s to %s', (label, role) => {
    expect(annotateFromSource({ label })?.role).toBe(role);
  });

  it('stamps the version so a stored annotation can be re-read later', () => {
    expect(annotateFromSource({ label: 'title' })?.version).toBe(SEMANTIC_ANNOTATION_VERSION);
  });

  it('returns null for a label it has not been taught', () => {
    // A wrong role is worse than none: the renderer asserts it into the
    // document's structure and later stages restyle from it.
    for (const label of ['unknown_thing', '', '   ', undefined, null, 42, {}]) {
      expect(annotateFromSource({ label } as never)).toBeNull();
    }
    expect(annotateFromSource(null)).toBeNull();
    expect(annotateFromSource(undefined)).toBeNull();
  });

  it('tolerates the label arriving in a different case', () => {
    expect(annotateFromSource({ label: 'Section_Header' })?.role).toBe('heading');
    expect(annotateFromSource({ label: ' PAGE_FOOTER ' })?.role).toBe('pageFooter');
  });

  it('defaults a title to level 1 and a section header to level 2', () => {
    // A page can hold many section headers and only one can be the title.
    expect(annotateFromSource({ label: 'title' })?.headingLevel).toBe(1);
    expect(annotateFromSource({ label: 'section_header' })?.headingLevel).toBe(2);
  });

  it('keeps the level the source stated, clamped to what a document can express', () => {
    expect(annotateFromSource({ label: 'section_header', headingLevel: 4 })?.headingLevel).toBe(4);
    expect(annotateFromSource({ label: 'section_header', headingLevel: 0 })?.headingLevel).toBe(1);
    expect(annotateFromSource({ label: 'section_header', headingLevel: 99 })?.headingLevel)
      .toBe(MAX_HEADING_LEVEL);
    expect(annotateFromSource({ label: 'section_header', headingLevel: 2.6 })?.headingLevel).toBe(3);
    expect(annotateFromSource({ label: 'section_header', headingLevel: 'deep' })?.headingLevel).toBe(2);
  });

  it('carries a level only on the roles that can have one', () => {
    for (const label of ['paragraph', 'caption', 'page_footer', 'picture']) {
      expect(annotateFromSource({ label, headingLevel: 3 })).not.toHaveProperty('headingLevel');
    }
  });

  it('carries the source reading order, which paint order does not preserve', () => {
    expect(annotateFromSource({ label: 'text', readingOrder: 0 })?.readingOrder).toBe(0);
    expect(annotateFromSource({ label: 'text', readingOrder: 17 })?.readingOrder).toBe(17);
    expect(annotateFromSource({ label: 'text' })).not.toHaveProperty('readingOrder');
    expect(annotateFromSource({ label: 'text', readingOrder: -1 })).not.toHaveProperty('readingOrder');
    expect(annotateFromSource({ label: 'text', readingOrder: 'first' })).not.toHaveProperty('readingOrder');
  });

  it('carries the list grouping the source found', () => {
    expect(annotateFromSource({ label: 'list_item', listGroupId: 'l-3' })?.listGroupId).toBe('l-3');
    expect(annotateFromSource({ label: 'list_item', listGroupId: '' })).not.toHaveProperty('listGroupId');
    expect(annotateFromSource({ label: 'list_item', listGroupId: 7 })).not.toHaveProperty('listGroupId');
  });
});

describe('headingTagFor', () => {
  it('names the element WeasyPrint tags the structure tree from', () => {
    expect(headingTagFor(annotateFromSource({ label: 'title' }))).toBe('h1');
    expect(headingTagFor(annotateFromSource({ label: 'section_header' }))).toBe('h2');
    expect(headingTagFor(annotateFromSource({ label: 'section_header', headingLevel: 5 }))).toBe('h5');
  });

  it('is null for everything that is not a heading', () => {
    for (const label of ['paragraph', 'caption', 'footnote', 'page_header', 'page_footer', 'code', 'picture', 'table']) {
      expect(headingTagFor(annotateFromSource({ label })), label).toBeNull();
    }
    expect(headingTagFor(null)).toBeNull();
    expect(headingTagFor(undefined)).toBeNull();
  });

  it('never emits a tag a document cannot carry', () => {
    // Reached only by a hand-edited or migrated annotation; the level is
    // re-clamped rather than trusted, because `h0`/`h9` are not elements.
    expect(headingTagFor({ version: SEMANTIC_ANNOTATION_VERSION, role: 'heading', headingLevel: 0 })).toBe('h1');
    expect(headingTagFor({ version: SEMANTIC_ANNOTATION_VERSION, role: 'heading', headingLevel: 40 })).toBe('h6');
    expect(headingTagFor({ version: SEMANTIC_ANNOTATION_VERSION, role: 'heading' })).toBe('h2');
    expect(headingTagFor({ version: SEMANTIC_ANNOTATION_VERSION, role: 'title' })).toBe('h1');
  });
});

describe('figureAltText', () => {
  it('prefers the source\'s own description over its caption', () => {
    expect(figureAltText({ altText: 'Bar chart of income by source', caption: 'Figure 1' }))
      .toBe('Bar chart of income by source');
  });

  it('falls back to the caption, then to the classified kind', () => {
    expect(figureAltText({ caption: 'Figure 1 — income shading' })).toBe('Figure 1 — income shading');
    expect(figureAltText({ pictureClass: 'bar_chart' })).toBe('Bar chart');
    expect(figureAltText({ pictureClass: 'line-chart' })).toBe('Line chart');
  });

  it('never lets a classifier token beat a real description', () => {
    expect(figureAltText({ altText: 'The director\'s portrait', pictureClass: 'bar_chart' }))
      .toBe('The director\'s portrait');
  });

  it('refuses a caption that is only a number', () => {
    // Caption pairing falls back to the nearest caption-labelled block within
    // 36pt, and a chart's axis ticks sit exactly there. `"186,000"` names one
    // number and calls it a description — and Stage 2 sends it to `/Alt`, where
    // a screen reader reads it as the whole content of the figure.
    for (const caption of ['186,000', '$785,000', '97%', '2026', ' 8.65 ']) {
      expect(figureAltText({ caption }), caption).toBeNull();
      expect(figureAltText({ captionText: caption }), caption).toBeNull();
    }
    // …and still falls through to a detected kind when one is available.
    expect(figureAltText({ caption: '186,000', pictureClass: 'bar_chart' })).toBe('Bar chart');
  });

  it('keeps a caption that actually describes something', () => {
    expect(figureAltText({ caption: 'Figure 1 — income by source' }))
      .toBe('Figure 1 — income by source');
    expect(figureAltText({ caption: '2026 income by source' })).toBe('2026 income by source');
  });

  it('returns null rather than a placeholder', () => {
    // `[image]` satisfies a checker and tells a reader nothing, which is the
    // failure this stage exists to stop asserting.
    expect(figureAltText({})).toBeNull();
    expect(figureAltText(null)).toBeNull();
    expect(figureAltText({ altText: '   ', caption: '', pictureClass: '  ' })).toBeNull();
    expect(figureAltText({ altText: 42, caption: null } as never)).toBeNull();
  });
});
