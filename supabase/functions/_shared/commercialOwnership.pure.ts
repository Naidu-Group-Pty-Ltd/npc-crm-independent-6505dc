/**
 * How each `commercial_*` table is owned — and therefore which ownership
 * columns `manage-commercial-data` sets itself on create.
 *
 * ## The defect this records
 *
 * The handler knew two kinds of table: those owned directly (`user_id`) and
 * those owned through their property (`property_id`, checked against the
 * caller's property). `commercial_leases` and `commercial_dcf_runs` are BOTH —
 * each carries a NOT NULL `user_id` and a NOT NULL `property_id` — and were
 * filed under the first kind. The allowlist deliberately refuses `property_id`
 * from the body (ownership is never taken from a request), so the handler set
 * `user_id`, dropped `property_id`, and the insert failed on the NOT NULL:
 * "Add tenancy" on a commercial property's rent roll could not save a tenancy,
 * and a saved DCF run could not be stored.
 *
 * The rule stays the one WP-24 wrote down — ownership columns come from the
 * verified session or from a value that has been ownership-checked first, never
 * straight from the body — and is applied to both columns where a table has
 * both.
 */

export type CommercialOwnership = 'user' | 'property' | 'user_and_property';

export const COMMERCIAL_TABLE_OWNERSHIP: Readonly<Record<string, CommercialOwnership>> = {
  commercial_properties: 'user',
  commercial_leases: 'user_and_property',
  commercial_dcf_runs: 'user_and_property',
  commercial_capex: 'property',
  commercial_financing: 'property',
};

/** Unknown tables are treated as directly owned — the narrowest reading. */
export function ownershipOf(table: string): CommercialOwnership {
  return COMMERCIAL_TABLE_OWNERSHIP[table] ?? 'user';
}

/** Whether a create on this table must name a property the caller owns. */
export function createNeedsOwnedProperty(table: string): boolean {
  return ownershipOf(table) !== 'user';
}

/** Whether a create on this table is stamped with the caller's `user_id`. */
export function createStampsUser(table: string): boolean {
  return ownershipOf(table) !== 'property';
}
