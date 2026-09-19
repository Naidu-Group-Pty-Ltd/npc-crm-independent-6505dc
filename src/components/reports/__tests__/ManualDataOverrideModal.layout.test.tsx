import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ManualDataOverrideModal } from '../ManualDataOverrideModal';

// --- Mocks: keep the heavy / side-effecting surface out of the layout test ---
const invokeSecureFunction = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: (...args: unknown[]) => invokeSecureFunction(...args),
}));

vi.mock('@/hooks/useActivityLogger', () => ({
  logActivityDirect: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Desktop chrome so the shell offsets (sidebar + header) are active.
vi.mock('@/hooks/use-breakpoint', () => ({
  useBreakpoint: () => 'desktop',
  useIsTabletOrBelow: () => false,
}));

// The dialog portals outside the SidebarProvider; feed it an expanded sidebar.
vi.mock('@/components/ui/sidebar', () => ({
  useSidebar: () => ({ state: 'expanded' }),
}));

// Nested calculators pull chart/iframe deps that are irrelevant to layout.
vi.mock('../MortgageRepaymentCalculator', () => ({ MortgageRepaymentCalculator: () => null }));
vi.mock('../DepreciationValueCalculator', () => ({ DepreciationValueCalculator: () => null }));
vi.mock('../LandTaxCalculator', () => ({ LandTaxCalculator: () => null }));

beforeAll(() => {
  // Radix ScrollArea / Select rely on these in jsdom.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: () => {}, writable: true });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: () => false, writable: true });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, writable: true });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: () => {}, writable: true });
});

const baseReport = {
  id: 'report-1',
  property_address: '12 Test Street, Sydney NSW 2000',
  financial_calculations: { purchasePrice: 683700, propertyType: 'house' },
  manual_overrides: {},
};

// Radix Tabs activate on mouseDown (automatic activation), not a bare click event.
function selectTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }));
}

function renderModal(overrides: Partial<Parameters<typeof ManualDataOverrideModal>[0]> = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ManualDataOverrideModal
      report={baseReport}
      isOpen
      onClose={onClose}
      onSave={onSave}
      {...overrides}
    />,
  );
  return { onClose, onSave };
}

describe('ManualDataOverrideModal — shell-contained layout', () => {
  it('renders the contained dialog with the shell offsets and reduced width', () => {
    renderModal();

    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('manual-data-override-dialog');
    expect(dialog.className).toContain('max-w-[1500px]');
    expect(dialog.className).toContain('left-[calc(var(--manual-override-sidebar-width)_+_1rem)]');
    expect(dialog.className).toContain('top-[calc(var(--manual-override-header-height)_+_1rem)]');
    // Both vertical insets pinned => definite height => the body can scroll internally.
    expect(dialog.className).toContain('bottom-4');
    expect(dialog.className).toContain('mx-auto');
    // Never edge-to-edge.
    expect(dialog.className).not.toContain('w-screen');
    expect(dialog.className).not.toContain('w-full');

    // The live sidebar/header measurements are handed to the portal as CSS vars.
    expect(dialog.style.getPropertyValue('--manual-override-sidebar-width')).toBe('16rem');
    expect(dialog.style.getPropertyValue('--manual-override-header-height')).toBe('72px');
  });

  it('dims only the content frame, leaving the sidebar and header visible', () => {
    renderModal();

    const overlay = document.querySelector('.luxury-dialog-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.className).toContain('!left-[var(--manual-override-sidebar-width)]');
    expect(overlay.className).toContain('!top-[var(--manual-override-header-height)]');
    expect(overlay.style.getPropertyValue('--manual-override-sidebar-width')).toBe('16rem');
  });

  it('keeps the header, both tabs, close button and footer actions present', () => {
    renderModal();

    expect(screen.getByText('Manual Data Override')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Investment Report/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Cash Flow Analysis/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset All/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save & Regenerate/i })).toBeInTheDocument();
  });

  it('switches to the Cash Flow Analysis tab and back', () => {
    renderModal();

    expect(screen.getByText('Purchase Price')).toBeInTheDocument();

    selectTab(/Cash Flow Analysis/i);
    expect(screen.getByText('Loan Amount')).toBeInTheDocument();

    selectTab(/Investment Report/i);
    expect(screen.getByText('Purchase Price')).toBeInTheDocument();
  });

  it('preserves an entered override value across a tab switch', () => {
    renderModal();

    const purchasePrice = screen.getByPlaceholderText('Enter purchase price') as HTMLInputElement;
    fireEvent.change(purchasePrice, { target: { value: '500000' } });
    expect(purchasePrice.value).toBe('500,000');

    selectTab(/Cash Flow Analysis/i);
    selectTab(/Investment Report/i);

    const purchasePriceAfter = screen.getByPlaceholderText('Enter purchase price') as HTMLInputElement;
    expect(purchasePriceAfter.value).toBe('500,000');
  });

  it('leaves the Save & Regenerate handler wired to the secure update call', async () => {
    invokeSecureFunction.mockClear();
    const { onSave } = renderModal();

    const saveButton = screen.getByRole('button', { name: /Save & Regenerate/i });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Enter purchase price'), { target: { value: '500000' } });
    await waitFor(() => expect(saveButton).not.toBeDisabled());

    fireEvent.click(saveButton);

    await waitFor(() => expect(invokeSecureFunction).toHaveBeenCalled());
    const updateCall = invokeSecureFunction.mock.calls.find(
      ([fn, payload]) => fn === 'manage-investment-reports' && (payload as { action?: string })?.action === 'update',
    );
    expect(updateCall).toBeTruthy();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });

  it('renders Reset All, Cancel and Close as clickable without throwing', () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: /Reset All/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalled();

    // Close button (portal-rendered, inside the modal frame) invokes onOpenChange.
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Close/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
