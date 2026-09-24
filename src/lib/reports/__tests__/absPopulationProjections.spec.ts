/**
 * W3.3 — forward demand, and the premise that had never been checked.
 *
 * Every fixture here is an ASGS-shaped codelist written to the ABS's own
 * conventions. The Bureau's own bytes are verified separately and from CI by
 * `scripts/market/abs-projection-liveness.ts`, because this egress answers
 * 403 to CONNECT for `data.api.abs.gov.au` — which is why a fixture suite
 * alone is never the verification here, only the shape.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  A_PROJECTION_IS_NOT_A_MEASUREMENT,
  AREA_GRAINS,
  ESTIMATE_NAME_PATTERN,
  GRAIN_PRESENCE_FLOOR,
  PROJECTION_GRAIN_LABEL,
  PROJECTION_GRAIN_ORDER,
  PROJECTION_NAME_PATTERN,
  classifyRegionCodes,
  describesTheArea,
  finestPublishedGrain,
  grainOfRegionCode,
  readProjectionStructure,
  surveyPopulationFlows,
  type ProjectionGrain,
} from '@/lib/reports/../../../supabase/functions/_shared/reports/market/openData/absPopulationProjections.pure';
import {
  ABS_SDMX_CSV_ACCEPT,
  ABS_SDMX_STRUCTURE_ACCEPT,
  isOurRequestFault,
} from '@/lib/reports/../../../supabase/functions/_shared/reports/market/openData/absDataStructure.pure';
import { regionalTrendBlocks } from '@/lib/reports/../../../supabase/functions/_shared/reports/regionalPromptBlocks.pure';
import { PROJECTION_FILES } from '../../../../supabase/functions/_shared/reports/market/openData/stateProjectionFiles.pure';
import {
  FORWARD_DEMAND_PUBLISHERS,
  assessForwardDemand,
  forwardDemandCoverageNote,
  trustedStateForForwardDemand,
} from '@/lib/reports/../../../supabase/functions/_shared/reports/market/openData/forwardDemand.pure';
import type {
  DataStructure,
  StructureDimension,
} from '@/lib/reports/../../../supabase/functions/_shared/reports/market/openData/absDataStructure.pure';

function dim(id: string, codes: string[], opts: { position?: number; isTime?: boolean; names?: string[] } = {}): StructureDimension {
  return {
    id,
    position: opts.position ?? 1,
    isTime: opts.isTime ?? false,
    codes: codes.map((c, i) => ({ id: c, name: opts.names?.[i] ?? `Area ${c}` })),
  };
}

/** n distinct SA2 codes — nine digits, as the ABS publishes them. */
const sa2Codes = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => String(101021007 + i));
const sa3Codes = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => String(10102 + i));
const STATES = ['1', '2', '3', '4', '5', '6', '7', '8'];

describe('the shape of a region code is the grain', () => {
  it('reads each ASGS level from its own fixed width', () => {
    expect(grainOfRegionCode('101021007')).toBe('sa2');
    expect(grainOfRegionCode('10102')).toBe('sa3');
    expect(grainOfRegionCode('101')).toBe('sa4');
    expect(grainOfRegionCode('1')).toBe('state');
    expect(grainOfRegionCode('AUS')).toBe('national');
    expect(grainOfRegionCode('0')).toBe('national');
  });

  it('tells an LGA from an SA3 by the DIMENSION, because the codes are alike', () => {
    // Both are five digits. Nothing in the code itself distinguishes them, so
    // guessing from the code would file every council area as a group of
    // suburbs — a finer grain than the publisher offered.
    expect(grainOfRegionCode('10102')).toBe('sa3');
    expect(grainOfRegionCode('10102', true)).toBe('lga');
  });

  it('refuses a blank rather than parsing it, because Number("") is 0', () => {
    /*
     * The urban-centre register paid for this one: a feature with no point
     * parsed as (0, 0) and was stopped only by the continent bounds. Here a
     * blank that parsed would classify as `national`, which is a real grain
     * and would be filed as coverage.
     */
    expect(grainOfRegionCode('')).toBeNull();
    expect(grainOfRegionCode('   ')).toBeNull();
    expect(grainOfRegionCode('  1  ')).toBe('state');
  });

  it('places a two-digit code at the capital-city / rest-of-state level', () => {
    /*
     * MEASURED, not inferred. The first live read reported 14 codes this rule
     * could not place; the census was changed to carry their published names
     * and the next run answered `61 Hobart`, `62 Rest of Tas`, `71 Darwin`,
     * `72 Rest of NT`. Seven states split two ways plus an unsplit ACT is
     * exactly the 14 the census counted.
     */
    expect(grainOfRegionCode('11')).toBe('gccsa');
    expect(grainOfRegionCode('62')).toBe('gccsa');
    expect(grainOfRegionCode('1GSYD')).toBe('gccsa');
    expect(grainOfRegionCode('RNSW')).toBe('gccsa');
    // A capital city is still not this property's area.
    expect(describesTheArea('gccsa')).toBe(false);
  });

  it('and the label covers BOTH halves of that level', () => {
    // `Rest of Tas` is not a metropolitan area, so a label saying so would be
    // wrong for half the codes at this grain.
    expect(PROJECTION_GRAIN_LABEL.gccsa).toMatch(/capital city/i);
    expect(PROJECTION_GRAIN_LABEL.gccsa).toMatch(/outside/i);
    expect(PROJECTION_GRAIN_LABEL.gccsa).not.toMatch(/metropolitan area$/i);
  });

  it('places nothing it does not recognise', () => {
    expect(grainOfRegionCode('TOT')).toBeNull();
    expect(grainOfRegionCode('9')).toBeNull();
    // A second digit outside the split.
    expect(grainOfRegionCode('13')).toBeNull();
    expect(grainOfRegionCode('99')).toBeNull();
  });
});

describe('the census answers the premise', () => {
  it('counts a codelist by grain and reports what it could not place', () => {
    const census = classifyRegionCodes(dim('REGION', [...sa2Codes(3), ...STATES, 'AUS', 'TOT']));
    expect(census.counts.sa2).toBe(3);
    expect(census.counts.state).toBe(8);
    expect(census.counts.national).toBe(1);
    // With their NAMES — the first live run's 14 unplaced ids were the
    // evidence that the classifier was understating the grain, and a bare id
    // could not say what it was.
    expect(census.unplaced.map((c) => c.id)).toEqual(['TOT']);
    expect(census.unplaced[0].name).toBeTruthy();
    expect(census.dimensionId).toBe('REGION');
  });

  it('a single stray SA2 is not SA2 coverage', () => {
    /*
     * The floor is what stops W3.3's premise being answered `yes` off one row
     * in somebody's codelist. Australia has ~2,500 SA2s; a flow holding three
     * is not publishing them.
     */
    const census = classifyRegionCodes(dim('REGION', [...sa2Codes(3), ...STATES, 'AUS']));
    expect(finestPublishedGrain(census)).toBe('state');
    expect(census.counts.sa2).toBe(3);
  });

  it('and a real SA2 codelist is', () => {
    const census = classifyRegionCodes(dim('REGION', [...sa2Codes(GRAIN_PRESENCE_FLOOR), ...STATES]));
    expect(finestPublishedGrain(census)).toBe('sa2');
  });

  it('prefers the finest grain that cleared the floor', () => {
    const census = classifyRegionCodes(dim('REGION', [...sa3Codes(40), ...STATES, 'AUS']));
    expect(finestPublishedGrain(census)).toBe('sa3');
  });

  it('answers null where nothing cleared it', () => {
    expect(finestPublishedGrain(classifyRegionCodes(dim('REGION', ['TOT', 'XX'])))).toBeNull();
  });

  it('every grain in the order has a label a reader can use', () => {
    for (const grain of PROJECTION_GRAIN_ORDER) {
      expect(PROJECTION_GRAIN_LABEL[grain as ProjectionGrain], grain).toBeTruthy();
      // Database vocabulary never reaches the reader — partnerRoster's rule.
      expect(PROJECTION_GRAIN_LABEL[grain as ProjectionGrain], grain).not.toMatch(/_/);
    }
  });
});

describe('an estimate is refused, and named', () => {
  const flows = [
    { agency: 'ABS', id: 'POP_PROJ', version: '1.0.0', name: 'Population Projections, Australia' },
    { agency: 'ABS', id: 'ERP_ASGS', version: '1.0.0', name: 'Regional Population by SA2' },
    { agency: 'ABS', id: 'ERP_Q', version: '1.0.0', name: 'National, state and territory population' },
    { agency: 'ABS', id: 'BA_SA2', version: '2.0.0', name: 'Building Approvals by SA2' },
  ];

  it('admits a projection and refuses an estimate, keeping both visible', () => {
    const surveyed = surveyPopulationFlows(flows);
    expect(surveyed.map((s) => [s.entry.id, s.kind])).toEqual([
      ['POP_PROJ', 'projection'],
      ['ERP_ASGS', 'estimate'],
      ['ERP_Q', 'estimate'],
    ]);
  });

  it('an estimate wins a tie, because history under a forward heading is the worst outcome', () => {
    const surveyed = surveyPopulationFlows([{
      agency: 'ABS', id: 'X', version: '1.0.0',
      name: 'Population Projections — Estimated Resident Population base',
    }]);
    expect(surveyed[0].kind).toBe('estimate');
  });

  it('the two rules cannot both be satisfied by a clean projection title', () => {
    // A title the ABS actually uses must be admissible, or the refusal rule
    // has swallowed the subject.
    expect(PROJECTION_NAME_PATTERN.test('Population Projections, Australia')).toBe(true);
    expect(ESTIMATE_NAME_PATTERN.test('Population Projections, Australia')).toBe(false);
  });

  it('ignores a flow that is about neither', () => {
    expect(surveyPopulationFlows([{ agency: 'ABS', id: 'CPI', version: '1.0.0', name: 'Consumer Price Index' }]))
      .toEqual([]);
  });
});

describe('the ABS models assumptions as a CROSS-PRODUCT, measured', () => {
  /*
   * The five tests that used to sit here asserted a single `SERIES` dimension
   * with a `medium` code to match by name. Run against the Bureau's own
   * structures they were pinning MY model rather than the publisher's: all
   * four projection flows carry no series dimension at all, and instead
   *
   *     FERTILITY 3 · MORTALITY 2 · NOM 4 · NIM 3
   *
   * which is 72 combinations. `CENTRAL_SERIES_PATTERN` had nothing to match
   * and reported `UNMATCHED`, which read as a gap in the Bureau's metadata
   * when it was a gap in mine. Renegotiated against what was measured — the
   * same lesson the six contract tests in `A_PREMIUM_DOCUMENT.md` §21 taught,
   * where every one was pinning the defect it asserted.
   */
  const absShaped = (): DataStructure => ({
    dimensions: [
      dim('REGION', [...STATES, 'AUS'], { position: 1 }),
      dim('SEX_ABS', ['1', '2', '3'], { position: 2 }),
      dim('AGE', Array.from({ length: 194 }, (_, i) => `A${i}`), { position: 3 }),
      dim('FERTILITY', ['1', '2', '3'], { position: 4, names: ['High fertility', 'Medium fertility', 'Low fertility'] }),
      dim('MORTALITY', ['1', '2'], { position: 5, names: ['High life expectancy', 'Medium life expectancy'] }),
      dim('NOM', ['1', '2', '3', '4'], { position: 6, names: ['NOM 1', 'NOM 2', 'NOM 3', 'NOM 4'] }),
      dim('NIM', ['1', '2', '3'], { position: 7, names: ['NIM 1', 'NIM 2', 'NIM 3'] }),
      dim('FREQUENCY', ['A'], { position: 8, names: ['Annual'] }),
      dim('TIME_PERIOD', [], { position: 9, isTime: true }),
    ],
  });

  it('a default would print the maximum-growth corner of a 72-cell space', () => {
    /*
     * The measured choice names are what make this concrete. Taking the first
     * code from each — the obvious default — yields "High fertility, High
     * life expectancy, High NOM, Large interstate flows", and one of NOM's
     * four choices is **Zero NOM**, a sensitivity case nobody would call a
     * forecast. A single `series` field would have invited exactly this.
     */
    const reading = readProjectionStructure(absShaped());
    const firstOfEach = reading.assumptions.map((a) => a.choices[0].name);
    expect(firstOfEach).toEqual(['High fertility', 'High life expectancy', 'NOM 1', 'NIM 1']);
    // Nothing in the module may make that choice.
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../supabase/functions/_shared/reports/market/openData/absPopulationProjections.pure.ts',
      ),
      'utf8',
    );
    expect(source.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/choices\s*\[\s*0\s*\]/);
  });

  it('names every assumption a figure rests on, and counts the combinations', () => {
    const reading = readProjectionStructure(absShaped());
    expect(reading.seriesDimensionId).toBeNull();
    expect(reading.assumptions.map((a) => a.id)).toEqual(['FERTILITY', 'MORTALITY', 'NOM', 'NIM']);
    expect(reading.combinations).toBe(3 * 2 * 4 * 3);
  });

  it('excludes what SLICES a projection from what ASSUMES about it', () => {
    /*
     * `SEX_ABS` and `AGE` cut a projection; they are not scenarios. Listing
     * 194 age codes among the assumptions would drown the four that matter
     * and would make `combinations` a meaningless number.
     */
    const reading = readProjectionStructure(absShaped());
    expect(reading.assumptions.map((a) => a.id)).not.toContain('AGE');
    expect(reading.assumptions.map((a) => a.id)).not.toContain('SEX_ABS');
    expect(reading.assumptions.map((a) => a.id)).not.toContain('FREQUENCY');
  });

  it('carries the publisher’s own choice names, so a reading can quote them', () => {
    const reading = readProjectionStructure(absShaped());
    const fertility = reading.assumptions.find((a) => a.id === 'FERTILITY');
    expect(fertility?.choices.map((c) => c.name))
      .toEqual(['High fertility', 'Medium fertility', 'Low fertility']);
  });

  it('picks no combination — there is none to default to', () => {
    /*
     * The Bureau documents which combinations are its main projections; a
     * codelist does not say so, and nothing here may guess. So the reading
     * REPORTS the dimensions and a caller wanting a figure is handed a
     * combination explicitly.
     */
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../supabase/functions/_shared/reports/market/openData/absPopulationProjections.pure.ts',
      ),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // No default, no "first choice", no chosen scenario anywhere.
    expect(code).not.toMatch(/choices\s*\[\s*0\s*\]/);
    expect(code).not.toMatch(/\bcentralSeries\b/);
  });

  it('derives the assumptions rather than listing them, so a fifth is not dropped', () => {
    // A publisher adding an assumption must not have it silently fall out of
    // a reading's provenance.
    const withFifth = absShaped();
    withFifth.dimensions.splice(7, 0, dim('HOUSEHOLD_FORMATION', ['1', '2'], { position: 8 }));
    const reading = readProjectionStructure(withFifth);
    expect(reading.assumptions.map((a) => a.id)).toContain('HOUSEHOLD_FORMATION');
    expect(reading.combinations).toBe(3 * 2 * 4 * 3 * 2);
  });

  it('still reads a single series dimension where a publisher models one', () => {
    // Kept, because another publisher may. It is simply not the ABS's shape.
    const reading = readProjectionStructure({
      dimensions: [
        dim('REGION', [...STATES], { position: 1 }),
        dim('SERIES', ['A', 'B', 'C'], { position: 2, names: ['High series', 'Medium series', 'Low series'] }),
        dim('TIME_PERIOD', [], { position: 3, isTime: true }),
      ],
    });
    expect(reading.seriesDimensionId).toBe('SERIES');
    expect(reading.seriesNames).toEqual(['High series', 'Medium series', 'Low series']);
  });

  it('reads the region census and the finest grain off the same structure', () => {
    const reading = readProjectionStructure(absShaped());
    expect(reading.region?.dimensionId).toBe('REGION');
    expect(reading.finestGrain).toBe('state');
  });

  it('excludes the time dimension from the geography search', () => {
    const reading = readProjectionStructure(absShaped());
    expect(reading.dimensions.find((d) => d.isTime)?.id).toBe('TIME_PERIOD');
    expect(reading.region?.dimensionId).not.toBe('TIME_PERIOD');
  });

  it('answers null for a structure naming no geography it knows', () => {
    const reading = readProjectionStructure({ dimensions: [dim('MEASURE', ['1'])] });
    expect(reading.region).toBeNull();
    expect(reading.finestGrain).toBeNull();
    expect(reading.combinations).toBe(1);
  });
});

describe('a projection about a region is not a projection about the area', () => {
  it('only a suburb or a group of suburbs describes the property’s area', () => {
    /*
     * `MARKET_FIGURES_IN_THE_REPORT.md`'s rule applied to a forecast: a
     * benchmark is drawn apart, because a state figure beside a suburb one
     * reads as the suburb's.
     */
    expect(AREA_GRAINS).toEqual(['sa2', 'sa3']);
    expect(describesTheArea('sa2')).toBe(true);
    expect(describesTheArea('sa3')).toBe(true);
    expect(describesTheArea('sa4')).toBe(false);
    expect(describesTheArea('gccsa')).toBe(false);
    expect(describesTheArea('state')).toBe(false);
    expect(describesTheArea('national')).toBe(false);
  });
});

describe('a projection is not a measurement, and the type says so', () => {
  const source = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../supabase/functions/_shared/reports/market/openData/absPopulationProjections.pure.ts',
    ),
    'utf8',
  );

  it('never imports or constructs an EvidencePoint', () => {
    /*
     * `EvidencePoint.value`'s own documentation is "The measurement. A zero
     * here is a measured zero", every consumer of it feeds the scorer, and
     * `EvidenceProvider` is a closed union of measurement providers. Handing
     * a modelled forecast that type is how a forecast comes to be scored as a
     * measurement, so the module is asserted unable to produce one.
     */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/EvidencePoint/);
    expect(code).not.toMatch(/marketEvidence\.pure/);
  });

  it('carries the sentence that travels with every projected figure', () => {
    expect(A_PROJECTION_IS_NOT_A_MEASUREMENT).toMatch(/assumption set/i);
    expect(A_PROJECTION_IS_NOT_A_MEASUREMENT).toMatch(/not a measurement/i);
    // It must not promise the future either way.
    expect(A_PROJECTION_IS_NOT_A_MEASUREMENT).toMatch(/not a forecast of what will occur/i);
  });

  it('states no growth rate, no year and no population anywhere in the module', () => {
    // The `planningControlGuide` rule: a guide explains a control and carries
    // no figure, which is what lets it be written in advance and stay true.
    // A URL is an address, not prose: Tasmania's measured page carries its
    // edition's year in its path, and that states nothing about the area.
    const prose = (source.match(/'[^']{20,}'/g) ?? []).filter((l) => !/^'https?:\/\//.test(l));
    for (const line of prose) {
      expect(line, line).not.toMatch(/\b(19|20)\d{2}\b/);
      expect(line, line).not.toMatch(/\d+(\.\d+)?\s*%/);
    }
  });
});

describe('W3.3’s word is "everywhere"', () => {
  const JURISDICTIONS = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'] as const;

  it('names a publisher and a product for all eight, and says it reads exactly the ones its loader does', () => {
    /*
     * The acceptance is that "no forward projection" is replaced EVERYWHERE
     * rather than in one state. Loading one jurisdiction replaces the sentence
     * for its properties and leaves it standing for the other seven, which is
     * the failure the criterion names in advance.
     */
    for (const j of JURISDICTIONS) {
      const pub = FORWARD_DEMAND_PUBLISHERS[j];
      expect(pub, j).toBeDefined();
      expect(pub.publisher.length, j).toBeGreaterThan(12);
      expect(pub.product.length, j).toBeGreaterThan(8);
      expect(pub.url, j).toMatch(/^https:\/\//);
      // Derived, never typed: true exactly where the loader holds a file for
      // the jurisdiction whose licence has been read from its publisher. The
      // day one is loaded, the flag and the sentence change together rather
      // than one being forgotten.
      expect(pub.ingested, j).toBe(PROJECTION_FILES.some((f) => f.state === j && f.licence !== null));
    }
    expect(Object.keys(FORWARD_DEMAND_PUBLISHERS).sort()).toEqual([...JURISDICTIONS].sort());
  });

  it('never says a jurisdiction publishes no projection', () => {
    for (const j of JURISDICTIONS) {
      const note = forwardDemandCoverageNote({ kind: 'not_loaded' }, j);
      expect(note, j).toContain(FORWARD_DEMAND_PUBLISHERS[j].publisher);
      expect(note, j).toContain(FORWARD_DEMAND_PUBLISHERS[j].url);
      expect(note, j).not.toMatch(/publishes no|has no (?:forward |population )?projection/i);
    }
  });

  it('states no grain for a publisher it cannot reach', () => {
    /*
     * An earlier draft carried the finest grain each jurisdiction publishes
     * at. It was removed rather than softened: nothing in this repository can
     * reach these publishers to check it, so a grain here would be a claim
     * about somebody else's product that no gate could verify.
     */
    const source = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../supabase/functions/_shared/reports/market/openData/forwardDemand.pure.ts',
      ),
      'utf8',
    );
    // The table LITERAL alone. A wider slice runs into the availability type,
    // whose own documentation discusses grain legitimately — and a guard that
    // reads the wrong span is the `limited certificate` bound again.
    const opens = source.indexOf('export const FORWARD_DEMAND_PUBLISHERS');
    const table = source.slice(opens, source.indexOf('\n};', opens));
    expect(table).toContain('NSW:');
    expect(table).not.toMatch(/\bsa[234]\b/i);
    expect(table).not.toMatch(/grain/i);
    expect(table).not.toMatch(/statistical area/i);
  });
});

describe('the eight forward-demand readings', () => {
  /*
   * Five from the national floor, three from the register (23 Sep 2026): a
   * jurisdiction held and the area not named in it, a property whose area was
   * never resolved, and a caller that never read the register at all — which
   * is what the regeneration path is, and why `not_loaded` stopped being a
   * safe default the day one jurisdiction loaded.
   */
  const readings = [
    { kind: 'projected', grain: 'sa2' },
    { kind: 'coarser_than_area', grain: 'state' },
    { kind: 'grain_not_published', finest: 'state' },
    { kind: 'not_loaded' },
    { kind: 'unavailable', reason: 'HTTP 503' },
    { kind: 'area_not_named' },
    { kind: 'no_area_resolved' },
    { kind: 'not_read' },
  ] as const;

  it('resolves each from what was actually read', () => {
    expect(assessForwardDemand({ grainHeld: 'sa2', finestPublished: 'sa2', loaded: true }).kind)
      .toBe('projected');
    expect(assessForwardDemand({ grainHeld: 'state', finestPublished: 'state', loaded: true }).kind)
      .toBe('coarser_than_area');
    expect(assessForwardDemand({ grainHeld: null, finestPublished: 'state', loaded: true }).kind)
      .toBe('grain_not_published');
    expect(assessForwardDemand({ grainHeld: null, finestPublished: null, loaded: false }).kind)
      .toBe('not_loaded');
    expect(assessForwardDemand({ grainHeld: 'sa2', finestPublished: 'sa2', loaded: true, failure: 'HTTP 503' }).kind)
      .toBe('unavailable');
  });

  it('a failure outranks everything, because a bad read is not a reading', () => {
    // `grainHeld: 'sa2'` and `loaded: true` beside a failure would otherwise
    // print a projection from a retrieval that did not complete.
    const r = assessForwardDemand({ grainHeld: 'sa2', finestPublished: 'sa2', loaded: true, failure: 'timeout' });
    expect(r.kind).toBe('unavailable');
    if (r.kind !== 'unavailable') return;
    expect(r.reason).toBe('timeout');
  });

  it('writes eight distinct sentences', () => {
    const notes = readings.map((r) => forwardDemandCoverageNote(r, 'NSW'));
    expect(new Set(notes).size).toBe(8);
  });

  /*
   * Where the jurisdiction IS held, "which this report does not read" is
   * false — the register was read and answered for somewhere else. The route
   * is still owed; that clause is not.
   */
  it('never says it does not read a register it read', () => {
    const held = forwardDemandCoverageNote({ kind: 'area_not_named' }, 'SA');
    expect(held).toContain(FORWARD_DEMAND_PUBLISHERS.SA.publisher);
    expect(held).toContain(FORWARD_DEMAND_PUBLISHERS.SA.url);
    expect(held).not.toMatch(/does not read/);
    expect(held).toMatch(/line up with this property/);
    // And the reading that DID not read says so, whichever jurisdiction.
    expect(forwardDemandCoverageNote({ kind: 'not_read' }, 'SA')).toMatch(/does not read a population projection/);
  });

  it('keeps "not loaded" about the jurisdiction, not the whole deployment', () => {
    expect(forwardDemandCoverageNote({ kind: 'not_loaded' }, 'NSW'))
      .toMatch(/No population projection for this jurisdiction has been loaded by this deployment/);
  });

  it('separates a caveat on a printed figure from the absence of one', () => {
    /*
     * The two that would otherwise collapse. `coarser_than_area` qualifies a
     * figure that IS printed; `grain_not_published` says none exists for an
     * area this size. Collapsing them either drops a real reading or implies
     * one that was never held.
     */
    const coarse = forwardDemandCoverageNote({ kind: 'coarser_than_area', grain: 'state' }, 'NSW');
    const absent = forwardDemandCoverageNote({ kind: 'grain_not_published', finest: 'state' }, 'NSW');
    expect(coarse).toMatch(/drawn apart/i);
    expect(coarse).toMatch(/region this property sits in/i);
    expect(absent).toMatch(/No population projection is held/i);
    expect(absent).not.toMatch(/drawn apart/i);
  });

  it('every reading carries the sentence, or says why there is no figure', () => {
    for (const r of readings) {
      const note = forwardDemandCoverageNote(r, 'VIC');
      const qualifies = note.includes('not a measurement') || /no projected figure|No population projection is held/i.test(note);
      expect(qualifies, r.kind).toBe(true);
    }
  });

  it('rates nothing, in either direction', () => {
    /*
     * §9's rule and its mirror: an absence may not be rated, and a presence
     * may not be either. This module prints no level and no direction — a
     * projection that "shows strong growth" is a conclusion, not a retrieval.
     */
    const forbidden = /\b(strong|weak|low|high|minimal|negligible|favourable|robust|poor|growing|declining|rising|falling)\b/i;
    for (const j of ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT', 'ZZ']) {
      for (const r of readings) {
        expect(forwardDemandCoverageNote(r, j), `${j}/${r.kind}`).not.toMatch(forbidden);
      }
    }
  });

  it('an unknown jurisdiction states the limit as ours', () => {
    const note = forwardDemandCoverageNote({ kind: 'not_loaded' }, 'ZZ');
    expect(note).toMatch(/limit of this report rather than a finding about the area/i);
  });

  it('states no figure, no year and no rate in any branch', () => {
    for (const j of ['NSW', 'ZZ']) {
      for (const r of readings) {
        const note = forwardDemandCoverageNote(r, j);
        expect(note, r.kind).not.toMatch(/\b(19|20)\d{2}\b/);
        expect(note, r.kind).not.toMatch(/\d+(\.\d+)?\s*%/);
      }
    }
  });
});

describe('the instrument must not fail the way its subject fails', () => {
  it('names one Accept header, because it was typed twice and then wrong', () => {
    /*
     * The first run of the projection probe sent
     * `application/vnd.sdmx.structure+xml;version=1.0` — XML instead of JSON,
     * with no wildcard fallback — took HTTP 406 on every flow, and printed
     * "THE PREMISE DOES NOT HOLD" over `flows read 0`. The approvals probe
     * already carried the working header as a literal, TWICE.
     */
    expect(ABS_SDMX_STRUCTURE_ACCEPT).toContain('application/vnd.sdmx.structure+json');
    expect(ABS_SDMX_STRUCTURE_ACCEPT).toContain('*/*');
    expect(ABS_SDMX_CSV_ACCEPT).toContain('text/csv');

    const probes = ['abs-projection-liveness.ts', 'abs-approvals-liveness.ts'].map((f) =>
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/market', f), 'utf8'));
    for (const source of probes) {
      // No probe may retype either header.
      expect(source).not.toMatch(/Accept:\s*'application\/vnd\.sdmx/);
      expect(source).not.toMatch(/Accept:\s*'text\/csv/);
      expect(source).toContain('ABS_SDMX_STRUCTURE_ACCEPT');
    }
  });

  it('classifies content negotiation as OUR fault, not the publisher’s', () => {
    // 406 is the server saying it cannot serve what we asked for; 415 that it
    // cannot read what we sent. Both are statements about our request.
    expect(isOurRequestFault(406)).toBe(true);
    expect(isOurRequestFault(415)).toBe(true);
    // Everything else stays theirs.
    for (const status of [200, 301, 400, 401, 403, 404, 429, 500, 502, 503, 504]) {
      expect(isOurRequestFault(status), String(status)).toBe(false);
    }
  });

  it('the probe cannot print a verdict over zero measurements', () => {
    /*
     * The second defect of that run, independent of the header: the verdict
     * block reached "THE PREMISE DOES NOT HOLD" with `findings.length === 0`.
     * A conclusion drawn from nothing is worse than no conclusion, so the
     * guard is asserted in the probe's source — it has no exported surface to
     * test, and a defect this shape is what a source scan is for.
     */
    const probe = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/market/abs-projection-liveness.ts'),
      'utf8',
    );
    const verdict = probe.slice(probe.indexOf("h('3 · What W3.3"));
    const guard = verdict.indexOf('findings.length === 0');
    const conclusion = verdict.indexOf('THE PREMISE DOES NOT HOLD');
    expect(guard).toBeGreaterThan(-1);
    expect(conclusion).toBeGreaterThan(-1);
    // The guard has to come FIRST, or it guards nothing.
    expect(guard).toBeLessThan(conclusion);
    expect(verdict.slice(guard, guard + 400)).toContain('ours(');
  });
});

describe('the prompt gets a permitted form, not a bare prohibition', () => {
  const generator = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/functions/generate-investment-report/index.ts'),
    'utf8',
  );
  const regenerator = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/functions/regenerate-report-qualitative/index.ts'),
    'utf8',
  );

  it('the block carries the absence sentence beside the prohibition', () => {
    /*
     * The instruction already forbade "a population projection" and offered
     * nothing to say instead, while the section validator REQUIRES the words
     * population, income and employment. A prohibition with no demonstration
     * of the permitted form is one a model routes around — this repository
     * has recorded that twice.
     */
    const block = regionalTrendBlocks({});
    expect(block).toMatch(/Forward demand — what this report holds/);
    expect(block).toMatch(/no projected population, growth rate or horizon/i);
    // And it must not invite a citation it cannot support.
    expect(block).toMatch(/different statements/i);
  });

  it('says the measured table is backward-looking where one is rendered', () => {
    const withTrend = regionalTrendBlocks({
      regionalTrends: {
        sa2: { name: 'Golden Square' },
        population: { latest: { year: 2024, erp: 10234 }, source: 'ABS Regional population' },
      },
    });
    expect(withTrend).toMatch(/BACKWARD-looking/);
    expect(withTrend).toMatch(/nothing in it is a statement about\s+what will happen/);
    expect(withTrend).toMatch(/Forward demand/);
  });

  it('the generator passes the TRUSTED state, never the NSW-defaulting one', () => {
    /*
     * The generator's own `state` is `detectedState || 'NSW'`, so reading it
     * would name the NSW publisher on every property whose state was never
     * resolved — a false statement about the jurisdiction, made silently, on
     * exactly the properties whose evidence is thinnest.
     */
    expect(generator).toContain('trustedStateForForwardDemand(subjectGeography, abbreviateState)');
    // Never the bare variable.
    expect(generator).not.toMatch(/regionalTrendBlocks\(\s*\{[^}]*state:\s*state\b/);
  });

  it('and the trusted rule withholds rather than guessing', () => {
    const abbrev = (v: string | null) => (v === 'New South Wales' ? 'NSW' : v);
    expect(trustedStateForForwardDemand({ state: 'New South Wales' }, abbrev)).toBe('NSW');
    expect(trustedStateForForwardDemand({ state: '   ' }, abbrev)).toBeNull();
    expect(trustedStateForForwardDemand({}, abbrev)).toBeNull();
    expect(trustedStateForForwardDemand(null, abbrev)).toBeNull();
    expect(trustedStateForForwardDemand({ state: 42 }, abbrev)).toBeNull();
  });

  it('the regeneration path names NO publisher rather than a wrong one', () => {
    /*
     * A RECORDED ASYMMETRY, not an oversight. On that path the trusted
     * geography is resolved in `fetchEnhancedData` while the block is composed
     * in `buildEnhancedDataContext` — a different function — and the only
     * `state` reachable there is the NSW-defaulting one. So it passes none and
     * gets the unknown-jurisdiction wording, which states the limit as this
     * report's rather than naming a publisher for the wrong jurisdiction.
     *
     * Asserted so the day someone threads the trusted state through, they
     * change this test deliberately instead of discovering the gap.
     */
    expect(regenerator).toContain('regionalTrendBlocks(enhancedData)');
    expect(regenerator).not.toContain('trustedStateForForwardDemand');
    const unknown = regionalTrendBlocks({});
    expect(unknown).toMatch(/limit of this report rather than a finding about the area/);
    for (const j of ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']) {
      expect(unknown).not.toContain(FORWARD_DEMAND_PUBLISHERS[j].publisher);
    }
  });

  it('a resolved jurisdiction names its own publisher and no other', () => {
    const vic = regionalTrendBlocks({ state: 'VIC' });
    expect(vic).toContain(FORWARD_DEMAND_PUBLISHERS.VIC.publisher);
    expect(vic).toContain('Victoria in Future');
    expect(vic).not.toContain(FORWARD_DEMAND_PUBLISHERS.NSW.publisher);
  });
});
