/**
 * One answer's worth of panel work: the plan, the cards, the buttons and the
 * steps, gathered while the agent runs and written down when it stops.
 *
 * `ai-dashboard-agent` answers two ways — streamed to the panel, and in one
 * response to the callers that cannot stream (Report Q&A, auto-summaries and
 * the panel's own fallback). Both used to carry their own copy of the tool
 * loop, and a feature added to one is a feature the other silently lacks. This
 * is the part of the new behaviour they share, so the two cannot drift.
 *
 * Three rules.
 *
 * - **A caller that cannot draw a panel is never offered one.** `panel` is the
 *   caller's own declaration (`panel_protocol: 2`). Without it no plan, card
 *   or button is built or announced, and the model is never told a button is
 *   on screen when none is — Report Q&A answers exactly as it did.
 * - **Cards are bounded per answer**, not per tool: six, newest last, because
 *   an answer that drew twenty cards has stopped being an answer.
 * - **Planning is not work.** A round in which the model only updated its plan
 *   or offered a page earns that round back, up to `MAX_PANEL_ROUNDS`, so a
 *   plan cannot cost the answer the lookups it was planning.
 */

import { UI_TOOL_NAMES, runUiTool } from './agentUiTools.pure.ts';
import { VIEW_TOOLS, viewsForTool, type AgentView } from './agentViews.pure.ts';
import { haltPlan, type AgentPlan } from './agentPlan.pure.ts';
import { buildReceipt, type AgentReceipt, type ReceiptAction, type ReceiptStep } from './agentReceipt.pure.ts';

export const MAX_TURN_VIEWS = 6;
export const MAX_TURN_ACTIONS = 4;
export const MAX_PANEL_ROUNDS = 3;

export type PanelEvent =
  | { readonly event: 'plan'; readonly data: { readonly plan: AgentPlan } }
  | { readonly event: 'ui'; readonly data: { readonly kind: 'open'; readonly href: string; readonly label: string } }
  | { readonly event: 'view'; readonly data: { readonly tool: string; readonly id?: string; readonly views: readonly AgentView[] } };

export type AgentTurn = {
  readonly panel: boolean;
  /** Run a panel tool. Returns what the model is told; announces the change when there is a panel. */
  ui(name: string, args: unknown): string;
  /** Record a data tool that ran: a step for the receipt and, where it draws, its cards. */
  ran(name: string, raw: unknown, ms: number, id?: string): void;
  /** One round back when every call in it was a panel tool, until the allowance is spent. */
  roundCredit(toolNames: readonly string[]): number;
  /** The receipt to store with the answer; `halted` when the turn stopped before it finished. */
  receipt(opts?: { readonly halted?: boolean }): AgentReceipt | null;
  readonly plan: AgentPlan | null;
};

function failed(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return raw === undefined || raw === null;
  const r = raw as Record<string, unknown>;
  return Boolean(r.error) || r.success === false;
}

export function createAgentTurn(opts: {
  readonly panel: boolean;
  readonly emit?: (e: PanelEvent) => void;
  readonly now?: () => number;
}): AgentTurn {
  const now = opts.now ?? Date.now;
  const emit = opts.panel && opts.emit ? opts.emit : () => {};
  const startedAt = now();
  let plan: AgentPlan | null = null;
  const views: AgentView[] = [];
  const actions: ReceiptAction[] = [];
  const steps: ReceiptStep[] = [];
  let credit = 0;

  return {
    panel: opts.panel,
    get plan() {
      return plan;
    },
    ui(name, args) {
      const out = runUiTool(name, args);
      if (opts.panel) {
        if (out.kind === 'plan') {
          plan = out.plan;
          emit({ event: 'plan', data: { plan: out.plan } });
        } else if (out.kind === 'open') {
          const { href, label } = out.target;
          if (!actions.some((a) => a.href === href) && actions.length < MAX_TURN_ACTIONS) actions.push({ href, label });
          emit({ event: 'ui', data: { kind: 'open', href, label } });
        }
      }
      return JSON.stringify(out.reply);
    },
    ran(name, raw, ms, id) {
      steps.push({ tool: name, ms: Math.max(0, Math.round(ms)), ok: !failed(raw) });
      if (!opts.panel || !VIEW_TOOLS.has(name) || views.length >= MAX_TURN_VIEWS) return;
      const drawn = viewsForTool(name, raw, now()).slice(0, MAX_TURN_VIEWS - views.length);
      if (!drawn.length) return;
      views.push(...drawn);
      emit({ event: 'view', data: id ? { tool: name, id, views: drawn } : { tool: name, views: drawn } });
    },
    roundCredit(toolNames) {
      if (!toolNames.length || credit >= MAX_PANEL_ROUNDS) return 0;
      if (!toolNames.every((n) => UI_TOOL_NAMES.has(n))) return 0;
      credit += 1;
      return 1;
    },
    receipt({ halted = false } = {}) {
      return buildReceipt({
        elapsedMs: now() - startedAt,
        steps,
        plan: halted ? haltPlan(plan) : plan,
        views,
        actions,
      });
    },
  };
}

/** True when the request says the caller draws the panel protocol. */
export function wantsPanel(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as Record<string, unknown>).panel_protocol === 2;
}
