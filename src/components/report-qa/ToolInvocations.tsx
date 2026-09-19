/**
 * ToolInvocations
 *
 * Transparency UI for agent tool calls. Renders a row of compact chips
 * (one per invocation) showing the tool name, status, and duration; each
 * chip expands a Collapsible with the raw inputs and outputs.
 *
 * Phase 2.1: scaffolded with the final shape so 2.2 (calculator tools)
 * and 2.3 (live-data tools) plug in without further UI work.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Wrench,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToolInvocation {
  id: string;
  name: string;
  arguments: unknown;
  result?: unknown;
  error?: string;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  phase?: 'started' | 'completed';
}

interface ToolInvocationsProps {
  invocations: ToolInvocation[];
}

function formatDuration(ms?: number): string {
  if (!ms && ms !== 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function prettyJson(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function humanizeToolName(name: string): string {
  return name
    .replace(/^calculate_/, '')
    .replace(/^lookup_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ToolInvocations({ invocations }: ToolInvocationsProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (!invocations?.length) return null;

  return (
    <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Wrench className="h-3 w-3" />
        <span>
          Tools used ({invocations.length})
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {invocations.map((inv) => {
          const isOpen = openId === inv.id;
          const isRunning = inv.phase === 'started' && !inv.completed_at;
          const hasError = !!inv.error;

          return (
            <Collapsible
              key={inv.id}
              open={isOpen}
              onOpenChange={(o) => setOpenId(o ? inv.id : null)}
              className="w-full"
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-7 px-2 gap-1.5 text-xs font-normal',
                    hasError &&
                      'border-destructive/40 text-destructive hover:bg-destructive/5',
                    !hasError &&
                      !isRunning &&
                      'border-primary/30 hover:bg-primary/5',
                  )}
                >
                  {isRunning ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : hasError ? (
                    <AlertTriangle className="h-3 w-3" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 text-success" />
                  )}
                  <span>{humanizeToolName(inv.name)}</span>
                  {!isRunning && inv.duration_ms !== undefined && (
                    <Badge
                      variant="secondary"
                      className="h-4 px-1 text-[10px] font-normal ml-0.5"
                    >
                      {formatDuration(inv.duration_ms)}
                    </Badge>
                  )}
                  <ChevronDown
                    className={cn(
                      'h-3 w-3 opacity-50 transition-transform',
                      isOpen && 'rotate-180',
                    )}
                  />
                </Button>
              </CollapsibleTrigger>

              <CollapsibleContent className="mt-1.5">
                <div className="rounded-md border border-border/50 bg-muted/30 p-2 space-y-2 text-xs">
                  <div>
                    <div className="font-medium text-muted-foreground mb-1">
                      Input
                    </div>
                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/80 max-h-40 overflow-y-auto">
                      {prettyJson(inv.arguments)}
                    </pre>
                  </div>
                  <div>
                    <div
                      className={cn(
                        'font-medium mb-1',
                        hasError ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {hasError ? 'Error' : 'Output'}
                    </div>
                    <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/80 max-h-60 overflow-y-auto">
                      {hasError ? inv.error : prettyJson(inv.result)}
                    </pre>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
