/**
 * Strip the generation-time cover block out of a stored Compass narrative.
 *
 * `generate-investment-report` used to open every `report_content` with a
 * baked header — `# <BRAND NAME>`, the tagline, `# Investment Report: <addr>`
 * — and the registry's `compass.cover` section then wrote a "Cover Page"
 * section of its own. Both are instructions to a renderer that no longer
 * needs them: every surface that draws this narrative today draws its own
 * cover, so the baked block rendered as a SECOND cover inside the body —
 * measured on a real client document as a page opening with the firm's
 * masthead, the words "Cover Page" as a visible heading, and "Prepared for:
 * Premium client of …" as body copy, under a template that had already said
 * all of it properly on page 1.
 *
 * The generator no longer writes either (the registry's cover section is
 * excluded from assembly), but 1,100+ stored reports still carry them, and a
 * regeneration nobody asked for is not a fix. So the strip happens where the
 * narrative is read.
 *
 * Deliberately conservative: each rule matches only the shapes the corpus
 * actually contains, anchored to the top of the document, and a narrative
 * that opens with real prose is returned untouched. Nothing here edits
 * mid-document content — a section an author titled "Cover strategy" is not
 * a cover page.
 */

export interface NarrativeCleanResult {
  text: string;
  /** The baked `# BRAND …` masthead block was removed. */
  strippedHeader: boolean;
  /** A leading "Cover Page" section was removed. */
  strippedCoverSection: boolean;
}

const TAGLINE = /^your dedicated property partner$/i;
const REPORT_TITLE = /^#{1,2}\s+investment report\s*:/i;
const COVER_HEADING = /^(#{1,6}\s+|\*\*)\s*cover\s*page\s*(\*\*)?\s*$/i;

/** A line that opens a new section: any ATX heading, or a thematic break. */
const SECTION_EDGE = /^(#{1,6}\s+\S|---+\s*$)/;

export function stripBakedCover(source: string): NarrativeCleanResult {
  const text = String(source ?? '');
  if (!text.trim()) return { text, strippedHeader: false, strippedCoverSection: false };

  let lines = text.split('\n');
  let strippedHeader = false;
  let strippedCoverSection = false;

  // ── The baked masthead ────────────────────────────────────────────────────
  // Shape: an H1 (the brand), optionally the tagline, optionally an H1/H2
  // "Investment Report: …", closed by the first `---`. Only stripped when the
  // block sits at the very top AND carries at least one of the two signatures
  // (tagline or report-title line) — a narrative that legitimately opens with
  // a lone H1 keeps it.
  {
    let end = -1;
    let sawSignature = false;
    for (let i = 0; i < Math.min(lines.length, 14); i++) {
      const t = lines[i].trim();
      if (!t) continue;
      if (/^---+$/.test(t)) { end = i; break; }
      if (TAGLINE.test(t) || REPORT_TITLE.test(t)) { sawSignature = true; continue; }
      if (/^#\s+\S/.test(t)) continue;      // the brand H1 (or the title H1)
      break;                                 // real prose — not the masthead
    }
    if (end >= 0 && sawSignature) {
      lines = lines.slice(end + 1);
      strippedHeader = true;
    }
  }

  // ── The "Cover Page" section ──────────────────────────────────────────────
  // A heading (or bold line) reading exactly "Cover Page", near the top,
  // dropped together with its body up to the next section edge. Near the top
  // only: the section the registry generated was always first or second.
  {
    const searchLimit = Math.min(lines.length, 40);
    let start = -1;
    for (let i = 0; i < searchLimit; i++) {
      if (COVER_HEADING.test(lines[i].trim())) { start = i; break; }
    }
    if (start >= 0) {
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i++) {
        if (SECTION_EDGE.test(lines[i].trim())) { end = i; break; }
      }
      // A `---` edge belongs to the removal (it closed the cover section);
      // a heading edge starts the next section and stays.
      const closedByRule = end < lines.length && /^---+\s*$/.test(lines[end].trim());
      lines = lines.slice(0, start).concat(lines.slice(closedByRule ? end + 1 : end));
      strippedCoverSection = true;
    }
  }

  const cleaned = lines.join('\n').replace(/^\s*\n/, '');
  return { text: cleaned, strippedHeader, strippedCoverSection };
}
