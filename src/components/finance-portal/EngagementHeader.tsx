import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Sparkles, ArrowRight, Activity, X, MessageSquare, FileText, GitBranch, Award } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface ChangeItem { type: string; label: string; link?: string; at: string }
interface EngagementData {
  previous_seen_at: string | null;
  streak: number;
  active_days_7: number;
  active_days_30: number;
  badges: Array<{ badge_key: string; earned_at: string; metadata: any }>;
  what_changed: ChangeItem[];
}

function iconFor(type: string) {
  if (type === 'message') return MessageSquare;
  if (type === 'document_uploaded') return FileText;
  if (type.includes('status')) return GitBranch;
  return Activity;
}

export function EngagementHeader() {
  const { invokeFinanceFunction, user } = useFinancePortalAuth();
  const qc = useQueryClient();

  const { data } = useQuery<EngagementData>({
    queryKey: ['finance-engagement', user?.id],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-engagement', { operation: 'get_engagement' });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const markSeen = useMutation({
    mutationFn: async () => {
      await invokeFinanceFunction('finance-portal-engagement', { operation: 'mark_seen' });
    },
  });

  // Mark seen ~6 seconds after mount so the "what's changed" banner has time to be noticed
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => markSeen.mutate(), 6000);
    return () => clearTimeout(t);
  }, [data?.previous_seen_at]); // eslint-disable-line

  const dismissBanner = () => {
    qc.setQueryData<EngagementData>(['finance-engagement', user?.id], (prev) =>
      prev ? { ...prev, what_changed: [] } : prev);
  };

  const streak = data?.streak ?? 0;
  const latestBadge = data?.badges?.[0];
  const changedSinceLast = data?.what_changed ?? [];

  const sinceLabel = useMemo(() => {
    if (!data?.previous_seen_at) return 'first visit';
    try { return formatDistanceToNow(new Date(data.previous_seen_at), { addSuffix: true }); }
    catch { return 'last visit'; }
  }, [data?.previous_seen_at]);

  return (
    <div className="space-y-3">
      {/* Streak + badge chip row */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-wrap items-center gap-2"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium tabular-nums',
              streak >= 5
                ? 'border-brand-500/40 bg-gradient-to-r from-brand-500/15 to-warning/10 text-brand-700 dark:text-brand-300'
                : streak > 0
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-border bg-muted/40 text-muted-foreground',
            )}>
              <Flame className={cn('h-3.5 w-3.5', streak >= 5 && 'fill-current')} />
              {streak === 0 ? 'Start your streak' : `${streak}-day streak`}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            Active {data?.active_days_7 ?? 0}/7 days this week · {data?.active_days_30 ?? 0}/30 this month
          </TooltipContent>
        </Tooltip>

        {latestBadge && (
          <Badge variant="outline" className="border-brand-500/40 bg-brand-500/10 text-brand-700 dark:text-brand-300 gap-1">
            <Award className="h-3 w-3" />
            {latestBadge.metadata?.label || latestBadge.badge_key.replace(/_/g, ' ')}
          </Badge>
        )}

        {(data?.badges?.length ?? 0) > 1 && (
          <span className="text-[11px] text-muted-foreground">
            +{(data!.badges.length - 1)} more badge{data!.badges.length - 1 === 1 ? '' : 's'}
          </span>
        )}
      </motion.div>

      {/* What's changed since last visit */}
      <AnimatePresence>
        {changedSinceLast.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card overflow-hidden">
              <div className="h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent" />
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">
                        {changedSinceLast.length} change{changedSinceLast.length === 1 ? '' : 's'} since {sinceLabel}
                      </div>
                      <div className="text-[11px] text-muted-foreground">Tap any item to jump straight in.</div>
                    </div>
                  </div>
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6 -mr-1"
                    onClick={dismissBanner} aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {changedSinceLast.slice(0, 6).map((item, i) => {
                    const Icon = iconFor(item.type);
                    const inner = (
                      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-transparent hover:bg-muted/40 hover:border-border/60 transition-colors group">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs truncate flex-1">{item.label}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatDistanceToNow(new Date(item.at), { addSuffix: false })}
                        </span>
                        {item.link && (
                          <ArrowRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                        )}
                      </div>
                    );
                    return item.link ? (
                      <Link key={i} to={item.link}>{inner}</Link>
                    ) : (
                      <div key={i}>{inner}</div>
                    );
                  })}
                </div>
                {changedSinceLast.length > 6 && (
                  <div className="text-[11px] text-muted-foreground text-center mt-2">
                    +{changedSinceLast.length - 6} more
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
