/**
 * The pluggable ingestion subfunctions (one per input kind).
 *
 * Each source owns a cheap `accepts` predicate (delegated to `classifyInput` so
 * detection lives in exactly one place) and a pure `plan` that reports how the
 * input is fulfilled *today*. PDF/image/URL delegate to already-shipped
 * pipelines; the raw-codebase source routes to the forthcoming `render-source`
 * service by tier (C1–C4).
 */
import { classifyInput, codeFlavorForFile, codeTierForFlavor } from './detect';
import type { CodeTier, IngestionInput, IngestionPlan, IngestionSource } from './types';

function codeTierForInput(input: IngestionInput): CodeTier {
  if (input.kind === 'url') return 'C2-live-url';
  if (input.kind === 'code') {
    if (input.flavor) return codeTierForFlavor(input.flavor);
    const byName = input.filename ? codeFlavorForFile(input.filename) : null;
    return byName ? codeTierForFlavor(byName) : 'C1-html-css';
  }
  if (input.kind === 'file') {
    const f = codeFlavorForFile(input.file?.name);
    return f ? codeTierForFlavor(f) : 'C1-html-css';
  }
  return 'C1-html-css';
}

export const pdfSource: IngestionSource = {
  id: 'pdf',
  kind: 'pdf',
  accepts: (input) => classifyInput(input) === 'pdf',
  plan: () => ({
    sourceId: 'pdf',
    kind: 'pdf',
    strategy: 'delegate',
    delegate: 'extractPdfViaDocling',
    available: true,
    note: 'Routed via Docling Cloud Run sidecar (extractPdfViaDocling).',
  }),
};

export const imageSource: IngestionSource = {
  id: 'image',
  kind: 'image',
  accepts: (input) => classifyInput(input) === 'image',
  plan: () => ({
    sourceId: 'image',
    kind: 'image',
    strategy: 'delegate',
    delegate: 'template-design-agent:screenshot_to_block',
    available: true,
    note: 'OCR-grounded measured elements → AI grounded-classify (faithful reconstruct).',
  }),
};

export const urlSource: IngestionSource = {
  id: 'url',
  kind: 'url',
  accepts: (input) => classifyInput(input) === 'url',
  plan: () => ({
    sourceId: 'url',
    kind: 'url',
    strategy: 'delegate',
    delegate: 'import-from-url',
    available: true,
    note: 'SSRF-guarded server fetch → dispatched to the PDF or image pipeline.',
  }),
};

export const codeSource: IngestionSource = {
  id: 'code',
  kind: 'code',
  accepts: (input) => classifyInput(input) === 'code',
  plan: (input): IngestionPlan => {
    const codeTier = codeTierForInput(input);
    return {
      sourceId: 'code',
      kind: 'code',
      strategy: 'render-source',
      codeTier,
      // The render-source service + edge function are shipped. Runtime
      // availability still depends on RENDER_SOURCE_URL/TOKEN being configured
      // on the edge function; callers surface the 503 at invoke time if not.
      available: true,
      note: `Raw-codebase ingestion (${codeTier}) renders to a page + DOM box tree via the render-source service, then reuses the image grounded-classify pipeline.`,
    };
  },
};

export const figmaSource: IngestionSource = {
  id: 'figma',
  kind: 'figma',
  accepts: (input) => classifyInput(input) === 'figma',
  plan: (): IngestionPlan => ({
    sourceId: 'figma',
    kind: 'figma',
    strategy: 'delegate',
    delegate: 'importOrchestrator:figma-make',
    available: true,
    note: 'Figma Make / local-Figma export (.make/.fig) — unpacked by the orchestrator and grounded through the image/vision pipeline.',
  }),
};

/** Ordered registry — first matching source wins. Figma before code so that
 *  .fig/.make exports (which are zip-shaped) route through the figma path. */
export const SOURCES: readonly IngestionSource[] = [pdfSource, imageSource, urlSource, figmaSource, codeSource];
