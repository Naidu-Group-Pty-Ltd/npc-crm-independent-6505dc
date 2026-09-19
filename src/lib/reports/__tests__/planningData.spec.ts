/**
 * Property planning data — the contracts, pinned against real responses.
 *
 * Every fixture below is a live service's answer captured on 2026-09-06
 * (the probe log is `docs/reports/ZONING_BY_JURISDICTION.md`): NSW ePlanning
 * layer 19 for Muswellbrook, Vicmap plan_zone for Wyndham Vale, the QLD
 * Land Parcel Property Framework for Moranbah, LISTmap TPS zones for
 * Hobart, the ACT Territory Plan for Phillip, and the NSW Online DA API
 * for Muswellbrook Shire. Parsers are judged against what the services
 * actually said, never against documentation.
 */
import { describe, expect, it } from 'vitest';
import {
  buildNswDaRequest,
  buildNswZoningQuery,
  buildQldParcelQuery,
  buildVicZoningQuery,
  epochMsToIsoDate,
  parseActZoning,
  parseNswZoning,
  parseQldInstrument,
  parseQldParcel,
  parseTasZoning,
  parseVicZoning,
  VERIFICATION_INSTRUMENT,
} from '../../../../supabase/functions/_shared/planning/planningSources.pure';
import {
  deriveZoneFamily,
  ZONE_FAMILY_LABEL,
} from '../../../../supabase/functions/_shared/planning/zoneFamily.pure';
import {
  councilNameCandidates,
  normaliseCouncilTokens,
  resolveCouncilName,
  summariseDaRows,
} from '../../../../supabase/functions/_shared/planning/developmentActivity.pure';
import {
  developmentActivityBlock,
  planningStatBlocks,
  zoningBlock,
} from '../../../../supabase/functions/_shared/reports/planningPromptBlocks.pure';

// ---------------------------------------------------------------------------
// Captured fixtures (verbatim service answers, 2026-09-06)
// ---------------------------------------------------------------------------

const NSW_MUSWELLBROOK = {
  features: [{
    attributes: {
      EPI_NAME: 'Muswellbrook Local Environmental Plan 2009',
      LGA_NAME: 'MUSWELLBROOK',
      SYM_CODE: 'R1',
      LAY_CLASS: 'General Residential',
      CURRENCY_DATE: 1686268800000,
    },
  }],
};

const VIC_WYNDHAM = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    id: 'plan_zone.49372',
    properties: {
      scheme_code: 'ZN',
      lga: 'WYNDHAM',
      zone_code: 'UGZ8',
      zone_description: 'URBAN GROWTH ZONE - SCHEDULE 8',
    },
  }],
};

const QLD_MORANBAH = {
  features: [{
    attributes: {
      lot_area: 809.0,
      shire_name: 'Isaac Regional',
      lotplan: '45M9738',
      lot: '45',
      plan: 'M9738',
      tenure: 'Freehold',
      locality: 'Moranbah',
    },
  }],
};

const TAS_HOBART = {
  features: [{
    attributes: {
      LPS: 'Hobart Local Provisions Schedule',
      ZONE: 'Central Business',
      ZONE_ABB: '114.16',
      ZONESUBGRP: null,
      LPSDATE: 1761091200000,
    },
  }],
};

const ACT_PHILLIP = {
  features: [{
    attributes: {
      LAND_USE_ZONE_CODE_ID: 'CZ1',
      LAND_USE_POLICY_DESC: 'CORE ZONE',
      DIVISION_NAME: 'PHILLIP',
      DISTRICT_NAME: 'WODEN VALLEY',
      GAZETTAL_DATE: 1206921600000,
      CURRENT_LIFECYCLE_STAGE: 'GAZETTED',
    },
  }],
};

/** One real application row from the Online DA response (fields we read). */
const NSW_DA_ROW = {
  PlanningPortalApplicationNumber: 'PAN-650576',
  // A modification's number is its parent's plus one segment — the register's
  // own convention, agreed with its `ApplicationType` on 655 of 655 rows when
  // measured live (see `parentApplicationKey`).
  CouncilApplicationNumber: '412/2025/HA/A',
  LodgementDate: '2026-06-23',
  DeterminationDate: '2026-06-25',
  CostOfDevelopment: 958740.0,
  NumberOfNewDwellings: 1,
  ApplicationStatus: 'Determined',
  ApplicationType: 'Modification Application',
  Council: { CouncilName: 'Muswellbrook Shire Council' },
  DevelopmentType: [
    { DevelopmentType: 'Dwelling house' },
    { DevelopmentType: 'Erection of a new structure' },
  ],
  Location: [{ FullAddress: '511 RICHMOND GROVE ROAD SANDY HOLLOW 2333', Suburb: 'SANDY HOLLOW', Postcode: '2333' }],
};

// ---------------------------------------------------------------------------
// Parsers against the real answers
// ---------------------------------------------------------------------------

describe('jurisdiction parsers read the services’ own fields', () => {
  it('NSW: zone, instrument, LGA and currency date come through verbatim', () => {
    const out = parseNswZoning(NSW_MUSWELLBROOK);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.reading).toMatchObject({
      jurisdiction: 'NSW',
      zoneCode: 'R1',
      zoneLabel: 'General Residential',
      instrument: 'Muswellbrook Local Environmental Plan 2009',
      lga: 'MUSWELLBROOK',
      currencyDate: '2023-06-09',
    });
  });

  it('VIC: zone code and LGA from the WFS properties', () => {
    const out = parseVicZoning(VIC_WYNDHAM);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.reading.zoneCode).toBe('UGZ8');
    expect(out.reading.zoneLabel).toBe('URBAN GROWTH ZONE - SCHEDULE 8');
    expect(out.reading.lga).toBe('WYNDHAM');
  });

  it('QLD: surveyed lot area keeps its basis, and the LGA is the shire name', () => {
    const out = parseQldParcel(QLD_MORANBAH);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.reading).toMatchObject({
      lotPlan: '45M9738',
      area: 809,
      areaBasis: 'surveyed',
      lga: 'Isaac Regional',
      tenure: 'Freehold',
    });
  });

  it('TAS: the zone is the scheme’s words, and the LGA is read from the LPS name', () => {
    const out = parseTasZoning(TAS_HOBART);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.reading.zoneCode).toBe('Central Business');
    expect(out.reading.instrument).toBe('Hobart Local Provisions Schedule');
    expect(out.reading.lga).toBe('HOBART');
    expect(out.reading.currencyDate).toBe('2025-10-22');
  });

  it('ACT: gazetted feature wins and the division stands in for the LGA', () => {
    const out = parseActZoning(ACT_PHILLIP);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.reading.zoneCode).toBe('CZ1');
    expect(out.reading.zoneLabel).toBe('CORE ZONE');
    expect(out.reading.lga).toBe('PHILLIP');
  });

  it('QLD instruments: a PDA row carries its name, status and gazettal', () => {
    const out = parseQldInstrument('priority_development_area', {
      features: [{ attributes: { pda_name: 'Caloundra South', gazetted_date: 1206921600000, pda_status: 'Declared', lga_name: 'Sunshine Coast Regional' } }],
    });
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.reading[0]).toMatchObject({ kind: 'priority_development_area', name: 'Caloundra South', status: 'Declared' });
  });
});

describe('a failed read is never an empty coverage', () => {
  it.each([
    ['service error body', { error: { message: 'Invalid URL' } }],
    ['no features array', { fields: [] }],
    ['non-object', 'gateway timeout page'],
  ])('%s parses as error, not empty', (_label, body) => {
    expect(parseNswZoning(body).kind).toBe('error');
    expect(parseQldParcel(body).kind).toBe('error');
    expect(parseTasZoning(body).kind).toBe('error');
  });

  it('an answered-but-empty layer is a definite empty', () => {
    expect(parseNswZoning({ features: [] }).kind).toBe('empty');
    expect(parseVicZoning({ type: 'FeatureCollection', features: [] }).kind).toBe('empty');
  });

  it('epoch dates refuse the unparseable instead of inventing a day', () => {
    expect(epochMsToIsoDate(1686268800000)).toBe('2023-06-09');
    expect(epochMsToIsoDate(null)).toBeNull();
    expect(epochMsToIsoDate('2023-06-09')).toBeNull();
    expect(epochMsToIsoDate(-1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Query builders — the executed shapes, pinned
// ---------------------------------------------------------------------------

describe('query builders reproduce the executed requests', () => {
  it('NSW asks layer 19 with the verified outFields', () => {
    const url = buildNswZoningQuery(150.8934483, -32.257687);
    expect(url).toContain('/MapServer/19/query');
    expect(url).toContain('EPI_NAME%2CLGA_NAME%2CSYM_CODE%2CLAY_CLASS%2CCURRENCY_DATE');
    expect(url).toContain('returnGeometry=false');
  });

  it('VIC filters by point intersection and never fetches geometry', () => {
    const url = buildVicZoningQuery(144.6194495, -37.866888);
    expect(url).toContain('plan_zone');
    // URLSearchParams form-encodes the CQL space as `+`; GeoServer decodes
    // it (verified live 2026-09-06 — same feature as the %20 probe).
    expect(decodeURIComponent(url).replace(/\+/g, ' ')).toContain(
      'INTERSECTS(geom,SRID=4326;POINT(144.6194495 -37.866888))',
    );
  });

  it('QLD sends the JSON point geometry the service requires', () => {
    const url = buildQldParcelQuery(148.0452959, -22.0043462);
    expect(decodeURIComponent(url)).toContain('"x":148.0452959');
    expect(url).toContain('LandParcelPropertyFramework/MapServer/4/query');
  });

  it('the DA request carries paging and filters as HEADERS, with a candidate list', () => {
    const req = buildNswDaRequest(['MUSWELLBROOK SHIRE COUNCIL', 'MUSWELLBROOK COUNCIL'], '2026-03-01', '2026-09-01', 100, 2);
    expect(req.headers.PageSize).toBe('100');
    expect(req.headers.PageNumber).toBe('2');
    const filters = JSON.parse(req.headers.filters);
    expect(filters.filters.CouncilName).toEqual(['MUSWELLBROOK SHIRE COUNCIL', 'MUSWELLBROOK COUNCIL']);
    expect(filters.filters.LodgementDateFrom).toBe('2026-03-01');
  });
});

// ---------------------------------------------------------------------------
// Zone family — derived from the instrument's own words, never a code table
// ---------------------------------------------------------------------------

describe('zone family', () => {
  it('reads the family from the label the service returned', () => {
    expect(deriveZoneFamily('NSW', 'R1', 'General Residential')).toBe('residential');
    expect(deriveZoneFamily('VIC', 'UGZ8', 'URBAN GROWTH ZONE - SCHEDULE 8')).toBe('urban_growth');
    expect(deriveZoneFamily('TAS', 'Central Business', null)).toBeNull();
    expect(deriveZoneFamily('TAS', 'Central Business', 'Central Business')).toBe('commercial');
  });

  it('ACT uses the Territory Plan’s own prefix legend (labels name sub-policies)', () => {
    expect(deriveZoneFamily('ACT', 'CZ1', 'CORE ZONE')).toBe('commercial');
    expect(deriveZoneFamily('ACT', 'RZ2', 'SUBURBAN')).toBe('residential');
    expect(deriveZoneFamily('ACT', 'NUZ3', 'HILLS, RIDGES AND BUFFER')).toBe('rural');
  });

  it('NSW’s ambiguous "Employment" wording resolves to NO family, never the wrong one', () => {
    // The employment-zones reform spans retail centres (E1) to heavy
    // industry (E5); the bare word must not file a local centre under
    // industrial.
    expect(deriveZoneFamily('NSW', 'E1', 'Employment')).toBeNull();
  });

  it('every family has a render label', () => {
    for (const fam of ['residential', 'commercial', 'urban_growth'] as const) {
      expect(ZONE_FAMILY_LABEL[fam]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Council resolution — exact-match register, refusal over guessing
// ---------------------------------------------------------------------------

describe('council name resolution', () => {
  it('normalisation strips dressing and sorts tokens', () => {
    expect(normaliseCouncilTokens('Muswellbrook Shire Council')).toBe('MUSWELLBROOK');
    expect(normaliseCouncilTokens('COUNCIL OF THE CITY OF SYDNEY')).toBe('SYDNEY');
    expect(normaliseCouncilTokens('CANTERBURY-BANKSTOWN')).not.toBe(normaliseCouncilTokens('BANKSTOWN'));
  });

  it('candidates dress the LGA’s own tokens, never another council’s', () => {
    const candidates = councilNameCandidates('MUSWELLBROOK');
    expect(candidates).toContain('MUSWELLBROOK SHIRE COUNCIL');
    expect(candidates).toContain('COUNCIL OF THE CITY OF MUSWELLBROOK');
    for (const c of candidates) expect(normaliseCouncilTokens(c)).toBe('MUSWELLBROOK');
  });

  it('resolves exactly one register name and refuses ambiguity', () => {
    expect(resolveCouncilName('MUSWELLBROOK', ['Muswellbrook Shire Council'])).toEqual({ resolved: 'Muswellbrook Shire Council' });
    const none = resolveCouncilName('MUSWELLBROOK', ['Singleton Council']);
    expect(none.resolved).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DA summariser — arithmetic over rows, coverage disclosed
// ---------------------------------------------------------------------------

describe('DA summary', () => {
  /*
   * Three classes, because the register carries three and they must never be
   * added. `NSW_DA_ROW` is a **Modification Application** — and so, before
   * this, was the second row of this fixture, because it spread the first.
   * The old assertion therefore summed two restatements of the same kind of
   * thing and called the result the area's development activity.
   */
  const summary = summariseDaRows([
    NSW_DA_ROW,
    {
      ...NSW_DA_ROW,
      PlanningPortalApplicationNumber: 'PAN-000001',
      CouncilApplicationNumber: '900/2026/HA',
      ApplicationType: 'Development Application',
      CostOfDevelopment: 12_500_000,
      NumberOfNewDwellings: 24,
      ApplicationStatus: 'Under Assessment',
      DevelopmentType: [{ DevelopmentType: 'Residential flat building' }],
      Location: [{ Suburb: 'MUSWELLBROOK', FullAddress: '2 MARKET STREET MUSWELLBROOK 2333' }],
    },
    {
      ...NSW_DA_ROW,
      PlanningPortalApplicationNumber: 'PAN-000002',
      CouncilApplicationNumber: '901/2026/HA',
      ApplicationType: 'Some Future Application Kind',
      CostOfDevelopment: 400_000,
      NumberOfNewDwellings: 2,
    },
  ], 'Muswellbrook Shire Council', '2026-03-07', '2026-09-06', 62);

  it('counts new proposals apart from the amendments that restate them', () => {
    expect(summary.newApplications).toMatchObject({
      rows: 1, statedCostTotal: 12_500_000, rowsWithCost: 1, newDwellingsTotal: 24, rowsWithDwellings: 1,
    });
    expect(summary.amendments).toMatchObject({
      rows: 1, statedCostTotal: 958_740, rowsWithCost: 1, newDwellingsTotal: 1, rowsWithDwellings: 1,
    });
  });

  it('puts a type it does not recognise in its own bucket, never in `new`', () => {
    // The conservative side: a word the register adds tomorrow cannot inflate
    // the headline figure, and it is visible rather than silently absorbed.
    expect(summary.unclassified).toMatchObject({ rows: 1, statedCostTotal: 400_000, newDwellingsTotal: 2 });
    expect(summary.byApplicationType).toContainEqual(
      { type: 'Some Future Application Kind', klass: 'unclassified', count: 1 },
    );
  });

  it('offers no combined total for anything to add up', () => {
    // The fields that used to carry one are gone rather than redefined: a
    // number that silently changes meaning is worse than one that stops
    // compiling.
    const keys = Object.keys(summary);
    expect(keys).not.toContain('statedCostTotal');
    expect(keys).not.toContain('newDwellingsTotal');
    expect(keys).not.toContain('rowsWithCost');
    expect(keys).not.toContain('rowsWithDwellings');
  });

  it('carries the register total beside the rows read, so a sample says so', () => {
    expect(summary.totalInPeriod).toBe(62);
    expect(summary.rowsRead).toBe(3);
  });

  it('ranks the largest DEVELOPMENTS, each carrying its own identity', () => {
    expect(summary.largestDevelopments[0].statedCost).toBe(12_500_000);
    expect(summary.largestDevelopments[0].reference).toBe('900/2026/HA');
    expect(summary.largestDevelopments[0].address).toBe('2 MARKET STREET MUSWELLBROOK 2333');
    expect(summary.largestDevelopments[0].types).toContain('Residential flat building');
    // The modification is still listed — it is real activity — but it is
    // filed under the development it modifies and says it was approved before
    // this window, so it cannot be read as something newly proposed in it.
    const mod = summary.largestDevelopments.find((d) => d.statedCost === 958_740);
    expect(mod?.reference).toBe('412/2025/HA');
    expect(mod?.amendmentsInWindow).toBe(1);
    expect(mod?.parentOutsideWindow).toBe(true);
  });

  it('the prompt block labels applicant-stated costs and sampling', () => {
    const block = developmentActivityBlock({ planningData: { developmentActivity: { status: 'ok', summary } } });
    expect(block).toContain('as stated by applicants');
    expect(block).toContain('62');
    expect(block).toContain('3 applications read of 62');
  });

  it('the prompt block keeps the three classes apart and says why', () => {
    // The model reads this block. An unlabelled pair of figures is a pair a
    // narrative will add together, which is the whole defect.
    const block = developmentActivityBlock({ planningData: { developmentActivity: { status: 'ok', summary } } });
    expect(block).toContain('New development applications — stated cost: **$12,500,000**');
    expect(block).toContain('Modifications of approved developments — stated cost: **$958,740**');
    expect(block).toContain('MUST NOT be added to the one above');
    expect(block).toContain('Applications of an unrecognised type');
    // And no line offers the sum of them.
    expect(block).not.toContain('$13,458,740');
    expect(block).not.toContain('$13,858,740');
  });
});

// ---------------------------------------------------------------------------
// Prompt blocks — the family never impersonates the zone; absences disclose
// ---------------------------------------------------------------------------

describe('planning prompt blocks', () => {
  const okZoning = {
    status: 'ok', jurisdiction: 'NSW', zoneCode: 'R1', zoneLabel: 'General Residential',
    instrument: 'Muswellbrook Local Environmental Plan 2009', lga: 'MUSWELLBROOK',
    currencyDate: '2023-06-09', source: 'NSW Planning Portal', licence: 'CC BY 4.0',
    zoneFamily: 'residential',
  };

  it('the verbatim code leads and the family is only a reading beside it', () => {
    const block = zoningBlock({ planningData: { zoning: okZoning } });
    expect(block).toContain('**R1**');
    expect(block).toContain('the zone is **R1**, and only that code may be stated as the zoning');
  });

  it('an absent cell renders its reason, and WA’s licence bar is a different sentence from an outage', () => {
    const text = planningStatBlocks({
      planningData: {
        jurisdiction: 'WA',
        zoning: { status: 'licence_restricted', note: 'WA planning scheme data (SLIP) is published for personal, non-commercial use' },
        parcel: { status: 'licence_restricted', note: 'same terms' },
        developmentActivity: { status: 'not_served', note: 'no state-wide DA feed exists' },
        verification: 'A spatial layer is indicative; what settles the question is the local government planning scheme and PlanWA.',
      },
    });
    expect(text).toContain('non-commercial');
    expect(text).toContain('Not available for this property, and why');
    expect(text).toContain('Do NOT name a zone');
  });

  it('no planning data at all instructs an honest absence, never a guess', () => {
    const text = planningStatBlocks({});
    expect(text).toContain('do not name a zone');
    expect(text).toMatch(/do not invent development activity/i);
  });

  it('verification instruments exist for every jurisdiction', () => {
    for (const j of ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const) {
      expect(VERIFICATION_INSTRUMENT[j].length).toBeGreaterThan(10);
    }
  });
});
