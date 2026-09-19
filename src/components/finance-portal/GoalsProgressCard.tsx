import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Target, Pencil, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

function monthStartIso(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
function fmtCurrency(n: number): string {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

interface GoalRow {
  finance_contact_id?: string;
  month_start: string;
  settlement_target_count: number | null;
  settlement_target_amount: number | null;
  commission_target_net: number | null;
  notes?: string | null;
}
interface ProgressResp {
  month_start: string;
  goal: GoalRow | null;
  actuals: { settlement_count: number; settlement_amount: number; commission_net: number };
  last_3_months_avg_settlements: number;
}

function Ring({ pct, label, value, target, color }: { pct: number; label: string; value: string; target: string; color: string }) {
  const safePct = Math.max(0, Math.min(1, pct));
  const c = 2 * Math.PI * 32;
  const offset = c * (1 - safePct);
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative h-20 w-20">
        <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
          <circle cx="40" cy="40" r="32" strokeWidth="6" className="fill-none stroke-muted" />
          <motion.circle
            cx="40" cy="40" r="32" strokeWidth="6" strokeLinecap="round"
            className={cn('fill-none', color)}
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-semibold tabular-nums">{Math.round(safePct * 100)}%</span>
        </div>
      </div>
      <div className="mt-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xs font-medium tabular-nums">{value} <span className="text-muted-foreground">/ {target}</span></div>
    </div>
  );
}

export function GoalsProgressCard() {
  const { invokeFinanceFunction, user } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const monthStart = monthStartIso();

  const { data, isLoading } = useQuery<ProgressResp>({
    queryKey: ['finance-goal-progress', user?.id, monthStart],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-forecasting', {
        operation: 'goal_progress',
        month_start: monthStart,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  const [draft, setDraft] = useState<GoalRow>({
    month_start: monthStart,
    settlement_target_count: null,
    settlement_target_amount: null,
    commission_target_net: null,
  });

  const save = useMutation({
    mutationFn: async (row: GoalRow) => {
      const { data, error } = await invokeFinanceFunction('finance-portal-forecasting', {
        operation: 'set_goal',
        ...row,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance-goal-progress', user?.id, monthStart] });
      toast.success('Goals updated');
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save'),
  });

  const goal = data?.goal;
  const actuals = data?.actuals;
  const targets = {
    count: goal?.settlement_target_count || 0,
    amount: goal?.settlement_target_amount || 0,
    commission: goal?.commission_target_net || 0,
  };
  const monthLabel = new Date(monthStart + 'T00:00:00Z').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  const hasGoal = !!(targets.count || targets.amount || targets.commission);

  return (
    <Card className="border border-border overflow-hidden">
      <div className="h-[2px] bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Target className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-sm">My monthly goals</CardTitle>
            <CardDescription className="text-[11px]">{monthLabel} progress</CardDescription>
          </div>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v && goal) setDraft({
          month_start: monthStart,
          settlement_target_count: goal.settlement_target_count,
          settlement_target_amount: goal.settlement_target_amount,
          commission_target_net: goal.commission_target_net,
        }); }}>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 text-xs">
              <Pencil className="h-3 w-3 mr-1" /> {hasGoal ? 'Edit' : 'Set goals'}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Set goals for {monthLabel}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="g-count">Settlements (count)</Label>
                <Input id="g-count" type="number" min={0}
                  value={draft.settlement_target_count ?? ''}
                  onChange={e => setDraft(d => ({ ...d, settlement_target_count: e.target.value === '' ? null : Number(e.target.value) }))} />
              </div>
              <div>
                <Label htmlFor="g-amt">Settlement loan volume ($)</Label>
                <Input id="g-amt" type="number" min={0}
                  value={draft.settlement_target_amount ?? ''}
                  onChange={e => setDraft(d => ({ ...d, settlement_target_amount: e.target.value === '' ? null : Number(e.target.value) }))} />
              </div>
              <div>
                <Label htmlFor="g-comm">Net commission ($)</Label>
                <Input id="g-comm" type="number" min={0}
                  value={draft.commission_target_net ?? ''}
                  onChange={e => setDraft(d => ({ ...d, commission_target_net: e.target.value === '' ? null : Number(e.target.value) }))} />
              </div>
              {data?.last_3_months_avg_settlements != null && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <TrendingUp className="h-3 w-3" />
                  3-month average: <strong className="tabular-nums">{data.last_3_months_avg_settlements}</strong> settlements/mo
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="pt-1">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !hasGoal ? (
          <div className="text-center py-6 text-xs text-muted-foreground border border-dashed rounded-lg">
            Set personal targets to track your month at a glance.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Ring
              pct={targets.count ? (actuals?.settlement_count || 0) / targets.count : 0}
              label="Settlements"
              value={String(actuals?.settlement_count ?? 0)}
              target={String(targets.count || '—')}
              color="stroke-primary"
            />
            <Ring
              pct={targets.amount ? (actuals?.settlement_amount || 0) / targets.amount : 0}
              label="Volume"
              value={fmtCurrency(actuals?.settlement_amount || 0)}
              target={fmtCurrency(targets.amount)}
              color="stroke-success"
            />
            <Ring
              pct={targets.commission ? (actuals?.commission_net || 0) / targets.commission : 0}
              label="Commission"
              value={fmtCurrency(actuals?.commission_net || 0)}
              target={fmtCurrency(targets.commission)}
              color="stroke-brand-500"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
