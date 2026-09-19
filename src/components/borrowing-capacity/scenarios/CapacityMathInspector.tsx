import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Calculator } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CapacityMathInspectorProps {
  /** Base side */
  baseAfterTaxIncome: number;
  baseLivingExpenses: number;
  baseCommitments: number;
  baseRawSurplus: number;
  baseAssessmentRate: number;
  baseTermYears: number;
  baseAnnuityFactor: number;
  baseTheoreticalCapacity: number;
  baseDisplayedCapacity: number;
  /** Scenario side */
  scenarioAfterTaxIncome: number;
  scenarioLivingExpenses: number;
  scenarioCommitments: number;
  scenarioRawSurplus: number;
  scenarioAssessmentRate: number;
  scenarioTermYears: number;
  scenarioAnnuityFactor: number;
  scenarioTheoreticalCapacity: number;
  scenarioDisplayedCapacity: number;
  formatCurrency: (n: number) => string;
}

/**
 * Phase 4 — Live Math Inspector
 * Renders the full waterfall:
 *   Income − Expenses − Commitments = Surplus
 *   Surplus × AnnuityFactor(rate, term) = Theoretical Capacity
 *   Theoretical, floored at $0 (and DTI-capped) = Displayed Capacity
 *
 * Side-by-side base vs scenario so a broker can audit every number that
 * feeds the headline figure.
 */
export function CapacityMathInspector({
  baseAfterTaxIncome,
  baseLivingExpenses,
  baseCommitments,
  baseRawSurplus,
  baseAssessmentRate,
  baseTermYears,
  baseAnnuityFactor,
  baseTheoreticalCapacity,
  baseDisplayedCapacity,
  scenarioAfterTaxIncome,
  scenarioLivingExpenses,
  scenarioCommitments,
  scenarioRawSurplus,
  scenarioAssessmentRate,
  scenarioTermYears,
  scenarioAnnuityFactor,
  scenarioTheoreticalCapacity,
  scenarioDisplayedCapacity,
  formatCurrency,
}: CapacityMathInspectorProps) {
  const [open, setOpen] = useState(false);

  const Row = ({
    label,
    base,
    scenario,
    op,
    isResult,
    note,
  }: {
    label: string;
    base: string;
    scenario: string;
    op?: '+' | '−' | '×' | '=';
    isResult?: boolean;
    note?: string;
  }) => {
    const baseChanged = base !== scenario;
    return (
      <div
        className={cn(
          'grid grid-cols-12 gap-2 items-baseline py-1.5 text-xs',
          isResult && 'border-t border-border pt-2 mt-1 font-semibold',
        )}
      >
        <div className="col-span-1 text-muted-foreground text-center">{op || ''}</div>
        <div className="col-span-5">
          <div className="text-foreground">{label}</div>
          {note && <div className="text-[10px] text-muted-foreground/70">{note}</div>}
        </div>
        <div className="col-span-3 text-right tabular-nums text-muted-foreground">{base}</div>
        <div
          className={cn(
            'col-span-3 text-right tabular-nums',
            baseChanged ? 'text-primary font-medium' : 'text-foreground',
          )}
        >
          {scenario}
        </div>
      </div>
    );
  };

  const fmtRate = (r: number) => `${r.toFixed(2)}%`;
  const fmtFactor = (f: number) => f.toFixed(2);
  const fmtTerm = (t: number) => `${t}yr`;

  const baseDelta = baseDisplayedCapacity - baseTheoreticalCapacity;
  const scenarioDelta = scenarioDisplayedCapacity - scenarioTheoreticalCapacity;

  return (
    <Card className="border-dashed">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Calculator className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium text-foreground">Live Math Inspector</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">Audit Trail</Badge>
            </div>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4 px-4">
            <div className="grid grid-cols-12 gap-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border-b">
              <div className="col-span-1 text-center">Op</div>
              <div className="col-span-5">Component</div>
              <div className="col-span-3 text-right">Base</div>
              <div className="col-span-3 text-right">Scenario</div>
            </div>

            {/* Surplus waterfall */}
            <Row label="Monthly after-tax income" base={formatCurrency(baseAfterTaxIncome)} scenario={formatCurrency(scenarioAfterTaxIncome)} />
            <Row op="−" label="Living expenses" base={formatCurrency(baseLivingExpenses)} scenario={formatCurrency(scenarioLivingExpenses)} />
            <Row op="−" label="Existing commitments" base={formatCurrency(baseCommitments)} scenario={formatCurrency(scenarioCommitments)} note="incl. new equity-release servicing" />
            <Row
              op="="
              label="Raw monthly surplus"
              base={formatCurrency(baseRawSurplus)}
              scenario={formatCurrency(scenarioRawSurplus)}
              isResult
            />

            <div className="h-2" />

            {/* Capacity formula */}
            <Row label="Assessment rate (rate + buffer)" base={fmtRate(baseAssessmentRate)} scenario={fmtRate(scenarioAssessmentRate)} />
            <Row label="Loan term" base={fmtTerm(baseTermYears)} scenario={fmtTerm(scenarioTermYears)} />
            <Row
              op="×"
              label="Annuity factor"
              base={fmtFactor(baseAnnuityFactor)}
              scenario={fmtFactor(scenarioAnnuityFactor)}
              note="(1 − (1 + r)^−n) ÷ r, capped at 280"
            />
            <Row
              op="="
              label="Theoretical capacity"
              base={formatCurrency(baseTheoreticalCapacity)}
              scenario={formatCurrency(scenarioTheoreticalCapacity)}
              isResult
              note="surplus × annuity factor"
            />

            <div className="h-2" />

            {(() => {
              const baseFloored = baseDisplayedCapacity === 0 && baseTheoreticalCapacity < 0;
              const scenarioFloored = scenarioDisplayedCapacity === 0 && scenarioTheoreticalCapacity < 0;
              const baseTrue = baseFloored ? baseTheoreticalCapacity : baseDisplayedCapacity;
              const scenarioTrue = scenarioFloored ? scenarioTheoreticalCapacity : scenarioDisplayedCapacity;
              return (
                <>
                  <Row
                    label={baseFloored || scenarioFloored ? 'True capacity (unfloored)' : 'Displayed capacity (engine)'}
                    base={formatCurrency(baseTrue)}
                    scenario={formatCurrency(scenarioTrue)}
                    isResult
                    note={
                      baseFloored || scenarioFloored
                        ? 'Showing the true (negative) serviceability position. Engine clamps the lendable figure at $0 — see row below.'
                        : (Math.abs(baseDelta) > 1 || Math.abs(scenarioDelta) > 1
                            ? 'Differs from theoretical due to DTI cap or LVR/policy clamp'
                            : 'Matches theoretical — no clamp active')
                    }
                  />
                  {(baseFloored || scenarioFloored) && (
                    <Row
                      label="Engine displayed (lendable, floored at $0)"
                      base={formatCurrency(baseDisplayedCapacity)}
                      scenario={formatCurrency(scenarioDisplayedCapacity)}
                      note="What the bank-side engine reports — used by APRA-aligned outputs"
                    />
                  )}
                </>
              );
            })()}
            <p className="text-[10px] text-muted-foreground/80 mt-3 leading-relaxed">
              <strong>How to read this:</strong> The engine reports the displayed capacity after applying floors
              (capacity ≥ $0) and policy caps (DTI, LVR). The theoretical capacity ignores those clamps so you can
              see the true serviceability movement underneath. When the two differ, the difference is the size of
              the binding constraint.
            </p>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
