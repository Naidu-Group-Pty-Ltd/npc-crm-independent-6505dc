/**
 * The section summary, set as a key rather than a box of dingbats.
 *
 * The Investment Compass issued for 97 Poole Road on 20 Sep 2026 drew twelve
 * washed, left-ruled boxes of raw `✓ ⚠ ◆ ★`, three of them on page 28 and
 * three more on page 29. The rules this file pins:
 *
 *  - the glyph is an INPUT vocabulary and never reaches the page;
 *  - the meaning is a WORD first and a colour second, so it survives
 *    greyscale, a screen reader and a reader who has not been told the key;
 *  - an unrecognised marker is `context`, never a dropped finding;
 *  - it is a `<ul>` of `<li>`, because `render-template-pdf` asks WeasyPrint
 *    for `pdf/ua-1` and the structure tree is built from element names.
 */
import { describe, expect, it } from 'vitest';
import {
  GLANCE_TAG,
  glanceRows,
  glanceTone,
  renderGlanceStrip,
} from '@/lib/reports/glanceStrip.pure';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('the glyph is read, not printed', () => {
  it.each([
    ['✓', 'strength'], ['✔', 'strength'], ['☑', 'strength'],
    ['⚠', 'watch'], ['▲', 'watch'], ['✗', 'watch'],
    ['★', 'verdict'], ['➤', 'verdict'],
    ['◆', 'context'], ['•', 'context'],
  ] as const)('%s means %s', (symbol, tone) => {
    expect(glanceTone(symbol)).toBe(tone);
  });

  it('reads the emoji presentation of a marker', () => {
    // `⚠️` is `⚠` followed by U+FE0F. A document that emitted it would
    // otherwise have its warning filed under "context".
    expect(glanceTone('⚠️')).toBe('watch');
  });

  it('files an unrecognised marker as context rather than dropping it', () => {
    expect(glanceTone('❖')).toBe('context');
    expect(glanceRows([{ symbol: '❖', text: 'Zoned R2 under the LEP' }])).toHaveLength(1);
  });

  it('prints no glyph anywhere in the markup', () => {
    const html = renderGlanceStrip(
      [{ symbol: '✓', text: 'Metro and bus access present' },
        { symbol: '★', text: 'Best suited to a long hold' }],
      esc,
    );
    expect(html).toBeTruthy();
    for (const glyph of ['✓', '⚠', '▲', '◆', '★', '•']) {
      expect(html).not.toContain(glyph);
    }
  });
});

describe('the meaning is a word', () => {
  it('prints the tag for every tone, so the key reads in greyscale', () => {
    const html = renderGlanceStrip([
      { symbol: '✓', text: 'Established amenity' },
      { symbol: '▲', text: 'Car reliance for most trips' },
      { symbol: '◆', text: 'Zoned R2 Low Density Residential' },
      { symbol: '★', text: 'Suits a 10+ year hold' },
    ], esc)!;
    for (const tag of Object.values(GLANCE_TAG)) expect(html).toContain(`>${tag}<`);
  });

  it('carries the tone as a class so the colour can ride on top of the word', () => {
    const html = renderGlanceStrip([{ symbol: '⚠', text: 'Holding costs are material' }], esc)!;
    expect(html).toContain('glance-watch');
    expect(html).toContain('Watch');
  });
});

describe('what the key refuses to say twice', () => {
  it('drops a finding that repeats one already in the strip', () => {
    const rows = glanceRows([
      { symbol: '✓', text: 'Metro and bus access present' },
      { symbol: '◆', text: 'Metro and bus access present.' },
    ]);
    expect(rows).toHaveLength(1);
  });

  it('compares the words, not the marker', () => {
    // The same finding tagged two ways is still one finding.
    expect(glanceRows([
      { symbol: '✓', text: 'Strong Hills Shire fundamentals' },
      { symbol: '★', text: 'strong hills shire fundamentals' },
    ])).toHaveLength(1);
  });

  it('drops a marker with no finding behind it', () => {
    expect(glanceRows([{ symbol: '✓', text: '   ' }])).toHaveLength(0);
  });

  it('draws nothing at all rather than an empty key', () => {
    expect(renderGlanceStrip([], esc)).toBeNull();
    expect(renderGlanceStrip([{ symbol: '✓', text: '' }], esc)).toBeNull();
  });
});

describe('the structure a tagged PDF needs', () => {
  it('is a list of list items', () => {
    const html = renderGlanceStrip([
      { symbol: '✓', text: 'One' }, { symbol: '▲', text: 'Two' },
    ], esc)!;
    expect(html).toContain('<ul class="glance-rows">');
    expect((html.match(/<li /g) ?? [])).toHaveLength(2);
  });

  it('escapes what it is handed', () => {
    const html = renderGlanceStrip([{ symbol: '✓', text: 'Zoned <R2> & low density' }], esc)!;
    expect(html).toContain('&lt;R2&gt; &amp; low density');
    expect(html).not.toContain('<R2>');
  });
});
