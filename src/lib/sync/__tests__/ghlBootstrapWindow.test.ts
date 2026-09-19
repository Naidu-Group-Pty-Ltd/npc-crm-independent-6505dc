import { describe, expect, it } from "vitest";
import {
  MAX_TICK_MINUTES,
  bootstrapWindow,
} from "../../../../supabase/functions/_shared/ghlBootstrapWindow.pure";

/*
  THE TRAP THIS MODULE EXISTS TO MAKE IMPOSSIBLE.

  The obvious form of "rotate through the list" is
  `floor(now / period) % ceil(total / size)` — index the windows and step one
  per tick. It strands clients, silently, and nothing reports it because a
  window that is never visited raises no error.

  Both wrong forms are EXECUTED below rather than described, because the whole
  point is that the defect is invisible to reading. The second one is the one
  this module itself shipped for an hour: it inferred its step from the gap
  between ticks, and an inferred step amplifies across absolute time.
*/

const MINUTE = 60_000;

/**
 * Wrong form #1 — a period somebody typed.
 *
 * A developer writes `10` because `20260403080424_704c3458….sql` schedules the
 * job every ten minutes. The stranding appears the moment the cron is edited
 * and that constant is not.
 */
const ASSUMED_PERIOD_MINUTES = 10;

function naiveOffset(nowMs: number, total: number, size: number): number {
  const windows = Math.max(1, Math.ceil(total / size));
  const index = Math.floor(nowMs / (ASSUMED_PERIOD_MINUTES * MINUTE)) % windows;
  return index * size;
}

/**
 * Wrong form #2 — a step inferred from the measured gap.
 *
 * Correct while the measurement is correct, and catastrophic when it is not,
 * because `nowMs * stepPerMinute` multiplies the error by the whole epoch.
 */
function inferredStepOffset(nowMs: number, total: number, size: number, measuredMinutes: number): number {
  const tick = Math.min(size, Math.max(1, Math.round(measuredMinutes)));
  const stepPerMinute = Math.max(1, Math.floor(size / tick));
  return (((Math.floor(nowMs / MINUTE) * stepPerMinute) % total) + total) % total;
}

/** Every position a sequence of ticks actually asks GHL about. */
function coverage(
  offsets: readonly number[],
  total: number,
  size: number,
): Set<number> {
  const seen = new Set<number>();
  for (const offset of offsets) {
    for (let i = 0; i < Math.min(size, total); i++) seen.add((offset + i) % total);
  }
  return seen;
}

function sweep(total: number, size: number, gapMinutes: number, ticks: number): Set<number> {
  const offsets: number[] = [];
  for (let t = 0; t < ticks; t++) {
    offsets.push(
      bootstrapWindow({
        total,
        size,
        nowMs: t * gapMinutes * MINUTE,
        observedTickMinutes: gapMinutes,
      }).offset,
    );
  }
  return coverage(offsets, total, size);
}

describe("the forms this replaces really do strand clients", () => {
  it("a typed period against a cron that moved visits four windows of six", () => {
    /*
      6 windows of 50 over 300 clients. The code assumes ten minutes; the cron
      fires every fifteen. The index advances by 1.5 a tick, so it lands on
      0, 1, 3, 4 for ever — a hundred clients no sweep will ever ask about.
    */
    const seen = new Set<number>();
    for (let t = 0; t < 500; t++) seen.add(naiveOffset(t * 15 * MINUTE, 300, 50) / 50);
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 3, 4]);
  });

  it("and two of six against a half-hourly one", () => {
    const seen = new Set<number>();
    for (let t = 0; t < 500; t++) seen.add(naiveOffset(t * 30 * MINUTE, 300, 50) / 50);
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 3]);
  });

  it("an inferred step strands a third of the list when the measurement is wrong", () => {
    // Measured at 2 minutes; the job really fires every 15. The offset then
    // jumps 7.5 windows a tick.
    const offsets: number[] = [];
    for (let t = 0; t < 3000; t++) offsets.push(inferredStepOffset(t * 15 * MINUTE, 300, 50, 2));
    expect(coverage(offsets, 300, 50).size).toBe(200);
  });
});

describe("bootstrapWindow", () => {
  it("covers every client at the cadence the cron actually runs", () => {
    expect(sweep(437, 150, 10, 600).size).toBe(437);
  });

  it.each([1, 2, 3, 5, 7, 10, 11, 13, 15, 17, 20, 25, MAX_TICK_MINUTES])(
    "covers every client at a %i-minute cadence",
    (gap) => {
      // Every gap up to the declared ceiling, which is the guarantee.
      expect(sweep(437, 150, gap, 4000).size).toBe(437);
    },
  );

  it("covers every client whatever the list length", () => {
    for (const total of [1, 2, 149, 150, 151, 300, 437, 999, 1024]) {
      expect(sweep(total, 150, 10, 4000).size).toBe(total);
    }
  });

  it("covers every client even when the cadence is MISMEASURED", () => {
    /*
      The regression this module was rewritten for. The observed figure does
      not enter the offset at all, so being wrong by a factor of six in either
      direction changes nothing about what gets swept.
    */
    for (const measured of [0, 1, 2, 90, 100_000]) {
      const offsets: number[] = [];
      for (let t = 0; t < 4000; t++) {
        offsets.push(
          bootstrapWindow({
            total: 300, size: 150, nowMs: t * 15 * MINUTE, observedTickMinutes: measured,
          }).offset,
        );
      }
      expect(coverage(offsets, 300, 150).size).toBe(300);
    }
  });

  it("and when no cadence is supplied at all", () => {
    const offsets: number[] = [];
    for (let t = 0; t < 4000; t++) {
      offsets.push(bootstrapWindow({ total: 300, size: 150, nowMs: t * 10 * MINUTE }).offset);
    }
    expect(coverage(offsets, 300, 150).size).toBe(300);
  });

  it("never advances by more than one window width over the declared ceiling", () => {
    /*
      This is the guarantee, checked as arithmetic rather than by sampling.
      Consecutive windows then abut or overlap, so their union is the whole
      list — which is what makes the coverage above unconditional rather than
      lucky.
    */
    for (const size of [1, 7, 29, 30, 31, 50, 150, 1000]) {
      const w = bootstrapWindow({ total: 1000, size, nowMs: 0 });
      expect(w.maxAdvancePerTick).toBeLessThanOrEqual(w.size);
      expect(w.advancePerMinute * MAX_TICK_MINUTES).toBeLessThanOrEqual(Math.max(size, MAX_TICK_MINUTES));
    }
  });

  it("says when the job is firing further apart than it was built for", () => {
    // A reading, not a lever: the offset is identical either side of it.
    const inside = bootstrapWindow({ total: 300, size: 150, nowMs: 999 * MINUTE, observedTickMinutes: 10 });
    const outside = bootstrapWindow({ total: 300, size: 150, nowMs: 999 * MINUTE, observedTickMinutes: 240 });
    expect(inside.cadenceExceeded).toBe(false);
    expect(outside.cadenceExceeded).toBe(true);
    expect(outside.offset).toBe(inside.offset);
  });

  it("keeps the offset inside the list for a clock before the epoch", () => {
    // A negative `nowMs` is what a skewed clock or a test supplies, and `%`
    // in JavaScript keeps the sign of the dividend.
    const w = bootstrapWindow({ total: 250, size: 50, nowMs: -1_000 * MINUTE });
    expect(w.offset).toBeGreaterThanOrEqual(0);
    expect(w.offset).toBeLessThan(250);
  });

  it("reports an empty list rather than dividing by zero", () => {
    const w = bootstrapWindow({ total: 0, size: 150, nowMs: 1 });
    expect(w).toMatchObject({ offset: 0, total: 0, latticeSpacing: 0 });
  });

  it("floors a fractional total and never reports a negative one", () => {
    expect(bootstrapWindow({ total: -12, size: 10, nowMs: 0 }).total).toBe(0);
    expect(bootstrapWindow({ total: 12.9, size: 10, nowMs: 0 }).total).toBe(12);
  });

  it("still moves when the list is smaller than one window", () => {
    // 40 clients, a 150-wide window: one tick already covers everyone, and the
    // offset must not become meaningless or throw.
    const w = bootstrapWindow({ total: 40, size: 150, nowMs: 77 * MINUTE });
    expect(w.offset).toBeGreaterThanOrEqual(0);
    expect(w.offset).toBeLessThan(40);
    expect(Math.min(w.size, w.total)).toBe(40);
  });
});
