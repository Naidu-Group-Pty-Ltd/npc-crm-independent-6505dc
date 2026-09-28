/**
 * Which ownership columns `manage-commercial-data` stamps on create.
 *
 * A lease and a DCF run carry BOTH a NOT NULL `user_id` and a NOT NULL
 * `property_id`, and were filed as user-owned only — so the handler dropped
 * the property id (the allowlist refuses ownership columns from the body, by
 * design) and "Add tenancy" on a commercial property's rent roll failed on the
 * NOT NULL. These pin the classification, and that the handler reads it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COMMERCIAL_TABLE_OWNERSHIP, createNeedsOwnedProperty, createStampsUser, ownershipOf,
} from '../../../supabase/functions/_shared/commercialOwnership.pure';
import { COMMERCIAL_WRITABLE } from '../../../supabase/functions/_shared/assetWritableColumns';

describe('how each commercial table is owned', () => {
  it('stamps both columns on a lease and a DCF run', () => {
    for (const table of ['commercial_leases', 'commercial_dcf_runs']) {
      expect(ownershipOf(table), table).toBe('user_and_property');
      expect(createNeedsOwnedProperty(table), table).toBe(true);
      expect(createStampsUser(table), table).toBe(true);
    }
  });

  it('keeps the property itself user-owned, and capex and financing property-owned', () => {
    expect(createNeedsOwnedProperty('commercial_properties')).toBe(false);
    expect(createStampsUser('commercial_properties')).toBe(true);
    for (const table of ['commercial_capex', 'commercial_financing']) {
      expect(createNeedsOwnedProperty(table), table).toBe(true);
      expect(createStampsUser(table), table).toBe(false);
    }
  });

  it('classifies every table the handler may write, and nothing is left to the default', () => {
    const source = readFileSync(resolve(process.cwd(), 'supabase/functions/manage-commercial-data/index.ts'), 'utf8');
    const allowed = /const ALLOWED_TABLES: TableName\[\] = \[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
    const tables = Array.from(allowed.matchAll(/'([a-z_]+)'/g)).map((match) => match[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(COMMERCIAL_TABLE_OWNERSHIP[table], table).toBeDefined();
  });

  it('never takes an ownership column from the request body', () => {
    for (const [table, columns] of Object.entries(COMMERCIAL_WRITABLE)) {
      expect(columns.has('property_id'), table).toBe(false);
      expect(columns.has('user_id'), table).toBe(false);
    }
  });

  it('is what the create path reads', () => {
    const source = readFileSync(resolve(process.cwd(), 'supabase/functions/manage-commercial-data/index.ts'), 'utf8');
    const create = source.slice(source.indexOf("case 'create': {"), source.indexOf("case 'update': {"));
    expect(create).toContain('createNeedsOwnedProperty(body.table)');
    expect(create).toContain('await assertPropertyOwned(requestedPropertyId)');
    expect(create).toContain('createStampsUser(body.table)');
  });
});
