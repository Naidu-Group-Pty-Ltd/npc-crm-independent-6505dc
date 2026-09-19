import { describe, it, expect } from 'vitest';
import {
  resolveTextWrapping,
  MAX_NOWRAP_OVERFLOW_RATIO,
  MULTI_LINE_BOX_HEIGHT_RATIO,
  MIN_STACKED_BOX_HEIGHT_RATIO,
  type TextWrappingInput,
} from '../resolveTextWrapping.pure';
import type { WidthMeasurer } from '../detrackText.pure';

/**
 * The BC Snapshot cover, measured with each block's OWN source font via
 * PyMuPDF. `boxWidthPt`/`boxHeightPt`/`fontSizePt` are the values the importer
 * actually wrote into the stored template; `measuredPt` is the advance width
 * the source font needs for the whole string on one line.
 *
 * Note the split: the two blocks the source drew on two lines need 1.25–1.34×
 * their box, and every genuine single line needs 0.72–1.02×.
 */
const COVER = {
  title: {
    text: 'BORROWING CAPACITY SNAPSHOT',
    boxWidthPt: 386.3, boxHeightPt: 45.8, fontSizePt: 27.75, measuredPt: 518.7,
  },
  lockup: {
    text: 'NAIDU PROPERTY CONSULTING SERVICES',
    boxWidthPt: 199.8, boxHeightPt: 22.1, fontSizePt: 11.25, measuredPt: 249.3,
  },
  assessmentDate: {
    text: 'ASSESSMENT DATE',
    boxWidthPt: 80.0, boxHeightPt: 11.4, fontSizePt: 8.25, measuredPt: 59.8,
  },
  confidential: {
    text: 'PRIVATE AND CONFIDENTIAL',
    boxWidthPt: 127.7, boxHeightPt: 11.4, fontSizePt: 8.25, measuredPt: 91.3,
  },
  /**
   * The footer strip, exactly as PyMuPDF reports it: ONE block containing two
   * "lines" that sit at opposite ends of the same baseline (x 72→199.7 and
   * x 460.2→521.6, both y 767.5→776.4). Two line records, one visual line.
   */
  footerStrip: {
    text: 'PRIVATE AND CONFIDENTIAL REF 90E5DF34',
    boxWidthPt: 449.6, boxHeightPt: 9.0, fontSizePt: 6.75, measuredPt: 188.7,
  },
  date: {
    text: '18 April 2026',
    boxWidthPt: 73.7, boxHeightPt: 15.2, fontSizePt: 11.25, measuredPt: 75.2,
  },
} as const;

/** A measurer that returns the recorded source width for a known string. */
const sourceMeasurer: WidthMeasurer = (text) => {
  const hit = Object.values(COVER).find((c) => c.text === text);
  return hit ? hit.measuredPt : null;
};

const input = (
  fixture: { text: string; boxWidthPt: number; boxHeightPt: number; fontSizePt: number },
  extra: Partial<TextWrappingInput> = {},
): TextWrappingInput => ({
  text: fixture.text,
  boxWidthPt: fixture.boxWidthPt,
  boxHeightPt: fixture.boxHeightPt,
  fontSizePt: fixture.fontSizePt,
  lineHeight: 1.3,
  fontFamily: 'Inter, sans-serif',
  ...extra,
});

describe('resolveTextWrapping — the source line count decides', () => {
  it('lets a two-line source title wrap, however single-line its string looks', () => {
    // The defect: Docling joins the two drawn lines with a SPACE, so the string
    // carries no break, and the box (45.8pt of caps ink) is under 1.6 line
    // heights. Every string-and-geometry heuristic says "single line"; only the
    // source measurement knows better.
    const decision = resolveTextWrapping(input(COVER.title, { sourceLineCount: 2 }));
    expect(decision.nowrap).toBe(false);
    expect(decision.reason).toBe('source_drew_multiple_lines');
  });

  it('keeps nowrap when the source drew exactly one line, even if it overflows', () => {
    // A substitute running wide is `reconcileTextReflow`'s problem — it tightens
    // tracking or shrinks the type. Adding a line the source has no room for
    // drops it onto the block below.
    const decision = resolveTextWrapping(input(COVER.date, {
      sourceLineCount: 1,
      measure: sourceMeasurer,
    }));
    expect(decision.nowrap).toBe(true);
    expect(decision.reason).toBe('source_drew_one_line');
  });

  it('treats justified alignment as proof of two or more source lines', () => {
    // The sidecar's `_infer_alignment` requires `n >= 2` matched lines before it
    // can return 'justify', so a justified block is a joined multi-line block.
    // This is the signal available on artifacts that predate `lineCount`.
    const decision = resolveTextWrapping(input(COVER.title, { sourceAlign: 'justify' }));
    expect(decision.nowrap).toBe(false);
    expect(decision.reason).toBe('source_alignment_implies_multiple_lines');
  });

  it('does not read other alignments as evidence of wrapping', () => {
    for (const align of ['left', 'center', 'right', null, undefined]) {
      const decision = resolveTextWrapping(input(COVER.assessmentDate, { sourceAlign: align }));
      expect(decision.nowrap).toBe(true);
    }
  });

  it('prefers the exact baseline count over every heuristic', () => {
    // source-measure-v2. The title's two records sit on two baselines: wrap.
    const wrapped = resolveTextWrapping(input(COVER.title, {
      sourceLineCount: 2, sourceBaselineCount: 2,
    }));
    expect(wrapped.nowrap).toBe(false);
    expect(wrapped.reason).toBe('source_drew_multiple_lines');

    // The footer's two records share one baseline: do not wrap. Note this needs
    // no box arithmetic at all — the same call with a box tall enough to stack
    // two lines still says no.
    const shared = resolveTextWrapping(input(
      { ...COVER.footerStrip, boxHeightPt: 40 },
      { sourceLineCount: 2, sourceBaselineCount: 1 },
    ));
    expect(shared.nowrap).toBe(true);
    expect(shared.reason).toBe('source_lines_share_one_baseline');
  });

  it('a single baseline from a single record reads as one line', () => {
    const decision = resolveTextWrapping(input(COVER.date, {
      sourceLineCount: 1, sourceBaselineCount: 1, measure: sourceMeasurer,
    }));
    expect(decision.nowrap).toBe(true);
    expect(decision.reason).toBe('source_drew_one_line');
  });

  it('falls back to the box heuristic when the artifact predates v2', () => {
    const decision = resolveTextWrapping(input(COVER.title, {
      sourceLineCount: 2, sourceBaselineCount: null,
    }));
    expect(decision.reason).toBe('source_drew_multiple_lines');
  });

  it('does not stack two runs that shared a baseline', () => {
    // The real hazard in `lineCount`: a PyMuPDF "line" is a line RECORD, not a
    // stacked line, and the footer's two ends of one 9pt strip count as two.
    // 9.0 / 6.75 = 1.33em — too short to hold two lines, so this stays on one.
    const decision = resolveTextWrapping(input(COVER.footerStrip, {
      sourceLineCount: 2,
      measure: sourceMeasurer,
    }));
    expect(decision.nowrap).toBe(true);
    expect(decision.reason).toBe('source_lines_share_one_baseline');
  });

  it('the title clears the stacked-box test that the footer fails', () => {
    // 45.8 / 27.75 = 1.65em vs 9.0 / 6.75 = 1.33em. Both are real blocks from
    // the same page, and the threshold has to separate them.
    expect(COVER.title.boxHeightPt / COVER.title.fontSizePt).toBeGreaterThan(MIN_STACKED_BOX_HEIGHT_RATIO);
    expect(COVER.footerStrip.boxHeightPt / COVER.footerStrip.fontSizePt).toBeLessThan(MIN_STACKED_BOX_HEIGHT_RATIO);
  });

  it('a short box does not veto wrapping when the geometry is unusable', () => {
    // Unknown is not "one line". The source's own count is stronger evidence
    // than a box height nobody could compute.
    const decision = resolveTextWrapping({
      text: 'BORROWING CAPACITY SNAPSHOT',
      boxWidthPt: 386.3,
      boxHeightPt: Number.NaN,
      fontSizePt: Number.NaN,
      lineHeight: 1.3,
      sourceLineCount: 2,
    });
    expect(decision.nowrap).toBe(false);
    expect(decision.reason).toBe('source_drew_multiple_lines');
  });

  it('an explicit newline outranks a source count of one', () => {
    const decision = resolveTextWrapping(input(
      { ...COVER.assessmentDate, text: 'ASSESSMENT\nDATE' },
      { sourceLineCount: 1 },
    ));
    expect(decision.nowrap).toBe(false);
    expect(decision.reason).toBe('explicit_newline');
  });
});

describe('resolveTextWrapping — fallbacks when nothing was measured', () => {
  it('wraps when the box is taller than one line', () => {
    const decision = resolveTextWrapping(input({
      text: 'Two lines of ordinary body copy that the extractor joined together.',
      boxWidthPt: 300, boxHeightPt: 11 * 1.3 * MULTI_LINE_BOX_HEIGHT_RATIO + 1, fontSizePt: 11,
    }));
    expect(decision.nowrap).toBe(false);
    expect(decision.reason).toBe('box_taller_than_one_line');
  });

  it('wraps the cover title on measured width alone', () => {
    // 518.7 / 386.3 = 1.34 — past the threshold with room to spare, which is
    // what makes the fallback usable on artifacts with no source_measure.
    const decision = resolveTextWrapping(input(COVER.title, { measure: sourceMeasurer }));
    expect(decision.nowrap).toBe(false);
    expect(decision.reason).toBe('measured_width_exceeds_box');
    expect(decision.naturalWidthPt).toBe(518.7);
  });

  it('wraps the joined brand lockup on measured width alone', () => {
    // 249.3 / 199.8 = 1.25.
    const decision = resolveTextWrapping(input(COVER.lockup, { measure: sourceMeasurer }));
    expect(decision.nowrap).toBe(false);
    expect(decision.reason).toBe('measured_width_exceeds_box');
  });

  it('keeps every genuine single line on one line', () => {
    // 0.75, 0.72 and 1.02 of their boxes respectively. The last is the one that
    // matters: a line already slightly over its box must NOT be wrapped, or the
    // threshold has eaten the case nowrap exists for.
    for (const fixture of [COVER.assessmentDate, COVER.confidential, COVER.date]) {
      const decision = resolveTextWrapping(input(fixture, { measure: sourceMeasurer }));
      expect(decision.nowrap, fixture.text).toBe(true);
      expect(decision.reason, fixture.text).toBe('fits_on_one_line');
    }
  });

  it('leaves headroom for a substituted face above the widest genuine single line', () => {
    // The nearest genuine single line sits at 1.02; the threshold is 1.2. A
    // substitute may run ~17% wider than the source before it is mistaken for
    // a joined multi-line block.
    const widestGenuine = COVER.date.measuredPt / COVER.date.boxWidthPt;
    expect(MAX_NOWRAP_OVERFLOW_RATIO).toBeGreaterThan(widestGenuine);
    const narrowestJoined = COVER.lockup.measuredPt / COVER.lockup.boxWidthPt;
    expect(MAX_NOWRAP_OVERFLOW_RATIO).toBeLessThan(narrowestJoined);
  });

  it('counts tracking towards the measured width', () => {
    // De-tracked text carries its tracking back as a style. 20 gaps × 1.5pt is
    // 30pt of width the raw advance measurement does not include — enough to
    // take a string that fit its box past the overflow threshold.
    const flat: WidthMeasurer = () => 100;
    const text = 'ABCDEFGHIJKLMNOPQRSTU'; // 21 glyphs, 20 gaps
    const untracked = resolveTextWrapping(input(
      { text, boxWidthPt: 100, boxHeightPt: 12, fontSizePt: 10 },
      { measure: flat },
    ));
    expect(untracked.naturalWidthPt).toBe(100);
    expect(untracked.nowrap).toBe(true);
    const tracked = resolveTextWrapping(input(
      { text, boxWidthPt: 100, boxHeightPt: 12, fontSizePt: 10 },
      { measure: flat, letterSpacingPt: 1.5 },
    ));
    expect(tracked.naturalWidthPt).toBe(130);
    expect(tracked.nowrap).toBe(false);
  });
});

describe('resolveTextWrapping — degrades rather than guesses', () => {
  it('a throwing measurer falls through to the remaining rules', () => {
    const boom: WidthMeasurer = () => { throw new Error('no canvas'); };
    const decision = resolveTextWrapping(input(COVER.title, { measure: boom }));
    expect(decision.nowrap).toBe(true);
    expect(decision.naturalWidthPt).toBeUndefined();
  });

  it('a measurer returning null (no canvas) does not decide anything', () => {
    const none: WidthMeasurer = () => null;
    const decision = resolveTextWrapping(input(COVER.title, { measure: none }));
    expect(decision.reason).toBe('fits_on_one_line');
  });

  it('empty text never asks for nowrap', () => {
    expect(resolveTextWrapping(input({ ...COVER.title, text: '   ' })).reason).toBe('no_text');
    expect(resolveTextWrapping(input({ ...COVER.title, text: '' })).nowrap).toBe(false);
  });

  it('nonsensical geometry does not throw or flip the decision', () => {
    const decision = resolveTextWrapping({
      text: 'ASSESSMENT DATE',
      boxWidthPt: Number.NaN,
      boxHeightPt: Number.NaN,
      fontSizePt: 0,
      lineHeight: Number.NaN,
      measure: sourceMeasurer,
      fontFamily: 'Inter',
    });
    expect(decision.nowrap).toBe(true);
  });

  it('ignores a nonsense source line count instead of trusting it', () => {
    for (const bad of [0, -3, Number.NaN, null, undefined]) {
      const decision = resolveTextWrapping(input(COVER.assessmentDate, { sourceLineCount: bad as number }));
      expect(decision.nowrap).toBe(true);
      expect(decision.reason).toBe('fits_on_one_line');
    }
  });
});
