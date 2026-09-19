type InlineInsightOptions = {
  isInsightLabel: (label: string) => boolean;
  escapeLabel: (label: string) => string;
};

const INLINE_INSIGHT_PARAGRAPH =
  /^<p>\s*<(?:strong|b)>\s*([^<:：]+?)\s*[:：]?\s*<\/(?:strong|b)>\s*[:：]?\s*([\s\S]*)<\/p>$/i;
const BOLD_PREFIX = /^<p>\s*<(?:strong|b)>[^<]+[:：]?\s*<\/(?:strong|b)>/i;
const FOLLOWING_BLOCKS = ["p", "ul", "ol", "blockquote"] as const;

/**
 * Wrap inline insight paragraphs without applying a nested global expression to
 * the complete report. Each candidate and following sibling is consumed once.
 */
export function wrapInlineInsightParagraphs(
  html: string,
  { isInsightLabel, escapeLabel }: InlineInsightOptions,
): string {
  let output = "";
  let cursor = 0;

  while (cursor < html.length) {
    const paragraphStart = html.indexOf("<p>", cursor);
    if (paragraphStart === -1) {
      output += html.slice(cursor);
      break;
    }

    const paragraphEnd = html.indexOf("</p>", paragraphStart + 3);
    if (paragraphEnd === -1) {
      output += html.slice(cursor);
      break;
    }

    const end = paragraphEnd + 4;
    const paragraph = html.slice(paragraphStart, end);
    const match = INLINE_INSIGHT_PARAGRAPH.exec(paragraph);
    const label = match?.[1].trim() ?? "";
    if (!match || !isInsightLabel(label)) {
      output += html.slice(cursor, end);
      cursor = end;
      continue;
    }

    let blocksEnd = end;
    while (blocksEnd < html.length) {
      let blockStart = blocksEnd;
      while (blockStart < html.length && /\s/.test(html[blockStart])) blockStart += 1;
      let blockTag: typeof FOLLOWING_BLOCKS[number] | undefined;
      for (const tag of FOLLOWING_BLOCKS) {
        if (html.startsWith(`<${tag}>`, blockStart)) {
          blockTag = tag;
          break;
        }
      }
      if (!blockTag) break;

      const closingTag = `</${blockTag}>`;
      const blockEnd = html.indexOf(closingTag, blockStart + blockTag.length + 2);
      if (blockEnd === -1) break;
      if (blockTag === "p" && BOLD_PREFIX.test(html.slice(blockStart, blockEnd + closingTag.length))) break;
      blocksEnd = blockEnd + closingTag.length;
    }

    const body = match[2].trim();
    const bodyHtml = body ? `<p>${body}</p>` : "";
    output += html.slice(cursor, paragraphStart);
    output += `<div class="insight-box"><div class="insight-label">${escapeLabel(label)}</div>${bodyHtml}`;
    output += html.slice(end, blocksEnd);
    output += "</div>";
    cursor = blocksEnd;
  }

  return output;
}
