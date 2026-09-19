/**
 * ME-6 — a sealed snapshot is what makes ME-7 reproducible.
 */
import { describe, it, expect } from 'vitest';
import {
  SNAPSHOT_SCHEMA_VERSION,
  aggregateLicensing,
  canonicalise,
  contentHashOf,
  evidenceAsOfFor,
  newSnapshot,
  sealSnapshot,
  snapshotMayReachClientReport,
  verifySnapshot,
  type MethodologyVersions,
  type SnapshotRecord,
} from '../market/evidenceSnapshot.pure';

const VERSIONS: MethodologyVersions = {
  growthFormula: 'me6.growth.1',
  evidenceQuality: 'me6.quality.1',
  scoringEngine: 'v2.shadow',
  geography: 'me5.0',
};

const rec = (
  subjectKey: string,
  measure: string,
  value: number,
  asOf: string,
  licensingStatus?: 'open' | 'unverified' | 'internal_only' | 'licensed_for_client_reports',
): SnapshotRecord => ({
  subjectKey,
  state: 'QLD', suburb: 'Gympie', postcode: '4570', dwellingType: 'house',
  measure,
  point: {
    value, level: 'suburb', areaName: 'Gympie', dwellingType: 'house',
    dwellingTypeMatched: true, provider: 'domain', asOf,
    sampleSize: 42, periodsAvailable: 20, method: 'observed',
    ...(licensingStatus ? { licensingStatus } : {}),
    sourceNote: null,
  },
  qualityFindings: [],
});

const draft = () => newSnapshot('snap-1', 'domain', '2026-09-08T00:00:00Z', VERSIONS, 'suburbPerformanceStatistics');

describe('a snapshot identifies everything ME-7 needs', () => {
  it('carries provider, extraction date, methodology and geography version', () => {
    const s = draft();
    expect(s.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    expect(s.provider).toBe('domain');
    expect(s.extractedAt).toBe('2026-09-08T00:00:00Z');
    expect(s.methodologyVersions.growthFormula).toBe('me6.growth.1');
    expect(s.methodologyVersions.geography).toBe('me5.0');
    expect(s.status).toBe('draft');
  });

  it('keeps extractedAt and evidenceAsOf as different facts', () => {
    const records = [rec('k1', 'medianPrice', 531_000, '2026-06-30'), rec('k1', 'growth1Year', 6.2, '2026-06-30')];
    const sealed = sealSnapshot({ ...draft(), records }, '2026-09-08T01:00:00Z');
    expect(sealed.ok).toBe(true);
    // When we asked, versus the newest period the data describes.
    expect(sealed.snapshot.extractedAt).toBe('2026-09-08T00:00:00Z');
    expect(sealed.snapshot.evidenceAsOf).toBe('2026-06-30');
    expect(sealed.snapshot.evidenceAsOf).not.toBe(sealed.snapshot.extractedAt);
  });

  it('takes evidenceAsOf from the newest record, not the first', () => {
    expect(evidenceAsOfFor([
      rec('k1', 'a', 1, '2024-06-30'),
      rec('k1', 'b', 2, '2026-06-30'),
      rec('k1', 'c', 3, '2025-06-30'),
    ])).toBe('2026-06-30');
  });
});

describe('sealed means sealed', () => {
  const records = [rec('k1', 'medianPrice', 531_000, '2026-06-30')];

  it('refuses to seal an empty snapshot', () => {
    const r = sealSnapshot(draft(), '2026-09-08T01:00:00Z');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cannot ground a backtest/i);
  });

  it('refuses to re-seal', () => {
    const first = sealSnapshot({ ...draft(), records }, '2026-09-08T01:00:00Z');
    const second = sealSnapshot(first.snapshot, '2026-09-08T02:00:00Z');
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/never re-sealed/i);
  });

  it('verifies intact immediately after sealing', () => {
    const s = sealSnapshot({ ...draft(), records }, '2026-09-08T01:00:00Z').snapshot;
    expect(verifySnapshot(s).intact).toBe(true);
  });

  it('detects any edit to any record after sealing', () => {
    const s = sealSnapshot({ ...draft(), records }, '2026-09-08T01:00:00Z').snapshot;
    const tampered = {
      ...s,
      records: [{ ...s.records[0], point: { ...s.records[0].point, value: 999_999 } }],
    };
    const v = verifySnapshot(tampered);
    expect(v.intact).toBe(false);
    expect(v.detail).toMatch(/cannot be reproduced/i);
  });

  it('an unsealed snapshot has nothing to verify against', () => {
    expect(verifySnapshot(draft()).intact).toBe(false);
  });
});

describe('the hash is about content, not ordering', () => {
  it('hashes identically however the adapter ordered the records', () => {
    const a = [rec('k1', 'medianPrice', 1, '2026-06-30'), rec('k2', 'growth1Year', 2, '2026-06-30')];
    const b = [a[1], a[0]];
    expect(contentHashOf(a)).toBe(contentHashOf(b));
    expect(canonicalise(a)).toBe(canonicalise(b));
  });

  it('hashes differently when a value differs', () => {
    expect(contentHashOf([rec('k1', 'm', 1, '2026-06-30')]))
      .not.toBe(contentHashOf([rec('k1', 'm', 2, '2026-06-30')]));
  });

  it('hashes differently when a measure differs', () => {
    expect(contentHashOf([rec('k1', 'medianPrice', 1, '2026-06-30')]))
      .not.toBe(contentHashOf([rec('k1', 'growth1Year', 1, '2026-06-30')]));
  });
});

describe('licensing travels with the snapshot, conservatively', () => {
  it('defaults an unlabelled record to unverified', () => {
    expect(aggregateLicensing([rec('k1', 'm', 1, '2026-06-30')])).toBe('unverified');
  });

  it('takes the MOST restrictive record, not the most permissive', () => {
    expect(aggregateLicensing([
      rec('k1', 'a', 1, '2026-06-30', 'open'),
      rec('k1', 'b', 2, '2026-06-30', 'internal_only'),
    ])).toBe('internal_only');
  });

  it('an empty snapshot is unverified, never open', () => {
    expect(aggregateLicensing([])).toBe('unverified');
  });

  it('unverified evidence may be scored and may not be rendered', () => {
    const s = sealSnapshot({ ...draft(), records: [rec('k1', 'm', 1, '2026-06-30')] }, '2026-09-08T01:00:00Z').snapshot;
    expect(s.licensingStatus).toBe('unverified');
    expect(snapshotMayReachClientReport(s)).toBe(false);
  });

  it('licensed evidence may be rendered', () => {
    const s = sealSnapshot(
      { ...draft(), records: [rec('k1', 'm', 1, '2026-06-30', 'licensed_for_client_reports')] },
      '2026-09-08T01:00:00Z',
    ).snapshot;
    expect(snapshotMayReachClientReport(s)).toBe(true);
  });
});
