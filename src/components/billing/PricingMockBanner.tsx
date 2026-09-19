import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { FlaskConical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AURIXA_PRICING_MOCK_URL,
  isPricingMockEnabled,
  pricingMockEnabledByBuild,
  readPricingMockOverride,
  setPricingMockEnabled,
} from "@/lib/pricingMock";

/**
 * Says out loud that purchase CTAs are pointed at the A$1 test catalogue, and
 * owns the switch that puts them there.
 *
 * Two jobs, and the first is the important one. A mode that silently rewrites
 * every "Top up credits" and "Upgrade plan" button is a trap: somebody flips it
 * to run a sweep, forgets, and a fortnight later cannot work out why a genuine
 * upgrade attempt charged a dollar and provisioned nothing. So while it is on
 * it is stated permanently on screen, with the way out in the same breath.
 *
 * The switch is a URL parameter — `?pricingMock=1` to arm, `?pricingMock=0` to
 * disarm — remembered in localStorage so it survives navigation. A parameter
 * rather than a settings toggle because a tester is handed a link, and because
 * arming it has to be a deliberate act rather than something reachable by
 * mis-clicking in an admin panel. Absent parameter leaves any stored setting
 * alone; that is why `readPricingMockOverride` distinguishes "not mentioned"
 * from "turned off".
 *
 * A build with `VITE_AURIXA_PRICING_MOCK=true` is on unconditionally and cannot
 * be dismissed from here, which is correct: that is a deployment-level decision
 * and a button in the corner should not appear to override it.
 */
export function PricingMockBanner() {
  const location = useLocation();
  const [active, setActive] = useState(false);

  useEffect(() => {
    const override = readPricingMockOverride(location.search);
    if (override !== null) setPricingMockEnabled(override);
    setActive(isPricingMockEnabled());
  }, [location.search]);

  if (!active) return null;

  const fromBuild = pricingMockEnabledByBuild();

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[60] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-destructive/50 bg-destructive px-4 py-3 text-destructive-foreground shadow-lg"
    >
      <div className="flex items-start gap-3">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">Stripe test catalogue is active</p>
          <p className="mt-1 text-xs leading-relaxed opacity-90">
            Every purchase button opens the A$1 mock catalogue instead of the real price
            list. Charges are real but nominal, and nothing is provisioned. Saving a card is
            unaffected.{" "}
            <a
              href={AURIXA_PRICING_MOCK_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
            >
              Open the catalogue
            </a>
            .
          </p>
        </div>
        {/* A build-level flag is not something a button in the corner should
            appear to override, so the dismiss is offered only when the mode
            came from the toggle. */}
        {!fromBuild && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Exit Stripe test mode"
            onClick={() => {
              setPricingMockEnabled(false);
              setActive(false);
            }}
            className="h-7 shrink-0 px-2 text-destructive-foreground hover:bg-destructive-foreground/15 hover:text-destructive-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
            <span className="ml-1 text-xs">Exit</span>
          </Button>
        )}
      </div>
    </div>
  );
}
