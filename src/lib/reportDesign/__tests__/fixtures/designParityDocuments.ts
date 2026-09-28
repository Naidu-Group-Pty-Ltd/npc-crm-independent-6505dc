/**
 * One full document per report type that takes a chosen design, drawn through
 * its production entry point (`render<Format>FromBrand`), for
 * `templateDesignParity.spec.ts`.
 *
 * Each payload is the LONGEST document its format can produce — every optional
 * chapter on, charts included — because a comparison of two documents is only
 * as strong as the branches they both reach. They are built through the real
 * normalisers, from the fixtures each format's own specs already trust.
 *
 * Everything here is invented; the names and figures are fictional.
 */
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';
import type { ReportTemplateDesign } from '../../../../../supabase/functions/_shared/reportDesign/templateDesign.pure';
import {
  cashFlowComparisonMaximal,
  cashFlowMaximal,
  clientDetailsMaximal,
  marketIntelligenceMaximal,
  portfolioMaximal,
  propertyComparisonMaximal,
} from '@/lib/reports/converted/__tests__/formatPayloads';
import {
  SAMPLE_ASSESSMENT,
  SAMPLE_AUDIT_TRAIL,
  SAMPLE_CLIENT_NAME,
  SAMPLE_EXPLANATION,
  SAMPLE_SCENARIO_PRESETS,
} from '@/lib/reports/borrowingCapacity/__tests__/fixtures/sampleAssessment';
import {
  SAMPLE_ANALYSIS,
  sampleAssessmentRow,
  sampleRunRow,
} from '@/lib/reports/commercialCapacity/__tests__/fixtures/sampleRun';
import { buildSnapshot } from '../../../../../supabase/functions/_shared/reports/borrowingCapacity/normalise.pure';
import { renderSnapshotFromBrand } from '../../../../../supabase/functions/_shared/reports/borrowingCapacity/render.pure';
import { renderCashFlowFromBrand } from '../../../../../supabase/functions/_shared/reports/cashFlow/render.pure';
import { renderComparisonFromBrand as renderCashFlowComparisonFromBrand } from '../../../../../supabase/functions/_shared/reports/cashFlowComparison/render.pure';
import { renderClientDetailsFromBrand } from '../../../../../supabase/functions/_shared/reports/clientDetails/render.pure';
import { buildCapacitySnapshot } from '../../../../../supabase/functions/_shared/reports/commercialCapacity/normalise.pure';
import { renderCapacityFromBrand } from '../../../../../supabase/functions/_shared/reports/commercialCapacity/render.pure';
import { renderMarketIntelligenceFromBrand } from '../../../../../supabase/functions/_shared/reports/marketIntelligence/render.pure';
import { renderPortfolioFromBrand } from '../../../../../supabase/functions/_shared/reports/portfolio/render.pure';
import { renderComparisonFromBrand as renderPropertyComparisonFromBrand } from '../../../../../supabase/functions/_shared/reports/propertyComparison/render.pure';
import { buildReportQaDocument } from '../../../../../supabase/functions/_shared/reports/reportQa/normalise.pure';
import { renderReportQaFromBrand } from '../../../../../supabase/functions/_shared/reports/reportQa/render.pure';

export const PARITY_NOW = '2026-08-02T00:00:00.000Z';

/**
 * A white-label tenant with a brand colour of its own, so a design visibly
 * replaces something rather than coinciding with the house palette.
 */
export const PARITY_SNAPSHOT = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', brandColour: '#2E6F95', preset: 'signature' },
  contact: {
    company_name: 'Tenant Advisory Pty Ltd',
    abn: '11 222 333 444',
    email: 'hello@tenant.example',
    phone: '07 3000 0000',
  },
  capturedAt: PARITY_NOW,
}).snapshot;

const QA_ID = '11111111-1111-4111-8111-111111111111';
const qaMid = (n: number) => `2222${String(n).padStart(4, '0')}-2222-4222-8222-222222222222`;
const qaAt = (n: number) => new Date(Date.UTC(2026, 6, 1, 0, n)).toISOString();

/** Three exchanges, each carrying a table, a list and a quotation. */
function qaTranscript() {
  const answer = (n: number) => `## Answer ${n}

The position holds on a **3.98%** gross yield in exchange ${n}.

| Metric | Value |
| --- | ---: |
| Purchase price | $850,000 |
| Rent (weekly) | $6${n}0 |

- Vacancy has risen for two quarters
- Body corporate fees are above the median

> A six-month buffer is prudent.`;
  const messages = [1, 2, 3].flatMap((n) => [
    { id: qaMid(n * 2), role: 'user', content: `Question ${n} about 12 Mariners Quay?`, created_at: qaAt(n * 2) },
    {
      id: qaMid(n * 2 + 1), role: 'assistant', content: answer(n), created_at: qaAt(n * 2 + 1),
      model_provider: 'openai', model_version: 'gpt-5.2',
    },
  ]);
  const built = buildReportQaDocument({
    conversation: {
      id: QA_ID,
      title: 'Mariners Quay, Newstead — investment review',
      report_names: ['Mariners Quay Investment Report.pdf'],
      structured_report: null,
    },
    messages,
    subject: 'transcript',
    preparedOn: PARITY_NOW,
  } as never);
  if (built.ok === false) throw new Error(built.error);
  return built.document;
}

export interface ParityFormat {
  /** The normalised report type the design register names. */
  reportType: string;
  label: string;
  /** The document's full HTML, drawn with the design or without one. */
  render: (design: ReportTemplateDesign | null) => string;
}

/**
 * Every report type whose chosen template reaches its standard document.
 *
 * Built lazily and once per format, so a spec that asks for one format does
 * not pay for all nine.
 */
export function parityFormats(): ParityFormat[] {
  const snapshot = PARITY_SNAPSHOT;
  const bc = buildSnapshot({
    clientName: SAMPLE_CLIENT_NAME,
    assessment: SAMPLE_ASSESSMENT,
    auditTrail: SAMPLE_AUDIT_TRAIL,
    explanation: SAMPLE_EXPLANATION,
    scenarioPresets: SAMPLE_SCENARIO_PRESETS,
    now: PARITY_NOW,
  } as never);
  const run = sampleRunRow();
  const cc = buildCapacitySnapshot({
    assessment: sampleAssessmentRow(),
    outputs: run.outputs,
    inputs: run.inputs_snapshot,
    clientName: 'Asteron Industrial Holdings Pty Ltd',
    analysis: SAMPLE_ANALYSIS,
  } as never);
  const qa = qaTranscript();
  const cashFlow = cashFlowMaximal();
  const cfc = cashFlowComparisonMaximal();
  const clientDetails = clientDetailsMaximal();
  const mi = marketIntelligenceMaximal();
  const portfolio = portfolioMaximal();
  const comparison = propertyComparisonMaximal();

  return [
    {
      reportType: 'borrowing_capacity',
      label: 'Borrowing Capacity',
      render: (design) => renderSnapshotFromBrand({
        payload: bc, snapshot, design, edition: 'VOL. 2026 · ED. 08', reference: 'BC-0001',
      }).html,
    },
    {
      reportType: 'cashflow',
      label: '10 Year Cash Flow',
      render: (design) => renderCashFlowFromBrand({ projection: cashFlow, snapshot, design }).html,
    },
    {
      reportType: 'cash_flow_comparison',
      label: 'Cash Flow Comparison',
      render: (design) => renderCashFlowComparisonFromBrand({ comparison: cfc, snapshot, design }).html,
    },
    {
      reportType: 'client_details',
      label: 'Client Details',
      render: (design) => renderClientDetailsFromBrand({ details: clientDetails, snapshot, design }).html,
    },
    {
      reportType: 'commercial_capacity',
      label: 'Commercial & Industrial Capacity',
      render: (design) => renderCapacityFromBrand({ payload: cc, snapshot, design, reference: 'CI-2026-0184' }).html,
    },
    {
      reportType: 'market_intelligence',
      label: 'Market Intelligence',
      render: (design) => renderMarketIntelligenceFromBrand({ report: mi, snapshot, design }).html,
    },
    {
      reportType: 'portfolio',
      label: 'Portfolio Performance Review',
      render: (design) => renderPortfolioFromBrand({ review: portfolio, snapshot, design }).html,
    },
    {
      reportType: 'comparison',
      label: 'Property Comparison',
      render: (design) => renderPropertyComparisonFromBrand({ comparison, snapshot, design }).html,
    },
    {
      reportType: 'qa',
      label: 'Report Q&A',
      render: (design) => renderReportQaFromBrand({ document: qa, snapshot, design }).html,
    },
  ];
}
