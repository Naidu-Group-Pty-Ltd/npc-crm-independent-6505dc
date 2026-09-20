/**
 * A COLUMN THAT SAYS MASTERPLAN MAY NOT SUPPLY A MARKETPLACE PRIMARY IMAGE.
 *
 * PORTED FROM THE NETWORK, NOT REINTERPRETED. `columnDeclaration.pure.ts` and
 * `marketplaceEligibility.pure.ts` in this repository are BYTE-IDENTICAL
 * copies of `Naidu-Group-Pty-Ltd/aurixa-builders`, and both
 * `isDisplayableSourceImage` functions — the edge one and the client mirror —
 * are byte-identical to the network's. Two implementations of one rule is
 * exactly the failure this closes, so the rule changes THERE and travels
 * here, never the other way round.
 *
 * WHY THE CLONE NEEDS IT AT ALL. Measured 19 Sep 2026: 13 of the network's 46
 * live cards led with a picture out of an estate-level column (8
 * `Siting / Masterplan URL`, 4 `Estate Brochure / Location Map URL`, 1
 * `Stage Plan / PlanOfSub URL`). The network now refuses those, but this
 * marketplace reads the `builder_network_stock_*` mirror, whose seed copies
 * EVERY image row with its whole `source_detail` — so collateral pictures
 * carrying `marketplace_display_eligible: true` are present here. Without the
 * rule, a card whose primary is refused for some other reason would rank down
 * onto one of them and draw a subdivision plan where the network draws
 * nothing.
 *
 * WHAT THIS REPOSITORY DOES NOT HAVE, and therefore does not test: the import
 * pipeline. `sourceImages.ts`, `settleItemImages.ts`,
 * `classifyPrimaryImageStanding` and the branch repair live only on the
 * network — the portal was decommissioned out of this database. This side is
 * a READER, so the rule is enforced at the two display gates and nowhere
 * else, which is the whole of its surface here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COLLATERAL_COLUMN_TOKENS, columnCollateralRefusal, columnMaySupplyPrimaryImage,
  readColumnDeclaration, storedColumnMaySupplyPrimaryImage,
} from '../../../supabase/functions/_shared/builderStock/columnDeclaration.pure';
import {
  servableStoredImage,
} from '../../../supabase/functions/_shared/builderStock/marketplaceEligibility.pure';
import {
  isDisplayableSourceImage as edgeIsDisplayable,
} from '../../../supabase/functions/_shared/builderStock/primaryImage';
import { isDisplayableSourceImage as clientIsDisplayable, primaryStockImage } from '../builderStock';
import {
  rankImage,
} from '../../../supabase/functions/_shared/builderStock/imagePriority.pure';

const repoRoot = join(__dirname, '../../..');
const SHARED = join(repoRoot, 'supabase/functions/_shared/builderStock');

/** A stored image that passes every OTHER condition, filed under `column`. */
const imageFiledUnder = (column: string | null | undefined) => ({
  id: `img-${String(column ?? 'none')}`,
  source_stage: 'uploaded_document',
  verification_status: 'source_supplied',
  processing_status: 'ready',
  storage_path: 'o/1.jpg',
  storage_bucket: 'builder-stock-images',
  external_url: null,
  position: 0,
  source_detail: {
    role: 'primary_property',
    role_evidence_level: 1,
    provenance_version: 26,
    marketplace_display_eligible: true,
    marketplace_eligibility_state: 'eligible',
    ...(column === undefined ? {} : { source_column: column }),
  },
});

describe('what a stock list column heading declares', () => {
  it('reads three answers, because absent and undeclared are different facts', () => {
    expect(readColumnDeclaration('Siting / Masterplan URL')).toBe('collateral');
    expect(readColumnDeclaration('Brochure URL')).toBe('undeclared');
    expect(readColumnDeclaration(null)).toBe('absent');
    expect(readColumnDeclaration(undefined)).toBe('absent');
    expect(readColumnDeclaration('   ')).toBe('absent');
  });

  it('fails closed on a heading that is present and unreadable', () => {
    expect(readColumnDeclaration('///')).toBe('collateral');
    expect(readColumnDeclaration('—')).toBe('collateral');
    expect(readColumnDeclaration(42 as unknown)).toBe('collateral');
    expect(readColumnDeclaration({} as unknown)).toBe('collateral');
  });

  it('treats an ABSENT heading as permitted, which is a decision and not a gap', () => {
    // `source_column` is written only by the network's branch recovery, so an
    // image with none never came from a column — it is an embedded asset or a
    // picture a builder uploaded by hand. Refusing those would empty the
    // cards this rule exists to protect.
    expect(columnMaySupplyPrimaryImage(null)).toBe(true);
    expect(storedColumnMaySupplyPrimaryImage({ role: 'primary_property' })).toBe(true);
    expect(storedColumnMaySupplyPrimaryImage(null)).toBe(true);
    expect(storedColumnMaySupplyPrimaryImage(undefined)).toBe(true);
  });

  /*
   * ONE HEADING PER TOKEN THE RULE ADDS, each isolating exactly one. The
   * network's first version of this test named the three production headings
   * and deleting `siting` changed no verdict, because `Siting / Masterplan
   * URL` also says masterplan. That gap was found by mutation, and the same
   * isolating headings are used here so a one-sided edit fails on this side
   * too.
   */
  it.each([
    ['estate', 'Estate Overview'],
    ['siting', 'Siting Diagram'],
    ['location', 'Location Guide'],
    ['plan', 'Plan Set'],
  ])('refuses on `%s` alone — heading %j', (_token, heading) => {
    expect(readColumnDeclaration(heading)).toBe('collateral');
  });

  it('refuses every heading the live network list actually carries', () => {
    for (const heading of [
      'Siting / Masterplan URL',
      'Estate Brochure / Location Map URL',
      'Stage Plan / PlanOfSub URL',
      'Plan of Subdivision', 'Lot Plans', 'Site Plan', 'Aerial Shot', 'Masterplan',
    ]) {
      expect(readColumnDeclaration(heading)).toBe('collateral');
    }
  });

  it('admits the headings the marketplace is actually built on', () => {
    for (const heading of [
      'Brochure URL', 'Brochure V002', 'Facade Photo', 'Property Images',
      'Photos', 'Image URL', 'Render', 'House Photo',
    ]) {
      expect(readColumnDeclaration(heading)).toBe('undeclared');
    }
  });

  it('names the heading in its refusal, and calls it a finding rather than a fault', () => {
    const sentence = columnCollateralRefusal('Siting / Masterplan URL');
    expect(sentence).toContain('Siting / Masterplan URL');
    expect(sentence).toMatch(/declares it to be/i);
    expect(sentence).not.toMatch(/error|failed|could not/i);
  });
});

describe('the gates that decide which picture a marketplace card draws', () => {
  it('the edge gate refuses a picture filed under a collateral column', () => {
    expect(edgeIsDisplayable(imageFiledUnder('Brochure URL'))).toBe(true);
    expect(edgeIsDisplayable(imageFiledUnder('Siting / Masterplan URL'))).toBe(false);
    expect(edgeIsDisplayable(imageFiledUnder('Estate Brochure / Location Map URL'))).toBe(false);
    expect(edgeIsDisplayable(imageFiledUnder('Stage Plan / PlanOfSub URL'))).toBe(false);
  });

  it('the client mirror answers identically, on every heading', () => {
    for (const heading of [
      'Brochure URL', 'Siting / Masterplan URL', 'Estate Brochure / Location Map URL',
      'Stage Plan / PlanOfSub URL', 'Facade Photo', '///',
    ]) {
      const image = imageFiledUnder(heading);
      expect([heading, clientIsDisplayable(image as never)])
        .toEqual([heading, edgeIsDisplayable(image)]);
    }
    const uploaded = imageFiledUnder(undefined);
    expect(clientIsDisplayable(uploaded as never)).toBe(true);
    expect(edgeIsDisplayable(uploaded)).toBe(true);
  });

  /*
   * THE CARD ITSELF, which is the only thing a client sees. `BuilderStockTab`
   * draws `primaryStockImage(item)`, so this is the assertion that the rule
   * reaches a page rather than only a predicate.
   */
  it('a card whose only builder image is collateral draws NOTHING', () => {
    const collateralOnly = {
      id: 'item-1',
      primary_image_id: 'img-Siting / Masterplan URL',
      images: [imageFiledUnder('Siting / Masterplan URL')],
    };
    expect(primaryStockImage(collateralOnly as never)).toBeNull();
  });

  it('a card never RANKS DOWN onto collateral when its brochure is refused', () => {
    /*
     * THE EXPOSURE THIS PORT EXISTS TO CLOSE. The mirror seed copies every
     * image row, so a property can hold both a refused brochure photograph
     * and an eligible masterplan. Ranking is what would have picked the
     * masterplan — the network draws nothing for such a card, and so must
     * this side.
     */
    const refusedBrochure = imageFiledUnder('Brochure URL');
    refusedBrochure.source_detail.marketplace_display_eligible = false;
    (refusedBrochure.source_detail as Record<string, unknown>)
      .marketplace_eligibility_state = 'ineligible';
    (refusedBrochure.source_detail as Record<string, unknown>)
      .marketplace_rejection_reason = 'annotated_marketing_tile';
    const item = {
      id: 'item-2',
      primary_image_id: refusedBrochure.id,
      images: [refusedBrochure, imageFiledUnder('Siting / Masterplan URL')],
    };
    expect(primaryStockImage(item as never)).toBeNull();
  });

  it('and still draws the brochure photograph when there is a good one', () => {
    const item = {
      id: 'item-3',
      primary_image_id: 'img-Brochure URL',
      images: [imageFiledUnder('Siting / Masterplan URL'), imageFiledUnder('Brochure URL')],
    };
    expect(primaryStockImage(item as never)?.id).toBe('img-Brochure URL');
  });
});

describe('one rule, not two interpretations', () => {
  /*
   * THE VOCABULARY IS PINNED AS A LITERAL on both sides. CI cannot read the
   * other repository, so this is the mechanism that makes a one-sided edit
   * fail: change a token here and this test fails; change it on the network
   * and the network's own spec fails. The lists are kept equal by review, and
   * the module is a verbatim copy so the diff is empty when they agree.
   */
  it('spells exactly the vocabulary the network spells', () => {
    expect([...COLLATERAL_COLUMN_TOKENS]).toEqual([
      'estate', 'siting', 'location', 'plan',
      'aerial', 'site\\s*plan', 'master\\s*plan', 'masterplan', 'stage\\s*plan',
      'lot\\s*plan', 'floor\\s*plan', 'floorplan', 'elevation\\s*plan', 'planofsub',
      'subdivision', 'survey', 'contour', 'logo', 'letterhead', 'map', 'locality',
      'clubhouse', 'club\\s*house', 'sales\\s*office', 'display\\s*suite',
      'estate\\s*marketing', 'community', 'amenit', 'signage', 'render\\s*board',
    ]);
  });

  it('the servable predicate is one call, with no copy left behind', () => {
    /*
     * The network's defect was three spellings of "is there a servable
     * builder image" and the column rule reaching only one. This side has
     * two readers; both must call the shared predicate and neither may
     * restate the alternation.
     */
    for (const file of [join(SHARED, 'primaryImage.ts'), join(repoRoot, 'src/lib/builderStock.ts')]) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} no longer reads the shared predicate`)
        .toMatch(/servableStoredImage\s*\(/);
      expect(text.replace(/\s+/g, ' '), `${file} carries its own copy of the expression`)
        .not.toMatch(/isMarketplaceEligible\([^)]*\) \|\| !!servableDerivativeFor/);
    }
  });

  it('refuses a collateral picture and honours the other conditions', () => {
    expect(servableStoredImage(imageFiledUnder('Brochure URL'))).toBe(true);
    expect(servableStoredImage(imageFiledUnder('Siting / Masterplan URL'))).toBe(false);
    expect(servableStoredImage(imageFiledUnder(undefined))).toBe(true);
    // A widening must not become a loosening.
    expect(servableStoredImage(imageFiledUnder('Brochure URL'), 27)).toBe(false);
    expect(servableStoredImage(
      { ...imageFiledUnder('Brochure URL'), storage_path: null, external_url: null })).toBe(false);
  });
});

describe('the boundary that actually hands over bytes', () => {
  /*
   * `builder-stock-marketplace` mints a signed URL only for an image
   * `rankImage` will rank — deliberately, because "the rule is enforced where
   * the bytes are served, not only where the pointer is chosen". `rankImage`
   * decides its source tier with `isDisplayableSourceImage`, so the column
   * rule reaches that endpoint without the endpoint being edited.
   *
   * This is the strongest form of the guarantee available on this side: even
   * if a card somehow asked for a collateral picture, the bytes are refused.
   */
  it('refuses to rank a collateral-column picture, so no URL is ever minted', () => {
    expect(rankImage(imageFiledUnder('Brochure URL') as never)).not.toBeNull();
    expect(rankImage(imageFiledUnder('Siting / Masterplan URL') as never)).toBeNull();
    expect(rankImage(imageFiledUnder('Estate Brochure / Location Map URL') as never)).toBeNull();
    expect(rankImage(imageFiledUnder('Stage Plan / PlanOfSub URL') as never)).toBeNull();
  });

  it('does not quietly demote it to a web or street-view tier', () => {
    // A refused SOURCE image must be refused outright, never re-admitted at a
    // lower rank — it is still `uploaded_document`, and nothing below tier 2
    // may carry the builder's bytes.
    const ranked = rankImage(imageFiledUnder('Siting / Masterplan URL') as never);
    expect(ranked).toBeNull();
  });
});
