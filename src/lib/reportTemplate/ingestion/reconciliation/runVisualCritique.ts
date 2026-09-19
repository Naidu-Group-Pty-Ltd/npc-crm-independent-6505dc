/**
 * Run a page critique: look, then check what was seen.
 *
 * Three steps, and the order is the point.
 *
 *   1. The model is shown the source page, the rendered page, and the ids of
 *      the elements on it, and returns findings.
 *   2. Findings naming an element that is not on the page are DROPPED — an
 *      invented id reaches a reviewer looking exactly like a real defect.
 *   3. Every surviving claim geometry can settle is settled by geometry.
 *
 * Nothing here can change a template. The critique's whole output is a list of
 * findings and a count of what measurement backed, contradicted, or could not
 * reach — which is the thing the review surface never had. It reported a score.
 *
 * The network call is injected so this is testable without a backend, matching
 * `runVisualDiffRepairRequest` next door.
 */
import {
  parseCritiqueFindings,
  corroborateFindings,
  summariseCritique,
  orderFindingsForReview,
  critiqueEvidenceFromPage,
  critiqueInventory,
  type CorroboratedFinding,
  type CritiqueSummary,
  type CritiqueWidthMeasurer,
  type CritiquablePage,
} from '../../pdfImport/visualCritique';

export interface VisualCritiqueContext {
  pageId: string;
  /** The reconstructed page, for the inventory and the corroboration evidence. */
  page: CritiquablePage;
  /** Source page raster as a base64 image data URL. */
  sourceImageDataUrl: string;
  /** The rendered reconstruction, same page, same units. */
  renderedImageDataUrl: string;
  /** Text measurer. Without one, fit claims come back unverifiable rather than guessed. */
  measure?: CritiqueWidthMeasurer | null;
}

export type CritiqueFetcher = (request: {
  pageId: string;
  pageWidth: number;
  pageHeight: number;
  sourceImageDataUrl: string;
  renderedImageDataUrl: string;
  elements: ReturnType<typeof critiqueInventory>;
}) => Promise<unknown>;

export interface VisualCritiqueResult {
  findings: CorroboratedFinding[];
  summary: CritiqueSummary;
  /** Findings the parser refused, and why. Never silent. */
  rejected: Array<{ index: number; reason: string }>;
  modelUsed: string | null;
  error?: string;
}

const EMPTY_SUMMARY: CritiqueSummary = summariseCritique([]);

export async function runVisualCritique(args: {
  context: VisualCritiqueContext;
  fetchFindings: CritiqueFetcher;
}): Promise<VisualCritiqueResult> {
  const { context } = args;
  if (!context.sourceImageDataUrl || !context.renderedImageDataUrl) {
    // Judging a reconstruction with only one image in hand produces a critique
    // of the page rather than of the difference — a redesign brief wearing a
    // defect report's clothes.
    return {
      findings: [], summary: EMPTY_SUMMARY, rejected: [], modelUsed: null,
      error: 'A critique needs both the source page and the rendered page.',
    };
  }

  const evidence = critiqueEvidenceFromPage(context.page);
  if (!evidence.overlays.length) {
    return {
      findings: [], summary: EMPTY_SUMMARY, rejected: [], modelUsed: null,
      error: 'This page has no elements to critique.',
    };
  }

  let raw: unknown;
  try {
    raw = await args.fetchFindings({
      pageId: context.pageId,
      pageWidth: evidence.pageWidth,
      pageHeight: evidence.pageHeight,
      sourceImageDataUrl: context.sourceImageDataUrl,
      renderedImageDataUrl: context.renderedImageDataUrl,
      elements: critiqueInventory(evidence.overlays),
    });
  } catch (error) {
    return {
      findings: [], summary: EMPTY_SUMMARY, rejected: [], modelUsed: null,
      error: (error as Error)?.message || 'Visual critique failed.',
    };
  }

  const envelope = (raw ?? {}) as { findings?: unknown; modelUsed?: unknown; error?: unknown };
  if (typeof envelope.error === 'string' && envelope.error) {
    return { findings: [], summary: EMPTY_SUMMARY, rejected: [], modelUsed: null, error: envelope.error };
  }

  const parsed = parseCritiqueFindings(envelope.findings ?? raw, {
    overlayIds: evidence.overlays.map((o) => o.id),
    pageWidth: evidence.pageWidth,
    pageHeight: evidence.pageHeight,
  });
  const corroborated = orderFindingsForReview(corroborateFindings(parsed.findings, {
    overlays: evidence.overlays,
    pageWidth: evidence.pageWidth,
    pageHeight: evidence.pageHeight,
    measure: context.measure ?? null,
  }));

  return {
    findings: corroborated,
    summary: summariseCritique(corroborated),
    rejected: parsed.rejected,
    modelUsed: typeof envelope.modelUsed === 'string' ? envelope.modelUsed : null,
  };
}
