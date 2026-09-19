import { Badge } from "@/components/ui/badge";
import {
  CASE_STAGE_LABELS, RISK_BADGE_CLASSES, SERVICE_GATE_LABELS,
  type AmlCaseStage, type AmlServiceGateStatus,
} from "@/lib/aml/caseDimensions";
import type { AmlRiskRating } from "@/lib/aml/amlCasesApi";
import { cn } from "@/lib/utils";

/**
 * One visual language for the three case dimensions shown on every AML
 * surface — stage, risk rating and service gate. The register, workspace,
 * dialog and Compliance Home previously each composed these from raw
 * `Badge` + ad-hoc classes (audit §2.33); these wrappers keep the shared
 * vocabulary (`caseDimensions.ts`) and the shared treatment together.
 *
 * Status is never colour-only: every badge carries its label text, and the
 * risk/gate tones come from the fixed semantic tokens.
 */

export function AmlStageBadge({ stage, className }: { stage: AmlCaseStage; className?: string }) {
  return (
    <Badge variant="secondary" className={className}>
      {CASE_STAGE_LABELS[stage]}
    </Badge>
  );
}

export function AmlRiskBadge({
  risk, prefix = false, className,
}: { risk: AmlRiskRating | null | undefined; prefix?: boolean; className?: string }) {
  if (!risk) {
    return (
      <Badge variant="outline" className={cn("text-muted-foreground", className)}>
        {prefix ? "Risk: Unrated" : "Unrated"}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn(RISK_BADGE_CLASSES[risk], className)}>
      {prefix ? `Risk: ${risk.toUpperCase()}` : risk.toUpperCase()}
    </Badge>
  );
}

const GATE_TONE_CLASSES: Partial<Record<AmlServiceGateStatus, string>> = {
  approved: "border-success/40 text-success",
  approved_with_controls: "border-success/40 text-success",
  locked: "border-destructive/40 text-destructive",
  terminated: "border-destructive/40 text-destructive",
};

export function AmlGateBadge({
  gate, prefix = false, className,
}: { gate: AmlServiceGateStatus; prefix?: boolean; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(GATE_TONE_CLASSES[gate] ?? "text-muted-foreground", className)}
    >
      {prefix ? `Service gate: ${SERVICE_GATE_LABELS[gate]}` : SERVICE_GATE_LABELS[gate]}
    </Badge>
  );
}
