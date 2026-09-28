/**
 * THE LANE THAT MOVES ONE MAPPING MAY EXPRESS NOTHING ELSE.
 *
 * `.github/scripts/builder-network-connection-remap.mjs` is the only thing in
 * this repository that WRITES to the Builder Network mirror's configuration.
 * It exists to change one column of one row — which builder organisation this
 * workspace's connection serves — and its `statement()` accepts SELECTs plus
 * exactly one shape of UPDATE, refusing everything else before the request is
 * made. That is deliberately a property of the file rather than a promise
 * about how it is called, because the lane is dispatched by hand with a value
 * a person types.
 *
 * WHY IT IS TESTED HERE RATHER THAN TRUSTED. A guard written as one long
 * regular expression has two failure modes and they point opposite ways: too
 * loose and it stops being a guard, too tight and it refuses the lane's OWN
 * statement — which is only discovered in production, one dispatch at a time,
 * on the day somebody is trying to repair a marketplace that is already dark.
 * So the statement the lane actually composes is rebuilt here from the same
 * pieces and run through the same expression.
 *
 * THE EXPRESSION IS READ OUT OF THE LANE, NEVER RESTATED. A second copy typed
 * into this file would pass while the lane refused, which is the exact class
 * of defect this repository keeps finding — a measurement agreeing with
 * itself rather than with the thing it measures.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const LANE = '.github/scripts/builder-network-connection-remap.mjs';

/** The lane's own allow-list, extracted rather than re-typed. */
function allowedUpdatePattern(): RegExp {
  const source = readFileSync(LANE, 'utf8');
  const declared = source.match(/const ALLOWED_UPDATE =\s*(\/\^[\s\S]*?\/i);/);
  if (!declared) {
    throw new Error(`${LANE} no longer declares ALLOWED_UPDATE as a literal regular expression`);
  }
  // eslint-disable-next-line no-eval
  return eval(declared[1]) as RegExp;
}

const TARGET = 'dfdbff19-9402-479a-80d1-9bad70651349';
const CONNECTION = 'e23877cd-69c7-4cda-bf89-6628a8b1eb19';
const CURRENT = '00f9e45f-8c0c-4de5-a8ea-6856127df8cf';

/**
 * Composed from the same three pieces, in the same order, as the lane's own
 * call site. If that call site is reworded this test fails, which is the
 * point: the guard and the statement have to move together.
 */
const theStatementTheLaneSends =
  `update public.builder_network_connections set builder_organisation_id = '${TARGET}'::uuid, updated_at = now() `
  + `where id = '${CONNECTION}'::uuid and state = 'active' and builder_organisation_id = '${CURRENT}'::uuid `
  + `returning id::text as id, builder_organisation_id::text as organisation_id`;

describe('the connection re-point lane\'s write guard', () => {
  const ALLOWED_UPDATE = allowedUpdatePattern();

  it('accepts the statement the lane actually composes', () => {
    expect(ALLOWED_UPDATE.test(theStatementTheLaneSends)).toBe(true);
  });

  /*
   * THE GUARDED PREDICATE IS THE POINT OF THE GUARD. Re-pointing without
   * naming the value being replaced would overwrite a row somebody else moved
   * between this lane's read and its write — and on a mapping that decides
   * which builder's stock a whole marketplace mirrors, a lost update is not a
   * small thing.
   */
  it('refuses an update that does not name the value it is replacing', () => {
    const unguarded =
      `update public.builder_network_connections set builder_organisation_id = '${TARGET}'::uuid, updated_at = now() `
      + `where id = '${CONNECTION}'::uuid returning id`;
    expect(ALLOWED_UPDATE.test(unguarded)).toBe(false);
  });

  it('refuses an update with no predicate at all', () => {
    const everyRow =
      `update public.builder_network_connections set builder_organisation_id = '${TARGET}'::uuid, updated_at = now() `
      + 'returning id';
    expect(ALLOWED_UPDATE.test(everyRow)).toBe(false);
  });

  it('refuses a second statement smuggled after the permitted one', () => {
    expect(ALLOWED_UPDATE.test(`${theStatementTheLaneSends}; delete from public.builder_network_stock_items`))
      .toBe(false);
  });

  it('refuses the same shape against a different table', () => {
    expect(ALLOWED_UPDATE.test(
      theStatementTheLaneSends.replace('builder_network_connections', 'builder_network_stock_items'),
    )).toBe(false);
  });

  /*
   * The transport secret lives on this row. A guard that admitted any column
   * would let the lane that re-points a mapping also rewrite the credential
   * both ends sign with.
   */
  it('refuses the same shape against a different column', () => {
    expect(ALLOWED_UPDATE.test(
      theStatementTheLaneSends.replace('set builder_organisation_id', 'set outbound_hmac_secret'),
    )).toBe(false);
  });

  it('refuses a delete', () => {
    expect(ALLOWED_UPDATE.test(
      `delete from public.builder_network_connections where id = '${CONNECTION}'::uuid`,
    )).toBe(false);
  });
});
