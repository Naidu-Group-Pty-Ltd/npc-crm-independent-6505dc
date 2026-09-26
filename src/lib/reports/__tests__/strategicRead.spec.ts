/**
 * The Due Diligence document opens with what its evidence adds up to.
 *
 * The owner, of the 23 Sep 2026 document for 97 Poole Road: it should identify
 * "the strategic nature of this opportunity itself rather than just
 * information pounding". See `composeStrategicRead`.
 */
import { describe, expect, it } from 'vitest';
import {
  composeStrategicRead,
  composeStrategySections,
  type StrategyRecord,
  type StrategySite,
} from '../../../../supabase/functions/_shared/reports/investment/strategyPositions.pure';
import { strategySiteFrom } from '../../../../supabase/functions/_shared/reports/location/strategySite.pure';
import {
  EXISTING_DWELLING_CAVEAT,
  READING_LIMIT,
} from '../../../../supabase/functions/_shared/planning/landUsePermissibility.pure';
import { PLDD_SECTION_ORDER } from '../../../../supabase/functions/_shared/reportSplitRegistry';
import { sectionsForTier } from '../../../../supabase/functions/_shared/reports/investment/sectionRegistry.pure';
import type { MarketFactRow } from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';

const HEADING = 'The Opportunity in Strategic Terms';

const row = (over: Partial<MarketFactRow> & Pick<MarketFactRow, 'key' | 'label' | 'value'>): MarketFactRow => ({
  describes: 'postcode 2155, NSW — houses, 162 sales, 2026-03-31',
  publisher: 'NSW Department of Communities and Justice — Rent and Sales Report',
  note: null,
  benchmark: false,
  ...over,
});

/** 97 Poole Road as its registers read on 20 Sep 2026. */
const SITE: StrategySite = {
  landUse: {
    anchor: 'Under The Hills Local Environmental Plan 2019, as read on 20 Sep 2026,',
    dwellingHouse: 'permitted_with_consent',
    additional: [
      { use: 'secondary dwellings', standing: 'prohibited' },
      { use: 'dual occupancies', standing: 'prohibited' },
      { use: 'multi dwelling housing', standing: 'prohibited' },
    ],
    caveat: EXISTING_DWELLING_CAVEAT,
    limit: READING_LIMIT,
  },
  pipeline: { dwellings: 241, council: 'The Hills Shire', window: '21 Mar 2026 to 20 Sep 2026', rowsRead: 300, totalStated: 648 },
};

const record = (over: Partial<StrategyRecord> = {}): StrategyRecord => ({
  property: { address: '97 Poole Road, Kellyville NSW 2155', propertyType: 'House', landSqm: 497.6, councilArea: 'THE HILLS SHIRE', parking: null, bedrooms: null },
  price: { basis: 'accepted_input', value: 1_650_000, label: 'Purchase price this analysis is modelled on', provenance: 'recorded' },
  market: {
    rows: [
      row({ key: 'growth5YearCagr', label: 'Price growth, 5 years (compound annual)', value: '6.2%' }),
      row({ key: 'benchmarkGrowth5YearCagr', label: 'Benchmark price growth, 5 years (compound annual)', value: '7.6%', benchmark: true, describes: 'NSW (all areas the publisher monitors) — houses, 2026-03-31' }),
    ],
    withheld: [], unavailable: [], consulted: ['nsw_dcj_rent_sales'], anyStated: true, evidenceMissing: false,
  },
  finance: null,
  planning: { zone: 'R2 — Low Density Residential', zoneStatus: 'stated', zoneSource: null, zoneEffectiveDate: null, council: 'THE HILLS SHIRE', verification: null, retrievedAt: null } as StrategyRecord['planning'],
  transport: { source: null, verdict: null, countReading: null, nearestKm: null, nearestName: null, sources: [], feedLoadedAt: null, measuredAt: null, notMeasured: [] } as unknown as StrategyRecord['transport'],
  score: { grade: null, total: null, gaps: [], dimensions: [], coverageLabel: null, weightCovered: null, notAssessed: {}, authority: null, assessment: null } as unknown as StrategyRecord['score'],
  site: SITE,
  ...over,
});

describe('what the strategic read says', () => {
  const md = composeStrategicRead(record(), HEADING);

  it('names the kind of purchase from the land use table, and its consequence', () => {
    expect(md).toContain(`## ${HEADING}`);
    expect(md).toContain('A house on 497.6 m² in the R2 — Low Density Residential zone, The Hills Shire.');
    expect(md).toContain('Under The Hills Local Environmental Plan 2019, as read on 20 Sep 2026, a dwelling house is permitted with development consent, and secondary dwellings, dual occupancies and multi dwelling housing are prohibited.');
    expect(md).toContain('So this is a single-dwelling purchase');
    // The planning module's own qualifications, verbatim — never paraphrased.
    expect(md).toContain(EXISTING_DWELLING_CAVEAT);
    expect(md).toContain(READING_LIMIT);
  });

  it('sets the market beside its benchmark, over the same window', () => {
    expect(md).toContain('Measured price growth over five years was 6.2% a year');
    expect(md).toContain('grew 7.6% a year');
    expect(md).toContain('so this market trailed it by 1.4 points over the same window');
    expect(md).toContain('not a forecast');
  });

  it('states the pipeline as a floor where it is one, with its register dates', () => {
    expect(md).toContain('At least 241 new dwellings were stated on development applications in The Hills Shire, 21 Mar 2026 to 20 Sep 2026');
    expect(md).toContain('summed from 300 of the 648 applications');
  });

  it('closes on what decides it', () => {
    expect(md).toContain('**What decides it.**');
    expect(md).toContain('Due Diligence Checklist');
  });

  it('rates, values and forecasts nothing', () => {
    expect(md).not.toMatch(/\b(low|moderate|high) (risk|exposure)\b/i);
    expect(md).not.toMatch(/\b(undervalued|bargain|discount|uplift|below the median|entry point)\b/i);
    expect(md).not.toMatch(/\bwill (rise|grow|increase)\b/i);
  });
});

describe('what it declines to say', () => {
  it('names a permission without valuing it, and does not call the purchase single-dwelling', () => {
    const site: StrategySite = { ...SITE, landUse: { ...SITE.landUse!, additional: [{ use: 'secondary dwellings', standing: 'permitted_with_consent' }] } };
    const md = composeStrategicRead(record({ site }), HEADING);
    expect(md).toContain('The table permits secondary dwellings with consent.');
    expect(md).toContain('no value is attached to it here');
    expect(md).not.toContain('single-dwelling purchase');
  });

  it('agrees the verb with the use the table names, not with how many it names', () => {
    const one = (use: string): string => composeStrategicRead(record({
      site: { ...SITE, landUse: { ...SITE.landUse!, additional: [{ use, standing: 'prohibited' }] } },
    }), HEADING);
    expect(one('secondary dwellings')).toContain('and secondary dwellings are prohibited.');
    expect(one('multi dwelling housing')).toContain('and multi dwelling housing is prohibited.');
  });

  it('says a table was not retrieved rather than implying what may be built', () => {
    const md = composeStrategicRead(record({ site: { landUse: null, pipeline: null } }), HEADING);
    expect(md).toContain('The land use table for this property has not been confirmed');
    expect(md).not.toContain('single-dwelling purchase');
    expect(md).not.toContain('What it competes with');
  });

  it('computes no gap between windows that do not match', () => {
    const market = record().market;
    const md = composeStrategicRead(record({
      market: { ...market, rows: market.rows.map((r) => (r.benchmark ? { ...r, describes: 'NSW — houses, 2025-12-31' } : r)) },
    }), HEADING);
    expect(md).toContain('grew 7.6% a year');
    expect(md).not.toContain('trailed');
  });

  it('draws nothing where the record supports none of it', () => {
    const empty = composeStrategicRead(record({
      property: { address: 'x', propertyType: null, landSqm: null, councilArea: null, parking: null, bedrooms: null },
      planning: { ...record().planning, zone: null, council: null },
      market: { ...record().market, rows: [] },
      site: null,
    }), HEADING);
    expect(empty).toBe('');
  });

  it('is byte-identical for every other composer when a record carries no site', () => {
    const withSite = composeStrategySections(record(), [{ id: 'monitoring', heading: 'Monitoring & Review Plan' }]);
    const without = composeStrategySections(record({ site: undefined }), [{ id: 'monitoring', heading: 'Monitoring & Review Plan' }]);
    expect(withSite[0].markdown).toBe(without[0].markdown);
  });
});

describe('the site reading comes from the stored evidence', () => {
  it('reads the stored table and pipeline, and carries the planning module\'s words', () => {
    const site = strategySiteFrom({
      planning: {
        landUse: {
          status: 'retrieved', instrument: 'The Hills Local Environmental Plan 2019', zoneCode: 'R2', objectives: null,
          permittedWithoutConsent: [], permittedWithConsent: ['Dwelling houses'],
          prohibited: ['Secondary dwellings', 'Dual occupancies'],
          source: null, sourceUrl: null, licence: null, retrievedAt: '2026-09-20T03:00:00Z', note: null,
        },
      },
      infrastructure: {
        pipelineDwellings: { total: 241, rowsStating: 120, window: '21 Mar 2026 to 20 Sep 2026', council: 'The Hills Shire' },
        registerWalk: { rowsRead: 300, totalStated: 648 },
      },
    });
    expect(site?.landUse?.dwellingHouse).toBe('permitted_with_consent');
    expect(site?.landUse?.additional.find((a) => a.use === 'secondary dwellings')?.standing).toBe('prohibited');
    expect(site?.landUse?.anchor).toBe('Under The Hills Local Environmental Plan 2019, as read on 20 Sep 2026,');
    expect(site?.landUse?.limit).toBe(READING_LIMIT);
    expect(site?.pipeline).toEqual({ dwellings: 241, council: 'The Hills Shire', window: '21 Mar 2026 to 20 Sep 2026', rowsRead: 300, totalStated: 648 });
  });

  it('is null for a row stored before the evidence was recorded', () => {
    expect(strategySiteFrom({ transport: {} })).toBeNull();
    expect(strategySiteFrom(null)).toBeNull();
  });
});

describe('it is placed where the document opens', () => {
  it('sits straight after the snapshot in the Due Diligence order and the strategic tier', () => {
    const at = PLDD_SECTION_ORDER.findIndex((e) => e.heading === HEADING);
    expect(at).toBe(1);
    expect(PLDD_SECTION_ORDER[0].heading).toBe('Client Property & Location Snapshot');
    const strategic = sectionsForTier('strategic');
    const placement = strategic.find((s) => s.label === HEADING);
    expect(placement?.order).toBe(3.5);
  });
});
