/**
 * Property-type glyphs for the listings map pins.
 *
 * Each glyph is a *single* path on a 24×24 grid, filled with `evenodd` so the
 * cut-outs (windows, doorways, the ring's centre) come from the same subpaths.
 * Two constraints drove that shape:
 *
 * - Markers are built as raw `divIcon` HTML, one copy per visible pin, so the
 *   markup has to stay small and has to be a string rather than a React tree.
 * - Glyphs render at 10–12px inside a pin head. A stroked lucide icon at that
 *   size scales its 2px stroke down to roughly one device pixel and vanishes
 *   against a coloured pin, so these are solid silhouettes instead.
 *
 * Colour comes from the caller: nothing here names a fill, so the pins keep
 * inheriting the tier tokens and re-theme with the white-label brand.
 */
import type { PropertyGlyph } from '@/lib/listingsMap';

export const PIN_GLYPH_PATHS: Record<PropertyGlyph, string> = {
  // Gabled roof over a body with an open doorway.
  house: 'M12 2.6 1.5 11.8h3.4v9.6h4.8v-5.5h4.6v5.5h4.8v-9.6h3.4Z',
  // A tall tower with window slots beside a shorter one with a doorway.
  apartment:
    'M12.6 2.4h8.8v19h-8.8zM2.6 8.6h10v12.8h-10zM14.5 5.6h2.3v6.2h-2.3zM17.8 5.6h2.3v6.2h-2.3zM4.8 11.6h5.2v3h-5.2zM5.6 17h3.4v4.4H5.6z',
  // A parcel boundary in plan view. Everything more literal — a surveyor's flag,
  // a tree — needs a pole or a trunk, and those land under a device pixel at pin
  // scale: the flag smudged, the tree read as a lollipop.
  land: 'M12 4.4 23.2 12 12 19.6 0.8 12ZM12 8.3 17.6 12 12 15.7 6.4 12Z',
  // Shopfront: awning over a unit with a doorway.
  commercial: 'M1.8 3.4h20.4l1.6 5.2H0.2ZM3.4 10h17.2v11.6H3.4zM9.4 14.2h5.2v7.4H9.4z',
  // A plain disc — "located, type not on record". Solid rather than a ring so it
  // cannot be misread as the `land` parcel outline at pin scale.
  property: 'M12 5.2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6z',
  // A hard hat: dome with a brim, the same mark the Builder Stock tab carries
  // in its own header, so one vocabulary covers the tab and the map. It reads
  // as builder stock at pin scale where a house-with-a-crane does not.
  builder:
    'M3 16.4h18v2.6H3zM12 4.4c3.5 0 6.3 2.9 6.3 6.4v4.2h-2.9V9.6h-1.9v5.4h-3V9.6H8.6v5.4H5.7v-4.2c0-3.5 2.8-6.4 6.3-6.4z',
};

export const PIN_GLYPH_LABELS: Record<PropertyGlyph, string> = {
  house: 'House',
  apartment: 'Apartment',
  land: 'Land',
  commercial: 'Commercial',
  property: 'Other',
  builder: 'Builder stock',
};

/**
 * Inline `<svg>` markup for a glyph, for the `divIcon` HTML path.
 *
 * Safe to interpolate: `glyph` indexes a closed record of author-written paths,
 * so no listing-derived text reaches the markup.
 */
export function pinGlyphSvg(glyph: PropertyGlyph, className: string): string {
  return (
    `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<path fill-rule="evenodd" d="${PIN_GLYPH_PATHS[glyph]}"/>` +
    '</svg>'
  );
}
