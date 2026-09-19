import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Loader2, MapPin, Search, DollarSign, Percent, Home, Building2, Key,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePortalUpdateData } from '@/hooks/usePortalData';
import { MonthlyRepaymentField, computeMonthlyRepayment, type RepaymentType } from '@/components/shared/MonthlyRepaymentField';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/env';


interface Prediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

type FrequencyType = 'monthly' | 'quarterly' | 'annually' | 'weekly';

interface ExpenseField {
  value: number;
  frequency: FrequencyType;
  monthlyValue: number;
}

const convertToMonthly = (value: number, frequency: FrequencyType): number => {
  switch (frequency) {
    case 'weekly': return value * (52 / 12);
    case 'quarterly': return value / 3;
    case 'annually': return value / 12;
    default: return value;
  }
};

const createExpenseField = (value = 0, frequency: FrequencyType = 'monthly'): ExpenseField => ({
  value,
  frequency,
  monthlyValue: convertToMonthly(value, frequency),
});

interface PropertyFormData {
  property_type: 'owner_occupied' | 'investment' | 'rental';
  address: string;
  value: number;
  purchase_price: number;
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
  property_management: ExpenseField;
  landlord_insurance: ExpenseField;
  building_insurance: ExpenseField;
  rental_income: ExpenseField;
}

const defaultFormData: PropertyFormData = {
  property_type: 'investment',
  address: '',
  value: 0,
  purchase_price: 0,
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
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

interface PortalPropertyFormProps {
  existingProperty?: any;
  onComplete: () => void;
  onCancel: () => void;
}

export function PortalPropertyForm({ existingProperty, onComplete, onCancel }: PortalPropertyFormProps) {
  const isEditing = !!existingProperty?.id;
  const mutation = usePortalUpdateData();

  const [formData, setFormData] = useState<PropertyFormData>(() => {
    if (existingProperty) {
      return {
        property_type: existingProperty.property_type || 'investment',
        address: existingProperty.address || '',
        value: Number(existingProperty.value) || 0,
        purchase_price: Number(existingProperty.purchase_price) || 0,
        loan_remaining: Number(existingProperty.loan_remaining) || 0,
        interest_rate: Number(existingProperty.interest_rate) || 5.90,
        ownership_percentage: Number(existingProperty.ownership_percentage) || 100,
        monthly_interest_repayment: Number(existingProperty.monthly_interest_repayment) || 0,
        repayment_type: (existingProperty.repayment_type as RepaymentType) || 'principal_and_interest',
        interest_only_period_years: Number(existingProperty.interest_only_period_years) || 0,
        autoCalculateInterest: false,
        body_corporate: createExpenseField(Number(existingProperty.monthly_body_corporate) || 0),
        council_rates: createExpenseField(Number(existingProperty.monthly_council_rates) || 0),
        water_rates: createExpenseField(Number(existingProperty.monthly_water_rates) || 0),
        repairs_maintenance: createExpenseField(Number(existingProperty.monthly_repairs_maintenance) || 0),
        property_management: createExpenseField(Number(existingProperty.monthly_property_management) || 0),
        landlord_insurance: createExpenseField(Number(existingProperty.monthly_landlord_insurance) || 0),
        building_insurance: createExpenseField(Number(existingProperty.monthly_building_insurance) || 0),
        rental_income: createExpenseField(Number(existingProperty.monthly_rental_income) || 0),
      };
    }
    return { ...defaultFormData };
  });

  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showPredictions, setShowPredictions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowPredictions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-calculate repayment based on type (P&I = amortization, IO = loan × rate ÷ 12)
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

  const updateNumber = (field: keyof PropertyFormData, value: string) => {
    updateField(field, (parseFloat(value) || 0) as any);
  };

  const updateExpense = (
    field: keyof Pick<PropertyFormData, 'body_corporate' | 'council_rates' | 'water_rates' | 'repairs_maintenance' | 'property_management' | 'landlord_insurance' | 'building_insurance' | 'rental_income'>,
    key: 'value' | 'frequency',
    newValue: number | FrequencyType
  ) => {
    setFormData(prev => {
      const expense = prev[field];
      const updated = { ...expense };
      if (key === 'value') {
        updated.value = newValue as number;
        updated.monthlyValue = convertToMonthly(newValue as number, expense.frequency);
      } else {
        updated.frequency = newValue as FrequencyType;
        updated.monthlyValue = convertToMonthly(expense.value, newValue as FrequencyType);
      }
      return { ...prev, [field]: updated };
    });
  };

  const searchPlaces = useCallback(async (input: string) => {
    if (input.length < 3) { setPredictions([]); return; }
    setSearchLoading(true);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/google-places-autocomplete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
        credentials: 'omit',
        body: JSON.stringify({ input }),
      });
      const data = await response.json();
      if (data.success) { setPredictions(data.predictions || []); setShowPredictions(true); }
    } catch (err) { console.error('Places search error:', err); }
    finally { setSearchLoading(false); }
  }, []);

  const handleAddressChange = (value: string) => {
    updateField('address', value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchPlaces(value), 300);
  };

  const isRental = formData.property_type === 'rental';
  const monthlyRentalIncome = formData.rental_income.monthlyValue;

  const totalMonthlyExpenditure =
    formData.monthly_interest_repayment +
    formData.body_corporate.monthlyValue +
    formData.council_rates.monthlyValue +
    formData.water_rates.monthlyValue +
    formData.repairs_maintenance.monthlyValue +
    formData.property_management.monthlyValue +
    formData.landlord_insurance.monthlyValue +
    formData.building_insurance.monthlyValue;

  const netMonthlyCashflow = monthlyRentalIncome - totalMonthlyExpenditure;

  const handleSubmit = async () => {
    if (!formData.address.trim()) { toast.error('Please enter an address'); return; }
    if (isRental && formData.rental_income.value <= 0) { toast.error('Please enter the rent you pay'); return; }

    const data: Record<string, any> = {
      property_type: formData.property_type,
      address: formData.address,
      value: isRental ? 0 : formData.value,
      purchase_price: isRental ? null : (formData.purchase_price || null),
      loan_remaining: isRental ? 0 : formData.loan_remaining,
      interest_rate: isRental ? 0 : formData.interest_rate,
      ownership_percentage: isRental ? 0 : formData.ownership_percentage,
      monthly_interest_repayment: isRental ? 0 : formData.monthly_interest_repayment,
      monthly_body_corporate: isRental ? 0 : formData.body_corporate.monthlyValue,
      monthly_council_rates: isRental ? 0 : formData.council_rates.monthlyValue,
      monthly_water_rates: isRental ? 0 : formData.water_rates.monthlyValue,
      monthly_repairs_maintenance: isRental ? 0 : formData.repairs_maintenance.monthlyValue,
      monthly_property_management: isRental ? 0 : formData.property_management.monthlyValue,
      monthly_landlord_insurance: isRental ? 0 : formData.landlord_insurance.monthlyValue,
      monthly_building_insurance: isRental ? 0 : formData.building_insurance.monthlyValue,
      monthly_rental_income: monthlyRentalIncome,
      weekly_rental_income: formData.rental_income.frequency === 'weekly'
        ? formData.rental_income.value
        : monthlyRentalIncome * (12 / 52),
      total_monthly_expenditure: isRental ? monthlyRentalIncome : totalMonthlyExpenditure,
      net_monthly_cashflow: isRental ? -monthlyRentalIncome : netMonthlyCashflow,
      repayment_type: isRental ? null : formData.repayment_type,
      interest_only_period_years: isRental ? null : (formData.repayment_type === 'interest_only' ? formData.interest_only_period_years || null : null),
    };

    try {
      await mutation.mutateAsync({
        operation: isEditing ? 'update' : 'insert',
        table: 'client_properties',
        id: existingProperty?.id,
        data,
      });
      toast.success(isEditing ? 'Property updated!' : 'Property added!');
      onComplete();
    } catch (err: any) {
      toast.error('Failed to save property: ' + (err.message || 'Unknown error'));
    }
  };

  const renderExpenseInput = (
    label: string,
    field: keyof Pick<PropertyFormData, 'body_corporate' | 'council_rates' | 'water_rates' | 'repairs_maintenance' | 'property_management' | 'landlord_insurance' | 'building_insurance' | 'rental_income'>,
  ) => {
    const expense = formData[field];
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{label}</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="number"
              value={expense.value || ''}
              onChange={(e) => updateExpense(field, 'value', parseFloat(e.target.value) || 0)}
              className="pl-7 h-9 text-sm"
              placeholder="0"
            />
          </div>
          <Select value={expense.frequency} onValueChange={(v) => updateExpense(field, 'frequency', v as FrequencyType)}>
            <SelectTrigger className="w-[100px] h-9 text-xs">
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
        {expense.frequency !== 'monthly' && expense.value > 0 && (
          <p className="text-[10px] text-muted-foreground">= {formatCurrency(expense.monthlyValue)}/month</p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Property Type */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Property Type</Label>
            <Select value={formData.property_type} onValueChange={(v) => updateField('property_type', v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner_occupied">
                  <div className="flex items-center gap-2"><Home className="h-4 w-4" /> Owner Occupied</div>
                </SelectItem>
                <SelectItem value="investment">
                  <div className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Investment Property</div>
                </SelectItem>
                <SelectItem value="rental">
                  <div className="flex items-center gap-2"><Key className="h-4 w-4" /> Rental (Tenant)</div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Address */}
          <div className="relative" ref={wrapperRef}>
            <Label className="text-sm font-medium">Property Address *</Label>
            <div className="relative mt-1.5">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Start typing an address..."
                value={formData.address}
                onChange={(e) => handleAddressChange(e.target.value)}
                onFocus={() => predictions.length > 0 && setShowPredictions(true)}
                className="pl-9 pr-9"
              />
              {searchLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {showPredictions && predictions.length > 0 && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
                {predictions.map((p) => (
                  <button
                    key={p.placeId}
                    onClick={() => { updateField('address', p.description); setPredictions([]); setShowPredictions(false); }}
                    className="w-full text-left px-4 py-3 hover:bg-accent transition-colors flex items-start gap-3 border-b border-border/50 last:border-0"
                  >
                    <Search className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{p.mainText}</p>
                      <p className="text-xs text-muted-foreground truncate">{p.secondaryText}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">Powered by Google — select a suggestion for accuracy</p>
          </div>
        </CardContent>
      </Card>

      {/* Rental-specific */}
      {isRental && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Key className="h-4 w-4 text-primary" /> Rent You Pay
            </Label>
            <p className="text-xs text-muted-foreground">This will be treated as a personal expense.</p>
            {renderExpenseInput("Rent Amount", "rental_income")}
          </CardContent>
        </Card>
      )}

      {/* Financial Details (non-rental) */}
      {!isRental && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <Label className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> Financial Details
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Purchase Price</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input type="number" value={formData.purchase_price || ''} onChange={(e) => updateNumber('purchase_price', e.target.value)} className="pl-7 h-9" placeholder="0" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Current Value</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input type="number" value={formData.value || ''} onChange={(e) => updateNumber('value', e.target.value)} className="pl-7 h-9" placeholder="0" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Loan Remaining</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input type="number" value={formData.loan_remaining || ''} onChange={(e) => updateNumber('loan_remaining', e.target.value)} className="pl-7 h-9" placeholder="0" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Interest Rate (%)</Label>
                <div className="relative">
                  <Percent className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input type="number" step="0.01" value={formData.interest_rate || ''} onChange={(e) => updateNumber('interest_rate', e.target.value)} className="pl-7 h-9" placeholder="5.90" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Ownership (%)</Label>
                <div className="relative">
                  <Percent className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input type="number" value={formData.ownership_percentage || ''} onChange={(e) => updateNumber('ownership_percentage', e.target.value)} className="pl-7 h-9" placeholder="100" />
                </div>
              </div>
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                {/* Unified Monthly Loan Repayment */}
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
                  compact
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Expenses (investment only) */}
      {formData.property_type === 'investment' && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <Label className="text-sm font-medium">Monthly Expenses</Label>
            <div className="space-y-3">
              {renderExpenseInput("Body Corporate / Strata", "body_corporate")}
              {renderExpenseInput("Council Rates", "council_rates")}
              {renderExpenseInput("Water Rates", "water_rates")}
              {renderExpenseInput("Repairs & Maintenance", "repairs_maintenance")}
              {renderExpenseInput("Property Management", "property_management")}
              {renderExpenseInput("Landlord Insurance", "landlord_insurance")}
              {renderExpenseInput("Building Insurance", "building_insurance")}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rental Income (investment only) */}
      {formData.property_type === 'investment' && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <Label className="text-sm font-medium">Rental Income</Label>
            {renderExpenseInput("Rental Income", "rental_income")}
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <Card className="bg-muted/50 border-0">
        <CardContent className="pt-4 space-y-2">
          <p className="font-medium text-sm">{isRental ? 'Expense Summary' : 'Cashflow Summary'}</p>
          {formData.property_type === 'investment' && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Monthly Rental Income</span>
                <span className="font-medium text-success dark:text-success">{formatCurrency(monthlyRentalIncome)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Monthly Expenses</span>
                <span className="font-medium text-destructive">-{formatCurrency(totalMonthlyExpenditure)}</span>
              </div>
              <Separator />
              <div className="flex justify-between text-sm font-medium">
                <span>Net Monthly Cashflow</span>
                <span className={netMonthlyCashflow >= 0 ? 'text-success dark:text-success' : 'text-destructive'}>
                  {formatCurrency(netMonthlyCashflow)}
                </span>
              </div>
            </>
          )}
          {formData.property_type === 'owner_occupied' && (
            <div className="flex justify-between text-sm font-medium">
              <span>Monthly Repayment</span>
              <span className="text-destructive">-{formatCurrency(formData.monthly_interest_repayment)}</span>
            </div>
          )}
          {isRental && (
            <div className="flex justify-between text-sm font-medium">
              <span>Monthly Rent (Expense)</span>
              <span className="text-destructive">-{formatCurrency(monthlyRentalIncome)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1" disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={mutation.isPending} className="flex-1">
          {mutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
          {isEditing ? 'Update Property' : 'Add Property'}
        </Button>
      </div>
    </div>
  );
}
