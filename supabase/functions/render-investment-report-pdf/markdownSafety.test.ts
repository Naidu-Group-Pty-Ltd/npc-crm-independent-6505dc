import { describe, expect, it } from "vitest";
import { escapeRawHtmlInMarkdown, removeUnsafeRenderedUrls } from "./markdownSafety";

describe("investment report Markdown safety", () => {
  it("renders raw HTML as text instead of executable markup", () => {
    expect(escapeRawHtmlInMarkdown('<script>steal()</script><img src=x onerror="steal()">'))
      .toBe("&lt;script&gt;steal()&lt;/script&gt;&lt;img src=x onerror=\"steal()\"&gt;");
  });

  it("removes scriptable and entity-obfuscated Markdown destinations", () => {
    const html = '<a href="java&#x73;cript:steal()">bad</a><img src="data:text/html,boom"><a href="https://example.com">good</a>';
    expect(removeUnsafeRenderedUrls(html)).toBe('<a>bad</a><img><a href="https://example.com">good</a>');
  });

  it("preserves safe report image and navigation destinations", () => {
    const html = '<img src="data:image/svg+xml,%3Csvg%3E"><a href="#chapter-1">Chapter</a><a href="sources/report.pdf">Sources</a><a href="mailto:advisor@example.com">Email</a>';
    expect(removeUnsafeRenderedUrls(html)).toBe(html);
  });
});
