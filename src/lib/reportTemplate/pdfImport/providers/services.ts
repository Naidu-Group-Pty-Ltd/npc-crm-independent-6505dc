/**
 * Phase 9 — Multi-service dispatch.
 *
 * Reserved non-Docling provider adapters.
 *
 * These stable exports remain available for future registration, but report
 * themselves unsupported until a backend can return the persisted
 * `ImportResult` contract required by the PDF provider orchestrator. Code and
 * URL sources continue through the reference import orchestrator instead.
 *
 * Keeping the disabled adapters side-effect free prevents them from sending
 * incompatible operations to the existing Edge Functions.
 */
import type { ImportResult } from '../types';
import type { ImportProvider } from './index';

const UNSUPPORTED_PROVIDER_MESSAGE =
  'This provider is unavailable because no persisted template-import backend contract is deployed.';

export const renderSourceProvider: ImportProvider = {
  id: 'render-source',
  label: 'Render-Source (HTML/Code → raster)',
  engine: 'render-source',
  recoverableFailures: ['timeout', 'parser_error', 'network', 'rate_limited'],
  supports: () => false,
  async run(): Promise<ImportResult> {
    throw new Error(UNSUPPORTED_PROVIDER_MESSAGE);
  },
};

// ---------------------------------------------------------------------------
// WeasyPrint reverse-render fallback
// ---------------------------------------------------------------------------

/**
 * When Docling rejects a structurally-broken PDF, we can sometimes salvage it
 * by extracting its rendered pages as images, wrapping them in a minimal HTML
 * document, and re-rendering through WeasyPrint — producing a clean PDF that
 * Docling can then parse. This provider performs that loop in one call.
 *
 * This remains disabled until `template-import-pdf` exposes a supported
 * reverse-render operation that returns a persisted import.
 */
export const weasyprintReverseProvider: ImportProvider = {
  id: 'weasyprint-reverse',
  label: 'WeasyPrint reverse-render → Docling',
  engine: 'docling',
  recoverableFailures: ['timeout', 'parser_error', 'invalid_pdf', 'network'],
  supports: () => false,
  async run(): Promise<ImportResult> {
    throw new Error(UNSUPPORTED_PROVIDER_MESSAGE);
  },
};
