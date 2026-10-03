/**
 * The protocol between Aurixa's server and its panel: what the model is shown
 * of a tool's result, the plan it may draw, the cards a result becomes, the
 * pages it may offer, and the receipt kept with an answer.
 *
 * Several of these are claims about OTHER files — the router's routes, the
 * client workspace's tabs, the executors in `ai-dashboard-agent`. Those are
 * read as source here rather than restated, because a list typed twice is two
 * lists, and the defect `toolProjection.pure.ts` records is exactly a list
 * that drifted from the executor it described with nothing failing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AGENT_CLIENT_TABS,
  AGENT_PAGES,
  AGENT_PAGE_KEYS,
  MAX_ITEMS,
  MAX_PLAN_STEPS,
  MAX_RECEIPT_CHARS,
  RECEIPT_VERSION,
  UI_TOOL_NAMES,
  VIEW_TOOLS,
  buildReceipt,
  cleanLabel,
  entityHref,
  formatAud,
  haltPlan,
  humanise,
  isAgentHref,
  normalisePlan,
  planProgress,
  readReceipt,
  resolveAgentTarget,
  sanitizeView,
  viewsForTool,
  wantsNavigation,
} from '../protocol';
import {
  TOOL_FIELD_PROJECTIONS,
  applyToolProjection,
  projectItem,
} from '../../../../supabase/functions/_shared/agent/toolProjection.pure';
import { UI_TOOLS, UI_TOOLS_PROMPT, runUiTool } from '../../../../supabase/functions/_shared/agent/agentUiTools.pure';
import { META_TOOLS, PANEL_TOOLS, describePendingAction } from '../toolNarration.pure';

const AGENT_SOURCE = readFileSync('supabase/functions/ai-dashboard-agent/index.ts', 'utf8');
const APP_SOURCE = readFileSync('src/App.tsx', 'utf8');
const TYPES_SOURCE = readFileSync('src/integrations/supabase/types.ts', 'utf8');
const REGISTRY_SOURCE = readFileSync('src/components/clients/clientWorkspaceRegistry.ts', 'utf8');

const CLIENT = '11111111-2222-4333-8444-555555555555';
const DEAL = '99999999-8888-4777-8666-555555555555';
const REPORT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/** The body of the executor the dispatcher sends `tool` to, read from the agent's source. */
function executorBody(tool: string): string {
  const call = new RegExp(`case '${tool}': return (execute\\w+)\\(`).exec(AGENT_SOURCE);
  if (!call) throw new Error(`no dispatcher case for ${tool}`);
  const start = AGENT_SOURCE.search(new RegExp(`\\n(?:async )?function ${call[1]}\\(`));
  if (start < 0) throw new Error(`no executor ${call[1]} for ${tool}`);
  const rest = AGENT_SOURCE.slice(start + 1);
  const end = rest.search(/\n(?:async )?function |\nconst [A-Z_]+ = /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** The columns `types.ts` declares on a table's Row. */
function rowColumns(table: string): Set<string> {
  const at = TYPES_SOURCE.indexOf(`      ${table}: {\n        Row: {`);
  if (at < 0) return new Set();
  const body = TYPES_SOURCE.slice(at, TYPES_SOURCE.indexOf('        }', at + 30));
  return new Set([...body.matchAll(/^\s{10}(\w+)\??:/gm)].map((m) => m[1]));
}

describe('toolProjection — what the model is shown of a result', () => {
  it('passes an item through whole when any listed field is missing', () => {
    const item = { id: 'x', name: 'Sarah' };
    expect(projectItem(item, ['id', 'first_name'])).toBe(item);
  });

  it('keeps exactly the listed fields when the item has all of them', () => {
    expect(projectItem({ id: 'x', title: 'T', noise: 1 }, ['id', 'title'])).toEqual({ id: 'x', title: 'T' });
  });

  it('never removes a key the projection does not name, and leaves an unprojected tool alone', () => {
    const result = { success: true, count: 1, deals: [{ id: 'd', current_stage: 'x' }] };
    expect(applyToolProjection('get_deals_by_stage', result)).toMatchObject({ success: true, count: 1 });
    const other = { clients: [{ id: 'c', name: 'Sarah' }] };
    expect(applyToolProjection('search_clients', other)).toBe(other);
    expect(applyToolProjection('get_client_deals', { deals: 'not a list' })).toEqual({ deals: 'not a list' });
  });

  it('a client search reaches the model WITH the names (the old map listed first_name and deleted them)', () => {
    expect(TOOL_FIELD_PROJECTIONS.search_clients).toBeUndefined();
    expect(TOOL_FIELD_PROJECTIONS.get_clients_by_pipeline_status).toBeUndefined();
  });

  // The rule the file header states: every projected field is one the executor
  // that fills the list can produce — named in its body, or a column of the
  // table it reads with `select('*')`.
  for (const [tool, proj] of Object.entries(TOOL_FIELD_PROJECTIONS)) {
    if (tool === 'get_appointments_for_client') continue; // GoHighLevel's own field names, not ours to read
    it(`${tool}: every projected field is one its executor returns`, () => {
      let body = executorBody(tool);
      if (/VAPI_AGENT_SELECT|normalizeVapiCalls?ForAgent/.test(body)) {
        body += AGENT_SOURCE.slice(AGENT_SOURCE.indexOf('function normalizeVapiCallForAgent'), AGENT_SOURCE.indexOf('async function executeGetRecentCalls'));
      }
      expect(body).toContain(proj.arrayKey);
      const star = /\.from\('(\w+)'\)\s*\.select\(\s*'\*'/.exec(body.replace(/\n\s*/g, ''));
      const columns = star ? rowColumns(star[1]) : new Set<string>();
      const missing = proj.fields.filter((f) => !new RegExp(`\\b${f}\\b`).test(body) && !columns.has(f));
      expect(missing).toEqual([]);
    });
  }
});

describe('agentRoutes — where the agent may send somebody', () => {
  it('every page key is a route the router declares', () => {
    for (const key of AGENT_PAGE_KEYS) {
      const relative = AGENT_PAGES[key].path.slice(1);
      expect(APP_SOURCE, key).toContain(`path="${relative}"`);
    }
  });

  it('the record routes it builds exist', () => {
    expect(APP_SOURCE).toContain('path="investment-report/:id"');
    expect(APP_SOURCE).toMatch(/path="listings\/:listingId"/);
    expect(readFileSync('src/pages/ClientManagement.tsx', 'utf8')).toMatch(/searchParams\.get\('dealId'\)/);
  });

  it('every client tab it may open on is one the workspace registry has', () => {
    const tabs = new Set([...REGISTRY_SOURCE.matchAll(/value: '([a-z-]+)'/g)].map((m) => m[1]));
    for (const tab of AGENT_CLIENT_TABS) expect(tabs.has(tab), tab).toBe(true);
  });

  it('builds a record link only from ids that check out', () => {
    expect(entityHref({ entity: 'client', id: CLIENT })).toBe(`/clients?clientId=${CLIENT}`);
    expect(entityHref({ entity: 'client', id: CLIENT, tab: 'deals' })).toBe(`/clients?clientId=${CLIENT}&tab=deals`);
    expect(entityHref({ entity: 'client', id: CLIENT, tab: 'nope' })).toBe(`/clients?clientId=${CLIENT}`);
    expect(entityHref({ entity: 'deal', id: DEAL, clientId: CLIENT })).toBe(`/clients?clientId=${CLIENT}&tab=deals&dealId=${DEAL}`);
    expect(entityHref({ entity: 'deal', id: DEAL })).toBeNull();
    expect(entityHref({ entity: 'report', id: REPORT })).toBe(`/investment-report/${REPORT}`);
    expect(entityHref({ entity: 'listing', id: 'recAbCdEfGhIjKlMn' })).toBe('/listings/recAbCdEfGhIjKlMn');
    expect(entityHref({ entity: 'client', id: `${CLIENT}&tab=x` })).toBeNull();
    expect(entityHref({ entity: 'report', id: '../admin' })).toBeNull();
  });

  it('every link it can build passes the browser\'s own check', () => {
    for (const key of AGENT_PAGE_KEYS) expect(isAgentHref(AGENT_PAGES[key].path)).toBe(true);
    for (const tab of AGENT_CLIENT_TABS) expect(isAgentHref(entityHref({ entity: 'client', id: CLIENT, tab }))).toBe(true);
    expect(isAgentHref(entityHref({ entity: 'deal', id: DEAL, clientId: CLIENT }))).toBe(true);
    expect(isAgentHref(entityHref({ entity: 'report', id: REPORT }))).toBe(true);
  });

  it('refuses anything that could leave the app or carry a payload', () => {
    for (const bad of [
      '//evil.example/x', 'https://evil.example', 'javascript:alert(1)', '/clients?clientId=x', '/settings/../admin',
      `/clients?clientId=${CLIENT}&redirect=https://x`, '/dashboard?x=1', 'dashboard', '', null, 42,
      `/investment-report/${REPORT}/../../x`,
    ]) {
      expect(isAgentHref(bad), String(bad)).toBe(false);
    }
  });

  it('resolves a page key before an entity, and refuses a bare URL', () => {
    expect(resolveAgentTarget({ page: 'pipeline' })).toEqual({ href: '/deal-pipeline', label: 'Deal pipeline' });
    expect(resolveAgentTarget({ page: 'pipeline', entity: 'client', id: CLIENT })?.href).toBe('/deal-pipeline');
    expect(resolveAgentTarget({ entity: 'client', id: CLIENT, label: 'Open **Sarah**' })).toEqual({
      href: `/clients?clientId=${CLIENT}`, label: 'Open Sarah',
    });
    expect(resolveAgentTarget({ href: '/dashboard' })).toBeNull();
    expect(resolveAgentTarget({ page: 'not_a_page' })).toBeNull();
    expect(resolveAgentTarget('dashboard')).toBeNull();
  });

  it('a label is plain text of a few words', () => {
    expect(cleanLabel('<b>Open</b> `x`')).toBe('bOpen/b x');
    expect(cleanLabel('a'.repeat(100))).toHaveLength(48);
  });

  it('moves the page only when the user\'s own words asked to go somewhere', () => {
    for (const yes of [
      'take me to the pipeline', 'go to reminders', 'open Sarah Chen\'s record', 'pull up the calendar',
      'Aurixa, open the deal pipeline', 'can you open her client file', 'navigate to settings', 'show me the dashboard',
    ]) expect(wantsNavigation(yes), yes).toBe(true);
    for (const no of [
      'what open deals do I have', 'which deals are open', 'show me deals at risk this week as a list',
      'how many clients do I have', 'remind me to go through the files', '', undefined,
    ]) expect(wantsNavigation(no), String(no)).toBe(false);
  });
});

describe('agentViews — a result drawn as the thing itself', () => {
  const NOW = Date.parse('2026-10-02T00:00:00Z');

  it('a client search becomes linked client cards with their names', () => {
    const [view] = viewsForTool('search_clients', {
      success: true,
      clients: [{ id: CLIENT, name: 'Sarah Chen', email: 's@x.au', mobile: '0400', pipeline_status: 'needs_follow_up' }],
    });
    expect(view).toMatchObject({ kind: 'records', entity: 'client', href: '/clients' });
    expect(view.kind === 'records' && view.items[0]).toMatchObject({
      title: 'Sarah Chen', subtitle: 's@x.au · 0400', badge: { label: 'Needs follow up' }, href: `/clients?clientId=${CLIENT}`,
    });
  });

  it('a deal links to its client\'s record only when the client id is real', () => {
    const [view] = viewsForTool('get_deals_by_risk', {
      deals: [
        { id: DEAL, client_id: CLIENT, property_address: '9 Hollow St', current_stage: 'pre_approval', loan_amount: 640000, risk_status: 'at_risk', client_name: 'Sarah Chen' },
        { id: REPORT, property_address: '1 Elsewhere Rd' },
      ],
    });
    if (view.kind !== 'records') throw new Error('records expected');
    expect(view.items[0]).toMatchObject({
      title: '9 Hollow St', subtitle: 'Sarah Chen · Pre approval', meta: '$640k',
      badge: { label: 'At risk', tone: 'critical' }, href: `/clients?clientId=${CLIENT}&tab=deals&dealId=${DEAL}`,
    });
    expect(view.items[1].href).toBeUndefined();
  });

  it('caps a long list and says how many there were', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `id-${i}`, name: `Client ${i}` }));
    const [view] = viewsForTool('search_clients', { clients: many });
    expect(view.kind === 'records' && view.items).toHaveLength(MAX_ITEMS);
    expect(view.kind === 'records' && view.total).toBe(13);
  });

  it('marks an overdue reminder against the reader\'s now, not the server\'s', () => {
    const [view] = viewsForTool('get_all_reminders', {
      overdue: [{ id: 'r1', title: 'Call Sarah', due_date: '2026-09-30T00:00:00Z', client_id: CLIENT }],
      today: [], upcoming: [{ id: 'r2', title: 'Send docs', due_date: '2026-10-09T00:00:00Z', priority: 'high' }],
    }, NOW);
    if (view.kind !== 'records') throw new Error('records expected');
    expect(view.items.map((i) => i.badge?.label)).toEqual(['Overdue', 'High']);
    expect(view.items[0].href).toBe(`/clients?clientId=${CLIENT}&tab=reminders`);
  });

  it('a pipeline overview is figures and a stage breakdown, and an absent figure is left out rather than zeroed', () => {
    const views = viewsForTool('get_pipeline_overview', {
      total_deals: 12, by_stage: { settled: 3, pre_approval: 7, lodged: 0 }, at_risk: 2, total_pipeline_value: 8_400_000,
    });
    expect(views.map((v) => v.kind)).toEqual(['metrics', 'breakdown']);
    const metrics = views[0].kind === 'metrics' ? views[0].items : [];
    expect(metrics.map((m) => m.label)).toEqual(['Deals', 'Pipeline value', 'At risk']);
    expect(metrics.find((m) => m.label === 'At risk')?.tone).toBe('critical');
    expect(views[1].kind === 'breakdown' && views[1].items.map((b) => b.label)).toEqual(['Pre approval', 'Settled']);
  });

  it('draws nothing for an error, a failure, an unknown tool or garbage — and never throws', () => {
    expect(viewsForTool('search_clients', { error: 'boom' })).toEqual([]);
    expect(viewsForTool('search_clients', { success: false, clients: [{ id: 'x', name: 'y' }] })).toEqual([]);
    expect(viewsForTool('create_reminder', { success: true })).toEqual([]);
    for (const junk of [null, undefined, 'x', 3, [], { clients: 'x' }, { clients: [null, 4, { id: 3 }] }]) {
      expect(() => viewsForTool('search_clients', junk)).not.toThrow();
      expect(viewsForTool('search_clients', junk)).toEqual([]);
    }
    const hostile = { get clients() { throw new Error('getter'); } };
    expect(viewsForTool('search_clients', hostile)).toEqual([]);
  });

  it('formats money the way a broker says it', () => {
    expect(formatAud(1_250_000)).toBe('$1.25m');
    expect(formatAud(12_000_000)).toBe('$12m');
    expect(formatAud(84_000)).toBe('$84k');
    expect(formatAud(9_400)).toBe('$9,400');
    expect(formatAud(null)).toBeNull();
    expect(humanise('needs_follow_up')).toBe('Needs follow up');
  });

  // A card reads a key off a tool's result. Each tool it draws must have an
  // executor, and that executor must produce the key the card reads.
  const READS: Record<string, string[]> = {
    search_clients: ['clients'], get_clients_by_pipeline_status: ['clients'], get_client_deals: ['deals'],
    get_deals_by_stage: ['deals'], get_deals_by_risk: ['deals'], get_stale_deals: ['stale_deals', 'days_stale'],
    get_settlement_countdown: ['settlements', 'days_remaining'], get_overdue_reminders: ['overdue_reminders'],
    get_client_reminders: ['reminders'], get_all_reminders: ['overdue', 'today', 'upcoming'],
    get_upcoming_calendar: ['appointments', 'startTime'], search_calendar_events: ['events'],
    get_recent_calls: ['calls'], search_calls: ['calls'], get_flagged_calls: ['flagged_calls'],
    get_pipeline_overview: ['total_deals', 'by_stage', 'total_pipeline_value'],
    get_dashboard_summary: ['total_aum', 'at_risk', 'overdue'],
    get_notification_summary: ['overdue_reminders', 'urgent_deals', 'unread_call_alerts'],
    get_commission_forecast: ['forecast', 'month', 'amount'],
  };

  it('names every tool it draws, and no others', () => {
    expect([...VIEW_TOOLS].sort()).toEqual(Object.keys(READS).sort());
  });

  for (const [tool, keys] of Object.entries(READS)) {
    it(`${tool}: the executor produces what the card reads`, () => {
      const body = executorBody(tool);
      for (const key of keys) expect(body, key).toMatch(new RegExp(`\\b${key}\\b`));
    });
  }

  it('the deal lookups return the client each deal belongs to, so a card can open it', () => {
    for (const tool of ['get_deals_by_stage', 'get_deals_by_risk', 'get_stale_deals', 'get_settlement_countdown']) {
      expect(executorBody(tool), tool).toMatch(/\bclient_id\b/);
    }
  });
});

describe('sanitizeView — the browser\'s gate on anything it is handed', () => {
  it('drops foreign links, unknown kinds and markup-free text survives', () => {
    const v = sanitizeView({
      kind: 'records', entity: 'client', title: 'Clients', href: 'https://evil.example',
      items: [
        { id: 'a', title: 'Sarah', href: '//evil.example', badge: { label: 'x', tone: 'loud' } },
        { id: 'b', title: 'Tom', href: `/clients?clientId=${CLIENT}` },
        { title: 'no id' },
      ],
    });
    expect(v).toEqual({
      kind: 'records', entity: 'client', title: 'Clients',
      items: [
        { id: 'a', title: 'Sarah', badge: { label: 'x', tone: 'neutral' } },
        { id: 'b', title: 'Tom', href: `/clients?clientId=${CLIENT}` },
      ],
    });
    expect(sanitizeView({ kind: 'html', title: 'x', items: [] })).toBeNull();
    expect(sanitizeView({ kind: 'records', entity: 'secrets', title: 'x', items: [{ id: 'a', title: 'b' }] })).toBeNull();
  });

  it('caps a list it was handed, whatever the sender claimed', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, title: `Row ${i}` }));
    const v = sanitizeView({ kind: 'records', entity: 'deal', title: 'Deals', items, total: 3 });
    expect(v?.kind === 'records' && v.items).toHaveLength(MAX_ITEMS);
    expect(v && 'total' in v ? v.total : undefined).toBeUndefined();
  });

  it('a breakdown needs a real number', () => {
    const v = sanitizeView({ kind: 'breakdown', title: 'B', items: [{ label: 'a', value: Number.NaN, display: '1' }, { label: 'b', value: 2, display: '2' }] });
    expect(v?.kind === 'breakdown' && v.items.map((i) => i.label)).toEqual(['b']);
  });

  it('everything the builders produce survives the gate unchanged', () => {
    const views = [
      ...viewsForTool('search_clients', { clients: [{ id: CLIENT, name: 'Sarah', email: 'a@b.c', follow_up_date: '2026-10-03' }] }),
      ...viewsForTool('get_pipeline_overview', { total_deals: 4, by_stage: { a: 1, b: 2 } }),
      ...viewsForTool('get_commission_forecast', { forecast: [{ month: '2026-10', amount: 4000 }, { month: '2026-11', amount: 0 }] }),
    ];
    expect(views.length).toBe(4);
    for (const v of views) expect(sanitizeView(JSON.parse(JSON.stringify(v)))).toEqual(v);
  });
});

describe('agentPlan — the checklist the agent shows before it works', () => {
  it('a fresh plan shows where the agent is', () => {
    expect(normalisePlan({ steps: ['Find Sarah', 'Check her deals'] })?.steps).toEqual([
      { label: 'Find Sarah', status: 'active' },
      { label: 'Check her deals', status: 'pending' },
    ]);
    expect(normalisePlan({ steps: [{ label: 'A', status: 'done' }, { label: 'B' }] })?.steps[1].status).toBe('active');
  });

  it('a stored plan says what it said', () => {
    const stored = { steps: [{ label: 'A', status: 'done' }, { label: 'B', status: 'pending' }] };
    expect(normalisePlan(stored, { promote: false })?.steps[1].status).toBe('pending');
  });

  it('is small and plain', () => {
    const plan = normalisePlan({
      title: '# **Settlement** check',
      steps: [...Array.from({ length: 12 }, (_, i) => `Step <${i}>`), { status: 'done' }, 7],
    });
    expect(plan?.title).toBe('Settlement check');
    expect(plan?.steps).toHaveLength(MAX_PLAN_STEPS);
    expect(plan?.steps[0].label).toBe('Step 0');
    expect(normalisePlan({ steps: [] })).toBeNull();
    expect(normalisePlan({ steps: 'Find Sarah' })).toBeNull();
    expect(normalisePlan(null)).toBeNull();
  });

  it('counts done and skipped as settled, and a halted plan is not left running', () => {
    const plan = normalisePlan({ steps: [{ label: 'A', status: 'done' }, { label: 'B', status: 'skipped' }, { label: 'C', status: 'active' }] });
    expect(planProgress(plan)).toEqual({ done: 2, total: 3, settled: false });
    expect(haltPlan(plan)?.steps.map((s) => s.status)).toEqual(['done', 'skipped', 'pending']);
    expect(planProgress(null).settled).toBe(true);
  });
});

describe('agentReceipt — the work an answer took, kept with it', () => {
  const view = viewsForTool('search_clients', { clients: [{ id: CLIENT, name: 'Sarah Chen' }] })[0];

  it('a plain reply keeps a plain row', () => {
    expect(buildReceipt({})).toBeNull();
    expect(buildReceipt({ steps: [{ tool: 'BAD NAME' }], actions: [{ href: 'https://x', label: 'x' }] })).toBeNull();
  });

  it('keeps tools and timings, never arguments', () => {
    const r = buildReceipt({
      elapsedMs: 4210.6,
      steps: [{ tool: 'search_clients', ms: 312.4, ok: true, args: { query: 'Sarah' } }, { tool: 'get_client_deals', ok: false }],
      plan: { steps: [{ label: 'Find Sarah', status: 'done' }, { label: 'Open her', status: 'pending' }] },
      views: [view],
      actions: [{ href: `/clients?clientId=${CLIENT}`, label: 'Open Sarah' }, { href: `/clients?clientId=${CLIENT}`, label: 'again' }],
    });
    expect(r).toEqual({
      aurixa: RECEIPT_VERSION,
      elapsedMs: 4211,
      steps: [{ tool: 'search_clients', ms: 312, ok: true }, { tool: 'get_client_deals', ok: false }],
      plan: { steps: [{ label: 'Find Sarah', status: 'done' }, { label: 'Open her', status: 'pending' }] },
      views: [view],
      actions: [{ href: `/clients?clientId=${CLIENT}`, label: 'Open Sarah' }],
    });
    expect(JSON.stringify(r)).not.toMatch(/"args"|"query"/);
    expect(readReceipt(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it('stays a row: past the cap the cards go first', () => {
    const long = (n: number) => `${'Long words here '.repeat(10)}${n}`;
    const big = {
      kind: 'records', entity: 'client', title: 'Clients',
      items: Array.from({ length: 8 }, (_, i) => ({
        id: `id-${i}`, title: long(i), subtitle: long(i), meta: long(i), href: `/clients?clientId=${CLIENT}`,
      })),
    };
    const r = buildReceipt({ steps: [{ tool: 'search_clients' }], views: Array.from({ length: 6 }, () => big) });
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(MAX_RECEIPT_CHARS);
    expect(r?.steps).toHaveLength(1);
    expect((r?.views ?? []).length).toBeLessThan(6);
  });

  it('reads only its own version, and re-checks what it reads', () => {
    expect(readReceipt({ aurixa: 1, steps: [] })).toBeNull();
    expect(readReceipt([{ tool_call_id: 'x' }])).toBeNull();
    expect(readReceipt(null)).toBeNull();
    const tampered = readReceipt({
      aurixa: RECEIPT_VERSION, steps: [{ tool: 'search_clients' }],
      actions: [{ href: 'javascript:alert(1)', label: 'x' }], views: [{ kind: 'html', title: 't', items: [] }],
    });
    expect(tampered).toEqual({ aurixa: RECEIPT_VERSION, steps: [{ tool: 'search_clients', ok: true }] });
  });
});

describe('agentUiTools — the two tools that talk to the panel', () => {
  it('declares exactly the two tools it runs, with the routes module\'s own lists', () => {
    const names = UI_TOOLS.map((t) => (t as { function: { name: string } }).function.name);
    expect(new Set(names)).toEqual(UI_TOOL_NAMES);
    const open = UI_TOOLS.find((t) => (t as { function: { name: string } }).function.name === 'open_page') as {
      function: { parameters: { properties: Record<string, { enum?: string[] }> } };
    };
    expect(open.function.parameters.properties.page.enum).toEqual(AGENT_PAGE_KEYS);
    expect(open.function.parameters.properties.tab.enum).toEqual([...AGENT_CLIENT_TABS]);
  });

  it('a plan goes on screen and the model is told not to repeat it', () => {
    const out = runUiTool('show_plan', { steps: ['Find Sarah', 'Check deals'] });
    expect(out.kind).toBe('plan');
    expect(out.reply).toMatchObject({ success: true });
    expect(runUiTool('show_plan', { steps: [] }).kind).toBe('refused');
  });

  it('an open is a button, and the reply never claims the user moved', () => {
    const out = runUiTool('open_page', { entity: 'client', id: CLIENT, label: 'Open Sarah' });
    expect(out).toMatchObject({ kind: 'open', target: { href: `/clients?clientId=${CLIENT}`, label: 'Open Sarah' } });
    expect(String(out.reply.message)).toMatch(/button/);
    expect(String(out.reply.message)).not.toMatch(/opened|navigated|took you/i);
  });

  it('an id that does not check out is said to the model, so it can look the record up', () => {
    const out = runUiTool('open_page', { entity: 'deal', id: DEAL });
    expect(out.kind).toBe('refused');
    expect(String(out.reply.error)).toMatch(/client_id/);
    expect(runUiTool('delete_everything', {}).kind).toBe('refused');
  });

  it('the prompt is additive: it never tells the model to drop what an older panel needs', () => {
    expect(UI_TOOLS_PROMPT).toMatch(/Answer exactly as you otherwise would/);
    expect(UI_TOOLS_PROMPT).not.toMatch(/do not (list|repeat the (list|rows|table))|omit the (list|table)/i);
  });

  it('a panel tool is never a step in the trace and never an action awaiting approval', () => {
    for (const name of UI_TOOL_NAMES) {
      expect(PANEL_TOOLS.has(name)).toBe(true);
      expect(META_TOOLS.has(name)).toBe(false);
      expect(describePendingAction({ function: { name, arguments: '{}' } })).toBeNull();
    }
  });
});
