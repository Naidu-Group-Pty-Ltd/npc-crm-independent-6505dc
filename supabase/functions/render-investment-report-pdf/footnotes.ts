/**
 * Footnote definitions, on their way into the `@footnote` area.
 *
 * Extracted from `index.ts` for the same reason as `markdownSafety.ts`: what
 * happens here is not obvious, it is worth a test, and getting it wrong takes
 * the whole document out rather than one line of it.
 *
 * ## Why a footnote body must not carry a newline
 *
 * A footnote is *moved*. `span.footnote { float: footnote }` lifts it out of the
 * text and into the page's footnote area, and WeasyPrint 69 lays that text out
 * without collapsing the newlines Markdown left in it. A body carrying a space
 * immediately before a newline therefore arrives at `split_text_box` as a line
 * break the engine refuses, and the render dies with
 *
 *     render_failed: Got ' \n' between two lines.
 *                    Expected nothing or a preserved line break
 *
 * Nothing in the report's stylesheet is preserved-whitespace, which is why this
 * reads as impossible and took a bisected render to find: the newline survives
 * because the box is relocated, not because anything asked for `pre`.
 *
 * The generator writes every definition ending its line with a trailing space,
 * so this was not an edge case — it was *every* report with a footnote. On
 * 15 Aug 2026 the two production reports carrying footnotes (11 definitions
 * each) returned 500 on every attempt, and the three without one rendered
 * normally on the same deployment, minutes apart.
 *
 * Collapsing is what `white-space: normal` would have drawn anyway, so the note
 * reads exactly as intended; it simply no longer carries a break into the engine.
 *
 * ## Why the definitions have to be split apart
 *
 * They arrive as ONE paragraph. The generator writes them one per line and
 * Markdown joins consecutive lines, so a paragraph that opens with a definition
 * normally carries every other definition after it. Matching only the leading
 * marker put the other ten bodies inside the first note's text and left their
 * calls resolving to nothing — and an unresolved call is *dropped*, so ten of
 * eleven sources silently left the document.
 */

/** One flowing line: no newline may reach the footnote area. */
export function footnoteText(body: unknown): string {
  return String(body).replace(/\s*\r?\n\s*/g, " ").trim();
}

/** A paragraph that opens with `[^id]:` — it holds every definition after it too. */
const DEFINITION_BLOCK = /<p>\s*(\[\^[\w-]+\]\s*:[\s\S]*?)<\/p>/gi;

/** Each `[^id]: body`, ending where the next marker begins. */
const DEFINITION = /\[\^([\w-]+)\]\s*:\s*([\s\S]*?)(?=\[\^[\w-]+\]\s*:|$)/g;

/**
 * Lift every footnote definition out of the rendered HTML.
 *
 * Returns the document with the definition paragraphs removed, and the bodies
 * keyed by id, ready for the calls that reference them.
 */
export function collectFootnoteDefinitions(
  html: string,
): { html: string; defs: Map<string, string> } {
  const defs = new Map<string, string>();
  const remaining = html.replace(DEFINITION_BLOCK, (_match, block) => {
    for (const [, id, body] of String(block).matchAll(DEFINITION)) {
      defs.set(String(id), footnoteText(body));
    }
    return "";
  });
  return { html: remaining, defs };
}
