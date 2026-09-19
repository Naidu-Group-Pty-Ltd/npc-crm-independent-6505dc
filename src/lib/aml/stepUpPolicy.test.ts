import { describe, expect, it } from "vitest";
import { canUseAmlCapability } from "../../../supabase/functions/aml-step-up/policy";

describe("AML step-up capability policy", () => {
  it("does not let non-MLRO roles mint report or configuration grants", () => {
    for (const role of ["analyst", "reviewer", "auditor"]) {
      expect(canUseAmlCapability([role], "aml.report")).toBe(false);
      expect(canUseAmlCapability([role], "aml.configure")).toBe(false);
    }
  });

  it("preserves the documented role mapping and superadmin bypass", () => {
    expect(canUseAmlCapability(["auditor"], "aml.view")).toBe(true);
    expect(canUseAmlCapability(["analyst"], "aml.investigate")).toBe(true);
    expect(canUseAmlCapability(["mlro"], "aml.report")).toBe(true);
    expect(canUseAmlCapability([], "aml.configure", true)).toBe(true);
    expect(canUseAmlCapability([], "unknown", true)).toBe(false);
  });
});
