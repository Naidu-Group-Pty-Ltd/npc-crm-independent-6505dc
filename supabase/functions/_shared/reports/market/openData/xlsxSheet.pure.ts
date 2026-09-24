/**
 * One worksheet out of an .xlsx, without parsing the rest of the workbook.
 *
 * ── Why the loader does not hand these files to SheetJS ──────────────────
 *
 * Two of the projection workbooks `state-projection-liveness` described from
 * CI would cost an edge worker more than the one sheet the loader needs:
 *
 *  - NSW's SA2 workbook is **9,177,346 bytes** across nine sheets — age and
 *    sex, population accounts, growth rates — of which the register reads
 *    one ("Total population", 629 rows). SheetJS inflates every member of the
 *    archive to read one, and `market-sales-ingest` has already been killed
 *    once by the worker's compute allowance (546 WORKER_RESOURCE_LIMIT, five
 *    DCJ workbooks in one call, 15 Sep 2026).
 *  - Victoria in Future's `Total_Population` sheet DECLARES its range as
 *    `A1:XCE1884` — 16,307 columns, because formatting runs to the edge of the
 *    sheet — while its data is six columns wide. `sheet_to_json` walks the
 *    declared range, so a 1.1 MB file becomes thirty million cells.
 *
 * So this reads the zip's own central directory, inflates exactly three
 * members (the workbook, its relationships and the shared strings) plus the
 * sheets asked for, with the platform's native `DecompressionStream`, and
 * builds a grid from the cells that CARRY A VALUE. A formatted empty cell is
 * not a cell here, which is what makes the declared range irrelevant.
 *
 * ── What it refuses ──────────────────────────────────────────────────────
 *
 *  - a member whose inflated length is not the length the archive declares
 *    (an off-by-n in the local-header skip inflates to plausible rubbish, and
 *    the declared size is the archive's own checksum on our arithmetic —
 *    `transport-gtfs-ingest`'s rule);
 *  - a sheet name the workbook does not hold, naming the ones it does;
 *  - a compression method other than stored or deflate.
 *
 * Deno-compatible: explicit `.ts` extensions, no `@/` aliases. No I/O — the
 * caller fetches the bytes; this only reads them.
 */
import { readZipDirectoryFromTail, memberDataStart, type ZipMember } from '../../../gtfsFeed.pure.ts';

export type GridCell = string | number | boolean | null;
export type Grid = GridCell[][];

const decoder = new TextDecoder();

/** Every member of an archive held whole in memory. */
export function xlsxMembers(bytes: Uint8Array): ZipMember[] {
  // The whole file is its own tail, so every central-directory offset is in range.
  return readZipDirectoryFromTail(bytes, bytes.length);
}

async function inflate(data: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return data;
  if (method !== 8) throw new Error(`compression method ${method} is neither stored nor deflate — refused`);
  // A stream built by hand rather than `Blob.stream()`/`Response`, so the one
  // code path runs identically in the edge runtime, in Node and under a test
  // DOM whose Blob has no stream().
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close(); } });
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** One member's bytes, inflated, checked against the size the archive declares. */
export async function readMember(bytes: Uint8Array, member: ZipMember): Promise<Uint8Array> {
  const start = memberDataStart(bytes.subarray(member.localHeaderOffset, member.localHeaderOffset + 30), member.localHeaderOffset);
  const out = await inflate(bytes.subarray(start, start + member.compressedSize), member.method);
  if (out.length !== member.uncompressedSize) {
    throw new Error(`${member.name} inflated to ${out.length} bytes, the archive declares ${member.uncompressedSize} — refused`);
  }
  return out;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML character references and the five predefined entities. */
export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(parseInt(ref.slice(1), 10));
    return ENTITY[ref];
  });
}

/**
 * The text of a string item: every `<t>` run, in order, and nothing from a
 * phonetic `<rPh>` run — those are reading aids for the text, not the text.
 */
function itemText(inner: string): string {
  const withoutPhonetic = inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) out += m[1] ?? '';
  return unescapeXml(out);
}

/** `xl/sharedStrings.xml` as its index-ordered list of strings. */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) out.push(itemText(m[1] ?? ''));
  return out;
}

/** `A` → 0, `Z` → 25, `AA` → 26, `XCE` → 16,306. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const attr = (attrs: string, name: string): string | null => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
};

/**
 * A worksheet's cells as a grid, row-major and 0-indexed, holding ONLY the
 * cells that carry a value. Rows and columns keep their positions (row 7 of
 * the sheet is `grid[6]`), so a parser can speak about the publisher's own
 * layout; a gap between them is left as missing entries, never as zeros.
 *
 * A number stays a number, a shared or inline string becomes its text, a
 * formula's cached result is read like any other value, a boolean is a
 * boolean, and an error cell (`#N/A`, `#DIV/0!`) is null — an error is not
 * a figure.
 */
export function parseSheetXml(xml: string, shared: readonly string[]): Grid {
  const grid: Grid = [];
  let nextRow = 0;
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  for (const rm of xml.matchAll(rowRe)) {
    const rAttr = attr(rm[1], 'r');
    const rowIndex = rAttr !== null ? Number(rAttr) - 1 : nextRow;
    nextRow = rowIndex + 1;
    const body = rm[2];
    if (!body) continue;
    let nextCol = 0;
    const row: GridCell[] = [];
    let any = false;
    for (const cm of body.matchAll(cellRe)) {
      const ref = attr(cm[1], 'r');
      const col = ref !== null ? columnIndex(/^[A-Z]+/i.exec(ref)?.[0] ?? 'A') : nextCol;
      nextCol = col + 1;
      const inner = cm[2];
      if (!inner) continue; // formatted, empty: not a cell here
      const type = attr(cm[1], 't');
      let value: GridCell;
      if (type === 'inlineStr') {
        const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner);
        value = is ? itemText(is[1]) : null;
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        if (!v) continue;
        const raw = unescapeXml(v[1]);
        if (type === 's') {
          const i = Number(raw);
          if (!Number.isInteger(i) || i < 0 || i >= shared.length) {
            throw new Error(`cell ${ref ?? '?'} names shared string ${raw} of ${shared.length} — refused`);
          }
          value = shared[i];
        } else if (type === 'str') {
          value = raw;
        } else if (type === 'b') {
          value = raw === '1' || raw.toLowerCase() === 'true';
        } else if (type === 'e') {
          value = null;
        } else {
          const n = Number(raw);
          value = raw.trim() !== '' && Number.isFinite(n) ? n : raw;
        }
      }
      if (value === null) continue;
      row[col] = value;
      any = true;
    }
    if (any) grid[rowIndex] = row;
  }
  return grid;
}

/** Sheet name → the member that holds it, from the workbook and its relationships. */
export function sheetMembers(workbookXml: string, relsXml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    if (id && target) targets.set(id, target);
  }
  const out = new Map<string, string>();
  for (const m of workbookXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = attr(m[1], 'name');
    const rid = attr(m[1], 'r:id') ?? /\br:id="([^"]*)"/.exec(m[1])?.[1] ?? null;
    if (!name || !rid) continue;
    const target = targets.get(rid);
    if (!target) continue;
    // Targets are relative to xl/ unless absolute from the package root.
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    out.set(unescapeXml(name), path);
  }
  return out;
}

export interface XlsxRead {
  /** Every sheet the workbook holds, in its own order. */
  sheetNames: string[];
  /** The sheets asked for, by name. */
  grids: Record<string, Grid>;
}

/**
 * Read the named sheets of a workbook held in memory, and nothing else.
 *
 * `bytes` must be the whole file. A name the workbook does not hold is
 * refused, naming the sheets it does hold, because a publisher that renamed
 * a sheet has changed the file the parser was written against.
 */
export async function readXlsxSheets(bytes: Uint8Array, names: readonly string[]): Promise<XlsxRead> {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error(`${bytes.length} bytes that are not a zip archive (no PK header) — not an .xlsx, refused`);
  }
  const members = xlsxMembers(bytes);
  const byName = new Map(members.map((m) => [m.name, m]));
  const text = async (name: string, required: boolean): Promise<string | null> => {
    const m = byName.get(name);
    if (!m) {
      if (required) throw new Error(`the archive holds no ${name} — not an .xlsx workbook, refused`);
      return null;
    }
    return decoder.decode(await readMember(bytes, m));
  };
  const workbook = (await text('xl/workbook.xml', true))!;
  const rels = (await text('xl/_rels/workbook.xml.rels', true))!;
  const sheetPaths = sheetMembers(workbook, rels);
  const sheetNames = [...sheetPaths.keys()];
  const resolved = new Map<string, string>();
  const missing: string[] = [];
  for (const n of names) {
    const path = sheetPaths.get(n) ?? sheetPathLoosely(sheetPaths, n);
    if (path === null) missing.push(n);
    else resolved.set(n, path);
  }
  if (missing.length > 0) {
    throw new Error(`the workbook holds no sheet named ${missing.map((n) => JSON.stringify(n)).join(', ')} `
      + `(it holds ${sheetNames.map((n) => JSON.stringify(n)).join(', ')}) — the layout changed, refused`);
  }
  const sharedXml = await text('xl/sharedStrings.xml', false);
  const shared = sharedXml === null ? [] : parseSharedStrings(sharedXml);
  const grids: Record<string, Grid> = {};
  for (const n of names) grids[n] = parseSheetXml((await text(resolved.get(n)!, true))!, shared);
  return { sheetNames, grids };
}

/**
 * A sheet asked for by a name that differs from the workbook's only in case
 * or surrounding space — Tasmania's `LGADetailedComponents5yr ` carries a
 * trailing space — resolves, and only where exactly ONE sheet matches. Two
 * matches is ambiguity, and ambiguity refuses.
 */
function sheetPathLoosely(sheetPaths: Map<string, string>, name: string): string | null {
  const want = name.replace(/\s+/g, ' ').trim().toLowerCase();
  const hits = [...sheetPaths.entries()].filter(([n]) => n.replace(/\s+/g, ' ').trim().toLowerCase() === want);
  return hits.length === 1 ? hits[0][1] : null;
}

/** A cell's text, trimmed, or '' — for matching labels, never for reading figures. */
export function cellText(v: GridCell | undefined): string {
  return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
}

/** Every non-empty text in the first `rows` rows, joined — what a statement regex reads. */
export function headText(grid: Grid, rows = 12): string {
  const out: string[] = [];
  for (let r = 0; r < Math.min(rows, grid.length); r++) {
    for (const c of grid[r] ?? []) {
      const t = cellText(c);
      if (t !== '') out.push(t);
    }
  }
  return out.join('\n');
}
