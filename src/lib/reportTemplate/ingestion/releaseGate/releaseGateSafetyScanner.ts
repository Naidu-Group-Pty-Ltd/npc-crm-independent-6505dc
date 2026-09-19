/**
 * releaseGateSafetyScanner — Phase 11D private-artifact + unsafe-source scanner.
 *
 * Conservative, false-positive-averse scanning:
 *  - Private artifact scan works on file PATHS only (no reads).
 *  - Unsafe source scan reads only non-excluded source files (never docs, SQL,
 *    schemas, tests, or the releaseGate module itself — which holds these
 *    pattern strings as data).
 *
 * Pure/Node-compatible. Never mutates, never calls network/AI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PdfImportReleaseGateCheck } from './releaseGateTypes';

export type ReleaseGateSafetySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ReleaseGateSafetyScanOptions {
  rootDir: string;
  filePaths?: string[];
  /** Optional override for reading file content (defaults to node fs). */
  readFile?: (absolutePath: string) => string | null;
}

export interface ReleaseGateSafetyFinding {
  code: string;
  path: string;
  severity: ReleaseGateSafetySeverity;
  message: string;
}

/** Substrings/extensions that indicate a private artifact should never be committed. */
export function getPdfImportPrivateArtifactPatterns(): string[] {
  return [
    'audit-output/',
    '.pdf',
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.log',
    '.env',
    'supabase/config.toml.before-',
    'signed-url',
    'signed_url',
    'cloud-run-log',
    'supabase-log',
  ];
}

/**
 * General unsafe source patterns applied to every scanned source file. Kept
 * intentionally specific so legitimate code never trips them. Path-scoped
 * patterns (template mutation inside executors) are handled separately in the
 * scan function because they must be qualified by path.
 */
export function getPdfImportUnsafeSourcePatterns(): Array<{
  code: string;
  pattern: RegExp;
  severity: ReleaseGateSafetySeverity;
  message: string;
}> {
  return [
    {
      code: 'service_role_secret_frontend',
      pattern: /SUPABASE_SERVICE_ROLE_KEY/,
      severity: 'critical',
      message: 'Service-role secret referenced in frontend source.',
    },
    {
      code: 'automatic_ai_execution',
      pattern: /\b(autoRunAiReconciliation|automaticallyReconcile|autoInvokeAiReconciliation|autoRunReconciliation)\b/,
      severity: 'critical',
      message: 'Automatic AI reconciliation invocation pattern detected.',
    },
    {
      code: 'manual_only_auto_completion',
      pattern: /\b(autoCompleteManualOnly|forceCompleteManualOnly|autoExecuteManualOnly)\b/,
      severity: 'critical',
      message: 'Manual-only action auto-completion pattern detected.',
    },
    {
      code: 'quality_gate_bypass',
      pattern: /\b(bypassQualityGate|skipQualityGate|forceQualityGatePass|disableQualityGate)\b/,
      severity: 'critical',
      message: 'Quality gate bypass pattern detected.',
    },
  ];
}

/** Path-scoped unsafe patterns: template mutation from self-healing / operator-control executors. */
const PATH_SCOPED_PATTERNS: Array<{
  code: string;
  pathScope: RegExp;
  pattern: RegExp;
  severity: ReleaseGateSafetySeverity;
  message: string;
}> = [
  {
    code: 'automatic_template_mutation',
    pathScope: /ingestion\/(selfHealing|operatorControls)\/.*(Executor|executor)/,
    pattern: /\b(applyTemplateImportPlan|applyRepairedTemplateToRecord)\s*\(/,
    severity: 'high',
    message: 'Template mutation invoked from a self-healing / operator-control executor.',
  },
  {
    code: 'automatic_template_mutation',
    pathScope: /ingestion\/(selfHealing|operatorControls)\//,
    pattern: /from\(['"]report_templates['"]\)\s*\.\s*(update|upsert|insert|delete)/,
    severity: 'high',
    message: 'report_templates write from a self-healing / operator-control path.',
  },
];

/** True when a path should be scanned for unsafe RUNTIME patterns. */
function shouldScanSourceFile(rel: string): boolean {
  if (rel.includes('/__tests__/')) return false;
  if (rel.endsWith('.spec.ts') || rel.endsWith('.test.ts')) return false;
  if (rel.startsWith('docs/')) return false;
  if (rel.endsWith('.md') || rel.endsWith('.sql') || rel.endsWith('.json')) return false;
  // The releaseGate module itself holds these pattern strings as data.
  if (rel.includes('ingestion/releaseGate/')) return false;
  // Only scan actual source trees.
  return rel.startsWith('src/') || rel.startsWith('supabase/functions/');
}

/**
 * Trees whose whole purpose is to hold committed assets.
 *
 * A raster inside one of these is part of the application — bundled by Vite or
 * served from `public/` to every visitor — and is reviewed as such. A raster
 * anywhere else is a candidate artifact: something a PDF-import run rendered
 * and somebody committed by accident, which is what this scan exists to catch.
 *
 * The classification used to be the extension alone, and that made a brand
 * asset unlandable. `public/brand/aurixa-emblem-240.png` had been corrupted on
 * a downstream clone and the repair could not merge, because the pull request
 * carrying it failed `[critical] no_generated_images_staged` — naming a file
 * that is *supposed* to be in the repository. Prime carries 33 committed
 * rasters across these two trees; under the old rule, touching any one of them
 * failed the gate.
 *
 * This is a real narrowing and worth stating plainly: a rendered page from a
 * client's document, placed deliberately in the shipped asset tree, is no
 * longer caught here. What still catches it is that `.pdf` remains critical
 * EVERYWHERE including these trees, the log/env and signed-URL rules are
 * untouched, and putting a customer artifact into the publicly served bundle
 * is a conspicuous act in review rather than the quiet slip this rule is aimed
 * at — a scratch file left behind in `reports/`, `tmp/` or the repository root.
 */
const COMMITTED_ASSET_TREES = [/^public\//, /^src\/assets\//];

function isCommittedAsset(path: string): boolean {
  return COMMITTED_ASSET_TREES.some((rx) => rx.test(path));
}

/** The dotenv names that are templates rather than secrets. */
const DOTENV_TEMPLATES = ['.env.example', '.env.sample', '.env.template'];

/**
 * Whether a path is a dotenv file holding secrets.
 *
 * The rule was `endsWith('.env') || includes('/.env')`, which catches `.env`
 * and `dir/.env` and misses **`.env.local`** — the file this project's own
 * `.gitignore` names as where secrets live. A check called "No logs or .env
 * staged" that cannot see `.env.local` at the repository root is not doing the
 * one job its name claims, and the contract spec against the `.mjs` copy found
 * it the first time both were asked the same question.
 *
 * `.env.example` is committed on purpose and is the single `!` exception in
 * `.gitignore`, so it and its two conventional siblings are excluded by name.
 */
function isSecretDotenv(lowerPath: string): boolean {
  const base = lowerPath.slice(lowerPath.lastIndexOf('/') + 1);
  if (!base.startsWith('.env')) return false;
  return !DOTENV_TEMPLATES.includes(base);
}

export function scanPdfImportPrivateArtifacts(
  filePaths: string[],
): ReleaseGateSafetyFinding[] {
  const findings: ReleaseGateSafetyFinding[] = [];
  const files = Array.isArray(filePaths) ? filePaths : [];

  for (const raw of files) {
    const path = String(raw);
    const lower = path.toLowerCase();
    if (lower.endsWith('.pdf')) {
      // Deliberately BEFORE the asset-tree exemption: a PDF under `public/` is
      // not a brand asset, it is a document published to the internet.
      findings.push({ code: 'private_pdf', path, severity: 'critical', message: 'PDF file staged.' });
    } else if (/\.(png|jpe?g|webp)$/.test(lower) && !isCommittedAsset(path)) {
      findings.push({ code: 'private_image', path, severity: 'critical', message: 'Raster image staged.' });
    } else if (lower.endsWith('.log') || isSecretDotenv(lower)) {
      findings.push({ code: 'private_log_or_env', path, severity: 'critical', message: 'Log or .env file staged.' });
    } else if (
      lower.includes('signed-url') ||
      lower.includes('signed_url') ||
      lower.includes('cloud-run-log') ||
      lower.includes('supabase-log')
    ) {
      findings.push({ code: 'signed_url_or_log_dump', path, severity: 'critical', message: 'Signed-URL or log dump staged.' });
    } else if (lower.includes('audit-output/') || lower.includes('supabase/config.toml.before-')) {
      findings.push({ code: 'private_log_or_env', path, severity: 'high', message: 'Audit output or config backup staged.' });
    }
  }

  return findings;
}

export function scanPdfImportUnsafeSourcePatterns(
  options: ReleaseGateSafetyScanOptions,
): ReleaseGateSafetyFinding[] {
  const findings: ReleaseGateSafetyFinding[] = [];
  const files = Array.isArray(options.filePaths) ? options.filePaths : [];
  const read = options.readFile ?? ((abs: string) => (existsSync(abs) ? readFileSync(abs, 'utf8') : null));
  const generalPatterns = getPdfImportUnsafeSourcePatterns();

  for (const raw of files) {
    const rel = String(raw);
    if (!shouldScanSourceFile(rel)) continue;
    const content = read(join(options.rootDir, rel));
    if (content == null) continue;

    for (const p of generalPatterns) {
      if (p.pattern.test(content)) {
        findings.push({ code: p.code, path: rel, severity: p.severity, message: p.message });
      }
    }
    for (const p of PATH_SCOPED_PATTERNS) {
      if (p.pathScope.test(rel) && p.pattern.test(content)) {
        findings.push({ code: p.code, path: rel, severity: p.severity, message: p.message });
      }
    }
  }

  return findings;
}

const ARTIFACT_CODE_TO_CHECK: Record<string, { id: string; title: string }> = {
  private_pdf: { id: 'no_private_pdfs_staged', title: 'No private PDFs staged' },
  private_image: { id: 'no_generated_images_staged', title: 'No generated images staged' },
  private_log_or_env: { id: 'no_logs_or_env_staged', title: 'No logs or .env staged' },
  signed_url_or_log_dump: { id: 'no_signed_url_dumps_staged', title: 'No signed URL dumps staged' },
};

const SOURCE_CODE_TO_CHECK: Record<string, { id: string; title: string; severity: ReleaseGateSafetySeverity }> = {
  automatic_ai_execution: { id: 'no_automatic_ai_execution_pattern', title: 'No automatic AI execution', severity: 'critical' },
  automatic_template_mutation: { id: 'no_automatic_template_mutation_pattern', title: 'No automatic template mutation', severity: 'critical' },
  manual_only_auto_completion: { id: 'no_manual_only_action_auto_completion_pattern', title: 'No manual-only auto-completion', severity: 'critical' },
  quality_gate_bypass: { id: 'no_quality_gate_bypass_pattern', title: 'No quality gate bypass', severity: 'critical' },
  service_role_secret_frontend: { id: 'no_service_role_secret_frontend_pattern', title: 'No service-role secret in frontend', severity: 'critical' },
};

/**
 * Build gate checks from safety findings. Each canonical safety/private-artifact
 * check passes when there are no matching findings, and fails (listing the
 * offending paths as evidence) when there are.
 */
export function buildSafetyScanGateResults(input: {
  artifactFindings: ReleaseGateSafetyFinding[];
  sourceFindings: ReleaseGateSafetyFinding[];
}): PdfImportReleaseGateCheck[] {
  const artifactFindings = Array.isArray(input.artifactFindings) ? input.artifactFindings : [];
  const sourceFindings = Array.isArray(input.sourceFindings) ? input.sourceFindings : [];
  const checks: PdfImportReleaseGateCheck[] = [];

  for (const [code, meta] of Object.entries(ARTIFACT_CODE_TO_CHECK)) {
    const hits = artifactFindings.filter((f) => f.code === code);
    checks.push({
      id: meta.id,
      domain: 'private_artifacts',
      severity: 'critical',
      status: hits.length > 0 ? 'fail' : 'pass',
      title: meta.title,
      message: hits.length > 0 ? `${hits.length} offending file(s) staged.` : 'No offending files staged.',
      evidence: hits.map((f) => f.path),
      remediation: 'Unstage the private artifact(s) and add to .gitignore.',
    });
  }

  for (const [code, meta] of Object.entries(SOURCE_CODE_TO_CHECK)) {
    const hits = sourceFindings.filter((f) => f.code === code);
    checks.push({
      id: meta.id,
      domain: 'security_safety',
      severity: meta.severity,
      status: hits.length > 0 ? 'fail' : 'pass',
      title: meta.title,
      message: hits.length > 0 ? `${hits.length} unsafe pattern hit(s).` : 'No unsafe patterns detected.',
      evidence: hits.map((f) => `${f.path}: ${f.message}`),
      remediation: 'Remove the unsafe pattern; keep AI/template/manual actions manual and gated.',
    });
  }

  return checks;
}
