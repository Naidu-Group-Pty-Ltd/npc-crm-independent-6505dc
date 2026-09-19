import { describe, it, expect, beforeEach } from 'vitest';
import {
  screenToPagePoint,
  makeOverlayForKind,
  draggableKindForOverlayType,
  serializePaletteDrag,
  parsePaletteDrag,
  isOverlayPayload,
  positionOverlayAtPoint,
} from '../overlayDropFactory';

let n = 0;
const makeId = () => `id${++n}`;

describe('screenToPagePoint', () => {
  const rect = { left: 100, top: 50 };

  it('subtracts the stage origin and divides by zoom', () => {
    expect(screenToPagePoint({ clientX: 160, clientY: 110, rect, zoom: 1 })).toEqual({ x: 60, y: 60 });
    expect(screenToPagePoint({ clientX: 200, clientY: 150, rect, zoom: 2 })).toEqual({ x: 50, y: 50 });
  });

  it('clamps to the page origin and rounds', () => {
    expect(screenToPagePoint({ clientX: 0, clientY: 0, rect, zoom: 1 })).toEqual({ x: 0, y: 0 });
    expect(screenToPagePoint({ clientX: 101.4, clientY: 50.6, rect, zoom: 1 })).toEqual({ x: 1, y: 1 });
  });

  it('treats a zero/undefined zoom as 1', () => {
    expect(screenToPagePoint({ clientX: 160, clientY: 110, rect, zoom: 0 })).toEqual({ x: 60, y: 60 });
  });
});

describe('draggableKindForOverlayType', () => {
  it('maps palette overlay types to draggable kinds', () => {
    expect(draggableKindForOverlayType('text')).toBe('text');
    expect(draggableKindForOverlayType('shape')).toBe('rect');
    expect(draggableKindForOverlayType('image')).toBe('image');
  });
  it('returns null for non-draggable / unknown types', () => {
    expect(draggableKindForOverlayType('table')).toBeNull();
    expect(draggableKindForOverlayType('textOnPath')).toBeNull();
    expect(draggableKindForOverlayType(undefined)).toBeNull();
  });
});

describe('makeOverlayForKind', () => {
  beforeEach(() => { n = 0; });

  it('centres a text overlay on the drop point with palette defaults', () => {
    const o = makeOverlayForKind('text', { x: 200, y: 120 }, makeId) as any;
    expect(o.type).toBe('text');
    expect(o.content).toBe('New text'); // uses schema field `content`, not `text`
    expect(o.width).toBe(300);
    expect(o.height).toBe(40);
    expect(o.x).toBe(50); // 200 - 300/2
    expect(o.y).toBe(100); // 120 - 40/2
    expect(o.id).toBe('id1');
  });

  it('builds a rectangle shape overlay', () => {
    const o = makeOverlayForKind('rect', { x: 100, y: 100 }, makeId) as any;
    expect(o.type).toBe('shape');
    expect(o.shape).toBe('rect');
    expect(o.fill).toBe('token:primary');
    expect(o.x).toBe(0); // clamped: 100 - 200/2 = 0
  });

  it('builds an image overlay', () => {
    const o = makeOverlayForKind('image', { x: 300, y: 300 }, makeId) as any;
    expect(o.type).toBe('image');
    expect(o.fit).toBe('cover');
    expect(o.width).toBe(200);
    expect(o.height).toBe(140);
  });
});

describe('unified palette drag payload', () => {
  const overlayItem = { kind: 'overlay' as const, overlay: { id: 'o1', type: 'text', x: 0, y: 0, width: 200, height: 40, content: 'Hi' } as any };
  const blockItem = { id: 'b1', type: 'kpi-grid', props: {}, overlays: [] } as any;

  it('round-trips an overlay payload and detects it', () => {
    const parsed = parsePaletteDrag(serializePaletteDrag(overlayItem));
    expect(parsed).not.toBeNull();
    expect(isOverlayPayload(parsed!)).toBe(true);
  });

  it('round-trips a block payload and detects it is not an overlay', () => {
    const parsed = parsePaletteDrag(serializePaletteDrag(blockItem));
    expect(parsed).not.toBeNull();
    expect(isOverlayPayload(parsed!)).toBe(false);
    expect((parsed as any).type).toBe('kpi-grid');
  });

  it('rejects empty, forged, and unknown payloads', () => {
    expect(parsePaletteDrag('')).toBeNull();
    expect(parsePaletteDrag('{not json')).toBeNull();
    expect(parsePaletteDrag(JSON.stringify(overlayItem))).toBeNull();
    expect(parsePaletteDrag('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('allows each trusted drag token to be consumed only once', () => {
    const token = serializePaletteDrag(overlayItem);
    expect(parsePaletteDrag(token)).toEqual(overlayItem);
    expect(parsePaletteDrag(token)).toBeNull();
  });

  it('rejects payloads not created by the in-page palette', () => {
    expect(parsePaletteDrag(JSON.stringify(overlayItem))).toBeNull();
    expect(parsePaletteDrag(JSON.stringify({ token: 'attacker', item: overlayItem }))).toBeNull();
  });

  it('rejects trusted but schema-invalid palette items', () => {
    const invalid = { kind: 'overlay' as const, overlay: { ...overlayItem.overlay, type: 'script' } } as any;
    expect(parsePaletteDrag(serializePaletteDrag(invalid))).toBeNull();
  });

  it('centres an overlay on the drop point and clamps to origin', () => {
    const o = positionOverlayAtPoint(overlayItem.overlay, { x: 300, y: 200 }) as any;
    expect(o.x).toBe(200); // 300 - 200/2
    expect(o.y).toBe(180); // 200 - 40/2
    expect(o.content).toBe('Hi'); // other fields preserved
    const clamped = positionOverlayAtPoint(overlayItem.overlay, { x: 10, y: 5 }) as any;
    expect(clamped.x).toBe(0); // 10 - 100 clamped
    expect(clamped.y).toBe(0);
  });
});
