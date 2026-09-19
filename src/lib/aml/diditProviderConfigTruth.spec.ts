import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The provider catalogue must not contradict the provider client.
 *
 * `aml.provider_configs.config` for `didit_standalone` records, among other
 * things, whether Didit keeps a copy of each request — `save_api_request`. No
 * code reads that field. It is documentation stored in a database, which is
 * exactly why it drifted: types cannot check it, the column-name scanner
 * cannot see it, and no test exercised it. It said `false` and carried a note
 * reading "save_api_request is false on every call" from 11 Sep, while every
 * call had sent `true` since 2026-08-14.
 *
 * What that denied is the point. Under `true` Didit RETAINS the customer's
 * document images and selfie, so this deployment's buckets are not the only
 * copy — and the catalogue told anyone who read it the opposite. That is a
 * statement about where personal information lives, made to the people who
 * answer for it.
 *
 * ## What this asserts, and why it reads the way it does
 *
 * The **resulting** state, never a single file. A migration is an applied
 * fact: `20260911000000_aml_didit_standalone_capture.sql` really did write
 * `false`, and rewriting its text would be falsifying history. So this walks
 * the migrations in the order Postgres applies them, keeps the LAST value
 * written, and compares that to the literal the client actually sends.
 *
 * It therefore stays true through a future reversal: flip the flag in the
 * client and this fails until a migration follows it, and vice versa. It pins
 * the agreement, not the value.
 */

const REPO = resolve(__dirname, '../../..');
const MIGRATIONS = resolve(REPO, 'supabase/migrations');
const CLIENT = resolve(
  REPO,
  'supabase/functions/_shared/aml/providers/diditStandaloneClient.ts',
);

/** What `baseForm()` appends to every Standalone request. */
function flagTheClientSends(): string {
  const src = readFileSync(CLIENT, 'utf8');
  const matches = [...src.matchAll(/form\.append\(\s*'save_api_request'\s*,\s*'([^']+)'\s*\)/g)];
  expect(
    matches.length,
    'the Standalone client must append save_api_request exactly once, in baseForm()',
  ).toBe(1);
  return matches[0][1];
}

/**
 * The last value any migration writes into a provider config, and the last
 * note prose that speaks about the flag.
 *
 * Sorted by filename, which is the order the CLI applies them.
 */
function catalogueEndState(): { flag: string | null; note: string | null } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let flag: string | null = null;
  let note: string | null = null;

  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    for (const m of sql.matchAll(/'save_api_request'\s*,\s*(true|false)\b/gi)) {
      flag = m[1].toLowerCase();
    }
    for (const m of sql.matchAll(/save_api_request is (true|false)\b/gi)) {
      note = m[1].toLowerCase();
    }
  }
  return { flag, note };
}

describe('the Didit provider catalogue agrees with the Didit client', () => {
  it('the catalogue ends on the same save_api_request the client sends', () => {
    const sent = flagTheClientSends();
    const { flag } = catalogueEndState();

    expect(flag, 'no migration sets save_api_request in the provider config').not.toBeNull();
    expect(
      flag,
      `the client sends save_api_request=${sent} while the catalogue ends on ${flag}. ` +
        'Nothing reads that field, so only this test can tell you — and what it records ' +
        "is whether Didit keeps a copy of the customer's identity document.",
    ).toBe(sent);
  });

  it("the catalogue's prose does not deny what the flag says", () => {
    const { flag, note } = catalogueEndState();
    if (note === null) return; // no note speaks about the flag; nothing to contradict
    expect(
      note,
      'the note and the boolean in the same config row must not disagree — a reader who ' +
        'filters on one and a reader who reads the other would get opposite answers about ' +
        'where a customer\'s document images live',
    ).toBe(flag);
  });

  it('records that the flag decides retention, so a future edit knows the stake', () => {
    const client = readFileSync(CLIENT, 'utf8');
    expect(client).toMatch(/RETAINS the customer's document images/);
  });
});
