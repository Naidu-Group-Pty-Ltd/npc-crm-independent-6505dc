import { describe, expect, it } from 'vitest';
import {
  buildGoldenCorpusOrchestratorRequestFromForm,
  createDefaultGoldenCorpusConsoleFormState,
  getGoldenCorpusConsoleResultHeadline,
  getGoldenCorpusConsoleStatusLabel,
  getGoldenCorpusConsoleStatusTone,
  parseGoldenCorpusConsoleNotes,
  validateGoldenCorpusConsoleForm,
  type GoldenCorpusConsoleFormState,
} from '../ingestion/goldenCorpus';

function form(overrides: Partial<GoldenCorpusConsoleFormState> = {}): GoldenCorpusConsoleFormState {
  return createDefaultGoldenCorpusConsoleFormState({ importId: 'import-1', ...overrides });
}

describe('createDefaultGoldenCorpusConsoleFormState', () => {
  it('defaults to golden-simple-001', () => {
    expect(createDefaultGoldenCorpusConsoleFormState().corpusId).toBe('golden-simple-001');
    expect(createDefaultGoldenCorpusConsoleFormState().operatorDecision).toBe('not_reviewed');
  });

  it('accepts overrides', () => {
    const f = createDefaultGoldenCorpusConsoleFormState({ importId: 'x', corpusId: 'golden-ocr-001' });
    expect(f.importId).toBe('x');
    expect(f.corpusId).toBe('golden-ocr-001');
  });
});

describe('parseGoldenCorpusConsoleNotes', () => {
  it('splits newline values', () => {
    expect(parseGoldenCorpusConsoleNotes('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });
  it('removes blank lines', () => {
    expect(parseGoldenCorpusConsoleNotes('a\n\n  \nb')).toEqual(['a', 'b']);
  });
  it('deduplicates', () => {
    expect(parseGoldenCorpusConsoleNotes('a\na\nb')).toEqual(['a', 'b']);
  });
});

describe('validateGoldenCorpusConsoleForm', () => {
  it('errors when corpusId is missing', () => {
    const r = validateGoldenCorpusConsoleForm(form({ corpusId: '' }), 'evaluate_only');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'corpus_id_required')).toBe(true);
  });

  it('errors when corpusId is unknown', () => {
    const r = validateGoldenCorpusConsoleForm(form({ corpusId: 'golden-nope' }), 'evaluate_only');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'corpus_id_unknown')).toBe(true);
  });

  it('errors when importId is missing', () => {
    const r = validateGoldenCorpusConsoleForm(form({ importId: '' }), 'evaluate_only');
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'import_id_required')).toBe(true);
  });

  it('warns when templateId is missing (non-blocking)', () => {
    const r = validateGoldenCorpusConsoleForm(form({ templateId: '' }), 'evaluate_only');
    expect(r.issues.some((i) => i.code === 'template_id_missing' && i.severity === 'warning')).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('warns when persisting with operatorDecision not_reviewed', () => {
    const r = validateGoldenCorpusConsoleForm(form({ operatorDecision: 'not_reviewed' }), 'evaluate_and_persist');
    expect(r.issues.some((i) => i.code === 'operator_not_reviewed')).toBe(true);
  });

  it('warns notes_recommended when rejecting without notes on persist', () => {
    const r = validateGoldenCorpusConsoleForm(form({ operatorDecision: 'rejected', notesText: '' }), 'evaluate_and_persist');
    expect(r.issues.some((i) => i.code === 'notes_recommended')).toBe(true);
  });

  it('warnings do not make ok false', () => {
    const r = validateGoldenCorpusConsoleForm(form({ templateId: '', operatorDecision: 'not_reviewed' }), 'evaluate_and_persist');
    expect(r.issues.some((i) => i.severity === 'warning')).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('errors make ok false', () => {
    const r = validateGoldenCorpusConsoleForm(form({ importId: '', corpusId: '' }), 'evaluate_only');
    expect(r.ok).toBe(false);
  });
});

describe('buildGoldenCorpusOrchestratorRequestFromForm', () => {
  it('trims fields', () => {
    const req = buildGoldenCorpusOrchestratorRequestFromForm(
      form({ corpusId: '  golden-simple-001 ', importId: '  import-1 ' }),
      'evaluate_only',
    );
    expect(req.corpusId).toBe('golden-simple-001');
    expect(req.importId).toBe('import-1');
  });

  it('sets persist false for evaluate_only and true for evaluate_and_persist', () => {
    expect(buildGoldenCorpusOrchestratorRequestFromForm(form(), 'evaluate_only').persist).toBe(false);
    expect(buildGoldenCorpusOrchestratorRequestFromForm(form(), 'evaluate_and_persist').persist).toBe(true);
  });

  it('converts blank optional fields to null', () => {
    const req = buildGoldenCorpusOrchestratorRequestFromForm(form({ templateId: '', runId: '  ', runBatchId: '' }), 'evaluate_only');
    expect(req.templateId).toBeNull();
    expect(req.runId).toBeNull();
    expect(req.runBatchId).toBeNull();
  });

  it('carries parsed notes', () => {
    const req = buildGoldenCorpusOrchestratorRequestFromForm(form({ notesText: 'a\nb\nb' }), 'evaluate_only');
    expect(req.notes).toEqual(['a', 'b']);
  });
});

describe('console status/headline helpers', () => {
  it('status label maps completed_with_warnings', () => {
    expect(getGoldenCorpusConsoleStatusLabel('completed_with_warnings')).toBe('Completed with warnings');
    expect(getGoldenCorpusConsoleStatusLabel(null)).toBe('Not run');
  });

  it('status tone maps failed/blocked to destructive', () => {
    expect(getGoldenCorpusConsoleStatusTone('failed')).toBe('destructive');
    expect(getGoldenCorpusConsoleStatusTone('blocked')).toBe('destructive');
    expect(getGoldenCorpusConsoleStatusTone('completed')).toBe('default');
  });

  it('headline returns correct text for null/completed/failed', () => {
    expect(getGoldenCorpusConsoleResultHeadline(null)).toBe('No run yet.');
    expect(getGoldenCorpusConsoleResultHeadline({ status: 'completed' } as any)).toBe('Golden regression completed.');
    expect(getGoldenCorpusConsoleResultHeadline({ status: 'failed' } as any)).toBe('Golden regression failed.');
  });
});

describe('Phase 9D export parity form options', () => {
  it('defaults runExportParity false and persistExportParity true', () => {
    const f = createDefaultGoldenCorpusConsoleFormState();
    expect(f.runExportParity).toBe(false);
    expect(f.persistExportParity).toBe(true);
  });

  it('build request includes runExportParity and gates persistExportParity behind it', () => {
    const withRun = buildGoldenCorpusOrchestratorRequestFromForm(
      form({ runExportParity: true, persistExportParity: true }), 'evaluate_and_persist');
    expect(withRun.runExportParity).toBe(true);
    expect(withRun.persistExportParity).toBe(true);

    const noRun = buildGoldenCorpusOrchestratorRequestFromForm(
      form({ runExportParity: false, persistExportParity: true }), 'evaluate_and_persist');
    expect(noRun.runExportParity).toBe(false);
    expect(noRun.persistExportParity).toBe(false);
  });

  it('warns when persistExportParity is on but runExportParity is off', () => {
    const r = validateGoldenCorpusConsoleForm(form({ runExportParity: false, persistExportParity: true }), 'evaluate_only');
    expect(r.issues.some((i) => i.code === 'export_parity_persist_without_run')).toBe(true);
  });
});

describe('Phase 10E self-healing form options', () => {
  it('defaults buildSelfHealingPlan false, persist true, mode dry_run, unconfirmed', () => {
    const f = createDefaultGoldenCorpusConsoleFormState();
    expect(f.buildSelfHealingPlan).toBe(false);
    expect(f.persistSelfHealingAudit).toBe(true);
    expect(f.selfHealingMode).toBe('dry_run');
    expect(f.selfHealingOperatorConfirmed).toBe(false);
  });

  it('maps mode + operator confirmation and gates persistence behind build + persist mode', () => {
    const on = buildGoldenCorpusOrchestratorRequestFromForm(
      form({ buildSelfHealingPlan: true, persistSelfHealingAudit: true, selfHealingMode: 'execute_confirmed', selfHealingOperatorConfirmed: true }),
      'evaluate_and_persist');
    expect(on.buildSelfHealingPlan).toBe(true);
    expect(on.persistSelfHealingAudit).toBe(true);
    expect(on.executeSelfHealingMode).toBe('execute_confirmed');
    expect(on.selfHealingOperatorConfirmed).toBe(true);

    // Evaluate-only never persists the audit.
    const evalOnly = buildGoldenCorpusOrchestratorRequestFromForm(
      form({ buildSelfHealingPlan: true, persistSelfHealingAudit: true }), 'evaluate_only');
    expect(evalOnly.persistSelfHealingAudit).toBe(false);

    // Persist requires build.
    const noBuild = buildGoldenCorpusOrchestratorRequestFromForm(
      form({ buildSelfHealingPlan: false, persistSelfHealingAudit: true }), 'evaluate_and_persist');
    expect(noBuild.persistSelfHealingAudit).toBe(false);
  });

  it('warns when persistSelfHealingAudit is on but buildSelfHealingPlan is off', () => {
    const r = validateGoldenCorpusConsoleForm(form({ buildSelfHealingPlan: false, persistSelfHealingAudit: true }), 'evaluate_only');
    expect(r.issues.some((i) => i.code === 'self_healing_persist_without_build')).toBe(true);
  });

  it('warns when execute_confirmed is selected without operator confirmation', () => {
    const r = validateGoldenCorpusConsoleForm(
      form({ buildSelfHealingPlan: true, selfHealingMode: 'execute_confirmed', selfHealingOperatorConfirmed: false }), 'evaluate_only');
    expect(r.issues.some((i) => i.code === 'self_healing_confirmation_missing')).toBe(true);
  });
});

describe('Phase 10F performance/cost form options', () => {
  it('defaults buildPerformanceCostAudit true and persist true', () => {
    const f = createDefaultGoldenCorpusConsoleFormState();
    expect(f.buildPerformanceCostAudit).toBe(true);
    expect(f.persistPerformanceCostAudit).toBe(true);
  });

  it('gates persistence behind build + persist mode', () => {
    const on = buildGoldenCorpusOrchestratorRequestFromForm(
      form({ buildPerformanceCostAudit: true, persistPerformanceCostAudit: true }), 'evaluate_and_persist');
    expect(on.buildPerformanceCostAudit).toBe(true);
    expect(on.persistPerformanceCostAudit).toBe(true);

    // Evaluate-only never persists the audit but still builds it.
    const evalOnly = buildGoldenCorpusOrchestratorRequestFromForm(
      form({ buildPerformanceCostAudit: true, persistPerformanceCostAudit: true }), 'evaluate_only');
    expect(evalOnly.buildPerformanceCostAudit).toBe(true);
    expect(evalOnly.persistPerformanceCostAudit).toBe(false);

    // Persist requires build.
    const noBuild = buildGoldenCorpusOrchestratorRequestFromForm(
      form({ buildPerformanceCostAudit: false, persistPerformanceCostAudit: true }), 'evaluate_and_persist');
    expect(noBuild.persistPerformanceCostAudit).toBe(false);
  });

  it('warns when persistPerformanceCostAudit is on but buildPerformanceCostAudit is off', () => {
    const r = validateGoldenCorpusConsoleForm(form({ buildPerformanceCostAudit: false, persistPerformanceCostAudit: true }), 'evaluate_only');
    expect(r.issues.some((i) => i.code === 'performance_cost_persist_without_build')).toBe(true);
  });
});

describe('Phase 10G operator controls form options', () => {
  it('defaults buildOperatorControls true and persist true', () => {
    const f = createDefaultGoldenCorpusConsoleFormState();
    expect(f.buildOperatorControls).toBe(true);
    expect(f.persistOperatorControlAudit).toBe(true);
  });

  it('gates persistence behind build + persist mode', () => {
    const on = buildGoldenCorpusOrchestratorRequestFromForm(
      form({ buildOperatorControls: true, persistOperatorControlAudit: true }), 'evaluate_and_persist');
    expect(on.buildOperatorControls).toBe(true);
    expect(on.persistOperatorControlAudit).toBe(true);

    const evalOnly = buildGoldenCorpusOrchestratorRequestFromForm(
      form({ buildOperatorControls: true, persistOperatorControlAudit: true }), 'evaluate_only');
    expect(evalOnly.buildOperatorControls).toBe(true);
    expect(evalOnly.persistOperatorControlAudit).toBe(false);

    const noBuild = buildGoldenCorpusOrchestratorRequestFromForm(
      form({ buildOperatorControls: false, persistOperatorControlAudit: true }), 'evaluate_and_persist');
    expect(noBuild.persistOperatorControlAudit).toBe(false);
  });

  it('warns when persistOperatorControlAudit is on but buildOperatorControls is off', () => {
    const r = validateGoldenCorpusConsoleForm(form({ buildOperatorControls: false, persistOperatorControlAudit: true }), 'evaluate_only');
    expect(r.issues.some((i) => i.code === 'operator_controls_persist_without_build')).toBe(true);
  });
});
