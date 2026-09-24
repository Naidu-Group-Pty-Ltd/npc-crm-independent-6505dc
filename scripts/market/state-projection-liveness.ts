/**
 * What does each state and territory publish as its OWN population
 * projection — in what form, at what grain, and what is in the file?
 *
 * ## Why this exists
 *
 * Forward demand at a property's own area is a per-jurisdiction register:
 * the ABS projects no finer than capital city or rest of state
 * (`FORWARD_DEMAND_EVIDENCE.md`, measured 22 Sep 2026). Loading one needs a
 * table and an ingest stage, and a parser written against a file nobody here
 * has seen is a parser written against a guess — the ABS probe's first run
 * found three premises wrong in one sitting. So this asks first, and prints
 * what each publisher's file actually holds: sheet names, header rows and the
 * first rows of data. That output is what the loader is written against.
 *
 * It writes nothing anywhere: no database, no Supabase, no credential, no
 * table, no row.
 *
 * ## Three routes, because they fail differently
 *
 *   1. the jurisdiction's own open-data catalogue (CKAN, or Socrata for the
 *      ACT);
 *   2. the Commonwealth harvest, attributed by the publisher's own full name;
 *   3. the publisher's own product page (`FORWARD_DEMAND_PUBLISHERS.url`),
 *      where every one of them actually puts the workbooks.
 *
 * ## Third pass: the loader, run dry
 *
 * Once a parser exists, describing a file is no longer the question — whether
 * THE PARSER reads it is. So the run opens by fetching every file in
 * `PROJECTION_FILES` the way the loader does (the publisher, then the
 * archive's newest capture that loads), running the loader's own
 * `readXlsxSheets` → `parseProjectionFile` → `guardProjectionRows` over it,
 * and printing what it WOULD write: the edition, the series, the base, the
 * horizon, the areas, every declined row and a few areas' figures. It writes
 * nothing. What it proves about a file is what production would write,
 * because it is the same code.
 *
 * Then the questions the load still owes an answer to: the licence each
 * publisher states, what Queensland's workbooks and product page say, what
 * the Northern Territory's 2024 edition holds and under what terms, the ACT's
 * own description of its base year and where its current edition is, and
 * whether South Australia's newer edition is in the archive.
 *
 * ## The exit code
 *
 * `abs-register-liveness`' rule. A publisher that does not answer, 404s, or
 * serves something that is not the file its link names: **0** — a build must
 * not be decided by another party's uptime, and a typed root that is wrong
 * is a gap this output names. A catalogue that answers JSON this reader
 * cannot read: **1** — the one failure a fixture can never catch.
 */
import { gunzipSync, inflateRawSync } from 'node:zlib';
import * as XLSX from 'xlsx';
import { FORWARD_DEMAND_PUBLISHERS } from '../../supabase/functions/_shared/reports/market/openData/forwardDemand.pure.ts';
import {
  DESCRIBE_MAX_BYTES,
  POPULATION_PROJECTION_TITLE,
  PROJECTION_CATALOGUES,
  PROJECTION_HARVEST_ROOT,
  PROJECTION_QUERIES,
  PROJECTION_STATES,
  isOwnPopulationProjection,
  ownCatalogueDataset,
  parseProjectionCatalogue,
  projectionFileLinks,
  projectionInventoryUrl,
  projectionSearchUrl,
  projectionSubPages,
  rankOwnProjections,
  rankProjectionLinks,
  rankProjectionResources,
  type ProjectionCatalogue,
  type ProjectionJudgement,
  type ProjectionLink,
  type ProjectionState,
} from '../../supabase/functions/_shared/reports/market/openData/stateProjectionPublishers.pure.ts';
import {
  cdxUrl,
  originalBytesUrl,
  parseCdxJson,
  type WaybackCapture,
} from '../../supabase/functions/_shared/reports/market/openData/waybackMirror.pure.ts';
import {
  mergeVolumeReads,
  type VolumeCatalogueParse,
  type VolumeDataset,
} from '../../supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure.ts';
import { readZipDirectoryFromTail, memberDataStart, ZIP_TAIL_BYTES } from '../../supabase/functions/_shared/gtfsFeed.pure.ts';
import { PROJECTION_FILES, parseProjectionFile, type ProjectionFile } from '../../supabase/functions/_shared/reports/market/openData/stateProjectionFiles.pure.ts';
import { guardProjectionRows } from '../../supabase/functions/_shared/reports/market/openData/projectionLoad.pure.ts';
import { readXlsxSheets, cellText, readMember, sheetMembers, unescapeXml, xlsxMembers, type Grid } from '../../supabase/functions/_shared/reports/market/openData/xlsxSheet.pure.ts';

const FETCH_MS = 30_000;
const DOWNLOAD_MS = 90_000;
/**
 * The probe's own wall-clock budget. It shares a job with six other probes
 * under one timeout, and a job killed by its timeout reports red for a reason
 * that is ours while the probes after it never run. So the budget is spent
 * deliberately: past it, nothing more is fetched, and what was not described
 * is NAMED as not described rather than left to look like an absence.
 */
const BUDGET_MS = 11 * 60_000;
const startedAt = Date.now();
const budgetLeft = () => BUDGET_MS - (Date.now() - startedAt);
const skippedForBudget: string[] = [];
const UA = 'npc-property-dashboard/state-projection-liveness (+forward demand coverage probe)';

const h = (s: string) => { console.log(`\n${s}`); console.log('─'.repeat(Math.min(s.length, 100))); };
const kv = (k: string, v: unknown) => console.log(`  ${k.padEnd(30)} ${String(v)}`);

function ours(what: string, detail: unknown): never {
  h('A PUBLISHER ANSWERED AND THIS REPOSITORY COULD NOT READ IT');
  kv('stage', what);
  kv('detail', detail);
  process.exit(1);
}

interface Fetched { status: number; body: string; ms: number; networkError: string | null; contentType: string | null }

/**
 * The archive's index sheds load under concurrent asks, and it answered 503 to
 * every question the 23 Sep 2026 run put to it — which hid the Northern
 * Territory's 2024 edition and South Australia's newer one behind a busy
 * signal rather than an answer. A 503, 504 or 429 from the index is asked
 * again, twice, after a pause; anything else is the answer.
 */
async function ask(url: string, accept = 'application/json'): Promise<Fetched> {
  let got = await askOnce(url, accept);
  if (!/^https:\/\/web\.archive\.org\/cdx\//.test(url)) return got;
  // A shed load answers 429/503/504; a dropped connection answers nothing at
  // all — the 23 Sep run lost South Australia's archive question to a bare
  // "fetch failed", which is the same congestion by another route.
  for (let attempt = 1; attempt <= 2 && (got.networkError !== null || [429, 503, 504].includes(got.status)); attempt += 1) {
    await new Promise((r) => setTimeout(r, 5_000 * attempt));
    got = await askOnce(url, accept);
  }
  return got;
}

async function askOnce(url: string, accept: string): Promise<Fetched> {
  const began = Date.now();
  try {
    const res = await fetch(url, {
      headers: { accept, 'user-agent': UA },
      signal: AbortSignal.timeout(FETCH_MS),
      redirect: 'follow',
    });
    const body = await res.text();
    return { status: res.status, body, ms: Date.now() - began, networkError: null, contentType: res.headers.get('content-type') };
  } catch (err) {
    return { status: 0, body: '', ms: Date.now() - began, networkError: err instanceof Error ? err.message : String(err), contentType: null };
  }
}

interface Downloaded { bytes: Uint8Array | null; status: number; type: string | null; note: string; finalUrl: string | null }

/** A file, whole, or a statement of why not. Capped so a description never downloads an archive nobody asked for. */
async function download(url: string): Promise<Downloaded> {
  const got = await downloadRaw(url);
  // An empty 200 is not a file. The first run described two of them as
  // "0 bytes · text/html" and moved on; it is a refusal by another name.
  if (got.bytes !== null && got.bytes.length === 0) return { ...got, bytes: null, note: `HTTP ${got.status} with an EMPTY body` };
  return got;
}

async function downloadRaw(url: string): Promise<Downloaded> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(DOWNLOAD_MS), redirect: 'follow' });
    const type = res.headers.get('content-type');
    const declared = Number(res.headers.get('content-length') ?? NaN);
    const finalUrl = res.url || null;
    if (!res.ok) {
      const head = (await res.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ');
      return { bytes: null, status: res.status, type, note: `HTTP ${res.status}${head ? ` ${JSON.stringify(head)}` : ''}`, finalUrl };
    }
    if (Number.isFinite(declared) && declared > DESCRIBE_MAX_BYTES) {
      await res.body?.cancel();
      return { bytes: null, status: res.status, type, note: `declares ${declared.toLocaleString('en-AU')} bytes, past the ${DESCRIBE_MAX_BYTES.toLocaleString('en-AU')} a description needs`, finalUrl };
    }
    const reader = res.body?.getReader();
    if (!reader) return { bytes: null, status: res.status, type, note: 'no body', finalUrl };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > DESCRIBE_MAX_BYTES) {
        await reader.cancel();
        return { bytes: null, status: res.status, type, note: `past ${DESCRIBE_MAX_BYTES.toLocaleString('en-AU')} bytes without ending`, finalUrl };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { bytes.set(c, o); o += c.length; }
    return { bytes, status: res.status, type, note: `${total.toLocaleString('en-AU')} bytes`, finalUrl };
  } catch (err) {
    return { bytes: null, status: 0, type: null, note: `network: ${err instanceof Error ? err.message : String(err)}`, finalUrl: null };
  }
}

/**
 * The archive's newest 200 capture of a URL, or why there is none.
 *
 * Asked for EVERY file described, not only a refused one: the loader runs
 * from the production egress, which is not CI's — `data.sa.gov.au` answers
 * production a plain 403 while it answers CI (`waybackMirror.pure.ts`). A
 * file CI can read and production cannot is read through the archive there,
 * so whether the archive holds it is part of what a loader is written
 * against.
 */
async function archiveCapture(url: string): Promise<{ capture: WaybackCapture | null; note: string }> {
  const got = await ask(cdxUrl({ urlPattern: url, limit: 200 }), 'application/json');
  if (got.networkError !== null) return { capture: null, note: `archive index: network: ${got.networkError}` };
  if (got.status !== 200) return { capture: null, note: `archive index: HTTP ${got.status}` };
  let captures: WaybackCapture[];
  try {
    captures = parseCdxJson(got.body);
  } catch (err) {
    return { capture: null, note: `archive index unreadable — ${err instanceof Error ? err.message : String(err)}` };
  }
  if (captures.length === 0) return { capture: null, note: 'archive holds no 200 capture of it' };
  const newest = [...captures].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  return { capture: newest, note: `archive holds ${captures.length} capture(s), newest ${newest.timestamp} (${newest.mimetype}${newest.length !== null ? `, ${newest.length.toLocaleString('en-AU')} bytes` : ''})` };
}

const looksLikeHtml = (bytes: Uint8Array) => new TextDecoder().decode(bytes.subarray(0, 300)).trimStart().startsWith('<');

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
};

const SHEETS_DESCRIBED = 10;
const HEAD_ROWS = 30;
const TAIL_ROWS = 4;
const CELLS_PER_ROW = 18;

function printRow(n: number, row: unknown[]): void {
  const cells = row.slice(0, CELLS_PER_ROW).map(cell);
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  if (cells.length === 0) return;
  console.log(`        ${String(n).padStart(5)}  ${cells.join(' ¦ ')}${row.length > CELLS_PER_ROW ? ` ¦ …(${row.length} cells)` : ''}`);
}

/**
 * What a workbook holds, in the detail a parser is written against: every
 * sheet's name and extent, the first thirty rows and the last four of each,
 * with the ROW NUMBERS — the first run read forty rows of four sheets and
 * could not show where a header row sits or where the footnotes start.
 */
function describeWorkbook(bytes: Uint8Array): void {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'array', cellDates: false });
  } catch (err) {
    console.log(`      not readable as a workbook — ${err instanceof Error ? err.message : String(err)}`);
    console.log(`      first bytes ${JSON.stringify(new TextDecoder().decode(bytes.subarray(0, 80)))}`);
    return;
  }
  console.log(`      sheets (${wb.SheetNames.length}): ${wb.SheetNames.join(' | ')}`);
  const scored = wb.SheetNames.map((name, i) => ({
    name, i,
    score: (/SA2|LGA|local government|suburb|district|region|SA3|SA4/i.test(name) ? 2 : 0) + (/pop|proj|persons|total/i.test(name) ? 1 : 0)
      - (/note|content|explan|about|info|cover|metadata|glossary/i.test(name) ? 2 : 0),
  })).sort((a, b) => b.score - a.score || a.i - b.i);
  for (const { name } of scored.slice(0, SHEETS_DESCRIBED)) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: '' }) as unknown[][];
    console.log(`\n      sheet "${name}"  ref ${ws['!ref'] ?? '(empty)'}  ${rows.length.toLocaleString('en-AU')} rows`);
    rows.slice(0, HEAD_ROWS).forEach((row, i) => printRow(i + 1, row));
    if (rows.length > HEAD_ROWS + TAIL_ROWS) {
      console.log('        …');
      rows.slice(rows.length - TAIL_ROWS).forEach((row, i) => printRow(rows.length - TAIL_ROWS + i + 1, row));
    }
  }
  // The notes a publisher writes are where the licence, the base and the series live.
  for (const { name } of scored.filter((x) => /note|content|explan|about|info|cover/i.test(x.name)).slice(0, 2)) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: '' }) as unknown[][];
    console.log(`\n      notes sheet "${name}"`);
    for (const row of rows.slice(0, 24)) {
      const text = row.map((v) => String(v ?? '').replace(/\s+/g, ' ').trim()).filter((v) => v !== '').join(' ¦ ');
      if (text !== '') console.log(`        ${text.length > 220 ? `${text.slice(0, 219)}…` : text}`);
    }
  }
}

/** A CSV's first lines, its size, and the distinct values of its first columns — the areas and years a loader will key on. */
function describeCsv(bytes: Uint8Array): void {
  const text = new TextDecoder().decode(bytes);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  console.log(`      ${lines.length.toLocaleString('en-AU')} lines`);
  for (const l of lines.slice(0, 12)) console.log(`        ${l.length > 240 ? `${l.slice(0, 239)}…` : l}`);
  const split = (l: string) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').trim()) ?? [];
  const header = split(lines[0] ?? '');
  for (let col = 0; col < Math.min(3, header.length); col += 1) {
    const values = new Set<string>();
    for (const l of lines.slice(1)) {
      const v = split(l)[col];
      if (v !== undefined && v !== '') values.add(v);
      if (values.size > 60) break;
    }
    const list = [...values];
    console.log(`      column ${col + 1} "${header[col]}": ${values.size > 60 ? 'more than 60' : values.size} distinct — ${list.slice(0, 40).join(' | ')}${list.length > 40 ? ' | …' : ''}`);
  }
}

function describeZip(bytes: Uint8Array): void {
  let members;
  try {
    members = readZipDirectoryFromTail(bytes.subarray(Math.max(0, bytes.length - ZIP_TAIL_BYTES)), bytes.length);
  } catch (err) {
    console.log(`      not readable as a zip — ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  console.log(`      ${members.length} member(s):`);
  for (const m of members.slice(0, 20)) console.log(`        ${m.uncompressedSize.toLocaleString('en-AU').padStart(14)}  ${m.name}`);
  // Describe the first member that is itself a workbook or a CSV.
  const inner = members.find((m) => /\.(xlsx|xls|csv)$/i.test(m.name) && m.uncompressedSize <= DESCRIBE_MAX_BYTES);
  if (!inner) return;
  try {
    const start = memberDataStart(bytes.subarray(inner.localHeaderOffset, inner.localHeaderOffset + 30), inner.localHeaderOffset);
    const raw = bytes.subarray(start, start + inner.compressedSize);
    const data = inner.method === 0 ? raw : inner.method === 8 ? new Uint8Array(inflateRawSync(raw)) : null;
    if (!data) { console.log(`      ${inner.name}: compression method ${inner.method}, not read`); return; }
    console.log(`\n      inside: ${inner.name}`);
    if (/\.csv$/i.test(inner.name)) describeCsv(data); else describeWorkbook(data);
  } catch (err) {
    console.log(`      ${inner.name} could not be extracted — ${err instanceof Error ? err.message : String(err)}`);
  }
}

function describeBytes(url: string, bytes0: Uint8Array): void {
  let bytes = bytes0;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(gunzipSync(bytes));
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf;
  // An .xlsx is a zip whose members are the workbook's own parts.
  if (isZip && /\.xlsx(?:$|[?#])/i.test(url)) return describeWorkbook(bytes);
  if (isZip) {
    // Could still be a workbook served under another name — look before choosing.
    const head = new TextDecoder().decode(bytes.subarray(0, 2000));
    return head.includes('[Content_Types].xml') || head.includes('xl/') ? describeWorkbook(bytes) : describeZip(bytes);
  }
  if (isOle) return describeWorkbook(bytes);
  if (looksLikeHtml(bytes)) {
    console.log(`      a web page, not a file: ${JSON.stringify(new TextDecoder().decode(bytes.subarray(0, 160)).trimStart())}`);
    return;
  }
  describeCsv(bytes);
}

/**
 * Describe a file from the publisher, and say whether the archive holds it.
 *
 * The publisher first. Where it refuses, serves an empty 200 or serves a web
 * page in the file's place, the archive's newest capture is described
 * instead and SAYS so — and the archive is asked either way, because the
 * loader's egress is not this one's.
 */
async function describe(url: string, label: string): Promise<'publisher' | 'archive' | null> {
  if (budgetLeft() < 45_000) {
    skippedForBudget.push(`${label} — ${url}`);
    console.log(`\n    NOT DESCRIBED — the probe's time budget is spent (${label})`);
    return null;
  }
  console.log(`\n    DESCRIBING (${label})`);
  console.log(`      url        ${url}`);
  const got = await download(url);
  console.log(`      publisher  ${got.note}${got.type ? ` · ${got.type}` : ''}${got.finalUrl && got.finalUrl !== url ? ` · ended at ${got.finalUrl}` : ''}`);
  const archive = await archiveCapture(url);
  console.log(`      archive    ${archive.note}`);
  if (got.bytes && !looksLikeHtml(got.bytes)) {
    describeBytes(url, got.bytes);
    return 'publisher';
  }
  if (archive.capture) {
    const viaArchive = await download(originalBytesUrl(archive.capture));
    console.log(`      from the archive (${archive.capture.timestamp}): ${viaArchive.note}${viaArchive.type ? ` · ${viaArchive.type}` : ''}`);
    if (viaArchive.bytes) {
      describeBytes(url, viaArchive.bytes);
      return 'archive';
    }
  }
  if (got.bytes) describeBytes(url, got.bytes);
  return null;
}

async function askCatalogue(c: ProjectionCatalogue): Promise<VolumeCatalogueParse> {
  kv('catalogue', `${c.root} (${c.dialect}${c.measured ? ', measured answering' : ', typed, unmeasured'})`);
  const inv = await ask(projectionInventoryUrl(c));
  if (inv.networkError === null && inv.status === 200) {
    const p = parseProjectionCatalogue(c, inv.body);
    kv('the index says it holds', p.kind === 'catalogue' ? `${p.total.toLocaleString('en-AU')} datasets` : `(unreadable — ${p.reason.slice(0, 100)})`);
  } else {
    kv('the index says it holds', `(it did not say — ${inv.networkError ?? `HTTP ${inv.status}`})`);
  }
  const parses: VolumeCatalogueParse[] = [];
  for (const q of PROJECTION_QUERIES) {
    const got = await ask(projectionSearchUrl(c, q, 100));
    if (got.networkError !== null || got.status !== 200) {
      console.log(`      ${q.padEnd(26)} ${got.networkError !== null ? `network: ${got.networkError}` : `HTTP ${got.status} ${JSON.stringify(got.body.slice(0, 100))}`}`);
      continue;
    }
    const parse = parseProjectionCatalogue(c, got.body);
    if (parse.kind === 'refused') {
      if (!got.body.trimStart().startsWith('{')) {
        console.log(`      ${q.padEnd(26)} 200 but not a catalogue — ${parse.reason.slice(0, 120)}`);
        continue;
      }
      ours(`${c.state} catalogue — ${q}`, parse.reason);
    }
    console.log(`      ${q.padEnd(26)} 200 · ${parse.total} declared · ${parse.datasets.length} read · ${got.ms} ms`);
    parses.push(parse);
  }
  return parses.length > 0 ? mergeVolumeReads(parses) : { kind: 'refused', reason: `no query reached ${c.root}` };
}

/**
 * The page a READER opens for a dataset — what `FORWARD_DEMAND_PUBLISHERS.url`
 * should point at. Measured 23 Sep 2026: Tasmania's typed product URL answered
 * 404, and that link is printed in every Tasmanian report's forward-demand
 * sentence. A catalogue's dataset page is official and stable.
 */
function datasetPage(c: ProjectionCatalogue | null, d: VolumeDataset): string {
  if (c?.dialect === 'socrata') return `https://${c.root}/d/${d.id}`;
  const root = (c?.root ?? PROJECTION_HARVEST_ROOT).replace(/\/api\/3$/, '');
  return `${root}/dataset/${d.name}`;
}

function printCandidates(ranked: ProjectionJudgement[], catalogue: ProjectionCatalogue | null, harvestIds: Set<string>): void {
  kv('its own population projections', ranked.length);
  for (const j of ranked.slice(0, 5)) {
    console.log(`\n      ${j.dataset.title}`);
    console.log(`        publisher   ${j.dataset.organisation ?? '(not stated)'}`);
    console.log(`        id          ${j.dataset.id}`);
    console.log(`        page        ${datasetPage(harvestIds.has(j.dataset.id) ? null : catalogue, j.dataset)}`);
    console.log(`        grain words ${j.grainWords.length > 0 ? j.grainWords.join(', ') : '(none in its own words)'}`);
    console.log(`        licence     ${j.dataset.licence ?? '(not stated)'}`);
    console.log(`        updated     ${j.dataset.metadataModified ?? '(not stated)'}`);
    for (const r of j.dataset.resources.slice(0, 12)) {
      console.log(`        resource    ${r.format.padEnd(6)} ${r.name.slice(0, 70)}`);
      console.log(`                    ${r.url}`);
    }
  }
}

function printLinks(links: ProjectionLink[]): void {
  for (const l of links.slice(0, 14)) {
    console.log(`      ${l.format.padEnd(5)} ${(l.grainWords.join(',') || '-').padEnd(14)} ${l.projection ? 'proj' : '    '}  ${l.text.slice(0, 70)}`);
    console.log(`            ${l.url}`);
  }
}

/** A page, from the publisher, or from the archive where the publisher refuses. */
async function readPage(url: string): Promise<{ body: string; via: string } | null> {
  if (budgetLeft() < 90_000) {
    skippedForBudget.push(`page — ${url}`);
    return null;
  }
  const page = await ask(url, 'text/html,*/*');
  if (page.networkError === null && page.status === 200 && page.body.trim() !== '') return { body: page.body, via: 'publisher' };
  const archive = await archiveCapture(url);
  const why = page.networkError ?? `HTTP ${page.status}${page.body.trim() === '' ? ' (empty)' : ''}`;
  if (!archive.capture) {
    console.log(`      page ${url} → ${why}; ${archive.note}`);
    return null;
  }
  const copy = await ask(originalBytesUrl(archive.capture), 'text/html,*/*');
  if (copy.networkError !== null || copy.status !== 200) {
    console.log(`      page ${url} → ${why}; archive copy ${copy.networkError ?? `HTTP ${copy.status}`}`);
    return null;
  }
  return { body: copy.body, via: `archive ${archive.capture.timestamp} (publisher: ${why})` };
}

/**
 * The publisher's own pages, one level down from the product page — the first
 * run found Queensland's and New South Wales' product pages answering 200 and
 * linking to no file at all, because the files are one page deeper. Where the
 * product page itself is gone (Tasmania's answered 404), the walk starts at
 * the publisher's root. Bounded: ten pages.
 */
async function walkProductPages(start: string): Promise<ProjectionLink[]> {
  const first = await readPage(start);
  let queue: string[] = [];
  const links: ProjectionLink[] = [];
  const visited = new Set<string>([start]);
  if (first) {
    kv('product page', `${start} → via ${first.via}`);
    links.push(...projectionFileLinks(first.body, start));
    queue = projectionSubPages(first.body, start, 8);
  } else {
    const root = `${new URL(start).origin}/`;
    kv('product page', `${start} → not read; walking from ${root}`);
    const home = await readPage(root);
    visited.add(root);
    if (home) queue = projectionSubPages(home.body, root, 8);
  }
  for (const next of queue) {
    if (visited.size >= 10) break;
    if (visited.has(next)) continue;
    visited.add(next);
    const page = await readPage(next);
    if (!page) continue;
    const found = projectionFileLinks(page.body, next);
    console.log(`      sub-page  ${next} → via ${page.via} · ${found.length} file link(s)`);
    links.push(...found);
    // One more level where a sub-page is itself an index of projection pages.
    if (found.length === 0) {
      for (const deeper of projectionSubPages(page.body, next, 4)) {
        if (visited.size >= 10 || visited.has(deeper)) continue;
        visited.add(deeper);
        const d = await readPage(deeper);
        if (!d) continue;
        const f2 = projectionFileLinks(d.body, deeper);
        console.log(`      sub-page  ${deeper} → via ${d.via} · ${f2.length} file link(s)`);
        links.push(...f2);
      }
    }
  }
  const seen = new Set<string>();
  return rankProjectionLinks(links.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true))));
}

/** Socrata's own record of a dataset — its licence, attribution and columns, which the catalogue API does not carry. */
async function socrataMetadata(domain: string, id: string): Promise<void> {
  const got = await ask(`https://${domain}/api/views/${encodeURIComponent(id)}.json`);
  if (got.networkError !== null || got.status !== 200) {
    console.log(`        metadata    ${got.networkError ?? `HTTP ${got.status}`}`);
    return;
  }
  try {
    const v = JSON.parse(got.body) as {
      name?: string; attribution?: string; attributionLink?: string; rowsUpdatedAt?: number;
      license?: { name?: string; termsLink?: string }; licenseId?: string;
      columns?: Array<{ fieldName?: string; name?: string; dataTypeName?: string }>;
      metadata?: { custom_fields?: Record<string, Record<string, string>> };
    };
    console.log(`        licence     ${v.license?.name ?? v.licenseId ?? '(not stated)'}${v.license?.termsLink ? ` · ${v.license.termsLink}` : ''}`);
    console.log(`        attribution ${v.attribution ?? '(not stated)'}${v.attributionLink ? ` · ${v.attributionLink}` : ''}`);
    console.log(`        rows updated ${typeof v.rowsUpdatedAt === 'number' ? new Date(v.rowsUpdatedAt * 1000).toISOString() : '(not stated)'}`);
    console.log(`        columns     ${(v.columns ?? []).slice(0, 14).map((c) => `${c.fieldName ?? '?'}[${c.dataTypeName ?? '?'}]`).join(', ')}${(v.columns ?? []).length > 14 ? ` …(${(v.columns ?? []).length})` : ''}`);
    const custom = v.metadata?.custom_fields ?? {};
    for (const [group, fields] of Object.entries(custom).slice(0, 4)) {
      console.log(`        ${group.slice(0, 11).padEnd(11)} ${Object.entries(fields).map(([k, x]) => `${k}: ${String(x).slice(0, 60)}`).join(' · ').slice(0, 300)}`);
    }
  } catch {
    console.log(`        metadata    200 but not JSON — ${JSON.stringify(got.body.slice(0, 80))}`);
  }
}

/** A workbook the way the loader fetches one: the publisher, then the archive's newest capture that loads. */
async function fetchLikeTheLoader(url: string): Promise<{ bytes: Uint8Array; via: string } | { bytes: null; why: string }> {
  const isZip = (b: Uint8Array | null): b is Uint8Array => b !== null && b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b;
  const got = await download(url);
  if (isZip(got.bytes)) return { bytes: got.bytes, via: `publisher (${got.note})` };
  const index = await ask(cdxUrl({ urlPattern: url, limit: 200 }), 'application/json');
  if (index.networkError !== null || index.status !== 200) {
    return { bytes: null, why: `publisher ${got.note}; archive index ${index.networkError ?? `HTTP ${index.status}`}` };
  }
  let captures: WaybackCapture[];
  try { captures = parseCdxJson(index.body); } catch (err) {
    return { bytes: null, why: `publisher ${got.note}; archive index unreadable — ${err instanceof Error ? err.message : String(err)}` };
  }
  for (const c of [...captures].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 4)) {
    const copy = await download(originalBytesUrl(c));
    if (isZip(copy.bytes)) return { bytes: copy.bytes, via: `archive ${c.timestamp} (publisher: ${got.note})` };
  }
  return { bytes: null, why: `publisher ${got.note}; the archive holds ${captures.length} capture(s), none of the newest four loads` };
}

const LICENCE_WORDS = /©|licen[cs]e|creative commons|cc[ -]by|attribution|copyright|reproduc|permission|terms of use/i;

/** Every line of a sheet that speaks about rights, in full — the licence is read, never assumed. */
function printRightsLines(label: string, grid: Grid | undefined, all = false): void {
  if (!grid) return;
  const lines: string[] = [];
  for (const row of grid) for (const c of row ?? []) {
    const t = cellText(c);
    if (t !== '' && (all || LICENCE_WORDS.test(t))) lines.push(t);
  }
  console.log(`      ${label}: ${lines.length === 0 ? '(no line speaks about rights)' : ''}`);
  for (const l of lines.slice(0, 16)) console.log(`        ${l.length > 400 ? `${l.slice(0, 399)}…` : l}`);
}

/** The bytes each dry run fetched, so the terms pass reads the file the dry run read rather than fetching it twice. */
const fetchedFiles = new Map<string, Uint8Array>();

async function dryRun(file: ProjectionFile): Promise<string> {
  console.log(`\n    ${file.key} — ${file.state} · ${file.url}`);
  if (budgetLeft() < 60_000) { skippedForBudget.push(`dry run ${file.key}`); return 'not run (budget)'; }
  const got = await fetchLikeTheLoader(file.url);
  if (got.bytes === null) { console.log(`      NOT FETCHED — ${got.why}`); return 'not fetched'; }
  fetchedFiles.set(file.key, got.bytes);
  console.log(`      fetched    ${got.bytes.length.toLocaleString('en-AU')} bytes via ${got.via}`);
  const began = Date.now();
  let read;
  try {
    read = await readXlsxSheets(got.bytes, file.sheets);
  } catch (err) {
    console.log(`      REFUSED READING — ${err instanceof Error ? err.message : String(err)}`);
    return 'read refused';
  }
  const readMs = Date.now() - began;
  console.log(`      sheets     ${read.sheetNames.join(' | ')}`);
  console.log(`      read       ${file.sheets.join(', ')} in ${readMs} ms (${file.sheets.map((n) => `${n}: ${read.grids[n].filter(Boolean).length} rows`).join(', ')})`);
  for (const n of file.sheets) printRightsLines(`rights lines in "${n}"`, read.grids[n], /readme/i.test(n));
  let parsed;
  try {
    parsed = parseProjectionFile(file, read.grids, file.url, file.licence ?? '(dry run — no licence accepted)');
  } catch (err) {
    console.log(`      REFUSED PARSING — ${err instanceof Error ? err.message : String(err)}`);
    return 'parse refused';
  }
  const guard = guardProjectionRows(parsed.rows);
  console.log(`      release    ${parsed.release}`);
  console.log(`      series     ${parsed.series.join(' | ')}`);
  console.log(`      base       ${parsed.base ?? '(none printed)'} · horizon ${parsed.horizon}`);
  console.log(`      areas      ${parsed.areas} (floor ${file.minAreas}) · rows ${parsed.rows.length.toLocaleString('en-AU')} · parsed in ${Date.now() - began - readMs} ms`);
  console.log(`      gate       ${guard.ok ? `PASSES — ${guard.areaKinds.join(', ')} · ${guard.firstYear}–${guard.lastYear}` : `REFUSES — ${guard.reason}`}`);
  console.log(`      licence    ${file.licence ?? 'NONE ACCEPTED — the loader refuses'} — ${file.licenceEvidence}`);
  console.log(`      declined   ${parsed.declined.length}${parsed.declined.length > 0 ? ` — ${parsed.declined.slice(0, 12).join(' · ')}` : ''}`);
  const byArea = new Map<string, typeof parsed.rows>();
  for (const r of parsed.rows) byArea.set(r.area_code, [...(byArea.get(r.area_code) ?? []), r]);
  const sample = [...byArea.values()];
  const show = [...sample.slice(0, 3), ...sample.slice(-2)];
  for (const rows of show) {
    const b = rows.find((r) => r.year_kind === 'base');
    const h = rows.filter((r) => r.year_kind === 'projected').sort((a, c) => a.year - c.year);
    const last = h[h.length - 1];
    console.log(`        ${rows[0].area.padEnd(40).slice(0, 40)} token ${rows[0].area_token.slice(0, 28).padEnd(28)} `
      + `${b ? `${b.year} ${Math.round(b.value).toLocaleString('en-AU')} (base)` : '(no base)'} → ${last ? `${last.year} ${Math.round(last.value).toLocaleString('en-AU')}` : '(no projection)'}`);
  }
  return guard.ok ? `would write ${parsed.rows.length} rows for ${parsed.areas} areas` : 'gate refuses';
}

/** Strip a page to its visible lines. */
function pageLines(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|tr|section|footer)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&copy;/g, '©').replace(/&#169;/g, '©')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '');
}

/** What a publisher's own site says about reusing what it publishes. */
async function rightsPages(origin: string): Promise<void> {
  const home = await readPage(`${origin}/`);
  if (!home) { console.log(`      ${origin}/ not read`); return; }
  /*
   * An href is an HTML attribute, so its `&amp;` is `&`: the 23 Sep run
   * followed Tasmania's "Disclaimer & Copyright" link with the entity still
   * in it and SharePoint answered 404 to a URL nobody had published. And a
   * bare "licence" is not a rights link — the same run's first pick was
   * *Liquor licence decisions*.
   */
  const hrefs = [...home.body.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ href: unescapeXml(m[1]), text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))
    .filter((l) => RIGHTS_LINK.test(`${l.href} ${l.text}`));
  const urls = [...new Set(hrefs.map((l) => new URL(l.href, `${origin}/`).toString()))].slice(0, 3);
  console.log(`      ${origin}/ via ${home.via} · rights links: ${urls.length === 0 ? 'none' : urls.join(' | ')}`);
  for (const u of urls) {
    const page = await readPage(u);
    if (!page) continue;
    const lines = pageLines(page.body).filter((l) => LICENCE_WORDS.test(l));
    console.log(`      ${u} (via ${page.via}) — ${lines.length} line(s) about rights`);
    for (const l of lines.slice(0, 14)) console.log(`        ${l.length > 300 ? `${l.slice(0, 299)}…` : l}`);
  }
}

/** A link that leads to a statement of rights: copyright, disclaimer, a licence by name, or terms of use. */
const RIGHTS_LINK = /copyright|disclaimer|creative commons|terms (of use|and conditions)|terms-of-use/i;

/**
 * The external links a worksheet carries, in the publisher's own words — the
 * hyperlinks live in the sheet's relationships part, not in its cells, so a
 * cell reading "Click here for Treasury's population projections home page"
 * says where it points only here.
 */
async function sheetHyperlinks(bytes: Uint8Array, sheet: string): Promise<string[]> {
  const members = xlsxMembers(bytes);
  const byName = new Map(members.map((m) => [m.name, m]));
  const text = async (name: string) => {
    const m = byName.get(name);
    return m ? new TextDecoder().decode(await readMember(bytes, m)) : null;
  };
  const workbook = await text('xl/workbook.xml');
  const rels = await text('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) return [];
  const paths = sheetMembers(workbook, rels);
  const path = paths.get(sheet) ?? [...paths.entries()].find(([n]) => n.trim().toLowerCase() === sheet.trim().toLowerCase())?.[1];
  if (!path) return [];
  const slash = path.lastIndexOf('/');
  const sheetRels = await text(`${path.slice(0, slash)}/_rels/${path.slice(slash + 1)}.rels`);
  if (!sheetRels) return [];
  return [...sheetRels.matchAll(/<Relationship\b([^>]*?)\/?>/g)]
    .filter((m) => /TargetMode="External"/.test(m[1]))
    .map((m) => unescapeXml(/\bTarget="([^"]*)"/.exec(m[1])?.[1] ?? ''))
    .filter((t) => /^https?:\/\//.test(t));
}

/**
 * The text of a PDF's first and last pages, where a publisher prints its
 * copyright and licence statement. pdf.js's legacy build, in Node; the
 * polyfill is for Node 20, which CI pins and which predates
 * `Promise.withResolvers`.
 */
async function pdfText(bytes: Uint8Array, first = 4, last = 2): Promise<string[]> {
  const P = Promise as unknown as { withResolvers?: unknown };
  if (typeof P.withResolvers !== 'function') {
    P.withResolvers = function withResolvers<T>() {
      let resolve!: (v: T) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  const pages = new Set<number>();
  for (let i = 1; i <= Math.min(first, doc.numPages); i += 1) pages.add(i);
  for (let i = Math.max(1, doc.numPages - last + 1); i <= doc.numPages; i += 1) pages.add(i);
  const lines: string[] = [];
  for (const n of [...pages].sort((a, b) => a - b)) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let line = '';
    for (const item of content.items as Array<{ str?: string; hasEOL?: boolean }>) {
      line += item.str ?? '';
      if (item.hasEOL) { if (line.trim() !== '') lines.push(`p${n}: ${line.replace(/\s+/g, ' ').trim()}`); line = ''; }
      else line += ' ';
    }
    if (line.trim() !== '') lines.push(`p${n}: ${line.replace(/\s+/g, ' ').trim()}`);
  }
  await doc.destroy();
  return lines;
}

/**
 * Tasmania's own terms, read where the publisher points. The workbook's ReadMe
 * links to the Treasury's projections page; that page links the Final Report,
 * and a Treasury report carries its copyright and licence statement on its
 * opening pages. The 23 Sep run read "© Government of Tasmania" in the ReadMe
 * and nothing about reuse anywhere — a notice is silence about terms, so the
 * load stays refused until a statement of terms is read.
 */
async function tasmaniaTerms(): Promise<void> {
  let bytes = fetchedFiles.get('tas_medium') ?? null;
  if (!bytes) {
    const got = await fetchLikeTheLoader('https://www.treasury.tas.gov.au/Documents/2024-population-projections-Medium-series-Main-output-file.xlsx');
    bytes = got.bytes;
  }
  if (!bytes) { console.log('      the medium-series workbook was not fetched, so its links were not read'); return; }
  const links = await sheetHyperlinks(bytes, 'ReadMe');
  console.log(`      the ReadMe links to: ${links.length === 0 ? '(nothing)' : links.join(' | ')}`);
  const reports: Array<{ url: string; text: string }> = [];
  for (const link of links.slice(0, 3)) {
    const page = await readPage(link);
    if (!page) continue;
    const lines = pageLines(page.body).filter((l) => LICENCE_WORDS.test(l));
    console.log(`      ${link} (via ${page.via}) — ${lines.length} line(s) about rights`);
    for (const l of lines.slice(0, 10)) console.log(`        ${l.length > 300 ? `${l.slice(0, 299)}…` : l}`);
    const docs = [...page.body.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => ({ url: new URL(unescapeXml(m[1]), link).toString(), text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))
      .filter((d) => /\.(pdf|docx?)(\?|$)/i.test(d.url));
    for (const d of docs.slice(0, 12)) console.log(`        document  ${d.text.slice(0, 70).padEnd(70)} ${d.url}`);
    reports.push(...docs.filter((d) => /\.pdf(\?|$)/i.test(d.url) && /report|guide|projection/i.test(`${d.text} ${d.url}`)));
  }
  for (const r of reports.slice(0, 2)) {
    if (budgetLeft() < 60_000) { skippedForBudget.push(`Tasmanian report — ${r.url}`); break; }
    const got = await download(r.url);
    if (!got.bytes) { console.log(`      ${r.url} → ${got.note}`); continue; }
    try {
      const lines = await pdfText(got.bytes);
      printWithContext(`${r.text || r.url} — ${got.note}, read from its opening and closing pages`, lines, LICENCE_WORDS, 2, 6, 40);
    } catch (err) {
      console.log(`      ${r.url} — ${got.note}, not readable as a PDF: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** A zero-based column index as a spreadsheet names it (0 → A, 26 → AA). */
function columnName(i: number): string {
  let n = i + 1;
  let out = '';
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

/**
 * Every line matching `re`, WITH the lines around it. A rights statement is a
 * sentence, and a PDF or a page breaks sentences across lines: the 23 Sep run
 * printed Tasmania's quick guide as "You are free to reproduce the projections
 * in published work, or use them as an input into your own" and stopped, which
 * is the half of the sentence that grants and none of the half that conditions.
 */
function printWithContext(label: string, lines: readonly string[], re: RegExp, before = 2, after = 5, max = 48): void {
  const hits = lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
  const keep = new Set<number>();
  for (const i of hits) for (let k = Math.max(0, i - before); k <= Math.min(lines.length - 1, i + after); k++) keep.add(k);
  console.log(`      ${label} — ${lines.length} line(s), ${hits.length} about rights`);
  let last = -2;
  let printed = 0;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (printed >= max) { console.log('        … (cut at the print ceiling)'); break; }
    if (i !== last + 1) console.log('        ·');
    console.log(`        ${re.test(lines[i]) ? '»' : ' '} ${clip(lines[i], 320)}`);
    last = i;
    printed += 1;
  }
}

/** Every non-empty cell of a sheet, one per line, in reading order. */
const gridLines = (grid: Grid | undefined): string[] =>
  (grid ?? []).flatMap((row) => (row ?? []).map((c) => cellText(c)).filter((t) => t !== ''));

/**
 * Queensland's workbooks as the parser reads them: the Main page in full —
 * the edition, the "final estimates" sentence the base comes from, the
 * boundary edition the SA2 codes belong to, the disclaimer — and each table's
 * first and last filled rows with EVERY cell and its column, because the SA2
 * sheet declares 125 columns around the twelve the describer printed and a
 * second block of years out to the right would be read as persons by a parser
 * that never looked.
 */
async function queenslandWorkbooks(): Promise<void> {
  for (const key of ['qld_sa2', 'qld_lga'] as const) {
    const file = PROJECTION_FILES.find((f) => f.key === key);
    const bytes = fetchedFiles.get(key);
    if (!file || !bytes) { console.log(`      ${key}: not fetched by the dry run, so not read`); continue; }
    let read;
    try { read = await readXlsxSheets(bytes, file.sheets); } catch (err) {
      console.log(`      ${key}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const main = gridLines(read.grids['Main page']);
    console.log(`\n      ${key} — "Main page", all ${main.length} line(s)`);
    for (const l of main.slice(0, 60)) console.log(`        ${clip(l, 400)}`);
    for (const name of file.sheets.filter((n) => n !== 'Main page')) {
      const grid = read.grids[name];
      const filled = grid.map((row, r) => ({ r, row })).filter(({ row }) => row && row.some((c) => cellText(c) !== ''));
      const widest = Math.max(0, ...filled.map(({ row }) => row.reduce<number>((m, c, i) => (cellText(c) !== '' ? i : m), 0)));
      console.log(`      ${key} — "${name}": ${filled.length} filled rows, the widest reaching column ${columnName(widest)}`);
      for (const { r, row } of [...filled.slice(0, 5), ...filled.slice(-9)]) {
        const cells = row.map((c, i) => ({ i, t: cellText(c) })).filter((x) => x.t !== '');
        console.log(`        ${String(r + 1).padStart(4)}  ${cells.map((x) => `${columnName(x.i)} ${clip(x.t, 70)}`).join(' ¦ ')}`);
      }
    }
  }
}

/**
 * Where Queensland applies terms to THIS product. The Statistician's
 * copyright page defers to "specific licence terms … applied through or via
 * this website to material including a particular product", so the product
 * page is the first place those terms would be written.
 */
async function queenslandProductTerms(): Promise<void> {
  for (const url of [
    'https://www.qgso.qld.gov.au/statistics/theme/population/population-projections/regions',
    'https://www.qgso.qld.gov.au/copyright',
  ]) {
    const page = await readPage(url);
    if (!page) { console.log(`      ${url} not read`); continue; }
    printWithContext(`${url} (via ${page.via})`, pageLines(page.body), LICENCE_WORDS, 1, 3, 30);
  }
}

/**
 * The Northern Territory's 2024 workbook, read for a parser and for its
 * terms. The 23 Sep run found its region sheets are the ABS's own SA3 names
 * (Darwin City, Darwin Suburbs, Litchfield, Palmerston, Alice Springs,
 * Barkly, Daly-Tiwi-West Arnhem, East Arnhem, Katherine), in blocks by
 * Aboriginal status and sex, and a footnote beginning "Regions correspond
 * to …" that decides what grain that is. This prints the Summary and the
 * footnotes whole, every block title of one region sheet, and every line in
 * the workbook that speaks about rights — then the Treasury's own copyright
 * page, through the archive where Cloudflare refuses CI.
 */
async function northernTerritoryWorkbook(): Promise<void> {
  const url = 'https://treasury.nt.gov.au/pms/economy/population-projections/NTPOP-2024-Release.xlsx';
  let got = await fetchLikeTheLoader(url);
  if (got.bytes === null) {
    /*
     * The archive's INDEX is the least reliable thing this probe asks: the
     * second 23 Sep run lost it to "fetch failed" three times running, while
     * the first had found this file's capture (20251121111355). A capture's
     * own address needs no index, so the one already measured is asked for
     * directly — a probe that reads the file, where the loader would have
     * said the index was down.
     */
    const known = await download(originalBytesUrl({ timestamp: '20251121111355', original: url }));
    const isZip = known.bytes !== null && known.bytes.length >= 4 && known.bytes[0] === 0x50 && known.bytes[1] === 0x4b;
    console.log(`      the loader's route: ${got.why}`);
    if (!isZip || known.bytes === null) { console.log(`      the known capture 20251121111355: ${known.note} — NOT FETCHED`); return; }
    got = { bytes: known.bytes, via: 'archive 20251121111355, asked by its own address (the index did not answer)' };
  }
  console.log(`      fetched ${got.bytes.length.toLocaleString('en-AU')} bytes via ${got.via}`);
  let names: string[];
  let read;
  try {
    names = (await readXlsxSheets(got.bytes, [])).sheetNames;
    read = await readXlsxSheets(got.bytes, names);
  } catch (err) {
    console.log(`      not read — ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const summary = names.find((n) => /^summary$/i.test(n.trim()));
  if (summary) {
    const lines = gridLines(read.grids[summary]);
    console.log(`      "${summary}", all ${lines.length} line(s)`);
    for (const l of lines.slice(0, 80)) console.log(`        ${clip(l, 400)}`);
  }
  const region = names.find((n) => /^darwin city/i.test(n.trim())) ?? names[2];
  if (region) {
    const grid = read.grids[region];
    console.log(`      "${region}" — every row whose first cell is text and not an age group, and every cell right of the table`);
    grid.forEach((row, r) => {
      const a = cellText(row?.[0]);
      const texts = (row ?? []).map((c, i) => ({ i, t: cellText(c) })).filter((x) => x.t !== '' && (x.i > 6 || (x.i === 0 && !/^\d|^total$|^85 and over$/i.test(x.t))));
      if (a === '' && texts.length === 0) return;
      if (texts.length > 0) console.log(`        ${String(r + 1).padStart(4)}  ${texts.map((x) => `${columnName(x.i)} ${clip(x.t, 200)}`).join(' ¦ ')}`);
    });
  }
  const rights = names.flatMap((n) => gridLines(read.grids[n]).filter((l) => LICENCE_WORDS.test(l)).map((l) => `${n}: ${l}`));
  console.log(`      lines about rights anywhere in the workbook: ${rights.length === 0 ? '(none)' : ''}`);
  for (const l of [...new Set(rights)].slice(0, 20)) console.log(`        ${clip(l, 400)}`);
  for (const page of ['https://treasury.nt.gov.au/copyright', 'https://treasury.nt.gov.au/disclaimer', 'https://nt.gov.au/page/copyright']) {
    const got = await readPage(page);
    if (!got) { console.log(`      ${page} not read`); continue; }
    printWithContext(`${page} (via ${got.via})`, pageLines(got.body), LICENCE_WORDS, 1, 3, 24);
  }
}

/**
 * South Australia's CURRENT edition, read through the archive. The 23 Sep
 * afternoon run found it there: *Population Projections for South Australia
 * and Regions, 2021 to 2051* — council and SA2 workbooks in the medium and
 * high series, captured 13 Nov 2025 — while `plan.sa.gov.au` refuses CI. SA
 * was declined because the catalogue's edition is 2016-based; that decline
 * holds only for the catalogue copy, so the current edition is read the way
 * a parser would need it, and its terms where the edition states them: the
 * workbooks' own lines, and the edition's report on its opening and closing
 * pages. Each file is asked for by its capture's own address, because the
 * archive's index is the part that fails.
 */
const SA_CURRENT_EDITION: ReadonlyArray<{ timestamp: string; url: string; label: string }> = [
  { timestamp: '20251113050053', url: 'https://plan.sa.gov.au/__data/assets/excel_doc/0005/1344893/Population-projections-by-local-government-area-2021-2041-medium-series.xlsx', label: 'SA — LGA, medium series' },
  { timestamp: '20251113050052', url: 'https://plan.sa.gov.au/__data/assets/excel_doc/0004/1344892/Population-projections-by-local-government-area-2021-2041-high-series.xlsx', label: 'SA — LGA, high series' },
  { timestamp: '20251113050053', url: 'https://plan.sa.gov.au/__data/assets/excel_doc/0007/1344895/Population-projections-by-statistical-area-level-2-2021-2041-medium-series.xlsx', label: 'SA — SA2, medium series' },
  { timestamp: '20251113050053', url: 'https://plan.sa.gov.au/__data/assets/excel_doc/0006/1344894/Population-projections-by-statistical-area-level-2-2021-2041-high-series.xlsx', label: 'SA — SA2, high series' },
];

async function southAustraliaCurrentEdition(): Promise<void> {
  for (const f of SA_CURRENT_EDITION) {
    if (budgetLeft() < 45_000) { skippedForBudget.push(`${f.label} — ${f.url}`); break; }
    console.log(`\n    DESCRIBING (${f.label}) — archive ${f.timestamp}`);
    console.log(`      url        ${f.url}`);
    const got = await download(originalBytesUrl({ timestamp: f.timestamp, original: f.url }));
    console.log(`      archive    ${got.note}${got.type ? ` · ${got.type}` : ''}`);
    if (!got.bytes || looksLikeHtml(got.bytes)) continue;
    await describeForParser(got.bytes);
  }
}

/**
 * A publisher's terms, wherever the archive holds them. Asked of the archive's
 * index because the pages are refused by name: the NT's copyright pages
 * answered CI 403 with no capture at the addresses tried, and the index held
 * three under other addresses (23 Sep). The newest capture of each copyright,
 * disclaimer or terms page is read, with the lines around every rights line.
 */
async function archivedTermsPages(hosts: readonly string[]): Promise<void> {
  for (const host of hosts) {
    if (budgetLeft() < 30_000) { skippedForBudget.push(`terms pages — ${host}`); break; }
    const q = cdxUrl({ urlPattern: `${host}/*`, filters: ['original:.*([Cc]opyright|[Dd]isclaimer|[Tt]erms|[Ll]icen[cs]e).*', 'mimetype:text/html'], from: '2022', limit: 200 });
    const got = await ask(q, 'application/json');
    if (got.networkError !== null || got.status !== 200) { console.log(`      ${host}: archive index ${got.networkError ?? `HTTP ${got.status}`}`); continue; }
    let caps: WaybackCapture[];
    try { caps = parseCdxJson(got.body); } catch (err) { console.log(`      ${host}: archive index unreadable — ${err instanceof Error ? err.message : String(err)}`); continue; }
    const newest = new Map<string, WaybackCapture>();
    for (const c of caps) if (!newest.has(c.original) || newest.get(c.original)!.timestamp < c.timestamp) newest.set(c.original, c);
    console.log(`      ${host}: ${caps.length} capture(s) of ${newest.size} copyright, disclaimer, terms or licence page(s)`);
    for (const c of [...newest.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 3)) {
      const page = await download(originalBytesUrl(c));
      if (!page.bytes) { console.log(`        ${c.timestamp} ${c.original} → ${page.note}`); continue; }
      printWithContext(`${c.original} (archive ${c.timestamp})`, pageLines(new TextDecoder().decode(page.bytes)), LICENCE_WORDS, 1, 3, 24);
    }
  }
}

/** Every filled row's cells with their columns — the first `head` and the last `tail` — and the widest column any row reaches. */
function printFilledRows(label: string, grid: Grid, head = 6, tail = 10): void {
  const filled = grid.map((row, r) => ({ r, row })).filter(({ row }) => row && row.some((c) => cellText(c) !== ''));
  const widest = Math.max(0, ...filled.map(({ row }) => row.reduce<number>((m, c, i) => (cellText(c) !== '' ? i : m), 0)));
  console.log(`      ${label}: ${filled.length} filled rows, the widest reaching column ${columnName(widest)}`);
  const shown = filled.length <= head + tail ? filled : [...filled.slice(0, head), ...filled.slice(-tail)];
  let last = -1;
  for (const { r, row } of shown) {
    if (last >= 0 && r !== last + 1 && shown.length < filled.length) console.log('        …');
    const cells = row.map((c, i) => ({ i, t: cellText(c) })).filter((x) => x.t !== '');
    console.log(`        ${String(r + 1).padStart(5)}  ${cells.map((x) => `${columnName(x.i)} ${clip(x.t, 60)}`).join(' ¦ ')}`);
    last = r;
  }
}

/**
 * A workbook through the loader's own reader: every sheet, its filled rows at
 * both ends with every cell and its column, the whole text of any notes-like
 * sheet, and every line about rights. What a parser is written against.
 */
async function describeForParser(bytes: Uint8Array): Promise<void> {
  let names: string[];
  let read;
  try {
    names = (await readXlsxSheets(bytes, [])).sheetNames;
    read = await readXlsxSheets(bytes, names);
  } catch (err) {
    console.log(`      not read by the loader's reader — ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  console.log(`      sheets (${names.length}): ${names.join(' | ')}`);
  for (const n of names.slice(0, 12)) {
    const lines = gridLines(read.grids[n]);
    if (/note|content|read ?me|about|info|cover|licen|copyright|intro/i.test(n)) {
      // South Australia's SA2 notes run to 103 lines, and the table of merged
      // SA2s and the neighbours they joined sits past line 60.
      console.log(`      "${n}", all ${lines.length} line(s)`);
      for (const l of lines.slice(0, 130)) console.log(`        ${clip(l, 320)}`);
    } else {
      printFilledRows(`"${n}"`, read.grids[n]);
    }
  }
  const rights = names.flatMap((n) => gridLines(read.grids[n]).filter((l) => LICENCE_WORDS.test(l)).map((l) => `${n}: ${l}`));
  console.log(`      lines about rights anywhere in the workbook: ${rights.length === 0 ? '(none)' : ''}`);
  for (const l of [...new Set(rights)].slice(0, 16)) console.log(`        ${clip(l, 400)}`);
}

/**
 * South Australia's terms. Its current workbooks carry "© Department of Trade
 * and Investment, Government of South Australia, 2024" and nothing about
 * reuse, and a notice is silence about terms. So the edition's two reports are
 * read on their opening and closing pages — a Government report states its
 * licence there — by their captures' own addresses, and the archive is asked
 * for the terms pages it holds for the publisher's hosts.
 */
const SA_EDITION_REPORTS: ReadonlyArray<{ timestamp: string; url: string }> = [
  { timestamp: '20250321091532', url: 'https://plan.sa.gov.au/__data/assets/pdf_file/0011/1344971/Local-Area-SA2-and-LGA-Population-Projections-for-South-Australia,-2021-to-2041.pdf' },
  { timestamp: '20250321091524', url: 'https://plan.sa.gov.au/__data/assets/pdf_file/0005/1236767/Population-Projections-for-South-Australia-and-Regions-2021-to-2051-Summary.pdf' },
];

async function southAustraliaTerms(): Promise<void> {
  for (const r of SA_EDITION_REPORTS) {
    if (budgetLeft() < 60_000) { skippedForBudget.push(`SA report — ${r.url}`); break; }
    let got = await download(originalBytesUrl({ timestamp: r.timestamp, original: r.url }));
    if (!got.bytes) got = await download(originalBytesUrl({ timestamp: r.timestamp, original: r.url }));
    if (!got.bytes) { console.log(`      ${r.url} (${r.timestamp}): ${got.note}`); continue; }
    try {
      const lines = await pdfText(got.bytes);
      printWithContext(`${r.url.split('/').pop()} (archive ${r.timestamp}) — ${got.note}`, lines, LICENCE_WORDS, 2, 6, 40);
    } catch (err) {
      console.log(`      ${r.url} is not readable as a PDF: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await archivedTermsPages(['plan.sa.gov.au', 'www.sa.gov.au', 'www.dti.sa.gov.au']);
}

/**
 * The ACT's CURRENT edition, named by the Treasury's own page (archived
 * 13 Dec 2025): *ACT Population Projections 2025-2065*, at Territory,
 * district ("as approximated by the ABS Statistical Area Level 3") and suburb
 * level. The catalogue's 2015-based edition is superseded by it, so it is the
 * one a loader would read: described through the loader's own reader, and
 * its terms read where the Treasury publishes them.
 */
const ACT_CURRENT_WORKBOOK = 'https://www.treasury.act.gov.au/__data/assets/excel_doc/0008/2911319/ACT-Population-Projections-2025-2065-Workbook.xlsx';

async function actCurrentEdition(): Promise<void> {
  const got = await fetchLikeTheLoader(ACT_CURRENT_WORKBOOK);
  if (got.bytes === null) { console.log(`      NOT FETCHED — ${got.why}`); }
  else {
    console.log(`      fetched ${got.bytes.length.toLocaleString('en-AU')} bytes via ${got.via}`);
    await describeForParser(got.bytes);
  }
  await archivedTermsPages(['www.treasury.act.gov.au', 'www.act.gov.au']);
}

async function main(): Promise<void> {
  h('THE LOADER, RUN DRY — every projection file through the parser production would use');
  console.log('  Fetched the way the loader fetches, read by readXlsxSheets, parsed by');
  console.log('  parseProjectionFile and held to guardProjectionRows. Nothing is written.');
  const dry: Array<{ key: string; outcome: string }> = [];
  for (const file of PROJECTION_FILES) dry.push({ key: file.key, outcome: await dryRun(file) });

  h('WHAT THE LOAD STILL NEEDS ANSWERED');
  console.log('\n  The licence each publisher states for reuse');
  await rightsPages('https://www.planning.nsw.gov.au');
  await rightsPages('https://www.treasury.tas.gov.au');
  await rightsPages('https://www.qgso.qld.gov.au');

  console.log('\n  Tasmania\'s terms, where its own workbook points');
  await tasmaniaTerms();

  console.log('\n  Queensland\'s workbooks as the parser reads them (the dry run\'s own bytes)');
  await queenslandWorkbooks();

  console.log('\n  Queensland\'s terms for this product, where its copyright page says they would be written');
  await queenslandProductTerms();

  console.log('\n  Where Queensland puts its projection files (the first walk found none one level down)');
  for (const page of [
    'https://www.qgso.qld.gov.au/statistics/theme/population/population-projections/regions',
    'https://www.qgso.qld.gov.au/statistics/theme/population/population-projections/state',
  ]) {
    const got = await readPage(page);
    if (!got) continue;
    const links = [...got.body.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => ({ href: new URL(m[1], page).toString(), text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))
      .filter((l) => /\.(xlsx?|csv|zip)(\?|$)|\/issues\/|download|attachment/i.test(l.href));
    console.log(`      ${page} via ${got.via} — ${links.length} file-like link(s)`);
    for (const l of links.slice(0, 20)) console.log(`        ${l.text.slice(0, 80).padEnd(80)} ${l.href}`);
  }

  console.log('\n  The Northern Territory\'s 2024 edition, read for a parser and for its terms');
  await northernTerritoryWorkbook();

  console.log('\n  The Northern Territory\'s terms, wherever the archive holds them');
  await archivedTermsPages(['treasury.nt.gov.au', 'nt.gov.au']);

  console.log('\n  South Australia\'s current edition, through the archive (plan.sa.gov.au refuses CI)');
  await southAustraliaCurrentEdition();

  console.log('\n  South Australia\'s terms: the edition\'s reports, and the terms pages the archive holds');
  await southAustraliaTerms();

  console.log('\n  The ACT\'s current edition (2025-2065), and its terms');
  await actCurrentEdition();

  console.log('\n  The ACT\'s own description of its district projections (which year is the base?)');
  {
    const got = await ask('https://www.data.act.gov.au/api/views/e72a-8ng2.json');
    if (got.networkError === null && got.status === 200) {
      try {
        const v = JSON.parse(got.body) as { name?: string; description?: string; license?: { name?: string } };
        console.log(`      ${v.name ?? '(no name)'} · ${v.license?.name ?? '(no licence)'}`);
        for (const l of (v.description ?? '(no description)').split(/\n+/).slice(0, 12)) console.log(`        ${l.slice(0, 300)}`);
      } catch { console.log(`      200 but not JSON — ${JSON.stringify(got.body.slice(0, 80))}`); }
    } else {
      console.log(`      ${got.networkError ?? `HTTP ${got.status}`}`);
    }
  }

  /*
   * The ACT's catalogue edition is 2015-based, and its own description points
   * at the Treasury's site for "a full list of all projections". Declining the
   * ACT as superseded is only honest if the edition that supersedes it is
   * named, so the pages it points at are read for the current edition, its
   * base and its files. Its districts are SA3-shaped, so a current district
   * edition would share the reader rung the NT's regions need.
   */
  console.log('\n  Where the ACT puts its CURRENT projections (the catalogue edition is 2015-based)');
  for (const page of [
    'https://apps.treasury.act.gov.au/demography/projections/act',
    'https://www.treasury.act.gov.au/snapshot/demography/act',
  ]) {
    const got = await readPage(page);
    if (!got) { console.log(`      ${page} not read`); continue; }
    const lines = pageLines(got.body).filter((l) => /projection|district|base year|jump-off|licen[cs]e|creative commons|©/i.test(l));
    const links = [...got.body.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => ({ href: new URL(unescapeXml(m[1]), page).toString(), text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))
      .filter((l) => /\.(xlsx?|csv|zip|pdf)(\?|$)/i.test(l.href) || /projection/i.test(`${l.href} ${l.text}`));
    console.log(`      ${page} via ${got.via} — ${lines.length} line(s) naming a projection, a district or terms; ${links.length} link(s)`);
    for (const l of lines.slice(0, 18)) console.log(`        ${clip(l, 260)}`);
    for (const l of links.slice(0, 24)) console.log(`        link  ${clip(l.text, 70).padEnd(70)} ${l.href}`);
  }

  console.log('\n  Whether South Australia\'s newer edition is in the archive (plan.sa.gov.au refuses CI)');
  {
    /*
     * Narrowed twice on 23 Sep: a regex over every URL the archive holds for
     * the whole host answered 503 on one run and died unanswered inside the
     * 30 s timeout on the next. Workbooks only, and only captures from 2022 —
     * the edition that supersedes the 2016-based one cannot be older.
     */
    const q = cdxUrl({
      urlPattern: 'plan.sa.gov.au/*',
      filters: ['mimetype:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      from: '2022',
      limit: 400,
    });
    const got = await ask(q, 'application/json');
    if (got.networkError === null && got.status === 200) {
      try {
        const caps = parseCdxJson(got.body);
        const newest = new Map<string, WaybackCapture>();
        for (const c of caps) if (!newest.has(c.original) || newest.get(c.original)!.timestamp < c.timestamp) newest.set(c.original, c);
        console.log(`      ${caps.length} capture(s) of ${newest.size} distinct URL(s) naming a projection`);
        for (const c of [...newest.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 25)) {
          console.log(`        ${c.timestamp}  ${c.mimetype.padEnd(24).slice(0, 24)} ${c.original}`);
        }
      } catch (err) { console.log(`      archive index unreadable — ${err instanceof Error ? err.message : String(err)}`); }
    } else {
      console.log(`      archive index ${got.networkError ?? `HTTP ${got.status}`}`);
    }
  }

  h('DRY RUN — READ');
  for (const d of dry) kv(d.key, d.outcome);

  if (budgetLeft() < 7 * 60_000) {
    h('THE CATALOGUE SURVEY WAS NOT RUN THIS PASS');
    console.log(`  ${Math.round(budgetLeft() / 1000)} s of the budget remained — too little for eight catalogues,`);
    console.log('  so it was skipped rather than cut short. Its last complete reading is in');
    console.log('  FORWARD_DEMAND_EVIDENCE.md §9; this is a gap in this run, not a change.');
    kv('time spent', `${Math.round((Date.now() - startedAt) / 1000)} s of a ${BUDGET_MS / 1000} s budget`);
    return;
  }
  await survey();
}

async function survey(): Promise<void> {
  h('What does each state and territory publish as its own population projection?');
  console.log('  The ABS projects to capital city or rest of state and no finer, so forward');
  console.log('  demand at a property\'s own area is a per-jurisdiction register. This asks');
  console.log('  each publisher what it has and prints what the file holds. It writes nothing.');
  console.log('  Second pass: a candidate is a POPULATION projection by its own title and');
  console.log('  this jurisdiction\'s; a dataset\'s files are ranked by the grain their own names');
  console.log('  state; every file is also looked up in the archive, which the loader uses');
  console.log('  where the production egress is refused.');

  // The harvest, once: every jurisdiction's attributable projections in one read.
  h('The Commonwealth harvest');
  const harvestParses: VolumeCatalogueParse[] = [];
  for (const q of PROJECTION_QUERIES) {
    const got = await ask(`${PROJECTION_HARVEST_ROOT}/action/package_search?${new URLSearchParams({ q, rows: '400' })}`);
    if (got.networkError !== null || got.status !== 200) {
      console.log(`      ${q.padEnd(26)} ${got.networkError ?? `HTTP ${got.status}`}`);
      continue;
    }
    const parse = parseProjectionCatalogue({ dialect: 'ckan' }, got.body);
    if (parse.kind === 'refused') ours(`harvest — ${q}`, parse.reason);
    console.log(`      ${q.padEnd(26)} 200 · ${parse.total} declared · ${parse.datasets.length} read`);
    harvestParses.push(parse);
  }
  const harvest = harvestParses.length > 0 ? mergeVolumeReads(harvestParses) : null;

  const summary: { state: ProjectionState; candidates: number; described: string[] }[] = [];

  for (const state of PROJECTION_STATES) {
    const pub = FORWARD_DEMAND_PUBLISHERS[state];
    h(`${state} — ${pub?.publisher ?? '(no publisher named)'}`);
    const datasets: VolumeDataset[] = [];

    const catalogue = PROJECTION_CATALOGUES.find((c) => c.state === state);
    if (catalogue) {
      const parse = await askCatalogue(catalogue);
      if (parse.kind === 'catalogue') {
        const titled = parse.datasets.filter((d) => POPULATION_PROJECTION_TITLE.test(d.title));
        const others = titled.filter((d) => !ownCatalogueDataset(d, state));
        kv('named a population projection', `${titled.length} (${others.length} another jurisdiction's or a council's, set aside)`);
        for (const d of others.slice(0, 5)) console.log(`      set aside  ${d.title}  (${d.organisation ?? 'no publisher'})`);
        datasets.push(...parse.datasets.filter((d) => isOwnPopulationProjection(d, state, 'own')));
      }
    } else {
      kv('catalogue', 'none this repository has verified — see sales-volume-liveness for where it publishes');
    }
    const fromHarvest = harvest?.kind === 'catalogue'
      ? harvest.datasets.filter((d) => isOwnPopulationProjection(d, state, 'harvest'))
      : [];
    kv('harvest datasets attributable', fromHarvest.length);
    datasets.push(...fromHarvest);

    const ranked = rankOwnProjections(datasets, pub?.publisher ?? null);
    printCandidates(ranked, catalogue ?? null, new Set(fromHarvest.map((d) => d.id)));
    if (catalogue?.dialect === 'socrata') {
      for (const j of ranked.slice(0, 4)) {
        console.log(`\n      Socrata record for ${j.dataset.id} — ${j.dataset.title.slice(0, 60)}`);
        await socrataMetadata(catalogue.root, j.dataset.id);
      }
    }

    // The product page, one level down, through the archive where it refuses.
    let links: ProjectionLink[] = [];
    if (pub?.url) {
      links = await walkProductPages(pub.url);
      kv('files the pages link to', links.length);
      printLinks(links);
    }

    // Describe the best file of each of the top three datasets, and the best two page links.
    const described: string[] = [];
    const tried = new Set<string>();
    for (const j of ranked.slice(0, 3)) {
      const best = rankProjectionResources(j.dataset)[0];
      if (!best || tried.has(best.resource.url)) continue;
      tried.add(best.resource.url);
      const via = await describe(best.resource.url, `catalogue: ${j.dataset.title.slice(0, 60)} · ${best.grain ?? 'grain not named'}`);
      if (via) described.push(`${best.grain ?? '?'} via ${via}`);
    }
    for (const l of links.filter((x) => x.projection || x.grainWords.length > 0).slice(0, 2)) {
      if (tried.has(l.url)) continue;
      tried.add(l.url);
      const via = await describe(l.url, `page: ${l.text.slice(0, 60)}`);
      if (via) described.push(`${l.grainWords[0] ?? '?'} via ${via}`);
    }
    summary.push({ state, candidates: ranked.length, described });
  }

  h('READ');
  for (const s of summary) {
    kv(s.state, `${s.candidates} own projection dataset(s) · described: ${s.described.length > 0 ? s.described.join(', ') : 'none'}`);
  }
  kv('time spent', `${Math.round((Date.now() - startedAt) / 1000)} s of a ${BUDGET_MS / 1000} s budget`);
  if (skippedForBudget.length > 0) {
    console.log(`\n  NOT READ, because the budget was spent (${skippedForBudget.length}) — a gap in this run, not an absence:`);
    for (const x of skippedForBudget.slice(0, 30)) console.log(`    · ${x}`);
  }
  console.log('\n  A grain NAMED is a claim in the publisher\'s words; the file descriptions above');
  console.log('  are what a loader is written against. Nothing was written anywhere.');
}

main().catch((err) => {
  ours('unexpected', err instanceof Error ? (err.stack ?? err.message) : String(err));
});
