/**
 * What obliges this report — beside the form, while it is being written.
 *
 * The draft dialog asked for a kind and a narrative and explained neither.
 * An operator drafting their first Suspicious Matter Report had to know,
 * from somewhere else entirely, what the trigger is, that it also covers an
 * attempted service, that the customer must not be told, and that a large
 * cash payment with nothing odd about it is a different report altogether.
 * None of that is obscure — it is simply not on the screen where the
 * decision is made.
 *
 * It renders `KIND_GUIDANCE` and `deriveAustracPath` and decides nothing of
 * its own: no field is written from here, no kind is chosen, no save is
 * blocked. The operator forms the suspicion and the MLRO approves the
 * report; a panel that quietly picked for them would be this product taking
 * a view it has no basis to take.
 */
import { AlertTriangle, ArrowRight, BookOpen, Check, CircleDot, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AUSTRAC_OBLIGATIONS, deriveAustracPath, type AustracReportKind,
} from "@/lib/aml/austracReportPath.pure";
import { KIND_GUIDANCE } from "@/lib/aml/austracDraftGuidance.pure";

/** The steps that are answered inside this dialog. */
const IN_DIALOG = new Set(["identify", "assemble"]);

export function AustracDraftGuidancePanel({
  kind, caseId, title, narrative, showPath = true,
}: {
  kind: AustracReportKind;
  caseId: string | null;
  title: string | null;
  narrative: string | null;
  /** False where the live path card is already on the page. */
  showPath?: boolean;
}) {
  const obligation = AUSTRAC_OBLIGATIONS[kind];
  const guidance = KIND_GUIDANCE[kind];
  const steps = deriveAustracPath({
    kind, status: "draft", caseId, subjectLabel: null, title, narrative,
    periodStart: null, periodEnd: null, mlroSignedAt: null, submittedAt: null,
    externalReference: null, receiptReference: null, obligationAt: null,
  });

  return (
    <aside
      aria-label="Why this report is being made"
      className="space-y-4 rounded-lg border border-border/70 bg-muted/30 p-4"
    >
      <header className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Why this report
        </p>
        <h3 className="text-sm font-semibold leading-snug text-foreground">{obligation.label}</h3>
        <p className="text-[11px] text-muted-foreground">{obligation.basis}</p>
      </header>

      <p className="text-xs leading-relaxed text-foreground/90">{guidance.why}</p>

      <section className="space-y-1.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          AUSTRAC must be informed when
        </h4>
        <ul className="space-y-1.5">
          {guidance.informWhen.map((line) => (
            <li key={line} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground/85">
              <ArrowRight aria-hidden className="mt-[3px] h-3 w-3 shrink-0 text-primary" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-1.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          What that looks like here
        </h4>
        <ul className="space-y-1 pl-1">
          {guidance.examples.map((line) => (
            <li key={line} className="text-[11px] leading-relaxed text-muted-foreground">• {line}</li>
          ))}
        </ul>
      </section>

      {guidance.notThis && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-2.5">
          <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-[11px] leading-relaxed text-foreground/85">
            <strong className="font-semibold">Not this report.</strong> {guidance.notThis}
          </p>
        </div>
      )}

      {/* ── Where drafting sits in the whole lodgement ──────────────────
          The six steps the report goes through, so an operator can see that
          saving a draft is the beginning of it and that lodgement is never
          done from this screen. Steps outside the dialog are drawn faintly
          rather than omitted: what happens next is exactly what nobody
          could see before.                                              */}
      {showPath && (
      <section className="space-y-1.5 border-t border-border/60 pt-3">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <BookOpen aria-hidden className="h-3 w-3" /> The whole path
        </h4>
        <ol className="space-y-1">
          {steps.map((s) => {
            const here = IN_DIALOG.has(s.key);
            return (
              <li
                key={s.key}
                className={cn(
                  "flex items-start gap-1.5 text-[11px] leading-relaxed",
                  here ? "text-foreground" : "text-muted-foreground/80",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
                    s.state === "done"
                      ? "bg-success/15 text-success"
                      : here
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {s.state === "done" ? <Check className="h-2.5 w-2.5" /> : s.n}
                </span>
                <span>
                  {s.label}
                  {here && (
                    <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-primary">
                      on this screen
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        <p className="flex items-start gap-1.5 pt-1 text-[10px] leading-relaxed text-muted-foreground">
          <CircleDot aria-hidden className="mt-[2px] h-2.5 w-2.5 shrink-0" />
          Saving a draft starts the record. Approval and lodgement happen afterwards, and lodgement
          itself is made in your organisation's own AUSTRAC Online account.
        </p>
      </section>
      )}
    </aside>
  );
}

/**
 * The tipping-off warning, in the main column rather than in the reference
 * panel beside it.
 *
 * It is a constraint on what the operator may do, not background reading:
 * disclosing a suspicious matter report is an offence under s.123. In the
 * panel it sat beside the form on a wide screen and BELOW the whole form on
 * a narrow one, which is the one place a prohibition must never be.
 */
export function AustracTippingOffNotice({ kind }: { kind: AustracReportKind }) {
  if (!KIND_GUIDANCE[kind].tippingOff) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <EyeOff aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <p className="text-xs leading-relaxed text-destructive">
        <strong className="font-semibold">Tipping off.</strong> Do not tell the customer, anyone
        connected to them, or any colleague outside the AML function that this report is being
        considered or made — and do not let the enquiries you make reveal it. Disclosing it is an
        offence under s.123 of the AML/CTF Act 2006 (Cth).
      </p>
    </div>
  );
}
