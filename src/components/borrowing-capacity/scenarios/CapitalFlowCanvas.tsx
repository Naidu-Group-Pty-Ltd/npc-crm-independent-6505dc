/**
 * Phase K2 — Capital Flow Canvas
 *
 * Hyper-granular UI for routing pool capital (equity release / pool release /
 * cash on hand) into typed sinks (debt payoff, offset, rate buy-down, etc.).
 *
 * Pure presentation + reducer state. Emits a `CapitalAllocation[]` upward —
 * StrategyScenarioModeling translates it into `capital_allocation` deltas
 * that the engine resolves via the K1 ledger.
 */

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash2, Wallet, ArrowRight, AlertTriangle, Sparkles } from 'lucide-react';
import type { CapitalSinkType, CapitalLedger } from '@/utils/borrowingCapacityTypes';

// ── Public types ───────────────────────────────────────

export interface CapitalAllocation {
  id: string;
  amount: number;
  sinkType: CapitalSinkType;
  /** Optional target id (liability id for payoff, property id for offset/buy-down) */
  sinkTargetId?: string;
  /** Optional metadata: offset rate, buydown points, repayment cut */
  offsetRatePoints?: number;
  rateBuydownPoints?: number;
  repaymentReductionMonthly?: number;
}

export interface CapitalFlowSourceSummary {
  /** Gross dollars available in the pool from the active scenario. */
  poolTotal: number;
  /** Per-source breakdown for the source card. */
  sources: Array<{ label: string; amount: number; type: string }>;
}

export interface CapitalFlowTargets {
  liabilities: Array<{ id: string; label: string; balance: number; monthlyServicing: number }>;
  properties: Array<{ id: string; address: string; loanRemaining: number; interestRate?: number }>;
}

interface CapitalFlowCanvasProps {
  pool: CapitalFlowSourceSummary;
  targets: CapitalFlowTargets;
  allocations: CapitalAllocation[];
  onAllocationsChange: (next: CapitalAllocation[]) => void;
  /** Optional ledger from the latest engine run — surfaces overcommit + sink notes. */
  ledger?: CapitalLedger | null;
}

// ── Sink presentation helpers ───────────────────────────

const SINK_OPTIONS: Array<{ value: CapitalSinkType; label: string; needsTarget: 'liability' | 'property' | null; hint: string }> = [
  { value: 'liability_payoff',     label: 'Pay down a liability',          needsTarget: 'liability', hint: 'Reduces $/mo servicing + debt balance' },
  { value: 'offset_deposit',       label: 'Park in offset account',        needsTarget: 'property',  hint: 'Cancels interest on the offset $' },
  { value: 'rate_buydown',         label: 'Buy down a property rate',      needsTarget: 'property',  hint: '~25 bps per 1% of loan balance' },
  { value: 'debt_recycle',         label: 'Debt recycling',                needsTarget: 'property',  hint: 'OO → IP loan, interest deductible' },
  { value: 'acquisition_deposit',  label: 'Reserve for next-purchase deposit', needsTarget: null,    hint: 'Routed to the acquisition pool' },
  { value: 'holding_reserve',      label: 'Hold as cash buffer',           needsTarget: null,        hint: 'No servicing impact' },
  { value: 'repayment_reduction',  label: 'Direct $/mo repayment cut',     needsTarget: 'property',  hint: 'Caps at original servicing $/mo' },
];

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function makeId(): string {
  return `alloc-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Component ──────────────────────────────────────────

export function CapitalFlowCanvas({
  pool,
  targets,
  allocations,
  onAllocationsChange,
  ledger,
}: CapitalFlowCanvasProps) {
  const totalAllocated = useMemo(
    () => allocations.reduce((s, a) => s + Math.max(0, a.amount || 0), 0),
    [allocations],
  );
  const remainder = Math.max(0, pool.poolTotal - totalAllocated);
  const overcommitted = totalAllocated > pool.poolTotal + 1;
  const utilisationPct = pool.poolTotal > 0
    ? Math.min(100, (totalAllocated / pool.poolTotal) * 100)
    : 0;

  const ledgerPool = ledger?.pools?.['pool-default'];

  const updateAllocation = (id: string, patch: Partial<CapitalAllocation>) => {
    onAllocationsChange(allocations.map(a => a.id === id ? { ...a, ...patch } : a));
  };

  const removeAllocation = (id: string) => {
    onAllocationsChange(allocations.filter(a => a.id !== id));
  };

  const addAllocation = () => {
    const seed: CapitalAllocation = {
      id: makeId(),
      amount: Math.min(50_000, Math.round(remainder)),
      sinkType: 'liability_payoff',
      sinkTargetId: targets.liabilities[0]?.id,
    };
    onAllocationsChange([...allocations, seed]);
  };

  // Smart presets
  const applyPreset = (kind: 'optimise_dti' | 'optimise_surplus' | 'maximise_acquisition') => {
    if (kind === 'maximise_acquisition') {
      onAllocationsChange([{
        id: makeId(),
        amount: Math.round(pool.poolTotal),
        sinkType: 'acquisition_deposit',
      }]);
      return;
    }
    if (kind === 'optimise_dti') {
      // Pay down highest-balance unsecured liability first
      const top = [...targets.liabilities].sort((a, b) => b.balance - a.balance)[0];
      if (!top) return;
      onAllocationsChange([{
        id: makeId(),
        amount: Math.min(pool.poolTotal, top.balance),
        sinkType: 'liability_payoff',
        sinkTargetId: top.id,
      }]);
      return;
    }
    // optimise_surplus → highest $/mo servicing target
    const top = [...targets.liabilities].sort((a, b) => b.monthlyServicing - a.monthlyServicing)[0];
    if (!top) return;
    onAllocationsChange([{
      id: makeId(),
      amount: Math.min(pool.poolTotal, top.balance),
      sinkType: 'liability_payoff',
      sinkTargetId: top.id,
    }]);
  };

  return (
    <Card className="border-primary/30 bg-card">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4 text-primary" />
          Capital Flow Canvas
          <Badge variant="outline" className="ml-2 text-[10px] uppercase tracking-wide">Phase K</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Route equity release, pool release and cash-on-hand into specific sinks. Each $ allocated cascades into the scenario borrowing capacity.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── POOL SUMMARY ── */}
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">Pool available</span>
            <span className="font-bold text-primary">{formatCurrency(pool.poolTotal)}</span>
          </div>
          {pool.sources.length > 0 && (
            <div className="space-y-1">
              {pool.sources.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>· {s.label}</span>
                  <span>{formatCurrency(s.amount)}</span>
                </div>
              ))}
            </div>
          )}
          <Separator className="my-1" />
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Allocated</span>
              <span className="font-medium text-foreground">{formatCurrency(totalAllocated)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Remaining (→ next-purchase deposit)</span>
              <span className={`font-medium ${overcommitted ? 'text-destructive' : 'text-foreground'}`}>
                {formatCurrency(remainder)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div
                className={`h-full transition-all ${overcommitted ? 'bg-destructive' : 'bg-primary'}`}
                style={{ width: `${utilisationPct}%` }}
              />
            </div>
          </div>
          {overcommitted && (
            <div className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>Overcommitted by {formatCurrency(totalAllocated - pool.poolTotal)}. Engine will clamp each sink at its share of remainder.</span>
            </div>
          )}
        </div>

        {/* ── PRESETS ── */}
        {pool.poolTotal > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Smart presets
            </span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => applyPreset('optimise_dti')}>Optimise DTI</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => applyPreset('optimise_surplus')}>Optimise surplus</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => applyPreset('maximise_acquisition')}>Maximise acquisition</Button>
          </div>
        )}

        {/* ── ALLOCATIONS ── */}
        <div className="space-y-3">
          {allocations.length === 0 && (
            <p className="text-xs text-muted-foreground italic text-center py-4">
              No explicit allocations — pool will route as next-purchase deposit by default. Add one to model granular flows.
            </p>
          )}
          {allocations.map((a) => {
            const sinkOpt = SINK_OPTIONS.find(o => o.value === a.sinkType);
            const targetList = sinkOpt?.needsTarget === 'liability' ? targets.liabilities
              : sinkOpt?.needsTarget === 'property' ? targets.properties.map(p => ({ id: p.id, label: p.address || 'Property', balance: p.loanRemaining, monthlyServicing: 0 }))
              : [];
            const ledgerSink = ledgerPool?.sinks.find(s => s.deltaId === a.id);
            return (
              <div key={a.id} className="rounded-lg border border-border bg-background p-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <ArrowRight className="h-3.5 w-3.5 text-primary" />
                    Allocation
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeAllocation(a.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Sink</Label>
                    <Select value={a.sinkType} onValueChange={(v) => updateAllocation(a.id, { sinkType: v as CapitalSinkType, sinkTargetId: undefined })}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SINK_OPTIONS.map(o => (
                          <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {sinkOpt && <p className="text-[10px] text-muted-foreground">{sinkOpt.hint}</p>}
                  </div>

                  {sinkOpt?.needsTarget && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Target {sinkOpt.needsTarget === 'liability' ? 'liability' : 'property'}
                      </Label>
                      <Select value={a.sinkTargetId || ''} onValueChange={(v) => updateAllocation(a.id, { sinkTargetId: v })}>
                        <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select target" /></SelectTrigger>
                        <SelectContent>
                          {targetList.map(t => (
                            <SelectItem key={t.id} value={t.id} className="text-xs">
                              {t.label} ({formatCurrency(t.balance)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Amount</Label>
                    <Input
                      type="number"
                      value={a.amount}
                      onChange={(e) => updateAllocation(a.id, { amount: Math.max(0, Number(e.target.value) || 0) })}
                      className="h-7 w-32 text-xs text-right"
                    />
                  </div>
                  <Slider
                    value={[a.amount]}
                    min={0}
                    max={Math.max(pool.poolTotal, a.amount)}
                    step={1000}
                    onValueChange={([v]) => updateAllocation(a.id, { amount: Math.round(v) })}
                  />
                </div>

                {ledgerSink && (
                  <div className="rounded-md bg-muted/40 px-2 py-1.5 space-y-0.5">
                    {ledgerSink.notes.map((n, i) => (
                      <p key={i} className="text-[11px] text-muted-foreground leading-snug">{n}</p>
                    ))}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {ledgerSink.monthlyServicingDelta !== 0 && (
                        <Badge variant={ledgerSink.monthlyServicingDelta < 0 ? 'default' : 'destructive'} className="text-[10px]">
                          {ledgerSink.monthlyServicingDelta < 0 ? '−' : '+'}{formatCurrency(Math.abs(ledgerSink.monthlyServicingDelta))}/mo
                        </Badge>
                      )}
                      {ledgerSink.debtBalanceDelta !== 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          Debt {ledgerSink.debtBalanceDelta < 0 ? '−' : '+'}{formatCurrency(Math.abs(ledgerSink.debtBalanceDelta))}
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <Button size="sm" variant="outline" className="w-full h-8 text-xs" onClick={addAllocation} disabled={pool.poolTotal <= 0}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add allocation
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
