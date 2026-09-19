/**
 * Compass Post-Processor — Phases 5 & 6
 * -------------------------------------
 * Runs AFTER the model emits markdown for a Compass or Financial Analysis
 * report, and BEFORE the report is stored.
 *
 * Phase 5:
 *   • Strip every EDITORIAL_LABELS block ("What This Means", "NPC view", …)
 *   • Executive Verdict hard cap from COMPASS_WORD_CAPS
 *   • Per-section maxWordCount from compassSectionRegistry
 *
 * Phase 6 — Page-pressure trimming engine:
 *   • Estimates rendered page count from word count + table rows
 *   • If over the target band, applies PAGE_PRESSURE_TRIM_ORDER in sequence
 *   • Protected sections are NEVER touched (zoning, risk, infrastructure,
 *     due diligence, property assessment)
 *
 * ## Who calls this, and why that is the whole point
 *
 * Until v3.0 the only caller was `condense-investment-report`, which produces
 * the derived snapshot and briefing variants — 44 rows. `generate-investment-report`,
 * which produced all 1,124 Compass reports in the table, called neither this
 * module nor the QA validator. Every cap in here was written, tested and never
 * applied to the document a client receives, which is why that document ran at
 * 2.3× its declared budget with 90 commentary labels a report.
 *
 * `generate-investment-report` now runs this in its post-processing pass. If you
 * add a caller, make sure it is on a path that stores a report; if you remove
 * one, the caps stop existing again rather than becoming advisory.
 *
 * Frontend mirror: src/lib/reports/compassPostProcessor.ts (keep in sync).
 */

import {
  COMPASS_40_SECTIONS,
  FINANCIAL_ANALYSIS_SECTIONS,
  COMPASS_WORD_CAPS,
  COMPASS_PAGE_BAND,
  EDITORIAL_LABELS,
  PAGE_PRESSURE_TRIM_ORDER,
  PROTECTED_SECTION_IDS,
  type CompassSectionDefinition,
} from './compassSectionRegistry.ts';
import { scrubBlocks } from './reports/investment/blockHygiene.pure.ts';

export type PostProcessTier = 'compass-40' | 'financial-analysis';

export interface PostProcessReport {
  tier: PostProcessTier;
  initialWordCount: number;
  finalWordCount: number;
  initialEstimatedPages: number;
  finalEstimatedPages: number;
  trimsApplied: string[];
  sectionsTrimmed: { sectionId: string; reason: string; wordsRemoved: number }[];
  warnings: string[];
  /**
   * How many editorial blocks were removed, and what they weighed.
   *
   * Reported rather than silent, for the reason `MarkdownNotices.figuresDropped`
   * exists: a report the strip emptied looks exactly like one the model wrote
   * tersely, and only the count tells the two apart. The generator logs this.
   */
  editorialBlocksRemoved: number;
  editorialWordsRemoved: number;
  /**
   * Stat cards dropped for stating nothing, and charts dropped as repeats.
   *
   * Counted for the same reason as `editorialBlocksRemoved`: a report that
   * never had an empty card and one this pass cleaned look identical
   * afterwards, and only the count tells them apart.
   */
  emptyStatCardsRemoved: number;
  duplicateDirectivesRemoved: number;
}

interface ParsedSection {
  /** Heading text without "## " */
  heading: string;
  /** Lines that make up the section body (NOT including its own H2 line) */
  bodyLines: string[];
  /** Matched section definition, if any */
  def?: CompassSectionDefinition;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

export function countWords(text: string): number {
  if (!text) return 0;
  // Strip markdown table pipes and headings; count word-ish tokens
  const cleaned = text
    .replace(/^\|.*\|$/gm, '') // table rows
    .replace(/^#+\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

/**
 * Rough page estimator:
 *   • 320 words per page of body copy
 *   • Each markdown table row counts as 18 words
 *   • Each H2/H3 heading counts as 30 words (chrome + breathing room)
 */
export function estimatePages(markdown: string): number {
  if (!markdown) return 0;
  const tableRows = (markdown.match(/^\|.*\|$/gm) ?? []).length;
  const h2 = (markdown.match(/^##\s+/gm) ?? []).length;
  const h3 = (markdown.match(/^###\s+/gm) ?? []).length;
  const words = countWords(markdown);
  const tableWordEquiv = tableRows * 18;
  const headingWordEquiv = (h2 + h3) * 30;
  return Math.max(1, Math.round((words + tableWordEquiv + headingWordEquiv) / 320));
}

function normalizeHeading(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findDefinition(
  heading: string,
  registry: CompassSectionDefinition[],
): CompassSectionDefinition | undefined {
  const target = normalizeHeading(heading);
  return registry.find(
    (s) =>
      normalizeHeading(s.name) === target ||
      s.sourceHeadings.some((sh) => normalizeHeading(sh) === target),
  );
}

// ─── Markdown section parser ────────────────────────────────────────────────

function parseSections(
  markdown: string,
  registry: CompassSectionDefinition[],
): { preamble: string[]; sections: ParsedSection[] } {
  const lines = markdown.split('\n');
  const preamble: string[] = [];
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+?)\s*$/);
    if (h2Match) {
      if (current) sections.push(current);
      const heading = h2Match[1].trim();
      current = {
        heading,
        bodyLines: [],
        def: findDefinition(heading, registry),
      };
    } else if (current) {
      current.bodyLines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);
  return { preamble, sections };
}

function serializeSections(
  preamble: string[],
  sections: ParsedSection[],
): string {
  const out: string[] = [...preamble];
  for (const s of sections) {
    out.push(`## ${s.heading}`);
    out.push(...s.bodyLines);
  }
  // Collapse 3+ blank lines to 2
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ─── Phase 5a: per-section word-cap enforcement ─────────────────────────────

/**
 * Trim a section's prose to a word cap, leaving everything that is not prose.
 *
 * The structural test is `isStructuralLine`, shared with the editorial strip,
 * and sharing it is the fix for a real defect. This function had its own
 * inline test covering blanks, tables, bullets and headings — but **not
 * `{{…}}` chart directives**, so a directive counted against the word budget
 * like a paragraph and was truncated mid-shortcode or dropped once the budget
 * ran out. It never showed up because nothing called this on a Compass report:
 * the caps were only enforced on the derived variants, which carry no
 * directives. Wiring the post-processor into the generator surfaced it
 * immediately — 6 of 48 figures lost on the first whole-report run.
 *
 * A truncated directive is worse than a long section twice over: the figure is
 * gone, and `{{bars: Yield 7.4, Grow…` is what lands on the page in its place.
 */
function truncateNarrativeToCap(bodyLines: string[], cap: number): { lines: string[]; removed: number } {
  const original = bodyLines.join('\n');
  const words = original.split(/\s+/).filter(Boolean);
  if (words.length <= cap) return { lines: bodyLines, removed: 0 };

  // Truncate cleanly or not at all. The first version kept every structural
  // line after the budget ran out and cut the last paragraph mid-clause with
  // a literal '…' — which shipped pages of headings with nothing under them
  // and eight sentences ending mid-thought, measured on a real client
  // document. Now: once the budget is spent, NOTHING further is kept —
  // structure included — a paragraph that does not fit whole is dropped
  // whole, and any headings left dangling at the tail (their content was cut)
  // are dropped with what they promised. Figures and tables still never cut a
  // line in half: they are structural, so they either fit before the budget
  // ends or go with everything after it.
  //
  // Two more rules, from the audit of 291 Stone Mason Drive (QA-33).
  //
  // **A block is the unit of a cut.** A list item and the sentences that
  // continue it, a paragraph, a table, a fenced callout — each is kept whole
  // or dropped whole. The second version charged a bullet's TITLE line
  // nothing (it was "structural") and its explanation on the next line
  // everything, so the cut landed between them: the audited Compass printed
  // "• Residential Property form aligned with local housing preferences" and
  // nothing under it. A bullet is narrative and is charged like one.
  //
  // **A sub-section keeps its share.** When a body carries two or more `###`
  // sub-headings the budget is divided between them in proportion to what
  // each held, so the first cannot spend the whole cap and leave the second
  // a heading over nothing — which is how "Strengths and Limitations" came to
  // print strengths and no limitations. A share a sub-section does not use
  // rolls forward to the next.
  //
  // After the budget is spent, DATA still survives: a chart directive or a
  // table is a figure, and the standing rule is that a label is stripped
  // with its paragraph but never a figure or a table. A heading survives the
  // cut only as the label of something kept under it.
  const blocks = narrativeBlocks(bodyLines);
  const groups: NarrativeBlock[][] = [[]];
  for (const b of blocks) {
    if (b.kind === 'heading' && groups[groups.length - 1].length) groups.push([b]);
    else groups[groups.length - 1].push(b);
  }
  const proseWords = (g: NarrativeBlock[]) => g.reduce((s, b) => s + b.words, 0);
  const totalProse = proseWords(blocks);
  const headed = groups.filter((g) => g[0]?.kind === 'heading').length;
  const shares = headed >= 2 && totalProse > 0
    ? groups.map((g) => Math.floor((cap * proseWords(g)) / totalProse))
    : null;

  const out: string[] = [];
  let removed = 0;
  let remaining = shares ? 0 : cap;
  const push = (b: NarrativeBlock) => { if (out.length) out.push(''); out.push(...b.lines); };

  groups.forEach((group, gi) => {
    if (shares) remaining += shares[gi];
    let pendingHeading: NarrativeBlock | null = null;
    let spent = false;
    for (const b of group) {
      if (b.kind === 'heading') { pendingHeading = b; continue; }
      const keep = b.kind === 'data' || (!spent && b.words <= remaining);
      if (!keep) {
        // The first block that does not fit ends this group's prose: a
        // later, shorter block kept after it would read as a cut mid-argument.
        spent = true;
        removed += b.words;
        continue;
      }
      if (pendingHeading) { push(pendingHeading); pendingHeading = null; }
      push(b);
      if (b.kind !== 'data') remaining -= b.words;
    }
    // A heading nothing followed is dropped with what it promised.
    if (pendingHeading) removed += pendingHeading.lines.join(' ').split(/\s+/).filter(Boolean).length;
    remaining = Math.max(0, remaining);
  });

  // A heading whose body was truncated away promises content the section no
  // longer holds. Pop structural tails until the last kept line is content.
  while (out.length) {
    const last = out[out.length - 1].trim();
    if (!last) { out.pop(); continue; }
    if (/^#{1,6}\s+\S/.test(last) || /^\*\*[^*]+\*\*:?\s*$/.test(last)) {
      removed += last.split(/\s+/).filter(Boolean).length;
      out.pop();
      continue;
    }
    break;
  }
  return { lines: out, removed };
}

type NarrativeBlockKind = 'heading' | 'data' | 'prose';

interface NarrativeBlock {
  kind: NarrativeBlockKind;
  lines: string[];
  /** Words charged against the budget — zero for a heading or a figure. */
  words: number;
}

const isListItemStart = (t: string): boolean => /^[-*+]\s+/.test(t) || /^\d+[.)]\s+/.test(t);
const isHorizontalRule = (t: string): boolean => /^(-{3,}|\*{3,}|_{3,})$/.test(t);
const startsDirective = (t: string): boolean => t.startsWith('{') && t.startsWith('{{');

/**
 * The body as blocks: a heading; a table (consecutive `|` lines); a chart
 * directive; a horizontal rule; a `:::` fence with everything to its close;
 * a list item with its continuation lines; a paragraph. Blank lines separate
 * blocks and belong to none.
 */
function narrativeBlocks(bodyLines: string[]): NarrativeBlock[] {
  const blocks: NarrativeBlock[] = [];
  const countWordsIn = (ls: string[]) => ls.join(' ').split(/\s+/).filter(Boolean).length;
  let i = 0;
  while (i < bodyLines.length) {
    const t = bodyLines[i].trim();
    if (t === '') { i += 1; continue; }
    if (t.startsWith('#')) { blocks.push({ kind: 'heading', lines: [bodyLines[i]], words: 0 }); i += 1; continue; }
    if (startsDirective(t) || isHorizontalRule(t)) { blocks.push({ kind: 'data', lines: [bodyLines[i]], words: 0 }); i += 1; continue; }
    if (t.startsWith('|')) {
      const ls: string[] = [];
      while (i < bodyLines.length && bodyLines[i].trim().startsWith('|')) ls.push(bodyLines[i++]);
      blocks.push({ kind: 'data', lines: ls, words: 0 });
      continue;
    }
    if (t.startsWith(':::')) {
      const ls = [bodyLines[i++]];
      while (i < bodyLines.length) {
        ls.push(bodyLines[i]);
        const closed = bodyLines[i].trim().startsWith(':::');
        i += 1;
        if (closed) break;
      }
      blocks.push({ kind: 'prose', lines: ls, words: countWordsIn(ls) });
      continue;
    }
    // A list item or a paragraph: the lines that continue it, until a blank
    // line or the start of another block.
    const ls = [bodyLines[i++]];
    while (i < bodyLines.length) {
      const n = bodyLines[i].trim();
      if (n === '' || n.startsWith('#') || startsDirective(n) || n.startsWith('|') || n.startsWith(':::') || isListItemStart(n) || isHorizontalRule(n)) break;
      ls.push(bodyLines[i++]);
    }
    blocks.push({ kind: 'prose', lines: ls, words: countWordsIn(ls) });
  }
  return blocks;
}

// ─── Phase 5b: editorial-block removal ──────────────────────────────────────
//
// The report must print none of EDITORIAL_LABELS. This is the code that makes
// that true, and it is code rather than prompt text for a measured reason: the
// v2.0 prompt said "at most one per section" twice and production carried 90 a
// report anyway. An instruction is a request; this is the guarantee.
//
// ## Matching all three forms
//
// The predecessor matched `^#{2,4} what this means$` and nothing else. Against
// 56 production reports that found **11 of 5,043 labels — 0.2%**, because the
// model overwhelmingly writes the bold form (4,161) rather than a heading
// (424) or a bare line (458). All three are matched here, and the label list
// itself lives in the registry so the QA validator checks exactly what this
// removes.
//
// ## What a label takes with it
//
// The label line and the prose paragraph under it. The paragraph is the point:
// the label alone is two words, and leaving its body would leave a restatement
// with no heading, which reads as an orphaned assertion rather than as nothing.
//
// It stops at the first structural line — a heading, a `{{…}}` figure
// directive, a table row, a list item or a rule. Those are the data. A strip
// that swallowed a figure would remove the thing the paragraph was talking
// about and keep nothing, which is strictly worse than the commentary.
//
// ## The inline form is different, and is kept
//
// `**Key takeaway:** Banora Point sits in a coastal growth corridor…` is a
// finding with a label in front of it, not a paragraph restating a table. The
// label comes off and the sentence stays. Blanket removal here would delete
// real content — the Final Recommendation writes its verdict this way.

const LABEL_ALTERNATION = EDITORIAL_LABELS
  .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

// The separator can fall on either side of the closing emphasis marker, and
// production writes it *inside*: `**Key takeaway:**`, not `**Key takeaway**:`.
// Both are accepted, along with no separator at all for the block form.
const CLOSE = `(?:[:：–—-]\\s*(?:\\*\\*|__)?|(?:\\*\\*|__)\\s*[:：–—-])`;

/** A line that is *only* a label: `**What This Means**`, `**Key takeaway:**`, `What to watch`. */
const EDITORIAL_LABEL_LINE_RE = new RegExp(
  `^\\s*(?:#{1,6}\\s*)?(?:\\*\\*|__)?\\s*(?:${LABEL_ALTERNATION})\\s*[:：–—-]?\\s*(?:\\*\\*|__)?\\s*[:：–—-]?\\s*$`,
  'i',
);

/**
 * A *heading* whose subject is a label — `### NPC view – overall recommendation`.
 *
 * Treated as the block form no matter what follows the dash. Production writes
 * a handful of these, and reading them as the inline form would drop the `###`
 * and leave "overall recommendation" as a stray line above the opinion it was
 * titling. A heading about the adviser's view is furniture, not a finding.
 */
const EDITORIAL_LABEL_HEADING_RE = new RegExp(
  `^\\s*#{1,6}\\s*(?:\\*\\*|__)?\\s*(?:${LABEL_ALTERNATION})\\b`,
  'i',
);

/**
 * A label followed by content on the same line — the label goes, the content stays.
 *
 * A separator is REQUIRED here, and that is what keeps ordinary prose safe:
 * "What this means for the tenant profile is covered below" has no separator
 * after the label, so it does not match and is left exactly as written.
 */
const EDITORIAL_LABEL_INLINE_RE = new RegExp(
  `^(\\s*)(?:#{1,6}\\s*)?(?:\\*\\*|__)?\\s*(?:${LABEL_ALTERNATION})\\s*${CLOSE}\\s*(\\S.*)$`,
  'i',
);

/** Lines the strip must never consume: they carry data, not commentary. */
function isStructuralLine(line: string): boolean {
  const t = line.trim();
  return (
    t === '' ||
    t.startsWith('#') ||
    t.startsWith('|') ||
    t.startsWith('{{') ||
    /^[-*+]\s+/.test(t) ||
    /^\d+[.)]\s+/.test(t) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(t) ||
    t.startsWith('>') ||
    t.startsWith(':::')
  );
}

export function stripEditorialBlocks(
  section: ParsedSection,
): { lines: string[]; removedBlocks: number; removedWords: number } {
  const out: string[] = [];
  let removedBlocks = 0;
  let removedWords = 0;

  let i = 0;
  while (i < section.bodyLines.length) {
    const line = section.bodyLines[i];

    // Block form is tested FIRST. `**What This Means:**` is a whole-line label,
    // but the inline pattern can also match it by treating the trailing `**` as
    // its content — which leaves a bare `**` on the page. Whole-line wins, and
    // so does a heading, whatever trails it.
    const isBlockLabel =
      EDITORIAL_LABEL_LINE_RE.test(line) || EDITORIAL_LABEL_HEADING_RE.test(line);

    if (!isBlockLabel) {
      // Inline: keep the sentence, drop the label.
      const inline = line.match(EDITORIAL_LABEL_INLINE_RE);
      if (inline) {
        out.push(`${inline[1]}${inline[2]}`);
        removedBlocks++;
        i++;
        continue;
      }
      out.push(line);
      i++;
      continue;
    }

    // Label on its own line: drop it and the prose paragraph beneath it.
    removedBlocks++;
    let j = i + 1;
    // A blank line between the label and its body is normal in the bold form.
    while (j < section.bodyLines.length && section.bodyLines[j].trim() === '') j++;
    while (j < section.bodyLines.length && !isStructuralLine(section.bodyLines[j])) {
      removedWords += countWords(section.bodyLines[j]);
      j++;
    }
    // Leave a paragraph break behind, or the block before the removal runs into
    // whatever followed it — a heading glued to a paragraph stops being a heading.
    if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
    i = j;
  }

  return { lines: out, removedBlocks, removedWords };
}

/** Does any editorial label survive in this markdown? Used by the QA validator. */
export function findEditorialLabels(markdown: string): string[] {
  const hits: string[] = [];
  for (const line of markdown.split('\n')) {
    if (
      EDITORIAL_LABEL_LINE_RE.test(line) ||
      EDITORIAL_LABEL_HEADING_RE.test(line) ||
      EDITORIAL_LABEL_INLINE_RE.test(line)
    ) {
      hits.push(line.trim());
    }
  }
  return hits;
}

// ─── Phase 5c: executive-summary cap ────────────────────────────────────────
//
// The id is `compass.executiveVerdict`. It was `compass.executiveSummary` here
// and in Phase 5b's caller, and that id has not existed since the v2.0 registry
// renamed the section — so this cap never fired once in its life. Two other
// trim steps had the same defect (`compass.economicContext`,
// `compass.suburbCharacter`); both are gone with the sections that absorbed them.

const EXECUTIVE_SECTION_ID = 'compass.executiveVerdict';

function capExecutiveSummary(section: ParsedSection, report: PostProcessReport): void {
  if (section.def?.id !== EXECUTIVE_SECTION_ID) return;
  const cap = COMPASS_WORD_CAPS.executiveSummaryTotal.max;
  const { lines, removed } = truncateNarrativeToCap(section.bodyLines, cap);
  if (removed > 0) {
    section.bodyLines = lines;
    report.sectionsTrimmed.push({
      sectionId: section.def.id,
      reason: `Executive Verdict exceeded ${cap}-word cap`,
      wordsRemoved: removed,
    });
  }
}

// ─── Phase 6: page-pressure trimming engine ─────────────────────────────────

const TRANSITION_RE =
  /^\s*(as we (move|turn|shift|look) (into|to|towards)|building on|with that in mind|having (covered|reviewed)|in summary so far)\b.*$/i;

function trimTransitions(sections: ParsedSection[]): number {
  let removed = 0;
  for (const s of sections) {
    if (s.def && PROTECTED_SECTION_IDS.has(s.def.id)) continue;
    const before = s.bodyLines.length;
    s.bodyLines = s.bodyLines.filter((l) => !TRANSITION_RE.test(l));
    removed += before - s.bodyLines.length;
  }
  return removed;
}

function capListsToTop5(sections: ParsedSection[]): number {
  let removedRows = 0;
  for (const s of sections) {
    if (s.def && PROTECTED_SECTION_IDS.has(s.def.id)) continue;
    // Cap bullet runs
    const out: string[] = [];
    let bulletRun = 0;
    for (const line of s.bodyLines) {
      if (/^\s*[-*]\s+/.test(line)) {
        bulletRun++;
        if (bulletRun <= 5) out.push(line);
        else removedRows++;
      } else {
        bulletRun = 0;
        out.push(line);
      }
    }
    // Cap table data rows (keep header + separator + first 5 rows)
    const tableCapped: string[] = [];
    let inTable = false;
    let tableDataRow = 0;
    for (let i = 0; i < out.length; i++) {
      const line = out[i];
      const isRow = /^\s*\|/.test(line);
      if (isRow) {
        if (!inTable) {
          inTable = true;
          tableDataRow = 0;
          tableCapped.push(line); // header
          continue;
        }
        // separator row
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) {
          tableCapped.push(line);
          continue;
        }
        tableDataRow++;
        if (tableDataRow <= 5) tableCapped.push(line);
        else removedRows++;
      } else {
        inTable = false;
        tableDataRow = 0;
        tableCapped.push(line);
      }
    }
    s.bodyLines = tableCapped;
  }
  return removedRows;
}

function reduceSectionToOnePage(
  sections: ParsedSection[],
  sectionId: string,
): number {
  const s = sections.find((x) => x.def?.id === sectionId);
  if (!s) return 0;
  const oneePageCap = 280; // ~one page of words
  const { lines, removed } = truncateNarrativeToCap(s.bodyLines, oneePageCap);
  s.bodyLines = lines;
  return removed;
}

function mergeDuplicateDemographics(sections: ParsedSection[]): number {
  // Keep only the first occurrence of any "Demographic" / "Employment" subsection inside non-protected sections.
  const seen = new Set<string>();
  let removed = 0;
  for (const s of sections) {
    if (s.def && PROTECTED_SECTION_IDS.has(s.def.id)) continue;
    const out: string[] = [];
    let i = 0;
    while (i < s.bodyLines.length) {
      const line = s.bodyLines[i];
      const h = line.match(/^###\s+(.+)$/);
      if (h && /(demograph|employment|workforce|seifa)/i.test(h[1])) {
        const key = normalizeHeading(h[1]);
        if (seen.has(key)) {
          // Skip until next ### or ##
          let j = i + 1;
          while (j < s.bodyLines.length && !/^#{2,3}\s+/.test(s.bodyLines[j])) {
            removed += countWords(s.bodyLines[j]);
            j++;
          }
          i = j;
          continue;
        }
        seen.add(key);
      }
      out.push(line);
      i++;
    }
    s.bodyLines = out;
  }
  return removed;
}

function applyPagePressureTrims(
  preamble: string[],
  sections: ParsedSection[],
  report: PostProcessReport,
): void {
  const targetMax = report.tier === 'compass-40' ? COMPASS_PAGE_BAND.max : 22;

  for (const step of PAGE_PRESSURE_TRIM_ORDER) {
    const currentMd = serializeSections(preamble, sections);
    const pages = estimatePages(currentMd);
    if (pages <= targetMax) return;

    let touched = 0;
    switch (step.id) {
      case 'transitions':
        touched = trimTransitions(sections);
        break;
      case 'capListsToTop5':
        touched = capListsToTop5(sections);
        break;
      case 'mergeDuplicateDemographics':
        touched = mergeDuplicateDemographics(sections);
        break;
      case 'moveListsToAppendix':
        // Conservative: same as capListsToTop5 second pass with cap=3
        touched = capListsToTop5(sections);
        break;
      case 'reduceDemandDrivers':
        touched = reduceSectionToOnePage(sections, 'compass.demandDrivers');
        break;
      case 'reduceAmenityAccess':
        touched = reduceSectionToOnePage(sections, 'compass.amenityAccess');
        break;
    }
    if (touched > 0) report.trimsApplied.push(step.id);
  }
}

// ─── Phase 5d: per-section narrative cap pass ───────────────────────────────

function applyPerSectionWordCaps(
  sections: ParsedSection[],
  report: PostProcessReport,
): void {
  for (const s of sections) {
    if (!s.def) continue;
    const cap = s.def.maxWordCount;
    if (!cap || cap <= 0) continue;
    const { lines, removed } = truncateNarrativeToCap(s.bodyLines, cap);
    if (removed > 0) {
      s.bodyLines = lines;
      report.sectionsTrimmed.push({
        sectionId: s.def.id,
        reason: `Exceeded section word cap (${cap})`,
        wordsRemoved: removed,
      });
    }
  }
}

// ─── Public entrypoint ──────────────────────────────────────────────────────

export interface PostProcessResult {
  markdown: string;
  report: PostProcessReport;
}

export function postProcessReportMarkdown(
  markdown: string,
  tier: PostProcessTier,
): PostProcessResult {
  const registry =
    tier === 'compass-40' ? COMPASS_40_SECTIONS : FINANCIAL_ANALYSIS_SECTIONS;

  const initialWordCount = countWords(markdown);
  const initialEstimatedPages = estimatePages(markdown);

  const report: PostProcessReport = {
    tier,
    initialWordCount,
    finalWordCount: initialWordCount,
    initialEstimatedPages,
    finalEstimatedPages: initialEstimatedPages,
    trimsApplied: [],
    sectionsTrimmed: [],
    warnings: [],
    editorialBlocksRemoved: 0,
    editorialWordsRemoved: 0,
    emptyStatCardsRemoved: 0,
    duplicateDirectivesRemoved: 0,
  };

  const parsed = parseSections(markdown, registry);
  const { sections } = parsed;
  let { preamble } = parsed;

  // Phase 5a — strip the editorial commentary blocks. Runs on every section,
  // matched or not: an unrecognised heading is still a client's page. The
  // preamble is included because the cover block sits above the first H2 and a
  // label there would survive a section-only pass.
  const strip = (heading: string, bodyLines: string[]): string[] => {
    const { lines, removedBlocks, removedWords } = stripEditorialBlocks({ heading, bodyLines });
    report.editorialBlocksRemoved += removedBlocks;
    report.editorialWordsRemoved += removedWords;
    if (removedBlocks > 0) {
      report.warnings.push(
        `Removed ${removedBlocks} editorial block(s) (${removedWords} words) from "${heading}".`,
      );
    }
    return lines;
  };

  preamble = strip('(preamble)', preamble);
  for (const s of sections) s.bodyLines = strip(s.heading, s.bodyLines);

  // Phase 5b — executive verdict hard cap (compass only)
  if (tier === 'compass-40') {
    const exec = sections.find((s) => s.def?.id === EXECUTIVE_SECTION_ID);
    if (exec) capExecutiveSummary(exec, report);
  }

  // Phase 5c — per-section narrative caps
  applyPerSectionWordCaps(sections, report);

  // Phase 6 — page-pressure trims
  applyPagePressureTrims(preamble, sections, report);

  // Phase 7 — a labelled block is a promise that a figure follows it.
  //
  // Runs LAST, on the assembled document, because a chart repeated across two
  // sections is only visible once the sections are one string again — and the
  // word and page counts below must describe what is actually stored.
  const serialized = serializeSections(preamble, sections);
  const scrubbed = scrubBlocks(serialized);
  report.emptyStatCardsRemoved = scrubbed.emptyStatCards;
  report.duplicateDirectivesRemoved = scrubbed.duplicateDirectives;

  const finalMarkdown = scrubbed.markdown;
  report.finalWordCount = countWords(finalMarkdown);
  report.finalEstimatedPages = estimatePages(finalMarkdown);

  return { markdown: finalMarkdown, report };
}

/**
 * Label-stripping alone, for documents that are not the Compass: the fork's
 * FIN/PLDD variants and the condensed Snapshot slice a PARENT whose legacy
 * generations carry "What This Means" blocks by the dozen, but their own
 * section lists are not the Compass registry's, so the full post-processor's
 * word caps and page-pressure trims must not touch them. Every section —
 * matched or not — is a client's page, which is the same rule the full pass
 * states above.
 */
export function stripEditorialLabelsFromMarkdown(markdown: string): {
  markdown: string;
  removedBlocks: number;
  removedWords: number;
} {
  const { preamble, sections } = parseSections(markdown, COMPASS_40_SECTIONS);
  let removedBlocks = 0;
  let removedWords = 0;

  const strip = (heading: string, bodyLines: string[]): string[] => {
    const r = stripEditorialBlocks({ heading, bodyLines });
    removedBlocks += r.removedBlocks;
    removedWords += r.removedWords;
    return r.lines;
  };

  const strippedPreamble = strip('(preamble)', preamble);
  for (const s of sections) s.bodyLines = strip(s.heading, s.bodyLines);

  return {
    markdown: serializeSections(strippedPreamble, sections),
    removedBlocks,
    removedWords,
  };
}
