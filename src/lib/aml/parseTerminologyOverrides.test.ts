import { describe, expect, it } from "vitest";

import { parseTerminologyOverrides } from "./parseTerminologyOverrides";

describe("parseTerminologyOverrides", () => {
  it("keeps string overrides and drops values that React cannot render", () => {
    expect(parseTerminologyOverrides(JSON.stringify({
      "Compliance Home": { x: 1 },
      "Customer Compliance": ["Client Compliance"],
      Register: "Client Register",
    }))).toEqual({ Register: "Client Register" });
  });

  it("distinguishes invalid JSON from valid non-object JSON", () => {
    expect(parseTerminologyOverrides("{")).toBeNull();
    expect(parseTerminologyOverrides("null")).toEqual({});
  });
});
