/**
 * One answer's panel work, gathered by `createAgentTurn` — and the rule that
 * makes it safe: a caller that did not declare the panel protocol gets exactly
 * the answer it got before. Report Q&A and the auto-summaries call the same
 * Edge Function as the panel, so "additive" is a property of the code path
 * they take, and it is asserted here rather than promised.
 *
 * The last block reads `ai-dashboard-agent` as source, because the guarantee
 * is only as good as the handler's use of it: a turn recorder nobody consults
 * protects nothing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MAX_PANEL_ROUNDS,
  MAX_TURN_ACTIONS,
  MAX_TURN_VIEWS,
  createAgentTurn,
  wantsPanel,
  type PanelEvent,
} from '../../../../supabase/functions/_shared/agent/agentTurn.pure';
import { readReceipt } from '../protocol';

const CLIENT = '3f6c1a2e-8a1b-4c3d-9e0f-112233445566';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f99887766';

function clients(n: number) {
  return { success: true, clients: Array.from({ length: n }, (_, i) => ({ id: `c-${i}`, name: `Client ${i}` })) };
}

function recorder(panel: boolean, start = 1_000) {
  const events: PanelEvent[] = [];
  let t = start;
  const turn = createAgentTurn({ panel, emit: (e) => events.push(e), now: () => t });
  return { turn, events, tick: (ms: number) => { t += ms; } };
}

describe('wantsPanel — the caller declares it, nothing infers it', () => {
  it('is true only for panel_protocol 2', () => {
    expect(wantsPanel({ panel_protocol: 2 })).toBe(true);
    for (const body of [undefined, null, {}, { panel_protocol: 1 }, { panel_protocol: '2' }, { panel_protocol: true }, [2], 'panel']) {
      expect(wantsPanel(body)).toBe(false);
    }
  });
});

describe('createAgentTurn without a panel — the old answer, unchanged', () => {
  it('announces nothing and draws no card, but still records the work', () => {
    const { turn, events } = recorder(false);
    expect(turn.panel).toBe(false);
    turn.ui('show_plan', { steps: ['Find the client', 'Check the deal'] });
    turn.ui('open_page', { page: 'pipeline' });
    turn.ran('search_clients', clients(3), 42.4, 'call_1');
    expect(events).toEqual([]);
    const receipt = turn.receipt();
    expect(receipt?.steps).toEqual([{ tool: 'search_clients', ms: 42, ok: true }]);
    expect(receipt?.views).toBeUndefined();
    expect(receipt?.actions).toBeUndefined();
    expect(receipt?.plan).toBeUndefined();
  });

  it('still answers the model, so a stray UI call cannot wedge the loop', () => {
    const { turn } = recorder(false);
    expect(JSON.parse(turn.ui('open_page', { page: 'pipeline' }))).toMatchObject({ success: true });
    expect(JSON.parse(turn.ui('show_plan', { steps: [] }))).toMatchObject({ success: false });
  });
});

describe('createAgentTurn with a panel', () => {
  it('announces the plan and keeps the latest one', () => {
    const { turn, events } = recorder(true);
    turn.ui('show_plan', { title: 'Settlement check', steps: ['Find the deal', 'Read the countdown'] });
    turn.ui('show_plan', { steps: [{ label: 'Find the deal', status: 'done' }, { label: 'Read the countdown', status: 'active' }] });
    expect(events.map((e) => e.event)).toEqual(['plan', 'plan']);
    expect(turn.plan?.steps.map((s) => s.status)).toEqual(['done', 'active']);
  });

  it('refuses a bad plan without announcing one', () => {
    const { turn, events } = recorder(true);
    const reply = JSON.parse(turn.ui('show_plan', { steps: [{ label: '   ' }] }));
    expect(reply.success).toBe(false);
    expect(events).toEqual([]);
    expect(turn.plan).toBeNull();
  });

  it('offers a page once, and never more than the cap', () => {
    const { turn, events } = recorder(true);
    turn.ui('open_page', { page: 'pipeline' });
    turn.ui('open_page', { page: 'pipeline' });
    turn.ui('open_page', { entity: 'client', id: CLIENT, label: 'Sarah Chen' });
    turn.ui('open_page', { entity: 'client', id: OTHER });
    turn.ui('open_page', { page: 'reminders' });
    turn.ui('open_page', { page: 'calendar' });
    expect(events.filter((e) => e.event === 'ui')).toHaveLength(6);
    const actions = turn.receipt()?.actions ?? [];
    expect(actions.length).toBe(MAX_TURN_ACTIONS);
    expect(new Set(actions.map((a) => a.href)).size).toBe(actions.length);
    expect(actions[1]).toEqual({ href: `/clients?clientId=${CLIENT}`, label: 'Sarah Chen' });
  });

  it('refuses a page it cannot resolve, and tells the model why', () => {
    const { turn, events } = recorder(true);
    const reply = JSON.parse(turn.ui('open_page', { entity: 'client', id: 'not-a-uuid' }));
    expect(reply).toMatchObject({ success: false });
    expect(reply.error).toMatch(/valid id/);
    expect(events).toEqual([]);
  });

  it('draws a card for a data tool, with the call id that produced it', () => {
    const { turn, events } = recorder(true);
    turn.ran('search_clients', clients(2), 10, 'call_9');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'view', data: { tool: 'search_clients', id: 'call_9' } });
    const view = events[0].event === 'view' ? events[0].data.views[0] : null;
    expect(view).toMatchObject({ kind: 'records', entity: 'client' });
  });

  it('records a tool that draws nothing, and one that failed, without a card', () => {
    const { turn, events } = recorder(true);
    turn.ran('get_client_notes', { success: true, notes: [] }, 5);
    turn.ran('search_clients', { error: 'boom' }, 7);
    turn.ran('search_clients', null, 3);
    expect(events).toEqual([]);
    expect(turn.receipt()?.steps).toEqual([
      { tool: 'get_client_notes', ms: 5, ok: true },
      { tool: 'search_clients', ms: 7, ok: false },
      { tool: 'search_clients', ms: 3, ok: false },
    ]);
  });

  it(`stops drawing at ${MAX_TURN_VIEWS} cards, and keeps recording steps after`, () => {
    const { turn, events } = recorder(true);
    for (let i = 0; i < MAX_TURN_VIEWS + 3; i++) turn.ran('search_clients', clients(1), 1);
    expect(events).toHaveLength(MAX_TURN_VIEWS);
    const receipt = turn.receipt();
    expect(receipt?.views).toHaveLength(MAX_TURN_VIEWS);
    expect(receipt?.steps).toHaveLength(MAX_TURN_VIEWS + 3);
  });

  it('never records a negative or fractional duration', () => {
    const { turn } = recorder(true);
    turn.ran('search_clients', clients(1), -5);
    turn.ran('search_clients', clients(1), 12.6);
    expect(turn.receipt()?.steps.map((s) => s.ms)).toEqual([0, 13]);
  });
});

describe('roundCredit — planning is not work', () => {
  it('credits a round that only planned or offered a page, up to the cap', () => {
    const { turn } = recorder(true);
    let credit = 0;
    for (let i = 0; i < MAX_PANEL_ROUNDS + 2; i++) credit += turn.roundCredit(['show_plan', 'open_page']);
    expect(credit).toBe(MAX_PANEL_ROUNDS);
  });

  it('credits nothing for a round that did real work, or none at all', () => {
    const { turn } = recorder(true);
    expect(turn.roundCredit(['show_plan', 'search_clients'])).toBe(0);
    expect(turn.roundCredit(['search_clients'])).toBe(0);
    expect(turn.roundCredit([])).toBe(0);
  });
});

describe('the receipt a turn leaves', () => {
  it('times the turn on its own clock and reads back through readReceipt', () => {
    const { turn, tick } = recorder(true);
    turn.ui('show_plan', { steps: ['Find the client', 'Check the deal'] });
    turn.ran('search_clients', clients(1), 20);
    tick(1_234);
    const receipt = turn.receipt();
    expect(receipt?.elapsedMs).toBe(1_234);
    expect(readReceipt(JSON.parse(JSON.stringify(receipt)))).toEqual(receipt);
  });

  it('a turn that stopped does not leave a step running', () => {
    const { turn } = recorder(true);
    turn.ui('show_plan', { steps: [{ label: 'Find the client', status: 'done' }, { label: 'Check the deal', status: 'active' }] });
    expect(turn.receipt({ halted: true })?.plan?.steps.map((s) => s.status)).toEqual(['done', 'pending']);
    expect(turn.receipt()?.plan?.steps.map((s) => s.status)).toEqual(['done', 'active']);
  });

  it('a plain reply leaves a plain row', () => {
    expect(recorder(true).turn.receipt()).toBeNull();
    expect(recorder(false).turn.receipt()).toBeNull();
  });
});

describe('ai-dashboard-agent uses the turn on every path', () => {
  const src = readFileSync('supabase/functions/ai-dashboard-agent/index.ts', 'utf8');

  it('decides the panel from the request, once, by the shared rule', () => {
    expect(src).toMatch(/import \{ createAgentTurn, wantsPanel \} from '\.\.\/_shared\/agent\/agentTurn\.pure\.ts'/);
    expect((src.match(/const panel = wantsPanel\(body\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/panel_protocol/);
  });

  it('offers the panel tools and their prompt only to a panel', () => {
    expect(src).toMatch(/panel \? \[\.\.\.META_TOOLS, \.\.\.UI_TOOLS\] : \[\.\.\.META_TOOLS\]/);
    expect(src).toMatch(/\(panel \? UI_TOOLS_PROMPT : ''\)/);
  });

  it('never replays a meta or panel tool when an action is approved', () => {
    const confirm = src.slice(src.indexOf('async function handleConfirmAction'));
    const body = confirm.slice(0, confirm.indexOf('\nasync function ', 10) > 0 ? confirm.indexOf('\nasync function ', 10) : undefined);
    expect(body).toMatch(/META_TOOL_NAMES\.has\(/);
    expect(body).toMatch(/UI_TOOL_NAMES\.has\(/);
  });

  it('stores every answer through the insert that survives a refused receipt', () => {
    expect(src).toMatch(/async function insertAssistantMessage\(/);
    // Both answers of the streamed and the plain handler, and the approval replay.
    expect((src.match(/await insertAssistantMessage\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
    // The one direct assistant insert left is the fixed cancellation, which did no work to record.
    const direct = src.match(/\.from\('agent_messages'\)\.insert\(\{\s*conversation_id[^}]*role: 'assistant'[^}]*\}/g) ?? [];
    expect(direct).toHaveLength(1);
    expect(direct[0]).toMatch(/Action cancelled/);
  });
});
