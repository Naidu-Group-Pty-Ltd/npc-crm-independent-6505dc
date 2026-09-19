import { describe, expect, it } from 'vitest';
import {
  buildPdfImportReleaseGateReport,
  createPdfImportReleaseGate,
  getDefaultPdfImportReleaseGateDefinitions,
  isBlockingReleaseGate,
  resolvePdfImportReleaseDecision,
  summarizePdfImportReleaseGates,
  type PdfImportReleaseGate,
  type PdfImportReleaseGateCategory,
  type PdfImportReleaseGateStatus,
} from '../ingestion/releaseGates';

const NOW = () => new Date('2026-07-05T00:00:00.000Z');

function gate(
  id: string,
  category: PdfImportReleaseGateCategory,
  status: PdfImportReleaseGateStatus,
  required = true,
): PdfImportReleaseGate {
  return createPdfImportReleaseGate({ id, category, label: id, status, required, message: `${id} message` });
}

/** A full set of passing gates from the defaults, all flipped to pass. */
function allPass(): PdfImportReleaseGate[] {
  return getDefaultPdfImportReleaseGateDefinitions().map((g) => ({
    ...g,
    status: 'pass' as const,
    severity: 'info' as const,
  }));
}

describe('summarizePdfImportReleaseGates', () => {
  it('counts all statuses and required failures/not-run', () => {
    const s = summarizePdfImportReleaseGates([
      gate('a', 'tests', 'pass'),
      gate('b', 'tests', 'warning'),
      gate('c', 'build', 'fail'),
      gate('d', 'sql', 'not_run'),
      gate('e', 'browser', 'not_applicable'),
      gate('f', 'tests', 'fail', false),
    ]);
    expect(s.total).toBe(6);
    expect(s.pass).toBe(1);
    expect(s.warning).toBe(1);
    expect(s.fail).toBe(2);
    expect(s.notRun).toBe(1);
    expect(s.notApplicable).toBe(1);
    expect(s.requiredFailures).toBe(1); // only c (f is optional)
    expect(s.requiredNotRun).toBe(1); // d
  });
});

describe('createPdfImportReleaseGate severity', () => {
  it('sets info for pass', () => {
    expect(gate('a', 'tests', 'pass').severity).toBe('info');
  });
  it('sets blocking for a required fail', () => {
    expect(gate('a', 'build', 'fail').severity).toBe('blocking');
  });
  it('sets warning for an optional fail', () => {
    expect(gate('a', 'tests', 'fail', false).severity).toBe('warning');
  });
  it('sets blocking for a required not_run automated gate', () => {
    expect(gate('a', 'tests', 'not_run').severity).toBe('blocking');
  });
});

describe('resolvePdfImportReleaseDecision + manual pending', () => {
  it('required SQL not_run blocks when allowManualPending is false', () => {
    const gates = [...allPass(), gate('sqlx', 'sql', 'not_run')];
    expect(resolvePdfImportReleaseDecision({ gates, allowManualPending: false })).toBe('release_blocked');
  });
  it('required SQL not_run becomes a warning when allowManualPending is true', () => {
    const gates = [...allPass(), gate('sqlx', 'sql', 'not_run')];
    expect(resolvePdfImportReleaseDecision({ gates, allowManualPending: true })).toBe('release_ready_with_warnings');
  });
  it('required browser not_run becomes a warning when allowManualPending is true', () => {
    const gates = [...allPass(), gate('br', 'browser', 'not_run')];
    expect(resolvePdfImportReleaseDecision({ gates, allowManualPending: true })).toBe('release_ready_with_warnings');
  });
  it('required tests not_run still blocks even when allowManualPending is true', () => {
    const gates = [...allPass(), gate('t', 'tests', 'not_run')];
    expect(resolvePdfImportReleaseDecision({ gates, allowManualPending: true })).toBe('release_blocked');
  });
});

describe('buildPdfImportReleaseGateReport', () => {
  it('is release_ready when all gates pass', () => {
    const report = buildPdfImportReleaseGateReport({ gates: allPass(), now: NOW });
    expect(report.decision).toBe('release_ready');
    expect(report.blockers).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('is release_ready_with_warnings when an optional gate fails', () => {
    const report = buildPdfImportReleaseGateReport({ gates: [...allPass(), gate('opt', 'tests', 'fail', false)], now: NOW });
    expect(report.decision).toBe('release_ready_with_warnings');
    expect(report.warnings.length).toBe(1);
  });

  it('is release_blocked when the required build fails', () => {
    const gates = allPass().map((g) => (g.id === 'npm_build' ? gate('npm_build', 'build', 'fail') : g));
    const report = buildPdfImportReleaseGateReport({ gates, now: NOW });
    expect(report.decision).toBe('release_blocked');
    expect(report.blockers.some((b) => b.startsWith('npm_build'))).toBe(true);
  });

  it('is release_blocked when the private artifact check fails', () => {
    const gates = allPass().map((g) => (g.id === 'private_artifact_check' ? gate('private_artifact_check', 'security', 'fail') : g));
    expect(buildPdfImportReleaseGateReport({ gates, now: NOW }).decision).toBe('release_blocked');
  });

  it('deduplicates warnings and blockers', () => {
    const dup = gate('dupe', 'tests', 'fail');
    const report = buildPdfImportReleaseGateReport({ gates: [dup, { ...dup }], now: NOW });
    expect(report.blockers).toHaveLength(1);
  });

  it('uses now() for generatedAt', () => {
    expect(buildPdfImportReleaseGateReport({ gates: allPass(), now: NOW }).generatedAt).toBe('2026-07-05T00:00:00.000Z');
  });
});

describe('getDefaultPdfImportReleaseGateDefinitions', () => {
  const defs = getDefaultPdfImportReleaseGateDefinitions();
  const ids = defs.map((d) => d.id);

  it('includes npm_build', () => { expect(ids).toContain('npm_build'); });
  it('includes private_artifact_check', () => { expect(ids).toContain('private_artifact_check'); });
  it('includes release_gate_tests', () => { expect(ids).toContain('release_gate_tests'); });
  it('starts every gate as not_run', () => {
    expect(defs.every((d) => d.status === 'not_run')).toBe(true);
  });
});

describe('isBlockingReleaseGate', () => {
  it('is true for a required fail', () => {
    expect(isBlockingReleaseGate(gate('a', 'build', 'fail'))).toBe(true);
  });
  it('is false for an optional warning-level fail', () => {
    expect(isBlockingReleaseGate(gate('a', 'tests', 'fail', false))).toBe(false);
  });
});
