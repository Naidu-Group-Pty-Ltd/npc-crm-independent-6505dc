/**
 * Paging the supply register.
 *
 * The numbers these rules exist for are production measurements taken by
 * `abs-approvals-liveness` on 21 Sep 2026, not fixtures: at SA2 grain with
 * the query narrowed, 33 months is 111.6 MB, 12 months is 26.0 MB and 6
 * months is 12.2 MB against a 24 MB ceiling.
 */
import { describe, it, expect } from 'vitest';
import {
  APPROVALS_PAGE_MONTHS,
  planApprovalsWork,
  approvalsPage,
  monthSpan,
  pagesToCover,
  shiftMonth,
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
