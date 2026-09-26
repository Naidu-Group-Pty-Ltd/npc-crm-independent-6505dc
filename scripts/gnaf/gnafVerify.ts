/**
 * The built G-NAF register, checked against itself before anything serves it.
 *
 * The builder counts; this READS. It opens every shard the builder wrote and
 * checks the rows add up to the manifest's figure, checks every postal area
 * the locality index promises is a file that exists, and then asks the
 * matcher the geocoding chain uses (`gnafShard.pure.ts`) for a random sample
 * of the register's own addresses — written out the way a report files an
 * address, planned by the chain's own `planGeocode` — and checks each one
 * comes back at its own point.
 *
 * That last check is the one that matters. The matcher is tested on a
 * handful of rows written by hand; the register is fifteen million rows
 * written by Geoscape, with street names, suffixes, units and ranges nobody
 * writing a fixture thought of. A normalisation that disagrees with the
 * register on one of them turns every address on that kind of street into
 * "no such address" in production, silently. So the sample is drawn from the
 * real release, in CI, and the build fails where the matcher cannot find the
 * register's own addresses.
 *
 * A refusal is not always a failure: an address the register holds twice in
 * one postal area, far apart, SHOULD be refused, and is counted separately.
 * What fails the build is a register address the matcher cannot find, above
 * a small tolerance, or ANY answer at the wrong place.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
  GNAF_SHARD_FORMAT,
  askedAddressOf,
  chooseGnafRow,
  gnafRowStreet,
  gnafStreetLineOf,
  localityLookupOf,
  parseGnafShard,
  type GnafLocalityIndex,
  type GnafRow,
} from '../../supabase/functions/_shared/geocode/gnafShard.pure.ts';
import { planGeocode } from '../../supabase/functions/_shared/geocode/geocodePlan.pure.ts';
import type { AuState } from '../../supabase/functions/_shared/auLocality.pure.ts';

export interface VerifyOptions {
  /** The directory the service serves as `/gnaf` (it holds `v1/`). */
  dir: string;
  sampleShards?: number;
  perShard?: number;
  seed?: number;
}

export type Outcome = 'hit' | 'nearby' | 'ambiguous' | 'not_found' | 'wrong_place';

export interface FormTally {
  asked: number;
  hit: number;
  nearby: number;
  ambiguous: number;
  not_found: number;
  wrong_place: number;
}

export interface VerifyResult {
  release: string | null;
  manifestRows: number | null;
  countedRows: number;
  skippedLines: number;
  shards: number;
  largestShard: { path: string; bytes: number; rows: number } | null;
  indexPostalAreasMissing: string[];
  fields: FormTally;
  text: FormTally;
  misses: Array<{ form: 'fields' | 'text'; ask: string; outcome: Outcome; reason: string }>;
}

/** A small, seeded generator: the same sample on every run of the same release. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A register row written out as a report files an address. */
export function addressOfRow(row: GnafRow): string {
  const street = gnafRowStreet(row);
  const where = row.lot ? `Lot ${row.lot.toUpperCase()}` : row.number.toUpperCase();
  const line = row.flat
    ? (/^\d+[a-z]?$/i.test(row.flat) ? `${row.flat.toUpperCase()}/${where} ${street}` : `Unit ${row.flat.toUpperCase()}, ${where} ${street}`)
    : `${where} ${street}`;
  return `${line}, ${row.locality} ${row.state} ${row.postcode}`;
}

const emptyTally = (): FormTally => ({ asked: 0, hit: 0, nearby: 0, ambiguous: 0, not_found: 0, wrong_place: 0 });

function judge(rows: GnafRow[], row: GnafRow, plan: ReturnType<typeof planGeocode>): { outcome: Outcome; reason: string } {
  if (!plan) return { outcome: 'not_found', reason: 'the chain could not plan the address' };
  if (plan.ask.postcode && plan.ask.postcode !== row.postcode) {
    return { outcome: 'not_found', reason: `the chain read the postcode as ${plan.ask.postcode}` };
  }
  const asked = askedAddressOf(gnafStreetLineOf(plan.ask));
  if (!asked.street || (!asked.number && !asked.lot)) return { outcome: 'not_found', reason: 'the ask names no street number or lot' };
  const choice = chooseGnafRow(rows, asked, plan.localityCandidates);
  if (choice.ok === false) {
    const ambiguous = /more than one place|localities of the postal area/.test(choice.ok ? "no reason" : choice.reason);
    return { outcome: ambiguous ? 'ambiguous' : 'not_found', reason: choice.ok ? "no reason" : choice.reason };
  }
  const d = metres(choice.match.row, row);
  if (d <= 1) return { outcome: 'hit', reason: '' };
  if (d <= 200) return { outcome: 'nearby', reason: `${Math.round(d)} m from the row asked` };
  return { outcome: 'wrong_place', reason: `${Math.round(d)} m away, at ${choice.match.row.pid}` };
}

export function verifyGnafShards(options: VerifyOptions): VerifyResult {
  const root = join(options.dir, `v${GNAF_SHARD_FORMAT}`);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
    format?: number;
    release?: { label?: string };
    counts?: { rows_written?: number };
  };
  if (manifest.format !== GNAF_SHARD_FORMAT) throw new Error(`manifest is format ${manifest.format}, not ${GNAF_SHARD_FORMAT}`);

  // Every shard, read whole: the rows must add up to what the builder says it wrote.
  const shards: Array<{ state: AuState; postcode: string; path: string; bytes: number }> = [];
  for (const state of readdirSync(root)) {
    const stateDir = join(root, state);
    if (!statSync(stateDir).isDirectory()) continue;
    for (const file of readdirSync(stateDir)) {
      const m = /^(\d{4})\.psv\.gz$/.exec(file);
      if (m) shards.push({ state: state as AuState, postcode: m[1], path: join(stateDir, file), bytes: statSync(join(stateDir, file)).size });
    }
  }
  shards.sort((a, b) => (a.path < b.path ? -1 : 1));

  // Which postal areas are asked is chosen BEFORE anything is read, so the
  // register is read one file at a time: holding every row at once is ~13
  // million objects, and a national build measured 4.9 GB doing it — past
  // what a CI runner's Node heap allows.
  const seed = options.seed ?? 20260924;
  const rand = mulberry32(seed);
  const sampleShards = Math.min(options.sampleShards ?? 400, shards.length);
  const perShard = options.perShard ?? 5;
  const pool = shards.map((_, k) => k);
  const sampled = new Set<number>();
  for (let i = 0; i < sampleShards; i++) sampled.add(pool.splice(Math.floor(rand() * pool.length), 1)[0]);

  const present = new Set<string>();
  let countedRows = 0;
  let skippedLines = 0;
  let largest: VerifyResult['largestShard'] = null;
  const fields = emptyTally();
  const text = emptyTally();
  const misses: VerifyResult['misses'] = [];
  for (const [idx, s] of shards.entries()) {
    const parsed = parseGnafShard(gunzipSync(readFileSync(s.path)).toString('utf8'), s.state, s.postcode);
    if (!parsed) throw new Error(`${s.path} is not shard format ${GNAF_SHARD_FORMAT}`);
    countedRows += parsed.rows.length;
    skippedLines += parsed.skipped;
    present.add(`${s.state}/${s.postcode}`);
    if (!largest || s.bytes > largest.bytes) largest = { path: s.path.slice(options.dir.length + 1), bytes: s.bytes, rows: parsed.rows.length };
    if (!sampled.has(idx)) continue;

    // The register's own addresses, asked the way a report asks. Distinct
    // rows, drawn by a partial shuffle (an address asked twice is one
    // measurement counted twice), from a generator seeded by the file's place
    // in the register, so the sample does not depend on the order files are read.
    const rows = parsed.rows;
    const draw = mulberry32((seed ^ Math.imul(idx + 1, 0x9e3779b1)) >>> 0);
    const order = rows.map((_, k) => k);
    const take = Math.min(perShard, rows.length);
    for (let k = 0; k < take; k++) {
      const swap = k + Math.floor(draw() * (order.length - k));
      [order[k], order[swap]] = [order[swap], order[k]];
    }
    for (let j = 0; j < take; j++) {
      const row = rows[order[j]];
      const address = addressOfRow(row);
      for (const [form, tally, plan] of [
        ['fields', fields, planGeocode({ address, suburb: row.locality, state: row.state, postcode: row.postcode })],
        ['text', text, planGeocode({ address })],
      ] as const) {
        const { outcome, reason } = judge(rows, row, plan);
        tally.asked++;
        tally[outcome]++;
        if (outcome !== 'hit' && outcome !== 'nearby' && misses.length < 60) misses.push({ form, ask: address, outcome, reason });
      }
    }
  }

  // Every postal area the index promises must be a file.
  const index = JSON.parse(gunzipSync(readFileSync(join(root, 'localities.json.gz'))).toString('utf8')) as GnafLocalityIndex;
  const lookup = localityLookupOf(index);
  const missing = new Set<string>();
  for (const [key, postcodes] of lookup) {
    const state = key.split('|')[0];
    for (const p of postcodes) if (!present.has(`${state}/${p}`)) missing.add(`${state}/${p}`);
  }

  return {
    release: manifest.release?.label ?? null,
    manifestRows: typeof manifest.counts?.rows_written === 'number' ? manifest.counts.rows_written : null,
    countedRows,
    skippedLines,
    shards: shards.length,
    largestShard: largest,
    indexPostalAreasMissing: [...missing].sort(),
    fields,
    text,
    misses,
  };
}

/** Why the register may not be served, or an empty list where it may. */
export function verificationRefusals(result: VerifyResult, maxNotFound = 0.02): string[] {
  const out: string[] = [];
  if (result.manifestRows !== result.countedRows) {
    out.push(`the shards hold ${result.countedRows} rows and the manifest says ${result.manifestRows}`);
  }
  if (result.skippedLines > 0) out.push(`${result.skippedLines} shard line(s) did not have the shape the header promised`);
  if (result.indexPostalAreasMissing.length > 0) {
    out.push(`the locality index names ${result.indexPostalAreasMissing.length} postal area(s) with no file: ${result.indexPostalAreasMissing.slice(0, 10).join(', ')}`);
  }
  for (const [form, tally] of [['fields', result.fields], ['text', result.text]] as const) {
    if (tally.wrong_place > 0) out.push(`${tally.wrong_place} sampled address(es) (${form}) came back at the WRONG place`);
  }
  // The structured form is how the chain's callers ask; the free-text form
  // depends on parsing the whole line, and is reported rather than gated.
  if (result.fields.asked > 0 && result.fields.not_found / result.fields.asked > maxNotFound) {
    out.push(`${result.fields.not_found} of ${result.fields.asked} sampled register addresses (${(100 * result.fields.not_found / result.fields.asked).toFixed(1)}%) were not found by the matcher — above ${(100 * maxNotFound).toFixed(1)}%`);
  }
  return out;
}

export function verificationMarkdown(result: VerifyResult, refusals: string[]): string {
  const pct = (n: number, d: number) => (d ? `${(100 * n / d).toFixed(2)}%` : '—');
  const row = (name: string, t: FormTally) =>
    `| ${name} | ${t.asked} | ${pct(t.hit + t.nearby, t.asked)} | ${t.ambiguous} | ${t.not_found} | ${t.wrong_place} |`;
  return [
    '### G-NAF register checked against itself',
    '',
    `- release: **${result.release ?? 'unnamed'}**; ${result.shards.toLocaleString()} postal areas; ${result.countedRows.toLocaleString()} rows read (manifest: ${result.manifestRows?.toLocaleString() ?? 'none'})`,
    `- largest postal area: \`${result.largestShard?.path}\`, ${result.largestShard?.bytes.toLocaleString()} bytes, ${result.largestShard?.rows.toLocaleString()} rows`,
    '',
    '| Asked as | Sampled | Found at its own point | Refused as ambiguous | Not found | Wrong place |',
    '|---|---:|---:|---:|---:|---:|',
    row('street, suburb, state, postcode', result.fields),
    row('one line of text', result.text),
    '',
    refusals.length ? `**REFUSED:**\n\n${refusals.map((r) => `- ${r}`).join('\n')}` : '**Verdict:** the matcher finds the register\'s own addresses.',
    '',
    ...(result.misses.length
      ? ['<details><summary>First misses</summary>', '', ...result.misses.slice(0, 30).map((m) => `- (${m.form}, ${m.outcome}) \`${m.ask}\` — ${m.reason}`), '', '</details>', '']
      : []),
  ].join('\n');
}
