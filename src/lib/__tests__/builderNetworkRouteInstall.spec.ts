/**
 * THE RECEIVER'S HALF: a builder's route installs itself, and a relationship
 * whose two ends disagree is halted rather than eaten.
 *
 * Both halves of this were production defects, measured 21 Sep 2026. A
 * builder could reach this workspace only if `builder_network_connections`
 * held a row naming its organisation, and nothing created one but an operator
 * by hand — so the second builder onto the network was unroutable. And when
 * the two sides did disagree, `organisation_mismatch` answered by CONSUMING
 * the event, which is the one thing a queue exists not to do.
 *
 * The producer's half is pinned in aurixa-builders.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');
const stripSql = (body: string) => body.replace(/--[^\n]*/g, ' ');

const MIGRATION = 'supabase/migrations/20261211000000_a_builder_route_installs_itself.sql';
const sql = stripSql(read(MIGRATION));

describe('a second builder installs itself over the first builder’s channel', () => {
  it('handles connection.authorised', () => {
    expect(sql).toMatch(/v_event\.event_type = 'connection\.authorised'/);
  });

  it('writes the connection from the announcement', () => {
    expect(sql).toMatch(/INSERT INTO public\.builder_network_connections\(/);
    expect(sql).toContain("v_payload->>'network_connection_id'");
    expect(sql).toContain("v_payload->>'builder_organisation_id'");
  });

  it('mints no secret — the transport is copied from the announcing connection', () => {
    expect(sql).toContain('v_connection.outbound_hmac_secret');
    expect(sql).toContain('v_connection.network_inbound_url');
    // Nothing anywhere generates key material on this path.
    expect(sql).not.toMatch(/gen_random_bytes|encode\s*\(\s*gen_random/i);
  });

  it('never re-points a connection that already names a different builder', () => {
    expect(sql).toMatch(
      /WHERE public\.builder_network_connections\.builder_organisation_id\s+IS NOT DISTINCT FROM EXCLUDED\.builder_organisation_id/,
    );
  });

  it('gives every installed connection its inbound stamp', () => {
    expect(sql).toMatch(/INSERT INTO public\.builder_network_stamps\(connection_id, side/);
  });

  it('records a revoked announcement with the stamp its CHECK demands', () => {
    expect(sql).toMatch(/revoked_at/);
    expect(sql).toMatch(/THEN now\(\) ELSE NULL END/);
  });
});

describe('an identity mismatch halts the relationship and keeps the event', () => {
  it('no longer answers a mismatch by consuming the event', () => {
    // `mark_inbound_refused` sets processed_at. It must not be what a
    // mismatch reaches for; the halt is.
    const mismatchBlocks = sql.split('organisation_mismatch');
    expect(mismatchBlocks.length).toBeGreaterThan(0);
    expect(sql).not.toMatch(/'organisation_mismatch', 'critical'/);
    expect(sql).toMatch(/builder_network_halt_identity_mismatch/);
  });

  it('stamps the connection and leaves processed_at alone', () => {
    const halt = sql.slice(sql.indexOf('FUNCTION public.builder_network_halt_identity_mismatch'));
    expect(halt).toMatch(/SET identity_mismatch_since = COALESCE\(identity_mismatch_since, now\(\)\)/);
    // The held event keeps a reason and keeps its place in the queue.
    expect(halt).toMatch(/SET apply_error = 'connection_identity_mismatch'/);
    expect(halt.slice(0, halt.indexOf('$function$;'))).not.toMatch(/processed_at = now\(\)/);
  });

  it('reports the fault once per halt, not once per event', () => {
    expect(sql).toMatch(/IF v_already IS NULL THEN/);
    expect(sql).toContain('builder_network_connection_identity_mismatch');
  });

  it('holds a halted connection’s events out of the apply loop entirely', () => {
    expect(sql).toMatch(
      /AND NOT EXISTS \(\s*SELECT 1 FROM public\.builder_network_connections c\s*WHERE c\.id = e\.connection_id AND c\.identity_mismatch_since IS NOT NULL\)/,
    );
  });

  it('clears the halt by agreement rather than by a timer', () => {
    expect(sql).toMatch(/FUNCTION public\.builder_network_clear_settled_mismatches/);
    expect(sql).toMatch(/SET identity_mismatch_since = NULL/);
  });
});

describe('attribution is an invariant of the item, not of the connection', () => {
  it('never rewrites a mirrored item’s organisation on conflict', () => {
    const upsert = sql.slice(
      sql.indexOf('INSERT INTO public.builder_network_stock_items('),
      sql.indexOf('SELECT source_version INTO v_current'),
    );
    const doUpdate = upsert.slice(upsert.indexOf('DO UPDATE SET'));
    expect(doUpdate).not.toMatch(/^\s*organisation_id = EXCLUDED\.organisation_id,/m);
    // and a payload that would move one cannot win the guard either
    expect(doUpdate).toMatch(
      /public\.builder_network_stock_items\.organisation_id = EXCLUDED\.organisation_id/,
    );
  });

  it('archives only within the organisation the event named', () => {
    expect(sql).toMatch(
      /UPDATE public\.builder_network_stock_items i\s*SET lifecycle_status = 'archived'[\s\S]*?WHERE i\.organisation_id = v_org_id/,
    );
  });
});

describe('the label is derived from the builder, never typed', () => {
  it('refreshes builder_org_label from the organisation block of every event', () => {
    expect(sql).toMatch(
      /UPDATE public\.builder_network_connections c\s*SET builder_org_label = left\(COALESCE\(/,
    );
    expect(sql).toContain("v_payload#>>'{organisation,trading_name}'");
  });
});

describe('what this workspace receives is queryable', () => {
  it('publishes a per-builder receive state', () => {
    expect(sql).toMatch(/CREATE OR REPLACE VIEW public\.builder_network_receive_state/);
    for (const state of ['identity_mismatch', 'not_authorised', 'syncing', 'synced', 'revoked']) {
      expect(sql).toContain(`'${state}'`);
    }
  });

  it('counts mirrored items per builder rather than in total', () => {
    expect(sql).toMatch(/WHERE i\.organisation_id = c\.builder_organisation_id\s*AND i\.lifecycle_status = 'active'\)\s*AS mirrored_active_items/);
  });
});

describe('the new functions are not reachable from a browser', () => {
  /**
   * CREATE grants EXECUTE to PUBLIC, and this project's default privileges
   * grant it to `anon` and `authenticated` DIRECTLY — so closing one and not
   * the others leaves a SECURITY DEFINER function reachable by the
   * publishable key in the browser bundle while the revoke that missed still
   * reports success.
   */
  const revoked = (signature: string) =>
    new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${signature}[\\s\\S]{0,160}?FROM PUBLIC, anon, authenticated`);

  it('closes the halt to PUBLIC, anon and authenticated', () => {
    expect(sql).toMatch(revoked('builder_network_halt_identity_mismatch\\('));
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.builder_network_halt_identity_mismatch\([\s\S]{0,60}?\)\s*TO service_role/);
  });

  it('closes the mismatch sweep the same way', () => {
    expect(sql).toMatch(revoked('builder_network_clear_settled_mismatches\\(\\)'));
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.builder_network_clear_settled_mismatches\(\)\s*TO service_role/);
  });

  it('reads the receive-state view with the caller’s own rights', () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE VIEW public\.builder_network_receive_state\s*WITH \(security_invoker = true\)/,
    );
  });
});
