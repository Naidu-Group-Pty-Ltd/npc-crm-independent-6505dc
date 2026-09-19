/**
 * Routing every purchase CTA at the A$1 Stripe test catalogue.
 *
 * The storefront hosts a mirror of the price list — `/pricing-mock` on the
 * Aurixa Systems site — where every tier, module, credit pack and onboarding
 * package is a Stripe product costing one dollar instead of its real price. It
 * exists so the purchase workflow can be driven end to end from this repo
 * without a sweep over the tiers costing tens of thousands of dollars.
 *
 * ── Why the rewrite happens here and not at the constants ────────────────────
 *
 * The obvious wiring — point `AURIXA_PRICING_URL` at the mock page — does not
 * work, and failing quietly is exactly what makes it worth writing down.
 * `openMissionControlWithAttribution` prefers a handoff URL minted by Mission
 * Control and only falls back to that constant when the mint fails. So flipping
 * the constant would leave every CTA on the live price list whenever the mint
 * succeeded, which is to say almost always, and the one time it took effect
 * would be the time something was already broken.
 *
 * The rewrite is therefore applied to the URL that was actually resolved, at
 * the single point where it is chosen. Every purchase CTA in the app routes
 * through that function, so this covers all of them at once rather than asking
 * ten components to remember.
 *
 * ── Why `save_card` is exempt ────────────────────────────────────────────────
 *
 * Saving a card is a Stripe setup-mode session: no money moves, at any price.
 * There is nothing for a $1 mirror to protect against, and the mock page has no
 * card-save flow to land on — routing it there would break the one billing
 * journey that was already safe to test against production. So it is excluded
 * by intent rather than by URL, since the save-card link is otherwise just the
 * pricing URL with a query parameter on it.
 *
 * ── The direction this fails in ──────────────────────────────────────────────
 *
 * When the mode is on and a URL cannot be parsed or is not recognisably the
 * storefront, the rewrite returns the canonical mock URL rather than passing
 * the original through. That is deliberate: in test mode the guarantee worth
 * having is "this will never open a live-priced checkout", and passing an
 * unrecognised URL through would break it in the expensive direction.
 */

import { isClientFacingDeployment } from "@/lib/clientFacing";

/** The storefront that hosts the mock page. */
export const AURIXA_STOREFRONT_ORIGIN = "https://www.aurixasystems.com.au";

export const AURIXA_PRICING_MOCK_PATH = "/pricing-mock";

export const AURIXA_PRICING_MOCK_URL = `${AURIXA_STOREFRONT_ORIGIN}${AURIXA_PRICING_MOCK_PATH}`;

/**
 * Hostnames the rewrite will keep. Matched exactly, never by suffix — the same
 * rule `feedbackUrlPolicy.ts` applies, and for the same reason: a suffix test
 * accepts `aurixasystems.com.au.evil.example`.
 */
const STOREFRONT_HOSTNAMES = new Set(["www.aurixasystems.com.au", "aurixasystems.com.au"]);

/** Where the toggle is remembered between page loads. */
export const PRICING_MOCK_STORAGE_KEY = "aurixa:pricing-mock";

/** The query parameter that turns the mode on (`1`) or off (`0`). */
export const PRICING_MOCK_QUERY_KEY = "pricingMock";

/**
 * Intents whose checkout moves money, and which therefore belong on the mock
 * catalogue while testing. `save_card` is deliberately absent — see the header.
 */
const MOCKABLE_INTENTS = new Set(["topup", "seat_plan", "setup_package", "pricing", "catalog"]);

export function intentUsesMockPricing(intent: string): boolean {
  return MOCKABLE_INTENTS.has(intent);
}

/**
 * Points a resolved storefront URL at the mock catalogue.
 *
 * The query string is carried over untouched. A handoff (`?h=`) or uid means
 * nothing to the mock page, which is a static list of payment links, but
 * keeping it costs nothing and leaves the link traceable to the session that
 * opened it.
 */
export function rewriteToMockPricing(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return AURIXA_PRICING_MOCK_URL;
  }
  // Hostname alone is not enough. `https://user:pass@www.aurixasystems.com.au/`
  // and `https://www.aurixasystems.com.au:8443/` both pass a hostname check and
  // are both something other than the storefront — the same two cases
  // `feedbackUrlPolicy.ts` rejects by name. Carrying either through would put
  // credentials, or a link to some other listener, in front of the tester.
  if (
    parsed.protocol !== "https:" ||
    !STOREFRONT_HOSTNAMES.has(parsed.hostname) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== ""
  ) {
    return AURIXA_PRICING_MOCK_URL;
  }
  parsed.pathname = AURIXA_PRICING_MOCK_PATH;
  return parsed.toString();
}

/**
 * Whether the build ships with the mode on.
 *
 * A deployment made specifically for a test sweep can set
 * `VITE_AURIXA_PRICING_MOCK=true` and skip the toggle entirely.
 */
export function pricingMockEnabledByBuild(): boolean {
  return (
    ((import.meta.env?.VITE_AURIXA_PRICING_MOCK as string | undefined) ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}

/**
 * Reads the toggle out of a query string.
 *
 * Returns `null` when the parameter is absent, so "not mentioned" stays
 * distinct from "explicitly turned off" — the caller must be able to leave a
 * stored setting alone rather than clearing it on every navigation.
 */
export function readPricingMockOverride(search: string): boolean | null {
  let value: string | null;
  try {
    value = new URLSearchParams(search).get(PRICING_MOCK_QUERY_KEY);
  } catch {
    return null;
  }
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "") return true;
  if (v === "0" || v === "false" || v === "off") return false;
  return null;
}

/** Persists the toggle. Storage being unavailable is not worth an error. */
export function setPricingMockEnabled(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(PRICING_MOCK_STORAGE_KEY, "1");
    else window.localStorage.removeItem(PRICING_MOCK_STORAGE_KEY);
  } catch {
    /* private browsing, storage disabled — the build flag still works */
  }
}

/**
 * Whether purchase CTAs should currently route to the mock catalogue.
 *
 * Read at call time rather than captured at module load, so flipping the
 * toggle takes effect on the next click instead of the next reload.
 */
export function isPricingMockEnabled(): boolean {
  // A client-facing deployment never routes a purchase at test prices: the
  // sweep protection above is for internal builds, and out there the failure
  // worth preventing inverts — a shared `?pricingMock=1` link would let a
  // client buy any tier for a dollar. The build flag and the stored toggle
  // are both overridden, not just the banner.
  if (isClientFacingDeployment()) return false;
  if (pricingMockEnabledByBuild()) return true;
  try {
    return window.localStorage.getItem(PRICING_MOCK_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The final step of CTA resolution: the mock URL when the mode is on and the
 * intent moves money, otherwise the URL exactly as resolved.
 */
export function applyPricingMockRouting(url: string, intent: string): string {
  if (!isPricingMockEnabled() || !intentUsesMockPricing(intent)) return url;
  return rewriteToMockPricing(url);
}
