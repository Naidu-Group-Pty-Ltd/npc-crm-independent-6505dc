import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { industrialApi, type IndustrialTenancy } from '@/hooks/useIndustrialProperties';

interface Props {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  tenancy?: IndustrialTenancy | null;
  onSaved: () => void;
}

const RECOVERY = [
  { value: 'net', label: 'Net (tenant pays outgoings)' },
  { value: 'gross', label: 'Gross' },
  { value: 'semi_gross', label: 'Semi-Gross' },
];

const REVIEW = [
  { value: 'cpi', label: 'CPI' },
  { value: 'fixed_percent', label: 'Fixed %' },
  { value: 'market', label: 'Market' },
  { value: 'hybrid', label: 'Hybrid (CPI + Fixed)' },
  { value: 'none', label: 'None' },
];

export function IndustrialTenancyFormModal({ open, onClose, propertyId, tenancy, onSaved }: Props) {
  const isEdit = !!tenancy;
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      tenant_name: tenancy?.tenant_name ?? '',
      anzsic_industry: tenancy?.anzsic_industry ?? '',
      unit_label: tenancy?.unit_label ?? '',
      gla_sqm: tenancy?.gla_sqm ?? '',
      lease_start: tenancy?.lease_start ?? '',
      lease_end: tenancy?.lease_end ?? '',
      base_rent_per_sqm_pa: tenancy?.base_rent_per_sqm_pa ?? '',
      base_rent_pa: tenancy?.base_rent_pa ?? '',
      outgoings_recovery_type: tenancy?.outgoings_recovery_type ?? 'net',
      annual_review_type: tenancy?.annual_review_type ?? 'cpi',
      review_rate_pct: tenancy?.review_rate_pct ?? '',
      option_terms_years: tenancy?.option_terms_years ?? '',
      bank_guarantee_months: tenancy?.bank_guarantee_months ?? '',
      incentive_pct: tenancy?.incentive_pct ?? '',
      make_good_status: tenancy?.make_good_status ?? '',
      notes: tenancy?.notes ?? '',
    });
  }, [tenancy, open]);

  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }));
  const num = (v: any) => v === '' || v == null ? null : Number(v);

  // Auto-compute rent on edit: if both per-sqm and gla provided, derive total
  const autoRentPa = () => {
    const perSqm = Number(form.base_rent_per_sqm_pa);
    const gla = Number(form.gla_sqm);
    if (perSqm > 0 && gla > 0) set('base_rent_pa', Number((perSqm * gla).toFixed(2)));
  };

  const handleSave = async () => {
    if (!form.tenant_name?.trim()) {
      toast({ title: 'Tenant name required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload: any = {
      property_id: propertyId,
      tenant_name: form.tenant_name,
      anzsic_industry: form.anzsic_industry || null,
      unit_label: form.unit_label || null,
      gla_sqm: num(form.gla_sqm),
      lease_start: form.lease_start || null,
      lease_end: form.lease_end || null,
      base_rent_per_sqm_pa: num(form.base_rent_per_sqm_pa),
      base_rent_pa: num(form.base_rent_pa),
      outgoings_recovery_type: form.outgoings_recovery_type,
      annual_review_type: form.annual_review_type,
      review_rate_pct: num(form.review_rate_pct),
      option_terms_years: num(form.option_terms_years),
      bank_guarantee_months: num(form.bank_guarantee_months),
      incentive_pct: num(form.incentive_pct),
      make_good_status: form.make_good_status || null,
      notes: form.notes || null,
    };
    const res = isEdit
      ? await industrialApi.updateTenancy(tenancy!.id, payload)
      : await industrialApi.createTenancy(payload);
    setSaving(false);
    if (res.error) {
      toast({ title: 'Save failed', description: res.error.message, variant: 'destructive' });
      return;
    }
    toast({ title: isEdit ? 'Tenancy updated' : 'Tenancy added' });
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
            <div className="col-span-2 space-y-2"><Label>Tenant Name *</Label><Input value={form.tenant_name} onChange={e => set('tenant_name', e.target.value)} /></div>
            <div className="space-y-2"><Label>ANZSIC Industry</Label><Input value={form.anzsic_industry} onChange={e => set('anzsic_industry', e.target.value)} placeholder="e.g. Logistics" /></div>
            <div className="space-y-2"><Label>Unit / Bay</Label><Input value={form.unit_label} onChange={e => set('unit_label', e.target.value)} /></div>
            <div className="space-y-2"><Label>GLA (m²)</Label><Input type="number" value={form.gla_sqm} onChange={e => set('gla_sqm', e.target.value)} onBlur={autoRentPa} /></div>
            <div className="space-y-2"><Label>Rent $/m²/PA</Label><Input type="number" step="0.01" value={form.base_rent_per_sqm_pa} onChange={e => set('base_rent_per_sqm_pa', e.target.value)} onBlur={autoRentPa} /></div>
            <div className="col-span-2 space-y-2"><Label>Base Rent PA ($)</Label><Input type="number" value={form.base_rent_pa} onChange={e => set('base_rent_pa', e.target.value)} /></div>
            <div className="space-y-2"><Label>Lease Start</Label><Input type="date" value={form.lease_start} onChange={e => set('lease_start', e.target.value)} /></div>
            <div className="space-y-2"><Label>Lease End</Label><Input type="date" value={form.lease_end} onChange={e => set('lease_end', e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Outgoings Recovery</Label>
              <Select value={form.outgoings_recovery_type} onValueChange={v => set('outgoings_recovery_type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RECOVERY.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Review Type</Label>
              <Select value={form.annual_review_type} onValueChange={v => set('annual_review_type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{REVIEW.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Review Rate (%)</Label><Input type="number" step="0.01" value={form.review_rate_pct} onChange={e => set('review_rate_pct', e.target.value)} /></div>
            <div className="space-y-2"><Label>Option Term (years)</Label><Input type="number" value={form.option_terms_years} onChange={e => set('option_terms_years', e.target.value)} /></div>
            <div className="space-y-2"><Label>Bank Guarantee (months)</Label><Input type="number" step="0.5" value={form.bank_guarantee_months} onChange={e => set('bank_guarantee_months', e.target.value)} /></div>
            <div className="space-y-2"><Label>Incentive (%)</Label><Input type="number" step="0.01" value={form.incentive_pct} onChange={e => set('incentive_pct', e.target.value)} /></div>
            <div className="col-span-2 space-y-2"><Label>Make-Good Status</Label><Input value={form.make_good_status} onChange={e => set('make_good_status', e.target.value)} placeholder="e.g. Painted shell" /></div>
            <div className="col-span-2 space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} /></div>
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
