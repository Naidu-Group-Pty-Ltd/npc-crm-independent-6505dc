/**
 * The projection loader's two halves that can be proven without a publisher:
 * the one-sheet xlsx reader, and each jurisdiction's parser against a
 * workbook laid out the way CI measured the real one (run 35827597400, 23 Sep
 * 2026). The real files are proven by the dry run in
 * `state-projection-liveness`, which runs these same parsers over them.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  PROJECTION_FILES,
  parseProjectionFile,
  projectionFileByKey,
  projectionIngested,
  qldMainPage as readQldMainPage,
  qldYearOf,
  readFirstInterval,
  readHistoricProjected,
  readJumpOffYear,
  statedTerms,
  suppliedNotice,
  termsAgreeWith,
  type ProjectionFile,
} from '../../../../supabase/functions/_shared/reports/market/openData/stateProjectionFiles.pure';
import {
  columnIndex,
  parseSharedStrings,
  parseSheetXml,
  readXlsxSheets,
  unescapeXml,
} from '../../../../supabase/functions/_shared/reports/market/openData/xlsxSheet.pure';
import {
  guardProjectionRows,
  projectionBatchesByArea,
  type ProjectionLoadRow,
} from '../../../../supabase/functions/_shared/reports/market/openData/projectionLoad.pure';

type Cell = string | number | null;

/*
 * Every repository file this spec reads is named from the ROOT, never
 * through a `../` literal. Mission Control delivers a spec to a clone only
 * with the files it asserts about, and it finds those by reading root-named
 * path literals. `'../../../../supabase/…'` named nothing it could see, so on
 * npc-crm-independent this spec arrived without its ingest function and
 * asserted the prime's loader against the clone's older one.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const readRepoFile = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function workbook(sheets: Record<string, Cell[][]>, opts: { widenTo?: Record<string, string> } = {}): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (opts.widenTo?.[name]) ws['!ref'] = opts.widenTo[name];
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer);
}

const file = (key: string): ProjectionFile => {
  const f = projectionFileByKey(key);
  if (!f) throw new Error(`no file ${key}`);
  return f;
};

const years = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

async function parse(key: string, sheets: Record<string, Cell[][]>) {
  const f = file(key);
  const read = await readXlsxSheets(workbook(sheets), f.sheets);
  return parseProjectionFile(f, read.grids, f.url, 'CC BY 4.0 (test)');
}

// ─────────────────────────────────────────────────────────────────────────────
// The reader
// ─────────────────────────────────────────────────────────────────────────────

describe('the one-sheet xlsx reader', () => {
  it('reads only the cells that carry a value, whatever range the sheet declares', async () => {
    // Victoria in Future declares A1:XCE1884 over six columns of data; a
    // narrower declared range stands in here only so the WRITER stays quick.
    const bytes = workbook({ Wide: [['LGA code', 'LGA', 2021], ['20110', 'Alpine (S)', 13150]] }, { widenTo: { Wide: 'A1:CZ500' } });
    const read = await readXlsxSheets(bytes, ['Wide']);
    expect(read.grids.Wide).toHaveLength(2);
    expect(read.grids.Wide[1]).toEqual(['20110', 'Alpine (S)', 13150]);
  });

  it('refuses a sheet the workbook does not hold, naming the ones it does', async () => {
    const bytes = workbook({ Notes: [['x']], 'Total population': [['y']] });
    await expect(readXlsxSheets(bytes, ['Totals'])).rejects.toThrow(/holds no sheet named "Totals" \(it holds "Notes", "Total population"\)/);
  });

  it('resolves a sheet whose name differs only by surrounding space — Tasmania\'s trailing one', async () => {
    const bytes = workbook({ 'LGADetailedComponents5yr ': [['a']] });
    const read = await readXlsxSheets(bytes, ['LGADetailedComponents5yr']);
    expect(read.grids.LGADetailedComponents5yr[0]).toEqual(['a']);
  });

  it('refuses bytes that are not a zip, rather than parsing a web page as a workbook', async () => {
    await expect(readXlsxSheets(new TextEncoder().encode('<!DOCTYPE html>Just a moment...'), ['x'])).rejects.toThrow(/not a zip archive/);
  });

  it('reads shared, inline, formula, boolean and error cells, and treats an error as no figure', () => {
    const shared = parseSharedStrings('<sst><si><t>SA2</t></si><si><r><t>Acacia</t></r><r><t xml:space="preserve"> Gardens</t></r><rPh><t>x</t></rPh></si></sst>');
    expect(shared).toEqual(['SA2', 'Acacia Gardens']);
    const grid = parseSheetXml(
      '<sheetData><row r="7"><c r="A7" t="s"><v>0</v></c><c r="B7"><v>2021</v></c><c r="C7" s="3"/></row>'
        + '<row r="8"><c r="A8" t="s"><v>1</v></c><c r="B8"><f>SUM(1,2)</f><v>3929</v></c><c r="C8" t="e"><v>#N/A</v></c>'
        + '<c r="D8" t="inlineStr"><is><t>note &amp; more</t></is></c><c r="E8" t="b"><v>1</v></c></row></sheetData>',
      shared,
    );
    expect(grid[6]).toEqual(['SA2', 2021]);
    expect(grid[7][0]).toBe('Acacia Gardens');
    expect(grid[7][1]).toBe(3929);
    expect(grid[7][2]).toBeUndefined();
    expect(grid[7][3]).toBe('note & more');
    expect(grid[7][4]).toBe(true);
  });

  it('refuses a shared-string index the table does not hold', () => {
    expect(() => parseSheetXml('<row r="1"><c r="A1" t="s"><v>5</v></c></row>', ['only'])).toThrow(/names shared string 5 of 1/);
  });

  it('counts columns the way a spreadsheet does', () => {
    expect(columnIndex('A')).toBe(0);
    expect(columnIndex('Z')).toBe(25);
    expect(columnIndex('AA')).toBe(26);
    expect(columnIndex('XCE')).toBe(16_306);
    expect(unescapeXml('&#8364; &#x2014;&lt;&amp;')).toBe('€ —<&');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The statements each parser reads the base from
// ─────────────────────────────────────────────────────────────────────────────

describe('the base year is the publisher\'s statement', () => {
  it('reads NSW\'s own sentence', () => {
    expect(readHistoricProjected('Historic (2001-2021) and projected (2022-2041) population, by SA2')).toEqual({
      historicTo: 2021, projectedFrom: 2022, projectedTo: 2041,
    });
    expect(readHistoricProjected('Projected population, by SA2')).toBeNull();
  });

  it('reads Victoria in Future\'s stated jump-off', () => {
    expect(readJumpOffYear('The base data for the calculation of these Victoria in Future projections is the '
      + 'Estimated Resident Population (ERP) as at 30 June 2022 (published in March 2023 in ABS Regional Population)')).toBe(2022);
    expect(readJumpOffYear('Projections for LGAs')).toBeNull();
  });

  it('reads Tasmania\'s first interval', () => {
    expect(readFirstInterval([['LGA demographic components'], ['Values as at 30 June'], [null, '2023-2028', '2028-2033']])).toBe(2023);
    expect(readFirstInterval([['nothing here']])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// New South Wales
// ─────────────────────────────────────────────────────────────────────────────

const nswNotes: Cell[][] = [
  ['2024 NSW Common Planning Assumption Projections'],
  ['Population Projections for year ending 30 June'],
  ['2024 NSW Population Projections'],
  ['Two additional series – “high” and “low” projections - are also available'],
];

function nswTable(label: string, rows: Array<[string, number]>): Cell[][] {
  const ys = years(2001, 2041);
  return [
    ['2024 NSW Common Planning Assumption Projections'],
    [],
    [`${label} Population Projections`],
    [],
    ['Historic (2001-2021) and projected (2022-2041) population'],
    ['Return to Index tab'],
    [label, ...ys],
    ...rows.map(([name, start]) => [name, ...ys.map((y, i) => start + i * 10)]),
  ];
}

describe('New South Wales — SA2 and LGA workbooks', () => {
  const sa2Areas: Array<[string, number]> = Array.from({ length: 520 }, (_, i) => [`Area ${String(i).padStart(3, '0')}`, 1000 + i]);

  it('loads the base and every projected year, and none of the history before the base', async () => {
    const p = await parse('nsw_sa2', {
      Notes: nswNotes,
      'Collapsed SA2s': [['Collapsed SA2s based on ASGS 2021'], [], ['Collapsed SA2', 'SA2_NAME_2021', 'Estimated Resident Population'],
        ['Austral - Greendale - Badgerys Creek', 'Austral - Greendale', 12554], ['Austral - Greendale - Badgerys Creek', 'Badgerys Creek', 23]],
      'Total population': nswTable('SA2', [['Acacia Gardens', 1952], ['Austral - Greendale - Badgerys Creek', 9211], ...sa2Areas]),
    });
    expect(p.release).toBe('2024 NSW Population Projections');
    expect(p.series).toEqual(['Main series']);
    expect(p.base).toBe(2021);
    expect(p.horizon).toBe(2041);
    const acacia = p.rows.filter((r) => r.area === 'Acacia Gardens');
    expect(acacia.map((r) => r.year)).toEqual(years(2021, 2041));
    expect(acacia.filter((r) => r.year_kind === 'base').map((r) => r.year)).toEqual([2021]);
    expect(acacia.every((r) => r.area_kind === 'sa2' && r.area_token === 'ACACIA GARDENS' && r.area_code === 'ACACIA GARDENS')).toBe(true);
    expect(guardProjectionRows(p.rows).ok).toBe(true);
  });

  it('answers each SA2 a collapsed area combines with the area the publisher projected', async () => {
    const p = await parse('nsw_sa2', {
      Notes: nswNotes,
      'Collapsed SA2s': [['Collapsed SA2', 'SA2_NAME_2021', 'ERP'],
        ['Austral - Greendale - Badgerys Creek', 'Austral - Greendale', 12554], ['Austral - Greendale - Badgerys Creek', 'Badgerys Creek', 23]],
      'Total population': nswTable('SA2', [['Austral - Greendale - Badgerys Creek', 9211], ...sa2Areas]),
    });
    const badgerys = p.rows.filter((r) => r.area_token === 'BADGERYS CREEK');
    expect(badgerys.length).toBe(21);
    expect(new Set(badgerys.map((r) => r.area))).toEqual(new Set(['Austral - Greendale - Badgerys Creek']));
    // The collapsed name is not an ASGS SA2, so it is not written as one.
    expect(p.rows.some((r) => r.area_token === 'AUSTRAL GREENDALE BADGERYS CREEK')).toBe(false);
  });

  it('refuses a collapsed area the population table does not hold', async () => {
    await expect(parse('nsw_sa2', {
      Notes: nswNotes,
      'Collapsed SA2s': [['Collapsed SA2', 'SA2_NAME_2021', 'ERP'], ['Nowhere - Else', 'Nowhere', 1]],
      'Total population': nswTable('SA2', sa2Areas),
    })).rejects.toThrow(/names "Nowhere - Else", which the population table does not hold/);
  });

  it('refuses a sheet that no longer says which years are history', async () => {
    const table = nswTable('SA2', sa2Areas);
    table[4] = ['Population, by SA2'];
    await expect(parse('nsw_sa2', {
      Notes: nswNotes, 'Collapsed SA2s': [['Collapsed SA2', 'SA2_NAME_2021'], ['A', 'Area 000']], 'Total population': table,
    })).rejects.toThrow(/no longer states which years are historic/);
  });

  it('refuses an edition the Notes do not name', async () => {
    await expect(parse('nsw_lga', {
      Notes: [['Population projections']],
      'Total population': nswTable('Local Government Area', [['Albury', 45265]]),
    })).rejects.toThrow(/does not name the edition/);
  });

  it('declines a state total by name, and refuses a read too short to be the whole file', async () => {
    const lgas: Array<[string, number]> = Array.from({ length: 125 }, (_, i) => [`Council ${i}`, 5000 + i]);
    const p = await parse('nsw_lga', {
      Notes: nswNotes,
      'Total population': nswTable('Local Government Area', [['New South Wales', 6_400_000], ['Bayside (NSW)', 150_000], ...lgas]),
    });
    expect(p.declined).toEqual(['New South Wales (a total, not an area)']);
    expect(p.rows.find((r) => r.area === 'Bayside (NSW)')?.area_token).toBe('BAYSIDE');
    await expect(parse('nsw_lga', {
      Notes: nswNotes, 'Total population': nswTable('Local Government Area', lgas.slice(0, 40)),
    })).rejects.toThrow(/named 40 areas, fewer than the 120/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Victoria
// ─────────────────────────────────────────────────────────────────────────────

const vicContents: Cell[][] = [
  ['Victoria in Future (VIF) population and household projections'],
  ['September 2023'],
  [],
  ['VIF2023_LGA_Pop_Hhold_Dwelling_Projections_to_2036.xlsx'],
];
const vicNotes: Cell[][] = [
  ['Explanatory Notes for VIF Projections'],
  ['Base data'],
  ['The base data for the calculation of these Victoria in Future projections is the Estimated Resident Population (ERP) as at 30 June 2022 (published in March 2023).'],
];
function vicTable(n: number): Cell[][] {
  return [
    [], ['Victoria in Future (VIF) 2023'], ['September 2023'], [], [], ['Estimated Resident Population'], ['Local Government Areas'], [], [],
    ['LGA code', 'LGA', 2021, 2026, 2031, 2036],
    [null, 'Victoria', 6547820, 7181630, 7802500, 8427080],
    ...Array.from({ length: n }, (_, i): Cell[] => [String(20110 + i * 10), i === 0 ? 'Alpine (S)' : `Council ${i} (C)`, 13150 + i, 13410 + i, 13690 + i, 13960 + i]),
  ];
}

describe('Victoria — Victoria in Future 2023, LGAs', () => {
  it('reads the stated jump-off, marks the newest printed estimate as the base, and projects the rest', async () => {
    const p = await parse('vic_lga', { Contents: vicContents, 'Explanatory Notes': vicNotes, Total_Population: vicTable(79) });
    expect(p.release).toBe('Victoria in Future (VIF) population and household projections, September 2023');
    expect(p.series).toEqual(['VIF2023']);
    expect(p.base).toBe(2021);
    expect(p.horizon).toBe(2036);
    const alpine = p.rows.filter((r) => r.area === 'Alpine (S)');
    expect(alpine.map((r) => [r.year, r.year_kind])).toEqual([[2021, 'base'], [2026, 'projected'], [2031, 'projected'], [2036, 'projected']]);
    expect(alpine[0].area_code).toBe('20110');
    expect(alpine[0].area_token).toBe('ALPINE');
    expect(p.declined).toEqual(['Victoria (no LGA code — a total, not an area)']);
    expect(guardProjectionRows(p.rows).ok).toBe(true);
  });

  it('refuses a workbook whose notes no longer state the base', async () => {
    await expect(parse('vic_lga', { Contents: vicContents, 'Explanatory Notes': [['Base data'], ['See the website.']], Total_Population: vicTable(79) }))
      .rejects.toThrow(/no longer state the base Estimated Resident Population year/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Queensland
// ─────────────────────────────────────────────────────────────────────────────

/** The Main page as CI printed it (run 35833636513): title rows, contents, Notes, Caution, Disclaimer. */
function qldMainPage(opts: { base?: string | null; boundaries?: string | null; subtitle?: string; extra?: Cell[][] } = {}): Cell[][] {
  const rows: Cell[][] = [
    [null, null, null, null, null, null, null, null, 'Queensland Government'],
    [],
    [null, 'Queensland Government population projections, 2025 edition'],
    [],
    [null, 'Projected population (medium series), by statistical area'],
    [null, opts.subtitle ?? 'Statistical areas level 2 (SA2), SA3 and SA4'],
    [null, '2021 to 2046'],
    [], [], [],
    [null, 'Contents'], [null, 'Tables'], [null, 1, 'Data'], [],
    [null, 'Notes'], [],
  ];
  if (opts.boundaries !== null) rows.push([null, opts.boundaries ?? 'Boundaries are based on the Australian Statistical Geography Standard (ASGS) Edition 3, 2021.']);
  if (opts.base !== null) rows.push([null, opts.base ?? '2021 data are final estimates.']);
  rows.push([null, 'All data are at 30 June.'], [], [null, 'Caution'], [],
    [null, 'These population projections are not targets.'], [], [null, 'Disclaimer'],
    [null, 'All data and information in this workbook are believed to be accurate.'], ...(opts.extra ?? []));
  return rows;
}

const QLD_YEARS = [2026, 2031, 2036, 2041, 2046];

/** The SA2 Data sheet as CI printed it: title, years with the base as `2021 (b)`, the labels with `— persons —`. */
function qldSa2Data(opts: {
  n?: number; title?: string; total?: number | 'sum' | null; measure?: string;
  secondBlock?: 'after-a-gap' | 'adjacent'; base?: Cell;
} = {}): Cell[][] {
  const n = opts.n ?? 546;
  const second = opts.secondBlock;
  const gap = second === 'after-a-gap' ? [null] : [];
  const sa2s = Array.from({ length: n }, (_, i): Cell[] => {
    const base = 1000 + i;
    return [301, 'Brisbane - East', 30101, 'Capalaba', 301011001 + i, i === 0 ? 'Alexandra Hills' : `Area ${i}`,
      base, ...QLD_YEARS.map((_, k) => base + (k + 1) * 10.25), ...(second ? [...gap, ...QLD_YEARS.map(() => 1.5)] : [])];
  });
  const sum = sa2s.reduce((acc, r) => acc + (r[6] as number), 0);
  const total = opts.total === undefined || opts.total === 'sum' ? sum : opts.total;
  return [
    [opts.title ?? 'Projected population (medium series), by statistical area level 2 (SA2), SA3 and SA4, Queensland, 2021 to 2046',
      null, null, null, null, null, 'At 30 June'],
    [null, null, null, null, null, null, opts.base ?? '2021 (b)', ...QLD_YEARS, ...(second ? [...gap, ...QLD_YEARS] : [])],
    ['SA4 code (a)', 'SA4 (a)', 'SA3 code (a)', 'SA3 (a)', 'SA2 code (a)', 'SA2 (a)', opts.measure ?? '— persons —',
      ...(second ? [null, null, null, null, null, ...gap, '— per cent —'] : [])],
    ...sa2s,
    ...(total === null ? [] : [['Queensland', null, null, null, null, null, total, ...QLD_YEARS.map(() => sum * 1.1)]]),
    [],
    ['(a) Boundaries are based on the ASGS Edition 3.'],
    ['(b) 2021 final estimated resident population.'],
    ['All data are at 30 June'],
    [],
    ['Source: Queensland Government Statistician’s Office, Queensland Government population projections, 2025 edition'],
  ];
}

const QLD_COUNCILS = ['Aurukun', 'Balonne', 'Brisbane', 'Central Highlands (Qld)',
  ...Array.from({ length: 73 }, (_, i) => `Council ${i}`)];

/** One LGA series sheet as CI printed it: title, a label row, the years, `— persons —`, then councils and footnotes. */
function qldLgaSheet(series: 'medium' | 'low' | 'high', opts: {
  title?: string; baseShift?: Record<string, number>; drop?: number; total?: number | 'sum' | null; label?: string;
} = {}): Cell[][] {
  const lift = { medium: 1, low: 0.9, high: 1.1 }[series];
  const councils = QLD_COUNCILS.slice(0, QLD_COUNCILS.length - (opts.drop ?? 0));
  const rows = councils.map((name, i): Cell[] => {
    const base = (name === 'Brisbane' ? 1262968 : 1130 + i * 37) + (opts.baseShift?.[name] ?? 0);
    return [name, base, ...QLD_YEARS.map((_, k) => base * (1 + (k + 1) * 0.02 * lift))];
  });
  const sum = rows.reduce((acc, r) => acc + (r[1] as number), 0);
  const total = opts.total === undefined || opts.total === 'sum' ? sum : opts.total;
  return [
    [opts.title ?? `Projected population (${series} series), by local government area (LGA), Queensland, 2021 to 2046`],
    [],
    [opts.label ?? 'Local Government Area (a)', 'At 30 June'],
    [null, '2021 (b)', ...QLD_YEARS],
    [null, '— persons —'],
    ...rows,
    ...(total === null ? [] : [['Queensland', total, ...QLD_YEARS.map(() => sum * 1.2)]]),
    [],
    ['(a) Boundaries are based on local government areas as at 2021.'],
    ['(b) 2021 final estimated resident population.'],
    [],
    ['Source: Queensland Government Statistician’s Office, Queensland Government population projections, 2025 edition'],
  ];
}

function qldLgaSheets(opts: Partial<Record<'medium' | 'low' | 'high', Parameters<typeof qldLgaSheet>[1]>> & { main?: Cell[][] } = {}): Record<string, Cell[][]> {
  return {
    'Main page': opts.main ?? qldMainPage({ subtitle: 'Local government areas' }),
    'Medium series': qldLgaSheet('medium', opts.medium),
    'Low series': qldLgaSheet('low', opts.low),
    'High series': qldLgaSheet('high', opts.high),
  };
}

describe('Queensland — the Statistician\'s regions tables', () => {
  it('reads a base year printed with its footnote marker, and nothing that is not a year', () => {
    expect(qldYearOf('2021 (b)')).toBe(2021);
    expect(qldYearOf(2026)).toBe(2026);
    expect(qldYearOf('2046')).toBe(2046);
    expect(qldYearOf('2021 to 2046')).toBeNull();
    expect(qldYearOf('2021–2046')).toBeNull();
    expect(qldYearOf('— persons —')).toBeNull();
  });

  it('takes the base from the Main page\'s own sentence, and refuses a page that no longer says it', () => {
    expect(qldMainPage({})).toBeDefined();
    const read = readQldMainPage(qldMainPage(), 'qld_sa2');
    expect(read).toEqual({
      release: 'Queensland Government population projections, 2025 edition',
      base: 2021,
      boundaries: 'Boundaries are based on the Australian Statistical Geography Standard (ASGS) Edition 3, 2021.',
    });
    expect(() => readQldMainPage(qldMainPage({ base: null }), 'qld_sa2')).toThrow(/no longer states which year's data are final estimates/);
  });

  it('loads every SA2 by its ASGS 2021 code, the medium series, the base and each projected year', async () => {
    const p = await parse('qld_sa2', { 'Main page': qldMainPage(), Data: qldSa2Data() });
    expect(p.release).toBe('Queensland Government population projections, 2025 edition');
    expect(p.series).toEqual(['Medium series']);
    expect(p.base).toBe(2021);
    expect(p.horizon).toBe(2046);
    expect(p.areas).toBe(546);
    const alexandra = p.rows.filter((r) => r.area === 'Alexandra Hills');
    expect(alexandra.map((r) => [r.year, r.year_kind])).toEqual([
      [2021, 'base'], [2026, 'projected'], [2031, 'projected'], [2036, 'projected'], [2041, 'projected'], [2046, 'projected'],
    ]);
    expect(alexandra[0]).toMatchObject({ state: 'QLD', area_kind: 'sa2', area_code: '301011001', area_token: 'ALEXANDRA HILLS', value: 1000 });
    expect(alexandra[1].value).toBeCloseTo(1010.25, 6);
    // 546 SA2s starting 1,000 … 1,545 add to 694,785 — and the fixture's own total is that sum.
    expect(p.declined).toEqual(['Queensland on "Data" (the state, not an area — the 2021 total, 694,785, the areas were checked against)']);
    expect(guardProjectionRows(p.rows).ok).toBe(true);
  });

  it('never reads a second block of years as persons, whether a gap separates it or not', async () => {
    for (const secondBlock of ['after-a-gap', 'adjacent'] as const) {
      const p = await parse('qld_sa2', { 'Main page': qldMainPage(), Data: qldSa2Data({ secondBlock }) });
      const alexandra = p.rows.filter((r) => r.area === 'Alexandra Hills');
      expect(alexandra.map((r) => r.year), secondBlock).toEqual([2021, ...QLD_YEARS]);
      expect(alexandra.every((r) => r.value >= 1000), secondBlock).toBe(true);
    }
  });

  it('refuses where the areas do not add to the publisher\'s own state total', async () => {
    await expect(parse('qld_sa2', { 'Main page': qldMainPage(), Data: qldSa2Data({ total: 999 }) }))
      .rejects.toThrow(/add to .* and the publisher's own Queensland total is 999 — a total was read as an area, or an area was missed/);
  });

  it('refuses SA2 codes it cannot tie to the edition the reader resolves against', async () => {
    await expect(parse('qld_sa2', { 'Main page': qldMainPage({ boundaries: 'Boundaries are based on the ASGS.' }), Data: qldSa2Data() }))
      .rejects.toThrow(/does not state that its boundaries are the ASGS 2021 edition/);
    await expect(parse('qld_sa2', { 'Main page': qldMainPage({ boundaries: null }), Data: qldSa2Data() }))
      .rejects.toThrow(/"no statement"/);
  });

  it('refuses a table whose measure is not persons, whose title names no series, or that does not print the stated base', async () => {
    await expect(parse('qld_sa2', { 'Main page': qldMainPage(), Data: qldSa2Data({ measure: '— per cent —' }) }))
      .rejects.toThrow(/does not print "persons" under its first year/);
    await expect(parse('qld_sa2', { 'Main page': qldMainPage(), Data: qldSa2Data({ title: 'Projected population, by SA2' }) }))
      .rejects.toThrow(/title does not name its series/);
    await expect(parse('qld_sa2', { 'Main page': qldMainPage({ base: '2016 data are final estimates.' }), Data: qldSa2Data() }))
      .rejects.toThrow(/does not print 2016, the year the Main page states its final estimates for/);
  });

  it('refuses a read too short to be the whole file', async () => {
    await expect(parse('qld_sa2', { 'Main page': qldMainPage(), Data: qldSa2Data({ n: 120 }) }))
      .rejects.toThrow(/named 120 areas, fewer than the 500/);
  });

  it('loads all three council series, each named by its sheet AND its own title', async () => {
    const p = await parse('qld_lga', qldLgaSheets());
    expect(p.series).toEqual(['Medium series', 'Low series', 'High series']);
    expect(p.base).toBe(2021);
    expect(p.horizon).toBe(2046);
    expect(p.areas).toBe(77);
    const brisbane = p.rows.filter((r) => r.area === 'Brisbane');
    expect(brisbane).toHaveLength(18);
    expect(new Set(brisbane.filter((r) => r.year_kind === 'base').map((r) => r.value))).toEqual(new Set([1262968]));
    const highlands = p.rows.find((r) => r.area === 'Central Highlands (Qld)');
    expect(highlands).toMatchObject({ area_kind: 'lga', area_token: 'CENTRAL HIGHLANDS', area_code: 'CENTRAL HIGHLANDS' });
    expect(p.declined).toHaveLength(3);
    expect(p.declined.every((d) => /^Queensland on "(Medium|Low|High) series" \(the state, not an area/.test(d))).toBe(true);
    expect(guardProjectionRows(p.rows).ok).toBe(true);
  });

  it('refuses a sheet whose own title names a different series from its name', async () => {
    await expect(parse('qld_lga', qldLgaSheets({ low: { title: 'Projected population (high series), by LGA' } })))
      .rejects.toThrow(/the "Low series" sheet is titled .* — the sheet and its own title name different series/);
  });

  it('refuses where a council starts from a different estimate in two series — one sheet was misread', async () => {
    await expect(parse('qld_lga', qldLgaSheets({ high: { baseShift: { Balonne: 40 }, total: null } })))
      .rejects.toThrow(/Balonne starts from 1207 in the High series and from 1167 in the Low series — an estimate is one figure in every series/);
  });

  it('refuses sheets that name different numbers of councils', async () => {
    await expect(parse('qld_lga', qldLgaSheets({ low: { drop: 2 } })))
      .rejects.toThrow(/name different numbers of councils \(Medium series 77, Low series 75, High series 77\)/);
  });

  it('refuses a council sheet whose first column is not headed "Local Government Area"', async () => {
    await expect(parse('qld_lga', qldLgaSheets({ medium: { label: 'Region' } })))
      .rejects.toThrow(/does not head its first column "Local Government Area"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tasmania
// ─────────────────────────────────────────────────────────────────────────────

const tasLgas = Array.from({ length: 29 }, (_, i) => (i === 0 ? "Break O'Day" : `Council ${i}`));

function tasSheets(opts: { baseDisagrees?: boolean } = {}): Record<string, Cell[][]> {
  const ys = years(2001, 2073);
  const value = (i: number, y: number) => 7000 + i * 100 + (y - 2001);
  const components: Cell[][] = [['LGA demographic components, 5-year intervals'], ['Values as at 30 June'], [null, '2023-2028', '2028-2033']];
  tasLgas.forEach((name, i) => {
    components.push([name]);
    components.push(['Start-of-interval population', value(i, 2023) - 0.000001 + (opts.baseDisagrees && i === 3 ? 500 : 0), value(i, 2028)]);
    components.push(['Births', 227.2, 224.8]);
  });
  return {
    ReadMe: [['Population projections for Tasmania and its Local Government Areas, 2024'], [], ['This workbook contains the medium series.'], [], ['© Government of Tasmania']],
    Totals: [
      ['Estimated and projected total population'], ['Values as at 30 June'], [null, ...ys],
      ['Tasmania', ...ys.map((y) => 570000 + y)],
      ...tasLgas.map((name, i): Cell[] => [name, ...ys.map((y) => value(i, y))]),
    ],
    'LGADetailedComponents5yr ': components,
  };
}

describe('Tasmania — one main output file per series', () => {
  it('takes the base from the components table and checks Totals against it', async () => {
    const p = await parse('tas_medium', tasSheets());
    expect(p.release).toBe('Population projections for Tasmania and its Local Government Areas, 2024');
    expect(p.series).toEqual(['Medium series']);
    expect(p.base).toBe(2023);
    expect(p.horizon).toBe(2073);
    expect(p.declined).toEqual(['Tasmania (the state, not an LGA)']);
    const bod = p.rows.filter((r) => r.area === "Break O'Day");
    expect(bod[0]).toMatchObject({ year: 2023, year_kind: 'base', area_kind: 'lga' });
    expect(bod.every((r) => r.year >= 2023)).toBe(true);
    expect(guardProjectionRows(p.rows).ok).toBe(true);
  });

  it('refuses where Totals and the publisher\'s own components table disagree on the base', async () => {
    await expect(parse('tas_high', tasSheets({ baseDisagrees: true }))).rejects.toThrow(/the base column was misread/);
  });

  it('declares all three series, so none is chosen for the reader', () => {
    const tas = PROJECTION_FILES.filter((f) => f.state === 'TAS');
    expect(tas.map((f) => f.key).sort()).toEqual(['tas_high', 'tas_low', 'tas_medium']);
    expect(new Set(tas.map((f) => f.url)).size).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What may be loaded at all
// ─────────────────────────────────────────────────────────────────────────────

describe('readable is not republishable', () => {
  it('names where every declared licence was read, and marks the unread ones unread', () => {
    for (const f of PROJECTION_FILES) {
      expect(f.licenceEvidence.length, f.key).toBeGreaterThan(20);
      if (f.licence === null) expect(f.licenceEvidence, f.key).toMatch(/not yet (read|accepted)/);
      else expect(f.licenceEvidence, f.key).toMatch(/read from CI/);
    }
  });

  it('counts a jurisdiction as ingested only where a file with a read licence exists', () => {
    for (const s of ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']) {
      expect(projectionIngested(s), s).toBe(PROJECTION_FILES.some((f) => f.state === s && f.licence !== null));
    }
  });

  it('loads NSW under the licence its own site states, and names the page it was read from', () => {
    for (const key of ['nsw_sa2', 'nsw_lga']) {
      const f = file(key);
      expect(f.licence, key).toBe('Creative Commons Attribution 4.0 International');
      expect(f.licenceEvidence, key).toMatch(/planning\.nsw\.gov\.au\/copyright-and-disclaimer/);
    }
    expect(projectionIngested('NSW')).toBe(true);
  });

  it('loads Queensland under the licence stated for the product, and records why the site\'s default does not govern', () => {
    for (const key of ['qld_sa2', 'qld_lga']) {
      const f = file(key);
      expect(f.licence, key).toBe('Creative Commons Attribution 4.0 International');
      expect(f.licenceEvidence, key).toMatch(/data\.qld\.gov\.au dataset ebb088ed-45fc-46ee-9054-3607476bec42/);
      expect(f.licenceEvidence, key).toMatch(/specific licence terms applied to a product prevail over its default/);
    }
    expect(projectionIngested('QLD')).toBe(true);
  });

  it('carries the copyright notice the file supplies on every row, beside the licence', async () => {
    const withNotice = [...nswNotes, ['© State of New South Wales and Department of Planning, Housing and Infrastructure 2024']];
    const p = await parse('nsw_lga', {
      Notes: withNotice,
      'Total population': nswTable('Local Government Area', Array.from({ length: 125 }, (_, i): [string, number] => [`Council ${i}`, 5000 + i])),
    });
    expect(new Set(p.rows.map((r) => r.licence))).toEqual(new Set([
      'CC BY 4.0 (test) — © State of New South Wales and Department of Planning, Housing and Infrastructure 2024',
    ]));
    const tas = await parse('tas_low', tasSheets());
    expect(new Set(tas.rows.map((r) => r.licence))).toEqual(new Set(['CC BY 4.0 (test) — © Government of Tasmania']));
  });

  it('reads a notice the publisher split over two cells whole, and never joins a footnote to it', () => {
    // Queensland's council workbook, as CI read it (run 35836681636).
    expect(suppliedNotice({ 'Main page': [['https://creativecommons.org/licenses/by/4.0'], ['© The State of Queensland'], ['(Queensland Treasury) 2026']] }))
      .toBe('© The State of Queensland (Queensland Treasury) 2026');
    expect(suppliedNotice({ Notes: [['© The State of Queensland', '(Queensland Treasury) 2026']] }))
      .toBe('© The State of Queensland (Queensland Treasury) 2026');
    expect(suppliedNotice({ Notes: [['© Government of Tasmania'], ['(a) Boundaries are based on 2021 local government areas.']] }))
      .toBe('© Government of Tasmania');
  });

  it('leaves the licence alone where the file supplies no notice', async () => {
    const p = await parse('nsw_lga', {
      Notes: nswNotes,
      'Total population': nswTable('Local Government Area', Array.from({ length: 125 }, (_, i): [string, number] => [`Council ${i}`, 5000 + i])),
    });
    expect(new Set(p.rows.map((r) => r.licence))).toEqual(new Set(['CC BY 4.0 (test)']));
  });

  const lgaTable = () => nswTable('Local Government Area', Array.from({ length: 125 }, (_, i): [string, number] => [`Council ${i}`, 5000 + i]));

  it('refuses a workbook whose own terms restrict what the licence read for it permits', async () => {
    for (const line of [
      'All rights reserved.',
      'This work may not be reproduced without the written permission of the Department.',
      'Licensed under a Creative Commons Attribution-NonCommercial 4.0 licence.',
      // A restriction refuses even beside a statement naming the licence.
      'This work is licensed under CC BY 4.0, except the tables, which are licensed CC BY-NC.',
    ]) {
      await expect(parse('nsw_lga', { Notes: [...nswNotes, [line]], 'Total population': lgaTable() }), line)
        .rejects.toThrow(/states terms of its own that restricts/);
    }
  });

  it('judges a notice that also states terms — "© … All rights reserved" is a restriction wherever it sits', async () => {
    await expect(parse('nsw_lga', { Notes: [...nswNotes, ['© State of New South Wales 2024. All rights reserved.']], 'Total population': lgaTable() }))
      .rejects.toThrow(/states terms of its own that restricts/);
    await expect(parse('nsw_lga', { Notes: [...nswNotes, ['© State of New South Wales 2024. Licensed CC BY-NC 4.0.']], 'Total population': lgaTable() }))
      .rejects.toThrow(/states terms of its own that restricts/);
    // A notice that states the declared licence affirms it, and still travels as the notice.
    const p = await parse('nsw_lga', {
      Notes: [...nswNotes, ['© State of New South Wales 2024. Licensed under CC BY 4.0.']], 'Total population': lgaTable(),
    });
    expect(new Set(p.rows.map((r) => r.licence))).toEqual(new Set(['CC BY 4.0 (test) — © State of New South Wales 2024. Licensed under CC BY 4.0.']));
  });

  it('refuses terms that name no licence the file was declared under, so somebody reads them', async () => {
    for (const line of [
      'Reproduction of this material requires the permission of the Department.',
      'This work is licensed under a Creative Commons Attribution 3.0 Australia licence.',
    ]) {
      await expect(parse('nsw_lga', { Notes: [...nswNotes, [line]], 'Total population': lgaTable() }), line)
        .rejects.toThrow(/names no licence this file was declared under/);
    }
  });

  it('loads a workbook whose own statement NAMES the licence read for it — the file is the best evidence of its terms', async () => {
    const p = await parse('nsw_lga', {
      Notes: [
        ...nswNotes,
        ['This work is licensed under a Creative Commons Attribution 4.0 International licence.'],
        ['To view a copy of this licence, visit https://creativecommons.org/licenses/by/4.0/'],
        ['For permission to use material beyond the scope of this licence, contact the Department.'],
      ],
      'Total population': lgaTable(),
    });
    expect(p.areas).toBe(125);
    // The notice alone is not a statement of terms.
    expect(statedTerms({ Notes: [['© Government of Tasmania']] })).toEqual([]);
    expect(suppliedNotice({ Notes: [['Treasury population projections 2024'], ['© Government of Tasmania']] })).toBe('© Government of Tasmania');
    expect(suppliedNotice({ Notes: [['Copyright is reserved by nobody in particular']] })).toBeNull();
  });

  it('holds no terms against a file with no accepted licence — the loader refused it before the fetch', async () => {
    // The CI dry run parses such a file to show what it holds; production never reaches the parse.
    const sheets = tasSheets();
    sheets.ReadMe = [...sheets.ReadMe, ['All rights reserved.']];
    await expect(parse('tas_medium', sheets)).resolves.toMatchObject({ areas: 29 });
    expect(termsAgreeWith('Creative Commons Attribution 4.0 International', [])).toEqual({ ok: true });
    expect(termsAgreeWith('A licence nobody declared a pattern for', ['Licensed under it.']).ok).toBe(false);
  });

  it('schedules exactly the declared files, and first-loads only the ones whose licence is accepted', () => {
    const filesIn = (sql: string) => [...sql.matchAll(/"stage":\s*"projections",\s*"file":\s*"([a-z_0-9]+)"/g)].map((m) => m[1]);
    /*
     * A file declared without a job is never refreshed and says nothing about
     * it — "a job that was never scheduled says nothing at all" — and a job
     * for a file nobody declares answers 400 every month. So the monthly set
     * IS the declared set. (Once 20261218010000 has been applied, a new file
     * gets its job from a new migration, and this reads every file that
     * schedules one.)
     */
    const monthly = readRepoFile('supabase/migrations/20261218010000_population_projections_refresh.sql');
    expect(new Set(filesIn(monthly))).toEqual(new Set(PROJECTION_FILES.map((f) => f.key)));
    // The first loads fire only what the loader will not refuse.
    const first = readRepoFile('supabase/migrations/20261218020000_population_projections_first_ingest.sql');
    const fired = filesIn(first);
    expect(fired.length).toBeGreaterThan(0);
    for (const key of fired) expect(file(key).licence, key).not.toBeNull();
  });

  it('refuses in the loader, before any fetch, a file with no accepted licence', () => {
    const source = readRepoFile('supabase/functions/market-sales-ingest/index.ts');
    const stage = source.slice(source.indexOf("if (stage === 'projections')"));
    const refusal = stage.indexOf('if (file.licence === null)');
    const fetchAt = stage.indexOf('fetchProjectionWorkbook(file)');
    expect(refusal).toBeGreaterThan(0);
    expect(fetchAt).toBeGreaterThan(refusal);
  });
});

describe('a batch never splits an area', () => {
  const r = (area: string, year: number): ProjectionLoadRow => ({
    state: 'NSW', release: 'r', series: 's', measure: 'persons', area_kind: 'sa2', area_code: area, area, area_token: area,
    year, year_kind: year === 2021 ? 'base' : 'projected', value: 1, publisher: 'p', source_url: 'u', licence: 'l',
  });

  it('keeps each area whole, even where that leaves a batch short', () => {
    const rows = ['A', 'B', 'C'].flatMap((a) => years(2021, 2041).map((y) => r(a, y)));
    const batches = projectionBatchesByArea(rows, 50);
    expect(batches.map((b) => b.length)).toEqual([42, 21]);
    for (const b of batches) {
      for (const a of new Set(b.map((x) => x.area))) expect(b.filter((x) => x.area === a)).toHaveLength(21);
    }
  });

  it('gives an area larger than a batch a batch of its own', () => {
    const rows = [...years(2021, 2041).map((y) => r('A', y)), r('B', 2021)];
    expect(projectionBatchesByArea(rows, 10).map((b) => b.length)).toEqual([21, 1]);
  });
});
