/**
 * The sticky right rail: live position, stage readiness, attention, and the
 * one thing to do next.
 *
 * Four questions, always in the same order and always in the same place, so
 * an operator learns where to look once:
 *
 *   LIVE POSITION   where this case stands, across every dimension
 *   STAGE READINESS what is done on the open stage, and what is not
 *   ATTENTION       the ranked list of unresolved things
 *   NEXT ACTION     the single dominant move
 *
 * ── Two rules this rail is built around ────────────────────────────────
 * A readiness count is NOT a clearance. "6 of 6 complete" says six items on
 * one stage are done; it never says the customer may be served, and the
 * footnote under the meter says so in the operator's own words. The service
 * gate is a separate, explicit human decision and appears as its own line.
 *
 * The risk rating is internal. It renders only when the caller says the
 * viewer is authorised for it — this component never decides that itself.
 */
import { AlertTriangle, ArrowRight, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AmlLivePosition, AmlJourneyStage } from "@/lib/aml/journeyModel";
import type {
  AmlNextAction,
  AmlOutstandingItem,
  AmlWorkspaceSection,
} from "@/lib/aml/workspaceViewModel";

import { ATTENTION_EDGE, ATTENTION_TEXT } from "./attentionTone";

function RailHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </p>
  );
}

function PositionRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1.5 last:border-b-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 text-right text-xs font-medium leading-snug", tone)}>{value}</dd>
    </div>
  );
}

export interface AmlLivePositionRailProps {
  position: AmlLivePosition;
  stage: AmlJourneyStage;
  nextAction: AmlNextAction;
  attention: AmlOutstandingItem[];
  /** The internal risk rating, already authorised by the caller. */
  riskLabel: string | null;
  /**
   * Stage 1 carries a full-width next action and an "also outstanding"
   * list of its own. Repeating both here at a third of the width is noise,
   * not emphasis — so the caller turns them off there and nowhere else.
   */
  showAttention?: boolean;
  showNextAction?: boolean;
  onOpenSection: (section: AmlWorkspaceSection) => void;
  /**
   * The section the operator is looking at, when the caller knows it.
   *
   * Used only to stop the rail offering to navigate to where they already
   * are — "Go to stage 5" beside stage 5's own open step was the third copy
   * of one act on a single screen.
   */
  currentSection?: AmlWorkspaceSection;
  /**
   * Whether the surface below already carries this stage's progress.
   *
   * Set for Stage 5, whose numbered path keeps its own count. Suppressing
   * the CTA in the header was only half the fix: the rail went on rendering
   * a SECOND meter beside the path's, and the two counted different things —
   * "2 of 3 items on this stage complete" next to "3 of 5 settled". Both
   * were true, which is what made it worse than either alone, because an
   * operator cannot tell which one is the state of the case.
   *
   * The stage and its label stay. Only the number and the bar go.
   */
  deferReadinessToSurfaceBelow?: boolean;
  className?: string;
}

export function AmlLivePositionRail({
  position,
  stage,
  nextAction,
  attention,
  riskLabel,
  showAttention = true,
  showNextAction = true,
  onOpenSection,
  className,
  currentSection,
  deferReadinessToSurfaceBelow = false,
}: AmlLivePositionRailProps) {
  /* The rail names what is next; it does not offer to navigate to here. */
  const alreadyOnSection = currentSection !== undefined
    && currentSection === nextAction.section;
  const done = stage.completedItems.length;
  const total = done + stage.outstandingItems.length;
  const ranked = attention.slice(0, 6);

  return (
    <div className={cn("space-y-3", className)}>
      {/* ── 1 · Live position ──────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <RailHeading>Live position</RailHeading>
          <dl className="mt-2">
            {/*
              Two rows, two different questions, and neither is called simply
              "stage". The first is where the RECORD has got to; the second is
              its lifecycle. Reported together they read as a contradiction —
              "10 of 10" beside "Closed" beside an open Stage 5 — unless each
              says which question it answers, so each does.
            */}
            <PositionRow
              label="Journey position"
              value={`${position.stageNumber} of ${position.stageTotal} · ${position.stageLabel}`}
            />
            <PositionRow label="Case lifecycle" value={position.caseStageLabel} />
            <PositionRow label="Client" value={position.clientStatusLabel} />
            <PositionRow label="Finance portal" value={position.financeStatusLabel} />
            <PositionRow label="Service gate" value={position.serviceGateLabel} />
            <PositionRow
              label="Passport"
              value={
                position.passportLabel
                  ? `${position.passportLabel}${position.passportVersion ? ` · v${position.passportVersion}` : ""}`
                  : "Not available"
              }
            />
            {riskLabel && <PositionRow label="Risk" value={riskLabel} />}
          </dl>
        </CardContent>
      </Card>

      {/* ── 2 · Stage readiness ────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <RailHeading>Stage readiness</RailHeading>
          <p className="mt-2 text-sm font-medium leading-snug">{stage.label}</p>
          {deferReadinessToSurfaceBelow ? (
            /* The path below counts this stage, in its own units. One count
               per screen; the reading that governs is the one beside the
               work. */
            <p className="mt-0.5 text-xs text-muted-foreground">
              Progress is tracked on the steps below.
            </p>
          ) : total > 0 ? (
            <>
              <p className="mt-0.5 text-xs text-muted-foreground" aria-live="polite">
                {done} of {total} item{total === 1 ? "" : "s"} complete
              </p>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${done} of ${total} items complete on this stage`}
              >
                {/* The meter is toned by the stage's attention, not by how
                    full it is: a stage whose measured items are all done can
                    still be the one holding the case up, and a full green bar
                    beside "Attention required" would be the wrong headline. */}
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    stage.status === "complete"
                      ? "bg-success"
                      : stage.attention === "critical"
                        ? "bg-destructive"
                        : stage.attention === "attention"
                          ? "bg-warning"
                          : "bg-primary",
                  )}
                  style={{ width: `${Math.round((done / total) * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Nothing measurable on this stage yet.
            </p>
          )}
          <p className="mt-2.5 flex gap-1.5 border-t border-border/50 pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldQuestion aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              A complete stage is evidence, not a clearance. The designated service proceeds only on
              an explicit service-gate decision.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* ── 3 · Attention ──────────────────────────────────────────── */}
      {showAttention && (
      <Card>
        <CardContent className="p-4">
          <RailHeading>Attention</RailHeading>
          {ranked.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Nothing on this case is unresolved.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {ranked.map((item) => (
                <li key={item.key} className={cn("border-l-2 pl-2.5", ATTENTION_EDGE[item.attention])}>
                  <button
                    type="button"
                    onClick={() => onOpenSection(item.section)}
                    className="text-left text-xs leading-snug hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className={cn("font-medium", ATTENTION_TEXT[item.attention])}>
                      {item.label}
                    </span>
                    {item.blocking && (
                      <span className="ml-1 text-muted-foreground">· blocking</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {attention.length > ranked.length && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {attention.length - ranked.length} more not shown.
            </p>
          )}
        </CardContent>
      </Card>
      )}

      {/* ── 4 · Next action ────────────────────────────────────────── */}
      {showNextAction && (
      <Card className={nextAction.attention === "critical" ? "border-destructive/40" : undefined}>
        <CardContent className="p-4">
          <RailHeading>Next action</RailHeading>
          <div className="mt-2 flex gap-2">
            {(nextAction.attention === "critical" || nextAction.attention === "attention") && (
              <AlertTriangle
                aria-hidden
                className={cn("mt-0.5 h-4 w-4 shrink-0", ATTENTION_TEXT[nextAction.attention])}
              />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-snug">{nextAction.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {nextAction.explanation}
              </p>
            </div>
          </div>
          {/*
            Name the destination. "Go there" moved the MLRO without saying
            where — and because the winner is ranked by journey position it
            can legitimately be several stages away, which reads as the
            system skipping ahead rather than checking and finding nothing.
          */}
          {/*
            And say nothing when the operator is already there.
            "Go to stage 5" rendered beside stage 5's own open step is an
            instruction to stay put, and it was the third copy of one act on
            a single screen. The rail keeps naming what is next — that is its
            job — and stops offering to take you somewhere you are.
          */}
          {nextAction.key !== "none" && !alreadyOnSection && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full justify-between"
              onClick={() => onOpenSection(nextAction.section)}
            >
              Go to stage {nextAction.stageOrder}
              <ArrowRight aria-hidden className="h-3.5 w-3.5" />
            </Button>
          )}
          {nextAction.partial && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Partial reading — {nextAction.unavailableFacts.join(", ")} could not be read.
            </p>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
