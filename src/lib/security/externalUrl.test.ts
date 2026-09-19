import { describe, expect, it } from "vitest";
import { normalizeExternalUrl } from "./externalUrl";

describe("normalizeExternalUrl", () => {
  it.each([
    "javascript:alert(document.domain)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//attacker.example/evidence",
    "/relative/evidence",
    "not a URL",
  ])("rejects unsafe or non-absolute URL %s", (value) => {
    expect(normalizeExternalUrl(value)).toBeNull();
  });

  it("canonicalizes absolute HTTP(S) URLs", () => {
    expect(normalizeExternalUrl("  HTTPS://Example.COM/evidence?q=1  ")).toBe(
      "https://example.com/evidence?q=1",
    );
    expect(normalizeExternalUrl("http://example.com")).toBe("http://example.com/");
  });

  it("treats an empty optional value as absent", () => {
    expect(normalizeExternalUrl("   ")).toBeNull();
    expect(normalizeExternalUrl(null)).toBeNull();
  });
});
