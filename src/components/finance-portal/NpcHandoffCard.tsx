/**
 * Batch 10 — NPC Handoff Card.
 * Shows linked internal-deal owner + last NPC activity, with a "Ping NPC owner"
 * action that writes a shared message tagged for handoff context.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Building2, Send, Clock, UserCog, Link2Off } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

const FN = 'finance-portal-batch9-10';

export function NpcHandoffCard({ purchaseFileId }: { purchaseFileId: string }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [pinging, setPinging] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['npc-handoff', purchaseFileId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction(FN, {
        operation: 'npc_handoff_info',
        purchase_file_id: purchaseFileId,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!purchaseFileId,
  });

  const ping = async () => {
    if (!msg.trim()) return;
    setPinging(true);
    const { error } = await invokeFinanceFunction(FN, {
      operation: 'npc_ping',
      purchase_file_id: purchaseFileId,
      message: msg,
    });
    setPinging(false);
    if (error) return toast.error('Ping failed');
    toast.success('Ping sent to NPC');
    setMsg('');
    setOpen(false);
    qc.invalidateQueries({ queryKey: ['npc-handoff', purchaseFileId] });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-primary" /> NPC Handoff
        </CardTitle>
        <CardDescription>Internal deal owner & last activity from NPC's side.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !data?.deal ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link2Off className="h-3 w-3" /> No internal deal linked yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">Deal</p>
                <p className="font-medium">{data.deal.deal_name ?? '—'}</p>
                <div className="flex gap-1 mt-1">
                  {data.deal.stage && <Badge variant="outline">{data.deal.stage}</Badge>}
                  {data.deal.status && <Badge variant="secondary">{data.deal.status}</Badge>}
                </div>
              </div>
              <div>
                <p className="text-muted-foreground flex items-center gap-1">
                  <UserCog className="h-3 w-3" /> NPC owner
                </p>
                <p className="font-medium">{data.npc_owner?.full_name ?? data.npc_owner?.email ?? 'Unassigned'}</p>
                {data.npc_owner?.email && (
                  <p className="text-muted-foreground text-[11px]">{data.npc_owner.email}</p>
                )}
              </div>
            </div>

            {data.last_npc_activity && (
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                <p className="flex items-center gap-1 text-muted-foreground mb-1">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(data.last_npc_activity.created_at), { addSuffix: true })}
                </p>
                <p className="font-medium">{data.last_npc_activity.action_type}</p>
                {data.last_npc_activity.description && (
                  <p className="text-muted-foreground line-clamp-2">{data.last_npc_activity.description}</p>
                )}
              </div>
            )}

            {!open ? (
              <Button size="sm" variant="outline" className="w-full" onClick={() => setOpen(true)}>
                <Send className="h-3 w-3 mr-1.5" /> Ping NPC owner
              </Button>
            ) : (
              <div className="space-y-2">
                <Textarea
                  placeholder="What do you need from NPC?"
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" className="flex-1" disabled={!msg.trim() || pinging} onClick={ping}>
                    {pinging && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Send ping
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
