# PropTrack API — trial qualification request

Ready-to-send. Nothing here commits Aurixa to a purchase, and nothing here asks
for a credential value.

## What was established without contacting anybody

Measured 2026-09-08 by reading PropTrack's own published pages.

| question | answer | source |
| --- | --- | --- |
| Is there an official trial pathway? | **Yes** | `developer.proptrack.com.au/docs/apis/api-trials`, titled *"API Trial Guide"* |
| Is there a separate trial licence? | **Yes** | *"PropTrack Trial & Evaluation License Terms"*, `/docs/apis/terms-of-use` |
| What does the Market API cover? | Suburb market statistics: **supply & demand, rent insights, sale insights** | `proptrack.com.au/products/property-data-and-insights/apis/` |
| What else is exposed? | Transactions search, sold-transaction search by point/radius, address suggest/match, property sale history, listing history, attributes, listing search | same page |
| How is a trial scoped? | *"During a trial period, you will have access to any of our API endpoints, **based on the arrangement with your Account Manager**."* | the API Trial Guide's own page description, served in the HTML |
| Are there branding/attribution obligations? | **Yes** — *"…compliance with the **Valuer General licensing compliance requirements** relating to disclaimers and branding when sourcing data from PropTrack."* | *Disclaimers and Branding Guide*, `/docs/apis/disclaimers` |

**The commercial terms are not published.** Duration, request quota, whether the
trial is free, caching rights, derived-metric rights and client-facing rights
appear in the Trial & Evaluation Licence, whose body is rendered client-side by
Stoplight and could not be retrieved from this environment — the agent proxy
resets browser tunnels (`ws_closed_mid_exchange` on `developer.proptrack.com.au:443`),
and the Stoplight content API rejects the numeric workspace id the page exposes.

That is not a gap in the research. It **is** the finding: PropTrack does not
publish trial commercial terms, it sets them per account. So the honest next
step is to ask, and to ask in a form whose answers can be recorded against
`EvidenceAcquisition` without interpretation.

## The message

> Subject: PropTrack API trial — evaluation scope and licence questions
>
> Hello,
>
> We operate a property investment analysis platform and are evaluating the
> PropTrack Market API as the market-evidence source behind a suburb-level
> scoring methodology. We would like to take up the API trial described in your
> API Trial Guide.
>
> Our evaluation is a historical backtest over approximately 660 properties,
> concentrated in Queensland (≈54%), Western Australia (≈21%) and Victoria
> (≈17%), across roughly 300 distinct suburbs. The endpoints of interest are the
> Market API's sale insights, rent insights, and supply & demand.
>
> So that we scope this correctly and stay inside the trial licence, could you
> confirm:
>
> 1. Is the trial free of charge, and for how long does it run?
> 2. What request quota applies, per day and in total?
> 3. Which Market API endpoints are included in a trial? Are historic sale and
>    historic rent statistics included, or production-only?
> 4. Is supply & demand included in a trial?
> 5. Is house/unit segmentation available on the suburb statistics?
> 6. How far back does the historical series go, and at what frequency?
> 7. May trial responses be **cached** or stored, and for how long?
> 8. May we calculate and store **derived metrics** (for example a 3- or 5-year
>    CAGR from a median series) from trial data?
> 9. May trial data be used in an **internal, non-client-facing** model
>    validation and backtest?
> 10. May trial data appear in **client-facing reports**, or is that strictly a
>     production entitlement?
> 11. What attribution, disclaimer and branding obligations attach — including
>     the Valuer General requirements referenced in your Disclaimers and
>     Branding Guide?
> 12. What is the process and lead time to convert a trial into production
>     access?
>
> We are not asking for pricing at this stage; we are establishing what the
> trial permits so that our evaluation stays within it.
>
> Kind regards,

## How each answer is recorded

Answers map onto `EvidenceAcquisition` in
`_shared/reports/market/marketEvidence.pure.ts`, and the mapping is mechanical
so nobody has to re-interpret an email months later:

| answer to Q9 / Q10 | recorded as | consequence |
| --- | --- | --- |
| internal evaluation yes, client-facing **no** | `trial_shadow_only` | may be shadow-scored; `mayEnterProductionEvidence` returns **false**, and `acquisitionLicensingConflict` refuses any client-facing licence on it |
| client-facing **yes**, at no charge | `existing_licensed` | may become production evidence |
| trial refused, or paid-only | `commercial_upgrade_required` | no purchase is made; the gap is recorded rather than hidden |
| unanswered | `licensing_unverified` | the default, and not production evidence |

**A trial answer is never widened by inference.** If Q10 is not answered
explicitly, the classification stays `trial_shadow_only` — the conservative
side — because assuming a redistribution right nobody granted is how a licence
gets breached inside a document that has already been emailed to a client.

## What is deliberately not asked, and not done

- **No pricing negotiation.** The standing constraint is zero additional spend;
  asking for a quote invites a purchase decision this phase will not make.
- **No scraping of realestate.com.au.** The trial is the only route pursued.
  PropTrack is REA Group's data arm and the portal's terms are not a substitute
  for an API licence.
- **No credential is requested in writing here.** A key arrives through
  whatever channel PropTrack uses; it is then set as `PROPTRACK_API_KEY` in the
  Supabase runtime and never committed, logged, or echoed by the probe — which
  reports credential **names** and presence only.
- **No adapter is written before the answers arrive.** `proptrack_market_api`
  is already declared in the probe with `auth: not_implemented`, which is the
  honest state: the endpoint is known, the client is not built, and building one
  against unknown trial terms is how trial data quietly becomes production data.
