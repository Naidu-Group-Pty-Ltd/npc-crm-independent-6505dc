import { useCallback, useEffect, useState, useMemo } from "react";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from '@/components/ui/search-input';
import { DashboardThemeFrame } from "@/components/layout/DashboardThemeFrame";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Clock3, DatabaseZap, FileKey2, Filter, Loader2, RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles, WalletCards, XCircle } from "lucide-react";
import { format } from "date-fns";
import { TokenEventDetailsDrawer } from "@/components/billing/TokenEventDetailsDrawer";

interface AuditRow {
  id: string;
  created_at: string;
  event: "reserve" | "commit" | "hold" | "release" | "cancel" | string;
  user_id: string | null;
  function_name: string | null;
  kind: string | null;
  idempotency_key: string;
  job_id: string | null;
  used_tokens: number;
  available_tokens: number;
  status: string | null;
  reason: string | null;
  error_message: string | null;
}

function EventBadge({ event }: { event: string }) {
  const className =
    event === "reserve"
      ? "border-brand-500/25 bg-brand-500/10 text-brand-700 dark:text-brand-300"
      : event === "commit"
        ? "border-success/25 bg-success/10 text-success dark:text-success"
        // A chunk of a multi-call generation landed; the reservation is still
        // open and nothing has been charged.
        : event === "hold"
          ? "border-primary/25 bg-primary/10 text-primary"
          // The run failed: reservation canceled, or an earlier commit refunded.
          : event === "release" || event === "cancel"
            ? "border-destructive/25 bg-destructive/10 text-destructive"
            : "border-border/70 bg-muted/60 text-muted-foreground";

  return (
    <Badge variant="outline" className={cn("max-w-full rounded-full px-2.5 py-0.5 capitalize", className)} title={event}>
      <span className="min-w-0 truncate">{event}</span>
    </Badge>
  );
}

function OutcomeBadge({ status, error }: { status: string | null; error: string | null }) {
  const label = error ? "error" : status || "recorded";
  const normalized = label.toLowerCase();
  const className = error || ["failed", "error", "cancelled", "canceled"].some((v) => normalized.includes(v))
    ? "border-destructive/25 bg-destructive/10 text-destructive"
    : ["success", "committed", "complete", "completed", "ok"].some((v) => normalized.includes(v))
      ? "border-success/25 bg-success/10 text-success dark:text-success"
      : "border-primary/20 bg-primary/10 text-primary";

  return (
    <Badge variant="outline" className={cn("max-w-full rounded-full px-2.5 py-0.5 capitalize", className)} title={label}>
      <span className="min-w-0 truncate">{label}</span>
    </Badge>
  );
}

function TokenSummary({ row }: { row: AuditRow }) {
  // Only what was charged. The requested amount and the reservation are
  // internal metering mechanics — they told an operator nothing they could act
  // on, and three near-identical numbers per row made the real one hard to find.
  return (
    <div
      className="text-right text-sm"
      aria-label={`Used ${row.used_tokens.toLocaleString('en-AU')} tokens`}
    >
      <span className="font-semibold tabular-nums text-foreground" title={`${row.used_tokens}`}>
        {row.used_tokens.toLocaleString('en-AU')}
      </span>
    </div>
  );
}

function AuditEventMobileCard({ row, userLabel, isOpen, onOpen }: { row: AuditRow; userLabel: string; isOpen: boolean; onOpen: () => void }) {
  return (
    <article className={cn(
      "min-w-0 rounded-3xl border border-border/70 bg-card/90 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_18px_42px_hsl(var(--foreground)/0.08)]",
      isOpen && "border-primary/35 bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.14)]",
    )}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-semibold text-foreground" title={row.created_at}>{format(new Date(row.created_at), "MMM d, yyyy • HH:mm:ss")}</p>
          <p className="truncate text-xs text-muted-foreground" title={row.created_at}>{new Date(row.created_at).toLocaleString('en-AU')}</p>
        </div>
        <EventBadge event={row.event} />
      </div>

      <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-border/55 bg-background/70 px-3 py-2">
          <span className="block text-muted-foreground">User</span>
          <span className="mt-1 block truncate font-medium text-foreground" title={row.user_id ?? userLabel}>{userLabel}</span>
        </div>
        <div className="min-w-0 rounded-2xl border border-border/55 bg-background/70 px-3 py-2">
          <span className="block text-muted-foreground">Function / kind</span>
          <span className="mt-1 block truncate font-medium text-foreground" title={row.function_name ?? undefined}>{row.function_name ?? "—"}</span>
          {row.kind ? <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground" title={row.kind}>{row.kind}</span> : null}
        </div>
      </div>

      <button
        type="button"
        className="mt-3 flex min-h-10 w-full min-w-0 items-center gap-2 rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2 text-left font-mono text-xs text-primary shadow-sm transition-all duration-200 hover:border-primary/45 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2"
        title={row.idempotency_key}
        aria-label={`Open token audit trail for ${row.idempotency_key}`}
        onClick={onOpen}
      >
        <FileKey2 className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{row.idempotency_key}</span>
        <span className="shrink-0 rounded-full border border-primary/15 bg-background/70 px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.12em]">Trail</span>
      </button>

      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_0.8fr]">
        <TokenSummary row={row} />
        <div className="rounded-2xl border border-border/55 bg-background/70 px-3 py-2 text-right text-xs">
          <span className="block text-muted-foreground">Available</span>
          <span className="mt-1 block font-semibold tabular-nums text-foreground">{row.available_tokens.toLocaleString('en-AU')}</span>
        </div>
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
        <OutcomeBadge status={row.status} error={row.error_message} />
        {row.reason ? <span className="min-w-0 truncate text-xs text-muted-foreground" title={row.reason}>{row.reason}</span> : null}
        {row.error_message ? <span className="min-w-0 truncate text-xs text-destructive" title={row.error_message}>{row.error_message}</span> : null}
      </div>
    </article>
  );
}

const PREMIUM_SCROLLBAR = "[scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-primary/35 [&::-webkit-scrollbar-track]:bg-transparent";

const EVENT_STATES = [
  { label: "Reserve", description: "Holds Mission Control tokens before a job runs.", icon: RotateCcw, tone: "border-brand-500/20 bg-brand-500/10 text-brand-700 dark:text-brand-300" },
  { label: "Commit", description: "Finalises actual token usage after successful completion.", icon: CheckCircle2, tone: "border-success/20 bg-success/10 text-success dark:text-success" },
  { label: "Cancel", description: "Releases a reservation when work is cancelled or fails safely.", icon: XCircle, tone: "border-destructive/20 bg-destructive/10 text-destructive" },
] as const;

export default function TokenAuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await invokeSecureFunction<{ rows: AuditRow[]; users: Record<string, string> }>(
      "list-token-audit",
      { limit: 500, event: eventFilter === "all" ? null : eventFilter },
    );
    if (!error && data) {
      setRows(data.rows ?? []);
      setUsers(data.users ?? {});
    } else if (error) {
      setLoadError(typeof error === "string" ? error : "Unable to load token audit events.");
    }
    setLoading(false);
  }, [eventFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.idempotency_key, r.function_name, r.kind, r.job_id, r.reason, users[r.user_id || ""]]
        .some((v) => String(v ?? "").toLowerCase().includes(q)),
    );
  }, [rows, search, users]);

  const eventCounts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        if (row.event === "reserve") acc.reserve += 1;
        else if (row.event === "commit") acc.commit += 1;
        else if (row.event === "hold") acc.hold += 1;
        // `cancel` is the pre-release event name; both mean "not charged".
        else if (row.event === "release" || row.event === "cancel") acc.released += 1;
        if (row.error_message) acc.errors += 1;
        return acc;
      },
      { reserve: 0, commit: 0, hold: 0, released: 0, errors: 0 },
    );
  }, [rows]);

  const isInitialLoading = loading && rows.length === 0;
  const activeFilterLabel = eventFilter === "all" ? "All events" : eventFilter;

  return (
    <>
      <DashboardThemeFrame variant="page" className="max-w-none space-y-6 pt-1 sm:space-y-7 sm:pt-2">
        <DashboardThemeFrame as="header" variant="hero" className="flex min-w-0 flex-col gap-5 border-primary/25 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.20),transparent_30%),radial-gradient(circle_at_bottom_right,hsl(var(--primary)/0.10),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--background)/0.92)_56%,hsl(var(--primary)/0.12))] p-5 shadow-[0_22px_60px_rgba(15,23,42,0.10)] ring-1 ring-primary/10 dark:shadow-black/35 sm:p-6 lg:flex-row lg:items-center lg:justify-between lg:p-8">
          <div className="flex min-w-0 items-start gap-4">
            <div className="relative shrink-0 rounded-2xl border border-primary/25 bg-primary/10 p-3 text-primary shadow-[0_14px_35px_hsl(var(--primary)/0.16)] ring-1 ring-primary/15">
              <ShieldCheck className="h-7 w-7" />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-card bg-success" aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary shadow-sm">
                <DatabaseZap className="h-3.5 w-3.5" />
                Mission Control event ledger
              </div>
              <div className="min-w-0">
                <h1 className="min-w-0 truncate text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Token Audit Log
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Every Mission Control reserve / commit / cancel event, per user, per agency.
                </p>
              </div>
            </div>
          </div>
          <Button
            onClick={load}
            variant="outline"
            size="sm"
            disabled={loading}
            aria-label="Refresh token audit events"
            aria-busy={loading}
            className="min-h-11 w-full shrink-0 rounded-xl border-primary/25 bg-background/90 px-4 font-medium shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/10 hover:text-primary hover:shadow-[0_12px_28px_hsl(var(--primary)/0.14)] active:translate-y-0 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 sm:w-auto"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </DashboardThemeFrame>

        <Card className="min-w-0 overflow-hidden rounded-[1.75rem] border-border/70 bg-card/95 shadow-[0_22px_60px_rgba(15,23,42,0.10)] ring-1 ring-black/5 transition-shadow duration-200 hover:shadow-[0_28px_75px_rgba(15,23,42,0.13)] dark:border-white/10 dark:bg-background/75 dark:shadow-black/35 dark:ring-white/5">
          <CardHeader className="border-b border-border/60 bg-[linear-gradient(135deg,hsl(var(--muted)/0.28),hsl(var(--card)/0.55))] px-4 py-5 sm:px-6">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-3">
                <CardTitle className="flex min-w-0 items-center gap-2 text-xl tracking-tight">
                  <span className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
                    <Clock3 className="h-5 w-5" />
                  </span>
                  <span className="truncate">Events</span>
                </CardTitle>
                <CardDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  Most recent 500 events. Filter by type or search by key / user.
                </CardDescription>
                <div className="grid gap-2 pt-1 md:grid-cols-3" aria-label="Mission Control audit event workflow">
                  {EVENT_STATES.map(({ label, description, icon: Icon, tone }) => (
                    <div key={label} className={cn("flex min-w-0 items-start gap-2 rounded-2xl border px-3 py-2 shadow-sm", tone)}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em]">{label}</p>
                        <p className="mt-1 text-[11px] leading-4 opacity-85">{description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <Badge variant="outline" className="w-fit rounded-full border-primary/20 bg-primary/10 px-3 py-1 text-primary">
                {filtered.length.toLocaleString('en-AU')} visible
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="min-w-0 space-y-5 p-4 sm:p-6">
            <DashboardThemeFrame variant="toolbar" className="min-w-0 flex-col items-stretch gap-4 border-primary/10 bg-[linear-gradient(135deg,hsl(var(--muted)/0.30),hsl(var(--background)/0.72))] p-3 shadow-inner sm:p-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-end">
                <div className="min-w-0 shrink-0 space-y-2 md:w-[220px]">
                  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground" htmlFor="token-audit-event-filter">
                    <Filter className="h-3.5 w-3.5 text-primary" />
                    Event type
                  </label>
                  <Select value={eventFilter} onValueChange={setEventFilter} disabled={loading}>
                    <SelectTrigger id="token-audit-event-filter" className="min-h-11 w-full rounded-2xl border-border/70 bg-background/90 px-3 shadow-sm transition-all duration-200 hover:-translate-y-px hover:border-primary/35 hover:bg-background hover:shadow-[0_10px_24px_rgba(15,23,42,0.06)] active:translate-y-0 active:scale-[0.99] focus:ring-2 focus:ring-primary/30" aria-label="Filter token audit events by type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All events</SelectItem>
                      <SelectItem value="reserve">Reserve</SelectItem>
                      <SelectItem value="commit">Commit</SelectItem>
                      <SelectItem value="hold">Held (chunk)</SelectItem>
                      <SelectItem value="release">Released</SelectItem>
                      <SelectItem value="cancel">Cancel (legacy)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground" htmlFor="token-audit-search">
                    <Search className="h-3.5 w-3.5 text-primary" />
                    Keyword search
                  </label>
                  <SearchInput
                    value={search}
                    onValueChange={setSearch}
                    id="token-audit-search"
                    placeholder="Search by idempotency key, user, function…"
                    aria-label="Search token audit events by idempotency key, user, or function"
                    disabled={loading && rows.length === 0}
                    containerClassName="group min-w-0 rounded-2xl transition-all duration-200 focus-within:-translate-y-px focus-within:shadow-[0_12px_28px_hsl(var(--primary)/0.10)]"
                    className="min-h-11 min-w-0 rounded-2xl border-border/70 bg-background/90 pr-3 shadow-sm transition-all duration-200 placeholder:text-muted-foreground hover:border-primary/35 hover:bg-background hover:shadow-[0_10px_24px_rgba(15,23,42,0.06)] active:scale-[0.995] focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/30"
                    iconClassName="left-3.5 transition-colors group-hover:text-primary/80 group-focus-within:text-primary"
                  />
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-2 rounded-2xl border border-border/60 bg-card/70 p-2 text-xs shadow-sm sm:min-w-[220px]" aria-label={`Loaded ${rows.length.toLocaleString('en-AU')} events, ${filtered.length.toLocaleString('en-AU')} visible`}>
                <div className="rounded-xl bg-muted/35 px-3 py-2">
                  <span className="block text-muted-foreground">Loaded</span>
                  <span className="font-semibold tabular-nums text-foreground">{rows.length.toLocaleString('en-AU')}</span>
                </div>
                <div className="rounded-xl bg-primary/10 px-3 py-2">
                  <span className="block text-primary/80">Visible</span>
                  <span className="font-semibold tabular-nums text-primary">{filtered.length.toLocaleString('en-AU')}</span>
                </div>
              </div>
            </DashboardThemeFrame>

            <div className="grid min-w-0 gap-3 sm:grid-cols-2 md:grid-cols-5" aria-label="Token audit event totals">
              {[
                { label: "Reserve", value: eventCounts.reserve, className: "border-brand-500/20 bg-brand-500/10 text-brand-700 dark:text-brand-300" },
                { label: "Commit", value: eventCounts.commit, className: "border-success/20 bg-success/10 text-success dark:text-success" },
                { label: "Held", value: eventCounts.hold, className: "border-primary/20 bg-primary/10 text-primary" },
                { label: "Released", value: eventCounts.released, className: "border-destructive/20 bg-destructive/10 text-destructive" },
                { label: "Errors", value: eventCounts.errors, className: "border-primary/20 bg-primary/10 text-primary" },
              ].map((item) => (
                <div key={item.label} className={cn("rounded-3xl border px-4 py-3 shadow-sm", item.className)}>
                  <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-80"><Sparkles className="h-3.5 w-3.5" />{item.label}</span>
                  <span className="mt-2 block text-2xl font-semibold tabular-nums">{item.value.toLocaleString('en-AU')}</span>
                </div>
              ))}
            </div>

            <div className="grid min-w-0 gap-3 rounded-3xl border border-border/60 bg-[linear-gradient(135deg,hsl(var(--card)/0.78),hsl(var(--muted)/0.24))] p-3 text-xs shadow-sm sm:grid-cols-3">
              <div className="rounded-2xl border border-border/50 bg-background/70 px-4 py-3">
                <span className="block text-muted-foreground">Current view</span>
                <span className="mt-1 block truncate font-semibold capitalize text-foreground">{activeFilterLabel}</span>
              </div>
              <div className="rounded-2xl border border-border/50 bg-background/70 px-4 py-3">
                <span className="block text-muted-foreground">Audit drilldown</span>
                <span className="mt-1 block truncate font-semibold text-foreground">Idempotency key trails</span>
              </div>
              <div className="rounded-2xl border border-border/50 bg-primary/10 px-4 py-3 text-primary">
                <span className="block text-primary/80">Refresh behaviour</span>
                <span className="mt-1 block truncate font-semibold">Keeps filters and search intact</span>
              </div>
            </div>

            {loading && rows.length > 0 && (
              <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-xs font-medium text-primary" role="status" aria-live="polite">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                <span className="min-w-0 truncate">Refreshing token audit events without changing the current filters.</span>
              </div>
            )}

            {loadError && (
              <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
                <div className="flex min-w-0 items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-words">{loadError}</span>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10" onClick={load} disabled={loading}>
                  Retry
                </Button>
              </div>
            )}

            {isInitialLoading ? (
              <div className="overflow-hidden rounded-3xl border border-border/70 bg-background/50 shadow-inner" role="status" aria-live="polite" aria-busy="true">
                <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">Loading audit events</p>
                      <p className="text-xs text-muted-foreground">Fetching the latest Mission Control ledger entries.</p>
                    </div>
                  </div>
                  <Skeleton className="hidden h-7 w-24 rounded-full sm:block" />
                </div>
                <div className="space-y-3 p-4">
                  <div className="grid gap-3 sm:grid-cols-[1.1fr_0.7fr_1.4fr_1fr]">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-4 rounded-lg" />)}
                  </div>
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
                </div>
              </div>
            ) : loadError && rows.length === 0 ? (
              <div className="flex min-h-[18rem] items-center justify-center rounded-3xl border border-destructive/25 bg-[radial-gradient(circle_at_top,hsl(var(--destructive)/0.12),transparent_46%),hsl(var(--destructive)/0.07)] px-4 py-10 text-center" role="alert">
                <div className="mx-auto max-w-lg space-y-4">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive shadow-sm">
                    <AlertTriangle className="h-7 w-7" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-foreground">Unable to load token audit events.</p>
                    <p className="break-words text-xs leading-5 text-destructive">{loadError}</p>
                    <p className="text-xs leading-5 text-muted-foreground">The audit ledger has not been changed. Retry will request the same filtered view again.</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10" onClick={load} disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Retry
                  </Button>
                </div>
              </div>
            ) : rows.length === 0 ? (
              <div className="flex min-h-[20rem] items-center justify-center rounded-3xl border border-dashed border-border/70 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.12),transparent_40%),linear-gradient(135deg,hsl(var(--muted)/0.22),hsl(var(--background)/0.72))] px-4 py-12 text-center" role="status" aria-live="polite">
                <div className="mx-auto max-w-lg space-y-5">
                  <div className="mx-auto w-fit rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">Audit ready</div>
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary shadow-[0_16px_40px_hsl(var(--primary)/0.12)]">
                    <FileKey2 className="h-8 w-8" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-base font-semibold text-foreground">No events recorded.</p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Mission Control reserve, commit and cancel events will appear here once available. Filters and search are ready to inspect new audit records.
                    </p>
                  </div>
                  <div className="grid gap-2 text-left text-xs text-muted-foreground sm:grid-cols-3">
                    <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">Filter by event type</div>
                    <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">Search keys or users</div>
                    <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">Refresh for latest</div>
                  </div>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex min-h-[17rem] items-center justify-center rounded-3xl border border-dashed border-primary/20 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.10),transparent_44%),hsl(var(--primary)/0.04)] px-4 py-10 text-center" role="status" aria-live="polite">
                <div className="mx-auto max-w-md space-y-4">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
                    <Search className="h-7 w-7" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-foreground">No matching audit events.</p>
                    <p className="break-words text-xs leading-5 text-muted-foreground">
                      No token audit events match “{search.trim()}”. Adjust the search by idempotency key, user or function, or change the event type filter.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="min-w-0 overflow-hidden rounded-3xl border border-border/70 bg-background/50 shadow-[inset_0_1px_0_hsl(var(--background)/0.85)] dark:bg-background/40">
                <div className="flex min-w-0 flex-col gap-3 border-b border-border/60 bg-[linear-gradient(135deg,hsl(var(--muted)/0.32),hsl(var(--card)/0.68))] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                      <WalletCards className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">Audit event ledger</p>
                      <p className="truncate text-xs text-muted-foreground">Scrollable table with full audit metadata and drilldown by idempotency key.</p>
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full border border-border/60 bg-background/75 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {filtered.length.toLocaleString('en-AU')} rows
                  </div>
                </div>
                <div className="space-y-3 p-3 lg:hidden" aria-label="Token audit event cards">
                  {filtered.map((r) => (
                    <AuditEventMobileCard
                      key={r.id}
                      row={r}
                      userLabel={r.user_id ? (users[r.user_id] ?? r.user_id.slice(0, 8)) : "—"}
                      isOpen={activeKey === r.idempotency_key}
                      onOpen={() => setActiveKey(r.idempotency_key)}
                    />
                  ))}
                </div>
                <div className={cn("hidden overflow-x-auto overscroll-x-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 lg:block", PREMIUM_SCROLLBAR)} role="region" aria-label="Scrollable token audit events table" tabIndex={0}>
                  <Table className="min-w-[1470px] table-fixed" aria-label="Token audit events">
                    <TableHeader className="sticky top-0 z-10">
                      <TableRow className="border-b border-border/70 bg-muted/45 hover:bg-muted/45">
                        <TableHead className="w-[170px] py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Timestamp</TableHead>
                        <TableHead className="w-[120px] py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Type</TableHead>
                        <TableHead className="w-[210px] py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">User</TableHead>
                        <TableHead className="w-[230px] py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Function / kind</TableHead>
                        <TableHead className="w-[280px] py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Idempotency key</TableHead>
                        <TableHead className="w-[120px] py-3 text-right text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Used</TableHead>
                        <TableHead className="w-[120px] py-3 text-right text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Available</TableHead>
                        <TableHead className="w-[220px] py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Status / outcome</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((r) => {
                        const isOpen = activeKey === r.idempotency_key;
                        const eventTone = r.event === "reserve"
                          ? "amber"
                          : r.event === "commit"
                            ? "emerald"
                            : r.event === "release" || r.event === "cancel"
                              ? "destructive"
                              : "primary";
                        return (
                          <TableRow
                            key={r.id}
                            className={cn(
                              "group border-l-2 border-l-transparent transition-all duration-200 odd:bg-background/20 hover:bg-primary/5 hover:shadow-[inset_4px_0_0_hsl(var(--primary)/0.10)] focus-within:bg-primary/5",
                              eventTone === "amber" && "hover:border-l-amber-500/70",
                              eventTone === "emerald" && "hover:border-l-emerald-500/70",
                              eventTone === "destructive" && "hover:border-l-destructive/70",
                              eventTone === "primary" && "hover:border-l-primary/60",
                              isOpen && "border-l-primary bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.16)]",
                            )}
                          >
                            <TableCell className="align-top text-xs text-muted-foreground">
                              <div className="flex min-w-0 gap-2">
                                <span
                                  className={cn(
                                    "mt-1.5 h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_4px_hsl(var(--primary)/0.10)]",
                                    eventTone === "amber" && "bg-brand-500",
                                    eventTone === "emerald" && "bg-success",
                                    eventTone === "destructive" && "bg-destructive",
                                    eventTone === "primary" && "bg-primary/70",
                                  )}
                                  aria-hidden="true"
                                />
                                <div className="min-w-0">
                                  <span className="block whitespace-nowrap font-medium text-foreground" title={r.created_at}>{format(new Date(r.created_at), "MMM d, HH:mm:ss")}</span>
                                  <span className="block truncate" title={r.created_at}>{new Date(r.created_at).toLocaleString('en-AU')}</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="align-top"><EventBadge event={r.event} /></TableCell>
                            <TableCell className="min-w-0 align-top text-xs">
                              <span className="block truncate font-medium text-foreground" title={r.user_id ?? undefined}>{r.user_id ? (users[r.user_id] ?? r.user_id.slice(0, 8)) : "—"}</span>
                              {r.user_id && <span className="block truncate pt-1 font-mono text-[11px] text-muted-foreground" title={r.user_id}>{r.user_id}</span>}
                            </TableCell>
                            <TableCell className="min-w-0 align-top text-xs">
                              <span className="block truncate font-medium" title={r.function_name ?? undefined}>{r.function_name ?? "—"}</span>
                              {r.kind && <span className="mt-1 inline-flex max-w-full rounded-full border border-border/60 bg-muted/45 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"><span className="truncate" title={r.kind}>{r.kind}</span></span>}
                            </TableCell>
                            <TableCell className="min-w-0 align-top">
                              <button
                                type="button"
                                className={cn(
                                  "group/key flex min-h-9 max-w-full items-center gap-2 truncate rounded-xl border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-left font-mono text-xs text-primary shadow-sm underline-offset-4 transition-all duration-200 hover:-translate-y-px hover:border-primary/45 hover:bg-primary/10 hover:shadow-[0_0_0_3px_hsl(var(--primary)/0.10),0_10px_22px_hsl(var(--primary)/0.12)] hover:underline active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2",
                                  isOpen && "border-primary/45 bg-primary/15",
                                )}
                                title={r.idempotency_key}
                                aria-label={`Open token audit trail for ${r.idempotency_key}`}
                                onClick={() => setActiveKey(r.idempotency_key)}
                              >
                                <FileKey2 className="h-3.5 w-3.5 shrink-0 opacity-70 transition-opacity group-hover/key:opacity-100" />
                                <span className="min-w-0 truncate">{r.idempotency_key}</span>
                                <span className="ml-auto hidden shrink-0 rounded-full border border-primary/15 bg-background/70 px-2 py-0.5 font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-primary/80 group-hover/key:inline-flex group-focus/key:inline-flex">Trail</span>
                              </button>
                            </TableCell>
                            <TableCell className="align-top"><TokenSummary row={r} /></TableCell>
                            <TableCell className="align-top text-right tabular-nums text-muted-foreground">{r.available_tokens.toLocaleString('en-AU')}</TableCell>
                            <TableCell className="min-w-0 align-top text-xs">
                              <OutcomeBadge status={r.status} error={r.error_message} />
                              {r.reason ? <span className="block truncate pt-1.5 text-muted-foreground" title={r.reason}>{r.reason}</span> : null}
                              {r.error_message ? <span className="block truncate pt-1.5 text-destructive" title={r.error_message}>{r.error_message}</span> : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </DashboardThemeFrame>
      <TokenEventDetailsDrawer
        idempotencyKey={activeKey}
        open={!!activeKey}
        onOpenChange={(o) => !o && setActiveKey(null)}
        premiumTimeline
      />
    </>
  );
}
