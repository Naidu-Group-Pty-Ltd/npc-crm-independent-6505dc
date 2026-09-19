import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeAustralianBusinessNumber } from "./billingIdentity.ts";

Deno.test("normalizes a checksum-valid ABN", () => {
  assertEquals(normalizeAustralianBusinessNumber("51 824 753 556"), "51824753556");
});

Deno.test("rejects malformed and checksum-invalid ABNs", () => {
  assertEquals(normalizeAustralianBusinessNumber("not-an-abn"), null);
  assertEquals(normalizeAustralianBusinessNumber("51 824 753 557"), null);
  assertEquals(normalizeAustralianBusinessNumber(null), null);
});
