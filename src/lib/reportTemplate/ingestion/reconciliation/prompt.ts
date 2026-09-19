import type { ImportAsset, ReconciliationRequest } from './types';
import { buildTemplateSchemaSummary } from './schemaSummary';

export interface ReconciliationPromptPayload {
  system: string;
  user: string;
  schemaSummary: ReturnType<typeof buildTemplateSchemaSummary>;
}

function compactImportAsset(asset: ImportAsset): ImportAsset {
  return {
    ...asset,
    pages: asset.pages.map((page) => ({
      ...page,
      referenceImageUrl: page.referenceImageUrl.startsWith('data:')
        ? '[reference image supplied separately]'
        : page.referenceImageUrl,
    })),
  };
}

export function buildReconciliationPrompt(request: ReconciliationRequest): ReconciliationPromptPayload {
  const schemaSummary = buildTemplateSchemaSummary();
  return {
    schemaSummary,
    system: [
      'You are the Template Import Reconciliation Engine.',
      'You are a controlled middleware step, not a renderer and not a creative design generator.',
      'Your only job is to reconcile deterministic extraction + visual analysis into strict TemplateImportPlan JSON.',
      'The editor and PDF renderer are deterministic and own final rendering.',
    ].join('\n'),
    user: JSON.stringify({
      instructions: schemaSummary.hardRules,
      importAsset: compactImportAsset(request.importAsset),
      manifests: request.manifests,
      vision: request.vision ?? [],
      parserSummary: request.parserSummary ?? null,
      qualityInstructions: request.parserSummary
        ? [
            'Use parserSummary to preserve fidelity: low avgTextConfidence or high OCR ratio means prefer locked/raster-backed elements and add manual-review warnings.',
            'If lowConfidencePages is non-empty, set manualReviewRequired=true and include page-level warnings for those pages.',
          ]
        : [],
      constraints: request.constraints ?? {},
      requiredOutput: 'TemplateImportPlan JSON only',
    }),
  };
}
