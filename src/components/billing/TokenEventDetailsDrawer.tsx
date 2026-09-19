import { useEffect, useState } from "react";
import { invokeSecureFunction } from "@/lib/secureInvoke";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Copy, Check, AlertTriangle, CheckCircle2, Clock3, XCircle, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AuditEvent {
  id: string;
  created_at: string;
  event: "reserve" | "commit" | "hold" | "release" | "cancel" | string;
  user_id: string | null;
  function_name: string | null;
  kind: string | null;
  job_id: string | null;
  used_tokens: number;
  available_tokens: number;
  status: string | null;
  reason: string | null;
  error_message: string | null;
}

interface Outcome {
  id: string;
  created_at: string;
  user_id: string | null;
  function_name: string;
  kind: string;
  actual_tokens: number;
  duration_ms: number;
  status: string;
  error_message: string | null;
  job_id: string | null;
}

interface Payload {
  idempotencyKey: string;
  events: AuditEvent[];
  outcomes: Outcome[];
  users: Record<string, string>;
}

function getEventTone(event: string, status?: string | null, error?: string | null) {
  const normalized = `${event} ${status ?? ""}`.toLowerCase();
  // `hold` = a chunk of a multi-call generation landed; the reservation stays
  // open and nothing is charged yet. `release` = the run failed and the job was
  // canceled or refunded, so the caller pays nothing. Both are matched before
  // the generic rules below, which would otherwise mis-tone them.
  if (event === "hold" && !error) {
    return {
      badge: "border-primary/25 bg-primary/10 text-primary",
      rail: "bg-primary/55",
      dot: "border-primary/30 bg-primary/10 text-primary",
      Icon: Clock3,
      label: "Held",
    };
  }
  if (event === "release" && !error) {
    return {
      badge: "border-success/25 bg-success/10 text-success dark:text-success",
      rail: "bg-success/55",
      dot: "border-success/30 bg-success/10 text-success dark:text-success",
      Icon: CheckCircle2,
      label: "Released",
    };
  }
  if (error || normalized.includes("error") || normalized.includes("fail") || normalized.includes("cancel")) {
    return {
      badge: "border-destructive/25 bg-destructive/10 text-destructive",
      rail: "bg-destructive/55",
      dot: "border-destructive/30 bg-destructive/10 text-destructive",
      Icon: XCircle,
      label: event === "cancel" ? "Cancel" : "Error",
    };
  }
  if (normalized.includes("commit") || normalized.includes("success") || normalized.includes("complete")) {
    return {
      badge: "border-success/25 bg-success/10 text-success dark:text-success",
      rail: "bg-success/55",
      dot: "border-success/30 bg-success/10 text-success dark:text-success",
      Icon: CheckCircle2,
      label: "Commit",
    };
  }
  if (normalized.includes("reserve") || normalized.includes("pending") || normalized.includes("progress")) {
    return {
      badge: "border-primary/25 bg-primary/10 text-primary",
      rail: "bg-primary/55",
      dot: "border-primary/30 bg-primary/10 text-primary",
      Icon: Clock3,
      label: "Reserve",
    };
  }
  return {
    badge: "border-border/70 bg-muted/60 text-muted-foreground",
    rail: "bg-border",
    dot: "border-border bg-muted/60 text-muted-foreground",
    Icon: AlertTriangle,
    label: event,
  };
}

function EventBadge({ event, status, error }: { event: string; status?: string | null; error?: string | null }) {
  const tone = getEventTone(event, status, error);
  return (
    <Badge variant="outline" className={cn("max-w-full rounded-full px-2.5 shadow-sm transition-colors capitalize", tone.badge)} title={event}>
      <span className="min-w-0 truncate">{event}</span>
    </Badge>
  );
}

function StatusBadge({ status }: { status?: string | null }) {
  const tone = getEventTone(status ?? "", status);
  return (
    <Badge variant="outline" className={cn("rounded-full px-2.5 capitalize", tone.badge)}>
      {status ?? "—"}
    </Badge>
  );
}

const PREMIUM_SCROLLBAR = "[scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] [&_[data-orientation=vertical]]:w-2.5 [&_[data-radix-scroll-area-thumb]]:bg-primary/35 [&_[data-radix-scroll-area-thumb]]:rounded-full";

function fmtMs(ms: number) {
  if (!ms) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function TokenEventDetailsDrawer({
  idempotencyKey,
  open,
  onOpenChange,
  premiumTimeline = false,
}: {
  idempotencyKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  premiumTimeline?: boolean;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [trailError, setTrailError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !idempotencyKey) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setData(null);
      setTrailError(null);
      const { data: res, error } = await invokeSecureFunction<Payload>(
        "get-token-event-trail", { idempotencyKey },
      );
      if (!cancelled && error) setTrailError(typeof error === "string" ? error : "Unable to load the idempotency audit trail.");
      if (!cancelled && res) setData(res);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, idempotencyKey]);

  const copy = async () => {
    if (!idempotencyKey) return;
    try {
      await navigator.clipboard.writeText(idempotencyKey);
      setCopied(true);
      toast.success("Idempotency key copied");
      setTimeout(() => setCopied(false), 1500);
    } catch { /* */ }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex h-[100dvh] max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden border-border/70 bg-card/95 p-0 shadow-2xl sm:max-w-2xl dark:border-white/10">
        <SheetHeader className={cn("min-w-0 border-b px-4 py-5 text-left sm:px-6", premiumTimeline ? "border-primary/15 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.14),transparent_36%),linear-gradient(135deg,hsl(var(--muted)/0.24),hsl(var(--card)/0.92))]" : "border-border/60 bg-muted/20")}>
          {premiumTimeline && (
            <div className="mb-1 inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Clock3 className="h-3.5 w-3.5" />
              Technical audit timeline
            </div>
          )}
          <SheetTitle className={cn("text-xl", premiumTimeline && "tracking-tight")}>Generation Trail</SheetTitle>
          <SheetDescription>
            Event timeline and tokens used for this idempotency key.
          </SheetDescription>
          {idempotencyKey && (
            <div className="flex min-w-0 items-center gap-2 pt-1">
              <code className={cn("min-w-0 flex-1 truncate border font-mono text-xs text-primary transition-colors", premiumTimeline ? "rounded-xl border-primary/20 bg-primary/10 px-2.5 py-1.5 shadow-inner" : "rounded-lg border-primary/15 bg-primary/5 px-2 py-1")} title={idempotencyKey}>
                {idempotencyKey}
              </code>
              <Button size="icon" variant="outline" className="h-9 w-9 shrink-0 rounded-lg transition-all duration-200 hover:border-primary/35 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2" onClick={copy} aria-label="Copy idempotency key">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          )}
        </SheetHeader>

        <ScrollArea className={cn("min-h-0 flex-1 overscroll-contain py-5", premiumTimeline ? "px-4 sm:px-6" : "px-6", PREMIUM_SCROLLBAR)}>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : trailError ? (
            <div className="mx-auto my-8 flex max-w-md flex-col items-center gap-3 rounded-2xl border border-destructive/25 bg-destructive/10 p-5 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-foreground">Unable to load audit trail.</p>
              <p className="break-words text-xs leading-5 text-destructive">{trailError}</p>
            </div>
          ) : !data ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No trail data.</p>
          ) : (
            <div className="min-w-0 space-y-6 pb-8">
              {/* Outcome */}
              <section className="min-w-0">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-success dark:text-success" />Outcome</h3>
                {data.outcomes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No outcome row yet.</p>
                ) : (
                  data.outcomes.map((o) => (
                    <div key={o.id} className={cn("min-w-0 space-y-3 rounded-2xl border border-border/70 p-4 text-sm shadow-sm transition-shadow duration-200", premiumTimeline ? "bg-background/65 ring-1 ring-black/5 hover:shadow-[0_16px_36px_rgba(15,23,42,0.08)] dark:ring-white/5 dark:hover:shadow-black/25" : "bg-background/55")}>
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-medium" title={o.function_name}>{o.function_name}</span>
                        <StatusBadge status={o.status} />
                      </div>
                      <div className="break-words text-xs text-muted-foreground">
                        {format(new Date(o.created_at), "PPpp")}
                        {o.user_id && data.users[o.user_id] && <> · {data.users[o.user_id]}</>}
                      </div>
                      <Separator />
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div><p className="text-muted-foreground">Used</p><p className="font-semibold tabular-nums text-success dark:text-success">{o.actual_tokens.toLocaleString('en-AU')}</p></div>
                        <div><p className="text-muted-foreground">Duration</p><p className="font-semibold tabular-nums">{fmtMs(o.duration_ms)}</p></div>
                      </div>
                      {o.error_message && (
                        <p className="break-words rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{o.error_message}</p>
                      )}
                      {o.job_id && (
                        <p className="truncate rounded-lg bg-muted/35 px-2 py-1 font-mono text-xs text-muted-foreground" title={o.job_id}>job: {o.job_id}</p>
                      )}
                    </div>
                  ))
                )}
              </section>

              {/* Audit trail */}
              <section className="min-w-0">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Audit events ({data.events.length})
                </h3>
                {data.events.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No audit events.</p>
                ) : premiumTimeline ? (
                  <ol className="relative space-y-3 before:absolute before:bottom-3 before:left-5 before:top-3 before:w-px before:bg-border/80">
                      {data.events.map((e) => {
                      const tone = getEventTone(e.event, e.status, e.error_message);
                      const Icon = tone.Icon;
                      return (
                        <li key={e.id} className="relative min-w-0 pl-12">
                          <span className={cn("absolute left-0 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-2xl border shadow-sm", tone.dot)} aria-hidden="true">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className={cn("absolute left-5 top-14 h-[calc(100%-1.75rem)] w-px", tone.rail)} aria-hidden="true" />
                          <div className="min-w-0 space-y-3 rounded-2xl border border-border/70 bg-background/65 p-4 text-xs shadow-sm ring-1 ring-black/5 transition-shadow duration-200 hover:shadow-[0_16px_36px_rgba(15,23,42,0.08)] dark:ring-white/5 dark:hover:shadow-black/25">
                            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="rounded-full bg-muted/55 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{tone.label}</span>
                                <EventBadge event={e.event} status={e.status} error={e.error_message} />
                                <span className="min-w-0 truncate text-muted-foreground" title={e.created_at}>
                                  {format(new Date(e.created_at), "MMM d, HH:mm:ss.SSS")}
                                </span>
                              </div>
                              {e.status && <span className="min-w-0 max-w-full truncate rounded-full border border-border/60 bg-muted/45 px-2 py-1 text-muted-foreground sm:max-w-[40%]" title={e.status}>{e.status}</span>}
                            </div>
                            {e.user_id && data.users[e.user_id] && (
                              <p className="truncate text-muted-foreground" title={data.users[e.user_id]}>User: {data.users[e.user_id]}</p>
                            )}
                            <div className="grid min-w-0 grid-cols-2 gap-2 pt-1">
                              <div><p className="text-muted-foreground">Used</p><p className="font-medium tabular-nums text-success dark:text-success">{e.used_tokens.toLocaleString('en-AU')}</p></div>
                              <div><p className="text-muted-foreground">Available</p><p className="font-medium tabular-nums">{e.available_tokens.toLocaleString('en-AU')}</p></div>
                            </div>
                            {e.reason && <p className="break-words rounded-xl border border-border/60 bg-muted/35 p-2 text-muted-foreground">Reason: {e.reason}</p>}
                            {e.error_message && <p className="break-words rounded-xl border border-destructive/20 bg-destructive/10 p-2 text-destructive">{e.error_message}</p>}
                            {e.job_id && <p className="truncate rounded-lg bg-muted/35 px-2 py-1 font-mono text-muted-foreground" title={e.job_id}>job: {e.job_id}</p>}
                          </div>
                        </li>
                      );
                      })}
                  </ol>
                ) : (
                  <ol className="space-y-2">
                      {data.events.map((e) => (
                        <li key={e.id} className="min-w-0 space-y-2 rounded-2xl border border-border/70 bg-background/55 p-4 text-xs shadow-sm">
                          <div className="flex min-w-0 items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <EventBadge event={e.event} />
                              <span className="min-w-0 truncate text-muted-foreground" title={e.created_at}>
                                {format(new Date(e.created_at), "MMM d, HH:mm:ss.SSS")}
                              </span>
                            </div>
                            {e.status && <span className="max-w-[35%] truncate text-muted-foreground" title={e.status}>{e.status}</span>}
                          </div>
                          {e.user_id && data.users[e.user_id] && (
                            <p className="truncate text-muted-foreground" title={data.users[e.user_id]}>User: {data.users[e.user_id]}</p>
                          )}
                          <div className="grid min-w-0 grid-cols-2 gap-2 pt-1">
                            <div><p className="text-muted-foreground">Used</p><p className="font-medium tabular-nums">{e.used_tokens.toLocaleString('en-AU')}</p></div>
                            <div><p className="text-muted-foreground">Available</p><p className="font-medium tabular-nums">{e.available_tokens.toLocaleString('en-AU')}</p></div>
                          </div>
                          {e.reason && <p className="break-words text-muted-foreground">Reason: {e.reason}</p>}
                          {e.error_message && <p className="break-words rounded-lg bg-destructive/10 p-2 text-destructive">{e.error_message}</p>}
                          {e.job_id && <p className="truncate font-mono text-muted-foreground" title={e.job_id}>job: {e.job_id}</p>}
                        </li>
                      ))}
                  </ol>
                )}
              </section>
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
