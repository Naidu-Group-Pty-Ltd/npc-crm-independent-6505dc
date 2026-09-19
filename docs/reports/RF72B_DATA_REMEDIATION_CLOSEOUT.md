# RF-7.2B — data integrity remediation: closeout

## 0. What is built versus what is live — read this first

RF-7.2B built the safety infrastructure. **It did not switch production onto
it.** A report generated today receives exactly what it received before, because
nothing calls the gate yet.

Stating that distinction plainly matters more than the work sounding finished:
an earlier draft of this document and its pull request asserted that new reports
were already protected, and that was wrong.

### IMPLEMENTED / PROVEN

| Item | State |
| --- | --- |
| Client-Safe Gate module | exists, tested |
| Safe ABS routing (geography → POA → `abs_census_poa`) | exists, tested |
| Safe RBA monthly-average projection | exists, tested |
| Unsafe Location inputs **can be** blocked | exists, tested |
| Safe narrative bundle | exists, tested |
| Market-claim reconciliation | exists, tested |
| Visibility / null policy | exists, tested |
| Rent-basis metadata **understood if supplied** | exists, tested |
| `bindingResolver` null-before-formatting fix | **LIVE in production** |
| Template inline-expression guard | exists, proven safe across all families |
| Historical impact register | exists |

### NOT YET PRODUCTION-ACTIVE

| Item | State |
| --- | --- |
| Investment generator consumes the Client-Safe Gate | **NO** |
| Production narrative consumes only `narrativeBundle` | **NO** |
| Generated demographics structurally prevented from new generation | **NO** |
| Hardcoded / LLM RBA values structurally prevented from the live generator | **NO** |
| Safe ABS data is the live generator's market-data source | **NO** |
| Safe RBA data is the live generator's economic-data source | **NO** |
| Visibility policy is the Viewer/PDF visibility authority | **NO** |
| Chart-null policy adopted by production charts | **NO** |
| Rent-basis production capture | **NO** — contract support only |

**Ready for RF-7.2C: NO — RF-7.2B.1 forward-safe data activation required.**

## 1. What changed in production, precisely

**Exactly one change reaches production: the binding formatter.** Nothing else
in this stage is on the live path — see §0.

`bindingResolver.resolveBindable` now establishes presence **before** applying
filters. Previously filters ran first and the null check second, so
`Number(null) === 0` made an unknown LVR render `0%` and an unknown rent `$0`.

Everything else in this stage is **additive and unwired**: the Client-Safe Data
Gate, the safe market-fact projection, the visibility policy and the rent-basis
fields have **no production consumer**.

### The measured blast radius of that one change: zero

The old behaviour could only fire when a `null` or `''` reached a formatter.
Every binding projection in the fleet guards its writes with the same line:

```ts
if (value !== undefined && value !== null && value !== '') target[key] = value;
```

| Projection | `put()` guard | literal nulls in bound objects |
| --- | --- | --- |
| `reportBindingProjection` (Investment) | ✓ | 0 |
| `cashFlowProjection` | ✓ | 0 |
| `cashFlowComparisonProjection` | ✓ | 0 |
| `borrowingCapacityProjection` | ✓ | 0 |
| `portfolioProjection` | ✓ | 0 |
| `comparisonProjection` | ✓ | 0 |
| `clientDetailsProjection` | ✓ | 0 |
| `commercialCapacityProjection` | ✓ | 0 |
| `marketIntelligenceProjection` | ✓ | 0 |
| `reportQaProjection` | ✓ | 0 |
| `organisationProjection` | ✓ | 0 |

(`absCensusProjection` is not a binding projection — it shapes the ABS service
responses.) The literal nulls the adapters do carry are all in **`meta`**
(`variant: null`, `tier: null`) — routing metadata that never reaches a
`{{…}}` binding.

**So no currently-rendered value changes.** The fix removes a latent hazard that
was masked by one line in each projection, and that masking is exactly why it was
worth fixing: the guarantee rested on eleven copies of a convention rather than
on the renderer.

### One deliberate exemption

Filters that exist to *answer* absence must still see it — `fallback`,
`default`, `if`, `eq`, `neq`, `exists`, `empty`, `unless`. The existing suite
caught this on the first run (`{{missing | fallback:"n/a"}}` returned `''`),
which is the guard doing its job.

## 2. Delta ledger (§29)

| Field class | Delta | Classification |
| --- | --- | --- |
| Every bound fact, every family, current corpus | **none** | no projection can emit the triggering value |
| `null` / `''` + a numeric formatter | `$0` / `0%` → omitted | **null suppressed** (latent path only) |
| genuine `0` | `$0` / `0%` unchanged | **genuine zero preserved** |
| negative values | unchanged | — |
| absence-aware filters | unchanged | — |
| Gate / safe-facts / visibility / rent-basis | n/a | **additive, no consumer** |

**No unexplained delta.**

## 3. Semantics established before wiring (§4)

`rba_series_meta` for the only cash-rate series held:

| field | value |
| --- | --- |
| `series_id` | `FIRMMCRT` |
| `title` | Cash Rate Target |
| `description` | **"Cash Rate Target; monthly average"** |
| `frequency` | Monthly |
| `table_code` | f1.1 |
| `last_observation` | 2026-08-31 |
| `publication_date` | 01-Sep-2026 |

It is a **monthly average of the target**, not a spot rate. Months with no
policy change sit on the 25bp ladder (3.60, 3.85, 4.10, 4.35); months containing
one do not (4.31, 3.96, 3.83, 3.70). The safe projection therefore publishes
*"cash rate target, monthly average for August 2026, published 01-Sep-2026"* and
a test forbids the phrases "current rate" and "today".

### A correction to RF-7.2A

RF-7.2A's first write-up said the rate "moved 4.35 → … → 3.60; the constant was
right only at the start." **That was backwards.** The target was **3.60**
through the months that produced 1,035 of these reports and rose back to 4.35 by
mid-2026 — so the constant *overstated* the rate by 75bp on the bulk of the
corpus and is **accidentally correct today**. The counts were measured and
stand; the direction did not. `INVESTMENT_REPORT_DATA_CONTRADICTIONS.md` §3
carries the corrected table.

That makes the finding worse, not better: a constant that happens to be right is
one RBA decision away from being silently wrong again.

## 4. Demographics routing (§3)

| Measure | Result |
| --- | ---: |
| Live reports | 1,207 |
| With trusted geography (`resolved` / `resolved_with_warning`) | **867** |
| Of those, matching `abs_census_poa` | **867 (100%)** |
| Of those, matching `abs_seifa_poa` | **867 (100%)** |
| Routable | **71.8%** |
| **Unavailable** (no estimate, no substitution) | **340** |

Nine fields, all at **postcode** grain, all carrying the 2021 Census reference
period. No client label contains the word "suburb".

## 5. Template scan (§20)

Scanned **all** families before prohibiting anything:

| Population | Rows | With `{{= }}` |
| --- | ---: | ---: |
| `report_templates` (all) | 113 | **0** |
| `report_templates` (active) | 16 | **0** |
| `template_library_entries` | 543 | **0** |
| active with `{{@ }}` computed refs | — | **0** |

No family depends on an inline expression, so the forward guard breaks nothing.
The guard is on template **sources**; the resolver keeps `evalConditional` for
`block.conditional` / `page.conditional`, which is presentation, not a fact.

## 6. Correction versioning — designed, not executed (§26)

Should a correction ever be authorised:

1. the original artefact and its `report_versions` row are **preserved**;
2. a **new** version is created — never an overwrite;
3. the new version records: original generation, corrected generation, reason,
   facts changed, source changed, correction timestamp.

`investment_reports` already carries `current_version` and `report_versions`
already stores history, so the mechanism exists. **Nothing executes it**, and
nothing in RF-7.2B writes to a stored report.

## 7. Reproducing the historical segmentation

The segmentation in `HISTORICAL_DATA_IMPACT_REGISTER.md` is a single read-only
query over `investment_reports` joined to `rba_observations` and
`client_portal_reports`. It classifies each report by: does it carry an unsafe
value; is it printed in `report_content`; is the authority cited; is delivery
evidenced (`pdf_url` or a `client_portal_reports` row); is it incomplete; is it
superseded. The seven segments are exhaustive and sum to 1,207.

## 8. Deliberately not done

| Item | Why |
| --- | --- |
| Wiring the gate into the generator | RF-7.2B proves the layer; **RF-7.2B.1** is the activation stage |
| Connecting SEIFA, crime, climate, schools, transport | grain/date/semantics cannot all be matched honestly yet (§8 of the mandate) |
| Extending `reconcileFacts` over market statistics | the inputs must be sound first — reconciliation proves faithfulness, not truth |
| Any visual redesign | RF-7.2C |
| Any other report family | Investment first |
| Any historical rewrite | forbidden, and nothing does it |

## 9. Remaining not-client-safe facts

Still blocked, and still stored on historical rows:

`market.walkScore`, `market.commuteDurationMinutes`, `market.schoolsWithin3km`,
`market.transportQualityScore`, generated demographics, the hardcoded cash rate,
the LLM-sourced cash rate.

Still unavailable for want of evidence: growth, vacancy, demand, comparable
sales, infrastructure, current LVR, tax treatment, rental-growth assumption,
`yearBuilt`.
