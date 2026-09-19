import { describe, expect, it } from 'vitest';
import {
  collectFootnoteDefinitions,
  footnoteText,
} from '../../../../../supabase/functions/render-investment-report-pdf/footnotes';

/**
 * `render-investment-report-pdf` returned 500 on every report that had a
 * footnote.
 *
 * `span.footnote { float: footnote }` *moves* the note into the page's footnote
 * area, and WeasyPrint 69 lays that relocated text out without collapsing the
 * newlines Markdown left in it — so a body carrying a space immediately before
 * a newline reaches `split_text_box` as a break the engine refuses:
 *
 *     render_failed: Got ' \n' between two lines.
 *                    Expected nothing or a preserved line break
 *
 * Nothing in the report stylesheet is preserved-whitespace, which is why the
 * error reads as impossible. The strings below are the shape production
 * actually produces rather than a convenient one: the generator writes the
 * definitions one per line, each ending with a trailing space, and Markdown
 * joins consecutive lines into a single paragraph. That pair is the defect.
 *
 * Measured on 15 Aug 2026: the two reports carrying footnotes (11 definitions
 * each) 500'd on every attempt; the three without one rendered on the same
 * deployment, minutes apart.
 */
describe('investment report footnotes', () => {
  it('never lets a newline reach the relocated footnote', () => {
    expect(footnoteText('ABS Census 2021 QuickStats. \nRetrieved May 2026.')).toBe(
      'ABS Census 2021 QuickStats. Retrieved May 2026.',
    );
    // Two trailing spaces is Markdown's hard break, and the same hazard here.
    expect(footnoteText('Tweed Shire profile.  \n  Second line.')).toBe(
      'Tweed Shire profile. Second line.',
    );
    expect(footnoteText('  padded \r\n body  ')).toBe('padded body');
  });

  it('keeps every definition in a run, not just the first', () => {
    const html =
      '<p>[^pop1]: ABS Census 2021 QuickStats for Banora Point. \n' +
      '[^pop2]: CityPopulation.de statistical area series. \n' +
      '[^hh1]: Tweed Shire Council dwellings profile. </p>';
    const { html: remaining, defs } = collectFootnoteDefinitions(html);

    expect(remaining).toBe('');
    // Before the split, `pop1` swallowed the other two and their calls — which
    // resolve to nothing and are dropped — left the document silently.
    expect([...defs.keys()]).toEqual(['pop1', 'pop2', 'hh1']);
    expect(defs.get('pop1')).toBe('ABS Census 2021 QuickStats for Banora Point.');
    expect(defs.get('hh1')).toBe('Tweed Shire Council dwellings profile.');
    for (const body of defs.values()) expect(body).not.toMatch(/\n/);
  });

  it('leaves prose paragraphs alone', () => {
    const html = '<p>Population grew steadily over two decades.</p>';
    const { html: remaining, defs } = collectFootnoteDefinitions(html);
    expect(remaining).toBe(html);
    expect(defs.size).toBe(0);
  });

  it('reads a lone definition the same way', () => {
    const { defs } = collectFootnoteDefinitions('<p>[^only]: A single source. </p>');
    expect(defs.get('only')).toBe('A single source.');
  });
});
