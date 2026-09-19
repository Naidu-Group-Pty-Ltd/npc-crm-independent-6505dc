import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const functionSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("cached plan entitlement contract", () => {
  it("selects the plan slug returned by the cache fallback", () => {
    expect(functionSource).toContain(
      "plan_name,plan_slug,monthly_allowance",
    );
  });
});
