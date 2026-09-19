/**
 * Blank pages in the read-only viewer.
 *
 * The reported symptom was a completed 14-page guide showing as "Page 1 of 27"
 * with sheets of white between the content. Two things caused it and both are
 * covered here:
 *
 *  1. the renderer was told to honour Word's cached `lastRenderedPageBreak`
 *     hints, which are a record of where Word once happened to break the text —
 *     not authored breaks. Combined with the document's 13 real breaks they
 *     produced 31 break points and 27 pages; and
 *  2. nothing filtered out a page that ended up with no content on it.
 */

import { describe, expect, it } from 'vitest';
import { removeEmptyPages } from '../viewer/wordToHtml';

function stage(pages: string[]): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = pages
    .map((inner) => `<section class="docx">${inner}</section>`)
    .join('');
  return container;
}

const HEADER = '<header class="docx-header"><p>Running header</p></header>';
const FOOTER = '<footer class="docx-footer"><p>Page 1</p></footer>';

describe('removeEmptyPages', () => {
  it('drops a page carrying only a header and footer', () => {
    const container = stage([
      `${HEADER}<article><p>Real content</p></article>${FOOTER}`,
      `${HEADER}${FOOTER}`,
    ]);

    expect(removeEmptyPages(container)).toBe(1);
    expect(container.querySelectorAll('section.docx')).toHaveLength(1);
    expect(container.textContent).toContain('Real content');
  });

  it('drops a page whose only content is whitespace', () => {
    // An empty paragraph is still a paragraph; it is not content.
    const container = stage(['<article><p>  </p><p></p></article>']);
    expect(removeEmptyPages(container)).toBe(1);
    expect(container.querySelectorAll('section.docx')).toHaveLength(0);
  });

  it('keeps a page whose content is a table with no text', () => {
    // A signature block is ruled boxes and nothing else. Removing it would take
    // out the page a reader most wants to see.
    const container = stage(['<article><table><tr><td></td></tr></table></article>']);
    expect(removeEmptyPages(container)).toBe(0);
    expect(container.querySelectorAll('section.docx')).toHaveLength(1);
  });

  it('keeps a page whose content is an image', () => {
    const container = stage(['<article><img src="data:," alt=""></article>']);
    expect(removeEmptyPages(container)).toBe(0);
  });

  it('leaves a document with no empty pages alone', () => {
    const container = stage([
      `${HEADER}<article><p>One</p></article>${FOOTER}`,
      `${HEADER}<article><p>Two</p></article>${FOOTER}`,
    ]);
    expect(removeEmptyPages(container)).toBe(0);
    expect(container.querySelectorAll('section.docx')).toHaveLength(2);
  });
});
