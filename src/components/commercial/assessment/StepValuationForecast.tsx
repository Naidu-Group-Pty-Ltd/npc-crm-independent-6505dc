/**
 * Valuation & forecast — the investment half of an assessment.
 *
 * ## Where this came from
 *
 * These two stages were the only thing the "Standalone calculators" workspace
 * could do that the assessment could not: value the asset on its income at a
 * market capitalisation rate, and model the hold as a discounted cash flow.
 * That workspace edited the very same assessment records through a second set
 * of stages, so it has been retired and the capability moved here, onto the
 * one workflow. The stages are reused unchanged — same engines (`capRateEngine`,
 * `dcfEngine`), same fields, same `payload.analysis` section — so an assessment
 * that was valued in the old workspace opens here with every assumption it had.
 *
 * ## Optional, and says so
 *
 * The lending assessment stands on its own; nothing here is validated, blocks
 * the calculation or stops the report. The price, income and loan are read from
 * the earlier steps — there is nowhere on this step to type a second copy of
 * them, which is how the old calculators came to disagree about one building.
 */

import type { AnalysisResult } from '@/lib/ciAssessment/analysisEngine';
import type { AssessmentPayload } from '@/lib/ciAssessment/types';
import { ValuationStage } from '@/components/commercial/workspace/ValuationStage';
import { ForecastStage } from '@/components/commercial/workspace/ForecastStage';

interface Props {
  payload: AssessmentPayload;
  analysis: AnalysisResult;
  onChange: (next: AssessmentPayload) => void;
  disabled?: boolean;
}

export function StepValuationForecast({ payload, analysis, onChange, disabled }: Props) {
  return (
    <div className="space-y-5">
      <div className="ci-warning-row ci-warning-info" role="note">
        <p>
          <span className="font-semibold text-foreground">Optional.</span>{' '}
          What the asset is worth on the income it produces, and what holding it returns. The price, income
          and loan come from the earlier steps; the lending result does not depend on anything here.
        </p>
      </div>
      <ValuationStage payload={payload} analysis={analysis} onChange={onChange} disabled={disabled} />
      <ForecastStage payload={payload} analysis={analysis} onChange={onChange} disabled={disabled} />
    </div>
  );
}
