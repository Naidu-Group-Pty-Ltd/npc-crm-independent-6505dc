/**
 * Builder stock — which image the marketplace card shows.
 *
 * ONE RULE, AND IT IS NOT A RANKING.
 *
 *   A Builder Stock property may display the image the BUILDER SUPPLIED, or no
 *   image at all.
 *
 * Nothing else qualifies. Not a Street View of the street, not a satellite
 * still of the lot, not a search result that might be the development — none
 * of them is a photograph of the property, and a card that shows one is
 * telling a client something untrue about a house they are being asked to buy.
 * The honest alternative to a builder's photograph is an empty frame, so an
 * empty frame is what the card gets.
 *
 * WHAT THIS REPLACES. The earlier rule was a priority list: source-supplied
 * first, then `google_maps`, then `internet_search`. It meant every property
 * whose builder gave us nothing still showed a picture — badged "Location
 * imagery", which reads as a photograph of the property to everyone who is not
 * reading the badge.
 *
 * The other two stages are still WRITTEN. They are provenance, they are how a
 * support question about a missing image gets answered, and the three-stage
 * schema is unchanged. They are simply never chosen.
 *
 * It lives apart from `images.ts` so it can be exercised directly: `images.ts`
 * reaches for Google and Perplexity and cannot be loaded outside the edge
 * runtime, and a rule nothing can test is a rule that drifts.
 */
import {
  comparePrimaryEvidence, isPrimaryRole, readStoredEvidenceLevel, readStoredRole,
} from './sourceImageRole.pure.ts';
import {
  isMarketplaceEligible, needsEligibilityAssessment, readMarketplaceState,
  servableStoredImage, sweepWillJudge,
} from './marketplaceEligibility.pure.ts';
import {
  servableClearanceFor, servableDerivativeFor, type SanitizedDerivative,
} from './sanitizedDerivative.pure.ts';
import { PROCESSED_LIFECYCLE } from './stockLifecycle.pure.ts';
import { readAllRows } from './pagedRead.ts';

/** The stage whose provenance is the builder's own document. */
export const SOURCE_SUPPLIED_STAGE = 'uploaded_document';
/** And the only verification that means "the builder gave us this". */
export const SOURCE_SUPPLIED_VERIFICATION = 'source_supplied';

/** The shape the rule needs. Anything else about an image is irrelevant here. */
export interface DisplayableImage {
  id: string;
  source_stage: string;
  verification_status?: string | null;
  processing_status?: string | null;
  position?: number | null;
  storage_path?: string | null;
  external_url?: string | null;
  /** Carries `role`: what the SOURCE presented this image as. */
  source_detail?: Record<string, unknown> | null;
}

/**
 * May this image be shown on a Builder Stock card?
 *
 * FIVE conditions, every time: the builder's own stage, the verification that
 * says so, a stage that actually completed, bytes to serve — and the role the
 * source gave it.
 *
 * THE ROLE IS THE ONE THAT WAS MISSING, and its absence is the whole defect.
 * The first four say "these exact bytes came out of the builder's source",
 * which was true of the bedroom render that Lot 537 Kirramingly Avenue showed
 * on its card. Only the fifth says "and the source presented this image as THIS
 * property's listing image", which was not true of it and is the only thing
 * that makes the badge "Builder supplied" mean what a client reads it to mean.
 *
 * An image with no recorded role is `unknown`, and `unknown` is never
 * displayable — including every row written before roles existed. Those are
 * demoted and re-derived by `reprocess_source_images` rather than trusted.
 */
export function isDisplayableSourceImage(image: DisplayableImage): boolean {
  return image.source_stage === SOURCE_SUPPLIED_STAGE
    && image.verification_status === SOURCE_SUPPLIED_VERIFICATION
    && image.processing_status === 'ready'
    && !!(image.storage_path || image.external_url)
    && isPrimaryRole(readStoredRole(image.source_detail))
    /*
     * AND WHETHER A CARD WOULD ACTUALLY DRAW IT, which is four more questions
     * and ONE CALL.
     *
     *   the source designating it is not the same as it being a picture to
     *   draw — a facade under a "$25,000 Rebate" ribbon passes all five above
     *   (`marketplaceEligibility.pure.ts`);
     *   or the same photograph with the ribbon taken off — a derivative of
     *   THESE pixels, named by id and SHA-256 and re-measured by the same
     *   classifier, never a substitute picture (`sanitizedDerivative.pure.ts`);
     *   or the same photograph with nothing wrong with it — a clearance, the
     *   precise inspection's finding that the coarse classifier convicted this
     *   picture for a feature of the HOUSE, Lot 537 Kirramingly's white garage
     *   door (`overlayClearance.pure.ts`);
     *   and the column the builder filed it under does not say it is something
     *   other than the house (`columnDeclaration.pure.ts`).
     *
     * IT IS A CALL BECAUSE IT WAS THREE COPIES. This gate,
     * `hasReadySourceImage` and an inline block in `settleItemImages` each
     * asked "is there a servable builder image" in their own words, and the
     * fourth question reached only this one — so a masterplan was refused
     * here and counted as a finished search there, which is exactly the
     * thirteen properties the column rule exists for. See
     * `servableStoredImage`.
     */
    && servableStoredImage(image);
}

/**
 * Does this image serve the builder's ORIGINAL bytes, untouched?
 *
 * True for a measured-clean picture and for one the precise inspection
 * CLEARED; false for one that reaches a card only through a sanitized
 * derivative — the same photograph with a promotional graphic rebuilt out of
 * it. The distinction matters to the ordering below and nowhere else: a
 * derivative is a legitimate card image, it is simply never a better one than
 * a clean file the builder actually supplied.
 */
export function servesCleanOriginal(image: DisplayableImage): boolean {
  return isMarketplaceEligible(image.source_detail)
    || !!servableClearanceFor(image.source_detail);
}

/**
 * The derivative whose object should be SIGNED for this image — or null,
 * meaning the original is the picture.
 *
 * One image row can carry both facts at once: a derivative made under an old
 * conviction, and an eligible verdict (or a clearance) reached since — a
 * better classifier re-judged the same bytes clean, or the precise inspection
 * cleared them. The signing endpoint used to prefer the derivative
 * unconditionally, which served a repaired copy of a photograph the platform
 * itself now judges clean; the builder's own file is always the better
 * picture where both stand. Ordering, never filtering: an image whose only
 * claim to a card IS its derivative still serves it, exactly as before.
 *
 * Lives beside `servesCleanOriginal` so the sort that prefers clean-original
 * ROWS and the signature that picks the clean-original OBJECT are one rule.
 */
export function derivativeToServe(image: DisplayableImage): SanitizedDerivative | null {
  return servesCleanOriginal(image) ? null : servableDerivativeFor(image.source_detail);
}

/**
 * The card's image, from a property's images. Null means "show no image".
 *
 * There is normally exactly one candidate, because at most one image per
 * property can carry `primary_property`. Where a source supplies MORE than
 * one, the strength of the source's own evidence decides first — see
 * `comparePrimaryEvidence`.
 *
 * THE CASE THAT ADDED THAT STEP. A builder keeps a marketing tile in the row's
 * page-cover slot: the property's own facade with "$25,000 Rebate", "VIC" and
 * "LARA" set over it in coloured pills, or "Completed" and "SMSF". It is exact
 * builder-supplied imagery of that exact property, so it is correctly
 * `primary_property` on LEVEL 3 — a structural container designating one
 * image. Where the same property ALSO carries the clean original in a field
 * the builder named for it, that is LEVEL 1, and the level is the only thing
 * that distinguishes them: same property, same provenance, same role. Ordering
 * by `position` picked whichever the reader enumerated first.
 *
 * ORDERING IS NOT WHAT REFUSES A MARKETING TILE — the display gate above is,
 * through `isMarketplaceEligible`. An earlier version of this rule kept the
 * tile whenever the source designated nothing better, and that was wrong: a
 * facade under a status ribbon is not a card image however impeccable its
 * provenance. Ordering only decides between candidates that have ALREADY
 * passed the gate.
 *
 * AND A CLEAN BUILDER ORIGINAL BEATS A CLEANED PROMOTIONAL DERIVATIVE. Both
 * pass the gate — that is settled above — but they are not the same kind of
 * picture: one is the exact file the builder supplied, the other is that file
 * with a graphic rebuilt out of it by this pipeline. Where the same property
 * holds both (a promotional page cover with its repair beside a clean render
 * recovered from the property's own package), the untouched original is the
 * one the card shows, and no repair should have been the deciding vote.
 * Ordering, never filtering: a property whose only displayable picture is a
 * derivative keeps it, exactly as before.
 *
 * `position` and then the id remain the tie-break, so re-running enrichment
 * cannot silently swap a card's picture.
 */
export function chooseDisplayableImage<T extends DisplayableImage>(images: T[]): T | null {
  const displayable = (images ?? []).filter(isDisplayableSourceImage);
  if (!displayable.length) return null;

  return [...displayable].sort((a, b) =>
    (servesCleanOriginal(a) ? 0 : 1) - (servesCleanOriginal(b) ? 0 : 1)
    || comparePrimaryEvidence(
      readStoredEvidenceLevel(a.source_detail), readStoredEvidenceLevel(b.source_detail))
    || (a.position ?? 0) - (b.position ?? 0)
    || String(a.id).localeCompare(String(b.id)))[0];
}

/**
 * What a property's stored stage-1 rows amount to, for the SOURCE repair.
 *
 * Three facts, and the third is the one the repair loop was missing:
 *
 *   `ready`          the property holds at least one usable source-supplied
 *                    image at the required provenance standard — the exact
 *                    test `hasReadySourceImage` has always made, unchanged.
 *   `clean`          at least one of its PRIMARY candidates serves the
 *                    builder's original untouched (measured clean, or cleared
 *                    by the precise inspection).
 *   `convictedOnly`  it has primary candidates and EVERY one of them was
 *                    measured and convicted as a promotional marketing tile.
 *                    Not "none is clean": a candidate still pending — an
 *                    unmeasured container, an uncertain faint pass — is
 *                    evidence that has not arrived, and nothing may be decided
 *                    on it.
 *
 * `convictedOnly` is what licenses the repair to keep reading the property's
 * OWN linked package after the row's cover has already been stored: a
 * promotional cover's mere existence must not end the search for the clean
 * render the same builder supplied for the same property. It licenses nothing
 * else — not another property's package, not a wider search, not a different
 * identity rule.
 */
/*
 * WHAT LEFT WITH THE PORTAL (network extraction Phase 7). This module used to
 * carry the pipeline's own writers beneath this line —
 * `classifyPrimaryImageStanding`, `chooseAndStorePrimaryImage` (the one place
 * that stored `primary_image_id`, re-opened a settled ladder when a cover was
 * re-judged, and cleared a stale pointer rather than preserving it) and
 * `enforceStrictPrimaryImages` (the repair sweep whose over-asking .limit()
 * is why pagedRead.ts exists). They wrote builder_stock_items, the table the
 * decommission migration drops: mirror rows arrive from the Builders Network
 * with their primary pointer already decided, so what remains here is the
 * read side — the displayability rules and the frozen-derivative resolution
 * the marketplace serves from.
 */
