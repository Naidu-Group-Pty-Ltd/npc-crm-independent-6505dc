import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Loader2, PlusCircle, ShieldCheck, Send, Download, CheckCircle2, XCircle, History, Eye, Archive, ArchiveRestore } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { RegulatoryAssuranceHeader } from "@/components/aml/RegulatoryAssuranceHeader";
import { AustracReportPathCard } from "@/components/aml/AustracReportPathCard";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import { useBrand } from "@/branding/BrandProvider";
import { loadRecordBrandLogo, resolveRecordBrand } from "@/lib/aml/submissionRecordBrand";
import { generateSubmissionRecordPdf, submissionRecordPdfFilename } from "@/lib/aml/submissionRecordPdf";
import {
  austracBundleIdentity, buildAustracBundleRecord,
} from "@/lib/aml/austracBundleRecord.pure";
import { useNavigate, useSearchParams } from "react-router-dom";
import { approvalConfirmation, type AustracReportFacts } from "@/lib/aml/austracReportPath.pure";
import {
  AUSTRAC_KIND_LABEL as KIND_LABEL, austracKindChip, austracStatusLabel, toObligationKind,
} from "@/lib/aml/austracDraftGuidance.pure";
import { amlAustracDraftPath } from "@/lib/aml/amlRoutes";
import { archiveBlockReason, archiveWarning } from "@/lib/aml/austracArchive";
import {
  AmlAccessGate,
  AmlLoadingState,
  AmlPageHeader,
  AmlRefreshButton,
  AmlTableEmptyRow,
  AmlTableLoadingRow,
} from "@/components/aml/primitives";
import {
  amlReportingApi,
  type AmlReport, type AmlReportStatus,
  type AmlReportSubmission, type AmlReportVersion, type AmlReportingSummary,
  type AmlSubmissionChannel,
} from "@/lib/aml/amlReportingApi";

/**
 * Colour marks ONE thing: the report whose existence must not be disclosed.
 *
 * A tone per obligation was the obvious first answer and it was wrong. In
 * the dark theme `--primary` and `--warning` are both the brand gold, so
 * five kinds in five tones rendered as five near-identical amber chips —
 * colour noise carrying no information, which is worse than no colour at
 * all. The three letters are what tells the obligations apart, and they
 * already do it.
 *
 * So the SMR alone is tinted, because s.123 makes disclosing one an offence
 * and that is a fact about how the row must be handled rather than a
 * category. Everything else is a neutral outline.
 */
const KIND_TONE: Record<string, string> = {
  smr: "border-warning/50 bg-warning/10 text-warning",
};

/** What a writer may still change, and what the MLRO may still sign off.
 *  Both mirror `aml-reporting`'s own guards — the server refuses either way;
 *  these decide whether a step is worth OFFERING. */
const DRAFT_EDITABLE = new Set(["draft", "in_review"]);
const SIGNOFF_STATUSES = new Set(["draft", "in_review", "awaiting_mlro"]);

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  in_review: "bg-primary/15 text-primary",
  awaiting_mlro: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  submitted: "bg-primary text-primary-foreground",
  acknowledged: "bg-success text-success-foreground",
  rejected: "bg-destructive/15 text-destructive",
  withdrawn: "bg-muted text-muted-foreground",
};

function fmt(d: string | null | undefined) { return d ? new Date(d).toLocaleString('en-AU') : "—"; }

export default function AmlAustracReporting() {
  const { canWrite, isMlro, hasAnyRole, loading: accessLoading } = useAmlAccess();
  /* Under 768px the register is a list of cards rather than a six-column
     table. See the note where it is drawn. */
  const compact = useIsMobile();
  const { regulatoryHub } = useAmlV3Flags();
  const navigate = useNavigate();
  const { settings: brandSettings } = useBrand();
  /*
    `?report=` is how the draft page hands a saved report back. Without it,
    saving on a page rather than in a dialog would return the operator to a
    list with nothing selected — the dialog closed onto the report it had
    just written, and losing that is the one thing the move could have cost.
  */
  const [searchParams] = useSearchParams();
  const requestedReport = searchParams.get("report");

  const [summary, setSummary] = useState<AmlReportingSummary | null>(null);
  const [reports, setReports] = useState<AmlReport[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  /*
    Archived reports are RETAINED and hidden, never deleted. The register asks
    for the working list by default; the archive is a deliberate look, so it
    is a view rather than a filter buried in the status list.
  */
  const [view, setView] = useState<"live" | "archived">("live");
  const [archiveBusy, setArchiveBusy] = useState(false);
  /*
    Which reports the operator has chosen. Archiving is reversible but it
    still takes a compliance record off the register, so it is an explicit
    pick rather than something a stray click can do to a row nobody meant.
  */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  /**
   * The customers a report can be filed against.
   *
   * `reports.case_id` has existed since the first migration and the draft
   * dialog never set it, so every report ever drafted here was filed against
   * nobody — findable from this page and from nowhere else, least of all the
   * customer's own record. The field is now asked for, and the server was
   * already writing the case event when it was given one.
   */
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<AmlReportVersion[]>([]);
  const [selectedSubs, setSelectedSubs] = useState<AmlReportSubmission[]>([]);
  const [selectedReport, setSelectedReport] = useState<AmlReport | null>(null);

  /** The report whose record is being drawn, so its button can say so. */
  const [bundling, setBundling] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  const [openSubmit, setOpenSubmit] = useState(false);
  const [submitChannel, setSubmitChannel] = useState<AmlSubmissionChannel>("austrac_online");
  const [submitRef, setSubmitRef] = useState("");
  const [submitBundlePath, setSubmitBundlePath] = useState("");
  const [submitAttest, setSubmitAttest] = useState(false);
  const [submitNotes, setSubmitNotes] = useState("");
  const [submitReport, setSubmitReport] = useState<AmlReport | null>(null);

  const [openReceipt, setOpenReceipt] = useState<AmlReportSubmission | null>(null);
  const [receiptRef, setReceiptRef] = useState("");
  const [receiptStatus, setReceiptStatus] = useState("acknowledged");
  const [receiptNotes, setReceiptNotes] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [sum, list] = await Promise.all([
        amlReportingApi.summary(),
        amlReportingApi.listReports({
          status: statusFilter === "all" ? undefined : statusFilter,
          kind: kindFilter === "all" ? undefined : kindFilter,
          archived: view,
        }),
      ]);
      setSummary(sum); setReports(list);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load AUSTRAC reports"); }
    finally { setLoading(false); }
  };

  const loadDetail = async (id: string) => {
    try {
      const r = await amlReportingApi.getReport(id);
      setSelectedReport(r.report ?? null);
      setSelectedVersions(r.versions);
      setSelectedSubs(r.submissions);
    } catch (e: any) { toast.error(e?.message ?? "Failed to load report detail"); }
  };

  useEffect(() => { if (hasAnyRole) load(); /* eslint-disable-next-line */ }, [statusFilter, kindFilter, view, hasAnyRole]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); else { setSelectedReport(null); setSelectedVersions([]); setSelectedSubs([]); } }, [selectedId]);
  useEffect(() => { if (requestedReport) setSelectedId(requestedReport); }, [requestedReport]);

  useEffect(() => {
    if (!hasAnyRole) return;
    amlCasesApi.list({ limit: 200 })
      .then((r) => setCases(r.cases))
      // A report can still be drafted if the list cannot be read; the check
      // below will say it is not filed against anybody, which is true.
      .catch(() => setCases([]));
  }, [hasAnyRole]);

  /**
   * A report as the guided path reads it.
   *
   * One projection rather than two, because the approval guard needs the
   * same reading for a report in the TABLE — where no submissions have been
   * loaded — as the card has for the selected one. Two mappings from a row
   * to `AustracReportFacts` is how a confirmation comes to list checks that
   * belong to a different report.
   *
   * The lodgement reference and the receipt come from the SUBMISSIONS
   * actually recorded rather than from a status word that could disagree
   * with them.
   */
  const factsFor = useCallback((
    report: AmlReport,
    subs: AmlReportSubmission[],
  ): AustracReportFacts | null => {
    // A kind the obligation table does not carry gets no path rather than a
    // crash: `AUSTRAC_OBLIGATIONS[undefined]` is what the card would read.
    const kind = toObligationKind(report.kind);
    if (!kind) return null;
    const latestSub = subs[0] ?? null;
    const meta = (report.metadata ?? {}) as Record<string, any>;
    return {
      kind,
      status: report.status,
      caseId: report.case_id ?? null,
      subjectLabel: cases.find((c) => c.id === report.case_id)?.subject_display_name ?? null,
      title: report.title ?? null,
      narrative: report.narrative ?? null,
      periodStart: report.reporting_period_start ?? null,
      periodEnd: report.reporting_period_end ?? null,
      mlroSignedAt: report.mlro_signed_at ?? null,
      submittedAt: report.submitted_at ?? null,
      externalReference: latestSub?.external_reference ?? null,
      receiptReference: (latestSub as any)?.receipts?.[0]?.receipt_reference
        ?? (report.acknowledged_at ? "recorded" : null),
      obligationAt: meta.obligation_at ?? null,
      terrorismFinancing: meta.terrorism_financing === true,
    };
  }, [cases]);

  const pathFacts = useMemo(
    () => (selectedReport ? factsFor(selectedReport, selectedSubs) : null),
    [selectedReport, selectedSubs, factsFor],
  );

  const startNew = () => navigate(amlAustracDraftPath());
  const editExisting = (r: AmlReport) => navigate(amlAustracDraftPath(r.id));

  const removeReport = async (r: AmlReport) => {
    if (!confirm(`Delete draft "${r.title}"? This cannot be undone.`)) return;
    try { await amlReportingApi.deleteReport(r.id); toast.success("Draft deleted"); if (selectedId === r.id) setSelectedId(null); await load(); }
    catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
  };

  /**
   * The decision that authorises lodgement.
   *
   * ── Why the hand-off went ─────────────────────────────────────────
   * The path used to offer "Send to the MLRO" before this, which on a
   * reporting entity where the person drafting the report IS the MLRO — most
   * of them — was a report sent from somebody to themselves before they
   * could act on it. Approval is the act; the checks are what the approver
   * reviews on the way. `mlro_signoff` accepts a plain draft and always did,
   * so nothing about the server changed.
   *
   * The confirmation the hand-off carried moved here rather than being
   * deleted, because it was always about THIS decision: approving a report
   * whose checks are outstanding is a legitimate thing to do and should
   * never happen by accident. A report with nothing outstanding approves in
   * one click, exactly as it did from the table.
   */
  const signoff = async (r: AmlReport) => {
    if (!isMlro) return;
    const facts = factsFor(r, selectedId === r.id ? selectedSubs : []);
    // One rule, asked identically here and inside the report itself.
    const ask = facts ? approvalConfirmation(facts) : null;
    if (ask && !window.confirm(ask)) return;
    setApproving(r.id);
    try { await amlReportingApi.mlroSignoff(r.id); toast.success("Approved", { description: "It can now be lodged at AUSTRAC Online." }); await load(); if (selectedId === r.id) await loadDetail(r.id); }
    catch (e: any) { toast.error(e?.message ?? "The approval could not be recorded"); }
    finally { setApproving(null); }
  };
  const reject = async (r: AmlReport) => {
    if (!isMlro) return;
    const reason = prompt("Reason for rejection?"); if (!reason) return;
    try { await amlReportingApi.mlroReject(r.id, reason); toast.success("Report returned to draft"); await load(); if (selectedId === r.id) await loadDetail(r.id); }
    catch (e: any) { toast.error(e?.message ?? "Reject failed"); }
  };
  const withdraw = async (r: AmlReport) => {
    if (!isMlro) return;
    const reason = prompt("Withdrawal reason?") ?? "";
    try { await amlReportingApi.withdrawReport(r.id, reason); toast.success("Report withdrawn"); await load(); if (selectedId === r.id) await loadDetail(r.id); }
    catch (e: any) { toast.error(e?.message ?? "Withdraw failed"); }
  };

  /**
   * Put a finished report away, or bring it back.
   *
   * ── Archiving is not deleting ─────────────────────────────────────
   * `delete_report` refuses anything past the draft statuses because a
   * lodged report is a retained record — kept for seven years with the
   * evidence behind it. Archiving keeps every byte of it and takes it off
   * the working list, and it is reversible from the archive view.
   *
   * The rule is the server's and this renders from the same module, so what
   * an operator is offered and what the server accepts cannot become two
   * standards: a report may be archived only once NOTHING IS OWED TO
   * AUSTRAC. Hiding an approved-but-unlodged report would be a way to lose
   * a statutory deadline, not a tidy-up.
   */
  /**
   * Put reports away, or bring them back — one implementation for both
   * directions, one row and many.
   *
   * ── Archiving is not deleting ─────────────────────────────────────
   * `delete_report` refuses anything past the draft statuses because a
   * lodged report is a retained record — kept for seven years with the
   * evidence behind it. Archiving keeps every byte of it and takes it off
   * the working list, and the server enforces the same
   * `archiveBlockReason` this renders from: a report may be archived only
   * once NOTHING IS OWED TO AUSTRAC. Hiding an approved-but-unlodged report
   * would lose a statutory deadline rather than tidy a list.
   *
   * ── Undo is part of the act ───────────────────────────────────────
   * The inverse call is offered on the toast, on exactly the rows that
   * succeeded. Telling somebody a thing is reversible and then making them
   * go and find the other view to reverse it is not the same as reversing
   * it — and a bulk archive is precisely where a mis-click costs the most.
   */
  const runArchive = useCallback(async (
    rows: AmlReport[],
    direction: "archive" | "restore",
    opts: { confirm?: boolean } = {},
  ) => {
    if (rows.length === 0) return;
    const archiving = direction === "archive";

    if (archiving && opts.confirm !== false) {
      const blocked = rows.map((r) => archiveBlockReason(r.status)).find(Boolean);
      if (blocked) { toast.error("It cannot be archived yet", { description: blocked }); return; }
      const warning = rows
        .map((r) => archiveWarning({
          status: r.status,
          hasReceipt: Boolean(r.acknowledged_at) || (selectedId === r.id && selectedSubs.some(
            (sub) => ((sub as { receipts?: unknown[] })?.receipts ?? []).length > 0)),
        }))
        .find(Boolean);
      const what = rows.length === 1
        ? `"${rows[0].title}"`
        : `${rows.length} reports:\n\n${rows.map((r) => `\u2022 ${r.title}`).join("\n")}`;
      const ask = `Archive ${what}?\n\nEverything is kept — the report, its versions, its `
        + `submissions and its receipts — and taken off the working register. You can restore it `
        + `at any time.${warning ? `\n\n${warning}` : ""}`;
      if (!window.confirm(ask)) return;
    }

    setArchiveBusy(true);
    const done: AmlReport[] = [];
    const failures: string[] = [];
    for (const r of rows) {
      try {
        if (archiving) await amlReportingApi.archiveReport(r.id);
        else await amlReportingApi.restoreReport(r.id);
        done.push(r);
      } catch (e: unknown) {
        failures.push((e as Error)?.message ?? r.title);
      }
    }
    setArchiveBusy(false);
    setPicked(new Set());
    if (archiving && done.some((r) => r.id === selectedId)) setSelectedId(null);
    await load();

    if (done.length > 0) {
      const noun = done.length === 1 ? "report" : "reports";
      toast.success(
        archiving ? `${done.length} ${noun} archived` : `${done.length} ${noun} restored`,
        {
          description: archiving
            ? "Retained in full — nothing was deleted."
            : "Back on the working register.",
          action: {
            label: "Undo",
            // The inverse, on exactly the rows that succeeded, and with no
            // second confirmation: undoing is not a new decision.
            onClick: () => { void runArchive(done, archiving ? "restore" : "archive", { confirm: false }); },
          },
        },
      );
    }
    if (failures.length > 0) {
      toast.error(
        `${failures.length} could not be ${archiving ? "archived" : "restored"}`,
        { description: failures[0] },
      );
    }
  }, [load, selectedId, selectedSubs]);

  const openSubmitFor = (r: AmlReport) => {
    setSelectedId(r.id); setSubmitReport(r);
    setSubmitChannel("austrac_online"); setSubmitRef(""); setSubmitBundlePath("");
    setSubmitAttest(false); setSubmitNotes(""); setOpenSubmit(true);
  };
  const submitNow = async () => {
    if (!selectedId) return;
    const isSmr = submitReport?.kind === "smr";
    if (!submitAttest) { toast.error("MLRO tipping-off attestation is required"); return; }
    if (!submitRef.trim() && !submitBundlePath.trim()) { toast.error("Provide an AUSTRAC reference or an export bundle path"); return; }
    if (isSmr && !submitRef.trim()) { toast.error("SMR submissions require the AUSTRAC lodgement reference"); return; }
    try {
      await amlReportingApi.submitRecord({
        report_id: selectedId, channel: submitChannel,
        external_reference: submitRef || undefined,
        export_bundle_path: submitBundlePath || undefined,
        notes: submitNotes || undefined,
        attest_no_tipping_off: true,
      });
      toast.success("Submission recorded");
      setOpenSubmit(false); await load(); await loadDetail(selectedId);
    } catch (e: any) { toast.error(e?.message ?? "Submission failed"); }
  };

  const saveReceipt = async () => {
    if (!openReceipt) return;
    if (!receiptRef) { toast.error("Receipt reference required"); return; }
    try {
      await amlReportingApi.recordReceipt({
        submission_id: openReceipt.id,
        receipt_reference: receiptRef,
        status: receiptStatus as any,
        notes: receiptNotes || undefined,
      });
      toast.success("Receipt captured");
      setOpenReceipt(null); setReceiptRef(""); setReceiptNotes("");
      if (selectedId) await loadDetail(selectedId); await load();
    } catch (e: any) { toast.error(e?.message ?? "Receipt failed"); }
  };

  /**
   * The archive record for one AUSTRAC report, downloaded as a document.
   *
   * It used to download the edge function's JSON response — `austrac-smr-
   * <uuid>.json`, which opens in a text editor, carries no identity, no
   * branding and no statement of what it is. The archive record for a report
   * to a regulator was a developer artefact.
   *
   * It is a PDF now, drawn by the SAME renderer, under the SAME white-label
   * brand resolver, as the client submission record: the workspace's own
   * identity when it has configured one, and Aurixa Systems when it has not
   * — never an empty masthead. Everything on the page comes from the bundle
   * the server assembled and hashed; nothing here is a second source.
   */
  const exportBundle = async (r: AmlReport) => {
    setBundling(r.id);
    try {
      const { bundle, content_hash } = await amlReportingApi.exportBundle(r.id);
      const brand = resolveRecordBrand(brandSettings);
      // A logo that cannot be fetched degrades to the wordmark rather than
      // failing the download: identity is required, a picture is not.
      brand.logoDataUrl = await loadRecordBrandLogo(brandSettings, brand.tenantBranded);
      const linked = cases.find((c) => c.id === (bundle.report?.case_id ?? r.case_id));
      const record = buildAustracBundleRecord({
        bundle: { ...bundle, report: bundle.report ?? r },
        contentHash: content_hash,
        subjectLabel: linked?.subject_display_name ?? null,
        caseReference: linked?.case_reference ?? null,
        issuedBy: brand.name,
      });
      const blob = await generateSubmissionRecordPdf(
        record, brand, austracBundleIdentity(record, bundle.report ?? r),
      );
      const filename = submissionRecordPdfFilename(record);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      toast.success("Report record downloaded", { description: `${filename} · issued by ${brand.name}` });
    } catch (e: any) { toast.error(e?.message ?? "The report record could not be produced"); }
    finally { setBundling(null); }
  };

  /**
   * The reports this view lets an operator choose.
   *
   * On the working register that is the ones nothing is owed to AUSTRAC for
   * — the same rule the row's own button reads and the server enforces, so
   * a checkbox can never select a report the archive would refuse. In the
   * archive it is all of them, because restoring has no precondition.
   */
  const selectable = useMemo(
    () => (view === "archived" ? reports : reports.filter((r) => !archiveBlockReason(r.status))),
    [reports, view],
  );
  const pickedRows = useMemo(
    () => selectable.filter((r) => picked.has(r.id)),
    [selectable, picked],
  );
  const allPicked = selectable.length > 0 && pickedRows.length === selectable.length;
  const togglePicked = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // A selection means nothing once the view or the filters change under it.
  useEffect(() => { setPicked(new Set()); }, [view, statusFilter, kindFilter]);

  const tiles = useMemo(() => summary ? [
    { label: "Drafts", value: summary.draft },
    { label: "Awaiting MLRO", value: summary.awaiting_mlro },
    { label: "Approved", value: summary.approved },
    { label: "Submitted", value: summary.submitted },
    { label: "Acknowledged", value: summary.acknowledged },
    { label: "Rejected", value: summary.rejected },
  ] : [], [summary]);

  if (accessLoading) return <AmlLoadingState variant="spinner" label="Checking your access…" />;
  if (!hasAnyRole) {
    return (
      <AmlAccessGate
        title="You don't have access to the AUSTRAC Hub yet"
        body="Ask your compliance administrator to grant you AML reporting access."
      />
    );
  }


  /*
    ── One definition of what can be done to a row ────────────────────
    The register draws twice now — a table from `md` up, cards below it —
    and the acts are the same acts. Two copies of this list is how a
    phone comes to offer an Approve that the desktop has already taken
    away, so it is written once and rendered in both places. `align`
    is the only thing that differs: a table cell puts them on the right,
    a card puts them under the title where the reading starts.
  */
  const rowActions = (r: AmlReport, align: "start" | "end") => (
    <div className={cn("flex flex-wrap gap-1", align === "end" ? "justify-end" : "justify-start")}>
      {canWrite && ["draft","in_review"].includes(r.status) && (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); editExisting(r); }}>Edit</Button>
      )}
      {isMlro && ["draft","in_review","awaiting_mlro"].includes(r.status) && (
        <Button
          size="sm"
          variant="ghost"
          disabled={approving === r.id}
          onClick={(e) => { e.stopPropagation(); void signoff(r); }}
        >
          {approving === r.id
            ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            : <ShieldCheck className="h-4 w-4 mr-1" />}
          Approve
        </Button>
      )}
      {isMlro && r.status === "approved" && (
        <Button size="sm" onClick={(e) => { e.stopPropagation(); openSubmitFor(r); }}><Send className="h-4 w-4 mr-1" /> Submit</Button>
      )}
      {isMlro && ["approved","in_review","awaiting_mlro"].includes(r.status) && (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); reject(r); }}><XCircle className="h-4 w-4 mr-1" /> Reject</Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={bundling === r.id}
        onClick={(e) => { e.stopPropagation(); void exportBundle(r); }}
      >
        {bundling === r.id
          ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          : <Download className="h-4 w-4 mr-1" />}
        Record
      </Button>
      {canWrite && r.status === "draft" && (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); removeReport(r); }} className="text-destructive">Delete</Button>
      )}
      {/*
        Archive is offered only where the server would
        accept it, and the reason is rendered from the same
        module the server enforces — a button that exists
        to be refused teaches an operator to distrust the
        page.
      */}
      {canWrite && view === "live" && !archiveBlockReason(r.status) && (
        <Button
          size="sm"
          variant="ghost"
          disabled={archiveBusy}
          onClick={(e) => { e.stopPropagation(); void runArchive([r], "archive"); }}
        >
          {archiveBusy
            ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            : <Archive className="h-4 w-4 mr-1" />}
          Archive
        </Button>
      )}
      {canWrite && view === "archived" && (
        <Button
          size="sm"
          variant="ghost"
          disabled={archiveBusy}
          onClick={(e) => { e.stopPropagation(); void runArchive([r], "restore"); }}
        >
          {archiveBusy
            ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            : <ArchiveRestore className="h-4 w-4 mr-1" />}
          Restore
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {regulatoryHub && <RegulatoryAssuranceHeader />}
      <AmlPageHeader
        title="AUSTRAC Reporting Hub"
        description="Draft SMR, TTR, IFTI and compliance reports, capture MLRO sign-off, record submissions and receipts. Nothing auto-submits — human confirmation is required at every step."
        icon={FileText}
        actions={
          <>
            <AmlRefreshButton onClick={load} loading={loading} />
            {/*
              "New Draft" named the row it would add to a table. This names
              the act: an operator asked to inform AUSTRAC about something is
              looking for the report, not for a draft record.
            */}
            {canWrite && (
              <Button size="sm" onClick={startNew}>
                <PlusCircle aria-hidden="true" className="h-4 w-4 mr-2" /> Start AUSTRAC Report
              </Button>
            )}
          </>
        }
      />

      {tiles.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {tiles.map((t) => (
            <Card key={t.label}><CardContent className="p-4">
              <div className="text-xs uppercase text-muted-foreground">{t.label}</div>
              <div className="text-2xl font-semibold">{t.value}</div>
            </CardContent></Card>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle>{view === "archived" ? "Archived reports" : "Reports"}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {/*
                  A view rather than a status filter: archived is not a
                  status a report is IN, it is whether the register is
                  showing it. Putting it in the status list would have made
                  "All statuses" a lie.
                */}
                <div className="flex items-center rounded-md border border-border/70 p-0.5" role="group" aria-label="Register view">
                  {(["live", "archived"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={view === v}
                      onClick={() => { setSelectedId(null); setView(v); }}
                      className={cn(
                        "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                        view === v
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {v === "live" ? "On the register" : "Archived"}
                      {v === "archived" && summary?.archived
                        ? <span className="ml-1.5 tabular-nums opacity-70">{summary.archived}</span>
                        : null}
                    </button>
                  ))}
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {["draft","in_review","awaiting_mlro","approved","submitted","acknowledged","rejected","withdrawn"].map(s => (
                      <SelectItem key={s} value={s}>{austracStatusLabel(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={kindFilter} onValueChange={setKindFilter}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All kinds</SelectItem>
                    {Object.entries(KIND_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{austracKindChip(k)} — {l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <CardDescription>Filter, review, and act on AUSTRAC drafts and submissions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/*
              ── What has been chosen, and what can be done with it ─────
              It appears only when something is selected, so the register is
              not carrying a permanently empty toolbar, and it says the count
              in words because "2" beside a button is not a sentence.
            */}
            {canWrite && pickedRows.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                <span className="text-sm font-medium text-primary">
                  {pickedRows.length} {pickedRows.length === 1 ? "report" : "reports"} selected
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    disabled={archiveBusy}
                    onClick={() => { void runArchive(pickedRows, view === "archived" ? "restore" : "archive"); }}
                  >
                    {archiveBusy
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : view === "archived"
                        ? <ArchiveRestore className="mr-2 h-4 w-4" />
                        : <Archive className="mr-2 h-4 w-4" />}
                    {view === "archived" ? "Restore selected" : "Archive selected"}
                  </Button>
                </div>
              </div>
            )}
            {/* From `md` up the register is a table: six columns of the
                same shape, scanned down. Below it the same rows are cards —
                see the note on the list underneath.

                One or the other, never both. `ResponsiveTable` — this
                repository's own mobile-table pattern — switches on the same
                hook rather than drawing two layouts and hiding one with CSS,
                and it is the right way round: a hidden copy still carries
                every accessible name in the document, so assistive
                technology meets each report's title, checkbox and action
                twice, on whichever layout it is not looking at. */}
            {!compact && (
            <Table aria-label="AUSTRAC reports">
              <TableHeader>
                <TableRow>
                  {canWrite && (
                    <TableHead scope="col" className="w-10">
                      <Checkbox
                        aria-label={view === "archived"
                          ? "Select every archived report"
                          : "Select every report that can be archived"}
                        checked={allPicked}
                        disabled={selectable.length === 0 || archiveBusy}
                        onCheckedChange={(v) => setPicked(
                          v === true ? new Set(selectable.map((r) => r.id)) : new Set(),
                        )}
                      />
                    </TableHead>
                  )}
                  <TableHead scope="col">Kind</TableHead><TableHead scope="col">Title</TableHead>
                  <TableHead scope="col">Status</TableHead>
                  <TableHead scope="col">{view === "archived" ? "Archived" : "Updated"}</TableHead>
                  <TableHead scope="col" className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/*
                  ── Which one am I looking at? ────────────────────────
                  The selected row was a 40%-opacity muted tint and nothing
                  else, which on the dark theme is a shade of the same
                  charcoal as the row beside it. With two reports on the
                  register an operator could not tell which one the whole
                  right-hand panel was describing.

                  Three signals rather than one, because a single tint is
                  what failed: a solid accent bar down the leading edge, a
                  tinted ground, and the word "Viewing" beside the title.
                  `aria-selected` carries the same fact to a screen reader,
                  and the row is a real button for the keyboard — it was
                  click-only, so the register could not be driven without a
                  mouse at all.
                */}
                {reports.map((r) => {
                  const active = selectedId === r.id;
                  return (
                  <TableRow
                    key={r.id}
                    aria-selected={active}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(r.id); }
                    }}
                    className={cn(
                      "relative cursor-pointer transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      active
                        ? "bg-primary/10 hover:bg-primary/10"
                        : "hover:bg-muted/40",
                    )}
                    onClick={() => setSelectedId(r.id)}
                  >
                    {canWrite && (
                      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                        {(view === "archived" || !archiveBlockReason(r.status)) ? (
                          <Checkbox
                            aria-label={`Select ${r.title}`}
                            checked={picked.has(r.id)}
                            disabled={archiveBusy}
                            onCheckedChange={() => togglePicked(r.id)}
                          />
                        ) : (
                          /* No checkbox where the archive would refuse: a
                             control that exists to be turned down teaches an
                             operator to distrust the page. */
                          <span className="sr-only">
                            {archiveBlockReason(r.status) ?? ""}
                          </span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="relative">
                      {active && (
                        <span
                          aria-hidden
                          className="absolute inset-y-0 left-0 w-1 rounded-r bg-primary"
                        />
                      )}
                      <Badge variant="outline" className={cn("font-semibold", KIND_TONE[r.kind] ?? "")}>
                        {austracKindChip(r.kind)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {/*
                        ── The title opens the report ─────────────────
                        "Edit" was offered on a draft alone, so a submitted
                        or approved report could be SELECTED and never
                        opened: the register showed a status and a date and
                        there was no way to read the document behind them.
                        The title is the way in for every status — the page
                        renders read-only where the server would refuse a
                        write, which is why this is safe to offer on all of
                        them.
                      */}
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          className={cn(
                            "truncate rounded-sm text-left underline-offset-4 hover:underline",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active ? "text-primary" : "text-foreground",
                          )}
                          title="Open this report"
                          onClick={(e) => { e.stopPropagation(); navigate(amlAustracDraftPath(r.id)); }}
                        >
                          {r.title}
                        </button>
                        {active && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                            <Eye aria-hidden className="h-3 w-3" /> Viewing
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell><Badge className={STATUS_TONE[r.status] ?? ""}>{austracStatusLabel(r.status)}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {view === "archived" ? fmt(r.archived_at) : fmt(r.updated_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {rowActions(r, "end")}
                    </TableCell>
                  </TableRow>
                  );
                })}
                {!reports.length && loading && <AmlTableLoadingRow colSpan={canWrite ? 6 : 5} label="Loading reports…" />}
                {!reports.length && !loading && (
                  <AmlTableEmptyRow colSpan={canWrite ? 6 : 5}>
                    {view === "archived"
                      ? "Nothing has been archived. A report is archived once its lodgement is behind it; it is kept in full and can be restored."
                      : `No reports match these filters. Try clearing the status or kind filter${canWrite ? ", or start a new draft" : ""}.`}
                  </AmlTableEmptyRow>
                )}
              </TableBody>
            </Table>
            )}

            {/*
              ── The register on a phone ────────────────────────────────
              The table has six columns and a row of action buttons, so on a
              390px screen it was 775px wide inside a horizontal scroller:
              Status, Updated and every action sat off the right-hand edge,
              the Kind chip was squeezed to 40px and set `COMPLIANCE_REPORT`
              one letter per line, and each row stood 150px tall to hold it.
              An operator could see that reports existed and do nothing with
              them.

              The same rows are cards below `md` — the treatment the case
              register already uses, so the two surfaces read alike. The
              acts come from `rowActions`, so there is one list of them; the
              selection, the checkbox and the title's behaviour are the
              table's own.
            */}
            {compact && (
            <div className="space-y-2">
              {reports.map((r) => {
                const active = selectedId === r.id;
                const selectable = view === "archived" || !archiveBlockReason(r.status);
                return (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    aria-selected={active}
                    onClick={() => setSelectedId(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(r.id); }
                    }}
                    className={cn(
                      "relative rounded-xl border p-3 pl-4 text-left shadow-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary/40 bg-primary/10"
                        : "border-border bg-card/60 hover:border-primary/30 hover:bg-muted/40",
                    )}
                  >
                    {/* The same three signals the table row carries: an
                        accent bar, a tinted ground and the word Viewing. */}
                    {active && (
                      <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-r bg-primary" />
                    )}
                    <div className="flex items-start gap-2">
                      {/* The slot is reserved whether or not this row can be
                          chosen, so the titles line up: the table gets that
                          from its column, and a card has to be told. */}
                      {canWrite && (
                        /* 44px, not 20: under 768px the product gives every
                           control a 44px minimum tap target, so the checkbox
                           IS 44px wide here. Reserving its real size is what
                           keeps the four titles on one left edge — a slot
                           sized for the desktop control left the one
                           archivable row indented differently from the three
                           beside it. */
                        <span className="flex w-11 shrink-0 justify-center pt-0.5" onClick={(e) => e.stopPropagation()}>
                          {selectable ? (
                            <Checkbox
                              aria-label={`Select ${r.title}`}
                              checked={picked.has(r.id)}
                              disabled={archiveBusy}
                              onCheckedChange={() => togglePicked(r.id)}
                            />
                          ) : (
                            <span className="sr-only">{archiveBlockReason(r.status) ?? ""}</span>
                          )}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={cn("font-semibold", KIND_TONE[r.kind] ?? "")}>
                            {austracKindChip(r.kind)}
                          </Badge>
                          <Badge className={STATUS_TONE[r.status] ?? ""}>
                            {austracStatusLabel(r.status)}
                          </Badge>
                          {active && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              <Eye aria-hidden className="h-3 w-3" /> Viewing
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          className={cn(
                            "mt-1.5 block w-full rounded-sm text-left text-sm font-medium underline-offset-4 hover:underline",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            active ? "text-primary" : "text-foreground",
                          )}
                          title="Open this report"
                          onClick={(e) => { e.stopPropagation(); navigate(amlAustracDraftPath(r.id)); }}
                        >
                          {r.title}
                        </button>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {view === "archived" ? "Archived" : "Updated"}{" "}
                          {view === "archived" ? fmt(r.archived_at) : fmt(r.updated_at)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      {rowActions(r, "start")}
                    </div>
                  </div>
                );
              })}
              {!reports.length && (
                <p className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  {loading
                    ? "Loading reports…"
                    : view === "archived"
                      ? "Nothing has been archived. A report is archived once its lodgement is behind it; it is kept in full and can be restored."
                      : `No reports match these filters. Try clearing the status or kind filter${canWrite ? ", or start a new draft" : ""}.`}
                </p>
              )}
            </div>
            )}
          </CardContent>
        </Card>

        {/*
          The panel used to head itself "Detail" with the title in muted
          small print underneath, which named neither the obligation nor the
          status — an operator reading it had to look back at the table to
          know which report it was about, and the table did not say either.
        */}
        <Card className={selectedReport ? "border-primary/30" : undefined}>
          <CardHeader className="pb-3">
            {selectedReport ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn("font-semibold", KIND_TONE[selectedReport.kind] ?? "")}>
                    {austracKindChip(selectedReport.kind)}
                  </Badge>
                  <Badge className={STATUS_TONE[selectedReport.status] ?? ""}>
                    {austracStatusLabel(selectedReport.status)}
                  </Badge>
                </div>
                <CardTitle className="text-base leading-snug">{selectedReport.title}</CardTitle>
                <CardDescription>
                  {KIND_LABEL[selectedReport.kind] ?? selectedReport.kind}
                  {selectedReport.case_id
                    ? ` · ${cases.find((c) => c.id === selectedReport.case_id)?.subject_display_name ?? "linked customer"}`
                    : " · not filed against a customer"}
                </CardDescription>
              </div>
            ) : (
              <>
                <CardTitle className="text-base">Detail</CardTitle>
                <CardDescription>Select a report to view versions and submissions.</CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedReport && (
              <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
                Choose a report from the register to see what it still needs, when it is due, and how to
                lodge it.
              </div>
            )}
            {/*
              The path leads, because "what now" is the question an operator
              opens a report with. The tabs below keep every existing detail
              exactly where it was.
            */}
            {selectedReport && pathFacts && (
              <AustracReportPathCard
                facts={pathFacts}
                /*
                  One entry per step this operator can actually act on. A
                  step with no entry draws no button — the MLRO's sign-off,
                  to an analyst, is a real state with no act, and offering a
                  dead "Open" is what made step 3 look broken.
                */
                stepActions={{
                  ...(canWrite && DRAFT_EDITABLE.has(selectedReport.status)
                    ? {
                      identify: { label: "Open the draft", run: () => editExisting(selectedReport) },
                      assemble: { label: "Write the narrative", run: () => editExisting(selectedReport) },
                    }
                    : {}),
                  /*
                    ── Review means opening the report ─────────────────
                    Approving from a register row asks somebody to authorise
                    a document they are not looking at. The step opens the
                    report itself, where the checks, the narrative and the
                    approval are all on one screen — and approving there
                    returns here with the lodgement step open.

                    The row's own Approve button is untouched: an MLRO who
                    has already read the report should not have to open it
                    again, and removing a control is not what this is.
                  */
                  ...(isMlro && SIGNOFF_STATUSES.has(selectedReport.status)
                    ? {
                      approve: {
                        label: "Review and approve",
                        run: () => editExisting(selectedReport),
                      },
                    }
                    : {}),
                  ...(isMlro && selectedReport.status === "approved"
                    ? {
                      lodge: {
                        label: "Record the lodgement",
                        run: () => openSubmitFor(selectedReport),
                      },
                    }
                    : {}),
                  ...(isMlro && selectedSubs.length > 0
                    ? {
                      receipt: {
                        label: "Capture the receipt",
                        run: () => {
                          setOpenReceipt(selectedSubs[0]);
                          setReceiptRef(""); setReceiptNotes("");
                        },
                      },
                    }
                    : {}),
                }}
                /*
                  An open step with no button must still say whose it is. An
                  analyst reaches the approval and cannot make it — that is a
                  real state with a real next actor, and silence about it
                  reads as a broken page.
                */
                stepNotes={{
                  ...(isMlro ? {} : { approve: "The MLRO's decision" }),
                  ...(isMlro ? {} : { lodge: "The MLRO lodges it", receipt: "The MLRO records it" }),
                }}
              />
            )}
            {selectedReport && (
              <Tabs defaultValue="meta">
                <TabsList className="grid grid-cols-3">
                  <TabsTrigger value="meta">Meta</TabsTrigger>
                  <TabsTrigger value="versions">Versions</TabsTrigger>
                  <TabsTrigger value="subs">Submissions</TabsTrigger>
                </TabsList>
                <TabsContent value="meta" className="space-y-2 text-sm">
                  <div><span className="text-muted-foreground">Kind:</span> <Badge variant="outline">{austracKindChip(selectedReport.kind)}</Badge></div>
                  <div><span className="text-muted-foreground">Status:</span> <Badge className={STATUS_TONE[selectedReport.status] ?? ""}>{austracStatusLabel(selectedReport.status)}</Badge></div>
                  <div><span className="text-muted-foreground">Reference:</span> {selectedReport.reference_code ?? "—"}</div>
                  <div><span className="text-muted-foreground">MLRO signed:</span> {fmt(selectedReport.mlro_signed_at)}</div>
                  <div><span className="text-muted-foreground">Submitted:</span> {fmt(selectedReport.submitted_at)}</div>
                  <div><span className="text-muted-foreground">Acknowledged:</span> {fmt(selectedReport.acknowledged_at)}</div>
                  {selectedReport.narrative && (
                    <div className="pt-2">
                      <div className="text-xs uppercase text-muted-foreground mb-1">Narrative</div>
                      <div className="whitespace-pre-wrap text-sm">{selectedReport.narrative}</div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="versions" className="space-y-2">
                  {selectedVersions.length === 0 && <div className="text-sm text-muted-foreground">No versions.</div>}
                  {selectedVersions.map((v) => (
                    <div key={v.id} className="border rounded-md p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">v{v.version} · {v.change_note ?? "—"}</div>
                        <History className="h-3 w-3 text-muted-foreground" />
                      </div>
                      <div className="text-muted-foreground">{fmt(v.created_at)} · {v.author_label ?? "system"}</div>
                      {v.content_hash && <div className="font-mono text-[10px] break-all mt-1">{v.content_hash.slice(0, 32)}…</div>}
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="subs" className="space-y-2">
                  {selectedSubs.length === 0 && <div className="text-sm text-muted-foreground">No submissions.</div>}
                  {selectedSubs.map((s) => (
                    <div key={s.id} className="border rounded-md p-2 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{s.channel.replace(/_/g," ")} · v{s.version}</div>
                        <Badge className={STATUS_TONE[s.status] ?? ""}>{s.status}</Badge>
                      </div>
                      <div className="text-muted-foreground">{fmt(s.submitted_at)}</div>
                      {s.external_reference && <div>Ref: <span className="font-mono">{s.external_reference}</span></div>}
                      {(s.receipts ?? []).map((rec) => (
                        <div key={rec.id} className="pl-2 border-l ml-1 mt-1">
                          <div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" /> {rec.receipt_reference}</div>
                          <div className="text-muted-foreground">{fmt(rec.received_at)} · {rec.status}</div>
                        </div>
                      ))}
                      {isMlro && (
                        <div className="pt-1">
                          <Button size="sm" variant="ghost" onClick={() => { setOpenReceipt(s); setReceiptRef(""); setReceiptStatus("acknowledged"); setReceiptNotes(""); }}>
                            Capture receipt
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Submit dialog */}
      <Dialog open={openSubmit} onOpenChange={setOpenSubmit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record AUSTRAC submission</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {submitReport?.kind === "smr" && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                SMR — tipping-off protections apply. Never disclose to the customer, related parties, or non-AML staff.
                AUSTRAC lodgement reference is mandatory before this can be marked submitted.
              </div>
            )}
            <div>
              <Label>Channel</Label>
              <Select value={submitChannel} onValueChange={(v) => setSubmitChannel(v as AmlSubmissionChannel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["austrac_online","manual_upload","api","email","other"].map(c => <SelectItem key={c} value={c}>{c.replace(/_/g," ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>AUSTRAC external reference {submitReport?.kind === "smr" ? <span className="text-destructive">*</span> : null}</Label>
              <Input value={submitRef} onChange={(e) => setSubmitRef(e.target.value)} placeholder="AUSTRAC lodgement id" />
            </div>
            <div>
              <Label>Export bundle path (optional)</Label>
              <Input value={submitBundlePath} onChange={(e) => setSubmitBundlePath(e.target.value)} placeholder="storage://aml-reports/austrac-…json" />
              <p className="text-[11px] text-muted-foreground mt-1">Provide the archived bundle URL/path if the lodgement reference is not yet available. One evidence source is mandatory.</p>
            </div>
            <div><Label>Notes</Label><Textarea rows={3} value={submitNotes} onChange={(e) => setSubmitNotes(e.target.value)} /></div>
            <div className="flex items-start gap-2 rounded-md border p-3">
              <Checkbox id="mlro-tipping-off-attestation" className="mt-0.5" checked={submitAttest} onCheckedChange={(v) => setSubmitAttest(v === true)} />
              <Label htmlFor="mlro-tipping-off-attestation" className="text-xs font-normal leading-snug">
                <strong>MLRO attestation:</strong> I confirm submission evidence has been captured and no tipping-off breach has occurred.
                This attestation is written to the immutable audit trail.
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenSubmit(false)}>Cancel</Button>
            <Button
              onClick={submitNow}
              disabled={!submitAttest || (!submitRef.trim() && !submitBundlePath.trim()) || (submitReport?.kind === "smr" && !submitRef.trim())}
            >
              <Send className="h-4 w-4 mr-2" /> Record submission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Receipt dialog */}
      <Dialog open={!!openReceipt} onOpenChange={(o) => !o && setOpenReceipt(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Capture AUSTRAC receipt</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Receipt reference</Label><Input value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} /></div>
            <div>
              <Label>Status</Label>
              <Select value={receiptStatus} onValueChange={setReceiptStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["acknowledged","queried","rejected","withdrawn","other"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea rows={3} value={receiptNotes} onChange={(e) => setReceiptNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenReceipt(null)}>Cancel</Button>
            <Button onClick={saveReceipt}><CheckCircle2 className="h-4 w-4 mr-2" /> Save receipt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
