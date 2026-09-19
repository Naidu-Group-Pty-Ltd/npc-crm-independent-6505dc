/**
 * The header of the open journey stage: what this stage is, whose move it
 * is, and what is stopping it.
 *
 * "Whose move is it" is the thing this surface exists to say. A raw status
 * ("kyc_in_progress") tells an operator what the database holds; "Waiting on
 * the client — bank statement requested, awaiting upload" tells them whether
 * to pick the phone up. Both come from the same canonical state; only one is
 * useful at 9am with forty cases open.
 *
 * Nothing here is an authority. The blockers are read from evidence, and the
 * action button navigates to the section where the existing, server-
 * authorised control already lives.
 */
import { AlertTriangle, ArrowRight, Check, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AmlJourneyOwner, AmlJourneyStage } from "@/lib/aml/journeyModel";
import {
  EVIDENCE_STATE_LABELS,
  type AmlWorkspaceSection,
} from "@/lib/aml/workspaceViewModel";

import { ATTENTION_TEXT, EVIDENCE_TEXT } from "./attentionTone";

/**
 * Owner tone. Only "us" and "nobody" are toned; a case waiting on a client
 * or a partner is the normal state of an open case and must not read as a
 * problem.
 */
const OWNER_TONE: Record<AmlJourneyOwner, string> = {
  system: "border-border/70 text-muted-foreground",
  client: "border-border/70 text-muted-foreground",
  partner: "border-border/70 text-muted-foreground",
  analyst: "border-primary/40 text-primary",
  reviewer: "border-primary/40 text-primary",
  mlro: "border-primary/40 text-primary",
  none: "border-success/40 text-success",
};

export interface AmlJourneyStageHeaderProps {
  stage: AmlJourneyStage;
  totalStages: number;
  onOpenSection: (section: AmlWorkspaceSection) => void;
  /**
   * Perform the stage's primary action, when it names one.
   *
   * The button used to do nothing but `onOpenSection`, and a stage's own
   * primary action usually points at the section the stage OPENS ON — so
   * from the place it is most often pressed it navigated to where the
   * operator already was and nothing happened at all. A CTA that names a
   * specific act ("Ask the client for something", "Record PEP
   * determination") has to perform it.
   *
   * Optional: without a handler, or for an action nothing routes, this falls
   * back to the navigation it always did.
   */
  onPerform?: (action: NonNullable<AmlJourneyStage["primaryAction"]>) => void;
  /**
   * Whether the stage's own surface below already carries the action and the
   * progress reading.
   *
   * Set for Stage 5, whose numbered path owns both. It suppresses the repeat
   * here rather than in the path, because the path is the surface an operator
   * works in and the header is the surface they orient by.
   */
  deferToSurfaceBelow?: boolean;
  className?: string;
}

export function AmlJourneyStageHeader({
  stage,
  totalStages,
  onOpenSection,
  onPerform,
  className,
  deferToSurfaceBelow = false,
}: AmlJourneyStageHeaderProps) {
  const readinessTotal = stage.completedItems.length + stage.outstandingItems.length;

  return (
    <header className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {/*
            "Viewing", because this is the stage the OPERATOR has open — not
            the case's own position, which the rail reports separately. Both
            were called "stage", which is how an open Stage 5 beside a
            10-of-10 position read as a contradiction.
          */}
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Viewing · Stage {stage.number} of {totalStages}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight sm:text-xl">{stage.label}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{stage.purpose}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* Two readings, kept apart: what state the stage is in, and who
              has to move. Neither is expressed by colour alone. */}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              "border-border/70",
              EVIDENCE_TEXT[stage.status],
            )}
          >
            {stage.status === "complete" && <Check aria-hidden className="h-3.5 w-3.5" />}
            {EVIDENCE_STATE_LABELS[stage.status]}
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
              OWNER_TONE[stage.owner],
            )}
          >
            {stage.ownerLabel}
          </span>
        </div>
      </div>

      <p className="text-sm">{stage.summary}</p>

      {/* ── What is stopping this stage ─────────────────────────────── */}
      {stage.blockers.length > 0 && (
        <ul className="space-y-1.5" aria-label="Blocking this stage">
          {stage.blockers.map((blocker) => (
            <li
              key={blocker.key}
              className={cn(
                "flex gap-2 rounded-md border px-3 py-2",
                blocker.attention === "critical"
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-warning/40 bg-warning/5",
              )}
            >
              <AlertTriangle
                aria-hidden
                className={cn("mt-0.5 h-4 w-4 shrink-0", ATTENTION_TEXT[blocker.attention])}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium leading-snug">{blocker.label}</p>
                {blocker.detail && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{blocker.detail}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Advisory, not blocking ──────────────────────────────────── */}
      {stage.warnings.length > 0 && (
        <ul className="space-y-1" aria-label="Warnings on this stage">
          {stage.warnings.map((warning) => (
            <li key={warning.key} className="flex gap-2 text-xs text-muted-foreground">
              <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="text-foreground">{warning.label}</span>
                {warning.detail ? ` — ${warning.detail}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        ── The act, and the count, are said ONCE on a screen ──────────
        Stage 5 renders a numbered path that owns the same action and keeps
        its own progress. Before this, one screen carried the act three times
        — this header, the path's open step, and the right rail — in three
        sets of words, plus TWO different progress readings ("2 of 3 items on
        this stage complete" beside "3 of 5 settled"). Both counts were true
        and they counted different things, which is worse than either alone.

        So when the surface below owns the action, this header states where
        the stage is and stops. Nothing is hidden that is not being said
        better a few centimetres further down; on every other stage, which
        has no such surface, the header behaves exactly as it did.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {stage.primaryAction && !deferToSurfaceBelow && (
          <Button
            size="sm"
            onClick={() => {
              const action = stage.primaryAction!;
              if (onPerform) onPerform(action);
              else onOpenSection(action.section);
            }}
          >
            {stage.primaryAction.label}
            <ArrowRight aria-hidden className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        )}
        {readinessTotal > 0 && !deferToSurfaceBelow && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {stage.completedItems.length} of {readinessTotal} item
            {readinessTotal === 1 ? "" : "s"} on this stage complete
          </p>
        )}
        {stage.unavailableFacts.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Partial reading — {stage.unavailableFacts.join(", ")} could not be read.
          </p>
        )}
      </div>
    </header>
  );
}
