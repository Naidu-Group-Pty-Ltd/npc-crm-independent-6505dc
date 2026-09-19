import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, Loader2, Trash2, Edit, CreditCard, Home, Car, GraduationCap, DollarSign } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { usePortalUpdateData } from '@/hooks/usePortalData';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { portalPanelClassName, portalStatCardClassName } from '@/components/portal/PortalSurface';

interface PortalLiabilityFormProps {
  existingLiabilities: any[];
  onRefresh: () => void;
}

interface LiabilityFormData {
  liability_type: string;
  provider_name: string;
  current_balance: number;
  credit_limit: number;
  interest_rate: number;
  monthly_repayment: number;
  repayment_type: string;
}

const liabilityTypeOptions = [
  { value: 'mortgage', label: 'Mortgage/Home Loan', icon: Home },
  { value: 'credit_card', label: 'Credit Card', icon: CreditCard },
  { value: 'personal_loan', label: 'Personal Loan', icon: DollarSign },
  { value: 'vehicle_loan', label: 'Vehicle Loan', icon: Car },
  { value: 'student_loan', label: 'HECS/HELP', icon: GraduationCap },
  { value: 'other', label: 'Other', icon: DollarSign },
];

const repaymentTypeOptions = [
  { value: 'principal_interest', label: 'Principal & Interest' },
  { value: 'interest_only', label: 'Interest Only' },
  { value: 'minimum', label: 'Minimum Payment' },
  { value: 'fixed', label: 'Fixed Repayment' },
];

const defaultFormData: LiabilityFormData = {
  liability_type: 'credit_card', provider_name: '', current_balance: 0,
  credit_limit: 0, interest_rate: 0, monthly_repayment: 0, repayment_type: 'principal_interest',
};

const fmt = (val: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

export function PortalLiabilityForm({ existingLiabilities, onRefresh }: PortalLiabilityFormProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<LiabilityFormData>(defaultFormData);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const updateData = usePortalUpdateData();

  const updateField = useCallback((field: keyof LiabilityFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const resetForm = () => { setFormData(defaultFormData); setEditingId(null); };

  const startEdit = (l: any) => {
    setFormData({
      liability_type: l.liability_type || 'other',
      provider_name: l.provider_name || '',
      current_balance: l.current_balance || 0,
      credit_limit: l.credit_limit || 0,
      interest_rate: l.interest_rate || 0,
      monthly_repayment: l.monthly_repayment || 0,
      repayment_type: l.repayment_type || 'principal_interest',
    });
    setEditingId(l.id);
  };

  const handleSubmit = async () => {
    if (formData.current_balance <= 0) { toast.error('Please enter a balance'); return; }
    setSaving(true);
    try {
      await updateData.mutateAsync({
        operation: editingId ? 'update' : 'insert',
        table: 'client_liabilities',
        data: {
          liability_type: formData.liability_type,
          provider_name: formData.provider_name || null,
          current_balance: formData.current_balance,
          credit_limit: formData.liability_type === 'credit_card' ? formData.credit_limit : null,
          interest_rate: formData.interest_rate,
          monthly_repayment: formData.monthly_repayment,
          repayment_type: formData.repayment_type || null,
        },
        id: editingId || undefined,
      });
      toast.success(editingId ? 'Liability updated' : 'Liability added');
      resetForm();
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await updateData.mutateAsync({ operation: 'delete', table: 'client_liabilities', id });
      toast.success('Liability deleted');
      if (editingId === id) resetForm();
      onRefresh();
    } catch (err: any) { toast.error(err.message || 'Failed to delete'); }
    finally { setDeleting(null); }
  };

  const getIcon = (t: string) => { const opt = liabilityTypeOptions.find(o => o.value === t); const Icon = opt?.icon || DollarSign; return <Icon className="h-4 w-4" />; };
  const getLabel = (t: string) => liabilityTypeOptions.find(o => o.value === t)?.label || t;

  const totalBalance = existingLiabilities.reduce((s, l) => s + (l.current_balance || 0), 0);
  const totalRepayments = existingLiabilities.reduce((s, l) => s + (l.monthly_repayment || 0), 0);

  return (
    <div className="space-y-4">
      {existingLiabilities.length > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Card className={portalStatCardClassName()}>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Balance</p>
                <p className="text-xl font-bold text-destructive">{fmt(totalBalance)}</p>
              </CardContent>
            </Card>
            <Card className={portalStatCardClassName()}>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Monthly Repayments</p>
                <p className="text-xl font-bold text-foreground">{fmt(totalRepayments)}</p>
              </CardContent>
            </Card>
          </div>

          {existingLiabilities.map((l) => (
            <Card key={l.id} className={portalPanelClassName()}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {getIcon(l.liability_type)}
                      <span className="text-sm font-medium">{getLabel(l.liability_type)}</span>
                      {l.provider_name && <Badge variant="outline" className="text-xs">{l.provider_name}</Badge>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Balance: </span>
                        <span className="font-medium text-destructive">{fmt(l.current_balance || 0)}</span>
                      </div>
                      {l.monthly_repayment > 0 && (
                        <div>
                          <span className="text-muted-foreground">Repayment: </span>
                          <span className="font-medium">{fmt(l.monthly_repayment)}/mo</span>
                        </div>
                      )}
                      {l.interest_rate > 0 && (
                        <div>
                          <span className="text-muted-foreground">Rate: </span>
                          <span>{l.interest_rate}%</span>
                        </div>
                      )}
                      {l.liability_type === 'credit_card' && l.credit_limit > 0 && (
                        <div>
                          <span className="text-muted-foreground">Limit: </span>
                          <span>{fmt(l.credit_limit)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { startEdit(l); setOpen(true); }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" disabled={deleting === l.id} onClick={() => handleDelete(l.id)}>
                      {deleting === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<CreditCard className="h-8 w-8" />}
          title="No liabilities recorded yet"
          description="Add mortgages, loans, and cards to complete your financial profile and repayment picture."
        />
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full gap-2"><Plus className="h-4 w-4" />Add Liability</Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" />{editingId ? 'Edit Liability' : 'Add Liability'}</DialogTitle>
            <DialogDescription>Record a mortgage, loan, or credit card</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs">Liability Type *</Label>
              <Select value={formData.liability_type} onValueChange={(v) => updateField('liability_type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {liabilityTypeOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      <div className="flex items-center gap-2"><o.icon className="h-4 w-4" />{o.label}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Provider / Bank Name</Label>
              <Input value={formData.provider_name} onChange={(e) => updateField('provider_name', e.target.value)} placeholder="Commonwealth Bank" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Current Balance *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input type="number" value={formData.current_balance || ''} onChange={(e) => updateField('current_balance', parseFloat(e.target.value) || 0)} className="pl-7" placeholder="0" />
                </div>
              </div>
              {formData.liability_type === 'credit_card' ? (
                <div className="space-y-2">
                  <Label className="text-xs">Credit Limit</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input type="number" value={formData.credit_limit || ''} onChange={(e) => updateField('credit_limit', parseFloat(e.target.value) || 0)} className="pl-7" placeholder="0" />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs">Interest Rate (%)</Label>
                  <Input type="number" step="0.01" value={formData.interest_rate || ''} onChange={(e) => updateField('interest_rate', parseFloat(e.target.value) || 0)} placeholder="5.90" />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Monthly Repayment</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input type="number" value={formData.monthly_repayment || ''} onChange={(e) => updateField('monthly_repayment', parseFloat(e.target.value) || 0)} className="pl-7" placeholder="0" />
                </div>
              </div>
              {formData.liability_type !== 'student_loan' && formData.liability_type !== 'credit_card' && (
                <div className="space-y-2">
                  <Label className="text-xs">Repayment Type</Label>
                  <Select value={formData.repayment_type} onValueChange={(v) => updateField('repayment_type', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {repaymentTypeOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            {editingId && <Button variant="outline" onClick={resetForm}>Cancel Edit</Button>}
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? 'Update Liability' : 'Add Liability'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
