import { useEffect } from "react";
import { BUILDER_NETWORK_ORIGIN, builderNetworkPortalUrl } from "@/lib/builderNetworkOrigin";

/**
 * `/builder/*` — the portal moved to the Builders Network (plan §7 Phase 6).
 *
 * This is the SPA's edition of a 302: every path under `/builder` resolves
 * here and is replaced with the network origin, `?from=` naming this
 * workspace. `replace` rather than `href`, so the dead portal URL does not
 * sit in history behind the Back button, bouncing every return press.
 *
 * The one visible line exists for the sub-second flash before the browser
 * navigates, and as the manual door if navigation is blocked — a blank white
 * page during a redirect reads as a broken product, and a tester mid-session
 * deserves to be told where their portal went rather than merely finding
 * themselves somewhere else.
 *
 * Deliberately NOT here: no auth provider, no portal chrome, no per-path
 * mapping onto network routes. The clone no longer knows the portal's inner
 * geography — the network owns it — and a mapping maintained here would rot
 * into deep links that land wrong, which is worse than arriving at the door.
 */
export default function BuilderPortalMoved() {
  const destination = builderNetworkPortalUrl(window.location.hostname);

  useEffect(() => {
    window.location.replace(destination);
  }, [destination]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <p className="max-w-md text-center text-sm text-muted-foreground">
        The Builder / Developer Portal has moved to the Builders Network.{" "}
        <a className="underline underline-offset-4" href={destination}>
          Continue to {BUILDER_NETWORK_ORIGIN.replace("https://", "")}
        </a>
      </p>
    </div>
  );
}
