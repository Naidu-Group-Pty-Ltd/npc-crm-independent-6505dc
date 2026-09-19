import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Plus, Loader2, Trash2, Edit, Receipt, Utensils, Car, Wifi, HeartPulse,
  GraduationCap, Tv, ShoppingBag, Plane, Baby, Dumbbell, DollarSign, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePortalUpdateData } from '@/hooks/usePortalData';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { portalPanelClassName, portalStatCardClassName } from '@/components/portal/PortalSurface';

interface PortalExpenseFormProps {
  existingExpenses: any[];
  onRefresh: () => void;
}

interface ExpenseFormData {
  expense_category: string;
  expense_name: string;
  monthly_amount: number;
  frequency: string;
  notes: string;
  is_essential: boolean;
}

const expenseCategoryOptions = [
  { value: 'groceries', label: 'Groceries & Food', icon: Utensils, essential: true },
  { value: 'transport', label: 'Transport & Fuel', icon: Car, essential: true },
  { value: 'utilities', label: 'Utilities (Gas/Electric/Water)', icon: Wifi, essential: true },
  { value: 'internet_phone', label: 'Internet & Phone', icon: Wifi, essential: true },
  { value: 'health_insurance', label: 'Health Insurance', icon: HeartPulse, essential: true },
  { value: 'medical', label: 'Medical & Pharmacy', icon: HeartPulse, essential: true },
  { value: 'education', label: 'Education & Childcare', icon: GraduationCap, essential: true },
  { value: 'childcare', label: 'Childcare', icon: Baby, essential: true },
  { value: 'entertainment', label: 'Entertainment & Subscriptions', icon: Tv, essential: false },
  { value: 'clothing', label: 'Clothing & Personal', icon: ShoppingBag, essential: false },
  { value: 'travel', label: 'Travel & Holidays', icon: Plane, essential: false },
  { value: 'gym_fitness', label: 'Gym & Fitness', icon: Dumbbell, essential: false },
  { value: 'dining_out', label: 'Dining Out', icon: Utensils, essential: false },
  { value: 'personal_care', label: 'Personal Care & Beauty', icon: Sparkles, essential: false },
  { value: 'other', label: 'Other', icon: DollarSign, essential: false },
];

const frequencyOptions = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
];

const defaultFormData: ExpenseFormData = {
  expense_category: 'groceries',
  expense_name: '',
  monthly_amount: 0,
  frequency: 'monthly',
  notes: '',
  is_essential: true,
};

const fmt = (val: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);

export function PortalExpenseForm({ existingExpenses, onRefresh }: PortalExpenseFormProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<ExpenseFormData>(defaultFormData);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const updateData = usePortalUpdateData();

  const updateField = useCallback((field: keyof ExpenseFormData, value: any) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      if (field === 'expense_category') {
        const cat = expenseCategoryOptions.find(c => c.value === value);
        updated.is_essential = cat?.essential ?? false;
      }
      return updated;
    });
  }, []);

  const resetForm = () => { setFormData(defaultFormData); setEditingId(null); };

  const startEdit = (exp: any) => {
    setFormData({
      expense_category: exp.expense_category || 'other',
      expense_name: exp.expense_name || '',
      monthly_amount: exp.monthly_amount || 0,
      frequency: exp.frequency || 'monthly',
      notes: exp.notes || '',
      is_essential: exp.is_essential ?? true,
    });
    setEditingId(exp.id);
  };

  const handleSubmit = async () => {
    if (formData.monthly_amount <= 0) { toast.error('Please enter an amount'); return; }
    setSaving(true);
    try {
      await updateData.mutateAsync({
        operation: editingId ? 'update' : 'insert',
        table: 'client_expenses',
        data: { ...formData },
        id: editingId || undefined,
      });
      toast.success(editingId ? 'Expense updated' : 'Expense added');
      resetForm();
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save expense');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await updateData.mutateAsync({ operation: 'delete', table: 'client_expenses', id });
      toast.success('Expense deleted');
      if (editingId === id) resetForm();
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete');
    } finally { setDeleting(null); }
  };

  const getIcon = (cat: string) => {
    const opt = expenseCategoryOptions.find(o => o.value === cat);
    const Icon = opt?.icon || DollarSign;
    return <Icon className="h-4 w-4" />;
  };
  const getLabel = (cat: string) => expenseCategoryOptions.find(o => o.value === cat)?.label || cat;

  const totalMonthly = existingExpenses.reduce((s, e) => s + (e.monthly_amount || 0), 0);

  return (
    <div className="space-y-4">
      {existingExpenses.length > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Card className={portalStatCardClassName()}>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Monthly</p>
                <p className="text-xl font-bold text-destructive">{fmt(totalMonthly)}</p>
              </CardContent>
            </Card>
            <Card className={portalStatCardClassName()}>
              <CardContent className="pt-5 pb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Items</p>
                <p className="text-xl font-bold text-foreground">{existingExpenses.length}</p>
              </CardContent>
            </Card>
          </div>

          {existingExpenses.map((exp) => (
            <Card key={exp.id} className={portalPanelClassName()}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {getIcon(exp.expense_category)}
                      <span className="text-sm font-medium">{exp.expense_name || getLabel(exp.expense_category)}</span>
                      <Badge variant={exp.is_essential ? 'default' : 'secondary'} className="text-xs">
                        {exp.is_essential ? 'Essential' : 'Discretionary'}
                      </Badge>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                      <span className="font-medium text-destructive">{fmt(exp.monthly_amount || 0)}/mo</span>
                      <span className="capitalize">{exp.frequency}</span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { startEdit(exp); setOpen(true); }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" disabled={deleting === exp.id} onClick={() => handleDelete(exp.id)}>
                      {deleting === exp.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
          icon={<Receipt className="h-8 w-8" />}
          title="No expenses recorded yet"
          description="Add your living expenses for more accurate borrowing capacity and cash flow calculations."
        />
      )}

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full gap-2">
            <Plus className="h-4 w-4" />
            Add Expense
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              {editingId ? 'Edit Expense' : 'Add Expense'}
            </DialogTitle>
            <DialogDescription>Record a living expense</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs">Expense Category *</Label>
              <Select value={formData.expense_category} onValueChange={(v) => updateField('expense_category', v)}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {expenseCategoryOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>
                      <div className="flex items-center gap-2"><o.icon className="h-4 w-4" />{o.label}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Description (Optional)</Label>
              <Input value={formData.expense_name} onChange={(e) => updateField('expense_name', e.target.value)} placeholder="e.g., Woolworths weekly shop" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Amount *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input type="number" value={formData.monthly_amount || ''} onChange={(e) => updateField('monthly_amount', parseFloat(e.target.value) || 0)} className="pl-7" placeholder="0" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Frequency</Label>
                <Select value={formData.frequency} onValueChange={(v) => updateField('frequency', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {frequencyOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs">Essential Expense</Label>
                <p className="text-xs text-muted-foreground">Required for daily living</p>
              </div>
              <Switch checked={formData.is_essential} onCheckedChange={(c) => updateField('is_essential', c)} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            {editingId && <Button variant="outline" onClick={resetForm}>Cancel Edit</Button>}
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId ? 'Update Expense' : 'Add Expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
