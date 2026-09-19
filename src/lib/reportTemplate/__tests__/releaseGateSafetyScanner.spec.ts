import { describe, expect, it } from 'vitest';
import {
  buildSafetyScanGateResults,
  getPdfImportPrivateArtifactPatterns,
  scanPdfImportPrivateArtifacts,
  scanPdfImportUnsafeSourcePatterns,
} from '../ingestion/releaseGate';

function reader(map: Record<string, string>) {
  return (abs: string) => {
    for (const [rel, content] of Object.entries(map)) {
      if (abs.endsWith(rel)) return content;
    }
    return null;
  };
}

describe('scanPdfImportPrivateArtifacts', () => {
  it('detects a staged PDF', () => {
    const f = scanPdfImportPrivateArtifacts(['reports/sample.pdf']);
    expect(f[0].code).toBe('private_pdf');
  });
  it('detects a staged PNG', () => {
    const f = scanPdfImportPrivateArtifacts(['shots/render.png']);
    expect(f[0].code).toBe('private_image');
  });
  it('detects a .env file', () => {
    const f = scanPdfImportPrivateArtifacts(['.env']);
    expect(f[0].code).toBe('private_log_or_env');
  });
  it('detects a log file', () => {
    const f = scanPdfImportPrivateArtifacts(['logs/run.log']);
    expect(f[0].code).toBe('private_log_or_env');
  });
  it('detects a signed url dump', () => {
    const f = scanPdfImportPrivateArtifacts(['dumps/signed-url-list.txt']);
    expect(f[0].code).toBe('signed_url_or_log_dump');
  });
  it('ignores a safe source file', () => {
    expect(scanPdfImportPrivateArtifacts(['src/foo.ts'])).toEqual([]);
  });
  it('exposes the artifact pattern list', () => {
    expect(getPdfImportPrivateArtifactPatterns()).toContain('.pdf');
    expect(getPdfImportPrivateArtifactPatterns()).toContain('audit-output/');
  });
});

describe('scanPdfImportUnsafeSourcePatterns', () => {
  it('detects a service-role secret in frontend source', () => {
    const findings = scanPdfImportUnsafeSourcePatterns({
      rootDir: '/r',
      filePaths: ['src/lib/foo.ts'],
      readFile: reader({ 'src/lib/foo.ts': 'const k = env("SUPABASE_SERVICE_ROLE_KEY");' }),
    });
    expect(findings.some((f) => f.code === 'service_role_secret_frontend')).toBe(true);
  });

  it('detects an automatic AI execution pattern in self-healing source', () => {
    const p = 'src/lib/reportTemplate/ingestion/selfHealing/selfHealingExecutor.ts';
    const findings = scanPdfImportUnsafeSourcePatterns({
      rootDir: '/r',
      filePaths: [p],
      readFile: reader({ [p]: 'function run(){ autoRunAiReconciliation(); }' }),
    });
    expect(findings.some((f) => f.code === 'automatic_ai_execution')).toBe(true);
  });

  it('detects applyTemplateImportPlan inside an unsafe executor', () => {
    const p = 'src/lib/reportTemplate/ingestion/operatorControls/operatorControlExecutor.ts';
    const findings = scanPdfImportUnsafeSourcePatterns({
      rootDir: '/r',
      filePaths: [p],
      readFile: reader({ [p]: 'const t = applyTemplateImportPlan(plan);' }),
    });
    expect(findings.some((f) => f.code === 'automatic_template_mutation')).toBe(true);
  });

  it('does NOT flag applyTemplateImportPlan in a normal orchestration file', () => {
    const p = 'src/lib/reportTemplate/ingestion/importOrchestrator.ts';
    const findings = scanPdfImportUnsafeSourcePatterns({
      rootDir: '/r',
      filePaths: [p],
      readFile: reader({ [p]: 'const t = applyTemplateImportPlan(plan);' }),
    });
    expect(findings).toEqual([]);
  });

  it('ignores a safe source file', () => {
    const findings = scanPdfImportUnsafeSourcePatterns({
      rootDir: '/r',
      filePaths: ['src/safe.ts'],
      readFile: reader({ 'src/safe.ts': 'export const x = 1;' }),
    });
    expect(findings).toEqual([]);
  });

  it('excludes docs and tests when scanning', () => {
    const findings = scanPdfImportUnsafeSourcePatterns({
      rootDir: '/r',
      filePaths: ['docs/thing.md', 'src/lib/__tests__/x.spec.ts'],
      readFile: reader({
        'docs/thing.md': 'SUPABASE_SERVICE_ROLE_KEY',
        'src/lib/__tests__/x.spec.ts': 'SUPABASE_SERVICE_ROLE_KEY',
      }),
    });
    expect(findings).toEqual([]);
  });

  it('excludes the releaseGate module (its own pattern data)', () => {
    const p = 'src/lib/reportTemplate/ingestion/releaseGate/releaseGateSafetyScanner.ts';
    const findings = scanPdfImportUnsafeSourcePatterns({
      rootDir: '/r',
      filePaths: [p],
      readFile: reader({ [p]: 'SUPABASE_SERVICE_ROLE_KEY bypassQualityGate' }),
    });
    expect(findings).toEqual([]);
  });
});

describe('a committed asset is not a generated artifact', () => {
  /* The classification was the extension alone, which made a brand asset
     unlandable: `public/brand/aurixa-emblem-240.png` had been corrupted on a
     downstream clone and the repair could not merge, because the pull request
     carrying it failed `[critical] no_generated_images_staged` — naming a file
     that is supposed to be in the repository. */
  it('passes a raster inside a shipped asset tree', () => {
    expect(
      scanPdfImportPrivateArtifacts([
        'public/brand/aurixa-emblem-240.png',
        'public/icons/icon-512.png',
        'public/templates/npc-qa-content.jpg',
        'src/assets/brands/logo.webp',
      ]),
    ).toEqual([]);
  });

  it('still fails a raster anywhere else', () => {
    /* A scratch file left in `reports/`, `tmp/` or the repository root is the
       quiet slip this rule is aimed at, and prime already carries one such
       stray at its root. */
    const findings = scanPdfImportPrivateArtifacts([
      'reports/page-3.png',
      'tmp/render.jpg',
      'final.png',
    ]);
    expect(findings.map((f) => f.path)).toEqual(['reports/page-3.png', 'tmp/render.jpg', 'final.png']);
    expect(findings.every((f) => f.code === 'private_image')).toBe(true);
  });

  it('never exempts a PDF, even in an asset tree', () => {
    /* A PDF under `public/` is not a brand asset — it is a document published
       to the internet, which is the more serious version of what this catches. */
    const findings = scanPdfImportPrivateArtifacts(['public/brand/client-report.pdf']);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('private_pdf');
    expect(findings[0].severity).toBe('critical');
  });

  it('exempts the tree, not the extension — a log in public/ still fails', () => {
    const findings = scanPdfImportPrivateArtifacts(['public/debug.log']);
    expect(findings[0]?.code).toBe('private_log_or_env');
  });
});

describe('buildSafetyScanGateResults', () => {
  it('builds passing checks with no findings and failing checks with findings', () => {
    const checks = buildSafetyScanGateResults({
      artifactFindings: [{ code: 'private_pdf', path: 'a.pdf', severity: 'critical', message: 'x' }],
      sourceFindings: [{ code: 'quality_gate_bypass', path: 'src/x.ts', severity: 'critical', message: 'y' }],
    });
    const pdf = checks.find((c) => c.id === 'no_private_pdfs_staged');
    const bypass = checks.find((c) => c.id === 'no_quality_gate_bypass_pattern');
    const images = checks.find((c) => c.id === 'no_generated_images_staged');
    expect(pdf?.status).toBe('fail');
    expect(pdf?.evidence).toContain('a.pdf');
    expect(bypass?.status).toBe('fail');
    expect(images?.status).toBe('pass');
  });
});
