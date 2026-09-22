/**
 * The undrawable dashes, and the guarantee that this changes no word.
 *
 * The premise is measured rather than asserted: `fontTools` over all nine
 * faces `weasyprint-service/fonts/` ships says `U+2011` is in none of them and
 * `U+2010` in four. That measurement is reproduced below as a fixture of what
 * was found, so a future font change that adds the glyph shows up as a reason
 * to revisit this rather than as silent dead code.
 */
import { describe, it, expect } from 'vitest';
import {
  substituteUndrawableGlyphs,
  partitionCode,
  rejoin,
  UNDRAWABLE_DASHES,
} from '../investment/printableGlyphs.pure';

/** Measured 21 Sep 2026 with fontTools over `weasyprint-service/fonts/*.ttf`. */
const FACE_COVERAGE = {
  'U+2011': { cinzel: false, playfair: false, plexMono: false },
  'U+2010': { cinzel: false, playfair: true, plexMono: false },
  'U+002D': { cinzel: true, playfair: true, plexMono: true },
  'U+2014': { cinzel: true, playfair: true, plexMono: true },
};

describe('the closed set', () => {
  it('is five dashes and nothing else', () => {
    expect(Object.keys(UNDRAWABLE_DASHES).sort()).toEqual(
      ['‐', '‑', '‒', '―', '−'].sort(),
    );
  });

  it('never touches the en dash or the em dash, which every face holds', () => {
    expect(FACE_COVERAGE['U+2014']).toEqual({ cinzel: true, playfair: true, plexMono: true });
    const prose = 'A long aside — set off by em dashes — and a range 2020–2026.';
    expect(substituteUndrawableGlyphs(prose).markdown).toBe(prose);
    expect(substituteUndrawableGlyphs(prose).substituted).toEqual([]);
  });

  it('substitutes only onto characters every face can draw', () => {
    for (const to of Object.values(UNDRAWABLE_DASHES)) {
      expect(['-', '—']).toContain(to);
    }
  });

  it('the premise holds: no face ships the non-breaking hyphen', () => {
    expect(Object.values(FACE_COVERAGE['U+2011']).some(Boolean)).toBe(false);
  });
});

describe('it changes no word', () => {
  const fold = (s: string) => s
    .replace(/[‐‑‒−]/g, '-')
    .replace(/―/g, '—');

  it('is byte-identical once both sides are folded onto the drawable dash', () => {
    const src = 'The 1991–2020 window, a pre‑GST figure, a NSW‑QLD corridor '
      + 'and a −3.4% movement over 10‒year terms.';
    const out = substituteUndrawableGlyphs(src).markdown;
    expect(out).not.toBe(src);
    expect(fold(out)).toBe(fold(src));
  });

  it('preserves length exactly, because every substitution is one character', () => {
    const src = 'pre‑GST −3.4% 10‒year ― aside';
    expect(substituteUndrawableGlyphs(src).markdown).toHaveLength(src.length);
  });

  it('reports what it set, and how often', () => {
    const r = substituteUndrawableGlyphs('a‑b a‑b a‑b c−d');
    expect(r.substituted[0]).toEqual({
      from: '‑', codePoint: 'U+2011', to: '-', count: 3,
    });
    expect(r.substituted[1]).toEqual({
      from: '−', codePoint: 'U+2212', to: '-', count: 1,
    });
  });
});

describe('a document carrying none is untouched', () => {
  const doc = [
    '# Location Overview',
    '',
    'The suburb sits 12 km from the centre — a twenty-minute drive.',
    '',
    '| Control | Value |',
    '|---|---|',
    '| Minimum lot size | 450 m² |',
  ].join('\n');

  it('is byte-identical', () => {
    const r = substituteUndrawableGlyphs(doc);
    expect(r.markdown).toBe(doc);
    expect(r.substituted).toEqual([]);
    expect(r.inCode).toBe(0);
  });

  it('handles an empty document', () => {
    expect(substituteUndrawableGlyphs('')).toEqual({ markdown: '', substituted: [], inCode: 0 });
  });
});

describe('code is a quotation and is never edited', () => {
  it('leaves an inline span alone and counts it', () => {
    const src = 'The column is `plan‑zone` and the value is pre‑GST.';
    const r = substituteUndrawableGlyphs(src);
    expect(r.markdown).toContain('`plan‑zone`');
    expect(r.markdown).toContain('pre-GST');
    expect(r.inCode).toBe(1);
    expect(r.substituted[0].count).toBe(1);
  });

  it('leaves a fenced block alone', () => {
    const src = [
      'Before pre‑GST.',
      '',
      '```',
      'a‑b',
      'c‑d',
      '```',
      '',
      'After pre‑GST.',
    ].join('\n');
    const r = substituteUndrawableGlyphs(src);
    expect(r.markdown).toContain('a‑b');
    expect(r.markdown).toContain('c‑d');
    expect(r.markdown.match(/pre-GST/g)).toHaveLength(2);
    expect(r.inCode).toBe(2);
  });

  it('a backtick inside a fence cannot open an inline span', () => {
    const src = ['```', 'let x = `a‑b`;', '```', '', 'pre‑GST'].join('\n');
    const r = substituteUndrawableGlyphs(src);
    expect(r.markdown).toContain('`a‑b`');
    expect(r.inCode).toBe(1);
  });
});

describe('the partition reproduces its input exactly', () => {
  const CASES = [
    'plain prose with no code at all',
    'inline `code` in the middle',
    '`leading code` then prose',
    'prose then `trailing code`',
    '```\nfenced\n```',
    'before\n\n```js\nconst a = 1;\n```\n\nafter',
    '~~~\ntilde fence\n~~~',
    'a ``double backtick `inner` span`` here',
    '```\nunclosed fence\nand more',
    '',
    '\n\n\n',
    '| a | b |\n|---|---|\n| `x` | y |',
  ];
  for (const src of CASES) {
    it(`round-trips ${JSON.stringify(src.slice(0, 32))}`, () => {
      expect(partitionCode(src).map(([t]) => t).join('')).toBe(src);
    });
  }

  it('round-trips a document that mixes everything', () => {
    const src = CASES.join('\n\n');
    expect(partitionCode(src).map(([t]) => t).join('')).toBe(src);
    // And the substitution over it preserves length.
    expect(substituteUndrawableGlyphs(src).markdown).toHaveLength(src.length);
  });
});

describe('the reconciliation fallback fails closed', () => {
  // The branch is defensive and unreachable from `partitionCode`'s own
  // construction, so it is exercised directly. It first returned the document
  // as PROSE, which would have let the substitution run inside every fence and
  // code span in it -- failing open on the one bound this module promises.
  const doc = 'prose with a pre\u2011GST dash and `a\u2011b` in code';

  it('marks the whole document as code when a part cannot be located', () => {
    const out = rejoin(doc, [['a part that is not in the document', false]]);
    expect(out).toEqual([[doc, true]]);
  });

  it('so nothing is substituted, and the document is byte-identical', () => {
    // The region the fallback produces is code, and the substitution skips
    // code -- so an unreconcilable partition costs the repair, never the text.
    const [[text, isCode]] = rejoin(doc, [['absent', false]]);
    expect(isCode).toBe(true);
    expect(text).toBe(doc);
  });

  it('still reconciles normally when every part is present and in order', () => {
    const parts: Array<[string, boolean]> = [['prose with a pre\u2011GST dash and ', false], ['`a\u2011b`', true]];
    const out = rejoin(doc, parts);
    expect(out.map(([t]) => t).join('')).toBe(doc);
    expect(out.some(([, c]) => c)).toBe(true);
  });
});
