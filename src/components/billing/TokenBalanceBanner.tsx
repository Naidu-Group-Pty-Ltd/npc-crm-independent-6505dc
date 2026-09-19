import { AlertTriangle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import {
  AURIXA_PRICING_URL,
  openMissionControlWithAttribution,
} from "@/lib/missionControl";

/**
 * Global low/critical token balance banner. Rendered once in DashboardLayout,
 * shown on every route. Fully driven by branding tokens (no hardcoded colors),
 * so it re-themes automatically via BrandProvider / useTokens.
 *
 * States:
 *  - low       (< 10%): subtle, warning-tinted card
 *  - critical  (<  5%): solid destructive-tinted banner (stronger)
 */
export function TokenBalanceBanner() {
  const { balance, lowBalance, criticalBalance } = useTokenBalance();

  if (!balance || (!lowBalance && !criticalBalance)) return null;

  // Only meaningful when the tenant has a plan allowance; tenants running on
  // top-up credits alone (allowance 0) get absolute-threshold warnings and
  // the percentage suffix is dropped from the copy below.
  const pct =
    balance.allowance > 0
      ? Math.round((balance.available / balance.allowance) * 100)
      : null;

  const isCritical = criticalBalance;

  return (
    <div
      role="alert"
      aria-live={isCritical ? "assertive" : "polite"}
      className={cn(
        "relative mx-auto w-full max-w-[1600px] min-w-0 overflow-hidden rounded-2xl border px-4 py-3.5 sm:px-5",
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        "transition-colors",
        isCritical
          ? // Solid destructive
            "border-destructive bg-destructive text-destructive-foreground shadow-[0_18px_44px_hsl(var(--destructive)/0.35)]"
          : // Subtle warning
            "border-warning/40 bg-warning/10 text-foreground shadow-[0_12px_32px_hsl(var(--foreground)/0.06)] backdrop-blur-sm",
      )}
    >
      <div className="flex min-w-0 items-start gap-3 sm:items-center">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
            isCritical
              ? "border-destructive-foreground/30 bg-destructive-foreground/10 text-destructive-foreground"
              : "border-warning/40 bg-warning/15 text-warning",
          )}
        >
          {isCritical ? (
            <Zap className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
        </span>

        <div className="min-w-0 space-y-0.5">
          <p
            className={cn(
              "font-heading text-sm font-semibold tracking-tight",
              isCritical ? "text-destructive-foreground" : "text-warning",
            )}
          >
            {isCritical ? "Token balance critical" : "Token balance low"}
          </p>
          <p
            className={cn(
              "text-sm leading-6 break-words",
              isCritical
                ? "text-destructive-foreground/90"
                : "text-foreground/80",
            )}
          >
            <span
              className={cn(
                "font-semibold tabular-nums",
                isCritical ? "text-destructive-foreground" : "text-foreground",
              )}
            >
              {balance.available.toLocaleString('en-AU')} tokens remaining
              {pct != null ? ` (${pct}% of allowance)` : ""}.
            </span>{" "}
            {isCritical
              ? "Top up now to avoid blocked report generation."
              : "Top up to avoid interrupted report generation."}
          </p>
        </div>
      </div>

      <Button
        aria-label="Top up token balance"
        size="sm"
        variant={isCritical ? "secondary" : "default"}
        onClick={() => void openMissionControlWithAttribution("topup", AURIXA_PRICING_URL)}
        className={cn(
          "w-full shrink-0 rounded-full px-5 font-semibold sm:w-auto",
          isCritical &&
            "bg-destructive-foreground text-destructive hover:bg-destructive-foreground/90",
        )}
      >
        Top up
      </Button>
    </div>
  );
}
