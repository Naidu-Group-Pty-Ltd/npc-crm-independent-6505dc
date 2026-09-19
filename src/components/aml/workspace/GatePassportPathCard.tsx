/**
 * Stage 9's guided path: decision → gate → preview → issue, with the
 * Stage 8 outcome pulled through and every step a link to where it is
 * done. Derives nothing — states come from `gatePassportPath.pure.ts`,
 * the audited acts stay on their own surfaces (the Decision stage, the
 * reliance panel, the digital passport page).
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, CheckCircle2, ChevronRight, CircleDashed, Eye, Lock } from "lucide-react";
import {
  gatePassportComplete, gatePassportProgress, type GatePassportStep,
} from "@/lib/aml/gatePassportPath.pure";

function StepIcon({ state }: { state: GatePassportStep["state"] }) {
  if (state === "done") return <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />;
  if (state === "blocked") return <Lock className="h-4 w-4 text-warning" aria-hidden />;
  if (state === "current") return <ChevronRight className="h-4 w-4 text-primary" aria-hidden />;
  if (state === "anytime") return <Eye className="h-4 w-4 text-muted-foreground" aria-hidden />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground/60" aria-hidden />;
}

const STATE_LABEL: Record<GatePassportStep["state"], string> = {
  done: "Done",
  current: "Next",
  outstanding: "Later",
  blocked: "Blocked",
  anytime: "Anytime",
};

export function GatePassportPathCard({ steps, onStepClick, onContinue }: {
  steps: GatePassportStep[];
  onStepClick?: (key: GatePassportStep["key"]) => void;
  /** Stage 10 — partners — once the credential is in force. */
  onContinue?: () => void;
}) {
  const complete = gatePassportComplete(steps);
  const progress = gatePassportProgress(steps);
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1 space-y-0 pb-2">
        <CardTitle className="text-sm">Gate &amp; Passport, in order</CardTitle>
        {/* ── ONE count, and it counts these steps ──────────────────────
            The header above and the rail beside both rendered their own
            progress reading — "0 of 3 items on this stage complete" next to
            a four-step list. Both were true and neither was about this
            list, which is the same defect Stage 5 already fixed. Stage 9
            defers to this number now; `anytime` is excluded, because a look
            is not a debt. */}
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {progress.done} of {progress.total} done
        </span>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* ── What actually finishes this stage ─────────────────────────
            "There doesn't seem to be a clear distinction for section 9 to be
            ticked off as green after the user has already ticked off the
            Approved function." Approving the gate on a cleared case whose
            Passport is issued completes the stage outright — and nothing on
            the screen said so before the click. It does now, and only when
            it is true: one owed step left, and actionable by this operator. */}
        {!complete && progress.finishesStage && progress.next && (
          <div
            className="rounded-md border border-primary/40 bg-primary/5 p-2.5"
            data-testid="gate-passport-finishing-step"
          >
            <p className="text-xs text-primary">
              <span className="font-medium">One step left — {progress.next.label}.</span>{" "}
              Completing it finishes this stage and the case moves on to Partners.
            </p>
          </div>
        )}
        {!complete && !progress.finishesStage && progress.next?.blockedBy && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-2.5">
            <p className="text-xs text-warning">
              <span className="font-medium">Waiting on {progress.next.label}.</span>{" "}
              {progress.next.blockedBy}.
            </p>
          </div>
        )}
        {complete && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success/40 bg-success/5 p-2.5">
            <p className="text-xs text-success">
              The service may proceed and the Passport is in force. Share it with partners
              below; ongoing CDD keeps the case current from here.
            </p>
            {onContinue && (
              <Button size="sm" className="h-7" onClick={onContinue}>
                Continue to Ongoing CDD
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
