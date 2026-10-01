/**
 * The independent CRM line carries none of GoHighLevel, held to this tree.
 *
 * Aurixa Mission Control withholds the GoHighLevel integration from this line
 * by class (`crmLineFeatures.pure.ts` there). Three copies of the list live
 * here, because neither repository can read the other's source and the
 * browser cannot import a script: `scripts/lib/crmLineFeatures.mjs` (read by
 * the CI gates), `WITHHELD_CRM_FUNCTIONS` in the router (read by
 * `invokeSecureFunction`), and this spec, which holds the first two to each
 * other and to what is actually on disk.
 *
 * A function that reappears here is a cascade that wrote a withheld path, and
 * it would deploy beside a native CRM the router no longer routes to it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CRM_LINE_WITHHELD_FILES,
  CRM_LINE_WITHHELD_FUNCTIONS,
} from "../../../../scripts/lib/crmLineFeatures.mjs";
import {
  CRM_FUNCTION_NOT_CARRIED,
  WITHHELD_CRM_FUNCTIONS,
  crmFunction,
  withheldCrmFunctionRefusal,
} from "../crmProvider";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("the two copies of the list agree", () => {
  it("names the same functions in the script and the router", () => {
    expect([...WITHHELD_CRM_FUNCTIONS].sort()).toEqual([...CRM_LINE_WITHHELD_FUNCTIONS].sort());
  });

  it("names each function once", () => {
    expect(new Set(CRM_LINE_WITHHELD_FUNCTIONS).size).toBe(CRM_LINE_WITHHELD_FUNCTIONS.length);
  });
});

describe("the tree carries none of it", () => {
  it.each([...CRM_LINE_WITHHELD_FUNCTIONS])("%s has no function directory", (name) => {
    expect(existsSync(join(ROOT, "supabase", "functions", name))).toBe(false);
  });

  it.each([...CRM_LINE_WITHHELD_FILES])("%s is absent", (file) => {
    expect(existsSync(join(ROOT, file))).toBe(false);
  });

  it("declares no gateway setting for a function it does not carry", () => {
    // A `[functions.X]` block for an absent function is a claim about a
    // deployment that has nothing behind it.
    const toml = readFileSync(join(ROOT, "supabase", "config.toml"), "utf8");
    for (const name of CRM_LINE_WITHHELD_FUNCTIONS) {
      expect(toml.includes(`[functions.${name}]`), name).toBe(false);
    }
  });

  it("registers no security policy for a function it does not carry", () => {
    const registry = JSON.parse(
      readFileSync(join(ROOT, "supabase", "functions-registry", "SECURITY_REGISTRY.json"), "utf8"),
    ) as { functions: Record<string, unknown> };
    for (const name of CRM_LINE_WITHHELD_FUNCTIONS) {
      expect(Object.prototype.hasOwnProperty.call(registry.functions, name), name).toBe(false);
    }
  });

  it("keeps the native CRM functions this line IS", () => {
    for (const name of ["crm-calendar", "crm-inbound-message", "crm-send-message"]) {
      expect(existsSync(join(ROOT, "supabase", "functions", name, "index.ts")), name).toBe(true);
    }
  });
});

describe("a browser call to a withheld function never leaves the browser", () => {
  it.each([...CRM_LINE_WITHHELD_FUNCTIONS])("%s is refused locally, not retryably", (name) => {
    // A request would answer 404 from a gateway that has never heard of the
    // function; the refusal says what is actually true, and says it once.
    const refusal = withheldCrmFunctionRefusal(name);
    expect(refusal?.code).toBe(CRM_FUNCTION_NOT_CARRIED);
    expect(refusal?.retryable).toBe(false);
  });

  it("refuses nothing this line carries", () => {
    expect(withheldCrmFunctionRefusal("crm-send-message")).toBeNull();
    expect(withheldCrmFunctionRefusal("manage-client-data")).toBeNull();
  });

  it("routes every CRM capability to the native function", () => {
    expect(crmFunction("calendar")).toBe("crm-calendar");
    expect(crmFunction("sendMessage")).toBe("crm-send-message");
  });
});
