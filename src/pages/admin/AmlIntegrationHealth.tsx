/**
 * AmlIntegrationHealth — Phase 11 dedicated Integration Health workspace.
 *
 * Closes Directive 13 (long-term): provider cost / latency / failure
 * telemetry lives in its own surface, out of the daily AML workflow.
 * The Phase 7 metrics-relocation flag already hides the tiles from the
 * Configuration header; this page is where they now live.
 *
 * Gates:
 *   - Superadmin OR MLRO can view (mirrors who can already read
 *     provider configuration). Non-MLRO users see a read-only banner.
 *
 * Guardrails preserved:
 *   - Provider Configuration (Directive 12) is NOT rendered here — this
 *     workspace only reads existing `aml.provider_metrics_daily` +
 *     `aml.provider_configs` health snapshots via `aml-tenant`.
 *   - Launch Ops (Directive 9) untouched.
 *   - No schema change, no new edge function, no data migration.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, Gauge, HelpCircle,
  TrendingDown, TrendingUp, Lock, XCircle, type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AmlAccessGate,
  AmlLoadingState,
  AmlMetricCard,
  AmlPageHeader,
  AmlRefreshButton,
} from "@/components/aml/primitives";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAmlAccess } from "@/hooks/useAmlAccess";
import {
  amlTenantApi,
  AML_PROVIDER_CAPABILITIES,
  type AmlProviderCapability,
  type AmlProviderConfig,
  type AmlProviderHealth,
  type AmlProviderMetricRollup,
} from "@/lib/aml/amlTenantApi";
import { useAmlV3Flags } from "@/lib/aml/useAmlV3Flags";
import { PartnerEventsOpsCard } from "@/components/aml/PartnerEventsOpsCard";
import { ProviderReadinessCard } from "@/components/aml/ProviderReadinessCard";

const DAY_OPTIONS = [7, 14, 30, 60, 90] as const;

interface TimelinePoint {
  metric_date: string;
  calls: number;
  failures: number;
  cost_cents: number;
}

const HEALTH_TONE: Record<AmlProviderHealth, string> = {
  ok: "text-success",
  degraded: "text-warning",
  failing: "text-destructive",
  unknown: "text-muted-foreground",
};

const HEALTH_LABEL: Record<AmlProviderHealth, string> = {
  ok: "Healthy", degraded: "Degraded", failing: "Failing", unknown: "Unknown",
};

/** Per-health icons — the state must never be signalled by colour alone
 * (a "Failing" badge previously rendered a red check mark). */
const HEALTH_ICON: Record<AmlProviderHealth, LucideIcon> = {
  ok: CheckCircle2,
  degraded: AlertTriangle,
  failing: XCircle,
  unknown: HelpCircle,
};

function HealthBadge({ health, count }: { health: AmlProviderHealth; count?: number }) {
  const Icon = HEALTH_ICON[health];
  return (
    <Badge variant="outline" className="gap-1">
      <Icon aria-hidden="true" className={`h-3 w-3 ${HEALTH_TONE[health]}`} />
      {HEALTH_LABEL[health]}
      {count !== undefined ? `: ${count}` : null}
    </Badge>
  );
}

function fmtCurrency(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: 2 })
    .format(cents / 100);
}

function fmtPct(rate: number) {
  return `${(rate * 100).toFixed(rate >= 0.1 ? 1 : 2)}%`;
}

export default function AmlIntegrationHealth() {
  const { isSuperadmin } = useAuth();
  const { isMlro, loading: accessLoading } = useAmlAccess();
  const { metricsRelocation } = useAmlV3Flags();

  const canView = isSuperadmin || isMlro;

  const [days, setDays] = useState<number>(30);
  const [capability, setCapability] = useState<AmlProviderCapability | "__all__">("__all__");
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<AmlProviderConfig[]>([]);
  const [rollup, setRollup] = useState<AmlProviderMetricRollup[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const [providerList, roll] = await Promise.all([
        amlTenantApi.listProviders().catch(() => [] as AmlProviderConfig[]),
        amlTenantApi.metricsRollup(days, capability === "__all__" ? undefined : capability),
      ]);
      setProviders(providerList);
      setRollup(roll.providers ?? []);
      setTimeline((roll.timeline ?? []) as TimelinePoint[]);
    } catch (e) {
      toast.error(`Failed to load integration health: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [canView, days, capability]);

  useEffect(() => {
    if (!accessLoading) void load();
  }, [accessLoading, load]);

  const totals = useMemo(() => {
    let calls = 0, failures = 0, cost = 0, latencySum = 0, latencyN = 0;
    for (const r of rollup) {
      calls += r.calls;
      failures += r.failures;
      cost += r.cost_cents;
      if (r.calls > 0) { latencySum += r.avg_latency_ms * r.calls; latencyN += r.calls; }
    }
    return {
      calls,
      failures,
      cost,
      failureRate: calls > 0 ? failures / calls : 0,
      avgLatency: latencyN > 0 ? Math.round(latencySum / latencyN) : 0,
    };
  }, [rollup]);

  const providerHealthCount = useMemo(() => {
    const c = { ok: 0, degraded: 0, failing: 0, unknown: 0 } as Record<AmlProviderHealth, number>;
    for (const p of providers) {
      const s = (p.last_health_status ?? "unknown") as AmlProviderHealth;
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [providers]);

  // Health matched against rollup (composite badge per row)
  const rowsWithHealth = useMemo(() => {
    return rollup
      .slice()
      .sort((a, b) => b.calls - a.calls)
      .map((r) => {
        const cfg = providers.find(
          (p) => p.capability === r.capability && p.provider_key === r.provider_key,
        );
        return {
          ...r,
          health: (cfg?.last_health_status ?? "unknown") as AmlProviderHealth,
          message: cfg?.last_health_message ?? null,
          currency: cfg?.currency ?? "AUD",
          active: cfg?.active ?? null,
          mode: cfg?.mode ?? null,
        };
      });
  }, [rollup, providers]);

  const timelineMax = Math.max(1, ...timeline.map((t) => t.calls));
  const timelineTotals = useMemo(() => {
    let calls = 0, failures = 0;
    for (const t of timeline) { calls += t.calls; failures += t.failures; }
    return { calls, failures };
  }, [timeline]);

  if (!canView) {
    return (
      <div className="p-6">
        <AmlAccessGate
          title="Restricted"
          body="Integration Health is available to the MLRO and superadmins only."
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <AmlPageHeader
        headingLevel="h1"
        icon={Gauge}
        title="AML Integration Health"
        description="Provider cost, latency, and failure telemetry for identity, screening, monitoring, and reporting connectors. Relocated out of the daily workflow per Directive 13."
        actions={
          <>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-[140px]" aria-label="Telemetry window">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_OPTIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>Last {d} days</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={capability}
              onValueChange={(v) => setCapability(v as AmlProviderCapability | "__all__")}
            >
              <SelectTrigger className="w-[220px]" aria-label="Provider capability filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All capabilities</SelectItem>
                {AML_PROVIDER_CAPABILITIES.map((c) => (
                  <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AmlRefreshButton onClick={load} loading={loading} />
          </>
        }
      >
        {!metricsRelocation && (
          <p className="text-xs text-warning">
            Metrics relocation is not complete — the legacy tiles still render
            in Configuration. Finish the relocation from the Cutover Console.
          </p>
        )}
      </AmlPageHeader>

      {!isMlro && isSuperadmin && (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>Superadmin view</AlertTitle>
          <AlertDescription>
            Provider configuration remains restricted to the MLRO — this
            workspace is read-only telemetry.
          </AlertDescription>
        </Alert>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <AmlMetricCard
          title="Provider calls"
          icon={Activity}
          state={loading ? "loading" : "ready"}
          value={totals.calls.toLocaleString('en-AU')}
          hint={`over ${days}d`}
        />
        <AmlMetricCard
          title="Failure rate"
          icon={AlertTriangle}
          state={loading ? "loading" : "ready"}
          value={fmtPct(totals.failureRate)}
          hint={`${totals.failures.toLocaleString('en-AU')} failures`}
        />
        <AmlMetricCard
          title="Avg latency"
          icon={TrendingUp}
          state={loading ? "loading" : "ready"}
          value={`${totals.avgLatency.toLocaleString('en-AU')} ms`}
          hint="calls-weighted"
        />
        <AmlMetricCard
          title="Total cost"
          icon={TrendingDown}
          state={loading ? "loading" : "ready"}
          value={fmtCurrency(totals.cost)}
          hint={`over ${days}d`}
        />
      </div>

      {/* Provider health summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configured providers</CardTitle>
          <CardDescription>
            Latest health snapshot per configured provider. Read-only —
            edit under Organisation Settings → Providers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No providers configured. Add them in Organisation Settings → Providers.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(["ok", "degraded", "failing", "unknown"] as AmlProviderHealth[]).map((s) => (
                <HealthBadge key={s} health={s} count={providerHealthCount[s] ?? 0} />
              ))}
              <Badge variant="secondary">Total: {providers.length}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-provider rollup */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Per-provider rollup</CardTitle>
          <CardDescription>Sorted by call volume over the window.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <AmlLoadingState variant="spinner" label="Loading telemetry…" />
          ) : rowsWithHealth.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No provider calls recorded in the selected window.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Capability</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Failure rate</TableHead>
                  <TableHead className="text-right">Avg latency</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowsWithHealth.map((r) => (
                  <TableRow key={`${r.capability}::${r.provider_key}`}>
                    <TableCell className="text-xs uppercase tracking-wide text-muted-foreground">
                      {r.capability.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="font-medium">
                      {r.provider_key}
                      {r.mode === "simulator" && (
                        <Badge variant="outline" className="ml-2 text-xs">simulator</Badge>
                      )}
                      {r.active === false && (
                        <Badge variant="outline" className="ml-2 text-xs">inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.calls.toLocaleString('en-AU')}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={
                        r.failure_rate > 0.15 ? "text-destructive"
                          : r.failure_rate > 0.05 ? "text-warning"
                          : "text-foreground"
                      }>
                        {fmtPct(r.failure_rate)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.avg_latency_ms.toLocaleString('en-AU')} ms</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtCurrency(r.cost_cents, r.currency)}</TableCell>
                    <TableCell>
                      <HealthBadge health={r.health} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* IDV/screening provider preflight — what would actually run if staff
          requested a verification right now, and why. */}
      <ProviderReadinessCard />

      {/* Partner compliance events (Phase 6): outbox backlog, refresh
          obligations and arrangement reviews for the reliance domain. */}
      <PartnerEventsOpsCard />

      {/* Daily call timeline (sparkline-style bars, no chart lib dep) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Daily call volume</CardTitle>
          <CardDescription>Failures overlaid in destructive tone.</CardDescription>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity in this window.</p>
          ) : (
            <>
              <p className="sr-only">
                Daily call volume across {timeline.length} days:{" "}
                {timelineTotals.calls.toLocaleString('en-AU')} calls and{" "}
                {timelineTotals.failures.toLocaleString('en-AU')} failures in the
                selected window.
              </p>
              <div className="flex items-end gap-1 h-32" aria-hidden="true">
              {timeline.map((t) => {
                const h = Math.max(2, Math.round((t.calls / timelineMax) * 100));
                const fh = t.calls > 0 ? Math.max(1, Math.round((t.failures / t.calls) * h)) : 0;
                return (
                  <div
                    key={t.metric_date}
                    className="flex-1 min-w-[6px] relative group"
                    title={`${t.metric_date} · ${t.calls} calls · ${t.failures} failures · ${fmtCurrency(t.cost_cents)}`}
                  >
                    <div className="absolute bottom-0 left-0 right-0 bg-primary/70 rounded-t"
                         style={{ height: `${h}%` }} />
                    {fh > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 bg-destructive rounded-t"
                           style={{ height: `${fh}%` }} />
                    )}
                  </div>
                );
              })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
