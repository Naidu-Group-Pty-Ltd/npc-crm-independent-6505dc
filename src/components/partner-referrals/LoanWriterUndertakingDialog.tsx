import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Save } from 'lucide-react';
import {
  useLoanWriterUndertakingMutations,
  type LoanWriterUndertaking,
} from '@/hooks/useLoanWriterUndertakings';
import { useActiveAgreementOptions, useFinanceUserOptions } from '@/hooks/usePartnerReferrals';

const UNASSIGNED = '__unassigned__';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  undertaking?: LoanWriterUndertaking | null;
}

const EMPTY = {
  writer_full_name: '',
  writer_email: '',
  writer_phone: '',
  writer_entity_name: '',
  licensee_name: '',
  acl_number: '',
  crn: '',
  authorisation_end_date: '',
  effective_date: '',
  expiry_date: '',
  agreement_id: UNASSIGNED,
  finance_user_id: UNASSIGNED,
  notes: '',
};

export default function LoanWriterUndertakingDialog({ open, onOpenChange, undertaking }: Props) {
  const [form, setForm] = useState({ ...EMPTY });
  const { createUndertaking, updateUndertaking } = useLoanWriterUndertakingMutations();
  const { data: agreements = [] } = useActiveAgreementOptions('outbound_finance_referral');
  const { data: financeUsers = [] } = useFinanceUserOptions();

  useEffect(() => {
    if (!open) return;
    if (undertaking) {
      setForm({
        writer_full_name: undertaking.writer_full_name ?? '',
        writer_email: undertaking.writer_email ?? '',
        writer_phone: undertaking.writer_phone ?? '',
        writer_entity_name: undertaking.writer_entity_name ?? '',
        licensee_name: undertaking.licensee_name ?? '',
        acl_number: undertaking.acl_number ?? '',
        crn: undertaking.crn ?? '',
        authorisation_end_date: undertaking.authorisation_end_date ?? '',
        effective_date: undertaking.effective_date ?? '',
        expiry_date: undertaking.expiry_date ?? '',
        agreement_id: undertaking.agreement_id ?? UNASSIGNED,
        finance_user_id: undertaking.finance_user_id ?? UNASSIGNED,
        notes: undertaking.notes ?? '',
      });
    } else {
      setForm({ ...EMPTY });
    }
  }, [open, undertaking]);

  const set = (key: keyof typeof EMPTY, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const payload: Record<string, unknown> = {
      ...form,
      agreement_id: form.agreement_id === UNASSIGNED ? null : form.agreement_id,
      finance_user_id: form.finance_user_id === UNASSIGNED ? null : form.finance_user_id,
    };
    if (undertaking) await updateUndertaking.mutateAsync({ id: undertaking.id, ...payload } as never);
    else await createUndertaking.mutateAsync(payload as never);
    onOpenChange(false);
  };

  const saving = createUndertaking.isPending || updateUndertaking.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{undertaking ? `Undertaking ${undertaking.reference}` : 'New loan writer undertaking'}</DialogTitle>
          <DialogDescription>
            Annexure B binds the individual loan writer — not just their licensee — to the referral
            conduct and information-boundary obligations. A referral cannot be assigned without a live one.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 pb-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Loan writer full name *</Label>
                <Input value={form.writer_full_name} onChange={(e) => set('writer_full_name', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.writer_email} onChange={(e) => set('writer_email', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.writer_phone} onChange={(e) => set('writer_phone', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Writer entity / practice</Label>
                <Input value={form.writer_entity_name} onChange={(e) => set('writer_entity_name', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Licensee / ACL holder</Label>
                <Input value={form.licensee_name} onChange={(e) => set('licensee_name', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>ACL number</Label>
                <Input value={form.acl_number} onChange={(e) => set('acl_number', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Credit representative number (CRN)</Label>
                <Input value={form.crn} onChange={(e) => set('crn', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Effective date</Label>
                <Input type="date" value={form.effective_date} onChange={(e) => set('effective_date', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Expiry date</Label>
                <Input type="date" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Authorisation end date</Label>
                <Input
                  type="date"
                  value={form.authorisation_end_date}
                  onChange={(e) => set('authorisation_end_date', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The undertaking lapses automatically once this date passes.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Linked agreement</Label>
                <Select value={form.agreement_id} onValueChange={(v) => set('agreement_id', v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>None</SelectItem>
                    {agreements.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.partner_legal_name} (v{a.version})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Finance portal user</Label>
                <Select value={form.finance_user_id} onValueChange={(v) => set('finance_user_id', v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED}>None</SelectItem>
                    {financeUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.finance_agent_contacts?.name || u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !form.writer_full_name.trim()} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {undertaking ? 'Save changes' : 'Create undertaking'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
