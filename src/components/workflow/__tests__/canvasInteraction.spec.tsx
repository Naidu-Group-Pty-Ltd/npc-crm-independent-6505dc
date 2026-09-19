/**
 * Behavioural cover for the canvas surface.
 *
 * These drive the real store and the real components rather than asserting on
 * props, because the things worth protecting here are interactions: that a
 * dropped step lands, that a connection cannot close a loop, that undo steps
 * back a whole drag, and that an unconfigured integration is visibly marked.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useWorkflowStore } from '@/lib/workflow/store';
import { EMPTY_GRAPH } from '@/lib/workflow/types';
import { NodePalette } from '../NodePalette';
import { ReadinessRail } from '../ReadinessRail';
import { WorkflowNodeCard } from '../WorkflowNodeCard';

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

beforeEach(() => {
  useWorkflowStore.getState().loadGraph(EMPTY_GRAPH);
});

describe('workflow store', () => {
  it('adds a step with its catalog defaults', () => {
    const id = useWorkflowStore.getState().addNode('core.schedule', { x: 0, y: 0 });
    const node = useWorkflowStore.getState().graph.nodes.find((n) => n.id === id);
    expect(node?.config).toMatchObject({ preset: 'daily' });
    expect(useWorkflowStore.getState().selectedNodeId).toBe(id);
  });

  it('connects two steps', () => {
    const store = useWorkflowStore.getState();
    const a = store.addNode('core.manual', { x: 0, y: 0 });
    const b = store.addNode('core.set', { x: 400, y: 0 });

    useWorkflowStore.getState().beginConnection(a, { x: 0, y: 0 });
    useWorkflowStore.getState().completeConnection(b);

    expect(useWorkflowStore.getState().graph.edges).toHaveLength(1);
    expect(useWorkflowStore.getState().graph.edges[0]).toMatchObject({ source: a, target: b });
  });

  it('refuses a connection that would close a loop', () => {
    const store = useWorkflowStore.getState();
    const a = store.addNode('core.manual', { x: 0, y: 0 });
    const b = store.addNode('core.set', { x: 400, y: 0 });

    useWorkflowStore.getState().beginConnection(a, { x: 0, y: 0 });
    useWorkflowStore.getState().completeConnection(b);
    useWorkflowStore.getState().beginConnection(b, { x: 0, y: 0 });
    useWorkflowStore.getState().completeConnection(a);

    expect(useWorkflowStore.getState().graph.edges).toHaveLength(1);
  });

  it('refuses a duplicate connection', () => {
    const store = useWorkflowStore.getState();
    const a = store.addNode('core.manual', { x: 0, y: 0 });
    const b = store.addNode('core.set', { x: 400, y: 0 });

    for (let i = 0; i < 2; i += 1) {
      useWorkflowStore.getState().beginConnection(a, { x: 0, y: 0 });
      useWorkflowStore.getState().completeConnection(b);
    }
    expect(useWorkflowStore.getState().graph.edges).toHaveLength(1);
  });

  it('drops the edges of a deleted step', () => {
    const store = useWorkflowStore.getState();
    const a = store.addNode('core.manual', { x: 0, y: 0 });
    const b = store.addNode('core.set', { x: 400, y: 0 });
    useWorkflowStore.getState().beginConnection(a, { x: 0, y: 0 });
    useWorkflowStore.getState().completeConnection(b);

    useWorkflowStore.getState().removeNode(b);
    expect(useWorkflowStore.getState().graph.edges).toHaveLength(0);
    expect(useWorkflowStore.getState().graph.nodes).toHaveLength(1);
  });

  it('coalesces a drag into one undo step', () => {
    const id = useWorkflowStore.getState().addNode('core.manual', { x: 0, y: 0 });
    const historyBefore = useWorkflowStore.getState().past.length;

    // Live drag frames — these must not each become an undo entry.
    for (const x of [10, 20, 30, 40]) {
      useWorkflowStore.getState().moveNode(id, { x, y: 0 });
    }
    useWorkflowStore.getState().moveNode(id, { x: 40, y: 0 }, { commit: true });

    expect(useWorkflowStore.getState().past.length).toBe(historyBefore + 1);

    useWorkflowStore.getState().undo();
    const node = useWorkflowStore.getState().graph.nodes.find((n) => n.id === id);
    expect(node?.position.x).toBe(40);
  });

  it('redoes what it undid', () => {
    useWorkflowStore.getState().addNode('core.manual', { x: 0, y: 0 });
    expect(useWorkflowStore.getState().graph.nodes).toHaveLength(1);

    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().graph.nodes).toHaveLength(0);

    useWorkflowStore.getState().redo();
    expect(useWorkflowStore.getState().graph.nodes).toHaveLength(1);
  });

  it('marks the canvas dirty on a change and clean after saving', () => {
    expect(useWorkflowStore.getState().dirty).toBe(false);
    useWorkflowStore.getState().addNode('core.manual', { x: 0, y: 0 });
    expect(useWorkflowStore.getState().dirty).toBe(true);
    useWorkflowStore.getState().markSaved();
    expect(useWorkflowStore.getState().dirty).toBe(false);
  });
});

describe('node card', () => {
  const baseProps = {
    selected: false,
    dragging: false,
    flagged: false,
    onPointerDownCard: vi.fn(),
    onStartConnection: vi.fn(),
    onFinishConnection: vi.fn(),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onToggleDisabled: vi.fn(),
  };

  const node = (type: string) => ({ id: 'step_1', type, position: { x: 0, y: 0 }, config: {} });

  /**
   * The mark is a corner icon rather than a text chip, so the assertion is on
   * its accessible name — which is also the only thing a screen reader gets,
   * and therefore the part worth protecting.
   */
  it('marks a step whose integration has no credentials', () => {
    wrap(<WorkflowNodeCard {...baseProps} node={node('resend.send_email')} configured={false} />);
    expect(screen.getByLabelText('Needs credentials')).toBeInTheDocument();
  });

  it('does not mark a step whose credentials are in place', () => {
    wrap(<WorkflowNodeCard {...baseProps} node={node('resend.send_email')} configured />);
    expect(screen.queryByLabelText('Needs credentials')).not.toBeInTheDocument();
  });

  it('names the app the step belongs to, so the canvas reads without opening it', () => {
    wrap(<WorkflowNodeCard {...baseProps} node={node('resend.send_email')} configured />);
    expect(screen.getByText('Resend')).toBeInTheDocument();
  });

  it('gives a trigger no incoming port', () => {
    const { container } = wrap(
      <WorkflowNodeCard {...baseProps} node={node('core.schedule')} configured />,
    );
    expect(container.querySelector('[data-port="target"]')).toBeNull();
    expect(container.querySelector('[data-port="source"]')).not.toBeNull();
  });

  it('gives a branching step one labelled port per path', () => {
    const { container } = wrap(<WorkflowNodeCard {...baseProps} node={node('core.branch')} configured />);
    expect(container.querySelectorAll('[data-port="source"]')).toHaveLength(2);
    expect(screen.getByText('Matches')).toBeInTheDocument();
    expect(screen.getByText('Otherwise')).toBeInTheDocument();
  });

  it('explains a step whose catalog entry has gone', () => {
    wrap(<WorkflowNodeCard {...baseProps} node={node('ghost.vanished')} configured />);
    expect(screen.getByText('Unknown step')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete step' })).toBeInTheDocument();
  });

  it('deletes on the Delete key', async () => {
    const onDelete = vi.fn();
    wrap(<WorkflowNodeCard {...baseProps} onDelete={onDelete} node={node('core.set')} configured />);
    // Anchored so it matches the card, not its "Connect Set values…" port button.
    fireEvent.keyDown(screen.getByRole('button', { name: /^Set values\./ }), { key: 'Delete' });
    expect(onDelete).toHaveBeenCalledWith('step_1');
  });
});

describe('step library', () => {
  const props = {
    configuredIntegrations: new Set<string>(),
    credentialsLoaded: true,
    onAddNode: vi.fn(),
    hasTrigger: false,
  };

  it('leads with triggers before one has been chosen', () => {
    wrap(<NodePalette {...props} />);
    expect(screen.getByText(/Start with a trigger/)).toBeInTheDocument();
  });

  it('finds a step by its app name', async () => {
    wrap(<NodePalette {...props} hasTrigger />);
    fireEvent.change(screen.getByLabelText('Search the step library'), { target: { value: 'stripe' } });
    expect(await screen.findByText('Create and send an invoice')).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    wrap(<NodePalette {...props} hasTrigger />);
    fireEvent.change(screen.getByLabelText('Search the step library'), { target: { value: 'zzzznope' } });
    expect(await screen.findByText(/No steps match/)).toBeInTheDocument();
  });

  it('adds the step when a row is clicked', async () => {
    const onAddNode = vi.fn();
    wrap(<NodePalette {...props} hasTrigger onAddNode={onAddNode} />);
    fireEvent.change(screen.getByLabelText('Search the step library'), { target: { value: 'compose text' } });
    fireEvent.click(await screen.findByRole('button', { name: /Add Compose text/ }));
    expect(onAddNode).toHaveBeenCalledWith('core.template');
  });
});

describe('readiness rail', () => {
  it('confirms a workflow that is ready', () => {
    wrap(<ReadinessRail issues={[]} credentialsLoading={false} nodeCount={2} onFocusNode={vi.fn()} />);
    expect(screen.getByText('Ready to run.')).toBeInTheDocument();
  });

  it('invites a first step on an empty canvas', () => {
    wrap(<ReadinessRail issues={[]} credentialsLoading={false} nodeCount={0} onFocusNode={vi.fn()} />);
    expect(screen.getByText('Add a trigger to get started.')).toBeInTheDocument();
  });

  it('counts what blocks the run and jumps to the step', async () => {
    const onFocusNode = vi.fn();
    wrap(
      <ReadinessRail
        credentialsLoading={false}
        nodeCount={2}
        onFocusNode={onFocusNode}
        issues={[
          {
            severity: 'blocking',
            code: 'missing-credential',
            nodeId: 'step_2',
            message: '“Send an email” needs credentials. Add them on the Integrations page.',
          },
          {
            severity: 'warning',
            code: 'orphan-node',
            nodeId: 'step_3',
            message: '“Set values” is not connected to anything, so it will never run.',
          },
        ]}
      />,
    );

    expect(screen.getByText('1 thing to fix before this can run')).toBeInTheDocument();
    expect(screen.getByText('+1 suggestion')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/needs credentials/));
    expect(onFocusNode).toHaveBeenCalledWith('step_2');
  });

  it('separates what blocks from what is only worth checking', () => {
    wrap(
      <ReadinessRail
        credentialsLoading={false}
        nodeCount={1}
        onFocusNode={vi.fn()}
        issues={[
          { severity: 'blocking', code: 'no-trigger', message: 'Add a trigger so the workflow knows when to run.' },
        ]}
      />,
    );
    const item = screen.getByText(/Add a trigger so the workflow/).closest('button') as HTMLElement;
    expect(within(item).getByText('Blocks the run')).toBeInTheDocument();
  });

  it('waits for the credential check instead of guessing', () => {
    wrap(<ReadinessRail issues={[]} credentialsLoading nodeCount={2} onFocusNode={vi.fn()} />);
    expect(screen.getByText('Checking credentials…')).toBeInTheDocument();
  });
});
