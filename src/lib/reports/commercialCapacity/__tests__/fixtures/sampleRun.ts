/**
 * The fixture every suite in this folder runs on.
 *
 * It is **not hand-authored**, and that is the whole point. The Snapshot's
 * fixture was written by hand four times and every draft invented a shape — a
 * `source` where the engine emits `component`, a percentage where the code
 * wants a 0–1 fraction, an `lmi_mode` the column has never held — and every one
 * produced a page of plausible-looking wrong output
 * (`docs/reports/BORROWING_CAPACITY.md` §3). The lesson recorded there is
 * *read the reader, not a summary of it*; the cheaper version is to not write
 * the fixture at all.
 *
 * So this runs the **real engine** over the **real worked example** — the
 * fictional deal that ships in the intake pack, Asteron Industrial Holdings at
 * 88 Foundry Link — and stores what comes out. Every field the normaliser reads
 * is therefore a field the engine emits, spelled the way the engine spells it,
 * scaled the way the engine scales it. If the engine's shape moves, these tests
 * move with it rather than silently testing a shape nothing produces.
 *
 * The deal is fictional throughout. Nothing here is a real borrower, a real
 * property or a real tenant.
 */

import { runAssessment, type AssessmentResult } from '@/lib/ciAssessment/engine';
import { sampleAssessment } from '@/lib/ciAssessment/intakePack/sample';
import type { AssessmentPayload } from '@/lib/ciAssessment/types';

/** Fixed, so a lease-expiry calculation does not drift with the wall clock. */
export const AS_AT = new Date('2026-08-05T00:00:00.000Z');

export function samplePayload(): AssessmentPayload {
  return sampleAssessment();
}

export function sampleOutputs(payload: AssessmentPayload = samplePayload()): AssessmentResult {
  return runAssessment(payload, { asAt: AS_AT });
}

/** A `commercial_industrial_assessments` row, as the render route reads it. */
export function sampleAssessmentRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: '4f2c9a1e-8b7d-4c3a-9e51-2d6f8a0b1c34',
    user_id: 'c1a2b3c4-d5e6-4f70-8123-456789abcdef',
    reference: 'CI-2026-0184',
    title: 'Asteron Industrial Holdings — 88 Foundry Link',
    status: 'completed',
    segment: 'industrial',
    assessment_type: 'industrial_investment',
    client_id: null,
    current_calculation_id: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    created_at: '2026-07-28T02:14:00.000Z',
    updated_at: '2026-08-05T01:02:00.000Z',
    ...overrides,
  };
}

/** A `commercial_industrial_calculation_runs` row. */
export function sampleRunRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const payload = samplePayload();
  return {
    id: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    assessment_id: '4f2c9a1e-8b7d-4c3a-9e51-2d6f8a0b1c34',
    user_id: 'c1a2b3c4-d5e6-4f70-8123-456789abcdef',
    scenario_key: 'base',
    inputs_snapshot: payload,
    outputs: sampleOutputs(payload),
    analysis: null,
    created_at: '2026-08-05T01:02:00.000Z',
    ...overrides,
  };
}

/**
 * A complete analysis, shaped exactly as `parseAnalysis` returns one.
 *
 * Fictional prose about a fictional deal. It exists so the analysis section can
 * be rendered and read without a model call in the test suite.
 */
export const SAMPLE_ANALYSIS = {
  interpretation:
    'The assessment supports an indicative facility below the amount requested. Capacity is '
    + 'set by the debt service cover test rather than by loan-to-value, which means the '
    + 'property\'s income — not its value — is what limits the borrowing. Reducing the facility '
    + 'or lifting net operating income are the two levers that move the result; a larger '
    + 'valuation would not.',
  findings: [
    {
      title: 'A single tenant carries most of the passing rent',
      detail:
        'Income concentration of this order means the serviceability rests on one covenant. '
        + 'A lender will assess the tenant\'s financial strength as closely as the borrower\'s.',
      significance: 'risk' as const,
    },
    {
      title: 'Loan-to-value sits comfortably inside policy',
      detail:
        'There is room under the ceiling, which is what gives the structuring options below '
        + 'somewhere to go.',
      significance: 'strength' as const,
    },
    {
      title: 'The surplus narrows under rate sensitivity',
      detail:
        'The facility services at the assessment rate and has less room under the engine\'s '
        + 'sensitivity test. A credit assessor will ask about it.',
      significance: 'observation' as const,
    },
  ],
  scenarios: [
    {
      name: 'Reduce the facility to the assessed capacity',
      reasoning:
        'The fastest route to a supportable structure is to fund the difference from equity '
        + 'rather than to argue the tests.',
      estimatedImpact: 'Brings the deal inside every applied test without changing the asset.',
      executionRisk: 'low' as const,
      evidenceRequired: [
        'Evidence of available cash or equity for the increased contribution',
        'Confirmation the vendor will proceed on the revised funding structure',
      ],
    },
    {
      name: 'Extend the lease term before settlement',
      reasoning:
        'Term remaining is what a lender will rely on. A longer WALE improves the income the '
        + 'debt service cover test is calculated on.',
      estimatedImpact: 'Improves the debt service cover position; direction only, not quantified.',
      executionRisk: 'medium' as const,
      evidenceRequired: [
        'Signed lease extension or an executed option notice',
        'Tenant financial statements for the last two years',
      ],
    },
  ],
  questionsForCredit: [
    'What is the tenant\'s trading history and financial position?',
    'What happens to the income if the lease is not renewed at expiry?',
    'Is the borrower\'s contribution genuine savings or borrowed elsewhere?',
  ],
  model: 'google/gemini-2.5-flash',
  generatedAt: '2026-08-05T01:10:00.000Z',
};
