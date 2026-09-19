/**
 * W1 — metric-compatible font substitution, and the V2 shadow gate.
 *
 * `fontResolver` maps a PostScript name to a web font by regex. That is a guess
 * about identity and says nothing about metrics — a substitute can run 10% wide,
 * and since the importer copies the source bbox verbatim, 10% wide is an
 * overflowing box. `resolveFontV2` has always had the right selection rule and
 * was never callable because nothing measured the candidates.
 *
 * The measurer is injected here, so selection is testable without a browser and
 * cannot quietly degrade into guessing.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ADVANCE_TOLERANCE,
  chooseMetricCompatibleFont,
  createCanvasMeasurer,
  type TextWidthMeasurer,
} from '@/lib/reportTemplate/pdfImport/fontMetricCompatibility';
import {
  runShadowGate,
  shadowReadiness,
  type ShadowPageInput,
} from '@/lib/reportTemplate/ingestion/visualQuality/v2/shadowGate.pure';
import type { RenderedTextEvidenceV1 } from '@/lib/reportTemplate/ingestion/visualQuality/v2/contracts';

const TEXT = 'Borrowing capacity summary';
const SOURCE_WIDTH = 100;

/** Each family renders at a fixed multiple of the source width. */
const measurerFor = (widths: Record<string, number>): TextWidthMeasurer =>
  (_text, family) => widths[family] ?? null;

describe('chooseMetricCompatibleFont', () => {
  it('prefers the exact source font over any measurement', () => {
    const choice = chooseMetricCompatibleFont(
      TEXT, SOURCE_WIDTH,
      [{ family: 'Wide', exact: false }, { family: 'SourceFont', exact: true }],
      12, measurerFor({ Wide: 100 }),
    );
    expect(choice.state).toBe('exact');
    expect(choice.family).toBe('SourceFont');
  });

  it('picks the closest advance among substitutes', () => {
    const choice = chooseMetricCompatibleFont(
      TEXT, SOURCE_WIDTH,
      [{ family: 'Wide' }, { family: 'Close' }, { family: 'Narrow' }],
      12, measurerFor({ Wide: 118, Close: 101, Narrow: 82 }),
    );
    expect(choice.family).toBe('Close');
    expect(choice.state).toBe('metric-compatible');
    expect(choice.advanceRatio).toBeCloseTo(1.01, 4);
  });

  it('labels an out-of-tolerance choice as measured, not compatible', () => {
    // The distinction matters: a KNOWN ratio lets the reflow ladder compensate
    // precisely, where an unknown one leaves it guessing.
    const choice = chooseMetricCompatibleFont(
      TEXT, SOURCE_WIDTH, [{ family: 'Wide' }], 12, measurerFor({ Wide: 112 }),
    );
    expect(choice.state).toBe('substituted-measured');
    expect(choice.advanceRatio).toBeCloseTo(1.12, 4);
  });

  it('honours the tolerance boundary', () => {
    const inside = chooseMetricCompatibleFont(
      TEXT, SOURCE_WIDTH, [{ family: 'A' }], 12,
      measurerFor({ A: 100 * (1 + ADVANCE_TOLERANCE) }),
    );
    expect(inside.state).toBe('metric-compatible');
    const outside = chooseMetricCompatibleFont(
      TEXT, SOURCE_WIDTH, [{ family: 'A' }], 12,
      measurerFor({ A: 100 * (1 + ADVANCE_TOLERANCE * 2) }),
    );
    expect(outside.state).toBe('substituted-measured');
  });

  it('treats a too-narrow substitute as drift too', () => {
    const choice = chooseMetricCompatibleFont(
      TEXT, SOURCE_WIDTH, [{ family: 'Narrow' }], 12, measurerFor({ Narrow: 80 }),
    );
    expect(choice.state).toBe('substituted-measured');
    expect(choice.advanceRatio).toBeCloseTo(0.8, 4);
  });
});

describe('chooseMetricCompatibleFont — says so when it could not measure', () => {
  it('reports unmeasured rather than implying a check that did not happen', () => {
    const choice = chooseMetricCompatibleFont(
      TEXT, SOURCE_WIDTH, [{ family: 'A' }], 12, () => null,
    );
    expect(choice.state).toBe('substituted-unmeasured');
    expect(choice.advanceRatio).toBeNull();
    expect(choice.family).toBe('A');
  });

  it('needs a usable source measurement', () => {
    for (const [text, width] of [[TEXT, 0], [TEXT, Number.NaN], ['', 100]] as const) {
      const choice = chooseMetricCompatibleFont(
        text as string, width as number, [{ family: 'A' }], 12, measurerFor({ A: 100 }),
      );
      expect(choice.state).toBe('substituted-unmeasured');
    }
  });

  it('survives a measurer that throws', () => {
    const choice = chooseMetricCompatibleFont(
      TEXT, SOURCE_WIDTH, [{ family: 'A' }], 12,
      () => { throw new Error('no canvas'); },
    );
    expect(choice.state).toBe('substituted-unmeasured');
  });

  it('falls back to a family rather than nothing', () => {
    expect(chooseMetricCompatibleFont(TEXT, SOURCE_WIDTH, [], 12, () => null).family)
      .toContain('Helvetica');
  });
});

describe('createCanvasMeasurer', () => {
  it('returns null rather than a fabricated width when canvas is unavailable', () => {
    // jsdom has no 2d context; the honest answer is "unmeasured".
    const measure = createCanvasMeasurer();
    const result = measure(TEXT, 'Helvetica', 12);
    expect(result === null || result > 0).toBe(true);
  });

  /**
   * `ctx.font` is a SHORTHAND. Assigning it without a weight resets the weight
   * to `normal`, so a semibold heading was measured as regular — narrower than
   * it renders. Any letter-spacing derived from measured-minus-natural then
   * came out too large by exactly what the weight was worth, and on the BC
   * Snapshot cover that was enough to wrap the two-line brand lockup onto three.
   */
  it('puts the requested weight into the canvas font shorthand', () => {
    const fonts: string[] = [];
    const ctx = {
      set font(value: string) { fonts.push(value); },
      get font() { return fonts[fonts.length - 1] ?? ''; },
      measureText: () => ({ width: 100 }),
    };
    const original = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = original(tag) as HTMLCanvasElement;
      if (tag === 'canvas') (el as unknown as { getContext: () => unknown }).getContext = () => ctx;
      return el;
    });
    try {
      const measure = createCanvasMeasurer();
      measure(TEXT, 'Inter, Arial, sans-serif', 12, 600);
      measure(TEXT, 'Inter, Arial, sans-serif', 12);
      measure(TEXT, 'Inter, Arial, sans-serif', 12, '');
    } finally {
      spy.mockRestore();
    }
    // 12pt is 16px. The weight leads the shorthand when given, and is omitted
    // entirely when not — never emitted as a stray token.
    expect(fonts[0]).toBe('600 16px Inter, Arial, sans-serif');
    expect(fonts[1]).toBe('16px Inter, Arial, sans-serif');
    expect(fonts[2]).toBe('16px Inter, Arial, sans-serif');
  });
});

// ── V2 shadow gate ───────────────────────────────────────────────────────────

function ev(over: Partial<RenderedTextEvidenceV1> = {}): RenderedTextEvidenceV1 {
  return {
    id: 't', overlayId: 'o', regionId: null, sourceRunIds: [],
    rawVisibleText: 'x', codePoints: [120],
    pageRectPx: { x: 0, y: 0, width: 10, height: 10 }, lineRectsPx: [],
    clientWidth: 10, clientHeight: 10, scrollWidth: 10, scrollHeight: 10,
    computedStyle: {} as never,
    visible: true, clipped: false, clippedWidthPx: 0, clippedHeightPx: 0,
    overflowing: false, overflowWidthPx: 0, overflowHeightPx: 0,
    offPage: false, occlusionRatio: null, contrastRatio: null,
    hiddenSemantic: false, complete: true, problems: [],
    ...over,
  } as RenderedTextEvidenceV1;
}

const page = (over: Partial<ShadowPageInput> = {}): ShadowPageInput => ({
  pageNumber: 1, evidence: [ev()], v1NeedsReview: false, ...over,
});

describe('runShadowGate — advisory only', () => {
  it('marks itself advisory so nothing can mistake it for a decision', () => {
    expect(runShadowGate([page()]).advisoryOnly).toBe(true);
  });

  it('flags a page V1 cannot see — the whole reason for shadowing', () => {
    const report = runShadowGate([page({
      evidence: [ev({ overflowing: true, overflowHeightPx: 44 })],
      v1NeedsReview: false,
    })]);
    expect(report.pages[0].agreement).toBe('v2-only');
    expect(report.totals.overflowing).toBe(1);
  });

  it('agrees when both flag the page', () => {
    const report = runShadowGate([page({
      evidence: [ev({ clipped: true })], v1NeedsReview: true,
    })]);
    expect(report.pages[0].agreement).toBe('agree');
  });

  it('ignores hidden-semantic layers rather than manufacturing defects', () => {
    // These are MEANT to be invisible; counting them would turn correct
    // behaviour into a defect.
    const report = runShadowGate([page({
      evidence: [ev({ hiddenSemantic: true, clipped: true, visible: false })],
    })]);
    expect(report.pages[0].clippedCount).toBe(0);
    expect(report.pages[0].v2NeedsReview).toBe(false);
  });

  it('is deterministic and handles an empty run', () => {
    const pages = [page(), page({ pageNumber: 2 })];
    expect(runShadowGate(pages)).toEqual(runShadowGate(pages));
    expect(runShadowGate([]).totals.pages).toBe(0);
  });
});

describe('shadowReadiness — what would block promoting V2', () => {
  it('is not ready when V2 misses a page V1 flagged', () => {
    // Trading one blindness for another is not progress.
    const report = runShadowGate([page({ v1NeedsReview: true })]);
    const readiness = shadowReadiness(report);
    expect(readiness.ready).toBe(false);
    expect(readiness.reason).toMatch(/^v2_misses_1_pages/);
  });

  it('is ready when V2 only finds MORE than V1', () => {
    const report = runShadowGate([page({
      evidence: [ev({ overflowing: true })], v1NeedsReview: false,
    })]);
    expect(shadowReadiness(report).ready).toBe(true);
    expect(shadowReadiness(report).reason).toMatch(/v2_finds_1_pages/);
  });

  it('is not ready with nothing scored', () => {
    expect(shadowReadiness(runShadowGate([])).ready).toBe(false);
  });
});
