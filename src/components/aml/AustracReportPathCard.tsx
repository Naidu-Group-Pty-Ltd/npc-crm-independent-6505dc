/**
 * The AUSTRAC report, as a path rather than a form.
 *
 * The hub had a dialog with five boxes and a table of statuses. Everything a
 * lodgement actually needs — which customer it is about, when it is due, what
 * the MLRO has to see, who lodges it and where — was either absent or spread
 * across a status column. This is the same guided shape Stage 5 and Stage 9
 * use: numbered steps with exactly one open, and the checks underneath.
 *
 * It derives nothing of its own. Every step and every check comes from
 * `austracReportPath.pure.ts`, and every refusal that matters comes from the
 * server, which already demands MLRO approval, step-up MFA, lodgement
 * evidence, an AUSTRAC reference for an SMR, and an explicit no-tipping-off
 * attestation. What this adds is that an operator can see all of it before
 * they set off.
 */
import { AlertTriangle, Check, CircleDot, ExternalLink, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AUSTRAC_OBLIGATIONS, austracHeadline, austracReadiness, deriveAustracPath,
  lodgementClock, type AustracReportFacts, type CheckState,
} from "@/lib/aml/austracReportPath.pure";
import { displayDate, displayDateTime } from "@/lib/aml/displayDate";

const CHECK_TONE: Record<CheckState, string> = {
  done: "text-success",
  ready: "text-primary",
  attention: "text-warning",
  blocked: "text-destructive",
};

function CheckIcon({ state }: { state: CheckState }) {
  if (state === "done") return <Check aria-hidden className="h-3.5 w-3.5" />;
  if (state === "blocked") return <AlertTriangle aria-hidden className="h-3.5 w-3.5" />;
  return <CircleDot aria-hidden className="h-3.5 w-3.5" />;
}

/**
 * What a step's own button does, and what it is called.
 *
 * ── Why this replaced a callback ──────────────────────────────────────
 * The card took `onOpenStep(key)` and drew a button reading "Open" on
 * whichever step was open. The page handled three of the six keys, so on a
 * report sitting at "Clear the pre-lodgement checks" — which is where a
 * saved draft sits — the button rendered, was clicked, and did nothing at
 * all. A dead control is worse than no control: it reads as a broken page
 * rather than as a step nobody can take yet.
 *
 * The card now asks for the act rather than announcing a key. A step with
 * no entry here draws no button, which is the honest rendering of "there is
 * nothing this operator can do about this one" — the MLRO's sign-off, to an
 * analyst, is exactly that. And the label names the act, so an operator
 * knows what the click will do before they make it.
 */
export interface PathStepAction {
  label: string;
  run: () => void;
  busy?: boolean;
}

export function AustracReportPathCard({
  facts, stepActions, stepNotes,
}: {
  facts: AustracReportFacts;
  /** Keyed by step key. A step absent from this map draws no button. */
  stepActions?: Partial<Record<string, PathStepAction>>;
  /**
   * Who the open step belongs to, when it does not belong to this operator.
   *
   * A step with no button is the honest rendering of "there is nothing you
   * can do about this one" — but silence about WHY reads as a broken page.
   * This is rendered on the open step only, and only when no action is
   * offered for it, so nobody is ever left looking at a live step with
   * neither an act nor an explanation.
   */
  stepNotes?: Partial<Record<string, string>>;
}) {
  const steps = deriveAustracPath(facts);
  const checks = austracReadiness(facts);
  const clock = lodgementClock({
    kind: facts.kind,
    obligationAt: facts.obligationAt,
    terrorismFinancing: facts.terrorismFinancing,
  });
  const obligation = AUSTRAC_OBLIGATIONS[facts.kind];
  const done = steps.filter((s) => s.state === "done").length;

  return (
    <Card className="border-border/70">
      <CardContent className="space-y-4 p-4">
        {/*
          ── The checks lead ──────────────────────────────────────────
          They used to sit under the steps, which put the thing an approver
          has to READ below the thing they are asked to DO — and on a report
          whose path is long enough to scroll, below the fold. Step 3 is
          "review the checks and approve it", so the checks are the first
          thing on the card and the approval is reached past them.
        */}
        {/* ── The live checks ─────────────────────────────────────── */}
        <div className="rounded-lg border border-border/50 bg-muted/15 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Before it is lodged
          </p>
          <ul className="mt-2 space-y-2">
            {checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2.5">
                <span className={cn("mt-0.5 shrink-0", CHECK_TONE[c.state])}>
                  <CheckIcon state={c.state} />
                </span>
                <span className="min-w-0">
                  <span className={cn(
                    "block text-xs font-medium",
                    c.state === "done" ? "text-muted-foreground" : "text-foreground",
                  )}>
                    {c.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {c.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>


        {/* ── What this is, when it is due ─────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {obligation.label}
            </p>
            <p className="mt-1 text-sm font-medium">{austracHeadline(facts)}</p>
            <p className="mt-0.5 max-w-[62ch] text-xs text-muted-foreground">{obligation.purpose}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              {done} of {steps.length} done
            </p>
            {/* The clock, said plainly. A deadline nobody can see is a
                deadline nobody meets. */}
            {/* A multi-day window is a DATE; the 24-hour terrorism-financing
                window is the one where the hour matters, and it is the only
                one that shows a time. */}
            <p className={cn(
              "mt-0.5 text-xs font-medium tabular-nums",
              clock.overdue ? "text-destructive" : "text-foreground",
            )}>
              {clock.dueAt
                ? `${clock.overdue ? "Overdue — was due" : "Due"} ${
                    facts.terrorismFinancing && facts.kind === "smr"
                      ? displayDateTime(clock.dueAt)
                      : displayDate(clock.dueAt)
                  }`
                : clock.window}
            </p>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">{clock.basis}</p>
          </div>
        </div>

        {/* ── The steps ───────────────────────────────────────────── */}
        <ol className="space-y-1.5">
          {steps.map((s) => {
            const open = s.state === "open";
            return (
              <li
                key={s.key}
                className={cn(
                  "rounded-lg border px-3 py-2.5 transition-colors",
                  open
                    ? "border-primary/40 bg-primary/5"
                    : s.state === "done"
                      ? "border-border/50 bg-muted/20"
                      : "border-border/40",
                )}
              >
                <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                    s.state === "done"
                      ? "bg-success/15 text-success"
                      : open
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.state === "done" ? <Check className="h-3 w-3" /> : s.n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn(
                    "block text-[13px] font-medium",
                    open ? "text-primary" : s.state === "done" ? "text-muted-foreground" : "text-foreground",
                  )}>
                    {s.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{s.detail}</span>
                </span>
                {open && !stepActions?.[s.key] && stepNotes?.[s.key] && (
                  <span className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {stepNotes[s.key]}
                  </span>
                )}
                {open && stepActions?.[s.key] && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 text-xs"
                    disabled={stepActions[s.key]!.busy}
                    onClick={() => stepActions[s.key]!.run()}
                  >
                    {stepActions[s.key]!.label}
                  </Button>
                )}
                </div>

                {/*
                  ── Where the lodgement actually happens ────────────────
                  This was a locked panel at the foot of the card, three
                  blocks below the step it is about. It says the one thing
                  an operator most needs to know — the reporting entity
                  lodges through its OWN AUSTRAC Online account, with its own
                  credentials, and this product holds none and submits
                  nothing — and the door is right here, on the step that
                  needs it, rather than somewhere else on the page.
                */}
                {s.key === "lodge" && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2.5 rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 sm:ml-8">
                    <Lock aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
                      Lodgement happens in your organisation's own AUSTRAC Online account. This
                      platform holds no AUSTRAC credentials and submits nothing on your behalf — it
                      prepares the report, keeps the evidence behind it, records who approved it,
                      and holds the receipt on the customer's file.
                    </p>
                    <Button
                      asChild
                      size="sm"
                      variant={open ? "default" : "outline"}
                      className="h-7 shrink-0 text-xs"
                    >
                      <a href="https://online.austrac.gov.au/" target="_blank" rel="noreferrer noopener">
                        Open AUSTRAC Online <ExternalLink aria-hidden className="ml-1.5 h-3 w-3" />
                      </a>
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

      </CardContent>
    </Card>
  );
}
