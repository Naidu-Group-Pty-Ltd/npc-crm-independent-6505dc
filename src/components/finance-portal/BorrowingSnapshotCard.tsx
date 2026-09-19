/**
 * Phase 5 — Borrowing-capacity snapshot card (manual entry, per purchase file).
 */
import { useEffect, useState } from 'react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calculator, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

const FIELDS: { key: string; label: string; type?: string; suffix?: string }[] = [
  { key: 'gross_annual_income',         label: 'Gross annual income',         type: 'number', suffix: '$/yr' },
  { key: 'shaded_annual_income',        label: 'Shaded annual income',        type: 'number', suffix: '$/yr' },
  { key: 'living_expenses_monthly',     label: 'Living expenses (monthly)',   type: 'number', suffix: '$/mo' },
  { key: 'existing_commitments_monthly',label: 'Existing commitments (monthly)', type: 'number', suffix: '$/mo' },
  { key: 'assessment_rate',             label: 'Assessment rate',             type: 'number', suffix: '%' },
  { key: 'loan_term_years',             label: 'Loan term',                   type: 'number', suffix: 'yrs' },
  { key: 'borrowing_capacity',          label: 'Borrowing capacity',          type: 'number', suffix: '$' },
  { key: 'net_purchase_capacity',       label: 'Net purchase capacity',       type: 'number', suffix: '$' },
  { key: 'dti_ratio',                   label: 'DTI ratio',                   type: 'number', suffix: 'x' },
  { key: 'monthly_surplus',             label: 'Monthly surplus',             type: 'number', suffix: '$/mo' },
  { key: 'serviceability_band',         label: 'Serviceability band' },
];

interface Props {
  fileId: string;
  snapshot: Record<string, any> | null;
  updatedAt?: string | null;
}

export function BorrowingSnapshotCard({ fileId, snapshot, updatedAt }: Props) {
  const { invokeFinanceFunction } = useFinancePortalAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, any>>(snapshot || {});
  const [busy, setBusy] = useState(false);

  useEffect(() => { setForm(snapshot || {}); }, [snapshot, fileId]);

  const save = async () => {
    setBusy(true);
    const payload: Record<string, any> = {};
    for (const f of FIELDS) {
      const v = form[f.key];
      if (v === '' || v === null || v === undefined) continue;
      payload[f.key] = f.type === 'number' ? Number(v) : v;
    }
    if (form.notes) payload.notes = form.notes;
    const { error } = await invokeFinanceFunction('finance-portal-deal-trackers', {
      operation: 'update_borrowing_snapshot', purchase_file_id: fileId, payload,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Borrowing snapshot saved');
    qc.invalidateQueries({ queryKey: ['pf-detail', fileId] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5 text-primary" />Borrowing capacity snapshot</CardTitle>
        {updatedAt && <p className="text-xs text-muted-foreground">Updated {new Date(updatedAt).toLocaleString('en-AU')}</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map(f => (
            <div key={f.key} className="space-y-1">
              <Label className="text-xs">{f.label}{f.suffix ? ` (${f.suffix})` : ''}</Label>
              <Input
                type={f.type || 'text'}
                value={form[f.key] ?? ''}
                onChange={(e) => setForm(p => ({ ...p, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Notes</Label>
          <Textarea rows={2} value={form.notes ?? ''} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} />
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save snapshot'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
