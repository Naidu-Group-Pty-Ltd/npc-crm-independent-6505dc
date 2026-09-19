import type { ReportTemplate } from '../../templateSchema';
import { renderTemplateToHtml } from '../../htmlRenderer';
import type { ImportReviewArtifact } from '../review';

export const GENERATED_RENDER_ARTIFACT_MANIFEST_VERSION = 'generated-render-artifact-manifest-v1';

export interface GeneratedRenderPageRaster {
  pageId: string;
  pageNumber: number;
  width: number;
  height: number;
  imageData: ImageData;
  dataUrl: string;
}

export interface GeneratedRenderArtifactPage {
  pageId: string;
  pageNumber: number;
  width: number;
  height: number;
  dataUrlAvailable: boolean;
}

export interface GeneratedRenderArtifactManifest {
  version: typeof GENERATED_RENDER_ARTIFACT_MANIFEST_VERSION;
  importId: string;
  pageCount: number;
  generatedRasterCount: number;
  pages: GeneratedRenderArtifactPage[];
  problems: string[];
  generatedAt: string;
}

export interface CaptureGeneratedRenderOptions {
  importId: string;
  /** Existing same-origin rendered document. Preferred when the preview iframe already exists. */
  document?: Document | null;
  /** Existing root element containing `.tpl-page` nodes. */
  root?: ParentNode | null;
  /** Optional template to render into a temporary hidden iframe. */
  template?: ReportTemplate | unknown;
  data?: Record<string, unknown>;
  tokenOverrides?: Record<string, unknown>;
  title?: string;
  /** Limit capture to specific 1-based page numbers. */
  pageNumbers?: number[];
  /** html2canvas scale. Keep 1 by default for cheaper review artifacts. */
  scale?: number;
  /** Canvas background. Defaults to white to match PDF page rendering. */
  backgroundColor?: string;
  /** Cap pages for safety in UI-triggered runs. */
  maxPages?: number;
  now?: () => Date;
}

function pageIdFor(pageNumber: number, el?: Element | null): string {
  const attr = el?.getAttribute('data-page-id');
  if (attr) return attr;
  return `docling-page-${pageNumber}`;
}

function makeCanvasImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2d context unavailable');
  return ctx.getImageData(0, 0, Math.max(1, canvas.width), Math.max(1, canvas.height));
}

async function waitForFonts(doc: Document): Promise<void> {
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.ready) {
    await fonts.ready.catch(() => undefined);
  }
}

async function waitForImages(root: ParentNode): Promise<void> {
  const imgs = Array.from((root as Document | Element).querySelectorAll?.('img') ?? []) as HTMLImageElement[];
  await Promise.all(imgs.map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
      setTimeout(resolve, 3500);
    });
  }));
}

function selectedPages(pages: HTMLElement[], pageNumbers?: number[], maxPages?: number): HTMLElement[] {
  const wanted = pageNumbers?.length ? new Set(pageNumbers.map(Number).filter((n) => Number.isFinite(n) && n > 0)) : null;
  const out = pages.filter((_, idx) => !wanted || wanted.has(idx + 1));
  return out.slice(0, Math.max(1, maxPages ?? out.length));
}

async function capturePagesFromRoot(options: CaptureGeneratedRenderOptions & { root: ParentNode }): Promise<GeneratedRenderPageRaster[]> {
  const html2canvasModule = await import('html2canvas');
  const html2canvas = html2canvasModule.default;

  const root = options.root;
  const doc = options.document ?? ('ownerDocument' in root ? (root as Element).ownerDocument : document);

  await waitForFonts(doc);
  await waitForImages(root);

  const allPages = Array.from((root as Document | Element).querySelectorAll?.('.tpl-page') ?? []) as HTMLElement[];
  const pages = selectedPages(allPages, options.pageNumbers, options.maxPages);

  const rasters: GeneratedRenderPageRaster[] = [];
  for (const pageEl of pages) {
    const pageNumber = allPages.indexOf(pageEl) + 1;
    if (pageNumber < 1) continue;

    const canvas = await html2canvas(pageEl, {
      backgroundColor: options.backgroundColor ?? '#ffffff',
      scale: Math.max(0.25, Math.min(3, options.scale ?? 1)),
      useCORS: true,
      allowTaint: false,
      logging: false,
      windowWidth: Math.ceil(pageEl.scrollWidth || pageEl.getBoundingClientRect().width || 1),
      windowHeight: Math.ceil(pageEl.scrollHeight || pageEl.getBoundingClientRect().height || 1),
    });

    rasters.push({
      pageId: pageIdFor(pageNumber, pageEl),
      pageNumber,
      width: canvas.width,
      height: canvas.height,
      imageData: makeCanvasImageData(canvas),
      dataUrl: canvas.toDataURL('image/png'),
    });
  }

  return rasters;
}

async function withTemporaryIframe<T>(html: string, fn: (iframe: HTMLIFrameElement) => Promise<T>): Promise<T> {
  if (typeof document === 'undefined') {
    throw new Error('Generated render capture requires a browser document.');
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '-100000px';
  iframe.style.top = '0';
  iframe.style.width = '1200px';
  iframe.style.height = '1600px';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.border = '0';

  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('Could not create temporary render document.');
    doc.open();
    doc.write(html);
    doc.close();

    await new Promise<void>((resolve) => {
      if (iframe.contentDocument?.readyState === 'complete') return resolve();
      iframe.addEventListener('load', () => resolve(), { once: true });
      setTimeout(resolve, 1200);
    });

    return await fn(iframe);
  } finally {
    iframe.remove();
  }
}

export async function captureGeneratedTemplatePageRasters(
  options: CaptureGeneratedRenderOptions,
): Promise<GeneratedRenderPageRaster[]> {
  if (options.root) {
    return capturePagesFromRoot({ ...options, root: options.root });
  }

  if (options.document) {
    return capturePagesFromRoot({ ...options, document: options.document, root: options.document });
  }

  if (!options.template) {
    throw new Error('Generated render capture requires either root, document, or template.');
  }

  const rendered = renderTemplateToHtml(options.template, {
    data: options.data,
    tokenOverrides: options.tokenOverrides as any,
    title: options.title,
  });

  return withTemporaryIframe(rendered.html, async (iframe) => {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('Temporary render document unavailable.');
    return capturePagesFromRoot({ ...options, document: doc, root: doc });
  });
}

export function buildGeneratedRenderArtifactManifest(options: {
  importId: string;
  rasters: GeneratedRenderPageRaster[];
  expectedPageCount?: number | null;
  now?: () => Date;
}): GeneratedRenderArtifactManifest {
  const rasters = [...(options.rasters ?? [])].sort((a, b) => a.pageNumber - b.pageNumber);
  const problems: string[] = [];

  const expected = options.expectedPageCount ?? null;
  if (expected !== null && rasters.length !== expected) {
    problems.push(`generated_page_count_mismatch: expected ${expected}, got ${rasters.length}`);
  }

  for (const raster of rasters) {
    if (!raster.dataUrl) problems.push(`page_${raster.pageNumber}_generated_data_url_missing`);
    if (!raster.imageData) problems.push(`page_${raster.pageNumber}_generated_image_data_missing`);
    if (!Number.isFinite(raster.width) || raster.width <= 0) problems.push(`page_${raster.pageNumber}_generated_width_invalid`);
    if (!Number.isFinite(raster.height) || raster.height <= 0) problems.push(`page_${raster.pageNumber}_generated_height_invalid`);
  }

  return {
    version: GENERATED_RENDER_ARTIFACT_MANIFEST_VERSION,
    importId: options.importId,
    pageCount: expected ?? rasters.length,
    generatedRasterCount: rasters.filter((raster) => Boolean(raster.dataUrl && raster.imageData)).length,
    pages: rasters.map((raster) => ({
      pageId: raster.pageId,
      pageNumber: raster.pageNumber,
      width: raster.width,
      height: raster.height,
      dataUrlAvailable: Boolean(raster.dataUrl),
    })),
    problems,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}

export function generatedRenderRastersToReviewArtifacts(options: {
  importId: string;
  rasters: GeneratedRenderPageRaster[];
}): ImportReviewArtifact[] {
  return [...(options.rasters ?? [])]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((raster) => ({
      id: `generated-raster-page-${raster.pageNumber}`,
      kind: 'reconstructed-raster',
      pageId: raster.pageId,
      dataUrl: raster.dataUrl,
      meta: {
        version: GENERATED_RENDER_ARTIFACT_MANIFEST_VERSION,
        importId: options.importId,
        pageNumber: raster.pageNumber,
        width: raster.width,
        height: raster.height,
      },
    }));
}
