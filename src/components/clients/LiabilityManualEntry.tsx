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
import { Plus, CreditCard, Loader2, Trash2, Edit, Home, Car, GraduationCap, DollarSign } from 'lucide-react';
import { toast } from 'sonner';

interface LiabilityManualEntryProps {
  clientId: string;
  onComplete: () => void;
}

interface LiabilityFormData {
  id?: string;
  liability_type: string;
  provider_name: string;
  current_balance: number;
  credit_limit: number;
  interest_rate: number;
  monthly_repayment: number;
  repayment_type: string;
}

const liabilityTypeOptions = [
  { value: 'mortgage', label: 'Mortgage/Investment Home Loan', icon: Home },
  { value: 'credit_card', label: 'Credit Card', icon: CreditCard },
  { value: 'personal_loan', label: 'Personal Loan', icon: DollarSign },
  { value: 'vehicle_loan', label: 'Vehicle Loan', icon: Car },
  { value: 'student_loan', label: 'Student Loan (HECS/HELP)', icon: GraduationCap },
  { value: 'other', label: 'Other', icon: DollarSign },
];

const repaymentTypeOptions = [
  { value: 'principal_interest', label: 'Principal & Interest' },
  { value: 'interest_only', label: 'Interest Only' },
  { value: 'minimum', label: 'Minimum Payment' },
  { value: 'fixed', label: 'Fixed Repayment' },
];

const defaultFormData: LiabilityFormData = {
  liability_type: 'credit_card',
  provider_name: '',
  current_balance: 0,
  credit_limit: 0,
  interest_rate: 0,
  monthly_repayment: 0,
  repayment_type: 'principal_interest',
};

import { invokeSecureFunction } from '@/lib/secureInvoke';

export function LiabilityManualEntry({ clientId, onComplete }: LiabilityManualEntryProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<LiabilityFormData>(defaultFormData);
  const [editingId, setEditingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch existing liabilities with secure Edge Function (HttpOnly cookies)
  const { data: existingLiabilities = [] } = useQuery({
    queryKey: ['client-liabilities', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        clientId,
        include: { liabilities: true },
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error('Failed to fetch liabilities');
      return data.liabilities || [];
    },
  });

  const updateField = useCallback((field: keyof LiabilityFormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const resetForm = () => {
    setFormData(defaultFormData);
    setEditingId(null);
  };

  const startEdit = (liability: any) => {
    setFormData({
      id: liability.id,
      liability_type: liability.liability_type,
      provider_name: liability.provider_name || '',
      current_balance: liability.current_balance || 0,
      credit_limit: liability.credit_limit || 0,
      interest_rate: liability.interest_rate || 0,
      monthly_repayment: liability.monthly_repayment || 0,
      repayment_type: liability.repayment_type || 'principal_interest',
    });
    setEditingId(liability.id);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        client_id: clientId,
        liability_type: formData.liability_type,
        provider_name: formData.provider_name || null,
        current_balance: formData.current_balance,
        credit_limit: formData.liability_type === 'credit_card' ? formData.credit_limit : null,
        interest_rate: formData.interest_rate,
        monthly_repayment: formData.monthly_repayment,
        repayment_type: formData.repayment_type || null,
      };

      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: editingId ? 'update' : 'create',
        table: 'client_liabilities',
        clientId,
        recordId: editingId,
        data: payload,
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to save liability');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-liabilities', clientId] });
      toast.success(editingId ? 'Liability updated' : 'Liability added');
      resetForm();
    },
    onError: (error: any) => {
      toast.error('Failed to save liability: ' + error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_liabilities',
        clientId,
        recordId: id,
      });
      
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Failed to delete liability');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-liabilities', clientId] });
      toast.success('Liability deleted');
      if (editingId) resetForm();
    },
    onError: (error: any) => {
      toast.error('Failed to delete: ' + error.message);
    },
  });

  const handleSubmit = () => {
    if (formData.current_balance <= 0) {
      toast.error('Please enter a balance');
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

  const totalLiabilities = existingLiabilities.reduce((sum, l) => sum + (l.current_balance || 0), 0);
  const totalMonthlyRepayments = existingLiabilities.reduce((sum, l) => sum + (l.monthly_repayment || 0), 0);

  const getLiabilityIcon = (type: string) => {
    const option = liabilityTypeOptions.find(o => o.value === type);
    const Icon = option?.icon || DollarSign;
    return <Icon className="h-4 w-4" />;
  };

  const getLiabilityLabel = (type: string) => {
    const option = liabilityTypeOptions.find(o => o.value === type);
    return option?.label || type;
  };

  const LiabilityCard = ({ liability }: { liability: any }) => (
    <Card className="mb-2">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {getLiabilityIcon(liability.liability_type)}
              <span className="font-medium text-sm">
                {getLiabilityLabel(liability.liability_type)}
              </span>
            </div>
            {liability.provider_name && (
              <p className="text-sm text-muted-foreground">{liability.provider_name}</p>
            )}
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
              <div>
                <span className="text-muted-foreground">Balance:</span>
                <span className="ml-1 font-medium text-destructive">
                  {formatCurrency(liability.current_balance || 0)}
                </span>
              </div>
              {liability.liability_type === 'credit_card' && liability.credit_limit > 0 && (
                <div>
                  <span className="text-muted-foreground">Limit:</span>
                  <span className="ml-1">{formatCurrency(liability.credit_limit)}</span>
                </div>
              )}
              {liability.interest_rate > 0 && (
                <div>
                  <span className="text-muted-foreground">Rate:</span>
                  <span className="ml-1">{liability.interest_rate}%</span>
                </div>
              )}
              {liability.monthly_repayment > 0 && (
                <div>
                  <span className="text-muted-foreground">Repayment:</span>
                  <span className="ml-1">{formatCurrency(liability.monthly_repayment)}/mo</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-1">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => startEdit(liability)}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 text-destructive"
              onClick={() => deleteMutation.mutate(liability.id)}
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
      {/* Liabilities Summary Display */}
      {existingLiabilities.length > 0 ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <Card className="bg-destructive/10 border-destructive/30">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Total Liabilities</p>
                <p className="text-lg font-bold text-destructive">{formatCurrency(totalLiabilities)}</p>
              </CardContent>
            </Card>
            <Card className="bg-brand-50 border-brand-200">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Monthly Repayments</p>
                <p className="text-lg font-bold text-brand-600">{formatCurrency(totalMonthlyRepayments)}</p>
              </CardContent>
            </Card>
          </div>
          
          {existingLiabilities.map(liability => (
            <Card key={liability.id}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  {getLiabilityIcon(liability.liability_type)}
                  <span className="font-medium text-sm">{getLiabilityLabel(liability.liability_type)}</span>
                </div>
                {liability.provider_name && (
                  <p className="text-sm text-muted-foreground">{liability.provider_name}</p>
                )}
                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Balance:</span>
                    <span className="ml-1 font-medium text-destructive">{formatCurrency(liability.current_balance || 0)}</span>
                  </div>
                  {liability.monthly_repayment > 0 && (
                    <div>
                      <span className="text-muted-foreground">Repayment:</span>
                      <span className="ml-1">{formatCurrency(liability.monthly_repayment)}/mo</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-4 text-muted-foreground">
          <CreditCard className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No liabilities recorded</p>
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            {existingLiabilities.length > 0 ? 'Edit Liabilities' : 'Add Liability'}
          </Button>
        </SheetTrigger>
        <SheetContent className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Liabilities
            </SheetTitle>
            <SheetDescription>
              Manage mortgages, credit cards, loans, and other liabilities
            </SheetDescription>
          </SheetHeader>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            <Card className="bg-destructive/10 border-destructive/30">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Total Liabilities</p>
                <p className="text-lg font-bold text-destructive">{formatCurrency(totalLiabilities)}</p>
              </CardContent>
            </Card>
            <Card className="bg-brand-50 border-brand-200">
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Monthly Repayments</p>
                <p className="text-lg font-bold text-brand-600">{formatCurrency(totalMonthlyRepayments)}</p>
              </CardContent>
            </Card>
          </div>

          <ScrollArea className="h-[calc(100vh-340px)] pr-4 mt-4">
            {/* Existing Liabilities */}
            {existingLiabilities.length > 0 && (
              <div className="space-y-2 mb-4">
                <Label className="text-xs text-muted-foreground">Existing Liabilities</Label>
                {existingLiabilities.map(liability => (
                  <LiabilityCard key={liability.id} liability={liability} />
                ))}
              </div>
            )}

            {/* Add/Edit Form */}
            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">
                  {editingId ? 'Edit Liability' : 'Add New Liability'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs">Liability Type</Label>
                  <Select
                    value={formData.liability_type}
                    onValueChange={(v) => updateField('liability_type', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {liabilityTypeOptions.map(opt => (
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
                  <Label className="text-xs">Provider/Bank Name</Label>
                  <Input
                    value={formData.provider_name}
                    onChange={(e) => updateField('provider_name', e.target.value)}
                    placeholder="Commonwealth Bank"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Current Balance *</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        type="number"
                        value={formData.current_balance || ''}
                        onChange={(e) => updateField('current_balance', parseFloat(e.target.value) || 0)}
                        className="pl-7"
                        placeholder="0"
                      />
                    </div>
                  </div>

                  {formData.liability_type === 'credit_card' && (
                    <div className="space-y-2">
                      <Label className="text-xs">Credit Limit</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                        <Input
                          type="number"
                          value={formData.credit_limit || ''}
                          onChange={(e) => updateField('credit_limit', parseFloat(e.target.value) || 0)}
                          className="pl-7"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  )}

                  {formData.liability_type !== 'credit_card' && (
                    <div className="space-y-2">
                      <Label className="text-xs">Interest Rate (%)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.interest_rate || ''}
                        onChange={(e) => updateField('interest_rate', parseFloat(e.target.value) || 0)}
                        placeholder="5.90"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Monthly Repayment</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        type="number"
                        min="0"
                        value={formData.monthly_repayment || ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          updateField('monthly_repayment', raw === '' ? 0 : (parseFloat(raw) || 0));
                        }}
                        className="pl-7"
                        placeholder="0 (TBC)"
                      />
                    </div>
                  </div>

                  {formData.liability_type !== 'student_loan' && formData.liability_type !== 'credit_card' && (
                    <div className="space-y-2">
                      <Label className="text-xs">Repayment Type</Label>
                      <Select
                        value={formData.repayment_type}
                        onValueChange={(v) => updateField('repayment_type', v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          {repaymentTypeOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-2">
                  {editingId && (
                    <Button variant="outline" onClick={resetForm} className="flex-1">
                      Cancel
                    </Button>
                  )}
                  <Button 
                    onClick={handleSubmit} 
                    disabled={saveMutation.isPending}
                    className="flex-1"
                  >
                    {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {editingId ? 'Update' : 'Add Liability'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </ScrollArea>

          <SheetFooter className="pt-4">
            <Button variant="outline" onClick={() => { setOpen(false); onComplete(); }}>
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
