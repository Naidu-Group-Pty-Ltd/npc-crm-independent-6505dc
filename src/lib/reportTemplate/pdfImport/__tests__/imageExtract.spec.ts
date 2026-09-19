import { describe, it, expect } from 'vitest';
import { imageRectFromCtm } from '../imageExtract';
import type { Matrix } from '../vectorExtract';

describe('imageRectFromCtm', () => {
  const pageH = 842;
  const viewport: Matrix = [1, 0, 0, -1, 0, pageH]; // pdf.js scale-1 viewport (y-flip)

  it('places an axis-aligned image (upright CTM) at the right device rect', () => {
    // q  W 0 0 H X Y cm  /Im Do  → image fills user-space (X,Y)..(X+W,Y+H)
    const imageCtm: Matrix = [200, 0, 0, 120, 50, 600]; // W=200,H=120,X=50,Y=600
    const r = imageRectFromCtm(imageCtm, viewport);
    expect(r.width).toBe(200);
    expect(r.height).toBe(120);
    expect(r.x).toBe(50);
    expect(r.y).toBe(pageH - 600 - 120); // 122
    expect(r.rotation).toBe(0);
  });

  it('handles the flipped image CTM convention (negative d) with the same rect', () => {
    const imageCtm: Matrix = [200, 0, 0, -120, 50, 720]; // top-at-v0 convention
    const r = imageRectFromCtm(imageCtm, viewport);
    expect(r.width).toBe(200);
    expect(r.height).toBe(120);
    expect(r.x).toBe(50);
    expect(r.y).toBe(pageH - 720); // 122
  });

  it('returns the bounding box for a rotated image matrix', () => {
    // 90° rotation: x-axis → (0,90), y-axis → (-100,0); origin (100,500)
    const imageCtm: Matrix = [0, 90, -100, 0, 100, 500];
    const r = imageRectFromCtm(imageCtm, viewport);
    expect(r.width).toBe(100);  // bbox spans 100 in x
    expect(r.height).toBe(90);  // bbox spans 90 in y
  });
});
