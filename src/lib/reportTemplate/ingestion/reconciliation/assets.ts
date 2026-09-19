import { computePageSize } from '../../imageGrounding';
import type { ImportAsset, ImportPage } from './types';
import { shortHash, stableImportId } from './ids';

export interface ImageImportAssetArgs {
  dataUrl: string;
  imageWidth: number;
  imageHeight: number;
  fileName?: string;
  fileId?: string;
  backgroundColor?: string;
}

export interface PdfRenderedPageAssetArgs {
  pageIndex: number;
  width: number;
  height: number;
  referenceImageUrl: string;
  dpiScale?: number;
  backgroundColor?: string;
}

export interface PdfImportAssetArgs {
  fileName?: string;
  fileId?: string;
  pages: PdfRenderedPageAssetArgs[];
}

export function createImageImportAsset(args: ImageImportAssetArgs): ImportAsset {
  const fingerprint = `${args.fileName ?? 'image'}:${args.imageWidth}x${args.imageHeight}:${args.dataUrl.length}:${shortHash(args.dataUrl.slice(0, 4096))}`;
  const fileId = args.fileId ?? stableImportId('image_import', fingerprint);
  const { pageWidth, pageHeight } = computePageSize(args.imageWidth, args.imageHeight);
  const page: ImportPage = {
    id: `${fileId}_page_1`,
    pageIndex: 0,
    width: pageWidth,
    height: pageHeight,
    referenceImageUrl: args.dataUrl,
    dpiScale: args.imageWidth / Math.max(1, pageWidth),
    source: 'image-normalized',
    backgroundColor: args.backgroundColor,
  };
  return {
    fileId,
    fileName: args.fileName,
    fileType: 'image',
    pages: [page],
    createdAt: new Date().toISOString(),
  };
}

export function createPdfImportAsset(args: PdfImportAssetArgs): ImportAsset {
  const fingerprint = `${args.fileName ?? 'pdf'}:${args.pages.length}:${args.pages.map((p) => `${p.pageIndex}:${p.width}x${p.height}:${p.referenceImageUrl.length}:${shortHash(p.referenceImageUrl.slice(0, 2048))}`).join('|')}`;
  const fileId = args.fileId ?? stableImportId('pdf_import', fingerprint);
  return {
    fileId,
    fileName: args.fileName,
    fileType: 'pdf',
    pages: args.pages.map((page) => ({
      id: `${fileId}_page_${page.pageIndex + 1}`,
      pageIndex: page.pageIndex,
      width: page.width,
      height: page.height,
      referenceImageUrl: page.referenceImageUrl,
      dpiScale: page.dpiScale ?? 1,
      source: 'pdf-render',
      backgroundColor: page.backgroundColor,
    })),
    createdAt: new Date().toISOString(),
  };
}
