import { useEffect, useState } from "react";
import { AlertTriangle, Ban, Coins, ExternalLink } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import {
  fetchTopupPacks,
  type TokenKind,
  estimateTokens,
  AURIXA_PRICING_URL,
  openMissionControlWithAttribution,
} from "@/lib/missionControl";

interface ReportGenerationStatusProps {
  /** Optional report kind for a sharper pre-flight estimate. */
  kind?: TokenKind;
  /** Override estimate (otherwise derived from `kind` via estimateTokens). */
  estimate?: number;
  /** When true and balance is insufficient, callers should disable their Generate CTA.
   * Use the `blocked` value from the render-prop or read `isBlocked` via context.
   */
  onBlockedChange?: (blocked: boolean) => void;
  className?: string;
}

/**
 * Inline status banner for report-generation pages. Renders one of:
 *  - nothing (healthy balance, no estimate shortfall)
 *  - "low balance" warning (under 10% remaining)
 *  - "critical balance" warning (under 5% remaining)
 *  - "insufficient for this report" block (estimate > available)
 *
 * Auto-refreshes via useTokenBalance (polling + focus + token events).
 */
export function ReportGenerationStatus({
  kind,
  estimate,
  onBlockedChange,
  className,
}: ReportGenerationStatusProps) {
  const { balance, loading, error, lowBalance, criticalBalance } = useTokenBalance();
  const [topupUrl, setTopupUrl] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetchTopupPacks()
      .then((r) => { if (!cancelled && r.topupUrl) setTopupUrl(r.topupUrl); })
      .catch(() => { /* keep fallback */ });
    return () => { cancelled = true; };
  }, []);

  const need = estimate ?? (kind ? estimateTokens(kind) : 0);
  const available = balance?.available ?? 0;
  const allowance = balance?.allowance ?? 0;
  const insufficient = balance != null && need > 0 && available < need;
  const pct = allowance > 0 ? Math.max(0, Math.min(100, (available / allowance) * 100)) : 0;

  useEffect(() => {
    onBlockedChange?.(insufficient);
  }, [insufficient, onBlockedChange]);

  if (loading && !balance) return null;
  if (error) return null;
  if (!balance) return null;
  if (!insufficient && !lowBalance && !criticalBalance) return null;

  const openTopup = () =>
    void openMissionControlWithAttribution("topup", topupUrl || AURIXA_PRICING_URL);
  const openBilling = () =>
    void openMissionControlWithAttribution("seat_plan", AURIXA_PRICING_URL);

  // Hard block: the report costs more than the balance holds
  if (insufficient) {
    const short = Math.max(0, need - available);
    return (
      <Alert
        variant="destructive"
        className={cn(
          "rounded-2xl border-destructive/40 bg-destructive/10 p-4 shadow-sm",
          "[&>svg]:top-5 [&>svg]:text-destructive",
          className,
        )}
      >
        <Ban className="h-4 w-4" />
        <AlertTitle className="text-base font-semibold text-destructive">
          Not enough report credits to generate this report
        </AlertTitle>
        <AlertDescription className="flex flex-col gap-4 text-sm text-foreground/90">
          <span className="leading-relaxed">
            This report costs{" "}
            <span className="font-semibold tabular-nums">{need.toLocaleString('en-AU')}</span> tokens but
            only <span className="font-semibold tabular-nums">{available.toLocaleString('en-AU')}</span>{" "}
            are available — short by{" "}
            <span className="font-semibold tabular-nums text-destructive">{short.toLocaleString('en-AU')}</span>. Top up or
            upgrade before generating.
          </span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={openTopup} className="shadow-sm">
              <Coins className="mr-2 h-4 w-4" /> Top up credits
              <ExternalLink className="ml-1.5 h-3 w-3 opacity-70" />
            </Button>
            <Button size="sm" variant="secondary" onClick={openBilling}>
              Upgrade plan
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  // Soft warning: critical (<5%) or low (<10%)
  const variantClass = criticalBalance
    ? "border-destructive/50 bg-destructive/10 text-destructive [&>svg]:text-destructive"
    : "border-warning/50 bg-warning/10 text-warning [&>svg]:text-warning";

  return (
    <Alert className={cn(variantClass, className)}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {criticalBalance ? "Report credits critically low" : "Report credits running low"}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-foreground/90">
            <span className="font-semibold tabular-nums">{available.toLocaleString('en-AU')}</span> of{" "}
            <span className="tabular-nums">{allowance.toLocaleString('en-AU')}</span> tokens remaining
            {need > 0 && (
              <> · this report needs ~<span className="tabular-nums">{need.toLocaleString('en-AU')}</span></>
            )}
            .
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={openTopup}>
              Top up
            </Button>
            <Button size="sm" variant="ghost" onClick={openBilling}>
              Manage plan
            </Button>
          </div>
        </div>
        {allowance > 0 && (
          <Progress
            value={pct}
            className={cn(
              "h-1.5",
              criticalBalance ? "[&>div]:bg-destructive" : "[&>div]:bg-warning",
            )}
          />
        )}
      </AlertDescription>
    </Alert>
  );
}
