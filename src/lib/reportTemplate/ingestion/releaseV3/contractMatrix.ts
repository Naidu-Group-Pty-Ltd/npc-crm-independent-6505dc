/**
 * PDF Extraction V3 · E12 — machine-readable E0–E12 contract matrix.
 *
 * One authoritative record of every extraction-V3 contract: producer, consumer,
 * whether it participates in the cache fingerprint, and the release checks that
 * cover it. The gate fails when a required current contract is missing or a
 * producer/consumer version disagrees.
 */

export interface ContractMatrixEntry {
  contract: string;
  version: string;
  producer: string;
  consumer: string;
  inFingerprint: boolean;
  releaseChecks: string[];
}

export const CONTRACT_MATRIX: readonly ContractMatrixEntry[] = [
  { contract: 'critical-visual-containment', version: 'critical-visual-containment-v1', producer: 'E0', consumer: 'E7', inFingerprint: false, releaseChecks: ['quality.hard-defects-zero'] },
  { contract: 'source-scene-graph', version: 'source-scene-graph-v2', producer: 'E1', consumer: 'E3-E7', inFingerprint: true, releaseChecks: ['source-integrity.hash'] },
  { contract: 'pdf-page-artifact-contract', version: 'pdf-page-artifact-contract-v3', producer: 'E1', consumer: 'E11', inFingerprint: true, releaseChecks: ['artifact.completeness'] },
  { contract: 'chart-preservation', version: 'chart-preservation-v1', producer: 'E3', consumer: 'E6-E7', inFingerprint: true, releaseChecks: ['charts.visibility'] },
  { contract: 'table-integrity-report', version: 'table-integrity-report-v1', producer: 'E4', consumer: 'E6-E7', inFingerprint: true, releaseChecks: ['tables.native-or-crop'] },
  { contract: 'table-arbitration', version: 'table-arbitration-v1', producer: 'E4', consumer: 'E6', inFingerprint: true, releaseChecks: ['tables.native-or-crop'] },
  { contract: 'typography-fidelity-report', version: 'typography-fidelity-report-v1', producer: 'E5', consumer: 'E6-E7', inFingerprint: true, releaseChecks: ['typography.critical-recall'] },
  { contract: 'font-resolution-policy', version: 'font-resolution-policy-v2', producer: 'E5', consumer: 'E6', inFingerprint: true, releaseChecks: ['typography.critical-recall'] },
  { contract: 'pdf-region-output-policy', version: 'pdf-region-output-policy-v1', producer: 'E6', consumer: 'E7-E11', inFingerprint: true, releaseChecks: ['composition.single-owner'] },
  { contract: 'pdf-region-render-plan', version: 'pdf-region-render-plan-v1', producer: 'E6', consumer: 'renderer', inFingerprint: true, releaseChecks: ['composition.single-owner', 'export.parity'] },
  { contract: 'visual-quality-report', version: 'visual-quality-report-v2', producer: 'E7', consumer: 'E8-E11', inFingerprint: false, releaseChecks: ['quality.hard-defects-zero', 'quality.browser-evidence'] },
  { contract: 'import-quality-gate', version: 'import-quality-gate-v2', producer: 'E7', consumer: 'finalizer', inFingerprint: false, releaseChecks: ['quality.hard-defects-zero'] },
  { contract: 'repair-cascade', version: 'repair-cascade-v2', producer: 'E8', consumer: 'finalizer', inFingerprint: false, releaseChecks: ['repair.max-two-passes'] },
  { contract: 'repair-selection-policy', version: 'repair-selection-policy-v1', producer: 'E8', consumer: 'finalizer', inFingerprint: false, releaseChecks: ['repair.no-introduced-hard-defects'] },
  { contract: 'extraction-provider-policy', version: 'extraction-provider-policy-v1', producer: 'E9', consumer: 'E10', inFingerprint: true, releaseChecks: ['providers.no-remote'] },
  { contract: 'provider-attempt-audit', version: 'provider-attempt-audit-v1', producer: 'E9', consumer: 'E11', inFingerprint: false, releaseChecks: ['providers.audit-complete'] },
  { contract: 'pdf-extraction-plan', version: 'pdf-extraction-plan-v3', producer: 'E10', consumer: 'dispatch', inFingerprint: true, releaseChecks: ['planning.plan-v3-coverage'] },
  { contract: 'pdf-cache-fingerprint', version: 'pdf-cache-fingerprint-v3', producer: 'E10', consumer: 'cache', inFingerprint: true, releaseChecks: ['cache.no-legacy-reuse', 'cache.replay-complete'] },
  { contract: 'pdf-cache-entry', version: 'pdf-cache-entry-v3', producer: 'E10', consumer: 'cache', inFingerprint: false, releaseChecks: ['cache.replay-complete'] },
  { contract: 'pdf-artifact-completeness', version: 'pdf-artifact-completeness-v1', producer: 'E10', consumer: 'cache', inFingerprint: false, releaseChecks: ['artifact.completeness'] },
  { contract: 'pdf-recovery-plan', version: 'pdf-recovery-plan-v1', producer: 'E10', consumer: 'recovery', inFingerprint: false, releaseChecks: ['recovery.reroute-new-plan'] },
  { contract: 'pdf-document-review-model', version: 'pdf-document-review-model-v1', producer: 'E11', consumer: 'review-ui', inFingerprint: false, releaseChecks: ['review-ui.smoke'] },
];

/** Contracts that MUST be present + fingerprint-included for a V3 release. */
export const REQUIRED_FINGERPRINT_CONTRACTS: readonly string[] = CONTRACT_MATRIX
  .filter((e) => e.inFingerprint)
  .map((e) => e.version);

/**
 * Validate a producer/consumer version map against the matrix. Returns problem
 * codes when a required contract is missing or versions disagree.
 */
export function validateContractMatrix(observed: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const entry of CONTRACT_MATRIX) {
    const seen = observed[entry.contract];
    if (seen === undefined) { problems.push(`missing_contract:${entry.contract}`); continue; }
    if (seen !== entry.version) problems.push(`version_mismatch:${entry.contract}:${seen}!=${entry.version}`);
  }
  return problems;
}
