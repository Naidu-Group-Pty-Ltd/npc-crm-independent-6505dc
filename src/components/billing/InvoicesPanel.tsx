import { useCallback, useEffect, useState } from "react";
import { fetchInvoices, formatMoney, type InvoiceRecord } from "@/lib/missionControl";
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
  AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, FileText, ReceiptText, RefreshCw,
} from "lucide-react";
import { friendlyWalletError } from "./walletErrors";

const PAGE_SIZE = 25;

const STATUS_FILTERS = [
  { value: "all", label: "All invoices" },
  { value: "paid", label: "Paid" },
  { value: "open", label: "Open" },
  { value: "void", label: "Void" },
  { value: "uncollectible", label: "Uncollectible" },
] as const;

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? "unknown").toLowerCase();
  const cls =
    s === "paid"
      ? "border-success/25 bg-success/10 text-success dark:text-success"
      : s === "open"
        ? "border-warning/30 bg-warning/10 text-warning"
        : s === "uncollectible"
          ? "border-destructive/25 bg-destructive/10 text-destructive"
          : "border-border/70 bg-muted/60 text-muted-foreground";
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 capitalize", cls)}>
      {s}
    </Badge>
  );
}

/**
 * Invoice ledger (Invoices tab of Billing & Usage). Stripe invoices mirrored
 * by Mission Control — one per purchase and subscription cycle — with links
 * to Stripe's hosted invoice page and downloadable PDF.
 */
export function InvoicesPanel() {
  const [rows, setRows] = useState<InvoiceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextOffset: number, nextStatus: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchInvoices({
        limit: PAGE_SIZE,
        offset: nextOffset,
        status: nextStatus === "all" ? undefined : nextStatus,
      });
      setRows(result.invoices);
      setTotal(result.pagination.total);
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Failed to load invoices.";
      console.error("[invoices] load failed:", raw);
      setError(friendlyWalletError(raw));
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
                <ReceiptText className="h-5 w-5" />
              </span>
              <span className="truncate">Invoices</span>
            </CardTitle>
            <CardDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
              A Stripe invoice for every purchase and subscription renewal — view the hosted
              invoice or download the PDF for your records.
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
              <SelectTrigger className="h-10 w-[170px] rounded-xl" aria-label="Filter invoices by status">
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
              aria-label="Refresh invoices"
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
                <FileText className="h-7 w-7" />
              </div>
              <p className="text-sm font-semibold text-foreground">No invoices yet.</p>
              <p className="text-xs leading-5 text-muted-foreground">
                Invoices are issued automatically for every purchase and subscription renewal.
                They'll appear here with a hosted view and a downloadable PDF.
              </p>
            </div>
          </div>
        ) : rows.length > 0 ? (
          <>
            <div className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background/45">
              <div className="overflow-x-auto overscroll-x-contain">
                <Table className="min-w-[980px]" aria-label="Invoices">
                  <TableHeader>
                    <TableRow className="bg-muted/35 hover:bg-muted/35">
                      <TableHead className="w-[140px]">Issued</TableHead>
                      <TableHead className="w-[150px]">Number</TableHead>
                      <TableHead className="w-[240px]">Item</TableHead>
                      <TableHead className="w-[110px] text-right">Total</TableHead>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead className="w-[130px]">Paid</TableHead>
                      <TableHead className="w-[150px]">Billed to</TableHead>
                      <TableHead className="w-[120px] text-right">Links</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id} className="transition-colors hover:bg-primary/5">
                        <TableCell className="align-top text-xs text-muted-foreground">
                          <span className="block whitespace-nowrap font-medium text-foreground">
                            {new Date(r.issuedAt ?? r.createdAt).toLocaleDateString('en-AU')}
                          </span>
                          <span className="block truncate">
                            {new Date(r.issuedAt ?? r.createdAt).toLocaleTimeString('en-AU')}
                          </span>
                        </TableCell>
                        <TableCell className="align-top font-mono text-xs">{r.number ?? "—"}</TableCell>
                        <TableCell className="min-w-0 align-top">
                          <span className="block truncate text-sm font-medium" title={r.itemName ?? r.description ?? undefined}>
                            {r.itemName ?? r.description ?? r.itemSlug ?? (r.mode === "subscription_cycle" ? "Subscription renewal" : "—")}
                          </span>
                          {r.periodStart && r.periodEnd && (
                            <span className="block truncate pt-1 text-xs text-muted-foreground">
                              {new Date(r.periodStart).toLocaleDateString('en-AU')} – {new Date(r.periodEnd).toLocaleDateString('en-AU')}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="align-top text-right text-sm font-semibold tabular-nums">
                          {formatMoney(r.totalCents ?? r.amountDueCents, r.currency)}
                        </TableCell>
                        <TableCell className="align-top"><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="align-top text-xs text-muted-foreground">
                          {r.paidAt ? new Date(r.paidAt).toLocaleDateString('en-AU') : "—"}
                        </TableCell>
                        <TableCell className="min-w-0 align-top text-xs">
                          <span className="block truncate" title={r.originUsername ?? undefined}>
                            {r.originUsername ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <div className="inline-flex items-center gap-1">
                            {r.hostedInvoiceUrl && (
                              <Button asChild variant="outline" size="icon" className="h-8 w-8 rounded-lg" title="View hosted invoice">
                                <a href={r.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer" aria-label={`View invoice ${r.number ?? ""}`}>
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                            )}
                            {r.invoicePdfUrl && (
                              <Button asChild variant="outline" size="icon" className="h-8 w-8 rounded-lg" title="Download PDF">
                                <a href={r.invoicePdfUrl} target="_blank" rel="noopener noreferrer" aria-label={`Download invoice ${r.number ?? ""} PDF`}>
                                  <FileText className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                            )}
                            {!r.hostedInvoiceUrl && !r.invoicePdfUrl && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="flex min-w-0 flex-col justify-between gap-3 pt-1 sm:flex-row sm:items-center">
              <span className="text-xs text-muted-foreground">
                {total.toLocaleString('en-AU')} invoice{total === 1 ? "" : "s"}
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
