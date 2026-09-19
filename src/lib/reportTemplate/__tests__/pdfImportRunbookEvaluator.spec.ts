import { describe, expect, it } from 'vitest';
import {
  PDF_IMPORT_RUNBOOK_REGISTRY,
  PDF_IMPORT_RUNBOOK_REQUIRED_SECTIONS,
  calculatePdfImportRunbookReadinessScore,
  evaluatePdfImportRunbook,
  evaluatePdfImportRunbookReadiness,
  getPdfImportRunbookById,
  listPdfImportRunbooks,
} from '../ingestion/runbooks';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

function fullContent(): string {
  return PDF_IMPORT_RUNBOOK_REQUIRED_SECTIONS.map((s) => `## ${s}\n\nbody\n`).join('\n');
}

describe('evaluatePdfImportRunbook', () => {
  const runbook = getPdfImportRunbookById('evaluate_only_sop')!;

  it('is missing when content is null/empty', () => {
    expect(evaluatePdfImportRunbook({ runbook, content: null }).status).toBe('missing');
    expect(evaluatePdfImportRunbook({ runbook, content: '   ' }).status).toBe('missing');
  });

  it('is incomplete when required sections are missing', () => {
    const res = evaluatePdfImportRunbook({ runbook, content: '## Purpose\nonly this' });
    expect(res.status).toBe('incomplete');
    expect(res.missingSections.length).toBeGreaterThan(0);
  });

  it('needs review when a placeholder is present', () => {
    const res = evaluatePdfImportRunbook({ runbook, content: `${fullContent()}\n\nTODO: finish` });
    expect(res.status).toBe('needs_review');
  });

  it('is ready when all sections present and no placeholder', () => {
    const res = evaluatePdfImportRunbook({ runbook, content: fullContent() });
    expect(res.status).toBe('ready');
    expect(res.missingSections).toEqual([]);
  });

  it('detects sections case-insensitively', () => {
    const content = PDF_IMPORT_RUNBOOK_REQUIRED_SECTIONS.map((s) => `## ${s.toUpperCase()}`).join('\n');
    expect(evaluatePdfImportRunbook({ runbook, content }).status).toBe('ready');
  });
});

describe('calculatePdfImportRunbookReadinessScore', () => {
  it('subtracts critical/high weights for missing runbooks', () => {
    const results = [
      { id: 'a', title: '', path: '', domain: 'orientation' as const, criticality: 'critical' as const, status: 'missing' as const, missingSections: [], warnings: [] },
      { id: 'b', title: '', path: '', domain: 'orientation' as const, criticality: 'high' as const, status: 'ready' as const, missingSections: [], warnings: [] },
    ];
    expect(calculatePdfImportRunbookReadinessScore(results)).toBe(80);
  });

  it('subtracts half weight for incomplete and 2 for needs_review', () => {
    const results = [
      { id: 'a', title: '', path: '', domain: 'orientation' as const, criticality: 'high' as const, status: 'incomplete' as const, missingSections: ['x'], warnings: [] },
      { id: 'b', title: '', path: '', domain: 'orientation' as const, criticality: 'critical' as const, status: 'needs_review' as const, missingSections: [], warnings: [] },
    ];
    expect(calculatePdfImportRunbookReadinessScore(results)).toBe(93); // 100 - 5 - 2
  });
});

describe('evaluatePdfImportRunbookReadiness', () => {
  it('reports a perfect score when every runbook is complete', () => {
    const runbooks = listPdfImportRunbooks();
    const fileContentsByPath: Record<string, string> = {};
    for (const r of runbooks) fileContentsByPath[r.path] = fullContent();
    const report = evaluatePdfImportRunbookReadiness({ runbooks, fileContentsByPath, now: NOW });
    expect(report.total).toBe(runbooks.length);
    expect(report.ready).toBe(runbooks.length);
    expect(report.score).toBe(100);
    expect(report.criticalMissing).toBe(0);
    expect(report.generatedAt).toBe('2026-07-09T00:00:00.000Z');
  });

  it('counts missing runbooks (no contents supplied)', () => {
    const report = evaluatePdfImportRunbookReadiness({ runbooks: PDF_IMPORT_RUNBOOK_REGISTRY });
    expect(report.missing).toBe(PDF_IMPORT_RUNBOOK_REGISTRY.length);
    expect(report.criticalMissing).toBeGreaterThan(0);
    expect(report.score).toBeLessThan(100);
  });
});
