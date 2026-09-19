import { describe, expect, it } from 'vitest';
import {
  canonicalAssetKey,
  declaredRenditionWidth,
  decodedUrlHaystack,
} from '../../supabase/functions/_shared/listingImageAsset.pure';

/**
 * Every URL in this file was read out of `public.listing_images` on 2026-08-19.
 * Nothing here is invented: each block is a set of rows that were sitting on one
 * listing at once, which is to say a reader was being shown the same photograph
 * two or three times over.
 */

describe('canonicalAssetKey — renditions that were duplicate slides in production', () => {
  it('collapses listonce size directories (rec58tOiwSrbPmw6h, slides 1-3)', () => {
    const base = 'https://images.listonce.com.au/custom';
    const tail = 'listings/26-moscript-street-campbells-creek-vic-3451/728/01909728_img_01.jpg?di8o46hlwrQ';
    const medium = canonicalAssetKey(`${base}/m/${tail}`);
    expect(canonicalAssetKey(`${base}/l/${tail}`)).toBe(medium);
    expect(canonicalAssetKey(`${base}/160x/${tail}`)).toBe(medium);
    expect(canonicalAssetKey(`${base}/x500/${tail}`)).toBe(medium);
  });

  it('keeps two different listonce photographs apart', () => {
    const base = 'https://images.listonce.com.au/custom/l/listings/26-moscript-street-campbells-creek-vic-3451/728';
    expect(canonicalAssetKey(`${base}/01909728_img_01.jpg`)).not.toBe(
      canonicalAssetKey(`${base}/01909728_img_02.jpg`),
    );
  });

  it('collapses Rails ActiveStorage variants onto their blob (rec4DpBnwUMgSCJ1B, slides 1 and 4)', () => {
    const host = 'https://www.horshamrealestate.com.au/rails/active_storage/representations/redirect';
    const blob =
      'eyJfcmFpbHMiOnsiZGF0YSI6Ijg4NWJjMzIzLTA3MjYtNGJhZS04N2VmLTliYTJiYjFiMjEzOCIsInB1ciI6ImJsb2JfaWQifX0=--38084d41022b5543f82ea6e93e31c38fb43d6951';
    const at1200 =
      'eyJfcmFpbHMiOnsiZGF0YSI6eyJmb3JtYXQiOiJqcGciLCJyZXNpemVfdG9fbGltaXQiOlsxMjAwLDYzMF19LCJwdXIiOiJ2YXJpYXRpb24ifX0=--ca7ce21a6d542cc032b957f3e0b499b8d746ed93';
    const at1050 =
      'eyJfcmFpbHMiOnsiZGF0YSI6eyJmb3JtYXQiOiJqcGciLCJyZXNpemVfdG9fbGltaXQiOlsxMDUwLDc5OF19LCJwdXIiOiJ2YXJpYXRpb24ifX0=--743e1b22c17ebb53ab9b65fa7a4059af89351409';

    const key = canonicalAssetKey(`${host}/${blob}/${at1200}/IMG_8926.jpg`);
    expect(key).toContain('activestorage:885bc323-0726-4bae-87ef-9ba2bb1b2138');
    expect(canonicalAssetKey(`${host}/${blob}/${at1050}/IMG_8926.jpg`)).toBe(key);
  });

  it('collapses a Rails variant onto the untransformed blob (rec4xejfzE4xH1wxQ, slides 1 and 3)', () => {
    const blob =
      'eyJfcmFpbHMiOnsiZGF0YSI6ImUzYTZmNTg1LTI1MjAtNGZkOC04Y2ZhLWVmNTNkOTYwMGMwZSIsInB1ciI6ImJsb2JfaWQifX0=--81ea1777eac0655da4b4b2232638471832c77acb';
    const variation =
      'eyJfcmFpbHMiOnsiZGF0YSI6eyJmb3JtYXQiOiJqcGciLCJyZXNpemVfdG9fbGltaXQiOls4MDAsbnVsbF19LCJwdXIiOiJ2YXJpYXRpb24ifX0=--eeefcccb7703dc5a96076d5b0451902c28c1555a';
    const rendered = `https://buyers.phoenixsoftware.io/rails/active_storage/representations/redirect/${blob}/${variation}/147872300-image-M.jpg`;
    const original = `https://buyers.phoenixsoftware.io/rails/active_storage/blobs/redirect/${blob}/147872300-image-M.jpg`;
    expect(canonicalAssetKey(rendered)).toBe(canonicalAssetKey(original));
  });

  it('keeps distinct ActiveStorage blobs apart', () => {
    const a =
      'https://buyers.phoenixsoftware.io/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsiZGF0YSI6ImUzYTZmNTg1LTI1MjAtNGZkOC04Y2ZhLWVmNTNkOTYwMGMwZSIsInB1ciI6ImJsb2JfaWQifX0=--81ea/147872300-image-M.jpg';
    const b =
      'https://buyers.phoenixsoftware.io/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsiZGF0YSI6IjM5NWE0MWFjLWJkNzktNGY4Zi1hODYyLTVkZjlmYTk3OWZhNyIsInB1ciI6ImJsb2JfaWQifX0=--c0ed/147872300-image-A.jpg';
    expect(canonicalAssetKey(a)).not.toBe(canonicalAssetKey(b));
  });

  it('collapses a websiteblue size path (rec8BPqruBjmfNvZh, slides 1 and 3)', () => {
    expect(
      canonicalAssetKey(
        'https://resources.websiteblue.com/properties/314518/1920/1080/min/e5c23ebe-348e-4684-8ba4-bddd72c90787.jpeg',
      ),
    ).toBe(
      canonicalAssetKey(
        'https://resources.websiteblue.com/properties/314518/e5c23ebe-348e-4684-8ba4-bddd72c90787.jpeg',
      ),
    );
  });

  it('collapses a base64 thumbor instruction on its inner source (rec8Dz9UcrPrRW2St, slides 1 and 12)', () => {
    const big =
      'https://base64.eagleagent.com.au/WjhtbFRBcGloMFlfS09vWnZYTE9ZZU9ZYmE0PS8xMjAweDc1MC9zbWFydC9odHRwOi8vczMtdXMtd2VzdC0yLmFtYXpvbmF3cy5jb20vZWFnbGVhZ2VudC1vcmlnL3VwbG9hZHMlMjUyRjE3NzE2NTE4NjU1MjgtM295OGFjbnRxem0tNjI4ZTQ3ZTBjY2UwY2IxZGMzOTU1Njk5N2M1YTkxZmQlMjUyRklNR182MTg3LmpwZWc=/uploads%252F1771651865528-3oy8acntqzm-628e47e0cce0cb1dc39556997c5a91fd%252FIMG_6187.jpeg';
    const small =
      'https://base64.eagleagent.com.au/dmItWFRvQlRlMG1INi1YcFZTS2dqOXFQWWIwPS80MDB4MzAwL3NtYXJ0L2h0dHA6Ly9zMy11cy13ZXN0LTIuYW1hem9uYXdzLmNvbS9lYWdsZWFnZW50LW9yaWcvdXBsb2FkcyUyNTJGMTc3MTY1MTg2NTUyOC0zb3k4YWNudHF6bS02MjhlNDdlMGNjZTBjYjFkYzM5NTU2OTk3YzVhOTFmZCUyNTJGSU1HXzYxODcuanBlZw==/uploads%252F1771651865528-3oy8acntqzm-628e47e0cce0cb1dc39556997c5a91fd%252FIMG_6187.jpeg';
    expect(canonicalAssetKey(big)).toBe(canonicalAssetKey(small));
  });

  it('collapses the two sizes of one AWS image-handler asset', () => {
    // `{"bucket":"jellis-craig-bucket","key":"ProfileFace/Scott-Rawlings.jpg","edits":{…150×150…}}`
    const at150 =
      'https://d1x91xybjdkplh.cloudfront.net/eyJidWNrZXQiOiAiamVsbGlzLWNyYWlnLWJ1Y2tldCIsImtleSI6ICJQcm9maWxlRmFjZS9TY290dC1SYXdsaW5ncy5qcGciLCJlZGl0cyI6IHsid2VicCI6IHsicXVhbGl0eSI6IDgwfSwicmVzaXplIjogeyJ3aWR0aCI6IDE1MCwiaGVpZ2h0IjogMTUwLCJmaXQiOiAiY292ZXIifSwic2hhcnBlbiI6IHRydWV9fQ==';
    const at100 =
      'https://d1x91xybjdkplh.cloudfront.net/eyJidWNrZXQiOiAiamVsbGlzLWNyYWlnLWJ1Y2tldCIsImtleSI6ICJQcm9maWxlRmFjZS9TY290dC1SYXdsaW5ncy5qcGciLCJlZGl0cyI6IHsid2VicCI6IHsicXVhbGl0eSI6IDgwfSwicmVzaXplIjogeyJ3aWR0aCI6IDEwMCwiaGVpZ2h0IjogMTAwLCJmaXQiOiAiY292ZXIifSwic2hhcnBlbiI6IHRydWV9fQ==';
    expect(canonicalAssetKey(at150)).toBe(canonicalAssetKey(at100));
    expect(canonicalAssetKey(at150)).toContain('profileface/scott-rawlings');
  });

  it('is stable across www, protocol, query and extension', () => {
    const key = canonicalAssetKey('https://www.agency.test/media/8f2137dff6cc02b39/photo.jpg?w=800');
    expect(canonicalAssetKey('http://agency.test/media/8f2137dff6cc02b39/photo.webp')).toBe(key);
  });

  it('does NOT collapse two photographs that differ only by a short numeric directory', () => {
    // The obvious "strip numeric segments" rule merges these. They are two
    // pictures, so nothing may.
    expect(canonicalAssetKey('https://agency.test/gallery/1/main.jpg')).not.toBe(
      canonicalAssetKey('https://agency.test/gallery/2/main.jpg'),
    );
  });

  it('survives a URL it cannot parse', () => {
    expect(canonicalAssetKey('not a url')).toBe('not a url');
    expect(canonicalAssetKey('')).toBe('');
  });
});

describe('declaredRenditionWidth', () => {
  it('reads a Rails resize instruction', () => {
    const url =
      'https://x.test/rails/active_storage/representations/redirect/a/eyJfcmFpbHMiOnsiZGF0YSI6eyJmb3JtYXQiOiJqcGciLCJyZXNpemVfdG9fbGltaXQiOlsxMjAwLDYzMF19LCJwdXIiOiJ2YXJpYXRpb24ifX0=--ca7/IMG_8926.jpg';
    expect(declaredRenditionWidth(url)).toBe(1200);
  });

  it('reads a size directory', () => {
    expect(declaredRenditionWidth('https://images.zenu.com.au/1200-min/abc.jpg')).toBe(1200);
    expect(declaredRenditionWidth('https://images.listonce.com.au/custom/x500/a/b.jpg')).toBe(500);
  });

  it('returns null when the URL states nothing — an untransformed original', () => {
    expect(declaredRenditionWidth('https://resources.websiteblue.com/properties/314518/e5c2.jpeg')).toBeNull();
  });
});

describe('decodedUrlHaystack', () => {
  it('exposes an encoded path so the chrome filter can read it', () => {
    const url =
      'https://d1x91xybjdkplh.cloudfront.net/eyJidWNrZXQiOiAiamVsbGlzLWNyYWlnLWJ1Y2tldCIsImtleSI6ICJQcm9maWxlRmFjZS9BbmRyZXctVHVybGV5LmpwZyIsImVkaXRzIjogeyJ3ZWJwIjogeyJxdWFsaXR5IjogODB9LCJyZXNpemUiOiB7IndpZHRoIjogMTUwLCJoZWlnaHQiOiAxNTAsImZpdCI6ICJjb3ZlciJ9LCJzaGFycGVuIjogdHJ1ZX19';
    expect(decodedUrlHaystack(url)).toContain('profileface/andrew-turley.jpg');
  });

  it('leaves an ordinary URL as the string the filter always had', () => {
    expect(decodedUrlHaystack('https://Agency.test/Images/Logo.png')).toBe('agency.test/images/logo.png');
  });
});
