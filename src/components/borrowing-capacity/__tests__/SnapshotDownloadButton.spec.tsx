/**
 * Pressing the thing, and what runs.
 *
 * `legacyPathStays.spec.ts` asserts structurally that every surface offers both
 * renderers. This asserts the other half: that the option a person picks is the
 * renderer that runs. Between them, "the legacy layout is still available" is a
 * claim about the product rather than about a source file.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const deliverSnapshot = vi.fn();
vi.mock('@/lib/reports/borrowingCapacity/deliverSnapshot', () => ({
  deliverSnapshot: (...a: unknown[]) => deliverSnapshot(...a),
}));

const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('sonner', () => ({ toast }));

const { SnapshotDownloadButton } = await import('../SnapshotDownloadButton');

const REQUEST = { clientId: 'c-1', clientName: 'A. & J. Sample' };
const legacy = vi.fn(async () => ({ blob: new Blob(['x']), fileName: 'legacy.pdf' }));

const delivered = (source: 'server' | 'legacy', brandGaps: string[] = []) =>
  ({ source, fileName: 'Borrowing_Capacity_Snapshot.pdf', brandGaps });

beforeEach(() => {
  deliverSnapshot.mockReset().mockResolvedValue(delivered('server'));
  legacy.mockClear();
  Object.values(toast).forEach((fn) => fn.mockClear());
});

const setup = (props: Record<string, unknown> = {}) =>
  // The menu now carries the template chooser for this format, which reads the
  // selection through react-query. Retries off so a failed read surfaces here
  // rather than being retried three times.
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SnapshotDownloadButton request={REQUEST} legacy={legacy} {...props} />
    </QueryClientProvider>,
  );

/**
 * Radix opens a dropdown on `pointerdown`, and jsdom's `click` does not imply
 * one. Firing both is what a real pointer does and keeps the test from being
 * coupled to which event the primitive happens to listen for.
 */
const press = (el: Element) => {
  fireEvent.pointerDown(el, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(el);
};

describe('the primary action', () => {
  it('renders server-side', async () => {
    setup();
    press(screen.getByRole('button', { name: /download snapshot/i }));

    await waitFor(() => expect(deliverSnapshot).toHaveBeenCalledTimes(1));
    expect(deliverSnapshot.mock.calls[0][0]).toMatchObject({ variant: 'server', request: REQUEST });
  });

  it('says so when the brand snapshot was short of something', async () => {
    deliverSnapshot.mockResolvedValue(delivered('server', ['no ABN — required on an Australian advisory document']));
    setup();
    press(screen.getByRole('button', { name: /download snapshot/i }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('no ABN'),
    ));
  });

  /**
   * The fallback firing is not a success message. An adviser who is told
   * "ready" when they got yesterday's layout has no way to know.
   */
  it('names the fallback when the route is not deployed', async () => {
    deliverSnapshot.mockResolvedValue(delivered('legacy'));
    setup();
    press(screen.getByRole('button', { name: /download snapshot/i }));

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining('not deployed'),
    ));
  });

  it('reports a failure to the person who pressed it, not to the console alone', async () => {
    deliverSnapshot.mockRejectedValue(new Error('no borrowing capacity assessment for this client'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    press(screen.getByRole('button', { name: /download snapshot/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'no borrowing capacity assessment for this client',
    ));
  });
});

describe('the legacy layout', () => {
  it('is offered in the menu, and picking it runs the in-browser generator', async () => {
    setup();
    press(screen.getByRole('button', { name: /other snapshot formats/i }));

    const item = await screen.findByText('Download (legacy layout)');
    press(item);

    await waitFor(() => expect(deliverSnapshot).toHaveBeenCalledTimes(1));
    expect(deliverSnapshot.mock.calls[0][0]).toMatchObject({ variant: 'legacy' });
  });

  it('takes its wording from the caller when the two documents differ', async () => {
    setup({ legacyLabel: 'Export PDF (live what-if)', legacyHint: 'Draws the unsaved inputs as the base assessment' });
    press(screen.getByRole('button', { name: /other snapshot formats/i }));

    expect(await screen.findByText('Export PDF (live what-if)')).toBeTruthy();
    expect(screen.getByText('Draws the unsaved inputs as the base assessment')).toBeTruthy();
  });
});

describe('the compact appearance', () => {
  /**
   * The client card and the reports tab have room for an icon, not a labelled
   * split button. They must still offer both — a surface that quietly drops the
   * legacy item is exactly the deprecation this work exists to prevent.
   */
  it('offers the same two choices as the split button', async () => {
    setup({ appearance: 'menu', triggerLabel: 'Export Snapshot PDF', label: 'Export Snapshot PDF' });
    press(screen.getByRole('button', { name: /export snapshot pdf/i }));

    expect(await screen.findByText('Export Snapshot PDF')).toBeTruthy();
    expect(screen.getByText('Download (legacy layout)')).toBeTruthy();
  });
});

describe('while it is running', () => {
  it('does not start a second render on a second click', async () => {
    let release: (v: unknown) => void = () => {};
    deliverSnapshot.mockImplementation(() => new Promise((r) => { release = r; }));

    setup();
    const button = screen.getByRole('button', { name: /download snapshot/i });
    press(button);
    await waitFor(() => expect(button).toBeDisabled());

    release(delivered('server'));
    await waitFor(() => expect(deliverSnapshot).toHaveBeenCalledTimes(1));
  });

  it('takes the request at the moment of the click when it is given a function', async () => {
    let calls = 0;
    const request = () => ({ ...REQUEST, scenarioPresets: [{ id: `preset-${++calls}` }] });

    setup({ request });
    // Rendering must not have evaluated it — a transient preset built on every
    // render would mint a new id each time.
    expect(calls).toBe(0);

    press(screen.getByRole('button', { name: /download snapshot/i }));
    await waitFor(() => expect(deliverSnapshot).toHaveBeenCalledTimes(1));
    expect(calls).toBe(1);
    expect(deliverSnapshot.mock.calls[0][0].request.scenarioPresets).toEqual([{ id: 'preset-1' }]);
  });
});
