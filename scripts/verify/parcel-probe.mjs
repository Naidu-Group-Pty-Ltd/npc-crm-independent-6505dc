#!/usr/bin/env node
/**
 * S5/S6 §3 — the site half's parcel-grain measurements, from this egress.
 *
 * The rule this serves: **an address-point identify describes the POINT, and
 * is never clearance for a parcel.** Moving the sweep to parcel grain needs
 * three facts only a measurement can supply, and this records them:
 *
 *   1. Which layer of Queensland's cadastre answers a lot/plan POLYGON at a
 *      coordinate (the earlier measurement saw `2RP87802` at the Pallas
 *      coordinate; this pins the layer and the field names).
 *   2. Whether a register's identify accepts that polygon as the query
 *      geometry (point vs parcel, same register, same subject, compared).
 *   3. What NSW's cadastre actually does from this egress, with a declared
 *      budget — the earlier attempts answered metadata in 1.2 s and no rows
 *      within 40 s, and an honest status needs a re-measurement, not a memory.
 *
 * Public, open-licensed registers (CC BY); no credential is sent; results in
 * docs/reports/evidence/PARCEL_PROBE_2026-09-18.json via stdout redirection
 * or the --out flag. Read-only everywhere.
 */
import fs from 'node:fs';
import path from 'node:path';

const QLD_BASE = 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services';
const PALLAS = { label: '262 Pallas Street, Maryborough QLD 4650', lng: 152.7017, lat: -25.5406 };
const ANNABELLE = { label: '18 Annabelle Crescent, Kellyville NSW 2155', lng: 150.9586199, lat: -33.7115485 };
const NSW_CADASTRE = 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer';

const out = { probeRunAt: new Date().toISOString(), egress: 'session sandbox (same class as the six-register planning probe)', steps: [] };
const step = (name, detail) => { out.steps.push({ name, ...detail }); console.error(`· ${name}: ${detail.outcome ?? ''}`); };

const timed = async (url, { method = 'GET', body = null, timeoutMs = 20000, headers = {} } = {}) => {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method, body, headers, signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: r.ok, status: r.status, ms: Date.now() - t0, json, textBytes: text.length };
  } catch (e) {
    return { ok: false, status: null, ms: Date.now() - t0, error: String(e).slice(0, 200) };
  }
};

// ── 1. QLD cadastre: which layer holds the lot polygons ────────────────────
const svc = await timed(`${QLD_BASE}/PlanningCadastre/LandParcelPropertyFramework/MapServer?f=json`);
const layers = (svc.json?.layers ?? []).map((l) => ({ id: l.id, name: l.name }));
step('QLD LandParcelPropertyFramework service metadata', {
  outcome: svc.ok ? `HTTP ${svc.status}, ${layers.length} layers, ${svc.ms} ms` : `failed: ${svc.error ?? svc.status}`,
  layers,
});

const candidates = layers.filter((l) => /parcel|lot/i.test(l.name));
let parcel = null;
for (const cand of candidates) {
  const q = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify({ x: PALLAS.lng, y: PALLAS.lat }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
  });
  const r = await timed(`${QLD_BASE}/PlanningCadastre/LandParcelPropertyFramework/MapServer/${cand.id}/query?${q}`);
  const feature = r.json?.features?.[0] ?? null;
  const attrs = feature?.attributes ?? null;
  const rings = feature?.geometry?.rings ?? null;
  step(`QLD cadastre layer ${cand.id} (${cand.name}) query at the Pallas coordinate`, {
    outcome: r.ok && feature
      ? `HTTP ${r.status}, ${r.ms} ms, lot/plan fields present, ${rings?.length ?? 0} ring(s), ${rings?.[0]?.length ?? 0} vertices`
      : r.ok ? `HTTP ${r.status}, ${r.ms} ms, no feature` : `failed: ${r.error ?? r.status}`,
    attributeKeys: attrs ? Object.keys(attrs) : null,
    lotplan: attrs?.lotplan ?? attrs?.LOTPLAN ?? attrs?.lot_plan ?? null,
    lot: attrs?.lot ?? attrs?.LOT ?? null,
    plan: attrs?.plan ?? attrs?.PLAN ?? null,
  });
  if (feature && rings?.length && !parcel) {
    parcel = { layerId: cand.id, layerName: cand.name, attrs, rings };
  }
}

// ── 2. FloodCheck: the same register, point vs parcel ─────────────────────
const d = 0.0005;
const idBase = {
  f: 'json', sr: '4326', layers: 'all:0', tolerance: '0',
  mapExtent: `${PALLAS.lng - d},${PALLAS.lat - d},${PALLAS.lng + d},${PALLAS.lat + d}`,
  imageDisplay: '400,400,96', returnGeometry: 'false',
};
const pointParams = new URLSearchParams({
  ...idBase, geometry: JSON.stringify({ x: PALLAS.lng, y: PALLAS.lat }), geometryType: 'esriGeometryPoint',
});
const flood = `${QLD_BASE}/FloodCheck/RapidHazardAssessment/MapServer/identify`;
const atPoint = await timed(`${flood}?${pointParams}`);
const pointResults = atPoint.json?.results ?? [];
step('FloodCheck identify at the POINT', {
  outcome: atPoint.ok ? `HTTP ${atPoint.status}, ${atPoint.ms} ms, ${pointResults.length} result(s)` : `failed: ${atPoint.error ?? atPoint.status}`,
  labels: pointResults.map((x) => `${x.layerName}: ${x.value}`),
});

if (parcel) {
  const body = new URLSearchParams({
    ...idBase,
    geometry: JSON.stringify({ rings: parcel.rings, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon',
  });
  const atParcel = await timed(flood, {
    method: 'POST', body: body.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    timeoutMs: 30000,
  });
  const parcelResults = atParcel.json?.results ?? [];
  step('FloodCheck identify with the PARCEL polygon (POST)', {
    outcome: atParcel.ok
      ? `HTTP ${atParcel.status}, ${atParcel.ms} ms, ${parcelResults.length} result(s)`
      : `failed: ${atParcel.error ?? atParcel.status}`,
    labels: parcelResults.map((x) => `${x.layerName}: ${x.value}`),
    comparison: atParcel.ok
      ? `point ${pointResults.length} vs parcel ${parcelResults.length} — a parcel sweep can only find MORE, never less`
      : 'not comparable — the parcel request did not complete',
  });
} else {
  step('FloodCheck identify with the PARCEL polygon', { outcome: 'not run — no parcel polygon was recovered' });
}

// ── 3. NSW cadastre, re-measured with a declared budget ───────────────────
const nswMeta = await timed(`${NSW_CADASTRE}/9?f=json`, { timeoutMs: 15000 });
step('NSW_Cadastre/9 (Lot) metadata', {
  outcome: nswMeta.ok ? `HTTP ${nswMeta.status}, ${nswMeta.ms} ms, name=${nswMeta.json?.name ?? '?'}, capabilities=${nswMeta.json?.capabilities ?? '?'}` : `failed: ${nswMeta.error ?? nswMeta.status}`,
});
const nswQ = new URLSearchParams({
  f: 'json',
  geometry: JSON.stringify({ x: ANNABELLE.lng, y: ANNABELLE.lat }),
  geometryType: 'esriGeometryPoint',
  inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
  outFields: 'lotidstring,lotnumber,planlabel', returnGeometry: 'true', outSR: '4326',
});
const nsw = await timed(`${NSW_CADASTRE}/9/query?${nswQ}`, { timeoutMs: 15000 });
const nswFeature = nsw.json?.features?.[0] ?? null;
step('NSW_Cadastre/9 query at the Annabelle coordinate (15 s budget)', {
  outcome: nsw.ok && nswFeature
    ? `HTTP ${nsw.status}, ${nsw.ms} ms, lot ${nswFeature.attributes?.lotidstring ?? '?'}, ${nswFeature.geometry?.rings?.[0]?.length ?? 0} vertices`
    : nsw.ok ? `HTTP ${nsw.status}, ${nsw.ms} ms, no feature` : `did not complete within the budget: ${nsw.error ?? nsw.status}`,
  attributes: nswFeature?.attributes ?? null,
});

const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : null;
const text = JSON.stringify(out, null, 2);
if (OUT) fs.writeFileSync(path.resolve(OUT), text); else console.log(text);
