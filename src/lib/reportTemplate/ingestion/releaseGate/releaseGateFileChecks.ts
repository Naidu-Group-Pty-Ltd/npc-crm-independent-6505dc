/**
 * releaseGateFileChecks — Phase 11D required-file existence checks.
 *
 * Pure, synchronous, Node-compatible helpers used by both the CLI and the
 * (node-run) tests. No secrets, no network, no mutation — existence checks only.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  PdfImportReleaseGateCheck,
  PdfImportReleaseGateDomain,
  PdfImportReleaseGateSeverity,
} from './releaseGateTypes';

export interface ReleaseGateFileCheckInput {
  rootDir: string;
  requiredFiles: string[];
  /** Optional override for existence probing (defaults to node fs). */
  fileExists?: (absolutePath: string) => boolean;
}

export interface ReleaseGateFileCheckResult {
  path: string;
  exists: boolean;
}

/**
 * The canonical set of files the release gate requires to exist. Grouped for
 * readability; the CLI/config may extend this via config.requiredFiles.
 */
export function getRequiredPdfImportReleaseGateFiles(): string[] {
  return [
    // Phase 10 docs / schema / SQL
    'docs/pdf-import/phase-10h-production-intelligence-lock.md',
    'docs/pdf-import/production-operator-control-audit.schema.json',
    'docs/pdf-import/self-healing-retry-audit.schema.json',
    'scripts/regression/pdf-import-phase-10-final-check.sql',

    // Phase 11A rollout readiness
    'docs/pdf-import/phase-11a-production-rollout-readiness-review.md',
    'scripts/regression/pdf-import-phase-11a-rollout-readiness-check.sql',
    'src/lib/reportTemplate/ingestion/rolloutReadiness/rolloutReadinessEvaluator.ts',

    // Phase 11B permissions
    'docs/pdf-import/phase-11b-role-based-operator-permissions.md',
    'docs/pdf-import/pdf-import-permission-policy.schema.json',
    'scripts/regression/pdf-import-phase-11b-permissions-check.sql',
    'src/lib/reportTemplate/ingestion/operatorPermissions/operatorPermissionMatrix.ts',

    // Phase 11C monitoring
    'docs/pdf-import/phase-11c-monitoring-alerting-activation.md',
    'docs/pdf-import/pdf-import-monitoring-event.schema.json',
    'scripts/regression/pdf-import-phase-11c-monitoring-check.sql',
    'src/lib/reportTemplate/ingestion/monitoring/monitoringEventRules.ts',
    'supabase/functions/pdf-import-monitoring/index.ts',

    // Phase 11D release gate
    'docs/pdf-import/phase-11d-release-gate-ci-integration.md',
    'docs/pdf-import/phase-11d-release-gate-policy.md',
    'docs/pdf-import/phase-11d-ci-setup.md',
    'docs/pdf-import/pdf-import-release-gate-report.schema.json',
    'scripts/regression/pdf-import-phase-11d-release-gate-check.sql',
    'scripts/regression/pdf-import-release-gate.mjs',
    'scripts/regression/pdf-import-release-gate.config.json',
    'src/lib/reportTemplate/ingestion/releaseGate/releaseGateEvaluator.ts',

    // Critical source modules (Phase 8/9/10 foundations)
    'src/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusRegistry.ts',
    'src/lib/reportTemplate/ingestion/goldenCorpus/goldenCorpusOrchestrator.ts',
    'src/lib/reportTemplate/ingestion/goldenCorpus/goldenRunBaselineComparison.ts',
    'src/lib/reportTemplate/ingestion/exportParity/exportParityRunner.ts',
    'src/lib/reportTemplate/ingestion/qualityGates/pdfImportQualityGateEvaluator.ts',
    'src/lib/reportTemplate/ingestion/operatorControls/operatorControlRules.ts',
    'src/lib/reportTemplate/ingestion/phase10Lock/phase10ProductionLockEvaluator.ts',
  ];
}

export function checkRequiredPdfImportFiles(
  input: ReleaseGateFileCheckInput,
): ReleaseGateFileCheckResult[] {
  const exists = input.fileExists ?? ((p: string) => existsSync(p));
  const files = Array.isArray(input.requiredFiles) ? input.requiredFiles : [];
  return files.map((rel) => ({
    path: rel,
    exists: exists(join(input.rootDir, rel)),
  }));
}

/** Classify a required file into a gate domain + severity by its path shape. */
function classifyFile(rel: string): {
  domain: PdfImportReleaseGateDomain;
  severity: PdfImportReleaseGateSeverity;
} {
  if (rel.startsWith('docs/') && rel.endsWith('.schema.json')) return { domain: 'schemas', severity: 'medium' };
  if (rel.startsWith('docs/')) return { domain: 'documentation', severity: 'medium' };
  if (rel.endsWith('.sql')) return { domain: 'sql', severity: 'medium' };
  if (rel.startsWith('supabase/functions/')) return { domain: 'monitoring', severity: 'high' };
  if (rel.startsWith('supabase/migrations/')) return { domain: 'source_integrity', severity: 'high' };
  if (rel.startsWith('scripts/regression/') && (rel.endsWith('.mjs') || rel.endsWith('.json'))) {
    return { domain: 'ci_configuration', severity: 'high' };
  }
  if (rel.includes('ingestion/monitoring/')) return { domain: 'monitoring', severity: 'high' };
  if (rel.includes('ingestion/operatorPermissions/')) return { domain: 'permissions', severity: 'critical' };
  if (rel.includes('ingestion/goldenCorpus/')) return { domain: 'golden_regression', severity: 'high' };
  if (rel.includes('ingestion/exportParity/')) return { domain: 'export_parity', severity: 'high' };
  if (rel.includes('ingestion/releaseGate/')) return { domain: 'ci_configuration', severity: 'high' };
  if (rel.startsWith('src/lib/reportTemplate/ingestion/')) return { domain: 'source_integrity', severity: 'critical' };
  if (rel.startsWith('src/pages/')) return { domain: 'source_integrity', severity: 'high' };
  return { domain: 'source_integrity', severity: 'medium' };
}

/**
 * Build gate checks from required-file existence. Missing files fail their
 * check at the classified severity; present files pass.
 */
export function buildFileCheckGateResults(input: {
  rootDir: string;
  requiredFiles?: string[];
  fileExists?: (absolutePath: string) => boolean;
}): PdfImportReleaseGateCheck[] {
  const requiredFiles = input.requiredFiles ?? getRequiredPdfImportReleaseGateFiles();
  const results = checkRequiredPdfImportFiles({
    rootDir: input.rootDir,
    requiredFiles,
    fileExists: input.fileExists,
  });

  return results.map((result) => {
    const { domain, severity } = classifyFile(result.path);
    return {
      id: `file_exists:${result.path}`,
      domain,
      severity,
      status: result.exists ? 'pass' : 'fail',
      title: `Required file: ${result.path}`,
      message: result.exists ? 'File present.' : 'Required file is missing.',
      evidence: [result.path],
      remediation: `Restore or create ${result.path}.`,
    } satisfies PdfImportReleaseGateCheck;
  });
}
