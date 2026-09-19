/**
 * One step on the canvas.
 *
 * Inline styles here are geometry only (`transform`) — every colour comes from
 * the accent custom property set by the category class, so the node re-themes
 * with the dashboard and the style ratchet stays clean.
 */

import { memo, useCallback, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  FlaskConical,
  KeyRound,
  MoreVertical,
  OctagonMinus,
  PowerOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getCatalogNode } from '@/lib/workflow/catalog';
import { getIntegrationName } from '@/lib/workflow/integrationNames';
import type { WorkflowNode } from '@/lib/workflow/types';
import { NODE_HEIGHT, NODE_WIDTH } from './canvasGeometry';
import { CATEGORY_LABELS, accentClass } from './nodeAccents';
import { NodeGlyph } from './nodeVisuals';

export interface WorkflowNodeCardProps {
  node: WorkflowNode;
  selected: boolean;
  /** The primary of a multi-step selection — the one the inspector edits. */
  primary?: boolean;
  dragging: boolean;
  /** Off the currently traced path, so it recedes rather than competing. */
  dimmed?: boolean;
  flagged: boolean;
  /** This step's outcome in the last run, when there has been one. */
  runStatus?: string;
  /** False when the node's integration has no saved credential. */
  configured: boolean;
  onPointerDownCard: (event: PointerEvent<HTMLDivElement>, nodeId: string) => void;
  onStartConnection: (event: PointerEvent<HTMLElement>, nodeId: string, branch?: string) => void;
  onFinishConnection: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onToggleDisabled: (nodeId: string) => void;
  onHoverChange?: (hovering: boolean) => void;
}

/**
 * The last run's verdict, shown on the step itself.
 *
 * Reading a run in a side panel means holding the graph in your head; putting
 * the outcome on the node means the canvas answers "where did it go wrong"
 * without being read at all.
 */
const RUN_STATUS_CHIPS: Record<
  string,
  { label: string; icon: typeof CheckCircle2; className: string; iconClassName: string }
> = {
  succeeded: {
    label: 'Succeeded',
    icon: CheckCircle2,
    className: 'border-success/50 bg-success/15 text-foreground',
    iconClassName: 'text-success',
  },
  failed: {
    label: 'Failed',
    icon: AlertTriangle,
    className: 'border-destructive/50 bg-destructive/15 text-foreground',
    iconClassName: 'text-destructive',
  },
  simulated: {
    label: 'Simulated',
    icon: FlaskConical,
    className: 'border-primary/50 bg-primary/10 text-foreground',
    iconClassName: 'text-primary',
  },
  halted: {
    label: 'Stopped here',
    icon: OctagonMinus,
    className: 'border-warning/50 bg-warning/15 text-foreground',
    iconClassName: 'text-warning',
  },
  skipped: {
    label: 'Not reached',
    icon: CircleSlash,
    className: 'border-border bg-muted text-muted-foreground',
    iconClassName: 'text-muted-foreground',
  },
};

function RunStatusMark({ status }: { status: string }) {
  const chip = RUN_STATUS_CHIPS[status];
  if (!chip) return null;
  const Icon = chip.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('wf-node-mark', chip.className)} aria-label={`Last run: ${chip.label}`}>
          <Icon className={cn('h-3 w-3', chip.iconClassName)} aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">Last run: {chip.label}</TooltipContent>
    </Tooltip>
  );
}

function WorkflowNodeCardImpl({
  node,
  selected,
  primary = false,
  dragging,
  dimmed = false,
  flagged,
  runStatus,
  configured,
  onPointerDownCard,
  onStartConnection,
  onFinishConnection,
  onSelect,
  onDelete,
  onDuplicate,
  onToggleDisabled,
  onHoverChange,
}: WorkflowNodeCardProps) {
  const definition = getCatalogNode(node.type);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(node.id);
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        onDelete(node.id);
      }
    },
    [node.id, onDelete, onSelect],
  );

  // Geometry only — no colour, so this does not trip the inline-style rule.
  const position: CSSProperties = {
    transform: `translate3d(${node.position.x}px, ${node.position.y}px, 0)`,
    width: NODE_WIDTH,
    minHeight: NODE_HEIGHT,
  };

  if (!definition) {
    return (
      <div className="wf-node wf-accent-logic" style={position} data-unknown="true">
        <div className="p-3">
          <p className="text-sm font-medium text-destructive">Unknown step</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This workflow references <span className="wf-token">{node.type}</span>, which is no longer in the
            library. Delete the step or restore the integration.
          </p>
          <button
            type="button"
            onClick={() => onDelete(node.id)}
            className="mt-2 text-xs font-medium text-destructive underline underline-offset-2"
          >
            Delete step
          </button>
        </div>
      </div>
    );
  }

  const title = node.label?.trim() || definition.name;
  const isTrigger = definition.kind === 'trigger';
  const needsCredential = Boolean(definition.integrationId) && !configured;
  const subtitle = definition.integrationId ? getIntegrationName(definition.integrationId) : CATEGORY_LABELS[definition.category];

  return (
    <div
      className={cn('wf-node group', accentClass(definition.category))}
      style={position}
      data-selected={selected}
      data-primary={primary}
      data-dimmed={dimmed}
      data-dragging={dragging}
      data-flagged={flagged}
      data-run-status={runStatus}
      data-disabled={node.disabled ?? false}
      data-unconfigured={needsCredential}
      data-kind={definition.kind}
      data-node-id={node.id}
      role="button"
      tabIndex={0}
      aria-label={`${title}. ${definition.summary}`}
      aria-pressed={selected}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => onPointerDownCard(event, node.id)}
      onPointerUp={() => onFinishConnection(node.id)}
      onPointerEnter={() => onHoverChange?.(true)}
      onPointerLeave={() => onHoverChange?.(false)}
    >
      {/* Two lines and an icon, and nothing else.
          The card used to carry the step's full summary, which made every node
          76px tall and turned a ten-step workflow into a wall of prose you had
          to read to see the shape of. The summary is one click away in the
          inspector; what the canvas has to answer at a glance is "which step,
          from which app" — so that is all it says. */}
      <div className="wf-node-body wf-node-enter flex items-center gap-2.5 px-3 py-2.5">
        <span className="wf-node-icon shrink-0">
          <NodeGlyph node={definition} size={19} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight text-foreground">{title}</p>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      {/* Corner marks. Absolutely positioned so a step that fails, or lacks a
          credential, is the same size as one that does not — a card that grows
          when something goes wrong reflows the whole canvas at the moment you
          least want it moving. */}
      <div className="wf-node-marks">
        {runStatus && <RunStatusMark status={runStatus} />}
        {needsCredential && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="wf-node-mark wf-node-mark-warning" aria-label="Needs credentials">
                <KeyRound className="h-3 w-3" aria-hidden="true" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[15rem]">
              Add this integration’s key on the Integrations page before the workflow can run.
            </TooltipContent>
          </Tooltip>
        )}
        {node.disabled && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="wf-node-mark" aria-label="Skipped">
                <PowerOff className="h-3 w-3" aria-hidden="true" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">This step is skipped when the workflow runs.</TooltipContent>
          </Tooltip>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${title}`}
            className="wf-node-menu opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => onDuplicate(node.id)}>Duplicate</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onToggleDisabled(node.id)}>
            {node.disabled ? 'Enable step' : 'Skip this step'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onDelete(node.id)} className="text-destructive">
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Incoming port — triggers start a run, so they accept nothing. */}
      {!isTrigger && (
        <span
          className="wf-port wf-port-target absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2"
          aria-hidden="true"
          data-port="target"
        />
      )}

      {/* Outgoing ports. Branch nodes expose one per path, labelled. */}
      {definition.branches?.length ? (
        // Labels hang outside the right edge; inside, they collide with the
        // step's own text.
        <div className="absolute right-0 top-0 flex h-full translate-x-1/2 flex-col justify-center gap-3">
          {definition.branches.map((branch) => (
            <span key={branch.id} className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={`Connect the ${branch.label.toLowerCase()} path of ${title}`}
                className="wf-port shrink-0"
                data-port="source"
                data-branch={branch.id}
                onPointerDown={(event) => onStartConnection(event, node.id, branch.id)}
              />
              <span className="wf-branch-label">{branch.label}</span>
            </span>
          ))}
        </div>
      ) : (
        <button
          type="button"
          aria-label={`Connect ${title} to another step`}
          className="wf-port absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2"
          data-port="source"
          onPointerDown={(event) => onStartConnection(event, node.id)}
        />
      )}
    </div>
  );
}

export const WorkflowNodeCard = memo(WorkflowNodeCardImpl);
