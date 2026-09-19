/**
 * Batch 4 #25 — AI Coach (dashboard widget).
 * Surfaces 2-3 tailored performance insights for the broker.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lightbulb, Loader2, X, ArrowRight } from 'lucide-react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { toast } from 'sonner';

export function AiCoachWidget() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await invokeFinanceFunction('finance-portal-ai-copilot', { action: 'list_insights' });
    setItems(data?.insights ?? []);
    setLoading(false);
  };
  const run = async () => {
    setRunning(true);
    const { error } = await invokeFinanceFunction('finance-portal-ai-copilot', { action: 'coach_insights' });
    if (error) toast.error(error.message || 'Failed');
    else { toast.success('New insights ready'); await load(); }
    setRunning(false);
  };
  const dismiss = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    await invokeFinanceFunction('finance-portal-ai-copilot', { action: 'dismiss_insight', id });
  };
  useEffect(() => { load(); }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-primary" /> Coach
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={run} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? <p className="text-xs text-muted-foreground">Loading…</p>
          : items.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-2">No insights yet.</p>
              <Button size="sm" variant="outline" onClick={run} disabled={running}>Get coached</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map(i => (
                <div key={i.id} className="rounded-lg border border-border/60 p-3 group bg-card/50">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">{i.title}</div>
                      {i.body && <p className="text-xs text-muted-foreground mt-0.5">{i.body}</p>}
                      {i.action_label && i.action_path && (
                        <Button size="sm" variant="link" className="px-0 h-auto mt-1.5 text-xs" onClick={() => navigate(i.action_path)}>
                          {i.action_label} <ArrowRight className="h-3 w-3 ml-1" />
                        </Button>
                      )}
                    </div>
                    <button onClick={() => dismiss(i.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </CardContent>
    </Card>
  );
}
