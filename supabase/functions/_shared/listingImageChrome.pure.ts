/**
 * Is this a photograph of the property, or is it page furniture?
 *
 * Agency listing pages are mostly not photographs. The markup carries the
 * agency logo, the agent's headshot, social icons, "UNDER OFFER" stickers, and —
 * the one that actually reached the marketplace — the little bed/bath/car
 * glyphs that label the spec row. Harvest those and the card leads with a 680-byte
 * line drawing of a bed while the twelve real photographs sit behind it.
 *
 * That is not hypothetical. `https://www.fnutopia.com.au/images/propertyViewer/bed.png`
 * was the hero image on 44 listings, with `bathtub.png` and `car.png` behind it
 * on the same 44. Across the library, 50 of 435 hero slots — 11.5% — were
 * occupied by something under 5 KB.
 *
 * The knowledge lived in `listingScrape.pure.ts`, which filtered its own output
 * and nothing else. Every other way an image can arrive — the Airtable
 * `Listing Image URLs` column, a candidate replayed by the browser, an
 * attachment — went straight past it. So it lives here now, where the scraper,
 * the projection and the harvester all read the same answer.
 *
 * Two tests, deliberately different in kind:
 *
 *  - **The URL**, which is free and runs before anything is downloaded.
 *  - **The size**, which catches what no URL rule can. Chrome is small: every
 *    junk image measured came in under 3,879 bytes and the smallest genuine
 *    photograph was 6,517, so the two populations do not overlap.
 *
 * Pure: no Deno, no DOM. Its one import is the URL decoder, for the reason
 * below.
 */

import { decodedUrlHaystack } from './listingImageAsset.pure.ts';

/**
 * Path fragments that mark an image as furniture, matched as substrings.
 *
 * Every one was observed on a real listing page. Substring matching is blunt,
 * so nothing goes in here that could plausibly appear inside a street name or a
 * photo filename — see `UI_ICON_STEMS` for the words that need a stricter test.
 */
const CHROME_PATH_HINTS = [
  'logo',
  'signature',
  'sig-',
  'socialicon',
  'social-icon',
  'sticker',
  'watermark',
  'spacer',
  'pixel',
  'tracking',
  'open.gif',
  '1x1',
  'facebook',
  'twitter',
  'instagram',
  'linkedin',
  'youtube',
  'tiktok',
  'icon',
  'avatar',
  'headshot',
  'profile-',
  'staff',
  'agent-photo',
  'banner',
  'footer',
  'header-',
  'button',
  'arrow',
  'divider',
  'placeholder',
  'default-',
  'no-image',
  'unsubscribe',
  'favicon',
  'apple-touch',
  /* -- Added after the bed.png incident ---------------------------------- */
  // The UI sprite directory the spec-row glyphs are served from.
  'propertyviewer',
  'property-viewer',
  'sprite',
  // Rex CRM serves agent portraits as `.../account_users/<id>/profile_image/...`.
  // The existing `profile-` hint misses it: that path uses an underscore.
  'profile_',
  '/agents/',
  '/agent/',
  '/team/',
  '/people/',
  // Web-flow and template kits ship a literal `dummy-image` for empty slots.
  'dummy',
  '/ui/',
  '/chrome/',
  /* -- Added after the ProfileFace incident ------------------------------ */
  // The AWS Serverless Image Handler encodes `{"bucket":…,"key":…}` as base64,
  // so none of the hints above could see the path. Decoded, one listing's
  // twelve "photographs" included `ProfileFace/Andrew-Turley.jpg` twice (150 px
  // and 100 px), `ProfileFace/Scott-Rawlings.jpg` twice, `ProfileFace/Leah-Panos.jpg`
  // and `uploaded/SuburbReports-Homepage_BG.jpg`. See `looksLikeChromeUrl`.
  'profileface',
  'profile-face',
  'profilephoto',
  'profile-photo',
  'agentimage',
  'agent-image',
  'suburbreport',
  'homepage_bg',
  'homepage-bg',
  // A path segment that *starts* `team-` is a staff portrait — `team-scott-colour.jpg`
  // was promoted into a hero slot by the visual classifier, which is right that
  // it is a photograph and has no way to know it is a photograph of the agent.
  // Anchored to a segment boundary so a street name containing the letters
  // cannot match.
  '/team-',
  '/team_',
  // Stock libraries. A listing whose "photograph" carries one of these is
  // showing somebody else's picture of somewhere else.
  'unsplash',
  'shutterstock',
  'istockphoto',
  'gettyimages',
  'stock-photo',
  'stockphoto',
];

/**
 * Filenames that are UI glyphs when they stand alone.
 *
 * These need exact-stem matching rather than the substring test above, because
 * every one of them is also an ordinary English word that turns up inside real
 * addresses. `bed.png` is the spec-row icon; `12-bedford-street.jpg` is a house,
 * and a substring rule would throw away the house. Likewise `car.png` against
 * `carlton-road.jpg`, and `land.png` against `landsborough-avenue.jpg`.
 */
const UI_ICON_STEMS = new Set([
  'bed', 'beds', 'bedroom', 'bedrooms',
  'bath', 'baths', 'bathtub', 'bathroom', 'bathrooms', 'shower',
  'car', 'cars', 'carpark', 'carport', 'garage', 'parking',
  'land', 'area', 'size', 'sqm', 'floorplan', 'plan',
  'phone', 'mobile', 'email', 'mail', 'fax', 'print', 'printer',
  'share', 'heart', 'favourite', 'favorite', 'star', 'tick', 'check',
  'map', 'pin', 'location', 'marker', 'search', 'menu', 'close', 'play',
  'thumb', 'thumb1', 'thum1', 'blank', 'empty', 'none',
]);

/** `/420x280` and friends: a CDN's placeholder endpoint, not a photograph. */
const BARE_DIMENSION_PATH = /^\/\d{2,4}\s*x\s*\d{2,4}\/?$/i;

/**
 * The smallest a genuine property photograph has ever been in this corpus.
 *
 * Measured, not guessed. Every junk image found was ≤ 3,879 bytes — the spec
 * glyphs sat at 680, 796 and 873 — and the smallest real photograph was a
 * 160px-wide thumbnail at 6,517. The threshold sits in the gap, closer to the
 * junk, so a genuinely small thumbnail still survives.
 */
export const MIN_PHOTOGRAPH_BYTES = 5_000;

/** The filename without its extension, lower-cased. */
function filenameStem(pathname: string): string {
  const last = pathname.split('/').filter(Boolean).pop() ?? '';
  return last.replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase();
}

/**
 * Whether this URL is page furniture rather than a photograph of the property.
 *
 * Errs towards keeping: a stale photograph on a card is a much smaller failure
 * than a missing one, and the size test downstream catches most of what slips
 * through here.
 *
 * The hints are matched against the **decoded** URL, not the literal one. A
 * growing share of agency CDNs base64-encode the source path into a segment
 * (`d1x91xybjdkplh.cloudfront.net/eyJidWNrZXQiOiAi…`), which made every hint
 * above unreachable — a whole class of furniture became invisible to a filter
 * that had the right word in its list. `decodedUrlHaystack` opens those
 * segments up; for an ordinary URL it returns the same string this used to
 * build, so nothing that was caught before stops being caught.
 */
export function looksLikeChromeUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const haystack = decodedUrlHaystack(url);
  if (CHROME_PATH_HINTS.some((hint) => haystack.includes(hint))) return true;
  if (BARE_DIMENSION_PATH.test(parsed.pathname)) return true;
  if (UI_ICON_STEMS.has(filenameStem(parsed.pathname))) return true;

  return false;
}

/**
 * Whether a downloaded body is big enough to be a photograph.
 *
 * `null`/`undefined` passes: an unknown size is not evidence of anything, and
 * this must never be the reason a real photo is dropped.
 */
export function isPlausiblePhotographSize(bytes: number | null | undefined): boolean {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return true;
  return bytes >= MIN_PHOTOGRAPH_BYTES;
}
