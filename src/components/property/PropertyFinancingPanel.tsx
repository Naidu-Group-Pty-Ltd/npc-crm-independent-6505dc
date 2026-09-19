/**
 * Shared financing panel for commercial + industrial property detail pages.
 * One-to-one with property; render a single form that creates/updates a row.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export interface PropertyFinancingValues {
  id?: string;
  property_id: string;
  lender?: string | null;
  loan_amount?: number | null;
  loan_balance?: number | null;
  interest_rate?: number | null;
  loan_term_years?: number | null;
  io_period_years?: number | null;
  repayment_type?: 'pi' | 'io' | 'pi_after_io' | null;
  lvr_pct?: number | null;
  upfront_fees?: number | null;
  ongoing_fees_pa?: number | null;
  rate_type?: 'variable' | 'fixed' | null;
  notes?: string | null;
}

interface Props {
  propertyId: string;
  value: PropertyFinancingValues | null;
  loading: boolean;
  onSave: (data: Partial<PropertyFinancingValues>) => Promise<{ error?: { message: string } | null }>;
  title?: string;
}

const NUMERIC_KEYS: (keyof PropertyFinancingValues)[] = [
  'loan_amount', 'loan_balance', 'interest_rate',
  'loan_term_years', 'io_period_years', 'lvr_pct',
  'upfront_fees', 'ongoing_fees_pa',
];

export function PropertyFinancingPanel({ propertyId, value, loading, onSave, title = 'Financing' }: Props) {
  const [form, setForm] = useState<Partial<PropertyFinancingValues>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(value ? { ...value } : { property_id: propertyId });
  }, [value, propertyId]);

  const update = (k: keyof PropertyFinancingValues, v: any) => {
    if (NUMERIC_KEYS.includes(k)) {
      setForm(prev => ({ ...prev, [k]: v === '' ? null : Number(v) }));
    } else {
      setForm(prev => ({ ...prev, [k]: v === '' ? null : v }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...form, property_id: propertyId };
    const res = await onSave(payload);
    setSaving(false);
    if (res.error) toast({ title: 'Save failed', description: res.error.message, variant: 'destructive' });
    else toast({ title: 'Financing saved' });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 mx-auto animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label>Lender</Label>
            <Input value={form.lender ?? ''} onChange={e => update('lender', e.target.value)} placeholder="e.g. CBA" />
          </div>
          <div>
            <Label>Loan Amount ($)</Label>
            <Input type="number" value={form.loan_amount ?? ''} onChange={e => update('loan_amount', e.target.value)} />
          </div>
          <div>
            <Label>Current Balance ($)</Label>
            <Input type="number" value={form.loan_balance ?? ''} onChange={e => update('loan_balance', e.target.value)} />
          </div>
          <div>
            <Label>Interest Rate (%)</Label>
            <Input type="number" step="0.01" value={form.interest_rate ?? ''} onChange={e => update('interest_rate', e.target.value)} />
          </div>
          <div>
            <Label>Rate Type</Label>
            <Select value={form.rate_type ?? '__unassigned__'} onValueChange={v => update('rate_type', v === '__unassigned__' ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__unassigned__">—</SelectItem>
                <SelectItem value="variable">Variable</SelectItem>
                <SelectItem value="fixed">Fixed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Loan Term (yrs)</Label>
            <Input type="number" value={form.loan_term_years ?? ''} onChange={e => update('loan_term_years', e.target.value)} />
          </div>
          <div>
            <Label>Repayment Type</Label>
            <Select value={form.repayment_type ?? '__unassigned__'} onValueChange={v => update('repayment_type', v === '__unassigned__' ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__unassigned__">—</SelectItem>
                <SelectItem value="pi">Principal &amp; Interest</SelectItem>
                <SelectItem value="io">Interest Only</SelectItem>
                <SelectItem value="pi_after_io">IO then P&amp;I</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>IO Period (yrs)</Label>
            <Input type="number" value={form.io_period_years ?? ''} onChange={e => update('io_period_years', e.target.value)} />
          </div>
          <div>
            <Label>LVR (%)</Label>
            <Input type="number" step="0.01" value={form.lvr_pct ?? ''} onChange={e => update('lvr_pct', e.target.value)} />
          </div>
          <div>
            <Label>Upfront Fees ($)</Label>
            <Input type="number" value={form.upfront_fees ?? ''} onChange={e => update('upfront_fees', e.target.value)} />
          </div>
          <div>
            <Label>Ongoing Fees p.a. ($)</Label>
            <Input type="number" value={form.ongoing_fees_pa ?? ''} onChange={e => update('ongoing_fees_pa', e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea rows={3} value={form.notes ?? ''} onChange={e => update('notes', e.target.value)} />
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            {value?.id ? 'Update Financing' : 'Save Financing'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
