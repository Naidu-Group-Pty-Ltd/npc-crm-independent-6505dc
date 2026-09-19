import { describe, expect, it } from "vitest";
import {
  MAX_SCAN_PAGES,
  SCAN_PAGE,
  pageAll,
} from "../../../../supabase/functions/_shared/postgrestPaging.pure";

/*
  PostgREST answers at most `max_rows` and says NOTHING about having truncated:
  a 200 with a short array is indistinguishable from a table that really holds
  that many. Two reads in the GoHighLevel import treated such an answer as a
  COMPLETE set, and each fails in its own direction — see the module header.
*/

/** A table of `total` rows, served the way PostgREST serves one. */
const table = (total: number) => {
  const calls: Array<[number, number]> = [];
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    const rows: Array<{ n: number }> = [];
    for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ n: i });
    return Promise.resolve({ data: rows, error: null });
  };
  return { page, calls };
};

describe("pageAll", () => {
  it("returns a short set in one request", async () => {
    const t = table(12);
    const got = await pageAll(t.page);
    expect(got.rows).toHaveLength(12);
    expect(got.truncated).toBe(false);
    expect(t.calls).toHaveLength(1);
  });

  it("reads past max_rows", async () => {
    const t = table(SCAN_PAGE * 2 + 7);
    const got = await pageAll(t.page);
    expect(got.rows).toHaveLength(SCAN_PAGE * 2 + 7);
    expect(got.truncated).toBe(false);
    expect(t.calls).toHaveLength(3);
    expect(t.calls[1]).toEqual([SCAN_PAGE, SCAN_PAGE * 2 - 1]);
  });

  it("asks one more time when the set ends exactly on a page boundary", async () => {
    // A full page is not evidence of the end; only a short one is.
    const t = table(SCAN_PAGE);
    const got = await pageAll(t.page);
    expect(got.rows).toHaveLength(SCAN_PAGE);
    expect(got.truncated).toBe(false);
    expect(t.calls).toHaveLength(2);
  });

  it("reports the ceiling rather than pretending the set ended", async () => {
    const t = table(SCAN_PAGE * MAX_SCAN_PAGES + 1);
    const got = await pageAll(t.page);
    expect(got.truncated).toBe(true);
    expect(got.rows).toHaveLength(SCAN_PAGE * MAX_SCAN_PAGES);
    expect(got.failed).toBeNull();
  });

  it("honours a caller's own, tighter ceiling", async () => {
    const t = table(SCAN_PAGE * 5);
    const got = await pageAll(t.page, 2);
    expect(got.truncated).toBe(true);
    expect(t.calls).toHaveLength(2);
  });

  it("a read that FAILED is not a set that is EMPTY", async () => {
    /*
      The rule `CaseRead` exists for. Every caller here would otherwise take the
      empty array as a fact about the table — and handing an empty held-message
      set to the conversation pager is exactly the state that re-downloads the
      whole thread.
    */
    let n = 0;
    const got = await pageAll<{ n: number }>((from, to) => {
      n++;
      if (n === 2) return Promise.resolve({ data: null, error: { message: "42703 boom" } });
      const rows: Array<{ n: number }> = [];
      for (let i = from; i <= to; i++) rows.push({ n: i });
      return Promise.resolve({ data: rows, error: null });
    });
    expect(got.failed).toBe("42703 boom");
    expect(got.truncated).toBe(false);
    // What arrived before the fault is still carried, so a caller can say how
    // far it got — but `failed` is what it must act on.
    expect(got.rows).toHaveLength(SCAN_PAGE);
  });

  it("treats a null data with no error as an empty page, not a crash", async () => {
    const got = await pageAll(() => Promise.resolve({ data: null, error: null }));
    expect(got.rows).toEqual([]);
    expect(got.failed).toBeNull();
    expect(got.truncated).toBe(false);
  });
});
