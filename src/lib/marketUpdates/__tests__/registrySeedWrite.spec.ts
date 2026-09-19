/**
 * The registry seed inserts; it must never upsert on `source_key`.
 *
 * The only unique index on that column is PARTIAL:
 *
 *   create unique index market_sources_source_key_uidx
 *     on public.market_sources(source_key) where source_key is not null;
 *
 * Postgres infers a partial index for ON CONFLICT only when the statement
 * repeats its predicate — which is exactly why every seeding migration writes
 * `on conflict(source_key) where source_key is not null`. PostgREST's
 * `on_conflict=` emits no predicate, so `.upsert(rows, { onConflict:
 * 'source_key' })` answers **42P10**, "there is no unique or exclusion
 * constraint matching the ON CONFLICT specification".
 *
 * That failure is invisible from the calling code: it lands in the catch that
 * logs and carries on, so the repair would have appeared to be wired up and
 * would never once have run. Nothing else in the system would have said so —
 * the feed would have stayed empty for the reason it was already empty.
 *
 * Source-level, because the partial index cannot be seen from the edge
 * function and no type or test double reproduces PostgREST's inference.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..', '..');
const fn = readFileSync(
  join(root, 'supabase', 'functions', 'market-updates-ingest', 'index.ts'),
  'utf8',
);

/** The function's own code, with comments removed. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('the market_sources unique indexes on source_key', () => {
  it('are ALL partial, which is what makes a predicate-less upsert unusable', () => {
    // Read from the migrations rather than restated: if somebody ever adds a
    // plain unique constraint, this test should be the thing that notices.
    const migrations = join(root, 'supabase', 'migrations');
    const declarations: string[] = [];
    for (const file of readdirSync(migrations)) {
      if (!file.endsWith('.sql')) continue;
      const sql = readFileSync(join(migrations, file), 'utf8');
      for (const m of sql.matchAll(/create unique index[^;]*market_sources[^;]*source_key[^;]*;/gi)) {
        declarations.push(m[0].replace(/\s+/g, ' '));
      }
    }
    expect(declarations.length, 'no unique index on source_key was found').toBeGreaterThan(0);
    // There are two, with DIFFERENT predicates — `where source_key is not
    // null` and `where registry_status = 'canonical'`. Neither can be inferred
    // by a statement that names no predicate, so what matters is that every
    // one of them is partial. A plain unique constraint appearing here would
    // make an upsert legal again, and this is the test that should notice.
    for (const declaration of declarations) {
      expect(declaration.toLowerCase(), declaration).toMatch(/\bwhere\b/);
    }
  });
});

describe('market-updates-ingest registry seed', () => {
  const body = code(fn);

  it('writes the seed with insert', () => {
    expect(body).toMatch(/from\("market_sources"\)\s*\.insert\(rows\)/);
  });

  it('never upserts on source_key', () => {
    expect(body).not.toMatch(/onConflict:\s*['"]source_key['"]/);
    expect(body.includes('.upsert(')).toBe(false);
  });

  it('treats a concurrent seed as filled rather than as a failure', () => {
    // Two runs racing is the only conflict a plain insert can hit here, and
    // the loser's 23505 means the winner filled the registry.
    expect(body).toContain("'23505'");
  });

  it('keeps the reason on the record', () => {
    // The rule is worth nothing if the next reader reintroduces the upsert
    // because the comment explaining the partial index went with the code.
    expect(fn).toMatch(/partial/i);
    expect(fn).toContain('42P10');
  });
});
