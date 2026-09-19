/**
 * Mount once near the app root. Subscribes to global token events and:
 *  - Renders an OutOfTokens modal dialog when a generator hits insufficient_funds.
 *  - Shows a sonner toast confirming tokens used on successful generation.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { onTokensUsed, onOutOfTokens, type OutOfTokensDetail } from "@/lib/tokenEvents";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  fetchTopupPacks,
  AURIXA_PRICING_URL,
  openMissionControlWithAttribution,
} from "@/lib/missionControl";

const FUNCTION_LABELS: Record<string, string> = {
  "generate-investment-report": "Investment report",
  "generate-bulk-reports": "Bulk reports",
  "generate-market-intelligence-report": "Market intelligence report",
  "generate-portfolio-analysis": "Portfolio analysis",
  "generate-chart-analysis": "Chart analysis",
  "regenerate-report-qualitative": "Report regeneration",
};

export function TokenEventsListener() {
  const [outOfTokens, setOutOfTokens] = useState<OutOfTokensDetail | null>(null);
  const [topupUrl, setTopupUrl] = useState<string>("");

  useEffect(() => {
    // Chunked generators (e.g. investment reports) emit a tokens-used event per
    // section. Coalesce them into a single toast per generator after a quiet
    // period so users don't get spammed with 17 identical toasts.
    const COALESCE_MS = 2500;
    const buckets = new Map<string, {
      tokensUsed: number;
      durationMs: number;
      count: number;
      timer: ReturnType<typeof setTimeout>;
    }>();

    const flush = (functionName: string) => {
      const b = buckets.get(functionName);
      if (!b) return;
      buckets.delete(functionName);
      const label = FUNCTION_LABELS[functionName] ?? "Report";
      const parts: string[] = [`Used ${b.tokensUsed.toLocaleString('en-AU')} tokens`];
      if (b.durationMs > 0) {
        const s = (b.durationMs / 1000).toFixed(b.durationMs < 10_000 ? 1 : 0);
        parts.push(`${s}s`);
      }
      if (b.count > 1) parts.push(`${b.count} sections`);
      toast.success(`${label} complete`, {
        id: `tokens-used:${functionName}`,
        description: parts.join(" · "),
      });
    };

    const offUsed = onTokensUsed(({ tokensUsed, durationMs, functionName }) => {
      const existing = buckets.get(functionName);
      if (existing) clearTimeout(existing.timer);
      const next = {
        tokensUsed: (existing?.tokensUsed ?? 0) + (tokensUsed || 0),
        durationMs: (existing?.durationMs ?? 0) + (durationMs || 0),
        count: (existing?.count ?? 0) + 1,
        timer: setTimeout(() => flush(functionName), COALESCE_MS),
      };
      buckets.set(functionName, next);
    });
    const offOOT = onOutOfTokens((detail) => {
      setOutOfTokens(detail);
    });
    return () => {
      offUsed();
      offOOT();
      buckets.forEach((b) => clearTimeout(b.timer));
      buckets.clear();
    };
  }, []);

  // Lazy-fetch top-up deep link once the modal is triggered.
  useEffect(() => {
    if (!outOfTokens || topupUrl) return;
    let cancelled = false;
    fetchTopupPacks()
      .then((r) => {
        if (!cancelled && r.topupUrl) setTopupUrl(r.topupUrl);
      })
      .catch(() => {/* keep fallback */});
    return () => { cancelled = true; };
  }, [outOfTokens, topupUrl]);

  const open = outOfTokens !== null;
  const available = outOfTokens?.available ?? 0;
  const requested = outOfTokens?.requested ?? 0;
  const short = Math.max(0, requested - available);
  const label = outOfTokens
    ? FUNCTION_LABELS[outOfTokens.functionName] ?? outOfTokens.label ?? "This report"
    : "This report";

  const handleTopUp = () => {
    void openMissionControlWithAttribution("topup", topupUrl || AURIXA_PRICING_URL);
    setOutOfTokens(null);
  };

  const handleUpgrade = () => {
    void openMissionControlWithAttribution("seat_plan", AURIXA_PRICING_URL);
    setOutOfTokens(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setOutOfTokens(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">Out of report credits</DialogTitle>
          <DialogDescription className="text-center">
            {label} needs{" "}
            <span className="font-semibold text-foreground">{requested.toLocaleString('en-AU')}</span>{" "}
            tokens but only{" "}
            <span className="font-semibold text-foreground">{available.toLocaleString('en-AU')}</span>{" "}
            are available in your agency pool — you're short by{" "}
            <span className="font-semibold text-foreground">{short.toLocaleString('en-AU')}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
          Top up your token balance to continue generating this report. New credits are available
          instantly once your purchase completes.
        </div>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setOutOfTokens(null)}>
            Not now
          </Button>
          <Button variant="outline" onClick={handleUpgrade}>
            Upgrade plan
          </Button>
          <Button onClick={handleTopUp}>Top up credits</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
