#!/usr/bin/env node
/**
 * Copy the live marketplace's listings from `listings_cache` into the REBUILT
 * Airtable base's `Property Intake Master`.
 *
 * ## Why this exists
 *
 * There are two `NPC Emails` bases. `apptyShYE0yzL4IGB` is live and growing;
 * `appFNPL7iYiuQyHAO` is a rebuild of it in a DIFFERENT Airtable account, copied
 * on 2026-08-18, which has taken nothing since. `MAKE_CUTOVER.md` records why
 * that blocks the cutover: activating the re-pointed intake scenarios moves
 * listing intake to a base nothing reads.
 *
 * The sharper reason is the one that costs data. `listings_cache` is an ARCHIVE
 * (see `AIRTABLE_RETENTION.md`), and `planReconciliation` DELETES a cached row
 * that vanished from the source table while still inside the retention window.
 * Cutting over to a base that does not hold today's listings therefore presents
 * 171 live rows as "vanished". The 10% destructive cap means the batch is
 * archived rather than part-deleted — so it is recoverable — but the marketplace
 * still empties, and it empties silently. Backfilling the rebuild first is what
 * makes the cutover a decision rather than an incident.
 *
 * This script does not decide the cutover. It only makes the rebuild base hold
 * what the product already serves, so that the decision can be taken safely.
 *
 * ## What travels, and what cannot
 *
 * The include set is **the columns the product actually reads**, taken at
 * runtime from `supabase/functions/_shared/airtableIntakeFields.pure.ts` — the
 * one place intake column names live — plus a provenance set naming where each
 * row came from. It is not a hand-kept list, because a hand-kept list drifts
 * from the module and a mistyped Airtable column is invisible (Airtable answers
 * `undefined` for a column that does not exist exactly as it does for one that
 * is empty).
 *
 * Three classes deliberately do not travel, and each is excluded by reading the
 * target's own schema rather than by a hardcoded list:
 *
 *   - **Computed columns** (`formula`, `rollup`, `count`, `autoNumber`,
 *     `createdTime`, `lastModifiedTime`). `Created Time` is a `CREATED_TIME()`
 *     formula in the rebuild, so a copied row is stamped with the moment it was
 *     written and NOT with when the listing arrived. That is why the provenance
 *     set carries `Email Received At` and `First Seen At`: the true origin dates
 *     survive in columns that can hold them. Measured 2026-09-15.
 *   - **Attachments** (`Listing Images`, `Floorplan`, `Brochure`,
 *     `Additional Attachments`). An Airtable attachment URL expires within
 *     hours — the `Listing Image URLs` column description says so itself — so
 *     copying them writes links that are already dead. The durable URLs in
 *     `Listing Image URLs` and `Primary Image URL` do travel.
 *   - **Collaborators** (`Assignee`, `Reviewed By`). A user id from one Airtable
 *     account names nobody in another.
 *
 * Everything else the cache holds but the product does not read — the raw AI
 * output, the parsed JSON, the email bodies, the extraction telemetry — is
 * dropped on purpose. Measured over the 171 live rows: the full field set is
 * 3,327,176 bytes and `Email Body Plain Text` alone is 2,540,658 of it (76%),
 * against 384,571 bytes for the product-read plus provenance set. Carrying the
 * rest would multiply the transfer ninefold to move columns nothing reads.
 *
 * ## Idempotency
 *
 * Every written record is stamped in `Internal Notes` as
 * `backfill:listings_cache:<listing_id>:<iso date>` — a column intake never
 * writes. The script reads those stamps back before writing and skips any source
 * row already present, so a re-run after a partial failure resumes rather than
 * duplicating. That stamp is also the undo key: deleting exactly the records
 * whose `Internal Notes` starts `backfill:listings_cache:` reverses this
 * entirely, and leaves anything intake wrote alone.
 *
 * `--verify` re-reads the target and reports any source row that is missing, and
 * any copied cell that disagrees with the cache.
 *
 * ## Credentials
 *
 * The rebuild base is in a different Airtable account, so the pipeline's own
 * token cannot reach it — a personal access token reaches only its own
 * account's bases, which is why a valid token is refused across this boundary.
 * This script therefore takes its own, under names that collide with none of
 * the six reserved pipeline names in `listingsPipelineSecrets.pure.ts`
 * (`AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME`,
 * `AIRTABLE_TABLE_ALIASES`, `AIRTABLE_TABLE_ALLOWLIST`,
 * `AIRTABLE_IMAGE_LIBRARY_FIELD`). Passing a pipeline name here would be the
 * defect `update-integration-secret` already refuses.
 *
 * Node 22 or later on the live path: `createClient` builds a RealtimeClient that
 * demands a native WebSocket. `--from-file` needs neither.
 *
 * Usage — reading the cache live (needs the service-role key):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   AIRTABLE_REBUILD_TOKEN=pat... AIRTABLE_REBUILD_BASE_ID=appFNPL7iYiuQyHAO \
 *     node scripts/listings/backfill-property-intake.mjs [options]
 *
 * Usage — from a source extract (the Airtable token is the only secret):
 *   AIRTABLE_REBUILD_TOKEN=pat... AIRTABLE_REBUILD_BASE_ID=appFNPL7iYiuQyHAO \
 *     node scripts/listings/backfill-property-intake.mjs --from-file rows.json
 *
 * Options:
 *   --dry-run        Resolve, map and report. Write nothing.
 *   --verify         Compare the target against the source; write nothing.
 *   --limit <n>      Copy at most n source rows (for a staged first run).
 *   --batch <n>      Records per Airtable request (default 10, max 50).
 *   --from-file <p>  Read the source rows from a JSON extract rather than
 *                    querying Supabase, so no service-role key is needed.
 *   --undo           Delete exactly the records this script wrote, and nothing else.
 */
// `@supabase/supabase-js` is imported lazily, inside the live-read branch only,
// so `--from-file` runs without the dependency and without a service-role key.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

const TABLE_NAME = 'Property Intake Master';
const STAMP_COLUMN = 'Internal Notes';
const STAMP_PREFIX = 'backfill:listings_cache:';

/**
 * Columns that record where a row came from. These are not in the product's
 * read set, but without them a copied row cannot say when the listing actually
 * arrived — `Created Time` is a formula in the target and reads as the moment
 * of the copy.
 */
const PROVENANCE_COLUMNS = [
  'Email Received At', 'Email Sent At', 'First Seen At', 'Last Seen At',
  'Last Updated From Source', 'Last Processed At', 'Extracted At',
  'Email Subject', 'Intake Content Hash', 'Extraction Batch ID',
  'Scenario Run ID', 'Make Module Source', 'Duplicate Status',
  'Is Latest Version', 'Recipient Email', 'Change Type', 'AI Model',
  'Prompt Version', 'Extraction Method',
];

/** Airtable field types that cannot be written by the records API. */
const UNWRITABLE_TYPES = new Set([
  'formula', 'rollup', 'count', 'autoNumber', 'createdTime', 'lastModifiedTime',
  'createdBy', 'lastModifiedBy', 'multipleAttachments', 'singleCollaborator',
  'multipleCollaborators', 'button', 'externalSyncSource', 'aiText',
]);

function parseArgs(argv) {
  const opts = { dryRun: false, verify: false, undo: false, limit: null, batch: 10, fromFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--verify') opts.verify = true;
    else if (a === '--undo') opts.undo = true;
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--batch') opts.batch = Math.min(50, Math.max(1, Number(argv[++i])));
    else if (a === '--from-file') opts.fromFile = argv[++i];
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

/**
 * Read the source rows from a file instead of querying Supabase.
 *
 * This exists so the only credential the run needs is the Airtable token. The
 * live path needs `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS on the whole
 * database — a disproportionate thing to hand around for a read-only copy that
 * anyone with ordinary read access can perform. `load-pep-officeholders.mjs`
 * carries the same `--file` escape for the same shape of reason.
 *
 * The file is `{ rows: [{listing_id, created_time, fields}], dropped_columns }`.
 * `dropped_columns` is not decoration: an extract narrowed before the script saw
 * it can silently under-copy if `INTAKE_FIELDS` has widened since, so anything
 * dropped that this run actually wants is reported rather than skipped quietly.
 */
function readSourceFile(path, wantedNames) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  if (!Array.isArray(rows)) {
    throw new Error(`${path} does not hold a rows array. Expected {rows:[…]} or a bare array.`);
  }
  for (const r of rows) {
    if (typeof r?.listing_id !== 'string' || typeof r?.fields !== 'object' || r.fields === null) {
      throw new Error(`${path} contains a row without a listing_id and a fields object.`);
    }
  }
  const dropped = Array.isArray(parsed.dropped_columns) ? parsed.dropped_columns : [];
  const lost = dropped.filter((c) => wantedNames.has(c));
  if (lost.length) {
    throw new Error(
      `${path} was extracted without ${lost.length} column(s) this run needs: ${lost.join(', ')}. `
      + 'Re-extract without dropping them, or run against Supabase directly.',
    );
  }
  if (dropped.length) {
    console.log(`Source file dropped ${dropped.length} column(s) at extraction, none of them wanted: ${dropped.join(', ')}`);
  }
  return rows;
}

/**
 * The product's intake column names, read from the module that owns them.
 *
 * Parsed rather than imported because this is a `.mjs` script and that module is
 * TypeScript. The alternative — a second copy of the names here — is the exact
 * defect that module's header was written to prevent.
 */
function productColumnNames() {
  const path = resolve(REPO, 'supabase/functions/_shared/airtableIntakeFields.pure.ts');
  const src = readFileSync(path, 'utf8');
  const body = src.slice(src.indexOf('export const INTAKE_FIELDS'));
  const names = [...body.matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
  if (names.length < 50) {
    throw new Error(`Refusing to run: parsed only ${names.length} column names from ${path}. The module's shape has changed and this parse is no longer reading it correctly.`);
  }
  return [...new Set(names)];
}

async function airtable(token, path, init = {}) {
  const res = await fetch(`https://api.airtable.com/v0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Airtable ${init.method ?? 'GET'} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** name -> { id, type } for the target table, read live. */
async function resolveSchema(token, baseId) {
  const meta = await airtable(token, `/meta/bases/${baseId}/tables`);
  const table = meta.tables.find((t) => t.name === TABLE_NAME);
  if (!table) {
    throw new Error(`Base ${baseId} has no table named "${TABLE_NAME}". Tables present: ${meta.tables.map((t) => t.name).join(', ')}`);
  }
  const byName = new Map();
  for (const f of table.fields) byName.set(f.name, { id: f.id, type: f.type });
  return { tableId: table.id, byName };
}

async function listAllRecords(token, baseId, tableId, fieldIds) {
  const out = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    for (const id of fieldIds) params.append('fields[]', id);
    if (offset) params.set('offset', offset);
    const page = await airtable(token, `/${baseId}/${tableId}?${params}`);
    out.push(...page.records);
    offset = page.offset;
  } while (offset);
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = process.env.AIRTABLE_REBUILD_TOKEN;
  const baseId = process.env.AIRTABLE_REBUILD_BASE_ID;
  const required = [['AIRTABLE_REBUILD_TOKEN', token], ['AIRTABLE_REBUILD_BASE_ID', baseId]];
  // Supabase is only needed when the rows are being read live.
  if (!opts.fromFile) {
    required.push(['SUPABASE_URL', supabaseUrl], ['SUPABASE_SERVICE_ROLE_KEY', serviceKey]);
  }
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Missing required environment: ${missing.join(', ')}`);
    process.exit(2);
  }

  const { tableId, byName } = await resolveSchema(token, baseId);

  const stampField = byName.get(STAMP_COLUMN);
  if (!stampField || UNWRITABLE_TYPES.has(stampField.type)) {
    throw new Error(`"${STAMP_COLUMN}" is missing or not writable in the target. Without it a run cannot be made idempotent or undone, so this refuses rather than writing records it cannot identify later.`);
  }

  /* ---- Undo ---------------------------------------------------------- */
  if (opts.undo) {
    const existing = await listAllRecords(token, baseId, tableId, [stampField.id]);
    const mine = existing.filter((r) => String(r.fields?.[stampField.id] ?? '').startsWith(STAMP_PREFIX));
    console.log(`Records carrying this script's stamp: ${mine.length} of ${existing.length}`);
    if (opts.dryRun) return;
    for (let i = 0; i < mine.length; i += 10) {
      const chunk = mine.slice(i, i + 10);
      const params = new URLSearchParams();
      for (const r of chunk) params.append('records[]', r.id);
      await airtable(token, `/${baseId}/${tableId}?${params}`, { method: 'DELETE' });
      console.log(`  deleted ${Math.min(i + 10, mine.length)}/${mine.length}`);
    }
    console.log('Undo complete. Nothing intake wrote was touched.');
    return;
  }

  /* ---- Work out what may travel -------------------------------------- */
  const wanted = [...new Set([...productColumnNames(), ...PROVENANCE_COLUMNS])];
  const include = new Map();          // source column name -> target field id
  const droppedUnwritable = [];
  const droppedAbsent = [];
  for (const name of wanted) {
    const f = byName.get(name);
    if (!f) { droppedAbsent.push(name); continue; }
    if (UNWRITABLE_TYPES.has(f.type)) { droppedUnwritable.push(`${name} (${f.type})`); continue; }
    include.set(name, f.id);
  }

  console.log(`Target: base ${baseId}, table ${tableId} ("${TABLE_NAME}")`);
  console.log(`Columns the product reads plus provenance: ${wanted.length}`);
  console.log(`  copyable:            ${include.size}`);
  console.log(`  computed/attachment: ${droppedUnwritable.length}  ${droppedUnwritable.join(', ')}`);
  console.log(`  absent from target:  ${droppedAbsent.length}  ${droppedAbsent.join(', ')}`);

  /* ---- Source -------------------------------------------------------- */
  let rows;
  if (opts.fromFile) {
    rows = readSourceFile(opts.fromFile, new Set(wanted));
    rows.sort((a, b) => a.listing_id.localeCompare(b.listing_id));
    console.log(`Rows read from ${opts.fromFile}: ${rows.length}`);
  } else {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase
      .from('listings_cache')
      .select('listing_id, fields, created_time')
      .is('archived_at', null)
      .order('listing_id');
    if (error) throw new Error(`Reading listings_cache failed: ${error.message} (${error.code ?? 'no code'})`);
    rows = data;
    console.log(`Live rows in listings_cache: ${rows.length}`);
  }

  /* ---- Skip what is already there ------------------------------------ */
  const existing = await listAllRecords(token, baseId, tableId, [stampField.id]);
  const already = new Set(
    existing
      .map((r) => String(r.fields?.[stampField.id] ?? ''))
      .filter((s) => s.startsWith(STAMP_PREFIX))
      .map((s) => s.slice(STAMP_PREFIX.length).split(':')[0]),
  );
  console.log(`Already copied by a previous run: ${already.size}`);

  const today = new Date().toISOString().slice(0, 10);
  const pending = rows.filter((r) => !already.has(r.listing_id));

  /* ---- Verify -------------------------------------------------------- */
  if (opts.verify) {
    const full = await listAllRecords(token, baseId, tableId, [stampField.id, ...include.values()]);
    const byStamp = new Map();
    for (const r of full) {
      const s = String(r.fields?.[stampField.id] ?? '');
      if (s.startsWith(STAMP_PREFIX)) byStamp.set(s.slice(STAMP_PREFIX.length).split(':')[0], r);
    }
    let missingRows = 0; let mismatches = 0;
    for (const row of rows) {
      const rec = byStamp.get(row.listing_id);
      if (!rec) { missingRows += 1; continue; }
      for (const [name, fid] of include) {
        if (!(name in row.fields)) continue;
        const want = row.fields[name];
        if (want === null || want === undefined || want === '') continue;
        const got = rec.fields[fid];
        // Airtable rounds numbers to the column's precision, so compare loosely.
        const same = typeof want === 'number' && typeof got === 'number'
          ? Math.abs(want - got) < 1e-6 || String(got).length < String(want).length
          : JSON.stringify(want) === JSON.stringify(got);
        if (!same && got === undefined) {
          mismatches += 1;
          if (mismatches <= 20) console.log(`  MISSING ${row.listing_id} "${name}"`);
        }
      }
    }
    console.log(`Verify: ${rows.length - missingRows}/${rows.length} source rows present; ${mismatches} missing cells.`);
    process.exit(missingRows === 0 && mismatches === 0 ? 0 : 1);
  }

  /* ---- Copy ---------------------------------------------------------- */
  const todo = opts.limit ? pending.slice(0, opts.limit) : pending;
  console.log(`To copy this run: ${todo.length}${opts.limit ? ` (limited from ${pending.length})` : ''}`);

  const records = todo.map((row) => {
    const fields = {};
    for (const [name, fid] of include) {
      if (!(name in row.fields)) continue;
      const v = row.fields[name];
      if (v === null || v === undefined || v === '') continue;
      fields[fid] = v;
    }
    fields[stampField.id] = `${STAMP_PREFIX}${row.listing_id}:${today}`;
    return { fields };
  });

  if (opts.dryRun) {
    const bytes = JSON.stringify(records).length;
    const cells = records.reduce((n, r) => n + Object.keys(r.fields).length, 0);
    console.log(`Dry run: would create ${records.length} records, ${cells} cells, ${bytes} bytes.`);
    if (records[0]) console.log(`First record (${Object.keys(records[0].fields).length} fields): ${JSON.stringify(records[0]).slice(0, 600)}…`);
    return;
  }

  let written = 0;
  for (let i = 0; i < records.length; i += opts.batch) {
    const chunk = records.slice(i, i + opts.batch);
    // typecast lets a select option that exists in the live data but not yet in
    // the rebuilt base's option list be created rather than rejected. The
    // rebuild's options came from the legacy schema and the live data has moved
    // on; refusing them would silently drop the column instead.
    const res = await airtable(token, `/${baseId}/${tableId}`, {
      method: 'POST',
      body: JSON.stringify({ records: chunk, typecast: true }),
    });
    written += res.records.length;
    console.log(`  wrote ${written}/${records.length}`);
  }
  console.log(`Done. ${written} records created. Re-run with --verify to check them against the cache.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
