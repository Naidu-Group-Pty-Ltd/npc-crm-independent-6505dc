/**
 * The property's photographs reach the photo slots the masters already bind.
 *
 * Five Compass masters bind `property.images.N` for a cover hero and full-page
 * plates, and until now nothing ever filled it. The broker returns short-lived
 * signed URLs; this half turns them into `data:` URIs the renderer can draw
 * without a network request, and binds them. Every failure drops a photograph
 * and nothing else — a missing picture is what every slot is designed for.
 */
import { describe, expect, it } from 'vitest';

import {
  inlineReportPhotographs,
  MAX_LONG_EDGE_PX,
  MAX_PASSTHROUGH_BYTES,
  type PhotographDeps,
} from '../adapters/reportPhotographs';

const blob = (type: string, size: number) => new Blob([new Uint8Array(size)], { type });

function deps(files: Record<string, Blob | 'fail' | 404>): PhotographDeps & { redrawn: string[]; fetched: string[] } {
  const redrawn: string[] = [];
  const fetched: string[] = [];
  return {
    redrawn,
    fetched,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      const file = files[url];
      if (file === 'fail' || file === undefined) throw new Error('network');
      if (file === 404) return { ok: false, status: 404, headers: new Headers(), blob: async () => new Blob([]) } as unknown as Response;
      // A plain stand-in: the test environment's `Response` does not carry a
      // Blob's type through, which is a property of the harness, not of this.
      return {
        ok: true, status: 200, headers: new Headers({ 'content-type': file.type }), blob: async () => file,
      } as unknown as Response;
    }) as typeof fetch,
    toDataUrl: async (b) => `data:${b.type};base64,AAAA${b.size}`,
    redraw: async (b, edge) => {
      redrawn.push(`${b.type}@${edge}`);
      return b.type === 'image/avif' || b.size > MAX_PASSTHROUGH_BYTES ? 'data:image/jpeg;base64,REDRAWN' : null;
    },
  };
}

describe('turning signed URLs into what the renderer can draw', () => {
  it('a web-sized JPEG, PNG or WebP travels byte for byte', async () => {
    const d = deps({
      'https://s/a.jpg': blob('image/jpeg', 300_000),
      'https://s/b.png': blob('image/png', 200_000),
      'https://s/c.webp': blob('image/webp', 100_000),
    });
    const out = await inlineReportPhotographs(
      [{ url: 'https://s/a.jpg' }, { url: 'https://s/b.png' }, { url: 'https://s/c.webp' }], d,
    );
    expect(out).toEqual([
      'data:image/jpeg;base64,AAAA300000',
      'data:image/png;base64,AAAA200000',
      'data:image/webp;base64,AAAA100000',
    ]);
    expect(d.redrawn).toEqual([]);
  });

  it('a camera original, or a format the print engine may not read, is redrawn to print size', async () => {
    const d = deps({
      'https://s/big.jpg': blob('image/jpeg', MAX_PASSTHROUGH_BYTES + 1),
      'https://s/new.avif': blob('image/avif', 90_000),
    });
    const out = await inlineReportPhotographs([{ url: 'https://s/big.jpg' }, { url: 'https://s/new.avif' }], d);
    expect(out).toEqual(['data:image/jpeg;base64,REDRAWN', 'data:image/jpeg;base64,REDRAWN']);
    expect(d.redrawn).toEqual([`image/jpeg@${MAX_LONG_EDGE_PX}`, `image/avif@${MAX_LONG_EDGE_PX}`]);
  });

  it('every failure drops that photograph and keeps the order of the rest', async () => {
    const d = deps({
      'https://s/1.jpg': blob('image/jpeg', 1000),
      'https://s/2.jpg': 404,
      'https://s/3.jpg': 'fail',
      'https://s/4.html': blob('text/html', 1000),
      'https://s/5.jpg': blob('image/jpeg', 2000),
    });
    const out = await inlineReportPhotographs(
      ['1.jpg', '2.jpg', '3.jpg', '4.html', '5.jpg'].map((f) => ({ url: `https://s/${f}` })), d,
    );
    expect(out).toEqual(['data:image/jpeg;base64,AAAA1000', 'data:image/jpeg;base64,AAAA2000']);
  });

  it('asks for nothing that is not https, and nothing at all for no photographs', async () => {
    const d = deps({});
    expect(await inlineReportPhotographs([{ url: 'http://s/x.jpg' }, { url: 'data:image/png;base64,AA' }], d)).toEqual([]);
    expect(await inlineReportPhotographs([], d)).toEqual([]);
    expect(await inlineReportPhotographs(null, d)).toEqual([]);
    expect(d.fetched).toEqual([]);
  });
});
