/**
 * Who can generate a report, and what happens when they do.
 *
 * The product's rule is one sentence — *only from a completed assessment* — and
 * it is stated in three places: the row action on the list, the button on the
 * results step, and the route. The route is the one that matters for
 * correctness; these are the two that matter for whether anybody is confused.
 *
 * The pending state is keyed by assessment id rather than being a boolean,
 * because on a list of twenty rows a boolean spins all twenty.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { isReportable } from '@/lib/reports/commercialCapacity/route.pure';
import { runAssessment } from '@/lib/ciAssessment/engine';
import { baseAssessment, AS_AT } from '@/lib/ciAssessment/__tests__/fixtures';
import { StepResults } from '../StepResults';

const requestCapacityReport = vi.fn();
const downloadCapacityReport = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/reports/commercialCapacity/requestCapacityReport', () => ({
  requestCapacityReport: (...args: unknown[]) => requestCapacityReport(...args),
  downloadCapacityReport: (...args: unknown[]) => downloadCapacityReport(...args),
}));
// The hook now asks for an activated Template Builder template before
// rendering its own way. Stubbed to "there is none", which is this
// deployment's state and the path these tests are about; the wiring itself is
// covered by `lib/reports/__tests__/templateRouteWiring.spec.ts`.
const tryTemplateDocument = vi.fn(async () => null);
vi.mock('@/lib/reportTemplate/templateDocument', () => ({
  tryTemplateDocument: () => tryTemplateDocument(),
  saveTemplateDocument: vi.fn(),
}));
vi.mock('@/hooks/use-toast', () => ({ toast: (...args: unknown[]) => toast(...args) }));

// Imported after the mocks so the hook picks them up.
const { useCapacityReport } = await import('@/hooks/useCapacityReport');

const RESULT = {
  url: 'https://example.test/signed',
  fileName: 'Commercial_Capacity_Report_CI_1_2026-08-05.pdf',
  bytes: 84_000,
  pageCount: 17,
  brandGaps: [] as string[],
  hasAnalysis: true,
  analysisNote: null as string | null,
};

beforeEach(() => {
  requestCapacityReport.mockReset().mockResolvedValue(RESULT);
  downloadCapacityReport.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
});

afterEach(cleanup);

describe('the rule', () => {
  it('is the same rule the route enforces', () => {
    // The UI and the route read one predicate. A second copy of "completed or
    // linked" in a component is a copy that will disagree the day a status is
    // added.
    expect(isReportable('completed')).toBe(true);
    expect(isReportable('linked')).toBe(true);
    expect(isReportable('calculated')).toBe(false);
  });
});

describe('useCapacityReport', () => {
  it('requests the report, downloads it, and says what arrived', async () => {
    const { result } = renderHook(() => useCapacityReport());

    await act(async () => { await result.current.generate('assessment-1'); });

    expect(requestCapacityReport).toHaveBeenCalledWith({
      assessmentId: 'assessment-1',
      refreshAnalysis: false,
    });
    expect(downloadCapacityReport).toHaveBeenCalledWith(RESULT);
    expect(toast.mock.calls.at(-1)?.[0]?.description).toContain(RESULT.fileName);
    expect(result.current.generatingId).toBeNull();
  });

  it('says when the document came back without its analysis', async () => {
    requestCapacityReport.mockResolvedValue({
      ...RESULT, hasAnalysis: false, analysisNote: 'The analysis service was unavailable.',
    });
    const { result } = renderHook(() => useCapacityReport());

    await act(async () => { await result.current.generate('assessment-1'); });

    // The moment to learn this is now, before it is sent — not after somebody
    // asks why the report has no Analysis section.
    expect(toast.mock.calls.at(-1)?.[0]?.description).toContain('unavailable');
  });

  it('says when the tenant\'s branding is incomplete', async () => {
    requestCapacityReport.mockResolvedValue({ ...RESULT, brandGaps: ['no ABN', 'no logo'] });
    const { result } = renderHook(() => useCapacityReport());

    await act(async () => { await result.current.generate('assessment-1'); });

    expect(toast.mock.calls.at(-1)?.[0]?.description).toContain('no ABN');
  });

  it('reports a failure rather than a silent nothing', async () => {
    requestCapacityReport.mockRejectedValue(new Error('The report service is not deployed yet.'));
    const { result } = renderHook(() => useCapacityReport());

    await act(async () => { await result.current.generate('assessment-1'); });

    const last = toast.mock.calls.at(-1)?.[0];
    expect(last?.variant).toBe('destructive');
    expect(last?.description).toContain('not deployed');
    // And the button comes back, rather than spinning forever.
    expect(result.current.generatingId).toBeNull();
  });

  it('will not start a second render while one is running', async () => {
    let release: (value: typeof RESULT) => void = () => {};
    requestCapacityReport.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const { result } = renderHook(() => useCapacityReport());

    let first: Promise<void>;
    act(() => { first = result.current.generate('assessment-1'); });
    await waitFor(() => expect(result.current.generatingId).toBe('assessment-1'));

    // A render is a model call, a WeasyPrint job and a stored file. A
    // double-click must not produce two of each.
    await act(async () => { await result.current.generate('assessment-2'); });
    expect(requestCapacityReport).toHaveBeenCalledTimes(1);

    await act(async () => { release(RESULT); await first; });
  });
});

describe('the results step', () => {
  const payload = baseAssessment();
  const result = runAssessment(payload, { asAt: AS_AT });

  function renderStep(over: Partial<Parameters<typeof StepResults>[0]> = {}) {
    // The step now carries the report-template selector, whose queries need a
    // client. retry: false so an unmocked read settles as an error state
    // instead of retrying into the test's timeout.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <StepResults
          payload={payload}
          result={result}
          onRecalculate={() => {}}
          onGenerateReport={() => {}}
          canGenerateReport
          {...over}
        />
      </QueryClientProvider>,
    );
  }

  it('offers the report when the assessment is reportable', () => {
    const onGenerateReport = vi.fn();
    renderStep({ onGenerateReport });

    const button = screen.getByRole('button', { name: /generate report/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onGenerateReport).toHaveBeenCalled();
  });

  it('says why it cannot, rather than only greying out', () => {
    // A greyed-out control with no explanation is the commonest way a user
    // decides a feature is broken — and here the reason is a step they can
    // take.
    renderStep({
      canGenerateReport: false,
      reportBlockedReason: 'Complete the assessment to generate its report.',
    });

    expect(screen.getByRole('button', { name: /generate report/i })).toBeDisabled();
    expect(screen.getByText(/Complete the assessment to generate its report\./)).toBeInTheDocument();
  });

  it('shows the render is running, and cannot be started twice', () => {
    const onGenerateReport = vi.fn();
    renderStep({ generatingReport: true, onGenerateReport });

    const button = screen.getByRole('button', { name: /generating/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onGenerateReport).not.toHaveBeenCalled();
  });
});
