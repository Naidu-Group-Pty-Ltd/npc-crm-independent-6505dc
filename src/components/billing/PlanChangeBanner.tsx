import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  acknowledgePlanChange,
  fetchPlanChange,
  type PlanChangeNotice,
} from "@/lib/missionControl";

/**
 * "Your billing plan changed, and here is what landed in your balance." Once.
 *
 * Shown in the workspace rather than only on the pricing page, because the
 * pricing page tells whoever happened to be standing at the checkout — while
 * the balance is spent here, by everyone. A team that finds a different number
 * one morning with no explanation is the case this exists to prevent.
 *
 * Three facts and nothing else: the plan they are on now, the credits added,
 * and when those credits lapse. The last one matters because credits expire 30
 * days after they are issued, and an allowance nobody knows arrived is an
 * allowance nobody spends.
 *
 * Dismissing is what retires it, never loading. A notice acknowledged on fetch
 * is lost to anyone whose page failed to render, and this is the only time it
 * is shown. Fully token-driven, so it re-themes with the rest of the shell.
 */
export function PlanChangeBanner() {
  const [notice, setNotice] = useState<PlanChangeNotice | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchPlanChange().then((n) => {
      if (!cancelled) setNotice(n);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    if (!notice) return;
    // Optimistic: it goes now and the acknowledgement follows. Worst case it
    // returns once, which beats a banner sitting there mid-request.
    const id = notice.id;
    setNotice(null);
    void acknowledgePlanChange(id);
  }, [notice]);

  if (!notice) return null;

  const granted = notice.creditsGranted > 0;
  const expires = notice.creditsExpireAt ? new Date(notice.creditsExpireAt) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "relative mx-auto w-full max-w-[1600px] min-w-0 overflow-hidden rounded-2xl border px-4 py-3.5 sm:px-5",
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        "border-primary/40 bg-primary/10 text-foreground backdrop-blur-sm",
        "shadow-[0_12px_32px_hsl(var(--foreground)/0.06)]",
      )}
    >
      <div className="flex min-w-0 items-start gap-3 sm:items-center">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/15 text-primary">
          <Check className="h-4 w-4" />
        </span>

        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">
            {notice.fromPlanName
              ? `Your plan changed from ${notice.fromPlanName} to ${notice.toPlanName}`
              : `Your workspace is now on ${notice.toPlanName}`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {granted ? (
              <>
                <span className="font-medium text-foreground">
                  {notice.creditsGranted.toLocaleString('en-AU')} credits
                </span>{" "}
                have been added to your balance
                {expires && (
                  <>
                    {" "}
                    and stay spendable until{" "}
                    <span className="text-foreground">
                      {expires.toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "long",
                      })}
                    </span>
                  </>
                )}
                . Your allowance renews with your plan each month.
              </>
            ) : (
              // A real outcome worth stating plainly rather than hiding:
              // changing plan twice inside one month grants the allowance once.
              <>
                This month&rsquo;s allowance was already credited, so no further credits were
                added. The next one arrives when your plan renews.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
        <Button asChild size="sm" variant="outline" className="gap-1.5">
          <a href="/settings/billing">
            View billing
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={dismiss}
          aria-label="Dismiss plan change notice"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
