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
  ABS_BA_DATAFLOW_CATALOGUE_URL,
  absBuildingApprovalsUrl,
  dataflowRef,
  resolveBuildingApprovalsFlow,
  surveyConstructionFlows,
  ABS_BA_LICENCE,
  ABS_BA_SOURCE_LABEL,
  parseAbsBuildingApprovals,
  type ApprovalRow,
} from '../_shared/reports/market/openData/absBuildingApprovals.pure.ts';
import {
  absDataStructureUrl,
  composeApprovalsKey,
  narrowedApprovalsUrl,
  parseDataStructure,
  type ComposedKey,
} from '../_shared/reports/market/openData/absDataStructure.pure.ts';
import {
  approvalsPage,
  pagesToCover,
  planApprovalsWork,
} from '../_shared/reports/market/openData/absApprovalsPaging.pure.ts';

/**
 * How far back the supply register is loaded.
 *
 * Two years is what a year-on-year reading needs
 * (`ABS_BA_PLAUSIBILITY.minPeriods`) and `approvalsFactBlocks` reports on
 * twelve months against the twelve before them. Three years leaves a margin
 * for a publisher's revision without asking for a decade nobody reads.
 */
const REGISTER_FLOOR_PERIOD = '2023-01';
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
  VIC_VPSR_PAGE_URL,
} from '../_shared/reports/market/openData/vicVpsrSuburb.pure.ts';
import {
  chooseNextVicQuarter,
  chooseNextVicVolumeFile,
  mergeVicQuarterSources,
  quartersStillNeeded,
} from '../_shared/reports/market/openData/vicVolumeBackfill.pure.ts';
import {
  VIC_CKAN_SEARCH_URL,
  newestCatalogueQuarter,
  parseVicCatalogue,
  vicQuarterlyMedianResources,
} from '../_shared/reports/market/openData/vicVpsrCatalogue.pure.ts';
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

/**
 * A load never ERASES a sales count it cannot restate.
 *
 * Victoria's and South Australia's sheets print ONE `No. of Sales` column —
 * the latest quarter's — so their parsers emit `salesCount: null` on every
 * other row of the series. New South Wales' and Queensland's carry a count on
 * every row. The upsert sent `sales_count` for every record and PostgREST
 * writes `ON CONFLICT DO UPDATE SET` for each column in the payload, so each
 * daily run rewrote every historical Victorian and South Australian row's
 * count back to null.
 *
 * `scoreTransactionVolume` needs `VOLUME_BASELINE_PERIODS + 1` — four periods
 * carrying a count — to measure a quarter against this market's own trailing
 * rate. Victoria and South Australia could therefore hold at most ONE at any
 * moment, so transaction volume was structurally unmeasurable for every
 * property in those two states: the 9 Hollow Street Compass of 20 Sep 2026
 * scored Demand on nothing at all while 1 Crestview Avenue and 97 Poole Road,
 * both New South Wales, scored it 27 from `162 sales … 29% below the
 * 3-period average of 228`. That is a defect of this loader, not a fact about
 * Bendigo.
 *
 * So a record carrying no count is written WITHOUT the column, which leaves
 * whatever is stored standing. The two shapes cannot share a batch —
 * PostgREST builds one statement per request and sets every column the
 * payload names — so they are partitioned and sent separately.
 *
 * The conservative side is deliberate. A publisher that genuinely withdraws a
 * figure is rare and a later load carrying a real value corrects it; a loader
 * that erases a measurement it never had anything to say about is the fault
 * `listings_cache` already paid for, where mirroring a prune put the whole
 * marketplace on a thirty-day fuse.
 */
// deno-lint-ignore no-explicit-any
async function upsertRecords(supabase: any, records: RegisterRecord[]): Promise<number> {
  const CONFLICT = 'state,area_kind,area,dwelling_type,period,period_span';
  let written = 0;
  const withCount = records.filter((r) => r.sales_count !== null);
  const withoutCount = records
    .filter((r) => r.sales_count === null)
    // The column is DROPPED from the payload, which is what leaves the
    // stored value standing — PostgREST sets only the columns it is given.
    .map(({ sales_count: _dropped, ...rest }) => rest);

  for (const [rows, label] of [[withCount, 'with count'], [withoutCount, 'no count']] as const) {
    for (const batch of chunk(rows as Record<string, unknown>[], 500)) {
      if (!batch.length) continue;
      const { error } = await supabase
        .from('market_sales_medians')
        .upsert(batch, { onConflict: CONFLICT });
      if (error) throw new Error(`market_sales_medians upsert failed (${label}): ${error.message}`);
      written += batch.length;
    }
  }
  return written;
}

/**
 * The approvals register's own writer.
 *
 * Separate from `upsertRecords` rather than generalised with it, because the
 * two tables carry different keys and different absences and a shared writer
 * would have to branch on both. The one rule they share is the one that
 * matters: **a column the publisher released nothing for is dropped from the
 * payload rather than sent as null**, so a re-run cannot overwrite a figure
 * the ABS published earlier with the silence of a later, partial release.
 * That is `market-sales-ingest`'s own lesson — sending `sales_count` on every
 * record rewrote every historical count back to NULL on every daily run, and
 * `scoreTransactionVolume` needs four periods carrying one.
 */
async function upsertApprovals(
  supabase: any,
  rows: ReadonlyArray<ApprovalRow>,
  sourceUrl: string,
  loadedAt: string,
): Promise<number> {
  const CONFLICT = 'area_kind,area_code,period,building_type';
  const base = rows.map((r) => ({
    area_kind: r.areaKind,
    area_code: r.areaCode,
    area: r.area,
    area_token: r.areaToken,
    state: r.state,
    period: r.period,
    building_type: r.buildingType,
    dwelling_units: r.dwellingUnits,
    value_aud: r.value,
    source: ABS_BA_SOURCE_LABEL,
    source_url: sourceUrl,
    licence: ABS_BA_LICENCE,
    loaded_at: loadedAt,
  }));
  // Four shapes, because either measure may be absent independently and a
  // null in the payload is a WRITE of null.
  const shape = (units: boolean, value: boolean) => base
    .filter((r) => (r.dwelling_units !== null) === units && (r.value_aud !== null) === value)
    .map((r) => {
      const out: Record<string, unknown> = { ...r };
      if (!units) delete out.dwelling_units;
      if (!value) delete out.value_aud;
      return out;
    });

  let written = 0;
  for (const [rowsOfShape, label] of [
    [shape(true, true), 'units+value'],
    [shape(true, false), 'units only'],
    [shape(false, true), 'value only'],
    [shape(false, false), 'neither'],
  ] as const) {
    for (const batch of chunk(rowsOfShape as Record<string, unknown>[], 500)) {
      if (!batch.length) continue;
      const { error } = await supabase
        .from('market_building_approvals')
        .upsert(batch, { onConflict: CONFLICT });
      if (error) throw new Error(`market_building_approvals upsert failed (${label}): ${error.message}`);
      written += batch.length;
    }
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
      /*
       * Building approvals: reachability and DISCOVERY, and nothing else.
       *
       * Read-only by construction — it asks the ABS for its own dataflow
       * catalogue, runs the selection over it, and reports which flow would
       * be read and which candidates were rejected. It writes nothing, needs
       * no table and touches no schedule, which is the point: the register
       * itself is held for approval, and this is what answers whether it can
       * work at all BEFORE anybody approves a table for it.
       *
       * `absBuildingApprovals.pure.ts` cannot be verified against the ABS from
       * a development egress — neither `data.api.abs.gov.au` nor
       * `www.abs.gov.au` answers it — so every test behind it runs on
       * synthetic SDMX-CSV written to the published standard's shape. This
       * stage is the one that measures the real thing, and it is the same
       * rule the retention purge and the verification self-test answer to:
       * asserted by effect, never by configuration.
       */
      try {
        const res = await fetch(ABS_BA_DATAFLOW_CATALOGUE_URL, {
          headers: { 'User-Agent': UA, Accept: 'application/vnd.sdmx.structure+json;version=1.0,application/xml,*/*' },
        });
        const text = await res.text();
        const answer: Record<string, unknown> = {
          status: res.status,
          bytes: text.length,
          content_type: res.headers.get('content-type'),
        };
        if (res.ok) {
          try {
            const choice = resolveBuildingApprovalsFlow(text, typeof body.dataflow === 'string' ? body.dataflow : null);
            answer.flow = dataflowRef(choice.flow);
            answer.flow_name = choice.flow.name;
            answer.area_kind = choice.areaKind;
            answer.geography_score = choice.geographyScore;
            answer.how = choice.how;
            answer.catalogued_flows = choice.cataloguedFlows;
            answer.candidates = choice.candidates;
            answer.data_url = absBuildingApprovalsUrl(choice.flow, '2018-01');
          } catch (error) {
            // A refusal is the finding, not a crash: it names what the
            // catalogue held and why nothing in it was selected.
            answer.refused = error instanceof Error ? error.message : String(error);
          }
          try {
            /*
             * What else the ABS publishes that bears on construction in an
             * area, and at what grain. Reported, never selected on.
             *
             * `INFRASTRUCTURE_COVERAGE_LIMITS` tells every reader that this
             * platform reaches neither council capital works nor budget
             * infrastructure programmes, and those are the scheduled projects
             * a reader most wants named. Residential approvals are dwelling
             * supply and say nothing about a hospital, a school or a road.
             * This turns "could we also read scheduled infrastructure?" into
             * a measurement from production rather than a recollection of
             * what the Bureau publishes.
             */
            answer.construction_survey = surveyConstructionFlows(text);
          } catch (error) {
            // A refusal is the finding, not a crash: it names what the
            // catalogue held and why nothing in it was selected.
            answer.refused = error instanceof Error ? error.message : String(error);
          }
        }
        answers.abs_building_approvals = answer;
      } catch (error) {
        answers.abs_building_approvals = {
          status: null,
          error: error instanceof Error ? error.message : String(error),
        };
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

    if (stage === 'approvals') {
      /*
       * The dataflow is DISCOVERED, then read. Two calls, and the first one
       * is what makes the second safe: the version is part of an SDMX
       * identifier, the ABS reissues it, and a constant nobody here can
       * verify fetches a 404 that reads exactly like an outage.
       */
      const catalogueRes = await fetch(ABS_BA_DATAFLOW_CATALOGUE_URL, {
        headers: { 'User-Agent': UA, Accept: 'application/vnd.sdmx.structure+json;version=1.0,application/xml,*/*' },
      });
      if (!catalogueRes.ok) throw new Error(`${ABS_BA_DATAFLOW_CATALOGUE_URL} answered ${catalogueRes.status}`);
      const catalogue = await catalogueRes.text();
      // Throws, naming what it saw, on an unparseable catalogue, on nothing
      // matching, and on a tie inside the chosen grain. Nothing is written.
      const choice = resolveBuildingApprovalsFlow(
        catalogue,
        typeof body.dataflow === 'string' ? body.dataflow : null,
      );
      const startPeriod = typeof body.startPeriod === 'string' ? body.startPeriod : '2018-01';

      /*
       * The query is NARROWED at the source, from the publisher's own data
       * structure. Measured from CI on 21 Sep 2026: `/all` at SA2 grain is
       * past 5 GB and still running after sixty seconds, and ONE month of LGA
       * data is 61.8 MB — because the download is the whole cube (every
       * building type including hotels, factories and offices, every measure,
       * all three series estimates) of which this loader keeps Original
       * estimates of three residential types on two measures.
       *
       * Shrinking the period cannot shrink a cube that is wide rather than
       * long, so the lever is the key. It is composed from the structure the
       * ABS publishes rather than typed, for the reason the dataflow is
       * discovered rather than named: an SDMX key is POSITIONAL, and one
       * written against the wrong positions returns a plausible, wrong slice
       * under an HTTP 200.
       *
       * A structure that cannot be read costs nothing — the fallback is
       * `/all`, which is what shipped, so this can only improve a load or
       * leave it alone.
       */
      let keyNarrowing: ComposedKey = { key: 'all', narrowed: [], unnarrowed: [] };
      try {
        const dsdRes = await fetch(absDataStructureUrl(choice.flow), {
          headers: { 'User-Agent': UA, Accept: 'application/vnd.sdmx.structure+json;version=1.0,application/xml,*/*' },
        });
        if (!dsdRes.ok) throw new Error(`answered ${dsdRes.status}`);
        keyNarrowing = composeApprovalsKey(parseDataStructure(await dsdRes.text()));
      } catch (error) {
        keyNarrowing = {
          key: 'all',
          narrowed: [],
          unnarrowed: [{
            dimension: '(the whole structure)',
            reason: error instanceof Error ? error.message : String(error),
          }],
        };
      }
      /*
       * ONE PAGE per invocation, newest first.
       *
       * Measured from CI on 21 Sep 2026: at SA2 grain with the query
       * narrowed, 33 months is 111.6 MB and 12 months is 26.0 MB against a
       * 24 MB budget, while 6 months is 12.2 MB. So a full load is several
       * requests — the shape this loader has used since five DCJ workbooks
       * in one call exhausted an edge worker's compute allowance.
       *
       * The FRONTIER is read from the register rather than assumed. The ABS
       * publishes with a lag (a six-month window asked on 21 Sep returned
       * four months, to 2026-07), so page 0 asks forward and whatever comes
       * back defines it; every later page lies wholly in the past and must be
       * full. The loader learns the lag from the publisher instead of
       * carrying a constant nobody here can verify.
       */
      const asOf = typeof body.asOf === 'string' ? body.asOf : new Date().toISOString().slice(0, 7);
      /*
       * BOTH edges of the register, because the walk derives its own window
       * from them. `pageIndex` stepped back from the frontier by an index
       * nobody ever supplied — the cron posts no `page`, so every run asked
       * page 0, which asks FORWARD, and the register never deepened past one
       * window. See `planApprovalsWork`.
       */
      const { data: frontierRow } = await supabase
        .from('market_building_approvals')
        .select('period, loaded_at')
        .eq('area_kind', choice.areaKind)
        .order('period', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: oldestRow } = await supabase
        .from('market_building_approvals')
        .select('period')
        .eq('area_kind', choice.areaKind)
        .order('period', { ascending: true })
        .limit(1)
        .maybeSingle();
      const frontier = typeof frontierRow?.period === 'string' ? frontierRow.period : null;
      const oldest = typeof oldestRow?.period === 'string' ? oldestRow.period : null;
      const frontierLoadedAt = typeof frontierRow?.loaded_at === 'string'
        ? frontierRow.loaded_at.slice(0, 7)
        : null;

      /*
       * An operator naming a page keeps the old arithmetic; everything else
       * — every scheduled run — plans its own work. That is what makes the
       * register converge on a cadence rather than on somebody's bookkeeping.
       */
      const explicitPage = Number.isInteger(body.page) ? Number(body.page) : null;
      const planned = explicitPage === null
        ? planApprovalsWork({ frontier, oldest, asOf, floor: REGISTER_FLOOR_PERIOD, frontierLoadedAt })
        : null;
      const pageIndex = explicitPage ?? 0;
      const page = explicitPage === null
        ? {
          index: 0,
          startPeriod: planned!.startPeriod ?? asOf,
          endPeriod: planned!.endPeriod ?? asOf,
          minPeriods: planned!.minPeriods,
        }
        : approvalsPage(explicitPage, asOf, frontier);

      /*
       * Nothing owed: current to the frontier and complete to the floor. The
       * publisher is asked NOTHING — a settled run is one table read, which
       * is what makes a frequent schedule free rather than wasteful.
       */
      if (planned?.kind === 'settled' && typeof body.startPeriod !== 'string') {
        const detail = {
          stage,
          settled: true,
          flow: dataflowRef(choice.flow),
          frontier,
          oldest,
          register_floor: REGISTER_FLOOR_PERIOD,
          windows_remaining: 0,
          because: planned.because,
        };
        await supabase.from('market_sales_sync').insert({ detail });
        return json({ success: true, ...detail });
      }

      // An explicit window from an operator overrides the page arithmetic,
      // and carries no floor: they are asking for exactly what they named.
      const explicitStart = typeof body.startPeriod === 'string' ? body.startPeriod : null;
      const window = explicitStart
        ? { startPeriod: explicitStart, endPeriod: typeof body.endPeriod === 'string' ? body.endPeriod : undefined, minPeriods: null }
        : { startPeriod: page.startPeriod, endPeriod: page.endPeriod, minPeriods: page.minPeriods };

      const url = keyNarrowing.key === 'all'
        ? absBuildingApprovalsUrl(choice.flow, window.startPeriod)
        : narrowedApprovalsUrl(choice.flow, window.startPeriod, keyNarrowing.key, window.endPeriod);
      console.log(
        `[market-sales-ingest] approvals: ${dataflowRef(choice.flow)} key=${keyNarrowing.key} `
        + `page=${pageIndex} ${window.startPeriod}→${window.endPeriod ?? 'open'} frontier=${frontier ?? 'none'}`,
      );

      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/csv,*/*' } });
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      const text = await res.text();
      /*
       * Throws on a reshaped, truncated or unit-drifted answer, so a partial
       * register is never written as though it were whole — and a PAGE is
       * judged against the window it asked for. The register's own 24-month
       * floor is a question about the table after a full load, not about one
       * request of six months.
       */
      const parsed = parseAbsBuildingApprovals(text, choice.areaKind, {
        minPeriods: window.minPeriods ?? 0,
      });
      const written = await upsertApprovals(supabase, parsed.rows, url, loadedAt);

      const detail = {
        stage,
        file: url,
        bytes: text.length,
        source: ABS_BA_SOURCE_LABEL,
        licence: ABS_BA_LICENCE,
        // How the flow was arrived at, and what lost — so an operator can see
        // the decision rather than only its result.
        flow: dataflowRef(choice.flow),
        flow_name: choice.flow.name,
        how: choice.how,
        catalogued_flows: choice.cataloguedFlows,
        candidates: choice.candidates,
        area_kind: choice.areaKind,
        geography_score: choice.geographyScore,
        // How much of the cube was asked for, and what could not be narrowed.
        // An unnarrowed dimension is a silently BIGGER download, so it is
        // reported rather than left to be inferred from the byte count.
        key: keyNarrowing.key,
        key_narrowed: keyNarrowing.narrowed,
        key_unnarrowed: keyNarrowing.unnarrowed,
        // What the download itself turned out to be.
        columns: parsed.columns,
        series_type_unfiltered: parsed.seriesTypeUnfiltered,
        areas: parsed.areas,
        // Which grains the body turned out to carry. A region download is the
        // whole hierarchy, so this is how an operator sees that one LGA read
        // also filled the state and national rungs.
        areas_by_grain: parsed.areasByGrain,
        periods: parsed.periods.length,
        first_period: parsed.periods[0],
        latest_period: parsed.latestPeriod,
        states: parsed.states,
        rows_skipped: parsed.skipped,
        rows_written: written,
        // Which page this was, and what a full load still needs — so an
        // operator reads what remains rather than working it out.
        page: pageIndex,
        // What the register asked itself for, and why — so an operator reads
        // the decision rather than only its result.
        work: planned?.kind ?? 'operator_page',
        because: planned?.because ?? `operator named page ${pageIndex}`,
        oldest_before: oldest,
        page_window: `${window.startPeriod}→${window.endPeriod ?? 'open'}`,
        page_judged_against: window.minPeriods,
        frontier_before: frontier,
        pages_remaining: planned
          ? planned.windowsRemaining
          : Math.max(0, pagesToCover(parsed.latestPeriod, REGISTER_FLOOR_PERIOD) - (pageIndex + 1)),
        register_floor: REGISTER_FLOOR_PERIOD,
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

    /*
     * Victoria's transaction volumes, one archived quarter per invocation.
     *
     * Why this exists at all is in `vicVolumeBackfill.pure.ts`: Victoria
     * prints ONE `No. of Sales` column per workbook, so a single file yields
     * one counted period and `scoreTransactionVolume` needs four — which is
     * why Demand is unscoreable here and scores in NSW, QLD and SA. The
     * publisher names a separate workbook per quarter and the archive holds
     * them, so the counts were never lost.
     *
     * It ASKS by default and writes nothing. `apply: true` reads exactly one
     * workbook, because five in one call is what hit the edge worker's
     * compute limit on the DCJ load.
     */
    /*
     * Where Victoria's CURRENT figures are, and whether they can be had live.
     *
     * Measured 21 Sep 2026: the register's newest Victorian period is
     * `2025-12` on both spans while Queensland is current to 2026-09-10 and
     * South Australia's `lsg_stats_2026_q1.xlsx` was captured 2026-09-18. The
     * archive plainly carries 2026 files; Victoria is the only stale source,
     * so the 2026 editions are published somewhere this pipeline is not
     * looking.
     *
     * Three questions, asked rather than assumed, and NOTHING is written:
     *
     *  1. Does the publisher still answer a non-browser client? The archive
     *     route exists because it did not — `zeroCostSources` records a
     *     Cloudflare "Just a moment..." 403 — and that is a measurement with
     *     a date on it, not a permanent property of the internet.
     *  2. What file names does the archive actually hold under that path? The
     *     loader only ever asked for names matching the 2025 spelling, so a
     *     renamed 2026 edition would be invisible to it and present all along.
     *  3. Is the same series on `data.vic.gov.au`? It is a CKAN portal with a
     *     JSON API and its resources are served from hosts that do not sit
     *     behind the same challenge — which is what a LIVE route would look
     *     like.
     */
    if (stage === 'vic_discover') {
      const answers: Record<string, unknown> = {};
      const spreadsheetLinks = (html: string): string[] => [
        ...new Set([...html.matchAll(/href="([^"]+\.xlsx?)"/gi)].map((m) => m[1])),
      ].slice(0, 40);

      // 1. The publisher itself.
      try {
        const res = await fetch(VIC_VPSR_PAGE_URL, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } });
        const text = await res.text();
        answers.publisher_page = {
          status: res.status,
          bytes: text.length,
          challenged: /just a moment|cf-browser-verification|challenge-platform/i.test(text),
          opening: text.slice(0, 160).replace(/\s+/g, ' '),
          spreadsheets: spreadsheetLinks(text),
        };
      } catch (error) {
        answers.publisher_page = { error: error instanceof Error ? error.message : String(error) };
      }

      // 2. Every name the archive holds under that path — unfiltered, because
      //    filtering by the old spelling is what made a rename invisible.
      try {
        const index = await archiveIndex(VIC_VPSR_ARCHIVE_PATTERN, String(body.from ?? '2025'));
        const byName = new Map<string, string>();
        for (const c of index) {
          const name = fileNameOf(c.original);
          const prev = byName.get(name);
          if (!prev || c.timestamp > prev) byName.set(name, c.timestamp);
        }
        const names = [...byName.entries()]
          .sort((a, b) => (a[1] < b[1] ? 1 : -1))
          .slice(0, 60)
          .map(([name, ts]) => ({ name, newest_capture: capturedAtIso(ts) }));
        answers.archive = { captures: index.length, distinct_files: byName.size, newest_first: names };
      } catch (error) {
        answers.archive = { error: error instanceof Error ? error.message : String(error) };
      }

      // 3. The open-data portal — the candidate live route.
      for (const [label, url] of [
        ['ckan_search', 'https://discover.data.vic.gov.au/api/3/action/package_search?q=%22property%20sales%22&rows=10'],
      ] as const) {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,*/*' } });
          const text = await res.text();
          let parsed: Record<string, unknown> | null = null;
          try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { /* reported by shape */ }
          const result = (parsed?.result ?? {}) as Record<string, unknown>;
          const packages = Array.isArray(result.results) ? result.results as Array<Record<string, unknown>> : [];
          answers[label] = {
            status: res.status,
            bytes: text.length,
            count: result.count ?? null,
            datasets: packages.slice(0, 8).map((pkg) => ({
              title: pkg.title,
              name: pkg.name,
              resources: (Array.isArray(pkg.resources) ? pkg.resources as Array<Record<string, unknown>> : [])
                .filter((r) => /xlsx?|csv/i.test(String(r.format ?? '')))
                .slice(0, 6)
                .map((r) => ({ format: r.format, name: r.name, url: r.url, last_modified: r.last_modified })),
            })),
          };
        } catch (error) {
          answers[label] = { error: error instanceof Error ? error.message : String(error) };
        }
      }

      console.log(`[market-sales-ingest] vic_discover ${JSON.stringify(answers).slice(0, 1200)}`);
      return json({ success: true, stage, answers, wrote: false });
    }

    if (stage === 'vic_volume') {
      const apply = body.apply === true;
      const wantDwelling = String(body.dwelling ?? 'house') === 'unit' ? 'attached' : 'house';
      const floor = String(body.floor ?? '2023-01');
      const from = String(body.from ?? '2023');

      // What the register already carries a Victorian count for. This drives
      // the choice, so an interrupted backfill resumes and a finished one is
      // a no-op — no cursor is kept anywhere.
      const { data: countedRows, error: countedError } = await supabase
        .from('market_sales_medians')
        .select('period')
        .eq('state', 'VIC')
        .eq('dwelling_type', wantDwelling)
        .eq('period_span', 'quarter')
        .not('sales_count', 'is', null);
      if (countedError) throw new Error(`reading the counted Victorian quarters failed: ${countedError.message}`);
      const countedPeriods: string[] = [...new Set<string>(
        ((countedRows ?? []) as Array<{ period: string }>).map((r) => String(r.period)),
      )];

      /*
       * BOTH sources, asked together.
       *
       * The catalogue is the publisher's own index and answers a script; the
       * archive holds the bytes the publisher will not serve one. Neither
       * contains the other — the catalogue lists
       * `Median-House-VGS-1st-Qtr-2024.xls`, a spelling the filename pattern
       * cannot match, and the archive holds captures the catalogue never
       * listed — so a union finds more quarters than either alone and a
       * failure of one is not a failure of the walk.
       *
       * The catalogue also answers the question a regex cannot: what the
       * NEWEST released quarter is. "No file I recognise" and "no file" are
       * different statements, and only the publisher can make the second.
       */
      let catalogue: Awaited<ReturnType<typeof vicQuarterlyMedianResources>> = [];
      let catalogueNewest: string | null = null;
      let catalogueError: string | null = null;
      try {
        const res = await fetch(VIC_CKAN_SEARCH_URL, { headers: { 'User-Agent': UA, Accept: 'application/json,*/*' } });
        if (!res.ok) throw new Error(`the Victorian data catalogue answered ${res.status}`);
        const all = parseVicCatalogue(await res.json());
        catalogue = vicQuarterlyMedianResources(all, wantDwelling);
        catalogueNewest = newestCatalogueQuarter(catalogue);
      } catch (error) {
        // Named, never swallowed: a catalogue that could not be reached is not
        // a publisher with nothing to publish, and the archive still answers.
        catalogueError = error instanceof Error ? error.message : String(error);
      }

      let index: WaybackCapture[] = [];
      let archiveError: string | null = null;
      try {
        index = await archiveIndex(VIC_VPSR_ARCHIVE_PATTERN, from);
      } catch (error) {
        archiveError = error instanceof Error ? error.message : String(error);
      }
      const files = rankedFiles(index, VIC_QUARTERLY_FILE,
        (m) => (dwellingOfQuarterlyName(m[0]) === wantDwelling ? Number(m[3]) * 4 + Number(m[2]) : null));
      if (catalogueError && archiveError) {
        throw new Error(`neither source could be reached — catalogue: ${catalogueError}; archive: ${archiveError}`);
      }
      const merged = mergeVicQuarterSources(catalogue, files, floor);
      /*
       * `skip` steps over a quarter the parser refuses, and `period` names one
       * outright. Both exist because selection is "newest uncounted" and a
       * refusal leaves the quarter uncounted — so without them one unparseable
       * workbook stalls the whole backfill for ever, re-reading the same file
       * on every call. Measured: q3-2025 refused with "no row of quarter
       * labels (layout drift)" on the first live load.
       */
      const skip = Array.isArray(body.skip) ? (body.skip as unknown[]).map(String) : [];
      const only = body.period ? String(body.period) : null;
      const choice = chooseNextVicVolumeFile(
        files,
        [...countedPeriods, ...skip, ...(only ? [] : [])],
        floor,
      );
      const targeted = only
        ? choice.remaining.find((c) => c.period === only)
          ?? chooseNextVicVolumeFile(files, [], floor).remaining.find((c) => c.period === only)
          ?? null
        : choice.next;
      const shortfall = quartersStillNeeded(countedPeriods);

      const mergedChoice = chooseNextVicQuarter(merged, [...countedPeriods, ...skip]);
      const base = {
        stage, dwelling: wantDwelling, floor,
        counted_quarters: countedPeriods.sort().reverse(),
        quarters_still_needed_for_demand: shortfall,
        // What the PUBLISHER has released, which is the only honest answer to
        // "is this current as at today" — and is not the same question as what
        // the register holds.
        publisher_newest_quarter: catalogueNewest,
        register_is_current_with_publisher: catalogueNewest
          ? countedPeriods.includes(catalogueNewest) || countedPeriods.some((p) => p >= catalogueNewest)
          : null,
        sources: {
          catalogue: catalogueError ? { error: catalogueError } : { quarters: catalogue.length },
          archive: archiveError ? { error: archiveError } : { quarters: files.length },
        },
        discovered_quarters: merged.map((c) => ({ period: c.period, by: c.discoveredBy })),
        merged_remaining: mergedChoice.remaining.map((c) => c.period),
        archived_quarters: files.length,
        remaining: choice.remaining.map((c) => c.period),
        next: targeted?.period ?? null,
        skipped: skip,
      };

      if (!apply || !targeted) {
        return json({ success: true, ...base, wrote: false });
      }

      const file = files.find((f) => f.original === targeted.original);
      if (!file) throw new Error(`the chosen quarter ${targeted.period} is not in the archive listing — refused`);
      // Every capture of that file, newest first: the index can list a capture
      // the store answers 404 for, which is why `rankedFiles` keeps them all.
      let loaded: { capturedAt: string; bytes: number; grid: unknown[][]; sheets: string[] } | null = null;
      let lastError = '';
      for (const capture of file.captures.slice(0, 4)) {
        try {
          const { workbook, bytes } = await fetchWorkbook(originalBytesUrl(capture));
          loaded = {
            capturedAt: capturedAtIso(capture.timestamp), bytes,
            grid: firstGrid(workbook) as unknown[][],
            sheets: (workbook.SheetNames ?? []) as string[],
          };
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
      if (!loaded) throw new Error(`no capture of ${fileNameOf(file.original)} could be read — ${lastError}`);

      /*
       * `inspect` describes what arrived and parses nothing. The first live
       * load refused on layout drift, and "which sheet is first, and what is
       * in its opening rows" is not answerable from here — web.archive.org
       * answers 403 at this machine's CONNECT tunnel. Asserted by looking,
       * rather than by guessing at a publisher's spreadsheet.
       */
      if (body.inspect === true) {
        const head = (loaded.grid as unknown[][]).slice(0, 8)
          .map((row) => (row ?? []).slice(0, 12).map((v) => String(v ?? '').slice(0, 24)));
        return json({
          success: true, ...base, wrote: false, inspected: targeted.period,
          file: file.original, captured_at: loaded.capturedAt, bytes: loaded.bytes,
          sheets: loaded.sheets, rows: (loaded.grid as unknown[][]).length, head,
        });
      }

      const parsed = parseVicQuarterly(loaded.grid as never, wantDwelling, loaded.capturedAt);
      // ONLY the counted rows are written. The medians in an archived workbook
      // are a revision of periods the live stage already loads, and this
      // backfill is not the authority on those — it is here for the counts
      // the live stage cannot reach.
      const counted = parsed.rows.filter((r) => typeof r.salesCount === 'number');
      if (counted.length === 0) {
        throw new Error(`${fileNameOf(file.original)} parsed ${parsed.rows.length} rows and none carries a count — refused`);
      }
      /*
       * A backfill may add a count and must never regress a figure the live
       * stage already holds.
       *
       * This is not hypothetical. Measured 21 Sep 2026 from the two archived
       * workbooks: for ABBOTSFORD, quarter 2025-09, `median-house-q3-2025`
       * reports 1,370,000 and `median-house-q4-2025` reports 1,391,500. The
       * later file carries the publisher's own revision, the live stage
       * already loaded it, and an unguarded upsert of the older workbook would
       * quietly put the superseded number back — on every suburb, for every
       * quarter this walks.
       *
       * So the count is added and NOTHING else is: a row that already exists
       * is written back with its stored median, provenance and capture stamp
       * untouched and only `sales_count` changed, and a full record is written
       * only where no row exists at all — where there is nothing to regress
       * and this file is the only source there is.
       */
      const records = toRecords(counted, VIC_VPSR_SOURCE_LABEL, archivePageUrl(file.captures[0]), VIC_VPSR_LICENCE, loadedAt);
      const { data: liveRows, error: liveError } = await supabase
        .from('market_sales_medians')
        .select('area_token, median_price, sales_count, source, source_url, licence, captured_at, price_measure, loaded_at')
        .eq('state', 'VIC')
        .eq('dwelling_type', wantDwelling)
        .eq('period_span', 'quarter')
        .eq('period', parsed.latestPeriod);
      if (liveError) throw new Error(`reading the live Victorian rows for ${parsed.latestPeriod} failed: ${liveError.message}`);
      const live = new Map(
        ((liveRows ?? []) as Array<Record<string, unknown>>).map((r) => [String(r.area_token), r]),
      );

      const fresh = records.filter((r) => !live.has(r.area_token));
      const preserved = records
        .filter((r) => live.has(r.area_token))
        .map((r) => {
          const held = live.get(r.area_token)!;
          return {
            state: r.state, area_kind: r.area_kind, area: r.area, area_token: r.area_token,
            dwelling_type: r.dwelling_type, period: r.period, period_span: r.period_span,
            // Everything the live stage owns, handed straight back.
            median_price: held.median_price, source: held.source, source_url: held.source_url,
            licence: held.licence, captured_at: held.captured_at,
            price_measure: held.price_measure, loaded_at: held.loaded_at,
            // The one thing this backfill is for.
            sales_count: r.sales_count,
          };
        });

      const written = (fresh.length ? await upsertRecords(supabase, fresh) : 0)
        + (preserved.length ? await upsertRecords(supabase, preserved as never) : 0);

      const detail = {
        ...base,
        file: file.original, captured_at: loaded.capturedAt, bytes: loaded.bytes,
        source: VIC_VPSR_SOURCE_LABEL, licence: VIC_VPSR_LICENCE,
        parsed_period: parsed.latestPeriod, localities: parsed.localities,
        counted_rows: counted.length, rows_written: written,
        rows_new: fresh.length, rows_count_added_without_touching_medians: preserved.length,
        implausible_cells: parsed.implausible.length,
        remaining: choice.remaining.filter((c) => c.period !== targeted.period).map((c) => c.period),
      };
      await supabase.from('market_sales_sync').insert({ detail });
      return json({ success: true, ...detail, wrote: true });
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

    // The list is the branches above, and it is written out because this is
    // what a caller sees when it names a stage that does not exist. It went
    // stale the moment `vic_volume` was added and answered a 400 that read as
    // a rejected argument rather than as a deployment that had not landed yet.
    return json({
      success: false,
      error: 'stage must be "qld", "nsw", "abs", "approvals", "vic", "vic_volume", "vic_discover", "sa" or "probe"',
    }, 400);
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
