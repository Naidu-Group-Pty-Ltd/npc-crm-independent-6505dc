/**
 * Table preservation integration (E4) — bridge the pure table arbitration to the
 * renderer + E0 containment + E3 chart preservation, backward-compatibly.
 *
 * A verified native table renders natively (its source crop stays available for
 * reference); an unsafe table renders its exact source crop as a locked visual
 * object and suppresses the duplicate native table / child text / grid vectors.
 * A nested chart inside a source-cropped table is suppressed (the outer table
 * wins); a chart BESIDE a table is untouched — E3 and E4 stay independent.
 *
 * Pure (no I/O, no DOM, no signed URLs). The caller supplies the loaded source
 * regions + persisted arbitration and the candidate template page.
 */
import type { Page, Overlay } from '../templateSchema';
import type { SourceRegionV2, SourcePageSceneV2, SourceBBox } from './sourceSceneGraphV2.pure';
import {
  resolveTableSuppression,
  validateTableArbitration,
  tableContainmentRequirement,
  type TablePreservationRegionPlanV1,
  type TableArbitrationResultV1,
  type TableRenderMode,
  type TableSuppressionOverlay,
  type TableSuppressionResult,
  type TableContainmentRequirement,
  TABLE_PRESERVATION_VERSION,
} from './tableArbitration.pure';

const STATE_TO_RENDER: Record<string, TableRenderMode> = {
  native_verified: 'verified-native-table',
  source_crop: 'table-source-crop',
  containment_fallback: 'containment-fallback',
  blocked: 'blocked',
};

/** Extract id + bbox for every overlay on a page (table suppression candidates). */
export function overlaysForTableSuppression(page: Page): TableSuppressionOverlay[] {
  const out: TableSuppressionOverlay[] = [];
  for (const block of page.blocks ?? []) {
    for (const ov of block.overlays ?? []) out.push({ id: overlayId(ov), bbox: overlayBBox(ov) });
  }
  return out;
}

function overlayId(ov: Overlay): string { return (ov as { id?: string }).id ?? 'overlay'; }
function overlayBBox(ov: Overlay): TableSuppressionOverlay['bbox'] {
  const o = ov as { x?: number; y?: number; width?: number; height?: number };
  if (typeof o.x !== 'number' || typeof o.y !== 'number' || typeof o.width !== 'number' || typeof o.height !== 'number') return null;
  return { x: o.x, y: o.y, width: o.width, height: o.height };
}

/**
 * Build a per-page table preservation plan from the loaded source table regions +
 * their persisted arbitration results. Invalid/absent arbitration for a region
 * degrades to `containment-fallback` (E0 owns it) and NEVER to a native render.
 */
export function buildPageTablePreservation(
  regions: SourceRegionV2[],
  arbitrationByRegionId: Record<string, unknown>,
  pageNumber: number | null = null,
): { plans: TablePreservationRegionPlanV1[]; tableBBoxes: Record<string, SourceBBox> } {
  const byParent = new Map<string, string[]>();
  const regionIds = new Set(regions.map((r) => r.id));
  for (const r of regions) {
    const parent = r.relationships?.parentRegionId;
    if (parent) byParent.set(parent, [...(byParent.get(parent) ?? []), r.id]);
  }
  const descendants = (id: string): string[] => {
    const out: string[] = []; const seen = new Set<string>(); const q = [...(byParent.get(id) ?? [])];
    while (q.length) { const x = q.shift()!; if (seen.has(x)) continue; seen.add(x); out.push(x); q.push(...(byParent.get(x) ?? [])); }
    return out;
  };

  const plans: TablePreservationRegionPlanV1[] = [];
  const tableBBoxes: Record<string, SourceBBox> = {};
  for (const region of regions) {
    if (region.type !== 'table') continue;
    if (region.bbox) tableBBoxes[region.id] = region.bbox;
    const validation = validateTableArbitration(arbitrationByRegionId[region.id]);
    const arb = validation.result;
    const mode: TableRenderMode = arb ? (STATE_TO_RENDER[arb.state] ?? 'containment-fallback') : 'containment-fallback';
    const rep = arb?.selectedIntegrityReport ?? null;
    const suppress = (mode === 'table-source-crop' || mode === 'verified-native-table') ? descendants(region.id) : [];
    plans.push({
      version: TABLE_PRESERVATION_VERSION,
      regionId: region.id,
      pageNumber: region.pageNumber ?? pageNumber,
      renderMode: mode,
      selectedCandidateId: arb?.selectedCandidateId ?? null,
      sourceCropPath: region.sourceCrop?.path ?? null,
      suppressRegionIds: suppress,
      suppressOverlayIds: [],
      integrityState: rep?.state ?? (arb ? 'n/a' : 'unverifiable'),
      integrityScore: rep?.score ?? null,
      hardDefectCodes: (rep?.hardDefects ?? []).map((d) => d.code),
      manualReviewRequired: mode === 'blocked' || mode === 'table-source-crop',
      reason: arb?.reason ?? 'no_arbitration',
      orphanSuppressedRegionIds: suppress.filter((id) => !regionIds.has(id)),
    });
  }
  return { plans, tableBBoxes };
}

export interface PageTablePreservation {
  plans: TablePreservationRegionPlanV1[];
  suppression: TableSuppressionResult;
  containmentByRegionId: Record<string, TableContainmentRequirement | null>;
  requiresPageFallback: boolean;
  manualReviewRequired: boolean;
}

/** Resolve table preservation + candidate-overlay suppression for one page. */
export function resolvePageTablePreservation(
  page: Page,
  regions: SourceRegionV2[],
  arbitrationByRegionId: Record<string, unknown>,
  pageNumber: number | null = null,
): PageTablePreservation {
  const { plans, tableBBoxes } = buildPageTablePreservation(regions, arbitrationByRegionId, pageNumber);
  const suppression = resolveTableSuppression(plans, tableBBoxes, overlaysForTableSuppression(page));
  const containmentByRegionId: Record<string, TableContainmentRequirement | null> = {};
  for (const [regionId, arb] of Object.entries(arbitrationByRegionId)) {
    containmentByRegionId[regionId] = tableContainmentRequirement(arb);
  }
  return {
    plans,
    suppression,
    containmentByRegionId,
    requiresPageFallback: plans.some((p) => p.renderMode === 'containment-fallback' || p.renderMode === 'blocked'),
    manualReviewRequired: plans.some((p) => p.manualReviewRequired),
  };
}

export function resolvePageTablePreservationFromScene(
  page: Page,
  scene: SourcePageSceneV2 | null | undefined,
  arbitrationByRegionId: Record<string, unknown>,
): PageTablePreservation {
  return resolvePageTablePreservation(page, scene?.regions ?? [], arbitrationByRegionId, scene?.pageNumber ?? null);
}
