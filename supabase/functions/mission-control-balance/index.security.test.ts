import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const functionSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

/**
 * The cache row's selected columns, read as a set. The first form of this
 * contract matched a literal slice of the column list, so adding `addon_slugs`
 * beside the plan slug failed it while the slug was still selected.
 */
function cachedColumns(): Set<string> {
  const read = functionSource.indexOf('.from("token_balance_cache")');
  expect(read).toBeGreaterThan(-1);
  const list = functionSource.slice(read).match(/\.select\(\s*"([^"]+)"/)?.[1] ?? "";
  return new Set(list.split(",").map((column) => column.trim()));
}

describe("cached plan entitlement contract", () => {
  it("selects the plan slug returned by the cache fallback", () => {
    const columns = cachedColumns();
    expect(columns.has("plan_name")).toBe(true);
    expect(columns.has("plan_slug")).toBe(true);
    expect(columns.has("monthly_allowance")).toBe(true);
    expect(functionSource).toContain("planSlug: data.plan_slug ?? null");
  });

  it("carries the add-ons with the plan, so a cache hit gates the same modules", () => {
    expect(cachedColumns().has("addon_slugs")).toBe(true);
    expect(functionSource).toContain("addonSlugs: Array.isArray(data.addon_slugs) ? data.addon_slugs : undefined");
  });

  it("never lets a cached answer grant a billing exemption", () => {
    const fallback = functionSource.slice(functionSource.indexOf("async function readCachedBalance("));
    expect(fallback).toContain("exempt: false");
  });
});
