/**
 * The ten-stage AML/CTF journey rail — the workspace's primary navigation.
 *
 * ── What clicking a stage does, and does not do ────────────────────────
 * It navigates. That is all. Selecting a stage — or reaching the last one
 * — changes no case stage, no risk rating, no verification outcome, no
 * screening result, no decision, no service gate, no Passport version and
 * no partner access. Every mark on this rail is read from evidence by
 * `deriveAmlJourney`, so a stage cannot be "completed" by walking to it.
 *
 * ── Status is never colour alone ───────────────────────────────────────
 * Each step carries a glyph (a tick, a number, a caution mark), a visible
 * label, and a screen-reader status sentence. `aria-current="step"` marks
 * the open stage. The rail is an ordered list inside a landmark, so
 * assistive technology reads it as the sequence it is.
 */
import { useLayoutEffect, useRef } from "react";
import { AlertTriangle, Check, HelpCircle, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type AmlJourney,
  type AmlJourneyStage,
  type AmlJourneyStageId,
} from "@/lib/aml/journeyModel";
import type { AmlEvidenceState } from "@/lib/aml/workspaceViewModel";
import { EVIDENCE_STATE_LABELS } from "@/lib/aml/workspaceViewModel";

/**
 * How a step draws. Deliberately restrained: only the two states an
 * operator must not miss get a tone, and the open step is marked by weight
 * and a ring rather than by yet another colour.
 */
const STEP_TONE: Record<AmlEvidenceState, string> = {
  complete: "border-success/50 bg-success/10 text-success",
  attention: "border-warning/60 bg-warning/10 text-warning",
  in_progress: "border-primary/40 bg-primary/5 text-primary",
  not_started: "border-border bg-muted/40 text-muted-foreground",
  not_applicable: "border-border/60 bg-muted/20 text-muted-foreground/70",
  unknown: "border-border/60 bg-muted/20 text-muted-foreground",
};

function StepGlyph({ stage }: { stage: AmlJourneyStage }) {
  /*
   * A stage whose evidence is in but whose predecessors are not keeps its
   * NUMBER rather than taking a tick. The evidence is real — AML evidence
   * genuinely arrives out of order — but a tick at 7 above an outstanding 5
   * reads as "the case got this far", which it did not.
   */
  if (stage.status === "complete" && stage.aheadOfSequence) {
    return <span className="text-[13px] font-semibold tabular-nums">{stage.number}</span>;
  }
  if (stage.status === "complete") return <Check aria-hidden className="h-4 w-4" />;
  if (stage.attention === "critical") return <AlertTriangle aria-hidden className="h-4 w-4" />;
  if (stage.status === "not_applicable") return <Minus aria-hidden className="h-3.5 w-3.5" />;
  if (stage.status === "unknown") return <HelpCircle aria-hidden className="h-4 w-4" />;
  // A blocking stage keeps its number. Swapping it for a "no entry" glyph
  // read as "you may not go here", which is the opposite of the truth: a
  // blocked stage is exactly where the work is.
  return <span className="text-[13px] font-semibold tabular-nums">{stage.number}</span>;
}

/** The sentence a screen reader hears after the stage name. */
function statusSentence(stage: AmlJourneyStage): string {
  const parts = [EVIDENCE_STATE_LABELS[stage.status].toLowerCase()];
  if (stage.aheadOfSequence) parts.push("recorded, but an earlier stage is outstanding");
  if (stage.blocking) parts.push("blocking");
  if (stage.owner !== "none") parts.push(stage.ownerLabel.toLowerCase());
  return parts.join(", ");
}

export interface AmlJourneyRailProps {
  journey: AmlJourney;
  /** The stage the workspace is showing; `null` on the case record. */
  activeStageId: AmlJourneyStageId | null;
  onSelectStage: (id: AmlJourneyStageId) => void;
  /** Stages with no section this role may open are omitted entirely. */
  visibleStages: ReadonlySet<AmlJourneyStageId>;
  className?: string;
}

export function AmlJourneyRail({
  journey,
  activeStageId,
  onSelectStage,
  visibleStages,
  className,
}: AmlJourneyRailProps) {
  const stages = journey.stages.filter((s) => visibleStages.has(s.id));

  /*
   * ── Bringing the open stage into view ────────────────────────────────
   * Ten steps fit without scrolling from ~1024px up. Below that the rail
   * scrolls, and clicking a step focuses it, which the browser scrolls into
   * view on its own.
   *
   * Arriving is the case that was missed, and on a phone it is most of them.
   * A deep link with `?stage=`, the Previous/Next stage buttons under the
   * content, the next-action card and every link from Compliance Home all
   * change the open stage without a step on this rail ever taking focus — so
   * the rail stayed parked at Activation while the reader was on Screening,
   * with the stage they were actually on clipped at the right-hand edge.
   *
   * `scrollLeft` is set directly rather than calling `scrollIntoView`: that
   * method can scroll ancestors on both axes, and moving the PAGE because a
   * strip inside it moved is a worse defect than the one being fixed.
   */
  const railRef = useRef<HTMLOListElement | null>(null);
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail || !activeStageId) return;
    if (rail.scrollWidth <= rail.clientWidth + 1) return;
    const step = rail.querySelector<HTMLElement>(`[data-stage="${activeStageId}"]`);
    if (!step) return;
    const target = step.offsetLeft - (rail.clientWidth - step.offsetWidth) / 2;
    const left = Math.max(0, Math.min(target, rail.scrollWidth - rail.clientWidth));
    if (Math.abs(rail.scrollLeft - left) < 2) return;
    const still = typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({ left, behavior: still ? "auto" : "smooth" });
  }, [activeStageId, stages.length]);

  return (
    <nav aria-label="Compliance journey" className={cn("min-w-0", className)}>
      <ol
        ref={railRef}
        className="flex min-w-0 snap-x snap-proximity gap-0 overflow-x-auto pb-1 [scrollbar-width:thin]"
        aria-label="Compliance journey stages"
      >
        {stages.map((stage, index) => {
          const active = stage.id === activeStageId;
          const previous = index > 0 ? stages[index - 1] : null;
          return (
            <li
              key={stage.id}
              data-stage={stage.id}
              aria-current={active ? "step" : undefined}
              className="relative flex min-w-[88px] max-w-[150px] flex-1 shrink-0 snap-center scroll-mx-4 flex-col items-center"
            >
              {/* Connectors sit behind the discs and carry the same reading:
                  the segment leading into a completed step is complete. */}
              {index > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-0 right-1/2 top-[18px] h-px",
                    previous?.status === "complete" && !previous?.aheadOfSequence
                      ? "bg-success/40" : "bg-border",
                  )}
                />
              )}
              {index < stages.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-1/2 right-0 top-[18px] h-px",
                    stage.status === "complete" && !stage.aheadOfSequence
                      ? "bg-success/40" : "bg-border",
                  )}
                />
              )}

              <button
                type="button"
                onClick={() => onSelectStage(stage.id)}
                title={`${stage.label} — ${statusSentence(stage)}`}
                className={cn(
                  "group relative z-10 flex w-full flex-col items-center gap-1.5 rounded-lg px-1.5 pb-1.5 pt-1 text-center transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                  active ? "bg-accent/60" : "hover:bg-accent/40",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-card transition-shadow",
                    STEP_TONE[stage.status],
                    active && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                  )}
                >
                  <StepGlyph stage={stage} />
                </span>
                <span
                  className={cn(
                    "line-clamp-2 text-[11px] leading-tight",
                    active ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {stage.shortLabel}
                </span>
                <span className="sr-only">
                  Stage {stage.number} of {journey.stages.length}, {statusSentence(stage)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
