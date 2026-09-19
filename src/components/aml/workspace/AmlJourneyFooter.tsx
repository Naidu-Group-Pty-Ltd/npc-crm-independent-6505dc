/**
 * Previous · "Stage X of 10" · Next.
 *
 * ── This control navigates and does nothing else ───────────────────────
 * Pressing Next does not complete the stage it leaves, does not advance
 * `case_stage`, does not touch the service gate, and confers no
 * authorisation on the stage it opens. It is a page turn. That distinction
 * matters enough to be stated on the control itself when the stage being
 * left is not finished, so nobody reads "Next" as "sign off".
 */
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AmlJourneyStage } from "@/lib/aml/journeyModel";

export interface AmlJourneyFooterProps {
  stage: AmlJourneyStage;
  /** Position among the stages this role can actually open. */
  position: number;
  total: number;
  previousLabel: string | null;
  nextLabel: string | null;
  onPrevious: () => void;
  onNext: () => void;
  className?: string;
}

export function AmlJourneyFooter({
  stage,
  position,
  total,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  className,
}: AmlJourneyFooterProps) {
  const unfinished = stage.status !== "complete" && stage.status !== "not_applicable";

  return (
    <nav
      aria-label="Journey stage navigation"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border/60 pt-4",
        className,
      )}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={!previousLabel}
        onClick={onPrevious}
        className="min-w-0"
      >
        <ArrowLeft aria-hidden className="mr-1.5 h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{previousLabel ?? "Previous"}</span>
      </Button>

      <div className="order-last w-full text-center sm:order-none sm:w-auto">
        <p className="text-xs font-medium tabular-nums text-muted-foreground">
          Stage {position} of {total}
        </p>
        {unfinished && nextLabel && (
          <p className="text-[11px] text-muted-foreground">
            Moving on does not complete this stage.
          </p>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        disabled={!nextLabel}
        onClick={onNext}
        className="min-w-0"
      >
        <span className="truncate">{nextLabel ?? "Next"}</span>
        <ArrowRight aria-hidden className="ml-1.5 h-3.5 w-3.5 shrink-0" />
      </Button>
    </nav>
  );
}
