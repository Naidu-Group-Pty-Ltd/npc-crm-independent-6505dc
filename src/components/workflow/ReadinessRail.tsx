/**
 * Pre-flight for the workflow.
 *
 * This is the thing the canvas is for. A workflow built on 141 integrations
 * fails for boring reasons — a key was never saved, a required field is blank,
 * a branch leads nowhere — and every one of those is knowable before the run.
 * Each item names the step and jumps to it, so the fix is one click away.
 */

import { AlertTriangle, CheckCircle2, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ReadinessIssue } from '@/lib/workflow/types';

interface ReadinessRailProps {
  issues: ReadinessIssue[];
  credentialsLoading: boolean;
  nodeCount: number;
  onFocusNode: (nodeId: string) => void;
}

export function ReadinessRail({ issues, credentialsLoading, nodeCount, onFocusNode }: ReadinessRailProps) {
  const blocking = issues.filter((i) => i.severity === 'blocking');
  const warnings = issues.filter((i) => i.severity === 'warning');

  if (credentialsLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Checking credentials…
      </div>
    );
  }

  if (nodeCount === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        Add a trigger to get started.
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
        <span className="font-medium text-foreground">Ready to run.</span>
        <span className="text-muted-foreground">Every step is configured and connected.</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        {blocking.length > 0 ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        )}
        <p className="text-xs font-medium text-foreground">
          {blocking.length > 0
            ? `${blocking.length} ${blocking.length === 1 ? 'thing' : 'things'} to fix before this can run`
            : 'Ready to run, with suggestions'}
        </p>
        {warnings.length > 0 && blocking.length > 0 && (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
            +{warnings.length} {warnings.length === 1 ? 'suggestion' : 'suggestions'}
          </span>
        )}
      </div>

      <ScrollArea className="wf-scroll flex-1">
        <ul className="divide-y divide-border/50">
          {[...blocking, ...warnings].map((issue, index) => (
            <li key={`${issue.code}-${issue.nodeId ?? index}`}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-2 rounded-none px-3 py-2 text-left font-normal"
                disabled={!issue.nodeId}
                onClick={() => issue.nodeId && onFocusNode(issue.nodeId)}
              >
                <span
                  className={cn(
                    'mt-0.5 shrink-0',
                    issue.severity === 'blocking' ? 'text-destructive' : 'text-warning',
                  )}
                  aria-hidden="true"
                >
                  {issue.code === 'missing-credential' ? (
                    <KeyRound className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block whitespace-normal text-xs leading-snug text-foreground">
                    {issue.message}
                  </span>
                  <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
                    {issue.severity === 'blocking' ? 'Blocks the run' : 'Worth checking'}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
