import { describe, expect, it } from "vitest";
import {
  getCounterpartyRequestScope,
  hasAmlInvestigateCapability,
} from "../../../supabase/functions/_shared/amlTransactionsAuth";

describe("AML transactions authorization", () => {
  it("rejects callers without aml.investigate, including read-only auditors", () => {
    expect(hasAmlInvestigateCapability(false, false)).toBe(false);
    expect(hasAmlInvestigateCapability(true, false)).toBe(true);
  });

  it("preserves the superadmin capability bypass", () => {
    expect(hasAmlInvestigateCapability(false, true)).toBe(true);
  });

  it("requires list_cp_requests to be scoped to a case object", () => {
    expect(getCounterpartyRequestScope({})).toBeNull();
    expect(getCounterpartyRequestScope({ counterparty_case_id: "cp-case-1" })).toEqual({
      column: "counterparty_case_id",
      value: "cp-case-1",
    });
    expect(getCounterpartyRequestScope({ case_id: "case-1" })).toEqual({
      column: "case_id",
      value: "case-1",
    });
  });
});
