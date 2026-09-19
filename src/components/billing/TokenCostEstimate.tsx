import { useMemo } from "react";
import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { estimateTokens, type TokenKind } from "@/lib/missionControl";

interface TokenCostEstimateProps {
  kind?: TokenKind;
  /** Explicit estimate override (skips kind/options if provided). */
  estimate?: number;
  /** Forwarded to estimateTokens when kind is provided. */
  options?: { extraSections?: number; aiNarrative?: boolean; multiplier?: number };
  className?: string;
  /** Compact pill (icon + number only). */
  compact?: boolean;
}

/**
 * Always-visible inline chip showing the projected token cost of a report and
 * the user's current available balance. Recomputes whenever `kind`, `estimate`,
 * or `options` change, and live-updates the available figure via useTokenBalance.
 */
export function TokenCostEstimate({
  kind,
  estimate,
  options,
  className,
  compact = false,
}: TokenCostEstimateProps) {
  const { balance } = useTokenBalance();

  const need = useMemo(() => {
    if (typeof estimate === "number" && estimate > 0) return Math.ceil(estimate);
    if (kind) return estimateTokens(kind, options);
    return 0;
  }, [estimate, kind, options?.extraSections, options?.aiNarrative, options?.multiplier]);

  if (need <= 0) return null;

  const available = balance?.available ?? null;
  const exempt = Boolean(balance?.exempt);
  const insufficient = !exempt && available != null && need > available;
  const low = !exempt && available != null && available - need < (balance?.allowance ?? 0) * 0.1;

  const stateClass = insufficient
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : low
    ? "border-warning/40 bg-warning/10 text-warning"
    : "border-border bg-muted/40 text-foreground";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium tabular-nums",
        stateClass,
        className,
      )}
      title={
        available != null
          ? `Cost: ${need.toLocaleString('en-AU')} tokens · ${available.toLocaleString('en-AU')} available`
          : `Cost: ${need.toLocaleString('en-AU')} tokens`
      }
    >
      <Coins className="h-3.5 w-3.5 opacity-80" />
      {compact ? (
        <span>~{need.toLocaleString('en-AU')}</span>
      ) : (
        <span>
          Est. cost <span className="font-semibold">~{need.toLocaleString('en-AU')}</span> tokens
          {available != null && (
            <span className="ml-1.5 font-normal opacity-80">
              · {available.toLocaleString('en-AU')} available
            </span>
          )}
        </span>
      )}
    </div>
  );
}
