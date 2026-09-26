/**
 * Paging the supply register.
 *
 * The numbers these rules exist for are production measurements taken by
 * `abs-approvals-liveness` on 21 Sep 2026, not fixtures: at SA2 grain with
 * the query narrowed, 33 months is 111.6 MB, 12 months is 26.0 MB and 6
 * months is 12.2 MB against a 24 MB ceiling.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  APPROVALS_LEDGER_MAX_MONTHS,
  APPROVALS_LEDGER_SELECT,
  APPROVALS_PAGE_MONTHS,
  completedWindowOf,
  planApprovalsWork,
  approvalsPage,
  monthSpan,
  pagesToCover,
  shiftMonth,
  stillDescribesTheTable,
  vouchedOldest,
  type ApprovalsLedgerEntry,
  type CompletedApprovalsWindow,
} from '../../../../supabase/functions/_shared/reports/market/openData/absApprovalsPaging.pure.ts';

describe('period arithmetic has no Date in it', () => {
  it('shifts across year boundaries in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-09', -12)).toBe('2025-09');
    expect(shiftMonth('2026-09', 0)).toBe('2026-09');
  });

  it('refuses anything that is not YYYY-MM rather than coercing it', () => {
    expect(() => shiftMonth('2026-9', -1)).toThrow(/must be YYYY-MM/);
    expect(() => shiftMonth('September 2026', -1)).toThrow(/must be YYYY-MM/);
    expect(() => monthSpan('2026-09', 'later')).toThrow(/must be YYYY-MM/);
  });

  it('counts a span inclusively, and signs a backwards one', () => {
    expect(monthSpan('2026-04', '2026-09')).toBe(6);
    expect(monthSpan('2026-09', '2026-09')).toBe(1);
    expect(monthSpan('2026-09', '2026-04')).toBeLessThan(0);
  });
});

describe('the frontier is measured, never assumed', () => {
  it('asks page 0 forward from today and imposes NO floor', () => {
    /*
     * The ABS publishes with a lag: a six-month window asked on 21 Sep 2026
     * returned four months, to 2026-07. Judging that as truncated would
     * refuse every healthy load, and hard-coding "expect two months" is a
     * constant nobody here can verify and the Bureau can change silently.
     */
    const page = approvalsPage(0, '2026-09', null);
    // DERIVED from the constant, not restated: the window is whatever
    // `APPROVALS_PAGE_MONTHS` says, and pinning a literal here is how a spec
    // comes to assert the page size in two places that can disagree.
    expect(page).toEqual({
      index: 0,
      startPeriod: shiftMonth('2026-09', -(APPROVALS_PAGE_MONTHS - 1)),
      endPeriod: '2026-09',
      minPeriods: null,
    });
  });

  it('treats a first run with no frontier as the frontier whatever the index', () => {
    expect(approvalsPage(3, '2026-09', null).minPeriods).toBeNull();
    expect(approvalsPage(3, '2026-09', null).endPeriod).toBe('2026-09');
  });
});

describe('every page after the frontier lies wholly in the past', () => {
  // The frontier the Bureau actually gave on 21 Sep 2026.
  const FRONTIER = '2026-07';

  it('steps back a whole window and demands a full one', () => {
    // Derived from `APPROVALS_PAGE_MONTHS` rather than written out: page 1
    // ends the month before the frontier and spans one whole window, page 2
    // ends the month before page 1, and both demand a full window because
    // they lie wholly in the past.
    const n = APPROVALS_PAGE_MONTHS;
    const firstEnd = shiftMonth(FRONTIER, -1);
    expect(approvalsPage(1, '2026-09', FRONTIER)).toEqual({
      index: 1,
      startPeriod: shiftMonth(firstEnd, -(n - 1)),
      endPeriod: firstEnd,
      minPeriods: n,
    });
    const secondEnd = shiftMonth(firstEnd, -n);
    expect(approvalsPage(2, '2026-09', FRONTIER)).toEqual({
      index: 2,
      startPeriod: shiftMonth(secondEnd, -(n - 1)),
      endPeriod: secondEnd,
      minPeriods: n,
    });
  });

  it('never overlaps the frontier page, so no month is fetched twice', () => {
    const first = approvalsPage(0, '2026-09', null);
    const second = approvalsPage(1, '2026-09', FRONTIER);
    // The frontier page covered up to 2026-07 (what the publisher had); the
    // next page must end the month before it.
    expect(second.endPeriod).toBe(shiftMonth(FRONTIER, -1));
    expect(monthSpan(second.startPeriod, second.endPeriod)).toBe(APPROVALS_PAGE_MONTHS);
    expect(first.endPeriod > second.endPeriod).toBe(true);
  });

  it('leaves no gap between consecutive pages', () => {
    for (let i = 1; i < 6; i++) {
      const here = approvalsPage(i, '2026-09', FRONTIER);
      const next = approvalsPage(i + 1, '2026-09', FRONTIER);
      expect(shiftMonth(next.endPeriod, 1)).toBe(here.startPeriod);
    }
  });

  it('refuses a page index that is not a whole number of pages back', () => {
    expect(() => approvalsPage(-1, '2026-09', FRONTIER)).toThrow(/non-negative integer/);
    expect(() => approvalsPage(1.5, '2026-09', FRONTIER)).toThrow(/non-negative integer/);
    expect(() => approvalsPage(1, '2026-09', FRONTIER, 0)).toThrow(/at least one month/);
  });
});

describe('a run can say what remains', () => {
  it('counts the pages between a frontier and a floor', () => {
    // Derived, because the answer is a function of the window: 2023-01 to
    // 2026-07 is 43 months, so it is however many whole windows that takes.
    const span = monthSpan('2023-01', '2026-07');
    expect(span).toBe(43);
    expect(pagesToCover('2026-07', '2023-01'))
      .toBe(Math.ceil(span / APPROVALS_PAGE_MONTHS));
    const shortSpan = monthSpan('2026-02', '2026-07');
    expect(pagesToCover('2026-07', '2026-02'))
      .toBe(Math.ceil(shortSpan / APPROVALS_PAGE_MONTHS));
  });

  it('never answers zero, because the frontier page always runs', () => {
    expect(pagesToCover('2026-07', '2026-07')).toBe(1);
    expect(pagesToCover('2026-07', '2027-01')).toBe(1);
  });

  it('is the page size the measurement supports — measured in the worker', () => {
    // This assertion used to pin 6, on a CI measurement of the Bureau's
    // BYTES: 12 months = 26.0 MB against a 24 MB ceiling, 6 months = 12.2.
    // Every one of those is a fact about the wire, and the first production
    // run answered HTTP 546 — the worker's RESOURCE limit — on that exact
    // six-month window, because the stage holds the body, the parsed rows and
    // the upsert payload live at once.
    //
    // Re-measured in the worker against the deployed function, 22 Sep 2026,
    // at SA2 grain: 1 month = 5,814 rows / 200, 3 months = 17,442 / 200,
    // 6 months = ~34,884 / 546. Three is the largest PROVEN window; 4 and 5
    // are not taken because an unmeasured edge fails as a nightly 546 that
    // pg_cron reports green.
    expect(APPROVALS_PAGE_MONTHS).toBe(3);
  });
});

describe('the walk advances itself, in perpetuity, from the register’s own edges', () => {
  /*
   * The defect: `approvalsPage` steps back by `(index - 1)` windows and
   * nothing ever supplied an index. The cron posts `{"stage":"approvals"}`,
   * the stage reads `body.page ?? 0`, and page 0 asks FORWARD — so the
   * register re-read three months for ever and never deepened. It was not a
   * slow backfill; it was no backfill.
   */
  const FLOOR = '2023-01';

  /**
   * One invocation against a simulated register: whatever window the planner
   * asks for is "loaded", bounded by what the publisher has. Returns the new
   * register state so a caller can iterate — because the property under test
   * is CONVERGENCE, which no single assertion can express.
   */
  const run = (
    reg: { frontier: string | null; oldest: string | null; frontierLoadedAt: string | null },
    asOf: string,
    published: string,
  ) => {
    const work = planApprovalsWork({ ...reg, asOf, floor: FLOOR });
    if (work.kind === 'settled') return { reg, work };
    const end = work.endPeriod! > published ? published : work.endPeriod!;
    const start = work.startPeriod!;
    return {
      work,
      reg: {
        frontier: reg.frontier === null || end > reg.frontier ? end : reg.frontier,
        oldest: reg.oldest === null || start < reg.oldest ? start : reg.oldest,
        // A frontier read stamps the frontier rows; a backfill does not.
        frontierLoadedAt: work.kind === 'frontier' ? asOf : reg.frontierLoadedAt,
      },
    };
  };

  it('reaches the floor and then settles, without an index anywhere', () => {
    let reg = { frontier: null as string | null, oldest: null as string | null, frontierLoadedAt: null as string | null };
    const kinds: string[] = [];
    for (let i = 0; i < 40; i++) {
      const step = run(reg, '2026-09', '2026-07');
      reg = step.reg;
      kinds.push(step.work.kind);
      if (step.work.kind === 'settled') break;
    }
    expect(kinds[0]).toBe('frontier');
    expect(kinds).toContain('backfill');
    expect(kinds[kinds.length - 1]).toBe('settled');
    // Complete to the floor and current to what the publisher actually has.
    expect(reg.oldest! <= FLOOR).toBe(true);
    expect(reg.frontier).toBe('2026-07');
    // And it got there in a bounded number of invocations, not a month of them.
    expect(kinds.length).toBeLessThanOrEqual(1 + Math.ceil(44 / APPROVALS_PAGE_MONTHS) + 1);
  });

  it('never re-reads the frontier on every run, which the lag would have caused', () => {
    // `asOf > frontier` is ALWAYS true against a publisher two months in
    // arrears. A comparison-based currency test starves the backfill for
    // ever — the first cut of this planner did exactly that.
    const reg = { frontier: '2026-07', oldest: '2026-05', frontierLoadedAt: '2026-09' };
    const work = planApprovalsWork({ ...reg, asOf: '2026-09', floor: FLOOR });
    expect(work.kind).toBe('backfill');
    expect(work.endPeriod).toBe('2026-04');
  });

  it('takes the frontier once per calendar month, and that is how a revision lands', () => {
    const settled = { frontier: '2026-07', oldest: '2023-01', frontierLoadedAt: '2026-09' };
    expect(planApprovalsWork({ ...settled, asOf: '2026-09', floor: FLOOR }).kind).toBe('settled');
    // The calendar moves: currency is owed again even though nothing else is.
    const next = planApprovalsWork({ ...settled, asOf: '2026-10', floor: FLOOR });
    expect(next.kind).toBe('frontier');
    expect(next.windowsRemaining).toBe(0);
  });

  it('asks the publisher nothing once complete and current', () => {
    const work = planApprovalsWork({
      frontier: '2026-07', oldest: '2023-01', frontierLoadedAt: '2026-09',
      asOf: '2026-09', floor: FLOOR,
    });
    expect(work.kind).toBe('settled');
    expect(work.startPeriod).toBeNull();
    expect(work.endPeriod).toBeNull();
  });

  it('owes nothing extra once the oldest month IS the floor', () => {
    const work = planApprovalsWork({
      frontier: '2026-07', oldest: FLOOR, frontierLoadedAt: '2026-09',
      asOf: '2026-09', floor: FLOOR,
    });
    expect(work.kind).toBe('settled');
  });

  it('deepens below the oldest month and demands a full window', () => {
    const work = planApprovalsWork({
      frontier: '2026-07', oldest: '2026-05', frontierLoadedAt: '2026-09',
      asOf: '2026-09', floor: FLOOR,
    });
    expect(work.endPeriod).toBe('2026-04');
    expect(monthSpan(work.startPeriod!, work.endPeriod!)).toBe(APPROVALS_PAGE_MONTHS);
    expect(work.minPeriods).toBe(APPROVALS_PAGE_MONTHS);
  });

  it('establishes the frontier on an empty register and says what remains', () => {
    const work = planApprovalsWork({
      frontier: null, oldest: null, frontierLoadedAt: null, asOf: '2026-09', floor: FLOOR,
    });
    expect(work.kind).toBe('frontier');
    expect(work.minPeriods).toBeNull();
    expect(work.windowsRemaining).toBeGreaterThan(1);
    expect(work.because).toMatch(/holds nothing/);
  });
});

/*
 * ─── What the register can PROVE it holds ─────────────────────────────────
 *
 * The walk used to step below `min(period)`, and rows are not proof: a window
 * a run died part-way through has rows and is not whole, and stepping below
 * it leaves a hole nothing ever asks for again. These pin the replacement —
 * the edge is the bottom of the unbroken run of months that COMPLETED writes
 * vouch for, and the sync ledger is where completion is recorded.
 */
const SA2 = 'sa2';
const FLOOR_23 = '2023-01';

const successRow = (over: Partial<Record<keyof ApprovalsLedgerEntry, unknown>> = {}): ApprovalsLedgerEntry => ({
  stage: 'approvals',
  area_kind: SA2,
  first: '2025-10',
  last: '2025-12',
  periods: 3,
  rows_written: 14_802,
  period_list: ['2025-10', '2025-11', '2025-12'],
  stamp: '2026-09-22T11:20:01.705Z',
  created_at: '2026-09-22T11:20:15.412+00:00',
  ...over,
});

const windowOf = (months: string[], at: string): CompletedApprovalsWindow => ({
  months,
  stamp: at,
  recordedAt: at,
});

describe('a ledger row proves a window only where it says so consistently', () => {
  it('reads a success row as exactly the months it carried', () => {
    expect(completedWindowOf(successRow(), SA2)).toEqual({
      months: ['2025-10', '2025-11', '2025-12'],
      stamp: '2026-09-22T11:20:01.705Z',
      recordedAt: '2026-09-22T11:20:15.412+00:00',
    });
  });

  it('believes a row written before the month list only where its count says it had no gap', () => {
    // Every approvals success row since the stage was born carries first,
    // last and a count; `period_list` and `rows_loaded_at` are new. A count
    // equal to the span is a window with no gap in it.
    const legacy = successRow({ period_list: undefined, stamp: undefined });
    expect(completedWindowOf(legacy, SA2)?.months).toEqual(['2025-10', '2025-11', '2025-12']);
    expect(completedWindowOf(legacy, SA2)?.stamp).toBeNull();
    // Three months across a four-month span: which one is missing is not
    // something the row can say, so it proves nothing.
    expect(completedWindowOf(successRow({ period_list: undefined, last: '2026-01', periods: 3 }), SA2)).toBeNull();
  });

  it('proves exactly the listed months when the write itself had a gap', () => {
    const gapped = completedWindowOf(successRow({
      first: '2026-05', last: '2026-08', periods: 3, period_list: ['2026-08', '2026-05', '2026-06'],
    }), SA2);
    expect(gapped?.months).toEqual(['2026-05', '2026-06', '2026-08']);
  });

  it('proves nothing from a refusal, a settled run, another grain or another stage', () => {
    expect(completedWindowOf({ stage: 'approvals', refused: 'x' } as ApprovalsLedgerEntry, SA2)).toBeNull();
    expect(completedWindowOf(successRow({ first: undefined, last: undefined }), SA2)).toBeNull();
    expect(completedWindowOf(successRow({ area_kind: 'lga' }), SA2)).toBeNull();
    expect(completedWindowOf(successRow({ stage: 'nsw' }), SA2)).toBeNull();
    expect(completedWindowOf(null, SA2)).toBeNull();
  });

  it('proves nothing from a write that wrote nothing', () => {
    expect(completedWindowOf(successRow({ rows_written: 0 }), SA2)).toBeNull();
    expect(completedWindowOf(successRow({ rows_written: '14802' }), SA2)).toBeNull();
  });

  it('refuses a month list that disagrees with its own first month, last month or count', () => {
    expect(completedWindowOf(successRow({ period_list: ['2025-10', '2025-11'] }), SA2)).toBeNull();
    expect(completedWindowOf(successRow({ period_list: ['2025-09', '2025-11', '2025-12'] }), SA2)).toBeNull();
    expect(completedWindowOf(successRow({ period_list: ['2025-10', '2025-10', '2025-12'] }), SA2)).toBeNull();
    expect(completedWindowOf(successRow({ period_list: '2025-10,2025-11,2025-12' }), SA2)).toBeNull();
  });

  it('refuses what is not a calendar month rather than coercing it', () => {
    // `shiftMonth` reads `2026-13` as January 2027; the ledger check does not.
    expect(completedWindowOf(successRow({ last: '2025-13', period_list: undefined }), SA2)).toBeNull();
    expect(completedWindowOf(successRow({ first: '0000-01', period_list: undefined }), SA2)).toBeNull();
    expect(completedWindowOf(successRow({ first: '2025-1' }), SA2)).toBeNull();
  });

  it('does not believe a window wider than any this register could hold', () => {
    const first = '1950-01';
    const last = '2026-12';
    const span = monthSpan(first, last);
    expect(span).toBeGreaterThan(APPROVALS_LEDGER_MAX_MONTHS);
    expect(completedWindowOf(successRow({ first, last, periods: span, period_list: undefined }), SA2)).toBeNull();
  });

  it('selects every field the proof reads, and nothing it would have to guess', () => {
    for (const path of [
      'detail->>stage', 'detail->>area_kind', 'detail->>first_period', 'detail->>latest_period',
      'detail->periods', 'detail->rows_written', 'detail->period_list', 'detail->>rows_loaded_at',
    ]) {
      expect(APPROVALS_LEDGER_SELECT).toContain(path);
    }
    expect(APPROVALS_LEDGER_SELECT.split(',')).toContain('created_at');
    // Never the whole detail: a success row's detail names every catalogued
    // flow and runs to kilobytes, and the worker's memory is what binds.
    expect(APPROVALS_LEDGER_SELECT.split(',')).not.toContain('detail');
  });
});

describe('the ledger outlives the rows it describes, and is read that way', () => {
  it('sets aside a write none of whose rows survive as it made them', () => {
    const w = windowOf(['2026-07'], '2026-09-22T06:43:17.474Z');
    expect(stillDescribesTheTable(w, '2026-09-22T07:58:01.625Z')).toBe(false);
    expect(stillDescribesTheTable(w, '2026-09-22T06:43:17.474Z')).toBe(true);
  });

  it('judges a row written before stamps were recorded on its own insert time', () => {
    const legacy: CompletedApprovalsWindow = {
      months: ['2026-07'], stamp: null, recordedAt: '2026-09-22T07:58:12.100+00:00',
    };
    expect(stillDescribesTheTable(legacy, '2026-09-22T07:58:01.625Z')).toBe(true);
    expect(stillDescribesTheTable(legacy, '2026-09-22T09:20:03.859Z')).toBe(false);
  });

  it('believes nothing where the table’s oldest stamp cannot be read', () => {
    expect(stillDescribesTheTable(windowOf(['2026-07'], '2026-09-22T07:58:01.625Z'), null)).toBe(false);
    expect(stillDescribesTheTable({ months: ['2026-07'], stamp: null, recordedAt: null }, '2026-09-22T07:58:01.625Z'))
      .toBe(false);
  });

  it('keeps the 22 Sep cleanup’s stale rows out — the case that has already happened', () => {
    /*
     * The timeline production's function log records for 22 Sep 2026. The
     * two runs before `20261215030000` deleted every SA2-flow row still have
     * success rows vouching for 2026-05 → 2026-07; the 07:58 run then read
     * `frontier=none` and rebuilt from 2026-07. Stamps are the runs' log
     * times; insert times are a few seconds later, as they are for any run.
     * The ledger itself is not read here.
     */
    const legacy = (first: string, last: string, at: string, secs: number): CompletedApprovalsWindow => ({
      months: Array.from({ length: monthSpan(first, last) }, (_, i) => shiftMonth(first, i)),
      stamp: null,
      recordedAt: new Date(Date.parse(at) + secs * 1000).toISOString(),
    });
    const completed = [
      legacy('2026-07', '2026-07', '2026-09-22T06:43:17.474Z', 6),
      legacy('2026-05', '2026-07', '2026-09-22T06:48:10.781Z', 11),
      legacy('2026-07', '2026-07', '2026-09-22T07:58:01.625Z', 6),
      legacy('2026-04', '2026-06', '2026-09-22T09:20:03.859Z', 11),
      legacy('2026-01', '2026-03', '2026-09-22T10:20:03.769Z', 11),
      legacy('2025-10', '2025-12', '2026-09-22T11:20:01.705Z', 11),
    ];
    const edge = vouchedOldest({
      frontier: '2026-07',
      tableOldest: '2025-10',
      // The oldest surviving stamp is the 07:58 rebuild's: every row written
      // before the cleanup is gone.
      stalestLoadedAt: '2026-09-22T07:58:01.625Z',
      completed,
    });
    expect(edge).toEqual({ oldest: '2025-10', ledgerOldest: '2025-10', windowsVouching: 4, windowsStale: 2 });
    // And from that edge the walk asks for exactly what it asked for at 12:20.
    const work = planApprovalsWork({
      frontier: '2026-07', oldest: edge.oldest, heldOldest: '2025-10',
      asOf: '2026-09', floor: FLOOR_23, frontierLoadedAt: '2026-09',
    });
    expect([work.kind, work.startPeriod, work.endPeriod]).toEqual(['backfill', '2025-07', '2025-09']);
  });

  it('would have been fooled by those stale rows without the stamp guard', () => {
    // After the cleanup, before the rebuild reached 2026-05: the stale 06:48
    // row vouches for 2026-05 and 2026-06, which the table does not hold whole.
    const stale = windowOf(['2026-05', '2026-06', '2026-07'], '2026-09-22T06:48:10.781Z');
    const rebuilt = windowOf(['2026-07'], '2026-09-22T07:58:01.625Z');
    const guarded = vouchedOldest({
      frontier: '2026-07', tableOldest: '2026-04', stalestLoadedAt: '2026-09-22T07:58:01.625Z',
      completed: [stale, rebuilt],
    });
    expect(guarded.oldest).toBe('2026-07');
    const unguarded = vouchedOldest({
      frontier: '2026-07', tableOldest: '2026-04', stalestLoadedAt: '2026-09-22T06:48:10.781Z',
      completed: [stale, rebuilt],
    });
    expect(unguarded.oldest).toBe('2026-05');
  });

  it('never places the edge below the table’s own oldest month', () => {
    const edge = vouchedOldest({
      frontier: '2026-07', tableOldest: '2026-01', stalestLoadedAt: '2026-09-22T00:00:00Z',
      completed: [windowOf(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
        '2026-04', '2026-05', '2026-06', '2026-07'], '2026-09-22T01:00:00Z')],
    });
    expect(edge.ledgerOldest).toBe('2025-10');
    expect(edge.oldest).toBe('2026-01');
  });

  it('answers nothing on an empty register, whatever the ledger says', () => {
    const edge = vouchedOldest({
      frontier: null, tableOldest: null, stalestLoadedAt: null,
      completed: [windowOf(['2026-07'], '2026-09-22T07:58:01.625Z')],
    });
    expect(edge.oldest).toBeNull();
    expect(edge.ledgerOldest).toBeNull();
  });
});

describe('the walk re-asks what it cannot prove, and never steps past it', () => {
  const at = '2026-09-22T12:00:00Z';
  const plan = (frontier: string, tableOldest: string, completed: CompletedApprovalsWindow[]) => {
    const edge = vouchedOldest({ frontier, tableOldest, stalestLoadedAt: '2026-09-22T00:00:00Z', completed });
    return planApprovalsWork({
      frontier, oldest: edge.oldest, heldOldest: tableOldest,
      asOf: '2026-09', floor: FLOOR_23, frontierLoadedAt: '2026-09',
    });
  };
  const whole = [
    windowOf(['2026-07'], at),
    windowOf(['2026-04', '2026-05', '2026-06'], at),
    windowOf(['2026-01', '2026-02', '2026-03'], at),
  ];

  it('asks for a half-written window AGAIN, where min(period) stepped below it', () => {
    // A run asked for 2025-10 → 2025-12 and died part-way: rows landed for
    // 2025-10, so `min(period)` reads 2025-10, and no success row was written.
    const work = plan('2026-07', '2025-10', whole);
    expect([work.kind, work.startPeriod, work.endPeriod]).toEqual(['backfill', '2025-10', '2025-12']);
    expect(work.because).toMatch(/re-reading the window below the proof/);
    // The rule it replaces stepped straight past the half-written window.
    const old = planApprovalsWork({
      frontier: '2026-07', oldest: '2025-10', asOf: '2026-09', floor: FLOOR_23, frontierLoadedAt: '2026-09',
    });
    expect([old.startPeriod, old.endPeriod]).toEqual(['2025-07', '2025-09']);
  });

  it('re-reads a month missed at the frontier, not only a hole at the bottom', () => {
    // 2026-08 slipped: the release came after the calendar month turned, and
    // the next frontier window (2026-09 → 2026-11) started above it.
    const completed = [...whole, windowOf(['2026-09'], at)];
    const work = plan('2026-09', '2026-01', completed);
    expect([work.kind, work.startPeriod, work.endPeriod]).toEqual(['backfill', '2026-06', '2026-08']);
  });

  it('goes back to the frontier window where nothing proves the frontier whole', () => {
    // The frontier window died part-way through a new month's rows.
    const work = plan('2026-08', '2026-01', whole);
    expect(work.kind).toBe('frontier');
    expect(work.because).toMatch(/no completed write vouches/);
    expect(work.minPeriods).toBeNull();
  });

  it('says nothing about a re-read when the proof and the rows agree', () => {
    const work = plan('2026-07', '2026-01', whole);
    expect([work.startPeriod, work.endPeriod]).toEqual(['2025-10', '2025-12']);
    expect(work.because).not.toMatch(/re-reading/);
  });
});

describe('under failure, the walk still converges on a register with no holes', () => {
  /*
   * A simulated register, publisher and ledger, driven by the real planner
   * and the real proof. Every hour the planner asks for a window; the
   * publisher answers what it has released; a run dies part-way with some
   * probability, leaving rows for some of the window's months and no success
   * row; a release sometimes slips past the calendar month it was due in; and,
   * rarely, the table is emptied the way `20261215030000` emptied it.
   *
   * SAFETY is the property `SUPPLY_EVIDENCE.md` §4 states: whenever the
   * register says it is settled, every month from the floor to the frontier
   * is whole. LIVENESS is that no history leaves it stuck: once failures stop,
   * it settles. Run under the old rule (`oldest = min(period)`) the same
   * simulation breaks safety — which is what shows these tests can see the
   * defect rather than merely failing to find it.
   */
  const mulberry32 = (seed: number) => () => {
    let a = (seed = (seed + 0x6d2b79f5) | 0);
    a = Math.imul(a ^ (a >>> 15), 1 | a);
    a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
  const monthsBetween = (a: string, b: string): string[] =>
    b < a ? [] : Array.from({ length: monthSpan(a, b) }, (_, i) => shiftMonth(a, i));
  const utc = (period: string, monthsLater: number, day: number): number => {
    const [y, m] = period.split('-').map(Number);
    return Date.UTC(y, m - 1 + monthsLater, day);
  };
  const HOUR = 3_600_000;
  const START = Date.parse('2026-09-01T00:20:00Z');

  interface Outcome {
    settledTicks: number;
    holes: string[];
    requests: string[];
    finalSettled: boolean;
    finalHoles: string[];
  }

  const simulate = (seed: number, opts: {
    useProof: boolean; pFail: number; pSlip: number; pClear: number; hours: number; calmFromHour: number;
  }): Outcome => {
    const rand = mulberry32(seed);
    const calmFrom = START + opts.calmFromHour * HOUR;
    const inCalm = (t: number) => t >= calmFrom;

    // Reference month R is normally out on the 5th of R+2; a slipped release
    // lands on the 2nd of R+3. The publisher releases IN ORDER, so a month is
    // out only once every month before it is.
    const refs: string[] = [];
    const outAt: number[] = [];
    for (let r = '2021-01'; r <= '2027-12'; r = shiftMonth(r, 1)) {
      const due = utc(r, 2, 5);
      const slipped = !inCalm(due) && rand() < opts.pSlip;
      refs.push(r);
      outAt.push(Math.max(outAt.length ? outAt[outAt.length - 1] : 0, slipped ? utc(r, 3, 2) : due));
    }
    let pub = -1;
    const publishedAt = (now: number): string => {
      while (pub + 1 < refs.length && outAt[pub + 1] <= now) pub++;
      return pub >= 0 ? refs[pub] : '2020-12';
    };

    // Stamps are appended in time order and a whole re-write resets them,
    // so a month's oldest surviving stamp is always `stamps[0]`.
    const table = new Map<string, { whole: boolean; stamps: number[] }>();
    const ledger: ApprovalsLedgerEntry[] = [];
    const completed: CompletedApprovalsWindow[] = [];
    const out: Outcome = { settledTicks: 0, holes: [], requests: [], finalSettled: false, finalHoles: [] };

    for (let h = 0; h < opts.hours; h++) {
      const now = START + h * HOUR;
      const calm = inCalm(now);
      const asOf = new Date(now).toISOString().slice(0, 7);
      const held = [...table.keys()].sort();
      const frontier = held.length ? held[held.length - 1] : null;
      const tableOldest = held.length ? held[0] : null;
      let stalestMs = Infinity;
      for (const m of table.values()) stalestMs = Math.min(stalestMs, m.stamps[0]);
      const stalest = Number.isFinite(stalestMs) ? new Date(stalestMs).toISOString() : null;
      // The loader reads ONE row of the frontier month, so any of its stamps.
      const fStamps = frontier ? table.get(frontier)!.stamps : [];
      const frontierLoadedAt = fStamps.length
        ? new Date(fStamps[Math.floor(rand() * fStamps.length)]).toISOString().slice(0, 7)
        : null;
      const edge = vouchedOldest({ frontier, tableOldest, stalestLoadedAt: stalest, completed });
      const work = planApprovalsWork({
        frontier,
        oldest: opts.useProof ? edge.oldest : tableOldest,
        heldOldest: tableOldest,
        asOf,
        floor: FLOOR_23,
        frontierLoadedAt,
      });

      const last = h === opts.hours - 1;
      if (work.kind === 'settled') {
        out.settledTicks++;
        const holes = monthsBetween(FLOOR_23, frontier!).filter((m) => !table.get(m)?.whole);
        out.holes.push(...holes.map((m) => `${new Date(now).toISOString()} ${m}`));
        if (last) {
          out.finalSettled = true;
          out.finalHoles = holes;
        }
        continue;
      }
      out.requests.push(`${work.kind} ${work.startPeriod}→${work.endPeriod}`);

      const published = publishedAt(now);
      const answered = monthsBetween(work.startPeriod!, work.endPeriod! < published ? work.endPeriod! : published);
      // The parser refuses an answer with no rows, and a past window that
      // comes back short — so neither writes anything.
      if (answered.length === 0) continue;
      if (work.minPeriods !== null && answered.length < work.minPeriods) continue;

      if (!calm && rand() < opts.pFail) {
        // Died part-way: some months' batches ran, and no success row.
        for (const m of answered) {
          if (rand() < 0.4) continue;
          const prev = table.get(m);
          table.set(m, {
            // A partial re-write replaces some of a whole month's rows; it
            // does not remove the rest.
            whole: prev?.whole ?? false,
            stamps: [...(prev?.stamps ?? []), now],
          });
        }
        continue;
      }
      for (const m of answered) table.set(m, { whole: true, stamps: [now] });
      const row: ApprovalsLedgerEntry = {
        stage: 'approvals',
        area_kind: SA2,
        first: answered[0],
        last: answered[answered.length - 1],
        periods: answered.length,
        rows_written: answered.length * 4_934,
        period_list: answered,
        stamp: new Date(now).toISOString(),
        created_at: new Date(now + 11_000).toISOString(),
      };
      ledger.push(row);
      const w = completedWindowOf(row, SA2);
      if (w) completed.push(w);
      if (!calm && rand() < opts.pClear) table.clear();
    }
    return out;
  };

  const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);
  // Four hostile months, then seven calm weeks, ending on 20 Feb 2027 — well
  // past that month's release, so a settled register is owed at the end.
  const hostile = { pFail: 0.3, pSlip: 0.15, pClear: 0.01, hours: 24 * 172, calmFromHour: 24 * 120 };
  let proofRuns: Outcome[] | null = null;
  const underProof = () => (proofRuns ??= SEEDS.map((seed) => simulate(seed, { useProof: true, ...hostile })));

  it('never settles over a hole, whatever fails and whenever', () => {
    underProof().forEach((run, i) => {
      expect(run.holes, `seed ${SEEDS[i]}`).toEqual([]);
      expect(run.settledTicks, `seed ${SEEDS[i]}`).toBeGreaterThan(0);
    });
  }, 60_000);

  it('is never left stuck: once failures stop, it settles whole', () => {
    underProof().forEach((run, i) => {
      expect(run.finalSettled, `seed ${SEEDS[i]}`).toBe(true);
      expect(run.finalHoles, `seed ${SEEDS[i]}`).toEqual([]);
    });
  }, 60_000);

  it('breaks under the rule it replaces — so the property above is one this test can see fail', () => {
    const broken = SEEDS.filter((seed) => simulate(seed, { useProof: false, ...hostile }).holes.length > 0);
    expect(broken.length).toBeGreaterThan(SEEDS.length / 2);
  }, 60_000);

  it('asks for exactly what the old walk asked for when nothing ever fails', () => {
    const calm = { pFail: 0, pSlip: 0, pClear: 0, hours: 24 * 75, calmFromHour: 0 };
    for (const seed of SEEDS.slice(0, 6)) {
      const proved = simulate(seed, { useProof: true, ...calm });
      const old = simulate(seed, { useProof: false, ...calm });
      expect(proved.requests, `seed ${seed}`).toEqual(old.requests);
      expect(proved.holes).toEqual([]);
      expect(proved.finalSettled).toBe(true);
    }
  }, 60_000);
});

describe('the loader plans from the proof, and writes the proof it reads', () => {
  const src = readFileSync('supabase/functions/market-sales-ingest/index.ts', 'utf8');
  const stage = src.slice(src.indexOf("if (stage === 'approvals') {"), src.indexOf("if (stage === 'vic') {"));
  const beforePlan = stage.slice(0, stage.indexOf('planApprovalsWork({'));
  const plannerCall = stage.slice(stage.indexOf('planApprovalsWork({'), stage.indexOf('})', stage.indexOf('planApprovalsWork({')));
  const successDetail = stage.slice(stage.lastIndexOf('const detail = {'), stage.lastIndexOf('};'));

  it('steps below the PROVEN edge, never min(period) itself', () => {
    expect(plannerCall).toContain('oldest: edge!.oldest');
    expect(plannerCall).toContain('heldOldest: tableOldest');
    // Neither the table's edge by name nor a shorthand `oldest,` property.
    expect(plannerCall).not.toMatch(/^\s*oldest: tableOldest\b|^\s*oldest,/m);
  });

  it('reads the ledger as a projection, for this grain’s approvals rows only', () => {
    expect(beforePlan).toContain(".from('market_sales_sync')");
    expect(beforePlan).toContain('.select(APPROVALS_LEDGER_SELECT)');
    expect(beforePlan).toContain(".eq('detail->>stage', 'approvals')");
    expect(beforePlan).toContain(".eq('detail->>area_kind', choice.areaKind)");
    expect(beforePlan).toContain('completedWindowOf(row, choice.areaKind)');
    expect(beforePlan).toContain('vouchedOldest({ frontier, tableOldest, stalestLoadedAt, completed })');
  });

  it('refuses the run on every read it plans from, rather than reading a failure as empty', () => {
    const reads = [...beforePlan.matchAll(/const \{ data: (\w+)(?:, error: (\w+))? \} = await supabase/g)];
    expect(reads.map((m) => m[1])).toEqual(['frontierRow', 'oldestRow', 'stalestRow', 'ledgerRows']);
    for (const [, data, error] of reads) {
      expect(error, `${data} discards its error`).toBeTruthy();
      expect(beforePlan).toMatch(new RegExp(`if \\(${error}\\) \\{\\s*throw new Error\\(`));
    }
  });

  it('writes every field the proof reads back, under the name the projection selects', () => {
    const keys = [...APPROVALS_LEDGER_SELECT.matchAll(/detail->>?(\w+)/g)].map((m) => m[1]);
    expect(keys).toEqual([
      'stage', 'area_kind', 'first_period', 'latest_period', 'periods', 'rows_written', 'period_list', 'rows_loaded_at',
    ]);
    for (const key of keys) {
      expect(successDetail, `the success row never writes ${key}`).toMatch(new RegExp(`\\b${key}(:|,)`));
    }
    expect(successDetail).toContain('period_list: parsed.periods');
    expect(successDetail).toContain('rows_loaded_at: loadedAt');
  });

  it('records the success row only after the last batch has committed', () => {
    const written = stage.indexOf('await upsertApprovals(');
    const recorded = stage.lastIndexOf(".from('market_sales_sync').insert({ detail })");
    expect(written).toBeGreaterThan(0);
    expect(recorded).toBeGreaterThan(written);
    // And nothing between them can record it early.
    expect(stage.slice(written, recorded)).not.toContain('market_sales_sync');
  });

  it('asks a settled register for no structure it has no query to narrow with', () => {
    expect(stage.indexOf('settled: true')).toBeGreaterThan(0);
    expect(stage.indexOf('absDataStructureUrl(')).toBeGreaterThan(stage.indexOf('settled: true'));
  });
});
