/**
 * What reaches the model as measured ground truth.
 *
 * Two failure directions are worse than the gap this closes: a wrong measurement
 * is transcribed as fact, and an empty one reads as "this page has no text" —
 * which on a scanned page is a lie the model would then reproduce.
 */
import { describe, it, expect } from 'vitest';
import {
  buildGroundedReferenceFromLines,
  DEFAULT_GROUNDED_ELEMENT_CAP,
} from '../groundedReferenceFromPdf.pure';
import type { PlacedTextFragment } from '../pdfjsTextGeometry.pure';

const PAGE = { width: 595.28, height: 841.89 };

const line = (over: Partial<PlacedTextFragment> = {}): PlacedTextFragment => ({
  text: 'Borrowing capacity', x: 56.69, y: 72.12, width: 125.05, height: 16.65,
  fontSizePt: 18, baselineYPt: 85.04, hasEOL: false, ...over,
});

describe('buildGroundedReferenceFromLines', () => {
  it('carries measured geometry through verbatim', () => {
    const built = buildGroundedReferenceFromLines([line()], PAGE)!;
    expect(built.dropped).toBe(0);
    expect(built.reference.pageWidth).toBe(595.28);
    expect(built.reference.pageHeight).toBe(841.89);
    // No raster in this path — the page IS the measurement space, so a consumer
    // deriving a scale from image/page gets 1.
    expect(built.reference.imageWidth).toBe(built.reference.pageWidth);
    expect(built.reference.imageHeight).toBe(built.reference.pageHeight);
    expect(built.reference.elements).toEqual([{
      id: 't1', text: 'Borrowing capacity',
      x: 56.69, y: 72.12, width: 125.05, height: 16.65, fontSize: 18,
    }]);
  });

  it('passes a real typeface through and omits the field otherwise', () => {
    expect(buildGroundedReferenceFromLines([line({ fontFamily: 'Playfair Display' })], PAGE)!
      .reference.elements[0].fontFamily).toBe('Playfair Display');
    expect(buildGroundedReferenceFromLines([line()], PAGE)!.reference.elements[0])
      .not.toHaveProperty('fontFamily');
  });

  it('numbers elements so the prompt can reference them', () => {
    const built = buildGroundedReferenceFromLines([line(), line({ y: 200 }), line({ y: 300 })], PAGE)!;
    expect(built.reference.elements.map((e) => e.id)).toEqual(['t1', 't2', 't3']);
  });

  it('rounds to hundredths so the prompt carries no float noise', () => {
    const built = buildGroundedReferenceFromLines(
      [line({ x: 56.694321, y: 72.115999, fontSizePt: 8.4999999 })], PAGE,
    )!;
    expect(built.reference.elements[0]).toMatchObject({ x: 56.69, y: 72.12, fontSize: 8.5 });
  });

  it('skips a line that cannot be placed honestly', () => {
    for (const bad of [{ width: 0 }, { height: -1 }, { x: Number.NaN }, { text: '  ' }]) {
      expect(buildGroundedReferenceFromLines([line(bad as Partial<PlacedTextFragment>)], PAGE)).toBeNull();
    }
    // A bad line among good ones is dropped, not fatal — and does not consume an id.
    const mixed = buildGroundedReferenceFromLines([line({ width: 0 }), line({ text: 'kept' })], PAGE)!;
    expect(mixed.reference.elements).toEqual([expect.objectContaining({ id: 't1', text: 'kept' })]);
  });

  it('falls back to 11pt only when no size was measured', () => {
    expect(buildGroundedReferenceFromLines([line({ fontSizePt: 0 })], PAGE)!.reference.elements[0].fontSize)
      .toBe(11);
    expect(buildGroundedReferenceFromLines([line({ fontSizePt: 7.5 })], PAGE)!.reference.elements[0].fontSize)
      .toBe(7.5);
  });

  it('returns null when the page yields no usable text', () => {
    // Absent grounding correctly means "no measurements — read the document
    // yourself". An empty block would assert the page is blank.
    expect(buildGroundedReferenceFromLines([], PAGE)).toBeNull();
    expect(buildGroundedReferenceFromLines(null, PAGE)).toBeNull();
    expect(buildGroundedReferenceFromLines([line({ text: '' })], PAGE)).toBeNull();
  });

  it('needs a real page size', () => {
    expect(buildGroundedReferenceFromLines([line()], null)).toBeNull();
    expect(buildGroundedReferenceFromLines([line()], { width: 0, height: 841.89 })).toBeNull();
    expect(buildGroundedReferenceFromLines([line()], { width: 595.28, height: 'tall' })).toBeNull();
  });
});

describe('the element cap selects, rather than truncating', () => {
  // Lines arrive in reading order, so `.slice(0, cap)` drops the footer and the
  // page furniture — the model is told about the top of the page and nothing
  // tells it the rest was withheld.
  const heading = line({ text: 'Capacity assessment', fontSizePt: 28, y: 60 });
  const filler = Array.from({ length: 5 }, (_, i) => line({ text: '·', fontSizePt: 6, y: 200 + i * 10 }));
  const footer = line({ text: 'Prepared for A. & J. Sample · 12 June 2026', fontSizePt: 9, y: 800 });
  const page = [heading, ...filler, footer];

  it('keeps the most informative lines and says how many it dropped', () => {
    const built = buildGroundedReferenceFromLines(page, PAGE, { maxElements: 2 })!;
    expect(built.reference.elements.map((e) => e.text))
      .toEqual(['Capacity assessment', 'Prepared for A. & J. Sample · 12 June 2026']);
    expect(built.dropped).toBe(5);
  });

  it('restores reading order after ranking', () => {
    // The footer outscores the heading on characters × size, but a list sorted
    // by prominence reads as a different document than the one being rebuilt.
    const built = buildGroundedReferenceFromLines(page, PAGE, { maxElements: 2 })!;
    expect(built.reference.elements[0].text).toBe('Capacity assessment');
  });

  it('leaves order and count untouched when everything fits', () => {
    const built = buildGroundedReferenceFromLines(page, PAGE)!;
    expect(built.reference.elements.map((e) => e.text)).toEqual(page.map((l) => l.text));
    expect(built.dropped).toBe(0);
  });

  it('breaks a score tie by source order, so the build is deterministic', () => {
    const twins = [line({ text: 'aa' }), line({ text: 'bb' }), line({ text: 'cc' })];
    expect(buildGroundedReferenceFromLines(twins, PAGE, { maxElements: 2 })!.reference.elements.map((e) => e.text))
      .toEqual(['aa', 'bb']);
  });

  it('always keeps at least one element', () => {
    for (const cap of [0, -4, Number.NaN]) {
      const built = buildGroundedReferenceFromLines(page, PAGE, { maxElements: cap })!;
      expect(built.reference.elements.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('defaults to the bound the agent prompt itself slices at', () => {
    const many = Array.from({ length: DEFAULT_GROUNDED_ELEMENT_CAP + 40 }, (_, i) => line({ y: i * 4 }));
    const built = buildGroundedReferenceFromLines(many, PAGE)!;
    expect(built.reference.elements).toHaveLength(DEFAULT_GROUNDED_ELEMENT_CAP);
    expect(built.dropped).toBe(40);
  });
});
