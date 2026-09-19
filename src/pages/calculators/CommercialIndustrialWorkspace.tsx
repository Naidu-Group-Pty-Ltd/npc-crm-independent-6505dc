/**
 * The Commercial & Industrial Analysis Workspace.
 *
 * ## What this is, and what it replaces
 *
 * `/calculators` used to be nine calculator cards behind a tab strip, wrapped
 * in four competing command surfaces — a hero, a domain panel, an active
 * property header, a property selector repeating it, a global generation
 * strip, an assumption drawer and per-card actions. Every one of them offered
 * a next action; none of them agreed; and underneath, the entire deal lived in
 * a Zustand store created at page load, so a refresh threw the analysis away
 * and "Generate Report" set a timestamp in React state and produced no
 * document.
 *
 * This is the same analytical power on the platform's durable spine. The
 * workspace *is* an assessment record — one id, one autosave with version
 * conflict detection, one immutable calculation run, one client link with
 * reconciliation, one rendered report filed against it. The calculators became
 * stages that read canonical inputs instead of nine private copies of the
 * deal.
 *
 * ## The shape of the journey
 *
 * Context → Property → Income → Ownership → Lending → Valuation → Forecast →
 * Results → Report. Ordered by data dependency: a yield needs an income, an
 * income needs a lease, a lease needs a property.
 *
 * ## Why it reuses the assessment steps verbatim
 *
 * Property, income, ownership, portfolio and lending are the *same* questions
 * the assessment workspace asks, against the same payload. Re-implementing
 * them here would have produced a second set of fields writing to the same
 * columns — the precise failure this page is being rescued from.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, ArrowRight, Building2, Factory, Loader2, Plus, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { ciAssessmentApi, useCiAssessment, useCiAssessments } from '@/hooks/useCiAssessments';
import { useCapacityReport } from '@/hooks/useCapacityReport';
import { CalculatorPrefillProvider, useCalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { runAssessment, type AssessmentResult } from '@/lib/ciAssessment/engine';
import { runAnalysis } from '@/lib/ciAssessment/analysisEngine';
import { validateAssessment, type ValidationIssue } from '@/lib/ciAssessment/validation';
import { evaluateReadiness } from '@/lib/ciAssessment/workspaceReadiness';
import { clientCommercialIndustrialPath } from '@/lib/ciAssessment/clientRoute';
import {
  initialAssessmentType, normaliseDomain, planBootstrap, type WorkspaceDomain,
} from '@/lib/ciAssessment/workspaceBootstrap';
import {
  ASSESSMENT_STATUS_LABELS, assessmentTypeDefinition, emptyAssessmentPayload,
  type AssessmentPayload,
} from '@/lib/ciAssessment/types';
import { focusAssessmentFieldWhenReady } from '@/components/commercial/assessment/fieldFocus';
import { StepPropertyTransaction } from '@/components/commercial/assessment/StepPropertyTransaction';
import { StepIncome } from '@/components/commercial/assessment/StepIncome';
import { StepLeaseIncome } from '@/components/commercial/assessment/StepLeaseIncome';
import { StepOwnership } from '@/components/commercial/assessment/StepOwnership';
import { StepPortfolio } from '@/components/commercial/assessment/StepPortfolio';
import { StepLoanStructure } from '@/components/commercial/assessment/StepLoanStructure';
import { StepResults } from '@/components/commercial/assessment/StepResults';
import { StepClientLink } from '@/components/commercial/assessment/StepClientLink';
import { ContextStage } from '@/components/commercial/workspace/ContextStage';
import { ValuationStage } from '@/components/commercial/workspace/ValuationStage';
import { ForecastStage } from '@/components/commercial/workspace/ForecastStage';
import { ReportDeliveryStage } from '@/components/commercial/workspace/ReportDeliveryStage';
import { WorkspaceResultsRail, type CalculationState } from '@/components/commercial/workspace/WorkspaceResultsRail';
import {
  WORKSPACE_STAGES, isWorkspaceStage, stageForSection, stageIndex, type WorkspaceStageKey,
} from '@/components/commercial/workspace/workspaceStages';

const EMPTY_ISSUES: ValidationIssue[] = [];

/**
 * The page. Two components on purpose: the outer one resolves *which* analysis
 * is open (and can create one), the inner one runs it — so the prefill
 * provider, which is keyed by domain, never remounts mid-analysis.
 */
export default function CommercialIndustrialWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const plan = useMemo(() => planBootstrap({
    workspace: searchParams.get('workspace'),
    domain: searchParams.get('domain'),
    propertyId: searchParams.get('propertyId'),
  }), [searchParams]);

  const domain: WorkspaceDomain = plan.kind === 'open'
    ? normaliseDomain(searchParams.get('domain'))
    : plan.domain;

  const openWorkspace = useCallback((assessmentId: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('workspace', assessmentId);
      next.delete('stage');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const create = useCallback(async (forDomain: WorkspaceDomain) => {
    setCreating(true);
    const type = initialAssessmentType(forDomain);
    const result = await ciAssessmentApi.create({
      title: 'Untitled analysis',
      segment: forDomain,
      assessmentType: type,
      payload: emptyAssessmentPayload(type),
    });
    setCreating(false);
    if (result.error || !result.data) {
      toast({ title: 'Could not start the analysis', description: result.error ?? 'Try again.', variant: 'destructive' });
      return;
    }
    openWorkspace(result.data.id);
  }, [openWorkspace]);

  // A legacy property deep link means "analyse this building": create the
  // analysis around it rather than dead-ending on a page that cannot hold one.
  const [bootstrapped, setBootstrapped] = useState(false);
  useEffect(() => {
    if (bootstrapped || plan.kind !== 'create') return;
    setBootstrapped(true);
    void create(plan.domain);
  }, [bootstrapped, plan, create]);

  if (plan.kind === 'open') {
    return (
      <CalculatorPrefillProvider key={domain} domain={domain}>
        <WorkspaceRunner assessmentId={plan.assessmentId} domain={domain} onBack={() => navigate('/commercial')} />
      </CalculatorPrefillProvider>
    );
  }

  return (
    <WorkspaceChooser
      domain={domain}
      creating={creating || plan.kind === 'create'}
      onCreate={create}
      onOpen={openWorkspace}
    />
  );
}

/**
 * The landing state: recent analyses, and one button to start another.
 *
 * Deliberately not "create an analysis on arrival" — a page that mints a
 * record every time somebody clicks the nav item fills the list with empty
 * analyses nobody asked for.
 */
function WorkspaceChooser({
  domain, creating, onCreate, onOpen,
}: {
  domain: WorkspaceDomain;
  creating: boolean;
  onCreate: (domain: WorkspaceDomain) => void;
  onOpen: (assessmentId: string) => void;
}) {
  const { rows, loading } = useCiAssessments(useMemo(() => ({ segment: undefined }), []));
  const recent = rows.filter((row) => !row.archived_at).slice(0, 8);

  return (
    <div className="ci-foundation ci-shell space-y-5">
      <header className="ci-page-header">
        <div className="min-w-0">
          <h1 className="ci-page-title">
            <span className="ci-page-title-icon">
              {domain === 'industrial'
                ? <Factory className="h-5 w-5" aria-hidden="true" />
                : <Building2 className="h-5 w-5" aria-hidden="true" />}
            </span>
            Commercial &amp; Industrial Analysis
          </h1>
          <p className="ci-page-subtitle">
            One workspace from context to client report — property, income, lending, valuation, forecast
            and the document, on a record that survives you closing the tab.
          </p>
        </div>
        <div className="ci-page-actions">
          <Button size="sm" disabled={creating} onClick={() => onCreate(domain)}>
            {creating
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              : <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            New analysis
          </Button>
        </div>
      </header>

      <section className="ci-step-panel">
        <h2 className="ci-step-heading">Continue an analysis</h2>
        <p className="ci-step-description">
          Every analysis is saved as you work. Pick one up where you left it, or start a new one.
        </p>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : recent.length ? (
          <ul className="space-y-2">
            {recent.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">{row.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {row.segment === 'industrial'
                        ? <Factory className="h-3 w-3" aria-hidden="true" />
                        : <Building2 className="h-3 w-3" aria-hidden="true" />}
                      {row.reference} · {ASSESSMENT_STATUS_LABELS[row.status]}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ci-inline-empty">
            <div className="ci-inline-empty-body">
              <p className="ci-inline-empty-title">No analyses yet</p>
              <p className="ci-inline-empty-copy">
                Start one and the workspace will keep it — inputs, calculations and every report produced
                from it.
              </p>
            </div>
            <Button size="sm" onClick={() => onCreate(domain)} disabled={creating}>Start an analysis</Button>
          </div>
        )}
      </section>
    </div>
  );
}

/** The workspace proper, once an analysis is resolved. */
function WorkspaceRunner({
  assessmentId, domain, onBack,
}: {
  assessmentId: string;
  domain: WorkspaceDomain;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isSuperadmin } = usePermissions();
  const { canEdit } = useModulePermissions('clients');
  const { prefill, selectProperty } = useCalculatorPrefill();

  const {
    record, payload, loading, error, saveState,
    update, saveNow, saveTitle, reload,
  } = useCiAssessment(assessmentId);

  const [calculating, setCalculating] = useState(false);
  const [savedResult, setSavedResult] = useState<AssessmentResult | null>(null);
  const [renders, setRenders] = useState<Array<{ id: string; file_name: string; status: string; page_count: number | null; created_at: string }>>([]);
  const [clientName, setClientName] = useState<string | null>(null);
  const { generatingId, generate } = useCapacityReport();

  const stageParam = searchParams.get('stage');
  const stage: WorkspaceStageKey = isWorkspaceStage(stageParam) ? stageParam : 'context';

  const goToStage = useCallback((next: WorkspaceStageKey, options?: { scrollToTop?: boolean }) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.set('stage', next);
      return params;
    }, { replace: true });
    if (options?.scrollToTop !== false) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

  // A property arriving on the URL is linked once the analysis is open, so a
  // legacy `?propertyId=` link lands on a workspace that already knows the
  // building.
  const urlPropertyId = searchParams.get('propertyId');
  useEffect(() => {
    if (urlPropertyId && !prefill) void selectProperty(urlPropertyId);
  }, [urlPropertyId, prefill, selectProperty]);

  const liveResult = useMemo(() => (payload ? runAssessment(payload) : null), [payload]);
  const validation = useMemo(() => (payload ? validateAssessment(payload) : null), [payload]);
  const errors = validation?.errors ?? EMPTY_ISSUES;
  const analysis = useMemo(
    () => (payload && liveResult ? runAnalysis(payload, liveResult) : null),
    [payload, liveResult],
  );

  /** Errors per stage, so a chip can carry a count and open the right panel. */
  const errorsByStage = useMemo(() => {
    const index = new Map<WorkspaceStageKey, ValidationIssue[]>();
    for (const issue of errors) {
      const key = stageForSection(issue.section);
      const bucket = index.get(key);
      if (bucket) bucket.push(issue);
      else index.set(key, [issue]);
    }
    return index;
  }, [errors]);

  const goToIssue = useCallback((issue: ValidationIssue) => {
    const target = stageForSection(issue.section);
    if (target !== stage) goToStage(target, { scrollToTop: false });
    focusAssessmentFieldWhenReady(issue.field);
  }, [stage, goToStage]);

  /**
   * Whether the working figures have moved away from the saved run.
   *
   * The stored columns are written only by a base calculation, so comparing
   * them to the live result is an exact test of "has anything changed since".
   */
  const figuresChanged = useMemo(() => {
    if (!record?.current_calculation_id || !liveResult) return false;
    const moved = (stored: number | null, live: number, tolerance: number) => (
      stored == null ? live > 0 : Math.abs(stored - live) > tolerance
    );
    return moved(record.maximum_indicative_loan, liveResult.summary.maximumIndicativeLoan, 1)
      || moved(record.requested_loan, liveResult.summary.requestedLoan, 1)
      || moved(record.proposed_lvr, liveResult.summary.proposedLvr, 0.0001)
      || moved(record.proposed_dscr, liveResult.summary.proposedDscr, 0.0001);
  }, [record, liveResult]);

  const calculationState: CalculationState = !record?.current_calculation_id
    ? 'live'
    : figuresChanged ? 'out_of_date' : 'saved';

  const readiness = useMemo(() => evaluateReadiness({
    status: record?.status ?? 'draft',
    hasSavedCalculation: Boolean(record?.current_calculation_id),
    figuresChanged,
    errors,
    lending: liveResult,
    analysis,
    clientLinked: Boolean(record?.client_id),
  }), [record, figuresChanged, errors, liveResult, analysis]);

  // Reports already produced from this analysis, and the client's name — both
  // read through the module's own workspace route, so what is shown here obeys
  // the same access rules as the client tab.
  const loadClientContext = useCallback(async () => {
    if (!record?.client_id) { setClientName(null); setRenders([]); return; }
    const result = await ciAssessmentApi.clientWorkspace(record.client_id);
    const data = result.data;
    if (!data) return;
    const client = data.client;
    setClientName(client
      ? [client.primary_first_name, client.primary_surname].filter(Boolean).join(' ') || 'Client'
      : null);
    setRenders((data.renders ?? []).filter((render) => render.assessment_id === assessmentId));
  }, [record?.client_id, assessmentId]);

  useEffect(() => { void loadClientContext(); }, [loadClientContext]);

  const setPayload = useCallback((next: AssessmentPayload) => {
    update(next, WORKSPACE_STAGES[stageIndex(stage)]?.section);
  }, [update, stage]);

  const calculate = useCallback(async () => {
    if (!payload || !liveResult) return;
    setCalculating(true);
    // The run snapshots what the server has, so the working payload is saved
    // first — a run against an unsaved draft would describe nothing.
    await saveNow('calculation');
    const result = await ciAssessmentApi.runCalculation({ assessmentId, payload, result: liveResult });
    setCalculating(false);
    if (result.error) {
      toast({ title: 'Calculation not saved', description: result.error, variant: 'destructive' });
      return;
    }
    setSavedResult(liveResult);
    await reload();
    toast({
      title: 'Calculation saved',
      description: `${liveResult.outcomeLabel}. Engine ${liveResult.engineVersion}, policy ${liveResult.policyVersion}.`,
    });
    goToStage('results');
  }, [assessmentId, payload, liveResult, saveNow, reload, goToStage]);

  const complete = useCallback(async () => {
    const result = await ciAssessmentApi.complete(assessmentId);
    if (result.error) {
      toast({ title: 'Could not complete', description: result.error, variant: 'destructive' });
      return;
    }
    await reload();
    toast({
      title: 'Analysis complete',
      description: 'The report can now be generated, and the analysis linked to a client.',
    });
    goToStage('report');
  }, [assessmentId, reload, goToStage]);

  const generateReport = useCallback(async () => {
    await generate(assessmentId);
    await reload();
    await loadClientContext();
  }, [generate, assessmentId, reload, loadClientContext]);

  if (loading && !record) {
    return (
      <div className="ci-foundation ci-shell space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-[28rem] w-full" />
      </div>
    );
  }

  if (error && !record) {
    return (
      <div className="ci-foundation ci-shell">
        <div className="ci-warning-row ci-warning-critical" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="font-semibold text-foreground">This analysis could not be opened</p>
            <p className="mt-0.5 text-sm">{error}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={onBack}>
              Back to Commercial &amp; Industrial
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!record || !payload || !liveResult || !analysis) return null;

  const definition = assessmentTypeDefinition(payload.assessmentType);
  const SegmentIcon = definition.segment === 'industrial' ? Factory : Building2;
  const readOnly = record.status === 'archived';
  const canLinkClient = isSuperadmin || canEdit;
  const activeIndex = stageIndex(stage);
  const openClient = record.client_id
    ? () => navigate(clientCommercialIndustrialPath(record.client_id!))
    : null;

  return (
    <div className="ci-foundation ci-workspace">
      {/* ---- One header ------------------------------------------------- */}
      <header className="ci-workspace-header">
        <div className="ci-workspace-header-inner">
          <div className="flex min-w-0 items-center gap-2.5">
            <Button
              size="icon" variant="ghost" className="h-8 w-8 shrink-0"
              onClick={onBack}
              aria-label="Back to Commercial and Industrial"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <SegmentIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
                {record.title}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {record.reference} · {definition.label}
                {prefill?.address ? ` · ${prefill.address}` : ''}
                {clientName ? ` · ${clientName}` : ' · No client linked'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="ci-status-badge ci-status-neutral">
              {ASSESSMENT_STATUS_LABELS[record.status]}
            </Badge>
            <span className="ci-save-indicator" role="status">
              {saveState === 'saving' ? 'Saving…'
                : saveState === 'dirty' ? 'Unsaved changes'
                  : saveState === 'error' ? 'Save failed'
                    : saveState === 'conflict' ? 'Changed elsewhere'
                      : 'Saved'}
            </span>
            <Button size="sm" onClick={calculate} disabled={calculating || readOnly}>
              {calculating
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              {calculating ? 'Calculating…' : 'Run calculation'}
            </Button>
          </div>
        </div>

        <nav className="mx-auto w-full max-w-[1600px] px-4 pb-3 sm:px-6 lg:px-8" aria-label="Analysis stages">
          <ol className="ci-steps">
            {WORKSPACE_STAGES.map((definitionItem, index) => {
              const isActive = definitionItem.key === stage;
              const stageErrors = errorsByStage.get(definitionItem.key) ?? EMPTY_ISSUES;
              return (
                <li key={definitionItem.key}>
                  <button
                    type="button"
                    onClick={() => (stageErrors.length ? goToIssue(stageErrors[0]) : goToStage(definitionItem.key))}
                    aria-current={isActive ? 'step' : undefined}
                    className={cn(
                      'ci-step-chip',
                      isActive && 'ci-step-chip-active',
                      stageErrors.length > 0 && 'ci-step-chip-error',
                    )}
                  >
                    <span className="ci-step-index" aria-hidden="true">{index + 1}</span>
                    <span>{definitionItem.label}</span>
                    {stageErrors.length ? (
                      <>
                        <span className="ci-step-error-count" aria-hidden="true">{stageErrors.length}</span>
                        <span className="sr-only">
                          {stageErrors.length} field{stageErrors.length === 1 ? '' : 's'} need attention
                        </span>
                      </>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      <div className="ci-workspace-body">
        <main className="ci-workspace-main">
          {calculationState === 'out_of_date' ? (
            <div className="ci-warning-row ci-warning-info" role="status">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  The figures have moved since the saved calculation
                </p>
                <p className="mt-0.5 text-sm">
                  The saved run — and any report produced from it — still states the earlier figures. Run
                  the calculation again to bring them up to date.
                </p>
              </div>
            </div>
          ) : null}

          {errors.length ? (
            <div className="ci-warning-row ci-warning-critical" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {errors.length} field{errors.length === 1 ? '' : 's'} need attention
                  <span className="ml-1.5 font-normal text-muted-foreground">— select one to jump to it.</span>
                </p>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {errors.slice(0, 4).map((issue) => (
                    <li key={`${issue.field}-${issue.message}`}>
                      <button type="button" className="ci-issue-link" onClick={() => goToIssue(issue)}>
                        <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>{issue.message}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {stage === 'context' ? (
            <ContextStage
              title={record.title}
              reference={record.reference}
              onTitleChange={(title) => { void saveTitle(title); }}
              payload={payload}
              onChange={setPayload}
              disabled={readOnly}
              clientName={clientName}
              onOpenClient={openClient}
              onGoToLinking={() => goToStage('report')}
            />
          ) : null}

          {stage === 'property' ? (
            <StepPropertyTransaction payload={payload} onChange={setPayload} issues={errors} disabled={readOnly} />
          ) : null}

          {stage === 'income' ? (
            <div className="space-y-5">
              <StepLeaseIncome payload={payload} onChange={setPayload} issues={errors} disabled={readOnly} />
              <StepIncome payload={payload} onChange={setPayload} issues={errors} disabled={readOnly} />
            </div>
          ) : null}

          {stage === 'ownership' ? (
            <div className="space-y-5">
              <StepOwnership payload={payload} onChange={setPayload} issues={errors} disabled={readOnly} />
              <StepPortfolio payload={payload} onChange={setPayload} issues={errors} disabled={readOnly} />
            </div>
          ) : null}

          {stage === 'lending' ? (
            <StepLoanStructure
              payload={payload} onChange={setPayload} issues={errors}
              canOverridePolicy={isSuperadmin || canEdit} disabled={readOnly}
            />
          ) : null}

          {stage === 'valuation' ? (
            <ValuationStage payload={payload} analysis={analysis} onChange={setPayload} disabled={readOnly} />
          ) : null}

          {stage === 'forecast' ? (
            <ForecastStage payload={payload} analysis={analysis} onChange={setPayload} disabled={readOnly} />
          ) : null}

          {stage === 'results' ? (
            <div className="space-y-5">
              <StepResults
                payload={payload}
                result={savedResult ?? liveResult}
                onRecalculate={calculate}
                onGenerateReport={generateReport}
                calculating={calculating}
                canGenerateReport={readiness.canGenerate}
                generatingReport={generatingId === assessmentId}
                reportBlockedReason={readiness.blocking[0]?.message}
              />
              {record.status !== 'completed' && record.status !== 'linked' ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
                  <Button onClick={complete} disabled={!record.current_calculation_id}>
                    Complete analysis
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    {record.current_calculation_id
                      ? 'Marks the saved calculation as the one the report states, and opens the report stage.'
                      : 'Run a calculation before completing.'}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {stage === 'report' ? (
            <div className="space-y-5">
              <ReportDeliveryStage
                readiness={readiness}
                renders={renders}
                generating={generatingId === assessmentId}
                onGenerate={generateReport}
                onGoToStage={goToStage}
                clientName={clientName}
                onOpenClient={openClient}
              />
              {record.status === 'completed' || record.status === 'linked' ? (
                <StepClientLink
                  assessmentId={record.id}
                  payload={payload}
                  linkedClientId={record.client_id}
                  onLinked={async () => { await reload(); await loadClientContext(); }}
                  canLink={canLinkClient}
                  canUpdateClient={canLinkClient}
                />
              ) : (
                <div className="ci-step-panel">
                  <h2 className="ci-step-heading">Client link</h2>
                  <p className="ci-step-description">
                    Linking opens once the analysis is complete, so what is filed on a client record is a
                    finished position rather than a working one.
                  </p>
                  <Button variant="outline" onClick={() => goToStage('results')}>Go to results</Button>
                </div>
              )}
            </div>
          ) : null}

          <nav className="flex items-center justify-between gap-3 border-t border-border pt-4" aria-label="Stage navigation">
            <Button
              variant="outline" size="sm" disabled={activeIndex === 0}
              onClick={() => goToStage(WORKSPACE_STAGES[Math.max(0, activeIndex - 1)].key)}
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Stage {activeIndex + 1} of {WORKSPACE_STAGES.length}
            </span>
            <Button
              size="sm" disabled={activeIndex === WORKSPACE_STAGES.length - 1}
              onClick={async () => {
                await saveNow(WORKSPACE_STAGES[activeIndex]?.section);
                goToStage(WORKSPACE_STAGES[Math.min(WORKSPACE_STAGES.length - 1, activeIndex + 1)].key);
              }}
            >
              Save &amp; continue <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </nav>
        </main>

        <WorkspaceResultsRail
          result={savedResult ?? liveResult}
          analysis={analysis}
          readiness={readiness}
          calculationState={calculationState}
          onJumpToResults={() => goToStage('results')}
        />
      </div>
    </div>
  );
}
