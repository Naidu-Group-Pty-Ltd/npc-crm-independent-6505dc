import { useEffect, useState } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { PlayCircle, Plus, Trash2, CheckCircle2, XCircle, Activity, Beaker } from 'lucide-react';
import AgentEvalBaselinesPanel from './AgentEvalBaselinesPanel';

interface EvalRow { id: string; name: string; description: string | null; prompt: string; expected_tools: string[]; expected_contains: string[]; expected_not_contains: string[]; tags: string[]; is_enabled: boolean; }
interface Stats { runs: number; pass: number; pass_rate: number; avg_score: number; avg_latency: number; latest: any; }
interface Trace { id: string; tool_name: string; tool_arguments: any; status: string | null; execution_time_ms: number; created_at: string; conversation_id: string; }

export default function AgentQuality() {
  const [evals, setEvals] = useState<EvalRow[]>([]);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [traces, setTraces] = useState<Trace[]>([]);
  const [toolSummary, setToolSummary] = useState<Record<string, { count: number; avg_ms: number; errors: number }>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [editing, setEditing] = useState<Partial<EvalRow> | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: evalRes }, { data: traceRes }] = await Promise.all([
      invokeSecureFunction('ai-dashboard-agent', { action: 'list-evals' }),
      invokeSecureFunction('ai-dashboard-agent', { action: 'get-trace-log', limit: 200 }),
    ]);
    setEvals(evalRes?.evals || []);
    setStats(evalRes?.stats || {});
    setTraces(traceRes?.traces || []);
    setToolSummary(traceRes?.tool_summary || {});
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const runEval = async (id: string) => {
    setRunning(id);
    try {
      const { data } = await invokeSecureFunction('ai-dashboard-agent', { action: 'run-eval', eval_id: id });
      toast[data?.passed ? 'success' : 'error'](data?.passed ? 'Passed ✓' : `Failed — score ${(data?.score * 100 | 0)}%`);
      load();
    } catch (e: any) { toast.error(e?.message || 'Failed'); }
    finally { setRunning(null); }
  };
  const runAll = async () => {
    setRunningAll(true);
    let passed = 0, failed = 0;
    for (const e of evals.filter(x => x.is_enabled)) {
      try {
        const { data } = await invokeSecureFunction('ai-dashboard-agent', { action: 'run-eval', eval_id: e.id });
        if (data?.passed) passed++; else failed++;
      } catch { failed++; }
    }
    toast[failed === 0 ? 'success' : 'error'](`${passed} passed · ${failed} failed`);
    setRunningAll(false); load();
  };
  const saveEval = async () => {
    if (!editing?.name || !editing?.prompt) { toast.error('Name and prompt are required'); return; }
    const { data } = await invokeSecureFunction('ai-dashboard-agent', {
      action: 'upsert-eval', ...editing,
      expected_tools: typeof editing.expected_tools === 'string' ? (editing.expected_tools as any).split(',').map((s: string) => s.trim()).filter(Boolean) : (editing.expected_tools || []),
      expected_contains: typeof editing.expected_contains === 'string' ? (editing.expected_contains as any).split(',').map((s: string) => s.trim()).filter(Boolean) : (editing.expected_contains || []),
      expected_not_contains: typeof editing.expected_not_contains === 'string' ? (editing.expected_not_contains as any).split(',').map((s: string) => s.trim()).filter(Boolean) : (editing.expected_not_contains || []),
      tags: typeof editing.tags === 'string' ? (editing.tags as any).split(',').map((s: string) => s.trim()).filter(Boolean) : (editing.tags || []),
    });
    if (data?.success) { toast.success('Saved'); setEditing(null); load(); }
    else toast.error(data?.error || 'Failed');
  };
  const delEval = async (id: string) => {
    if (!confirm('Delete this eval?')) return;
    await invokeSecureFunction('ai-dashboard-agent', { action: 'delete-eval', eval_id: id });
    load();
  };

  const overallPass = evals.reduce((acc, e) => acc + (stats[e.id]?.pass_rate || 0), 0) / (evals.length || 1);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Beaker className="w-7 h-7 text-primary" /> Agent Quality</h1>
          <p className="text-muted-foreground mt-1">Regression evals and tool-call traces for the Aurixa Agent.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditing({ name: '', prompt: '', expected_tools: [], expected_contains: [], expected_not_contains: [], tags: [], is_enabled: true })}><Plus className="w-4 h-4 mr-2" /> New eval</Button>
          <Button onClick={runAll} disabled={runningAll || !evals.length}><PlayCircle className="w-4 h-4 mr-2" /> {runningAll ? 'Running…' : 'Run all'}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Evals defined</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{evals.length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Avg pass rate</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-success">{Math.round(overallPass)}%</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Tool calls traced</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{traces.length}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Distinct tools used</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{Object.keys(toolSummary).length}</div></CardContent></Card>
      </div>

      <Tabs defaultValue="evals">
        <TabsList><TabsTrigger value="evals">Evaluations</TabsTrigger><TabsTrigger value="traces">Trace log</TabsTrigger><TabsTrigger value="tools">Tool summary</TabsTrigger><TabsTrigger value="baselines">Baselines</TabsTrigger></TabsList>

        <TabsContent value="evals" className="mt-4">
          {loading ? <div className="text-sm text-muted-foreground p-4">Loading…</div> :
            <div className="space-y-2">
              {!evals.length && <Card><CardContent className="py-12 text-center text-muted-foreground">No evals defined. Click <span className="font-medium">New eval</span> to seed one.</CardContent></Card>}
              {evals.map(e => {
                const s = stats[e.id];
                return (
                  <Card key={e.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-base flex items-center gap-2">
                            {s?.latest?.passed === true && <CheckCircle2 className="w-4 h-4 text-success" />}
                            {s?.latest?.passed === false && <XCircle className="w-4 h-4 text-destructive" />}
                            {e.name}
                          </CardTitle>
                          {e.description && <p className="text-xs text-muted-foreground mt-1">{e.description}</p>}
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            {e.tags.map(t => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                            {s && <Badge variant="outline" className="text-[10px]">{s.pass_rate}% pass · {s.runs} runs · {s.avg_latency}ms</Badge>}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="sm" variant="outline" onClick={() => runEval(e.id)} disabled={running === e.id}>{running === e.id ? '…' : 'Run'}</Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => delEval(e.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0"><details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Prompt & expectations</summary><div className="mt-2 space-y-1 pl-3 border-l-2 border-border/40"><div><span className="text-muted-foreground">Prompt:</span> {e.prompt}</div>{e.expected_tools.length > 0 && <div><span className="text-muted-foreground">Expects tools:</span> {e.expected_tools.join(', ')}</div>}{e.expected_contains.length > 0 && <div><span className="text-muted-foreground">Must contain:</span> {e.expected_contains.join(', ')}</div>}</div></details></CardContent>
                  </Card>
                );
              })}
            </div>
          }
        </TabsContent>

        <TabsContent value="traces" className="mt-4">
          <ScrollArea className="h-[60vh]"><div className="space-y-1">
            {traces.map(t => (
              <div key={t.id} className="flex items-center gap-3 p-2 rounded border border-border/40 text-xs">
                <Badge variant="outline" className="text-[10px] shrink-0">{t.tool_name}</Badge>
                <span className="text-muted-foreground shrink-0">{new Date(t.created_at).toLocaleString('en-AU')}</span>
                <span className="text-muted-foreground shrink-0">{t.execution_time_ms}ms</span>
                <Badge variant={t.status === 'success' ? 'secondary' : 'destructive'} className="text-[10px] shrink-0">{t.status || 'unknown'}</Badge>
                <span className="truncate flex-1 opacity-70">{JSON.stringify(t.tool_arguments).slice(0, 120)}</span>
              </div>
            ))}
            {!traces.length && <div className="text-sm text-muted-foreground p-4">No traces yet.</div>}
          </div></ScrollArea>
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(toolSummary).sort((a, b) => b[1].count - a[1].count).map(([name, s]) => (
              <Card key={name}><CardContent className="p-4 flex items-center justify-between">
                <div><div className="font-medium text-sm">{name}</div><div className="text-xs text-muted-foreground">avg {s.avg_ms}ms · {s.errors} errors</div></div>
                <div className="flex items-center gap-1"><Activity className="w-3 h-3" /><span className="font-bold">{s.count}</span></div>
              </CardContent></Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="baselines" className="mt-4"><AgentEvalBaselinesPanel /></TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit' : 'New'} eval</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs text-muted-foreground">Name</label><Input value={editing?.name || ''} onChange={e => setEditing({ ...editing!, name: e.target.value })} /></div>
            <div><label className="text-xs text-muted-foreground">Description</label><Input value={editing?.description || ''} onChange={e => setEditing({ ...editing!, description: e.target.value })} /></div>
            <div><label className="text-xs text-muted-foreground">Prompt (what the user types)</label><Textarea rows={3} value={editing?.prompt || ''} onChange={e => setEditing({ ...editing!, prompt: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-muted-foreground">Expected tools (comma)</label><Input value={Array.isArray(editing?.expected_tools) ? editing?.expected_tools.join(', ') : (editing?.expected_tools as any) || ''} onChange={e => setEditing({ ...editing!, expected_tools: e.target.value as any })} /></div>
              <div><label className="text-xs text-muted-foreground">Tags (comma)</label><Input value={Array.isArray(editing?.tags) ? editing?.tags.join(', ') : (editing?.tags as any) || ''} onChange={e => setEditing({ ...editing!, tags: e.target.value as any })} /></div>
            </div>
            <div><label className="text-xs text-muted-foreground">Response must contain (comma)</label><Input value={Array.isArray(editing?.expected_contains) ? editing?.expected_contains.join(', ') : (editing?.expected_contains as any) || ''} onChange={e => setEditing({ ...editing!, expected_contains: e.target.value as any })} /></div>
            <div><label className="text-xs text-muted-foreground">Response must NOT contain (comma)</label><Input value={Array.isArray(editing?.expected_not_contains) ? editing?.expected_not_contains.join(', ') : (editing?.expected_not_contains as any) || ''} onChange={e => setEditing({ ...editing!, expected_not_contains: e.target.value as any })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={saveEval}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
