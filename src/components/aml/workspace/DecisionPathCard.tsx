/**
 * Stage 8's guided path — the same facts the cards below carry, arranged
 * as numbered steps with one of them open. Derives nothing new: every
 * state comes from `decisionPath.pure.ts`, and the audited actions stay on
 * the cards beneath (this card never records anything).
 *
 * Each step is a link to its own controls — "no structure and clear
 * direction" was the reported defect, so the path is the structure: click
 * a step, land on the card that performs it. And a finished path says so
 * and drives FORWARD: a green completion state with the road to Gate &
 * Passport, because a done stage with no onward door strands the operator
 * exactly as an open stage with no order did.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, CheckCircle2, ChevronRight, CircleDashed, Lock, Minus } from "lucide-react";
import { decisionPathComplete, type DecisionStep } from "@/lib/aml/decisionPath.pure";

function StepIcon({ state }: { state: DecisionStep["state"] }) {
  if (state === "done") return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />;
  if (state === "settled") return <Minus className="h-4 w-4 text-muted-foreground" aria-hidden />;
  if (state === "blocked") return <Lock className="h-4 w-4 text-warning" aria-hidden />;
  if (state === "current") return <ChevronRight className="h-4 w-4 text-primary" aria-hidden />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground/60" aria-hidden />;
}

const STATE_LABEL: Record<DecisionStep["state"], string> = {
  done: "Done",
  current: "Next",
  outstanding: "Later",
  blocked: "Blocked",
  settled: "—",
};

export function DecisionPathCard({ steps, onStepClick, onContinue }: {
  steps: DecisionStep[];
  /** Land on the card that performs this step. */
  onStepClick?: (key: DecisionStep["key"]) => void;
  /** The onward door once every owed step is discharged — Gate & Passport. */
  onContinue?: () => void;
}) {
  const complete = decisionPathComplete(steps);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">The decision, in order</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {complete && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/40 bg-success/5 p-2.5">
            <p className="text-xs text-success">
              Every step of the decision is recorded. The case moves on at Gate &amp; Passport.
            </p>
            {onContinue && (
              <Button size="sm" className="h-7" onClick={onContinue}>
                Continue to Gate &amp; Passport
                <ArrowRight aria-hidden className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}
        <ol className="space-y-1.5">
          {steps.map((step, i) => {
            const inner = (
              <>
                <span className="mt-0.5 shrink-0"><StepIcon state={step.state} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{i + 1}. {step.label}</span>
                    <span className={cn(
                      "text-[11px] uppercase tracking-wide",
                      step.state === "current" ? "text-primary"
                        : step.state === "blocked" ? "text-warning"
                          : "text-muted-foreground",
                    )}>
                      {STATE_LABEL[step.state]}
                    </span>
                  </span>
                  <span className="block text-xs text-muted-foreground">{step.detail}</span>
                  {step.blockedBy && (
                    <span className="block text-xs text-warning">{step.blockedBy}.</span>
                  )}
                </span>
              </>
            );
            const tone = cn(
              "flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left",
              step.state === "current"
                ? "border-primary/40 bg-primary/5"
                : step.state === "blocked"
                  ? "border-warning/40 bg-warning/5"
                  : "border-border/50",
            );
            return (
              <li key={step.key}>
                {onStepClick ? (
                  <button
                    type="button"
                    className={cn(tone, "transition-colors hover:border-primary/60")}
                    onClick={() => onStepClick(step.key)}
                    aria-label={`Go to step ${i + 1}: ${step.label}`}
                  >
                    {inner}
                  </button>
                ) : (
                  <div className={tone}>{inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
