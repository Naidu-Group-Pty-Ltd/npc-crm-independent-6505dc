import React, { useCallback, useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { DollarSign, Loader2, Percent } from 'lucide-react';
import {
  IncomeSource,
  SOURCE_CATEGORIES,
  SOURCE_TYPES,
  FREQUENCY_OPTIONS,
  convertToAnnual,
  getDefaultShading,
  getSourceTotalAnnual,
  defaultIncomeSource,
  formatCurrency,
} from './incomeSourceTypes';

interface IncomeSourceFormProps {
  source?: IncomeSource;
  contactType: 'primary' | 'secondary';
  onSave: (source: IncomeSource) => void;
  onCancel: () => void;
  isPending: boolean;
  hideEmploymentCategory?: boolean;
  hideShading?: boolean;
}

export const IncomeSourceForm = React.memo(function IncomeSourceForm({
  source,
  contactType,
  onSave,
  onCancel,
  isPending,
  hideEmploymentCategory = false,
  hideShading = false,
}: IncomeSourceFormProps) {
  const [form, setForm] = useState<IncomeSource>(() => {
    const defaultCategory = hideEmploymentCategory ? 'passive' : 'employment';
    const defaultType = hideEmploymentCategory ? 'rental' : 'payg_fulltime';
    return {
      ...defaultIncomeSource,
      source_category: defaultCategory,
      source_type: defaultType,
      contact_type: contactType,
      ...source,
    };
  });

  const isEmployment = form.source_category === 'employment';

  const updateField = useCallback(<K extends keyof IncomeSource>(field: K, value: IncomeSource[K]) => {
    setForm(prev => {
      const updated = { ...prev, [field]: value };
      
      // When category changes, reset type to first option and update shading
      if (field === 'source_category') {
        const types = SOURCE_TYPES[value as string] || [];
        const firstType = types[0];
        if (firstType) {
          updated.source_type = firstType.value;
          updated.default_shading_rate = firstType.defaultShading;
          updated.custom_shading_rate = null;
        }
        // Reset employment sub-fields for non-employment categories
        if (value !== 'employment') {
          updated.bonus = 0;
          updated.commission = 0;
          updated.overtime_essential = 0;
          updated.overtime_non_essential = 0;
          updated.allowance = 0;
          updated.other_taxable_income = 0;
        }
      }
      
      // When type changes, update default shading
      if (field === 'source_type') {
        updated.default_shading_rate = getDefaultShading(updated.source_category, value as string);
        updated.custom_shading_rate = null;
      }
      
      // When input amount or frequency changes, recalc annual
      if (field === 'input_amount' || field === 'input_frequency') {
        updated.gross_annual_amount = convertToAnnual(
          field === 'input_amount' ? (value as number) : updated.input_amount,
          field === 'input_frequency' ? (value as string) : updated.input_frequency
        );
      }
      
      return updated;
    });
  }, []);

  const updateNumber = useCallback((field: keyof IncomeSource, val: string) => {
    updateField(field, parseFloat(val) || 0);
  }, [updateField]);

  const totalAnnual = getSourceTotalAnnual(form);
  const effectiveShading = form.custom_shading_rate ?? form.default_shading_rate;

  const handleSubmit = () => {
    onSave(form);
  };

  const availableCategories = hideEmploymentCategory 
    ? SOURCE_CATEGORIES.filter(c => c.value !== 'employment') 
    : SOURCE_CATEGORIES;
  const sourceTypes = SOURCE_TYPES[form.source_category] || [];

  return (
    <div className="space-y-4">
      {/* Category & Type */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Income Source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs">Category</Label>
            <Select value={form.source_category} onValueChange={v => updateField('source_category', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {availableCategories.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Type</Label>
            <Select value={form.source_type} onValueChange={v => updateField('source_type', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {sourceTypes.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">{isEmployment ? 'Employer Name' : 'Source Name'}</Label>
            <Input
              value={form.source_name || ''}
              onChange={e => updateField('source_name', e.target.value)}
              placeholder={isEmployment ? 'e.g. Acme Corp' : 'e.g. Rental Property'}
            />
          </div>
        </CardContent>
      </Card>

      {/* Base Income Amount */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">
            {isEmployment ? 'Gross Salary' : 'Gross Income'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="number"
                value={form.input_amount || ''}
                onChange={e => updateNumber('input_amount', e.target.value)}
                className="pl-9"
                placeholder="0"
              />
            </div>
            <Select value={form.input_frequency} onValueChange={v => updateField('input_frequency', v)}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FREQUENCY_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.input_frequency !== 'annual' && form.input_amount > 0 && (
            <p className="text-xs text-muted-foreground">
              = {formatCurrency(form.gross_annual_amount)} per annum
            </p>
          )}
        </CardContent>
      </Card>

      {/* Employment-specific sub-fields */}
      {isEmployment && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Additional Income (Annual)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { field: 'bonus' as const, label: 'Bonus (avg 2yr)' },
                { field: 'allowance' as const, label: 'Allowance' },
                { field: 'commission' as const, label: 'Commission' },
                { field: 'overtime_essential' as const, label: 'OT (Essential)' },
                { field: 'overtime_non_essential' as const, label: 'OT (Non-Essential)' },
                { field: 'other_taxable_income' as const, label: 'Other Taxable' },
              ].map(({ field, label }) => (
                <div key={field} className="space-y-2">
                  <Label className="text-xs">{label}</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="number"
                      value={form[field] || ''}
                      onChange={e => updateNumber(field, e.target.value)}
                      className="pl-7 h-9"
                      placeholder="0"
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Shading Rate - hidden for portal users */}
      {!hideShading && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Percent className="h-4 w-4" />
              Borrowing Capacity Shading
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Default: {(form.default_shading_rate * 100).toFixed(0)}%
              </span>
              <Badge variant="outline" className="text-xs">
                {form.custom_shading_rate !== null ? 'Custom' : 'Default'}
              </Badge>
            </div>
            <Slider
              value={[effectiveShading * 100]}
              onValueChange={([v]) => updateField('custom_shading_rate', v / 100)}
              min={0}
              max={100}
              step={5}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0%</span>
              <span className="font-medium">{(effectiveShading * 100).toFixed(0)}%</span>
              <span>100%</span>
            </div>
            {form.custom_shading_rate !== null && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => updateField('custom_shading_rate', null)}
              >
                Reset to default
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <Card className="bg-muted/50 border-0">
        <CardContent className="pt-4">
          <div className="flex justify-between items-center">
            <span className="font-medium">Total Annual Income</span>
            <span className="text-lg font-bold text-success">{formatCurrency(totalAnnual)}</span>
          </div>
          {!hideShading && (
            <div className="flex justify-between items-center mt-1">
              <span className="text-xs text-muted-foreground">Shaded Amount ({(effectiveShading * 100).toFixed(0)}%)</span>
              <span className="text-sm font-medium text-muted-foreground">{formatCurrency(totalAnnual * effectiveShading)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1">Cancel</Button>
        <Button onClick={handleSubmit} disabled={isPending} className="flex-1">
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {source?.id ? 'Update Source' : 'Add Source'}
        </Button>
      </div>
    </div>
  );
});
