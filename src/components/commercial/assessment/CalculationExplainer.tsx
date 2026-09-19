import { useMemo, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AssessmentResult, ExplainStep } from '@/lib/ciAssessment/engine';

/**
 * "How this was calculated".
 *
 * Grouped rather than a flat list of thirty rows, and collapsed by default —
 * the point is that the methodology is *available*, not that it is unavoidable.
 * Every step names its inputs, its formula and its rounded output.
 */
export function CalculationExplainer({ result }: { result: AssessmentResult }) {
  const [openGroup, setOpenGroup] = useState<string | null>('Capacity caps');

  const groups = useMemo(() => {
    const map = new Map<string, ExplainStep[]>();
    result.explain.forEach((step) => {
      const existing = map.get(step.group);
      if (existing) existing.push(step);
      else map.set(step.group, [step]);
    });
    return Array.from(map.entries());
  }, [result.explain]);

  return (
    <section className="space-y-2" aria-label="Calculation methodology">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">How this was calculated</h3>
        <p className="text-xs text-muted-foreground">
          Engine {result.engineVersion} · Policy {result.policyVersion} · {result.policy.profileLabel}
        </p>
      </div>

      {groups.map(([group, steps]) => (
        <Collapsible
          key={group}
          open={openGroup === group}
          onOpenChange={(open) => setOpenGroup(open ? group : null)}
          className="ci-advanced"
        >
          <CollapsibleTrigger className="ci-advanced-trigger group">
            <span className="flex items-center gap-2">
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
              {group}
            </span>
            <span className="text-xs font-normal text-muted-foreground">{steps.length} step{steps.length === 1 ? '' : 's'}</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="ci-advanced-content">
            <dl>
              {steps.map((step, index) => (
                <div
                  key={`${group}-${step.label}-${index}`}
                  className={cn('ci-explain-row', step.label.includes('(binding)') && 'ci-explain-binding')}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <dt className="ci-explain-label">{step.label}</dt>
                      <p className="ci-explain-formula">{step.formula}</p>
                      {step.inputs.length ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Inputs: {step.inputs.join(' · ')}
                        </p>
                      ) : null}
                      {step.note ? (
                        <p className="mt-1 text-xs italic text-muted-foreground">{step.note}</p>
                      ) : null}
                    </div>
                    <dd className="ci-explain-value">{step.value}</dd>
                  </div>
                </div>
              ))}
            </dl>
          </CollapsibleContent>
        </Collapsible>
      ))}

      <div className="ci-advanced">
        <div className="ci-advanced-content border-t-0">
          <h4 className="text-sm font-semibold text-foreground">Rounding and assumptions</h4>
          <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
            <li>Money is carried in whole cents throughout and rounded half-up; displayed figures are whole dollars.</li>
            <li>Ratios (LVR, DSCR, ICR, debt yield) are held to four decimal places and displayed to two.</li>
            <li>Rental income is shaded by {result.policy.rentalShadingPct}% before it services debt.</li>
            <li>Revolving facilities are assessed on their limit at {result.policy.creditCardAssessmentPct}% per month.</li>
            <li>Non-recurring income is shaded by {result.policy.nonRecurringIncomeShadingPct}%.</li>
            <li>
              Policy layers applied: {result.policy.layers.map((layer) => layer.label).join(' → ')}.
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
