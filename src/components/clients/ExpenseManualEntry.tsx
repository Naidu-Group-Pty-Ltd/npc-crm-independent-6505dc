import { useState, useCallback } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { 
  Plus, 
  Loader2, 
  Trash2, 
  Edit, 
  Receipt,
  Utensils,
  Car,
  Wifi,
  HeartPulse,
  GraduationCap,
  Tv,
  ShoppingBag,
  Plane,
  Baby,
  Dumbbell,
  DollarSign,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';

interface ExpenseManualEntryProps {
  clientId: string;
  onComplete: () => void;
}

interface ExpenseFormData {
  id?: string;
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
  { value: 'weekly', label: 'Weekly', multiplier: 52 / 12 },
  { value: 'fortnightly', label: 'Fortnightly', multiplier: 26 / 12 },
  { value: 'monthly', label: 'Monthly', multiplier: 1 },
  { value: 'quarterly', label: 'Quarterly', multiplier: 1 / 3 },
  { value: 'annually', label: 'Annually', multiplier: 1 / 12 },
];

const defaultFormData: ExpenseFormData = {
  expense_category: 'groceries',
  expense_name: '',
  monthly_amount: 0,
  frequency: 'monthly',
  notes: '',
  is_essential: true,
};

import { invokeSecureFunction } from '@/lib/secureInvoke';

export function ExpenseManualEntry({ clientId, onComplete }: ExpenseManualEntryProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<ExpenseFormData>(defaultFormData);
  const [editingId, setEditingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch existing expenses with secure Edge Function (HttpOnly cookies)
  const { data: existingExpenses = [] } = useQuery({
    queryKey: ['client-expenses', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        include: { expenses: true },
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error('Failed to fetch expenses');
      return data.expenses || [];
    },
  });

  const updateField = useCallback((field: keyof ExpenseFormData, value: any) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      // Auto-set essential based on category
      if (field === 'expense_category') {
        const category = expenseCategoryOptions.find(c => c.value === value);
        updated.is_essential = category?.essential ?? false;
      }
      return updated;
    });
  }, []);

  const resetForm = () => {
    setFormData(defaultFormData);
    setEditingId(null);
  };

  const startEdit = (expense: any) => {
    setFormData({
      id: expense.id,
      expense_category: expense.expense_category,
      expense_name: expense.expense_name || '',
      monthly_amount: expense.monthly_amount || 0,
      frequency: expense.frequency || 'monthly',
      notes: expense.notes || '',
      is_essential: expense.is_essential ?? true,
    });
    setEditingId(expense.id);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        client_id: clientId,
        expense_category: formData.expense_category,
        expense_name: formData.expense_name || null,
        monthly_amount: formData.monthly_amount,
        frequency: formData.frequency,
        notes: formData.notes || null,
        is_essential: formData.is_essential,
      };

      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: editingId ? 'update' : 'create',
        table: 'client_expenses',
        clientId,
        recordId: editingId,
        data: payload,
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to save expense');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-expenses', clientId] });
      toast.success(editingId ? 'Expense updated' : 'Expense added');
      resetForm();
      onComplete();
    },
    onError: (error: any) => {
      toast.error('Failed to save expense: ' + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_expenses',
        clientId,
        recordId: id,
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to delete expense');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-expenses', clientId] });
      toast.success('Expense deleted');
      if (editingId) resetForm();
      onComplete();
    },
    onError: (error: any) => {
      toast.error('Failed to delete: ' + error.message);
    },
  });

  const handleSubmit = () => {
    if (formData.monthly_amount <= 0) {
      toast.error('Please enter an amount');
      return;
    }
    saveMutation.mutate();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const totalMonthlyExpenses = existingExpenses.reduce((sum, e) => sum + (e.monthly_amount || 0), 0);
  const essentialExpenses = existingExpenses.filter(e => e.is_essential);
  const discretionaryExpenses = existingExpenses.filter(e => !e.is_essential);
  const totalEssential = essentialExpenses.reduce((sum, e) => sum + (e.monthly_amount || 0), 0);
  const totalDiscretionary = discretionaryExpenses.reduce((sum, e) => sum + (e.monthly_amount || 0), 0);

  const getExpenseIcon = (category: string) => {
    const option = expenseCategoryOptions.find(o => o.value === category);
    const Icon = option?.icon || DollarSign;
    return <Icon className="h-4 w-4" />;
  };

  const getExpenseLabel = (category: string) => {
    const option = expenseCategoryOptions.find(o => o.value === category);
    return option?.label || category;
  };

  const ExpenseCard = ({ expense }: { expense: any }) => (
    <Card className="mb-2">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {getExpenseIcon(expense.expense_category)}
              <span className="font-medium text-sm">
                {expense.expense_name || getExpenseLabel(expense.expense_category)}
              </span>
              <Badge 
                variant={expense.is_essential ? "default" : "secondary"}
                className="text-xs"
              >
                {expense.is_essential ? 'Essential' : 'Discretionary'}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div>
                <span className="text-muted-foreground">Amount:</span>
                <span className="ml-1 font-medium text-destructive">
                  {formatCurrency(expense.monthly_amount || 0)}/mo
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Frequency:</span>
                <span className="ml-1 capitalize">{expense.frequency}</span>
              </div>
            </div>
            {expense.notes && (
              <p className="text-xs text-muted-foreground mt-1 truncate">{expense.notes}</p>
            )}
          </div>
          <div className="flex gap-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => startEdit(expense)}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 text-destructive"
              onClick={() => deleteMutation.mutate(expense.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-medium">Living Expenses</h3>
        </div>
        {existingExpenses.length > 0 && (
          <Badge variant="outline">{existingExpenses.length} items</Badge>
        )}
      </div>

      {/* Expenses Summary Display */}
      {existingExpenses.length > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Card className="bg-destructive/10 border-destructive/20">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Total Monthly</p>
                <p className="text-lg font-bold text-destructive">{formatCurrency(totalMonthlyExpenses)}</p>
              </CardContent>
            </Card>
            <Card className="bg-primary/10 border-primary/20">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Essential</p>
                <p className="text-lg font-bold text-primary">{formatCurrency(totalEssential)}</p>
              </CardContent>
            </Card>
            <Card className="bg-secondary border-border">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Discretionary</p>
                <p className="text-lg font-bold text-muted-foreground">{formatCurrency(totalDiscretionary)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Note about borrowing capacity */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border">
            <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              These declared expenses will be used in the borrowing capacity calculator. 
              Lenders typically use the higher of declared expenses or HEM benchmark.
            </p>
          </div>
          
          {existingExpenses.map(expense => (
            <Card key={expense.id}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  {getExpenseIcon(expense.expense_category)}
                  <span className="font-medium text-sm">
                    {expense.expense_name || getExpenseLabel(expense.expense_category)}
                  </span>
                  <Badge 
                    variant={expense.is_essential ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {expense.is_essential ? 'Essential' : 'Discretionary'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Amount:</span>
                    <span className="ml-1 font-medium text-destructive">{formatCurrency(expense.monthly_amount || 0)}/mo</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Frequency:</span>
                    <span className="ml-1 capitalize">{expense.frequency}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-4 text-muted-foreground">
          <Receipt className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No expenses recorded</p>
          <p className="text-xs mt-1">Add living expenses to improve borrowing capacity accuracy</p>
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            {existingExpenses.length > 0 ? 'Edit Expenses' : 'Add Expense'}
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Living Expenses
            </SheetTitle>
            <SheetDescription>
              Record monthly living expenses for accurate borrowing capacity calculations
            </SheetDescription>
          </SheetHeader>

          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            <Card className="bg-destructive/10 border-destructive/20">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Total Monthly</p>
                <p className="text-lg font-bold text-destructive">{formatCurrency(totalMonthlyExpenses)}</p>
              </CardContent>
            </Card>
            <Card className="bg-primary/10 border-primary/20">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Essential</p>
                <p className="text-lg font-bold text-primary">{formatCurrency(totalEssential)}</p>
              </CardContent>
            </Card>
            <Card className="bg-secondary border-border">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Discretionary</p>
                <p className="text-lg font-bold text-muted-foreground">{formatCurrency(totalDiscretionary)}</p>
              </CardContent>
            </Card>
          </div>

          <ScrollArea className="h-[calc(100vh-380px)] pr-4 mt-4">
            {/* Existing Expenses */}
            {existingExpenses.length > 0 && (
              <div className="space-y-2 mb-4">
                <Label className="text-xs text-muted-foreground">Existing Expenses</Label>
                {existingExpenses.map(expense => (
                  <ExpenseCard key={expense.id} expense={expense} />
                ))}
              </div>
            )}

            {/* Add/Edit Form */}
            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  {editingId ? 'Edit Expense' : 'Add New Expense'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs">Expense Category *</Label>
                  <Select
                    value={formData.expense_category}
                    onValueChange={(v) => updateField('expense_category', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {expenseCategoryOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex items-center gap-2">
                            <opt.icon className="h-4 w-4" />
                            {opt.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Description (Optional)</Label>
                  <Input
                    value={formData.expense_name}
                    onChange={(e) => updateField('expense_name', e.target.value)}
                    placeholder="e.g., Woolworths weekly shop"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Amount *</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        type="number"
                        value={formData.monthly_amount || ''}
                        onChange={(e) => updateField('monthly_amount', parseFloat(e.target.value) || 0)}
                        className="pl-7"
                        placeholder="0"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Frequency</Label>
                    <Select
                      value={formData.frequency}
                      onValueChange={(v) => updateField('frequency', v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {frequencyOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-xs">Essential Expense</Label>
                    <p className="text-xs text-muted-foreground">Required for daily living</p>
                  </div>
                  <Switch
                    checked={formData.is_essential}
                    onCheckedChange={(checked) => updateField('is_essential', checked)}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Notes (Optional)</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => updateField('notes', e.target.value)}
                    placeholder="Any additional details..."
                    rows={2}
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleSubmit}
                    disabled={saveMutation.isPending}
                    className="flex-1"
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : editingId ? (
                      'Update Expense'
                    ) : (
                      'Add Expense'
                    )}
                  </Button>
                  {editingId && (
                    <Button variant="outline" onClick={resetForm}>
                      Cancel
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </ScrollArea>

          <SheetFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpen(false)} className="w-full">
              Close
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
