/**
 * Office/document → HTML conversion for the "Start from a reference" import.
 *
 * Lets users drop a Word document (or plain-text/RTF file) and have it
 * replicated onto the Template Builder canvas: the document is converted to
 * semantic HTML here, then routed through the existing C1 code-import
 * pipeline (render → measure DOM → CDIR editable pages), so everything
 * downstream — grounding, fidelity checks, trace rasters — works unchanged.
 *
 * DOCX parsing is dependency-free: JSZip (already a dependency) unpacks the
 * archive and DOMParser reads `word/document.xml`. Coverage is deliberately
 * pragmatic — paragraphs, heading styles, bold/italic/underline runs, lists,
 * tables, hyperlinks, and embedded images (inlined as data: URLs).
 */
import JSZip from 'jszip';

export type DocumentKind = 'docx' | 'doc' | 'txt' | 'rtf';

export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

const DOCX_MIME = /officedocument\.wordprocessingml\.document/i;
const DOC_MIME = /^application\/msword$/i;
const RTF_MIME = /^(application|text)\/rtf$/i;
const TXT_MIME = /^text\/plain$/i;

/** Classify a document file the reference import can convert (null = not a document). */
export function documentKindForFile(file: { name?: string; type?: string } | null | undefined): DocumentKind | null {
  if (!file) return null;
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (/\.docx$/.test(name) || DOCX_MIME.test(type)) return 'docx';
  if (/\.doc$/.test(name) || DOC_MIME.test(type)) return 'doc';
  if (/\.rtf$/.test(name) || RTF_MIME.test(type)) return 'rtf';
  if (/\.txt$/.test(name) || (TXT_MIME.test(type) && /\.txt$/.test(name))) return 'txt';
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const PAGE_STYLE = 'margin:0;background:#fff;color:#1a1a1a;font-family:Calibri,Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.5;padding:56px 64px;max-width:794px';

function wrapDocumentHtml(bodyHtml: string, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{${PAGE_STYLE}}h1{font-size:28px;margin:0 0 14px}h2{font-size:22px;margin:22px 0 10px}h3{font-size:18px;margin:18px 0 8px}h4{font-size:16px;margin:16px 0 8px}p{font-size:14px;margin:0 0 10px}li{font-size:14px;margin:0 0 4px}table{border-collapse:collapse;margin:0 0 12px;width:100%}td,th{border:1px solid #cbd5e1;padding:6px 8px;font-size:13px;text-align:left;vertical-align:top}img{max-width:100%;height:auto}</style></head><body>${bodyHtml}</body></html>`;
}

// ─── DOCX ──────────────────────────────────────────────────────────────────────

function childrenByLocalName(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter((el) => el.localName === name);
}

function firstByLocalName(parent: Element, name: string): Element | null {
  return childrenByLocalName(parent, name)[0] ?? null;
}

function descendantsByLocalName(parent: Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagName('*')).filter((el) => el.localName === name);
}

function attrByLocalName(el: Element, name: string): string | null {
  for (const attr of Array.from(el.attributes)) {
    if (attr.localName === name) return attr.value;
  }
  return null;
}

function mimeForImagePath(path: string): string {
  const ext = path.toLowerCase().slice(path.lastIndexOf('.') + 1);
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'emf' || ext === 'wmf') return '';
  return 'image/png';
}

interface DocxContext {
  /** relationship id → data: URL for embedded media (empty when unresolvable). */
  media: Map<string, string>;
}

/**
 * Resolves whether a `w:numPr` refers to a numbered or a bulleted list.
 *
 * Word records only `numId` + `ilvl` on the paragraph; the actual format lives
 * in `word/numbering.xml`, so without this every list — numbered ones included —
 * was imported as a `<ul>`.
 */
class NumberingIndex {
  /** `${numId}:${ilvl}` → true when the level uses a counting format. */
  private readonly ordered = new Map<string, boolean>();

  constructor(entries: Iterable<[string, boolean]> = []) {
    for (const [key, value] of entries) this.ordered.set(key, value);
  }

  isOrdered(numId: string | null, level: number): boolean {
    if (!numId) return false;
    return this.ordered.get(`${numId}:${level}`) ?? this.ordered.get(`${numId}:0`) ?? false;
  }
}

const BULLET_FORMATS = new Set(['bullet', 'none']);

async function loadNumberingIndex(zip: JSZip): Promise<NumberingIndex> {
  const file = zip.file('word/numbering.xml');
  if (!file) return new NumberingIndex();
  try {
    const xml = new DOMParser().parseFromString(await file.async('text'), 'application/xml');
    const all = Array.from(xml.getElementsByTagName('*'));

    // abstractNumId → (ilvl → ordered)
    const abstractLevels = new Map<string, Map<number, boolean>>();
    for (const abstract of all.filter((el) => el.localName === 'abstractNum')) {
      const abstractId = attrByLocalName(abstract, 'abstractNumId');
      if (!abstractId) continue;
      const levels = new Map<number, boolean>();
      for (const lvl of descendantsByLocalName(abstract, 'lvl')) {
        const ilvl = Number(attrByLocalName(lvl, 'ilvl') ?? 0);
        const numFmt = firstByLocalName(lvl, 'numFmt');
        const format = (numFmt ? attrByLocalName(numFmt, 'val') : null) ?? 'bullet';
        levels.set(Number.isFinite(ilvl) ? ilvl : 0, !BULLET_FORMATS.has(format.toLowerCase()));
      }
      abstractLevels.set(abstractId, levels);
    }

    const entries: [string, boolean][] = [];
    for (const num of all.filter((el) => el.localName === 'num')) {
      const numId = attrByLocalName(num, 'numId');
      const abstractRef = firstByLocalName(num, 'abstractNumId');
      const abstractId = abstractRef ? attrByLocalName(abstractRef, 'val') : null;
      if (!numId || !abstractId) continue;
      for (const [ilvl, ordered] of abstractLevels.get(abstractId) ?? []) {
        entries.push([`${numId}:${ilvl}`, ordered]);
      }
    }
    return new NumberingIndex(entries);
  } catch {
    // Numbering is a presentation detail; falling back to bullets is safe.
    return new NumberingIndex();
  }
}

function headingTagForStyle(styleVal: string | null): string | null {
  if (!styleVal) return null;
  if (/^title$/i.test(styleVal)) return 'h1';
  const m = /^heading\s*(\d)/i.exec(styleVal) ?? /^berschrift(\d)/i.exec(styleVal);
  if (m) return `h${Math.min(4, Math.max(1, Number(m[1])))}`;
  return null;
}

/** `w:*` wrappers whose children are runs we must descend into. */
const RUN_WRAPPERS = new Set(['hyperlink', 'ins', 'smartTag', 'sdt', 'sdtContent', 'moveTo']);

/** Wrappers whose whole subtree is excluded (rejected/moved-away revisions). */
const REVISION_EXCLUSIONS = new Set(['del', 'moveFrom']);

/** A `w:rPr` toggle is on unless it carries an explicit off value. */
function toggleOn(rPr: Element | null, name: string): boolean {
  if (!rPr) return false;
  const el = firstByLocalName(rPr, name);
  if (!el) return false;
  const val = attrByLocalName(el, 'val');
  return val !== 'false' && val !== '0' && val !== 'none';
}

function renderDocxRuns(container: Element, ctx: DocxContext): string {
  let html = '';
  for (const child of Array.from(container.children)) {
    const name = child.localName ?? '';
    // Tracked-change *insertions* wrap their runs in `w:ins`; the previous
    // `localName !== 'r'` skip silently dropped that text, so an accepted edit
    // was missing from the imported document.
    if (RUN_WRAPPERS.has(name)) {
      html += renderDocxRuns(child, ctx);
      continue;
    }
    if (REVISION_EXCLUSIONS.has(name)) continue;
    if (name !== 'r') continue;

    const rPr = firstByLocalName(child, 'rPr');
    const bold = toggleOn(rPr, 'b');
    const italic = toggleOn(rPr, 'i');
    const underline = toggleOn(rPr, 'u');
    const strike = toggleOn(rPr, 'strike') || toggleOn(rPr, 'dstrike');
    const vertAlign = rPr ? attrByLocalName(firstByLocalName(rPr, 'vertAlign') ?? rPr, 'val') : null;

    let runHtml = '';
    for (const part of Array.from(child.children)) {
      const partName = part.localName ?? '';
      if (partName === 't') runHtml += escapeHtml(part.textContent ?? '');
      else if (partName === 'br' || partName === 'cr') runHtml += '<br />';
      else if (partName === 'tab') runHtml += '&emsp;';
      else if (partName === 'noBreakHyphen') runHtml += '-';
      else if (partName === 'sym') {
        const code = attrByLocalName(part, 'char');
        const point = code ? Number.parseInt(code, 16) : Number.NaN;
        if (Number.isFinite(point) && point > 0x20) runHtml += escapeHtml(String.fromCharCode(point));
      } else if (partName === 'drawing' || partName === 'pict') {
        for (const blip of descendantsByLocalName(part, 'blip')) {
          const rel = attrByLocalName(blip, 'embed') ?? attrByLocalName(blip, 'link');
          const src = rel ? ctx.media.get(rel) : undefined;
          if (src) runHtml += `<img src="${src}" alt="" />`;
        }
        // A text box carries real prose, not just an image.
        for (const box of descendantsByLocalName(part, 'txbxContent')) {
          for (const p of descendantsByLocalName(box, 'p')) {
            const inner = renderDocxRuns(p, ctx).trim();
            if (inner) runHtml += `<p>${inner}</p>`;
          }
        }
      }
      // `instrText`, `fldChar`, `delText` and `rPr` are metadata, not content.
    }
    if (!runHtml) continue;
    if (bold) runHtml = `<strong>${runHtml}</strong>`;
    if (italic) runHtml = `<em>${runHtml}</em>`;
    if (underline) runHtml = `<u>${runHtml}</u>`;
    if (strike) runHtml = `<s>${runHtml}</s>`;
    if (vertAlign === 'superscript') runHtml = `<sup>${runHtml}</sup>`;
    else if (vertAlign === 'subscript') runHtml = `<sub>${runHtml}</sub>`;
    html += runHtml;
  }
  return html;
}

interface DocxBlock {
  kind: 'paragraph' | 'list-item' | 'heading' | 'table';
  tag?: string;
  html: string;
  /** `w:ilvl` for list items — drives nesting. */
  level?: number;
  /** True when the item belongs to a numbered list. */
  ordered?: boolean;
}

function renderDocxParagraph(p: Element, ctx: DocxContext, numbering: NumberingIndex): DocxBlock | null {
  const pPr = firstByLocalName(p, 'pPr');
  // Only read `w:val` from an actual `w:pStyle`. The previous `?? p` fallback
  // read the paragraph's own `val` attribute, which is a different thing.
  const pStyle = pPr ? firstByLocalName(pPr, 'pStyle') : null;
  const styleVal = pStyle ? attrByLocalName(pStyle, 'val') : null;
  const headingTag = headingTagForStyle(styleVal);
  const numPr = pPr ? firstByLocalName(pPr, 'numPr') : null;
  const inner = renderDocxRuns(p, ctx).trim();
  if (!inner) return null;
  if (headingTag) return { kind: 'heading', tag: headingTag, html: inner };
  if (numPr) {
    const ilvl = firstByLocalName(numPr, 'ilvl');
    const numId = firstByLocalName(numPr, 'numId');
    const level = Math.max(0, Math.min(8, Number(ilvl ? attrByLocalName(ilvl, 'val') : 0) || 0));
    const id = numId ? attrByLocalName(numId, 'val') : null;
    return { kind: 'list-item', html: inner, level, ordered: numbering.isOrdered(id, level) };
  }
  return { kind: 'paragraph', html: inner };
}

/** Horizontal merge width of a cell (`w:gridSpan`). */
function cellGridSpan(tc: Element): number {
  const tcPr = firstByLocalName(tc, 'tcPr');
  const span = tcPr ? firstByLocalName(tcPr, 'gridSpan') : null;
  const value = Number(span ? attrByLocalName(span, 'val') : 1);
  return Number.isFinite(value) && value > 1 ? Math.min(64, Math.floor(value)) : 1;
}

/** `restart` opens a vertically merged run; `continue` (or empty) extends it. */
function cellVerticalMerge(tc: Element): 'restart' | 'continue' | null {
  const tcPr = firstByLocalName(tc, 'tcPr');
  const merge = tcPr ? firstByLocalName(tcPr, 'vMerge') : null;
  if (!merge) return null;
  return attrByLocalName(merge, 'val') === 'restart' ? 'restart' : 'continue';
}

function renderCellContent(tc: Element, ctx: DocxContext, numbering: NumberingIndex): string {
  const parts: string[] = [];
  for (const child of Array.from(tc.children)) {
    if (child.localName === 'p') {
      const html = renderDocxRuns(child, ctx).trim();
      if (html) parts.push(html);
    } else if (child.localName === 'tbl') {
      // A nested table is rendered, not dropped.
      parts.push(renderDocxTable(child, ctx, numbering).html);
    }
  }
  return parts.join('<br />') || '&nbsp;';
}

function renderDocxTable(tbl: Element, ctx: DocxContext, numbering: NumberingIndex): DocxBlock {
  const trs = childrenByLocalName(tbl, 'tr');
  // Track which grid column each open vertical merge belongs to so a
  // continuation cell becomes a rowspan on the cell above instead of an empty
  // cell that pushes every value one column to the right.
  const openMerges = new Map<number, { rowIndex: number; cellIndex: number; rows: number }>();
  const rows: { cells: string[]; header: boolean }[] = [];

  trs.forEach((tr, rowIndex) => {
    const trPr = firstByLocalName(tr, 'trPr');
    const header = !!(trPr && firstByLocalName(trPr, 'tblHeader'));
    const cells: string[] = [];
    let column = 0;

    for (const tc of childrenByLocalName(tr, 'tc')) {
      const span = cellGridSpan(tc);
      const merge = cellVerticalMerge(tc);

      if (merge === 'continue') {
        const open = openMerges.get(column);
        const anchorRow = open ? rows[open.rowIndex] : undefined;
        const anchorCell = anchorRow?.cells[open!.cellIndex];
        if (open && anchorRow && anchorCell != null) {
          open.rows += 1;
          anchorRow.cells[open.cellIndex] = anchorCell.replace(
            /^<t([dh])(?: rowspan="\d+")?/,
            (_match, tag: string) => `<t${tag} rowspan="${open.rows}"`,
          );
        }
        column += span;
        continue;
      }

      const tag = header ? 'th' : 'td';
      const spanAttr = span > 1 ? ` colspan="${span}"` : '';
      cells.push(`<${tag}${spanAttr}>${renderCellContent(tc, ctx, numbering)}</${tag}>`);
      if (merge === 'restart') {
        openMerges.set(column, { rowIndex: rows.length, cellIndex: cells.length - 1, rows: 1 });
      } else {
        openMerges.delete(column);
      }
      column += span;
    }

    rows.push({ cells, header });
  });

  const headerRows = rows.filter((row) => row.header);
  const bodyRows = rows.filter((row) => !row.header);
  const renderRows = (list: typeof rows) => list.map((row) => `<tr>${row.cells.join('')}</tr>`).join('');
  const thead = headerRows.length ? `<thead>${renderRows(headerRows)}</thead>` : '';
  return { kind: 'table', html: `<table>${thead}<tbody>${renderRows(bodyRows)}</tbody></table>` };
}

function blocksToHtml(blocks: DocxBlock[]): string {
  const out: string[] = [];
  // Stack of open lists so `w:ilvl` produces real nesting rather than a flat
  // `<ul>`, and numbered lists render as `<ol>`.
  let openLists: { level: number; ordered: boolean }[] = [];

  const closeTo = (depth: number) => {
    while (openLists.length > depth) {
      const list = openLists.pop()!;
      out.push(list.ordered ? '</ol>' : '</ul>');
    }
  };

  for (const block of blocks) {
    if (block.kind === 'list-item') {
      const targetDepth = (block.level ?? 0) + 1;
      const ordered = block.ordered ?? false;
      // A change of list type at the same depth starts a new list.
      if (openLists.length === targetDepth && openLists[targetDepth - 1]!.ordered !== ordered) {
        closeTo(targetDepth - 1);
      }
      closeTo(targetDepth);
      while (openLists.length < targetDepth) {
        out.push(ordered ? '<ol>' : '<ul>');
        openLists.push({ level: openLists.length, ordered });
      }
      out.push(`<li>${block.html}</li>`);
      continue;
    }
    closeTo(0);
    if (block.kind === 'heading') out.push(`<${block.tag}>${block.html}</${block.tag}>`);
    else if (block.kind === 'table') out.push(block.html);
    else out.push(`<p>${block.html}</p>`);
  }
  closeTo(0);
  openLists = [];
  return out.join('');
}

async function loadDocxMedia(zip: JSZip): Promise<Map<string, string>> {
  const media = new Map<string, string>();
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (!relsFile) return media;
  try {
    const relsXml = new DOMParser().parseFromString(await relsFile.async('text'), 'application/xml');
    for (const rel of Array.from(relsXml.getElementsByTagName('*')).filter((el) => el.localName === 'Relationship')) {
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (!id || !target || !/media\//i.test(target)) continue;
      const path = `word/${target.replace(/^\//, '').replace(/^word\//, '')}`;
      const mime = mimeForImagePath(path);
      const entry = zip.file(path);
      if (!entry || !mime) continue;
      media.set(id, `data:${mime};base64,${await entry.async('base64')}`);
    }
  } catch { /* embedded images are best-effort */ }
  return media;
}

export async function convertDocxToHtml(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('This .docx has no readable document body (word/document.xml missing).');
  const xml = new DOMParser().parseFromString(await docFile.async('text'), 'application/xml');
  const body = Array.from(xml.getElementsByTagName('*')).find((el) => el.localName === 'body');
  if (!body) throw new Error('Could not read the Word document structure.');

  const ctx: DocxContext = { media: await loadDocxMedia(zip) };
  const numbering = await loadNumberingIndex(zip);
  const blocks: DocxBlock[] = [];

  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (child.localName === 'p') {
        const block = renderDocxParagraph(child, ctx, numbering);
        if (block) blocks.push(block);
      } else if (child.localName === 'tbl') {
        blocks.push(renderDocxTable(child, ctx, numbering));
      } else if (child.localName === 'sdt' || child.localName === 'sdtContent') {
        // Content controls wrap ordinary block content; the previous
        // direct-children scan skipped everything inside them.
        walk(child);
      }
    }
  };
  walk(body);

  if (!blocks.length) throw new Error('The Word document appears to be empty.');
  return wrapDocumentHtml(blocksToHtml(blocks), file.name.replace(/\.docx$/i, ''));
}

// ─── plain text / RTF ─────────────────────────────────────────────────────────

export function convertPlainTextToHtml(text: string, title: string): string {
  const paragraphs = String(text || '')
    .split(/\r?\n\s*\r?\n/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escapeHtml(para).replace(/\r?\n/g, '<br />')}</p>`);
  if (!paragraphs.length) throw new Error('The document appears to be empty.');
  return wrapDocumentHtml(paragraphs.join(''), title);
}

/** Minimal RTF → text: drops control words/groups, honours \par as newline. */
export function rtfToPlainText(rtf: string): string {
  let text = String(rtf || '');
  text = text.replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|\*)[^{}]*(?:\{[^{}]*\})*[^{}]*\}/gi, '');
  text = text.replace(/\\par[d]?\b/gi, '\n');
  text = text.replace(/\\tab\b/gi, '\t');
  text = text.replace(/\\'([0-9a-f]{2})/gi, (_m, hex) => {
    try { return String.fromCharCode(parseInt(hex, 16)); } catch { return ''; }
  });
  text = text.replace(/\\u(-?\d+)\s?\??/g, (_m, code) => {
    const n = Number(code);
    return String.fromCharCode(n < 0 ? n + 65536 : n);
  });
  text = text.replace(/\\[a-z]+-?\d*\s?/gi, '');
  text = text.replace(/[{}]/g, '');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export interface ConvertedDocument {
  html: string;
  filename: string;
}

/** Convert any supported document file to renderable HTML for the C1 pipeline. */
export async function convertDocumentToHtml(file: File): Promise<ConvertedDocument> {
  const kind = documentKindForFile(file);
  if (!kind) throw new Error('Not a supported document file.');
  if (file.size > DOCUMENT_MAX_BYTES) {
    throw new Error(`Document too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max ${DOCUMENT_MAX_BYTES / 1024 / 1024} MB).`);
  }
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'document';
  const filename = `${baseName}.html`;
  if (kind === 'doc') {
    throw new Error('Legacy .doc files are not supported — save the document as .docx (or export to PDF) and try again.');
  }
  if (kind === 'docx') {
    return { html: await convertDocxToHtml(file), filename };
  }
  const raw = await file.text();
  const text = kind === 'rtf' ? rtfToPlainText(raw) : raw;
  return { html: convertPlainTextToHtml(text, baseName), filename };
}
