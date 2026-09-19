/**
 * Client-side card: shows the joint onboarding checklist per file with progress,
 * lets the client tick off their own steps.
 */
import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ListChecks, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { portalSessionBodyFields, portalSessionHeaders } from '@/lib/portalSession';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


type Step = { id: string; label: string; description: string | null; owner: 'client'|'broker'|'shared'; status: string; category: string };
type FileBlock = { id: string; title: string; steps: Step[]; completed: number; total: number };

async function call(operation: string, body: any = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/client-portal-batch6`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...portalSessionHeaders(),
    },
    // NOT `credentials: 'include'`: this endpoint answers with a wildcard
    // `Access-Control-Allow-Origin`, and a wildcard origin is invalid for a
    // credentialed request — the browser would block the response outright.
    // The session therefore rides the `x-portal-session-token` header, whose
    // in-memory token `client-portal-verify` repopulates on every load.
    body: JSON.stringify({ operation, ...body, ...portalSessionBodyFields() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json;
}

export function ClientOnboardingCard() {
  const [files, setFiles] = useState<FileBlock[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const json = await call('onboarding_list');
      setFiles(json.files || []);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const complete = async (step: Step) => {
    try {
      await call('onboarding_complete', { step_id: step.id });
      toast.success('Marked complete');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  if (loading) return <Card><CardContent className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></CardContent></Card>;
  const filesWithSteps = files.filter(f => f.total > 0);
  if (!filesWithSteps.length) return null;

  return (
    <div className="space-y-4">
      {filesWithSteps.map(f => {
        const pct = f.total ? Math.round((f.completed / f.total) * 100) : 0;
        return (
          <Card key={f.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><ListChecks className="h-4 w-4 text-primary" />Onboarding · {f.title}</CardTitle>
                <span className="text-xs font-medium">{f.completed} / {f.total}</span>
              </div>
              <Progress value={pct} className="h-1.5 mt-2" />
            </CardHeader>
            <CardContent className="space-y-1.5">
              {f.steps.map(s => {
                const done = s.status === 'complete';
                const canTick = s.owner !== 'broker' && !done;
                return (
                  <div key={s.id} className={cn('flex items-start gap-2 p-2 rounded border border-border/60', done && 'opacity-60')}>
                    <Checkbox checked={done} disabled={!canTick} onCheckedChange={() => canTick && complete(s)} />
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-sm', done && 'line-through text-muted-foreground')}>{s.label}</p>
                      {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                    </div>
                    <Badge variant="outline" className="text-xs capitalize">{s.owner === 'broker' ? 'Broker' : s.owner === 'shared' ? 'Joint' : 'You'}</Badge>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
