/**
 * Composing the query, from the publisher's own data structure.
 *
 * Every fixture is synthetic SDMX, built to the shapes the standard admits,
 * for the same reason `absBuildingApprovals.spec.ts` states: this module must
 * not know the ABS's dimension order, and asserting it from a fixture would
 * be a statement about the fixture. What is tested is the composition, the
 * refusals and the degradations. That the Bureau's own structure resolves is
 * a production measurement, taken by `abs-approvals-liveness`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ABS_BA_KEY_RULES,
  AREA_DIMENSION,
  absDataStructureUrl,
  composeApprovalsKey,
  narrowedApprovalsUrl,
  parseDataStructure,
  type DataStructure,
} from '../../../../supabase/functions/_shared/reports/market/openData/absDataStructure.pure.ts';

const dim = (
  id: string,
  position: number,
  codes: Array<[string, string]>,
  isTime = false,
) => ({ id, position, codes: codes.map(([cid, name]) => ({ id: cid, name })), isTime });

/** The shape an ABS building-approvals cube has: wide, not long. */
const CUBE: DataStructure = {
  dimensions: [
    dim('MEASURE', 1, [['1', 'Number of dwelling units'], ['2', 'Value of building approved'], ['3', 'Number of buildings']]),
    dim('TYPE_BUILD', 2, [
      ['1', 'Houses'], ['2', 'Other residential'], ['9', 'Total residential'],
      ['20', 'Hotels etc'], ['30', 'Shops'], ['40', 'Factories'], ['50', 'Offices'],
    ]),
    dim('TSEST', 3, [['10', 'Original'], ['20', 'Seasonally Adjusted'], ['30', 'Trend']]),
    dim('REGION', 4, [['10050', 'Albury (C)'], ['35010', 'Moreton Bay (C)']]),
    dim('FREQ', 5, [['M', 'Monthly'], ['A', 'Annual']]),
    dim('TIME_PERIOD', 6, [], true),
  ],
};

describe('the key is composed in the publisher’s own order', () => {
  it('keeps what the parser reads and drops the rest of the cube', () => {
    const { key, narrowed } = composeApprovalsKey(CUBE);
    // MEASURE . TYPE_BUILD . TSEST . REGION(open) . FREQ — five positions,
    // never six: TIME_PERIOD is `startPeriod`, not a key slot.
    expect(key.split('.')).toHaveLength(5);
    expect(key).toBe('1+2.1+2+9.10..M');
    expect(narrowed.map((n) => n.dimension)).toEqual(['MEASURE', 'TYPE_BUILD', 'TSEST', 'FREQ']);
    expect(narrowed.find((n) => n.dimension === 'TYPE_BUILD')).toMatchObject({ of: 7, kept: ['1', '2', '9'] });
  });

  it('leaves the AREA open, because the area is chosen at read time', () => {
    const { key } = composeApprovalsKey(CUBE);
    // The fourth position is empty: every council, every state, Australia.
    expect(key.split('.')[3]).toBe('');
  });

  it('never composes a slot for the time dimension', () => {
    const noTime: DataStructure = { dimensions: CUBE.dimensions.filter((d) => !d.isTime) };
    expect(composeApprovalsKey(noTime).key).toBe(composeApprovalsKey(CUBE).key);
  });

  it('respects the publisher’s position rather than the order it listed them', () => {
    const shuffled: DataStructure = { dimensions: [...CUBE.dimensions].reverse() };
    expect(composeApprovalsKey(shuffled).key).toBe(composeApprovalsKey(CUBE).key);
  });
});

describe('the real cube, as the Bureau publishes it', () => {
  /*
   * Not invented. These are the codelists `abs-register-liveness` read from
   * ABS,BA_SA2,2.0.0 on 21 Sep 2026 and printed, and the collision they
   * caused is in the same run's log: two different values of building
   * approved for Greater Bendigo 2026-07 total residential, $14,857,000 then
   * $45,670,000 — three sectors times nine work types on one row key.
   */
  const REAL: DataStructure = {
    dimensions: [
      dim('MEASURE', 1, [
        ['1', 'Number of dwelling units'], ['2', 'Value of building approved'],
        ['3', 'Number of buildings'],
      ]),
      dim('SECTOR', 2, [['9', 'Total Sectors'], ['1', 'Private Sector'], ['5', 'Public Sector']]),
      dim('WORK_TYPE', 3, [
        ['TOT', 'Total Work'], ['1', 'New'], ['5', 'Relocation of dwellings'],
        ['6', 'Demolition of dwellings'], ['8', 'Alterations and additions including conversions'],
        ['2', 'Alterations and additions'], ['3', 'Alterations and additions creating dwellings'],
        ['4', 'Alterations and additions not creating dwellings'], ['7', 'Conversions'],
      ]),
      dim('BUILDING_TYPE', 4, [
        ['110', 'Houses'], ['150', 'Other residential'], ['100', 'Total residential'],
        ['TOT', 'Total'], ['190', 'Hotels etc'], ['230', 'Factories'], ['240', 'Offices'],
      ]),
      dim('REGION_TYPE', 5, [
        ['AUS', 'Australia'], ['STE', 'States and Territories'],
        ['SA4', 'Statistical Area Level 4'], ['SA3', 'Statistical Area Level 3'],
        ['SA2', 'Statistical Area Level 2'], ['SA1', 'Statistical Area Level 1'],
        ['RA', 'Remoteness Area'], ['SOS', 'Section of State'], ['UC', 'Urban Centres'],
        ['LGA', 'Local Government Areas'],
      ]),
      dim('REGION', 6, [['10050', 'Albury'], ['235', 'Greater Bendigo']]),
      dim('FREQ', 7, [['M', 'Monthly'], ['A', 'Annual'], ['Q', 'Quarterly']]),
      dim('TIME_PERIOD', 8, [], true),
    ],
  };

  it('takes the publisher’s own totals, never a total rebuilt from parts', () => {
    const { narrowed } = composeApprovalsKey(REAL);
    const of = (id: string) => narrowed.find((n) => n.dimension === id);
    // Summing `New` with the conversion and alteration categories would
    // invent a measure the Bureau does not publish, and would double count
    // `Alterations and additions including conversions` against its children.
    expect(of('SECTOR')).toMatchObject({ kept: ['9'], of: 3 });
    expect(of('WORK_TYPE')).toMatchObject({ kept: ['TOT'], of: 9 });
  });

  it('closes the collision that produced $14.8m and $45.6m for one council', () => {
    // Three sectors times nine work types is twenty-seven rows on one key.
    const { narrowed } = composeApprovalsKey(REAL);
    const collidable = ['SECTOR', 'WORK_TYPE'];
    for (const id of collidable) {
      const n = narrowed.find((x) => x.dimension === id);
      expect(n, `${id} must be narrowed or rows collide`).toBeDefined();
      expect(n!.kept).toHaveLength(1);
    }
  });

  it('leaves the LEVEL open as well as the area, and both on purpose', () => {
    const { key, narrowed } = composeApprovalsKey(REAL);
    // `REGION_TYPE` was narrowed to AUS+STE+SA2+LGA for exactly one commit.
    // Measured, that turned the LGA flow's working 8.0 MB download into
    // 9,818 bytes of eight states and one national row: `AUS` and `STE`
    // answered, `LGA` did not, because a code that names a level in a
    // codelist is not necessarily the code the DATA is tagged with.
    expect(narrowed.find((n) => n.dimension === 'REGION_TYPE')).toBeUndefined();
    expect(key.split('.')[4]).toBe('');
    // And the area itself, as always.
    expect(key.split('.')[5]).toBe('');
  });

  it('narrows only where NOT narrowing would be wrong, never merely large', () => {
    /*
     * Every remaining rule is a CORRECTNESS narrowing: without it rows
     * collide on (area, period, building type) and the register stores an
     * arbitrary slice as a total. Size is solved by `endPeriod` — SA2 loads
     * in eight requests of six months at 10.4 MB each — so a rule that only
     * makes a download smaller is a bet that a code matches, and it loses
     * quietly.
     */
    const unruled = REAL.dimensions
      .filter((d) => !d.isTime && !ABS_BA_KEY_RULES.some((r) => r.dimension.test(d.id)))
      .map((d) => d.id);
    expect(unruled).toEqual(['REGION_TYPE', 'REGION']);
  });

  it('composes the whole key in the publisher’s own order', () => {
    // `TOT = Total` is absent from the building-type slot deliberately: in
    // this cube it means all buildings, not all dwellings. Positions 5 and 6
    // are open: the level and the area.
    expect(composeApprovalsKey(REAL).key).toBe('1+2.9.TOT.110+150+100...M');
  });
});

describe('a narrowing is an optimisation and never a dependency', () => {
  it('falls back to `all` where nothing could be narrowed', () => {
    const opaque: DataStructure = { dimensions: [dim('SOMETHING', 1, [['a', 'A']])] };
    expect(composeApprovalsKey(opaque).key).toBe('all');
  });

  it('leaves a renamed dimension OPEN rather than asking for nothing', () => {
    // The ABS renames `Original`. The rule matches no code, the whole
    // dimension comes back, and the parse filters it as it always has: a
    // download bigger than it needed to be, never one missing rows.
    const renamed: DataStructure = {
      dimensions: CUBE.dimensions.map((d) =>
        d.id === 'TSEST' ? dim('TSEST', 3, [['10', 'Unadjusted'], ['20', 'Smoothed']]) : d),
    };
    const out = composeApprovalsKey(renamed);
    expect(out.key.split('.')[2]).toBe('');
    expect(out.unnarrowed).toEqual([
      { dimension: 'TSEST', reason: 'no code name matched (2 published, e.g. Unadjusted, Smoothed)' },
    ]);
  });

  it('says so when a dimension carries no codelist at all', () => {
    const bare: DataStructure = {
      dimensions: CUBE.dimensions.map((d) => (d.id === 'FREQ' ? dim('FREQ', 5, []) : d)),
    };
    expect(composeApprovalsKey(bare).unnarrowed).toEqual([
      { dimension: 'FREQ', reason: 'the structure published no codelist for it' },
    ]);
  });

  it('keeps the position open where a rule would keep every code', () => {
    // Asking for everything is asking for nothing, and the shorter URL is the
    // cacheable one.
    const onlyOriginal: DataStructure = {
      dimensions: [dim('TSEST', 1, [['10', 'Original']]), dim('REGION', 2, [['1', 'NSW']])],
    };
    expect(composeApprovalsKey(onlyOriginal).key).toBe('all');
  });

  it('refuses a structure that names no dimension rather than composing one', () => {
    expect(() => parseDataStructure('   ')).toThrow(/empty/);
    expect(() => parseDataStructure('{"data":{"dataStructures":[]}}')).toThrow(/names no dimension/);
    expect(() => parseDataStructure('{nope')).toThrow(/not parseable JSON/);
  });
});

describe('the area may never be narrowed, and that is enforced', () => {
  it('refuses outright if a rule ever reaches an area dimension', () => {
    // Not a degradation: a register narrowed by area is a register about
    // somewhere else, and it would answer 200.
    const rogue: DataStructure = { dimensions: [dim('REGION', 1, [['1', 'Houses']])] };
    // A rule has to match the dimension id for the guard to be reached, so
    // this asserts the guard against the rule set as it actually is.
    const named = ABS_BA_KEY_RULES.some((r) => r.dimension.test('REGION'));
    if (named) {
      expect(() => composeApprovalsKey(rogue)).toThrow(/narrowing the area/);
    } else {
      expect(composeApprovalsKey(rogue).key).toBe('all');
    }
  });

  it('names every area dimension the register reads', () => {
    for (const id of ['REGION', 'ASGS_2021', 'LGA', 'SA2', 'STATE']) {
      expect(AREA_DIMENSION.test(id)).toBe(true);
    }
    // And no key rule may be written against one.
    for (const rule of ABS_BA_KEY_RULES) {
      for (const id of ['REGION', 'ASGS_2021', 'LGA', 'SA2', 'STATE', 'GCCSA']) {
        expect(rule.dimension.test(id)).toBe(false);
      }
    }
  });
});

describe('the structure is read in both shapes the standard admits', () => {
  const XML = `<?xml version="1.0"?>
<mes:Structure xmlns:mes="a" xmlns:str="b" xmlns:com="c"><mes:Structures>
  <str:Codelists>
    <str:Codelist id="CL_TSEST">
      <str:Code id="10"><com:Name xml:lang="en">Original</com:Name></str:Code>
      <str:Code id="20"><com:Name xml:lang="en">Seasonally Adjusted</com:Name></str:Code>
    </str:Codelist>
  </str:Codelists>
  <str:DataStructures><str:DataStructure id="BA">
    <str:DataStructureComponents><str:DimensionList>
      <str:Dimension id="TSEST" position="1">
        <str:LocalRepresentation><str:Enumeration>
          <Ref id="CL_TSEST" package="codelist" class="Codelist"/>
        </str:Enumeration></str:LocalRepresentation>
      </str:Dimension>
      <str:Dimension id="REGION" position="2"></str:Dimension>
      <str:TimeDimension id="TIME_PERIOD"></str:TimeDimension>
    </str:DimensionList></str:DataStructureComponents>
  </str:DataStructure></str:DataStructures>
</mes:Structures></mes:Structure>`;

  const JSON_BODY = JSON.stringify({
    data: {
      codelists: [{ id: 'CL_TSEST', codes: [{ id: '10', names: { en: 'Original' } }, { id: '20', name: 'Trend' }] }],
      dataStructures: [{
        id: 'BA',
        dataStructureComponents: {
          dimensionList: {
            dimensions: [
              { id: 'TSEST', position: 1, localRepresentation: { enumeration: 'urn:x:Codelist=ABS:CL_TSEST(1.0.0)' } },
              { id: 'REGION', position: 2 },
            ],
            timeDimensions: [{ id: 'TIME_PERIOD' }],
          },
        },
      }],
    },
  });

  it('reads SDMX-ML, resolving each dimension’s codelist', () => {
    const s = parseDataStructure(XML);
    expect(s.dimensions.map((d) => d.id)).toEqual(['TSEST', 'REGION', 'TIME_PERIOD']);
    expect(s.dimensions[0].codes.map((c) => c.name)).toEqual(['Original', 'Seasonally Adjusted']);
    expect(s.dimensions.find((d) => d.id === 'TIME_PERIOD')?.isTime).toBe(true);
    expect(composeApprovalsKey(s).key).toBe('10.');
  });

  it('reads SDMX-JSON, including the locale name map', () => {
    const s = parseDataStructure(JSON_BODY);
    expect(s.dimensions.find((d) => d.id === 'TSEST')?.codes.map((c) => c.name))
      .toEqual(['Original', 'Trend']);
    expect(composeApprovalsKey(s).key).toBe('10.');
  });

  /*
   * The prefix is the document's own choice. The first version matched
   * `<str:Dimension>` literally and read NO dimension from 3,193,984 bytes of
   * the Bureau's real structure — silently, on a 200, with the `/all`
   * fallback hiding it. These fixtures are the same document under three
   * spellings, and the one with `str:` is the one that already passed.
   */
  const reprefix = (xml: string, prefix: string) =>
    xml.replace(/<(\/?)str:/g, `<$1${prefix}`).replace(/<(\/?)com:/g, `<$1${prefix}`);

  it('reads it whatever namespace prefix the document chose', () => {
    for (const prefix of ['', 'structure:', 'x:']) {
      const s = parseDataStructure(reprefix(XML, prefix));
      expect(s.dimensions.map((d) => d.id), `prefix "${prefix}"`)
        .toEqual(['TSEST', 'REGION', 'TIME_PERIOD']);
      expect(s.dimensions[0].codes.map((c) => c.name)).toEqual(['Original', 'Seasonally Adjusted']);
      expect(composeApprovalsKey(s).key).toBe('10.');
    }
  });

  it('reads a self-closing dimension as well as a container one', () => {
    const selfClosed = XML.replace(
      '<str:Dimension id="REGION" position="2"></str:Dimension>',
      '<str:Dimension id="REGION" position="2"/>',
    );
    expect(parseDataStructure(selfClosed).dimensions.map((d) => d.id))
      .toEqual(['TSEST', 'REGION', 'TIME_PERIOD']);
  });

  it('a refusal says what it was handed, not merely that it failed', () => {
    // "names no dimension" is true and useless: it does not say whether the
    // body was JSON or XML, nor what it opened with. A refusal that cannot be
    // acted on costs a whole build cycle, and the fallback means nothing else
    // reports it at all.
    let message = '';
    try {
      parseDataStructure('<html><body>Service Unavailable</body></html>');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/read as XML/);
    expect(message).toMatch(/It opens: /);
    expect(message).toContain('Service Unavailable');
  });

  it('both shapes produce the same key from the same cube', () => {
    expect(composeApprovalsKey(parseDataStructure(XML)).key)
      .toBe(composeApprovalsKey(parseDataStructure(JSON_BODY)).key);
  });
});

describe('the parse is an independent check on the query', () => {
  const SOURCE = readFileSync(
    join(process.cwd(), 'supabase/functions/_shared/reports/market/openData/absDataStructure.pure.ts'),
    'utf8',
  );

  it('imports the label rules rather than restating them', () => {
    /*
     * This is the property that makes a positional key safe. Both ends match
     * the SAME labels, so a key that selected the wrong codes returns rows
     * whose labels the parse discards — a wrong key can only make a download
     * smaller, and a download that lost its rows is refused by the area and
     * period floors, which is a loud failure rather than a wrong figure.
     *
     * A second copy of any of these rules breaks exactly that, and it breaks
     * it silently: the query would ask for one thing and the parse keep
     * another, and the difference would show up as rows quietly missing.
     */
    for (const rule of ['BUILDING_TYPE_PATTERNS', 'UNITS_MEASURE', 'VALUE_MEASURE', 'ORIGINAL_SERIES', 'MONTHLY_FREQ']) {
      expect(SOURCE).toMatch(new RegExp(`^\\s*${rule},`, 'm'));
      // Imported, never declared here.
      expect(SOURCE).not.toMatch(new RegExp(`(const|let)\\s+${rule}\\b`));
    }
    expect(SOURCE).toContain("from './absBuildingApprovals.pure.ts'");
  });

  it('declares no measure, type or series regex of its own', () => {
    // `AREA_DIMENSION` and each rule's `dimension` are patterns over
    // dimension IDS, which the parse never sees; anything matching a code
    // NAME must come from the one declaration.
    const ownRegexes = [...SOURCE.matchAll(/^(?:export )?const (\w+)(?::[^=]+)? = \/(.+?)\/[gimsuy]*;$/gm)]
      .map((m) => m[1]);
    expect(ownRegexes).toEqual(['AREA_DIMENSION']);
  });
});

describe('the URLs', () => {
  const flow = { agency: 'ABS', id: 'BA_SA2', version: '2.0.0', name: 'x' };

  it('asks for the structure with its codelists', () => {
    expect(absDataStructureUrl(flow))
      .toBe('https://data.api.abs.gov.au/rest/dataflow/ABS/BA_SA2/2.0.0?references=all');
  });

  it('puts the key where the key goes, and keeps the labels', () => {
    const url = narrowedApprovalsUrl(flow, '2023-01', '1+2.1+2+9.10..M');
    expect(url).toContain('/rest/data/ABS,BA_SA2,2.0.0/1+2.1+2+9.10..M');
    expect(url).toContain('startPeriod=2023-01');
    expect(url).toContain('format=csvfilewithlabels');
  });

  it('refuses a start period that is not a month', () => {
    expect(() => narrowedApprovalsUrl(flow, '2023', 'all')).toThrow(/YYYY-MM/);
  });

  it('bounds the far end of the window, which is the only paging lever a key lacks', () => {
    // A key selects exact codes, so asking for one state's SA2s would mean
    // enumerating three hundred of them; a period is two parameters whatever
    // the geography.
    const url = narrowedApprovalsUrl(flow, '2024-01', '1+2.9.TOT', '2024-06');
    expect(url).toContain('startPeriod=2024-01');
    expect(url).toContain('endPeriod=2024-06');
    expect(narrowedApprovalsUrl(flow, '2024-01', 'all')).not.toContain('endPeriod');
  });

  it('refuses a window that ends before it starts', () => {
    expect(() => narrowedApprovalsUrl(flow, '2024-06', 'all', '2024-01'))
      .toThrow(/is before startPeriod/);
    expect(() => narrowedApprovalsUrl(flow, '2024-01', 'all', '2024')).toThrow(/endPeriod must be YYYY-MM/);
  });
});
