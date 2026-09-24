/**
 * "Apply a migration" checks a request before it runs, and proves the ledger
 * row it writes. These are the rules in `scripts/ops/applyPreflight.pure.mjs`,
 * `scripts/security/ledgerRecord.mjs` and `scripts/lib/ledgerQuery.mjs`, judged
 * against the real migration directory rather than invented file names.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { assessApplyRequest, parseFileList, sharedVersions } from '../../../../scripts/ops/applyPreflight.pure.mjs';
import {
  migrationIdentity,
  recordAppliedMigration,
  recordSql,
  storableBody,
} from '../../../../scripts/security/ledgerRecord.mjs';
import { MAX_DIGEST_BYTES, bodyDigests } from '../../../../scripts/security/appliedBodyIdentity.mjs';
import { ledgerQuery, ledgerRoute } from '../../../../scripts/lib/ledgerQuery.mjs';
import { parseWithdrawals, withdrawalsByFile } from '../../../../scripts/ops/migrationWithdrawals.pure.mjs';
import { TREE_IS_PRIME } from '../../testSupport/primeTree';

const DIR = 'supabase/migrations';
const corpus = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const withdrawn = withdrawalsByFile(parseWithdrawals(readFileSync(`${DIR}/MIGRATION_WITHDRAWN.json`, 'utf8')).entries);
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const rungsOf = (f: string) => bodyDigests(readFileSync(f, 'utf8'));
const base = { exists: existsSync, corpus, withdrawn, reapply: false };
const PLAIN = `${DIR}/20261219040000_restate_quick_send_finance_portal_share.sql`;
const noLedger = { recorded: new Map<string, string | null>(), bodies: new Map<string, string[]>() };

describe('the preflight refuses what must never run', () => {
  const refused = (requested: string[], extra = {}) =>
    assessApplyRequest({ ...base, requested, ledger: null, ...extra }).refusals.map((r) => r.rule);

  it('refuses an empty request, a non-migration path, a missing file and a file named twice', () => {
    expect(refused(parseFileList(' , \n'))).toEqual(['no_file']);
    expect(refused(['docs/x.sql', 'supabase/migrations/nested/20260101000000_x.sql'])).toEqual([
      'not_a_migration_path',
      'not_a_migration_path',
    ]);
    expect(refused([`${DIR}/20991231000000_absent.sql`])).toEqual(['missing']);
    expect(refused([PLAIN, PLAIN])).toEqual(['listed_twice']);
  });

  it('refuses every withdrawn file, even with reapply', () => {
    for (const name of withdrawn.keys()) {
      expect(refused([`${DIR}/${name}`], { reapply: true })).toContain('withdrawn');
    }
    expect(withdrawn.size).toBeGreaterThan(0);
  });

  it('refuses every file of a shared version — exactly the frozen collisions', () => {
    const frozen = JSON.parse(readFileSync(`${DIR}/MIGRATION_VERSION_COLLISIONS.json`, 'utf8')).collisions;
    const groups = sharedVersions(corpus);
    expect([...groups.keys()].sort()).toEqual(frozen.map((c: { version: string }) => c.version).sort());
    const files = [...groups.values()].flat();
    expect(groups.size).toBe(25);
    expect(files).toHaveLength(61);
    for (const f of files) {
      const rules = refused([`${DIR}/${f}`], { reapply: true });
      expect(rules.length, f).toBe(1);
      expect(['shared_version', 'withdrawn']).toContain(rules[0]);
    }
  });
});

describe('the preflight reads this database’s ledger', () => {
  const judge = (ledger: typeof noLedger, reapply = false) =>
    assessApplyRequest({ ...base, reapply, requested: [PLAIN], ledger, rungsOf });
  const v = '20261219040000';

  it('passes a file the ledger has never seen', () => {
    expect(judge(noLedger).refusals).toEqual([]);
  });

  it('refuses a recorded version unless reapply is set, and then says so', () => {
    const ledger = { ...noLedger, recorded: new Map([[v, null]]) };
    expect(judge(ledger).refusals.map((r) => r.rule)).toEqual(['already_recorded']);
    const again = judge(ledger, true);
    expect(again.refusals).toEqual([]);
    expect(again.reapplied.map((r) => r.rule)).toEqual(['already_recorded']);
  });

  it('refuses a body the ledger holds under another version unless reapply is set', () => {
    const ledger = { ...noLedger, bodies: new Map([[rungsOf(PLAIN)[1], ['20261219040002']]]) };
    const r = judge(ledger);
    expect(r.refusals.map((x) => x.rule)).toEqual(['already_ran_by_body']);
    expect(r.refusals[0].message).toContain('20261219040002');
    expect(judge(ledger, true).refusals).toEqual([]);
  });

  it('refuses, even with reapply, a file whose recorded body matches none of its forms', () => {
    const ledger = { ...noLedger, recorded: new Map([[v, sha('something else')]]) };
    expect(judge(ledger, true).refusals.map((r) => r.rule)).toEqual(['edited_after_apply']);
    // Its own body, at any rung, is a re-run and not an edit.
    const same = { ...noLedger, recorded: new Map([[v, rungsOf(PLAIN)[2]]]) };
    expect(judge(same, true).refusals).toEqual([]);
  });
});

describe('the ledger row carries the file, and nothing is spliced into SQL', () => {
  it('stores every file of 256 KiB or less so that it reads back as the first rung', () => {
    let stored = 0;
    for (const name of corpus) {
      const path = `${DIR}/${name}`;
      if (statSync(path).size > MAX_DIGEST_BYTES) continue;
      const bytes = readFileSync(path);
      const body = storableBody(bytes);
      if (!('text' in body)) continue;
      // A file outside the version rule (VCJ's `not_a_migration`) is one the
      // preflight refuses before anything is recorded.
      const id = migrationIdentity(path);
      if (!id) continue;
      const sql = recordSql({ version: id.version, name: id.name, body: body.text });
      const b64 = /array\[convert_from\(decode\('([A-Za-z0-9+/=]*)', 'base64'\)/.exec(sql)![1];
      expect(sha(Buffer.from(b64, 'base64')), name).toBe(bodyDigests(readFileSync(path, 'utf8'))[0]);
      // The only quotes are the ones this module writes.
      expect(sql.replace(/'[A-Za-z0-9+/=]*'/g, '').includes("'"), name).toBe(false);
      stored++;
    }
    expect(stored).toBeGreaterThan(900);
  });

  it('never stores an oversize, NUL-bearing or non-UTF-8 body', () => {
    expect(storableBody(Buffer.alloc(MAX_DIGEST_BYTES + 1, 0x61))).toEqual({ reason: 'oversize' });
    expect(storableBody(Buffer.from('select 1;\0'))).toEqual({ reason: 'nul' });
    expect(storableBody(Buffer.from([0x73, 0xff, 0x3b]))).toEqual({ reason: 'not_utf8' });
    expect(recordSql({ version: '20261219040000', name: 'x' })).not.toContain('statements');
    expect(() => recordSql({ version: "1'; drop", name: 'x' })).toThrow();
  });

  it('says "recorded" only when a row came back, and fails when the body reads back wrong', async () => {
    const bytes = readFileSync(PLAIN);
    const answers = (rows: string[][]) => async () => rows.shift() ?? [];
    expect(await recordAppliedMigration({ path: PLAIN, bytes, q: answers([[]]) })).toMatchObject({ recorded: false });
    expect(
      await recordAppliedMigration({ path: PLAIN, bytes, q: answers([['20261219040000'], [sha(bytes)]]) }),
    ).toMatchObject({ recorded: true, bodyStored: true });
    await expect(
      recordAppliedMigration({ path: PLAIN, bytes, q: answers([['20261219040000'], [sha('other')]]) }),
    ).rejects.toThrow(/does not describe it/);
  });
});

describe('one ledger reader, two routes', () => {
  it('prefers the database URL, and needs a ref beside a token', () => {
    expect(ledgerRoute({ SUPABASE_DB_URL: 'postgres://x', SUPABASE_ACCESS_TOKEN: 't', PROJECT_REF: 'r' })?.route).toBe('psql');
    expect(ledgerRoute({ SUPABASE_ACCESS_TOKEN: 't', PROJECT_REF: 'r' })).toEqual({ route: 'api', token: 't', ref: 'r' });
    expect(ledgerRoute({ SUPABASE_ACCESS_TOKEN: 't' })).toBeNull();
  });

  it('sends psql its SQL on stdin, never as an argument', async () => {
    const calls: Array<{ args: string[]; input: string }> = [];
    const exec = ((_: string, args: string[], opts: { input: string }) => {
      calls.push({ args, input: opts.input });
      return 'a\n\n b \n';
    }) as never;
    expect(await ledgerQuery({ route: 'psql', conn: 'postgres://x' }, { exec })('select 1')).toEqual(['a', 'b']);
    expect(calls[0].args).not.toContain('select 1');
    expect(calls[0].input).toBe('select 1');
  });

  it('reads the first column over the Management API and refuses a non-row answer', async () => {
    const reply = (status: number, body: unknown) =>
      (async () => ({ ok: status < 300, status, text: async () => JSON.stringify(body) })) as never;
    const q = (f: never) => ledgerQuery({ route: 'api', token: 't', ref: 'r' }, { fetchImpl: f });
    expect(await q(reply(200, [{ v: 'x' }, { v: null }]))('select')).toEqual(['x']);
    await expect(q(reply(200, { error: 1 }))('select')).rejects.toThrow(/not a row set/);
    await expect(q(reply(500, 'no'))('select')).rejects.toThrow(/HTTP 500/);
  });
});

// The prime's own workflow. A clone keeps its own `apply-migration.yml`, which
// the cascade never overwrites, so on a clone these assertions have no subject.
describe.runIf(TREE_IS_PRIME)('the workflow wires the guards in order', () => {
  const wf = readFileSync('.github/workflows/apply-migration.yml', 'utf8');
  const at = (name: string) => wf.indexOf(`- name: ${name}`);

  it('refuses a non-default branch first, and offers no default file', () => {
    const steps = [...wf.matchAll(/^ {6}- (?:name|uses): (.+)$/gm)].map((m) => m[1]);
    expect(steps[0]).toBe('Refuse a dispatch from anywhere but the default branch');
    const fileInput = wf.slice(wf.indexOf('      file:'), wf.indexOf('      reapply:'));
    expect(fileInput).not.toMatch(/\n\s+default:/);
    expect(wf).toMatch(/reapply:[\s\S]*?default: false/);
  });

  it('runs the preflight on both routes before either apply, and applies only its list', () => {
    const pre = at('Check the request against the tree and the ledger');
    expect(pre).toBeGreaterThan(at('Choose a route to the database'));
    expect(pre).toBeLessThan(at('Apply over psql'));
    expect(pre).toBeLessThan(at('Apply over the Management API'));
    expect(wf.slice(pre, at('Apply over psql'))).not.toMatch(/\n\s+if:/);
    const applies = wf.slice(at('Apply over psql'), at('Re-check the applied-body manifest against the live ledger'));
    expect(applies).not.toContain('inputs.file');
    expect(applies.match(/steps\.preflight\.outputs\.files/g)).toHaveLength(2);
    expect(applies).toContain('node .github/scripts/record-migration.mjs');
  });
});
