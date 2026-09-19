/**
 * Report section chunker — turns the generated report body (`report_content`)
 * into the `sections.<sectionId>.{title,body,highlights}` binding data shape
 * that Cascade anchors and `{{sections.*}}` bindings consume.
 *
 * `report_content` is stored as one combined markdown string (the chunked
 * generation engine appends each section as `# Heading` + prose). The Cascade
 * contract (`contractFromStructureTemplate`) derives its section ids by
 * slugifying the headings of the active `report_structure_templates` guide, so
 * this module chunks the report markdown at headings and keys each chunk with
 * the *same* slugification — alias-matching report headings against the
 * structure headings when they differ cosmetically (numbering, "&" vs "and").
 *
 * Pure + renderer-agnostic. Mirrored for edge use in
 * `supabase/functions/_shared/reportSections.ts` — KEEP IN SYNC.
 */
import { slugifySectionId } from './cascadeMap';

export interface ReportSectionChunk {
  /** Clean section title (heading text without leading numbering). */
  title: string;
  /** Section prose as renderer-safe plain text (markdown stripped). */
  body: string;
  /** First bullet points of the section, as plain text. */
  highlights: string[];
  /** The raw markdown of the chunk (heading excluded) for rich consumers. */
  markdown: string;
}

export interface ChunkReportContentOptions {
  /**
   * Headings of the active report-structure template (as returned by
   * `extractStructureHeadings`). When provided, report headings are
   * alias-matched against these so chunk ids equal the Cascade contract ids.
   */
  structureHeadings?: string[];
  /** Max bullets captured per section (default 6). */
  maxHighlights?: number;
}

interface ParsedHeading {
  level: number;
  raw: string;
  index: number;
  contentStart: number;
}

/** Strip markdown emphasis/backticks the same way `extractStructureHeadings` does. */
function cleanHeadingText(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~>#]/g, '')
    .trim();
}

/** Drop leading numbering: "5. Foo", "5) Foo", "Section 5: Foo", "5 — Foo". */
export function stripHeadingNumbering(text: string): string {
  return text.replace(/^(section\s+)?\d+(\.\d+)*\s*([.):]|[-–—])?\s*/i, '').trim() || text.trim();
}

/** Normalised comparison key for alias-matching headings. */
function headingMatchKey(text: string): string {
  return stripHeadingNumbering(cleanHeadingText(text))
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseHeadings(markdown: string): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  const re = /^(#{1,4})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    headings.push({
      level: match[1].length,
      raw: match[2].trim(),
      index: match.index,
      contentStart: match.index + match[0].length,
    });
  }
  return headings;
}

/** True for lines that are only a legacy chart/visual directive, e.g. `{{bars: …}}`. */
function isDirectiveLine(line: string): boolean {
  return /^\s*\{\{[^}]*\}\}\s*$/.test(line);
}

/**
 * Convert a markdown chunk to plain text that renders cleanly through the
 * escaped `white-space:pre-wrap` text blocks/overlays (no raw `**`/`#`/pipes).
 */
export function markdownToPlainText(markdown: string): string {
  const lines = String(markdown || '').split(/\r?\n/);
  const out: string[] = [];
  let inFence = false;
  for (const rawLine of lines) {
    let line = rawLine;
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) { out.push(line); continue; }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) continue;
    if (isDirectiveLine(line)) continue;
    // Table separator rows (|---|---|) add nothing to prose.
    if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && /-/.test(line)) continue;
    // Table rows → cells joined with a separator.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length) out.push(cells.join(' · '));
      continue;
    }
    line = line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/^(\s*)[-*+]\s+/, '$1• ')
      .replace(/^(\s*)\d+\.\s+/, '$1• ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[(\d{1,3})\]/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // A sparkline directive is removed WHOLE, not unwrapped.
      //
      // The generator's prompt asks the model for `~~[3,5,8,13]~~` inline
      // sparklines "liberally". Unwrapping one leaves `[3,5,8,13]` — a bare
      // array of numbers inside a client's sentence, which is how 262 Pallas
      // Street printed one. Ordinary strikethrough still unwraps.
      .replace(/~~\[[\d.,\s+-]+\]~~/g, '')
      .replace(/~~([^~]+)~~/g, '$1');
    out.push(line.replace(/[ \t]+$/g, ''));
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractHighlights(markdown: string, max: number): string[] {
  const highlights: string[] = [];
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const m = /^\s*(?:[-*+]|\d+\.)\s+(.+)$/.exec(line);
    if (!m) continue;
    const text = markdownToPlainText(m[1]).replace(/^•\s*/, '').trim();
    if (text.length < 3) continue;
    highlights.push(text.length > 220 ? `${text.slice(0, 217)}…` : text);
    if (highlights.length >= max) break;
  }
  return highlights;
}

interface RawChunk {
  heading: string;
  markdown: string;
}

/** Split the combined report markdown into per-section raw chunks. */
function splitIntoChunks(markdown: string, structureKeys: Set<string>): RawChunk[] {
  const headings = parseHeadings(markdown);
  if (!headings.length) return markdown.trim() ? [{ heading: '', markdown }] : [];

  // Prefer boundaries that match the configured structure headings; fall back
  // to top-level headings (# / ##) when the structure isn't available or the
  // report uses its own heading scheme.
  let boundaries = structureKeys.size
    ? headings.filter((h) => structureKeys.has(headingMatchKey(h.raw)))
    : [];
  if (boundaries.length < 2) {
    const minLevel = Math.min(...headings.map((h) => h.level));
    boundaries = headings.filter((h) => h.level === minLevel);
  }
  if (!boundaries.length) boundaries = headings;

  const chunks: RawChunk[] = [];
  const preamble = markdown.slice(0, boundaries[0].index).trim();
  if (preamble.replace(/[-\s#*_]/g, '').length >= 40) {
    chunks.push({ heading: 'Overview', markdown: preamble });
  }
  boundaries.forEach((boundary, i) => {
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : markdown.length;
    chunks.push({
      heading: cleanHeadingText(boundary.raw),
      markdown: markdown.slice(boundary.contentStart, end).trim(),
    });
  });
  return chunks;
}

/**
 * Chunk generated report content into `sections.*` binding data.
 *
 * - Object input (future structured storage) passes through unchanged.
 * - String input is chunked at section headings; each chunk is keyed by the
 *   slug of the matching structure heading when one exists (so ids line up
 *   with the Cascade contract), else by the slug of its own heading.
 */
export function chunkReportContent(
  reportContent: unknown,
  opts: ChunkReportContentOptions = {},
): Record<string, ReportSectionChunk | unknown> {
  if (reportContent && typeof reportContent === 'object') return { ...(reportContent as Record<string, unknown>) };
  if (typeof reportContent !== 'string' || !reportContent.trim()) return {};

  const maxHighlights = opts.maxHighlights ?? 6;
  const structureHeadings = opts.structureHeadings ?? [];
  const structureByKey = new Map<string, string>();
  for (const heading of structureHeadings) {
    const key = headingMatchKey(heading);
    if (key && !structureByKey.has(key)) structureByKey.set(key, heading);
  }

  const chunks = splitIntoChunks(reportContent, new Set(structureByKey.keys()));
  const sections: Record<string, ReportSectionChunk> = {};
  const usedIds = new Map<string, number>();

  chunks.forEach((chunk, index) => {
    const heading = chunk.heading || `Section ${index + 1}`;
    const structureHeading = structureByKey.get(headingMatchKey(heading));
    // Contract ids slugify the structure heading as written (numbering kept),
    // so prefer that exact source text when the headings alias-match.
    const base = slugifySectionId(structureHeading ?? heading, `section_${index + 1}`);
    const count = usedIds.get(base) ?? 0;
    usedIds.set(base, count + 1);
    const id = count ? `${base}_${count + 1}` : base;
    sections[id] = {
      title: stripHeadingNumbering(heading),
      body: markdownToPlainText(chunk.markdown),
      highlights: extractHighlights(chunk.markdown, maxHighlights),
      markdown: chunk.markdown,
    };
  });

  return sections;
}
