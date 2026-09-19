import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('finance portal batch 6 object authorization', () => {
  it('passes the request-scoped JSON responder to the reminder helper', () => {
    expect(source).toContain('runRemindersDue(supabase, json)');
    expect(source).toContain('async function runRemindersDue(supabase: any, json:');
  });

  it('checks effective permissions for file and document operations', () => {
    expect(source).toContain("portalUser.global_permissions, 'purchase_files', action");
    expect(source).toContain("'document_requirement_instances', id, 'edit', 'documents'");
  });

  it('authorizes replacement booking associations before updating', () => {
    const update = source.slice(
      source.indexOf("if (operation === 'bookings_update')"),
      source.indexOf("if (operation === 'bookings_cancel')"),
    );
    expect(update).toContain('requireBookingAssociationAccess(purchaseFileId, clientId)');
    expect(update.indexOf('requireBookingAssociationAccess')).toBeLessThan(update.indexOf('.update({ ...patch'));
  });
});
