/**
 * Batch 4 #24 — AI Risk Sniffer (dashboard widget).
 * Scans the partner's active deals for high-impact risk patterns.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, Loader2, X, RefreshCw } from 'lucide-react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

const SEV_TONE: Record<string, string> = {
  high: 'bg-destructive/15 text-destructive border-destructive/30',
  medium: 'bg-warning/15 text-warning border-warning/30',
  low: 'bg-muted text-muted-foreground border-border',
};

export function AiRiskSnifferWidget() {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await invokeFinanceFunction('finance-portal-ai-copilot', { action: 'list_alerts' });
    setAlerts(data?.alerts ?? []);
    setLoading(false);
  };

  const scan = async () => {
    setScanning(true);
    const { error } = await invokeFinanceFunction('finance-portal-ai-copilot', { action: 'scan_risk' });
    if (error) toast.error(error.message || 'Scan failed');
    else { toast.success('Risk scan complete'); await load(); }
    setScanning(false);
  };

  const dismiss = async (id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
    await invokeFinanceFunction('finance-portal-ai-copilot', { action: 'dismiss_alert', id });
  };

  useEffect(() => { load(); }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base inline-flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning" /> Risk Sniffer
            {!!alerts.length && <Badge variant="outline">{alerts.length}</Badge>}
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={scan} disabled={scanning}>
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? <p className="text-xs text-muted-foreground">Loading…</p>
          : alerts.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-2">No active risk alerts.</p>
              <Button size="sm" variant="outline" onClick={scan} disabled={scanning}>
                {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}Run scan
              </Button>
            </div>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto">
              {alerts.map(a => (
                <div key={a.id} className="rounded-lg border border-border/60 p-2.5 group">
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className={cn('text-[10px] px-1.5', SEV_TONE[a.severity] ?? SEV_TONE.low)}>{a.severity}</Badge>
                    <div className="flex-1 min-w-0">
                      <button onClick={() => navigate(`/finance/purchase-files/${a.purchase_file_id}`)} className="text-sm font-medium text-left hover:underline truncate w-full">
                        {a.title}
                      </button>
                      {a.summary && <p className="text-xs text-muted-foreground mt-0.5">{a.summary}</p>}
                      <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(a.generated_at), { addSuffix: true })}</span>
                    </div>
                    <button onClick={() => dismiss(a.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground">
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
