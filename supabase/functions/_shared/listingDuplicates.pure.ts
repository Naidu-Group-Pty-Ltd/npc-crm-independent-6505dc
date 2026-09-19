/**
 * One property, one card.
 *
 * The Property Marketplace was showing 148 listings for **107 distinct
 * addresses**. Measured against `listings_cache` on 2026-08-19: 23 groups of
 * repeats, **38 redundant cards — 26% of the page**. Four of them were on
 * screen twice in one screenshot.
 *
 * ## What is actually happening
 *
 * The intake scenario has no idempotency key, so the same mailbox message is
 * written to Airtable again on a later pass. `14 Yillowra St, Auburn` exists
 * four times, created at 22:34:47, 22:37:34, 22:41:28 and 22:44:53 on one
 * evening — the same price, the same agency, the same four photographs. Every
 * repeat group in the corpus was created inside **ten minutes**, and 19 of 23
 * carry an identical price.
 *
 * Reading the message headers settles it. All eight records for `14 Yillowra
 * St` and `7 New St` come from one thread — *"Fwd: 2025 August Sales Update
 * Newsletter"* — under two `Internet Message ID`s, and **each message produced
 * both properties twice**. So there are two faults stacked: a newsletter
 * forwarded twice, and each forward processed twice.
 *
 * A newsletter legitimately carries several properties, so the message id alone
 * is not the key — one email is *supposed* to become several listings. What
 * identifies a listing is the property.
 *
 * ## The rule, and the case that constrains it
 *
 * Two records are the same listing when they agree on **street address, price
 * text, property type, bedrooms and land size**. Across the twenty groups this
 * matches, every single one agrees on all five and was created 2–10 minutes
 * apart; not one looks like two properties.
 *
 * The constraint is the other kind of repeat. Eleven records share the address
 * `City Beach WA 6015` — and they are **eleven different properties** whose
 * street number never got extracted, priced at $3.4-$4M, $4-$5Ms, Mid $3Ms,
 * $18-20M, $1.65M and so on, across House, Villa and Land. They were written
 * one *second* apart, from a single pass over a single email. Merging on
 * address alone would delete nine real listings.
 *
 * So: **an address with no street number is never a key.** That is what keeps
 * this safe, and it is why the price and specification must agree too rather
 * than the address carrying it alone.
 *
 * ## Never destructive
 *
 * Nothing here deletes an Airtable record. The survivor carries
 * `duplicateCount` — the same field `airtable-proxy` already sets on the best
 * record of a group — so a surface can disclose the merge, and the total
 * travels in `duplicatesRemoved`.
 *
 * ## Why this is not in the proxy, which already tags duplicates
 *
 * `airtable-proxy` groups on `address|suburb|beds|baths` and marks the
 * runners-up, then deliberately removes nothing: "a silent drop is the wrong
 * failure mode", after an earlier version cost 268 of 1,441 records on every
 * read. It left the decision to the client — and **no client ever made it**,
 * which is why the repeats are on screen.
 *
 * Honouring that tag as it stands would be worse than ignoring it. Its key
 * carries no price and no street-number guard, so the eleven City Beach records
 * fall into one group and nine real listings would vanish. It also groups
 * within a single 100-record page, so what it matches is partly an accident of
 * pagination. This module answers the same question over the whole set with a
 * key that cannot make that mistake; the proxy's tags stay as they are.
 *
 * The survivor is the copy with the **most photographs**, then the most
 * recently filed. That is not cosmetic: the four `7 New St` records hold 12,
 * 12, 9 and 12 images, and the reader should get a twelve-photograph gallery
 * rather than whichever record happened to be written last.
 *
 * Pure: no Deno, no DOM, no Supabase.
 */

/** What the rule reads. Every field is optional; absent fields never merge. */
export interface DedupableListing {
  id: string;
  fullAddress?: string | null;
  address?: string | null;
  priceDisplay?: string | null;
  propertyType?: string | null;
  beds?: number | null;
  landSizeSqm?: number | null;
  imageCandidates?: unknown[] | null;
  receivedAt?: Date | string | null;
  createdTime?: Date | string | null;
  /** Set by `dedupeListings` on the surviving copy; also set by `airtable-proxy`. */
  duplicateCount?: number;
  createdAt?: Date | string | null;
}

/**
 * A street address begins with a number.
 *
 * `12 Nancarrow Ave`, `35-37 Harrow Rd`, `unit 4206/59 Queen St` all qualify;
 * `City Beach WA 6015` does not, and that is the whole point — see the module
 * header for the nine listings that rule protects.
 */
const STREET_NUMBERED = /^\s*(?:unit|apt|apartment|lot|shop|suite|villa)?\s*\d/i;

function squash(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, '') : '';
}

/**
 * The identity of the property a record describes, or `null` when the record
 * cannot be identified confidently enough to merge on.
 *
 * `null` is the safe answer and is returned generously: no address, no street
 * number, or no price text all mean "leave this record alone".
 */
export function listingDuplicateKey(listing: DedupableListing): string | null {
  const address = listing.fullAddress ?? listing.address ?? null;
  if (typeof address !== 'string') return null;

  const trimmed = address.trim();
  if (!STREET_NUMBERED.test(trimmed)) return null;

  const addressKey = squash(trimmed);
  if (addressKey.length < 8) return null;

  // The price text is part of the identity rather than a tie-break. Two records
  // for one address that disagree on price are two different things — a
  // re-listing, a unit in the same block, a correction — and merging them would
  // pick one price and silently discard the other.
  const price = squash(listing.priceDisplay);
  if (!price) return null;

  return [
    addressKey,
    price,
    squash(listing.propertyType),
    typeof listing.beds === 'number' ? String(listing.beds) : '',
    typeof listing.landSizeSqm === 'number' ? String(Math.round(listing.landSizeSqm)) : '',
  ].join('|');
}

function filedAt(listing: DedupableListing): number {
  for (const value of [listing.receivedAt, listing.createdTime, listing.createdAt]) {
    if (!value) continue;
    const at = value instanceof Date ? value.getTime() : Date.parse(String(value));
    if (Number.isFinite(at)) return at;
  }
  return 0;
}

function photographCount(listing: DedupableListing): number {
  return Array.isArray(listing.imageCandidates) ? listing.imageCandidates.length : 0;
}

/**
 * Whether `a` is the copy worth keeping.
 *
 * Only ever asked of two records already established to describe one property.
 */
function prefersCopy(a: DedupableListing, b: DedupableListing): boolean {
  const photos = photographCount(a) - photographCount(b);
  if (photos !== 0) return photos > 0;
  const filed = filedAt(a) - filedAt(b);
  if (filed !== 0) return filed > 0;
  // Total tie: keep the incumbent, so the result does not depend on input order.
  return false;
}

export interface DedupedListings<T> {
  listings: T[];
  /** How many records were folded into another. */
  duplicatesRemoved: number;
}

/**
 * One card per property.
 *
 * Order is preserved: the survivor takes the earliest place any of its copies
 * held, so collapsing repeats never reshuffles the page.
 */
export function dedupeListings<T extends DedupableListing>(
  listings: readonly T[] | null | undefined,
): DedupedListings<T> {
  const input = (listings ?? []).filter((listing) => Boolean(listing?.id));
  if (input.length < 2) return { listings: [...input], duplicatesRemoved: 0 };

  const kept: T[] = [];
  const slotByKey = new Map<string, number>();
  const foldedInto = new Map<number, number>();

  for (const listing of input) {
    const key = listingDuplicateKey(listing);
    if (key === null) {
      kept.push(listing);
      continue;
    }

    const at = slotByKey.get(key);
    if (at === undefined) {
      kept.push(listing);
      slotByKey.set(key, kept.length - 1);
      continue;
    }

    if (prefersCopy(listing, kept[at])) kept[at] = listing;
    foldedInto.set(at, (foldedInto.get(at) ?? 0) + 1);
  }

  // Say how many records each survivor stands for, so the merge is disclosable
  // rather than silent.
  for (const [at, count] of foldedInto) {
    kept[at] = { ...kept[at], duplicateCount: count } as T;
  }

  return { listings: kept, duplicatesRemoved: input.length - kept.length };
}
