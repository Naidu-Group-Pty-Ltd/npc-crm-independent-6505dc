import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Calculator, ChevronDown, FileText, Info, Lock, Pencil, Sparkles, TrendingUp } from 'lucide-react';
import { useCalculatorPrefill } from '@/contexts/CalculatorPrefillContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCommercialDealState, type CalculatorSourceMode } from '@/utils/commercial/commercialDealState';
import { buildGlobalSyncLabel } from '@/utils/commercial/calculatorDataSync';
import { escapeHtml } from '@/utils/commercial/escapeHtml';
import { INSUFFICIENT_CASH_FLOW_AI_CONTEXT_MESSAGE, cashFlowAiEstimateActions, createCashFlowAiEstimatePreview, type CashFlowAiEstimateAction, type CashFlowAiEstimatePreview } from '@/utils/commercial/cashFlowAiEstimateEngine';
import { buildTenYearInputsFromGlobal, calculateTenYearCashFlow } from '@/utils/commercial/tenYearCashFlowEngine';
import type { TenYearAnnualOverrideCell, TenYearAnnualOverrideField, TenYearAnnualOverrides, TenYearCashFlowInputs, TenYearCashFlowMode, TenYearCashFlowResult, TenYearCashFlowYear } from '@/utils/commercial/tenYearCashFlowTypes';


const PENDING = 'Pending';
const fmt = (n?: number | null) => n == null || !Number.isFinite(n) ? PENDING : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n);
const pct = (n?: number | null) => n == null || !Number.isFinite(n) ? PENDING : `${(n * 100).toFixed(1)}%`;
const numPct = (n?: number | null) => n == null || !Number.isFinite(n) ? PENDING : `${n.toFixed(2)}x`;
const hasPositive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const title = (v: string) => v.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
const badgeVariant = (r?: string) => (r === 'green' ? 'default' : r === 'amber' ? 'secondary' : 'destructive');
const TEN_YEAR_CALCULATION_VERSION = '10-Year Cash Flow v1.0';
const EXIT_VALUE_DIFFERENCE_THRESHOLD = 0.1;
const TEN_YEAR_REPORT_VERSION = 'PDF Report v1.0';

const summaryFormulaTooltip = (label: string) => {
  if (label === 'Levered IRR') return 'Internal rate of return on equity contributions and levered cashflows, including terminal proceeds where applicable.';
  if (label === 'Equity multiple') return 'Total equity returned ÷ initial equity invested.';
  if (label === 'Risk status') return 'Calculated from grouped validation warnings and specialist-review flags.';
  if (label.includes('after-tax cashflow')) return 'Pre-tax cashflow − tax payable + allowed tax benefit.';
  if (label.includes('property value')) return 'Prior year property value × (1 + capital growth rate).';
  if (label.includes('equity')) return 'Property value − closing loan balance.';
  if (label === 'Terminal value') return 'Forward NOI ÷ terminal cap rate.';
  return 'Protected calculated report output.';
};

function SummaryCard({ label, value, pending, emphasis = 'standard' }: { label: string; value: string | number | null | undefined; pending?: boolean; emphasis?: 'standard' | 'hero' | 'return' }) {
  const display = pending ? PENDING : typeof value === 'number' ? fmt(value) : value ?? PENDING;
  const formula = summaryFormulaTooltip(label);
  const cardClass = emphasis === 'hero'
    ? 'border-primary/40 bg-gradient-to-br from-primary/15 via-card to-card shadow-sm'
    : emphasis === 'return'
      ? 'border-success/30 bg-success/10 shadow-sm'
      : 'bg-card/95';
  const valueClass = emphasis === 'hero' ? 'text-2xl md:text-3xl' : emphasis === 'return' ? 'text-xl md:text-2xl' : 'text-lg';
  return <Card className={cardClass}><CardContent className="pt-4"><div className="flex items-start justify-between gap-2"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><Tooltip><TooltipTrigger asChild><Lock className="h-3.5 w-3.5 cursor-help text-muted-foreground" /></TooltipTrigger><TooltipContent className="max-w-xs">{formula}</TooltipContent></Tooltip></div><p className={`mt-2 font-semibold text-primary tabular-nums ${valueClass}`}>{display}</p><Badge variant="outline" className="mt-3 gap-1 text-[10px]"><Lock className="h-3 w-3" />Protected calculated output</Badge></CardContent></Card>;
}

function PremiumPanel({ title, description, children, className = '' }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return <Card className={`border-primary/20 bg-card/95 shadow-sm ${className}`}><CardHeader className="pb-3"><CardTitle className="text-base text-primary">{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader><CardContent>{children}</CardContent></Card>;
}

type SourceState = 'Blank' | 'Property Profile' | 'Scraped' | 'NOI Tab' | 'Cap Rate Tab' | 'GST Tab' | 'ICR / DSCR Tab' | 'Borrowing Capacity' | 'DCF Tab' | 'Research Engine' | 'AI Estimate' | 'Manual' | 'User Override' | 'Verified';
type CascadeValue = { value: number; source: SourceState };
type CascadeMap = Partial<Record<keyof TenYearCashFlowInputs, CascadeValue>>;
type AssumptionHistory = Partial<Record<keyof TenYearCashFlowInputs, { originalValue: number; originalSource: SourceState }>>;
type CashFlowWarningCategory = 'Property' | 'Income' | 'Vacancy' | 'Outgoings' | 'Debt' | 'Tax' | 'GST' | 'Capex' | 'Leasing' | 'Exit Value' | 'AI / Research' | 'Manual Overrides' | 'Report Export';
type CashFlowWarningSeverity = 'Critical' | 'Required' | 'Recommended';
type CashFlowValidationWarning = { category: CashFlowWarningCategory; severity: CashFlowWarningSeverity; message: string };

function AssumptionField({ label, source, tooltip, overridden, children }: { label: string; source: SourceState; tooltip: string; overridden?: boolean; children: ReactNode }) {
  return <div className="rounded-lg border border-border/60 bg-card/70 p-3 space-y-2"><div className="flex items-start justify-between gap-2"><Label className="flex items-center gap-1.5 text-xs font-medium">{label}<Tooltip><TooltipTrigger asChild><Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" /></TooltipTrigger><TooltipContent className="max-w-xs">{tooltip}</TooltipContent></Tooltip></Label><div className="flex flex-wrap justify-end gap-1"><Badge variant="outline" className="text-[10px]">{source}</Badge>{overridden && <Badge variant="secondary" className="text-[10px]">Manual override</Badge>}</div></div>{children}</div>;
}

function OverrideNumber({ label, field, value, update, suffix, placeholder, pending, source, tooltip, overridden, sourceConflict, onKeepOverride, onUseSource }: { label: string; field: keyof TenYearCashFlowInputs; value?: number; update: (field: keyof TenYearCashFlowInputs, value: number) => void; suffix?: string; placeholder?: string; pending?: boolean; source: SourceState; tooltip: string; overridden?: boolean; sourceConflict?: boolean; onKeepOverride?: () => void; onUseSource?: () => void }) {
  return <AssumptionField label={label} source={source} tooltip={tooltip} overridden={overridden}><div className="flex items-center gap-2"><Input type="number" value={pending ? '' : value ?? ''} placeholder={placeholder} onChange={e => update(field, Number(e.target.value))} />{suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}</div>{sourceConflict && <div className="rounded border border-brand-500/30 bg-brand-500/10 p-2 text-xs text-brand-100"><p>New source value available. This field currently uses a saved override.</p><div className="mt-2 flex gap-2"><Button type="button" size="sm" variant="outline" onClick={onKeepOverride}>Keep override</Button><Button type="button" size="sm" onClick={onUseSource}>Use source value</Button></div></div>}</AssumptionField>;
}

type MetricRowConfig = {
  group: string;
  label: string;
  formula: string;
  values: (y: TenYearCashFlowYear) => string;
  rawValue?: (y: TenYearCashFlowYear, inputs: TenYearCashFlowInputs) => number;
  rowType: 'calculated' | 'assumption';
  annualOverride?: boolean;
  overrideField?: TenYearAnnualOverrideField;
  finalYearOnly?: boolean;
};

function RowEditabilityBadge({ row }: { row: MetricRowConfig }) {
  if (row.rowType === 'calculated') {
    return <Badge variant="outline" className="mt-1 gap-1 text-[10px]"><Lock className="h-3 w-3" />Protected calculated output</Badge>;
  }
  return <Badge variant="secondary" className="mt-1 gap-1 text-[10px]"><Pencil className="h-3 w-3" />{row.annualOverride ? 'Annual override allowed' : 'Editable assumption'}</Badge>;
}

function MetricRows({ years, mode, inputs, pending, annualOverridesEnabled, annualOverrides, onSetAnnualOverride, onResetAnnualOverride, onResetAnnualOverrideRow }: { years: TenYearCashFlowYear[]; mode: TenYearCashFlowMode; inputs: TenYearCashFlowInputs; pending?: boolean; annualOverridesEnabled: boolean; annualOverrides: TenYearAnnualOverrides; onSetAnnualOverride: (field: TenYearAnnualOverrideField, year: number, value: number, originalValue: number) => void; onResetAnnualOverride: (field: TenYearAnnualOverrideField, year: number) => void; onResetAnnualOverrideRow: (field: TenYearAnnualOverrideField) => void }) {
  const rows: MetricRowConfig[] = [
    { group: 'Valuation', label: 'Capital growth %', formula: 'Assumption row: capital growth rate for the projection year.', values: y => `${((annualOverrides.capitalGrowthPct?.[y.year]?.value ?? y.capitalGrowthPct)).toFixed(2)}%`, rawValue: y => annualOverrides.capitalGrowthPct?.[y.year]?.value ?? y.capitalGrowthPct, rowType: 'assumption', annualOverride: true, overrideField: 'capitalGrowthPct' },
    { group: 'Valuation', label: 'Terminal cap rate %', formula: 'Assumption row: terminal cap rate override is only available in the final year.', values: y => y.year === 10 ? `${((annualOverrides.terminalCapRatePct?.[10]?.value ?? inputs.terminalCapRatePct)).toFixed(2)}%` : 'Final year only', rawValue: y => y.year === 10 ? (annualOverrides.terminalCapRatePct?.[10]?.value ?? inputs.terminalCapRatePct) : inputs.terminalCapRatePct, rowType: 'assumption', annualOverride: true, overrideField: 'terminalCapRatePct', finalYearOnly: true },
    { group: 'Valuation', label: 'Property value', formula: 'Prior year property value × (1 + capital growth rate).', values: y => fmt(y.propertyValue), rowType: 'calculated' },
    { group: 'Valuation', label: 'Terminal value', formula: 'Forward NOI ÷ terminal cap rate.', values: y => y.terminalValue == null ? PENDING : fmt(y.terminalValue), rowType: 'calculated' },
    { group: 'Debt', label: 'Opening loan balance', formula: 'Prior year closing loan balance.', values: y => fmt(y.openingLoanBalance), rowType: 'calculated' },
    { group: 'Debt', label: 'Interest payment', formula: 'Opening loan balance × interest rate.', values: y => fmt(y.interestPayment), rowType: 'calculated' },
    { group: 'Debt', label: 'Principal payment', formula: 'Annual debt service − interest payment.', values: y => fmt(y.principalPayment), rowType: 'calculated' },
    { group: 'Debt', label: 'Closing loan balance', formula: 'Opening loan balance − principal payment.', values: y => fmt(y.closingLoanBalance), rowType: 'calculated' },
    { group: 'Debt', label: 'LVR', formula: 'Closing loan balance ÷ property value.', values: y => pct(y.lvr), rowType: 'calculated' },
    { group: 'Debt', label: 'ICR', formula: 'NOI ÷ interest payment.', values: y => numPct(y.icr), rowType: 'calculated' },
    { group: 'Debt', label: 'DSCR', formula: 'NOI ÷ annual debt service.', values: y => numPct(y.dscr), rowType: 'calculated' },
    { group: 'Debt', label: 'Debt yield', formula: 'NOI ÷ opening loan balance.', values: y => pct(y.debtYield), rowType: 'calculated' },
    { group: 'Debt', label: 'Interest rate %', formula: 'Assumption row: annual interest-rate override is available only when annual debt override is enabled.', values: y => `${y.interestRatePct.toFixed(2)}%`, rawValue: y => y.interestRatePct, rowType: 'assumption', annualOverride: true, overrideField: 'interestRatePct' },
    { group: 'Income', label: 'Rent growth %', formula: 'Assumption row: rent growth rate applied to the relevant projection year.', values: y => `${((annualOverrides.rentGrowthPct?.[y.year]?.value ?? inputs.rentGrowthPct)).toFixed(2)}%`, rawValue: y => annualOverrides.rentGrowthPct?.[y.year]?.value ?? inputs.rentGrowthPct, rowType: 'assumption', annualOverride: true, overrideField: 'rentGrowthPct' },
    { group: 'Income', label: 'Passing rent', formula: 'Assumption row: prior year rent × accepted rent growth; annual override may be enabled.', values: y => fmt(y.passingRent), rawValue: y => y.passingRent, rowType: 'assumption', annualOverride: true, overrideField: 'passingRent' },
    { group: 'Income', label: 'Vacancy allowance %', formula: 'Assumption row: vacancy allowance applied to potential gross income.', values: y => `${((annualOverrides.vacancyAllowancePct?.[y.year]?.value ?? inputs.vacancyAllowancePct)).toFixed(2)}%`, rawValue: y => annualOverrides.vacancyAllowancePct?.[y.year]?.value ?? inputs.vacancyAllowancePct, rowType: 'assumption', annualOverride: true, overrideField: 'vacancyAllowancePct' },
    { group: 'Income', label: 'Vacancy loss', formula: 'Potential gross income × vacancy allowance.', values: y => fmt(y.vacancyLoss), rowType: 'calculated' },
    { group: 'Income', label: 'Recovered outgoings', formula: 'Assumption row: recovered outgoings escalated by outgoings growth; annual override may be enabled.', values: y => fmt(y.recoveredOutgoings), rawValue: y => y.recoveredOutgoings, rowType: 'assumption', annualOverride: true, overrideField: 'recoveredOutgoings' },
    { group: 'Income', label: 'Outgoings growth %', formula: 'Assumption row: recovered-outgoings escalation rate for the relevant projection year.', values: y => `${((annualOverrides.outgoingsGrowthPct?.[y.year]?.value ?? inputs.outgoingsGrowthPct)).toFixed(2)}%`, rawValue: y => annualOverrides.outgoingsGrowthPct?.[y.year]?.value ?? inputs.outgoingsGrowthPct, rowType: 'assumption', annualOverride: true, overrideField: 'outgoingsGrowthPct' },
    { group: 'Expenses', label: 'Owner-borne expenses', formula: 'Assumption row: owner-borne expenses escalated by expense/outgoings growth; annual override may be enabled.', values: y => fmt(y.totalOwnerBorneExpenses), rawValue: y => y.totalOwnerBorneExpenses, rowType: 'assumption', annualOverride: true, overrideField: 'otherOwnerExpenses' },
    { group: 'NOI', label: 'Actual NOI', formula: 'Effective gross income − owner-borne expenses.', values: y => fmt(y.actualNoi), rowType: 'calculated' },
    { group: 'NOI', label: 'Lender-adjusted NOI', formula: 'Actual NOI − risk haircuts.', values: y => fmt(y.lenderAdjustedNoi), rowType: 'calculated' },
    { group: 'Leasing / Vacancy', label: 'Lease downtime', formula: 'Assumption row: downtime months used in leasing/vacancy cost.', values: y => `${((annualOverrides.downtimeMonths?.[y.year]?.value ?? inputs.downtimeMonths)).toFixed(1)} months`, rawValue: y => annualOverrides.downtimeMonths?.[y.year]?.value ?? inputs.downtimeMonths, rowType: 'assumption', annualOverride: true, overrideField: 'downtimeMonths' },
    { group: 'Leasing / Vacancy', label: 'Tenant incentives', formula: 'Assumption row: incentive months used in leasing/vacancy cost.', values: y => `${((annualOverrides.incentiveMonths?.[y.year]?.value ?? inputs.incentiveMonths)).toFixed(1)} months`, rawValue: y => annualOverrides.incentiveMonths?.[y.year]?.value ?? inputs.incentiveMonths, rowType: 'assumption', annualOverride: true, overrideField: 'incentiveMonths' },
    { group: 'Leasing / Vacancy', label: 'Total leasing / vacancy cost', formula: 'Downtime + tenant incentives + leasing fee + reletting cost.', values: y => fmt(y.totalLeasingVacancyCost), rowType: 'calculated' },
    { group: 'Capex', label: 'Capex reserve', formula: 'Assumption row: annual reserve amount; annual override may be enabled.', values: y => fmt(y.annualCapexReserve), rawValue: y => y.annualCapexReserve, rowType: 'assumption', annualOverride: true, overrideField: 'annualCapexReserve' },
    { group: 'Capex', label: 'Major capex', formula: 'Assumption row: major capex amount in the selected timing year; annual override may be enabled.', values: y => fmt(y.majorCapex), rawValue: y => y.majorCapex, rowType: 'assumption', annualOverride: true, overrideField: 'majorCapexAmount' },
    { group: 'Capex', label: 'Total capex', formula: 'Annual reserve + major capex + specialist reserves.', values: y => fmt(y.totalCapex), rowType: 'calculated' },
    { group: 'Cash Flow', label: 'Pre-tax cashflow', formula: 'NOI − leasing/vacancy costs − capex − debt service.', values: y => fmt(y.preTaxCashflow), rowType: 'calculated' },
    { group: 'Tax', label: 'Tax rate %', formula: 'Assumption row: tax rate applied to taxable income.', values: y => `${((annualOverrides.taxRatePct?.[y.year]?.value ?? inputs.taxRatePct)).toFixed(2)}%`, rawValue: y => annualOverrides.taxRatePct?.[y.year]?.value ?? inputs.taxRatePct, rowType: 'assumption', annualOverride: true, overrideField: 'taxRatePct' },
    { group: 'Tax', label: 'Tax payable / benefit', formula: 'Assumption-sensitive calculated from tax rate; tax rate annual override may be enabled.', values: y => fmt(y.taxPayableBenefit), rowType: 'calculated' },
    { group: 'Cash Flow', label: 'After-tax cashflow', formula: 'Pre-tax cashflow − tax payable + allowed tax benefit.', values: y => fmt(y.afterTaxCashflow), rowType: 'calculated' },
    { group: 'Cash Flow', label: 'Cumulative after-tax cashflow', formula: 'Prior year cumulative after-tax cashflow + current year after-tax cashflow.', values: y => fmt(y.cumulativeAfterTaxCashflow), rowType: 'calculated' },
    { group: 'Equity', label: 'Equity position', formula: 'Property value − closing loan balance.', values: y => fmt(y.equityPosition), rowType: 'calculated' },
  ];
  if (mode === 'ownerOccupier') rows.push({ group: 'Business Impact', label: 'Net saving / cost vs leasing', formula: 'Leasing cost avoided − ownership cash cost.', values: y => fmt(y.netSavingCostVsLeasing), rowType: 'calculated' }, { group: 'Business Impact', label: 'Business DSCR', formula: 'Available business cashflow ÷ total debt service.', values: y => numPct(y.businessDscr), rowType: 'calculated' }, { group: 'Business Impact', label: 'Occupancy cost ratio', formula: 'Ownership cash cost ÷ business revenue.', values: y => pct(y.occupancyCostRatio), rowType: 'calculated' });
  if (mode === 'relatedPartyLease') rows.push({ group: 'Group View', label: 'Property entity cashflow', formula: 'Rent received + recoveries − expenses − debt − capex.', values: y => fmt(y.propertyEntityCashflow), rowType: 'calculated' }, { group: 'Group View', label: 'Operating occupancy cost', formula: 'Related-party rent paid + outgoings paid.', values: y => fmt(y.operatingBusinessOccupancyCost), rowType: 'calculated' }, { group: 'Group View', label: 'Group cashflow', formula: 'Internal rent neutralised before tax/entity effects.', values: y => fmt(y.groupCashflow), rowType: 'calculated' });
  let current = '';
  const tableYears = pending ? Array.from({ length: 10 }, (_, i) => ({ year: i + 1 }) as TenYearCashFlowYear) : years;
  const renderCell = (row: MetricRowConfig, year: TenYearCashFlowYear) => {
    const disabledFinalYear = row.finalYearOnly && year.year !== 10;
    if (!annualOverridesEnabled || row.rowType !== 'assumption' || !row.overrideField || disabledFinalYear) return pending ? PENDING : row.values(year);
    const originalValue = row.rawValue?.(year, inputs) ?? 0;
    const override = annualOverrides[row.overrideField]?.[year.year];
    const displayValue = override?.value ?? originalValue;
    return <div className="flex min-w-[150px] flex-col items-end gap-1">
      <Input type="number" className="h-8 w-28 text-right" value={displayValue} onChange={event => onSetAnnualOverride(row.overrideField!, year.year, Number(event.target.value), originalValue)} />
      {override && <div className="max-w-[180px] text-right text-[10px] text-muted-foreground"><Badge variant="secondary" className="mb-1 text-[10px]">Override</Badge><div>Original: {originalValue.toLocaleString('en-AU')}</div><div>New: {override.value.toLocaleString('en-AU')}</div><div>{override.user ?? 'Current user'} · {new Date(override.timestamp).toLocaleString('en-AU')}</div><Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onResetAnnualOverride(row.overrideField!, year.year)}>Reset this cell</Button></div>}
    </div>;
  };
  return <PremiumPanel title="Annual forecast table" description="Protected formulas are unchanged; responsive horizontal scrolling keeps all ten years readable."><div className="overflow-x-auto overscroll-x-contain rounded-xl border border-border/60 bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60" role="region" aria-label="10-year annual forecast table" tabIndex={0}><Table className="min-w-[1280px]"><TableHeader className="sticky top-0 z-20 bg-card shadow-sm"><TableRow><TableHead className="sticky left-0 z-30 min-w-[280px] bg-card">Row / formula</TableHead>{tableYears.map(y => <TableHead key={y.year} className="min-w-[130px] text-right">Year {y.year}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((r, i) => { const showGroup = current !== r.group; current = r.group; return [showGroup ? <TableRow key={`${r.group}-g`} className="bg-primary/10"><TableCell colSpan={11} className="font-semibold text-primary">{r.group}</TableCell></TableRow> : null, <TableRow key={`${r.group}-${r.label}-${i}`} className={r.rowType === 'calculated' ? 'bg-muted/20 hover:bg-muted/30' : 'hover:bg-muted/10'}><TableCell className="sticky left-0 z-10 bg-card"><div className="flex items-start justify-between gap-2"><div><div className="font-medium">{r.label}</div><div className="flex items-center gap-1 text-[11px] text-muted-foreground">{r.formula}<Tooltip><TooltipTrigger asChild><button type="button" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60" aria-label={`Show formula for ${r.label}`}><Info className="h-3.5 w-3.5 cursor-help" /></button></TooltipTrigger><TooltipContent className="max-w-xs" role="tooltip">{r.formula}</TooltipContent></Tooltip></div><RowEditabilityBadge row={r} />{annualOverridesEnabled && r.overrideField && <Button type="button" size="sm" variant="ghost" className="mt-1 h-6 px-2 text-[10px]" onClick={() => onResetAnnualOverrideRow(r.overrideField!)}>Reset this row</Button>}</div></div></TableCell>{tableYears.map(y => <TableCell key={y.year} className="whitespace-nowrap text-right tabular-nums align-top">{renderCell(r, y)}</TableCell>)}</TableRow>]; })}</TableBody></Table></div></PremiumPanel>;
}

export function TenYearCashFlowCard() {
  const { prefill } = useCalculatorPrefill();
  const dealProfile = useCommercialDealState(s => s.profile.dealProfile);
  const purchaserStructure = useCommercialDealState(s => s.profile.purchaserStructure);
  const propertyValuation = useCommercialDealState(s => s.profile.propertyValuation);
  const leaseIncome = useCommercialDealState(s => s.profile.leaseIncome);
  const operatingExpenses = useCommercialDealState(s => s.profile.operatingExpenses);
  const lendingAssumptions = useCommercialDealState(s => s.profile.lendingAssumptions);
  const acquisitionCosts = useCommercialDealState(s => s.profile.acquisitionCosts);
  const fundsToComplete = useCommercialDealState(s => s.profile.fundsToComplete);
  const borrowingOutputs = useCommercialDealState(s => s.profile.borrowingOutputs);
  const noiOutputs = useCommercialDealState(s => s.profile.noiOutputs);
  const capRateOutputs = useCommercialDealState(s => s.profile.capRateOutputs);
  const icrDscrOutputs = useCommercialDealState(s => s.profile.icrDscrOutputs);
  const gstInputs = useCommercialDealState(s => s.profile.gstInputs);
  const gstOutputs = useCommercialDealState(s => s.profile.gstOutputs);
  const dcfInputs = useCommercialDealState(s => s.profile.dcfInputs);
  const dcfOutputs = useCommercialDealState(s => s.profile.dcfOutputs);
  const aiEstimateMetadata = useCommercialDealState(s => s.profile.aiEstimateMetadata);
  const profile = useMemo(() => ({
    dealProfile,
    purchaserStructure,
    propertyValuation,
    leaseIncome,
    operatingExpenses,
    lendingAssumptions,
    acquisitionCosts,
    fundsToComplete,
    borrowingOutputs,
    noiOutputs,
    capRateOutputs,
    icrDscrOutputs,
    gstInputs,
    gstOutputs,
    dcfInputs,
    dcfOutputs,
    debtInputs: {},
    industrialMetrics: {},
    riskInputs: {},
    riskOutputs: {},
    aiEstimateMetadata,
    documentVerificationStatus: {},
    scenarioOverrides: {},
    assumptions: {},
    aiEstimateAuditLog: [],
  }), [dealProfile, purchaserStructure, propertyValuation, leaseIncome, operatingExpenses, lendingAssumptions, acquisitionCosts, fundsToComplete, borrowingOutputs, noiOutputs, capRateOutputs, icrDscrOutputs, gstInputs, gstOutputs, dcfInputs, dcfOutputs, aiEstimateMetadata]);
  const updateGlobal = useCommercialDealState(s => s.updateGlobal);
  const clearTenYearCashFlowOutputs = useCommercialDealState(s => s.clearTenYearCashFlowOutputs);
  const sourceMode = useCommercialDealState(s => s.sourceModes.tenYearCashFlow);
  const setSourceMode = useCommercialDealState(s => s.setSourceMode);
  const [mode, setMode] = useState<TenYearCashFlowMode>('investor');
  const [overviewOpen, setOverviewOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('ten-year-cash-flow-overview-viewed') !== 'true';
  });
  const [scenarioName, setScenarioName] = useState('');
  const [projectionPeriod, setProjectionPeriod] = useState('');
  const [includeInReport, setIncludeInReport] = useState(true);
  const [leaseExpiryYear, setLeaseExpiryYear] = useState('');
  const [waleYears, setWaleYears] = useState('');
  const [interestDeductible, setInterestDeductible] = useState(true);
  const [exitValueMethod, setExitValueMethod] = useState('Terminal Cap Value');
  const [manualVerifiedExitValue, setManualVerifiedExitValue] = useState('');
  const [exitReconciliationConfirmed, setExitReconciliationConfirmed] = useState(false);
  const [overrideHistory, setOverrideHistory] = useState<AssumptionHistory>({});
  const [overrides, setOverrides] = useState<Partial<TenYearCashFlowInputs>>({});
  const [overriddenFields, setOverriddenFields] = useState<string[]>([]);
  const [aiAcceptedSources, setAiAcceptedSources] = useState<Partial<Record<keyof TenYearCashFlowInputs, SourceState>>>({});
  const [verifiedFields, setVerifiedFields] = useState<Array<keyof TenYearCashFlowInputs>>([]);
  const [estimatePreview, setEstimatePreview] = useState<CashFlowAiEstimatePreview | null>(null);
  const [estimateEditValue, setEstimateEditValue] = useState('');
  const [estimateMessage, setEstimateMessage] = useState<string | null>(null);
  const [assumptionHistory, setAssumptionHistory] = useState<Array<{ field: keyof TenYearCashFlowInputs | TenYearAnnualOverrideField; value: number; source: SourceState | 'Annual Override'; timestamp: string; year?: number }>>([]);
  const [annualOverridesEnabled, setAnnualOverridesEnabled] = useState(false);
  const [annualOverrides, setAnnualOverrides] = useState<TenYearAnnualOverrides>({});
  const [capexNoneConfirmed, setCapexNoneConfirmed] = useState(false);
  const [generatedCashFlow, setGeneratedCashFlow] = useState<{ result: TenYearCashFlowResult; generatedAt: string; signature: string; calculationVersion: string } | null>(null);
  const [reportVerified, setReportVerified] = useState(false);
  const [pdfOptions, setPdfOptions] = useState({ assumptions: true, formulaNotes: true, warnings: true, scenarioNotes: true, commentary: true, fullTable: true, summaryCards: true, aiEstimateNotes: true });
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfConfirmOpen, setPdfConfirmOpen] = useState(false);
  const [pdfExportHistory, setPdfExportHistory] = useState<Array<{ timestamp: string; calculationVersion: string; reportVersion: string; scenarioName: string }>>([]);
  const [lastPdfGeneratedAt, setLastPdfGeneratedAt] = useState<string | null>(null);
  const [generatedCommentary, setGeneratedCommentary] = useState('');
  const [editableCommentary, setEditableCommentary] = useState('');
  const [commentarySignature, setCommentarySignature] = useState('');
  const [commentaryEditing, setCommentaryEditing] = useState(false);
  const [scenarioNotes, setScenarioNotes] = useState({ base: 'Base case reflects the generated 10-year cashflow assumptions.', conservative: 'Conservative case should test softer income, higher vacancy and higher exit yield assumptions.', upside: 'Upside case should only be used where market evidence supports stronger growth or lower risk.', manual: '' });
  const [assumptionsOpen, setAssumptionsOpen] = useState(true);
  const [pdfControlsOpen, setPdfControlsOpen] = useState(true);
  const cascade = useMemo<CascadeMap>(() => {
    const pick = (...candidates: Array<{ value: unknown; source: SourceState }>): CascadeValue | undefined => {
      for (const c of candidates) if (typeof c.value === 'number' && Number.isFinite(c.value)) return { value: c.value, source: c.source };
      return undefined;
    };
    const pv = propertyValuation as any;
    const noi = noiOutputs as any;
    const cap = capRateOutputs as any;
    const icr = icrDscrOutputs as any;
    const gst = gstOutputs as any;
    const dcfIn = dcfInputs as any;
    const dcfOut = dcfOutputs as any;
    const borrow = borrowingOutputs as any;
    const funds = (borrowingOutputs?.fundsToComplete ?? fundsToComplete) as any;
    const scrape = prefill as any;
    const purchasePrice = pick(
      { value: pv.purchasePrice, source: 'Property Profile' },
      { value: (gstInputs as any)?.purchasePrice, source: 'GST Tab' },
      { value: borrow?.propertyValueUsedForLvr ?? borrow?.purchasePrice ?? borrow?.propertyValue, source: 'Borrowing Capacity' },
      { value: dcfIn.purchasePrice, source: 'DCF Tab' },
    );
    const acquisition = pick(
      { value: funds?.totalAcquisitionCosts, source: 'Borrowing Capacity' },
      { value: dcfOut?.totalAcquisitionCosts ?? dcfIn.totalAcquisitionCosts, source: 'DCF Tab' },
    );
    const gstEconomic = pick({ value: gst?.gstEconomicCost ?? gst?.economicCost, source: 'GST Tab' });
    const totalCostBaseCalculated = purchasePrice && acquisition && gstEconomic ? purchasePrice.value + acquisition.value + gstEconomic.value : undefined;
    return {
      purchasePrice,
      totalAcquisitionCosts: acquisition,
      gstEconomicCost: gstEconomic,
      totalCostBase: pick(
        { value: totalCostBaseCalculated, source: 'Verified' },
        { value: dcfOut?.totalCostBase ?? dcfIn.totalCostBase, source: 'DCF Tab' },
        { value: funds?.totalCostBase, source: 'Borrowing Capacity' },
      ),
      requiredEquity: pick({ value: funds?.requiredEquity, source: 'Borrowing Capacity' }),
      availableEquity: pick({ value: (purchaserStructure as any).availableCashEquity, source: 'Property Profile' }),
      passingRent: pick(
        { value: noi?.selectedBorrowingNoi ?? noi?.borrowingNoi ?? noi?.netOperatingIncome, source: 'NOI Tab' },
        { value: dcfIn.initialNoi ?? dcfOut?.initialNoi, source: 'DCF Tab' },
        { value: (leaseIncome as any).grossPassingRent, source: 'Property Profile' },
      ),
      rentGrowthPct: pick(
        { value: (aiEstimateMetadata as any)?.rentGrowthPct?.estimatedValue, source: 'Research Engine' },
        { value: dcfIn.rentalGrowthPct ?? dcfIn.rentGrowthPct, source: 'DCF Tab' },
      ),
      vacancyAllowancePct: pick(
        { value: (leaseIncome as any).vacancyAllowancePct ?? noi?.vacancyAllowancePct, source: 'NOI Tab' },
        { value: (aiEstimateMetadata as any)?.vacancyAllowancePct?.estimatedValue, source: 'Research Engine' },
        { value: dcfIn.vacancyAllowancePct, source: 'DCF Tab' },
      ),
      recoveredOutgoings: pick(
        { value: (leaseIncome as any).recoveredOutgoings ?? noi?.recoveredOutgoings, source: 'NOI Tab' },
        { value: scrape?.recoveredOutgoings, source: 'Scraped' },
      ),
      terminalCapRatePct: pick(
        { value: cap?.targetCapRate ?? cap?.capitalisationRate, source: 'Cap Rate Tab' },
        { value: dcfIn.terminalCapRatePct, source: 'DCF Tab' },
        { value: (aiEstimateMetadata as any)?.terminalCapRatePct?.estimatedValue, source: 'Research Engine' },
      ),
      loanAmount: pick(
        { value: borrow?.proposedLoan ?? borrow?.finalRiskAdjustedLoan, source: 'Borrowing Capacity' },
        { value: icr?.loanAmount, source: 'ICR / DSCR Tab' },
        { value: dcfIn.loanAmount, source: 'DCF Tab' },
      ),
      interestRatePct: pick(
        { value: icr?.interestRatePct ?? icr?.contractInterestRatePct, source: 'ICR / DSCR Tab' },
        { value: (lendingAssumptions as any).contractInterestRatePct, source: 'Borrowing Capacity' },
        { value: dcfIn.interestRatePct, source: 'DCF Tab' },
      ),
      annualDebtService: pick(
        { value: icr?.annualDebtService, source: 'ICR / DSCR Tab' },
        { value: borrow?.annualDebtService, source: 'Borrowing Capacity' },
        { value: dcfIn.annualDebtService, source: 'DCF Tab' },
      ),
      annualCapexReserve: pick(
        { value: dcfIn.annualCapex ?? dcfIn.annualCapexReserve, source: 'DCF Tab' },
        { value: (aiEstimateMetadata as any)?.annualCapexReserve?.estimatedValue, source: 'Research Engine' },
      ),
      taxRatePct: pick({ value: (purchaserStructure as any).taxRatePct, source: 'Property Profile' }),
      capitalGrowthPct: pick(
        { value: (aiEstimateMetadata as any)?.capitalGrowthPct?.estimatedValue, source: 'Research Engine' },
        { value: dcfIn.capitalGrowthPct, source: 'DCF Tab' },
      ),
    };
  }, [propertyValuation, gstInputs, borrowingOutputs, fundsToComplete, dcfInputs, dcfOutputs, gstOutputs, purchaserStructure, noiOutputs, capRateOutputs, icrDscrOutputs, prefill, leaseIncome, lendingAssumptions, aiEstimateMetadata]);
  const cascadeOverrides = useMemo(() => Object.fromEntries(Object.entries(cascade).filter((entry): entry is [string, CascadeValue] => Boolean(entry[1])).map(([key, item]) => [key, item.value])) as Partial<TenYearCashFlowInputs>, [cascade]);
  const inputs = useMemo(() => buildTenYearInputsFromGlobal(profile, mode, { ...cascadeOverrides, ...overrides, annualOverrides: annualOverridesEnabled ? annualOverrides : undefined }), [profile, mode, cascadeOverrides, overrides, annualOverridesEnabled, annualOverrides]);
  const result = useMemo(() => calculateTenYearCashFlow(inputs, overriddenFields), [inputs, overriddenFields]);
  const hasManualInputs = overriddenFields.length > 0;
  const hasObjectValues = (value: unknown) => Boolean(value && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length);
  const hasImportedInputs = Boolean(prefill) || Boolean(borrowingOutputs) || hasObjectValues(noiOutputs) || hasObjectValues(capRateOutputs) || hasObjectValues(icrDscrOutputs) || hasObjectValues(gstOutputs) || hasObjectValues(dcfOutputs);
  const manualRequiredFields: Array<keyof TenYearCashFlowInputs> = ['purchasePrice', 'totalCostBase', 'passingRent', 'rentGrowthPct', 'vacancyAllowancePct', 'outgoingsGrowthPct', 'annualCapexReserve', 'terminalCapRatePct', 'taxRatePct', 'gstEconomicCost'];
  const manualInputsComplete = manualRequiredFields.every(field => overriddenFields.includes(String(field)));
  const yearOneNoiReady = hasPositive(result.years[0]?.actualNoi) || hasPositive(inputs.passingRent) || hasPositive(inputs.recoveredOutgoings) || hasPositive(inputs.otherOwnerExpenses);
  const debtEnabled = hasPositive(inputs.loanAmount);
  const debtInputsReady = !debtEnabled || (hasPositive(inputs.loanAmount) && hasPositive(inputs.interestRatePct) && (hasPositive(inputs.amortisationYears) || hasPositive(inputs.annualDebtService)) && Boolean(inputs.repaymentType));
  const requiredAssumptionsReady = hasPositive(inputs.purchasePrice)
    && (hasPositive(inputs.totalCostBase) || hasPositive(inputs.totalAcquisitionCosts))
    && yearOneNoiReady
    && Number.isFinite(inputs.rentGrowthPct)
    && Number.isFinite(inputs.vacancyAllowancePct)
    && hasPositive(inputs.terminalCapRatePct)
    && Number.isFinite(inputs.capitalGrowthPct)
    && (hasPositive(inputs.annualCapexReserve) || capexNoneConfirmed)
    && (hasPositive(inputs.taxRatePct) || inputs.accountantReviewRequired)
    && projectionPeriod === '10'
    && Boolean(exitValueMethod)
    && debtInputsReady;
  const sourceComplete = hasImportedInputs || (hasManualInputs && manualInputsComplete);
  const modelReady = sourceComplete && requiredAssumptionsReady && result.warnings.every(w => !/must be greater|must be provided|required to calculate/i.test(w));
  const generationSignature = JSON.stringify({ inputs, mode, projectionPeriod, exitValueMethod, manualVerifiedExitValue, annualOverridesEnabled, annualOverrides, capexNoneConfirmed });
  const generatedCurrent = Boolean(generatedCashFlow && generatedCashFlow.signature === generationSignature);
  const generatedOutOfDate = Boolean(generatedCashFlow && !generatedCurrent);
  const reportResult = generatedCashFlow?.result ?? result;

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('ten-year-cash-flow-overview-viewed', 'true');
  }, []);

  useEffect(() => {
    if (generatedCashFlow && generatedCurrent) updateGlobal('tenYearCashFlowOutputs', generatedCashFlow.result);
    else clearTenYearCashFlowOutputs();
  }, [clearTenYearCashFlowOutputs, generatedCashFlow, generatedCurrent, updateGlobal]);
  useEffect(() => { setExitReconciliationConfirmed(false); setReportVerified(false); }, [exitValueMethod, manualVerifiedExitValue]);
  const markOverridden = (field: keyof TenYearCashFlowInputs) => {
    const currentSource = cascade[field];
    if (currentSource && !overrideHistory[field]) setOverrideHistory(h => ({ ...h, [field]: { originalValue: currentSource.value, originalSource: currentSource.source } }));
    setOverriddenFields(f => Array.from(new Set([...f, String(field)])));
    if (sourceMode === 'global') setSourceMode('tenYearCashFlow', 'manualOverride');
  };
  const updateOverride = (field: keyof TenYearCashFlowInputs, value: number) => { setOverrides(o => ({ ...o, [field]: Number.isFinite(value) ? value : 0 })); markOverridden(field); };
  const updateTextOverride = <K extends keyof TenYearCashFlowInputs>(field: K, value: TenYearCashFlowInputs[K]) => { setOverrides(o => ({ ...o, [field]: value })); markOverridden(field); };
  const isOverridden = (field: keyof TenYearCashFlowInputs) => overriddenFields.includes(String(field));
  const sourceFor = (field: keyof TenYearCashFlowInputs, fallback: SourceState = prefill ? 'Property Profile' : 'Blank'): SourceState => {
    if (isOverridden(field)) return 'User Override';
    if (verifiedFields.includes(field)) return 'Verified';
    return aiAcceptedSources[field] ?? cascade[field]?.source ?? fallback;
  };
  const hasSourceConflict = (field: keyof TenYearCashFlowInputs) => {
    const history = overrideHistory[field]; const latest = cascade[field];
    return Boolean(isOverridden(field) && history && latest && (history.originalSource !== latest.source || Math.abs(history.originalValue - latest.value) > 0.0001));
  };
  const clearSourceConflict = (field: keyof TenYearCashFlowInputs) => setOverrideHistory(h => ({ ...h, [field]: cascade[field] ? { originalValue: cascade[field]!.value, originalSource: cascade[field]!.source } : h[field] }));
  const useSourceValue = (field: keyof TenYearCashFlowInputs) => { setOverrides(o => { const next = { ...o }; delete next[field]; return next; }); setOverriddenFields(f => f.filter(k => k !== String(field))); setOverrideHistory(h => { const next = { ...h }; delete next[field]; return next; }); };
  const contextAvailability = useMemo(() => ({
    propertyProfile: Boolean(prefill || hasObjectValues(propertyValuation) || hasObjectValues(dealProfile)),
    propertyScrape: Boolean(prefill),
    noiTab: Boolean(hasObjectValues(noiOutputs) || hasObjectValues(leaseIncome)),
    capRateTab: Boolean(hasObjectValues(capRateOutputs)),
    gstTab: Boolean(hasObjectValues(gstOutputs) || hasObjectValues(gstInputs)),
    icrDscrTab: Boolean(hasObjectValues(icrDscrOutputs)),
    borrowingCapacity: Boolean(borrowingOutputs),
    dcfTab: Boolean(hasObjectValues(dcfInputs) || hasObjectValues(dcfOutputs)),
    researchEngine: Boolean(hasObjectValues(aiEstimateMetadata)),
    savedScenarios: Boolean(scenarioName || Object.keys(overrides).length),
  }), [prefill, propertyValuation, dealProfile, noiOutputs, leaseIncome, capRateOutputs, gstOutputs, gstInputs, icrDscrOutputs, borrowingOutputs, dcfInputs, dcfOutputs, aiEstimateMetadata, scenarioName, overrides]);
  const openEstimatePreview = (action: CashFlowAiEstimateAction) => {
    const preview = createCashFlowAiEstimatePreview(action, inputs, contextAvailability);
    if (!preview) { setEstimateMessage(INSUFFICIENT_CASH_FLOW_AI_CONTEXT_MESSAGE); setEstimatePreview(null); return; }
    setEstimateMessage(null); setEstimatePreview(preview); setEstimateEditValue(String(preview.suggestedValue));
  };
  const acceptEstimate = (edited = false) => {
    if (!estimatePreview) return;
    const value = Number(edited ? estimateEditValue : estimatePreview.suggestedValue);
    if (!Number.isFinite(value)) return;
    const field = estimatePreview.field;
    setAssumptionHistory(h => [...h, { field, value: estimatePreview.suggestedValue, source: estimatePreview.source, timestamp: new Date().toISOString() }]);
    setOverrides(o => ({ ...o, [field]: value }));
    setOverriddenFields(f => f.filter(k => k !== String(field)));
    setAiAcceptedSources(sources => ({ ...sources, [field]: edited ? 'User Override' : estimatePreview.source }));
    setVerifiedFields(fields => fields.filter(item => item !== field));
    if (edited) setOverriddenFields(f => Array.from(new Set([...f, String(field)])));
    setSourceMode('tenYearCashFlow', edited ? 'manualOverride' : 'aiPending');
    setEstimatePreview(null);
  };
  const markEstimateVerified = () => {
    if (!estimatePreview) return;
    setVerifiedFields(fields => Array.from(new Set([...fields, estimatePreview.field])));
    setEstimatePreview(null);
  };
  const annualOverrideCount = Object.values(annualOverrides).reduce((sum, row) => sum + Object.keys(row ?? {}).length, 0);
  const setAnnualOverrideCell = (field: TenYearAnnualOverrideField, year: number, value: number, originalValue: number) => {
    if (!Number.isFinite(value)) return;
    const timestamp = new Date().toISOString();
    const cell: TenYearAnnualOverrideCell = { value, originalValue, user: 'Current user', timestamp };
    setAnnualOverrides(current => ({ ...current, [field]: { ...(current[field] ?? {}), [year]: cell } }));
    setAssumptionHistory(history => [...history, { field, year, value, source: 'Annual Override', timestamp }]);
  };
  const resetAnnualOverrideCell = (field: TenYearAnnualOverrideField, year: number) => setAnnualOverrides(current => {
    const row = { ...(current[field] ?? {}) };
    delete row[year];
    return { ...current, [field]: row };
  });
  const resetAnnualOverrideRow = (field: TenYearAnnualOverrideField) => setAnnualOverrides(current => { const next = { ...current }; delete next[field]; return next; });
  const resetAllAnnualOverrides = () => setAnnualOverrides({});
  const generateCashFlow = () => {
    if (!modelReady) return;
    setGeneratedCashFlow({ result, generatedAt: new Date().toISOString(), signature: generationSignature, calculationVersion: TEN_YEAR_CALCULATION_VERSION });
  };
  const togglePdfOption = (key: keyof typeof pdfOptions) => setPdfOptions(options => ({ ...options, [key]: !options[key] }));
  const buildGeneratedCommentary = () => {
    const leveredIrr = reportResult.summary.leveredIrr == null ? 'Pending' : `${(reportResult.summary.leveredIrr * 100).toFixed(1)}%`;
    const equityMultiple = reportResult.summary.equityMultiple == null ? 'Pending' : `${reportResult.summary.equityMultiple.toFixed(2)}x`;
    const riskList = priorityWarnings.length ? priorityWarnings.map(w => `${w.category}: ${w.message}`).join(' ') : 'No priority warnings are currently shown.';
    return `Investment summary: The generated 10-year cashflow has been prepared for ${scenarioName || 'the selected scenario'} using the current validated assumptions. Year 1 cashflow: Year 1 after-tax cashflow is ${fmt(reportResult.summary.year1AfterTaxCashflow)} and Year 1 NOI is ${fmt(reportResult.summary.year1Noi)}. Year 10 equity position: projected Year 10 equity is ${fmt(reportResult.summary.year10Equity)}. Cumulative after-tax cashflow: ${fmt(reportResult.summary.cumulativeAfterTaxCashflow)}. Levered IRR: ${leveredIrr}. Equity multiple: ${equityMultiple}. Key income assumptions: passing rent ${fmt(inputs.passingRent)}, rent growth ${inputs.rentGrowthPct}%, vacancy allowance ${inputs.vacancyAllowancePct}% and recovered outgoings ${fmt(inputs.recoveredOutgoings)}. Key debt assumptions: loan amount ${fmt(inputs.loanAmount)}, interest rate ${inputs.interestRatePct}%, repayment type ${title(inputs.repaymentType)} and amortisation ${inputs.amortisationYears} years. Key capex / leasing assumptions: annual capex reserve ${fmt(inputs.annualCapexReserve)}, major capex ${fmt(inputs.majorCapexAmount ?? 0)}, downtime ${inputs.downtimeMonths} months and tenant incentives ${inputs.incentiveMonths} months. Exit value method: exit value has been modelled using ${exitValueMethod}. Main risks: ${riskList} Recommended review items: confirm source documents, tax/GST treatment, lease assumptions, capex allowances, debt terms and exit-value reconciliation before client reliance. Internal assumption references: passingRent, rentGrowthPct, vacancyAllowancePct, recoveredOutgoings, loanAmount, interestRatePct, annualCapexReserve, downtimeMonths, incentiveMonths and terminalCapRatePct.`;
  };
  const regenerateCommentary = () => {
    if (!generatedCashFlow) return;
    const commentary = buildGeneratedCommentary();
    setGeneratedCommentary(commentary);
    setEditableCommentary(commentary);
    setCommentarySignature(generationSignature);
    setCommentaryEditing(false);
  };
  const commentaryOutOfDate = Boolean(generatedCommentary && commentarySignature !== generationSignature);

  const s = reportResult.summary;
  const pending = !modelReady;
  const year10 = reportResult.years[9];
  const year10CapitalGrowthValue = year10?.propertyValue ?? null;
  const terminalCapValue = year10?.terminalValue ?? null;
  const exitValueDifference = year10CapitalGrowthValue != null && terminalCapValue != null ? year10CapitalGrowthValue - terminalCapValue : null;
  const exitValueDifferencePct = exitValueDifference != null && year10CapitalGrowthValue && year10CapitalGrowthValue > 0 ? exitValueDifference / year10CapitalGrowthValue : null;
  const exitValueMaterialDifference = exitValueDifferencePct != null && Math.abs(exitValueDifferencePct) > EXIT_VALUE_DIFFERENCE_THRESHOLD;
  const selectedExitValueUsed = exitValueMethod === 'Capital Growth Value'
    ? year10CapitalGrowthValue
    : exitValueMethod === 'Terminal Cap Value'
      ? terminalCapValue
      : exitValueMethod === 'Lower of Capital Growth / Terminal Cap'
        ? Math.min(year10CapitalGrowthValue ?? 0, terminalCapValue ?? 0)
        : Number(manualVerifiedExitValue) || null;
  const exitValuePdfBlocked = Boolean(generatedCashFlow && generatedCurrent && (exitValueMaterialDifference || exitValueMethod === 'Manual Verified Exit Value') && !exitReconciliationConfirmed);
  const validationWarnings: CashFlowValidationWarning[] = [];
  const addWarning = (category: CashFlowWarningCategory, severity: CashFlowWarningSeverity, message: string) => validationWarnings.push({ category, severity, message });
  if (!hasPositive(inputs.purchasePrice)) addWarning('Property', 'Required', 'Purchase price is required before the cashflow report can be generated.');
  if (!hasPositive(inputs.totalCostBase) && !hasPositive(inputs.totalAcquisitionCosts)) addWarning('Property', 'Required', 'Total cost base or acquisition costs are required.');
  if (!yearOneNoiReady) addWarning('Income', 'Required', 'Year 1 NOI, passing rent, recovered outgoings or expenses must be completed.');
  if (sourceFor('passingRent') !== 'NOI Tab') addWarning('Income', 'Recommended', 'NOI is not linked to the NOI tab. Review source quality before reporting.');
  if (!Number.isFinite(inputs.vacancyAllowancePct)) addWarning('Vacancy', 'Required', 'Vacancy allowance is required.');
  if (!Number.isFinite(inputs.outgoingsGrowthPct)) addWarning('Outgoings', 'Required', 'Outgoings growth is required.');
  if (debtEnabled && !debtInputsReady) addWarning('Debt', 'Required', 'Debt assumptions are incomplete. Confirm loan amount, rate and term.');
  if (debtEnabled && !hasPositive(inputs.loanAmount)) addWarning('Debt', 'Critical', 'Debt is enabled but loan balance is zero.');
  if (!debtEnabled && reportResult.summary.leveredIrr != null) addWarning('Debt', 'Recommended', 'Levered IRR is displayed while the debt section is zero.');
  if (!hasPositive(inputs.taxRatePct) || inputs.accountantReviewRequired) addWarning('Tax', 'Recommended', 'Tax assumptions are unverified. Specialist review is recommended.');
  if (!hasPositive(inputs.gstEconomicCost)) addWarning('GST', 'Recommended', 'GST economic cost is unknown or nil. Confirm GST treatment.');
  if (!hasPositive(inputs.annualCapexReserve) && !capexNoneConfirmed) addWarning('Capex', 'Required', 'Capex estimates are zero or incomplete. Confirm capex reserve or confirm none.');
  if (!Number.isFinite(inputs.downtimeMonths) || !Number.isFinite(inputs.incentiveMonths)) addWarning('Leasing', 'Recommended', 'Lease downtime and tenant incentive assumptions should be reviewed.');
  if (sourceFor('rentGrowthPct') === 'AI Estimate' || sourceFor('rentGrowthPct') === 'Research Engine') addWarning('AI / Research', 'Recommended', 'Rent growth is AI/research-estimated and not verified.');
  if (sourceFor('terminalCapRatePct') === 'AI Estimate' || sourceFor('terminalCapRatePct') === 'Research Engine') addWarning('AI / Research', 'Recommended', 'Terminal cap rate is AI/research-estimated and not verified.');
  if (annualOverrideCount > 0) addWarning('Manual Overrides', 'Recommended', 'Annual overrides are active. Review assumption history before generating report.');
  if (overriddenFields.length > 0) addWarning('Manual Overrides', 'Recommended', 'Manual source overrides are present and should be verified.');
  if (exitValueMaterialDifference) addWarning('Exit Value', 'Required', 'Exit value methods materially differ. Confirm which value should be used for client reporting.');
  if (!generatedCashFlow) addWarning('Report Export', 'Required', 'Cashflow has not been generated.');
  if (generatedOutOfDate) addWarning('Report Export', 'Critical', 'Cashflow is out of date. Regenerate before exporting.');
  if (exitValuePdfBlocked) addWarning('Report Export', 'Required', 'PDF report is blocked until exit value reconciliation is confirmed.');
  result.warnings.forEach(message => addWarning('Report Export', /must|required/i.test(message) ? 'Required' : 'Recommended', message));
  const severityRank: Record<CashFlowWarningSeverity, number> = { Critical: 0, Required: 1, Recommended: 2 };
  const priorityWarnings = [...validationWarnings].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]).slice(0, 5);
  const groupedWarnings = validationWarnings.reduce<Record<string, CashFlowValidationWarning[]>>((groups, warning) => ({ ...groups, [warning.category]: [...(groups[warning.category] ?? []), warning] }), {});
  const reportStatus = reportVerified && generatedCurrent && validationWarnings.every(w => w.severity === 'Recommended')
    ? 'Report Verified'
    : !generatedCashFlow
      ? modelReady ? 'Ready to Generate' : validationWarnings.some(w => w.severity === 'Required' || w.severity === 'Critical') ? 'Awaiting Cash Flow Inputs' : 'Preliminary Cash Flow Estimate'
      : generatedOutOfDate
        ? 'Cash Flow Out of Date'
      : validationWarnings.some(w => w.severity === 'Critical' || w.severity === 'Required')
          ? 'Report Review Required'
          : exitReconciliationConfirmed || !exitValueMaterialDifference
          ? 'PDF Ready'
          : 'Cash Flow Generated';
  const nextAction = reportStatus === 'Ready to Generate'
    ? 'Report is ready to generate.'
    : generatedOutOfDate
      ? 'Cashflow is out of date. Regenerate before exporting.'
      : !modelReady
        ? validationWarnings.some(w => w.category === 'Debt') ? 'Debt assumptions are incomplete. Confirm loan amount, rate and term.' : 'Complete missing assumptions before generating the report.'
        : exitValuePdfBlocked
          ? 'Exit value requires confirmation before PDF export.'
          : validationWarnings.some(w => w.category === 'AI / Research')
            ? 'Review AI estimates before applying them.'
            : generatedCurrent
              ? reportVerified ? 'Report is ready for PDF generation.' : 'Report is ready for PDF generation.'
              : 'Complete missing assumptions before generating the report.';
  const criticalWarnings = validationWarnings.filter(w => w.severity === 'Critical');
  const requiredWarnings = validationWarnings.filter(w => w.severity === 'Required');
  const preliminaryPdfWarnings = validationWarnings.filter(w => w.severity === 'Recommended' && ['AI / Research', 'Manual Overrides', 'Tax', 'GST'].includes(w.category));
  const pdfGenerationBlocked = !generatedCashFlow || generatedOutOfDate || criticalWarnings.length > 0 || requiredWarnings.length > 0 || exitValuePdfBlocked;
  const buildPdfHtml = () => {
    const safe = escapeHtml;
    const rows = reportResult.years.map(year => `<tr><td>${safe(year.year)}</td><td>${safe(fmt(year.propertyValue))}</td><td>${safe(fmt(year.actualNoi))}</td><td>${safe(fmt(year.totalCapex))}</td><td>${safe(fmt(year.afterTaxCashflow))}</td><td>${safe(fmt(year.equityPosition))}</td></tr>`).join('');
    const warnings = priorityWarnings.map(warning => `<li><strong>${safe(warning.category)} · ${safe(warning.severity)}:</strong> ${safe(warning.message)}</li>`).join('') || '<li>No priority warnings.</li>';
    const assumptions = [`Rent growth: ${inputs.rentGrowthPct}%`, `Vacancy allowance: ${inputs.vacancyAllowancePct}%`, `Terminal cap rate: ${inputs.terminalCapRatePct}%`, `Capital growth: ${inputs.capitalGrowthPct}%`, `Tax rate: ${inputs.taxRatePct}%`].map(item => `<li>${safe(item)}</li>`).join('');
    return `<!doctype html><html><head><title>10-Year Cash Flow Report</title><style>body{font-family:Arial,sans-serif;color:#111827;margin:32px}h1,h2{color:#0f172a}.cover{border-bottom:3px solid #2563eb;padding-bottom:16px;margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{border:1px solid #d1d5db;border-radius:8px;padding:12px;margin:8px 0}.muted{color:#6b7280}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #d1d5db;padding:6px;text-align:right}th:first-child,td:first-child{text-align:left}@media print{button{display:none}.page-break{break-before:page}}</style></head><body><section class="cover"><h1>10-Year Cash Flow Report</h1><p class="muted">${safe(scenarioName || '10-Year Cash Flow Scenario')} · ${safe(TEN_YEAR_REPORT_VERSION)}</p><p>${safe((dealProfile as any)?.address ?? (dealProfile as any)?.propertyAddress ?? 'Property address not provided')}</p></section>${pdfOptions.assumptions ? `<section><h2>Key Assumptions</h2><ul>${assumptions}</ul></section>` : ''}<section><h2>Source and Verification Summary</h2><p>Data source: ${safe(buildGlobalSyncLabel(sourceMode as CalculatorSourceMode))}. Readiness status: ${safe(reportStatus)}. Generated: ${safe(generatedCashFlow ? new Date(generatedCashFlow.generatedAt).toLocaleString('en-AU') : PENDING)}.</p></section>${pdfOptions.summaryCards ? `<section><h2>Summary Output Cards</h2><div class="grid"><div class="card">Year 1 NOI<br/><strong>${safe(fmt(s.year1Noi))}</strong></div><div class="card">Year 10 Property Value<br/><strong>${safe(fmt(s.year10PropertyValue))}</strong></div><div class="card">Year 10 Equity<br/><strong>${safe(fmt(s.year10Equity))}</strong></div><div class="card">Cumulative After-Tax Cashflow<br/><strong>${safe(fmt(s.cumulativeAfterTaxCashflow))}</strong></div></div></section>` : ''}${pdfOptions.fullTable ? `<section class="page-break"><h2>10-Year Cashflow Table</h2><table><thead><tr><th>Year</th><th>Property Value</th><th>Actual NOI</th><th>Total Capex</th><th>After-Tax Cashflow</th><th>Equity Position</th></tr></thead><tbody>${rows}</tbody></table></section>` : ''}<section><h2>Valuation / Exit Value</h2><p>Year 10 capital growth value: ${safe(fmt(year10CapitalGrowthValue))}. Terminal cap value: ${safe(fmt(terminalCapValue))}. Selected method: ${safe(exitValueMethod)}. Selected exit value: ${safe(fmt(selectedExitValueUsed))}.</p></section><section><h2>Debt Metrics</h2><p>Loan amount: ${safe(fmt(inputs.loanAmount))}. Interest rate: ${safe(inputs.interestRatePct)}%. Repayment type: ${safe(title(inputs.repaymentType))}.</p></section><section><h2>NOI and Cashflow</h2><p>Year 1 NOI: ${safe(fmt(s.year1Noi))}. Year 1 after-tax cashflow: ${safe(fmt(s.year1AfterTaxCashflow))}.</p></section><section><h2>Capex and Leasing</h2><p>Annual capex reserve: ${safe(fmt(inputs.annualCapexReserve))}. Downtime: ${safe(inputs.downtimeMonths)} months. Tenant incentives: ${safe(inputs.incentiveMonths)} months.</p></section>${pdfOptions.warnings ? `<section><h2>Warnings and Assumptions</h2><ul>${warnings}</ul></section>` : ''}${pdfOptions.scenarioNotes ? `<section><h2>Scenario Notes</h2><h3>Base case</h3><p>${safe(scenarioNotes.base)}</p><h3>Conservative case</h3><p>${safe(scenarioNotes.conservative)}</p><h3>Upside case</h3><p>${safe(scenarioNotes.upside)}</p><h3>Manual scenario note</h3><p>${safe(scenarioNotes.manual || 'No manual scenario note provided.')}</p></section>` : ''}${pdfOptions.commentary ? `<section><h2>Report Commentary</h2><p>${safe(editableCommentary || generatedCommentary || reportResult.commentary)}</p></section>` : ''}${pdfOptions.aiEstimateNotes ? `<section><h2>AI Estimate Notes</h2><p>AI/research estimates, if accepted, remain subject to verification and review before client reliance.</p></section>` : ''}${pdfOptions.formulaNotes ? `<section><h2>Formula Notes</h2><p>Calculated rows are protected. Annual overrides affect assumptions only where explicitly applied.</p></section>` : ''}<section><h2>Disclaimer / Estimate Note</h2><p>This report is an estimate and should be reviewed against lease documents, tax/GST advice, lender terms and market evidence before client reliance.</p></section></body></html>`;
  };

  const runPdfGeneration = () => {
    const timestamp = new Date().toISOString();
    const reportWindow = window.open('', '_blank');
    if (reportWindow) {
      reportWindow.opener = null;
      reportWindow.document.open();
      reportWindow.document.write(buildPdfHtml());
      reportWindow.document.close();
      reportWindow.focus();
      reportWindow.print();
    }
    setLastPdfGeneratedAt(timestamp);
    setPdfExportHistory(history => [...history, { timestamp, calculationVersion: generatedCashFlow?.calculationVersion ?? TEN_YEAR_CALCULATION_VERSION, reportVersion: TEN_YEAR_REPORT_VERSION, scenarioName: scenarioName || '10-Year Cash Flow Scenario' }]);
    setPdfConfirmOpen(false);
  };
  const exportScenarioData = () => {
    const payload = { scenarioName, property: dealProfile, generatedCashFlow, pdfOptions, annualOverrides, exportHistory: pdfExportHistory, reportVersion: TEN_YEAR_REPORT_VERSION };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(scenarioName || 'ten-year-cash-flow-scenario').replace(/\s+/g, '-').toLowerCase()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const assumptionPlaceholders: Partial<Record<keyof TenYearCashFlowInputs, string>> = { purchasePrice: 'Pulled from property profile or enter manually', totalCostBase: 'Calculated from purchase price, costs and GST', passingRent: 'Pulled from NOI or enter manually', rentGrowthPct: 'Pulled from research engine or enter manually', vacancyAllowancePct: 'Pulled from NOI / research or enter manually', outgoingsGrowthPct: 'Enter outgoings growth', annualCapexReserve: 'Enter capex reserve', terminalCapRatePct: 'Pulled from Cap Rate / DCF or enter manually', taxRatePct: 'Enter tax rate or confirm accountant review', gstEconomicCost: 'Pulled from GST tab or enter manually' };
  const summaryCards = mode === 'investor'
    ? [['Purchase price', s.purchasePrice], ['Total cost base', s.totalCostBase], ['Required equity', s.requiredEquity], ['Year 1 NOI', s.year1Noi], ['Year 1 after-tax cashflow', s.year1AfterTaxCashflow], ['Year 10 property value', s.year10PropertyValue], ['Year 10 equity', s.year10Equity], ['Cumulative after-tax cashflow', s.cumulativeAfterTaxCashflow], ['Levered IRR', s.leveredIrr == null ? 'Pending' : `${(s.leveredIrr * 100).toFixed(1)}%`], ['Equity multiple', s.equityMultiple == null ? 'Pending' : `${s.equityMultiple.toFixed(2)}x`], ['Terminal value', s.terminalValue]]
    : mode === 'ownerOccupier'
      ? [['Purchase price', s.purchasePrice], ['Required equity', s.requiredEquity], ['Current rent avoided', inputs.currentRentPaid], ['Year 1 ownership cash cost', reportResult.years[0]?.ownershipCashCost], ['Year 1 net saving/cost vs leasing', s.ownerOccupierNetSavingCost], ['10-year cumulative rent avoided', reportResult.years[9]?.cumulativeLeasingCostAvoided], ['Year 10 equity created', reportResult.years[9]?.equityCreated], ['Business DSCR', s.businessDscr == null ? 'Pending' : `${s.businessDscr.toFixed(2)}x`], ['Occupancy cost ratio', s.occupancyCostRatio == null ? 'Pending' : `${(s.occupancyCostRatio * 100).toFixed(1)}%`], ['Cumulative ownership benefit', s.cumulativeOwnershipBenefit]]
      : [['Property entity cashflow', s.propertyEntityCashflow], ['Operating business occupancy cost', reportResult.years[0]?.operatingBusinessOccupancyCost], ['Group cashflow', s.groupCashflow], ['Group DSCR', s.groupDscr == null ? 'Pending' : `${s.groupDscr.toFixed(2)}x`], ['Equity created', reportResult.years[9]?.equityCreated], ['Internal rent neutralisation', 'Shown in group view'], ['Required equity', s.requiredEquity], ['Year 10 property value', s.year10PropertyValue], ['Cumulative group benefit', s.cumulativeGroupBenefit]];

  return <Card className="bg-card/95"><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /> 10-Year Cash Flow</CardTitle><CardDescription>Commercial / industrial projection for investor, owner-occupier and related-party lease scenarios. AI supports assumptions; deterministic formulas produce the table.</CardDescription></div><div className="flex gap-2"><Badge variant="outline">{buildGlobalSyncLabel(sourceMode as CalculatorSourceMode)}</Badge><Badge variant={(pending ? 'outline' : badgeVariant(s.riskStatus)) as any}>{reportStatus}</Badge></div></div></CardHeader><CardContent className="space-y-5">
    <Collapsible open={overviewOpen} onOpenChange={setOverviewOpen}>
      <Card className="border-primary/30 bg-primary/5">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-primary/10 transition-colors">
            <div>
              <h3 className="font-semibold text-primary">10-Year Cash Flow Report Overview</h3>
              <p className="mt-1 text-xs text-muted-foreground">Purpose, DCF differences, assumptions, validation and PDF-ready report outputs.</p>
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 text-primary transition-transform ${overviewOpen ? 'rotate-180' : ''}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3 pt-0 text-sm text-muted-foreground leading-relaxed">
            <p>This section converts the property, income, debt, GST, capex and exit assumptions into a 10-year projection that can be reviewed internally and included in a client-ready report.</p>
            <p>The 10-year cash flow report is designed to show how the asset may perform over time, including rental growth, vacancy, recovered outgoings, owner-borne expenses, debt position, ICR, DSCR, debt yield, capex, leasing costs, after-tax cashflow, equity position and exit value.</p>
            <p>Unlike the DCF tab, which focuses on IRR, NPV and terminal value analysis, this report focuses on a readable year-by-year client projection and PDF-ready output.</p>
            <div>
              <p className="font-medium text-foreground">This report separates:</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Editable assumptions</li>
                <li>AI / research-supported estimates</li>
                <li>Global property-linked inputs</li>
                <li>Manual overrides</li>
                <li>Protected calculated outputs</li>
                <li>Warnings and validation checks</li>
                <li>Final report commentary</li>
                <li>PDF-ready cashflow tables</li>
              </ol>
            </div>
            <p>All outputs are estimates and should be reviewed against property data, lease assumptions, lender terms, tax advice and market evidence before being issued to clients.</p>
            <details className="rounded border border-primary/20 bg-card/70 p-3">
              <summary className="cursor-pointer font-medium text-primary">Why this matters</summary>
              <p className="mt-2">This report helps explain the projected investment journey over 10 years. It allows clients to see income growth, vacancy impact, capex, debt reduction, equity growth, cashflow and exit value in a single readable format.</p>
            </details>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
    <Card className="border-primary/20 bg-card/80"><CardContent className="pt-4"><div className="flex flex-wrap gap-2 text-xs">{['1 Review overview', '2 Set assumptions', '3 Review AI estimates', '4 Validate warnings', '5 Generate cashflow', '6 Review output', '7 Edit commentary', '8 Generate PDF'].map((step, index) => <Badge key={step} variant={index < 4 || generatedCashFlow ? 'secondary' : 'outline'} className="rounded-full">{step}</Badge>)}</div></CardContent></Card>
    <TooltipProvider delayDuration={200}>
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base flex items-center gap-2"><Calculator className="h-4 w-4 text-primary" /> Assumption Workspace</CardTitle><Button type="button" size="sm" variant="outline" onClick={() => setAssumptionsOpen(v => !v)}>{assumptionsOpen ? 'Collapse assumptions' : 'Expand assumptions'}</Button></div>
          <CardDescription>Editable and cascaded assumptions are grouped separately from protected calculated outputs. Source badges include text labels and manual overrides are flagged.</CardDescription>
        </CardHeader>
        {assumptionsOpen && <CardContent className="space-y-4">
          <div className="rounded-lg border border-primary/20 bg-card/60 p-3">
            <h3 className="mb-3 text-sm font-semibold text-primary">Cashflow assumptions · Model setup</h3>
            <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-3">
              <AssumptionField label="Cash Flow Mode" source="Manual" tooltip="Selects the investor, owner-occupier or related-party lease model view. Formula logic is unchanged."><Select value={mode} onValueChange={v => setMode(v as TenYearCashFlowMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="investor">Investor</SelectItem><SelectItem value="ownerOccupier">Business Owner-Occupier</SelectItem><SelectItem value="relatedPartyLease">Related-Party Lease</SelectItem></SelectContent></Select></AssumptionField>
              <AssumptionField label="Data Source" source={sourceMode === 'savedPropertyLinked' ? 'Property Profile' : sourceMode === 'manualOverride' ? 'Manual' : sourceMode === 'aiPending' ? 'AI Estimate' : 'Blank'} tooltip="Controls whether values are treated as global synced inputs, manual/no property linked, AI pending or saved property linked."><Select value={sourceMode} onValueChange={v => setSourceMode('tenYearCashFlow', v as CalculatorSourceMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="global">Use Global Deal Inputs</SelectItem><SelectItem value="manualOverride">Manual entry / no property linked</SelectItem><SelectItem value="aiPending">AI Estimate Pending</SelectItem><SelectItem value="savedPropertyLinked">Saved Property Linked</SelectItem></SelectContent></Select></AssumptionField>
              <AssumptionField label="Projection Period" source="Verified" tooltip="This report is currently a protected 10-year output; changing this label does not alter formulas in this phase."><Input type="number" value={projectionPeriod} onChange={e => setProjectionPeriod(e.target.value)} /></AssumptionField>
              <AssumptionField label="Property Domain" source={prefill ? 'Property Profile' : 'Manual'} tooltip="Commercial or industrial domain used to label the scenario; calculation formulas are preserved."><Select value={inputs.assetDomain} onValueChange={v => updateTextOverride('assetDomain', v as TenYearCashFlowInputs['assetDomain'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="commercial">Commercial</SelectItem><SelectItem value="industrial">Industrial</SelectItem></SelectContent></Select></AssumptionField>
              <AssumptionField label="Scenario Name" source={scenarioName ? 'Manual' : 'Blank'} tooltip="Optional report scenario label for internal review and client-ready reporting."><Input value={scenarioName} onChange={e => setScenarioName(e.target.value)} placeholder="Enter scenario name" /></AssumptionField>
              <AssumptionField label="Include in Report" source="Manual" tooltip="Controls whether this scenario is intended for report inclusion; it does not change formulas."><Button type="button" variant={includeInReport ? 'default' : 'outline'} onClick={() => setIncludeInReport(v => !v)}>{includeInReport ? 'Included' : 'Excluded'}</Button></AssumptionField>
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-card/60 p-3">
            <h3 className="mb-3 text-sm font-semibold text-primary">2. Property & Cost Inputs</h3>
            <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-3">
              <OverrideNumber label="Purchase Price" field="purchasePrice" value={inputs.purchasePrice} update={updateOverride} placeholder={assumptionPlaceholders.purchasePrice} pending={pending && !overrides.purchasePrice} source={sourceFor('purchasePrice', prefill ? 'Property Profile' : 'Blank')} tooltip="Pulled from the linked property profile or entered manually." overridden={isOverridden('purchasePrice')} sourceConflict={hasSourceConflict('purchasePrice' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('purchasePrice' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('purchasePrice' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Acquisition Costs" field="totalAcquisitionCosts" value={inputs.totalAcquisitionCosts} update={updateOverride} pending={pending && !overrides.totalAcquisitionCosts} source={sourceFor('totalAcquisitionCosts', fundsToComplete ? 'Borrowing Capacity' : 'Blank')} tooltip="Acquisition cost input cascaded from borrowing/funds-to-complete where available." overridden={isOverridden('totalAcquisitionCosts')} sourceConflict={hasSourceConflict('totalAcquisitionCosts' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('totalAcquisitionCosts' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('totalAcquisitionCosts' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="GST Economic Cost" field="gstEconomicCost" value={inputs.gstEconomicCost} update={updateOverride} placeholder={assumptionPlaceholders.gstEconomicCost} pending={pending && !overrides.gstEconomicCost} source={sourceFor('gstEconomicCost', gstOutputs ? 'GST Tab' : 'Blank')} tooltip="Pulled from GST tab or entered manually." overridden={isOverridden('gstEconomicCost')} sourceConflict={hasSourceConflict('gstEconomicCost' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('gstEconomicCost' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('gstEconomicCost' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Total Cost Base" field="totalCostBase" value={inputs.totalCostBase} update={updateOverride} placeholder={assumptionPlaceholders.totalCostBase} pending={pending && !overrides.totalCostBase} source={sourceFor('totalCostBase', fundsToComplete ? 'Borrowing Capacity' : 'Blank')} tooltip="Calculated from purchase price, costs and GST in upstream modules or entered manually." overridden={isOverridden('totalCostBase')} sourceConflict={hasSourceConflict('totalCostBase' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('totalCostBase' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('totalCostBase' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Required Equity" field="requiredEquity" value={inputs.requiredEquity} update={updateOverride} pending={pending && !overrides.requiredEquity} source={sourceFor('requiredEquity', borrowingOutputs ? 'Borrowing Capacity' : 'Blank')} tooltip="Required equity cascaded from borrowing capacity/funds-to-complete or manually overridden." overridden={isOverridden('requiredEquity')} sourceConflict={hasSourceConflict('requiredEquity' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('requiredEquity' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('requiredEquity' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Available Equity" field="availableEquity" value={inputs.availableEquity} update={updateOverride} pending={pending && !overrides.availableEquity} source={sourceFor('availableEquity', prefill ? 'Property Profile' : 'Blank')} tooltip="Available equity from the purchaser profile or manual scenario input." overridden={isOverridden('availableEquity')} sourceConflict={hasSourceConflict('availableEquity' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('availableEquity' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('availableEquity' as keyof TenYearCashFlowInputs)} />
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-card/60 p-3">
            <h3 className="mb-3 text-sm font-semibold text-primary">3. Income Assumptions</h3>
            <div className="grid md:grid-cols-3 xl:grid-cols-7 gap-3">
              <OverrideNumber label="Passing Rent" field="passingRent" value={inputs.passingRent} update={updateOverride} placeholder={assumptionPlaceholders.passingRent} pending={pending && !overrides.passingRent} source={sourceFor('passingRent', noiOutputs ? 'NOI Tab' : prefill ? 'Property Profile' : 'Blank')} tooltip="Passing rent pulled from NOI/property data or entered manually." overridden={isOverridden('passingRent')} sourceConflict={hasSourceConflict('passingRent' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('passingRent' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('passingRent' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Rent Growth %" field="rentGrowthPct" value={inputs.rentGrowthPct} update={updateOverride} suffix="%" placeholder={assumptionPlaceholders.rentGrowthPct} pending={pending && !overrides.rentGrowthPct} source={sourceFor('rentGrowthPct', 'Research Engine')} tooltip="Rent growth assumption from research engine or manual override." overridden={isOverridden('rentGrowthPct')} sourceConflict={hasSourceConflict('rentGrowthPct' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('rentGrowthPct' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('rentGrowthPct' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Vacancy Allowance %" field="vacancyAllowancePct" value={inputs.vacancyAllowancePct} update={updateOverride} suffix="%" placeholder={assumptionPlaceholders.vacancyAllowancePct} pending={pending && !overrides.vacancyAllowancePct} source={sourceFor('vacancyAllowancePct', noiOutputs ? 'NOI Tab' : 'Research Engine')} tooltip="Vacancy allowance from NOI/research or manual override." overridden={isOverridden('vacancyAllowancePct')} sourceConflict={hasSourceConflict('vacancyAllowancePct' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('vacancyAllowancePct' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('vacancyAllowancePct' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Recovered Outgoings" field="recoveredOutgoings" value={inputs.recoveredOutgoings} update={updateOverride} pending={pending && !overrides.recoveredOutgoings} source={sourceFor('recoveredOutgoings', noiOutputs ? 'NOI Tab' : 'Blank')} tooltip="Recovered outgoings from NOI tab or manually entered." overridden={isOverridden('recoveredOutgoings')} sourceConflict={hasSourceConflict('recoveredOutgoings' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('recoveredOutgoings' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('recoveredOutgoings' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Outgoings Growth %" field="outgoingsGrowthPct" value={inputs.outgoingsGrowthPct} update={updateOverride} suffix="%" placeholder={assumptionPlaceholders.outgoingsGrowthPct} pending={pending && !overrides.outgoingsGrowthPct} source={sourceFor('outgoingsGrowthPct', 'Research Engine')} tooltip="Outgoings growth assumption used by the year-by-year projection." overridden={isOverridden('outgoingsGrowthPct')} sourceConflict={hasSourceConflict('outgoingsGrowthPct' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('outgoingsGrowthPct' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('outgoingsGrowthPct' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Owner-Borne Expenses" field="otherOwnerExpenses" value={inputs.otherOwnerExpenses} update={updateOverride} pending={pending && !overrides.otherOwnerExpenses} source={sourceFor('otherOwnerExpenses', noiOutputs ? 'NOI Tab' : 'Blank')} tooltip="Owner-borne expenses from NOI tab or manual entry." overridden={isOverridden('otherOwnerExpenses')} sourceConflict={hasSourceConflict('otherOwnerExpenses' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('otherOwnerExpenses' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('otherOwnerExpenses' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Expense Growth %" field="expenseGrowthPct" value={inputs.expenseGrowthPct} update={updateOverride} suffix="%" pending={pending && !overrides.expenseGrowthPct} source={sourceFor('expenseGrowthPct', 'Research Engine')} tooltip="Expense growth assumption for owner-borne expense escalation." overridden={isOverridden('expenseGrowthPct')} sourceConflict={hasSourceConflict('expenseGrowthPct' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('expenseGrowthPct' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('expenseGrowthPct' as keyof TenYearCashFlowInputs)} />
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-card/60 p-3">
            <h3 className="mb-3 text-sm font-semibold text-primary">4. Debt Assumptions</h3>
            <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-3">
              <OverrideNumber label="Loan Amount" field="loanAmount" value={inputs.loanAmount} update={updateOverride} pending={pending && !overrides.loanAmount} source={sourceFor('loanAmount', borrowingOutputs ? 'Borrowing Capacity' : 'Blank')} tooltip="Loan amount from borrowing capacity or manual override." overridden={isOverridden('loanAmount')} sourceConflict={hasSourceConflict('loanAmount' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('loanAmount' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('loanAmount' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Interest Rate" field="interestRatePct" value={inputs.interestRatePct} update={updateOverride} suffix="%" pending={pending && !overrides.interestRatePct} source={sourceFor('interestRatePct', borrowingOutputs ? 'Borrowing Capacity' : 'ICR / DSCR Tab')} tooltip="Interest rate used for debt service and cashflow calculations." overridden={isOverridden('interestRatePct')} sourceConflict={hasSourceConflict('interestRatePct' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('interestRatePct' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('interestRatePct' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Loan Term" field="amortisationYears" value={inputs.amortisationYears} update={updateOverride} pending={pending && !overrides.amortisationYears} source={sourceFor('amortisationYears', borrowingOutputs ? 'Borrowing Capacity' : 'Blank')} tooltip="Loan amortisation term used by existing debt formulas." overridden={isOverridden('amortisationYears')} sourceConflict={hasSourceConflict('amortisationYears' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('amortisationYears' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('amortisationYears' as keyof TenYearCashFlowInputs)} />
              <AssumptionField label="Repayment Type" source={sourceFor('repaymentType', borrowingOutputs ? 'Borrowing Capacity' : 'Blank')} tooltip="Repayment type applied to existing debt-service formulas." overridden={isOverridden('repaymentType')}><Select value={inputs.repaymentType} onValueChange={v => updateTextOverride('repaymentType', v as TenYearCashFlowInputs['repaymentType'])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="principalAndInterest">Principal & Interest</SelectItem><SelectItem value="interestOnly">Interest Only</SelectItem></SelectContent></Select></AssumptionField>
              <OverrideNumber label="Annual Debt Service" field="annualDebtService" value={inputs.annualDebtService} update={updateOverride} pending={pending && !overrides.annualDebtService} source={sourceFor('annualDebtService', borrowingOutputs ? 'Borrowing Capacity' : 'ICR / DSCR Tab')} tooltip="Annual debt service from borrowing or ICR/DSCR workflows." overridden={isOverridden('annualDebtService')} sourceConflict={hasSourceConflict('annualDebtService' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('annualDebtService' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('annualDebtService' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Opening Loan Balance" field="loanAmount" value={inputs.loanAmount} update={updateOverride} pending={pending && !overrides.loanAmount} source={sourceFor('loanAmount', borrowingOutputs ? 'Borrowing Capacity' : 'Blank')} tooltip="Opening balance is the same protected loan amount input used by the projection." overridden={isOverridden('loanAmount')} sourceConflict={hasSourceConflict('loanAmount' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('loanAmount' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('loanAmount' as keyof TenYearCashFlowInputs)} />
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-card/60 p-3">
            <h3 className="mb-3 text-sm font-semibold text-primary">5. Leasing / Vacancy Assumptions</h3>
            <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-3">
              <OverrideNumber label="Lease Downtime Months" field="downtimeMonths" value={inputs.downtimeMonths} update={updateOverride} pending={pending && !overrides.downtimeMonths} source={sourceFor('downtimeMonths', 'Manual')} tooltip="Assumed vacancy downtime at lease event or rollover." overridden={isOverridden('downtimeMonths')} sourceConflict={hasSourceConflict('downtimeMonths' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('downtimeMonths' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('downtimeMonths' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Tenant Incentives" field="incentiveMonths" value={inputs.incentiveMonths} update={updateOverride} pending={pending && !overrides.incentiveMonths} source={sourceFor('incentiveMonths', 'Manual')} tooltip="Incentive months used in leasing cost calculations." overridden={isOverridden('incentiveMonths')} sourceConflict={hasSourceConflict('incentiveMonths' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('incentiveMonths' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('incentiveMonths' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Leasing Fees" field="leasingFeePct" value={inputs.leasingFeePct} update={updateOverride} suffix="%" pending={pending && !overrides.leasingFeePct} source={sourceFor('leasingFeePct', 'Manual')} tooltip="Leasing fee percentage for reletting costs." overridden={isOverridden('leasingFeePct')} sourceConflict={hasSourceConflict('leasingFeePct' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('leasingFeePct' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('leasingFeePct' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Reletting Costs" field="relettingCostAllowance" value={inputs.relettingCostAllowance} update={updateOverride} pending={pending && !overrides.relettingCostAllowance} source={sourceFor('relettingCostAllowance', 'Manual')} tooltip="Additional reletting allowance included in leasing/vacancy costs." overridden={isOverridden('relettingCostAllowance')} sourceConflict={hasSourceConflict('relettingCostAllowance' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('relettingCostAllowance' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('relettingCostAllowance' as keyof TenYearCashFlowInputs)} />
              <AssumptionField label="Lease Expiry Year" source={leaseExpiryYear ? 'Manual' : 'Blank'} tooltip="Optional lease-expiry reference for workspace review; formulas are unchanged in this phase."><Input type="number" value={leaseExpiryYear} onChange={e => setLeaseExpiryYear(e.target.value)} placeholder="Enter year" /></AssumptionField>
              <AssumptionField label="WALE if Available" source={waleYears ? 'Manual' : prefill ? 'Property Profile' : 'Blank'} tooltip="Optional WALE reference for review and report context; formulas are unchanged in this phase."><Input type="number" value={waleYears} onChange={e => setWaleYears(e.target.value)} placeholder="Years" /></AssumptionField>
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-card/60 p-3">
            <h3 className="mb-3 text-sm font-semibold text-primary">6. Capex Assumptions</h3>
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
              <OverrideNumber label="Annual Capex Reserve" field="annualCapexReserve" value={inputs.annualCapexReserve} update={updateOverride} placeholder={assumptionPlaceholders.annualCapexReserve} pending={pending && !overrides.annualCapexReserve} source={sourceFor('annualCapexReserve', dcfOutputs ? 'DCF Tab' : 'Manual')} tooltip="Annual capex reserve used by the protected projection formulas." overridden={isOverridden('annualCapexReserve')} sourceConflict={hasSourceConflict('annualCapexReserve' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('annualCapexReserve' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('annualCapexReserve' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Major Capex Allowance" field="majorCapexAmount" value={inputs.majorCapexAmount} update={updateOverride} pending={pending && !overrides.majorCapexAmount} source={sourceFor('majorCapexAmount', 'Manual')} tooltip="Major one-off capex allowance included in the capex schedule." overridden={isOverridden('majorCapexAmount')} sourceConflict={hasSourceConflict('majorCapexAmount' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('majorCapexAmount' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('majorCapexAmount' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Major Capex Timing" field="majorCapexYear" value={inputs.majorCapexYear} update={updateOverride} pending={pending && !overrides.majorCapexYear} source={sourceFor('majorCapexYear', 'Manual')} tooltip="Projection year for major capex allowance." overridden={isOverridden('majorCapexYear')} sourceConflict={hasSourceConflict('majorCapexYear' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('majorCapexYear' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('majorCapexYear' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Specialist Reserves" field="specialistReserve" value={inputs.specialistReserve} update={updateOverride} pending={pending && !overrides.specialistReserve} source={sourceFor('specialistReserve', inputs.assetDomain === 'industrial' ? 'Research Engine' : 'Manual')} tooltip="Specialist reserve for commercial/industrial risk items." overridden={isOverridden('specialistReserve')} sourceConflict={hasSourceConflict('specialistReserve' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('specialistReserve' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('specialistReserve' as keyof TenYearCashFlowInputs)} />
              <AssumptionField label="No Capex Reserve" source={capexNoneConfirmed ? 'Manual' : 'Blank'} tooltip="Use only when annual capex reserve is confirmed as nil for this scenario."><Button type="button" variant={capexNoneConfirmed ? 'default' : 'outline'} onClick={() => setCapexNoneConfirmed(v => !v)}>{capexNoneConfirmed ? 'None confirmed' : 'Confirm none'}</Button></AssumptionField>
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-card/60 p-3">
            <h3 className="mb-3 text-sm font-semibold text-primary">7. Tax / After-Tax Assumptions</h3>
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
              <OverrideNumber label="Tax Rate" field="taxRatePct" value={inputs.taxRatePct} update={updateOverride} suffix="%" placeholder={assumptionPlaceholders.taxRatePct} pending={pending && !overrides.taxRatePct} source={sourceFor('taxRatePct', 'Manual')} tooltip="Tax rate used by existing after-tax cashflow formulas; confirm with accountant review." overridden={isOverridden('taxRatePct')} sourceConflict={hasSourceConflict('taxRatePct' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('taxRatePct' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('taxRatePct' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Depreciation Allowance" field="depreciationPa" value={inputs.depreciationPa} update={updateOverride} pending={pending && !overrides.depreciationPa} source={sourceFor('depreciationPa', 'Blank')} tooltip="Depreciation allowance if supported by a depreciation schedule." overridden={isOverridden('depreciationPa')} sourceConflict={hasSourceConflict('depreciationPa' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('depreciationPa' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('depreciationPa' as keyof TenYearCashFlowInputs)} />
              <AssumptionField label="Interest Deductibility" source={interestDeductible ? 'Manual' : 'Blank'} tooltip="Workspace toggle for tax review status; formulas are unchanged in this phase."><Button type="button" variant={interestDeductible ? 'default' : 'outline'} onClick={() => setInterestDeductible(v => !v)}>{interestDeductible ? 'Supported' : 'Review required'}</Button></AssumptionField>
              <AssumptionField label="GST Economic Cost Source" source={sourceFor('gstEconomicCost', gstOutputs ? 'GST Tab' : 'Blank')} tooltip="Shows whether GST economic cost is linked from GST tab or manually overridden." overridden={isOverridden('gstEconomicCost')}><div className="text-sm text-muted-foreground">{sourceFor('gstEconomicCost', gstOutputs ? 'GST Tab' : 'Blank')}</div></AssumptionField>
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-card/60 p-3">
            <h3 className="mb-3 text-sm font-semibold text-primary">Tax and finance assumptions · Exit assumptions</h3>
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
              <OverrideNumber label="Capital Growth %" field="capitalGrowthPct" value={inputs.capitalGrowthPct} update={updateOverride} suffix="%" pending={pending && !overrides.capitalGrowthPct} source={sourceFor('capitalGrowthPct', 'Research Engine')} tooltip="Capital growth assumption used by the protected property value projection." overridden={isOverridden('capitalGrowthPct')} sourceConflict={hasSourceConflict('capitalGrowthPct' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('capitalGrowthPct' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('capitalGrowthPct' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Terminal Cap Rate %" field="terminalCapRatePct" value={inputs.terminalCapRatePct} update={updateOverride} suffix="%" placeholder={assumptionPlaceholders.terminalCapRatePct} pending={pending && !overrides.terminalCapRatePct} source={sourceFor('terminalCapRatePct', dcfOutputs ? 'DCF Tab' : 'Cap Rate Tab')} tooltip="Terminal cap rate from Cap Rate/DCF or manual override." overridden={isOverridden('terminalCapRatePct')} sourceConflict={hasSourceConflict('terminalCapRatePct' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('terminalCapRatePct' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('terminalCapRatePct' as keyof TenYearCashFlowInputs)} />
              <OverrideNumber label="Selling Costs %" field="sellingCostPct" value={inputs.sellingCostPct} update={updateOverride} suffix="%" pending={pending && !overrides.sellingCostPct} source={sourceFor('sellingCostPct', 'Manual')} tooltip="Selling cost percentage deducted from exit proceeds." overridden={isOverridden('sellingCostPct')} sourceConflict={hasSourceConflict('sellingCostPct' as keyof TenYearCashFlowInputs)} onKeepOverride={() => clearSourceConflict('sellingCostPct' as keyof TenYearCashFlowInputs)} onUseSource={() => useSourceValue('sellingCostPct' as keyof TenYearCashFlowInputs)} />
              <AssumptionField label="Exit Value Method" source="Manual" tooltip="Selects the exit value method for report reconciliation. Existing capital-growth and terminal-cap formulas are preserved."><Select value={exitValueMethod} onValueChange={setExitValueMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Capital Growth Value">Capital Growth Value</SelectItem><SelectItem value="Terminal Cap Value">Terminal Cap Value</SelectItem><SelectItem value="Lower of Capital Growth / Terminal Cap">Lower of Capital Growth / Terminal Cap</SelectItem><SelectItem value="Manual Verified Exit Value">Manual Verified Exit Value</SelectItem></SelectContent></Select>{exitValueMethod === 'Manual Verified Exit Value' && <Input type="number" className="mt-2" value={manualVerifiedExitValue} onChange={e => setManualVerifiedExitValue(e.target.value)} placeholder="Enter verified exit value" />}</AssumptionField>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-primary/20 bg-card/60 p-3">
              <div className="mb-2">
                <h3 className="text-sm font-semibold text-primary">AI Estimate Workflow</h3>
                <p className="text-xs text-muted-foreground">Estimate buttons now open a preview first. Values are not applied, verified or used as formula inputs until you accept them.</p>
              </div>
              {estimateMessage && <div className="mb-3 rounded border border-brand-500/30 bg-brand-500/10 p-2 text-xs text-brand-100">{estimateMessage}</div>}
              <div className="flex flex-wrap gap-2">{cashFlowAiEstimateActions.map(action => <Button key={action.id} type="button" size="sm" variant="outline" onClick={() => openEstimatePreview(action)}><Sparkles className="h-3.5 w-3.5 mr-1" />{action.label}</Button>)}</div>
              {assumptionHistory.length > 0 && <div className="mt-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">Assumption history:</span> {assumptionHistory.slice(-3).map(item => `${title(String(item.field))}: ${item.value} (${item.source})`).join(' · ')}</div>}
            </div>
          </div>
        </CardContent>}
      </Card>
    </TooltipProvider>
    <Card className={generatedOutOfDate ? 'border-brand-500/40 bg-brand-500/10 shadow-sm' : 'border-primary/25 bg-gradient-to-r from-primary/10 to-card shadow-sm'}><CardContent className="space-y-3 pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="max-w-2xl"><p className="font-semibold text-primary">{generatedCurrent ? '10-year cashflow generated' : generatedOutOfDate ? 'Cashflow out of date' : 'Generate 10-Year Cash Flow'}</p>{generatedCashFlow && <p className="mt-1 rounded-md bg-background/70 px-2 py-1 text-xs font-medium text-muted-foreground">Generated {new Date(generatedCashFlow.generatedAt).toLocaleString('en-AU')} · {generatedCashFlow.calculationVersion}</p>} {!generatedCashFlow && <p className="mt-1 text-xs text-muted-foreground">The cashflow table and report outputs will appear after generation.</p>}</div><div className="flex flex-wrap gap-2"><Button type="button" className="min-h-10 rounded-xl shadow-sm disabled:cursor-not-allowed disabled:bg-muted/40 disabled:text-muted-foreground disabled:opacity-100" disabled={!modelReady} onClick={generateCashFlow} title={!modelReady ? 'Complete purchase price, NOI, growth, vacancy, capex, debt and exit assumptions before generating the 10-year model.' : generatedOutOfDate ? 'Regenerate Cash Flow' : 'Generate 10-Year Cash Flow'}>{generatedOutOfDate ? 'Regenerate Cash Flow' : generatedCurrent ? 'Regenerate Cash Flow' : 'Generate 10-Year Cash Flow'}</Button>{generatedCurrent && !exitValuePdfBlocked && <Button type="button" className="min-h-10 rounded-xl shadow-sm" variant={reportVerified ? 'default' : 'outline'} onClick={() => setReportVerified(v => !v)}>{reportVerified ? 'Report Verified' : 'Mark Report Verified'}</Button>}</div></div>{!modelReady && <p className="rounded-lg border border-border/70 bg-background/70 p-2 text-xs font-medium text-muted-foreground">Complete purchase price, NOI, growth, vacancy, capex, debt and exit assumptions before generating the 10-year model.</p>}{generatedOutOfDate && <div className="rounded border border-brand-500/30 bg-brand-500/10 p-2 text-sm font-medium text-brand-900 dark:text-brand-100">Cashflow out of date. Regenerate before PDF export.</div>}</CardContent></Card>
    <Card className="border-primary/20 bg-primary/5"><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> PDF Report Controls</CardTitle><Button type="button" size="sm" variant="outline" onClick={() => setPdfControlsOpen(v => !v)}>{pdfControlsOpen ? 'Collapse controls' : 'Expand controls'}</Button></div><CardDescription>Configure and export the final validated 10-year cashflow report.</CardDescription></CardHeader>{pdfControlsOpen && <CardContent className="space-y-4"><div className="flex flex-wrap items-center gap-2"><Badge variant={pdfGenerationBlocked ? 'outline' : preliminaryPdfWarnings.length ? 'secondary' : 'default'}>Readiness: {reportStatus}</Badge>{lastPdfGeneratedAt && <Badge variant="outline">Last PDF {new Date(lastPdfGeneratedAt).toLocaleString('en-AU')}</Badge>}<Badge variant="outline">{TEN_YEAR_REPORT_VERSION}</Badge></div><div className="grid gap-2 md:grid-cols-4">{Object.entries({ assumptions: 'Include assumptions', formulaNotes: 'Include formula notes', warnings: 'Include warnings', scenarioNotes: 'Include scenario notes', commentary: 'Include commentary', fullTable: 'Include full 10-year table', summaryCards: 'Include summary cards', aiEstimateNotes: 'Include AI estimate notes' } as Record<keyof typeof pdfOptions, string>).map(([key, label]) => <Button key={key} type="button" variant={pdfOptions[key as keyof typeof pdfOptions] ? 'default' : 'outline'} onClick={() => togglePdfOption(key as keyof typeof pdfOptions)}>{label}</Button>)}</div>{preliminaryPdfWarnings.length > 0 && !pdfGenerationBlocked && <div className="rounded border border-brand-500/30 bg-brand-500/10 p-2 text-sm text-brand-100">PDF can be generated with warnings: preliminary assumptions, AI estimates, manual overrides or tax/GST items require review.</div>}<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!generatedCashFlow} onClick={() => setPdfPreviewOpen(true)}>Preview Report</Button><Button type="button" disabled={pdfGenerationBlocked} onClick={() => setPdfConfirmOpen(true)} title={pdfGenerationBlocked ? 'Resolve generation, critical warning or required assumption blockers before PDF generation.' : 'Generate PDF'}>Generate PDF</Button><Button type="button" variant="outline" onClick={exportScenarioData}>Export Scenario Data</Button></div>{pdfExportHistory.length > 0 && <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Export history:</span> {pdfExportHistory.slice(-3).map(item => `${new Date(item.timestamp).toLocaleString('en-AU')} (${item.reportVersion})`).join(' · ')}</div>}</CardContent>}</Card>
    {!generatedCashFlow && <Card className="border-dashed border-primary/40 bg-primary/5"><CardContent className="pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-primary">Awaiting Cash Flow Inputs</p><p className="mt-1 text-sm text-muted-foreground">Import property, NOI, GST, debt and DCF assumptions or enter values manually to generate the 10-year cash flow report. Missing and pending states are shown without changing formulas.</p></div><Badge variant="outline">Pending annual forecast</Badge></div></CardContent></Card>}
    {generatedCashFlow && <div className="space-y-4">
      <PremiumPanel title="Year 1 outcome" description="Front-year cashflow and operating outcome for the selected scenario."><div className="grid gap-3 md:grid-cols-3"><SummaryCard label="Year 1 pre-tax cashflow" value={s.year1PreTaxCashflow} pending={false} emphasis="hero" /><SummaryCard label="Year 1 after-tax cashflow" value={s.year1AfterTaxCashflow} pending={false} emphasis="hero" /><SummaryCard label="Year 1 NOI" value={s.year1Noi} pending={false} /></div></PremiumPanel>
      <PremiumPanel title="Year 10 outcome" description="Terminal value, loan balance and equity position for report-ready review."><div className="grid gap-3 md:grid-cols-3"><SummaryCard label="Year 10 property value" value={s.year10PropertyValue} pending={false} emphasis="hero" /><SummaryCard label="Year 10 loan balance" value={s.year10LoanBalance} pending={false} emphasis="hero" /><SummaryCard label="Year 10 equity" value={s.year10Equity} pending={false} emphasis="hero" /></div></PremiumPanel>
      <PremiumPanel title="Investor return summary" description="Headline return metrics made prominent for investment committee and client reporting."><div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5"><SummaryCard label="Cumulative after-tax cashflow" value={s.cumulativeAfterTaxCashflow} pending={false} emphasis="return" /><SummaryCard label="Levered IRR" value={s.leveredIrr == null ? PENDING : `${(s.leveredIrr * 100).toFixed(1)}%`} pending={false} emphasis="return" /><SummaryCard label="Equity multiple" value={s.equityMultiple == null ? PENDING : `${s.equityMultiple.toFixed(2)}x`} pending={false} emphasis="return" /><SummaryCard label="Business DSCR" value={s.businessDscr == null ? PENDING : `${s.businessDscr.toFixed(2)}x`} pending={false} /><SummaryCard label="Occupancy cost ratio" value={s.occupancyCostRatio == null ? PENDING : `${(s.occupancyCostRatio * 100).toFixed(1)}%`} pending={false} /></div></PremiumPanel>
      <PremiumPanel title="Scenario summary" description="All existing summary outputs remain available in a compact report-ready panel."><div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">{summaryCards.map(([label, value]) => <SummaryCard key={String(label)} label={String(label)} value={value as any} pending={false} />)}<SummaryCard label="Risk status" value={title(s.riskStatus)} pending={false} /></div></PremiumPanel>
    </div>}
    {generatedCashFlow && <Card className={exitValueMaterialDifference ? 'border-brand-500/30 bg-brand-500/10' : 'border-primary/20 bg-primary/5'}><CardHeader><CardTitle className="text-base">Year 10 outcome · Exit Value Reconciliation</CardTitle><CardDescription>Capital-growth value and income-capitalised terminal value are both preserved and compared before client reporting.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><div className="grid gap-3 md:grid-cols-5"><SummaryCard label="Year 10 Capital Growth Value" value={year10CapitalGrowthValue} pending={false} /><SummaryCard label="Terminal Cap Value" value={terminalCapValue} pending={false} /><SummaryCard label="Difference" value={exitValueDifference} pending={false} /><SummaryCard label="Difference %" value={exitValueDifferencePct == null ? PENDING : `${(exitValueDifferencePct * 100).toFixed(1)}%`} pending={false} /><SummaryCard label="Selected Exit Value Used in Report" value={selectedExitValueUsed} pending={false} /></div>{exitValueMaterialDifference && <div className="rounded border border-brand-500/30 bg-brand-500/10 p-2 text-brand-100">Exit value methods materially differ. Confirm which value should be used for client reporting.</div>}<p className="text-muted-foreground">Exit value has been modelled using {exitValueMethod}. Capital-growth value and income-capitalised terminal value have been compared for reasonableness.</p>{(exitValueMaterialDifference || exitValueMethod === 'Manual Verified Exit Value') && <Button type="button" variant={exitReconciliationConfirmed ? 'default' : 'outline'} onClick={() => setExitReconciliationConfirmed(v => !v)}>{exitReconciliationConfirmed ? 'Exit reconciliation confirmed' : 'Confirm exit value for client reporting'}</Button>}</CardContent></Card>}
    {validationWarnings.length > 0 && <Card className="border-brand-500/30 bg-brand-500/10"><CardContent className="pt-4 text-sm text-brand-100"><div className="mb-2 flex items-center justify-between gap-2"><div className="font-medium">Priority warnings</div><Badge variant="outline">{validationWarnings.length} total</Badge></div><ul className="list-disc pl-5 space-y-1">{priorityWarnings.map((w, i) => <li key={`${w.category}-${i}`}><span className="font-medium">{w.category} · {w.severity}:</span> {w.message}</li>)}</ul><p className="mt-2 text-xs">Showing up to 5 priority warnings. Full warning log is available in Assumption Status.</p></CardContent></Card>}
    <Card className="border-primary/20 bg-primary/5"><CardContent className="pt-4"><p className="font-semibold text-primary">Recommended next action</p><p className="mt-1 text-sm text-muted-foreground">{nextAction}</p></CardContent></Card>
    <Card className="border-primary/20 bg-primary/5"><CardContent className="space-y-3 pt-4 text-sm text-muted-foreground"><div className="flex flex-wrap items-center gap-2"><Button type="button" variant={annualOverridesEnabled ? 'default' : 'outline'} onClick={() => setAnnualOverridesEnabled(v => !v)}><Pencil className="mr-1 h-3.5 w-3.5" />{annualOverridesEnabled ? 'Annual overrides enabled' : 'Enable annual overrides'}</Button><Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />Calculated outputs locked</Badge><Badge variant="secondary" className="gap-1"><Pencil className="h-3 w-3" />{annualOverrideCount} active override{annualOverrideCount === 1 ? '' : 's'}</Badge>{annualOverrideCount > 0 && <Button type="button" size="sm" variant="outline" onClick={resetAllAnnualOverrides}>Reset all overrides</Button>}</div><p>Annual overrides are off by default. When enabled, they are limited to assumption rows such as passing rent, rent growth, vacancy allowance, recovered outgoings, outgoings growth, owner-borne expenses, capex reserve, major capex, lease downtime, tenant incentives, interest rate, tax rate, capital growth and final-year terminal cap rate. Protected calculated rows cannot be directly edited.</p>{annualOverrideCount > 0 && <div className="rounded border border-brand-500/30 bg-brand-500/10 p-2 text-brand-100">Annual overrides are active. Review assumption history before generating report.</div>}</CardContent></Card>
    {generatedCashFlow && <MetricRows years={reportResult.years} mode={mode} inputs={inputs} pending={pending} annualOverridesEnabled={annualOverridesEnabled} annualOverrides={annualOverrides} onSetAnnualOverride={setAnnualOverrideCell} onResetAnnualOverride={resetAnnualOverrideCell} onResetAnnualOverrideRow={resetAnnualOverrideRow} />}
    {annualOverrideCount > 0 && <Card className="border-brand-500/30 bg-brand-500/10"><CardHeader><CardTitle className="text-base">Annual Override Assumption Status</CardTitle><CardDescription>Overrides are included in assumption status, audit trail, PDF assumption notes and scenario save data through the 10-year cashflow inputs payload.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><div><h4 className="font-medium">Audit Trail</h4><ul className="mt-1 list-disc pl-5 text-muted-foreground">{assumptionHistory.filter(item => item.source === 'Annual Override').slice(-8).map((item, index) => <li key={`${item.field}-${item.year}-${item.timestamp}-${index}`}>Year {item.year}: {title(String(item.field))} overridden to {item.value} by Current user at {new Date(item.timestamp).toLocaleString('en-AU')}</li>)}</ul></div><div><h4 className="font-medium">PDF report assumption notes</h4><p className="text-muted-foreground">Annual overrides are active. Review assumption history before generating report.</p></div><div><h4 className="font-medium">Scenario save data</h4><p className="text-muted-foreground">The active annual override map is stored on the generated cashflow inputs for scenario persistence.</p></div></CardContent></Card>}
    <Card><CardHeader><CardTitle className="text-base">Warnings and report notes</CardTitle><CardDescription>Full validation warning log grouped by category and severity.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm">{Object.entries(groupedWarnings).map(([category, warnings]) => <div key={category}><h4 className="font-medium">{category}</h4><ul className="mt-1 list-disc pl-5 text-muted-foreground">{warnings.map((warning, index) => <li key={`${category}-${index}`}><span className="font-medium">{warning.severity}:</span> {warning.message}</li>)}</ul></div>)}</CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Scenario commentary</CardTitle><CardDescription>Client-ready commentary is generated only after the cashflow model is generated and remains editable before export.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2"><Button type="button" disabled={!generatedCashFlow} onClick={regenerateCommentary}>Regenerate commentary</Button><Button type="button" variant="outline" disabled={!generatedCommentary} onClick={() => setCommentaryEditing(v => !v)}>{commentaryEditing ? 'Preview commentary' : 'Edit commentary'}</Button><Button type="button" variant="outline" disabled={!generatedCommentary} onClick={() => setEditableCommentary(generatedCommentary)}>Reset to generated commentary</Button><Button type="button" variant={pdfOptions.commentary ? 'default' : 'outline'} onClick={() => togglePdfOption('commentary')}>{pdfOptions.commentary ? 'Included in PDF' : 'Excluded from PDF'}</Button></div>{commentaryOutOfDate && <div className="rounded border border-brand-500/30 bg-brand-500/10 p-2 text-sm text-brand-100">Commentary is out of date. Regenerate commentary before export.</div>}{commentaryEditing ? <Textarea value={editableCommentary} onChange={e => setEditableCommentary(e.target.value)} className="min-h-[180px]" /> : <p className="text-sm text-muted-foreground leading-relaxed">{!generatedCashFlow ? PENDING : editableCommentary || 'Generate commentary after generating the 10-year cashflow model.'}</p>}<div className="grid gap-3 md:grid-cols-2"><div><Label>Base case</Label><Textarea value={scenarioNotes.base} onChange={e => setScenarioNotes(notes => ({ ...notes, base: e.target.value }))} /></div><div><Label>Conservative case</Label><Textarea value={scenarioNotes.conservative} onChange={e => setScenarioNotes(notes => ({ ...notes, conservative: e.target.value }))} /></div><div><Label>Upside case</Label><Textarea value={scenarioNotes.upside} onChange={e => setScenarioNotes(notes => ({ ...notes, upside: e.target.value }))} /></div><div><Label>Manual scenario note</Label><Textarea value={scenarioNotes.manual} onChange={e => setScenarioNotes(notes => ({ ...notes, manual: e.target.value }))} placeholder="Add manual scenario note" /></div></div></CardContent></Card>
    <Dialog open={pdfPreviewOpen} onOpenChange={setPdfPreviewOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>10-Year Cash Flow PDF Preview</DialogTitle><DialogDescription>Preview the sections that will be included in the polished PDF output.</DialogDescription></DialogHeader>
        <div className="space-y-3 text-sm">
          <p><span className="font-medium">Scenario:</span> {scenarioName || '10-Year Cash Flow Scenario'}</p>
          <p><span className="font-medium">Readiness:</span> {reportStatus}</p>
          <p><span className="font-medium">Generated:</span> {generatedCashFlow ? new Date(generatedCashFlow.generatedAt).toLocaleString('en-AU') : PENDING}</p>
          <ul className="grid gap-1 md:grid-cols-2 text-muted-foreground">
            {pdfOptions.assumptions && <li>Cover / property summary and key assumptions</li>}
            <li>Source and verification summary</li>
            {pdfOptions.summaryCards && <li>Summary output cards</li>}
            {pdfOptions.fullTable && <li>Full 10-year cashflow table</li>}
            <li>Valuation / exit value section</li><li>Debt metrics section</li><li>NOI and cashflow section</li><li>Capex and leasing section</li>
            {pdfOptions.warnings && <li>Warnings and assumptions</li>}
            {pdfOptions.scenarioNotes && <li>Scenario notes</li>}
            {pdfOptions.commentary && <li>Editable report commentary</li>}
            {pdfOptions.aiEstimateNotes && <li>AI estimate notes</li>}
            {pdfOptions.formulaNotes && <li>Formula notes</li>}
            <li>Disclaimer / estimate note</li>
          </ul>
        </div>
        <DialogFooter><Button type="button" onClick={() => setPdfPreviewOpen(false)}>Close Preview</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={pdfConfirmOpen} onOpenChange={setPdfConfirmOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Generate 10-Year Cash Flow PDF Report?</DialogTitle><DialogDescription>Confirm the final report inputs before generating the PDF record.</DialogDescription></DialogHeader>
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div><span className="font-medium">Scenario name:</span> {scenarioName || '10-Year Cash Flow Scenario'}</div>
          <div><span className="font-medium">Property address:</span> {String((dealProfile as any)?.address ?? (dealProfile as any)?.propertyAddress ?? 'Not provided')}</div>
          <div><span className="font-medium">Data source:</span> {buildGlobalSyncLabel(sourceMode as CalculatorSourceMode)}</div>
          <div><span className="font-medium">Generated date:</span> {generatedCashFlow ? new Date(generatedCashFlow.generatedAt).toLocaleString('en-AU') : PENDING}</div>
          <div><span className="font-medium">Readiness status:</span> {reportStatus}</div>
          <div><span className="font-medium">Commentary included:</span> {pdfOptions.commentary ? 'Yes' : 'No'}</div>
          <div><span className="font-medium">AI estimate notes included:</span> {pdfOptions.aiEstimateNotes ? 'Yes' : 'No'}</div>
          <div><span className="font-medium">Key assumptions:</span> Rent growth {inputs.rentGrowthPct}% · Vacancy {inputs.vacancyAllowancePct}% · Exit {exitValueMethod}</div>
        </div>
        <div className="text-sm"><h4 className="font-medium">Key warnings</h4><ul className="mt-1 list-disc pl-5 text-muted-foreground">{priorityWarnings.map((warning, index) => <li key={index}>{warning.category}: {warning.message}</li>)}</ul></div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setPdfConfirmOpen(false)}>Cancel</Button><Button type="button" onClick={runPdfGeneration}>Generate PDF</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(estimatePreview)} onOpenChange={(open) => { if (!open) setEstimatePreview(null); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>AI Estimate Preview</DialogTitle>
          <DialogDescription>Review the estimate, evidence basis and risks before applying it. AI estimates are never marked verified automatically.</DialogDescription>
        </DialogHeader>
        {estimatePreview && <div className="space-y-4 text-sm">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded border border-border/60 p-3"><div className="text-xs text-muted-foreground">Suggested value</div><div className="text-lg font-semibold text-primary">{estimatePreview.suggestedValue}</div></div>
            <div className="rounded border border-border/60 p-3"><div className="text-xs text-muted-foreground">Suggested range</div><div className="font-semibold">{estimatePreview.suggestedRange[0]} – {estimatePreview.suggestedRange[1]}</div></div>
            <div className="rounded border border-border/60 p-3"><div className="text-xs text-muted-foreground">Confidence level</div><Badge variant={estimatePreview.confidenceLevel === 'High' ? 'default' : estimatePreview.confidenceLevel === 'Medium' ? 'secondary' : 'outline'}>{estimatePreview.confidenceLevel}</Badge></div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div><h4 className="font-medium">Source basis</h4><p className="text-muted-foreground">{estimatePreview.sourceBasis}</p></div>
            <div><h4 className="font-medium">Tabs / data points used</h4><p className="text-muted-foreground">{estimatePreview.tabsDataPointsUsed.join(', ')}</p></div>
            <div><h4 className="font-medium">Missing data</h4><ul className="list-disc pl-5 text-muted-foreground">{estimatePreview.missingData.map(item => <li key={item}>{item}</li>)}</ul></div>
            <div><h4 className="font-medium">Risk notes</h4><ul className="list-disc pl-5 text-muted-foreground">{estimatePreview.riskNotes.map(item => <li key={item}>{item}</li>)}</ul></div>
          </div>
          <div className="rounded border border-brand-500/30 bg-brand-500/10 p-3 text-brand-100">Specialist review recommended: {estimatePreview.specialistReviewRecommended ? 'Yes' : 'No'}.</div>
          <div className="space-y-2"><Label>Edit before applying</Label><Input type="number" value={estimateEditValue} onChange={e => setEstimateEditValue(e.target.value)} /></div>
        </div>}
        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setEstimatePreview(null)}>Reject estimate</Button>
          <Button type="button" variant="outline" onClick={() => markEstimateVerified()}>Mark as verified</Button>
          <Button type="button" variant="secondary" onClick={() => acceptEstimate(true)}>Edit before applying</Button>
          <Button type="button" variant="secondary" onClick={() => acceptEstimate(false)}>Accept selected estimate</Button>
          <Button type="button" onClick={() => acceptEstimate(false)}>Accept estimate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </CardContent></Card>;
}
