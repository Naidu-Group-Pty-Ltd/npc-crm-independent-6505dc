/**
 * Asking each jurisdiction what it publishes as its own population
 * projection — before any loader is written against it.
 *
 * These pin the discovery rules, not a measurement: the measurement is the
 * CI probe's output, and a constant recording it is changed when the probe
 * says so.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DESCRIBE_MAX_BYTES,
  ESTIMATE_PATTERN,
  PROJECTION_CATALOGUES,
  PROJECTION_PATTERN,
  PROJECTION_STATES,
  STATE_NAMES,
  judgeProjectionDataset,
  parseProjectionCatalogue,
  projectionAttributable,
  projectionFileLinks,
  projectionInventoryUrl,
  projectionSearchUrl,
  rankProjectionCandidates,
  rankProjectionLinks,
  POPULATION_PROJECTION_TITLE,
  isOwnPopulationProjection,
  jurisdictionsNamedIn,
  normalisePublisher,
  ownCatalogueDataset,
  projectionSubPages,
  rankOwnProjections,
  rankProjectionResources,
  resourceGrain,
} from '../../../../supabase/functions/_shared/reports/market/openData/stateProjectionPublishers.pure';
import { FORWARD_DEMAND_PUBLISHERS } from '../../../../supabase/functions/_shared/reports/market/openData/forwardDemand.pure';
import type { VolumeDataset } from '../../../../supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure';

const ds = (over: Partial<VolumeDataset> & { id: string }): VolumeDataset => ({
  name: over.id,
  title: over.id,
  notes: null,
  organisation: null,
  licence: null,
  metadataModified: null,
  resources: [],
  ...over,
});

const res = (format: string, url = `https://x/${format.toLowerCase()}`) => ({
  id: url, name: url, format, url, datastoreActive: false, size: null,
});

describe('every jurisdiction is asked, and the probe names only what it measured', () => {
  it('covers all eight, and every one has a product page to ask', () => {
    expect([...PROJECTION_STATES].sort()).toEqual(Object.keys(FORWARD_DEMAND_PUBLISHERS).sort());
    for (const s of PROJECTION_STATES) expect(FORWARD_DEMAND_PUBLISHERS[s].url).toMatch(/^https:\/\//);
  });

  it('marks as measured only the catalogues CI has actually reached', () => {
    const measured = PROJECTION_CATALOGUES.filter((c) => c.measured).map((c) => c.state).sort();
    expect(measured).toEqual(['ACT', 'NT', 'WA']);
    // Tasmania has no catalogue this repository has verified — its typed root is ENOTFOUND.
    expect(PROJECTION_CATALOGUES.some((c) => c.state === 'TAS')).toBe(false);
  });

  it('asks each dialect in its own terms', () => {
    const act = PROJECTION_CATALOGUES.find((c) => c.state === 'ACT')!;
    const nsw = PROJECTION_CATALOGUES.find((c) => c.state === 'NSW')!;
    expect(projectionSearchUrl(act, 'population projections')).toContain('api.us.socrata.com');
    expect(projectionSearchUrl(nsw, 'population projections')).toContain('/action/package_search?');
    expect(projectionInventoryUrl(nsw)).toContain('rows=0');
    expect(parseProjectionCatalogue({ dialect: 'ckan' }, '<html>').kind).toBe('refused');
  });
});

describe('a projection is judged on the publisher’s own words', () => {
  it('finds the finest grain the publisher names, and a file a loader could read', () => {
    const j = judgeProjectionDataset(ds({
      id: 'vif',
      title: 'Victoria in Future 2023 — population projections by SA2 and LGA',
      resources: [res('PDF'), res('XLSX')],
    }));
    expect(j.projection).toBe(true);
    expect(j.grainWords).toEqual(['sa2', 'lga']);
    expect(j.machineReadable?.format).toBe('XLSX');
  });

  it('refuses a measured estimate by name — the worst thing to print under a forward heading', () => {
    const erp = judgeProjectionDataset(ds({ id: 'erp', title: 'Estimated Resident Population by LGA' }));
    expect(erp.projection).toBe(false);
    expect(erp.estimateOnly).toBe(true);
    expect(rankProjectionCandidates([ds({ id: 'erp', title: 'Estimated Resident Population by LGA' })])).toEqual([]);
    expect(ESTIMATE_PATTERN.test('Estimated resident population')).toBe(true);
    expect(PROJECTION_PATTERN.test('Population projections 2021-2046')).toBe(true);
  });

  it('carries a suburb as a WORD, never as an SA2', () => {
    const act = judgeProjectionDataset(ds({ id: 'act', title: 'ACT population projections by suburb and district' }));
    expect(act.grainWords).toEqual(['suburb', 'district']);
    expect(act.grainWords).not.toContain('sa2');
  });

  it('ranks the finest named grain first, then a readable file', () => {
    const ranked = rankProjectionCandidates([
      ds({ id: 'lga', title: 'Projections by local government area', resources: [res('XLSX')] }),
      ds({ id: 'sa2-pdf', title: 'Projections by SA2', resources: [res('PDF')] }),
      ds({ id: 'sa2-csv', title: 'Projections by SA2', resources: [res('CSV')] }),
    ]);
    expect(ranked.map((j) => j.dataset.id)).toEqual(['sa2-csv', 'sa2-pdf', 'lga']);
  });
});

describe('a harvest hit is attributed to a jurisdiction by its own full name', () => {
  it('accepts the state’s own agencies', () => {
    expect(projectionAttributable(ds({ id: 'a', organisation: 'Queensland Government Statistician’s Office' }), 'QLD')).toBe(true);
    expect(projectionAttributable(ds({ id: 'b', organisation: 'Department of Transport and Planning (Victoria)' }), 'VIC')).toBe(true);
  });

  it('never attributes a council’s own forecast to the state', () => {
    // Town of Victoria Park is a Western Australian council.
    expect(projectionAttributable(ds({ id: 'c', organisation: 'Town of Victoria Park' }), 'VIC')).toBe(false);
    expect(projectionAttributable(ds({ id: 'd', organisation: 'City of Sydney' }), 'NSW')).toBe(false);
  });

  it('never attributes by abbreviation', () => {
    expect(projectionAttributable(ds({ id: 'e', organisation: 'Department of Climate Action' }), 'ACT')).toBe(false);
    for (const s of PROJECTION_STATES) for (const n of STATE_NAMES[s]) expect(n.length).toBeGreaterThan(4);
  });
});

describe('the product page is read for its files, and only its files', () => {
  const page = `
    <p>Download <a href="/sites/default/files/2024-05/NSW%20Population%20Projections%20by%20SA2.xlsx">projections by SA2 (XLSX)</a></p>
    <a href='https://example.nsw.gov.au/data/lga-projections.csv'>LGA projections</a>
    <a href="/docs/methodology.pdf">Methodology</a>
    <a href="/sites/default/files/2024-05/NSW%20Population%20Projections%20by%20SA2.xlsx">again</a>
    <a href="javascript:void(0)">x.xlsx</a>
    <a href="mailto:a@b.c?subject=x.csv">mail</a>`;

  it('resolves relative links, drops duplicates, and refuses anything that is not a web file', () => {
    const links = projectionFileLinks(page, 'https://www.planning.nsw.gov.au/research-and-demography/population-projections');
    expect(links.map((l) => l.url)).toEqual([
      'https://www.planning.nsw.gov.au/sites/default/files/2024-05/NSW%20Population%20Projections%20by%20SA2.xlsx',
      'https://example.nsw.gov.au/data/lga-projections.csv',
    ]);
    expect(links[0]).toMatchObject({ format: 'XLSX', projection: true });
    expect(links[0].grainWords).toContain('sa2');
    expect(links[1].grainWords).toContain('lga');
  });

  it('puts the finest grain first', () => {
    const links = projectionFileLinks(page, 'https://www.planning.nsw.gov.au/p');
    expect(rankProjectionLinks([...links].reverse())[0].format).toBe('XLSX');
  });
});

describe('the probe writes nothing, describes a file without downloading an archive, and fails only on our reader', () => {
  const probe = readFileSync('scripts/market/state-projection-liveness.ts', 'utf8');
  const module = readFileSync('supabase/functions/_shared/reports/market/openData/stateProjectionPublishers.pure.ts', 'utf8');

  it('names no table, no client and no credential', () => {
    for (const [name, src] of [['probe', probe], ['module', module]] as const) {
      expect(src, name).not.toMatch(/createClient|SERVICE_ROLE|SUPABASE_URL|\.from\(\s*['"]/);
      expect(src, name).not.toMatch(/\b(?:insert|upsert|delete)\s*\(/);
    }
  });

  it('constructs no evidence, so nothing it finds can reach the scorer', () => {
    for (const asserted of [/\bnew\s+EvidencePoint\b/, /:\s*EvidencePoint\b/, /\bimport\b[^;]*\bEvidencePoint\b/]) {
      expect(module, String(asserted)).not.toMatch(asserted);
      expect(probe, String(asserted)).not.toMatch(asserted);
    }
  });

  it('caps a description, and exits 1 on exactly one path', () => {
    expect(DESCRIBE_MAX_BYTES).toBeLessThanOrEqual(50_000_000);
    expect(probe.match(/process\.exit\(1\)/g) ?? []).toHaveLength(1);
    expect(probe).toMatch(/function ours\(/);
  });
});


/*
 * ── The second pass: what the first run's own output showed ──────────────
 *
 * Every title and URL below is one the 23 Sep 2026 CI run printed.
 */
describe('a candidate is a POPULATION projection by its own title', () => {
  it('accepts the titles the publishers use', () => {
    for (const t of [
      '2022 NSW Population Projections',
      'VIF2023 LGA Population Household Dwelling Projections to 2036',
      'Queensland Government population projections: Regions',
      'Projected population, by five–year age group and sex, Queensland and regions',
      'Population Projections for SA',
      'WA Tomorrow Report 12 - SA2 Forecasts (DPLH-111)',
      'ACT Population Projections by District (2015 - 2041)',
      'NT Population Projections',
    ]) expect(POPULATION_PROJECTION_TITLE.test(t), t).toBe(true);
  });

  /* The first run ranked a map projection for NSW and a CPI forecast for Victoria. */
  it('refuses what the first run described by mistake', () => {
    for (const t of [
      'Habitat Models for the Northern Comprehensive Regional Assessment (CRA) 1999',
      'State Budget 2016-17 - Growth in Consumer Price Index',
      'Historical LGA Population density & gaming expenditure statistics',
      'Public and Affordable Housing Demand',
      'Workforce Forecasts',
      'Population Density, Australia 2011 (ABS)',
    ]) expect(POPULATION_PROJECTION_TITLE.test(t), t).toBe(false);
    // An electoral commission's projection of enrolled voters is not the population.
    expect(isOwnPopulationProjection(ds({
      id: 'e', title: 'Projected Enrolled Population by Statistical Area Level 1 (SA1)', organisation: 'Electoral Commission',
    }), 'NT', 'own')).toBe(false);
  });
});

describe('an own catalogue can list another jurisdiction’s dataset', () => {
  it('names a jurisdiction by full name, or by its abbreviation as a whole word', () => {
    expect(jurisdictionsNamedIn('2022 NSW Population Projections')).toEqual(['NSW']);
    expect(jurisdictionsNamedIn('Population Projections for SA')).toEqual(['SA']);
    expect(jurisdictionsNamedIn('WA Tomorrow Report 12 - SA2 Forecasts (DPLH-111)')).toEqual(['WA']);
    // A digit is a word character, so SA2 is not South Australia.
    expect(jurisdictionsNamedIn('SA2 Forecasts')).toEqual([]);
    // A Perth suburb is not the state of Victoria, and an Act is not the Territory.
    expect(jurisdictionsNamedIn('Town of Victoria Park population forecast')).toEqual([]);
    expect(jurisdictionsNamedIn('Areas permitted to clear vegetation under the Planning Act')).toEqual([]);
  });

  /* Measured: South Australia's catalogue listed New South Wales' 2022 projections first. */
  it('sets aside another jurisdiction’s dataset, and a council’s, whichever catalogue listed it', () => {
    const nswInSa = ds({ id: 'n', title: '2022 NSW Population Projections', organisation: 'NSW Department of Planning, Housing and Infrastructure' });
    const tfnsw = ds({ id: 't', title: 'Population Projections', organisation: 'Transport for NSW' });
    const sa = ds({ id: 's', title: 'Population Projections for SA', organisation: 'Department for Housing and Urban Development' });
    const council = ds({ id: 'c', title: 'City of Melbourne Population Forecasts by Small Area 2023-2043', organisation: 'City of Melbourne' });
    expect(ownCatalogueDataset(nswInSa, 'SA')).toBe(false);
    expect(ownCatalogueDataset(tfnsw, 'SA')).toBe(false);
    expect(ownCatalogueDataset(sa, 'SA')).toBe(true);
    expect(ownCatalogueDataset(nswInSa, 'NSW')).toBe(true);
    expect(ownCatalogueDataset(council, 'VIC')).toBe(false);
  });
});

describe('the publisher the register names comes first', () => {
  it('matches a publisher without the words that say whose it is', () => {
    expect(normalisePublisher('the Victorian Department of Transport and Planning')).toBe('department of transport and planning');
    expect(normalisePublisher('Department of Transport and Planning')).toBe('department of transport and planning');
    expect(normalisePublisher('the Queensland Government Statistician’s Office')).toBe('government statisticians office');
  });

  it('puts the planning department’s projection above a transport agency’s', () => {
    const tfnsw = ds({ id: 't', title: 'Population Projections', organisation: 'Transport for NSW', metadataModified: '2026-01-01' });
    const dphi = ds({ id: 'd', title: '2022 NSW Population Projections', organisation: 'NSW Department of Planning, Housing and Infrastructure', metadataModified: '2025-01-01' });
    const ranked = rankOwnProjections([tfnsw, dphi, dphi], FORWARD_DEMAND_PUBLISHERS.NSW?.publisher ?? null);
    expect(ranked.map((j) => j.dataset.id)).toEqual(['d', 't']);
  });
});

describe('a dataset is not a file: its files are ranked by the grain their own names state', () => {
  const nsw = ds({
    id: 'nsw2022',
    title: '2022 NSW Population Projections',
    resources: [
      { id: '1', name: 'Projections summary', format: 'PDF', url: 'https://datasets.seed.nsw.gov.au/x/summary.pdf', datastoreActive: false, size: null },
      { id: '2', name: 'NSW', format: 'XLSX', url: 'https://datasets.seed.nsw.gov.au/x/2022-nsw-population-and-dwelling-projections-1971-2061_nsw.xlsx', datastoreActive: false, size: null },
      { id: '3', name: 'LGA', format: 'XLSX', url: 'https://datasets.seed.nsw.gov.au/x/2022-nsw-population-projections_lga.xlsx', datastoreActive: false, size: null },
      { id: '4', name: 'SA2', format: 'XLSX', url: 'https://datasets.seed.nsw.gov.au/x/2022-nsw-population-projections_sa2.xlsx', datastoreActive: false, size: null },
    ],
  });

  it('reads the grain from the resource’s name or its file name', () => {
    expect(resourceGrain(nsw.resources[3])).toBe('sa2');
    expect(resourceGrain(nsw.resources[2])).toBe('lga');
    expect(resourceGrain(nsw.resources[1])).toBe('state');
    expect(resourceGrain({ name: 'Download', url: 'https://x/population-projections-for-south-australian-statistical-areas-level-2_-2.._.xlsx' })).toBe('sa2');
  });

  it('offers the SA2 file first and never a document', () => {
    const ranked = rankProjectionResources(nsw);
    expect(ranked.map((r) => r.resource.id)).toEqual(['4', '3', '2']);
    expect(ranked.some((r) => r.resource.format === 'PDF')).toBe(false);
  });
});

describe('a product page is walked one level down, on its own host', () => {
  const page = 'https://www.qgso.qld.gov.au/statistics/theme/population/population-projections';
  const html = `
    <a href="/statistics/theme/population/population-projections/regions">Regions</a>
    <a href="/statistics/theme/population/population-projections/state">Projected population, Queensland</a>
    <a href="https://www.example.com/population-projections">Elsewhere</a>
    <a href="/statistics/theme/economy">Economy</a>
    <a href="/documents/projections.xlsx">Workbook</a>
    <a href="mailto:x@example.com">Population enquiries</a>
    <a href="#population">Skip</a>`;

  it('follows same-host pages named for projections or population, and nothing else', () => {
    expect(projectionSubPages(html, page)).toEqual([
      'https://www.qgso.qld.gov.au/statistics/theme/population/population-projections/regions',
      'https://www.qgso.qld.gov.au/statistics/theme/population/population-projections/state',
    ]);
  });

  it('is bounded', () => {
    expect(projectionSubPages(html, page, 1)).toHaveLength(1);
  });
});
