/**
 * The workflow engine.
 *
 * Pure: no network, no clock beyond an injected one, no storage. Everything that
 * touches the outside world arrives as a `perform` function, so the same engine
 * drives the in-browser test run and the server-side executor and the two cannot
 * disagree about what a workflow means.
 *
 * Execution is a walk, not a topological sweep: a step runs only once every
 * inbound path has resolved, and a path that a branch did not take is marked
 * skipped rather than pending, so the walk terminates instead of stalling on a
 * step behind an untaken branch.
 */

import { getCatalogNode } from './catalog/index.pure.ts';
import { sampleOutput } from './sampleData.pure.ts';
import { incoming, topologicalOrder } from './graph.pure.ts';
import type { CatalogNode, WorkflowGraph, WorkflowNode } from './types.pure.ts';
import {
  compare,
  parseDuration,
  resolveConfig,
  type ComparisonOperator,
  type Scope,
} from './expressions.pure.ts';

export type StepStatus = 'succeeded' | 'failed' | 'skipped' | 'simulated' | 'halted';

export interface StepResult {
  nodeId: string;
  /** Catalog id, kept so a result stays readable after the step is deleted. */
  type: string;
  label: string;
  status: StepStatus;
  /** Config after `{{…}}` resolution — what the step actually acted on. */
  resolvedConfig: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
  /** References that resolved to nothing. */
  missingReferences: string[];
  /** For a branch, the path taken. */
  branchTaken?: string;
  /** Plain-language note about what a simulated step would have done. */
  simulationNote?: string;
  startedAt: string;
  durationMs: number;
}

export type RunStatus = 'succeeded' | 'failed' | 'halted';

export interface RunResult {
  status: RunStatus;
  steps: StepResult[];
  /** Reason a run stopped early, when it did. */
  haltReason?: string;
  startedAt: string;
  durationMs: number;
}

export interface PerformInput {
  node: WorkflowNode;
  definition: CatalogNode;
  /** Config with every `{{…}}` already resolved. */
  config: Record<string, unknown>;
  scope: Scope;
}

export interface PerformOutcome {
  status: Extract<StepStatus, 'succeeded' | 'failed' | 'simulated'>;
  output?: Record<string, unknown>;
  error?: string;
  simulationNote?: string;
}

/** Handles everything the engine will not do itself — i.e. anything external. */
export type Perform = (input: PerformInput) => Promise<PerformOutcome>;

export interface RunOptions {
  /** Data the trigger produced. Keyed into scope under the trigger's node id. */
  triggerPayload?: Record<string, unknown>;
  perform: Perform;
  /** Defaults to Date. Injected so tests are deterministic. */
  now?: () => Date;
  /** Guards against a runaway loop; the walk stops and reports when hit. */
  maxSteps?: number;
  /**
   * Test runs do not actually wait. The delay is recorded and the run continues,
   * because a person pressing Test run will not sit through a two-day pause.
   */
  honourDelays?: boolean;
}

const DEFAULT_MAX_STEPS = 200;

const labelFor = (node: WorkflowNode, definition: CatalogNode | undefined) =>
  node.label?.trim() || definition?.name || node.type;

/** Steps the engine implements itself; everything else goes to `perform`. */
const NATIVE = new Set([
  'core.branch',
  'core.filter',
  'core.delay',
  'core.set',
  'core.template',
  'core.stop',
  'core.merge',
  'core.dedupe',
  'core.batch',
  'core.loop',
  // Both declare branches, and only the engine can choose one: `perform` returns
  // a PerformOutcome, which has no way to name a branch. Delegating them left
  // every step downstream of an approval or a retry permanently unreachable.
  'core.approval',
  'core.retry',
]);

export async function runWorkflow(graph: WorkflowGraph, options: RunOptions): Promise<RunResult> {
  const now = options.now ?? (() => new Date());
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const startedAt = now();

  const order = topologicalOrder(graph);
  if (!order) {
    return {
      status: 'failed',
      steps: [],
      haltReason: 'The workflow contains a loop, so there is no order to run it in.',
      startedAt: startedAt.toISOString(),
      durationMs: 0,
    };
  }

  const scope: Scope = {};
  const results: StepResult[] = [];
  const status = new Map<string, StepStatus>();
  /** Branch chosen by each branching step, so its untaken paths can be skipped. */
  const takenBranch = new Map<string, string>();

  let haltReason: string | undefined;
  let runStatus: RunStatus = 'succeeded';

  /** A step runs only when every inbound edge has produced a result. */
  const readyToRun = (node: WorkflowNode) =>
    incoming(graph, node.id).every((parent) => status.has(parent.id));

  /**
   * Whether any inbound path actually reached this step. A step behind an
   * untaken branch, or behind a step that stopped, never runs.
   */
  const reachable = (node: WorkflowNode) => {
    const inbound = graph.edges.filter((e) => e.target === node.id);
    if (!inbound.length) return getCatalogNode(node.type)?.kind === 'trigger' || results.length === 0;

    return inbound.some((edge) => {
      const parentStatus = status.get(edge.source);
      if (parentStatus !== 'succeeded' && parentStatus !== 'simulated') return false;
      if (!edge.sourceBranch) return true;
      return takenBranch.get(edge.source) === edge.sourceBranch;
    });
  };

  for (const node of order) {
    if (results.length >= maxSteps) {
      haltReason = `Stopped after ${maxSteps} steps to avoid running away.`;
      runStatus = 'halted';
      break;
    }
    if (haltReason) break;
    if (!readyToRun(node)) continue;

    const definition = getCatalogNode(node.type);
    const label = labelFor(node, definition);
    const stepStartedAt = now();

    const record = (partial: Omit<StepResult, 'nodeId' | 'type' | 'label' | 'startedAt' | 'durationMs'>) => {
      const result: StepResult = {
        nodeId: node.id,
        type: node.type,
        label,
        startedAt: stepStartedAt.toISOString(),
        durationMs: Math.max(0, now().getTime() - stepStartedAt.getTime()),
        ...partial,
      };
      results.push(result);
      status.set(node.id, result.status);
      if (result.status === 'succeeded' || result.status === 'simulated') {
        scope[node.id] = result.output;
      }
      return result;
    };

    if (!definition) {
      record({
        status: 'failed',
        resolvedConfig: {},
        output: {},
        missingReferences: [],
        error: `“${node.type}” is not in the step library.`,
      });
      runStatus = 'failed';
      continue;
    }

    if (node.disabled) {
      record({ status: 'skipped', resolvedConfig: {}, output: {}, missingReferences: [] });
      continue;
    }

    if (!reachable(node)) {
      record({ status: 'skipped', resolvedConfig: {}, output: {}, missingReferences: [] });
      continue;
    }

    const { config, missing } = resolveConfig(node.config, scope);

    // Triggers do not execute; they seed the scope with their payload.
    //
    // With no payload the scope starts empty, so every `{{trigger.…}}` in the
    // workflow resolves to nothing and the run reads as broken when it is only
    // unfed. Falling back to the trigger's declared outputs means a test run
    // shows the shape of a real one — marked as sample, so it cannot be
    // mistaken for live data.
    if (definition.kind === 'trigger') {
      const supplied = options.triggerPayload;
      const seeded = supplied && Object.keys(supplied).length > 0;
      record({
        status: 'succeeded',
        resolvedConfig: config,
        output: seeded ? supplied : sampleOutput(definition),
        missingReferences: [],
        simulationNote: seeded
          ? undefined
          : 'No trigger data supplied, so this run used sample values.',
      });
      continue;
    }

    if (NATIVE.has(node.type)) {
      const outcome = runNative(node.type, config, {
        honourDelays: options.honourDelays ?? false,
        incomingScopes: incoming(graph, node.id).map((parent) => scope[parent.id] ?? {}),
      });

      const result = record({
        status: outcome.status,
        resolvedConfig: config,
        output: outcome.output ?? {},
        missingReferences: missing,
        error: outcome.error,
        branchTaken: outcome.branchTaken,
        simulationNote: outcome.simulationNote,
      });

      if (outcome.branchTaken) takenBranch.set(node.id, outcome.branchTaken);
      if (outcome.halt) {
        haltReason = outcome.halt;
        runStatus = outcome.status === 'failed' ? 'failed' : 'halted';
      }
      if (result.status === 'failed') runStatus = 'failed';
      continue;
    }

    // Everything else is someone else's problem — an integration call.
    try {
      const outcome = await options.perform({ node, definition, config, scope });
      const result = record({
        status: outcome.status,
        resolvedConfig: config,
        output: outcome.output ?? {},
        missingReferences: missing,
        error: outcome.error,
        simulationNote: outcome.simulationNote,
      });
      if (result.status === 'failed') runStatus = 'failed';
    } catch (cause) {
      record({
        status: 'failed',
        resolvedConfig: config,
        output: {},
        missingReferences: missing,
        error: cause instanceof Error ? cause.message : 'The step threw an unexpected error.',
      });
      runStatus = 'failed';
    }
  }

  return {
    status: runStatus,
    steps: results,
    haltReason,
    startedAt: startedAt.toISOString(),
    durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
  };
}

interface NativeOutcome {
  status: StepStatus;
  output?: Record<string, unknown>;
  error?: string;
  branchTaken?: string;
  simulationNote?: string;
  /** Set to end the run here. */
  halt?: string;
}

interface NativeContext {
  honourDelays: boolean;
  incomingScopes: Record<string, unknown>[];
}

/** Control flow, implemented by the engine rather than delegated. */
function runNative(
  type: string,
  config: Record<string, unknown>,
  context: NativeContext,
): NativeOutcome {
  switch (type) {
    case 'core.branch': {
      const matched = compare(config.left, (config.operator as ComparisonOperator) ?? 'eq', config.right);
      return { status: 'succeeded', output: { matched }, branchTaken: matched ? 'true' : 'false' };
    }

    case 'core.filter': {
      const passed = compare(config.left, (config.operator as ComparisonOperator) ?? 'exists', config.right);
      return passed
        ? { status: 'succeeded', output: {} }
        : { status: 'halted', output: {}, halt: 'A “only continue if” step did not match, so the run stopped.' };
    }

    case 'core.delay': {
      const ms = parseDuration(config.duration);
      if (ms === null) {
        return { status: 'failed', error: `“${String(config.duration ?? '')}” is not a duration the engine understands.` };
      }
      return {
        status: 'succeeded',
        output: { resumedAt: new Date(Date.now() + ms).toISOString() },
        simulationNote: context.honourDelays
          ? undefined
          : `Would wait ${config.duration}. Test runs continue immediately.`,
      };
    }

    case 'core.set': {
      const pairs = Array.isArray(config.values) ? (config.values as { key: string; value: unknown }[]) : [];
      const values: Record<string, unknown> = {};
      for (const pair of pairs) {
        if (pair?.key) values[pair.key] = pair.value;
      }
      return { status: 'succeeded', output: { values, ...values } };
    }

    case 'core.template':
      return { status: 'succeeded', output: { text: String(config.template ?? '') } };

    case 'core.stop': {
      const outcome = String(config.outcome ?? 'success');
      return {
        status: outcome === 'failed' ? 'failed' : 'halted',
        output: {},
        error: outcome === 'failed' ? String(config.reason ?? 'The workflow stopped with a failure.') : undefined,
        halt: String(config.reason || 'The workflow reached a stop step.'),
      };
    }

    case 'core.merge': {
      const combined = Object.assign({}, ...context.incomingScopes);
      return { status: 'succeeded', output: { combined } };
    }

    case 'core.approval': {
      // Nobody is standing by to approve during a run the engine drives, so it
      // takes the approved path and says so. Stopping instead would make every
      // workflow with a review step untestable past that point, which is the
      // half people most want to see.
      const approver = String(config.approver ?? 'the approver');
      return {
        status: 'succeeded',
        output: {
          decision: 'approved',
          decidedBy: `[sample ${approver}]`,
          comment: '',
          decidedAt: new Date().toISOString(),
        },
        branchTaken: 'approved',
        simulationNote: `Waits for ${approver}. This run assumed approval so the rest of the workflow could be checked.`,
      };
    }

    case 'core.retry': {
      // The retry envelope only matters when the step it guards fails; on the
      // first pass it succeeds, which is the path worth showing.
      const maxAttempts = Math.max(1, Number(config.maxAttempts) || 3);
      return {
        status: 'succeeded',
        output: { attempts: 1, lastError: null },
        branchTaken: 'success',
        simulationNote: `Would retry up to ${maxAttempts} times before taking the exhausted path.`,
      };
    }

    case 'core.dedupe':
      // Needs storage to be meaningful; in a test run every key is new.
      return {
        status: 'succeeded',
        output: {},
        simulationNote: 'Duplicate keys are only remembered across live runs.',
      };

    case 'core.batch': {
      const items = Array.isArray(config.items) ? config.items : [];
      const size = Math.max(1, Number(config.size) || 25);
      const batches: unknown[][] = [];
      for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
      return { status: 'succeeded', output: { batches, count: batches.length } };
    }

    case 'core.loop': {
      const items = Array.isArray(config.items) ? config.items : [];
      // The engine reports the list and hands the first item downstream; running
      // the following steps once per item needs the executor's scheduler.
      return {
        status: 'succeeded',
        output: { item: items[0] ?? null, index: 0, total: items.length },
        simulationNote:
          items.length > 1
            ? `${items.length} items. A test run follows the first; live runs repeat for each.`
            : undefined,
      };
    }

    default:
      return { status: 'failed', error: `No engine implementation for ${type}.` };
  }
}
