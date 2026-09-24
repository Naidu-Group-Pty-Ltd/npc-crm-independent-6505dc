/**
 * Finding SA's, WA's and the NT's zone layer, and shaping the one question
 * that verifies a parser against it.
 *
 * These pin discovery rules. The measurement is the CI probe's output; the
 * parsers that follow are pinned against what it printed.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  UNREAD_ZONE_JURISDICTIONS,
  ZONE_CATALOGUES,
  ZONE_PROBE_POINTS,
  arcgisServiceRootOf,
  buildZonePointQuery,
  isZoneLayerName,
  judgeZoneDataset,
  rankZoneDatasets,
  readLayerDescription,
  readPointAnswer,
  readServiceLayers,
  directoryEntry,
  rankZoneServices,
  webmapDataUrl,
  webmapIdOf,
  webmapServiceRoots,
  zoneServiceScore,
} from '../../../../supabase/functions/_shared/planning/zoneLayerDiscovery.pure';
import { assessAuPoint } from '../../../../supabase/functions/_shared/auGeoSanity.pure';
import type { VolumeDataset } from '../../../../supabase/functions/_shared/reports/market/openData/salesVolumePublishers.pure';

const ds = (title: string, urls: string[] = [], notes: string | null = null): VolumeDataset => ({
  id: title, name: title, title, notes, organisation: null, licence: null, metadataModified: null,
  resources: urls.map((url) => ({ id: url, name: url, format: 'ESRI REST', url, datastoreActive: false, size: null })),
});

describe('which jurisdictions, and where they are asked', () => {
  it('is the three whose zone is not read', () => {
    expect([...UNREAD_ZONE_JURISDICTIONS]).toEqual(['SA', 'WA', 'NT']);
  });

  it('records which catalogue roots CI has measured answering', () => {
    expect(ZONE_CATALOGUES.WA.measured).toBe(true);
    expect(ZONE_CATALOGUES.NT.measured).toBe(true);
    expect(ZONE_CATALOGUES.SA.measured).toBe(false);
    for (const j of UNREAD_ZONE_JURISDICTIONS) expect(ZONE_CATALOGUES[j].root).toMatch(/^https:\/\/[^?]+\/api\/3$/);
  });

  it('asks at public places that really are inside each jurisdiction', () => {
    // The same land mask and state boxes every coordinate in the product is judged by.
    for (const j of UNREAD_ZONE_JURISDICTIONS) {
      expect(ZONE_PROBE_POINTS[j].length).toBeGreaterThanOrEqual(2);
      for (const p of ZONE_PROBE_POINTS[j]) {
        expect(assessAuPoint(p.lat, p.lng, j), `${j} ${p.place}`).toEqual({ ok: true });
      }
    }
  });
});

describe('a service root is read off a resource URL, never typed', () => {
  it('strips a layer id or an operation so the SERVICE is asked for its layers', () => {
    expect(arcgisServiceRootOf('https://dpti.geohub.sa.gov.au/server/rest/services/PlanSA/Zones/MapServer/3/query?where=1'))
      .toBe('https://dpti.geohub.sa.gov.au/server/rest/services/PlanSA/Zones/MapServer');
    expect(arcgisServiceRootOf('https://services1.arcgis.com/abc/arcgis/rest/services/NT_Zones/FeatureServer'))
      .toBe('https://services1.arcgis.com/abc/arcgis/rest/services/NT_Zones/FeatureServer');
    expect(arcgisServiceRootOf('http://host/arcgis/rest/services/A/B/MapServer/'))
      .toBe('https://host/arcgis/rest/services/A/B/MapServer');
  });

  it('refuses what is not a service', () => {
    expect(arcgisServiceRootOf('https://data.sa.gov.au/dataset/x/resource/y.zip')).toBeNull();
    expect(arcgisServiceRootOf('https://host/arcgis/rest/services')).toBeNull();
    expect(arcgisServiceRootOf('not a url')).toBeNull();
    expect(arcgisServiceRootOf('ftp://host/arcgis/rest/services/A/MapServer')).toBeNull();
  });
});

describe('a zone dataset is judged on its own words', () => {
  it('needs both a zone and a planning word — a road "zone" is not a planning zone', () => {
    expect(judgeZoneDataset(ds('Planning and Design Code — Zones')).zone).toBe(true);
    expect(judgeZoneDataset(ds('Local Planning Scheme Zones and Reserves')).zone).toBe(true);
    expect(judgeZoneDataset(ds('School zones speed limits')).zone).toBe(false);
    expect(judgeZoneDataset(ds('Planning applications register')).zone).toBe(false);
  });

  it('carries the services it is served from, and ranks a queryable one first', () => {
    const ranked = rankZoneDatasets([
      ds('Planning scheme zones (shapefile)'),
      ds('Planning scheme zones', ['https://h/arcgis/rest/services/P/Zones/MapServer/1']),
    ]);
    expect(ranked[0].services).toEqual(['https://h/arcgis/rest/services/P/Zones/MapServer']);
    expect(ranked).toHaveLength(2);
  });
});

describe('a layer is the zone itself, not a neighbour of it', () => {
  it('accepts zone layers', () => {
    for (const n of ['Zones', 'Planning Scheme Zones', 'LPS_Zones_and_Reserves', 'Zoning', 'Land Use Zones']) {
      expect(isZoneLayerName(n), n).toBe(true);
    }
  });

  it('refuses overlays, precincts, labels, boundaries and subzones', () => {
    for (const n of ['Zone Labels', 'Overlay zones', 'Precinct zones', 'Zone boundaries', 'Subzones', 'Policy Areas']) {
      expect(isZoneLayerName(n), n).toBe(false);
    }
  });
});

describe('the answers are read as the publisher sent them', () => {
  it('reads a service’s layers with their ids — names alone cannot be asked', () => {
    expect(readServiceLayers(JSON.stringify({ layers: [{ id: 3, name: 'Zones', geometryType: 'esriGeometryPolygon' }, { name: 'no id' }] })))
      .toEqual([{ id: 3, name: 'Zones', geometryType: 'esriGeometryPolygon' }]);
    expect(readServiceLayers('<html>')).toBeNull();
    expect(readServiceLayers('{"folders":[]}')).toBeNull();
  });

  it('reads a layer’s fields and its own statement of terms, verbatim', () => {
    const d = readLayerDescription(JSON.stringify({
      name: 'Zones', geometryType: 'esriGeometryPolygon', copyrightText: 'CC BY 4.0 — Government of South Australia',
      fields: [{ name: 'ZONE_NAME', alias: 'Zone', type: 'esriFieldTypeString' }, { alias: 'no name' }],
    }));
    expect(d?.fields).toEqual([{ name: 'ZONE_NAME', alias: 'Zone', type: 'esriFieldTypeString' }]);
    expect(d?.copyrightText).toBe('CC BY 4.0 — Government of South Australia');
    expect(readLayerDescription('{"error":{"code":499}}')).toBeNull();
  });

  it('reads an ArcGIS error inside a 200 as an error, before anything else', () => {
    expect(readPointAnswer('{"error":{"code":400,"message":"Invalid query"}}')).toEqual({ kind: 'error', message: 'ArcGIS error 400: Invalid query' });
    expect(readPointAnswer('{"features":[]}')).toEqual({ kind: 'none_at_point' });
    expect(readPointAnswer('{"features":[{"attributes":{"ZONE":"Capital City"}}]}'))
      .toEqual({ kind: 'features', attributes: [{ ZONE: 'Capital City' }] });
    expect(readPointAnswer('Just a moment...').kind).toBe('error');
  });

  it('asks the point question in the shape the ACT query already runs in production', () => {
    const url = new URL(buildZonePointQuery('https://h/arcgis/rest/services/P/Zones/MapServer/3/', 138.6007, -34.9285));
    expect(url.pathname).toBe('/arcgis/rest/services/P/Zones/MapServer/3/query');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      geometry: '138.6007,-34.9285',
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'false',
      f: 'json',
    });
  });
});

describe('the probe writes nothing and types no layer', () => {
  const probe = readFileSync('scripts/market/planning-zone-liveness.ts', 'utf8');
  const module = readFileSync('supabase/functions/_shared/planning/zoneLayerDiscovery.pure.ts', 'utf8');

  it('names no table, no client and no credential', () => {
    for (const [name, src] of [['probe', probe], ['module', module]] as const) {
      expect(src, name).not.toMatch(/createClient|SERVICE_ROLE|SUPABASE_URL|\.from\(\s*['"]/);
      expect(src, name).not.toMatch(/\b(?:insert|upsert|delete)\s*\(/);
    }
  });

  it('types no service, folder or layer id — they come from the publisher', () => {
    expect(probe).not.toMatch(/\/(?:MapServer|FeatureServer)\/\d+/);
    expect(module).not.toMatch(/https:\/\/[^'"\s]+\/(?:MapServer|FeatureServer)/);
  });

  it('exits 1 on exactly one path', () => {
    expect(probe.match(/process\.exit\(1\)/g) ?? []).toHaveLength(1);
  });
});


/*
 * ── The second pass: which of a directory's services to ask ───────────────
 *
 * The first CI run (23 Sep 2026) asked South Australia's directory's first
 * twelve matching services; seven were print tools, and the two "zone"
 * layers were a transport permit zone and a canopy priority zone. Every
 * service name below is one that run printed.
 */
describe('a service is ranked for the question before it is asked', () => {
  const printed = [
    'Historical_Site_Plan_2_png (MapServer)',
    'Hosted/AdelaideHillsZone_20240422 (FeatureServer)',
    'Hosted/DIT_Priority_Zoning (FeatureServer)',
    'Hosted/Planning_Regions_2022 (FeatureServer)',
    'PlanSA/CodeAmendments_Print (GPServer)',
    'PlanSA/CodeAmendments_PrintMap (GPServer)',
    'PlanSA/ExportWebMap_CodeAmendments (GPServer)',
    'PlanSA/Dwellings_Built_1991_to_2021_map_image (MapServer)',
    'TransportAnalytics/Permit_Zones (MapServer)',
  ].map((x) => directoryEntry(x)!);

  it('reads a directory entry as the path and the type', () => {
    expect(directoryEntry('PlanSA/CodeAmendments_Print (GPServer)')).toEqual({ path: 'PlanSA/CodeAmendments_Print', type: 'GPServer' });
    expect(directoryEntry('no type here')).toBeNull();
  });

  it('never asks a tool a point question, and pushes down other kinds of zone', () => {
    const ranked = rankZoneServices(printed).map((x) => x.path);
    expect(ranked).not.toContain('PlanSA/CodeAmendments_Print');
    expect(ranked).not.toContain('PlanSA/ExportWebMap_CodeAmendments');
    expect(ranked).not.toContain('TransportAnalytics/Permit_Zones');
    expect(ranked).not.toContain('Hosted/DIT_Priority_Zoning');
    expect(ranked).not.toContain('Historical_Site_Plan_2_png');
    expect(zoneServiceScore({ path: 'PlanSA/Anything', type: 'GPServer' })).toBe(-Infinity);
  });

  it('puts the planning code’s own vocabulary first', () => {
    const withCode = [...printed, { path: 'PlanSA/PDC_Zones', type: 'MapServer' }, { path: 'SAPPA/Layers', type: 'MapServer' }];
    const ranked = rankZoneServices(withCode).map((x) => x.path);
    expect(ranked[0]).toBe('PlanSA/PDC_Zones');
    expect(ranked).toContain('SAPPA/Layers');
  });
});

describe('a map viewer names its service inside the web map it opens', () => {
  it('reads a web map id from the ways a viewer link carries one, and nothing else', () => {
    const id = '0123456789abcdef0123456789ABCDEF';
    expect(webmapIdOf(`https://www.arcgis.com/home/webmap/viewer.html?webmap=${id}`)).toBe(id.toLowerCase());
    expect(webmapIdOf(`https://sa.maps.arcgis.com/apps/mapviewer/index.html?id=${id}`)).toBe(id.toLowerCase());
    expect(webmapIdOf('https://location.sa.gov.au/viewer/?map=planning')).toBeNull();
    expect(webmapIdOf('not a url')).toBeNull();
    expect(webmapDataUrl('abc')).toBe('https://www.arcgis.com/sharing/rest/content/items/abc/data?f=json');
  });

  it('collects every service the operational layers name, nested ones included', () => {
    const data = JSON.stringify({
      operationalLayers: [
        { url: 'https://example.sa.gov.au/server/rest/services/PlanSA/Zones/MapServer/3' },
        { layers: [{ url: 'https://example.sa.gov.au/server/rest/services/PlanSA/Overlays/MapServer' }] },
        { url: 'https://tiles.example.com/not/a/service' },
      ],
    });
    expect(webmapServiceRoots(data)).toEqual([
      'https://example.sa.gov.au/server/rest/services/PlanSA/Zones/MapServer',
      'https://example.sa.gov.au/server/rest/services/PlanSA/Overlays/MapServer',
    ]);
    expect(webmapServiceRoots('not json')).toEqual([]);
  });
});
