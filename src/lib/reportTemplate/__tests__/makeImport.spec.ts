/**
 * Figma Make export (.make/.fig) ingestion: dependency-free ZIP parsing and
 * raster extraction. Fixtures are built in-test (stored + deflate entries).
 */
import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { listZipEntries, readZipEntry, extractMakeAssets, isFigmaMakeFile, MAKE_NO_RASTER_GUIDANCE } from '../ingestion/makeImport';

interface FixtureEntry { name: string; data: Uint8Array; deflate?: boolean }

/** Minimal valid ZIP writer (no CRC validation in the reader under test). */
function buildZip(entries: FixtureEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => Uint8Array.from([v & 255, (v >> 8) & 255]);
  const u32 = (v: number) => Uint8Array.from([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);

  for (const e of entries) {
    const name = enc.encode(e.name);
    const payload = e.deflate ? new Uint8Array(deflateRawSync(e.data)) : e.data;
    const method = e.deflate ? 8 : 0;
    const local = new Uint8Array(30 + name.length + payload.length);
    local.set(u32(0x04034b50), 0);
    local.set(u16(20), 4);                 // version
    local.set(u16(0), 6);                  // flags
    local.set(u16(method), 8);
    local.set(u32(0), 10);                 // mtime/date
    local.set(u32(0), 14);                 // crc (unchecked)
    local.set(u32(payload.length), 18);    // compressed size
    local.set(u32(e.data.length), 22);     // uncompressed size
    local.set(u16(name.length), 26);
    local.set(u16(0), 28);                 // extra len
    local.set(name, 30);
    local.set(payload, 30 + name.length);
    chunks.push(local);

    const cd = new Uint8Array(46 + name.length);
    cd.set(u32(0x02014b50), 0);
    cd.set(u16(20), 4); cd.set(u16(20), 6);
    cd.set(u16(0), 8);
    cd.set(u16(method), 10);
    cd.set(u32(0), 12);
    cd.set(u32(0), 16);                    // crc
    cd.set(u32(payload.length), 20);
    cd.set(u32(e.data.length), 24);
    cd.set(u16(name.length), 28);
    cd.set(u16(0), 30); cd.set(u16(0), 32); // extra/comment len
    cd.set(u16(0), 34); cd.set(u16(0), 36); // disk/int attrs
    cd.set(u32(0), 38);                    // ext attrs
    cd.set(u32(offset), 42);               // local header offset
    cd.set(name, 46);
    central.push(cd);
    offset += local.length;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  eocd.set(u32(0x06054b50), 0);
  eocd.set(u16(entries.length), 8);
  eocd.set(u16(entries.length), 10);
  eocd.set(u32(cdSize), 12);
  eocd.set(u32(offset), 16);

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of [...chunks, ...central, eocd]) { out.set(c, at); at += c.length; }
  return out;
}

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const bigPng = (size: number): Uint8Array => {
  const data = new Uint8Array(size);
  data.set(PNG_MAGIC, 0);
  for (let i = 8; i < size; i++) data[i] = i & 255;
  return data;
};

describe('listZipEntries / readZipEntry', () => {
  it('parses the central directory and reads stored + deflated entries', async () => {
    const meta = new TextEncoder().encode(JSON.stringify({ name: 'Cloverton Cover' }));
    const zip = buildZip([
      { name: 'meta.json', data: meta },
      { name: 'canvas.fig', data: bigPng(4096), deflate: true },
    ]);
    const entries = listZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(['meta.json', 'canvas.fig']);
    expect(new TextDecoder().decode(await readZipEntry(zip, entries[0]))).toContain('Cloverton Cover');
    const inflated = await readZipEntry(zip, entries[1]);
    expect(inflated.length).toBe(4096);
    expect(Array.from(inflated.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('throws on non-ZIP input', () => {
    expect(() => listZipEntries(new TextEncoder().encode('definitely not a zip archive at all'))).toThrow(/ZIP/);
  });
});

describe('extractMakeAssets', () => {
  it('recovers the title and the bundled rasters, largest first, skipping tiny placeholders', async () => {
    const zip = buildZip([
      { name: 'meta.json', data: new TextEncoder().encode(JSON.stringify({ name: 'Glow Export' })) },
      { name: 'thumbnail.png', data: bigPng(68) },          // 1×1-style placeholder → skipped (< 2 KB)
      { name: 'canvas.fig', data: new Uint8Array(2048), deflate: true },
      { name: 'images/page-1.png', data: bigPng(60_000), deflate: true },
      { name: 'images/hash-no-ext', data: bigPng(30_000) }, // sniffed as PNG by magic bytes
    ]);
    const assets = await extractMakeAssets(zip);
    expect(assets.title).toBe('Glow Export');
    expect(assets.hasCanvasFig).toBe(true);
    expect(assets.images.map((i) => i.name)).toEqual(['images/page-1.png', 'images/hash-no-ext']);
    expect(assets.images[0].mime).toBe('image/png');
  });

  it('returns no images for a canvas-only export (caller shows guidance)', async () => {
    const zip = buildZip([
      { name: 'meta.json', data: new TextEncoder().encode('{}') },
      { name: 'thumbnail.png', data: bigPng(68) },
      { name: 'canvas.fig', data: new Uint8Array(2048), deflate: true },
    ]);
    const assets = await extractMakeAssets(zip);
    expect(assets.images).toEqual([]);
    expect(assets.hasCanvasFig).toBe(true);
    expect(MAKE_NO_RASTER_GUIDANCE).toMatch(/export the frame as PNG/i);
  });
});

describe('isFigmaMakeFile', () => {
  it('matches .make and .fig only', () => {
    expect(isFigmaMakeFile('glowexport18122815_figma_site_1536w_default.make')).toBe(true);
    expect(isFigmaMakeFile('design.fig')).toBe(true);
    expect(isFigmaMakeFile('project.zip')).toBe(false);
    expect(isFigmaMakeFile('component.tsx')).toBe(false);
  });
});
