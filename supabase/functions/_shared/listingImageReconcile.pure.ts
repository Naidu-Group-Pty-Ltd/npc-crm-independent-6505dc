/**
 * Who is allowed to say a photograph is gone, and where each one sits.
 *
 * The image library has more than one contributor, and that is the whole
 * difficulty. `listing-enrichment` scrapes the agency's listing page and finds
 * the real gallery. Intake writes what it captured into Airtable's
 * `Listing Image URLs`. The browser reads Airtable. None of them sees the same
 * set, and the harvest routine reconciles — it marks anything absent from the
 * candidate list it was handed as `gone`, and `signStoredImages` renders only
 * rows that are `stored`.
 *
 * Put those two facts together and a caller holding a partial view silently
 * empties the gallery. That happened twice:
 *
 *  - The **hourly sweep** reads Airtable's image columns. They were empty on
 *    every record, so it reconciled against `[]` and retired every photograph
 *    enrichment had scraped, on whatever schedule `refresh_after` came round —
 *    reporting success the whole time.
 *  - The **browser** did not have the same problem only because the columns
 *    were empty: `resolve` bailed before harvesting and merely signed what was
 *    stored. The moment intake began filling `Listing Image URLs`, the same
 *    code path began reconciling against the Airtable subset and retiring the
 *    scraped gallery on page load.
 *
 * So retirement became opt-in. `full` is for a caller that saw the whole
 * gallery — enrichment, and nobody else. `additive` is the default: contribute
 * photographs, take a place in the ordering, never remove. Under-retiring
 * leaves a stale photo on a card; over-retiring leaves the card blank, and
 * blank is much worse.
 *
 * Pure so the decisions can be asserted directly — this is exactly the layer
 * whose bugs are invisible in production, because a gallery that empties looks
 * like a listing that never had photos.
 */

import { IMAGE_ORIGIN_RANK, imageIdentity, type ImageCandidate, type ImageOrigin } from './listingImages.pure.ts';
import { canonicalAssetKey } from './listingImageAsset.pure.ts';

/** Whether this pass may retire photographs it was not offered. */
export type Reconciliation = 'full' | 'additive';

/** The parts of a stored row the ordering and retirement rules read. */
export interface HeldImage {
  status: string;
  origin: string | null;
  position: number | null;
  checksum?: string | null;
}

/** Rank an origin, treating anything unrecognised as the weakest source. */
function rankOf(origin: string | null | undefined): number {
  const known = IMAGE_ORIGIN_RANK[(origin ?? '') as ImageOrigin];
  return typeof known === 'number' ? known : IMAGE_ORIGIN_RANK.street_view;
}

/**
 * Where each photograph sits once this pass is applied.
 *
 * In `full` mode the caller's order is the order. In `additive` mode the
 * offered candidates are merged with what is already stored, so three URLs
 * arriving from Airtable cannot push a twelve-shot gallery down to positions
 * 3–14 — they take their place within it. Rank by origin first (an agent's own
 * upload beats a listing-page URL beats a generic scrape beats Street View),
 * then keep each source's own ordering, because within one source the first
 * photograph is the hero shot.
 */
export function planPositions(
  candidates: ImageCandidate[],
  held: Map<string, HeldImage>,
  reconcile: Reconciliation,
): Map<string, number> {
  const offered = new Set(candidates.map(imageIdentity));
  const rows = candidates.map((candidate, index) => ({
    identity: imageIdentity(candidate),
    rank: rankOf(candidate.origin),
    // Offered candidates lead their rank band; held-over ones follow it.
    tie: index,
  }));

  if (reconcile === 'additive') {
    for (const [identity, row] of held) {
      if (offered.has(identity) || row.status !== 'stored') continue;
      rows.push({ identity, rank: rankOf(row.origin), tie: 1_000_000 + (row.position ?? 0) });
    }
  }

  rows.sort((a, b) => a.rank - b.rank || a.tie - b.tie);

  const plan = new Map<string, number>();
  rows.forEach((row, position) => plan.set(row.identity, position));
  return plan;
}

/**
 * The identities this pass should mark `gone`.
 *
 * Takes what the pass actually **touched**, not what it was offered, and the
 * difference is load-bearing. A re-signed Airtable URL arrives under a new
 * identity but is stored against the row already holding those bytes — see the
 * checksum adoption in `harvestListing`. That row's identity is nowhere in the
 * candidate list, so retiring "everything not offered" would mark it `gone` in
 * the same pass that just restored it, and re-blank the gallery this whole
 * mechanism exists to protect.
 *
 * Empty unless the caller owns the set *and* actually found something. Touching
 * nothing means the source had nothing to say — an empty Airtable column, a
 * failed scrape, a listing with no web link — which is not the same claim as
 * "this property has no photographs", and must never be treated as one.
 */
export function identitiesToRetire(
  touched: ReadonlySet<string>,
  held: Map<string, HeldImage>,
  reconcile: Reconciliation,
): string[] {
  if (reconcile !== 'full' || touched.size === 0) return [];
  return Array.from(held.keys()).filter((identity) => !touched.has(identity));
}

/**
 * Whether a pass has any reason to run.
 *
 * Deliberately not a fingerprint comparison. `listing_image_sets.fingerprint`
 * holds whatever the last pass wrote, and with several contributors that is
 * somebody else's set — a browser comparing an Airtable-derived fingerprint
 * against the one enrichment left behind never matches, so every listing looks
 * due on every page load and the library re-harvests continuously. Asking "am I
 * offering a photograph that is not already stored" is the question actually
 * being asked, and it is exact.
 *
 * **A photograph, not a URL.** `stored` carries each held row's identity *and*
 * its asset key, so a candidate the source now serves at a different size than
 * the copy we hold is not "missing". Without that, a listing whose kept
 * rendition and stored rendition disagree is due on every single pass forever:
 * the harvest adopts the sibling it already has, stores no new identity, and
 * the next pass asks the same question and gets the same answer.
 */
export function isHarvestDue(input: {
  candidates: ImageCandidate[];
  /** Identities **and** asset keys of the rows already held. */
  stored: Set<string>;
  refreshAfter: number | null;
  now: number;
  /** False when the listing has no row in `listing_image_sets` yet. */
  known?: boolean;
}): boolean {
  const { candidates, stored, refreshAfter, now, known = true } = input;
  if (candidates.length === 0) return false;
  const missing = (candidate: ImageCandidate) =>
    !stored.has(imageIdentity(candidate)) && !stored.has(canonicalAssetKey(candidate.url));
  if (candidates.some(missing)) return true;
  if (!known) return true;
  return refreshAfter === null || !Number.isFinite(refreshAfter) || refreshAfter <= now;
}
