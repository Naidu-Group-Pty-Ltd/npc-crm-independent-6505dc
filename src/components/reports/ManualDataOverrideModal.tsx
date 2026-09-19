import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { invokeSecureFunction } from '@/lib/secureInvoke';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { useToast } from '@/hooks/use-toast';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { useSidebar } from '@/components/ui/sidebar';
import {
  getManualOverrideShellVariables,
  MANUAL_OVERRIDE_CONTENT_CLASSNAME,
  MANUAL_OVERRIDE_OVERLAY_CLASSNAME,
} from './manualOverrideLayout';
import { OVERRIDE_FIELD_PATHS, resolveOriginalFieldValue } from './overrideOriginalValue';
import { AlertCircle, RotateCcw, Save, Calculator, ExternalLink, ChevronDown, ChevronRight, ArrowRight, Check, Table, Copy, Banknote, Info, FileText, TrendingUp, Sparkles, Loader2 } from 'lucide-react';
import { Table as UITable, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { STATE_MAPPING } from '@/lib/states';
import { StampDutyCalculatorPanel } from './StampDutyCalculatorPanel';
import { defaultDutiableValue, dutiableValueBases } from './dutiableValueBasis';
import type { BuildType } from '@/types/overrideFields';
import {
  AUSTRALIAN_STATES,
  type AustralianState,
  type PropertyCategory,
  type PurchaseIntent,
} from '@/utils/stampDutyCalculator';
import { MortgageRepaymentCalculator } from './MortgageRepaymentCalculator';
import { DepreciationValueCalculator } from './DepreciationValueCalculator';
import { LandTaxCalculator } from './LandTaxCalculator';
import { LoanType, RepaymentFrequency, get10YearLoanProjection } from '@/utils/mortgageCalculations';
import { formatNumberWithCommas, removeCommas } from '@/hooks/useFormattedNumber';

interface InvestmentReport {
  id: string;
  property_address: string;
  financial_calculations?: any;
  manual_overrides?: any;
}

interface ManualDataOverrideModalProps {
  report: InvestmentReport | null;
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void | Promise<void>;
}

interface OverrideField {
  key: string;
  label: string;
  originalValue: number | string | null;
  overrideValue: number | string | null;
  prefix?: string;
  suffix?: string;
  type?: 'number' | 'select';
  options?: { value: string; label: string }[];
  isCashFlowField?: boolean; // New fields for cash flow analysis
}

export function ManualDataOverrideModal({ report, isOpen, onClose, onSave }: ManualDataOverrideModalProps) {
  const { toast } = useToast();
  const breakpoint = useBreakpoint();
  const { state: sidebarState } = useSidebar();
  const shellVariables = getManualOverrideShellVariables(sidebarState, breakpoint === 'desktop');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, any>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [cashFlowFieldToggles, setCashFlowFieldToggles] = useState<Record<string, boolean>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [includeDepreciationInCashFlow, setIncludeDepreciationInCashFlow] = useState(true);
  const [showDepreciationCalculator, setShowDepreciationCalculator] = useState(false);
  const [showStampDutyCalculator, setShowStampDutyCalculator] = useState(false);
  const [showLandTaxCalculator, setShowLandTaxCalculator] = useState(false);
  const [detectedState, setDetectedState] = useState<string>('All');
  const [showMortgageCalculator, setShowMortgageCalculator] = useState(false);
  const [estimatingExpenses, setEstimatingExpenses] = useState(false);
  const [expenseCitations, setExpenseCitations] = useState<string[]>([]);
  const [stampDutyStateOverride, setStampDutyStateOverride] = useState<AustralianState | null>(null);
  const [stampDutyIntent, setStampDutyIntent] = useState<PurchaseIntent>('investor');
  const [stampDutyCategory, setStampDutyCategory] = useState<PropertyCategory>('established');
  const [dutiableValueOverride, setDutiableValueOverride] = useState<number | null>(null);
  const [stampDutyFirstHomeBuyer, setStampDutyFirstHomeBuyer] = useState(false);
  const [stampDutyForeignBuyer, setStampDutyForeignBuyer] = useState(false);
  
  // Active tab state
  const [activeTab, setActiveTab] = useState<'investment' | 'cashflow'>('investment');
  
  // Construction Schedule Preset Mode: 'rapid' | 'even' | 'custom'
  type SchedulePreset = 'rapid' | 'even' | 'custom';
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>('rapid');
  
  // Custom stage month positions (for 'custom' mode) - stage index (0-5) to month number
  // Stages: 0=Deposit, 1=Slab, 2=Frame, 3=Lock-up, 4=Fixing, 5=Completion
  const [customStageMonths, setCustomStageMonths] = useState<{ [stageIndex: number]: number }>({
    0: 2, // Deposit
    1: 3, // Slab/Base
    2: 4, // Frame
    3: 5, // Lock-up
    4: 6, // Fixing
    5: 7, // Practical Completion
  });
  
  // Depreciation Schedule Builder state
  const [showDepreciationSchedule, setShowDepreciationSchedule] = useState(false);
  const [depreciationMethod, setDepreciationMethod] = useState<'prime_cost' | 'diminishing_value'>('prime_cost');
  const [depreciationSchedule, setDepreciationSchedule] = useState<Record<number, number>>({});
  const [year1Depreciation, setYear1Depreciation] = useState<number>(0);

  // Detect state from property address
  const detectStateFromAddress = useCallback((address: string): string => {
    if (!address) return 'All';
    const upperAddress = address.toUpperCase();
    
    // Check for state abbreviations (commonly at end of address like "Sydney, NSW 2000")
    for (const abbr of Object.keys(STATE_MAPPING)) {
      // Match state abbreviation with word boundaries or at end
      const patterns = [
        new RegExp(`\\b${abbr}\\b`),  // Word boundary match
        new RegExp(`\\s${abbr}\\s*\\d{4}`),  // Before postcode
        new RegExp(`,\\s*${abbr}\\s`),  // After comma
      ];
      if (patterns.some(p => p.test(upperAddress))) {
        return abbr;
      }
    }
    
    // Check for full state names
    for (const [abbr, fullName] of Object.entries(STATE_MAPPING)) {
      if (upperAddress.includes(fullName.toUpperCase())) {
        return abbr;
      }
    }
    
    return 'All';
  }, []);

  // Detect state when report changes
  useEffect(() => {
    if (report?.property_address) {
      const state = detectStateFromAddress(report.property_address);
      setDetectedState(state);
    }
  }, [report?.property_address, detectStateFromAddress]);

  /**
   * The jurisdiction the calculator assesses against. Detected from the
   * property address unless the user picks another; `detectedState` is a
   * free-form string that can be 'All', so it is narrowed rather than trusted.
   *
   * The detected value used to be passed to a third-party iframe as a query
   * parameter that the vendor's script never read, so every assessment silently
   * defaulted to New South Wales regardless of where the property was.
   */
  const stampDutyState: AustralianState = useMemo(() => {
    if (stampDutyStateOverride) return stampDutyStateOverride;
    const candidate = (detectedState || '').toUpperCase();
    return (AUSTRALIAN_STATES as readonly string[]).includes(candidate)
      ? (candidate as AustralianState)
      : 'NSW';
  }, [stampDutyStateOverride, detectedState]);

  // Hoisted above the stamp duty derivations, which need to know whether this is
  // a house-and-land package before they can pick a default dutiable value.
  const currentBuildType = overrides.buildType || report?.manual_overrides?.buildType || 'existing_property';
  const isNewBuild = currentBuildType === 'new_build';

  const stampDutyPurchasePrice = useMemo(() => {
    const price = overrides.purchasePrice
      ?? report?.financial_calculations?.purchasePrice
      ?? report?.financial_calculations?.propertyValue
      ?? 0;
    return Number(price) || 0;
  }, [overrides.purchasePrice, report?.financial_calculations]);

  const stampDutyLandPrice = useMemo(() => {
    const land = overrides.landPrice
      ?? report?.manual_overrides?.landPrice
      ?? report?.financial_calculations?.landPrice
      ?? 0;
    return Number(land) || 0;
  }, [overrides.landPrice, report?.manual_overrides, report?.financial_calculations]);

  /**
   * What duty is assessed on. A new build defaults to the land price because
   * duty on a house-and-land package falls on the land contract — see
   * `dutiableValueBasis.ts`. An explicit edit wins from then on.
   */
  const dutiableInputs = useMemo(
    () => ({
      buildType: currentBuildType as BuildType,
      purchasePrice: stampDutyPurchasePrice,
      landPrice: stampDutyLandPrice,
    }),
    [currentBuildType, stampDutyPurchasePrice, stampDutyLandPrice],
  );
  const stampDutyDutiableValue = dutiableValueOverride ?? defaultDutiableValue(dutiableInputs);
  const stampDutyBases = useMemo(() => dutiableValueBases(dutiableInputs), [dutiableInputs]);

  const useStampDutyValue = useCallback((totalDuty: number) => {
    const value = Math.round(totalDuty);
    setOverrides(prev => ({ ...prev, stampDuty: value }));
    setHasChanges(true);
    toast({
      title: 'Stamp duty applied',
      description: `$${formatNumberWithCommas(String(value))} has been applied to your analysis.`,
    });
  }, [toast]);

  // AI-powered expense estimation function
  const handleEstimateExpenses = useCallback(async () => {
    if (!report) return;
    
    setEstimatingExpenses(true);
    try {
      const purchasePrice = overrides.purchasePrice ?? report?.financial_calculations?.purchasePrice ?? report?.financial_calculations?.propertyValue ?? 0;
      const weeklyRent = overrides.weeklyRent ?? report?.financial_calculations?.weeklyRent ?? 0;
      
      const { data, error } = await invokeSecureFunction('estimate-property-expenses', {
        propertyAddress: report.property_address,
        purchasePrice,
        weeklyRent,
        propertyType: report?.financial_calculations?.propertyType || 'Unknown'
      });

      if (error) throw error;
      
      if (data?.success && data?.estimates) {
        const estimates = data.estimates;
        
        // Apply all estimated values to overrides
        // Letting fees = weekly rent (cascade value)
        setOverrides(prev => ({
          ...prev,
          bodyCorporateFees: estimates.bodyCorporateFees,
          landTax: estimates.landTax,
          councilRates: estimates.councilRates,
          waterRates: estimates.waterRates,
          solicitorFees: estimates.solicitorFees,
          buildingLandlordInsurance: estimates.buildingLandlordInsurance,
          propertyManagementFees: estimates.propertyManagementFees,
          repairsMaintenance: estimates.repairsMaintenance,
          lettingFees: weeklyRent, // Letting fees = 1 week's rent
        }));
        setHasChanges(true);
        
        // Store citations if available
        if (data?.citations && Array.isArray(data.citations)) {
          setExpenseCitations(data.citations);
        }
        
        toast({
          title: "Expenses Estimated",
          description: `AI has populated expense fields based on real-time data.${data?.citations?.length ? ` Found ${data.citations.length} sources.` : ''}`,
        });
      } else {
        throw new Error(data?.error || 'Failed to estimate expenses');
      }
    } catch (error) {
      console.error('Error estimating expenses:', error);
      const errorMessage = error instanceof Error ? error.message : "Could not estimate expenses. Please try again.";
      const isAuthError = errorMessage.includes('401') || errorMessage.includes('Authentication') || errorMessage.includes('Unauthorized');
      toast({
        title: "Estimation Failed",
        description: isAuthError 
          ? "Session expired. Please log out and log back in, then try again."
          : errorMessage,
        variant: "destructive"
      });
    } finally {
      setEstimatingExpenses(false);
    }
  }, [report, overrides.purchasePrice, overrides.weeklyRent, toast]);

  // Define the confirmed input fields for manual overrides
  // Get current build type from overrides (default to 'existing_property')

  // ========== INVESTMENT REPORT TAB FIELDS ==========
  
  // Core property details (Investment Report Tab)
  const corePropertyFields: OverrideField[] = [
    {
      key: 'buildType',
      label: 'Build Type',
      originalValue: report?.manual_overrides?.buildType || 'existing_property',
      overrideValue: report?.manual_overrides?.buildType || null,
      type: 'select',
      options: [
        { value: 'new_build', label: 'New Build' },
        { value: 'existing_property', label: 'Existing Property' },
        { value: 'land_only', label: 'Land Only' }
      ]
    },
    {
      key: 'propertyType',
      label: 'Property Type',
      originalValue: report?.financial_calculations?.propertyType || 'house',
      overrideValue: report?.manual_overrides?.propertyType || null,
      type: 'select',
      options: [
        { value: 'house', label: 'House' },
        { value: 'apartment', label: 'Apartment/Unit' },
        { value: 'townhouse', label: 'Townhouse' },
        { value: 'villa', label: 'Villa' },
        { value: 'land', label: 'Vacant Land' }
      ]
    },
    {
      key: 'purchasePrice',
      label: 'Purchase Price',
      originalValue: report?.financial_calculations?.purchasePrice || report?.financial_calculations?.propertyValue || null,
      overrideValue: report?.manual_overrides?.purchasePrice || null,
      prefix: '$'
    },
    {
      key: 'landPrice',
      label: 'Land Price',
      originalValue: report?.financial_calculations?.landPrice || null,
      overrideValue: report?.manual_overrides?.landPrice || null,
      prefix: '$'
    },
    {
      key: 'buildPrice',
      label: 'Build Price',
      originalValue: report?.financial_calculations?.buildPrice || null,
      overrideValue: report?.manual_overrides?.buildPrice || null,
      prefix: '$'
    },
    {
      key: 'carSpaces',
      label: 'Car Spaces',
      originalValue: report?.financial_calculations?.carSpaces || null,
      overrideValue: report?.manual_overrides?.carSpaces || null
    },
    // Only show deposit value for existing properties (not new builds)
    ...(!isNewBuild ? [{
      key: 'depositValue',
      label: 'Deposit Value',
      originalValue: report?.financial_calculations?.depositValue || null,
      overrideValue: report?.manual_overrides?.depositValue || null,
      prefix: '$'
    }] : []),
    {
      key: 'loanToValueRatio',
      label: 'Loan to Value Ratio',
      originalValue: report?.financial_calculations?.loanToValueRatio || null,
      overrideValue: report?.manual_overrides?.loanToValueRatio || null,
      suffix: '%'
    },
    {
      key: 'interestRate',
      label: 'Interest Rate',
      originalValue: report?.financial_calculations?.interestRate || null,
      overrideValue: report?.manual_overrides?.interestRate || null,
      suffix: '%'
    },
    {
      key: 'capitalGrowth',
      label: 'Capital Growth',
      originalValue: report?.financial_calculations?.capitalGrowth || null,
      overrideValue: report?.manual_overrides?.capitalGrowth || null,
      suffix: '%'
    },
  ];

  const rentalIncomeFields: OverrideField[] = [
    {
      key: 'weeklyRent',
      label: 'Weekly Rent',
      originalValue: report?.financial_calculations?.weeklyRent || null,
      overrideValue: report?.manual_overrides?.weeklyRent || null,
      prefix: '$'
    },
  ];

  const annualExpenseFields: OverrideField[] = [
    {
      key: 'stampDuty',
      label: 'Stamp Duty',
      originalValue: report?.financial_calculations?.stampDuty || null,
      overrideValue: report?.manual_overrides?.stampDuty || null,
      prefix: '$'
    },
    {
      key: 'isFirstHomeBuyer',
      label: 'First Home Buyer',
      originalValue: report?.manual_overrides?.isFirstHomeBuyer || false,
      overrideValue: report?.manual_overrides?.isFirstHomeBuyer || null,
      type: 'select',
      options: [
        { value: 'true', label: 'Yes - Eligible for concessions' },
        { value: 'false', label: 'No' }
      ]
    },
    {
      key: 'bodyCorporateFees',
      label: 'Body Corporate / Strata Fees',
      originalValue: report?.financial_calculations?.bodyCorporateFees || report?.financial_calculations?.strataFees || null,
      overrideValue: report?.manual_overrides?.bodyCorporateFees || null,
      prefix: '$'
    },
    {
      key: 'strataAdminFund',
      label: 'Strata Admin Fund',
      originalValue: report?.financial_calculations?.strataAdminFund || null,
      overrideValue: report?.manual_overrides?.strataAdminFund || null,
      prefix: '$'
    },
    {
      key: 'strataSinkingFund',
      label: 'Strata Sinking Fund',
      originalValue: report?.financial_calculations?.strataSinkingFund || null,
      overrideValue: report?.manual_overrides?.strataSinkingFund || null,
      prefix: '$'
    },
    {
      key: 'strataSpecialLevies',
      label: 'Strata Special Levies',
      originalValue: report?.financial_calculations?.strataSpecialLevies || null,
      overrideValue: report?.manual_overrides?.strataSpecialLevies || null,
      prefix: '$'
    },
    {
      key: 'landTax',
      label: 'Land Tax',
      originalValue: report?.financial_calculations?.landTax || report?.financial_calculations?.annualCosts?.landTax || null,
      overrideValue: report?.manual_overrides?.landTax || null,
      prefix: '$'
    },
    {
      key: 'councilRates',
      label: 'Council Rate Charges',
      originalValue: report?.financial_calculations?.councilRates || null,
      overrideValue: report?.manual_overrides?.councilRates || null,
      prefix: '$'
    },
    {
      key: 'waterRates',
      label: 'Water Rate Charges (Other)',
      originalValue: report?.financial_calculations?.waterRates || null,
      overrideValue: report?.manual_overrides?.waterRates || null,
      prefix: '$'
    },
    {
      key: 'solicitorFees',
      label: 'Solicitor Fees',
      originalValue: report?.financial_calculations?.solicitorFees || report?.financial_calculations?.legalFees || null,
      overrideValue: report?.manual_overrides?.solicitorFees || null,
      prefix: '$'
    },
    {
      key: 'buildingLandlordInsurance',
      label: 'Building & Landlord Insurance',
      originalValue: report?.financial_calculations?.buildingLandlordInsurance || null,
      overrideValue: report?.manual_overrides?.buildingLandlordInsurance || null,
      prefix: '$'
    },
    {
      key: 'propertyManagementFees',
      label: 'Property Management Fees',
      originalValue: report?.financial_calculations?.propertyManagementFees || null,
      overrideValue: report?.manual_overrides?.propertyManagementFees || null,
      suffix: '%'
    },
    {
      key: 'repairsMaintenance',
      label: 'Repairs & Maintenance',
      originalValue: report?.financial_calculations?.repairsMaintenance || null,
      overrideValue: report?.manual_overrides?.repairsMaintenance || null,
      prefix: '$'
    },
    {
      key: 'lettingFees',
      label: 'Letting Fees (1 Week Rent)',
      originalValue: report?.financial_calculations?.lettingFees || null,
      overrideValue: report?.manual_overrides?.lettingFees || null,
      prefix: '$'
    },
    // Only show agent fee for new builds
    ...(isNewBuild ? [{
      key: 'agentFee',
      label: 'Agent Fee (Commission)',
      originalValue: report?.financial_calculations?.agentFee || null,
      overrideValue: report?.manual_overrides?.agentFee || null,
      prefix: '$',
      isCashFlowField: true
    }] : []),
  ];


  const propertySpecFields: OverrideField[] = [
    {
      key: 'landSizeSqm',
      label: 'Land Size',
      originalValue: report?.financial_calculations?.landSizeSqm || null,
      overrideValue: report?.manual_overrides?.landSizeSqm || null,
      suffix: 'm²'
    },
    {
      key: 'buildSizeSqm',
      label: 'Build Size',
      originalValue: report?.financial_calculations?.buildSizeSqm || null,
      overrideValue: report?.manual_overrides?.buildSizeSqm || null,
      suffix: 'm²'
    }
  ];

  // ========== CASH FLOW ANALYSIS TAB FIELDS ==========
  
  // Loan & Mortgage settings (Cash Flow Tab)
  const cashFlowLoanFields: OverrideField[] = [
    {
      key: 'marketValueNow',
      label: 'Market Value Now',
      originalValue: report?.financial_calculations?.marketValueNow || null,
      overrideValue: report?.manual_overrides?.marketValueNow || null,
      prefix: '$',
      isCashFlowField: true
    },
    {
      key: 'loanAmount',
      label: 'Loan Amount',
      originalValue: report?.financial_calculations?.loanAmount || null,
      overrideValue: report?.manual_overrides?.loanAmount || null,
      prefix: '$',
      isCashFlowField: true
    },
    {
      key: 'loanType',
      label: 'Loan Type',
      originalValue: report?.financial_calculations?.loanType || null,
      overrideValue: report?.manual_overrides?.loanType || null,
      type: 'select',
      options: [
        { value: 'interest_only', label: 'Interest Only' },
        { value: 'principal_interest', label: 'Principal & Interest' }
      ],
      isCashFlowField: true
    },
    {
      key: 'loanTermYears',
      label: 'Loan Term',
      originalValue: report?.financial_calculations?.loanTermYears || null,
      overrideValue: report?.manual_overrides?.loanTermYears || null,
      suffix: 'years',
      isCashFlowField: true
    },
    {
      key: 'interestOnlyPeriodYears',
      label: 'Interest Only Period',
      originalValue: report?.financial_calculations?.interestOnlyPeriodYears || null,
      overrideValue: report?.manual_overrides?.interestOnlyPeriodYears || null,
      suffix: 'years',
      isCashFlowField: true
    },
    {
      key: 'repaymentFrequency',
      label: 'Repayment Frequency',
      originalValue: report?.financial_calculations?.repaymentFrequency || 'monthly',
      overrideValue: report?.manual_overrides?.repaymentFrequency || null,
      type: 'select',
      options: [
        { value: 'weekly', label: 'Weekly (52/year)' },
        { value: 'fortnightly', label: 'Fortnightly (26/year)' },
        { value: 'monthly', label: 'Monthly (12/year)' }
      ],
      isCashFlowField: true
    },
    {
      key: 'extraRepaymentPerMonth',
      label: 'Extra Repayment (Monthly)',
      originalValue: report?.financial_calculations?.extraRepaymentPerMonth || 0,
      overrideValue: report?.manual_overrides?.extraRepaymentPerMonth || null,
      prefix: '$',
      isCashFlowField: true
    },
    {
      key: 'offsetBalance',
      label: 'Offset Account Balance',
      originalValue: report?.financial_calculations?.offsetBalance || 0,
      overrideValue: report?.manual_overrides?.offsetBalance || null,
      prefix: '$',
      isCashFlowField: true
    },
    {
      key: 'occupancyRate',
      label: 'Occupancy Rate',
      originalValue: report?.financial_calculations?.occupancyRate || 52,
      overrideValue: report?.manual_overrides?.occupancyRate || null,
      suffix: 'weeks/year',
      isCashFlowField: true
    },
    // Only show agent fee for existing properties in cash flow tab
    ...(!isNewBuild ? [{
      key: 'agentFee',
      label: 'Agent Fee',
      originalValue: report?.financial_calculations?.agentFee || null,
      overrideValue: report?.manual_overrides?.agentFee || null,
      prefix: '$',
      isCashFlowField: true
    }] : []),
    // Only show construction duration for new builds
    ...(isNewBuild ? [{
      key: 'constructionDurationMonths',
      label: 'Construction Duration',
      originalValue: report?.financial_calculations?.constructionDurationMonths || null,
      overrideValue: report?.manual_overrides?.constructionDurationMonths || null,
      suffix: 'months',
      isCashFlowField: true
    }] : []),
  ];

  // Construction stage percentages (only for new builds - Cash Flow Tab)
  const constructionStageFields: OverrideField[] = isNewBuild ? [
    {
      key: 'stageDepositPercent',
      label: 'Deposit Stage',
      originalValue: 5,
      overrideValue: report?.manual_overrides?.stageDepositPercent || null,
      suffix: '%'
    },
    {
      key: 'stageSlabPercent',
      label: 'Slab/Base Stage',
      originalValue: 15,
      overrideValue: report?.manual_overrides?.stageSlabPercent || null,
      suffix: '%'
    },
    {
      key: 'stageFramePercent',
      label: 'Frame Stage',
      originalValue: 20,
      overrideValue: report?.manual_overrides?.stageFramePercent || null,
      suffix: '%'
    },
    {
      key: 'stageLockupPercent',
      label: 'Lock-up Stage',
      originalValue: 25,
      overrideValue: report?.manual_overrides?.stageLockupPercent || null,
      suffix: '%'
    },
    {
      key: 'stageFixingPercent',
      label: 'Fixing Stage',
      originalValue: 20,
      overrideValue: report?.manual_overrides?.stageFixingPercent || null,
      suffix: '%'
    },
    {
      key: 'stageCompletionPercent',
      label: 'Practical Completion',
      originalValue: 15,
      overrideValue: report?.manual_overrides?.stageCompletionPercent || null,
      suffix: '%'
    },
  ] : [];

  // Tax & Growth settings (Cash Flow Tab)
  const taxGrowthFields: OverrideField[] = [
    {
      key: 'cpiGrowthRate',
      label: 'CPI / Expense Growth Rate',
      originalValue: report?.financial_calculations?.cpiGrowthRate || 3,
      overrideValue: report?.manual_overrides?.cpiGrowthRate || null,
      suffix: '%',
      isCashFlowField: true
    },
    {
      key: 'depreciation',
      label: 'Annual Depreciation',
      originalValue: report?.financial_calculations?.depreciation || null,
      overrideValue: report?.manual_overrides?.depreciation || null,
      prefix: '$',
      isCashFlowField: true
    },
    {
      key: 'taxRate',
      label: 'Tax Rate (Marginal)',
      originalValue: report?.financial_calculations?.taxRate || 30,
      overrideValue: report?.manual_overrides?.taxRate || null,
      suffix: '%',
      isCashFlowField: true
    },
    {
      key: 'constructionYear',
      label: 'Construction Year',
      originalValue: report?.financial_calculations?.constructionYear || null,
      overrideValue: report?.manual_overrides?.constructionYear || null,
      isCashFlowField: true
    },
  ];

  // Legacy: Combined fields for backward compatibility (purchaseLoanFields reference)
  const purchaseLoanFields: OverrideField[] = [
    ...corePropertyFields,
    ...cashFlowLoanFields.filter(f => ['loanAmount', 'loanType', 'loanTermYears', 'interestOnlyPeriodYears', 'repaymentFrequency', 'extraRepaymentPerMonth', 'offsetBalance', 'marketValueNow'].includes(f.key)),
  ];

  // Combined fields for legacy support
  const fields: OverrideField[] = [
    ...corePropertyFields,
    ...cashFlowLoanFields,
    ...rentalIncomeFields,
    ...annualExpenseFields,
    ...taxGrowthFields,
    ...propertySpecFields
  ];

  // Static list of all possible cash flow field keys - independent of isNewBuild
  // This ensures initialization always works correctly
  const allCashFlowFieldKeys = [
    'marketValueNow', 'loanAmount', 'loanType', 'loanTermYears', 
    'interestOnlyPeriodYears', 'repaymentFrequency', 'extraRepaymentPerMonth', 
    'offsetBalance', 'constructionDurationMonths', 'occupancyRate',
    'agentFee', 'cpiGrowthRate', 'depreciation', 'taxRate', 'constructionYear'
  ];

  useEffect(() => {
    if (report && isOpen) {
      // Initialize overrides from existing manual_overrides
      setOverrides(report.manual_overrides || {});
      // Initialize cash flow field toggles using static list (avoids stale closure)
      const defaultToggles: Record<string, boolean> = {};
      allCashFlowFieldKeys.forEach(key => {
        defaultToggles[key] = report.manual_overrides?.cashFlowFieldToggles?.[key] ?? false;
      });
      setCashFlowFieldToggles(defaultToggles);
      // Initialize depreciation master toggle (default: include in cash flow analysis)
      setIncludeDepreciationInCashFlow(report.manual_overrides?.includeDepreciationInCashFlow ?? true);
      
      // Initialize depreciation schedule builder from existing data
      const existingSchedule = report.manual_overrides?.depreciationSchedule || {};
      setDepreciationSchedule(existingSchedule);
      setYear1Depreciation(existingSchedule[1] || report.manual_overrides?.depreciation || 0);
      setDepreciationMethod(report.manual_overrides?.depreciationMethod || 'prime_cost');
      
      // Initialize construction stage timing preset
      setSchedulePreset(report.manual_overrides?.schedulePreset || 'rapid');
      setCustomStageMonths(report.manual_overrides?.customStageMonths || {
        0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7
      });
      
      setHasChanges(false);
    }
  }, [report, isOpen]);

  // Track if loan amount and deposit value have been manually edited by the user
  const [loanAmountManuallyEdited, setLoanAmountManuallyEdited] = useState(false);
  const [depositValueManuallyEdited, setDepositValueManuallyEdited] = useState(false);

  // Reset manual edit flags when modal opens with a new report
  useEffect(() => {
    if (report && isOpen) {
      setLoanAmountManuallyEdited(false);
      setDepositValueManuallyEdited(false);
    }
  }, [report?.id, isOpen]);

  // Dynamically calculate loan amount and deposit value when purchasePrice or LVR changes
  useEffect(() => {
    const purchasePrice = overrides.purchasePrice ?? report?.financial_calculations?.purchasePrice ?? report?.financial_calculations?.propertyValue ?? 0;
    const lvr = overrides.loanToValueRatio ?? report?.financial_calculations?.loanToValueRatio ?? 80;
    
    // Only auto-calculate if purchasePrice and LVR are set
    if (purchasePrice > 0 && lvr > 0) {
      const calculatedLoanAmount = Math.round(purchasePrice * (lvr / 100));
      // Deposit = Purchase Price × (100% - LVR%)
      const calculatedDepositValue = Math.round(purchasePrice * (1 - lvr / 100));
      
      // Update loan amount if not manually edited
      // Update deposit value if not manually edited
      setOverrides(prev => ({
        ...prev,
        ...(!loanAmountManuallyEdited && { loanAmount: calculatedLoanAmount }),
        ...(!depositValueManuallyEdited && { depositValue: calculatedDepositValue })
      }));
    }
  }, [overrides.purchasePrice, overrides.loanToValueRatio, report?.financial_calculations, loanAmountManuallyEdited, depositValueManuallyEdited]);

  // Calculate Prime Cost depreciation schedule (constant annual depreciation)
  const calculatePrimeCostSchedule = (year1Value: number) => {
    const schedule: Record<number, number> = {};
    for (let year = 1; year <= 10; year++) {
      schedule[year] = year1Value; // Prime Cost = same value each year
    }
    return schedule;
  };

  // Calculate Diminishing Value depreciation schedule (declining balance)
  const calculateDiminishingValueSchedule = (year1Value: number) => {
    const schedule: Record<number, number> = {};
    let currentValue = year1Value;
    const declineRate = 0.85; // 15% decline each year typical for diminishing value
    for (let year = 1; year <= 10; year++) {
      schedule[year] = Math.round(currentValue);
      currentValue = currentValue * declineRate;
    }
    return schedule;
  };

  const normalizeDepreciationSchedule = (schedule?: Record<number | string, number>) => {
    const normalized: Record<number, number> = {};

    for (let year = 1; year <= 10; year++) {
      const value = schedule?.[year] ?? schedule?.[String(year)];
      if (value != null && !Number.isNaN(Number(value))) {
        normalized[year] = Number(value);
      }
    }

    return normalized;
  };

  const syncDepreciationScheduleToCashFlowOverrides = (
    existingOverrides: Record<string, Record<string, number>> | undefined,
    schedule: Record<number | string, number>
  ) => {
    const normalizedSchedule = normalizeDepreciationSchedule(schedule);
    const nextOverrides: Record<string, Record<string, number>> = {
      ...(existingOverrides || {})
    };

    for (let year = 1; year <= 10; year++) {
      const depreciationValue = normalizedSchedule[year] ?? 0;
      nextOverrides[String(year)] = {
        ...(nextOverrides[String(year)] || {}),
        depreciation: depreciationValue,
      };
    }

    return {
      normalizedSchedule,
      yearlyOverrides: nextOverrides,
    };
  };

  // Update schedule when year 1 value or method changes
  const handleYear1DepreciationChange = (value: number) => {
    setYear1Depreciation(value);
    const newSchedule = depreciationMethod === 'prime_cost'
      ? calculatePrimeCostSchedule(value)
      : calculateDiminishingValueSchedule(value);
    setDepreciationSchedule(newSchedule);
    
    // Persist to overrides immediately
    setOverrides(prev => ({
      ...prev,
      depreciation: value,
      depreciationSchedule: newSchedule,
      depreciationMethod
    }));
    setHasChanges(true);
  };

  // Update schedule when method changes
  const handleDepreciationMethodChange = (method: 'prime_cost' | 'diminishing_value') => {
    setDepreciationMethod(method);
    let newSchedule = depreciationSchedule;
    if (year1Depreciation > 0) {
      newSchedule = method === 'prime_cost'
        ? calculatePrimeCostSchedule(year1Depreciation)
        : calculateDiminishingValueSchedule(year1Depreciation);
      setDepreciationSchedule(newSchedule);
    }
    
    // Persist to overrides immediately
    setOverrides(prev => ({
      ...prev,
      depreciationSchedule: newSchedule,
      depreciationMethod: method
    }));
    setHasChanges(true);
  };

  // Update individual year in schedule (for manual adjustments)
  const handleScheduleYearChange = (year: number, value: number) => {
    const newSchedule = {
      ...depreciationSchedule,
      [year]: value
    };
    setDepreciationSchedule(newSchedule);
    
    // Persist to overrides immediately
    setOverrides(prev => ({
      ...prev,
      depreciationSchedule: newSchedule,
      // Update Year 1 depreciation if that's what changed
      ...(year === 1 && { depreciation: value })
    }));
    setHasChanges(true);
  };

  // Apply depreciation schedule to cash flow yearly overrides
  const applyDepreciationToCashFlow = () => {
    const { normalizedSchedule, yearlyOverrides } = syncDepreciationScheduleToCashFlowOverrides(
      overrides.cashFlowYearlyOverrides as Record<string, Record<string, number>> | undefined,
      depreciationSchedule
    );

    setOverrides(prev => ({
      ...prev,
      depreciation: normalizedSchedule[1] ?? year1Depreciation,
      cashFlowYearlyOverrides: yearlyOverrides,
      depreciationSchedule: normalizedSchedule,
      depreciationMethod,
      cashFlowDepreciationSource: 'schedule'
    }));

    setHasChanges(true);

    toast({
      title: "Depreciation Applied",
      description: "10-year depreciation schedule has been applied to cash flow analysis.",
    });
  };

  const handleOverrideChange = (key: string, value: string) => {
    const field = fields.find(f => f.key === key);
    
    // Clear any existing validation error for this field
    setValidationErrors(prev => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
    
    if (field?.type === 'select') {
      setOverrides(prev => ({
        ...prev,
        [key]: value || null
      }));
    } else {
      // Remove commas before parsing
      const cleanValue = removeCommas(value);
      const numValue = cleanValue === '' ? null : parseFloat(cleanValue);
      
      // Validate construction duration months (1-24)
      if (key === 'constructionDurationMonths' && numValue !== null) {
        if (numValue < 1 || numValue > 24) {
          setValidationErrors(prev => ({
            ...prev,
            [key]: 'Construction duration must be between 1 and 24 months'
          }));
        }
      }
      
      // Track manual edits to loan amount and deposit value
      if (key === 'loanAmount') {
        setLoanAmountManuallyEdited(true);
      }
      if (key === 'depositValue') {
        setDepositValueManuallyEdited(true);
      }
      
      // Preserve raw string during decimal input (e.g. "2." or "2.50")
      // to avoid parseFloat stripping trailing dots/zeros
      const shouldPreserveString = cleanValue !== '' && cleanValue !== null && (
        cleanValue.endsWith('.') || 
        (cleanValue.includes('.') && String(numValue) !== cleanValue)
      );
      
      setOverrides(prev => ({
        ...prev,
        [key]: shouldPreserveString ? cleanValue : numValue
      }));
    }
    setHasChanges(true);
  };

  const handleToggleChange = (key: string, enabled: boolean) => {
    setCashFlowFieldToggles(prev => ({
      ...prev,
      [key]: enabled
    }));
    setHasChanges(true);
  };

  const handleReset = (key: string) => {
    const newOverrides = { ...overrides };
    delete newOverrides[key];
    setOverrides(newOverrides);
    // Clear validation error for this field
    setValidationErrors(prev => {
      const updated = { ...prev };
      delete updated[key];
      return updated;
    });
    // Reset manual edit flags if resetting those fields
    if (key === 'loanAmount') {
      setLoanAmountManuallyEdited(false);
    }
    if (key === 'depositValue') {
      setDepositValueManuallyEdited(false);
    }
    setHasChanges(true);
  };

  const handleResetAll = () => {
    setOverrides({});
    const defaultToggles: Record<string, boolean> = {};
    allCashFlowFieldKeys.forEach(key => {
      defaultToggles[key] = false;
    });
    setCashFlowFieldToggles(defaultToggles);
    setIncludeDepreciationInCashFlow(true);
    setValidationErrors({});
    // Reset all manual edit flags
    setLoanAmountManuallyEdited(false);
    setDepositValueManuallyEdited(false);
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!report) return;
    
    // Check for validation errors before saving
    if (Object.keys(validationErrors).length > 0) {
      toast({
        title: "Validation Error",
        description: "Please fix validation errors before saving.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      console.log('💾 Saving manual overrides with qualitative regeneration');
      
      // Merge overrides with existing financial_calculations
      const mergedFinancialData = { ...report.financial_calculations };
      
      // Apply override mapping to nested structure.
      // Canonical field->path map lives in overrideOriginalValue.ts so the Original
      // Value display reads back from the exact locations overrides persist to.
      const overrideMapping = OVERRIDE_FIELD_PATHS;

      // Apply overrides to nested structure
      for (const [flatKey, overrideValue] of Object.entries(overrides)) {
        const nestedPath = overrideMapping[flatKey];
        if (nestedPath) {
          const keys = nestedPath.split('.');
          let current = mergedFinancialData;
          
          for (let i = 0; i < keys.length - 1; i++) {
            if (!current[keys[i]]) {
              current[keys[i]] = {};
            }
            current = current[keys[i]];
          }
          
          current[keys[keys.length - 1]] = overrideValue;
        }
      }
      
      // Recalculate dependent values after applying overrides
      if (!mergedFinancialData.annualCosts) {
        mergedFinancialData.annualCosts = {};
      }
      if (!mergedFinancialData.income) {
        mergedFinancialData.income = {};
      }
      
      // Recalculate property management dollar amount from weekly rent and percentage
      const weeklyRent = mergedFinancialData.income.weeklyRent || 0;
      const annualRent = weeklyRent * 52;
      const propertyManagementPercent = mergedFinancialData.annualCosts.propertyManagementPercent || 7;
      const propertyManagement = Math.floor(annualRent * (propertyManagementPercent / 100));
      
      // Update the calculated property management dollar amount
      mergedFinancialData.annualCosts.propertyManagement = propertyManagement;
      
      console.log('📊 Recalculated property management:', {
        weeklyRent,
        annualRent,
        propertyManagementPercent,
        propertyManagement
      });
      
      // Recalculate totalAnnual after applying overrides (excluding letting fees)
      // CRITICAL FIX: Use ?? operator to respect explicit $0 overrides (|| treats 0 as falsy)
      const councilRates = mergedFinancialData.annualCosts.councilRates ?? 0;
      const waterRates = mergedFinancialData.annualCosts.waterRates ?? 0;
      const strataFees = mergedFinancialData.annualCosts.strataFees ?? 0;
      const landlordInsurance = mergedFinancialData.annualCosts.landlordInsurance ?? 0;
      const maintenance = mergedFinancialData.annualCosts.maintenance ?? 0; // Respect $0 override, don't default to 1500
      
      mergedFinancialData.annualCosts.totalAnnual = councilRates + waterRates + strataFees + landlordInsurance + propertyManagement + maintenance;
      
      console.log('📊 Recalculated totalAnnual:', mergedFinancialData.annualCosts.totalAnnual);
      
      let overridesToPersist: Record<string, any> = {
        ...overrides,
        cashFlowFieldToggles,
        includeDepreciationInCashFlow,
        schedulePreset,
        customStageMonths
      };

      const currentSchedule = normalizeDepreciationSchedule(
        (overridesToPersist.depreciationSchedule as Record<number | string, number> | undefined) || depreciationSchedule
      );

      if (Object.keys(currentSchedule).length > 0) {
        overridesToPersist = {
          ...overridesToPersist,
          depreciation: currentSchedule[1] ?? overridesToPersist.depreciation ?? year1Depreciation,
          depreciationSchedule: currentSchedule,
        };

        if (includeDepreciationInCashFlow) {
          const { yearlyOverrides } = syncDepreciationScheduleToCashFlowOverrides(
            overridesToPersist.cashFlowYearlyOverrides as Record<string, Record<string, number>> | undefined,
            currentSchedule
          );

          overridesToPersist = {
            ...overridesToPersist,
            cashFlowYearlyOverrides: yearlyOverrides,
          };
        }
      }

      console.log('💾 Preparing to save overrides:', {
        overrideKeys: Object.keys(overridesToPersist),
        reportId: report.id
      });
      
      // Update database with merged data via secure edge function
      const { data: updateResult, error: updateError } = await invokeSecureFunction('manage-investment-reports', {
        action: 'update',
        reportId: report.id,
        data: { 
          manual_overrides: overridesToPersist,
          financial_calculations: mergedFinancialData
        }
      });

      if (updateError || !updateResult?.success) {
        console.error('❌ Update error:', updateError || updateResult?.error);
        throw new Error(updateError?.message || updateResult?.error || 'Failed to save overrides');
      }

      console.log('✅ Manual overrides saved successfully');

      // Log activity
      logActivityDirect({
        actionType: 'manual_override_applied',
        entityType: 'investment_report',
        entityId: report.id,
        entityName: report.property_address,
        metadata: { overrideFields: Object.keys(overrides) }
      });

      toast({
        title: "Overrides saved",
        description: updateResult?.financialsRecalculated
          ? "Financials were recalculated from your overrides — totals, projections and key metrics now match the reviewed figures. Use 'Regenerate with Perplexity' to update the written analysis."
          : "Your manual overrides have been applied. Use the 'Regenerate with Perplexity' button to update the qualitative analysis.",
      });

      setHasChanges(false);
      setSaving(false);
      
      // NOTE: Removed automatic regeneration call to prevent duplicate content.
      // The unified regeneration approach now requires using the "Regenerate with Perplexity" button
      // which uses useChunkedRegeneration hook pointing to generate-investment-report edge function.
      console.log('✅ Overrides saved. User should use Regenerate button to update qualitative analysis.');
      
      // Call onSave callback and wait for it to complete (refetches data)
      await onSave?.();
      
      onClose();
    } catch (error: any) {
      console.error('❌ Error applying overrides:', error);
      toast({
        title: "Failed to apply overrides",
        description: error.message || "Failed to save manual data overrides",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
      setRegenerating(false);
    }
  };

  const formatValue = (value: number | string | null, prefix?: string, suffix?: string) => {
    if (value === null || value === undefined) return 'Not available';
    if (typeof value === 'string') {
      // For select fields, display the label
      if (value === 'interest_only') return 'Interest Only';
      if (value === 'principal_interest') return 'Principal & Interest';
      return value;
    }
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return `${prefix || ''}${numValue.toLocaleString('en-AU')}${suffix || ''}`;
  };

  const getFieldValue = (field: OverrideField) => {
    const overrideValue = overrides[field.key];
    if (overrideValue !== undefined && overrideValue !== null) {
      // If it's a raw string being typed (e.g. "2." during decimal input), return as-is
      if (typeof overrideValue === 'string') {
        // For currency-style fields with prefix '$', format with commas
        if (field.prefix === '$') {
          return formatNumberWithCommas(overrideValue);
        }
        return overrideValue;
      }
      // Format numeric values with commas for display
      if (field.type !== 'select' && typeof overrideValue === 'number') {
        return formatNumberWithCommas(overrideValue.toString());
      }
      return overrideValue;
    }
    return '';
  };

  const hasOverride = (key: string) => {
    return overrides[key] !== undefined && overrides[key] !== null;
  };

  const renderField = (field: OverrideField, showSeparator: boolean = true) => (
    <div key={field.key} className="min-w-0 space-y-4 rounded-lg border bg-card/40 p-4">
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(180px,0.9fr)_minmax(220px,1fr)_minmax(280px,1.15fr)_auto] xl:items-start">
        <div className="min-w-0 space-y-2 md:col-span-2 xl:col-span-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Label className="min-w-0 text-base font-semibold leading-snug">{field.label}</Label>
            {hasOverride(field.key) && (
              <Badge variant="secondary" className="shrink-0 text-xs">
                Overridden
              </Badge>
            )}
            {field.isCashFlowField && (
              <Badge variant="outline" className="shrink-0 bg-primary/10 text-xs">
                <Calculator className="mr-1 h-3 w-3" />
                Cash Flow
              </Badge>
            )}
          </div>
        </div>

        {/* Original Value */}
        <div className="min-w-0 space-y-2">
          <Label className="text-sm text-muted-foreground">Original Value (API)</Label>
          <div className="flex min-h-10 min-w-0 items-center rounded-md border bg-muted/50 px-3 py-2 text-muted-foreground">
            <span className="min-w-0 break-words">{formatValue(
              resolveOriginalFieldValue(
                report?.financial_calculations,
                report?.manual_overrides,
                field.key,
                field.originalValue,
              ),
              field.prefix,
              field.suffix,
            )}</span>
          </div>
        </div>

        {/* Override Value */}
        <div className="min-w-0 space-y-2">
          <Label className="text-sm font-medium">Manual Override</Label>
          <div className="flex min-w-0 items-center gap-2">
            {field.type === 'select' ? (
              <Select
                value={getFieldValue(field) as string || ''}
                onValueChange={(value) => handleOverrideChange(field.key, value)}
              >
                <SelectTrigger className={`min-w-0 ${hasOverride(field.key) ? 'border-primary' : ''}`}>
                  <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  {field.options?.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <>
                {field.prefix && (
                  <span className="shrink-0 text-muted-foreground">{field.prefix}</span>
                )}
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder={`Enter ${field.label.toLowerCase()}`}
                  value={getFieldValue(field)}
                  onChange={(e) => {
                    const rawValue = removeCommas(e.target.value);
                    // Only allow valid number formats
                    if (rawValue === '' || rawValue === '-' || /^-?\d*\.?\d*$/.test(rawValue)) {
                      handleOverrideChange(field.key, rawValue);
                    }
                  }}
                  className={`min-w-0 ${hasOverride(field.key) ? 'border-primary' : ''} ${validationErrors[field.key] ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                />
                {field.suffix && (
                  <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">{field.suffix}</span>
                )}
              </>
            )}
          </div>
          {validationErrors[field.key] && (
            <p className="flex items-center gap-1 text-sm text-destructive">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {validationErrors[field.key]}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-start gap-3 md:col-span-2 xl:col-span-1 xl:justify-end xl:pt-7">
          {field.isCashFlowField && (
            <div className="flex min-w-max items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <Label className="whitespace-nowrap text-xs text-muted-foreground">Include in Report</Label>
              <Switch
                checked={cashFlowFieldToggles[field.key] || false}
                onCheckedChange={(checked) => handleToggleChange(field.key, checked)}
              />
            </div>
          )}
          {hasOverride(field.key) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleReset(field.key)}
              className="h-8 text-xs"
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {showSeparator && <Separator className="mt-1" />}
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        bareLayout
        overlayClassName={MANUAL_OVERRIDE_OVERLAY_CLASSNAME}
        overlayStyle={shellVariables}
        style={shellVariables}
        className={MANUAL_OVERRIDE_CONTENT_CLASSNAME}
      >
        <div className="shrink-0 px-6 pb-4 pt-6 sm:px-8">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-primary" />
              Manual Data Override
            </DialogTitle>
            <DialogDescription>
              Override data for this property. Switch between tabs to configure Investment Report fields or Cash Flow Analysis settings.
            </DialogDescription>
          </DialogHeader>
        </div>

        <Separator />

        {/* Tabs Navigation */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'investment' | 'cashflow')} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 px-6 pt-3 sm:px-8">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger 
                value="investment" 
                className="flex items-center gap-2 data-[state=active]:bg-brand-400 data-[state=active]:text-black"
              >
                <FileText className="h-4 w-4" />
                Investment Report
              </TabsTrigger>
              <TabsTrigger 
                value="cashflow" 
                className="flex items-center gap-2 data-[state=active]:bg-brand-400 data-[state=active]:text-black"
              >
                <TrendingUp className="h-4 w-4" />
                Cash Flow Analysis
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Investment Report Tab */}
          <TabsContent value="investment" className="mt-0 min-h-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full w-full [&>[data-radix-scroll-area-viewport]]:px-6 sm:[&>[data-radix-scroll-area-viewport]]:px-8">
              <div className="space-y-6 py-4">
                {/* Property Details Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    Property Details
                  </h3>
                  {corePropertyFields.map((field, index) => 
                    renderField(field, index < corePropertyFields.length - 1)
                  )}
                </div>

                <Separator className="my-6" />

                {/* Rental Income Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    Rental Income
                  </h3>
                  {rentalIncomeFields.map((field, index) => 
                    renderField(field, index < rentalIncomeFields.length - 1)
                  )}
                </div>

                <Separator className="my-6" />

                {/* Annual Operating Expenses Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                      <span className="w-2 h-2 bg-primary rounded-full"></span>
                      Annual Operating Expenses
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleEstimateExpenses}
                      disabled={estimatingExpenses}
                      className="gap-2 text-sm"
                    >
                      {estimatingExpenses ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Estimating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          AI Estimate
                        </>
                      )}
                    </Button>
                  </div>
                  
                  {/* Stamp Duty Calculator */}
                  <Collapsible 
                    open={showStampDutyCalculator} 
                    onOpenChange={setShowStampDutyCalculator}
                    className="rounded-lg border bg-gradient-to-br from-card to-muted/20"
                  >
                    <CollapsibleTrigger asChild>
                      <Button 
                        variant="ghost" 
                        className="w-full flex items-center justify-between p-4 h-auto hover:bg-muted/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-warning/10">
                            <Calculator className="h-5 w-5 text-warning" />
                          </div>
                          <div className="text-left">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-foreground">Stamp Duty Calculator</p>
                              {detectedState !== 'All' && (
                                <Badge variant="secondary" className="text-xs">
                                  {detectedState} detected
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Calculate stamp duty for all Australian states and territories
                            </p>
                          </div>
                        </div>
                        {showStampDutyCalculator ? (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-4 pb-4 space-y-4">
                        <Separator />

                        <StampDutyCalculatorPanel
                          dutiableValue={stampDutyDutiableValue}
                          onDutiableValueChange={setDutiableValueOverride}
                          purchasePrice={stampDutyPurchasePrice}
                          bases={stampDutyBases}
                          state={stampDutyState}
                          onStateChange={setStampDutyStateOverride}
                          intent={stampDutyIntent}
                          onIntentChange={setStampDutyIntent}
                          category={stampDutyCategory}
                          onCategoryChange={setStampDutyCategory}
                          isFirstHomeBuyer={stampDutyFirstHomeBuyer}
                          onFirstHomeBuyerChange={setStampDutyFirstHomeBuyer}
                          isForeignBuyer={stampDutyForeignBuyer}
                          onForeignBuyerChange={setStampDutyForeignBuyer}
                          onUseValue={useStampDutyValue}
                          useValueLabel="Apply to analysis"
                        />

                        {overrides.stampDuty && overrides.stampDuty > 0 && (
                          <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 p-2 text-sm text-success">
                            <Check className="h-4 w-4" />
                            <span>Stamp duty of ${overrides.stampDuty.toLocaleString('en-AU')} applied to this analysis</span>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Land Tax Calculator */}
                  <Collapsible 
                    open={showLandTaxCalculator} 
                    onOpenChange={setShowLandTaxCalculator}
                    className="rounded-lg border bg-gradient-to-br from-card to-muted/20"
                  >
                    <CollapsibleTrigger asChild>
                      <Button 
                        variant="ghost" 
                        className="w-full flex items-center justify-between p-4 h-auto hover:bg-muted/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-success/10">
                            <Calculator className="h-5 w-5 text-success" />
                          </div>
                          <div className="text-left">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-foreground">Land Tax Calculator</p>
                              {detectedState !== 'All' && (
                                <Badge variant="secondary" className="text-xs">
                                  {detectedState} detected
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Calculate annual land tax based on state rates and owner type
                            </p>
                          </div>
                        </div>
                        {showLandTaxCalculator ? (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-4 pb-4 space-y-4">
                        <Separator />
                        <LandTaxCalculator
                          propertyAddress={report?.property_address}
                          detectedState={detectedState !== 'All' ? detectedState : undefined}
                          purchasePrice={
                            overrides.purchasePrice ?? 
                            report?.financial_calculations?.purchasePrice ?? 
                            report?.financial_calculations?.propertyValue ?? 
                            0
                          }
                          onLandTaxCalculated={(landTax) => {
                            if (landTax) {
                              setOverrides(prev => ({
                                ...prev,
                                landTax: landTax
                              }));
                              setHasChanges(true);
                              toast({
                                title: "Land Tax Applied",
                                description: `$${landTax.toLocaleString('en-AU')} annual land tax has been applied.`,
                              });
                            }
                          }}
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {annualExpenseFields.map((field, index) => 
                    renderField(field, index < annualExpenseFields.length - 1)
                  )}

                  {/* AI Estimation Citations */}
                  {expenseCitations.length > 0 && (
                    <div className="mt-4 p-3 rounded-lg bg-muted/50 border space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <ExternalLink className="h-4 w-4 text-primary" />
                        <span>Data Sources ({expenseCitations.length})</span>
                      </div>
                      <div className="space-y-1">
                        {expenseCitations.slice(0, 5).map((citation, idx) => (
                          <a
                            key={idx}
                            href={citation}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-muted-foreground hover:text-primary truncate"
                          >
                            {idx + 1}. {citation}
                          </a>
                        ))}
                        {expenseCitations.length > 5 && (
                          <p className="text-xs text-muted-foreground">
                            +{expenseCitations.length - 5} more sources
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <Separator className="my-6" />

                {/* Property Specifications Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    Property Specifications
                  </h3>
                  {propertySpecFields.map((field, index) => 
                    renderField(field, index < propertySpecFields.length - 1)
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Cash Flow Analysis Tab */}
          <TabsContent value="cashflow" className="mt-0 min-h-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full w-full [&>[data-radix-scroll-area-viewport]]:px-6 sm:[&>[data-radix-scroll-area-viewport]]:px-8">
              <div className="space-y-6 py-4">
                {/* Loan & Mortgage Settings */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    Loan & Mortgage Settings
                  </h3>
                  
                  {/* Mortgage Repayment Calculator */}
                  <Collapsible 
                    open={showMortgageCalculator} 
                    onOpenChange={setShowMortgageCalculator}
                    className="rounded-lg border bg-gradient-to-br from-card to-muted/20"
                  >
                    <CollapsibleTrigger asChild>
                      <Button 
                        variant="ghost" 
                        className="w-full flex items-center justify-between p-4 h-auto hover:bg-muted/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-brand-500/10">
                            <Banknote className="h-5 w-5 text-brand-600" />
                          </div>
                          <div className="text-left">
                            <p className="font-semibold text-foreground">Mortgage Repayment Calculator</p>
                            <p className="text-sm text-muted-foreground">
                              Calculate repayments, view amortisation schedule, and apply to cash flow
                            </p>
                          </div>
                        </div>
                        {showMortgageCalculator ? (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-4 pb-4 space-y-4">
                        <Separator />
                        <MortgageRepaymentCalculator
                          initialLoanAmount={
                            overrides.loanAmount ?? 
                            report?.manual_overrides?.loanAmount ??
                            report?.financial_calculations?.loanAmount ?? 
                            Math.round(((overrides.purchasePrice ?? report?.financial_calculations?.purchasePrice ?? 0) * 
                              (overrides.loanToValueRatio ?? report?.financial_calculations?.loanToValueRatio ?? 80) / 100))
                          }
                          initialInterestRate={
                            overrides.interestRate || 
                            report?.financial_calculations?.interestRate || 
                            6.5
                          }
                          initialLoanTermYears={
                            overrides.loanTermYears || 
                            report?.financial_calculations?.loanTermYears || 
                            30
                          }
                          initialLoanType={
                            (overrides.loanType || report?.financial_calculations?.loanType || 'principal_interest') as LoanType
                          }
                          initialInterestOnlyPeriodYears={
                            overrides.interestOnlyPeriodYears || 
                            report?.financial_calculations?.interestOnlyPeriodYears || 
                            0
                          }
                          initialRepaymentFrequency={
                            (overrides.repaymentFrequency || report?.financial_calculations?.repaymentFrequency || 'monthly') as RepaymentFrequency
                          }
                          initialExtraRepayment={
                            overrides.extraRepaymentPerMonth || 
                            report?.financial_calculations?.extraRepaymentPerMonth || 
                            0
                          }
                          initialOffsetBalance={
                            overrides.offsetBalance || 
                            report?.financial_calculations?.offsetBalance || 
                            0
                          }
                          onApplyToOverrides={(values) => {
                            setOverrides(prev => ({
                              ...prev,
                              ...(values.loanAmount !== undefined && { loanAmount: values.loanAmount }),
                              ...(values.interestRate !== undefined && { interestRate: values.interestRate }),
                              ...(values.loanTermYears !== undefined && { loanTermYears: values.loanTermYears }),
                              ...(values.loanType !== undefined && { loanType: values.loanType }),
                              ...(values.interestOnlyPeriodYears !== undefined && { interestOnlyPeriodYears: values.interestOnlyPeriodYears }),
                              ...(values.repaymentFrequency !== undefined && { repaymentFrequency: values.repaymentFrequency }),
                              ...(values.extraRepaymentPerMonth !== undefined && { extraRepaymentPerMonth: values.extraRepaymentPerMonth }),
                              ...(values.offsetBalance !== undefined && { offsetBalance: values.offsetBalance }),
                            }));
                            setHasChanges(true);
                            toast({
                              title: "Values Applied",
                              description: "Mortgage calculator values have been applied to the override fields.",
                            });
                          }}
                          onApplyLoanProjection={(projection) => {
                            const loanProjectionOverrides: Record<string, Record<string, number>> = {};
                            projection.forEach((yearData) => {
                              loanProjectionOverrides[yearData.year] = {
                                yearlyInterest: yearData.interestPayment,
                                yearlyPrincipal: yearData.principalPayment,
                                yearlyLoanPayment: yearData.totalPayment,
                                loanBalance: yearData.closingBalance,
                              };
                            });
                            
                            setOverrides(prev => ({
                              ...prev,
                              loanProjection: loanProjectionOverrides,
                            }));
                            setHasChanges(true);
                            toast({
                              title: "Loan Projection Applied",
                              description: "10-year loan amortisation has been applied to cash flow analysis.",
                            });
                          }}
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                  
                  {cashFlowLoanFields.map((field, index) => 
                    renderField(field, index < cashFlowLoanFields.length - 1)
                  )}
                </div>

                {/* Construction Stage Percentages - Only for New Builds */}
                {isNewBuild && constructionStageFields.length > 0 && (
                  <>
                    <Separator className="my-6" />
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                        <span className="w-2 h-2 bg-primary rounded-full"></span>
                        Construction Stage Percentages
                        <Badge variant="outline" className="ml-2 text-xs font-normal">
                          Must total 100%
                        </Badge>
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Customize the payment schedule percentages for your builder's contract. Default values follow standard Australian construction practices.
                      </p>
                      {(() => {
                        const totalPercent = constructionStageFields.reduce((sum, field) => {
                          const val = overrides[field.key] ?? field.originalValue ?? 0;
                          return sum + (typeof val === 'number' ? val : parseFloat(val) || 0);
                        }, 0);
                        const isValid = Math.abs(totalPercent - 100) < 0.01;
                        return (
                          <div className={`flex items-center gap-2 p-2 rounded-lg ${isValid ? 'bg-success/10 dark:bg-success/30' : 'bg-destructive/10 dark:bg-destructive/30'}`}>
                            <span className={`text-sm font-medium ${isValid ? 'text-success dark:text-success' : 'text-destructive dark:text-destructive'}`}>
                              Total: {totalPercent.toFixed(1)}%
                            </span>
                            {!isValid && (
                              <span className="text-xs text-destructive dark:text-destructive">
                                (Must equal 100%)
                              </span>
                            )}
                            {isValid && (
                              <Check className="h-4 w-4 text-success dark:text-success" />
                            )}
                          </div>
                        );
                      })()}
                      <div className="grid grid-cols-2 gap-3">
                        {constructionStageFields.map((field) => (
                          <div key={field.key} className="space-y-1">
                            <Label className="text-xs text-muted-foreground">{field.label}</Label>
                            <div className="relative">
                              <Input
                                type="number"
                                step="0.1"
                                min="0"
                                max="100"
                                value={overrides[field.key] ?? field.originalValue ?? ''}
                                onChange={(e) => handleOverrideChange(field.key, e.target.value)}
                                className="pr-8 h-9"
                                placeholder={String(field.originalValue)}
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {/* Construction Stage Timing Distribution */}
                    <Separator className="my-6" />
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                        <span className="w-2 h-2 bg-primary rounded-full"></span>
                        Construction Stage Timing
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Control when each construction stage occurs during the build period. Land interest is always Month 1.
                      </p>
                      
                      {/* Preset Selector */}
                      <div className="flex flex-col gap-2">
                        <Label className="text-sm font-medium">Distribution Preset</Label>
                        <Select 
                          value={schedulePreset} 
                          onValueChange={(value: 'rapid' | 'even' | 'custom') => {
                            setSchedulePreset(value);
                            setHasChanges(true);
                            // Reset custom months to defaults when switching to even
                            if (value === 'even') {
                              const durationMonths = overrides.constructionDurationMonths || 7;
                              const numStages = 6;
                              const newMonths: { [key: number]: number } = {};
                              for (let i = 0; i < numStages; i++) {
                                const month = Math.round(2 + (i * (durationMonths - 2)) / Math.max(1, numStages - 1));
                                newMonths[i] = Math.min(month, durationMonths);
                              }
                              setCustomStageMonths(newMonths);
                            } else if (value === 'rapid') {
                              setCustomStageMonths({ 0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 });
                            }
                          }}
                        >
                          <SelectTrigger className="w-full bg-background">
                            <SelectValue placeholder="Select distribution preset" />
                          </SelectTrigger>
                          <SelectContent className="bg-background z-50">
                            <SelectItem value="rapid">Rapid Build (7 months)</SelectItem>
                            <SelectItem value="even">Even Distribution</SelectItem>
                            <SelectItem value="custom">Custom (Manual)</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground">
                          {schedulePreset === 'rapid' && 'All stages compressed into months 2-7. Additional months show interest-only rows.'}
                          {schedulePreset === 'even' && `Stages evenly distributed from month 2 to month ${overrides.constructionDurationMonths || 7}.`}
                          {schedulePreset === 'custom' && 'Manually set which month each stage occurs.'}
                        </span>
                      </div>
                      
                      {/* Custom Stage Month Selection */}
                      {schedulePreset === 'custom' && (
                        <div className="p-4 bg-info/10 dark:bg-info/30 rounded-lg border border-info/30 dark:border-info/30">
                          <h5 className="text-sm font-medium mb-3 text-info dark:text-info-foreground">Custom Stage Positioning</h5>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { index: 0, label: 'Deposit' },
                              { index: 1, label: 'Slab/Base' },
                              { index: 2, label: 'Frame' },
                              { index: 3, label: 'Lock-up' },
                              { index: 4, label: 'Fixing' },
                              { index: 5, label: 'Completion' },
                            ].map(({ index, label }) => {
                              const durationMonths = overrides.constructionDurationMonths || 24;
                              return (
                                <div key={index} className="space-y-1">
                                  <Label className="text-xs text-muted-foreground">{label}</Label>
                                  <Select 
                                    value={String(customStageMonths[index] || (index + 2))}
                                    onValueChange={(value) => {
                                      setCustomStageMonths(prev => ({
                                        ...prev,
                                        [index]: parseInt(value, 10)
                                      }));
                                      setHasChanges(true);
                                    }}
                                  >
                                    <SelectTrigger className="w-full h-9 bg-background">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-background z-50">
                                      {Array.from({ length: durationMonths - 1 }, (_, i) => i + 2).map(month => (
                                        <SelectItem key={month} value={String(month)}>
                                          Month {month}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-xs text-info dark:text-info mt-3">
                            Note: Month 1 is reserved for Land Interest Charge. Stages can occur in the same month.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                <Separator className="my-6" />

                {/* Tax & Growth Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                      <span className="w-2 h-2 bg-primary rounded-full"></span>
                      Tax & Growth Settings
                    </h3>
                  </div>
                  
                  {/* Master Depreciation Toggle for Cash Flow Analysis */}
                  <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                    <div className="space-y-1">
                      <Label className="text-base font-semibold">Include Depreciation in Cash Flow Analysis</Label>
                      <p className="text-sm text-muted-foreground">
                        When enabled, depreciation values will be factored into the 10-year cash flow projections
                      </p>
                    </div>
                    <Switch
                      checked={includeDepreciationInCashFlow}
                      onCheckedChange={(checked) => {
                        setIncludeDepreciationInCashFlow(checked);
                        setHasChanges(true);
                      }}
                    />
                  </div>

                  {/* Depreciation Value Calculator */}
                  <Collapsible 
                    open={showDepreciationCalculator} 
                    onOpenChange={setShowDepreciationCalculator}
                    className="rounded-lg border bg-gradient-to-br from-card to-muted/20"
                  >
                    <CollapsibleTrigger asChild>
                      <Button 
                        variant="ghost" 
                        className="w-full flex items-center justify-between p-4 h-auto hover:bg-muted/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10">
                            <Calculator className="h-5 w-5 text-primary" />
                          </div>
                          <div className="text-left">
                            <p className="font-semibold text-foreground">Depreciation Value Calculator</p>
                            <p className="text-sm text-muted-foreground">
                              Calculate tax depreciation estimates based on similar properties
                            </p>
                          </div>
                        </div>
                        {showDepreciationCalculator ? (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-4 pb-4 space-y-4">
                        <Separator />
                        <DepreciationValueCalculator
                          onApplyYear1={(value) => {
                            // Update local state
                            setYear1Depreciation(value);
                            const newSchedule = depreciationMethod === 'prime_cost' 
                              ? calculatePrimeCostSchedule(value)
                              : calculateDiminishingValueSchedule(value);
                            setDepreciationSchedule(newSchedule);
                            
                            // Persist to overrides immediately so it gets saved
                            setOverrides(prev => ({
                              ...prev,
                              depreciation: value,
                              depreciationSchedule: newSchedule,
                              depreciationMethod
                            }));
                            setHasChanges(true);
                            toast({
                              title: "Year 1 Depreciation Applied",
                              description: `$${value.toLocaleString('en-AU')} has been applied and schedule generated.`,
                            });
                          }}
                          onApplySchedule={(schedule, method) => {
                            const mappedMethod = method === 'dv' ? 'diminishing_value' : 'prime_cost';
                            
                            // Update local state
                            setDepreciationSchedule(schedule);
                            setDepreciationMethod(mappedMethod);
                            setYear1Depreciation(schedule[1] || 0);
                            
                            // Persist to overrides immediately so it gets saved
                            setOverrides(prev => ({
                              ...prev,
                              depreciation: schedule[1] || 0,
                              depreciationSchedule: schedule,
                              depreciationMethod: mappedMethod
                            }));
                            setHasChanges(true);
                            toast({
                              title: "Depreciation Schedule Applied",
                              description: `10-year ${method === 'dv' ? 'Diminishing Value' : 'Prime Cost'} schedule has been saved.`,
                            });
                          }}
                          defaultPurchasePrice={
                            overrides.purchasePrice ?? 
                            report?.financial_calculations?.purchasePrice ?? 
                            report?.financial_calculations?.propertyValue
                          }
                          defaultBuildYear={
                            overrides.constructionYear ??
                            report?.manual_overrides?.constructionYear ??
                            new Date().getFullYear()
                          }
                          isNewBuild={isNewBuild}
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Depreciation Schedule Builder */}
                  <Collapsible 
                    open={showDepreciationSchedule} 
                    onOpenChange={setShowDepreciationSchedule}
                    className="rounded-lg border bg-gradient-to-br from-card to-muted/20"
                  >
                    <CollapsibleTrigger asChild>
                      <Button 
                        variant="ghost" 
                        className="w-full flex items-center justify-between p-4 h-auto hover:bg-muted/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-success/10">
                            <Table className="h-5 w-5 text-success" />
                          </div>
                          <div className="text-left">
                            <p className="font-semibold text-foreground">Depreciation Schedule Builder</p>
                            <p className="text-sm text-muted-foreground">
                              Create 10-year depreciation schedule and apply to cash flow analysis
                            </p>
                          </div>
                        </div>
                        {showDepreciationSchedule ? (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-4 pb-4 space-y-4">
                        <Separator />
                        
                        {/* Method Selection */}
                        <div className="space-y-3">
                          <Label className="text-sm font-medium">Depreciation Method</Label>
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              type="button"
                              onClick={() => handleDepreciationMethodChange('prime_cost')}
                              className={`p-4 rounded-lg border-2 text-left transition-all ${
                                depreciationMethod === 'prime_cost'
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border hover:border-muted-foreground'
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                {depreciationMethod === 'prime_cost' && (
                                  <Check className="h-4 w-4 text-primary" />
                                )}
                                <span className="font-semibold">Prime Cost</span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Same depreciation amount each year (straight-line)
                              </p>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDepreciationMethodChange('diminishing_value')}
                              className={`p-4 rounded-lg border-2 text-left transition-all ${
                                depreciationMethod === 'diminishing_value'
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border hover:border-muted-foreground'
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                {depreciationMethod === 'diminishing_value' && (
                                  <Check className="h-4 w-4 text-primary" />
                                )}
                                <span className="font-semibold">Diminishing Value</span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Higher depreciation early, decreasing over time
                              </p>
                            </button>
                          </div>
                        </div>

                        {/* Year 1 Input */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Year 1 Depreciation (from calculator)</Label>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">$</span>
                            <Input
                              type="number"
                              placeholder="Enter Year 1 depreciation value"
                              value={year1Depreciation || ''}
                              onChange={(e) => handleYear1DepreciationChange(parseFloat(e.target.value) || 0)}
                              className="max-w-[200px]"
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Copy the Year 1 value from the Depreciation Value Calculator above
                          </p>
                        </div>

                        {/* 10-Year Schedule Table */}
                        {year1Depreciation > 0 && (
                          <div className="space-y-3">
                            <Label className="text-sm font-medium">10-Year Depreciation Schedule</Label>
                            <div className="rounded-lg border overflow-hidden">
                              <UITable>
                                <TableHeader>
                                  <TableRow className="bg-muted/50">
                                    <TableHead className="w-[100px] font-semibold">Year</TableHead>
                                    <TableHead className="font-semibold">Depreciation Amount</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {Array.from({ length: 10 }, (_, i) => i + 1).map((year) => (
                                    <TableRow key={year} className={year === 1 ? 'bg-primary/5' : ''}>
                                      <TableCell className="font-medium">
                                        Year {year}
                                        {year === 1 && (
                                          <Badge variant="outline" className="ml-2 text-xs">Base</Badge>
                                        )}
                                      </TableCell>
                                      <TableCell>
                                        <div className="flex items-center gap-2">
                                          <span className="text-muted-foreground">$</span>
                                          <Input
                                            type="number"
                                            value={depreciationSchedule[year] || ''}
                                            onChange={(e) => handleScheduleYearChange(year, parseFloat(e.target.value) || 0)}
                                            className="max-w-[150px] h-8"
                                          />
                                          {depreciationMethod === 'diminishing_value' && year > 1 && (
                                            <span className="text-xs text-muted-foreground">
                                              ({((depreciationSchedule[year] / depreciationSchedule[1]) * 100).toFixed(0)}% of Y1)
                                            </span>
                                          )}
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </UITable>
                            </div>

                            {/* Total Depreciation Summary */}
                            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
                              <span className="text-sm font-medium">Total 10-Year Depreciation</span>
                              <span className="text-lg font-bold text-primary">
                                ${Object.values(depreciationSchedule).reduce((sum, val) => sum + (val || 0), 0).toLocaleString('en-AU')}
                              </span>
                            </div>

                            {/* Apply to Cash Flow Button */}
                            <Button
                              onClick={applyDepreciationToCashFlow}
                              className="w-full"
                              size="lg"
                            >
                              <ArrowRight className="h-4 w-4 mr-2" />
                              Apply to Cash Flow Analysis
                            </Button>
                            <p className="text-xs text-muted-foreground text-center">
                              This will inject the depreciation values into your 10-year cash flow projections
                            </p>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                  
                  {taxGrowthFields.map((field, index) => 
                    renderField(field, index < taxGrowthFields.length - 1)
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <Separator />

        <div className="flex shrink-0 flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Button
            variant="outline"
            onClick={handleResetAll}
            disabled={Object.keys(overrides).length === 0}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset All
          </Button>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges || saving || regenerating || Object.keys(validationErrors).length > 0}>
              {regenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Regenerating Analysis...
                </>
              ) : saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save & Regenerate
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
