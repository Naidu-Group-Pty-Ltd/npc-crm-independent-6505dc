import { useMemo, useState } from 'react';
import { Coins, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatCurrency, formatMatterDate } from '@/lib/legalMatters';
import {
  DISBURSEMENT_STATUS_CLASSES, DISBURSEMENT_STATUS_LABELS, DISBURSEMENT_STATUS_OPTIONS,
  type LegalDisbursementStatus, type LegalMatterDisbursement,
} from '@/lib/legalDocuments';

export interface DisbursementDraft {
  id: string | null;
  label: string;
  category: string;
  amount: string;
  gst_amount: string;
  payable_to: string;
  status: LegalDisbursementStatus;
  incurred_on: string;
  paid_on: string;
  invoice_reference: string;
  include_in_settlement: boolean;
  visible_to_client: boolean;
  notes: string;
}

const EMPTY_DISBURSEMENT: DisbursementDraft = {
  id: null,
  label: '',
  category: '',
  amount: '',
  gst_amount: '',
  payable_to: '',
  status: 'estimated',
  incurred_on: '',
  paid_on: '',
  invoice_reference: '',
  include_in_settlement: true,
  visible_to_client: false,
  notes: '',
};

export interface MatterDisbursementsPanelProps {
  disbursements: LegalMatterDisbursement[];
  canEdit: boolean;
  canDelete: boolean;
  saving?: boolean;
  onSave: (draft: DisbursementDraft) => Promise<void> | void;
  onDelete: (disbursementId: string) => Promise<void> | void;
}

export function MatterDisbursementsPanel({
  disbursements, canEdit, canDelete, saving, onSave, onDelete,
}: MatterDisbursementsPanelProps) {
  const [draft, setDraft] = useState<DisbursementDraft | null>(null);

  const totals = useMemo(() => {
    const gross = disbursements.reduce((s, d) => s + Number(d.amount || 0) + Number(d.gst_amount || 0), 0);
    const unpaid = disbursements
      .filter((d) => d.status !== 'paid' && d.status !== 'waived')
      .reduce((s, d) => s + Number(d.amount || 0) + Number(d.gst_amount || 0), 0);
    return { gross, unpaid };
  }, [disbursements]);

  const openEdit = (d?: LegalMatterDisbursement) => {
    setDraft(d
      ? {
          id: d.id,
          label: d.label,
          category: d.category ?? '',
          amount: String(d.amount ?? ''),
          gst_amount: String(d.gst_amount ?? ''),
          payable_to: d.payable_to ?? '',
          status: d.status,
          incurred_on: (d.incurred_on ?? '').slice(0, 10),
          paid_on: (d.paid_on ?? '').slice(0, 10),
          invoice_reference: d.invoice_reference ?? '',
          include_in_settlement: d.include_in_settlement,
          visible_to_client: d.visible_to_client,
          notes: d.notes ?? '',
        }
      : { ...EMPTY_DISBURSEMENT });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Disbursements</CardTitle>
          <CardDescription>
            {formatCurrency(totals.gross)} recorded · {formatCurrency(totals.unpaid)} still outstanding.
          </CardDescription>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => openEdit()}>
            <Plus className="mr-2 h-4 w-4" /> Add disbursement
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {disbursements.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No disbursements recorded yet.
          </p>
        ) : null}

        {disbursements.map((d) => (
          <div
            key={d.id}
            className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{d.label}</span>
                <Badge variant="outline" className={cn('text-xs', DISBURSEMENT_STATUS_CLASSES[d.status])}>
                  {DISBURSEMENT_STATUS_LABELS[d.status]}
                </Badge>
                {d.include_in_settlement ? (
                  <Badge variant="outline" className="text-xs">On settlement statement</Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(Number(d.amount || 0) + Number(d.gst_amount || 0))}
                {Number(d.gst_amount || 0) > 0 ? ` (incl. ${formatCurrency(d.gst_amount)} GST)` : ''}
                {d.payable_to ? ` · payable to ${d.payable_to}` : ''}
                {d.incurred_on ? ` · incurred ${formatMatterDate(d.incurred_on)}` : ''}
                {d.paid_on ? ` · paid ${formatMatterDate(d.paid_on)}` : ''}
                {d.invoice_reference ? ` · inv ${d.invoice_reference}` : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canEdit ? (
                <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => openEdit(d)}>
                  <Pencil className="h-4 w-4" aria-label={`Edit ${d.label}`} />
                </Button>
              ) : null}
              {canDelete ? (
                <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => void onDelete(d.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" aria-label={`Remove ${d.label}`} />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit disbursement' : 'Add disbursement'}</DialogTitle>
            <DialogDescription>Search fees, certificates and outlays for this matter.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="disb-label">Label</Label>
                <Input
                  id="disb-label" value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="disb-amount">Amount (ex GST)</Label>
                  <Input
                    id="disb-amount" inputMode="decimal" value={draft.amount}
                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="disb-gst">GST</Label>
                  <Input
                    id="disb-gst" inputMode="decimal" value={draft.gst_amount}
                    onChange={(e) => setDraft({ ...draft, gst_amount: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="disb-payable">Payable to</Label>
                  <Input
                    id="disb-payable" value={draft.payable_to}
                    onChange={(e) => setDraft({ ...draft, payable_to: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Status</Label>
                  <Select
                    value={draft.status}
                    onValueChange={(v) => setDraft({ ...draft, status: v as LegalDisbursementStatus })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DISBURSEMENT_STATUS_OPTIONS.map((v) => (
                        <SelectItem key={v} value={v}>{DISBURSEMENT_STATUS_LABELS[v]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="disb-incurred">Incurred on</Label>
                  <Input
                    id="disb-incurred" type="date" value={draft.incurred_on}
                    onChange={(e) => setDraft({ ...draft, incurred_on: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="disb-paid">Paid on</Label>
                  <Input
                    id="disb-paid" type="date" value={draft.paid_on}
                    onChange={(e) => setDraft({ ...draft, paid_on: e.target.value })}
                  />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="disb-invoice">Invoice reference</Label>
                  <Input
                    id="disb-invoice" value={draft.invoice_reference}
                    onChange={(e) => setDraft({ ...draft, invoice_reference: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="disb-notes">Notes</Label>
                <Textarea
                  id="disb-notes" rows={3} value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="disb-settlement">Include on settlement statement</Label>
                  <p className="text-xs text-muted-foreground">Adds this outlay to settlement adjustments.</p>
                </div>
                <Switch
                  id="disb-settlement" checked={draft.include_in_settlement}
                  onCheckedChange={(v) => setDraft({ ...draft, include_in_settlement: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <Label htmlFor="disb-client">Share with client</Label>
                  <p className="text-xs text-muted-foreground">Visible in the Client Portal.</p>
                </div>
                <Switch
                  id="disb-client" checked={draft.visible_to_client}
                  onCheckedChange={(v) => setDraft({ ...draft, visible_to_client: v })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              disabled={saving || !draft?.label.trim()}
              onClick={async () => {
                if (!draft) return;
                await onSave(draft);
                setDraft(null);
              }}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default MatterDisbursementsPanel;
