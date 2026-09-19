/**
 * Builders Network Phase 7 wave 5 — the marketplace mirrors the network's
 * real stock, and an activation says who is asking (plan §3 E4/E5).
 *
 * Wave 4's pins hold the original contract; these hold the two additions:
 * the CONSUMER that converges `stock.item.upserted` / `stock.catalog.
 * reconciled` into the `builder_network_stock_*` mirror, and the producer's
 * `agency` block — the authorised disclosure of THIS workspace's outward
 * contact to the builder it activates. The network counterpart proves its
 * half (composition, fan-out into the builder's dashboard/tasks/
 * notifications) against a rebuilt schema in aurixa-builders CI.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertPayloadCrossesClean,
  forbiddenPathsIn,
} from '../../../supabase/functions/_shared/builderNetworkPrivacy.pure';
import { STOCK_SELECTION_STATUS_LABELS } from '../builderStock';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');
const stripSql = (body: string) => body.replace(/--[^\n]*/g, ' ');

const MIGRATION = 'supabase/migrations/20261201090000_builder_network_stock_consumer_and_agency_disclosure.sql';
const migration = read(MIGRATION);
const migrationCode = stripSql(migration);

describe('the producer now discloses the agency contact — and nothing else new', () => {
  it('reads the acting adviser from custom_users, key by key, active only', () => {
    expect(migrationCode).toMatch(/FROM public\.custom_users u\s+WHERE u\.id = NEW\.selected_by_user_id\s+AND u\.is_active = true AND u\.deleted_at IS NULL/);
    // Production keeps the display name in `username`; the follow-on gives
    // the contact block that fallback so an activation names a person.
    const followOn = stripSql(read('supabase/migrations/20261201100000_agency_contact_name_falls_back_to_username.sql'));
    expect(followOn).toContain("nullif(btrim(COALESCE(u.username, '')), '')) AS contact_name");
    expect(migrationCode).toContain("'contact_name', v_contact.contact_name");
    expect(migrationCode).toContain("'contact_email', v_contact.contact_email");
    expect(migrationCode).toContain("'contact_phone', v_contact.contact_phone");
  });

  it('the outbox composition carries the agency block and still never a private column', () => {
    const composition = migrationCode.slice(
      migrationCode.indexOf('INSERT INTO public.builder_network_outbox'),
      migrationCode.indexOf('RETURN NEW;', migrationCode.indexOf('INSERT INTO public.builder_network_outbox')));
    expect(composition).toContain("'agency', v_agency");
    for (const forbidden of [
      'client_id', 'selected_by_user_id', 'internal_notes',
      'builder_reference', 'remote_client_label', 'acknowledged_by',
    ]) {
      expect(composition, `payload composition must not name ${forbidden}`)
        .not.toContain(forbidden);
    }
    expect(composition).not.toMatch(/to_jsonb\s*\(\s*NEW/);
  });

  it('the enriched payload crosses the shared privacy contract clean', () => {
    const payload = {
      remote_selection_ref: '4d1f0f27-6a86-4c39-9d3d-2a4c14b6a001',
      stock_item_id: '4d1f0f27-6a86-4c39-9d3d-2a4c14b6a002',
      status: 'selected',
      agency: {
        contact_name: 'Ava Adviser',
        contact_email: 'ava@agency.example',
        contact_phone: '03 9000 0000',
      },
    };
    expect(assertPayloadCrossesClean(payload)).toBe(payload);
    // The forbidden sets stand exactly as they were.
    expect(forbiddenPathsIn({ ...payload, client_email: 'x@y.z' }))
      .toEqual(expect.arrayContaining(['client_email']));
  });
});

describe('the consumer converges the stock mirror, monotonically', () => {
  it('handles both stock events and keeps the acknowledgement branch', () => {
    expect(migrationCode).toContain("'stock.item.upserted'");
    expect(migrationCode).toContain("'stock.catalog.reconciled'");
    expect(migrationCode).toContain("'stock.selection.acknowledged'");
  });

  it('the connection is the organisation authority; the payload holds none', () => {
    expect(migrationCode).toContain("'organisation_mismatch', 'critical'");
    expect(migrationCode).toMatch(/v_org_id <> v_connection\.builder_organisation_id/);
  });

  it('every mirror write is guarded by source_version, per row', () => {
    expect(migrationCode).toMatch(/WHERE EXCLUDED\.source_version\s+>= public\.builder_network_stock_organisations\.source_version/);
    expect(migrationCode).toMatch(/WHERE EXCLUDED\.source_version\s+>= public\.builder_network_stock_items\.source_version/);
    expect(migrationCode).toMatch(/WHERE EXCLUDED\.source_version\s+>= public\.builder_network_stock_item_images\.source_version/);
    // A delayed reconcile cannot archive an item a later event upserted.
    expect(migrationCode).toMatch(/i\.source_version < COALESCE\(v_event\.source_version, 0\)\s+AND NOT \(i\.id = ANY \(v_ids\)\)/);
  });

  it('the mirror never stores the builder\'s raw row — one lifted key only', () => {
    expect(migrationCode).toContain("jsonb_build_object('house_design', v_payload->'house_design')");
    expect(migrationCode).not.toMatch(/source_row[^,]*=\s*v_payload->'source_row'/);
  });

  it('mirror images point at the network\'s own door, derived from the transport config', () => {
    expect(migrationCode).toContain("regexp_replace(");
    expect(migrationCode).toContain("'/builder-network-inbound$', '')");
    expect(migrationCode).toContain("'/builder-network-stock-image?id=' || v_image_id");
    // Never a stale local object from the seeded era.
    expect(migrationCode).toMatch(/storage_bucket = NULL,\s+storage_path = NULL/);
    // No environment-specific host is written into the migration.
    expect(migration).not.toContain('supabase.co/');
  });

  it('no provable builder image means NO image — the pointer clears with the frame', () => {
    expect(migrationCode).toMatch(/DELETE FROM public\.builder_network_stock_item_images\s+WHERE stock_item_id = v_item_id;\s+UPDATE public\.builder_network_stock_items\s+SET primary_image_id = NULL/);
  });
});

describe('the marketplace verb is Activate builder', () => {
  it('the card, the dialog and the confirmation all say so', () => {
    const tab = read('src/components/listings/BuilderStockTab.tsx');
    expect(tab).toContain("'Activate builder' : 'Not available'");
    expect(tab).toContain('<DialogTitle>Activate builder</DialogTitle>');
    expect(tab).not.toContain('Select for a client');
    // And the copy is now TRUE: the builder is notified in their portal.
    expect(tab).toContain('notified in their portal');
    expect(tab).not.toContain('not notified automatically');
  });

  it('a recorded activation is labelled as one', () => {
    expect(STOCK_SELECTION_STATUS_LABELS.selected).toBe('Builder activated');
  });
});
