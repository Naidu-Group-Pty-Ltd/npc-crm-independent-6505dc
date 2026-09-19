/**
 * Phase 4 — Case-centred Customer Compliance register.
 *
 * All KYC surfaces (Verification, Screening, Risk) collapse into tabs
 * scoped to a single case_id. Legacy top-nav pages are preserved as
 * alias routes; this component is the new default entry point.
 *
 * Guardrails (AGENTS.md §2):
 *   - Restricted counts / previews never rendered outside authorised
 *     capabilities; write actions gated by `canWrite`.
 *   - No new data model — reuses existing amlVerificationApi / amlRiskApi.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FundingEvidencePanel } from "@/components/aml/FundingEvidencePanel";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, ShieldCheck, ScanSearch, Gauge, ClipboardList, Play,
  Network, Wallet, ExternalLink, AlertTriangle, History,
  Scale, CircleDot, CheckCircle2, Lock, ShieldQuestion,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  amlVerificationApi, type IdentityCheck, type ScreeningCheck, type ProviderReadiness,
} from "@/lib/aml/amlVerificationApi";
// (IdentityCheck / ScreeningCheck also power the Phase 6 verification linking)
import {
  amlRiskApi, type AmlRiskAssessment, type AmlCaseCondition, type AmlDecision,
  type AmlAnalystRecommendation, type AmlServiceGateContract, type AmlRecalcStatus,
} from "@/lib/aml/amlRiskApi";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { decisionPath, reasonHint } from "@/lib/aml/decisionPath.pure";
import { describeClearanceReason } from "@/lib/aml/clearanceReasons.pure";
import { DECISION_CHOICES, RECOMMENDATION_CHOICES } from "@/lib/aml/gateOptions.pure";
import { DecisionPathCard } from "@/components/aml/workspace/DecisionPathCard";
import { ServiceGateCard } from "@/components/aml/ServiceGateCard";
import { amlFinanceApi, type AmlFinanceComparison, type AmlFinanceDiscrepancy, type AmlFinanceRequest } from "@/lib/aml/amlFinanceApi";
import {
  amlEntitiesApi, type AmlEntity, type AmlBeneficialOwner, type AmlAuthorisedRep,
  type AmlOwnershipSummary, type AmlProvenanceRow, type AmlQuestionnaireImportReport,
} from "@/lib/aml/amlEntitiesApi";
import { amlCasesApi, type AmlCase, type AmlCaseEvent } from "@/lib/aml/amlCasesApi";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { VerificationSection } from "@/components/aml/VerificationSection";
import { LegacyVerificationHistoryPanel } from "@/components/aml/LegacyVerificationHistoryPanel";
import {
  CASE_STAGE_LABELS, CASE_STATUS_LABELS, CLIENT_PORTAL_STATUS_LABELS,
  FINANCE_PORTAL_STATUS_LABELS, RISK_BADGE_CLASSES, SERVICE_GATE_LABELS,
  caseStage, clientPortalStatus, financePortalStatus, serviceGateStatus,
} from "@/lib/aml/caseDimensions";
import { smartCapitalize } from "@/lib/nameUtils";
import { displayDateTime } from "@/lib/aml/displayDate";
import { cn } from "@/lib/utils";

interface Props {
  caseRow: AmlCase;
  events: AmlCaseEvent[];
  canWrite: boolean;
  canInvestigate: boolean;
  onChanged: () => void;
  initialTab?: string;
  /**
   * Workspace-dialog mode: the Tabs shell stretches to fill its flex parent,
   * the tab bar stays fixed and each active tab body becomes the scroll
   * region — the persistent-header/persistent-nav contract of the centred
   * case workspace. Default (page embeds) is the original in-flow layout.
   */
  fillHeight?: boolean;
}

const KNOWN_TABS = new Set([
  "overview", "verification", "screening", "risk",
  "ownership", "finance", "timeline", "audit",
]);

/**
 * Shared trigger treatment: roomy touch target, never-wrapping label, and a
 * selected state that is unmistakable. The glass tab rail already gives the
 * active trigger a raised surface and a brand-coloured edge; the extra
 * weight here means the selection survives a glance at the label alone.
 */
const TAB_TRIGGER_CLS =
  "min-h-9 shrink-0 whitespace-nowrap px-3 data-[state=active]:font-semibold";

export function CaseWorkspaceTabs({
  caseRow, events, canWrite, canInvestigate, onChanged, initialTab, fillHeight,
}: Props) {
  const { caseWorkspace: v3Case } = useAmlV3Flags();
  const safeInitial = initialTab && KNOWN_TABS.has(initialTab) ? initialTab : "overview";
  // Controlled so the Overview dashboard can deep-link into Audit, and so a
  // case refresh never resets the operator's selected tab.
  const [tab, setTab] = useState(safeInitial);
  const contentCls = cn(
    "mt-4",
    fillHeight && "mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-4",
  );
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className={cn("w-full", fillHeight && "flex min-h-0 flex-1 flex-col")}
    >

      <TabsList
        aria-label="Case sections"
        // `sm:justify-start` as well as `justify-start`: the shared rail
        // centres itself from `sm` up, which left the workflow floating in
        // the middle of a 1240px workspace instead of reading left to right.
        className="h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto p-1 sm:justify-start"
      >
        <TabsTrigger value="overview" className={TAB_TRIGGER_CLS}>
          <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Overview
        </TabsTrigger>
        <TabsTrigger value="verification" className={TAB_TRIGGER_CLS}>
          <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Verification
        </TabsTrigger>
        <TabsTrigger value="screening" className={TAB_TRIGGER_CLS}>
          <ScanSearch className="h-3.5 w-3.5 mr-1.5" /> Screening
        </TabsTrigger>
        <TabsTrigger value="risk" className={TAB_TRIGGER_CLS}>
          <Gauge className="h-3.5 w-3.5 mr-1.5" /> Risk & Decision
        </TabsTrigger>
        {v3Case && (
          <TabsTrigger value="ownership" className={TAB_TRIGGER_CLS}>
            <Network className="h-3.5 w-3.5 mr-1.5" /> Ownership & Control
          </TabsTrigger>
        )}
        {v3Case && canInvestigate && (
          <TabsTrigger value="finance" className={TAB_TRIGGER_CLS}>
            <Wallet className="h-3.5 w-3.5 mr-1.5" /> Funding & Finance
          </TabsTrigger>
        )}
        {v3Case && (
          <TabsTrigger value="timeline" className={TAB_TRIGGER_CLS}>
            <History className="h-3.5 w-3.5 mr-1.5" /> Timeline
          </TabsTrigger>
        )}
        <TabsTrigger value="audit" className={TAB_TRIGGER_CLS}>
          <Scale className="h-3.5 w-3.5 mr-1.5" /> Audit
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className={contentCls}>
        <OverviewTab caseRow={caseRow} events={events} onOpenAudit={() => setTab("audit")} />
      </TabsContent>
      <TabsContent value="verification" className={contentCls}>
        {/* ONE canonical identity-verification surface, matching the case
            page. This tab used to mount the legacy `VerificationTab`, which
            read aml.identity_checks and disabled "Request identity
            verification" whenever the electronic provider was not
            ready_live — leaving staff unable to start verification in
            exactly the case where the manual route is the only option. */}
        <div className="space-y-4">
          <VerificationSection caseId={caseRow.id} canWrite={canWrite} onChanged={onChanged} />
          <LegacyVerificationHistoryPanel caseId={caseRow.id} />
        </div>
      </TabsContent>
      <TabsContent value="screening" className={contentCls}>
        <ScreeningTab caseId={caseRow.id} canWrite={canInvestigate} onChanged={onChanged} />
      </TabsContent>
      <TabsContent value="risk" className={contentCls}>
        <RiskTab caseId={caseRow.id} canWrite={canWrite} onChanged={onChanged} />
      </TabsContent>
      {v3Case && (
        <TabsContent value="ownership" className={contentCls}>
          <OwnershipControlTab caseRow={caseRow} canWrite={canInvestigate} />
        </TabsContent>
      )}
      {v3Case && canInvestigate && (
        <TabsContent value="finance" className={contentCls}>
          <FundingFinanceTab caseId={caseRow.id} />
        </TabsContent>
      )}
      {v3Case && (
        <TabsContent value="timeline" className={contentCls}>
          <TimelineTab caseId={caseRow.id} events={events} canInvestigate={canInvestigate} />
        </TabsContent>
      )}
      <TabsContent value="audit" className={contentCls}>
        <AuditTab events={events} />
      </TabsContent>
    </Tabs>
  );
}

/* -------------------- Overview -------------------- */

const OVERVIEW_SUBJECT_TYPE_LABELS: Record<string, string> = {
  individual: "Individual", entity: "Entity / company", trust: "Trust",
};

const ACTIVATION_TIMING_LABELS: Record<string, string> = {
  post_agreement_trigger: "At service trigger — agreement in place",
  conditional_agreement: "Before service — conditional agreement",
};

const AGREEMENT_STATE_LABELS: Record<string, string> = {
  operative: "Operative",
  conditional_executed: "Conditional (executed)",
};

/**
 * Overview — an operational read of the case rather than a flat label/value
 * list. The order answers an operator's questions in the order they ask
 * them: where is this case and what is holding it up, then who the case is
 * for, then how it was activated, then what happened recently.
 *
 * ── Presentation only ─────────────────────────────────────────────────
 * Every value below is the same value this tab has always shown, read
 * through the same `caseDimensions` helpers. Nothing is inferred, no
 * status is combined with another, and the service gate keeps exactly the
 * tone mapping it already had (positive only when approved, destructive
 * only when locked or terminated). The hierarchy is carried by type,
 * spacing and grouping instead of by giving every field its own border.
 */
function OverviewTab({
  caseRow, events, onOpenAudit,
}: { caseRow: AmlCase; events: AmlCaseEvent[]; onOpenAudit?: () => void }) {
  const activation = (caseRow as any)?.metadata?.activation;
  const stage = caseStage(caseRow);
  const gate = serviceGateStatus(caseRow);
  const portal = clientPortalStatus(caseRow);
  const finance = financePortalStatus(caseRow);
  const recent = events.slice(0, 4);

  // The existing gate treatment, unchanged: only an approved gate reads
  // positive and only a locked/terminated one reads destructive. The icon
  // is a second, non-colour cue for the same three cases.
  const gateApproved = ["approved", "approved_with_controls"].includes(gate);
  const gateStopped = ["locked", "terminated"].includes(gate);
  const GateIcon = gateApproved ? CheckCircle2 : gateStopped ? Lock : ShieldQuestion;
  const gateTone = gateApproved ? "text-success" : gateStopped ? "text-destructive" : undefined;

  const secondaryActivation = activation
    ? [
        caseRow.activation_timing && {
          label: "Activation timing",
          value: ACTIVATION_TIMING_LABELS[caseRow.activation_timing] ?? caseRow.activation_timing,
        },
        caseRow.agreement_state && {
          label: "Agreement state",
          value: AGREEMENT_STATE_LABELS[caseRow.agreement_state] ?? caseRow.agreement_state,
        },
        activation.program_version && {
          label: "Program version", value: activation.program_version, mono: true,
        },
      ].filter(Boolean) as Array<{ label: string; value: string; mono?: boolean }>
    : [];

  return (
    <div className="space-y-7">
      {/* 1 — Where the case is, and whether the service may proceed.
             Promoted above the identifying detail because it is the
             question an operator opens the case to answer. */}
      <section aria-label="Progress and readiness" className="space-y-2.5">
        <OverviewSectionHeading>Progress &amp; readiness</OverviewSectionHeading>
        <div className="rounded-xl border border-border/60 bg-muted/15">
          <dl className="grid gap-x-8 gap-y-4 p-4 sm:grid-cols-3">
            <ProgressField label="Case stage" value={CASE_STAGE_LABELS[stage]} />
            <ProgressField label="Client onboarding" value={CLIENT_PORTAL_STATUS_LABELS[portal]} />
            <ProgressField label="Finance portal" value={FINANCE_PORTAL_STATUS_LABELS[finance]} />
          </dl>
          {/* The service gate is the conclusion the three readings above
              feed into, so it sits apart from them rather than beside
              them as a fourth equal tile. */}
          <div className="flex items-start gap-2.5 border-t border-border/50 px-4 py-3">
            <GateIcon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", gateTone ?? "text-muted-foreground")} />
            <dl className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Service gate
              </dt>
              <dd className={cn("mt-0.5 text-sm font-semibold leading-snug", gateTone)}>
                {SERVICE_GATE_LABELS[gate]}
              </dd>
            </dl>
          </div>
        </div>
      </section>

      {/* 2 — Who the case is for. A definition grid, not nine cards. */}
      <section aria-label="Case summary" className="space-y-2.5">
        <OverviewSectionHeading>Case summary</OverviewSectionHeading>
        <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 xl:grid-cols-4">
          <InfoCell label="Reference" value={caseRow.case_reference} mono />
          <InfoCell label="Subject" value={smartCapitalize(caseRow.subject_display_name)} />
          <InfoCell
            label="Subject type"
            value={OVERVIEW_SUBJECT_TYPE_LABELS[caseRow.subject_type] ?? caseRow.subject_type}
          />
          <InfoCell label="Status" value={CASE_STATUS_LABELS[caseRow.status] ?? caseRow.status} />
          <InfoCell
            label="Risk rating"
            value={caseRow.risk_rating ? (
              <Badge variant="outline" className={RISK_BADGE_CLASSES[caseRow.risk_rating]}>
                {caseRow.risk_rating.toUpperCase()}
              </Badge>
            ) : (
              <span className="text-muted-foreground">Unrated</span>
            )}
          />
          <InfoCell label="Opened" value={displayDateTime(caseRow.opened_at)} />
          <InfoCell label="Last updated" value={displayDateTime(caseRow.updated_at)} />
          {caseRow.assigned_analyst_id && (
            <InfoCell label="Assigned analyst" value={caseRow.assigned_analyst_id} mono truncate />
          )}
          {caseRow.assigned_mlro_id && (
            <InfoCell label="Assigned MLRO" value={caseRow.assigned_mlro_id} mono truncate />
          )}
        </dl>
      </section>

      {/* 3 — Activation record: the four facts that identify the
             activation, then the policy detail behind them. */}
      <section aria-label="Activation" className="space-y-2.5">
        <OverviewSectionHeading>Activation</OverviewSectionHeading>
        {activation ? (
          <div className="space-y-3">
            <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 xl:grid-cols-4">
              <InfoCell label="Activation model" value={`Model ${activation.model}`} />
              <InfoCell label="Activation event" value={activation.event ?? "—"} />
              <InfoCell label="Confirmed by" value={activation.activated_by_email ?? "—"} truncate />
              <InfoCell label="Activated at" value={displayDateTime(activation.activated_at)} />
            </dl>
            {secondaryActivation.length > 0 && (
              <dl className="flex flex-wrap gap-x-8 gap-y-1.5 text-xs">
                {secondaryActivation.map((item) => (
                  <div key={item.label} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd className={cn("min-w-0 break-words", item.mono && "font-mono")}>
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No activation metadata recorded (legacy case).
          </p>
        )}
      </section>

      {/* 4 — Recent activity, from the already-loaded events (no extra
             fetch). The description leads; when and what kind support it. */}
      <section aria-label="Recent activity" className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <OverviewSectionHeading>Recent activity</OverviewSectionHeading>
          {onOpenAudit && events.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onOpenAudit}>
              View full audit trail
            </Button>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded yet.</p>
        ) : (
          <ol className="divide-y divide-border/40 border-y border-border/40">
            {recent.map((ev) => (
              <li key={ev.id} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
                <time
                  dateTime={ev.created_at}
                  className="shrink-0 text-xs tabular-nums text-muted-foreground sm:w-44"
                >
                  {displayDateTime(ev.created_at)}
                </time>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm leading-snug">{ev.summary}</p>
                  <p className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    {ev.category.replace(/_/g, " ")}
                    {ev.actor_label ? ` · ${ev.actor_label}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** Section title for the Overview. Compact, quiet, and the same on each. */
function OverviewSectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </h3>
  );
}

/** One reading inside the grouped Progress & readiness panel. */
function ProgressField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm leading-snug">{value}</dd>
    </div>
  );
}

/**
 * One field of an Overview definition grid. Deliberately borderless: the
 * grid gets its structure from a single hairline under each field and from
 * column alignment, so eight facts read as one table rather than as eight
 * boxes.
 */
function InfoCell({
  label, value, mono, truncate,
}: { label: string; value: React.ReactNode; mono?: boolean; truncate?: boolean }) {
  return (
    <div className="min-w-0 border-b border-border/40 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-sm leading-snug",
          mono && "font-mono text-[13px]",
          truncate ? "truncate" : "break-words",
        )}
        title={truncate && typeof value === "string" ? value : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

/* -------------------- Verification -------------------- */

/** Safe presentation for a verification row. A generic "failed" badge told
 * staff nothing about whether the result was real, simulated, or an outage —
 * classify from the row's evidential fields instead. */
function identityCheckPresentation(r: IdentityCheck): { label: string; tone: "default" | "secondary" | "destructive" | "outline" } {
  const simulated = r.execution_mode === "simulation" || r.provider === "simulator";
  const category = r.result_payload?.error_category;
  if (category === "provider_unavailable") {
    return { label: "Provider unavailable — attempt not consumed", tone: "secondary" };
  }
  if (simulated) return { label: "Test simulation — not compliance evidence", tone: "secondary" };
  switch (r.status) {
    case "verified": return { label: "Live verification passed", tone: "default" };
    case "manual_review": return { label: "Manual review required", tone: "outline" };
    case "failed": return { label: "Failed — customer action required", tone: "destructive" };
    case "cancelled": return { label: "Cancelled", tone: "outline" };
    case "expired": return { label: "Expired", tone: "outline" };
    case "pending":
    case "in_progress":
    default: return { label: "In progress", tone: "outline" };
  }
}

/* The legacy `VerificationTab` lived here. It read aml.identity_checks and
   gated "Request identity verification" on provider readiness, so staff could
   not start verification when the electronic provider was unavailable — the
   one case where the manual document route is the only way forward. The
   canonical `VerificationSection` (aml.verification_checks) is now mounted in
   its place; aml.identity_checks survives read-only in
   `LegacyVerificationHistoryPanel`. */

export function ScreeningTab({ caseId, canWrite, onChanged }: { caseId: string; canWrite: boolean; onChanged: () => void }) {
  const [items, setItems] = useState<ScreeningCheck[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setItems((await amlVerificationApi.listScreening(caseId)).screening_checks); }
    catch (e: any) { toast({ title: "Load failed", description: e.message, variant: "destructive" }); }
  };
  useEffect(() => { load();   }, [caseId]);

  /*
   * This card used to carry its own "Run screening" button. It was the third
   * competing action on Stage 5, and the one that produced the red
   * "local_lists is still in simulator mode" toast: it ignored provider
   * readiness entirely and asked for `["pep","sanctions","adverse_media"]` —
   * two scopes no configured provider can serve and one the risk policy may
   * have stood down for this case.
   *
   * The stage card above owns the action now, chosen from what actually
   * blocks the case, so this is the history of checks and nothing else. A
   * surface that cannot judge whether an action is possible must not offer
   * it.
   */
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Screening checks</CardTitle>
      </CardHeader>
      <CardContent>
        {items === null ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No screening checks yet for this case.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm border-b border-border/50 py-2">
                <div>
                  <div className="font-medium">{s.subject_label}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.provider} · {(s.scope || []).join(", ")} · {new Date(s.requested_at).toLocaleString('en-AU')}
                  </div>
                </div>
                <Badge variant="outline">{s.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- Risk & Decision -------------------- */

/**
 * One choice, readable: what it is called and what it DOES. Replaces the
 * bare <select> over enum spellings — a choice an operator cannot read the
 * consequence of is a choice they hesitate over, and the production table
 * showed the hesitation: zero gate decisions ever recorded.
 */
function ChoiceCard({ selected, label, meaning, onSelect }: {
  selected: boolean; label: string; meaning: string; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "rounded-md border p-2.5 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/50",
      )}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-xs text-muted-foreground">{meaning}</span>
    </button>
  );
}

export function RiskTab({ caseId, canWrite, onChanged, onOpenSection, hasAssignedMlro }: {
  caseId: string; canWrite: boolean; onChanged: () => void;
  /** Route a clearance blocker to the section that resolves it. */
  onOpenSection?: (section: string) => void;
  /** Whether the case names an MLRO — the escalate directive says where an
   *  escalation actually lands. */
  hasAssignedMlro?: boolean;
}) {
  const access = useAmlAccess();
  const canReview = access.roles.has("reviewer") || access.roles.has("mlro");
  const isMlro = access.isMlro;
  const [assessments, setAssessments] = useState<AmlRiskAssessment[] | null>(null);
  const [conditions, setConditions] = useState<AmlCaseCondition[]>([]);
  const [latestDecision, setLatestDecision] = useState<AmlDecision | null>(null);
  const [recommendations, setRecommendations] = useState<AmlAnalystRecommendation[]>([]);
  const [gate, setGate] = useState<AmlServiceGateContract | null>(null);
  const [recalc, setRecalc] = useState<AmlRecalcStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [recOutcome, setRecOutcome] = useState<AmlAnalystRecommendation["recommended_outcome"]>("cleared");
  const [recRationale, setRecRationale] = useState("");
  const [decideOutcome, setDecideOutcome] = useState<"cleared" | "blocked" | "escalated">("cleared");
  const [decideRationale, setDecideRationale] = useState("");
  /*
   * What stands between this case and clearance, from the SAME server
   * computation the decide op enforces (`clearance_readiness`). Null means
   * the reading was unavailable (an old server, a failed read) — which
   * renders as nothing, never as "ready": a failed read is not a clean bill.
   */
  const [clearance, setClearance] = useState<{ ready: boolean; reasons: string[] } | null>(null);

  const load = async () => {
    try {
      const [a, c, d, r, g, rc, cl] = await Promise.all([
        amlRiskApi.listAssessments(caseId),
        amlRiskApi.listConditions(caseId),
        amlRiskApi.latestDecision(caseId),
        amlRiskApi.listRecommendations(caseId).catch(() => ({ recommendations: [] })),
        amlRiskApi.gateContract(caseId).catch(() => ({ gate: null as any })),
        amlRiskApi.recalcStatus(caseId).catch(() => ({ recalc: null as any })),
        amlRiskApi.clearanceReadiness(caseId).catch(() => null),
      ]);
      setAssessments(a.assessments); setConditions(c.conditions); setLatestDecision(d.decision);
      setRecommendations(r.recommendations ?? []);
      setGate(g.gate ?? null);
      setRecalc(rc.recalc ?? null);
      setClearance(cl);
    } catch (e: any) { toast({ title: "Load failed", description: e.message, variant: "destructive" }); }
  };
  useEffect(() => { load();   }, [caseId]);

  const evaluate = async () => {
    setBusy(true);
    try {
      const res = await amlRiskApi.evaluate(caseId, {});
      if (res.auto_decision) {
        toast({ title: "Auto-cleared", description: `Straight-through under policy ${res.program_version}.` });
      } else {
        toast({ title: "Risk re-evaluated", description: `Policy ${res.program_version}` });
      }
      await load(); onChanged();
    } catch (e: any) { toast({ title: "Evaluate failed", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const recordRecommendation = async () => {
    setBusy(true);
    try {
      await amlRiskApi.recommend({ case_id: caseId, recommended_outcome: recOutcome, rationale: recRationale.trim() });
      toast({ title: "Recommendation recorded" });
      setRecRationale("");
      await load();
    } catch (e: any) { toast({ title: "Could not record recommendation", description: e.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const recordDecision = async () => {
    setBusy(true);
    try {
      await amlRiskApi.decide({ case_id: caseId, outcome: decideOutcome, rationale: decideRationale.trim() || undefined });
      toast({ title: "Decision recorded" });
      setDecideRationale("");
      await load(); onChanged();
    } catch (e: any) {
      /*
       * A refusal names its reasons — the server sends them and the panel
       * lists them beside these controls. Reload so the list is current at
       * the moment of the refusal, and say where to look.
       */
      toast({
        title: "Decision failed",
        description: clearance !== null
          ? `${e.message}. The named blockers are listed beside the decision controls.`
          : e.message,
        variant: "destructive",
      });
      await load();
    }
    finally { setBusy(false); }
  };

  const latest = assessments?.[0];
  const pendingRecommendation = recommendations.find((r) => r.status === "pending") ?? null;
  const openConditionCount = conditions.filter((c) => c.status === "open").length;

  /*
   * The path: the same facts as the cards below, arranged in order with one
   * step open (decisionPath.pure.ts). Derives nothing — the audited actions
   * stay on the cards.
   */
  const pathSteps = decisionPath({
    assessment: latest
      ? { created_at: latest.created_at, risk_rating: latest.risk_rating ?? null }
      : null,
    recalcStale: recalc?.stale ?? false,
    recalcReasons: recalc?.reasons ?? [],
    openConditions: openConditionCount,
    pendingRecommendation: pendingRecommendation !== null,
    decision: latestDecision
      ? { outcome: latestDecision.outcome, decided_at: latestDecision.decided_at }
      : null,
    gate: gate ? { status: gate.status, effective_at: gate.effective_at ?? null } : null,
    canWrite,
    canReview,
    isMlro,
  });

  /* Each path step lands on the card that performs it. For a decision-maker
   * the recommendation has no card of its own — anything waiting is shown
   * beside the decision — so its step falls through to the decision card.
   * Optional call: jsdom implements getElementById but not scrollIntoView. */
  const scrollToStep = (key: string) => {
    (document.getElementById(`decision-step-${key}`)
      ?? document.getElementById("decision-step-decision"))
      ?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };

  /* Why each disabled control is disabled, in words. */
  const recRationaleHint = reasonHint(recRationale, "rationale");

  return (
    <div className="space-y-4">
      <DecisionPathCard
        steps={pathSteps}
        onStepClick={scrollToStep}
        onContinue={onOpenSection ? () => onOpenSection("passport") : undefined}
      />
      {recalc?.stale && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <span>
              {recalc.reasons.includes("no_assessment")
                ? "No risk assessment has been computed for this case yet."
                : `Material information changed after the last assessment (${recalc.reasons.map((r) => r.replace(/_changed$/, "").replace(/_/g, " ")).join(", ")}) — the rating may be out of date.`}
            </span>
          </div>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={evaluate} disabled={busy}>
              Recompute now
            </Button>
          )}
        </div>
      )}

      <Card id="decision-step-assessment" className="scroll-mt-24">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-sm">Latest risk assessment</CardTitle>
            {latest?.program_version && (
              <Badge variant="outline" className="border-primary/40 text-primary text-[10px] uppercase">
                Policy {latest.program_version}
              </Badge>
            )}
            {latest?.straight_through && (
              <Badge variant="outline" className="border-success/40 text-success text-[10px] uppercase">
                Auto-cleared
              </Badge>
            )}
          </div>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={evaluate} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null} Re-evaluate
            </Button>
          )}
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          {assessments === null ? <Loader2 className="h-4 w-4 animate-spin" /> :
            !latest ? <p className="text-muted-foreground">No assessments yet.</p> :
            <>
              <Row k="Rating" v={latest.risk_rating?.toUpperCase() ?? "—"} />
              <Row k="MLTF score" v={String(latest.mltf_score)} />
              <Row k="Verification score" v={String(latest.verification_score)} />
              <Row k="Completion score" v={String(latest.completion_score)} />
              <Row k="Computed" v={new Date(latest.created_at).toLocaleString('en-AU')} />
              {latest.policy_snapshot_hash && (
                <Row k="Policy hash" v={<span className="font-mono text-[11px]">{latest.policy_snapshot_hash.slice(0, 12)}…</span>} />
              )}
              {latest.triggered_holds?.length > 0 && (
                <div className="pt-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Triggered holds</div>
                  <ul className="mt-1 space-y-1">
                    {latest.triggered_holds.map((h) => (
                      <li key={h.key}>
                        <Badge variant="outline" className={h.severity === "block" ? "border-destructive/40 text-destructive" : "border-warning/40 text-warning"}>
                          {h.severity.toUpperCase()}
                        </Badge>{" "}
                        {h.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {latest.explanation && (latest.explanation.top_positive?.length || latest.explanation.top_neutral_missing?.length) ? (
                <div className="pt-2 border-t border-border/50">
                  <div className="text-xs font-semibold text-muted-foreground uppercase">Why this rating</div>
                  {latest.explanation.top_positive && latest.explanation.top_positive.length > 0 && (
                    <div className="mt-1">
                      <div className="text-[11px] text-muted-foreground">Top contributors</div>
                      <ul className="mt-0.5 space-y-0.5">
                        {latest.explanation.top_positive.map((f) => (
                          <li key={f.key} className="text-xs flex justify-between gap-4">
                            <span className="truncate">{f.label}</span>
                            <span className="font-mono text-muted-foreground">+{Math.round(f.weighted)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {latest.explanation.top_neutral_missing && latest.explanation.top_neutral_missing.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[11px] text-muted-foreground">Missing inputs (scored 0)</div>
                      <ul className="mt-0.5 space-y-0.5">
                        {latest.explanation.top_neutral_missing.slice(0, 3).map((f) => (
                          <li key={f.key} className="text-xs text-muted-foreground truncate">• {f.label}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : null}
            </>}
        </CardContent>
      </Card>


      <Card>
        <CardHeader><CardTitle className="text-sm">Open conditions</CardTitle></CardHeader>
        <CardContent>
          {conditions.filter(c => c.status === "open").length === 0 ? (
            <p className="text-sm text-muted-foreground">No open conditions.</p>
          ) : (
            <ul className="space-y-2">
              {conditions.filter(c => c.status === "open").map((c) => (
                <li key={c.id} className="text-sm border-b border-border/50 py-2">
                  <div className="font-medium">{c.label}</div>
                  {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/*
        ── One act per role — the "double-up" resolved ───────────────────
        The recommendation is not a duplicate of the decision: it is the
        ANALYST's half of a two-role workflow (the server stamps each
        recommendation `actioned` by the decision that weighed it). The
        double-up FEELING came from showing the form to an operator who can
        decide — recommending to yourself is noise. So: the form renders
        only for operators who cannot decide, as their own act in the same
        choice-card language; a decision-maker sees anything waiting INSIDE
        the decision card, beside the act it informs. History stays on the
        audit trail, where records live.
      */}
      {canWrite && !canReview && (
        <Card id="decision-step-recommendation" className="scroll-mt-24">
          <CardHeader><CardTitle className="text-sm">Your recommendation</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {pendingRecommendation ? (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Awaiting the reviewer</div>
                <div className="mt-1 font-medium capitalize">
                  {pendingRecommendation.recommended_outcome.replace(/_/g, " ")}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{pendingRecommendation.rationale}</p>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Recorded {new Date(pendingRecommendation.created_at).toLocaleString('en-AU')} — recording
                  another replaces it as the one awaiting review.
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Your recommended outcome goes to the reviewer or MLRO beside their decision.
              </p>
            )}
            <div role="radiogroup" aria-label="Recommended outcome" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {RECOMMENDATION_CHOICES.map((c) => (
                <ChoiceCard
                  key={c.value}
                  selected={recOutcome === c.value}
                  label={c.label}
                  meaning={c.meaning}
                  onSelect={() => setRecOutcome(c.value)}
                />
              ))}
            </div>
            <textarea
              className="min-h-[64px] w-full rounded-md border border-input bg-background p-2 text-sm"
              aria-label="Recommendation rationale"
              placeholder="Rationale (required, minimum 10 characters) — what the reviewer needs to know."
              value={recRationale}
              onChange={(e) => setRecRationale(e.target.value)}
            />
            {/* A silent disabled button reads as a broken one — the hint
                names exactly what enables it. */}
            {recRationaleHint && (
              <p className="text-[11px] text-muted-foreground" aria-live="polite">{recRationaleHint}</p>
            )}
            <Button
              size="sm"
              disabled={busy || recRationale.trim().length < 10}
              onClick={recordRecommendation}
            >
              Record recommendation — {RECOMMENDATION_CHOICES.find((c) => c.value === recOutcome)?.label}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card id="decision-step-decision" className="scroll-mt-24">
        <CardHeader><CardTitle className="text-sm">Latest decision</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-3">
          {/* The recorded fact as one readable line, not a ledger of rows. */}
          {!latestDecision ? (
            <p className="text-muted-foreground">No decision recorded.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Badge variant={latestDecision.outcome === "cleared" ? "default" : latestDecision.outcome === "blocked" ? "destructive" : "outline"}>
                  {latestDecision.outcome.replace(/_/g, " ")}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Decided {new Date(latestDecision.decided_at).toLocaleString('en-AU')}
                  {latestDecision.program_version ? ` · Policy ${latestDecision.program_version}` : ""}
                </span>
              </div>
              {latestDecision.rationale && (
                <div className="rounded bg-muted/40 p-2 text-xs">{latestDecision.rationale}</div>
              )}
            </div>
          )}
          {/*
            ── The path to clearance, named BEFORE the click ──────────────
            The decide op refused with "unresolved mandatory holds" while the
            page showed a LOW rating, no holds and no open conditions — the
            reasons existed only inside the 409, and the client discarded
            them. This block reads the SAME server computation as the refusal
            (clearance_readiness → clearanceBlockReasons), names each blocker
            in words, and routes to the section that resolves it. Absent when
            the reading is unavailable — a failed read is never a clean bill.
          */}
          {clearance !== null && !latestDecision && (
            clearance.ready ? (
              <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/5 p-2.5 text-xs text-success">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>Nothing stands between this case and clearance — the server will accept a cleared decision.</span>
              </div>
            ) : (
              <div className="space-y-1.5 rounded-md border border-warning/40 bg-warning/5 p-2.5">
                <p className="text-xs font-medium text-warning">
                  {clearance.reasons.length === 1
                    ? "One thing stands between this case and clearance:"
                    : `${clearance.reasons.length} things stand between this case and clearance:`}
                </p>
                <ul className="space-y-1">
                  {clearance.reasons.map((code) => {
                    const view = describeClearanceReason(code);
                    return (
                      <li key={code} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span>
                          {view.label}
                          <span className="text-muted-foreground"> — {view.action}.</span>
                        </span>
                        {view.section && onOpenSection && (
                          <Button
                            size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                            onClick={() => onOpenSection(view.section!)}
                          >
                            Open
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[11px] text-muted-foreground">
                  Escalating or blocking is not gated by these — only clearance is.
                </p>
              </div>
            )
          )}
          {canReview && (
            <div className="space-y-2 border-t border-border/50 pt-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Record decision</div>
              {/* The analyst's recommendation, beside the act it informs —
                  not in a separate card the decider has to correlate. */}
              {pendingRecommendation && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
                  <div className="text-[11px] font-semibold uppercase text-muted-foreground">
                    Analyst recommendation — awaiting your review
                  </div>
                  <div className="mt-0.5 text-sm font-medium capitalize">
                    {pendingRecommendation.recommended_outcome.replace(/_/g, " ")}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{pendingRecommendation.rationale}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Recorded {new Date(pendingRecommendation.created_at).toLocaleString('en-AU')} · your decision
                    marks it actioned.
                  </p>
                </div>
              )}
              {/*
                The outcome is a CHOICE READ, not an enum picked: each option
                says what it does before it is chosen, and the button names
                the act it will record.
              */}
              <div role="radiogroup" aria-label="Decision outcome" className="grid gap-2 sm:grid-cols-3">
                {DECISION_CHOICES.map((c) => (
                  <ChoiceCard
                    key={c.value}
                    selected={decideOutcome === c.value}
                    label={c.label}
                    meaning={c.meaning}
                    onSelect={() => setDecideOutcome(c.value)}
                  />
                ))}
              </div>
              {/*
                An escalation must say where it goes. The option read
                "Escalate to MLRO" and the click just… recorded — no word on
                who that is, what changes, or what happens next.
              */}
              {decideOutcome === "escalated" && (
                <div className="space-y-1 rounded-md border border-border/60 bg-muted/20 p-2.5 text-xs text-muted-foreground">
                  <p>
                    Escalating hands the final decision to the <span className="font-medium">Money
                    Laundering Reporting Officer</span>: the case moves to <span className="font-medium">Decision
                    pending</span>, this screen shows the decision as theirs to make, and only their
                    cleared or blocked decision moves the case on.
                  </p>
                  <p className={hasAssignedMlro ? undefined : "text-warning"}>
                    {hasAssignedMlro
                      ? "An MLRO is assigned to this case and will find it waiting under their cases."
                      : "No MLRO is assigned to this case yet — assign one on the case record so the escalation reaches somebody."}
                  </p>
                </div>
              )}
              <textarea
                className="min-h-[56px] w-full rounded-md border border-input bg-background p-2 text-sm"
                aria-label="Decision rationale"
                placeholder="Decision rationale — frozen into the decision snapshot."
                value={decideRationale}
                onChange={(e) => setDecideRationale(e.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" disabled={busy} onClick={recordDecision}>
                  Record decision — {DECISION_CHOICES.find((c) => c.value === decideOutcome)?.label}
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Clearance is refused while mandatory holds or open conditions remain.
                </p>
              </div>
            </div>
          )}
          {/* Hidden controls read as a missing feature; a named requirement
              reads as a rule. */}
          {!canReview && (
            <p className="border-t border-border/50 pt-3 text-xs text-muted-foreground">
              Recording the decision requires a reviewer or the MLRO. Record an analyst
              recommendation above for them to weigh.
            </p>
          )}
        </CardContent>
      </Card>

      {/* The Decision stage's full gate card — the one place every gate
          status can be recorded; approval doors forward to Stage 9. */}
      <ServiceGateCard
        caseId={caseId}
        gate={gate}
        decisionOutcome={latestDecision?.outcome ?? null}
        openConditionCount={openConditionCount}
        canReview={canReview}
        isMlro={isMlro}
        onChanged={async () => { await load(); onChanged(); }}
        onOpenSection={onOpenSection}
        anchorId="decision-step-gate"
      />
    </div>
  );
}

/* -------------------- Audit -------------------- */

export function AuditTab({ events }: { events: AmlCaseEvent[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Audit trail (hash-chained)</CardTitle></CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ScrollArea className="max-h-[420px] pr-3">
            <ol className="space-y-3">
              {events.map((ev) => (
                <li key={ev.id} className="border-l-2 border-border pl-3">
                  <div className="text-xs text-muted-foreground">
                    {new Date(ev.created_at).toLocaleString('en-AU')} · {ev.category}
                  </div>
                  <div className="text-sm">{ev.summary}</div>
                  {ev.actor_label && (
                    <div className="text-xs text-muted-foreground">by {ev.actor_label}</div>
                  )}
                  {ev.row_hash && (
                    <div className="text-[10px] font-mono text-muted-foreground truncate">
                      hash {ev.row_hash.slice(0, 16)}…
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------- Ownership & Control (V3, Phase 6) -------------------- */

const VERIFICATION_LABELS: Record<string, string> = {
  unverified: "Not verified", pending: "Verification pending", verified: "Verified",
  failed: "Verification failed", waived: "Waived",
};

const CONTROL_LABELS: Record<string, string> = {
  shareholding: "Shareholder", trustee: "Trustee", beneficiary: "Beneficiary",
  appointor: "Appointor", director: "Director", partner: "Partner",
  settlor: "Settlor", other: "Other controller",
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  company: "Company", trust: "Trust", smsf: "Self-managed super fund",
  partnership: "Partnership", sole_trader: "Sole trader", other: "Other",
};

/**
 * Phase 6 — the case-scoped ownership & control working surface.
 * Reads the canonical entity engine (entities / beneficial owners /
 * authorised representatives) for the case subject, surfaces completeness
 * warnings, and lets analysts reconcile the client's questionnaire answers
 * into those records. Source values land in provenance — mismatches are
 * flagged as conflicts for resolution, never overwritten.
 */
export function OwnershipControlTab({ caseRow, canWrite = false }: { caseRow: AmlCase; canWrite?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState<AmlEntity | null>(null);
  const [owners, setOwners] = useState<AmlBeneficialOwner[]>([]);
  const [reps, setReps] = useState<AmlAuthorisedRep[]>([]);
  const [summary, setSummary] = useState<AmlOwnershipSummary | null>(null);
  const [provenance, setProvenance] = useState<AmlProvenanceRow[]>([]);
  const [idChecks, setIdChecks] = useState<IdentityCheck[]>([]);
  const [scrChecks, setScrChecks] = useState<ScreeningCheck[]>([]);
  const [importing, setImporting] = useState(false);
  const [linkingParty, setLinkingParty] = useState<string | null>(null);
  const [lastReport, setLastReport] = useState<AmlQuestionnaireImportReport | null>(null);

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      const [linksRes, provRes, idRes, scrRes] = await Promise.all([
        amlEntitiesApi.listEntitiesForCase(caseRow.id),
        amlEntitiesApi.listProvenance(caseRow.id).catch(() => ({ provenance: [] })),
        amlVerificationApi.listIdv(caseRow.id).catch(() => ({ identity_checks: [] })),
        amlVerificationApi.listScreening(caseRow.id).catch(() => ({ screening_checks: [] })),
      ]);
      setProvenance(provRes.provenance ?? []);
      setIdChecks(idRes.identity_checks ?? []);
      setScrChecks(scrRes.screening_checks ?? []);
      const links = linksRes.links ?? [];
      const subject = links.find((l) => l.link_role === "subject") ?? links[0];
      if (!subject?.entity_id) {
        setEntity(null); setOwners([]); setReps([]); setSummary(null);
        return;
      }
      const [detail, summaryRes] = await Promise.all([
        amlEntitiesApi.getEntity(subject.entity_id),
        amlEntitiesApi.ownershipSummary(subject.entity_id),
      ]);
      setEntity(detail.entity);
      setOwners(detail.owners ?? []);
      setReps(detail.reps ?? []);
      setSummary(summaryRes.summary ?? null);
    } catch {
      // panel falls back to its empty state
    } finally {
      setLoading(false);
    }
  }, [caseRow.id]);

  useEffect(() => { void load(); }, [load]);

  const linkCheck = async (
    target: "owner" | "rep", partyId: string,
    kind: "identity" | "screening", checkId: string,
  ) => {
    if (!checkId) return;
    setLinkingParty(partyId);
    try {
      await amlEntitiesApi.linkVerification({
        case_id: caseRow.id, target, party_id: partyId,
        ...(kind === "identity" ? { identity_check_id: checkId } : { screening_check_id: checkId }),
      });
      toast({ title: "Verification linked" });
      await load();
    } catch (e: any) {
      toast({ title: "Could not link verification", description: e.message, variant: "destructive" });
    } finally {
      setLinkingParty(null);
    }
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const { report } = await amlEntitiesApi.importFromQuestionnaire(caseRow.id);
      setLastReport(report);
      const created = report.owners_created.length + report.reps_created.length;
      toast({
        title: "Client answers reconciled",
        description: `${created} part${created === 1 ? "y" : "ies"} recorded, ${report.conflicts.length} conflict${report.conflicts.length === 1 ? "" : "s"} flagged.`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const conflicts = useMemo(
    () => provenance.filter((p) => p.conflict_status === "conflict"),
    [provenance],
  );

  const warnings = useMemo(() => {
    const out: string[] = [];
    if (!entity) return out;
    if (summary) {
      if (summary.total_owners === 0) {
        out.push("No beneficial owners or controllers are recorded for this structure yet.");
      } else {
        if (summary.missing_ownership_percent > 0.5) {
          out.push(`Recorded ownership covers ${summary.total_ownership_percent}% — ${summary.missing_ownership_percent.toFixed(1)}% is unaccounted for.`);
        }
        if (summary.ubo_count === 0) {
          out.push("No ultimate beneficial owner (25%+ ownership or control) has been identified.");
        }
        if (summary.unverified_count > 0) {
          out.push(`${summary.unverified_count} listed ${summary.unverified_count === 1 ? "person has" : "people have"} not completed identity verification.`);
        }
        if (summary.pep_count > 0) {
          out.push(`${summary.pep_count} listed ${summary.pep_count === 1 ? "person is" : "people are"} politically exposed — enhanced due diligence applies.`);
        }
        if (summary.sanctioned_count > 0) {
          out.push(`${summary.sanctioned_count} listed ${summary.sanctioned_count === 1 ? "person matches" : "people match"} a sanctions listing — do not proceed without a decision.`);
        }
      }
    }
    return out;
  }, [entity, summary]);

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Ownership & Control</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Beneficial owners, controllers and authorised representatives for this
              case subject, reconciled from the client's own declarations.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {canWrite && (
              <Button size="sm" variant="outline" disabled={importing} onClick={runImport}>
                {importing && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                Import client answers
              </Button>
            )}
            <Button asChild size="sm" variant="ghost">
              <Link to="/admin/aml/counterparty">
                Full register <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!entity ? (
            <div className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
              {caseRow.subject_type === "individual"
                ? "No entity structure is recorded for this case. Individual purchasers do not carry beneficial ownership structures; related parties the client declares (gift donors, private lenders, co-purchasers) appear below after import."
                : "No entity has been linked to this case yet. If the client has completed the entity section of their questionnaire, use “Import client answers” to create the canonical record."}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Row k="Legal name" v={entity.legal_name} />
              <Row k="Structure" v={ENTITY_TYPE_LABELS[entity.entity_type] ?? entity.entity_type} />
              <Row k="ABN" v={entity.abn ?? "—"} />
              <Row k="ACN" v={entity.acn ?? "—"} />
              <Row k="Established" v={entity.incorporation_date ? new Date(entity.incorporation_date).toLocaleDateString('en-AU') : "—"} />
              <Row k="Jurisdiction" v={entity.jurisdiction} />
            </div>
          )}
        </CardContent>
      </Card>

      {warnings.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" /> Completeness checks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-4 text-xs">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {entity && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Owners & controllers
              {summary && summary.total_owners > 0 && (
                <span className="ml-2 font-normal text-xs text-muted-foreground">
                  {summary.total_ownership_percent}% of ownership recorded
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {owners.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No owners or controllers recorded yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Beneficial owners and controllers for {entity.legal_name}</caption>
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-2 pr-3 font-medium">Name</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Role</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Ownership</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Verification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {owners.map((o) => (
                      <tr key={o.id} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>{o.full_name}</span>
                            {o.is_ubo && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">UBO</Badge>}
                            {o.is_pep && <Badge variant="outline" className="h-5 border-warning/50 px-1.5 text-[10px] text-warning">PEP</Badge>}
                            {o.is_sanctioned && <Badge variant="outline" className="h-5 border-destructive/50 px-1.5 text-[10px] text-destructive">Sanctions</Badge>}
                          </div>
                        </td>
                        <td className="py-2 pr-3">{CONTROL_LABELS[o.control_type] ?? o.control_type}</td>
                        <td className="py-2 pr-3 tabular-nums">{Number(o.ownership_percent) > 0 ? `${o.ownership_percent}%` : "—"}</td>
                        <td className="py-2 pr-3">
                          <div className="space-y-1">
                            <Badge
                              variant="outline"
                              className={
                                o.verification_state === "verified" || o.verification_state === "waived"
                                  ? "border-success/40 text-success"
                                  : o.verification_state === "failed"
                                    ? "border-destructive/40 text-destructive"
                                    : "border-muted-foreground/30 text-muted-foreground"
                              }
                            >
                              {VERIFICATION_LABELS[o.verification_state] ?? o.verification_state}
                            </Badge>
                            {canWrite && !o.identity_check_id && idChecks.length > 0 && (
                              <select
                                className="block h-7 w-full max-w-[190px] rounded-md border border-input bg-background px-1.5 text-xs"
                                aria-label={`Link identity check for ${o.full_name}`}
                                value=""
                                disabled={linkingParty === o.id}
                                onChange={(e) => linkCheck("owner", o.id, "identity", e.target.value)}
                              >
                                <option value="">Link identity check…</option>
                                {idChecks.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.subject_label} · {String(c.status).replace(/_/g, " ")}
                                  </option>
                                ))}
                              </select>
                            )}
                            {canWrite && !o.screening_check_id && scrChecks.length > 0 && (
                              <select
                                className="block h-7 w-full max-w-[190px] rounded-md border border-input bg-background px-1.5 text-xs"
                                aria-label={`Link screening check for ${o.full_name}`}
                                value=""
                                disabled={linkingParty === o.id}
                                onChange={(e) => linkCheck("owner", o.id, "screening", e.target.value)}
                              >
                                <option value="">Link screening…</option>
                                {scrChecks.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.subject_label} · {String(c.status).replace(/_/g, " ")}
                                  </option>
                                ))}
                              </select>
                            )}
                            {o.identity_check_id && (
                              <div className="text-[10px] text-muted-foreground">Identity check linked</div>
                            )}
                            {o.screening_check_id && (
                              <div className="text-[10px] text-muted-foreground">Screening linked</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {entity && (owners.length > 0 || reps.length > 0) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Structure diagram</CardTitle></CardHeader>
          <CardContent>
            <OwnershipGraph entity={entity} owners={owners} reps={reps} />
            <p className="mt-1 text-[11px] text-muted-foreground">
              The tables above are the accessible equivalent of this diagram.
            </p>
          </CardContent>
        </Card>
      )}

      {entity && reps.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Authorised representatives</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Authorised representatives for {entity.legal_name}</caption>
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">Name</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Role</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {reps.map((r) => (
                    <tr key={r.id} className="border-b border-border/40 last:border-0">
                      <td className="py-2 pr-3">{r.full_name}</td>
                      <td className="py-2 pr-3">{r.role_title}</td>
                      <td className="py-2 pr-3">
                        <div className="space-y-1">
                          <Badge
                            variant="outline"
                            className={
                              r.verification_state === "verified" || r.verification_state === "waived"
                                ? "border-success/40 text-success"
                                : r.verification_state === "failed"
                                  ? "border-destructive/40 text-destructive"
                                  : "border-muted-foreground/30 text-muted-foreground"
                            }
                          >
                            {VERIFICATION_LABELS[r.verification_state] ?? r.verification_state}
                          </Badge>
                          {canWrite && !r.identity_check_id && idChecks.length > 0 && (
                            <select
                              className="block h-7 w-full max-w-[190px] rounded-md border border-input bg-background px-1.5 text-xs"
                              aria-label={`Link identity check for ${r.full_name}`}
                              value=""
                              disabled={linkingParty === r.id}
                              onChange={(e) => linkCheck("rep", r.id, "identity", e.target.value)}
                            >
                              <option value="">Link identity check…</option>
                              {idChecks.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.subject_label} · {String(c.status).replace(/_/g, " ")}
                                </option>
                              ))}
                            </select>
                          )}
                          {r.identity_check_id && (
                            <div className="text-[10px] text-muted-foreground">Identity check linked</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {conflicts.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-warning" /> Source conflicts to resolve
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              The client's declared values differ from what is already on record.
              Recorded values were kept — review each and resolve on the full register.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-xs">
              {conflicts.map((c) => (
                <li key={c.id} className="rounded-md border border-border/60 p-2">
                  <div className="font-medium">{c.field_key.replace(/^entity\./, "").replace(/_/g, " ")}</div>
                  <div className="text-muted-foreground">
                    Client declared: {typeof c.value === "object" && c.value !== null && "v" in c.value
                      ? String((c.value as any).v)
                      : String(c.value ?? "—")}
                    {" · "}{new Date(c.submitted_at).toLocaleDateString('en-AU')}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {lastReport && lastReport.parties_needing_review.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Declared parties needing manual handling</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {lastReport.parties_needing_review.map((p, i) => (
                <li key={i}>
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground"> — {p.role}. {
                    p.reason === "no_entity_structure_on_case"
                      ? "This case has no entity structure; record them via the Requests or Verification workflow."
                      : "This role is recorded as source information only; add them to the register manually if they hold ownership or control."
                  }</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Phase 6 — visual ownership graph (§12.4). Pure SVG hub-and-spoke: the
 * entity at the hub, owners/controllers with solid edges (labelled with
 * ownership %), representatives with dashed edges. currentColor only — the
 * surrounding text classes supply the semantic palette. The owners/reps
 * tables are the accessible equivalent; the SVG is decorative structure.
 */
function OwnershipGraph({ entity, owners, reps }: {
  entity: AmlEntity; owners: AmlBeneficialOwner[]; reps: AmlAuthorisedRep[];
}) {
  const nodes = [
    ...owners.map((o) => ({
      id: o.id,
      name: o.full_name,
      sub: [
        CONTROL_LABELS[o.control_type] ?? o.control_type,
        Number(o.ownership_percent) > 0 ? `${o.ownership_percent}%` : null,
        o.is_ubo ? "UBO" : null,
      ].filter(Boolean).join(" · "),
      dashed: false,
    })),
    ...reps.map((r) => ({
      id: r.id, name: r.full_name, sub: r.role_title, dashed: true,
    })),
  ];
  const rowH = 46;
  const height = Math.max(nodes.length * rowH + 16, 96);
  const hubY = height / 2;
  const width = 640;
  const label = `Ownership structure for ${entity.legal_name}: ${owners.length} owner${owners.length === 1 ? "" : "s"} or controllers and ${reps.length} authorised representative${reps.length === 1 ? "" : "s"}.`;

  return (
    <div className="overflow-x-auto text-muted-foreground">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-[560px] max-w-full"
        style={{ height }}
      >
        {/* hub */}
        <rect x={8} y={hubY - 24} width={196} height={48} rx={8}
          fill="none" stroke="currentColor" strokeOpacity={0.6} />
        <text x={106} y={hubY - 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="currentColor">
          {entity.legal_name.length > 26 ? `${entity.legal_name.slice(0, 25)}…` : entity.legal_name}
        </text>
        <text x={106} y={hubY + 13} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.7}>
          {ENTITY_TYPE_LABELS[entity.entity_type] ?? entity.entity_type}
        </text>
        {nodes.map((n, i) => {
          const y = 8 + i * rowH + rowH / 2;
          return (
            <g key={n.id}>
              <path
                d={`M 204 ${hubY} C 280 ${hubY}, 300 ${y}, 356 ${y}`}
                fill="none" stroke="currentColor" strokeOpacity={0.45}
                strokeDasharray={n.dashed ? "4 4" : undefined}
              />
              <circle cx={362} cy={y} r={3.5} fill="currentColor" fillOpacity={0.6} />
              <text x={374} y={y - 2} fontSize={11.5} fontWeight={500} fill="currentColor">
                {n.name.length > 32 ? `${n.name.slice(0, 31)}…` : n.name}
              </text>
              <text x={374} y={y + 12} fontSize={10} fill="currentColor" fillOpacity={0.7}>
                {n.sub}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* -------------------- Funding & Finance (V3) -------------------- */

/**
 * Directive 4 — case-scoped Funding & Finance snapshot.
 * Reuses `amlFinanceApi` so this tab shares the same comparison /
 * discrepancy engine as the standalone page. Read-only here — the
 * page owns entitlement gate + write actions.
 */
export function FundingFinanceTab({ caseId, canWrite = false, onChanged, onContinue }: {
  caseId: string;
  canWrite?: boolean;
  onChanged?: () => void;
  /** Opens Stage 7 · Submission review, once the stage is settled. */
  onContinue?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [comparisons, setComparisons] = useState<AmlFinanceComparison[]>([]);
  const [discrepancies, setDiscrepancies] = useState<AmlFinanceDiscrepancy[]>([]);
  const [financeRequests, setFinanceRequests] = useState<AmlFinanceRequest[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [c, d, fr] = await Promise.all([
          amlFinanceApi.listComparisons(caseId),
          amlFinanceApi.listDiscrepancies({ case_id: caseId }),
          amlFinanceApi.listFinanceRequests(caseId).catch(() => ({ requests: [] })),
        ]);
        if (alive) setFinanceRequests((fr as any)?.requests ?? []);
        if (!alive) return;
        setComparisons((c as any)?.comparisons ?? (Array.isArray(c) ? c : []));
        setDiscrepancies((d as any)?.discrepancies ?? (Array.isArray(d) ? d : []));
      } catch {
        // silent — panel shows empty state
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [caseId]);

  const latest = comparisons[0] ?? null;
  const openDiscrepancies = useMemo(
    () => discrepancies.filter((d) => d.status === "open" || d.status === "under_review"),
    [discrepancies],
  );

  return (
    <div className="space-y-4">
      {/*
        ── The stage's own work, first ──────────────────────────────────
        "Open funding & finance" used to land here with nothing actionable:
        the card below is a read-only view of the finance module's
        comparisons, and the actual Stage 6 job — record and verify source
        of funds — had no surface anywhere. The button now opens the work.
      */}
      <FundingEvidencePanel
        caseId={caseId} canWrite={canWrite} onChanged={onChanged} onContinue={onContinue}
      />
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-sm">Funding & Finance</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Source-of-funds comparison and discrepancy queue for this case. Service
            entitlement (Model B) remains gated on the dedicated Funding & Finance page.
          </p>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/admin/aml/finance">
            Open Funding & Finance
            <ExternalLink className="ml-2 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Row k="Latest comparison" v={latest ? new Date(latest.created_at ?? "").toLocaleDateString('en-AU') : "—"} />
              <Row k="Open discrepancies" v={String(openDiscrepancies.length)} />
              <Row
                k="Finance requests"
                v={
                  financeRequests.length === 0
                    ? "None sent"
                    : `${financeRequests.filter((r) => ["open", "clarification_required"].includes(r.status)).length} awaiting partner · ${financeRequests.filter((r) => r.status === "submitted").length} to review`
                }
              />
              {latest && (
                <Row k="Latest source" v={String(latest.source ?? "").replace(/_/g, " ") || "—"} />
              )}
            </div>
            {openDiscrepancies.length > 0 ? (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>
                  {openDiscrepancies.length} unresolved item{openDiscrepancies.length === 1 ? "" : "s"}.
                  Triage on the Funding & Finance page — decisions write back to this case's audit trail.
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                No open funding discrepancies for this case.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
    </div>
  );
}

/* -------------------- Timeline (V3 · Directive 15) -------------------- */

type TimelineCategory = "event" | "verification" | "screening" | "risk" | "decision" | "finance";

interface TimelineEntry {
  id: string;
  at: string;
  category: TimelineCategory;
  title: string;
  detail?: string;
  badge?: string;
  hash?: string | null;
}

const CATEGORY_META: Record<TimelineCategory, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  event:        { label: "Case event",   icon: CircleDot,    className: "text-muted-foreground" },
  verification: { label: "Verification", icon: ShieldCheck,  className: "text-primary" },
  screening:    { label: "Screening",    icon: ScanSearch,   className: "text-primary" },
  risk:         { label: "Risk",         icon: Gauge,        className: "text-warning" },
  decision:     { label: "Decision",     icon: Scale,        className: "text-success" },
  finance:      { label: "Finance",      icon: Wallet,       className: "text-warning" },
};

/**
 * Chronological, read-only build-out of the case lifecycle. Merges
 * hash-chained case events with verification, screening, risk, decision
 * and (if authorised) funding discrepancy artefacts into a single feed.
 *
 * Guardrails:
 *   - Reuses existing APIs; no schema or write paths introduced.
 *   - Finance category only surfaces when caller holds `aml.investigate`
 *     (tipping-off protection preserved).
 *   - No SMR / regulatory records; those remain gated on the AUSTRAC hub.
 */
export function TimelineTab({
  caseId,
  events,
  canInvestigate,
}: {
  caseId: string;
  events: AmlCaseEvent[];
  canInvestigate: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [idv, setIdv] = useState<IdentityCheck[]>([]);
  const [screen, setScreen] = useState<ScreeningCheck[]>([]);
  const [risk, setRisk] = useState<AmlRiskAssessment[]>([]);
  const [decisions, setDecisions] = useState<AmlDecision[]>([]);
  const [discrepancies, setDiscrepancies] = useState<AmlFinanceDiscrepancy[]>([]);
  const [filter, setFilter] = useState<TimelineCategory | "all">("all");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const promises: Promise<any>[] = [
          amlVerificationApi.listIdv(caseId).catch(() => ({ identity_checks: [] })),
          amlVerificationApi.listScreening(caseId).catch(() => ({ screening_checks: [] })),
          amlRiskApi.listAssessments(caseId).catch(() => ({ assessments: [] })),
          amlRiskApi.listDecisions?.(caseId).catch(() => ({ decisions: [] })) ??
            amlRiskApi.latestDecision(caseId).then((r) => ({ decisions: r.decision ? [r.decision] : [] })).catch(() => ({ decisions: [] })),
        ];
        if (canInvestigate) {
          promises.push(
            amlFinanceApi.listDiscrepancies({ case_id: caseId }).catch(() => ({ discrepancies: [] })),
          );
        }
        const res = await Promise.all(promises);
        if (!alive) return;
        setIdv(res[0]?.identity_checks ?? []);
        setScreen(res[1]?.screening_checks ?? []);
        setRisk(res[2]?.assessments ?? []);
        setDecisions(res[3]?.decisions ?? []);
        if (canInvestigate) setDiscrepancies(res[4]?.discrepancies ?? []);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [caseId, canInvestigate]);

  const entries: TimelineEntry[] = useMemo(() => {
    const out: TimelineEntry[] = [];
    for (const e of events) {
      out.push({
        id: `evt-${e.id}`, at: e.created_at, category: "event",
        title: e.summary || e.category, detail: e.actor_label ? `by ${e.actor_label}` : undefined,
        hash: e.row_hash ?? null,
      });
    }
    for (const r of idv) {
      out.push({
        id: `idv-${r.id}`, at: r.requested_at, category: "verification",
        title: `IDV · ${r.subject_label}`,
        detail: `${r.provider} · ${r.method}`, badge: r.status,
      });
    }
    for (const s of screen) {
      out.push({
        id: `scr-${s.id}`, at: s.requested_at, category: "screening",
        title: `Screening · ${s.subject_label}`,
        detail: `${s.provider} · ${(s.scope || []).join(", ")}`, badge: s.status,
      });
    }
    for (const a of risk) {
      out.push({
        id: `risk-${a.id}`, at: a.created_at, category: "risk",
        title: `Risk assessment · ${(a.risk_rating ?? "unrated").toString().toUpperCase()}`,
        detail: `MLTF ${a.mltf_score} · Verification ${a.verification_score} · Completion ${a.completion_score}`,
        badge: a.straight_through ? "auto-cleared" : a.program_version,
      });
    }
    for (const d of decisions) {
      out.push({
        id: `dec-${d.id}`, at: d.decided_at, category: "decision",
        title: `Decision · ${d.outcome}`, detail: d.rationale ?? undefined,
      });
    }
    for (const x of discrepancies) {
      const at = (x as any).created_at ?? (x as any).detected_at ?? new Date().toISOString();
      out.push({
        id: `fin-${x.id}`, at, category: "finance",
        title: `Funding discrepancy · ${(x as any).label ?? (x as any).kind ?? "item"}`,
        detail: (x as any).detail ?? undefined, badge: x.status,
      });
    }
    return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [events, idv, screen, risk, decisions, discrepancies]);

  const filtered = filter === "all" ? entries : entries.filter((e) => e.category === filter);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: entries.length };
    for (const e of entries) c[e.category] = (c[e.category] ?? 0) + 1;
    return c;
  }, [entries]);

  const categories: (TimelineCategory | "all")[] = [
    "all", "event", "verification", "screening", "risk", "decision",
    ...(canInvestigate ? (["finance"] as const) : []),
  ];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Case lifecycle timeline</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Chronological view of everything on this case. Read-only —
              actions remain on their respective tabs so step-up and entitlement
              gates continue to apply.
            </p>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase">{entries.length} entries</Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => {
            const active = filter === c;
            const label = c === "all" ? "All" : CATEGORY_META[c].label;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(c)}
                className={
                  "text-[11px] rounded-md border px-2 py-1 transition-colors " +
                  (active
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:bg-muted/40")
                }
              >
                {label} <span className="ml-1 opacity-70">{counts[c] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Assembling timeline…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-4 text-xs text-muted-foreground">
            Nothing to show for this filter yet.
          </div>
        ) : (
          <ScrollArea className="max-h-[520px] pr-3">
            <ol className="relative border-l border-border/60 pl-4 space-y-4">
              {filtered.map((entry) => {
                const meta = CATEGORY_META[entry.category];
                const Icon = meta.icon;
                return (
                  <li key={entry.id} className="relative">
                    <span
                      className={
                        "absolute -left-[22px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-background border border-border " +
                        meta.className
                      }
                    >
                      <Icon className="h-2.5 w-2.5" />
                    </span>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {meta.label} · {new Date(entry.at).toLocaleString('en-AU')}
                        </div>
                        <div className="text-sm font-medium">{entry.title}</div>
                        {entry.detail && (
                          <div className="text-xs text-muted-foreground">{entry.detail}</div>
                        )}
                        {entry.hash && (
                          <div className="text-[10px] font-mono text-muted-foreground truncate">
                            hash {entry.hash.slice(0, 16)}…
                          </div>
                        )}
                      </div>
                      {entry.badge && (
                        <Badge variant="outline" className="text-[10px] uppercase whitespace-nowrap">
                          {entry.badge}
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

