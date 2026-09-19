/**
 * Draft / Live / Paused, as a control rather than a label.
 *
 * `workflows.status` has existed since the table was created and the library
 * card has always rendered it — but nothing could change it, so every workflow
 * read "Draft" forever and the badge was decoration.
 *
 * Going live is the one transition with a consequence, so it is the one that
 * explains itself: it is refused outright while the readiness checks are
 * failing, because a workflow that cannot complete a test run has no business
 * being armed.
 */

import { Check, ChevronDown, CircleDot, Loader2, Pause, Radio } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { WorkflowRecord } from '@/lib/workflow/types';

type Status = WorkflowRecord['status'];

interface WorkflowStatusControlProps {
  status: Status;
  disabled?: boolean;
  saving?: boolean;
  /** False while a blocking readiness issue stands; going live is refused. */
  runnable: boolean;
  onChange: (next: Status) => void;
}

const PRESENTATION: Record<Status, { label: string; className: string; icon: typeof Radio; blurb: string }> = {
  draft: {
    label: 'Draft',
    className: 'border-border bg-muted text-muted-foreground',
    icon: CircleDot,
    blurb: 'Only runs when you press Test run.',
  },
  live: {
    label: 'Live',
    className: 'border-success/40 bg-success/10 text-success',
    icon: Radio,
    // This used to say triggers were not dispatched, because they were not:
    // events were captured and nothing drained them. `dispatch-workflow-triggers`
    // now does, once a minute, so the status finally means what it says — and
    // the blurb names the cadence, because "live" without a number invites
    // people to stand and watch for something that is up to a minute away.
    blurb: 'Its trigger starts it. Captured events are dispatched about once a minute; Test run and Run live still work.',
  },
  paused: {
    label: 'Paused',
    className: 'border-warning/50 bg-warning/15 text-foreground',
    icon: Pause,
    blurb: 'Held back. Marks the workflow as deliberately not in use.',
  },
};

const ORDER: Status[] = ['draft', 'live', 'paused'];

export function WorkflowStatusControl({
  status,
  disabled = false,
  saving = false,
  runnable,
  onChange,
}: WorkflowStatusControlProps) {
  const current = PRESENTATION[status];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              aria-label={`Status: ${current.label}. Change it.`}
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                current.className,
                disabled ? 'cursor-not-allowed opacity-70' : 'hover:brightness-105',
              )}
            >
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <CurrentIcon className="h-3 w-3" aria-hidden="true" />
              )}
              {current.label}
              {!disabled && <ChevronDown className="h-3 w-3 opacity-70" aria-hidden="true" />}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[15rem]">
          {current.blurb}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workflow status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ORDER.map((option) => {
          const presentation = PRESENTATION[option];
          const Icon = presentation.icon;
          // Nothing stops you standing down; only arming has a precondition.
          const blocked = option === 'live' && !runnable;
          return (
            <DropdownMenuItem
              key={option}
              disabled={blocked || option === status}
              onSelect={() => onChange(option)}
              className="items-start gap-2"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">
                {presentation.label}
                <span className="block text-xs text-muted-foreground">
                  {blocked ? 'Fix the blocking checks before going live.' : presentation.blurb}
                </span>
              </span>
              {option === status && <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
