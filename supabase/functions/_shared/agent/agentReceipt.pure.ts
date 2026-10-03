/**
 * The record of what Aurixa did for one answer, kept with the answer.
 *
 * The work an answer took — the lookups, the plan, the cards it drew and the
 * page it offered — used to exist only while the stream was open. Reload the
 * panel and an answer was its prose alone: the trace said nothing, the cards
 * were gone, and "Open Sarah's record" had become a sentence with no button.
 *
 * A receipt is that work, written onto the assistant's own row in
 * `agent_messages.tool_results` — a JSONB column the schema has always had and
 * nothing has ever read (the history the model is shown takes `role` and
 * `content` alone). No migration, and a row written before this simply has no
 * receipt.
 *
 * Three rules.
 *
 * - **Versioned and read defensively.** `aurixa: 2` marks a receipt; anything
 *   else in that column is not one, and `readReceipt` returns null for it.
 *   Every view is re-checked by `sanitizeView`, every action by `isAgentHref`,
 *   on the way IN to the browser — the stored copy is never trusted because it
 *   was ours when written.
 * - **Bounded.** A receipt is kept under `MAX_RECEIPT_CHARS`; past it the
 *   views go first, newest last, because the prose already says what they
 *   showed and a row in `agent_messages` must stay a row.
 * - **A step's arguments are never kept.** A receipt names the tool and how
 *   long it took. What it was asked — a client's name, a phone number — is in
 *   the conversation already, and a second copy is a second thing to delete.
 */

import { isAgentHref, cleanLabel } from './agentRoutes.pure.ts';
import { normalisePlan, type AgentPlan } from './agentPlan.pure.ts';
import { sanitizeView, type AgentView } from './agentViews.pure.ts';

export const RECEIPT_VERSION = 2;
export const MAX_RECEIPT_CHARS = 16_000;
const MAX_STEPS = 24;
const MAX_VIEWS = 6;
const MAX_ACTIONS = 4;

export type ReceiptStep = { readonly tool: string; readonly ms?: number; readonly ok: boolean };

export type ReceiptAction = { readonly href: string; readonly label: string };

export type AgentReceipt = {
  readonly aurixa: typeof RECEIPT_VERSION;
  readonly elapsedMs?: number;
  readonly steps: readonly ReceiptStep[];
  readonly plan?: AgentPlan;
  readonly views?: readonly AgentView[];
  readonly actions?: readonly ReceiptAction[];
};

const TOOL_NAME = /^[a-z][a-z0-9_]{1,63}$/;

function cleanSteps(value: unknown): ReceiptStep[] {
  if (!Array.isArray(value)) return [];
  const out: ReceiptStep[] = [];
  for (const raw of value) {
    if (out.length >= MAX_STEPS) break;
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Record<string, unknown>;
    if (typeof s.tool !== 'string' || !TOOL_NAME.test(s.tool)) continue;
    const ms = typeof s.ms === 'number' && Number.isFinite(s.ms) && s.ms >= 0 ? Math.round(s.ms) : undefined;
    out.push(ms === undefined ? { tool: s.tool, ok: s.ok !== false } : { tool: s.tool, ms, ok: s.ok !== false });
  }
  return out;
}

function cleanActions(value: unknown): ReceiptAction[] {
  if (!Array.isArray(value)) return [];
  const out: ReceiptAction[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (out.length >= MAX_ACTIONS) break;
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    if (!isAgentHref(a.href) || seen.has(a.href)) continue;
    const label = typeof a.label === 'string' ? cleanLabel(a.label) : '';
    if (!label) continue;
    seen.add(a.href);
    out.push({ href: a.href, label });
  }
  return out;
}

function cleanViews(value: unknown): AgentView[] {
  if (!Array.isArray(value)) return [];
  const out: AgentView[] = [];
  for (const raw of value) {
    if (out.length >= MAX_VIEWS) break;
    const v = sanitizeView(raw);
    if (v) out.push(v);
  }
  return out;
}

function assemble(input: {
  elapsedMs?: unknown; steps: ReceiptStep[]; plan: AgentPlan | null; views: AgentView[]; actions: ReceiptAction[];
}): AgentReceipt {
  const elapsed = typeof input.elapsedMs === 'number' && Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0
    ? Math.round(input.elapsedMs) : undefined;
  return {
    aurixa: RECEIPT_VERSION,
    ...(elapsed !== undefined ? { elapsedMs: elapsed } : {}),
    steps: input.steps,
    ...(input.plan ? { plan: input.plan } : {}),
    ...(input.views.length ? { views: input.views } : {}),
    ...(input.actions.length ? { actions: input.actions } : {}),
  };
}

/**
 * The receipt to store, or null when the answer did no work worth recording
 * (no tool ran, no plan, nothing to open) — a plain reply keeps a plain row.
 */
export function buildReceipt(input: {
  readonly elapsedMs?: number;
  readonly steps?: readonly unknown[];
  readonly plan?: unknown;
  readonly views?: readonly unknown[];
  readonly actions?: readonly unknown[];
}): AgentReceipt | null {
  const steps = cleanSteps(input.steps);
  const plan = normalisePlan(input.plan, { promote: false });
  let views = cleanViews(input.views);
  const actions = cleanActions(input.actions);
  if (!steps.length && !plan && !views.length && !actions.length) return null;
  let receipt = assemble({ elapsedMs: input.elapsedMs, steps, plan, views, actions });
  while (JSON.stringify(receipt).length > MAX_RECEIPT_CHARS && views.length) {
    views = views.slice(0, -1);
    receipt = assemble({ elapsedMs: input.elapsedMs, steps, plan, views, actions });
  }
  return receipt;
}

/** A stored receipt, re-checked. Null for anything that is not one. */
export function readReceipt(value: unknown): AgentReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (r.aurixa !== RECEIPT_VERSION) return null;
  return assemble({
    elapsedMs: r.elapsedMs,
    steps: cleanSteps(r.steps),
    plan: normalisePlan(r.plan, { promote: false }),
    views: cleanViews(r.views),
    actions: cleanActions(r.actions),
  });
}
