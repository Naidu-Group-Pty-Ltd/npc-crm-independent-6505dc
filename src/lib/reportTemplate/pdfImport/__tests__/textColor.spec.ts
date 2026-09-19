import { describe, it, expect } from 'vitest';
import { collectColorSamples, nearestColor, type TextColorCommand } from '../textColor';
import type { Matrix } from '../vectorExtract';

describe('collectColorSamples', () => {
  it('samples the active fill colour at each show, using the text-matrix origin', () => {
    const cmds: TextColorCommand[] = [
      { op: 'setFillColor', color: '#ff0000' },
      { op: 'beginText' },
      { op: 'setTextMatrix', m: [1, 0, 0, 1, 100, 700] },
      { op: 'showText' },
      { op: 'setFillColor', color: '#0000ff' },
      { op: 'moveText', tx: 0, ty: -20 }, // next line, 20 down
      { op: 'showText' },
    ];
    const s = collectColorSamples(cmds);
    expect(s).toHaveLength(2);
    expect(s[0]).toEqual({ x: 100, y: 700, color: '#ff0000' });
    expect(s[1]).toEqual({ x: 100, y: 680, color: '#0000ff' });
  });

  it('honours save/restore of fill colour and CTM (text matrix is BT-scoped)', () => {
    const cmds: TextColorCommand[] = [
      { op: 'setFillColor', color: '#111111' },
      { op: 'save' },
      { op: 'transform', m: [1, 0, 0, 1, 50, 0] }, // translate the CTM
      { op: 'setFillColor', color: '#222222' },
      { op: 'beginText' },
      { op: 'setTextMatrix', m: [1, 0, 0, 1, 10, 500] },
      { op: 'showText' },
      { op: 'restore' },
      { op: 'beginText' },
      { op: 'setTextMatrix', m: [1, 0, 0, 1, 10, 500] },
      { op: 'showText' },
    ];
    const s = collectColorSamples(cmds);
    expect(s[0]).toEqual({ x: 60, y: 500, color: '#222222' }); // CTM translate applied
    expect(s[1]).toEqual({ x: 10, y: 500, color: '#111111' }); // CTM + colour restored
  });

  it('advances by the leading on T* (nextLine)', () => {
    const cmds: TextColorCommand[] = [
      { op: 'setFillColor', color: '#00aa00' },
      { op: 'beginText' },
      { op: 'setTextMatrix', m: [1, 0, 0, 1, 0, 400] },
      { op: 'setLeading', leading: 14 },
      { op: 'showText' },
      { op: 'nextLine' },
      { op: 'showText' },
    ];
    const s = collectColorSamples(cmds);
    expect(s[0].y).toBe(400);
    expect(s[1].y).toBe(386); // 400 − leading(14)
  });
});

describe('nearestColor', () => {
  const samples = [
    { x: 100, y: 700, color: '#ff0000' },
    { x: 100, y: 680, color: '#0000ff' },
  ];

  it('matches a span to the sample on its baseline', () => {
    expect(nearestColor(samples, 140, 700)).toBe('#ff0000');
    expect(nearestColor(samples, 140, 680)).toBe('#0000ff');
  });

  it('prefers the same-baseline sample even when another is closer in x', () => {
    const s = [
      { x: 0, y: 500, color: '#aaaaaa' },
      { x: 300, y: 700, color: '#bbbbbb' },
    ];
    // span at (310, 700): the y=700 sample wins despite the y=500 one being near in x
    expect(nearestColor(s, 310, 700)).toBe('#bbbbbb');
  });

  it('returns undefined when there are no samples', () => {
    expect(nearestColor([], 10, 10)).toBeUndefined();
  });
});
