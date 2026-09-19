/**
 * Writing an AUSTRAC report — a page of its own.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 * The draft was a modal. Everything about it was wrong for what it holds:
 * a report to a regulator is the longest single piece of writing anyone
 * does in this product, it is written against a statutory deadline, and it
 * is frequently started, left, and returned to hours later. A dialog cannot
 * be deep-linked, cannot be reopened where it was left, cannot be sent to a
 * colleague, is not reached by the browser's back button — and closes on an
 * outside click or the Escape key with whatever was in it.
 *
 * Everything the dialog asked, this asks. Everything the server refuses, it
 * still refuses. What changed is that the draft now has a URL, room for the
 * narrative, and the reasons for the report in view beside it while it is
 * written rather than competing with it for a modal's worth of height.
 *
 * ── Leaving is not losing ─────────────────────────────────────────────
 * The one thing a page gives up is the modal's implicit "you are in the
 * middle of something", so the page says it: an unsaved change guards both
 * the browser's own unload and this page's own Back, because a narrative
 * somebody spent twenty minutes on is not recoverable from anywhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, FileText, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { AmlAccessGate, AmlLoadingState, AmlPageHeader } from "@/components/aml/primitives";
import { AustracReportDraftForm, type DraftCaseOption } from "@/components/aml/AustracReportDraftForm";
import { draftSectionsForReport, draftSummary } from "@/lib/aml/austracDraftGuidance.pure";
import { amlAustracReportPath, ADMIN_AML_AUSTRAC_PATH } from "@/lib/aml/amlRoutes";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { amlCasesApi } from "@/lib/aml/amlCasesApi";
import {
  amlReportingApi, type AmlReport, type AmlReportSubmission,
} from "@/lib/aml/amlReportingApi";
import { AustracReportPathCard } from "@/components/aml/AustracReportPathCard";
import {
  approvalConfirmation, type AustracReportFacts,
} from "@/lib/aml/austracReportPath.pure";
import { toObligationKind } from "@/lib/aml/austracDraftGuidance.pure";

/** What `upsert_report` still accepts. Past these the server refuses. */
const DRAFT_STATUSES = new Set(["draft", "in_review", "awaiting_mlro"]);

/** A fresh draft. Same starting shape the dialog used. */
const BLANK: Partial<AmlReport> = { kind: "smr", title: "", narrative: "" };

export default function AmlAustracReportDraft() {
  const { reportId } = useParams<{ reportId: string }>();
  const navigate = useNavigate();
  const { canWrite, hasAnyRole, isMlro, loading: accessLoading } = useAmlAccess();

  const [draft, setDraft] = useState<Partial<AmlReport>>(BLANK);
  const [cases, setCases] = useState<DraftCaseOption[]>([]);
  const [casesFailed, setCasesFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(reportId));
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  /** Needed for the lodgement and receipt readings on the path. */
  const [submissions, setSubmissions] = useState<AmlReportSubmission[]>([]);
  /** Set by the first edit, cleared by a save. Guards leaving. */
  const [dirty, setDirty] = useState(false);
  const savedRef = useRef(false);

  useEffect(() => {
    if (!hasAnyRole) return;
    amlCasesApi.list({ limit: 200 })
      .then((r) => setCases(r.cases as DraftCaseOption[]))
      // A report can still be drafted if the list cannot be read; the form
      // says the customer can be linked afterwards, which is true.
      .catch(() => { setCases([]); setCasesFailed(true); });
  }, [hasAnyRole]);

  useEffect(() => {
    if (!hasAnyRole) return;
    if (!reportId) { setDraft(BLANK); setLoading(false); return; }
    let live = true;
    setLoading(true);
    amlReportingApi.getReport(reportId)
      .then((r) => {
        if (!live) return;
        if (!r.report) { setNotFound(true); return; }
        setDraft({ ...r.report });
        setSubmissions(r.submissions ?? []);
      })
      .catch((e: unknown) => {
        if (!live) return;
        toast.error((e as Error)?.message ?? "The report could not be loaded");
        setNotFound(true);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [reportId, hasAnyRole]);

  /*
    A narrative somebody spent twenty minutes on is not recoverable from
    anywhere, so an unsaved change guards the browser's own unload. It is
    registered only while there IS one — an always-on handler makes every
    navigation away from a clean page ask a question nobody needs.
  */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const onChange = useCallback((next: (d: Partial<AmlReport>) => Partial<AmlReport>) => {
    setDraft(next);
    setDirty(true);
  }, []);

  const sections = useMemo(() => draftSectionsForReport(draft), [draft]);
  const outstanding = sections.some((s) => s.state === "outstanding");
  const canSave = Boolean(draft.kind && (draft.title ?? "").trim());

  /**
   * The report as the guided path reads it, from what is ON SCREEN.
   *
   * Built from `draft` rather than from the loaded row, so the checks and
   * the steps answer to what the operator has typed rather than to what was
   * last saved. An approver watching "Narrative written" go green as they
   * write is the whole point of putting the path here.
   */
  const pathFacts: AustracReportFacts | null = useMemo(() => {
    const kind = toObligationKind(draft.kind ?? null);
    if (!kind) return null;
    const meta = (draft.metadata as Record<string, unknown> | undefined) ?? {};
    const latest = submissions[0] ?? null;
    return {
      kind,
      status: draft.status ?? "draft",
      caseId: draft.case_id ?? null,
      subjectLabel: cases.find((c) => c.id === draft.case_id)?.subject_display_name ?? null,
      title: draft.title ?? null,
      narrative: draft.narrative ?? null,
      periodStart: draft.reporting_period_start ?? null,
      periodEnd: draft.reporting_period_end ?? null,
      mlroSignedAt: draft.mlro_signed_at ?? null,
      submittedAt: draft.submitted_at ?? null,
      externalReference: latest?.external_reference ?? null,
      receiptReference: (latest as { receipts?: Array<{ receipt_reference?: string }> } | null)
        ?.receipts?.[0]?.receipt_reference ?? (draft.acknowledged_at ? "recorded" : null),
      obligationAt: meta.obligation_at ? String(meta.obligation_at) : null,
      terrorismFinancing: meta.terrorism_financing === true,
    };
  }, [draft, cases, submissions]);

  /**
   * A report that can no longer be edited here.
   *
   * `upsert_report` refuses anything past the draft statuses, so an approved
   * or lodged report opened at this address would render an editable form
   * whose Save the server answers 403 — a page that looks like it works and
   * does not. It renders read-only and says why instead.
   */
  const editable = !draft.status || DRAFT_STATUSES.has(draft.status);

  const leave = (to: string) => {
    if (dirty && !savedRef.current
      && !window.confirm("This draft has changes that have not been saved. Leave without saving?")) return;
    navigate(to);
  };

  const save = async () => {
    // The same two fields the dialog required. The server owns everything
    // that matters after this — approval, evidence, the attestation.
    if (!draft.kind || !(draft.title ?? "").trim()) {
      toast.error("Kind and title are required");
      return;
    }
    setSaving(true);
    try {
      const saved = await amlReportingApi.upsertReport(draft);
      savedRef.current = true;
      setDirty(false);
      toast.success(reportId ? "Draft saved" : "Draft started");
      navigate(amlAustracReportPath(saved.id));
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? "Save failed");
    } finally { setSaving(false); }
  };

  /**
   * Approve it, here, from the document being approved.
   *
   * ── Why it saves first ────────────────────────────────────────────
   * The MLRO approves what they are LOOKING AT. If the narrative on screen
   * has not been written to the record, signing off would attest to a
   * version nobody read — so an unsaved change is persisted before the
   * decision, in one act, and the approval attaches to the version the
   * approver actually reviewed.
   *
   * ── And why it leaves ─────────────────────────────────────────────
   * Approval takes the report out of the draft statuses, so this page can no
   * longer write to it and the next step is not here: it is the lodgement,
   * which is recorded on the hub. The operator is taken there with the
   * report already selected and step 4 open, rather than left on a form
   * that has become read-only under them.
   */
  const approveHere = async () => {
    if (!isMlro || !reportId) return;
    const ask = pathFacts ? approvalConfirmation(pathFacts) : null;
    if (ask && !window.confirm(ask)) return;
    setApproving(true);
    try {
      if (dirty) {
        await amlReportingApi.upsertReport(draft);
        setDirty(false);
      }
      await amlReportingApi.mlroSignoff(reportId);
      savedRef.current = true;
      setDirty(false);
      toast.success("Approved", { description: "Next: lodge it in your AUSTRAC Online account." });
      navigate(amlAustracReportPath(reportId));
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? "The approval could not be recorded");
    } finally { setApproving(false); }
  };

  if (accessLoading) return <AmlLoadingState variant="spinner" label="Checking your access…" />;
  if (!hasAnyRole || !canWrite) {
    return (
      <AmlAccessGate
        title="You don't have access to draft AUSTRAC reports"
        body="Ask your compliance administrator to grant you AML reporting access."
      />
    );
  }
  if (loading) return <AmlLoadingState variant="spinner" label="Opening the report…" />;
  if (notFound) {
    return (
      <AmlAccessGate
        title="That report could not be opened"
        body="It may have been deleted, or the reference in the address may be wrong. The AUSTRAC hub lists every report on file."
      />
    );
  }

  // `pb-*` is clearance for the bar fixed to the foot of the viewport. It
  // wraps to two lines on a phone, so the reservation is deeper there.
  return (
    <div className="space-y-6 pb-40 sm:pb-28">
      <AmlPageHeader
        /* A report past the draft statuses is READ. Calling the page "Edit"
           when nothing on it can be edited is the same defect the read-only
           form itself fixes. */
        title={!reportId ? "Start an AUSTRAC report" : editable ? "Edit AUSTRAC report" : "AUSTRAC report"}
        description="Assemble the report, hold it on the customer's compliance file, and record who approved it. Lodgement is made in your organisation's own AUSTRAC Online account — nothing here is sent to AUSTRAC."
        icon={FileText}
        actions={
          <Button variant="ghost" size="sm" onClick={() => leave(ADMIN_AML_AUSTRAC_PATH)}>
            <ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" /> Back to the AUSTRAC hub
          </Button>
        }
      />

      {/*
        ── The whole process, in the report ──────────────────────────
        The path was on the hub alone, so an MLRO reviewing a report had the
        checks on one screen and the document on another. It leads with the
        checks now — which is what "review" means — and its approval step
        acts here, on the report being read.

        It is mounted only for a SAVED report: a draft that does not exist
        yet has nothing to approve and no submission to lodge, and the
        guidance rail beside the form already orients somebody starting one.
      */}
      {reportId && pathFacts && (
        <AustracReportPathCard
          facts={pathFacts}
          stepActions={{
            ...(isMlro && editable
              ? {
                approve: {
                  label: dirty ? "Save and approve" : "Approve this report",
                  run: () => { void approveHere(); },
                  busy: approving,
                },
              }
              : {}),
            ...(draft.status === "approved"
              ? {
                lodge: {
                  label: "Record the lodgement",
                  run: () => leave(amlAustracReportPath(reportId)),
                },
              }
              : {}),
            receipt: {
              label: "Open it on the hub",
              run: () => leave(amlAustracReportPath(reportId)),
            },
          }}
          /* The two steps this screen IS. Neither has a button here,
             because the form below them is the act. */
          stepNotes={{
            identify: "On this screen",
            assemble: "On this screen",
            ...(isMlro ? {} : { approve: "The MLRO's decision" }),
          }}
        />
      )}

      {!editable && (
        <Alert>
          <ShieldCheck aria-hidden className="h-4 w-4" />
          <AlertDescription>
            This report has been approved, so it can no longer be edited here — an approval
            attaches to the version that was approved. The remaining steps, and the record of
            them, are on the AUSTRAC hub.
          </AlertDescription>
        </Alert>
      )}

      <fieldset disabled={!editable} className={editable ? undefined : "opacity-70"}>
        <AustracReportDraftForm
          draft={draft}
          onChange={onChange}
          cases={cases}
          casesFailed={casesFailed}
          /* One path rendering per screen: the card above is the live one. */
          showPath={!reportId}
        />
      </fieldset>

      {/*
        The action bar is fixed to the foot of the viewport rather than the
        end of the form. On a page this long, a Save button below an
        eighteen-row narrative is a scroll away from wherever the operator is
        working, which is exactly the thing the modal's own footer got right.
      */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          {/* `basis-64` is what makes this bar wrap on a phone. `flex-1`
              alone is `flex: 1 1 0%`, which contributes nothing to the
              hypothetical size of the line — so the line never overflowed,
              the button group kept its content width, and the summary
              beside it was squeezed to about 26px of a 358px bar. */}
          <p className="flex min-w-0 flex-1 basis-64 items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            {outstanding
              ? <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              : <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />}
            <span>{draftSummary(sections)}</span>
          </p>
          {/* Not `shrink-0`: on a narrow bar the group takes its own line
              rather than pushing the summary out of the way. */}
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <Button variant="ghost" onClick={() => leave(ADMIN_AML_AUSTRAC_PATH)}>
              {editable ? "Cancel" : "Back to the hub"}
            </Button>
            {editable && (
              <Button variant="outline" onClick={save} disabled={saving || approving || !canSave}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {reportId ? "Save draft" : "Save and continue"}
              </Button>
            )}
            {/*
              The approval sits beside the save, because on a report the
              same person drafts and approves the two acts happen in one
              sitting — and it says "Save and approve" while there is an
              unsaved change, so nobody has to wonder which version they
              are signing off.
            */}
            {reportId && isMlro && editable && (
              <Button onClick={() => { void approveHere(); }} disabled={approving || saving || !canSave}>
                {approving
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <ShieldCheck className="mr-2 h-4 w-4" />}
                {dirty ? "Save and approve" : "Approve"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
