/**
 * W1 — the shared text-overlay style builder.
 *
 * These tests pin the properties the editor canvas used to discard. Before this
 * builder existed the canvas hardcoded `overflow:hidden` and
 * `whiteSpace:'pre-wrap'`, overriding the `whiteSpace:'nowrap'` the PDF importer
 * deliberately sets on single-line text — the line wrapped and the remainder was
 * clipped, which is the reported "text boxes constrict their contents".
 */
import { describe, it, expect } from 'vitest';
import {
  buildTextOverlayCssDecls,
  cssDeclsToReactStyle,
  verticalAlignToJustify,
  type ResolvedTextStyle,
} from '@/lib/reportTemplate/rendering/textOverlayStyle.pure';

const base: ResolvedTextStyle = { fontFamily: 'Helvetica', fontSizePt: 12, color: '#000000' };
const decls = (s: Partial<ResolvedTextStyle>, unit: 'pt' | 'px' = 'pt', scale?: number) =>
  buildTextOverlayCssDecls({ ...base, ...s }, { unit, scale });
const find = (list: string[], prop: string) =>
  list.find((d) => d.startsWith(`${prop}:`))?.split(':').slice(1).join(':');

describe('buildTextOverlayCssDecls', () => {
  it('honours whiteSpace — the property the canvas used to throw away', () => {
    expect(find(decls({ whiteSpace: 'nowrap' }), 'white-space')).toBe('nowrap');
    // Absent means absent: no declaration is emitted, so nothing is forced.
    expect(find(decls({}), 'white-space')).toBeUndefined();
  });

  it('prefers the exact numeric weight over the coarse enum', () => {
    expect(find(decls({ fontWeightNumeric: 300, fontWeight: 'normal' }), 'font-weight')).toBe('300');
    expect(find(decls({ fontWeightNumeric: 600, fontWeight: 'bold' }), 'font-weight')).toBe('600');
    // Falls back cleanly when the producer only knows normal/bold.
    expect(find(decls({ fontWeight: 'bold' }), 'font-weight')).toBe('bold');
    expect(find(decls({}), 'font-weight')).toBe('normal');
  });

  it('does not clip by default — matching the export renderer', () => {
    expect(decls({}).some((d) => d.startsWith('overflow:'))).toBe(false);
  });

  it('clips only when the policy asks, or when maxLines implies it', () => {
    expect(find(decls({ overflowPolicy: 'clip' }), 'overflow')).toBe('hidden');
    expect(find(decls({ overflowPolicy: 'visible' }), 'overflow')).toBeUndefined();
    // maxLines is a clamp and is meaningless without cutting the rest off.
    const clamped = decls({ maxLines: 3 });
    expect(find(clamped, 'overflow')).toBe('hidden');
    expect(find(clamped, '-webkit-line-clamp')).toBe('3');
  });

  it('maps vertical alignment onto flex justification', () => {
    expect(verticalAlignToJustify('top')).toBe('flex-start');
    expect(verticalAlignToJustify('middle')).toBe('center');
    expect(verticalAlignToJustify('bottom')).toBe('flex-end');
    expect(find(decls({ verticalAlign: 'middle' }), 'justify-content')).toBe('center');
  });

  it('emits padding the canvas previously forced to zero', () => {
    expect(find(decls({ paddingPt: { top: 2, right: 4, bottom: 6, left: 8 } }), 'padding'))
      .toBe('2pt 4pt 6pt 8pt');
  });

  it('scales every length for the canvas, and none for the export', () => {
    const canvas = decls({ fontSizePt: 10, letterSpacingPt: 0.5, paddingPt: { top: 4 } }, 'px', 2);
    expect(find(canvas, 'font-size')).toBe('20px');
    expect(find(canvas, 'letter-spacing')).toBe('1px');
    expect(find(canvas, 'padding')).toBe('8px 0px 0px 0px');

    const print = decls({ fontSizePt: 10, letterSpacingPt: 0.5 }, 'pt');
    expect(find(print, 'font-size')).toBe('10pt');
    expect(find(print, 'letter-spacing')).toBe('0.5pt');
  });

  it('rounds float noise out of emitted lengths', () => {
    expect(find(decls({ fontSizePt: 12.0000000001 }, 'px', 1.1), 'font-size')).toBe('13.2px');
  });

  it('escapes the family only when the caller asks', () => {
    const escaped = buildTextOverlayCssDecls(
      { ...base, fontFamily: 'My"Font' },
      { unit: 'pt', escapeFamily: (v) => v.replace(/"/g, '&quot;') },
    );
    expect(find(escaped, 'font-family')).toBe('My&quot;Font');
    // The canvas builds a React style object and must NOT escape.
    expect(find(decls({ fontFamily: 'My"Font' }), 'font-family')).toBe('My"Font');
  });

  it('small-caps uses font-variant-caps, not text-transform', () => {
    expect(find(decls({ textTransform: 'small-caps' }), 'font-variant-caps')).toBe('small-caps');
    expect(find(decls({ textTransform: 'small-caps' }), 'text-transform')).toBeUndefined();
    expect(find(decls({ textTransform: 'uppercase' }), 'text-transform')).toBe('uppercase');
  });
});

describe('cssDeclsToReactStyle', () => {
  it('camel-cases plain and vendor-prefixed properties', () => {
    const style = cssDeclsToReactStyle([
      'font-size:12px', 'letter-spacing:1px', '-webkit-line-clamp:3', '-webkit-box-orient:vertical',
    ]);
    expect(style.fontSize).toBe('12px');
    expect(style.letterSpacing).toBe('1px');
    expect(style.WebkitLineClamp).toBe('3');
    expect(style.WebkitBoxOrient).toBe('vertical');
  });

  it('preserves values containing colons', () => {
    expect(cssDeclsToReactStyle(['background:url(a:b)']).background).toBe('url(a:b)');
  });

  it('ignores malformed declarations rather than throwing', () => {
    expect(() => cssDeclsToReactStyle(['', ':', 'novalue:', ':noprop'])).not.toThrow();
    expect(Object.keys(cssDeclsToReactStyle(['', ':', 'novalue:']))).toHaveLength(0);
  });
});
