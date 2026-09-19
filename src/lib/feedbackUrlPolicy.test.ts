import { describe, expect, it } from "vitest";
import { validateFeedbackUrl as validateBrowserFeedbackUrl } from "./feedbackUrlPolicy";
import {
  validateFeedbackUrl as validateEdgeFeedbackUrl,
} from "../../supabase/functions/_shared/feedbackUrlPolicy";

describe.each([
  ["browser", validateBrowserFeedbackUrl],
  ["edge", validateEdgeFeedbackUrl],
])("%s feedback URL policy", (_boundary, validateFeedbackUrl) => {
  it("accepts HTTPS handoffs on the Aurixa marketing host", () => {
    expect(validateFeedbackUrl("https://aurixasystems.com.au/feedback?handoff=abc#form")).toBe(
      "https://aurixasystems.com.au/feedback?handoff=abc#form",
    );
  });

  it.each([
    "https://evil.example/feedback",
    "http://aurixasystems.com.au/feedback",
    "https://aurixasystems.com.au.evil.example/feedback",
    "https://aurixasystems.com.au:8443/feedback",
    "https://user:password@aurixasystems.com.au/feedback",
    "javascript:alert(document.domain)",
    "data:text/html,<h1>Fake feedback form</h1>",
    "/feedback",
    "not a URL",
  ])("rejects an untrusted destination: %s", (value) => {
    expect(validateFeedbackUrl(value)).toBeNull();
  });

  it("rejects non-string values", () => {
    expect(validateFeedbackUrl(null)).toBeNull();
  });
});
