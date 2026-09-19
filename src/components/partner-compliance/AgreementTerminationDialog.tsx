import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, AlertTriangle, Gavel } from 'lucide-react';
import { useTerminationWorkflow, type AccruedEntitlements } from '@/hooks/usePartnerCompliance';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agreementId: string | null;
  agreementLabel: string;
}

const currency = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);

export default function AgreementTerminationDialog({ open, onOpenChange, agreementId, agreementLabel }: Props) {
  const { preview, execute } = useTerminationWorkflow();
  const [entitlements, setEntitlements] = useState<AccruedEntitlements | null>(null);
  const [openReferrals, setOpenReferrals] = useState<number>(0);
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [cutoffDate, setCutoffDate] = useState('');

  useEffect(() => {
    if (!open || !agreementId) return;
    setEntitlements(null);
    preview.mutate(agreementId, {
      onSuccess: (res: any) => {
        setEntitlements(res.accrued ?? null);
        setOpenReferrals(res.open_referrals ?? 0);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agreementId]);


  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreementId) return;
    execute.mutate(
      {
        id: agreementId,
        termination_reason: reason.trim(),
        termination_effective_date: effectiveDate,
        post_termination_cutoff_date: cutoffDate || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const hasOutstanding =
    !!entitlements &&
    (entitlements.pending_commission_count > 0 ||
      entitlements.unpaid_statement_count > 0 ||
      entitlements.open_clawback_count > 0 ||
      entitlements.open_dispute_count > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5 text-primary" />
            Terminate agreement
          </DialogTitle>
          <DialogDescription>{agreementLabel}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex-1 flex flex-col min-h-0">
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4">
              {preview.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Calculating accrued entitlements…
                </div>
              )}

              {entitlements && (
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                  <p className="text-sm font-semibold">Accrued entitlements at termination</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Pending commissions</p>
                      <p className="font-semibold">
                        {currency(entitlements.pending_commission_total)}{' '}
                        <span className="text-muted-foreground font-normal">({entitlements.pending_commission_count})</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Unpaid statements</p>
                      <p className="font-semibold">
                        {currency(entitlements.unpaid_statement_total)}{' '}
                        <span className="text-muted-foreground font-normal">({entitlements.unpaid_statement_count})</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Open clawbacks</p>
                      <p className="font-semibold">
                        {currency(entitlements.open_clawback_total)}{' '}
                        <span className="text-muted-foreground font-normal">({entitlements.open_clawback_count})</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Open disputes</p>
                      <p className="font-semibold">{entitlements.open_dispute_count}</p>
                    </div>
                  </div>
                  {openReferrals > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{openReferrals}</span> open referral(s) remain on
                      this agreement and will continue under the post-termination entitlement terms.
                    </p>
                  )}

                </div>
              )}

              {hasOutstanding && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Survival obligations apply</AlertTitle>
                  <AlertDescription>
                    Accrued entitlements survive termination. The snapshot above is stored on the agreement and must be
                    settled before the record can be destroyed.
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="t-eff">Termination effective date *</Label>
                  <Input
                    id="t-eff" type="date" required
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="t-cut">Post-termination referral cut-off</Label>
                  <Input
                    id="t-cut" type="date"
                    value={cutoffDate}
                    onChange={(e) => setCutoffDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="t-reason">Termination reason *</Label>
                <Textarea
                  id="t-reason" rows={4} required minLength={5} maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Clause reference and reason for termination"
                />
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={execute.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={execute.isPending} className="gap-2">
              {execute.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gavel className="h-4 w-4" />}
              Terminate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
