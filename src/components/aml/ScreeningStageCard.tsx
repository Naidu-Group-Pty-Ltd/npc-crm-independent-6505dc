/**
 * Stage 5's one card: what happens next, and why.
 *
 * ── What it replaces ──────────────────────────────────────────────────
 * Three panels that each said a different kind of nothing. "No screening
 * subjects recorded." "Screening has not been run." "No screening checks yet
 * for this case", over a **Run screening** button that had nobody to run
 * against. Beside them, a panel telling the operator to go resolve declared
 * parties — on a case that declared none. The reasonable conclusion from
 * that screen was "this client must not need screening", and it was wrong:
 * nobody had ever been enrolled.
 *
 * So this card leads with exactly ONE action, chosen server-side by what
 * actually blocks the stage, with the button that performs it. Everything
 * else — scope, parties, determinations — is evidence underneath it.
 *
 * ── What it will not do ───────────────────────────────────────────────
 * It never says PEP or sanctions are waived, exempt or not required: those
 * are mandatory determinations that get established. It never renders
 * "clear" or "no match" — it states no outcome it was not given. And
 * completing the stage is not a service-gate approval, which it says on the
 * page rather than leaving to be assumed.
 *
 * ── The resolution centre ─────────────────────────────────────────────
 * It now arranges the stage in four layers, because one action was necessary
 * and not sufficient: an operator also has to see WHICH determinations are
 * owed and where each has got to.
 *
 *   A  the lifecycle, one status, one action (and the other lawful route)
 *   B  required determinations, one row each
 *   C  checks that are not required, collapsed
 *   D  parties, and the evidence panels below this card
 *
 * Each row states OBLIGATION, METHOD and OUTCOME separately
 * (`screeningResolution.pure.ts`), because collapsing them into one badge is
 * exactly how "not required" came to read as "clear" and how an unavailable
 * provider came to read as a case that needed nothing.
 *
 * ── A closed case is not a stage in progress ──────────────────────────
 * When the canonical lifecycle says closed, this leads with that and offers a
 * reopen. Showing "Run screening" on a retained record asserts the journey is
 * moving when it is not.
 */
import { useState } from "react";
import {
  AlertTriangle, Archive, ArrowRight, CheckCircle2, Clock, Info, Loader2, ShieldAlert,
  ShieldCheck, ShieldQuestion, Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AmlScreeningNextAction } from "@/lib/aml/amlCasesApi";
import {
  canPerformScreeningAction, screeningActionDeniedHeadline,
  screeningActionDeniedNote, type ScreeningActor,
} from "@/lib/aml/screeningActionAccess";
import type { AmlScreeningStageReading } from "@/lib/aml/useScreeningStage";
import { deriveScreeningStatus } from "@/lib/aml/screeningStatus.pure";
import {
  buildDeterminationRows, deriveStageHeadline, METHOD_LABEL, OBLIGATION_LABEL,
  OUTCOME_LABEL, SANCTIONS_SOURCE_LABEL, STAGE_HEADLINE_LABEL,
  type DeterminationRow,
} from "@/lib/aml/screeningResolution.pure";

const OWNER_LABEL: Record<string, string> = {
  system: "Handled automatically",
  analyst: "You",
  reviewer: "A reviewer or the MLRO",
  administrator: "An administrator",
  client: "The client",
  none: "Nobody — this stage is settled",
};

/** Tone follows urgency, not sentiment: nothing here is decorative. */
const TONE: Record<string, { surface: string; text: string; Icon: typeof Info }> = {
  // A retained record: neither a fault nor a task, so neither red nor green.
  reopen_case: { surface: "border-border bg-muted/40", text: "text-muted-foreground", Icon: Archive },
  complete_manually: { surface: "border-primary/40 bg-primary/5", text: "text-primary", Icon: ShieldCheck },
  escalate: { surface: "border-destructive/40 bg-destructive/10", text: "text-destructive", Icon: ShieldAlert },
  adjudicate_match: { surface: "border-destructive/40 bg-destructive/10", text: "text-destructive", Icon: ShieldAlert },
  // A decision to make, not a fault. Toned as a prompt rather than a warning.
  classify_perimeter: { surface: "border-primary/40 bg-primary/5", text: "text-primary", Icon: ShieldQuestion },
  fix_provider: { surface: "border-warning/40 bg-warning/10", text: "text-warning", Icon: AlertTriangle },
  screening_stalled: { surface: "border-warning/40 bg-warning/10", text: "text-warning", Icon: AlertTriangle },
  await_submission: { surface: "border-border bg-muted/40", text: "text-muted-foreground", Icon: Clock },
  await_provider_result: { surface: "border-border bg-muted/40", text: "text-muted-foreground", Icon: Loader2 },
  enrol_subjects: { surface: "border-border bg-muted/40", text: "text-muted-foreground", Icon: Users },
  none: { surface: "border-success/40 bg-success/10", text: "text-success", Icon: CheckCircle2 },
};
const DEFAULT_TONE = { surface: "border-primary/40 bg-primary/5", text: "text-primary", Icon: ArrowRight };

/** Compact names for the per-person badges. */
const SCOPE_SHORT: Record<string, string> = {
  sanctions: "sanctions", pep: "PEP",
  adverse_media: "adverse media", watchlist: "watchlist",
};

/** The five statuses, toned by whether they hold the journey. */
const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  completed: "secondary",
  not_required: "secondary",
  in_progress: "outline",
  required: "outline",
  manual_review: "destructive",
};

/**
 * One determination, with its three answers kept apart.
 *
 * The obligation badge and the outcome badge are never the same control and
 * never share a vocabulary: `Not required` is a statement about what is owed,
 * `No match` is a statement about what was found, and a reader must not be
 * able to mistake one for the other. Status is carried by the label as well
 * as the tone, so nothing here is communicated by colour alone.
 */
function DeterminationRowView({ row }: { row: DeterminationRow }) {
  return (
    <li className="rounded-md border border-border/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <span className="flex min-w-0 items-start gap-2">
          {row.blocking ? (
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          ) : row.obligation === "required" ? (
            <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{row.title}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant={row.obligation === "required" ? "outline" : "secondary"} className="text-[10px]">
            {OBLIGATION_LABEL[row.obligation]}
          </Badge>
          <Badge variant="outline" className="text-[10px]">{METHOD_LABEL[row.method]}</Badge>
          <Badge
            variant={row.outcome === "confirmed_match" || row.outcome === "possible_match"
              ? "destructive"
              : row.outcome === "no_match" || row.outcome === "not_a_pep" ? "default" : "outline"}
            className="text-[10px]"
          >
            {OUTCOME_LABEL[row.outcome]}
          </Badge>
        </span>
      </div>
      <dl className="mt-1.5 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
        <div><dt className="font-medium text-foreground/80">Obligation</dt><dd>{row.obligationDetail}</dd></div>
        <div><dt className="font-medium text-foreground/80">Method</dt><dd>{row.methodDetail}</dd></div>
        <div><dt className="font-medium text-foreground/80">Outcome</dt><dd>{row.outcomeDetail}</dd></div>
      </dl>
    </li>
  );
}

export function ScreeningStageCard({
  reading, onAct, actor, onContinue, onReviewPerimeter, onOpenListHealth,
  variant = "full",
}: {
  reading: AmlScreeningStageReading;
  /**
   * Open the next stage. Optional, and a NAVIGATION only: it completes
   * nothing, advances no case stage and confers no authorisation — which the
   * control says on itself, because "Continue to Funding" beside a green
   * stage is exactly where somebody would otherwise read a sign-off.
   */
  onContinue?: () => void;
  /** Open the perimeter classification dialog. */
  onReviewPerimeter?: () => void;
  /** Open the sanctions list health surface. */
  onOpenListHealth?: () => void;
  /** Performs the one action. The card never mutates anything itself. */
  onAct: (action: AmlScreeningNextAction) => void | Promise<void>;
  /**
   * The caller's roles, not a single boolean.
   *
   * `canAct` was one flag and the workspace passed `canWrite` — analyst,
   * reviewer or MLRO — which is right for most actions and wrong for the two
   * that are compliance determinations. An analyst was shown a prominent
   * button for work the server refuses.
   */
  actor: ScreeningActor;
  /**
   * How much of the stage this card is responsible for.
   *
   * `full` is the original card and the default: the action, the
   * classification prompt and the evidence beneath them.
   *
   * `evidence` renders the evidence ONLY. Stage 5 now leads with the
   * numbered path (`ScreeningPathCard`), which owns the action and the
   * classification prompt — and an operator being told the same thing twice,
   * in two different arrangements, is the defect that arrangement removes.
   * Nothing is dropped: every panel below the action still renders, and the
   * card keeps its own reading of loading and unavailable.
   */
  variant?: "full" | "evidence";
}) {
  const { sync, readiness, scope, position, source, loading, unavailable } = reading;
  const evidenceOnly = variant === "evidence";
  const [busy, setBusy] = useState(false);

  if (loading && !sync) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          Reading this case&rsquo;s screening position…
        </CardContent>
      </Card>
    );
  }

  // An unread position is not a settled one. It says so, and offers a retry
  // rather than an action built on a hole.
  if (unavailable || !sync) {
    return (
      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="space-y-2 p-5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle aria-hidden className="h-4 w-4 text-warning" />
            This case&rsquo;s screening position could not be read
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing about the stage can be reported from a failed read — it is not
            evidence that screening is complete, and it is not evidence that it is
            outstanding.
          </p>
          <Button size="sm" variant="outline" onClick={reading.reload}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  const action = sync.next_action;
  const caseClosed = sync.case_closed === true;
  const status = deriveScreeningStatus(sync.subjects);
  const headline = deriveStageHeadline({ caseClosed, action });
  const rows = buildDeterminationRows({
    sync, position,
    providerReady: sync.provider_ready === true,
    providerRelevant: sync.provider_relevant !== false,
  });
  const requiredRows = rows.filter((r) => r.obligation === "required");
  /*
   * Per-check obligations, read from the server's own scope decision. The
   * party badges below render one status per CHECK; nothing here decides
   * whether a check is owed.
   */
  const scopeRequired = (k: string) =>
    (sync.scopes ?? []).find((x) => x.scope === k)?.required === true;
  const sanctionsRequired = scopeRequired("sanctions");
  const pepRequired = scopeRequired("pep");
  const riskScopeRequired = ["adverse_media", "watchlist"].filter(scopeRequired);
  const canClassify = actor.isReviewer || actor.isMlro;
  /*
   * A case that was stood down as an enquiry and is being worked again.
   * `case_closed` is false here — the lifecycle says active — while the
   * recorded perimeter still says the relationship never began. That is a
   * question to put to a reviewer, not a contradiction to resolve silently.
   */
  const perimeterNeedsReview = !caseClosed
    && sync.perimeter?.classification === "outside_perimeter"
    && sync.perimeter?.reason_code === "enquiry_only";
  const otherRows = rows.filter((r) => r.obligation !== "required");
  /*
   * The OTHER lawful route, when the server named one. Which of the two is
   * primary depends on who is looking — the MLRO screens by hand, the
   * administrator repairs the provider — and both are offered so neither role
   * is left holding a status with no step.
   */
  const alternative = action.alternative ?? null;
  const canActAlternative = alternative
    ? canPerformScreeningAction(alternative.key, actor) : false;
  // Per action, not per session: classifying the perimeter and adjudicating a
  // match are reviewer/MLRO on the server, everything else follows canWrite.
  const canAct = canPerformScreeningAction(action.key, actor);
  const deniedNote = screeningActionDeniedNote(action.key);
  const tone = TONE[action.key] ?? DEFAULT_TONE;
  const { Icon } = tone;
  const stoodDown = sync.policy.notRequired ?? [];
  const answers = Object.entries(sync.policy.evidence ?? {});

  const act = async () => {
    setBusy(true);
    try { await onAct(action); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* ── The one action ──────────────────────────────────────────── */}
      {!evidenceOnly && (
      <Card className={cn("border", tone.surface)}>
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Icon aria-hidden className={cn("h-4 w-4", tone.text,
              action.key === "await_provider_result" && "animate-spin motion-reduce:animate-none")} />
            <p className={cn("text-[11px] font-semibold uppercase tracking-[0.08em]", tone.text)}>
              {action.key === "none" ? "Stage complete" : "Next action"}
            </p>
          </div>
          {/*
            The status vocabulary the compliance team actually uses, stated
            explicitly. Three surfaces used to describe this stage and none
            agreed — an MLRO reading three answers to one question cannot tell
            whether screening happened. It is derived once, in
            `screeningStatus.pure.ts`, and rendered identically everywhere.
          */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {/*
              ONE dominant reading, lifecycle first. `deriveScreeningStatus`
              answers "where has screening got to", which is a different
              question from "is this case being worked" — and on a closed case
              only the second one matters to somebody deciding what to do.
            */}
            <Badge
              variant={headline === "case_closed" ? "secondary"
                : headline === "escalated" || headline === "manual_review" ? "destructive"
                  : headline === "complete" ? "default" : "outline"}
              className="text-[11px]"
            >
              {STAGE_HEADLINE_LABEL[headline]}
            </Badge>
            {!caseClosed && (
              <Badge
                variant={STATUS_TONE[status.status] ?? "outline"}
                className="text-[11px]"
              >
                screening · {status.label}
              </Badge>
            )}
          </div>
          <h3 className="mt-1.5 text-lg font-semibold">
            {(!canAct && screeningActionDeniedHeadline(action.key)) || action.headline}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{action.detail}</p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {/*
              No button at all when the caller cannot perform it — a CTA that
              the server will refuse reads as the step that unblocks the case.
              What replaces it says who CAN, so the stage still names the way
              forward instead of going quiet.
            */}
            {!canAct && deniedNote && (
              <span className="text-xs font-medium text-muted-foreground">{deniedNote}</span>
            )}
            {action.label && canAct && (
              <Button size="sm" onClick={() => void act()} disabled={busy}>
                {busy && <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />}
                {action.label}
                {!busy && <ArrowRight aria-hidden className="ml-1.5 h-4 w-4" />}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {OWNER_LABEL[action.owner] ?? action.owner}
              {action.owner === "client" && " — no staff action is required"}
            </span>
          </div>

          {/*
            ── The way on ─────────────────────────────────────────────
            Only when every required determination is genuinely recorded. It
            is deliberately not called "approve", "clear" or "compliant":
            finishing Stage 5 completes the EVIDENCE, and the designated
            service still proceeds only through the separate service-gate
            decision. Saying so here is cheaper than un-saying it later.
          */}
          {action.key === "none" && !caseClosed && onContinue && (
            <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
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
            ── The retained record ────────────────────────────────────
            Said in full rather than implied by a greyed-out button. A closed
            AML/CTF record is kept, stays readable, and — where the compliance
            architecture allows it — still accepts evidence. What it does not
            do is progress.
          */}
          {caseClosed && (
            <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3 text-xs text-muted-foreground">
              <p>
                This AML/CTF record is retained for compliance purposes. Its evidence
                remains viewable and, where the existing compliance architecture permits,
                further evidence may still be recorded against it.
              </p>
              <p>
                The active AML/CTF journey is not currently progressing. If the customer
                relationship is now proceeding, reopen the case before continuing.
              </p>
              <p>
                Reopening restores the ability to <span className="font-medium">work</span>{" "}
                the case. It does not approve the service, revive a terminated service
                gate, or restore a revoked passport.
              </p>
            </div>
          )}

          {/*
            ── The other lawful route ─────────────────────────────────
            An unavailable provider used to be the end of the screen for an
            MLRO who could lawfully complete the check by hand. Both routes
            are shown; the server decided both, and it independently enforces
            who may take either.
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
                  onClick={() => void onAct(alternative as AmlScreeningNextAction)}
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

          {/* The blockers behind a provider fault: an operator cannot act on
              one boolean. */}
          {(action.key === "fix_provider" || alternative?.key === "fix_provider")
            && readiness.blockers.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-border/50 pt-3">
              {readiness.blockers.map((b) => (
                <li key={b} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          {scope.escalation && action.key !== "escalate" && (
            <p className="mt-3 flex items-start gap-2 border-t border-destructive/30 pt-3 text-sm text-destructive">
              <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              {scope.escalation}
            </p>
          )}
        </CardContent>
      </Card>
      )}

      {/*
        ── A reopened enquiry needs its classification re-examined ─────
        The classification is NOT changed here and nothing is inferred from
        the reopen: a perimeter finding is a compliance determination and it
        stays exactly as recorded until a reviewer records another one. What
        changes is that the question is ASKED, at the top, instead of leaving
        an operator to find "Reclassify perimeter" at the foot of the page
        and know to look for it.
      */}
      {perimeterNeedsReview && !evidenceOnly && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="space-y-2 p-5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldQuestion aria-hidden className="h-4 w-4 text-primary" />
              Case classification requires review
            </p>
            <p className="text-sm text-muted-foreground">
              This case was previously classified as{" "}
              <span className="font-medium text-foreground">an enquiry only</span>, which is
              why no sanctions screening is required. It has since been reopened and is
              being worked again. Confirm whether the relationship is now progressing to a
              designated service before continuing.
            </p>
            {canClassify && onReviewPerimeter && (
              <Button size="sm" variant="outline" onClick={onReviewPerimeter}>
                Review case classification
              </Button>
            )}
            {!canClassify && (
              <p className="text-xs text-muted-foreground">
                A reviewer or the MLRO records this classification.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/*
        ── The Australian sanctions source ────────────────────────────
        Shown only where a sanctions obligation actually exists. An operator
        signing off a determination has to be able to see WHICH source the
        system screens against and whether it is usable; an administrator has
        to be able to see that it is the thing to fix. Every value is live —
        an unread source reports as unread rather than as ready.
      */}
      {sanctionsRequired && (
        <Card>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Australian sanctions source
                </p>
                <p className="mt-0.5 text-sm font-medium">{SANCTIONS_SOURCE_LABEL}</p>
              </div>
              <Badge
                variant={source.state === "current" ? "default"
                  : source.state === "unknown" ? "outline" : "destructive"}
                className="text-[10px]"
              >
                {source.label}
              </Badge>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{source.detail}</p>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Entries loaded</dt>
                <dd className="font-medium">
                  {source.entryCount === null
                    ? "Not established"
                    : source.entryCount.toLocaleString('en-AU')}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last loaded</dt>
                <dd className="font-medium">
                  {source.lastLoadedAt
                    ? new Date(source.lastLoadedAt).toLocaleDateString('en-AU')
                    : "Never"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Automated screening</dt>
                <dd className="font-medium">
                  {source.automatedReady ? "Ready" : "Not available"}
                </dd>
              </div>
            </dl>
            {onOpenListHealth && (
              <Button
                size="sm" variant="outline" className="mt-3"
                onClick={onOpenListHealth}
              >
                View list health
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── The scope, and the answers that produced it ──────────────── */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Screening scope
              </p>
              <p className="mt-0.5 text-sm font-medium">{sync.policy.summary}</p>
            </div>
            <Badge variant="outline" className="text-[10px]">
              policy {sync.policy.policyVersion}
            </Badge>
          </div>

          {/*
            Rendered from the SERVER's per-scope decision, not from a
            derivation here. Three states, and the difference between the
            last two is the whole point of this screen:

              required      an obligation exists
              not required  no obligation arose — nobody was screened
              (never)       screened and clear, which is a RESULT and lives
                            with the subject below, not in this list
          */}
          {/*
            ── LAYER B — required determinations ────────────────────────
            One row per determination, each stating three DIFFERENT things:
            what is owed, how it would be carried out, and what has actually
            been established. They were previously one label, which is how a
            case could read "screening not required" and "screening has not
            been run" at once and leave an operator to reconcile them.
          */}
          {requiredRows.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Required determinations
              </p>
              <ul className="mt-2 space-y-2">
                {requiredRows.map((r) => <DeterminationRowView key={r.scope} row={r} />)}
              </ul>
            </div>
          )}

          {/*
            ── LAYER C — checks that are not required ───────────────────
            Collapsed on purpose. A scope nobody owes is not a task, and
            putting it beside the ones that are is most of why this screen
            took a minute to read. The reasoning stays one click away, because
            a reduced scope has to remain reviewable.
          */}
          {otherRows.length > 0 && (
            <details className="rounded-md border border-border/60 p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                {otherRows.length} check{otherRows.length === 1 ? "" : "s"} not required —
                why these are not required
              </summary>
              <ul className="mt-2 space-y-2">
                {otherRows.map((r) => <DeterminationRowView key={r.scope} row={r} />)}
              </ul>
            </details>
          )}

          {/*
            The perimeter finding that produced an exemption, named with the
            person who recorded it. An exemption nobody can attribute is not
            one anybody can defend.
          */}
          {sync.perimeter?.classification === "outside_perimeter" && (
            <p className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Outside the sanctions perimeter.</span>{" "}
              Recorded{sync.perimeter.recorded_by_label
                ? ` by ${sync.perimeter.recorded_by_label}` : ""}
              {sync.perimeter.recorded_at
                ? ` on ${new Date(sync.perimeter.recorded_at).toLocaleDateString('en-AU')}` : ""}
              {sync.perimeter.reason_code ? ` (${sync.perimeter.reason_code})` : ""}.
              This is a statement about obligation, not a screening result.
            </p>
          )}

          {/*
            The answers the decision rests on, on the page rather than in a
            log. This is the audit trail an operator can check without
            leaving the case — and the thing that makes a reduced scope
            reviewable rather than mysterious.
          */}
          {answers.length > 0 && (
            <details className="rounded-md border border-border/60 p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                The client&rsquo;s answers this decision was made on
              </summary>
              <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                {answers.map(([field, value]) => (
                  <div key={field} className="flex items-baseline justify-between gap-2 text-xs">
                    <dt className="text-muted-foreground">{field}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Recorded on the case audit trail under AML/CTF policy {sync.policy.policyVersion}.
                A declaration is evidence that supports a determination; it is never the
                determination and never an exemption from making one.
              </p>
            </details>
          )}
        </CardContent>
      </Card>

      {/* ── Who is in scope ─────────────────────────────────────────── */}
      {position.subjects.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              People to assess
            </p>
            {sync.enrolled > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {sync.enrolled} enrolled automatically from this case&rsquo;s own record.
              </p>
            )}
            <ul className="mt-2">
              {position.subjects.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 py-1.5 last:border-0"
                >
                  <span className="min-w-0 text-sm">
                    {s.name}
                    <span className="text-xs text-muted-foreground">
                      {" · "}{s.partyType.replace(/_/g, " ")}
                    </span>
                  </span>
                  {/*
                    ── One status PER CHECK, never one for the person ──────
                    This was a single `not in scope` badge whenever the
                    party's SANCTIONS obligation had been stood down. On the
                    reported case that put "not in scope" beside the primary
                    customer of an active AML file who still owed a PEP
                    determination — which reads as "this customer is outside
                    AML", the most alarming thing this panel could say and
                    the opposite of the truth.
                    A person is not in or out of scope. Each check is.
                  */}
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={!sanctionsRequired ? "secondary"
                        : s.sanctions.resolved ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      sanctions · {!sanctionsRequired
                        ? "not required"
                        : s.sanctions.state.replace(/_/g, " ")}
                    </Badge>
                    <Badge
                      variant={!pepRequired ? "secondary"
                        : s.pep.resolved ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      PEP · {!pepRequired
                        ? "not required"
                        : s.pep.resolved ? "determined" : "action required"}
                    </Badge>
                    {riskScopeRequired.map((sc) => (
                      <Badge key={sc} variant="outline" className="text-[10px]">
                        {SCOPE_SHORT[sc] ?? sc} · required
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
