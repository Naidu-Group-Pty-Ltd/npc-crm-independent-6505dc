import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Bell, Plus, Trash2 } from 'lucide-react';
import { useLenderRateAlerts, LenderRateAlert } from '@/hooks/useLenderRateAlerts';
import { useBankLendingRates } from '@/hooks/useBankLendingRates';
import { LenderCombobox } from '@/components/clients/LenderCombobox';

export function LenderRateAlertManager() {
  const { alerts, isLoading, create, toggle, remove } = useLenderRateAlerts();
  const { ratesSummary } = useBankLendingRates();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    lender_name: string;
    threshold_rate: string;
    loan_purpose: 'OWNER_OCCUPIED' | 'INVESTMENT' | '__unassigned__';
    repayment_type: 'PRINCIPAL_AND_INTEREST' | 'INTEREST_ONLY' | '__unassigned__';
  }>({
    lender_name: '',
    threshold_rate: '',
    loan_purpose: '__unassigned__',
    repayment_type: '__unassigned__',
  });

  const submit = () => {
    const lender = ratesSummary?.find(r => r.lenderName === form.lender_name);
    const lender_id = lender?.lenderId || form.lender_name.toLowerCase().replace(/\s+/g, '-');
    const threshold = parseFloat(form.threshold_rate);
    if (!form.lender_name || isNaN(threshold)) return;
    create({
      lender_id,
      lender_name: form.lender_name,
      threshold_rate: threshold,
      loan_purpose: form.loan_purpose === '__unassigned__' ? null : form.loan_purpose,
      repayment_type: form.repayment_type === '__unassigned__' ? null : form.repayment_type,
    });
    setOpen(false);
    setForm({ lender_name: '', threshold_rate: '', loan_purpose: '__unassigned__', repayment_type: '__unassigned__' });
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="h-4 w-4" /> Rate alerts
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New alert</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create rate alert</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Lender</Label>
                <LenderCombobox value={form.lender_name} onChange={(v) => setForm(f => ({ ...f, lender_name: v }))} />
              </div>
              <div>
                <Label className="text-xs">Notify when rate drops below (%)</Label>
                <Input
                  type="number" step="0.01" placeholder="5.50"
                  value={form.threshold_rate}
                  onChange={(e) => setForm(f => ({ ...f, threshold_rate: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Purpose</Label>
                  <Select value={form.loan_purpose} onValueChange={(v) => setForm(f => ({ ...f, loan_purpose: v as any }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassigned__">Any</SelectItem>
                      <SelectItem value="OWNER_OCCUPIED">Owner-Occupied</SelectItem>
                      <SelectItem value="INVESTMENT">Investment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Repayment</Label>
                  <Select value={form.repayment_type} onValueChange={(v) => setForm(f => ({ ...f, repayment_type: v as any }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassigned__">Any</SelectItem>
                      <SelectItem value="PRINCIPAL_AND_INTEREST">P&amp;I</SelectItem>
                      <SelectItem value="INTEREST_ONLY">Interest Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={!form.lender_name || !form.threshold_rate}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading...</div>
        ) : alerts.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No alerts yet. Create one to get notified when a lender's rate drops below your target.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {alerts.map((a: LenderRateAlert) => (
              <div key={a.id} className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Switch checked={a.is_enabled} onCheckedChange={() => toggle(a.id)} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{a.lender_name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>Below {a.threshold_rate.toFixed(2)}%</span>
                      {a.loan_purpose && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{a.loan_purpose === 'OWNER_OCCUPIED' ? 'OO' : 'INV'}</Badge>}
                      {a.repayment_type && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{a.repayment_type === 'PRINCIPAL_AND_INTEREST' ? 'P&I' : 'IO'}</Badge>}
                      {a.last_triggered_at && <span>· last fired {new Date(a.last_triggered_at).toLocaleDateString('en-AU')}</span>}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(a.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
