/**
 * An activation reaches the builder at once — not on the next minute.
 *
 * Measured on production (26 Sep 2026): ~91 s from a Command Centre activation
 * to the Builder Portal. The network applies an inbound event on receipt; the
 * wait was here. `builder_network_announce_stock_selection()` queued the
 * outbox row and nothing delivered it until `cross-portal-outbox-worker-1min`
 * next ran, while every message path already calls
 * `builder_network_kick_outbox()` — the signed, fire-after-commit kick of the
 * same worker. The activation now kicks it too, only when a row was actually
 * queued; the cron stays as the recovery path.
 *
 * Asserted against the LATEST definition of the function in the migration
 * corpus, so a later rewrite that drops the kick (or any existing guarantee)
 * fails here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const DIR = join(ROOT, 'supabase', 'migrations');
const stripSql = (body: string) => body.replace(/--[^\n]*/g, ' ');
const defining = readdirSync(DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort()
  .filter((f) => readFileSync(join(DIR, f), 'utf8').includes('FUNCTION public.builder_network_announce_stock_selection()'));
const latestFile = defining[defining.length - 1];
const latest = stripSql(readFileSync(join(DIR, latestFile), 'utf8'));
const body = latest.slice(latest.indexOf('CREATE OR REPLACE FUNCTION public.builder_network_announce_stock_selection()'));
const fnBody = body.slice(0, body.indexOf('$fn$;') + 5);

describe('the activation producer kicks the delivery worker', () => {
  it('kicks the same worker messages use, after the row is queued, only when one was', () => {
    const insertAt = fnBody.indexOf('INSERT INTO public.builder_network_outbox');
    const kickAt = fnBody.indexOf('PERFORM public.builder_network_kick_outbox()');
    expect(insertAt, latestFile).toBeGreaterThan(-1);
    expect(kickAt, `${latestFile} must kick the worker`).toBeGreaterThan(insertAt);
    expect(fnBody.slice(insertAt, kickAt)).toMatch(/ON CONFLICT \(dedupe_key\) DO NOTHING;\s*IF FOUND THEN\s*$/);
  });

  it('keeps every guarantee the previous definition made', () => {
    for (const clause of [
      "IF NEW.status = 'builder_acknowledged' THEN",
      'NEW.status IS NOT DISTINCT FROM OLD.status',
      "key = 'builder_network_enabled'",
      "c.state = 'active'",
      "'stock:publish' = ANY (c.scopes)",
      "'stock.selection.announced'",
      "'stock.selection.updated'",
      "nextval('public.builder_network_selection_version_seq')",
      "'stock.selection:' || NEW.id || ':' || v_version",
      'u.username',
      'u.is_active = true AND u.deleted_at IS NULL',
      "'remote_selection_ref', NEW.id",
      "'agency', v_agency",
      'ON CONFLICT (dedupe_key) DO NOTHING',
    ]) expect(fnBody, clause).toContain(clause);
    expect(latest).toMatch(/REVOKE ALL ON FUNCTION public\.builder_network_announce_stock_selection\(\)\s+FROM PUBLIC, anon, authenticated/);
  });

  it('the worker still accepts that caller, and the minute schedule stays as recovery', () => {
    const worker = readFileSync(join(ROOT, 'supabase/functions/cross-portal-outbox-worker/index.ts'), 'utf8');
    expect(worker).toMatch(/allowedCallers:\s*\['pg_cron',\s*'agency_message'\]/);
    const schedule = readFileSync(join(DIR, '20260916000000_cross_portal_outbox_worker_schedule.sql'), 'utf8');
    expect(schedule).toContain("'cross-portal-outbox-worker-1min'");
  });
});
