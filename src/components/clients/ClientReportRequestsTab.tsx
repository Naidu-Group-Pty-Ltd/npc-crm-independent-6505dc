import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '@/components/ui/dialog';
import {
  Loader2, Clock, ArrowRight, CheckCircle2, XCircle,
  BarChart3, PiggyBank, Building2, Inbox, Send, Calendar
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';

interface Props {
  clientId: string;
  clientName: string;
}

const requestTypeConfig: Record<string, { label: string; icon: typeof BarChart3; color: string }> = {
  portfolio_review: { label: PORTFOLIO_REPORT_LABEL, icon: BarChart3, color: 'bg-success/10 text-success' },
  borrowing_capacity: { label: 'Borrowing Capacity', icon: PiggyBank, color: 'bg-brand-500/10 text-brand-600' },
  investment_property: { label: 'Investment Property', icon: Building2, color: 'bg-info/10 text-info' },
};

const statusConfig: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  pending: { label: 'Pending', icon: Clock, color: 'bg-brand-500/10 text-brand-600 border-brand-200' },
  in_progress: { label: 'In Progress', icon: ArrowRight, color: 'bg-info/10 text-info border-info/30' },
  completed: { label: 'Completed', icon: CheckCircle2, color: 'bg-success/10 text-success border-success/30' },
  declined: { label: 'Declined', icon: XCircle, color: 'bg-destructive/10 text-destructive border-destructive/30' },
};

export function ClientReportRequestsTab({ clientId, clientName }: Props) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [updating, setUpdating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['client-report-requests', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'client_portal_report_requests',
          select: '*',
          orderBy: 'created_at',
          orderAsc: false,
          filters: { client_id: clientId },
        },
      });
      if (error) throw error;
      return data?.records || data?.data || [];
    },
  });

  const requests = data || [];
  const selected = requests.find((r: any) => r.id === selectedId);

  const handleStatusUpdate = async (requestId: string, newStatus: string) => {
    setUpdating(true);
    try {
      const { error } = await invokeSecureFunction('manage-client-data', {
        operation: 'update',
        table: 'client_portal_report_requests',
        recordId: requestId,
        data: { status: newStatus, admin_notes: adminNotes.trim() || null },
      });
      if (error) throw error;
      toast.success(`Request marked as ${newStatus.replace('_', ' ')}`);
      queryClient.invalidateQueries({ queryKey: ['client-report-requests', clientId] });
      setSelectedId(null);
      setAdminNotes('');
    } catch (err: any) {
      toast.error('Failed to update: ' + (err.message || 'Unknown error'));
    } finally {
      setUpdating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No report requests from this client</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {requests.map((req: any) => {
          const typeConf = requestTypeConfig[req.request_type] || requestTypeConfig.portfolio_review;
          const statConf = statusConfig[req.status] || statusConfig.pending;
          const TypeIcon = typeConf.icon;
          return (
            <Card
              key={req.id}
              className="hover:shadow-md transition-all cursor-pointer"
              onClick={() => { setSelectedId(req.id); setAdminNotes(req.admin_notes || ''); }}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={cn('p-2 rounded-lg shrink-0', typeConf.color)}>
                    <TypeIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground">{typeConf.label}</p>
                      <Badge variant="outline" className={cn('text-[10px]', statConf.color)}>
                        {statConf.label}
                      </Badge>
                    </div>
                    {req.property_address && (
                      <p className="text-xs text-muted-foreground mt-0.5">📍 {req.property_address}</p>
                    )}
                    {req.notes && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{req.notes}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1.5">
                      {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Request</DialogTitle>
            <DialogDescription>Update the status of this report request for {clientName}.</DialogDescription>
          </DialogHeader>
          {selected && (() => {
            const typeConf = requestTypeConfig[selected.request_type] || requestTypeConfig.portfolio_review;
            const statConf = statusConfig[selected.status] || statusConfig.pending;
            return (
              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
                  <p className="font-medium text-foreground">{typeConf.label}</p>
                  {selected.property_address && <p className="text-muted-foreground text-xs">📍 {selected.property_address}</p>}
                  {selected.notes && <p className="text-muted-foreground text-xs">💬 {selected.notes}</p>}
                  <p className="text-xs text-muted-foreground">{format(new Date(selected.created_at), 'dd MMM yyyy, HH:mm')}</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">Admin Notes</Label>
                  <Textarea
                    placeholder="Notes visible to the client..."
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={2}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">Update Status</Label>
                  <div className="flex flex-wrap gap-2">
                    {(['pending', 'in_progress', 'completed', 'declined'] as const).map((status) => {
                      const conf = statusConfig[status];
                      const Icon = conf.icon;
                      const isActive = selected.status === status;
                      return (
                        <Button
                          key={status}
                          size="sm"
                          variant={isActive ? 'default' : 'outline'}
                          disabled={updating || isActive}
                          onClick={() => handleStatusUpdate(selected.id, status)}
                          className={cn(
                            'text-xs',
                            isActive && conf.color,
                            isActive && 'pointer-events-none'
                          )}
                        >
                          {updating ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : (
                            <Icon className="h-3.5 w-3.5 mr-1" />
                          )}
                          {conf.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}
