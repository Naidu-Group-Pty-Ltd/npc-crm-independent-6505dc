import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Plus, Pause, Play, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface Subscription {
  id: string;
  question_template: string;
  cadence: 'daily' | 'weekly';
  channels: string[];
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
}
interface SubRun {
  id: string;
  subscription_id: string;
  question_id: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

async function invoke(action: string, payload: Record<string, any> = {}) {
  const { data, error } = await supabase.functions.invoke('market-qa-subscriptions', { body: { action, ...payload } });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

export default function MarketQASubscriptions() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [runs, setRuns] = useState<SubRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newQ, setNewQ] = useState('');
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('weekly');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { subscriptions, runs } = await invoke('list');
      setSubs(subscriptions ?? []);
      setRuns(runs ?? []);
    } catch (err) { toast.error(String((err as Error).message)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    if (newQ.trim().length < 6) return;
    setCreating(true);
    try {
      await invoke('create', { question_template: newQ.trim(), cadence, channels: ['in_app'] });
      setNewQ('');
      toast.success('Subscription created');
      await refresh();
    } catch (err) { toast.error(String((err as Error).message)); }
    finally { setCreating(false); }
  };

  const toggle = async (sub: Subscription) => {
    try { await invoke('update', { id: sub.id, is_active: !sub.is_active }); refresh(); }
    catch (err) { toast.error(String((err as Error).message)); }
  };

  const runNow = async (sub: Subscription) => {
    try { await invoke('run-now', { id: sub.id }); toast.success('Ran now'); refresh(); }
    catch (err) { toast.error(String((err as Error).message)); }
  };

  const remove = async (sub: Subscription) => {
    if (!confirm('Delete this subscription?')) return;
    try { await invoke('delete', { id: sub.id }); refresh(); }
    catch (err) { toast.error(String((err as Error).message)); }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Market Q&A Subscriptions</h1>
        <p className="text-sm text-muted-foreground">Get fresh grounded answers on your saved questions — daily or weekly.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">New subscription</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={newQ} onChange={(e) => setNewQ(e.target.value)} rows={2}
            placeholder="e.g. What's the latest on RBA rate expectations and its impact on VIC investors?" />
          <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground">Cadence:</label>
            <select className="h-8 rounded-md border bg-background text-sm px-2" value={cadence}
              onChange={(e) => setCadence(e.target.value as any)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            <Button size="sm" onClick={create} disabled={creating || newQ.trim().length < 6}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              Subscribe
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Your subscriptions</CardTitle>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </CardHeader>
        <CardContent className="space-y-3">
          {subs.length === 0 && !loading && <p className="text-sm text-muted-foreground">No subscriptions yet.</p>}
          {subs.map((s) => {
            const lastRun = runs.find((r) => r.subscription_id === s.id);
            return (
              <div key={s.id} className="border rounded-md p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{s.question_template}</div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-[10px] capitalize">{s.cadence}</Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {s.is_active ? 'active' : 'paused'}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        next: {s.is_active ? new Date(s.next_run_at).toLocaleString('en-AU') : '—'}
                      </span>
                      {s.last_run_at && (
                        <span className="text-[11px] text-muted-foreground">
                          last: {new Date(s.last_run_at).toLocaleString('en-AU')}
                          {lastRun?.status === 'failed' && <span className="text-destructive ml-1">(failed)</span>}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => runNow(s)} title="Run now">
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggle(s)} title={s.is_active ? 'Pause' : 'Resume'}>
                      {s.is_active ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(s)} title="Delete">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
