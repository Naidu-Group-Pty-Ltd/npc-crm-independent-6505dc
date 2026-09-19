/**
 * Figma Make / local-Figma export ingestion (`.make` / `.fig`).
 *
 * A `.make` export is a ZIP archive: `meta.json`, `thumbnail.png`,
 * `canvas.fig` (the binary kiwi-encoded canvas) and an `images/` folder with
 * the page rasters the export captured. The binary canvas is not practically
 * decodable here, but the bundled rasters are exactly what the faithful image
 * reconstruction pipeline consumes — so we unpack the archive, hand the best
 * raster to the existing screenshot-to-template flow, and give precise
 * guidance when an export carries no usable raster at all.
 *
 * The ZIP reader is dependency-free: central-directory parsing is pure, and
 * deflate decompression uses the platform `DecompressionStream` (Chrome,
 * Safari 16.4+, Firefox 113+, Node 18+).
 */

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Offset of the local file header. */
  headerOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** Parse the ZIP central directory (pure). Throws on a non-ZIP buffer. */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new Error('Not a ZIP archive (too small).');

  // End-of-central-directory: scan backwards (comment can pad the tail).
  let eocd = -1;
  const scanFloor = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= scanFloor; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (no end-of-central-directory record).');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CDIR_SIG) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const headerOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (!name.endsWith('/')) {
      entries.push({ name, method, compressedSize, uncompressedSize, headerOffset });
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Read + decompress one entry (stored or deflate). */
export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.headerOffset;
  if (at + 30 > bytes.length || view.getUint32(at, true) !== LOCAL_SIG) {
    throw new Error(`ZIP entry "${entry.name}" has a corrupt local header.`);
  }
  const nameLen = view.getUint16(at + 26, true);
  const extraLen = view.getUint16(at + 28, true);
  const start = at + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw.slice();
  if (entry.method !== 8) throw new Error(`ZIP entry "${entry.name}" uses unsupported compression method ${entry.method}.`);
  const copy = raw.slice();
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(copy);
      controller.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw') as any);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

const mimeForName = (name: string): string => {
  const lower = name.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
};

/** Magic-byte sniff for entries without an extension (Figma image hashes). */
function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export interface MakeImage { name: string; mime: string; bytes: Uint8Array }

export interface MakeAssets {
  /** Design title recovered from meta.json (best effort). */
  title?: string;
  /** Bundled rasters, largest first (decoded size is the caller's check). */
  images: MakeImage[];
  /** True when the archive carries the binary Figma canvas. */
  hasCanvasFig: boolean;
}

/** Unpack a .make/.fig archive into its usable assets. */
export async function extractMakeAssets(bytes: Uint8Array): Promise<MakeAssets> {
  const entries = listZipEntries(bytes);
  const out: MakeAssets = { images: [], hasCanvasFig: entries.some((e) => /(^|\/)canvas\.fig$/i.test(e.name)) };

  const metaEntry = entries.find((e) => /(^|\/)meta\.json$/i.test(e.name));
  if (metaEntry) {
    try {
      const meta = JSON.parse(new TextDecoder().decode(await readZipEntry(bytes, metaEntry)));
      const title = meta?.name ?? meta?.title ?? meta?.fileName;
      if (typeof title === 'string' && title.trim()) out.title = title.trim();
    } catch { /* meta is advisory only */ }
  }

  // Tiny entries (e.g. a 1×1 thumbnail placeholder) are useless as references.
  const MIN_BYTES = 2048;
  const candidates = entries
    .filter((e) => IMAGE_EXT.test(e.name) || /(^|\/)images\//i.test(e.name))
    .sort((a, b) => b.uncompressedSize - a.uncompressedSize);
  for (const entry of candidates) {
    if (out.images.length >= 8) break;
    if (entry.uncompressedSize < MIN_BYTES) continue;
    try {
      const data = await readZipEntry(bytes, entry);
      const mime = IMAGE_EXT.test(entry.name) ? mimeForName(entry.name) : sniffImageMime(data);
      if (!mime) continue;
      out.images.push({ name: entry.name, mime, bytes: data });
    } catch { /* skip unreadable entries */ }
  }
  return out;
}

/** Is this filename a Figma Make / local-Figma export we can unpack? */
export function isFigmaMakeFile(name = ''): boolean {
  return /\.(make|fig)$/i.test(name.trim());
}

export const MAKE_NO_RASTER_GUIDANCE =
  'This Figma export only contains the binary canvas (canvas.fig) — no page raster we can reconstruct from. '
  + 'In Figma, export the frame as PNG (or the file as PDF) and upload that instead, or paste the published site URL.';
