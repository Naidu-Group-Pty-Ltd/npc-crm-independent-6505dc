import { describe, expect, it } from 'vitest';
import {
  finishTrace,
  formatDuration,
  startTrace,
  traceSummary,
  traceToolEnd,
  traceToolStart,
  traceTools,
} from '../workTrace.pure';

describe('work trace', () => {
  it('records a tool as a narrated step and finishes it', () => {
    let t = startTrace(0);
    t = traceToolStart(t, 'get_upcoming_calendar', 100);
    expect(t.steps[0]).toMatchObject({ label: 'Checking your calendar', status: 'running', count: 1 });
    t = traceToolEnd(t, 'get_upcoming_calendar', 900);
    expect(t.steps[0]).toMatchObject({ status: 'done', endedAt: 900 });
  });

  it('folds the three discovery calls into one step', () => {
    let t = startTrace(0);
    for (const meta of ['list_tool_domains', 'search_tools', 'load_tools']) {
      t = traceToolStart(t, meta, 1);
      t = traceToolEnd(t, meta, 2);
    }
    expect(t.steps).toHaveLength(1);
    expect(t.steps[0]).toMatchObject({ label: 'Choosing the right tools', count: 3, status: 'done' });
  });

  it('keeps distinct tools as distinct steps', () => {
    let t = startTrace(0);
    t = traceToolStart(t, 'search_clients', 1);
    t = traceToolEnd(t, 'search_clients', 2);
    t = traceToolStart(t, 'get_client_deals', 3);
    expect(t.steps.map((s) => s.status)).toEqual(['done', 'running']);
    expect(traceTools(t)).toEqual(['search_clients', 'get_client_deals']);
  });

  it('closes anything still running when the reply ends', () => {
    let t = traceToolStart(startTrace(0), 'search_clients', 1);
    t = finishTrace(t, 6200);
    expect(t.steps[0].status).toBe('done');
    expect(traceSummary(t)).toBe('Worked for 6s · 1 step');
  });

  it('says a stopped run was stopped', () => {
    const t = finishTrace(startTrace(0), 2000, true);
    expect(traceSummary(t)).toBe('Stopped after 2s');
  });

  it('ignores an end it never saw start', () => {
    const t = startTrace(0);
    expect(traceToolEnd(t, 'x', 1)).toBe(t);
  });
});

describe('formatDuration', () => {
  it('never says zero seconds and reads minutes plainly', () => {
    expect(formatDuration(120)).toBe('1s');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(60_000)).toBe('1m');
    expect(formatDuration(95_000)).toBe('1m 35s');
  });
});
