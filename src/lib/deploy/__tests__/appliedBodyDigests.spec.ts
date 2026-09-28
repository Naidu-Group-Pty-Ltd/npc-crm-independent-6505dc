/**
 * The rule that decides whether this deployment has already RUN a migration's
 * bytes, and the guard built on it.
 *
 * `scripts/security/appliedBodyIdentity.mjs` is a transcription of Mission
 * Control's `migrationBodyIdentity.pure.ts` — the module the cascade itself
 * runs on — because this check must run on every pull request with no network
 * and no dependency on another repository. Two copies of one rule is how the
 * two come to disagree, so the properties the rule turns on are pinned HERE as
 * well as there: if a future edit widens or narrows one copy, this fails.
 *
 * What the two copies disagreeing would cost, if it ever happened silently:
 * Mission Control would clear for the fleet a set this manifest does not
 * record, or withhold one it does. Neither breaks a database. Both make the
 * page and the guard describe different corpora.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EMPTY_BODY_SHA256,
  LEDGER_BODY_DIGEST_SQL,
  bodyDigests,
  executableBody,
  formIndexFor,
  migrationBodyForms,
  sha256Hex,
} from '../../../../scripts/security/appliedBodyIdentity.mjs';
import { TREE_IS_PRIME } from '../../testSupport/primeTree';

const MANIFEST = 'scripts/security/applied-body-digests.txt';
const BASELINE = 'scripts/security/applied-body-digest-baseline.txt';
const MIGRATIONS = 'supabase/migrations';

describe('the ladder removes only bytes that cannot execute', () => {
  it('offers one form per rung, so a match INDEX is the rung that produced it', () => {
    // Identical rungs are kept rather than deduped: deduping made the index an
    // index into a shorter list, and a leading-comment match in a file with no
    // trailing whitespace then reported itself as a whitespace match.
    const sql = 'create table t (id int);';
    expect(migrationBodyForms(sql)).toEqual([sql, sql, sql]);
    expect(migrationBodyForms('select 1;\n')).toEqual(['select 1;\n', 'select 1;', 'select 1;']);
  });

  it('discounts trailing whitespace, and nothing else about the tail', () => {
    expect(executableBody('select 1;\n\n  \n')).toBe('select 1;');
  });

  it('discounts a LEADING comment block and keeps every internal one', () => {
    const sql = '-- what this does\n--\n\nselect 1; -- inline stays\n-- trailing comment stays';
    expect(executableBody(sql)).toBe('select 1; -- inline stays\n-- trailing comment stays');
  });

  it('never yields an empty rung, and dropping one cannot shift another', () => {
    for (const sql of ['', '-- nothing\n', '\n\n  \n']) {
      expect(migrationBodyForms(sql).every((f: string) => f !== '')).toBe(true);
    }
    // The property that makes the drop safe: an empty rung can only be
    // followed by empty rungs, so a survivor never moves. Whitespace-only is
    // the one input that empties rungs 1 and 2 while keeping rung 0.
    expect(migrationBodyForms('  \n\n')).toEqual(['  \n\n']);
    expect(migrationBodyForms('')).toEqual([]);
    // …and the digest of nothing is excluded by name on both sides.
    expect(sha256Hex('')).toBe(EMPTY_BODY_SHA256);
    expect(bodyDigests('-- only a comment')).not.toContain(EMPTY_BODY_SHA256);
  });

  it('is idempotent, which is what makes a rung collision safe', () => {
    // The four-case proof in the module header rests on this: a body that
    // EQUALS some body's executable form strips to itself.
    for (const sql of ['select 1;', '-- x\nselect 1;', 'select 1;\n\n', '-- a\n-- b\n\nselect 2; ']) {
      expect(executableBody(executableBody(sql))).toBe(executableBody(sql));
    }
  });

  it('matches at ANY rung, because the guard asks the cascade’s question', () => {
    const ran = 'select 1;';
    const digest = sha256Hex(ran);
    expect(formIndexFor('select 1;', digest)).toBe(0);
    expect(formIndexFor('select 1;\n\n', digest)).toBe(1);
    expect(formIndexFor('-- documented afterwards\n\nselect 1;', digest)).toBe(2);
    // Both kinds at once is still rung 2 — the rung is named for what it
    // asserts, not for one of the two things it ignores.
    expect(formIndexFor('-- doc\n\nselect 1;\n\n', digest)).toBe(2);
    expect(formIndexFor('select 2;', digest)).toBe(-1);
  });

  it('names the ledger digest as one SQL expression, so the query cannot drift', () => {
    // Pinned as a string because the generator interpolates it into SQL and a
    // second spelling elsewhere would compute a different digest in silence.
    expect(LEDGER_BODY_DIGEST_SQL).toBe(
      "encode(sha256(convert_to(array_to_string(statements, E'\\n'), 'UTF8')), 'hex')",
    );
  });
});

describe('the manifest is a record of this corpus, not of a fixture', () => {
  const lines = readFileSync(MANIFEST, 'utf8')
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((l) => /^([0-9a-f]{64})\s+(\S.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ sha256: m[1], name: m[2].trim() }));

  it('records hundreds of real files, so a pass is not a pass over nothing', () => {
    // A guard over an empty manifest passes every run and guards nothing —
    // the shape this repository has had to fix more than once. The floor is
    // set well under the measured 690 so ordinary growth does not trip it.
    expect(lines.length).toBeGreaterThan(500);
  });

  it('every recorded file exists and still carries the SQL that ran', () => {
    const broken = lines.filter(
      (e) =>
        !existsSync(join(MIGRATIONS, e.name)) ||
        formIndexFor(readFileSync(join(MIGRATIONS, e.name), 'utf8'), e.sha256) < 0,
    );
    expect(broken.map((b) => b.name)).toEqual([]);
  });

  it('names each file once', () => {
    expect(new Set(lines.map((e) => e.name)).size).toBe(lines.length);
  });

  it('records only files this corpus holds', () => {
    const corpus = new Set(readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')));
    expect(lines.filter((e) => !corpus.has(e.name)).map((e) => e.name)).toEqual([]);
  });

  it('carries a frozen, empty baseline — an exemption is a person’s act', () => {
    const entries = readFileSync(BASELINE, 'utf8')
      .split('\n')
      .map((l) => l.replace(/#.*$/, '').trim())
      .filter(Boolean);
    expect(entries).toEqual([]);
  });
});

describe('the re-check names what it found, not only how many', () => {
  // The prime's "Apply a migration" run on 26 Sep 2026 said "8 file(s) now match
  // and are not recorded yet" and named none of them, sending the next person
  // to a ledger only that run could read. The re-check now prints the line the
  // generator would write for each, matched against the ledger it just read.
  it('prints the manifest line for a file the ledger holds and the manifest does not', () => {
    const recorded = new Map(
      readFileSync(MANIFEST, 'utf8')
        .split('\n')
        .map((l) => /^([0-9a-f]{64})\s+(\S.*)$/.exec(l.replace(/#.*$/, '').trim()))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[2].trim(), m[1]] as const),
    );
    const digestsInManifest = new Set(recorded.values());
    const unrecorded = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && !recorded.has(f))
      .sort()
      .reverse()
      .find((f) => {
        const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
        return sql.length < 200_000 && !bodyDigests(sql).some((d: string) => digestsInManifest.has(d));
      });
    expect(unrecorded).toBeDefined();
    const digest = bodyDigests(readFileSync(join(MIGRATIONS, unrecorded as string), 'utf8'))[0];

    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    const ledger = join(dir, 'digests.txt');
    try {
      writeFileSync(ledger, [...digestsInManifest, digest].join('\n'));
      const run = spawnSync(
        process.execPath,
        ['scripts/security/build-applied-body-digests.mjs', '--verify', '--digests', ledger],
        { encoding: 'utf8' },
      );
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain('1 file(s) now match and are not recorded yet');
      // The line is exactly what the manifest parses, so it can be added as read.
      const line = run.stdout.split('\n').find((l) => l.includes(unrecorded as string)) ?? '';
      expect(line.trim()).toBe(`${digest}  ${unrecorded}`);
      // …and verifying never writes the manifest.
      expect(readFileSync(MANIFEST, 'utf8').includes(unrecorded as string)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the guard is wired, not merely written', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('has a way to run it and a way to rebuild it', () => {
    expect(pkg.scripts['check:applied-body-digests']).toContain(
      'scripts/security/check-applied-body-digests.mjs',
    );
    expect(pkg.scripts['migrations:body-digests']).toContain(
      'scripts/security/build-applied-body-digests.mjs',
    );
  });

  it('runs on every pull request', () => {
    // An unmounted check passes lint, passes typecheck and guards nothing —
    // the defect `builderPortalUiMounted` exists to catch, in a workflow.
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain(
      'scripts/security/check-applied-body-digests.mjs',
    );
  });

  it.runIf(TREE_IS_PRIME)('is re-checked against the live ledger wherever a migration is applied', () => {
    // The half a pull request cannot do. Without it the manifest could become
    // fiction and nothing would say so.
    // The prime's own workflow: a clone keeps its own `apply-migration.yml`,
    // which the cascade never overwrites (see `testSupport/primeTree.ts`).
    // After BOTH apply steps and on neither route alone: it used to be
    // psql-only and placed before the Management API step, so on the prime,
    // which applies over the Management API, it never ran.
    const wf = readFileSync('.github/workflows/apply-migration.yml', 'utf8');
    const recheck = wf.indexOf('- name: Re-check the applied-body manifest against the live ledger');
    expect(recheck).toBeGreaterThan(wf.indexOf('- name: Apply over the Management API'));
    expect(recheck).toBeGreaterThan(wf.indexOf('- name: Apply over psql'));
    const step = wf.slice(recheck);
    expect(step).toContain('build-applied-body-digests.mjs --verify');
    expect(step).not.toMatch(/\n\s+if: steps\.route/);
    expect(step).toContain('SUPABASE_ACCESS_TOKEN');
  });
});
