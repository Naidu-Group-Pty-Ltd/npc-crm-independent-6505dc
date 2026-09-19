/**
 * PDF Extraction V3 · E12 — golden expected-truth builders.
 *
 * Expected truth is emitted by the FIXTURE definition, NEVER derived from the
 * extracted candidate. Each builder returns a deterministic
 * `GoldenExpectedTruthV1` from a fixture spec + a source hash the PDF builder
 * produced. The truth carries the critical Unicode/numeric tokens, region
 * ownership and acceptable fallback strategies the assertion engine checks
 * against actual output.
 */
import {
  GOLDEN_EXPECTED_TRUTH_VERSION,
  type GeneratedFixtureSpecV1,
  type GoldenExpectedOutputConstraintsV1,
  type GoldenExpectedPageTruthV1,
  type GoldenExpectedRegionTruthV1,
  type GoldenExpectedTruthV1,
} from './contracts';

export interface ExpectedTruthDraft {
  documentClass: string;
  planProperties: Record<string, unknown>;
  outputConstraints: GoldenExpectedOutputConstraintsV1;
  pages: GoldenExpectedPageTruthV1[];
}

export function region(
  regionId: string,
  regionType: string,
  bbox: { x: number; y: number; width: number; height: number },
  opts: Partial<Omit<GoldenExpectedRegionTruthV1, 'regionId' | 'regionType' | 'bbox'>> = {},
): GoldenExpectedRegionTruthV1 {
  return {
    regionId,
    regionType,
    bbox,
    parentRegionId: opts.parentRegionId ?? null,
    criticalUnicode: opts.criticalUnicode ?? [],
    criticalNumericTokens: opts.criticalNumericTokens ?? [],
    expectsSourceCrop: opts.expectsSourceCrop ?? false,
    expectsNativeSafe: opts.expectsNativeSafe ?? false,
  };
}

export function defaultOutputConstraints(over: Partial<GoldenExpectedOutputConstraintsV1> = {}): GoldenExpectedOutputConstraintsV1 {
  return {
    minOutputScore: over.minOutputScore ?? 0.92,
    maxRepairPasses: over.maxRepairPasses ?? 2,
    maxHardDefects: over.maxHardDefects ?? 0,
    requireBrowserExportParity: over.requireBrowserExportParity ?? true,
    forbidRemoteProviders: over.forbidRemoteProviders ?? true,
  };
}

export function buildExpectedTruth(
  spec: GeneratedFixtureSpecV1,
  sourceSha256: string,
  draft: ExpectedTruthDraft,
): GoldenExpectedTruthV1 {
  return {
    version: GOLDEN_EXPECTED_TRUTH_VERSION,
    fixtureId: spec.fixtureId,
    sourceSha256,
    pageCount: draft.pages.length,
    pages: draft.pages,
    expectedDocumentClass: draft.documentClass,
    expectedPlanProperties: draft.planProperties,
    expectedOutputConstraints: draft.outputConstraints,
    problems: [],
  };
}
