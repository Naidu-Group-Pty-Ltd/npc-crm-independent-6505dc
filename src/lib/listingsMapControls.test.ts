import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const listingsPage = readFileSync(join(process.cwd(), 'src/pages/Listings.tsx'), 'utf8');

/**
 * A control may not delete itself.
 *
 * The builder-stock chip was drawn only while `builderStockAvailable` was
 * true, and that was derived from the layer's `listings.length` — while the
 * layer was fetched only when the toggle was ON. So switching it off emptied
 * the listings, which made `available` false, which unmounted the chip. The
 * reported symptom was "as soon as you click that it disappears": the only way
 * back was reloading the page.
 *
 * Whether this deployment HAS builder stock and whether the reader wants to
 * SEE it are different questions, and only the first may decide whether a
 * control is drawn.
 */
describe('the builder-stock layer control', () => {
  it('fetches on the map view alone, never on the toggle', () => {
    expect(listingsPage).toContain('useBuilderStockMapListings(viewMode === \'map\')');
    expect(listingsPage).not.toMatch(
      /useBuilderStockMapListings\(\s*viewMode === 'map' && showBuilderStockOnMap/,
    );
  });

  it('still lets the toggle decide what the map plots', () => {
    // Removing the gate from the FETCH must not remove it from the LAYER —
    // the chip has to keep doing something.
    expect(listingsPage).toMatch(/showBuilderStockOnMap && builderStockLayer\.listings\.length > 0/);
  });
});
