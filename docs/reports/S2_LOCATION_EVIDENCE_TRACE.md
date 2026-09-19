# S2 — why Location is never measured, and what transport actually says

Two traces. The first is the stage's own subject: the Location dimension has
been unmeasurable on every report, and the reason is a single assignment. The
second answers the owner's correction C3: the transport figures that looked
like a contradiction are not one, and saying they were was an error in the S1
review pages.

Nothing in here changes a scoring formula, a threshold, a weight or a financial
assumption. The financial preservation gate is green at 18 of 18 after every
change below.

---

## 1 · The finding

`verifiedLocationInputs` (`locationInputVerification.pure.ts`) may count exactly
three readings:

| input | read from |
| --- | --- |
| `walkScore` | `enrichment.walkScore` |
| `commuteTimeCBD` | `enrichment.commute.durationMinutes` |
| `schoolsNearby` | `enrichment.schools.schoolsWithin3km` |

The Client-Safe Gate's `DISOWNED_LOCATION_PATHS`
(`safeGenerationInputs.pure.ts`) removes exactly four paths:

```
walkScore · transport.qualityScore · commute · schools.schoolsWithin3km
```

**Three of the four are the three.** So an enrichment that has been through the
gate can never verify a single Location input, however good the acquisition
was.

On its own that is harmless, and by design: the gate exists to keep those four
facts out of the client **narrative**, and the property scoring call at
`generate-investment-report:3759` runs *before* the gate at `:4043`. What makes
it bite is one line:

```ts
enhancedData = safeGeneration.enhancedData as typeof enhancedData;
```

The gate's output replaces `enhancedData` in place, and every persistence site
is downstream of it — the early write, the progressive write and the final
write all stored `enhancedData.locationIntelligence`. So the **record** lost
the readings, permanently.

And `assessEnrichmentReuse` checks the acquisition stamp, which the gate leaves
untouched. A resume therefore found a complete, subject-matched enrichment and
reused it — with its evidence removed. Since a Compass is finished by the
resume worker, the run that writes the document scores Location on nothing.

The record says so itself. On report `9bd41c05-7f9b-41e8-819a-a029f4121369`:

```
location_intelligence keys : schools, amenities, lifestyle, transport,
                             healthcare, coordinates, __acquisition
walkScore                  : (absent)
commute                    : (absent)
schools.schoolsWithin3km   : (absent)

__acquisition.stages       : places "complete", commute "measured",
                             geocode "fetched", commuteProvider "osrm"
__acquisition.subjectKey   : 18 annabelle crescent kellyville nsw 2155|2155|nsw
```

Absent rather than reordered: `jsonb` sorts keys by length then bytewise, and
the stored order is exactly that sort over the keys present — `commute` (7)
would precede `schools` (7), `walkScore` (9) would follow `transport` (9), and
`schoolsWithin3km` would sit beside `distanceToSchool`. None of the three is
there.

And the stored gap reads, verbatim:

> *No location readings (walk score, commute, schools) were presented for this
> run.*

— which is `presentedFor('location', input).length === 0` in
`scoringV2Production.pure.ts`, beside a stamp saying every stage ran. Its
remedy — *"Regenerate the report"* — reproduced the same outcome, because the
gate stripped the new acquisition too and the reuse guard preferred the old
one. A remedy that cannot discharge its own reason is the pattern
`refreshRemedy` already names in the AML module.

## 2 · The repair

Two halves, and both are narrow.

**The record keeps what was measured; the narrative still does not see it.**
`generate-investment-report` captures `measuredLocationIntelligence` immediately
before the gate overwrites `enhancedData`, and all three persistence sites write
that. The gate's output is still what the model is handed, and every disowned
fact is still withheld from it — `locationEvidencePersistence.spec.ts` pins
both directions.

Restoring the record puts `walkScore` back within reach of one projection that
hands a stored report to a model: `compare-investment-reports`. So the gate is
applied *there*, at the boundary where a model reads it, which is where it
belonged — and the comparison prompt no longer names `walkScore` among the
fields to differentiate on, because naming a field that is always withheld is
how a model comes to supply one.

**An enrichment already persisted in the damaged state is refused.**
`assessEnrichmentReuse` now returns `readings_missing` when the stamp records
`places: 'complete'` while the readings that stage produces are gone. The
invariant is exact: `measuredWalkScore` returns a number whenever every lookup
answered, and so does `measuredCount`, so `places: 'complete'` beside an absent
`walkScore` cannot be a live acquisition. **No migration touches a stored row** —
the ~1,100 reports holding a stripped enrichment re-acquire on their next
generation, which is the same remedy a missing stamp already uses.

The commute is deliberately **not** checked: the gate removes all four paths
together, so one places reading already identifies a gated object, and
asserting a shape for the commute would tie this guard to whichever provider
measured it. `no_route` and `destination_unknown` stay reusable.

### Assessment impact

Honestly stated, because it has two halves.

- **For reports generated from here**: Location becomes measurable when its
  readings are present and subject-matched, so a Compass can measure four
  dimensions where it measured three, and evidence coverage rises accordingly.
  **No weight, threshold or formula changed** — `scoringV2Production.pure.ts`
  and `locationScoring.pure.ts` are untouched. The engine asked for these
  inputs all along.
- **For reports already written, including the reviewed one**: the readings are
  gone from the record and cannot be recovered from it. They come back only on
  a regeneration, which now re-acquires rather than reusing the stripped copy.
  Nothing here rewrites a stored grade, and no stored report changes on its own.

Until a regeneration is run and observed, the size of the coverage and grade
change is **not measured** — it depends on readings this record no longer
holds. That measurement belongs to S5's suite verification.

---

## 3 · Transport: what each figure actually measures

The S1 review page asserted that `stopsWithin1km: 117`, a stop list of eight and
a `Public Transport` count of nought "cannot be reconciled from the record".
**That was wrong**, and the correction is accepted. Traced through acquisition,
transformation, persistence and scoring, all three are consistent.

| figure | what it actually is |
| --- | --- |
| `transport.detailedStops` | the **nearest eight** — `within.slice(0, MAX_NAMED_STOPS)`, `MAX_NAMED_STOPS = 8`. A deliberate sample, not a complete list. |
| `transport.stopsWithin1km` | `countWithinRadius` — **every** grouped place within `radiusMetres`, which is `NEARBY_RADIUS_M = 1_600`. The field name says 1 km and the value counts 1.6 km. |
| `transport.radiusMetres` | 1,600, carried beside the count, which is how the misnomer is detectable at all. |
| duplicate handling | grouped by the publisher's own `parent_station ?? stop_id` before counting, so a station and its platforms are one place. Thirteen rows at Parramatta are one entry. |
| pagination | the near query is a bounding box with **no row limit**; `FAR_QUERY_LIMIT = 200` applies only to the wider coverage probe used when nothing is within the radius. The count is not truncated. |
| distance | **straight-line** (`haversineMetres`). Nothing in this platform measures a walking route. |
| `amenities[Public Transport]` | a **different register with a different definition**: the OSM amenity register's `transit` category is four exact tag pairs — `railway=station`, `railway=halt`, `railway=tram_stop`, `public_transport=station` — within `RADII.transit = 2000`. No bus stop carries any of them. |

So: 117 and 8 are a total and a sample of the same measurement. 0 and 117 are
two registers answering two different questions — the first says there is no
rail, metro or tram **station** within 2 km, which is true, and says nothing
about buses. Neither pair is a contradiction, and the page will say what each
one measures instead.

### Three defects this did find

**T1 — `stopsWithin1km` is named for a radius it does not use.** Any reader who
trusts the name reports 117 stops within a kilometre when the measurement is
1.6 km. The name is persisted on ~1,100 rows, so the fix is a renamed reading
at the projection with the stored key kept for compatibility, not a rename in
place. *(S3.)*

**T2 — the amenity category is labelled "Public Transport" while measuring
stations.** A nought there reads as "no public transport" on a property 106 m
from a bus stop. *(S3 — the label is the defect, not the measurement.)*

**T3 — every distance on these pages is straight-line and nothing says so.**
The S1 pages' "walk to the stop" and "everyday errands without a car trip" are
claims the evidence does not support. *(S3, with C3.3.)*

---

## 4 · What is not established

- The **size** of the grade and coverage change once Location measures. It
  needs a regeneration; the stored readings are gone.
- Whether any report exists whose enrichment predates the Client-Safe Gate and
  therefore still holds its readings. The population has not been counted.
- The commute reading's field shape across both providers. The guard was
  narrowed so nothing here depends on it.
