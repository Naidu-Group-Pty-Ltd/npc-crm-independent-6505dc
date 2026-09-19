/**
 * The screening run, on screen.
 *
 * ── What it replaces ──────────────────────────────────────────────────
 * Five browser tabs. An operator determining political exposure opened the
 * Government Directory, Parliament, ABN Lookup and two search engines, typed
 * the name into each, and then wrote down what they remembered. One of those
 * links was broken and returned "Page not found"; two of them were a general
 * web search sitting beside DFAT as though it were a peer.
 *
 * Now the platform searches the registers it holds, and this renders the
 * result: what was searched, how current it was, what came back, and what
 * could not be reached.
 *
 * ── What it must never render ─────────────────────────────────────────
 * A clearance. The verdict vocabulary has no `clear` and no `not_pep` in it,
 * and `no_indicators` is drawn as a NEUTRAL statement about the search —
 * never a green tick, never a success tone. A search that returned nothing
 * has established that some registers hold nothing under that name.
 *
 * So every reading carries what the run did not reach, a run that searched
 * nothing says so, and the manual checks stay one click away underneath —
 * demoted, but never removed, because the registers a server cannot reach are
 * exactly the ones a person still has to open.
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowUpRight, Check, Info, Loader2, Search, ShieldQuestion, X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { amlCasesApi } from "@/lib/aml/amlCasesApi";
import type {
  PepIndicator, PepScreeningCandidate, PepScreeningRun, PepScreeningSourceResult,
} from "@/lib/aml/pepScreeningEngine";
import { recencyFromRunSource } from "@/lib/aml/pepManualChecks";
import type { RunSourceReading } from "@/lib/aml/pepRunCascade";
import { describeTenure } from "@/lib/aml/pepOfficeholderIndex";

type Run = PepScreeningRun & { id: string; created_at?: string };

/**
 * A stored run, read back into the shape the panel renders.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 * The run lived in component state alone, so closing the determination
 * dialog — or any remount — discarded it. The screening was still recorded
 * server-side, but the panel came back empty, the cascade withdrew every row
 * it had written, and the checklist fell from "1 of 4 recorded" back to
 * "0 of 4". The work had been done and the screen said it had not.
 *
 * The columns are snake_case on the table and camelCase in the engine's own
 * type, so the mapping is written out rather than spread: a silently missing
 * `requiresManualReview` would read as "no further work", which is the one
 * value this engine must never invent.
 */
function runFromRow(row: Record<string, unknown>): Run | null {
  const id = typeof row.id === "string" ? row.id : null;
  const verdict = row.verdict as PepScreeningRun["verdict"] | undefined;
  if (!id || !verdict) return null;
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    id,
    created_at: typeof row.created_at === "string" ? row.created_at : undefined,
    verdict,
    message: typeof row.message === "string" && row.message
      ? row.message
      /*
       * The sentence is not stored. It is rebuilt as a statement about the
       * SEARCH — never about the person — so a restored run reads in the same
       * vocabulary as a fresh one.
       */
      : verdict === "indicators_found"
        ? "This run found something a person has to look at."
        : verdict === "no_indicators"
          ? "The registers searched on this run held nothing under this name. "
            + "That is a result about the search, not a clearance."
          : verdict === "not_searchable"
            ? "There was nothing on this party that could be searched."
            : "This run could not search everything it needed to.",
    sources: list<PepScreeningSourceResult>(row.sources),
    candidates: list<PepScreeningCandidate>(row.candidates),
    indicators: list<PepIndicator>(row.indicators),
    /* Absent is treated as "yes, a person still has to look". */
    requiresManualReview: row.requires_manual_review !== false,
    notReached: list<string>(row.not_reached),
    searchedNames: list<string>(row.searched_names),
  };
}


/** Every status renders. A source nobody mentions reads as one nobody needed. */


const SOURCE_WORD: Record<PepScreeningSourceResult["status"], string> = {
  searched: "searched",
  unavailable: "not loaded — not searched",
  failed: "could not be read",
  not_reachable: "not searchable from here — check by hand",
};

/**
 * A status badge, so the reading of a source is legible before the prose is.
 *
 * The words are the same words. Nothing here decides anything the engine did
 * not already decide — a badge is a second rendering of `s.status`, never a
 * second opinion about it.
 */
const SOURCE_BADGE: Record<PepScreeningSourceResult["status"], string> = {
  searched: "border-border/60 bg-muted/40 text-muted-foreground",
  unavailable: "border-warning/40 bg-warning/10 text-warning",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
  not_reachable: "border-warning/40 bg-warning/10 text-warning",
};

/** Whether this source leaves work for a person. Drives the grouping only. */
function needsAPerson(s: PepScreeningSourceResult): boolean {
  return s.status !== "searched";
}

const INDICATOR_TONE: Record<PepIndicator["severity"], string> = {
  review: "border-warning/40 bg-warning/10 text-warning",
  attention: "border-warning/30 bg-warning/5 text-warning",
  context: "border-border/60 bg-muted/30 text-muted-foreground",
};

function SourceCard({ s }: { s: PepScreeningSourceResult }) {
  return (
    <li className="rounded-md border border-border/60 bg-background/40 p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-xs font-medium text-foreground">{s.label}</p>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em]",
            SOURCE_BADGE[s.status],
          )}
        >
          {SOURCE_WORD[s.status]}
        </span>
      </div>

      {s.status === "searched" && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {s.foundCount} match{s.foundCount === 1 ? "" : "es"} under this name
          {s.asAt ? `, current to ${s.asAt}` : ""}
        </p>
      )}

      <dl className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed">
        <div className="flex gap-1.5">
          <dt className="shrink-0 text-muted-foreground/70">Holds</dt>
          <dd className="text-muted-foreground">{s.coverage}.</dd>
        </div>
        {/* Rendered under every source, including the ones that found nothing. */}
        <div className="flex gap-1.5">
          <dt className="shrink-0 text-muted-foreground/70">Gaps</dt>
          <dd className="text-muted-foreground">Does not hold {s.excludes}.</dd>
        </div>
      </dl>

      {s.detail && (
        <p className="mt-1.5 rounded border border-border/50 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
          {s.detail}
        </p>
      )}
    </li>
  );
}


function CandidateCard({
  candidate, decided, onDecide, busy, sourceAsAt, sourceCurrency,
}: {
  candidate: PepScreeningCandidate;
  decided: { decision: "accepted" | "rejected"; reason: string } | undefined;
  onDecide: (decision: "accepted" | "rejected", reason: string) => void;
  busy: boolean;
  /** When the register this candidate came from was read, and how old that is. */
  sourceAsAt: string | null;
  sourceCurrency: "fresh" | "ageing" | "stale" | "never" | null;
}) {
  const [open, setOpen] = useState<"accepted" | "rejected" | null>(null);
  const [reason, setReason] = useState("");
  const span = [candidate.positionStart, candidate.positionEnd].filter(Boolean).join(" – ");

  return (
    <li className="rounded-md border border-border/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{candidate.name}</p>
          <p className="text-xs text-muted-foreground">
            {candidate.positionTitle ?? "Office not recorded"}
            {candidate.jurisdiction ? ` · ${candidate.jurisdiction}` : ""}
            {span ? ` · ${span}` : ""}
          </p>
          {candidate.aliases.length > 0 && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Also recorded as {candidate.aliases.slice(0, 4).join(", ")}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/*
            * Held AS AT the date the register was read, never the bare word
            * "Current". Every Parliament row carries `currently_held: true`
            * by construction — the files are a snapshot of who sits on the
            * day they are downloaded — so an unqualified present tense is a
            * claim about today made from a photograph of last week.
            */}
          <Badge variant="outline" className="text-[10px]">
            {describeTenure(
              candidate.currentlyHeld,
              recencyFromRunSource(sourceAsAt, sourceCurrency, Date.now()),
            )}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {Math.round(candidate.score * 100)}% name match
          </Badge>
        </div>
      </div>

      {decided ? (
        <p className={cn(
          "mt-2 flex items-start gap-1.5 rounded-md border p-2 text-xs",
          decided.decision === "accepted"
            ? "border-warning/40 bg-warning/10 text-warning"
            : "border-border/60 bg-muted/30 text-muted-foreground",
        )}>
          {decided.decision === "accepted"
            ? <Check aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
            : <X aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />}
          <span>
            <span className="font-medium">
              {decided.decision === "accepted"
                ? "Accepted as this customer"
                : "Rejected — a different person"}
            </span>
            <span className="block">{decided.reason}</span>
          </span>
        </p>
      ) : open ? (
        <div className="mt-2 space-y-2">
          <Label className="text-[11px]" htmlFor={`why-${candidate.id}`}>
            {open === "accepted"
              ? "How did you confirm this is the customer?"
              : "How did you tell this is somebody else?"}
          </Label>
          <Input
            id={`why-${candidate.id}`}
            value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={open === "accepted"
              ? "e.g. date of birth and electorate match the client file"
              : "e.g. different date of birth; the office holder is 30 years older"}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm" disabled={busy || reason.trim().length < 10}
              onClick={() => onDecide(open, reason.trim())}
            >
              Record this
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(null); setReason(""); }}>
              Cancel
            </Button>
            {reason.trim().length < 10 && (
              <span className="text-[11px] text-muted-foreground">
                A decision with no reason reads, later, exactly like nobody having looked.
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {candidate.confirmUrl && (
            <Button
              type="button" variant="outline" size="sm"
              onClick={() => window.open(candidate.confirmUrl!, "_blank", "noopener,noreferrer")}
            >
              <ArrowUpRight aria-hidden className="mr-1.5 h-3.5 w-3.5" />
              Open to confirm
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setOpen("accepted")}>
            This is the customer
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen("rejected")}>
            Not the customer
          </Button>
        </div>
      )}
    </li>
  );
}

export function PepScreeningRunPanel({
  caseId, subjectId, onEvidence, onSources,
}: {
  caseId: string;
  subjectId: string;
  /** A completed run becomes a source row. The operator still writes why. */
  onEvidence: (draft: { kind: string; source: string; reference: string; result: string }) => void;
  /**
   * What the run read, reported upwards.
   *
   * The manual-register list below this panel used to describe the run in
   * fixed prose and went stale the first time a register moved from "somebody
   * opens a tab" to "the server reads it" — telling the operator to open by
   * hand a register the panel directly above said it had just searched. It is
   * derived from this now, so the two cannot disagree.
   */
  onSources?: (sources: RunSourceReading[] | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [restored, setRestored] = useState(false);
  const [decisions, setDecisions] = useState<
    Record<string, { decision: "accepted" | "rejected"; reason: string }>>({});

  /*
   * ── The last run for THIS party, read back ────────────────────────────
   * A screening is a recorded fact, not a fact about whether a dialog has
   * stayed open. Restoring it is what stops the checklist resetting itself
   * every time the determination screen is reopened.
   *
   * Scoped to this subject, never to the case: a run against another party is
   * a search under another name, and crediting it here would be the same lie
   * the reset-on-open guard exists to prevent. A failed read leaves the panel
   * as it was — nothing is invented, and the operator can still press Run.
   */
  useEffect(() => {
    let live = true;
    setRun(null);
    setRestored(false);
    setDecisions({});
    void (async () => {
      try {
        const res = await amlCasesApi.listPepScreeningRuns(caseId);
        if (!live) return;
        const row = (res.runs ?? []).find(
          (r) => String((r as Record<string, unknown>).party_screening_subject_id ?? "")
            === subjectId);
        if (!row) return;
        const next = runFromRow(row as Record<string, unknown>);
        if (!next) return;
        setRun(next);
        setRestored(true);
        /* Decisions already taken on this run's candidates stay taken. */
        const taken: Record<string, { decision: "accepted" | "rejected"; reason: string }> = {};
        for (const r of res.reviews ?? []) {
          const review = r as Record<string, unknown>;
          if (String(review.run_id ?? "") !== next.id) continue;
          const candidateId = String(review.candidate_id ?? "");
          const decision = String(review.decision ?? "");
          if (!candidateId || (decision !== "accepted" && decision !== "rejected")) continue;
          taken[candidateId] = { decision, reason: String(review.reason ?? "") };
        }
        setDecisions(taken);
      } catch {
        /* Silent: history that could not be read is not a screening failure,
           and a toast here would fire on every open of the dialog. */
      }
    })();
    return () => { live = false; };
    /* The parent is told what was restored by the one effect on `run`, so
       this no longer reaches outside its own dependencies. */
  }, [caseId, subjectId]);


  /*
   * ── ONE REPORT UPWARDS, DERIVED FROM THE RUN ──────────────────────────
   *
   * The checklist beside this panel classifies each register from what the
   * run read. That report was made in three places — on restore, on a new
   * run, and on failure — which is three chances for the checklist to
   * describe a search this panel did not perform.
   *
   * It is one effect on `run` now. Whatever sets `run` — restoring the
   * party's last screening, pressing the button, a failure clearing it — the
   * parent is told the same thing by the same code, and the two cannot
   * diverge because there is nothing to keep in step.
   *
   * The callback is held in a ref so an unstable prop identity from the
   * parent cannot make this fire on renders where the run has not changed.
   */
  const onSourcesRef = useRef(onSources);
  onSourcesRef.current = onSources;
  useEffect(() => {
    onSourcesRef.current?.(run
      ? run.sources.map((x) => ({
        key: x.key, status: x.status, label: x.label,
        foundCount: x.foundCount, asAt: x.asAt ?? null,
      }))
      : null);
  }, [run]);

  const start = async () => {
    setBusy(true);
    try {
      const res = await amlCasesApi.runPepScreening({
        case_id: caseId, party_screening_subject_id: subjectId,
      });
      setRun(res.run as Run);
      setRestored(false);
      setDecisions({});
      if (res.evidence) onEvidence(res.evidence);
    } catch (e: unknown) {
      // A failure is a technical condition and is shown as one. Reporting it
      // as "nothing found" is how an error becomes an outcome.
      // A run that failed has read nothing, so every register goes back to
      // needing a person — the effect below withdraws the previous run's
      // coverage rather than leaving this attempt credited with its reach.
      setRun(null);
      setRestored(false);
      toast({
        title: "The screening could not be run",
        description: e instanceof Error ? e.message : "The server refused it.",
        variant: "destructive",
      });
    } finally { setBusy(false); }
  };

  const decide = async (
    candidate: PepScreeningCandidate,
    decision: "accepted" | "rejected",
    reason: string,
  ) => {
    if (!run) return;
    setBusy(true);
    try {
      await amlCasesApi.reviewPepScreeningCandidate({
        run_id: run.id, candidate_id: candidate.id, decision, reason,
      });
      setDecisions((prev) => ({ ...prev, [candidate.id]: { decision, reason } }));
      if (decision === "accepted") {
        onEvidence({
          kind: "official_register",
          source: `${candidate.positionTitle ?? "Office"}`
            + `${candidate.jurisdiction ? `, ${candidate.jurisdiction}` : ""}`
            + " — confirmed against the official register",
          reference: candidate.name,
          /* The operator's own words for why it is the customer. */
          result: reason,
        });
      }
    } catch (e: unknown) {
      toast({
        title: "The decision could not be recorded",
        description: e instanceof Error ? e.message : "The server refused it.",
        variant: "destructive",
      });
    } finally { setBusy(false); }
  };

  const outstanding = run
    ? run.candidates.filter((c) => !decisions[c.id]).length
    : 0;

  return (
    <div className="rounded-md border border-border/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold">Run the screening</p>
          <p className="text-[11px] text-muted-foreground">
            Searches the registers Aurixa holds and records what it found. It
            informs the determination; it never makes one.
          </p>
          {/*
            A restored run says so, and says when. Presenting last week's
            search as though it had just been performed is the same
            overstatement as presenting a stale register as current.
          */}
          {restored && run && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Showing the last run for this party
              {run.created_at
                ? ` — ${new Date(run.created_at).toLocaleString("en-AU")}`
                : ""}
              . Run it again to search the registers as they stand today.
            </p>
          )}
        </div>

        <Button type="button" size="sm" onClick={() => void start()} disabled={busy}>
          {busy
            ? <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            : <Search aria-hidden className="mr-1.5 h-3.5 w-3.5" />}
          {run ? "Run again" : "Run screening"}
        </Button>
      </div>

      {run && (
        <div className="mt-3 space-y-3">
          {/*
            The verdict. `no_indicators` is deliberately NEUTRAL — no tick, no
            success tone — because a search that returned nothing has
            established a fact about the search.
          */}
          <p
            role="status"
            className={cn(
              "flex items-start gap-1.5 rounded-md border p-3 text-xs",
              run.verdict === "indicators_found"
                ? "border-warning/40 bg-warning/10 text-warning"
                : run.verdict === "no_indicators"
                  ? "border-border/60 bg-muted/30 text-muted-foreground"
                  : "border-destructive/40 bg-destructive/5 text-destructive",
            )}
          >
            {run.verdict === "no_indicators"
              ? <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              : <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {run.message}
          </p>

          {run.candidates.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Possible matches — {outstanding} still to decide
              </p>
              <ul className="space-y-2">
                {run.candidates.map((c) => (
                  <CandidateCard
                    key={c.id} candidate={c} busy={busy}
                    decided={decisions[c.id]}
                    onDecide={(decision, reason) => void decide(c, decision, reason)}
                    sourceAsAt={
                      run.sources.find((s) => s.key === c.sourceKey)?.asAt ?? null}
                    sourceCurrency={
                      run.sources.find((s) => s.key === c.sourceKey)?.currency ?? null}
                  />
                ))}
              </ul>
            </div>
          )}

          {run.indicators.filter((i) => i.kind !== "possible_match").length > 0 && (
            <ul className="space-y-1.5">
              {run.indicators.filter((i) => i.kind !== "possible_match").map((i) => (
                <li
                  key={i.key}
                  className={cn("rounded-md border p-2.5 text-xs", INDICATOR_TONE[i.severity])}
                >
                  <span className="font-medium">{i.headline}</span>
                  <span className="block">{i.detail}</span>
                </li>
              ))}
            </ul>
          )}

          {/*
            What was searched, always — including under an empty result.

            Grouped by whether the source leaves work for a person, because
            that is the only question an operator has here: the run came back
            with nothing, so WHAT DID IT NEVER LOOK AT? The grouping is read
            off `s.status` and decides nothing the engine did not.
          */}
          <div className="rounded-md border border-border/60 bg-muted/30 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <ShieldQuestion aria-hidden className="h-3 w-3" /> What was searched
            </p>

            {(() => {
              const automatic = run.sources.filter((s) => !needsAPerson(s));
              const manual = run.sources.filter(needsAPerson);
              return (
                <div className="mt-2 space-y-3">
                  {automatic.length > 0 && (
                    <section>
                      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                        <Check aria-hidden className="h-3 w-3 shrink-0" />
                        Aurixa searched {automatic.length}{" "}
                        {automatic.length === 1 ? "register" : "registers"}
                      </p>
                      <ul className="mt-1.5 space-y-1.5">
                        {automatic.map((s) => <SourceCard key={s.key} s={s} />)}
                      </ul>
                    </section>
                  )}

                  {manual.length > 0 && (
                    <section>
                      <p className="flex items-start gap-1.5 text-[11px] font-medium text-warning">
                        <AlertTriangle aria-hidden className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          {manual.length}{" "}
                          {manual.length === 1 ? "register" : "registers"} the
                          platform could not search — you have to open{" "}
                          {manual.length === 1 ? "it" : "them"} yourself, in the
                          manual checks below.
                        </span>
                      </p>
                      <ul className="mt-1.5 space-y-1.5">
                        {manual.map((s) => <SourceCard key={s.key} s={s} />)}
                      </ul>
                    </section>
                  )}
                </div>
              );
            })()}
          </div>

          {run.requiresManualReview && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
              <p className="flex items-start gap-1.5 text-xs font-semibold text-warning">
                <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Next step: a person still has to look
              </p>
              <p className="mt-1 pl-5 text-[11px] leading-relaxed text-muted-foreground">
                This run informs the determination and does not settle it. Work
                through the manual checks below — open each source, record what
                came back — before recording an outcome.
              </p>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
