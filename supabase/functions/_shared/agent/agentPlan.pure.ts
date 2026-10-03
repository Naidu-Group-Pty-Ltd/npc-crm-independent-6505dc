/**
 * The plan Aurixa shows before it works — a checklist the user can watch.
 *
 * A request that takes several steps ("find Sarah's deals, check which are at
 * risk and remind me about the worst one") used to run as a row of tool names
 * ticking past. A plan says what the agent INTENDS, in the user's words, before
 * the first lookup, and each step is ticked as it lands. The model writes it by
 * calling `show_plan`; this module is the one place that decides what a plan
 * may contain, on the server that receives it and in the browser that draws a
 * stored one.
 *
 * Three rules.
 *
 * - **A plan describes; it never acts.** `show_plan` changes nothing anywhere,
 *   so it needs no approval and is never replayed when a write is approved.
 * - **A step is done only when the model says so.** Nothing here infers
 *   completion from a tool having run, because "looked up the deals" is not
 *   "found the one at risk". A plan the model never updates stays as written.
 * - **Small and plain.** At most `MAX_PLAN_STEPS` steps of plain text; a label
 *   is a few words, never markup.
 */

export const MAX_PLAN_STEPS = 8;
const MAX_LABEL = 90;
const MAX_TITLE = 70;

export type PlanStepStatus = 'pending' | 'active' | 'done' | 'skipped';

export type AgentPlanStep = { readonly label: string; readonly status: PlanStepStatus };

export type AgentPlan = { readonly title?: string; readonly steps: readonly AgentPlanStep[] };

const STATUSES: ReadonlySet<string> = new Set(['pending', 'active', 'done', 'skipped']);

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/[<>`*_#[\]]/g, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The plan in `value`, or null when there is nothing to draw. Accepts the
 * model's `show_plan` arguments and a stored plan alike. A step given as a bare
 * string is `pending`; an unknown status is `pending`. When nothing is `active`
 * and the plan is unfinished, the first unfinished step becomes `active`, so a
 * fresh plan always shows where the agent is — unless `promote` is false, which
 * is how a STORED plan is read: a finished turn's plan says what it said.
 */
export function normalisePlan(value: unknown, opts: { readonly promote?: boolean } = {}): AgentPlan | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.steps)) return null;
  const steps: AgentPlanStep[] = [];
  for (const raw of v.steps) {
    if (steps.length >= MAX_PLAN_STEPS) break;
    const s = typeof raw === 'string' ? { label: raw } : raw;
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    const label = clean(o.label ?? o.title ?? o.step, MAX_LABEL);
    if (!label) continue;
    const status = typeof o.status === 'string' && STATUSES.has(o.status) ? (o.status as PlanStepStatus) : 'pending';
    steps.push({ label, status });
  }
  if (!steps.length) return null;
  if (opts.promote !== false && !steps.some((s) => s.status === 'active')) {
    const next = steps.findIndex((s) => s.status === 'pending');
    if (next >= 0 && steps.some((s) => s.status !== 'pending')) {
      steps[next] = { ...steps[next], status: 'active' };
    } else if (next === 0) {
      steps[0] = { ...steps[0], status: 'active' };
    }
  }
  const title = clean(v.title, MAX_TITLE);
  return title ? { title, steps } : { steps };
}

export type PlanProgress = { readonly done: number; readonly total: number; readonly settled: boolean };

/** Done and skipped both count as settled; a plan is settled when nothing is left to do. */
export function planProgress(plan: AgentPlan | null | undefined): PlanProgress {
  if (!plan) return { done: 0, total: 0, settled: true };
  const done = plan.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  return { done, total: plan.steps.length, settled: done === plan.steps.length };
}

/**
 * The plan as a turn that STOPPED leaves it: the step that was running is no
 * longer running. It is not marked done, because it did not finish; it goes
 * back to pending so the card says what is still outstanding.
 */
export function haltPlan(plan: AgentPlan | null | undefined): AgentPlan | null {
  if (!plan) return null;
  return { ...plan, steps: plan.steps.map((s) => (s.status === 'active' ? { ...s, status: 'pending' as const } : s)) };
}
