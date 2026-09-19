import { describe, it, expect } from 'vitest';
import {
  planTableRegionContainment,
  insideShare,
  CONTAINMENT_PAD_PT,
  MAX_CONTAINED_AREA_SHARE,
  MIN_OVERLAY_INSIDE_SHARE,
  type TableRegionContainmentInput,
} from '../tableRegionContainment.pure';

const A4 = { pageWidth: 595, pageHeight: 842 };

const tableDefect = { severity: 'critical', contentKind: 'table' };
const chartDefect = { severity: 'critical', contentKind: 'chart' };
const coverageDefect = { severity: 'critical', contentKind: null };

const input = (over: Partial<TableRegionContainmentInput> = {}): TableRegionContainmentInput => ({
  defects: [tableDefect],
  overlays: [{ id: 't1', kind: 'table', bbox: { x: 48, y: 200, width: 500, height: 126 } }],
  ...A4,
  sourceRasterAvailable: true,
  ...over,
});

describe('planTableRegionContainment — the page keeps its text', () => {
  it('turns one table veto into one window', () => {
    const plan = planTableRegionContainment(input())!;
    expect(plan.windows).toHaveLength(1);
    // The window is the table's box, padded so border ink just outside the
    // measured bbox is inside the source pixels rather than straddling them.
    expect(plan.windows[0]).toMatchObject({
      x: 48 - CONTAINMENT_PAD_PT,
      y: 200 - CONTAINMENT_PAD_PT,
      width: 500 + CONTAINMENT_PAD_PT * 2,
      height: 126 + CONTAINMENT_PAD_PT * 2,
    });
    expect(plan.suppressedOverlayIds).toEqual(['t1']);
  });

  it('leaves everything outside the window rendering natively', () => {
    // The whole point: a heading and a paragraph on the same page are not
    // suppressed, so they keep a text layer.
    const plan = planTableRegionContainment(input({
      overlays: [
        { id: 'heading', kind: 'text', bbox: { x: 48, y: 96, width: 400, height: 24 } },
        { id: 't1', kind: 'table', bbox: { x: 48, y: 200, width: 500, height: 126 } },
        { id: 'footer', kind: 'text', bbox: { x: 48, y: 780, width: 400, height: 10 } },
      ],
    }))!;
    expect(plan.suppressedOverlayIds).toEqual(['t1']);
  });

  it('suppresses what a window actually covers', () => {
    // Cell text and table rules inside the window would be a second copy of
    // content the source pixels already show.
    const plan = planTableRegionContainment(input({
      overlays: [
        { id: 't1', kind: 'table', bbox: { x: 48, y: 200, width: 500, height: 126 } },
        { id: 'rule', kind: 'vector', bbox: { x: 50, y: 240, width: 480, height: 1 } },
        { id: 'cell', kind: 'text', bbox: { x: 60, y: 250, width: 100, height: 10 } },
        { id: 'straddler', kind: 'text', bbox: { x: 48, y: 316, width: 500, height: 60 } },
      ],
    }))!;
    expect(plan.suppressedOverlayIds).toEqual(['t1', 'rule', 'cell']);
  });

  it('never touches a page-spanning backdrop', () => {
    const plan = planTableRegionContainment(input({
      overlays: [
        { id: 'backdrop', kind: 'vector', bbox: { x: 0, y: 0, width: 595, height: 842 } },
        { id: 't1', kind: 'table', bbox: { x: 48, y: 200, width: 500, height: 126 } },
      ],
    }))!;
    expect(plan.suppressedOverlayIds).not.toContain('backdrop');
  });

  it('merges two tables that touch into one window', () => {
    const plan = planTableRegionContainment(input({
      overlays: [
        { id: 't1', kind: 'table', bbox: { x: 48, y: 200, width: 500, height: 100 } },
        { id: 't2', kind: 'table', bbox: { x: 48, y: 301, width: 500, height: 100 } },
      ],
    }))!;
    // Padding brings them into contact; one window, no doubled pixels.
    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0].overlayIds.sort()).toEqual(['t1', 't2']);
  });

  it('keeps two well-separated tables as two windows', () => {
    const plan = planTableRegionContainment(input({
      overlays: [
        { id: 't1', kind: 'table', bbox: { x: 48, y: 120, width: 500, height: 80 } },
        { id: 't2', kind: 'table', bbox: { x: 48, y: 600, width: 500, height: 80 } },
      ],
    }))!;
    expect(plan.windows).toHaveLength(2);
    expect(plan.windows[0].y).toBeLessThan(plan.windows[1].y);
  });

  it('clamps a window to the page rather than overhanging it', () => {
    const plan = planTableRegionContainment(input({
      overlays: [{ id: 't1', kind: 'table', bbox: { x: 0, y: 0, width: 595, height: 200 } }],
    }))!;
    const w = plan.windows[0];
    expect(w.x).toBe(0);
    expect(w.y).toBe(0);
    expect(w.x + w.width).toBeLessThanOrEqual(595);
  });

  it('reports the share of the page it covers', () => {
    const plan = planTableRegionContainment(input())!;
    expect(plan.coveredAreaShare).toBeGreaterThan(0);
    expect(plan.coveredAreaShare).toBeLessThan(MAX_CONTAINED_AREA_SHARE);
  });
});

describe('planTableRegionContainment — refuses, and the page keeps its own scope', () => {
  it('refuses when any critical defect is not a table', () => {
    // A chart, a picture or a coverage defect says something is wrong somewhere
    // the table windows do not cover.
    expect(planTableRegionContainment(input({ defects: [tableDefect, chartDefect] }))).toBeNull();
    expect(planTableRegionContainment(input({ defects: [tableDefect, coverageDefect] }))).toBeNull();
    expect(planTableRegionContainment(input({ defects: [chartDefect] }))).toBeNull();
  });

  it('refuses without a source raster — there would be no pixels', () => {
    expect(planTableRegionContainment(input({ sourceRasterAvailable: false }))).toBeNull();
  });

  it('refuses when any table cannot be placed', () => {
    // Containing one table and leaving another rendering natively would be
    // worse than the page-wide raster: half the veto, silently.
    for (const bbox of [null, undefined, { x: 0, y: 0, width: 0, height: 10 },
      { x: Number.NaN, y: 0, width: 10, height: 10 }]) {
      expect(planTableRegionContainment(input({
        overlays: [
          { id: 't1', kind: 'table', bbox: { x: 48, y: 200, width: 500, height: 126 } },
          { id: 't2', kind: 'table', bbox: bbox as never },
        ],
      })), String(JSON.stringify(bbox))).toBeNull();
    }
  });

  it('refuses when the windows would be most of the page', () => {
    // At that size the windows ARE the page and the full-page raster says the
    // same thing with less machinery.
    const tall = Math.ceil(842 * (MAX_CONTAINED_AREA_SHARE + 0.1));
    expect(planTableRegionContainment(input({
      overlays: [{ id: 't1', kind: 'table', bbox: { x: 0, y: 0, width: 595, height: tall } }],
    }))).toBeNull();
  });

  it('refuses with no table overlay to contain', () => {
    expect(planTableRegionContainment(input({
      overlays: [{ id: 'x', kind: 'text', bbox: { x: 0, y: 0, width: 10, height: 10 } }],
    }))).toBeNull();
  });

  it('refuses without a critical defect at all', () => {
    expect(planTableRegionContainment(input({ defects: [] }))).toBeNull();
    expect(planTableRegionContainment(input({
      defects: [{ severity: 'warning', contentKind: 'table' }],
    }))).toBeNull();
  });

  it('refuses on unusable page geometry', () => {
    expect(planTableRegionContainment(input({ pageWidth: 0 }))).toBeNull();
    expect(planTableRegionContainment(input({ pageHeight: Number.NaN }))).toBeNull();
  });
});

describe('insideShare', () => {
  const outer = { x: 10, y: 10, width: 100, height: 100 };

  it('is 1 for a fully contained box and 0 for a disjoint one', () => {
    expect(insideShare({ x: 20, y: 20, width: 10, height: 10 }, outer)).toBe(1);
    expect(insideShare({ x: 500, y: 500, width: 10, height: 10 }, outer)).toBe(0);
  });

  it('measures a partial overlap', () => {
    // Half in, half out.
    expect(insideShare({ x: 60, y: 20, width: 100, height: 10 }, outer)).toBeCloseTo(0.5, 6);
  });

  it('is 0 for a degenerate box rather than dividing by zero', () => {
    expect(insideShare({ x: 20, y: 20, width: 0, height: 10 }, outer)).toBe(0);
  });

  it('sits either side of the suppression threshold as expected', () => {
    expect(insideShare({ x: 20, y: 20, width: 10, height: 10 }, outer))
      .toBeGreaterThanOrEqual(MIN_OVERLAY_INSIDE_SHARE);
    expect(insideShare({ x: 60, y: 20, width: 100, height: 10 }, outer))
      .toBeLessThan(MIN_OVERLAY_INSIDE_SHARE);
  });
});
