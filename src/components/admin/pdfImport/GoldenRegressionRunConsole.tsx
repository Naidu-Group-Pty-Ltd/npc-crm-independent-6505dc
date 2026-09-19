/**
 * GoldenRegressionRunConsole — Phase 9B.
 *
 * Operator console that drives the Phase 9A orchestrator (`orchestrateGoldenCorpusRun`)
 * in evaluate_only and evaluate_and_persist modes. It never uploads PDFs or imports files;
 * it evaluates an existing import ID. Evaluate Only is read-only; Evaluate + Persist writes
 * `golden_regression_summary` to `template_imports.meta` (behind an explicit confirmation).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Play, Save, RotateCcw, Copy, ShieldCheck, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DEFAULT_GOLDEN_CORPUS_REGISTRY,
  GOLDEN_CORPUS_CONSOLE_OPERATOR_DECISIONS,
  buildGoldenCorpusOrchestratorRequestFromForm,
  createDefaultGoldenCorpusConsoleFormState,
  getGoldenCorpusConsoleResultHeadline,
  getGoldenCorpusConsoleStatusTone,
  getGoldenCorpusItem,
  orchestrateGoldenCorpusRun,
  validateGoldenCorpusConsoleForm,
  type GoldenCorpusConsoleFormState,
  type GoldenCorpusConsoleMode,
  type GoldenCorpusOrchestratorResult,
} from '@/lib/reportTemplate/ingestion/goldenCorpus';
import { GoldenRegressionSnapshotPanel } from './GoldenRegressionSnapshotPanel';
import { GoldenRegressionResultPanel } from './GoldenRegressionResultPanel';
import { GoldenRegressionQualityGatePanel } from './GoldenRegressionQualityGatePanel';
import { GoldenRegressionTriagePanel } from './GoldenRegressionTriagePanel';
import { GoldenRegressionHistoryPanel } from './GoldenRegressionHistoryPanel';
import { AutomatedExportParityPanel } from './AutomatedExportParityPanel';
import { SelfHealingRetryPanel } from './SelfHealingRetryPanel';
import { PerformanceCostAuditPanel } from './PerformanceCostAuditPanel';
import { ProductionOperatorControlsPanel } from './ProductionOperatorControlsPanel';
import { OperatorPermissionStatusPanel } from './OperatorPermissionStatusPanel';
import {
  executeOperatorControl,
  saveProductionOperatorControlAudit,
  type OperatorControlExecutionResult,
} from '@/lib/reportTemplate/ingestion/operatorControls';
import { usePdfImportPermissions } from '@/hooks/usePdfImportPermissions';
import type { PdfImportCapability } from '@/lib/reportTemplate/ingestion/operatorPermissions';

interface GoldenRegressionRunConsoleProps {
  initialCorpusId?: string | null;
  initialImportId?: string | null;
  initialTemplateId?: string | null;
}

export function GoldenRegressionRunConsole({
  initialCorpusId,
  initialImportId,
  initialTemplateId,
}: GoldenRegressionRunConsoleProps) {
  const initialForm = useMemo(
    () =>
      createDefaultGoldenCorpusConsoleFormState({
        corpusId: initialCorpusId && getGoldenCorpusItem(initialCorpusId) ? initialCorpusId : 'golden-simple-001',
        importId: initialImportId ?? '',
        templateId: initialTemplateId ?? '',
      }),
    [initialCorpusId, initialImportId, initialTemplateId],
  );

  const [form, setForm] = useState<GoldenCorpusConsoleFormState>(initialForm);
  const [result, setResult] = useState<GoldenCorpusOrchestratorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmPersistOpen, setConfirmPersistOpen] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const setField = (field: keyof GoldenCorpusConsoleFormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));
  const setBool = (field: keyof GoldenCorpusConsoleFormState, value: boolean) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const evalValidation = useMemo(() => validateGoldenCorpusConsoleForm(form, 'evaluate_only'), [form]);
  const persistValidation = useMemo(() => validateGoldenCorpusConsoleForm(form, 'evaluate_and_persist'), [form]);
  const corpusItem = useMemo(() => getGoldenCorpusItem(form.corpusId), [form.corpusId]);

  // Phase 11B — resolve the current user's PDF import role and gate write actions.
  const { resolvedRole, allows } = usePdfImportPermissions();
  const canEvaluate = allows('pdf_import.evaluate_only')
    && (!form.runExportParity || allows('pdf_import.run_export_parity_automation'));

  const missingPersistCapabilities = useMemo(() => {
    const required: Array<[boolean, PdfImportCapability, string]> = [
      [true, 'pdf_import.persist_golden_summary', 'Persist golden regression summary'],
      [form.saveHistory, 'pdf_import.persist_golden_history', 'Save golden run history'],
      [form.persistImportIntelligenceProfile && form.buildImportIntelligenceProfile, 'pdf_import.persist_import_intelligence', 'Persist import intelligence profile'],
      [form.persistRepairPatternAnalysis && form.buildRepairPatternAnalysis, 'pdf_import.persist_repair_patterns', 'Persist repair pattern analysis'],
      [form.persistAdaptiveReconciliationPolicy && form.buildAdaptiveReconciliationPolicy, 'pdf_import.persist_adaptive_policy', 'Persist adaptive reconciliation policy'],
      [form.persistSelfHealingAudit && form.buildSelfHealingPlan, 'pdf_import.persist_self_healing_audit', 'Persist self-healing audit'],
      [form.persistPerformanceCostAudit && form.buildPerformanceCostAudit, 'pdf_import.persist_performance_audit', 'Persist performance/cost audit'],
      [form.persistOperatorControlAudit && form.buildOperatorControls, 'pdf_import.persist_operator_control_audit', 'Persist operator control audit'],
      [form.runExportParity && form.persistExportParity, 'pdf_import.persist_export_parity', 'Persist export parity'],
      [form.runExportParity, 'pdf_import.run_export_parity_automation', 'Run export parity automation'],
    ];
    const missing: string[] = [];
    for (const [selected, cap, label] of required) {
      if (selected && !allows(cap)) missing.push(label);
    }
    return missing;
  }, [form, allows]);
  const canPersist = missingPersistCapabilities.length === 0;

  const errors = persistValidation.issues.filter((i) => i.severity === 'error');
  const persistWarnings = persistValidation.issues.filter((i) => i.severity === 'warning');

  const run = async (mode: GoldenCorpusConsoleMode) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const request = buildGoldenCorpusOrchestratorRequestFromForm(form, mode);
      const orchestratorResult = await orchestrateGoldenCorpusRun({ request });
      setResult(orchestratorResult);
      if (orchestratorResult.historySaved) setHistoryRefreshKey((k) => k + 1);
      if (mode === 'evaluate_and_persist') {
        if (orchestratorResult.persisted) toast.success('Golden regression summary persisted.');
        else toast.error(`Persistence did not complete (${orchestratorResult.status}).`);
        if (orchestratorResult.historySaved) toast.success('Run saved to history ledger.');
        else if (orchestratorResult.historyPersistenceResult?.kind === 'error') {
          toast.error(`History save failed: ${orchestratorResult.historyPersistenceResult.message}`);
        }
      } else {
        toast.success(`Evaluated: ${orchestratorResult.status}.`);
      }
      if (orchestratorResult.baselineComparison?.outcome === 'degraded') {
        toast.warning('Baseline regression detected vs previous run.');
      }
    } catch (err) {
      const message = (err as Error).message ?? 'Unexpected orchestrator error.';
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const onEvaluateOnly = () => {
    if (!evalValidation.ok) return;
    if (!canEvaluate) { toast.error('Your role does not allow Evaluate Only.'); return; }
    void run('evaluate_only');
  };

  const onEvaluateAndPersist = () => {
    if (!persistValidation.ok) return;
    if (!canPersist) { toast.error(`Missing permission to persist: ${missingPersistCapabilities.join(', ')}.`); return; }
    setConfirmPersistOpen(true);
  };

  const onConfirmPersist = async () => {
    setConfirmPersistOpen(false);
    await run('evaluate_and_persist');
  };

  const onReset = () => {
    setForm(initialForm);
    setResult(null);
    setErrorMessage(null);
  };

  const onCopyJson = async () => {
    if (!result) return;
    try {
      await navigator.clipboard?.writeText(JSON.stringify(result, null, 2));
      toast.success('Result JSON copied.');
    } catch {
      toast.error('Clipboard not available.');
    }
  };

  const CONSOLE_OPTION_FOR_CONTROL: Record<string, keyof GoldenCorpusConsoleFormState> = {
    build_import_intelligence_profile: 'buildImportIntelligenceProfile',
    build_repair_pattern_analysis: 'buildRepairPatternAnalysis',
    build_adaptive_reconciliation_policy: 'buildAdaptiveReconciliationPolicy',
    build_self_healing_plan: 'buildSelfHealingPlan',
    build_performance_cost_audit: 'buildPerformanceCostAudit',
    run_export_parity_automation: 'runExportParity',
  };

  const handleEnableConsoleOption = (controlId: string) => {
    const field = CONSOLE_OPTION_FOR_CONTROL[controlId];
    if (!field) {
      toast.info('Use the run console options and re-run Evaluate to perform this action.');
      return;
    }
    setBool(field, true);
    toast.success(`Enabled "${field}". Re-run Evaluate Only to apply.`);
  };

  const CONFIRM_CONTROLS = new Set([
    'mark_accepted', 'mark_accepted_with_warnings', 'mark_rejected', 'mark_needs_rerun',
    'mark_manual_review_required', 'mark_blocked',
  ]);

  const handleExecuteMetadataControl = async (
    controlId: string,
    note?: string,
  ): Promise<OperatorControlExecutionResult | null> => {
    if (!result?.importId) {
      toast.error('No import ID available for operator controls.');
      return null;
    }
    if (CONFIRM_CONTROLS.has(controlId)) {
      const ok = typeof window === 'undefined' || window.confirm(`Apply operator control "${controlId}"?`);
      if (!ok) return null;
    }
    try {
      const execResult = await executeOperatorControl({
        request: {
          importId: result.importId,
          templateId: result.templateId,
          controlId: controlId as any,
          note: note ?? null,
          operatorConfirmed: true,
          resolvedRole,
        },
        currentAudit: result.productionOperatorControlAudit,
      });
      const patchedAudit = (execResult.metadataPatch?.production_operator_control_audit ?? null) as
        | typeof result.productionOperatorControlAudit
        | null;
      if (execResult.status === 'completed' && patchedAudit) {
        const saveRes = await saveProductionOperatorControlAudit(result.importId, patchedAudit);
        setResult((prev) => (prev ? {
          ...prev,
          productionOperatorControlAudit: { ...patchedAudit, persistedAt: saveRes.kind === 'ok' ? new Date().toISOString() : patchedAudit.persistedAt },
          productionOperatorControlAuditPersistenceResult: saveRes,
        } : prev));
        if (saveRes.kind === 'ok') toast.success(`Operator control "${controlId}" saved.`);
        else toast.error(`Save failed: ${saveRes.message}`);
      } else if (execResult.status !== 'completed') {
        toast.error(`Control not applied (${execResult.status}): ${execResult.message}`);
      }
      return execResult;
    } catch (err) {
      toast.error((err as Error).message);
      return null;
    }
  };

  const snapshot = result?.runEvaluation?.snapshot ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> Golden Regression Run Console
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Evaluate and optionally persist a golden corpus regression result for an existing PDF import.
          </p>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertTitle>Read-only unless you persist</AlertTitle>
            <AlertDescription className="text-xs">
              This console does not upload PDFs or import files. It only evaluates an existing import ID.
              <strong> Evaluate Only</strong> is read-only. <strong>Evaluate + Persist</strong> writes
              <code className="mx-1">golden_regression_summary</code> to <code>template_imports.meta</code>.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <OperatorPermissionStatusPanel resolvedRole={resolvedRole} />

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Run inputs</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="corpusId">Corpus item</Label>
              <Select value={form.corpusId} onValueChange={(v) => setField('corpusId', v)}>
                <SelectTrigger id="corpusId"><SelectValue placeholder="Select a corpus item" /></SelectTrigger>
                <SelectContent>
                  {DEFAULT_GOLDEN_CORPUS_REGISTRY.corpus.map((c) => (
                    <SelectItem key={c.corpusId} value={c.corpusId}>{c.corpusId} — {c.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="operatorDecision">Operator decision</Label>
              <Select value={form.operatorDecision} onValueChange={(v) => setField('operatorDecision', v)}>
                <SelectTrigger id="operatorDecision"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GOLDEN_CORPUS_CONSOLE_OPERATOR_DECISIONS.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="importId">Import ID</Label>
              <Input id="importId" value={form.importId} onChange={(e) => setField('importId', e.target.value)}
                placeholder="template_imports.id" className="font-mono text-xs" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="templateId">Template ID (optional)</Label>
              <Input id="templateId" value={form.templateId} onChange={(e) => setField('templateId', e.target.value)}
                placeholder="report_templates.id" className="font-mono text-xs" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="runId">Run ID (optional)</Label>
              <Input id="runId" value={form.runId} onChange={(e) => setField('runId', e.target.value)}
                placeholder="auto-generated if blank" className="font-mono text-xs" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="runBatchId">Run batch ID (optional)</Label>
              <Input id="runBatchId" value={form.runBatchId} onChange={(e) => setField('runBatchId', e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea id="notes" value={form.notesText} onChange={(e) => setField('notesText', e.target.value)}
              placeholder="One note per line." rows={3} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="compareBaseline" className="text-sm">Compare with latest baseline</Label>
                <p className="text-xs text-muted-foreground">Read-only: compares against the previous run for this corpus.</p>
              </div>
              <Switch id="compareBaseline" checked={form.compareBaseline}
                onCheckedChange={(v) => setBool('compareBaseline', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="saveHistory" className="text-sm">Save history when persisting</Label>
                <p className="text-xs text-muted-foreground">Appends a row to <code>pdf_import_golden_runs</code> on Evaluate + Persist.</p>
              </div>
              <Switch id="saveHistory" checked={form.saveHistory}
                onCheckedChange={(v) => setBool('saveHistory', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="runExportParity" className="text-sm">Run export parity automation before evaluation</Label>
                <p className="text-xs text-muted-foreground">Reuses Visual QA evidence to build an export parity summary before quality gates.</p>
              </div>
              <Switch id="runExportParity" checked={form.runExportParity}
                onCheckedChange={(v) => setBool('runExportParity', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="persistExportParity" className="text-sm">Persist export parity result</Label>
                <p className="text-xs text-muted-foreground">Writes <code>export_parity_summary</code> to <code>template_imports.meta</code> when the runner can build one.</p>
              </div>
              <Switch id="persistExportParity" checked={form.persistExportParity} disabled={!form.runExportParity}
                onCheckedChange={(v) => setBool('persistExportParity', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="buildImportIntelligenceProfile" className="text-sm">Build import intelligence profile</Label>
                <p className="text-xs text-muted-foreground">Deterministically classifies document type, complexity, and risk. Read-only unless persistence is enabled.</p>
              </div>
              <Switch id="buildImportIntelligenceProfile" checked={form.buildImportIntelligenceProfile}
                onCheckedChange={(v) => setBool('buildImportIntelligenceProfile', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="persistImportIntelligenceProfile" className="text-sm">Persist import intelligence profile</Label>
                <p className="text-xs text-muted-foreground">Stores a safe structured profile in <code>template_imports.meta.import_intelligence_profile</code> (only when persisting the run). Does not store raw PDF contents.</p>
              </div>
              <Switch id="persistImportIntelligenceProfile" checked={form.persistImportIntelligenceProfile} disabled={!form.buildImportIntelligenceProfile}
                onCheckedChange={(v) => setBool('persistImportIntelligenceProfile', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="buildRepairPatternAnalysis" className="text-sm">Build repair pattern analysis</Label>
                <p className="text-xs text-muted-foreground">Deterministically classifies repair issues into known patterns. Read-only and advisory; never applies repairs.</p>
              </div>
              <Switch id="buildRepairPatternAnalysis" checked={form.buildRepairPatternAnalysis}
                onCheckedChange={(v) => setBool('buildRepairPatternAnalysis', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="persistRepairPatternAnalysis" className="text-sm">Persist repair pattern analysis</Label>
                <p className="text-xs text-muted-foreground">Stores safe structured repair pattern metadata in <code>template_imports.meta.repair_pattern_analysis</code> (only when persisting the run). Does not apply repairs or mutate templates.</p>
              </div>
              <Switch id="persistRepairPatternAnalysis" checked={form.persistRepairPatternAnalysis} disabled={!form.buildRepairPatternAnalysis}
                onCheckedChange={(v) => setBool('persistRepairPatternAnalysis', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="buildAdaptiveReconciliationPolicy" className="text-sm">Build adaptive reconciliation policy</Label>
                <p className="text-xs text-muted-foreground">Deterministically decides whether AI reconciliation is not needed, optional, recommended, manual-review, or blocked. It does not call AI or apply changes.</p>
              </div>
              <Switch id="buildAdaptiveReconciliationPolicy" checked={form.buildAdaptiveReconciliationPolicy}
                onCheckedChange={(v) => setBool('buildAdaptiveReconciliationPolicy', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="persistAdaptiveReconciliationPolicy" className="text-sm">Persist adaptive reconciliation policy</Label>
                <p className="text-xs text-muted-foreground">Stores safe structured policy metadata in <code>template_imports.meta.adaptive_reconciliation_policy</code> (only when persisting the run). It does not run AI reconciliation or apply template changes.</p>
              </div>
              <Switch id="persistAdaptiveReconciliationPolicy" checked={form.persistAdaptiveReconciliationPolicy} disabled={!form.buildAdaptiveReconciliationPolicy}
                onCheckedChange={(v) => setBool('persistAdaptiveReconciliationPolicy', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="buildSelfHealingPlan" className="text-sm">Build self-healing retry plan</Label>
                <p className="text-xs text-muted-foreground">Deterministically inspects failures/warnings and builds a gated recovery plan. Off by default. It never calls AI, mutates templates, reruns imports, or runs browser-dependent actions automatically.</p>
              </div>
              <Switch id="buildSelfHealingPlan" checked={form.buildSelfHealingPlan}
                onCheckedChange={(v) => setBool('buildSelfHealingPlan', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="persistSelfHealingAudit" className="text-sm">Persist self-healing audit</Label>
                <p className="text-xs text-muted-foreground">Stores safe structured audit metadata in <code>template_imports.meta.self_healing_retry_audit</code> (only when persisting the run). It does not store raw PDF text or screenshots.</p>
              </div>
              <Switch id="persistSelfHealingAudit" checked={form.persistSelfHealingAudit} disabled={!form.buildSelfHealingPlan}
                onCheckedChange={(v) => setBool('persistSelfHealingAudit', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="buildPerformanceCostAudit" className="text-sm">Build performance/cost audit</Label>
                <p className="text-xs text-muted-foreground">Advisory: identifies expensive steps, stale metadata, duplicate work, and safe reuse opportunities. Read-only unless persistence is enabled. It does not skip steps, call AI, or mutate templates.</p>
              </div>
              <Switch id="buildPerformanceCostAudit" checked={form.buildPerformanceCostAudit}
                onCheckedChange={(v) => setBool('buildPerformanceCostAudit', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="persistPerformanceCostAudit" className="text-sm">Persist performance/cost audit</Label>
                <p className="text-xs text-muted-foreground">Stores safe structured performance/cost metadata in <code>template_imports.meta.performance_cost_audit</code> (only when persisting the run). It does not skip steps, call AI, or mutate templates.</p>
              </div>
              <Switch id="persistPerformanceCostAudit" checked={form.persistPerformanceCostAudit} disabled={!form.buildPerformanceCostAudit}
                onCheckedChange={(v) => setBool('persistPerformanceCostAudit', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="buildOperatorControls" className="text-sm">Build production operator controls</Label>
                <p className="text-xs text-muted-foreground">Determines which safe operator actions are available, recommended, manual-only, or blocked for this import. Read-only unless persistence is enabled. It does not call AI, mutate templates, or apply repairs.</p>
              </div>
              <Switch id="buildOperatorControls" checked={form.buildOperatorControls}
                onCheckedChange={(v) => setBool('buildOperatorControls', v)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="persistOperatorControlAudit" className="text-sm">Persist operator control audit</Label>
                <p className="text-xs text-muted-foreground">Stores safe structured operator control metadata in <code>template_imports.meta.production_operator_control_audit</code> (only when persisting the run). It does not call AI, mutate templates, or apply repairs.</p>
              </div>
              <Switch id="persistOperatorControlAudit" checked={form.persistOperatorControlAudit} disabled={!form.buildOperatorControls}
                onCheckedChange={(v) => setBool('persistOperatorControlAudit', v)} />
            </div>
          </div>

          {form.buildSelfHealingPlan && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="selfHealingMode">Self-healing execution mode</Label>
                <Select value={form.selfHealingMode} onValueChange={(v) => setField('selfHealingMode', v)}>
                  <SelectTrigger id="selfHealingMode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dry_run">Dry run (plan only, no execution)</SelectItem>
                    <SelectItem value="audit_only">Audit only (plan + record, no execution)</SelectItem>
                    <SelectItem value="execute_safe">Execute safe actions</SelectItem>
                    <SelectItem value="execute_confirmed">Execute confirmed actions</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Only safe metadata-level actions ever execute. AI, template mutation, import reruns,
                  and browser-dependent actions are always manual.
                </p>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="selfHealingOperatorConfirmed" className="text-sm">Operator confirmation</Label>
                  <p className="text-xs text-muted-foreground">Required before <code>execute_confirmed</code> may run operator-confirmed actions.</p>
                </div>
                <Switch id="selfHealingOperatorConfirmed" checked={form.selfHealingOperatorConfirmed}
                  disabled={form.selfHealingMode !== 'execute_confirmed'}
                  onCheckedChange={(v) => setBool('selfHealingOperatorConfirmed', v)} />
              </div>
            </div>
          )}

          {corpusItem && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="font-medium">{corpusItem.title} · {corpusItem.category}</div>
              <div className="text-muted-foreground">{corpusItem.purpose}</div>
              <div className="mt-1 text-muted-foreground">
                Thresholds — Visual QA ≥ {corpusItem.scoreThresholds.visualQaMinimum} ·
                Repair ≥ {corpusItem.scoreThresholds.repairFinalMinimum} ·
                Export parity ≥ {corpusItem.scoreThresholds.exportParityMinimum} ·
                manual review {corpusItem.expectedOutcomes.manualReviewAllowed ? 'allowed' : 'not allowed'} ·
                fallback {corpusItem.expectedOutcomes.fallbackAllowed ? 'allowed' : 'not allowed'}
              </div>
            </div>
          )}

          {errors.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>Fix before running</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 text-xs">{errors.map((i) => <li key={i.code}>{i.message}</li>)}</ul>
              </AlertDescription>
            </Alert>
          )}
          {persistWarnings.length > 0 && (
            <Alert>
              <AlertTitle>Warnings (persist)</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 text-xs">{persistWarnings.map((i) => <li key={i.code}>{i.message}</li>)}</ul>
              </AlertDescription>
            </Alert>
          )}
          {errorMessage && (
            <Alert variant="destructive">
              <AlertTitle>Orchestrator error</AlertTitle>
              <AlertDescription className="text-xs break-all">{errorMessage}</AlertDescription>
            </Alert>
          )}

          {!canEvaluate && (
            <Alert variant="destructive">
              <AlertTitle>Evaluate Only not permitted</AlertTitle>
              <AlertDescription className="text-xs">
                Your role ({resolvedRole.role}) does not allow Evaluate Only{form.runExportParity ? ' with export parity automation' : ''}.
              </AlertDescription>
            </Alert>
          )}
          {canEvaluate && !canPersist && missingPersistCapabilities.length > 0 && (
            <Alert>
              <AlertTitle>Persist restricted for your role</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 text-xs">{missingPersistCapabilities.map((m) => <li key={m}>{m}</li>)}</ul>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={onEvaluateOnly} disabled={loading || !evalValidation.ok || !canEvaluate}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              Evaluate Only
            </Button>
            <Button variant="secondary" onClick={onEvaluateAndPersist} disabled={loading || !persistValidation.ok || !canPersist}>
              <Save className="h-4 w-4 mr-2" /> Evaluate + Persist
            </Button>
            <Button variant="outline" onClick={onReset} disabled={loading}>
              <RotateCcw className="h-4 w-4 mr-2" /> Reset
            </Button>
            <Button variant="outline" onClick={onCopyJson} disabled={!result}>
              <Copy className="h-4 w-4 mr-2" /> Copy Result JSON
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={getGoldenCorpusConsoleStatusTone(result.status)}>{result.status}</Badge>
              {getGoldenCorpusConsoleResultHeadline(result)}
              {result.importId && (
                <Link
                  to={`/admin/template-import-quality`}
                  className="ml-auto inline-flex items-center gap-1 text-xs text-primary underline"
                >
                  Template Import Quality <ExternalLink className="h-3 w-3" />
                </Link>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="result">
              <TabsList className="flex flex-wrap">
                <TabsTrigger value="result">Result</TabsTrigger>
                <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
                <TabsTrigger value="gates">Quality Gates</TabsTrigger>
                <TabsTrigger value="triage">Triage</TabsTrigger>
                <TabsTrigger value="exportParity">Export Parity</TabsTrigger>
                <TabsTrigger value="selfHealing">Self-Healing</TabsTrigger>
                <TabsTrigger value="performance">Performance</TabsTrigger>
                <TabsTrigger value="operatorControls">Operator Controls</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>
              <TabsContent value="result" className="mt-4"><GoldenRegressionResultPanel result={result} /></TabsContent>
              <TabsContent value="snapshot" className="mt-4"><GoldenRegressionSnapshotPanel snapshot={snapshot} /></TabsContent>
              <TabsContent value="gates" className="mt-4"><GoldenRegressionQualityGatePanel report={result.qualityGateReport} /></TabsContent>
              <TabsContent value="triage" className="mt-4"><GoldenRegressionTriagePanel triage={result.triageSummary} /></TabsContent>
              <TabsContent value="exportParity" className="mt-4"><AutomatedExportParityPanel result={result.exportParityRunnerResult} /></TabsContent>
              <TabsContent value="selfHealing" className="mt-4">
                <SelfHealingRetryPanel
                  audit={result.selfHealingRetryAudit}
                  persistenceResult={result.selfHealingRetryAuditPersistenceResult}
                />
              </TabsContent>
              <TabsContent value="performance" className="mt-4">
                <PerformanceCostAuditPanel
                  audit={result.performanceCostAudit}
                  persistenceResult={result.performanceCostAuditPersistenceResult}
                />
              </TabsContent>
              <TabsContent value="operatorControls" className="mt-4">
                <ProductionOperatorControlsPanel
                  audit={result.productionOperatorControlAudit}
                  importId={result.importId}
                  templateId={result.templateId}
                  persistenceResult={result.productionOperatorControlAuditPersistenceResult}
                  resolvedRole={resolvedRole}
                  onExecuteMetadataControl={handleExecuteMetadataControl}
                  onEnableConsoleOption={handleEnableConsoleOption}
                />
              </TabsContent>
              <TabsContent value="history" className="mt-4">
                <GoldenRegressionHistoryPanel
                  corpusId={result.corpusId}
                  importId={result.importId}
                  refreshKey={historyRefreshKey}
                />
              </TabsContent>
              <TabsContent value="json" className="mt-4">
                <pre className="max-h-[480px] overflow-auto rounded-md border bg-muted/30 p-3 text-[11px]">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmPersistOpen} onOpenChange={setConfirmPersistOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Persist golden regression summary?</DialogTitle>
            <DialogDescription>
              {form.runExportParity && (
                <span className="block mb-2">
                  Export parity automation will run <strong>before</strong> golden evaluation
                  {form.persistExportParity
                    ? <> and will update <code className="mx-1">export_parity_summary</code> before saving the golden regression result.</>
                    : <> (persistence off — the export parity summary will not be written).</>}
                </span>
              )}
              This will save the latest golden regression summary to
              <code className="mx-1">template_imports.meta.golden_regression_summary</code>
              and{form.saveHistory ? ' also append a history row to ' : ' (history saving is off, so it will NOT write to) '}
              <code className="mx-1">pdf_import_golden_runs</code>
              for the selected import. Failing or blocked results may be persisted as evidence.
              {form.buildImportIntelligenceProfile && form.persistImportIntelligenceProfile && (
                <span className="block mt-2">
                  This will also save the <code className="mx-1">import_intelligence_profile</code> metadata for this import.
                  It does not store raw PDF text or PDF files.
                </span>
              )}
              {form.buildRepairPatternAnalysis && form.persistRepairPatternAnalysis && (
                <span className="block mt-2">
                  This will also save <code className="mx-1">repair_pattern_analysis</code> metadata. It does not apply repair changes.
                </span>
              )}
              {form.buildAdaptiveReconciliationPolicy && form.persistAdaptiveReconciliationPolicy && (
                <span className="block mt-2">
                  This will also save <code className="mx-1">adaptive_reconciliation_policy</code> metadata. It does not call AI and does not apply reconciliation changes.
                </span>
              )}
              {form.buildSelfHealingPlan && (
                <span className="block mt-2">
                  Self-healing runs in <strong>{form.selfHealingMode}</strong> mode
                  {form.persistSelfHealingAudit
                    ? <> and will save <code className="mx-1">self_healing_retry_audit</code> metadata.</>
                    : <> (audit persistence off).</>}{' '}
                  Only safe metadata-level actions can execute; it never calls AI, mutates templates,
                  reruns imports, or performs browser-dependent actions automatically.
                </span>
              )}
              {form.buildPerformanceCostAudit && form.persistPerformanceCostAudit && (
                <span className="block mt-2">
                  This will also save <code className="mx-1">performance_cost_audit</code> metadata. It is advisory and does not change pipeline behaviour.
                </span>
              )}
              {form.buildOperatorControls && form.persistOperatorControlAudit && (
                <span className="block mt-2">
                  This will also save <code className="mx-1">production_operator_control_audit</code> metadata. It records operator control availability and decisions. It does not apply repair or reconciliation changes.
                </span>
              )}
              {' '}Continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPersistOpen(false)} disabled={loading}>Cancel</Button>
            <Button onClick={onConfirmPersist} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Evaluate + Persist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default GoldenRegressionRunConsole;
