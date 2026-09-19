/**
 * Phase 5 — Unified activity timeline for a purchase file.
 */
import { useQuery } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, FileUp, ShieldCheck, AlertOctagon, CheckCircle2, Wallet, CircleDot } from 'lucide-react';

const ICON: Record<string, any> = {
  status_changed: CircleDot,
  finance_decision_recorded: ShieldCheck,
  condition_added: CircleDot,
  condition_status_changed: CheckCircle2,
  valuation_ordered: Wallet,
  valuation_updated: Wallet,
  risk_added: AlertOctagon,
  risk_status_changed: AlertOctagon,
  risk_severity_changed: AlertOctagon,
  document_uploaded: FileUp,
};

function formatEvent(ev: string) {
  return ev.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function ActivityTimeline({ fileId }: { fileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['pf-activity', fileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-deal-trackers', {
        operation: 'list_activity', purchase_file_id: fileId, limit: 200,
      });
      if (error) throw new Error(error.message);
      return (data?.activity || []) as any[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Activity timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && !data?.length && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          <ul className="space-y-3">
            {(data || []).map((ev: any) => {
              const Icon = ICON[ev.event_type] || CircleDot;
              const payload = (ev.payload as any) || {};
              return (
                <li key={`${ev.source}-${ev.id}`} className="flex items-start gap-3 border-l-2 border-border pl-3 pb-1">
                  <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{formatEvent(ev.event_type)}</span>
                      {ev.from_value && ev.to_value && (
                        <Badge variant="outline" className="text-[10px]">{ev.from_value} → {ev.to_value}</Badge>
                      )}
                      {!ev.from_value && ev.to_value && (
                        <Badge variant="outline" className="text-[10px]">{ev.to_value}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">{new Date(ev.created_at).toLocaleString('en-AU')}</span>
                    </div>
                    {(payload.title || payload.label) && (
                      <p className="text-xs text-muted-foreground mt-0.5">{payload.title || payload.label}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
