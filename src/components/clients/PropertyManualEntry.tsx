import { useState, useEffect } from 'react';
import { AddressAutocomplete } from '@/components/shared/AddressAutocomplete';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { ADVISORY_SOURCE, isAdvisorySourced } from '@/utils/propertySourcing';
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
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Building2, Loader2, DollarSign, Percent, Home, Calculator, Info, Landmark, Shield, Key, Award, Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useNotifications } from '@/contexts/NotificationsContext';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MonthlyRepaymentField, computeMonthlyRepayment, type RepaymentType } from '@/components/shared/MonthlyRepaymentField';
import { OwnedOutrightToggle } from './OwnedOutrightToggle';
import { CurrencyInput } from '@/components/ui/currency-input';

interface PropertyManualEntryProps {
  clientId: string;
  onComplete: () => void;
}

type FrequencyType = 'monthly' | 'quarterly' | 'annually' | 'weekly';

interface ExpenseField {
  value: number;
  frequency: FrequencyType;
  monthlyValue: number;
}

type SourcedByType = 'npc' | 'client' | 'other_agency' | 'unknown';

interface PropertyFormData {
  property_type: 'owner_occupied' | 'investment' | 'smsf' | 'rental';
  address: string;
  value: number;
  loan_remaining: number;
  interest_rate: number;
  ownership_percentage: number;
  monthly_interest_repayment: number;
  repayment_type: RepaymentType;
  interest_only_period_years: number;
  autoCalculateInterest: boolean;
  // Expenses with frequency
  body_corporate: ExpenseField;
  council_rates: ExpenseField;
  water_rates: ExpenseField;
  repairs_maintenance: ExpenseField;
  property_management: ExpenseField;
  landlord_insurance: ExpenseField;
  building_insurance: ExpenseField;
  // Rental income with frequency
  rental_income: ExpenseField;
  // SMSF-specific fields
  smsf_fund_name: string;
  smsf_trustee_name: string;
  smsf_trustee_type: 'individual' | 'corporate';
  smsf_abn: string;
  smsf_compliance_status: 'compliant' | 'non_compliant' | 'pending_audit';
  smsf_auditor_name: string;
  // Deal sourcing
  sourced_by: SourcedByType;
  deal_closed_at: string;
  sourced_notes: string;
}

const createExpenseField = (value = 0, frequency: FrequencyType = 'monthly'): ExpenseField => ({
  value,
  frequency,
  monthlyValue: convertToMonthly(value, frequency),
});

const convertToMonthly = (value: number, frequency: FrequencyType): number => {
  switch (frequency) {
    case 'weekly':
      return value * (52 / 12); // Precise weeks per month
    case 'quarterly':
      return value / 3;
    case 'annually':
      return value / 12;
    case 'monthly':
    default:
      return value;
  }
};

const defaultFormData: PropertyFormData = {
  property_type: 'investment',
  address: '',
  value: 0,
  loan_remaining: 0,
  interest_rate: 5.90,
  ownership_percentage: 100,
  monthly_interest_repayment: 0,
  repayment_type: 'principal_and_interest',
  interest_only_period_years: 0,
  autoCalculateInterest: true,
  body_corporate: createExpenseField(0, 'quarterly'),
  council_rates: createExpenseField(0, 'quarterly'),
  water_rates: createExpenseField(0, 'quarterly'),
  repairs_maintenance: createExpenseField(0, 'annually'),
  property_management: createExpenseField(0, 'monthly'),
  landlord_insurance: createExpenseField(0, 'annually'),
  building_insurance: createExpenseField(0, 'annually'),
  rental_income: createExpenseField(0, 'weekly'),
  // SMSF defaults
  smsf_fund_name: '',
  smsf_trustee_name: '',
  smsf_trustee_type: 'individual',
  smsf_abn: '',
  smsf_compliance_status: 'compliant',
  smsf_auditor_name: '',
  // Deal sourcing defaults
  sourced_by: 'unknown',
  deal_closed_at: '',
  sourced_notes: '',
};

export function PropertyManualEntry({ clientId, onComplete }: PropertyManualEntryProps) {
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<PropertyFormData>(defaultFormData);
  const queryClient = useQueryClient();
  const { addNotification } = useNotifications();

  // Auto-calculate monthly repayment based on type (P&I = amortization, IO = loan × rate ÷ 12)
  useEffect(() => {
    if (formData.autoCalculateInterest && formData.loan_remaining > 0 && formData.interest_rate > 0) {
      const monthly = computeMonthlyRepayment(
        formData.loan_remaining,
        formData.interest_rate,
        formData.repayment_type,
      );
      setFormData(prev => ({ ...prev, monthly_interest_repayment: monthly }));
    }
  }, [formData.loan_remaining, formData.interest_rate, formData.autoCalculateInterest, formData.repayment_type]);

  const updateField = <K extends keyof PropertyFormData>(field: K, value: PropertyFormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  /** Local to the form; `loan_remaining: 0` is what it means in the record. */
  const [ownedOutright, setOwnedOutrightState] = useState(false);

  const setOwnedOutright = (next: boolean) => {
    setOwnedOutrightState(next);
    if (!next) return;
    setFormData(prev => ({
      ...prev,
      loan_remaining: 0,
      interest_rate: 0,
      monthly_interest_repayment: 0,
      autoCalculateInterest: false,
    }));
  };

  const updateNumberField = (field: keyof PropertyFormData, value: string) => {
    const numValue = parseFloat(value) || 0;
    // Typing a loan balance says this property is not owned outright.
    if (field === 'loan_remaining' && numValue > 0) setOwnedOutrightState(false);
    updateField(field, numValue as any);
  };

  const updateExpenseField = (
    field: keyof Pick<PropertyFormData, 'body_corporate' | 'council_rates' | 'water_rates' | 'repairs_maintenance' | 'property_management' | 'landlord_insurance' | 'building_insurance' | 'rental_income'>,
    key: 'value' | 'frequency',
    newValue: number | FrequencyType
  ) => {
    setFormData(prev => {
      const expense = prev[field];
      const updatedExpense = { ...expense };
      
      if (key === 'value') {
        updatedExpense.value = newValue as number;
        updatedExpense.monthlyValue = convertToMonthly(newValue as number, expense.frequency);
      } else {
        updatedExpense.frequency = newValue as FrequencyType;
        updatedExpense.monthlyValue = convertToMonthly(expense.value, newValue as FrequencyType);
      }
      
      return { ...prev, [field]: updatedExpense };
    });
  };

  // Calculate total monthly expenditure
  const totalMonthlyExpenditure = 
    formData.monthly_interest_repayment +
    formData.body_corporate.monthlyValue +
    formData.council_rates.monthlyValue +
    formData.water_rates.monthlyValue +
    formData.repairs_maintenance.monthlyValue +
    formData.property_management.monthlyValue +
    formData.landlord_insurance.monthlyValue +
    formData.building_insurance.monthlyValue;

  // Calculate net monthly cashflow
  const monthlyRentalIncome = formData.rental_income.monthlyValue;
  const netMonthlyCashflow = monthlyRentalIncome - totalMonthlyExpenditure;
  
  // Net Monthly Rental Position (rental income minus expenses excluding interest)
  const netMonthlyRentalPosition = monthlyRentalIncome - (totalMonthlyExpenditure - formData.monthly_interest_repayment);

  const createPropertyMutation = useMutation({
    mutationFn: async () => {
      // For rental properties, we store rent paid in a special way
      const isRental = formData.property_type === 'rental';
      
      const insertData = {
        client_id: clientId,
        property_type: formData.property_type,
        address: formData.address,
        // For rental properties, value and loan are not applicable
        value: isRental ? 0 : formData.value,
        loan_remaining: isRental ? 0 : formData.loan_remaining,
        interest_rate: isRental ? 0 : formData.interest_rate,
        ownership_percentage: isRental ? 0 : formData.ownership_percentage,
        monthly_interest_repayment: isRental ? 0 : formData.monthly_interest_repayment,
        repayment_type: isRental ? null : formData.repayment_type,
        interest_only_period_years: isRental ? null : (formData.repayment_type === 'interest_only' ? formData.interest_only_period_years || null : null),
        monthly_body_corporate: isRental ? 0 : formData.body_corporate.monthlyValue,
        monthly_council_rates: isRental ? 0 : formData.council_rates.monthlyValue,
        monthly_water_rates: isRental ? 0 : formData.water_rates.monthlyValue,
        monthly_repairs_maintenance: isRental ? 0 : formData.repairs_maintenance.monthlyValue,
        monthly_property_management: isRental ? 0 : formData.property_management.monthlyValue,
        monthly_landlord_insurance: isRental ? 0 : formData.landlord_insurance.monthlyValue,
        monthly_building_insurance: isRental ? 0 : formData.building_insurance.monthlyValue,
        // For rental properties, this stores the rent PAID (expense), not income
        monthly_rental_income: isRental ? monthlyRentalIncome : monthlyRentalIncome,
        weekly_rental_income: formData.rental_income.frequency === 'weekly' ? formData.rental_income.value : formData.rental_income.monthlyValue * (12 / 52),
        // For rental properties, total expenditure IS the rent paid
        total_monthly_expenditure: isRental ? monthlyRentalIncome : totalMonthlyExpenditure,
        // For rental properties, net cashflow is negative (expense)
        net_monthly_cashflow: isRental ? -monthlyRentalIncome : netMonthlyCashflow,
        // SMSF-specific fields
        smsf_fund_name: formData.property_type === 'smsf' ? formData.smsf_fund_name : null,
        smsf_trustee_name: formData.property_type === 'smsf' ? formData.smsf_trustee_name : null,
        smsf_trustee_type: formData.property_type === 'smsf' ? formData.smsf_trustee_type : null,
        smsf_abn: formData.property_type === 'smsf' ? formData.smsf_abn : null,
        smsf_compliance_status: formData.property_type === 'smsf' ? formData.smsf_compliance_status : null,
        smsf_auditor_name: formData.property_type === 'smsf' ? formData.smsf_auditor_name : null,
        // Deal sourcing — normalise legacy 'npc' to canonical 'advisory'
        sourced_by: formData.sourced_by === 'npc' ? ADVISORY_SOURCE : formData.sourced_by,
        deal_closed_at: isAdvisorySourced(formData.sourced_by) && formData.deal_closed_at ? formData.deal_closed_at : null,
        sourced_notes: formData.sourced_notes || null,
      };

      // Use secure Edge Function with HttpOnly cookie auth
      const { data, error: fnError } = await invokeSecureFunction('manage-client-data', {
        operation: 'create',
        table: 'client_properties',
        clientId,
        data: insertData,
      });
      
      if (fnError || !data?.success) {
        throw new Error(fnError?.message || data?.error || 'Failed to create property');
      }

      // Auto-update client deal_status when an internally-sourced property is added
      if (isAdvisorySourced(formData.sourced_by)) {
        try {
          await invokeSecureFunction('manage-client-data', {
            operation: 'update',
            table: 'clients',
            clientId,
            data: { 
              deal_status: 'closed',
              first_deal_closed_at: formData.deal_closed_at || new Date().toISOString(),
            },
          });
        } catch (e) {
          console.warn('Failed to auto-update client deal_status:', e);
        }
      }
    },
    onSuccess: () => {
      // Broad invalidation so the BC calculator and any other downstream
      // consumer (scorecard, dashboards, scenarios) immediately reflect the
      // newly added property without showing stale figures.
      queryClient.invalidateQueries({ queryKey: ['client-properties', clientId] });
      queryClient.invalidateQueries({ queryKey: ['secure-client-data', clientId] });
      queryClient.invalidateQueries({ queryKey: ['secure-client-properties', clientId] });
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-client-data', clientId] });
      queryClient.invalidateQueries({ queryKey: ['client-data', clientId] });
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-history', clientId] });
      queryClient.invalidateQueries({ queryKey: ['get-client-data'] });
      toast.success('Property added successfully');

      const propertyTypeLabel =
        formData.property_type === 'investment' ? 'investment' :
        formData.property_type === 'smsf' ? 'SMSF' :
        formData.property_type === 'rental' ? 'rental (tenant)' :
        'owner-occupied';

      addNotification({
        type: 'portfolio_updated',
        title: formData.property_type === 'rental' ? 'Personal Expense Added' : 'Portfolio Updated',
        message: `New ${propertyTypeLabel} property added: ${formData.address}`,
        entityId: clientId
      });

      setFormData(defaultFormData);
      setOpen(false);
      onComplete();
    },
    onError: (error: any) => {
      toast.error('Failed to add property: ' + error.message);
    },
  });

  const handleSubmit = () => {
    if (!formData.address.trim()) {
      toast.error('Please enter an address');
      return;
    }
    if (formData.property_type === 'smsf' && !formData.smsf_fund_name.trim()) {
      toast.error('Please enter the SMSF fund name');
      return;
    }
    if (formData.property_type === 'rental' && formData.rental_income.value <= 0) {
      toast.error('Please enter the rent you pay');
      return;
    }
    createPropertyMutation.mutate();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const renderExpenseInput = (
    label: string,
    field: keyof Pick<PropertyFormData, 'body_corporate' | 'council_rates' | 'water_rates' | 'repairs_maintenance' | 'property_management' | 'landlord_insurance' | 'building_insurance' | 'rental_income'>,
    showMonthlyEquivalent = true,
  ) => {
    const expense = formData[field];
    return (
      <div className="space-y-2">
        <Label className="text-xs">{label}</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <CurrencyInput
              value={expense.value || null}
              onValueChange={(v) => updateExpenseField(field, 'value', v ?? 0)}
              className="pl-7 h-9 text-sm"
              placeholder="0"
            />
          </div>
          <Select value={expense.frequency} onValueChange={(v) => updateExpenseField(field, 'frequency', v as FrequencyType)}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
              <SelectItem value="annually">Annually</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {showMonthlyEquivalent && expense.frequency !== 'monthly' && expense.value > 0 && (
          <p className="text-xs text-muted-foreground">
            = {formatCurrency(expense.monthlyValue)}/month
          </p>
        )}
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Add Property
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Add Property
          </SheetTitle>
          <SheetDescription>
            Add a property matching Formara template format
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-180px)] pr-4">
          <div className="space-y-6 py-4">
            {/* Property Type Selection */}
            <Card className="border-primary/20">
              <CardContent className="pt-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Property Type</Label>
                    <Select
                      value={formData.property_type}
                      onValueChange={(v) => updateField('property_type', v as 'owner_occupied' | 'investment' | 'smsf' | 'rental')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner_occupied">
                          <div className="flex items-center gap-2">
                            <Home className="h-4 w-4" />
                            Owner Occupied
                          </div>
                        </SelectItem>
                        <SelectItem value="investment">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4" />
                            Investment Property
                          </div>
                        </SelectItem>
                        <SelectItem value="smsf">
                          <div className="flex items-center gap-2">
                            <Landmark className="h-4 w-4" />
                            SMSF (Self-Managed Super Fund)
                          </div>
                        </SelectItem>
                        <SelectItem value="rental">
                          <div className="flex items-center gap-2">
                            <Key className="h-4 w-4" />
                            Rental Property (Tenant)
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="address">Address *</Label>
                    <AddressAutocomplete
                      id="address"
                      value={formData.address}
                      onChange={(value) => updateField('address', value)}
                      placeholder="123 Main Street, Sydney NSW 2000"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Deal Sourcing Section */}
            <Card className="border-success/20">
              <CardContent className="pt-4">
                <div className="space-y-4">
                  <h4 className="text-sm font-medium flex items-center gap-2 text-success">
                    <Award className="h-4 w-4" />
                    Deal Sourcing
                  </h4>
                  
                  <div className="space-y-2">
                    <Label>Sourced By</Label>
                    <Select
                      value={formData.sourced_by}
                      onValueChange={(v) => updateField('sourced_by', v as SourcedByType)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unknown">Unknown</SelectItem>
                        <SelectItem value="advisory">Our Agency</SelectItem>
                        <SelectItem value="client">Self-sourced (Client)</SelectItem>
                        <SelectItem value="other_agency">Other Agency</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {isAdvisorySourced(formData.sourced_by) && (
                    <div className="space-y-2">
                      <Label>Deal Closed Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !formData.deal_closed_at && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {formData.deal_closed_at 
                              ? format(new Date(formData.deal_closed_at), 'PPP')
                              : 'Pick a date'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={formData.deal_closed_at ? new Date(formData.deal_closed_at) : undefined}
                            onSelect={(date) => updateField('deal_closed_at', date ? date.toISOString() : '')}
                            initialFocus
                            className={cn("p-3 pointer-events-auto")}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}

                  {formData.sourced_by === 'other_agency' && (
                    <div className="space-y-2">
                      <Label>Agency Name / Notes</Label>
                      <Input
                        value={formData.sourced_notes}
                        onChange={(e) => updateField('sourced_notes', e.target.value)}
                        placeholder="e.g. XYZ Buyer's Agency"
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* SMSF Details - Only shown when SMSF is selected */}
            {formData.property_type === 'smsf' && (
              <Card className="border-brand-500/30 bg-brand-500/5">
                <CardContent className="pt-4">
                  <div className="space-y-4">
                    <h4 className="text-sm font-medium flex items-center gap-2 text-brand-600">
                      <Shield className="h-4 w-4" />
                      SMSF Details & Compliance
                    </h4>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Fund Name <span className="text-destructive">*</span></Label>
                        <Input
                          value={formData.smsf_fund_name}
                          onChange={(e) => updateField('smsf_fund_name', e.target.value)}
                          placeholder="Smith Family Super Fund"
                          className={!formData.smsf_fund_name.trim() ? 'border-destructive/50' : ''}
                        />
                        {!formData.smsf_fund_name.trim() && (
                          <p className="text-xs text-destructive">Required for SMSF properties</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>ABN</Label>
                        <Input
                          value={formData.smsf_abn}
                          onChange={(e) => updateField('smsf_abn', e.target.value)}
                          placeholder="12 345 678 901"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Trustee Name</Label>
                        <Input
                          value={formData.smsf_trustee_name}
                          onChange={(e) => updateField('smsf_trustee_name', e.target.value)}
                          placeholder="John Smith"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Trustee Type</Label>
                        <Select
                          value={formData.smsf_trustee_type}
                          onValueChange={(v) => updateField('smsf_trustee_type', v as 'individual' | 'corporate')}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="individual">Individual Trustee</SelectItem>
                            <SelectItem value="corporate">Corporate Trustee</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Separator />

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Compliance Status</Label>
                        <Select
                          value={formData.smsf_compliance_status}
                          onValueChange={(v) => updateField('smsf_compliance_status', v as 'compliant' | 'non_compliant' | 'pending_audit')}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="compliant">
                              <span className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-success" />
                                Compliant
                              </span>
                            </SelectItem>
                            <SelectItem value="pending_audit">
                              <span className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-brand-500" />
                                Pending Audit
                              </span>
                            </SelectItem>
                            <SelectItem value="non_compliant">
                              <span className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-destructive" />
                                Non-Compliant
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Auditor Name</Label>
                        <Input
                          value={formData.smsf_auditor_name}
                          onChange={(e) => updateField('smsf_auditor_name', e.target.value)}
                          placeholder="SMSF Auditor Pty Ltd"
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Rental Property Details - Only shown when Rental is selected */}
            {formData.property_type === 'rental' && (
              <Card className="border-info/30 bg-info/5">
                <CardContent className="pt-4">
                  <div className="space-y-4">
                    <h4 className="text-sm font-medium flex items-center gap-2 text-info">
                      <Key className="h-4 w-4" />
                      Rental Details (You Are a Tenant)
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      This property is where you currently live and pay rent. The rent you pay will be treated as a personal expense in borrowing capacity calculations.
                    </p>
                    
                    {renderExpenseInput("Rent You Pay", "rental_income")}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Financial Details - Not shown for Rental properties */}
            {formData.property_type !== 'rental' && (
            <div className="space-y-4">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Financial Details
              </h4>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Value</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <CurrencyInput
                      value={formData.value || null}
                      onValueChange={(v) => updateNumberField('value', v === null ? '' : String(v))}
                      className="pl-9"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Loan Remaining ($)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <CurrencyInput
                      value={formData.loan_remaining || null}
                      onValueChange={(v) => updateNumberField('loan_remaining', v === null ? '' : String(v))}
                      className="pl-9"
                      placeholder={ownedOutright ? 'No loan' : '0'}
                      disabled={ownedOutright}
                    />
                  </div>
                </div>
              </div>

              {/* See OwnedOutrightToggle: a recorded zero and an unrecorded
                  loan drew the same empty box. */}
              <OwnedOutrightToggle ownedOutright={ownedOutright} onChange={setOwnedOutright} />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Interest Rate (%)</Label>
                  <div className="relative">
                    <Percent className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.interest_rate || ''}
                      onChange={(e) => updateNumberField('interest_rate', e.target.value)}
                      className="pl-9"
                      placeholder="5.90"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Ownership (%)</Label>
                  <div className="relative">
                    <Percent className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type="number"
                      value={formData.ownership_percentage || ''}
                      onChange={(e) => updateNumberField('ownership_percentage', e.target.value)}
                      className="pl-9"
                      placeholder="100"
                    />
                  </div>
                </div>
              </div>

              {/* Unified Monthly Loan Repayment with P&I / IO toggle */}
              <MonthlyRepaymentField
                monthlyAmount={formData.monthly_interest_repayment}
                repaymentType={formData.repayment_type}
                interestOnlyYears={formData.interest_only_period_years}
                autoCalculate={formData.autoCalculateInterest}
                loanBalance={formData.loan_remaining}
                interestRate={formData.interest_rate}
                onChange={(next) => setFormData(prev => ({
                  ...prev,
                  monthly_interest_repayment: next.monthlyAmount,
                  repayment_type: next.repaymentType,
                  interest_only_period_years: next.interestOnlyYears,
                  autoCalculateInterest: next.autoCalculate,
                  ...(next.derivedInterestRate !== undefined ? { interest_rate: next.derivedInterestRate } : {}),
                }))}
              />
            </div>
            )}

            {/* Monthly Expenses - Only for Investment Properties */}
            {formData.property_type === 'investment' && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h4 className="text-sm font-medium">Monthly Expenses (with frequency conversion)</h4>
                  
                  <div className="grid gap-4">
                    {renderExpenseInput("Body Corporate/Strata Fees", "body_corporate")}
                    {renderExpenseInput("Council Rate Charges", "council_rates")}
                    {renderExpenseInput("Water Rate Charges", "water_rates")}
                    {renderExpenseInput("Repairs & Maintenance", "repairs_maintenance")}
                    {renderExpenseInput("Property Management Fees", "property_management")}
                    {renderExpenseInput("Landlord Insurance", "landlord_insurance")}
                    {renderExpenseInput("Building Insurance", "building_insurance")}
                  </div>
                </div>

                <Separator />

                {/* Rental Income */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium">Rental Income</h4>
                  {renderExpenseInput("Rental Income", "rental_income")}
                </div>
              </>
            )}

            <Separator />

            {/* Summary Card */}
            <Card className="bg-muted/50 border-0">
              <CardContent className="pt-4 space-y-3">
                <h4 className="font-medium text-sm">
                  {formData.property_type === 'rental' ? 'Personal Expense Summary' : 'Cashflow Summary'}
                </h4>
                
                {formData.property_type === 'investment' && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Monthly Rental Income</span>
                      <span className="font-medium text-success">
                        {formatCurrency(monthlyRentalIncome)}
                      </span>
                    </div>
                  </>
                )}

                {formData.property_type === 'rental' && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Monthly Rent You Pay</span>
                      <span className="font-medium text-destructive">
                        -{formatCurrency(monthlyRentalIncome)}
                      </span>
                    </div>
                    <Separator />
                    <div className="flex justify-between text-sm font-medium">
                      <span>Personal Expense (Commitment)</span>
                      <span className="text-destructive">
                        -{formatCurrency(monthlyRentalIncome)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This will be added to your existing commitments when calculating borrowing capacity.
                    </p>
                  </>
                )}
                
                {formData.property_type !== 'rental' && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Monthly Interest Repayment</span>
                    <span className="font-medium text-destructive">
                      -{formatCurrency(formData.monthly_interest_repayment)}
                    </span>
                  </div>
                )}
                
                {formData.property_type === 'investment' && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Other Monthly Expenses</span>
                    <span className="font-medium text-destructive">
                      -{formatCurrency(totalMonthlyExpenditure - formData.monthly_interest_repayment)}
                    </span>
                  </div>
                )}
                
                {formData.property_type !== 'rental' && (
                  <>
                    <Separator />
                    
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Expenditure</span>
                      <span className="font-medium text-destructive">
                        {formatCurrency(formData.property_type === 'owner_occupied' ? formData.monthly_interest_repayment : totalMonthlyExpenditure)}
                      </span>
                    </div>
                  </>
                )}
                
                {formData.property_type === 'investment' && (
                  <>
                    <div className="flex justify-between text-sm font-medium">
                      <span>Net Monthly Cashflow</span>
                      <span className={netMonthlyCashflow >= 0 ? 'text-success' : 'text-destructive'}>
                        {formatCurrency(netMonthlyCashflow)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Net Monthly Rental Position</span>
                      <span className={netMonthlyRentalPosition >= 0 ? 'text-success' : 'text-destructive'}>
                        {formatCurrency(netMonthlyRentalPosition)}
                      </span>
                    </div>
                  </>
                )}
                
                {formData.property_type === 'owner_occupied' && (
                  <div className="flex justify-between text-sm font-medium">
                    <span>Net Monthly Cashflow</span>
                    <span className="text-destructive">
                      -{formatCurrency(formData.monthly_interest_repayment)}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>

        <SheetFooter className="pt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleSubmit}
            disabled={createPropertyMutation.isPending}
          >
            {createPropertyMutation.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Add Property
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
