import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  FileSignature,
  Gauge,
  Info,
  ListChecks,
  Lock,
  ShieldCheck,
  Settings2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import { amlMonitoringApi, type AmlMonitoringSummary } from "@/lib/aml/amlMonitoringApi";
import { amlFinanceApi } from "@/lib/aml/amlFinanceApi";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { hasAmlCapability, type AmlCapability } from "@/lib/aml/permissions";
import { suggestAmlLanding } from "@/lib/aml/defaultLanding";
import { caseStage } from "@/lib/aml/caseDimensions";
import { PartnerOpsQueueStrip } from "@/components/aml/PartnerOpsQueueStrip";
import {
  AmlEmptyState,
  AmlErrorState,
  AmlMetricCard,
  AmlPageSection,
  AmlRefreshButton,
  AmlRiskBadge,
  AmlStageBadge,
} from "@/components/aml/primitives";

/**
 * AML V3 — Compliance Home (directive §8, completed in tri-portal Phase 2).
 *
 * Operational, role-adaptive landing rendered when
 * `feature_flags.aml_v3_compliance_home = true`; otherwise the legacy V2
 * overview renders unchanged.
 *
 * Answers the four §8 questions directly:
 *  1. What requires attention?   → priority work queue
 *  2. Which clients are blocked? → queue reasons + stage badges
 *  3. What is approaching a deadline? → reviews due / overdue metrics
 *  4. What should I do next?     → next-best-action header
 *
 * Rules honoured (AGENTS.md): no role chips or dev metadata; everything is
 * derived from effective capabilities; restricted metrics are omitted from
 * render entirely for users without the capability (their server payloads are
 * already scoped); empty states are actionable. Metric tiles distinguish
 * loading, a real zero, and "not available" (a failed or absent source) —
 * an unavailable count is never shown as 0 or a dash.
 */

interface ActionEntry {
  key: string;
  label: string;
  description: string;
  to: string;
  cta: string;
  icon: LucideIcon;
  capability: AmlCapability;
  variant?: "default" | "primary";
}

const ACTION_CATALOG: ActionEntry[] = [
  {
    key: "cases",
    label: "Customer cases",
    description: "Continue any customer compliance case or open the register.",
    to: "/admin/aml/cases",
    cta: "Open case register",
    icon: Users,
    capability: "aml.view",
  },
  {
    key: "monitoring",
    label: "Monitoring & alerts",
    description: "Triage open alerts and unprocessed rule-engine events.",
    to: "/admin/aml/monitoring",
    cta: "Open monitoring",
    icon: Bell,
    capability: "aml.investigate",
  },
  {
    key: "transactions",
    label: "Transactions",
    description: "Investigate flagged transactions and reporting triggers.",
    to: "/admin/aml/transactions",
    cta: "Open transactions",
    icon: Gauge,
    capability: "aml.investigate",
  },
  {
    key: "austrac",
    label: "AUSTRAC Hub",
    description: "Regulatory report drafting, approval and lodgement.",
    to: "/admin/aml/austrac",
    cta: "Open AUSTRAC Hub",
    icon: FileSignature,
    capability: "aml.report",
    variant: "primary",
  },
  {
    key: "finance",
    label: "Funding & Finance",
    description: "Funding reconciliation and finance discrepancies.",
    to: "/admin/aml/finance",
    cta: "Open Funding & Finance",
    icon: Wallet,
    capability: "aml.investigate",
  },
  {
    key: "configuration",
    label: "Organisation Settings",
    description: "Program, thresholds, providers and terminology.",
    to: "/admin/aml/configuration",
    cta: "Open settings",
    icon: Settings2,
    capability: "aml.configure",
  },
];

/** Priority queue entry derived from an actionable case. */
interface QueueEntry {
  caseRow: AmlCase;
  reason: string;
  action: string;
  urgency: 1 | 2 | 3; // 1 = highest
}

function queueEntriesFrom(
  escalated: AmlCase[],
  awaitingReview: AmlCase[],
  enhancedCdd: AmlCase[],
): QueueEntry[] {
  const entries: QueueEntry[] = [
    ...escalated.map((c): QueueEntry => ({
      caseRow: c,
      reason: "Awaiting decision",
      action: "Decide",
      urgency: 1,
    })),
    ...enhancedCdd.map((c): QueueEntry => ({
      caseRow: c,
      reason: "Additional information required",
      action: "Review requirements",
      urgency: 2,
    })),
    ...awaitingReview.map((c): QueueEntry => ({
      caseRow: c,
      reason: "Client submission awaiting review",
      action: "Start review",
      urgency: 3,
    })),
  ];
  return entries.sort((a, b) =>
    a.urgency - b.urgency ||
    (b.caseRow.updated_at ?? "").localeCompare(a.caseRow.updated_at ?? ""),
  );
}

export default function AmlComplianceHomeV3() {
  const { roles, loading: accessLoading } = useAmlAccess();

  const canView = hasAmlCapability(roles, "aml.view");
  const canInvestigate = hasAmlCapability(roles, "aml.investigate");
  const canReport = hasAmlCapability(roles, "aml.report");

  const [loadingCases, setLoadingCases] = useState(true);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [recent, setRecent] = useState<AmlCase[]>([]);
  const [escalated, setEscalated] = useState<AmlCase[]>([]);
  const [awaitingReview, setAwaitingReview] = useState<AmlCase[]>([]);
  const [enhancedCdd, setEnhancedCdd] = useState<AmlCase[]>([]);
  const [counts, setCounts] = useState<{
    onboarding: number; awaitingReview: number; enhancedCdd: number; escalated: number;
  } | null>(null);

  const [monitoring, setMonitoring] = useState<AmlMonitoringSummary | null>(null);
  const [loadingMonitoring, setLoadingMonitoring] = useState(false);
  const [monitoringSettled, setMonitoringSettled] = useState(false);
  const [openDiscrepancies, setOpenDiscrepancies] = useState<number | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadCases = useCallback(async (alive: () => boolean) => {
    try {
      setLoadingCases(true);
      setCaseError(null);
      const [recentRes, escalatedRes, reviewRes, eddRes, onboardingRes] = await Promise.all([
        amlCasesApi.list({ limit: 5 }),
        amlCasesApi.list({ status: "escalated_mlro", limit: 5 }),
        amlCasesApi.list({ status: "kyc_complete", limit: 5 }),
        amlCasesApi.list({ status: "edd_required", limit: 5 }),
        amlCasesApi.list({ status: "kyc_in_progress", limit: 1 }),
      ]);
      if (!alive()) return;
      setRecent(recentRes.cases ?? []);
      setEscalated(escalatedRes.cases ?? []);
      setAwaitingReview(reviewRes.cases ?? []);
      setEnhancedCdd(eddRes.cases ?? []);
      setCounts({
        onboarding: onboardingRes.total ?? 0,
        awaitingReview: reviewRes.total ?? 0,
        enhancedCdd: eddRes.total ?? 0,
        escalated: escalatedRes.total ?? 0,
      });
    } catch (e: any) {
      if (alive()) setCaseError(e?.message ?? "Unable to load cases");
    } finally {
      if (alive()) setLoadingCases(false);
    }
  }, []);

  const loadMonitoring = useCallback(async (alive: () => boolean) => {
    try {
      setLoadingMonitoring(true);
      const [summary, discrepancies] = await Promise.all([
        amlMonitoringApi.summary().catch(() => null),
        amlFinanceApi.listDiscrepancies({ status: "open" }).catch(() => null),
      ]);
      if (!alive()) return;
      setMonitoring(summary);
      setOpenDiscrepancies(discrepancies ? (discrepancies.discrepancies ?? []).length : null);
    } finally {
      if (alive()) {
        setLoadingMonitoring(false);
        setMonitoringSettled(true);
      }
    }
  }, []);

  useEffect(() => {
    if (!canView) return;
    let alive = true;
    void loadCases(() => alive).then(() => { if (alive) setLastRefreshed(new Date()); });
    return () => { alive = false; };
  }, [canView, loadCases]);

  useEffect(() => {
    if (!canInvestigate) return;
    let alive = true;
    void loadMonitoring(() => alive);
    return () => { alive = false; };
  }, [canInvestigate, loadMonitoring]);

  const refreshing = loadingCases || loadingMonitoring;
  const refresh = () => {
    const alive = () => true;
    const jobs: Promise<void>[] = [];
    if (canView) jobs.push(loadCases(alive));
    if (canInvestigate) jobs.push(loadMonitoring(alive));
    void Promise.all(jobs).then(() => setLastRefreshed(new Date()));
  };

  const queue = useMemo(
    () => queueEntriesFrom(escalated, awaitingReview, enhancedCdd).slice(0, 8),
    [escalated, awaitingReview, enhancedCdd],
  );

  const landing = useMemo(() => suggestAmlLanding(roles), [roles]);
  const visibleActions = useMemo(
    () => ACTION_CATALOG.filter((a) => hasAmlCapability(roles, a.capability)),
    [roles],
  );

  // Next best action: the top of the priority queue wins; otherwise the
  // capability-derived landing suggestion.
  const nextBest = useMemo(() => {
    const top = queue[0];
    if (top) {
      return {
        title: `${top.reason} — ${top.caseRow.subject_display_name}`,
        detail: top.caseRow.case_reference,
        to: `/admin/aml/cases?open=${top.caseRow.id}`,
        cta: top.action,
      };
    }
    if (landing) {
      return {
        title: "Nothing urgent in your queues",
        detail: landing.reason,
        to: landing.path,
        cta: landing.label,
      };
    }
    return null;
  }, [queue, landing]);

  // Case metrics: loading → skeleton; API failure → "Not available";
  // otherwise the real number (including a real zero). Monitoring tiles are
  // "loading" until their fetch has actually settled — never a fabricated
  // zero in the paint before the effect runs.
  const caseMetricState = loadingCases ? "loading" : caseError ? "unavailable" : "ready";
  const monitoringMetricState = !monitoringSettled || loadingMonitoring
    ? "loading"
    : monitoring === null
      ? "unavailable"
      : "ready";
  const discrepancyMetricState = !monitoringSettled || loadingMonitoring
    ? "loading"
    : openDiscrepancies === null
      ? "unavailable"
      : "ready";

  // Actionable no-access state.
  if (!accessLoading && roles.size === 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-10">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">You don't have access yet</h2>
            <p className="text-sm text-muted-foreground">
              The AML/CTF workspace is visible, but acting in it needs an access grant.
            </p>
          </div>
        </div>
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Request access</AlertTitle>
          <AlertDescription>
            Ask your compliance administrator to grant you AML access from{" "}
            <Link className="underline" to="/admin/users">User Management</Link>. Queues and
            restricted areas appear automatically once access is granted.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end" aria-labelledby="compliance-home-heading">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Operational overview</p>
          <h2 id="compliance-home-heading" className="mt-1 text-xl font-semibold tracking-tight">Attention, blocked work and programme health</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">One command view for customer compliance, monitoring queues and reporting handoffs.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span aria-live="polite">{lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
          <AmlRefreshButton onClick={refresh} loading={refreshing} />
        </div>
      </section>

      {/* Next best action — the one dominant panel. */}
      {nextBest && (
        <Card className={queue.length > 0 ? "border-warning/35 bg-warning/5 shadow-md" : "border-success/25 bg-success/5 shadow-sm"}>
          <CardContent className="grid gap-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
            <div aria-hidden="true" className={queue.length > 0 ? "flex h-10 w-10 items-center justify-center rounded-xl border border-warning/30 bg-warning/10 text-warning" : "flex h-10 w-10 items-center justify-center rounded-xl border border-success/30 bg-success/10 text-success"}>
              <ListChecks className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{queue.length > 0 ? "Priority queue" : "Healthy queue"}</span>
                <span className="rounded-full border border-border/60 px-2 py-0.5">{queue.length} actionable</span>
              </div>
              <div className="mt-0.5 truncate text-sm font-semibold">{nextBest.title}</div>
              <div className="text-xs text-muted-foreground">{nextBest.detail}</div>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button asChild size="sm"><Link to={nextBest.to}>{nextBest.cta}<ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" /></Link></Button>
              {canReport && nextBest.to !== "/admin/aml/austrac" && <Button asChild size="sm" variant="outline"><Link to="/admin/aml/austrac">AUSTRAC Hub<ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" /></Link></Button>}
            </div>
          </CardContent>
        </Card>
      )}

      {caseError && (
        <AmlErrorState
          title="Unable to load cases"
          message={caseError}
          detail="Queue entries and case counts may be incomplete until this succeeds."
          onRetry={refresh}
        />
      )}

      {/* Priority work queue — what requires attention, with a direct action. */}
      <Card className="overflow-hidden border-border/70 bg-card/50 shadow-md">
        <CardHeader className="border-b border-border/60 bg-muted/25 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Priority work queue</CardTitle>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/aml/cases">Open case register →</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Escalations first, then additional-information cases, then submissions to review.
          </p>
        </CardHeader>
        <CardContent>
          {loadingCases ? (
            <div className="space-y-2" role="status">
              <span className="sr-only">Loading the priority work queue</span>
              <Skeleton className="h-10 w-full" aria-hidden="true" />
              <Skeleton className="h-10 w-full" aria-hidden="true" />
            </div>
          ) : queue.length === 0 ? (
            <AmlEmptyState
              body="Nothing needs attention right now. New client submissions, additional-information cases and escalations will appear here the moment they need someone."
            />
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {queue.map(({ caseRow: c, reason, action }) => (
                <li key={c.id} className="grid gap-2 py-2.5 sm:grid-cols-[minmax(0,1.2fr)_auto] sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.subject_display_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.case_reference} · {reason}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <AmlStageBadge stage={caseStage(c)} />
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/admin/aml/cases?open=${c.id}`}>{action}</Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Operational metrics — customer pipeline (aml.view). Each tile
          deep-links to the register view the count was computed from. */}
      <AmlPageSection
        title="Customer pipeline"
        description="Where every open customer compliance case sits right now."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AmlMetricCard
            title="Onboarding in progress"
            icon={Users}
            state={caseMetricState}
            value={counts?.onboarding}
            hint="Clients currently completing onboarding."
            to="/admin/aml/cases?view=onboarding"
            tone="neutral"
          />
          <AmlMetricCard
            title="Submissions to review"
            icon={ListChecks}
            state={caseMetricState}
            value={counts?.awaitingReview}
            hint="Client submissions awaiting staff review."
            to="/admin/aml/cases?view=awaiting_review"
            tone="attention"
          />
          <AmlMetricCard
            title="Enhanced CDD"
            icon={ShieldCheck}
            state={caseMetricState}
            value={counts?.enhancedCdd}
            hint="Cases needing additional information."
            to="/admin/aml/cases?view=additional_info"
            tone="attention"
          />
          <AmlMetricCard
            title="Awaiting decision"
            icon={Gauge}
            state={caseMetricState}
            value={counts?.escalated}
            hint="Escalated cases awaiting a decision."
            to="/admin/aml/cases?view=awaiting_decision"
            tone="critical"
          />
        </div>
      </AmlPageSection>

      {/* Operational metrics — monitoring and finance (aml.investigate).
          Omitted entirely without the capability. */}
      {canInvestigate && (
        <AmlPageSection
          title="Monitoring & finance operations"
          description="Alert triage, review deadlines and funding reconciliation backlogs."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AmlMetricCard
              title="Open alerts"
              icon={Bell}
              state={monitoringMetricState}
              value={monitoring?.open_alerts}
              hint={monitoring ? `${monitoring.critical_alerts} critical` : undefined}
              to="/admin/aml/monitoring"
              tone="attention"
            />
            <AmlMetricCard
              title="Unprocessed events"
              icon={Gauge}
              state={monitoringMetricState}
              value={monitoring?.unprocessed_events}
              hint="Rule engine backlog."
              to="/admin/aml/monitoring"
              tone="attention"
            />
            <AmlMetricCard
              title="Reviews due"
              icon={ShieldCheck}
              state={monitoringMetricState}
              value={monitoring?.pending_reviews}
              hint={monitoring ? `${monitoring.overdue_reviews} overdue` : undefined}
              to="/admin/aml/monitoring"
              tone="attention"
            />
            <AmlMetricCard
              title="Funding discrepancies"
              icon={Wallet}
              state={discrepancyMetricState}
              value={openDiscrepancies}
              hint="Open finance discrepancies to resolve."
              to="/admin/aml/finance"
              tone="attention"
            />
          </div>
        </AmlPageSection>
      )}

      {/* Partner-domain queues (Phase 8): renders nothing while
          aml_partner_operations_reporting is off — the home is unchanged. */}
      <PartnerOpsQueueStrip />

      {/* Action-led "Do next" — only capabilities the user actually holds. */}
      <Card className="overflow-hidden border-border/70 bg-card/50 shadow-md">
        <CardHeader className="border-b border-border/60 bg-muted/25 pb-3">
          <CardTitle className="text-base">Your workspaces</CardTitle>
          <p className="text-xs text-muted-foreground">
            Areas available to you right now.
          </p>
        </CardHeader>
        <CardContent>
          {visibleActions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No workspaces yet — ask your compliance administrator for access to get started.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {visibleActions.map((a) => {
                const Icon = a.icon;
                return (
                  <li
                    key={a.key}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-card/40 p-3"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        aria-hidden="true"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{a.label}</div>
                        <div className="text-xs text-muted-foreground">{a.description}</div>
                      </div>
                    </div>
                    <Button
                      asChild
                      size="sm"
                      variant={a.variant === "primary" ? "default" : "outline"}
                      className="shrink-0"
                    >
                      <Link to={a.to}>{a.cta}</Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Latest cases with actionable empty state */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Latest cases</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingCases ? (
            <div className="space-y-2" role="status">
              <span className="sr-only">Loading latest cases</span>
              <Skeleton className="h-10 w-full" aria-hidden="true" />
              <Skeleton className="h-10 w-full" aria-hidden="true" />
              <Skeleton className="h-10 w-full" aria-hidden="true" />
            </div>
          ) : recent.length === 0 ? (
            <AmlEmptyState
              body="No cases yet. Cases open when a client is activated for compliance from their client record — nothing is generated automatically from marketing leads."
              action={
                <Button asChild size="sm" variant="outline">
                  <Link to="/clients">Find a client to activate</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border/60 text-sm">
              {recent.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.subject_display_name}</div>
                    <div className="text-xs text-muted-foreground">{c.case_reference}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.risk_rating && <AmlRiskBadge risk={c.risk_rating} />}
                    <AmlStageBadge stage={caseStage(c)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
