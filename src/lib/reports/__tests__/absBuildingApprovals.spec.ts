/**
 * The national building-approvals register.
 *
 * Every fixture here is synthetic SDMX-CSV and a synthetic dataflow
 * catalogue, built to the shapes the SDMX REST standard admits — because the
 * point of this module is that it does NOT know the ABS's dataflow
 * identifier and must not be written as though it did. What is tested is the
 * discovery, the refusals and the arithmetic; what is NOT tested here, and
 * is recorded as such, is that the ABS's own catalogue contains a flow these
 * patterns match. That is a production measurement, and asserting it from a
 * fixture would be a statement about the fixture.
 */
import { describe, it, expect } from 'vitest';
import {
  ABS_BA_GRAIN_LADDER,
  ABS_BA_NAME_PATTERN,
  ABS_BA_PLAUSIBILITY,
  APPROVALS_ARE_NOT_COMPLETIONS,
  DATAFLOW_REF_SHAPE,
  absBuildingApprovalsUrl,
  dataflowRef,
  monthPeriod,
  parseAbsBuildingApprovals,
  parseDataflowCatalogue,
  resolveBuildingApprovalsFlow,
  resolveColumns,
  stateOfAreaCode,
  surveyConstructionFlows,
  ABS_CONSTRUCTION_SURVEY,
  currentEdition,
  flowEdition,
  grainOfAreaCode,
  isStorableGrain,
} from '../../../../supabase/functions/_shared/reports/market/openData/absBuildingApprovals.pure.ts';

// ─── Catalogues ─────────────────────────────────────────────────────────────

const xmlCatalogue = (flows: Array<[string, string, string]>) => `<?xml version="1.0"?>
<mes:Structure xmlns:mes="x" xmlns:str="y">
  <mes:Structures><str:Dataflows>
${flows.map(([id, version, name]) =>
  `    <str:Dataflow id="${id}" agencyID="ABS" version="${version}" isFinal="true">
      <com:Name xml:lang="en">${name}</com:Name>
    </str:Dataflow>`).join('\n')}
  </str:Dataflows></mes:Structures>
</mes:Structure>`;

const jsonCatalogue = (flows: Array<[string, string, string]>) => JSON.stringify({
  data: {
    dataflows: flows.map(([id, version, name]) => ({
      id, version, agencyID: 'ABS', names: { en: name },
    })),
  },
});

const LGA_FLOW: [string, string, string] =
  ['BUILDING_APPROVALS_LGA', '1.0.0', 'Building Approvals by Local Government Area'];
const SA2_FLOW: [string, string, string] =
  ['BA_SA2', '1.0.0', 'Building Approvals by SA2 and Development Type'];
const STATE_FLOW: [string, string, string] =
  ['BA_ST', '2.0.0', 'Building Approvals by States and Territories'];
const NOISE: Array<[string, string, string]> = [
  ['RES_DWELL_ST', '1.0.0', 'Residential Dwellings: Values, Mean Price and Number by State'],
  ['CPI', '1.1.0', 'Consumer Price Index, Australia'],
];

describe('the catalogue is read in both shapes the standard admits', () => {
  it('reads SDMX-ML, keeping the publisher’s own version', () => {
    const flows = parseDataflowCatalogue(xmlCatalogue([LGA_FLOW, ...NOISE]));
    expect(flows).toHaveLength(3);
    expect(dataflowRef(flows[0])).toBe('ABS,BUILDING_APPROVALS_LGA,1.0.0');
    expect(flows[0].name).toBe('Building Approvals by Local Government Area');
  });

  it('reads SDMX-JSON, including the locale name map', () => {
    const flows = parseDataflowCatalogue(jsonCatalogue([STATE_FLOW]));
    expect(dataflowRef(flows[0])).toBe('ABS,BA_ST,2.0.0');
    expect(flows[0].name).toContain('States and Territories');
  });

  it('refuses an empty body rather than reporting zero flows', () => {
    expect(() => parseDataflowCatalogue('   ')).toThrow(/empty/);
  });

  it('refuses a body it cannot parse in either shape', () => {
    expect(() => parseDataflowCatalogue('<html><body>Access denied</body></html>'))
      .toThrow(/names no dataflow/);
    expect(() => parseDataflowCatalogue('{"oops":1}')).toThrow(/no "dataflows" array/);
    expect(() => parseDataflowCatalogue('{not json')).toThrow(/not parseable JSON/);
  });
});

describe('the flow is discovered, and the finest grain wins', () => {
  it('prefers SA2 over LGA over state, because the scorer prices the grain', () => {
    const choice = resolveBuildingApprovalsFlow(
      xmlCatalogue([STATE_FLOW, LGA_FLOW, SA2_FLOW, ...NOISE]),
    );
    expect(choice.areaKind).toBe('sa2');
    expect(dataflowRef(choice.flow)).toBe('ABS,BA_SA2,1.0.0');
    expect(choice.how).toBe('discovered');
    expect(choice.cataloguedFlows).toBe(5);
    // Every subject match travels, finest first, so an operator can see the
    // rejected ones rather than only the winner.
    expect(choice.candidates.map((c) => c.areaKind)).toEqual(['sa2', 'lga', 'state']);
  });

  it('takes LGA when that is the finest published', () => {
    const choice = resolveBuildingApprovalsFlow(jsonCatalogue([STATE_FLOW, LGA_FLOW]));
    expect(choice.areaKind).toBe('lga');
    expect(choice.geographyScore).toBe(55);
  });

  it('refuses two flows at one grain that tie on vintage with no declared end', () => {
    expect(() => resolveBuildingApprovalsFlow(xmlCatalogue([
      ['BA_LGA_A', '1.0.0', 'Building Approvals by Local Government Area'],
      ['BA_LGA_B', '1.0.0', 'Building Approvals, Local Government Areas, Annual'],
    ]))).toThrow(/same vintage and no declared end[\s\S]*refused rather than picking one/);
  });

  it('refuses a catalogue in which nothing names building approvals', () => {
    expect(() => resolveBuildingApprovalsFlow(xmlCatalogue(NOISE)))
      .toThrow(/no flow in the ABS catalogue \(2 flows\) names building approvals/);
  });

  it('refuses an unqualified release, because it is not a reading about an area', () => {
    expect(() => resolveBuildingApprovalsFlow(xmlCatalogue([
      ['BA', '1.0.0', 'Building Approvals, Australia'],
    ]))).toThrow(/none states a sub-national grain/);
  });
});

describe('an operator override is checked against the catalogue, never trusted', () => {
  const catalogue = xmlCatalogue([SA2_FLOW, LGA_FLOW, ...NOISE]);

  it('takes a published flow the discovery would not have chosen', () => {
    const choice = resolveBuildingApprovalsFlow(catalogue, 'ABS,BUILDING_APPROVALS_LGA,1.0.0');
    expect(choice.how).toBe('operator_override');
    expect(choice.areaKind).toBe('lga');
  });

  it('refuses a reference that is not the AGENCY,ID,VERSION shape', () => {
    expect(() => resolveBuildingApprovalsFlow(catalogue, 'BUILDING_APPROVALS_LGA'))
      .toThrow(/is not an SDMX dataflow reference/);
    expect(DATAFLOW_REF_SHAPE.test('ABS,X,1.0.0')).toBe(true);
    expect(DATAFLOW_REF_SHAPE.test('ABS,X')).toBe(false);
  });

  it('refuses a typo and names what IS published, so it cannot read as an outage', () => {
    let message = '';
    try {
      resolveBuildingApprovalsFlow(catalogue, 'ABS,BUILDING_APPROVAL_LGA,1.0.0');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/does not publish "ABS,BUILDING_APPROVAL_LGA,1.0.0"/);
    expect(message).toContain('ABS,BUILDING_APPROVALS_LGA,1.0.0');
  });
});

describe('the data URL', () => {
  it('names the discovered flow and asks for labels', () => {
    const flow = { agency: 'ABS', id: 'BA_LGA', version: '1.0.0', name: 'x' };
    const url = absBuildingApprovalsUrl(flow, '2018-01');
    expect(url).toContain('/rest/data/ABS,BA_LGA,1.0.0/all');
    expect(url).toContain('startPeriod=2018-01');
    expect(url).toContain('format=csvfilewithlabels');
  });

  it('refuses a start period that is not a month', () => {
    const flow = { agency: 'ABS', id: 'BA_LGA', version: '1.0.0', name: 'x' };
    expect(() => absBuildingApprovalsUrl(flow, '2018-Q1')).toThrow(/YYYY-MM/);
  });
});

// ─── The download ───────────────────────────────────────────────────────────

const HEADER =
  'DATAFLOW,MEASURE,Measure,BUILDING_TYPE,Building Type,TSEST,Series Type,REGION,Region,FREQ,TIME_PERIOD,OBS_VALUE,UNIT_MULT';

/**
 * A download the register's own plausibility floors accept: 205 local
 * government areas across three states, twenty-six months, three building
 * types, both measures. The area count is deliberately past
 * `ABS_BA_PLAUSIBILITY.minAreas.lga` rather than a token three, because a
 * fixture below the floor tests the floor and nothing else -- the lesson
 * `WHAT_THE_PAGE_ACTUALLY_DRAWS.md` §2 records.
 */
function download(
  over: { series?: string; units?: (i: number) => string; areas?: number; months?: number } = {},
): string {
  const lines = [HEADER];
  const areaCount = over.areas ?? 205;
  const monthCount = over.months ?? 26;
  const areas: Array<[string, string]> = [];
  for (let a = 0; a < areaCount; a++) {
    // Leading digit 1/2/3 => NSW/VIC/QLD, which is how the state is read.
    const state = (a % 3) + 1;
    areas.push([`${state}${String(a).padStart(4, '0')}`, `Council ${a} (C)`]);
  }
  areas[0] = ['10050', 'Albury (C)'];
  let i = 0;
  for (const [code, label] of areas) {
    for (let m = 0; m < monthCount; m++) {
      const period = `${2024 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
      for (const [bt, btLabel] of [['1', 'Houses'], ['2', 'Other residential'], ['9', 'Total residential']]) {
        const units = over.units ? over.units(i) : String(10 + (i % 40));
        const tsest = over.series ? `${over.series},Seasonally Adjusted` : '10,Original';
        lines.push(`BA,1,Number of dwelling units,${bt},${btLabel},${tsest},${code},${label},M,${period},${units},0`);
        lines.push(`BA,2,Value of building approved,${bt},${btLabel},${tsest},${code},${label},M,${period},${5 + (i % 7)},6`);
        i++;
      }
    }
  }
  return lines.join('\n');
}

/**
 * The rollup rows an ABS region download really carries.
 *
 * Measured, not imagined: the liveness check fetched the Bureau's own LGA
 * download on 21 Sep 2026 and the parser refused it on
 * `Australia 2026-07 reads $22,314,955,000`. `Building Approvals by SA2 AND
 * ABOVE` means what it says — a region download is the whole hierarchy.
 */
function rollupRows(monthCount = 26): string[] {
  const lines: string[] = [];
  for (const [code, label] of [['AUS', 'Australia'], ['1', 'New South Wales'], ['2', 'Victoria']]) {
    for (let m = 0; m < monthCount; m++) {
      const period = `${2024 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
      // A real national month: ~17,000 dwellings and ~$22.3bn of building.
      const units = code === 'AUS' ? 17_000 : 4_000;
      const value = code === 'AUS' ? 22_314 : 6_100;
      lines.push(`BA,1,Number of dwelling units,9,Total residential,10,Original,${code},${label},M,${period},${units},0`);
      lines.push(`BA,2,Value of building approved,9,Total residential,10,Original,${code},${label},M,${period},${value},6`);
    }
  }
  return lines;
}

describe('a region download is a HIERARCHY, and the grain is the row’s own', () => {
  const hierarchical = () => [download(), ...rollupRows()].join('\n');

  it('accepts the national total that refused the Bureau’s own download', () => {
    // $22,314,955,000 in one month is an ordinary national figure and was
    // refused against a ceiling written for a council area.
    const parsed = parseAbsBuildingApprovals(hierarchical(), 'lga');
    const au = parsed.rows.find((r) => r.areaCode === 'AUS' && r.buildingType === 'total_residential');
    expect(au?.value).toBe(22_314_000_000);
    expect(au?.areaKind).toBe('national');
  });

  it('files a state rollup as a state and a council as a council', () => {
    const parsed = parseAbsBuildingApprovals(hierarchical(), 'lga');
    expect(parsed.rows.find((r) => r.areaCode === '1')?.areaKind).toBe('state');
    expect(parsed.rows.find((r) => r.areaCode === '10050')?.areaKind).toBe('lga');
  });

  it('counts the floor on the requested grain alone, and reports every grain', () => {
    const parsed = parseAbsBuildingApprovals(hierarchical(), 'lga');
    expect(parsed.areas).toBe(205);
    expect(parsed.areasByGrain).toMatchObject({ lga: 205, state: 2, national: 1 });
  });

  it('refuses a body that is all rollup and no councils', () => {
    // 3 rollup areas would pass an undifferentiated count of "areas" against
    // nothing; against the lga floor of 200 it is the truncated body it is.
    let message = '';
    try {
      parseAbsBuildingApprovals([HEADER, ...rollupRows()].join('\n'), 'lga');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/names 0 lga areas/);
    expect(message).toMatch(/it carries 2 state, 1 national/);
  });

  it('still refuses a figure that is implausible FOR ITS OWN grain', () => {
    // The bound did not go away; it became the right bound. A council with
    // 900,000 dwellings approved in a month is unit drift.
    const mad = [HEADER, ...rollupRows()]
      .concat(download().split('\n').slice(1))
      .join('\n')
      .replace('BA,1,Number of dwelling units,1,Houses,10,Original,10050,Albury (C),M,2024-01,10,0',
        'BA,1,Number of dwelling units,1,Houses,10,Original,10050,Albury (C),M,2024-01,900000,0');
    expect(() => parseAbsBuildingApprovals(mad, 'lga'))
      .toThrow(/900000 dwelling units, outside 0–100000 for a lga area/);
  });
});

describe('the SA2 hierarchy has five levels and `area_kind` has four', () => {
  /*
   * Found by reading the loaded register back, 22 Sep 2026, after the first
   * production load of 17,442 rows:
   *
   *     by_kind=[lga=2064, national=6, sa2=15324, state=48]
   *     samples=[lga code=10102 area=Queanbeyan | sa2 code=101 area=Capital Region]
   *
   * `10102 Queanbeyan` is an SA3 and was filed `lga`. `101 Capital Region` is
   * an SA4 and was filed `sa2` — a 250,000-person region written as a suburb,
   * which the read path would serve as that suburb's approved supply.
   *
   * The cause was `return requested` for a code in no known shape. It called
   * itself the conservative side and was its opposite: the requested grain is
   * the FINEST grain in the download, so an unreadable code defaulted to the
   * strongest claim available.
   */
  it('reads the real production codes at their own level', () => {
    expect(grainOfAreaCode('101021007', 'sa2')).toBe('sa2');   // 9 digits
    expect(grainOfAreaCode('10102', 'sa2')).toBe('sa3');       // Queanbeyan
    expect(grainOfAreaCode('101', 'sa2')).toBe('sa4');         // Capital Region
    expect(grainOfAreaCode('1', 'sa2')).toBe('state');
    expect(grainOfAreaCode('AUS', 'sa2')).toBe('national');
  });

  it('settles the five-digit collision by the DOWNLOAD, not by the code', () => {
    // An ABS LGA code is five digits and so is an SA3. The hierarchies do not
    // overlap: an LGA download is LGA -> state -> AUS and carries no SA3, an
    // SA2 download carries no LGA. So the request disambiguates exactly this
    // one case, which is the only legitimate use it has here.
    expect(grainOfAreaCode('10050', 'lga')).toBe('lga');
    expect(grainOfAreaCode('10050', 'sa2')).toBe('sa3');
  });

  it('never resolves an unreadable code to the requested grain', () => {
    // The defect, stated as the defect. Guessing downward puts a coarse
    // figure on a page as a fine one; guessing upward only loses a row.
    for (const requested of ['sa2', 'lga', 'state', 'national'] as const) {
      expect(grainOfAreaCode('ZZZZ', requested)).toBe('unknown');
      expect(grainOfAreaCode('', requested)).toBe('unknown');
      expect(grainOfAreaCode('1234567', requested)).toBe('unknown');
    }
  });

  it('knows which grains the column can actually hold', () => {
    expect(isStorableGrain('sa2')).toBe(true);
    expect(isStorableGrain('lga')).toBe(true);
    expect(isStorableGrain('state')).toBe(true);
    expect(isStorableGrain('national')).toBe(true);
    expect(isStorableGrain('sa3')).toBe(false);
    expect(isStorableGrain('sa4')).toBe(false);
    expect(isStorableGrain('unknown')).toBe(false);
  });

  it('refuses an SA4 rather than bending it into a grain that fits', () => {
    // An SA4 rode in with a real LGA download. It must be counted and
    // declined, not written as an `lga` (or, as before, as the requested
    // grain). The LGA rows still satisfy the floor, so this exercises the
    // refusal on a body the parse otherwise accepts.
    const body = [download(), ...rollupRows(),
      'BA,1,Number of dwelling units,1,Houses,10,Original,101,Capital Region,M,2024-01,90,0',
    ].join('\n');
    const parsed = parseAbsBuildingApprovals(body, 'lga');
    expect(parsed.refusedByGrain).toMatchObject({ sa4: 1 });
    expect(parsed.rows.some((r) => r.areaCode === '101')).toBe(false);
    // The rest of the download is untouched by the refusal.
    expect(parsed.areasByGrain).toMatchObject({ lga: 205, state: 2, national: 1 });
  });

  it('says a body was all hierarchy rather than all unreadable', () => {
    // Before the refusal existed these two were WRITTEN, as `lga` and `sa2`.
    // Now they are declined — and the message has to say which, or it sends
    // an operator hunting a parse fault over a body that read perfectly.
    const body = [
      HEADER,
      'BA,1,Number of dwelling units,1,Houses,10,Original,10102,Queanbeyan,M,2024-01,40,0',
      'BA,1,Number of dwelling units,1,Houses,10,Original,101,Capital Region,M,2024-01,90,0',
    ].join('\n');
    expect(() => parseAbsBuildingApprovals(body, 'sa2', { minPeriods: 1 }))
      .toThrow(/refused for want of a column: 1 sa3, 1 sa4/);
  });
});

describe('a count of BUILDINGS is not a count of dwellings', () => {
  /*
   * The ABS measure dimension publishes three things, not two: `Number of
   * dwelling units`, `Value of building approved` and `Number of buildings`.
   * A block of forty flats is one building and forty dwellings.
   *
   * The row key is `(area, period, building type)`, so a building count that
   * the measure rule admitted did not merely leak in — it OVERWROTE the
   * dwelling count for the same month whenever it was read second. This
   * fixture publishes the third measure the way the cube does, which is what
   * the original fixture did not.
   */
  const withBuildingCounts = () => {
    const lines = download().split('\n');
    const extra: string[] = [];
    for (const line of lines.slice(1)) {
      if (!line.includes('Number of dwelling units')) continue;
      extra.push(line
        .replace('BA,1,Number of dwelling units', 'BA,3,Number of buildings')
        .replace(/,(\d+),0$/, ',1,0'));
    }
    return [...lines, ...extra].join('\n');
  };

  it('never writes a building count into dwelling_units', () => {
    const parsed = parseAbsBuildingApprovals(withBuildingCounts(), 'lga');
    const albury = parsed.rows.find((r) => r.areaCode === '10050' && r.period === '2024-01' && r.buildingType === 'house');
    // 10 dwellings, not the 1 building they sit in.
    expect(albury?.dwellingUnits).toBe(10);
  });

  it('counts the unrecognised measure as skipped rather than absorbing it', () => {
    const clean = parseAbsBuildingApprovals(download(), 'lga');
    const withCounts = parseAbsBuildingApprovals(withBuildingCounts(), 'lga');
    expect(withCounts.rows.length).toBe(clean.rows.length);
    expect(withCounts.skipped).toBeGreaterThan(clean.skipped);
  });
});

describe('a bare “Total” is not total residential', () => {
  /*
   * The Bureau's building-type codelist publishes `100 = Total residential`
   * AND `TOT = Total` across thirty-four categories including hotels, shops,
   * factories, offices, health and education. `Total` is all of them.
   */
  it('does not read an all-buildings total as a dwelling total', () => {
    const lines = download().split('\n');
    // The same cell relabelled as the cube's bare `Total`.
    const allBuildings = lines.slice(1)
      .filter((l) => l.includes('Total residential') && l.includes('10050'))
      .map((l) => l.replace('9,Total residential', 'TOT,Total').replace(/,(\d+),0$/, ',9999,0'));
    const parsed = parseAbsBuildingApprovals([...lines, ...allBuildings].join('\n'), 'lga');
    const row = parsed.rows.find((r) =>
      r.areaCode === '10050' && r.period === '2024-01' && r.buildingType === 'total_residential');
    // Unchanged — the non-residential total did not overwrite it, and it did
    // not arrive as a fourth building type either.
    expect(row?.dwellingUnits).not.toBe(9999);
    expect(new Set(parsed.rows.map((r) => r.buildingType)))
      .toEqual(new Set(['house', 'other_residential', 'total_residential']));
  });

  it('counts it as skipped, which is visible, rather than wrong, which is not', () => {
    const lines = download().split('\n');
    const allBuildings = lines.slice(1)
      .filter((l) => l.includes('Total residential') && l.includes('10050'))
      .map((l) => l.replace('9,Total residential', 'TOT,Total'));
    const clean = parseAbsBuildingApprovals(download(), 'lga');
    const withTotal = parseAbsBuildingApprovals([...lines, ...allBuildings].join('\n'), 'lga');
    expect(withTotal.skipped).toBeGreaterThan(clean.skipped);
  });
});

describe('an unfiltered dimension is caught by its EFFECT', () => {
  /*
   * The Bureau's own structure, measured 21 Sep 2026:
   *   MEASURE[3] · SECTOR[3] · WORK_TYPE[9] · BUILDING_TYPE[34] ·
   *   REGION_TYPE[43] · REGION[2985] · FREQ[9] · TIME_PERIOD
   * This parse reads four of the eight. Private, public and total sector
   * figures for one month all land on the same row key, as do new work,
   * alterations and conversions — and the last one written silently wins, so
   * the register would store an arbitrary SLICE presented as a total.
   *
   * Enumerating every dimension the publisher might add is the bet that lost
   * over `Number of buildings`. This asserts the symptom instead.
   */
  const withSectorSplit = () => {
    const lines = download().split('\n');
    const extra = lines.slice(1)
      .filter((l) => l.includes('Number of dwelling units') && l.includes('10050'))
      // The same cell as the public-sector slice: a different figure under an
      // identical (area, period, building type).
      .map((l) => l.replace(/,(\d+),0$/, ',3,0'));
    return [...lines, ...extra].join('\n');
  };

  it('refuses two different figures for one area, month and type', () => {
    let message = '';
    try {
      parseAbsBuildingApprovals(withSectorSplit(), 'lga');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/two different dwelling units figures for Albury \(C\)/);
    expect(message).toMatch(/carries a dimension this reader does not filter/);
    expect(message).toMatch(/do not average them/);
  });

  it('accepts an identical repeat, because a download may legitimately repeat a row', () => {
    const lines = download().split('\n');
    const repeated = [...lines, ...lines.slice(1, 40)].join('\n');
    expect(() => parseAbsBuildingApprovals(repeated, 'lga')).not.toThrow();
  });

  it('is silent on a clean download — it detects, it does not filter', () => {
    const clean = parseAbsBuildingApprovals(download(), 'lga');
    expect(clean.rows.length).toBeGreaterThan(0);
  });
});

describe('the columns are read off the header, never assumed', () => {
  it('resolves one region pair, the measure, the type and the series', () => {
    const cols = resolveColumns(HEADER.split(','));
    expect(cols).toEqual({
      regionCode: 'REGION',
      regionLabel: 'Region',
      measureLabel: 'Measure',
      buildingTypeLabel: 'Building Type',
      seriesTypeLabel: 'Series Type',
    });
  });

  it('refuses a header offering no region column rather than guessing one', () => {
    expect(() => resolveColumns(['TIME_PERIOD', 'OBS_VALUE', 'Measure']))
      .toThrow(/0 region code column\(s\)/);
  });

  it('refuses a header offering two region label columns', () => {
    expect(() => resolveColumns(['REGION', 'Region', 'Local Government Area', 'TIME_PERIOD', 'OBS_VALUE']))
      .toThrow(/2 region label column\(s\)/);
  });
});

describe('the parse', () => {
  const parsed = () => parseAbsBuildingApprovals(download(), 'lga');

  it('reads every area, twenty-six months and three building types', () => {
    const out = parsed();
    expect(out.areas).toBe(205);
    expect(out.periods).toHaveLength(26);
    expect(out.latestPeriod).toBe('2026-02');
    expect(new Set(out.rows.map((r) => r.buildingType)))
      .toEqual(new Set(['house', 'other_residential', 'total_residential']));
  });

  it('puts the units and the value of one month on ONE row', () => {
    const row = parsed().rows.find(
      (r) => r.areaCode === '10050' && r.period === '2024-01' && r.buildingType === 'house',
    )!;
    expect(row.dwellingUnits).toBe(10);
    // UNIT_MULT 6 — millions, scaled to dollars.
    expect(row.value).toBe(5_000_000);
  });

  it('reads the state from the area code’s leading digit', () => {
    const out = parsed();
    expect(out.states.sort()).toEqual(['NSW', 'QLD', 'VIC']);
    expect(stateOfAreaCode('10050')).toBe('NSW');
    expect(stateOfAreaCode('AUS')).toBe('AU');
    expect(stateOfAreaCode('90000')).toBeNull();
    expect(stateOfAreaCode('  ')).toBeNull();
  });

  it('keeps only the Original series — or the count is three times itself', () => {
    // Every row seasonally adjusted: nothing survives the filter, so the
    // refusal is the "no row this loader recognises" one rather than a
    // register a third the size presented as whole.
    expect(() => parseAbsBuildingApprovals(download({ series: '20' }), 'lga'))
      .toThrow(/carries no row this loader recognises/);
  });

  it('records when there was no series column to filter on', () => {
    const noSeries = download()
      .split('\n')
      .map((line, i) => {
        const cells = line.split(',');
        cells.splice(5, 2); // TSEST and Series Type
        return i === 0 ? cells.join(',') : cells.join(',');
      })
      .join('\n');
    const out = parseAbsBuildingApprovals(noSeries, 'lga');
    expect(out.seriesTypeUnfiltered).toBe(true);
    expect(out.columns.seriesTypeLabel).toBeNull();
  });

  it('absent is never zero — a suppressed month stays null', () => {
    const suppressed = download({ units: (i) => (i === 0 ? 'np' : String(10 + (i % 40))) });
    const row = parseAbsBuildingApprovals(suppressed, 'lga').rows.find(
      (r) => r.areaCode === '10050' && r.period === '2024-01' && r.buildingType === 'house',
    )!;
    expect(row.dwellingUnits).toBeNull();
  });

  it('a genuine zero is kept, because a council that approved nothing is a fact', () => {
    const zeroed = download({ units: (i) => (i === 0 ? '0' : String(10 + (i % 40))) });
    const row = parseAbsBuildingApprovals(zeroed, 'lga').rows.find(
      (r) => r.areaCode === '10050' && r.period === '2024-01' && r.buildingType === 'house',
    )!;
    expect(row.dwellingUnits).toBe(0);
  });
});

describe('the refusals', () => {
  it('refuses an empty download', () => {
    expect(() => parseAbsBuildingApprovals('', 'lga')).toThrow(/is empty/);
  });

  it('refuses a header with no TIME_PERIOD', () => {
    expect(() => parseAbsBuildingApprovals('REGION,Region,OBS_VALUE\n1,A,2', 'lga'))
      .toThrow(/no "TIME_PERIOD" column/);
  });

  it('refuses a short walk as a truncated download, naming the count', () => {
    // Forty councils is not a small country; it is a body that stopped early.
    let message = '';
    try {
      parseAbsBuildingApprovals(download({ areas: 40 }), 'lga');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/names 40 lga areas, fewer than 200/);
    // It says what the body DID carry, so an operator can tell a truncated
    // walk from a body that is all rollup and no councils.
    expect(message).toMatch(/it carries 40 lga/);
    expect(message).toMatch(/truncated download, refused/);
  });

  it('refuses a series shorter than two years', () => {
    // The refusal names the range it DID hold, because "9 months" and
    // "9 months, all of them 2024" send an operator to different questions.
    expect(() => parseAbsBuildingApprovals(download({ months: 9 }), 'lga'))
      .toThrow(/holds 9 months \(2024-01 to 2024-09\), fewer than the 24 this read asked for/);
  });

  it('judges a PAGE against the window it asked for, not the register’s floor', () => {
    /*
     * A full SA2 load is eight requests of six months — 10.4 MB each against
     * 111.6 MB for the whole span — so judging a six-month page against a
     * twenty-four-month floor refuses every page of a healthy load. The
     * floor moves from a property of the DOWNLOAD to a property of the
     * REGISTER, asked of the table after a load rather than of each page
     * during one.
     */
    expect(() => parseAbsBuildingApprovals(download({ months: 6 }), 'lga', { minPeriods: 6 }))
      .not.toThrow();
    // And it is still a floor: a page short of what it asked for refuses.
    expect(() => parseAbsBuildingApprovals(download({ months: 3 }), 'lga', { minPeriods: 6 }))
      .toThrow(/holds 3 months.*fewer than the 6 this read asked for/);
  });

  it('defaults to the register’s floor, so an unpaged caller is unchanged', () => {
    // Widening what CAN be expressed must never widen what is accepted by
    // accident: omitting the option is byte-for-byte the previous behaviour.
    expect(() => parseAbsBuildingApprovals(download({ months: 9 }), 'lga'))
      .toThrow(/fewer than the 24 this read asked for/);
    expect(ABS_BA_PLAUSIBILITY.minPeriods).toBe(24);
  });

  it('refuses a unit drift rather than writing an implausible count', () => {
    const drifted = download({ units: (i) => (i === 0 ? '999999' : String(10 + (i % 40))) });
    expect(() => parseAbsBuildingApprovals(drifted, 'lga'))
      .toThrow(/reads 999999 dwelling units, outside 0–100000/);
  });
});

describe('the small readers', () => {
  it('monthPeriod takes a month or a first-of-month and nothing else', () => {
    expect(monthPeriod('2026-07')).toBe('2026-07');
    expect(monthPeriod('2026-07-01')).toBe('2026-07');
    expect(monthPeriod('2026-Q3')).toBeNull();
    expect(monthPeriod('2026-13')).toBeNull();
    expect(monthPeriod('')).toBeNull();
  });

  it('the grain ladder is finest-first and prices each grain', () => {
    expect(ABS_BA_GRAIN_LADDER.map((g) => g.areaKind)).toEqual(['sa2', 'lga', 'state']);
    const scores = ABS_BA_GRAIN_LADDER.map((g) => g.geographyScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('the subject pattern matches the release’s own words and not a neighbour', () => {
    expect(ABS_BA_NAME_PATTERN.test('Building Approvals by Local Government Area')).toBe(true);
    expect(ABS_BA_NAME_PATTERN.test('Building Activity, Australia')).toBe(false);
  });

  it('the plausibility floors are stated, not implied', () => {
    expect(ABS_BA_PLAUSIBILITY.minPeriods).toBe(24);
    expect(ABS_BA_PLAUSIBILITY.minAreas.lga).toBe(200);
  });

  it('the completions rule names all three states of a building', () => {
    expect(APPROVALS_ARE_NOT_COMPLETIONS).toMatch(/approv/i);
    expect(APPROVALS_ARE_NOT_COMPLETIONS).toMatch(/commenc/i);
    expect(APPROVALS_ARE_NOT_COMPLETIONS).toMatch(/complet/i);
  });
});

describe('the construction survey reports and never decides', () => {
  const CATALOGUE = xmlCatalogue([
    LGA_FLOW,
    ['BA_NONRES_LGA', '1.0.0', 'Building Approvals, Non-residential Building by Local Government Area'],
    ['ENGC', '1.0.0', 'Engineering Construction Activity, Australia'],
    ['BACT', '1.0.0', 'Building Activity, Value of Work Done, States and Territories'],
    ...NOISE,
  ]);

  it('finds every construction term, finest grain first', () => {
    const found = surveyConstructionFlows(CATALOGUE);
    expect(found.map((f) => f.ref)).toEqual([
      // Both LGA flows lead; within a grain the order is the reference, so it
      // is stable across catalogue reorderings.
      'ABS,BA_NONRES_LGA,1.0.0',
      'ABS,BUILDING_APPROVALS_LGA,1.0.0',
      'ABS,BACT,1.0.0',
      'ABS,ENGC,1.0.0',
    ]);
    expect(found[0].areaKind).toBe('lga');
    expect(found.find((f) => f.ref === 'ABS,ENGC,1.0.0')?.areaKind).toBeNull();
  });

  it('records every term a flow matched, not just the first', () => {
    const nonres = surveyConstructionFlows(CATALOGUE).find((f) => f.ref === 'ABS,BA_NONRES_LGA,1.0.0')!;
    expect(nonres.keys.sort()).toEqual(['building_approvals', 'non_residential']);
  });

  it('leaves a flow no construction term matches out entirely', () => {
    expect(surveyConstructionFlows(CATALOGUE).map((f) => f.ref)).not.toContain('ABS,CPI,1.1.0');
  });

  it('does NOT widen the selection \u2014 discovery is unchanged by the survey', () => {
    /*
     * The whole point. A survey that changed what gets loaded would be a
     * loader choosing a series because its name sounded relevant; the
     * selection stays the narrow, refuse-on-ambiguity rule it was, and the
     * survey is read by the `probe` stage alone.
     */
    expect(() => resolveBuildingApprovalsFlow(CATALOGUE))
      .toThrow(/refused rather than picking one/);
    expect(ABS_CONSTRUCTION_SURVEY.map((t) => t.key)).toContain('public_infrastructure');
  });

  it('carries the terms the coverage statement names as unreached', () => {
    // `INFRASTRUCTURE_COVERAGE_LIMITS` says council capital works and budget
    // infrastructure programmes are not reached. If the ABS publishes
    // anything at that grain, these are the words it would publish it under.
    const keys = ABS_CONSTRUCTION_SURVEY.map((t) => t.key);
    expect(keys).toEqual([
      'building_approvals', 'non_residential', 'engineering_construction',
      'building_activity', 'public_infrastructure',
    ]);
  });
});

/**
 * The ABS's own catalogue, as `abs-register-liveness` read it on 21 Sep 2026
 * (HTTP 200, 791,134 bytes). Not invented: these are the identifiers and the
 * names the Bureau publishes, and they are why the selection rule changed.
 */
const REAL_EDITIONS: Array<[string, string, string]> = [
  ['BA_SA2_201116', '1.0.0', 'Building Approvals by SA2 and above, July 2011 to June 2016'],
  ['BA_SA2_2016-21', '1.0.0', 'Building Approvals by SA2 and above, 2016 to 2021'],
  ['BA_SA2', '2.0.0', 'Building Approvals by SA2 and above, from July 2021 onwards'],
  ['BA_LGA2018', '1.0.0', 'Building Approvals by Local Government Area (LGA 2018)'],
  ['BA_LGA2021', '1.0.0', 'Building Approvals by Local Government Area (LGA 2021)'],
  ['BA_LGA2026', '1.0.0', 'Building Approvals by Local Government Area (LGA 2026)'],
  ['BA_GCCSA', '1.0.0', 'Building Approvals by Greater Capital Cities Statistical Area (GCCSA) and above'],
  ['BUILDING_ACTIVITY', '1.0.0', 'Building Activity'],
  ['EWD', '1.0.0', 'Engineering Construction Work Done, Preliminary'],
];

describe('one series cut into editions, read from the catalogue the ABS sent', () => {
  it('reads a declared END, and does not read one where the name declares a beginning', () => {
    expect(flowEdition({ agency: 'ABS', id: 'BA_SA2_201116', version: '1.0.0', name: REAL_EDITIONS[0][2] }))
      .toEqual({ closedAt: 2016, vintage: 2016 });
    // `2016 to 2021` closes in 2021 and is still finished.
    expect(flowEdition({ agency: 'ABS', id: 'BA_SA2_2016-21', version: '1.0.0', name: REAL_EDITIONS[1][2] }))
      .toEqual({ closedAt: 2021, vintage: 2021 });
    // "from July 2021 onwards" declares a beginning, not an end.
    expect(flowEdition({ agency: 'ABS', id: 'BA_SA2', version: '2.0.0', name: REAL_EDITIONS[2][2] }))
      .toEqual({ closedAt: null, vintage: 2021 });
    expect(flowEdition({ agency: 'ABS', id: 'BA_LGA2026', version: '1.0.0', name: REAL_EDITIONS[5][2] }))
      .toEqual({ closedAt: null, vintage: 2026 });
  });

  it('an open edition beats a closed one that reaches the same year', () => {
    // This is the pair the openness rule exists for: `BA_SA2_2016-21` carries
    // 2021 and so does `BA_SA2`, and only one of them is still being added to.
    const flows = [
      { agency: 'ABS', id: 'BA_SA2_2016-21', version: '1.0.0', name: REAL_EDITIONS[1][2] },
      { agency: 'ABS', id: 'BA_SA2', version: '2.0.0', name: REAL_EDITIONS[2][2] },
    ];
    expect(currentEdition(flows).chosen?.id).toBe('BA_SA2');
  });

  it('takes the latest vintage among the nine LGA editions', () => {
    const flows = [2018, 2021, 2026].map((y) => ({
      agency: 'ABS', id: `BA_LGA${y}`, version: '1.0.0',
      name: `Building Approvals by Local Government Area (LGA ${y})`,
    }));
    expect(currentEdition(flows).chosen?.id).toBe('BA_LGA2026');
  });

  it('resolves the REAL catalogue to the current SA2 edition', () => {
    /*
     * The regression this whole change exists for. Against the Bureau's own
     * catalogue the previous rule threw
     *   "names 3 building-approvals flows at sa2 grain — refused rather than
     *    picking one"
     * and a hardcoded identifier could have taken `BA_SA2_201116`, whose data
     * ends in June 2016, and presented a decade-old series as current supply.
     */
    const choice = resolveBuildingApprovalsFlow(xmlCatalogue(REAL_EDITIONS));
    expect(dataflowRef(choice.flow)).toBe('ABS,BA_SA2,2.0.0');
    expect(choice.areaKind).toBe('sa2');
    expect(choice.how).toBe('discovered');
    // Every edition that lost is still reported, so a sync row shows the
    // eight vintages behind the winner rather than only the winner.
    expect(choice.candidates.length).toBeGreaterThanOrEqual(7);
  });

  it('the survey reports the work-done series the LGA flows do not carry', () => {
    const found = surveyConstructionFlows(xmlCatalogue(REAL_EDITIONS));
    const ewd = found.find((f) => f.ref === 'ABS,EWD,1.0.0')!;
    expect(ewd.keys).toContain('engineering_construction');
    // And it declares no sub-state grain, which is the finding: engineering
    // construction is national/state, so LGA-grain evidence is approvals.
    expect(ewd.areaKind).toBeNull();
  });
});
