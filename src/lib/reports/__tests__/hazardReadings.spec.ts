/**
 * Bushfire and flood, as the hazard maps read at the property answered.
 *
 * The 37 Bolin Street suite (27 Sep 2026) printed both as "Not assessed",
 * and said no bushfire or flood level had been established, beside a planning
 * register that had asked the NSW hazard maps at the lot and been told:
 * nothing mapped. Measured from CI the same day: NSW layer 229 is the Bush
 * Fire Prone Land map "certified by the Commissioner of NSW RFS under section
 * 146(2)" — the statewide designation — while the NSW flood planning layer
 * names ten councils, Blacktown not among them.
 */
import { describe, expect, it } from 'vitest';

import {
  designationFor,
  hazardReadings,
  hazardRegisterRules,
  type HazardEvidence,
} from '../../../../supabase/functions/_shared/planning/hazardReadings.pure';
import { climateStatBlocks } from '../../../../supabase/functions/_shared/reports/climatePromptBlocks.pure';
import { RISK_EXPOSURE_LEVELS } from '../../../../supabase/functions/_shared/reports/investment/riskRegister.pure';
import {
  ACT_BPA_SOURCE,
  buildActBpaQuery,
  buildVicBpaQuery,
  parseActBpa,
  parseVicBpa,
  VIC_BPA_SOURCE,
  VIC_OVERLAY_SOURCE,
  type PlanningConstraintReading,
} from '../../../../supabase/functions/_shared/planning/planningConstraints.pure';
import { OVERLAY_COVERAGE, NO_STATE_LAYER_NOTE } from '../../../../supabase/functions/_shared/planning/planningControlGuide.pure';
import { readFileSync } from 'node:fs';

const NSW_REGISTERS = ['NSW Planning Portal — Principal Planning Layers', 'NSW Planning Portal — Hazard', 'NSW Planning Portal — Protection'];

const bolin = (over: Partial<HazardEvidence> = {}): HazardEvidence => ({
  jurisdiction: 'NSW',
  constraints: [],
  constraintsAsked: ['heritage', 'bushfire', 'flood', 'landslide'],
  constraintRegisters: { answered: NSW_REGISTERS, unavailable: [] },
  retrievedAt: '2026-09-27T10:24:53Z',
  ...over,
});

const BFPL: PlanningConstraintReading = {
  family: 'bushfire', kind: 'hazard', label: 'Bushfire Prone Land', code: null, value: null,
  instrument: null, clause: null, currencyDate: null, detail: 'Vegetation Category 1',
  standingLabel: null, region: null, source: 'NSW Planning Portal — Hazard', licence: 'CC BY 4.0',
} as PlanningConstraintReading;

describe('what an answered hazard map says', () => {
  it('a statewide statutory designation that shows nothing is a finding: Not mapped, Verified', () => {
    const [bushfire] = hazardReadings(bolin());
    expect(bushfire.family).toBe('bushfire');
    expect(bushfire.state).toBe('not_mapped');
    expect(bushfire.exposure).toBe('Not mapped');
    expect(bushfire.evidence).toBe('Verified');
    expect(bushfire.sentence).toMatch(/not mapped as bush fire prone land/);
    expect(bushfire.sentence).toMatch(/27 Sep 2026/);
  });

  it('a map only some councils publish into stays Not assessed, and says why', () => {
    const [, flood] = hazardReadings(bolin());
    expect(flood.state).toBe('not_mapped');
    expect(flood.exposure).toBe('Not assessed');
    expect(flood.evidence).toBe('Unverified');
    expect(flood.sentence).toMatch(/not a finding that the lot is free of flooding/);
  });

  it('a mapped hazard names what the map shows and rates nothing', () => {
    const [bushfire] = hazardReadings(bolin({ constraints: [BFPL] }));
    expect(bushfire.state).toBe('mapped');
    expect(bushfire.exposure).toBe('Mapped');
    expect(bushfire.finding).toContain('Bushfire Prone Land · Vegetation Category 1');
    expect(bushfire.sentence).not.toMatch(/\b(?:low|moderate|high|minimal|negligible)\b/i);
  });

  it('a map nobody asked, or asked at a point off the lot, is evidence of nothing', () => {
    for (const r of [
      ...hazardReadings(bolin({ constraintsAsked: [] })),
      ...hazardReadings(bolin({ pointNotPlaced: true })),
    ]) {
      expect(r.state).toBe('not_checked');
      expect(r.exposure).toBe('Not assessed');
      expect(r.evidence).toBe('Not checked');
    }
  });

  it('only the designations the publishers state are complete; everywhere else an absence is never a finding', () => {
    expect(designationFor('NSW', 'bushfire').complete).toBe(true);
    expect(designationFor('WA', 'bushfire').complete).toBe(true);
    expect(designationFor('VIC', 'bushfire').complete).toBe(true);
    expect(designationFor('ACT', 'bushfire').complete).toBe(true);
    expect(designationFor('NSW', 'flood').complete).toBe(false);
    for (const j of ['VIC', 'QLD', 'SA', 'TAS', 'ACT', 'NT', null]) {
      expect(designationFor(j, 'flood').complete, `${j} flood`).toBe(false);
    }
    const [bushfireVic] = hazardReadings(bolin({ jurisdiction: 'VIC' }));
    expect(bushfireVic.exposure).toBe('Not assessed');
  });

  it('a designation counts only where its own register answered', () => {
    const hazardDown = bolin({
      constraintRegisters: {
        answered: NSW_REGISTERS.filter((r) => r !== 'NSW Planning Portal — Hazard'),
        unavailable: ['NSW Planning Portal — Hazard'],
      },
    });
    const [bushfire] = hazardReadings(hazardDown);
    expect(bushfire.exposure).toBe('Not assessed');
    expect(bushfire.evidence).not.toBe('Verified');
    expect(designationFor('NSW', 'bushfire', ['NSW Planning Portal — Hazard']).complete).toBe(true);
  });

  it('hands the register words its own vocabulary holds, and forbids a rating', () => {
    const rules = hazardRegisterRules(hazardReadings(bolin()));
    expect(rules).toContain('the Bushfire row reads "Not mapped" with evidence "Verified"');
    expect(rules).toContain('the Flood row reads "Not assessed" with evidence "Unverified"');
    expect(rules).toMatch(/never write Low/);
    for (const r of hazardReadings(bolin())) expect(RISK_EXPOSURE_LEVELS).toContain(r.exposure);
  });
});

describe('the Environment section reads the maps, not the service asked without a coordinate', () => {
  const riskService = {
    floodRisk: { level: 'Unknown', description: 'Precise flood risk assessment requires property coordinates.' },
    bushfireRisk: { level: 'Unknown' },
  };

  it('draws the hazard map table and the sentences under it', () => {
    const block = climateStatBlocks({ riskAssessment: riskService }, hazardReadings(bolin()));
    expect(block).toContain('| Hazard | What the map shows | Map |');
    expect(block).toMatch(/\| Bushfire \| Not mapped on the NSW Bush Fire Prone Land map/);
    expect(block).toContain('State bushfire and flood exactly as the hazard map table');
    expect(block).not.toMatch(/AFRIP/);
  });

  it('keeps the older service\'s row only for a hazard no map answered', () => {
    const withLevel = { floodRisk: { level: 'Medium', description: 'd' }, bushfireRisk: { level: 'High', description: 'd' } };
    const block = climateStatBlocks({ riskAssessment: withLevel }, hazardReadings(bolin({ constraintsAsked: ['flood'] })));
    expect(block).toContain('| Flood | Nothing mapped on the flood planning map');
    expect(block).not.toContain('| Flooding | Medium |');
    expect(block).toContain('| Bushfire | High |');
  });

  it('is unchanged where no planning reading is handed in', () => {
    expect(climateStatBlocks({ riskAssessment: riskService })).toBe(climateStatBlocks({ riskAssessment: riskService }, []));
  });
});

describe('Victoria and the ACT: the designation map, not the planning overlay', () => {
  const vic = (answered: string[], constraints: PlanningConstraintReading[] = []) => bolin({
    jurisdiction: 'VIC', constraints, constraintsAsked: ['bushfire', 'flood', 'heritage'],
    constraintRegisters: { answered, unavailable: [] },
  });

  it('a Victorian lot outside the gazetted bushfire prone area reads Not mapped, Verified', () => {
    const [bushfire] = hazardReadings(vic([VIC_OVERLAY_SOURCE, VIC_BPA_SOURCE]));
    expect(bushfire.exposure).toBe('Not mapped');
    expect(bushfire.evidence).toBe('Verified');
    expect(bushfire.sentence).toMatch(/Bushfire Management Overlay is a separate control/);
  });

  it('the overlays answering while the designation did not is not a finding about the designation', () => {
    // The BMO asks "bushfire" too; its silence says nothing about the gazetted area.
    const [bushfire] = hazardReadings(vic([VIC_OVERLAY_SOURCE]));
    expect(bushfire.exposure).toBe('Not assessed');
    expect(bushfire.evidence).toBe('Unverified');
  });

  it('parses the gazetted area, carrying the gazettal date as printed and never re-reading it as a month', () => {
    const out = parseVicBpa({ features: [{ properties: { lga_name: 'YARRA RANGES', plan_number: 'LEGL./25-138', gazettal_date: '10/07/2025' } }] });
    expect(out.status).toBe('ok');
    expect(out.asked).toEqual(['bushfire']);
    expect(out.readings[0]).toMatchObject({ family: 'bushfire', kind: 'hazard', label: 'Bushfire Prone Area', currencyDate: null, region: 'YARRA RANGES' });
    expect(out.readings[0].detail).toBe('Plan LEGL./25-138, gazettal date 10/07/2025');
    expect(parseVicBpa({ features: [] }).status).toBe('none_at_point');
    expect(parseVicBpa({ exceptions: 'x' }).status).toBe('unavailable');
  });

  it('asks Victoria longitude-first with the SRID named — the only form measured to answer both ways', () => {
    const q = new URL(buildVicBpaQuery(145.358, -37.845)).searchParams;
    expect(q.get('typeNames')).toBe('open-data-platform:bushfire_prone_area');
    expect(q.get('CQL_FILTER')).toBe('INTERSECTS(geom,SRID=4326;POINT(145.358 -37.845))');
  });

  it('parses the ACT area with the publisher\'s category as a label, and an error as unavailable', () => {
    const out = parseActBpa({ features: [{ attributes: { Hazard_Category: '2' } }, { attributes: { Hazard_Category: '1' } }] });
    expect(out.status).toBe('ok');
    expect(out.readings).toHaveLength(1);
    expect(out.readings[0].detail).toBe('Hazard category 1 and 2');
    expect(out.readings[0].source).toBe(ACT_BPA_SOURCE);
    expect(parseActBpa({ features: [] }).status).toBe('none_at_point');
    expect(parseActBpa({ error: { code: 400 } }).status).toBe('unavailable');
    expect(buildActBpaQuery(149.07, -35.51)).toContain('inSR=4326');
  });

  it('the service asks both, each as its own register', () => {
    const service = readFileSync('supabase/functions/planning-data-service/index.ts', 'utf8');
    expect(service).toContain('buildVicBpaQuery(lng, lat)');
    expect(service).toContain("} else if (jurisdiction === 'ACT') {");
    expect(service).toContain('buildActBpaQuery(lng, lat)');
  });

  it('the ACT is partly read now, and its note says which part', () => {
    expect(OVERLAY_COVERAGE.ACT).toBe('partial_state_layers_read');
    expect(NO_STATE_LAYER_NOTE.ACT).toMatch(/bushfire prone area from the Territory/);
    expect(NO_STATE_LAYER_NOTE.ACT).toMatch(/flood and heritage overlays are not covered/);
  });
});
