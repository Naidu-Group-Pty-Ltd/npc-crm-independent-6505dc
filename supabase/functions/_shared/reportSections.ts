/**
 * Edge mirror of src/lib/reportTemplate/reportSections.ts (+ the small
 * cascadeMap helpers it relies on). KEEP IN SYNC.
 *
 * Chunks a combined `report_content` markdown string into the
 * `sections.<sectionId>.{title,body,highlights}` binding data shape that
 * Cascade anchors and `{{sections.*}}` bindings consume, keying chunks with
 * the same slugification the Cascade contract uses and alias-matching report
 * headings against the active report-structure template headings.
 */

export interface ReportSectionChunk {
  title: string;
  body: string;
  highlights: string[];
  markdown: string;
}

export interface ChunkReportContentOptions {
  structureHeadings?: string[];
  maxHighlights?: number;
}

/** Mirror of cascadeMap.slugifySectionId. */
export function slugifySectionId(value: string, fallback = 'section'): string {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

/** Mirror of cascadeMap.extractStructureHeadings. */
export function extractStructureHeadings(markdown = ''): string[] {
  const headings: string[] = [];
  const seen = new Set<string>();
  const re = /^(#{1,4})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const text = match[2]
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_~>#]/g, '')
      .trim();
    if (text.length < 3) continue;
    const normalized = text.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    headings.push(text);
  }
  return headings;
}

export interface ReportStructureTemplateLike {
  id?: string | null;
  name?: string | null;
  parsed_content?: string | null;
  report_tier?: string | null;
  report_category?: string | null;
  priority?: number | null;
}

/** Mirror of cascadeMap.selectStructureTemplate. */
export function selectStructureTemplate(
  rows: ReportStructureTemplateLike[] = [],
  opts: { tier?: string | null; category?: string | null } = {},
): ReportStructureTemplateLike | null {
  const active = [...rows].sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0));
  const tier = opts.tier || null;
  const category = opts.category || null;
  return active.find((t) => t.report_tier === tier && t.report_category === category)
    ?? active.find((t) => t.report_tier === tier && !t.report_category)
    ?? active.find((t) => !t.report_tier && t.report_category === category)
    ?? active.find((t) => !t.report_tier && !t.report_category)
    ?? active[0]
    ?? null;
}

interface ParsedHeading {
  level: number;
  raw: string;
  index: number;
  contentStart: number;
}

function cleanHeadingText(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~>#]/g, '')
    .trim();
}

export function stripHeadingNumbering(text: string): string {
  return text.replace(/^(section\s+)?\d+(\.\d+)*\s*([.):]|[-–—])?\s*/i, '').trim() || text.trim();
}

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

function isDirectiveLine(line: string): boolean {
  return /^\s*\{\{[^}]*\}\}\s*$/.test(line);
}

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
    if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && /-/.test(line)) continue;
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

function splitIntoChunks(markdown: string, structureKeys: Set<string>): RawChunk[] {
  const headings = parseHeadings(markdown);
  if (!headings.length) return markdown.trim() ? [{ heading: '', markdown }] : [];

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
