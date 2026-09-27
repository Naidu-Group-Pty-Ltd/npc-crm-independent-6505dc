/**
 * The Australian Government's Infrastructure Investment Program, read at the
 * property's coordinate.
 *
 * Fixtures are the register's own answers at 37 Bolin Street, Tallawong,
 * measured from a runner on 27 Sep 2026 (`infrastructure-source-inspect.py`,
 * round 3): the attribute values are copied, the geometry is a two-vertex
 * stand-in placed where each project runs.
 */
import { describe, expect, it } from 'vitest';
import { registerHeaderKey } from '../../../../supabase/functions/_shared/reports/investment/registerTables.pure';

import {
  IPAMS_LAYERS,
  MAJOR_PROJECT_FLOOR,
  NATIONAL_PROGRAMME_ITEM_CAP,
  cleanName,
  geometryDistanceKm,
  horizonOf,
  ipamsQuery,
  isMajorProject,
  mergeProjects,
  parseIpamsAnswer,
  parseMoney,
  readNationalProgramme,
  timingSentence,
  yearOf,
} from '../../../../supabase/functions/_shared/planning/nationalInvestmentProgramme.pure.ts';
import {
  buildInfrastructureEvidence,
  coverageLimitsFor,
  renderInfrastructureOutlook,
} from '../../../../supabase/functions/_shared/planning/infrastructureEvidence.pure.ts';

const BOLIN = { lat: -33.6903115, lon: 150.8816157 };

/** A line feature a given distance west of the property, as the layer returns one. */
const feature = (attributes: Record<string, unknown>, kmWest = 4) => {
  const dLon = kmWest / (111.32 * Math.cos((BOLIN.lat * Math.PI) / 180));
  return {
    attributes,
    geometry: { paths: [[[BOLIN.lon - dLon, BOLIN.lat - 0.01], [BOLIN.lon - dLon, BOLIN.lat + 0.01]]] },
  };
};

const RICHMOND = {
  Project_ID: '126944-23NSW-NP', ProjectName: 'Richmond Road Upgrade, M7 Motorway to Townson Road',
  ProjectStatus: 'Under Construction', SubProgram: 'Investment Road and Rail Program', TransportMode: 'Road',
  EstimatedProjectCost: '$520,000,000', AGC: '$260,000,000', ExpectedStartDate: 'Early 2026',
  ExpectedEndDate: 'Late 2028', State: 'NSW',
  URL: 'http://investment.infrastructure.gov.au/projects/ProjectDetails.aspx?Project_id=126944-23NSW-NP',
};
const GARFIELD = {
  Project_ID: '126946-23NSW-NP', ProjectName: 'Garfield Road East Upgrade', ProjectStatus: 'In Planning',
  SubProgram: 'Investment Road and Rail Program', TransportMode: 'Road', EstimatedProjectCost: '$440,000,000',
  AGC: '$220,000,000', ExpectedStartDate: 'Early 2027', ExpectedEndDate: 'Late 2029', State: 'NSW', URL: '',
};
const NEW_LINE = {
  Project_ID: '101262-19NSW-MRD', ProjectName: 'New Line Road', ProjectStatus: 'In Planning',
  SubProgram: 'Major Project Business Case', TransportMode: 'Road', EstimatedProjectCost: '$20,000,000',
  AGC: '$10,000,000', ExpectedStartDate: 'TBC', ExpectedEndDate: 'TBC', State: 'NSW', URL: '',
};
const QUAKERS_HILL = {
  Project_ID: '129973-24NSW-RTR', ProjectName: 'Railway Road, Quakers Hill - 129973-24NSW-RTR',
  ProjectStatus: 'Not Started', SubProgram: 'Roads to Recovery Program', TransportMode: 'Road',
  EstimatedProjectCost: '$3,321,755', AGC: '$3,321,755', ExpectedStartDate: 'Jul 2026',
  ExpectedEndDate: 'Jan 2027', State: 'NSW', URL: '',
};

describe('the register, read by location', () => {
  it('asks both place-based layers for live projects only, in WGS84, within the radius', () => {
    expect(IPAMS_LAYERS).toEqual(['AuslinkGIS_Line_web', 'AuslinkGIS_Point_web']);
    const url = new URL(ipamsQuery('AuslinkGIS_Line_web', BOLIN.lat, BOLIN.lon, 15));
    expect(url.hostname).toBe('spatial.infrastructure.gov.au');
    expect(url.searchParams.get('where')).toBe("ProjectStatus <> 'Completed'");
    expect(url.searchParams.get('geometry')).toBe(`${BOLIN.lon},${BOLIN.lat}`);
    expect(url.searchParams.get('distance')).toBe('15000');
    expect(url.searchParams.get('outSR')).toBe('4326');
  });

  it('reads money as the Department writes it, and an empty cell as absent, never zero', () => {
    expect(parseMoney('$520,000,000')).toBe(520_000_000);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(cleanName(QUAKERS_HILL.ProjectName, QUAKERS_HILL.Project_ID)).toBe('Railway Road, Quakers Hill');
  });

  it('measures the distance to the nearest part of the works', () => {
    const d = geometryDistanceKm(feature(RICHMOND, 4).geometry, BOLIN);
    expect(d).toBeGreaterThan(3.9);
    expect(d).toBeLessThan(4.1);
    expect(geometryDistanceKm({ x: BOLIN.lon, y: BOLIN.lat }, BOLIN)).toBeCloseTo(0, 6);
    expect(geometryDistanceKm(null, BOLIN)).toBeNull();
  });

  it('makes one project of a corridor drawn as several features, at its nearest part', () => {
    const parsed = parseIpamsAnswer({ features: [feature(RICHMOND, 9), feature(RICHMOND, 4)] }, BOLIN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0].distanceKm).toBeCloseTo(4, 0);
    expect(parsed.projects[0].url).toMatch(/^https:\/\//);
    expect(mergeProjects(parsed.projects, parsed.projects)).toHaveLength(1);
  });

  it('refuses an error answer and a shapeless one, rather than reading them as empty', () => {
    expect(parseIpamsAnswer({ error: { message: 'Invalid query' } }, BOLIN)).toMatchObject({ ok: false });
    expect(parseIpamsAnswer('<html>', BOLIN)).toMatchObject({ ok: false });
    expect(parseIpamsAnswer({}, BOLIN)).toMatchObject({ ok: false });
  });
});

describe('maintenance is not a pipeline', () => {
  const parse = (...attrs: Array<Record<string, unknown>>) => {
    const r = parseIpamsAnswer({ features: attrs.map((a, i) => feature(a, 2 + i)) }, BOLIN);
    if (!r.ok) throw new Error(r.reason);
    return r.projects;
  };

  it('itemises the pipeline and counts Roads to Recovery and Black Spot works as a class', () => {
    const reading = readNationalProgramme(parse(RICHMOND, GARFIELD, NEW_LINE, QUAKERS_HILL));
    expect(reading.major.map((p) => p.name)).toEqual([
      'Richmond Road Upgrade, M7 Motorway to Townson Road', 'Garfield Road East Upgrade', 'New Line Road',
    ]);
    expect(reading.minorWorks).toBe(1);
  });

  it('itemises a maintenance item only where its own stated cost reaches the floor', () => {
    const [big] = parse({ ...QUAKERS_HILL, EstimatedProjectCost: `$${MAJOR_PROJECT_FLOOR}` });
    expect(isMajorProject(big)).toBe(true);
  });

  it('never itemises a project the Department says is not proceeding', () => {
    const [stopped] = parse({ ...GARFIELD, ProjectStatus: 'Not Currently Proceeding' });
    expect(isMajorProject(stopped)).toBe(false);
    expect(readNationalProgramme([stopped]).minorWorks).toBe(0);
  });

  it('caps the list and counts the rest, nearest first', () => {
    const many = Array.from({ length: NATIONAL_PROGRAMME_ITEM_CAP + 3 }, (_, i) => ({
      ...RICHMOND, Project_ID: `P${i}`, ProjectName: `Project ${i}`,
    }));
    const reading = readNationalProgramme(parse(...many));
    expect(reading.major).toHaveLength(NATIONAL_PROGRAMME_ITEM_CAP);
    expect(reading.majorNotItemised).toBe(3);
    expect(reading.major[0].name).toBe('Project 0');
  });
});

describe('an expected date is an expectation', () => {
  it('reads a year where the Department names one, and none from TBC', () => {
    expect(yearOf('Late 2028')).toBe(2028);
    expect(yearOf('2028')).toBe(2028);
    expect(yearOf('TBC')).toBeNull();
    expect(horizonOf('Late 2028', 2026)).toBe('next_two_years');
    expect(horizonOf('Late 2029', 2026)).toBe('three_to_five_years');
    expect(horizonOf('2034', 2026)).toBe('six_to_ten_years');
    expect(horizonOf('TBC', 2026)).toBeNull();
  });

  it('writes the timing as the Department’s expectation, never as a completion', () => {
    const [p] = (parseIpamsAnswer({ features: [feature(RICHMOND)] }, BOLIN) as { ok: true; projects: never[] }).projects;
    expect(timingSentence(p)).toBe(
      'Expected start Early 2026; expected end Late 2028 — the Department’s own expectation, not a completion date.',
    );
    const [tbc] = (parseIpamsAnswer({ features: [feature(NEW_LINE)] }, BOLIN) as { ok: true; projects: never[] }).projects;
    expect(timingSentence(tbc)).toBe('The Department states the timing is still to be confirmed.');
  });
});

describe('the outlook a client reads (37 Bolin Street, Tallawong)', () => {
  const parsed = parseIpamsAnswer({ features: [feature(RICHMOND, 4), feature(GARFIELD, 7), feature(QUAKERS_HILL, 3)] }, BOLIN);
  const planningData = {
    jurisdiction: 'NSW',
    fetchedAt: '2026-09-27T01:00:00.000Z',
    nationalProgramme: {
      status: 'ok',
      projects: parsed.ok ? parsed.projects : [],
      radiusKm: 15,
      truncated: false,
      source: 'Infrastructure Investment Program, Australian Government Department of Infrastructure',
      licence: 'CC BY',
      caveat: 'The Department notes on its own project map that some information may be missing or out of date.',
    },
  };
  const evidence = buildInfrastructureEvidence({ planningData });
  const page = renderInfrastructureOutlook(evidence);

  it('draws no date column where no entry carries a date, so no copy of it can say a project is undated', () => {
    const header = page.split('\n').find((l) => l.startsWith('| Reference |')) ?? '';
    expect(header).toBe('| Reference | Project or instrument | Type | Status | Where | Stated cost | Funding | Delivery timing |');
    expect(page).not.toContain('No date stated');
    expect(registerHeaderKey(header)).not.toBeNull();
  });

  it('names the Richmond Road upgrade with its status, cost, federal share and expected dates', () => {
    expect(page).toContain('Richmond Road Upgrade, M7 Motorway to Townson Road');
    expect(page).toContain('Under Construction');
    expect(page).toContain('$520,000,000 estimated project cost');
    expect(page).toContain('Australian Government $260,000,000; the Department does not say who funds the balance');
    expect(page).toContain('Expected start Early 2026; expected end Late 2028');
    expect(page).toMatch(/4\.0 km from the property, to the nearest part of the works/);
  });

  it('draws a ten-year horizon from the publishers’ own expected ends, and says it is not a forecast', () => {
    expect(page).toContain('The next ten years, as the publishers date it (from 2026)');
    expect(page).toContain('| Within two years | Richmond Road Upgrade, M7 Motorway to Townson Road (expected end Late 2028; Under Construction) |');
    expect(page).toContain('| Three to five years | Garfield Road East Upgrade (expected end Late 2029; In Planning) |');
    expect(page).toContain('not forecasts made by this report');
  });

  it('counts the maintenance item rather than listing it', () => {
    expect(page).not.toContain('Railway Road, Quakers Hill');
    expect(page).toContain('It also lists 1 smaller road maintenance and safety item');
  });

  it('no longer says federal programmes were not covered once the federal programme was read', () => {
    expect(evidence.coverageLimits.join(';')).not.toContain('state and federal budget infrastructure programmes');
    expect(coverageLimitsFor(false, true)).toContain('the state budget infrastructure programme, and federal programmes other than land transport');
    // Unread, the limit stands exactly as before.
    expect(coverageLimitsFor(false, false)).toContain('state and federal budget infrastructure programmes');
  });

  it('files a searched, empty answer as a finding about the area, and an unreached one as a gap in the report', () => {
    const empty = buildInfrastructureEvidence({ planningData: { ...planningData, nationalProgramme: { status: 'none_at_point', note: 'read, nothing listed' } } });
    expect(empty.readings.find((r) => r.register === 'national investment programme')?.reading).toBe('searched_empty');
    const down = buildInfrastructureEvidence({ planningData: { ...planningData, nationalProgramme: { status: 'unavailable', note: 'timed out' } } });
    expect(down.readings.find((r) => r.register === 'national investment programme')?.reading).toBe('not_searched');
  });
});
