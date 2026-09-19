/**
 * Phase 6 — Agent eval baselines panel.
 * Promotes the latest run per eval into a promoted baseline snapshot and
 * shows regression deltas (pass_rate) against the previous baseline.
 */
import { useCallback, useEffect, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, Trash2, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { toast } from 'sonner';

interface Baseline {
  id: string;
  name: string;
  notes: string | null;
  eval_count: number;
  pass_count: number;
  pass_rate: number;
  results: Array<{ eval_id: string; passed: boolean; latency_ms?: number; score?: number; notes?: string }>;
  created_at: string;
}

async function invoke(action: string, body: Record<string, any> = {}) {
  const { data, error } = await invokeSecureFunction('phase6-quality-ops', { action, ...body });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as any;
}

function Delta({ current, previous }: { current: number; previous?: number }) {
  if (previous === undefined) return <span className="text-muted-foreground text-xs">—</span>;
  const d = current - previous;
  if (Math.abs(d) < 0.005) return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Minus className="h-3 w-3" />no change</span>;
  const good = d > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${good ? 'text-success' : 'text-destructive'}`}>
      {good ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {(d * 100).toFixed(1)}pp
    </span>
  );
}

export default function AgentEvalBaselinesPanel() {
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [loading, setLoading] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { baselines } = await invoke('agent-eval-baselines-list'); setBaselines(baselines); }
    catch (err) { toast.error(String((err as Error).message)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const promote = async () => {
    setBusy(true);
    try {
      await invoke('agent-eval-baseline-promote', { name: name || undefined, notes: notes || undefined });
      toast.success('Baseline promoted');
      setPromoteOpen(false); setName(''); setNotes('');
      load();
    } catch (err) { toast.error(String((err as Error).message)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Promote the latest run of each eval into a baseline snapshot. Regression deltas compare each baseline to the one below it.</p>
        <Dialog open={promoteOpen} onOpenChange={setPromoteOpen}>
          <DialogTrigger asChild><Button size="sm">Promote current runs to baseline</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Promote to baseline</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Baseline name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
              <Textarea placeholder="Notes (optional)" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <DialogFooter><Button disabled={busy} onClick={promote}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Promote'}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {!loading && baselines.length === 0 && <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No baselines yet. Run evals then promote.</CardContent></Card>}

      <div className="space-y-2">
        {baselines.map((b, idx) => {
          const prev = baselines[idx + 1];
          const regressions = prev
            ? b.results.filter((r) => {
                const prior = prev.results.find((x) => x.eval_id === r.eval_id);
                return prior?.passed === true && r.passed === false;
              })
            : [];
          return (
            <Card key={b.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{b.name}</CardTitle>
                    <div className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString('en-AU')}</div>
                    {b.notes && <p className="text-xs text-muted-foreground mt-1">{b.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{b.pass_count}/{b.eval_count} pass</Badge>
                    <Badge variant="secondary">{(b.pass_rate * 100).toFixed(1)}%</Badge>
                    <Delta current={b.pass_rate} previous={prev?.pass_rate} />
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={async () => {
                      if (!confirm('Delete baseline?')) return;
                      try { await invoke('agent-eval-baseline-delete', { id: b.id }); load(); }
                      catch (err) { toast.error(String((err as Error).message)); }
                    }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardHeader>
              {regressions.length > 0 && (
                <CardContent className="pt-0">
                  <div className="text-xs text-destructive">
                    <strong>Regressions vs previous:</strong> {regressions.length} eval(s) newly failing.
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
