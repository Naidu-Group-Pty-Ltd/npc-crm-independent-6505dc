# What a clone does not get, and how to finish provisioning one

Measured 19 September 2026 across every project in the fleet. Read this before
concluding that a clone's Market News Feed, listing scrape or Builder Stock is
broken — in each case the code is correct and something never reached the
deployment.

## The measurement

| Project | Ref | Latest migration | `market_sources` | `builder_network_connections` |
|---|---|---|---|---|
| NPC Property Dashboard (**prime**) | `dduzbchuswwbefdunfct` | `20261203010000` | populated | — |
| aurixa-clone-npc-client-dashboard | `plisdzywzleljorrphxv` | `20261123000000` | **0 rows** | **0 rows** |
| aurixa-clone-NPC Test | `umrtusxohxjxzodxorim` | `20261123000000` | — | — |
| aurixa-clone-Preflight Property Group | `egrmsulhtmqnmhvuccxr` | `20261123000000` | — | — |
| aurixa-builders (**the network**) | `htfluofznhxeumblwbww` | — | — | 1,066 stock items, 91 outbox events |

Three facts carry everything below.

**All three clones stop at `20261123000000`** and are missing the same
seventeen migrations, `20261124000000` through `20261204010000`. That is a
fleet-wide gap, not three coincidences.

**Two of the three items are not clone problems at all.** The Firecrawl key is
already fleet policy on Mission Control with no value behind it (§2), and the
Builders Network connection is empty on the **prime** as well as every clone,
because the act that creates it was never implemented on any side (§3). Both
read, from a clone, exactly like something that clone is missing.

**A clone's migration LEDGER is not a record of what ran.** On
`plisdzywzleljorrphxv` all seven `market_sources` seeding migrations are
recorded as applied and the table holds **zero rows**. Clone provisioning
copies the schema and the ledger; the rows those migrations INSERT do not come
with it. Anything a migration seeds is therefore absent on every clone while
looking, from the ledger, exactly like it is present.

## 1. The Market News Feed source registry

**Fixed in code — no action needed.** `market-updates-ingest` now fills an
empty registry from the catalogue shipped in
`_shared/marketSources/canonicalRegistry.generated.ts` (43 sources) and carries
on. The next ingestion on any clone seeds itself.

It only ever acts on an **empty** registry. A deployment whose sources an
operator disabled is left exactly as it is — see `registrySeed.pure.ts`.

To confirm afterwards: the Market News Feed page should stop reporting
`HTTP 422`, and `market_sources` should hold 43 rows.

## 2. Reading a listing page

There is no free substitute for the key: measured from the production egress,
`r.jina.ai` answers **HTTP 200 with an "Access Denied" body** for both
`realestate.com.au` and `domain.com.au`. Both portals WAF-block it, and
`isBadScrapeContent` correctly rejects the result — which is why a clone falls
through to the model every time.

### The remedy is one value on Mission Control, and the machinery is already built

This was first written up here as "a clone cannot be given a Firecrawl key
sensibly, so the call must travel". That was reasoning from the wrong
precedent, and reading Mission Control settled it:

* `FIRECRAWL_API_KEY` is **already fleet policy** — a `prime_secret_forwards`
  row, alongside `ANTHROPIC_API_KEY`, `DOMAIN_API_KEY`, `PERPLEXITY_API_KEY`
  and six others. Somebody already decided this key may travel.
* Mission Control's own environment **holds no value under that name**, so
  the forward is authorised and does nothing. Measured 4 Sep 2026 on the first
  clone driven to `ready`: 72 secrets read `missing` and ten of them were
  authorised forwards that silently did not happen, `FIRECRAWL_API_KEY` among
  them.
* `hooks/fleet-secret-forward-reconcile` is a scheduled cron that applies fleet
  policy to clones **that already exist** — so a value set now reaches the three
  live clones on the next pass, not only the next clone provisioned.
* Mission Control's own secrets page already renders the exact remedy:
  *"Fleet policy forwards this name and Mission Control holds nothing to
  forward. Set it in Mission Control's own environment, or withdraw the
  forward — not here."*

**So the act is: set `FIRECRAWL_API_KEY` in Mission Control's environment.**
Nothing needs to be built, and nothing needs to be typed on a clone.

Why forwarding is right here, where `AIRTABLE_TOKEN` and the Didit key are
brokered: those two are withheld because their SCOPE exceeds the job — an
Airtable PAT reaches every base it was minted with, and a Didit key can list
its application's sessions, including other tenants' passport portraits. A
Firecrawl key fetches the URL it is handed and can read nothing of anyone
else's. What it carries is **spend**, and spend is the case forwarding already
handles: `_shared/apiUsageBilling.pure.ts` maps firecrawl to a billable vendor,
so a clone's scrape is metered and recharged to that tenant.

### The brokered path is the fallback, not the plan

`scrape-property-listing` resolves a route — `direct` wherever the deployment
holds the key, `broker` only where it holds none and can reach Mission
Control, `none` otherwise, saying which. Once the forward carries a value every
deployment takes `direct` and the broker branch is never entered.

It is kept because a deployment with no key should say so rather than fall
silently through to a model search, and because withdrawing the forward stays
available as a decision. **It is inert until Mission Control serves the path
below**, and that is a deliberate second choice, not an outstanding task.

```
POST /api/public/page/read
     x-clone-api-key: <the clone's Mission Control key>
     { "url": "https://www.domain.com.au/..." }

→ 200 { "markdown": "...", "title": "...", "description": "..." }
→ 4xx with `x-mission-control-refusal` set on its OWN refusals, never on a
  relayed vendor error — both ends answer similar JSON and send an operator
  to opposite remedies.
```

Its handler **must re-assert the host allow-list**. A brokered read fetches a
URL a tenant named and spends the prime's Firecrawl credits, so it cannot trust
its caller. Import `PROPERTY_LISTING_HOSTS` / `refusePageReadUrl` from
`_shared/pageRead/pageReadRoute.pure.ts` rather than restating the list — two
copies is how a broker comes to accept a host the caller's own normaliser would
have refused. The eight portals are the narrow list on purpose: widening them
widens what any tenant can bill to the prime.

Until that ships — if it is ever built — a clone scrape still falls through to
the model search and still draws the provenance warning, which is exactly
today's behaviour.

### The per-clone path, if one deployment needs it before the forward is set

The audit's own wording for this item — *add `FIRECRAWL_API_KEY` on the clone's
Integrations page* — is performable right now, and it was checked end to end
rather than assumed:

* the **Firecrawl** card exists on the Integrations page under Automation, with
  one required field, `FIRECRAWL_API_KEY`;
* that name is in `ALLOWED_INTEGRATION_SECRETS` and is **not** one of the six
  `LISTINGS_PIPELINE_SECRETS` the page refuses, so the write is accepted;
* `update-integration-secret` puts it in the **project environment** — on a
  clone through Mission Control's broker, because a clone must never hold the
  Supabase management token — which is where
  `Deno.env.get("FIRECRAWL_API_KEY")` reads it from.

Saving it requires a superadmin and a recent reauthentication
(`step_up`, capability `secrets.update`).

**Doing this now does not conflict with the broker.** `resolvePageReadRoute`
returns `direct` whenever a key is held and only falls to `broker` when none
is, so a key set today is used today, and clearing it later hands the same
deployment to Mission Control with no code change and nothing to undo.

Prefer the fleet forward above: one value, every clone, including the ones
already provisioned, with no second key to mint or rotate. Use this only to
unblock a single deployment sooner, or where that deployment is meant to spend
its own Firecrawl account rather than the prime's.

## 3. Builder Stock

The network holds **1,066 stock items** and has composed **91 outbox events**.
None of it reaches a clone, for two independent reasons.

**Reason one, fixed in code.** `builder_network_stock_ranked` and the `rank_*`
columns arrive with `20261202090000`, which no clone has, so the marketplace
answered PostgREST 42P01 and the tab said "Builder stock could not be loaded".
It now falls back to the base table and reports `ranked: false`, so a clone
that HAS stock will show it, newest first, saying plainly that the order is not
merit.

**Reason two: the row that would carry them has no writer anywhere.**
`builder_network_connections` holds zero rows on the clone — and on the prime —
so no event is delivered and the mirror stays empty. This was first written up
here as "cannot be created by one side alone", which is true and is not the
problem. The problem is that the side which is supposed to create it never had
the code.

Read across the three repositories, one act has three owners and no
implementation:

| Where | What it says |
|---|---|
| clone — `20261121000000_builder_network_mirror.sql` | the transport credential "is written into `outbound_hmac_secret` by Mission Control's provisioning machinery" |
| Mission Control — `20260914130000_builders_network_trust_anchor.sql` | it is "the trust anchor and nothing else … operator visibility only, never authoritative" |
| extraction plan §2 | per-connection credentials are "minted by the clone at connection time" |

The product reads `builder_network_connections` in four places
(`builder-stock-marketplace`, `cross-portal-outbox-worker`, and twice in
`_shared/builderNetwork.ts`) and writes it in **none**. `builderNetwork.ts`
states the rule outright: *"Nothing here invents a connection."*

The network side is not the gap. `builder-network-admin` already offers
`upsert_workspace`, `create_connection`, `provision_transport`,
`rotate_transport` and `set_inbound_url`; acceptance mints the shared
credential, and `provision_transport` hands it back — once — under a comment
naming the catcher:

> Returned ONCE, for MC to install in the clone's
> `builder_network_connections` row alongside this URL.

**Mission Control never wrote that catcher.** Its console can register a
workspace, mint an invite, revoke, and set the network's inbound URL
(`setNetworkConnectionTransport` → `set_inbound_url`). Nothing in it calls
`provision_transport`, and nothing in it writes a workspace's
`builder_network_connections` row — though it holds every clone's
`supabase_url` and service credentials in `clone_backends` and already writes
to clone projects elsewhere (`branding/mirror.ts`, `cloneSigningPair.server.ts`).

So the feature is complete on both ends and unjoined in the middle, which is
why the table is empty on every deployment rather than only on the clones.

### Finishing it

**Step A — apply the missing migrations.** Each clone repository has the
`Apply a migration` workflow (`.github/workflows/apply-migration.yml`), which
applies ONE named file to that repository's own project. It reads
`vars.SUPABASE_PROJECT_REF` and `secrets.SUPABASE_DB_URL`, so it targets the
clone and nothing else. Dispatch it once per file, **in version order**:

```
20261124000000 … 20261204010000    (17 files, `ls supabase/migrations/`)
```

The three that matter for Builder Stock, and why:

| Migration | What it adds |
|---|---|
| `20261124010000_builder_network_stock_selection_producer.sql` | the inbound sweep and its one-minute pg_cron job |
| `20261201090000_builder_network_stock_consumer_and_agency_disclosure.sql` | the consumer that converges events into the mirror |
| `20261202090000_builder_marketplace_ranking.sql` | `builder_network_stock_ranked` and the `rank_*` columns |

Read `apply-migration.yml`'s header first. It deliberately does **not** run
`supabase db push`: this project's ledger under-reports by about two orders of
magnitude, so a push would replay ~130 already-applied migrations including
data mutations where a second application is not a no-op.

**Step B — establish the connection.** An earlier version of this runbook said
to generate the shared credential by hand and write it into both sides. That is
wrong: the network mints it itself when the builder accepts, and writing a
different value over `workspace_connections.outbound_hmac_secret` puts the row
out of step with the state machine that produced it.

The designed sequence is four acts, on Mission Control's `/builders-network`
console:

1. **Register the workspace** — `upsert_workspace`, which puts the clone in the
   network's directory.
2. **Mint the connection invite** — `create_connection`, which returns an invite
   code shown once and writes the shadow-ledger row tying this connection to a
   clone.
3. **The builder accepts**, in their own portal. Acceptance is what mints the
   shared transport credential; it is RLS-closed and no read returns it.
4. **Install the transport on the clone** — `provision_transport` hands the
   credential back once, with the network's inbound URL, and it has to be
   written into the clone's `builder_network_connections` row in the same act.

**Act 4 is the one with no implementation**, so the sequence cannot be completed
by an operator at all today: the value is returned to whoever calls
`provision_transport`, that call is reachable only through the console's
federation-asserted admin client, and the console has no control that makes it.
A second call answers `transport_already_provisioned`, so a value taken and
dropped is recoverable only by `rotate_transport`.

Three constraints anything built for act 4 has to respect:

- **Prove the clone writable before asking the network.** The grant is
  one-shot, so every refusal discoverable first — no backend, backend not
  `ready`, incomplete credentials, no mirror table, stale key — costs nothing,
  and every one discovered after costs a rotation.
- **Fetch and install inside one server act**, never returning the value to a
  browser.
- **Installing transport is not opening the door.**
  `feature_flags.builder_network_enabled` is a separate decision and must stay
  one; a credential that enables itself is how a dark feature turns itself on.

**Step C — confirm by effect, never by configuration.** The one-minute sweep
(`builder_network_apply_inbound_events`) should move rows into
`builder_network_stock_items` on the clone. Check `integration_outbox.attempts`
and `net._http_response.status_code` rather than the pg_cron run's own status:
pg_cron reports on the SQL that queued the HTTP call, not on the call.

## Why all three were silent, and why two were misread

In each case the product reported the *consequence* rather than the *cause* —
an empty feed, a scrape about the wrong property, a marketplace that could not
be loaded. The fixes above make each one say which absence it is, and that is
the part worth keeping: the next gap of this shape should be readable from the
screen rather than from a migration ledger.

The second lesson cost more. All three presented as *"this clone is missing
something"*, and only one of them was:

- §1 **was** a clone gap — rows a migration inserts do not travel.
- §2 was a value absent on **Mission Control**, for a forward already
  authorised fleet-wide, with a cron already scheduled to deliver it.
- §3 is absent on **every deployment including the prime**, because the act
  that creates it was never implemented on any side.

Both misreadings came from measuring the clone and stopping there. A clone is
a copy, so almost anything broken on one is also worth checking on the prime
and on whatever is supposed to supply it — and the cheap test is the one §3
failed for weeks: **a feature absent on every deployment is unbuilt, not
unprovisioned.** Where a comment names another system as the owner of an act,
read that system before believing it; two of the three owners named here
disclaim the act in their own source.
