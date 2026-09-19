import { describe, expect, it } from 'vitest';
import {
  getLayerRank,
  inferBlockLayerKind,
  sortBlocksForRender,
  type RenderLayerKind,
} from '../rendering/layerOrdering';

describe('layerOrdering', () => {
  it('ranks layer kinds in the correct order', () => {
    expect(getLayerRank('page_background')).toBe(0);
    expect(getLayerRank('source_raster')).toBe(10);
    expect(getLayerRank('image')).toBe(20);
    expect(getLayerRank('shape')).toBe(30);
    expect(getLayerRank('table')).toBe(40);
    expect(getLayerRank('text')).toBe(50);
    expect(getLayerRank('unknown')).toBe(60);
    expect(getLayerRank('editor_control')).toBe(100);
    // strictly increasing background → source_raster → image → shape → table → text
    expect(getLayerRank('page_background')).toBeLessThan(getLayerRank('source_raster'));
    expect(getLayerRank('source_raster')).toBeLessThan(getLayerRank('image'));
    expect(getLayerRank('image')).toBeLessThan(getLayerRank('shape'));
    expect(getLayerRank('shape')).toBeLessThan(getLayerRank('table'));
    expect(getLayerRank('table')).toBeLessThan(getLayerRank('text'));
    expect(getLayerRank('text')).toBeLessThan(getLayerRank('editor_control'));
  });

  it('renders source raster before (below) text', () => {
    expect(getLayerRank('source_raster')).toBeLessThan(getLayerRank('text'));
    const sorted = sortBlocksForRender([{ id: 't', type: 'text' }, { id: 'r', sourceRasterRef: {} }]).map((b: any) => b.id);
    expect(sorted).toEqual(['r', 't']);
  });

  it('renders image before (below) text', () => {
    expect(getLayerRank('image')).toBeLessThan(getLayerRank('text'));
    const sorted = sortBlocksForRender([{ id: 't', type: 'text' }, { id: 'i', type: 'image' }]).map((b: any) => b.id);
    expect(sorted).toEqual(['i', 't']);
  });

  it('renders table before (below) text', () => {
    expect(getLayerRank('table')).toBeLessThan(getLayerRank('text'));
    const sorted = sortBlocksForRender([{ id: 't', type: 'text' }, { id: 'tab', type: 'table' }]).map((b: any) => b.id);
    expect(sorted).toEqual(['tab', 't']);
  });

  it('infers kind from block type and structural hints', () => {
    expect(inferBlockLayerKind({ type: 'text' })).toBe('text');
    expect(inferBlockLayerKind({ type: 'textOnPath' })).toBe('text');
    expect(inferBlockLayerKind({ type: 'image' })).toBe('image');
    expect(inferBlockLayerKind({ type: 'shape' })).toBe('shape');
    expect(inferBlockLayerKind({ type: 'table' })).toBe('table');
    expect(inferBlockLayerKind({ type: 'background' })).toBe('page_background');
    expect(inferBlockLayerKind({ sourceRasterRef: { kind: 'pdf_import_raster_ref' } })).toBe('source_raster');
    expect(inferBlockLayerKind({ layerKind: 'editor_control' })).toBe('editor_control');
  });

  it('performs a stable sort for blocks in the same layer', () => {
    const blocks = [
      { id: 'a', type: 'text' },
      { id: 'b', type: 'text' },
      { id: 'c', type: 'text' },
    ];
    expect(sortBlocksForRender(blocks).map((b: any) => b.id)).toEqual(['a', 'b', 'c']);
  });

  it('honors numeric z-index within the same layer without crossing layers', () => {
    const blocks = [
      { id: 'text-z2', type: 'text', zIndex: 2 },
      { id: 'text-z1', type: 'text', zIndex: 1 },
      { id: 'image', type: 'image', zIndex: 99 }, // huge z-index still stays below text (lower layer)
    ];
    const sorted = sortBlocksForRender(blocks).map((b: any) => b.id);
    expect(sorted).toEqual(['image', 'text-z1', 'text-z2']);
  });

  it('does not crash on unknown or malformed blocks', () => {
    expect(inferBlockLayerKind({ type: 'mystery' })).toBe('unknown');
    expect(inferBlockLayerKind(null)).toBe('unknown');
    expect(inferBlockLayerKind(42)).toBe('unknown');
    expect(inferBlockLayerKind({})).toBe('unknown');
    expect(() => sortBlocksForRender([null, undefined, 42, { type: 'text' }, {}] as any[])).not.toThrow();
  });

  it('does not mutate the input array', () => {
    const blocks = [{ type: 'text' }, { type: 'image' }];
    const copy = [...blocks];
    sortBlocksForRender(blocks);
    expect(blocks).toEqual(copy);
  });

  it('exposes a rank for every declared kind', () => {
    const kinds: RenderLayerKind[] = [
      'page_background', 'source_raster', 'image', 'shape', 'table', 'text', 'editor_control', 'unknown',
    ];
    for (const kind of kinds) expect(Number.isFinite(getLayerRank(kind))).toBe(true);
  });
});
