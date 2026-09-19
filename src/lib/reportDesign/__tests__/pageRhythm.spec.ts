/**
 * Four rules about where a page may break, each written for the render that
 * showed it was needed.
 *
 * None of these were visible in a test before, and none of them is a rule about
 * *content* — they are all "the reader turns the page and finds a fault". They
 * are here rather than in a format's own spec because three of the four are in
 * shared print primitives that every format goes through.
 */
import { describe, expect, it } from 'vitest';

import { buildReportCss } from '../css.pure';
import { renderCompanyPage, renderContentsPage, renderCover } from '../primitives.pure';
import { resolveReportPalette } from '../brandResolve.pure';
import { LOCKUP_LEAD_CHARS, splitCompanyName } from '../companyBlock.pure';

const sheet = () => buildReportCss({ palette: resolveReportPalette(), masthead: 'Acme' });
const entry = (n: number) => ({
  number: String(n).padStart(2, '0'),
  title: `Section ${n}`,
  note: 'A note of about the length these carry in a real report.',
});

describe('a contents page does not strand its last entry', () => {
  it('splits evenly rather than filling the first sheet', () => {
    // Fourteen entries put thirteen rows on one sheet and the fourteenth alone
    // on the next, at 0.2% ink, on a named page that carries no running head —
    // page three of a twenty-two page report was one line under nothing.
    const html = renderContentsPage('Contents', Array.from({ length: 14 }, (_, i) => entry(i + 1)), 11);
    const sheets = html.split('page-contents').length - 1;
    expect(sheets).toBe(2);
    const rows = html.split('page-contents').slice(1).map((s) => s.split('toc-row').length - 1);
    expect(rows).toEqual([7, 7]);
  });

  it('gives every sheet its own heading, so a continuation is not anonymous', () => {
    const html = renderContentsPage('Contents', Array.from({ length: 14 }, (_, i) => entry(i + 1)), 11);
    expect(html.split('<h1>').length - 1).toBe(2);
  });

  it('is one sheet, unchanged, when it fits', () => {
    const html = renderContentsPage('Contents', [entry(1), entry(2)], 11);
    expect(html.split('page-contents').length - 1).toBe(1);
    expect(html.split('toc-row').length - 1).toBe(2);
  });

  it('is one sheet when no cap is given, which is every other format', () => {
    const html = renderContentsPage('Contents', Array.from({ length: 30 }, (_, i) => entry(i + 1)));
    expect(html.split('page-contents').length - 1).toBe(1);
  });
});

describe('the cover meta row wraps rather than squeezing', () => {
  /**
   * Four entries took every column below its content width and three of the
   * four broke, including `04 August 2026` set as `04 August` over `2026`. A
   * date that wraps is the kind of thing a reader registers as sloppiness
   * before they have read a word, and it is on the cover.
   */
  it('separates its rows, so a second one is not welded to the first', () => {
    // Still a table. The flat sheet's layout model is tables rather than
    // flexbox — `reportCss.spec.ts` holds it to that, and a cover is not the
    // place to make the exception. What changed is that there can now be more
    // than one row, and rows need vertical spacing.
    const css = sheet();
    expect(css).toMatch(/\.report-cover \.cover-meta \{[^}]*display: table/);
    expect(css).toMatch(/\.report-cover \.cover-meta \{[^}]*border-spacing: 7mm 5mm/);
    expect(css).toMatch(/\.report-cover \.cover-meta \.meta-row \{[^}]*display: table-row/);
  });

  const cover = (n: number) => renderCover({
    eyebrow: 'e',
    title: 't',
    masthead: 'm',
    meta: Array.from({ length: n }, (_, i) => ({ label: `L${i}`, value: `V${i}` })),
  });

  it('puts at most three entries on a row', () => {
    const rows = (n: number) => cover(n).split('meta-row').length - 1;
    expect(rows(3)).toBe(1);
    expect(rows(4)).toBe(2);
    expect(rows(6)).toBe(2);
    expect(rows(7)).toBe(3);
  });

  it('balances the rows rather than filling the first', () => {
    // Four entries set 2 + 2, not 3 + 1: a row with one cell in a three-column
    // table occupies one column and reads as a stray.
    const perRow = cover(4).split('meta-row').slice(1)
      .map((s) => s.split('meta-item').length - 1);
    expect(perRow).toEqual([2, 2]);
  });

  it('still prints every entry it was given, however many', () => {
    // Wrapping rather than dropping: a cover that silently loses its fourth
    // fact is a worse answer than one that runs to a second row.
    const meta = [
      { label: 'Document', value: '10 Year Cash Flow Analysis' },
      { label: 'Bound to', value: 'Borrowing Capacity Snapshot' },
      { label: 'Prepared on', value: '04 August 2026' },
      { label: 'Design system', value: 'NPC Services Design System' },
    ];
    const html = renderCover({ eyebrow: 'e', title: 't', masthead: 'm', meta });
    for (const m of meta) expect(html).toContain(m.value);
    expect(html.split('meta-item').length - 1).toBe(meta.length);
  });
});

describe('the closing wordmark fits on its line', () => {
  /**
   * `NAIDU PROPERTY CONSULTING SERVICES` set `NAIDU PROPERTY CONSULTING` across
   * two display lines with `SERVICES` beneath it in small letterspaced caps —
   * which does not read as a lockup, it reads as a title that ran out of room
   * with a subtitle bolted on. The rule was "everything but the last word",
   * which is right for the three-word name it was written for.
   */
  it('takes as many whole words as fit, not all but one', () => {
    expect(splitCompanyName('Naidu Property Consulting Services'))
      .toEqual({ lead: 'NAIDU PROPERTY', tail: 'CONSULTING SERVICES' });
  });

  it('leaves the three-word convention exactly as it was', () => {
    expect(splitCompanyName('NPC Property Services'))
      .toEqual({ lead: 'NPC PROPERTY', tail: 'SERVICES' });
    expect(splitCompanyName('Tenant Advisory'))
      .toEqual({ lead: 'TENANT', tail: 'ADVISORY' });
  });

  it('has no tail for a single word', () => {
    expect(splitCompanyName('Meridian')).toEqual({ lead: 'MERIDIAN', tail: null });
  });

  it('keeps the lead on one line for every name it can', () => {
    for (const name of [
      'Naidu Property Consulting Services',
      'NPC Property Services',
      'Harbour and Vale Buyers Advocacy Group',
      'Kestrel Buyers Agency',
    ]) {
      expect(splitCompanyName(name).lead.length, name).toBeLessThanOrEqual(LOCKUP_LEAD_CHARS);
    }
  });

  it('would rather overrun than print nothing, when one word is already too long', () => {
    const { lead, tail } = splitCompanyName('Kirribeckenwellington Advisory');
    expect(lead).toBe('KIRRIBECKENWELLINGTON');
    expect(tail).toBe('ADVISORY');
  });
});

describe('the closing page does not print the firm’s name twice', () => {
  const block = (name: string) => ({
    name: splitCompanyName(name),
    rows: [{ label: 'ABN', value: '11 222 333 444' }],
    disclaimer: { paragraphs: [], fontPt: 8 },
  });

  it('drops a wordmark-only lockup that echoes the wordmark below it', () => {
    // Read off a closing page: `TENANT ADVISORY` in small letterspaced caps,
    // then `TENANT` over `ADVISORY` as the display lockup 20mm underneath. On
    // the one page that is nothing but the brand.
    const html = renderCompanyPage({
      block: block('Tenant Advisory') as never,
      lockup: { wordmark: 'Tenant Advisory' },
    });
    expect(html).not.toContain('lockup-text');
    expect(html).toContain('company-name');
  });

  it('keeps the lockup when it carries a mark — the image is the point', () => {
    const html = renderCompanyPage({
      block: block('Tenant Advisory') as never,
      lockup: { wordmark: 'Tenant Advisory', markDataUri: 'data:image/png;base64,AA==', markAlt: 'Tenant Advisory' },
    });
    expect(html).toContain('lockup-mark');
  });

  it('keeps a lockup that says something different', () => {
    const html = renderCompanyPage({
      block: block('Tenant Advisory') as never,
      lockup: { wordmark: 'A Meridian Company' },
    });
    expect(html).toContain('A Meridian Company');
  });
});

describe('there is no keep-together beyond the heading', () => {
  it('does not group a heading with its first two blocks', () => {
    // Tried, and reverted on the evidence of a render: the group it creates is
    // often a chapter's tail, and a tail that no longer fits moves to a sheet
    // of its own — a subhead and two lines alone at 1.1% ink, more visible than
    // the late-opening section it was fixing. The condition that separates the
    // two cases is "unless this would strand the group", which CSS cannot ask.
    const css = sheet();
    expect(css).not.toMatch(/h2 \+ p[^{]*\{[^}]*break-after: avoid/);
  });

  it('still keeps a heading with the box after it', () => {
    // The pre-existing rule, and the one that pays for itself.
    expect(sheet()).toMatch(/h1, h2, h3 \{[^}]*page-break-after: avoid/);
  });
});
