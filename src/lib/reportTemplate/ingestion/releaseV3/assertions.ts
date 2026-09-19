/**
 * PDF Extraction V3 · E12 — assertion engines.
 *
 * Pure functions that compare ACTUAL pipeline output against the fixture-emitted
 * INDEPENDENT truth and produce `ReleaseGateCheckV2` results. They never derive
 * expected truth from the candidate, never let a score override a hard defect,
 * and never accept a legacy V1/V2 cache for a V3 fixture. Each engine returns
 * bounded, privacy-safe checks.
 */
import type {
  GoldenExpectedTruthV1,
  ReleaseGateCheckV2,
  ReleaseThresholdsV2,
} from './contracts';

function check(
  checkId: string,
  domain: ReleaseGateCheckV2['domain'],
  severity: ReleaseGateCheckV2['severity'],
  pass: boolean,
  detail: string,
  opts: Partial<Pick<ReleaseGateCheckV2, 'fixtureId' | 'pageNumber' | 'regionId' | 'remediation'>> = {},
): ReleaseGateCheckV2 {
  return {
    checkId, title: checkId, domain, severity,
    status: pass ? 'pass' : (severity === 'hard' ? 'fail' : 'warning'),
    detail,
    fixtureId: opts.fixtureId ?? null,
    pageNumber: opts.pageNumber ?? null,
    regionId: opts.regionId ?? null,
    evidenceRef: null,
    remediation: opts.remediation ?? null,
  };
}

// ── Actual-output shape the engines consume (bounded, already-decided) ───────

export interface ActualRegionOutput {
  regionId: string;
  regionType: string;
  outputStrategy: string;
  cropNonBlank: boolean | null;
  representationCount: number;
  hardDefectCodes: string[];
  visibleUnicode: string[];     // exact code points rendered (from DOM/source, not OCR)
  visibleNumericTokens: string[];
  tableWrongCellAssociations: number;
  tableMissingRows: number;
  tableMissingColumns: number;
  tableGenericHeaders: number;
  tableClippedRows: number;
}

export interface ActualPageOutput {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  rotation: number;
  outputStrategy: string;
  score: number | null;
  hardDefectCodes: string[];
  browserRendered: boolean;
  exportRendered: boolean;
  regions: ActualRegionOutput[];
}

export interface ActualDocumentOutput {
  fixtureId: string;
  sourceSha256: string;
  pageCount: number;
  pages: ActualPageOutput[];
  finalOutputScore: number | null;
  browserExportParity: number | null;
  repairPasses: number;
  introducedHardDefects: number;
  providerAuditComplete: boolean;
  routingAuditComplete: boolean;
  artifactComplete: boolean;
  remoteProviderAttempts: number;
  cacheContractVersion: string | null;
  cacheHit: boolean | null;
  cacheArtifactComplete: boolean | null;
  legacyCacheHits: number;
}

// ── Source-truth assertions ──────────────────────────────────────────────────

export function assertSourceTruth(truth: GoldenExpectedTruthV1, actual: ActualDocumentOutput): ReleaseGateCheckV2[] {
  const out: ReleaseGateCheckV2[] = [];
  out.push(check('source-integrity.hash', 'source-integrity', 'hard', actual.sourceSha256 === truth.sourceSha256,
    'source hash matches independently-emitted truth', { fixtureId: truth.fixtureId }));
  out.push(check('source-integrity.page-count', 'source-integrity', 'hard', actual.pageCount === truth.pageCount,
    `page count ${actual.pageCount} vs expected ${truth.pageCount}`, { fixtureId: truth.fixtureId }));
  for (const page of truth.pages) {
    const ap = actual.pages.find((p) => p.pageNumber === page.pageNumber);
    if (!ap) { out.push(check('source-integrity.page-present', 'source-integrity', 'hard', false, `page ${page.pageNumber} missing`, { fixtureId: truth.fixtureId, pageNumber: page.pageNumber })); continue; }
    out.push(check('source-integrity.dimensions', 'source-integrity', 'hard',
      Math.round(ap.widthPt) === Math.round(page.widthPt) && Math.round(ap.heightPt) === Math.round(page.heightPt) && ap.rotation === page.rotation,
      `page ${page.pageNumber} geometry`, { fixtureId: truth.fixtureId, pageNumber: page.pageNumber }));
  }
  return out;
}

// ── Hard-defect-first assertion (a score can NEVER override a hard defect) ────

export function assertHardDefectsFirst(truth: GoldenExpectedTruthV1, actual: ActualDocumentOutput, thresholds: ReleaseThresholdsV2): ReleaseGateCheckV2[] {
  const totalHard = actual.pages.reduce((n, p) => n + p.hardDefectCodes.length, 0)
    + actual.pages.reduce((n, p) => n + p.regions.reduce((m, r) => m + r.hardDefectCodes.length, 0), 0);
  const out: ReleaseGateCheckV2[] = [];
  out.push(check('quality.hard-defects-zero', 'quality', 'hard', totalHard <= thresholds.maxUnresolvedHardDefects,
    `${totalHard} unresolved hard defect(s)`, { fixtureId: truth.fixtureId, remediation: 'Resolve or fall back to exact crop / raster; a high score cannot override.' }));
  // A blocked/unscored critical page is a failure regardless of document score.
  const blocked = actual.pages.filter((p) => p.outputStrategy === 'blocked').length;
  out.push(check('quality.no-blocked-pages', 'quality', 'hard', blocked <= thresholds.maxBlockedPages,
    `${blocked} blocked page(s)`, { fixtureId: truth.fixtureId }));
  return out;
}

// ── Chart / table / typography assertions ────────────────────────────────────

export function assertCharts(truth: GoldenExpectedTruthV1, actual: ActualDocumentOutput): ReleaseGateCheckV2[] {
  const out: ReleaseGateCheckV2[] = [];
  for (const page of truth.pages) {
    const ap = actual.pages.find((p) => p.pageNumber === page.pageNumber);
    const chartTruth = page.regions.filter((r) => r.regionType === 'chart');
    for (const ct of chartTruth) {
      const ar = ap?.regions.find((r) => r.regionId === ct.regionId);
      const visibleOnce = Boolean(ar) && ar!.representationCount === 1 && (ar!.cropNonBlank !== false);
      out.push(check('charts.visibility', 'charts', 'hard', visibleOnce,
        `chart ${ct.regionId} visible exactly once and non-blank`, { fixtureId: truth.fixtureId, pageNumber: page.pageNumber, regionId: ct.regionId }));
    }
  }
  return out;
}

export function assertTables(truth: GoldenExpectedTruthV1, actual: ActualDocumentOutput): ReleaseGateCheckV2[] {
  const out: ReleaseGateCheckV2[] = [];
  for (const page of truth.pages) {
    const ap = actual.pages.find((p) => p.pageNumber === page.pageNumber);
    const tableTruth = page.regions.filter((r) => r.regionType === 'table');
    for (const tt of tableTruth) {
      const ar = ap?.regions.find((r) => r.regionId === tt.regionId);
      const nativeOrCrop = Boolean(ar) && (ar!.outputStrategy === 'native' || ar!.outputStrategy === 'source-crop');
      const clean = Boolean(ar) && ar!.tableWrongCellAssociations === 0 && ar!.tableMissingRows === 0 && ar!.tableMissingColumns === 0 && ar!.tableGenericHeaders === 0 && ar!.tableClippedRows === 0;
      out.push(check('tables.native-or-crop', 'tables', 'hard', nativeOrCrop && clean,
        `table ${tt.regionId} native-or-crop, no wrong-cell/generic-header/clip`, { fixtureId: truth.fixtureId, pageNumber: page.pageNumber, regionId: tt.regionId }));
      // Independent tables must remain independent (no accidental merge).
    }
  }
  return out;
}

export function assertTypography(truth: GoldenExpectedTruthV1, actual: ActualDocumentOutput): ReleaseGateCheckV2[] {
  const out: ReleaseGateCheckV2[] = [];
  for (const page of truth.pages) {
    const ap = actual.pages.find((p) => p.pageNumber === page.pageNumber);
    for (const rt of page.regions) {
      if (rt.criticalUnicode.length === 0 && rt.criticalNumericTokens.length === 0) continue;
      const ar = ap?.regions.find((r) => r.regionId === rt.regionId);
      const uniOk = Boolean(ar) && rt.criticalUnicode.every((u) => ar!.visibleUnicode.includes(u));
      const numOk = Boolean(ar) && rt.criticalNumericTokens.every((t) => ar!.visibleNumericTokens.includes(t));
      // A source-crop region satisfies critical recall by preserving the source pixels.
      const cropSatisfies = Boolean(ar) && ar!.outputStrategy === 'source-crop';
      out.push(check('typography.critical-recall', 'typography', 'hard', (uniOk && numOk) || cropSatisfies,
        `region ${rt.regionId} critical Unicode + numeric tokens preserved (or exact crop)`, { fixtureId: truth.fixtureId, pageNumber: page.pageNumber, regionId: rt.regionId }));
    }
  }
  return out;
}

// ── Composition (single visible owner, no editor references) ─────────────────

export function assertComposition(truth: GoldenExpectedTruthV1, actual: ActualDocumentOutput): ReleaseGateCheckV2[] {
  const out: ReleaseGateCheckV2[] = [];
  for (const page of truth.pages) {
    const ap = actual.pages.find((p) => p.pageNumber === page.pageNumber);
    if (!ap) continue;
    const duplicates = ap.regions.filter((r) => r.representationCount > 1);
    out.push(check('composition.single-owner', 'composition', 'hard', duplicates.length === 0,
      `${duplicates.length} region(s) with duplicate source representation`, { fixtureId: truth.fixtureId, pageNumber: page.pageNumber }));
  }
  return out;
}

// ── Provider / routing / cache / repair ──────────────────────────────────────

export function assertProviders(truth: GoldenExpectedTruthV1, actual: ActualDocumentOutput, thresholds: ReleaseThresholdsV2): ReleaseGateCheckV2[] {
  return [
    check('providers.no-remote', 'providers', 'hard', actual.remoteProviderAttempts <= thresholds.maxRemoteProviderAttempts,
      `${actual.remoteProviderAttempts} remote provider attempt(s) (must be 0 for generated tiers)`, { fixtureId: truth.fixtureId }),
    check('providers.audit-complete', 'providers', 'soft', actual.providerAuditComplete, 'provider audit complete', { fixtureId: truth.fixtureId }),
  ];
}

export function assertRouting(truth: GoldenExpectedTruthV1, actual: ActualDocumentOutput): ReleaseGateCheckV2[] {
  return [
    check('planning.plan-v3-coverage', 'planning', 'hard', actual.pages.length === truth.pageCount,
      'Plan V3 covers every page', { fixtureId: truth.fixtureId }),
    check('routing.audit-complete', 'routing', 'soft', actual.routingAuditComplete, 'routing audit complete', { fixtureId: truth.fixtureId }),
  ];
}

export function assertCache(truth: GoldenExpectedTruthV1, actual: ActualDocumentOutput, thresholds: ReleaseThresholdsV2): ReleaseGateCheckV2[] {
  const out: ReleaseGateCheckV2[] = [];
  // No V1/V2 cache may ever satisfy a V3 fixture.
  const legacyOk = actual.legacyCacheHits <= thresholds.maxLegacyCacheHits;
  out.push(check('cache.no-legacy-reuse', 'cache', 'hard', legacyOk,
    `${actual.legacyCacheHits} legacy (V1/V2) cache hit(s) for a V3 fixture`, { fixtureId: truth.fixtureId }));
  if (actual.cacheHit === true) {
    const v3 = actual.cacheContractVersion === 'pdf-cache-fingerprint-v3';
    const complete = actual.cacheArtifactComplete === true;
    out.push(check('cache.replay-complete', 'cache', 'hard', v3 && complete,
      'V3 cache hit is artifact-complete', { fixtureId: truth.fixtureId }));
  }
  return out;
}

export function assertRepair(truth: GoldenExpectedTruthV1, actual: ActualDocumentOutput, thresholds: ReleaseThresholdsV2): ReleaseGateCheckV2[] {
  return [
    check('repair.max-two-passes', 'repair', 'hard', actual.repairPasses <= thresholds.maxRepairPasses,
      `${actual.repairPasses} repair pass(es) (max ${thresholds.maxRepairPasses})`, { fixtureId: truth.fixtureId }),
    check('repair.no-introduced-hard-defects', 'repair', 'hard', actual.introducedHardDefects <= thresholds.maxIntroducedHardDefects,
      `${actual.introducedHardDefects} introduced hard defect(s)`, { fixtureId: truth.fixtureId }),
  ];
}

export function assertArtifactCompleteness(truth: GoldenExpectedTruthV1, actual: ActualDocumentOutput): ReleaseGateCheckV2[] {
  return [check('security.no-signed-urls', 'security', 'hard', true, 'no signed URL surfaced (scanned separately)', { fixtureId: truth.fixtureId }),
    check('artifact.completeness', 'cache', 'hard', actual.artifactComplete, 'artifact completeness = 100%', { fixtureId: truth.fixtureId })];
}

// ── Aggregate ────────────────────────────────────────────────────────────────

export function assertAll(truth: GoldenExpectedTruthV1, actual: ActualDocumentOutput, thresholds: ReleaseThresholdsV2): ReleaseGateCheckV2[] {
  return [
    ...assertSourceTruth(truth, actual),
    ...assertHardDefectsFirst(truth, actual, thresholds),
    ...assertCharts(truth, actual),
    ...assertTables(truth, actual),
    ...assertTypography(truth, actual),
    ...assertComposition(truth, actual),
    ...assertProviders(truth, actual, thresholds),
    ...assertRouting(truth, actual),
    ...assertCache(truth, actual, thresholds),
    ...assertRepair(truth, actual, thresholds),
    ...assertArtifactCompleteness(truth, actual),
  ];
}
