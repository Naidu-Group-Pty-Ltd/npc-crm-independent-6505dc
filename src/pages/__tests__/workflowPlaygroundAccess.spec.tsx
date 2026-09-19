/**
 * The canvas has to be usable at every width.
 *
 * The step library and the settings panel are docked columns at `lg` and `xl`.
 * They are not decoration: the library is the only way to add the first step,
 * and the inspector is the only way to configure any step. Below those widths
 * both columns were simply absent, which left a canvas you could pan and zoom
 * and nothing else — the reported "I can't build anything on it".
 *
 * jsdom's `matchMedia` reports no match for every query, so these render in
 * exactly the narrow case that used to be unusable. The assertions are about
 * reachability, not layout: can a person get to the library, and to the
 * settings for a step, without a docked column.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useWorkflowStore } from '@/lib/workflow/store';
import { EMPTY_GRAPH, type WorkflowRecord } from '@/lib/workflow/types';

const workflow: WorkflowRecord = {
  id: 'wf-1',
  name: 'Screen every new client',
  description: null,
  graph: EMPTY_GRAPH,
  status: 'draft',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

vi.mock('@/hooks/useModulePermissions', () => ({
  useModulePermissions: () => ({ canView: true, canEdit: true, canDelete: true, loading: false }),
}));

vi.mock('@/hooks/useWorkflows', () => ({
  useWorkflows: () => ({
    workflows: [workflow],
    loading: false,
    error: null,
    refresh: vi.fn(),
    create: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    remove: vi.fn(),
  }),
}));

vi.mock('@/hooks/useIntegrationCredentials', () => ({
  useIntegrationCredentials: () => ({
    configured: new Set<string>(),
    savedKeys: new Set<string>(),
    loaded: true,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/useWorkflowRuns', () => ({
  useWorkflowRuns: () => ({
    result: null,
    running: false,
    history: [],
    historyLoading: false,
    persistenceWarning: null,
    start: vi.fn(),
    clear: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTriggerEvents', () => ({
  useTriggerEvents: () => ({ events: [], loading: false, totalCaptured: 0 }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

// The canvas measures itself; jsdom ships neither observer.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopObserver);

import WorkflowPlayground from '../WorkflowPlayground';

/** Opens the saved workflow, which is what swaps the library view for the canvas. */
function openCanvas() {
  render(
    <TooltipProvider>
      <WorkflowPlayground />
    </TooltipProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: workflow.name }));
}

beforeEach(() => {
  useWorkflowStore.getState().loadGraph(EMPTY_GRAPH);
});

describe('Workflow Playground on a viewport too narrow to dock the panels', () => {
  it('offers the step library from the header', async () => {
    openCanvas();

    fireEvent.click(screen.getByRole('button', { name: /add step/i }));

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByLabelText('Search the step library')).toBeInTheDocument();
  });

  /**
   * Browsing is app-first, so adding a step is two moves: choose the app, then
   * the operation. The assertion covers both because the drill-in is the part
   * that a narrow viewport has to keep working — an app row that opens nothing
   * is as unusable as no library at all.
   */
  it('adds a step from that library and closes it again', async () => {
    openCanvas();
    fireEvent.click(screen.getByRole('button', { name: /add step/i }));

    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: /^Triggers\./ }));
    fireEvent.click(await within(sheet).findByRole('button', { name: /^Add Client added/ }));

    expect(useWorkflowStore.getState().graph.nodes).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('finds a step by app name without drilling in', async () => {
    openCanvas();
    fireEvent.click(screen.getByRole('button', { name: /add step/i }));

    const sheet = await screen.findByRole('dialog');
    fireEvent.change(within(sheet).getByLabelText('Search the step library'), {
      target: { value: 'airtable' },
    });

    expect(await within(sheet).findByRole('button', { name: /^Add Create a record/ })).toBeInTheDocument();
  });

  it('reaches the settings for a step from the header', async () => {
    openCanvas();
    let id = '';
    act(() => {
      id = useWorkflowStore.getState().addNode('core.webhook', { x: 0, y: 0 });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Step settings and checks' }));

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('complementary', { name: /step settings/i })).toBeInTheDocument();
    expect(useWorkflowStore.getState().selectedNodeId).toBe(id);
  });

  it('opens the settings when a placed step is chosen with the keyboard', async () => {
    openCanvas();
    act(() => {
      useWorkflowStore.getState().addNode('core.webhook', { x: 0, y: 0 });
    });

    const card = screen.getByRole('button', { name: /^Incoming webhook\./ });
    fireEvent.keyDown(card, { key: 'Enter' });

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('complementary', { name: /step settings/i })).toBeInTheDocument();
  });

  it('tells an empty canvas where to start', () => {
    openCanvas();

    expect(screen.getByText(/nothing on the canvas yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /browse the step library/i })).toBeInTheDocument();
  });
});
