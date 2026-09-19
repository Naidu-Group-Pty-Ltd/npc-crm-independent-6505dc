/**
 * The site half's parcel rules, pinned where the measurements put them.
 *
 * Fixture bodies mirror the live probe of 18 September 2026
 * (docs/reports/evidence/PARCEL_PROBE_2026-09-18.json): QLD cadastre layer 4
 * answered lot 3SP239114 with one 9-vertex ring at the Pallas coordinate;
 * NSW's layer 9 answered fast with NO lot at the stored NSW coordinate; and
 * two geocodes of one address resolved two DIFFERENT lots — which is why a
 * coordinate yields a candidate, never an identity.
 */

import { describe, expect, it } from 'vitest';
import {
  PARCEL_CANDIDATE_CAVEAT,
  PARCEL_GEOMETRY_VERSION,
  assessSiteSweep,
  buildNswParcelQuery,
  buildParcelIdentify,
  buildQldParcelQuery,
  parseNswParcel,
  parseQldParcel,
  resolveParcelCandidate,
  type SiteSweepVerdict,
} from '../../../../supabase/functions/_shared/reports/risk/parcelGeometry.pure.ts';
import {
  CONVERSIONS,
  type RiskEvidenceReading,
} from '../../../../supabase/functions/_shared/reports/risk/riskEvidenceConnection.pure.ts';

const RING: [number, number][] = [
  [152.70164, -25.54051], [152.70168, -25.54047], [152.70176, -25.54043],
  [152.70184, -25.54049], [152.70180, -25.54058], [152.70172, -25.54062],
  [152.70166, -25.54059], [152.70163, -25.54055], [152.70164, -25.54051],
];

const QLD_BODY = {
  features: [{
    attributes: { lot: '3', plan: 'SP239114', lotplan: '3SP239114', tenure: 'Freehold', lot_area: 728, locality: 'MARYBOROUGH' },
    geometry: { rings: [RING] },
  }],
};

const reading = (over: Partial<RiskEvidenceReading> = {}): RiskEvidenceReading => ({
  register: 'Queensland FloodCheck — Rapid Hazard Assessment',
  jurisdiction: 'QLD',
  licence: 'CC BY 4.0',
  outcome: 'answered_no_intersection',
  families: ['flood'],
  findings: [],
  retrievedAt: '2026-09-18T00:00:00.000Z',
  ...over,
});

describe('parcel identity is a CANDIDATE, never an assertion', () => {
  it('parses the measured QLD feature into a candidate with its caveat', () => {
    const r = parseQldParcel(QLD_BODY);
    expect(r.kind).toBe('resolved_candidate');
    if (r.kind !== 'resolved_candidate') return;
    expect(r.parcel.lotPlan).toBe('3SP239114');
    expect(r.parcel.geometry.rings[0]).toHaveLength(9);
    expect(r.parcel.areaM2).toBe(728);
    expect(r.caveat).toBe(PARCEL_CANDIDATE_CAVEAT);
    // The caveat records the measurement that forced the rule.
    expect(r.caveat).toContain('two geocodes of one address resolved two different lots');
  });

  it('reads no lot at the point as a fact about the COORDINATE', () => {
    const r = parseNswParcel({ features: [] });
    expect(r.kind).toBe('no_lot_at_point');
    if (r.kind !== 'no_lot_at_point') return;
    expect(r.statement).toContain('fact about the coordinate');
    expect(r.statement.toLowerCase()).not.toContain('clear');
  });

  it('reads a service error as unavailable, never as an empty cadastre', () => {
    expect(parseQldParcel({ error: { message: 'Service overloaded' } }).kind).toBe('unavailable');
    expect(parseQldParcel(null).kind).toBe('unavailable');
    expect(parseQldParcel({ features: [{ attributes: { lotplan: 'X' } }] }).kind).toBe('unavailable');
  });

  it('names the jurisdictions it cannot resolve rather than guessing', () => {
    const r = resolveParcelCandidate('VIC', QLD_BODY);
    expect(r.kind).toBe('unavailable');
    if (r.kind !== 'unavailable') return;
    expect(r.detail).toContain('VIC');
    expect(r.detail).toContain('point grain');
  });

  it('pins the measured endpoints', () => {
    expect(buildQldParcelQuery(152.7017, -25.5406))
      .toContain('LandParcelPropertyFramework/MapServer/4/query');
    expect(buildNswParcelQuery(150.9586199, -33.7115485))
      .toContain('NSW_Cadastre/MapServer/9/query');
    for (const url of [buildQldParcelQuery(1, 2), buildNswParcelQuery(1, 2)]) {
      expect(url).toContain('esriGeometryPoint');
      expect(url).toContain('returnGeometry=true');
    }
  });
});

describe('a register asked with the parcel polygon', () => {
  it('builds the measured POST shape, never a polygon in a URL', () => {
    const parcel = { rings: [RING] as const };
    const req = buildParcelIdentify('https://example.invalid/MapServer', parcel, [0]);
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://example.invalid/MapServer/identify');
    expect(req.contentType).toBe('application/x-www-form-urlencoded');
    const params = new URLSearchParams(req.body);
    expect(params.get('geometryType')).toBe('esriGeometryPolygon');
    expect(params.get('tolerance')).toBe('0');
    expect(params.get('layers')).toBe('all:0');
    const geom = JSON.parse(params.get('geometry')!);
    expect(geom.rings[0]).toHaveLength(9);
  });
});

describe('positive, completed negative, incomplete — never collapsed', () => {
  it('a positive is valid at either grain', () => {
    for (const basis of ['point', 'parcel'] as const) {
      const r = assessSiteSweep([reading({
        outcome: 'answered_with_intersection',
        findings: [{ family: 'flood', kind: 'hazard', label: 'Lower Mary River' }],
      })], basis);
      expect(r.verdict).toBe('constraint_intersects');
    }
  });

  it('a completed negative exists only at parcel grain over a complete sweep', () => {
    const complete = [reading(), reading({ register: 'Queensland MSES' })];
    expect(assessSiteSweep(complete, 'parcel').verdict).toBe('completed_negative_at_parcel');
    const atPoint = assessSiteSweep(complete, 'point');
    expect(atPoint.verdict).toBe('negative_at_point_only');
    expect(atPoint.statement).toContain('not clearance');
  });

  it('a partial sweep is incomplete whatever any single register answered', () => {
    const partial = [reading(), reading({ register: 'Queensland MSES', outcome: 'request_failed' })];
    for (const basis of ['point', 'parcel'] as const) {
      const r = assessSiteSweep(partial, basis);
      expect(r.verdict).toBe('incomplete');
      expect(r.statement).toContain('Queensland MSES');
    }
  });

  it('nothing acquired establishes nothing in either direction', () => {
    expect(assessSiteSweep([reading({ outcome: 'not_run', retrievedAt: null })], 'parcel').verdict)
      .toBe('incomplete');
    expect(assessSiteSweep([], 'parcel').verdict).toBe('incomplete');
  });

  it('even a completed parcel negative is a statement about the registers consulted', () => {
    const r = assessSiteSweep([reading()], 'parcel');
    expect(r.statement).toContain('registers consulted');
    expect(r.statement).toContain('never about hazards no register maps');
  });

  it('carries the coverage whole, so nothing is inferred from the verdict', () => {
    const r = assessSiteSweep([reading(), reading({ register: 'X', outcome: 'not_served' })], 'parcel');
    expect(r.coverage.consulted).toBe(2);
    expect(r.coverage.notServed).toBe(1);
    expect(r.version).toBe(PARCEL_GEOMETRY_VERSION);
  });
});

describe('nothing here scores', () => {
  it('the conversion table stays frozen empty', () => {
    expect(Object.keys(CONVERSIONS)).toHaveLength(0);
    expect(Object.isFrozen(CONVERSIONS)).toBe(true);
  });

  it('the verdict vocabulary shares no value with a scoring or determination outcome', () => {
    const verdicts: SiteSweepVerdict[] = [
      'constraint_intersects', 'completed_negative_at_parcel', 'negative_at_point_only', 'incomplete',
    ];
    for (const v of verdicts) {
      expect(['clear', 'no_match', 'not_required', 'approved', 'pass', 'safe']).not.toContain(v);
    }
  });

  it('no export of the module returns a number for a sweep', () => {
    const r = assessSiteSweep([reading()], 'parcel');
    expect(Object.values(r).every((v) => typeof v !== 'number')).toBe(true);
  });
});
