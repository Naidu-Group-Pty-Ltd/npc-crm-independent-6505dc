import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  fitRectToPage,
  getPageAspectRatio,
  normalizePageSize,
  pageBounds,
  scaleRect,
  type Rect,
} from '../rendering/pageGeometry';

describe('pageGeometry', () => {
  it('normalizes a valid size unchanged', () => {
    expect(normalizePageSize({ width: 595, height: 842 })).toEqual({ width: 595, height: 842 });
  });

  it('falls back for invalid sizes', () => {
    expect(normalizePageSize(null)).toEqual(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize({ width: 0, height: 100 })).toEqual(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize({ width: -10, height: 100 })).toEqual(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize({ width: Number.NaN, height: 100 })).toEqual(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize({ width: 'a', height: 'b' })).toEqual(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize({ width: 100 })).toEqual(DEFAULT_PAGE_SIZE);
  });

  it('honors a custom fallback', () => {
    const fallback = { width: 200, height: 300 };
    expect(normalizePageSize(undefined, fallback)).toEqual(fallback);
  });

  it('computes aspect ratio as width / height', () => {
    expect(getPageAspectRatio({ width: 600, height: 300 })).toBe(2);
    expect(getPageAspectRatio({ width: 595, height: 842 })).toBeCloseTo(0.7066, 3);
  });

  it('returns page bounds anchored at the origin', () => {
    expect(pageBounds({ width: 595, height: 842 })).toEqual({ x: 0, y: 0, width: 595, height: 842 });
  });

  it('scales a rect by a factor', () => {
    const rect: Rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(scaleRect(rect, 2)).toEqual({ x: 20, y: 40, width: 60, height: 80 });
    expect(scaleRect(rect, 1)).toEqual(rect);
  });

  it('clamps a rect inside the page bounds', () => {
    const page = { width: 100, height: 100 };
    // Overflows the right/bottom edges → clamped to remaining space.
    expect(fitRectToPage({ x: 80, y: 80, width: 50, height: 50 }, page)).toEqual({ x: 80, y: 80, width: 20, height: 20 });
    // Fully inside → unchanged.
    expect(fitRectToPage({ x: 10, y: 10, width: 20, height: 20 }, page)).toEqual({ x: 10, y: 10, width: 20, height: 20 });
  });

  it('never produces a negative width/height for out-of-bounds rects', () => {
    const page = { width: 100, height: 100 };
    const clamped = fitRectToPage({ x: 200, y: 200, width: 50, height: 50 }, page);
    expect(clamped.width).toBe(0);
    expect(clamped.height).toBe(0);
    expect(clamped.x).toBeLessThanOrEqual(page.width);
    expect(clamped.y).toBeLessThanOrEqual(page.height);
  });

  it('normalizes negative-extent input rects before clamping', () => {
    const page = { width: 100, height: 100 };
    // width/height negative → treated as the equivalent positive rect.
    expect(fitRectToPage({ x: 30, y: 30, width: -10, height: -10 }, page)).toEqual({ x: 20, y: 20, width: 10, height: 10 });
  });
});
