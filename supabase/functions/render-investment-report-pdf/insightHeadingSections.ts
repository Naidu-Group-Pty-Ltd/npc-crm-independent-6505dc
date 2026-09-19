type HtmlTag = { start: number; end: number; name: string; closing: boolean };

/** Wrap matching h3/h4 sections with two linear passes over the rendered HTML. */
export function wrapInsightHeadingSections(
  html: string,
  isInsightLabel: (label: string) => boolean,
  escapeHtml: (value: string) => string,
): string {
  const tags: HtmlTag[] = [];

  for (let cursor = 0; cursor < html.length;) {
    if (html.charCodeAt(cursor) !== 60) {
      cursor += 1;
      continue;
    }
    const start = cursor++;
    let closing = false;
    if (html.charCodeAt(cursor) === 47) {
      closing = true;
      cursor += 1;
    }
    const nameStart = cursor;
    while (cursor < html.length && /[A-Za-z0-9]/.test(html[cursor])) cursor += 1;
    const name = html.slice(nameStart, cursor).toLowerCase();
    while (cursor < html.length && html.charCodeAt(cursor) !== 62) cursor += 1;
    if (cursor === html.length) break;
    cursor += 1;
    if (/^h[1-4]$/.test(name) || name === "section") tags.push({ start, end: cursor, name, closing });
  }

  const matchingClose = new Map<number, number>();
  const openByName = new Map<string, number[]>();
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (!tag.name.startsWith("h")) continue;
    const stack = openByName.get(tag.name) ?? [];
    if (tag.closing) {
      const opening = stack.pop();
      if (opening !== undefined) matchingClose.set(opening, index);
    } else {
      stack.push(index);
      openByName.set(tag.name, stack);
    }
  }

  const nextBoundary = new Array<number>(tags.length).fill(html.length);
  let boundary = html.length;
  for (let index = tags.length - 1; index >= 0; index -= 1) {
    nextBoundary[index] = boundary;
    const tag = tags[index];
    if (!tag.closing && (tag.name === "section" || /^h[1-4]$/.test(tag.name))) boundary = tag.start;
  }

  let output = "";
  let copiedThrough = 0;
  for (let index = 0; index < tags.length; index += 1) {
    const opening = tags[index];
    if (opening.start < copiedThrough || opening.closing || !/^h[34]$/.test(opening.name)) continue;
    const closeIndex = matchingClose.get(index);
    if (closeIndex === undefined) continue;
    const closing = tags[closeIndex];
    const title = html.slice(opening.end, closing.start)
      .replace(/<[^>]+>/g, "").trim().replace(/[:\-—]\s*$/, "");
    if (!isInsightLabel(title)) continue;

    const contentEnd = nextBoundary[closeIndex];
    output += html.slice(copiedThrough, opening.start);
    output += `<div class="insight-box"><div class="insight-label">${escapeHtml(title)}</div>`;
    output += html.slice(closing.end, contentEnd) + "</div>";
    copiedThrough = contentEnd;
    index = closeIndex;
  }
  return copiedThrough === 0 ? html : output + html.slice(copiedThrough);
}
