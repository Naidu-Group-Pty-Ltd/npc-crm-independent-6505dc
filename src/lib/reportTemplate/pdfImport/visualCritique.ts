/**
 * Browser-side shim onto the shared visual-critique contract.
 *
 * The contract has to be one module: the edge function forces the tool schema
 * with it and the browser corroborates the findings with it, and a copy that
 * drifts means the model is answering a question nobody is checking. It lives
 * under `supabase/functions/_shared/` so the Deno runtime can load it, exactly
 * like the workflow modules (`src/lib/workflow/*` are shims onto
 * `_shared/workflow/`). This re-export is the browser's door to it.
 *
 * Plus the two things only the browser can supply: a real text measurer, and the
 * overlay inventory read out of a template page.
 */
export {
  VISUAL_CRITIQUE_VERSION,
  CRITIQUE_KINDS,
  CRITIQUE_SEVERITIES,
  CRITIQUE_TOOL_SCHEMA,
  MAX_CRITIQUE_FINDINGS,
  MAX_CRITIQUE_NOTE_LENGTH,
  FIT_TOLERANCE_PT,
  REGION_COVERAGE_SHARE,
  ALIGNMENT_TOLERANCE_PT,
  parseCritiqueFindings,
  corroborateFindings,
  summariseCritique,
  orderFindingsForReview,
  type CritiqueKind,
  type CritiqueSeverity,
  type CritiqueRegion,
  type CritiqueVerdict,
  type CritiqueSummary,
  type VisualCritiqueFinding,
  type CorroboratedFinding,
  type CritiqueOverlayEvidence,
  type CritiqueEvidence,
  type CritiqueWidthMeasurer,
} from '../../../../supabase/functions/_shared/visualCritique.pure';

import type { CritiqueOverlayEvidence } from '../../../../supabase/functions/_shared/visualCritique.pure';
import { overlayPaintOrder } from '../paintOrder';

/** Structural shape of a template page this reader accepts. */
export interface CritiquablePage {
  size?: { width?: unknown; height?: unknown } | null;
  blocks?: ReadonlyArray<{ overlays?: readonly Record<string, unknown>[] | null } | null> | null;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The measured facts about a page, for both halves of a critique: the inventory
 * the model is shown, and the evidence its claims are checked against.
 *
 * `paintOrder` comes from the renderer's own ranking rather than array position,
 * because "the logo is buried" is a question about what paints on top and only
 * `paintOrder.ts` knows the answer. Deriving it a second time here is how the
 * editor and the export used to disagree about stacking.
 */
export function critiqueEvidenceFromPage(page: CritiquablePage | null | undefined): {
  overlays: CritiqueOverlayEvidence[];
  pageWidth: number;
  pageHeight: number;
} {
  const pageWidth = num(page?.size?.width) ?? 595;
  const pageHeight = num(page?.size?.height) ?? 842;
  const overlays: CritiqueOverlayEvidence[] = [];
  for (const block of page?.blocks ?? []) {
    const list = block?.overlays ?? [];
    list.forEach((overlay, index) => {
      const id = typeof overlay?.id === 'string' ? overlay.id : '';
      const x = num(overlay?.x); const y = num(overlay?.y);
      const width = num(overlay?.width); const height = num(overlay?.height);
      if (!id || x == null || y == null || width == null || height == null) return;
      const weight = overlay?.fontWeightNumeric ?? overlay?.fontWeight;
      overlays.push({
        id,
        type: typeof overlay?.type === 'string' ? overlay.type : 'unknown',
        x, y, width, height,
        paintOrder: overlayPaintOrder(overlay as never, index),
        ...(typeof overlay?.content === 'string' ? { content: overlay.content } : {}),
        ...(num(overlay?.fontSize) != null ? { fontSizePt: num(overlay.fontSize)! } : {}),
        ...(num(overlay?.lineHeight) != null ? { lineHeight: num(overlay.lineHeight)! } : {}),
        ...(num(overlay?.letterSpacing) != null ? { letterSpacingPt: num(overlay.letterSpacing)! } : {}),
        ...(typeof overlay?.fontFamily === 'string' ? { fontFamily: overlay.fontFamily } : {}),
        ...(weight != null ? { fontWeight: weight as number | string } : {}),
        ...(overlay?.whiteSpace === 'nowrap' ? { nowrap: true } : {}),
      });
    });
  }
  return { overlays, pageWidth, pageHeight };
}

/**
 * What the model is shown: ids, boxes and copy, and nothing else.
 *
 * Style is withheld on purpose. The model's job is to compare two pictures, and
 * telling it what colour something is *supposed* to be invites it to report the
 * declaration back as an observation.
 */
export function critiqueInventory(
  overlays: readonly CritiqueOverlayEvidence[],
  maxElements = 200,
): Array<{ id: string; type: string; x: number; y: number; width: number; height: number; content?: string }> {
  return overlays.slice(0, maxElements).map((o) => ({
    id: o.id,
    type: o.type,
    x: Math.round(o.x * 100) / 100,
    y: Math.round(o.y * 100) / 100,
    width: Math.round(o.width * 100) / 100,
    height: Math.round(o.height * 100) / 100,
    ...(o.content ? { content: o.content.slice(0, 160) } : {}),
  }));
}
