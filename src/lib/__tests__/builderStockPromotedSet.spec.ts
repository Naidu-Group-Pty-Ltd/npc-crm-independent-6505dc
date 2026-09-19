/**
 * The promoted set is built from ROWS, never from the request payload.
 *
 * `list_stock` reads its pinned rows separately and renames the body query's
 * rows to `unpinned` — a rename made for a reason recorded in the function
 * itself: a local `body` shadowed the request payload and put the payload's own
 * reads in its temporal dead zone. The rename was done and ONE call was left
 * behind pointing at `body`:
 *
 *     promoted_organisations: promotedOrganisations(pinned.concat(body)),
 *
 * `Array.prototype.concat` appends a non-array as a single element, and a
 * request payload carries no `rank_placement_kind`, so `promotedOrganisations`
 * skipped it — and since `pinned` is filtered to `rank_placement_kind =
 * 'pinned'`, no row in that argument could ever be `'promoted'`. The list came
 * back EMPTY on every request that has ever been made.
 *
 * Nothing threw, nothing logged and no type complained: `body` exists, and it
 * is `any`. So this is a source-level guard.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { promotedOrganisations } from '../../../supabase/functions/_shared/builderStock/marketplaceOrder.pure';

const source = readFileSync(
  join(__dirname, '..', '..', '..', 'supabase', 'functions', 'builder-stock-marketplace', 'index.ts'),
  'utf8',
);

describe('the promoted set', () => {
  it('is composed from the page rows, not from the request payload', () => {
    const call = /promotedOrganisations\(([^)]*)\)/.exec(source);
    expect(call, 'promotedOrganisations call not found').toBeTruthy();
    const argument = call![1];
    expect(argument).toContain('unpinned');
    // `body` is the request payload throughout this handler.
    expect(argument.split(/\W+/)).not.toContain('body');
  });

  it('answers empty for a payload object, which is why the defect was silent', () => {
    // Reproduces what the wrong call actually did: no throw, no log, just a
    // list that is always empty.
    const payload = { operation: 'list_stock', page: 1 } as unknown;
    expect(promotedOrganisations([payload] as never)).toEqual([]);
  });

  it('names the organisations holding promoted rows', () => {
    expect(promotedOrganisations([
      { id: 'a', organisation_id: 'org-1', rank_placement_kind: 'promoted', rank_item_score: 70 },
      { id: 'b', organisation_id: 'org-2', rank_placement_kind: 'organic', rank_item_score: 99 },
      { id: 'c', organisation_id: 'org-3', rank_placement_kind: 'promoted', rank_item_score: 80 },
    ] as never)).toEqual(['org-3', 'org-1']);
  });

  it('finds none among pinned rows alone, which is what made the bug invisible', () => {
    // `pinned` is read with `.eq('rank_placement_kind', 'pinned')`, so it can
    // never contribute a promoted organisation — the whole answer came from
    // the second argument, and the second argument was wrong.
    expect(promotedOrganisations([
      { id: 'a', organisation_id: 'org-1', rank_placement_kind: 'pinned', rank_item_score: 90 },
    ] as never)).toEqual([]);
  });
});
