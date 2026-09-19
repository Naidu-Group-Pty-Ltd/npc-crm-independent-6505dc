import { describe, expect, it } from 'vitest';

import {
  isAdmissible,
  LOCATION_PROVENANCE_MATRIX,
  provenanceSummary,
} from '@/lib/reports/location/locationProvenanceMatrix.pure';
import {
  COVERAGE_GAPS,
  jurisdictionIsCovered,
  LOADED_FEEDS,
  transportAvailability,
} from '@/lib/reports/location/transportCoverageMatrix.pure';

/** ME-5.1 items 9, 11 and 12. */
describe('location provenance matrix', () => {
  it('covers every family the brief names', () => {
    const families = new Set(LOCATION_PROVENANCE_MATRIX.map((r) => r.family));
    for (const f of [
      'coordinates', 'transport', 'walkability', 'commute', 'schools',
      'amenities', 'health', 'employment', 'composite',
    ]) {
      expect(families).toContain(f);
    }
  });

  it('admits only genuine measured evidence into V2', () => {
    for (const row of LOCATION_PROVENANCE_MATRIX) {
      expect(row.admissibleToV2).toBe(row.klass === 'genuine_measured');
    }
  });

  it('admits nothing from the legacy transport block', () => {
    for (const row of LOCATION_PROVENANCE_MATRIX.filter((r) => r.family === 'transport')) {
      expect(row.admissibleToV2).toBe(false);
    }
    expect(isAdmissible('transport.distanceToStop')).toBe(false);
    expect(isAdmissible('walkScore')).toBe(false);
  });

  it('does not treat a precise number as genuine', () => {
    // 450 on 822 reports; a precise integer on all 1,114. Neither is measured.
    const stop = LOCATION_PROVENANCE_MATRIX.find((r) => r.field === 'transport.distanceToStop');
    const score = LOCATION_PROVENANCE_MATRIX.find((r) => r.field === 'amenities[].score');
    expect(stop?.klass).toBe('state_template_synthetic');
    expect(score?.klass).toBe('fabricated_estimate');
  });

  it('keeps a recoverable field out of V2 until it is re-derived', () => {
    const recoverable = LOCATION_PROVENANCE_MATRIX.filter((r) => r.klass === 'recoverable');
    expect(recoverable.length).toBeGreaterThan(0);
    for (const r of recoverable) expect(r.admissibleToV2).toBe(false);
  });

  it('records that no employment or activity-access field exists at all', () => {
    const employment = LOCATION_PROVENANCE_MATRIX.find((r) => r.family === 'employment');
    expect(employment?.klass).toBe('missing');
    expect(employment?.evidence).toMatch(/eight keys and none is employment/);
  });

  it('gives every row a measurement rather than an opinion', () => {
    for (const r of LOCATION_PROVENANCE_MATRIX) {
      expect(r.evidence.length).toBeGreaterThan(40);
    }
  });

  it('summarises by class', () => {
    const s = provenanceSummary();
    expect(s.genuine_measured).toBe(1);            // the coordinate, for the 867
    expect(s.state_template_synthetic).toBeGreaterThan(10);
    expect(s.fabricated_estimate).toBeGreaterThan(0);
  });
});

describe('national transport coverage', () => {
  it('names the four loaded feeds with jurisdiction and licence', () => {
    expect(LOADED_FEEDS.map((f) => f.feed)).toEqual([
      'nsw_sydney', 'qld_seq', 'nt_darwin', 'nt_alice',
    ]);
    for (const f of LOADED_FEEDS) {
      expect(f.sourceLabel.length).toBeGreaterThan(10);
      expect(f.notEstablished).toContain('route_type / mode');
    }
  });

  it('records that the NSW bundle carries the interstate network', () => {
    expect(LOADED_FEEDS.find((f) => f.feed === 'nsw_sydney')?.carriesInterstateNetwork).toBe(true);
    expect(LOADED_FEEDS.find((f) => f.feed === 'qld_seq')?.carriesInterstateNetwork).toBe(false);
  });

  it('reports transport as UNAVAILABLE, never poor, where no feed is loaded', () => {
    for (const state of ['WA', 'VIC', 'SA', 'TAS', 'ACT']) {
      const t = transportAvailability(state);
      expect(t.available).toBe(false);
      expect(t.statement).toMatch(/limit of the data held and not a finding about the area/);
      expect(t.statement).not.toMatch(/\b(poor|limited service|badly served)\b/i);
    }
  });

  it('reports it as available where a feed is loaded, with what is not established', () => {
    for (const state of ['NSW', 'QLD', 'NT']) {
      const t = transportAvailability(state);
      expect(t.available).toBe(true);
      expect(t.statement).toMatch(/Mode and service frequency are not\s+established/);
    }
  });

  it('never reports coverage for an unknown state', () => {
    expect(jurisdictionIsCovered(null)).toBe(false);
    expect(jurisdictionIsCovered('')).toBe(false);
    expect(jurisdictionIsCovered('Victoria')).toBe(false);
  });

  it('names the gaps in the order they cost the corpus, with a real source', () => {
    expect(COVERAGE_GAPS[0].jurisdiction).toBe('WA');
    expect(COVERAGE_GAPS[0].metroReports).toBe(164);
    expect(COVERAGE_GAPS[1].jurisdiction).toBe('VIC');
    for (const gap of COVERAGE_GAPS) {
      // Official publishers only — no journey-planner scraping.
      expect(gap.candidateSource).not.toMatch(/journey.?planner|scrape/i);
      expect(gap.licence).toMatch(/confirmed before ingest/);
    }
  });
});
