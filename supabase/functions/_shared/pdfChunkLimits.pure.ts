/** Hard bounds for chunk fan-out while each chunk downloads the full source PDF. */
export const PDF_CHUNK_MAX_PAGES = 250;
export const PDF_CHUNK_MAX_COUNT = 50;

export function assertPdfChunkPlanLimits(pageCount: number, chunkCount?: number): void {
  if (!Number.isSafeInteger(pageCount) || pageCount <= 0 || pageCount > PDF_CHUNK_MAX_PAGES) {
    throw new RangeError(
      `PDF page count ${pageCount} exceeds the supported chunked-import limit of ${PDF_CHUNK_MAX_PAGES}`,
    );
  }

  if (chunkCount !== undefined &&
    (!Number.isSafeInteger(chunkCount) || chunkCount <= 0 || chunkCount > PDF_CHUNK_MAX_COUNT)) {
    throw new RangeError(
      `PDF chunk count ${chunkCount} exceeds the per-import limit of ${PDF_CHUNK_MAX_COUNT}`,
    );
  }
}
