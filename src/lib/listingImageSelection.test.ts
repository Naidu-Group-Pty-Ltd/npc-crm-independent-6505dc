import { describe, expect, it } from 'vitest';
import {
  CARD_RENDITION_MAX_BYTES,
  bandOf,
  dedupeListingImages,
  selectListingGallery,
  signatureDistance,
  type SelectableImage,
} from '../../supabase/functions/_shared/listingImageSelection.pure';

const at = (url: string, extra: Partial<SelectableImage> = {}): SelectableImage => ({
  url,
  ...extra,
});

/**
 * The listings named here are real. Each block reproduces a set of rows that
 * were sitting in `public.listing_images` on 2026-08-19 with `status = 'stored'`
 * — which is to say, a set the marketplace was rendering as separate slides.
 */

describe('dedupeListingImages — the three layers', () => {
  it('collapses re-signed Airtable URLs by checksum (rec08CYsD6LXTKzS9: 35 rows, 4 pictures)', () => {
    // Airtable puts the signature in the path, so every read of one attachment
    // arrives as a brand-new URL. The bytes are the only thing that did not
    // change.
    const rows = [
      at('https://v5.airtableusercontent.com/v3/u/56/56/1787148000000/aaa/bbb', {
        checksum: 'dd85', position: 0, bytes: 144_129,
      }),
      at('https://v5.airtableusercontent.com/v3/u/56/56/1787140800000/ccc/ddd', {
        checksum: 'dd85', position: 8, bytes: 144_129,
      }),
      at('https://v5.airtableusercontent.com/v3/u/56/56/1787047200000/eee/fff', {
        checksum: 'dd85', position: 11, bytes: 144_129,
      }),
      at('https://v5.airtableusercontent.com/v3/u/56/56/1787148000000/ggg/hhh', {
        checksum: '108f', position: 1, bytes: 228_086,
      }),
    ];
    const unique = dedupeListingImages(rows);
    expect(unique).toHaveLength(2);
    expect(unique[0].checksum).toBe('dd85');
    expect(unique[1].checksum).toBe('108f');
  });

  it('collapses size renditions by asset key, keeping the sharper copy in the earlier slot', () => {
    const base = 'https://images.listonce.com.au/custom';
    const tail = 'listings/26-moscript-street-campbells-creek-vic-3451/728/01909728_img_01.jpg?di8o46hlwrQ';
    const unique = dedupeListingImages([
      at(`${base}/m/${tail}`, { checksum: 'a', position: 0, bytes: 139_844 }),
      at(`${base}/l/${tail}`, { checksum: 'b', position: 1, bytes: 819_767 }),
      at(`${base}/160x/${tail}`, { checksum: 'c', position: 2, bytes: 6_517 }),
    ]);
    expect(unique).toHaveLength(1);
    expect(unique[0].bytes).toBe(819_767);
  });

  it('prefers a card-sized rendition over a camera original', () => {
    // rec4xejfzE4xH1wxQ held both: the 800 px representation and the 6.9 MB
    // blob it was made from. Drawing the original into a 320 px card is six
    // megabytes of nothing.
    const blob = 'eyJfcmFpbHMiOnsiZGF0YSI6ImUzYTZmNTg1LTI1MjAtNGZkOC04Y2ZhLWVmNTNkOTYwMGMwZSIsInB1ciI6ImJsb2JfaWQifX0=--81ea';
    const variation = 'eyJfcmFpbHMiOnsiZGF0YSI6eyJmb3JtYXQiOiJqcGciLCJyZXNpemVfdG9fbGltaXQiOls4MDAsbnVsbF19LCJwdXIiOiJ2YXJpYXRpb24ifX0=--eeef';
    const unique = dedupeListingImages([
      at(`https://buyers.phoenixsoftware.io/rails/active_storage/representations/redirect/${blob}/${variation}/147872300-image-M.jpg`,
        { checksum: 'a', position: 0, bytes: 150_760 }),
      at(`https://buyers.phoenixsoftware.io/rails/active_storage/blobs/redirect/${blob}/147872300-image-M.jpg`,
        { checksum: 'b', position: 2, bytes: 6_923_482 }),
    ]);
    expect(unique).toHaveLength(1);
    expect(unique[0].bytes).toBe(150_760);
    expect(unique[0].bytes!).toBeLessThan(CARD_RENDITION_MAX_BYTES);
  });

  it('collapses a re-encode only the pixels relate', () => {
    const unique = dedupeListingImages([
      at('https://a.test/one.jpg', { checksum: 'a', signature: 'f0e1d2c3b4a59687' }),
      at('https://b.test/two.jpg', { checksum: 'b', signature: 'f0e1d2c3b4a59683' }),
    ]);
    expect(unique).toHaveLength(1);
  });

  it('does not merge two photographs whose signatures merely both exist', () => {
    const unique = dedupeListingImages([
      at('https://a.test/one.jpg', { checksum: 'a', signature: 'ffffffffffffffff' }),
      at('https://b.test/two.jpg', { checksum: 'b', signature: '0000000000000000' }),
    ]);
    expect(unique).toHaveLength(2);
  });

  it('never merges on absent evidence', () => {
    const unique = dedupeListingImages([
      at('https://a.test/one.jpg'),
      at('https://b.test/two.jpg'),
      at('https://c.test/three.jpg'),
    ]);
    expect(unique).toHaveLength(3);
  });

  it('keeps the surviving copy in the earliest place any copy held', () => {
    const unique = dedupeListingImages([
      at('https://a.test/first.jpg', { checksum: 'x', position: 0 }),
      at('https://a.test/second.jpg', { checksum: 'y', position: 1, bytes: 200_000 }),
      at('https://a.test/third.jpg', { checksum: 'y', position: 2, bytes: 900_000 }),
    ]);
    expect(unique.map((image) => image.url)).toEqual([
      'https://a.test/first.jpg',
      'https://a.test/third.jpg',
    ]);
  });
});

describe('signatureDistance', () => {
  it('is null when either side is missing — absent evidence never merges', () => {
    expect(signatureDistance(null, 'ffffffffffffffff')).toBeNull();
    expect(signatureDistance('ffffffffffffffff', undefined)).toBeNull();
    expect(signatureDistance('ffff', 'ffffffffffffffff')).toBeNull();
  });

  it('counts differing bits', () => {
    expect(signatureDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(signatureDistance('0000000000000000', '000000000000000f')).toBe(4);
    expect(signatureDistance('ffffffffffffffff', '0000000000000000')).toBe(64);
  });
});

describe('bandOf — demotion only', () => {
  it('puts a floor plan last', () => {
    expect(bandOf(at('https://a.test/x.jpg', { kind: 'floorplan' }))).toBe('plan');
  });

  it('demotes furniture the URL admits to', () => {
    expect(bandOf(at('https://www.fnutopia.com.au/images/propertyViewer/bed.png'))).toBe('weak');
  });

  it('demotes an agent headshot hidden inside a base64 CDN path', () => {
    const url =
      'https://d1x91xybjdkplh.cloudfront.net/eyJidWNrZXQiOiAiamVsbGlzLWNyYWlnLWJ1Y2tldCIsImtleSI6ICJQcm9maWxlRmFjZS9BbmRyZXctVHVybGV5LmpwZyIsImVkaXRzIjogeyJ3ZWJwIjogeyJxdWFsaXR5IjogODB9LCJyZXNpemUiOiB7IndpZHRoIjogMTUwLCJoZWlnaHQiOiAxNTAsImZpdCI6ICJjb3ZlciJ9LCJzaGFycGVuIjogdHJ1ZX19';
    expect(bandOf(at(url))).toBe('weak');
  });

  it('demotes a measured square thumbnail', () => {
    expect(bandOf(at('https://cdn.test/anon', { width: 150, height: 150 }))).toBe('weak');
    expect(bandOf(at('https://cdn.test/anon', { width: 1200, height: 800 }))).toBe('standard');
  });

  it('leaves an ordinary photograph exactly where the agent put it', () => {
    expect(bandOf(at('https://phimg.reapit.website/4ade38c197ee0f7810a82fcb5d71790bf244b2a8'))).toBe(
      'standard',
    );
  });

  it('does NOT promote on a filename word', () => {
    // The regression this exists for: `CEA_Main Lockup_Black.png` is an agency
    // logo, and a `main`/`hero`/`facade` hint list lifted it over the
    // photograph on two real listings.
    const logo = at('https://cdn.prod.website-files.com/694/CEA_Main%20Lockup_Black.png');
    const photo = at('https://cdn.prod.website-files.com/694/697_Clare.png');
    expect(bandOf(logo)).toBe(bandOf(photo));
  });
});

describe('bandOf — the corpus signal', () => {
  it('demotes a photograph that other listings also hold', () => {
    // A stock interior render was the hero on 17 listings. It is a genuine
    // photograph by every measure a single image can offer; only the corpus
    // knows it is not a photograph of THIS property.
    expect(bandOf(at('https://images.zenu.com.au/1200-min/7be16.jpg', { sharedListings: 17 }))).toBe('weak');
    expect(bandOf(at('https://images.zenu.com.au/1200-min/7be16.jpg', { sharedListings: 2 }))).toBe('weak');
  });

  it('leaves a photograph unique to its listing alone', () => {
    expect(bandOf(at('https://cdn.test/a.jpg', { sharedListings: 1 }))).toBe('standard');
    expect(bandOf(at('https://cdn.test/a.jpg', { sharedListings: null }))).toBe('standard');
    expect(bandOf(at('https://cdn.test/a.jpg'))).toBe('standard');
  });

  it('demotes what the server saw as a marketing graphic', () => {
    expect(bandOf(at('https://lh3.googleusercontent.com/d/1bCP=w1200', { kind: 'graphic' }))).toBe('weak');
  });

  it('puts a floor plan the server recognised behind everything', () => {
    expect(bandOf(at('https://lh3.googleusercontent.com/d/1yl7=w1200', { kind: 'floorplan' }))).toBe('plan');
  });
});

describe('selectListingGallery', () => {
  it('lifts the first unique photograph over a shared hero', () => {
    // The shape of 279 of 471 listings on 2026-08-19: position 0 is a picture
    // another listing also shows, and the property's own photographs sit behind
    // it.
    const selection = selectListingGallery([
      at('https://cdn.test/agency-stock.jpg', { checksum: 'a', position: 0, sharedListings: 17 }),
      at('https://cdn.test/front.jpg', { checksum: 'b', position: 1, sharedListings: 1 }),
      at('https://cdn.test/kitchen.jpg', { checksum: 'c', position: 2, sharedListings: 1 }),
    ]);
    expect(selection.images.map((image) => image.url)).toEqual([
      'https://cdn.test/front.jpg',
      'https://cdn.test/kitchen.jpg',
      'https://cdn.test/agency-stock.jpg',
    ]);
  });

  it('leaves a listing whose whole gallery is shared exactly as it was', () => {
    // Two records for one property legitimately hold the same photographs.
    // Demotion is a sort, not a filter, so when everything lands in the same
    // band nothing moves — which is the answer that cannot be wrong.
    const rows = [
      at('https://cdn.test/1.jpg', { checksum: 'a', position: 0, sharedListings: 2 }),
      at('https://cdn.test/2.jpg', { checksum: 'b', position: 1, sharedListings: 2 }),
      at('https://cdn.test/3.jpg', { checksum: 'c', position: 2, sharedListings: 2 }),
    ];
    expect(selectListingGallery(rows).images.map((i) => i.url)).toEqual(rows.map((i) => i.url));
  });

  it('orders plans behind furniture behind photographs', () => {
    const selection = selectListingGallery([
      at('https://cdn.test/plan.jpg', { checksum: 'a', position: 0, kind: 'floorplan' }),
      at('https://cdn.test/banner.jpg', { checksum: 'b', position: 1, kind: 'graphic' }),
      at('https://cdn.test/house.jpg', { checksum: 'c', position: 2, kind: 'photo' }),
    ]);
    expect(selection.images.map((image) => image.url)).toEqual([
      'https://cdn.test/house.jpg',
      'https://cdn.test/banner.jpg',
      'https://cdn.test/plan.jpg',
    ]);
  });

  it('caps after de-duplication, so the cap counts photographs', () => {
    const base = 'https://images.zenu.com.au';
    const images = Array.from({ length: 8 }, (_, i) => [
      at(`${base}/600/asset${i}0000000000.jpg`, { checksum: `a${i}`, position: i * 2, bytes: 80_000 }),
      at(`${base}/1200-min/asset${i}0000000000.jpg`, { checksum: `b${i}`, position: i * 2 + 1, bytes: 300_000 }),
    ]).flat();
    const selection = selectListingGallery(images, 12);
    expect(selection.duplicatesRemoved).toBe(8);
    expect(selection.images).toHaveLength(8);
  });

  it('returns nothing for nothing — the later cascade stages are untouched', () => {
    expect(selectListingGallery([]).images).toEqual([]);
    expect(selectListingGallery(undefined).images).toEqual([]);
    expect(selectListingGallery(null).images).toEqual([]);
  });

  it('never empties a gallery it was given one image for', () => {
    // Every rule here demotes; none may drop. A card with a weak photograph is
    // a much smaller failure than a card with nothing.
    const onlyFurniture = [at('https://cdn.test/logo.png', { checksum: 'a', bytes: 900 })];
    expect(selectListingGallery(onlyFurniture).images).toHaveLength(1);
  });

  it('ignores entries with no URL rather than counting them', () => {
    const selection = selectListingGallery([
      at('', { checksum: 'a' }),
      at('https://cdn.test/real.jpg', { checksum: 'b' }),
    ]);
    expect(selection.images.map((image) => image.url)).toEqual(['https://cdn.test/real.jpg']);
  });
});
