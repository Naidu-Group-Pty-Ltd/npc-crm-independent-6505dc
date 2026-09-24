import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useIsMobile } from '@/hooks/use-mobile';
import { Calculator, Home, DollarSign, TrendingUp, Settings2 } from 'lucide-react';
import { STATE_MAPPING } from '@/lib/states';
import { BuildType } from '@/types/overrideFields';
import { getLocalityGrowthEstimate, getDerivedCpiGrowth } from '@/utils/localityGrowthEstimates';

import { PropertyTab, FinancialsTab, IncomeExpensesTab, AdvancedTab } from './manual-inputs';
import type { CgrEstimateReading } from './manual-inputs/FinancialsTab';
import { OverrideStepFooter, type OverrideStep } from './OverrideStepFooter';

export interface PreGenerationData {
  buildType: BuildType;
  purchasePrice?: number;
  propertyValue?: number;
  landPrice?: number;
  buildPrice?: number;
  carSpaces?: number;
  depositValue?: number;
  loanToValueRatio?: number;
  interestRate?: number;
  capitalGrowth?: number;
  weeklyRent?: number;
  
  // Annual Expenses
  stampDuty?: number;
  bodyCorporateFees?: number;
  strataAdminFund?: number;
  strataSinkingFund?: number;
  strataSpecialLevies?: number;
  landTax?: number;
  councilRates?: number;
  waterRates?: number;
  solicitorFees?: number;
  buildingLandlordInsurance?: number;
  propertyManagementFees?: number;
  repairsMaintenance?: number;
  lettingFees?: number;
  agentFee?: number;
  propertyType?: string;
  
  // Cash Flow Analysis Optional Overrides
  cpiGrowthRate?: number;
  depreciation?: number;
  taxRate?: number;
  occupancyRate?: number;
  loanType?: 'interest_only' | 'principal_interest';
  loanTermYears?: number;
  marketValueNow?: number;
  
  // 10-Year Depreciation Schedule (from calculator)
  depreciationSchedule?: Record<number, number>; // year (1-10) -> depreciation value
  depreciationMethod?: 'dv' | 'pc'; // Diminishing Value or Prime Cost
  
  // Additional Cash Flow Fields
  loanAmount?: number;
  interestOnlyPeriodYears?: number;
  repaymentFrequency?: 'weekly' | 'fortnightly' | 'monthly';
  extraRepaymentPerMonth?: number;
  offsetBalance?: number;
  constructionDurationMonths?: number;
  constructionYear?: number;
  landSizeSqm?: number;
  buildSizeSqm?: number;
  
  // First Home Buyer flag for stamp duty concessions
  isFirstHomeBuyer?: boolean;
  
  // Construction Stage Percentages (new build only)
  stageDepositPercent?: number;
  stageSlabPercent?: number;
  stageFramePercent?: number;
  stageLockupPercent?: number;
  stageFixingPercent?: number;
  stageCompletionPercent?: number;
  
  // Construction Schedule Preset Mode (new build only)
  schedulePreset?: 'rapid' | 'even' | 'custom';
  customStageMonths?: { [stageIndex: number]: number };
  
  // Zoning Information
  zoningCode?: string;
  zoningDescription?: string;
  permittedUses?: string;
  developmentPotential?: string;
  zoningOverlays?: string;
  minimumLotSize?: number;
  maximumHeight?: number;
  floorSpaceRatio?: number;
}

interface PreGenerationOverridesProps {
  propertyAddress?: string;
  onDataChange: (data: PreGenerationData) => void;
  disabled?: boolean;
  buildType?: BuildType;
  onBuildTypeChange?: (buildType: BuildType) => void;
  externalPurchasePrice?: number;
  externalPropertyValue?: number;
  externalLandPrice?: number;
  externalBuildPrice?: number;
  externalWeeklyRent?: number;
  externalCarSpaces?: number;
  externalLandSize?: number;
  externalBuildSize?: number;
  // Extended external props for URL scrape data
  externalCouncilRates?: number;
  externalWaterRates?: number;
  externalBodyCorporateFees?: number;
  externalBuildingInsurance?: number;
  externalPropertyManagementPercent?: number;
  externalConstructionYear?: number;
  // Consolidated primary property details (owned by the parent generator so
  // scraping / PDF parsing / stored data remain the single source of truth)
  externalPropertyType?: string;
  onPropertyTypeChange?: (value: string) => void;
  beds?: string;
  onBedsChange?: (value: string) => void;
  baths?: string;
  onBathsChange?: (value: string) => void;
  onPurchasePriceChange?: (value: string) => void;
  onWeeklyRentChange?: (value: string) => void;
  onCarSpacesChange?: (value: string) => void;
  onLandSizeChange?: (value: string) => void;
  onBuildSizeChange?: (value: string) => void;
  onLandPriceChange?: (value: string) => void;
  onBuildPriceChange?: (value: string) => void;
  /** Hide the in-panel build type selector when the host page already owns it. */
  hideBuildTypeSelector?: boolean;
  /** Host action (e.g. Generate Report) rendered inside the sticky step footer on every step. */
  action?: ReactNode;
}

export function PreGenerationOverrides({ 
  propertyAddress = '', 
  onDataChange, 
  disabled = false,
  buildType: externalBuildType,
  onBuildTypeChange,
  externalPurchasePrice,
  externalPropertyValue,
  externalLandPrice,
  externalBuildPrice,
  externalWeeklyRent,
  externalCarSpaces,
  externalLandSize,
  externalBuildSize,
  externalCouncilRates,
  externalWaterRates,
  externalBodyCorporateFees,
  externalBuildingInsurance,
  externalPropertyManagementPercent,
  externalConstructionYear,
  externalPropertyType,
  onPropertyTypeChange,
  beds,
  onBedsChange,
  baths,
  onBathsChange,
  onPurchasePriceChange,
  onWeeklyRentChange,
  onCarSpacesChange,
  onLandSizeChange,
  onBuildSizeChange,
  onLandPriceChange,
  onBuildPriceChange,
  hideBuildTypeSelector = false,
  action
}: PreGenerationOverridesProps) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<OverrideStep>('property');
  const scrollRootRef = useRef<HTMLDivElement>(null);

  /**
   * Step navigation. Switching the tab alone leaves the reader parked halfway
   * down the previous category, so the scroll viewport is returned to the top
   * of the newly revealed section — smoothly, and respecting reduced motion.
   */
  const goToStep = useCallback((step: OverrideStep) => {
    setActiveTab(step);
    requestAnimationFrame(() => {
      const viewport = scrollRootRef.current?.querySelector<HTMLElement>(
        '[data-radix-scroll-area-viewport]'
      );
      const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      viewport?.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
      scrollRootRef.current?.scrollIntoView({
        behavior: prefersReduced ? 'auto' : 'smooth',
        block: 'nearest',
      });
    });
  }, []);
  
  // Build type selection. The property-type choice now lives ONCE at the top of
  // the Reports page, so this panel only ever reads it. `onBuildTypeChange` is
  // retained for callers that still want to drive the selection from here.
  const [internalBuildType, setInternalBuildType] = useState<BuildType>(externalBuildType || 'existing_property');
  const buildType = externalBuildType !== undefined ? externalBuildType : internalBuildType;

  const handleBuildTypeChange = useCallback((value: BuildType) => {
    setInternalBuildType(value);
    onBuildTypeChange?.(value);
  }, [onBuildTypeChange]);

  
  // Property type for expense estimation. When the parent owns it (the report
  // generator does, because scraping and PDF parsing write it), the parent value
  // wins and edits are pushed straight back up — one source of truth.
  const [internalPropertyType, setInternalPropertyType] = useState<string>('house');
  const propertyType = externalPropertyType !== undefined ? externalPropertyType : internalPropertyType;
  const setPropertyType = useCallback((value: string) => {
    setInternalPropertyType(value);
    onPropertyTypeChange?.(value);
  }, [onPropertyTypeChange]);
  
  // Core property values
  const [purchasePrice, setPurchasePrice] = useState<string>('');
  const [propertyValue, setPropertyValue] = useState<string>('');
  const [landPrice, setLandPrice] = useState<string>('');
  const [buildPrice, setBuildPrice] = useState<string>('');
  const [carSpaces, setCarSpaces] = useState<string>('');
  const [depositValue, setDepositValue] = useState<string>('');
  const [loanToValueRatio, setLoanToValueRatio] = useState<string>('80');
  const [interestRate, setInterestRate] = useState<string>('6.5');
  const [capitalGrowth, setCapitalGrowth] = useState<string>('5');
  
  // Rental income
  const [weeklyRent, setWeeklyRent] = useState<string>('');
  
  // Annual expenses
  const [stampDuty, setStampDuty] = useState<string>('');
  const [bodyCorporateFees, setBodyCorporateFees] = useState<string>('');
  const [strataAdminFund, setStrataAdminFund] = useState<string>('');
  const [strataSinkingFund, setStrataSinkingFund] = useState<string>('');
  const [strataSpecialLevies, setStrataSpecialLevies] = useState<string>('');
  const [landTax, setLandTax] = useState<string>('');
  const [councilRates, setCouncilRates] = useState<string>('');
  const [waterRates, setWaterRates] = useState<string>('');
  const [solicitorFees, setSolicitorFees] = useState<string>('');
  const [buildingLandlordInsurance, setBuildingLandlordInsurance] = useState<string>('');
  const [propertyManagementFees, setPropertyManagementFees] = useState<string>('8');
  const [repairsMaintenance, setRepairsMaintenance] = useState<string>('');
  const [lettingFees, setLettingFees] = useState<string>('');
  const [agentFee, setAgentFee] = useState<string>('');
  
  // Cash Flow Analysis Optional Overrides
  const [cpiGrowthRate, setCpiGrowthRate] = useState<string>('');
  const [depreciation, setDepreciation] = useState<string>('');
  const [taxRate, setTaxRate] = useState<string>('');
  const [occupancyRate, setOccupancyRate] = useState<string>('52');
  const [loanType, setLoanType] = useState<'interest_only' | 'principal_interest'>('interest_only');
  const [loanTermYears, setLoanTermYears] = useState<string>('30');
  const [marketValueNow, setMarketValueNow] = useState<string>('');
  
  // 10-Year Depreciation Schedule (from calculator)
  const [depreciationSchedule, setDepreciationSchedule] = useState<Record<number, number> | undefined>(undefined);
  const [depreciationMethod, setDepreciationMethod] = useState<'dv' | 'pc' | undefined>(undefined);
  
  // Additional Cash Flow Fields
  const [loanAmount, setLoanAmount] = useState<string>('');
  const [interestOnlyPeriodYears, setInterestOnlyPeriodYears] = useState<string>('');
  const [repaymentFrequency, setRepaymentFrequency] = useState<'weekly' | 'fortnightly' | 'monthly'>('monthly');
  const [extraRepaymentPerMonth, setExtraRepaymentPerMonth] = useState<string>('');
  const [offsetBalance, setOffsetBalance] = useState<string>('');
  const [constructionDurationMonths, setConstructionDurationMonths] = useState<string>('');
  const [constructionYear, setConstructionYear] = useState<string>('');
  const [landSizeSqm, setLandSizeSqm] = useState<string>('');
  const [buildSizeSqm, setBuildSizeSqm] = useState<string>('');
  
  // First Home Buyer flag
  const [isFirstHomeBuyer, setIsFirstHomeBuyer] = useState<boolean>(false);
  
  // Construction Stage Percentages
  const [stageDepositPercent, setStageDepositPercent] = useState<string>('5');
  const [stageSlabPercent, setStageSlabPercent] = useState<string>('15');
  const [stageFramePercent, setStageFramePercent] = useState<string>('20');
  const [stageLockupPercent, setStageLockupPercent] = useState<string>('25');
  const [stageFixingPercent, setStageFixingPercent] = useState<string>('20');
  const [stageCompletionPercent, setStageCompletionPercent] = useState<string>('15');
  
  // Construction Schedule Preset Mode
  type SchedulePreset = 'rapid' | 'even' | 'custom';
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>('rapid');
  const [customStageMonths, setCustomStageMonths] = useState<{ [stageIndex: number]: number }>({
    0: 2, 1: 3, 2: 4, 3: 5, 4: 6, 5: 7
  });
  
  // Zoning Information
  const [zoningCode, setZoningCode] = useState<string>('');
  const [zoningDescription, setZoningDescription] = useState<string>('');
  const [permittedUses, setPermittedUses] = useState<string>('');
  const [developmentPotential, setDevelopmentPotential] = useState<string>('');
  const [zoningOverlays, setZoningOverlays] = useState<string>('');
  const [minimumLotSize, setMinimumLotSize] = useState<string>('');
  const [maximumHeight, setMaximumHeight] = useState<string>('');
  const [floorSpaceRatio, setFloorSpaceRatio] = useState<string>('');
  
  // State detection
  const [detectedState, setDetectedState] = useState<string>('All');
  
  // Loading state for expense estimation
  const [isEstimatingExpenses, setIsEstimatingExpenses] = useState(false);

  // Estimate CGR: the register's reading for the typed address, shown under Growth.
  const [isEstimatingCgr, setIsEstimatingCgr] = useState(false);
  const [cgrEstimate, setCgrEstimate] = useState<CgrEstimateReading | null>(null);
  const cgrEstimateAddressRef = useRef<string>('');

  // Locality-derived growth estimates for New Build auto-fill
  const localityGrowthEstimate = useMemo(() => {
    if (!propertyAddress) return null;
    return getLocalityGrowthEstimate(propertyAddress);
  }, [propertyAddress]);

  const derivedCpiHint = useMemo(() => {
    const cgValue = capitalGrowth ? parseFloat(capitalGrowth) : null;
    return getDerivedCpiGrowth(cgValue, propertyAddress);
  }, [capitalGrowth, propertyAddress]);


  // Detect state from property address
  const detectStateFromAddress = useCallback((address: string): string => {
    if (!address) return 'All';
    const upperAddress = address.toUpperCase();
    
    for (const abbr of Object.keys(STATE_MAPPING)) {
      const patterns = [
        new RegExp(`\\b${abbr}\\b`),
        new RegExp(`\\s${abbr}\\s*\\d{4}`),
        new RegExp(`,\\s*${abbr}\\s`),
      ];
      if (patterns.some(p => p.test(upperAddress))) {
        return abbr;
      }
    }
    
    for (const [abbr, fullName] of Object.entries(STATE_MAPPING)) {
      if (upperAddress.includes(fullName.toUpperCase())) {
        return abbr;
      }
    }
    
    return 'All';
  }, []);

  // Detect state when address changes
  useEffect(() => {
    if (propertyAddress) {
      const state = detectStateFromAddress(propertyAddress);
      setDetectedState(state);
    }
  }, [propertyAddress, detectStateFromAddress]);

  // Sync external purchasePrice prop - only react to external changes
  const lastExternalPurchasePrice = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalPurchasePrice !== undefined) {
      // Only sync if the external value has actually changed from what we last saw
      if (lastExternalPurchasePrice.current !== externalPurchasePrice) {
        lastExternalPurchasePrice.current = externalPurchasePrice;
        setPurchasePrice(externalPurchasePrice.toString());
      }
    }
  }, [externalPurchasePrice]);

  // Sync external weeklyRent prop - using ref to prevent loops
  const lastExternalWeeklyRent = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalWeeklyRent !== undefined) {
      if (lastExternalWeeklyRent.current !== externalWeeklyRent) {
        lastExternalWeeklyRent.current = externalWeeklyRent;
        setWeeklyRent(externalWeeklyRent.toString());
      }
    }
  }, [externalWeeklyRent]);

  // Sync external carSpaces prop - using ref to prevent loops
  const lastExternalCarSpaces = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalCarSpaces !== undefined) {
      if (lastExternalCarSpaces.current !== externalCarSpaces) {
        lastExternalCarSpaces.current = externalCarSpaces;
        setCarSpaces(externalCarSpaces.toString());
      }
    }
  }, [externalCarSpaces]);

  // Sync external landSize prop - using ref to prevent loops
  const lastExternalLandSize = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalLandSize !== undefined) {
      if (lastExternalLandSize.current !== externalLandSize) {
        lastExternalLandSize.current = externalLandSize;
        setLandSizeSqm(externalLandSize.toString());
      }
    }
  }, [externalLandSize]);

  // Sync external buildSize prop - using ref to prevent loops
  const lastExternalBuildSize = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalBuildSize !== undefined) {
      if (lastExternalBuildSize.current !== externalBuildSize) {
        lastExternalBuildSize.current = externalBuildSize;
        setBuildSizeSqm(externalBuildSize.toString());
      }
    }
  }, [externalBuildSize]);

  // Sync external propertyValue prop - using ref to prevent loops
  const lastExternalPropertyValue = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalPropertyValue !== undefined) {
      if (lastExternalPropertyValue.current !== externalPropertyValue) {
        lastExternalPropertyValue.current = externalPropertyValue;
        setPropertyValue(externalPropertyValue.toString());
      }
    }
  }, [externalPropertyValue]);

  // Sync external landPrice prop - using ref to prevent loops
  const lastExternalLandPrice = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalLandPrice !== undefined) {
      if (lastExternalLandPrice.current !== externalLandPrice) {
        lastExternalLandPrice.current = externalLandPrice;
        setLandPrice(externalLandPrice.toString());
      }
    }
  }, [externalLandPrice]);

  // Sync external buildPrice prop - using ref to prevent loops
  const lastExternalBuildPrice = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalBuildPrice !== undefined) {
      if (lastExternalBuildPrice.current !== externalBuildPrice) {
        lastExternalBuildPrice.current = externalBuildPrice;
        setBuildPrice(externalBuildPrice.toString());
      }
    }
  }, [externalBuildPrice]);

  // Sync external councilRates prop - using ref to prevent loops
  const lastExternalCouncilRates = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalCouncilRates !== undefined) {
      if (lastExternalCouncilRates.current !== externalCouncilRates) {
        lastExternalCouncilRates.current = externalCouncilRates;
        setCouncilRates(externalCouncilRates.toString());
      }
    }
  }, [externalCouncilRates]);

  // Sync external waterRates prop - using ref to prevent loops
  const lastExternalWaterRates = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalWaterRates !== undefined) {
      if (lastExternalWaterRates.current !== externalWaterRates) {
        lastExternalWaterRates.current = externalWaterRates;
        setWaterRates(externalWaterRates.toString());
      }
    }
  }, [externalWaterRates]);

  // Sync external bodyCorporateFees prop - using ref to prevent loops
  const lastExternalBodyCorporateFees = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalBodyCorporateFees !== undefined) {
      if (lastExternalBodyCorporateFees.current !== externalBodyCorporateFees) {
        lastExternalBodyCorporateFees.current = externalBodyCorporateFees;
        setBodyCorporateFees(externalBodyCorporateFees.toString());
      }
    }
  }, [externalBodyCorporateFees]);

  // Sync external buildingInsurance prop - using ref to prevent loops
  const lastExternalBuildingInsurance = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalBuildingInsurance !== undefined) {
      if (lastExternalBuildingInsurance.current !== externalBuildingInsurance) {
        lastExternalBuildingInsurance.current = externalBuildingInsurance;
        setBuildingLandlordInsurance(externalBuildingInsurance.toString());
      }
    }
  }, [externalBuildingInsurance]);

  // Sync external propertyManagementPercent prop - using ref to prevent loops
  const lastExternalPropertyManagementPercent = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalPropertyManagementPercent !== undefined) {
      if (lastExternalPropertyManagementPercent.current !== externalPropertyManagementPercent) {
        lastExternalPropertyManagementPercent.current = externalPropertyManagementPercent;
        setPropertyManagementFees(externalPropertyManagementPercent.toString());
      }
    }
  }, [externalPropertyManagementPercent]);

  // Sync external constructionYear prop - using ref to prevent loops
  const lastExternalConstructionYear = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (externalConstructionYear !== undefined) {
      if (lastExternalConstructionYear.current !== externalConstructionYear) {
        lastExternalConstructionYear.current = externalConstructionYear;
        setConstructionYear(externalConstructionYear.toString());
      }
    }
  }, [externalConstructionYear]);

  // Track if user has manually edited loan amount
  const [userEditedLoanAmount, setUserEditedLoanAmount] = useState(false);
  
  // Dynamic calculation - Deposit from Purchase Price and LVR
  useEffect(() => {
    if (buildType === 'existing_property' && purchasePrice && loanToValueRatio) {
      const price = parseFloat(purchasePrice) || 0;
      const lvr = parseFloat(loanToValueRatio) || 80;
      if (price > 0) {
        const deposit = price * ((100 - lvr) / 100);
        setDepositValue(Math.round(deposit).toString());
      }
    }
  }, [buildType, purchasePrice, loanToValueRatio]);

  // Dynamic calculation - Loan Amount from Purchase Price and LVR (unless manually overridden)
  useEffect(() => {
    // Only auto-calculate if user hasn't manually edited the loan amount
    if (!userEditedLoanAmount) {
      const price = buildType === 'new_build' 
        ? (parseFloat(landPrice) || 0) + (parseFloat(buildPrice) || 0)
        : parseFloat(purchasePrice) || 0;
      const lvr = parseFloat(loanToValueRatio) || 80;
      
      if (price > 0) {
        const calculatedLoan = price * (lvr / 100);
        setLoanAmount(Math.round(calculatedLoan).toString());
      }
    }
  }, [buildType, purchasePrice, landPrice, buildPrice, loanToValueRatio, userEditedLoanAmount]);

  // Dynamic calculation - Letting Fees = Weekly Rent
  useEffect(() => {
    if (weeklyRent) {
      setLettingFees(weeklyRent);
    }
  }, [weeklyRent]);

  // Dynamic calculation - Body Corporate = Admin + Sinking + Special Levies
  useEffect(() => {
    const admin = parseFloat(strataAdminFund) || 0;
    const sinking = parseFloat(strataSinkingFund) || 0;
    const special = parseFloat(strataSpecialLevies) || 0;
    const total = admin + sinking + special;
    if (total > 0) {
      setBodyCorporateFees(total.toString());
    }
  }, [strataAdminFund, strataSinkingFund, strataSpecialLevies]);

  // Estimate expenses using edge function
  const estimateExpenses = useCallback(async () => {
    if (!propertyAddress) {
      toast({
        title: "Address Required",
        description: "Please enter a property address first.",
        variant: "destructive"
      });
      return;
    }

    const price = buildType === 'new_build' 
      ? (parseFloat(landPrice) || 0) + (parseFloat(buildPrice) || 0)
      : parseFloat(purchasePrice) || 0;

    if (price <= 0) {
      toast({
        title: "Price Required",
        description: "Please enter a purchase price first.",
        variant: "destructive"
      });
      return;
    }

    setIsEstimatingExpenses(true);
    try {
      const { data, error } = await invokeSecureFunction('estimate-property-expenses', {
        propertyAddress,
        purchasePrice: price,
        weeklyRent: parseFloat(weeklyRent) || 0,
        propertyType
      });

      if (error) throw error;

      if (data?.success && data?.estimates) {
        const estimates = data.estimates;
        
        if (estimates.bodyCorporateFees > 0) {
          setBodyCorporateFees(estimates.bodyCorporateFees.toString());
          setStrataAdminFund(Math.round(estimates.bodyCorporateFees * 0.6).toString());
          setStrataSinkingFund(Math.round(estimates.bodyCorporateFees * 0.3).toString());
          setStrataSpecialLevies(Math.round(estimates.bodyCorporateFees * 0.1).toString());
        }
        if (estimates.landTax > 0) setLandTax(estimates.landTax.toString());
        if (estimates.councilRates > 0) setCouncilRates(estimates.councilRates.toString());
        if (estimates.waterRates > 0) setWaterRates(estimates.waterRates.toString());
        if (estimates.solicitorFees > 0) setSolicitorFees(estimates.solicitorFees.toString());
        if (estimates.buildingLandlordInsurance > 0) setBuildingLandlordInsurance(estimates.buildingLandlordInsurance.toString());
        if (estimates.propertyManagementFees > 0) setPropertyManagementFees(estimates.propertyManagementFees.toString());
        if (estimates.repairsMaintenance > 0) setRepairsMaintenance(estimates.repairsMaintenance.toString());

        toast({
          title: "Expenses Estimated",
          description: "AI-powered expense estimates have been applied. Review and adjust as needed.",
        });
      } else {
        throw new Error(data?.error || 'Failed to estimate expenses');
      }
    } catch (error) {
      console.error('Error estimating expenses:', error);
      const errorMessage = error instanceof Error ? error.message : "Failed to estimate expenses";
      const isAuthError = errorMessage.includes('401') || errorMessage.includes('Authentication') || errorMessage.includes('Unauthorized');
      toast({
        title: "Estimation Failed",
        description: isAuthError 
          ? "Session expired. Please log out and log back in, then try again."
          : errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsEstimatingExpenses(false);
    }
  }, [propertyAddress, buildType, landPrice, buildPrice, purchasePrice, weeklyRent, propertyType, toast]);

  // Estimate CGR — the growth rate the ten-year cash flow assumes, read from
  // the open sales register for the address typed at the top of the form.
  // The field is filled only with a figure the register measured; where no
  // series reaches the address the field is left as it was and the reading
  // says so. What the button writes is the same `capitalGrowth` the cash
  // flow already reads, so the estimate flows into the projection unchanged.
  const estimateCgr = useCallback(async () => {
    if (!propertyAddress) {
      toast({ title: "Address Required", description: "Please enter a property address first.", variant: "destructive" });
      return;
    }
    setIsEstimatingCgr(true);
    try {
      const { data, error } = await invokeSecureFunction('estimate-capital-growth', {
        propertyAddress,
        propertyType,
      });
      if (error) throw error;
      if (data?.success && data?.found && data?.estimate) {
        const e = data.estimate;
        const reading: CgrEstimateReading = {
          ratePct: Number(e.ratePct),
          horizonYears: Number(e.horizonYears),
          areaName: String(e.areaName ?? ''),
          level: String(e.level ?? ''),
          latestPeriod: e.latestPeriod ?? null,
          latestPeriodLabel: typeof e.latestPeriodLabel === 'string' ? e.latestPeriodLabel : null,
          loadedAt: typeof e.loadedAt === 'string' ? e.loadedAt : null,
          basis: String(e.basis ?? ''),
          caveats: Array.isArray(e.caveats) ? e.caveats.map(String) : [],
          alternatives: Array.isArray(e.alternatives)
            ? e.alternatives.map((a: { areaName?: unknown; horizonYears?: unknown; ratePct?: unknown }) => ({ areaName: String(a.areaName ?? ''), horizonYears: Number(a.horizonYears), ratePct: Number(a.ratePct) }))
            : [],
        };
        setCapitalGrowth(reading.ratePct.toFixed(1));
        setCgrEstimate(reading);
        cgrEstimateAddressRef.current = propertyAddress;
        toast({
          title: "Capital growth estimated",
          description: `${reading.ratePct}% a year — ${reading.horizonYears}-year compound growth, ${reading.areaName}. Review the basis under the field.`,
        });
      } else if (data?.success && data?.found === false) {
        setCgrEstimate(null);
        toast({
          title: "No growth series for this address",
          description: data?.reason ? `${data.reason}. The Growth field is unchanged.` : "The Growth field is unchanged.",
          variant: "destructive",
        });
      } else {
        throw new Error(data?.error || 'Failed to estimate capital growth');
      }
    } catch (error) {
      console.error('Error estimating capital growth:', error);
      const errorMessage = error instanceof Error ? error.message : "Failed to estimate capital growth";
      const isAuthError = errorMessage.includes('401') || errorMessage.includes('Authentication') || errorMessage.includes('Unauthorized');
      toast({
        title: "Estimate failed",
        description: isAuthError
          ? "Session expired. Please log out and log back in, then try again."
          : errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsEstimatingCgr(false);
    }
  }, [propertyAddress, propertyType, toast]);

  // A reading describes the address it was asked for; a new address hides it.
  const cgrEstimateForAddress = cgrEstimate && cgrEstimateAddressRef.current === propertyAddress ? cgrEstimate : null;

  /**
   * Shared-field writers. These fields are also held by the report generator
   * (they feed the generation payload, validation and the scrape/parse fill),
   * so an edit inside the Property step updates BOTH copies — the panel keeps
   * its local string state and the parent is notified immediately, rather than
   * relying on the debounced onDataChange round-trip which cannot express a
   * cleared field.
   */
  const writePurchasePrice = useCallback((value: string) => {
    setPurchasePrice(value);
    onPurchasePriceChange?.(value);
  }, [onPurchasePriceChange]);
  const writeWeeklyRent = useCallback((value: string) => {
    setWeeklyRent(value);
    onWeeklyRentChange?.(value);
  }, [onWeeklyRentChange]);
  const writeCarSpaces = useCallback((value: string) => {
    setCarSpaces(value);
    onCarSpacesChange?.(value);
  }, [onCarSpacesChange]);
  const writeLandSizeSqm = useCallback((value: string) => {
    setLandSizeSqm(value);
    onLandSizeChange?.(value);
  }, [onLandSizeChange]);
  const writeBuildSizeSqm = useCallback((value: string) => {
    setBuildSizeSqm(value);
    onBuildSizeChange?.(value);
  }, [onBuildSizeChange]);
  const writeLandPrice = useCallback((value: string) => {
    setLandPrice(value);
    onLandPriceChange?.(value);
  }, [onLandPriceChange]);
  const writeBuildPrice = useCallback((value: string) => {
    setBuildPrice(value);
    onBuildPriceChange?.(value);
  }, [onBuildPriceChange]);

  // Notify parent of data changes
  useEffect(() => {
    const data: PreGenerationData = {
      buildType,
      purchasePrice: purchasePrice ? parseFloat(purchasePrice) : undefined,
      propertyValue: propertyValue ? parseFloat(propertyValue) : undefined,
      landPrice: landPrice ? parseFloat(landPrice) : undefined,
      buildPrice: buildPrice ? parseFloat(buildPrice) : undefined,
      carSpaces: carSpaces ? parseInt(carSpaces) : undefined,
      depositValue: buildType === 'existing_property' && depositValue ? parseFloat(depositValue) : undefined,
      loanToValueRatio: loanToValueRatio ? parseFloat(loanToValueRatio) : undefined,
      interestRate: interestRate ? parseFloat(interestRate) : undefined,
      capitalGrowth: capitalGrowth ? parseFloat(capitalGrowth) : undefined,
      weeklyRent: weeklyRent ? parseFloat(weeklyRent) : undefined,
      stampDuty: stampDuty ? parseFloat(stampDuty) : undefined,
      bodyCorporateFees: bodyCorporateFees ? parseFloat(bodyCorporateFees) : undefined,
      strataAdminFund: strataAdminFund ? parseFloat(strataAdminFund) : undefined,
      strataSinkingFund: strataSinkingFund ? parseFloat(strataSinkingFund) : undefined,
      strataSpecialLevies: strataSpecialLevies ? parseFloat(strataSpecialLevies) : undefined,
      landTax: landTax ? parseFloat(landTax) : undefined,
      councilRates: councilRates ? parseFloat(councilRates) : undefined,
      waterRates: waterRates ? parseFloat(waterRates) : undefined,
      solicitorFees: solicitorFees ? parseFloat(solicitorFees) : undefined,
      buildingLandlordInsurance: buildingLandlordInsurance ? parseFloat(buildingLandlordInsurance) : undefined,
      propertyManagementFees: propertyManagementFees ? parseFloat(propertyManagementFees) : undefined,
      repairsMaintenance: repairsMaintenance ? parseFloat(repairsMaintenance) : undefined,
      lettingFees: lettingFees ? parseFloat(lettingFees) : undefined,
      agentFee: buildType === 'existing_property' && agentFee ? parseFloat(agentFee) : undefined,
      propertyType,
      cpiGrowthRate: cpiGrowthRate ? parseFloat(cpiGrowthRate) : undefined,
      depreciation: depreciation ? parseFloat(depreciation) : undefined,
      taxRate: taxRate ? parseFloat(taxRate) : undefined,
      occupancyRate: occupancyRate ? parseFloat(occupancyRate) : undefined,
      loanType: loanType || undefined,
      loanTermYears: loanTermYears ? parseFloat(loanTermYears) : undefined,
      marketValueNow: marketValueNow ? parseFloat(marketValueNow) : undefined,
      depreciationSchedule: depreciationSchedule || undefined,
      depreciationMethod: depreciationMethod || undefined,
      loanAmount: loanAmount ? parseFloat(loanAmount) : undefined,
      interestOnlyPeriodYears: interestOnlyPeriodYears ? parseFloat(interestOnlyPeriodYears) : undefined,
      repaymentFrequency: repaymentFrequency || undefined,
      extraRepaymentPerMonth: extraRepaymentPerMonth ? parseFloat(extraRepaymentPerMonth) : undefined,
      offsetBalance: offsetBalance ? parseFloat(offsetBalance) : undefined,
      constructionDurationMonths: buildType === 'new_build' && constructionDurationMonths ? parseFloat(constructionDurationMonths) : undefined,
      constructionYear: constructionYear ? parseFloat(constructionYear) : undefined,
      landSizeSqm: landSizeSqm ? parseFloat(landSizeSqm) : undefined,
      buildSizeSqm: buildSizeSqm ? parseFloat(buildSizeSqm) : undefined,
      isFirstHomeBuyer: isFirstHomeBuyer || undefined,
      stageDepositPercent: buildType === 'new_build' && stageDepositPercent ? parseFloat(stageDepositPercent) : undefined,
      stageSlabPercent: buildType === 'new_build' && stageSlabPercent ? parseFloat(stageSlabPercent) : undefined,
      stageFramePercent: buildType === 'new_build' && stageFramePercent ? parseFloat(stageFramePercent) : undefined,
      stageLockupPercent: buildType === 'new_build' && stageLockupPercent ? parseFloat(stageLockupPercent) : undefined,
      stageFixingPercent: buildType === 'new_build' && stageFixingPercent ? parseFloat(stageFixingPercent) : undefined,
      stageCompletionPercent: buildType === 'new_build' && stageCompletionPercent ? parseFloat(stageCompletionPercent) : undefined,
      schedulePreset: buildType === 'new_build' ? schedulePreset : undefined,
      customStageMonths: buildType === 'new_build' && schedulePreset === 'custom' ? customStageMonths : undefined,
      // Zoning Information
      zoningCode: zoningCode || undefined,
      zoningDescription: zoningDescription || undefined,
      permittedUses: permittedUses || undefined,
      developmentPotential: developmentPotential || undefined,
      zoningOverlays: zoningOverlays || undefined,
      minimumLotSize: minimumLotSize ? parseFloat(minimumLotSize) : undefined,
      maximumHeight: maximumHeight ? parseFloat(maximumHeight) : undefined,
      floorSpaceRatio: floorSpaceRatio ? parseFloat(floorSpaceRatio) : undefined,
    };
    
    onDataChange(data);
  }, [
    buildType, purchasePrice, propertyValue, landPrice, buildPrice, carSpaces, depositValue, 
    loanToValueRatio, interestRate, capitalGrowth, weeklyRent,
    stampDuty, bodyCorporateFees, strataAdminFund, strataSinkingFund, strataSpecialLevies,
    landTax, councilRates, waterRates, solicitorFees, buildingLandlordInsurance, 
    propertyManagementFees, repairsMaintenance, lettingFees, agentFee, propertyType,
    cpiGrowthRate, depreciation, taxRate, occupancyRate, loanType, loanTermYears, marketValueNow,
    depreciationSchedule, depreciationMethod,
    loanAmount, interestOnlyPeriodYears, repaymentFrequency, extraRepaymentPerMonth, offsetBalance,
    constructionDurationMonths, constructionYear, landSizeSqm, buildSizeSqm,
    isFirstHomeBuyer, stageDepositPercent, stageSlabPercent, stageFramePercent, 
    stageLockupPercent, stageFixingPercent, stageCompletionPercent,
    schedulePreset, customStageMonths,
    zoningCode, zoningDescription, permittedUses, developmentPotential,
    zoningOverlays, minimumLotSize, maximumHeight, floorSpaceRatio,
    onDataChange
  ]);

  return (
    <Card className="reports-overrides-panel border-dashed">
      <CardHeader className="reports-overrides-header pb-3">
        <CardTitle className="reports-overrides-title text-base md:text-lg flex items-center gap-2">
          <Calculator className="h-4 w-4 md:h-5 md:w-5 text-primary" />
          Pre-Generation Overrides
        </CardTitle>
        <CardDescription className="reports-overrides-description text-xs md:text-sm">
          Set manual values to inject into the report generation.
        </CardDescription>
      </CardHeader>
      <CardContent className="reports-overrides-content px-3 md:px-6">
        <Tabs value={activeTab} onValueChange={(value) => goToStep(value as OverrideStep)} className="reports-overrides-tabs w-full">
          <div className={isMobile ? "reports-overrides-tabs-scroll overflow-x-auto -mx-3 px-3 pb-2" : "reports-overrides-tabs-wrap"}>
            <TabsList className={isMobile ? "reports-overrides-tabs-list inline-flex w-auto min-w-full mb-4" : "reports-overrides-tabs-list grid w-full grid-cols-4 mb-4"}>
              <TabsTrigger 
                value="property" 
                className="reports-overrides-tab flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap data-[state=active]:bg-brand-400 data-[state=active]:text-black"
              >
                <Home className="h-3.5 w-3.5" />
                <span className={isMobile ? "" : "hidden sm:inline"}>Property</span>
              </TabsTrigger>
              <TabsTrigger 
                value="financials" 
                className="reports-overrides-tab flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap data-[state=active]:bg-brand-400 data-[state=active]:text-black"
              >
                <DollarSign className="h-3.5 w-3.5" />
                <span className={isMobile ? "" : "hidden sm:inline"}>Financials</span>
              </TabsTrigger>
              <TabsTrigger 
                value="income" 
                className="reports-overrides-tab flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap data-[state=active]:bg-brand-400 data-[state=active]:text-black"
              >
                <TrendingUp className="h-3.5 w-3.5" />
                <span className={isMobile ? "" : "hidden sm:inline"}>Income</span>
              </TabsTrigger>
              <TabsTrigger 
                value="advanced" 
                className="reports-overrides-tab flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap data-[state=active]:bg-brand-400 data-[state=active]:text-black"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span className={isMobile ? "" : "hidden sm:inline"}>Advanced</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea ref={scrollRootRef} className={isMobile ? "reports-overrides-scroll reports-overrides-scroll-mobile pr-2" : "reports-overrides-scroll reports-overrides-scroll-desktop pr-4"}
            aria-label="Pre-generation override fields">
            <TabsContent value="property" className="reports-overrides-tab-content mt-0">
              <PropertyTab
                buildType={buildType}
                onBuildTypeChange={handleBuildTypeChange}
                showBuildTypeSelector={!hideBuildTypeSelector}
                purchasePrice={purchasePrice}
                setPurchasePrice={writePurchasePrice}
                propertyValue={propertyValue}
                setPropertyValue={setPropertyValue}
                landPrice={landPrice}
                setLandPrice={writeLandPrice}
                buildPrice={buildPrice}
                setBuildPrice={writeBuildPrice}
                weeklyRent={weeklyRent}
                setWeeklyRent={writeWeeklyRent}
                beds={beds}
                setBeds={onBedsChange}
                baths={baths}
                setBaths={onBathsChange}
                propertyType={propertyType}
                setPropertyType={setPropertyType}
                carSpaces={carSpaces}
                setCarSpaces={writeCarSpaces}
                landSizeSqm={landSizeSqm}
                setLandSizeSqm={writeLandSizeSqm}
                buildSizeSqm={buildSizeSqm}
                setBuildSizeSqm={writeBuildSizeSqm}
                zoningCode={zoningCode}
                setZoningCode={setZoningCode}
                zoningDescription={zoningDescription}
                setZoningDescription={setZoningDescription}
                permittedUses={permittedUses}
                setPermittedUses={setPermittedUses}
                developmentPotential={developmentPotential}
                setDevelopmentPotential={setDevelopmentPotential}
                zoningOverlays={zoningOverlays}
                setZoningOverlays={setZoningOverlays}
                minimumLotSize={minimumLotSize}
                setMinimumLotSize={setMinimumLotSize}
                maximumHeight={maximumHeight}
                setMaximumHeight={setMaximumHeight}
                floorSpaceRatio={floorSpaceRatio}
                setFloorSpaceRatio={setFloorSpaceRatio}
                disabled={disabled}
              />
              <OverrideStepFooter current="property" onNavigate={goToStep} action={action} />
            </TabsContent>

            <TabsContent value="financials" className="reports-overrides-tab-content mt-0">
              <FinancialsTab
                buildType={buildType}
                purchasePrice={purchasePrice}
                depositValue={depositValue}
                setDepositValue={setDepositValue}
                loanToValueRatio={loanToValueRatio}
                setLoanToValueRatio={setLoanToValueRatio}
                interestRate={interestRate}
                setInterestRate={setInterestRate}
                loanTermYears={loanTermYears}
                setLoanTermYears={setLoanTermYears}
                loanType={loanType}
                setLoanType={setLoanType}
                capitalGrowth={capitalGrowth}
                setCapitalGrowth={setCapitalGrowth}
                onEstimateCgr={estimateCgr}
                isEstimatingCgr={isEstimatingCgr}
                cgrEstimate={cgrEstimateForAddress}
                stampDuty={stampDuty}
                setStampDuty={setStampDuty}
                solicitorFees={solicitorFees}
                setSolicitorFees={setSolicitorFees}
                agentFee={agentFee}
                setAgentFee={setAgentFee}
                isFirstHomeBuyer={isFirstHomeBuyer}
                setIsFirstHomeBuyer={setIsFirstHomeBuyer}
                detectedState={detectedState}
                propertyAddress={propertyAddress}
                landPrice={landPrice}
                disabled={disabled}
                loanAmount={loanAmount}
                setLoanAmount={setLoanAmount}
                interestOnlyPeriodYears={interestOnlyPeriodYears}
                setInterestOnlyPeriodYears={setInterestOnlyPeriodYears}
                repaymentFrequency={repaymentFrequency}
                setRepaymentFrequency={setRepaymentFrequency}
                extraRepaymentPerMonth={extraRepaymentPerMonth}
                setExtraRepaymentPerMonth={setExtraRepaymentPerMonth}
                offsetBalance={offsetBalance}
                setOffsetBalance={setOffsetBalance}
                localityGrowthEstimate={localityGrowthEstimate}
              />
              <OverrideStepFooter current="financials" onNavigate={goToStep} action={action} />
            </TabsContent>

            <TabsContent value="income" className="reports-overrides-tab-content mt-0">
              <IncomeExpensesTab
                weeklyRent={weeklyRent}
                setWeeklyRent={setWeeklyRent}
                occupancyRate={occupancyRate}
                setOccupancyRate={setOccupancyRate}
                bodyCorporateFees={bodyCorporateFees}
                setBodyCorporateFees={setBodyCorporateFees}
                strataAdminFund={strataAdminFund}
                setStrataAdminFund={setStrataAdminFund}
                strataSinkingFund={strataSinkingFund}
                setStrataSinkingFund={setStrataSinkingFund}
                strataSpecialLevies={strataSpecialLevies}
                setStrataSpecialLevies={setStrataSpecialLevies}
                councilRates={councilRates}
                setCouncilRates={setCouncilRates}
                waterRates={waterRates}
                setWaterRates={setWaterRates}
                landTax={landTax}
                setLandTax={setLandTax}
                buildingLandlordInsurance={buildingLandlordInsurance}
                setBuildingLandlordInsurance={setBuildingLandlordInsurance}
                propertyManagementFees={propertyManagementFees}
                setPropertyManagementFees={setPropertyManagementFees}
                repairsMaintenance={repairsMaintenance}
                setRepairsMaintenance={setRepairsMaintenance}
                lettingFees={lettingFees}
                setLettingFees={setLettingFees}
                isEstimatingExpenses={isEstimatingExpenses}
                onEstimateExpenses={estimateExpenses}
                disabled={disabled}
                propertyAddress={propertyAddress}
                detectedState={detectedState}
                purchasePrice={parseFloat(purchasePrice) || undefined}
                landPrice={parseFloat(landPrice) || undefined}
              />
              <OverrideStepFooter current="income" onNavigate={goToStep} action={action} />
            </TabsContent>

            <TabsContent value="advanced" className="reports-overrides-tab-content mt-0">
              <AdvancedTab
                buildType={buildType}
                cpiGrowthRate={cpiGrowthRate}
                setCpiGrowthRate={setCpiGrowthRate}
                depreciation={depreciation}
                setDepreciation={setDepreciation}
                taxRate={taxRate}
                setTaxRate={setTaxRate}
                marketValueNow={marketValueNow}
                setMarketValueNow={setMarketValueNow}
                loanAmount={loanAmount}
                setLoanAmount={(value: string) => {
                  setLoanAmount(value);
                  setUserEditedLoanAmount(true); // Mark as manually edited
                }}
                interestOnlyPeriodYears={interestOnlyPeriodYears}
                setInterestOnlyPeriodYears={setInterestOnlyPeriodYears}
                repaymentFrequency={repaymentFrequency}
                setRepaymentFrequency={setRepaymentFrequency}
                extraRepaymentPerMonth={extraRepaymentPerMonth}
                setExtraRepaymentPerMonth={setExtraRepaymentPerMonth}
                offsetBalance={offsetBalance}
                setOffsetBalance={setOffsetBalance}
                constructionDurationMonths={constructionDurationMonths}
                setConstructionDurationMonths={setConstructionDurationMonths}
                constructionYear={constructionYear}
                setConstructionYear={setConstructionYear}
                stageDepositPercent={stageDepositPercent}
                setStageDepositPercent={setStageDepositPercent}
                stageSlabPercent={stageSlabPercent}
                setStageSlabPercent={setStageSlabPercent}
                stageFramePercent={stageFramePercent}
                setStageFramePercent={setStageFramePercent}
                stageLockupPercent={stageLockupPercent}
                setStageLockupPercent={setStageLockupPercent}
                stageFixingPercent={stageFixingPercent}
                setStageFixingPercent={setStageFixingPercent}
                stageCompletionPercent={stageCompletionPercent}
                setStageCompletionPercent={setStageCompletionPercent}
                schedulePreset={schedulePreset}
                setSchedulePreset={setSchedulePreset}
                customStageMonths={customStageMonths}
                setCustomStageMonths={setCustomStageMonths}
                disabled={disabled}
                onApplyDepreciationSchedule={(schedule, method) => {
                  setDepreciationSchedule(schedule);
                  setDepreciationMethod(method);
                  // Also set Year 1 as the primary depreciation value
                  if (schedule[1]) {
                    setDepreciation(schedule[1].toString());
                  }
                }}
                purchasePrice={purchasePrice}
                derivedCpiHint={derivedCpiHint}
                capitalGrowthValue={capitalGrowth}
              />
              <OverrideStepFooter current="advanced" onNavigate={goToStep} action={action} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </CardContent>
    </Card>
  );
}
