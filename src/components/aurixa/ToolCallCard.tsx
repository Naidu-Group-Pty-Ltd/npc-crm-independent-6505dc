import * as React from 'react';
import { ChevronDown, Wrench, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * ToolCallCard — Phase 6 primitive.
 *
 * Visualises a single tool invocation from an AI agent. Collapsed by default
 * (per chat-ui-composition rule); expanding reveals input params, output, and
 * optional error. Follows AI Elements Tool composition semantics without
 * hard-depending on that package.
 */

export type ToolCallStatus = 'running' | 'success' | 'error' | 'pending';

export interface ToolCallCardProps {
  name: string;
  /** Optional friendly label rendered next to the tool name. */
  label?: string;
  status: ToolCallStatus;
  /** Optional icon override. Defaults to a wrench. */
  icon?: React.ReactNode;
  /** Structured input parameters. Rendered as JSON when object/array. */
  input?: unknown;
  /** Tool result. Rendered as pre-JSON unless `renderOutput` is supplied. */
  output?: unknown;
  /** Optional custom output renderer (e.g. domain-specific card). */
  renderOutput?: (output: unknown) => React.ReactNode;
  /** Populated when `status === 'error'`. */
  errorMessage?: string;
  /** Force default-open. Defaults to false (spec). */
  defaultOpen?: boolean;
  className?: string;
}

const statusTone: Record<ToolCallStatus, { ring: string; text: string; label: string }> = {
  running: {
    ring: 'ring-primary/40 bg-primary/10 text-primary',
    text: 'text-primary',
    label: 'Running',
  },
  success: {
    ring: 'ring-success/40 bg-success/10 text-success',
    text: 'text-success',
    label: 'Complete',
  },
  error: {
    ring: 'ring-destructive/40 bg-destructive/10 text-destructive',
    text: 'text-destructive',
    label: 'Error',
  },
  pending: {
    ring: 'ring-[color:var(--glass-hairline)] bg-muted text-muted-foreground',
    text: 'text-muted-foreground',
    label: 'Queued',
  },
};

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ToolCallCard({
  name,
  label,
  status,
  icon,
  input,
  output,
  renderOutput,
  errorMessage,
  defaultOpen = false,
  className,
}: ToolCallCardProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const tone = statusTone[status];

  const StatusIcon = status === 'running'
    ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
    : status === 'success'
      ? <CheckCircle2 className="h-3.5 w-3.5" />
      : status === 'error'
        ? <XCircle className="h-3.5 w-3.5" />
        : <span className="h-1.5 w-1.5 rounded-full bg-current" />;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--glass-hairline)] [background:var(--glass-tint)]',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
          'hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1',
            tone.ring,
          )}
          aria-hidden="true"
        >
          {icon ?? <Wrench className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{label ?? name}</span>
            {label && (
              <span className="truncate text-[11px] font-mono text-muted-foreground">
                {name}
              </span>
            )}
          </span>
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
            tone.text,
          )}
        >
          {StatusIcon}
          <span>{tone.label}</span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-fast)]',
            open && 'rotate-180',
            'motion-reduce:transition-none',
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="border-t border-[color:var(--glass-hairline)] px-3 py-2.5">
          {input !== undefined && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Input
              </div>
              <pre className="max-h-48 overflow-auto rounded-md bg-background/60 p-2 text-[11px] leading-relaxed text-foreground/90">
                {formatValue(input)}
              </pre>
            </div>
          )}
          {status === 'error' && errorMessage && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-destructive">
                Error
              </div>
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                {errorMessage}
              </div>
            </div>
          )}
          {output !== undefined && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Output
              </div>
              {renderOutput ? (
                renderOutput(output)
              ) : (
                <pre className="max-h-64 overflow-auto rounded-md bg-background/60 p-2 text-[11px] leading-relaxed text-foreground/90">
                  {formatValue(output)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolCallCard;
