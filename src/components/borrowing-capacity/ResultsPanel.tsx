import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AuditTrailPanel } from './AuditTrailPanel';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { 
  Collapsible, 
  CollapsibleContent, 
  CollapsibleTrigger 
} from '@/components/ui/collapsible';
import {
  DollarSign,
  TrendingUp,
  Shield,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  Lightbulb,
  Info,
  Receipt,
  ShieldAlert,
} from 'lucide-react';
import { SnapshotDownloadButton } from './SnapshotDownloadButton';
import { fetchAndGenerateBorrowingCapacityPDF } from './BorrowingCapacityPDFReport';
import type { ScenarioPreset } from './scenarios/StrategyScenarioModeling';
import { useState, useMemo } from 'react';
import type { FullAssessmentResult, ServiceabilityBand, CalculationMode, TaxBreakdown } from '@/utils/borrowingCapacityCalculations';
import { getTaxBreakdown } from '@/utils/borrowingCapacityCalculations';
import type { LmiMode, LmiEstimate } from '@/utils/lmiCalculations';
import { formatLmiMode, calculateLmiImpact } from '@/utils/lmiCalculations';

interface ResultsPanelProps {
  result: FullAssessmentResult | null;
  isCalculating?: boolean;
  calculationMode?: CalculationMode;
  dtiCapEnabled?: boolean;
  dtiCapLimit?: number;
  clientId?: string;
  clientName?: string;
  proposedLoanAmount?: number;
  interestRate?: number;
  bufferRate?: number;
  loanTermYears?: number;
  lmiMode?: LmiMode;
  lmiEstimate?: LmiEstimate | null;
  scenarioPresets?: ScenarioPreset[];
  activeScenarioName?: string | null;
  /** Accessible equity from equity release lever (informational capital) */
  accessibleEquity?: number;
}

export function ResultsPanel({ result, isCalculating, calculationMode = 'bank', dtiCapEnabled, dtiCapLimit, clientId, clientName, proposedLoanAmount, interestRate, bufferRate, loanTermYears, lmiMode = 'none', lmiEstimate, scenarioPresets, activeScenarioName, accessibleEquity = 0 }: ResultsPanelProps) {
  const [showRecommendations, setShowRecommendations] = useState(true);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showTaxBreakdown, setShowTaxBreakdown] = useState(false);
  const [showAdvancedCapacity, setShowAdvancedCapacity] = useState(false);

  // Proposed loan serviceability check — prefer engine-provided result, fall back to local calc
  const proposedLoanCheck = useMemo(() => {
    // Use engine-provided three-output check if available
    if (result?.proposedLoanCheck) {
      return {
        monthlyRepayment: result.proposedLoanCheck.monthlyRepayment,
        isServiceable: result.proposedLoanCheck.isServiceable,
        headroom: result.proposedLoanCheck.headroom,
        utilizationPercent: result.proposedLoanCheck.utilizationPercent,
        dtiWithProposedLoan: result.proposedLoanCheck.dtiWithProposedLoan,
        projectedBand: result.proposedLoanCheck.projectedBand,
      };
    }
    // Fallback: compute locally for backward compat
    if (!result || !proposedLoanAmount || proposedLoanAmount <= 0) return null;
    const assessmentRate = (interestRate || 6.5) + (bufferRate ?? 3);
    const monthlyRate = (assessmentRate / 100) / 12;
    const periods = (loanTermYears || 30) * 12;
    const monthlyRepayment = proposedLoanAmount * (monthlyRate * Math.pow(1 + monthlyRate, periods)) 
                              / (Math.pow(1 + monthlyRate, periods) - 1);
    const isServiceable = result.borrowingCapacity >= proposedLoanAmount;
    const headroom = result.borrowingCapacity - proposedLoanAmount;
    return {
      monthlyRepayment: Math.round(monthlyRepayment),
      isServiceable,
      headroom,
      utilizationPercent: result.borrowingCapacity > 0 
        ? Math.min(Math.round((proposedLoanAmount / result.borrowingCapacity) * 100), 100)
        : 0,
    };
  }, [result, proposedLoanAmount, interestRate, bufferRate, loanTermYears]);

  // Tax breakdown — prefer the engine's own breakdown (assessable/shaded basis)
  // so the displayed tax matches what serviceability actually used.
  // Fall back to a local computation on SHADED income (not gross) so the audit
  // row and this card stay aligned with the engine's after-tax figure.
  const taxBreakdown: (TaxBreakdown & { monthlyTakeHome: number }) | null = useMemo(() => {
    if (!result) return null;
    // Engine-provided breakdown is the source of truth
    const engine = (result as any).taxBreakdown;
    if (engine && typeof engine.afterTaxIncome === 'number') {
      return {
        grossIncome: result.shadedAnnualIncome ?? result.grossAnnualIncome ?? 0,
        taxPayable: engine.taxPayable ?? 0,
        medicareLevy: engine.medicareLevy ?? 0,
        totalTax: engine.totalTax ?? 0,
        afterTaxIncome: engine.afterTaxIncome ?? 0,
        effectiveTaxRate: engine.effectiveTaxRate ?? 0,
        marginalTaxRate: engine.marginalTaxRate ?? 0,
        marginalBracket: engine.marginalBracket ?? '',
        monthlyTakeHome: engine.monthlyTakeHome ?? Math.round((engine.afterTaxIncome ?? 0) / 12),
      };
    }
    // Fallback: compute locally on SHADED income (the assessable basis)
    const basis = result.shadedAnnualIncome ?? result.grossAnnualIncome ?? 0;
    if (!basis) return null;
    const tb = getTaxBreakdown(basis);
    return { ...tb, monthlyTakeHome: Math.round(tb.afterTaxIncome / 12) };
  }, [result]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getBandConfig = (band: ServiceabilityBand) => {
    switch (band) {
      case 'green':
        return {
          bgColor: 'bg-success',
          textColor: 'text-success',
          bgLight: 'bg-success/10',
          borderColor: 'border-success/30',
          icon: CheckCircle,
          label: 'GREEN',
          message: 'Strong borrowing position',
        };
      case 'amber':
        return {
          bgColor: 'bg-warning',
          textColor: 'text-warning',
          bgLight: 'bg-warning/10',
          borderColor: 'border-warning/30',
          icon: AlertTriangle,
          label: 'AMBER',
          message: 'Moderate capacity - proceed with caution',
        };
      case 'red':
      default:
        return {
          bgColor: 'bg-destructive',
          textColor: 'text-destructive',
          bgLight: 'bg-destructive/10',
          borderColor: 'border-destructive/30',
          icon: AlertTriangle,
          label: 'RED',
          message: 'Limited capacity - focus on debt reduction',
        };
    }
  };

  // ── True (unfloored) capacity ─────────────────────────────────────────
  // The engine clamps `borrowingCapacity` at $0 when surplus is negative
  // (APRA-aligned lendable figure). For internal transparency we surface the
  // *theoretical* position derived from the actual (signed) monthly surplus
  // using the same annuity formula the scenario inspector uses.
  const theoreticalCapacity = useMemo(() => {
    if (!result) return 0;
    const rate = result.assessmentRate ?? ((interestRate ?? 6.5) + (bufferRate ?? 3));
    const term = loanTermYears ?? 30;
    const r = (rate / 100) / 12;
    const n = term * 12;
    if (r <= 0 || n <= 0) return result.borrowingCapacity;
    const factor = (1 - Math.pow(1 + r, -n)) / r;
    return Math.round(result.monthlySurplus * factor);
  }, [result, interestRate, bufferRate, loanTermYears]);

  if (!result) {
    return (
      <Card className="h-full">
        <CardContent className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
          <DollarSign className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground">No Calculation Yet</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs">
            Click "Calculate" to assess borrowing capacity based on client data.
          </p>
        </CardContent>
      </Card>
    );
  }

  const recommendations = Array.isArray(result.recommendations) ? result.recommendations : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const stressTestedCapacity = typeof result.stressTestedCapacity === 'number'
    ? result.stressTestedCapacity
    : result.borrowingCapacity;
  // Guard numerics used with `.toFixed()` — a scenario/preset result applied to
  // the calculator may omit these, and an undefined `.toFixed()` would crash the
  // whole panel render.
  const safeDtiRatio = typeof result.dtiRatio === 'number' && Number.isFinite(result.dtiRatio)
    ? result.dtiRatio
    : 0;
  const safeAssessmentRate = typeof result.assessmentRate === 'number' && Number.isFinite(result.assessmentRate)
    ? result.assessmentRate
    : (interestRate ?? 6.5) + (bufferRate ?? 3);

  const bandConfig = getBandConfig(result.serviceabilityBand);
  const BandIcon = bandConfig.icon;
  const capacityProgress = Math.min(100, (Math.max(0, result.borrowingCapacity) / 1500000) * 100);

  // Engine has floored a negative true position to $0.
  const floorActive = result.borrowingCapacity <= 0 && result.monthlySurplus < 0;
  const displayedCapacity = floorActive && showAdvancedCapacity ? theoreticalCapacity : result.borrowingCapacity;


  return (
    <Card className="h-full">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Results
          </CardTitle>
          {clientId && (
            <SnapshotDownloadButton
              request={{ clientId, clientName: clientName || 'Client', scenarioPresets }}
              legacy={() => fetchAndGenerateBorrowingCapacityPDF(
                clientId, clientName || 'Client', scenarioPresets, undefined, { returnBlob: true },
              )}
              label="Export PDF"
            />
          )}
        </div>

        {/* Proposed Loan Serviceability Check */}
        {proposedLoanCheck && (
          <div className={`p-4 rounded-lg border-2 ${
            proposedLoanCheck.isServiceable 
              ? 'border-success/30 bg-success/5' 
              : 'border-destructive/30 bg-destructive/5'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">PROPOSED LOAN CHECK</p>
              <Badge className={proposedLoanCheck.isServiceable ? 'bg-success text-foreground dark:text-white' : 'bg-destructive text-foreground dark:text-white'}>
                {proposedLoanCheck.isServiceable ? '✅ Serviceable' : '❌ Not Serviceable'}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Proposed Loan</p>
                <p className="font-semibold">{formatCurrency(proposedLoanAmount!)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Est. Repayment</p>
                <p className="font-semibold">{formatCurrency(proposedLoanCheck.monthlyRepayment)}/mo</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Headroom</p>
                <p className={`font-semibold ${proposedLoanCheck.headroom >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {proposedLoanCheck.headroom >= 0 ? '+' : ''}{formatCurrency(proposedLoanCheck.headroom)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Utilization</p>
                <p className="font-semibold">{proposedLoanCheck.utilizationPercent}%</p>
              </div>
            </div>
            <Progress 
              value={Math.min(proposedLoanCheck.utilizationPercent, 100)} 
              className="h-2 mt-3"
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* LMI Impact Section */}
        {lmiMode !== 'none' && lmiEstimate && lmiEstimate.lmiAmount > 0 && result && (
          <div className="p-4 rounded-lg border-2 border-warning/30 bg-warning/5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground">LENDERS MORTGAGE INSURANCE</p>
              <Badge variant="outline" className="text-warning border-warning/50 text-xs">
                {formatLmiMode(lmiMode)}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">LMI Premium</p>
                <p className="font-bold text-warning">{formatCurrency(lmiEstimate.lmiAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">LVR</p>
                <p className="font-semibold">{lmiEstimate.lvr.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Net for Purchase</p>
                <p className="font-bold text-foreground">
                  {formatCurrency(Math.max(0, result.borrowingCapacity - lmiEstimate.lmiAmount))}
                </p>
              </div>
            </div>
            {lmiMode === 'display_deduction' && (
              <p className="text-xs text-muted-foreground mt-2">
                Max capacity unchanged — {formatCurrency(lmiEstimate.lmiAmount)} allocated to LMI from loan proceeds.
              </p>
            )}
            {lmiMode === 'debt_capitalised' && (
              <p className="text-xs text-muted-foreground mt-2">
                LMI capitalised onto loan — total debt increased by {formatCurrency(lmiEstimate.lmiAmount)}.
              </p>
            )}
          </div>
        )}

        {/* Main Borrowing Capacity */}
        <div className={`p-4 rounded-lg border-2 ${floorActive ? 'border-destructive/40 bg-destructive/5' : `${bandConfig.borderColor} ${bandConfig.bgLight}`}`}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-medium text-muted-foreground">
              BORROWING CAPACITY
              {floorActive && showAdvancedCapacity && (
                <span className="ml-2 text-[10px] uppercase tracking-wide text-destructive">
                  True position (unfloored)
                </span>
              )}
            </p>
          </div>
          <div className={`text-4xl font-bold ${floorActive ? 'text-destructive' : 'text-foreground'}`}>
            {formatCurrency(displayedCapacity)}
          </div>
          <div className="mt-3">
            <Progress
              value={capacityProgress}
              className="h-3"
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-sm text-muted-foreground">
            <span>Stress-tested: {formatCurrency(stressTestedCapacity)}</span>
            {floorActive && (
              <span className="text-xs">Engine lendable: {formatCurrency(result.borrowingCapacity)}</span>
            )}
          </div>
          {floorActive && (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-muted-foreground/80 leading-relaxed flex items-start gap-1">
                <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>
                  Surplus is negative ({formatCurrency(result.monthlySurplus)}/mo) so lendable capacity is clamped at $0
                  for APRA compliance.
                </span>
              </p>
              <button
                type="button"
                className="text-[11px] underline underline-offset-2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowAdvancedCapacity(prev => !prev)}
              >
                {showAdvancedCapacity ? 'Hide advanced true-position view' : 'Show advanced true-position view'}
              </button>
              {showAdvancedCapacity && (
                <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                  True serviceability gap (unfloored) at assessment rate: <strong>{formatCurrency(theoreticalCapacity)}</strong>.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Total Purchasing Power — shown when equity release contributes capital */}
        {accessibleEquity > 0 && (
          <div className="p-4 rounded-lg border-2 border-primary/30 bg-primary/5">
            <p className="text-sm font-medium text-muted-foreground mb-1">TOTAL PURCHASING POWER</p>
            <div className="text-3xl font-bold text-primary">
              {formatCurrency(result.borrowingCapacity + accessibleEquity)}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Borrowing Capacity:</span>
                <span className="font-medium">{formatCurrency(result.borrowingCapacity)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Accessible Equity:</span>
                <span className="font-medium text-primary">{formatCurrency(accessibleEquity)}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Equity release provides additional capital — it does not affect serviceability.
            </p>
          </div>
        )}

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-secondary/50 text-center">
            <p className="text-xs text-muted-foreground mb-1">Surplus</p>
            <p className={`text-lg font-bold ${result.monthlySurplus >= 0 ? 'text-success' : 'text-destructive'}`}>
              {formatCurrency(result.monthlySurplus)}
            </p>
            <p className="text-xs text-muted-foreground">/month</p>
          </div>
          <div className="p-3 rounded-lg bg-secondary/50 text-center">
            <p className="text-xs text-muted-foreground mb-1">DTI</p>
            <p className={`text-lg font-bold ${safeDtiRatio < 6 ? 'text-success' : safeDtiRatio < 8 ? 'text-warning' : 'text-destructive'}`}>
              {safeDtiRatio.toFixed(1)}x
            </p>
            <p className="text-xs text-muted-foreground">ratio</p>
          </div>
          <div className="p-3 rounded-lg bg-secondary/50 text-center">
            <p className="text-xs text-muted-foreground mb-1">Assessment</p>
            <p className="text-lg font-bold text-foreground">
              {safeAssessmentRate.toFixed(2)}%
            </p>
            <p className="text-xs text-muted-foreground">rate</p>
          </div>
        </div>

        {/* Net Monthly Surplus — Audit Breakdown
            Shows the EXACT formula the engine uses so the broker can
            reconcile the surplus number against raw inputs. The engine
            uses AFTER-TAX shaded income (not gross) — this row makes
            that explicit and prevents "the maths doesn't add up" confusion. */}
        {(() => {
          // Resolve monthly after-tax with a robust fallback chain:
          // 1) engine top-level monthlyAfterTaxIncome
          // 2) engine top-level afterTaxAnnualIncome / 12
          // 3) engine taxBreakdown.monthlyTakeHome
          // 4) engine taxBreakdown.afterTaxIncome / 12
          // 5) locally derived from shaded (or gross) income — same basis as the
          //    Tax Breakdown card above, so the two never contradict each other.
          const monthlyAfterTax =
            (result.monthlyAfterTaxIncome && result.monthlyAfterTaxIncome > 0
              ? result.monthlyAfterTaxIncome
              : 0)
            || (result.afterTaxAnnualIncome
              ? Math.round(result.afterTaxAnnualIncome / 12)
              : 0)
            || (taxBreakdown?.monthlyTakeHome ?? 0)
            || (taxBreakdown ? Math.round(taxBreakdown.afterTaxIncome / 12) : 0);
          const monthlyExpenses = Math.round(result.livingExpensesMonthly || 0);
          const monthlyCommitments = Math.round(result.existingCommitmentsMonthly || 0);
          const computedSurplus = monthlyAfterTax - monthlyExpenses - monthlyCommitments;
          const engineSurplus = Math.round(result.monthlySurplus || 0);
          // Engine surplus may differ from raw computation when conservative
          // mode applies floors / buffer multipliers — surface that delta.
          const flooredDelta = engineSurplus - computedSurplus;
          const monthlyGross = Math.round((result.grossAnnualIncome || 0) / 12);
          const monthlyShaded = Math.round((result.shadedAnnualIncome || 0) / 12);
          return (
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Net Monthly Surplus — Audit</p>
                <Badge variant="outline" className="text-[10px] uppercase">After-Tax Basis</Badge>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                The engine assesses serviceability on <strong className="text-foreground">after-tax shaded income</strong>,
                not gross. This breakdown reconciles the surplus figure shown above.
              </p>

              <div className="space-y-1.5 text-sm pt-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Gross income (monthly)</span>
                  <span className="tabular-nums">{formatCurrency(monthlyGross)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Shaded income (monthly)</span>
                  <span className="tabular-nums">{formatCurrency(monthlyShaded)}</span>
                </div>
                <Separator className="my-1.5" />
                <div className="flex items-center justify-between font-medium">
                  <span className="text-foreground">After-tax income (monthly)</span>
                  <span className="tabular-nums text-success">{formatCurrency(monthlyAfterTax)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">− Living expenses</span>
                  <span className="tabular-nums text-destructive">−{formatCurrency(monthlyExpenses)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">− Existing commitments</span>
                  <span className="tabular-nums text-destructive">−{formatCurrency(monthlyCommitments)}</span>
                </div>
                <Separator className="my-1.5" />
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-foreground">= Raw surplus</span>
                  <span className={`tabular-nums ${computedSurplus >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {formatCurrency(computedSurplus)}
                  </span>
                </div>
                {Math.abs(flooredDelta) > 1 && (
                  <>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground italic">Conservative floor / buffer adjustment</span>
                      <span className={`tabular-nums ${flooredDelta >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {flooredDelta >= 0 ? '+' : ''}{formatCurrency(flooredDelta)}
                      </span>
                    </div>
                    <Separator className="my-1.5" />
                    <div className="flex items-center justify-between font-bold">
                      <span className="text-foreground">= Engine surplus (used for capacity)</span>
                      <span className={`tabular-nums ${engineSurplus >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {formatCurrency(engineSurplus)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* Tax Breakdown Section */}
        {taxBreakdown && (
          <Collapsible open={showTaxBreakdown} onOpenChange={setShowTaxBreakdown}>
            <CollapsibleTrigger className="flex items-center justify-between w-full text-left p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Tax Breakdown (2025-26)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-success">
                  {formatCurrency(taxBreakdown.monthlyTakeHome)}/mo take-home
                </span>
                <ChevronDown className={`h-4 w-4 transition-transform ${showTaxBreakdown ? 'rotate-180' : ''}`} />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 p-4 rounded-lg border bg-card">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Assessable Income (shaded):</span>
                    <span className="font-medium">{formatCurrency(taxBreakdown.grossIncome)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Income Tax:</span>
                    <span className="font-medium text-destructive">-{formatCurrency(taxBreakdown.taxPayable)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Medicare Levy (2%):</span>
                    <span className="font-medium text-destructive">-{formatCurrency(taxBreakdown.medicareLevy)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Tax:</span>
                    <span className="font-medium text-destructive">-{formatCurrency(taxBreakdown.totalTax)}</span>
                  </div>
                </div>
                
                <Separator />
                
                <div className="flex justify-between text-sm">
                  <span className="font-medium">After-Tax Income:</span>
                  <span className="font-bold text-success">{formatCurrency(taxBreakdown.afterTaxIncome)}/yr</span>
                </div>
                
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Effective Rate:</span>
                    <span className="font-medium">{(taxBreakdown.effectiveTaxRate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Marginal Rate:</span>
                    <span className="font-medium">{(taxBreakdown.marginalTaxRate * 100).toFixed(0)}%</span>
                  </div>
                </div>
                
                <div className="p-2 rounded bg-muted/50 text-xs text-muted-foreground">
                  <strong>Tax Bracket:</strong> {taxBreakdown.marginalBracket}
                </div>
                
                <div className="p-2 rounded bg-primary/10 border border-primary/20 text-xs">
                  <div className="flex items-center gap-1 text-primary font-medium">
                    <Info className="h-3 w-3" />
                    <span>After-tax income is used for serviceability assessment</span>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Serviceability Band */}
        <div className={`p-4 rounded-lg ${bandConfig.bgLight} border ${bandConfig.borderColor}`}>
          <p className="text-xs font-medium text-muted-foreground mb-2">SERVICEABILITY BAND</p>
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-lg ${bandConfig.bgColor}`}>
              <BandIcon className="h-6 w-6 text-foreground dark:text-white" />
            </div>
            <div>
              <Badge className={`${bandConfig.bgColor} text-foreground dark:text-white px-3 py-1`}>
                {bandConfig.label}
              </Badge>
              <p className="text-sm text-muted-foreground mt-1">{bandConfig.message}</p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <Collapsible open={showRecommendations} onOpenChange={setShowRecommendations}>
            <CollapsibleTrigger className="flex items-center justify-between w-full text-left">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Recommendations</span>
              </div>
              <ChevronDown className={`h-4 w-4 transition-transform ${showRecommendations ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-2">
              {recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  <span>{rec}</span>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-sm font-medium">Warnings</span>
            </div>
            {warnings.map((warning, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-warning">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}

        {/* Assumptions */}
        <Collapsible open={showAssumptions} onOpenChange={setShowAssumptions}>
          <CollapsibleTrigger className="flex items-center justify-between w-full text-left">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Assumptions Used</span>
            </div>
            <ChevronDown className={`h-4 w-4 transition-transform ${showAssumptions ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Buffer Rate:</span>
                <span className="font-medium">3.00%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Loan Term:</span>
                <span className="font-medium">30 years</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Interest Rate:</span>
                <span className="font-medium">{(safeAssessmentRate - 3).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Assessment Rate:</span>
                <span className="font-medium">{safeAssessmentRate.toFixed(2)}%</span>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Phase 5: Audit Trail & Explanation */}
        <AuditTrailPanel auditTrail={result?.auditTrail} explanation={result?.explanation} />

        {/* Disclaimer */}
        <div className="p-3 rounded-lg bg-muted/50 border border-border">
          <p className="text-xs text-muted-foreground flex items-start gap-2">
            <Shield className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              This calculator is for indicative purposes only. We recommend a formal broker 
              assessment for lending advice.
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
