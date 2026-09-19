import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, ChevronDown, ChevronRight, DollarSign, Briefcase, Edit, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { usePortalUpdateData } from '@/hooks/usePortalData';
import { convertToAnnual, FREQUENCY_OPTIONS, formatCurrency } from '@/components/clients/income/incomeSourceTypes';
import { ThreeYearCoverageWarning } from '@/components/clients/ThreeYearCoverageWarning';
import { calculateCoverage } from '@/utils/threeYearCoverage';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { portalPanelClassName } from '@/components/portal/PortalSurface';

const employmentTypeOptions = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'part_time', label: 'Part Time' },
  { value: 'casual', label: 'Casual' },
  { value: 'contract', label: 'Contract' },
  { value: 'self_employed', label: 'Self Employed' },
];

interface EmploymentFormData {
  is_current: boolean;
  employment_type: string;
  occupation_role: string;
  employer_name: string;
  start_date: string;
  salary_amount: number;
  salary_frequency: string;
  gross_annual_salary: number;
  bonus: number;
  commission: number;
  overtime_essential: number;
  overtime_non_essential: number;
  allowance: number;
  other_taxable_income: number;
}

const defaultForm: EmploymentFormData = {
  is_current: true,
  employment_type: 'permanent',
  occupation_role: '',
  employer_name: '',
  start_date: '',
  salary_amount: 0,
  salary_frequency: 'annual',
  gross_annual_salary: 0,
  bonus: 0,
  commission: 0,
  overtime_essential: 0,
  overtime_non_essential: 0,
  allowance: 0,
  other_taxable_income: 0,
};

function getEmploymentIncome(emp: any) {
  const gross = emp.gross_annual_salary || convertToAnnual(emp.salary_amount || 0, emp.salary_frequency || 'annual');
  return gross + (emp.bonus || 0) + (emp.commission || 0) +
    (emp.overtime_essential || 0) + (emp.overtime_non_essential || 0) +
    (emp.allowance || 0) + (emp.other_taxable_income || 0);
}

interface PortalEmploymentFormProps {
  existingEmployment: any[];
  onRefresh: () => void;
}

export function PortalEmploymentForm({ existingEmployment, onRefresh }: PortalEmploymentFormProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EmploymentFormData>({ ...defaultForm });
  const [showBreakdown, setShowBreakdown] = useState(false);
  const mutation = usePortalUpdateData();

  const updateField = useCallback((field: keyof EmploymentFormData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const resetForm = () => {
    setForm({ ...defaultForm });
    setEditingId(null);
    setShowForm(false);
    setShowBreakdown(false);
  };

  const startEdit = (emp: any) => {
    setForm({
      is_current: emp.is_current ?? true,
      employment_type: emp.employment_type || 'permanent',
      occupation_role: emp.occupation_role || '',
      employer_name: emp.employer_name || '',
      start_date: emp.start_date || '',
      salary_amount: emp.salary_amount || 0,
      salary_frequency: emp.salary_frequency || 'annual',
      gross_annual_salary: emp.gross_annual_salary || 0,
      bonus: emp.bonus || 0,
      commission: emp.commission || 0,
      overtime_essential: emp.overtime_essential || 0,
      overtime_non_essential: emp.overtime_non_essential || 0,
      allowance: emp.allowance || 0,
      other_taxable_income: emp.other_taxable_income || 0,
    });
    setEditingId(emp.id);
    setShowForm(true);
  };

  const handleSalaryChange = (field: 'salary_amount' | 'salary_frequency', value: any) => {
    updateField(field, value);
    const amount = field === 'salary_amount' ? (parseFloat(value) || 0) : form.salary_amount;
    const freq = field === 'salary_frequency' ? value : form.salary_frequency;
    updateField('gross_annual_salary', convertToAnnual(amount, freq));
  };

  const handleSubmit = async () => {
    if (!form.employer_name.trim()) { toast.error('Employer name is required'); return; }

    const payload: Record<string, any> = {
      contact_type: 'primary',
      is_current: form.is_current,
      employment_type: form.employment_type,
      occupation_role: form.occupation_role,
      employer_name: form.employer_name,
      start_date: form.start_date || null,
      salary_amount: form.salary_amount,
      salary_frequency: form.salary_frequency,
      gross_annual_salary: form.gross_annual_salary || convertToAnnual(form.salary_amount || 0, form.salary_frequency || 'annual'),
      bonus: form.bonus,
      commission: form.commission,
      overtime_essential: form.overtime_essential,
      overtime_non_essential: form.overtime_non_essential,
      allowance: form.allowance,
      other_taxable_income: form.other_taxable_income,
    };

    try {
      await mutation.mutateAsync({
        operation: editingId ? 'update' : 'insert',
        table: 'client_employment',
        id: editingId || undefined,
        data: payload,
      });
      toast.success(editingId ? 'Employment updated' : 'Employment added');
      resetForm();
      onRefresh();
    } catch (err: any) {
      toast.error('Failed to save: ' + (err.message || 'Unknown error'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await mutation.mutateAsync({ operation: 'delete', table: 'client_employment', id });
      toast.success('Employment deleted');
      if (editingId === id) resetForm();
      onRefresh();
    } catch (err: any) {
      toast.error('Failed to delete: ' + (err.message || 'Unknown error'));
    }
  };

  const grossAnnual = form.gross_annual_salary || convertToAnnual(form.salary_amount || 0, form.salary_frequency || 'annual');
  const totalAnnual = grossAnnual + (form.bonus || 0) + (form.commission || 0) +
    (form.overtime_essential || 0) + (form.overtime_non_essential || 0) +
    (form.allowance || 0) + (form.other_taxable_income || 0);

  const employmentCoverage = useMemo(() => calculateCoverage(existingEmployment), [existingEmployment]);

  return (
    <div className="space-y-4">
      <ThreeYearCoverageWarning coverage={employmentCoverage} label="Employment History" />
      {/* Existing Records */}
      {existingEmployment.length > 0 ? (
        <div className="space-y-2">
          {existingEmployment.map((emp: any) => {
            const income = getEmploymentIncome(emp);
            return (
              <Card key={emp.id} className={portalPanelClassName('group')}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm">{emp.employer_name || 'Unknown Employer'}</span>
                        {emp.is_current && <span className="rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[10px] text-success">Current</span>}
                        {!emp.is_current && <span className="rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">Previous</span>}
                      </div>
                      {emp.occupation_role && <p className="text-xs text-muted-foreground">{emp.occupation_role}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {emp.employment_type} • Started: {emp.start_date || 'N/A'}
                      </p>
                      {income > 0 && (
                        <p className="mt-1 text-sm font-medium text-success">{formatCurrency(income)}/yr</p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(emp)}>
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(emp.id)} disabled={mutation.isPending}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <PortalEmptyState
          className="client-portal-soft-panel"
          icon={<Briefcase className="h-8 w-8" />}
          title="No employment records yet"
          description="Add your employment history so your profile is complete for lender reviews and serviceability checks."
        />
      )}

      {/* Form */}
      {showForm ? (
        <Card className={portalPanelClassName('border-primary/20')}>
          <CardContent className="pt-4 space-y-4">
            <p className="text-sm font-medium">{editingId ? 'Edit Employment' : 'Add Employment'}</p>

            <div className="flex items-center justify-between">
              <Label className="text-sm">Current Employer</Label>
              <Switch checked={form.is_current} onCheckedChange={(v) => updateField('is_current', v)} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Employment Type</Label>
              <Select value={form.employment_type} onValueChange={(v) => updateField('employment_type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {employmentTypeOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Occupation / Role</Label>
              <Input value={form.occupation_role} onChange={(e) => updateField('occupation_role', e.target.value)} placeholder="Software Engineer" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Employer Name *</Label>
              <Input value={form.employer_name} onChange={(e) => updateField('employer_name', e.target.value)} placeholder="Company Pty Ltd" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Start Date</Label>
              <Input type="date" value={form.start_date} onChange={(e) => updateField('start_date', e.target.value)} />
            </div>

            {/* Income */}
            <div className="border-t pt-4 space-y-3">
              <Label className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="h-4 w-4" /> Income Details
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="number"
                    value={form.salary_amount || ''}
                    onChange={(e) => handleSalaryChange('salary_amount', e.target.value)}
                    className="pl-9"
                    placeholder="0"
                  />
                </div>
                <Select value={form.salary_frequency || 'annual'} onValueChange={v => handleSalaryChange('salary_frequency', v)}>
                  <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.salary_frequency !== 'annual' && (form.salary_amount || 0) > 0 && (
                <p className="text-xs text-muted-foreground">= {formatCurrency(grossAnnual)} per annum</p>
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
                    {([
                      { field: 'bonus' as const, label: 'Bonus (avg 2yr)' },
                      { field: 'allowance' as const, label: 'Allowance' },
                      { field: 'commission' as const, label: 'Commission' },
                      { field: 'overtime_essential' as const, label: 'OT (Essential)' },
                      { field: 'overtime_non_essential' as const, label: 'OT (Non-Essential)' },
                      { field: 'other_taxable_income' as const, label: 'Other Taxable' },
                    ]).map(({ field, label }) => (
                      <div key={field} className="space-y-1">
                        <Label className="text-xs">{label}</Label>
                        <div className="relative">
                          <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            type="number"
                            value={form[field] || ''}
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
              <Button variant="outline" onClick={resetForm} className="flex-1">Cancel</Button>
              <Button onClick={handleSubmit} disabled={mutation.isPending} className="flex-1">
                {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingId ? 'Update' : 'Add'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" size="sm" className="w-full" onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Employment
        </Button>
      )}
    </div>
  );
}
