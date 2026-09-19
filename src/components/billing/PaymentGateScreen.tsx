import { useEffect, useState } from "react";
import {
  Lock,
  ExternalLink,
  LifeBuoy,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { usePaymentGate } from "@/hooks/usePaymentGate";
import { startActivationCheckout } from "@/lib/paymentGate/client";
import {
  formatMoney,
  formatRemaining,
  lockedCopy,
  payingCanUnlock,
  remainingMs,
} from "@/lib/paymentGate/state";
import { toast } from "sonner";

/**
 * What a locked workspace shows instead of the dashboard.
 *
 * ## It is a door, not a wall
 *
 * The one thing this screen exists to do is get somebody paid and back to
 * work, so the payment is a single primary button that goes straight to
 * Stripe. Everything else on the page is secondary: what the plan is, what it
 * costs, that their data is untouched, how to reach a human, and how to sign
 * out. There is no form, nothing to read before acting, and no dead end — if
 * minting the Stripe session fails the button becomes a link to the pricing
 * page, which can always take a payment.
 *
 * ## It never blames the reader
 *
 * The person looking at this may have joined last week and have no idea a
 * payment was owed. The copy is about the ACCOUNT — see `lockedCopy` — and it
 * never claims a payment failed, because this build cannot know that.
 */
export function PaymentGateScreen() {
  const { verdict, refresh } = usePaymentGate();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  /**
   * The buyer has just come back from Stripe and the webhook has not landed.
   *
   * The only guard against minting a second activation checkout is Mission
   * Control's `paid_at`, which is written by the Stripe webhook — so for the
   * whole interval between the customer paying and that webhook arriving, the
   * server would happily mint another one. Leaving the primary button live
   * over that window invites a second subscription on the screen they were
   * returned to, and for those seconds it is the only thing on the page that
   * looks like progress.
   */
  const [confirming, setConfirming] = useState(false);

  const copy = lockedCopy(verdict);
  const price = formatMoney(
    verdict.plan?.amountDueCents ?? null,
    verdict.plan?.currency ?? "AUD",
  );
  const planLabel = verdict.plan?.name ?? verdict.plan?.slug ?? null;

  // Returning from Stripe, the webhook may land a beat after the redirect.
  // Re-reading a few times turns "I paid and it still says locked" into a
  // screen that opens by itself.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("activation") !== "success") return;
    let cancelled = false;
    let attempts = 0;
    setConfirming(true);
    const tick = () => {
      if (cancelled) return;
      if (attempts >= 20) {
        // Out of patience, not out of hope: the payment is captured and the
        // webhook will land. Handing the button back is the wrong end of that
        // — it reads as "pay again" — so the screen says what is true and
        // leaves the manual re-check in the footer.
        setConfirming(false);
        return;
      }
      attempts += 1;
      void refresh().then(() => {
        if (!cancelled) setTimeout(tick, 3000);
      });
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function pay() {
    setBusy(true);
    try {
      const result = await startActivationCheckout(window.location.origin);
      switch (result.ok) {
        case true:
          // Same tab: this IS the task. A new tab leaves a dead lock screen
          // behind that the customer comes back to and reads as "it didn't work".
          window.location.assign(result.url);
          return;
        case false:
          // "You have already paid" is not a retryable failure, and telling a
          // customer to try again after their money has arrived invites a
          // second subscription. The right answer is to re-read the verdict:
          // the gate is about to open, or already has.
          if (result.error === "already_paid") {
            setConfirming(true);
            void refresh();
            toast.success(
              "Your payment is already recorded — unlocking this workspace now.",
            );
            return;
          }
          if (result.pricingUrl) {
            setFallbackUrl(result.pricingUrl);
            toast.error(
              "Could not open the payment page automatically — use the link below.",
            );
          } else {
            toast.error(
              "Could not start the payment. Please try again, or use the payment page link below.",
            );
          }
          return;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6 rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex items-start gap-4">
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
          >
            <Lock className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {copy.headline}
            </h1>
            <p className="text-sm text-muted-foreground">{copy.body}</p>
          </div>
        </div>

        {/* The same rule as the button: quoting a price to somebody who
            cannot settle it is an offer that does not exist. */}
        {(planLabel || price) && payingCanUnlock(verdict) && (
          <dl className="space-y-2 rounded-md border border-border bg-muted/40 p-4 text-sm">
            {planLabel && (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Plan</dt>
                <dd className="font-medium">{planLabel}</dd>
              </div>
            )}
            {price && (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-medium">
                  {price}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    per month
                  </span>
                </dd>
              </div>
            )}
          </dl>
        )}

        {/* Just back from Stripe. The money is captured and Mission Control is
            waiting on the webhook; offering the button again here is offering
            a second subscription. */}
        {confirming && (
          <Alert>
            <RefreshCw className="h-4 w-4 animate-spin" />
            <AlertDescription>
              <span className="font-medium">Confirming your payment…</span> This
              usually takes a few seconds. The dashboard opens by itself the
              moment it clears — there is no need to pay again.
            </AlertDescription>
          </Alert>
        )}

        {/* Offered only where paying is what lifts this. An operator hold is
            not payable and neither is a state this build cannot read — see
            `payingCanUnlock`. */}
        {payingCanUnlock(verdict) && !confirming && (
          <div className="space-y-3">
            <Button size="lg" className="w-full" onClick={pay} disabled={busy}>
              {busy ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Opening secure checkout…
                </>
              ) : (
                <>
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {price
                    ? `Pay ${price} and unlock`
                    : "Complete payment and unlock"}
                </>
              )}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Payment is taken by Aurixa Systems through Stripe. Your workspace
              unlocks the moment it clears — usually within a few seconds.
            </p>
          </div>
        )}

        {/* The standing way out.
            `verdict.pricingUrl` is sent by Mission Control on every gated read
            — its own comment calls it "always a real URL when gated, never
            null, because a locked screen with no way out is worse than no
            screen" — and until now nothing in the product read it. The
            fallback appeared only when a refusal happened to carry its own
            copy, which is three of the checkout route's fifteen refusal
            shapes. On the other twelve, and whenever Mission Control is
            unreachable at all, this screen was a dead end. */}
        {payingCanUnlock(verdict) && (fallbackUrl ?? verdict.pricingUrl) && (
          <Alert>
            <ExternalLink className="h-4 w-4" />
            <AlertDescription>
              {fallbackUrl
                ? "Could not open the checkout from here. "
                : "Prefer to pay another way? "}
              <a
                href={(fallbackUrl ?? verdict.pricingUrl) as string}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-4"
              >
                Open the Aurixa Systems payment page
              </a>
              .
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
          <div className="flex flex-wrap gap-3">
            <a
              href="mailto:support@aurixasystems.com.au"
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <LifeBuoy className="h-3.5 w-3.5" />
              Contact support
            </a>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" />I have already paid
            </button>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The countdown, shown INSIDE a working dashboard while the window is open.
 *
 * A lock that arrives with no warning is the failure this prevents: by the
 * time the screen above appears the customer has already lost access, and
 * nobody told them it was coming. It is dismissible for the session — a banner
 * that cannot be closed is one people stop reading.
 */
export function PaymentGateBanner() {
  const { verdict, warning } = usePaymentGate();
  const [dismissed, setDismissed] = useState(false);
  const [, setTick] = useState(0);

  // Re-render each minute so the countdown is the time now, not the time the
  // verdict was fetched.
  useEffect(() => {
    if (!warning) return;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [warning]);

  if (!warning || dismissed) return null;

  const left = formatRemaining(remainingMs(verdict));
  const price = formatMoney(
    verdict.plan?.amountDueCents ?? null,
    verdict.plan?.currency ?? "AUD",
  );

  return (
    <Alert className="mb-4 border-warning/40 bg-warning/5">
      <Lock className="h-4 w-4" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm">
          <span className="font-medium">Activate your workspace</span>
          {left && left !== "none" ? ` — ${left} left` : ""}
          {price ? `. ${price} per month.` : "."}
        </span>
        <span className="flex shrink-0 gap-2">
          <ActivateNowButton />
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            Later
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}

function ActivateNowButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await startActivationCheckout(window.location.href);
        switch (result.ok) {
          case true:
            window.location.assign(result.url);
            break;
          case false:
            setBusy(false);
            // Same rule as the lock screen: already paid is not a failure to
            // retry, and a second click here buys a second subscription.
            if (result.error === "already_paid") {
              toast.success("Your payment is already recorded — thank you.");
              break;
            }
            if (result.pricingUrl)
              window.open(result.pricingUrl, "_blank", "noopener,noreferrer");
            else toast.error("Could not start the payment. Please try again.");
            break;
        }
      }}
    >
      {busy ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
      Activate now
    </Button>
  );
}
