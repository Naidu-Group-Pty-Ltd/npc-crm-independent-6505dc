/**
 * The panel an answer carries, live and reloaded — and the promise that it
 * is the same panel either way, because both pass through one set of checks.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_PANEL,
  MAX_PANEL_ACTIONS,
  MAX_PANEL_VIEWS,
  actionFrom,
  formatWhen,
  isCurrentPage,
  isEmptyPanel,
  panelFromReceipt,
  shouldOpenPage,
  traceFromReceipt,
  withAction,
  withPlan,
  withViews,
} from '../answerPanel.pure';
import { buildReceipt, viewsForTool } from '../protocol';
import { traceSummary } from '../workTrace.pure';

const CLIENT = '3f6c1a2e-8a1b-4c3d-9e0f-112233445566';
const cardOf = (n: number) => viewsForTool('search_clients', { clients: Array.from({ length: n }, (_, i) => ({ id: `c-${i}`, name: `Client ${i}` })) });

describe('live events', () => {
  it('an empty panel draws nothing', () => {
    expect(isEmptyPanel(EMPTY_PANEL)).toBe(true);
    expect(isEmptyPanel(null)).toBe(true);
  });

  it('a plan event replaces the plan exactly as sent', () => {
    const p = withPlan(EMPTY_PANEL, { plan: { steps: [{ label: 'Find the client', status: 'done' }, { label: 'Check the deal', status: 'pending' }] } });
    // Stored as sent: the browser does not promote a step to "active" on its own.
    expect(p.plan?.steps.map((s) => s.status)).toEqual(['done', 'pending']);
    expect(withPlan(p, { plan: { steps: [] } })).toBe(p);
    expect(withPlan(p, 'nonsense')).toBe(p);
  });

  it('a view event adds sanitised cards up to the cap, and refuses markup', () => {
    let p = EMPTY_PANEL;
    for (let i = 0; i < MAX_PANEL_VIEWS + 2; i++) p = withViews(p, { tool: 'search_clients', views: cardOf(1) });
    expect(p.views).toHaveLength(MAX_PANEL_VIEWS);
    const hostile = withViews(EMPTY_PANEL, { views: [{ kind: 'records', entity: 'client', title: 'x', items: [{ id: '1', title: 'A', href: 'javascript:alert(1)' }] }] });
    expect(hostile.views[0]?.kind === 'records' && hostile.views[0].items[0].href).toBeFalsy();
    expect(withViews(EMPTY_PANEL, { views: [{ kind: 'html', title: 'x', items: [] }] })).toBe(EMPTY_PANEL);
  });

  it('a page offer is re-checked in the browser, once per page, up to the cap', () => {
    expect(actionFrom({ kind: 'open', href: '/deal-pipeline', label: 'Pipeline' })).toEqual({ href: '/deal-pipeline', label: 'Pipeline' });
    for (const href of ['https://evil.example', '//evil.example', '/admin/users', 'javascript:alert(1)', '/clients?clientId=nope']) {
      expect(actionFrom({ kind: 'open', href, label: 'Go' })).toBeNull();
    }
    expect(actionFrom({ kind: 'open', href: '/deal-pipeline', label: '   ' })).toBeNull();
    expect(actionFrom({ kind: 'close', href: '/deal-pipeline', label: 'Pipeline' })).toBeNull();

    let p = withAction(EMPTY_PANEL, { kind: 'open', href: '/deal-pipeline', label: 'Pipeline' });
    p = withAction(p, { kind: 'open', href: '/deal-pipeline', label: 'Pipeline again' });
    expect(p.actions).toHaveLength(1);
    for (const href of ['/reminders', '/calendar', '/clients', '/listings', '/settings']) p = withAction(p, { kind: 'open', href, label: href });
    expect(p.actions.length).toBeLessThanOrEqual(MAX_PANEL_ACTIONS);
  });
});

describe('a stored receipt', () => {
  const receipt = buildReceipt({
    elapsedMs: 4_200,
    steps: [
      { tool: 'search_tools', ms: 100, ok: true },
      { tool: 'search_clients', ms: 300, ok: true },
      { tool: 'search_clients', ms: 200, ok: true },
      { tool: 'get_client_deals', ms: 900, ok: false },
    ],
    plan: { steps: [{ label: 'Find the client', status: 'done' }, { label: 'Read the deals', status: 'done' }] },
    views: cardOf(2),
    actions: [{ href: `/clients?clientId=${CLIENT}`, label: 'Sarah Chen' }],
  });

  it('rebuilds the same panel the stream drew', () => {
    const p = panelFromReceipt(JSON.parse(JSON.stringify(receipt)));
    expect(p?.plan?.steps).toHaveLength(2);
    expect(p?.views).toHaveLength(1);
    expect(p?.actions).toEqual([{ href: `/clients?clientId=${CLIENT}`, label: 'Sarah Chen' }]);
  });

  it('rebuilds the work trace, folded the way the live one is, timed by the receipt', () => {
    const trace = traceFromReceipt(receipt);
    expect(trace?.steps.map((s) => [s.tool, s.count, s.status])).toEqual([
      ['search_clients', 2, 'done'],
      ['get_client_deals', 1, 'done'],
    ]);
    expect(traceSummary(trace!)).toBe('Worked for 4s · 2 steps');
  });

  it('an answer written before receipts keeps its plain row', () => {
    for (const old of [null, undefined, {}, [], { aurixa: 1, steps: [] }, 'text']) {
      expect(panelFromReceipt(old)).toBeNull();
      expect(traceFromReceipt(old)).toBeNull();
    }
    expect(traceFromReceipt(buildReceipt({ plan: { steps: ['Only a plan'] } }))).toBeNull();
  });
});

describe('shouldOpenPage — the page moves only when asked', () => {
  const base = { asked: 'take me to the pipeline', wide: true, alreadyMoved: false, href: '/deal-pipeline', here: '/dashboard' };

  it('opens when the request named a destination on a wide screen', () => {
    expect(shouldOpenPage(base)).toBe(true);
    expect(shouldOpenPage({ ...base, asked: 'open Sarah Chen\'s client record' })).toBe(true);
  });

  it('waits as a button otherwise', () => {
    expect(shouldOpenPage({ ...base, asked: 'how is the pipeline looking?' })).toBe(false);
    expect(shouldOpenPage({ ...base, wide: false })).toBe(false);
    expect(shouldOpenPage({ ...base, alreadyMoved: true })).toBe(false);
    expect(shouldOpenPage({ ...base, here: '/deal-pipeline' })).toBe(false);
    expect(shouldOpenPage({ ...base, href: 'https://evil.example' })).toBe(false);
  });

  it('knows the page the reader is on', () => {
    expect(isCurrentPage('/deal-pipeline', { pathname: '/deal-pipeline', search: '' })).toBe(true);
    expect(isCurrentPage(`/clients?clientId=${CLIENT}`, { pathname: '/clients', search: `?clientId=${CLIENT}` })).toBe(true);
    expect(isCurrentPage('/reminders', { pathname: '/deal-pipeline', search: '' })).toBe(false);
  });
});

describe('formatWhen — the reader\'s own day', () => {
  const now = new Date('2026-10-02T02:00:00Z'); // 12 noon in Sydney, 10 am in Perth
  const SYD = 'Australia/Sydney';

  it('names today, tomorrow and yesterday with a time', () => {
    expect(formatWhen('2026-10-02T04:30:00.000Z', now, SYD)).toBe('Today, 2:30 pm');
    expect(formatWhen('2026-10-03T00:15:00.000Z', now, SYD)).toBe('Tomorrow, 10:15 am');
    expect(formatWhen('2026-10-01T03:00:00.000Z', now, SYD)).toBe('Yesterday, 1:00 pm');
  });

  it('reads a bare date as a date, never as a clock time', () => {
    expect(formatWhen('2026-10-02T00:00:00.000Z', now, 'Australia/Perth')).toBe('Today');
    expect(formatWhen('2026-10-09T00:00:00.000Z', now, SYD)).toBe('9 Oct');
  });

  it('adds the year only when it is not this one, and says nothing about nonsense', () => {
    expect(formatWhen('2025-03-14T00:00:00.000Z', now, SYD)).toBe('14 Mar 2025');
    expect(formatWhen('not a date', now, SYD)).toBeNull();
    expect(formatWhen(undefined, now, SYD)).toBeNull();
  });
});
