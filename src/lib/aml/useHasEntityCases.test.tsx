/**
 * Ownership & Control appears when it applies, and whenever we cannot tell.
 *
 * The tab is a question about the tenant's customers rather than about the
 * navigation: beneficial ownership is a company/trust/SMSF concern, and an
 * individual purchaser carries no ownership structure. These pin the three
 * rules that make hiding it safe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const list = vi.fn();
vi.mock("@/lib/aml/amlCasesApi", () => ({ amlCasesApi: { list: (...a: unknown[]) => list(...a) } }));
vi.mock("./amlCasesApi", () => ({ amlCasesApi: { list: (...a: unknown[]) => list(...a) } }));

import { useHasEntityCases, __resetEntityCaseCache } from "./useHasEntityCases";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

beforeEach(() => { __resetEntityCaseCache(); list.mockReset(); });
afterEach(() => { __resetEntityCaseCache(); });

describe("useHasEntityCases", () => {
  it("asks the SERVER for the count, one row over the wire", async () => {
    /* A client cannot answer this from a page of results — the first entity
       case could be the two-hundredth row. */
    list.mockResolvedValue({ cases: [], total: 0 });
    renderHook(() => useHasEntityCases());
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(list).toHaveBeenCalledWith({ subject_type: "not_individual", limit: 1 });
  });

  it("is absent while every customer is an individual", async () => {
    list.mockResolvedValue({ cases: [], total: 0 });
    const { result } = renderHook(() => useHasEntityCases());
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.present).toBe(false);
  });

  it("comes back on its own the moment an entity case exists", async () => {
    list.mockResolvedValue({ cases: [{ id: "c1" }], total: 1 });
    const { result } = renderHook(() => useHasEntityCases());
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.present).toBe(true);
  });

  it("FAILS OPEN — a read that errors shows the tab", async () => {
    /* Hiding a compliance surface because a read failed is the worse of the
       two mistakes, and it is a failure this codebase has shipped once: a
       flag read that returned [] under RLS told every partner a page did not
       exist. */
    list.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useHasEntityCases());
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.present).toBe(true);
  });

  it("asks once per session, not once per page", async () => {
    /* The AML shell mounts on every AML route. A strip that re-queried on
       each of them would be a request per click. */
    list.mockResolvedValue({ cases: [], total: 0 });
    const a = renderHook(() => useHasEntityCases());
    const b = renderHook(() => useHasEntityCases());
    await waitFor(() => expect(a.result.current.settled).toBe(true));
    await waitFor(() => expect(b.result.current.settled).toBe(true));
    renderHook(() => useHasEntityCases());
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("takes no QueryClientProvider dependency", () => {
    /* The shell is mounted by every AML page and by the layout tests; a
       provider requirement here would become a mounting requirement for all
       of them. */
    expect(read("src/lib/aml/useHasEntityCases.ts")).not.toContain("@tanstack/react-query");
  });

  it("says nothing about who may open the page", () => {
    // Visibility is not authority. AmlGuard and the server are unchanged.
    const src = read("src/lib/aml/useHasEntityCases.ts");
    expect(src).not.toMatch(/capability|permission|hasAml/i);
    expect(read("src/App.tsx")).toContain('path="counterparty"');
  });
});

describe("the filter it relies on is allow-listed at the server", () => {
  it("never interpolates the caller's value into the query", () => {
    const fn = read("supabase/functions/aml-cases/index.ts");
    const block = fn.slice(fn.indexOf("case 'list':"), fn.indexOf("case 'get':"));
    expect(block).toContain("body.subject_type === 'not_individual'");
    expect(block).toContain("SUBJECT_TYPES.includes(body.subject_type)");
    // No template literal carrying the value into a filter string.
    expect(block).not.toMatch(/\$\{body\.subject_type\}/);
  });
});
