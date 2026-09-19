# Mission Control Integration

Aurixa **Mission Control** owns billing for this clone. It provisions a long-lived
clone API key, meters every report/job we generate, and lets us rotate the key
from this dashboard at any time.

## Where the key lives

- Stored as the **`MISSION_CONTROL_CLONE_API_KEY` Supabase secret** (project-level,
  encrypted at rest). The key is never written to the database, never returned to
  the browser, and never logged.
- Only `supabase/functions/_shared/missionControl.ts` reads it via
  `Deno.env.get("MISSION_CONTROL_CLONE_API_KEY")`. Every other code path goes
  through that shared module.
- Companion secrets:
  - `MISSION_CONTROL_URL` — base URL of the Mission Control public API.
  - `MISSION_CONTROL_WEBHOOK_SECRET` — HMAC-SHA256 secret for inbound webhooks.
  - `SUPABASE_ACCESS_TOKEN` — required for the rotation flow (writes the new
    secret via the Supabase Management API).

## Metering flow

```
reserveTokens(estimate) → run generator ─┬─ finished OK ──→ commitTokens(actual)
                                         ├─ chunk done ───→ hold (reservation stays open)
                                         └─ failed ───────→ releaseTokens()  (cancel, or refund
                                                                              if already committed)
```

- Wrapper: `withReportMetering()` in `_shared/reportMetering.ts` (the older
  `withTokenReservation()` in `_shared/missionControl.ts` is the same
  reserve/commit/cancel shape for non-HTTP callers).
- The commit/hold/release decision is pure and unit-tested:
  `_shared/reportMeteringOutcome.pure.ts` (spec:
  `src/lib/tokens/__tests__/reportMeteringOutcome.pure.spec.ts`).
- Every reservation includes a stable client-generated `idempotency_key` so
  retries don't double-spend.
- Errors are typed: `InsufficientTokensError` (402), `RateLimitedError` (429),
  generic `MissionControlError`.

### Billing invariant: a failed report costs nothing

Report generation is **chunked** — the browser calls
`generate-investment-report` / `regenerate-report-qualitative` once per section
(`singleSection: true`), and each intermediate call answers HTTP 200 with
`isComplete: false`. Three rules keep a run that never finishes free:

1. **Hold, don't commit.** Intermediate chunk responses leave the Mission
   Control job `reserved`. Committing on them closed the job after section 1,
   after which a failure in any later section could no longer be canceled —
   `cancel_token_reservation` is a no-op on a `completed` job — so the report
   ended up `failed` with the tokens spent.
2. **Release on any failure.** Non-2xx, a `success: false` body (even with a
   2xx status), or a thrown handler all call `releaseTokens()`, which cancels a
   live reservation *or* refunds one an earlier call already committed
   (`refund_if_committed` on `POST /api/public/tokens/cancel` → Mission
   Control's `release_token_job` RPC).
3. **Reservations outlive the run.** `MC_RESERVATION_TTL_SECONDS` (default
   7200s, clamped to MC's 30…86 400s) is passed on reserve so a held
   reservation can't expire mid-generation. Only the call that *creates* the
   job sets the TTL — later chunks reserve idempotently against the same key.

Failures that happen **between** edge calls (a section exhausted its retries,
the tab closed, the operator hit *Stop generation*) never reach the wrapper.
`manage-investment-reports` therefore calls
`releaseInvestmentReportRunTokens()` whenever a report is updated to
`status: 'failed'`. That helper is scoped to the report's **current version** —
`investment_reports.current_version` only advances when a report *completes*,
so a previously finished and legitimately paid version can never be refunded by
a later failure. Qualitative-regen (`regen-qual:…`) keys carry no version and
are deliberately out of scope for the out-of-band path; their held reservations
simply expire, having never been debited.

Setting: **`MC_RESERVATION_TTL_SECONDS`** (optional Supabase secret, default
`7200`).

## Stripe checkout prefill

Stripe Checkout takes the email it shows from the **Customer attached to the
session** — `customer_email` is rejected alongside `customer` — and in
payment/subscription mode it also prefills the saved card's name and address.
So a smooth checkout is not a session parameter; it is a properly populated
Stripe Customer. Mission Control's Customer used to be created with a name and
nothing else, which is why every buyer retyped their email on every visit.

What now flows, and from where — two sources, the **person** and the
**workspace**:

| Field | Source | Lands as |
|---|---|---|
| Email | `custom_users.email` of the signed-in user | Stripe Customer `email` (seeded if blank) + this purchase's `receipt_email` |
| First / last name | `custom_users.first_name` / `last_name` (Settings → Profile & Credentials) | Customer metadata `buyer_*`, session + invoice metadata |
| Phone | `custom_users.phone` | Stripe Customer `phone` (seeded if blank) |
| **Company name** | `global_report_settings.contact_details.company_name` (Templates → Global Report Settings) | Stripe Customer `name` — the billing name on every tax invoice |
| **ABN** | `global_report_settings.contact_details.abn` | pre-attached to the Stripe Customer as an `au_abn` tax ID |
| Billing address | typed once on Stripe's page | written back to the Customer via `customer_update`, so the **next** checkout prefills it |
| Cardholder name/email | Stripe's card-save page | `payment_methods.billing_name` / `billing_email`, shown on the card row |

The details travel `mission-control-handoff` → the handoff's `contact` block →
Mission Control → Stripe, entirely server-to-server. The browser still only
ever carries the opaque `?h=<uuid>`, so nothing here can be read or forged from
the URL.

**Ownership rule.** A tenant is an organisation and its Stripe Customer is the
organisation's billing account, shared by every staff member. So
`Customer.name` stays the ORG name (invoices must not read whoever clicked
Buy), and `Customer.email` is *seeded* from the first buyer and then left
alone — silently repointing an org's billing email because a colleague made a
purchase would misdirect their invoices. The individual buyer is still
captured: on Customer metadata, and per purchase as `receipt_email`, so nobody
loses their own receipt to the shared address.

Users fill their name and phone in under **Settings → Profile & Credentials →
Contact Details**. All three fields are optional; leaving them blank simply
gives the previous email-only behaviour. Company name and ABN are not per-user
— they are the workspace's, already configured once under **Templates → Global
Report Settings → Contact Details**.

### ABN capture

Purchase sessions enable Stripe's `tax_id_collection`, so buyers in a supported
country get a business tax ID + legal entity name form and the collected ID
lands on the Stripe Customer (and therefore on the invoice). It is **optional**,
not `required: 'if_supported'` — a buyer without an ABN must still be able to
pay.

In practice most buyers never see the form: the workspace's ABN is forwarded on
the handoff and pre-attached to the Customer, and Stripe hides the tax-ID form
once a Customer has any tax ID. That cuts both ways, which is why Mission
Control validates the **ATO checksum** before attaching — an invalid ABN would
be both permanent and unfixable by the buyer, so a value that fails is dropped
and Checkout asks instead.

`Customer.name` is *not* written back from the checkout form
(`customer_update.name` stays at its `never` default). Outside the tax-ID form
Checkout would save the **cardholder's personal name** onto an organisation's
billing account; the workspace name is the right value and Mission Control owns
that field. It re-syncs on a workspace rename but leaves a name an operator
edited by hand in Stripe alone, tracked via the Customer's `workspace_name`
metadata key. The legal entity name a buyer declares on the tax-ID form is
recorded separately on `tenants.tax_id_business_name`.

Whatever Stripe collects is mirrored back by the checkout webhook onto
`tenants.tax_id_type` / `tax_id_value` / `tax_id_business_name` /
`tax_id_captured_at`, so operators can see the ABN without opening the Stripe
dashboard. Stripe stays authoritative.

Tax ID collection is deliberately **not** enabled on the card-save (setup-mode)
flow — an ABN belongs to an invoice, not to vaulting a card.

## Top-up purchases → token balance

A top-up pack bought through Stripe credits the workspace's token balance like
this:

```
Stripe checkout.session.completed (payment_status: paid)
  → apply_topup(tenant, pack)            adds a `topup` row to token_ledger
  → AFTER INSERT trigger                 recompute_token_balance(tenant)
  → tokens.balance.updated webhook       mission-control-webhook → token_balance_cache
  → dashboard pill                       refreshes on focus, and polls every 3 min
```

Three things make it land on the balance the workspace actually spends from:

1. **The right tenant.** A clone meters under `prime:<supabase-project-ref>` —
   that `tenant_ref` is baked into `_shared/missionControl.ts`. Mission Control
   resolves a clone-scoped purchase to a tenant the clone *already has* rather
   than provisioning a parallel `clone:<slug>` one, which used to split the
   workspace across two balances: money taken, dashboard unchanged.
2. **Only paid sessions.** `checkout.session.completed` fires for delayed
   payment methods while still `unpaid`; those credit on
   `checkout.session.async_payment_succeeded` instead. `apply_topup` is
   idempotent on `stripe:<session_id>`, so a replay or both events firing
   credits exactly once.
3. **The clone is told.** Fulfilment fires `tokens.balance.updated`, so the
   pill reflects the purchase instead of waiting for the next poll.

The storefront's success page polls `fulfilled` — which for a top-up means the
`token_ledger` row keyed on `stripe:<session_id>` exists — before offering the
"back to your dashboard" link, so by the time a buyer returns the credits are
real.

Units: pack `tokens`, plan `monthly_allowance` and the balance are all **billing
credits**, the same unit `_shared/tokenEstimator.ts` reserves in. A 500-credit
pack raises `available` by exactly 500.

## Per-report token cost index

What a report costs is Mission Control's `report_credit_costs` table — one row
per metering `kind` this repo can send, seeded with every report type:

| Kind | Credits |
|---|---|
| `report.investment.compass` | 12 |
| `report.investment.executive` | 8 |
| `report.investment.financial` | 5 |
| `report.investment.snapshot` | 4 |
| `report.suburb.compass` / `report.postcode.compass` | 10 |
| `report.market-intelligence` | 6 |
| `report.portfolio-review` | 8 |
| `report.bulk-item` | 8 |
| `report.chart-analysis` | 2 |
| `report.qualitative-regen` | 3 |
| `aml_identity_check` / `aml_screening_check` | 4 |

`withReportMetering` resolves the reserve amount in this order:

1. **the index, keyed by the metering `kind`** we already resolve server-side.
   Keying on kind rather than a caller-supplied slug is what makes it apply to
   every report automatically — and means the price cannot be steered from the
   request body.
2. an explicit `__catalog.report_slug`, still resolved *against the index*. A
   `credit_cost` sent in the request is ignored: the browser must not be able
   to name its own price.
3. `_shared/tokenEstimator.ts`, when Mission Control is unreachable or a kind
   is unlisted. Its numbers are the values the index is seeded with — keep the
   two in step when adding a kind. Pricing must never block a report.

A cost of exactly `0` is honoured as a deliberately free report, distinct from
"unpriced" (which falls through to the heuristic).

`report.investment.financial` is worth calling out: `generate-investment-report`
has always emitted that kind, but it appeared in no union and no cost table, so
it silently used the generic `?? 5` fallback. It is now explicit at 5 — same
price, now visible and adjustable.

### Changing a price

Super admins and the High King edit the index in Mission Control under
**Billing → Catalog → Report token cost index** and hit **Publish & cascade**.
Publishing records who changed what, then notifies every clone and this
repository.

Propagation is **pull-based with a prompt nudge**, not atomic: the cascade
drops the catalog cache on the edge instance that receives the webhook, and
every other warm instance picks the new price up on its own 5-minute catalog
refresh. So the guaranteed bound is ≤5 minutes everywhere, usually immediate.
Reports already generated are unaffected — a new price applies to the next
reservation.

## Token expiry and rollover

Credits live **30 days from the moment they are issued**. Plan allowances,
top-up packs and operator gifts all obey it; only a gift can override, via the
expiry date `grant_tokens` already accepts — a blank date now means 30 days,
not "never".

Rollover falls out of that: nothing is wiped at a period boundary, so unused
credits carry across it and lapse on their own clock. `billing_plans.rollover_cap`
stays unused.

| Source | Expiry | Overridable |
|---|---|---|
| Plan allowance (`issue_plan_allowance`) | 30 days from issue | no |
| Top-up pack (`apply_topup`) | 30 days, or the pack's own shorter window | no |
| Operator gift (`grant_tokens`) | 30 days by default | **yes** — the expiry date field |

### Credits are lots

Expiry forced the balance function to change. The old one netted the ledger and
skipped credit rows whose `expires_at` had passed — which silently under-counts,
because the debits taken against an expired credit stay in the sum while the
credit that funded them disappears:

```
grant  +100 (lapsed)   skipped
topup   +50 (live)     +50
debit   -30            -30    ⇒ 20
```

The honest answer is 50: the 30 was already paid for out of the grant, and only
the grant's unspent 70 should have lapsed.

So each credit is a **lot**. Spend consumes lots soonest-expiry-first — the
use-it-or-lose-it order, which also leaves the customer the most usable balance
— and expiry forfeits only a lot's *unconsumed* remainder. The rules are pinned
by tests in `src/server/token-lots.server.test.ts` (Mission Control); the
authoritative implementation is `recompute_token_balance` in SQL.

### What this repo sees

`getBalance()` gains `expiringSoon`, `nextExpiryAt`, `expiryPolicyDays` and
`expiryWarningDays` from the balance endpoint, and the header pill warns when
credit is about to lapse. Against an older Mission Control the fields are
absent and the pill simply shows no warning.

**Plan allowances are now real credits.** Until this change `monthly_allowance`
was only a number on a page — nothing ever credited it, so a paid tier granted
no spendable tokens at all. An hourly job issues it once per tenant per period.
It deliberately does **not** back-fill: only periods starting after the feature
shipped are credited, so deploying it hands nobody a windfall for a month they
have already been using.

**Credits already on the ledger keep their terms.** Existing rows have no
expiry and are left that way — nobody loses a balance they were told they had.
The rule applies from deploy forward.

## Manual rotation

UI lives under **Settings → Mission Control Key** (superadmin only).

1. Admin clicks **Rotate key**, picks grace period (0–168 h, default 1 h) and an
   optional reason.
2. `mission-control-rotate-key` edge function POSTs to
   `${MISSION_CONTROL_URL}/api/public/clones/rotate-key` with the current key.
3. Mission Control returns `{ key, key_prefix, revoke_at }` once.
4. The function writes the new key into the `MISSION_CONTROL_CLONE_API_KEY`
   secret via `POST https://api.supabase.com/v1/projects/{ref}/secrets` and
   records an audit row (`event = "key.rotated.manual"`) — without ever logging
   the raw secret.
5. The previous key continues to work for the full grace period; warm edge
   workers pick up the new value on next cold start. After `revoke_at`,
   Mission Control disables the old key automatically.

The dialog deliberately does **not** echo the new secret to the UI — it is
already persisted to the secret store, and the prefix is enough for operators.

## Webhook events

All events arrive at the public `mission-control-webhook` edge function. Each
request must include the `x-mc-signature` header (HMAC-SHA256 of the raw body
using `MISSION_CONTROL_WEBHOOK_SECRET`); mismatched signatures get a `401`. The
function de-dupes on `x-mc-idempotency-key` via `token_webhook_events`.

| Event | What we do |
|------|-----------|
| `tokens.test` | No-op success (used by the MC "Send test webhook" button). |
| `tokens.balance.updated` | Upsert into `token_balance_cache` so the header pill is fresh between polls. |
| `tokens.key.rotated` | If the payload contains a new key (`new_key` / `key` / `secret`), update the `MISSION_CONTROL_CLONE_API_KEY` secret automatically and write an audit row. This is what allows MC-initiated rotations to take effect with zero manual cleanup. |
| `tokens.key.revoked` | Audit row with `status = "error"` so it surfaces on `/admin/token-audit`. |
| `tokens.alert` | Audit row (`event = "webhook:tokens.alert"`) for ops review. |

## Edge functions

| Function | Purpose |
|----------|---------|
| `mission-control-balance` | Auth'd proxy for `getBalance()` — used by the header pill and `useTokenBalance`. |
| `mission-control-packs` | Auth'd proxy for top-up packs + paginated listing. |
| `mission-control-key-info` | Superadmin-only. Returns key prefix, base URL, last successful call, last rotation. Never returns the raw secret. |
| `mission-control-rotate-key` | Superadmin-only. Performs the rotation flow above. |
| `mission-control-webhook` | Public (HMAC-verified). Handles all `tokens.*` events. |

## Operational notes

- Rotations within the grace period are **safe to repeat** — MC honours the
  previous key until its scheduled revoke time even if a newer rotation has
  already run.
- If `mission-control-balance` starts returning `401` after a rotation, force a
  cold start (deploy a no-op change to the function) so workers re-read the
  secret immediately instead of waiting for natural recycling.
- The header `TokenBalancePill` polls every 3 minutes and refreshes on focus +
  on `onTokensUsed` / `onOutOfTokens` events.
