/**
 * Which live workflows should a captured event start?
 *
 * A trigger node is not just a type — it carries configuration that narrows it.
 * `platform.purchase_file_status_changed` with `toStatus: 'settled'` must not
 * fire when a file moves to `unconditional`, and a workflow whose trigger says
 * `minDurationSeconds: 60` must ignore a twenty-second call. Matching on type
 * alone would start every workflow on every event and make the filters on the
 * canvas decorative.
 *
 * Kept pure and separate from both the capture side (Postgres) and the dispatch
 * side (whatever ends up draining the queue) so the rule is stated once and
 * tested directly, rather than inferred from a run.
 */

import { getCatalogNode } from './catalog/index.pure.ts';
import type { WorkflowGraph, WorkflowNode } from './types.pure.ts';

export interface TriggerEvent {
  triggerType: string;
  payload: Record<string, unknown>;
}

export interface MatchCandidate {
  workflowId: string;
  status: string;
  graph: WorkflowGraph;
}

export interface TriggerMatch {
  workflowId: string;
  /** The trigger node that matched, so the dispatcher can seed its scope. */
  nodeId: string;
}

/** A blank filter means "no opinion", not "must equal empty". */
const unset = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || value === 'any' || value === 'all';

const text = (value: unknown): string => String(value ?? '').trim().toLowerCase();

/**
 * Whether one trigger node's configuration accepts this event.
 *
 * Unknown config keys are ignored rather than treated as failures: the catalog
 * gains fields over time, and a workflow saved before a field existed should
 * keep running rather than silently stop.
 */
export function triggerAccepts(node: WorkflowNode, event: TriggerEvent): boolean {
  if (node.type !== event.triggerType) return false;
  if (node.disabled) return false;

  const config = node.config ?? {};
  const payload = event.payload ?? {};

  for (const [key, filter] of Object.entries(config)) {
    if (unset(filter)) continue;

    switch (key) {
      // Numeric floor rather than equality — "at least this long".
      case 'minDurationSeconds': {
        const floor = Number(filter);
        const actual = Number(payload.durationSeconds);
        if (Number.isFinite(floor) && (!Number.isFinite(actual) || actual < floor)) return false;
        break;
      }

      // Substring, because a file name filter is a hint, not an exact key.
      case 'matchesName': {
        if (!text(payload.fileName).includes(text(filter))) return false;
        break;
      }

      default: {
        // Everything else is an equality filter against the payload key of the
        // same name. A filter naming a key the event does not carry cannot be
        // satisfied, so it declines rather than passing by accident.
        if (!(key in payload)) return false;
        if (text(payload[key]) !== text(filter)) return false;
      }
    }
  }

  return true;
}

/** Trigger nodes in a graph, in declaration order. */
const triggersOf = (graph: WorkflowGraph): WorkflowNode[] =>
  (graph?.nodes ?? []).filter((node) => getCatalogNode(node.type)?.kind === 'trigger');

/**
 * Every live workflow this event should start, with the node that matched.
 *
 * A workflow appears at most once even if two of its trigger nodes accept the
 * same event — one occurrence should produce one run, not one per listener.
 */
export function matchTrigger(event: TriggerEvent, candidates: MatchCandidate[]): TriggerMatch[] {
  const matches: TriggerMatch[] = [];

  for (const candidate of candidates) {
    if (candidate.status !== 'live') continue;
    const accepted = triggersOf(candidate.graph).find((node) => triggerAccepts(node, event));
    if (accepted) matches.push({ workflowId: candidate.workflowId, nodeId: accepted.id });
  }

  return matches;
}
