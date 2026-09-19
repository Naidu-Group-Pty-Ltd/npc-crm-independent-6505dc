import { useEffect, useState, useMemo } from "react";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from '@/components/ui/search-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DashboardThemeFrame } from "@/components/layout/DashboardThemeFrame";
import { cn } from "@/lib/utils";
import {
  RefreshCw, Search, Coins, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, Activity, Clock3, ShieldCheck, UserRound, Building2, AlertTriangle,
  Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { TokenEventDetailsDrawer } from "@/components/billing/TokenEventDetailsDrawer";

interface UsageRow {
  id: string;
  created_at: string;
  updated_at?: string | null;
  user_id: string | null;
  function_name: string;
  kind: string;
  idempotency_key: string;
  actual_tokens: number;
  duration_ms: number;
  status: string;
  error_message?: string | null;
  job_id?: string | null;
  agency_id?: string | null;
}

const FN_LABEL: Record<string, string> = {
  "generate-investment-report": "Investment Report",
  "generate-bulk-reports": "Bulk Reports",
  "generate-market-intelligence-report": "Market Intelligence",
  "generate-portfolio-analysis": "Portfolio Analysis",
  "generate-chart-analysis": "Chart Analysis",
  "regenerate-report-qualitative": "Report Regeneration",
};

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const className = normalized === "success" || normalized === "committed" || normalized === "completed" || normalized.includes("commit")
    ? "border-success/25 bg-success/10 text-success dark:text-success"
    : normalized.includes("fail") || normalized.includes("cancel") || normalized === "insufficient_funds" || normalized.includes("error")
      ? "border-destructive/25 bg-destructive/10 text-destructive"
      : normalized.includes("reserve") || normalized.includes("pending") || normalized.includes("progress")
        ? "border-brand-500/25 bg-brand-500/10 text-brand-700 dark:text-brand-300"
        : "border-border/70 bg-muted/60 text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("max-w-full whitespace-nowrap rounded-full px-2.5 py-0.5 capitalize", className)} title={status}>
      <span className="min-w-0 truncate">{status.replace(/_/g, " ")}</span>
    </Badge>
  );
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <Badge variant="secondary" className="max-w-full rounded-full border border-border/60 bg-muted/55 px-2.5 py-0.5 text-muted-foreground" title={kind}>
      <span className="min-w-0 truncate">{kind}</span>
    </Badge>
  );
}

function fmtMs(ms: number) {
  if (!ms) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const PREMIUM_SCROLLBAR = "[scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-primary/35 [&::-webkit-scrollbar-track]:bg-transparent";

/**
 * Token usage history — the metering audit view, embeddable as a tab of the
 * consolidated Billing & Usage page (formerly the standalone /billing/usage
 * page; behaviour is unchanged).
 */
export function TokenUsagePanel() {
  const [scope, setScope] = useState<"mine" | "agency">("mine");
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [agencyDenied, setAgencyDenied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await invokeSecureFunction<{ rows: UsageRow[]; error?: string }>(
      "list-token-usage", { scope, limit: 500 },
    );
    if (error && scope === "agency") {
      setLoadError(typeof error === "string" ? error : "Agency-wide view requires admin permission — showing your usage instead.");
      setAgencyDenied(true);
      setScope("mine");
    } else if (error) {
      setLoadError(typeof error === "string" ? error : "Unable to load token usage history.");
    } else if (!error && data?.rows) {
      setRows(data.rows);
      setAgencyDenied(false);
      setLoadError(null);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [scope]);
  useEffect(() => { setPage(1); }, [scope, search, pageSize]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.function_name, r.kind, r.idempotency_key, r.status].some((v) =>
        String(v ?? "").toLowerCase().includes(q),
      ),
    );
  }, [rows, search]);

  // The plan's included allowance, so this panel answers "how much do I get"
  // as well as "how much have I used". Only meaningful once the workspace is
  // on a plan that includes credits — a workspace running on top-up packs
  // alone has an allowance of zero and gets no tile rather than a "0".
  const { balance } = useTokenBalance();
  const includedMonthly = balance?.allowance ?? 0;

  const totals = useMemo(() => {
    const used = filtered.reduce((s, r) => s + (r.actual_tokens || 0), 0);
    return { used, count: filtered.length };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageRows = filtered.slice(pageStart, pageStart + pageSize);
  const isInitialLoading = loading && rows.length === 0;
  const scopeLabel = scope === "agency" ? "Agency-wide" : "My usage";

  const kpis = [
    ...(includedMonthly > 0
      ? [
          {
            label: "Included Monthly",
            value: includedMonthly.toLocaleString('en-AU'),
            icon: Zap,
            helper: balance?.planName
              ? `Credits included with ${balance.planName}, every month`
              : "Credits included with your plan, every month",
            accent: "from-primary/15 via-card to-muted/30",
            iconClass: "border-primary/25 bg-primary/10 text-primary",
            valueClass: "text-primary",
          },
        ]
      : []),
    {
      label: "Generations",
      value: totals.count.toLocaleString('en-AU'),
      icon: Activity,
      helper: "Filtered generation records",
      accent: "from-primary/15 via-card to-muted/30",
      iconClass: "border-primary/20 bg-primary/10 text-primary",
      valueClass: "text-primary",
    },
    {
      label: "Tokens Used",
      value: totals.used.toLocaleString('en-AU'),
      icon: Coins,
      helper: "Actual committed usage",
      accent: "from-success/12 via-card to-muted/30",
      iconClass: "border-success/25 bg-success/10 text-success dark:text-success",
      valueClass: "text-success dark:text-success",
    },
  ];

  return (
    <div className="min-w-0 space-y-5">
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        {kpis.map(({ label, value, icon: Icon, helper, accent, iconClass, valueClass }) => (
          <DashboardThemeFrame key={label} variant="premiumCard" className={cn("group p-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_20px_55px_rgba(15,23,42,0.12)] dark:hover:shadow-[0_20px_55px_rgba(0,0,0,0.34)]", `bg-gradient-to-br ${accent}`)}>
            <div className="flex min-h-[9.5rem] min-w-0 flex-col justify-between gap-5 p-5">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
                  {isInitialLoading ? (
                    <Skeleton className="mt-3 h-10 w-32 rounded-xl sm:h-12" />
                  ) : (
                    <p className={cn("mt-3 truncate text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl", valueClass)} title={value}>{value}</p>
                  )}
                </div>
                <div className={cn("rounded-2xl border p-2.5 shadow-sm transition-all duration-200 group-hover:scale-105 group-hover:shadow-[0_0_0_4px_hsl(var(--primary)/0.08)]", iconClass)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
              {isInitialLoading ? (
                <Skeleton className="h-5 w-full rounded-lg" />
              ) : (
                <p className="truncate border-t border-border/50 pt-3 text-xs text-muted-foreground" title={helper}>{helper}</p>
              )}
            </div>
          </DashboardThemeFrame>
        ))}
      </div>

      <Card className="min-w-0 overflow-hidden rounded-[1.75rem] border-border/70 bg-card/95 shadow-[0_22px_60px_rgba(15,23,42,0.10)] transition-shadow duration-200 hover:shadow-[0_28px_75px_rgba(15,23,42,0.13)] ring-1 ring-black/5 dark:border-white/10 dark:bg-background/75 dark:shadow-black/35 dark:ring-white/5">
        <CardHeader className="border-b border-border/60 bg-[linear-gradient(135deg,hsl(var(--muted)/0.28),hsl(var(--card)/0.55))] px-4 py-5 sm:px-6">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <CardTitle className="flex min-w-0 items-center gap-2 text-xl tracking-tight">
                <span className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
                  <Clock3 className="h-5 w-5" />
                </span>
                <span className="truncate">Activity</span>
              </CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Click an idempotency key to see the full reserve / commit / cancel trail.
              </CardDescription>
            </div>
            <Button
              onClick={load}
              variant="outline"
              size="sm"
              disabled={loading}
              className="min-h-10 w-full shrink-0 rounded-xl border-primary/25 bg-background/85 px-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 sm:w-auto"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="min-w-0 space-y-5 p-4 sm:p-6">
          <Tabs value={scope} onValueChange={(v) => setScope(v as any)}>
            <DashboardThemeFrame variant="toolbar" className="min-w-0 overflow-hidden items-stretch justify-between gap-3 border-primary/10 bg-muted/25 p-2.5 sm:items-center">
              <TabsList className="grid h-auto w-full grid-cols-2 rounded-2xl border border-border/60 bg-background/70 p-1 shadow-inner sm:w-auto">
                <TabsTrigger value="mine" className="min-w-0 gap-2 rounded-xl px-3 py-2 text-muted-foreground transition-all duration-200 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/35 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_10px_24px_hsl(var(--primary)/0.18)]">
                  <UserRound className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">My usage</span>
                </TabsTrigger>
                <TabsTrigger value="agency" className="min-w-0 gap-2 rounded-xl px-3 py-2 text-muted-foreground transition-all duration-200 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/35 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_10px_24px_hsl(var(--primary)/0.18)]">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Agency-wide</span>
                </TabsTrigger>
              </TabsList>
              <SearchInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search by kind, function, status..."
                aria-label="Search token usage by kind, function, status, or idempotency key"
                containerClassName="group min-w-0 flex-1 sm:max-w-md"
                className="min-h-10 min-w-0 rounded-2xl border-border/70 bg-background/85 pr-3 shadow-sm transition-all duration-200 placeholder:text-muted-foreground/75 hover:border-primary/30 hover:bg-background hover:shadow-[0_10px_24px_rgba(15,23,42,0.06)] focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/30"
                iconClassName="left-3.5 transition-colors group-focus-within:text-primary"
              />
            </DashboardThemeFrame>

            <TabsContent value={scope} className="mt-4 min-w-0 space-y-3">
              <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/60 bg-muted/25 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  {scope === "agency" ? <Building2 className="h-4 w-4 shrink-0 text-primary" /> : <UserRound className="h-4 w-4 shrink-0 text-primary" />}
                  <span className="min-w-0 truncate">
                    Viewing scope: <span className="font-semibold text-foreground">{scopeLabel}</span>
                  </span>
                </div>
                <span className="min-w-0 truncate" title={scope === "agency" ? "Agency-wide data is limited to your existing permissions." : "Showing records scoped to your authenticated user."}>
                  {scope === "agency" ? "Agency visibility follows your existing role permissions." : "Personal usage scoped to your authenticated account."}
                </span>
              </div>
              {agencyDenied && (
                <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-3 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 break-words">Agency-wide view requires admin permission — showing your usage instead.</span>
                </div>
              )}
              {loadError && !agencyDenied && (
                <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs text-destructive sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 break-words">{loadError}</span>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10" onClick={load} disabled={loading}>
                    Retry
                  </Button>
                </div>
              )}
              {loading ? (
                <div className="space-y-3 rounded-2xl border border-border/60 bg-background/45 p-3">
                  <div className="flex items-center justify-between gap-3 px-1">
                    <Skeleton className="h-4 w-36 rounded-lg" />
                    <Skeleton className="h-4 w-24 rounded-lg" />
                  </div>
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
                </div>
              ) : loadError && rows.length === 0 ? (
                <div className="flex min-h-[16rem] items-center justify-center rounded-3xl border border-destructive/25 bg-destructive/10 px-4 py-10 text-center">
                  <div className="mx-auto max-w-md space-y-3">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive">
                      <AlertTriangle className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">Unable to load token usage.</p>
                    <p className="break-words text-xs leading-5 text-destructive">{loadError}</p>
                    <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={load} disabled={loading}>Retry</Button>
                  </div>
                </div>
              ) : rows.length === 0 ? (
                <div className="flex min-h-[18rem] items-center justify-center rounded-3xl border border-dashed border-border/70 bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.10),transparent_42%),hsl(var(--muted)/0.18)] px-4 py-12 text-center">
                  <div className="mx-auto max-w-sm space-y-3">
                    <div className="mx-auto w-fit rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">Audit ready</div>
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
                      <Coins className="h-7 w-7" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">No usage recorded yet.</p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {scope === "agency" ? "Agency-wide metered report generations will appear here when your permitted agency scope has usage." : "Metered report generations will appear here with reserve, commit, cancel and duration details once available."}
                    </p>
                  </div>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex min-h-[16rem] items-center justify-center rounded-3xl border border-dashed border-primary/20 bg-primary/5 px-4 py-10 text-center">
                  <div className="mx-auto max-w-md space-y-3">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                      <Search className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">No matching usage records.</p>
                    <p className="break-words text-xs leading-5 text-muted-foreground">
                      No token usage records match “{search.trim()}”. Adjust the search by kind, function, status or idempotency key.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background/45">
                    <div className={cn("overflow-x-auto overscroll-x-contain", PREMIUM_SCROLLBAR)}>
                      <Table className="min-w-[1180px] table-fixed" aria-label="Token usage records">
                        <TableHeader>
                          <TableRow className="bg-muted/35 hover:bg-muted/35">
                            <TableHead className="w-[150px]">When</TableHead>
                            <TableHead className="w-[210px]">Report</TableHead>
                            <TableHead className="w-[128px]">Kind</TableHead>
                            <TableHead className="w-[240px]">Idempotency key</TableHead>
                            <TableHead className="w-[112px] text-right">Used</TableHead>
                            <TableHead className="w-[100px] text-right">Duration</TableHead>
                            <TableHead className="w-[135px]">Status</TableHead>
                            <TableHead className="w-[170px]">Metadata</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pageRows.map((r) => {
                            const isOpen = activeKey === r.idempotency_key;
                            return (
                              <TableRow
                                key={r.id}
                                className={cn(
                                  "group cursor-pointer border-l-2 border-l-transparent transition-all duration-200 hover:border-l-primary/60 hover:bg-primary/5 hover:shadow-[inset_4px_0_0_hsl(var(--primary)/0.10)] focus-within:bg-primary/5",
                                  isOpen && "border-l-primary bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.16)]",
                                )}
                                onClick={() => setActiveKey(r.idempotency_key)}
                              >
                                <TableCell className="align-top text-xs text-muted-foreground">
                                  <div className="space-y-1">
                                    <span className="block whitespace-nowrap font-medium text-foreground" title={r.created_at}>
                                      {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                                    </span>
                                    <span className="block truncate" title={r.created_at}>Created {new Date(r.created_at).toLocaleString('en-AU')}</span>
                                    {r.updated_at && (
                                      <span className="block truncate" title={r.updated_at}>Updated {new Date(r.updated_at).toLocaleString('en-AU')}</span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="min-w-0 align-top font-medium">
                                  <span className="block truncate text-sm" title={r.function_name}>{FN_LABEL[r.function_name] ?? r.function_name}</span>
                                  <span className="block truncate pt-1 text-xs font-normal text-muted-foreground" title={r.function_name}>{r.function_name}</span>
                                </TableCell>
                                <TableCell className="min-w-0 align-top"><KindBadge kind={r.kind} /></TableCell>
                                <TableCell className="min-w-0 align-top">
                                  <button
                                    type="button"
                                    className={cn(
                                      "flex min-h-9 max-w-full items-center gap-2 truncate rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-left font-mono text-xs text-primary shadow-sm underline-offset-4 transition-all duration-200 hover:-translate-y-px hover:border-primary/45 hover:bg-primary/10 hover:shadow-[0_0_0_3px_hsl(var(--primary)/0.10),0_10px_22px_hsl(var(--primary)/0.12)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2",
                                      isOpen && "border-primary/45 bg-primary/15",
                                    )}
                                    title={r.idempotency_key}
                                    aria-label={`Open token audit trail for ${r.idempotency_key}`}
                                    onClick={(e) => { e.stopPropagation(); setActiveKey(r.idempotency_key); }}
                                  >
                                    <span className="min-w-0 truncate">{r.idempotency_key}</span>
                                  </button>
                                </TableCell>
                                <TableCell className="align-top text-right font-semibold tabular-nums">
                                  <span className="text-success dark:text-success">{r.actual_tokens.toLocaleString('en-AU')}</span>
                                </TableCell>
                                <TableCell className="align-top text-right text-xs tabular-nums text-muted-foreground">
                                  <span className="inline-flex rounded-full border border-border/60 bg-muted/45 px-2 py-1 font-medium shadow-sm">{fmtMs(r.duration_ms)}</span>
                                </TableCell>
                                <TableCell className="min-w-0 align-top"><StatusBadge status={r.status} /></TableCell>
                                <TableCell className="min-w-0 align-top text-xs text-muted-foreground">
                                  <div className="space-y-1">
                                    {r.user_id && <p className="truncate" title={r.user_id}>User: {r.user_id}</p>}
                                    {r.agency_id && <p className="truncate" title={r.agency_id}>Agency: {r.agency_id}</p>}
                                    {r.job_id && <p className="truncate font-mono" title={r.job_id}>job: {r.job_id}</p>}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-col justify-between gap-3 pt-2 sm:flex-row sm:items-center">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Rows per page</span>
                      <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                        <SelectTrigger className="h-9 w-[84px] rounded-xl" aria-label="Rows per page"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PAGE_SIZE_OPTIONS.map((n) => (
                            <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="ml-0 sm:ml-2">
                        {filtered.length === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + pageSize, filtered.length)} of {filtered.length.toLocaleString('en-AU')}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button aria-label="First page" variant="outline" size="icon" className="h-9 w-9 rounded-xl" disabled={safePage === 1} onClick={() => setPage(1)}>
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button aria-label="Previous page" variant="outline" size="icon" className="h-9 w-9 rounded-xl" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="px-2 text-xs tabular-nums text-muted-foreground">
                        Page {safePage} / {totalPages}
                      </span>
                      <Button aria-label="Next page" variant="outline" size="icon" className="h-9 w-9 rounded-xl" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button aria-label="Last page" variant="outline" size="icon" className="h-9 w-9 rounded-xl" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <TokenEventDetailsDrawer
        idempotencyKey={activeKey}
        open={!!activeKey}
        onOpenChange={(o) => !o && setActiveKey(null)}
        premiumTimeline
      />
    </div>
  );
}
