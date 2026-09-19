/**
 * Stage 5 as one path: numbered steps, one of them open.
 *
 * ── What it replaces ──────────────────────────────────────────────────
 * The stage rendered every true thing it knew at once and gave all of it
 * equal weight — a next-action card, an alert saying the same thing, a
 * second next-action card saying it again, a classification prompt, a
 * scope, a determinations list, a not-required collapse, a perimeter
 * statement, an answers collapse, a people list, a party panel with two
 * more buttons for the same act, an empty checks panel and an ownership
 * panel. On the reported case all of it reduced to ONE thing to do.
 *
 * Nothing was wrong; nothing was ordered. This is the order. Every step is
 * one line until it is the one being worked, the state of each is stated in
 * words rather than by colour, and the work itself still happens in the
 * panels below — which is why this card performs no mutation of its own.
 *
 * ── What it will not do ───────────────────────────────────────────────
 * It never ticks a step nobody owes: `Not required` is an obligation and
 * `Done` is a result, and this renders them as different things because
 * collapsing them is how "not required" came to read as "clear". It never
 * shows a button the server would refuse — what replaces it says who may
 * act. And a closed case is presented as a retained record, not as a path
 * with a next step.
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle, ArrowRight, Check, ChevronDown, CircleDashed, Clock, Info,
  Loader2, ShieldAlert, ShieldQuestion,
} from "lucide-react";

import { PepIndexReadiness } from "@/components/aml/PepIndexReadiness";
import { ScreeningRadar, type ScreeningRadarParty } from "@/components/aml/ScreeningRadar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AmlScreeningNextAction } from "@/lib/aml/amlCasesApi";
import {
  canPerformScreeningAction, screeningActionDeniedHeadline,
  screeningActionDeniedNote, type ScreeningActor,
} from "@/lib/aml/screeningActionAccess";
import { PEP_RELATIONSHIP_LABEL } from "@/lib/aml/pepDeclaration";
import {
  isOutstanding, STEP_STATE_LABEL,
  type ScreeningPath, type ScreeningStep, type ScreeningStepKey, type ScreeningStepState,
} from "@/lib/aml/screeningSteps.pure";

const OWNER_LABEL: Record<string, string> = {
  system: "Handled automatically",
  analyst: "You",
  reviewer: "A reviewer or the MLRO",
  administrator: "An administrator",
  client: "The client",
  none: "Nobody — this step is settled",
};

/**
 * Tone by state. Status is always carried by the LABEL as well, so nothing
 * here is communicated by colour alone.
 */
const STATE_TONE: Record<ScreeningStepState, {
  chip: "default" | "secondary" | "destructive" | "outline";
  marker: string;
  Icon: typeof Info;
}> = {
  done: { chip: "outline", marker: "border-success/50 bg-success/10 text-success", Icon: Check },
  not_required: {
    chip: "secondary", marker: "border-border bg-muted text-muted-foreground", Icon: Info,
  },
  current: { chip: "outline", marker: "border-primary bg-primary text-primary-foreground", Icon: ArrowRight },
  review: { chip: "outline", marker: "border-primary/50 bg-primary/10 text-primary", Icon: ShieldQuestion },
  /*
   * Work, not an obstruction. Deliberately not the destructive chip: an
   * operator reading red goes looking for a fault, and on a step that is
   * simply their turn there is none to find.
   */
  outstanding: {
    chip: "outline", marker: "border-warning/50 bg-warning/10 text-warning", Icon: CircleDashed,
  },
  blocked: { chip: "destructive", marker: "border-warning/50 bg-warning/10 text-warning", Icon: AlertTriangle },
  waiting: { chip: "outline", marker: "border-border bg-muted text-muted-foreground", Icon: Clock },
  upcoming: { chip: "outline", marker: "border-border bg-background text-muted-foreground", Icon: CircleDashed },
  unknown: { chip: "outline", marker: "border-warning/50 bg-warning/10 text-warning", Icon: AlertTriangle },
};

function StepMarker({ step, isCurrent }: { step: ScreeningStep; isCurrent: boolean }) {
  const tone = STATE_TONE[isCurrent ? "current" : step.state];
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
        tone.marker,
        isCurrent && "ring-2 ring-primary/30",
      )}
    >
      {step.state === "done"
        ? <Check className="h-3.5 w-3.5" />
        : step.state === "not_required"
          ? "—"
          : step.number}
    </span>
  );
}

export function ScreeningPathCard({
  path, actor, onAct, onReviewPerimeter, onOpenDetail, onContinue, caseClosed,
  closedAction, radarParties = [], radarStartedAt = null,
}: {
  path: ScreeningPath;
  actor: ScreeningActor;
  /** Performs the server's action. This card mutates nothing itself. */
  onAct: (action: AmlScreeningNextAction) => void | Promise<void>;
  /** Opens the perimeter classification dialog. */
  onReviewPerimeter?: () => void;
  /** Reveals the full evidence panels for a step, below this card. */
  onOpenDetail?: (step: ScreeningStepKey) => void;
  /** Opens the next stage. A navigation only: it completes nothing. */
  onContinue?: () => void;
  caseClosed: boolean;
  /** The reopen action, when the case is closed. */
  closedAction?: AmlScreeningNextAction | null;
  /**
   * The enrolled population, for the live radar shown while a check runs.
   * Presentation only: an empty list renders an indeterminate sweep rather
   * than a percentage nobody measured.
   */
  radarParties?: ScreeningRadarParty[];
  /** When the running check was dispatched, if the case records it. */
  radarStartedAt?: string | null;
}) {
  const [open, setOpen] = useState<ScreeningStepKey | null>(path.currentKey);
  const [busy, setBusy] = useState(false);

  // Follow the case: when the server's ask moves, the open step moves with it.
  useEffect(() => { setOpen(path.currentKey); }, [path.currentKey]);

  const act = async (action: AmlScreeningNextAction) => {
    setBusy(true);
    try { await onAct(action); } finally { setBusy(false); }
  };

  const outstanding = path.steps.filter((s) => isOutstanding(s.state)).length;

  return (
    <Card>
      <CardContent className="p-0">
        {/* ── Where the case is on the path ───────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/60 p-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Screening &amp; ownership · the steps
            </p>
            <h3 className="mt-0.5 text-lg font-semibold">
              {caseClosed
                ? "This case is closed"
                : path.complete
                  ? "Every step on this stage is settled"
                  : path.currentKey
                    ? `Step ${path.steps.find((s) => s.key === path.currentKey)?.number} of ${path.total}`
                    : "Nothing is outstanding on this stage"}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {caseClosed
                ? "The steps below are a retained record of what was decided. The journey is not progressing."
                : outstanding === 0
                  ? "Each step below states what was owed and what was established."
                  : `${path.settled} of ${path.total} settled · ${outstanding} still to answer.`}
            </p>
          </div>
          {/* A progress bar that counts SETTLED steps, which includes the ones
              nobody owed. It is a reading position, never an assurance. */}
          <div className="w-full max-w-[220px]">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={path.total}
              aria-valuenow={path.settled}
              aria-label={`${path.settled} of ${path.total} steps settled`}
            >
              <div
                className={cn("h-full rounded-full transition-all",
                  outstanding === 0 ? "bg-success" : "bg-primary")}
                style={{ width: `${Math.round((path.settled / Math.max(path.total, 1)) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* ── The retained record ─────────────────────────────────────── */}
        {caseClosed && (
          <div className="border-b border-border/60 bg-muted/40 p-5">
            <p className="text-sm text-muted-foreground">
              This AML/CTF record is retained for compliance purposes and stays readable.
              Reopening restores the ability to <span className="font-medium">work</span>{" "}
              the case; it does not approve the service, revive a terminated service gate,
              or restore a revoked passport.
            </p>
            {closedAction?.label && canPerformScreeningAction(closedAction.key, actor) && (
              <Button
                size="sm" variant="outline" className="mt-3" disabled={busy}
                onClick={() => void act(closedAction)}
              >
                {busy && <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />}
                {closedAction.label}
              </Button>
            )}
          </div>
        )}

        {/* ── The steps ───────────────────────────────────────────────── */}
        <ol className="divide-y divide-border/60">
          {path.steps.map((step) => {
            const isCurrent = step.key === path.currentKey && !caseClosed;
            const isOpen = open === step.key;
            const tone = STATE_TONE[step.state];
            const action = caseClosed ? null : step.action;
            const canAct = action ? canPerformScreeningAction(action.key, actor) : false;
            const deniedNote = action ? screeningActionDeniedNote(action.key) : null;
            const alternative = action?.alternative ?? null;
            const canActAlternative = alternative
              ? canPerformScreeningAction(alternative.key, actor) : false;
            const canClassify = actor.isReviewer || actor.isMlro;

            return (
              <li key={step.key} className={cn(isCurrent && "bg-primary/[0.04]")}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : step.key)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start gap-3 p-5 text-left transition-colors hover:bg-muted/40"
                >
                  <StepMarker step={step} isCurrent={isCurrent} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn("text-sm font-medium",
                        step.state === "upcoming" && "text-muted-foreground")}>
                        {step.title}
                      </span>
                      {/*
                        The step the server is asking for reads "Do this now",
                        whatever its own arithmetic called it. A badge saying
                        BLOCKED directly above the button that unblocks it is
                        the same contradiction, one line further down.
                      */}
                      <Badge
                        variant={isCurrent ? "outline" : tone.chip}
                        className={cn("text-[10px]",
                          isCurrent && "border-primary/50 bg-primary/10 text-primary",
                          !isCurrent && step.state === "done"
                            && "border-success/40 bg-success/10 text-success")}
                      >
                        {isCurrent ? STEP_STATE_LABEL.current : STEP_STATE_LABEL[step.state]}
                      </Badge>
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {step.summary}
                    </span>
                  </span>
                  <ChevronDown
                    aria-hidden
                    className={cn("mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      isOpen && "rotate-180")}
                  />
                </button>

                {isOpen && (
                  <div className="space-y-3 px-5 pb-5 pl-[4.25rem]">
                    <p className="text-xs text-muted-foreground">{step.purpose}</p>

                    {/*
                      ── What is in the way, when something is ──────────
                      A step may only be `blocked` if it can name its
                      blocker, so this renders whenever one exists. A red
                      badge with no obstacle named is an instruction to go
                      and look for one, which is what this step used to be.
                    */}
                    {step.blockedBy && (
                      <p className="flex items-start gap-1.5 rounded-md border border-warning/40
                        bg-warning/5 p-2.5 text-xs text-warning">
                        <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{step.blockedBy}</span>
                      </p>
                    )}

                    {step.detail.length > 0 && (
                      <ul className="space-y-1">
                        {step.detail.map((d, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <tone.Icon aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{d}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/*
                      ── What the CUSTOMER said ───────────────────────
                      In its own block, labelled as a declaration, beside the
                      determination rather than inside it. The reviewer used
                      to have this nowhere on the stage: it existed only as
                      the string "no" in the policy's material inputs, one
                      collapse down, so the person making the determination
                      could not see what the person it is about had said.

                      It never renders as a conclusion, and an unanswered
                      question renders as unanswered — a customer who was
                      never asked is not a customer who said no.
                    */}
                    {step.declaration && (
                      <div className="rounded-md border border-border/60 bg-muted/30 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                          What the customer declared
                        </p>
                        <p className="mt-1 text-xs">{step.declaration.summary}</p>
                        {step.declaration.answer === "yes" && (
                          <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                            <div>
                              <dt className="text-muted-foreground">Who holds it</dt>
                              <dd className="font-medium">
                                {step.declaration.relationship
                                  ? PEP_RELATIONSHIP_LABEL[step.declaration.relationship]
                                  : "Not given"}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Position</dt>
                              <dd className="font-medium">{step.declaration.role ?? "Not given"}</dd>
                            </div>
                            <div>
                              <dt className="text-muted-foreground">Jurisdiction</dt>
                              <dd className="font-medium">{step.declaration.country ?? "Not given"}</dd>
                            </div>
                          </dl>
                        )}
                        {step.declaration.answered && !step.declaration.complete && (
                          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                            <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                            The declaration is incomplete. Ask the customer for what is
                            missing before determining.
                          </p>
                        )}
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          This is the customer&rsquo;s own declaration. It is evidence that
                          supports a determination; it is never the determination, and it is
                          never an exemption from making one.
                        </p>
                      </div>
                    )}

                    {/*
                      The three answers kept apart, where the step has a
                      determination behind it. Obligation, method and outcome
                      are different questions and one badge cannot carry them.

                      Folded, because the open step's job is the ACT: an
                      operator who is about to record a determination does not
                      need three paragraphs of policy above the button, and
                      one that is 300px tall pushes the next step off the
                      screen. The reasoning is one click away, and again in
                      full in the evidence panels below.
                    */}
                    {step.row && (
                      <details className="rounded-md border border-border/60 p-3">
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                          What is owed, how it is carried out, and where it stands
                        </summary>
                      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                        <div>
                          <dt className="font-medium text-foreground/80">Obligation</dt>
                          <dd className="text-muted-foreground">{step.row.obligationDetail}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-foreground/80">Method</dt>
                          <dd className="text-muted-foreground">{step.row.methodDetail}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-foreground/80">Outcome</dt>
                          <dd className="text-muted-foreground">{step.row.outcomeDetail}</dd>
                        </div>
                      </dl>
                      </details>
                    )}

                    {/*
                      ── The wait, made legible ───────────────────────
                      A running check reads as a hang when the only thing on
                      screen is "a check is in progress". The radar carries
                      the same server-read facts as motion plus a measured
                      reading; it screens nothing and decides nothing.
                    */}
                    {!caseClosed && step.key === "sanctions" && step.state === "waiting"
                      && step.row?.outcome === "running" && (
                      <ScreeningRadar parties={radarParties} startedAt={radarStartedAt} />
                    )}

                    {/* ── The act ─────────────────────────────────────── */}
                    {action && (
                      <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                        <p className="text-sm font-medium">
                          {(!canAct && screeningActionDeniedHeadline(action.key)) || action.headline}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{action.detail}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          {action.label && canAct && (
                            <Button size="sm" disabled={busy} onClick={() => void act(action)}>
                              {busy && <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />}
                              {action.label}
                              {!busy && <ArrowRight aria-hidden className="ml-1.5 h-4 w-4" />}
                            </Button>
                          )}
                          {!canAct && deniedNote && (
                            <span className="text-xs font-medium text-muted-foreground">
                              {deniedNote}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {OWNER_LABEL[action.owner] ?? action.owner}
                            {action.owner === "client" && " — no staff action is required"}
                          </span>
                        </div>

                        {/*
                          The OTHER lawful route to the same blockage, decided
                          server-side. One blockage can have two answers — the
                          administrator repairs the provider, the MLRO screens
                          by hand — and offering both is what stops either role
                          holding a status with no step.
                        */}
                        {alternative && (
                          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/50 pt-3">
                            <div className="min-w-0">
                              <p className="text-xs font-medium">{alternative.headline}</p>
                              <p className="text-xs text-muted-foreground">{alternative.detail}</p>
                            </div>
                            {canActAlternative ? (
                              <Button
                                size="sm" variant="outline" disabled={busy}
                                onClick={() => void act(alternative as AmlScreeningNextAction)}
                              >
                                {alternative.label}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {OWNER_LABEL[alternative.owner] ?? alternative.owner} handles this.
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/*
                      A confirmation is not the server's action and never
                      pretends to be one: the recorded classification stands
                      until a reviewer records another.
                    */}
                    {step.key === "perimeter" && !caseClosed && canClassify && onReviewPerimeter && (
                      <Button size="sm" variant="outline" onClick={onReviewPerimeter}>
                        <ShieldQuestion aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                        {step.state === "review"
                          ? "Confirm or change the classification"
                          : "Review classification"}
                      </Button>
                    )}
                    {step.key === "perimeter" && !canClassify && (
                      <p className="text-xs text-muted-foreground">
                        A reviewer or the MLRO records this classification.
                      </p>
                    )}

                    {/*
                      ── The tool, named where the work is ────────────────
                      The office-holder index was reachable only from inside
                      the determination dialog, so an operator could not tell
                      it existed — let alone whether it had loaded — until
                      after they had opened the dialog and searched. A whole
                      working integration was invisible from the step it
                      serves.

                      It describes the TOOL and never the subject: how much
                      is loaded and how current it is. An index in perfect
                      health is not evidence about anybody, and one that has
                      not loaded does not hide the step.
                    */}
                    {step.key === "pep" && step.state !== "not_required" && !caseClosed && (
                      <PepIndexReadiness />
                    )}

                    {/*
                      A statement of obligation, said once more where it is
                      most likely to be misread. A step nobody owed is not a
                      customer who was checked and cleared.
                    */}
                    {step.state === "not_required" && (
                      <p className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
                        No obligation arose for this step, so nobody was screened and nobody
                        was cleared. This is a policy decision, not a result.
                      </p>
                    )}

                    {onOpenDetail && (
                      <Button
                        size="sm" variant="ghost" className="h-8 px-2 text-xs"
                        onClick={() => onOpenDetail(step.key)}
                      >
                        Open the full detail for this step
                        <ArrowRight aria-hidden className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/*
          ── The way on ────────────────────────────────────────────────
          Offered only when the SERVER says there is no action left. It is
          deliberately not called approve, clear or compliant: finishing
          Stage 5 completes the evidence, and the designated service still
          proceeds only through the separate service-gate decision.
        */}
        {path.complete && onContinue && (
          <div className="space-y-2 border-t border-border/60 p-5">
            <Button size="sm" onClick={onContinue}>
              Continue to Funding
              <ArrowRight aria-hidden className="ml-1.5 h-4 w-4" />
            </Button>
            <p className="text-xs text-muted-foreground">
              Completing this stage is evidence completion only. The designated service
              proceeds through the separate service-gate decision, which this does not
              make, imply or bring forward.
            </p>
          </div>
        )}

        {/*
          A finding outranks everything, including the tidy path above.

          `path.finding` is a CONFIRMED match and nothing else. This read
          "the resolve step is blocked", which is also true of a candidate
          awaiting adjudication — announcing a finding over a name somebody
          has not looked at yet is the same collapse of vocabulary the rest
          of this stage exists to prevent.
        */}
        {path.finding && (
          <p className="flex items-start gap-2 border-t border-destructive/30 p-5 text-sm text-destructive">
            <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            A screening finding is recorded on this case. It is a fact about a customer and
            it outranks the rest of this stage.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
