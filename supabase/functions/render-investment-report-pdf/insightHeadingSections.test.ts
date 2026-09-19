import { describe, expect, it } from "vitest";
import { wrapInsightHeadingSections } from "./insightHeadingSections.ts";

const wrap = (html: string) => wrapInsightHeadingSections(
  html,
  (label) => /^(what this means|takeaway)$/i.test(label),
  (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
);

describe("wrapInsightHeadingSections", () => {
  it("wraps a recognized heading through the next section boundary", () => {
    expect(wrap("<h3>What This Means:</h3><p>Useful context.</p><h2>Next</h2>"))
      .toBe('<div class="insight-box"><div class="insight-label">What This Means</div><p>Useful context.</p></div><h2>Next</h2>');
  });

  it("leaves ordinary and malformed headings unchanged", () => {
    const html = "<h3>Overview</h3><p>Body</p><h3><h3><h3>";
    expect(wrap(html)).toBe(html);
  });

  it("processes many unterminated headings within a tight CPU budget", () => {
    const html = "<h3>unterminated ".repeat(60_000);
    const started = performance.now();
    expect(wrap(html)).toBe(html);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
