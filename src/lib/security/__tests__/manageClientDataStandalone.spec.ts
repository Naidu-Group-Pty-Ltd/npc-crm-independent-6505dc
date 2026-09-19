/**
 * A table with no `client_id` cannot be written "through a client".
 *
 * `manage-client-data` splits its tables in two: STANDALONE ones a mutation
 * names directly, and client-scoped ones where the caller supplies a
 * `clientId` that the function binds ownership to and stamps onto the row.
 * A table that has no `client_id` column belongs in the first group and is
 * unwritable in the second — from either direction:
 *
 *  - with no `clientId`, the guard answers 400 "clientId is required for
 *    related tables";
 *  - with one, the create branch adds `client_id` to the payload and Postgres
 *    answers 42703.
 *
 * `ghl_conversation_messages` was in that state. The CRM Conversations page
 * records a sent email into the thread through this function, so every email
 * sent from that page was refused and vanished from the history while showing
 * up in the Email Copilot's sent folder — reported as its own defect in the
 * 19 Sep 2026 clone audit.
 *
 * Nothing fails loudly when a table is on the wrong side, so this is a
 * source-level guard: the two lists are read from the function and from the
 * writable-column map beside it, and compared.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..', '..');
const fn = readFileSync(
  join(root, 'supabase', 'functions', 'manage-client-data', 'index.ts'),
  'utf8',
);
const columns = readFileSync(
  join(root, 'supabase', 'functions', '_shared', 'clientDataWritableColumns.ts'),
  'utf8',
);

/** The list the function actually applies, read from it rather than restated. */
function standaloneTables(): string[] {
  const match = /const STANDALONE_TABLES = \[([\s\S]*?)\];/.exec(fn);
  expect(match, 'STANDALONE_TABLES could not be read from the function').toBeTruthy();
  return [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Every table the writable-column map covers. */
function writableTables(): string[] {
  return [...columns.matchAll(/^\s{2}([a-z0-9_]+):\s*new Set\(\[/gm)].map((m) => m[1]);
}

/**
 * Whether a table HAS a `client_id` column, from the schema rather than from
 * the writable list.
 *
 * They are different questions: a client-scoped table deliberately leaves
 * `client_id` out of its WRITABLE columns because the function stamps it
 * server-side, so reading the writable list to answer "does this table have
 * one" reports every one of them as missing it.
 *
 * `knownColumns` is the generated types UNION the migrations, the same reading
 * `check-edge-column-names.mjs` judges by.
 */
async function hasClientIdColumn(table: string): Promise<boolean | null> {
  const { knownColumns } = await import(
    /* @vite-ignore */ join(root, 'scripts', 'security', 'lib', 'supabaseSchema.mjs')
  ) as { knownColumns: (t: string) => string[] | null };
  const cols = knownColumns(table);
  return cols === null ? null : cols.includes('client_id');
}

describe('manage-client-data: client-scoped vs standalone', () => {
  const standalone = new Set(standaloneTables());
  const writable = writableTables();

  it('reads both lists rather than restating them', () => {
    expect(standalone.size).toBeGreaterThan(0);
    expect(writable.length).toBeGreaterThan(0);
  });

  it('never treats a table with no client_id as client-scoped', async () => {
    const misplaced: string[] = [];
    for (const table of writable) {
      if (standalone.has(table)) continue;
      const has = await hasClientIdColumn(table);
      // A table neither the generated types nor the migrations describe is not
      // this gate's to judge.
      if (has === false) misplaced.push(table);
    }
    expect(misplaced).toEqual([]);
  });

  it('keeps the conversation tables standalone', () => {
    // Named because this is the pair the audit found, and because a future
    // reader adding a client_id to `ghl_conversations` should think about it
    // rather than have the rule flip silently underneath them.
    expect(standalone.has('ghl_conversation_messages')).toBe(true);
    expect(standalone.has('ghl_conversations')).toBe(true);
  });
});
