import { describe, expect, it } from "vitest";
import {
  mapWithConcurrency,
  valuesOf,
} from "../../../../supabase/functions/_shared/boundedConcurrency.pure";

/*
  THE LOOPS THIS REPLACES WERE SEQUENTIAL, AND SEVERAL SLEPT BETWEEN ITEMS.

  Measured on the clone (npc-client-dashboard, 2026-09-13):
  `sync-ghl-conversations` averaged 78.5s and peaked at 98.4s against a 120s
  declared timeout, because it paced itself with `delay(500)` per contact,
  `delay(300)` per conversation and `delay(300)` per message page — strictly
  one after another.

  The three properties asserted here are the ones the replaced loops already
  had and must not lose: order, per-item failure isolation, and a budget that
  drains rather than truncates.
*/

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  it("returns results in INPUT order however they finish", async () => {
    // Deliberately inverted: the last item resolves first.
    const items = [30, 20, 10, 0];
    const out = await mapWithConcurrency(items, 4, async (ms) => {
      await tick(ms);
      return ms;
    });
    expect(out.results.map((r) => r.value)).toEqual([30, 20, 10, 0]);
    expect(out.results.map((r) => r.index)).toEqual([0, 1, 2, 3]);
  });

  it("never runs more than `limit` at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 25 }, (_, i) => i);
    await mapWithConcurrency(items, 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick(5);
      inFlight -= 1;
      return null;
    });
    expect(peak).toBe(4);
    expect(inFlight).toBe(0);
  });

  it("actually overlaps — 8 items of 40ms at width 4 take about two rounds", async () => {
    const started = Date.now();
    await mapWithConcurrency(
      Array.from({ length: 8 }, (_, i) => i),
      4,
      async () => {
        await tick(40);
        return null;
      },
    );
    const elapsed = Date.now() - started;
    // Sequential would be ~320ms. Two rounds of 40ms is ~80ms; allow slack for
    // a loaded CI box but stay far below the sequential figure, because THAT
    // is the regression this guards.
    expect(elapsed).toBeLessThan(220);
  });

  it("confines a failure to its own item and keeps every sibling's work", async () => {
    // Promise.all would have discarded all five. The loops this replaces
    // wrapped their body in try/catch and pushed onto an `errors` array, and
    // that behaviour is the contract.
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 3, async (n) => {
      if (n === 3) throw new Error("contact 3 exploded");
      return n * 10;
    });
    expect(out.succeeded).toBe(4);
    expect(out.failed).toBe(1);
    expect(out.results[2].error).toBe("contact 3 exploded");
    expect(out.results[2].value).toBeUndefined();
    expect(valuesOf(out)).toEqual([10, 20, 40, 50]);
  });

  it("flattens a non-Error throw rather than losing it", async () => {
    const out = await mapWithConcurrency([1], 1, async () => {
      throw "a bare string";
    });
    expect(out.results[0].error).toBe("a bare string");
  });

  it("stops starting new work when the budget says so, and drains what is running", async () => {
    let done = 0;
    let stop = false;
    const out = await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      2,
      async (i) => {
        if (i >= 3) stop = true; // trip it partway through
        await tick(5);
        done += 1;
        return i;
      },
      { stop: () => stop },
    );
    // Everything started finished — nothing was cancelled mid-flight, because
    // these tasks write to the database and a half-written item is worse than
    // a late one.
    expect(done).toBe(out.startedCount);
    expect(out.startedCount).toBeLessThan(20);
    expect(out.startedCount).toBeGreaterThanOrEqual(4);
    // Unstarted items carry neither a value nor an error: they are not
    // failures, they are work the next invocation picks up.
    const unstarted = out.results.filter(
      (r) => r.value === undefined && r.error === undefined,
    );
    expect(unstarted.length).toBe(20 - out.startedCount);
  });

  it("finishes work already in flight when the budget trips from OUTSIDE the task", async () => {
    // The previous version of this test flipped `stop` from inside the task
    // body, which meant the flag was always false at the moment a task was
    // about to start — so a mutation that abandoned started work passed it.
    // The real risk is a wall-clock budget expiring while requests are in the
    // air: these tasks write to the database, and dropping one mid-flight
    // leaves a conversation row with no messages and nothing saying it is
    // short. Trip the flag on a timer instead, so it flips while work is
    // genuinely running.
    let stop = false;
    const timer = setTimeout(() => {
      stop = true;
    }, 12);
    const entered: number[] = [];
    const completed: number[] = [];

    const out = await mapWithConcurrency(
      Array.from({ length: 40 }, (_, i) => i),
      4,
      async (i) => {
        entered.push(i);
        await tick(8);
        completed.push(i);
        return i;
      },
      { stop: () => stop },
    );
    clearTimeout(timer);

    // Every task that began also finished, and every one of them is reported
    // with a value — none was silently dropped.
    expect(completed.sort((a, b) => a - b)).toEqual(
      entered.sort((a, b) => a - b),
    );
    expect(entered.length).toBe(out.startedCount);
    expect(out.succeeded).toBe(out.startedCount);
    expect(out.failed).toBe(0);
    // And it really did stop early, or the test proves nothing.
    expect(out.startedCount).toBeLessThan(40);
  });

  it("reports startedCount so a resumable caller can advance its cursor", async () => {
    let stop = false;
    const out = await mapWithConcurrency(
      [0, 1, 2, 3, 4],
      1,
      async (i) => {
        if (i === 2) stop = true;
        return i;
      },
      { stop: () => stop },
    );
    // Width 1 means tasks start in order, so the count is exactly the prefix
    // that ran: 0, 1, 2 started; 2 tripped the flag; 3 and 4 never began.
    expect(out.startedCount).toBe(3);
  });

  it("starts nothing when the budget is already spent", async () => {
    let calls = 0;
    const out = await mapWithConcurrency(
      [1, 2, 3],
      4,
      async () => {
        calls += 1;
        return 1;
      },
      { stop: () => true },
    );
    expect(calls).toBe(0);
    expect(out.startedCount).toBe(0);
    expect(out.results).toHaveLength(3);
  });

  it("handles an empty list and a nonsense width without hanging", async () => {
    const empty = await mapWithConcurrency([], 8, async () => 1);
    expect(empty.results).toEqual([]);
    expect(empty.startedCount).toBe(0);

    for (const width of [0, -5, NaN, 0.4]) {
      const out = await mapWithConcurrency([1, 2], width, async (n) => n);
      expect(out.succeeded).toBe(2);
      expect(valuesOf(out)).toEqual([1, 2]);
    }
  });

  it("gives each item its own index exactly once", async () => {
    const seen: number[] = [];
    await mapWithConcurrency(
      Array.from({ length: 50 }, (_, i) => i),
      7,
      async (item, index) => {
        expect(item).toBe(index);
        seen.push(index);
        await tick(1);
        return index;
      },
    );
    expect(seen.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i),
    );
  });
});
