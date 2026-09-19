import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ListingCover } from './ListingCover';
import { PIN_GLYPH_PATHS } from './listingPinGlyphs';

afterEach(cleanup);

const cover = (over: Record<string, unknown> = {}) =>
  render(
    <ListingCover
      listing={{ suburb: 'City Beach', state: 'WA', address: '13 Larundel Road', propertyType: 'House', price: 850_000, ...over } as never}
    />,
  );

/** The wash is a gradient class, so read it off the element rather than pixels. */
function washOf(container: HTMLElement): string {
  const root = container.firstElementChild as HTMLElement;
  return Array.from(root.classList).filter((c) => c.startsWith('from-')).join(' ');
}

function glyphPath(container: HTMLElement): string | null {
  return container.querySelector('svg path')?.getAttribute('d') ?? null;
}

describe('ListingCover', () => {
  it('leads with the locality, which is what the record actually knows', () => {
    cover();
    expect(screen.getByText('City Beach WA')).toBeTruthy();
  });

  it('falls back to the address when there is no suburb', () => {
    cover({ suburb: null, state: null });
    expect(screen.getByText('13 Larundel Road')).toBeTruthy();
  });

  it('draws nothing but the glyph when the record has no location at all', () => {
    const { container } = cover({ suburb: null, state: null, address: null });
    expect(container.querySelector('p')).toBeNull();
    expect(glyphPath(container)).toBe(PIN_GLYPH_PATHS.house);
  });

  it('uses the map pin glyph for the property type, so the two views agree', () => {
    expect(glyphPath(cover({ propertyType: 'Apartment' }).container)).toBe(PIN_GLYPH_PATHS.apartment);
    cleanup();
    expect(glyphPath(cover({ propertyType: 'Vacant Land' }).container)).toBe(PIN_GLYPH_PATHS.land);
    cleanup();
    // Nothing on record still has to draw something.
    expect(glyphPath(cover({ propertyType: null }).container)).toBe(PIN_GLYPH_PATHS.property);
  });

  it.each([
    ['under the low ceiling', 430_000, 'from-info/25'],
    ['mid band', 850_000, 'from-success/25'],
    ['high band', 1_400_000, 'from-primary/45'],
    ['top band', 5_300_000, 'from-warning/30'],
  ])('tints by price band: %s', (_label, price, expected) => {
    expect(washOf(cover({ price }).container)).toContain(expected);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['zero', 0],
    // A rental figure or a bad parse must not read as "cheap house" — an
    // unknown price gets the neutral wash, not the bottom band.
    ['negative', -1],
    ['not a number', Number.NaN],
  ])('falls back to the neutral wash when the price is %s', (_label, price) => {
    expect(washOf(cover({ price }).container)).toContain('from-muted/70');
  });

  it('is hidden from assistive tech, because the caption already says there is no photo', () => {
    const { container } = cover();
    expect((container.firstElementChild as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });
});
