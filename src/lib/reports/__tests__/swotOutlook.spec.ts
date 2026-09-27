/**
 * The SWOT reads the projects the infrastructure chapter prints.
 *
 * The 37 Bolin Street Compass (27 Sep 2026) printed "None identified: no
 * recorded figure supports one" under Opportunities while its infrastructure
 * chapter named Rouse Hill Hospital ($910m, early works under way) and a new
 * high school on track to open in 2027 — both within five kilometres.
 */
import { describe, expect, it } from 'vitest';

import {
  buildSwot,
  composeSwot,
  OUTLOOK_PROJECT_CAP,
  readStrategyRecord,
  type StrategyRowInput,
} from '../../../../supabase/functions/_shared/reports/investment/strategyPositions.pure';
import type { MarketFacts } from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';
import type { SubjectPrice } from '../../../../supabase/functions/_shared/reports/investment/subjectPrice.pure';
import { projectsNear } from '../../../../supabase/functions/_shared/planning/publishedProjectRegister.pure';
import { strategyOutlookProjects } from '../../../../supabase/functions/_shared/planning/strategyOutlook.pure';
import { INFRASTRUCTURE_EVIDENCE_KEY } from '../../../../supabase/functions/_shared/reports/location/planningEvidenceRecord.pure';
import { strategyOutlookFrom } from '../../../../supabase/functions/_shared/reports/location/strategySite.pure';
import type { InfrastructureItem } from '../../../../supabase/functions/_shared/planning/infrastructureEvidence.pure';

const NO_MARKET: MarketFacts = {
  rows: [], withheld: [], unavailable: [], consulted: [], anyStated: false, evidenceMissing: true,
};
const PRICE: SubjectPrice = {
  basis: 'accepted_input', value: 1_110_000,
  label: 'Purchase price this analysis is modelled on', provenance: 'recorded by the adviser for this assessment',
};
const ROW: StrategyRowInput = {
  propertyAddress: '37 Bolin Street, Tallawong NSW 2762',
  propertySpecs: { property_type: 'house', bedrooms: 4, bathrooms: 2, land_size_sqm: 300 },
};
const BOLIN = { lat: -33.6903115, lon: 150.8816157 };

const ROAD: InfrastructureItem = {
  name: 'Richmond Road Upgrade – M7 to Townson Road',
  reference: '123', kind: 'Federally funded transport project',
  statedStatus: 'Under Construction', standing: null, dateLabel: null, date: null,
  where: '4.2 km from the property, to the nearest part of the works · Road', address: null,
  statedCost: 520_000_000, costBasis: 'estimated_project_cost', statedCostRange: null, fundingPartners: [],
  federalContribution: 260_000_000, expectedEnd: 'Late 2028',
  statedDelivery: 'Expected to start Early 2026 and finish Late 2028, as the Department states it',
  applications: null, source: 'the Australian Government’s Infrastructure Investment Program',
  licence: 'CC BY', retrievedAt: null,
};
const DA: InfrastructureItem = {
  ...ROAD, name: 'Data centre', kind: 'Development application', costBasis: 'application', statedCost: 90_000_000,
  applications: { inWindow: 1, amendments: 0, approvedBeforeWindow: false },
};

function record(outlookProjects?: ReturnType<typeof strategyOutlookProjects>) {
  return readStrategyRecord(ROW, {
    market: NO_MARKET, price: PRICE, carriesModelling: false,
    ...(outlookProjects ? { outlook: { projects: outlookProjects } } : {}),
  });
}

describe('the published projects near the property', () => {
  const near = projectsNear(BOLIN.lat, BOLIN.lon, 15);
  const projects = strategyOutlookProjects({ items: [ROAD, DA] }, near);

  it('reads the recorded register first, nearest first, then the programme — and never a development application', () => {
    const names = projects.map((p) => p.name);
    expect(names).toContain('Rouse Hill Hospital');
    expect(names).toContain('New high school in Tallawong');
    expect(names[names.length - 1]).toBe(ROAD.name);
    expect(names).not.toContain('Data centre');
  });

  it('states the hospital’s status in the publisher’s words and never an opening date', () => {
    const h = projects.find((p) => p.name === 'Rouse Hill Hospital')!;
    expect(h.publisher).toMatch(/Health Infrastructure/);
    expect(h.status).toMatch(/underway/i);
    expect(h.cost).toBe('$910 million stated investment');
    expect(JSON.stringify(h)).not.toMatch(/open(s|ing)? in 2027|2027/);
  });

  it('carries the school’s published timing verbatim', () => {
    expect(projects.find((p) => p.name === 'New high school in Tallawong')!.timing)
      .toBe('On track to open Day 1 Term 1 2027');
  });

  it('fills the Opportunities quadrant, each entry disowning any effect on value', () => {
    const swot = buildSwot(record(projects));
    expect(swot.opportunities.length).toBe(Math.min(projects.length, OUTLOOK_PROJECT_CAP));
    for (const e of swot.opportunities) {
      expect(e.claim).toMatch(/^A published public project nearby: /);
      expect(e.basis).toMatch(/nothing here measures any effect on this property's value, rent\s+or demand/);
      expect(e.basis).toMatch(/^[A-Z]/);
    }
    const md = composeSwot(record(projects), 'SWOT Analysis');
    expect(md).not.toMatch(/Opportunities\n\n\*None identified/);
  });

  it('points at the chapter for the rest, rather than listing every project', () => {
    const many = Array.from({ length: OUTLOOK_PROJECT_CAP + 2 }, (_, i) => ({ ...ROAD, name: `Road ${i}` }));
    const swot = buildSwot(record(strategyOutlookProjects({ items: many }, [])));
    expect(swot.opportunities).toHaveLength(OUTLOOK_PROJECT_CAP);
    expect(swot.coverage.join(' ')).toMatch(/2 further published projects are listed with the infrastructure outlook/);
  });

  it('is byte-identical where the caller hands no outlook', () => {
    expect(composeSwot(record(), 'SWOT')).toBe(composeSwot(readStrategyRecord(ROW, {
      market: NO_MARKET, price: PRICE, carriesModelling: false, outlook: null,
    }), 'SWOT'));
    expect('outlook' in record()).toBe(false);
  });
});

describe('the resident population, by its sign alone', () => {
  const withPopulation = (value: string): MarketFacts => ({
    ...NO_MARKET, anyStated: true, evidenceMissing: false,
    rows: [{
      key: 'populationGrowth', label: 'Resident population growth (a driver, not growth)', value,
      describes: 'SA2 Riverstone, 2020–2025', publisher: 'Australian Bureau of Statistics', note: null, benchmark: false,
    }],
  });

  it('files growth as a strength and says it is a driver, not a forecast', () => {
    const swot = buildSwot(readStrategyRecord(ROW, { market: withPopulation('6.1%'), price: PRICE, carriesModelling: false }));
    const e = swot.strengths.find((x) => /population/.test(x.claim))!;
    expect(e.claim).toBe('The area\'s resident population grew by 6.1% a year.');
    expect(e.basis).toMatch(/driver of housing demand, not a measure of it/);
    expect(e.basis).toMatch(/rather than a forecast/);
  });

  it('files decline as a threat', () => {
    const swot = buildSwot(readStrategyRecord(ROW, { market: withPopulation('-0.4%'), price: PRICE, carriesModelling: false }));
    expect(swot.threats.map((x) => x.claim)).toContain('The area\'s resident population fell by 0.4% a year.');
  });

  it('reads a typographic minus as a decline, never as growth', () => {
    const swot = buildSwot(readStrategyRecord(ROW, { market: withPopulation('\u22120.4%'), price: PRICE, carriesModelling: false }));
    expect(swot.strengths.some((x) => /population/.test(x.claim))).toBe(false);
    expect(swot.threats.map((x) => x.claim)).toContain('The area\'s resident population fell by 0.4% a year.');
  });

  it('files nothing where the row holds no value', () => {
    const market = withPopulation('1%');
    (market.rows[0] as { value: string | null }).value = null;
    const swot = buildSwot(readStrategyRecord(ROW, { market, price: PRICE, carriesModelling: false }));
    expect([...swot.strengths, ...swot.threats].some((x) => /population/.test(x.claim))).toBe(false);
  });
});

describe('the forks read the same projects off the stored row', () => {
  it('reads the recorded infrastructure evidence, never an application, where the row has no qualified coordinate', () => {
    const out = strategyOutlookFrom({ [INFRASTRUCTURE_EVIDENCE_KEY]: { items: [ROAD, DA] } });
    expect(out?.projects.map((p) => p.name)).toEqual([ROAD.name]);
  });

  it('answers null for a row that recorded nothing, so the SWOT is unchanged', () => {
    expect(strategyOutlookFrom(null)).toBeNull();
    expect(strategyOutlookFrom({ coordinates: { lat: -33.69, lng: 150.88 } })).toBeNull();
  });
});
