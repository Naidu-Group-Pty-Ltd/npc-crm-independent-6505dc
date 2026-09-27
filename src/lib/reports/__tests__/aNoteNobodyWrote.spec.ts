/**
 * A numbered footnote marker with no note behind it is not printed.
 *
 * The 37 Bolin Street Compass and Due Diligence reports (27 Sep 2026) printed
 * "no opening date stated.[^6]" in body copy beside a Notes list of three.
 * `renderMarkdown` stripped an undefined marker only where its id was
 * citation-shaped (letter-led), so a numbered one survived as raw markup.
 */
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';

describe('a numbered marker the writer cited and never wrote', () => {
  const doc = [
    'Health Infrastructure reported early works, with no opening date stated.[^6]',
    '',
    'The school opens in 2027.[^1]',
    '',
    '[^1]: NSW Department of Education, accessed September 2026.',
  ].join('\n');

  it('is dropped where the document defines notes of its own, and the defined one still renders', () => {
    const { html, notices } = renderMarkdown(doc);
    expect(html).not.toContain('[^6]');
    expect(html).toContain('no opening date stated.');
    expect(html).toContain('<sup class="fn-ref">1</sup>');
    expect(notices.footnoteRefsDropped).toBe(1);
  });

  it('is left as written where the document has no notes at all', () => {
    const { html } = renderMarkdown('An array slice a[^2] in prose.');
    expect(html).toContain('a[^2]');
  });
});
