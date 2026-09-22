/**
 * An instruction addressed to the model must never reach the reader.
 *
 * ## Why a guarantee and not a request
 *
 * Three pinned blocks now end in a rules list addressed to the writer —
 * `RULES FOR THIS REPORT — approved supply`, `MARKET FIGURE RULES FOR THE
 * WHOLE REPORT`, `SUBJECT PRICE RULES FOR THE WHOLE REPORT` — and each is
 * handed to the model inside the prompt's pinned context.
 *
 * This repository has already measured what models do with pinned text they
 * were told not to reproduce: the planning block *tells the model never to
 * write a bracketed pointer to it*, and **nine of ten delivered documents
 * carried one anyway**. That is `stripEditorialBlocks`' lesson stated in its
 * own header — *an instruction is a request; this is the guarantee* — and the
 * rules blocks have no such guarantee behind them.
 *
 * What a leak costs here is not cosmetic. A client would read *"Do NOT rate
 * supply. Do not call the pipeline strong, weak, tight…"* in the middle of
 * their own report: it exposes the machinery, it reads as an error, and it
 * tells them the analysis was constrained without telling them why.
 *
 * ## Three bounds, so this can only remove what it is for
 *
 * **The opener is a closed shape.** A line that is a rules HEADER — the word
 * RULES, a scope (this report, this section, the whole report), and a colon
 * or a dash — and nothing else. No client document has a heading like that,
 * and a sentence merely containing the word "rules" is untouched.
 *
 * **It takes the list and stops.** Only the numbered or bulleted items that
 * immediately follow, and blank lines between them. The first line that is
 * neither ends the removal, so prose after a leaked block survives.
 *
 * **It is a no-op on a clean document**, asserted rather than intended: a
 * body with no rules header is returned byte-identical, which is what lets
 * this sit on the read path in front of every stored report ever written.
 */

/**
 * A rules header, and nothing that merely mentions rules.
 *
 * Anchored at both ends: the line is the header. `**bold**` is admitted
 * because a model reproducing a block often emphasises its heading.
 */
export const PROMPT_RULES_HEADER =
  /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:[A-Z][A-Z \u2014\u2013-]{0,60}\s)?RULES FOR (?:THIS|THE WHOLE)\s+(?:REPORT|SECTION)\b[^\n]*?(?:\*\*)?\s*$/;

/** A numbered or bulleted item, which is the only body a rules block has. */
const LIST_ITEM = /^\s*(?:\d{1,2}[.)]\s|[-*•]\s)/;

export interface PromptLeakageScrub {
  markdown: string;
  /** How many rules blocks were removed. Zero on every clean document. */
  removed: number;
  /** The header lines removed, for a QA reading rather than for the reader. */
  headers: string[];
}

/**
 * Remove any prompt rules block a model reproduced into the body.
 *
 * Byte-identical on a document that carries none.
 */
export function stripPromptRulesBlocks(markdown: string): PromptLeakageScrub {
  if (!markdown || !/RULES FOR/i.test(markdown)) {
    return { markdown: markdown ?? '', removed: 0, headers: [] };
  }
  const lines = markdown.split('\n');
  const out: string[] = [];
  const headers: string[] = [];
  let removed = 0;

  for (let i = 0; i < lines.length; i++) {
    if (!PROMPT_RULES_HEADER.test(lines[i])) {
      out.push(lines[i]);
      continue;
    }
    headers.push(lines[i].trim());
    removed++;
    i++;
    // Take the list that follows, and the blank lines inside it. The first
    // line that is neither ends the block, so prose below a leak survives.
    let lookahead = i;
    while (lookahead < lines.length) {
      const line = lines[lookahead];
      if (LIST_ITEM.test(line)) { lookahead++; continue; }
      if (line.trim() === '') {
        // A blank line belongs to the block only if a list item follows it.
        let next = lookahead + 1;
        while (next < lines.length && lines[next].trim() === '') next++;
        if (next < lines.length && LIST_ITEM.test(lines[next])) { lookahead = next; continue; }
      }
      break;
    }
    i = lookahead - 1;
  }

  // Collapse the hole the removal leaves, so a stripped block does not print
  // as a gap — `closeDroppedBlocks`' rule, applied to prose.
  const collapsed = out.join('\n').replace(/\n{3,}/g, '\n\n');
  return { markdown: collapsed, removed, headers };
}
