import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Link2, Unlink, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';

interface Props {
  fileId: string;
  clientId: string;
  file: any;
  linkedDeal: any | null;
  onChange: () => void;
}

function fmtMoney(n: any) {
  if (n == null || isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number(n));
}

function normAddr(s?: string | null) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function InternalDealLinkCard({ fileId, clientId, file, linkedDeal, onChange }: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const drift = linkedDeal
    ? {
        address: normAddr(file.property_address) !== normAddr(linkedDeal.property_address),
        price:
          file.purchase_price != null && linkedDeal.total_contract_price != null &&
          Math.abs(Number(file.purchase_price) - Number(linkedDeal.total_contract_price)) > 5000,
        settlement:
          file.settlement_date && linkedDeal.settlement_date &&
          file.settlement_date !== linkedDeal.settlement_date,
      }
    : null;

  const hasDrift = drift && (drift.address || drift.price || drift.settlement);

  async function unlink() {
    if (!confirm('Unlink this internal deal from the purchase file?')) return;
    setBusy(true);
    try {
      const { error } = await invokeFinanceFunction('finance-portal-purchase-files', {
        operation: 'unlink_deal', file_id: fileId,
      });
      if (error) throw new Error(error.message);
      toast.success('Unlinked');
      onChange();
    } catch (e: any) {
      toast.error(e.message || 'Failed to unlink');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4" /> Internal Deal (Command Centre)
        </CardTitle>
        {linkedDeal ? (
          <Button variant="ghost" size="sm" onClick={unlink} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5 mr-1" />}
            Unlink
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <Link2 className="h-3.5 w-3.5 mr-1" /> Link to existing deal
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!linkedDeal ? (
          <p className="text-sm text-muted-foreground">
            Not linked to an internal deal. Linking surfaces build payments, stages and commission from Command Centre,
            and prevents duplicate records for the same property.
          </p>
        ) : (
          <div className="space-y-3">
            {hasDrift && (
              <div className="flex items-start gap-2 p-2 rounded border border-brand-500/40 bg-brand-500/5 text-xs">
                <AlertTriangle className="h-4 w-4 text-brand-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-brand-500">Drift detected</p>
                  <p className="text-muted-foreground">
                    {drift?.address && 'Address mismatch · '}
                    {drift?.price && 'Price >$5k difference · '}
                    {drift?.settlement && 'Settlement date differs'}
                    . Pick a canonical source and edit the other side.
                  </p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Deal type</p>
                <p className="font-medium capitalize">{linkedDeal.deal_type?.replace(/_/g, ' ') || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Current stage</p>
                <p className="font-medium">{linkedDeal.current_stage || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Risk</p>
                <Badge variant="outline" className="capitalize">{(linkedDeal.risk_status || 'on_track').replace(/_/g, ' ')}</Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Contract price</p>
                <p className="font-medium">{fmtMoney(linkedDeal.total_contract_price)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Settlement</p>
                <p className="font-medium">{linkedDeal.settlement_date || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Build payments</p>
                <p className="font-medium">{linkedDeal.build_payments_paid}/{linkedDeal.build_payments_total}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Stages</p>
                <p className="font-medium">{linkedDeal.stage_count}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Commission est.</p>
                <p className="font-medium">{fmtMoney(linkedDeal.commission_estimate)}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground italic">
              Read-only view. Edit in Command Centre.
            </p>
          </div>
        )}
      </CardContent>

      {pickerOpen && (
        <CandidateDealPicker
          fileId={fileId}
          clientId={clientId}
          onClose={() => setPickerOpen(false)}
          onLinked={() => { setPickerOpen(false); onChange(); }}
        />
      )}
    </Card>
  );
}

function CandidateDealPicker({
  fileId, clientId, onClose, onLinked,
}: { fileId: string; clientId: string; onClose: () => void; onLinked: () => void }) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['fp-candidate-deals', clientId],
    queryFn: async () => {
      const { data, error } = await invokeFinanceFunction('finance-portal-purchase-files', {
        operation: 'list_candidate_deals', client_id: clientId,
      });
      if (error) throw new Error(error.message);
      return data?.deals || [];
    },
  });

  async function link() {
    if (!selected) return;
    setBusy(true);
    try {
      const { error } = await invokeFinanceFunction('finance-portal-purchase-files', {
        operation: 'link_to_deal', file_id: fileId, client_deal_id: selected,
      });
      if (error) throw new Error(error.message);
      toast.success('Linked to internal deal');
      onLinked();
    } catch (e: any) {
      toast.error(e.message || 'Failed to link');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link to internal deal</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground p-4">Loading…</p>}
          {!isLoading && (data || []).length === 0 && (
            <p className="text-sm text-muted-foreground p-4">No internal deals exist for this client yet.</p>
          )}
          {(data || []).map((d: any) => {
            const isLinkedElsewhere = d.purchase_file_id && d.purchase_file_id !== fileId;
            return (
              <button
                key={d.id}
                disabled={isLinkedElsewhere}
                onClick={() => setSelected(d.id)}
                className={`w-full text-left p-3 rounded border transition ${
                  selected === d.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                } ${isLinkedElsewhere ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium capitalize">{(d.deal_type || '').replace(/_/g, ' ')} — {d.current_stage || 'No stage'}</p>
                    <p className="text-xs text-muted-foreground">{d.property_address || 'No address'}</p>
                  </div>
                  <div className="text-right text-xs">
                    <p>{fmtMoney(d.total_contract_price)}</p>
                    <p className="text-muted-foreground">{d.settlement_date || '—'}</p>
                  </div>
                </div>
                {isLinkedElsewhere && (
                  <p className="text-xs text-brand-500 mt-1">Already linked to another purchase file</p>
                )}
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={link} disabled={!selected || busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Link deal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
