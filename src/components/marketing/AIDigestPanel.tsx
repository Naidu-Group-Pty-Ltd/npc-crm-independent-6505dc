import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { AgentMessageRenderer } from '@/components/agent/AgentMessageRenderer';
import { cn } from '@/lib/utils';

interface AIDigestPanelProps {
  digest: string;
  loading?: boolean;
  error?: string;
  onRegenerate?: () => void;
  regenerating?: boolean;
}

export function AIDigestPanel({ digest, loading, error, onRegenerate, regenerating }: AIDigestPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (loading) {
    return (
      <Card className="overflow-hidden border-primary/25 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.78))] shadow-xl shadow-sm dark:shadow-black/5 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </span>
            <span className="truncate">AI Performance Digest</span>
            <Badge variant="secondary" className="shrink-0 animate-pulse border-primary/20 bg-primary/10 text-[10px] text-primary">Generating...</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 rounded-2xl border border-border/50 bg-background/45 p-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-primary/25 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.78))] shadow-xl shadow-sm dark:shadow-black/5 dark:shadow-black/25">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <CardTitle className="flex min-w-0 items-center gap-2 text-base">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </span>
              <span className="truncate">AI Performance Digest</span>
              <Badge variant="secondary" className="hidden shrink-0 border-primary/20 bg-primary/10 text-[10px] text-primary sm:inline-flex">Gemini 3 Flash</Badge>
            </CardTitle>
            <div className="ml-2 flex shrink-0 items-center gap-1">
              {onRegenerate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRegenerate}
                  disabled={regenerating}
                  className="h-8 rounded-xl px-2 text-xs font-semibold text-muted-foreground hover:bg-primary/10 hover:text-primary"
                >
                  {regenerating ? (
                    <Loader2 className="h-3 w-3 animate-spin sm:mr-1" />
                  ) : (
                    <RefreshCw className="h-3 w-3 sm:mr-1" />
                  )}
                  <span className="hidden sm:inline">Regenerate</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(!expanded)}
                className="h-8 w-8 rounded-xl p-0 text-muted-foreground hover:bg-primary/10 hover:text-primary"
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent>
          {error ? (
            <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-5 text-center">
              <p className="break-words text-sm text-destructive">{error}</p>
              {onRegenerate && (
                <Button variant="outline" size="sm" className="mt-3 rounded-xl border-destructive/25 hover:bg-destructive/10" onClick={onRegenerate}>
                  Try Again
                </Button>
              )}
            </div>
          ) : !digest ? (
            <div className="rounded-2xl border border-dashed border-primary/25 bg-background/45 py-6 text-center text-muted-foreground">
              <Sparkles className="mx-auto mb-2 h-8 w-8 text-primary/40" />
              <p className="text-sm">No digest available yet</p>
              <p className="text-xs mt-1">Click "Regenerate" to generate an AI analysis</p>
            </div>
          ) : (
            <div className={cn('min-w-0 overflow-hidden rounded-2xl border border-border/50 bg-background/45 p-4 text-sm leading-relaxed [overflow-wrap:anywhere]')}>
              <AgentMessageRenderer content={digest} />
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
