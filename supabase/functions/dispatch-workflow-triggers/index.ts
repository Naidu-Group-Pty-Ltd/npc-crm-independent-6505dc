/**
 * Runs live workflows when something happens.
 *
 * ## What was missing
 *
 * Row triggers on `clients`, `generated_reports` and `purchase_files` have been
 * capturing into `workflow_trigger_events` since that table was created, and
 * `matchTrigger` has known which live workflows an event should start. Nothing
 * joined the two. Every captured event sat at `pending`, and a workflow marked
 * Live meant only "marked ready" — the status control's own toast said so. This
 * is the missing half: claim the events, and run what they start.
 *
 * ## Why the engine is imported rather than reimplemented
 *
 * A workflow's meaning — branch ordering, which paths a filter skips, when a
 * run halts — is decided by `_shared/workflow/engine.pure.ts`, the same module
 * the browser runs for Test run and Run live. Writing a Deno-flavoured second
 * engine here would create two answers to "what does this saved graph do", and
 * they would diverge on the first branch anyone reported a bug about. That is
 * why the engine, the catalog and the matcher were moved into `_shared`.
 *
 * The one thing this adds is a performer: in the browser the engine calls back
 * to `execute-workflow-step` per step, and here it calls `executeStep` directly
 * — the same executor, without the round trip.
 *
 * ## Exactly once, or at least visibly not
 *
 * Claiming is `FOR UPDATE SKIP LOCKED` in Postgres (see the migration), because
 * pg_cron does not wait for the previous run and a workflow dispatched twice
 * sends the message twice. This function's part of the bargain is to never
 * *begin* an event it cannot finish: it stops taking work at a wall-clock
 * budget well short of the Edge ceiling, so events are left pending for the
 * next tick rather than killed mid-workflow with their side effects half done.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enforceJsonBodyLimit, verifySignedInternal } from '../_shared/requestSecurity.ts';
import { runWorkflow, type Perform, type RunResult, type StepResult } from '../_shared/workflow/engine.pure.ts';
import { planDispatch, resolveEvent, hasRoomForAnotherEvent, type WorkflowRunOutcome } from '../_shared/workflow/dispatch.pure.ts';
import { LIVE_CAPABLE_STEP_TYPES, executeStep, type StepClient } from '../_shared/workflow/stepExecutor.ts';
import type { MatchCandidate } from '../_shared/workflow/triggerMatch.pure.ts';
import type { WorkflowGraph } from '../_shared/workflow/types.pure.ts';

/** Events taken per invocation. The budget usually binds first. */
const CLAIM_LIMIT = 20;

interface WorkflowRow {
  id: string;
  status: string;
  graph: unknown;
  created_by: string | null;
}

interface ClaimedRow {
  id: string;
  trigger_type: string;
  payload: unknown;
  occurred_at: string;
  attempts: number;
}

/** Postgres rejects NUL inside jsonb, and a step's output is whatever an endpoint returned. */
const NUL = /\u0000/g;
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(NUL, '');
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]),
    );
  }
  return value;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** A saved graph is untyped JSON; anything malformed is not runnable. */
function toGraph(value: unknown): WorkflowGraph | null {
  const candidate = value as Partial<WorkflowGraph> | null;
  if (!candidate || typeof candidate !== 'object') return null;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return null;
  return { nodes: candidate.nodes, edges: candidate.edges };
}

/**
 * The engine's route to the outside world, server side.
 *
 * Mirrors `runtime/transport.ts` in the browser, including its refusal to send
 * a step the executor does not implement — the message is the one a person
 * would have seen had they pressed Run live themselves.
 */
function createDispatchPerformer(supabase: StepClient, userId: string | null): Perform {
  return async ({ definition, node, config }) => {
    // A dispatched run has no HTTP caller waiting on it, so there is nothing to
    // answer. Recording it as succeeded-with-a-note is truer than failing a
    // step whose only fault is that this run did not come from a webhook.
    if (node.type === 'core.webhook_respond') {
      return {
        status: 'succeeded',
        output: { status: Number(config.status ?? 200), body: config.body ?? null },
        simulationNote: 'This run was started by a platform event, so there was no caller to reply to.',
      };
    }

    if (!LIVE_CAPABLE_STEP_TYPES.has(node.type)) {
      return {
        status: 'failed',
        error: `${definition.name} has no executor yet, so it cannot run unattended. Replace it with an HTTP request step.`,
      };
    }

    try {
      const outcome = await executeStep(node.type, config, { supabase, userId });
      return {
        status: outcome.status,
        output: asRecord(outcome.output),
        error: outcome.error,
      };
    } catch (cause) {
      // A throw here is this step failing, not the run failing to dispatch.
      return { status: 'failed', error: cause instanceof Error ? cause.message : 'The step could not be performed.' };
    }
  };
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

/**
 * Writes the run to history.
 *
 * Unlike the browser's best-effort persistence, a failure here is reported back
 * to the caller: an unattended run nobody can see afterwards is not much better
 * than one that never happened, so it counts as a dispatch failure and the
 * event is retried.
 */
/** Only the client surface `persistRun` uses. */
interface RunWriter {
  from(table: string): {
    insert(rows: unknown): {
      select(columns: string): {
        single(): Promise<{ data: { id?: string } | null; error: { message: string } | null }>;
      };
    } & Promise<{ error: { message: string } | null }>;
  };
}

async function persistRun(
  supabase: RunWriter,
  workflowId: string,
  run: RunResult,
  triggerPayload: Record<string, unknown>,
  startedBy: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('workflow_runs')
    .insert({
      workflow_id: workflowId,
      mode: 'live',
      status: run.status,
      trigger_payload: jsonSafe(triggerPayload),
      halt_reason: run.haltReason ?? null,
      step_count: run.steps.length,
      failed_step_count: run.steps.filter((s) => s.status === 'failed').length,
      duration_ms: run.durationMs,
      started_by: startedBy,
      started_at: run.startedAt,
      finished_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  const runId = (data as { id?: string } | null)?.id;
  if (error || !runId) return null;

  if (run.steps.length) {
    await supabase
      .from('workflow_run_steps')
      .insert(run.steps.map((step, index) => stepRow(runId, step, index)));
  }
  return runId;
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // pg_cron and nothing else. The schedule signs its call as `pg_cron` through
  // `cron_invoke_signed_function`; an unsigned request never reaches the queue.
  const parsed = await enforceJsonBodyLimit<Record<string, unknown>>(req, 1024);
  if (!parsed.ok) return parsed.error;
  const auth = await verifySignedInternal(supabase, req, parsed.raw, ['pg_cron']);
  if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

  const startedAt = Date.now();
  const claimant = `dispatch-${crypto.randomUUID().slice(0, 8)}`;

  const { data: claimed, error: claimError } = await supabase.rpc('claim_workflow_trigger_events', {
    p_limit: CLAIM_LIMIT,
    p_claimed_by: claimant,
  });
  if (claimError) {
    console.error('[dispatch-workflow-triggers] claim failed:', claimError.message);
    return json({ error: 'claim_failed', detail: claimError.message }, 500);
  }

  const events = (claimed ?? []) as ClaimedRow[];
  if (!events.length) return json({ claimed: 0, dispatched: 0, runs: 0 });

  // Live workflows are read once for the whole batch rather than per event:
  // there are few of them, and re-reading per event would multiply a query by
  // however many events a quiet minute happened to accumulate.
  const { data: workflowRows, error: workflowError } = await supabase
    .from('workflows')
    .select('id, status, graph, created_by')
    .eq('status', 'live');

  if (workflowError) {
    console.error('[dispatch-workflow-triggers] could not read workflows:', workflowError.message);
    // Put every claim back; this is not the events' fault.
    for (const event of events) {
      await supabase.rpc('release_workflow_trigger_event', {
        p_id: event.id,
        p_status: 'pending',
        p_last_error: workflowError.message,
        // Never attempted — the workflows could not be read, which is not this
        // event's fault and must not spend one of its retries.
        p_refund_attempt: true,
      });
    }
    return json({ error: 'workflows_unreadable', detail: workflowError.message }, 500);
  }

  const rows = (workflowRows ?? []) as WorkflowRow[];
  const graphs = new Map<string, WorkflowGraph>();
  const owners = new Map<string, string | null>();
  const candidates: MatchCandidate[] = [];
  for (const row of rows) {
    const graph = toGraph(row.graph);
    if (!graph) continue;
    graphs.set(row.id, graph);
    owners.set(row.id, row.created_by);
    candidates.push({ workflowId: row.id, status: row.status, graph });
  }

  let dispatched = 0;
  let runs = 0;
  let deferred = 0;

  for (const event of events) {
    // Stop taking work before a workflow can be cut off half-finished. What is
    // left stays claimed and is reaped by the next invocation's stale sweep.
    if (!hasRoomForAnotherEvent(Date.now() - startedAt)) {
      await supabase.rpc('release_workflow_trigger_event', {
        p_id: event.id,
        p_status: 'pending',
        p_last_error: null,
        // Put back untried, so the claim's attempt increment is given back.
        p_refund_attempt: true,
      });
      deferred += 1;
      continue;
    }

    const payload = asRecord(event.payload);
    const matches = planDispatch({ triggerType: event.trigger_type, payload }, candidates);
    const outcomes: WorkflowRunOutcome[] = [];

    for (const match of matches) {
      const graph = graphs.get(match.workflowId);
      if (!graph) continue;
      const owner = owners.get(match.workflowId) ?? null;

      try {
        const run = await runWorkflow(graph, {
          triggerPayload: payload,
          perform: createDispatchPerformer(supabase as unknown as StepClient, owner),
          // A live automation must not hold an Edge invocation open for a
          // two-day pause; the delay is recorded and the run continues, as it
          // does for a test run. Real waiting needs a scheduler, not a sleep.
          honourDelays: false,
        });

        const runId = await persistRun(
          supabase as unknown as RunWriter, match.workflowId, run, payload, owner,
        );
        if (!runId) {
          outcomes.push({ workflowId: match.workflowId, status: run.status, error: 'The run could not be recorded.' });
          continue;
        }
        runs += 1;
        outcomes.push({ workflowId: match.workflowId, status: run.status });
      } catch (cause) {
        outcomes.push({
          workflowId: match.workflowId,
          status: 'failed',
          error: cause instanceof Error ? cause.message : 'The workflow could not be dispatched.',
        });
      }
    }

    const resolution = resolveEvent(outcomes, event.attempts, matches.length);
    await supabase.rpc('release_workflow_trigger_event', {
      p_id: event.id,
      p_status: resolution.status,
      p_last_error: resolution.lastError,
      // This one WAS attempted, whatever the outcome, so the attempt stands.
      p_refund_attempt: false,
    });
    if (resolution.status !== 'pending') dispatched += 1;
  }

  return json({
    claimed: events.length,
    dispatched,
    deferred,
    runs,
    liveWorkflows: candidates.length,
    elapsedMs: Date.now() - startedAt,
  });
});
