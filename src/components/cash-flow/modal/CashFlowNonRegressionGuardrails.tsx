/**
 * Phase 0 non-regression guardrails for Cash Flow modal UI/UX work.
 *
 * These rules intentionally live beside the presentational modal components so
 * future visual refactors can import/read them before touching the sensitive
 * orchestration in CashFlowAnalysisModal. Keep UI-only changes isolated here
 * unless a product requirement explicitly calls for calculation or persistence
 * changes.
 */
export const CASH_FLOW_NON_REGRESSION_RULES = [
  'Do not change yearlyOverrides shape.',
  'Do not change projection calculation formulas.',
  'Do not change mortgage/amortisation usage.',
  'Do not change save overrides payload.',
  'Do not change reset override behavior.',
  'Do not change chart data generation.',
  'Do not change chart refs.',
  'Do not change Excel export.',
  'Do not change PDF export.',
  'Do not change flattened PDF export.',
  'Do not change print view.',
  'Do not change SendToClientModal integration.',
  'Do not change comparison report limit.',
  'Do not change AI comparison payloads.',
  'Do not change construction schedule calculations.',
] as const;

interface CashFlowNonRegressionGuardrailsProps {
  className?: string;
}

/**
 * Developer-facing presentational note for optional use in design sandboxes or
 * local previews. It is not rendered by the production modal today, preserving
 * existing user-facing behavior while making the locked rules discoverable.
 */
export function CashFlowNonRegressionGuardrails({ className }: CashFlowNonRegressionGuardrailsProps) {
  return (
    <section className={className} aria-label="Cash flow non-regression guardrails">
      <h2>Cash Flow UI Non-Regression Guardrails</h2>
      <ul>
        {CASH_FLOW_NON_REGRESSION_RULES.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </section>
  );
}
