import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';
import { createCorsHeaders, createUnauthorizedResponse, verifyAuth } from '../_shared/auth.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  QGSO_RLDA_LICENCE,
  QGSO_RLDA_PAGE_URL,
  QGSO_RLDA_SOURCE_LABEL,
  QGSO_SALES_SHEETS,
  discoverQgsoRldaSpreadsheet,
  parseQgsoRldaSales,
} from '../_shared/reports/market/openData/qgsoRldaSales.pure.ts';
import {
  NSW_DCJ_LICENCE,
  NSW_DCJ_PAGE_URL,
  NSW_DCJ_PREVIOUS_URL,
  NSW_DCJ_SOURCE_LABEL,
  chooseDcjSalesFiles,
  dcjSalesLinks,
  parseDcjSalesWorkbook,
} from '../_shared/reports/market/openData/nswDcjSales.pure.ts';
import {
  type SalesMedianRow,
  periodSpanOf,
  priceMeasureOf,
  salesAreaToken,
} from '../_shared/reports/market/openData/salesRegister.pure.ts';
import {
  ABS_RES_DWELL_LICENCE,
  ABS_RES_DWELL_SOURCE_LABEL,
  ABS_RES_DWELL_URL,
  parseAbsResDwell,
} from '../_shared/reports/market/openData/absResDwell.pure.ts';
import {
  VIC_QUARTERLY_FILE,
  VIC_TIME_SERIES_FILE,
  VIC_VPSR_ARCHIVE_PATTERN,
  VIC_VPSR_LICENCE,
  VIC_VPSR_SOURCE_LABEL,
  dwellingOfQuarterlyName,
  dwellingOfTimeSeriesName,
  parseVicQuarterly,
  parseVicTimeSeries,
} from '../_shared/reports/market/openData/vicVpsrSuburb.pure.ts';
import { SA_LSG_ARCHIVE_FLOOR, SA_LSG_ARCHIVE_PATTERN, SA_LSG_FILE, SA_LSG_LICENCE, SA_LSG_SOURCE_LABEL, parseSaLsgStats, rankOfSaFileName } from '../_shared/reports/market/openData/saLsgStats.pure.ts';
import { type RankedFile, type WaybackCapture, archivePageUrl, capturedAtIso, cdxUrl, newestByRank, originalBytesUrl, parseCdxJson, rankedCaptures, rankedFiles } from '../_shared/reports/market/openData/waybackMirror.pure.ts';

/**
 * Load the open-data sales registers into `market_sales_medians` — the
 * capital-growth evidence the Investment Grade reads where Domain's suburb
 * series is not held (docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md).
 *
 * This function IS the loader (the abs-regional-ingest pattern): both hosts
 * answer this project's egress directly, measured on 2026-09-15 through
 * pg_net (QGSO 200, 617,018 bytes; DCJ 200, 780,693 bytes), and a
 * workbook parsed here is the same workbook a person would download.
 *
 * Stages, one per publisher, re-invoked to refresh:
 *  - `qld`  — discovers the dated "all monitored regions" spreadsheet on the
 *    QGSO page (never a pinned URL: the file name carries its date and a
 *    pinned link goes stale silently), parses the four dwelling-sales sheets
 *    and upserts every LGA and regional quarter since 2008.
 *  - `nsw`  — lists the DCJ sales tables on the current and previous-reports
 *    pages, loads the newest quarter and the same quarter one, three, five
 *    and ten years earlier (the growth horizons), or the quarters named in
 *    `periods`. A workbook that refuses is recorded and the others still
 *    load; a run that loads nothing answers 422.
 *  - `abs`  — the ABS RES_DWELL_ST mean price of residential dwellings by
 *    state and territory and for Australia, every quarter since 2011: the
 *    growth floor for every jurisdiction and the national benchmark.
 *  - `vic`  — ONE Victorian Valuer-General file per invocation (`which`:
 *    `houses_ts`, `units_ts`, `quarter_house`, `quarter_unit`), read
 *    through the Internet Archive because land.vic.gov.au challenges every
 *    scripted client; the archive's index names the newest file and its
 *    newest capture, and the capture time is written on every row.
 *  - `sa`   — the South Australian quarterly suburb workbooks through the
 *    archive likewise, the newest quarter and the growth horizons by
 *    default or the quarters named in `periods`.
 *  - `probe` — asks whether each publisher and the archive answer from
 *    here, and writes nothing.
 *
 * One workbook per invocation is the rule for the heavier files: five DCJ
 * workbooks in one call exhausted the edge worker's compute allowance
 * (546 WORKER_RESOURCE_LIMIT, 15 Sep 2026), so a refresh is several calls
 * and the response names what remains.
 *
 * The parsers throw on header drift, vocabulary drift, a disagreeing
 * reporting period and an implausible shape, so a bad file refuses instead
 * of loading. Rows carry the data's own quarter; currency is read from the
 * data, never from loaded_at.
 *
 * Auth: the gateway JWT in front, and `verifyAuth` inside (the internal edge
 * secret or a verified service-role token — what `cron_service_role_headers()`
 * sends), so a scheduled or operator-run load and a browser cannot be told
 * apart by accident.
 */

const UA = 'npc-property-dashboard-market-sales-ingest';
const REFUSAL = /drift|refuse|fewer than|outside|not a quarter|no "|lists no|but the link named|not thousands|not a dollar|not a current file|quarters differ|answered \d{3}/i;

type Grid = unknown[][];

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

async function fetchWorkbook(url: string): Promise<{ workbook: XLSX.WorkBook; bytes: number }> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const isXlsx = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isXls = bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (!isXlsx && !isXls) {
    throw new Error(`${url} answered ${bytes.length} bytes that are not a workbook (no PK or compound-document header) — refused`);
  }
  return { workbook: XLSX.read(bytes, { type: 'array' }), bytes: bytes.length };
}

/** The archive's index for a publisher's path: every 200 capture, newest first per file. */
async function archiveIndex(urlPattern: string, from?: string): Promise<WaybackCapture[]> {
  const url = cdxUrl({ urlPattern, from, filters: ['mimetype:(application|text)/.*'] });
  // The CDX index sheds load with a 503 or a 504 and answers the same
  // question a moment later (measured 16 Sep 2026: three refusals and one
  // 200 for one pattern inside ten minutes), so one refusal is retried
  // once after a pause and a second one is reported.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,*/*' } });
    if (res.ok) return parseCdxJson(await res.text());
    await res.body?.cancel();
    if (res.status >= 500 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    throw new Error(`the Wayback CDX index answered ${res.status} for ${urlPattern}${attempt ? ' (twice)' : ''}`);
  }
}

function firstGrid(workbook: XLSX.WorkBook): Grid {
  const name = workbook.SheetNames[0];
  const grid = name ? gridOf(workbook, name) : null;
  if (!grid) throw new Error('the workbook has no sheet — refused');
  return grid;
}

function fileNameOf(url: string): string {
  return url.slice(url.lastIndexOf('/') + 1);
}

function gridOf(workbook: XLSX.WorkBook, name: string): Grid | null {
  const sheet = workbook.Sheets[name];
  if (!sheet) return null;
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as Grid;
}

interface RegisterRecord {
  state: string;
  area_kind: string;
  area: string;
  area_token: string;
  dwelling_type: string;
  period: string;
  median_price: number | null;
  sales_count: number | null;
  source: string;
  source_url: string;
  licence: string;
  loaded_at: string;
  price_measure: string;
  period_span: string;
  captured_at: string | null;
}

function toRecords(rows: ReadonlyArray<SalesMedianRow>, source: string, sourceUrl: string, licence: string, loadedAt: string): RegisterRecord[] {
  return rows.map((r) => ({
    state: r.state,
    area_kind: r.areaKind,
    area: r.area,
    area_token: salesAreaToken(r.areaKind, r.area),
    dwelling_type: r.dwellingType,
    period: r.period,
    median_price: r.medianPrice,
    sales_count: r.salesCount,
    source,
    source_url: sourceUrl,
    licence,
    loaded_at: loadedAt,
    price_measure: priceMeasureOf(r),
    period_span: periodSpanOf(r),
    captured_at: r.capturedAt ?? null,
  }));
}

const chunk = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, (i + 1) * n));

// deno-lint-ignore no-explicit-any
async function upsertRecords(supabase: any, records: RegisterRecord[]): Promise<number> {
  let written = 0;
  for (const batch of chunk(records, 500)) {
    const { error } = await supabase
      .from('market_sales_medians')
      .upsert(batch, { onConflict: 'state,area_kind,area,dwelling_type,period,period_span' });
    if (error) throw new Error(`market_sales_medians upsert failed: ${error.message}`);
    written += batch.length;
  }
  return written;
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'method_not_allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { error: authError } = await verifyAuth(supabase, req.headers, body);
  if (authError) return createUnauthorizedResponse(authError, corsHeaders);

  const stage = String(body.stage ?? '');
  const loadedAt = new Date().toISOString();

  try {
    if (stage === 'probe') {
      const answers: Record<string, unknown> = {};
      for (const [label, url] of [['qgso_page', QGSO_RLDA_PAGE_URL], ['dcj_page', NSW_DCJ_PAGE_URL], ['dcj_previous', NSW_DCJ_PREVIOUS_URL]] as const) {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } });
          const text = await res.text();
          const extra = label === 'qgso_page'
            ? { spreadsheet: discoverQgsoRldaSpreadsheet(text) }
            : { salesTables: dcjSalesLinks(text).length };
          answers[label] = { status: res.status, bytes: text.length, ...extra };
        } catch (error) {
          answers[label] = { status: null, error: error instanceof Error ? error.message : String(error) };
        }
      }
      // The archive and the ABS: what the other three stages read.
      try {
        const vic = await archiveIndex(VIC_VPSR_ARCHIVE_PATTERN, '2024');
        const newest = newestByRank(vic, VIC_TIME_SERIES_FILE, (m) => Number(m[3]));
        answers.wayback_vic = { captures: vic.length, newest_time_series: newest ? { file: fileNameOf(newest.capture.original), captured_at: capturedAtIso(newest.capture.timestamp) } : null };
      } catch (error) {
        answers.wayback_vic = { error: error instanceof Error ? error.message : String(error) };
      }
      try {
        const sa = await archiveIndex(SA_LSG_ARCHIVE_PATTERN);
        const files = rankedCaptures(sa, SA_LSG_FILE, (_m, c) => rankOfSaFileName(fileNameOf(c.original)));
        answers.wayback_sa = { captures: sa.length, files: files.length, newest: files[0] ? { file: fileNameOf(files[0].capture.original), captured_at: capturedAtIso(files[0].capture.timestamp) } : null };
      } catch (error) {
        answers.wayback_sa = { error: error instanceof Error ? error.message : String(error) };
      }
      try {
        const res = await fetch(ABS_RES_DWELL_URL.replace('/data/', '/dataflow/').replace(/\/all\?.*$/, ''), { headers: { 'User-Agent': UA, Accept: 'application/xml,*/*' } });
        answers.abs = { status: res.status, bytes: (await res.text()).length };
      } catch (error) {
        answers.abs = { status: null, error: error instanceof Error ? error.message : String(error) };
      }
      return json({ success: true, stage, answers, wrote: false });
    }

    if (stage === 'abs') {
      const res = await fetch(ABS_RES_DWELL_URL, { headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' } });
      if (!res.ok) throw new Error(`${ABS_RES_DWELL_URL} answered ${res.status}`);
      const text = await res.text();
      const parsed = parseAbsResDwell(text); // throws → nothing written
      const records = toRecords(parsed.rows, ABS_RES_DWELL_SOURCE_LABEL, ABS_RES_DWELL_URL, ABS_RES_DWELL_LICENCE, loadedAt);
      const written = await upsertRecords(supabase, records);
      const detail = {
        stage, file: ABS_RES_DWELL_URL, bytes: text.length, source: ABS_RES_DWELL_SOURCE_LABEL, licence: ABS_RES_DWELL_LICENCE,
        periods: parsed.periods.length, first_period: parsed.periods[0], latest_period: parsed.latestPeriod,
        states: parsed.states, preliminary_periods: parsed.preliminaryPeriods, revised_periods: parsed.revisedPeriods,
        rows_written: written,
      };
      await supabase.from('market_sales_sync').insert({ detail });
      return json({ success: true, ...detail });
    }

    if (stage === 'vic') {
      const which = String(body.which ?? 'houses_ts');
      const all = ['houses_ts', 'units_ts', 'quarter_house', 'quarter_unit'];
      if (!all.includes(which)) return json({ success: false, error: `which must be one of ${all.join(', ')}` }, 400);
      const index = await archiveIndex(VIC_VPSR_ARCHIVE_PATTERN, '2024');
      const wantDwelling = which === 'houses_ts' || which === 'quarter_house' ? 'house' : 'attached';
      const chosen = which.endsWith('_ts')
        ? newestByRank(index, VIC_TIME_SERIES_FILE, (m) => (dwellingOfTimeSeriesName(m[0]) === wantDwelling ? Number(m[3]) : null))
        : newestByRank(index, VIC_QUARTERLY_FILE, (m) => (dwellingOfQuarterlyName(m[0]) === wantDwelling ? Number(m[3]) * 4 + Number(m[2]) : null));
      if (!chosen) throw new Error(`the archive's index of land.vic.gov.au lists no ${which} file — refused`);
      const capturedAt = capturedAtIso(chosen.capture.timestamp);
      const url = originalBytesUrl(chosen.capture);
      console.log(`[market-sales-ingest] vic ${which}: ${fileNameOf(chosen.capture.original)} captured ${capturedAt}`);
      const { workbook, bytes } = await fetchWorkbook(url);
      const grid = firstGrid(workbook);
      const parsed = which.endsWith('_ts')
        ? parseVicTimeSeries(grid, wantDwelling, capturedAt)
        : parseVicQuarterly(grid, wantDwelling, capturedAt);
      const records = toRecords(parsed.rows, VIC_VPSR_SOURCE_LABEL, archivePageUrl(chosen.capture), VIC_VPSR_LICENCE, loadedAt);
      const written = await upsertRecords(supabase, records);
      const detail = {
        stage, which, file: chosen.capture.original, archive: archivePageUrl(chosen.capture), captured_at: capturedAt, bytes,
        source: VIC_VPSR_SOURCE_LABEL, licence: VIC_VPSR_LICENCE,
        ...('years' in parsed ? { years: parsed.years } : { periods: parsed.periods, latest_period: parsed.latestPeriod }),
        localities: parsed.localities, rows_written: written,
        // A publisher's typo is nulled on its row and named here, never
        // silently dropped and never a reason to refuse the file.
        implausible_cells: parsed.implausible.length, implausible: parsed.implausible.slice(0, 10),
        remaining: all.filter((w) => w !== which),
      };
      await supabase.from('market_sales_sync').insert({ detail });
      return json({ success: true, ...detail });
    }

    if (stage === 'sa') {
      // A date floor keeps the question light enough to be answered while the
      // index is shedding load: measured 16 Sep 2026, the Victorian query
      // (floor 2024) was served in the same minute this one, unfloored and
      // four times the bytes, was refused twice. It loses nothing: every one
      // of the 41 named workbooks was re-captured by the archive's crawl of
      // 5 Apr 2023 or later (the oldest, lsgstats-2015q1.xlsx, on that day).
      // The floor is FIXED at that crawl, never relative to today — a rolling
      // floor would one day slide past 2023 and drop every file the publisher
      // has not touched since.
      const index = await archiveIndex(SA_LSG_ARCHIVE_PATTERN, SA_LSG_ARCHIVE_FLOOR);
      const files = rankedFiles(index, SA_LSG_FILE, (_m, c) => rankOfSaFileName(fileNameOf(c.original)));
      if (!files.length) throw new Error("the archive's index of data.sa.gov.au lists no lsg_stats workbook — refused");
      const periodOfRank = (rank: number): string => `${Math.floor((rank - 1) / 4)}-${['03', '06', '09', '12'][(rank - 1) % 4]}`;
      const rankOfPeriod = (period: string): number => Number(period.slice(0, 4)) * 4 + ['03', '06', '09', '12'].indexOf(period.slice(5)) + 1;
      const loaded: Array<Record<string, unknown>> = [];
      let written = 0;
      // One file: its captures newest first, until one serves and parses. The
      // index can list a capture the store answers 404 for (the newest
      // workbook's only capture, 16 Sep 2026), and an older copy of the same
      // file is the same publication.
      const loadFile = async (f: RankedFile<number>): Promise<boolean> => {
        const attempts: string[] = [];
        for (const capture of f.captures) {
          const capturedAt = capturedAtIso(capture.timestamp);
          try {
            console.log(`[market-sales-ingest] sa: ${fileNameOf(f.original)} (${periodOfRank(f.rank)}) captured ${capturedAt}`);
            const { workbook, bytes } = await fetchWorkbook(originalBytesUrl(capture));
            const parsed = parseSaLsgStats(firstGrid(workbook), capturedAt);
            const records = toRecords(parsed.rows, SA_LSG_SOURCE_LABEL, archivePageUrl(capture), SA_LSG_LICENCE, loadedAt);
            const n = await upsertRecords(supabase, records);
            written += n;
            loaded.push({
              file: f.original, captured_at: capturedAt, bytes, periods: parsed.periods, suburbs: parsed.suburbs,
              split_suburbs: parsed.splitSuburbs.length, rows_written: n,
              ...(attempts.length ? { earlier_captures_refused: attempts } : {}),
            });
            return true;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[market-sales-ingest] sa: ${fileNameOf(f.original)} capture ${capturedAt} refused — ${message}`);
            attempts.push(`${capturedAt}: ${message}`);
          }
        }
        loaded.push({ file: f.original, refused: attempts });
        return false;
      };
      if (Array.isArray(body.periods)) {
        const ranks = new Set((body.periods as unknown[]).map((p) => rankOfPeriod(String(p))));
        for (const f of files.filter((x) => ranks.has(x.rank))) await loadFile(f);
      } else {
        // The newest quarter that LOADS (it also carries the year-earlier
        // quarter), then the files three, five and ten years before it — the
        // growth horizons. A newest file nothing can serve is recorded and the
        // next newest anchors instead, so the register is as current as the
        // archive can make it rather than as current as its index claims.
        let anchor: RankedFile<number> | null = null;
        for (const f of files.slice(0, 4)) {
          if (await loadFile(f)) { anchor = f; break; }
        }
        if (anchor) {
          const horizons = [3, 5, 10].map((y) => anchor!.rank - y * 4);
          for (const f of files.filter((x) => horizons.includes(x.rank))) await loadFile(f);
        }
      }
      const detail = {
        stage, source: SA_LSG_SOURCE_LABEL, licence: SA_LSG_LICENCE, files_indexed: files.length,
        newest_file: fileNameOf(files[0].original), newest_period: periodOfRank(files[0].rank),
        files: loaded, rows_written: written,
      };
      await supabase.from('market_sales_sync').insert({ detail });
      if (written === 0) return json({ success: false, error: 'no South Australian workbook loaded', ...detail }, 422);
      return json({ success: true, ...detail });
    }

    if (stage === 'qld') {
      const page = await fetchText(QGSO_RLDA_PAGE_URL);
      const link = discoverQgsoRldaSpreadsheet(page);
      if (!link) throw new Error('the QGSO residential development page lists no "all monitored regions" spreadsheet — refused');
      console.log(`[market-sales-ingest] qld: downloading ${link.url} (as at ${link.asAt})`);
      const { workbook, bytes } = await fetchWorkbook(link.url);
      const sheets: Record<string, Grid> = {};
      for (const spec of QGSO_SALES_SHEETS) {
        const grid = gridOf(workbook, spec.name);
        if (grid) sheets[spec.name] = grid;
      }
      const parsed = parseQgsoRldaSales(sheets); // throws → nothing written
      const records = toRecords(parsed.rows, QGSO_RLDA_SOURCE_LABEL, link.url, QGSO_RLDA_LICENCE, loadedAt);
      const written = await upsertRecords(supabase, records);
      const detail = {
        stage, file: link.url, as_at: link.asAt, bytes, source: QGSO_RLDA_SOURCE_LABEL, licence: QGSO_RLDA_LICENCE,
        periods: parsed.periods.length, first_period: parsed.periods[0], latest_period: parsed.latestPeriod,
        lgas: parsed.lgas.length, regions: parsed.regions, rows_written: written,
      };
      await supabase.from('market_sales_sync').insert({ detail });
      return json({ success: true, ...detail });
    }

    if (stage === 'nsw') {
      const current = await fetchText(NSW_DCJ_PAGE_URL);
      let previous = '';
      try {
        previous = await fetchText(NSW_DCJ_PREVIOUS_URL);
      } catch (error) {
        console.warn('[market-sales-ingest] nsw: previous-reports page unavailable —', error instanceof Error ? error.message : String(error));
      }
      const links = dcjSalesLinks(current + previous);
      const choice = chooseDcjSalesFiles(links);
      if (!choice) throw new Error('the DCJ rent and sales pages list no sales tables — refused');
      // One workbook per invocation: five in one call exhausted the worker's
      // compute allowance. Without `periods`, the newest quarter loads and the
      // response names the horizon quarters still to ask for.
      const wanted = Array.isArray(body.periods)
        ? links.filter((l) => (body.periods as unknown[]).includes(l.period))
        : choice.chosen.slice(0, 1);
      const files: Array<Record<string, unknown>> = [];
      let written = 0;
      for (const link of wanted) {
        try {
          console.log(`[market-sales-ingest] nsw: downloading ${link.url} (${link.period})`);
          const { workbook, bytes } = await fetchWorkbook(link.url);
          const postcode = gridOf(workbook, 'Postcode');
          const lga = gridOf(workbook, 'LGA');
          if (!postcode || !lga) throw new Error(`${link.url}: workbook has no Postcode/LGA sheets (sheets: ${workbook.SheetNames.join(', ')}) — layout drift`);
          const parsed = parseDcjSalesWorkbook({ postcode, lga }, link.period);
          const records = toRecords(parsed.rows, NSW_DCJ_SOURCE_LABEL, link.url, NSW_DCJ_LICENCE, loadedAt);
          const n = await upsertRecords(supabase, records);
          written += n;
          files.push({ period: link.period, url: link.url, bytes, postcodes: parsed.postcodes, lgas: parsed.lgas, rows_written: n, reporting_period: parsed.reportingPeriodText });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[market-sales-ingest] nsw: ${link.period} refused — ${message}`);
          files.push({ period: link.period, url: link.url, refused: message });
        }
      }
      const detail = {
        stage, source: NSW_DCJ_SOURCE_LABEL, licence: NSW_DCJ_LICENCE, links_listed: links.length,
        latest_period: choice.latest.period, horizons: choice.horizons.map((h) => ({ years: h.years, period: h.period, available: h.link !== null })),
        files, rows_written: written,
        remaining: choice.chosen.map((l) => l.period).filter((p) => !wanted.some((w) => w.period === p)),
      };
      await supabase.from('market_sales_sync').insert({ detail });
      if (written === 0) return json({ success: false, error: 'no DCJ workbook loaded', ...detail }, 422);
      return json({ success: true, ...detail });
    }

    return json({ success: false, error: 'stage must be "qld", "nsw", "abs", "vic", "sa" or "probe"' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[market-sales-ingest] ${stage} refused/failed:`, message);
    try {
      await supabase.from('market_sales_sync').insert({ detail: { stage, refused: message } });
    } catch { /* the refusal is already in the log */ }
    if (REFUSAL.test(message)) return json({ success: false, error: message }, 422);
    return json({ success: false, ...internalError(error, 'market-sales-ingest') }, 500);
  }
});
