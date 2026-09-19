/**
 * docx-text-v1 — structural Word (.docx) → text extraction.
 *
 * Replaces three separate hand-rolled DOCX readers that each lost different
 * content:
 *
 *   - a regex tag-stripper that decoded `&amp;` *before* `&lt;`, so a literal
 *     `&amp;lt;` in the source silently became `<`, and that flattened every
 *     table to a single unbroken run of cell text with no row or column
 *     structure at all;
 *   - readers that only opened `word/document.xml`, dropping headers, footers,
 *     footnotes, endnotes and every text box on the page;
 *   - readers that walked `w:r` children directly, which silently discarded
 *     *accepted tracked-change insertions* (`w:ins`) — text the author had
 *     already accepted, missing from the extraction — while happily including
 *     field instruction codes (`w:instrText`) as if they were prose.
 *
 * Output is markdown-ish: heading levels from Word's heading styles, `-`/`1.`
 * list markers with indentation from the numbering level, and pipe tables with
 * a header separator. That structure is what the checklist/template importers
 * and the RAG chunker key off, and what an LLM needs to attribute a value to
 * its label.
 */
import { normalizeDocumentText } from './textHygiene';

/** WordprocessingML elements whose *children* are runs we must descend into. */
const RUN_CONTAINERS = new Set(['hyperlink', 'ins', 'smartTag', 'sdtContent', 'sdt', 'bookmarkStart', 'moveTo']);

/** Elements whose entire subtree is excluded from the extracted text. */
const EXCLUDED_SUBTREES = new Set(['del', 'moveFrom', 'rPrChange', 'pPrChange', 'commentRangeStart', 'commentReference']);

export interface DocxTextOptions {
  /** Emit `#`-prefixed markdown headings for Word heading styles. Default true. */
  markdownHeadings?: boolean;
  /** Render tables as pipe tables. When false, cells are joined with tabs. Default true. */
  markdownTables?: boolean;
  /** Include headers, footers, footnotes and endnotes. Default true. */
  includeAuxiliaryParts?: boolean;
  /** Maximum characters to return (boundary-aware). Default unlimited. */
  maxChars?: number;
}

interface Block {
  kind: 'heading' | 'paragraph' | 'list' | 'table';
  text: string;
}

function localName(node: Element): string {
  return node.localName || node.nodeName.replace(/^.*:/, '');
}

function attr(node: Element, name: string): string | null {
  for (let i = 0; i < node.attributes.length; i += 1) {
    const item = node.attributes[i]!;
    if ((item.localName || item.name.replace(/^.*:/, '')) === name) return item.value;
  }
  return null;
}

function childrenNamed(parent: Element, name: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.children.length; i += 1) {
    const child = parent.children[i]!;
    if (localName(child) === name) out.push(child);
  }
  return out;
}

function firstNamed(parent: Element, name: string): Element | null {
  return childrenNamed(parent, name)[0] ?? null;
}

/** Heading level from a Word paragraph style id, or 0 when not a heading. */
export function headingLevelForStyle(styleId: string | null | undefined): number {
  if (!styleId) return 0;
  const id = styleId.trim();
  if (/^title$/i.test(id)) return 1;
  if (/^subtitle$/i.test(id)) return 2;
  // `Heading1`, `heading 1`, and the localised ids Word emits for non-English UIs.
  const match = /^(?:heading|berschrift|titre|rubrik|kop|encabezado|titolo)\s*(\d)/i.exec(id);
  if (match) return Math.min(6, Math.max(1, Number(match[1])));
  return 0;
}

/** Collect the visible text of a run container, honouring breaks and tabs. */
function readRuns(container: Element): string {
  let text = '';

  const visit = (node: Element) => {
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i]!;
      const name = localName(child);

      if (EXCLUDED_SUBTREES.has(name)) continue;
      if (RUN_CONTAINERS.has(name)) { visit(child); continue; }

      if (name === 'r') {
        for (let j = 0; j < child.children.length; j += 1) {
          const part = child.children[j]!;
          const partName = localName(part);
          if (EXCLUDED_SUBTREES.has(partName)) continue;
          switch (partName) {
            case 't':
              text += part.textContent ?? '';
              break;
            case 'br':
            case 'cr':
              text += '\n';
              break;
            case 'tab':
              text += '\t';
              break;
            case 'noBreakHyphen':
              text += '-';
              break;
            case 'sym': {
              // Symbol fonts encode the glyph in a hex char code.
              const code = attr(part, 'char');
              const point = code ? Number.parseInt(code, 16) : NaN;
              if (Number.isFinite(point) && point > 0x20) text += String.fromCharCode(point);
              break;
            }
            case 'drawing':
            case 'pict':
            case 'object':
              // Text boxes carry real prose; images contribute nothing here.
              for (const box of Array.from(part.getElementsByTagName('*'))) {
                if (localName(box) === 'txbxContent') visit(box);
              }
              break;
            default:
              // `instrText`, `fldChar`, `delText`, `rPr` and friends are metadata.
              break;
          }
        }
        continue;
      }

      // Nested paragraphs (inside a text box) keep their own line break.
      if (name === 'p') {
        const nested = readRuns(child).trim();
        if (nested) text += (text && !text.endsWith('\n') ? '\n' : '') + nested;
      }
    }
  };

  visit(container);
  return text;
}

function paragraphStyle(p: Element): { styleId: string | null; listLevel: number | null; ordered: boolean } {
  const pPr = firstNamed(p, 'pPr');
  if (!pPr) return { styleId: null, listLevel: null, ordered: false };
  const pStyle = firstNamed(pPr, 'pStyle');
  const numPr = firstNamed(pPr, 'numPr');
  let listLevel: number | null = null;
  if (numPr) {
    const ilvl = firstNamed(numPr, 'ilvl');
    const raw = ilvl ? Number(attr(ilvl, 'val')) : 0;
    listLevel = Number.isFinite(raw) ? Math.max(0, Math.min(8, raw)) : 0;
  }
  const styleId = pStyle ? attr(pStyle, 'val') : null;
  // Word does not record ordered-ness on the paragraph; `ListNumber`/`ListParagraph`
  // with a decimal style id is the only reliable in-document hint without
  // resolving numbering.xml, so default to unordered and let the marker be `-`.
  const ordered = /^(?:ListNumber|ListParagraphNumber)/i.test(styleId ?? '');
  return { styleId, listLevel, ordered };
}

function renderParagraph(p: Element, options: Required<Pick<DocxTextOptions, 'markdownHeadings'>>): Block | null {
  const raw = readRuns(p);
  const text = raw.replace(/[ \t]+$/gm, '').trim();
  if (!text) return null;

  const { styleId, listLevel, ordered } = paragraphStyle(p);
  const level = headingLevelForStyle(styleId);

  if (level > 0) {
    return {
      kind: 'heading',
      text: options.markdownHeadings ? `${'#'.repeat(level)} ${text.replace(/\n+/g, ' ')}` : text,
    };
  }
  if (listLevel != null) {
    const indent = '  '.repeat(listLevel);
    const marker = ordered ? '1.' : '-';
    return { kind: 'list', text: `${indent}${marker} ${text.replace(/\n+/g, ' ')}` };
  }
  return { kind: 'paragraph', text };
}

/** Direct child paragraphs and nested tables of a table cell, flattened. */
function renderCell(tc: Element, markdownTables: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < tc.children.length; i += 1) {
    const child = tc.children[i]!;
    const name = localName(child);
    if (name === 'p') {
      const text = readRuns(child).replace(/\s+/g, ' ').trim();
      if (text) parts.push(text);
    } else if (name === 'tbl') {
      // A nested table is flattened rather than dropped.
      const nested = renderTable(child, false);
      if (nested) parts.push(nested.replace(/\n/g, ' / '));
    }
  }
  const joined = parts.join(' ');
  // A literal pipe would break the surrounding markdown table.
  return markdownTables ? joined.replace(/\|/g, '\\|') : joined;
}

function gridSpan(tc: Element): number {
  const tcPr = firstNamed(tc, 'tcPr');
  const span = tcPr ? firstNamed(tcPr, 'gridSpan') : null;
  const value = span ? Number(attr(span, 'val')) : 1;
  return Number.isFinite(value) && value > 1 ? Math.min(64, Math.floor(value)) : 1;
}

function isHeaderRow(tr: Element): boolean {
  const trPr = firstNamed(tr, 'trPr');
  return !!(trPr && firstNamed(trPr, 'tblHeader'));
}

function renderTable(tbl: Element, markdownTables: boolean): string {
  const rows: { cells: string[]; header: boolean }[] = [];

  for (const tr of childrenNamed(tbl, 'tr')) {
    const cells: string[] = [];
    for (const tc of childrenNamed(tr, 'tc')) {
      const text = renderCell(tc, markdownTables);
      cells.push(text);
      // A horizontally merged cell occupies several grid columns; pad so the
      // columns of every row still line up with each other.
      for (let i = 1; i < gridSpan(tc); i += 1) cells.push('');
    }
    if (cells.some((cell) => cell)) rows.push({ cells, header: isHeaderRow(tr) });
  }

  if (!rows.length) return '';

  if (!markdownTables) {
    return rows.map((row) => row.cells.join('\t')).join('\n');
  }

  const width = Math.max(...rows.map((row) => row.cells.length));
  const pad = (cells: string[]) => {
    const padded = cells.slice(0, width);
    while (padded.length < width) padded.push('');
    return `| ${padded.join(' | ')} |`;
  };

  const out: string[] = [];
  // Treat an explicit `tblHeader` row — or, failing that, the first row — as the
  // header so the table reads correctly as markdown.
  const headerCount = rows.filter((row) => row.header).length || 1;
  rows.forEach((row, index) => {
    out.push(pad(row.cells));
    if (index === headerCount - 1 && rows.length > headerCount) {
      out.push(`|${' --- |'.repeat(width)}`);
    }
  });
  return out.join('\n');
}

function blocksToText(blocks: Block[]): string {
  const out: string[] = [];
  let previous: Block | null = null;
  for (const block of blocks) {
    // Consecutive list items stay together; everything else gets a blank line.
    if (previous && !(previous.kind === 'list' && block.kind === 'list')) out.push('');
    out.push(block.text);
    previous = block;
  }
  return out.join('\n');
}

/**
 * Convert the XML of one WordprocessingML part (`document.xml`, a header, a
 * footnotes part …) into structured text.
 */
export function docxPartXmlToText(xml: string, options: DocxTextOptions = {}): string {
  const markdownHeadings = options.markdownHeadings ?? true;
  const markdownTables = options.markdownTables ?? true;

  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return '';

  const root =
    Array.from(doc.getElementsByTagName('*')).find((el) =>
      ['body', 'footnotes', 'endnotes', 'hdr', 'ftr'].includes(localName(el)),
    ) ?? doc.documentElement;
  if (!root) return '';

  const blocks: Block[] = [];

  const walk = (parent: Element) => {
    for (let i = 0; i < parent.children.length; i += 1) {
      const child = parent.children[i]!;
      const name = localName(child);
      if (name === 'p') {
        const block = renderParagraph(child, { markdownHeadings });
        if (block) blocks.push(block);
      } else if (name === 'tbl') {
        const text = renderTable(child, markdownTables);
        if (text) blocks.push({ kind: 'table', text });
      } else if (name === 'sdt' || name === 'sdtContent' || name === 'footnote' || name === 'endnote') {
        // Content controls and note bodies wrap ordinary block content.
        walk(child);
      }
    }
  };

  walk(root);
  return blocksToText(blocks);
}

/** Word part paths, in the order they should appear in the extracted text. */
function orderAuxiliaryParts(paths: string[]): string[] {
  const rank = (path: string) => {
    if (/header\d*\.xml$/i.test(path)) return 0;
    if (/footnotes\.xml$/i.test(path)) return 2;
    if (/endnotes\.xml$/i.test(path)) return 3;
    return 1; // footers
  };
  return [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Extract readable text from a `.docx` file.
 *
 * Reads the main document body plus (by default) headers, footers, footnotes
 * and endnotes — parts that carry the disclaimers, page furniture and source
 * attributions that downstream extraction genuinely needs.
 */
export async function extractDocxText(
  file: Blob | ArrayBuffer,
  options: DocxTextOptions = {},
): Promise<string> {
  const { includeAuxiliaryParts = true, maxChars } = options;
  const JSZip = (await import('jszip')).default;
  const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const mainPath = ['word/document.xml', 'word/document2.xml'].find((path) => zip.file(path));
  if (!mainPath) {
    throw new Error('This .docx has no readable document body (word/document.xml is missing).');
  }

  const sections: string[] = [];
  const main = docxPartXmlToText(await zip.file(mainPath)!.async('string'), options);
  if (main) sections.push(main);

  if (includeAuxiliaryParts) {
    const auxiliary = Object.keys(zip.files).filter((path) =>
      /^word\/(?:header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(path),
    );
    const seen = new Set<string>();
    for (const path of orderAuxiliaryParts(auxiliary)) {
      const text = docxPartXmlToText(await zip.file(path)!.async('string'), options).trim();
      // Headers/footers repeat on every section; emit each distinct one once.
      if (!text || seen.has(text)) continue;
      seen.add(text);
      sections.push(text);
    }
  }

  const combined = normalizeDocumentText(sections.filter(Boolean).join('\n\n'));
  if (maxChars && combined.length > maxChars) {
    const { truncateOnBoundary } = await import('./textHygiene');
    return truncateOnBoundary(combined, maxChars).text;
  }
  return combined;
}
