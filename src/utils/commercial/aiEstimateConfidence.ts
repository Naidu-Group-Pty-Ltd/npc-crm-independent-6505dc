import type { AiEstimateResult } from './aiEstimateEngine';

export function canEstimateProduceGreenStatus(estimate: AiEstimateResult): boolean {
  return estimate.confidenceTag === 'Verified' && !estimate.verificationRequired && estimate.canProduceGreenStatus;
}

export function verificationMessage(estimate: AiEstimateResult): string {
  if (canEstimateProduceGreenStatus(estimate)) return 'Verified estimate may support final status.';
  if (estimate.confidenceTag === 'AI Estimate') return 'AI estimate accepted for feasibility only — verification required before final reliance.';
  if (estimate.confidenceTag === 'Specialist Review Required') return 'Specialist confirmation required.';
  return 'Manual verification required before final reliance.';
}
