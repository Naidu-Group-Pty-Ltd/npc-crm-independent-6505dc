/**
 * BUILDER STOCK — SOURCE, THEN A VERIFIED WEB PHOTOGRAPH, THEN STREET VIEW.
 *
 * The old rule was "the builder's own image, or nothing", and it was right
 * while the only alternatives were an unverified search hit and a satellite
 * tile. Its cost was a marketplace of empty frames. The rule is now a ranking,
 * and everything worth pinning about it is a way the ranking could go wrong:
 *
 *   A FALLBACK NEVER OUTRANKS A SOURCE, including one that arrives later.
 *   FINDING A URL IS NOT VERIFYING A PROPERTY — and 439 production rows say
 *     `unverified`, so none of them may become displayable retroactively.
 *   STREET VIEW MEANS STREET VIEW; a satellite tile is a roof.
 *   NOTHING BUT THE BUILDER'S OWN FILE IS EVER "Builder supplied".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chooseCardImage, nextImageStage, provenanceOf, rankImage,
  isVerifiedWebImage, isStreetViewImage,
  PROVENANCE_LABEL, WEB_VERIFIED_VERIFICATION,
} from '../../../supabase/functions/_shared/builderStock/imagePriority.pure';
const SHA = 'a'.repeat(64);

/** A builder source row the classifier measured CLEAN. */
const cleanSource = (over: Record<string, unknown> = {}) => ({
  id: 'src-clean',
  source_stage: 'uploaded_document',
  verification_status: 'source_supplied',
  processing_status: 'ready',
  storage_path: 'org/items/item/source/a.png',
  position: 0,
  source_detail: {
    role: 'primary_property', role_evidence_level: 1,
    stored_sha256: SHA,
    marketplace_display_eligible: true,
    marketplace_eligibility_state: 'eligible',
    marketplace_measured: true,
    marketplace_eligibility_version: 2,
  },
  ...over,
});

/** A builder source row that reaches a card only through its repair. */
const repairedSource = (over: Record<string, unknown> = {}) => ({
  id: 'src-repaired',
  source_stage: 'uploaded_document',
  verification_status: 'source_supplied',
  processing_status: 'ready',
  storage_path: 'org/items/item/source/b.png',
  position: 1,
  source_detail: {
    role: 'primary_property', role_evidence_level: 1,
    stored_sha256: SHA,
    marketplace_display_eligible: false,
    marketplace_eligibility_state: 'ineligible',
    marketplace_rejection_reason: 'annotated_marketing_tile',
    marketplace_measured: true,
    marketplace_eligibility_version: 2,
    sanitized_derivative: {
      transformation: 'generative_overlay_inpaint',
      sanitization_version: 2,
      storage_path: 'org/items/item/source/sanitized/v2/b.png',
      derivative_sha256: 'c'.repeat(64),
      original_sha256: SHA,
      verdict: 'eligible',
      repaired_share: 0.125,
    },
  },
  ...over,
});

/** A source row stored but not yet measured — evidence that has not arrived. */
const pendingSource = () => ({
  id: 'src-pending',
  source_stage: 'uploaded_document',
  verification_status: 'source_supplied',
  processing_status: 'ready',
  storage_path: 'org/items/item/source/c.png',
  position: 0,
  source_detail: { role: 'primary_property', role_evidence_level: 1, stored_sha256: SHA },
});

const verifiedWeb = (over: Record<string, unknown> = {}) => ({
  id: 'web-verified',
  source_stage: 'internet_search',
  verification_status: WEB_VERIFIED_VERIFICATION,
  processing_status: 'ready',
  external_url: 'https://example.test/house.jpg',
  position: 0,
  source_detail: {
    property_identity: {
      matched: ['suburb', 'street'],
      verified_at: '2026-08-27T09:00:00Z',
      stock_item_id: 'item-1',
      organisation_id: 'org-a',
    },
  },
  ...over,
});

/** Every historical row: a model reported a URL and nobody checked it. */
const unverifiedWeb = () => ({
  id: 'web-unverified',
  source_stage: 'internet_search',
  verification_status: 'unverified',
  processing_status: 'ready',
  external_url: 'https://example.test/maybe.jpg',
  position: 0,
  source_detail: { query: 'a query', title: 'Something' },
});

const streetView = () => ({
  id: 'sv-1',
  source_stage: 'google_maps',
  verification_status: 'location_derived',
  processing_status: 'ready',
  storage_path: 'org/items/item/google-streetview.jpg',
  position: 0,
  source_detail: {
    product: 'streetview', address: '13 Hummock Rise, Werribee VIC 3030',
    latitude: -37.9, longitude: 144.6,
  },
});

const satellite = () => ({
  ...streetView(),
  id: 'sat-1',
  storage_path: 'org/items/item/google-staticmap.jpg',
  source_detail: { ...streetView().source_detail, product: 'staticmap' },
});

describe('7,8,19 — the builder source wins, and a clean original wins inside it', () => {
  it('7 — a clean builder source is the card image', () => {
    const chosen = chooseCardImage([streetView(), verifiedWeb(), cleanSource()] as never);
    expect(chosen?.image.id).toBe('src-clean');
    expect(chosen?.rank).toBe(1);
    expect(chosen?.provenance).toBe('builder_supplied');
  });

  it('8 — a promotional source that was cleaned is still the card image', () => {
    const chosen = chooseCardImage([verifiedWeb(), streetView(), repairedSource()] as never);
    expect(chosen?.image.id).toBe('src-repaired');
    expect(chosen?.rank).toBe(2);
    expect(chosen?.provenance).toBe('builder_supplied');
  });

  it('19 — a clean original outranks a sanitized derivative of the same source', () => {
    const chosen = chooseCardImage([repairedSource(), cleanSource()] as never);
    expect(chosen?.image.id).toBe('src-clean');
  });

  it('18 — a builder image arriving later takes the card back from a fallback', () => {
    // The fallback that can still hold a card is the VERIFIED web photograph;
    // Street View no longer draws at all. The rule under test is unchanged:
    // the builder's own file takes the card back whenever it arrives.
    const before = chooseCardImage([verifiedWeb()] as never);
    expect(before?.provenance).toBe('web_sourced');
    const after = chooseCardImage([streetView(), verifiedWeb(), cleanSource()] as never);
    expect(after?.provenance).toBe('builder_supplied');
  });
});

describe('9,10,11,12,15,16 — which stage is worth paying for', () => {
  it('7,8 — a usable source means NO paid stage runs', () => {
    expect(nextImageStage([cleanSource()] as never,
      { sourceSettlementComplete: true })).toBe('none');
    expect(nextImageStage([repairedSource()] as never,
      { sourceSettlementComplete: true })).toBe('none');
  });

  it('9 — a source still awaiting its verdict spends NOTHING; it waits', () => {
    // The failure this prevents: paying for a search against a property that
    // is about to gain the builder's own render.
    expect(nextImageStage([pendingSource()] as never,
      { sourceSettlementComplete: true })).toBe('wait');
    // And an upload whose settlement has not finished is the same answer even
    // with no rows yet, because the rows may still be coming.
    expect(nextImageStage([] as never,
      { sourceSettlementComplete: false })).toBe('wait');
  });

  it('10 — a property with conclusively no source image goes to web search', () => {
    expect(nextImageStage([] as never, { sourceSettlementComplete: true }))
      .toBe('web_search');
  });

  it('11 — a verified web photograph means Street View is NOT bought', () => {
    expect(nextImageStage([verifiedWeb()] as never,
      { sourceSettlementComplete: true })).toBe('none');
    const chosen = chooseCardImage([verifiedWeb()] as never);
    expect(chosen?.provenance).toBe('web_sourced');
  });

  it('12 — a search that returned only unverifiable results falls to Street View', () => {
    expect(nextImageStage([unverifiedWeb()] as never,
      { sourceSettlementComplete: true })).toBe('street_view');
  });

  it('15 — Street View is NOT a card image, even when it is all there is', () => {
    /*
     * This reverses rank 4, on the instruction that a card's picture comes
     * from the builder's uploaded stock. A Street View still of a
     * house-and-land lot in an estate under construction is a photograph of
     * bare dirt or, on the reported card, a roundabout — real, and not of the
     * property. The correct blank is the answer this marketplace can act on.
     *
     * `isStreetViewImage` still recognises one, and the rows are untouched:
     * what changed is only what may be DRAWN.
     */
    expect(isStreetViewImage(streetView() as never)).toBe(true);
    expect(chooseCardImage([unverifiedWeb(), streetView()] as never)).toBeNull();
  });

  it('16 — no Street View coverage means no image at all', () => {
    expect(chooseCardImage([unverifiedWeb()] as never)).toBeNull();
    expect(nextImageStage([unverifiedWeb(), satellite()] as never,
      { sourceSettlementComplete: true })).toBe('none');
  });

  it('a satellite tile is location imagery and is never a card image', () => {
    expect(isStreetViewImage(satellite() as never)).toBe(false);
    expect(chooseCardImage([satellite()] as never)).toBeNull();
  });
});

describe('17 — the 439 historical rows stay non-displayable', () => {
  it('an unverified search row is refused', () => {
    expect(isVerifiedWebImage(unverifiedWeb() as never)).toBe(false);
    expect(rankImage(unverifiedWeb() as never)).toBeNull();
    expect(chooseCardImage([unverifiedWeb()] as never)).toBeNull();
  });

  it('the verification state alone is not enough without its evidence', () => {
    // A row hand-edited to the new state, or half-written, has no identity.
    expect(isVerifiedWebImage(verifiedWeb({ source_detail: {} }) as never)).toBe(false);
    expect(isVerifiedWebImage(
      verifiedWeb({ source_detail: { property_identity: { matched: [] } } }) as never,
    )).toBe(false);
    expect(isVerifiedWebImage(verifiedWeb({
      source_detail: { property_identity: { matched: ['suburb'] } },
    }) as never)).toBe(false);
  });
});

describe('20 — no fallback is ever badged Builder supplied', () => {
  it('each tier says what it actually is', () => {
    expect(provenanceOf(cleanSource() as never)).toBe('builder_supplied');
    expect(provenanceOf(repairedSource() as never)).toBe('builder_supplied');
    expect(provenanceOf(verifiedWeb() as never)).toBe('web_sourced');
    // A Street View row is no longer drawable, so it has no provenance to
    // claim — the badge and the ranking are one decision and cannot disagree.
    expect(provenanceOf(streetView() as never)).toBeNull();
    expect(provenanceOf(unverifiedWeb() as never)).toBeNull();
    expect(provenanceOf(satellite() as never)).toBeNull();
  });

  it('the labels are truthful and only one of them claims the builder', () => {
    expect(PROVENANCE_LABEL.builder_supplied).toBe('Builder supplied');
    expect(PROVENANCE_LABEL.web_sourced).toBe('Web sourced');
    expect(PROVENANCE_LABEL.street_view).toBe('Street View');
    const claimsBuilder = Object.entries(PROVENANCE_LABEL)
      .filter(([, label]) => /builder/i.test(label))
      .map(([key]) => key);
    expect(claimsBuilder).toEqual(['builder_supplied']);
  });
});

// ---------------------------------------------------------------------------
// 13, 14 and the rest of the identity rule
// ---------------------------------------------------------------------------

const LOT_13 = {
  addressLine: 'Lot 13 - Hummock Rise, Werribee, VIC - 3030',
  suburb: 'Werribee', state: 'VIC', postcode: '3030',
  developmentName: 'Harpley Estate', builderName: 'Urbane Homes',
};

/*
 * "A search result must be THIS property" (13,14) and the identity binding
 * (21,22) pinned `verifyWebImageIdentity`, the web-search verifier — pipeline
 * machinery that discovered and verified imagery on this deployment. The
 * pipeline left with the portal (network extraction Phase 7): mirror rows
 * arrive from the Builders Network already verified, and the ranking below is
 * what still stands between an unproven row and a client's screen.
 */

/**
 * A STAGE THAT RAN AND FOUND NOTHING IS NOT A STAGE THAT WAS NEVER RUN.
 *
 * PRODUCTION, 28 AUGUST 2026, upload `55d12d53`. Three cards were blank on the
 * live Marketplace with Street View NEVER ATTEMPTED behind them:
 *
 *   Lot 1663 Ringer Street   4 x internet_search ready, all unverified
 *                            (Coridale estate renders — a club, a sales
 *                            office, a landscape), google_maps: "Skipped: the
 *                            builder supplied an image for this property."
 *   Lot 3 Yamanto            1 x internet_search ready, unverified
 *   Lot 1342 Austin Estate   internet_search unavailable, no rows at all
 *
 * None of the three held a builder image, so that skip message was false. The
 * skip row is byte-identical to a "ran and found nothing" row, so an untried
 * stage and an exhausted one could not be told apart; and `nextImageStage`
 * counted a stage as attempted only where it had left a READY row, so a search
 * that returned nothing was asked for again while Street View waited below it.
 * Then `failed` — terminal in `readFallbackQueue` — retired the property.
 */
describe('the ladder reaches every stage before a property is called blank', () => {
  const searchedAndFoundNothing = () => ({
    id: 'web-none',
    source_stage: 'internet_search',
    source_reference: 'stage-status',
    verification_status: 'unverified',
    processing_status: 'unavailable',
    position: 0,
    source_detail: {},
  });
  const streetViewSearchedAndFoundNothing = () => ({
    id: 'sv-none',
    source_stage: 'google_maps',
    source_reference: 'stage-status',
    verification_status: 'location_derived',
    processing_status: 'unavailable',
    position: 0,
    source_detail: {},
  });

  it('moves to Street View after a search that returned nothing', () => {
    // Lot 1342 Austin Estate: "No published imagery was found for this property."
    expect(nextImageStage([searchedAndFoundNothing()] as never, {
      sourceSettlementComplete: true,
    })).toBe('street_view');
  });

  it('moves to Street View after a search that returned only unverified hits', () => {
    // Lot 1663 Ringer Street: four Coridale estate renders, none of them it.
    expect(nextImageStage([unverifiedWeb(), unverifiedWeb()] as never, {
      sourceSettlementComplete: true,
    })).toBe('street_view');
  });

  it('does not ask for the same empty search twice', () => {
    const after = nextImageStage([searchedAndFoundNothing()] as never, {
      sourceSettlementComplete: true,
    });
    expect(after).not.toBe('web_search');
  });

  it('is genuinely finished only when BOTH paid stages have run', () => {
    expect(nextImageStage(
      [searchedAndFoundNothing(), streetViewSearchedAndFoundNothing()] as never,
      { sourceSettlementComplete: true },
    )).toBe('none');
  });

  it('still spends nothing while the builder source is unsettled', () => {
    expect(nextImageStage([pendingSource()] as never, {
      sourceSettlementComplete: false,
    })).toBe('wait');
  });

  it('still spends nothing once the builder supplied a usable image', () => {
    expect(nextImageStage([cleanSource()] as never, {
      sourceSettlementComplete: true,
    })).toBe('none');
  });

  it('a verified web photograph still stops the ladder before Street View', () => {
    expect(nextImageStage([verifiedWeb()] as never, {
      sourceSettlementComplete: true,
    })).toBe('none');
  });
});
