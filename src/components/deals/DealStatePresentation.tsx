import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, RefreshCw, SearchX, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface StatePanelProps {
  icon?: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'gold';
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

const toneClass = {
  neutral: 'border-border dark:border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_42%),linear-gradient(145deg,rgba(39,39,42,0.82),rgba(9,9,11,0.78))] text-foreground dark:text-foreground',
  success: 'border-success/20 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.16),transparent_42%),linear-gradient(145deg,rgba(6,78,59,0.28),rgba(9,9,11,0.78))] text-success-foreground',
  warning: 'border-brand-300/25 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_42%),linear-gradient(145deg,rgba(120,53,15,0.24),rgba(9,9,11,0.78))] text-brand-50',
  danger: 'border-destructive/25 bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.16),transparent_42%),linear-gradient(145deg,rgba(127,29,29,0.22),rgba(9,9,11,0.80))] text-destructive-foreground',
  gold: 'border-brand-200/25 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.20),transparent_42%),linear-gradient(145deg,rgba(245,158,11,0.12),rgba(9,9,11,0.78))] text-brand-50',
};

export function DealStatePanel({ icon, eyebrow, title, description, tone = 'neutral', action, className, compact }: StatePanelProps) {
  return (
    <div className={cn('relative overflow-hidden rounded-[1.35rem] border p-6 text-center shadow-[0_18px_55px_rgba(0,0,0,0.20),inset_0_1px_0_rgba(255,255,255,0.08)]', toneClass[tone], compact ? 'py-5' : 'py-10 sm:py-12', className)}>
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent" />
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border dark:border-white/15 bg-white/[0.07] shadow-inner">
        {icon ?? <Sparkles className="h-7 w-7 text-brand-200" />}
      </div>
      {eyebrow && <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">{eyebrow}</p>}
      <p className="text-sm font-semibold text-foreground sm:text-base">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-muted-foreground sm:text-sm">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function DealLoadingState({ title = 'Loading deal pipeline', description = 'Preparing live deal, commission and settlement signals.' }: { title?: string; description?: string }) {
  return (
    <DealStatePanel
      tone="gold"
      icon={<Loader2 className="h-7 w-7 animate-spin text-brand-200" />}
      eyebrow="Loading"
      title={title}
      description={description}
    />
  );
}

export function DealErrorState({ title = 'Unable to load deals', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <DealStatePanel
      tone="danger"
      icon={<AlertTriangle className="h-7 w-7 text-destructive" />}
      eyebrow="Needs attention"
      title={title}
      description={message || 'Something interrupted this request. No data has been hidden or replaced; please retry or refresh.'}
      action={onRetry ? <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry</Button> : undefined}
    />
  );
}

export function NoResultsState({ title = 'No results match this view', description = 'Try clearing search terms or relaxing filters to bring deals back into view.' }: { title?: string; description?: string }) {
  return <DealStatePanel tone="neutral" icon={<SearchX className="h-7 w-7 text-muted-foreground dark:text-foreground" />} eyebrow="No results" title={title} description={description} compact />;
}
