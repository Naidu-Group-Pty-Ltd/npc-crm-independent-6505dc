import type { PdfPageContext, PdfPageContextConsumerGuardrail } from '../pageContexts';
import type { ImportReviewArtifact } from '../review';

export const PAGE_CONTEXT_RENDER_ARTIFACT_MANIFEST_VERSION = 'page-context-render-artifact-manifest-v1';

export interface PageContextSourceRenderArtifact {
  pageId: string;
  pageNumber: number;
  sourceRasterPath: string | null;
  sourceRasterSignedUrl: string | null;
  doclingPath: string | null;
  blocksPath: string | null;
  tablesPath: string | null;
  picturesPath: string | null;
  summaryPath: string | null;
  // C2.2: optional OCR + vector artifacts.
  ocrPath?: string | null;
  vectorsPath?: string | null;
  width: number | null;
  height: number | null;
  hasParentGlobalArtifacts: boolean;
}

export interface PageContextRenderArtifactManifest {
  version: typeof PAGE_CONTEXT_RENDER_ARTIFACT_MANIFEST_VERSION;
  importId: string;
  source: 'pdfPageContexts';
  sourceContext: 'per_page_docling' | 'legacy_docling';
  expectedPageCount: number | null;
  observedPageCount: number;
  sourceRasterCount: number;
  doclingPageArtifactCount: number;
  problems: string[];
  pages: PageContextSourceRenderArtifact[];
  generatedAt: string;
}

function pageIdFor(pageNumber: number): string {
  return `docling-page-${pageNumber}`;
}

function stablePageNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

export function buildPageContextRenderArtifactManifest(options: {
  importId: string;
  pageContexts: PdfPageContext[];
  guardrail: PdfPageContextConsumerGuardrail;
  signedUrls?: Record<string, string> | null;
  now?: () => Date;
}): PageContextRenderArtifactManifest {
  const problems: string[] = [];
  const pages: PageContextSourceRenderArtifact[] = [];

  const sorted = [...(options.pageContexts ?? [])].sort((a, b) => a.page_no - b.page_no);

  for (const ctx of sorted) {
    const pageNumber = stablePageNumber(ctx.page_no);
    if (!pageNumber) {
      problems.push('invalid_page_number');
      continue;
    }

    const sourceRasterPath = ctx.artifacts.raster_path ?? null;
    const page: PageContextSourceRenderArtifact = {
      pageId: pageIdFor(pageNumber),
      pageNumber,
      sourceRasterPath,
      sourceRasterSignedUrl: options.signedUrls?.[`${pageNumber}:source`]
        ?? options.signedUrls?.[`${pageNumber}:raster`]
        ?? (sourceRasterPath ? options.signedUrls?.[sourceRasterPath] : undefined)
        ?? null,
      doclingPath: ctx.artifacts.docling_path ?? null,
      blocksPath: ctx.artifacts.blocks_path ?? null,
      tablesPath: ctx.artifacts.tables_path ?? null,
      picturesPath: ctx.artifacts.pictures_path ?? null,
      summaryPath: ctx.artifacts.summary_path ?? null,
      ocrPath: ctx.artifacts.ocr_path ?? null,
      vectorsPath: ctx.artifacts.vectors_path ?? null,
      width: ctx.width ?? null,
      height: ctx.height ?? null,
      hasParentGlobalArtifacts: Boolean(ctx.flags.has_parent_global_artifacts),
    };

    if (!page.sourceRasterPath) problems.push(`page_${pageNumber}_source_raster_missing`);
    if (!page.doclingPath) problems.push(`page_${pageNumber}_docling_path_missing`);
    if (!page.blocksPath) problems.push(`page_${pageNumber}_blocks_path_missing`);
    if (!page.summaryPath) problems.push(`page_${pageNumber}_summary_path_missing`);

    pages.push(page);
  }

  const expectedPageCount = options.guardrail.expected_page_count ?? null;

  if (expectedPageCount !== null && pages.length !== expectedPageCount) {
    problems.push(`page_count_mismatch: expected ${expectedPageCount}, got ${pages.length}`);
  }

  if (options.guardrail.selected_source !== 'per_page_docling') {
    problems.push(`source_context_not_per_page_docling:${options.guardrail.selected_source}`);
  }

  return {
    version: PAGE_CONTEXT_RENDER_ARTIFACT_MANIFEST_VERSION,
    importId: options.importId,
    source: 'pdfPageContexts',
    sourceContext: options.guardrail.selected_source,
    expectedPageCount,
    observedPageCount: pages.length,
    sourceRasterCount: pages.filter((page) => Boolean(page.sourceRasterPath)).length,
    doclingPageArtifactCount: pages.filter((page) => Boolean(page.doclingPath && page.blocksPath && page.summaryPath)).length,
    problems,
    pages,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}

export function pageContextRenderManifestToReviewArtifacts(
  manifest: PageContextRenderArtifactManifest,
): ImportReviewArtifact[] {
  return manifest.pages
    .filter((page) => Boolean(page.sourceRasterPath))
    .map((page) => ({
      id: `source-raster-page-${page.pageNumber}`,
      kind: 'source-raster',
      pageId: page.pageId,
      url: page.sourceRasterSignedUrl ?? undefined,
      meta: {
        version: manifest.version,
        importId: manifest.importId,
        pageNumber: page.pageNumber,
        storagePath: page.sourceRasterPath,
        signedUrlAvailable: Boolean(page.sourceRasterSignedUrl),
        doclingPath: page.doclingPath,
        blocksPath: page.blocksPath,
        tablesPath: page.tablesPath,
        picturesPath: page.picturesPath,
        summaryPath: page.summaryPath,
        ocrPath: page.ocrPath,
        vectorsPath: page.vectorsPath,
        width: page.width,
        height: page.height,
        hasParentGlobalArtifacts: page.hasParentGlobalArtifacts,
      },
    }));
}
