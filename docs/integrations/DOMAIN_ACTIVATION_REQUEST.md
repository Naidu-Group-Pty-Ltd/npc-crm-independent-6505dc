# Domain API — activation request

> **Re-measured 15 September 2026, 13:53 UTC, from the production egress
> (`market-source-probe`, invoked from the production database; read-only,
> writes nothing).** `DOMAIN_API_KEY` is set (no OAuth pair). Domain answered:
>
> | route | status | Domain's body | header |
> | --- | --- | --- | --- |
> | `GET /v2/suburbPerformanceStatistics/NSW/Bowral/2576` | **403** | `{"type":"…/docs/latest/conventions/access","title":"Not Authorized","detail":"Operation not permitted on project"}` | no `X-Domain-Security-Reason` |
> | `GET /v1/properties/_suggest` (Address Suggestion) | **403** | the same body | no `X-Domain-Security-Reason` |
> | `GET /v1/suburbPerformanceStatistics/NSW/Bowral` (control) | 404 | `No Matching Route` | — |
>
> **This settles the both-403 ambiguity below.** The key is recognised (an
> unrecognised key answers 401), and Domain's own words say the PROJECT the
> key belongs to permits no operation — on either product. Domain's access
> conventions page (the `type` the body links to) states it in one sentence:
> *"you will not be able to access any API Endpoint until the required API
> package(s) have been added to your project."*
>
> **The remedy is in the Domain Developer Portal, not in a message to Domain:**
>
> 1. Sign in at `developer.domain.com.au` with the account that minted the
>    key this project runs on (`DOMAIN_API_KEY`, a `key_…` value).
> 2. **Projects → the project → API Access** (the portal's own name for the
>    page): add the **Properties & Locations** package — it carries
>    `api_suburbperformance_read` — and Save. Address Suggestion is a separate
>    package and is not needed for the grade.
> 3. If the portal states that the package is on a paid plan for this account,
>    that is the commercial decision the zero-cost addendum below defers to
>    the owner; the portal publishes no plan material, so only the account
>    page can say.
> 4. Then either re-run the probe (`market-source-probe`, targets
>    `domain_v2_suburb_performance`) or open any report and regenerate: the
>    grade appears on the next generation with no further code change,
>    because `domain-data-service` already requests the v2 route with the
>    trusted postcode and the scoring engine already reads the series. Until
>    then every new report reads *"grade withheld … growth: … (domain: HTTP
>    403 — Domain says "Operation not permitted on project": the Properties &
>    Locations API package is not attached to the project this key belongs
>    to; attach it under API Access …)"*, which is the same finding stated on
>    the record.
>
> The messages below stay as written for the case the portal cannot settle —
> for instance if the package is attached and a 403 persists, when the
> `X-Domain-Security-Reason` header, if one then appears, is what to quote.

> **Since 15 September 2026 (evening) the grade no longer depends on this
> package.** The open-data sales registers — Queensland's Statistician by
> local government area and NSW's DCJ Rent and Sales Report by postcode —
> supply the growth series at no cost under CC BY 4.0
> (`docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md`). Domain stays first-class:
> its suburb-grain series outranks a council or postcode one in the merge
> the day the package is attached, with no code change. This request is
> therefore an improvement to the grade's confidence, not its condition.


One message, ready to send, plus the evidence behind it. Nothing here is
speculative: every technical statement was measured, and the questions are the
ones whose answers change what this platform may do with the data.

**The probe has run — once, on 2026-09-08 at 15:42 UTC — and it selected the
both-403 branch below.** Both `domain_address_suggest` and
`domain_v2_suburb_performance` answered **HTTP 403**, and **no
`X-Domain-Security-Reason` was returned** on either. The status alone does not
carry the cause: Domain documents a missing scope, a plan that does not
include the API, an environment restriction, an access restriction, an invalid
or expired key, and other internal denials as causes of the same 403 — and
they do not share an owner or a remedy. So the message to send is the
**both-403 message** below; do not re-run the probe first (audit §66 — one run
settles the state until Domain configuration changes).

The readings that decide which message is correct come from the probe rather
than from inference (audit §62.3):

| probe result | what to send |
| --- | --- |
| **Address Suggestion 200 + Suburb Performance 403**, with `X-Domain-Security-Reason` naming a scope, package or plan | the message below, **as written** — the key works, and the ask is the smallest activation that discharges that exact reason |
| **Both 403** ← **the 8 Sep 2026 result** | **send the both-403 message below**, not the activation message. Where `X-Domain-Security-Reason` was returned, quote it verbatim; where it was absent — as on the 8 Sep run — there is nothing to quote, so the message asks Domain to state which restriction produces the 403. Both-403 is ambiguous — it is equally consistent with a project configuration, a missing scope, an environment or plan restriction, the key's own state, and a WAF refusal that never reached Domain's gateway |
| **Both 401** | not a commercial matter yet — an authentication or key question for the operator |

An earlier version of this document said that both-403 meant "the key holds no
packages" and to broaden the ask accordingly. That was a conclusion drawn from a
status code, and it is removed: it would have opened a larger commercial
conversation than the evidence supports, on a premise nobody had established.

**Do not discuss pricing in this message.** It is a scope and rights request.

**State of the code (15 Sep 2026).** `domain-data-service` now requests the
v2 route with the postcode as a path segment (`domainSuburbPerformanceUrl`),
keyed on the geography resolved from the verified coordinate, and extracts
the series once (`domainEvidence.pure.ts`). Its refusal — status and
`X-Domain-Security-Reason` where Domain sends one — travels onto the report's
grade as a named gap, so while the 403 stands every new report reads *"grade
withheld … growth: No suburb capital-growth series for … (domain: HTTP 403
…)"* rather than a silent absence. When Domain lifts the restriction the
grade appears on the next generation with no further code change. Every
point is stamped `licensingStatus: 'unverified'`
(`DOMAIN_SUBURB_PERFORMANCE_LICENSING`) until the rights follow-up below is
answered; until then the score uses the figures and the client document does
not print their provenance.

---

## The message — both-403 branch (the branch the 8 Sep 2026 run selected)

> Subject: HTTP 403 on two products for an active API key — please identify the restriction
>
> Hello,
>
> We hold an active Domain API key and are building suburb-level market
> analysis for Australian residential property. As of 8 September 2026 that
> key returns **HTTP 403** on both:
>
> - `GET /v1/addressSuggestion` (Address Suggestion), and
> - `GET /v2/suburbPerformanceStatistics/{state}/{suburb}/{postcode}`
>   (Suburb Performance Statistics),
>
> and no `X-Domain-Security-Reason` header is returned on either response, so
> we cannot tell from our side which restriction applies.
>
> Could you please:
>
> **1. Identify what produces the 403** for this key on those two endpoints —
> for example a project or account configuration, a missing scope, a plan or
> environment restriction, the key's own state, or a gateway/WAF rule. We are
> deliberately not guessing among these.
>
> **2. Confirm whether `api_properties_read` and `api_suburbperformance_read`
> can be enabled on our existing application at no additional charge**, or
> tell us what their activation involves.
>
> Once access is clarified we have a short follow-up on response content,
> history depth, caching/persistence/display rights and attribution, so we can
> configure our use to match your terms exactly.
>
> Thank you,
> Aurixa / NPC Services

---

## The message — Address Suggestion 200 + Suburb Performance 403 branch (send only if a future reading selects it)

> Subject: API package activation — Suburb Performance access for an existing key
>
> Hello,
>
> We hold an active Domain API key and are building suburb-level market analysis
> for Australian residential property. Our key currently returns HTTP 403 on
> `GET /v2/suburbPerformanceStatistics/{state}/{suburb}/{postcode}`, which we
> read as the required package not being attached to our project.
>
> Could you please:
>
> **1. Confirm and activate access.** Our key already succeeds against Address
> Suggestion (`api_properties_read`), so the application itself is working.
> Please confirm whether that same key/application can be granted the
> **`api_suburbperformance_read`** scope — via the **Properties & Locations**
> package or whatever the smallest applicable activation is — or whether a new
> application is required.
>
> *(Insert Domain's own `X-Domain-Security-Reason` here verbatim if one was
> returned — it names the restriction and saves a round trip.)*
>
> **2. Confirm what the Suburb Performance response contains**, specifically:
> - median sale price by period at suburb grain;
> - **house and unit reported separately**;
> - how many historical periods are returned, and the maximum available depth;
> - the **transaction/sample count** behind each period, if supplied;
> - the period type (monthly / quarterly / rolling 12 months) and the as-at date.
>
> We need enough history to compute a 1-year movement and 3- and 5-year compound
> growth. We calculate those ourselves from your observations — we are not asking
> you to supply pre-computed growth rates.
>
> **3. Tell us which demand measures are available at suburb grain** on this or a
> related package — for example days on market, auction clearance rate, vendor
> discount, listing or stock counts, sales volumes, or median advertised rent. We
> would rather use fewer measures we can rely on than a wider set we cannot.
>
> **4. Confirm the following usage rights in writing**, as they determine what we
> may build:
> - **Caching** — the maximum period we may retain a response;
> - **Derived metrics** — whether we may compute and store values derived from
>   your data (for example a growth rate or an internal score);
> - **Persistence** — whether we may retain observations as a historical record
>   beyond the cache window;
> - **Client-facing display** — whether figures, or metrics derived from them, may
>   appear in a report or PDF supplied to our clients;
> - **Attribution** — the exact wording and placement you require where they do.
>
> **5. Rate limits and quota** for the plan attached to this package, and whether
> the limits are per key or per account.
>
> For scale: our first extraction is **248 requests** (one per suburb ×
> dwelling class, measured against the sealed `me7.pop.1` population) covering
> 665 properties across 228 suburbs, and ongoing use is a similar order per
> refresh.
>
> Thank you,
> Aurixa / NPC Services

---

## Why each question is asked

| # | question | what the answer decides here |
| --- | --- | --- |
| 1 | package + scope on the existing key | whether this is a switch-on or a new application |
| 2 | series shape, dwelling split, depth, sample | `growth1Year`, `growth3YearCagr`, `growth5YearCagr` need ≥ 5 years; a blended house/unit median serves neither; `sampleSize` is 0.20–0.25 of every confidence reading |
| 3 | which demand measures exist | Demand components with no evidence stay **absent** — never zero, never 50 |
| 4 | caching / derived / persistence / display / attribution | `EvidencePoint.licensingStatus` defaults to `unverified`, and `mayReachClientReport` admits only `open` and `licensed_for_client_reports`. Until these are answered in writing a Domain figure may be scored in a shadow backtest and **may not** be rendered to a client |
| 5 | rate limits, per key or per account | this platform forwards the prime's keys to every clone, so a per-key limit is a fleet-wide ceiling |

## What is deliberately not asked

No pricing. No products beyond what Growth and Demand need — Domain publishes
several packages this programme has no use for, and asking for them invites a
larger conversation than the evidence requires. And no request for pre-computed
growth figures: Aurixa owns that arithmetic
(`growth/growthPeriods.pure.ts`), which is what lets a report show its working
rather than assert a number.

## Zero-cost addendum (ME-6, 2026-09-08)

A commercial constraint now governs this: **Aurixa is not purchasing additional
property-data subscriptions at this stage.** That changes what is being asked
for, not the standard of evidence.

### The one question that now leads

**Can `api_properties_read` and `api_suburbperformance_read` be enabled on the
EXISTING Aurixa application at no additional charge?**

Everything else in the message above still stands and still needs answering.
But this question is now first, because its answer decides whether Domain is a
switch-on or a purchase — and a purchase is out of scope.

### What was established from Domain's published material

Measured 2026-09-08 against `developer.domain.com.au`:

- The two scopes belong to the **Properties & Locations** package, which the
  portal describes as *"Explore auction results and property datasets. Access
  market performance and demographic stats."* Its endpoint list carries
  `GET /v2/suburbPerformanceStatistics/{state}/{suburb}`,
  `/v2/suburbPerformanceStatistics/{state}/{suburb}/{postcode}`,
  `GET /v2/demographics/{state}/{suburb}/{postcode}` and `GET /v1/properties/{id}`.
- Address Suggestion is a **different package** (`pkg_address_suggestion`),
  which is why the probe tests both on the one key: it separates *is the key
  recognised* from *is this product on the project*.
- **Domain publishes no pricing or plan material on the developer portal.**
  `/pricing`, `/plans` and `/docs/latest/packages` all answer 404, and the
  package pages carry no cost, plan or tier language. Package entitlement is
  therefore an account question, not a documented one — the same shape as
  PropTrack's trial.

### How the answer is recorded

| Domain's answer | recorded as | consequence |
| --- | --- | --- |
| both scopes enabled on the existing key, no charge | `existing_licensed` | Domain becomes the primary Growth source; may become production evidence |
| enabled but requires a paid package | `commercial_upgrade_required` | **no purchase is made.** The integration is NOT removed — it stays wired, and the gap is recorded so it is visible rather than looking like an absent source |
| key not recognised at all | operator-side remedy, not an entitlement finding | re-issue the credential; this is not a commercial conversation |

**The integration stays.** `domain-data-service`, the six `DOMAIN_*` credential
names, the probe targets and the registry card are all untouched by a
`commercial_upgrade_required` answer. Recording a gap is not the same as
removing a route, and a removed route is one nobody can switch back on.

### Why this matters more than it did last week

The zero-cost open-data inventory
(`_shared/reports/market/zeroCostSources.pure.ts`) measured the alternative and
it does not cover the corpus. **Queensland is 53.7% of the Growth-addressable
corpus and publishes no open suburb-level median sale price series; Western
Australia is 20.8% and its only candidate is `Custom (Other)` licensed.**
Victoria publishes exactly the right dataset under CC BY and its host refuses
scripted clients from both egresses.

So Domain's existing entitlement is not one option among many. It is, with the
PropTrack trial, one of only two routes to suburb-level Growth evidence for
three quarters of the properties Aurixa actually reports on.
