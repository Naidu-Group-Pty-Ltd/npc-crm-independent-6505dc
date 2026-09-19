/**
 * Reading prose that arrived with somebody else's line breaks.
 *
 * A blank line is always a paragraph break. A *lone* newline is ambiguous, and
 * this module is the one place that decides what it means — because two callers
 * need the same judgement and reached it from opposite directions.
 *
 * It is a sibling of `companyBlock.pure.ts` rather than of the converter's text
 * helpers because a canonical design-system module may only import siblings
 * (`designSystemSourceOfTruth.spec.ts` enforces it: Edge Functions cannot
 * resolve anything else). The converter reaches across the other way, which is
 * the direction every format already takes.
 */

/** A line that ends mid-sentence was wrapped by an editor, not ended by one. */
const ENDS_A_SENTENCE = /[.!?:;)"'’”]\s*$/;

/**
 * A line that *continues* one starts the way a sentence never does.
 *
 * This is the half the first version of this rule was missing, and the KPI card
 * is why. See `paragraphsFromWrapped`.
 */
const CONTINUES_A_SENTENCE = /^[a-z(“"']/;

/**
 * Read hard-wrapped text as paragraphs, and line-per-unit text as lines.
 *
 * ## The two shapes, and why a lone newline cannot just be picked
 *
 * A blank line is always a paragraph break. A *lone* newline is ambiguous, and
 * the two readings are both common and each is wrong for the other's input:
 *
 * - **A wrapped paragraph.** Somebody typed into a textarea, or a model
 *   hard-wraps at 80 columns. Every newline is an accident of width, and
 *   treating one as a break prints a column of ragged half-lines: "…based on
 *   our", then "expertise and experience in the real estate market."
 * - **A line per unit.** A KPI card transcribed out of a PDF —
 *   `BORROWING CAPACITY`, `$856,932`, `Estimate` — or a run of `Label: value`
 *   pairs. Every newline is meant, and joining them prints
 *   `BORROWING CAPACITY $856,932 Estimate` as body copy.
 *
 * ## Ending punctuation alone is not enough
 *
 * The first version of this rule broke only where the previous line ended on
 * sentence punctuation. That reads the wrapped paragraph correctly and reads the
 * KPI card **exactly as wrongly as CommonMark does**: `BORROWING CAPACITY` ends
 * on no punctuation at all, so it joins to `$856,932`, which joins to
 * `Estimate`. Checked against the real transcription rather than assumed — it
 * reproduces the defect verbatim.
 *
 * So both ends of the join are tested. A newline is a wrap only when the line
 * before it did not finish **and** the line after it continues — begins
 * lowercase, or on an opening bracket or quote. `$856,932`, `Estimate` and
 * `Buffer: Included…` all begin in ways a mid-sentence continuation cannot, so
 * they stay their own lines; `expertise and experience…` does not, so it rejoins.
 *
 * ## Where each caller came from
 *
 * This was written for the closing page's disclaimer — the last thing on the
 * last page of every report in nine formats — and the converter then hit the
 * mirror image of it on transcribed text. One rule, in one place, rather than a
 * second copy that drifts.
 */
export function paragraphsFromWrapped(value: string | null | undefined): string[] {
  const text = String(value ?? '');
  if (!text.trim()) return [];

  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    let current = '';
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (!current) { current = line; continue; }
      const wrapped = !ENDS_A_SENTENCE.test(current) && CONTINUES_A_SENTENCE.test(line);
      if (wrapped) { current = `${current} ${line}`; continue; }
      out.push(current);
      current = line;
    }
    if (current) out.push(current);
  }
  return out;
}

/** Markdown lines that are structure, and must never be joined to a neighbour. */
const MARKDOWN_STRUCTURE = /^(?:#{1,6}\s|[-*+]\s|\d{1,3}[.)]\s|>\s?|\||```|~~~|\s{4})/;

/**
 * The same rule over a Markdown body, leaving its structure alone.
 *
 * A converted section is not prose — it is prose *and* pipe tables *and* bullet
 * lists *and* headings. Rejoining a wrapped line is right inside a paragraph and
 * catastrophic across a table: two rows joined with a space stop being rows.
 *
 * So the body is split into blocks. A run of consecutive structural lines is
 * **one** block joined by single newlines — a pipe table separated by blank
 * lines is not a table any more, which is what the first version of this did to
 * every table in the document — and prose runs become paragraphs by the rule
 * above. Blocks are then separated by blank lines, because that is the only
 * separator CommonMark reads as a break, and the renderer downstream would
 * otherwise re-join exactly what this separated.
 */
export function rewrapMarkdownProse(value: string | null | undefined): string {
  const text = String(value ?? '');
  if (!text.trim()) return text;

  const blocks: string[] = [];
  let prose: string[] = [];
  let structure: string[] = [];
  let fence: string[] | null = null;

  const flushProse = () => {
    if (prose.length) blocks.push(...paragraphsFromWrapped(prose.join('\n')));
    prose = [];
  };
  const flushStructure = () => {
    if (structure.length) blocks.push(structure.join('\n'));
    structure = [];
  };
  const flush = () => { flushProse(); flushStructure(); };

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();

    // Inside a fence every line is verbatim, blank ones included.
    if (fence) {
      fence.push(line);
      if (/^\s*(?:```|~~~)/.test(line)) { blocks.push(fence.join('\n')); fence = null; }
      continue;
    }
    if (/^\s*(?:```|~~~)/.test(line)) { flush(); fence = [line]; continue; }

    if (!line.trim()) { flush(); continue; }
    if (MARKDOWN_STRUCTURE.test(line)) { flushProse(); structure.push(line); continue; }
    flushStructure();
    prose.push(line);
  }
  if (fence) blocks.push(fence.join('\n'));
  flush();

  return blocks.join('\n\n');
}
