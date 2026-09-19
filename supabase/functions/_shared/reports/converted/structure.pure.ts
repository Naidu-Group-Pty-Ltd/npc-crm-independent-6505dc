/**
 * What an uploaded template is *made of*.
 *
 * ## Structure, not layout
 *
 * The converter takes the sections of an existing template and nothing else.
 * Not its margins, not its colours, not where a logo sat — those are the
 * things the design system is replacing, and carrying them across would
 * reproduce the document rather than refurbish it. What is worth keeping from
 * a template somebody has been sending clients for years is the **shape of the
 * argument**: which sections exist, in what order, how deeply they nest, and
 * which of them are tabular.
 *
 * That also happens to be the only part of a PDF that survives extraction
 * reliably. `parse-template-document` returns Markdown with an ATX heading
 * hierarchy; positions and fonts do not come back at all on a scanned source,
 * and come back wrong often enough on a native one that a layout-faithful
 * converter would spend its life in the uncanny valley.
 *
 * ## Depth is capped at two, and that is a design decision
 *
 * A report archetype's spine is chapters and their notes. Nothing in the design
 * system renders a fourth-level section as anything but a heading in the body
 * copy, so a template with `#####` nesting is flattened rather than losing the
 * content: the deep headings stay in the prose, they simply stop being
 * candidates for chapters. `MAX_BIND_DEPTH` is what makes that explicit.
 */
import { markdownToPlainText, renderMarkdown } from '../markdown.pure.ts';
import { neutraliseUrls, repairFloatArtefacts } from '../text.pure.ts';
import { rewrapMarkdownProse } from '../../reportDesign/prose.pure.ts';

/** No template in the record has more than this many sections worth binding. */
export const MAX_SECTIONS = 80;

/** Beyond two levels a heading is body copy, not a chapter candidate. */
export const MAX_BIND_DEPTH = 2;

/** A section shorter than this is a label, not a section. */
export const MIN_SECTION_CHARS = 40;

/** The most Markdown one extracted section may carry. */
export const MAX_SECTION_CHARS = 12_000;

/** A whole upload beyond this is not a template, it is a book. */
export const MAX_SOURCE_CHARS = 400_000;

/** One section of an uploaded template. */
export interface ExtractedSection {
  /** Position in the source, from zero. Stable; used as the binding key. */
  index: number;
  /** 1 for a top-level section, 2 for a sub-section. Deeper is flattened. */
  depth: 1 | 2;
  title: string;
  /** The section's own Markdown, its heading removed. */
  markdown: string;
  /** Characters of prose, after the caps. Drives the "is this real" check. */
  chars: number;
  /** GFM pipe tables found inside. A tabular section binds differently. */
  tables: number;
  /** True when the body is mostly a table rather than prose. */
  tabular: boolean;
}

export interface ExtractedStructure {
  /** What the document calls itself, when the source said. */
  title: string;
  sections: readonly ExtractedSection[];
  /** Every heading, including the ones too deep to bind. For the report. */
  headingCount: number;
  notices: {
    /** Headings past `MAX_BIND_DEPTH`, left in the prose. */
    flattened: number;
    /** Sections dropped for being shorter than `MIN_SECTION_CHARS`. */
    tooShort: number;
    /** Characters the caps did not carry. */
    charsOmitted: number;
    /** True when the source had no headings at all. */
    unstructured: boolean;
    /**
     * Eyebrow headings folded into the title beneath them.
     *
     * `SECTION 01` over `Capacity at a glance` arrives from a transcription as
     * two headings with the label at the *shallower* level. Counted so the
     * review screen can say the structure was repaired rather than leaving a
     * person to wonder why their section list looks different from their PDF.
     */
    labelsFolded: number;
    /**
     * Trailing contact / disclaimer sections dropped.
     *
     * The one thing the converter throws away, because the design system prints
     * its own closing page from `global_report_settings` and keeping the
     * template's copy guarantees the same block twice, a page apart. Counted so
     * the review screen can say so.
     */
    furnitureDropped: number;
  };
}

const clean = (v: string): string =>
  neutraliseUrls(v).replace(/\s+/g, ' ').trim();

/** `## 3. Market Overview` → `{ depth: 1, title: 'Market Overview' }`. */
function readHeading(line: string): { level: number; title: string } | null {
  const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (!m) return null;
  // The leading number is dropped from the title but not from the order: the
  // spine renumbers, and carrying "3." into a chapter called "3. Market
  // Overview" prints two numbers on the page.
  const title = clean(markdownToPlainText(m[2].replace(/^\d{1,2}[.)]\s*/, ''), 160));
  if (!title) return null;
  return { level: m[1].length, title };
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;

/**
 * A heading that is a *label* for the heading beneath it, not a section.
 *
 * `SECTION 01`, `Part Two`, `Step 3`, a bare `04`, a bare `IV`. These are
 * eyebrows: printed small above a large title, and transcribed back as the
 * shallower heading because a model reading a page maps size to level. Matching
 * on the wording alone is not enough — a chapter genuinely called "Section 8 of
 * the Act" owns a body, and the fold only applies to headings that own nothing.
 */
const LABEL_HEADING =
  /^(?:section|chapter|part|step|stage|phase|appendix|schedule)?\s*(?:\d{1,3}|[ivxlcdm]{1,6}|one|two|three|four|five|six|seven|eight|nine|ten)?\s*[.:)-]?$/i;

/**
 * A closing block the design system prints for itself.
 *
 * Matched against the *title only*, and only at the very end of a document —
 * see pass five. Deliberately short: "About us" and "Our process" are content a
 * template author wrote, and belong in the appendix like everything else.
 */
const CLOSING_FURNITURE =
  /^(?:contact(?:\s+us|\s+details)?|get\s+in\s+touch|disclaimers?|important\s+(?:information|notice|notes?)|legal(?:\s+(?:notice|disclaimer|information))?|general\s+information(?:\s+only)?)$/i;

/**
 * Read an uploaded template's Markdown into sections.
 *
 * Never throws. A source with no headings at all produces one section holding
 * everything, flagged `unstructured` — which is a real outcome for a scanned
 * template, and one the caller has to be able to show the user rather than
 * discover as an empty document.
 */
export interface ExtractOptions {
  /**
   * Keep the template's own contact / disclaimer sections instead of dropping
   * them.
   *
   * The drop (pass five) is right *because* `renderCompanyPage` prints the
   * tenant's own closing page — and it was unconditional, so when the tenant's
   * disclaimer was missing the document lost both. A settings row that was
   * never written, or a query the render route warns about and swallows, both
   * arrive as `null`, and the page then carried `class="page-disclaimer"` with
   * no disclaimer on it.
   *
   * Losing the tenant's wording in favour of the template's is a formatting
   * preference. Losing the disclaimer from a lending document is not. So the
   * render path sets this when nothing will replace what it is about to delete,
   * and the section comes through as an appendix chapter.
   */
  keepClosingFurniture?: boolean;
}

export function extractStructure(
  markdown: string,
  fallbackTitle = '',
  options: ExtractOptions = {},
): ExtractedStructure {
  // Float artefacts are repaired here, at the door, so that everything
  // downstream — the sections, the faithfulness snapshot, the enrichment prompt
  // and the printed page — is looking at the same string. See
  // `repairFloatArtefacts`.
  const source = repairFloatArtefacts(String(markdown ?? '').slice(0, MAX_SOURCE_CHARS));
  const omittedBySource = Math.max(0, String(markdown ?? '').length - source.length);

  const lines = source.split('\n');
  const sections: ExtractedSection[] = [];
  const notices = {
    flattened: 0,
    tooShort: 0,
    charsOmitted: omittedBySource,
    unstructured: false,
    labelsFolded: 0,
    furnitureDropped: 0,
  };

  // Empty, not the fallback.
  //
  // This used to be `clean(fallbackTitle)`, and the fallback is the uploaded
  // file's name with its suffix removed. Seeding it meant every `if (!title)`
  // below — including the rule that takes the document's own top-level heading
  // — was dead code whenever a filename existed, which is always. A real
  // Snapshot whose `#` heading named the firm and the format printed a cover
  // reading `Report_Name_Client_Name_2026-08-02` instead, underscores and all:
  // one unbreakable token, wide enough at cover size to push the cover box past
  // the trim and drag the masthead and footer off the sheet with it.
  //
  // The return already ends `title || clean(fallbackTitle)`, so the fallback
  // still applies — last, which is what "fallback" means.
  let title = '';
  let headingCount = 0;

  // ── Pass one — every heading with the body it owns ────────────────────────
  //
  // Collected before anything is decided, because the decisions below need to
  // see whether a heading owns content and what follows it. The previous
  // single-streaming-pass version could not: it had to commit to a depth the
  // moment it read a heading.
  const raw: Array<{ level: number; title: string; body: string[] }> = [];
  let open: { level: number; title: string; body: string[] } | null = null;
  const preamble: string[] = [];
  for (const line of lines) {
    const h = readHeading(line);
    if (!h) {
      (open ? open.body : preamble).push(line);
      continue;
    }
    headingCount += 1;
    open = { level: h.level, title: h.title, body: [] };
    raw.push(open);
  }

  // ── Pass two — fold the labels ────────────────────────────────────────────
  //
  // A well-designed report prints a small eyebrow above a large title —
  // `SECTION 01` over `Capacity at a glance`. A model transcribing that PDF maps
  // *visual size* to heading level, so the eyebrow comes back as `##` and the
  // real title as `#`. The hierarchy arrives inverted.
  //
  // The tell is reliable: the eyebrow owns no body at all, because the title
  // heading follows it immediately. So a heading that owns nothing and is
  // followed by another heading is furniture, not a section — and when it reads
  // like a section label, the heading beneath it inherits the shallower of the
  // two levels, which is what puts sibling chapters back on one level.
  //
  // Measured against the run that prompted this: a Borrowing Capacity Snapshot
  // came back with `# masthead`, `# client name`, `## Section 01`,
  // `# Capacity at a glance`, `## Expenses and commitments` … and bound 3 of 7
  // chapters with 3 sections dumped in the appendix.
  const folded: Array<{ level: number; title: string; body: string[] }> = [];
  for (let i = 0; i < raw.length; i += 1) {
    const entry = raw[i];
    const bodyChars = entry.body.join('\n').trim().length;
    const next = raw[i + 1];
    if (next && bodyChars < MIN_SECTION_CHARS && LABEL_HEADING.test(entry.title)) {
      // The eyebrow. Its level is the one the design intended for the title
      // beneath it, so hand it over and drop the label itself.
      next.level = Math.min(next.level, entry.level);
      notices.labelsFolded += 1;
      continue;
    }
    folded.push(entry);
  }

  // ── Pass three — level from the headings that own content ─────────────────
  //
  // Empty headings are excluded from the baseline. A masthead or a running head
  // that survived transcription owns nothing, and letting it define the
  // shallowest level pushes every real chapter a rung deeper.
  // This replaces the old `titleIsLone` rule rather than joining it.
  //
  // That rule said: when exactly one heading sits at the shallowest level and
  // it comes first, it is the document's title, so start the baseline one level
  // down. It was a proxy for the thing actually being asked — *does this
  // heading own any content?* — and excluding empty headings answers that
  // directly, in every case the proxy covered and two it did not: a `# Title`
  // over `## A` / `### A.1` (where the proxy pushed the baseline to 3 and
  // flattened the real nesting), and a title that *does* carry a preamble
  // (which the proxy discarded, because a heading above the baseline opens no
  // section).
  const owning = folded.filter((e) => e.body.join('\n').trim().length >= MIN_SECTION_CHARS);
  const levels = (owning.length ? owning : folded).map((e) => e.level);
  const baseline = levels.length ? Math.min(...levels) : 1;

  // Naming the document is a separate question from levelling it. A first
  // heading sitting alone above everything else is the title whether or not it
  // also carries a preamble; when it does, it is *also* a section, and the
  // baseline above lets it be one. The rule this replaced could only answer one
  // of those and answered it by discarding the preamble.
  const first = folded[0];
  if (!title && first && folded.length > 1 && folded.slice(1).every((e) => e.level > first.level)) {
    title = first.title;
  }

  const push = (depth: 1 | 2, sectionTitle: string, bodyLines: string[]) => {
    // ── Where a transcribed line becomes a paragraph ────────────────────────
    //
    // The source of this Markdown is a model reading a PDF, so a newline in it
    // is a line somebody laid out — a KPI card's label over its value, a run of
    // `Label: value` pairs. CommonMark says a lone newline is a space, which is
    // right for the three formats carrying model-authored prose and wrong here:
    // it printed `BORROWING CAPACITY $856,932 Estimate` as body copy, and six
    // key-value pairs as one unpunctuated sentence.
    //
    // Repaired at extraction rather than at render, for the reason
    // `repairFloatArtefacts` is: the faithfulness snapshot is taken from this
    // string, so a change made later would look like the design pass inventing
    // text. `rewrapMarkdownProse` leaves tables, lists and headings alone.
    const body = rewrapMarkdownProse(bodyLines.join('\n')).trim();
    const capped = body.length > MAX_SECTION_CHARS ? body.slice(0, MAX_SECTION_CHARS) : body;
    notices.charsOmitted += body.length - capped.length;
    if (capped.length < MIN_SECTION_CHARS) { notices.tooShort += 1; return; }
    const tableLines = capped.split('\n').filter((l) => TABLE_ROW.test(l)).length;
    sections.push({
      index: sections.length,
      depth,
      title: sectionTitle,
      markdown: capped,
      chars: capped.length,
      tables: tableLines >= 2 ? Math.max(1, Math.round(tableLines / 4)) : 0,
      tabular: tableLines >= 2 && tableLines >= capped.split('\n').filter(Boolean).length / 2,
    });
  };

  // ── Pass four — emit ──────────────────────────────────────────────────────
  let carry: { depth: 1 | 2; title: string; body: string[] } | null = null;
  for (const entry of folded) {
    if (sections.length >= MAX_SECTIONS) break;
    const relative = entry.level - baseline + 1;

    if (relative < 1) {
      // Above the baseline: the document's own title. It opens no section.
      if (carry) { push(carry.depth, carry.title, carry.body); carry = null; }
      if (!title) title = entry.title;
      continue;
    }
    if (relative > MAX_BIND_DEPTH) {
      // Too deep to be a chapter. Its heading and body stay in the prose of
      // whichever section it falls in, so nothing is lost — only its candidacy.
      notices.flattened += 1;
      if (carry) {
        carry.body.push(`${'#'.repeat(entry.level)} ${entry.title}`, ...entry.body);
      }
      continue;
    }
    if (carry) push(carry.depth, carry.title, carry.body);
    carry = { depth: relative === 1 ? 1 : 2, title: entry.title, body: [...entry.body] };
  }
  if (carry && sections.length < MAX_SECTIONS) push(carry.depth, carry.title, carry.body);

  // ── Pass five — drop the template's own closing furniture ─────────────────
  //
  // Every document this renders ends with `renderCompanyPage`: the company
  // name, the contact rows and the professional disclaimer, taken from
  // `global_report_settings`. An uploaded template has that page too, and a
  // transcription brings it back as a final `## Contact Us` section — so the
  // converted draft printed the contact block as a *chapter*, and then printed
  // the design system's own version of it on the very next page.
  //
  // This is the one place the converter deliberately loses something, and it is
  // deliberately narrow: the title has to read as furniture, and the section has
  // to be at the end. A "Contact" section in the middle of a template is
  // content. The count goes into `notices` so the review screen can say what
  // happened rather than leaving somebody to notice an absence.
  //
  // Unless nothing will replace it — see `ExtractOptions.keepClosingFurniture`.
  while (!options.keepClosingFurniture && sections.length) {
    const last = sections[sections.length - 1];
    if (!CLOSING_FURNITURE.test(last.title)) break;
    sections.pop();
    notices.furnitureDropped += 1;
  }

  if (!headingCount) {
    notices.unstructured = true;
    const body = source.trim().slice(0, MAX_SECTION_CHARS);
    if (body.length >= MIN_SECTION_CHARS) {
      sections.push({
        index: 0,
        depth: 1,
        title: title || 'Document',
        markdown: body,
        chars: body.length,
        tables: 0,
        tabular: false,
      });
    }
  }

  return { title: title || clean(fallbackTitle) || 'Untitled template', sections, headingCount, notices };
}

/**
 * A one-line description of what was found, for the review screen.
 *
 * The upload screen has to say something truthful before anybody commits to a
 * conversion, and "42 sections" is the single most useful thing to say. An
 * unstructured source is called out first because it is the one result where
 * the sensible next action is "try a different export", not "carry on".
 */
export function describeStructure(structure: ExtractedStructure): string {
  if (structure.notices.unstructured) {
    return 'No headings were found, so the whole document is one section. '
      + 'A source exported with real headings converts far better.';
  }
  const top = structure.sections.filter((s) => s.depth === 1).length;
  const sub = structure.sections.length - top;
  const tabular = structure.sections.filter((s) => s.tabular).length;
  const parts = [`${top} ${top === 1 ? 'section' : 'sections'}`];
  if (sub) parts.push(`${sub} sub-${sub === 1 ? 'section' : 'sections'}`);
  if (tabular) parts.push(`${tabular} mostly tabular`);
  if (structure.notices.flattened) {
    parts.push(`${structure.notices.flattened} heading${structure.notices.flattened === 1 ? '' : 's'} too deep to bind`);
  }
  return parts.join(', ');
}

/** Estimated printed lines, so the plan can be costed before it is rendered. */
export function sectionLines(section: ExtractedSection, idPrefix: string): number {
  return section.markdown ? renderMarkdown(section.markdown, { idPrefix }).lines : 0;
}
