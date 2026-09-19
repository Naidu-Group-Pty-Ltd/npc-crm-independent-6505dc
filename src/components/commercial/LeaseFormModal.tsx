import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { commercialApi, type CommercialLease, type LeaseStatus, type RentBasis, type ReviewType, type SecurityType } from '@/hooks/useCommercialProperties';

interface Props {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  lease?: CommercialLease | null;
  onSaved: () => void;
}

const RENT_BASIS: { value: RentBasis; label: string }[] = [
  { value: 'net', label: 'Net' }, { value: 'gross', label: 'Gross' }, { value: 'semi_gross', label: 'Semi-Gross' },
];
const REVIEW_TYPE: { value: ReviewType; label: string }[] = [
  { value: 'cpi', label: 'CPI' }, { value: 'fixed_percent', label: 'Fixed %' },
  { value: 'market', label: 'Market' }, { value: 'hybrid', label: 'Hybrid' }, { value: 'none', label: 'None' },
];
const STATUS: { value: LeaseStatus; label: string }[] = [
  { value: 'occupied', label: 'Occupied' }, { value: 'vacant', label: 'Vacant' },
  { value: 'holdover', label: 'Holdover' }, { value: 'under_offer', label: 'Under Offer' }, { value: 'expired', label: 'Expired' },
];
const SECURITY: { value: SecurityType; label: string }[] = [
  { value: 'none', label: 'None' }, { value: 'bond', label: 'Bond' },
  { value: 'bank_guarantee', label: 'Bank Guarantee' }, { value: 'personal_guarantee', label: 'Personal Guarantee' },
];

export function LeaseFormModal({ open, onClose, propertyId, lease, onSaved }: Props) {
  const isEdit = !!lease;
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      tenant_name: lease?.tenant_name ?? '',
      suite_unit: lease?.suite_unit ?? '',
      nla_sqm: lease?.nla_sqm ?? '',
      lease_start: lease?.lease_start ?? '',
      lease_end: lease?.lease_end ?? '',
      base_rent_pa: lease?.base_rent_pa ?? '',
      rent_basis: lease?.rent_basis ?? 'net',
      review_type: lease?.review_type ?? 'cpi',
      review_freq_months: lease?.review_freq_months ?? 12,
      next_review_date: lease?.next_review_date ?? '',
      review_amount: lease?.review_amount ?? '',
      rent_free_months: lease?.rent_free_months ?? 0,
      fitout_contribution: lease?.fitout_contribution ?? 0,
      cash_incentive: lease?.cash_incentive ?? 0,
      outgoings_recovery_pct: lease?.outgoings_recovery_pct ?? 0,
      security_type: lease?.security_type ?? 'none',
      security_amount: lease?.security_amount ?? 0,
      status: lease?.status ?? 'occupied',
      notes: lease?.notes ?? '',
    });
  }, [lease, open]);

  const set = (k: string, v: any) => setForm((prev: any) => ({ ...prev, [k]: v }));
  const num = (v: any) => v === '' || v == null ? null : Number(v);

  const handleSave = async () => {
    if (!form.tenant_name?.trim()) {
      toast({ title: 'Tenant name required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload: any = {
      property_id: propertyId,
      tenant_name: form.tenant_name,
      suite_unit: form.suite_unit || null,
      nla_sqm: num(form.nla_sqm),
      lease_start: form.lease_start || null,
      lease_end: form.lease_end || null,
      base_rent_pa: Number(form.base_rent_pa) || 0,
      rent_basis: form.rent_basis,
      review_type: form.review_type,
      review_freq_months: num(form.review_freq_months),
      next_review_date: form.next_review_date || null,
      review_amount: num(form.review_amount),
      rent_free_months: num(form.rent_free_months) ?? 0,
      fitout_contribution: num(form.fitout_contribution) ?? 0,
      cash_incentive: num(form.cash_incentive) ?? 0,
      outgoings_recovery_pct: num(form.outgoings_recovery_pct) ?? 0,
      security_type: form.security_type,
      security_amount: num(form.security_amount) ?? 0,
      status: form.status,
      notes: form.notes || null,
    };
    const res = isEdit
      ? await commercialApi.updateLease(lease!.id, payload)
      : await commercialApi.createLease(payload);
    setSaving(false);
    if (res.error) {
      toast({ title: 'Save failed', description: res.error.message, variant: 'destructive' });
      return;
    }
    toast({ title: isEdit ? 'Lease updated' : 'Lease added' });
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{isEdit ? 'Edit Tenancy' : 'Add Tenancy'}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 px-6">
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="col-span-2 space-y-2">
              <Label>Tenant Name *</Label>
              <Input value={form.tenant_name} onChange={(e) => set('tenant_name', e.target.value)} />
            </div>
            <div className="space-y-2"><Label>Suite / Unit</Label><Input value={form.suite_unit} onChange={e => set('suite_unit', e.target.value)} /></div>
            <div className="space-y-2"><Label>NLA (m²)</Label><Input type="number" value={form.nla_sqm} onChange={e => set('nla_sqm', e.target.value)} /></div>
            <div className="space-y-2"><Label>Lease Start</Label><Input type="date" value={form.lease_start} onChange={e => set('lease_start', e.target.value)} /></div>
            <div className="space-y-2"><Label>Lease End</Label><Input type="date" value={form.lease_end} onChange={e => set('lease_end', e.target.value)} /></div>
            <div className="space-y-2"><Label>Base Rent (PA $)</Label><Input type="number" value={form.base_rent_pa} onChange={e => set('base_rent_pa', e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Rent Basis</Label>
              <Select value={form.rent_basis} onValueChange={v => set('rent_basis', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RENT_BASIS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Review Type</Label>
              <Select value={form.review_type} onValueChange={v => set('review_type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{REVIEW_TYPE.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Review Freq (months)</Label><Input type="number" value={form.review_freq_months} onChange={e => set('review_freq_months', e.target.value)} /></div>
            <div className="space-y-2"><Label>Next Review Date</Label><Input type="date" value={form.next_review_date} onChange={e => set('next_review_date', e.target.value)} /></div>
            <div className="space-y-2"><Label>Review Amount (%)</Label><Input type="number" step="0.01" value={form.review_amount} onChange={e => set('review_amount', e.target.value)} /></div>
            <div className="space-y-2"><Label>Outgoings Recovery (%)</Label><Input type="number" step="0.01" value={form.outgoings_recovery_pct} onChange={e => set('outgoings_recovery_pct', e.target.value)} /></div>
            <div className="space-y-2"><Label>Rent Free (months)</Label><Input type="number" value={form.rent_free_months} onChange={e => set('rent_free_months', e.target.value)} /></div>
            <div className="space-y-2"><Label>Fitout Contribution ($)</Label><Input type="number" value={form.fitout_contribution} onChange={e => set('fitout_contribution', e.target.value)} /></div>
            <div className="space-y-2"><Label>Cash Incentive ($)</Label><Input type="number" value={form.cash_incentive} onChange={e => set('cash_incentive', e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Security Type</Label>
              <Select value={form.security_type} onValueChange={v => set('security_type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SECURITY.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Security Amount ($)</Label><Input type="number" value={form.security_amount} onChange={e => set('security_amount', e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => set('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </ScrollArea>
        <DialogFooter className="px-6 pb-6">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Tenancy'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
