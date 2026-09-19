import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Choosing the template a report format comes out in.
 *
 * ## What was missing
 *
 * The template was decided by `resolve_report_template()`'s ranking and by
 * nothing else. There was no surface anywhere in the product that showed which
 * template a report would use, and the only way to touch a template at all was
 * the Template Builder — an editor, reached by navigating away from whatever
 * you were doing. So these assert the two halves of the fix: a choice can be
 * made and read back without leaving the page, and it stays made.
 */

const invokeSecureFunction = vi.fn();
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: (...args: unknown[]) => invokeSecureFunction(...args),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: TestResizeObserver });

import { ReportTemplateSelector } from '../ReportTemplateSelector';
import { ReportTemplateBindings } from '../ReportTemplateBindings';

const TEMPLATES = [
  {
    id: 'tpl-drawn', name: 'Compass — Dark Executive', description: 'Ten-colourway master.',
    report_type: 'investment_compass', engine: 'weasyprint',
    is_active: true, is_draft: false, is_default: true, scope: 'global',
    priority: 10, updated_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 'tpl-alt', name: 'Compass — Quiet Serif', description: null,
    report_type: 'investment', engine: 'weasyprint',
    is_active: true, is_draft: false, is_default: false, scope: 'global',
    priority: 0, updated_at: '2026-07-01T00:00:00Z',
  },
  {
    id: 'tpl-legacy', name: 'Compass — Legacy layout', description: null,
    report_type: 'investment', engine: 'jspdf',
    is_active: true, is_draft: false, is_default: false, scope: 'global',
    priority: 5, updated_at: '2026-06-01T00:00:00Z',
  },
  {
    id: 'tpl-other', name: 'Portfolio Review', description: null,
    report_type: 'portfolio', engine: 'weasyprint',
    is_active: true, is_draft: false, is_default: false, scope: 'global',
    priority: 0, updated_at: '2026-05-01T00:00:00Z',
  },
];

/** Whatever `selections` holds when the component asks. */
let selections: any[] = [];
/** Every write the component made, in order. */
let writes: any[] = [];

function routeCall(_fn: string, payload: any) {
  if (payload?.table === 'report_templates' && payload.operation === 'list') {
    return Promise.resolve({ data: { records: TEMPLATES }, error: null });
  }
  if (payload?.table === 'report_template_selections') {
    if (payload.operation === 'list') {
      return Promise.resolve({ data: { records: selections }, error: null });
    }
    writes.push(payload);
    if (payload.operation === 'upsert') {
      selections = [{
        id: 'sel-1',
        report_type: payload.data.report_type,
        template_id: payload.data.template_id,
      }];
      return Promise.resolve({ data: { records: selections }, error: null });
    }
    if (payload.operation === 'delete') {
      selections = [];
      return Promise.resolve({ data: { success: true }, error: null });
    }
  }
  return Promise.resolve({ data: null, error: null });
}

function renderSelector() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReportTemplateSelector reportType="investment" formatLabel="Investment report" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  invokeSecureFunction.mockReset();
  navigate.mockReset();
  selections = [];
  writes = [];
  invokeSecureFunction.mockImplementation(routeCall);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

/* ── choosing, before generation ─────────────────────────────────────────── */

describe('choosing a template before generation', () => {
  it('says which template the format uses when nothing has been chosen', async () => {
    renderSelector();
    expect(await screen.findByText(/No template chosen — using the default/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose template' })).toBeTruthy();
  });

  it('offers only the templates for this format, across every spelling', async () => {
    renderSelector();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose template' }));

    // `investment_compass` and `investment` are the same format…
    expect(await screen.findByText('Compass — Dark Executive')).toBeTruthy();
    expect(screen.getByText('Compass — Quiet Serif')).toBeTruthy();
    // …and Portfolio is not.
    expect(screen.queryByText('Portfolio Review')).toBeNull();
  });

  it('marks a template that will not be drawn by the design system', async () => {
    renderSelector();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose template' }));
    await screen.findByText('Compass — Legacy layout');
    expect(screen.getByText(/Renders through the standard generator/)).toBeTruthy();
  });

  it('never sends the user to the Template Builder', async () => {
    renderSelector();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose template' }));
    await screen.findByText('Compass — Dark Executive');
    expect(navigate).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain('template-builder');
  });
});

/* ── locked in ───────────────────────────────────────────────────────────── */

describe('a chosen template stays chosen', () => {
  const choose = async (name: string) => {
    renderSelector();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose template' }));
    const row = (await screen.findByText(name)).closest('label')!;
    fireEvent.click(row.querySelector('button[role="radio"]')!);
    fireEvent.click(screen.getByRole('button', { name: /Save choice/ }));
  };

  it('writes the choice against the normalised format key', async () => {
    await choose('Compass — Quiet Serif');
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      operation: 'upsert',
      table: 'report_template_selections',
      onConflict: 'owner_user_id,report_type',
      data: { report_type: 'investment', template_id: 'tpl-alt' },
    });
    // The owner is never sent — the broker stamps it from the session.
    expect(writes[0].data.owner_user_id).toBeUndefined();
  });

  it('shows the chosen template afterwards, with a way to change it', async () => {
    await choose('Compass — Quiet Serif');
    expect(await screen.findByText('Compass — Quiet Serif')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Change template' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose template' })).toBeNull();
  });

  it('reopens the picker on the current choice rather than a blank slate', async () => {
    selections = [{ id: 'sel-1', report_type: 'investment', template_id: 'tpl-alt' }];
    renderSelector();
    fireEvent.click(await screen.findByRole('button', { name: 'Change template' }));

    // Scoped to the dialog: the chosen template's name is also on the control
    // behind it, which is the point of the control.
    const dialog = within(await screen.findByRole('dialog'));
    const row = (await dialog.findByText('Compass — Quiet Serif')).closest('label')!;
    await waitFor(() =>
      expect(row.querySelector('button[role="radio"]')).toHaveAttribute('aria-checked', 'true'));
    // Nothing to save until they actually change something.
    expect(screen.getByRole('button', { name: /Save choice/ })).toBeDisabled();
  });

  it('hands the format back to the ranking when the choice is cleared', async () => {
    selections = [{ id: 'sel-1', report_type: 'investment', template_id: 'tpl-alt' }];
    renderSelector();
    fireEvent.click(await screen.findByRole('button', { name: 'Change template' }));

    const auto = (await screen.findByText('Choose automatically')).closest('label')!;
    fireEvent.click(auto.querySelector('button[role="radio"]')!);
    fireEvent.click(screen.getByRole('button', { name: /Save choice/ }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      operation: 'delete', table: 'report_template_selections', recordId: 'sel-1',
    });
  });
});

/* ── a choice that stopped applying ──────────────────────────────────────── */

describe('a stale choice', () => {
  it('says so rather than quietly rendering a different template', async () => {
    // The chosen template was deactivated. The document falls back to the
    // ranking either way; doing that silently is the part that is wrong.
    selections = [{ id: 'sel-1', report_type: 'investment', template_id: 'tpl-deleted' }];
    renderSelector();
    expect(await screen.findByText(/no longer available/)).toBeTruthy();
  });

  it('explains it in the picker too, and offers the live candidates', async () => {
    selections = [{ id: 'sel-1', report_type: 'investment', template_id: 'tpl-deleted' }];
    renderSelector();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose template' }));
    expect(await screen.findByText('Your previous choice is no longer available')).toBeTruthy();
    expect(screen.getByText('Compass — Dark Executive')).toBeTruthy();
  });
});

/* ── failure ─────────────────────────────────────────────────────────────── */

describe('when the choice cannot be read', () => {
  it('does not present a read failure as "nothing chosen"', async () => {
    invokeSecureFunction.mockImplementation((_fn: string, payload: any) =>
      payload?.table === 'report_template_selections' && payload.operation === 'list'
        ? Promise.resolve({ data: null, error: { message: 'network' } })
        : routeCall(_fn, payload));

    renderSelector();
    expect(await screen.findByText(/couldn’t check which template is set/)).toBeTruthy();
    expect(screen.queryByText(/No template chosen/)).toBeNull();
  });
});

/* ── every format at once ────────────────────────────────────────────────── */

describe('the per-format list', () => {
  const renderBindings = () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <ReportTemplateBindings />
      </QueryClientProvider>,
    );
  };

  it('lists the formats a template can be tied to, with what each uses', async () => {
    selections = [{ id: 'sel-1', report_type: 'investment', template_id: 'tpl-drawn' }];
    renderBindings();
    expect(await screen.findByText('Investment Report')).toBeTruthy();
    expect(screen.getByText('Compass — Dark Executive')).toBeTruthy();
    // A format nobody has chosen for says how many it is choosing between.
    expect(screen.getAllByText(/Choosing automatically from/).length).toBeGreaterThan(0);
  });

  it('marks a preview-only format instead of leaving it out', async () => {
    renderBindings();
    await screen.findByText('Investment Report');
    expect(screen.getAllByText('Preview only').length).toBeGreaterThan(0);
  });

  it('opens the picker in place, without navigating', async () => {
    renderBindings();
    await screen.findByText('Investment Report');
    fireEvent.click(screen.getAllByRole('button', { name: 'Choose' })[0]);
    expect(await screen.findByText('Choose a template')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });
});
