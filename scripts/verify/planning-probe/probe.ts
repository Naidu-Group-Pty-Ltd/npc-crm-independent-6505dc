/**
 * Run the planning and hazard registers for a named subject and record what
 * each ANSWERED — not what the service is capable of.
 *
 * Every URL comes from `planningConstraints.pure.ts`, so this probe asks the
 * same questions the product asks. Nothing here parses a finding into a score.
 *
 *   deno run --allow-net --allow-write scripts/verify/planning-probe/probe.ts
 */

import {
  buildNswPrincipalIdentify,
  buildNswHazardIdentify,
  buildNswProtectionIdentify,
  buildQldStatePlanningIdentify,
  buildQldFloodIdentify,
  buildQldMsesIdentify,
  NSW_PRINCIPAL_SOURCE,
  NSW_HAZARD_SOURCE,
  NSW_PROTECTION_SOURCE,
  NSW_LICENCE,
  QLD_FLOODCHECK_SOURCE,
  QLD_MSES_SOURCE,
  QLD_STATE_PLANNING_CONTEXT_SOURCE,
  QLD_LICENCE,
} from '../../../supabase/functions/_shared/planning/planningConstraints.pure.ts';

interface Subject {
  readonly label: string;
  readonly reportId: string;
  readonly address: string;
  readonly jurisdiction: 'NSW' | 'QLD';
  readonly lat: number;
  readonly lng: number;
  readonly coordinateBasis: string;
}

/** Coordinates are the verified ones already stored against each report. */
const SUBJECTS: readonly Subject[] = [
  {
    label: 'Annabelle',
    reportId: '9bd41c05-7f9b-41e8-819a-a029f4121369',
    address: '18 Annabelle Crescent, Kellyville NSW 2155',
    jurisdiction: 'NSW',
    lat: -33.7115485,
    lng: 150.9586199,
    coordinateBasis: 'stored location_intelligence coordinate (verified at enrichment)',
  },
  {
    label: 'Pallas',
    reportId: '3a4a3d9b-4d2d-4296-9e39-3fab0c2ae753',
    address: '262 Pallas Street, Maryborough QLD 4650',
    jurisdiction: 'QLD',
    lat: -25.5406,
    lng: 152.7017,
    coordinateBasis: 'geocoded from the stored address for this probe',
  },
];

type Outcome =
  | 'answered_with_intersection'
  | 'answered_no_intersection'
  | 'request_failed'
  | 'service_error'
  | 'unparseable';

interface ProbeRow {
  subject: string;
  reportId: string;
  address: string;
  jurisdiction: string;
  register: string;
  licence: string;
  url: string;
  retrievedAt: string;
  httpStatus: number | null;
  outcome: Outcome;
  resultCount: number;
  layersReturned: string[];
  findings: Array<Record<string, unknown>>;
  note: string;
}

const REGISTERS = {
  NSW: [
    { name: NSW_PRINCIPAL_SOURCE, licence: NSW_LICENCE, build: buildNswPrincipalIdentify },
    { name: NSW_HAZARD_SOURCE, licence: NSW_LICENCE, build: buildNswHazardIdentify },
    { name: NSW_PROTECTION_SOURCE, licence: NSW_LICENCE, build: buildNswProtectionIdentify },
  ],
  QLD: [
    { name: QLD_STATE_PLANNING_CONTEXT_SOURCE, licence: QLD_LICENCE, build: buildQldStatePlanningIdentify },
    { name: QLD_FLOODCHECK_SOURCE, licence: QLD_LICENCE, build: buildQldFloodIdentify },
    { name: QLD_MSES_SOURCE, licence: QLD_LICENCE, build: buildQldMsesIdentify },
  ],
} as const;

async function probe(s: Subject, reg: { name: string; licence: string; build: (lng: number, lat: number) => string }): Promise<ProbeRow> {
  const url = reg.build(s.lng, s.lat);
  const retrievedAt = new Date().toISOString();
  const base: ProbeRow = {
    subject: s.label, reportId: s.reportId, address: s.address, jurisdiction: s.jurisdiction,
    register: reg.name, licence: reg.licence, url, retrievedAt,
    httpStatus: null, outcome: 'request_failed', resultCount: 0, layersReturned: [], findings: [], note: '',
  };
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    return { ...base, outcome: 'request_failed', note: `transport: ${String(e).slice(0, 180)}` };
  }
  const status = res.status;
  let text: string;
  try { text = await res.text(); } catch (e) {
    return { ...base, httpStatus: status, outcome: 'unparseable', note: `body unreadable: ${String(e).slice(0, 120)}` };
  }
  if (!res.ok) return { ...base, httpStatus: status, outcome: 'request_failed', note: `HTTP ${status}` };

  let body: { results?: unknown[]; error?: { message?: string } };
  try { body = JSON.parse(text); } catch {
    return { ...base, httpStatus: status, outcome: 'unparseable', note: `body is not JSON (${text.length} bytes)` };
  }
  if (body.error) {
    return { ...base, httpStatus: status, outcome: 'service_error', note: String(body.error.message ?? 'service error') };
  }
  const results = Array.isArray(body.results) ? body.results : [];
  const layers = [...new Set(results.map((r) => {
    const o = r as { layerId?: number; layerName?: string };
    return `${o.layerId ?? '?'}: ${o.layerName ?? '?'}`;
  }))].sort();
  const findings = results.map((r) => {
    const o = r as { layerId?: number; layerName?: string; value?: string; attributes?: Record<string, unknown> };
    const a = o.attributes ?? {};
    // Carry only the attributes a reading is built from, so the record stays legible.
    const keep: Record<string, unknown> = {};
    for (const k of Object.keys(a)) {
      if (/^(Layer Class|Category|Class|Item Name|Heritage Type|Significance|Units|Maximum Building Height|MAX_B_H_M|Lot Size|Floor Space Ratio|Zone|LGA Name|EPI Name|Legislative Clause|Purpose|.*Date.*)$/i.test(k)) keep[k] = a[k];
    }
    return { layerId: o.layerId, layerName: o.layerName, value: o.value, attributes: keep };
  });
  return {
    ...base,
    httpStatus: status,
    outcome: results.length > 0 ? 'answered_with_intersection' : 'answered_no_intersection',
    resultCount: results.length,
    layersReturned: layers,
    findings,
    note: results.length > 0
      ? 'The register answered and the point falls inside at least one mapped layer.'
      : 'The register answered and the point falls inside no mapped layer of this service. This is a completed query, not a clearance for the parcel.',
  };
}

const rows: ProbeRow[] = [];
for (const s of SUBJECTS) {
  for (const reg of REGISTERS[s.jurisdiction]) {
    const row = await probe(s, reg);
    rows.push(row);
    console.log(
      `${row.subject.padEnd(10)} ${row.register.slice(0, 52).padEnd(54)} ` +
      `HTTP ${String(row.httpStatus ?? '-').padEnd(4)} ${row.outcome.padEnd(26)} results=${row.resultCount}`,
    );
    if (row.note) console.log(`${' '.repeat(12)}${row.note}`);
    for (const l of row.layersReturned) console.log(`${' '.repeat(14)}• ${l}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

const out = {
  probeRunAt: new Date().toISOString(),
  method: 'ArcGIS identify at a single coordinate, tolerance 0 (exact containment at the point)',
  coverageCaveat:
    'A point-in-polygon identify describes the POINT, not the whole parcel. A layer that does not '
  + 'intersect the point may still intersect part of the lot, so "answered, no intersection" is '
  + 'never a clearance for the parcel.',
  subjects: SUBJECTS,
  rows,
};
await Deno.writeTextFile('.verify/out/planning-probe.json', JSON.stringify(out, null, 2));
console.log(`\nWrote .verify/out/planning-probe.json — ${rows.length} register readings`);
