import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Gauge,
  ShieldCheck,
  Users,
  Info,
  Bell,
  ArrowRight,
  ChevronRight,
  Lock,
} from "lucide-react";
import { amlCasesApi, type AmlCase } from "@/lib/aml/amlCasesApi";
import { amlMonitoringApi, type AmlMonitoringSummary } from "@/lib/aml/amlMonitoringApi";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import { hasAmlCapability } from "@/lib/aml/permissions";
import { suggestAmlLanding } from "@/lib/aml/defaultLanding";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { caseStage } from "@/lib/aml/caseDimensions";
import { cn } from "@/lib/utils";
import { AML_COMMAND_REFRESH_EVENT } from "@/lib/aml/amlRoutes";
import {
  AmlEmptyState,
  AmlErrorState,
  AmlMetricCard,
  AmlRiskBadge,
  AmlStageBadge,
} from "@/components/aml/primitives";
import AmlComplianceHomeV3 from "./AmlComplianceHomeV3";

/**
 * Phase 2 — Compliance Home (role-adaptive).
 *
 * All tiles and queue links are derived from the user's **effective
 * capabilities** returned by `useAmlAccess`. Restricted metric counts
 * (reporting SLA, configuration health) are never rendered — not even
 * as blurred placeholders — for users lacking the underlying capability,
 * to comply with tipping-off protections in AGENTS.md §2.
 */


export default function AmlOverview() {
  const { complianceHome: v3Home, loading: v3Loading } = useAmlV3Flags();

  // Phase 3 (V3) — swap to the action-led Compliance Home when the
  // `aml_v3_compliance_home` feature flag is on. Default false → V2 renders.
  if (!v3Loading && v3Home) {
    return <AmlComplianceHomeV3 />;
  }

  return <AmlOverviewV2 />;
}

function AmlOverviewV2() {
  const { roles, loading: accessLoading } = useAmlAccess();

  const canView = hasAmlCapability(roles, "aml.view");
  const canInvestigate = hasAmlCapability(roles, "aml.investigate");
  const canReport = hasAmlCapability(roles, "aml.report");
  const canConfigure = hasAmlCapability(roles, "aml.configure");

  const [loadingCases, setLoadingCases] = useState(true);
  const [cases, setCases] = useState<AmlCase[]>([]);
  const [totalCases, setTotalCases] = useState(0);
  const [caseError, setCaseError] = useState<string | null>(null);

  const [monitoring, setMonitoring] = useState<AmlMonitoringSummary | null>(null);
  const [loadingMonitoring, setLoadingMonitoring] = useState(false);
  const [monitoringSettled, setMonitoringSettled] = useState(false);

  const loadCases = useCallback(async (alive: () => boolean) => {
    try {
      setLoadingCases(true);
      setCaseError(null);
      const res = await amlCasesApi.list({ limit: 5 });
      if (!alive()) return;
      setCases(res.cases ?? []);
      setTotalCases(res.total ?? 0);
    } catch (e: any) {
      if (alive()) setCaseError(e?.message ?? "Unable to load cases");
    } finally {
      if (alive()) setLoadingCases(false);
    }
  }, []);

  const loadMonitoring = useCallback(async (alive: () => boolean) => {
    try {
      setLoadingMonitoring(true);
      const s = await amlMonitoringApi.summary();
      if (alive()) setMonitoring(s);
    } catch {
      // tile shows its unavailable state
      if (alive()) setMonitoring(null);
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
    void loadCases(() => alive);
    return () => { alive = false; };
  }, [canView, loadCases]);

  useEffect(() => {
    if (!canInvestigate) return;
    let alive = true;
    void loadMonitoring(() => alive);
    return () => { alive = false; };
  }, [canInvestigate, loadMonitoring]);

  const refresh = useCallback(() => {
    const alive = () => true;
    if (canView) void loadCases(alive);
    if (canInvestigate) void loadMonitoring(alive);
  }, [canView, canInvestigate, loadCases, loadMonitoring]);

  const openCount = useMemo(
    () => cases.filter((c) => !["cleared", "closed", "blocked"].includes(c.status)).length,
    [cases],
  );
  const escalated = useMemo(
    () => cases.filter((c) => c.status === "escalated_mlro").length,
    [cases],
  );

  /*
    ── The command centre's Refresh was a placebo ────────────────────
    `AmlLayout` dispatches `aml-command-refresh` and updates a "Refreshed
    HH:MM" stamp, and NOTHING in the product had ever listened for it. The
    button moved a clock. That was survivable while this page carried a
    Refresh of its own; with the duplicate header gone it would have been the
    only one, so the page answers the event.
  */
  useEffect(() => {
    const onCommandRefresh = () => { void refresh(); };
    window.addEventListener(AML_COMMAND_REFRESH_EVENT, onCommandRefresh);
    return () => window.removeEventListener(AML_COMMAND_REFRESH_EVENT, onCommandRefresh);
  }, [refresh]);

  const landing = useMemo(() => suggestAmlLanding(roles), [roles]);


  const caseMetricState = loadingCases ? "loading" : caseError ? "unavailable" : "ready";
  // "loading" until the fetch has actually settled — never a fabricated zero
  // in the paint before the effect runs.
  const monitoringMetricState = !monitoringSettled || loadingMonitoring
    ? "loading"
    : monitoring === null
      ? "unavailable"
      : "ready";

  // No access at all — actionable empty state.
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
    <div className="space-y-6">
      {/*
        ── The page's own header is gone ─────────────────────────────
        The command centre above it already draws a title, a strapline and a
        Refresh. This drew a second title, a second strapline and a second
        Refresh directly underneath — and the working one was the LOWER of
        the two, because the shell's button dispatched an event nothing had
        ever listened for. The event is answered now (see below), so the
        surviving Refresh is the one that was already there.
      */}

      {/* Role-adaptive landing hint */}
      {landing && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium">Jump back into your queue</div>
              <div className="text-xs text-muted-foreground">{landing.reason}</div>
            </div>
            <Button asChild size="sm">
              <Link to={landing.path}>
                {landing.label}
                <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {caseError && (
        <AmlErrorState
          title="Unable to load cases"
          message={caseError}
          onRetry={refresh}
        />
      )}

      {/*
        ── One strip, not six cards ──────────────────────────────────
        These were six full metric cards in two sections: six borders, six
        paddings and six headers around six single-digit numbers, most of
        them a healthy zero — taking more height than the case list they sit
        above. They are a glance, not a reading.

        One card, two labelled groups, six dense cells. Every cell keeps its
        deep link, its loading skeleton and its "Not available" reading, so
        nothing about what the numbers MEAN changed — only how much of the
        page they take to say it.
      */}
      <Card>
        <CardContent className={cn(
          "grid gap-x-6 gap-y-5 p-4",
          canInvestigate && "lg:grid-cols-2 lg:divide-x lg:divide-border/60",
        )}>
          <section aria-labelledby="home-cases-heading">
            <h2
              id="home-cases-heading"
              className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
            >
              Customer cases
            </h2>
            {/* Two across on a phone, three from `sm`.

                  It was `grid-cols-1` below `sm`, which turned the strip
                  back into exactly what it replaced: six full-width cells,
                  one per row, about 900px of an 844px screen before the case
                  list began. The cells were made dense precisely so six
                  single-digit numbers would stop taking that much page, and
                  a phone is where that matters most.

                  Two rather than three, because three at 390px gives each
                  cell ~110px and the labels are letter-spaced capitals:
                  "UNPROCESSED" is wider than that and broke mid-word. Two
                  gives ~167px, every label wraps at a space, and the strip
                  is still less than half the height it was. */}
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border/50 [&>*]:min-w-0">
              <AmlMetricCard
                dense
                title="Total"
                icon={Users}
                state={caseMetricState}
                value={totalCases}
                hint="All statuses."
                to="/admin/aml/cases"
              />
              <AmlMetricCard
                dense
                title="Open"
                icon={Gauge}
                state={caseMetricState}
                value={openCount}
                hint={`Of the ${cases.length || 0} most recent.`}
                to="/admin/aml/cases"
              />
              <AmlMetricCard
                dense
                title="Awaiting decision"
                icon={ShieldCheck}
                state={caseMetricState}
                value={escalated}
                hint="Escalated to the MLRO."
                to="/admin/aml/cases?view=awaiting_decision"
              />
            </div>
          </section>

          {canInvestigate && (
            <section aria-labelledby="home-monitoring-heading" className="lg:pl-6">
              <h2
                id="home-monitoring-heading"
                className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
              >
                Monitoring
              </h2>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-border/50 [&>*]:min-w-0">
                <AmlMetricCard
                  dense
                  title="Open alerts"
                  icon={Bell}
                  state={monitoringMetricState}
                  value={monitoring?.open_alerts}
                  hint={monitoring ? `${monitoring.critical_alerts} critical` : undefined}
                  to="/admin/aml/monitoring"
                />
                <AmlMetricCard
                  dense
                  title="Unprocessed"
                  icon={Gauge}
                  state={monitoringMetricState}
                  value={monitoring?.unprocessed_events}
                  hint="Rule engine backlog."
                  to="/admin/aml/monitoring"
                />
                <AmlMetricCard
                  dense
                  title="Periodic reviews"
                  icon={ShieldCheck}
                  state={monitoringMetricState}
                  value={monitoring?.pending_reviews}
                  hint={monitoring ? `${monitoring.overdue_reviews} overdue` : undefined}
                  to="/admin/aml/monitoring"
                />
              </div>
            </section>
          )}
        </CardContent>
      </Card>

      {/*
        ── "Your queues" is gone, and nothing left with it ───────────
        It listed five destinations and every one of them is now in the
        navigation: the case register under Customer Compliance, Monitoring,
        Investigations & EDD and Records & Privacy under Compliance Home, and
        the AUSTRAC Hub as a workspace of its own. A card repeating them was
        a third way to reach the same pages — after the primary strip and the
        "jump back into your queue" card directly above it, which is
        role-adaptive and points at the one that matters today.
      */}
      {/* Latest cases with actionable empty state */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Latest cases</CardTitle>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/aml/cases">Open case register →</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingCases ? (
            <div className="space-y-2" role="status">
              <span className="sr-only">Loading latest cases</span>
              <Skeleton className="h-10 w-full" aria-hidden="true" />
              <Skeleton className="h-10 w-full" aria-hidden="true" />
              <Skeleton className="h-10 w-full" aria-hidden="true" />
            </div>
          ) : cases.length === 0 ? (
            <AmlEmptyState
              body="No cases yet. Cases are only created after a human-confirmed client activation — nothing is auto-generated from marketing leads."
              action={
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/aml/cases">Go to Case register</Link>
                </Button>
              }
            />
          ) : (
            /*
              ── The rows open the case ────────────────────────────────
              They were static text: a customer's name, their reference and
              two badges, with no way to act on any of it. The only route on
              the card was "Open case register", which puts an operator back
              in a list they were already looking at a row of.
            */
            <ul className="divide-y divide-border/60 text-sm">
              {cases.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/admin/aml/cases/${c.id}`}
                    className="group -mx-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md px-2 py-2.5 transition-colors hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    aria-label={`Open ${c.subject_display_name}'s case, ${c.case_reference}`}
                  >
                    {/* The customer's name is what the row is FOR, and it was
                        losing the argument: a `shrink-0` badge cluster took
                        230 of a 358px row and left "Bartholome…". The cluster
                        shrinks now — its badges carry their own nowrap, so
                        they wrap onto a second line rather than compress —
                        and `basis-44` states how much the name needs before
                        that happens. */}
                    <div className="min-w-0 flex-1 basis-44">
                      <div className="truncate font-medium transition-colors group-hover:text-primary">
                        {c.subject_display_name}
                      </div>
                      <div className="text-xs text-muted-foreground">{c.case_reference}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.risk_rating && <AmlRiskBadge risk={c.risk_rating} />}
                      <AmlStageBadge stage={caseStage(c)} />
                      <ChevronRight
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/*
        ── The surfaces that would otherwise have no route ──────────────
        Monitoring, Investigations & EDD, Records & Privacy and
        Configuration all left the navigation. Monitoring did not need a
        door here — the three monitoring readings in the strip above already
        deep-link to it — but the other three had none left at all, and two
        of them are statutory: retention schedules under s.107, and the
        sanctions register's health, which is what a screening refuses
        against. Hiding a PAGE is what once stranded that behind a blocked
        case.

        So this is one quiet line at the foot of the page rather than a
        card, a tile or a strip: no heading, no borders, no calls to action,
        and each entry gated on the capability that surface actually needs.
      */}
      {(canInvestigate || canView || canConfigure) && (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-1 text-xs text-muted-foreground">
          <span className="text-muted-foreground/70">Also in this workspace</span>
          {[
            { label: "Investigations & EDD", to: "/admin/aml/investigations", show: canInvestigate },
            { label: "Records & Privacy", to: "/admin/aml/records", show: canView },
            { label: "Configuration", to: "/admin/aml/configuration", show: canConfigure },
          ].filter((e) => e.show).map((e, i, all) => (
            <span key={e.to} className="flex items-center gap-1.5">
              <Link
                to={e.to}
                className="rounded-sm underline-offset-4 transition-colors hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {e.label}
              </Link>
              {i < all.length - 1 && <span aria-hidden className="text-muted-foreground/40">·</span>}
            </span>
          ))}
        </p>
      )}

      {/* Restricted-capability affordances are gated where they are drawn;
          nothing more leaks into the home for users without the permission. */}
      {!canReport && !canConfigure && (
        <p className="text-xs text-muted-foreground">
          Reporting and configuration surfaces are restricted and only appear for MLRO users.
        </p>
      )}
      {/*
        A second Configuration button used to sit here, under a comment that
        already said "restricted-capability affordances live in tiles above".
        It went to the same place as the tile and contradicted its own
        neighbour. Configuration is still reached from exactly two places, and
        the first of them has now moved TWICE: out of the queue list (it is
        settings, not a queue) into this page's header, and out of that header
        into the command centre's own action row when the header went — one
        door, still gated on `aml.configure`, and now one click from wherever
        an administrator is rather than only from here. The second is Stage
        5's "open list health" when screening cannot run. It never left the
        product, because hiding it is what once stranded the sanctions
        register behind a blocked case.
      */}
    </div>
  );
}
