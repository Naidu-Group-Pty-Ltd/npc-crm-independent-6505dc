/**
 * QA-33 — a figure the standard presentation cannot draw keeps its data.
 */
import { describe, expect, it } from 'vitest';
import { tabulateVizDirectives } from '@/lib/reports/vizDirectiveTables.pure';

describe('tabulateVizDirectives', () => {
  it('writes a heatmap back as the matrix the prose promised', () => {
    const md = 'The matrix below groups the main amenities by type.\n\n'
      + '{{heatmap: 1,2,3 / 2,1,2 | rows=Schools,Shops | cols=Walk,Drive,Transit | title=Amenity access}}\n';
    const { markdown, tabulated, removed } = tabulateVizDirectives(md);
    expect(tabulated).toBe(1);
    expect(removed).toBe(0);
    expect(markdown).toContain('| Amenity access | Walk | Drive | Transit |');
    expect(markdown).toContain('| Schools | 1 | 2 | 3 |');
    expect(markdown).toContain('| Shops | 2 | 1 | 2 |');
    expect(markdown).not.toContain('{{');
  });

  it('tabulates bars, timeline and tiles with their own numbers, verbatim', () => {
    const md = '{{bars: Schools 82, Transport 61 | title=Amenity | max=100}}\n'
      + '{{timeline: Existing "Highway upgrade", 3-5y "Town centre" | title=Pipeline}}\n'
      + '{{tiles: Median price $1.2m, Days on market 28}}\n';
    const { markdown, tabulated } = tabulateVizDirectives(md);
    expect(tabulated).toBe(3);
    expect(markdown).toContain('| Schools | 82 |');
    expect(markdown).toContain('| Existing | Highway upgrade |');
    expect(markdown).toContain('| Median price | $1.2m |');
  });

  it('removes a directive the parser refuses, exactly as before', () => {
    const { markdown, removed, tabulated } = tabulateVizDirectives('Before {{bars: }} after.');
    expect(removed).toBe(1);
    expect(tabulated).toBe(0);
    expect(markdown).toBe('Before  after.');
  });

  it('leaves an unknown kind and plain prose untouched', () => {
    expect(tabulateVizDirectives('{{unknown: x}} and {not a directive}').markdown).toBe('{{unknown: x}} and {not a directive}');
    expect(tabulateVizDirectives('no braces').markdown).toBe('no braces');
  });
});
