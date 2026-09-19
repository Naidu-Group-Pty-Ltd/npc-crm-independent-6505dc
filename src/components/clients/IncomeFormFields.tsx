import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DollarSign, Loader2 } from 'lucide-react';

interface IncomeFormData {
  id?: string;
  contact_type: 'primary' | 'secondary';
  gross_salary: number;
  salary_frequency: string;
  bonus: number;
  allowance: number;
  commission: number;
  overtime_essential: number;
  overtime_non_essential: number;
  other_taxable_income: number;
}

interface IncomeFormFieldsProps {
  formData: IncomeFormData;
  updateNumberField: (field: keyof IncomeFormData, value: string) => void;
  updateField: (field: keyof IncomeFormData, value: any) => void;
  onSubmit: () => void;
  isPending: boolean;
  editingId: string | null;
  annualGrossSalary: number;
  totalAnnualIncome: number;
}

const frequencyOptions = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
];

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

export const IncomeFormFields = React.memo(function IncomeFormFields({
  formData,
  updateNumberField,
  updateField,
  onSubmit,
  isPending,
  editingId,
  annualGrossSalary,
  totalAnnualIncome,
}: IncomeFormFieldsProps) {
  return (
    <div className="space-y-4">
      {/* Gross Salary with Frequency */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Gross Salary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="number"
                value={formData.gross_salary || ''}
                onChange={(e) => updateNumberField('gross_salary', e.target.value)}
                className="pl-9"
                placeholder="0"
              />
            </div>
            <Select
              value={formData.salary_frequency}
              onValueChange={(v) => updateField('salary_frequency', v)}
            >
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {frequencyOptions.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {formData.salary_frequency !== 'annual' && formData.gross_salary > 0 && (
            <p className="text-xs text-muted-foreground">
              = {formatCurrency(annualGrossSalary)} per annum
            </p>
          )}
        </CardContent>
      </Card>

      {/* Additional Income Fields */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Additional Income (Annual)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs">Bonus (avg of last 2 years)</Label>
              <div className="relative">
                <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="number"
                  value={formData.bonus || ''}
                  onChange={(e) => updateNumberField('bonus', e.target.value)}
                  className="pl-7 h-9"
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Allowance</Label>
              <div className="relative">
                <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="number"
                  value={formData.allowance || ''}
                  onChange={(e) => updateNumberField('allowance', e.target.value)}
                  className="pl-7 h-9"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs">Commission</Label>
              <div className="relative">
                <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="number"
                  value={formData.commission || ''}
                  onChange={(e) => updateNumberField('commission', e.target.value)}
                  className="pl-7 h-9"
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Overtime (Essential)</Label>
              <div className="relative">
                <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="number"
                  value={formData.overtime_essential || ''}
                  onChange={(e) => updateNumberField('overtime_essential', e.target.value)}
                  className="pl-7 h-9"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs">Overtime (Non-Essential)</Label>
              <div className="relative">
                <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="number"
                  value={formData.overtime_non_essential || ''}
                  onChange={(e) => updateNumberField('overtime_non_essential', e.target.value)}
                  className="pl-7 h-9"
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Other Taxable Income</Label>
              <div className="relative">
                <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="number"
                  value={formData.other_taxable_income || ''}
                  onChange={(e) => updateNumberField('other_taxable_income', e.target.value)}
                  className="pl-7 h-9"
                  placeholder="0"
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Other taxable income includes Centrelink Part A/B, disability payments, carer's allowance
          </p>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card className="bg-muted/50 border-0">
        <CardContent className="pt-4">
          <div className="flex justify-between items-center">
            <span className="font-medium">Total Annual Income</span>
            <span className="text-lg font-bold text-success">
              {formatCurrency(totalAnnualIncome)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {formatCurrency(totalAnnualIncome / 12)} per month
          </p>
        </CardContent>
      </Card>

      <Button 
        onClick={onSubmit} 
        disabled={isPending}
        className="w-full"
      >
        {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {editingId ? 'Update Income Details' : 'Save Income Details'}
      </Button>
    </div>
  );
});
