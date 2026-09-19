import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

interface Snap {
  snapshot_date: string;
  total_questions: number;
  avg_citations: number | null;
  hybrid_count: number;
  vector_count: number;
  lexical_count: number;
  fallback_count: number;
  hybrid_win_rate: number | null;
}

export default function MarketQAQuality() {
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [loading, setLoading] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('market-qa-quality-report', { body: { action: 'report', days: 30 } });
      if (error) throw new Error(error.message);
      setSnaps((data as any)?.snapshots ?? []);
    } catch (e) { toast.error(String((e as Error).message)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const runSnapshot = async () => {
    setSnapshotting(true);
    try {
      const { data, error } = await supabase.functions.invoke('market-qa-quality-report', { body: { action: 'snapshot' } });
      if (error) throw new Error(error.message);
      toast.success(`Snapshot: ${(data as any)?.total_questions ?? 0} questions`);
      await load();
    } catch (e) { toast.error(String((e as Error).message)); }
    finally { setSnapshotting(false); }
  };

  const latest = snaps[snaps.length - 1];
  const chartData = snaps.map((s) => ({
    date: s.snapshot_date.slice(5),
    hybrid: s.hybrid_count,
    vector: s.vector_count,
    lexical: s.lexical_count,
    fallback: s.fallback_count,
    win: s.hybrid_win_rate ? Math.round(s.hybrid_win_rate * 100) : 0,
  }));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><BarChart3 className="h-6 w-6 text-primary" /> Market Q&amp;A Quality</h1>
          <p className="text-sm text-muted-foreground">Retrieval-mode mix, citation coverage, and hybrid win rate over the last 30 days.</p>
        </div>
        <Button variant="outline" size="sm" onClick={runSnapshot} disabled={snapshotting}>
          <RefreshCw className={`h-4 w-4 mr-2 ${snapshotting ? 'animate-spin' : ''}`} />
          Snapshot yesterday
        </Button>
      </div>

      {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}

      {latest && (
        <div className="grid grid-cols-4 gap-3">
          <Metric label="Latest total" value={latest.total_questions.toString()} />
          <Metric label="Avg citations" value={latest.avg_citations?.toFixed(1) ?? '—'} />
          <Metric label="Hybrid win rate" value={latest.hybrid_win_rate ? `${Math.round(latest.hybrid_win_rate * 100)}%` : '—'} />
          <Metric label="Fallback rate" value={latest.total_questions ? `${Math.round((latest.fallback_count / latest.total_questions) * 100)}%` : '—'} />
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Retrieval mode mix</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="hybrid" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="vector" stroke="hsl(var(--success))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="lexical" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="fallback" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Daily snapshots</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-xs">
          {snaps.slice().reverse().map((s) => (
            <div key={s.snapshot_date} className="flex items-center gap-3 py-1 border-b border-border/40 last:border-0">
              <span className="w-24 font-mono">{s.snapshot_date}</span>
              <Badge variant="outline" className="text-[10px]">{s.total_questions} Qs</Badge>
              <span className="text-muted-foreground">hybrid {s.hybrid_count} · vector {s.vector_count} · lexical {s.lexical_count} · fallback {s.fallback_count}</span>
              <span className="ml-auto">{s.hybrid_win_rate ? `${Math.round(s.hybrid_win_rate * 100)}% win` : '—'}</span>
            </div>
          ))}
          {!snaps.length && !loading && <p className="text-muted-foreground py-3">No snapshots yet. Cron writes one per day, or press "Snapshot yesterday".</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="pt-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </CardContent></Card>
  );
}
