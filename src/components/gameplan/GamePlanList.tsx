import { type GamePlan } from '@/hooks/useGamePlans';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2, Calendar, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const statusConfig: Record<string, { label: string; className: string }> = {
  planning: {
    label: 'Planning',
    className: 'border-brand-400/35 bg-brand-500/10 text-brand-700 dark:text-brand-200',
  },
  active: {
    label: 'Active',
    className: 'border-success/35 bg-success/10 text-success dark:text-success',
  },
  completed: {
    label: 'Completed',
    className: 'border-success/35 bg-success/10 text-success dark:text-success',
  },
  archived: {
    label: 'Archived',
    className: 'border-border/35 bg-muted/10 text-muted-foreground dark:text-foreground',
  },
};

interface Props {
  plans: GamePlan[];
  isLoading: boolean;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function GamePlanList({ plans, isLoading, onSelect, onDelete }: Props) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading game plans">
        {[1, 2, 3].map(i => (
          <Card key={i} className="overflow-hidden border-primary/10 bg-card/70 shadow-lg shadow-sm dark:shadow-black/5 dark:bg-background/40 dark:shadow-black/20" aria-hidden="true">
            <CardContent className="space-y-5 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-12 w-12 rounded-2xl" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-44" />
                  </div>
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="h-9 w-full rounded-xl" />
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-8 w-8 rounded-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!plans.length) {
    return (
      <Card className="border-dashed border-primary/20 bg-card/60 shadow-lg shadow-sm dark:shadow-black/5 dark:bg-background/35 dark:shadow-black/20" role="status">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-4xl shadow-inner shadow-primary/10">🎯</div>
          <h3 className="text-lg font-semibold text-foreground">No game plans yet</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">Create your first strategic playbook to get started.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3" role="list" aria-label="Game plans">
      {plans.map((plan, i) => {
        const cfg = statusConfig[plan.status] || statusConfig.planning;
        return (
          <Card
            key={plan.id}
            role="listitem"
            className="group relative overflow-hidden cursor-pointer border-border/60 bg-[linear-gradient(145deg,hsl(var(--card)/0.96),hsl(var(--muted)/0.18))] shadow-lg shadow-sm dark:shadow-black/5 ring-1 ring-border dark:ring-white/40 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-2xl hover:shadow-primary/10 focus-within:border-primary/30 focus-within:shadow-2xl focus-within:shadow-primary/10 motion-reduce:transition-none motion-reduce:hover:translate-y-0 dark:border-white/10 dark:bg-background/65 dark:ring-white/10 dark:shadow-black/25 dark:hover:shadow-primary/10"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <button
              type="button"
              className="absolute inset-0 z-10 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={() => onSelect(plan.id)}
              aria-label={`Open game plan ${plan.name}`}
            />
            {/* Top gradient accent */}
            <div
              className="absolute inset-x-0 top-0 h-1.5 rounded-t-xl"
              style={{ background: `linear-gradient(90deg, ${plan.color}, ${plan.color}80)` }}
            />
            <div
              className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              style={{ background: `radial-gradient(circle at top right, ${plan.color}24, transparent 34%)` }}
            />
            <CardContent className="relative flex min-h-[13.5rem] flex-col p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background/70 text-2xl shadow-inner shadow-sm dark:shadow-black/5 ring-1 ring-border dark:ring-white/45 transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100 dark:border-white/10 dark:bg-background/70 dark:ring-white/10"
                    style={{ boxShadow: `inset 0 0 0 1px ${plan.color}24, 0 12px 28px ${plan.color}14` }}
                  >
                    {plan.icon}
                  </span>
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
                      {plan.name}
                    </h3>
                    {plan.description && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{plan.description}</p>
                    )}
                  </div>
                </div>
                <Badge variant="outline" className={cn('shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold shadow-sm', cfg.className)}>
                  {cfg.label}
                </Badge>
              </div>

              {(plan.start_date || plan.end_date) && (
                <div className="mb-4 flex items-center gap-1.5 rounded-xl border border-border/50 bg-background/55 px-2.5 py-2 text-xs text-muted-foreground dark:border-white/10 dark:bg-background/45">
                  <Calendar className="h-3.5 w-3.5 text-primary" />
                  <span className="truncate">
                    {plan.start_date && format(new Date(plan.start_date), 'MMM d, yyyy')}
                    {plan.start_date && plan.end_date && ' → '}
                    {plan.end_date && format(new Date(plan.end_date), 'MMM d, yyyy')}
                  </span>
                </div>
              )}

              <div className="mt-auto flex items-center justify-between gap-3 border-t border-border/50 pt-3 dark:border-white/10">
                <span className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Created {format(new Date(plan.created_at), 'MMM d, yyyy')}
                </span>
                <div className="flex items-center gap-1">
                  {onDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative z-20 h-8 w-8 rounded-full text-muted-foreground opacity-0 transition-all duration-200 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-destructive/30 group-hover:opacity-100 motion-reduce:transition-none"
                      onClick={(e) => { e.stopPropagation(); onDelete(plan.id); }}
                      aria-label={`Delete ${plan.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-1 group-hover:text-primary group-hover:opacity-100 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0" />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
