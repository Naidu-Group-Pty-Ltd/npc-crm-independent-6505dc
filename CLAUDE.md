# CLAUDE.md

Guidance for Claude Code (and Claude-based tools) working in this repo.

## Read first
- **Frontend / UI work → [`FRONTEND_TOOLING.md`](./FRONTEND_TOOLING.md)** is the
  cross-tool source of truth. It defines the installed frontend packages and the
  non-negotiable UI rules. Use it for anything touching `src/` UI.
- **Backend / security / AML →** [`AGENTS.md`](./AGENTS.md) and
  [`AGENTS_NPC_Property_Dashboard.md`](./AGENTS_NPC_Property_Dashboard.md).

## Installed tooling (already wired for Claude Code)
- **Claude Design** — the **NPC Services Design System** project at
  [claude.ai/design](https://claude.ai/design), reached with the built-in
  **DesignSync** tool. It is the source of the brand: read `tokens/colors.css` and
  `tokens/typography.css` from it before choosing any colour or typeface, and push
  cards back one at a time (never wholesale-replace). Details in
  [`FRONTEND_TOOLING.md`](./FRONTEND_TOOLING.md).
- **MCP servers** — [`.mcp.json`](./.mcp.json): `shadcn`, `chrome-devtools`,
  `@21st-dev/magic`, `21st` (hosted HTTP). Setup and the `MAGIC_API_KEY` /
  `TWENTY_FIRST_API_KEY` steps are in [`MCP_SETUP.md`](./MCP_SETUP.md).
- **Skills** — [`.claude/skills/`](./.claude/skills/): **`npc-services-design`** (the
  brand itself — colours, type, logo marks, voice, and the print rules for generated
  reports), `frontend-design` (aesthetic direction) and `web-design-guidelines`
  (accessibility / UX review).

## Listings intake (Airtable + Make)
Everything on the Listings page arrives through one Make scenario, **NPC Email 1**, which
reads a mailbox and writes Airtable's **Property Intake Master** (205 columns, base
`NPC Emails`). Read [`docs/integrations/NPC_EMAIL_1_AUDIT.md`](./docs/integrations/NPC_EMAIL_1_AUDIT.md)
before touching intake, the projection in `_shared/airtableListing.pure.ts`, or anything to
do with listing photographs — it records 22 defects found in that scenario, including the
two that meant the page had never received a single photo, and it names the columns the
dashboard now depends on. Retention is its own concern and the one that emptied the page. Read
[`AIRTABLE_RETENTION.md`](./docs/integrations/AIRTABLE_RETENTION.md) before
touching `planRetention`, `planReconciliation` or the reconciliation step in
`listings-cache`. Airtable prunes `Property Intake Master` at 30 days and that
is correct — **`listings_cache` used to MIRROR the prune**, which put the whole
marketplace on a thirty-day fuse: 148 listings on 2026-08-19 were 51 by
2026-08-26 and would have been 0 on 2026-09-04, unrecoverably, because nothing
else in the database can rebuild a listing. The cache is now an **archive**: a
row that aged out is kept and stamped `archived_at`, a row that vanished while
still inside the window is really deleted, and an undated one is kept. Two rules
bite. **`planReconciliation`'s two allowances are ANDed**, so on a small table a
walk that returned 26 of 148 records would be acted on in full — the destructive
half has its own 10% cap, and past it the batch is archived rather than
part-deleted, because archiving is reversible and deleting is not. And **the
purge is asserted by its effect, never by its configuration**: the live base is
not reachable by the Airtable token this repo's tooling holds, so every sync
records `oldest_live_created_time` / `retention_effective` instead.

The scenario that is actually **switched on** is `NPC Email 1 New` (Make id `9618493`); the
audited `NPC Email 1` (`6720116`) is off. Listings reach it *forwarded* by NPC staff rather
than sent by agents, and that broke who a listing belongs to — every record it wrote named a
colleague as the agent. Read [`FORWARDED_SENDER.md`](./docs/integrations/FORWARDED_SENDER.md)
before touching `Sender Email`/`Sender Name`, the contact fallback in
`_shared/listingContact.pure.ts`, or anything that decides who to email about a listing. It
also records the one rule that keeps biting: an address on our side of the pipeline is never
the answer, in any column.

Photographs are a separate concern from intake, and the one place a listing can
contradict itself on screen. Read
[`IMAGE_LIBRARY.md`](./docs/listings/IMAGE_LIBRARY.md) before touching
`_shared/listingImage*.pure.ts`, `signStoredImages`, `harvestListing` or
`useListingGallery`. **`imageIdentity` answers "same URL"; a gallery needs "same
picture"**, and the two diverge constantly — 240 of 4,807 stored rows were a
second copy of a photograph the same listing already held, one listing carrying
35 rows of four pictures. De-duplication is three layers (checksum → asset key →
perceptual signature), absent evidence never merges, and the guarantee is
enforced on the **read** path as well as the write path, because the table will
always accumulate copies and a repair migration has to be dispatched by hand.

**The server looks at the photographs now, and that is the point.** Visual
classification used to run only in a browser, only after the card had drawn — so
the most consequential decision here, *which image leads a listing*, was taken
with no visual information at all: 6 of 16 sampled heroes were floor plans, 5 of
those served from opaque Google Drive ids no URL rule can read.
`listingImageVision.pure.ts` is the one implementation of that judgement, its
thresholds are measured (21 labelled production images, 21 correct), and the
verdict is stored so every surface gets it before the first paint. Decoding is
**budgeted, not counted** — ~116 ms of CPU each against an Edge Function's
allowance — and the decoder import is lazy so `resolve` pays nothing.

The other half is a question no single image can answer: **is this photograph
even of this property?** 3,035 of 4,841 rows are a picture some other listing
also holds and 279 of 471 listings LED with one. `listing_image_reuse` answers
it and `bandOf` demotes it.

Three rules bite. An asset key is **only ever compared within one listing**,
which is what makes its filename rule safe. Ordering **demotes and never
promotes** — a filename-hint version of "pick the best photo" promoted an agency
logo over the photograph on two real listings, because a logo lockup is called a
*main* lockup. And **demotion is a sort, never a filter**: a listing whose whole
gallery is shared, or is entirely furniture, keeps every image in its own order,
which is why nothing here can blank a card.

One property can also arrive as several records. Read
[`DUPLICATE_RECORDS.md`](./docs/listings/DUPLICATE_RECORDS.md) before touching
`_shared/listingDuplicates.pure.ts` or `propertyDataService.buildResult`: the
marketplace was showing **148 listings for 107 properties** because the intake
scenario re-processes a message it has already written — `14 Yillowra St` exists
four times, three minutes apart, from one forwarded newsletter. `airtable-proxy`
has always TAGGED duplicates and deliberately removed none, leaving the decision
to the client, and no client ever made it. The rule that makes it is **address +
price + type + beds + land**, and the constraint is that **an address with no
street number is never a key** — eleven different City Beach properties share
one, because their street numbers never got extracted, and merging on address
alone deletes nine real listings.

Column names for that table live in `_shared/airtableIntakeFields.pure.ts` and nowhere else.
Airtable returns `undefined` for a column that does not exist exactly as it does for one
that is empty, so a mistyped name is invisible — that file's header records what that cost
last time.

**Where a pin goes is a different question again, and it took four rounds.**
Read [`MAP_PIN_PLACEMENT.md`](./docs/listings/MAP_PIN_PLACEMENT.md) before
touching `resolve-listing-coordinates`, any `_shared/au*.pure.ts`,
`src/lib/listingsMap.ts` or `ListingsMapView`. The map has **never had an API
key and must never need one** — a clone has nowhere to inherit a tile account
from, and a `VITE_` token is inlined into every clone's bundle. Three rules
bite. **`components=country:AU` does not restrict the SEARCH, it restricts the
ANSWER**: an address it cannot match returns the centre of the continent with
HTTP 200, which is inside Australia, on land, and contradicts no state — so
`London` and `Pittsburgh` drew a tidy cluster in the desert, and that fault was
introduced by the previous fix in this same area, which correctly stopped
trusting their overseas coordinates and sent them to the geocoder instead.
`geocodeGranularity.pure.ts` reads the provider's own `types`, refuses anything
no finer than a state, and keeps `locality` acceptable because a suburb
centroid is imprecise rather than wrong — refusing it would empty the map of
every builder-stock item. **Only co-location may put more than one property
behind one mark**: a proximity bubble is drawn at one member's coordinate while
standing for properties hundreds of kilometres apart, so its position carries
no information and it was read as a misplaced pin every time it was seen — two
rounds were spent moving it to a better member, which worked and did not help.
`groupByCoordinate` groups by exact coordinate, so a mark that says "26" is
TRUE at every zoom and nothing is ever drawn where no property stands. And
**removing clustering removed the spiderfy**, which was the only way to reach
one of the twenty-six listings sharing `104 Grubb Avenue, Traralgon`;
`ListingStackPager` is what keeps the count badge's promise, and it is never
drawn for a stack of one.

**No server-side geocode asks Google any more, and the default order names
no Google.** Read
[`GEOCODING_WITHOUT_GOOGLE.md`](./docs/integrations/GEOCODING_WITHOUT_GOOGLE.md)
before touching `_shared/geocode/*`, `google-places-autocomplete` or the
geocode step in `resolve-listing-coordinates`, `location-intelligence-service`,
`parse-property-pdf` or `estimate-capital-growth`. Google's key refused every
geocode from 12 Sep 2026 and four surfaces went dark at once, so every geocode
goes through ONE chain — `geocode_cache`, then OpenStreetMap's Nominatim, then
the suburb's own centroid from the ABS boundary server, then Google only where
an operator lists it in `GEOCODER_PROVIDERS` — and the address field suggests
from OpenStreetMap's Photon behind the same function and the same projection
the forms already read. Three rules bite. **Every provider is judged by the
same gates**: results carry Google-shaped `types` so `assessGeocodeGranularity`
refuses the centre of the continent and "matched the state" whoever answered.
**The free providers are never metered and their allowance fails closed**:
Nominatim, Photon and the ABS are fetched plainly (never `meteredFetch`), and
`osmAllowance.ts` holds the daily ceiling and the one-request-a-second turn in
the SHARED limiter — a counter nobody can read refuses, because a per-isolate
count is no ceiling under horizontal scaling. And **a failure says which kind
it was**: `no_match` alone is a statement about the address; `unavailable`,
`refused` and `budget` (with its `capReason`) are ours, and the location
service maps them onto `geocoder_unavailable` / `geocoder_not_attempted`
rather than blaming the customer's address for this deployment's provider.
Places Nearby, Distance Matrix and Street View are now the TAIL of their own
chains, not dependencies (§13–14 of the same doc, measured before built).
**Amenities are a REGISTER, not a request**: a free Overpass mirror served a
hospital query in under two seconds and queued the same query past 25 s an
hour later, and this egress is a shared NAT — so `amenity_register` loads per
(category, state) on a daily pg_cron schedule (`amenity-register-ingest`,
exact tag values never a value regex, `nw` never `node`, a `[timeout:]` in
every query, one request at a time, upsert-then-prune) and
`location-intelligence-service` / `school-data-service` read it locally, with
Google asked only for categories the register cannot answer. **A slice's
currency gates its read**: zero rows for a state never loaded is
`unavailable`, never "no schools here", and a slice older than
`AMENITY_REGISTER_MAX_AGE_DAYS` declines in favour of the next provider. The
commute asks OSRM first (`mode: 'driving'` — the demo graph has no
timetables, and the reading never wears the transit label over a driving
measurement), and `street-view` asks Mapillary first behind an Integrations
card (`MAPILLARY_ACCESS_TOKEN`) whose absence skips the branch without a
network call. The three orders (`AMENITY_PROVIDERS`, `COMMUTE_PROVIDERS`,
`STREET_IMAGERY_PROVIDERS`) deliberately default with `google` LAST rather
than absent — a register that has not had its first ingest, a token nobody
has minted, must degrade to yesterday's behaviour, not to nulls.

**The address a pin and a card are built from is COMPOSED, never inherited.**
Read [`ADDRESS_COMPOSITION.md`](./docs/listings/ADDRESS_COMPOSITION.md) before
touching `_shared/listingAddress.pure.ts`,
`_shared/builderStockAddress.pure.ts` or the `address` line in
`projectAirtableRecord`. Airtable decomposes every address — `Unit Number`,
`Street Number`, `Street Name`, `Street Type` — and **97 of 139 live listings
can build a street line from those parts**, which had **zero call sites** in
the frontend: the projection did `Address ?? Full Address` and everything
downstream took that string. It disagrees with the parts because of a loop at
the source — Make geocodes `{{address}},{{suburb}}` (no street number, no
state, no postcode), Google answers with the suburb centroid, and a second
model call re-parses that answer and writes **eight** address columns back over
the extraction. So `Full Address` reads `Cobblebank VIC 3338, Australia` on a
record that knows `Mortlock Street`, and 202 of 1,019 cached geocodes collapse
onto 95 points. Three rules bite. **The parts outrank any formatted string** —
a `formatted_address` describes what the provider MATCHED, which is smaller
than what the source said. **Precision is measured** (`address` / `street` /
`locality` / `none`), because 30 listings genuinely carry only a suburb and no
parsing invents a street number that was never in the email. And for builder
stock, **a bare leading number is a LOT, not a street number** — measured: of
the 44 rows opening with a number that also carry a `lot_number`, it equals the
lot in 44 and differs in none, at every magnitude. Calling a lot a street
number puts the pin on somebody else's house. The Make repair is
`blueprints/apply-address-fix.py`, which **chains from `apply-sender-fix.py`**
because both write the same file.

**The Listings key never reaches a clone; the READ travels instead.** Read
[`AIRTABLE_KEY_OWNERSHIP.md`](./docs/integrations/AIRTABLE_KEY_OWNERSHIP.md)
before touching `AIRTABLE_TOKEN`, `_shared/airtableListingsRoute.pure.ts`, the
Airtable card in `src/lib/integrations/registry.ts`, or
`update-integration-secret`. Every deployment shows the same marketplace, so
the fleet-wide answer was to forward all six `AIRTABLE_*` names — but an
Airtable personal access token carries its whole SCOPE (a set of bases, a set
of permissions) and nothing narrows it to one table, so a forwarded token
reaches every base its scope admits and, with `data.records:write`, can rewrite
the shared intake table every other clone reads. `AIRTABLE_TOKEN` and
`AIRTABLE_BASE_ID` are therefore **`withheld`** on every clone and brokered by
Mission Control (`GET /api/public/listings/{tables|records|selftest}`); the
other four are configuration and still forward.

`airtableListingsRoute.pure.ts` is the one module that decides where a read
goes, and **no pipeline function may name `api.airtable.com` itself** — a spec
asserts that over all five (`airtable-proxy`, `listings-cache`,
`listing-images`, `listing-enrichment`, `auto-report-sync`). Three rules bite.
**A token with no base id is `unconfigured`, never brokered** — brokering it
serves a plausible marketplace of somebody else's listings. **The write-back
never leaves the account holder**: `listing-images` and `listing-enrichment`
PATCH signed URLs into their OWN bucket, and every deployment reads the same
table, so `resolveWritebackRoute` refuses anywhere the token is not held and
names the rule rather than reporting a missing setting — the broker is
read-only by construction and must never grow a write operation. And **the one
read that needs `filterByFormula` sends checked record IDS instead**, with
Mission Control composing the formula: `rec` plus fourteen alphanumerics can
hold no quote, parenthesis, comma or operator, which is the difference between
a caller naming rows and a caller asking questions.

**And there are two `NPC Emails` bases.** `apptyShYE0yzL4IGB` is live and
growing; `appFNPL7iYiuQyHAO` is a rebuild of it in a DIFFERENT Airtable account,
copied on 2026-08-18 — the cutover was never completed, and both
`REBUILT_BASE.md` and `MAKE_CUTOVER.md` read as though it had been. Two things
follow: **re-pointing anything at the rebuild replaces a growing marketplace
with a nearly empty one**, and **a perfectly valid token can be refused across
the boundary** — a personal access token reaches only its own account's bases,
so the first question on a 401 is which account minted it, not whether the token
is good.

Read [`BASE_BACKFILL.md`](./docs/listings/BASE_BACKFILL.md) before running
`npm run listings:backfill-intake`, activating a re-pointed intake scenario, or
changing which base the product reads. The rebuild's 148 migrated rows were
empty shells and were deleted on 2026-09-15; it holds 2 real listings against
the live base's 171. The reason that blocks a cutover is not just that the
rebuild is thin — **`listings_cache` DELETES a cached row that vanished from the
source while still inside the retention window**, so re-pointing the sync at a
base without today's listings presents all 171 as vanished at once. The 10%
destructive cap archives rather than part-deletes a batch that large, so it is
recoverable, but the marketplace empties with nothing reporting it. Three rules
bite. **Only what the product reads travels** — the include set is parsed from
`airtableIntakeFields.pure.ts` at runtime rather than copied, and the full column
set is 3.3 MB against 385 KB for the product-read plus provenance set, 76% of the
difference being `Email Body Plain Text` alone. **A copied row cannot carry its
own creation date** — `Created Time` is a `CREATED_TIME()` formula in the
rebuild, so provenance travels in `Email Received At` and `First Seen At`
instead, and attachments do not travel at all because an Airtable attachment URL
expires within hours. And **every written record is stamped in `Internal Notes`**,
which is what makes the copy idempotent, resumable and undoable in one command.

That card used to alias its `AIRTABLE_API_KEY` field onto `AIRTABLE_TOKEN` and
write it into the project environment through the Management API — so a key
typed on the Integrations page silently superseded the one the pipeline runs
on. The six pipeline names are listed once, in
`_shared/listingsPipelineSecrets.pure.ts`, and refused by the write endpoint
before the allow-list with a message that names the rule. The page's Airtable
card is the **workflow** connection, under its own names (`AIRTABLE_API_KEY`,
`AIRTABLE_WORKFLOW_BASE_ID`), and the workflow catalog reads only those.

## What a clone does not get when it is provisioned
Read [`docs/operations/CLONE_PROVISIONING_GAPS.md`](./docs/operations/CLONE_PROVISIONING_GAPS.md)
before concluding that a clone's Market News Feed, listing scrape or Builder
Stock is broken. **A clone's migration LEDGER is not a record of what ran** —
measured 19 Sep 2026 on `plisdzywzleljorrphxv`, all seven `market_sources`
seeding migrations recorded as applied and the table holding ZERO rows, behind
310 ingestion runs that had produced nothing. Provisioning copies the schema
and the ledger; **the rows a migration INSERTs do not travel**, so anything
seeded by one is absent on every clone while looking, from the ledger, exactly
like it is present. All three clones also stop at `20261123000000`, missing the
same seventeen migrations.

Three rules follow. **Reference data has to be able to travel as code** —
`canonicalRegistry.generated.ts` is the source registry extracted from the
migrations that define it, and `market-updates-ingest` fills an EMPTY registry
from it rather than refusing; only empty, because a registry with rows is one
somebody has decided about and re-inserting there would overrule an operator.
**What decides brokering is SCOPE, not spend** — and getting that backwards is
the mistake this section was first written to record. There is no keyless path
to the listing portals (`r.jina.ai` answers HTTP 200 with an "Access Denied"
body for both, measured), so the first answer was to broker the page read the
way `AIRTABLE_TOKEN` and the Didit key are. That was the wrong precedent:
those two are withheld because their scope EXCEEDS the job — every base a
personal access token was minted with, every session in a Didit application
including other tenants' passport portraits. A Firecrawl key fetches the URL
it is handed and can read nothing of anyone else's; what it carries is spend,
and spend is what forwarding already handles, since `apiUsageBilling.pure.ts`
maps it to a billable vendor and recharges the tenant. `FIRECRAWL_API_KEY` is
accordingly already a `prime_secret_forwards` row on Mission Control with **no
value behind it**, and `hooks/fleet-secret-forward-reconcile` pushes fleet
policy to clones that already exist — so the remedy is one value in Mission
Control's environment, which its own secrets page states in those words.
`pageReadRoute.pure.ts` stays as the fallback that makes a deployment with no
key SAY so rather than fall silently through to a model search, and as the one
home of the eight-host allow-list, because a broker must enforce it rather
than trust its caller. And **a feature the migrations have
not reached degrades rather than failing**: `builder_network_stock_ranked`
exists on no clone, so the marketplace falls back to the base table and says
`ranked: false` instead of answering 42P01 into a 500 — with its own
pre-ranking ORDER, because `ordered` leads with four ranking-only columns and
would have failed the same way.

**And a gap that reads like a clone's is sometimes nobody's.**
`builder_network_connections` is empty on the PRIME as well as every clone,
because nothing anywhere writes it: the product reads it in four places and
writes it in none, and `_shared/builderNetwork.ts` says so outright —
"Nothing here invents a connection." Three documents name three different
owners for that write (the mirror migration says Mission Control's
provisioning machinery; Mission Control's trust-anchor migration says it is
"the trust anchor and nothing else … operator visibility only, never
authoritative"; the extraction plan says the clone mints at connection time)
and none of them implemented it. The network is complete and hands the shared
transport credential back exactly once from `provision_transport`, under a
comment naming a catcher Mission Control never wrote. So before concluding a
deployment is missing something, check whether the thing is present anywhere:
a feature absent on every deployment is unbuilt, not unprovisioned.

## What the API gateway checks (`verify_jwt`)
Read [`docs/security/VERIFY_JWT.md`](./docs/security/VERIFY_JWT.md) before
changing a `verify_jwt` line in `supabase/config.toml`, the deploy workflow's
changed-function list, or a function's own auth check. **An omitted
`[functions.X]` block is not "no opinion"** — the CLI reads it as `true`, which
asserts the gateway is checking a Supabase JWT in front of that function; it was
wrong for 91 of 425, and `check-verify-jwt-declared.mjs` now fails CI on a
missing declaration.

Two rules bite. **A preflight is not a `verify_jwt` probe** — the gateway exempts
`OPTIONS` and enforces on the real request, so a guarded function answers its
preflight normally; every wrong conclusion in this area came from reading a 200
(or a 503, which was a boot failure) as evidence about the gateway. Ask the
Management API instead. And **a config-only edit used to deploy nothing**,
because the changed-function list was built from `supabase/functions/**` paths
alone — which is how a declaration and production came to disagree at all.

## Step-up authentication blocks what nobody can unblock
Read [`docs/security/STEP_UP_ENFORCEMENT.md`](./docs/security/STEP_UP_ENFORCEMENT.md)
before touching `_shared/stepUp.ts`, `_shared/aml/step-up.ts`, `STEP_UP_ENFORCED`
or any handler calling `requireStepUp`. Saving a credential on the Integrations
page reported *"Network/CORS error calling update-integration-secret"* and
**both claims were false** — the function was ACTIVE v354 and CORS was correct.
`security_events` held the real answer: `step_up.blocked / missing /
secrets.update / enforced:true`.

Two rules bite. **A shared refusal helper never invents CORS headers** — both
step-up modules built their 401 from a module-level
`Access-Control-Allow-Origin: *`, and a wildcard is invalid for the
`credentials: 'include'` requests this product sends, so the browser discarded
the response and `fetch` rejected with `Failed to fetch`. The 401 and the words
"Recent reauthentication required" never reached JavaScript, and an auth gate
presented as a broken deployment. The helper now resolves
`args.cors ?? createCorsHeaders(origin)` from the request it already holds, so
the fix reaches **all eleven call sites without editing one of them**; the AML
copy had the same defect on a path that is LIVE on ~20 routes. And **a control
that cannot be satisfied is an outage, not a control**: enforce mode demands
`assurance_level >= 2`, password-only minting yields 1, and 0 of 4 superadmins
have MFA — while `StepUpDialog` and `useStepUp` are fully built with **zero call
sites**. `STEP_UP_ENFORCED` is fail-closed when unset (CI-pinned) and is set
nowhere in this repo, so every deployment that never set it has a silently
bricked Integrations page; the clone sets it and its saves work — 6 of 6 rows
filled against the prime's 0 of 20.

## The login CAPTCHA is a per-deployment credential
`src/lib/turnstileSiteKey.ts` is the one place that decides which Turnstile
widget a build renders. A widget IS a **(site key, secret) pair** — the site key
is public and drawn by the browser, `TURNSTILE_SECRET_KEY` is its twin in the
backend — and `siteverify` reports the hostname a token was solved on, which no
login handler here reads. So a shared widget means a token farmed from ANY
tenant's login page satisfies the CAPTCHA on every other one.

The site key used to be a literal in `components/auth/TurnstileWidget.tsx`, and
`npc-client-dashboard` inherited it verbatim when this repo was mirrored. Two
rules now hold it. **The built-in key is used only while the build talks to the
Supabase project its secret lives in** — the same pairing rule
`integrations/supabase/env.ts` applies to the URL and anon key, and what makes a
built-in safe to inherit: a fork pointed elsewhere resolves to no key and says
so, rather than rendering this deployment's widget on another tenant's page. And
**the key is named in exactly one module**, asserted by
`turnstileIdentity.spec.ts`. Aurixa Mission Control mints each clone its own
widget and publishes `VITE_TURNSTILE_SITE_KEY`.

## The activation gate (a clone may be locked until it pays)
Read [`docs/billing/ACTIVATION_GATE.md`](./docs/billing/ACTIVATION_GATE.md)
before touching `_shared/paymentGate*.ts`, `mission-control-gate`,
`usePaymentGate` or the `PaymentGateOutlet` in `DashboardLayout`. A clone
provisioned onto a PAID plan boots on a clock (72h by default) and is locked
behind a payment screen when it runs out, until Stripe captures the activation
payment. **The prime and every clone that already exists are not gated and
cannot become gated** — a `clone_payment_gates` row IS the gate, only
provisioning writes one, and a test asserts no migration backfills the table.

Three rules bite. **The status is derived, never stored** — nothing closes a
gate, because `THE_CLONING_ENGINE.md` records six pg_cron jobs that were never
scheduled at all, silently, and a gate whose closing depends on a worker fails
OPEN under exactly that fault with nothing reporting it. **Only an explicit
locked answer locks**: an unreachable Mission Control, a timeout, an
unparseable body or an unrecognised reason word all render the dashboard,
because the enforcement that protects revenue is Mission Control's own 402 on
`tokens/reserve` and `seats/reserve` (an unpaid clone spends the PRIME'S
forwarded vendor keys), while the failure this screen could cause is locking
out somebody who has paid. And **a top-up does not activate a workspace** —
`seat_plan` and `setup_package` settle the gate, so a $50 credit pack cannot
open a $2,015/month plan.

**The pay button is decided by what is OWED, never by a reason word.** An
operator locked a clone by hand and asked where its Stripe button had gone; it
was gone correctly — `resolveGateState` reads `manual_override` BEFORE
`paid_at` and `settleGatePayment` never clears it, so paying an
`operator_locked` gate takes the money and leaves the workspace exactly as
shut — and four other things were wrong. The rule was
`reason !== "operator_locked"`, which answers yes to every word this build has
never heard of, INCLUDING the `unknown` an unreadable body resolves to, so a
lost signal drew a full-width demand for money; `payingCanUnlock` is an
ALLOW-list (`grace_expired`, `within_grace`, `no_deadline`) and fails closed,
and `lockedCopy` stops saying "complete the payment" over a page with no button.
**A gate on no clock at all had no way to pay anywhere in the product** —
`shouldWarn` required `counting`, and the banner is the only CTA inside an
unlocked dashboard. **`verdict.pricingUrl` had zero call sites**, though the
module's own comment calls it "always a real URL when gated … because a locked
screen with no way out is worse than no screen". And **paying twice was one
click away**, because the only guard is Mission Control's `paid_at` and the
Stripe webhook writes it after the redirect. On Mission Control's side the gate
quoted `tier.monthlyInclGstCents` — the price WITHOUT the AML module, $2,015
against Scale's $2,210 headline — which `seatPlanForTier` refuses as a
`price_mismatch`, so every newly armed gate's button would have died; the
checkout route did not refuse an `operator_locked` gate; and the operator page
had no way to send a customer to Stripe at all. **Payment Gates offers a
payment link now**, minted by `mintGateActivationCheckout` — the same module
the clone's CTA calls, so the two cannot charge different amounts or refuse on
different grounds — and it is the one gate act that demands no reason, because
it writes nothing.

## Workflow Playground (the automation canvas)
Read [`docs/workflows/DISPATCH.md`](./docs/workflows/DISPATCH.md) before touching
the run engine, the trigger-capture triggers or the dispatcher. One engine serves
three callers — a test run, a live run a person starts, and a workflow a captured
event dispatches with nobody watching — so it lives in
`supabase/functions/_shared/workflow/` and `src/lib/workflow/*` are one-line
shims onto it. Those modules must parse under Deno: no `@/` aliases, explicit
`.ts` extensions.

Two things the doc records that keep biting. **Nothing is captured unless a live
workflow listens for it**, so an empty `workflow_trigger_events` on a deployment
with no live workflows is correct rather than broken. And **what can run live is
derived from the catalog, never listed**: an operation is runnable because it
declares a `request` descriptor (`httpRequest.pure.ts`), so adding a vendor is a
declaration beside the operation rather than a change to the executor — and a
new vendor call that skips `_shared/meteredFetch.ts` is billed to nobody.

## API usage metering (this deployment may be spending someone else's money)
A workspace provisioned by Aurixa Mission Control boots with the **prime's own
vendor keys** forwarded into its Supabase project — OpenAI, Resend, Domain,
Cotality, Lovable — so every model token and property lookup it makes is billed
to the prime's accounts and recharged per tenant. A key the workspace supplies
itself is charged at nothing. Read
[`docs/integrations/API_USAGE_METERING.md`](./docs/integrations/API_USAGE_METERING.md)
before touching `_shared/logApiUsage.ts`, adding a vendor API call, or changing
`service_name` on an existing one: an unmapped service is metered here and
**never billed**, because guessing which credential a call spent bills the wrong
tenant. The map is `_shared/apiUsageBilling.pure.ts` and nowhere else.

New vendor calls should use `_shared/meteredFetch.ts` rather than `fetch` — it
resolves the credential from the URL and logs the call itself, so metering
cannot be forgotten. Never add it to a call site that already calls
`logApiUsage` for the same request: that bills the tenant twice, which is worse
than not billing.

**Model calls are metered by `_shared/llmRouter.ts` itself**, which is why
`meterUsage` exists and why it **defaults to true** — 19 of the 25 edge
functions that call the router were spending a forwarded key for free, and an
omitted flag must never mean unbilled. Only the six functions that log
adjacently to their own call pass `meterUsage: false`. The credential a
`(route, modelId)` pair spends is resolved by `_shared/llmUsageBinding.pure.ts`,
which mirrors the router's dispatch and returns **null** rather than guessing; a
CI test reads the router's source and fails when the two drift.

## The Commercial & Industrial Analysis Workspace
`/calculators` is one guided workspace, not nine calculator cards. Read
[`docs/commercial/ANALYSIS_WORKSPACE.md`](./docs/commercial/ANALYSIS_WORKSPACE.md)
before touching it, `src/components/commercial/workspace/` or
`src/lib/ciAssessment/analysis*.ts`. The rule that carries it: **an analysis is
an assessment record** — there is no separate calculator session, client model
or property model, so autosave, calculation runs, client linking and the
rendered report are the platform's own rather than a second implementation. The
standalone suite it replaces kept the whole deal in a Zustand store with no
persistence (a refresh discarded it) and its "Generate Report" produced no
document at all.

Two things bite. The **two analysis engines use different units** —
`capRateEngine`'s valuation gap is a ratio, `dcfEngine`'s IRRs are already
percentages — and getting it wrong renders a plausible number rather than an
error; both are pinned by tests. And **readiness is not a second opinion**:
blocking is exactly what the report route refuses, everything else is disclosed.

## The sanctions register itself
Read [`docs/aml/SANCTIONS_LIST_LOADING.md`](./docs/aml/SANCTIONS_LIST_LOADING.md)
before touching `scripts/aml/load-sanctions-lists.mjs`, the
`ingest_sanctions_list` operation or the refresh workflow. `aml.sanctions_entries`
was empty from the day the platform was built, for **three** independent
reasons, and each one on its own explained it: the refresh has never had the
repository secret it needs to write; DFAT answers a scripted client with a 403;
and the prune step **failed every load it was part of** — on a mutation,
PostgREST resolves the columns inside a logical `or=(…)` against the RETURNING
projection rather than the table, so `.delete().or('sync_id…').select('id')`
answers `42703 column … does not exist` while the same filter on a GET
succeeds. That third one is the one that would have survived fixing the first:
the loader records the run as failed, and the provider fails closed on a
required list whose latest attempt failed — a complete, current list in the
table and every screening refusing to run.

Two rules bite. **Freshness of the load is not currency of the data** —
`assessListRecency` reads the file's own Control Dates, because every other
control measures when we synced and a four-year-old file uploaded today passes
all of them. And **normalisation is server-side, always**: names are indexed
with the same function the screening query uses, so a browser that normalised
differently writes entries no query can ever match, which looks exactly like a
list that works.

## Identity verification reaches Didit through Mission Control
Read [`docs/aml/VERIFICATION_BROKER.md`](./docs/aml/VERIFICATION_BROKER.md)
before touching `_shared/aml/providers/diditStandaloneRoute.pure.ts`,
`probeStandaloneRoute`, the `verification_selftest` operation or Mission
Control's `verificationBroker.*`. A Didit API key is scoped to an
APPLICATION, and that scope includes the application's session list — measured
7 Sep 2026, one key returned all eight sessions with the customer's name and
**live pre-signed URLs to their passport portrait and selfie**. Forwarding it
fleet-wide put a credential on three tenant projects that could read every
other tenant's customers' identity documents, and Didit publishes no API to
mint one per tenant. So the credential stops travelling and the CALL travels:
Mission Control holds the key and runs the three write operations on a
tenant's behalf.

Four rules bite. **A brokered call is not metered at the clone** — Mission
Control writes the usage row because Mission Control made the vendor call, and
both ends billing is worse than neither. **Nothing readable is brokered**, so
the enumeration this closes cannot be reached through the thing that closes
it. **Who refused is read from a header** (`x-mission-control-refusal`, set on
Mission Control's own refusals and never on what it relays) rather than
guessed from a body, because both ends answer 401 with similar JSON and send
an operator to opposite remedies. And **configuration is not reachability**:
every readiness reading here was green on three tenants that had never
completed a verification, so `verification_selftest` makes one real call —
deliberately incomplete, so the vendor rejects it for free — and being
rejected is the PASS. It is never metered and writes nothing.

The **hosted-session** flow (`diditClient.ts`, `didit-webhook`) is deliberately
NOT brokered: it is legacy, `diditConfigured()` refuses to create a session
without the raw key, and a decision read is parameterised by session id — so
brokering it needs per-session ownership or the broker becomes the leak.

## AML screening execution
Read [`docs/aml/SCREENING_EXECUTION.md`](./docs/aml/SCREENING_EXECUTION.md)
before touching `_shared/aml/screeningConsumer.ts`, the inline
path in `aml-cases`, or anything that decides whether a party has been
screened. "Screening never starts" was reported as a UI defect and was in fact
**four stacked faults**, each of which explained the symptom on its own and
each of which reported as normal operation: the internal signing secret had
diverged, so 17,174 scheduled invocations were refused and no worker ran at
all; the claim predicate was a PostgREST `.or()` string with a timestamp
interpolated into it, which never parsed, so the claim had **never once
succeeded**; the claim's error was discarded, so a database fault was
indistinguishable from losing a race and the subject was left untouched; and a
provider that is configured but still in simulator mode was reported as no
provider at all, sending the administrator to the wrong remedy.

There is now a **second execution method**: a screening the MLRO carries out by
hand. It is a method and never an exemption — nothing on that path writes
`required` or can spell `not_required` — and it is the *same* record, an
ordinary `screening_checks` row whose candidates go to the existing
adjudication. `execution_mode` could not carry it (it is live-vs-simulator, and
a manual check is both live and authoritative), so the method has its own
column. A manual **no match** is refused unless it names the sources checked,
the names searched and a rationale, enforced three times over —
`manualScreening.pure.ts`, the `record_manual_screening` operation, and a table
constraint — with the rule written once and imported by both the dialog and the
edge function. It is also available where sanctions are **`not_required`**: what
is owed and what may be performed are different questions, and a voluntary
attempt leaves the policy state standing unless it FINDS something —
`projectManualScreeningToSubject` is the only place that decides. Provider
readiness is a fact about the automated method alone and never gates the manual
one.

Three rules carry it. **A green cron run is not a delivered request** —
pg_cron reports on the SQL that queued the HTTP call, not the call, so the
honest signals are `integration_outbox.attempts` and
`net._http_response.status_code`. **Never compose a filter as a string**: the
test double emulated `.or()` with a regex, so code and test agreed while only
the server disagreed, and a contract test now fails any interpolated filter.
And **production never runs the simulator and never screens against an empty
or stale list** — refusal is visible, a confident clear against nothing is not.

## Distributing a Passport to several partners
Read [`docs/aml/PASSPORT_DISTRIBUTION.md`](./docs/aml/PASSPORT_DISTRIBUTION.md)
before touching `passportRecipients.pure.ts`, `PassportRecipientsPanel`, the
`deliver_to` argument on `grantAccess` or the wizard's grant step. Reliance on
one completed CDD process by several partners is the product, and it had no
surface: the register held two correct, active grants for the same case while
`delivered_to_email` was **null** on both, because `grant_access` emails the
link only when handed a `deliver_to` and the wizard called
`grantAccess(caseId, agreement.id)`. Nothing failed — the grant minted, the
audit event wrote, the badge went green, and the partner was told nothing.

Three rules carry it. **Delivery is part of the act** — a grant nobody was
emailed is access with no channel and is indistinguishable from a healthy one
in every register, so `undelivered` is its own state and the panel leads with
it. **A live link can never be re-read** (only its hash is stored), so a
holder's send is a REPLACEMENT carrying `reissue_of`, said before the click.
And **there is exactly one send path**, because there were two and that is why
one was wrong: `reissueGrant` passed the one-time link as a prompt field's
`placeholder`, which is not a value — the uncopyable-empty-box defect that was
reported, fixed on the other path, and survived here. `PromptField.value`
exists for the same reason.

The raw bearer token and the `/passport/<token>` link are the **same
credential**; the link is what a person opens and the token is for a partner
system with no browser, so it sits behind a disclosure rather than being
presented as the deliverable.

**Access can be withdrawn, and withdrawal is not deletion.** `revoke_grant`
existed from the first version and no surface ever called it. A grant records
that a disclosure was authorised, so revoking stops the access and KEEPS the
history — the only "remove this partner" a register may offer. It needs a
reason, it is offered only on a LIVE grant, and it is deliberately not gated
by what gates issuing (an overdue review, a missing attestation, the write
flag): those stop new disclosure, and stopping disclosure is what this does.
The explained action list that made blocked buttons legible had itself become
a wall — five rows of three lines, always open, beside the same grants listed
twice — so **one act is open (the server's `ready`) and the rest are a
disclosure**. And the four lists of the same partners (the grant, the written
arrangement, the emailed agreement, the case link) are now **one roster**,
`partnerRoster.pure.ts`: one row per organisation with ONE next step, chosen
by what actually blocks. Two rules there — **a badge must mean something is
unmet** (`active`, `reliance` and `builder_developer` are how a healthy record
looks, and colouring them like problems is what made eleven chips unreadable),
and **database vocabulary never reaches the operator**, asserted by a test that
refuses any underscore-cased identifier in a rendered field.

## One living record — the attestation everyone reads
Read [`docs/aml/ATTESTATION_CURRENCY.md`](./docs/aml/ATTESTATION_CURRENCY.md)
before touching `attestationCurrency.pure.ts`, `attestationForGrantRead` or the
manifest carry-forward in `issue_attestation`. A grant pinned `attestation_id`
and every read resolved through that pin, so **issuing v2 silently revoked
every partner who already held the Passport** — their next read answered 409
`attestation_superseded` and the only repair was to re-send it to each of them
by hand. Under schema v2 there was a second, independent cause of the same
outcome: the new version had no disclosure manifest, so every read would have
failed `manifest_missing` anyway.

The rule: **a grant authorises a PARTNER to read a CASE's attested record, not
one frozen version of it.** Reads resolve the case's current attestation and
the version served is recorded on the access log. Three rules carry it. **The
pin is history, never the reading** — `attestation_id` is never rewritten.
**Current means CURRENT, not merely newer**: a version flagged for refresh is
still withheld, because "we know this one is wrong" is not "there is a better
one" — and the refusal now promises no new link is needed. And **a widening is
never implicit**: the carry-forward copies the previous manifest's scope, and a
grant whose predecessor had no manifest gets none and fails closed.

## The Passport inside a partner's own portal
Read [`docs/aml/PASSPORT_IN_PORTAL.md`](./docs/aml/PASSPORT_IN_PORTAL.md)
before touching `_shared/aml/partnerSurface.pure.ts`, `PartnerPassportPanel`,
`enrol_partner_portal_access` or the `passport` field on
`get_partner_compliance_workspace`. The machinery existed and had never served
a partner, for **four independent reasons each fatal on its own**: the surface
flags were off; `partner_portal_memberships` held zero rows and its upsert op
had no caller anywhere; the organisation cross-reference columns were declared
by the Phase 1 migration and written by **nothing, ever**; and the page drew a
one-line identity strip rather than the booklet.

Four rules carry it. **The in-portal document is the SAME document** —
`buildCasePassportView(…, "partner")`, the assembler the emailed link uses, so
"identical" is a property of one implementation rather than two agreeing.
**Turning the Passport on NARROWS the page**: `aml_partner_passport_view`
resolves the surface to `passport_only` unless `aml_partner_workspace_full` is
also on, so showing a document cannot expose eight unreviewed panels — and the
mode is a mask over the per-portal adapter (`full && adapter`), never a
replacement for it. **Enrolment maps a real portal identity read from the
portal's own records, and never re-points an existing binding**, because that
would change which partner every existing portal account speaks for. And
**a withheld Passport renders its reason** — enrolled, linked and nothing to
read is a real state, and a blank area reads as a broken page.

A partner accumulates Passports, so the page is a **filing cabinet** now, not
a row of chips labelled `Matter …6a5a49` (the last six characters of a row
id). `partnerMatterIndex.pure.ts` orders matters by what can be opened and the
page is centred with the list beside the document. Its rule is a disclosure
rule: **a partner is told whose record a matter is only where they may READ
it** — `subject_label` is not sent for a withheld matter, decided by the same
`passportDisclosure` the document goes through, so neither the list nor the
search box can name a customer the partner may not see.

An eighth fault sat in front of all of it: the page and the nav entry gated on
`supabase.from("feature_flags")` **from the browser**, and that read can never
work for a partner — the table grants SELECT `TO authenticated`, a portal
user's client is anon, and RLS FILTERS rather than erroring, so it returned
`[]` with HTTP 200 and every flag coerced to `false`. Every partner in every
portal was told the page did not exist however the database was set. **This
was the third surface to hit that trap** (`useAmlV3Flags` and
`useBuilderStockMarketplaceFlag` carry the same header), so the rule is theirs:
**read through the server, not the table** —
`get_partner_surface_availability`. Two more rules follow: **one authority
decides** (the pages no longer gate at all; the server refuses and says why),
and **a failure is never cached and never reported as "off"** — `unknown` is a
distinct answer, so the Command Centre says nothing rather than something
false.

Two more faults sat behind the same symptom. **`create_agreement` never
accepted a `partner_org_id`**, so every wizard-written arrangement had NULL
there and `grant_access` stamps a grant only `if (agreement.partner_org_id)` —
the portal looks a grant up BY organisation, so it reported a Passport the
partner held as never shared; the fix is a validated field, an explicit
`bind_agreement_organisation` repair that never re-points, and a read path
that accepts either explicit route. And **nothing led from the emailed link to
the portal**: `portal_handoff` now offers "View in your portal" on the page and
in the email, but only when the surface is on AND an active membership exists,
because a door that refuses is worse than no door. The deep link carries a
matter id and never the token, and `returnToPath`/`safeReturnTo` are one rule
for all three logins — two of which used to discard the destination entirely.

The page's chrome answers to two more rules. **The compliance entry is second
in every portal**, directly under the Dashboard — Finance, Builder/Developer,
Solicitor and the Client Portal — and `portalNavPlacement.test.ts` pins the
position and nothing else; the Client Portal's is still called "Identity &
Compliance", because that reader is the customer proving who they are. And
**the standing "Your organisation remains responsible" banner is gone**: a
partner reaches the page only through a signed arrangement carrying those
acknowledgements, so it restated an agreement on every visit.
`ResponsibilityNotice.tsx` is DELETED rather than unmounted (a dormant
component is one import away from putting it back), while the statement itself
survives attached to the document it qualifies and the assessment form's
acknowledgement control is untouched — removing a notice must never remove a
control. The space that frees is not cosmetic: `bookletGeometry` fits the
spread to the box it is given, so container width and board height convert
directly into legible document.

**A magnified booklet has to be movable, and had nothing to move it with.**
Zooming severed the right-hand leaf at the dialog's edge, pushed the turn bar
off the bottom and offered a scrollbar on neither axis — and the same fault
crops the document at 100% on a short window or a phone. The scroll container
asked for `h-full`, which resolves against a containing block whose height
comes from flex rather than from a declared length, so it computed to `auto`,
the scroller grew to its own content (1,553px inside a 667px box) and
`overflow: auto` had nothing left to clip. A flex column plus `min-h-0 flex-1`
takes percentage resolution out of the path and still works where the holder
has no bounded height (the Client Portal). Four rules follow. **Centring is by
auto margin, never `justify-content`** — centring an overflowing box pins it
at a negative offset no scrollbar can reach, and one layout then serves the
fitted document and the magnified one. **Whether there is anywhere to pan is
asked of the DOM**: `overflows` was `zoom > 1`, which is neither necessary nor
sufficient, and a measured box carried on the geometry FLAPS where the
container is content-sized, because the box is then the one the board itself
makes — so `BookletZoom.overflows` is gone rather than left to be believed.
**A hidden affordance is no affordance** (drag to pan, and scrollbars drawn in
the document's own palette, because the platform default is browser chrome or
nothing at all). And **the arrow keys mean what they mean where the reader is
standing** — panning inside a magnified board, turning the page everywhere
else.

The booklet's own chrome answers to one more: **`.passport-action` must not
declare a width.** It declared `width: 100%`, and `.w-auto` — which every one
of its nineteen call sites pairs it with — is also a single-class selector, so
source order decided and the utility lost everywhere. The visible defect was
the turn bar (both buttons 535px of a 1200px row, the page title clipped to
"Identity Ver…"), but the same rule stacked every `flex flex-wrap` action row
in the Command Centre one button per line. The turn bar is a grid now, because
`justify-between` centres nothing, and the magnification cluster has a body of
its own — it was four chips in the page-number row, in the page-number style,
so nobody found it.

The raw bearer token is **gone from the Command Centre**: it and the
`/passport/<token>` link are one credential, and showing it twice invited an
operator to send "the code" instead of the link.

## Stage 5 — the screening resolution centre
Read [`docs/aml/STAGE_5_SCREENING_RESOLUTION.md`](./docs/aml/STAGE_5_SCREENING_RESOLUTION.md)
before touching `ScreeningStageCard`, `screeningResolution.pure.ts`,
`screeningNextAction.ts`, `AmlContextActionPanel` or `deriveScreeningNextAction`.
Stage 5 had every fact it needed and no arrangement of them, so this is
orchestration — no new screening system, determination store or journey status.

Three rules carry it. **Obligation, method and outcome are different
questions**: `not_required` is an obligation, `no match` is an outcome, and an
unavailable provider is a method — collapsing them into one badge is how "not
required" came to read as "clear", and a test asserts the two vocabularies
share no value. **A closed case is a retained record, not a stage in
progress** — it leads with that and offers only the authorised reopen, held on
both sides because they deploy separately, and a FINDING still outranks the
lifecycle. And **one blockage can have two lawful routes**: a blocked required
screening offers the MLRO a manual route and keeps the administrator's repair
named as the alternative, so neither role holds a status with no step and the
broken automation is never papered over.

The contradictory screen behind it was **data disagreeing with itself**:
`reopen_case` moved the legacy `status` and left the canonical `case_stage`
and `closed_at`, while `transition` had always synced all three. It now syncs
them too — and still never touches `service_gate_status`, because
`STATUS_TO_SERVICE_GATE[resumeStatus]` would revive a terminated gate.

## Stage 9 — the service gate and the credential
Read [`docs/aml/STAGE_9_PASSPORT_AND_PARTNERS.md`](./docs/aml/STAGE_9_PASSPORT_AND_PARTNERS.md)
before touching `refreshRemedy`, the reason codes in
`_shared/aml/passport/passportState.pure.ts`, `gatePassportPath.pure.ts` or
`passportActions.pure.ts`. **`refresh_required` is one code covering two
different owed acts**, and the product rendered both as "issue a new version":
on the reported case the attestation was v1, issued, unsuperseded, with zero
open refresh obligations, and the state was flagged for the single reason
`service_gate_regressed` — the gate was under review. Stage 9 said "a newer
version is needed" and the reliance panel offered "Reissue as v2", which
supersedes a good v1 and changes nothing, because v2 carries the same reason
while the gate is unapproved. **A remedy that cannot discharge the reason is
never offered as the next step**; `refreshRemedy` is the one place that
classifies them, an unrecognised reason counts towards the reissue (the
conservative side), and a spec test fails on any reason the classifier does not
name.

**The gate is granted by the cleared decision, not asked for twice.**
`aml.service_gate_decisions` held ZERO rows across the whole database: Stage 9
carried an approval card whose button was disabled until a ten-character reason
was typed while still reading "Approve the gate — Approved", so clicking it did
nothing at all. And the platform disagreed with itself — `aml-cases`'
`transition` maps `cleared → approved` while `decide` deliberately left the gate
alone, so which one a case got depended on which button moved it. The second act
asked no new question either: `set_service_gate`'s approval preconditions and
`decide`'s clearance preconditions are the SAME `clearanceBlockReasons` over the
same inputs. `decide` records the gate itself now, through the one
`recordGateDecision` both paths use, and `GateApprovalCard` is DELETED. Three
rules hold: **only `cleared` grants**, **a `locked`/`terminated` gate is never
revived** (the MLRO's standing restriction is the only way a live Passport is
suspended or revoked), and **open conditions mean `approved_with_controls`**.
`set_service_gate` and the Decision stage's full eight-status card are
untouched — removing a ceremony must never remove a control.

Two more rules. **Completion is counted once, in the units of the steps** —
the header said "0 of 3 items on this stage complete", the rail said the same,
and the card listed four steps; Stage 9 defers both, `anytime` is excluded
because a look is not a debt, and where only the gate is owed the issuance step
is DONE rather than a second copy of the same fact. And **the finishing line is
named before the click**: approving the gate on that case completes the stage
outright, so the card says so — exactly when one owed step remains and this
operator can perform it, never when the last step is blocked.

**Partners are on ONE stage, and the rail says what the page says.** The
roster and every act on it have always been on the Passport stage; the stage
after it carried a read-only echo of the same organisations, read through
`aml_passport_partner_distribution` — a flag that is OFF wherever partners are
onboarded one at a time, so it announced "Passport distribution is not enabled
for this deployment" right after six partners had been given the Passport. The
cut follows the work: **Stage 9 is "Passport & Partners"** (you cannot share
what has not been issued) and **Stage 10 is "Ongoing CDD"**.
`PartnerDistributionCard` is DELETED, `distributionStage` no longer reads
`facts.passport` at all but still NAMES where the partners are, and Stage 9's
path gains a fifth `anytime` step — sharing is never owed, because a case may
legitimately have no partner. A `shortLabel` must be **part of** its `label`
(a test pins the rule, not the strings): the rail read "Partners" while the
heading read "Partners & ongoing CDD", which is how an operator comes to look
for partners on the wrong screen.

On the journey map, **Builder and Developer are one portal** (the wizard
already knew; the map's second tile could never connect, and a `developer`
grant had nowhere to appear), and **a live Passport reads green** like the
Client portal's own completion — worded as a fact about access, never as a
claim about the partner, and a revoked grant takes the colour back.

## The Command Centre on a phone
Read [`docs/aml/COMMAND_CENTRE_ON_A_PHONE.md`](./docs/aml/COMMAND_CENTRE_ON_A_PHONE.md)
before changing a layout class on an AML surface, `AmlPageHeader`,
`AmlWorkspaceHeader`, `AmlJourneyRail`, the AUSTRAC register or the
touch-target rules in `src/styles/utilities.css`. Every defect there was
found by rendering the real page into a real Chromium and measuring the DOM,
and several are invisible at 390px and appear only between 430 and 768 — so
"it looked fine on my phone" was never evidence either way.

**The module had no door on a phone.** `MobileSidebar` renders the shared
navigation registry and nothing else, and the AML entry is not in it — it is
gated by the `aml_ctf` flag AND an assigned AML role rather than by a module
entitlement — so the desktop sidebar built the entry inline, the command
palette built a SECOND copy under a different title and group, and the two
mobile surfaces never had it at all. The whole module was unreachable from a
phone; typing the URL worked, there was nothing to tap. It is defined once in
`lib/navigation/amlEntry.ts` now and every navigation surface asks for it,
pinned by `sidebarNavigation.spec.ts` — which already existed to forbid a
private navigation list and could not see this one, because it was not the
registry's. It **fails closed, loading included**: an entry is a claim that a
page will open. And **"we could not check" is not "you do not have it"** —
`useAmlAccess` collapsed a failed read into the server's own "no", so a lost
signal made the guard announce "AML/CTF is not enabled" to an MLRO; the
reading now carries `unavailable`, the guard offers a retry and says nothing
about permissions, one automatic retry is made when the transport marks the
failure retryable, and navigation still fails closed because a door that
cannot be verified is not drawn.

**`flex-1` does not make a row wrap.** A line wraps when its items'
HYPOTHETICAL sizes overflow it, and `flex: 1 1 0%` contributes zero — so a
`flex-1 min-w-0` title beside a 330px action cluster is handed the leftovers
however small they are. On the AUSTRAC hub at 430px that was EIGHTEEN pixels
and a heading 532px tall, one character per line, on all twenty pages that
draw `AmlPageHeader`; 390 escaped only because the cluster alone overflows
there and forces the wrap by itself. A column that must not be crushed
declares a `basis`. The same bug was already fixed once on the case workspace
header and existed a third time on the AUSTRAC draft page's action bar.

Three more rules. **`shrink-0` protects a cluster's width, not its
contents** — the workspace header's badge cluster kept its 418px max-content
width on a 390px screen and hung off the edge while its own `flex-wrap` never
engaged, and the badges inside it were `whitespace-nowrap` anyway. **One
layout at a time**: the AUSTRAC register is cards under 768px, switched on
`useIsMobile` (the hook `ResponsiveTable` uses) rather than drawn twice and
hidden with `md:hidden`, because a CSS-hidden copy still carries every
accessible name in the document — and its acts come from ONE `rowActions` so
a phone cannot offer an Approve the desktop has taken away. And **a link in a
sentence is not a control**: `utilities.css` gave every `<a>` a 44×44 box
under 768px, which stops an inline link sharing a line box with the words
around it — Compliance Home's one-line footer was 96px tall with its links
14px off the baseline beside them. The floor stays for every anchor that IS a
control; the considered version of that accommodation is the
`@media (pointer: coarse)` block, which is keyed on the pointer rather than
the width.

## What the AML navigation offers, and what it does not

The Command Centre's nav is **compliance surfaces only**. Everything about
shipping this software, verifying a deployment or administering the platform
keeps its route and leaves the strip — the treatment `aml-v3-cutover` and
`aml-integration-health` already had. **Hiding is never deleting**: every AML
route in `App.tsx` is declared unconditionally and a standing test asserts it,
so a bookmark, a deep link and the case workspace's own buttons all still land.

Customer Compliance is **Register + Compliance Passport** — the two cross-case
entry points. Every per-case topic (Verification, Screening, Risk, Funding &
Finance, Transactions) is a stage inside a named customer's case; the
standalone pages exist but each loads with `cases[0]` selected, which is the
most recently created case, and on the Risk page "Record decision" was live in
that state. Ownership & Control is **conditional** — `useHasEntityCases` asks
the server whether the tenant holds a non-individual case, because beneficial
ownership is a company/trust/SMSF question, and it **fails open** so a failed
read never hides a compliance surface.

**The primary strip is three tabs: Compliance Home, Customer Compliance and
AUSTRAC Hub.** Regulatory & Assurance is retired, and it went by being
REDISTRIBUTED rather than hidden — lodging a report is the daily job and it was
two clicks down, so the AUSTRAC Hub is a workspace of its own (its drafting
routes resolve by prefix, so writing a report never loses the strip), and
monitoring, EDD and records sit under Compliance Home beside the queues that
count them. **No path lost a workspace**, which is the rule that makes a
retirement safe. Compliance Home therefore owns real paths now, and
`pathMatchesWorkspace` matches the module ROOT exactly and never as a prefix —
`/admin/aml` is every AML URL's ancestor, and prefix-matching it would make
Home the active workspace on the case register and every other tab dead.

The chrome is now **one Refresh and nothing else**. "Open queue" linked to the
active workspace's `defaultPath` — the page an operator is already looking at,
because they arrive at a workspace BY its default path, so on Compliance Home
it was a no-op every time. Configuration went with it, and Compliance Home's
secondary strip went too. What holds it all together is that **`paths` and
`secondary` answer different questions**: `paths` is OWNERSHIP (a URL belonging
to nothing draws no chrome and highlights Home — reachable and looking broken),
`secondary` is what is OFFERED. Monitoring, Investigations & EDD, Records &
Privacy and Configuration keep the first and lose the second, so every route
resolves and every page keeps its trail while no tab is drawn. Configuration
also left Organisation Settings' `paths` — **a path belongs to exactly ONE
workspace**, and listed in two it resolves to whichever comes first while the
other silently loses it. Three of the four keep **one quiet, capability-gated
line at the foot of Compliance Home** ("Also in this workspace"), because
Monitoring is already deep-linked from three readings in the strip while the
others had no route at all — and two of them are statutory.

That redistribution is what let **"Your queues" go entirely**: every
destination it listed is in the navigation, so the card was a third launcher
after the primary strip and the role-adaptive "jump back" card above it. The
page's own header went with it — a second title, strapline and Refresh drawn
directly under the command centre's — which exposed that **the shell's Refresh
was a placebo**: it dispatched `aml-command-refresh` and nothing in the product
had ever listened, so the button moved a clock. Compliance Home answers it now,
and `AML_COMMAND_REFRESH_EVENT` is named in one module because a literal at
each end is how two ends drift. Configuration's one capability-gated door moved
with the header into the command centre's action row, where it is one click
from wherever an administrator is rather than only from Home.

Compliance Home's queue directory was, before it went, **four entries**, because a queue is work
waiting for somebody. **Transactions** left: `aml.transactions` and
`aml.transaction_parties` hold zero rows and the page is a PER-CASE surface
loading `cases[0]`, which is exactly why the nav audit already folded it into
Customer Compliance as a stage — leaving it in the queue list contradicted a
decision the product had made. **Configuration** left the list too but NOT the
page: nothing waits there, so it is not a queue, but it is the only
discoverable route to the sanctions register's health and hiding the page is
what once stranded that behind a blocked case; it moved to the page header,
still gated on `aml.configure`, and `amlLayout.test.tsx` still pins **one
door, capability-gated**. The six case/monitoring metrics are **one strip, not
six cards** — six borders around six single-digit numbers took more height
than the case list under them — via a `dense` variant on `AmlMetricCard` that
keeps the deep link, the skeleton and the "Not available" reading that is
never a fabricated zero, with the label's line RESERVED so every value sits on
one baseline.

Three surfaces left because they are build or platform tooling rather than
AML/CTF work, and the evidence is on the tenant rather than in an opinion:
**Launch Operations** (rollout stages, 13 acceptance scenarios none ever run,
0 certifications, a risk register of 8 seeded rows never edited, categories
including "Engineering"), **Partner Operations** (renders only a deployment
preflight table; its operational half is behind a disabled flag with four
empty tables, and partners are managed on the Passport & Partners stage), and
**Governance** (five tabs of Release Gate, AI Approvals, Step-Up Sessions,
Resilience Drills and Runbooks — its one compliance tab, Contacts, is gated on
`aml_v3_org_settings`, which is off, which is also why
`senior_manager_designations` is empty).

**Configuration left the strip too**, and it is the case that shows what
"hidden" has to mean. It is not platform tooling — it holds the verification
provider's credentials, the risk factors every assessment is scored against,
and the sanctions register's health — but it is set once and revisited
rarely, and it is step-up protected, which is what an administrator's
destination looks like rather than a tab. It is reached from exactly two
places now: one capability-gated tile on Compliance Home (a second button
beneath it went, having sat directly under a comment saying restricted
affordances live in the tiles), and Stage 5's "open list health" when
screening cannot run. **Hiding the PAGE would strand the register behind a
blocked case again**, which is the defect that put it there.

Three rules bite. **A path belongs to exactly ONE workspace** — missing from
`paths` a page draws no secondary strip and highlights Compliance Home, and
listed in TWO it resolves to whichever comes first and draws the wrong strip;
both are reachable-but-broken, and the Passport shipped that way once. **A
workspace with no tab is not the same as no workspace**: `hidden` keeps
Organisation Settings owning its four URLs while the strip stops drawing it,
so those pages keep their header — resolution reads the permitted set,
rendering reads the visible one. And **every hook goes above the early
returns**: `AmlConfiguration` returns early while loading and again when the
summary cannot be read, `?tab=` support was appended where it was USED, and
the second render called two more hooks than the first — React threw, the
boundary caught it, and the page read "Something went wrong" on every visit.
A source-level test now fails on any hook below the first early return,
because the page's own test file had only ever exercised a sub-component.

## Lodging a report with AUSTRAC
Read [`docs/aml/AUSTRAC_LODGEMENT_PATH.md`](./docs/aml/AUSTRAC_LODGEMENT_PATH.md)
before touching `austracReportPath.pure.ts`, `AustracReportPathCard` or the
`submit_record` / `record_receipt` operations. The server was already rigorous
— MLRO approval, step-up MFA, lodgement evidence, the AUSTRAC reference for an
SMR, an explicit no-tipping-off attestation — and the surface in front of it
was five boxes and a status table. The defect: **`reports.case_id` has existed
since the first migration and the draft dialog never set it**, so every report
was filed against nobody and reached no customer's file.

Four rules. **The clock is in BUSINESS days** (SMR 3 from the day the suspicion
was formed, TTR/IFTI 10; a suspicion about terrorism financing is 24 HOURS and
is the same report under a tighter clock, never a different kind) and it runs
from the OBLIGATION rather than the reporting period — a separate field, kept
in `metadata`, because a deadline derived from the wrong date is worse than
none. **The checks disclose and the server refuses** — two gates is how one of
them becomes wrong, so only "filed against nobody" and "past the window" read
as blocked. **The platform never lodges**: AUSTRAC Online is the entity's own
account and this holds no credentials, said on the page rather than in a
tooltip. And **tipping off is guarded at the projection** — both
`CLIENT_RESTRICTED_KEYS` and `PARTNER_RESTRICTED_KEYS` already carry `smr`,
`austrac` and `suspic`, and a test pins them rather than trusting them.

The draft dialog now says **why**, and `austracDraftGuidance.pure.ts` is where
that lives: per obligation, what the report is for, when AUSTRAC must be
informed, what it is NOT for and where that belongs instead, and what the
narrative has to answer. Four rules. **It advises and never decides** — no
field is written from it, and a test rejects any sentence that could read as
permission to lodge nothing, while the narrative helper inserts QUESTIONS
into an empty box so nothing it produces can be lodged as an assertion nobody
made. **The tipping-off warning is in the main column and on the SMR alone**:
below `lg` the reference panel drops under the whole form, and a prohibition
on what an operator may say cannot be below the fold. **The stored kind is
translated, never used as a table key** — `reports.kind` accepts five values
and `AUSTRAC_OBLIGATIONS` is keyed by four (`compliance` and `annual` are one
obligation), so a raw read is `undefined` and the next property access is a
crash; `toObligationKind` returns null rather than guessing. And **an annual
report is not a customer report**: it accounts for the business's own
programme, so demanding a case left the customer check permanently blocked
and step 1 of the path unable ever to complete.

**Drafting is a PAGE now** (`/admin/aml/austrac/new`,
`/admin/aml/austrac/:reportId/edit`). A report to a regulator is the longest
single piece of writing in this product, written against a statutory deadline
over more than one sitting, and a modal cannot be deep-linked, reopened where
it was left, sent to a colleague or reached with the back button — and closes
on an outside click with whatever was typed in it. Four rules. **The path sits
UNDER the hub's**, because `pathMatchesWorkspace` matches a prefix plus `/`
and a page in no workspace draws no strip. **Saving hands the report back**
via `?report=<id>`, which is what the dialog's close did implicitly. **An
unsaved change guards leaving** — registered only while there is one. And the
hub's action is **"Start AUSTRAC Report"**: "New Draft" named the row it would
add to a table, not the act. `AUSTRAC_KIND_LABEL` and `draftSectionsForReport`
are in the pure module because both were about to exist twice.

Three things the page itself got wrong. **A customer is typed, not scrolled**
— the field was a drop-down over every open case, so `caseSearch.pure.ts` now
holds one matching rule that the Compliance Passport register uses too (its
filter MOVED rather than being copied): every word must match and they may
match different fields, and a reference matches with or without its
punctuation. It filters the list already loaded and never queries on a
keystroke. **There is no character floor** — a 200-character minimum rendered
as `298 / 200 characters`, which is the shape of an overrun on the one field
where running out of room would be serious, and AUSTRAC sets no threshold;
`narrativeIsWritten` replaces it and the per-obligation questions under the
box are the guidance on substance. And **the label was sitting on the box**:
it shared a `flex items-end` row with that counter, which is what put its
descenders on the textarea's border.

Three more, from the hub beside it. **The "Bundle" download was a debug dump**
— `JSON.stringify` of the export, named by uuid, opening in a text editor —
and is now a PDF drawn by the SAME renderer and brand resolver as the client
submission record (`austracBundleRecord.pure.ts` projects onto
`SubmissionRecord`), issuing under the workspace's brand or the **Aurixa
Systems** fallback; the tipping-off prohibition travels IN the document and
on the SMR alone, and `RecordDocumentIdentity` became a defaulted parameter
because the renderer wrote "Submission v1" across every page it drew.
That record was correct and thin, and its first production render is the
document this rework is measured against: it opened on a field list, said
nothing about what OBLIGES the report, carried the MLRO decision only as a
version-table note reading "MLRO sign-off", said nothing about what was still
outstanding, and printed page two **blank apart from the colophon** — which
pinned itself to the foot of a fresh page whenever the content overran. It is
arranged as a story now (handling restriction, obligation, report, narrative,
pre-lodgement checks, approval, lodgement, receipt, versions, integrity) and
**nothing in it reads anything new**: the prose is `AUSTRAC_OBLIGATIONS` and
`KIND_GUIDANCE`, the checks are `austracReadiness` — the module the register
already renders — and the approver is read from the version row the sign-off
writes, because `mlro_signed_by` is an id with no label. Five rules carry it.
**The s.123 prohibition is met BEFORE the document is acted on and stated
once** — it was 8.5pt grey at the foot of the last page, where a reader who
has already forwarded it arrives; a test pins the rule (present, first,
exactly once) and not the field. **A lodgement is never asserted to have met
the deadline** — `submitted_at` says a report went, not that it went in time,
so the Deadline line compares against the due date. **An empty field is
omitted rather than printed as a dash** (two of eleven first-page rows carried
no fact). **The uuid leaves the body and stays in the running foot** — it
means nothing to any party the record is for, while the hash stays WHOLE
because truncating it destroys the only thing it is for. And **a colophon pins
to the foot only when it fits**, or an overrun buys a blank sheet with a
footer on it.
**A dead control is worse than no control** — the path card drew "Open" on
the open step while the page handled three of six keys, so a saved draft's
step 3 did nothing; it takes `stepActions` now, a step with no entry draws no
button, and step 3's act is `upsert_report` with `awaiting_mlro` (an existing
status the server already permits). And **the selected row needs more than a
tint**: `bg-muted/40` on a dark theme is the charcoal beside it, so selection
is an accent bar, a ground and the word "Viewing", with `aria-selected` and
keyboard operation — while badge COLOUR marks only the SMR, because
`--primary` and `--warning` are both gold in dark mode and five tones carried
no information at all.

The path is **five steps, not six**. "Clear the pre-lodgement checks" was a
HAND-OFF — it completed by moving the report to `awaiting_mlro` — and on an
entity where the drafter IS the MLRO that is a report sent from somebody to
themselves before they may act on it; strip the routing and it counts the same
fact as the approval beside it, and **two steps counting one thing** is how a
header disagrees with the list under it. They are one step now, "Review the
checks and approve it". **Removing a ceremony must never remove a control**:
`mlro_signoff` is untouched, `awaiting_mlro` still exists and still signs off,
and the hand-off's confirmation MOVED onto the approval — excluding the checks
the approval itself unlocks, and reading the same `factsFor` projection the
card does, because the table's button acts on a report that may not be the
selected one. An open step with no action now renders **whose** it is, because
a live step with neither an act nor an explanation reads as a broken page.

**The whole process happens in the report now.** Approving from a register row
asks somebody to authorise a document they are not looking at, so Stage 3's
button OPENS the report — checks, narrative and approval on one screen — and
approving there returns to the hub with the lodgement step open. Five rules.
**The approval saves first** (the MLRO approves what they are LOOKING AT; the
button says "Save and approve" while there is an unsaved change), and a report
past the draft statuses renders READ-ONLY with the reason rather than a form
whose Save the server answers 403 to. **One guard, asked from both surfaces** —
`approvalConfirmation` is in the pure module because two copies of "what is
still owed" is how one screen warns about something the other does not. **The
checks LEAD the card**, because they are what an approver must read and they
sat below what they were asked to do; and **no step may describe its own
position** (`above`/`below` are rejected by a test — the same text is drawn on
three screens and the checks sit differently in each). **The AUSTRAC Online
door is inside step 4**, with the statement that the entity lodges through its
own account and this product holds no credentials. And **the path is drawn once
per screen**: the draft rail's orientation list is suppressed exactly when the
live card is mounted.

Two more from the register. **The title opens the report** — "Edit" was
offered on a draft alone, so a submitted report could be selected and never
read; it is safe on every status because the page renders read-only where the
server would refuse a write (and stops calling itself "Edit"). And
**archiving is putting away, never throwing away**: `delete_report` refuses
anything past a draft because a lodged report is a retained record, so
`archived_at`/`archived_by` hide a row and keep every byte — row, versions,
submissions, receipts, case events — reversibly. The rule it turns on is that
**a report may be archived only once nothing is owed to AUSTRAC**
(`archiveBlockReason`, in `_shared`, rendered by the register and enforced by
the function): hiding an approved-but-unlodged SMR loses a statutory deadline
rather than tidying a list. Three things follow — a lodged report with no
receipt archives but the confirmation SAYS so; `upsert_report` must strip the
stamp or a client archives by saving; and the tiles count the working
register, because a number beside a row nobody can see is worse than none. Choosing
is explicit — a checkbox per archivable row and a select-all that reads the
same `archiveBlockReason` the server enforces, so a checkbox can never pick a
report the archive would refuse — and **undo is part of the act**: the inverse
call is offered on the toast, on exactly the rows that succeeded and with no
second confirmation, because undoing is not a new decision and a bulk archive
is where a mis-click costs most.

## The photograph on the Compliance Passport
Read [`docs/aml/PASSPORT_IDENTITY_PORTRAIT.md`](./docs/aml/PASSPORT_IDENTITY_PORTRAIT.md)
before touching `_shared/aml/passport/identityPortrait.pure.ts`,
`storeIdentityPortrait`, `attachPortraitUrls` or the object list in
`aml-idv-retention`. A Passport that proves an identity was verified and shows
no face is a certificate, so the booklet carries one image — and **which one is
the whole question**. Three exist and this deployment holds all three
(`didit_standalone` uploads the customer's capture to our own buckets): the
**`id_portrait`** the provider extracted from the document, the document page
itself, and the selfie. Only the first may travel, because a face crop carries
**no document number, no MRZ, no date of birth, no address and no signature**;
the page carries all of them and stays staff-only. The rule is an **allow-list
of exactly one key**, and `WITHHELD_CAPTURE_KEYS` names the other two rather
than leaving them absent.

**It sits on the Client Identity page, and the mount always draws.** It was
first put on the Identity Verification leaf behind
`.filter((p) => p.portrait)`, which meant two things and both reported as "I
cannot see the photo of the client anywhere": it was not on the page that
names the holder, and the block DISAPPEARED whenever no image was stored —
which is every Passport issued before this — so the page could not be told
apart from one that carries no photograph at all. `identity.portrait` is a
**slot**, never null, and names which of three absences it is; the wording is
about the RECORD and never about the customer, asserted by a test.

**A portrait that was never stored is fetched automatically, exactly once.**
The document page is still in NPC's bucket, so `backfillIdentityPortrait`
re-derives the crop from it — on the one-minute sweep that already exists,
never from a button. A first attempt put "Recover the holder's photograph" on
the page and that was wrong: **asking an operator to click once per case is
asking them to fix this product's own record-keeping bug by hand, for ever**,
and it makes a Passport's completeness depend on whether anybody opened it.
Five rules carry it. It **re-derives an image and never re-decides an
identity** — no status, verdict, score or timing is written, and a re-read
that disagrees with the recorded verdict is logged for a human rather than
adopted. **One attempt, ever**: the `portrait_backfill` stamp is written
whether the call succeeded, failed or produced nothing, and its PRESENCE is
the guard, never its outcome. **Nothing is stamped where nothing was spent**,
so a database fault or an unconfigured provider does not disqualify a check
permanently. The pass runs only when **the live verification queue took
nothing this tick**, and it is **bounded at two a tick** so a backlog drains
without a burst of spending. `pending_retrieval` and `unavailable` are
separate readings on the page, because "on its way" and "the document carried
none" are not the same thing to a reader.

**The object list was written twice, and every reader took the stale copy.**
That is the fault that survived three otherwise-correct attempts: the
portrait was uploaded, named by the capture plan and on the retention job's
list, while `sa.capture_objects ?? plan.objects` — four hand-written copies of
one expression across two edge functions — read the evidence block's copy,
which is composed once at the end of a run and never updated.
`captureObjectsFor` is the one reader now and **merges rather than choosing**
(the plan wins key by key, the legacy copy is a floor), the run no longer
writes the duplicate, and a test forbids naming `standalone.capture_objects`
in code. `attachPortraitUrls` is likewise one shared module rather than
twenty duplicated lines in each portal.

Nothing new is fetched — the portrait is already extracted as the Face Match
reference and was simply discarded. Three rules make storing a face safe. **It
is deleted on the same clock as the captures**: `aml-idv-retention` enumerates
FIXED keys, so a new object is invisible until named, and the capture plan is
re-persisted during processing because the job reads `standalone_capture`
rather than the evidence block. **Storing it can never fail a verification** —
null means "no portrait", which is the ordinary state for every case recorded
before this, and every surface renders unchanged on null. And **the URL is
minted for one reader at the moment of service**: a signed storage URL is a
bearer credential with a lifetime, so the projection carries a descriptor
(`url: null`) and the edge function signs five minutes for the request that
asked. It cascades to the client, the emailed link and the partners because
`buildCasePassportView` is one assembler with an audience parameter.

## Stage 10 — ongoing CDD, and the reminders it raises
Read [`docs/aml/ONGOING_CDD_AND_REMINDERS.md`](./docs/aml/ONGOING_CDD_AND_REMINDERS.md)
before touching `_shared/aml/reviewSchedule.pure.ts`,
`_shared/aml/complianceReminders.ts`, `armOngoingCdd` in `aml-reliance` or
`src/lib/aml/displayDate.ts`. Three things, and each was invisible.

**Dates took the reader's machine.** `toLocaleDateString()` with no locale
printed `8/29/2029` for an Australian reporting entity — 779 call sites across
230 files, now on the `en-AU` the rest of the product already used explicitly,
with `AU_LOCALE` the one place it is named and a test that fails any
un-localed formatting in AML.

**The review cycle was written twice and defaulted to three years.**
`DEFAULT_REVIEW_INTERVALS` served scheduling and the sweep; an inline copy
thirty lines away served `complete_review`, so completing a review booked the
next one on a cycle the rest of the product had stopped believing in. One
module now, and the programme's policy is **at least annually** — AUSTRAC
fixes no interval, so it is a parameter and this is where it is stated. Two
rules: a rating may make the cycle TIGHTER and never longer (`prohibited`
stays at 3 months), and **the ceiling binds a configured interval too**, with
the clamp recorded rather than silently applied.

**A scheduled review reached no reminder list in the product.** It lived in
`existing_customer_reviews` and on one card; the Reminders hub reads
`client_reminders` and knew nothing of it. `complianceReminders.ts` writes
there — a second reminder system is how two reminder systems disagree —
idempotent by `source_ref`, never the record, and it **never fails the act it
accompanies**. `reminder_type` is CHECK-constrained, so the AML kinds had to
be added to the column or every write would have been rejected there while
looking, from the function, exactly like a write nobody attempted. And
**issuing the Passport arms ongoing CDD**: `armOngoingCdd` books the first
review, never moves one that exists, and never fails the issuance.

The rail's "Advance status" card is **gone from every stage**. On a cleared
case it offered "Under review" behind an OPTIONAL reason, and one click
regressed the stage, the client portal and the service gate — flipping a live
Passport to "Refresh required". It was suppressed on the two post-decision
stages first, but the reason was never local to them: **a case's lifecycle is
the consequence of decisions that carry their own recorded reasons**, so a
rail control restating them as one-click buttons was a second way to do
something the product already had a place for.

**Removing a ceremony must never remove a control**, so every state it could
reach still has one, and a test checks rather than trusts that: `cleared` /
`blocked` / `escalated_mlro` are the Decision stage's, `kyc_*` are moved by
the client's own submission, `under_review` is deliberately not offered, and
**`closed` moved to the case header** — which is where the panel's own comment
had always claimed it lived while nothing there did it. Closing asks for a
reason it will not proceed without, is offered only to a writer, and never on
an already-closed record. `AmlContextActionPanel` is now the closed-case
notice and the authorised reopen, nothing else. Hiding a button was never
authorisation: `transition` is untouched and the server enforces exactly as
before, and the legacy case dialog — the rollback path when the workspace flag
is off — still carries the panel it always had.

## Stage 5 — the guided path
Read [`docs/aml/STAGE_5_GUIDED_PATH.md`](./docs/aml/STAGE_5_GUIDED_PATH.md)
before touching `screeningSteps.pure.ts`, `ScreeningPathCard`,
`pepDeclaration.pure.ts` or the political-exposure question in the client
portal. Stage 5 had every fact it needed and no ORDER: on the reported case the
whole screen reduced to one act, and "Record PEP determination" appeared four
times in four sets of words while everything else was already settled. The path
arranges the same server-decided facts as numbered steps with one of them open.

Four rules carry it. It **derives nothing new** — every obligation, method and
outcome comes from `buildDeterminationRows`. **`not_required` is not `done`**:
a step nobody owes settles the path, renders `—` rather than a tick, and says
nobody was screened and nobody was cleared. **The server owns "what next"** —
`next_action` decides the open step whatever the local ordering would say. And
**a candidate is not a finding**: `path.finding` is a confirmed match alone.

The customer's own political-exposure answer now travels to the person who has
to decide (`pep_declaration` on the stage sync), because it previously existed
only as `personal_details.pep` in the policy's material inputs. **A declaration
is evidence and never a determination** — the stored answer is still `yes`/`no`
so no policy reads anything new, an unanswered question reads as unanswered
rather than as a "no", and a corrected answer's detail is pruned at the write
boundary. `record_pep` was also missing from the reviewer-or-MLRO list, so an
analyst was offered a button `record_pep_determination` answers with 403.

## The PEP determination — what it rests on
Read [`docs/aml/PEP_DETERMINATION_EVIDENCE.md`](./docs/aml/PEP_DETERMINATION_EVIDENCE.md)
before touching `_shared/aml/pepEvidence.pure.ts`, `pepSearchLinks.pure.ts`,
`PepDeterminationDialog` or the `record_pep_determination` /
`defer_pep_determination` operations. Sanctions is a **match against a
register**; a PEP determination is a **conclusion a person reaches** on
reasonable grounds, and there is no register that settles it — so the record
has to show the sources checked, what was searched and what came back. The old
flow was a prompt with two free-text boxes that had already chosen the answer
before it opened.

Three rules carry it. **A sanctions register is not a PEP source** — the
dialog's own worked example was the DFAT consolidated list, and absence from a
sanctions register is not evidence that somebody is not politically exposed;
the asymmetry is why a HIT is surfaced as a signal while a MISS says nothing,
and `sanctionsSignalForPep` is deliberately silent for "screened, no match".
**One rule, rendered and enforced** — `assessPepEvidence` is the module the
dialog renders from and the edge function enforces, so what an operator is
asked for and what the server accepts cannot become two standards; above the
statutory floor it requires one source independent of the customer and a
recorded result for every source searched. And **a deferral is not a third
outcome**: `defer_pep_determination` writes no determination row, stamps the
event `determination_recorded: false` and leaves Stage 5 open, because forcing
an operator to pick "not a PEP" to close a dialog is how an unfounded
conclusion gets written down.

The assisted search **builds URLs and nothing else** — no request, no result,
no decision. Nothing in it can return "no match", because a partial index
reporting "no match" is the confident-clear-against-nothing failure this
platform has already had once. What the public sources do not reach (foreign
office holders, family and close associates, somebody who has left a post) is
rendered beside them every time. `holds_position_currently` is an attribute of
the determination and never a softer outcome: leaving office is a risk
assessment, not an expiry date.

## `aml.cases` has no `tenant_id` column
Read [`docs/aml/CASE_TENANT_COLUMN.md`](./docs/aml/CASE_TENANT_COLUMN.md)
before adding any `.select()` against `aml.cases` or touching
`_shared/aml/caseTenant.ts`. Eighteen call sites across five edge functions
selected a column the table has never had; PostgREST answers **42703**, the
discarded `error` leaves `data` null, and twelve handlers then reported
**"Case not found"** about a case the operator had open. That is why
`pep_determinations` was EMPTY from the day it was created, why Stage 5's
"Record PEP determination" appeared to do nothing, and why the rail said
"monitoring summary could not be read".

Three rules. **Never name a column the table does not have** — `readCase()`
throws on `tenant_id` where a developer sees it, and a contract test scans
every function. **A read that FAILED is not a row that is ABSENT**: a missing
case is 404 and final, a failed read is 503 and worth retrying, so `CaseRead`
carries `failed` separately from `row`. And **the tenant is a property of the
deployment** — every `tenant_id` in the schema is `default`, which is exactly
why `cases` has no such column; `tenantForCase()` is the one place that knows
it.

**That class was not confined to `aml.cases`.** A sweep of every literal
`.select()` and inline `.insert()`/`.update()` across `supabase/functions/`
found **fifty-eight more** in eighteen functions, and every one reported as
normal, empty operation: `secure-storage` selected
`investment_reports.client_id, created_by` (they are `client_property_id` and
`generated_by`) and refused every human upload 403; `dispatch-marketing-reports`
read a contact name and email off `ghl_client_opportunities`, which has neither,
so the scheduled dispatch resolved no recipients at all;
`market-updates-embed-backfill` asked for `market_updates.summary` (it is
`ai_summary`) and had therefore never embedded a single update;
`agent-insights-runner` filtered `client_deals.assigned_user_id`, a column that
does not exist, so no stale-deal or settlement insight was ever raised; and
three administrator authorisation fallbacks read `custom_users.role_display`
(it is `role`) and so could never grant. `check-edge-column-names.mjs` fails CI
on any new one. Two rules make it trustworthy: **the schema is the generated
types UNION the migrations** — `types.ts` is regenerated by hand and goes
stale, so judging against it alone reports real columns as missing — and **only
a literal column list is judged**, because a payload assembled in a variable is
not a set of names anything can read.

**An identifier that does not exist is never type debt.**
`defer_pep_determination` called `appendCaseEvent` when the helper is
`appendEvent` — the module LOADS, serves every other operation, and throws a
ReferenceError on one branch. A count baseline can absorb that (one goes, one
arrives, the number holds), so `TS2304`/`TS2552` are now fatal in
`check-edge-functions.mjs` and the pre-existing occurrences are frozen in
`edge-missing-names.txt`, keyed by file and identifier rather than by line.

## The PEP screening engine
Read [`docs/aml/PEP_SCREENING_ENGINE.md`](./docs/aml/PEP_SCREENING_ENGINE.md)
before touching `_shared/aml/pepScreeningEngine.pure.ts`, `run_pep_screening`,
`PepScreeningRunPanel` or `pepSearchLinks.pure.ts`. It replaces five browser
tabs — two of which were wrong: the Government Directory link was a Drupal 7
path the site no longer serves, so the most authoritative source answered
"Page not found" every time, and two of the five rows were a search engine
sitting beside DFAT as though it were a peer.

**It screens; it does not determine.** The verdict vocabulary
(`indicators_found`, `no_indicators`, `incomplete`, `not_searchable`) shares no
value with `pep_determinations.result` — no `clear`, no `not_pep` — and both a
test and the security gate assert it. `no_indicators` is drawn neutrally and
says it is a result about the SEARCH; a register that FAILED is never reported
as one that was empty; and anything unreached forces manual review, including
an unanswered declaration, because no register here publishes family members or
close associates.

**Every source is local, and that was measured.** Wikidata's action API answers
429 from this egress, its SPARQL endpoint 504 on a worldwide walk, and
directory.gov.au and aph.gov.au both 403 a scripted client. A compliance
decision cannot depend on somebody else's rate limiter, so registers load on a
schedule and are read locally at decision time. The two that a server cannot
reach are NAMED as unsearched rather than omitted. A candidate rejection must
say how it was told — enforced at the column, the endpoint and the button.
Foreign office holders are deliberately still a gap the engine discloses.

## The public office-holder index
Read [`docs/aml/PEP_OFFICEHOLDER_INDEX.md`](./docs/aml/PEP_OFFICEHOLDER_INDEX.md)
before touching `_shared/aml/pepOfficeholderIndex.pure.ts`,
`scripts/aml/load-pep-officeholders.mjs`, the `search_pep_officeholders`
operation or `PepOfficeholderIndexPanel`. It is the second register this
platform loads and **not the same kind of thing as the first**: a sanctions
match is an outcome, an index hit is a lead.

**A hit is a candidate; a miss is nothing** — and the worse failure is not the
empty reading but the OVERSTATED one. The first load walked a subclass tree
from an entity that is itself an office, wrote 1,254 people across two, and
the product told operators it covered ministers, judges and every state.
Offices are found by jurisdiction (`P1001`) now, coverage prose carries no
numbers at all (a test asserts it), and everything countable is measured by
the loader into `pep_officeholder_syncs.detail` and rendered from there.
`pep_type` is left NULL because the AUSTRAC category belongs to the
determination, not the index. The endpoint also fails by lying — 200 with the
JSON cut off at its own 60s limit — so the query groups server-side, reads
offices in batches, and names an unparseable body a truncated download.

No public source lists every
prominent public function and none lists family members or close associates,
so the danger is also the EMPTY reading — zero rows for somebody the index never
covered looks exactly like zero rows for somebody who holds no office, which
is the shape `sanctions_entries` already shipped once. So `searchVerdict` has
four readings and a test asserts none can be paraphrased into a clearance;
**coverage travels with every result including the empty one**; an index that
never loaded or whose latest load FAILED reads as `unavailable` rather than as
no candidates; and a database fault answers 503 rather than "nothing found".

Two more rules. **The index is never the source** — every row carries a
`confirm_url`, the panel says the source is collaboratively edited, and
`candidateToMethodDraft` leaves `result` EMPTY so the operator writes what they
saw when they confirmed it against the official register. And **normalisation
is server-side, always**: `normalised_names` uses the same `normaliseName` the
query does, imported rather than re-implemented, and a row with no searchable
tokens is refused by the loader and by a column constraint. The loader repeats
every rule the sanctions loader learned the hard way — refuse a zero-entry
parse, treat a shrink as a truncated download, name `sync_id` in the prune's
RETURNING projection, and pin Node 22.

## AML screening scope
Read [`docs/aml/SCREENING_SCOPE.md`](./docs/aml/SCREENING_SCOPE.md) before
touching `deriveScreeningScope`, `reconcileSubjectToScope` or the
`case_screening_scopes` / `case_screening_perimeter` tables. Every scope is
decided independently, so sanctions can be `not_required` while PEP stays
mandatory. **The only lever that reaches sanctions is the PERIMETER, never the
risk rating** — targeted financial sanctions bind every dealing under the
Charter of the UN Act 1945 and the Autonomous Sanctions Act 2011, so a test
asserts no reason code can even be spelled in terms of risk; what can be true
is that a case is not a dealing (an enquiry, a duplicate, a service declined
before it commenced).

Three rules bite. The perimeter is **recorded by a reviewer or MLRO, never
inferred** — nothing in the schema says whether a designated service is
provided, and the default is always INSIDE, so an unclassified case, an
unknown reason code or a finding that excludes nothing all resolve to
sanctions required. **`not_required` is not `clear`**: it means no obligation
arose and nobody was screened, and the client reading keeps `notRequired`
separate from `resolved` so it can never render as a result. And **readiness
is a property of a scope** — `provider_relevant` is the second question, so an
unloaded DFAT list is irrelevant to a case with no sanctions obligation rather
than a blocker.

## Stamp duty
Every duty figure in the product comes from `supabase/functions/_shared/stampDuty/`
and nowhere else; `src/utils/stampDutyCalculator.ts` is a one-line re-export.
Read [`docs/reports/STAMP_DUTY.md`](./docs/reports/STAMP_DUTY.md) before changing
a rate — it records the four divergent implementations this replaced (and what
each got wrong), the third-party iframe it retired, and the handful of published
quirks that look like bugs and must not be "fixed": VIC steps **up** at $960k,
the ACT steps **down** at $1.455m, and NT is quadratic below $525k. A rate change
is a data edit in `schedules.pure.ts` plus a regenerated seed — never a hand-written
one. The weekly sweep flags stale schedules and **never writes a rate**; the doc
explains why that asymmetry is deliberate.

## Stamp duty
Every duty figure in the product comes from `supabase/functions/_shared/stampDuty/`
and nowhere else; `src/utils/stampDutyCalculator.ts` is a one-line re-export.
Read [`docs/reports/STAMP_DUTY.md`](./docs/reports/STAMP_DUTY.md) before changing
a rate — it records the four divergent implementations this replaced (and what
each got wrong), the third-party iframe it retired, and the handful of published
quirks that look like bugs and must not be "fixed": VIC steps **up** at $960k,
the ACT steps **down** at $1.455m, and NT is quadratic below $525k. A rate change
is a data edit in `schedules.pure.ts` plus a regenerated seed — never a hand-written
one. The weekly sweep flags stale schedules and **never writes a rate**; the doc
explains why that asymmetry is deliberate.

## The three numbers a client acts on
Read [`docs/reports/DERIVED_FIGURES.md`](./docs/reports/DERIVED_FIGURES.md)
before touching `_shared/reports/metrics/propertyMetrics.pure.ts`, the yield or
LVR detectors in `factReconciliation.pure.ts`, or any inline yield/LVR
arithmetic. Gross yield, net yield and LVR are derived — the record contains
none of them — and **nothing in this product had ever compared a number**:
`runQAValidation`'s seven rules are page band, keyword presence, placeholders,
editorial labels, duplicate headings and section counts, every one structural.

The finding that shaped the fix: **the divergence was mostly not a bug.** Six
gross-yield sites, four net, eight LVR — but `liveProjectionRow.ts` divides the
settlement loan by the purchase price while the strategy surfaces divide the
remaining balance by today's value, and those are *different quantities*
(origination LVR, current LVR) that coincide only at settlement. Collapsing
them onto one definition would have destroyed a real distinction and silently
changed documents. So **basis is part of the call**, never a default, the
answer carries its basis back, and `labelFor` prints "Gross yield (on purchase
price)". Two rules travel with it — **absent is never zero** (84 of 1,072
stored reports print a `0.00%` yield, because the rent was unknown) and **net
yield is unlevered while cash-on-cash is not**.

Three rules bite in the reconciliation. **Tolerance is absolute for a
percentage** — a 2% relative band on 4.83 is ±0.097, which rejects the ordinary
rounding "5%" — so yields carry 0.25 points and LVR 0.5. **A verb may never
introduce the number**: 543 of 2,153 gross mentions are a working column
(`| Gross Rental Yield | $33,800 ÷ $700,000 × 100 | 4.83% |`) so the pattern
must cross arithmetic, but the corpus long tail read "gross rental yield
provides substantial buffering against interest rate increases. A 1%" as the
figure, so the value must arrive through a delimiter or sit adjacent to the
label. And **LVR refuses the value-after-label form altogether** — `LVR, 6.5%`
and `LVR at 6.5%` are the interest rate, `banks cap LVR at 95%` is policy, and
`| Final LVR | 52% |` is the correct CURRENT LVR at year ten; admitting only
value-first and structurally-connected forms doubled coverage and cut
disagreement from 22 of 57 reports to 10 of 115.

Those 10 are one real defect and it is not the model's: **21 stored reports
contradict themselves**, carrying a deposit at one LVR beside a loan at
another — on one, the two lines exceed the purchase price by $67,200 while the
customer's own override names the right loan — after which the analysis says
"90% LVR" up to twelve times because the loan block is what it was handed.
`derivedFigureDefinitions.spec.ts` is a **ratchet, not a ban** — 22 modules, 53
inline definitions, frozen — because most of the copies are the real
distinction above and what needed fixing was the slope.

Both of those were then fixed at the cause, and §5–§6 of the same doc carry
them. **There is one rent** (`rentalEvidence.pure.ts`): the generator resolved
it twice, and the SQM lookup landed in a variable scoped INSIDE the enrichment
block, so 83 reports printed `0.00%` beside projections built on a real rent —
and the scoring service, handed the same zero, scored the property as earning
nothing. Where no rent is established every figure derived from it is now
absent, and the prompt forbids an estimate while still permitting qualitative
discussion, because a prohibition with no permitted action is one a model
routes around. Two rules bite: **arithmetic keeps its zero** (management fees
are a percentage OF the rent) so only what a reader is *shown* changes, and the
**`%` sign lives inside the formatter**, since every call site read
`${preCalculatedGrossYield}%` and a null there prints `null%`. The yields keep
their `.toFixed(2)` rather than adopting `propertyMetrics` — measured over
2,207,223 pairs the two roundings disagree on 2,763, so unifying them would
shift 0.125% of documents by a hundredth for nobody's benefit.

**The finance identity is healed on READ, never migrated.**
`healFinanceIdentity` lives in `reconcileStoredFinancials`, which the register,
the PDF renderer, the comparison and both projections already call — so all 21
rows repair for every reader with no migration and no stored byte overwritten.
**`keyMetrics.lvr` is the arbiter**: whichever of the deposit and the loan
agrees with it survives and the other is re-derived, and where neither agrees
nothing is healed, because a repair that cannot say which figure is sound is
just a third opinion. Verified on all 21 — 17 heal the loan, 1 the deposit, 3
left alone; of the 13 with an independent witness, 13 agree and none
contradict. Placement is load-bearing: **after** the series heal (the ROI
denominator is the stored deposit) and **before** the upfront total (which is
the deposit plus the acquisition lines).

## What a report may state about the market
Read [`MARKET_FIGURES_IN_THE_REPORT.md`](./docs/reports/MARKET_FIGURES_IN_THE_REPORT.md)
before touching `_shared/reports/market/marketFactBlocks.pure.ts`,
`enhancedData.marketEvidence` or the market block in `pinnedPlanningContext`.
`MarketEvidence` reached the SCORING SERVICE and nothing else — the generator
built `marketPoints`, posted it, took the grade back, and **no prompt was ever
handed a median**. So the prose supplied its own: 18 Annabelle Crescent stated
a $1.96m suburb median, a "high-$1.8m to ~$2.0m" range, "high-$700k to
low-$800k" unit medians, "$900" median weekly rent and "low single digits"
growth, while `market_fact_snapshot` holds 27 ABS and RBA facts and **not one
market price**. Same shape as the planning defect: the service answered (growth
scored 56 at confidence 81 from that very register), the answer was used for
the grade, and the section that needed it read none of it. **The grammar is the
tell** — *is consistently reported*, *data sets report*, *is called*: an
agentless passive is what a sentence uses when it has no source to name, and
the rule now names those constructions. Four more rules. **A licence decides
what a client is shown**, applied at the producer because downstream is a model
— a Domain point scores the grade and is named on the page as held and not
published, a third state distinct from never measured. **A benchmark is drawn
apart**, under a heading saying it describes a different geography, because a
state figure beside a suburb one reads as the suburb's. **An absence says which
kind**: asked-and-could-not-answer carries the provider's reason, never-held is
a list. And **nothing there is a valuation** — "below the median" is forbidden
by name, because that comparison was the Executive Verdict's central claim. Two
things beyond the module: the evidence is assigned to `enhancedData` **before**
the scoring call (a scoring failure must not take it with it, and the resume
worker needs it), and it **rides the pin** so `limitPromptContext` cannot cut
the authority while leaving the rule.

## Each report has one purpose, and one module decides it

Read [`docs/reports/TIER_FRAMEWORK.md`](./docs/reports/TIER_FRAMEWORK.md)
§ Decision E before touching `_shared/reports/investment/tierContent.pure.ts`,
the financial pages in `scripts/template-library/investmentCompass/templates.ts`,
`extractKPIMetrics` or the `financials` block in `reportBindingProjection`.
`compassSectionRegistry` has said since v2.0 that **ALL detailed financial
modelling lives in the separate Financial Analysis Report and MUST NOT appear**
in the Compass, and the generator obeys it — the prose a model writes for a
Compass has no financial section in it. The document a client opens led with
three pages of it, because the rule was enforced on the PROSE while THREE
implementations decided what a document draws and none read the registry: the
standard renderer read the tier for the document's LABEL alone, one master page
sequence served all five tiers, and the frontend band had had its own
tier test removed for a different defect. So the Compass opened on purchase
price, gross yield, LVR and a ten-year equity projection while the Financial
Analysis carried the location case — each report answering the other's
question. The authority is in the PROJECTION, because that is what every
template binds: withholding a namespace once reaches all 500 seeded masters,
every future one and both routes, while a fix inside one composer reaches one
composer. Three rules. **A tier is a PURPOSE, not a length** — the test of the
split is whether a reader could name the document from its contents page.
**Withholding the modelling is not withholding the price**: the asking price
and the indicative rent are facts about the asset the way its land size is, and
stay on every tier; what leaves is the analysis of a PURCHASE. And **the drop
has to be clean** — the projection withholds the bindings AND the three master
pages carry `conditional: report && report.drawsFinancialModelling`, because a
page kept with nothing to bind prints labelled empty rows. `renderKpiGridHtml`
and the `toc` block needed no change: one already drops a tile whose bound
value resolved to nothing, the other reads the pages that actually rendered.
The one escape is `projectInvestmentReport(row, { tier })`, for the condense
fork alone: **the document being PRODUCED decides**, and keying it on the row
being READ would hand a Snapshot's prompt a Compass parent with no modelling in
it. Shipped as seed **v14** plus the active-master refresh.

## The Compass prompt was 96% a different report

Read the header of
[`_shared/reports/investment/compassDocumentContract.pure.ts`](./supabase/functions/_shared/reports/investment/compassDocumentContract.pure.ts)
before touching `propertyPrompt` or the evidence pack under it. Measured
17 Sep 2026: `propertyPrompt` was 79,603 bytes and **76,415 of them (96%) were
the legacy 38-page reference template**, carried verbatim under "MANDATORY
REPORT STRUCTURE — 38-PAGE REFERENCE TEMPLATE / YOU MUST FOLLOW THIS EXACT
STRUCTURE, LENGTH, AND FORMAT". The property's own facts were the other 3,188.
That template declares 27 sections including *Purchase & Ongoing Costs*,
*Rental Assessment & Yield Calculation*, *Loan Structure & Repayment Analysis*
and *Sensitivity Analysis* — the modelling the Compass is defined by not
carrying — demands "12,000-15,000 words minimum" against a registry capping the
document at 5,010, is written as fill-in-the-blanks (`[Suburb name] is a
[description] community located [XX] kilometres`), and its point 8 instructs
the model to "Include [citation] markers" while another line of the same prompt
forbids them and a regex downstream strips them. `generateReportSection` trims
head-tail, so **both ends of every trim were legacy**: about 53 KB of the wrong
contract on each of eleven section calls, which the model resolved by writing
the requested section in the legacy template's habits. Two rules. **The
contract is about METHOD, never structure** — the registry owns the structure,
and two statements of one structure is how the two come to disagree. And **a
prohibition with no demonstration of the permitted form is one a model routes
around**, so the contract carries three worked examples (thin, substantial,
invented) and says why the invented one is dangerous: the reader cannot tell it
from the good one. The same lesson twice over — the `{{bars}}` primitive's own
documentation called it "perfect for scorecards" over a worked example minting
five ratings out of ten, which is exactly what the model produced once the
narrower `{{gauge}}` rule pushed the invented scorecards out of the gauge. **A
rating you invented may not be drawn in ANY primitive**; `bars`, `heatmap` and
`radar` are judged where the directive declares `max=100`, measured at 383 of
611 with no legitimate counter-example in the 25 most frequent titles.

## The Compass has room for what it retrieves (v4.0)

Zoning had **no section**. `Zoning` and `Planning` were sourceHeadings of the
RISK DASHBOARD — a 500-word table whose own purpose says "the table IS the
section — no prose restating rows" — so a retrieved planning control had
nowhere to be explained and the reader got a row. That is most of what "the
Zoning, Planning and Infrastructure sections are simply not good enough"
describes. The legacy long-form report ran to **~110,000 characters across 27
sections in one pass**; the 17 Sep Compass is 38,648 across 11. v4.0 is 8,150
words across 15 sections against a 34-page budget, and three sections are split
back out of merges that had put them where nothing could be said: Planning
(900 words), Transport (450) and Environment, Climate & Safety (650). **The
v3.0 merge was right for the reason it was made** — those sections repeated
each other — and what changed is that there is now a register behind each: a
constraint register with per-control explanation, 185,177 GTFS stops, four
states of recorded crime. A section with nothing behind it should be merged; a
section with a register behind it should not. Two rules bite. **A heading
belongs to exactly ONE section** — listed in two it resolves to whichever comes
first and the other silently loses it, and `fork-investment-report` drops an
unmatched heading from both forks without saying so. And **`sectionRegistry`'s
DECLARED GAP for planning is closed, with its reasoning kept**: it said "the
record holds no planning data … the fix is upstream of the reporting engine",
which was true when written and was then fixed upstream; the strategic tier
keeps `producer: null` because a Due Diligence planning section also needs
title and easements, which no register here reads.

## What a report may state about planning, and what it may not
Read [`docs/reports/PLANNING_CONTROLS_IN_THE_REPORT.md`](./docs/reports/PLANNING_CONTROLS_IN_THE_REPORT.md)
before touching `_shared/planning/planningFacts.pure.ts`,
`_shared/planning/infrastructureEvidence.pure.ts`, the
`pinnedPlanningContext` in `generate-investment-report`, or
`dataSources.planning`.
**And the overlay registers were answering the whole time.** Read §8 of that
doc before touching `_shared/planning/planningConstraints.pure.ts` or
`planningControlGuide.pure.ts`. The module said "overlay mapping (heritage,
flood, bushfire, character, acoustic) is held in the council scheme and is not
retrieved by this platform" on every property in the country, from a premise —
*no integrated layer publishes overlays at a point yet* — that had never been
measured and is wrong for four of the eight jurisdictions. Probed from the
PRODUCTION egress on 17 Sep 2026, all HTTP 200, all open licence, no key: NSW
answers the LEP, the zone, the maximum building height in metres, the floor
space ratio, the minimum lot size, heritage, bushfire, flood, landslide, acid
sulfate soils and nine more **each with the legislative clause that creates it
and its own currency date**; Victoria's overlays sit on the SAME WFS endpoint
as its zones, one word different in the typeName; Queensland answers its
regional plan and priority living areas, flood hazard and 26 MSES layers;
Tasmania answers both overlay registers. Four rules. **A constraint is named
only where a layer named it.** **A layer that was never asked is evidence of
nothing** — coverage travels with the answer and an unreachable register
contributes none; measured, `layers=all` on the NSW Hazard service answers
`{"results":[]}` because ArcGIS reads `all` as all VISIBLE and that group is
hidden, an empty answer to a question nobody asked, which reads as a property
with no bushfire and no flood. **A value carries its unit, its instrument and
its clause** — `8.5` is not a fact. And **a retrieval is not information**:
`planningControlGuide` explains what each control obliges and what to obtain,
about the CONTROL and never the property, which is what lets it be written in
advance and still be true; a spec rejects any currency amount, percentage,
measurement or BAL rating in it. The legacy report is the benchmark for
structure and the opposite of it for provenance — **three copies of its own
zoning section, on one lot, in one document, disagree on every control**, and
one cites a New South Wales council for a Victorian property.

`planning-data-service` has worked since 2026-09-06 and the generator has
always stored its answer on `enhancedData.planningData` — **and the zoning
section read none of it**. On 262 Pallas Street, Maryborough the row carries
`spec_zoning` null, `spec_council` null and no `planning` source, while a live
call at that report's own coordinate answers `QLD` / `Fraser Coast Regional` /
`Maryborough` under CC BY 4.0 with an evidenced `none_at_point`. What the
reader got was 101 lines of prompt template — `[XX]%` site coverage, `[X]m`
setbacks, "Refer to LEP", "typically 450m²" — handed to a model with nothing
to fill it from, so **the model filled it**: 450 m², 8.5 m and 0.5:1 reached a
client's document, under New South Wales instrument names on a Queensland
property. Three rules bite. **A control with no source is never a number** —
every cell is a value with its provenance (publisher, licence, the
instrument's own currency date, the retrieval stamp, adopted vs draft) or one
of five named absences, and `not_served` / `not_integrated` /
`licence_restricted` / `none_at_point` / `unavailable` are five different
sentences. **An audited operator override outranks a layer and says so**,
labelled `operator_stated` rather than dressed as a published control. And
**a zone that admits a use is not approval for it**, so no development
potential is quantified and no uplift is stated. The infrastructure half
answers to the same shape: a project is named only where a register named it,
a status is the publisher's own word (an approval is never read as funding,
funding never as a start on site), a gazettal or determination is labelled as
a date something HAPPENED rather than a completion, and the coverage
limitation — council capital works, budget programmes, agency announcements —
is stated on a full list as well as an empty one.

**And an absence may not be RATED** (§9 of the same doc). The opposite of the
invented control, committed by the same document: `Infrastructure timing and
pipeline | **Low** | The absence of a named infrastructure pipeline in the
registers searched …`, chipped **Verified**. Every fact in that row is true and
the conclusion is unsupported three times — the `Low` is a statement about the
area drawn from the coverage of a search, three paragraphs under a sentence
naming council capital works and agency announcements as things the search does
not reach; the `Verified` is true of the layer reading and was written against
the rating; and Queensland's DA register was never "searched" and cannot be, so
the sentence misdescribes the report's own evidence. Three rules. **An absence
may not be rated** — `Not assessed` is the level, and never Low, Minimal,
Limited, Negligible or Favourable, and never a strength (an inference from the
area's general character is not a retrieval either). **An evidence note
describes the RETRIEVAL, never the conclusion beside it.** And **the two
absences are different sentences**: `none_at_point` is a register asked here
that holds nothing here, the other four are ways of never having asked, so
`RegisterReading` carries the distinction and the page prints "Searched,
nothing found." or "Not searched." The same gap existed one level down —
`planningFactBlocks` rule 4 closed the STATEMENT ("never write that no overlay
applies") and the model obeyed it, then rated `Environmental nuisance | Low`
from the same absence one row later. Three things had to be CHECKED rather than
assumed, because a rule that names a word is worthless if something deletes it:
the section registry offered only Low/Moderate/High (the two-contradicting-
prompt-blocks defect again, so it names `Not assessed` now in both mirrors),
`stripPlaceholderRows` deletes a row whose first value cell is a placeholder,
and `riskDashboardContract`'s `ASSESSED_ENTRY` does not match it — all three
pinned by execution.

**A total summed from part of a register is a FLOOR, and says so.** Read
[`DA_REGISTER_RECONCILIATION.md`](./docs/reports/DA_REGISTER_RECONCILIATION.md)
before changing `registerWalk`, `summariseDaRows`' class split or the pipeline
paragraph. Two readings of one register — 680 dwellings / $808,649,729 as the
report printed it, 1,410 / $1,175,556,030 now — reconcile exactly and into two
independent halves. Applying the OLD counting rule to the COMPLETE walk gives
3,442 and $2,364,004,211, so retrieval completeness is **+2,762 dwellings and
+$1.555bn** and the counting rule is **−2,032 and −$1.188bn**, which is the
amendments bucket to the dwelling and to the dollar. Geography, window and
publisher are identical. **The larger half is completeness, not definition**:
the deployed service read **300 of the 650** applications the register stated,
so the published figures were not a stale reading of the area but a third of
the register presented as the register. `daActivityLine` had disclosed a
partial walk since it was written; the PIPELINE paragraph, which is where the
money is, had not. It does now — each figure a floor, because reading the rest
can only raise it — with nothing drawn on a complete walk, `null` kept distinct
from complete, and rule 4a telling the model to carry the qualification
wherever it uses either figure.

**The first regeneration then found that a rule can reach the model and its
evidence not** (§6 of the same doc). Regenerated 17 Sep 2026 the placeholders
were gone and the document still said *"low-density residential zoning"*,
*"no identified bushfire, flood or heritage overlays"* (sourced to a listing
portal) and drew a four-item `{{timeline:}}` of road, TAFE and school projects
on horizons nobody published — from an enrichment that had answered
`not_served` and `none_at_point` on all eleven sections. The base prompt is
**92,129 bytes and `limitPromptContext` trims it to ~52,830 on every section**
(62% head, 38% tail): the two tables sat in the dropped middle while the rule
pointing at them sat in the section instructions, which are budgeted for first
and never trimmed — under a truncation notice that tells the model to
"request fresh web research for missing details", with live search available.
Three rules follow. **What a client document may state about planning may not
depend on a byte boundary** — `generateReportSection` takes a `pinnedContext`
whose bytes come off the budget BEFORE the base prompt is measured and which is
concatenated AFTER the trim, carried into the emergency compact prompt too,
because that is the prompt that runs when the full one was refused. **The rules
are the report's, not a section's**: they said "RULES FOR THIS SECTION" on a
Compass list that has no planning section, so the contradictions landed in the
risk register and the checklist. And **a web search is not a retrieval** — a
listing site, a news page, a budget page or an agency media release is not an
entry in the table, said in the rules because this model searches. The two
tables are also appended to the document verbatim after the post-processor
(property reports only), because asking a model to reproduce a table is how a
table comes back paraphrased.

**The pages then found three more** (§7 of the same doc, from all 29 pages of
the regenerated report drawn through the Chancery master). **A dial the record
cannot back**: page 9 drew a gauge reading `85 · /100 · STRONG` titled *Land
Appeal*, page 18 a second at 82, page 20 a five-value risk `{{wheel}}` — eight
numbers, none in `investment_score`, on a record that issues no grade — because
the prompt said "Investment Score, Affordability, Risk, Suitability, Confidence,
and similar 0-100 ratings MUST use `{{gauge}}`". That line is narrowed and
`suppressUnrecordedVerdictVisuals` checks it was obeyed, on `gauge` and `wheel`
alone: `bars`, `tiles`, `heatmap`, `donut` and `pictograph` carry measured
series and dropping those on a number match takes real data off the page.
**An instruction must never occupy a value slot** — `propertyTypeLabel` WAS the
sentence "Not stated in the record — … never write 'Residential Property'" when
nothing resolved, interpolated into `| Property Type | … |` cells, and the model
quoted it back as the property's recorded attribute; the slot carries the fact
or nothing now. And **the type was known all along**: `rawPropertyType` read
`propertyDetails?.propertyType` alone, while every Compass report is finished by
the resume worker, which calls back with `{reportId, propertyAddress,
continueFrom}` and no `propertyDetails` — so it was `''` on the run that writes
the document, on every report. It reads `sourcePropertyType` now. Four residuals
are named in the doc rather than guessed at: clipped labels in three primitives,
a timeline drawing horizons no item reaches, a model-written `Verified` evidence
chip, and two sections drawn twice.

**An interest-only loan whose term nobody recorded.** Read the note on
`ASSUMED_INTEREST_ONLY_YEARS` in `_shared/reports/investment/loanLedger.pure.ts`
before touching `buildLoanLedger` or `describeLoanStructure`. The same
regeneration stored `loanType: "interest_only"` beside `structure: "Principal
and interest over 30 years"` and `annualPayment: 34,890` — the P&I figure,
$4,990 a year above the interest-only one — because the operator's overrides
named the product and not the term, so the ledger read the absence as a zero
and overruled them silently. `readBaseFinancials` has assumed five years since
QA-04 and disclosed it, so **one loan was being described two ways by two
modules**; the constant now lives in the ledger and the cash flow imports it.
Two rules: **an EXPLICIT zero still means principal and interest** ("none" and
"not recorded" are different statements), and **an assumed term says so in the
sentence a reader sees** — `interestOnlyYearsAssumed` rides the ledger and
`loanDetails.interestOnlyPeriodAssumed` is published beside the figure.

## The cash flow table adds up
Read §1 of the same doc's companion rule in
`_shared/reportBindingProjection.pure.ts` before touching the annual-cost
block, `reconcileStoredFinancials` or the Compass `cashflowRows`. The engine
subtracts **eight** annual components; the projection published four and the
masters bound those four, so on 262 Pallas Street the printed rows came to
$10,780 against a "Net position" built on $12,880 — and the row that omitted
the water rates was **labelled "Council and water rates"**. Water joins that
row, letting fees join management, and land tax + strata are their own line,
drawn only where they come to something. Three rules bite. **A repair must
not change the BASIS while repairing the arithmetic**:
`reconcileStoredFinancials` recomputed `annualNet` from `weeklyRent × 52`
while `calculateKeyMetrics` builds it from `weeklyRent × occupancyWeeks`, so
on the 62 of 153 reports assuming under 52 weeks it re-based them silently on
read and stamped `metricsReconciled`. **The ledger's own year is the debt
service**, never `monthlyPayment × 12`. And **`operatingExpensesFrom`'s
fallback list is all eight components** — `lettingFees` was missing, so a row
with no footed total was charged seven of its eight costs.

## A template choice sticks, and a substitution is consented to
Read `templateFormatFit.pure.ts` and the header of
`src/components/reports/ReportTemplatePicker.tsx` before touching the picker's
state machine or `buildWorkingCopyPayload`'s lineage block. **A family tile
that looks like a choice must BE one** — it painted itself with `ChoiceTile`'s
checked treatment and a "Current" badge while setting only `openFamilyKey`, so
Save changed nothing and was disabled anyway. **The re-seed follows the server
until the person touches something, and never afterwards**: gating on "seed
once at open" opens the dialog on the wrong choice (the library query is
`enabled: open`, so the stored value resolves after the dialog is
interactive), and gating on "both queries have landed" still overwrites
somebody who clicked while they were loading. **Lineage is written for every
adopted entry**, family or not: four readers key identity on `entryId`, so the
43 voice templates came back unrecognisable and minted another active
`report_templates` row on every save. And **a design that cannot carry the
format is named before the document is made** — the chosen template is
otherwise composed around the report and announced by a toast after the PDF
exists; every uncertain case answers `unknown` and is offered unchanged,
because a false caveat teaches people to dismiss the warning.

## The Investment Grade — Scoring V2 in production
Read the *Activation* section of
[`docs/reports/SCORING_V2_METHODOLOGY.md`](./docs/reports/SCORING_V2_METHODOLOGY.md)
before touching `_shared/reports/market/scoringV2Production.pure.ts`,
`investment-scoring-service`, `domain-data-service` or the market-evidence
block in `generate-investment-report`. Every new report read *"Grade withheld
— no scoring system is currently authorised"* from 11 to 15 Sep 2026 for two
stacked reasons: no engine was authorised (V1 is not trusted to grade, V2 was
frozen unwired), and there was nothing to measure — `domain-data-service`
had requested a deprecated `/v1` route without the postcode segment and had
**never once succeeded**, so Growth and Demand were absent on every report.
`SCORING_V2_ACTIVATION` (ME-8, 15 Sep 2026) is the decision, a constant and
never configuration; `scoreForProduction` projects the engine's canonical
output onto the record every reader already understands, under a stamp whose
`authority` is `v2`.

Four rules bite. **The legacy service never imports the engine** — it reaches
V2 through the activation module alone and still cannot spell `v2`
(`LegacyScoringAuthority`), and the pin spec asserts exactly one entrypoint,
one path. **Growth is required before a letter is printed**: three dimensions
can be measured without it, and the delivered-points ceiling then caps the
grade at a B that is a statement about missing data — so the grade is withheld
and `gradeGaps` names each unmeasured dimension, the provider's refusal (the
`X-Domain-Security-Reason` where Domain sent one) and the remedy, and the card
and the page draw the same list. **Evidence is keyed on the trusted geography
only** — the suburb, state and postal area resolved from the verified
coordinate, never the typed suburb or the parsed four-digit token, the same
rule the crime evidence answers to — so an unresolved geography seeks nothing
and says so. And **Domain's licensing is `unverified` until the rights
follow-up is answered**: the engine scores on the points and the client-facing
evidence statement withholds their provenance; declaring it licensed is a
decision with a document behind it, not a default. Since IPV 1.1.0 (16 Sep
2026), **Location's verification is derived from the enrichment's own RF-7.2B
acquisition stamp** (`locationInputVerification.pure.ts`) — subject-matched
and stage-proven readings count, a stampless legacy enrichment verifies
nothing, and a request field asserting verification is never read; Risk stays
null under `propertyRiskSchema.pure.ts`'s recorded decision.

**A renormalised weight is not a nominal one, and all five dimensions are
always drawn.** Read
[`docs/reports/S5_CORRECTIONS.md`](./docs/reports/S5_CORRECTIONS.md) §3 and
§3a before touching
`_shared/reports/market/scoreAssessmentReading.pure.ts`,
`composeScoreDimensionTable` or `_shared/reports/risk/propertyRiskSchema.pure.ts`.
`breakdown[].weight` stores the **adjusted** weight as a whole percentage —
57/21/21 on 18 Annabelle Crescent, not the nominal .40/.15/.15 — so a table
printing it as "nominal points" hides the cap and produces arithmetic that
does not foot (31.9 + 4.8 + 2.7 = 39.4 against a stored 40). The engine rounds
**once, on the sum**, using exact fractions: 32.00 + 4.93 + 2.79 = 39.71 → 40 →
C uncapped, against delivered points of 22.40 + 3.45 + 1.95 = 27.80 → F, which
is the F issued. Four rules bite. **A reading names what the record does not
retain** rather than substituting a coarser figure — `evidenceCoverage` (the
57% S1 reported) and the growth eligibility ceiling are computed and not
persisted, and `coverage.weightCovered` (0.70) is a different measure.
**The assessment is DERIVED where the record is read**, never passed in, because
a parameter a caller forgets takes the whole grade rationale off the page with
nothing reporting it. **Location's exclusion is a defect of ours, not a reading
about the area** — all nine stamped enrichments record `places: complete` and
`commute: measured` and carry none of `walkScore`, `commute`,
`schools.schoolsWithin3km`, because the Client-Safe Gate removes exactly those
three and the generator persisted the gated object while the stamp survived
untouched, so `assessEnrichmentReuse` re-served the stripped copy on every
resume and the printed remedy ("regenerate the report") reproduced it; both
halves are closed and the repair reaches a row only on its next generation.
And **a retrieved control is a fact, never a rating**: the planning programme
now answers `site_hazard_exposure` and `planning_constraints` at parcel grain,
so both leave `not_held` for **`held_but_unscoreable`** — evidence on the page,
zero points, off the acquisition backlog because what is outstanding is a
published SCALE — and `answerableCount()` stays 0, because a capability nothing
delivers may not be declared. Risk still cannot score even so: hazard and
planning are ONE independent category (they answer or fail together),
`MINIMUM_INDEPENDENT_CATEGORIES` is 2, and the only other category a house
offers needs a construction year, held on **0 of 1,230** stored reports. Four
of five scored is therefore the honest maximum until an acquisition lands, and
`riskRemedyFor()` derives what is outstanding from the schema so a remedy can
never name as missing something the platform already reads.

**The Domain 403 is a portal setting, not a mystery.** Re-measured from the
production egress on 15 Sep 2026: the key is set and recognised, and both
Domain products answer 403 with Domain's own body *"Operation not permitted on
project"* — the project the key belongs to has **no API package attached**,
which Domain's access conventions name as the one condition under which no
endpoint answers. The remedy is the Domain Developer Portal (Projects → API
Access → add **Properties & Locations** → Save), recorded step by step in
`docs/integrations/DOMAIN_ACTIVATION_REQUEST.md`; nothing in this repository
can attach it. `describeDomainRefusal` reads Domain's problem-details `detail`
and names that finding on the grade gap, so a report withheld for it says
where the fix is rather than "a restriction Domain must identify".

**Growth no longer waits on Domain.** Read
[`docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md`](./docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md)
before touching `_shared/reports/market/openData/*`,
`openDataSalesEvidence.pure.ts`, `salesRegisterRead.ts`, `market-sales-ingest`
or the open-data block in the generator. Two publishers put a median sale
price series on the open web under CC BY 4.0, reachable from the production
egress (measured 15 Sep 2026): Queensland's Statistician (detached and
attached dwelling sales by local government area, quarterly since 2008) and
NSW's DCJ Rent and Sales Report (by postcode and LGA, one workbook a
quarter). The 8 Sep inventory had recorded Queensland as publishing "none";
it publishes it under a different product. Both load into
`market_sales_medians` and the adapter turns a series into the points the
Growth scorer reads. Four rules bite. **The grain is the publisher's and the
scorer prices it** — an LGA point scores 55 on the geography factor, a
postcode 80, a suburb 100, so a council median is a lower-confidence
measurement, never a substitute claiming to be the suburb and never absent.
**The register is asked only for the cadastre's council or the trusted
postcode**, never a typed suburb or a parsed token. **The finer point wins
the merge**, so Domain's suburb series outranks the register the day its
package is attached, with no code change. And **a suppressed median is
null, never zero** — DCJ prints `-` where thirty or fewer sold.

**Every state has a reading now, and two of them come through the
archive** (§10 of the same doc). Victoria's suburb series and South
Australia's quarterly suburb workbooks are walled at their publishers and
served by the Internet Archive's Wayback Machine, whose CDX index and
`id_` fetch answer the production egress; `waybackMirror.pure.ts` ranks
files by what their names describe and takes the newest capture, and every
row carries `captured_at`. Beneath every state sits the ABS `RES_DWELL_ST`
mean price of residential dwellings — **filed as a mean, never a median**,
read only where nothing finer answered, and Western Australia's only
reading. **One heavy workbook per invocation**: five DCJ workbooks in one
call hit the edge worker's compute limit. And the Financials tab's
**Estimate CGR** button reads the same register for the typed address —
the finest area with a horizon of at least five years, every coarsening a
caveat, nothing invented — and writes the same `capitalGrowth` the ten-year
cash flow already reads. **The register refreshes itself daily** (one
pg_cron job per stage, staggered — the archive's index sheds load under
concurrent asks) and **every reading names its own currency**: the latest
period in the publisher's words and the day the register last took the
series. Two rules from the first production run: **a publisher's typo is
nulled and named, never a reason to refuse a series** (one $7,000 cell
refused 444 localities), and **a file is anchored on the newest capture
that LOADS**, because the archive's index can list a capture its store
answers 404 for.

## The 291 Stone Mason Drive audit (QA-291SM)
Read [`docs/reports/QA_291SM_REMEDIATION_TRACKER.md`](./docs/reports/QA_291SM_REMEDIATION_TRACKER.md)
before touching the standard (pdf-lib) presentation, the fork's section
routing, the condense guides, the financial engine's loan arithmetic or the
cash-flow seeding: it records forty findings against six real documents and
what each turned out to be. Four rules from it keep biting. **A figure a
document prints is a figure the record holds** — the Briefing invented an
"overall fit 68/100" nothing held (`scoreClaims.pure.ts` removes the sentence
and the validator reports the class), and the renderer's override injection
matched `Interest Rate.*?NN%` and rewrote every sensitivity label with the
base rate, so every injection now matches an explicit `Label: NN%` and
nothing else. **What a section may hold is read from its body, not its
heading** (`forkSectionContracts.pure.ts`): the risk register is split by
what each entry is about, a SEIFA heading needs an index, a checklist is
named as one. **A promise of a figure is a figure** — a directive the
standard presentation cannot draw is tabulated (`vizDirectiveTables.pure.ts`),
never dropped behind the sentence that introduced it, and the word-cap cut
works in whole blocks so a bullet cannot lose its explanation or a pair of
lists its second half. And **one loan ledger** (`loanLedger.pure.ts`) drives
projections, metrics and sensitivities, so "interest only" is never projected
with P&I arithmetic. The render service's 503 — and the 500 it became that
afternoon — is a separate matter:
[`RENDER_SERVICE_AVAILABILITY.md`](./docs/reports/RENDER_SERVICE_AVAILABILITY.md).
Two rules from that day. **The host's error page is not the engine's answer**:
Cloud Run's front door serves the same HTML under 500 as under 503 and both
mean no instance took the request — measured with a `GET /` that needs no
token and no engine — so `classifyServiceAnswer` reads the SHAPE of the
answer rather than its digit, and a chosen template the engine did not draw
is drawn by the in-tab renderer instead (`browserStandInFor`), marked, said
out loud, never remembered as the finalisation, and never on a refusal. And
**a fork mints no grade** (`variantScorePolicy.pure.ts`): the Financial fork
wrote D · 39 · CAUTION beside a Compass whose run had withheld the grade under
the scoring policy, and the Generated Reports card showed that D as the
property's grade — the child restates the parent's decision, a variant score
never stands for the property while a composite exists, and the literal `N/A`
the scoring service stores is a placeholder no surface draws.

## Generated reports / PDFs
**Read [`docs/reports/COVERAGE.md`](./docs/reports/COVERAGE.md) before anything
else here.** The design system renders **0.14%** of the documents this product
actually produces — 2 of 1,440, and zero of 1,162 investment reports. Every
other measure in this programme (the ink floor, the critique rubric, the golden
diff, PDF/UA validation) is taken against fixtures in a harness and passes while
that stays true. A correctness measure cannot see an unused system, so check
coverage before improving output.

**Which template a report comes out in is now a choice, and it never was.**
Read [`docs/reports/TEMPLATE_SELECTION.md`](./docs/reports/TEMPLATE_SELECTION.md)
before touching `_shared/reports/reportTemplateSelection.pure.ts`, the picker or
anything that decides which `report_templates` row a document is drawn from. A
template used to reach a document by **ranking alone** — no surface anywhere
bound one to a report format, and every path that touched a template ended in
the Template Builder, which is an editor. A selection is stored per (user,
format) and read **before** the ranking, never instead of it, so a format with
nothing chosen behaves exactly as it did. Three rules bite: a format has up to
four spellings and they are **one** format (the alias map is now in that pure
module and the registry re-exports it — two copies is how `commercial_industrial`
became activatable and unresolvable); a chosen template whose engine is not
`weasyprint` is **still selectable and says so**, because it is what the ranking
would have picked and it produces the legacy document either way; and a
selection that goes stale resolves to **`unavailable`**, never silently to a
different template.

**A chosen template that cannot carry the report is composed, never shipped
empty.** Read the last section of
[`docs/reports/TEMPLATE_SELECTION.md`](./docs/reports/TEMPLATE_SELECTION.md)
before touching `templateBindingCoverage.pure.ts`, `templateComposition.pure.ts`
or the composition step in `routeReportThroughTemplate`. The library's
First-Home Buyer Report was chosen for an Investment report and drew five
near-empty pages as a `succeeded` render: it binds a sample-preset vocabulary
(`client.deposit`, `grants.fhog`, `steps.0`) no adapter publishes, and the two
existing guards catch a static copy and an empty context, not the wrong
vocabulary. Coverage is now measured **against the data the adapter built**,
never a sample, and the rule is narrow on purpose: a template is composed only
when it binds content and **none** of it resolves — its closing and static
pages kept, its blank pages left out, the body drawn from a donor that
carries the report under the chosen template's tokens. **The cover must speak
for THIS report**: static cover prose is invisible to the coverage measure,
which is how "FIRST HOME / Your First Property" shipped as page 1 of an
Investment report — a chosen cover is kept only where it resolves a binding
outside the tenant (`org`, `brand`) and addressee (`client`) namespaces, and
otherwise the donor's cover leads under the merged tokens
(`coverNamesThisReport`). A template that binds
nothing is a brochure and one that resolves a single field is the author's
document; both are drawn as designed. The ranking is not a safe donor on its
own (`resolve_report_template` ranks a person's own templates first, so the
template that cannot carry the report is often the ranking's pick), which is
why the donor search reads the published set.

**A document can be completely correct and still never reach the renderer.**
Read [`docs/reports/RENDER_BOUNDARY.md`](./docs/reports/RENDER_BOUNDARY.md)
before touching `renderResourcePolicy.pure.ts`, `printFontPolicy.pure.ts`,
`tokensToFontFaceCss` or anything that compiles HTML for WeasyPrint.
`render-template-pdf` asserts the HTML can make **no** network request before
it invokes the engine, and all 500 seeded masters name their typefaces with a
Google Fonts `cssUrl` — so every design-system render was refused at that gate,
after parsing, binding and drawing 84 blocks correctly. It was invisible
because the gate ran *before* the `template_render_jobs` row was written and
before `templateId` was read, so a refusal left no row in the ledger and none
in `template_events`; the route fell back, and the legacy generator produces a
well-typeset document too. Two rules: **for print the container is the font
source** (`compileTemplateHtmlForPdf` forces it, and the production route goes
through that compiler rather than its own copy of the step), and **a family the
image lacks is substituted explicitly, never left to fontconfig** — an unknown
face prints as the engine default with no warning from anything.

That boundary judges **where the renderer fetches, not where it draws**. It used
to scan the whole document as one string, so it refused reports for their prose —
808 of 1,182 investment reports carry a URL in their content, and the two
model-authored formats are the most exposed because a model cites its sources.
Attribute values and stylesheet bodies are judged; text between tags is not.
Every attribute is judged rather than a list of the fetchable ones (guessing
narrowly reopens the SSRF; guessing widely costs a loud refusal), and exactly two
are exempt: `xmlns*`, and `href` **on `<a>`** alone. The other half of the same
rule is that **an asset that cannot be brought inside the boundary is dropped and
named, never carried into it** — a bound `src` is resolved and inlined like a
literal one, and what cannot be fetched is left out with a notice rather than
failing the document.

Read [`.claude/skills/npc-services-design/reports/REPORT_RULES.md`](./.claude/skills/npc-services-design/reports/REPORT_RULES.md)
before touching any PDF generator — print has different contrast, colour and font
rules from screen, and most of the repo's "logo" files are email-signature banners
carrying the director's personal mobile number. Architecture and the migration
programme: [`docs/reports/DESIGN_SYSTEM.md`](./docs/reports/DESIGN_SYSTEM.md).

Every report is rendered by one container, `weasyprint-service/`, and it ships
on its **own** deploy — `ci.yml` builds that image to test it and publishes
nothing. `deploy-weasyprint-service.yml` stages a revision with no traffic on
every push and promotes only when a person asks, for the reason below; the
manual path and the one-time federation setup are in
[`docs/reports/CONTAINER_RELEASE.md`](./docs/reports/CONTAINER_RELEASE.md).
Read that before changing the engine pin, the fonts or the render options: it
also carries the order the container and the render routes have to ship in,
which is not interchangeable — the routes ask for `pdf/ua-1`, and an engine
without that variant returns a 500 on every report.

Investment report **generation** is a separate concern from rendering, and the
one pipeline that cannot finish inside a single request: 17 sections at ~25s each
against a ~150s edge ceiling. It survives by stopping at a wall-clock budget and
being resumed — by the browser, the bulk worker, or a cron watchdog. Read
[`docs/reports/INVESTMENT_REPORT_RESUME.md`](./docs/reports/INVESTMENT_REPORT_RESUME.md)
before changing the section loop, its timeouts, or anything that claims a report.
**A model call takes the window the run can spare, never a constant**: the
closing section measured 40-110s against a fixed 60s timeout, so it timed out on
every run and 43 invocations were killed with nothing written; every call now
answers to the run's own deadline, and a section with no window left is
deferred as a hand-off rather than written up as a failed section.

Ten formats have been migrated onto it, and each carries its own contract:
[`INVESTMENT.md`](./docs/reports/INVESTMENT.md),
[`BORROWING_CAPACITY.md`](./docs/reports/BORROWING_CAPACITY.md),
[`CASH_FLOW.md`](./docs/reports/CASH_FLOW.md),
[`PORTFOLIO.md`](./docs/reports/PORTFOLIO.md),
[`COMPARISON.md`](./docs/reports/COMPARISON.md),
[`CASH_FLOW_COMPARISON.md`](./docs/reports/CASH_FLOW_COMPARISON.md),
[`CLIENT_DETAILS.md`](./docs/reports/CLIENT_DETAILS.md),
[`QA.md`](./docs/reports/QA.md),
[`MARKET_INTELLIGENCE.md`](./docs/reports/MARKET_INTELLIGENCE.md) and
[`COMMERCIAL_CAPACITY.md`](./docs/reports/COMMERCIAL_CAPACITY.md). Read the
relevant one before touching that format — each records defects that only a
render against production data revealed, and each names the legacy generators
that must stay.

**Public transport is real now, and the archive is addressed rather than
downloaded.** Read [`TRANSPORT_SOURCES.md`](./docs/reports/TRANSPORT_SOURCES.md)
before touching `_shared/gtfsFeed.pure.ts`, `_shared/transportReading.pure.ts`,
`transport-gtfs-ingest` or `public-transport-service`. It replaces audit
Section 24's clearest fabricator — eight per-state "fetchers" that ignored the
coordinate, so every NSW property was 450m from Central Station, cached 30 days
and driving up to 30 points of every report's walk score. NSW's published
bundle is 292,247,414 bytes and `shapes.txt` is 77% of it, so the loader reads
the zip's central directory from a range-fetched tail and takes `stops.txt`
alone: **1.467%, byte-exact against the declared size**. 185,177 stops across
four networks. Three rules bite. **A station and its platforms are ONE place** —
thirteen production rows within 1.6 km of Parramatta all carry
`parent_station: 215020`, and a nearest-eight over rows lists six platforms of
one station as six stops; grouping is by the publisher's own field, never by
name similarity. **A stop found is a fact about the area; no stop found is a
fact about the FEEDS** — a Perth property is outside every loaded network, not
poorly served, so `outside_loaded_networks` is its own verdict and Victoria
stays declared-but-unloaded (PTV nests deflated per-mode archives) rather than
vanishing. And **nothing returns a score or a mode**: the invented
`qualityScore` is what corrupted the walk score, and mode lives behind a 399 MB
member, so both are named as not measured on every answer.

**Recorded crime now covers four states, and the fourth one changed its
classification mid-series.** Read
[`CRIME_SOURCES.md`](./docs/reports/CRIME_SOURCES.md) before touching
`_shared/crimeIngest.pure.ts` (NSW/QLD), `_shared/crimeIngestSaNt.pure.ts`
(SA/NT), the `crime-data-ingest` stages or `crime_reference`. The rule that
carries the new half: **SAPOL reclassified its offences from 2025-07 and it is
a reclassification, not a rename** — the Level 3 leaves moved too, so any
crosswalk would be an invention and a year-on-year change computed across it
would be a confident figure that is not like-for-like. SA is therefore stored
at two grains: Level 1 (stable, measured continuous across the boundary)
carries the comparison and six calendar years, and Level 2 carries `prior12`
NULL with a `series_note` that reaches the reader. Three more things bite. The
SAPOL catalogue holds **Family & Domestic Abuse files beside the crime files
and its own note says the two must never be added** — the matcher recognises
only the crime family. **A row the register declines to place is not a
malformed row**: `NOT DISCLOSED` is 1.18–1.90% of every file and is counted
and reported, while a wrong-shape row is capped at the measured 1-in-84,949.
And **NT's alcohol/DV rows are a cross-tab, not a hierarchy** — the opposite
of QLD's rollup trap, proved on every load (0 repeated cells, 0 `-` totals
beside their parts) because the day that stops being true is the day summing
silently double-counts.

**A deterministic enrichment is bought once, and a lot number may not select
crime evidence.** Read
[`RF72B1B1_ENRICHMENT_AND_POSTCODE.md`](./docs/reports/RF72B1B1_ENRICHMENT_AND_POSTCODE.md)
before touching `_shared/reports/location/locationEnrichmentReuse.pure.ts`,
`_shared/reports/location/crimePostcodeAuthority.pure.ts` or the enrichment and
crime call sites in `generate-investment-report`. Two things, and each was
invisible. **`existingEnhancedFields.locationIntelligence` guarded the WRITE and
nothing guarded the FETCH**, so the enrichment block re-ran on every resume — and
one enrichment is EIGHT Google calls (1 geocode + 6 Places Nearby + 1 Distance
Matrix, confirmed by the ledger's exact 6:1 Places:Distance ratio), so an
eleven-resume report buys 88 calls and re-buys 80 of them. Reuse is refused
unless the stored object can PROVE it describes this subject: the acquisition
stamp names the address, postcode and state, every legacy row has no stamp and
re-fetches exactly as before, a failed enrichment is never persisted at all so
an outage cannot become a cache, and a `partial` Places run is refused because a
failed lookup and a quiet rural suburb both store `count: 0`. And **the postcode
that selects crime evidence was `propertyAddress.match(/\b(\d{4})\b/)`** — the
first four-digit token, which for builder stock is the LOT number: 30 of 418
corpus addresses parse the wrong token and 17 land on a real postcode
(`Lot 2267 Hunza Road, Truganina, VIC 3029` parses a NSW postcode). Nothing was
ever served wrong only because the crime service also filters on state and no
Victorian register is loaded — containment by accident, which ends the day VIC
loads. Only a **resolved POA** or a **structured `propertyDetails.postcode`**
(supplied and logged all along, never read for this) may select evidence; a
free-text parse may not, a postcode contradicting its state is refused at any
rank, and where nothing is trusted the counts are WITHHELD rather than risked,
with no LGA or SA2 substitute. It is orthogonal to F4: that decides whether a
rate may be DIVIDED, this decides which AREA is described.

The same class had a third instance, and it is the one that reached a sentence.
**A Places lookup that FAILED is not a measurement of zero.** Read §13 of the
same doc before touching
`_shared/reports/location/placesAvailability.pure.ts`. RF-7.2B.1B1's `ok` flag
was reduced to one complete-vs-partial stamp and then DISCARDED, so the
persisted object stored `count: 0` and `nearest: 'N/A'` for a category whose
provider never answered — and `regenerate-report-qualitative` guards its
location context with `typeof healthcare === 'number'`, which `0` satisfies.
Executed against the pre-change projection, an outage handed the model
`- Healthcare facilities within 5km: 0`. Three things compounded it: `'N/A'` is
TRUTHY, so it survived every `||` fallback in the prompt and arrived as a
value; `walkScore` spends points per category, so an outage DEPRESSED a
published figure rather than omitting one; and the Client-Safe Gate disowns
only four location paths, so healthcare, shopping, recreation, restaurants and
transit reached the narrative unguarded. The rule is `rentalEvidence`'s —
**absent is never zero** — applied entirely at the producer: a failed category
stores `null`, a reached-and-empty one still stores `0`, because a rural
address with no hospital within five kilometres is a fact worth printing. No
consumer changed, because `null` is what each already handles
(`typeof null === 'object'` omits the line; `null || 'XX'` renders the
placeholder the prompt already had). The stamp now names WHICH categories were
unavailable, and `placesAreComplete` is the one implementation both it and the
projection read. The withheld-crime half was checked and needed no change:
`crimeStatBlocks` answers an absent reading with one honest line and an
explicit prohibition, carries no digit at all, and composes state-wide movement
only ALONGSIDE a real local total.

**A stored report is addressable by section now.** Read
[`SECTION_STORAGE.md`](./docs/reports/SECTION_STORAGE.md) before touching
`_shared/reports/investment/sectionStorage.pure.ts`, `detectSectionLevel` /
`partitionByRegistry` in `sectionRegistry.pure.ts`, the `report-sections-index`
function or the two derived tables. `report_content` stays the source of truth
and nothing writes to it; the index is a projection over it, and a report whose
re-assembly cannot be proven lossless is left **unindexed** rather than half
indexed. Two things bite. **The partition was blind to 70% of the corpus** — it
read `##` only, and 842 of 1,199 stored reports write their sections at H1
(`# 1. Location Overview` … `# 36. Demographic & Economic Data`), so it returned
each of those whole documents as preamble; the coverage fixture that vouched for
it was H2-only for the same reason, measuring 10,185 heading instances while
26,860 sat outside it. And **a repeat is an occurrence, never a merge**: one
briefing carries `marketPosition` four times, so the key is `(report_id,
ordinal)` and re-assembly walks them in order. Verified by execution over the
whole corpus — 1,199 of 1,199 conserve — and the deployment was checked against
the repo by digest and sample rather than assumed to match it.

**Investment Location & Property Fit** is the highest-volume format by an order
of magnitude — 1,182 rows, 5-18 a week. Its *structure* is
[`INVESTMENT_STRUCTURE.md`](./docs/reports/INVESTMENT_STRUCTURE.md), which is the
one to read before changing a section, the generator prompt or the word caps:
the report carried **90 editorial commentary labels a report — 16.9% of the
document** and ran at 2.3× its own declared budget, because the prompt told the
model "after every visual" and "one per section" at the same time, and because
`compassPostProcessor` / `compassQAValidator` **had no caller in the generation
path at all** — every cap they enforce applied to everything except the document
a client receives. Two rules there keep biting: a label is stripped with its
paragraph but **never a figure or a table**, and a report banked under a
different section list is **regenerated rather than resumed**, because
`last_completed_section` is an index into whichever list is current.

**The report body is packed by the template's own geometry, and the renderer
counts its pages.** Read
[`NARRATIVE_PACKING.md`](./docs/reports/NARRATIVE_PACKING.md) before touching
`_shared/reports/narrativeGeometry.pure.ts`, `markdownPaging.pure.ts`, the
markdown block's styles or `narrativePlan.ts`. The charge model was
calibrated once, on one family's face over one measure, and held back 16% to
survive the pages it still got wrong — measured through the real journey on
14 Sep 2026, the long reference report ran its narrative through the running
foot on sixteen consecutive pages of a Midnight render: a gauge was charged
at 62% of its printed height, compact figures had no stylesheet in the
template path at all, and the budget packed to the foot rather than to the
master's own `contentBottom`. Three rules carry the fix. **A block is charged
what it will draw on the page it will print on** — `MARKDOWN_TYPE` is one
declaration the block styles from and the charges read, every formula is
checked against the pinned engine by `measureNarrativeMetrics.py`, and a
face not in the measured table is charged WIDER so an unknown family packs
sparser rather than overflowing. **One geometry per run, computed by the
renderer** — no single instance can see both the first box and the
continuation box, and a bucket boundary that differs between instances
prints a line twice or loses it; the same pre-pass writes the true page count
over the projection's template-blind estimate before any conditional is
read. And **a page is filled, never merely not overflowed**: a paragraph is
cut at a sentence, a table meets the boundary and repeats its head, a figure
floats past the prose to the next page, a three-line tail is folded back, and a last page is never a stub (a cut
that would leave one is made shorter, and a short last page draws whole
blocks down from the page before it) — each off unless asked for, so the
legacy packer is byte-identical. Two more
from the same renders. **A dropped block leaves no hole**: the masters
position every block absolutely at the `y` their flow assigned, so a register
whose conditional is false left a third of a page white between a heading and
the recommendation under it; `closeDroppedBlocks` moves the column under a
dropped block up to where it began, refuses whenever anything drawn sits in
that band or beside the column, and never moves furniture or an editor page.
And **a chart label fits the drawing it belongs to** — `fitLines` wraps a
label into the units it may use and the drawing grows for the lines, because
a gauge caption, a donut legend, a timeline stop and a pictograph title were
each found set past their own drawing, and the template chart block draws
its ink from the template's tokens rather than the flowing route's literals.
The Chancery and Dictionary journeys then found four more: **a charge counts
what prints** (`printedChars`), never the source's `**` or a link's URL; **a
list is cut where the reader would not notice**, inside a group with two
children on each side; **a chunk is cut for the page it lands on**; and **the
engine reads attributes on SVG text, not `style`** — `font-size="6.5"` sets
6.5pt where `style="font-size:6.5pt"` set the inherited body size. And the
five `:::` fences the generator's prompt asks for (pull quote, sidenote, stat,
divider, quote page) are DRAWN by `renderMarkdown` now — they printed raw on
every structure — with an unknown kind unwrapped rather than printed.

**Market Intelligence and Report Q&A are on the geometry too, and their
omission notes are folded, not paged.** Read §7 of the same doc before
touching `geometryAwareFormat`, `planNarrative`'s pages-path reader,
`NARRATIVE_NOTES_KEY` or `PackOptions.reserveLines`. Neither format had a
profile, so their runs packed at 34 estimated lines against a ~46-line box:
measured on the Chancery renders, MI continuation pages were 20–40% full
while the same layers were clipped by up to 14 pages and 4 of 41 pages
carried only the "This section continues" callout; the Q&A answer was cut at
8 of an estimated 26 pages with half-empty pages before the cut. Four rules.
**A format joins the geometry by being measured**, and only where the
renderer files one — a block on its own packs as before and no projection
estimate changes. **The pages path is read off the continuation conditional**
(`marketIntel.layers[0].pages > n`, `qa.answerPages > n`), never assumed, and
the copy that writes the true count keeps an array an array. **A note the
master gave a page of its own is folded onto the last allowed page**, its
counts rewritten to the renderer's truth, the room held back by the packer so
nothing overflows. And **a numbered step keeps its bulleted sub-points and its
number**: a nested run of the other kind belongs to the item above it (nesting
by rank of indentation), and a resumed ordinal is written as
`counter-reset: list-item` because WeasyPrint 69.0 ignores `<ol start>` —
`styleTags` merges a tag's own style rather than writing a second attribute
the parser drops.

**A placeholder never reaches a client document — the owner's rule is "N/A or
unavailable, never".** Read §8 of
[`RUNTIME_CONSOLIDATION.md`](./docs/reports/RUNTIME_CONSOLIDATION.md) before
touching `presentStoredMarkdown`, the ungraded branch of
`reportBindingProjection`, the scorecard rows, `UNSTATED_CONFIDENCE` or any
generator prompt that mentions a missing figure. Every Executive Briefing in
production carried 36–97 "N/A" cells and rendered them verbatim, because
`stripPlaceholderRows` ran on the WRITE path alone and every stored row
predated it — so the same scrub now runs where stored content is READ, at the
four readers, by one imported implementation, byte-identical on a clean
document. Three rules bite. **An absence is omitted, never worded**: an
ungraded record publishes no verdict at all (the headline used to read "Not
available — insufficient verified evidence"), an unscored dimension draws no
row ("Not assessed" beside a dash), and a chip with nothing to state is not
drawn. **A prompt never asks for a placeholder, an estimate or a confession** —
the governed authority's recovery sentence says what the analysis rests on,
never what it lacks, and the generator hands the model only the dimensions
that scored. And **prose is never regex-scrubbed**, on read or on write:
`neverAPlaceholder.spec.ts` scans structure and source, not sentences.

**One finalisation is one PDF, on every format — and every exit points at
it.** Read §9 of [`RUNTIME_CONSOLIDATION.md`](./docs/reports/RUNTIME_CONSOLIDATION.md)
before touching a `deliver*` module, `publishReportToPortal`, the Cash Flow
modal's send path or `deliverMarketIntelligencePdf`. Every one of the nine
non-Investment formats already drew its own document with the pinned
WeasyPrint engine, and four things were off the pattern, each invisible from
the outside: a chosen template was drawn by the browser's jsPDF on all nine
(`routeReportThroughTemplate` defaults to `renderer: 'browser'` and only the
Investment delivery named the final one, so choosing a template DOWNGRADED the
document); Cash Flow's "Send to Client" shipped a jsPDF with its own chart
switches while "Generate PDF" shipped the typeset one; the two on-publish
portal renders fetched the route's bytes back and uploaded a second copy, so
the ledger named one object and the portal another; and Market Intelligence
entered its template path only when `persist` was off, on a button that
defaults it on. Four rules. **A delivery names the final renderer**
(`finalRendererOnEveryFormat.spec.ts` scans for it and forbids it anywhere
else). **Where the bytes already are is part of the answer** — every blob
helper returns `storagePath`, the three routes return `path`, and a publish
points rather than copies; an upload survives only for a document nothing
stored. **A moved override is a different document**: the Cash Flow send
reuses a produced document only while `cashFlowFinalKey` (series, scenario,
template choice) still matches. And **a switch the document cannot honour is
removed, never left dead** — the send dialog's chart toggles reached only
jsPDF and are gone, while the export menu's own switches still govern the
legacy download, which stays a named choice.

`INVESTMENT.md` is the one to read before touching anything the *model* draws. Its prose carries a chart vocabulary the generator's
prompt demands and the renderer had never parsed: **3,753 `{{bars: ...}}`-style
directives, about 107 a report**, every one of which set as body copy on a
client's page. The parser and the router are shared
(`_shared/reports/vizDirectives.pure.ts`, `vizFigures.pure.ts`) and eleven of the
twelve kinds map one-to-one onto a chart primitive that already existed.
`INVESTMENT.md` also records why nothing keyed on a section *number* works any
more: of the 35 reports the current generator has produced, **none is numbered**.

**Commercial & Industrial Capacity** is the one to read before
adding a format whose prose a model writes. Its figures come from the stored
calculation run and never from a recomputation; its analysis section is
model-authored under a tool schema that contains **no numeric field at all**,
persisted against the run so a re-issued report says what the first one said,
and labelled as model-written on the page. It is also the format whose first
render found a live bug in `measure.pure.ts` — `formatDelta` reported "no
change" for every `rate` that changed, which had been silently wrong in the
Borrowing Capacity Snapshot's audit table.

Two of the ten carry model-authored Markdown rather than typed figures, and
they share the programme's only Markdown renderer,
`_shared/reports/markdown.pure.ts`. Read them first if you are touching prose.
**Report Q&A** discovers its sections from the content rather than declaring
them, and is the only render route that can call a model. **Market Intelligence**
is the one whose page budget is fitted block by block against real renders rather
than summed, the one that clips a section and says so on the page, and the only
one that writes a PDF a scheduled email later attaches.

## Partner agreements — TEMPLATES ONLY
The platform no longer runs the formation of a partner referral/commission
agreement. Read [`docs/agreements/TEMPLATES_ONLY.md`](./docs/agreements/TEMPLATES_ONLY.md)
before adding anything to `_shared/agreements/`, restoring a deleted module from
history, or wiring an agreement into referrals, commissions or compliance.
Issuance, acceptance, execution, status tracking, cross-portal sync and the
notifications are **gone**, along with three Edge Functions
(`manage-partner-agreements`, `finance-portal-agreements`,
`agreement-centre-render`) and eleven shared modules — facilitating and
recording a contract between two independent businesses made the platform look
like a participant in it. One rule carries what is left: **downloading a
template is the end of the platform's involvement.** The wording lives in
`templateResource.pure.ts` and both portals render it from there, no Edge
Function is invoked and nothing is written, and `agreementTemplatesOnly.spec.ts`
asserts the machinery stays gone.

**The document is a file, not a render.** These two instruments were typeset
**three** ways in this repository at once — a Python builder writing
`public/`, a browser DOCX renderer, and the documents their author actually
maintains — and the generated pair had gone stale, still carrying a section the
owner withdrew. That is how "the template keeps reverting to the old version"
kept happening. The author's file is now the artefact, declared in
`_shared/agreements/templateFiles.pure.ts`; the other two are **deleted rather
than dormant**, because a dormant generator is one `npm run` away from writing
a staler document beside the real one. Two rules follow. The locked content
modules are now the **specification, not the renderer** —
`agreementTemplateFiles.spec.ts` opens each shipped `.docx` and fails if any
subclause, heading, note or bullet is missing, and it scans the whole package
(including `docProps`, where Word puts the author's name) for tenant identity.
And **both portals hand over byte-identical files**: the branding stamp is gone,
because the supplied cover is built around `<<COMPANY NAME>>` and a
tenant-stamped blank reads as that side's prepared offer. Three things
that were deliberately NOT removed: the historical rows (nothing was ever
executed — 0 signatures — but destroying the record is irreversible), the Portal
Access / AML-CTF **Compliance Passport** agreements in
`partner-agreement-records` (Aurixa's own terms with its own users), and
`manage-agency-agreements` (agency ↔ client, a different feature).

## The PDF-import sidecar (Docling)
Template Builder's PDF import runs through one Cloud Run container,
`pdf-parse-service/`, dispatched by `pdf-parse-dispatch`. Read
[`docs/pdf-import/SIDECAR_PERFORMANCE_PROGRAMME.md`](./docs/pdf-import/SIDECAR_PERFORMANCE_PROGRAMME.md)
before changing its deployment, its Docling options or the watchdog: it records
what the production ledger measured against what the deploy docs assumed, and
they disagreed on nearly every point — **43% of 76 jobs failed**, one 94-page
job took 357s while another took 46,424s, and 42% of a healthy job's wall clock
was cross-Pacific IO to Supabase.

Two rules that keep biting. **OCR availability is not OCR forcing** — they were a
single expression until lane-policy v3, so enabling the fallback force-OCR'd
every page of 44% of traffic; and disabling it would have stopped `ocr_scanned`
OCR-ing a genuine scan, because the capability is a hard ceiling. **The sidecar
and the dispatcher share `LANE_POLICY_VERSION` and must deploy together**, or the
cache fingerprint serves stale-semantics artifacts.

Sidecar options live in `app.py`'s `GLOBAL_CAPABILITIES`, the lane matrix in
`lane_policy.py`, and the OCR language contract in `ocr_languages.py` — a
mistyped language code is not inert, it fails the whole conversion (`zh` is not
an EasyOCR code and cost 9 production jobs). Those three modules are pure and
gated by `ci.yml`; nothing else in `pdf-parse-service/` runs in CI.

That sidecar is only **one** of the two PDF engines. A checkbox in the import
dialog routes the file to Claude instead, via `template-design-agent`. Read
[`CLAUDE_RECONSTRUCTION_GROUNDING.md`](./docs/pdf-import/CLAUDE_RECONSTRUCTION_GROUNDING.md)
before touching that path: it was the only reference kind the importer did not
ground, and it now measures the attached PDF with PDF.js first. Two rules there
keep biting — grounding is read from the **attached bytes and never from the
open template** (measurements from the wrong document are worse than none, since
the agent treats them as authoritative), and **absent grounding is not empty
grounding** (an empty element list tells the model a scanned page has no text,
which it then reproduces).

The import review can now ask a model **what differs** between the source page
and the rendered one, per page, on an operator click. Read
[`VISUAL_CRITIQUE.md`](./docs/pdf-import/VISUAL_CRITIQUE.md) before touching
`_shared/visualCritique.pure.ts` or the `visual_critique` mode. It is a judge and
never a fixer: the model notices, and every claim geometry can settle is settled
by geometry before a reviewer sees it — a finding naming an element the page does
not contain is **dropped**, and one measurement contradicts is shown as
contradicted rather than as a defect. The doc also records the endpoint it
replaces: `layout_reconciliation_repair` reads a field its only client never
sent, so it answered "no changes" to every request ever made of it.

A scanned PDF is routed to the engine that can read it. Read
[`SCANNED_ROUTING.md`](./docs/pdf-import/SCANNED_ROUTING.md) before touching
`scannedDocumentPolicy.pure.ts` or `probeTextLayer`: the deterministic path
cannot read a scan and **OCR is not the fallback** — 0 OCR pages across 1,164 in
production, because the capability ceiling defaults false — so the dialog
measures the text layer in the browser and pre-selects the Claude engine. Two
rules there: a **failed probe is `unknown`, never `scanned`** (it fails on
encrypted files, which are not scans), and a stray watermark character must not
make a scanned page look native.

Chart reconstruction is **inert in production and now says so**. Read
[`CHART_RECONSTRUCTION_STATUS.md`](./docs/pdf-import/CHART_RECONSTRUCTION_STATUS.md)
before touching `chartCandidate.pure.ts` or anything in the chart path: 0 chart
overlays exist across 245 imports, for four independent reasons (the scene graph
never runs, so `chart_candidates.py` never executes; Docling's picture classifier
runs on 2 of 84 jobs; `chartNativeEnabled` is off). The client-side detector
recovers the classification from geometry the import already holds and **never
reads a value off a chart** — a misread number in a client's financial report is
this programme's top risk, and a classification cannot misstate a figure.

An import now also brings a **design system** with it, read off the source and
bound to its own overlays. Read
[`IMPORT_DESIGN_SYSTEM.md`](./docs/pdf-import/IMPORT_DESIGN_SYSTEM.md) before
touching `designSystemBinding.pure.ts`, the token derivation in
`mapDoclingToPagePlan`, or `applyTemplateImportPlan`'s token merge. One rule
carries it: **bind only where the token's value is exactly what the overlay
measured** — that is what makes the render byte-identical and the import
restyleable at the same time, and there is no tolerance parameter. Two things
that bit: anything which **measures** a template (CDIR) has to resolve the
references first or it derives a palette of `token:heading`, and the base
template's tokens win every conflict so an import cannot restyle pages it lands
beside.

An imported overlay also carries what the source said it **is** —
`overlay.semantics`, from Docling's own label. Read
[`SEMANTIC_STRUCTURE.md`](./docs/pdf-import/SEMANTIC_STRUCTURE.md) before
touching `semanticRole.pure.ts`, the overlay element name in
`blocks/_shared.html.ts`, or image `alt`. WeasyPrint builds the tagged PDF's
structure tree from the **element name**, and `render-template-pdf` asks for
`pdf/ua-1` — so a `<div>` is why an imported page's structure tree used to be
flat with zero headings. The stage's hard constraint is that it adds meaning and
moves nothing: pixel identity at 300 DPI is asserted before and after, and the
`margin:0` reset and the `<span>` inside a heading are both there for measured
reasons the doc records.

## The template converter
An existing template can be brought *onto* the design system rather than into the
visual editor: `/admin/template-builder/converter` extracts a template's section
structure, binds it to one of the migrated report formats, and renders it through
WeasyPrint under a **brand design system** — a saved brand colour plus a full
`ReportDesignOptions`, authored in the UI or drafted by Claude from a brief. The
palette is never stored, only resolved. Read
[`docs/reports/TEMPLATE_CONVERTER.md`](./docs/reports/TEMPLATE_CONVERTER.md)
before touching it: it records why binding is confirmed rather than guessed, why
unmatched sections become an appendix instead of being dropped, and why the
output goes to its own private bucket rather than `report-templates`. The
existing `ImportPdfDialog` / `parse-template-document` path is a different
destination and stays.

## Report templates
The seeded PDF catalogue is **generated**, not hand-edited. Never hand-edit the
generated migration — edit the source and run `npm run templates:library:seed`,
which revalidates every schema against the live Zod contract, the production
renderer allow-list and the publish gate before writing anything.

It carries **two authoring systems over one renderer**. The 43 *voice* templates
come from `scripts/template-library/designSystem.ts` — five voices keyed to the
catalogue's `style` axis, six accents keyed to subject, all derived from the NPC
tokens ([`06-design-system.md`](./docs/template-library/06-design-system.md)).

The 500 *family* templates come from the approved Claude Design **Investment
Compass Template Catalogue**: ten design families × five structural variants ×
ten colourways. The designs carry no subject matter, so they serve **all ten
migrated report formats** — 50 masters each of Investment Compass, the Borrowing
Capacity Snapshot, the Portfolio Performance Review, the Property Comparison
Analysis, the 10 Year Cash Flow, the Client Details Form, the Cash Flow
Comparison, Report Q&A, Commercial & Industrial Capacity and Market
Intelligence, sharing one shell (`investmentCompass/master.ts`) and contributing
a page sequence each. Nine are production-ready; the Cash Flow Comparison is
**preview-only because nothing about a comparison is persisted anywhere a
template can read** — not the projections, not the analysis, not the ledger.

**Model-authored Markdown is drawn by `markdown-block`, which takes source
rather than HTML.** Report Q&A and Market Intelligence both carry prose a model
wrote — 70% of Q&A answers use inline bold, and Market Intelligence is eight
Markdown layers — and neither could be drawn until that block existed. It renders
through `_shared/reports/markdown.pure.ts`, the programme's only Markdown
implementation and **escape-first**, so safety is a property of the renderer
rather than of the caller: no input to it produces markup the model chose. That
is what admits it to `PRODUCTION_SAFE_BLOCK_TYPES` without opening a hole in a
security allow-list, and a block accepting rendered HTML must never be added.

**A body of unknown length is carried by conditional pages, not by a bigger
block.** `packMarkdownPages` (`reports/markdownPaging.pure.ts`) is shared by the
block and the projections precisely so they cannot disagree — a master makes
page N conditional on a published page count while the block decides what page N
holds, and one line of drift prints a blank page or loses the end of a section.
Adding a format is a composer plus a `ReportFormat` descriptor — and the adapter
and projection that make it production-ready — not a second design system.

**A `category` must be one the column accepts.** `template_library_entries_category_check`
and the TypeScript `TemplateLibraryCategory` union have diverged: the union has
`market`, the column has `suburb`/`postcode`/`statewide`. The column decides, the
seed builder refuses to write when a category is outside it, and that guard
exists because 50 Client Details masters were rejected by Postgres **mid-apply,
after 290 rows had been written**.

Two rules are worth knowing before you bind anything. **A declared block height
is a promise the renderer keeps only if the text is as short as the author
assumed**, and a block that sets taller does not overflow the page, it prints
over the next one; size from `textHeight(chars)` against measured production
lengths, and `npm run templates:compass:qa` fails on the class. And **an
unresolved binding renders as the empty string, never as a visible `{{…}}`** —
which is why two formats shipped a cover with no title at all, why the
Investment Compass's narrative page and risk register were blank on every report
(49 of its 80 paths resolved to nothing), and why **every** document printed a
blank letterhead until `organisationProjection.pure.ts` gave `org.*` a producer.
A format's projection is the authority on what may be bound; the catalogue specs
assert the masters bind nothing it cannot publish, and the check that finds this
class is to resolve every bound path against a row taken verbatim from
production — never against `SAMPLE_REPORT_DATA`, which is written in the
catalogue's own vocabulary and passes while production is empty. Read
[`docs/template-library/07-investment-compass-families.md`](./docs/template-library/07-investment-compass-families.md)
before touching `scripts/template-library/investmentCompass/` or
`_shared/templateColourways.*`.

**The families and colourways are GENERATED, never hand-written.**
`investmentCompass/source.json` is a verbatim evaluation of `FAMILIES` and
`COLOURWAYS` from the Design file; `npm run templates:compass:generate` emits
the two `.generated.ts` modules from it. ~250 manifest entries and 500 colour
values are not something anyone transcribes correctly, and a mistyped hex is a
design change nobody approved — so `investmentCompassSource.spec.ts` re-checks
the generated files against the source every run. A design change goes to Claude
Design and comes back through the generator.

Four rules keep biting. **A colourway is tokens and nothing else** — the
catalogue's own rule is "tokens carry no layout meaning", which is why this is 50
masters × 10 palettes and not 500 templates; a spec asserts every block's
geometry is byte-identical across a family's ten palettes. **A colourway's `ink`
is the cover FIELD, not body copy** — body ink is derived by lifting it 4 points,
the measured gap between `--aurixa-obsidian` and `--foreground`, and setting body
copy to the field colour is invisible on screen and wrong on paper. **The
manifest vocabulary is resolved, never read directly** — 31 KPI layouts and 30
chart styles map onto primitives in `resolvers.ts`, which **throws** on an
unmapped value so a new family fails the build instead of silently rendering as
somebody else's layout. And **`family_id` is version lineage, not a design
family** — it is what the publish path deprecates siblings by, so overloading it
would make publishing one master deprecate the other four; family metadata lives
in the additive `design_meta` column instead.

## Mobile (Flutter) translation
The four portals are being translated into one cross-platform Flutter app.
[`mobile/plan.md`](./mobile/plan.md) is the master plan — architecture
decisions, the server-side prerequisites in this repo (bearer auth for the
cookie portals, a native Turnstile replacement, the missing account-deletion
flow), and the store verification rule catalog for the App Store, Google
Play **and Huawei AppGallery** (HMS devices have no Google services — the
push/attestation abstractions are three-platform by rule). Per-portal plans
live in `mobile/portals/*/plan.md`; listing/launch practice for all three
stores is `mobile/store-listing/plan.md`. Two generated artefacts feed the
Flutter workspace and must never be hand-edited: `mobile/design-tokens.json`
(`npm run mobile:tokens`) and `mobile/api-surface.json`
(`npm run mobile:api`); both have `:check` drift modes.

## The Builder / Developer Portal is a drawing set
Read [`docs/builder-portal/VISUAL_SYSTEM.md`](./docs/builder-portal/VISUAL_SYSTEM.md)
before touching `src/styles/builder-drafting.css`,
`src/components/builder-portal/ui/*`, `builderConstructionRail.pure.ts` or the
`aside` on `BuilderPortalShell`. The portal's language is the artefact a
builder already lives in — setout grid, three line weights, annotation type, a
dimension line, a title block, a ruled schedule — and every selector is scoped
under `.builder-portal-theme`, which exactly two roots apply.

The defect it records is the one worth remembering: the first pass shipped the
whole language and **three of its components had zero call sites**.
`DimensionRail`, `TitleBlock` and `bd-chip` were written, documented, merged
and deployed without anything ever rendering them — 19 pages mounted the shell
and **none** passed an `aside` — so what reached production was only the half
that re-skins existing markup, and every page changed just enough to look
finished. Nothing in the gate could see it: an unused export typechecks, lints
and builds. **A component is not shipped until something renders it**, and
`builderPortalUiMounted.spec.ts` now fails when one is not.

**And it happened again, in the stylesheet, where that spec cannot look.** The
plate-sheet work landed with 17 unmounted `.bd-*` rules and found **11 more
already on `main`** — `bd-chip` among them, so the class named above was never
actually mounted, only its two sibling components. All 28 are deleted, because
the primitives were redundant by construction rather than merely unused: the
sheet's strategy is the RE-SKIN, so `.luxury-badge` already does `.bd-chip`,
`.bg-card` does `.bd-card`/`.bd-sheet` and `thead th`/`tbody td` do
`.bd-ledger`, on the pages that exist. **A class is not shipped until
something wears it** — `builderDraftingMounted.spec.ts` fails on any `.bd-*`
the sheet declares that nothing in `src/` applies. Dead CSS compiles, lints,
passes `audit:style` and ships.

**The Stock List is a plate sheet, and it rendered zero `<img>` before this.**
Every builder's own imagery was discovered, de-duplicated, classified, ranked,
stored and signed while the page showed a status word — `builderStockImageUrl`
had no caller anywhere. §7 of that doc carries the layout, which was decided
by measuring four arrangements in a real Chromium rather than by taste: 306px
of picture beside a 91px address cannot balance in a 910px column, so the
schedule runs DOWN it, six rows come to 216px, and `91 + 216 + 52` plus the
gaps is 397px against the plate stack's 397. Four rules bite. **Label and
figure are adjacent** — justified, they landed 850px apart with nothing to
carry the eye. **The foot stretches rather than being sized**, so an address
that wraps cannot open a hole. **A row with nothing in it prints a dash and
keeps its place**, except price, where "on application" is a real state and an
em dash at 1.5rem reads as a broken page. And **availability is a schedule
field** (a title block carries its STATUS), which is what got a 908px `w-full`
select off the foot of every row and away from the one destructive control.
`StockPicture` is the marketplace card's fit-and-ground logic **extracted with
the transport as a parameter** — one implementation, so two portals cannot
draw the same photograph differently.

**A builder can state the figures their stock list does not**, and §8 of that
doc is the one to read before touching
`_shared/builderStock/manualStats.pure.ts`, `set_manual_stats`, or either
read path's decorator. Lot 324 drew four em dashes and the page was RIGHT —
the record holds NULL, because the brochure is a **dual-key** home (two
self-contained dwellings, two sets of figures) and the extraction obeyed its
first rule rather than inventing one number. All three PDF-sourced misses
across 57 are that shape; no parser reads a fact a document does not carry.
The load-bearing rule is **where the override lives**: `writablePatch` names
all five configuration columns and writes each whenever the file states
anything, so a figure typed into `bedrooms` would survive a silent stock list
and be destroyed by the next one that speaks — the correction losing to the
document it corrects, which is #2347 again. `manual_stats` is a column the
patch does not name, overlaid on READ in the one decorator both the builder
portal and the Command Centre pass through. Four more: **the extraction is
never destroyed** (`stated_*` carries it back, so the dialog shows the reading
being replaced and "Not in your stock list" separates a silent file from a
lost number); **zero is a value and an empty box is not one**; **a figure is
refused, never clamped**, with `noValidate` on the form because the browser
silently blocking submit made the server's own message unreachable; and
**price is not stateable** — it is the offer, not a description of the
product. Also fixed there: `price_display` of `"$863,850 *"` drew a lone
asterisk as the price's terms, a footnote marker with no footnote.

And the rule that reaches past this feature: **a JSONB shape constraint states
key PRESENCE before key type.** A CHECK constraint passes on NULL and fails
only on FALSE, and `->` on an absent key is SQL NULL — so
`jsonb_typeof(col -> 'values') = 'object'` is NULL rather than false on an
object with no `values` key, the whole `and` chain evaluates to NULL, and
Postgres ACCEPTS the row along with every test below it. `manual_stats`
shipped that way for a day and took `{"recorded_at":"x"}` without complaint.
Assert `col ? 'values'` first, which is strictly true or false, and assert it
ABOVE the first dereference, because `and` short-circuits left to right. It
was found by probing the live constraint rather than by reading it, which is
the same rule the retention purge and the verification self-test already
answer to: **asserted by effect, never by configuration**.

Three rules bite. **Off-sequence is not a position** — `on_hold` and
`cancelled` are real statuses and not points on the line, so they resolve to
null and the rail states the absence; placing them at an index invents a fact
and placing them at the end would say a cancelled build had completed. **The
case's own stages outrank the catalogue**, because a builder may not run every
stage and a rail showing stations this build lacks is measuring somebody
else's job. And **a short label is a prefix of the full one** — the rail draws
`short` and speaks `label`, so shortening can never rename a station.

What only a render could find is in §3 of that doc, including the one that
makes the re-skin possible at all: Tailwind v3's `@layer` is build-time
bucketing rather than native cascade layers, so **specificity decides** and a
descendant-of-root selector out-ranks a utility — which is what lets one rule
re-skin ~40 shadcn badges without touching a page.

## The builder ranking (which builder's stock an adviser sees first)
Read [`docs/builder-portal/47-builder-ranking.md`](./docs/builder-portal/47-builder-ranking.md)
before touching `_shared/builderStock/builderRanking.pure.ts` (network),
`marketplaceOrder.pure.ts`, the `builder_network_stock_ranked` view, or the
ranking operations on `builder-network-admin`. The marketplace ordered by
`created_at DESC` on every deployment, and in a multi-vendor marketplace that
is not the absence of a ranking — it IS one: it rewards whoever uploaded last,
no builder can be told their position, and no operator can defend it.

The measurement that shaped the whole design: on 17 Sep 2026 the network held
**2 builders, 1 with live stock, 43 live properties, 1 activation, and zero
construction cases, completions, defects, warranty claims or transactions.**
Almost nothing you would rank a builder on has happened yet.

Five rules carry it. **Absent is never zero** — the rule `rentalEvidence` and
`placesAvailability` already paid for, applied again: a `not_measured` signal
leaves BOTH sides of the average, so a builder with no delivery history outranks
one with a bad delivery history. **A thinly-evidenced score is pulled toward the
middle** — excluding absent signals would otherwise let one perfect signal beat
nine good ones, so the measured mean is blended with a neutral prior and
`confidence` is drawn beside every score. **Merit and money are two numbers and
never one**: a commercial placement adds NO points, it selects a capped, labelled
band, and `builder_stock_item_ranks_disclosure` is a CHECK constraint refusing
any promoted or pinned row with `disclose = false` — held again at the clone's
mirror. **An override is an act, not a value** — pin, suppress and freeze sit
beside the computed score with an actor, a reason (10-character floor at the
column) and an expiry that **defaults to 90 days rather than NULL**, because the
failure is not a bad expiry but the pin nobody renewed; there is no
`set_merit_score` and there must never be one. And **the page's shape is not
part of any score**, which is why the network scorer contains no ordering
function at all: the network decides what a builder and a property are WORTH and
that travels, each clone lays out a page from those worths, and a clone computes
nothing because its mirror is a PARTIAL view of the market — a clone scoring for
itself would be wrong, not merely different.

Three more that bite. **Tenure cannot be read from `created_at`** (that is when
a builder joined the network; both live organisations joined weeks before this
shipped), so it is declared, an ABR-verified date outranks a typed one, and
neither present is `not_measured` rather than "new". **A price cohort needs
three distinct BUILDERS** before it may say anything — comparing a builder to a
cohort of their own stock compares them to themselves — and the score saturates
at both ends, because a listing 45% under comparable stock describes a different
product rather than a better deal. And **the interleave is a window function in
the view, never a pass over rows already fetched**: a cap applied to a page after
the fact cannot help when the page is already one builder's. Nothing it does is
a filter — the only property that leaves a marketplace is one an operator
explicitly suppressed.

Two findings from the same work, recorded in §"What is asserted" of that doc:
the **stock-sync producer existed only in production** (six functions, three
triggers, no file — captured verbatim in
`20260917095000_capture_stock_sync_producer.sql`, because `baseline-check.mjs`
rebuilds from the repo and a rebuilt environment would have come up with the
mirror wiring absent), and **a builder's stated figures have never crossed to a
clone** — the payload composer reads `manual_stats->'bedrooms'` where the
column's own constraint puts them under `manual_stats->'values'`, so every
lookup is NULL and it looks exactly like a builder who stated nothing. That one
is named and deliberately not fixed in a capture migration.

## Frontend loop (summary — full detail in `FRONTEND_TOOLING.md`)
1. Design new surfaces with the **frontend-design** skill.
2. Build shadcn-first; use **@21st-dev/magic** for net-new components, then adapt to
   our semantic tokens and `components.json` aliases.
3. Review with the **web-design-guidelines** skill.
4. Verify in a browser with **chrome-devtools** (console clean, screenshot the result).

## Hard rules
- **Semantic design tokens only** — never raw Tailwind palette classes or hardcoded
  colors/fonts in shared UI. `npm run audit:style` must not regress (new violations = 0).
- **Surfaces are glass.** The material lives in [`src/styles/glass.css`](./src/styles/glass.css)
  (recipe) and the glass scale in `src/styles/tokens.css` (values). Use a `.glass-*`
  class; don't hand-roll a frosted surface, don't add a `bg-*`/`shadow-*` utility to
  one, and don't put `backdrop-filter` on anything that repeats. Read that file's
  header before adding a surface — it explains why for each rule.
- Respect the shadcn setup (`components.json`, `tailwind.config.ts`, `src/index.css`).
- Before finishing a UI change, run `npm run lint`, `npm run audit:style`, and `npm run build`.
