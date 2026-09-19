import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { ListChecks, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const FN = 'finance-portal-batch6';

type Step = {
  id: string; step_key: string; label: string; description: string | null;
  category: string; owner: 'client' | 'broker' | 'shared';
  status: 'pending' | 'in_progress' | 'complete' | 'skipped' | 'blocked';
  visible_to_client: boolean; position: number; completed_at: string | null;
};

const OWNER_TONE: Record<string, string> = {
  client: 'bg-info/15 text-info border-info/30',
  broker: 'bg-brand-500/15 text-brand-500 border-brand-500/30',
  shared: 'bg-accent/15 text-accent border-accent/30',
};

export function OnboardingChecklistCard({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['pf-onboarding', fileId],
    queryFn: async () => {
      const res = await invokeFinanceFunction(FN, { operation: 'onboarding_list', purchase_file_id: fileId });
      if (res.error) throw new Error(res.error);
      return res.data?.steps as Step[];
    },
  });

  const progress = useMemo(() => {
    if (!data?.length) return 0;
    const done = data.filter(s => s.status === 'complete').length;
    return Math.round((done / data.length) * 100);
  }, [data]);

  const seed = async () => {
    const res = await invokeFinanceFunction(FN, { operation: 'onboarding_seed', purchase_file_id: fileId });
    if (res.error) return toast.error(res.error);
    toast.success(`Seeded ${res.data?.seeded ?? 0} steps`);
    qc.invalidateQueries({ queryKey: ['pf-onboarding', fileId] });
  };
  const toggle = async (s: Step) => {
    const status = s.status === 'complete' ? 'pending' : 'complete';
    const res = await invokeFinanceFunction(FN, { operation: 'onboarding_set_status', step_id: s.id, status });
    if (res.error) return toast.error(res.error);
    qc.invalidateQueries({ queryKey: ['pf-onboarding', fileId] });
  };
  const remove = async (s: Step) => {
    if (!confirm('Remove this step?')) return;
    const res = await invokeFinanceFunction(FN, { operation: 'onboarding_delete', step_id: s.id });
    if (res.error) return toast.error(res.error);
    qc.invalidateQueries({ queryKey: ['pf-onboarding', fileId] });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><ListChecks className="h-4 w-4 text-primary" />Onboarding Checklist</CardTitle>
          {!data?.length && !isLoading && (
            <Button size="sm" variant="outline" onClick={seed}><Sparkles className="h-3.5 w-3.5 mr-1" />Seed default</Button>
          )}
        </div>
        {data && data.length > 0 && (
          <div className="space-y-1 pt-2">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">{data.filter(s => s.status === 'complete').length} of {data.length} complete</span><span className="font-medium">{progress}%</span></div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> :
          !data?.length ? <p className="text-xs text-muted-foreground">No checklist yet — seed the default template to get started.</p> :
          data.map(s => {
            const done = s.status === 'complete';
            return (
              <div key={s.id} className={cn('flex items-center gap-3 p-2 rounded border border-border/60 group', done && 'opacity-60')}>
                <Checkbox checked={done} onCheckedChange={() => toggle(s)} />
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm', done && 'line-through text-muted-foreground')}>{s.label}</p>
                  {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                </div>
                <Badge variant="outline" className={cn('text-xs capitalize', OWNER_TONE[s.owner])}>{s.owner}</Badge>
                {s.visible_to_client && <Badge variant="outline" className="text-xs">Client</Badge>}
                <Button size="icon" variant="ghost" className="opacity-0 group-hover:opacity-100" onClick={() => remove(s)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </div>
            );
          })
        }
      </CardContent>
    </Card>
  );
}
