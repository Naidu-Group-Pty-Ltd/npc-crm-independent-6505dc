/**
 * The inline-asset policy.
 *
 * This is the only thing standing between a tenant's upload form and the render
 * container. Three of the checks below are security properties rather than
 * quality ones:
 *
 *  - **A URL is refused.** `weasyprint-service/app.py` will happily fetch an
 *    `https://` resource after resolving it; that is a request originating from
 *    inside the render network on behalf of whoever filled in the settings form.
 *  - **SVG is refused.** An SVG can carry `<image href="http://…">` and
 *    `<script>`, and the SSRF guard inspects the URL it is handed — it does not
 *    parse the inside of a `data:` URI.
 *  - **Size is bounded before the POST.** A 413 from the render service names
 *    nothing; a rejection here names the asset and the reason.
 */
import { describe, expect, it } from 'vitest';
import {
  ASSET_FALLBACK,
  HTML_BUDGET_BYTES,
  INLINE_MIME_ALLOW,
  MAX_ASSET_BYTES,
  MAX_TOTAL_ASSET_BYTES,
  assetBudget,
  base64ByteLength,
  readImageDimensions,
  MIN_ASSET_EDGE_PX,
  inlineAsset,
  resolveReportAsset,
  type InlineAsset,
} from '../assets.pure';

/** A valid PNG data URI of a given decoded size. */
function pngOf(bytes: number): string {
  const base64 = 'A'.repeat(Math.ceil((bytes * 4) / 3));
  return `data:image/png;base64,${base64}`;
}

const SMALL_PNG = pngOf(1024);

describe('base64ByteLength', () => {
  it.each([
    ['QQ==', 1],
    ['QUJD', 3],
    ['QUJDRA==', 4],
  ])('%s decodes to %i bytes', (b64, bytes) => {
    expect(base64ByteLength(b64)).toBe(bytes);
  });

  it('never decodes the payload — the arithmetic is exact', () => {
    // A 40 MB string must be rejected without materialising 40 MB of buffer.
    const huge = 'A'.repeat(40 * 1024 * 1024);
    expect(base64ByteLength(huge)).toBe(30 * 1024 * 1024);
  });
});

describe('inlineAsset', () => {
  it('accepts a well-formed raster data URI', () => {
    const result = inlineAsset(SMALL_PNG);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.asset.mime).toBe('image/png');
      expect(result.asset.bytes).toBe(1024);
      expect(result.asset.dataUri).toBe(SMALL_PNG);
    }
  });

  it.each(INLINE_MIME_ALLOW)('accepts %s', (mime) => {
    expect(inlineAsset(`data:${mime};base64,QUJD`).ok).toBe(true);
  });

  it('refuses a URL, which is the whole point of the policy', () => {
    const result = inlineAsset('https://cdn.example.com/logo.png');
    expect(result).toMatchObject({ ok: false, reason: 'not-a-data-uri' });
  });

  it('refuses a file:// or other scheme just as firmly', () => {
    expect(inlineAsset('file:///etc/passwd')).toMatchObject({ reason: 'not-a-data-uri' });
    expect(inlineAsset('//evil.example.com/logo.png')).toMatchObject({ reason: 'not-a-data-uri' });
  });

  it('refuses SVG — the SSRF guard cannot see inside a data URI', () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zz48aW1hZ2UgaHJlZj0iaHR0cDovL2EiLz48L3N2Zz4=';
    expect(inlineAsset(svg)).toMatchObject({ ok: false, reason: 'unsupported-mime' });
  });

  it('refuses a non-base64 data URI', () => {
    expect(inlineAsset('data:image/png,%89PNG')).toMatchObject({ reason: 'not-base64' });
    expect(inlineAsset('data:image/png;base64,not base64!')).toMatchObject({ reason: 'not-base64' });
  });

  it('refuses an oversized asset and says by how much', () => {
    const result = inlineAsset(pngOf(MAX_ASSET_BYTES + 1024));
    expect(result).toMatchObject({ ok: false, reason: 'too-large' });
    expect(String((result as { detail?: string }).detail ?? '')).toContain(String(MAX_ASSET_BYTES));
  });

  it('honours a caller-supplied cap', () => {
    expect(inlineAsset(SMALL_PNG, { maxBytes: 100 })).toMatchObject({ reason: 'too-large' });
  });

  it('treats empty, null and undefined as "not configured", not as an error', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(inlineAsset(value)).toMatchObject({ ok: false, reason: 'empty' });
    }
  });

  it('gives a reason on every rejection — "the logo did not appear" is a ticket', () => {
    for (const value of [null, 'https://x/y.png', 'data:image/svg+xml;base64,QQ==', pngOf(9e6)]) {
      const result = inlineAsset(value);
      expect(result.ok).toBe(false);
      expect(String((result as { detail?: string }).detail ?? '').length).toBeGreaterThan(10);
    }
  });
});

describe('resolveReportAsset', () => {
  it('prefers the report mark when there is one', () => {
    const { resolved } = resolveReportAsset(
      { report: SMALL_PNG, sidebar: pngOf(2048) },
      'report',
    );
    expect(resolved?.source).toBe('report');
  });

  it('falls back to the UI marks so a tenant is never unbranded', () => {
    const { resolved } = resolveReportAsset({ sidebar: SMALL_PNG }, 'report');
    expect(resolved?.source).toBe('sidebar');
  });

  it('keeps walking past a key that fails policy, and says why it skipped', () => {
    // A tenant whose report mark is a 12 MB PNG still gets their sidebar logo
    // rather than a blank space.
    const { resolved, skipped } = resolveReportAsset(
      { report: pngOf(12 * 1024 * 1024), sidebar: SMALL_PNG },
      'report',
    );
    expect(resolved?.source).toBe('sidebar');
    expect(skipped).toEqual([
      expect.objectContaining({ source: 'report', reason: 'too-large' }),
    ]);
  });

  it('resolves nothing, and skips nothing, when nothing is configured', () => {
    expect(resolveReportAsset({}, 'report')).toEqual({ resolved: null, skipped: [] });
  });

  it('lets the mono slot fall back to the colour mark but never the reverse', () => {
    // A colour lockup on obsidian usually survives; a knockout white mark on
    // ivory paper never does.
    expect(ASSET_FALLBACK['report-mono']).toContain('report');
    expect(ASSET_FALLBACK.report).not.toContain('reportMono');
  });

  it('resolves cover art only from the cover key', () => {
    expect(resolveReportAsset({ sidebar: SMALL_PNG }, 'cover').resolved).toBeNull();
    expect(resolveReportAsset({ cover: SMALL_PNG }, 'cover').resolved?.source).toBe('cover');
  });
});

describe('image dimensions', () => {
  /**
   * The byte cap says nothing about how big the picture is, and `logo_config`
   * accepts whatever the tenant uploads. A favicon passes every other check and
   * prints on the cover as a 22mm blurred square — seen in a real render, which
   * is why this check exists.
   */
  const png128 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAA8klEQVR42u3SMQ0AAAjAMOQgGzm4Ahsk9JiBpdGVo7+FCQAYAYAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAgAAEwAwAgABIAAEgAAQAAJAAAgAASAABIAAEAACQAAIAAEgAASAABAAAkAACAABIAAEgAAQAAJAAAgAASAABIAAEAACQDdaLmbJjrk146QAAAAASUVORK5CYII=';
  const png64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAZUlEQVR42u3QQREAAAQAMHHEFkcrcjh7rMCiK+ezECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAgQIECBAgAABAu5b62fyWd5N7L4AAAAASUVORK5CYII=';
  const jpeg320x200 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/wAARCADIAUADAREAAiEAAzEA/9k=';

  it('reads a PNG size from its IHDR', () => {
    expect(readImageDimensions('image/png', png128.split(',')[1])).toEqual({ width: 128, height: 128 });
  });

  /** Not at a fixed offset: an APP0 or EXIF block precedes the frame header. */
  it('walks a JPEG marker chain to its frame header', () => {
    expect(readImageDimensions('image/jpeg', jpeg320x200.split(',')[1])).toEqual({ width: 320, height: 200 });
  });

  it('admits it cannot measure a WebP rather than guessing', () => {
    expect(readImageDimensions('image/webp', 'UklGRg==')).toBeNull();
  });

  it('accepts a mark large enough to print, and carries its size', () => {
    const result = inlineAsset(png128);
    expect(result.ok).toBe(true);
    expect(result.ok && result.asset.dimensions).toEqual({ width: 128, height: 128 });
  });

  it('refuses one that would print soft, and says how big it was', () => {
    const result = inlineAsset(png64);
    expect(result.ok).toBe(false);
    const rejected = result as { ok: false; reason: string; detail: string };
    expect(rejected.reason).toBe('too-small');
    expect(rejected.detail).toContain('64x64');
    expect(rejected.detail).toContain(String(MIN_ASSET_EDGE_PX));
  });

  /**
   * An unmeasurable asset is accepted. Refusing to print a logo because its
   * header could not be read is worse than printing one that might be small.
   */
  it('accepts an asset it cannot measure', () => {
    const result = inlineAsset('data:image/webp;base64,UklGRhAAAABXRUJQVlA4TAMAAAAvAAAAAA==');
    expect(result.ok).toBe(true);
    expect(result.ok && result.asset.dimensions).toBeNull();
  });

  it('walks past a too-small mark to the next asset in the chain', () => {
    const { resolved, skipped } = resolveReportAsset({ report: png64, sidebar: png128 }, 'report');
    expect(resolved?.source).toBe('sidebar');
    expect(skipped).toEqual([
      expect.objectContaining({ source: 'report', reason: 'too-small' }),
    ]);
  });
});

describe('assetBudget', () => {
  const asset = (bytes: number): InlineAsset =>
    ({ dataUri: pngOf(bytes), mime: 'image/png', bytes, dimensions: null });

  it('accounts for base64 overhead rather than the decoded size alone', () => {
    const { totalBytes, encodedBytes } = assetBudget([asset(3000)]);
    expect(totalBytes).toBe(3000);
    expect(encodedBytes).toBeGreaterThan(4000);
  });

  it('passes a realistic document — a mark, a mono mark and a cover', () => {
    expect(assetBudget([asset(200_000), asset(200_000), asset(1_600_000)]).withinBudget).toBe(true);
  });

  it('fails a set that individually passes but collectively does not', () => {
    const three = [asset(3_000_000), asset(3_000_000), asset(3_000_000)];
    for (const a of three) expect(a.bytes).toBeLessThanOrEqual(MAX_ASSET_BYTES);
    expect(assetBudget(three).withinBudget).toBe(false);
  });

  it('leaves the document an order of magnitude more room than the assets take', () => {
    expect(MAX_TOTAL_ASSET_BYTES).toBeLessThan(HTML_BUDGET_BYTES / 3);
  });

  it('is empty-safe', () => {
    expect(assetBudget([])).toMatchObject({ totalBytes: 0, withinBudget: true });
  });
});
