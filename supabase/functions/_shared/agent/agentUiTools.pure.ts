/**
 * The two tools that change what the user SEES, not what the database holds.
 *
 * Every other tool Aurixa calls reads or writes a record. These two only talk
 * to the panel: `show_plan` puts a checklist of the agent's intentions in front
 * of the user, and `open_page` offers — or, when the user asked, takes — them
 * to a page or a record. They live beside the deferred-tool meta tools
 * (`list_tool_domains`, `search_tools`, `load_tools`) because they share their
 * three properties: always loaded, never counted against the per-turn tool
 * budget, and never executed against the database — so never replayed when a
 * write is approved, and never on an approval card.
 *
 * Three rules.
 *
 * - **The model names, the server builds.** `open_page` takes a page KEY from
 *   a closed list or an entity and its ids; `resolveAgentTarget` composes the
 *   path. A URL the model writes is refused, because a model that may write a
 *   URL may write any URL.
 * - **A refusal is said to the model.** An id that does not check out answers
 *   with what was wrong, so the agent can look the record up instead of telling
 *   the user it opened something it did not.
 * - **The reply never claims the user moved.** Whether the page actually
 *   changes is the browser's decision (only when the user asked to go, and
 *   only where the panel stays beside the page), so the model is told a button
 *   was shown, never that navigation happened.
 */

import { AGENT_CLIENT_TABS, AGENT_PAGE_KEYS, resolveAgentTarget, type ResolvedTarget } from './agentRoutes.pure.ts';
import { MAX_PLAN_STEPS, normalisePlan, type AgentPlan } from './agentPlan.pure.ts';

export const UI_TOOL_NAMES: ReadonlySet<string> = new Set(['show_plan', 'open_page']);

export const UI_TOOLS: readonly unknown[] = [
  {
    type: 'function',
    function: {
      name: 'show_plan',
      description:
        'Show the user a short checklist of how you will handle a multi-step request, and update it as you go. ' +
        'Call it FIRST for any request that needs three or more steps, then again (in the same step as the tools ' +
        'that advance it) with updated statuses, and once more before your final answer. It changes no data.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Optional few-word heading, e.g. "Settlement check".' },
          steps: {
            type: 'array',
            maxItems: MAX_PLAN_STEPS,
            description: `2–${MAX_PLAN_STEPS} steps in plain words, in order.`,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'What this step does, in a few plain words.' },
                status: { type: 'string', enum: ['pending', 'active', 'done', 'skipped'] },
              },
              required: ['label'],
            },
          },
        },
        required: ['steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_page',
      description:
        'Offer the user a button to open a page or a record in the dashboard. When they asked to go somewhere ' +
        '("take me to", "open", "pull up") the interface may open it for them. Name a page, OR an entity with ' +
        'its id taken from a tool result — never invent an id and never write a URL.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'string', enum: [...AGENT_PAGE_KEYS], description: 'A dashboard page.' },
          entity: { type: 'string', enum: ['client', 'deal', 'report', 'listing'], description: 'A record to open instead of a page.' },
          id: { type: 'string', description: 'The record id: a client, deal or investment report UUID, or a listing id.' },
          client_id: { type: 'string', description: 'For a deal: the UUID of the client it belongs to.' },
          tab: { type: 'string', enum: [...AGENT_CLIENT_TABS], description: 'For a client: the tab to open on.' },
          label: { type: 'string', description: 'Button text, a few words, e.g. "Open Sarah Chen".' },
        },
      },
    },
  },
];

export type UiToolOutcome =
  | { readonly kind: 'plan'; readonly plan: AgentPlan; readonly reply: Record<string, unknown> }
  | { readonly kind: 'open'; readonly target: ResolvedTarget; readonly reply: Record<string, unknown> }
  | { readonly kind: 'refused'; readonly reply: Record<string, unknown> };

/** What a UI tool call does: the event to show, and what the model is told. Never throws. */
export function runUiTool(name: string, args: unknown): UiToolOutcome {
  if (name === 'show_plan') {
    const plan = normalisePlan(args);
    if (!plan) {
      return { kind: 'refused', reply: { success: false, error: 'A plan needs at least one step with a label.' } };
    }
    return {
      kind: 'plan',
      plan,
      reply: { success: true, message: 'The plan is on screen. Update it with show_plan as steps finish; do not repeat it in your answer.' },
    };
  }
  if (name === 'open_page') {
    const target = resolveAgentTarget(args);
    if (!target) {
      return {
        kind: 'refused',
        reply: {
          success: false,
          error: 'Nothing to open: name a page from the list, or an entity with a valid id from a tool result (a deal also needs its client_id). Look the record up first if you do not have its id.',
        },
      };
    }
    return {
      kind: 'open',
      target,
      reply: { success: true, message: `A button to open "${target.label}" is on screen. Do not paste a link to it.` },
    };
  }
  return { kind: 'refused', reply: { success: false, error: `Unknown tool: ${name}` } };
}

/**
 * The lines the system prompt carries about these tools. Additive: they tell
 * the model what it may now do, and remove nothing it did before — a panel
 * built before cards existed still receives the full prose answer.
 */
export const UI_TOOLS_PROMPT = `

===== WORKING WITH THE USER'S SCREEN =====
- PLAN: For a request that needs three or more steps, call \`show_plan\` FIRST with 2–6 short steps in plain words (the first one "active"). As you work, send \`show_plan\` again with updated statuses IN THE SAME STEP as the tools that advance it, and once more before your final answer with finished steps "done" and any you did not need "skipped". Never use a plan for a one-step question.
- OPEN: When the user asks to go to, open or pull up a page or a record, call \`open_page\` — a page key, or an entity with an id you got from a tool result (a deal needs its client_id). When you have just found the one record the user is clearly about to act on, you may offer it the same way. Never write URLs or markdown links to dashboard pages; the button is the link.
- Lists of clients, deals, settlements, reminders, calls and calendar events that you look up are also drawn for the user as cards they can click. Answer exactly as you otherwise would.
===== END SCREEN =====`;
