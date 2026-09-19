import type { ReportTemplate } from '../../templateSchema';
import { buildHybridImportPlanFromManifests } from './hybridPlan';
import { buildRawImportManifest } from './manifest';
import { reconcileWithFallback, type ReconciliationAiClient } from './aiClient';
import type { ImportAsset, RawImportBlock, RawImportManifest, ReconciliationRequest, TemplateImportPlan } from './types';

export interface PdfImportAssetReconciliationOptions {
  client: ReconciliationAiClient;
  existingTemplate?: ReportTemplate;
  manifests?: RawImportManifest[];
  rawBlocksByPage?: Record<number, RawImportBlock[]>;
  paletteByPage?: Record<number, string[]>;
  constraints?: Record<string, unknown>;
  parserSummary?: ReconciliationRequest['parserSummary'];
  onWarning?: (message: string) => void;
}

export interface PdfImportAssetReconciliationResult {
  plan: TemplateImportPlan;
  manifests: RawImportManifest[];
  request: ReconciliationRequest;
}

export function buildPdfImportAssetManifests(
  importAsset: ImportAsset,
  options: Pick<PdfImportAssetReconciliationOptions, 'rawBlocksByPage' | 'paletteByPage'> = {},
): RawImportManifest[] {
  if (importAsset.fileType !== 'pdf') throw new Error('PDF reconciliation requires a PDF ImportAsset.');
  return importAsset.pages.map((page) => buildRawImportManifest({
    importId: importAsset.fileId,
    page,
    rawBlocks: options.rawBlocksByPage?.[page.pageIndex] ?? [],
    palette: options.paletteByPage?.[page.pageIndex] ?? [],
  }));
}

export async function reconcilePdfImportAsset(
  importAsset: ImportAsset,
  options: PdfImportAssetReconciliationOptions,
): Promise<PdfImportAssetReconciliationResult> {
  const manifests = options.manifests ?? buildPdfImportAssetManifests(importAsset, options);
  const fallbackPlan = buildHybridImportPlanFromManifests(importAsset, manifests, { importId: importAsset.fileId });
  const request: ReconciliationRequest = {
    importAsset,
    manifests,
    existingTemplate: options.existingTemplate,
    parserSummary: options.parserSummary,
    constraints: {
      source: 'pdf-import-asset',
      preserveRenderedPdfPages: true,
      ...(options.constraints ?? {}),
    },
  };
  const plan = await reconcileWithFallback(options.client, request, fallbackPlan, options.onWarning);
  return { plan, manifests, request };
}
