/**
 * Frontend client for the activation gate.
 *
 * Every call goes through the `mission-control-gate` Edge Function so the
 * clone API key never reaches a browser — the same rule the token and seat
 * clients follow.
 */
import { parseGateResponse, unknownVerdict, type GateVerdict } from "./state";

type RawVerdict = Record<string, unknown>;

/**
 * The Edge Function returns an already-parsed verdict, so this is mostly a
 * transport. It is re-validated all the same: a build talking to an older
 * deployed function must degrade to OPEN rather than to a shape it half
 * understands.
 */
function reviveVerdict(data: unknown): GateVerdict {
  if (!data || typeof data !== "object") return unknownVerdict();
  const d = data as RawVerdict;
  // The function's own verdict shape (camelCase) — the normal case.
  if (
    typeof d.gated === "boolean" &&
    typeof d.locked === "boolean" &&
    "known" in d
  ) {
    return d as unknown as GateVerdict;
  }
  // A raw Mission Control body, should the proxy ever pass one straight
  // through. `parseGateResponse` is deliberately the same reader.
  return parseGateResponse(d);
}

export async function fetchGateVerdict(): Promise<GateVerdict> {
  try {
    const { invokeSecureFunction } = await import("@/lib/secureInvoke");
    const { data, error } = await invokeSecureFunction<GateVerdict>(
      "mission-control-gate",
      {},
    );
    if (error) {
      // Open. The gate must never be the reason a paying customer is locked
      // out by a network fault — see the pure module's header.
      console.warn("[paymentGate] verdict unavailable", error.message);
      return unknownVerdict();
    }
    return reviveVerdict(data);
  } catch (err) {
    console.warn("[paymentGate] verdict threw", err);
    return unknownVerdict();
  }
}

export type StartCheckout =
  | { ok: true; url: string }
  | { ok: false; error: string; pricingUrl: string | null };

/** Mint the Stripe Checkout URL for this workspace's activation payment. */
export async function startActivationCheckout(
  returnUrl?: string,
): Promise<StartCheckout> {
  try {
    const { invokeSecureFunction } = await import("@/lib/secureInvoke");
    const { data, error } = await invokeSecureFunction<{
      ok: boolean;
      url?: string;
      error?: string;
      pricingUrl?: string | null;
    }>("mission-control-gate", {
      action: "checkout",
      return_url:
        returnUrl ??
        (typeof window !== "undefined" ? window.location.origin : null),
    });
    if (error)
      return {
        ok: false,
        error: error.message ?? "unreachable",
        pricingUrl: null,
      };
    if (data?.ok && data.url) return { ok: true, url: data.url };
    return {
      ok: false,
      error: data?.error ?? "checkout_failed",
      pricingUrl: data?.pricingUrl ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "checkout_failed",
      pricingUrl: null,
    };
  }
}
