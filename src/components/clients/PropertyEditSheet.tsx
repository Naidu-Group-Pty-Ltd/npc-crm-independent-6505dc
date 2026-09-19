import { useState, useEffect } from 'react';
import { AddressAutocomplete } from '@/components/shared/AddressAutocomplete';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LenderCombobox } from './LenderCombobox';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { ADVISORY_SOURCE, isAdvisorySourced } from '@/utils/propertySourcing';
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
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, Loader2, DollarSign, Percent, Home, Calculator, Info, Landmark, Shield, Trash2, Trophy, Key } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
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

type SourcedByType = 'npc' | 'self_sourced' | 'other_agency' | 'unknown';

interface PropertyData {
  id: string;
  client_id: string;
  property_type: string;
  address: string;
  value: number | null;
  loan_remaining: number | null;
  interest_rate: number | null;
  ownership_percentage: number | null;
  monthly_interest_repayment: number | null;
  monthly_body_corporate: number | null;
  monthly_council_rates: number | null;
  monthly_water_rates: number | null;
  monthly_repairs_maintenance: number | null;
  monthly_property_management: number | null;
  monthly_landlord_insurance: number | null;
  monthly_building_insurance: number | null;
  monthly_rental_income: number | null;
  weekly_rental_income: number | null;
  total_monthly_expenditure: number | null;
  net_monthly_cashflow: number | null;
  purchase_price: number | null;
  purchase_date: string | null;
  smsf_fund_name: string | null;
  smsf_trustee_name: string | null;
  smsf_trustee_type: string | null;
  smsf_abn: string | null;
  smsf_compliance_status: string | null;
  smsf_auditor_name: string | null;
  sourced_by?: string | null;
  deal_closed_at?: string | null;
  sourced_notes?: string | null;
  loan_repayment_amount?: number | null;
  loan_repayment_frequency?: string | null;
  lender_name?: string | null;
  repayment_type?: string | null;
  interest_only_period_years?: number | null;
}

interface PropertyEditSheetProps {
  property: PropertyData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

type FrequencyType = 'monthly' | 'quarterly' | 'annually' | 'weekly';

interface ExpenseField {
  value: number;
  frequency: FrequencyType;
  monthlyValue: number;
}

interface PropertyFormData {
  property_type: 'owner_occupied' | 'investment' | 'smsf' | 'rental';
  address: string;
  value: number;
  purchase_price: number;
  purchase_date: string;
  loan_remaining: number;
  interest_rate: number;
  ownership_percentage: number;
  monthly_interest_repayment: number;
  repayment_type: RepaymentType;
  interest_only_period_years: number;
  autoCalculateInterest: boolean;
  body_corporate: ExpenseField;
  council_rates: ExpenseField;
  water_rates: ExpenseField;
  repairs_maintenance: ExpenseField;
  property_management_percent: number; // percentage of rental income
  landlord_insurance: ExpenseField;
  building_insurance: ExpenseField;
  rental_income: ExpenseField;
  smsf_fund_name: string;
  smsf_trustee_name: string;
  smsf_trustee_type: 'individual' | 'corporate';
  smsf_abn: string;
  smsf_compliance_status: 'compliant' | 'non_compliant' | 'pending_audit';
  smsf_auditor_name: string;
  sourced_by: SourcedByType;
  deal_closed_at: string;
  sourced_notes: string;
  lender_name: string;
}

const convertToMonthly = (value: number, frequency: FrequencyType): number => {
  switch (frequency) {
    case 'weekly':
      return value * (52 / 12);
    case 'quarterly':
      return value / 3;
    case 'annually':
      return value / 12;
    case 'monthly':
    default:
      return value;
  }
};

const createExpenseField = (monthlyValue: number = 0): ExpenseField => ({
  value: monthlyValue,
  frequency: 'monthly',
  monthlyValue: monthlyValue,
});

export function PropertyEditSheet({ property, open, onOpenChange, onComplete }: PropertyEditSheetProps) {
  const queryClient = useQueryClient();
  const { addNotification } = useNotifications();
  
  const [formData, setFormData] = useState<PropertyFormData>({
    property_type: 'investment',
    address: '',
    value: 0,
    purchase_price: 0,
    purchase_date: '',
    loan_remaining: 0,
    interest_rate: 5.90,
    ownership_percentage: 100,
    monthly_interest_repayment: 0,
    repayment_type: 'principal_and_interest',
    interest_only_period_years: 0,
    autoCalculateInterest: false,
    body_corporate: createExpenseField(),
    council_rates: createExpenseField(),
    water_rates: createExpenseField(),
    repairs_maintenance: createExpenseField(),
    property_management_percent: 0,
    landlord_insurance: createExpenseField(),
    building_insurance: createExpenseField(),
    rental_income: createExpenseField(),
    smsf_fund_name: '',
    smsf_trustee_name: '',
    smsf_trustee_type: 'individual',
    smsf_abn: '',
    smsf_compliance_status: 'compliant',
    smsf_auditor_name: '',
    sourced_by: 'unknown',
    deal_closed_at: '',
    sourced_notes: '',
    lender_name: '',
  });

  /**
   * Whether this property is owned outright.
   *
   * Local to the form and never persisted — `loan_remaining: 0` is already
   * what "no loan" means to every reader (equity, LVR, serviceability). The
   * toggle exists because the loan input renders `value={loan_remaining || ''}`,
   * so a recorded zero and an unrecorded loan drew the same empty box and an
   * owner-occupied home owned outright could not be SAID. A second stored
   * column would be a second place that answers the same question.
   *
   * Seeded from the record: on a valued property, a zero loan IS owned
   * outright; there is no other reading of it.
   */
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

  // Populate form with existing property data when sheet opens
  useEffect(() => {
    if (open && property) {
      setOwnedOutrightState(
        Number(property.loan_remaining) === 0 && Number(property.value) > 0,
      );
      setFormData({
        property_type: (property.property_type as 'owner_occupied' | 'investment' | 'smsf' | 'rental') || 'investment',
        address: property.address || '',
        value: Number(property.value) || 0,
        purchase_price: Number(property.purchase_price) || 0,
        purchase_date: property.purchase_date || '',
        loan_remaining: Number(property.loan_remaining) || 0,
        interest_rate: Number(property.interest_rate) || 5.90,
        ownership_percentage: Number(property.ownership_percentage) || 100,
        monthly_interest_repayment: Number(property.monthly_interest_repayment) || 0,
        repayment_type: (property.repayment_type as RepaymentType) || 'principal_and_interest',
        interest_only_period_years: Number(property.interest_only_period_years) || 0,
        autoCalculateInterest: false,
        body_corporate: createExpenseField(Number(property.monthly_body_corporate) || 0),
        council_rates: createExpenseField(Number(property.monthly_council_rates) || 0),
        water_rates: createExpenseField(Number(property.monthly_water_rates) || 0),
        repairs_maintenance: createExpenseField(Number(property.monthly_repairs_maintenance) || 0),
        // Derive PM percentage from stored dollar value and rental income
        property_management_percent: (Number(property.monthly_property_management) && Number(property.monthly_rental_income))
          ? Math.round(((Number(property.monthly_property_management) / Number(property.monthly_rental_income)) * 100) * 100) / 100
          : 0,
        landlord_insurance: createExpenseField(Number(property.monthly_landlord_insurance) || 0),
        building_insurance: createExpenseField(Number(property.monthly_building_insurance) || 0),
        rental_income: createExpenseField(Number(property.monthly_rental_income) || 0),
        smsf_fund_name: property.smsf_fund_name || '',
        smsf_trustee_name: property.smsf_trustee_name || '',
        smsf_trustee_type: (property.smsf_trustee_type as 'individual' | 'corporate') || 'individual',
        smsf_abn: property.smsf_abn || '',
        smsf_compliance_status: (property.smsf_compliance_status as 'compliant' | 'non_compliant' | 'pending_audit') || 'compliant',
        smsf_auditor_name: property.smsf_auditor_name || '',
        sourced_by: (property.sourced_by as SourcedByType) || 'unknown',
        deal_closed_at: property.deal_closed_at ? property.deal_closed_at.split('T')[0] : '',
        sourced_notes: property.sourced_notes || '',
        lender_name: property.lender_name || '',
      });
    }
  }, [open, property]);

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

  const updateNumberField = (field: keyof PropertyFormData, value: string) => {
    const numValue = parseFloat(value) || 0;
    // Typing a loan balance is itself an answer: the property is not owned
    // outright. Leaving the toggle on while a figure is typed would let the
    // two disagree.
    if (field === 'loan_remaining' && numValue > 0) setOwnedOutrightState(false);
    updateField(field, numValue as any);
  };

  const updateExpenseField = (
    field: keyof Pick<PropertyFormData, 'body_corporate' | 'council_rates' | 'water_rates' | 'repairs_maintenance' | 'landlord_insurance' | 'building_insurance' | 'rental_income'>,
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
  // Calculate property management monthly value from percentage
  const monthlyRentalIncome = formData.rental_income.monthlyValue;
  const monthlyPropertyManagement = (formData.property_management_percent / 100) * monthlyRentalIncome;

  const totalMonthlyExpenditure =
    formData.monthly_interest_repayment +
    formData.body_corporate.monthlyValue +
    formData.council_rates.monthlyValue +
    formData.water_rates.monthlyValue +
    formData.repairs_maintenance.monthlyValue +
    monthlyPropertyManagement +
    formData.landlord_insurance.monthlyValue +
    formData.building_insurance.monthlyValue;

  // Calculate net monthly cashflow
  const netMonthlyCashflow = monthlyRentalIncome - totalMonthlyExpenditure;

  const updatePropertyMutation = useMutation({
    mutationFn: async () => {
      const isRental = formData.property_type === 'rental';
      const updateData = {
        property_type: formData.property_type,
        address: formData.address,
        value: isRental ? 0 : formData.value,
        purchase_price: isRental ? null : (formData.purchase_price || null),
        purchase_date: isRental ? null : (formData.purchase_date || null),
        loan_remaining: isRental ? 0 : formData.loan_remaining,
        interest_rate: isRental ? 0 : formData.interest_rate,
        ownership_percentage: isRental ? 0 : formData.ownership_percentage,
        monthly_interest_repayment: isRental ? 0 : formData.monthly_interest_repayment,
        monthly_body_corporate: isRental ? 0 : formData.body_corporate.monthlyValue,
        monthly_council_rates: isRental ? 0 : formData.council_rates.monthlyValue,
        monthly_water_rates: isRental ? 0 : formData.water_rates.monthlyValue,
        monthly_repairs_maintenance: isRental ? 0 : formData.repairs_maintenance.monthlyValue,
        monthly_property_management: isRental ? 0 : monthlyPropertyManagement,
        monthly_landlord_insurance: isRental ? 0 : formData.landlord_insurance.monthlyValue,
        monthly_building_insurance: isRental ? 0 : formData.building_insurance.monthlyValue,
        monthly_rental_income: monthlyRentalIncome,
        weekly_rental_income: formData.rental_income.frequency === 'weekly' ? formData.rental_income.value : monthlyRentalIncome * (12 / 52),
        total_monthly_expenditure: isRental ? monthlyRentalIncome : totalMonthlyExpenditure,
        net_monthly_cashflow: isRental ? -monthlyRentalIncome : netMonthlyCashflow,
        smsf_fund_name: formData.property_type === 'smsf' ? formData.smsf_fund_name : null,
        smsf_trustee_name: formData.property_type === 'smsf' ? formData.smsf_trustee_name : null,
        smsf_trustee_type: formData.property_type === 'smsf' ? formData.smsf_trustee_type : null,
        smsf_abn: formData.property_type === 'smsf' ? formData.smsf_abn : null,
        smsf_compliance_status: formData.property_type === 'smsf' ? formData.smsf_compliance_status : null,
        smsf_auditor_name: formData.property_type === 'smsf' ? formData.smsf_auditor_name : null,
        sourced_by: formData.sourced_by === 'npc' ? ADVISORY_SOURCE : formData.sourced_by,
        deal_closed_at: isAdvisorySourced(formData.sourced_by) && formData.deal_closed_at ? formData.deal_closed_at : null,
        sourced_notes: formData.sourced_notes || null,
        loan_repayment_amount: null, // deprecated — superseded by monthly_interest_repayment + repayment_type
        loan_repayment_frequency: null,
        repayment_type: isRental ? null : formData.repayment_type,
        interest_only_period_years: isRental ? null : (formData.repayment_type === 'interest_only' ? formData.interest_only_period_years || null : null),
        lender_name: isRental ? null : (formData.lender_name || null),
      };

      // ── Resilient update with single transient-error retry ──
      // Cold-started edge functions occasionally throw a network/abort error
      // on the first call. We retry once before surfacing the failure to
      // avoid spurious "failed to update property" toasts when the data is
      // actually fine to save on a second attempt.
      const tryUpdate = async () => {
        return invokeSecureFunction('manage-client-data', {
          operation: 'update',
          table: 'client_properties',
          clientId: property.client_id,
          recordId: property.id,
          data: updateData,
        });
      };

      let { data, error } = await tryUpdate();

      const isTransient = (msg?: string) =>
        !!msg && /network|timed out|fetch|aborted|ECONN|HTTP 5\d\d/i.test(msg);

      if ((error || !data?.success) && isTransient(error?.message || data?.error)) {
        console.warn('[PropertyEditSheet] First update attempt failed transiently — retrying once', {
          message: error?.message || data?.error,
        });
        await new Promise((r) => setTimeout(r, 400));
        const retry = await tryUpdate();
        data = retry.data;
        error = retry.error;
      }

      if (error || !data?.success) {
        throw new Error(error?.message || data?.error || 'Failed to update property');
      }

      // Auto-update client deal_status when an internally-sourced property is saved
      if (isAdvisorySourced(formData.sourced_by)) {
        try {
          const clientUpdateData: Record<string, any> = { deal_status: 'closed' };
          if (formData.deal_closed_at) {
            clientUpdateData.first_deal_closed_at = formData.deal_closed_at;
          }
          await invokeSecureFunction('manage-client-data', {
            operation: 'update',
            table: 'clients',
            clientId: property.client_id,
            data: clientUpdateData,
          });
        } catch (e) {
          console.warn('Failed to auto-update client deal status:', e);
        }
      }
    },
    onSuccess: () => {
      // Invalidate every cache that depends on property data so downstream
      // surfaces (BC calculator, BC modal, scenarios, scorecard, dashboard
      // metrics, etc.) reflect the change immediately. Previously the BC
      // modal kept its own ['borrowing-capacity-client-data'] cache that
      // wasn't invalidated here — opening the BC calculator after editing
      // a property's repayment_type would silently use stale data.
      queryClient.invalidateQueries({ queryKey: ['client-properties', property.client_id] });
      queryClient.invalidateQueries({ queryKey: ['secure-client-data', property.client_id] });
      queryClient.invalidateQueries({ queryKey: ['secure-client-properties', property.client_id] });
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-client-data', property.client_id] });
      queryClient.invalidateQueries({ queryKey: ['client-data', property.client_id] });
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-history', property.client_id] });
      queryClient.invalidateQueries({ queryKey: ['get-client-data'] });
      toast.success('Property updated successfully');

      addNotification({
        type: 'portfolio_updated',
        title: 'Property Updated',
        message: `Property at ${formData.address} has been updated`,
        entityId: property.client_id
      });

      onOpenChange(false);
      onComplete();
    },
    onError: (error: any) => {
      toast.error('Failed to update property: ' + error.message);
    },
  });

  const deletePropertyMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'client_properties',
        clientId: property.client_id,
        recordId: property.id,
      });
      
      if (error || !data?.success) {
        throw new Error(error?.message || data?.error || 'Failed to delete property');
      }
    },
    onSuccess: () => {
      // Same broad invalidation as the update path so the BC calculator
      // and other downstream surfaces never serve stale post-deletion data.
      queryClient.invalidateQueries({ queryKey: ['client-properties', property.client_id] });
      queryClient.invalidateQueries({ queryKey: ['secure-client-data', property.client_id] });
      queryClient.invalidateQueries({ queryKey: ['secure-client-properties', property.client_id] });
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-client-data', property.client_id] });
      queryClient.invalidateQueries({ queryKey: ['client-data', property.client_id] });
      queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-history', property.client_id] });
      queryClient.invalidateQueries({ queryKey: ['get-client-data'] });
      toast.success('Property deleted successfully');

      addNotification({
        type: 'portfolio_updated',
        title: 'Property Deleted',
        message: `Property at ${property.address} has been removed`,
        entityId: property.client_id
      });

      onOpenChange(false);
      onComplete();
    },
    onError: (error: any) => {
      toast.error('Failed to delete property: ' + error.message);
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
    updatePropertyMutation.mutate();
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
    field: keyof Pick<PropertyFormData, 'body_corporate' | 'council_rates' | 'water_rates' | 'repairs_maintenance' | 'landlord_insurance' | 'building_insurance' | 'rental_income'>,
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Edit Property
            <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              Residential
            </span>
          </SheetTitle>
          <SheetDescription>
            Update property details. For commercial or industrial assets, use the dedicated property pages —
            they feed the hybrid borrowing-capacity engine automatically when linked to this client.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-200px)] pr-4">
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

            {/* Rental Details - Only shown when Rental is selected */}
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

            {/* Deal Sourcing */}
            <Card className="border-primary/20">
              <CardContent className="pt-4">
                <div className="space-y-4">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Trophy className="h-4 w-4" />
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
                        <SelectItem value="advisory">Our Deal</SelectItem>
                        <SelectItem value="self_sourced">Self-sourced by Client</SelectItem>
                        <SelectItem value="other_agency">Other Agency</SelectItem>
                        <SelectItem value="unknown">Unknown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {isAdvisorySourced(formData.sourced_by) && (
                    <div className="space-y-2">
                      <Label>Deal Closed Date</Label>
                      <Input
                        type="date"
                        value={formData.deal_closed_at}
                        onChange={(e) => updateField('deal_closed_at', e.target.value)}
                      />
                    </div>
                  )}

                  {(formData.sourced_by === 'other_agency' || isAdvisorySourced(formData.sourced_by)) && (
                    <div className="space-y-2">
                      <Label>{formData.sourced_by === 'other_agency' ? 'Agency Name / Notes' : 'Notes'}</Label>
                      <Textarea
                        value={formData.sourced_notes}
                        onChange={(e) => updateField('sourced_notes', e.target.value)}
                        placeholder={formData.sourced_by === 'other_agency' ? 'Enter agency name or details...' : 'Any notes about this deal...'}
                        rows={2}
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

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

              <OwnedOutrightToggle ownedOutright={ownedOutright} onChange={setOwnedOutright} />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Purchase Price ($)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <CurrencyInput
                      value={formData.purchase_price || null}
                      onValueChange={(v) => updateNumberField('purchase_price', v === null ? '' : String(v))}
                      className="pl-9"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Purchase Date</Label>
                  <Input
                    type="date"
                    value={formData.purchase_date || ''}
                    onChange={(e) => updateField('purchase_date', e.target.value)}
                  />
                </div>
              </div>

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

              <div className="space-y-2">
                <Label className="text-xs">Lender / Bank</Label>
                <LenderCombobox
                  value={formData.lender_name}
                  onChange={(v) => updateField('lender_name', v)}
                />
              </div>
            </div>
            )}

            {/* Rental Income - Only for investment/smsf */}
            {(formData.property_type === 'investment' || formData.property_type === 'smsf') && (
              <>
                <Separator />
                <div className="space-y-4">
                  <h4 className="text-sm font-medium">Rental Income</h4>
                  {renderExpenseInput("Rental Income", "rental_income")}
                </div>

                <Separator />
                <div className="space-y-4">
                  <h4 className="text-sm font-medium">Monthly Expenses</h4>
                  <div className="grid grid-cols-2 gap-4">
                    {renderExpenseInput("Body Corporate", "body_corporate")}
                    {renderExpenseInput("Council Rates", "council_rates")}
                    {renderExpenseInput("Water Rates", "water_rates")}
                    {renderExpenseInput("Repairs & Maintenance", "repairs_maintenance")}
                    <div className="space-y-2">
                      <Label className="text-xs">Property Management (%)</Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Percent className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            type="number"
                            step="0.1"
                            value={formData.property_management_percent || ''}
                            onChange={(e) => updateField('property_management_percent', parseFloat(e.target.value) || 0)}
                            className="pl-7 h-9 text-sm"
                            placeholder="e.g. 7.5"
                          />
                        </div>
                      </div>
                      {monthlyPropertyManagement > 0 && (
                        <p className="text-xs text-muted-foreground">
                          = ${Math.round(monthlyPropertyManagement).toLocaleString('en-AU')}/month
                        </p>
                      )}
                    </div>
                    {renderExpenseInput("Landlord Insurance", "landlord_insurance")}
                    {renderExpenseInput("Building Insurance", "building_insurance")}
                  </div>
                </div>

                {/* Summary */}
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Monthly Rental Income</span>
                        <span className="text-success font-medium">{formatCurrency(monthlyRentalIncome)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Monthly Expenses</span>
                        <span className="text-destructive font-medium">-{formatCurrency(totalMonthlyExpenditure)}</span>
                      </div>
                      <Separator />
                      <div className="flex justify-between font-bold">
                        <span>Net Monthly Cash Flow</span>
                        <span className={netMonthlyCashflow >= 0 ? 'text-success' : 'text-destructive'}>
                          {formatCurrency(netMonthlyCashflow)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </ScrollArea>

        <SheetFooter className="flex-row justify-between gap-2 pt-4">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Property?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the property at "{property.address}". This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deletePropertyMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deletePropertyMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Delete'
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button onClick={handleSubmit} disabled={updatePropertyMutation.isPending}>
            {updatePropertyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
