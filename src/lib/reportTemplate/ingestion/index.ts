/**
 * Unified ingestion mechanism — public surface (plan WS1).
 *
 * Usage (editor import modal):
 *   import { planIngestion } from '@/lib/reportTemplate/ingestion';
 *   const plan = planIngestion({ kind: 'file', file });
 *   if (!plan?.available) // show the right UI (e.g. code → "render-source pending")
 */
export * from './types';
export { classifyInput, codeFlavorForFile, codeTierForFlavor } from './detect';
export { SOURCES, pdfSource, imageSource, urlSource, codeSource, figmaSource } from './sources';
export { resolveSource, planIngestion, planIngestionOrThrow } from './registry';

// Raw-codebase ingestion (C1/C2): render-source → grounded reference.
export { renderAndGroundCode, looksLikeJsx } from './codeIngest';
export type { CodeRenderInput, CodeIngestResult, InvokeFn } from './codeIngest';

// Native-PDF-to-Claude reconstruction (§7a).
export { reconstructPdfWithClaude } from './pdfDocumentReconstruct';
export type { PdfReconstructArgs, PdfReconstructResult } from './pdfDocumentReconstruct';
export { groundDomBoxTree, harvestTokensFromBoxTree } from '../codeGrounding';
export type { DomBoxTree, DomTextBox, DomImageBox, CodeGroundOptions } from '../codeGrounding';

// Canonical Design IR (CDIR) — Phase 1 adapter bridge.
export * from './cdir';
export * from './fidelity';
export * from './review';
export * from './importArtifacts';
