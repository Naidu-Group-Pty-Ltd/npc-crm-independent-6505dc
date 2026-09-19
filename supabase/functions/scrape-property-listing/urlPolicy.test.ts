import { describe, expect, it } from "vitest";
import { normalizePropertyListingUrl } from "./urlPolicy.ts";

describe("normalizePropertyListingUrl", () => {
  it("normalizes supported Australian property listing URLs", () => {
    expect(normalizePropertyListingUrl("www.domain.com.au/listing/123"))
      .toBe("https://www.domain.com.au/listing/123");
    expect(normalizePropertyListingUrl("https://agent.realestate.com.au/property?id=123"))
      .toBe("https://agent.realestate.com.au/property?id=123");
  });

  it("rejects private, metadata, and unrelated targets", () => {
    for (const target of [
      "http://127.0.0.1/admin",
      "https://localhost/admin",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.12/internal",
      "https://example.com/property",
      "https://domain.com.au.evil.example/property",
    ]) {
      expect(() => normalizePropertyListingUrl(target)).toThrow();
    }
  });

  it("rejects non-HTTPS and authority-confusion URLs", () => {
    for (const target of [
      "http://www.domain.com.au/property",
      "https://domain.com.au:8443/property",
      "https://domain.com.au@evil.example/property",
    ]) {
      expect(() => normalizePropertyListingUrl(target)).toThrow();
    }
  });
});
