/**
 * Applies one migration file through the Supabase Management API.
 *
 * Called by .github/workflows/apply-migration.yml, which carries the reasoning
 * for why this exists rather than `supabase db push`. The short version: the
 * migration ledger in this project does not record what has been applied, so
 * "apply everything pending" is not a safe instruction here. This applies the
 * single file it is given, after the workflow's preflight
 * (`.github/scripts/apply-preflight.mjs`) has checked it against the ledger.
 *
 * The only clever part is the chunker, and it is deliberately narrow. It
 * recognises exactly one shape — a single `INSERT INTO … VALUES (…),(…) ON
 * CONFLICT … ;` whose tuples each begin on a line that is exactly two spaces
 * and an open paren — because that is what `buildSeedCatalogue.ts` emits. Any
 * other large file is sent whole and left to the API's own limits, rather than
 * split by a parser guessing at SQL it does not understand.
 *
 * Before anything is sent, the parsed tuples are reassembled and compared to
 * the original bytes. A chunker that silently drops or merges a tuple would
 * write a wrong catalogue rather than fail, so the reassembly check is the
 * thing that makes this safe to point at production.
 */
import { readFileSync } from 'node:fs';
import { ledgerQuery } from '../../scripts/lib/ledgerQuery.mjs';
import { recordAppliedMigration } from '../../scripts/security/ledgerRecord.mjs';

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.PROJECT_REF;
const FILE = process.env.FILE;
const RECORD_VERSION = String(process.env.RECORD_VERSION ?? 'true') === 'true';
const PER_CHUNK = Math.max(1, parseInt(process.env.TUPLES_PER_CHUNK ?? '25', 10) || 25);

/**
 * Set DRY_RUN=1 to parse, verify and report without sending anything. This is
 * how the chunker is tested against the real file — the parse that runs in the
 * dry run is the parse that runs against production, rather than a copy of it
 * in a test that can drift.
 */
const DRY_RUN = process.env.DRY_RUN === '1';

/** Statements are sent one at a time; this is the only way in or out. */
async function run(sql, label) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would send ${label} (${Buffer.byteLength(sql)} bytes)`);
    return label.startsWith('count') ? [{ n: null }] : null;
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`::error title=${label} failed::HTTP ${res.status} — ${text.slice(0, 600)}`);
    throw new Error(`${label}: HTTP ${res.status}`);
  }
  try { return JSON.parse(text); } catch { return text; }
}

const src = readFileSync(FILE, 'utf8');
const lines = src.split('\n');
console.log(`${FILE}: ${(Buffer.byteLength(src) / 1048576).toFixed(2)} MB, ${lines.length} lines`);

// The target table, so the run can report what it changed rather than just
// claiming success.
const target = src.match(/INSERT INTO\s+(public\.[a-z0-9_]+)/i)?.[1] ?? null;
/**
 * A migration may CREATE the table it seeds — the builder_network stock
 * mirror is create-and-seed in one file so a database that still holds the
 * source self-seeds and a post-deletion clone no-ops. `count(*) from X` is
 * parsed before it is executed, so the before-count 42P01'd on exactly that
 * shape (run #50) and the job failed having applied nothing. Existence is
 * its own round trip now; a table this migration is about to create counts
 * as absent, not as an error.
 */
const countRows = async (when) => {
  if (!target) return null;
  const reg = await run(
    `select to_regclass('${target.replace(/'/g, "''")}')::text as reg;`,
    `count (${when}) probe`);
  const exists = (Array.isArray(reg) ? reg[0]?.reg : reg?.[0]?.reg) != null;
  if (!exists) {
    console.log(`${target} rows ${when}: (relation absent)`);
    return null;
  }
  const r = await run(`select count(*)::int as n from ${target};`, `count (${when})`);
  const n = Array.isArray(r) ? r[0]?.n : r?.[0]?.n;
  console.log(`${target} rows ${when}: ${n}`);
  return n;
};

// ---------------------------------------------------------------- parse
const valuesAt = lines.findIndex((l) => l === 'VALUES');
// The ON CONFLICT that TERMINATES the seeded INSERT, which is the first one at
// or after its `VALUES` — not the first one in the file.
//
// v15 was the first release to put a statement of its own above the catalogue
// insert: the seed captures each entry's pre-upsert schema digest with
// `INSERT INTO … template_library_release_baselines … ON CONFLICT (entry_id,
// release) DO NOTHING;`, because the upsert overwrites `schema` in place and
// nothing else retains what it held. Searching the whole file found THAT line
// (66) before `VALUES` (78), so `conflictAt > valuesAt` was false, the file was
// not recognised as the seed shape, and 39.77 MB went as one request — HTTP 413
// with nothing applied (run #66, 19 Sep 2026).
const conflictOffset = valuesAt === -1
  ? -1
  : lines.slice(valuesAt).findIndex((l) => l.startsWith('ON CONFLICT '));
const conflictAt = conflictOffset === -1 ? -1 : valuesAt + conflictOffset;
const isSeedShape = valuesAt !== -1 && conflictAt > valuesAt;
// Overridable so the chunker and its guards can be exercised against a small
// fixture. Files under the threshold are sent whole and never parsed.
const SPLIT_THRESHOLD = parseInt(process.env.SPLIT_THRESHOLD_BYTES ?? '1000000', 10);
const NEEDS_SPLIT = Buffer.byteLength(src) > SPLIT_THRESHOLD;

let statements;

if (!NEEDS_SPLIT || !isSeedShape) {
  if (NEEDS_SPLIT) {
    console.log('Large file, but not the recognised INSERT shape — sending whole.');
  }
  statements = [{ label: 'whole file', sql: src }];
} else {
  // End of the ON CONFLICT statement: the first line at or after it ending in ';'.
  let conflictEnd = conflictAt;
  while (conflictEnd < lines.length && !lines[conflictEnd].trimEnd().endsWith(';')) conflictEnd++;
  if (conflictEnd >= lines.length) throw new Error('unterminated ON CONFLICT clause');

  const header = lines.slice(0, valuesAt + 1).join('\n');       // through `VALUES`
  const onConflict = lines.slice(conflictAt, conflictEnd + 1).join('\n');
  const tail = lines.slice(conflictEnd + 1).join('\n').trim();   // trailing statements
  const region = lines.slice(valuesAt + 1, conflictAt);

  // Tuples start on a line that is exactly '  ('.
  const starts = [];
  region.forEach((l, i) => { if (l === '  (') starts.push(i); });
  if (!starts.length) throw new Error('no tuples found');

  const tuples = starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : region.length;
    const body = region.slice(s, end);
    // Trim blank padding, then drop the tuple's trailing comma so each tuple is
    // self-contained and chunks can be joined independently.
    while (body.length && body[body.length - 1].trim() === '') body.pop();
    const last = body.length - 1;
    if (body[last].trimEnd().endsWith(',')) body[last] = body[last].trimEnd().slice(0, -1);
    return body.join('\n');
  });

  // The check that makes this safe: rebuild the region and demand the original.
  //
  // Anchored at the first tuple rather than trimmed. A plain `.trim()` eats the
  // two leading spaces of the opening `  (` and reports a 2-byte mismatch on a
  // parse that is in fact exact — which is a false alarm that would train
  // whoever sees it to distrust this check.
  const originalRegion = region.slice(starts[0]).join('\n').replace(/\s+$/, '');
  const rebuilt = tuples.join(',\n').replace(/\s+$/, '');
  if (rebuilt !== originalRegion) {
    throw new Error(
      `reassembly mismatch — refusing to send. rebuilt ${rebuilt.length} bytes vs original ${originalRegion.length}`,
    );
  }
  // Reassembly proves the split is lossless. It does NOT prove the split points
  // are tuple boundaries: a line that is exactly '  (' *inside* one of the
  // dollar-quoted JSON schemas would be taken as a new tuple, and rejoining
  // would still reproduce the file byte-for-byte while every chunk around it
  // was invalid SQL. The dollar-quote tags must therefore balance within each
  // tuple — that is what actually establishes the boundary is real.
  for (const [i, t] of tuples.entries()) {
    for (const tag of ['\\$tlt\\$', '\\$tlj\\$']) {
      const n = (t.match(new RegExp(tag, 'g')) ?? []).length;
      if (n % 2 !== 0) {
        throw new Error(
          `tuple ${i + 1} splits inside a ${tag.replace(/\\/g, '')} string (${n} tags) — refusing to send`,
        );
      }
    }
  }
  console.log(
    `Parsed ${tuples.length} tuples; reassembly byte-identical and every dollar-quote balanced.`,
  );

  statements = [];
  for (let i = 0; i < tuples.length; i += PER_CHUNK) {
    const slice = tuples.slice(i, i + PER_CHUNK);
    statements.push({
      label: `rows ${i + 1}-${i + slice.length}`,
      sql: `${header}\n${slice.join(',\n')}\n${onConflict}`,
    });
  }
  if (tail) statements.push({ label: 'trailing statements', sql: tail });

  const mb = (s) => (Buffer.byteLength(s) / 1048576).toFixed(2);
  console.log(
    `${statements.length} statements; largest ${Math.max(...statements.map((s) => +mb(s.sql)))} MB`,
  );
}

// ---------------------------------------------------------------- apply
const before = await countRows('before');

let done = 0;
for (const s of statements) {
  await run(s.sql, s.label);
  done++;
  console.log(`  [${done}/${statements.length}] ${s.label}`);
}

const after = await countRows('after');

// The row, and the proof of it, come from the same module the psql route
// uses (`.github/scripts/record-migration.mjs`), so both routes write the same
// row: the version, the name, and the file itself as the CLI would record it.
// It is sent as its own request after the file, never appended to the file's
// last statement: statements in one request share an implicit transaction,
// and a file using CREATE INDEX CONCURRENTLY cannot run inside one.
let recordLine = '';
if (RECORD_VERSION) {
  if (DRY_RUN) {
    recordLine = 'would record the version, and the body where it can be stored';
    console.log(`  [dry-run] ${recordLine}`);
  } else {
    const result = await recordAppliedMigration({
      path: FILE,
      bytes: readFileSync(FILE),
      q: ledgerQuery({ route: 'api', token: TOKEN, ref: REF }),
    });
    recordLine = result.recorded
      ? `Recorded ${result.version} in schema_migrations${result.bodyStored ? ', with its body' : ` without its body: ${result.reason}`}.`
      : `${result.version} was already recorded; the ledger keeps its first row and nothing was written.`;
    console.log(recordLine);
  }
}

const summary = [
  `### Applied \`${FILE}\``,
  '',
  `- ${statements.length} statement(s)`,
  target ? `- \`${target}\`: ${before ?? 'absent'} → ${after ?? 'absent'} rows` : '',
  recordLine ? `- ${recordLine}` : '',
  '',
].filter(Boolean).join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
