/**
 * pdfImportStaleness — Phase 10F.
 *
 * Determines whether persisted metadata should be reused or rebuilt, using only
 * timestamps, versions, and dependency ordering that are safely available. When
 * timestamps are missing the status is conservatively `unknown` (never stale by
 * guess). This module never rebuilds anything; it only classifies freshness.
 */
import type {
  PdfImportMetadataStaleness,
  PdfImportMetadataStalenessStatus,
  PdfImportPerformanceSignals,
} from './pdfImportPerformanceTypes';

function toTime(value: string | null | undefined): number | null {
  if (!value || typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Resolve a single metadata key's staleness against its dependencies.
 * - No key generatedAt but dependencies exist and are newer → stale.
 * - generatedAt missing entirely → unknown.
 * - generatedAt present and newer-than-or-equal to all known deps → fresh.
 */
export function resolveMetadataStalenessStatus(input: {
  metadataKey: string;
  present?: boolean;
  generatedAt?: string | null;
  dependsOn?: string[];
  dependsOnGeneratedAt?: Array<string | null | undefined>;
  required?: boolean;
}): PdfImportMetadataStaleness {
  const metadataKey = input.metadataKey;
  const dependsOn = input.dependsOn ?? [];

  if (input.present === false) {
    return {
      metadataKey,
      status: 'missing',
      reason: input.required === false
        ? 'Optional metadata is not present.'
        : 'Metadata is not present and may need to be built.',
      generatedAt: null,
      dependsOn,
    };
  }

  const selfTime = toTime(input.generatedAt);
  const depTimes = (input.dependsOnGeneratedAt ?? [])
    .map(toTime)
    .filter((t): t is number => t !== null);

  if (selfTime === null) {
    return {
      metadataKey,
      status: 'unknown',
      reason: 'No generatedAt timestamp; freshness cannot be determined.',
      generatedAt: input.generatedAt ?? null,
      dependsOn,
    };
  }

  const newerDep = depTimes.some((depTime) => depTime > selfTime);
  const status: PdfImportMetadataStalenessStatus = newerDep ? 'stale' : 'fresh';
  return {
    metadataKey,
    status,
    reason: newerDep
      ? 'Generated before a newer dependency; consider rebuilding.'
      : 'Generated at or after all known dependencies.',
    generatedAt: input.generatedAt ?? null,
    dependsOn,
  };
}

export function evaluatePdfImportMetadataStaleness(
  signals: PdfImportPerformanceSignals,
): PdfImportMetadataStaleness[] {
  const out: PdfImportMetadataStaleness[] = [];

  // Dependency timestamps available on the snapshot-derived signals. Visual/
  // repair/export summary generatedAt values are only present when the raw
  // summaries were supplied; otherwise they are null and treated conservatively.
  const visualAt = signals.visualQaGeneratedAt;
  const repairAt = signals.repairGeneratedAt;
  const exportAt = signals.exportParityGeneratedAt;
  const profileAt = signals.importProfileGeneratedAt;
  const patternAt = signals.repairPatternGeneratedAt;
  const policyAt = signals.adaptiveGeneratedAt;
  const goldenAt = signals.goldenGeneratedAt;

  out.push(resolveMetadataStalenessStatus({
    metadataKey: 'import_intelligence_profile',
    present: signals.hasImportProfile,
    generatedAt: profileAt,
    dependsOn: ['visual_quality_summary', 'visual_repair_summary', 'export_parity_summary', 'golden_regression_summary'],
    dependsOnGeneratedAt: [visualAt, repairAt, exportAt, goldenAt],
  }));

  out.push(resolveMetadataStalenessStatus({
    metadataKey: 'repair_pattern_analysis',
    present: signals.hasRepairPatternAnalysis,
    generatedAt: patternAt,
    dependsOn: ['import_intelligence_profile', 'visual_quality_summary', 'visual_repair_summary', 'export_parity_summary'],
    dependsOnGeneratedAt: [profileAt, visualAt, repairAt, exportAt],
  }));

  out.push(resolveMetadataStalenessStatus({
    metadataKey: 'adaptive_reconciliation_policy',
    present: signals.hasAdaptiveReconciliationPolicy,
    generatedAt: policyAt,
    dependsOn: ['import_intelligence_profile', 'repair_pattern_analysis', 'visual_quality_summary', 'visual_repair_summary', 'export_parity_summary'],
    dependsOnGeneratedAt: [profileAt, patternAt, visualAt, repairAt, exportAt],
  }));

  out.push(resolveMetadataStalenessStatus({
    metadataKey: 'self_healing_retry_audit',
    present: signals.hasSelfHealingAudit,
    generatedAt: signals.selfHealingGeneratedAt,
    dependsOn: ['adaptive_reconciliation_policy', 'golden_regression_summary', 'repair_pattern_analysis'],
    dependsOnGeneratedAt: [policyAt, goldenAt, patternAt],
  }));

  out.push(resolveMetadataStalenessStatus({
    metadataKey: 'export_parity_summary',
    present: signals.hasExportParity,
    generatedAt: exportAt,
    // No safe upstream timestamp (template updated_at unavailable here); freshness
    // is fresh/unknown by generatedAt only — never guessed stale.
    dependsOn: [],
    dependsOnGeneratedAt: [],
  }));

  out.push(resolveMetadataStalenessStatus({
    metadataKey: 'golden_regression_summary',
    present: signals.hasGoldenRegression,
    generatedAt: goldenAt,
    dependsOn: ['export_parity_summary', 'import_intelligence_profile', 'repair_pattern_analysis', 'adaptive_reconciliation_policy'],
    dependsOnGeneratedAt: [exportAt, profileAt, patternAt, policyAt],
  }));

  return out;
}

export function isMetadataMissingOrStale(
  staleness: PdfImportMetadataStaleness[],
  metadataKey: string,
): boolean {
  const entry = staleness.find((s) => s.metadataKey === metadataKey);
  if (!entry) return false;
  return entry.status === 'missing' || entry.status === 'stale';
}
