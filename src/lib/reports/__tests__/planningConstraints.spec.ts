/**
 * The controls, overlays and hazards that sit on a property.
 *
 * Every fixture below is a VERBATIM production response, captured from the
 * deployment's own egress on 17 Sep 2026 (pg_net request ids 263970–264016).
 * That is the rule `airtableIntakeFields.pure.ts` records and the 42703 class
 * proves: a field name transcribed from documentation is invisible when it is
 * wrong, and an absent field reads exactly like "no control applies here".
 *
 * The NSW fixture is Muswellbrook, the QLD fixture is 262 Pallas Street,
 * Maryborough, the VIC fixture is the Melbourne CBD and the TAS fixture is
 * Hobart.
 */
import { describe, expect, it } from 'vitest';
import {
  buildIdentifyUrl,
  buildNswHazardIdentify,
  buildQldFloodIdentify,
  buildTasOverlayQuery,
  buildVicOverlayQuery,
  CONSTRAINT_FAMILY_LABEL,
  familyFromLabel,
  identifyDateToIso,
  mergeConstraintOutcomes,
  NSW_HAZARD_LAYERS,
  NSW_PRINCIPAL_CONTROL_LAYERS,
  NSW_PRINCIPAL_SOURCE,
  parseNamedLayerConstraints,
  parseNswConstraints,
  parseNswInstrument,
  parseTasOverlays,
  parseVicOverlays,
  attrStr,
  type ConstraintProbeOutcome,
} from '../../../../supabase/functions/_shared/planning/planningConstraints.pure';
import { CONTROL_GUIDE, VERIFICATION_DOCUMENT } from '../../../../supabase/functions/_shared/planning/planningControlGuide.pure';

// ── Fixtures, verbatim ──────────────────────────────────────────────────────

const NSW_PRINCIPAL = {
  results: [
    {
      layerId: 8, layerName: 'Local Environmental Plan', displayFieldName: 'EPI Name',
      value: 'Muswellbrook Local Environmental Plan 2009',
      attributes: {
        OBJECTID: '102', 'EPI Name': 'Muswellbrook Local Environmental Plan 2009', 'LGA Name': 'MUSWELLBROOK',
        'Published Date': '6/15/2012', 'Commenced Date': '6/15/2012', 'Currency Date': '6/15/2012',
        Amendment: 'Amendment No 7', 'Layer Class': 'Included', 'Legislative Area': 'Null',
        'Legislative Clause': 'Clause 1.3', 'Legislative Value': 'Null', 'EPI Type': 'Local Environment Plan', SHAPE: 'Polygon',
      },
    },
    {
      layerId: 11, layerName: 'Floor Space Ratio Map', displayFieldName: 'EPI Name',
      value: 'Muswellbrook Local Environmental Plan 2009',
      attributes: {
        OBJECTID: '21273', 'EPI Name': 'Muswellbrook Local Environmental Plan 2009', 'LGA Name': 'MUSWELLBROOK',
        'Published Date': '10/30/2015', 'Commenced Date': '10/30/2015', 'Currency Date': '11/18/2022',
        Amendment: 'Amendment No 12', 'Layer Class': '0.5-0.54', 'Symbol Code': 'D', 'Floor Space Ratio': '0.5',
        Label: 'D', 'Additional Controls': 'Null', 'Legislative Clause': 'Clause 4.4', 'EPI Type': 'Local Environment Plan', SHAPE: 'Polygon',
      },
    },
    {
      layerId: 14, layerName: 'Height of Buildings Map', displayFieldName: 'EPI Name',
      value: 'Muswellbrook Local Environmental Plan 2009',
      attributes: {
        OBJECTID: '17305', 'EPI Name': 'Muswellbrook Local Environmental Plan 2009', 'LGA Name': 'MUSWELLBROOK',
        'Published Date': '6/15/2012', 'Commenced Date': '6/15/2012', 'Currency Date': '11/18/2022',
        Amendment: 'Amendment No 7', 'Symbol Code': 'I', 'Maximum Building Height': '8.5', Units: 'm',
        'Additional Controls': 'Null', 'Legislative Clause': 'Clause 4.3', 'EPI Type': 'Local Environment Plan',
        SHAPE: 'Polygon', MAX_B_H_M: '8.5', MAX_B_H_RL: '0',
      },
    },
    {
      layerId: 16, layerName: 'EPI Heritage', displayFieldName: 'EPI Name',
      value: 'Muswellbrook Local Environmental Plan 2009',
      attributes: {
        OBJECTID: '8387', 'EPI Name': 'Muswellbrook Local Environmental Plan 2009', 'LGA Name': 'MUSWELLBROOK',
        'Published Date': '6/15/2012', 'Commenced Date': '6/15/2012', 'Currency Date': '3/1/2024',
        Amendment: 'Amendment No 7', 'Heritage Type': 'Conservation Area - General', 'Item Number': 'C2',
        'Item Name': 'Residential Heritage Conservation Area', Significance: 'Local',
        'Legislative Clause': 'Clause 5.10', 'EPI Type': 'Local Environment Plan', SHAPE: 'Polygon',
      },
    },
    {
      layerId: 19, layerName: 'Land Zoning Map', displayFieldName: 'EPI Name',
      value: 'Muswellbrook Local Environmental Plan 2009',
      attributes: {
        OBJECTID: '785139', 'EPI Name': 'Muswellbrook Local Environmental Plan 2009', 'LGA Name': 'MUSWELLBROOK',
        'Published Date': '6/9/2023', 'Commenced Date': '6/9/2023', 'Currency Date': '6/9/2023',
        Amendment: 'Map Amendment No 4', 'Land Use': 'General Residential', LABEL: 'R1', Zone: 'R1',
        Purpose: 'Null', 'Additional Controls': 'Null', 'EPI Type': 'Local Environment Plan', SHAPE: 'Polygon',
      },
    },
    {
      layerId: 22, layerName: 'Minimum Lot Size', displayFieldName: 'EPI Name',
      value: 'Muswellbrook Local Environmental Plan 2009',
      attributes: {
        OBJECTID: '12385', 'EPI Name': 'Muswellbrook Local Environmental Plan 2009', 'LGA Name': 'MUSWELLBROOK',
        'Published Date': '11/1/2013', 'Commenced Date': '11/1/2013', 'Currency Date': '7/2/2021',
        Amendment: 'Amendment No 10', 'Layer Class': '600-624', 'Symbol Code': 'M', 'Lot Size': '600', Units: 'm²',
        'Additional Controls': 'Null', 'Legislative Clause': 'Clause 4.1', 'EPI Type': 'Local Environment Plan', SHAPE: 'Polygon',
      },
    },
  ],
};

const QLD_STATE_PLANNING = {
  results: [
    {
      layerId: 10, layerName: 'Priority Living Area', displayFieldName: 'Name',
      value: 'Maryborough Priority Living Area',
      attributes: { Name: 'Maryborough Priority Living Area', Region: 'Wide Bay Burnett', OBJECTID: '63', Shape: 'Polygon' },
    },
    {
      layerId: 90, layerName: 'Regional planning boundaries', displayFieldName: 'Plan Name',
      value: 'Wide Bay Burnett Regional Plan',
      attributes: { 'Plan Name': 'Wide Bay Burnett Regional Plan', 'Legal status': 'Statutory', Version: 'December 2023', OBJECTID: '13', SHAPE: 'Polygon' },
    },
  ],
};

const VIC_OVERLAYS = {
  type: 'FeatureCollection',
  features: [
    { properties: { lga: 'MELBOURNE', zone_code: 'DDO1', scheme_code: 'DDO', zone_status: 'g', gaz_begin_date: '2021-09-30T00:00:00Z', zone_description: 'DESIGN AND DEVELOPMENT OVERLAY - SCHEDULE 1' } },
    { properties: { lga: 'MELBOURNE', zone_code: 'HO544', scheme_code: 'HO', zone_status: 'g', gaz_begin_date: '2016-05-12T00:00:00Z', zone_description: 'HERITAGE OVERLAY - SCHEDULE 544' } },
    { properties: { lga: 'MELBOURNE', zone_code: 'PO2', scheme_code: 'PO', zone_status: 'g', gaz_begin_date: '2020-02-06T00:00:00Z', zone_description: 'PARKING OVERLAY - SCHEDULE 2' } },
  ],
};

const TAS_OVERLAYS = {
  displayFieldName: 'OV_NAME',
  features: [{
    attributes: {
      OBJECTID: 1017804, LPS_NO: 114, LPS: 'Hobart Local Provisions Schedule', CODE_NO: 6,
      CODE: 'Local Historical Heritage Code', OV_NO: 14,
      OV_NAME: 'Place or precinct of archaeological potential',
      OV_CAT: 'Place or precinct of archaeological potential', OV_ABB: '114.6.14',
      DESCRIPT: null, LPS_REF: 'HOB-C6.4.1', LPSDATE: 1761091200000, AMEND_REF: ' ',
    },
  }],
};

// ── The tests ───────────────────────────────────────────────────────────────

describe('a NSW identify answers six controls in one call', () => {
  const outcome = parseNswConstraints(NSW_PRINCIPAL, NSW_PRINCIPAL_CONTROL_LAYERS, NSW_PRINCIPAL_SOURCE);

  it('reads the figures WITH their units', () => {
    const by = Object.fromEntries(outcome.readings.map((r) => [r.family, r]));
    expect(by.height.value).toBe('8.5 m');
    expect(by.minimumLotSize.value).toBe('600 m²');
    // A ratio, not a decimal of something unnamed: the instrument states 0.5:1.
    expect(by.floorSpaceRatio.value).toBe('0.5:1');
  });

  it('carries the clause that creates each control, and its own currency date', () => {
    const by = Object.fromEntries(outcome.readings.map((r) => [r.family, r]));
    expect(by.height.clause).toBe('Clause 4.3');
    expect(by.floorSpaceRatio.clause).toBe('Clause 4.4');
    expect(by.minimumLotSize.clause).toBe('Clause 4.1');
    expect(by.heritage.clause).toBe('Clause 5.10');
    expect(by.height.instrument).toBe('Muswellbrook Local Environmental Plan 2009');
    // Each layer publishes its OWN currency; the report must not collapse them
    // onto the instrument's date, because the maps amend separately.
    expect(by.height.currencyDate).toBe('2022-11-18');
    expect(by.heritage.currencyDate).toBe('2024-03-01');
    expect(by.minimumLotSize.currencyDate).toBe('2021-07-02');
  });

  it('names a heritage listing by the item, not by the layer', () => {
    const h = outcome.readings.find((r) => r.family === 'heritage');
    expect(h?.label).toBe('Residential Heritage Conservation Area');
    expect(h?.code).toBe('C2');
    expect(h?.detail).toBe('Conservation Area - General · Local significance');
    // A conservation area is a control on what may be done, not a hazard.
    expect(h?.kind).toBe('control');
  });

  it('draws no row for the instrument itself, and names it separately', () => {
    // Layer 8 is the LEP. It is not a control; printing it as one would put a
    // row in the register that obliges nothing.
    expect(outcome.readings.some((r) => r.label === 'Local Environmental Plan')).toBe(false);
    const lep = parseNswInstrument(NSW_PRINCIPAL);
    expect(lep).toMatchObject({ name: 'Muswellbrook Local Environmental Plan 2009', amendment: 'Amendment No 7', lga: 'MUSWELLBROOK' });
  });

  it('never prints the string "Null" that ArcGIS sends for an absent value', () => {
    for (const r of outcome.readings) {
      for (const v of [r.code, r.value, r.detail, r.clause, r.instrument]) {
        expect(String(v ?? '')).not.toMatch(/^null$/i);
      }
    }
    expect(attrStr('Null')).toBeNull();
    expect(attrStr('-')).toBeNull();
    expect(attrStr(' 8.5 ')).toBe('8.5');
  });
});

describe('an empty answer is only a finding where the question was asked', () => {
  it('a hazard service whose group is hidden must be asked by explicit layer id', () => {
    /*
     * Measured: `layers=all` on the NSW Hazard service answered
     * `{"results":[]}` at a coordinate, because ArcGIS reads `all` as "all
     * VISIBLE" and that service's group carries `defaultVisibility:false`. An
     * empty answer to a question nobody asked is the worst shape this codebase
     * knows — it reads as a property with no bushfire and no flood.
     */
    const url = buildNswHazardIdentify(150.8931, -32.2649);
    expect(url).toContain('layers=all%3A229%2C230%2C231%2C232');
    expect(url).not.toMatch(/layers=all(?!%3A)/);
    expect(Object.keys(NSW_HAZARD_LAYERS).map(Number)).toEqual([229, 230, 231, 232]);
  });

  it('a register that answered nothing still reports its coverage', () => {
    const out = parseNswConstraints({ results: [] }, NSW_HAZARD_LAYERS, 'NSW hazard');
    expect(out.status).toBe('none_at_point');
    expect(out.asked).toContain('bushfire');
    expect(out.asked).toContain('flood');
    expect(out.asked).toContain('landslide');
  });

  it('a register that FAILED claims no coverage at all', () => {
    const failed = parseNswConstraints({ error: { message: 'timeout' } }, NSW_HAZARD_LAYERS, 'NSW hazard');
    expect(failed.status).toBe('unavailable');
    const merged = mergeConstraintOutcomes([failed]);
    // The decisive assertion: an outage must not contribute to what was
    // checked, or a report says "bushfire was checked" about a call that died.
    expect(merged.askedFamilies).toEqual([]);
    expect(merged.registersAnswered).toEqual([]);
    expect(merged.registersUnavailable[0]).toContain('timeout');
  });

  it('a body with no results array is a failure, never an empty coverage', () => {
    for (const body of [null, {}, { results: 'nope' }, 'text']) {
      expect(parseNswConstraints(body, NSW_HAZARD_LAYERS, 's').status).toBe('unavailable');
    }
  });
});

describe('Victoria answers overlays on the endpoint we already ask for zones', () => {
  const out = parseVicOverlays(VIC_OVERLAYS);

  it('classifies by the state-wide scheme code and keeps the schedule', () => {
    expect(out.readings.map((r) => [r.family, r.code])).toEqual([
      // Feature order, as the WFS returned it: the parser does not reorder,
      // because the merge is where ordering is decided and doing it twice is
      // how two orders disagree.
      ['design', 'DDO1'], ['heritage', 'HO544'], ['parking', 'PO2'],
    ]);
  });

  it('carries the schedule as the clause, because that is what a planner looks up', () => {
    expect(out.readings.find((r) => r.code === 'HO544')?.clause).toBe('HO544');
    expect(out.readings.find((r) => r.code === 'DDO1')?.instrument).toBe('MELBOURNE Planning Scheme');
  });

  it('says whether the control is gazetted, because an interim control binds differently', () => {
    expect(out.readings.every((r) => r.detail === 'Gazetted')).toBe(true);
    const interim = parseVicOverlays({ features: [{ properties: { zone_code: 'DDO9', scheme_code: 'DDO', zone_status: 'i', zone_description: 'X' } }] });
    expect(interim.readings[0].detail).toBe('i');
  });

  it('asks the overlay type, one word from the zone query', () => {
    const url = buildVicOverlayQuery(144.9631, -37.8136);
    expect(url).toContain('plan_overlay');
    expect(url).toContain('INTERSECTS');
  });
});

describe('Queensland answers where the land sits in the state plan', () => {
  const out = parseNamedLayerConstraints(QLD_STATE_PLANNING, {
    asked: ['regionalPlan', 'growthArea', 'environmentallySensitive'],
    source: 'Queensland StatePlanning', licence: 'CC BY 4.0',
  });

  it('names the feature, not the layer', () => {
    // "Priority Living Area" is the layer. "Maryborough Priority Living Area"
    // is the answer, and it is the one that says something about the property.
    expect(out.readings.map((r) => r.label)).toContain('Maryborough Priority Living Area');
    expect(out.readings.map((r) => r.label)).toContain('Wide Bay Burnett Regional Plan');
  });

  it('carries the plan’s legal standing and its version', () => {
    const plan = out.readings.find((r) => r.family === 'regionalPlan');
    expect(plan?.detail).toContain('Statutory instrument');
    expect(plan?.detail).toContain('version December 2023');
  });

  it('separates the standing from the region, and keeps the join in detail', () => {
    /*
     * `detail` is a JOIN — legal status, version, region, hazard class — and
     * it reads correctly in the register table's "What the register returned"
     * column, which is explicitly a summary of what came back. A consumer that
     * needs one of those facts cannot take the join, and one did: the
     * Infrastructure Outlook put `detail` in its **Status** column, so
     * `Maryborough Priority Living Area` was given the status
     * `Wide Bay Burnett` — the region.
     */
    const area = out.readings.find((r) => r.family === 'growthArea');
    expect(area?.region).toBe('Wide Bay Burnett');
    // The register stated no legal status for the living area, and an absent
    // standing is a real state.
    expect(area?.standingLabel).toBeNull();
    expect(area?.detail).toBe('Wide Bay Burnett');

    const plan = out.readings.find((r) => r.family === 'regionalPlan');
    expect(plan?.standingLabel).toBe('Statutory instrument · version December 2023');
    // The plan's answer carries no Region attribute; the plan IS the region.
    expect(plan?.region).toBeNull();
    expect(plan?.detail).toBe('Statutory instrument · version December 2023');
  });

  it('files both as context, never as a control on the lot', () => {
    // A regional plan says what the REGION is for; it does not limit what may
    // be built on one lot, and printing it as a development control would
    // overstate it.
    expect(out.readings.every((r) => r.kind === 'context')).toBe(true);
  });

  it('asks the flood assessment by explicit layer', () => {
    expect(buildQldFloodIdentify(152.7, -25.5)).toContain('layers=all%3A0');
  });
});

describe('Tasmania answers both overlay layers', () => {
  const out = parseTasOverlays(TAS_OVERLAYS);

  it('reads the overlay, its schedule and its date', () => {
    const r = out.readings[0];
    expect(r.label).toBe('Place or precinct of archaeological potential');
    expect(r.family).toBe('heritage');
    expect(r.instrument).toBe('Hobart Local Provisions Schedule');
    expect(r.clause).toBe('HOB-C6.4.1');
    expect(r.code).toBe('114.6.14');
    // Epoch milliseconds, which is how this layer states a date.
    expect(r.currencyDate).toBe('2025-10-22');
  });

  it('asks both the code overlay and the general overlay', () => {
    expect(buildTasOverlayQuery(14, 147.3, -42.9)).toContain('/MapServer/14/query');
    expect(buildTasOverlayQuery(15, 147.3, -42.9)).toContain('/MapServer/15/query');
  });
});

describe('the identify request itself', () => {
  it('asks for exact containment, never a tolerance', () => {
    // A tolerance is in PIXELS. One pixel at this extent is metres of ground,
    // so a tolerance returns the controls that apply to the neighbour.
    const url = buildIdentifyUrl('https://x/MapServer', 151, -33, 'all');
    expect(url).toContain('tolerance=0');
    expect(url).toContain('sr=4326');
    expect(url).toContain('returnGeometry=false');
  });

  it('reads both date shapes these services publish', () => {
    expect(identifyDateToIso('6/15/2012')).toBe('2012-06-15');
    expect(identifyDateToIso('11/18/2022')).toBe('2022-11-18');
    expect(identifyDateToIso(1761091200000)).toBe('2025-10-22');
    expect(identifyDateToIso('2021-09-30T00:00:00Z')).toBe('2021-09-30');
    expect(identifyDateToIso('Null')).toBeNull();
    expect(identifyDateToIso('December 2023')).toBeNull();
  });
});

describe('the ordering a reader triages by', () => {
  it('puts hazards first and strategic context last', () => {
    const mk = (kind: string, label: string): ConstraintProbeOutcome => ({
      asked: [], status: 'ok', source: 's', licence: 'l', note: null,
      readings: [{
        family: 'other', kind: kind as never, label, code: null, value: null,
        instrument: null, clause: null, currencyDate: null, detail: null, source: 's', licence: 'l',
      }],
    });
    const merged = mergeConstraintOutcomes([
      mk('context', 'Regional plan'), mk('protection', 'Wetland'),
      mk('hazard', 'Flood'), mk('control', 'Height'),
    ]);
    expect(merged.readings.map((r) => r.label)).toEqual(['Flood', 'Height', 'Wetland', 'Regional plan']);
  });
});

describe('the guide explains the control and never the property', () => {
  it('covers every family the readings can carry', () => {
    for (const family of Object.keys(CONSTRAINT_FAMILY_LABEL)) {
      const g = CONTROL_GUIDE[family as keyof typeof CONTROL_GUIDE];
      expect(g, family).toBeDefined();
      expect(g.what.length, family).toBeGreaterThan(40);
      expect(g.effect.length, family).toBeGreaterThan(40);
      expect(g.verify.length, family).toBeGreaterThan(30);
    }
  });

  it('states no figure, no cost and no percentage anywhere', () => {
    /*
     * The legacy long-form report is the worked example. Its zoning section
     * was fluent and specific — "increases build costs by 5-8%
     * ($25,000-$40,000)", "BAL-19 rating standard for the precinct", "raised
     * floor levels (300mm freeboard)", "$52,000 per lot" — and three copies
     * of it in ONE document, on ONE lot, disagreed with each other on every
     * one of those numbers. Fluency was never the problem.
     *
     * Everything here is true of the control type, so nothing here may carry
     * a quantity that varies by property. The only digits permitted are in
     * the worked illustration of what a ratio MEANS and the statutory
     * references a reader needs to quote.
     */
    const allowed = [
      '0.5:1 allows 500 m² of floor area on a 1,000 m² site',
      'Environmental Planning and Assessment Act 1979',
      's. 10.7', '10.7(2)', '10.7(5)', 'Section 32', 'Planning Act 2016',
      'Planning and Design Code', 'Form 1', 'Section 337', '2100',
    ];
    const strip = (t: string) => allowed.reduce((acc, a) => acc.split(a).join(''), t);
    for (const [family, g] of Object.entries(CONTROL_GUIDE)) {
      const text = strip(`${g.what} ${g.effect} ${g.verify}`);
      expect(text, `${family}: a currency amount`).not.toMatch(/\$\s?[\d,]/);
      expect(text, `${family}: a percentage`).not.toMatch(/\d\s?%/);
      expect(text, `${family}: a measurement`).not.toMatch(/\b\d+(\.\d+)?\s?(m|mm|m²|metres|millimetres)\b/i);
      expect(text, `${family}: a BAL rating`).not.toMatch(/BAL-?\d/i);
    }
    for (const doc of Object.values(VERIFICATION_DOCUMENT)) {
      expect(strip(doc)).not.toMatch(/\$\s?[\d,]/);
    }
  });

  it('never says a control does not apply, and never promises an outcome', () => {
    for (const [family, g] of Object.entries(CONTROL_GUIDE)) {
      const text = `${g.what} ${g.effect} ${g.verify}`.toLowerCase();
      for (const forbidden of [
        'does not apply', 'no overlay', 'is not affected', 'will be approved',
        'guarantees', 'is assured', 'no restriction',
      ]) {
        expect(text, `${family}: "${forbidden}"`).not.toContain(forbidden);
      }
    }
  });

  it('names the right document in each jurisdiction', () => {
    // Asking a Queensland council for a "Section 32" gets nowhere, and asking
    // a Victorian vendor for a "planning and development certificate" gets
    // nowhere either. The document is the deliverable of the whole section.
    expect(VERIFICATION_DOCUMENT.NSW).toContain('10.7');
    expect(VERIFICATION_DOCUMENT.VIC).toContain('Section 32');
    expect(VERIFICATION_DOCUMENT.QLD).toContain('planning and development certificate');
    expect(VERIFICATION_DOCUMENT.SA).toContain('Form 1');
    expect(VERIFICATION_DOCUMENT.TAS).toContain('Section 337');
    expect(VERIFICATION_DOCUMENT.ACT).toContain('Crown lease');
  });
});

describe('classification by the publisher’s own words', () => {
  it('recognises the families that change a purchase', () => {
    expect(familyFromLabel('Bushfire-Prone Areas Code').family).toBe('bushfire');
    expect(familyFromLabel('Flood-Prone Areas Hazard Code').family).toBe('flood');
    expect(familyFromLabel('Landslip Hazard Code').family).toBe('landslide');
    expect(familyFromLabel('MSES wildlife habitat [SEQ koala habitat - core]').family).toBe('biodiversity');
    expect(familyFromLabel('Waterway and Coastal Protection Area').family).toBe('coastal');
    expect(familyFromLabel('Priority Living Area').family).toBe('growthArea');
    expect(familyFromLabel('Wide Bay Burnett Regional Plan').family).toBe('regionalPlan');
  });

  it('files an unrecognised name as other rather than guessing', () => {
    const r = familyFromLabel('Surat Cumulative Management Area');
    expect(r.family).toBe('other');
    expect(r.kind).toBe('context');
  });
});

describe('a single-purpose register states its own family', () => {
  /*
   * The defect this parameter exists for, caught by rendering the real
   * section for 262 Pallas Street rather than by reading the code.
   *
   * Queensland's FloodCheck Rapid Hazard Assessment answers at that
   * coordinate (pg_net request id 264598, 17 Sep 2026) with the value
   * `Lower Mary River` — the sub-basin's own name. Classifying by label finds
   * no flood keyword in it, so a FLOOD HAZARD READING ON A MARY RIVER
   * PROPERTY was filed as "Strategic context", and four statements went wrong
   * from that one classification:
   *
   *   1. it was drawn as strategic context rather than as a hazard;
   *   2. it lost the hazard-first ordering a reader triages by;
   *   3. it appeared in the Infrastructure & Development Outlook, which is
   *      for what is PLANNED nearby;
   *   4. the coverage line said flood had been "checked and not mapped at
   *      this coordinate" — a clearance, on a property inside the mapping.
   *
   * A register that answers one question knows the answer's kind better than
   * a keyword scan of what the feature happens to be called.
   */
  const FLOOD_AT_PALLAS = {
    results: [{
      layerId: 0, layerName: 'Rapid Hazard Assessment', displayFieldName: 'sub_name',
      value: 'Lower Mary River',
      attributes: { OBJECTID: '14', sub_name: 'Lower Mary River', Shape: 'Polygon' },
    }],
  };

  it('files the reading under the register’s family, not the feature’s name', () => {
    // What a keyword scan of the feature name alone produces.
    expect(familyFromLabel('Lower Mary River').family).not.toBe('flood');

    const out = parseNamedLayerConstraints(FLOOD_AT_PALLAS, {
      asked: ['flood'], source: 'Queensland FloodCheck', licence: 'CC BY 4.0',
      instrument: 'Queensland FloodCheck rapid hazard assessment',
      family: { family: 'flood', kind: 'hazard' },
    });
    expect(out.readings[0].family).toBe('flood');
    expect(out.readings[0].kind).toBe('hazard');
  });

  it('names what was found before where it was found', () => {
    // "Lower Mary River" is not a finding a reader can act on;
    // "Rapid Hazard Assessment — Lower Mary River" is.
    const out = parseNamedLayerConstraints(FLOOD_AT_PALLAS, {
      asked: ['flood'], source: 'Queensland FloodCheck', licence: 'CC BY 4.0',
      family: { family: 'flood', kind: 'hazard' },
    });
    expect(out.readings[0].label).toBe('Rapid Hazard Assessment — Lower Mary River');
  });

  it('keeps the feature’s own name where the register publishes many kinds', () => {
    // MSES publishes 26 layers under descriptive names, and Queensland's
    // StatePlanning service answers several; there the FEATURE is the finding
    // — "Maryborough Priority Living Area", not "Priority Living Area".
    const out = parseNamedLayerConstraints({
      results: [{
        layerId: 10, layerName: 'Priority Living Area', value: 'Maryborough Priority Living Area',
        attributes: { Name: 'Maryborough Priority Living Area', Region: 'Wide Bay Burnett' },
      }],
    }, { asked: ['growthArea'], source: 'Queensland StatePlanning', licence: 'CC BY 4.0' });
    expect(out.readings[0].label).toBe('Maryborough Priority Living Area');
    expect(out.readings[0].family).toBe('growthArea');
  });

  it('puts the hazard first and out of the strategic-context group', () => {
    const merged = mergeConstraintOutcomes([
      parseNamedLayerConstraints({
        results: [
          { layerId: 90, layerName: 'Regional planning boundaries', value: 'Wide Bay Burnett Regional Plan',
            attributes: { 'Plan Name': 'Wide Bay Burnett Regional Plan', 'Legal status': 'Statutory', Version: 'December 2023' } },
        ],
      }, { asked: ['regionalPlan'], source: 'Queensland StatePlanning', licence: 'CC BY 4.0' }),
      parseNamedLayerConstraints(FLOOD_AT_PALLAS, {
        asked: ['flood'], source: 'Queensland FloodCheck', licence: 'CC BY 4.0',
        family: { family: 'flood', kind: 'hazard' },
      }),
    ]);
    expect(merged.readings.map((r) => r.kind)).toEqual(['hazard', 'context']);
    // And the coverage line cannot then say flood was checked and clear.
    const found = new Set(merged.readings.map((r) => r.family));
    expect(found.has('flood')).toBe(true);
    expect(merged.askedFamilies).toContain('flood');
  });
});
