import type { AssessmentRateResult, LendingAssumptions } from './calculatorTypes';

export const COMMERCIAL_ASSESSMENT_BUFFER_HELP = 'Commercial lending assessment buffers vary by lender and loan type. APRA’s 3% mortgage serviceability buffer is a residential home-loan setting and should only be applied where residential-backed or personal mortgage servicing is relevant.';

export function calculateAssessmentRate(assumptions: LendingAssumptions): AssessmentRateResult {
  const contractRatePct = Math.max(0, assumptions.contractInterestRatePct || 0);
  const bufferPct = Math.max(0, assumptions.assessmentBufferPct || 0);
  const floorRatePct = Math.max(0, assumptions.assessmentFloorRatePct || 0);
  const bufferedRate = contractRatePct + bufferPct;
  const basis = assumptions.assessmentBasis ?? (floorRatePct > 0 ? 'higherOfBufferAndFloor' : 'contractPlusBuffer');
  const calculated = floorRatePct > 0 ? Math.max(bufferedRate, floorRatePct) : bufferedRate;
  const assessmentRatePct = basis === 'custom' && (assumptions.assessmentRateOverridePct ?? 0) > 0 ? assumptions.assessmentRateOverridePct ?? calculated : calculated;
  return { contractRatePct, bufferPct, floorRatePct, assessmentRatePct, assessmentBasis: basis, helpNote: COMMERCIAL_ASSESSMENT_BUFFER_HELP };
}
