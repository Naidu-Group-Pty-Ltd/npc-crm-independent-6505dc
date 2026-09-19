/**
 * Unified ingestion mechanism — shared types (plan WS1).
 *
 * One front door, pluggable per-input "sources" (subfunctions), all classifying
 * to a single shape so the editor's "Start from a reference" modal and the
 * Claude reconstruction core don't each re-implement input detection. Today the
 * detection/routing brain lives here and DELEGATES extraction to the existing,
 * already-shipped pipelines (PDF/image/URL); raw-codebase ingestion adds the new
 * `code` kind with tiers C1–C4 (see `CodeTier`), pending the `render-source`
 * headless service.
 *
 * Everything here is pure + serialisable so it can be unit-tested without a
 * network or a browser.
 */
import type { ReportTemplate } from '../templateSchema';
import type { CdirDocument } from './cdir/schema';
import type { CdirFidelityReport } from './fidelity';

/** The pipelines an input can be routed to. */
export type SourceKind = 'pdf' | 'image' | 'url' | 'code' | 'figma';

/** Concrete code input shapes accepted by the raw-codebase source. */
export type CodeFlavor = 'html' | 'css' | 'jsx' | 'tsx' | 'vue' | 'svelte' | 'astro' | 'data' | 'asset' | 'zip';

/**
 * Render tiers for raw-codebase ingestion (locked decision: support all four).
 * Each renders to a page + DOM box tree via the `render-source` service, then
 * feeds the same grounded-classify + SSIM pipeline as image import.
 */
export type CodeTier =
  | 'C1-html-css'   // markup/CSS bundle → headless render
  | 'C2-live-url'   // deployed page (incl. Figma/Canva/Gamma) → headless render
  | 'C3-react-jsx'  // component source → sandboxed build → render
  | 'C4-repo-zip';  // project archive → isolated build container → render

/** Any input the façade can be handed. */
export type IngestionInput =
  | { kind: 'file'; file: { name?: string; type?: string; size?: number } }
  | { kind: 'url'; url: string }
  | { kind: 'code'; flavor?: CodeFlavor; filename?: string; source?: string };

export interface IngestionContext {
  templateId?: string;
  activePageId?: string | null;
  sampleData?: unknown;
  signal?: AbortSignal;
}

/**
 * The normalised output every source resolves to. For sources that produce a
 * ready editable template directly (PDF), `template` is set; for sources that
 * feed the AI classify stage (image/code), `pages` carries grounded elements.
 */
export interface ExtractionResult {
  kind: SourceKind;
  template?: ReportTemplate;
  /** Phase 1 CDIR bridge: source-normalized editable design IR before template mapping. */
  cdir?: CdirDocument;
  /** Phase 2 shared quality contract for CDIR/native editability. */
  fidelity?: CdirFidelityReport;
  pages?: Array<{ width: number; height: number; elements: unknown[]; rasterUrl?: string }>;
  warnings?: string[];
  meta?: Record<string, unknown>;
}

/**
 * How a resolved source will fulfil an input *today* — the honest, current-state
 * routing descriptor. `delegate` points at an already-shipped pipeline;
 * `render-source` marks the not-yet-available code path with its tier.
 */
export interface IngestionPlan {
  sourceId: string;
  kind: SourceKind;
  strategy: 'delegate' | 'render-source';
  /** For `strategy:'delegate'` — the existing pipeline that performs extraction. */
  delegate?:
    | 'extractPdfViaDocling'
    | 'template-design-agent:screenshot_to_block'
    | 'import-from-url'
    | 'importOrchestrator:figma-make';
  /** For code inputs — the render tier and current availability. */
  codeTier?: CodeTier;
  available: boolean;
  note: string;
}

/** A pluggable ingestion subfunction. `plan` is the pure routing brain; `extract`
 *  lands when the façade wraps the live pipelines + the render-source service. */
export interface IngestionSource {
  readonly id: string;
  readonly kind: SourceKind;
  accepts(input: IngestionInput): boolean;
  plan(input: IngestionInput): IngestionPlan;
}

export class IngestionError extends Error {
  code: string;
  constructor(message: string, code = 'ingestion_error') {
    super(message);
    this.name = 'IngestionError';
    this.code = code;
  }
}
