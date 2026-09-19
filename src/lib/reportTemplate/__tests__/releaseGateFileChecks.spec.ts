import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildFileCheckGateResults,
  checkRequiredPdfImportFiles,
  getRequiredPdfImportReleaseGateFiles,
} from '../ingestion/releaseGate';

const root = mkdtempSync(join(tmpdir(), 'release-gate-files-'));

function touch(rel: string) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, '// test\n');
}

describe('releaseGateFileChecks', () => {
  it('required files list includes phase docs', () => {
    const files = getRequiredPdfImportReleaseGateFiles();
    expect(files.some((f) => f.includes('phase-11d-release-gate-ci-integration.md'))).toBe(true);
    expect(files.some((f) => f.includes('phase-11a-production-rollout-readiness-review.md'))).toBe(true);
  });

  it('required files list includes the monitoring function', () => {
    const files = getRequiredPdfImportReleaseGateFiles();
    expect(files).toContain('supabase/functions/pdf-import-monitoring/index.ts');
  });

  it('reports exists false for a missing file', () => {
    const results = checkRequiredPdfImportFiles({ rootDir: root, requiredFiles: ['does/not/exist.ts'] });
    expect(results[0]).toEqual({ path: 'does/not/exist.ts', exists: false });
  });

  it('reports exists true for an existing file', () => {
    touch('present/file.ts');
    const results = checkRequiredPdfImportFiles({ rootDir: root, requiredFiles: ['present/file.ts'] });
    expect(results[0].exists).toBe(true);
  });

  it('buildFileCheckGateResults fails a missing critical file', () => {
    const critical = 'src/lib/reportTemplate/ingestion/operatorPermissions/operatorPermissionMatrix.ts';
    const results = buildFileCheckGateResults({ rootDir: root, requiredFiles: [critical] });
    expect(results[0].status).toBe('fail');
    expect(results[0].severity).toBe('critical');
    expect(results[0].id).toBe(`file_exists:${critical}`);
  });

  it('passes when all required files exist in a temp dir', () => {
    const required = ['docs/pdf-import/x.md', 'scripts/regression/y.mjs'];
    required.forEach(touch);
    const results = buildFileCheckGateResults({ rootDir: root, requiredFiles: required });
    expect(results.every((r) => r.status === 'pass')).toBe(true);
  });

  it('supports an injected existence probe', () => {
    const results = checkRequiredPdfImportFiles({
      rootDir: '/whatever',
      requiredFiles: ['a', 'b'],
      fileExists: (p) => p.endsWith('a'),
    });
    expect(results.find((r) => r.path === 'a')?.exists).toBe(true);
    expect(results.find((r) => r.path === 'b')?.exists).toBe(false);
  });
});

afterAll(() => {
  // temp dir is left for the OS to reclaim; nothing to clean deterministically.
});
