/**
 * Builders Network Phase 7 wave 4 — the selection events actually travel
 * (plan §3 E3). Pinned at the source: the producer trigger's transactional
 * composition, its privacy boundary, its dark-by-default gates, and the
 * clone's convergence of the builder's acknowledgement.
 *
 * The network counterpart (aurixa-builders 20260915120000) proves the other
 * end against a rebuilt schema in its own CI; the two files quote one event
 * contract, and these tests hold this side to it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertPayloadCrossesClean,
  forbiddenPathsIn,
} from '../../../supabase/functions/_shared/builderNetworkPrivacy.pure';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');
const readCode = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
const stripSql = (body: string) => body.replace(/--[^\n]*/g, ' ');

const MIGRATION = 'supabase/migrations/20261124010000_builder_network_stock_selection_producer.sql';
const migration = read(MIGRATION);
const migrationCode = stripSql(migration);

describe('the producer composes in the selection transaction', () => {
  it('is a trigger on builder_stock_selections, for insert and status change', () => {
    expect(migrationCode).toContain('builder_network_announce_stock_selection');
    expect(migrationCode).toMatch(/AFTER INSERT OR UPDATE ON public\.builder_stock_selections/);
    // Note edits are Command Centre private: only a status movement is news.
    expect(migrationCode).toMatch(/NEW\.status IS NOT DISTINCT FROM OLD\.status/);
  });

  it('never echoes the builder acknowledgement back to the network', () => {
    // The sweep writes builder_acknowledged; the trigger must skip exactly
    // that status or every acknowledgement loops into the network's inbox.
    expect(migrationCode).toMatch(/IF NEW\.status = 'builder_acknowledged' THEN\s+RETURN NEW/);
  });

  it('speaks the network contract: announced on insert, updated on change', () => {
    expect(migrationCode).toContain("'stock.selection.announced'");
    expect(migrationCode).toContain("'stock.selection.updated'");
    expect(migrationCode).toMatch(/nextval\('public\.builder_network_selection_version_seq'\)/);
  });

  it('stays dark without the flag, an active connection and stock:publish', () => {
    expect(migrationCode).toMatch(/key = 'builder_network_enabled'/);
    expect(migrationCode).toMatch(/v_flag IS DISTINCT FROM true/);
    expect(migrationCode).toMatch(/c\.state = 'active'/);
    expect(migrationCode).toMatch(/'stock:publish' = ANY \(c\.scopes\)/);
  });
});

describe('the privacy boundary at composition', () => {
  it('the payload is built key by key with exactly the contract fields', () => {
    const composition = migrationCode.slice(
      migrationCode.indexOf('INSERT INTO public.builder_network_outbox'),
      migrationCode.indexOf('RETURN NEW;', migrationCode.indexOf('INSERT INTO public.builder_network_outbox')));
    expect(composition).toContain("'remote_selection_ref', NEW.id");
    expect(composition).toContain("'stock_item_id', NEW.stock_item_id");
    expect(composition).toContain("'status', NEW.status");
    for (const forbidden of [
      'client_id', 'selected_by_user_id', 'internal_notes',
      'builder_reference', 'remote_client_label', 'acknowledged_by',
    ]) {
      expect(composition, `payload composition must not name ${forbidden}`)
        .not.toContain(forbidden);
    }
    // Never a row spread: to_jsonb(NEW) would ship every private column the
    // moment one is added.
    expect(composition).not.toMatch(/to_jsonb\s*\(\s*NEW/);
  });

  it('the composed payload shape crosses the shared privacy contract clean', () => {
    const payload = {
      remote_selection_ref: '4d1f0f27-6a86-4c39-9d3d-2a4c14b6a001',
      stock_item_id: '4d1f0f27-6a86-4c39-9d3d-2a4c14b6a002',
      status: 'selected',
    };
    expect(assertPayloadCrossesClean(payload)).toBe(payload);
  });

  it('the row it deliberately does not send would be refused at every gate', () => {
    const wholeRow = {
      remote_selection_ref: '4d1f0f27-6a86-4c39-9d3d-2a4c14b6a001',
      stock_item_id: '4d1f0f27-6a86-4c39-9d3d-2a4c14b6a002',
      status: 'selected',
      client_id: '4d1f0f27-6a86-4c39-9d3d-2a4c14b6a003',
      selected_by_user_id: '4d1f0f27-6a86-4c39-9d3d-2a4c14b6a004',
      internal_notes: 'never crosses',
    };
    expect(forbiddenPathsIn(wholeRow)).toEqual(
      expect.arrayContaining(['client_id', 'selected_by_user_id', 'internal_notes']));
  });
});

describe('the acknowledgement converges, idempotently', () => {
  it('the sweep handles stock.selection.acknowledged onto the selection row', () => {
    expect(migrationCode).toContain("'stock.selection.acknowledged'");
    expect(migrationCode).toMatch(/SET status = 'builder_acknowledged'/);
    // Only a still-selected row moves; one that progressed keeps its later
    // state and the event is consumed as stale.
    expect(migrationCode).toMatch(/s\.id = v_ref AND s\.status = 'selected'/);
  });

  it('keeps the network identity out of Command Centre columns', () => {
    const sweep = migrationCode.slice(migrationCode.indexOf('builder_network_apply_inbound_events'));
    expect(sweep).not.toContain('acknowledged_by_builder_user_id =');
  });

  it('unknown vocabulary marks itself and the ledger stays replayable', () => {
    expect(migrationCode).toMatch(/unhandled_event_type:/);
    expect(migrationCode).toMatch(/apply_attempts \+ 1/);
  });

  it('the inbound door lands, then runs the sweep opportunistically', () => {
    const inbound = readCode('supabase/functions/builder-network-inbound/index.ts');
    const landing = inbound.indexOf("from('builder_network_inbound_events')");
    const sweep = inbound.indexOf("rpc('builder_network_apply_inbound_events'");
    expect(landing).toBeGreaterThan(-1);
    expect(sweep).toBeGreaterThan(landing);
    expect(inbound).not.toContain("from('builder_stock_selections')");
  });

  it('the sweep is driven by pg_cron, guarded', () => {
    expect(migrationCode).toContain("'builder-network-inbound-apply-1min'");
    expect(migrationCode).toMatch(/pg_extension WHERE extname = 'pg_cron'/);
  });
});

describe('the mapping the producer resolves through', () => {
  it('connections gain the builder organisation, provisioned by Mission Control', () => {
    expect(migrationCode).toMatch(
      /ALTER TABLE public\.builder_network_connections\s+ADD COLUMN IF NOT EXISTS builder_organisation_id uuid/);
    expect(migration).toMatch(/Mission Control/);
  });

  it('the marketplace write paths stay untouched — the trigger is the producer', () => {
    const marketplace = readCode('supabase/functions/builder-stock-marketplace/index.ts');
    expect(marketplace).not.toContain('builder_network_outbox');
    expect(marketplace).not.toContain('stock.selection.announced');
  });
});
