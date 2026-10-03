/**
 * What the panel holds for one answer beyond its words: the plan Aurixa is
 * working through, the cards it found, and the pages it offered to open.
 *
 * Two sources fill it and they must agree. While an answer streams the server
 * sends `plan`, `view` and `ui` events; when the conversation is opened again
 * the same facts come back as the receipt stored with the message. Both pass
 * through the one set of checks in `protocol` — `normalisePlan`,
 * `sanitizeView`, `isAgentHref` — so a card drawn live and the same card drawn
 * tomorrow are the same card, and anything the server did not shape (an older
 * deployment, a hand-edited row) is dropped rather than drawn.
 *
 * Three rules.
 *
 * - **Every event is optional.** A deployment that has not shipped the panel
 *   protocol sends none of them, and the answer renders exactly as it did:
 *   an empty panel draws nothing.
 * - **A link is re-checked in the browser.** The server composes every href,
 *   and the panel still refuses one `isAgentHref` would not have built — the
 *   stream is the boundary, not the model.
 * - **The page moves only when the person asked it to.** `shouldOpenPage` is
 *   the whole decision: the request named a destination, the screen is wide
 *   enough to keep the panel beside the page, and this answer has not already
 *   moved it. Otherwise the offer waits as a button.
 */
import {
  cleanLabel,
  isAgentHref,
  normalisePlan,
  readReceipt,
  sanitizeView,
  wantsNavigation,
  type AgentPlan,
  type AgentView,
} from './protocol';
import { META_TOOLS, PANEL_TOOLS, narrateTool } from './toolNarration.pure';
import type { TraceStep, WorkTrace } from './workTrace.pure';

/** The same bounds the server keeps per answer, so live and reloaded agree. */
export const MAX_PANEL_VIEWS = 6;
export const MAX_PANEL_ACTIONS = 4;

export type PanelAction = { readonly href: string; readonly label: string };

export type AnswerPanel = {
  readonly plan: AgentPlan | null;
  readonly views: readonly AgentView[];
  readonly actions: readonly PanelAction[];
};

export const EMPTY_PANEL: AnswerPanel = Object.freeze({ plan: null, views: [], actions: [] });

export function isEmptyPanel(panel: AnswerPanel | null | undefined): boolean {
  return !panel || (!panel.plan && panel.views.length === 0 && panel.actions.length === 0);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** A `plan` event replaces the plan; anything that is not one changes nothing. */
export function withPlan(panel: AnswerPanel, data: unknown): AnswerPanel {
  const plan = normalisePlan(record(data)?.plan, { promote: false });
  return plan ? { ...panel, plan } : panel;
}

/** A `view` event adds its cards, up to the per-answer cap. */
export function withViews(panel: AnswerPanel, data: unknown): AnswerPanel {
  const raw = record(data)?.views;
  if (!Array.isArray(raw) || panel.views.length >= MAX_PANEL_VIEWS) return panel;
  const added: AgentView[] = [];
  for (const v of raw) {
    if (panel.views.length + added.length >= MAX_PANEL_VIEWS) break;
    const clean = sanitizeView(v);
    if (clean) added.push(clean);
  }
  return added.length ? { ...panel, views: [...panel.views, ...added] } : panel;
}

/** The page a `ui` event offers, or null when it is not one this panel may open. */
export function actionFrom(data: unknown): PanelAction | null {
  const d = record(data);
  if (!d || d.kind !== 'open' || !isAgentHref(d.href)) return null;
  const label = typeof d.label === 'string' ? cleanLabel(d.label) : '';
  return label ? { href: d.href, label } : null;
}

/** A `ui` event adds its offer once, up to the per-answer cap. */
export function withAction(panel: AnswerPanel, data: unknown): AnswerPanel {
  const action = actionFrom(data);
  if (!action || panel.actions.length >= MAX_PANEL_ACTIONS) return panel;
  if (panel.actions.some((a) => a.href === action.href)) return panel;
  return { ...panel, actions: [...panel.actions, action] };
}

/** The panel a stored message carries, or null for a message with no receipt. */
export function panelFromReceipt(value: unknown): AnswerPanel | null {
  const receipt = readReceipt(value);
  if (!receipt) return null;
  const panel: AnswerPanel = {
    plan: receipt.plan ?? null,
    views: (receipt.views ?? []).slice(0, MAX_PANEL_VIEWS),
    actions: (receipt.actions ?? []).slice(0, MAX_PANEL_ACTIONS),
  };
  return isEmptyPanel(panel) ? null : panel;
}

/**
 * The work trace a stored answer can still show: the steps it recorded, each
 * named the way the live trace named it, folded the same way (the same tool
 * run back to back is one step run twice). Null when nothing was recorded —
 * every answer written before receipts, which keeps the plain row it had.
 *
 * Durations are the receipt's own: the whole answer took `elapsedMs`, and each
 * step is laid end to end. Steps that ran in parallel are drawn in sequence,
 * which is fine for a list that only ever shows what was done and how long the
 * whole answer took.
 */
export function traceFromReceipt(value: unknown): WorkTrace | null {
  const receipt = readReceipt(value);
  if (!receipt || receipt.steps.length === 0) return null;
  const steps: TraceStep[] = [];
  let clock = 0;
  for (const s of receipt.steps) {
    if (META_TOOLS.has(s.tool) || PANEL_TOOLS.has(s.tool)) continue;
    const ms = s.ms ?? 0;
    const last = steps[steps.length - 1];
    if (last && last.tool === s.tool) {
      steps[steps.length - 1] = { ...last, count: last.count + 1, endedAt: (last.endedAt ?? clock) + ms };
    } else {
      const n = narrateTool(s.tool);
      steps.push({
        key: `${steps.length}-${s.tool}`,
        tool: s.tool,
        label: n.active,
        doneLabel: n.done,
        domain: n.domain,
        status: 'done',
        count: 1,
        startedAt: clock,
        endedAt: clock + ms,
      });
    }
    clock += ms;
  }
  if (!steps.length) return null;
  return { steps, startedAt: 0, endedAt: Math.max(receipt.elapsedMs ?? clock, 0) };
}

/**
 * Whether an offered page should open by itself. Only when the words the
 * person typed (or said) asked to go somewhere, the panel can stay beside the
 * page rather than covering it, this answer has not moved the page already,
 * and the page is not the one they are on.
 */
export function shouldOpenPage(input: {
  readonly asked: string;
  readonly wide: boolean;
  readonly alreadyMoved: boolean;
  readonly href: string;
  readonly here: string;
}): boolean {
  if (!input.wide || input.alreadyMoved) return false;
  if (!isAgentHref(input.href) || input.href === input.here) return false;
  return wantsNavigation(input.asked);
}

/** True when `href` names the page the reader is on (path and query alike). */
export function isCurrentPage(href: string, location: { readonly pathname: string; readonly search: string }): boolean {
  return href === `${location.pathname}${location.search}` || href === location.pathname;
}

const AU = 'en-AU';

function dayKey(d: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat(AU, { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * A card's date in the reader's own day: "Today, 2:30 pm", "Tomorrow",
 * "3 Oct", "3 Oct 2025". The server sends every date as ISO in UTC, and a
 * value that is exactly midnight UTC is a DATE with no time — a reminder due
 * on the 2nd — so it is read in UTC and printed without a clock, or a broker
 * in Perth would see "8:00 am" on something nobody scheduled for eight.
 */
export function formatWhen(value: string | undefined, now: Date = new Date(), timeZone?: string): string | null {
  if (!value) return null;
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return null;
  const dateOnly = at.getUTCHours() === 0 && at.getUTCMinutes() === 0 && at.getUTCSeconds() === 0 && at.getUTCMilliseconds() === 0;
  const zone = dateOnly ? 'UTC' : timeZone;
  const day = dayKey(at, zone);
  const shift = (days: number) => dayKey(new Date(now.getTime() + days * 86_400_000), timeZone);
  const time = dateOnly ? '' : new Intl.DateTimeFormat(AU, { timeZone, hour: 'numeric', minute: '2-digit' }).format(at).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase();
  const rel = day === shift(0) ? 'Today' : day === shift(1) ? 'Tomorrow' : day === shift(-1) ? 'Yesterday' : null;
  if (rel) return time ? `${rel}, ${time}` : rel;
  const sameYear = new Intl.DateTimeFormat(AU, { timeZone: zone, year: 'numeric' }).format(at)
    === new Intl.DateTimeFormat(AU, { timeZone, year: 'numeric' }).format(now);
  return new Intl.DateTimeFormat(AU, { timeZone: zone, day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(at);
}
