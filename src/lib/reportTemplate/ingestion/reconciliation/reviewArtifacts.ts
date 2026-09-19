import type { ImportReviewArtifact } from '../review';
import type { ImportAsset } from './types';

export interface ImportAssetSummary {
  fileType: ImportAsset['fileType'];
  pageCount: number;
  sourcePages: number;
  averageDpiScale: number;
  dimensions: Array<{ pageIndex: number; width: number; height: number }>;
}

export function summarizeImportAsset(asset: ImportAsset | null | undefined): ImportAssetSummary | null {
  if (!asset) return null;
  const sourcePages = asset.pages.filter((page) => Boolean(page.referenceImageUrl)).length;
  const averageDpiScale = asset.pages.length
    ? asset.pages.reduce((sum, page) => sum + (Number.isFinite(page.dpiScale) ? page.dpiScale : 1), 0) / asset.pages.length
    : 0;
  return {
    fileType: asset.fileType,
    pageCount: asset.pages.length,
    sourcePages,
    averageDpiScale,
    dimensions: asset.pages.map((page) => ({ pageIndex: page.pageIndex, width: page.width, height: page.height })),
  };
}

export function importAssetToReviewArtifacts(asset: ImportAsset | null | undefined): ImportReviewArtifact[] {
  if (!asset?.pages.length) return [];
  return asset.pages
    .filter((page) => Boolean(page.referenceImageUrl))
    .map((page) => ({
      id: `${asset.fileId}_${page.id}_source_raster`,
      kind: 'source-raster' as const,
      pageId: page.id,
      dataUrl: page.referenceImageUrl.startsWith('data:') ? page.referenceImageUrl : undefined,
      url: page.referenceImageUrl.startsWith('data:') ? undefined : page.referenceImageUrl,
      meta: {
        fileId: asset.fileId,
        fileType: asset.fileType,
        fileName: asset.fileName,
        pageIndex: page.pageIndex,
        width: page.width,
        height: page.height,
        dpiScale: page.dpiScale,
        source: page.source,
        backgroundColor: page.backgroundColor,
      },
    }));
}
