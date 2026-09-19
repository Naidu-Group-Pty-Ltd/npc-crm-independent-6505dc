/**
 * What happened when the workflow ran.
 *
 * A builder's first question after pressing run is never "did it succeed" — it
 * is "which step, and what did it actually have in its hands". So the timeline
 * leads with the step, its status and how long it took, and opens to the
 * resolved config: the values after `{{…}}` substitution, which is where nearly
 * every real workflow bug is visible.
 *
 * Unresolved references are called out separately rather than buried in the
 * config, because a blank field and a field that silently resolved to nothing
 * look identical once rendered.
 */

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  FlaskConical,
  History,
  Inbox,
  Loader2,
  OctagonMinus,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { RunResult, StepResult, StepStatus } from '@/lib/workflow/runtime/engine';
import type { RunSummary } from '@/hooks/useWorkflowRuns';
import type { CapturedEvent } from '@/hooks/useTriggerEvents';

interface RunPanelProps {
  result: RunResult | null;
  running: boolean;
  /** Captured platform events this workflow's triggers would accept. */
  events: CapturedEvent[];
  eventsLoading: boolean;
  /** Everything captured platform-wide, for context when `events` is empty. */
  totalCaptured: number;
  workflowIsLive: boolean;
  history: RunSummary[];
  historyLoading: boolean;
  persistenceWarning: string | null;
  onClose: () => void;
  onFocusNode: (nodeId: string) => void;
}

const STATUS_LABEL: Record<StepStatus, string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
  simulated: 'Simulated',
  halted: 'Stopped here',
};

function StepIcon({ status }: { status: StepStatus }) {
  const className = 'h-4 w-4 shrink-0';
  switch (status) {
    case 'succeeded':
      return <CheckCircle2 className={cn(className, 'text-success')} aria-hidden="true" />;
    case 'failed':
      return <AlertTriangle className={cn(className, 'text-destructive')} aria-hidden="true" />;
    case 'simulated':
      return <FlaskConical className={cn(className, 'text-primary')} aria-hidden="true" />;
    case 'halted':
      return <OctagonMinus className={cn(className, 'text-warning')} aria-hidden="true" />;
    default:
      return <CircleSlash className={cn(className, 'text-muted-foreground')} aria-hidden="true" />;
  }
}

const duration = (ms: number | null | undefined) => {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

/** Compact JSON, so an empty object reads as empty rather than as `{}\n`. */
const preview = (value: unknown): string => {
  if (value == null) return '—';
  if (typeof value === 'object' && !Object.keys(value as object).length) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

function StepRow({ step, onFocusNode }: { step: StepResult; onFocusNode: (id: string) => void }) {
  const [open, setOpen] = useState(step.status === 'failed');

  return (
    <li className="border-b border-border/50 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')}
          aria-hidden="true"
        />
        <StepIcon status={step.status} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{step.label}</span>
        {step.branchTaken && (
          <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] font-medium">
            {step.branchTaken}
          </Badge>
        )}
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {duration(step.durationMs)}
        </span>
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3 pl-9 text-xs">
          <p className="text-muted-foreground">
            {STATUS_LABEL[step.status]}
            {step.error ? ' — ' : ''}
            {step.error && <span className="text-destructive">{step.error}</span>}
          </p>

          {step.simulationNote && (
            <p className="rounded-md border border-primary/25 bg-primary/10 px-2 py-1.5 text-foreground">
              {step.simulationNote}
            </p>
          )}

          {step.missingReferences.length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning/15 px-2 py-1.5">
              <p className="font-medium text-foreground">
                {step.missingReferences.length === 1
                  ? 'One reference had no value'
                  : `${step.missingReferences.length} references had no value`}
              </p>
              <p className="mt-1 flex flex-wrap gap-1">
                {step.missingReferences.map((reference) => (
                  <code key={reference} className="wf-token">
                    {reference}
                  </code>
                ))}
              </p>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-1 font-medium text-muted-foreground">Sent</p>
              <pre className="max-h-40 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] text-foreground">
                {preview(step.resolvedConfig)}
              </pre>
            </div>
            <div className="min-w-0">
              <p className="mb-1 font-medium text-muted-foreground">Returned</p>
              <pre className="max-h-40 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] text-foreground">
                {preview(step.output)}
              </pre>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => onFocusNode(step.nodeId)}
          >
            Open this step
          </Button>
        </div>
      )}
    </li>
  );
}

export function RunPanel({
  result,
  running,
  events,
  eventsLoading,
  totalCaptured,
  workflowIsLive,
  history,
  historyLoading,
  persistenceWarning,
  onClose,
  onFocusNode,
}: RunPanelProps) {
  const failedCount = result?.steps.filter((s) => s.status === 'failed').length ?? 0;

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        {running ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        ) : result?.status === 'succeeded' ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        ) : result?.status === 'failed' ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        ) : (
          <OctagonMinus className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        )}

        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {running
            ? 'Running…'
            : result
              ? result.status === 'succeeded'
                ? 'Run finished'
                : result.status === 'failed'
                  ? `Run failed — ${failedCount} step${failedCount === 1 ? '' : 's'}`
                  : 'Run stopped early'
              : 'Runs'}
        </h2>

        {result && !running && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {result.steps.length} steps · {duration(result.durationMs)}
          </span>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
          aria-label="Close the run panel"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {result?.haltReason && (
        <p className="border-b border-border/60 bg-warning/15 px-3 py-1.5 text-xs text-foreground">
          {result.haltReason}
        </p>
      )}

      {persistenceWarning && (
        <p className="border-b border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
          {persistenceWarning}
        </p>
      )}

      <Tabs defaultValue="current" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 mt-2 grid w-fit grid-cols-3">
          <TabsTrigger value="current" className="text-xs">
            This run
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs">
            <History className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            History
          </TabsTrigger>
          <TabsTrigger value="events" className="text-xs">
            <Inbox className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Events
            {events.length > 0 && (
              <span className="ml-1.5 tabular-nums text-muted-foreground">{events.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="mt-2 min-h-0 flex-1">
          <ScrollArea className="wf-scroll h-full">
            {!result ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {running ? 'Working through the steps…' : 'Press Test run to see what each step would do.'}
              </p>
            ) : result.steps.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Nothing ran. {result.haltReason ?? 'Check the workflow has a trigger.'}
              </p>
            ) : (
              <ul>
                {result.steps.map((step) => (
                  <StepRow key={`${step.nodeId}-${step.startedAt}`} step={step} onFocusNode={onFocusNode} />
                ))}
              </ul>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="history" className="mt-2 min-h-0 flex-1">
          <ScrollArea className="wf-scroll h-full">
            {historyLoading ? (
              <p className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Loading past runs…
              </p>
            ) : history.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No runs yet. Every run you start is kept here.
              </p>
            ) : (
              <ul className="divide-y divide-border/50">
                {history.map((run) => (
                  <li key={run.id} className="flex items-center gap-2 px-3 py-2">
                    <StepIcon status={run.status === 'succeeded' ? 'succeeded' : run.status === 'failed' ? 'failed' : 'halted'} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">
                        {new Date(run.startedAt).toLocaleString('en-AU')}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {run.stepCount} step{run.stepCount === 1 ? '' : 's'}
                        {run.failedStepCount > 0 && ` · ${run.failedStepCount} failed`}
                        {run.haltReason && ` · ${run.haltReason}`}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'h-5 shrink-0 px-1.5 text-[10px]',
                        run.mode === 'live' && 'border-primary/40 text-primary',
                      )}
                    >
                      {run.mode === 'live' ? 'Live' : 'Test'}
                    </Badge>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {duration(run.durationMs)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="events" className="mt-2 min-h-0 flex-1">
          <ScrollArea className="wf-scroll h-full">
            {eventsLoading ? (
              <p className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Checking for captured events…
              </p>
            ) : events.length === 0 ? (
              <div className="space-y-2 px-3 py-6 text-center">
                <p className="text-xs font-medium text-foreground">
                  {workflowIsLive ? 'Nothing has matched this trigger yet' : 'This workflow is not live'}
                </p>
                <p className="mx-auto max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                  {workflowIsLive
                    ? totalCaptured > 0
                      ? `${totalCaptured} event${totalCaptured === 1 ? '' : 's'} captured across all workflows, but none this trigger accepts — check the filters on the trigger step.`
                      : 'Events are captured the moment a matching record changes, and dispatched about a minute later. Nothing has happened yet.'
                    : 'Events are only captured for live workflows. Set the status to Live to start recording them.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/50">
                {events.map((event) => (
                  <li key={event.id} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Inbox className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                        {event.triggerType.replace(/^platform\./, '').replace(/_/g, ' ')}
                      </span>
                      <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
                        {event.status}
                      </Badge>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {new Date(event.occurredAt).toLocaleString('en-AU')}
                      </span>
                    </div>
                    {event.lastError && (
                      <p className="mt-1 pl-5 text-[11px] text-destructive">{event.lastError}</p>
                    )}
                    <pre className="mt-1 ml-5 max-h-24 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] text-foreground">
                      {preview(event.payload)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
