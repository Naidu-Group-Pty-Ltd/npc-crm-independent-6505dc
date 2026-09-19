import type { AssumptionConfidenceTag } from './assumptionRegistry';

export type AiEstimateConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type AiEstimateAction = 'generated' | 'accepted' | 'rejected' | 'overridden' | 'markedVerified';

export interface AiEstimateResult {
  fieldKey: string;
  estimatedValue: number | string | boolean | null;
  confidence: AiEstimateConfidence;
  confidenceTag: Extract<AssumptionConfidenceTag, 'AI Estimate' | 'Manual Estimate' | 'Verified' | 'Unknown' | 'Specialist Review Required'>;
  sourceBasis: string[];
  reasoningSummary: string;
  verificationRequired: boolean;
  requiredDocuments: string[];
  impactAreas: string[];
  canUseInFinalReport: boolean;
  canProduceGreenStatus: boolean;
}

export interface AiEstimateAuditEvent {
  id: string;
  fieldKey: string;
  action: AiEstimateAction;
  timestamp: string;
  estimate?: AiEstimateResult;
  manualValue?: number | string | boolean | null;
  actor?: string;
}

export function createAiEstimate(params: Partial<AiEstimateResult> & Pick<AiEstimateResult, 'fieldKey'>): AiEstimateResult {
  const impactAreas = params.impactAreas ?? [];
  const restricted = impactAreas.some(area => ['lending', 'gst', 'valuation', 'environmental risk'].includes(area.toLowerCase()));
  return {
    fieldKey: params.fieldKey,
    estimatedValue: params.estimatedValue ?? null,
    confidence: params.confidence ?? 'unknown',
    confidenceTag: params.confidenceTag ?? 'AI Estimate',
    sourceBasis: params.sourceBasis ?? ['AI-generated feasibility assumption; source evidence not verified.'],
    reasoningSummary: params.reasoningSummary ?? 'Estimate generated for early feasibility only. Deterministic calculator formulas remain the source of truth.',
    verificationRequired: params.verificationRequired ?? true,
    requiredDocuments: params.requiredDocuments ?? [],
    impactAreas,
    canUseInFinalReport: params.canUseInFinalReport ?? true,
    canProduceGreenStatus: params.canProduceGreenStatus ?? !restricted,
  };
}

export function auditAiEstimate(action: AiEstimateAction, estimate: AiEstimateResult, manualValue?: AiEstimateAuditEvent['manualValue']): AiEstimateAuditEvent {
  return {
    id: `${estimate.fieldKey}-${action}-${Date.now()}`,
    fieldKey: estimate.fieldKey,
    action,
    timestamp: new Date().toISOString(),
    estimate,
    manualValue,
  };
}

export function acceptAiEstimate(estimate: AiEstimateResult): AiEstimateResult {
  return { ...estimate, confidenceTag: 'AI Estimate', verificationRequired: true, canProduceGreenStatus: false };
}

export function rejectAiEstimate(estimate: AiEstimateResult): AiEstimateResult {
  return { ...estimate, estimatedValue: null, confidence: 'unknown', confidenceTag: 'Unknown', canUseInFinalReport: false, canProduceGreenStatus: false };
}

export function replaceWithManualValue(estimate: AiEstimateResult, value: AiEstimateResult['estimatedValue']): AiEstimateResult {
  return { ...estimate, estimatedValue: value, confidenceTag: 'Manual Estimate', verificationRequired: true, canProduceGreenStatus: false };
}

export function markEstimateVerified(estimate: AiEstimateResult): AiEstimateResult {
  return { ...estimate, confidenceTag: 'Verified', verificationRequired: false, canProduceGreenStatus: true };
}
