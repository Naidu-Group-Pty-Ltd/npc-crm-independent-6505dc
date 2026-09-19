import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calculator, Loader2, RefreshCw, FlaskConical, Clock, Save, Building2, Shield, ShieldAlert, Upload, ShieldCheck, RotateCcw } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useBorrowingCapacity } from '@/hooks/useBorrowingCapacity';
import { getHemBenchmark, getHemBreakdown, getHecsRepayment, DEFAULT_DTI_CAP } from '@/utils/borrowingCapacityCalculations';
import { computeLiabilityServicing } from '@/utils/householdFinance';
import type { FullAssessmentResult, BorrowingCapacityInput, CalculationMode, HemBreakdown } from '@/utils/borrowingCapacityCalculations';
import type { LmiMode, LmiEstimate } from '@/utils/lmiCalculations';
import { calculateLmiImpact } from '@/utils/lmiCalculations';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

import { IncomeSection } from './sections/IncomeSection';
import { ExpensesSection } from './sections/ExpensesSection';
import { LiabilitiesSection } from './sections/LiabilitiesSection';
import { ProposedLoanSection, type ProposedRentalIncomeData } from './sections/ProposedLoanSection';
import { ResultsPanel } from './ResultsPanel';
import { StrategyScenarioModeling } from './scenarios/StrategyScenarioModeling';
import type { LiabilityItem as ScenarioLiabilityItem, PropertyItem as ScenarioPropertyItem, ScenarioPreset } from './scenarios/StrategyScenarioModeling';
import { CapacityHistoryChart } from './CapacityHistoryChart';
import { BankRateSelector } from './BankRateSelector';
import { BankRateComparisonModal } from './BankRateComparisonModal';
import { LmiSection } from './sections/LmiSection';
import { classifyIncomeLabel } from '@/utils/incomeComponentMapping';
import { useBcScenarios } from '@/hooks/useBcScenarios';

// Secure data fetching via HttpOnly cookies
async function fetchBorrowingCapacityData(clientId: string) {
  const { data, error } = await invokeSecureFunction('get-client-data', {
    clientId,
    include: {
      client: true,
      properties: true,
      income: true,
      incomeSources: true,
      liabilities: true,
      expenses: true,
      borrowingCapacity: true,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Failed to fetch borrowing capacity data');
  }

  const totalDeclaredFromDB = (data.expenses || []).reduce(
    (sum: number, exp: any) => sum + (Number(exp.monthly_amount) || 0), 
    0
  );

  // Get the latest assessment (sorted by created_at desc from the edge function)
  const assessments = data.borrowingCapacity || [];
  const latestAssessment = assessments.length > 0 ? assessments[0] : null;

  return {
    client: data.client,
    income: data.income || [],
    incomeSources: data.incomeSources || [],
    liabilities: data.liabilities || [],
    properties: data.properties || [],
    expenses: data.expenses || [],
    totalDeclaredExpenses: totalDeclaredFromDB,
    latestAssessment,
  };
}

interface BorrowingCapacityModalProps {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface IncomeBreakdownItem {
  id: string;
  label: string;
  grossAmount: number;
  shadingRate: number;
  shadedAmount: number;
  editable?: boolean;
  // Track source for sync-back
  sourceId?: string;
  sourceField?: string;
  sourceTable?: 'client_income_sources' | 'client_income';
}

interface LiabilityBreakdownItem {
  id: string;
  type: string;
  label: string;
  balance: number;
  limit?: number;
  monthlyServicing: number;
  calculationNote?: string;
  // Track source for sync-back
  sourceId?: string;
  sourceTable?: 'client_liabilities' | 'client_properties';
}

// Track which fields have been modified
interface PendingChanges {
  incomeSources: Map<string, { field: string; value: number; sourceId: string; sourceTable: string }>;
  liabilities: Map<string, { field: string; value: number; sourceId: string; sourceTable: string }>;
  expenses: { declaredTotal?: number; items: Map<string, { value: number; sourceId: string }> };
}

export function BorrowingCapacityModal({ 
  clientId, 
  open, 
  onOpenChange 
}: BorrowingCapacityModalProps) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { 
    quickCalculate, 
    isCalculating, 
    calculate, 
    assessmentHistory,
    isLoadingHistory,
  } = useBorrowingCapacity({ clientId, autoFetch: true });
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'calculator' | 'scenarios' | 'history'>('calculator');
  // Local state for inputs
  const [expenseMethod, setExpenseMethod] = useState<'hem' | 'declared' | 'hybrid'>('hybrid');
  const [declaredExpenses, setDeclaredExpenses] = useState(0);
  const [proposedLoanAmount, setProposedLoanAmount] = useState(500000);
  const [interestRate, setInterestRate] = useState(6.5);
  const [loanTermYears, setLoanTermYears] = useState(30);
  const [selectedLenderName, setSelectedLenderName] = useState<string | null>(null);
  const [result, setResult] = useState<FullAssessmentResult | null>(null);
  // Preserve the last true base-case calculation separately from any applied
  // what-if result. The scenario modeller must always compare selected levers
  // against this base snapshot, even after a scenario is applied to the
  // calculator panel.
  const [baseScenarioResult, setBaseScenarioResult] = useState<FullAssessmentResult | null>(null);
  const [baseScenarioInputs, setBaseScenarioInputs] = useState<BorrowingCapacityInput | null>(null);
  const [isLocalCalculating, setIsLocalCalculating] = useState(false);
  // Monotonic id for edge-function recalcs. Applying/reverting a scenario bumps
  // it so a base recalc already in-flight can't resolve later and clobber the
  // displayed scenario/base figure with a stale (divergent) value.
  const calcGenerationRef = useRef(0);
  const [showRateComparison, setShowRateComparison] = useState(false);
  // New mode states
  const [calculationMode, setCalculationMode] = useState<CalculationMode>('bank');
  const [dtiCapEnabled, setDtiCapEnabled] = useState(false);
  const [dtiCapLimit, setDtiCapLimit] = useState(DEFAULT_DTI_CAP);
  const [bufferEnabled, setBufferEnabled] = useState(true);
  
  // === LMI STATE ===
  const [lmiMode, setLmiMode] = useState<LmiMode>('none');
  const [lmiPropertyValue, setLmiPropertyValue] = useState(0);
  const [lmiDepositAmount, setLmiDepositAmount] = useState(0);
  const [lmiManualOverride, setLmiManualOverride] = useState<number | null>(null);
  const [isFirstHomeBuyer, setIsFirstHomeBuyer] = useState(false);
  const [lmiEstimate, setLmiEstimate] = useState<LmiEstimate | null>(null);
  
  // === PROPOSED RENTAL INCOME STATE ===
  const [proposedRentalIncome, setProposedRentalIncome] = useState<ProposedRentalIncomeData>({
    weeklyRent: 0,
    frequency: 'weekly',
    inputAmount: 0,
    shadingRate: 0.8,
    vacancyRate: 0,
    interestOnlyOffset: 0,
  });
  // === TWO-WAY SYNC STATE ===
  // Local overrides for income items (keyed by breakdown item id)
  const [incomeOverrides, setIncomeOverrides] = useState<Map<string, number>>(new Map());
  // Local overrides for liability items
  const [liabilityOverrides, setLiabilityOverrides] = useState<Map<string, { balance?: number; limit?: number }>>(new Map());
  // Track if there are unsaved changes
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSavingToProfile, setIsSavingToProfile] = useState(false);
  // Pending changes tracker for sync-back
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({
    incomeSources: new Map(),
    liabilities: new Map(),
    expenses: { items: new Map() },
  });
  
  // Scenario presets state — Phase K6: persisted to bc_scenarios table per client
  const {
    scenarios: persistedScenarios,
    setScenarios: setPersistedScenarios,
    saveScenario: persistScenario,
    deleteScenario: removePersistedScenario,
  } = useBcScenarios({ clientId, enabled: open });
  const [scenarioPresets, setScenarioPresetsLocal] = useState<ScenarioPreset[]>([]);

  // Sync persisted scenarios into local state whenever they reload from the server.
  useEffect(() => {
    setScenarioPresetsLocal(persistedScenarios);
  }, [persistedScenarios]);

  // Wrap setter so any UI mutation (save/delete/auto-base) is persisted.
  const setScenarioPresets = useCallback(
    (next: ScenarioPreset[] | ((prev: ScenarioPreset[]) => ScenarioPreset[])) => {
      setScenarioPresetsLocal((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: ScenarioPreset[]) => ScenarioPreset[])(prev) : next;
        // Diff to find adds and removes (by id)
        const prevIds = new Set(prev.map((p) => p.id));
        const nextIds = new Set(resolved.map((p) => p.id));
        // Newly added presets → persist
        resolved.forEach((p) => {
          if (!prevIds.has(p.id)) {
            // Don't await — optimistic; the hook reconciles ids via reload-on-mount
            persistScenario(p).then((saved) => {
              if (saved && saved.id !== p.id) {
                // Replace temp id with DB id in local state
                setScenarioPresetsLocal((cur) => cur.map((c) => (c.id === p.id ? saved : c)));
              }
            });
          }
        });
        // Removed presets → persist deletion (skip auto-base / temp ids)
        prev.forEach((p) => {
          if (!nextIds.has(p.id) && p.id !== 'base' && !p.id.startsWith('applied-')) {
            removePersistedScenario(p.id);
          }
        });
        return resolved;
      });
    },
    [persistScenario, removePersistedScenario]
  );

  // Active scenario overlay — when set, overrides calculator inputs (front-end only)
  const [activeScenario, setActiveScenario] = useState<ScenarioPreset | null>(null);

  // Computed buffer rate based on toggle
  const effectiveBufferRate = bufferEnabled ? 3.0 : 0;

  // Fetch client data using secure function with fallback
  const { data: clientData, refetch: refetchClientData } = useQuery({
    queryKey: ['borrowing-capacity-client-data', clientId],
    queryFn: () => fetchBorrowingCapacityData(clientId),
    enabled: open,
  });

  // Reset overrides when client data refreshes
  useEffect(() => {
    if (clientData) {
      setIncomeOverrides(new Map());
      setLiabilityOverrides(new Map());
      setHasUnsavedChanges(false);
      setPendingChanges({
        incomeSources: new Map(),
        liabilities: new Map(),
        expenses: { items: new Map() },
      });
    }
  }, [clientData]);

  // Process income breakdown - prefer new income sources, fall back to legacy
  const hasIncomeSources = (clientData?.incomeSources || []).length > 0;
  
  const incomeBreakdown: IncomeBreakdownItem[] = useMemo(() => {
    const items: IncomeBreakdownItem[] = hasIncomeSources
      ? (clientData?.incomeSources || []).flatMap((src: any) => {
          const result: IncomeBreakdownItem[] = [];
          const contactLabel = src.contact_type === 'primary' ? 'Primary' : 'Secondary';
          const effectiveShading = src.custom_shading_rate ?? src.default_shading_rate ?? 1.0;
          const sourceName = src.source_name || src.source_type || 'Income';

          const grossAnnual = incomeOverrides.has(`${src.id}-base`) 
            ? incomeOverrides.get(`${src.id}-base`)! 
            : (Number(src.gross_annual_amount) || 0);
          if (grossAnnual > 0 || incomeOverrides.has(`${src.id}-base`)) {
            result.push({
              id: `${src.id}-base`,
              label: `${contactLabel} ${sourceName}`,
              grossAmount: grossAnnual,
              shadingRate: effectiveShading,
              shadedAmount: grossAnnual * effectiveShading,
              editable: true,
              sourceId: src.id,
              sourceField: 'gross_annual_amount',
              sourceTable: 'client_income_sources',
            });
          }
          const subFields = [
            { key: 'bonus', label: 'Bonus', shading: 0.8, dbField: 'bonus' },
            { key: 'commission', label: 'Commission', shading: 0.8, dbField: 'commission' },
            { key: 'overtime_essential', label: 'Essential OT', shading: 1.0, dbField: 'overtime_essential' },
            { key: 'overtime_non_essential', label: 'Non-Essential OT', shading: 0.5, dbField: 'overtime_non_essential' },
            { key: 'allowance', label: 'Allowance', shading: 0.8, dbField: 'allowance' },
          ];
          for (const { key, label, shading, dbField } of subFields) {
            const overrideKey = `${src.id}-${key}`;
            const val = incomeOverrides.has(overrideKey)
              ? incomeOverrides.get(overrideKey)!
              : (Number(src[key]) || 0);
            if (val > 0 || incomeOverrides.has(overrideKey)) {
              result.push({
                id: overrideKey,
                label: `${contactLabel} ${label}`,
                grossAmount: val,
                shadingRate: shading,
                shadedAmount: val * shading,
                editable: true,
                sourceId: src.id,
                sourceField: dbField,
                sourceTable: 'client_income_sources',
              });
            }
          }
          return result;
        })
      : (clientData?.income || []).flatMap((inc: any) => {
          const result: IncomeBreakdownItem[] = [];
          const contactLabel = inc.contact_type === 'primary' ? 'Primary' : 'Secondary';
          const fields = [
            { key: 'salary', dbField: 'gross_salary', label: 'Base Salary', shading: 1.0, val: inc.gross_salary },
            { key: 'bonus', dbField: 'bonus', label: 'Bonus', shading: 0.8, val: inc.bonus },
            { key: 'commission', dbField: 'commission', label: 'Commission', shading: 0.8, val: inc.commission },
            { key: 'ot-essential', dbField: 'overtime_essential', label: 'Essential Overtime', shading: 1.0, val: inc.overtime_essential },
            { key: 'ot-non-essential', dbField: 'overtime_non_essential', label: 'Non-Essential Overtime', shading: 0.5, val: inc.overtime_non_essential },
            { key: 'allowance', dbField: 'allowance', label: 'Allowances', shading: 0.8, val: inc.allowance },
          ];
          for (const { key, dbField, label, shading, val } of fields) {
            const overrideKey = `${inc.id}-${key}`;
            const amount = incomeOverrides.has(overrideKey) ? incomeOverrides.get(overrideKey)! : (Number(val) || 0);
            if (amount > 0 || incomeOverrides.has(overrideKey)) {
              result.push({
                id: overrideKey,
                label: `${contactLabel} ${label}`,
                grossAmount: amount,
                shadingRate: shading,
                shadedAmount: amount * shading,
                editable: true,
                sourceId: inc.id,
                sourceField: dbField,
                sourceTable: 'client_income',
              });
            }
          }
          return result;
        });

    // Add POSITIVE property cash flows as income
    clientData?.properties.forEach(prop => {
      const propertyType = prop.property_type?.toLowerCase() || '';
      if (propertyType === 'rental') return;
      const netMonthlyCashflow = Number(prop.net_monthly_cashflow) || 0;
      if (netMonthlyCashflow > 0) {
        const annualPositiveCashflow = netMonthlyCashflow * 12;
        items.push({
          id: `prop-${prop.id}-cashflow`,
          label: `Positive Cash Flow: ${(prop.address || 'Property').slice(0, 25)}...`,
          grossAmount: annualPositiveCashflow,
          shadingRate: 0.8,
          shadedAmount: annualPositiveCashflow * 0.8,
          editable: false,
        });
      }
    });

    return items;
  }, [clientData, incomeOverrides, hasIncomeSources]);
  
  // Calculate NEGATIVE property cash flows
  const { negativePropertyCashFlows, totalNegativeCashFlows } = useMemo(() => {
    const flows: { address: string; monthlyCashflow: number }[] = [];
    let total = 0;
    clientData?.properties.forEach(prop => {
      const propertyType = prop.property_type?.toLowerCase() || '';
      if (propertyType === 'rental') return;
      const netMonthlyCashflow = Number(prop.net_monthly_cashflow) || 0;
      if (netMonthlyCashflow < 0) {
        const abs = Math.abs(netMonthlyCashflow);
        total += abs;
        flows.push({ address: (prop.address || 'Investment Property').slice(0, 40), monthlyCashflow: abs });
      }
    });
    return { negativePropertyCashFlows: flows, totalNegativeCashFlows: total };
  }, [clientData]);

  const totalGrossIncomeBase = incomeBreakdown.reduce((sum, item) => sum + item.grossAmount, 0);
  const totalShadedIncomeBase = incomeBreakdown.reduce((sum, item) => sum + item.shadedAmount, 0);

  // Compute proposed rental income net assessable amount
  const proposedRentalNetAssessable = useMemo(() => {
    const ri = proposedRentalIncome;
    if (!ri.inputAmount || ri.inputAmount <= 0) return 0;
    const freqMultiplier = ri.frequency === 'weekly' ? 52 : ri.frequency === 'monthly' ? 12 : 1;
    const grossAnnual = ri.inputAmount * freqMultiplier;
    const afterVacancy = grossAnnual * (1 - ri.vacancyRate / 100);
    const afterShading = afterVacancy * ri.shadingRate;
    const ioOffsetAnnual = ri.interestOnlyOffset * 12;
    return Math.max(0, afterShading - ioOffsetAnnual);
  }, [proposedRentalIncome]);

  // Include proposed rental income in totals sent to the engine
  const totalGrossIncome = totalGrossIncomeBase + (proposedRentalIncome.inputAmount > 0
    ? (proposedRentalIncome.inputAmount * (proposedRentalIncome.frequency === 'weekly' ? 52 : proposedRentalIncome.frequency === 'monthly' ? 12 : 1))
    : 0);
  const totalShadedIncome = totalShadedIncomeBase + proposedRentalNetAssessable;

  // Process liabilities breakdown with overrides — delegates to the shared
  // householdFinance engine so credit-card 3% / BNPL 5% / HECS / P&I fallbacks
  // stay in lockstep with FormaraPDFGenerator and the BC PDF sections.
  const liabilitiesBreakdown: LiabilityBreakdownItem[] = useMemo(() => {
    const items: LiabilityBreakdownItem[] = (clientData?.liabilities || []).map(lib => {
      const override = liabilityOverrides.get(lib.id);
      const s = computeLiabilityServicing(lib, {
        totalGrossAnnualIncome: totalGrossIncome,
        balanceOverride: override?.balance,
        limitOverride: override?.limit,
      });
      return {
        id: lib.id,
        type: lib.liability_type,
        label: lib.provider_name || lib.liability_type,
        balance: s.balance,
        limit: s.limit,
        monthlyServicing: s.monthlyServicing,
        calculationNote: s.calculationNote,
        sourceId: lib.id,
        sourceTable: 'client_liabilities' as const,
      };
    });

    clientData?.properties.forEach(prop => {
      const propertyType = prop.property_type?.toLowerCase() || '';
      if (propertyType === 'rental') {
        const monthlyRentPaid = Number(prop.monthly_rental_income) || 0;
        if (monthlyRentPaid > 0) {
          items.push({
            id: `prop-${prop.id}-rent-expense`,
            type: 'rent_expense',
            label: `Rent Expense: ${prop.address?.slice(0, 20)}...`,
            balance: 0,
            monthlyServicing: monthlyRentPaid,
            calculationNote: 'Rent paid as tenant',
          });
        }
      }
    });

    return items;
  }, [clientData, liabilityOverrides, totalGrossIncome]);

  const totalMonthlyCommitments = liabilitiesBreakdown.reduce(
    (sum, item) => sum + item.monthlyServicing, 
    0
  );

  const totalDebtBalances = useMemo(() => {
    const liabilityDebt = liabilitiesBreakdown.reduce((sum, item) => sum + (item.balance || 0), 0);
    const propertyDebt = (clientData?.properties || []).reduce(
      (sum: number, prop: any) => sum + (Number(prop.loan_remaining) || 0),
      0,
    );
    return liabilityDebt + propertyDebt;
  }, [liabilitiesBreakdown, clientData?.properties]);

  // Calculate HEM benchmark with breakdown.
  //
  // Audit item 9: this was its own household test — matching `de_facto` where
  // the database holds `Defacto`, and `married` where it also holds `Married`
  // — while the server ran a different list. The two answers were $2,940 and
  // $4,130 a month for the same client, which is the whole $74,924 gap between
  // the figure on the card and the figure on this screen. Both sides read the
  // same rule now.
  const dependents = Math.min(3, clientData?.client?.dependents_count || 0);
  const hemBreakdown: HemBreakdown = getHemBreakdown(
    clientData?.client?.marital_status ?? null,
    dependents,
    totalGrossIncome,
    clientData?.client?.secondary_first_name ?? null,
  );
  const hemBenchmark = hemBreakdown.finalHem;

  // Sync declared expenses from database when data loads
  useEffect(() => {
    if (clientData?.totalDeclaredExpenses !== undefined && clientData.totalDeclaredExpenses > 0) {
      setDeclaredExpenses(clientData.totalDeclaredExpenses);
    }
  }, [clientData?.totalDeclaredExpenses]);

  // Pre-populate calculator fields from the latest saved assessment
  useEffect(() => {
    const assessment = clientData?.latestAssessment;
    if (!assessment) return;

    // Restore loan parameters
    if (assessment.proposed_loan_amount != null && assessment.proposed_loan_amount > 0) {
      setProposedLoanAmount(assessment.proposed_loan_amount);
    }
    if (assessment.interest_rate_used != null && assessment.interest_rate_used > 0) {
      setInterestRate(assessment.interest_rate_used);
    }
    if (assessment.loan_term_years != null && assessment.loan_term_years > 0) {
      setLoanTermYears(assessment.loan_term_years);
    }
    if (assessment.buffer_rate != null) {
      setBufferEnabled(assessment.buffer_rate > 0);
    }
    if (assessment.expense_method) {
      const method = assessment.expense_method as 'hem' | 'declared' | 'hybrid';
      if (['hem', 'declared', 'hybrid'].includes(method)) {
        setExpenseMethod(method);
      }
    }

    // Restore advanced settings from assumptions JSON
    const assumptions = assessment.assumptions as Record<string, any> | null;
    if (assumptions) {
      if (assumptions.calculationMode) {
        setCalculationMode(assumptions.calculationMode as CalculationMode);
      }
      if (assumptions.dtiCapEnabled != null) {
        setDtiCapEnabled(!!assumptions.dtiCapEnabled);
      }
      if (assumptions.dtiCapLimit != null && assumptions.dtiCapLimit > 0) {
        setDtiCapLimit(assumptions.dtiCapLimit);
      }
      if (assumptions.selectedLenderName) {
        setSelectedLenderName(assumptions.selectedLenderName);
      }
      // Restore LMI settings
      if (assumptions.lmiMode) {
        setLmiMode(assumptions.lmiMode as LmiMode);
      }
      if (assumptions.lmiPropertyValue != null) {
        setLmiPropertyValue(assumptions.lmiPropertyValue);
      }
      if (assumptions.lmiDepositAmount != null) {
        setLmiDepositAmount(assumptions.lmiDepositAmount);
      }
      if (assumptions.isFirstHomeBuyer != null) {
        setIsFirstHomeBuyer(!!assumptions.isFirstHomeBuyer);
      }
      // Restore proposed rental income
      if (assumptions.proposedRentalIncome) {
        setProposedRentalIncome(assumptions.proposedRentalIncome);
      }
    }

    // Restore LMI amount from assessment columns
    if (assessment.lmi_amount != null && assessment.lmi_amount > 0) {
      setLmiManualOverride(assessment.lmi_amount);
    }
    if (assessment.property_value_estimate != null) {
      setLmiPropertyValue(assessment.property_value_estimate);
    }
    if (assessment.deposit_amount != null) {
      setLmiDepositAmount(assessment.deposit_amount);
    }
    if (assessment.lmi_mode && assessment.lmi_mode !== 'none') {
      setLmiMode(assessment.lmi_mode as LmiMode);
    }
  }, [clientData?.latestAssessment]);

  // Effective expenses
  const baseExpenses = expenseMethod === 'hem' 
    ? hemBenchmark 
    : expenseMethod === 'declared' 
      ? declaredExpenses 
      : Math.max(hemBenchmark, declaredExpenses);
  
  const effectiveExpenses = baseExpenses + totalNegativeCashFlows;

  // === TWO-WAY SYNC HANDLERS ===
  const handleIncomeChange = useCallback((id: string, value: number) => {
    setIncomeOverrides(prev => {
      const next = new Map(prev);
      next.set(id, value);
      return next;
    });
    setHasUnsavedChanges(true);
    
    // Track the change for sync-back
    // Find the source info from the breakdown
    const item = incomeBreakdown.find(i => i.id === id);
    if (item?.sourceId && item.sourceField && item.sourceTable) {
      setPendingChanges(prev => {
        const next = { ...prev, incomeSources: new Map(prev.incomeSources) };
        next.incomeSources.set(id, {
          field: item.sourceField!,
          value,
          sourceId: item.sourceId!,
          sourceTable: item.sourceTable!,
        });
        return next;
      });
    }
  }, [incomeBreakdown]);

  const handleLiabilityChange = useCallback((id: string, field: 'balance' | 'limit', value: number) => {
    setLiabilityOverrides(prev => {
      const next = new Map(prev);
      const existing = next.get(id) || {};
      next.set(id, { ...existing, [field]: value });
      return next;
    });
    setHasUnsavedChanges(true);
    
    // Track for sync-back (only for direct liabilities, not property loans)
    if (!id.startsWith('prop-')) {
      setPendingChanges(prev => {
        const next = { ...prev, liabilities: new Map(prev.liabilities) };
        const dbField = field === 'balance' ? 'current_balance' : 'credit_limit';
        next.liabilities.set(`${id}-${field}`, {
          field: dbField,
          value,
          sourceId: id,
          sourceTable: 'client_liabilities',
        });
        return next;
      });
    }
  }, []);

  // Save changes back to the client profile
  const handleSaveToProfile = useCallback(async () => {
    setIsSavingToProfile(true);
    try {
      const promises: Promise<any>[] = [];

      // Group income changes by sourceId to batch updates
      const incomeUpdates = new Map<string, Record<string, any>>();
      pendingChanges.incomeSources.forEach(({ field, value, sourceId, sourceTable }) => {
        if (!incomeUpdates.has(sourceId)) {
          incomeUpdates.set(sourceId, { table: sourceTable, fields: {} });
        }
        incomeUpdates.get(sourceId)!.fields[field] = value;
      });

      incomeUpdates.forEach((update, sourceId) => {
        promises.push(
          invokeSecureFunction('manage-client-data', {
            operation: 'update',
            table: update.table,
            clientId,
            recordId: sourceId,
            data: update.fields,
          })
        );
      });

      // Group liability changes by sourceId
      const liabilityUpdates = new Map<string, Record<string, any>>();
      pendingChanges.liabilities.forEach(({ field, value, sourceId }) => {
        if (!liabilityUpdates.has(sourceId)) {
          liabilityUpdates.set(sourceId, {});
        }
        liabilityUpdates.get(sourceId)![field] = value;
      });

      liabilityUpdates.forEach((fields, sourceId) => {
        promises.push(
          invokeSecureFunction('manage-client-data', {
            operation: 'update',
            table: 'client_liabilities',
            clientId,
            recordId: sourceId,
            data: fields,
          })
        );
      });

      const results = await Promise.all(promises);
      const errors = results.filter(r => r.error);
      
      if (errors.length > 0) {
        toast.error(`Some updates failed: ${errors[0].error.message}`);
      } else {
        toast.success('Changes saved to client profile');
        setHasUnsavedChanges(false);
        setPendingChanges({
          incomeSources: new Map(),
          liabilities: new Map(),
          expenses: { items: new Map() },
        });
        
        // Invalidate all related queries to sync other views
        queryClient.invalidateQueries({ queryKey: ['borrowing-capacity-client-data', clientId] });
        queryClient.invalidateQueries({ queryKey: ['client-data', clientId] });
        queryClient.invalidateQueries({ queryKey: ['get-client-data'] });
        // Refetch local data
        refetchClientData();
      }
    } catch (error: any) {
      toast.error(`Failed to save: ${error.message}`);
    } finally {
      setIsSavingToProfile(false);
    }
  }, [pendingChanges, clientId, queryClient, refetchClientData]);

  const baseCalculatorInputs = useMemo<BorrowingCapacityInput>(() => ({
    grossAnnualIncome: totalGrossIncome,
    shadedAnnualIncome: totalShadedIncome,
    monthlyLivingExpenses: effectiveExpenses,
    monthlyCommitments: totalMonthlyCommitments,
    interestRate,
    bufferRate: effectiveBufferRate,
    loanTermYears,
    totalDebtBalances,
    calculationMode,
    dtiCapEnabled,
    dtiCapLimit,
  }), [
    totalGrossIncome,
    totalShadedIncome,
    effectiveExpenses,
    totalMonthlyCommitments,
    interestRate,
    effectiveBufferRate,
    loanTermYears,
    totalDebtBalances,
    calculationMode,
    dtiCapEnabled,
    dtiCapLimit,
  ]);

  // When an active scenario is set, overlay the full adjusted input snapshot.
  const activeCalculatorInputs = activeScenario?.adjustedInputs;
  const effectiveGrossIncomeForCalc = activeCalculatorInputs?.grossAnnualIncome ?? baseCalculatorInputs.grossAnnualIncome;
  const effectiveShadedIncomeForCalc = activeCalculatorInputs?.shadedAnnualIncome ?? baseCalculatorInputs.shadedAnnualIncome;
  const effectiveExpensesForCalc = activeCalculatorInputs?.monthlyLivingExpenses ?? baseCalculatorInputs.monthlyLivingExpenses;
  const effectiveCommitmentsForCalc = activeCalculatorInputs?.monthlyCommitments ?? baseCalculatorInputs.monthlyCommitments;
  const effectiveInterestRateForCalc = activeCalculatorInputs?.interestRate ?? baseCalculatorInputs.interestRate;
  const effectiveBufferRateForCalc = activeCalculatorInputs?.bufferRate ?? baseCalculatorInputs.bufferRate;
  const effectiveLoanTermYearsForCalc = activeCalculatorInputs?.loanTermYears ?? baseCalculatorInputs.loanTermYears;
  const effectiveTotalDebtBalancesForCalc = activeCalculatorInputs?.totalDebtBalances ?? baseCalculatorInputs.totalDebtBalances;
  const effectiveCalculationModeForCalc = activeCalculatorInputs?.calculationMode ?? baseCalculatorInputs.calculationMode;
  const effectiveDtiCapEnabledForCalc = activeCalculatorInputs?.dtiCapEnabled ?? baseCalculatorInputs.dtiCapEnabled;
  const effectiveDtiCapLimitForCalc = activeCalculatorInputs?.dtiCapLimit ?? baseCalculatorInputs.dtiCapLimit;

  // Calculate borrowing capacity
  const handleCalculate = useCallback(async () => {
    const generation = ++calcGenerationRef.current;
    setIsLocalCalculating(true);
    try {
      const lmiOverrides = lmiMode !== 'none' && lmiEstimate ? {
        lmiAmount: lmiEstimate.lmiAmount,
        lmiMode,
        lmiPropertyValue,
        lmiDepositAmount,
        isFirstHomeBuyer,
      } : {};

      const calcResult = await quickCalculate({
        grossAnnualIncome: effectiveGrossIncomeForCalc,
        shadedAnnualIncome: effectiveShadedIncomeForCalc,
        livingExpenses: effectiveExpensesForCalc,
        existingCommitments: effectiveCommitmentsForCalc,
        interestRate: effectiveInterestRateForCalc,
        bufferRate: effectiveBufferRateForCalc,
        loanTermYears: effectiveLoanTermYearsForCalc,
        proposedLoanAmount,
        calculationMode: effectiveCalculationModeForCalc,
        dtiCapEnabled: effectiveDtiCapEnabledForCalc,
        dtiCapLimit: effectiveDtiCapLimitForCalc,
        totalDebtBalances: effectiveTotalDebtBalancesForCalc,
        selectedLenderName: selectedLenderName || undefined,
        ...lmiOverrides,
      });
      // Discard if a newer calc started or a scenario was applied/reverted while
      // this request was in flight — prevents a stale base result from
      // overwriting the figure the user should be seeing.
      if (generation !== calcGenerationRef.current) return;
      setResult(calcResult);
      if (!activeScenario) {
        setBaseScenarioResult(calcResult);
        setBaseScenarioInputs(baseCalculatorInputs);
      }
    } catch (error) {
      console.error('Calculation failed:', error);
    } finally {
      if (generation === calcGenerationRef.current) setIsLocalCalculating(false);
    }
  }, [quickCalculate, effectiveGrossIncomeForCalc, effectiveShadedIncomeForCalc, effectiveCommitmentsForCalc, effectiveExpensesForCalc, effectiveInterestRateForCalc, effectiveBufferRateForCalc, effectiveLoanTermYearsForCalc, effectiveTotalDebtBalancesForCalc, effectiveCalculationModeForCalc, effectiveDtiCapEnabledForCalc, effectiveDtiCapLimitForCalc, proposedLoanAmount, selectedLenderName, lmiMode, lmiEstimate, lmiPropertyValue, lmiDepositAmount, isFirstHomeBuyer, activeScenario, baseCalculatorInputs]);

  // Auto-calculate on mount and when key inputs change — but ONLY for the base
  // case. While a scenario is applied, the displayed capacity is the scenario's
  // own engine result (set by onApplyScenario and shown across the What-If UI).
  // Re-running the edge function here overwrote that with a divergent (lower)
  // figure the instant a scenario was applied, and prevented revert from
  // restoring the original base. The base case still recalculates so direct
  // calculator-input edits flow through.
  useEffect(() => {
    if (open && clientData && !activeScenario) {
      handleCalculate();
    }
  }, [open, clientData, effectiveExpensesForCalc, effectiveInterestRateForCalc, effectiveLoanTermYearsForCalc, effectiveCalculationModeForCalc, effectiveDtiCapEnabledForCalc, effectiveDtiCapLimitForCalc, selectedLenderName, effectiveBufferRateForCalc, incomeOverrides, liabilityOverrides, lmiMode, lmiEstimate, proposedRentalNetAssessable, activeScenario, handleCalculate]);

  const headerContent = (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <Calculator className="h-5 w-5 text-primary" />
        <span className="text-base sm:text-xl">Borrowing Capacity</span>
      </div>
      <div className="flex gap-2">
        {hasUnsavedChanges && (
          <Button 
            variant="outline"
            onClick={handleSaveToProfile}
            disabled={isSavingToProfile}
            size="sm"
            className="border-warning text-warning hover:bg-warning/10"
          >
            {isSavingToProfile ? (
              <Loader2 className="h-4 w-4 mr-1 sm:mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-1 sm:mr-2" />
            )}
            Sync to Profile
          </Button>
        )}
        <Button 
          variant="outline"
          onClick={() => {
            calculate({
              grossAnnualIncome: effectiveGrossIncomeForCalc,
              shadedAnnualIncome: effectiveShadedIncomeForCalc,
              livingExpenses: effectiveExpensesForCalc,
              existingCommitments: effectiveCommitmentsForCalc,
              interestRate: effectiveInterestRateForCalc,
              bufferRate: effectiveBufferRateForCalc,
              loanTermYears: effectiveLoanTermYearsForCalc,
              proposedLoanAmount,
              calculationMode: effectiveCalculationModeForCalc,
              dtiCapEnabled: effectiveDtiCapEnabledForCalc,
              dtiCapLimit: effectiveDtiCapLimitForCalc,
              totalDebtBalances: effectiveTotalDebtBalancesForCalc,
              selectedLenderName: selectedLenderName || undefined,
              ...(lmiMode !== 'none' && lmiEstimate ? {
                lmiAmount: lmiEstimate.lmiAmount,
                lmiMode,
                lmiPropertyValue,
                lmiDepositAmount,
                isFirstHomeBuyer,
              } : {}),
              ...(proposedRentalIncome.inputAmount > 0 && !activeScenario ? { proposedRentalIncome } : {}),
            });
            toast.success(activeScenario ? `Scenario "${activeScenario.name}" saved as the current assessment` : 'Assessment saved');
          }}
          disabled={isLocalCalculating || isCalculating || !result}
          size="sm"
        >
          <Save className="h-4 w-4 mr-1 sm:mr-2" />
          Save
        </Button>
        <Button 
          onClick={handleCalculate}
          disabled={isLocalCalculating || isCalculating}
          size="sm"
        >
          {isLocalCalculating || isCalculating ? (
            <Loader2 className="h-4 w-4 mr-1 sm:mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-1 sm:mr-2" />
          )}
          Recalculate
        </Button>
      </div>
    </div>
  );

  // Active scenario banner
  const scenarioBanner = activeScenario ? (
    <div className="mx-4 sm:mx-6 mt-2 p-2.5 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-between text-xs">
      <span className="text-primary font-medium flex items-center gap-1.5">
        <FlaskConical className="h-3.5 w-3.5" />
        Scenario Active: <strong>{activeScenario.name}</strong>
      </span>
      <Button
        variant="outline"
        size="sm"
        className="h-6 text-xs px-2"
        onClick={() => {
          // Invalidate any in-flight recalc so it can't land after we revert.
          calcGenerationRef.current++;
          setActiveScenario(null);
          // Revert to the TRUE base snapshot tracked live by handleCalculate
          // (baseScenarioInputs/Result) so the displayed figure returns to the
          // exact original base. The saved base preset is only a fallback — its
          // snapshot can be stale relative to the live calculator.
          const basePreset = scenarioPresets.find(p => p.isBase);
          const baseInputs = baseScenarioInputs ?? basePreset?.adjustedInputs ?? baseCalculatorInputs;
          setInterestRate(baseInputs.interestRate);
          setLoanTermYears(baseInputs.loanTermYears);
          setBufferEnabled((baseInputs.bufferRate ?? 0) > 0);
          setCalculationMode(baseInputs.calculationMode ?? 'bank');
          setDtiCapEnabled(!!baseInputs.dtiCapEnabled);
          setDtiCapLimit(baseInputs.dtiCapLimit ?? DEFAULT_DTI_CAP);
          const restoredResult = (baseScenarioResult ?? basePreset?.result ?? null) as FullAssessmentResult | null;
          if (restoredResult) {
            setResult(restoredResult);
            setBaseScenarioResult(restoredResult);
            setBaseScenarioInputs(baseInputs);
          }
          toast.info('Reverted to base case');
        }}
      >
        <RotateCcw className="h-3 w-3 mr-1" />
        Revert to Base
      </Button>
    </div>
  ) : null;

  // Unsaved changes banner
  const unsavedBanner = hasUnsavedChanges ? (
    <div className="mx-4 sm:mx-6 mt-2 p-2 rounded-lg bg-warning/10 border border-warning/30 flex items-center justify-between text-xs">
      <span className="text-warning font-medium">
        ⚡ You have unsaved changes. Click "Sync to Profile" to update client data.
      </span>
    </div>
  ) : null;

  // Shared input sections (to avoid duplication)
  const inputSections = (
    <>
      <IncomeSection
        incomeBreakdown={incomeBreakdown}
        totalGross={totalGrossIncome}
        totalShaded={totalShadedIncome}
        onIncomeChange={handleIncomeChange}
      />
      <ExpensesSection
        expenseMethod={expenseMethod}
        hemBenchmark={hemBenchmark}
        hemBreakdown={hemBreakdown}
        declaredExpenses={declaredExpenses}
        baseExpenses={baseExpenses}
        negativePropertyCashFlows={negativePropertyCashFlows}
        totalNegativeCashFlows={totalNegativeCashFlows}
        effectiveExpenses={effectiveExpenses}
        onMethodChange={setExpenseMethod}
        onDeclaredExpensesChange={setDeclaredExpenses}
      />
      <LiabilitiesSection
        liabilities={liabilitiesBreakdown}
        totalMonthlyCommitments={totalMonthlyCommitments}
        onLiabilityChange={handleLiabilityChange}
      />
      <ProposedLoanSection
        proposedLoanAmount={proposedLoanAmount}
        interestRate={interestRate}
        bufferRate={effectiveBufferRate}
        bufferEnabled={bufferEnabled}
        onBufferEnabledChange={setBufferEnabled}
        loanTermYears={loanTermYears}
        onProposedLoanChange={setProposedLoanAmount}
        onInterestRateChange={setInterestRate}
        onLoanTermChange={setLoanTermYears}
        proposedRentalIncome={proposedRentalIncome}
        onProposedRentalIncomeChange={setProposedRentalIncome}
      />

      {/* LMI Section */}
      <LmiSection
        propertyValue={lmiPropertyValue}
        depositAmount={lmiDepositAmount}
        loanAmount={result?.borrowingCapacity || proposedLoanAmount}
        lmiMode={lmiMode}
        lmiManualOverride={lmiManualOverride}
        isFirstHomeBuyer={isFirstHomeBuyer}
        onPropertyValueChange={setLmiPropertyValue}
        onDepositAmountChange={setLmiDepositAmount}
        onLmiModeChange={setLmiMode}
        onLmiManualOverrideChange={setLmiManualOverride}
        onFirstHomeBuyerChange={setIsFirstHomeBuyer}
        onLmiEstimateChange={setLmiEstimate}
      />

      {/* Bank Rate Selector - CDR Integration */}
      <div className="rounded-lg border p-4 bg-card">
        <h3 className="font-medium mb-3 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          Live Bank Rates (CDR)
        </h3>
        <BankRateSelector
          value={interestRate}
          onChange={(rate, lenderName) => {
            setInterestRate(rate);
            if (lenderName) setSelectedLenderName(lenderName);
          }}
          loanPurpose="INVESTMENT"
          repaymentType="PRINCIPAL_AND_INTEREST"
          onOpenComparison={() => setShowRateComparison(true)}
        />
        {selectedLenderName && (
          <p className="text-xs text-muted-foreground mt-2">
            Using rate from: {selectedLenderName}
          </p>
        )}
      </div>

      {/* Calculation Mode Controls */}
      <div className="rounded-lg border p-4 bg-card space-y-4">
        <h3 className="font-medium flex items-center gap-2">
          {calculationMode === 'conservative' ? (
            <ShieldAlert className="h-4 w-4 text-warning" />
          ) : (
            <Shield className="h-4 w-4 text-primary" />
          )}
          Calculation Mode
        </h3>
        
        {/* Conservative Mode Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor={`conservative-mode-${isMobile ? 'm' : 'd'}`} className="text-sm font-medium">
              Conservative Mode
            </Label>
            <p className="text-xs text-muted-foreground">
              Stricter assessment with surplus floors & DTI cap
            </p>
          </div>
          <Switch
            id={`conservative-mode-${isMobile ? 'm' : 'd'}`}
            checked={calculationMode === 'conservative'}
            onCheckedChange={(checked) => {
              setCalculationMode(checked ? 'conservative' : 'bank');
              if (checked) {
                setDtiCapEnabled(true);
                setDtiCapLimit(6);
              }
            }}
          />
        </div>

        <Separator />

        {/* DTI Cap Controls */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor={`dti-cap-${isMobile ? 'm' : 'd'}`} className="text-sm font-medium">
                Enforce DTI Cap
              </Label>
              <p className="text-xs text-muted-foreground">
                Limit capacity based on debt-to-income ratio
              </p>
            </div>
            <Switch
              id={`dti-cap-${isMobile ? 'm' : 'd'}`}
              checked={dtiCapEnabled || calculationMode === 'conservative'}
              onCheckedChange={setDtiCapEnabled}
              disabled={calculationMode === 'conservative'}
            />
          </div>
          
          {(dtiCapEnabled || calculationMode === 'conservative') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">DTI Limit</Label>
                <span className="text-sm font-medium">{dtiCapLimit}x</span>
              </div>
              <div className="flex gap-2">
                {[5, 6, 7, 8].map((cap) => (
                  <button
                    key={cap}
                    onClick={() => setDtiCapLimit(cap)}
                    disabled={calculationMode === 'conservative'}
                    className={`flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors min-h-[44px] touch-manipulation ${
                      dtiCapLimit === cap
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary hover:bg-secondary/80'
                    } ${calculationMode === 'conservative' ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {cap}x
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {calculationMode === 'conservative' 
                  ? 'Conservative mode enforces 6x DTI cap'
                  : `Capacity will be capped to maintain DTI ≤ ${dtiCapLimit}x`
                }
              </p>
            </div>
          )}
        </div>

        {/* Mode Description */}
        <div className={`p-3 rounded-lg text-xs ${
          calculationMode === 'conservative' 
            ? 'bg-warning/10 border border-warning/30 text-warning'
            : 'bg-primary/10 border border-primary/30 text-primary'
        }`}>
          {calculationMode === 'conservative' ? (
            <p>
              <strong>Conservative Mode:</strong> Uses minimum surplus floors ($1,000/mo), 
              residual income requirements, 85% surplus utilization, and hard 6x DTI cap. 
              Results align with stricter consumer-focused serviceability models.
            </p>
          ) : (
            <p>
              <strong>Bank Mode:</strong> Full serviceability calculation without artificial 
              constraints. Shows maximum theoretical lending capacity similar to major lender 
              assessments.
            </p>
          )}
        </div>
      </div>
    </>
  );

  const tabsContent = (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="px-4 sm:px-6 border-b">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="calculator" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Calculator className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Calculator
          </TabsTrigger>
          <TabsTrigger value="scenarios" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <FlaskConical className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            What-If
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            History
          </TabsTrigger>
        </TabsList>
      </div>

      {scenarioBanner}
      {unsavedBanner}

      <TabsContent value="calculator" className="flex-1 min-h-0 overflow-hidden m-0">
        {isMobile ? (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {inputSections}
              <ResultsPanel 
                result={result} 
                isCalculating={isLocalCalculating || isCalculating}
                calculationMode={calculationMode}
                dtiCapEnabled={dtiCapEnabled}
                dtiCapLimit={dtiCapLimit}
                clientId={clientId}
                clientName={clientData?.client ? `${clientData.client.primary_first_name || ''} ${clientData.client.primary_surname || ''}`.trim() : undefined}
                proposedLoanAmount={proposedLoanAmount}
                interestRate={interestRate}
                bufferRate={effectiveBufferRate}
                loanTermYears={loanTermYears}
                lmiMode={lmiMode}
                lmiEstimate={lmiEstimate}
                scenarioPresets={scenarioPresets}
                activeScenarioName={activeScenario?.name}
                accessibleEquity={activeScenario?.accessibleEquity ?? 0}
              />
            </div>
          </ScrollArea>
        ) : (
          <div className="flex flex-row flex-1 h-full min-h-0 overflow-hidden">
            <div className="w-1/2 min-h-0 border-r">
              <ScrollArea className="h-full">
                <div className="p-6 space-y-4">
                  {inputSections}
                </div>
              </ScrollArea>
            </div>
            <div className="w-1/2 min-h-0">
              <ScrollArea className="h-full">
                <div className="p-6">
                  <ResultsPanel 
                    result={result} 
                    isCalculating={isLocalCalculating || isCalculating}
                    calculationMode={calculationMode}
                    dtiCapEnabled={dtiCapEnabled}
                    dtiCapLimit={dtiCapLimit}
                    clientId={clientId}
                    clientName={clientData?.client ? `${clientData.client.primary_first_name || ''} ${clientData.client.primary_surname || ''}`.trim() : undefined}
                    proposedLoanAmount={proposedLoanAmount}
                    interestRate={interestRate}
                    bufferRate={effectiveBufferRate}
                    loanTermYears={loanTermYears}
                    lmiMode={lmiMode}
                    lmiEstimate={lmiEstimate}
                    scenarioPresets={scenarioPresets}
                    activeScenarioName={activeScenario?.name}
                    accessibleEquity={activeScenario?.accessibleEquity ?? 0}
                  />
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="scenarios" className="flex-1 min-h-0 overflow-hidden m-0">
        <ScrollArea className="h-full">
          <div className="p-4 sm:p-6">
            {result ? (
              <StrategyScenarioModeling
                clientId={clientId}
                clientName={clientData?.client ? `${clientData.client.primary_first_name || ''} ${clientData.client.primary_surname || ''}`.trim() : undefined}
                baseInputs={baseScenarioInputs ?? baseCalculatorInputs}
                baseResult={baseScenarioResult ?? result}
                liabilities={liabilitiesBreakdown.map(l => ({
                  id: l.id,
                  type: l.type,
                  label: l.label,
                  balance: l.balance,
                  limit: l.limit,
                  monthlyServicing: l.monthlyServicing,
                  calculationNote: l.calculationNote,
                }))}
                properties={(clientData?.properties || []).map((p: any) => ({
                  id: p.id,
                  address: p.address || '',
                  property_type: p.property_type || '',
                  current_value: Number(p.value) || Number(p.current_value) || 0,
                  loan_remaining: Number(p.loan_remaining) || 0,
                  monthly_interest_repayment: Number(p.monthly_interest_repayment) || 0,
                  loan_repayment_amount: Number(p.loan_repayment_amount) || 0,
                  net_monthly_cashflow: Number(p.net_monthly_cashflow) || 0,
                }))}
                /* Phase I1/I2 — typed income + HEM floor for lender-aware re-shading */
                incomeComponents={incomeBreakdown.map(it => ({
                  id: it.id,
                  label: it.label,
                  type: classifyIncomeLabel(it.label),
                  grossAnnual: it.grossAmount,
                  currentShadingRate: typeof it.shadingRate === 'number' ? it.shadingRate : 1,
                })).filter(c => c.grossAnnual > 0)}
                hemBenchmark={hemBenchmark}
                savedPresets={scenarioPresets}
                onPresetsChange={setScenarioPresets}
                onApplyScenario={(inputs, accessibleEquity, preset) => {
                  // Hardened apply path. Both the "Apply to Calculator" and "Save
                  // Scenario" buttons route through here; a thrown error or a
                  // partially-shaped result used to crash the calculator render
                  // ("jumps straight to error"). We now guard the whole flow and
                  // coerce every numeric the results UI reads with `.toFixed()` /
                  // arithmetic so the applied result is always a valid shape.
                  try {
                    if (!result) {
                      toast.error('Calculate borrowing capacity before applying a scenario.');
                      return;
                    }
                    if (!inputs) {
                      toast.error('Scenario inputs are unavailable — rebuild the scenario and try again.');
                      return;
                    }
                    const baseResultSnapshot = result;
                    const scenarioPreset: ScenarioPreset = preset || {
                      id: `applied-${Date.now()}`,
                      name: 'Applied Scenario',
                      isBase: false,
                      createdAt: new Date().toISOString(),
                      adjustedInputs: { ...inputs },
                      result: baseResultSnapshot,
                      accessibleEquity: accessibleEquity ?? 0,
                    };
                    const scenarioResult = (scenarioPreset.result ?? baseResultSnapshot) as Partial<FullAssessmentResult>;
                    const num = (value: unknown, fallback: number): number =>
                      typeof value === 'number' && Number.isFinite(value) ? value : fallback;
                    const appliedResult: FullAssessmentResult = {
                      ...baseResultSnapshot,
                      ...scenarioResult,
                      borrowingCapacity: num(scenarioResult.borrowingCapacity, num(baseResultSnapshot.borrowingCapacity, 0)),
                      monthlySurplus: num(scenarioResult.monthlySurplus, num(baseResultSnapshot.monthlySurplus, 0)),
                      dtiRatio: num(scenarioResult.dtiRatio, num(baseResultSnapshot.dtiRatio, 0)),
                      assessmentRate: num(
                        scenarioResult.assessmentRate,
                        num(baseResultSnapshot.assessmentRate, (inputs.interestRate ?? 6.5) + (inputs.bufferRate ?? 3)),
                      ),
                      serviceabilityBand: scenarioResult.serviceabilityBand ?? baseResultSnapshot.serviceabilityBand ?? 'red',
                      grossAnnualIncome: inputs.grossAnnualIncome,
                      shadedAnnualIncome: inputs.shadedAnnualIncome,
                      livingExpensesMonthly: inputs.monthlyLivingExpenses,
                      existingCommitmentsMonthly: inputs.monthlyCommitments,
                      interestRate: inputs.interestRate,
                      bufferRate: inputs.bufferRate,
                      loanTermYears: inputs.loanTermYears,
                      recommendations: Array.isArray(scenarioResult.recommendations)
                        ? scenarioResult.recommendations
                        : (baseResultSnapshot.recommendations ?? []),
                      warnings: Array.isArray(scenarioResult.warnings)
                        ? scenarioResult.warnings
                        : (baseResultSnapshot.warnings ?? []),
                      stressTestedCapacity: num(
                        scenarioResult.stressTestedCapacity,
                        num(baseResultSnapshot.stressTestedCapacity, num(scenarioResult.borrowingCapacity, 0)),
                      ),
                    };
                    // Invalidate any base recalc still in flight so it can't
                    // resolve afterwards and overwrite the scenario figure.
                    calcGenerationRef.current++;
                    // Applying the scenario does not start a replacement calc,
                    // so release the loading state owned by the invalidated one.
                    setIsLocalCalculating(false);
                    setActiveScenario({
                      ...scenarioPreset,
                      result: appliedResult,
                    });
                    setResult(appliedResult);
                    // Apply the full scenario control surface to calculator state;
                    // income/expense/commitment/debt overlays come from activeScenario.adjustedInputs.
                    setInterestRate(inputs.interestRate);
                    setLoanTermYears(inputs.loanTermYears);
                    setBufferEnabled((inputs.bufferRate ?? 0) > 0);
                    setCalculationMode(inputs.calculationMode ?? 'bank');
                    setDtiCapEnabled(!!inputs.dtiCapEnabled);
                    setDtiCapLimit(inputs.dtiCapLimit ?? DEFAULT_DTI_CAP);
                    // Switch to calculator tab to show the result
                    setActiveTab('calculator');
                    toast.success(`Scenario "${scenarioPreset.name}" applied to calculator`);
                  } catch (err: any) {
                    console.error('[BorrowingCapacityModal] Failed to apply scenario:', err);
                    toast.error(`Couldn't apply scenario: ${err?.message || 'unexpected error'}`);
                  }
                }}
              />
            ) : (
              <div className="text-center text-muted-foreground py-12">
                Calculate borrowing capacity first to model scenarios.
              </div>
            )}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="history" className="flex-1 min-h-0 overflow-hidden m-0">
        <ScrollArea className="h-full">
          <div className="p-4 sm:p-6">
            <CapacityHistoryChart 
              history={assessmentHistory || []} 
              isLoading={isLoadingHistory} 
            />
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );

  const bankRateModal = (
    <BankRateComparisonModal
      open={showRateComparison}
      onOpenChange={setShowRateComparison}
      onSelectRate={(rate, lenderName, productName) => {
        setInterestRate(rate);
        setSelectedLenderName(lenderName);
        toast.success(`Selected ${lenderName} rate: ${rate.toFixed(2)}%`);
      }}
      defaultLoanPurpose="INVESTMENT"
      defaultRepaymentType="PRINCIPAL_AND_INTEREST"
    />
  );

  // Mobile: full-screen Sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[95vh] p-0 flex flex-col rounded-t-xl">
          <SheetHeader className="p-4 pb-3 border-b flex-shrink-0">
            <SheetTitle className="sr-only">Borrowing Capacity Calculator</SheetTitle>
            {headerContent}
          </SheetHeader>
          <div className="flex-1 overflow-hidden flex flex-col">
            {tabsContent}
          </div>
          {bankRateModal}
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: standard dialog
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-[1600px] sm:max-w-[1600px] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b">
          <DialogTitle className="sr-only">Borrowing Capacity Calculator</DialogTitle>
          {headerContent}
        </DialogHeader>
        {tabsContent}
        {bankRateModal}
      </DialogContent>
    </Dialog>
  );
}
