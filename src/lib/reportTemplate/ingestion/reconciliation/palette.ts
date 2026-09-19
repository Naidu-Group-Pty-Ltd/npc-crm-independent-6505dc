export interface RgbaPixelData {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')}`;
}

/** Deterministic dominant-colour extraction from RGBA pixels. Browser wrappers can feed canvas ImageData here. */
export function extractPaletteFromPixels(pixels: RgbaPixelData, maxColors = 8): string[] {
  const buckets = new Map<string, { count: number; r: number; g: number; b: number; sat: number }>();
  const step = Math.max(4, Math.floor((pixels.width * pixels.height * 4) / 4096) * 4);
  for (let i = 0; i < pixels.data.length; i += step) {
    const a = Number(pixels.data[i + 3] ?? 255);
    if (a < 32) continue;
    const r = Number(pixels.data[i] ?? 0);
    const g = Number(pixels.data[i + 1] ?? 0);
    const b = Number(pixels.data[i + 2] ?? 0);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if ((lum > 0.96 || lum < 0.04) && sat < 0.12) continue;
    const key = `${Math.round(r / 24)}:${Math.round(g / 24)}:${Math.round(b / 24)}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, sat: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.sat += sat;
    buckets.set(key, bucket);
  }
  return Array.from(buckets.values())
    .sort((a, b) => (b.count * (1 + b.sat / Math.max(1, b.count))) - (a.count * (1 + a.sat / Math.max(1, a.count))))
    .slice(0, maxColors)
    .map((bucket) => rgbToHex(bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count));
}

/** Estimate the page background by sampling corners and edges rather than asking AI to guess. */
export function sampleBackgroundColorFromPixels(pixels: RgbaPixelData): string | undefined {
  if (!pixels.width || !pixels.height || pixels.data.length < 4) return undefined;
  const samples: Array<[number, number]> = [];
  const maxX = pixels.width - 1;
  const maxY = pixels.height - 1;
  const edgeSteps = 8;
  for (let i = 0; i <= edgeSteps; i++) {
    const x = Math.round((maxX * i) / edgeSteps);
    const y = Math.round((maxY * i) / edgeSteps);
    samples.push([x, 0], [x, maxY], [0, y], [maxX, y]);
  }

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (const [x, y] of samples) {
    const idx = (y * pixels.width + x) * 4;
    const a = Number(pixels.data[idx + 3] ?? 255);
    if (a < 32) continue;
    const r = Number(pixels.data[idx] ?? 0);
    const g = Number(pixels.data[idx + 1] ?? 0);
    const b = Number(pixels.data[idx + 2] ?? 0);
    const key = `${Math.round(r / 16)}:${Math.round(g / 16)}:${Math.round(b / 16)}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  const best = Array.from(buckets.values()).sort((a, b) => b.count - a.count)[0];
  return best ? rgbToHex(best.r / best.count, best.g / best.count, best.b / best.count) : undefined;
}
