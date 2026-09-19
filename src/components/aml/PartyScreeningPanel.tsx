/**
 * Party-scoped screening orchestration.
 *
 * Screening work exists per reconciled party — not just the case subject —
 * and adjudication happens on the CANONICAL screening matches: staff inspect
 * each candidate and confirm or dismiss it individually, and the party state
 * is a projection of those resolutions. PEP determinations are recorded here
 * too, with sources and rationale. No screening detail ever reaches the
 * client or the Finance Portal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ClipboardCheck, Loader2, PlayCircle, Gavel, ShieldQuestion } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  amlCasesApi,
  type AmlPartyScreeningSubject,
  type AmlScreeningCandidateMatch,
} from "@/lib/aml/amlCasesApi";
import { displayDate } from "@/lib/aml/displayDate";
import { usePromptDialog } from "@/components/aml/usePromptDialog";
import { ManualScreeningDialog } from "@/components/aml/ManualScreeningDialog";
import { PepDeterminationDialog } from "@/components/aml/PepDeterminationDialog";
import type { PepDeclarationReading } from "@/lib/aml/pepDeclaration";
import {
  manualScreeningAdmissible,
} from "../../../supabase/functions/_shared/aml/manualScreening.pure";

const STATE_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  not_required: "secondary", not_started: "outline", queued: "outline", processing: "outline",
  completed: "default", possible_match: "destructive", confirmed_match: "destructive",
  false_positive: "default", error: "destructive",
};

const PEP_TYPES = ["foreign", "domestic", "international_organisation"] as const;
const PEP_RELATIONSHIPS = ["self", "family_member", "close_associate"] as const;

/**
 * Whether the MLRO may record a manual attempt against this party.
 *
 * Delegated to the SAME module the edge function calls, so the two cannot
 * drift. They already had: this panel carried a hand-written state allowlist
 * that omitted `not_required`, so a case whose sanctions screening was not
 * required offered no manual option at all — while the server would have
 * accepted one, and recorded it correctly as voluntary.
 */
const manualAdmissible = (s: AmlPartyScreeningSubject) =>
  manualScreeningAdmissible({ state: s.state });

export function PartyScreeningPanel({
  caseId, canWrite, canAdjudicate, isMlro, caseStatus, caseStage,
  manualScreeningRequest, pepRequest, onChanged, screeningBlocked, optionalUnavailable,
  pepDeclaration,
}: {
  /**
   * What the customer declared about political exposure, from the stage sync.
   *
   * Passed in rather than re-read so the dialog shows the same reading the
   * Stage 5 path shows — evidence towards the determination, never the
   * determination.
   */
  pepDeclaration?: PepDeclarationReading | null;
  caseId: string; canWrite: boolean; canAdjudicate: boolean; onChanged: () => void;
  /**
   * Whether the signed-in user is the MLRO.
   *
   * Manual screening is narrower than adjudication: a reviewer may adjudicate
   * a candidate the provider produced, but only the MLRO may record that a
   * screening was PERFORMED. Hiding the control is a convenience — the edge
   * function checks the role itself and refuses a non-MLRO caller, so this
   * prop being wrong cannot let anyone record one.
   */
  isMlro?: boolean;
  /**
   * The case's status, used only to SAY that a closed case still accepts
   * compliance evidence.
   *
   * That is the product's existing rule and this does not change it: `closed`
   * is terminal in the case STATUS TRANSITION table (which is why reopening
   * is its own authorised operation), and no screening, adjudication or PEP
   * operation checks it. Record-keeping obligations outlive the file, and a
   * match found after closure still has to be recordable. Stating it beats
   * leaving an operator to guess from a control that silently works.
   */
  caseStatus?: string | null;
  /**
   * The canonical lifecycle dimension. Preferred over `caseStatus`, which is
   * the legacy one — the two diverged in production and every other surface
   * reads this.
   */
  caseStage?: string | null;
  /**
   * A nonce from Stage 5's "Complete sanctions screening manually" action.
   *
   * Each increment opens the manual dialog for the first party that can still
   * take one. It is deliberately not a boolean: the CTA can be pressed again
   * after a dismissal, and a flag already `true` gives this nothing to react
   * to. Nothing about admissibility or evidence changes — this only saves the
   * MLRO finding the same button a second time.
   */
  manualScreeningRequest?: number;
  /**
   * A nonce from the stage header's "Record PEP determination" action.
   *
   * Opens the not-PEP determination dialog for the first party still
   * missing one. The dialog, its required sources and rationale, and its
   * server operation are all unchanged — this only saves the operator
   * hunting for the button the CTA just named.
   */
  pepRequest?: number;
  /**
   * Whether an OPTIONAL run could not execute right now.
   *
   * Deliberately separate from `screeningBlocked`. A blocked required
   * screening is a compliance problem someone must fix; an unavailable
   * optional one is not a problem at all, because the case never needed it.
   * Rendering them the same way would put "provider misconfigured" in front
   * of an operator whose case is complete.
   */
  optionalUnavailable?: boolean;
  /**
   * Why screening cannot execute right now, or null when it can.
   *
   * This panel used to offer "Start screening" whatever state the provider
   * was in, so pressing it produced a red toast about simulator mode — an
   * action that could not succeed, offered as though it could. It now says
   * what is wrong instead of firing into it.
   */
  screeningBlocked?: string | null;
}) {
  const [subjects, setSubjects] = useState<AmlPartyScreeningSubject[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualSubject, setManualSubject] = useState<AmlPartyScreeningSubject | null>(null);
  /*
   * The party whose determination is open. The dialog owns the outcome —
   * nothing that opens it may have already chosen one.
   */
  const [pepSubject, setPepSubject] = useState<AmlPartyScreeningSubject | null>(null);
  const { prompt, dialog } = usePromptDialog();

  const load = useCallback(async () => {
    try { setSubjects((await amlCasesApi.listPartyScreening(caseId)).subjects); }
    catch { setSubjects([]); }
  }, [caseId]);
  useEffect(() => { void load(); }, [load]);

  const queue = async (id: string) => {
    setBusyId(id);
    try {
      const r = await amlCasesApi.queuePartyScreening(id);
      toast({
        title: r.skipped ? "Nothing queued" : "Screening queued",
        description: r.skipped
          ? (r.code === "already_in_progress"
            ? "This party's screening is already queued or running."
            : "This party was screened inside the freshness window.")
          : "The screening engine runs it against the official sanctions lists; candidates come back for adjudication.",
      });
      await load(); onChanged();
    } catch (e: any) {
      toast({ title: "Could not queue screening", description: e?.message, variant: "destructive" });
    } finally { setBusyId(null); }
  };

  /**
   * Run a screening the policy does not require, at the operator's choice.
   *
   * A refusal here is reported as information, never as a failure: the
   * server changes nothing when the provider cannot run, and the case is
   * not waiting on this.
   */
  const runOptional = async (id: string) => {
    setBusyId(id);
    try {
      const r = await amlCasesApi.runOptionalScreening(id);
      toast({
        title: r.ran === false ? "Optional screening did not run" : "Optional screening started",
        description: r.ran === false
          ? (r.message ?? "The provider is not ready. Nothing is blocked — this case does "
            + "not require sanctions screening.")
          : "Run at your request. The case's obligation is unchanged: sanctions screening "
            + "remains not required under policy.",
      });
      await load(); onChanged();
    } catch (e: any) {
      toast({ title: "Could not run optional screening", description: e?.message, variant: "destructive" });
    } finally { setBusyId(null); }
  };

  const adjudicate = async (
    subject: AmlPartyScreeningSubject,
    match: AmlScreeningCandidateMatch,
    outcome: "confirmed_match" | "false_positive",
  ) => {
    const values = await prompt({
      title: outcome === "confirmed_match" ? "Confirm this match" : "Dismiss as false positive",
      description: `${match.matched_name} — ${match.list_name ?? match.match_type}` +
        (match.score != null ? ` (score ${Number(match.score).toFixed(2)})` : "") +
        ". The decision is recorded against the canonical screening match on the case audit trail.",
      confirmLabel: outcome === "confirmed_match" ? "Confirm match" : "Dismiss match",
      destructive: outcome === "confirmed_match",
      fields: [
        {
          name: "note", label: "Adjudication rationale", type: "textarea",
          required: true, minLength: 5,
          placeholder: outcome === "confirmed_match"
            ? "Why this listing is the screened person."
            : "Why this listing is not the screened person.",
        },
      ],
    });
    if (!values) return;
    setBusyId(subject.id);
    try {
      await amlCasesApi.adjudicatePartyScreening(subject.id, match.id, outcome, values.note.trim());
      toast({ title: "Adjudication recorded", description: "Risk is now stale and needs recomputing." });
      await load(); onChanged();
    } catch (e: any) {
      toast({ title: "Adjudication failed", description: e?.message, variant: "destructive" });
    } finally { setBusyId(null); }
  };

  /*
   * The determination is made in `PepDeterminationDialog`, not here.
   *
   * This used to be a generic prompt with two free-text boxes, opened with
   * the ANSWER already chosen by whichever button was pressed, and offering
   * the DFAT sanctions list as its example of a source. All three faults
   * belonged to the flow rather than to any one line of it, so the flow was
   * replaced: three numbered steps, structured sources, and an outcome the
   * operator picks after looking rather than before.
   */
  const openPepDialog = (subject: AmlPartyScreeningSubject) => setPepSubject(subject);

  /*
   * Open the manual dialog when Stage 5 asks for it, on the first party the
   * server would actually accept one for. `manualScreeningAdmissible` is the
   * same rule the edge function applies, so this can never open a dialog
   * whose submission is refused.
   */
  const lastRequest = useRef(manualScreeningRequest ?? 0);
  useEffect(() => {
    const n = manualScreeningRequest ?? 0;
    if (n === lastRequest.current) return;
    lastRequest.current = n;
    if (!isMlro || !subjects) return;
    const target = subjects.find(
      (s) => s.state !== "not_required" && manualAdmissible(s).ok)
      ?? subjects.find((s) => manualAdmissible(s).ok);
    if (target) setManualSubject(target);
  }, [manualScreeningRequest, isMlro, subjects]);

  /*
   * Open the PEP determination flow when the stage header asks for it, on the
   * first party that still needs one.
   *
   * What it must NOT do is pick the answer. This opened
   * `recordPep(target, "not_pep")` directly — a dialog headed "Record
   * not-PEP determination", reached by pressing a CTA that says "Record PEP
   * determination". The conclusion is exactly what the determination is, an
   * operator who had found a PEP had to cancel and hunt for the other
   * button, and a pre-selected "not a PEP" is the one default in this
   * product that must never exist. The dialog now opens on the EVIDENCE and
   * the outcome is chosen at the end of it, after the sources have been
   * looked at rather than before.
   */
  const lastPepRequest = useRef(pepRequest ?? 0);
  useEffect(() => {
    const n = pepRequest ?? 0;
    if (n === lastPepRequest.current) return;
    lastPepRequest.current = n;
    if (!canAdjudicate || !subjects) return;
    const target = subjects.find((s) => !s.pep_determination);
    if (target) setPepSubject(target);
  }, [pepRequest, canAdjudicate, subjects]);

  const now = new Date().toISOString();
  const caseClosed = String(caseStage ?? "") === "closed"
    || String(caseStatus ?? "") === "closed";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Party screening</CardTitle>
        <CardDescription>
          Screening work for every applicable reconciled party. Clients never see screening detail — only safe
          workflow status.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {subjects === null ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading party screening" />
        ) : subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No party screening work yet. Resolve the declared parties in Submission Review first — screening follows
            reconciliation.
          </p>
        ) : (
          <ul className="space-y-2">
            {subjects.map((s) => {
              const openMatches = (s.matches ?? []).filter((m) => m.status === "open" || m.status === "escalated");
              const pep = s.pep_determination ?? null;
              const pepReviewDue = Boolean(pep?.review_due_at && pep.review_due_at < now);
              return (
                <li key={s.id} className="border-b border-border/50 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-medium">{s.screened_name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.party_type.replace(/_/g, " ")}
                      </span>
                    </div>
                  </div>

                  {/*
                    ── SANCTIONS ───────────────────────────────────────
                    Two separate facts, in this order, because conflating
                    them is what produced the defect this section replaces:
                    WHETHER the case owes a screening (policy), and HOW one
                    may be carried out (method). The methods are listed
                    independently — an unready provider disables the
                    automated one and says nothing about the manual one.
                  */}
                  <div className="mt-2 rounded-md border border-border/60 p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Targeted financial sanctions
                      </span>
                      <Badge variant={STATE_TONE[s.state] ?? "outline"}>
                        {s.state === "not_required"
                          ? "not required under policy"
                          : s.state.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {s.last_screened_at && <>last screened {displayDate(s.last_screened_at)} · </>}
                      {s.refresh_due_at && <>refresh due {displayDate(s.refresh_due_at)} · </>}
                      {s.state === "error" && s.error_category
                        && <>{s.error_category.replace(/_/g, " ")} · </>}
                      {/*
                        Say HOW the current position was reached. A manual
                        conclusion must never be presentable as a provider
                        one; an absent value is the method this product had
                        before manual screening existed, so it reads as
                        automated by saying nothing.
                      */}
                      {s.screening_method === "manual" && <>reached by manual MLRO screening · </>}
                      {s.adjudication_note && <>adjudicated · </>}
                      {s.voluntary_run_at && (
                        <>run voluntarily{s.voluntary_run_by_label
                          ? ` by ${s.voluntary_run_by_label}` : ""} — not required under
                          policy · </>
                      )}
                      {s.state === "not_required"
                        ? "No obligation arose, so nobody was screened. This is a policy "
                          + "decision, not a screening result."
                        : "Screening is required for this party."}
                    </div>

                    <dl className="mt-2 space-y-1.5">
                      {/* ── Method 1: the provider ──────────────────── */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <dt className="w-20 shrink-0 text-xs font-medium">Automated</dt>
                        <dd className="flex min-w-0 flex-wrap items-center gap-2">
                          {s.state === "not_required" ? (
                            !canWrite ? (
                              <span className="text-xs text-muted-foreground">
                                Optional — you do not have permission to run it.
                              </span>
                            ) : optionalUnavailable ? (
                              <span className="text-xs text-muted-foreground">
                                Unavailable — the provider or its list is not ready. Nothing
                                is blocked; this case does not require a sanctions screening.
                              </span>
                            ) : (
                              <Button
                                size="sm" variant="outline" disabled={busyId === s.id}
                                onClick={() => void runOptional(s.id)}
                              >
                                {busyId === s.id
                                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                  : <PlayCircle className="mr-1.5 h-3.5 w-3.5" />}
                                Run optional sanctions screening
                              </Button>
                            )
                          ) : !canWrite ? (
                            <span className="text-xs text-muted-foreground">
                              You do not have permission to start a screening.
                            </span>
                          ) : ["queued", "processing"].includes(s.state) ? (
                            <span className="text-xs text-muted-foreground">
                              Running — candidates come back for adjudication.
                            </span>
                          ) : screeningBlocked && ["not_started", "error"].includes(s.state) ? (
                            <span className="text-xs text-muted-foreground">{screeningBlocked}</span>
                          ) : !screeningBlocked
                            && ["not_started", "error", "completed", "false_positive"].includes(s.state) ? (
                              <Button
                                size="sm" variant="outline" disabled={busyId === s.id}
                                onClick={() => void queue(s.id)}
                              >
                                {busyId === s.id
                                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                  : <PlayCircle className="mr-1.5 h-3.5 w-3.5" />}
                                {["completed", "false_positive"].includes(s.state)
                                  ? "Re-screen"
                                  : s.state === "error" ? "Retry screening" : "Start screening"}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                Not available in this state.
                              </span>
                            )}
                        </dd>
                      </div>

                      {/*
                        ── Method 2: the MLRO ──────────────────────────
                        Offered on exactly the states the SERVER admits —
                        `manualScreeningAdmissible` is the same module the
                        edge function calls, so this list cannot drift from
                        it the way a hand-written one did. That includes
                        `not_required`: whether a screening is owed and
                        whether one may be performed are different
                        questions, and refusing here made "not required"
                        mean "not permitted".

                        Provider readiness is deliberately absent from this
                        branch. An unready provider is a fact about the
                        automated method and has no bearing on whether a
                        person may search a published list themselves — it
                        is precisely when they need to.
                      */}
                      {isMlro && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <dt className="w-20 shrink-0 text-xs font-medium">Manual</dt>
                          <dd className="flex min-w-0 flex-wrap items-center gap-2">
                            {manualAdmissible(s).ok ? (
                              <>
                                <Button
                                  size="sm" variant="outline" disabled={busyId === s.id}
                                  onClick={() => setManualSubject(s)}
                                >
                                  <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
                                  Perform manual sanctions screening
                                </Button>
                                <span className="text-xs text-muted-foreground">
                                  MLRO only · {s.state === "not_required" ? "optional" : "required"}
                                  {caseClosed && " · the case is closed, and AML evidence may still be recorded"}
                                </span>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {manualAdmissible(s).ok ? "" : (manualAdmissible(s) as { message: string }).message}
                              </span>
                            )}
                          </dd>
                        </div>
                      )}
                    </dl>

                    {openMatches.length > 0 && (
                      <ul className="mt-2 space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                        {openMatches.map((m) => (
                          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="min-w-0">
                              <span className="font-medium">{m.matched_name}</span>
                              {" — "}{m.list_name ?? m.match_type}
                              {m.score != null && <> · score {Number(m.score).toFixed(2)}</>}
                              {m.jurisdiction && <> · {m.jurisdiction}</>}
                            </span>
                            {canAdjudicate ? (
                              <span className="flex items-center gap-1.5">
                                <Button size="sm" variant="destructive" disabled={busyId === s.id}
                                  onClick={() => void adjudicate(s, m, "confirmed_match")}>
                                  <Gavel className="mr-1 h-3 w-3" /> Confirm
                                </Button>
                                <Button size="sm" variant="outline" disabled={busyId === s.id}
                                  onClick={() => void adjudicate(s, m, "false_positive")}>
                                  Dismiss
                                </Button>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">awaiting reviewer/MLRO</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/*
                      ONE screening history per party. A manual attempt is an
                      ordinary `screening_checks` row, so this is the same
                      history rendered with the detail only a manual attempt
                      carries — who searched what, where, and why.

                      It sits UNDER the policy status rather than replacing
                      it, which is the whole point: "not required" and a
                      voluntary "no match" are answers to different questions
                      and are both true at once.
                    */}
                    {(s.manual_checks ?? []).length > 0 && (
                      <ul className="mt-2 space-y-1.5 rounded-md border border-border/60 p-2">
                        {(s.manual_checks ?? []).map((c) => (
                          <li key={c.id} className="text-xs">
                            <span className="font-medium">
                              {c.voluntary ? "Voluntary manual" : "Manual"}{" "}
                              {(c.scope ?? []).join(", ").replace(/_/g, " ") || "sanctions"} screening
                            </span>
                            {" — "}
                            {(c.manual_outcome ?? "").replace(/_/g, " ") || "recorded"}
                            {c.performed_at && <> · {displayDate(c.performed_at)}</>}
                            {c.voluntary && <> · not required under policy</>}
                            {c.unable_reason && <> · {c.unable_reason.replace(/_/g, " ")}</>}
                            {(c.sources_checked ?? []).length > 0 && (
                              <div className="text-muted-foreground">
                                sources: {(c.sources_checked ?? []).map((x) => x.source_name).join("; ")}
                              </div>
                            )}
                            {(c.searched_names ?? []).length > 0 && (
                              <div className="text-muted-foreground">
                                names searched: {(c.searched_names ?? []).join("; ")}
                              </div>
                            )}
                            {c.rationale && <div className="text-muted-foreground">{c.rationale}</div>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/*
                    ── PEP ─────────────────────────────────────────────
                    A separate obligation with its own evidence and its own
                    determination record. Recording a sanctions screening —
                    by either method — never answers it, and standing
                    sanctions down never stands it down.
                  */}
                  <div className="mt-2 rounded-md border border-border/60 p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Politically exposed person
                      </span>
                      {pep ? (
                        <Badge variant={pep.result === "pep" ? "destructive" : "secondary"}>
                          {pep.result === "pep"
                            ? `PEP · ${pep.pep_type?.replace(/_/g, " ")} (${pep.pep_relationship?.replace(/_/g, " ")})`
                            : "not a PEP"}
                          {pepReviewDue && " · review due"}
                        </Badge>
                      ) : (
                        <Badge variant="outline">determination outstanding</Badge>
                      )}
                    </div>
                    {/*
                      ONE control, because there is one act. Two buttons
                      labelled with the two answers made the choice before the
                      evidence was looked at, which is the wrong way round for
                      a determination.
                    */}
                    {canAdjudicate && (!pep || pepReviewDue) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" disabled={busyId === s.id}
                          onClick={() => openPepDialog(s)}>
                          <ShieldQuestion className="mr-1.5 h-3.5 w-3.5" />
                          Record PEP determination
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {dialog}
      {pepSubject && (
        <PepDeterminationDialog
          subject={pepSubject}
          caseId={caseId}
          declaration={pepDeclaration ?? null}
          sanctionsSignal={
            pepSubject.state === "confirmed_match" ? "confirmed"
              : pepSubject.state === "possible_match" ? "candidate" : "none"
          }
          open
          onOpenChange={(next) => { if (!next) setPepSubject(null); }}
          onRecorded={() => { void load(); onChanged(); }}
        />
      )}
      {manualSubject && (
        <ManualScreeningDialog
          subject={manualSubject}
          open
          onOpenChange={(next) => { if (!next) setManualSubject(null); }}
          onRecorded={() => { void load(); onChanged(); }}
        />
      )}
    </Card>
  );
}
