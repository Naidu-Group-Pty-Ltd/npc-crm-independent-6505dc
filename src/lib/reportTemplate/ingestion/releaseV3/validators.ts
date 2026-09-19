/**
 * PDF Extraction V3 · E12 — persisted-shape validators.
 *
 * Reject wrong versions, non-finite metrics, signed URLs, raw buffers, private
 * paths and credentials before any contract could be persisted or uploaded.
 * Returns bounded problem codes; empty = valid.
 */
import {
  GENERATED_FIXTURE_SPEC_VERSION,
  GOLDEN_CORPUS_REGISTRY_V2_VERSION,
  GOLDEN_EXPECTED_TRUTH_VERSION,
  GOLDEN_RUN_MANIFEST_V2_VERSION,
  GOLDEN_RUN_RESULT_V2_VERSION,
  PRIVATE_CORPUS_REGISTRY_VERSION,
  RELEASE_ARTIFACT_MANIFEST_VERSION,
  RELEASE_BASELINE_V2_VERSION,
  RELEASE_GATE_POLICY_V2_VERSION,
  RELEASE_GATE_REPORT_V2_VERSION,
  RELEASE_READINESS_DECISION_VERSION,
} from './contracts';
import { scanForbidden } from './redaction';

function expectVersion(value: unknown, expected: string): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['not_an_object'];
  const v = (value as { version?: string }).version;
  return v === expected ? [] : ['invalid_version'];
}

function validate(value: unknown, expected: string): string[] {
  const problems = [...expectVersion(value, expected), ...scanForbidden(value)];
  return Array.from(new Set(problems)).sort();
}

export const validateRegistryV2 = (v: unknown) => validate(v, GOLDEN_CORPUS_REGISTRY_V2_VERSION);
export const validateFixtureSpec = (v: unknown) => validate(v, GENERATED_FIXTURE_SPEC_VERSION);
export const validatePrivateRegistry = (v: unknown) => validate(v, PRIVATE_CORPUS_REGISTRY_VERSION);
export const validateExpectedTruth = (v: unknown) => validate(v, GOLDEN_EXPECTED_TRUTH_VERSION);
export const validateRunManifest = (v: unknown) => validate(v, GOLDEN_RUN_MANIFEST_V2_VERSION);
export const validateRunResult = (v: unknown) => validate(v, GOLDEN_RUN_RESULT_V2_VERSION);
export const validateGatePolicy = (v: unknown) => validate(v, RELEASE_GATE_POLICY_V2_VERSION);
export const validateGateReport = (v: unknown) => validate(v, RELEASE_GATE_REPORT_V2_VERSION);
export const validateBaseline = (v: unknown) => validate(v, RELEASE_BASELINE_V2_VERSION);
export const validateArtifactManifest = (v: unknown) => validate(v, RELEASE_ARTIFACT_MANIFEST_VERSION);
export const validateReadinessDecision = (v: unknown) => validate(v, RELEASE_READINESS_DECISION_VERSION);

/** True when a value is safe to serialize into a persisted report/upload. */
export function isReportSanitized(value: unknown): boolean {
  return scanForbidden(value).length === 0;
}
