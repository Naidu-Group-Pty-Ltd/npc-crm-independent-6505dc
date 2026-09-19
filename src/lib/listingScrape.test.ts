import { describe, expect, it } from 'vitest';
import {
  extractJsonLd,
  extractPageImages,
  isPropertyImageUrl,
  parseArea,
  scrapeListingPage,
} from '../../supabase/functions/_shared/listingScrape.pure';

const PAGE_URL = 'https://shore-property.com.au/property/13-larundel-road-city-beach-wa-6015-65803/';

/**
 * Modelled on the real page for 13 Larundel Road — a listing the dashboard shows
 * as "Unknown / – / – / – / Price on request" while its source page carries 62
 * photographs, six bedrooms, four bathrooms and an 809 m² block. The markup
 * shapes here (fancybox `data-thumb` galleries, `no-of-bed` list items, Google
 * Drive-hosted images with no file extension, sticker/logo/social-icon
 * furniture) are all taken from that page.
 */
const FIXTURE = `
<html><head>
  <meta property="og:image" content="https://lh3.googleusercontent.com/d/1vD_SaS6=w1200" />
  <meta property="og:description" content="A rare City Beach offering with ocean views." />
  <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebPage","name":"13 Larundel Road, City Beach, WA, 6015"},
      {"@type":"Residence","numberOfRooms":6,"floorSize":{"value":420}}
    ]}
  </script>
</head><body>
  <img src="/wp-content/uploads/2022/07/shore_LOGO_centred_new.png" />
  <img src="https://shore-property.com.au/wp-content/uploads/2022/08/signature-scott-signature.png" />
  <div style="background-image:url('https://shore-property.com.au/wp-content/uploads/2025/02/socialicons-FB.svg')"></div>
  <div style="background-image:url(https://shore-property.com.au/wp-content/uploads/2023/07/new-SOLD-sticker-WEB.png)"></div>
  <section id="hero" class="hero">
    <a data-fancybox="gallery" data-thumb="https://lh3.googleusercontent.com/d/1K_JI92o=w1200" href="https://lh3.googleusercontent.com/d/1K_JI92o=w1200"></a>
    <a data-fancybox="gallery" data-thumb="https://lh3.googleusercontent.com/d/1vD_SaS6=w1200" href="https://lh3.googleusercontent.com/d/1vD_SaS6=w1200"></a>
    <a data-fancybox="gallery" data-thumb="https://lh3.googleusercontent.com/d/1ojeTwjQ=w1200"></a>
  </section>
  <ul class="property-meta">
    <li class="no-of-bed">6</li>
    <li class="no-of-bath">4</li>
    <li class="no-of-car">2</li>
    <li class="property-land-area">809 Square Meters</li>
  </ul>
  <div class="price">$5,300,000</div>
</body></html>`;

describe('isPropertyImageUrl', () => {
  it('accepts a CDN image with no file extension', () => {
    // The whole gallery on a real agency site was served from Google Drive with
    // `=w1200` in place of an extension; an extension-only test rejected all 62.
    expect(isPropertyImageUrl('https://lh3.googleusercontent.com/d/1K_JI92o=w1200')).toBe(true);
    expect(isPropertyImageUrl('https://agentboxcdn.com.au/media/lt/1/1P4481/17707052210276')).toBe(true);
  });

  it('accepts a plain photo url', () => {
    expect(isPropertyImageUrl('https://example.com/media/house-front.jpg')).toBe(true);
    expect(isPropertyImageUrl('https://example.com/p/img.webp?w=1200')).toBe(true);
  });

  it('rejects the page furniture that surrounds every listing', () => {
    // Each of these was on the real page. Harvesting them would fill the library
    // with the same dozen files repeated across a thousand listings.
    for (const url of [
      'https://shore-property.com.au/wp-content/uploads/2022/07/shore_LOGO_centred_new.png',
      'https://shore-property.com.au/wp-content/uploads/2022/08/signature-scott-signature.png',
      'https://shore-property.com.au/wp-content/uploads/2025/02/socialicons-FB.svg',
      'https://shore-property.com.au/wp-content/uploads/2023/07/new-SOLD-sticker-WEB.png',
      'https://example.com/img/agent-headshot.jpg',
      'https://example.com/assets/1x1.gif',
      'https://track.example.com/open.gif',
      'https://example.com/icons/facebook.png',
    ]) {
      expect(isPropertyImageUrl(url), url).toBe(false);
    }
  });

  it('rejects anything that is not an http(s) url', () => {
    expect(isPropertyImageUrl('data:image/png;base64,AAA')).toBe(false);
    expect(isPropertyImageUrl('ftp://example.com/a.jpg')).toBe(false);
    expect(isPropertyImageUrl('not a url')).toBe(false);
  });
});

describe('extractPageImages', () => {
  it('prefers the gallery attribute over the img tag', () => {
    // Lightbox galleries put the full-size photo in `data-thumb` and a
    // placeholder in `<img src>`. On the real page that was the difference
    // between 62 photographs and 2 logos.
    const images = extractPageImages(FIXTURE, PAGE_URL);
    expect(images).toEqual([
      'https://lh3.googleusercontent.com/d/1K_JI92o=w1200',
      'https://lh3.googleusercontent.com/d/1vD_SaS6=w1200',
      'https://lh3.googleusercontent.com/d/1ojeTwjQ=w1200',
    ]);
  });

  it('drops the logo, signature, social icon and status sticker', () => {
    const images = extractPageImages(FIXTURE, PAGE_URL);
    expect(images.some((u) => /logo|signature|socialicons|sticker/i.test(u))).toBe(false);
  });

  it('resolves a relative url against the page', () => {
    const images = extractPageImages('<img src="/media/front.jpg">', 'https://example.com/p/1/');
    expect(images).toEqual(['https://example.com/media/front.jpg']);
  });

  it('honours the cap', () => {
    const many = Array.from({ length: 40 }, (_, i) => `<img src="https://e.com/p${i}.jpg">`).join('');
    expect(extractPageImages(many, PAGE_URL, 5)).toHaveLength(5);
  });
});

describe('parseArea', () => {
  it('reads the units these sites use', () => {
    expect(parseArea('809 Square Meters')).toBe(809);
    expect(parseArea('Land size 801sqm')).toBe(801);
    expect(parseArea('1,200 m²')).toBe(1200);
    expect(parseArea('0.4 ha')).toBe(4000);
    expect(parseArea('1 acre')).toBe(4047);
    expect(parseArea('no area here')).toBeUndefined();
  });
});

describe('extractJsonLd', () => {
  it('unwraps @graph', () => {
    const nodes = extractJsonLd(FIXTURE);
    expect(nodes).toHaveLength(2);
    expect(nodes[1]).toMatchObject({ '@type': 'Residence', numberOfRooms: 6 });
  });

  it('survives a malformed block', () => {
    expect(extractJsonLd('<script type="application/ld+json">{oops</script>')).toEqual([]);
  });
});

describe('scrapeListingPage', () => {
  it('recovers everything the record was missing', () => {
    const result = scrapeListingPage(FIXTURE, PAGE_URL);
    expect(result).toMatchObject({
      beds: 6,
      baths: 4,
      carSpaces: 2,
      landSizeSqm: 809,
      priceNumeric: 5_300_000,
      priceDisplay: '$5,300,000',
    });
    expect(result.imageUrls.length).toBe(3);
    expect(result.description).toContain('City Beach');
  });

  it('returns an empty result rather than throwing on an unrelated page', () => {
    const result = scrapeListingPage('<html><body><p>Nothing here.</p></body></html>', PAGE_URL);
    expect(result.imageUrls).toEqual([]);
    expect(result.beds).toBeUndefined();
    expect(result.priceNumeric).toBeUndefined();
  });

  it('only reads a price from an element the page calls a price', () => {
    // A "$0 deposit" banner or a stamp-duty figure in the footer is not the
    // asking price, and treating it as one would be worse than showing nothing.
    const page = '<div class="promo">$0 deposit available</div><div class="price">$1,250,000</div>';
    expect(scrapeListingPage(page, PAGE_URL).priceNumeric).toBe(1_250_000);
  });
});
