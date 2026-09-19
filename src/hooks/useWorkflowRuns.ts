/**
 * Runs a workflow and keeps its history.
 *
 * The engine decides what a run means (`src/lib/workflow/runtime/engine.ts`);
 * this hook supplies the two things it will not do itself — which performer to
 * use, and where the result goes afterwards.
 *
 * Persistence is best-effort by design. A test run that executed correctly but
 * failed to write its history is still a successful run, and losing the result
 * on screen because a row would not insert would be the worse failure.
 *
 * Reads and writes go straight to Postgres under RLS, for the same reason as
 * `useWorkflows`: routing them through the manage-templates broker made the
 * feature depend on that function's hand-maintained table allow-list being
 * redeployed. Both run tables carry admin-or-superadmin policies.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { runWorkflow } from '@/lib/workflow/runtime/engine';
import type { RunResult, StepResult } from '@/lib/workflow/runtime/engine';
import { simulate } from '@/lib/workflow/runtime/performers';
import { createServerPerformer } from '@/lib/workflow/runtime/transport';
import type { WorkflowGraph } from '@/lib/workflow/types';

export type RunMode = 'test' | 'live';

export interface RunSummary {
  id: string;
  mode: RunMode;
  status: string;
  haltReason: string | null;
  stepCount: number;
  failedStepCount: number;
  durationMs: number | null;
  startedAt: string;
}

interface RunRow {
  id: string;
  mode: string;
  status: string;
  halt_reason: string | null;
  step_count: number;
  failed_step_count: number;
  duration_ms: number | null;
  started_at: string;
}

const toSummary = (row: RunRow): RunSummary => ({
  id: row.id,
  mode: row.mode === 'live' ? 'live' : 'test',
  status: row.status,
  haltReason: row.halt_reason,
  stepCount: row.step_count ?? 0,
  failedStepCount: row.failed_step_count ?? 0,
  durationMs: row.duration_ms,
  startedAt: row.started_at,
});

/** How many past runs the panel shows. Older ones stay in the table. */
const HISTORY_LIMIT = 20;

/**
 * Postgres rejects NUL inside jsonb, and a step's output can contain
 * whatever an endpoint returned. Stripping it here keeps one odd byte in an API
 * response from failing the whole insert.
 */
const NUL = /\u0000/g;

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(NUL, '');
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]),
    );
  }
  return value;
}

const stepRow = (runId: string, step: StepResult, sequence: number) => ({
  run_id: runId,
  sequence,
  node_id: step.nodeId,
  node_type: step.type,
  label: step.label,
  status: step.status,
  resolved_config: jsonSafe(step.resolvedConfig),
  output: jsonSafe(step.output),
  error: step.error ?? null,
  missing_references: step.missingReferences,
  branch_taken: step.branchTaken ?? null,
  simulation_note: step.simulationNote ?? null,
  duration_ms: step.durationMs,
  started_at: step.startedAt,
});

export function useWorkflowRuns(workflowId: string | null) {
  const { supabase, isAuthenticated } = useAuthenticatedSupabase();
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  /** Set when the run itself succeeded but its history could not be written. */
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    if (!workflowId) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const { data } = await supabase
        .from('workflow_runs')
        .select('id, mode, status, halt_reason, step_count, failed_step_count, duration_ms, started_at')
        .eq('workflow_id', workflowId)
        .order('started_at', { ascending: false })
        .limit(HISTORY_LIMIT);
      setHistory(((data ?? []) as RunRow[]).map(toSummary));
    } catch {
      // History is context, not the feature; a failure here stays quiet.
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [supabase, workflowId]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const persist = useCallback(
    async (mode: RunMode, run: RunResult, triggerPayload: Record<string, unknown>) => {
      if (!workflowId || !isAuthenticated) return;

      const { data, error } = await supabase
        .from('workflow_runs')
        .insert({
          workflow_id: workflowId,
          mode,
          status: run.status,
          trigger_payload: jsonSafe(triggerPayload) as never,
          halt_reason: run.haltReason ?? null,
          step_count: run.steps.length,
          failed_step_count: run.steps.filter((s) => s.status === 'failed').length,
          duration_ms: run.durationMs,
          started_at: run.startedAt,
          finished_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      const runId = (data as { id?: string } | null)?.id;
      if (error || !runId) {
        setPersistenceWarning('This run was not saved to history.');
        return;
      }

      // All steps in one statement — a run with thirty steps should not be
      // thirty round trips.
      if (run.steps.length) {
        const { error: stepsError } = await supabase
          .from('workflow_run_steps')
          .insert(run.steps.map((step, index) => stepRow(runId, step, index)) as never);
        if (stepsError) setPersistenceWarning('The run was saved, but its step detail was not.');
      }

      await refreshHistory();
    },
    [isAuthenticated, refreshHistory, supabase, workflowId],
  );

  const start = useCallback(
    async (
      graph: WorkflowGraph,
      mode: RunMode = 'test',
      triggerPayload: Record<string, unknown> = {},
    ): Promise<RunResult> => {
      setRunning(true);
      setPersistenceWarning(null);
      try {
        const run = await runWorkflow(graph, {
          triggerPayload,
          // The whole safety story in one line: a test run cannot send anything.
          perform: mode === 'live' ? createServerPerformer() : simulate,
          honourDelays: false,
        });
        setResult(run);
        await persist(mode, run, triggerPayload);
        return run;
      } finally {
        setRunning(false);
      }
    },
    [persist],
  );

  const clear = useCallback(() => {
    setResult(null);
    setPersistenceWarning(null);
  }, []);

  return {
    result,
    running,
    history,
    historyLoading,
    persistenceWarning,
    start,
    clear,
    refreshHistory,
  };
}
