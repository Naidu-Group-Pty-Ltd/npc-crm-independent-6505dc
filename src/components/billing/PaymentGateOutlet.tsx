import type { ReactNode } from "react";
import { usePaymentGate } from "@/hooks/usePaymentGate";
import { PaymentGateScreen } from "@/components/billing/PaymentGateScreen";

/**
 * The route-level half of the activation gate — the same shape as
 * `ClientFacingGate`, sat around the dashboard outlet.
 *
 * ## Why here and not on the router
 *
 * Every dashboard route is inside this one mount, so there is one place that
 * decides and no route can be added that forgets to. Putting it on individual
 * routes would mean a new page ships ungated by default, which is precisely
 * backwards.
 *
 * ## What stays reachable
 *
 * The login page, password reset, the client/partner portals and every public
 * link are OUTSIDE the dashboard layout and are untouched. That is deliberate:
 * a workspace that cannot be signed into cannot reach support, cannot pay, and
 * cannot tell anyone what is wrong.
 *
 * Presentation only. Mission Control refuses a locked workspace's token and
 * seat reservations with 402 regardless of what this renders, which is what
 * makes it safe for this component to fail open on every error.
 */
export function PaymentGateOutlet({ children }: { children: ReactNode }) {
  const { blocked } = usePaymentGate();
  if (blocked) return <PaymentGateScreen />;
  return <>{children}</>;
}
