#!/usr/bin/env node
/**
 * Fail the build when an `activity_logs` write names an entity type the column
 * will reject.
 *
 * `activity_logs.entity_type` is the Postgres enum `activity_entity_type`.
 * PostgREST answers an unknown value with `22P02` at RUNTIME, and every one of
 * this repo's audit writes discarded that error — so `update-integration-secret`
 * recorded no credential change for the life of the deployment while returning
 * `success: true`, and `aml-verification` recorded no provider promotion.
 *
 * The vocabulary lives in `_shared/activityAudit.ts` and is read from there, so
 * a migration that adds an enum value is declared in exactly one place.
 *
 * Only LITERAL entity types are judged. A value assembled in a variable is not
 * a name anything can read, which is the same limit `check-edge-column-names`
 * documents — narrow and honest beats broad and wrong.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath(import.meta.url)` rather than `import.meta.dirname`, which
// needs Node 20.11+. Every sibling gate resolves the repo root this way.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SHARED = resolve(REPO, 'supabase/functions/_shared/activityAudit.ts');

function declaredTypes() {
  const src = readFileSync(SHARED, 'utf8');
  const block = /export const ACTIVITY_ENTITY_TYPES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!block) {
    console.error('check-activity-entity-types: could not read ACTIVITY_ENTITY_TYPES from');
    console.error('  ' + relative(REPO, SHARED));
    process.exit(2);
  }
  return new Set([...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

const VALID = declaredTypes();

// Test files are excluded on purpose: a spec that feeds `'settings'` in to
// prove the helper REFUSES it is the opposite of the defect, and flagging it
// would make the guard punish its own regression test.
const IS_TEST = /(^|\/)__tests__\/|\.(spec|test)\.tsx?$/;

// A manual walk rather than `fs.globSync`, which only exists from Node 22 and
// throws `SyntaxError: does not provide an export named 'globSync'` on the
// Node 20 the workflows pin. Every sibling gate in this directory walks the
// tree the same way; matching them keeps the whole set portable.
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // A directory that is not checked out is not a finding.
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (/\.tsx?$/.test(name)) out.push(relative(REPO, abs));
  }
  return out;
}

const files = [
  ...walk(resolve(REPO, 'supabase/functions')),
  ...walk(resolve(REPO, 'src')),
].filter((f) => !IS_TEST.test(f));

const offences = [];
for (const rel of files) {
  const src = readFileSync(resolve(REPO, rel), 'utf8');

  // (a) a direct insert into activity_logs, and (b) a recordActivity call.
  const scopes = [];
  const pushScope = (m) => {
    const at = m.index + m[0].length;
    scopes.push([at, src.slice(at, at + 2000)]);
  };
  for (const m of src.matchAll(/from\(\s*['"]activity_logs['"]\s*\)\s*\.insert\(/g)) pushScope(m);
  for (const m of src.matchAll(/recordActivity\(/g)) pushScope(m);

  for (const [at, raw] of scopes) {
    const end = raw.indexOf('})');
    const seg = end === -1 ? raw : raw.slice(0, end);
    for (const em of seg.matchAll(/entity_type\s*:\s*['"]([A-Za-z_]+)['"]/g)) {
      if (VALID.has(em[1])) continue;
      const line = src.slice(0, at).split('\n').length;
      offences.push({ file: rel, line, value: em[1] });
    }
  }
}

if (offences.length > 0) {
  console.error(`activity_logs entity_type gate: ${offences.length} invalid literal(s).\n`);
  for (const o of offences) {
    console.error(`  ${o.file}:${o.line}  entity_type: '${o.value}'`);
  }
  console.error('\nThese inserts are rejected by the activity_entity_type enum at runtime.');
  console.error(`Valid values: ${[...VALID].join(', ')}`);
  console.error('Declare new values in supabase/functions/_shared/activityAudit.ts,');
  console.error('and add the migration that extends the enum.');
  process.exit(1);
}

console.log(`activity_logs entity_type gate: ${files.length} files scanned, 0 invalid literals.`);
console.log(`Vocabulary: ${VALID.size} declared values.`);
