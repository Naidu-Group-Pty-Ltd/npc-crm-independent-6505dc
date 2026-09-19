/**
 * Treat stored report Markdown as text before trusted renderer shortcodes add
 * their own HTML. Marked deliberately passes raw HTML through unchanged.
 */
export function escapeRawHtmlInMarkdown(markdown: string): string {
  return markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeUrlEntities(value: string): string {
  const codePoint = (raw: string, radix: number): string => {
    const parsed = parseInt(raw, radix);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 0x10ffff
      ? String.fromCodePoint(parsed)
      : "";
  };
  return value
    .replace(/&#(\d+);?/g, (_match, decimal) => codePoint(decimal, 10))
    .replace(/&#x([\da-f]+);?/gi, (_match, hex) => codePoint(hex, 16))
    .replace(/&colon;?/gi, ":")
    .replace(/&tab;?/gi, "\t")
    .replace(/&newline;?/gi, "\n")
    .replace(/&amp;?/gi, "&");
}

function isSafeRenderedUrl(attribute: string, value: string): boolean {
  const normalized = decodeUrlEntities(value).replace(/[\u0000-\u0020\u007f]+/g, "").toLowerCase();
  if (normalized === "" || (!normalized.includes(":") && !normalized.startsWith("//"))) return true;
  if (normalized.startsWith("#") || normalized.startsWith("/") || normalized.startsWith("./") || normalized.startsWith("../")) return true;
  if (/^https?:/.test(normalized)) return true;
  if (attribute === "href" && /^mailto:/.test(normalized)) return true;
  return attribute === "src" && /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,]/.test(normalized);
}

/** Remove active URL schemes that can be produced by Markdown links/images. */
export function removeUnsafeRenderedUrls(html: string): string {
  return html.replace(/\s(href|src)\s*=\s*(["'])([\s\S]*?)\2/gi, (match, attribute, _quote, value) =>
    isSafeRenderedUrl(String(attribute).toLowerCase(), String(value)) ? match : ""
  );
}
