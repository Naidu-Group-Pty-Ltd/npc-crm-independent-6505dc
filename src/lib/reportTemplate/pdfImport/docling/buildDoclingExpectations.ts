/**
 * Phase 3 — Build CDIR fidelity expectations from a Docling document.
 *
 * `buildCdirFidelityReport` accepts `expectedText` and `expectedBounds` so it
 * can produce real `textAccuracy` and `medianPositionDrift` numbers. Until
 * now the Docling import path called it with empty arrays, which meant the
 * post-import quality report was structurally valid but numerically blind.
 *
 * This module fills those expectations directly from the source Docling
 * document, mirroring the id convention used by `mapDoclingToRawBlocks`
 * (`docling-<label>-p<page>-<index36>`) and `mapDoclingToPagePlan`
 * (`<blockId>-ov`) so the bounds line up with the CDIR layer ids that
 * `reportTemplateToCdir` ultimately emits.
 *
 * Pure, deterministic, no I/O — safe to call from the browser pipeline.
 */
import type { DoclingDocument, DoclingProvenance, DoclingTextItem } from './doclingTypes';
import type {
  SourceBoundsExpectation,
  SourceTextExpectation,
} from '@/lib/reportTemplate/ingestion/fidelity';

export interface DoclingExpectations {
  expectedText: SourceTextExpectation[];
  expectedBounds: SourceBoundsExpectation[];
}

/** Page id convention shared with `mapDoclingToPagePlan.pageId`. */
function pageIdFor(pageNo: number): string {
  return `docling-page-${pageNo}`;
}

/** Block id convention shared with `mapDoclingToRawBlocks.blockId`. */
function blockIdFor(label: string, pageNo: number, globalIndex: number): string {
  return `docling-${label}-p${pageNo}-${globalIndex.toString(36)}`;
}

/** Overlay/CDIR layer id convention shared with `mapDoclingToPagePlan.overlayId`. */
function layerIdFor(blockId: string): string {
  return `${blockId}-ov`;
}

/** Resolve the page provenance of a text item (matches `pickProv`). */
function provenanceFor(item: DoclingTextItem): DoclingProvenance | null {
  const prov = item.prov ?? [];
  if (prov.length === 0) return null;
  // Prefer the first prov on the item's primary page; otherwise just take prov[0].
  const primary = prov[0];
  if (!primary || typeof primary.page_no !== 'number') return null;
  return primary;
}

/** Docling BBox is bottom-left or top-left; we just need width/height/x/y here. */
function bboxToBounds(prov: DoclingProvenance, pageHeight: number) {
  const { l, t, r, b } = prov.bbox;
  const width = Math.max(0, r - l);
  const height = Math.max(0, Math.abs(t - b));
  const origin = prov.bbox.coord_origin ?? 'BOTTOMLEFT';
  // Plan builder converts to TOPLEFT using page height; mirror that here so
  // expected bounds live in the same coordinate space as CDIR layer bounds.
  const y = origin === 'TOPLEFT' ? Math.min(t, b) : Math.max(0, pageHeight - Math.max(t, b));
  const x = Math.min(l, r);
  return { x, y, width, height };
}

function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Build `{ expectedText, expectedBounds }` from a Docling document.
 *
 * - `expectedText` is one entry per page, holding the concatenation (in
 *   reading order when available, otherwise document order) of every text
 *   item Docling emitted for that page. Lets `buildCdirFidelityReport`
 *   measure how much of the source copy survived the round trip.
 *
 * - `expectedBounds` is one entry per Docling text item, keyed to the CDIR
 *   layer id the plan builder will create. Until reconciliation moves
 *   things, drift should be ~0 — but any future transform that nudges
 *   layers will now show up as a real `medianPositionDrift` number rather
 *   than a structurally-missing metric.
 */
export function buildDoclingExpectations(doc: DoclingDocument | null | undefined): DoclingExpectations {
  if (!doc) return { expectedText: [], expectedBounds: [] };

  const pagesById = doc.pages ?? {};
  const pageHeightByNo = new Map<number, number>();
  for (const info of Object.values(pagesById)) {
    if (info && typeof info.page_no === 'number' && info.size) {
      pageHeightByNo.set(info.page_no, info.size.height);
    }
  }

  // Page bucket: { reading_order, document_index, text }
  type Entry = { order: number; idx: number; text: string };
  const textsByPage = new Map<number, Entry[]>();
  const boundsExpectations: SourceBoundsExpectation[] = [];

  const items = doc.texts ?? [];
  for (let globalIdx = 0; globalIdx < items.length; globalIdx += 1) {
    const item = items[globalIdx];
    if (!item) continue;
    const prov = provenanceFor(item);
    if (!prov) continue;

    const pageNo = prov.page_no;
    const label = String(item.label ?? 'text');
    const blockId = blockIdFor(label, pageNo, globalIdx);
    const layerId = layerIdFor(blockId);
    const pageId = pageIdFor(pageNo);

    // Text bucket
    const txt = normaliseWhitespace(item.text ?? '');
    if (txt) {
      const bucket = textsByPage.get(pageNo) ?? [];
      bucket.push({
        order: typeof item.reading_order === 'number' ? item.reading_order : Number.MAX_SAFE_INTEGER,
        idx: globalIdx,
        text: txt,
      });
      textsByPage.set(pageNo, bucket);
    }

    // Bounds expectation (only meaningful for items with positive area)
    const pageHeight = pageHeightByNo.get(pageNo) ?? 0;
    const bounds = bboxToBounds(prov, pageHeight);
    if (bounds.width > 0 && bounds.height > 0) {
      boundsExpectations.push({ pageId, layerId, bounds });
    }
  }

  const expectedText: SourceTextExpectation[] = [];
  for (const [pageNo, entries] of textsByPage) {
    entries.sort((a, b) => (a.order - b.order) || (a.idx - b.idx));
    const combined = entries.map((e) => e.text).join(' ').trim();
    if (combined) {
      expectedText.push({ pageId: pageIdFor(pageNo), text: combined });
    }
  }
  // Stable, page-ordered output for deterministic snapshots.
  expectedText.sort((a, b) => String(a.pageId).localeCompare(String(b.pageId)));

  return { expectedText, expectedBounds: boundsExpectations };
}
