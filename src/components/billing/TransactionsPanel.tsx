import { useCallback, useEffect, useState } from "react";
import {
  fetchPurchaseHistory,
  formatMoney,
  type PurchaseRecord,
} from "@/lib/missionControl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, ChevronLeft, ChevronRight, ReceiptText, RefreshCw, ShoppingCart,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const PAGE_SIZE = 25;

const MODE_LABEL: Record<string, string> = {
  topup: "Token top-up",
  seat_plan: "Seat plan",
  setup_package: "Setup package",
  admin_grant: "Admin · token grant",
  admin_topup: "Admin · comp top-up",
  admin_plan_change: "Admin · plan change",
  admin_seat_change: "Admin · seat change",
};

const STATUS_FILTERS = [
  { value: "settled", label: "Settled (paid + refunded)" },
  { value: "all", label: "All activity" },
  { value: "completed", label: "Completed" },
  { value: "refunded", label: "Refunded" },
  { value: "failed", label: "Failed" },
  { value: "initiated", label: "Initiated" },
] as const;

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "completed"
      ? "border-success/25 bg-success/10 text-success dark:text-success"
      : status === "refunded"
        ? "border-warning/30 bg-warning/10 text-warning"
        : status === "failed"
          ? "border-destructive/25 bg-destructive/10 text-destructive"
          : "border-border/70 bg-muted/60 text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 capitalize", cls)}>
      {status}
    </Badge>
  );
}

/**
 * Attributed purchase ledger (Transactions tab of Billing & Usage). Every
 * checkout for this workspace — item, price, purchaser, source and Stripe
 * references — read back from Mission Control's tenant-scoped API.
 */
export function TransactionsPanel() {
  const [rows, setRows] = useState<PurchaseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<string>("settled");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextOffset: number, nextStatus: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchPurchaseHistory({
        limit: PAGE_SIZE,
        offset: nextOffset,
        // "settled" is the server default (completed + refunded) → send nothing.
        status: nextStatus === "settled" ? undefined : nextStatus,
      });
      setRows(result.purchases);
      setTotal(result.pagination.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transactions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(offset, status);
  }, [load, offset, status]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <Card className="min-w-0 overflow-hidden rounded-[1.75rem] border-border/70 bg-card/95 ring-1 ring-black/5 dark:border-white/10 dark:bg-background/75 dark:ring-white/5">
      <CardHeader className="border-b border-border/60 bg-[linear-gradient(135deg,hsl(var(--muted)/0.28),hsl(var(--card)/0.55))] px-4 py-5 sm:px-6">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex min-w-0 items-center gap-2 text-xl tracking-tight">
              <span className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
                <ShoppingCart className="h-5 w-5" />
              </span>
              <span className="truncate">Transactions</span>
            </CardTitle>
            <CardDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
              Every purchase for this workspace, attributed to the user who made it. Fully
              traceable in Mission Control via the Stripe references.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setOffset(0);
              }}
            >
              <SelectTrigger className="h-10 w-[210px] rounded-xl" aria-label="Filter transactions by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-xl"
              onClick={() => load(offset, status)}
              disabled={loading}
              aria-label="Refresh transactions"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4 p-4 sm:p-6">
        {error && (
          <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs text-destructive sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={() => load(offset, status)}
              disabled={loading}
            >
              Retry
            </Button>
          </div>
        )}

        {loading && rows.length === 0 ? (
          <div className="space-y-3 rounded-2xl border border-border/60 bg-background/45 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 && !error ? (
          <div className="flex min-h-[16rem] items-center justify-center rounded-3xl border border-dashed border-border/70 bg-muted/15 px-4 py-12 text-center">
            <div className="mx-auto max-w-sm space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
                <ReceiptText className="h-7 w-7" />
              </div>
              <p className="text-sm font-semibold text-foreground">No transactions yet.</p>
              <p className="text-xs leading-5 text-muted-foreground">
                Token pack top-ups, plan upgrades and setup packages purchased through the
                pricing page will appear here with full attribution.
              </p>
            </div>
          </div>
        ) : rows.length > 0 ? (
          <>
            <div className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background/45">
              <div className="overflow-x-auto overscroll-x-contain">
                <Table className="min-w-[1080px]" aria-label="Purchase transactions">
                  <TableHeader>
                    <TableRow className="bg-muted/35 hover:bg-muted/35">
                      <TableHead className="w-[150px]">When</TableHead>
                      <TableHead className="w-[230px]">Item</TableHead>
                      <TableHead className="w-[150px]">Type</TableHead>
                      <TableHead className="w-[64px] text-right">Qty</TableHead>
                      <TableHead className="w-[110px] text-right">Amount</TableHead>
                      <TableHead className="w-[110px]">Status</TableHead>
                      <TableHead className="w-[170px]">Purchased by</TableHead>
                      <TableHead className="w-[200px]">Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id} className="transition-colors hover:bg-primary/5">
                        <TableCell className="align-top text-xs text-muted-foreground">
                          <span className="block whitespace-nowrap font-medium text-foreground" title={r.createdAt}>
                            {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                          </span>
                          <span className="block truncate" title={r.createdAt}>
                            {new Date(r.createdAt).toLocaleString('en-AU')}
                          </span>
                        </TableCell>
                        <TableCell className="min-w-0 align-top">
                          <span className="block truncate text-sm font-medium" title={r.itemName ?? r.itemSlug ?? undefined}>
                            {r.itemName ?? r.itemSlug ?? MODE_LABEL[r.mode] ?? r.mode}
                          </span>
                          {r.itemSlug && (
                            <span className="block truncate pt-1 font-mono text-xs text-muted-foreground" title={r.itemSlug}>
                              {r.itemSlug}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <Badge variant="secondary" className="whitespace-nowrap rounded-full border border-border/60 bg-muted/55 px-2.5 py-0.5 text-muted-foreground">
                            {MODE_LABEL[r.mode] ?? r.mode}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top text-right text-sm tabular-nums">{r.quantity}</TableCell>
                        <TableCell className="align-top text-right text-sm font-semibold tabular-nums">
                          {formatMoney(r.amountCents, r.currency)}
                        </TableCell>
                        <TableCell className="align-top"><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="min-w-0 align-top text-xs">
                          <span className="block truncate font-medium text-foreground" title={r.originUsername ?? r.originUserId ?? undefined}>
                            {r.originUsername ?? r.originUserId ?? "—"}
                          </span>
                          <span className="block truncate pt-1 text-muted-foreground" title={r.originSource}>
                            {r.originSource}
                          </span>
                        </TableCell>
                        <TableCell className="min-w-0 align-top text-xs text-muted-foreground">
                          {r.stripeCheckoutSessionId ? (
                            <span className="block truncate font-mono" title={r.stripeCheckoutSessionId}>
                              {r.stripeCheckoutSessionId}
                            </span>
                          ) : (
                            "—"
                          )}
                          {r.completedAt && (
                            <span className="block truncate pt-1" title={r.completedAt}>
                              Settled {new Date(r.completedAt).toLocaleDateString('en-AU')}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex min-w-0 flex-col justify-between gap-3 pt-1 sm:flex-row sm:items-center">
              <span className="text-xs text-muted-foreground">
                {total.toLocaleString('en-AU')} transaction{total === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  aria-label="Previous page"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-xl"
                  disabled={page === 1 || loading}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 text-xs tabular-nums text-muted-foreground">
                  Page {page} / {totalPages}
                </span>
                <Button
                  aria-label="Next page"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-xl"
                  disabled={page >= totalPages || loading}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
