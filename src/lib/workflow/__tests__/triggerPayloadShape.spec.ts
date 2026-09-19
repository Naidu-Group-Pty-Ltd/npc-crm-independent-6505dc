/**
 * The capture triggers live in SQL and the contract they satisfy lives in
 * TypeScript, so nothing but this test connects them.
 *
 * A rename on either side produces no error anywhere: the migration still
 * applies, the catalog still type-checks, the canvas still draws the outputs —
 * and every `{{trigger.thatKey}}` in every live workflow quietly resolves to
 * nothing the next time a real event arrives. That failure is invisible until
 * someone reads a run and finds an empty email.
 *
 * So: every key the SQL emits must be a declared output of that trigger, and
 * every declared output must be emitted.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getCatalogNode } from '../catalog';

const SQL = readFileSync(
  'supabase/migrations/20260815001000_capture_platform_trigger_events.sql',
  'utf8',
);

/** The queue and its enqueue helper, which the capture triggers call into. */
const QUEUE_SQL = readFileSync(
  'supabase/migrations/20260815000000_create_workflow_trigger_events.sql',
  'utf8',
);

/**
 * Pull the payload keys out of each `enqueue_workflow_trigger_event(...)` call.
 *
 * The third argument is a `jsonb_build_object(...)`, optionally composed with
 * `base ||`, so the keys are the quoted names in the argument list. Reading the
 * SQL as text is crude, but the alternative is trusting that two files agree.
 */
function emittedKeys(triggerType: string): string[] {
  const call = SQL.indexOf(`'${triggerType}'`);
  expect(call, `${triggerType} is enqueued somewhere in the migration`).toBeGreaterThan(-1);

  // The enqueue call ends at the closing `);` of the PERFORM statement.
  const end = SQL.indexOf('\n    );', call);
  const body = SQL.slice(call, end === -1 ? call + 1200 : end);

  const keys = new Set<string>();
  for (const match of body.matchAll(/'([A-Za-z][A-Za-z0-9_]*)',\s/g)) keys.add(match[1]);

  // A payload built as `base || jsonb_build_object(...)` inherits the shared
  // client fields, which are defined once further up the function.
  if (/\bbase\s*\|\|/.test(body) || body.includes('base :=')) {
    const baseBlock = SQL.slice(SQL.indexOf('base := jsonb_build_object('), SQL.indexOf('\n  );'));
    for (const match of baseBlock.matchAll(/'([A-Za-z][A-Za-z0-9_]*)',\s/g)) keys.add(match[1]);
  }
  return [...keys];
}

/** Triggers this migration actually wires. Others are catalog-only for now. */
const CAPTURED = [
  'platform.client_created',
  'platform.client_stage_changed',
  'platform.purchase_file_status_changed',
  'platform.report_generated',
] as const;

describe.each(CAPTURED)('%s capture payload', (triggerType) => {
  const definition = getCatalogNode(triggerType);
  const declared = (definition?.outputs ?? []).map((o) => o.key);
  const emitted = emittedKeys(triggerType);

  it('is a trigger the catalog knows about', () => {
    expect(definition, `${triggerType} exists in the catalog`).toBeDefined();
    expect(definition?.kind).toBe('trigger');
    expect(declared.length).toBeGreaterThan(0);
  });

  it('emits every output the canvas promises', () => {
    // A promised output that never arrives is an unresolved reference at run
    // time, in a workflow that tested fine against sample data.
    expect(declared.filter((key) => !emitted.includes(key))).toEqual([]);
  });

  it('emits nothing the catalog has not declared', () => {
    // The other direction: a key nobody can reference is dead weight in every
    // stored event, and usually means a rename landed on one side only.
    const configKeys = (definition?.fields ?? []).map((f) => f.key);
    const extra = emitted.filter((key) => !declared.includes(key) && !configKeys.includes(key));
    expect(extra).toEqual([]);
  });
});

describe('the capture migration', () => {
  it('gates every enqueue on something being live', () => {
    // Without this the queue fills on every client write in a project with no
    // live workflows at all.
    expect(QUEUE_SQL).toMatch(/IF NOT public\.workflow_trigger_is_live/);
  });

  it('never lets an automation failure break the business write', () => {
    // An automation that misses an event is a problem; a client record that
    // cannot be saved because of an automation is a bigger one.
    expect(QUEUE_SQL).toMatch(/EXCEPTION WHEN OTHERS/);
  });

  it('drops a repeated occurrence rather than running it twice', () => {
    expect(QUEUE_SQL).toMatch(/ON CONFLICT \(dedupe_key\) DO NOTHING/);
  });

  it('fires stage changes only on a real transition', () => {
    expect(SQL).toMatch(/pipeline_status IS DISTINCT FROM OLD\.pipeline_status/);
  });
});
