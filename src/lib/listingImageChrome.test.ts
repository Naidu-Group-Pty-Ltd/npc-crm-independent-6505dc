import { describe, expect, it } from 'vitest';
import {
  MIN_PHOTOGRAPH_BYTES,
  isPlausiblePhotographSize,
  looksLikeChromeUrl,
} from '../../supabase/functions/_shared/listingImageChrome.pure';

/**
 * The two populations this separates were measured, not imagined. Every URL in
 * the "furniture" block below was found sitting in the image library as a
 * stored photograph, and the first three were the hero image on 44 listings
 * apiece.
 */

describe('looksLikeChromeUrl — the images that reached production', () => {
  it.each([
    // The spec-row glyphs. `bed.png` was the card image on 44 listings.
    'https://www.fnutopia.com.au/images/propertyViewer/bed.png',
    'https://www.fnutopia.com.au/images/propertyViewer/bathtub.png',
    'https://www.fnutopia.com.au/images/propertyViewer/car.png',
    'https://www.fnutopia.com.au/images/propertyViewer/phone.png',
    'https://www.fnutopia.com.au/images/propertyViewer/Email.png',
    // A different agency's template kit, same glyphs.
    'https://suna-template-files.s3-ap-southeast-2.amazonaws.com/clients/5062/car.png',
    'https://suna-template-files.s3-ap-southeast-2.amazonaws.com/clients/3918/bath.png',
    'https://suna-template-files.s3-ap-southeast-2.amazonaws.com/clients/3918/bed.png',
    // Webflow's empty-slot filler.
    'https://cdn.prod.website-files.com/6942407227aff4b9a959217f/6942407227aff4b9a959222e_dummy-image.webp',
    // realestate.com.au's placeholder endpoint — a bare dimension path.
    'https://i1.au.reastatic.net/420x280',
    // Rex CRM agent portrait. The old `profile-` hint missed the underscore.
    'https://au-crm.cdns.rexsoftware.com/app/livestore/accounts/289/account_users/15034/profile_image/Doug_100c',
    /* -- Found by looking at what the marketplace was actually leading with -- */
    // An agent's headshot, base64-encoded by an image CDN so no hint could see
    // it. Six of one listing's twelve "photographs" were three agents' faces.
    'https://d1x91xybjdkplh.cloudfront.net/eyJidWNrZXQiOiAiamVsbGlzLWNyYWlnLWJ1Y2tldCIsImtleSI6ICJQcm9maWxlRmFjZS9BbmRyZXctVHVybGV5LmpwZyIsImVkaXRzIjogeyJ3ZWJwIjogeyJxdWFsaXR5IjogODB9LCJyZXNpemUiOiB7IndpZHRoIjogMTUwLCJoZWlnaHQiOiAxNTAsImZpdCI6ICJjb3ZlciJ9LCJzaGFycGVuIjogdHJ1ZX19',
    // A staff portrait the pixels correctly call a photograph. It was promoted
    // into a hero slot when floor-plan demotion cleared the way.
    'https://shore-property.com.au/wp-content/uploads/2022/08/team-scott-colour.jpg',
    // Stock photography: somebody else's picture of somewhere else.
    'https://shore-property.com.au/wp-content/uploads/2022/01/john-fornander-y3_AHHrxUBY-unsplash-1.jpg',
  ])('rejects %s', (url) => {
    expect(looksLikeChromeUrl(url)).toBe(true);
  });

  it.each([
    'https://cdn.agency.test/logo-dark.png',
    'https://cdn.agency.test/assets/icons/share.svg',
    'https://cdn.agency.test/social-icon-facebook.png',
    'https://cdn.agency.test/img/watermark.png',
    'https://cdn.agency.test/team/jane-smith.jpg',
    'https://cdn.agency.test/agents/bob.jpg',
    'https://cdn.agency.test/media/headshot-large.jpg',
    'https://cdn.agency.test/ui/arrow-right.png',
  ])('rejects the ordinary furniture %s', (url) => {
    expect(looksLikeChromeUrl(url)).toBe(true);
  });
});

describe('looksLikeChromeUrl — must not eat real photographs', () => {
  it.each([
    // The whole reason the icon test is on the filename STEM and not a
    // substring: these are houses, and every one contains an icon word.
    'https://cdn.agency.test/listings/12-bedford-street-hawthorn.jpg',
    'https://cdn.agency.test/listings/8-carlton-road-brighton.jpg',
    'https://cdn.agency.test/listings/40-landsborough-avenue.jpg',
    'https://cdn.agency.test/listings/3-bathurst-street.jpg',
    'https://cdn.agency.test/listings/22-planter-close.jpg',
    // `/team-` is anchored to a path segment, so a street that merely contains
    // the letters is untouched.
    'https://cdn.agency.test/listings/12-teamsters-road-front.jpg',
    'https://cdn.agency.test/listings/5-mapleton-drive.jpg',
    'https://cdn.agency.test/listings/master-bedroom-view.jpg',
    'https://cdn.agency.test/listings/ensuite-bathroom.jpg',
    'https://cdn.agency.test/listings/double-garage-and-yard.jpg',
    // Extension-less property CDNs.
    'https://phimg.reapit.website/1ddc41b01aad3d4cd0060625cf541bfe788ed410',
    'https://lh3.googleusercontent.com/d/11P8rPuHULHpyPHoCQweF39EzvAIpCYQL=w1200',
    'https://images.zenu.com.au/600-min/yvhuq0mwe9z1cv45coe9w2zjr025rw94.jpg',
    // A sized rendition path, which is not the same as a bare dimension path.
    'https://images.listonce.com.au/custom/160x/listings/26-moscript-street/01909728_img_01.jpg',
  ])('keeps %s', (url) => {
    expect(looksLikeChromeUrl(url)).toBe(false);
  });

  it('is not fooled by an unparseable value', () => {
    expect(looksLikeChromeUrl('not a url')).toBe(false);
    expect(looksLikeChromeUrl('')).toBe(false);
  });
});

describe('isPlausiblePhotographSize', () => {
  it('rejects everything the junk population occupied', () => {
    // Measured sizes of the glyphs that reached the library.
    for (const bytes of [680, 796, 873, 947, 953, 1048, 1362, 1657, 2288, 3879]) {
      expect(isPlausiblePhotographSize(bytes)).toBe(false);
    }
  });

  it('keeps the smallest genuine photograph in the corpus', () => {
    // A 160px-wide thumbnail, the smallest real photo measured.
    expect(isPlausiblePhotographSize(6_517)).toBe(true);
    expect(isPlausiblePhotographSize(56_126)).toBe(true);
  });

  it('sits in the gap between the two populations', () => {
    expect(MIN_PHOTOGRAPH_BYTES).toBeGreaterThan(3_879);
    expect(MIN_PHOTOGRAPH_BYTES).toBeLessThan(6_517);
  });

  it('treats an unknown size as no evidence', () => {
    // Never the reason a real photograph is dropped.
    expect(isPlausiblePhotographSize(null)).toBe(true);
    expect(isPlausiblePhotographSize(undefined)).toBe(true);
    expect(isPlausiblePhotographSize(Number.NaN)).toBe(true);
  });
});
