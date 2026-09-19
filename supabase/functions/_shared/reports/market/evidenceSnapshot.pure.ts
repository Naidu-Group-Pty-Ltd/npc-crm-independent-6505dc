/**
 * ME-6 — the immutable evidence snapshot ME-7 backtests against.
 *
 * ## Why a snapshot rather than live calls
 *
 * ME-7 runs the trusted historical corpus, inspects the score distribution and
 * decides whether the methodology needs calibrating. That is only meaningful if
 * re-running it produces the same answer. A provider's suburb median moves
 * every quarter and its API can be re-priced, rate-limited or withdrawn — so a
 * backtest driven by live calls is a measurement whose instrument changes while
 * it is being read, and a "calibration" derived from it cannot be defended a
 * month later.
 *
 * The snapshot is therefore the unit of reproducibility: extract once, seal,
 * and let every subsequent run read the sealed bytes.
 *
 * ## Sealed means sealed
 *
 * A snapshot is `draft` while records are being added and `sealed` afterwards.
 * Sealing computes a content hash over the records in canonical order; any
 * later change to any record changes the hash, so a snapshot cannot be edited
 * and still claim to be the one a result was computed from. The database
 * enforces it too (a trigger refuses UPDATE and DELETE on a sealed snapshot) —
 * belt and braces, because this repo has twice found a rule that existed only
 * in application code and was bypassed by the one caller that mattered.
 *
 * ## What a snapshot must identify, and why each
 *
 * | field | why ME-7 cannot proceed without it |
 * | --- | --- |
 * | provider | two providers' medians are different series |
 * | extractedAt | when we asked |
 * | evidenceAsOf | the newest period the DATA describes — not the same thing |
 * | methodologyVersions | a score is only reproducible against the code that made it |
 * | geographyVersion | which trusted-geography resolution the subjects came from |
 * | licensingStatus | whether a figure may leave a shadow backtest at all |
 *
 * `extractedAt` and `evidenceAsOf` are separate on purpose. The sanctions work
 * settled it: freshness of the load is not currency of the data, and a
 * four-year-old file downloaded today passes every check that reads only the
 * download date.
 *
 * ## Licensing travels with the snapshot
 *
 * A snapshot whose records are `unverified` may be scored and may not be
 * rendered. That is a property of the evidence, not of the reader, so it is
 * recorded once at the header and per record, and {@link snapshotMayReachClientReport}
 * answers the question rather than each call site deciding.
 */

import type { EvidencePoint, EvidenceProvider, LicensingStatus } from './marketEvidence.pure.ts';

export const SNAPSHOT_SCHEMA_VERSION = 'me6.snapshot.1' as const;

export type SnapshotStatus = 'draft' | 'sealed';

/** The methodology code a snapshot's results are only reproducible against. */
export interface MethodologyVersions {
  growthFormula: string;
  evidenceQuality: string;
  scoringEngine: string;
  /** Which trusted-geography resolution produced the subjects. */
  geography: string;
}

/** One measure, for one subject, exactly as the adapter produced it. */
export interface SnapshotRecord {
  /** Stable key: `${state}|${suburb}|${postcode}|${dwellingType}`. */
  subjectKey: string;
  state: string;
  suburb: string;
  postcode: string;
  dwellingType: string;
  /** `medianPrice`, `growth1Year`, … — an `EvidenceKey`. */
  measure: string;
  point: EvidencePoint<unknown>;
  /** Quality findings that travelled with this measure. Never a correction. */
  qualityFindings: ReadonlyArray<{ code: string; severity: string; detail: string }>;
}

export interface EvidenceSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  snapshotId: string;
  status: SnapshotStatus;
  provider: EvidenceProvider;
  /** The provider's own dataset/product, for the audit trail. */
  sourceProduct: string | null;
  /** When we asked the provider. */
  extractedAt: string;
  /** The newest period the DATA describes. Never the extraction date. */
  evidenceAsOf: string | null;
  methodologyVersions: MethodologyVersions;
  /** The most restrictive licensing across every record. */
  licensingStatus: LicensingStatus;
  records: ReadonlyArray<SnapshotRecord>;
  /** Set on seal. Any later edit changes it. */
  contentHash: string | null;
  sealedAt: string | null;
}

/** Licensing, most restrictive first — a snapshot is only as free as its tightest record. */
const RESTRICTIVENESS: Record<LicensingStatus, number> = {
  internal_only: 0,
  unverified: 1,
  licensed_for_client_reports: 2,
  open: 3,
};

/** The tightest licence across the records, defaulting conservatively. */
export function aggregateLicensing(records: ReadonlyArray<SnapshotRecord>): LicensingStatus {
  let worst: LicensingStatus = 'open';
  for (const r of records) {
    const s = (r.point.licensingStatus ?? 'unverified') as LicensingStatus;
    if (RESTRICTIVENESS[s] < RESTRICTIVENESS[worst]) worst = s;
  }
  return records.length === 0 ? 'unverified' : worst;
}

/** May anything in this snapshot be rendered to a client? */
export function snapshotMayReachClientReport(snapshot: EvidenceSnapshot): boolean {
  return snapshot.licensingStatus === 'open'
    || snapshot.licensingStatus === 'licensed_for_client_reports';
}

/** The newest period any record describes. Absent where nothing carries one. */
export function evidenceAsOfFor(records: ReadonlyArray<SnapshotRecord>): string | null {
  let newest: string | null = null;
  let newestT = -Infinity;
  for (const r of records) {
    const asOf = r.point.asOf;
    if (typeof asOf !== 'string') continue;
    const t = Date.parse(asOf);
    if (Number.isFinite(t) && t > newestT) { newestT = t; newest = asOf; }
  }
  return newest;
}

/**
 * Canonical serialisation — the bytes the hash is taken over.
 *
 * Records are sorted by `(subjectKey, measure)` and object keys are emitted in
 * sorted order, so two snapshots holding the same evidence hash identically
 * however the adapter happened to order them. Without that, a re-extraction in
 * a different order would look like different evidence.
 */
export function canonicalise(records: ReadonlyArray<SnapshotRecord>): string {
  const sorted = [...records].sort((a, b) =>
    a.subjectKey === b.subjectKey
      ? a.measure.localeCompare(b.measure)
      : a.subjectKey.localeCompare(b.subjectKey));
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) out[k] = stable(o[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(stable(sorted));
}

/**
 * FNV-1a over the canonical bytes, as 16 hex characters.
 *
 * Deliberately not a crypto hash: this detects accidental drift between a
 * result and the snapshot it claims to come from. It is not an integrity
 * control against a motivated editor, and the doc comment says so rather than
 * letting a reader assume otherwise.
 */
export function contentHashOf(records: ReadonlyArray<SnapshotRecord>): string {
  const s = canonicalise(records);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

export interface SealResult {
  ok: boolean;
  snapshot: EvidenceSnapshot;
  reason?: string;
}

/** Seal a draft. A sealed snapshot is never re-sealed and never edited. */
export function sealSnapshot(snapshot: EvidenceSnapshot, sealedAt: string): SealResult {
  if (snapshot.status === 'sealed') {
    return { ok: false, snapshot, reason: 'Already sealed. A sealed snapshot is never re-sealed.' };
  }
  if (snapshot.records.length === 0) {
    return { ok: false, snapshot, reason: 'Nothing to seal: a snapshot with no records cannot ground a backtest.' };
  }
  return {
    ok: true,
    snapshot: {
      ...snapshot,
      status: 'sealed',
      sealedAt,
      contentHash: contentHashOf(snapshot.records),
      evidenceAsOf: evidenceAsOfFor(snapshot.records),
      licensingStatus: aggregateLicensing(snapshot.records),
    },
  };
}

/** Does this snapshot still hash to what it was sealed as? */
export function verifySnapshot(snapshot: EvidenceSnapshot): { intact: boolean; detail: string } {
  if (snapshot.status !== 'sealed' || !snapshot.contentHash) {
    return { intact: false, detail: 'Not sealed, so there is nothing to verify against.' };
  }
  const actual = contentHashOf(snapshot.records);
  return actual === snapshot.contentHash
    ? { intact: true, detail: `Content hash ${actual} matches the seal.` }
    : {
        intact: false,
        detail: `Sealed as ${snapshot.contentHash} but now hashes to ${actual}. `
          + 'A result computed from this snapshot cannot be reproduced from it.',
      };
}

/** A new empty draft. Never returns null. */
export function newSnapshot(
  snapshotId: string,
  provider: EvidenceProvider,
  extractedAt: string,
  methodologyVersions: MethodologyVersions,
  sourceProduct: string | null = null,
): EvidenceSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotId,
    status: 'draft',
    provider,
    sourceProduct,
    extractedAt,
    evidenceAsOf: null,
    methodologyVersions,
    licensingStatus: 'unverified',
    records: [],
    contentHash: null,
    sealedAt: null,
  };
}
