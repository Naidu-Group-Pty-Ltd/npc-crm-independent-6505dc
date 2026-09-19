import { useEffect, useState } from "react";
import { ExternalLink, Loader2, ReceiptText, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchPurchaseHistory,
  AURIXA_PRICING_URL,
  openMissionControlWithAttribution,
  type PurchaseRecord,
} from "@/lib/missionControl";

/**
 * Attributed purchase history for this install (user-attributed pricing
 * workflow). Data comes from Mission Control's read-back API via the
 * `mission-control-purchases` edge function — rows are scoped server-side to
 * this clone's API key, and each row names the user who initiated it.
 */
export function PurchaseHistoryCard() {
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchPurchaseHistory({ limit: 10 });
      setPurchases(r.purchases);
      setTotal(r.pagination.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load purchase history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const money = (cents: number | null, currency: string | null) => {
    if (cents == null) return "—";
    try {
      return new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: (currency ?? "AUD").toUpperCase(),
      }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency ?? ""}`;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ReceiptText className="h-4 w-4" />
            Purchase history
          </CardTitle>
          <CardDescription>
            Credits, seats and setup packages bought for this workspace — and who bought them.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh purchase history"
        >
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && purchases.length === 0 && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading purchases…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && purchases.length === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No purchases yet. Top-ups and plan upgrades made from this workspace will appear here.
          </div>
        )}

        {purchases.length > 0 && (
          <div className="space-y-2">
            {purchases.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.itemSlug ?? p.mode}</span>
                    <Badge
                      variant={p.status === "refunded" ? "destructive" : "secondary"}
                      className="text-[10px] uppercase"
                    >
                      {p.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.originUsername ?? p.originUserId ?? "unknown user"} ·{" "}
                    {new Date(p.createdAt).toLocaleDateString('en-AU')}
                    {p.quantity > 1 ? ` · ×${p.quantity}` : ""}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  {money(p.amountCents, p.currency)}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
          <span>
            {total > 0 ? `${total.toLocaleString('en-AU')} total purchase${total === 1 ? "" : "s"}` : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void openMissionControlWithAttribution("pricing", AURIXA_PRICING_URL)
            }
          >
            Buy more
            <ExternalLink className="ml-1.5 h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
