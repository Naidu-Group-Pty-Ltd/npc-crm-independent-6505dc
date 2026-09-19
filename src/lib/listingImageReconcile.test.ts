import { describe, expect, it } from 'vitest';
import {
  identitiesToRetire,
  isHarvestDue,
  planPositions,
  type HeldImage,
  type Reconciliation,
} from '../../supabase/functions/_shared/listingImageReconcile.pure';
import { canonicalAssetKey } from '../../supabase/functions/_shared/listingImageAsset.pure';
import { imageIdentity, type ImageCandidate, type ImageOrigin } from '@/lib/listingImages';

/**
 * These assert the rule that decides whether the Listings page has photographs
 * at all.
 *
 * The harvest routine reconciles: anything missing from the candidate list it
 * is handed is marked `gone`, and only `stored` rows are rendered. The library
 * has several contributors and none of them sees the same set — enrichment
 * scrapes the agency page, intake writes what it captured into Airtable, the
 * browser reads Airtable — so a caller with a partial view that is allowed to
 * reconcile silently empties the gallery. That is not hypothetical; it is what
 * happened, twice, and neither failure was visible because an empty gallery
 * looks exactly like a listing that never had photos.
 */

const candidate = (url: string, origin: ImageOrigin = 'scraped'): ImageCandidate => ({
  url,
  origin,
});

const held = (
  entries: Array<[string, Partial<HeldImage> & { origin?: ImageOrigin }]>,
): Map<string, HeldImage> =>
  new Map(
    entries.map(([identity, over]) => [
      identity,
      { status: 'stored', origin: 'scraped', position: 0, ...over } as HeldImage,
    ]),
  );

/** What a pass actually wrote, which is what decides retirement. */
const touched = (candidates: ImageCandidate[]): Set<string> =>
  new Set(candidates.map(imageIdentity));

/** The gallery `listing-enrichment` scraped off the agency's own listing page. */
const SCRAPED = ['https://cdn.agency.test/1.jpg', 'https://cdn.agency.test/2.jpg', 'https://cdn.agency.test/3.jpg'];
const scrapedHeld = held(
  SCRAPED.map((url, i) => [imageIdentity(candidate(url)), { position: i, origin: 'scraped' }]),
);

describe('identitiesToRetire', () => {
  it('retires nothing when the caller does not own the set', () => {
    // The browser knows only what Airtable holds. Letting it reconcile retired
    // the whole scraped gallery on page load.
    const airtableOnly = touched([candidate('https://cdn.agency.test/9.jpg', 'listing_url')]);
    expect(identitiesToRetire(airtableOnly, scrapedHeld, 'additive')).toEqual([]);
  });

  it('retires nothing when the caller found nothing, even if it owns the set', () => {
    // "I found nothing" is not "there is nothing". The hourly sweep read
    // Airtable's empty image columns and reconciled against [], marking every
    // scraped photograph `gone` while reporting success.
    expect(identitiesToRetire(touched([]), scrapedHeld, 'full')).toEqual([]);
    expect(identitiesToRetire(touched([]), scrapedHeld, 'additive')).toEqual([]);
  });

  it('retires what a full reconciliation no longer offers', () => {
    // Enrichment re-scraped the page and photo 2 is gone from it.
    const rescraped = touched([candidate(SCRAPED[0]), candidate(SCRAPED[2])]);
    expect(identitiesToRetire(rescraped, scrapedHeld, 'full')).toEqual([
      imageIdentity(candidate(SCRAPED[1])),
    ]);
  });

  it('retires nothing when a full reconciliation offers everything back', () => {
    expect(identitiesToRetire(touched(SCRAPED.map((u) => candidate(u))), scrapedHeld, 'full')).toEqual([]);
  });
});

describe('identitiesToRetire and adopted duplicates', () => {
  it('does not retire a row that was written under a different identity', () => {
    /*
     * A re-signed Airtable URL arrives with a new identity and is stored
     * against the row already holding those bytes. That row's identity is
     * nowhere in the candidate list, so retiring "everything not offered"
     * would mark it `gone` in the very pass that restored it.
     */
    const heldPhoto = imageIdentity(candidate(SCRAPED[0]));
    const resignedArrival = imageIdentity(
      candidate('https://v5.airtableusercontent.com/v3/u/56/56/1785830400000/aaa/bbb', 'airtable'),
    );
    // The pass adopted the held row rather than inserting the new identity.
    const writes = new Set([resignedArrival, heldPhoto]);

    expect(identitiesToRetire(writes, scrapedHeld, 'full')).not.toContain(heldPhoto);
  });
});

describe('planPositions', () => {
  it('merges Airtable arrivals into the stored gallery rather than displacing it', () => {
    // Three URLs from intake must not push a scraped gallery down to positions
    // 3-5 — and must not be dropped either. They take their place in one order.
    const arriving = [candidate('https://cdn.agency.test/hero.jpg', 'listing_url')];
    const plan = planPositions(arriving, scrapedHeld, 'additive');

    expect(plan.size).toBe(4);
    // listing_url outranks scraped, so intake's hero leads.
    expect(plan.get(imageIdentity(arriving[0]))).toBe(0);
    expect(plan.get(imageIdentity(candidate(SCRAPED[0])))).toBe(1);
    expect(plan.get(imageIdentity(candidate(SCRAPED[1])))).toBe(2);
    expect(plan.get(imageIdentity(candidate(SCRAPED[2])))).toBe(3);
  });

  it('keeps the stored gallery in its own order behind the newcomers', () => {
    const shuffled = held([
      [imageIdentity(candidate(SCRAPED[0])), { position: 2 }],
      [imageIdentity(candidate(SCRAPED[1])), { position: 0 }],
      [imageIdentity(candidate(SCRAPED[2])), { position: 1 }],
    ]);
    const plan = planPositions([], shuffled, 'additive');
    expect(plan.get(imageIdentity(candidate(SCRAPED[1])))).toBe(0);
    expect(plan.get(imageIdentity(candidate(SCRAPED[2])))).toBe(1);
    expect(plan.get(imageIdentity(candidate(SCRAPED[0])))).toBe(2);
  });

  it('never leads with Street View when a real photograph exists', () => {
    const withStreetView = held([
      [imageIdentity(candidate('https://maps.test/sv.jpg')), { position: 0, origin: 'street_view' }],
    ]);
    const plan = planPositions([candidate(SCRAPED[0], 'listing_url')], withStreetView, 'additive');
    expect(plan.get(imageIdentity(candidate(SCRAPED[0], 'listing_url')))).toBe(0);
    expect(plan.get(imageIdentity(candidate('https://maps.test/sv.jpg')))).toBe(1);
  });

  it('ignores held rows that are not stored', () => {
    const withGone = held([
      [imageIdentity(candidate(SCRAPED[0])), { position: 0 }],
      [imageIdentity(candidate(SCRAPED[1])), { position: 1, status: 'gone' }],
      [imageIdentity(candidate(SCRAPED[2])), { position: 2, status: 'failed' }],
    ]);
    expect(planPositions([], withGone, 'additive').size).toBe(1);
  });

  it('uses the caller’s order verbatim in full mode, and holds nothing over', () => {
    const rescraped = [candidate(SCRAPED[2]), candidate(SCRAPED[0])];
    const plan = planPositions(rescraped, scrapedHeld, 'full');
    expect(plan.size).toBe(2);
    expect(plan.get(imageIdentity(candidate(SCRAPED[2])))).toBe(0);
    expect(plan.get(imageIdentity(candidate(SCRAPED[0])))).toBe(1);
  });

  it('treats an unrecognised stored origin as the weakest source', () => {
    const odd = held([['url:https://x.test/a.jpg', { position: 0, origin: 'mystery' as never }]]);
    const plan = planPositions([candidate(SCRAPED[0], 'street_view')], odd, 'additive');
    // Street View is ranked, the unknown origin is not, so it sorts no better.
    expect(plan.get(imageIdentity(candidate(SCRAPED[0], 'street_view')))).toBe(0);
  });
});

describe('isHarvestDue', () => {
  const stored = new Set(SCRAPED.map((url) => imageIdentity(candidate(url))));
  const NOW = Date.parse('2026-08-04T12:00:00Z');

  it('is not due when the caller has nothing to offer', () => {
    // Otherwise an empty Airtable column schedules a harvest that can only
    // reconcile against nothing.
    expect(
      isHarvestDue({ candidates: [], stored, refreshAfter: 0, now: NOW }),
    ).toBe(false);
  });

  it('is due the moment a candidate is not already stored', () => {
    expect(
      isHarvestDue({
        candidates: [candidate('https://cdn.agency.test/new.jpg', 'listing_url')],
        stored,
        refreshAfter: NOW + 86_400_000,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('is not due when everything offered is already stored and the window is open', () => {
    // The check that stops a re-harvest on every page load. A fingerprint
    // comparison could not do this: enrichment owns that column, so an
    // Airtable-derived fingerprint never matched it.
    expect(
      isHarvestDue({
        candidates: SCRAPED.map((u) => candidate(u)),
        stored,
        refreshAfter: NOW + 86_400_000,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('is not due for a rendition of a photograph already held', () => {
    // `stored` carries each held row's asset key as well as its identity. The
    // agency now serves the large copy of a shot we hold the medium copy of;
    // that is not a missing photograph. Answering "due" here puts the listing
    // in a state it can never leave — the harvest adopts the sibling it
    // already has, stores no new identity, and the next pass asks again.
    const base = 'https://images.listonce.com.au/custom';
    const tail = 'listings/26-moscript-street-campbells-creek-vic-3451/728/01909728_img_01.jpg';
    const heldMedium = new Set([
      imageIdentity(candidate(`${base}/m/${tail}`)),
      canonicalAssetKey(`${base}/m/${tail}`),
    ]);
    expect(
      isHarvestDue({
        candidates: [candidate(`${base}/l/${tail}`)],
        stored: heldMedium,
        refreshAfter: NOW + 86_400_000,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('is due again once the refresh window elapses', () => {
    expect(
      isHarvestDue({
        candidates: SCRAPED.map((u) => candidate(u)),
        stored,
        refreshAfter: NOW - 1,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('is due for a listing the library has never seen', () => {
    expect(
      isHarvestDue({
        candidates: SCRAPED.map((u) => candidate(u)),
        stored,
        refreshAfter: null,
        now: NOW,
        known: false,
      }),
    ).toBe(true);
  });
});

describe('the regression, end to end', () => {
  it('a browser resolve over an Airtable subset keeps the scraped gallery intact', () => {
    // The exact sequence that emptied the page: enrichment scrapes three
    // photographs; intake later writes one URL into Airtable; the browser
    // resolves and hands that one URL to the harvest.
    const fromAirtable = [candidate('https://cdn.agency.test/intake.jpg', 'listing_url')];

    const retired = identitiesToRetire(touched(fromAirtable), scrapedHeld, 'additive');
    const plan = planPositions(fromAirtable, scrapedHeld, 'additive');

    expect(retired).toEqual([]);
    // All four survive, and every scraped photo still has a position.
    expect(plan.size).toBe(4);
    for (const url of SCRAPED) {
      expect(plan.has(imageIdentity(candidate(url)))).toBe(true);
    }
  });

  it('an hourly sweep over an empty Airtable column keeps the scraped gallery intact', () => {
    const nothing: ImageCandidate[] = [];
    expect(isHarvestDue({ candidates: nothing, stored: new Set(), refreshAfter: 0, now: 1 })).toBe(
      false,
    );
    expect(identitiesToRetire(touched(nothing), scrapedHeld, 'additive')).toEqual([]);
    // Belt and braces: even mislabelled as authoritative, empty retires nothing.
    expect(identitiesToRetire(touched(nothing), scrapedHeld, 'full')).toEqual([]);
  });
});
