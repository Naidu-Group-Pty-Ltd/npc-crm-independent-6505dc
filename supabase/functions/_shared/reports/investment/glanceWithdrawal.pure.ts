/**
 * The "At a glance" strip is withdrawn from the document.
 *
 * ## Why it went
 *
 * The generator asked the model to open every chapter with a
 * `{{glance: ✓ … | ⚠ … | ◆ … | ★ …}}` strip, and every delivered document
 * carried one per section — fourteen in the 23 Sep 2026 Compass for 9 Hollow
 * Street, Golden Square, and the same pattern through the Financial Analysis,
 * the Due Diligence report, the Snapshot and the Executive Briefing for
 * 97 Poole Road, Kellyville. The owner read all five and asked for it to be
 * removed "throughout" in favour of a different approach. Reading the pages
 * says why, and none of it is a styling problem:
 *
 *  - **It is the prose again, in shorthand.** "Established suburban amenity
 *    base" above a section that opens "The strongest amenity feature is the
 *    concentration of everyday services…". A reader is asked to read the same
 *    finding twice, fourteen times.
 *  - **Its categories are the model's, and they are wrong often enough to
 *    matter.** "8.6% one-year house-price growth" filed under *Watch*;
 *    "GRZ confirmed at parcel level" filed under *Context* beside a register
 *    that says a spatial layer is not a certificate.
 *  - **Its verdict contradicts the document's.** The Executive Verdict's strip
 *    said *Proceed with caution* under a verdict page that said *BUY* — the
 *    grade is the engine's and the strip was a second opinion nobody issued.
 *  - **It fragments the page.** A labelled key at the head of every section is
 *    what makes a continuous document read as a stack of boxes.
 *
 * ## What replaces it
 *
 * Nothing in the section, on purpose. The job a summary does is done once, at
 * the front, by the executive summary the master draws from the record (the
 * verdict, the figures, the property and what the grade rests on); and each
 * section now OPENS WITH ITS FINDING in a plain sentence — the generator's
 * instruction, which replaced the one that asked for the strip. A summary
 * repeated per section is a second copy of the report; one summary and a
 * first sentence that states the conclusion is how a reader is told what
 * matters without being told it twice.
 *
 * ## Where it runs
 *
 * On the READ path, in `presentStoredMarkdown`, because every document stored
 * before the prompt changed carries the strips and the owner asked for them
 * gone from what a client is shown — not only from what is generated next.
 * `report_content` is not rewritten; a strip is simply not presented. The
 * directive grammar itself stays in `vizDirectives.pure.ts` because other
 * formats and the viewer's parser share it.
 *
 * A body with no strip is returned byte for byte, so a document that never
 * carried one packs, charges and renders exactly as it did.
 */

/** `{{glance: …}}` with any payload, and the payload-less `{{glance}}`. */
const GLANCE_DIRECTIVE_RE = /\{\{\s*glance\s*(?::[^}]*)?\}\}/gi;

export interface GlanceWithdrawalResult {
  markdown: string;
  /** How many strips were not presented. */
  withdrawn: number;
}

/** Marks a line that held nothing but a strip, so the line can go whole. */
const WITHDRAWN_LINE = '\u0000glance-withdrawn\u0000';

/**
 * Remove every at-a-glance strip.
 *
 * A strip normally stands on a line of its own between a heading and the
 * first paragraph. That LINE goes, and where it sat between two blank lines
 * one of them goes too, so the heading and the paragraph under it are
 * separated exactly as a document that never carried a strip would separate
 * them — nothing else in the body is touched, blank lines elsewhere included.
 * A strip written inside a line of prose (the grammar allows it; no issued
 * document has done it) is removed with the space before it.
 */
export function withdrawGlanceStrips(markdown: string): GlanceWithdrawalResult {
  if (!markdown || !/\{\{\s*glance/i.test(markdown)) return { markdown, withdrawn: 0 };
  let withdrawn = 0;
  // A strip alone on its line — its payload may itself run over lines.
  const marked = markdown.replace(
    /(^|\n)[ \t]*\{\{\s*glance\s*(?::[^}]*)?\}\}[ \t]*(?=\n|$)/gi,
    (_whole, lead: string) => {
      withdrawn += 1;
      return `${lead}${WITHDRAWN_LINE}`;
    },
  );
  // …and one written inside a line.
  const inline = marked.replace(/[ \t]*\{\{\s*glance\s*(?::[^}]*)?\}\}/gi, () => {
    withdrawn += 1;
    return '';
  });
  if (!withdrawn) return { markdown, withdrawn: 0 };

  const lines = inline.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== WITHDRAWN_LINE) {
      kept.push(lines[i]);
      continue;
    }
    const before = kept.length ? kept[kept.length - 1] : null;
    const after = i + 1 < lines.length ? lines[i + 1] : null;
    // Blank on both sides: the strip had a paragraph break either side of it,
    // and one of those breaks is now surplus.
    if (before !== null && before.trim() === '' && after !== null && after.trim() === '') i += 1;
  }
  return { markdown: kept.join('\n'), withdrawn };
}

/** The directive's pattern, for a spec to assert nothing of it survives. */
export const GLANCE_DIRECTIVE_PATTERN = GLANCE_DIRECTIVE_RE;
