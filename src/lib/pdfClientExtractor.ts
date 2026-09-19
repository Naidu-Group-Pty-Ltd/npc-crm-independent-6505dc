/**
 * Browser PDF text extraction.
 *
 * PDF.js is lazy-loaded from the build-pinned browser utility; the extracted
 * glyph runs are reconstructed into reading-order lines by `pdfTextLayout` and
 * cleaned by the shared text-hygiene rules, so downstream consumers (the agent
 * file extractor, the Formara form parser, the checklist importer and Report QA)
 * all receive the same well-formed text.
 */
import { loadPdfjs as getPdfJs } from '@/lib/pdf/pdfjs';
import { renderPageText, type PdfTextItemLike } from '@/lib/documentText/pdfTextLayout';
import {
  assessTextQuality,
  dehyphenateWrappedLines,
  normalizeDocumentText,
} from '@/lib/documentText/textHygiene';

export interface ExtractionResult {
  text: string;
  totalPages: number;
  /** Pages that yielded at least one character of text. */
  extractedPages: number;
  /** Pages PDF.js could not read at all — reported instead of silently lost. */
  failedPages: number[];
  /**
   * True when the text layer looks like a broken decode (or is effectively
   * absent), i.e. the caller should rasterise and use vision/OCR instead.
   */
  likelyNeedsOcr: boolean;
}

export type ProgressCallback = (current: number, total: number) => void;

export interface ExtractPdfTextOptions {
  /** Prefix each page with a `--- Page N ---` marker. Default true. */
  includePageMarkers?: boolean;
  /** Stop after this many pages (0 = all). Default 0. */
  maxPages?: number;
  /** Re-join words split across a line break (`develop-\nment`). Default true. */
  dehyphenate?: boolean;
}

/** Chars of real text below which a document is treated as scanned/image-only. */
const OCR_TEXT_THRESHOLD = 100;

/**
 * Extract text from a PDF in the browser.
 *
 * Resilient by design: a page that throws is recorded in `failedPages` and the
 * remaining pages are still extracted, where the previous implementation let a
 * single malformed page abort the whole document. PDF.js page and document
 * resources are released as we go so a large file does not pin hundreds of
 * megabytes of glyph caches in the tab.
 */
export async function extractPdfTextClientSide(
  file: File | Blob | ArrayBuffer,
  onProgress?: ProgressCallback,
  options: ExtractPdfTextOptions = {},
): Promise<ExtractionResult> {
  const { includePageMarkers = true, maxPages = 0, dehyphenate = true } = options;

  const arrayBuffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: arrayBuffer,
    useSystemFonts: true,
    // Disabling the eval-based font renderer costs nothing for text extraction
    // and keeps the extractor usable under a strict CSP.
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const pageLimit = maxPages > 0 ? Math.min(maxPages, totalPages) : totalPages;

  const pageTexts: string[] = [];
  const failedPages: number[] = [];
  let extractedPages = 0;

  try {
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      let page: Awaited<ReturnType<typeof pdf.getPage>> | null = null;
      try {
        page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = renderPageText(content.items as unknown as PdfTextItemLike[]);
        if (pageText.trim()) {
          pageTexts.push(
            includePageMarkers ? `--- Page ${pageNumber} ---\n${pageText}` : pageText,
          );
          extractedPages += 1;
        }
      } catch (error) {
        // One broken page must not cost the caller the other 99.
        failedPages.push(pageNumber);
        console.warn(`[pdfClientExtractor] Page ${pageNumber} failed to extract:`, error);
      } finally {
        try {
          page?.cleanup();
        } catch {
          /* cleanup is best-effort */
        }
        onProgress?.(pageNumber, pageLimit);
      }
    }
  } finally {
    try {
      await pdf.destroy();
    } catch {
      /* destroy is best-effort */
    }
  }

  let text = normalizeDocumentText(pageTexts.join('\n\n'));
  if (dehyphenate) text = dehyphenateWrappedLines(text);

  const quality = assessTextQuality(text);
  const likelyNeedsOcr = text.trim().length < OCR_TEXT_THRESHOLD || quality.likelyGarbled;

  return { text, totalPages, extractedPages, failedPages, likelyNeedsOcr };
}
