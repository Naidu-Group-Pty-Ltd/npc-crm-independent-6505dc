import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Loader2, ChevronDown, ChevronRight, DollarSign } from 'lucide-react';
import { convertToAnnual, FREQUENCY_OPTIONS, formatCurrency } from './income/incomeSourceTypes';

const employmentTypeOptions = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'part_time', label: 'Part Time' },
  { value: 'casual', label: 'Casual' },
  { value: 'contract', label: 'Contract' },
  { value: 'self_employed', label: 'Self Employed' },
];

export interface EmploymentFormData {
  id?: string;
  contact_type: 'primary' | 'secondary' | 'additional';
  additional_contact_id: string | null;
  is_current: boolean;
  employment_type: string;
  occupation_role: string;
  employer_name: string;
  start_date: string;
  // Income fields
  salary_amount: number;
  salary_frequency: string;
  gross_annual_salary: number;
  bonus: number;
  commission: number;
  overtime_essential: number;
  overtime_non_essential: number;
  allowance: number;
  other_taxable_income: number;
  // Optional employer location. These fields are stored on client_employment, never in residential address history.
  workplace_address_line_1: string;
  workplace_suburb: string;
  workplace_state: string;
  workplace_postcode: string;
  workplace_country: string;
  work_arrangement: string;
}

interface EmploymentFormFieldsProps {
  formData: EmploymentFormData;
  updateField: (field: keyof EmploymentFormData, value: any) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
  isEditing: boolean;
}

export function EmploymentFormFields({
  formData,
  updateField,
  onSubmit,
  onCancel,
  isPending,
  isEditing,
}: EmploymentFormFieldsProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showWorkplaceAddress, setShowWorkplaceAddress] = useState(Boolean(formData.workplace_address_line_1 || formData.workplace_suburb || formData.workplace_state || formData.workplace_postcode || formData.workplace_country || formData.work_arrangement));

  const grossAnnual = formData.gross_annual_salary || convertToAnnual(formData.salary_amount || 0, formData.salary_frequency || 'annual');
  const totalAnnual = grossAnnual + (formData.bonus || 0) + (formData.commission || 0) + 
    (formData.overtime_essential || 0) + (formData.overtime_non_essential || 0) + 
    (formData.allowance || 0) + (formData.other_taxable_income || 0);

  const handleSalaryChange = (field: 'salary_amount' | 'salary_frequency', value: any) => {
    updateField(field, value);
    const amount = field === 'salary_amount' ? (parseFloat(value) || 0) : formData.salary_amount;
    const freq = field === 'salary_frequency' ? value : formData.salary_frequency;
    updateField('gross_annual_salary', convertToAnnual(amount, freq));
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          {isEditing ? 'Edit Employment' : 'Add New Employment'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Current Employer</Label>
          <Switch
            checked={formData.is_current}
            onCheckedChange={(v) => updateField('is_current', v)}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Employment Type</Label>
          <Select
            value={formData.employment_type}
            onValueChange={(v) => updateField('employment_type', v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {employmentTypeOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Occupation/Role</Label>
          <Input
            value={formData.occupation_role}
            onChange={(e) => updateField('occupation_role', e.target.value)}
            placeholder="Software Engineer"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Employer Name *</Label>
          <Input
            value={formData.employer_name}
            onChange={(e) => updateField('employer_name', e.target.value)}
            placeholder="Company Pty Ltd"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Start Date</Label>
          <Input
            type="date"
            value={formData.start_date}
            onChange={(e) => updateField('start_date', e.target.value)}
          />
        </div>

        <Collapsible open={showWorkplaceAddress} onOpenChange={setShowWorkplaceAddress}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="w-full justify-between" aria-expanded={showWorkplaceAddress}>
              <span>Add workplace address — optional</span>
              {showWorkplaceAddress ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">Employer location only. This is not part of residential address history.</p>
            <div className="space-y-1.5">
              <Label className="text-xs">Workplace Address</Label>
              <Input value={formData.workplace_address_line_1} onChange={(event) => updateField('workplace_address_line_1', event.target.value)} placeholder="123 Business Street" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Suburb / City</Label><Input value={formData.workplace_suburb} onChange={(event) => updateField('workplace_suburb', event.target.value)} placeholder="Sydney" /></div>
              <div className="space-y-1.5"><Label className="text-xs">State</Label><Input value={formData.workplace_state} onChange={(event) => updateField('workplace_state', event.target.value.toUpperCase())} placeholder="NSW" maxLength={3} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Postcode</Label><Input value={formData.workplace_postcode} onChange={(event) => updateField('workplace_postcode', event.target.value)} placeholder="2000" maxLength={4} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Country</Label><Input value={formData.workplace_country} onChange={(event) => updateField('workplace_country', event.target.value)} placeholder="Australia" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Work Arrangement</Label><Select value={formData.work_arrangement} onValueChange={(value) => updateField('work_arrangement', value)}><SelectTrigger><SelectValue placeholder="Select (optional)" /></SelectTrigger><SelectContent><SelectItem value="on_site">On-site</SelectItem><SelectItem value="hybrid">Hybrid</SelectItem><SelectItem value="remote">Remote</SelectItem></SelectContent></Select></div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Salary / Income Section */}
        <div className="border-t pt-4 space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Income Details
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="number"
                value={formData.salary_amount || ''}
                onChange={(e) => handleSalaryChange('salary_amount', e.target.value)}
                className="pl-9"
                placeholder="0"
              />
            </div>
            <Select value={formData.salary_frequency || 'annual'} onValueChange={v => handleSalaryChange('salary_frequency', v)}>
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FREQUENCY_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {formData.salary_frequency !== 'annual' && (formData.salary_amount || 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              = {formatCurrency(grossAnnual)} per annum
            </p>
          )}

          <Collapsible open={showBreakdown} onOpenChange={setShowBreakdown}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-start text-xs h-7 text-muted-foreground">
                {showBreakdown ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                Additional Income (Bonus, Commission, OT...)
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { field: 'bonus' as const, label: 'Bonus (avg 2yr)' },
                  { field: 'allowance' as const, label: 'Allowance' },
                  { field: 'commission' as const, label: 'Commission' },
                  { field: 'overtime_essential' as const, label: 'OT (Essential)' },
                  { field: 'overtime_non_essential' as const, label: 'OT (Non-Essential)' },
                  { field: 'other_taxable_income' as const, label: 'Other Taxable' },
                ].map(({ field, label }) => (
                  <div key={field} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="number"
                        value={formData[field] || ''}
                        onChange={e => updateField(field, parseFloat(e.target.value) || 0)}
                        className="pl-7 h-9"
                        placeholder="0"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {totalAnnual > 0 && (
            <div className="bg-muted/50 rounded-md p-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Annual</span>
                <span className="font-semibold">{formatCurrency(totalAnnual)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          {isEditing && (
            <Button variant="outline" onClick={onCancel} className="flex-1">
              Cancel
            </Button>
          )}
          <Button 
            onClick={onSubmit} 
            disabled={isPending}
            className="flex-1"
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? 'Update' : 'Add'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
