/**
 * Commercial & Industrial assessment workspace.
 *
 * A full-page, autosaving, step-by-step workspace — the replacement for the
 * narrow scrolling modal the feature used to create properties through. Steps
 * are directly navigable rather than strictly sequential, because a user
 * revisiting an assessment usually knows which section they came back for.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle, ArrowLeft, ArrowRight, Building2, Check, CloudOff,
  Factory, Loader2, Save, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { usePermissions } from '@/hooks/usePermissions';
import { ciAssessmentApi, useCiAssessment } from '@/hooks/useCiAssessments';
import { useCapacityReport } from '@/hooks/useCapacityReport';
import { runAssessment, type AssessmentResult } from '@/lib/ciAssessment/engine';
import { validateAssessment, type ValidationIssue } from '@/lib/ciAssessment/validation';
import { focusAssessmentFieldWhenReady } from '@/components/commercial/assessment/fieldFocus';
import { ASSESSMENT_STATUS_LABELS, assessmentTypeDefinition, type AssessmentPayload } from '@/lib/ciAssessment/types';
import { clientCommercialIndustrialPath } from '@/lib/ciAssessment/clientRoute';
import { StepAssessmentType } from '@/components/commercial/assessment/StepAssessmentType';
import { IntakePackPanel } from '@/components/commercial/assessment/IntakePackPanel';
import type { ParsedPack } from '@/lib/ciAssessment/intakePack';
import { StepPropertyTransaction } from '@/components/commercial/assessment/StepPropertyTransaction';
import { StepOwnership } from '@/components/commercial/assessment/StepOwnership';
import { StepIncome } from '@/components/commercial/assessment/StepIncome';
import { StepPortfolio } from '@/components/commercial/assessment/StepPortfolio';
import { StepLeaseIncome } from '@/components/commercial/assessment/StepLeaseIncome';
import { StepLoanStructure } from '@/components/commercial/assessment/StepLoanStructure';
import { StepResults } from '@/components/commercial/assessment/StepResults';
import { StepClientLink } from '@/components/commercial/assessment/StepClientLink';
import { ResultsRail } from '@/components/commercial/assessment/ResultsRail';

const STEPS = [
  { key: 'type', label: 'Type', section: 'assessmentType' },
  // The intake pack sits early on purpose: the usual flow is create the
  // assessment, download the pack, meet the client, come back and upload it.
  { key: 'pack', label: 'Intake pack', section: 'intakePack' },
  { key: 'property', label: 'Property & transaction', section: 'property' },
  { key: 'ownership', label: 'Ownership', section: 'ownership' },
  { key: 'income', label: 'Income', section: 'income' },
  { key: 'portfolio', label: 'Portfolio', section: 'portfolio' },
  { key: 'lease', label: 'Lease income', section: 'lease' },
  { key: 'loan', label: 'Loan structure', section: 'loan' },
  { key: 'results', label: 'Results', section: 'results' },
  { key: 'link', label: 'Save & link', section: 'link' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

/** Stable identity so the memoised issue index does not rebuild on every render. */
const EMPTY_ISSUES: ValidationIssue[] = [];

/** How many issues the summary lists before collapsing behind "show all". */
const SUMMARY_LIMIT = 6;

const STEP_LABELS = new Map<string, string>(STEPS.map((step) => [step.key, step.label]));

function SaveIndicator({ state, savedAt }: { state: string; savedAt: string | null }) {
  if (state === 'saving') {
    return (
      <span className="ci-save-indicator" role="status">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Saving…
      </span>
    );
  }
  if (state === 'error' || state === 'conflict') {
    return (
      <span className="ci-save-indicator ci-save-indicator-error" role="status">
        <CloudOff className="h-3 w-3" aria-hidden="true" />
        {state === 'conflict' ? 'Changed elsewhere — reload' : 'Save failed'}
      </span>
    );
  }
  if (state === 'dirty') {
    return (
      <span className="ci-save-indicator" role="status">
        <Save className="h-3 w-3" aria-hidden="true" /> Unsaved changes
      </span>
    );
  }
  if (state === 'saved' || savedAt) {
    return (
      <span className="ci-save-indicator ci-save-indicator-saved" role="status">
        <Check className="h-3 w-3" aria-hidden="true" /> Saved
      </span>
    );
  }
  return null;
}

export default function CommercialAssessmentWorkspace() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isSuperadmin } = usePermissions();
  const { canEdit } = useModulePermissions('clients');

  const {
    record, payload, loading, error, saveState, lastSavedAt,
    update, saveNow, saveTitle, reload,
  } = useCiAssessment(id ?? null);


  const [calculating, setCalculating] = useState(false);
  const [savedResult, setSavedResult] = useState<AssessmentResult | null>(null);
  const [showAllErrors, setShowAllErrors] = useState(false);

  const stepParam = searchParams.get('step') as StepKey | null;
  const activeStep: StepKey = STEPS.some((step) => step.key === stepParam) ? stepParam! : 'type';
  const activeIndex = STEPS.findIndex((step) => step.key === activeStep);

  const goToStep = useCallback((key: StepKey, options?: { scrollToTop?: boolean }) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('step', key);
      return next;
    }, { replace: true });
    // Focus lands at the top of the new step rather than wherever the click was
    // — unless the caller is about to scroll to a specific field, in which case
    // two competing smooth scrolls would fight each other.
    if (options?.scrollToTop !== false) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setSearchParams]);

  /**
   * Permissions. Overriding policy assumptions is deliberately narrower than
   * editing an assessment — modelling a deal and moving a DSCR hurdle are not
   * the same authority. Server-side checks in the edge function are the real
   * enforcement; these flags only shape what is offered.
   */
  const canOverridePolicy = isSuperadmin || canEdit;
  const canLinkClient = isSuperadmin || canEdit;
  const canUpdateClient = isSuperadmin || canEdit;

  // Live result, recomputed from the working payload on every change. Cheap
  // enough to run inline — the engine is pure arithmetic with no I/O.
  const liveResult = useMemo(
    () => (payload ? runAssessment(payload) : null),
    [payload],
  );

  const validation = useMemo(
    () => (payload ? validateAssessment(payload) : null),
    [payload],
  );

  const issues = useMemo(
    () => (validation ? [...validation.errors, ...validation.warnings] : []),
    [validation],
  );

  const errors = validation?.errors ?? EMPTY_ISSUES;

  /**
   * Errors per step, keyed by the step the user has to visit to fix them.
   *
   * `issue.section` is a stable key rather than a position. It used to be a
   * number resolved as `STEPS[step - 1]`, which meant inserting the Intake pack
   * chip shifted every issue one step short — a Loan structure error marked the
   * Lease income chip and opened the wrong panel.
   */
  const errorsByStep = useMemo(() => {
    const index = new Map<string, ValidationIssue[]>();
    for (const issue of errors) {
      const bucket = index.get(issue.section);
      if (bucket) bucket.push(issue);
      else index.set(issue.section, [issue]);
    }
    return index;
  }, [errors]);

  /**
   * Open the step an issue belongs to, then scroll to and ring the field.
   *
   * Landing on the right step is not enough on a step with forty inputs: the
   * summary has to put the user on the actual control. Fields that are not
   * rendered — an add-back orphaned from a deleted period, say — simply leave
   * the user at the top of the right step, which is still the correct place.
   */
  const goToIssue = useCallback((issue: ValidationIssue) => {
    if (issue.section !== activeStep) {
      goToStep(issue.section, { scrollToTop: false });
    }
    focusAssessmentFieldWhenReady(issue.field);
  }, [activeStep, goToStep]);

  useEffect(() => {
    if (error && saveState !== 'conflict') {
      toast({ title: 'Assessment error', description: error, variant: 'destructive' });
    }
  }, [error, saveState]);

  /**
   * Read-only means archived, and nothing else.
   *
   * It used to mean "completed or linked", which locked every field on the
   * step the moment the assessment was marked complete — and the server
   * refused the autosave behind it with "An assessment with status
   * \"completed\" cannot be edited. Reopen it first", pointing at a reopen
   * action that does not exist. A deal keeps moving after the assessment is
   * complete: a valuation lands, a rate moves, a tenancy is re-signed.
   *
   * What completion protects is the stored calculation run, and the run
   * protects itself — it holds its own inputs, policy and outputs, and reports
   * are produced from it rather than from the working payload. So editing is
   * allowed and the divergence is *shown* (see `figuresChanged` below) rather
   * than prevented.
   */
  const readOnly = record?.status === 'archived';

  /**
   * Whether the working data has moved away from the completed calculation.
   *
   * Editing a completed assessment is allowed, so something has to say when
   * the figures on screen are no longer the figures the assessment was
   * completed on — otherwise a report generated afterwards states one set of
   * numbers while the workspace shows another, and nobody is told which is
   * which. The stored columns are written only by a base calculation run, so
   * comparing them to the live result is an exact test of "has anything moved
   * since the last run".
   *
   * Whole dollars and 4dp ratios both round to the same tolerance here; the
   * comparison is deliberately loose enough not to fire on float noise.
   */
  const figuresChanged = useMemo(() => {
    if (!record || !liveResult) return false;
    if (record.status !== 'completed' && record.status !== 'linked') return false;
    if (!record.current_calculation_id) return false;

    const moved = (stored: number | null, live: number, tolerance: number) => (
      stored == null ? live > 0 : Math.abs(stored - live) > tolerance
    );
    return moved(record.maximum_indicative_loan, liveResult.summary.maximumIndicativeLoan, 1)
      || moved(record.requested_loan, liveResult.summary.requestedLoan, 1)
      || moved(record.proposed_lvr, liveResult.summary.proposedLvr, 0.0001)
      || moved(record.proposed_dscr, liveResult.summary.proposedDscr, 0.0001);
  }, [record, liveResult]);

  const { generatingId, generate } = useCapacityReport();

  const setPayload = useCallback((next: AssessmentPayload) => {
    update(next, STEPS[activeIndex]?.section);
  }, [update, activeIndex]);

  const setTitle = useCallback(async (title: string) => {
    // No refetch here: reloading the assessment dropped the workspace into its
    // loading state and destroyed the input mid-typing.
    await saveTitle(title);
  }, [saveTitle]);


  /**
   * Merge a returned intake pack into the working assessment.
   *
   * Scalar sections merge field-by-field so a value the pack did not carry
   * cannot blank out something already entered here. Collections replace
   * wholesale — a half-merged list of entities or liabilities, matched on
   * nothing more reliable than array position, would be worse than either
   * keeping or replacing the set outright.
   */
  const applyIntakePack = useCallback((parsed: ParsedPack) => {
    if (!payload) return;
    const incoming = parsed.payload;

    // A blank, zero or absent value in the pack means "not answered", not
    // "set this to nothing" — so those are skipped rather than written over.
    const mergeScalars = <T,>(current: T, next: T): T => {
      const merged = { ...(current as Record<string, unknown>) };
      Object.entries(next as Record<string, unknown>).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        if (typeof value === 'string' && value.trim() === '') return;
        if (typeof value === 'number' && value === 0) return;
        if (Array.isArray(value)) return;
        merged[key] = value;
      });
      return merged as T;
    };

    const next: AssessmentPayload = {
      ...payload,
      assessmentType: incoming.assessmentType ?? payload.assessmentType,
      property: mergeScalars(payload.property, incoming.property),
      loan: mergeScalars(payload.loan, incoming.loan),
      lease: {
        ...mergeScalars(payload.lease, incoming.lease),
        tenancies: incoming.lease.tenancies.length ? incoming.lease.tenancies : payload.lease.tenancies,
      },
      ownership: {
        ...mergeScalars(payload.ownership, incoming.ownership),
        entities: incoming.ownership.entities.length ? incoming.ownership.entities : payload.ownership.entities,
      },
      income: {
        ...payload.income,
        periods: incoming.income.periods.length ? incoming.income.periods : payload.income.periods,
        addbacks: incoming.income.periods.length ? incoming.income.addbacks : payload.income.addbacks,
      },
      portfolio: {
        ...payload.portfolio,
        assets: incoming.portfolio.assets.length ? incoming.portfolio.assets : payload.portfolio.assets,
        liabilities: incoming.portfolio.liabilities.length
          ? incoming.portfolio.liabilities : payload.portfolio.liabilities,
      },
      // Keep prior provenance and append the pack's, so a field imported from a
      // URL earlier still shows where it came from.
      provenance: [...payload.provenance, ...parsed.provenance],
    };

    update(next, 'intakePack');
  }, [payload, update]);

  const calculate = useCallback(async () => {
    if (!id || !payload || !liveResult) return;
    setCalculating(true);
    // Persist the working payload first: a calculation run must snapshot the
    // inputs that are actually saved, not a draft the server has never seen.
    await saveNow('calculation');
    const result = await ciAssessmentApi.runCalculation({ assessmentId: id, payload, result: liveResult });
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
    goToStep('results');
  }, [id, payload, liveResult, saveNow, reload, goToStep]);

  const complete = useCallback(async () => {
    if (!id) return;
    const result = await ciAssessmentApi.complete(id);
    if (result.error) {
      toast({ title: 'Could not complete', description: result.error, variant: 'destructive' });
      return;
    }
    await reload();
    toast({ title: 'Assessment completed', description: 'You can now link it to a client, or keep it standalone.' });
    goToStep('link');
  }, [id, reload, goToStep]);

  /**
   * Generate the Capacity Report.
   *
   * This used to be `window.print()`. That was never a document — it was a
   * screenshot of an application, carrying the app's own typography and
   * whatever the browser decided to do with a flex layout at A4, and it changed
   * every time the results screen did.
   *
   * It is now `render-commercial-capacity-pdf`: the tenant's brand, the
   * report design system, and the figures from the *saved* calculation run
   * rather than from the live working data on screen. Those two can differ —
   * that is exactly what the banner above the results warns about — and a
   * report has to state the figures that were recorded, not the ones currently
   * being typed.
   */
  const generateReport = useCallback(() => {
    if (!id) return;
    void generate(id);
  }, [id, generate]);

  if (loading) {
    return (
      <div className="ci-shell">
        <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading assessment…
        </div>
      </div>
    );
  }

  if (!record || !payload || !liveResult) {
    return (
      <div className="ci-shell space-y-4">
        <div className="ci-warning-row ci-warning-critical">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>{error ?? 'This assessment could not be found, or you do not have access to it.'}</span>
        </div>
        <Button variant="outline" onClick={() => navigate('/commercial')}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Back to Commercial &amp; Industrial
        </Button>
      </div>
    );
  }

  const definition = assessmentTypeDefinition(payload.assessmentType);
  const SegmentIcon = definition.segment === 'industrial' ? Factory : Building2;

  return (
    <div className="ci-foundation ci-workspace">
      <header className="ci-workspace-header">
        <div className="ci-workspace-header-inner">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              size="icon" variant="ghost" className="h-8 w-8 shrink-0"
              onClick={() => navigate('/commercial')}
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
                {record.reference} · {definition.label} · v{record.version}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline" className="ci-status-badge ci-status-neutral">
              {ASSESSMENT_STATUS_LABELS[record.status]}
            </Badge>
            <SaveIndicator state={saveState} savedAt={lastSavedAt} />
            {saveState === 'conflict' ? (
              <Button size="sm" variant="outline" onClick={reload}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Reload
              </Button>
            ) : null}
            <Button size="sm" onClick={calculate} disabled={calculating || readOnly}>
              {calculating
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
              {calculating ? 'Calculating…' : 'Run calculation'}
            </Button>
          </div>
        </div>

        <nav className="mx-auto w-full max-w-[1600px] px-4 pb-3 sm:px-6 lg:px-8" aria-label="Assessment steps">
          <ol className="ci-steps">
            {STEPS.map((step, index) => {
              const isActive = step.key === activeStep;
              const stepErrors = errorsByStep.get(step.key) ?? EMPTY_ISSUES;
              return (
                <li key={step.key}>
                  <button
                    type="button"
                    // Clicking a chip that carries errors goes straight to the
                    // first of them, so the marker and the fix are one action
                    // apart rather than two.
                    onClick={() => (stepErrors.length ? goToIssue(stepErrors[0]) : goToStep(step.key))}
                    aria-current={isActive ? 'step' : undefined}
                    className={cn(
                      'ci-step-chip',
                      isActive && 'ci-step-chip-active',
                      stepErrors.length > 0 && 'ci-step-chip-error',
                    )}
                  >
                    <span className="ci-step-index" aria-hidden="true">{index + 1}</span>
                    <span>{step.label}</span>
                    {stepErrors.length ? (
                      <>
                        <span className="ci-step-error-count" aria-hidden="true">{stepErrors.length}</span>
                        <span className="sr-only">
                          {stepErrors.length} field{stepErrors.length === 1 ? '' : 's'} need attention
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
          {/*
            The error summary. Shown on every step — including Results and Save
            & link — because an error found at the end is exactly the one a user
            needs a way back to. Each row navigates to its step and rings the
            field it names.
          */}
          {errors.length ? (
            <div className="ci-warning-row ci-warning-critical" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {errors.length} field{errors.length === 1 ? '' : 's'} need attention
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    — select one to jump to it.
                  </span>
                </p>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {(showAllErrors ? errors : errors.slice(0, SUMMARY_LIMIT)).map((issue) => (
                    <li key={`${issue.field}-${issue.message}`}>
                      <button
                        type="button"
                        className="ci-issue-link"
                        onClick={() => goToIssue(issue)}
                      >
                        <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="ci-issue-step">{STEP_LABELS.get(issue.section) ?? issue.section}</span>
                        <span>{issue.message}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {errors.length > SUMMARY_LIMIT ? (
                  <Button
                    variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs"
                    onClick={() => setShowAllErrors((current) => !current)}
                  >
                    {showAllErrors
                      ? 'Show fewer'
                      : `Show all ${errors.length}`}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/*
            Editing after completion is allowed; saying nothing about it is
            not. This appears only once the working data has actually moved
            away from the run the assessment was completed on, and it names
            both consequences: what the stored figures still say, and what
            makes them agree again.
          */}
          {figuresChanged ? (
            <div className="ci-warning-row ci-warning-info" role="status">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  The figures on screen have moved since this assessment was completed.
                </p>
                <p className="mt-0.5 text-sm">
                  The saved calculation — and any report produced from it — still states the
                  completed figures. Run the calculation again to bring them up to date; the
                  assessment stays {record.status === 'linked' ? 'linked' : 'completed'} either way.
                </p>
                <Button size="sm" variant="outline" className="mt-2" onClick={calculate} disabled={calculating}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Run calculation
                </Button>
              </div>
            </div>
          ) : null}

          {activeStep === 'type' ? (
            <StepAssessmentType
              payload={payload} title={record.title} onTitleChange={setTitle}
              onChange={setPayload} disabled={readOnly}
              // Renaming is governed by the archive, not by completion: the
              // figures freeze when the assessment completes, the label does
              // not. `rename` on the edge function enforces the same rule.
              titleDisabled={record.status === 'archived'}
            />
          ) : null}
          {activeStep === 'pack' ? (
            <IntakePackPanel
              payload={payload}
              assessmentReference={record.reference}
              assessmentTitle={record.title}
              segment={definition.segment === 'industrial' ? 'industrial' : 'commercial'}
              onApply={applyIntakePack}
              onCreateClient={() => window.open('/clients', '_blank', 'noopener,noreferrer')}
              linkedClientId={record.client_id}
              onOpenClient={() => navigate(clientCommercialIndustrialPath(record.client_id!))}
              disabled={readOnly}
            />
          ) : null}
          {activeStep === 'property' ? (
            <StepPropertyTransaction payload={payload} onChange={setPayload} issues={issues} disabled={readOnly} />
          ) : null}
          {activeStep === 'ownership' ? (
            <StepOwnership payload={payload} onChange={setPayload} issues={issues} disabled={readOnly} />
          ) : null}
          {activeStep === 'income' ? (
            <StepIncome payload={payload} onChange={setPayload} issues={issues} disabled={readOnly} />
          ) : null}
          {activeStep === 'portfolio' ? (
            <StepPortfolio payload={payload} onChange={setPayload} issues={issues} disabled={readOnly} />
          ) : null}
          {activeStep === 'lease' ? (
            <StepLeaseIncome payload={payload} onChange={setPayload} issues={issues} disabled={readOnly} />
          ) : null}
          {activeStep === 'loan' ? (
            <StepLoanStructure
              payload={payload} onChange={setPayload} issues={issues}
              canOverridePolicy={canOverridePolicy} disabled={readOnly}
            />
          ) : null}
          {activeStep === 'results' ? (
            <>
              {!record.current_calculation_id ? (
                <div className="ci-warning-row ci-warning-info">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    These figures are live from your working data and have not been saved as a calculation
                    run yet. Run the calculation to snapshot the inputs, policy and outputs together.
                  </span>
                </div>
              ) : null}
              <StepResults
                payload={payload}
                result={savedResult ?? liveResult}
                onRecalculate={calculate}
                onGenerateReport={generateReport}
                calculating={calculating}
                // Completion, not just a saved calculation. The report states
                // the figures of the run the assessment points at, and until it
                // is completed that run is still moving — a PDF of it would be
                // a document that was true for as long as it took to download.
                // The route enforces the same rule, so a stale tab cannot get
                // round it.
                canGenerateReport={record.status === 'completed' || record.status === 'linked'}
                generatingReport={generatingId === record.id}
                reportBlockedReason={
                  record.current_calculation_id
                    ? 'Complete the assessment to generate its report — the report is produced from the completed calculation run.'
                    : 'Run a calculation and complete the assessment to generate its report.'
                }
              />
              {record.status !== 'completed' && record.status !== 'linked' ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
                  <Button onClick={complete} disabled={!record.current_calculation_id}>
                    Complete assessment
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    {record.current_calculation_id
                      ? 'Locks the working data and opens the client-linking step.'
                      : 'Run a calculation before completing.'}
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
          {activeStep === 'link' ? (
            record.status === 'completed' || record.status === 'linked' ? (
              <StepClientLink
                assessmentId={record.id}
                payload={payload}
                linkedClientId={record.client_id}
                onLinked={reload}
                canLink={canLinkClient}
                canUpdateClient={canUpdateClient}
              />
            ) : (
              <div className="ci-step-panel">
                <h2 className="ci-step-heading">Save and link</h2>
                <p className="ci-step-description">
                  Client linking opens once the assessment is complete. Run the calculation, review the
                  result, then complete the assessment.
                </p>
                <Button variant="outline" onClick={() => goToStep('results')}>
                  Go to results
                </Button>
              </div>
            )
          ) : null}

          {/* Step navigation */}
          <nav className="flex items-center justify-between gap-3 border-t border-border pt-4" aria-label="Step navigation">
            <Button
              variant="outline" size="sm" disabled={activeIndex === 0}
              onClick={() => goToStep(STEPS[Math.max(0, activeIndex - 1)].key)}
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Step {activeIndex + 1} of {STEPS.length}
            </span>
            <Button
              size="sm" disabled={activeIndex === STEPS.length - 1}
              onClick={async () => {
                await saveNow(STEPS[activeIndex]?.section);
                goToStep(STEPS[Math.min(STEPS.length - 1, activeIndex + 1)].key);
              }}
            >
              Next <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </nav>
        </main>

        <ResultsRail result={liveResult} onJumpToResults={() => goToStep('results')} />
      </div>
    </div>
  );
}
