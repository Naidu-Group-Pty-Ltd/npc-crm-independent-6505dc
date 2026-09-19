import { useState, useMemo, useCallback, useEffect } from 'react';
import { BCScenarioAgent, type AIScenario } from './BCScenarioAgent';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  FlaskConical,
  TrendingUp,
  TrendingDown,
  Minus,
  RotateCcw,
  CreditCard,
  ArrowRightLeft,
  Building2,
  Percent,
  ChevronDown,
  Zap,
  CheckCircle2,
  Save,
  FolderOpen,
  Trash2,
  FileDown,
  AlertTriangle,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  calculateAfterTaxIncome,
  formatCapacity,
  getServiceabilityBandColor,
  type BorrowingCapacityInput,
  type BorrowingCapacityResult,
} from '@/utils/borrowingCapacityCalculations';
import {
  runScenarioWithInputs,
  type ScenarioContext,
  type ScenarioProperty as EngineProperty,
  type ScenarioLiability as EngineLiability,
  type AcquisitionContext as EngineAcquisitionContext,
} from '@/utils/scenarioDeltaEngine';
import type { ScenarioDelta, AcquisitionCapacity, CapitalLedger, ScenarioValidationIssue } from '@/utils/borrowingCapacityTypes';
import type { AustralianState, PurchaseIntent, PropertyCategory } from '@/utils/stampDutyCalculator';
import {
  estimateLMI,
  calculateLVR,
} from '@/utils/lmiCalculations';
import {
  AdditionalStrategyLevers,
  DEFAULT_ADDITIONAL_STRATEGY,
  type AdditionalStrategyState,
} from './AdditionalStrategyLevers';
import { BindingConstraintBadge } from '../BindingConstraintBadge';
import { computeBindingConstraint } from '@/utils/bindingConstraint';
import { PurchasePowerHeadline, type LeverAttribution } from './PurchasePowerHeadline';
import { StrategyRationalePanel } from './StrategyRationalePanel';
import { SnapshotDownloadButton } from '../SnapshotDownloadButton';
import { buildStrategyRationale } from '@/utils/strategyRationaleEngine';
import { CapacityMathInspector } from './CapacityMathInspector';
import { CapitalFlowCanvas, type CapitalAllocation } from './CapitalFlowCanvas';
import { SolutionOptionCards } from './SolutionOptionCards';
import type { SolutionApply } from '@/utils/scenarioDeltaEngine';
import { fetchAndGenerateBorrowingCapacityPDF } from '../BorrowingCapacityPDFReport';
import { toast } from 'sonner';
import {
  buildPersistedBcScenarioV2,
  computeScenarioDrift,
  type PersistedBcScenarioV2,
} from '@/utils/bcScenarioReplay';

// ── Types ──────────────────────────────────────────────

const PAYOFF_ALLOCATION_PREFIX = 'liability_payoff_';

export interface LiabilityItem {
  id: string;
  type: string;
  label: string;
  balance: number;
  limit?: number;
  monthlyServicing: number;
  calculationNote?: string;
}

export interface PropertyItem {
  id: string;
  address: string;
  property_type: string;
  current_value: number;
  loan_remaining: number;
  monthly_interest_repayment: number;
  loan_repayment_amount?: number;
  net_monthly_cashflow?: number;
  /** Phase F1 — per-property contracted rate (% p.a.) */
  interest_rate?: number;
}

interface StrategyState {
  consolidatedLiabilities: Set<string>;
  refinancedToIO: Set<string>;
  /** Phase 3 — per-property manual $/mo override on refinanced loan (undefined = auto IO) */
  refinanceManualRepayments: Map<string, number>;
  /** Phase 3 — per-property informational IO period (3/5/10yr) */
  refinanceIoPeriodYears: Map<string, number>;
  equityReleaseEnabled: boolean;
  equityReleasePropertyIds: Set<string>;
  equityReleaseTargetLVRs: Map<string, number>; // per-property target LVR
  /** Phase 2 — per-property deployment % of gross release (0..1, default 1.0) */
  equityReleaseDeploymentPercents: Map<string, number>;
  /** Phase 2 — per-property repayment structure on the new slice */
  equityReleaseRepaymentTypes: Map<string, 'interest_only' | 'principal_and_interest'>;
  /** Phase 2 — per-property manual $/mo override on the new slice (undefined = auto) */
  equityReleaseManualRepayments: Map<string, number>;
  rateAdjustment: number;
  /** Phase F1 — per-property contracted-rate overrides (propertyId → new rate %) */
  propertyRateOverrides: Map<string, number>;
  additional: AdditionalStrategyState;
}

/** Phase C: Acquisition context driving stamp duty + LMI math.
 *  Defaults to a NSW investor purchase of an established dwelling. */
export interface AcquisitionState {
  enabled: boolean;
  state: AustralianState;
  intent: PurchaseIntent;
  category: PropertyCategory;
  isFirstHomeBuyer: boolean;
  isForeignBuyer: boolean;
  lmiMode: 'none' | 'display_deduction' | 'debt_capitalised';
  cashOnHand: number;
  /** Phase F2 — target purchase price the strategy is solving for (0 = no target). */
  targetPurchasePrice: number;
}

const DEFAULT_EQUITY_LVR = 0.80;

const DEFAULT_STRATEGY: StrategyState = {
  consolidatedLiabilities: new Set(),
  refinancedToIO: new Set(),
  refinanceManualRepayments: new Map(),
  refinanceIoPeriodYears: new Map(),
  equityReleaseEnabled: false,
  equityReleasePropertyIds: new Set(),
  equityReleaseTargetLVRs: new Map(),
  equityReleaseDeploymentPercents: new Map(),
  equityReleaseRepaymentTypes: new Map(),
  equityReleaseManualRepayments: new Map(),
  rateAdjustment: 0,
  propertyRateOverrides: new Map(),
  additional: { ...DEFAULT_ADDITIONAL_STRATEGY },
};

const DEFAULT_ACQUISITION: AcquisitionState = {
  enabled: false,
  state: 'NSW',
  intent: 'investor',
  category: 'established',
  isFirstHomeBuyer: false,
  isForeignBuyer: false,
  lmiMode: 'display_deduction',
  cashOnHand: 0,
  targetPurchasePrice: 0,
};

// ── Scenario Preset Types ──────────────────────────────

export interface ScenarioPreset {
  id: string;
  name: string;
  isBase: boolean; // true = auto-saved base, cannot be deleted
  createdAt: string;
  adjustedInputs: BorrowingCapacityInput;
  result: BorrowingCapacityResult;
  /** Accessible equity from equity release lever (informational capital, not serviceability) */
  accessibleEquity?: number;
  /** Phase D: Acquisition Capacity snapshot (max purchase price + costs) for PDF / persistence */
  acquisitionCapacity?: AcquisitionCapacity | null;
  /** Phase I (parity) — typed income components captured at save time so a
   *  re-load can re-apply lender-aware shading deterministically. */
  incomeComponents?: import('@/utils/lenderShadingProfiles').ScenarioIncomeComponent[];
  /** Phase I (parity) — lender profile id used when this preset was saved. */
  currentLenderProfileId?: string;
  /** Phase I (parity) — HEM benchmark used at save time. */
  hemBenchmark?: number;
  /** Replayable deltas that produced this preset. */
  scenarioDeltas?: ScenarioDelta[];
  /** Engine validation/audit issues captured when the preset was saved. */
  validationIssues?: ScenarioValidationIssue[];
  /** Capital source/use ledger captured when the preset was saved. */
  capitalLedger?: CapitalLedger | null;
  /** Explicit capital allocations used to route sources into funded uses. */
  capitalAllocations?: CapitalAllocation[];
  /** Acquisition controls/context captured when this scenario was saved. */
  acquisition?: AcquisitionState;
  /** Phase 3 — replayable/auditable scenario payload with base snapshot hashes. */
  replayAudit?: PersistedBcScenarioV2;
}

interface StrategyScenarioModelingProps {
  baseInputs: BorrowingCapacityInput;
  baseResult: BorrowingCapacityResult;
  liabilities: LiabilityItem[];
  properties: PropertyItem[];
  onApplyScenario?: (inputs: BorrowingCapacityInput, accessibleEquity?: number, preset?: ScenarioPreset) => void;
  savedPresets?: ScenarioPreset[];
  onPresetsChange?: (presets: ScenarioPreset[]) => void;
  /** Optional client identifier — propagated to BCScenarioAgent so chat history persists per client. */
  clientId?: string;
  /** Optional client display name — used in PDF exports (F6 Finance Hand-off). */
  clientName?: string;
  /** Phase I1 — typed income components for lender-aware re-shading. */
  incomeComponents?: import('@/utils/lenderShadingProfiles').ScenarioIncomeComponent[];
  /** Phase I1 — current lender profile id (defaults to bank_standard). */
  currentLenderProfileId?: string;
  /** Phase I2 — monthly HEM benchmark; engine floors expenses here. */
  hemBenchmark?: number;
}

// ── Helpers ────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function calculateIORepayment(loanBalance: number, annualRate: number): number {
  return (loanBalance * (annualRate / 100)) / 12;
}

function calculatePIRepayment(loanBalance: number, annualRate: number, termYears: number): number {
  const monthlyRate = annualRate / 100 / 12;
  const periods = termYears * 12;
  if (monthlyRate === 0) return loanBalance / periods;
  return loanBalance * (monthlyRate * Math.pow(1 + monthlyRate, periods)) /
    (Math.pow(1 + monthlyRate, periods) - 1);
}

// ── Component ──────────────────────────────────────────

export function StrategyScenarioModeling({
  baseInputs,
  baseResult,
  liabilities,
  properties,
  onApplyScenario,
  savedPresets: externalPresets = [],
  onPresetsChange,
  clientId,
  clientName,
  incomeComponents,
  currentLenderProfileId,
  hemBenchmark,
}: StrategyScenarioModelingProps) {
  const [strategy, setStrategy] = useState<StrategyState>(DEFAULT_STRATEGY);
  const [acquisition, setAcquisition] = useState<AcquisitionState>(DEFAULT_ACQUISITION);
  const [capitalAllocations, setCapitalAllocations] = useState<CapitalAllocation[]>([]);

  // Audit-fix #5 — Auto-route net sale proceeds into the Capital Flow Canvas
  // when the broker toggles a Sell-to-Buy lever. The user can still re-route
  // or delete the auto-allocation; we only insert / update / clear our own
  // `sale_proceeds_<propId>` rows so manual allocations are never clobbered.
  // Agent fee default 2% mirrors the Sell summary on page 7 of the audit doc.
  useEffect(() => {
    const SELL_PREFIX = 'sale_proceeds_';
    const sellIds = strategy.additional.portfolioSellPropertyIds;
    const desired = new Map<string, number>();
    sellIds.forEach(propId => {
      const prop = properties.find(p => p.id === propId);
      if (!prop) return;
      const value = prop.current_value || 0;
      const loan = prop.loan_remaining || 0;
      const agentFee = value * 0.02;
      const net = Math.max(0, Math.round(value - loan - agentFee));
      if (net > 0) desired.set(`${SELL_PREFIX}${propId}`, net);
    });

    setCapitalAllocations(prev => {
      // Keep manual rows untouched
      const manual = prev.filter(a => !a.id.startsWith(SELL_PREFIX));
      // Preserve any user edits (sinkType/target) to existing auto rows
      const existingAutoById = new Map(
        prev.filter(a => a.id.startsWith(SELL_PREFIX)).map(a => [a.id, a]),
      );
      const auto: CapitalAllocation[] = [];
      desired.forEach((amount, id) => {
        const existing = existingAutoById.get(id);
        auto.push(existing
          ? { ...existing, amount }
          : { id, amount, sinkType: 'acquisition_deposit' });
      });
      // No-op when nothing actually changed (avoid render loops)
      const next = [...manual, ...auto];
      if (
        next.length === prev.length &&
        next.every((a, i) => {
          const p = prev[i];
          return p && p.id === a.id && p.amount === a.amount && p.sinkType === a.sinkType && p.sinkTargetId === a.sinkTargetId;
        })
      ) return prev;
      return next;
    });
  }, [strategy.additional.portfolioSellPropertyIds, properties]);

  const [presets, setPresets] = useState<ScenarioPreset[]>(externalPresets);
  const [scenarioName, setScenarioName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);

  useEffect(() => {
    setPresets(externalPresets);
  }, [externalPresets]);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    consolidation: true,
    refinance: true,
    equity: false,
    rates: false,
    incomeGrowth: false,
    expenseReduction: false,
    loanTerm: false,
    dtiCap: false,
    portfolioPlay: false,
    valuationUplift: false,
    crossCollatPool: false,
    acquisition: false,
  });

  // Auto-save base preset on first render
  useEffect(() => {
    if (presets.length === 0) {
      const basePreset: ScenarioPreset = {
        id: 'base',
        name: 'Base (Original)',
        isBase: true,
        createdAt: new Date().toISOString(),
        adjustedInputs: { ...baseInputs },
        result: baseResult,
        accessibleEquity: 0,
      };
      const updated = [basePreset];
      setPresets(updated);
      onPresetsChange?.(updated);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSection = (key: string) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const consolidatableDebts = useMemo(() =>
    liabilities.filter(l =>
      !l.id.startsWith('prop-') &&
      l.type !== 'home_loan' &&
      l.type !== 'investment_loan' &&
      l.type !== 'rent_expense'
    ), [liabilities]);

  const investmentProperties = useMemo(() =>
    properties.filter(p =>
      p.property_type !== 'rental' &&
      p.property_type !== 'owner_occupied' &&
      p.loan_remaining > 0
    ), [properties]);

  // Phase 4 — selected debt payoffs are no longer free-form calculator
  // adjustments. They must be funded from explicit capital sources (cash,
  // equity release, sale proceeds, etc.) through the Capital Flow Canvas.
  // This keeps servicing gains, DTI debt reduction and capital feasibility in
  // one auditable ledger, and lets the scenario engine block underfunded
  // payoff plans instead of silently removing debt commitments.
  useEffect(() => {
    const selectedIds = strategy.consolidatedLiabilities;

    setCapitalAllocations(prev => {
      const manualAllocations = prev.filter(alloc => !alloc.id.startsWith(PAYOFF_ALLOCATION_PREFIX));
      const existingPayoffAllocations = new Map(
        prev
          .filter(alloc => alloc.id.startsWith(PAYOFF_ALLOCATION_PREFIX))
          .map(alloc => [alloc.id, alloc]),
      );

      const payoffAllocations = Array.from(selectedIds)
        .map(id => consolidatableDebts.find(debt => debt.id === id))
        .filter((debt): debt is LiabilityItem => Boolean(debt))
        .map(debt => {
          const allocId = `${PAYOFF_ALLOCATION_PREFIX}${debt.id}`;
          const existing = existingPayoffAllocations.get(allocId);
          return {
            ...existing,
            id: allocId,
            amount: debt.balance,
            sinkType: 'liability_payoff' as const,
            sinkTargetId: debt.id,
          };
        });

      const next = [...manualAllocations, ...payoffAllocations];
      const same = next.length === prev.length && next.every((alloc, index) => {
        const old = prev[index];
        return old &&
          old.id === alloc.id &&
          old.amount === alloc.amount &&
          old.sinkType === alloc.sinkType &&
          old.sinkTargetId === alloc.sinkTargetId &&
          old.offsetRatePoints === alloc.offsetRatePoints &&
          old.rateBuydownPoints === alloc.rateBuydownPoints &&
          old.repaymentReductionMonthly === alloc.repaymentReductionMonthly;
      });

      return same ? prev : next;
    });
  }, [consolidatableDebts, strategy.consolidatedLiabilities]);

  // Rental records represent tenant commitments, not client-owned securities.
  const equityReleaseProperties = useMemo(() =>
    properties.filter(p =>
      p.property_type?.toLowerCase() !== 'rental' && p.current_value > 0
    ), [properties]);

  // ── Compute scenario result ──

  // ── Compute scenario via UNIFIED engine (Phase B) ──
  // The Strategy Builder no longer does its own math — it converts the user's
  // selections into ScenarioDelta[] and delegates to the same engine that the
  // edge function uses. This eliminates client/server drift entirely.

  // ── Reactivity signature ─────────────────────────────────────────────
  // The heavy useMemo below depends on `strategy` and `acquisition`, but those
  // contain nested Maps and Sets. React only re-runs the memo when the OUTER
  // state object identity changes — which works correctly because every
  // setter does `setStrategy(prev => ({...prev, ...}))`. To make the
  // reactivity bullet-proof against any future setter that forgets to clone,
  // we serialize all nested Map/Set keys + values into a stable signature
  // string and add it as an explicit dep. This guarantees the scenario
  // engine re-runs on EVERY lever change, no matter how deeply nested.
  const strategySignature = useMemo(() => {
    const setSig = (s: Set<string>) => Array.from(s).sort().join(',');
    const mapSig = (m: Map<string, unknown>) =>
      Array.from(m.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('|');
    const a = strategy.additional;
    return [
      setSig(strategy.consolidatedLiabilities),
      setSig(strategy.refinancedToIO),
      mapSig(strategy.refinanceManualRepayments),
      mapSig(strategy.refinanceIoPeriodYears),
      strategy.equityReleaseEnabled ? '1' : '0',
      setSig(strategy.equityReleasePropertyIds),
      mapSig(strategy.equityReleaseTargetLVRs),
      mapSig(strategy.equityReleaseDeploymentPercents),
      mapSig(strategy.equityReleaseRepaymentTypes as Map<string, unknown>),
      mapSig(strategy.equityReleaseManualRepayments),
      String(strategy.rateAdjustment),
      mapSig(strategy.propertyRateOverrides),
      // Additional levers — every nested field that the engine consumes
      String(a.incomeGrowthPercent),
      String(a.expenseReductionPercent),
      String(a.loanTermAdjustment),
      a.dtiCapEnabled ? `dti:${a.dtiCapValue}` : 'dti:off',
      setSig(a.portfolioSellPropertyIds),
      a.portfolioSellReinvest ? '1' : '0',
      mapSig(a.valuationOverrides as Map<string, unknown>),
      a.crossCollatPool.enabled
        ? `pool:${(a.crossCollatPool.blendedTargetLVR).toFixed(4)}:${a.crossCollatPool.lenderMaxLVR}:${a.crossCollatPool.allocationStrategy}:${setSig(a.crossCollatPool.propertyIds)}`
        : 'pool:off',
    ].join('||');
  }, [strategy]);

  const acquisitionSignature = useMemo(() => {
    if (!acquisition.enabled) return 'acq:off';
    return [
      'acq:on',
      acquisition.state,
      acquisition.intent,
      acquisition.category,
      acquisition.isFirstHomeBuyer ? '1' : '0',
      acquisition.isForeignBuyer ? '1' : '0',
      acquisition.lmiMode,
      String(acquisition.cashOnHand),
      String(acquisition.targetPurchasePrice),
    ].join('|');
  }, [acquisition]);

  const capitalAllocationsSignature = useMemo(
    () => capitalAllocations.map(a => `${a.id}:${a.amount}:${a.sinkType}:${a.sinkTargetId || ''}:${a.offsetRatePoints || ''}:${a.rateBuydownPoints || ''}:${a.repaymentReductionMonthly || ''}`).join('||'),
    [capitalAllocations],
  );

  const { scenarioContext, scenarioResult, scenarioInputs, impactBreakdown, acquisitionCapacity, validationIssues, leverAttribution, appliedDeltas, capitalLedger, baseTheoreticalCapacity, scenarioTheoreticalCapacity, baseRawSurplus, scenarioRawSurplus, floorActive, baseAfterTaxIncome, baseLivingExpenses, baseCommitments, baseAssessmentRate, baseTerm, baseAnnuity, scenarioAfterTaxIncome, scenarioLivingExpenses, scenarioCommitments, scenarioAssessmentRate, scenarioTerm, scenarioAnnuity } = useMemo(() => {
    const deltas: ScenarioDelta[] = [];
    const impacts: { label: string; monthlySaving: number; type: 'saving' | 'cost' | 'info' }[] = [];
    /** F4 — short cash-flow side-notes per delta id, used to enrich the
     *  per-lever waterfall row (e.g. "+$420/mo servicing saving"). */
    const leverCashflowNotes = new Map<string, string>();

    // 1. Debt Consolidation → funded capital_allocation rows.
    // Phase 4 deliberately does NOT emit direct liability_payoff deltas from
    // the UI: a debt can only disappear once the capital ledger finds a real
    // source to fund that payoff allocation.
    let consolidationSaving = 0;
    strategy.consolidatedLiabilities.forEach(id => {
      const liability = consolidatableDebts.find(l => l.id === id);
      if (liability) {
        consolidationSaving += liability.monthlyServicing;
        leverCashflowNotes.set(`capital_allocation-${PAYOFF_ALLOCATION_PREFIX}${liability.id}`, `+${formatCurrency(liability.monthlyServicing)}/mo if funded`);
      }
    });
    if (consolidationSaving > 0) {
      impacts.push({
        label: `Fund payoff for ${strategy.consolidatedLiabilities.size} debt(s)`,
        monthlySaving: consolidationSaving,
        type: 'info',
      });
    }

    // 2. Refinance P&I → IO → property_refinance deltas (Phase 3 — granular)
    let refinanceSaving = 0;
    strategy.refinancedToIO.forEach(propId => {
      const prop = investmentProperties.find(p => p.id === propId);
      if (prop) {
        const currentRepayment = prop.monthly_interest_repayment ||
          calculatePIRepayment(prop.loan_remaining, baseInputs.interestRate, baseInputs.loanTermYears);
        const autoIo = calculateIORepayment(prop.loan_remaining, baseInputs.interestRate);
        const manualRepayment = strategy.refinanceManualRepayments.get(propId);
        const ioPeriodYears = strategy.refinanceIoPeriodYears.get(propId);
        const newRepayment = Number.isFinite(manualRepayment as number) && (manualRepayment as number) >= 0
          ? (manualRepayment as number)
          : autoIo;
        const saving = Math.max(0, currentRepayment - newRepayment);
        if (saving > 0) refinanceSaving += saving;
        deltas.push({
          id: prop.id,
          label: `Refinance ${prop.address?.slice(0, 25) || 'property'} to IO${Number.isFinite(ioPeriodYears as number) && (ioPeriodYears as number) > 0 ? ` (${ioPeriodYears}yr IO)` : ''}`,
          type: 'property_refinance',
          value: 0,
          unit: 'absolute',
          meta: {
            ...(Number.isFinite(manualRepayment as number) ? { manualRepayment } : {}),
            ...(Number.isFinite(ioPeriodYears as number) && (ioPeriodYears as number) > 0 ? { ioPeriodYears } : {}),
          },
        });
        if (saving > 0) leverCashflowNotes.set(`property_refinance-${prop.id}`, `+${formatCurrency(saving)}/mo`);
      }
    });
    if (refinanceSaving > 0) {
      impacts.push({ label: `Refinance ${strategy.refinancedToIO.size} loan(s) to IO`, monthlySaving: refinanceSaving, type: 'saving' });
    }

    // 3. Portfolio Sell → property_sell deltas
    let portfolioSellSaving = 0;
    strategy.additional.portfolioSellPropertyIds.forEach(propId => {
      const soldProp = properties.find(p => p.id === propId);
      if (soldProp) {
        const loanServicing = soldProp.loan_repayment_amount || soldProp.monthly_interest_repayment || 0;
        if (loanServicing > 0) portfolioSellSaving += loanServicing;
        deltas.push({
          id: soldProp.id,
          label: `Sell ${soldProp.address?.slice(0, 30) || 'property'}`,
          type: 'property_sell',
          value: soldProp.current_value || 0,
          unit: 'absolute',
        });
      }
    });
    if (portfolioSellSaving > 0) {
      impacts.push({ label: `Sell ${strategy.additional.portfolioSellPropertyIds.size} property(s)`, monthlySaving: portfolioSellSaving, type: 'saving' });
    }

    // 4. Income Growth → income_change percent
    if (strategy.additional.incomeGrowthPercent !== 0) {
      deltas.push({
        id: `income-growth-${strategy.additional.incomeGrowthPercent}`,
        label: `Income ${strategy.additional.incomeGrowthPercent > 0 ? '+' : ''}${strategy.additional.incomeGrowthPercent}%`,
        type: 'income_change',
        value: strategy.additional.incomeGrowthPercent,
        unit: 'percent',
      });
      const incomeDelta = baseInputs.grossAnnualIncome * (strategy.additional.incomeGrowthPercent / 100);
      impacts.push({
        label: `Income ${strategy.additional.incomeGrowthPercent > 0 ? 'growth' : 'reduction'} (${strategy.additional.incomeGrowthPercent > 0 ? '+' : ''}${strategy.additional.incomeGrowthPercent}%)`,
        monthlySaving: Math.abs(incomeDelta / 12),
        type: strategy.additional.incomeGrowthPercent > 0 ? 'saving' : 'cost',
      });
    }

    // 5. Expense Reduction → expense_change percent (negative)
    if (strategy.additional.expenseReductionPercent > 0) {
      deltas.push({
        id: `expense-${strategy.additional.expenseReductionPercent}`,
        label: `Reduce expenses ${strategy.additional.expenseReductionPercent}%`,
        type: 'expense_change',
        value: -strategy.additional.expenseReductionPercent,
        unit: 'percent',
      });
      impacts.push({
        label: `Reduce expenses by ${strategy.additional.expenseReductionPercent}%`,
        monthlySaving: baseInputs.monthlyLivingExpenses * (strategy.additional.expenseReductionPercent / 100),
        type: 'saving',
      });
    }

    // 6. Loan Term Adjustment → loan_term_change
    if (strategy.additional.loanTermAdjustment !== 0) {
      deltas.push({
        id: `loan-term-${strategy.additional.loanTermAdjustment}`,
        label: `Loan term ${strategy.additional.loanTermAdjustment > 0 ? '+' : ''}${strategy.additional.loanTermAdjustment}yr`,
        type: 'loan_term_change',
        value: strategy.additional.loanTermAdjustment,
        unit: 'years',
      });
      impacts.push({
        label: `Loan term ${strategy.additional.loanTermAdjustment > 0 ? 'extended' : 'shortened'} to ${baseInputs.loanTermYears + strategy.additional.loanTermAdjustment}yr`,
        monthlySaving: 0,
        type: 'info',
      });
    }

    // 7. Rate Adjustment → rate_change
    if (strategy.rateAdjustment !== 0) {
      deltas.push({
        id: `rate-${strategy.rateAdjustment}`,
        label: `Rates ${strategy.rateAdjustment >= 0 ? '+' : ''}${strategy.rateAdjustment}%`,
        type: 'rate_change',
        value: strategy.rateAdjustment,
        unit: 'rate_points',
      });
    }

    // 7b. Equity Release → equity_release deltas (Phase F2 — wire releases into engine)
    let equityReleaseMonthlyCost = 0;
    if (strategy.equityReleaseEnabled && strategy.equityReleasePropertyIds.size > 0) {
      strategy.equityReleasePropertyIds.forEach(propId => {
        const prop = equityReleaseProperties.find(p => p.id === propId);
        if (!prop) return;
        const targetLVR = strategy.equityReleaseTargetLVRs.get(propId) ?? DEFAULT_EQUITY_LVR;
        // Phase 2 — granular controls
        const deploymentPercent = strategy.equityReleaseDeploymentPercents.get(propId) ?? 1;
        const repaymentType = strategy.equityReleaseRepaymentTypes.get(propId) ?? 'interest_only';
        const manualRepayment = strategy.equityReleaseManualRepayments.get(propId);
        deltas.push({
          id: prop.id,
          label: `Equity release ${prop.address?.slice(0, 25) || 'property'} → ${(targetLVR * 100).toFixed(0)}% LVR (deploy ${(deploymentPercent * 100).toFixed(0)}%, ${repaymentType === 'interest_only' ? 'IO' : 'P&I'})`,
          type: 'equity_release',
          // targetLVR is a RATIO (e.g. 0.80) — `unit: 'ratio'` so the engine reads
          // it as 0.80, not 0.80/100. 'percent' silently shrank the release to
          // ~0.8% LVR, so the lever (and its servicing/released-capital) was ignored.
          value: targetLVR,
          unit: 'ratio',
          meta: {
            targetLVR,
            // honour per-property contracted rate if present, otherwise let engine fall back
            releaseRate: prop.interest_rate ?? null,
            deploymentPercent,
            repaymentType,
            ...(Number.isFinite(manualRepayment as number) ? { manualRepayment } : {}),
          },
        });
        // Track shadow servicing cost on the deployed slice for the impact summary
        const ratePct = prop.interest_rate ?? baseInputs.interestRate;
        const assessRatePct = ratePct + (baseInputs.bufferRate ?? 3);
        const newLoan = prop.current_value * targetLVR;
        const grossRelease = Math.max(0, newLoan - prop.loan_remaining);
        const deployedGross = grossRelease * deploymentPercent;
        let monthlyServicing = 0;
        if (Number.isFinite(manualRepayment as number) && (manualRepayment as number) >= 0) {
          monthlyServicing = manualRepayment as number;
        } else if (repaymentType === 'principal_and_interest') {
          const r = assessRatePct / 100 / 12;
          const n = (baseInputs.loanTermYears || 30) * 12;
          monthlyServicing = r > 0 && deployedGross > 0
            ? deployedGross * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
            : 0;
        } else {
          monthlyServicing = deployedGross * (assessRatePct / 100 / 12);
        }
        equityReleaseMonthlyCost += monthlyServicing;
        if (deployedGross > 0) {
          leverCashflowNotes.set(
            `equity_release-${prop.id}`,
            `+${formatCurrency(deployedGross)} cash · −${formatCurrency(monthlyServicing)}/mo ${repaymentType === 'interest_only' ? 'IO' : 'P&I'}`,
          );
        }
      });
      if (equityReleaseMonthlyCost > 0) {
        impacts.push({
          label: `Equity release servicing on ${strategy.equityReleasePropertyIds.size} property(s)`,
          monthlySaving: equityReleaseMonthlyCost,
          type: 'cost',
        });
      }
    }

    // 8. DTI Cap Override → dti_cap_change
    if (strategy.additional.dtiCapEnabled) {
      deltas.push({
        id: 'dti-cap',
        label: `DTI cap ${strategy.additional.dtiCapValue}x`,
        type: 'dti_cap_change',
        value: strategy.additional.dtiCapValue,
        unit: 'ratio',
        meta: { enabled: true },
      });
      impacts.push({ label: `DTI cap applied at ${strategy.additional.dtiCapValue}x`, monthlySaving: 0, type: 'info' });
    }

    // 9. Per-Property Rate Repricing → property_rate_change deltas (Phase F1)
    if (strategy.propertyRateOverrides.size > 0) {
      strategy.propertyRateOverrides.forEach((newRate, propId) => {
        const prop = properties.find(p => p.id === propId);
        if (!prop || !Number.isFinite(newRate) || newRate <= 0) return;
        const oldRate = prop.interest_rate ?? baseInputs.interestRate;
        if (Math.abs(newRate - oldRate) < 0.01) return;
        deltas.push({
          id: prop.id,
          label: `Reprice ${prop.address?.slice(0, 25) || 'property'} → ${newRate.toFixed(2)}%`,
          type: 'property_rate_change',
          value: newRate,
          unit: 'rate_points',
        });
        impacts.push({
          label: `Reprice ${prop.address?.slice(0, 25) || 'property'}: ${oldRate.toFixed(2)}% → ${newRate.toFixed(2)}%`,
          monthlySaving: 0,
          type: 'info',
        });
      });
    }

    // 10. Phase G1 — Valuation Uplift → property_value_change deltas (resolve FIRST in engine)
    if (strategy.additional.valuationOverrides.size > 0) {
      strategy.additional.valuationOverrides.forEach((override, propId) => {
        const prop = properties.find(p => p.id === propId);
        if (!prop || !Number.isFinite(override.newValue) || override.newValue <= 0) return;
        if (Math.abs(override.newValue - (prop.current_value || 0)) < 1) return;
        deltas.push({
          id: prop.id,
          label: `Revalue ${prop.address?.slice(0, 25) || 'property'} → ${formatCurrency(override.newValue)}`,
          type: 'property_value_change',
          value: override.newValue,
          unit: 'absolute',
          meta: {
            basis: override.basis,
            source: override.source || '',
          },
        });
        impacts.push({
          label: `Revalue ${prop.address?.slice(0, 25) || 'property'}: ${formatCurrency(prop.current_value || 0)} → ${formatCurrency(override.newValue)} (${override.basis})`,
          monthlySaving: 0,
          type: 'info',
        });
      });
    }

    // 11. Phase G2 — Cross-Collateralised Pool → portfolio_lvr_release delta
    if (strategy.additional.crossCollatPool.enabled && strategy.additional.crossCollatPool.propertyIds.size > 0) {
      const pool = strategy.additional.crossCollatPool;
      const memberIds = Array.from(pool.propertyIds);
      deltas.push({
        id: 'pool-default',
        label: `Cross-collat pool → ${(pool.blendedTargetLVR * 100).toFixed(0)}% blended LVR (${memberIds.length} security)`,
        type: 'portfolio_lvr_release',
        value: pool.blendedTargetLVR,
        unit: 'ratio',
        meta: {
          propertyIds: memberIds,
          lenderMaxLVR: pool.lenderMaxLVR,
          allocationStrategy: pool.allocationStrategy,
        },
      });
      impacts.push({
        label: `Pool ${memberIds.length} securities @ ${(pool.blendedTargetLVR * 100).toFixed(0)}% blended LVR (${pool.allocationStrategy.replace(/_/g, ' ')})`,
        monthlySaving: 0,
        type: 'info',
      });
    }

    const engineProperties: EngineProperty[] = properties.map(p => ({
      id: p.id,
      address: p.address,
      propertyType: p.property_type,
      currentValue: p.current_value || 0,
      loanRemaining: p.loan_remaining || 0,
      monthlyRepayment: p.monthly_interest_repayment || 0,
      loanRepaymentAmount: p.loan_repayment_amount || p.monthly_interest_repayment || 0,
      netMonthlyCashflow: p.net_monthly_cashflow || 0,
      // Phase F1 — pipe per-property rate
      interestRate: p.interest_rate ?? undefined,
    }));
    const engineLiabilities: EngineLiability[] = liabilities.map(l => ({
      id: l.id,
      type: l.type,
      label: l.label,
      balance: l.balance,
      limit: l.limit,
      monthlyServicing: l.monthlyServicing,
    }));

    const acquisitionCtx: EngineAcquisitionContext | undefined = acquisition.enabled ? {
      state: acquisition.state,
      intent: acquisition.intent,
      category: acquisition.category,
      isFirstHomeBuyer: acquisition.isFirstHomeBuyer,
      isForeignBuyer: acquisition.isForeignBuyer,
      lmiMode: acquisition.lmiMode,
      cashOnHand: acquisition.cashOnHand,
      // Phase F2 — surface the target so the engine reports meetsTarget / shortfall
      targetPurchasePrice: acquisition.targetPurchasePrice > 0 ? acquisition.targetPurchasePrice : undefined,
    } : undefined;

    const ctx: ScenarioContext = {
      baseInputs,
      baseResult,
      properties: engineProperties,
      liabilities: engineLiabilities,
      acquisition: acquisitionCtx,
      // Phase I1/I2 — propagate lender awareness + HEM floor so re-shading
      // and HEM clamps fire when the broker uses a `dti_cap_change` lender flip.
      incomeComponents,
      currentLenderProfileId,
      hemBenchmark,
    };

    // 12. Phase K2 — Capital Flow Canvas → capital_allocation deltas
    capitalAllocations.forEach((alloc) => {
      if (!alloc.amount || alloc.amount <= 0) return;
      deltas.push({
        id: alloc.id,
        label: `Capital allocation → ${alloc.sinkType.replace(/_/g, ' ')}`,
        type: 'capital_allocation',
        value: alloc.amount,
        unit: 'absolute',
        meta: {
          sinkType: alloc.sinkType,
          sinkTargetId: alloc.sinkTargetId,
          sourcePool: 'pool-default',
          offsetRatePoints: alloc.offsetRatePoints,
          rateBuydownPoints: alloc.rateBuydownPoints,
          repaymentReductionMonthly: alloc.repaymentReductionMonthly,
        },
      });
    });

    // Delegate ALL scenario math to the unified engine
    const { inputs, result } = runScenarioWithInputs('Strategy Preview', deltas, ctx);
    const acquisitionCapacity = (result.acquisitionCapacity ?? null) as AcquisitionCapacity | null;
    const validationIssues = result.validationIssues ?? [];
    const capitalLedger = (result as any).capitalLedger ?? null;

    // Audit-fix #3 — Baseline guard. When no levers are active the scenario
    // MUST equal the base. Some upstream context (e.g. an acquisition target
    // re-evaluating LMI) was producing a non-zero scenario delta even with
    // `deltas.length === 0`, which surfaced a phantom "Scenario Borrowing
    // Capacity = base + base" in the headline. Force-collapse to the base
    // result so the user sees a true zero-delta baseline.
    const baselineMode = deltas.length === 0;
    const effectiveResult = baselineMode ? (baseResult as any) : result;
    const effectiveInputs = baselineMode ? baseInputs : inputs;

    // ── F4 — Per-lever attribution ──────────────────────────────────────
    // Replay each delta IN ISOLATION against the same base context to
    // measure the capacity uplift attributable to that lever alone.
    // The sum of these isolated impacts won't equal the compounded total
    // (levers interact); the headline component surfaces the residual.
    //
    // ── Theoretical (unfloored) capacity ────────────────────────────────
    // The engine clamps `borrowingCapacity` at $0 when monthly surplus is
    // negative AND, in conservative mode, ALSO clamps `monthlySurplus`
    // itself to $0 once it drops below the minimum surplus floor. Reading
    // `result.monthlySurplus` therefore returns a flat $0 for any scenario
    // below the floor — which collapses the entire theoretical column to
    // a single (wrong) number.
    //
    // Fix: derive the TRUE raw surplus from the engine's exposed inputs
    // (after-tax income − living expenses − commitments) so the
    // theoretical math is honest regardless of conservative-mode floors.
    const annuityFactor = (annualRatePct: number, termYears: number): number => {
      const r = (annualRatePct / 100) / 12;
      const n = termYears * 12;
      if (r <= 0 || n <= 0) return 0;
      const f = (1 - Math.pow(1 + r, -n)) / r;
      // Safety clamp — annuity factor for plausible (rate, term) combos sits
      // between ~50 (15% rate, 30y) and ~280 (1% rate, 30y). Anything outside
      // that band is a sign the inputs collapsed (rate ~ 0) and would balloon
      // theoretical capacity into the millions. Clamp to a sane ceiling.
      return Number.isFinite(f) ? Math.min(Math.max(f, 0), 280) : 0;
    };
    /** Compute the unfloored raw monthly surplus directly from the engine's
     *  decomposed result. Bypasses conservative-mode floors and the
     *  Math.max(0,…) clamp on `monthlySurplus`. The engine has already
     *  aggregated commitments (incl. any new equity-release servicing) so
     *  this is the *true* post-aggregation surplus before the floor kicks in. */
    const resolveMonthlyAfterTaxIncome = (r: any, inputs: any): number => {
      const directIncome =
        r?.monthlyAfterTaxIncome ??
        r?.currentCapacity?.monthlyAfterTaxIncome ??
        r?.taxBreakdown?.monthlyTakeHome ??
        (typeof r?.afterTaxAnnualIncome === 'number' ? r.afterTaxAnnualIncome / 12 : undefined) ??
        (typeof r?.currentCapacity?.afterTaxAnnualIncome === 'number' ? r.currentCapacity.afterTaxAnnualIncome / 12 : undefined);

      if (Number.isFinite(directIncome as number) && (directIncome as number) > 0) {
        return Math.round(directIncome as number);
      }

      const assessableAnnualIncome =
        inputs?.shadedAnnualIncome ??
        r?.shadedAnnualIncome ??
        r?.currentCapacity?.shadedAnnualIncome ??
        inputs?.grossAnnualIncome ??
        r?.grossAnnualIncome ??
        r?.currentCapacity?.grossAnnualIncome ??
        0;

      return assessableAnnualIncome > 0
        ? Math.round(calculateAfterTaxIncome(assessableAnnualIncome) / 12)
        : 0;
    };

    const rawSurplusFrom = (r: any, inputs: any): number => {
      const income = resolveMonthlyAfterTaxIncome(r, inputs);
      // Expenses & commitments from the *inputs* the engine actually consumed
      const expenses = inputs?.monthlyLivingExpenses ?? r?.totalLivingExpenses ?? 0;
      const commitments = inputs?.monthlyCommitments ?? r?.existingCommitmentsMonthly ?? 0;
      return income - expenses - commitments;
    };
    /** Engine-truth assessment rate. The engine returns `assessmentRate`
     *  directly on the result — use it instead of recomputing from inputs
     *  where `bufferRate` may be 0/undefined and produce a doubled annuity
     *  factor (the source of the "millions" bug). */
    const safeAssessmentRate = (r: any, inputs: any): number => {
      const fromResult = r?.assessmentRate;
      if (Number.isFinite(fromResult) && fromResult > 0) return fromResult;
      const ir = inputs?.interestRate ?? 0;
      const buf = inputs?.bufferRate ?? 3; // default APRA buffer
      const computed = ir + buf;
      return computed > 0 ? computed : 0;
    };

    const baseTerm = baseInputs.loanTermYears ?? 30;
    const baseAssessmentRate = safeAssessmentRate(baseResult, baseInputs);
    const baseRawSurplus = rawSurplusFrom(baseResult, baseInputs);
    const baseAnnuity = annuityFactor(baseAssessmentRate, baseTerm);
    const baseTheoreticalCapacity = Math.round(baseRawSurplus * baseAnnuity);

    const scenarioTerm = effectiveInputs.loanTermYears ?? baseTerm;
    const scenarioAssessmentRate = safeAssessmentRate(effectiveResult, effectiveInputs);
    const scenarioRawSurplus = rawSurplusFrom(effectiveResult, effectiveInputs);
    const scenarioAnnuity = annuityFactor(scenarioAssessmentRate, scenarioTerm);
    const scenarioTheoreticalCapacity = baselineMode
      ? baseTheoreticalCapacity
      : Math.round(scenarioRawSurplus * scenarioAnnuity);

    // Phase 4 — math-inspector breakdown values (decomposed components used in the waterfall)
    const baseAfterTaxIncome = resolveMonthlyAfterTaxIncome(baseResult, baseInputs);
    const baseLivingExpenses = (baseInputs as any)?.monthlyLivingExpenses ?? (baseResult as any)?.totalLivingExpenses ?? 0;
    const baseCommitments = (baseInputs as any)?.monthlyCommitments ?? (baseResult as any)?.existingCommitmentsMonthly ?? 0;
    const scenarioAfterTaxIncome = resolveMonthlyAfterTaxIncome(effectiveResult, effectiveInputs);
    const scenarioLivingExpenses = (effectiveInputs as any)?.monthlyLivingExpenses ?? (effectiveResult as any)?.totalLivingExpenses ?? 0;
    const scenarioCommitments = (effectiveInputs as any)?.monthlyCommitments ?? (effectiveResult as any)?.existingCommitmentsMonthly ?? 0;

    // Audit-fix #4 — Lever attribution invariants. Every isolated delta is
    // re-run on the same base context and its impact is normalised against
    // baseResult.borrowingCapacity. When baseline (no deltas) the array is
    // empty so the waterfall hides itself instead of rendering phantom rows.
    const leverAttribution: LeverAttribution[] = baselineMode ? [] : deltas.map(d => {
      const isolated = runScenarioWithInputs(`Isolated: ${d.label}`, [d], ctx);
      const isoTerm = isolated.inputs.loanTermYears ?? baseTerm;
      const isoAssessRate = safeAssessmentRate(isolated.result, isolated.inputs);
      const isoRawSurplus = rawSurplusFrom(isolated.result, isolated.inputs);
      const isoTheoretical = Math.round(isoRawSurplus * annuityFactor(isoAssessRate, isoTerm));
      return {
        id: `${d.type}-${d.id}`,
        label: d.label,
        capacityImpact: isolated.result.borrowingCapacity - baseResult.borrowingCapacity,
        theoreticalImpact: isoTheoretical - baseTheoreticalCapacity,
        cashflowNote: leverCashflowNotes.get(`${d.type}-${d.id}`),
      };
    });

    const floorActive = !baselineMode &&
      (baseResult.borrowingCapacity <= 0 || baseRawSurplus < 0) &&
      (Math.abs(scenarioTheoreticalCapacity - baseTheoreticalCapacity) > 0 ||
        leverAttribution.some(l => Math.abs(l.theoreticalImpact ?? 0) > 0));

    return {
      scenarioContext: ctx,
      scenarioResult: effectiveResult as unknown as BorrowingCapacityResult,
      scenarioInputs: effectiveInputs,
      impactBreakdown: baselineMode ? [] : impacts,
      acquisitionCapacity,
      validationIssues,
      leverAttribution,
      appliedDeltas: baselineMode ? [] : deltas,
      capitalLedger,
      baseTheoreticalCapacity,
      scenarioTheoreticalCapacity,
      baseRawSurplus,
      scenarioRawSurplus,
      floorActive,
      // Phase 4 — math-inspector decomposition
      baseAfterTaxIncome,
      baseLivingExpenses,
      baseCommitments,
      baseAssessmentRate,
      baseTerm,
      baseAnnuity,
      scenarioAfterTaxIncome,
      scenarioLivingExpenses,
      scenarioCommitments,
      scenarioAssessmentRate,
      scenarioTerm,
      scenarioAnnuity,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // Reactivity signatures — guarantee re-run on ANY nested Map/Set/value change
    strategySignature,
    acquisitionSignature,
    capitalAllocationsSignature,
    // Stable refs from props/derived data
    baseInputs,
    baseResult,
    consolidatableDebts,
    investmentProperties,
    equityReleaseProperties,
    properties,
    liabilities,
    // Lender-aware context (Phase I) — propagated into engine
    incomeComponents,
    currentLenderProfileId,
    hemBenchmark,
  ]);


  // Equity release calculation — supports multiple properties + Phase 2 deployment %
  interface EquityReleaseItem {
    property: PropertyItem;
    currentLVR: number;
    currentEquity: number;
    targetLVR: number;
    grossAccessibleEquity: number;
    accessibleEquity: number;
    deployedGross: number;
    deployedNet: number;
    deploymentPercent: number;
    repaymentType: 'interest_only' | 'principal_and_interest';
    autoMonthlyServicing: number;
    manualRepayment?: number;
    maxLoan: number;
    lmiEstimate: any;
    lmiAmount: number;
  }

  const equityReleaseItems = useMemo<EquityReleaseItem[]>(() => {
    if (!strategy.equityReleaseEnabled || strategy.equityReleasePropertyIds.size === 0) return [];
    return Array.from(strategy.equityReleasePropertyIds).map(propId => {
      const prop = equityReleaseProperties.find(p => p.id === propId);
      if (!prop) return null;
      const targetLVR = strategy.equityReleaseTargetLVRs.get(propId) ?? DEFAULT_EQUITY_LVR;
      const deploymentPercent = strategy.equityReleaseDeploymentPercents.get(propId) ?? 1;
      const repaymentType = strategy.equityReleaseRepaymentTypes.get(propId) ?? 'interest_only';
      const manualRepayment = strategy.equityReleaseManualRepayments.get(propId);
      const maxLoan = prop.current_value * targetLVR;
      const grossAccessibleEquity = Math.max(0, maxLoan - prop.loan_remaining);
      const currentLVR = prop.current_value > 0 ? (prop.loan_remaining / prop.current_value) * 100 : 0;
      const currentEquity = prop.current_value - prop.loan_remaining;
      const targetLVRPercent = targetLVR * 100;

      let lmiEstimate = null;
      let lmiAmount = 0;
      if (targetLVRPercent > 80 && grossAccessibleEquity > 0) {
        lmiEstimate = estimateLMI({
          propertyValue: prop.current_value,
          depositAmount: prop.current_value - maxLoan,
          loanAmount: maxLoan,
          isFirstHomeBuyer: false,
        });
        lmiAmount = lmiEstimate.lmiAmount;
      }

      const accessibleEquity = Math.max(0, grossAccessibleEquity - lmiAmount);
      const deployedGross = grossAccessibleEquity * deploymentPercent;
      const deployedLmi = lmiAmount * deploymentPercent;
      const deployedNet = Math.max(0, deployedGross - deployedLmi);

      const ratePct = prop.interest_rate ?? baseInputs.interestRate;
      const assessRatePct = ratePct + (baseInputs.bufferRate ?? 3);
      let autoMonthlyServicing = 0;
      if (repaymentType === 'principal_and_interest') {
        const r = assessRatePct / 100 / 12;
        const n = (baseInputs.loanTermYears || 30) * 12;
        autoMonthlyServicing = r > 0 && deployedGross > 0
          ? deployedGross * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
          : 0;
      } else {
        autoMonthlyServicing = deployedGross * (assessRatePct / 100 / 12);
      }

      return {
        property: prop, currentLVR, currentEquity,
        targetLVR: targetLVRPercent, grossAccessibleEquity, accessibleEquity,
        deployedGross, deployedNet, deploymentPercent, repaymentType,
        autoMonthlyServicing,
        manualRepayment: Number.isFinite(manualRepayment as number) ? manualRepayment : undefined,
        maxLoan, lmiEstimate, lmiAmount,
      };
    }).filter(Boolean) as EquityReleaseItem[];
  }, [
    strategy.equityReleaseEnabled,
    strategy.equityReleasePropertyIds,
    strategy.equityReleaseTargetLVRs,
    strategy.equityReleaseDeploymentPercents,
    strategy.equityReleaseRepaymentTypes,
    strategy.equityReleaseManualRepayments,
    equityReleaseProperties,
    baseInputs.interestRate,
    baseInputs.bufferRate,
    baseInputs.loanTermYears,
  ]);

  const totalAccessibleEquity = useMemo(
    () => equityReleaseItems.reduce((sum, item) => sum + item.deployedNet, 0),
    [equityReleaseItems]
  );

  const buildReplayAudit = useCallback((name: string, createdAt: string): PersistedBcScenarioV2 => buildPersistedBcScenarioV2({
    scenarioName: name,
    baseInputs,
    baseResult: baseResult as BorrowingCapacityResult & { assessmentId?: string; calculatedAt?: string },
    adjustedInputs: scenarioInputs,
    resultSnapshot: scenarioResult,
    scenarioDeltas: appliedDeltas,
    acquisition,
    acquisitionCapacity: acquisition.enabled ? acquisitionCapacity : null,
    validationIssues,
    capitalLedger,
    capitalAllocations,
    properties: properties.map(p => ({
      id: p.id,
      address: p.address,
      propertyType: p.property_type,
      currentValue: p.current_value,
      loanRemaining: p.loan_remaining,
      monthlyRepayment: p.monthly_interest_repayment,
      loanRepaymentAmount: p.loan_repayment_amount,
      netMonthlyCashflow: p.net_monthly_cashflow,
      interestRate: p.interest_rate,
    })),
    liabilities: liabilities.map(l => ({
      id: l.id,
      type: l.type,
      label: l.label,
      balance: l.balance,
      limit: l.limit,
      monthlyServicing: l.monthlyServicing,
    })),
    incomeComponents: incomeComponents || [],
    createdAt,
  }), [
    baseInputs,
    baseResult,
    scenarioInputs,
    scenarioResult,
    appliedDeltas,
    acquisition,
    acquisitionCapacity,
    validationIssues,
    capitalLedger,
    capitalAllocations,
    properties,
    liabilities,
    incomeComponents,
  ]);

  const presetDriftById = useMemo(() => {
    const current = {
      baseInputs,
      properties: properties.map(p => ({
        id: p.id,
        address: p.address,
        propertyType: p.property_type,
        currentValue: p.current_value,
        loanRemaining: p.loan_remaining,
        monthlyRepayment: p.monthly_interest_repayment,
        loanRepaymentAmount: p.loan_repayment_amount,
        netMonthlyCashflow: p.net_monthly_cashflow,
        interestRate: p.interest_rate,
      })),
      liabilities: liabilities.map(l => ({
        id: l.id,
        type: l.type,
        label: l.label,
        balance: l.balance,
        limit: l.limit,
        monthlyServicing: l.monthlyServicing,
      })),
      incomeComponents: incomeComponents || [],
    };
    return new Map(presets.map(preset => [preset.id, computeScenarioDrift(preset.replayAudit, current)]));
  }, [baseInputs, properties, liabilities, incomeComponents, presets]);

  const capacityChange = scenarioResult.borrowingCapacity - baseResult.borrowingCapacity;
  const surplusChange = scenarioResult.monthlySurplus - baseResult.monthlySurplus;
  const totalMonthlySaving = impactBreakdown.reduce((sum, i) =>
    sum + (i.type === 'saving' ? i.monthlySaving : i.type === 'cost' ? -i.monthlySaving : 0), 0);

  // Binding-constraint analysis for both base and scenario — surfaces the
  // "wall" the user is currently pressed against (DTI cap vs surplus vs absolute).
  // Pure compute, no math change.
  const baseBinding = useMemo(
    () => computeBindingConstraint(baseInputs, baseResult),
    [baseInputs, baseResult]
  );
  const scenarioBinding = useMemo(
    () => computeBindingConstraint(scenarioInputs, scenarioResult),
    [scenarioInputs, scenarioResult]
  );

  const blockingValidationIssues = validationIssues.filter(issue => issue.severity === 'error');
  /**
   * The scenarios this export carries.
   *
   * A transient preset reflecting the live strategy state is appended so the
   * document shows the what-if the adviser is looking at, saved or not. Built
   * on demand rather than memoised: it stamps a created-at and an id, and a
   * memo would hand two different exports the same one.
   *
   * Both renderers are given this list. What they do differ on is the *base*:
   * the server renders the saved assessment with these scenarios beside it,
   * because `render-borrowing-capacity-pdf` reads the assessment from the
   * database and will not take a capacity figure from a browser. The legacy
   * generator draws the unsaved overrides as the base. Neither is wrong — they
   * answer different questions — so the menu says which is which rather than
   * picking for the adviser.
   */
  const buildScenarioPresetsForExport = (): ScenarioPreset[] => {
    const transientName = scenarioName.trim() || 'Current What-If Scenario';
    const transientCreatedAt = new Date().toISOString();
    const transient: ScenarioPreset = {
      id: `transient-${Date.now()}`,
      name: transientName,
      isBase: false,
      createdAt: transientCreatedAt,
      adjustedInputs: { ...scenarioInputs },
      result: scenarioResult,
      accessibleEquity: totalAccessibleEquity,
      acquisitionCapacity: acquisition.enabled ? acquisitionCapacity : null,
      scenarioDeltas: appliedDeltas,
      validationIssues,
      capitalLedger,
      capitalAllocations: [...capitalAllocations],
      acquisition,
      replayAudit: buildReplayAudit(transientName, transientCreatedAt),
      incomeComponents,
      currentLenderProfileId,
      hemBenchmark,
    };
    return [...presets, ...(presets.some((p) => p.id === transient.id) ? [] : [transient])];
  };

  const hasBlockingValidationIssues = blockingValidationIssues.length > 0;

  const hasAnyStrategy = strategy.consolidatedLiabilities.size > 0 ||
    strategy.refinancedToIO.size > 0 ||
    strategy.equityReleaseEnabled ||
    strategy.rateAdjustment !== 0 ||
    strategy.propertyRateOverrides.size > 0 ||
    strategy.additional.incomeGrowthPercent !== 0 ||
    strategy.additional.expenseReductionPercent !== 0 ||
    strategy.additional.loanTermAdjustment !== 0 ||
    strategy.additional.dtiCapEnabled ||
    strategy.additional.portfolioSellPropertyIds.size > 0 ||
    strategy.additional.valuationOverrides.size > 0 ||
    strategy.additional.crossCollatPool.enabled ||
    capitalAllocations.length > 0 ||
    acquisition.enabled;

  const handleReset = useCallback(() => {
    setStrategy({
      ...DEFAULT_STRATEGY,
      consolidatedLiabilities: new Set(),
      refinancedToIO: new Set(),
      refinanceManualRepayments: new Map(),
      refinanceIoPeriodYears: new Map(),
      equityReleasePropertyIds: new Set(),
      equityReleaseTargetLVRs: new Map(),
      equityReleaseDeploymentPercents: new Map(),
      equityReleaseRepaymentTypes: new Map(),
      equityReleaseManualRepayments: new Map(),
      propertyRateOverrides: new Map(),
      additional: { ...DEFAULT_ADDITIONAL_STRATEGY, portfolioSellPropertyIds: new Set() },
    });
    setAcquisition(DEFAULT_ACQUISITION);
    setCapitalAllocations([]);
  }, []);

  const handleSavePreset = useCallback(() => {
    if (hasBlockingValidationIssues) {
      toast.error('Resolve blocking scenario validation errors before saving.');
      return;
    }
    try {
      const name = scenarioName.trim() || `Scenario ${presets.length}`;
      const createdAt = new Date().toISOString();
      const replayAudit = buildReplayAudit(name, createdAt);
      const newPreset: ScenarioPreset = {
        id: `preset-${Date.now()}`,
        name,
        isBase: false,
        createdAt,
        adjustedInputs: { ...scenarioInputs },
        result: scenarioResult,
        accessibleEquity: totalAccessibleEquity,
        acquisitionCapacity: acquisition.enabled ? acquisitionCapacity : null,
        scenarioDeltas: appliedDeltas,
        validationIssues,
        capitalLedger,
        capitalAllocations: [...capitalAllocations],
        acquisition,
        replayAudit,
        incomeComponents,
        currentLenderProfileId,
        hemBenchmark,
      };
      const updated = [...presets, newPreset];
      setPresets(updated);
      onPresetsChange?.(updated);
      setScenarioName('');
      setShowSaveInput(false);
      // Save-only: persist to the Saved Scenarios list and STAY on the What-If
      // tab. The scenario is intentionally NOT auto-applied to the calculator —
      // use "Load" on the saved entry, or "Apply to Calculator", to push it into
      // the live calc. The base snapshot the modeller compares against is held
      // separately (baseScenarioResult), so not applying never reverts the view.
    } catch (err: any) {
      console.error('[StrategyScenarioModeling] Save scenario failed:', err);
      toast.error(err?.message || 'Failed to save scenario');
    }
  }, [scenarioName, hasBlockingValidationIssues, scenarioInputs, scenarioResult, presets, onPresetsChange, totalAccessibleEquity, acquisition, acquisitionCapacity, appliedDeltas, validationIssues, capitalLedger, capitalAllocations, buildReplayAudit, incomeComponents, currentLenderProfileId, hemBenchmark]);

  const handleDeletePreset = useCallback((id: string) => {
    const updated = presets.filter(p => p.id !== id);
    setPresets(updated);
    onPresetsChange?.(updated);
  }, [presets, onPresetsChange]);

  const handleLoadPreset = useCallback((preset: ScenarioPreset) => {
    // Reset all strategies and show the preset's result as the "base" comparison
    handleReset();
    if (preset.acquisition) {
      setAcquisition(preset.acquisition);
    }
    if (Array.isArray(preset.capitalAllocations)) {
      setCapitalAllocations(preset.capitalAllocations);
      const payoffIds = new Set(
        preset.capitalAllocations
          .filter(alloc => alloc.id.startsWith(PAYOFF_ALLOCATION_PREFIX) && alloc.sinkType === 'liability_payoff' && alloc.sinkTargetId)
          .map(alloc => alloc.sinkTargetId as string),
      );
      if (payoffIds.size > 0) {
        setStrategy(prev => ({ ...prev, consolidatedLiabilities: payoffIds }));
      }
    }
    // Apply the preset's inputs to the main calculator
    onApplyScenario?.(preset.adjustedInputs, preset.accessibleEquity ?? 0, preset);
  }, [handleReset, onApplyScenario]);

  const buildPdfOverrideAssessment = useCallback((inputs: BorrowingCapacityInput, result: BorrowingCapacityResult) => ({
    created_at: new Date().toISOString(),
    borrowing_capacity: result.borrowingCapacity,
    monthly_surplus: result.monthlySurplus,
    serviceability_band: result.serviceabilityBand,
    stress_tested_capacity: result.stressTestedCapacity,
    dti_ratio: result.dtiRatio,
    assessment_rate: result.assessmentRate,
    gross_annual_income: inputs.grossAnnualIncome,
    shaded_annual_income: inputs.shadedAnnualIncome ?? inputs.grossAnnualIncome,
    living_expenses_monthly: inputs.monthlyLivingExpenses,
    existing_commitments_monthly: inputs.monthlyCommitments,
    interest_rate_used: inputs.interestRate,
    buffer_rate: inputs.bufferRate,
    loan_term_years: inputs.loanTermYears,
    proposed_loan_amount: 0,
    expense_method: 'hybrid',
    recommendations: result.recommendations ?? [],
    warnings: result.warnings ?? [],
    assumptions: {
      selectedLenderName: currentLenderProfileId,
      source: 'Current What-If Scenario',
    },
    income_breakdown: incomeComponents?.map((item) => ({
      source_name: item.label,
      gross_annual_amount: item.grossAnnual,
      custom_shading_rate: item.currentShadingRate,
      shaded_amount: item.grossAnnual * item.currentShadingRate,
    })) ?? [],
    liability_breakdown: liabilities.map((item) => ({
      type: item.type,
      label: item.label,
      balance: item.balance,
      monthlyServicing: item.monthlyServicing,
    })),
  }), [currentLenderProfileId, incomeComponents, liabilities]);

  const toggleConsolidation = (id: string) => {
    setStrategy(prev => {
      const next = new Set(prev.consolidatedLiabilities);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...prev, consolidatedLiabilities: next };
    });
  };

  const toggleRefinance = (id: string) => {
    setStrategy(prev => {
      const next = new Set(prev.refinancedToIO);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...prev, refinancedToIO: next };
    });
  };

  const handleAdditionalChange = useCallback((updates: Partial<AdditionalStrategyState>) => {
    setStrategy(prev => ({
      ...prev,
      additional: { ...prev.additional, ...updates },
    }));
  }, []);

  // Audit-fix #1 — Apply a "Suggested Solution" card click into the existing
  // strategy state. Maps each typed payload to the matching setter so we never
  // duplicate state shape.
  const handleApplySolution = useCallback((apply: SolutionApply) => {
    if (apply.kind === 'expense') {
      handleAdditionalChange({ expenseReductionPercent: apply.percent });
    } else if (apply.kind === 'term') {
      handleAdditionalChange({ loanTermAdjustment: apply.years });
    } else if (apply.kind === 'equity') {
      setStrategy(prev => {
        const ids = new Set(prev.equityReleasePropertyIds);
        ids.add(apply.propertyId);
        const lvrs = new Map(prev.equityReleaseTargetLVRs);
        lvrs.set(apply.propertyId, apply.targetLVR);
        return {
          ...prev,
          equityReleaseEnabled: true,
          equityReleasePropertyIds: ids,
          equityReleaseTargetLVRs: lvrs,
        };
      });
    }
  }, [handleAdditionalChange]);

  const baseBand = getServiceabilityBandColor(baseResult.serviceabilityBand);
  const scenarioBand = getServiceabilityBandColor(scenarioResult.serviceabilityBand);

  return (
    <div className="space-y-4">
      {/* AI Strategy Advisor and its directly attached suggested solutions */}
      <BCScenarioAgent
        baseInputs={baseInputs}
        baseResult={baseResult}
        liabilities={liabilities}
        properties={properties}
        clientId={clientId}
        incomeComponents={incomeComponents}
        currentLenderProfileId={currentLenderProfileId}
        hemBenchmark={hemBenchmark}
        /* Live engine truth for the applied scenario — sourced from the SAME
         * `scenarioResult` that drives the Compound Impact Summary below, so the
         * AI card's Engine Truth reconciles exactly with the live calculator
         * instead of drifting from its pre-Apply preview. Null when no levers are
         * live so unapplied cards keep showing their own preview. */
        appliedEngineSnapshot={hasAnyStrategy ? {
          borrowingCapacity: Math.round(scenarioResult.borrowingCapacity),
          capacityChange: Math.round(scenarioResult.borrowingCapacity - baseResult.borrowingCapacity),
          monthlySurplus: Math.round(scenarioResult.monthlySurplus),
          serviceabilityBand: scenarioResult.serviceabilityBand,
          dtiRatio: Number((scenarioResult.dtiRatio ?? 0).toFixed(2)),
          ...(acquisition.enabled && acquisitionCapacity ? {
            meetsTarget: acquisitionCapacity.meetsTarget,
            shortfallToTarget: acquisitionCapacity.shortfallToTarget,
            maxPurchasePrice: acquisitionCapacity.maxPurchasePrice,
            loanRequiredForPurchase: acquisitionCapacity.loanRequiredForPurchase,
            netCashAfterSettlement: acquisitionCapacity.netCashAfterSettlement,
            releasedCapital: acquisitionCapacity.releasedCapital,
            targetPurchasePrice: acquisitionCapacity.targetPurchasePrice,
          } : {}),
        } : null}
        onApplyScenario={(scenario: AIScenario) => {
          // Map AI scenario adjustments to strategy state. Be defensive here:
          // AI-generated/persisted cards can omit optional arrays or carry old
          // payload shapes, and this callback is invoked directly by the three
          // card action buttons. Normalising prevents a bad card from throwing
          // before the selected scenario can surface in the builder.
          const adjustments = {
            consolidatedLiabilityIds: [],
            refinancedToIOPropertyIds: [],
            rateAdjustment: 0,
            incomeGrowthPercent: 0,
            expenseReductionPercent: 0,
            portfolioSellPropertyIds: [],
            propertyRateChanges: [],
            valuationOverrides: [],
            ...(scenario.adjustments ?? {}),
          };
          const aiAcquisition = adjustments.acquisition;
          if (aiAcquisition) {
            setAcquisition({
              enabled: true,
              state: aiAcquisition.state ?? DEFAULT_ACQUISITION.state,
              intent: aiAcquisition.intent ?? DEFAULT_ACQUISITION.intent,
              category: aiAcquisition.category ?? DEFAULT_ACQUISITION.category,
              isFirstHomeBuyer: !!aiAcquisition.isFirstHomeBuyer,
              isForeignBuyer: !!aiAcquisition.isForeignBuyer,
              lmiMode: aiAcquisition.lmiMode ?? DEFAULT_ACQUISITION.lmiMode,
              cashOnHand: Math.max(0, aiAcquisition.cashOnHand ?? 0),
              targetPurchasePrice: Math.max(0, aiAcquisition.targetPurchasePrice ?? 0),
            });
          }
          setStrategy(prev => {
              const eqRelease = adjustments.equityRelease;
              const newPropertyIds = new Set<string>(eqRelease ? [eqRelease.propertyId] : []);
              const newTargetLVRs = new Map<string, number>();
              if (eqRelease) newTargetLVRs.set(eqRelease.propertyId, eqRelease.targetLVR || DEFAULT_EQUITY_LVR);

              // Map portfolio sell property IDs
              const sellIds = new Set<string>(adjustments.portfolioSellPropertyIds || []);

              // Map DTI cap override
              const dtiOverride = adjustments.dtiCapOverride;

              // Phase F1 — map per-property rate changes
              const rateOverrides = new Map<string, number>();
              (adjustments.propertyRateChanges || []).forEach(({ propertyId, newRate }) => {
                if (propertyId && Number.isFinite(newRate) && newRate > 0) {
                  rateOverrides.set(propertyId, newRate);
                }
              });

              // Phase G1 — map valuation overrides
              const valOverrides = new Map<string, import('./AdditionalStrategyLevers').ValuationOverride>();
              (adjustments.valuationOverrides || []).forEach((vo) => {
                if (vo.propertyId && Number.isFinite(vo.newValue) && vo.newValue > 0) {
                  valOverrides.set(vo.propertyId, {
                    propertyId: vo.propertyId,
                    newValue: vo.newValue,
                    basis: vo.basis,
                    source: vo.source || '',
                  });
                }
              });

              // Phase G2 — map cross-collateralised pool
              const aiPool = adjustments.crossCollatPool;
              const poolState = aiPool && aiPool.enabled
                ? {
                    enabled: true,
                    propertyIds: new Set<string>(aiPool.propertyIds || []),
                    blendedTargetLVR: aiPool.blendedTargetLVR ?? 0.80,
                    lenderMaxLVR: aiPool.lenderMaxLVR ?? 0.95,
                    allocationStrategy: (aiPool.allocationStrategy ?? 'highest_equity_first') as 'highest_equity_first' | 'pro_rata',
                  }
                : prev.additional.crossCollatPool;

              return {
                ...prev,
                consolidatedLiabilities: new Set(adjustments.consolidatedLiabilityIds || []),
                refinancedToIO: new Set(adjustments.refinancedToIOPropertyIds || []),
                rateAdjustment: adjustments.rateAdjustment || 0,
                propertyRateOverrides: rateOverrides,
                equityReleaseEnabled: !!eqRelease,
                equityReleasePropertyIds: newPropertyIds,
                equityReleaseTargetLVRs: newTargetLVRs,
                additional: {
                  ...prev.additional,
                  incomeGrowthPercent: adjustments.incomeGrowthPercent || 0,
                  expenseReductionPercent: adjustments.expenseReductionPercent || 0,
                  loanTermAdjustment: adjustments.loanTermAdjustment || 0,
                  portfolioSellPropertyIds: sellIds,
                  portfolioSellReinvest: false,
                  dtiCapEnabled: dtiOverride?.enabled || false,
                  dtiCapValue: dtiOverride?.value || 6,
                  valuationOverrides: valOverrides,
                  crossCollatPool: poolState,
                },
              };
            });

          // Open relevant sections based on which levers the AI activated
          setOpenSections(prev => ({
            ...prev,
            consolidation: (adjustments.consolidatedLiabilityIds?.length || 0) > 0,
            refinance: (adjustments.refinancedToIOPropertyIds?.length || 0) > 0,
            equity: !!adjustments.equityRelease,
            rates: (adjustments.rateAdjustment || 0) !== 0,
            incomeGrowth: (adjustments.incomeGrowthPercent || 0) !== 0,
            expenseReduction: (adjustments.expenseReductionPercent || 0) > 0,
            loanTerm: (adjustments.loanTermAdjustment || 0) !== 0,
            portfolioPlay: (adjustments.portfolioSellPropertyIds?.length || 0) > 0,
            dtiCap: !!adjustments.dtiCapOverride?.enabled,
            valuationUplift: (adjustments.valuationOverrides?.length || 0) > 0,
            crossCollatPool: !!adjustments.crossCollatPool?.enabled,
            acquisition: !!adjustments.acquisition,
          }));

          setScenarioName(scenario.name || 'Suggested Scenario');

          // Phase E (L1): Reconcile AI's estimatedImpact against engine truth.
          // React state updates above are asynchronous, so reading the local
          // `scenarioResult` immediately after applying a card can still return
          // the pre-apply/base result — this was surfacing as `+$0K (engine)`
          // while the card's Engine Truth panel showed a real uplift. Prefer the
          // pre-Apply engine validation already attached to the selected card,
          // then fall back to the current live result only if no validation was
          // available.
          const delta = typeof scenario.engineValidation?.capacityChange === 'number'
            ? scenario.engineValidation.capacityChange
            : ((scenarioResult?.borrowingCapacity ?? baseResult.borrowingCapacity ?? 0) - (baseResult.borrowingCapacity || 0));
          const sign = delta >= 0 ? '+' : '−';
          const absK = Math.round(Math.abs(delta) / 1000);
          return `${sign}$${absK}K (engine)`;
        }}
      />


      {/* Suggested one-click solutions stay directly under Strategy Advisor. */}
      <SolutionOptionCards
        context={scenarioContext}
        onApply={handleApplySolution}
        formatCurrency={formatCurrency}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          Strategy Scenario Builder
        </h2>
        <Button variant="ghost" size="sm" onClick={handleReset} disabled={!hasAnyStrategy}>
          <RotateCcw className="h-4 w-4 mr-1" />
          Reset
        </Button>
      </div>

      {/* ═══ LEVER 1: Debt Consolidation ═══ */}
      <Card>
        <Collapsible open={openSections.consolidation} onOpenChange={() => toggleSection('consolidation')}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  Debt Consolidation
                </CardTitle>
                <div className="flex items-center gap-2">
                  {strategy.consolidatedLiabilities.size > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {strategy.consolidatedLiabilities.size} selected
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections.consolidation ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              <p className="text-xs text-muted-foreground">
                Select debts to consolidate or pay off. Phase 4 requires each payoff to be funded through the Capital Flow Canvas before servicing or DTI debt is removed.
              </p>
              {consolidatableDebts.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">No consolidatable debts found.</p>
              ) : (
                <div className="space-y-2">
                  {consolidatableDebts.map(debt => (
                    <div
                      key={debt.id}
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                        strategy.consolidatedLiabilities.has(debt.id)
                          ? 'bg-primary/10 border-primary/30'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => toggleConsolidation(debt.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={strategy.consolidatedLiabilities.has(debt.id)}
                          onCheckedChange={() => toggleConsolidation(debt.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div>
                          <p className="text-sm font-medium">{debt.label}</p>
                          <p className="text-xs text-muted-foreground">
                            Balance: {formatCurrency(debt.balance)}
                            {debt.calculationNote && ` · ${debt.calculationNote}`}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-destructive">
                          -{formatCurrency(debt.monthlyServicing)}/mo
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {consolidatableDebts.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => {
                    const allIds = new Set(consolidatableDebts.map(d => d.id));
                    setStrategy(prev => ({ ...prev, consolidatedLiabilities: allIds }));
                  }}
                >
                  Select All ({consolidatableDebts.length})
                </Button>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ═══ LEVER 2: Refinance P&I → IO ═══ */}
      <Card>
        <Collapsible open={openSections.refinance} onOpenChange={() => toggleSection('refinance')}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4 text-primary" />
                  Refinance P&I → Interest Only
                </CardTitle>
                <div className="flex items-center gap-2">
                  {strategy.refinancedToIO.size > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {strategy.refinancedToIO.size} loan(s)
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections.refinance ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              <p className="text-xs text-muted-foreground">
                Switch investment loans from Principal & Interest to Interest Only to free up cash flow.
              </p>
              {investmentProperties.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">No investment property loans found.</p>
              ) : (
                <div className="space-y-2">
                  {investmentProperties.map(prop => {
                    const currentRepayment = prop.monthly_interest_repayment ||
                      calculatePIRepayment(prop.loan_remaining, baseInputs.interestRate, baseInputs.loanTermYears);
                    const ioRepayment = calculateIORepayment(prop.loan_remaining, baseInputs.interestRate);
                    const isSelected = strategy.refinancedToIO.has(prop.id);
                    const manualRepayment = strategy.refinanceManualRepayments.get(prop.id);
                    const ioPeriodYears = strategy.refinanceIoPeriodYears.get(prop.id) ?? 5;
                    const effectiveRepayment = Number.isFinite(manualRepayment as number) && (manualRepayment as number) >= 0
                      ? (manualRepayment as number)
                      : ioRepayment;
                    const saving = Math.max(0, currentRepayment - effectiveRepayment);

                    return (
                      <div
                        key={prop.id}
                        className={`rounded-lg border transition-colors ${
                          isSelected ? 'bg-primary/10 border-primary/30' : 'hover:bg-muted/50'
                        }`}
                      >
                        <div
                          className="flex items-center justify-between p-3 cursor-pointer"
                          onClick={() => toggleRefinance(prop.id)}
                        >
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={isSelected}
                              onCheckedChange={() => toggleRefinance(prop.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div>
                              <p className="text-sm font-medium">{prop.address?.slice(0, 35) || 'Investment Property'}</p>
                              <p className="text-xs text-muted-foreground">
                                Loan: {formatCurrency(prop.loan_remaining)} · P&I: {formatCurrency(currentRepayment)}/mo
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">
                              {Number.isFinite(manualRepayment as number) ? `Manual: ${formatCurrency(effectiveRepayment)}/mo` : `IO: ${formatCurrency(ioRepayment)}/mo`}
                            </p>
                            <p className="text-sm font-semibold text-success">
                              Save {formatCurrency(saving)}/mo
                            </p>
                          </div>
                        </div>

                        {/* Phase 3 — Granular refinance controls (per-property) */}
                        {isSelected && (
                          <div className="px-3 pb-3 pt-2 border-t border-border/50 space-y-3" onClick={(e) => e.stopPropagation()}>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">IO Period</Label>
                              <div className="flex gap-1.5">
                                {[3, 5, 10].map(yrs => (
                                  <button
                                    key={yrs}
                                    type="button"
                                    onClick={() => setStrategy(prev => {
                                      const next = new Map(prev.refinanceIoPeriodYears);
                                      next.set(prop.id, yrs);
                                      return { ...prev, refinanceIoPeriodYears: next };
                                    })}
                                    className={`flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors ${
                                      ioPeriodYears === yrs
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
                                    }`}
                                  >
                                    {yrs} yrs
                                  </button>
                                ))}
                              </div>
                              <p className="text-[10px] text-muted-foreground/70">
                                Informational — engine uses IO servicing for the assessment period.
                              </p>
                            </div>

                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs text-muted-foreground">
                                  Manual Repayment Override
                                </Label>
                                {Number.isFinite(manualRepayment as number) && (
                                  <button
                                    type="button"
                                    onClick={() => setStrategy(prev => {
                                      const next = new Map(prev.refinanceManualRepayments);
                                      next.delete(prop.id);
                                      return { ...prev, refinanceManualRepayments: next };
                                    })}
                                    className="text-[10px] text-muted-foreground hover:text-foreground underline"
                                  >
                                    Reset to auto
                                  </button>
                                )}
                              </div>
                              <Input
                                type="number"
                                inputMode="decimal"
                                value={Number.isFinite(manualRepayment as number) ? String(manualRepayment) : ''}
                                placeholder={`Auto: ${formatCurrency(ioRepayment)}/mo`}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setStrategy(prev => {
                                    const next = new Map(prev.refinanceManualRepayments);
                                    if (v === '') next.delete(prop.id);
                                    else {
                                      const num = Number(v);
                                      if (Number.isFinite(num) && num >= 0) next.set(prop.id, num);
                                    }
                                    return { ...prev, refinanceManualRepayments: next };
                                  });
                                }}
                                className="h-8 text-sm"
                              />
                              <p className="text-[10px] text-muted-foreground/70">
                                Override $/mo if you've negotiated a specific repayment with the lender.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ═══ LEVER 3: Equity Release ═══ */}
      <Card>
        <Collapsible open={openSections.equity} onOpenChange={() => toggleSection('equity')}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  Equity Release
                </CardTitle>
                <div className="flex items-center gap-2">
                  {totalAccessibleEquity > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {formatCurrency(totalAccessibleEquity)} ({equityReleaseItems.length} prop{equityReleaseItems.length !== 1 ? 's' : ''})
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections.equity ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                Explore accessing equity from existing properties to fund a deposit. Select multiple properties to spread the financial load.
              </p>

              <div className="flex items-center justify-between">
                <Label className="text-sm">Enable Equity Release</Label>
                <Switch
                  checked={strategy.equityReleaseEnabled}
                  onCheckedChange={(checked) =>
                    setStrategy(prev => ({
                      ...prev,
                      equityReleaseEnabled: checked,
                      equityReleasePropertyIds: checked ? prev.equityReleasePropertyIds : new Set(),
                    }))
                  }
                />
              </div>

              {/* Property equity overview — multi-select */}
              {strategy.equityReleaseEnabled && equityReleaseProperties.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Portfolio Equity Overview</Label>
                    {equityReleaseProperties.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs px-2"
                        onClick={() => {
                          const allIds = new Set(equityReleaseProperties.map(p => p.id));
                          const allSelected = equityReleaseProperties.every(p => strategy.equityReleasePropertyIds.has(p.id));
                          setStrategy(prev => ({
                            ...prev,
                            equityReleasePropertyIds: allSelected ? new Set() : allIds,
                          }));
                        }}
                      >
                        {equityReleaseProperties.every(p => strategy.equityReleasePropertyIds.has(p.id)) ? 'Deselect All' : 'Select All'}
                      </Button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {equityReleaseProperties.map(prop => {
                      const equity = prop.current_value - prop.loan_remaining;
                      const lvr = prop.current_value > 0 ? (prop.loan_remaining / prop.current_value) * 100 : 0;
                      const isSelected = strategy.equityReleasePropertyIds.has(prop.id);
                      return (
                        <div
                          key={prop.id}
                          className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                            isSelected ? 'bg-primary/10 border-primary/30' : 'hover:bg-muted/50'
                          }`}
                          onClick={() => setStrategy(prev => {
                            const newIds = new Set(prev.equityReleasePropertyIds);
                            if (newIds.has(prop.id)) {
                              newIds.delete(prop.id);
                            } else {
                              newIds.add(prop.id);
                            }
                            return { ...prev, equityReleasePropertyIds: newIds };
                          })}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Switch
                                checked={isSelected}
                                onCheckedChange={() => setStrategy(prev => {
                                  const newIds = new Set(prev.equityReleasePropertyIds);
                                  if (newIds.has(prop.id)) newIds.delete(prop.id);
                                  else newIds.add(prop.id);
                                  return { ...prev, equityReleasePropertyIds: newIds };
                                })}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div>
                                <p className="text-sm font-medium">{prop.address?.slice(0, 35) || 'Property'}</p>
                                <p className="text-xs text-muted-foreground">
                                  Value: {formatCurrency(prop.current_value)} · Loan: {formatCurrency(prop.loan_remaining)} · LVR: {lvr.toFixed(0)}%
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-semibold ${equity >= 0 ? 'text-success' : 'text-destructive'}`}>
                                {formatCurrency(equity)}
                              </p>
                              <p className="text-xs text-muted-foreground">equity</p>
                            </div>
                          </div>

                          {/* Per-property Target LVR selector */}
                          {isSelected && (
                            <div className="mt-2 pt-2 border-t border-border/50">
                              <Label className="text-xs text-muted-foreground">Target LVR</Label>
                              <div className="flex gap-1.5 mt-1">
                                {[0.70, 0.80, 0.90].map(lvrOpt => {
                                  const currentTargetLVR = strategy.equityReleaseTargetLVRs.get(prop.id) ?? DEFAULT_EQUITY_LVR;
                                  return (
                                    <button
                                      key={lvrOpt}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setStrategy(prev => {
                                          const newMap = new Map(prev.equityReleaseTargetLVRs);
                                          newMap.set(prop.id, lvrOpt);
                                          return { ...prev, equityReleaseTargetLVRs: newMap };
                                        });
                                      }}
                                      className={`flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors ${
                                        currentTargetLVR === lvrOpt
                                          ? 'bg-primary text-primary-foreground'
                                          : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
                                      }`}
                                    >
                                      {(lvrOpt * 100).toFixed(0)}%
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {strategy.equityReleaseEnabled && equityReleaseProperties.length === 0 && (
                <p className="text-xs text-muted-foreground italic py-2">
                  No properties with recorded values found in the client's portfolio.
                </p>
              )}

              {/* Per-property summaries */}
              {equityReleaseItems.length > 0 && (
                <div className="space-y-3">
                  {equityReleaseItems.map((item) => (
                    <div key={item.property.id} className="p-4 rounded-lg border bg-card space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {item.property.address?.slice(0, 40) || 'Property'}
                      </p>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Property Value</span>
                          <span>{formatCurrency(item.property.current_value)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Current Loan</span>
                          <span>{formatCurrency(item.property.loan_remaining)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Current Equity</span>
                          <span className={`font-medium ${item.currentEquity >= 0 ? 'text-success' : 'text-destructive'}`}>
                            {formatCurrency(item.currentEquity)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Current LVR</span>
                          <span>{item.currentLVR.toFixed(1)}%</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Max Loan at {item.targetLVR}% LVR</span>
                          <span>{formatCurrency(item.maxLoan)}</span>
                        </div>
                        {item.lmiAmount > 0 && (
                          <>
                            <div className="flex justify-between text-brand-600">
                              <span>Gross Accessible Equity</span>
                              <span>{formatCurrency(item.grossAccessibleEquity)}</span>
                            </div>
                            <div className="flex justify-between text-destructive">
                              <span>Less: Est. LMI ({item.lmiEstimate?.estimatedRate.toFixed(2)}%)</span>
                              <span>-{formatCurrency(item.lmiAmount)}</span>
                            </div>
                          </>
                        )}
                        <div className="flex justify-between font-semibold text-success">
                          <span>Net Accessible Equity</span>
                          <span>{formatCurrency(item.accessibleEquity)}</span>
                        </div>
                        {item.lmiAmount > 0 && (
                          <div className="p-2 rounded bg-brand-500/10 border border-brand-500/20 text-xs text-brand-700 dark:text-brand-400 mt-1">
                            ⚠ LVR of {item.targetLVR}% triggers LMI of {formatCurrency(item.lmiAmount)}, reducing usable equity.
                          </div>
                        )}
                      </div>

                      {/* ── Phase 2: Granular Deployment Controls ── */}
                      <div className="pt-3 mt-2 border-t border-border/50 space-y-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Deployment Controls
                        </p>

                        {/* Deployment % slider */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-muted-foreground">
                              Deploy {(item.deploymentPercent * 100).toFixed(0)}% of accessible equity
                            </Label>
                            <span className="text-xs font-medium tabular-nums">
                              {formatCurrency(item.deployedNet)}
                            </span>
                          </div>
                          <Slider
                            value={[item.deploymentPercent * 100]}
                            min={0}
                            max={100}
                            step={5}
                            onValueChange={([val]) => setStrategy(prev => {
                              const next = new Map(prev.equityReleaseDeploymentPercents);
                              next.set(item.property.id, val / 100);
                              return { ...prev, equityReleaseDeploymentPercents: next };
                            })}
                            className="py-1"
                          />
                          <div className="flex justify-between text-[10px] text-muted-foreground">
                            <span>0%</span>
                            <span>50%</span>
                            <span>100%</span>
                          </div>
                        </div>

                        {/* Repayment structure toggle */}
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Repayment Structure (new slice)</Label>
                          <div className="flex gap-1.5">
                            {([
                              { id: 'interest_only' as const, label: 'Interest Only' },
                              { id: 'principal_and_interest' as const, label: 'P&I' },
                            ]).map(opt => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => setStrategy(prev => {
                                  const next = new Map(prev.equityReleaseRepaymentTypes);
                                  next.set(item.property.id, opt.id);
                                  return { ...prev, equityReleaseRepaymentTypes: next };
                                })}
                                className={`flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors ${
                                  item.repaymentType === opt.id
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Manual repayment override */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs text-muted-foreground">
                              Manual Repayment Override
                            </Label>
                            {Number.isFinite(item.manualRepayment as number) && (
                              <button
                                type="button"
                                onClick={() => setStrategy(prev => {
                                  const next = new Map(prev.equityReleaseManualRepayments);
                                  next.delete(item.property.id);
                                  return { ...prev, equityReleaseManualRepayments: next };
                                })}
                                className="text-[10px] text-muted-foreground hover:text-foreground underline"
                              >
                                Reset to auto
                              </button>
                            )}
                          </div>
                          <Input
                            type="number"
                            inputMode="decimal"
                            value={Number.isFinite(item.manualRepayment as number) ? String(item.manualRepayment) : ''}
                            placeholder={`Auto: ${formatCurrency(item.autoMonthlyServicing)}/mo`}
                            onChange={(e) => {
                              const v = e.target.value;
                              setStrategy(prev => {
                                const next = new Map(prev.equityReleaseManualRepayments);
                                if (v === '') next.delete(item.property.id);
                                else {
                                  const num = Number(v);
                                  if (Number.isFinite(num) && num >= 0) next.set(item.property.id, num);
                                }
                                return { ...prev, equityReleaseManualRepayments: next };
                              });
                            }}
                            className="h-8 text-sm"
                          />
                          <p className="text-[10px] text-muted-foreground/70">
                            Auto uses assessment-rate {item.repaymentType === 'interest_only' ? 'IO' : 'P&I'} servicing on the deployed amount.
                          </p>
                        </div>

                        {/* Servicing summary card */}
                        <div className="p-2.5 rounded bg-muted/50 border space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Deployed (net)</span>
                            <span className="font-medium tabular-nums text-success">
                              +{formatCurrency(item.deployedNet)} cash
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Monthly servicing impact</span>
                            <span className="font-medium tabular-nums text-destructive">
                              −{formatCurrency(
                                Number.isFinite(item.manualRepayment as number)
                                  ? (item.manualRepayment as number)
                                  : item.autoMonthlyServicing
                              )}/mo
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Combined total if multiple properties */}
                  {equityReleaseItems.length > 1 && (
                    <div className="p-4 rounded-lg border-2 border-primary/30 bg-primary/5 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Combined Equity Release Summary
                      </p>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Properties Selected</span>
                          <span className="font-medium">{equityReleaseItems.length}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Total Gross Equity</span>
                          <span>{formatCurrency(equityReleaseItems.reduce((s, i) => s + i.grossAccessibleEquity, 0))}</span>
                        </div>
                        {equityReleaseItems.some(i => i.lmiAmount > 0) && (
                          <div className="flex justify-between text-destructive">
                            <span>Total LMI</span>
                            <span>-{formatCurrency(equityReleaseItems.reduce((s, i) => s + i.lmiAmount, 0))}</span>
                          </div>
                        )}
                        <Separator />
                        <div className="flex justify-between font-semibold text-lg text-success">
                          <span>Total Net Accessible Equity</span>
                          <span>{formatCurrency(totalAccessibleEquity)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ═══ LEVER 4: Interest Rate Adjustment ═══ */}
      <Card>
        <Collapsible open={openSections.rates} onOpenChange={() => toggleSection('rates')}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Percent className="h-4 w-4 text-primary" />
                  Interest Rate Adjustment
                </CardTitle>
                <div className="flex items-center gap-2">
                  {strategy.rateAdjustment !== 0 && (
                    <Badge variant={strategy.rateAdjustment < 0 ? 'default' : 'destructive'} className="text-xs">
                      {strategy.rateAdjustment >= 0 ? '+' : ''}{strategy.rateAdjustment.toFixed(2)}%
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections.rates ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <p className="text-xs text-muted-foreground">
                Model how interest rate changes affect borrowing capacity.
              </p>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Base: {baseInputs.interestRate.toFixed(2)}% → Scenario: {(baseInputs.interestRate + strategy.rateAdjustment).toFixed(2)}%
                  </span>
                  <span className={`font-medium ${strategy.rateAdjustment <= 0 ? 'text-success' : 'text-destructive'}`}>
                    {strategy.rateAdjustment >= 0 ? '+' : ''}{strategy.rateAdjustment.toFixed(2)}%
                  </span>
                </div>
                <Slider
                  value={[strategy.rateAdjustment]}
                  onValueChange={([val]) => setStrategy(prev => ({ ...prev, rateAdjustment: val }))}
                  min={-2}
                  max={3}
                  step={0.25}
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>-2%</span>
                  <span>+3%</span>
                </div>
              </div>
              <div className="flex gap-2">
                {[-1, -0.5, 0, 0.5, 1, 2].map(delta => (
                  <button
                    key={delta}
                    onClick={() => setStrategy(prev => ({ ...prev, rateAdjustment: delta }))}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                      strategy.rateAdjustment === delta
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary hover:bg-secondary/80 text-secondary-foreground'
                    }`}
                  >
                    {delta >= 0 ? '+' : ''}{delta}%
                  </button>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>


      {/* ═══ LEVERS 5-10: Additional Strategy Levers ═══ */}
      <AdditionalStrategyLevers
        strategy={strategy.additional}
        onStrategyChange={handleAdditionalChange}
        openSections={openSections}
        onToggleSection={toggleSection}
        baseLoanTermYears={baseInputs.loanTermYears}
        properties={properties.map(p => ({
          id: p.id,
          address: p.address,
          current_value: p.current_value,
          loan_remaining: p.loan_remaining,
        }))}
        baseGrossIncome={baseInputs.grossAnnualIncome}
      />

      {/* ═══ PHASE K2 — Capital Flow Canvas ═══ */}
      {(() => {
        const ledgerPool = capitalLedger?.pools?.['pool-default'];
        const ledgerSources = ledgerPool?.sources ?? [];
        // Prefer ledger truth (post-engine). Fall back to deployed equity + cash on hand for pre-allocation rendering.
        const fallbackEquity = totalAccessibleEquity || 0;
        const fallbackCash = acquisition.enabled ? (acquisition.cashOnHand || 0) : 0;
        const pool = ledgerSources.length > 0
          ? {
              poolTotal: ledgerPool!.totalIn,
              sources: ledgerSources.map(s => ({ label: s.label, amount: s.amount, type: s.sourceType })),
            }
          : {
              poolTotal: fallbackEquity + fallbackCash,
              sources: [
                ...(fallbackEquity > 0 ? [{ label: 'Equity release (deployed)', amount: fallbackEquity, type: 'equity_release' }] : []),
                ...(fallbackCash > 0 ? [{ label: 'Cash on hand', amount: fallbackCash, type: 'cash_on_hand' }] : []),
              ],
            };
        const flowTargets = {
          liabilities: liabilities.map(l => ({
            id: l.id,
            label: l.label,
            balance: l.balance,
            monthlyServicing: l.monthlyServicing,
          })),
          properties: properties.map(p => ({
            id: p.id,
            address: p.address,
            loanRemaining: p.loan_remaining,
            interestRate: p.interest_rate,
          })),
        };
        return (
          <CapitalFlowCanvas
            pool={pool}
            targets={flowTargets}
            allocations={capitalAllocations}
            onAllocationsChange={setCapitalAllocations}
            ledger={capitalLedger}
          />
        );
      })()}

      {/* ═══ Quick Scenario Presets ═══ */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Quick Presets</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const allIds = new Set(consolidatableDebts.map(d => d.id));
              setStrategy(prev => ({ ...prev, consolidatedLiabilities: allIds }));
            }}
          >
            <CreditCard className="h-3.5 w-3.5 mr-1.5" />
            Pay Off All Debt
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const allIds = new Set(investmentProperties.map(p => p.id));
              setStrategy(prev => ({ ...prev, refinancedToIO: allIds }));
            }}
          >
            <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
            All Loans to IO
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStrategy(prev => ({ ...prev, rateAdjustment: 2 }))}
          >
            <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
            Rates +2%
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStrategy(prev => ({
              ...prev,
              additional: { ...prev.additional, incomeGrowthPercent: 10 },
            }))}
          >
            <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
            10% Raise
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const allDebts = new Set(consolidatableDebts.map(d => d.id));
              const allIO = new Set(investmentProperties.map(p => p.id));
              setStrategy(prev => ({
                ...prev,
                consolidatedLiabilities: allDebts,
                refinancedToIO: allIO,
                additional: { ...prev.additional, expenseReductionPercent: 15 },
              }));
            }}
          >
            <Zap className="h-3.5 w-3.5 mr-1.5" />
            Maximum Strategy
          </Button>
        </div>
      </div>

      {/* ═══ PHASE 2 — Acquisition / Purchase-Power Controls ═══ */}
      <Card>
        <Collapsible open={openSections.acquisition} onOpenChange={() => toggleSection('acquisition')}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  Acquisition / Purchase Power
                  <Badge variant="outline" className="text-[10px]">Phase 2</Badge>
                </CardTitle>
                <div className="flex items-center gap-2">
                  {acquisition.enabled && acquisitionCapacity && (
                    <Badge variant={acquisitionCapacity.meetsTarget === false ? 'destructive' : 'secondary'} className="text-xs">
                      {acquisitionCapacity.targetPurchasePrice
                        ? acquisitionCapacity.meetsTarget ? 'Target met' : `Short ${formatCurrency(acquisitionCapacity.shortfallToTarget || 0)}`
                        : `${formatCurrency(acquisitionCapacity.maxPurchasePrice)} power`}
                    </Badge>
                  )}
                  <ChevronDown className={`h-4 w-4 transition-transform ${openSections.acquisition ? 'rotate-180' : ''}`} />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Model next purchase</Label>
                  <p className="text-xs text-muted-foreground">Adds stamp duty, LMI, cash-on-hand, and target-price feasibility to the scenario.</p>
                </div>
                <Switch
                  checked={acquisition.enabled}
                  onCheckedChange={(checked) => setAcquisition(prev => ({ ...prev, enabled: checked }))}
                />
              </div>

              {acquisition.enabled && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Target purchase price</Label>
                      <Input
                        type="number"
                        min="0"
                        step="10000"
                        value={acquisition.targetPurchasePrice || ''}
                        placeholder="e.g. 750000"
                        onChange={(e) => setAcquisition(prev => ({ ...prev, targetPurchasePrice: Math.max(0, Number(e.target.value) || 0) }))}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Cash on hand</Label>
                      <Input
                        type="number"
                        min="0"
                        step="5000"
                        value={acquisition.cashOnHand || ''}
                        placeholder="Cash available for deposit/costs"
                        onChange={(e) => setAcquisition(prev => ({ ...prev, cashOnHand: Math.max(0, Number(e.target.value) || 0) }))}
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">State</Label>
                      <Select value={acquisition.state} onValueChange={(v) => setAcquisition(prev => ({ ...prev, state: v as AustralianState }))}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT'] as AustralianState[]).map(state => (
                            <SelectItem key={state} value={state}>{state}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Intent</Label>
                      <Select value={acquisition.intent} onValueChange={(v) => setAcquisition(prev => ({ ...prev, intent: v as PurchaseIntent }))}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="investor">Investor</SelectItem>
                          <SelectItem value="owner_occupier">Owner occupier</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Property</Label>
                      <Select value={acquisition.category} onValueChange={(v) => setAcquisition(prev => ({ ...prev, category: v as PropertyCategory }))}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="established">Established</SelectItem>
                          <SelectItem value="new">New build</SelectItem>
                          <SelectItem value="vacant_land">Vacant land</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">LMI treatment</Label>
                      <Select value={acquisition.lmiMode} onValueChange={(v) => setAcquisition(prev => ({ ...prev, lmiMode: v as AcquisitionState['lmiMode'] }))}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="display_deduction">Deduct from cash</SelectItem>
                          <SelectItem value="debt_capitalised">Capitalise</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <Label className="text-sm">First home buyer</Label>
                      <Switch checked={acquisition.isFirstHomeBuyer} onCheckedChange={(checked) => setAcquisition(prev => ({ ...prev, isFirstHomeBuyer: checked }))} />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <Label className="text-sm">Foreign buyer</Label>
                      <Switch checked={acquisition.isForeignBuyer} onCheckedChange={(checked) => setAcquisition(prev => ({ ...prev, isForeignBuyer: checked }))} />
                    </div>
                  </div>

                  {acquisitionCapacity && (
                    <div className="rounded-lg border bg-primary/5 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Effective purchase power</p>
                          <p className="text-2xl font-bold text-primary">{formatCurrency(acquisitionCapacity.maxPurchasePrice)}</p>
                        </div>
                        {acquisitionCapacity.targetPurchasePrice && (
                          <Badge variant={acquisitionCapacity.meetsTarget ? 'default' : 'destructive'}>
                            {acquisitionCapacity.meetsTarget ? 'Target achievable' : `Short ${formatCurrency(acquisitionCapacity.shortfallToTarget || 0)}`}
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div><span className="text-muted-foreground">Loan available</span><p className="font-medium">{formatCurrency(acquisitionCapacity.loanAvailableForPurchase)}</p></div>
                        <div><span className="text-muted-foreground">Cash available</span><p className="font-medium">{formatCurrency(acquisitionCapacity.cashAvailable)}</p></div>
                        <div><span className="text-muted-foreground">Stamp duty</span><p className="font-medium">{formatCurrency(acquisitionCapacity.stampDuty)}</p></div>
                        <div><span className="text-muted-foreground">LMI</span><p className="font-medium">{formatCurrency(acquisitionCapacity.lmi)}</p></div>
                      </div>
                      {acquisitionCapacity.targetPurchasePrice && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div><span className="text-muted-foreground">Loan required</span><p className="font-medium">{formatCurrency(acquisitionCapacity.loanRequiredForPurchase || 0)}</p></div>
                          <div><span className="text-muted-foreground">Net cash after settlement</span><p className={`font-medium ${(acquisitionCapacity.netCashAfterSettlement || 0) >= 0 ? 'text-success' : 'text-destructive'}`}>{formatCurrency(acquisitionCapacity.netCashAfterSettlement || 0)}</p></div>
                        </div>
                      )}
                      {(acquisitionCapacity.notes ?? []).length > 0 && (
                        <ul className="space-y-1 text-[11px] text-muted-foreground">
                          {(acquisitionCapacity.notes ?? []).slice(-3).map((note, idx) => <li key={idx}>• {note}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* ═══ IMPACT SUMMARY ═══ */}

      <Card className={`border-2 ${
        capacityChange > 0 ? 'border-success/30 bg-success/5' :
        capacityChange < 0 ? 'border-destructive/30 bg-destructive/5' :
        'border-border'
      }`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            Compound Impact Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* F3 + F4 — Effective Purchase Power headline + per-lever waterfall */}
          <PurchasePowerHeadline
            baseCapacity={baseResult.borrowingCapacity}
            scenarioCapacity={scenarioResult.borrowingCapacity}
            acquisitionCapacity={acquisition.enabled ? acquisitionCapacity : null}
            leverAttribution={leverAttribution}
            formatCurrency={formatCurrency}
            baseTheoreticalCapacity={baseTheoreticalCapacity}
            scenarioTheoreticalCapacity={scenarioTheoreticalCapacity}
            baseRawSurplus={baseRawSurplus}
            scenarioRawSurplus={scenarioRawSurplus}
            floorActive={floorActive}
          />

          {/* Phase 4 — Live Math Inspector (capacity waterfall audit trail) */}
          <CapacityMathInspector
            baseAfterTaxIncome={baseAfterTaxIncome}
            baseLivingExpenses={baseLivingExpenses}
            baseCommitments={baseCommitments}
            baseRawSurplus={baseRawSurplus}
            baseAssessmentRate={baseAssessmentRate}
            baseTermYears={baseTerm}
            baseAnnuityFactor={baseAnnuity}
            baseTheoreticalCapacity={baseTheoreticalCapacity}
            baseDisplayedCapacity={baseResult.borrowingCapacity}
            scenarioAfterTaxIncome={scenarioAfterTaxIncome}
            scenarioLivingExpenses={scenarioLivingExpenses}
            scenarioCommitments={scenarioCommitments}
            scenarioRawSurplus={scenarioRawSurplus}
            scenarioAssessmentRate={scenarioAssessmentRate}
            scenarioTermYears={scenarioTerm}
            scenarioAnnuityFactor={scenarioAnnuity}
            scenarioTheoreticalCapacity={scenarioTheoreticalCapacity}
            scenarioDisplayedCapacity={scenarioResult.borrowingCapacity}
            formatCurrency={formatCurrency}
          />

          {/* F5 + F6 — Strategy rationale (finance-ready) with PDF export */}
          <StrategyRationalePanel
            report={buildStrategyRationale({
              baseCapacity: baseResult.borrowingCapacity,
              scenarioCapacity: scenarioResult.borrowingCapacity,
              deltas: appliedDeltas,
              leverAttribution,
              acquisitionCapacity: acquisition.enabled ? acquisitionCapacity : null,
              formatCurrency,
              capitalLedger,
            })}
            formatCurrency={formatCurrency}
            pdfContext={clientName ? {
              clientName,
              baseCapacity: baseResult.borrowingCapacity,
              scenarioCapacity: scenarioResult.borrowingCapacity,
              effectivePurchasePower: acquisition.enabled && acquisitionCapacity ? acquisitionCapacity.maxPurchasePrice : null,
              targetPurchasePrice: acquisition.enabled && acquisitionCapacity?.targetPurchasePrice ? acquisitionCapacity.targetPurchasePrice : null,
              meetsTarget: acquisition.enabled && acquisitionCapacity ? (acquisitionCapacity.meetsTarget ?? null) : null,
              valuationAssumptions: strategy.additional.valuationOverrides.size > 0
                ? Array.from(strategy.additional.valuationOverrides.values()).map(v => {
                    const prop = properties.find(p => p.id === v.propertyId);
                    return {
                      address: prop?.address || v.propertyId,
                      originalValue: prop?.current_value || 0,
                      newValue: v.newValue,
                      basis: v.basis,
                      source: v.source,
                    };
                  })
                : undefined,
              crossCollatPool: strategy.additional.crossCollatPool.enabled && strategy.additional.crossCollatPool.propertyIds.size > 0
                ? (() => {
                    const memberIds = Array.from(strategy.additional.crossCollatPool.propertyIds);
                    const members = memberIds.map(id => properties.find(p => p.id === id)).filter(Boolean) as PropertyItem[];
                    const overrides = strategy.additional.valuationOverrides;
                    const totalPoolValue = members.reduce((s, m) => s + (overrides.get(m.id)?.newValue ?? m.current_value), 0);
                    const totalPoolDebt = members.reduce((s, m) => s + (m.loan_remaining || 0), 0);
                    const targetTotalDebt = totalPoolValue * strategy.additional.crossCollatPool.blendedTargetLVR;
                    const poolReleaseAmount = Math.max(0, targetTotalDebt - totalPoolDebt);
                    return {
                      enabled: true,
                      propertyAddresses: members.map(m => m.address || m.id),
                      blendedTargetLVR: strategy.additional.crossCollatPool.blendedTargetLVR,
                      lenderMaxLVR: strategy.additional.crossCollatPool.lenderMaxLVR,
                      allocationStrategy: strategy.additional.crossCollatPool.allocationStrategy,
                      totalPoolValue,
                      totalPoolDebt,
                      poolReleaseAmount,
                    };
                  })()
                : null,
            } : undefined}
          />

          {impactBreakdown.length > 0 && (
            <div className="space-y-2">
              {impactBreakdown.map((impact, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className={`h-3.5 w-3.5 ${
                      impact.type === 'saving' ? 'text-success' :
                      impact.type === 'cost' ? 'text-destructive' :
                      'text-muted-foreground'
                    }`} />
                    {impact.label}
                  </span>
                  {impact.type !== 'info' && (
                    <span className={`font-medium ${impact.type === 'saving' ? 'text-success' : 'text-destructive'}`}>
                      {impact.type === 'saving' ? '+' : '-'}{formatCurrency(impact.monthlySaving)}/mo
                    </span>
                  )}
                </div>
              ))}
              {totalMonthlySaving !== 0 && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between text-sm font-semibold">
                    <span>Total Monthly Cash Flow Impact</span>
                    <span className={totalMonthlySaving >= 0 ? 'text-success' : 'text-destructive'}>
                      {totalMonthlySaving >= 0 ? '+' : ''}{formatCurrency(totalMonthlySaving)}/mo
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {totalAccessibleEquity > 0 && (
            <div className="flex items-center justify-between text-sm p-2 rounded bg-muted/50">
              <span className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                Equity Accessible ({equityReleaseItems.length} propert{equityReleaseItems.length !== 1 ? 'ies' : 'y'})
              </span>
              <span className="font-semibold text-primary">{formatCurrency(totalAccessibleEquity)}</span>
            </div>
          )}

          {/* Before → After comparison
              When the engine is clamped at the $0 servicing floor we show the
              true (negative) theoretical capacity so the team isn't misled by
              the displayed $0. */}
          {(() => {
            const baseShowTrue = floorActive && baseTheoreticalCapacity < baseResult.borrowingCapacity;
            const scenarioShowTrue = floorActive && scenarioTheoreticalCapacity < scenarioResult.borrowingCapacity;
            const baseDisplayValue = baseShowTrue ? baseTheoreticalCapacity : baseResult.borrowingCapacity;
            const scenarioDisplayValue = scenarioShowTrue ? scenarioTheoreticalCapacity : scenarioResult.borrowingCapacity;
            const trueCapacityChange = scenarioDisplayValue - baseDisplayValue;
            return (
              <div className="grid grid-cols-3 gap-3 items-start pt-2">
                <div className="text-center p-3 rounded-lg bg-secondary/30 space-y-2">
                  <p className="text-xs text-muted-foreground mb-1">CURRENT</p>
                  <p className={`text-lg font-bold ${baseShowTrue ? 'text-destructive' : ''}`}>
                    {baseShowTrue ? formatCapacity(baseDisplayValue) : formatCapacity(baseResult.borrowingCapacity)}
                  </p>
                  {baseShowTrue && (
                    <p className="text-[10px] text-muted-foreground -mt-1">
                      true position · engine shows {formatCapacity(baseResult.borrowingCapacity)}
                    </p>
                  )}
                  <Badge className="text-xs" style={{ backgroundColor: baseBand.bg === 'bg-success/10' ? '#10b981' : baseBand.bg === 'bg-brand-500/10' ? '#f59e0b' : '#ef4444', color: 'white' }}>
                    {baseBand.label}
                  </Badge>
                  <BindingConstraintBadge
                    inputs={baseInputs}
                    result={baseResult}
                    analysis={baseBinding}
                    variant="compact"
                    className="w-full justify-center"
                  />
                </div>

                <div className="text-center pt-3">
                  <div className="flex items-center justify-center mb-1">
                    {trueCapacityChange > 0 && <TrendingUp className="h-5 w-5 text-success" />}
                    {trueCapacityChange < 0 && <TrendingDown className="h-5 w-5 text-destructive" />}
                    {trueCapacityChange === 0 && <Minus className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <p className={`text-lg font-bold ${
                    trueCapacityChange > 0 ? 'text-success' : trueCapacityChange < 0 ? 'text-destructive' : 'text-muted-foreground'
                  }`}>
                    {trueCapacityChange !== 0 ? (
                      <>{trueCapacityChange > 0 ? '+' : ''}{formatCapacity(trueCapacityChange)}</>
                    ) : 'No Change'}
                  </p>
                  {trueCapacityChange !== 0 && Math.abs(baseDisplayValue) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      ({((trueCapacityChange / Math.abs(baseDisplayValue)) * 100).toFixed(1)}%)
                    </p>
                  )}
                  {/* Wall-shift indicator: did the binding constraint change? */}
                  {baseBinding.binding !== scenarioBinding.binding && (
                    <p className="text-[10px] text-primary mt-1 leading-tight">
                      Wall shifted:<br />
                      {baseBinding.bindingLabel} → {scenarioBinding.bindingLabel}
                    </p>
                  )}
                </div>

                <div className={`text-center p-3 rounded-lg border-2 space-y-2 ${
                  trueCapacityChange > 0 ? 'bg-success/10 border-success/30' :
                  trueCapacityChange < 0 ? 'bg-destructive/10 border-destructive/30' :
                  'bg-secondary/30 border-secondary'
                }`}>
                  <p className="text-xs text-muted-foreground mb-1">SCENARIO</p>
                  <p className={`text-lg font-bold ${scenarioShowTrue ? 'text-destructive' : ''}`}>
                    {scenarioShowTrue ? formatCapacity(scenarioDisplayValue) : formatCapacity(scenarioResult.borrowingCapacity)}
                  </p>
                  {scenarioShowTrue && (
                    <p className="text-[10px] text-muted-foreground -mt-1">
                      true position · engine shows {formatCapacity(scenarioResult.borrowingCapacity)}
                    </p>
                  )}
                  <Badge className="text-xs" style={{ backgroundColor: scenarioBand.bg === 'bg-success/10' ? '#10b981' : scenarioBand.bg === 'bg-brand-500/10' ? '#f59e0b' : '#ef4444', color: 'white' }}>
                    {scenarioBand.label}
                  </Badge>
                  <BindingConstraintBadge
                    inputs={scenarioInputs}
                    result={scenarioResult}
                    analysis={scenarioBinding}
                    variant="compact"
                    className="w-full justify-center"
                  />
                </div>
              </div>
            );
          })()}

          {/* Binding-constraint breakdown — explains WHY the lever moved (or didn't) */}
          <BindingConstraintBadge
            inputs={scenarioInputs}
            result={scenarioResult}
            analysis={scenarioBinding}
            variant="expanded"
          />

          {/* Monthly Surplus */}
          <div className="p-3 rounded-lg bg-secondary/30">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Monthly Surplus</span>
              <span className={`font-medium ${surplusChange >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatCurrency(baseResult.monthlySurplus)} → {formatCurrency(scenarioResult.monthlySurplus)}
                <span className="ml-1 text-xs">
                  ({surplusChange >= 0 ? '+' : ''}{formatCurrency(surplusChange)})
                </span>
              </span>
            </div>
          </div>

          {!hasAnyStrategy && (
            <p className="text-xs text-muted-foreground text-center py-2 italic">
              Toggle strategies above to see their compound impact on borrowing capacity.
            </p>
          )}

          {validationIssues.length > 0 && (
            <div className={`p-3 rounded-lg border space-y-2 ${hasBlockingValidationIssues ? 'bg-destructive/10 border-destructive/30' : 'bg-brand-500/10 border-brand-500/30'}`}>
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className={`h-4 w-4 ${hasBlockingValidationIssues ? 'text-destructive' : 'text-brand-600'}`} />
                Scenario validation {hasBlockingValidationIssues ? 'requires action' : 'notes'}
              </div>
              <ul className="space-y-1 text-xs">
                {validationIssues.map((issue, idx) => (
                  <li key={`${issue.deltaId}-${idx}`} className={issue.severity === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
                    <span className="font-medium uppercase">{issue.severity}</span>: {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Save & Apply Actions */}
          {hasAnyStrategy && (
            <div className="space-y-2 pt-2">
              <Separator />
              {showSaveInput ? (
                <div className="flex gap-2">
                  <Input
                    value={scenarioName}
                    onChange={(e) => setScenarioName(e.target.value)}
                    placeholder="Scenario name..."
                    className="h-9 text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
                  />
                  <Button size="sm" onClick={handleSavePreset} disabled={hasBlockingValidationIssues}>
                    <Save className="h-3.5 w-3.5 mr-1" />
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowSaveInput(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setShowSaveInput(true)}
                  >
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    Save Scenario
                  </Button>
                  {onApplyScenario && (
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={hasBlockingValidationIssues}
                      onClick={() => {
                        if (hasBlockingValidationIssues) {
                          toast.error('Resolve blocking scenario validation errors before applying.');
                          return;
                        }
                        try {
                          const name = scenarioName.trim() || 'Current What-If Scenario';
                          const createdAt = new Date().toISOString();
                          onApplyScenario(scenarioInputs, totalAccessibleEquity, {
                            id: `applied-${Date.now()}`,
                            name,
                            isBase: false,
                            createdAt,
                            adjustedInputs: { ...scenarioInputs },
                            result: scenarioResult,
                            accessibleEquity: totalAccessibleEquity,
                            acquisitionCapacity: acquisition.enabled ? acquisitionCapacity : null,
                            scenarioDeltas: appliedDeltas,
                            validationIssues,
                            capitalLedger,
                            capitalAllocations: [...capitalAllocations],
                            acquisition,
                            replayAudit: buildReplayAudit(name, createdAt),
                            incomeComponents,
                            currentLenderProfileId,
                            hemBenchmark,
                          });
                        } catch (err: any) {
                          console.error('[StrategyScenarioModeling] Apply scenario failed:', err);
                          toast.error(err?.message || 'Failed to apply scenario');
                        }
                      }}
                    >
                      <Zap className="h-3.5 w-3.5 mr-1.5" />
                      Apply to Calculator
                    </Button>
                  )}
                  {clientId && (
                    <SnapshotDownloadButton
                      className="flex-1"
                      variant="secondary"
                      size="sm"
                      disabled={hasBlockingValidationIssues}
                      label="Export PDF"
                      legacyLabel="Export PDF (live what-if)"
                      legacyHint="Draws the unsaved inputs as the base assessment"
                      request={() => ({
                        clientId: clientId!,
                        clientName: clientName || 'Client',
                        scenarioPresets: buildScenarioPresetsForExport(),
                      })}
                      legacy={async () => {
                        const result = await fetchAndGenerateBorrowingCapacityPDF(
                          clientId,
                          clientName || 'Client',
                          buildScenarioPresetsForExport(),
                          {
                            assessment: buildPdfOverrideAssessment(scenarioInputs, scenarioResult),
                            liabilities,
                            properties,
                          },
                          { returnBlob: true },
                        );
                        return result;
                      }}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ SAVED PRESETS ═══ */}
      {(presets?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-primary" />
              Saved Scenarios ({presets?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(presets ?? []).map(preset => {
              const drift = presetDriftById.get(preset.id);
              return (
              <div
                key={preset.id}
                className={`flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors ${drift?.isStale ? 'border-brand-500/40 bg-brand-500/5' : ''}`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{preset.name}</p>
                    {preset.replayAudit?.schemaVersion === 2 && <Badge variant="outline" className="text-[10px]">Replay v2</Badge>}
                    {preset.acquisition?.enabled && <Badge variant="secondary" className="text-[10px]">Acquisition</Badge>}
                    {drift?.isStale && <Badge variant="warning" className="text-[10px]">Stale base data</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Capacity: {formatCapacity(preset.result.borrowingCapacity)}
                    {!preset.isBase && ` · Saved ${new Date(preset.createdAt).toLocaleDateString('en-AU')}`}
                    {preset.replayAudit?.baseAssessmentId && ` · Base ${preset.replayAudit.baseAssessmentId.slice(0, 8)}`}
                  </p>
                  {drift?.isStale && (
                    <p className="text-[11px] text-brand-700 dark:text-brand-400">
                      Base data changed: {drift.changed.filter(k => k !== 'combined').join(', ')}. Load as historical snapshot or re-save after review.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {onApplyScenario && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => handleLoadPreset(preset)}
                    >
                      Load
                    </Button>
                  )}
                  {!preset.isBase && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7 text-destructive hover:text-destructive"
                      onClick={() => handleDeletePreset(preset.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
