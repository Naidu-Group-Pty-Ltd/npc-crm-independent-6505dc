/**
 * An asset that cannot be brought inside the render boundary is left out —
 * never carried into it.
 *
 * ## The defect this guards against returning
 *
 * `preloadImages` ran before binding resolution and skipped `{{…}}` by design,
 * leaving them to the block renderers. Correct for text, fatal for assets: an
 * `image` block whose `src` is a binding — including the block registry's own
 * default, `{{property.imageUrl}}` — resolved to a remote URL at paint time,
 * after the only step that could have normalised it. And a literal remote URL
 * whose fetch failed was left in place rather than dropped.
 *
 * Either way a URL outside the project origin reached
 * `assertSafeRenderResources`, which refused the **whole document** for one
 * picture. Through the production route that degraded to the legacy generator
 * — a document arrived, in a design nobody chose. Through the Template
 * Builder's export it produced no file at all: "Export failed".
 *
 * The rule this file pins is the one `adapters/organisation.ts` already states
 * for brand marks: *a logo that could not be fetched is a thinner document,
 * not a failed one.*
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compileTemplateHtmlForPdf,
  describeDroppedAssets,
} from '../compileTemplateForPdf';
import { parseTemplate } from '../templateSchema';
import { assertSafeRenderResources } from '../../../../supabase/functions/_shared/renderResourcePolicy.pure';

const PROJECT = 'https://dduzbchuswwbefdunfct.supabase.co';

const templateWith = (blocks: unknown[]) => parseTemplate({
  version: 1,
  name: 'Probe',
  tokens: { colors: { ink: '#111111' }, fonts: {}, spacing: {} },
  slots: {},
  pages: [{
    id: 'p1', name: 'Page', size: { width: 595, height: 842 },
    background: {}, blocks,
  }],
});

const imageBlock = (src: string) => ({
  id: 'img-1',
  type: 'image',
  props: { x: 0, y: 0, width: 200, height: 150, src },
  overlays: [],
});

const reachable = () => vi.fn(async () => new Response(
  new Uint8Array([137, 80, 78, 71]),
  { status: 200, headers: { 'content-type': 'image/png' } },
));
const unreachable = () => vi.fn(async () => { throw new TypeError('Failed to fetch'); });

beforeEach(() => { vi.unstubAllGlobals(); });

describe('an asset named by a binding', () => {
  it('is fetched and inlined, so the picture actually reaches the page', async () => {
    // Not merely "does not fail" — the point is that the image appears. This
    // path could not normalise a bound asset at all before, so the choice was
    // between a refused document and no picture; now it is neither.
    vi.stubGlobal('fetch', reachable());
    const { html, droppedAssets } = await compileTemplateHtmlForPdf(
      templateWith([imageBlock('{{property.imageUrl}}')]),
      { data: { property: { imageUrl: 'https://images.unsplash.com/bound-ok?w=800' } } },
    );
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain('unsplash');
    expect(droppedAssets).toEqual([]);
    expect(() => assertSafeRenderResources(html, PROJECT)).not.toThrow();
  });

  it('is dropped when it cannot be fetched, and the document survives', async () => {
    vi.stubGlobal('fetch', unreachable());
    const { html, droppedAssets } = await compileTemplateHtmlForPdf(
      templateWith([imageBlock('{{property.imageUrl}}')]),
      { data: { property: { imageUrl: 'https://images.unsplash.com/bound-unreachable?w=1' } } },
    );
    expect(() => assertSafeRenderResources(html, PROJECT)).not.toThrow();
    expect(html).not.toContain('unsplash');
    expect(droppedAssets).toEqual([
      { where: 'image img-1.src', url: 'https://images.unsplash.com/bound-unreachable?w=1' },
    ]);
  });

  it('names the block it dropped, in words a person can act on', () => {
    // The alternative is what this replaced: a 500 from the trust boundary
    // naming a URL, and nothing naming the block or the page.
    expect(describeDroppedAssets([{ where: 'image img-1.src', url: 'https://x/y.png' }]))
      .toContain('image img-1.src');
    expect(describeDroppedAssets([])).toBeNull();
  });
});

describe('a literal remote asset', () => {
  it('is dropped rather than carried when the fetch fails', async () => {
    // The chart block's registry default is a literal `quickchart.io` URL.
    // `preloadImages` tried it, and on failure left the URL in place — so a
    // report that would merely have lost one chart failed entirely.
    vi.stubGlobal('fetch', unreachable());
    const { html, droppedAssets } = await compileTemplateHtmlForPdf(
      templateWith([{
        id: 'chart-1', type: 'chart',
        props: { x: 0, y: 0, width: 300, height: 200, chartUrl: 'https://quickchart.io/chart?c={}' },
        overlays: [],
      }]),
      { data: {} },
    );
    expect(() => assertSafeRenderResources(html, PROJECT)).not.toThrow();
    expect(droppedAssets).toHaveLength(1);
    expect(droppedAssets[0].where).toBe('chart chart-1.chartUrl');
  });

  it('leaves a project-storage reference exactly as it is', async () => {
    // `reference` mode depends on this: a page raster is deliberately left as
    // a signed project-storage link for WeasyPrint to fetch itself, and the
    // boundary admits it. Dropping those would blank every imported page.
    vi.stubGlobal('fetch', unreachable());
    const signed = `${PROJECT}/storage/v1/object/sign/pdf-import/page-001.png?token=x`;
    const { html, droppedAssets } = await compileTemplateHtmlForPdf(
      templateWith([imageBlock(signed)]), { data: {} },
    );
    expect(droppedAssets).toEqual([]);
    expect(html).toContain('/storage/v1/object/sign/pdf-import/page-001.png');
    expect(() => assertSafeRenderResources(html, PROJECT)).not.toThrow();
  });
});

describe('the compiler is where this happens', () => {
  it('so no caller can produce HTML the renderer will refuse for an asset', async () => {
    const code = readSource('../compileTemplateForPdf.ts');
    expect(code, 'the compiler no longer resolves assets against the render data')
      .toMatch(/data:\s*options\.data/);
    expect(code, 'the compiler no longer knows which origin the boundary admits')
      .toMatch(/supabaseUrl:\s*RENDER_PROJECT_URL/);
  });
});

function readSource(rel: string): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(__dirname, rel), 'utf8');
}
