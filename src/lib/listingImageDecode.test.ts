import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECODE_PIXEL_ALLOWANCE,
  decideDecode,
  readDecodableDimensions,
  resolveDecodePixelAllowance,
} from '../../supabase/functions/_shared/listingImageDecode.pure';

/**
 * The listing-photo `analyse` sweep was killed by the platform on every run for
 * eleven days, decoding a floor plan too large for a worker's memory. These pin
 * the two rules that stop it: the size is read from the image's own header
 * BEFORE anything is decoded, and a row is stamped before its image is decoded
 * so a kill nothing can catch does not leave it at the head of the queue.
 */

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());

/** A PNG signature and IHDR chunk, which is all the reader looks at. */
function pngHeader(width: number, height: number, chunkType = 'IHDR'): Uint8Array {
  const type = [...chunkType].map((c) => c.charCodeAt(0));
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    u32(13),
    type,
    u32(width),
    u32(height),
    [8, 6, 0, 0, 0],
    u32(0), // CRC; not checked
  );
}

/** A marker segment: 0xFF, the marker, a length that counts itself, the body. */
const segment = (marker: number, body: number[]) => [0xff, marker, ...u16(body.length + 2), ...body];
/** A frame header body: precision, height, width, then one component. */
const frame = (width: number, height: number) => [8, ...u16(height), ...u16(width), 1, 1, 0x11, 0];

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const APP0 = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const DQT = segment(0xdb, [0, ...new Array(64).fill(1)]);
const DHT = segment(0xc4, [0, ...new Array(16).fill(0)]);
const SOS = segment(0xda, [1, 1, 0, 0, 63, 0]);

describe('readDecodableDimensions — PNG', () => {
  it('reads width and height from IHDR', () => {
    expect(readDecodableDimensions(pngHeader(8000, 6000))).toEqual({
      format: 'png',
      width: 8000,
      height: 6000,
    });
  });

  it('refuses a header whose first chunk is not IHDR, a truncated one, and a zero size', () => {
    expect(readDecodableDimensions(pngHeader(800, 600, 'IDAT'))).toBeNull();
    expect(readDecodableDimensions(pngHeader(800, 600).slice(0, 20))).toBeNull();
    expect(readDecodableDimensions(pngHeader(0, 600))).toBeNull();
  });
});

describe('readDecodableDimensions — JPEG', () => {
  it('reads a baseline frame header after the usual segments', () => {
    const jpeg = bytes(SOI, APP0, DQT, segment(0xc0, frame(1200, 800)), DHT, SOS, EOI);
    expect(readDecodableDimensions(jpeg)).toEqual({ format: 'jpeg', width: 1200, height: 800 });
  });

  it('reads a progressive frame header', () => {
    const jpeg = bytes(SOI, APP0, segment(0xc2, frame(4032, 3024)), SOS);
    expect(readDecodableDimensions(jpeg)).toEqual({ format: 'jpeg', width: 4032, height: 3024 });
  });

  it('is not fooled by the thumbnail a camera embeds in EXIF', () => {
    // A whole JPEG, frame header and all, inside APP1. Skipping segments by
    // their length is what keeps the reader from taking 160 x 120 as the image.
    const thumbnail = [...SOI, ...segment(0xc0, frame(160, 120)), ...EOI];
    const exif = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0, 0, ...thumbnail]);
    const jpeg = bytes(SOI, exif, DQT, segment(0xc0, frame(6000, 4000)), SOS);
    expect(readDecodableDimensions(jpeg)).toEqual({ format: 'jpeg', width: 6000, height: 4000 });
  });

  it('does not read a Huffman table as a frame header, and skips fill bytes', () => {
    const jpeg = bytes(SOI, DHT, [0xff, 0xff, 0xff], segment(0xc1, frame(3000, 2000)), SOS);
    expect(readDecodableDimensions(jpeg)).toEqual({ format: 'jpeg', width: 3000, height: 2000 });
  });

  it('refuses a scan before any frame, a deferred height, and a truncated segment', () => {
    expect(readDecodableDimensions(bytes(SOI, APP0, SOS, EOI))).toBeNull();
    expect(readDecodableDimensions(bytes(SOI, segment(0xc0, frame(1200, 0)), SOS))).toBeNull();
    const truncated = bytes(SOI, APP0, segment(0xc0, frame(1200, 800))).slice(0, 26);
    expect(readDecodableDimensions(truncated)).toBeNull();
  });
});

describe('readDecodableDimensions — everything else', () => {
  it('declines what the decoder cannot make a still of', () => {
    // A GIF decodes to an animation, every frame of it, and yields no verdict.
    const gif = bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], [0x40, 0x1f, 0x70, 0x17]);
    const webp = bytes([0x52, 0x49, 0x46, 0x46], u32(100), [0x57, 0x45, 0x42, 0x50]);
    expect(readDecodableDimensions(gif)).toBeNull();
    expect(readDecodableDimensions(webp)).toBeNull();
    expect(readDecodableDimensions(new Uint8Array(0))).toBeNull();
    expect(readDecodableDimensions(bytes(new Array(64).fill(0x42)))).toBeNull();
  });
});

describe('decideDecode', () => {
  const allowance = 9_000_000;
  const plan = (width: number, height: number) => ({ format: 'png' as const, width, height });

  it('decodes what fits, and charges its pixels', () => {
    expect(decideDecode(plan(3000, 2000), allowance, allowance)).toEqual({
      decode: true,
      pixels: 6_000_000,
    });
    // Exactly the allowance still fits.
    expect(decideDecode(plan(3000, 3000), allowance, allowance)).toEqual({
      decode: true,
      pixels: 9_000_000,
    });
  });

  it('defers what fits a request but not what is left of this one', () => {
    expect(decideDecode(plan(3000, 2000), 4_000_000, allowance)).toEqual({
      decode: false,
      reason: 'deferred',
    });
  });

  it('never decodes what no request can afford, and says which it was', () => {
    expect(decideDecode(plan(8000, 6000), allowance, allowance)).toEqual({
      decode: false,
      reason: 'too_large',
    });
    expect(decideDecode(null, allowance, allowance)).toEqual({ decode: false, reason: 'unsupported' });
  });

  it('never defers the head of a fresh request, so every run makes progress', () => {
    for (const [w, h] of [
      [1, 1],
      [3508, 2480],
      [3000, 3000],
      [3001, 3000],
      [20000, 20000],
    ]) {
      const d = decideDecode(plan(w, h), allowance, allowance);
      if ('reason' in d) {
        expect(d.reason).not.toBe('deferred');
      } else {
        expect(d.decode).toBe(true);
      }
    }
  });
});

describe('the pixel allowance', () => {
  it('admits an A4 floor plan at 300 dpi and stays inside a worker at the worst measured cost', () => {
    expect(3508 * 2480).toBeLessThanOrEqual(DEFAULT_DECODE_PIXEL_ALLOWANCE);
    // 17.5 bytes a pixel was the worst measured (16-bit RGBA PNG); the
    // platform's documented ceiling is 256 MB for everything, runtime included.
    expect(DEFAULT_DECODE_PIXEL_ALLOWANCE * 17.5).toBeLessThan(200 * 1024 * 1024);
  });

  it('reads the configured value and falls back rather than to zero or infinity', () => {
    expect(resolveDecodePixelAllowance('12000000')).toBe(12_000_000);
    expect(resolveDecodePixelAllowance(' 1e7 ')).toBe(10_000_000);
    expect(resolveDecodePixelAllowance('5000000.9')).toBe(5_000_000);
    for (const raw of [undefined, null, '', '  ', 'abc', '0', '-5', 'Infinity', 'NaN']) {
      expect(resolveDecodePixelAllowance(raw)).toBe(DEFAULT_DECODE_PIXEL_ALLOWANCE);
    }
  });
});

describe('listing-images decodes nothing it has not measured, and stamps before it decodes', () => {
  const source = readFileSync(
    join(process.cwd(), 'supabase/functions/listing-images/index.ts'),
    'utf8',
  );

  /** The body of a top-level function, from its declaration to the next one. */
  function body(name: string): string {
    const start = source.indexOf(`async function ${name}(`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const next = source.indexOf('\nasync function ', start + 1);
    const nextPlain = source.indexOf('\nfunction ', start + 1);
    const ends = [next, nextPlain].filter((i) => i > start);
    return source.slice(start, ends.length ? Math.min(...ends) : undefined);
  }

  it('the analyse sweep stamps a row before it decodes it', () => {
    const sweep = body('analyseStoredImages');
    const stamp = sweep.indexOf(".update({ visual_analysed_at: new Date().toISOString() })");
    const decision = sweep.indexOf('decideDecode(');
    const decode = sweep.indexOf('analyseImageBytes(');
    expect(stamp).toBeGreaterThan(-1);
    expect(decision).toBeGreaterThan(-1);
    expect(decode).toBeGreaterThan(stamp);
    expect(stamp).toBeGreaterThan(decision);
  });

  it('every decode in the function is preceded by a pixel decision', () => {
    const sites = [...source.matchAll(/analyseImageBytes\(/g)].map((m) => m.index ?? 0);
    // The helper the harvest paths use, and the sweep.
    expect(sites.length).toBe(2);
    for (const site of sites) {
      const fnStart = Math.max(
        source.lastIndexOf('\nasync function ', site),
        source.lastIndexOf('\nfunction ', site),
      );
      expect(source.slice(fnStart, site)).toContain('decideDecode(');
    }
  });

  it('the harvest paths decode through the budgeted helper', () => {
    expect(source).toContain('const visual = await analyseWithinBudget(budget, fetched.bytes);');
    expect(source).not.toMatch(/hasBudget\(budget\)\s*\?\s*await analyseImageBytes/);
  });
});
