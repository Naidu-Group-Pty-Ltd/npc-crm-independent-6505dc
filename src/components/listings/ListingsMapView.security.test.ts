import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/components/listings/ListingsMapView.tsx'),
  'utf8',
);

describe('ListingsMapView address privacy', () => {
  it('uses saved coordinates without geocoding listing addresses in the browser', () => {
    expect(source).toContain('getStoredListingPoint(listing)');
    expect(source).not.toContain('geocodeAddress');
    expect(source).not.toContain('buildFullAddress');
  });
});
