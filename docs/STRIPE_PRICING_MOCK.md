# Testing purchases against the A$1 Stripe catalogue

Every money-moving CTA in this app — top up credits, upgrade plan, buy a module,
buy an onboarding package — can be pointed at a mirror of the price list where
each Stripe product costs **A$1.00** instead of its real price. That mirror is
`/pricing-mock` on the Aurixa Systems storefront; the fixtures behind it are
documented in `docs/pricing-mock.md` in the `aurixa-systems` repo.

Without it, one sweep over the tiers alone is more than A$40,000.

## Turning it on

Append `?pricingMock=1` to any page in the app.

```
https://<your-dashboard-host>/dashboard?pricingMock=1
```

The setting is remembered in `localStorage`, so it survives navigation and
reloads — you only need the parameter once. While it is on, a banner sits at the
bottom of every screen saying so, with an **Exit** button. `?pricingMock=0`
also turns it off.

A deployment made specifically for testing can set
`VITE_AURIXA_PRICING_MOCK=true` and skip the parameter. That form cannot be
dismissed from the banner, because a button in the corner should not appear to
override a deployment-level decision.

## What changes when it is on

| CTA intent | Where it goes |
| --- | --- |
| `topup` | `/pricing-mock` |
| `seat_plan` | `/pricing-mock` |
| `setup_package` | `/pricing-mock` |
| `pricing`, `catalog` | `/pricing-mock` |
| `save_card` | **unchanged** — the real card-save flow |

`save_card` is exempt on purpose. Saving a card is a Stripe *setup-mode*
session: no money moves at any price, so there is nothing for a A$1 mirror to
protect against, and the mock page has no card-save flow to land on. Routing it
there would break the one billing journey that was already safe to test against
production.

Every purchase CTA in the app routes through
`openMissionControlWithAttribution`, so the switch covers all of them —
`TokenBalancePill`, `TokenBalanceBanner`, `OutOfTokensBanner`,
`ReportGenerationStatus`, `TokenEventsListener`, `SeatEntitlementCard`,
`PricingCatalogCard`, `PurchaseHistoryCard`, `PaymentMethodsPanel` and the
Billing page.

## Two things that will bite you otherwise

**The charges are real.** The fixtures live in the *live* Stripe account, not a
sandbox. A$1.00 genuinely leaves a real card, Stripe test cards (`4242…`) are
declined, and the charges appear in live reporting. Refund from the Stripe
dashboard when you finish.

**Nothing is provisioned.** The mock page sells through Stripe *Payment Links*,
and a Payment Link session reaches Mission Control's webhook without the `mode`
and `item_id` metadata fulfilment reads — so the event is recorded and stops. No
plan is assigned, no credits are issued, no module is enabled. This is the same
behaviour the live add-on payment links have always had.

So `/pricing-mock` tests **checkout**, not **fulfilment**. To exercise
fulfilment end to end, go through the normal handoff flow (`startCheckout` on the
storefront, which stamps the metadata the webhook needs) against a catalogue row
pointed at a mock price id. The mock page offers every price id as a one-click
copy for exactly that.

## Why the rewrite is where it is

The obvious wiring — repoint `AURIXA_PRICING_URL` — does not work.
`openMissionControlWithAttribution` *prefers* a handoff URL minted by Mission
Control and only falls back to that constant when the mint fails. Flipping the
constant would therefore leave every CTA on the live price list whenever the
mint succeeded, which is almost always, and the one time it took effect would be
the time something was already broken.

The rewrite is applied to the URL that was actually resolved, at the single point
where it is chosen. See `src/lib/pricingMock.ts`.

The rewrite also fails *toward* the mock: when the mode is on and a resolved URL
is not recognisably the storefront (wrong host, `http:`, embedded credentials, a
non-default port), it returns the canonical mock URL rather than passing the
original through. In test mode the guarantee worth having is "this will never
open a live-priced checkout", and passing an unrecognised URL through would break
it in the expensive direction. Host matching is exact, never by suffix — the same
rule `feedbackUrlPolicy.ts` applies, for the same reason.

## Files

| Path | What it is |
| --- | --- |
| `src/lib/pricingMock.ts` | Mode state and the URL rewrite |
| `src/lib/__tests__/pricingMock.test.ts` | Rewrite, intent and toggle coverage |
| `src/components/billing/PricingMockBanner.tsx` | The indicator and the switch |
| `src/components/billing/__tests__/PricingMockBanner.test.tsx` | Banner behaviour |
| `src/lib/missionControl.ts` | Applies the rewrite to the resolved CTA URL |
