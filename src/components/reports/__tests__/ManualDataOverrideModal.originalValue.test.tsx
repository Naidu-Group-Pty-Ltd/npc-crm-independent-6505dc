import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ManualDataOverrideModal } from '../ManualDataOverrideModal';

// Keep the heavy / side-effecting surface out of this data-display test.
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn().mockResolvedValue({ data: { success: true }, error: null }),
}));
vi.mock('@/hooks/useActivityLogger', () => ({ logActivityDirect: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-breakpoint', () => ({
  useBreakpoint: () => 'desktop',
  useIsTabletOrBelow: () => false,
}));
vi.mock('@/components/ui/sidebar', () => ({ useSidebar: () => ({ state: 'expanded' }) }));
vi.mock('../MortgageRepaymentCalculator', () => ({ MortgageRepaymentCalculator: () => null }));
vi.mock('../DepreciationValueCalculator', () => ({ DepreciationValueCalculator: () => null }));
vi.mock('../LandTaxCalculator', () => ({ LandTaxCalculator: () => null }));

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => {}, writable: true });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false, writable: true });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, writable: true });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: () => {}, writable: true });
});

/** The rounded card that wraps a single override field (label + original + override). */
function fieldCard(label: string): HTMLElement {
  const labelEl = screen.getByText(label);
  const card = labelEl.closest('.rounded-lg') as HTMLElement | null;
  if (!card) throw new Error(`Could not find field card for "${label}"`);
  return card;
}

describe('ManualDataOverrideModal — Original Value (API) resolution', () => {
  it('shows the manual-entry figures instead of "Not available" when financial_calculations is empty', () => {
    // Mirrors the reported report: financial_calculations null, all figures in manual_overrides.
    const report = {
      id: 'r-manual',
      property_address: 'Lot 1128 Holloway Road, Melton South VIC 3338',
      financial_calculations: null,
      manual_overrides: {
        buildType: 'new_build',
        purchasePrice: 683700,
        landPrice: 325000,
        buildPrice: 358700,
        carSpaces: 2,
      },
    };

    render(<ManualDataOverrideModal report={report} isOpen onClose={vi.fn()} onSave={vi.fn()} />);

    const purchase = fieldCard('Purchase Price');
    expect(purchase.textContent).toContain('683,700');
    expect(purchase.textContent).not.toContain('Not available');

    const land = fieldCard('Land Price');
    expect(land.textContent).toContain('325,000');
    expect(land.textContent).not.toContain('Not available');

    const build = fieldCard('Build Price');
    expect(build.textContent).toContain('358,700');
    expect(build.textContent).not.toContain('Not available');

    const carSpaces = fieldCard('Car Spaces');
    expect(carSpaces.textContent).not.toContain('Not available');
  });

  it('reads the original figure from the nested financial_calculations for API reports', () => {
    const report = {
      id: 'r-api',
      property_address: '10 Example St, Sydney NSW 2000',
      financial_calculations: {
        initialCosts: { propertyValue: 450000, deposit: 45000 },
        loanDetails: { interestRate: 6.5, lvr: 90 },
        keyMetrics: { lvr: 90 },
      },
      manual_overrides: {},
    };

    render(<ManualDataOverrideModal report={report} isOpen onClose={vi.fn()} onSave={vi.fn()} />);

    const purchase = fieldCard('Purchase Price');
    expect(purchase.textContent).toContain('450,000');
    expect(purchase.textContent).not.toContain('Not available');

    const interest = fieldCard('Interest Rate');
    expect(interest.textContent).toContain('6.5');
    expect(interest.textContent).not.toContain('Not available');
  });
});
