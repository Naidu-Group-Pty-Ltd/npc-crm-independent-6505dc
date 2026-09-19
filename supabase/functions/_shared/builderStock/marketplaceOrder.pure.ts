/**
 * THE SHAPE OF A MARKETPLACE PAGE.
 *
 * The Builders Network decides what every builder and every property is WORTH
 * and publishes it; this module decides how a PAGE is laid out from those
 * worths. The division is deliberate and it is the thing that makes a rank
 * reportable: a score is a statement about a builder, while how many of one
 * builder's properties may run consecutively, how many promoted slots a list
 * offers, and where a pinned property lands once an offset is applied are all
 * properties of the surface doing the paginating. Folding page shape into a
 * score would make a builder's position depend on who else happened to be on
 * the page with them, and then nobody could be told where they rank.
 *
 * Most of the ordering is in SQL, in the `builder_network_stock_ranked` view,
 * because it has to happen BEFORE the offset — a diversity cap applied to a
 * page after it has been fetched cannot help when the page is already one
 * builder's, since there is nobody on it to interleave with.
 *
 * What is left here is the one thing SQL cannot do cleanly under pagination:
 * a pin means an ABSOLUTE position in the whole marketplace ("this builder
 * sits at number one until the end of November"), so placing it requires
 * knowing the page's offset, and it must land on page 2 if that is where
 * position 27 falls.
 *
 * TWO RULES.
 *
 * A PIN IS NEVER LOST. A pin past the end of the list appends rather than
 * leaving a hole, and a pin whose position falls outside the current page is
 * simply not on this page — it is not dropped from the marketplace, and the
 * total count still includes it.
 *
 * NOTHING ELSE IS EVER REMOVED. This module reorders. The only property that
 * leaves a marketplace is one an operator has explicitly suppressed on the
 * network, and that exclusion happens in the view, from a recorded human act
 * with a reason and an expiry — never as something an ordering rule concluded.
 *
 * Pure: no IO, no clock, no database.
 */

/**
 * How many of one builder's properties may run consecutively.
 *
 * MIRRORED IN SQL. The interleave itself is the `builder_network_stock_ranked`
 * view's window function, which divides each property's position within its own
 * builder's stock by this number. The two must agree, and
 * `marketplaceOrder.spec.ts` reads the migration and fails when they drift —
 * two numbers that must match and are written in two places is how a page comes
 * to be laid out two different ways depending on which end you ask.
 */
export const MAX_CONSECUTIVE_PER_BUILDER = 3;

/**
 * How many promoted builders may sit above the organic list.
 *
 * Capped rather than unbounded so the top of the marketplace cannot become
 * entirely purchased. Past the cap a paid placement still competes on merit
 * within the organic order, so it is never simply discarded — a capped benefit,
 * not a revoked one.
 */
export const MAX_PROMOTED_SLOTS = 2;

/** The placement vocabulary, shared with the network that publishes it. */
export type PlacementKind = 'organic' | 'promoted' | 'pinned' | 'suppressed';

export interface RankedRow {
  readonly id: string;
  readonly organisation_id: string;
  readonly rank_placement_kind?: string | null;
  readonly rank_placement_position?: number | null;
  readonly rank_placement_tier?: string | null;
  readonly rank_disclose?: boolean | null;
  readonly rank_builder_band?: number | null;
  readonly rank_item_score?: number | string | null;
  readonly [key: string]: unknown;
}

/** Is this row's position something other than merit decided? */
export const isPlaced = (row: RankedRow): boolean =>
  row.rank_placement_kind === 'promoted' || row.rank_placement_kind === 'pinned';

/**
 * What the card must say about why this property is where it is.
 *
 * Null for an ordinary listing — a chip with nothing to state is not drawn, the
 * same rule the report scorecards answer to. The wording is the operator-facing
 * one and never the column value: `promoted` is database vocabulary and a chip
 * reading "promoted" tells an adviser nothing about who decided it.
 */
export function placementLabel(row: RankedRow): string | null {
  if (!row.rank_disclose) return null;
  if (row.rank_placement_kind === 'pinned') return 'Featured placement';
  if (row.rank_placement_kind === 'promoted') {
    return row.rank_placement_tier === 'featured' ? 'Featured partner'
      : row.rank_placement_tier === 'premium' ? 'Premium partner'
      : 'Partner';
  }
  return null;
}

/**
 * Splice pinned properties into a page at their absolute marketplace positions.
 *
 * `offset` is the 0-based index of the page's first row in the whole
 * marketplace, so a pin at position 27 lands on the page that actually contains
 * index 26 and nowhere else. Pins are applied in ascending position so that two
 * pins at 1 and 2 land at 1 and 2 rather than displacing one another.
 *
 * The page is not allowed to grow: for every pin spliced in, the last row is
 * pushed off the end and appears at the top of the next page instead. A page
 * that silently returned one extra row would desynchronise every subsequent
 * offset.
 */
export function splicePinsIntoPage<T extends RankedRow>(
  page: readonly T[],
  pinned: readonly T[],
  offset: number,
  pageSize: number,
): T[] {
  const out = [...page];
  const ordered = [...pinned].sort((a, b) =>
    (a.rank_placement_position ?? Number.MAX_SAFE_INTEGER)
    - (b.rank_placement_position ?? Number.MAX_SAFE_INTEGER)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const pin of ordered) {
    const absolute = Math.max(1, Math.round(pin.rank_placement_position ?? 1)) - 1;
    const local = absolute - offset;
    if (local < 0 || local > out.length) continue;   // belongs on another page
    out.splice(local, 0, pin);
  }

  return out.slice(0, pageSize);
}

/**
 * The promoted builders that fit inside the cap, best merit first.
 *
 * Decided over the WHOLE promoted set rather than per page, so which builders
 * hold the promoted slots does not change as an adviser pages through. A
 * builder past the cap keeps their rows — they simply sort organically.
 */
export function promotedOrganisations(
  rows: readonly RankedRow[],
  maxSlots: number = MAX_PROMOTED_SLOTS,
): string[] {
  const best = new Map<string, number>();
  for (const row of rows) {
    if (row.rank_placement_kind !== 'promoted') continue;
    const score = Number(row.rank_item_score ?? 0);
    const current = best.get(row.organisation_id);
    if (current === undefined || score > current) best.set(row.organisation_id, score);
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, Math.max(0, maxSlots))
    .map(([organisationId]) => organisationId);
}
