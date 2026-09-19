#!/usr/bin/env node
/**
 * Load the RBA statistical tables into `rba_observations` via the
 * rba-tables-ingest edge function.
 *
 * This script exists because rba.gov.au refuses the Supabase project's
 * egress (Akamai "Access Denied" on every statistical-table CSV, measured
 * from a deployed probe 2026-09-06) — so the download happens HERE, where
 * egress works, and the file's text is POSTed to the function verbatim.
 * ALL parsing, validation and refusal is server-side
 * (`_shared/rbaTables.pure.ts`); this file is I/O only, on purpose — a
 * loader that parsed differently from the reader is the sanctions-register
 * failure mode.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_ANON_KEY=...        (gateway JWT; any valid project JWT works) \
 *   INTERNAL_EDGE_SECRET=...     (required once a table holds rows;
 *                                 a table's very first load may omit it) \
 *     node scripts/rba/load-rba-tables.mjs [--table cash-rate,f1,f1.1,g1,f5] [--file <path>]
 *
 * Options:
 *   --table <codes>   Comma-separated subset (default: all five).
 *   --file <path>     Read ONE table's CSV from a local file instead of
 *                     downloading (pair with a single --table).
 *
 * Exit code is non-zero if ANY table failed, so a scheduler can alert on
 * it. Cadence worth knowing: F1.1 and F5 update monthly, G1 quarterly —
 * and every served figure carries its own reference period, so a missed
 * refresh shows up as an honestly-dated older figure, never as a silently
 * wrong one.
 */
import { readFileSync } from 'node:fs';

const TABLES = {
  // F1 is the DAILY money-market table. It carries the cash rate target ON A
  // DATE (FIRMMCRTD) and the RBA's own announced change in it (FIRMMCCRT) —
  // which is how the report states a current target with an effective date.
  // F1.1's monthly average is a different fact and is kept for trend context.
  'f1': 'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv',
  'f1.1': 'https://www.rba.gov.au/statistics/tables/csv/f1.1-data.csv',
  'g1': 'https://www.rba.gov.au/statistics/tables/csv/g1-data.csv',
  'f5': 'https://www.rba.gov.au/statistics/tables/csv/f5-data.csv',
  // Not a statistical table: the RBA's own Cash Rate Target decision history
  // page. It is the only source that records the Board's UNCHANGED decisions,
  // and therefore the only one that can say when the current target took
  // effect — F1's change column omits holds entirely.
  'cash-rate': 'https://www.rba.gov.au/statistics/cash-rate/',
};

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

const wanted = (argValue('--table') ?? 'cash-rate,f1,f1.1,g1,f5').split(',').map((s) => s.trim()).filter(Boolean);
const localFile = argValue('--file');

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const internalSecret = process.env.INTERNAL_EDGE_SECRET ?? '';
if (!supabaseUrl || !anonKey) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY are required.');
  process.exit(2);
}
if (localFile && wanted.length !== 1) {
  console.error('--file loads exactly one table; pass a single --table with it.');
  process.exit(2);
}
for (const t of wanted) {
  if (!(t in TABLES)) {
    console.error(`unknown table "${t}" — expected cash-rate, f1, f1.1, g1 or f5`);
    process.exit(2);
  }
}

async function fetchCsv(table) {
  if (localFile) return readFileSync(localFile, 'utf-8');
  const res = await fetch(TABLES[table], {
    headers: { Accept: table === 'cash-rate' ? 'text/html,*/*' : 'text/csv,*/*' },
  });
  if (!res.ok) throw new Error(`download answered ${res.status} for ${TABLES[table]}`);
  return await res.text();
}

let failures = 0;
for (const table of wanted) {
  try {
    const csv = await fetchCsv(table);
    console.log(`[${table}] downloaded ${csv.length.toLocaleString()} chars; posting to rba-tables-ingest…`);
    const res = await fetch(`${supabaseUrl}/functions/v1/rba-tables-ingest`, {
      method: 'POST',
      headers: {
        // The gateway wants a project JWT in Authorization; the function
        // itself checks the internal secret from X-Cron-Secret (or its
        // per-table first-load bootstrap arm when the secret is absent).
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        ...(internalSecret ? { 'X-Cron-Secret': internalSecret } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ table, csv }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success !== true) {
      failures++;
      console.error(`[${table}] REFUSED (${res.status}):`, body?.error ?? body);
      continue;
    }
    const series = (body.series ?? [])
      .map((s) => `${s.id} → ${s.last_observation} (${s.observations} obs)`)
      .join('; ');
    console.log(`[${table}] loaded — published ${body.publication_date}; ${series}`);
  } catch (err) {
    failures++;
    console.error(`[${table}] FAILED:`, err instanceof Error ? err.message : err);
  }
}

process.exit(failures === 0 ? 0 : 1);
