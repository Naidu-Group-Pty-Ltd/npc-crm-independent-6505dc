/**
 * exportCapability — pre-export capability analysis per output format
 * (rehaul Phase 4 / output quality hardening).
 *
 * The structured exports are intentionally lossy:
 * - DOCX exports text overlays only (sorted top-to-bottom); block bodies,
 *   images, and shapes are omitted.
 * - PPTX exports text/image/shape overlays per slide; block bodies are
 *   omitted.
 * - jsPDF is the legacy renderer: HTML-first blocks render as placeholders
 *   and unregistered blocks are unsupported.
 *
 * This module makes that loss explicit *before* the user exports, instead of
 * a generic "there may be notes" confirm. Pure and deterministic so the
 * warnings are unit-testable.
 */
import { BLOCK_DEFS, getBlockRendererCapabilities } from './blocks';
import type { ReportTemplate } from './templateSchema';

export type ExportFormat = 'docx' | 'pptx' | 'jspdf';

export interface ExportCapabilityIssue {
  severity: 'error' | 'warning';
  code:
    | 'block-bodies-omitted'
    | 'overlays-omitted'
    | 'jspdf-placeholder'
    | 'jspdf-unsupported';
  message: string;
  /** Number of affected blocks/overlays. */
  count: number;
}

export interface ExportCapabilityReport {
  format: ExportFormat;
  issues: ExportCapabilityIssue[];
  errorCount: number;
  warningCount: number;
}

/** Overlay types each structured exporter can carry across. */
const SUPPORTED_OVERLAYS: Record<'docx' | 'pptx', Set<string>> = {
  docx: new Set(['text']),
  pptx: new Set(['text', 'image', 'shape']),
};

const FORMAT_LABEL: Record<ExportFormat, string> = {
  docx: 'DOCX',
  pptx: 'PPTX',
  jspdf: 'legacy jsPDF',
};

function blockLabel(type: string): string {
  return BLOCK_DEFS[type]?.label ?? type;
}

function tally(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function listOf(map: Map<string, number>, label: (key: string) => string): string {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${label(key)} ×${count}`)
    .join(', ');
}

export function analyzeExportCapability(
  template: ReportTemplate,
  format: ExportFormat,
): ExportCapabilityReport {
  // One walk: structured blocks (anything with body content, i.e. not 'free')
  // and overlay types in use.
  const structuredBlocks = new Map<string, number>();
  const overlayTypes = new Map<string, number>();
  for (const page of template.pages) {
    for (const block of page.blocks) {
      const type = String(block.type ?? '');
      if (type && type !== 'free') tally(structuredBlocks, type);
      for (const overlay of block.overlays ?? []) {
        tally(overlayTypes, String((overlay as { type?: string }).type ?? 'unknown'));
      }
    }
  }

  const issues: ExportCapabilityIssue[] = [];

  if (format === 'docx' || format === 'pptx') {
    const structuredCount = Array.from(structuredBlocks.values()).reduce((a, b) => a + b, 0);
    if (structuredCount > 0) {
      issues.push({
        severity: 'warning',
        code: 'block-bodies-omitted',
        count: structuredCount,
        message:
          `${structuredCount} structured block${structuredCount === 1 ? '' : 's'} ` +
          `(${listOf(structuredBlocks, blockLabel)}) export${structuredCount === 1 ? 's' : ''} without body content — ` +
          `${FORMAT_LABEL[format]} carries ${format === 'docx' ? 'text overlays only' : 'text/image/shape overlays only'}. ` +
          'Use the PDF/HTML pipeline for full fidelity.',
      });
    }

    const supported = SUPPORTED_OVERLAYS[format];
    const dropped = new Map<string, number>();
    for (const [type, count] of overlayTypes) {
      if (!supported.has(type)) dropped.set(type, count);
    }
    const droppedCount = Array.from(dropped.values()).reduce((a, b) => a + b, 0);
    if (droppedCount > 0) {
      issues.push({
        severity: 'warning',
        code: 'overlays-omitted',
        count: droppedCount,
        message:
          `${droppedCount} overlay${droppedCount === 1 ? '' : 's'} (${listOf(dropped, (t) => t)}) ` +
          `${droppedCount === 1 ? 'is' : 'are'} not supported by the ${FORMAT_LABEL[format]} exporter and will be omitted.`,
      });
    }
  }

  if (format === 'jspdf') {
    const placeholders = new Map<string, number>();
    const unsupported = new Map<string, number>();
    for (const [type, count] of structuredBlocks) {
      const caps = getBlockRendererCapabilities(type);
      if (caps.jspdf === 'partial') placeholders.set(type, count);
      else if (caps.jspdf === 'unsupported') unsupported.set(type, count);
    }
    const placeholderCount = Array.from(placeholders.values()).reduce((a, b) => a + b, 0);
    if (placeholderCount > 0) {
      issues.push({
        severity: 'warning',
        code: 'jspdf-placeholder',
        count: placeholderCount,
        message:
          `${placeholderCount} HTML-first block${placeholderCount === 1 ? '' : 's'} ` +
          `(${listOf(placeholders, blockLabel)}) render${placeholderCount === 1 ? 's' : ''} as a placeholder in legacy jsPDF output. ` +
          'Production HTML/WeasyPrint renders them fully.',
      });
    }
    const unsupportedCount = Array.from(unsupported.values()).reduce((a, b) => a + b, 0);
    if (unsupportedCount > 0) {
      issues.push({
        severity: 'error',
        code: 'jspdf-unsupported',
        count: unsupportedCount,
        message:
          `${unsupportedCount} block${unsupportedCount === 1 ? '' : 's'} ` +
          `(${listOf(unsupported, blockLabel)}) ha${unsupportedCount === 1 ? 's' : 've'} no jsPDF renderer and will be missing from the output.`,
      });
    }
  }

  return {
    format,
    issues,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
  };
}
