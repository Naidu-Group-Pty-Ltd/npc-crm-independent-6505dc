/**
 * Can the designated service proceed?
 *
 * This card exists to make one relationship unmistakable:
 *
 *     identity is evidence · screening is evidence · funding is evidence
 *     ownership is evidence · risk is an assessment
 *     THE SERVICE GATE IS AN EXPLICIT DECISION
 *
 * So it reads `service_gate_status` and the gate contract, and nothing else.
 * No amount of green in the compliance summary and no risk rating moves it,
 * and the footnote on the card says so in the operator's own language.
 */
import { CheckCircle2, Lock, ShieldQuestion, XCircle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { displayDate } from "@/lib/aml/displayDate";
import { cn } from "@/lib/utils";
import type { AmlReadinessLevel, AmlServiceReadiness } from "@/lib/aml/workspaceViewModel";

import { ATTENTION_TEXT } from "./attentionTone";

const ICONS: Record<AmlReadinessLevel, typeof CheckCircle2> = {
  ready: CheckCircle2,
  ready_with_controls: CheckCircle2,
  conditions_outstanding: ShieldQuestion,
  under_review: ShieldQuestion,
  not_ready: XCircle,
  blocked: Lock,
  ended: XCircle,
};

export function AmlServiceReadinessCard({
  readiness,
  className,
}: {
  readiness: AmlServiceReadiness;
  className?: string;
}) {
  const Icon = ICONS[readiness.level];

  return (
    <Card className={className}>
      <CardContent className="space-y-3 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Service readiness
        </p>

        <div className="flex items-start gap-2.5">
          <Icon aria-hidden className={cn("mt-0.5 h-5 w-5 shrink-0", ATTENTION_TEXT[readiness.attention])} />
          <div className="min-w-0">
            <p className="text-base font-semibold leading-snug">{readiness.label}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{readiness.detail}</p>
          </div>
        </div>

        {readiness.reasons.length > 0 && readiness.level !== "ready" && (
          <div className="rounded-md border border-border/60 bg-muted/30 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Why not
            </p>
            <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
              {readiness.reasons.map((reason) => (
                <li key={reason} className="flex gap-1.5">
                  <span aria-hidden className="text-muted-foreground/60">—</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {readiness.openConditions.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Outstanding conditions
            </p>
            <ul className="mt-1.5 space-y-1 text-xs">
              {readiness.openConditions.map((condition) => (
                <li key={condition.id ?? condition.label} className="flex gap-1.5">
                  <span aria-hidden className="text-warning">•</span>
                  <span>{condition.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {readiness.decidedAt && (
          <p className="text-xs text-muted-foreground">
            Decision recorded {displayDate(readiness.decidedAt)}
            {readiness.decidedBy ? ` by ${readiness.decidedBy}` : ""}.
          </p>
        )}

        {readiness.unavailableFacts.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Conditions and the decision record could not be read; the gate value above is still
            canonical.
          </p>
        )}

        <p className="border-t border-border/50 pt-3 text-[11px] leading-relaxed text-muted-foreground">
          The service gate is an explicit decision recorded by an authorised decision-maker.
          Verification, screening, funding and ownership are evidence for that decision and the risk
          rating is an assessment — none of them moves the gate.
        </p>
      </CardContent>
    </Card>
  );
}
