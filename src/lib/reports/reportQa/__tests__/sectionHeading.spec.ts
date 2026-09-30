/**
 * From a page of the preview to the words that made it.
 *
 * The export dialog's Preview lists the document's sections by their PRINTED
 * titles, and "Edit this section" takes the person to that section's heading
 * in the editor (`findSectionHeading`). A printed title is not the heading's
 * text: the answer's own number comes off where it is the chapter's number,
 * an exchange's question is clipped, emphasis and links are read to their
 * words. So the finder is proved against the renderer's own plan rather than
 * against titles typed here — a title this finder cannot find is a button
 * that does nothing.
 */
import { describe, expect, it } from 'vitest';
import { findSectionHeading, planFromMarkdown, turnTitle } from '../sections.pure';
import { renderMarkdown } from '../markdown.pure';

/** The line a found range covers. */
const lineAt = (markdown: string, title: string): string | null => {
  const at = findSectionHeading(markdown, title);
  return at ? markdown.slice(at.start, at.end) : null;
};

describe('findSectionHeading', () => {
  it('returns the heading line itself, as character offsets into the text', () => {
    const text = '# Title\n\nOpening words.\n\n## Market position\n\nBody.';
    const at = findSectionHeading(text, 'Market position');
    expect(at).toEqual({ start: text.indexOf('## Market'), end: text.indexOf('## Market') + '## Market position'.length });
  });

  it('finds a heading whose number the printed title dropped', () => {
    const text = '## 1. Executive summary\n\nA.\n\n## 2. Client investment mandate\n\nB.';
    expect(lineAt(text, 'Client investment mandate')).toBe('## 2. Client investment mandate');
    expect(lineAt(text, 'Section 2: Client investment mandate')).toBe('## 2. Client investment mandate');
  });

  it('reads emphasis, a link and closing hashes to the words the page prints', () => {
    expect(lineAt('## **Executive summary**\n\nA.', 'Executive summary')).toBe('## **Executive summary**');
    // A link is printed as the parser reads it, and found by that reading.
    const linked = '### [Market outlook](https://example.com/x)\n\nA.';
    const printed = renderMarkdown(linked, { idPrefix: 'x' }).headings[0].text;
    expect(lineAt(linked, printed)).toBe('### [Market outlook](https://example.com/x)');
    expect(lineAt('## Risks ##\n\nA.', 'Risks')).toBe('## Risks ##');
    // A closing hash needs a space before it, as the parser reads it.
    expect(lineAt('## Pricing in C#\n\nA.', 'Pricing in C#')).toBe('## Pricing in C#');
  });

  it('finds a heading underlined rather than hashed', () => {
    expect(lineAt('Overview\n========\n\nA.', 'Overview')).toBe('Overview');
    expect(lineAt('Intro.\n\nNext steps\n----------\n\nB.', 'Next steps')).toBe('Next steps');
  });

  it('matches a clipped title by what it begins with', () => {
    const question = 'Which of the three suburbs on the shortlist carries the lowest vacancy risk over the next five years, given current approvals?';
    const printed = turnTitle(question, 0);
    expect(printed.endsWith('…')).toBe(true);
    expect(lineAt(`## ${question}\n\nAnswer.`, printed)).toBe(`## ${question}`);
  });

  it('never takes a sentence that merely says the words', () => {
    const text = 'The executive summary follows.\n\nExecutive summary is below.\n\n## Executive summary\n\nA.';
    expect(lineAt(text, 'Executive summary')).toBe('## Executive summary');
  });

  it('takes the first heading that says it, and nothing where none does', () => {
    const text = '## Notes\n\nA.\n\n## Notes\n\nB.';
    expect(findSectionHeading(text, 'Notes')).toEqual({ start: 0, end: '## Notes'.length });
    expect(findSectionHeading(text, 'Appendix')).toBeNull();
    expect(findSectionHeading(text, '   ')).toBeNull();
  });

  it('finds every chapter the renderer prints, in an answer written the way the owner\'s was', () => {
    // Section 1 at `##`, the rest at `#`, a preface, a sub-list numbered
    // afresh, emphasis in one heading and an underlined one — every shape
    // the plan has to read (`withNumberedStragglers`).
    const body = [
      'A short preface before any heading.',
      '',
      '## 1. Executive Summary',
      '',
      'Summary.',
      '',
      '# 2. **Client Investment Mandate**',
      '',
      'Mandate.',
      '',
      '### 1. Option A',
      '',
      'A.',
      '',
      '# 3. Suburb Shortlist',
      '',
      'Shortlist.',
      '',
      '# 4. Risks and Mitigations',
      '',
      'Risks.',
    ].join('\n');
    const plan = planFromMarkdown(renderMarkdown(body, { idPrefix: 'x' }), 'The report', 'x', { continuous: true });
    const titles = plan.chapters.map((c) => c.title);
    expect(titles).toEqual(['Executive Summary', 'Client Investment Mandate', 'Suburb Shortlist', 'Risks and Mitigations']);
    for (const title of titles) {
      expect(findSectionHeading(body, title), title).not.toBeNull();
    }
    expect(lineAt(body, 'Client Investment Mandate')).toBe('# 2. **Client Investment Mandate**');
  });
});
