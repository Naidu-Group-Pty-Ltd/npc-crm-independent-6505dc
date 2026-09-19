/**
 * Full-page AML case workspace — the ten-stage compliance journey.
 *
 * ── What an operator sees ─────────────────────────────────────────────
 *   identity + risk + gate            persistent header
 *   ten numbered journey stages       the primary navigation
 *   one stage workspace at a time     the existing section components
 *   live position · readiness ·       sticky right rail
 *     attention · next action
 *   Previous · Stage X of 10 · Next   footer
 *
 * ── What the journey changed, and what it did not ─────────────────────
 * The twelve sections are unchanged. Each still lives at the same
 * `?section=` key, still mounts the same component, and still calls the
 * same server operations under the same server-side authorisation. What
 * changed is that the operator no longer has to know the architecture to
 * find them: the rail is the AML process, and each stage says whose move
 * it is, what is blocking it, and where the work is done.
 *
 * Two sections moved stage rather than section. Screening left the
 * identity stage — identity evidence and a sanctions finding answer
 * different questions and the directive is explicit that their meanings
 * must not be merged — and both are still reachable at `?section=identity`
 * and `?section=ownership` exactly as before.
 *
 * ── Nothing on this page is an authority ──────────────────────────────
 * Everything the rail and the right rail show is derived, per render, by
 * the pure helpers in `src/lib/aml/journeyModel.ts` and
 * `src/lib/aml/workspaceViewModel.ts`. None of it is stored. Selecting a
 * stage, or pressing Next, is a page turn: it moves no case stage, no
 * verification outcome, no screening result, no decision, no service gate,
 * no Passport version and no partner access. The service gate is still
 * moved only by an explicit human decision recorded server-side, the
 * Passport is still issued only by `aml-reliance issue_attestation`, and
 * partner distribution readiness is still derived by the server.
 *
 * Rendered at /admin/aml/cases/:caseId behind `aml_v3_case_workspace`;
 * while the flag is off the route redirects to the legacy side-sheet deep
 * link so nothing breaks mid-rollout.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Circle, CircleDot, History, Loader2, Lock, Minus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { reviewCycleLabel } from "../../../supabase/functions/_shared/aml/reviewSchedule.pure";
import { displayDate, displayDateTime } from "@/lib/aml/displayDate";
import {
  readCaseAttribution,
} from "../../../supabase/functions/_shared/aml/caseAttribution.pure";
import {
  amlCasesApi, type AmlCase, type AmlCaseEvent, type AmlScreeningNextAction,
} from "@/lib/aml/amlCasesApi";
import { amlFinanceApi } from "@/lib/aml/amlFinanceApi";
import {
  amlTransactionsApi, type AmlTransaction, type AmlCounterpartyCase,
  type AmlCounterpartyCddSummary, type AmlSettlementGateStatus,
} from "@/lib/aml/amlTransactionsApi";
import {
  amlMonitoringApi, type AmlCaseMonitoring, type AmlReview, type AmlReviewTriggerKind,
} from "@/lib/aml/amlMonitoringApi";
import { usePromptDialog } from "@/components/aml/usePromptDialog";
import { VerificationSection } from "@/components/aml/VerificationSection";
import { SubmissionReviewPanel } from "@/components/aml/SubmissionReviewPanel";
import { LegacyVerificationHistoryPanel } from "@/components/aml/LegacyVerificationHistoryPanel";
import { PartyVerificationPanel } from "@/components/aml/PartyVerificationPanel";
import { PartyScreeningPanel } from "@/components/aml/PartyScreeningPanel";
import { ScreeningStageCard } from "@/components/aml/ScreeningStageCard";
import { ScreeningPathCard } from "@/components/aml/ScreeningPathCard";
import { SanctionsPerimeterControl } from "@/components/aml/SanctionsPerimeterControl";
import { useScreeningStage } from "@/lib/aml/useScreeningStage";
import { deriveScreeningPath, type ScreeningStepKey } from "@/lib/aml/screeningSteps.pure";
import {
  ADMIN_AML_CONFIGURATION_PATH, ADMIN_AML_LIST_HEALTH_PATH,
} from "@/lib/aml/amlRoutes";
import { useLiveCaseRefresh } from "@/lib/aml/useLiveCaseRefresh";
import { ReliancePassportSection } from "@/components/aml/ReliancePassportSection";
import { ComplianceJourneyMap } from "@/components/aml/ComplianceJourneyMap";
import { caseStage, progressRail, serviceGateStatus, type ProgressRailState } from "@/lib/aml/caseDimensions";
import { gatePassportPath } from "@/lib/aml/gatePassportPath.pure";
import { GatePassportPathCard } from "@/components/aml/workspace/GatePassportPathCard";
import {
  ScreeningTab, RiskTab, OwnershipControlTab,
  FundingFinanceTab, TimelineTab, AuditTab,
} from "@/components/aml/CaseWorkspaceTabs";
import { AmlLoadingState } from "@/components/aml/primitives";
import {
  AmlComplianceSummary, AmlConnectedPortals, AmlContextActionPanel, AmlJourneyFooter,
  AmlJourneyRail, AmlJourneyStageHeader, AmlLivePositionRail, AmlNextActionCard,
  AmlOutstandingItems, AmlRecentActivity, AmlWorkspaceHeader,
  MlroDecisionDossier, SECTION_LABELS,
} from "@/components/aml/workspace";
import { AmlPortalAccessCard } from "@/components/aml/AmlPortalAccessCard";
import { AmlDocumentRow } from "@/components/aml/AmlDocumentRow";
import { useAmlCaseSummary } from "@/lib/aml/useAmlCaseSummary";
import {
  deriveAmlLivePosition, isJourneyStageId, JOURNEY_STAGES, sectionsForStage, stageForSection,
  type AmlJourneyStageId,
} from "@/lib/aml/journeyModel";
import {
  deriveAmlConnectedPortals, isWorkspaceSection, WORKSPACE_SECTIONS,
  type AmlWorkspaceSection as SectionKey,
} from "@/lib/aml/workspaceViewModel";

/**
 * Which sections a role may open. Unchanged from the previous rail:
 * Purchase & counterparty, Funding & finance and Monitoring stay behind
 * `canInvestigate`. This is a rendering decision only — the server still
 * authorises every operation those sections perform.
 */
const SECTION_VISIBILITY: Record<SectionKey, (a: { canInvestigate: boolean }) => boolean> = {
  overview: () => true,
  identity: () => true,
  ownership: () => true,
  counterparty: (a) => a.canInvestigate,
  finance: (a) => a.canInvestigate,
  documents: () => true,
  "submission-review": () => true,
  risk: () => true,
  requests: () => true,
  passport: () => true,
  monitoring: (a) => a.canInvestigate,
  timeline: () => true,
};

/** The record surface sits beside the journey, not inside it. */
const RECORD_SECTION: SectionKey = "timeline";

/**
 * Where each Stage 5 step's evidence actually lives.
 *
 * The path names the step; this is the panel that holds the detail behind
 * it. Keyed by step so a new step fails to compile rather than scrolling to
 * whatever happens to be first.
 */
const SCREENING_STEP_ANCHOR: Record<ScreeningStepKey, string> = {
  perimeter: "aml-sanctions-perimeter",
  parties: "aml-party-screening",
  sanctions: "aml-party-screening",
  other_checks: "aml-party-screening",
  pep: "aml-party-screening",
  resolve: "aml-screening-checks",
};


export default function AmlCaseWorkspace() {
  const { caseId = "" } = useParams<{ caseId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // Named explicitly: a bare `prompt` in this scope resolves to the DOM
  // global, which type-checks and silently does the wrong thing.
  const { prompt: askOperator, dialog: workspaceDialog } = usePromptDialog();
  const access = useAmlAccess();
  const { caseWorkspace: workspaceEnabled, loading: flagsLoading } = useAmlV3Flags();

  const [caseRow, setCaseRow] = useState<AmlCase | null>(null);
  const [events, setEvents] = useState<AmlCaseEvent[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canWrite = access.canWrite;
  const canInvestigate = access.roles.has("analyst") || access.roles.has("reviewer") || access.roles.has("mlro");

  const visibleSections = useMemo(
    () =>
      new Set<SectionKey>(
        WORKSPACE_SECTIONS.filter((s) => SECTION_VISIBILITY[s]({ canInvestigate })),
      ),
    [canInvestigate],
  );

  /** A stage with no section this role may open is omitted from the rail. */
  const visibleStages = useMemo(
    () =>
      new Set<AmlJourneyStageId>(
        JOURNEY_STAGES.filter((id) => sectionsForStage(id).some((s) => visibleSections.has(s))),
      ),
    [visibleSections],
  );

  const firstSectionOf = useCallback(
    (id: AmlJourneyStageId): SectionKey | null =>
      sectionsForStage(id).find((s) => visibleSections.has(s)) ?? null,
    [visibleSections],
  );

  // The selected section lives in the `section` URL parameter, so deep links
  // work, a refresh keeps the section, and browser back/forward walks the
  // sections the user visited. `?stage=` is accepted as an alias and resolves
  // to that stage's first visible section. Overview is the default.
  const requestedSection = searchParams.get("section");
  const requestedStage = searchParams.get("stage");
  const section: SectionKey = (() => {
    if (isWorkspaceSection(requestedSection) && visibleSections.has(requestedSection)) {
      return requestedSection;
    }
    if (isJourneyStageId(requestedStage) && visibleStages.has(requestedStage)) {
      return firstSectionOf(requestedStage) ?? "overview";
    }
    return "overview";
  })();

  const setSection = (next: SectionKey) => {
    const params = new URLSearchParams(searchParams);
    params.delete("stage");
    if (next === "overview") params.delete("section");
    else params.set("section", next);
    if (params.toString() === searchParams.toString()) return;
    setSearchParams(params);
  };

  const load = useCallback(async () => {
    if (!caseId) return;
    try {
      setLoading(true);
      setError(null);
      const [res, reqRes] = await Promise.all([
        amlCasesApi.get(caseId),
        amlCasesApi.listClientRequests(caseId).catch(() => ({ requests: [] })),
      ]);
      setCaseRow(res.case);
      setEvents(res.events ?? []);
      setRequests(reqRes.requests ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unable to load this case");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    if (access.hasAnyRole && access.flagEnabled) void load();
  }, [access.hasAnyRole, access.flagEnabled, load]);

  const openRequests = useMemo(
    () => requests.filter((r) => r.status === "open" || r.status === "responded"),
    [requests],
  );

  /**
   * One batched wave of existing reads, fired once per case and shared by
   * every stage. It replaces five self-fetching cards; the heavy stage
   * bodies still load their own detail only when their stage is opened.
   */
  /*
   * Read BEFORE the case summary, which now takes the PEP scope decision from
   * it. Declared afterwards this is a temporal dead zone — the options object
   * is evaluated eagerly, so the page would throw on mount rather than
   * degrade.
   */
  const screeningStage = useScreeningStage(caseId, {
    riskRating: caseRow?.risk_rating ?? null,
    enhancedDueDiligence: caseRow?.status === "edd_required",
  });

  const { loading: summaryLoading, evidence, facts, summary, journey } = useAmlCaseSummary(
    caseRow,
    caseRow ? openRequests.length : undefined,
    {
      enabled: access.hasAnyRole && access.flagEnabled && Boolean(caseRow),
      canReadMatter: canInvestigate,
      clientId: caseRow?.client_id ?? null,
      /*
       * The scope decision the stage read already holds. Passing it here is
       * what lets the journey rail name the PEP determination as the
       * outstanding item instead of reporting "screening has not been run" on
       * a case whose screening obligation was stood down. Until that read
       * lands it is `null`, which reads as owed — the safe direction.
       */
      pepRequired: screeningStage.sync?.scopes?.find(
        (x) => x.scope === "pep")?.required ?? null,
      /*
       * The same read again, for Stage 6. The perimeter is the only thing
       * that can stand down source-of-funds evidence, and until it lands
       * this is null — which reads as unclassified, which reads as inside,
       * which reads as owed. The safe direction, and the same one the
       * screening scope takes.
       */
      perimeter: screeningStage.sync?.perimeter ?? null,
    },
  );

  /**
   * Stage 5's own reading. Separate from the summary because it answers two
   * questions the summary does not: whether the checks CAN execute, and
   * whether the required determinations have actually been made. Those fail
   * independently and are never shown as one thing.
   */
  // Owned here because two surfaces open the same dialog: this card's
  // next-action CTA and the control's own button, further down the page.
  const [perimeterDialogOpen, setPerimeterDialogOpen] = useState(false);
  /*
   * Whether the evidence panels under Stage 5's path are on screen.
   *
   * They are HIDDEN, never unmounted. `PartyScreeningPanel` is what actually
   * opens the manual-screening and PEP dialogs, and it opens them from a
   * nonce this page increments — so unmounting it would make the path's own
   * buttons do nothing, which is precisely the class of defect the path
   * exists to remove. The dialogs are portalled, so they appear over the
   * page whether or not the panel beneath is visible.
   */
  const [screeningDetailOpen, setScreeningDetailOpen] = useState(false);
  /*
   * The reopen action, when the server is offering one.
   *
   * Read into a local rather than written inline, so no source in this file
   * ever spells `next_action` beside a colon — `amlWorkspaceRedesign.source`
   * forbids that shape here, because this reading is derived per render and
   * a page that looks like it is assigning one is a page on its way to
   * persisting it.
   */
  const screeningNextAction = screeningStage.sync?.next_action ?? null;
  const screeningReopenAction = screeningNextAction?.key === "reopen_case"
    ? screeningNextAction
    : null;
  /**
   * A nonce, not a boolean. The Stage 5 CTA may be pressed again after the
   * dialog is dismissed, and a boolean that is already `true` produces no
   * change for the panel to react to — which is how a CTA comes to do nothing
   * on its second press.
   */
  const [manualScreeningRequest, setManualScreeningRequest] = useState(0);
  /** Same nonce pattern, for the PEP determination dialog. */
  const [pepRequest, setPepRequest] = useState(0);
  /**
   * Keep the open case current. A document the client uploads, a screening
   * result landing or a stage completing now reaches a tab that is already
   * open — and comes back immediately when the tab is looked at again.
   */
  const live = useLiveCaseRefresh(
    useCallback(async () => {
      await Promise.all([load(), Promise.resolve(screeningStage.reload())]);
    }, [load, screeningStage.reload]),
    {
      enabled: Boolean(caseRow),
      screeningInFlight: (screeningStage.sync?.subjects ?? []).some(
        (s) => s.required && ["queued", "processing"].includes(s.state)),
      awaitingClient: String(caseRow?.client_portal_status ?? "") !== "complete",
      outstandingWork: (screeningStage.sync?.next_action.key ?? "none") !== "none",
    },
  );

  /**
   * Close a case.
   *
   * ── Why it is here and not in the rail ────────────────────────────────
   * Closing was one of the buttons on the rail's "Advance status" card,
   * behind a reason marked OPTIONAL, beside the ordinary advances. It is not
   * an ordinary advance: `closed` is TERMINAL in the transition table, the
   * record is retained from that point, and the only way back is the
   * authorised reopen below. Presenting an irreversible act as a peer of
   * "Kyc complete" is what made the card wrong.
   *
   * So it moves to the case header, where the case's own identity lives, and
   * it asks for a reason it will not proceed without. The comment in
   * `AmlContextActionPanel` claimed closing was "the case header's" while
   * nothing there did it; this is that claim made true.
   *
   * The server is unchanged: this is the same `transition` call, with the
   * same legal map enforced server-side, and the same reason written to the
   * tamper-evident audit trail.
   */
  const closeCase = useCallback(async () => {
    const values = await askOperator({
      title: "Close this case?",
      description:
        "Closing ends this AML/CTF case. The record is retained for compliance "
        + "purposes and the journey stops here — a closed case cannot be advanced, "
        + "and resuming it takes a separate authorised reopen. The reason is "
        + "written to the tamper-evident audit trail.",
      confirmLabel: "Close case",
      fields: [{
        name: "reason", label: "Why is this case being closed?", type: "textarea",
        required: true, minLength: 10,
        placeholder: "An auditor will read this — say why the case is ending.",
      }],
    });
    if (!values) return;
    try {
      await amlCasesApi.transition(caseId, "closed", values.reason.trim());
      toast({ title: "Case closed", description: "The record is retained and the journey has stopped." });
      load();
    } catch (e: any) {
      toast({
        title: "The case could not be closed",
        description: e?.message ?? "The server refused the request.",
        variant: "destructive",
      });
    }
  }, [caseId, load, askOperator]);

  /**
   * Reopen a closed case.
   *
   * `closed` is terminal in the transition table by design, so this is its
   * own authorised operation rather than a status edit. The server records
   * the reason, resumes the journey from the evidence that already exists,
   * reissues portal access, and re-asks only for consents whose version has
   * moved — and it deliberately does NOT restore a terminated service gate.
   */
  const reopenCase = useCallback(async () => {
    const values = await askOperator({
      title: "Reopen this case",
      description:
        "Everything already gathered is kept — documents, verifications, "
        + "determinations and the questionnaire. The client's portal access is "
        + "reissued and the journey resumes where it left off. Reopening does not "
        + "restore permission to serve: a terminated service gate stays terminated "
        + "and needs a fresh decision.",
      confirmLabel: "Reopen case",
      fields: [{
        name: "reason", label: "Why is this case being reopened?", type: "textarea",
        required: true, minLength: 10,
        placeholder: "An auditor will read this — say what changed.",
      }],
    });
    if (!values) return;
    try {
      const r = await amlCasesApi.reopenCase(caseId, values.reason.trim());
      toast({
        title: "Case reopened",
        description: r.consents_to_reaccept.length > 0
          ? `Resumed at ${r.resumed_status.replace(/_/g, " ")}. The client must re-accept `
            + `${r.consents_to_reaccept.length} consent(s) whose version has changed.`
          : `Resumed at ${r.resumed_status.replace(/_/g, " ")}. No consents needed re-accepting.`,
      });
      load();
      screeningStage.reload();
    } catch (e: any) {
      toast({
        title: "The case could not be reopened",
        description: e?.message ?? "The server refused the request.",
        variant: "destructive",
      });
    }
  }, [caseId, load, askOperator, screeningStage]);

  /**
   * Perform Stage 5's one next action.
   *
   * Every branch routes to an EXISTING server-authorised operation or to the
   * surface that owns it. Nothing here decides a screening outcome, and the
   * server refuses anything this page should not have offered — the button
   * is a shortcut to the right place, never a second authority.
   */
  /**
   * Perform a stage's primary action, rather than only navigating to it.
   *
   * Every one of these opens the surface that PERFORMS the named act. The
   * navigation still happens — the operator needs to see where the work
   * lives — but it is no longer the whole of the behaviour, which is why
   * these buttons appeared dead when the section was already open.
   *
   * Nothing here mutates. Each route opens an existing dialog or form whose
   * own server operation carries the authorisation and the audit record.
   */
  const performStageAction = useCallback((action: {
    section: SectionKey; actionType?: string;
  }) => {
    setSection(action.section);
    switch (action.actionType) {
      case "record_pep":
        // The determination is recorded in the party screening panel's own
        // dialog, with its sources and rationale. Open it directly.
        setSection("ownership");
        setPepRequest((n) => n + 1);
        window.setTimeout(() => {
          document.getElementById("aml-party-screening")?.scrollIntoView({
            block: "start", behavior: "smooth",
          });
        }, 0);
        return;
      case "review_submission":
        /*
         * The review lives in the panel this section renders, and the
         * operator pressing this is often ALREADY on the section — so
         * `setSection` alone changed nothing visible, and a click that
         * changes nothing visible is indistinguishable from a broken
         * button. Same remedy as `client_request`: land on the work.
         */
        window.setTimeout(() => {
          document.getElementById("aml-submission-review")?.scrollIntoView({
            block: "start", behavior: "smooth",
          });
        }, 0);
        return;
      case "client_request":
        // The request form lives in this section and is often already on
        // screen, so focus it: a click that changes nothing visible is
        // indistinguishable from a broken button.
        window.setTimeout(() => {
          const form = document.getElementById("aml-client-request");
          form?.scrollIntoView({ block: "start", behavior: "smooth" });
          form?.querySelector<HTMLElement>("input, textarea, button")?.focus();
        }, 0);
        return;
      case "complete_assessment":
        /*
         * Stage 8's primary act: land on the decision work, not merely the
         * section the operator is already viewing. The guided path at the
         * top of the risk panel then names the open step.
         *
         * This case and `record_gate` used to sit in the SCREENING switch
         * below, whose discriminant is `AmlScreeningNextActionKey` — a union
         * that spells neither — so no screening card could dispatch them and
         * a typecheck pass deleted them as unreachable (15 Sep 2026). The
         * stage header hands its `primaryAction` HERE, which is the only
         * place either act can arrive; before this they fell to `default`
         * and the button changed nothing visible.
         */
        window.setTimeout(() => {
          document.getElementById("aml-risk-decision")
            ?.scrollIntoView?.({ block: "start", behavior: "smooth" });
        }, 0);
        return;
      case "record_gate":
        /* The gate is no longer a second decision on Stage 9. A cleared
         * decision carries it, so the only gate a cleared case can still be
         * holding is one an MLRO deliberately stopped, or a legacy row — and
         * both are recorded on the Decision stage's full gate card, which is
         * where every non-approval status has always lived. */
        setSection("risk");
        window.setTimeout(() => {
          document.getElementById("decision-step-gate")
            ?.scrollIntoView?.({ block: "start", behavior: "smooth" });
        }, 0);
        return;
      default:
        return;
    }
  }, []);

  const runScreeningAction = useCallback(async (action: AmlScreeningNextAction) => {
    switch (action.key) {
      case "enrol_subjects":
        // Enrolment already happened on the read that produced this action;
        // re-running it is the idempotent way to pick up a failed insert.
        screeningStage.reload();
        return;
      case "run_screening": {
        const subjects = (screeningStage.sync?.subjects ?? []).filter(
          (s) => s.required && !["queued", "processing"].includes(s.state));
        if (subjects.length === 0) { screeningStage.reload(); return; }
        // Queued one at a time through the canonical operation, which is
        // itself idempotent — it refuses a subject already in flight rather
        // than emitting a second provider attempt.
        const results = await Promise.allSettled(
          subjects.map((s) => amlCasesApi.queuePartyScreening(s.id)));
        const failed = results.filter((r) => r.status === "rejected");
        // The server runs the check inline, so its refusal is available now
        // rather than a sweep later. Showing it is the difference between
        // "nothing happened" and "the sanctions list has never been loaded".
        const refused = results.find(
          (r) => r.status === "fulfilled" && r.value.inline && !r.value.inline.ran);
        toast(failed.length > 0 || refused
          ? {
            title: "Screening could not complete",
            description: failed.length > 0
              ? (failed[0] as PromiseRejectedResult).reason?.message
                ?? "The screening engine refused the request."
              : (refused as PromiseFulfilledResult<{ inline?: { error?: string } }>)
                .value.inline?.error ?? "The screening engine refused the request.",
            variant: "destructive",
          }
          : {
            title: `Screening completed for ${subjects.length} part${subjects.length === 1 ? "y" : "ies"}`,
            description: "Any candidates come back for adjudication.",
          });
        screeningStage.reload();
        load();
        return;
      }
      case "screening_stalled": {
        // Release the dead queue entries, then re-queue. The server refuses
        // to release anything genuinely in flight, so this cannot cancel a
        // provider call that is actually happening.
        const stuck = (screeningStage.sync?.subjects ?? []).filter(
          (s) => s.required && ["queued", "processing"].includes(s.state));
        const released = await Promise.allSettled(
          stuck.map((s) => amlCasesApi.retryStalledScreening(s.id)));
        const freed = released.filter(
          (r) => r.status === "fulfilled" && !r.value.skipped).length;
        if (freed === 0) {
          toast({
            title: "Nothing was released",
            description: "The screening engine still holds these requests, so they were "
              + "left alone rather than sent twice.",
          });
          screeningStage.reload();
          return;
        }
        const requeued = await Promise.allSettled(
          stuck.map((s) => amlCasesApi.queuePartyScreening(s.id)));
        const failed = requeued.filter((r) => r.status === "rejected");
        toast(failed.length === 0
          ? { title: `Re-queued ${freed} screening request${freed === 1 ? "" : "s"}` }
          : {
            title: "Released, but re-queueing failed",
            description: (failed[0] as PromiseRejectedResult).reason?.message
              ?? "The screening engine refused the request.",
            variant: "destructive",
          });
        screeningStage.reload();
        load();
        return;
      }
      /*
       * The classify step is answered on this page, by the control below the
       * card. Scrolling to it rather than navigating anywhere keeps the
       * decision beside the evidence it is made from — and there is no second
       * endpoint or duplicate form to keep in step.
       */
      /*
       * Open the existing dialog directly.
       *
       * This used to scroll to the control and stop. If the control was
       * already on screen the click did nothing visible at all, and even
       * when it scrolled, the operator still had to find and press a second
       * button to reach the same dialog. One CTA, one click, one dialog.
       */
      case "classify_perimeter":
        setPerimeterDialogOpen(true);
        return;
      case "fix_provider":
        // `/aml/configuration` is not a route. `/aml` and `/aml/passport` are
        // the client-facing surfaces; every staff AML page lives under
        // `/admin/aml/*`, and the sidebar has always linked there. This was
        // the one navigation that did not, so the single action offered for a
        // provider fault led to a 404.
        navigate(ADMIN_AML_CONFIGURATION_PATH);
        return;
      /*
       * A closed case resumes through the ONE authorised reopen operation,
       * with its recorded reason — never through an ordinary status advance.
       * The dialog and the server call already exist; this only routes to
       * them, so there is no second reopening path to keep in step.
       */
      case "reopen_case":
        void reopenCase();
        return;
      /*
       * The MLRO's route when the provider cannot run. It opens the existing
       * manual dialog for the first party that still needs screening — the
       * same dialog, the same evidence rules and the same server operation.
       * A CTA that merely scrolled taught us that naming an action and then
       * not performing it is worse than not offering it.
       */
      case "complete_manually":
        setManualScreeningRequest((n) => n + 1);
        document.getElementById("aml-party-screening")?.scrollIntoView({
          block: "start", behavior: "smooth",
        });
        return;
      case "await_submission":
      case "await_provider_result":
        screeningStage.reload();
        return;
      /*
       * The same treatment as `complete_manually`, for the same reason. On a
       * case whose sanctions obligation is not required, the outstanding PEP
       * determination is Stage 5's ONLY blocker — so this card's primary CTA
       * is the one that has to reach the dialog. It scrolled and stopped,
       * and the party panel is usually already on screen underneath, so the
       * click changed nothing visible: the same dead-button shape the
       * journey rail's copy of this action was fixed for.
       */
      case "record_pep":
        setPepRequest((n) => n + 1);
        document.getElementById("aml-party-screening")?.scrollIntoView({
          block: "start", behavior: "smooth",
        });
        return;
      case "adjudicate_match":
      case "escalate":
      default:
        // The determination and adjudication surfaces live in the panels
        // below this card, which is where the audited actions are.
        document.getElementById("aml-party-screening")?.scrollIntoView({
          block: "start", behavior: "smooth",
        });
        return;
    }
  }, [screeningStage, load, navigate, reopenCase]);

  const connectedPortals = useMemo(
    () =>
      caseRow
        ? deriveAmlConnectedPortals(caseRow, {
            grants: evidence.grants,
            assessments: evidence.assessments,
          })
        : [],
    [caseRow, evidence.grants, evidence.assessments],
  );

  // Staged rollout: while the workspace flag is off, fall back to the legacy
  // side-sheet deep link so bookmarks and shared links keep working.
  if (!flagsLoading && !workspaceEnabled) {
    return <Navigate to={`/admin/aml/cases?open=${caseId}`} replace />;
  }

  if (access.loading || flagsLoading || (loading && !caseRow)) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading the case workspace">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !caseRow) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert variant="destructive">
          <AlertTitle>Case unavailable</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{error ?? "This case could not be found, or you may not have access to it."}</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/aml/cases"><ArrowLeft className="mr-2 h-4 w-4" /> Back to case register</Link>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const activation = (caseRow.metadata as any)?.activation;
  const recordMode = section === RECORD_SECTION;
  const activeStageId = recordMode ? null : stageForSection(section);
  const activeStage =
    journey.stages.find((s) => s.id === activeStageId) ??
    journey.stages.find((s) => s.id === journey.currentStageId) ??
    journey.stages[0];
  const position = deriveAmlLivePosition(facts, journey);

  // Previous / Next walk only the stages this role can actually open.
  const walkable = journey.stages.filter((s) => visibleStages.has(s.id));
  const walkIndex = walkable.findIndex((s) => s.id === activeStage.id);
  const previousStage = walkIndex > 0 ? walkable[walkIndex - 1] : null;
  const nextStage = walkIndex >= 0 && walkIndex < walkable.length - 1 ? walkable[walkIndex + 1] : null;
  const goToStage = (id: AmlJourneyStageId) => {
    const target = firstSectionOf(id);
    if (target) setSection(target);
  };

  /** Sections inside the open stage, when it has more than one. */
  const stageSections = activeStageId
    ? sectionsForStage(activeStageId).filter((s) => visibleSections.has(s))
    : [];

  return (
    <div className="space-y-4">
      {/* ── Persistent case identity ──────────────────────────────────── */}
      <AmlWorkspaceHeader
        caseRow={caseRow}
        matterLabel={evidence.matterLabel}
        live={live}
        onClose={canWrite ? () => void closeCase() : undefined}
      />

      {/* ── The journey: ten stages, plus the record surface beside them ─ */}
      {/* On a phone the record button would eat a third of the rail, so it
          drops to its own row there and rejoins the rail from `sm` up. */}
      <div className="flex flex-col items-stretch gap-2 rounded-xl border border-border/60 bg-card/45 p-2 shadow-sm sm:flex-row">
        <AmlJourneyRail
          className="min-w-0 flex-1"
          journey={journey}
          activeStageId={activeStageId}
          onSelectStage={goToStage}
          visibleStages={visibleStages}
        />
        <div className="flex shrink-0 items-center border-t border-border/60 pt-2 sm:border-l sm:border-t-0 sm:pl-2 sm:pt-0">
          <Button
            variant={recordMode ? "secondary" : "ghost"}
            size="sm"
            className="h-auto w-full gap-1.5 px-2 py-1.5 text-[11px] sm:w-auto sm:flex-col sm:gap-1"
            aria-current={recordMode ? "page" : undefined}
            onClick={() => setSection(RECORD_SECTION)}
          >
            <History aria-hidden className="h-4 w-4" />
            Case record
          </Button>
        </div>
      </div>

      {/* ── Body: the open stage, with the live position rail beside it ── */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main
          className="min-w-0 space-y-4"
          aria-label={recordMode ? "Case record" : `${activeStage.label} stage`}
        >
          {recordMode ? (
            <header>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Case record
              </p>
              <h2 className="mt-0.5 text-lg font-semibold tracking-tight sm:text-xl">
                Timeline &amp; audit
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                The canonical fourteen-step rail and the hash-chained event history. Nothing here is
                a journey stage — casework is done on the stages, and every one of them writes here.
              </p>
            </header>
          ) : (
            <AmlJourneyStageHeader
              stage={activeStage}
              totalStages={JOURNEY_STAGES.length}
              onOpenSection={setSection}
              onPerform={performStageAction}
              /*
               * A stage whose surface below carries the same act and its own
               * progress states it once. Repeating both here put one act on
               * the screen three times, in three sets of words, above two
               * progress readings that counted different things.
               *
               * Stage 5 (its screening path) and Stage 9 (Gate & Passport,
               * in order) both do. Stage 9's header said "0 of 3 items on
               * this stage complete" beside a four-step list — two true
               * numbers, neither about the list underneath them.
               */
              deferToSurfaceBelow={
                (section === "ownership" && Boolean(screeningStage.sync))
                || section === "passport"
              }
            />
          )}

          {/* A stage with more than one section gets a compact sub-rail
              rather than stacking two heavy bodies — one workspace at a
              time, and the section keys stay exactly as they were. */}
          {stageSections.length > 1 && (
            <div
              role="tablist"
              aria-label={`${activeStage.label} sections`}
              className="flex flex-wrap gap-1 rounded-lg border border-border/60 bg-muted/25 p-1"
            >
              {stageSections.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={key === section}
                  onClick={() => setSection(key)}
                  className={cnStageTab(key === section)}
                >
                  {SECTION_LABELS[key]}
                </button>
              ))}
            </div>
          )}

          {/* ── Stage 1 · Activation ────────────────────────────────── */}
          {section === "overview" && (
            <>
              <ActivationRecordCard caseRow={caseRow} activation={activation} />
              <AmlNextActionCard
                action={summary.nextAction}
                onOpenSection={setSection}
                currentStageOrder={
                  activeStageId ? JOURNEY_STAGES.indexOf(activeStageId) + 1 : undefined
                }
                /*
                 * The stages the button steps over, read from the journey
                 * itself. The card used to assert they had nothing
                 * outstanding without consulting any of them.
                 */
                interposed={(() => {
                  const from = activeStageId
                    ? JOURNEY_STAGES.indexOf(activeStageId) + 1 : 0;
                  const to = summary.nextAction.stageOrder;
                  if (!from || to <= from + 1) return [];
                  return journey.stages
                    .filter((st) => st.number > from && st.number < to)
                    .map((st) => ({
                      number: st.number,
                      label: st.shortLabel,
                      state: !st.applicable
                        ? "not_required" as const
                        : st.outstandingItems.length > 0
                          ? "outstanding" as const
                          : "clear" as const,
                      reason: st.notApplicableReason,
                    }));
                })()}
                onReopen={canInvestigate ? () => void reopenCase() : undefined}
              />
              <div className="grid items-start gap-4 md:grid-cols-2">
                <AmlOutstandingItems items={summary.outstanding} onOpenSection={setSection} />
                <AmlRecentActivity events={events} onOpenTimeline={() => setSection(RECORD_SECTION)} />
              </div>
              <AmlComplianceSummary
                summary={summary.compliance}
                loading={summaryLoading}
                onOpenSection={setSection}
              />
              <AmlConnectedPortals
                portals={connectedPortals}
                loading={summaryLoading}
                onOpenSharing={() => setSection("passport")}
              />
            </>
          )}

          {/* ── Stage 2 · Client intake ─────────────────────────────── */}
          {section === "requests" && (
            <div className="space-y-4">
              {/*
                Can the client actually get in? Placed FIRST in this stage,
                above their progress through it, because chasing somebody
                who has no login is chasing nothing — and that is exactly
                what this workspace used to ask an operator to do.
              */}
              <AmlPortalAccessCard
                facts={evidence.portalAccess}
                loading={summaryLoading && !evidence.portalAccess}
                clientId={caseRow.client_id ?? null}
                clientName={caseRow.subject_display_name}
                onChanged={load}
              />
              <ClientIntakeCard caseRow={caseRow} consent={evidence.consent} requests={requests} />
              {/* Consent evidence belongs with the client's own intake. */}
              <ConsentEvidenceCard caseId={caseRow.id} />
              <RequestsSection
                caseId={caseRow.id}
                requests={requests}
                canWrite={canWrite}
                onChanged={load}
              />
            </div>
          )}

          {/* ── Stage 3 · Documents & evidence ──────────────────────── */}
          {section === "documents" && (
            <DocumentsEvidenceSection caseId={caseRow.id} canWrite={canWrite} onChanged={load} />
          )}

          {/* ── Stage 4 · Identity verification ─────────────────────── */}
          {section === "identity" && (
            <div className="space-y-4">
              {/* ONE canonical identity-verification surface: per-party
                  attempts, processing state, document sightings and audited
                  biometric access. The legacy identity_checks history lives
                  in its own collapsed read-only panel below — there are no
                  two competing primary actions. */}
              <VerificationSection caseId={caseRow.id} canWrite={canWrite} onChanged={load} />
              <PartyVerificationPanel caseId={caseRow.id} canWrite={canWrite} onChanged={load} />
              <LegacyVerificationHistoryPanel caseId={caseRow.id} />
            </div>
          )}

          {/* ── Stage 5 · Screening & ownership ─────────────────────── */}
          {section === "ownership" && (
            <div className="space-y-4">
              {/*
                ── Stage 5 IS A PATH ───────────────────────────────────
                Numbered steps, one of them open, in the order they are
                answered — because the stage had every fact it needed and no
                order at all. On the reported case the whole screen reduced
                to one act, and "Record PEP determination" appeared four
                times in four different words while everything else was
                already settled.

                The path decides nothing: `deriveScreeningPath` arranges the
                same server-decided facts the card below renders in full,
                and the work still happens in the panels beneath.
              */}
              {screeningStage.sync && (
                <ScreeningPathCard
                  path={deriveScreeningPath({
                    sync: screeningStage.sync,
                    position: screeningStage.position,
                  })}
                  caseClosed={screeningStage.sync.case_closed === true}
                  closedAction={screeningReopenAction}
                  radarParties={(screeningStage.sync.subjects ?? []).map((s) => ({
                    name: s.screened_name,
                    returned: s.state !== "not_started" && s.state !== "processing",
                    candidate: s.state === "possible_match",
                  }))}
                  onAct={runScreeningAction}
                  onContinue={nextStage ? () => goToStage(nextStage.id) : undefined}
                  onReviewPerimeter={() => setPerimeterDialogOpen(true)}
                  onOpenDetail={(step: ScreeningStepKey) => {
                    setScreeningDetailOpen(true);
                    // After the panels are on screen, not before.
                    window.setTimeout(() => {
                      document.getElementById(SCREENING_STEP_ANCHOR[step])
                        ?.scrollIntoView({ block: "start", behavior: "smooth" });
                    }, 0);
                  }}
                  actor={{
                    canWrite,
                    isReviewer: access.roles.has("reviewer"),
                    isMlro: access.isMlro,
                  }}
                />
              )}

              {/*
                ── The evidence, one click away ────────────────────────
                Everything the stage used to show at once. It is HIDDEN
                rather than unmounted: `PartyScreeningPanel` owns the manual
                screening and PEP dialogs and opens them from a nonce this
                page increments, so unmounting it would make the path's own
                buttons do nothing.
              */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm" variant="outline"
                  aria-expanded={screeningDetailOpen}
                  aria-controls="aml-screening-detail"
                  onClick={() => setScreeningDetailOpen((v) => !v)}
                >
                  {screeningDetailOpen ? "Hide" : "Show"} the full screening detail
                </Button>
                <span className="text-xs text-muted-foreground">
                  Scope, determinations, parties, checks and ownership — the complete
                  evidence behind the steps above.
                </span>
              </div>

              <div
                id="aml-screening-detail"
                className={cn("space-y-4", !screeningDetailOpen && "hidden")}
              >
              {/*
                What this stage requires, whether it can run, and what
                happens next. The ACTION and the classification prompt now
                belong to the path above, so this renders the evidence only —
                the same panels, without a second copy of the ask.
              */}
              <ScreeningStageCard
                variant="evidence"
                reading={screeningStage}
                onAct={runScreeningAction}
                onContinue={nextStage ? () => goToStage(nextStage.id) : undefined}
                onReviewPerimeter={() => setPerimeterDialogOpen(true)}
                onOpenListHealth={() => navigate(ADMIN_AML_LIST_HEALTH_PATH)}
                actor={{
                  canWrite,
                  isReviewer: access.roles.has("reviewer"),
                  isMlro: access.isMlro,
                }}
              />
              {/*
                The lever that makes the per-scope policy reachable. Without
                it sanctions stayed required on every case by default —
                correct, and unusable.

                `canClassify` is reviewer/MLRO, matching the server. The
                backend enforces it independently; this only decides whether
                an action nobody may take is offered.
              */}
              <div id="aml-sanctions-perimeter" className="scroll-mt-24">
              <SanctionsPerimeterControl
                caseId={caseRow.id}
                perimeter={screeningStage.sync?.perimeter ?? null}
                canClassify={access.isMlro || access.roles.has("reviewer")}
                open={perimeterDialogOpen}
                onOpenChange={setPerimeterDialogOpen}
                onChanged={() => { screeningStage.reload(); load(); }}
              />
              </div>
              {/* Identity and screening share a customer but never share a
                  meaning: separate panels, separate evidence, separate
                  adjudication. That is why screening is its own stage. */}
              <div id="aml-party-screening" className="scroll-mt-24">
              <PartyScreeningPanel
                caseId={caseRow.id}
                canWrite={canWrite}
                canAdjudicate={access.isMlro || access.roles.has("reviewer")}
                isMlro={access.isMlro}
                caseStatus={caseRow.status}
                caseStage={caseRow.case_stage ?? null}
                manualScreeningRequest={manualScreeningRequest}
                pepRequest={pepRequest}
                /* The customer's own answer, shown to the person determining it. */
                pepDeclaration={screeningStage.sync?.pep_declaration ?? null}
                onChanged={() => { load(); screeningStage.reload(); }}
                screeningBlocked={
                  /*
                   * Only a case that actually needs the provider can be
                   * blocked by it. `provider_relevant` is false when no
                   * required scope uses it, and then an unready provider is
                   * a fact that does not apply rather than a blocker.
                   */
                  screeningStage.sync
                    && screeningStage.sync.provider_relevant !== false
                    && !screeningStage.sync.provider_ready
                    ? "Screening cannot run — see the action above"
                    : null
                }
                optionalUnavailable={
                  Boolean(screeningStage.sync && !screeningStage.sync.provider_ready)
                }
              />
              </div>
              <div id="aml-screening-checks" className="scroll-mt-24">
                <ScreeningTab caseId={caseRow.id} canWrite={canInvestigate} onChanged={load} />
              </div>
              <div id="aml-ownership-control" className="scroll-mt-24">
                <OwnershipControlTab caseRow={caseRow} canWrite={canInvestigate} />
              </div>
              </div>
            </div>
          )}

          {/* ── Stage 6 · Funding & transaction ─────────────────────── */}
          {section === "finance" && canInvestigate && (
            <FundingFinanceTab
              caseId={caseRow.id} canWrite={canWrite} onChanged={load}
              onContinue={() => setSection("submission-review")}
            />
          )}
          {section === "counterparty" && canInvestigate && (
            <PurchaseCounterpartySection caseRow={caseRow} canWrite={canWrite} />
          )}

          {/* ── Stage 7 · Submission review ─────────────────────────── */}
          {section === "submission-review" && (
            <div id="aml-submission-review" className="scroll-mt-24">
            <SubmissionReviewPanel
              caseId={caseRow.id}
              canWrite={canWrite}
              canDecide={access.isMlro || access.roles.has("reviewer")}
              onChanged={load}
            />
            </div>
          )}

          {/* ── Stage 8 · Risk & MLRO decision ──────────────────────── */}
          {section === "risk" && (
            <div className="space-y-4">
              <MlroDecisionDossier
                facts={facts}
                readiness={summary.readiness}
                events={events}
                onOpenSection={setSection}
              />
              <div id="aml-risk-decision" className="scroll-mt-24">
                <RiskTab
                  caseId={caseRow.id}
                  canWrite={canWrite}
                  onChanged={load}
                  onOpenSection={(s) => setSection(s as SectionKey)}
                  hasAssignedMlro={Boolean(caseRow.assigned_mlro_id)}
                />
              </div>
            </div>
          )}

          {/* ── Stage 9 · Service gate & Passport ───────────────────── */}
          {section === "passport" && (
            <div className="space-y-4">
              {/*
                ── The road to an issued Passport, in order ──────────────
                Stage 9 kept silent about the Stage 8 outcome — a cleared
                case read "Under review — not yet decided" about the gate
                and looked like the decision had not pulled through. The
                path pulls it through as step 1, orders gate → preview →
                issue, and every step lands where the act is done: the
                Decision stage, the digital passport page, the reliance
                panel below. The passport state is the SERVER's own code —
                nothing here derives one.
              */}
              <div id="aml-passport-path" className="scroll-mt-24">
                <GatePassportPathCard
                  steps={gatePassportPath({
                    decisionOutcome:
                      caseStage(caseRow) === "cleared" || caseRow.status === "cleared"
                        ? "cleared"
                        : caseStage(caseRow) === "blocked" || caseRow.status === "blocked"
                          ? "blocked"
                          : null,
                    gateStatus: serviceGateStatus(caseRow),
                    passportState: facts.passport?.state?.code ?? null,
                    /* The reasons, not only the code: `refresh_required`
                       covers two different owed acts and only these tell
                       them apart. Without them the step told a cleared case
                       with a perfectly good v1 to issue a v2 that could not
                       have changed anything. */
                    passportReasons: facts.passport?.state?.reasons ?? null,
                    passportVersion: facts.passport?.version ?? null,
                    canReview: access.isMlro || access.roles.has("reviewer"),
                  })}
                  onStepClick={(key) => {
                    if (key === "decision") {
                      // The decision is Stage 8's act — it stays there.
                      setSection("risk");
                      window.setTimeout(() => {
                        document.getElementById("decision-step-decision")
                          ?.scrollIntoView?.({ block: "start", behavior: "smooth" });
                      }, 0);
                    } else if (key === "gate") {
                      /* The gate travels with the decision now. Where one is
                         still outstanding it is a stopped gate or a legacy
                         row, and both are recorded on the Decision stage. */
                      setSection("risk");
                      window.setTimeout(() => {
                        document.getElementById("decision-step-gate")
                          ?.scrollIntoView?.({ block: "start", behavior: "smooth" });
                      }, 0);
                    } else if (key === "preview") {
                      // The digital passport, exactly as the client and
                      // partners will see it — before anything is issued.
                      navigate(`/admin/aml/passport?case=${caseRow.id}`);
                    } else {
                      /* Both issuance and sharing are in the reliance panel:
                         the roster is the one place that says who holds this
                         Passport and offers every act on it. */
                      document.getElementById("aml-passport-issue")
                        ?.scrollIntoView?.({ block: "start", behavior: "smooth" });
                    }
                  }}
                  onContinue={() => setSection("monitoring")}
                />
              </div>
              {/*
                ── Stage 9 owes no gate act any more ─────────────────────
                It carried a second approval card: two choices, a ten-
                character reason and one button, asking a reviewer to decide
                again what they had just decided on the Decision stage. The
                same `clearanceBlockReasons` had already run — stricter — so
                the second act asked no new question, and its button sat
                disabled behind a grey line of help text while still reading
                "Approve the gate — Approved", so clicking it did nothing at
                all. `aml.service_gate_decisions` held zero rows across the
                entire database.

                A cleared decision now records the gate itself, with the same
                provenance. What is left here is the record and the guided
                path above; every non-approval status — conditions, lock,
                termination — is recorded on the Decision stage's full gate
                card, which is untouched and is still how a live Passport is
                suspended or revoked.
              */}
              {/* The full journey map keeps its place in the product — it
                  sits where the credential is worked on. */}
              <ComplianceJourneyMap caseRow={caseRow} />
              <div id="aml-passport-issue" className="scroll-mt-24">
                <ReliancePassportSection caseId={caseRow.id} isMlro={access.isMlro} />
              </div>
            </div>
          )}

          {/* ── Stage 10 · Partners & ongoing CDD ───────────────────── */}
          {section === "monitoring" && canInvestigate && (
            <div className="space-y-4">
              {/*
                ── The partner card that used to sit here is GONE ────────
                It was a read-only echo of the roster on Passport & Partners
                — the same organisations, no acts, and read through
                `get_passport_distribution_readiness`, which is gated by
                `aml_passport_partner_distribution`. That flag is off on this
                deployment (partners are onboarded one at a time through
                `grant_access`), so the card announced "Passport distribution
                is not enabled for this deployment" on the stage immediately
                after six partners had successfully been given the Passport.

                Partners belong to the stage where the Passport is: you
                cannot share what has not been issued, and the roster there
                carries the acts. This stage is what keeps the case current
                AFTERWARDS, which is a different question on a different
                horizon — years, not days.
              */}
              <MonitoringReviewsSection
                caseId={caseRow.id}
                canWrite={canWrite}
                isReviewer={access.roles.has("reviewer") || access.isMlro}
                onChanged={load}
              />
            </div>
          )}

          {/* ── The record surface ──────────────────────────────────── */}
          {recordMode && (
            <div className="space-y-4">
              {/* The canonical fourteen-step rail, in full. The journey rail
                  is a map over this; this is the territory. */}
              <DetailedProcessRail caseRow={caseRow} />
              <TimelineTab caseId={caseRow.id} events={events} canInvestigate={canInvestigate} />
              <AuditTab events={events} />
            </div>
          )}

          {!recordMode && (
            <AmlJourneyFooter
              stage={activeStage}
              position={walkIndex + 1}
              total={walkable.length}
              previousLabel={previousStage?.shortLabel ?? null}
              nextLabel={nextStage?.shortLabel ?? null}
              onPrevious={() => previousStage && goToStage(previousStage.id)}
              onNext={() => nextStage && goToStage(nextStage.id)}
            />
          )}
        </main>

        <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start" aria-label="Case position and actions">
          <AmlLivePositionRail
            position={position}
            stage={activeStage}
            nextAction={summary.nextAction}
            attention={summary.outstanding}
            riskLabel={caseRow.risk_rating ? caseRow.risk_rating.toUpperCase() : "Unrated"}
            // Stage 1 shows both at full width; anywhere else the rail is
            // the only place they appear.
            showAttention={section !== "overview"}
            showNextAction={section !== "overview"}
            /* So it never offers to take the operator where they already are. */
            currentSection={section}
            /*
             * A path below keeps its own count, in its own units. Two meters
             * on one screen counting different things is worse than either
             * alone — Stage 5's screening path and Stage 9's gate path both
             * own theirs.
             */
            deferReadinessToSurfaceBelow={
              (section === "ownership" && Boolean(screeningStage.sync))
              || section === "passport"
            }
            onOpenSection={setSection}
          />
          {/*
            Renders on a CLOSED case only, and carries one act: the authorised
            reopen. The "Advance status" card that used to sit here on every
            stage is gone — see the component's own header for where each
            state it could reach is set instead.
          */}
          <AmlContextActionPanel
            caseRow={caseRow}
            canWrite={canWrite}
            onReopen={() => void reopenCase()}
          />
        </aside>
      </div>
      {workspaceDialog}
    </div>
  );
}

/** Sub-rail tab treatment, kept out of the JSX for readability. */
function cnStageTab(active: boolean): string {
  return [
    "rounded-md px-3 py-1.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    active
      ? "bg-background font-semibold text-foreground shadow-sm"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  ].join(" ");
}

/* ------------------------------------------------------------------ */
/* Stage 1 — the activation record                                     */
/* ------------------------------------------------------------------ */

const ACTIVATION_TIMING_LABELS: Record<string, string> = {
  post_agreement_trigger: "At service trigger — agreement in place",
  conditional_agreement: "Before service — conditional agreement",
};

const AGREEMENT_STATE_LABELS: Record<string, string> = {
  operative: "Operative",
  conditional_executed: "Conditional (executed)",
  not_executed: "Not executed",
  terminated: "Terminated",
};

function ActivationRecordCard({
  caseRow, activation,
}: { caseRow: AmlCase; activation: any }) {
  /*
   * A case that belongs to nobody must say so before anything else on the
   * page. `aml.cases.client_id` was ON DELETE SET NULL, so deleting a client
   * detached the case rather than failing or cascading — and a detached case
   * renders identically to an ordinary one. An analyst works it, requests
   * documents, and there is no customer at the other end.
   */
  const attribution = readCaseAttribution({
    clientId: caseRow.client_id,
    orphanedClient: (caseRow.metadata as any)?.orphaned_client ?? null,
  });

  return (
    <Card>
      <CardContent className="p-5">
        {attribution.blocking && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            <AlertTitle>{attribution.label}</AlertTitle>
            <AlertDescription className="space-y-1">
              <p>{attribution.detail}</p>
              {attribution.recoveredClientId && (
                <p className="text-xs">
                  Recorded at activation:{" "}
                  <span className="font-mono">{attribution.recoveredClientId}</span>
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Activation record
        </p>
        {activation ? (
          <>
            <dl className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2 xl:grid-cols-4">
              <ActivationField label="Model" value={activation.model ? `Model ${activation.model}` : "—"} />
              <ActivationField label="Trigger" value={activation.event ?? "—"} />
              <ActivationField label="Confirmed by" value={activation.activated_by_email ?? "—"} />
              <ActivationField label="Activated" value={displayDateTime(activation.activated_at)} />
            </dl>
            <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-1.5 text-xs">
              {caseRow.activation_timing && (
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="text-muted-foreground">Timing</dt>
                  <dd>{ACTIVATION_TIMING_LABELS[caseRow.activation_timing] ?? caseRow.activation_timing}</dd>
                </div>
              )}
              {caseRow.agreement_state && (
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="text-muted-foreground">Agreement</dt>
                  <dd>{AGREEMENT_STATE_LABELS[caseRow.agreement_state] ?? caseRow.agreement_state}</dd>
                </div>
              )}
              {activation.program_version && (
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="text-muted-foreground">Program version</dt>
                  <dd className="font-mono">{activation.program_version}</dd>
                </div>
              )}
            </dl>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No activation metadata recorded. This case predates the activation contract; its
            history and evidence are unaffected.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ActivationField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 border-b border-border/40 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm leading-snug">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stage 2 — what the client has been asked for, and where they are    */
/* ------------------------------------------------------------------ */

const CLIENT_PORTAL_LABELS: Record<string, string> = {
  not_started: "Not started",
  action_required: "Action required",
  in_progress: "In progress",
  submitted: "Submitted",
  under_review: "Under review",
  additional_info_required: "Information requested",
  complete: "Complete",
  contact_adviser: "Asked to contact adviser",
};

/**
 * The client's side of the case, in one place: where they are, whether the
 * consents are in, and what we have asked for. Every value is read from the
 * case row, the consent catalogue and the existing client-request records —
 * nothing here is a second store, and nothing here is shown to the client.
 */
function ClientIntakeCard({
  caseRow, consent, requests,
}: {
  caseRow: AmlCase;
  consent: { satisfied: boolean; outstanding: string[] } | null;
  requests: any[];
}) {
  const portal = String(caseRow.client_portal_status ?? "not_started");
  const open = requests.filter((r) => r.status === "open" || r.status === "responded");
  const responded = requests.filter((r) => r.status === "responded");
  const latest = [...requests].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];

  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Client position
        </p>
        <dl className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2 xl:grid-cols-4">
          <ActivationField label="Onboarding" value={CLIENT_PORTAL_LABELS[portal] ?? portal} />
          <ActivationField
            label="Consents"
            value={
              consent === null
                ? "Not available"
                : consent.satisfied
                  ? "Accepted"
                  : `${consent.outstanding.length || "Some"} outstanding`
            }
          />
          <ActivationField
            label="Open requests"
            value={`${open.length}${responded.length > 0 ? ` · ${responded.length} answered` : ""}`}
          />
          <ActivationField
            label="Latest request"
            value={latest ? `${latest.subject ?? "Request"} · ${displayDate(latest.created_at)}` : "None sent"}
          />
        </dl>
        <p className="mt-3 border-t border-border/50 pt-3 text-[11px] leading-relaxed text-muted-foreground">
          The client sees only the plain-English request wording recorded below — never a risk
          rating, a screening reason or an internal note.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Stage 10 — who may receive the Passport, exactly as the server says  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* The canonical fourteen-step process rail (Records → Timeline)       */
/* ------------------------------------------------------------------ */

const RAIL_STATE_META: Record<ProgressRailState, { icon: typeof Circle; className: string; label: string }> = {
  complete: { icon: CheckCircle2, className: "text-success", label: "complete" },
  in_progress: { icon: CircleDot, className: "text-primary", label: "in progress" },
  not_started: { icon: Circle, className: "text-muted-foreground/50", label: "not started" },
  attention_required: { icon: AlertTriangle, className: "text-warning", label: "needs attention" },
  blocked: { icon: Lock, className: "text-destructive", label: "blocked" },
  not_applicable: { icon: Minus, className: "text-muted-foreground/40", label: "not applicable" },
};

/**
 * The detailed rail the header used to carry. Nothing was removed from it:
 * it moved to where an operator goes for the full history, and the header
 * now carries the five-phase reading derived from the same canonical state.
 */
function DetailedProcessRail({ caseRow }: { caseRow: AmlCase }) {
  const rail = progressRail(caseRow);
  const complete = rail.filter((s) => s.state === "complete").length;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-sm">Detailed process</CardTitle>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {complete} of {rail.length} steps complete
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Case process steps">
          {rail.map((step) => {
            const meta = RAIL_STATE_META[step.state];
            const Icon = meta.icon;
            return (
              <li key={step.key} className="flex items-center gap-2 text-xs">
                <Icon aria-hidden className={`h-3.5 w-3.5 shrink-0 ${meta.className}`} />
                <span className={step.state === "not_started" ? "text-muted-foreground/70" : ""}>
                  {step.label}
                </span>
                <span className="sr-only">— {meta.label}</span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}


/**
 * Confirmation, in the command centre, that the client accepted the
 * AUSTRAC-referenced consents — and evidence of which wording they saw.
 * The hash ties each acceptance to the exact document revision presented,
 * so this stands up as evidence even after the catalogue is republished.
 */
function ConsentEvidenceCard({ caseId }: { caseId: string }) {
  const [state, setState] = useState<Awaited<ReturnType<typeof amlCasesApi.consentStatus>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    amlCasesApi.consentStatus(caseId)
      .then(res => { if (alive) setState(res); })
      .catch((e: any) => { if (alive) setError(e?.message ?? "Unable to load consent status."); });
    return () => { alive = false; };
  }, [caseId]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-3">
          <span>Client consents &amp; disclosures</span>
          {state && (
            <Badge variant="outline" className={state.satisfied ? "text-success" : "text-warning"}>
              {state.satisfied ? "Accepted" : "Outstanding"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {error ? (
          <p className="text-muted-foreground">{error}</p>
        ) : !state ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : state.documents.length === 0 ? (
          <p className="text-muted-foreground">
            No consent document set is currently published. The client portal will not collect
            information until one is in force.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Document set version {state.version}
              {state.history.length > 0 && ` · ${state.history.length} superseded acceptance(s) retained`}
            </p>
            <ul className="divide-y divide-border/60">
              {state.documents.map(d => (
                <li key={d.code} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <div>{d.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.acknowledgement_type === "notice" ? "Disclosure — acknowledged as read" : "Consent"}
                      {d.document_hash && ` · evidence ${d.document_hash.slice(0, 12)}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    {d.accepted_at ? (
                      <>
                        <div className="text-success">
                          {displayDateTime(d.accepted_at)}
                        </div>
                        {d.accepted_by && (
                          <div className="text-muted-foreground">{d.accepted_by}</div>
                        )}
                      </>
                    ) : (
                      <span className="text-warning">Not yet accepted</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Documents & Evidence (directive §12.7 — staff review surface)       */
/* ------------------------------------------------------------------ */

function DocumentsEvidenceSection({
  caseId, canWrite, onChanged,
}: { caseId: string; canWrite: boolean; onChanged: () => void }) {
  const [requirements, setRequirements] = useState<any[] | null>(null);
  const [documents, setDocuments] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dupScan, setDupScan] = useState<{
    duplicates: Array<{ reference_id: string; reference_type: string; label: string; case_count: number; client_count: number }>;
    discrepancies_created: number;
  } | null>(null);
  const [evidence, setEvidence] = useState<any[]>([]);
  const { prompt, dialog } = usePromptDialog();

  const refresh = useCallback(async () => {
    const [reqs, docs, ev] = await Promise.all([
      amlCasesApi.listRequirements(caseId).catch(() => ({ requirements: [] })),
      amlCasesApi.listDocuments(caseId).catch(() => ({ documents: [] })),
      amlFinanceApi.listEvidence(caseId).catch(() => ({ evidence: [] })),
    ]);
    setRequirements(reqs.requirements ?? []);
    setDocuments(docs.documents ?? []);
    setEvidence(ev.evidence ?? []);
  }, [caseId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const download = async (documentId: string) => {
    try {
      const { url } = await amlCasesApi.getDocumentDownloadUrl(documentId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast({ title: "Download failed", description: e.message, variant: "destructive" });
    }
  };

  const review = async (documentId: string, decision: "accepted" | "rejected") => {
    let reason: string | undefined;
    if (decision === "rejected") {
      const values = await prompt({
        title: "Reject this document",
        description: "The client sees this wording, so explain plainly what is wrong and what to send instead.",
        confirmLabel: "Reject document",
        destructive: true,
        fields: [{
          name: "reason", label: "Reason shown to the client", type: "textarea",
          required: true, minLength: 10,
          placeholder: "e.g. The bank statement is missing the first page — please upload all pages.",
        }],
      });
      if (!values) return;
      reason = values.reason;
    }
    setBusy(documentId);
    try {
      await amlCasesApi.reviewDocument(documentId, decision, reason);
      toast({ title: decision === "accepted" ? "Document accepted" : "Document rejected" });
      await refresh();
      onChanged();
    } catch (e: any) {
      toast({ title: "Review failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const rename = async (documentId: string, displayName: string) => {
    setBusy(documentId);
    try {
      await amlCasesApi.renameDocument(documentId, displayName);
      await refresh();
      onChanged();
    } catch (e: any) {
      toast({ title: "Could not rename document", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const seed = async () => {
    setBusy("seed");
    try {
      await amlCasesApi.seedDefaultRequirements(caseId);
      await refresh();
      onChanged();
    } catch (e: any) {
      toast({ title: "Could not add requirements", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const scanDuplicates = async () => {
    setBusy("dup-scan");
    try {
      const res = await amlFinanceApi.duplicateDocumentRefs(caseId);
      setDupScan(res);
      if (res.discrepancies_created > 0) onChanged();
      toast({
        title: res.duplicates.length === 0
          ? "No reused documents found"
          : `${res.duplicates.length} reused document reference${res.duplicates.length === 1 ? "" : "s"} found`,
      });
    } catch (e: any) {
      toast({ title: "Scan failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (requirements === null || documents === null) {
    return <AmlLoadingState variant="spinner" label="Loading this section…" />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Document requirements</CardTitle>
            {canWrite && requirements.length === 0 && (
              <Button size="sm" variant="outline" disabled={busy === "seed"} onClick={seed}>
                Add standard requirements
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {requirements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No requirements yet. Add the standard identity and source-of-funds set, then the
              client sees them in their portal checklist.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {requirements.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="truncate">{r.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.required ? "Required" : "Optional"}
                      {r.due_at ? ` · due ${displayDate(r.due_at)}` : ""}
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize">{String(r.status ?? "pending").replace(/_/g, " ")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Documents on file</CardTitle></CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing uploaded yet. Documents the client uploads in their portal appear here for review.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {documents.map((d) => (
                <AmlDocumentRow
                  key={d.id}
                  document={d}
                  canWrite={canWrite}
                  busy={busy === d.id}
                  formatDateTime={displayDateTime}
                  onDownload={download}
                  onReview={review}
                  onRename={rename}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Evidence references</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Documents and records cited as evidence for this case — stored once,
                referenced wherever they support a finding.
              </p>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link to="/admin/aml/finance">Manage</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {evidence.length === 0 ? (
            <p className="text-sm text-muted-foreground">No evidence references recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {evidence.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{e.label}</div>
                    {e.detail && <div className="truncate text-xs text-muted-foreground">{e.detail}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {String(e.reference_type ?? "reference").replace(/_/g, " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {displayDate(e.created_at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canWrite && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-sm">Reused-document check</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Scans evidence references for documents that also appear on other
                  clients' cases. Confirmed reuse is recorded as a discrepancy on every
                  affected case.
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={busy === "dup-scan"} onClick={scanDuplicates}>
                {busy === "dup-scan" && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Run scan
              </Button>
            </div>
          </CardHeader>
          {dupScan && (
            <CardContent>
              {dupScan.duplicates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No document references on this case are shared with other clients.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {dupScan.duplicates.map((d) => (
                    <li key={`${d.reference_type}:${d.reference_id}`} className="rounded-md border border-warning/40 p-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden />
                        <span className="min-w-0 truncate">{d.label || d.reference_id}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Appears on {d.case_count} cases across {d.client_count} different clients.
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {dupScan.discrepancies_created > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {dupScan.discrepancies_created} discrepanc{dupScan.discrepancies_created === 1 ? "y" : "ies"} recorded for follow-up.
                </p>
              )}
            </CardContent>
          )}
        </Card>
      )}
      {dialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Monitoring & Reviews (Phase 10, §12.9 + §18)                        */
/* ------------------------------------------------------------------ */

const TRIGGER_OPTIONS: Array<{ value: AmlReviewTriggerKind; label: string }> = [
  { value: "risk_increase", label: "Risk rating increased" },
  { value: "screening_match", label: "New screening match" },
  { value: "adverse_media", label: "Adverse media identified" },
  { value: "ownership_change", label: "Ownership or control changed" },
  { value: "transaction_change", label: "Material transaction change" },
  { value: "counterparty_uncooperative", label: "Counterparty uncooperative" },
  { value: "client_circumstances", label: "Client circumstances changed" },
  { value: "other", label: "Other trigger" },
];

const REVIEW_CLASSIFICATION_LABELS: Record<string, string> = {
  periodic: "Periodic review",
  trigger_based: "Trigger review",
  pre_commencement: "Pre-commencement review",
};

function MonitoringReviewsSection({
  caseId, canWrite, isReviewer, onChanged,
}: { caseId: string; canWrite: boolean; isReviewer: boolean; onChanged: () => void }) {
  const [monitoring, setMonitoring] = useState<AmlCaseMonitoring | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [triggerKind, setTriggerKind] = useState<AmlReviewTriggerKind>("risk_increase");
  const [triggerDetail, setTriggerDetail] = useState("");
  const [endReason, setEndReason] = useState("");
  const [showEnd, setShowEnd] = useState(false);
  const { prompt, dialog } = usePromptDialog();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { monitoring: m } = await amlMonitoringApi.caseMonitoringSummary(caseId);
      setMonitoring(m);
    } catch {
      setMonitoring(null);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, okTitle: string) => {
    setBusy(key);
    try {
      await fn();
      toast({ title: okTitle });
      await load();
      onChanged();
    } catch (e: any) {
      toast({ title: "Action failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const extendDeadline = async (review: AmlReview) => {
    const values = await prompt({
      title: "Extend review deadline",
      description: "The original deadline is preserved and every extension is counted on the case audit trail.",
      confirmLabel: "Extend deadline",
      fields: [
        { name: "due", label: "New deadline", type: "date", required: true,
          helpText: "Must be later than the current deadline." },
        { name: "reason", label: "Reason for the extension", type: "textarea",
          required: true, minLength: 10,
          placeholder: "Why the review cannot be completed by the current date." },
      ],
    });
    if (!values) return;
    await run(review.id, () => amlMonitoringApi.extendReviewDeadline({
      id: review.id, due_at: new Date(`${values.due}T00:00:00Z`).toISOString(), reason: values.reason,
    }), "Deadline extended");
  };

  if (loading) {
    return <AmlLoadingState variant="spinner" label="Loading this section…" />;
  }
  if (!monitoring) {
    return (
      <Card><CardContent className="py-6 text-sm text-muted-foreground">
        Monitoring information is unavailable for this case.
      </CardContent></Card>
    );
  }

  const ended = monitoring.monitoring_status === "ended";
  const paused = monitoring.monitoring_status === "paused";
  const today = new Date().toISOString();

  return (
    <div className="space-y-4">
      <Card className={ended ? "border-muted-foreground/40" : undefined}>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Ongoing monitoring</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Customer due diligence continues for as long as the business relationship lasts.
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                ended ? "border-muted-foreground/40 text-muted-foreground"
                : paused ? "border-warning/40 text-warning"
                : "border-success/40 text-success"
              }
            >
              {ended ? "Relationship ended" : paused ? "Paused" : "Active"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {ended ? (
            <>
              <Row k="Ended" v={monitoring.relationship_ended_at ? displayDate(monitoring.relationship_ended_at) : "—"} />
              {monitoring.relationship_end_reason && (
                <div className="rounded bg-muted/40 p-2 text-xs">{monitoring.relationship_end_reason}</div>
              )}
              <p className="text-xs text-muted-foreground">
                Scheduled reviews are closed and no new monitoring work will be raised.
                The full history and evidence remain on the case and stay subject to retention rules.
              </p>
            </>
          ) : (
            <>
              {/* One implementation of the cycle's wording, shared with the
                  server that schedules it — so the card and the audit event
                  cannot describe the same cycle differently. */}
              <Row
                k="Review cycle"
                v={reviewCycleLabel({
                  months: monitoring.review_interval_months,
                  rating: monitoring.risk_rating ?? "unrated",
                  clamped: false,
                  configuredMonths: null,
                })}
              />
              <Row
                k="Next periodic review"
                v={
                  monitoring.next_periodic_review_at
                    ? <span className={monitoring.next_periodic_review_at < today ? "text-warning" : ""}>
                        {displayDate(monitoring.next_periodic_review_at)}
                        {monitoring.next_periodic_review_at < today ? " · due" : ""}
                      </span>
                    : <span className="text-muted-foreground">Not scheduled</span>
                }
              />
              <Row k="Last review" v={monitoring.last_periodic_review_at ? displayDate(monitoring.last_periodic_review_at) : "—"} />
              <Row
                k="Screening refresh"
                v={
                  monitoring.rescreen_due_at
                    ? <span className={monitoring.rescreen_overdue ? "text-warning" : ""}>
                        {monitoring.rescreen_overdue ? "Overdue since " : "Due "}
                        {displayDate(monitoring.rescreen_due_at)}
                      </span>
                    : <span className="text-muted-foreground">No screening on record</span>
                }
              />
              {paused && monitoring.monitoring_status_reason && (
                <div className="rounded bg-muted/40 p-2 text-xs">Paused: {monitoring.monitoring_status_reason}</div>
              )}
              {canWrite && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {!monitoring.next_periodic_review_at && (
                    <Button size="sm" variant="outline" disabled={busy === "schedule"}
                      onClick={() => run("schedule", () => amlMonitoringApi.schedulePeriodicReview({ case_id: caseId }), "Periodic review scheduled")}>
                      Schedule periodic review
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy === "pause"}
                    onClick={async () => {
                      const values = await prompt({
                        title: paused ? "Resume ongoing monitoring" : "Pause ongoing monitoring",
                        description: paused
                          ? "Scheduled reviews and monitoring alerts start again for this case."
                          : "Scheduled reviews stay in place but no new monitoring work is raised until you resume.",
                        confirmLabel: paused ? "Resume monitoring" : "Pause monitoring",
                        fields: [{
                          name: "reason", label: "Reason", type: "textarea",
                          required: true, minLength: 10,
                          placeholder: paused ? "Why monitoring is resuming." : "Why monitoring is being paused.",
                        }],
                      });
                      if (!values) return;
                      void run("pause", () => amlMonitoringApi.setMonitoringStatus({
                        case_id: caseId, status: paused ? "active" : "paused", reason: values.reason,
                      }), paused ? "Monitoring resumed" : "Monitoring paused");
                    }}>
                    {paused ? "Resume monitoring" : "Pause monitoring"}
                  </Button>
                  {isReviewer && (
                    <Button size="sm" variant="ghost" onClick={() => setShowEnd((v) => !v)}>
                      Record relationship end
                    </Button>
                  )}
                </div>
              )}
              {showEnd && isReviewer && (
                <div className="space-y-2 rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">
                    Recording the end of the business relationship closes ongoing due diligence and
                    starts the records-retention clock. History is preserved. Outstanding enhanced
                    due diligence or alerts must be resolved first.
                  </p>
                  <Textarea
                    rows={2}
                    aria-label="Reason for ending the relationship"
                    placeholder="Reason (required, minimum 10 characters)…"
                    value={endReason}
                    onChange={(e) => setEndReason(e.target.value)}
                  />
                  <Button size="sm" variant="outline" disabled={busy === "end" || endReason.trim().length < 10}
                    onClick={() => run("end", async () => {
                      await amlMonitoringApi.endRelationship({ case_id: caseId, reason: endReason.trim() });
                      setEndReason(""); setShowEnd(false);
                    }, "Relationship end recorded")}>
                    Confirm relationship end
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">
              Reviews
              {monitoring.overdue_review_count > 0 && (
                <span className="ml-2 text-xs font-normal text-warning">
                  {monitoring.overdue_review_count} overdue
                </span>
              )}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {monitoring.open_reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews are currently open.</p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {monitoring.open_reviews.map((r) => {
                const overdue = Boolean(r.due_at && r.due_at < today);
                return (
                  <li key={r.id} className="space-y-1 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate">
                          {REVIEW_CLASSIFICATION_LABELS[r.classification] ?? r.classification}
                          {r.trigger_kind && (
                            <span className="text-muted-foreground">
                              {" "}· {TRIGGER_OPTIONS.find((t) => t.value === r.trigger_kind)?.label ?? r.trigger_kind}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {r.due_at ? `Due ${displayDate(r.due_at)}` : "No deadline"}
                          {overdue ? " · overdue" : ""}
                          {r.extension_count ? ` · extended ${r.extension_count}×` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={overdue ? "border-warning/40 text-warning" : "capitalize"}>
                          {String(r.status).replace(/_/g, " ")}
                        </Badge>
                        {canWrite && (
                          <>
                            {!r.assigned_to && (
                              <Button size="sm" variant="ghost" disabled={busy === r.id}
                                onClick={() => run(r.id, () => amlMonitoringApi.assignReview({ id: r.id }), "Review assigned to you")}>
                                Take
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => extendDeadline(r)}>
                              Extend
                            </Button>
                            <Button size="sm" variant="outline" disabled={busy === r.id}
                              onClick={async () => {
                                const values = await prompt({
                                  title: "Complete this review",
                                  description: "Completing a periodic review books the next one from the case's current risk rating.",
                                  confirmLabel: "Complete review",
                                  fields: [{
                                    name: "notes", label: "Outcome notes", type: "textarea",
                                    placeholder: "What was checked and what you concluded (optional).",
                                  }],
                                });
                                if (!values) return;
                                void run(r.id, () => amlMonitoringApi.completeReview(r.id, "no_change", "complete", values.notes || undefined), "Review completed");
                              }}>
                              Complete
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {r.extension_reason && (
                      <p className="text-xs text-muted-foreground">Extension reason: {r.extension_reason}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {canWrite && !ended && (
            <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Raise a trigger review</div>
              <div className="grid gap-2 sm:grid-cols-[240px_1fr]">
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  aria-label="Trigger type"
                  value={triggerKind}
                  onChange={(e) => setTriggerKind(e.target.value as AmlReviewTriggerKind)}
                >
                  {TRIGGER_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <Button
                  size="sm" variant="outline" className="sm:justify-self-start"
                  disabled={busy === "trigger" || triggerDetail.trim().length < 10}
                  onClick={() => run("trigger", async () => {
                    await amlMonitoringApi.recordTriggerReview({
                      case_id: caseId, trigger_kind: triggerKind, detail: triggerDetail.trim(),
                    });
                    setTriggerDetail("");
                  }, "Trigger review raised")}
                >
                  Raise review
                </Button>
              </div>
              <Textarea
                rows={2}
                aria-label="Trigger detail"
                placeholder="What changed and why it needs review (required, minimum 10 characters)…"
                value={triggerDetail}
                onChange={(e) => setTriggerDetail(e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {(monitoring.open_alerts.length > 0 || monitoring.open_edd.length > 0) && (
        <Card className="border-warning/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" /> Open monitoring work
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {monitoring.open_alerts.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">Alerts</div>
                <ul className="mt-1 space-y-1 text-xs">
                  {monitoring.open_alerts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{a.title}</span>
                      <Badge variant="outline" className="capitalize">{a.severity}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {monitoring.open_edd.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground">Enhanced due diligence</div>
                <ul className="mt-1 space-y-1 text-xs">
                  {monitoring.open_edd.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{e.reason}</span>
                      <Badge variant="outline" className="capitalize">{String(e.status).replace(/_/g, " ")}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Alerts and EDD are worked on the Monitoring page; decisions there write back to this case's audit trail.
            </p>
          </CardContent>
        </Card>
      )}
      {dialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Purchase & Counterparty (Phase 9, §12.5)                            */
/* ------------------------------------------------------------------ */

function PurchaseCounterpartySection({ caseRow, canWrite }: { caseRow: AmlCase; canWrite: boolean }) {
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<AmlTransaction[]>([]);
  const [cpCases, setCpCases] = useState<AmlCounterpartyCase[]>([]);
  const [cpRequests, setCpRequests] = useState<any[]>([]);
  const [obligations, setObligations] = useState<any[]>([]);
  const [cddSummary, setCddSummary] = useState<AmlCounterpartyCddSummary | null>(null);
  const [settlementGate, setSettlementGate] = useState<AmlSettlementGateStatus | null>(null);
  const [busyCp, setBusyCp] = useState<string | null>(null);
  const { prompt, dialog } = usePromptDialog();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [tx, cp, req, ob, sum] = await Promise.all([
        amlTransactionsApi.listTransactions(caseRow.id).catch(() => ({ transactions: [] })),
        amlTransactionsApi.listCpCases(caseRow.id).catch(() => ({ counterparty_cases: [] })),
        amlTransactionsApi.listCpRequests({ case_id: caseRow.id }).catch(() => ({ requests: [] })),
        amlTransactionsApi.listObligations({ case_id: caseRow.id }).catch(() => ({ obligations: [] })),
        amlTransactionsApi.counterpartyCddSummary(caseRow.id).catch(() => ({ summary: null as any })),
      ]);
      setTransactions(tx.transactions ?? []);
      setCpCases(cp.counterparty_cases ?? []);
      setCpRequests(req.requests ?? []);
      setObligations(ob.obligations ?? []);
      setCddSummary(sum.summary ?? null);
      if (caseRow.purchase_file_id) {
        const gate = await amlTransactionsApi.settlementGateStatus(caseRow.purchase_file_id).catch(() => null);
        setSettlementGate(gate);
      }
    } finally {
      setLoading(false);
    }
  }, [caseRow.id, caseRow.purchase_file_id]);

  useEffect(() => { void load(); }, [load]);

  const setDelayedCdd = async (cp: AmlCounterpartyCase) => {
    const values = await prompt({
      title: `Delay CDD for ${cp.subject_display_name}`,
      description: "Record when the outstanding due diligence must be completed and why the delay is justified.",
      confirmLabel: "Record delayed CDD",
      fields: [
        { name: "deadline", label: "Completion deadline", type: "date", required: true },
        { name: "justification", label: "Justification", type: "textarea",
          required: true, minLength: 10,
          placeholder: "Why the checks cannot be completed before proceeding." },
      ],
    });
    if (!values) return;
    setBusyCp(cp.id);
    try {
      await amlTransactionsApi.setDelayedCdd({ id: cp.id, deadline: values.deadline, justification: values.justification });
      toast({ title: "Delayed CDD recorded" });
      await load();
    } catch (e: any) {
      toast({ title: "Could not record delayed CDD", description: e.message, variant: "destructive" });
    } finally {
      setBusyCp(null);
    }
  };

  const markUncooperative = async (cp: AmlCounterpartyCase) => {
    const values = await prompt({
      title: `Mark ${cp.subject_display_name} uncooperative`,
      description: "This escalates the counterparty record. At least two contact attempts must already be recorded as evidence of reasonable steps.",
      confirmLabel: "Mark uncooperative",
      destructive: true,
      fields: [{
        name: "reason", label: "Reason", type: "textarea",
        required: true, minLength: 10,
        placeholder: "What was asked for, when, and how the counterparty responded.",
      }],
    });
    if (!values) return;
    setBusyCp(cp.id);
    try {
      await amlTransactionsApi.markUncooperative({ id: cp.id, reason: values.reason });
      toast({ title: "Counterparty marked uncooperative", description: "The case has been escalated for review." });
      await load();
    } catch (e: any) {
      toast({ title: "Could not mark uncooperative", description: e.message, variant: "destructive" });
    } finally {
      setBusyCp(null);
    }
  };

  const openObligations = obligations.filter((o) => ["pending", "acknowledged"].includes(o.status));
  const openCpRequests = cpRequests.filter((r) => ["pending", "sent", "awaiting_response"].includes(r.status));
  const today = new Date().toISOString().slice(0, 10);

  if (loading) {
    return <AmlLoadingState variant="spinner" label="Loading this section…" />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm">Purchase & Counterparty</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                The property transaction, its sellers and counterparties, and the due-diligence
                record for each — scoped to this case.
              </p>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link to="/admin/aml/transactions">Full register</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row
            k="Purchase file"
            v={caseRow.purchase_file_id ? "Linked" : <span className="text-muted-foreground">Not linked</span>}
          />
          {settlementGate && (
            <Row
              k="Settlement gate"
              v={
                !settlementGate.gate_enabled ? "Not enforced"
                : settlementGate.blocked
                  ? <span className="text-destructive">Blocked ({settlementGate.reasons.length} reason{settlementGate.reasons.length === 1 ? "" : "s"})</span>
                  : <span className="text-success">Clear to settle</span>
              }
            />
          )}
          {cddSummary && (
            <Row
              k="Counterparty CDD"
              v={
                cddSummary.counterparty_cases_total === 0
                  ? "No counterparties recorded"
                  : cddSummary.all_cleared
                    ? `All ${cddSummary.counterparty_cases_total} cleared`
                    : `${cddSummary.counterparty_cases_open} open · ${cddSummary.requests_overdue} overdue request${cddSummary.requests_overdue === 1 ? "" : "s"}`
              }
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Transactions</CardTitle></CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No transaction recorded yet. Transactions capture the contract, price and
              settlement details and drive threshold obligations.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {transactions.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="truncate">{t.property_address ?? t.reference ?? t.kind}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.settlement_date ? `Settles ${displayDate(t.settlement_date)}` : "No settlement date"}
                      {t.original_settlement_date && t.settlement_date !== t.original_settlement_date &&
                        ` (moved from ${displayDate(t.original_settlement_date)})`}
                      {t.purchase_price ? ` · ${Number(t.purchase_price).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ""}
                    </div>
                  </div>
                  <Badge variant="outline" className="capitalize">{String(t.status).replace(/_/g, " ")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Seller & counterparty due diligence</CardTitle></CardHeader>
        <CardContent>
          {cpCases.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No counterparty records yet. Add sellers, seller entities and their
              representatives on the full register.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {cpCases.map((cp) => (
                <li key={cp.id} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="truncate">{cp.subject_display_name}</span>
                      {cp.uncooperative && (
                        <Badge variant="outline" className="h-5 border-destructive/50 px-1.5 text-[10px] text-destructive">
                          Uncooperative
                        </Badge>
                      )}
                      {cp.delayed_cdd_deadline && (
                        <Badge
                          variant="outline"
                          className={`h-5 px-1.5 text-[10px] ${cp.delayed_cdd_deadline < today ? "border-destructive/50 text-destructive" : "border-warning/50 text-warning"}`}
                        >
                          Delayed CDD {cp.delayed_cdd_deadline < today ? "overdue" : `due ${displayDate(cp.delayed_cdd_deadline)}`}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">{String(cp.status).replace(/_/g, " ")}</Badge>
                      {canWrite && !cp.delayed_cdd_deadline && (
                        <Button size="sm" variant="ghost" disabled={busyCp === cp.id} onClick={() => setDelayedCdd(cp)}>
                          Delay CDD
                        </Button>
                      )}
                      {canWrite && !cp.uncooperative && (
                        <Button size="sm" variant="ghost" disabled={busyCp === cp.id} onClick={() => markUncooperative(cp)}>
                          Mark uncooperative
                        </Button>
                      )}
                    </div>
                  </div>
                  {cp.uncooperative_reason && (
                    <p className="text-xs text-muted-foreground">Uncooperative: {cp.uncooperative_reason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {openCpRequests.length > 0 && (
            <p className="mt-3 border-t border-border/60 pt-2 text-xs text-muted-foreground">
              {openCpRequests.length} open information request{openCpRequests.length === 1 ? "" : "s"} to counterparties
              {cddSummary && cddSummary.requests_overdue > 0 && `, ${cddSummary.requests_overdue} past due`}.
            </p>
          )}
        </CardContent>
      </Card>

      {openObligations.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" /> Reporting obligations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {openObligations.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2">
                  <span className="uppercase">{String(o.kind).replace(/_/g, " ")}</span>
                  <Badge variant="outline" className="capitalize">{String(o.status).replace(/_/g, " ")}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Obligations resolve on the Transactions register — reports require submission evidence.
            </p>
          </CardContent>
        </Card>
      )}
      {dialog}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Requests (client-safe further-information requests, §14.5)          */
/* ------------------------------------------------------------------ */

function RequestsSection({
  caseId, requests, canWrite, onChanged,
}: { caseId: string; requests: any[]; canWrite: boolean; onChanged: () => void }) {
  const [kind, setKind] = useState<"additional_info" | "new_document" | "clarification" | "re_consent">("additional_info");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await amlCasesApi.createClientRequest({ case_id: caseId, kind, subject, message });
      toast({ title: "Request sent to client" });
      setSubject(""); setMessage("");
      onChanged();
    } catch (e: any) {
      toast({ title: "Could not send request", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (id: string) => {
    try {
      await amlCasesApi.resolveClientRequest(id);
      onChanged();
    } catch (e: any) {
      toast({ title: "Could not resolve request", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      {canWrite && (
        // The id is what Stage 2's primary action focuses. Without it that
        // button navigated to a section the operator was already on.
        <Card id="aml-client-request" className="scroll-mt-24">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Ask the client for something</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger aria-label="Request type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="additional_info">Additional information</SelectItem>
                  <SelectItem value="new_document">New document</SelectItem>
                  <SelectItem value="clarification">Clarification</SelectItem>
                  <SelectItem value="re_consent">Re-consent</SelectItem>
                </SelectContent>
              </Select>
              <Input
                aria-label="Request subject"
                placeholder="Subject…"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <Textarea
              aria-label="Message shown to the client"
              placeholder="Plain-English explanation the client will see. Do not include internal reasoning…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <Button size="sm" disabled={busy || !subject.trim() || !message.trim()} onClick={send}>
              Send request
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Requests</CardTitle></CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No requests yet. Requests you send appear in the client's portal with your
              explanation, and their responses land back here.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {requests.map((r) => (
                <li key={r.id} className="space-y-1 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate font-medium">{r.subject}</div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">{String(r.status).replace(/_/g, " ")}</Badge>
                      {canWrite && (r.status === "open" || r.status === "responded") && (
                        <Button size="sm" variant="ghost" onClick={() => resolve(r.id)}>Resolve</Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{r.message}</p>
                  {r.response_payload && Object.keys(r.response_payload).length > 0 && (
                    <p className="text-xs">
                      <span className="text-muted-foreground">Client response: </span>
                      {typeof r.response_payload === "object"
                        ? r.response_payload.text ?? JSON.stringify(r.response_payload)
                        : String(r.response_payload)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
