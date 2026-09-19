# S4 — what a ten-year outlook can actually be sourced from

Measured **17 September 2026 from the production egress** (Supabase pg_net,
project `dduzbchuswwbefdunfct`), because this repository's sandbox cannot
reach any Australian government host: its proxy answers `403` to `CONNECT`
for every one of them, which is a fact about the sandbox and says nothing
about the source. Every request id is recorded so each reading can be
re-read from `net._http_response`.

The question asked of every candidate was the same three: **does it answer,
under what licence, and can a project be resolved to a property's locality?**
A state-wide list with no location cannot support a sentence about a
property.

---

## 1. What answers

| source | id | result |
| --- | --- | --- |
| data.gov.au CKAN | 269620, 269639, 269640 | **200 JSON.** 2,272 datasets for "capital works"; per-dataset licence (`cc-by`, `cc-by-2.5`) and resource formats |
| data.nsw CKAN | 269621, 269641–269645 | **200 JSON.** 284 transport, 262 health, 27 employment, 13 school-infrastructure matches |
| NSW Online DA register | 269696, 269699–269704 | **200 JSON.** 659 applications for The Hills Shire over six months, across 7 pages |
| QLD spatial ArcGIS (root, Transportation, Economy, Society) | 269629, 269666, 269668, 269669 | **200 JSON.** Road network, school catchments, mining/tourism — assets, not a pipeline |
| NSW planning portal, School Infrastructure, Health Infrastructure (pages) | 269623–269625 | **200 HTML.** Drupal sites, 40–188 KB |

## 2. What does not

| source | id | result |
| --- | --- | --- |
| The Hills Shire Council | 269626 | **400** |
| Fraser Coast Regional Council | 269628 | **400** |
| QLD state development | 269630 | **403**, Cloudflare interstitial |
| data.qld CKAN (both hosts) | 269627, 269646 | **202 with no body** |
| NSW School Infrastructure ArcGIS service | 269665 | **200 carrying an ArcGIS `error 500`** — "Error invoking service". A 200 that is a refusal; the class this repository has met before |
| QLD SIIP (state infrastructure) | 269667 | **200 carrying `{"error":{"code":499,"message":"Token Required"}}`** — not free |
| Drupal JSON:API on the two NSW project sites | 269775–269777 | **not exposed** — the health site serves its own 187,763-byte page for any `/jsonapi` path, the planning portal answers 404 |

## 3. The finding

**No free, keyless, openly licensed register publishes infrastructure
*projects* resolvable to either subject locality.** What is reachable is one
of three things, and none of them is a ten-year pipeline:

- **Assets, not projects.** The ArcGIS services publish the road network,
  school catchments and land tenure — the present, not what is planned.
- **Documents, not data.** The state agency material on data.nsw is
  overwhelmingly PDF audit reports and policy instruments. They are official
  publications and a person can read them; nothing can key them to a suburb.
- **Applications, not a programme.** The NSW DA register is real, current and
  location-bearing, and it is a **six-month window of what private applicants
  lodged**. It is not a public infrastructure programme and cannot answer a
  ten-year question. Queensland publishes no equivalent at all.

Neither council publishes capital works as open data, and both council sites
refuse this egress.

## 4. What this leaves for the owner to decide

The approved evidence policy allows **verified official publications where an
API is unavailable**. That is the only route the measurement leaves open, and
it is not automatable: each project would be read from a council budget or an
agency page by a person, recorded centrally with its provenance, and
refreshed on a stated cycle. Three consequences worth stating before anyone
commits to it:

1. It is **per-locality human work**, repeated whenever a programme is
   republished. It does not scale with the marketplace.
2. It creates a **currency obligation** — a curated project list that nobody
   refreshes becomes wrong in a way the register route never is, because a
   stale API answer still carries its own retrieval date.
3. It is the only route that produces what the brief asks for. A commercial
   provider is the alternative and is a cost decision.

**Pending that decision, nothing here fabricates a pipeline.** The existing
rules hold: a project is named only where a register named it, a status is
the publisher's own word, and the coverage limitation is stated on the page —
and the DA window is now labelled for what it is, six months of private
applications, so it cannot read as a ten-year outlook.

## 5. What was fixed while measuring

See `daModificationDoubleCount.spec.ts`. The register's `ApplicationType` was
declared and never read, so every modification was counted as another
development. On the full live window for The Hills Shire the document was
stating **$2,366,891,383** of development activity against **$1,177,228,202**
of genuinely new proposals, and **3,447** new dwellings against **1,412**.
