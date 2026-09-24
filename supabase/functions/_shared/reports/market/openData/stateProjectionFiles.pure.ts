/**
 * Each jurisdiction's own projection workbook, and the parser written
 * against it.
 *
 * ── Written against what CI printed, never against memory ─────────────────
 *
 * Every layout below is the one `state-projection-liveness` described from CI
 * on 23 Sep 2026 (run 35827597400, job 107072665157; Queensland's in run
 * 35833636513): the sheet names, the row the header sits on, where the
 * publisher states which years are history and which are projected, and which
 * rows are totals rather than areas. Where a fact about a file is not in that
 * output it is not assumed here — it is read from the workbook at load time
 * and the load REFUSES if the workbook does not say it. A parser that guesses
 * a layout loads a plausible wrong table, and a projection table is read by a
 * client as a statement about their suburb.
 *
 * ── The base year is the publisher's statement, never an inference ───────
 *
 * A projection opens on the population it starts from, which is an estimate —
 * a measurement — and printing that under a forward heading as projected is
 * the worst failure this register can commit. So each parser reads the base
 * from where its publisher states it:
 *
 *  - NSW says it on the sheet itself: *"Historic (2001-2021) and projected
 *    (2022-2041)"*. The last historic year is the base; the historic years
 *    before it are not loaded, because they are estimates and not the
 *    projection.
 *  - Victoria in Future says it in its Explanatory Notes: the projections
 *    start from *"the Estimated Resident Population (ERP) as at 30 June
 *    2022"*. The table prints 2021, 2026, 2031 and 2036, so 2021 is the
 *    newest estimate it prints and everything after the stated jump-off is
 *    projected.
 *  - Queensland's Statistician says it on each workbook's Main page: *"2021
 *    data are final estimated resident population (ERP)."*, and prints that
 *    year as `2021 (b)` — the footnote the statement hangs on. The parser
 *    takes the base from the sentence and requires the header to print it.
 *  - Tasmania's Treasury does not print the sentence, and its components table
 *    states it structurally: the first interval is `2023-2028` and its
 *    start-of-interval population is the base. The parser reads the base from
 *    there and then CHECKS the Totals sheet's figure for that year against the
 *    components table's, area by area — the two tables are the publisher's own
 *    and must agree, or the column was misread.
 *
 * ── Every series is loaded, none defaulted ───────────────────────────────
 *
 * Tasmania publishes Medium, High and Low in three files, and all three are
 * here: loading one would be the choice `choices[0]` made for the ABS.
 * Queensland publishes all three for its councils in one file, a sheet each,
 * and the medium series alone for its SA2s — so the SA2 rows are the medium
 * series and say so, and the council rows carry all three. NSW publishes its
 * high and low series for the state as a whole only, so its SA2 and LGA files
 * carry the one series its own file name calls **main**. Victoria in Future
 * publishes one series, named by its edition (`VIF2023`).
 *
 * ── What is refused ──────────────────────────────────────────────────────
 *
 * A missing statement of the base, an edition the workbook does not name, a
 * header with fewer years than the statement promises, and a parse that names
 * fewer areas than the file measured (a truncated read looks exactly like a
 * smaller state). Rows the parser declines — a state total, a row with no
 * code — are counted and named in `declined`, never dropped silently.
 *
 * Deno-compatible: explicit `.ts` extensions, no `@/` aliases. Pure.
 */
import type { ProjectionAreaKind } from './projectionRegister.pure.ts';
import { projectionAreaToken, type ProjectionLoadRow } from './projectionLoad.pure.ts';
import type { ProjectionState } from './stateProjectionPublishers.pure.ts';
import { cellText, headText, type Grid, type GridCell } from './xlsxSheet.pure.ts';

export type ProjectionFileKey = 'nsw_sa2' | 'nsw_lga' | 'vic_lga' | 'tas_medium' | 'tas_high' | 'tas_low' | 'qld_sa2' | 'qld_lga';

export interface ProjectionParse {
  rows: ProjectionLoadRow[];
  release: string;
  series: string[];
  base: number | null;
  horizon: number;
  areas: number;
  /** Rows the parser read and declined to load, with the reason — never dropped silently. */
  declined: string[];
}

export interface ProjectionFile {
  key: ProjectionFileKey;
  state: ProjectionState;
  /** The publishing body, as the page will name it. */
  publisher: string;
  /** The publisher's own URL for the workbook. */
  url: string;
  /** The sheets the parser reads; nothing else in the workbook is inflated. */
  sheets: readonly string[];
  /**
   * The licence the PUBLISHER states for this file, as read, or null where no
   * licence has been read that this platform has accepted — terms not yet
   * read, or read and turning on a decision not yet made. A null refuses the
   * load: readable is not republishable, and a projection table goes into a
   * client's PDF.
   */
  licence: string | null;
  /** Where the licence was read — or what was read and why it is not accepted — so the claim can be checked again. */
  licenceEvidence: string;
  /** The fewest areas a complete read of this file names — below it, the read was cut short. */
  minAreas: number;
  parse(grids: Readonly<Record<string, Grid>>, sourceUrl: string, licence: string): ProjectionParse;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared readers
// ─────────────────────────────────────────────────────────────────────────────

const yearOf = (v: GridCell | undefined): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d{4}\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : null;
};

const numberOf = (v: GridCell | undefined): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};

export interface YearHeader {
  row: number;
  /** Year → column, in the sheet's own order. */
  years: Array<{ col: number; year: number }>;
}

/**
 * The first row where `labelled(row)` holds and at least `minYears` year cells
 * follow `fromCol` — the row a projection table's columns are named on.
 */
export function findYearHeader(grid: Grid, labelled: (row: GridCell[]) => boolean, fromCol: number, minYears = 3): YearHeader | null {
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row || !labelled(row)) continue;
    const years: Array<{ col: number; year: number }> = [];
    for (let c = fromCol; c < row.length; c++) {
      const y = yearOf(row[c]);
      if (y !== null) years.push({ col: c, year: y });
    }
    if (years.length >= minYears) return { row: r, years };
  }
  return null;
}

/** The whole text of a sheet — every non-empty cell, one per line. */
export function sheetText(grid: Grid): string {
  return headText(grid, grid.length);
}

interface Statement { historicTo: number; projectedFrom: number; projectedTo: number }

/** NSW's own sentence: "Historic (2001-2021) and projected (2022-2041) …". */
export function readHistoricProjected(text: string): Statement | null {
  const m = /historic\s*\(\s*(\d{4})\s*[-–]\s*(\d{4})\s*\)[\s\S]{0,40}?projected\s*\(\s*(\d{4})\s*[-–]\s*(\d{4})\s*\)/i.exec(text);
  if (!m) return null;
  return { historicTo: Number(m[2]), projectedFrom: Number(m[3]), projectedTo: Number(m[4]) };
}

/** Victoria in Future's own sentence: the base is "the Estimated Resident Population (ERP) as at 30 June 2022". */
export function readJumpOffYear(text: string): number | null {
  const m = /Estimated Resident Population\s*\(ERP\)\s*as at 30 June\s*(\d{4})/i.exec(text);
  return m ? Number(m[1]) : null;
}

/** Tasmania's components table: the first interval's start (`2023-2028` → 2023). */
export function readFirstInterval(grid: Grid): number | null {
  for (const row of grid.slice(0, 12)) {
    for (const c of row ?? []) {
      const m = /^\s*(\d{4})\s*[-–]\s*(\d{4})\s*$/.exec(cellText(c));
      if (m && Number(m[2]) > Number(m[1])) return Number(m[1]);
    }
  }
  return null;
}

interface RowSpec {
  state: ProjectionState;
  release: string;
  series: string;
  areaKind: ProjectionAreaKind;
  publisher: string;
  sourceUrl: string;
  licence: string;
}

/** The rows one area contributes: its base (where the file prints one) and every projected year. */
function rowsForArea(
  spec: RowSpec,
  area: { name: string; code: string; token: string },
  values: ReadonlyMap<number, number>,
  base: number | null,
  projected: readonly number[],
): ProjectionLoadRow[] {
  const out: ProjectionLoadRow[] = [];
  const push = (year: number, kind: 'base' | 'projected') => {
    const v = values.get(year);
    if (v === undefined) return; // absent, never zero
    out.push({
      state: spec.state, release: spec.release, series: spec.series, measure: 'persons',
      area_kind: spec.areaKind, area_code: area.code, area: area.name, area_token: area.token,
      year, year_kind: kind, value: v,
      publisher: spec.publisher, source_url: spec.sourceUrl, licence: spec.licence,
    });
  };
  if (base !== null) push(base, 'base');
  for (const y of projected) push(y, 'projected');
  return out;
}

function valuesOf(row: GridCell[], header: YearHeader): Map<number, number> {
  const out = new Map<number, number>();
  for (const { col, year } of header.years) {
    const v = numberOf(row[col]);
    if (v !== null) out.set(year, v);
  }
  return out;
}

function refuse(file: string, why: string): never {
  throw new Error(`${file}: ${why} — refused`);
}

// ─────────────────────────────────────────────────────────────────────────────
// New South Wales — 2024 NSW Population Projections (SA2 and LGA workbooks)
// ─────────────────────────────────────────────────────────────────────────────

const NSW_PUBLISHER = 'the NSW Department of Planning, Housing and Infrastructure';
/** State-wide rows a NSW table may carry; they are not areas of the grain. */
const NSW_TOTAL = /^(new south wales|nsw|total\b|greater sydney|rest of nsw|regional nsw)/i;

/** The edition's own name, from the Notes sheet ("2024 NSW Population Projections"). */
function nswRelease(notes: Grid, file: string): string {
  for (const line of sheetText(notes).split('\n')) {
    if (/^\d{4} NSW Population Projections$/.test(line)) return line;
  }
  refuse(file, 'the Notes sheet does not name the edition ("YYYY NSW Population Projections")');
}

/** Collapsed SA2 → the ASGS 2021 SA2s it combines, from the publisher's own table. */
export function nswCollapsedSa2s(grid: Grid, file: string): Map<string, string[]> {
  const header = grid.findIndex((row) => /^collapsed sa2$/i.test(cellText(row?.[0])) && /^sa2_name_2021$/i.test(cellText(row?.[1])));
  if (header < 0) refuse(file, 'the "Collapsed SA2s" sheet has no "Collapsed SA2 | SA2_NAME_2021" header');
  const out = new Map<string, string[]>();
  for (let r = header + 1; r < grid.length; r++) {
    const collapsed = cellText(grid[r]?.[0]);
    const member = cellText(grid[r]?.[1]);
    if (collapsed === '' || member === '') continue;
    out.set(collapsed, [...(out.get(collapsed) ?? []), member]);
  }
  if (out.size === 0) refuse(file, 'the "Collapsed SA2s" sheet lists no collapsed area');
  return out;
}

function parseNsw(
  grids: Readonly<Record<string, Grid>>, sourceUrl: string, licence: string,
  opts: { file: ProjectionFileKey; label: RegExp; areaKind: 'sa2' | 'lga' },
): ProjectionParse {
  const table = grids['Total population'];
  const release = nswRelease(grids['Notes'], opts.file);
  const header = findYearHeader(table, (row) => opts.label.test(cellText(row[0])), 1, 10);
  if (!header) refuse(opts.file, `the "Total population" sheet has no year header labelled ${opts.label}`);
  const statement = readHistoricProjected(headText(table, header.row));
  if (!statement) refuse(opts.file, 'the sheet no longer states which years are historic and which projected');
  if (statement.projectedFrom !== statement.historicTo + 1) {
    refuse(opts.file, `the statement leaves a gap between history (to ${statement.historicTo}) and projection (from ${statement.projectedFrom})`);
  }
  const printed = new Set(header.years.map((y) => y.year));
  const projected = header.years.map((y) => y.year).filter((y) => y >= statement.projectedFrom && y <= statement.projectedTo);
  if (!printed.has(statement.historicTo) || !printed.has(statement.projectedTo)) {
    refuse(opts.file, `the header does not print the base ${statement.historicTo} and the horizon ${statement.projectedTo} its own statement names`);
  }

  const collapsed = opts.areaKind === 'sa2' ? nswCollapsedSa2s(grids['Collapsed SA2s'], opts.file) : new Map<string, string[]>();
  const spec: RowSpec = {
    state: 'NSW', release, series: 'Main series', areaKind: opts.areaKind,
    publisher: NSW_PUBLISHER, sourceUrl, licence,
  };
  const rows: ProjectionLoadRow[] = [];
  const declined: string[] = [];
  const seenCollapsed = new Set<string>();
  let areas = 0;
  for (let r = header.row + 1; r < table.length; r++) {
    const row = table[r];
    const name = cellText(row?.[0]);
    if (!row || name === '') continue;
    if (NSW_TOTAL.test(name)) { declined.push(`${name} (a total, not an area)`); continue; }
    const values = valuesOf(row, header);
    if (values.size === 0) { declined.push(`${name} (no figures)`); continue; }
    areas += 1;
    const members = collapsed.get(name);
    if (members) {
      seenCollapsed.add(name);
      // One row set per ASGS SA2 the collapsed area combines, each naming the
      // area the figure actually describes — the reader asks by the property's
      // own SA2, and must be answered with the area the publisher projected.
      for (const member of members) {
        const token = projectionAreaToken('sa2', member);
        rows.push(...rowsForArea(spec, { name, code: token, token }, values, statement.historicTo, projected));
      }
      continue;
    }
    const token = projectionAreaToken(opts.areaKind, name);
    rows.push(...rowsForArea(spec, { name, code: token, token }, values, statement.historicTo, projected));
  }
  const unmatched = [...collapsed.keys()].filter((c) => !seenCollapsed.has(c));
  if (unmatched.length > 0) {
    refuse(opts.file, `the collapsed-SA2 table names ${unmatched.slice(0, 3).map((u) => JSON.stringify(u)).join(', ')}, which the population table does not hold`);
  }
  return {
    rows, release, series: [spec.series], base: statement.historicTo, horizon: Math.max(...projected), areas, declined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Victoria — Victoria in Future 2023, LGA workbook
// ─────────────────────────────────────────────────────────────────────────────

const VIC_PUBLISHER = 'the Victorian Department of Transport and Planning';

function parseVic(grids: Readonly<Record<string, Grid>>, sourceUrl: string, licence: string): ProjectionParse {
  const file: ProjectionFileKey = 'vic_lga';
  const contents = sheetText(grids['Contents']).split('\n');
  const title = contents.find((l) => /^Victoria in Future\b/i.test(l));
  const month = contents.find((l) => /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/.test(l));
  const edition = /\b(VIF\d{4})_/.exec(contents.join('\n'))?.[1];
  if (!title || !month || !edition) refuse(file, 'the Contents sheet does not name the edition, its date and its file');
  const release = `${title}, ${month}`;

  const jumpOff = readJumpOffYear(sheetText(grids['Explanatory Notes']));
  if (jumpOff === null) refuse(file, 'the Explanatory Notes no longer state the base Estimated Resident Population year');

  const table = grids['Total_Population'];
  const header = findYearHeader(table, (row) => /^lga code$/i.test(cellText(row[0])) && /^lga$/i.test(cellText(row[1])), 2, 3);
  if (!header) refuse(file, 'the "Total_Population" sheet has no "LGA code | LGA | years" header');
  const estimates = header.years.map((y) => y.year).filter((y) => y <= jumpOff);
  const base = estimates.length > 0 ? Math.max(...estimates) : null;
  const projected = header.years.map((y) => y.year).filter((y) => y > jumpOff);
  if (projected.length === 0) refuse(file, `no printed year follows the stated base of ${jumpOff}`);

  const spec: RowSpec = {
    state: 'VIC', release, series: edition, areaKind: 'lga', publisher: VIC_PUBLISHER, sourceUrl, licence,
  };
  const rows: ProjectionLoadRow[] = [];
  const declined: string[] = [];
  let areas = 0;
  for (let r = header.row + 1; r < table.length; r++) {
    const row = table[r];
    if (!row) continue;
    const code = cellText(row[0]);
    const name = cellText(row[1]);
    if (name === '' && code === '') continue;
    // The state total sits in the table with no code; an LGA always has one.
    if (!/^\d{5}$/.test(code)) { declined.push(`${name || '(unnamed)'} (no LGA code — a total, not an area)`); continue; }
    const values = valuesOf(row, header);
    if (values.size === 0) { declined.push(`${name} (no figures)`); continue; }
    areas += 1;
    rows.push(...rowsForArea(spec, { name, code, token: projectionAreaToken('lga', name) }, values, base, projected));
  }
  return { rows, release, series: [edition], base, horizon: Math.max(...projected), areas, declined };
}

// ─────────────────────────────────────────────────────────────────────────────
// Queensland — the Government Statistician's regions tables, 2021 to 2046
// ─────────────────────────────────────────────────────────────────────────────

const QLD_PUBLISHER = 'the Queensland Government Statistician’s Office';
/** The state's own row, where a table prints one — never an area of the grain. */
const QLD_TOTAL = /^(queensland\b|total\b|qld\b)/i;
/** A table's own title names its series: "Projected population (medium series), …". */
const QLD_SERIES = /\((low|medium|high)[ -]series\b/i;

/**
 * A Queensland header year. The base column is printed `2021 (b)` — the year
 * and the footnote the publisher hangs its statement on — so a reader that
 * took only a bare year would skip exactly the column that says where the
 * projection starts.
 */
export function qldYearOf(v: GridCell | undefined): number | null {
  if (typeof v === 'number') return yearOf(v);
  const m = /^(\d{4})(\s*\([a-z]\))?$/i.exec(cellText(v));
  return m ? yearOf(Number(m[1])) : null;
}

/**
 * The first row, in the first twelve, that carries a run of at least
 * `minYears` consecutive, strictly increasing year cells at or after
 * `fromCol` — and ONLY that run. The SA2 sheet declares 125 columns around
 * the twelve CI saw printed, and a second block of years further along (a
 * change, a growth rate) must never be read as persons: the run ends at the
 * first cell that is not a later year.
 */
export function qldYearHeader(grid: Grid, fromCol: number, minYears: number): YearHeader | null {
  for (let r = 0; r < Math.min(grid.length, 12); r++) {
    const row = grid[r] ?? [];
    let c = fromCol;
    while (c < row.length && qldYearOf(row[c]) === null) c++;
    const years: Array<{ col: number; year: number }> = [];
    for (; c < row.length; c++) {
      const y = qldYearOf(row[c]);
      if (y === null || (years.length > 0 && y <= years[years.length - 1].year)) break;
      years.push({ col: c, year: y });
    }
    if (years.length >= minYears) return { row: r, years };
  }
  return null;
}

/** The measure is printed under the first year (`— persons —`); a table that says anything else is a different table. */
function qldMeasureIsPersons(grid: Grid, header: YearHeader): boolean {
  const col = header.years[0].col;
  return [header.row + 1, header.row + 2].some((r) => /^\W*persons\W*$/i.test(cellText(grid[r]?.[col])));
}

interface QldMainPage {
  release: string;
  /** The year the publisher states its data are final estimates for — the base. */
  base: number;
  /** "Boundaries are based on …", verbatim, or null where the page states none. */
  boundaries: string | null;
}

/**
 * What the workbook's Main page states: the edition, and which year's data
 * are FINAL ESTIMATES (*"2021 data are final estimated resident population
 * (ERP)."*) — the population the projection starts from. Refused where it
 * states neither: the base is the publisher's word, never an inference from
 * which column comes first.
 */
export function qldMainPage(grid: Grid | undefined, file: ProjectionFileKey): QldMainPage {
  const lines = sheetText(grid ?? []).split('\n');
  const release = lines.find((l) => /^Queensland Government\b.*\bprojections?\b/i.test(l));
  if (!release) refuse(file, 'the Main page does not name the edition ("Queensland Government … projections")');
  const stated = lines.map((l) => /^(\d{4}) data are final estimate/i.exec(l)).find((m) => m !== null);
  if (!stated) refuse(file, 'the Main page no longer states which year\'s data are final estimates, so the base is unknown');
  const boundaries = lines.find((l) => /^Boundaries are based on\b/i.test(l)) ?? null;
  return { release, base: Number(stated[1]), boundaries };
}

/** A table's series, from its own title — `(medium series)` → `Medium series`. */
function qldSeriesOf(title: string, file: ProjectionFileKey, sheet: string): string {
  const m = QLD_SERIES.exec(title);
  if (!m) refuse(file, `the "${sheet}" sheet's title does not name its series (${JSON.stringify(title.slice(0, 90))})`);
  return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} series`;
}

/**
 * The publisher's own state total, where the table prints one, against the
 * areas read. A total read as an area, or a region read as one, adds its
 * whole population a second time; an area skipped takes its own away. The
 * base year is an estimate printed in whole persons, so the areas must add to
 * the total within half a person each.
 */
function qldCheckTotal(file: ProjectionFileKey, sheet: string, base: number, areas: number, sum: number, total: number | null): void {
  if (total === null) return;
  if (Math.abs(sum - total) > Math.max(1, areas * 0.5)) {
    refuse(file, `the ${areas} areas on "${sheet}" add to ${Math.round(sum).toLocaleString('en-AU')} for ${base}, and the publisher's `
      + `own Queensland total is ${Math.round(total).toLocaleString('en-AU')} — a total was read as an area, or an area was missed`);
  }
}

const totalLine = (sheet: string, label: string, base: number, total: number | undefined) =>
  `${label} on "${sheet}" (the state, not an area${total !== undefined ? ` — the ${base} total, ${Math.round(total).toLocaleString('en-AU')}, the areas were checked against` : ''})`;

/**
 * The SA2 file. Rows are keyed by the publisher's ASGS 2021 SA2 CODE, which is
 * the first rung the reader asks by, so the Main page must say its boundaries
 * are the 2021 edition the platform resolves a coordinate against: the same
 * nine digits under another edition can describe a different area.
 */
function parseQldSa2(grids: Readonly<Record<string, Grid>>, sourceUrl: string, licence: string): ProjectionParse {
  const file: ProjectionFileKey = 'qld_sa2';
  const sheet = 'Data';
  const main = qldMainPage(grids['Main page'], file);
  if (!main.boundaries || !/\b2021\b|\bedition 3\b/i.test(main.boundaries)) {
    refuse(file, 'the Main page does not state that its boundaries are the ASGS 2021 edition the reader resolves SA2s against '
      + `(${JSON.stringify((main.boundaries ?? 'no statement').slice(0, 120))})`);
  }
  const table = grids[sheet];
  const series = qldSeriesOf(cellText(table?.[0]?.[0]), file, sheet);

  let labelRow = -1;
  for (let r = 0; r < Math.min(table.length, 12) && labelRow < 0; r++) {
    if ((table[r] ?? []).some((c) => /^SA2 code\b/i.test(cellText(c)))) labelRow = r;
  }
  if (labelRow < 0) refuse(file, `the "${sheet}" sheet has no "SA2 code" column heading`);
  const labels = table[labelRow];
  const codeCol = labels.findIndex((c) => /^SA2 code\b/i.test(cellText(c)));
  const nameCol = labels.findIndex((c) => /^SA2\b(?!\s*code)/i.test(cellText(c)));
  if (nameCol < 0) refuse(file, `the "${sheet}" sheet names no SA2 column beside its SA2 code`);

  const header = qldYearHeader(table, Math.max(codeCol, nameCol) + 1, 5);
  if (!header) refuse(file, `the "${sheet}" sheet has no row of years after its SA2 columns`);
  if (!qldMeasureIsPersons(table, header)) refuse(file, `the "${sheet}" sheet does not print "persons" under its first year`);
  if (!header.years.some((y) => y.year === main.base)) {
    refuse(file, `the "${sheet}" sheet does not print ${main.base}, the year the Main page states its final estimates for`);
  }
  const projected = header.years.map((y) => y.year).filter((y) => y > main.base);
  if (projected.length === 0) refuse(file, `no printed year follows the stated base ${main.base}`);

  const spec: RowSpec = {
    state: 'QLD', release: main.release, series, areaKind: 'sa2', publisher: QLD_PUBLISHER, sourceUrl, licence,
  };
  const rows: ProjectionLoadRow[] = [];
  const declined: string[] = [];
  const codes = new Set<string>();
  let areas = 0;
  let sum = 0;
  let total: number | null = null;
  for (let r = Math.max(header.row, labelRow) + 1; r < table.length; r++) {
    const row = table[r];
    if (!row) continue;
    const code = cellText(row[codeCol]);
    const name = cellText(row[nameCol]);
    const label = row.slice(0, nameCol + 1).map(cellText).find((t) => t !== '') ?? '(unnamed)';
    const values = valuesOf(row, header);
    if (values.size === 0) {
      // A note, a heading or a blank line carries no figure and is no row of
      // the table; an SA2 that carries none is an area declined, by name.
      if (/^\d{9}$/.test(code)) declined.push(`${name || code} (no figures)`);
      continue;
    }
    if (!/^3\d{8}$/.test(code)) {
      if (QLD_TOTAL.test(label) && total === null) {
        total = values.get(main.base) ?? null;
        declined.push(totalLine(sheet, label, main.base, values.get(main.base)));
      } else {
        declined.push(`${label} (no Queensland SA2 code — a total, not an area)`);
      }
      continue;
    }
    if (name === '') refuse(file, `SA2 ${code} carries figures and no name`);
    if (codes.has(code)) refuse(file, `SA2 ${code} is printed twice`);
    codes.add(code);
    areas += 1;
    sum += values.get(main.base) ?? 0;
    rows.push(...rowsForArea(spec, { name, code, token: projectionAreaToken('sa2', name) }, values, main.base, projected));
  }
  qldCheckTotal(file, sheet, main.base, areas, sum, total);
  return { rows, release: main.release, series: [series], base: main.base, horizon: Math.max(...projected), areas, declined };
}

/** The LGA file's three series, one sheet each, named by the sheet and by its own title. */
const QLD_LGA_SHEETS = ['Medium series', 'Low series', 'High series'] as const;

/**
 * The LGA file: three series over the same councils. The base is an
 * ESTIMATE, so it is the same figure in every series — a council whose base
 * differs between two sheets was read from the wrong column or the wrong row,
 * and the file is refused rather than loaded with one series misaligned.
 */
function parseQldLga(grids: Readonly<Record<string, Grid>>, sourceUrl: string, licence: string): ProjectionParse {
  const file: ProjectionFileKey = 'qld_lga';
  const main = qldMainPage(grids['Main page'], file);
  const rows: ProjectionLoadRow[] = [];
  const declined: string[] = [];
  const seriesRead: string[] = [];
  const councilsBySeries = new Map<string, number>();
  const baseByCouncil = new Map<string, { value: number; series: string }>();
  let horizon = 0;

  for (const sheet of QLD_LGA_SHEETS) {
    const table = grids[sheet];
    const series = qldSeriesOf(cellText(table?.[0]?.[0]), file, sheet);
    if (series !== sheet) {
      refuse(file, `the "${sheet}" sheet is titled ${JSON.stringify(cellText(table[0][0]).slice(0, 90))} — the sheet and its own title name different series`);
    }
    const header = qldYearHeader(table, 1, 5);
    if (!header) refuse(file, `the "${sheet}" sheet has no row of years`);
    if (!table.slice(0, header.row + 1).some((row) => /^Local Government Area\b/i.test(cellText(row?.[0])))) {
      refuse(file, `the "${sheet}" sheet does not head its first column "Local Government Area"`);
    }
    if (!qldMeasureIsPersons(table, header)) refuse(file, `the "${sheet}" sheet does not print "persons" under its first year`);
    if (!header.years.some((y) => y.year === main.base)) {
      refuse(file, `the "${sheet}" sheet does not print ${main.base}, the year the Main page states its final estimates for`);
    }
    const projected = header.years.map((y) => y.year).filter((y) => y > main.base);
    if (projected.length === 0) refuse(file, `no printed year on "${sheet}" follows the stated base ${main.base}`);

    const spec: RowSpec = {
      state: 'QLD', release: main.release, series, areaKind: 'lga', publisher: QLD_PUBLISHER, sourceUrl, licence,
    };
    let councils = 0;
    let sum = 0;
    let total: number | null = null;
    for (let r = header.row + 1; r < table.length; r++) {
      const row = table[r];
      if (!row) continue;
      const name = cellText(row[0]);
      const values = valuesOf(row, header);
      if (values.size === 0) continue; // a note, a heading or a blank line: no figure, no row of the table
      if (name === '') refuse(file, `row ${r + 1} of "${sheet}" carries figures and no council`);
      if (QLD_TOTAL.test(name)) {
        if (total === null) total = values.get(main.base) ?? null;
        declined.push(totalLine(sheet, name, main.base, values.get(main.base)));
        continue;
      }
      const base = values.get(main.base);
      if (base === undefined) refuse(file, `${name} on "${sheet}" prints no ${main.base} estimate`);
      const seen = baseByCouncil.get(name);
      if (seen && Math.abs(seen.value - base) > 0.5) {
        refuse(file, `${name} starts from ${base} in the ${series} and from ${seen.value} in the ${seen.series} — `
          + 'an estimate is one figure in every series, so a sheet was misread');
      }
      baseByCouncil.set(name, { value: base, series });
      councils += 1;
      sum += base;
      const token = projectionAreaToken('lga', name);
      rows.push(...rowsForArea(spec, { name, code: token, token }, values, main.base, projected));
    }
    qldCheckTotal(file, sheet, main.base, councils, sum, total);
    councilsBySeries.set(series, councils);
    seriesRead.push(series);
    horizon = Math.max(horizon, ...projected);
  }

  const counts = [...councilsBySeries.values()];
  if (new Set(counts).size > 1) {
    refuse(file, `the series sheets name different numbers of councils (${[...councilsBySeries].map(([s, n]) => `${s} ${n}`).join(', ')}) — one sheet was misread`);
  }
  return { rows, release: main.release, series: seriesRead, base: main.base, horizon, areas: counts[0] ?? 0, declined };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tasmania — Treasury's population projections, one main output file per series
// ─────────────────────────────────────────────────────────────────────────────

const TAS_PUBLISHER = 'the Tasmanian Department of Treasury and Finance';
const TAS_COMPONENTS = 'LGADetailedComponents5yr';
/** The state's own row, in either table. */
const TAS_TOTAL = /^tasmania$/i;

/**
 * Each LGA's start-of-interval population for the FIRST interval, from the
 * components table: a name on its own row, then `Start-of-interval
 * population` with one figure per interval.
 */
export function tasComponentsBase(grid: Grid): Map<string, number> {
  const out = new Map<string, number>();
  let current: string | null = null;
  for (const row of grid) {
    if (!row) continue;
    const label = cellText(row[0]);
    const figures = row.slice(1).filter((c) => numberOf(c) !== null).length;
    if (label !== '' && figures === 0 && !/^\d{4}\s*[-–]/.test(label) && !/values as at/i.test(label) && !/components/i.test(label)) {
      current = label;
      continue;
    }
    if (current !== null && /^start-of-interval population/i.test(label)) {
      const v = numberOf(row[1]);
      if (v !== null) out.set(current, v);
      current = null;
    }
  }
  return out;
}

function parseTas(
  grids: Readonly<Record<string, Grid>>, sourceUrl: string, licence: string,
  opts: { file: ProjectionFileKey; series: string },
): ProjectionParse {
  const readme = grids['ReadMe'];
  const release = cellText(readme?.[0]?.[0]);
  if (release === '') refuse(opts.file, 'the ReadMe sheet does not name the edition in its first cell');

  const components = grids[TAS_COMPONENTS];
  const base = readFirstInterval(components);
  if (base === null) refuse(opts.file, 'the components table does not state its first interval, so the base is unknown');
  const startOf = tasComponentsBase(components);
  if (startOf.size === 0) refuse(opts.file, 'the components table names no area with a start-of-interval population');

  const table = grids['Totals'];
  const header = findYearHeader(table, (row) => cellText(row[0]) === '', 1, 10);
  if (!header) refuse(opts.file, 'the "Totals" sheet has no row of years');
  if (!header.years.some((y) => y.year === base)) refuse(opts.file, `the Totals sheet does not print the base year ${base}`);
  const projected = header.years.map((y) => y.year).filter((y) => y > base);
  if (projected.length === 0) refuse(opts.file, `no printed year follows the base ${base}`);

  const spec: RowSpec = {
    state: 'TAS', release, series: opts.series, areaKind: 'lga', publisher: TAS_PUBLISHER, sourceUrl, licence,
  };
  const rows: ProjectionLoadRow[] = [];
  const declined: string[] = [];
  let areas = 0;
  for (let r = header.row + 1; r < table.length; r++) {
    const row = table[r];
    const name = cellText(row?.[0]);
    if (!row || name === '') continue;
    if (TAS_TOTAL.test(name)) { declined.push(`${name} (the state, not an LGA)`); continue; }
    // Only the areas the publisher's own components table names are LGAs;
    // anything else in Totals — a region, a grouping — is a total.
    if (!startOf.has(name)) { declined.push(`${name} (not an LGA in the components table)`); continue; }
    const values = valuesOf(row, header);
    const printedBase = values.get(base);
    const stated = startOf.get(name)!;
    if (printedBase === undefined || Math.abs(printedBase - stated) > 1) {
      refuse(opts.file, `${name}: Totals prints ${printedBase ?? 'nothing'} for ${base}, the components table starts from ${Math.round(stated)} — the base column was misread`);
    }
    areas += 1;
    const token = projectionAreaToken('lga', name);
    rows.push(...rowsForArea(spec, { name, code: token, token }, values, base, projected));
  }
  const missing = [...startOf.keys()].filter((n) => !TAS_TOTAL.test(n) && !rows.some((row) => row.area === n));
  if (missing.length > 0) refuse(opts.file, `the components table names ${missing.slice(0, 3).join(', ')}, which Totals does not print`);
  return { rows, release, series: [opts.series], base, horizon: Math.max(...projected), areas, declined };
}

// ─────────────────────────────────────────────────────────────────────────────
// The files
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tasmania's terms, read from CI on 23 Sep 2026 (run 35836681636) where its
 * own workbook points — and NOT accepted here, because they turn on a reading
 * this repository should not make by itself.
 *
 * The product's quick guide: "You are free to reproduce the projections in
 * published work, or use them as an input into your own analysis, provided you
 * identify and credit them as Tasmanian Treasury 2024 projections." The final
 * report: "Excerpts of this publication may be reproduced, with appropriate
 * acknowledgement, as permitted under the Copyright Act 1968." And the
 * Tasmanian Government's site notice — whose only readable copy is a 2011
 * archive capture, the live page refusing CI — licenses reproduction "for
 * non-commercial purposes only" unless a site indicates that specific
 * information may be used commercially.
 *
 * The guide's grant names published work and a credit, and does not name
 * commercial use. Whether a report prepared for a paying client is "published
 * work" under it is a reading of terms, and the owner's decision; until it is
 * made the loader refuses Tasmania before any fetch, exactly as it did while
 * the terms were unread. If it is accepted, the credit the guide asks for is
 * the credit the page must print.
 */
const TAS_TERMS_EVIDENCE = 'terms read from CI 23 Sep 2026 (run 35836681636) and not yet accepted: the quick guide grants '
  + 'reproduction "in published work … provided you identify and credit them as Tasmanian Treasury 2024 projections"; '
  + 'the Tasmanian Government\'s site notice (a 2011 archive capture; the live page refuses CI) licenses reproduction '
  + '"for non-commercial purposes only" unless a site indicates commercial use — refused until the owner decides whether '
  + 'a report for a paying client is published work under the guide\'s grant';

/**
 * Read from CI on 23 Sep 2026 (run 35831008944), from the site that serves
 * both workbooks: the Department's copyright page states that "unless
 * otherwise stated, all department material available on this website is
 * licensed under the Creative Commons Attribution 4.0 International (CC BY
 * 4.0)", and asks attribution in the form "© State of New South Wales and
 * Department of Planning, Housing and Infrastructure [year of publication]".
 * Neither workbook states otherwise — the dry run read every line of both —
 * and each carries exactly that notice on its Notes sheet, which
 * `suppliedNotice` reads and every row carries. "Unless otherwise stated" is
 * held at load time too: `parseProjectionFile` refuses a file that states
 * terms of its own, so a later edition published under different terms is
 * refused rather than loaded under these.
 */
const NSW_LICENCE = 'Creative Commons Attribution 4.0 International';
const NSW_LICENCE_EVIDENCE = 'planning.nsw.gov.au/copyright-and-disclaimer ("Unless otherwise stated, all department '
  + 'material available on this website is licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0)"); '
  + 'the workbook states no terms of its own and carries the notice that page asks for — read from CI 23 Sep 2026 '
  + '(run 35831008944)';

/**
 * Read from CI on 23 Sep 2026 (runs 35831008944, 35833636513 and
 * 35836681636), and the order matters. The Statistician's own site states a
 * RESTRICTIVE default — no part "may be reproduced or re-used for any
 * commercial purpose without written permission" — and then that "where
 * specific licence terms are applied through or via this website to material
 * including a particular product those licence terms shall prevail". This
 * product has specific terms, stated twice: the Queensland Government's open
 * data portal publishes it as "Queensland Government population projections:
 * Regions" (dataset ebb088ed-45fc-46ee-9054-3607476bec42, publisher Treasury)
 * under Creative Commons Attribution 4.0, with its resource pointing at the
 * very page that links both workbooks; and the council workbook's own Main
 * page links the deed (`https://creativecommons.org/licenses/by/4.0`) beside
 * "© The State of Queensland (Queensland Treasury) 2026". The SA2 workbook is
 * the same product and edition and states no terms of its own. So the
 * product's licence governs, and the site's default does not — the ranking the
 * planning registers answer to: a licence stated for the product outranks one
 * stated for the site, while a restriction stated IN the file outranks both,
 * which `parseProjectionFile` holds at load time. The product page itself
 * states no licence (CI read it: only the site's footer notice).
 */
const QLD_LICENCE = 'Creative Commons Attribution 4.0 International';
const QLD_LICENCE_EVIDENCE = 'data.qld.gov.au dataset ebb088ed-45fc-46ee-9054-3607476bec42 ("Queensland Government '
  + 'population projections: Regions", publisher Treasury, licence Creative Commons Attribution 4.0, resource '
  + 'qgso.qld.gov.au/statistics/theme/population/population-projections/regions); the council workbook\'s Main page '
  + 'links creativecommons.org/licenses/by/4.0 beside "© The State of Queensland (Queensland Treasury) 2026"; '
  + 'qgso.qld.gov.au\'s copyright page states that specific licence terms applied to a product prevail over its '
  + 'default — read from CI 23 Sep 2026 (runs 35831008944, 35833636513, 35836681636)';

export const PROJECTION_FILES: readonly ProjectionFile[] = [
  {
    key: 'nsw_sa2',
    state: 'NSW',
    publisher: NSW_PUBLISHER,
    url: 'https://www.planning.nsw.gov.au/sites/default/files/2024-11/2024-nsw-population-projections-sa2s.xlsx',
    sheets: ['Notes', 'Collapsed SA2s', 'Total population'],
    licence: NSW_LICENCE,
    licenceEvidence: NSW_LICENCE_EVIDENCE,
    minAreas: 500,
    parse: (g, url, licence) => parseNsw(g, url, licence, { file: 'nsw_sa2', label: /^SA2$/i, areaKind: 'sa2' }),
  },
  {
    key: 'nsw_lga',
    state: 'NSW',
    publisher: NSW_PUBLISHER,
    url: 'https://www.planning.nsw.gov.au/sites/default/files/2024-11/2024-nsw-population-projections-local-government-areas.xlsx',
    sheets: ['Notes', 'Total population'],
    licence: NSW_LICENCE,
    licenceEvidence: NSW_LICENCE_EVIDENCE,
    minAreas: 120,
    parse: (g, url, licence) => parseNsw(g, url, licence, { file: 'nsw_lga', label: /^Local Government Area$/i, areaKind: 'lga' }),
  },
  {
    key: 'vic_lga',
    state: 'VIC',
    publisher: VIC_PUBLISHER,
    url: 'https://www.planning.vic.gov.au/__data/assets/excel_doc/0033/680874/VIF2023_LGA_Pop_Hhold_Dwelling_Projections_to_2036.xlsx',
    sheets: ['Contents', 'Explanatory Notes', 'Total_Population'],
    licence: 'Creative Commons Attribution 4.0 International',
    licenceEvidence: 'discover.data.vic.gov.au, dataset 4912723f-79a3-4dc8-b9d1-61b0f00152ce '
      + '("VIF2023 LGA Population Household Dwelling Projections to 2036"), read from CI 23 Sep 2026',
    minAreas: 75,
    parse: (g, url, licence) => parseVic(g, url, licence),
  },
  {
    key: 'qld_sa2',
    state: 'QLD',
    publisher: QLD_PUBLISHER,
    url: 'https://www.qgso.qld.gov.au/issues/5281/qld-population-projections-regions-tables-sa2s-sa3s-sa4s-qld-med-series-2021-2046.xlsx',
    sheets: ['Main page', 'Data'],
    licence: QLD_LICENCE,
    licenceEvidence: QLD_LICENCE_EVIDENCE,
    // CI read the Data sheet to its footnotes at row 557; a read naming
    // fewer than 500 SA2s was cut short.
    minAreas: 500,
    parse: (g, url, licence) => parseQldSa2(g, url, licence),
  },
  {
    key: 'qld_lga',
    state: 'QLD',
    publisher: QLD_PUBLISHER,
    url: 'https://www.qgso.qld.gov.au/issues/5281/qld-population-projections-regions-tables-lgas-qld-low-med-high-series-2021-2046.xlsx',
    sheets: ['Main page', ...QLD_LGA_SHEETS],
    licence: QLD_LICENCE,
    licenceEvidence: QLD_LICENCE_EVIDENCE,
    // CI read 78 areas on each series sheet (run 35836681636), and they add to
    // the publisher's own Queensland total; fewer than 70 was cut short.
    minAreas: 70,
    parse: (g, url, licence) => parseQldLga(g, url, licence),
  },
  ...(['Medium', 'High', 'Low'] as const).map((s): ProjectionFile => ({
    key: `tas_${s.toLowerCase()}` as ProjectionFileKey,
    state: 'TAS',
    publisher: TAS_PUBLISHER,
    url: `https://www.treasury.tas.gov.au/Documents/2024-population-projections-${s}-series-Main-output-file.xlsx`,
    sheets: ['ReadMe', 'Totals', TAS_COMPONENTS],
    licence: null,
    licenceEvidence: TAS_TERMS_EVIDENCE,
    minAreas: 25,
    parse: (g, url, licence) => parseTas(g, url, licence, { file: `tas_${s.toLowerCase()}` as ProjectionFileKey, series: `${s} series` }),
  })),
];

export function projectionFileByKey(key: string): ProjectionFile | null {
  return PROJECTION_FILES.find((f) => f.key === key) ?? null;
}

/** A cell that opens a copyright notice: `©`, `(c)`, or `Copyright ©`. */
const NOTICE = /^(©|\(c\)\s|copyright\s*©)/i;

/**
 * A notice's own continuation, where a publisher set it over two cells —
 * Queensland's council workbook puts "© The State of Queensland" in one cell
 * and "(Queensland Treasury) 2026" in the next (CI, run 35836681636). Only a
 * parenthetical, optionally followed by a year, is a continuation: a footnote
 * like "(a) Boundaries are based on …" is not.
 */
const NOTICE_CONTINUATION = /^\([^()]+\)(\s+\d{4})?\.?$/;

/**
 * The copyright notice the publisher SUPPLIES with a file — the first cell, in
 * the order the sheets were read, that opens with `©`, verbatim, joined to its
 * continuation where the publisher split it (the next cell in the row, or the
 * cell below) — or null.
 *
 * CC BY 4.0 §3(a)(1)(A)(ii) asks a reuser to retain "a copyright notice" where
 * the licensor supplies one with the material, so the notice travels with
 * every row the file writes and reaches the page beside the licence. It is
 * READ from the file, never typed: a typed notice is one nobody checks against
 * the next edition. And it is read WHOLE: half a notice names the owner and
 * drops the agency and the year the publisher asked to be credited.
 */
export function suppliedNotice(grids: Readonly<Record<string, Grid>>): string | null {
  for (const grid of Object.values(grids)) {
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] ?? [];
      for (let c = 0; c < row.length; c++) {
        const t = cellText(row[c]);
        if (!NOTICE.test(t)) continue;
        const rest = [cellText(row[c + 1]), cellText(grid[r + 1]?.[c])].find((x) => NOTICE_CONTINUATION.test(x));
        return rest ? `${t} ${rest}` : t;
      }
    }
  }
  return null;
}

/**
 * Words with which a workbook states terms of its OWN. A licence here is read
 * from the publisher, and a site's licence is stated "unless otherwise stated"
 * — so what a file says about its own terms is held against the licence read
 * for it (`termsAgreeWith`). A bare copyright notice (`© Government of
 * Tasmania`) states no terms and matches nothing here.
 */
export const OWN_TERMS = /licen[cs]e[ds]?\b|creative commons|\bcc[ -]?by\b|all rights reserved|permission|may not be (reproduced|copied|used|distributed)|terms (of use|and conditions)/i;

/**
 * Every cell of the sheets read that states terms of the file's own, verbatim
 * — INCLUDING a cell that opens as a copyright notice. `© State of X. All
 * rights reserved.` and `© State of X 2025. Licensed CC BY-NC` are notices and
 * statements of terms at once, and a cell is judged by what it says rather
 * than by how it starts: excluding every cell that opens with `©` would let a
 * restriction through precisely where publishers write one.
 */
export function statedTerms(grids: Readonly<Record<string, Grid>>): string[] {
  const out: string[] = [];
  for (const grid of Object.values(grids)) {
    for (const row of grid) for (const c of row ?? []) {
      const t = cellText(c);
      if (t !== '' && OWN_TERMS.test(t)) out.push(t);
    }
  }
  return out;
}

/**
 * How a statement NAMES each licence this register loads under — by its
 * title, its short form or its deed's URL. A declared licence with no entry
 * here can be affirmed by nothing, so any term a file states refuses it.
 */
const LICENCE_NAMED: Readonly<Record<string, RegExp>> = {
  'Creative Commons Attribution 4.0 International':
    /creative commons attribution 4\.0|\bcc[ -]?by[ -]?4\.0\b|creativecommons\.org\/licenses\/by\/4\.0/i,
};

/** A term that restricts what the declared licences permit — never compatible with loading. */
const RESTRICTS = /non-?commercial|no ?derivatives?|share-?alike|all rights reserved|may not be (reproduced|copied|used|distributed)|\bby-(nc|nd|sa)\b/i;

/**
 * Whether what a workbook says about its own terms agrees with the licence
 * read for it. Three outcomes, and the order is the rule:
 *
 *  1. **A restriction refuses**, whatever else the file says — NonCommercial,
 *     NoDerivatives, ShareAlike, all rights reserved, may not be reproduced.
 *  2. **A file that names the declared licence affirms it**, and the other
 *     lines of a standard licence statement ("to view a copy of this licence",
 *     "for permission beyond the scope of this licence") ride with it — the
 *     file is the best evidence of its own terms there is.
 *  3. **Terms that name no declared licence refuse**, so somebody reads them:
 *     a file that says "permission" and names nothing is not saying CC BY.
 *
 * A file that states no terms at all agrees — the licence read from its
 * publisher's site governs "unless otherwise stated", and it did not.
 */
export function termsAgreeWith(
  licence: string, terms: readonly string[],
): { ok: true } | { ok: false; line: string; why: string } {
  const restricted = terms.find((t) => RESTRICTS.test(t));
  if (restricted) return { ok: false, line: restricted, why: 'restricts what the licence read for it permits' };
  if (terms.length === 0) return { ok: true };
  const named = LICENCE_NAMED[licence];
  if (named && terms.some((t) => named.test(t))) return { ok: true };
  return { ok: false, line: terms[0], why: `names no licence this file was declared under (${licence})` };
}

/** The licence a row carries: the licence read from the publisher, and the notice the file supplies. */
export function licenceWithNotice(licence: string, notice: string | null): string {
  return notice ? `${licence} — ${notice}` : licence;
}

/**
 * Parse a file's sheets and hold the result to the file's own floor. The one
 * entry point the loader and the CI dry run share, so what CI proves about a
 * file is what production would write.
 */
export function parseProjectionFile(
  file: ProjectionFile, grids: Readonly<Record<string, Grid>>, sourceUrl: string, licence: string,
): ProjectionParse {
  // Held against the DECLARED licence. A file with no accepted licence never
  // reaches here in production — the loader refuses it before the fetch — and
  // the CI dry run parses it to show what it holds, printing its rights lines
  // beside the result rather than refusing to look.
  if (file.licence !== null) {
    const verdict = termsAgreeWith(file.licence, statedTerms(grids));
    if (verdict.ok === false) {
      refuse(file.key, `the workbook states terms of its own that ${verdict.why} (${JSON.stringify(verdict.line.slice(0, 160))}) — `
        + 'read what it says before loading it');
    }
  }
  const parsed = file.parse(grids, sourceUrl, licenceWithNotice(licence, suppliedNotice(grids)));
  if (parsed.areas < file.minAreas) {
    refuse(file.key, `the read named ${parsed.areas} areas, fewer than the ${file.minAreas} a complete read of this file names — a truncated read looks exactly like a smaller state`);
  }
  return parsed;
}

/**
 * Whether this platform's loader reads a jurisdiction's own projection: a
 * file is declared for it AND that file's licence has been read from its
 * publisher and accepted. `FORWARD_DEMAND_PUBLISHERS.ingested` is this,
 * derived rather than typed, so the flag, the sentence and the loader cannot
 * disagree — and a file with no accepted licence (unread, or read and not
 * accepted, as Tasmania's is) counts for nothing, because the loader refuses
 * it.
 */
export function projectionIngested(state: string): boolean {
  return PROJECTION_FILES.some((f) => f.state === state && f.licence !== null);
}
