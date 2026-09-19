import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared AML metric tile.
 *
 * Replaces seven near-identical local implementations (MetricTile, Tile,
 * KpiCard ×3, SummaryTile, SummaryTiles — audit §2.30) with one card that
 * makes its data state explicit. The states matter operationally:
 *
 *  - `loading`      the request is still in flight (skeleton);
 *  - `ready`        a real value, including a real zero;
 *  - `unavailable`  the request finished without a value (API failure or
 *                   the environment has no data source) — never rendered
 *                   as "0" or an ambiguous dash.
 *
 * Permission-restricted metrics are handled by NOT rendering the card at
 * all (tipping-off protection, AGENTS.md) — there is deliberately no
 * "restricted" placeholder state.
 */
export interface AmlMetricCardProps {
  title: string;
  icon?: LucideIcon;
  state: "loading" | "ready" | "unavailable";
  tone?: "neutral" | "healthy" | "attention" | "critical";
  value?: number | string | null;
  /** One-line qualifier under the value ("3 critical", "Rule engine backlog"). */
  hint?: string;
  /** Hint shown in the unavailable state instead of `hint`. */
  unavailableHint?: string;
  /** Deep link to the surface where this number is worked. */
  to?: string;
  className?: string;
  /**
   * Draw as a cell in a shared strip rather than as a card of its own.
   *
   * ── Why this exists ──────────────────────────────────────────────
   * Compliance Home drew six of these as six full cards in two rows: six
   * borders, six paddings and six headers around six single-digit numbers,
   * most of them a healthy zero. The numbers are a glance, not a reading,
   * and they were taking the height of the page's actual work.
   *
   * Dense drops the card chrome and keeps everything that matters — the
   * loading skeleton, the "Not available" reading that is never a
   * fabricated zero, the tone, the deep link and the accessible name. A
   * second component would have been a second answer to all of those.
   */
  dense?: boolean;
}

export function AmlMetricCard({
  title,
  icon: Icon,
  state,
  value,
  hint,
  unavailableHint = "Not available right now. Refresh to try again.",
  to,
  className,
  tone = "neutral",
  dense = false,
}: AmlMetricCardProps) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  const resolvedTone = state === "unavailable" ? "unavailable" : state === "ready" && numeric === 0 ? "healthy" : tone;
  const toneClass = resolvedTone === "critical"
    ? "border-destructive/30 bg-destructive/5"
    : resolvedTone === "attention"
      ? "border-warning/35 bg-warning/5"
      : resolvedTone === "healthy"
        ? "border-success/25 bg-success/5"
        : resolvedTone === "unavailable"
          ? "border-dashed opacity-80"
          : "border-border/70 bg-card/45";
  const denseBody = (
    <div
      className={cn(
        "flex h-full flex-col gap-0.5 rounded-md px-3 py-2 transition-colors",
        resolvedTone === "critical" && "text-destructive",
        resolvedTone === "attention" && "text-warning",
        to && "hover:bg-primary/5",
        className,
      )}
    >
      {/*
        Two lines are RESERVED for the label, whether or not it needs them.
        "Awaiting decision" and "Periodic reviews" wrap where "Total" does
        not, and a strip whose numbers sit at three different heights reads
        as three different things. Reserving the line costs a few pixels on
        a strip that saved a few hundred.
      */}
      {/* `min-w-0` and `break-words` are what keep a long single word inside
          its own cell. On a phone the strip is three cells of ~110px and
          "UNPROCESSED" is ~105px of letter-spaced capitals: with neither, it
          overflowed into the cell beside it and printed across the next
          label's icon. It breaks only when a word cannot fit at all, so
          every label that can wrap normally still does. */}
      <span className="flex min-h-[2.1em] min-w-0 items-start gap-1.5 text-[10px] font-semibold uppercase leading-[1.05] tracking-[0.12em] text-muted-foreground">
        {Icon && <Icon aria-hidden="true" className="mt-[1px] h-3 w-3 shrink-0" />}
        <span className="min-w-0 break-words">{title}</span>
      </span>
      {state === "loading" ? (
        <>
          <Skeleton className="h-6 w-10" aria-hidden="true" />
          <span className="sr-only">Loading {title}</span>
        </>
      ) : state === "unavailable" ? (
        <span className="text-sm font-semibold text-muted-foreground">Not available</span>
      ) : (
        <span className="text-2xl font-semibold leading-none tabular-nums">{value ?? 0}</span>
      )}
      <span className="text-[11px] leading-snug text-muted-foreground">
        {state === "unavailable" ? unavailableHint : hint}
      </span>
    </div>
  );

  const body = dense ? denseBody : (
    <Card
      className={cn(
        "h-full shadow-sm", toneClass,
        to && "transition-colors hover:border-primary/40 hover:bg-primary/5",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        {Icon && <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        {state === "loading" ? (
          <>
            <Skeleton className="h-8 w-16" aria-hidden="true" />
            <span className="sr-only">Loading {title}</span>
          </>
        ) : state === "unavailable" ? (
          <div className="text-sm font-semibold text-muted-foreground">Not available</div>
        ) : (
          <div className="text-2xl font-semibold tabular-nums">{value ?? 0}</div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {state === "unavailable" ? unavailableHint : hint}
        </p>
      </CardContent>
    </Card>
  );

  if (!to) return body;
  return (
    <Link
      to={to}
      className={cn(
        "block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        dense ? "rounded-md" : "rounded-lg",
      )}
      aria-label={
        state === "ready"
          ? `${title}: ${value ?? 0}. Open the matching queue.`
          : `${title}. Open the matching queue.`
      }
    >
      {body}
    </Link>
  );
}
