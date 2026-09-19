/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommercialIndustrialOverviewCard } from './CommercialIndustrialOverviewCard';
import { getDefaultCommercialIndustrialDealProfile, useCommercialDealState } from '@/utils/commercial/commercialDealState';

/*
 * Declared through `vi.hoisted`, because `vi.mock` factories are hoisted above
 * them.
 *
 * These were plain `const`s, and the factories below close over them — so at
 * the moment Vitest ran a factory the bindings were still in their temporal
 * dead zone and the whole FILE failed to load with "Cannot access
 * 'toastSuccess' before initialization". Not one assertion in it ran, which is
 * why a card test could sit red without anyone reading a failure message about
 * the card.
 */
const { toastSuccess, toastError, pushBack } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  pushBack: vi.fn(async () => ({ ok: true })),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: toastSuccess,
    error: toastError,
    message: vi.fn(),
  }),
}));

vi.mock('@/contexts/CalculatorPrefillContext', () => ({
  useCalculatorPrefill: () => ({
    prefill: { propertyId: 'property-1', address: '1 Test Street', domain: 'commercial' },
    property: { id: 'property-1' },
    pushBack,
  }),
}));

/**
 * The Report Actions card, and only it.
 *
 * Both tests here are about that card — where it sits and what its buttons are
 * wired to — but they queried the whole document. When the deal profile is
 * incomplete the component ALSO renders a "Property-level information is
 * incomplete" banner carrying its own "Review Missing Data (n)" and "Review AI
 * Estimates (n)" buttons, and this fixture is deliberately incomplete, so
 * `getByRole` matched two and threw.
 *
 * Scoping to the card is what the tests say they do. The second button is a
 * product decision about a contextual prompt — deliberately neither blessed nor
 * removed here; a test named "report actions placement" is not the place to
 * settle it.
 */
const reportActionsCard = () => {
  // Climb from the title to the smallest ancestor that also holds the card's
  // own unique action, rather than guessing at a class name.
  let el: HTMLElement | null = screen.getByText('Report Actions');
  while (el && !el.textContent?.includes('Generate Client Report')) {
    el = el.parentElement;
  }
  if (!el) throw new Error('Report Actions card not found');
  return within(el);
};

describe('CommercialIndustrialOverviewCard report actions placement and actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const profile = getDefaultCommercialIndustrialDealProfile();
    useCommercialDealState.setState({
      profile: {
        ...profile,
        /*
         * A valuation, because Save Back is about sending one.
         *
         * `getDefaultCommercialIndustrialDealProfile()` returns an EMPTY
         * `propertyValuation`, so `handleSaveBack` built an empty patch, took
         * its `toast.message('No calculator-derived values to save back yet.')`
         * branch and never called `pushBack` — and the assertion below, which
         * has never run, expects exactly that call. The figures are the ones it
         * names.
         */
        propertyValuation: {
          ...profile.propertyValuation,
          purchasePrice: 3_500_000,
          estimatedMarketValue: 3_500_000,
        },
        assumptions: {
          missing: {
            fieldKey: 'missing',
            label: 'Missing field',
            confidenceTag: 'Unknown',
            source: 'manual',
            updatedAt: '2026-06-15T00:00:00.000Z',
          } as any,
        },
        aiEstimateMetadata: {
          aiEstimate: {
            fieldKey: 'aiEstimate',
            confidenceTag: 'AI Estimate',
            rationale: 'Test estimate',
          } as any,
        },
      },
    });
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:report'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    HTMLAnchorElement.prototype.click = vi.fn();
    sessionStorage.clear();
  });

  it('renders exactly one Report Actions card, ahead of the detailed sections', () => {
    const { container } = render(<CommercialIndustrialOverviewCard />);

    expect(screen.getAllByText('Report Actions')).toHaveLength(1);
    const card = reportActionsCard();
    expect(card.getByRole('button', { name: /Review Missing Data \(1\)/ })).toBeInTheDocument();
    expect(card.getByRole('button', { name: /Review AI Estimates \(1\)/ })).toBeInTheDocument();

    const reportActionsTitle = screen.getByText('Report Actions');
    const firstDetailTitle = screen.getByText('Transaction Snapshot');
    const allElements = Array.from(container.querySelectorAll('*'));

    expect(allElements.indexOf(reportActionsTitle)).toBeLessThan(allElements.indexOf(firstDetailTitle));
  });

  /**
   * The other half of the original assertion, now implemented.
   *
   * It read "directly after the overview summary and before detailed
   * sections", and the component returned `{ReportActions}` FIRST — before the
   * incomplete-property banner and before the overview card (measured: Report
   * Actions title at element 5, overview title at 63). The test and the
   * component arrived in the same merge (PR #2085) and the file was never
   * collectable — `vi.mock` hoisting killed it on load — so the assertion had
   * never run and the disagreement was unimplemented intent rather than a
   * regression. The card has been moved to where the sentence says.
   *
   * Both neighbours are pinned, not just the one: an ordering test that only
   * checks what comes after passes just as well when the card is first.
   */
  it('places Report Actions after the overview summary and before the detailed sections', () => {
    const { container } = render(<CommercialIndustrialOverviewCard />);
    const order = Array.from(container.querySelectorAll('*'));
    const at = (text: string) => order.indexOf(screen.getByText(text));

    const overview = at('Commercial / Industrial Assessment Overview');
    const reportActions = at('Report Actions');
    const firstDetail = at('Transaction Snapshot');

    expect(overview).toBeGreaterThanOrEqual(0);
    expect(reportActions).toBeGreaterThan(overview);
    expect(reportActions).toBeLessThan(firstDetail);
  });

  it('keeps Report Actions buttons wired to their existing behaviours', async () => {
    render(<CommercialIndustrialOverviewCard />);

    fireEvent.click(screen.getByRole('button', { name: /Generate Client Report/ }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('Client report payload generated'));

    fireEvent.click(reportActionsCard().getByRole('button', { name: /Review Missing Data \(1\)/ }));
    expect(await screen.findByText('Missing Data & Specialist Review Items')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Close/ }).at(-1)!);
    fireEvent.click(reportActionsCard().getByRole('button', { name: /Review AI Estimates \(1\)/ }));
    expect(await screen.findByText('AI Estimated Fields')).toBeInTheDocument();

    // Close it before reaching for the card again: both reviews open a modal
    // dialog, and while one is open the rest of the page is inert to the
    // accessibility tree, so "Save Back to Property" cannot be found. The
    // Missing Data step above already closes for this reason; the AI step did
    // not, which nobody could see while the file failed to load.
    fireEvent.click(screen.getAllByRole('button', { name: /Close/ }).at(-1)!);
    // `handleSaveBack` is async and awaits `pushBack`, so the call has not been
    // made yet on the tick the click returns.
    fireEvent.click(screen.getByRole('button', { name: /Save Back to Property/ }));
    await waitFor(() => {
      expect(pushBack).toHaveBeenCalledWith(expect.objectContaining({ purchase_price: 3500000, valuation: 3500000 }));
    });

    fireEvent.click(screen.getByRole('button', { name: /Export Summary/ }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: /Push to Client Portal/ }));
    expect(sessionStorage.getItem('commercial-portal-pending:property-1')).toContain('transactionSummary');
  });
});
