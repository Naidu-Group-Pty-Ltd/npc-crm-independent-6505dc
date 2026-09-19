/**
 * R1 — de-tracking letter-spaced source text.
 *
 * The primary fixture is the exact string a production import stored, verbatim
 * from the template row — including the LOST word boundary between PROPERTY and
 * CONSULTING, which only span evidence can recover.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveTrackingPt,
  deriveTrackingFromLines,
  detrackJoinedLines,
  detrackText,
  looksTracked,
} from '@/lib/reportTemplate/pdfImport/detrackText.pure';

// Verbatim from report_templates 91fd530c…, page 1, overlay 1.
const PRODUCTION = 'N A I D U   P R O P E R T Y C O N S U L T I N G   S E R V I C E S';

describe('looksTracked', () => {
  it('recognises the production artifact', () => {
    expect(looksTracked(PRODUCTION)).toBe(true);
    expect(looksTracked('P R E P A R E D   F O R')).toBe(true);
    expect(looksTracked('R E F   9 0 E 5 D F 3 4')).toBe(true);
  });

  it('leaves ordinary text alone', () => {
    expect(looksTracked('BORROWING CAPACITY SNAPSHOT')).toBe(false);
    expect(looksTracked('Masline Nyawo')).toBe(false);
    expect(looksTracked('18 April 2026')).toBe(false);
    // Initials do not make a name tracked — the long tokens dominate.
    expect(looksTracked('J R R Tolkien')).toBe(false);
    expect(looksTracked('9.44%')).toBe(false);
    expect(looksTracked('')).toBe(false);
  });
});

describe('detrackText — span partition (the only recoverer of lost boundaries)', () => {
  it('recovers the production heading, including the LOST boundary', () => {
    // The PDF drew four word-spans: their char counts are the word structure.
    const r = detrackText(PRODUCTION, [5, 8, 10, 8]);
    expect(r.text).toBe('NAIDU PROPERTY CONSULTING SERVICES');
    expect(r.method).toBe('span-partition');
    expect(r.changed).toBe(true);
  });

  it('refuses a partition that does not account for the letters exactly', () => {
    // 30 ≠ 31 letters: these spans describe something else. Trusting them
    // would invent boundaries; fall to the string's own gaps instead.
    const r = detrackText(PRODUCTION, [5, 8, 10, 7]);
    expect(r.method).toBe('multi-space');
  });

  it('ignores degenerate span lists', () => {
    for (const spans of [[31], [], [5, 8, 10, 8.5], [5, 8, 10, 0, 8]]) {
      const r = detrackText(PRODUCTION, spans as number[]);
      expect(r.method).toBe('multi-space');
    }
  });
});

describe('detrackText — multi-space fallback', () => {
  it('collapses letters and keeps word gaps that survived', () => {
    const r = detrackText('P R E P A R E D   F O R');
    expect(r.text).toBe('PREPARED FOR');
    expect(r.method).toBe('multi-space');
  });

  it('handles the mixed alphanumeric reference line', () => {
    expect(detrackText('R E F   9 0 E 5 D F 3 4').text).toBe('REF 90E5DF34');
  });

  it('cannot recover a lost boundary — and does not pretend to', () => {
    // Without span evidence, PROPERTY–CONSULTING stays merged. Honest: the
    // string alone does not contain that boundary.
    const r = detrackText(PRODUCTION);
    expect(r.text).toBe('NAIDU PROPERTYCONSULTING SERVICES');
    expect(r.method).toBe('multi-space');
  });

  it('leaves untracked text byte-identical', () => {
    for (const s of ['BORROWING CAPACITY SNAPSHOT', 'Masline Nyawo', '  ', 'A B']) {
      const r = detrackText(s);
      expect(r.changed).toBe(false);
      expect(r.text).toBe(s);
    }
  });

  it('is deterministic and never throws on hostile input', () => {
    expect(detrackText(PRODUCTION, [5, 8, 10, 8])).toEqual(detrackText(PRODUCTION, [5, 8, 10, 8]));
    for (const bad of [null, undefined, 42, {}]) {
      expect(() => detrackText(bad as never)).not.toThrow();
    }
  });
});

describe('deriveTrackingPt', () => {
  const measure = (text: string, _f: string, size: number) => [...text].length * size * 0.55;

  it('derives spacing from measured minus natural width', () => {
    // 34 glyphs at 12pt, natural 224.4pt, measured 386.3pt (the stored bbox).
    const pt = deriveTrackingPt('NAIDU PROPERTY CONSULTING SERVICES', 386.3, 12, 'Cinzel', measure);
    expect(pt).toBeCloseTo((386.3 - 224.4) / 33, 1);
  });

  it('falls back to the glyph-advance estimate without a measurer', () => {
    const pt = deriveTrackingPt('PREPARED FOR', 76, 8, 'Helvetica', null);
    // natural ≈ 12 × 8 × 0.5 = 48 → (76-48)/11 ≈ 2.5
    expect(pt).toBeCloseTo(2.55, 1);
  });

  it('returns null rather than negative spacing', () => {
    // Measured narrower than natural: this text was not tracked after all.
    expect(deriveTrackingPt('WIDE TEXT', 10, 12, 'Helvetica', measure)).toBeNull();
  });

  it('clamps absurd derivations instead of trusting them', () => {
    const pt = deriveTrackingPt('AB', 10000, 10, 'Helvetica', measure);
    expect(pt).toBeLessThanOrEqual(15);
  });

  it('returns null on unusable inputs', () => {
    expect(deriveTrackingPt('A', 100, 12, 'H', measure)).toBeNull();
    expect(deriveTrackingPt('ABC', 0, 12, 'H', measure)).toBeNull();
    expect(deriveTrackingPt('ABC', Number.NaN, 12, 'H', measure)).toBeNull();
    expect(deriveTrackingPt('ABC', 100, 0, 'H', measure)).toBeNull();
  });

  it('survives a measurer that throws', () => {
    const throwing = () => { throw new Error('no canvas'); };
    expect(() => deriveTrackingPt('ABC DEF', 100, 12, 'H', throwing)).not.toThrow();
  });
});

/**
 * The line join is where the lost boundary actually went.
 *
 * Measured from the source PDF: the cover lockup is two drawn lines, each with
 * its word gaps intact as double spaces. The extractor joins them with a SINGLE
 * space, and inside tracked text a single space is a letter gap — so the join
 * itself manufactured `PROPERTYCONSULTING`.
 *
 *   line 1  'N A I D U  P R O P E R T Y'            charCount 26, width 150.4pt
 *   line 2  'C O N S U L T I N G  S E R V I C E S'  charCount 36, width 199.8pt
 *
 * Both lines are drawn as ONE span each (verified with PyMuPDF), so the span
 * evidence this module was originally built around does not exist here.
 */
describe('detrackJoinedLines — the lockup', () => {
  const LINE_1 = 'N A I D U  P R O P E R T Y';
  const LINE_2 = 'C O N S U L T I N G  S E R V I C E S';
  const JOINED = `${LINE_1} ${LINE_2}`;
  const LINES = [
    { charCount: LINE_1.length, widthPt: 150.4, spans: [{ chars: LINE_1.length }] },
    { charCount: LINE_2.length, widthPt: 199.8, spans: [{ chars: LINE_2.length }] },
  ];

  it('recovers the boundary the join destroyed', () => {
    const result = detrackJoinedLines(JOINED, LINES);
    expect(result.text).toBe('NAIDU PROPERTY CONSULTING SERVICES');
    expect(result.method).toBe('line-partition');
    expect(result.lines).toEqual(['NAIDU PROPERTY', 'CONSULTING SERVICES']);
  });

  it('is what the whole-string collapse could not do', () => {
    // The defect, pinned: without the line counts the seam is invisible.
    expect(detrackText(JOINED).text).toBe('NAIDU PROPERTYCONSULTING SERVICES');
  });

  it('refuses a partition that does not account for the string exactly', () => {
    // One count off by one puts the seam inside a word. Refuse and fall back.
    const wrong = [{ charCount: 25 }, { charCount: 36 }];
    expect(detrackJoinedLines(JOINED, wrong).text).toBe('NAIDU PROPERTYCONSULTING SERVICES');
  });

  it('handles an empty-string join as well as a single-space one', () => {
    const glued = LINE_1 + LINE_2;
    expect(detrackJoinedLines(glued, LINES).text).toBe('NAIDU PROPERTY CONSULTING SERVICES');
  });

  it('leaves untracked text alone whatever the line counts say', () => {
    const prose = 'A lender counts some income at less than face value.';
    const result = detrackJoinedLines(prose, [{ charCount: 20 }, { charCount: 31 }]);
    expect(result.text).toBe(prose);
    expect(result.changed).toBe(false);
  });

  it('falls back to whole-string de-tracking with no line evidence', () => {
    expect(detrackJoinedLines(LINE_1, undefined).text).toBe('NAIDU PROPERTY');
    expect(detrackJoinedLines(LINE_1, [{ charCount: 26 }]).text).toBe('NAIDU PROPERTY');
  });
});

describe('deriveTrackingFromLines — one value, derived where the widths mean something', () => {
  const measure = (text: string, _family: string, size: number) => text.length * size * 0.5;

  it('derives from each line and takes the smallest estimate', () => {
    // natural('NAIDU PROPERTY') = 14 × 11.25 × 0.5 = 78.75 → (150.4-78.75)/13 = 5.51
    // natural('CONSULTING SERVICES') = 19 × 11.25 × 0.5 = 106.875 → (199.8-106.875)/18 = 5.16
    const pt = deriveTrackingFromLines(
      ['NAIDU PROPERTY', 'CONSULTING SERVICES'],
      [150.4, 199.8],
      11.25,
      'Cinzel',
      measure,
    );
    // The two lines agree to within 0.35pt — one design, one tracking. The
    // smaller wins because the box has no slack: see the module header.
    expect(pt).toBeCloseTo(5.16, 2);
  });

  it('never exceeds what any single line can hold', () => {
    // The real failure this rule exists for. Splitting the difference put
    // CONSULTING SERVICES 1.5pt past its 199.8pt box, and the two-line lockup
    // rendered as three. Every line must fit at the value chosen.
    const naturalWidths: Record<string, number> = {
      'NAIDU PROPERTY': 99.82, 'CONSULTING SERVICES': 132.75,
    };
    const real = (text: string) => naturalWidths[text];
    const texts = ['NAIDU PROPERTY', 'CONSULTING SERVICES'];
    const widths = [150.4, 199.8];
    const pt = deriveTrackingFromLines(texts, widths, 11.25, 'Cinzel', (t) => real(t) ?? null)!;
    texts.forEach((text, i) => {
      const rendered = real(text) + pt * ([...text].length - 1);
      expect(rendered, text).toBeLessThanOrEqual(widths[i]);
    });
  });

  it('is what the joined string could not produce', () => {
    // 34 glyphs measured against ONE line's width: natural 191.25 vs 199.8
    // gives 0.26pt, a twentieth of the real tracking. That mismatch is why the
    // two-line lockup came out looking untracked beside its single-line siblings.
    const joined = deriveTrackingPt(
      'NAIDU PROPERTY CONSULTING SERVICES', 199.8, 11.25, 'Cinzel', measure,
    );
    expect(joined).toBeLessThan(1);
  });

  it('ignores lines it cannot derive from at all', () => {
    // A one-glyph line has no gaps to distribute across, so it yields nothing
    // rather than a zero that would drag the minimum to the floor.
    const pt = deriveTrackingFromLines(
      ['NAIDU PROPERTY', 'X', 'CONSULTING SERVICES'],
      [150.4, 5, 199.8],
      11.25,
      'Cinzel',
      measure,
    );
    expect(pt).toBeCloseTo(5.16, 2);
  });

  it('rounds down, never to nearest', () => {
    // 3.725 rounded to nearest is 3.73, which puts the widest line 0.09pt past
    // its box — and a hundredth of a point over is the same wrap as a point.
    const naturalWidths: Record<string, number> = {
      'NAIDU PROPERTY': 99.82, 'CONSULTING SERVICES': 132.75,
    };
    const pt = deriveTrackingFromLines(
      ['NAIDU PROPERTY', 'CONSULTING SERVICES'],
      [150.4, 199.8],
      11.25,
      'Cinzel',
      (t) => naturalWidths[t] ?? null,
    );
    expect(pt).toBe(3.72);
  });

  it('returns null when no line yields an estimate', () => {
    expect(deriveTrackingFromLines(['AB'], [1], 11.25, 'Cinzel', measure)).toBeNull();
    expect(deriveTrackingFromLines([], [], 11.25, 'Cinzel', measure)).toBeNull();
  });
});

/**
 * Kern pairs the extractor never split.
 *
 * Tracked text is not reliably one letter per token: where the source kerns a
 * pair the two glyphs are drawn with no positioning operator between them, so
 * they arrive joined. Every fixture below was found by scanning the source PDF
 * — all seven of its pages — for tracked runs the all-single-char rule refuses.
 */
describe('detrackText — kerned pairs inside a tracked run', () => {
  const CASES: Array<[string, string, string]> = [
    ['C A PA C I T Y', 'CAPACITY', 'pages 2-7'],
    ['P R I VAT E', 'PRIVATE', 'pages 2-7'],
    ['A S S E S S M E N T  D AT E', 'ASSESSMENT DATE', 'page 1'],
    ['A S S E S S M E N T  R AT E', 'ASSESSMENT RATE', 'page 1'],
    ['W H AT', 'WHAT', 'page 6'],
    ['B U I LT', 'BUILT', 'page 6'],
    ['N YA W O', 'NYAWO', 'page 7'],
  ];

  it.each(CASES)('collapses %s → %s (%s)', (raw, expected) => {
    // Short runs are not tracked-looking on their own, so give them the
    // surrounding context they actually appear in.
    const context = raw.split(/\s{2,}/).length > 1 ? raw : `H O W  T H E  ${raw}`;
    const want = context === raw ? expected : `HOW THE ${expected}`;
    expect(detrackText(context).text).toBe(want);
  });

  it('still refuses to weld real words together', () => {
    // A token longer than a kern pair proves this run is words, not letters.
    expect(detrackText('A B C D E F G H I J  WORD X').text).toBe('ABCDEFGHIJ WORD X');
  });

  it('needs single characters to still dominate the run', () => {
    // Every token in the second run is a pair. That is not a spread-out word,
    // whatever the rest of the string looks like.
    expect(detrackText('A B C D E F G H I J K L  AB CD').text).toBe('ABCDEFGHIJKL AB CD');
  });

  it('leaves a string that does not read as tracked entirely alone', () => {
    // The whole-string gate comes first: too few single-char tokens and no run
    // inside it is even considered.
    const mixed = 'A B C D  FOR THE';
    expect(detrackText(mixed).changed).toBe(false);
    expect(detrackText(mixed).text).toBe(mixed);
  });
});
