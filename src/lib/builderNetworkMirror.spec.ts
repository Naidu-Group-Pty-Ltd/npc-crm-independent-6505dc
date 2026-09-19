/**
 * Phase 3 — the Builders Network mirror on this workspace, pinned
 * (docs/builder-portal/45-network-extraction-plan.md §7).
 *
 * The pure modules are byte-identical with the network's copies (one privacy
 * contract, two ends), and everything else here is dark until
 * feature_flags.builder_network_enabled — these tests pin the OFF posture
 * and the rules that must hold when it turns on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildStamp,
  stampsDiffer,
} from '../../supabase/functions/_shared/builderNetworkStamp.pure';
import {
  assertPayloadCrossesClean,
  forbiddenPathsIn,
} from '../../supabase/functions/_shared/builderNetworkPrivacy.pure';

const REPO_ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8');
const readCode = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

describe('the pure modules carried from the network', () => {
  it('a null previous stamp is not a change', () => {
    const stamp = buildStamp({ count: 1 });
    expect(stampsDiffer(null, stamp)).toBe(false);
    expect(stampsDiffer(stamp, { ...stamp, count: 2 })).toBe(true);
  });

  it('the privacy contract throws with paths and never filters', () => {
    expect(() => assertPayloadCrossesClean({ item: { client_id: 'x' } })).toThrow();
    expect(forbiddenPathsIn({ internalNote: 'x', ok: 1 })).toEqual(['internalNote']);
    const clean = { stock_item_id: 's1' };
    expect(assertPayloadCrossesClean(clean)).toBe(clean);
  });
});

describe('dark by default', () => {
  it('the migration ships the flag OFF and RLS on all four tables', () => {
    const migration = read('supabase/migrations/20261121000000_builder_network_mirror.sql');
    expect(migration).toMatch(/'builder_network_enabled',\s*\n\s*'false'::jsonb/);
    for (const table of [
      'builder_network_connections', 'builder_network_outbox',
      'builder_network_inbound_events', 'builder_network_stamps',
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).not.toMatch(/DROP\s+TABLE(?!\S)/i);
    expect(migration).not.toContain('CASCADE;');
  });

  it('the flag reader fails CLOSED: an unreadable flag is off', () => {
    const source = readCode('supabase/functions/_shared/builderNetwork.ts');
    expect(source).toContain('if (error || !data) return false;');
    expect(source).toContain("data.value === true");
  });

  it('the inbound door refuses by NAME while the flag is off, retryably', () => {
    const source = readCode('supabase/functions/builder-network-inbound/index.ts');
    expect(source).toContain("json({ error: 'network_disabled' }, 503)");
    // And its transport auth is one generic refusal.
    expect(source.match(/delivery_refused/g)).toHaveLength(1);
  });

  it('the worker drain skips while off and gates privacy before the wire', () => {
    const worker = readCode('supabase/functions/cross-portal-outbox-worker/index.ts');
    expect(worker).toContain("return { skipped: 'network_disabled' }");
    const gateAt = worker.indexOf('assertPayloadCrossesClean');
    const wireAt = worker.indexOf('await fetch(connection.network_inbound_url');
    expect(gateAt).toBeGreaterThan(-1);
    expect(wireAt).toBeGreaterThan(gateAt);
  });

  it('builder-network-inbound is declared in config.toml, verify_jwt false', () => {
    const config = read('supabase/config.toml');
    expect(config).toMatch(/\[functions\.builder-network-inbound\][\s\S]{0,600}verify_jwt = false/);
  });

  it('composing an event goes through the gate at the writer too', () => {
    const source = readCode('supabase/functions/_shared/builderNetwork.ts');
    const gateAt = source.indexOf('assertPayloadCrossesClean(input.payload)');
    const insertAt = source.indexOf("from('builder_network_outbox').insert");
    expect(gateAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(gateAt);
  });
});
