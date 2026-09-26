/**
 * One finalised Cash Flow document per reviewed projection.
 *
 * ## What this names
 *
 * The 10 Year Cash Flow is the one format whose document is drawn from an
 * ARGUMENT rather than a lookup: `CashFlowAnalysisModal` recomputes ten years
 * in the browser from the stored overrides plus whatever the adviser has
 * changed since it opened, and the render carries those years across the wire
 * (`requestCashFlowPdf`). So "the document for this report" is not one thing.
 * It is the document for THIS series, under THIS scenario label, in THIS
 * template — drawn through its pages, or worn as this report's design.
 *
 * The key folds those into one string, so a document produced by one
 * exit ("Generate PDF") can be reused by another ("Send to Client") exactly
 * while it is still the document the adviser is looking at — and never once
 * an override has moved. RS-2 keyed the Investment finalisation on (content,
 * template) for the same reason; this is that rule for a format whose content
 * is a live series. One finalisation, one PDF, and never a stale one.
 *
 * ## What it is not
 *
 * Not a hash of the PDF, and not a promise across sittings: the remembered
 * document lives in the modal's state and dies with it. Two documents with the
 * same key were drawn from identical inputs; nothing is inferred about bytes.
 */
import type { WireProjection } from './requestCashFlowPdf';

export interface CashFlowFinalKeyInput {
  /** The ten years on screen, exactly as the render route receives them. */
  wire: WireProjection;
  /** The stored scenario the series proves, or null for an adviser-reviewed series. */
  scenario: string | null;
  /** The template the document is drawn THROUGH — its own pages — or null for none. */
  selectedTemplateId: string | null | undefined;
  /**
   * The template whose DESIGN the standard document is drawn in, or null.
   *
   * Kept apart from `selectedTemplateId` because one template drawn the two
   * ways is two different documents: one is its pages, the other is this
   * report's own pages in its typefaces and colours (`standardDesign.ts`).
   */
  designTemplateId?: string | null;
}

/**
 * Objects are serialised with sorted keys, so the order a caller assembled a
 * year in cannot split one projection into two keys.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const source = v as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(source).sort()) sorted[k] = source[k];
      return sorted;
    }
    return v;
  });
}

/** FNV-1a, 32-bit, over UTF-16 code units. Short, stable and dependency-free. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The key a finalised Cash Flow document is filed under. */
export function cashFlowFinalKey(input: CashFlowFinalKeyInput): string {
  const body = canonical({
    template: input.selectedTemplateId ?? null,
    design: input.designTemplateId ?? null,
    scenario: input.scenario ?? null,
    wire: input.wire,
  });
  return `cashflow:${fnv1a(body)}:${body.length}`;
}
