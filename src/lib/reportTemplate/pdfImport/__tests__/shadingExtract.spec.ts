/**
 * Shading-fill recovery: pdf.js shading IR → CSS gradient overlay specs.
 * These are the page backgrounds of designed covers that previously imported
 * as blank white pages.
 */
import { describe, it, expect } from 'vitest';
import { parseShadingIR, shadingToOverlaySpec, pathPointsToPageBBox } from '../shadingExtract';
import type { Matrix } from '../vectorExtract';

const IDENT: Matrix = [1, 0, 0, 1, 0, 0];
/** A4 viewport transform: PDF user space (bottom-left up) → page space (top-left down). */
const VIEWPORT: Matrix = [1, 0, 0, -1, 0, 842];

describe('parseShadingIR', () => {
  it('parses an axial (linear) RadialAxial IR with sorted stops', () => {
    const ir = ['RadialAxial', 2, null, [[1, '#1a3a5a'], [0, '#0a2540']], [0, 0], [595, 842], 0, 0];
    const parsed = parseShadingIR(ir);
    expect(parsed).toMatchObject({
      kind: 'axial',
      p0: [0, 0],
      p1: [595, 842],
      stops: [
        { offset: 0, color: '#0a2540' },
        { offset: 1, color: '#1a3a5a' },
      ],
    });
  });

  it('parses a radial IR', () => {
    const ir = ['RadialAxial', 3, null, [[0, '#f5a623'], [1, '#ffbd4a']], [0, 0], [0, 0], 0, 100];
    expect(parseShadingIR(ir)).toMatchObject({ kind: 'radial' });
  });

  it('averages mesh vertex colours into a flat fill', () => {
    const ir = ['Mesh', 5, new Float32Array(0), Uint8Array.from([0, 0, 0, 20, 40, 60]), [], []];
    expect(parseShadingIR(ir)).toEqual({ kind: 'solid', color: '#0a141e' });
  });

  it('rejects unknown IR layouts defensively', () => {
    expect(parseShadingIR(null)).toBeNull();
    expect(parseShadingIR(['Whatever'])).toBeNull();
    expect(parseShadingIR(['RadialAxial', 2, null, []])).toBeNull();
  });
});

describe('shadingToOverlaySpec', () => {
  it('covers the full page when no clip is active and maps the axis to a CSS angle', () => {
    // Axis bottom-left → top-right in PDF space; after the y-flip the page
    // vector points up-right → CSS angle in (0°, 90°).
    const parsed = parseShadingIR(['RadialAxial', 2, null, [[0, '#0a2540'], [1, '#1a3a5a']], [0, 0], [595, 842], 0, 0])!;
    const spec = shadingToOverlaySpec({ parsed, ctm: IDENT, viewportCtm: VIEWPORT, pageWidth: 595, pageHeight: 842 });
    expect(spec).toMatchObject({ x: 0, y: 0, width: 595, height: 842 });
    const m = /^linear-gradient\((\d+)deg, #0a2540 0%, #1a3a5a 100%\)$/.exec(spec.fill);
    expect(m).toBeTruthy();
    const angle = Number(m![1]);
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(90);
    expect(spec.averageColor).toBe('#1a3a5a');
  });

  it('respects an active clip rect', () => {
    const parsed = parseShadingIR(['RadialAxial', 2, null, [[0, '#000000'], [1, '#ffffff']], [0, 0], [0, 100], 0, 0])!;
    const spec = shadingToOverlaySpec({
      parsed, ctm: IDENT, viewportCtm: VIEWPORT, pageWidth: 595, pageHeight: 842,
      clip: { x: 10, y: 20, width: 200, height: 100 },
    });
    expect(spec).toMatchObject({ x: 10, y: 20, width: 200, height: 100 });
  });

  it('renders radial + solid fills', () => {
    const radial = parseShadingIR(['RadialAxial', 3, null, [[0, '#f5a623'], [1, '#ffbd4a']], [0, 0], [0, 0], 0, 1])!;
    expect(shadingToOverlaySpec({ parsed: radial, ctm: IDENT, viewportCtm: VIEWPORT, pageWidth: 100, pageHeight: 100 }).fill)
      .toBe('radial-gradient(circle, #f5a623 0%, #ffbd4a 100%)');
    const solid = parseShadingIR(['Mesh', 5, [], Uint8Array.from([10, 20, 30]), [], []])!;
    expect(shadingToOverlaySpec({ parsed: solid, ctm: IDENT, viewportCtm: VIEWPORT, pageWidth: 100, pageHeight: 100 }).fill)
      .toBe('#0a141e');
  });
});

describe('pathPointsToPageBBox', () => {
  it('maps user-space rect corners through the viewport flip', () => {
    // Rect (0,0)-(595,842) in PDF space == the whole page after the flip.
    const box = pathPointsToPageBBox([[0, 0], [595, 842]], IDENT, VIEWPORT);
    expect(box).toEqual({ x: 0, y: 0, width: 595, height: 842 });
  });

  it('returns null for empty or degenerate paths', () => {
    expect(pathPointsToPageBBox([], IDENT, VIEWPORT)).toBeNull();
    expect(pathPointsToPageBBox([[5, 5]], IDENT, VIEWPORT)).toBeNull();
  });
});
