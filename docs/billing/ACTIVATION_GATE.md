# The activation gate

A clone provisioned onto a **paid plan** boots with a clock on it. It works
normally until the window closes — 72 hours by default — and is then locked
behind a payment screen until Stripe captures the activation payment for
Aurixa Systems, at which point it opens by itself.

**The prime and every clone that already exists are not gated, and cannot
become gated.** That is the property everything below is arranged to protect.

---

## The three-sentence version

1. Mission Control writes one `clone_payment_gates` row when it provisions a
   paid clone, and nothing else ever writes one.
2. The gate's status is **derived on every read** from four stored facts —
   the operator's override, whether Stripe paid, when the window closes, and
   the time — by one module, `clonePaymentGate.pure.ts`.
3. This workspace asks Mission Control for that status through
   `mission-control-gate` and renders it. It never decides one.

---

## Why the status is not stored

The obvious design is a `status` column that a worker flips to `locked` when
the deadline passes. It is rejected, and the reason is in this platform's own
history.

Mission Control's own `THE_CLONING_ENGINE.md` records six pg_cron jobs
that were **never scheduled at all** — silently, for months. A migration read
an empty vault, raised a NOTICE nobody reads, and returned; the job was never
created; and a job that does not exist has no failing run to report. Two of the
three clone-provisioning engines had never run and every check said the system
was healthy.

A gate whose *closing* depends on a worker fails **open** under exactly that
fault, and nothing anywhere reports it. So nothing closes a gate here. There is
no worker in this feature's critical path at all, and the table has no `status`
column to store one in — asserted by a test, because a column somebody adds
later is how the design quietly reverts.

## Why a locked answer is the only thing that locks

The clone fails **open** on everything: no Mission Control credentials, an
unreachable Mission Control, a timeout, a 500, a body that will not parse, a
`reason` word this build has never heard of, a payload whose convenience
`locked: true` disagrees with its decided `status: "open"`. All of them render
the dashboard.

That is not laxity — it is where the enforcement actually lives:

| Layer | What it does | Fails how |
| ----- | ------------ | --------- |
| Mission Control `tokens/reserve`, `seats/reserve` | Refuses a locked clone with **402 `workspace_locked`** | Open, on a DB read error only |
| This workspace's dashboard shell | Renders the payment screen instead of the app | Open, always |

The money boundary is the one that matters. A clone provisioned by Mission
Control runs on the **prime's forwarded vendor keys** (see
`docs/integrations/API_USAGE_METERING.md`), so an unpaid workspace generating
reports spends Aurixa's own OpenAI and property-data budget — and a browser
lock screen does not stop a scripted caller. Mission Control's 402 does, and it
cannot be talked past.

What the browser screen *can* do that the server cannot is lock a **paying**
customer out over a network blip. That is the failure worth designing against,
and it is why every error path here is open.

## Why nothing is backfilled

A row IS the gate. No row means no gate, forever, and:

- `armGate` is called from exactly two places — `provisionClone`, and an
  explicit operator button for a paid clone that was somehow missed. A test
  enumerates the callers.
- No migration inserts into the table or derives rows from `clones`. A test
  asserts that too, because a backfill added later would lock the whole fleet
  on deploy with nobody watching.
- `gateEligibility` refuses to arm on an **unresolved** plan price. Gating a
  workspace that may owe nothing is an outage for somebody who did nothing
  wrong; leaving one ungated is a row the Payment Gates console lists as a gap
  for an operator to arm by hand. The visible failure is the safer one.

## What the operator can do

Mission Control → **Billing → Payment Gates**, and a card on each clone's own
page. Both render the same server-derived state through the same pure module,
so they cannot disagree.

- **Set the platform default** window, and a master switch that stops *arming*
  new gates. It deliberately does not unlock existing ones — a flag that
  silently unlocked a fleet on being toggled would be a much larger act than
  the word "enabled" suggests, so the panel says which one it is.
- **Set a custom window per clone**, measured from when the clone was created
  rather than from now, so extending "72 hours" means what the customer was
  told. Restarting the clock from now is a separate, explicit switch.
- **Lock and unlock by hand.** One column, `manual_override`, holds
  `'locked' | 'unlocked' | null`, so the two cannot both be set and no
  resolution order has to be invented. An unlock outranks the clock *and*
  non-payment; a lock outranks payment, which is how a workspace is suspended
  after it has paid.
- **Record a payment that arrived outside Stripe** — a bank transfer, an
  invoice settled by hand. It writes the same `paid_at` stamp Stripe writes, so
  the unlock is the same act and not a second kind of open, and it is
  attributed to `operator` so the ledger never claims Stripe captured money it
  did not.

Every one of these demands a reason of at least five characters, enforced in
the dialog **and** on the server, and every one appends to
`clone_payment_gate_events` with the status either side of it.

## What Stripe does

`checkout.session.completed` settles the gate at **one** place in the webhook —
after `isPaidSession` and after the purchase is finalised, i.e. exactly where
the platform has already concluded the money landed. Two call sites (one per
fulfilment branch) is how one of them comes to settle on a payment status the
other rejects.

Two more routes exist because money can arrive without a session:
`customer.subscription.*` going active (a subscription created in Stripe's own
dashboard never sees a checkout session) and `invoice.paid` (a renewal invoice
Stripe mints on its own cycle). `settleGatePayment` is idempotent on
`paid_at IS NULL`, so all three settling the same gate credits it once.

**A credit top-up does not activate a workspace.** `GATE_OPENING_MODES` is
`seat_plan` and `setup_package`; a $50 pack must not open a $2,549/month plan,
and the CTA a customer is shown leads to their plan, not to credits.

**A refund records and warns but never re-locks.** `charge.refunded` fires for
a partial refund too, so auto-locking would take a live workspace down over a
goodwill credit. It writes a `payment_reversed` event and an operator
notification that says the workspace is still open; the manual lock is the
deliberate act it leaves to a person.

## The CTA

One primary button. `POST /api/public/clones/gate/checkout` resolves the plan,
the price and the tenant from the gate row Mission Control already wrote and
returns a Stripe Checkout URL, so the button charges exactly what the clone was
armed for and the browser is never told a price it could edit. It refuses on a
gate that is already paid — a CTA is the one place that is easy to click twice.

The screen never dead-ends. If minting fails, the fallback is the pricing page
carrying this workspace's billing uid, which is always present in the gate
response for that reason. Returning from Stripe with `?activation=success`
re-reads the verdict every three seconds for a minute, so a webhook that
lands a beat after the redirect opens the screen by itself rather than leaving
somebody looking at a wall they have just paid to remove.

Two sentences of that paragraph were an INTENTION rather than a description
until 18 Sep 2026, and the section below is what it took to make them true.

Copy is about the **account**, never the reader: the person looking at it may
have joined last week and have no idea a payment was owed. It never says a
payment failed — this build cannot know that — and a test asserts the wording.

## It could not lock at all, and failing open is why nobody noticed

From the day the routes shipped (8 Sep 2026) until 16 Sep, **every gate read
answered 429** and the clone rendered the dashboard on every one of them.

Mission Control gave the gate its own rate-limit bucket the only way the
limiter allowed — by composing the bucket into the key:

```ts
checkRateLimit(`gate:${key.id}`, 120)          // clones.gate
checkRateLimit(`gate:checkout:${key.id}`, 12)  // clones.gate.checkout
```

`check_api_rate_limit(_key_id uuid, …)` takes a **uuid**, and
`'gate:550e8400-…'::uuid` is `22P02 invalid input syntax for type uuid`. The
RPC errored on every call; `checkRateLimit` fails CLOSED on a DB error by
design; the route returned 429; and `fetchGateVerdict` treats any non-ok status
as unknown and renders the dashboard. Measured over 24h on 2026-09-16:

| Deployment | Real gate reads | Answered 429 |
| ---------- | --------------- | ------------ |
| NPC Property Dashboard | 666 | 666 (100%) |
| npc-client-dashboard | 519 | 519 (100%) |

Three things are worth keeping.

**The fail-open policy did exactly what it promises, and that is why this was
invisible.** No customer was ever locked out by the fault — but a gate that can
never lock is indistinguishable, from every surface, from a gate with nothing
to lock. The lesson is not to fail closed; it is that *the open path needs its
own signal.*

**There was no such signal, because the one that exists sits downstream of the
failure.** `recordGateCheck` stamps `last_checked_at` / `check_count` **after**
the rate-limit return, so a gate being polled 666 times a day and refused every
time reads in the operator console exactly like a gate nobody has ever opened.

**The same defect was in both storefront purchase routes**, found by the test
written for this one rather than by the investigation. `checkPublicRateLimit`
and `public_rate_limits` exist for them: `h` is a handoff id and `uid` an
arbitrary pricing-page string, so neither is a key and the keyed limiter's
foreign key could never have been satisfied by one. Between the four, the whole
payment path — the verdict, the pay-to-unlock CTA, and both purchase routes —
was returning 429 to everything.

The repair is `20260916170000_rate_limit_bucket_and_public.sql`; the guard is
`rateLimitBucket.test.ts`, which fails any call site that composes its key id.

## A way to pay in every state where paying helps (18 Sep 2026)

The screen was audited end to end because an operator locked a clone by hand
and asked where its Stripe button had gone. It was gone correctly — and four
other things were wrong, on both sides, each of which reported as a working
gate.

### The button is decided by what is OWED, not by a reason word

The rule was `verdict.reason !== "operator_locked"`, which answers *yes* to
every reason word a build has never heard of — including the `unknown` this
module returns for a body it could not read. A lost signal therefore drew a
full-width demand for money over a verdict whose entire meaning is that we do
not know why.

`payingCanUnlock` replaces it with an ALLOW-list — `grace_expired`,
`within_grace`, `no_deadline` — so a new reason shows no CTA until somebody
decides it should, and the customer is left with support rather than a charge.
It is the near side of Mission Control's own refusal, and they agree because
they are the same rule stated twice on purpose:

> An operator's standing lock outranks the money. `resolveGateState` reads
> `manual_override` BEFORE `paid_at`, deliberately — locking is how a workspace
> is suspended even though it once paid — and `settleGatePayment` never clears
> it. So a pay button on an `operator_locked` gate takes the money, stamps
> `paid_at`, and leaves the workspace exactly as shut.

`lockedCopy` answers to the same rule: where paying is not what lifts this, it
no longer says "complete the payment" over a page with no button on it.

### A gate on no clock at all had no way to pay, anywhere

`shouldWarn` required `counting`, so a gate an operator armed with no deadline
was `gated`, unpaid, open — and had no button, link or page in the product from
which to settle it, because the banner is the only payment CTA inside an
unlocked dashboard. It now asks the same question the screen asks.

### `verdict.pricingUrl` had zero call sites

Mission Control sends `checkout.pricing_url` on every gated read and this
module's own comment calls it *"always a real URL when gated, never null,
because a locked screen with no way out is worse than no screen"*. Nothing in
the product read it. The fallback appeared only where a refusal happened to
carry its own copy — three of the checkout route's refusal shapes — so on every
other one, and whenever Mission Control was unreachable at all, the screen was
the dead end its own comment forbade.

### Paying twice was one click away

The only guard against minting a second activation checkout is Mission
Control's `paid_at`, which the Stripe webhook writes — so for the whole
interval between the customer paying and that webhook landing, the server would
mint another one, on the screen they were returned to, where the button is the
only thing that looks like progress. `already_paid` is now read as what it is
(not a retryable failure), the primary button is withheld while a payment is
being confirmed, and the screen says so rather than going quiet.

### And Mission Control quoted the wrong price

`resolvePlanPricing` used `tier.monthlyInclGstCents` — the tier WITHOUT the
AML/CTF module — while `seatPlanForTier` refuses a catalogue row whose
`price_cents` disagrees with the quoted price. Scale is $2,549 base against a
$2,699 headline, so a newly armed gate would have answered `plan_not_purchasable`
on every click. The three live rows were armed with the headline figure and were
never affected; the fix is `tierHeadlineCents`, and a contract test now asserts
which of the two the gate may read.

Three more on that side, from the same audit: the checkout route did not refuse
an `operator_locked` gate (it would have taken the money Mission Control's own
state machine says changes nothing); the return URL was not confined to the
clone's own origin; and `settleGatePayment` notified operators "gate unlocked"
on a payment that settled a gate an operator had locked, which is the one case
where the workspace stays shut.

### An operator can send the link

The gap the audit was opened on turned out to be real, and on the other side:
the clone had a button and **Mission Control had no way to send a customer to
Stripe at all**. Billing → Payment Gates now offers **Payment link** on any gate
where paying is what lifts it, minted through `mintGateActivationCheckout` —
the same module the clone's own CTA calls, so the operator's link and the
customer's button cannot charge different amounts or refuse on different
grounds. It is the one gate act that demands no reason, because it changes
nothing: it mints a link and writes no state. The URL is rendered in a readonly
input carrying a `value` — never a `placeholder`, which is the uncopyable-empty-box
defect this fleet has already shipped twice.

## Files

**Mission Control**

| File | What it is |
| ---- | ---------- |
| `supabase/migrations/20260831000000_clone_payment_gates.sql` | The two tables, the platform defaults, and why there is no `status` column |
| `src/lib/clonePaymentGate.pure.ts` | The state machine. The only thing that decides open or locked |
| `src/server/payment-gate.server.ts` | Arm, override, window, settle, guard |
| `src/server/payment-gate.functions.ts` | Operator RPCs (`requireAdmin` to mutate, `requireOperator` to read) |
| `src/routes/api.public.clones.gate.ts` | What a clone asks about itself |
| `src/routes/api.public.clones.gate.checkout.ts` | The CTA's destination. A thin mapping onto the mint |
| `src/server/gateCheckout.server.ts` | The one mint. Both the clone's CTA and the operator's link |
| `src/components/clone-gate-actions.tsx` | The operator's acts, Payment link among them |
| `src/routes/billing.gates.tsx` | The console |

**This workspace**

| File | What it is |
| ---- | ---------- |
| `supabase/functions/_shared/paymentGate.pure.ts` | Reads Mission Control's answer safely. Fails open |
| `supabase/functions/_shared/paymentGate.ts` | The client. Sibling of `missionControl.ts`, opposite failure policy |
| `supabase/functions/mission-control-gate/index.ts` | The proxy. The clone API key never reaches a browser |
| `src/hooks/usePaymentGate.tsx` | The provider. Starts OPEN, polls, wakes on the deadline and on tab focus |
| `src/components/billing/PaymentGateOutlet.tsx` | Wraps the dashboard shell on both breakpoints |
| `src/components/billing/PaymentGateScreen.tsx` | The locked screen, and the countdown banner |
