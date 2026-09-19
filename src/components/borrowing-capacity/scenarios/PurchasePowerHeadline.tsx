/**
 * Purchase Power Headline + Per-Lever Attribution Waterfall
 * ─────────────────────────────────────────────────────────
 * Phase F3 + F4 (Strategy Builder UX).
 *
 * F3 — Headlines the metric finance actually uses to make a decision:
 *      EFFECTIVE PURCHASE POWER = Loan Available + Cash Available
 *                                 − (LMI + Stamp Duty + Other Costs)
 *      i.e. exactly `acquisitionCapacity.maxPurchasePrice`.
 *      When the user has set a target (e.g. $700k), the headline shows
 *      Achievable / Short-by alongside the loan required.
 *
 * F4 — A per-lever waterfall: how much of the total capacity uplift came from
 *      each lever in isolation, plus a residual "compounding interaction" line
 *      so the math reconciles back to the scenario delta.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, TrendingDown, Target, Banknote, Layers, ArrowRight, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import type { AcquisitionCapacity } from '@/utils/borrowingCapacityTypes';

// ── Types ────────────────────────────────────────────────────────────────

export interface LeverAttribution {
  /** Stable id (delta id, lever key, etc.) */
  id: string;
  /** Display label (short, sentence case) */
  label: string;
  /** Capacity delta this lever contributes when applied IN ISOLATION (vs base) */
  capacityImpact: number;
  /** Theoretical (unfloored) capacity delta computed from raw surplus × annuity
   *  factor. Surfaces real movement when both base and scenario are clamped at
   *  the $0 servicing floor (otherwise `capacityImpact` collapses to $0 for
   *  every lever and the broker can't see which lever is doing the work). */
  theoreticalImpact?: number;
  /** Optional cash-flow note: "+$420/mo" or "−$890/mo" — enriches the row */
  cashflowNote?: string;
}

interface PurchasePowerHeadlineProps {
  /** Base borrowing capacity (no scenario applied). */
  baseCapacity: number;
  /** Scenario borrowing capacity (with all levers applied compounded). */
  scenarioCapacity: number;
  /** Acquisition snapshot from the engine — drives the headline. Optional: when
   *  the user hasn't enabled Acquisition mode the headline collapses to a
   *  capacity-only view. */
  acquisitionCapacity: AcquisitionCapacity | null;
  /** Per-lever attribution for the waterfall (F4). Pass [] when no levers
   *  are toggled — the waterfall section will hide itself. */
  leverAttribution: LeverAttribution[];
  /** Currency formatter from the parent (so "AUD" / locale stays consistent). */
  formatCurrency: (n: number) => string;
  /** Theoretical (unfloored) base capacity — used when `floorActive` to
   *  contextualise the "if floor lifted" attribution column. */
  baseTheoreticalCapacity?: number;
  /** Theoretical (unfloored) scenario capacity. */
  scenarioTheoreticalCapacity?: number;
  /** Raw (unfloored) base monthly surplus — surfaced in the floor banner so
   *  the broker can see exactly how far underwater the client is. */
  baseRawSurplus?: number;
  /** Raw (unfloored) scenario monthly surplus. */
  scenarioRawSurplus?: number;
  /** True when both displayed capacities are clamped at $0 but the underlying
   *  surplus math shows real movement — triggers the explainer banner. */
  floorActive?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatSignedCurrency(value: number, fmt: (n: number) => string): string {
  if (value === 0) return fmt(0);
  return value > 0 ? `+${fmt(value)}` : `−${fmt(Math.abs(value))}`;
}

// ── Component ────────────────────────────────────────────────────────────

export function PurchasePowerHeadline({
  baseCapacity,
  scenarioCapacity,
  acquisitionCapacity,
  leverAttribution,
  formatCurrency,
  baseTheoreticalCapacity,
  scenarioTheoreticalCapacity,
  baseRawSurplus,
  scenarioRawSurplus,
  floorActive = false,
}: PurchasePowerHeadlineProps) {
  const capacityChange = scenarioCapacity - baseCapacity;
  const acq = acquisitionCapacity;

  // F4 — the sum of isolated impacts will rarely equal the compounded total
  // because levers interact (e.g. cutting rates lifts capacity, then equity
  // release adds servicing on top of that lifted ceiling). Surface the
  // residual transparently so finance can see the math reconciles.
  const sumIsolated = leverAttribution.reduce((s, l) => s + l.capacityImpact, 0);
  const interactionResidual = capacityChange - sumIsolated;
  const showInteraction = Math.abs(interactionResidual) > 1000 && leverAttribution.length > 0;

  // Theoretical (unfloored) totals — only meaningful when the floor is active.
  const theoreticalCapacityChange =
    (scenarioTheoreticalCapacity ?? 0) - (baseTheoreticalCapacity ?? 0);
  const sumTheoretical = leverAttribution.reduce(
    (s, l) => s + (l.theoreticalImpact ?? 0),
    0
  );

  // When floor is active we sort by theoretical impact (the meaningful signal),
  // otherwise by the compounded floored impact (the audit signal).
  const sortedLevers = [...leverAttribution].sort((a, b) => {
    const aVal = floorActive
      ? Math.abs(a.theoreticalImpact ?? 0)
      : Math.abs(a.capacityImpact);
    const bVal = floorActive
      ? Math.abs(b.theoreticalImpact ?? 0)
      : Math.abs(b.capacityImpact);
    return bVal - aVal;
  });

  // Max absolute value across all bars (incl. residual) → drives the relative
  // bar widths so the most impactful lever fills the row.
  const maxAbs = Math.max(
    1,
    ...sortedLevers.map(l =>
      floorActive ? Math.abs(l.theoreticalImpact ?? 0) : Math.abs(l.capacityImpact)
    ),
    floorActive ? 0 : Math.abs(interactionResidual),
  );

  // ── F3: target-vs-actual derived state ─────────────────────────────────
  const target = acq?.targetPurchasePrice;
  const meetsTarget = acq?.meetsTarget;
  const shortfall = acq?.shortfallToTarget ?? 0;

  // The headline always reports SCENARIO BORROWING CAPACITY so the label
  // never silently flips on the broker. When acquisition mode is enabled we
  // additionally surface Effective Purchase Power as an explicit second line
  // (loan + cash − costs) so both metrics are visible side-by-side.
  // When the engine is clamped at the $0 servicing floor, the displayed
  // capacity hides the true (negative) position — so we show the unfloored
  // theoretical figure as the headline and tag it "true position".
  const showTrueNegative =
    floorActive &&
    typeof scenarioTheoreticalCapacity === 'number' &&
    scenarioTheoreticalCapacity < scenarioCapacity;
  const headlineCapacity = showTrueNegative
    ? (scenarioTheoreticalCapacity as number)
    : scenarioCapacity;

  return (
    <div className="space-y-3">
      {/* ═══ F3 — SCENARIO BORROWING CAPACITY HEADLINE ═══ */}
      <Card className="border-2 border-primary/40 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent shadow-md">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-primary" />
              Scenario Borrowing Capacity
              {showTrueNegative && (
                <Badge variant="outline" className="ml-1 text-[9px] uppercase tracking-wider border-destructive/40 text-destructive">
                  True position · floor lifted
                </Badge>
              )}
            </CardTitle>
            {target && target > 0 && (
              meetsTarget ? (
                <Badge className="bg-success/15 text-success dark:text-success border-success/30 text-[10px] font-semibold">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Target {formatCurrency(target)} achievable
                </Badge>
              ) : (
                <Badge className="bg-destructive/15 text-destructive border-destructive/30 text-[10px] font-semibold">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Short by {formatCurrency(shortfall)}
                </Badge>
              )
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Big number */}
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <p className={`text-3xl md:text-4xl font-bold leading-none tracking-tight ${
                showTrueNegative ? 'text-destructive' : 'text-primary'
              }`}>
                {formatSignedCurrency(headlineCapacity, formatCurrency)}
              </p>
              {showTrueNegative ? (
                <p className="text-xs text-muted-foreground mt-1.5 leading-snug">
                  Engine clamps displayed capacity at <span className="font-medium text-foreground">{formatCurrency(scenarioCapacity)}</span> (≥ $0 floor).
                  This figure is the unfloored serviceability position so the team can see the true gap.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Serviceable loan ceiling under APRA stress assumptions.
                </p>
              )}
              {acq && (
                <div className="mt-2 pt-2 border-t border-primary/15">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Banknote className="h-3 w-3" /> Effective Purchase Power
                  </p>
                  <p className="text-xl font-bold text-primary mt-0.5">
                    {formatCurrency(acq.maxPurchasePrice)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Loan {formatCurrency(acq.loanAvailableForPurchase)} + Cash {formatCurrency(acq.cashAvailable)} − Costs {formatCurrency(acq.lmi + acq.stampDuty + acq.otherAcquisitionCosts)}
                  </p>
                </div>
              )}
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">vs Base Capacity</p>
              <p className={`text-lg font-bold flex items-center justify-end gap-1 ${
                capacityChange > 0 ? 'text-success dark:text-success' :
                capacityChange < 0 ? 'text-destructive' :
                'text-muted-foreground'
              }`}>
                {capacityChange > 0 ? <TrendingUp className="h-4 w-4" /> :
                 capacityChange < 0 ? <TrendingDown className="h-4 w-4" /> : null}
                {formatSignedCurrency(capacityChange, formatCurrency)}
              </p>
              {baseCapacity > 0 && capacityChange !== 0 && (
                <p className="text-[10px] text-muted-foreground">
                  ({((capacityChange / baseCapacity) * 100).toFixed(1)}%)
                </p>
              )}
            </div>
          </div>

          {/* Loan-required / target progress bar */}
          {acq && target && target > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Progress to target</span>
                <span className="font-medium">
                  {formatCurrency(acq.maxPurchasePrice)} / {formatCurrency(target)}
                </span>
              </div>
              <Progress
                value={Math.min(100, target > 0 ? (acq.maxPurchasePrice / target) * 100 : 0)}
                className={`h-1.5 ${meetsTarget ? '[&>div]:bg-success' : '[&>div]:bg-brand-500'}`}
              />
              {acq.loanRequiredForPurchase !== undefined && (
                <div className="flex items-center justify-between text-[11px] pt-1">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Banknote className="h-3 w-3" /> Loan required
                  </span>
                  <span className="font-medium">
                    {formatCurrency(acq.loanRequiredForPurchase)}
                    <span className="text-muted-foreground ml-1">
                      / {formatCurrency(acq.loanAvailableForPurchase)} available
                    </span>
                  </span>
                </div>
              )}
              {acq.netCashAfterSettlement !== undefined && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Net cash post-settlement</span>
                  <span className={`font-medium ${acq.netCashAfterSettlement < 0 ? 'text-destructive' : 'text-success dark:text-success'}`}>
                    {formatSignedCurrency(acq.netCashAfterSettlement, formatCurrency)}
                  </span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ FLOOR BANNER — surface when displayed capacity is clamped at $0 ═══ */}
      {floorActive && (
        <Card className="border border-warning/40 bg-warning/5">
          <CardContent className="py-3">
            <div className="flex gap-3">
              <Info className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div className="space-y-2 flex-1">
                <p className="text-xs font-semibold text-foreground">
                  Capacity is clamped at the $0 servicing floor
                </p>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  Base monthly surplus is negative under APRA stress assumptions, so the
                  engine returns $0 lendable capacity. The
                  <span className="font-semibold text-foreground"> "if floor lifted" </span>
                  column ranks each lever's <em>diagnostic</em> impact on the underlying
                  surplus × annuity factor — use it to see which levers move the needle.
                  These figures are not lendable amounts; they describe how far above (or
                  below) zero the client's servicing position would sit if the $0 floor
                  did not exist.
                </p>
                {(typeof baseRawSurplus === 'number' && typeof scenarioRawSurplus === 'number') && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Base surplus</p>
                      <p className={`text-xs font-semibold tabular-nums ${baseRawSurplus < 0 ? 'text-destructive' : 'text-success dark:text-success'}`}>
                        {formatSignedCurrency(Math.round(baseRawSurplus), formatCurrency)}/mo
                      </p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        ≈ {formatSignedCurrency(baseTheoreticalCapacity ?? 0, formatCurrency)} theoretical
                      </p>
                    </div>
                    <div className="rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Scenario surplus</p>
                      <p className={`text-xs font-semibold tabular-nums ${scenarioRawSurplus < 0 ? 'text-destructive' : 'text-success dark:text-success'}`}>
                        {formatSignedCurrency(Math.round(scenarioRawSurplus), formatCurrency)}/mo
                      </p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        ≈ {formatSignedCurrency(scenarioTheoreticalCapacity ?? 0, formatCurrency)} theoretical
                      </p>
                    </div>
                  </div>
                )}
                {Math.abs(theoreticalCapacityChange) > 0 && (
                  <p className="text-[11px] text-foreground/80 leading-snug pt-1">
                    Net theoretical movement vs base:{' '}
                    <span className={`font-semibold ${
                      theoreticalCapacityChange > 0
                        ? 'text-success dark:text-success'
                        : 'text-destructive'
                    }`}>
                      {formatSignedCurrency(theoreticalCapacityChange, formatCurrency)}
                    </span>
                    {typeof baseRawSurplus === 'number' && typeof scenarioRawSurplus === 'number' && (
                      <>
                        {' '}({formatSignedCurrency(Math.round(scenarioRawSurplus - baseRawSurplus), formatCurrency)}/mo
                        change in raw surplus)
                      </>
                    )}.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ F4 — PER-LEVER ATTRIBUTION WATERFALL ═══ */}
      {leverAttribution.length > 0 && (
        <Card className="border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Layers className="h-3.5 w-3.5 text-primary" />
              Lever Attribution
              <span className="ml-auto text-[10px] font-normal text-muted-foreground normal-case tracking-normal">
                {floorActive ? 'If floor lifted · capacity impact in isolation' : 'Capacity impact in isolation'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sortedLevers.map(lever => {
              // When the floor is active, the floored `capacityImpact` is $0 for
              // every lever and tells the broker nothing — pivot the row to the
              // theoretical (unfloored) impact so the column actually informs.
              const displayedImpact = floorActive
                ? (lever.theoreticalImpact ?? 0)
                : lever.capacityImpact;
              const positive = displayedImpact > 0;
              const widthPct = (Math.abs(displayedImpact) / maxAbs) * 100;
              return (
                <div key={lever.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-foreground font-medium truncate flex-1">
                      {lever.label}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {lever.cashflowNote && (
                        <span className="text-[10px] text-muted-foreground">{lever.cashflowNote}</span>
                      )}
                      <span className={`font-semibold tabular-nums ${
                        positive ? 'text-success dark:text-success' :
                        displayedImpact < 0 ? 'text-destructive' :
                        'text-muted-foreground'
                      }`}>
                        {formatSignedCurrency(displayedImpact, formatCurrency)}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        positive ? 'bg-success' :
                        displayedImpact < 0 ? 'bg-destructive' :
                        'bg-muted-foreground/40'
                      }`}
                      style={{ width: `${Math.max(2, widthPct)}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {/* Compounding interaction residual — only meaningful when floor is NOT active */}
            {!floorActive && showInteraction && (
              <>
                <Separator className="my-2" />
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground italic flex items-center gap-1">
                      <ArrowRight className="h-3 w-3" />
                      Compounding interaction
                    </span>
                    <span className={`font-semibold tabular-nums ${
                      interactionResidual > 0 ? 'text-success dark:text-success' :
                      'text-destructive'
                    }`}>
                      {formatSignedCurrency(interactionResidual, formatCurrency)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    Levers interact: applying them together produces a different total than the sum of their individual impacts.
                  </p>
                </div>
              </>
            )}

            <Separator className="my-2" />
            <div className="flex items-center justify-between text-sm font-bold">
              <span>
                {floorActive ? 'Total theoretical impact' : 'Total scenario impact'}
              </span>
              <span className={`tabular-nums ${
                (floorActive ? theoreticalCapacityChange : capacityChange) > 0
                  ? 'text-success dark:text-success'
                  : (floorActive ? theoreticalCapacityChange : capacityChange) < 0
                  ? 'text-destructive'
                  : 'text-muted-foreground'
              }`}>
                {formatSignedCurrency(
                  floorActive ? theoreticalCapacityChange : capacityChange,
                  formatCurrency
                )}
              </span>
            </div>

            {floorActive && Math.abs(sumTheoretical - theoreticalCapacityChange) > 1000 && (
              <p className="text-[10px] text-muted-foreground italic leading-tight pt-1">
                Per-lever theoretical sum: {formatSignedCurrency(sumTheoretical, formatCurrency)}.
                Difference vs combined ({formatSignedCurrency(theoreticalCapacityChange - sumTheoretical, formatCurrency)})
                reflects compounding interaction between levers.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
