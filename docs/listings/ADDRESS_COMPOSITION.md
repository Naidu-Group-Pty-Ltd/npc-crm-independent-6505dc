# The address a property is pinned and printed by

Read this before touching `_shared/listingAddress.pure.ts`,
`_shared/builderStockAddress.pure.ts`, the `address` line in
`projectAirtableRecord`, or the geocode query. It is the fourth round of work
on pin placement and the first one that goes to the source.

## The reported symptom

Pins were landing on suburbs. Several properties in one suburb shared a single
mark, and the addresses on screen read as bare suburbs.

## What was actually happening

Airtable's `Property Intake Master` decomposes every address — `Unit Number`,
`Street Number`, `Street Name`, `Street Type`, `Suburb`, `State`, `Postcode` —
because the extraction prompt asks the model for exactly that. It is populated:
**97 of 139 live listings can build a street line from their parts.**

Nothing read them. The projection did

```ts
address = fields['Address'] ?? fields['Full Address']
```

and every surface downstream took that one string. The decomposed parts
travelled all the way into the browser on `PropertyListing` and had **zero call
sites** in the entire frontend.

That would merely be wasteful if the two fields agreed with the parts. They do
not, because of a loop at the source:

1. The extraction model reads `Mortlock Street, Cobblebank` from the email and
   writes `Street Name: Mortlock`, `Street Type: Street`. There is no street
   number in the email, so `Address` is empty.
2. Make's geocode module asks Google for `{{123.address}},{{123.suburb}}` —
   which is `",Cobblebank"`. **No street, no state, no postcode.**
3. Google answers with the Cobblebank suburb centroid, which is the best answer
   available to the question it was asked.
4. A second model call re-parses Google's `formatted_address`, and the write-back
   module sets **eight** columns from that re-parse — `Full Address`,
   `Normalized Address`, `Street Number`, `Street Name`, `Street Type`,
   `Suburb`, `State`, `Postcode`.

So the pipeline overwrote what it had correctly extracted with a strictly
smaller fact derived from its own failed lookup. `Full Address` ends up reading
`Cobblebank VIC 3338, Australia` on a record that knows the street.

Measured 7 September 2026: **202 of 1,019 cached geocodes are `APPROXIMATE`,
collapsing onto 95 distinct coordinates.** `ROOFTOP` answers, by contrast, are
787 rows over 693 points.

## The rule

**The parts outrank any formatted string.** A geocoder's `formatted_address`
describes what it MATCHED, which — when the match was coarse — is smaller than
what the source told us. `composeListingAddress` builds the line from the parts
and falls back to a formatted string only where the parts are empty.

Three things follow.

**Precision is measured, never assumed.** `AddressPrecision` is `address`,
`street`, `locality` or `none`, derived from how far the parts actually reach.
30 live listings carry a suburb and nothing else and that is the correct answer
for them — no parsing invents a street number that was never in the email.

**Evidence outranks the string's shape.** The source's own `Address` field may
establish rooftop precision when it leads with a number, because it is what the
model read out of the email. A geocoder's answer may never, because a
suburb-level match still carries digits — a postcode, a range.

**A formatted locality is not a street.** `Cowra NSW 2794, Australia` is the
suburb written out. Detecting that by comparing the leading segment to the
suburb fails (the segment is `Cowra NSW 2794`, not `Cowra`); it is settled by
subtraction — strike out suburb, state, postcode and country, and see whether
any words survive.

## Builder stock keeps its address in one free-text line

`builder_stock_items` has the same four structured columns and they are nearly
empty, while `address_line` is nearly complete. Of 124 distinct live items,
**93 carry a postcode inside the text and 2 have it in the column.**

The lines look like this, verbatim:

```
Lot 209 - 44 Satinwood Crescent Donnybrook VIC
Lot 36 - Tringa Street, Sandpiper Estate, Tweed Heads South NSW 2486 [Stradbroke 180]
Lot 2065 - Coridale, Lara, VIC 3212
1730 Hornsea Street
```

Every one was handed to the geocoder whole. `parseBuilderAddressLine` takes
them apart, and three rules carry it.

**The bracketed suffix is a house design.** `[Stradbroke 180]` names the
building the builder would put on the lot. 52 of 124 rows carry one.

**A bare leading number is a LOT, not a street number.** This is measured, not
assumed: of the 44 distinct rows that open with a number AND carry a populated
`lot_number` column, the leading number equals the lot in **44** and differs in
**none**. It holds at every magnitude — `105 Slide Place` as much as
`51352 Danube Road` — so size is not the signal and there is no threshold to
tune. The corpus shows one builder writing the same street both ways:
`1730 Hornsea Street` beside `Lot 1731 Hornsea Street`, `312 Splitters Road`
beside `Lot 323 Splitters Road`. Only a number *after* an explicit `Lot N -` is
a street number.

The cost is asymmetric and that is the argument even where a row disagrees:
calling a street number a lot costs street-level instead of rooftop, which is a
pin on the right street. Calling a lot number a street number puts the pin on
somebody else's house.

**Position decides the estate, not a keyword.** The first comma segment is the
street, the last is the suburb, and anything between is the estate's marketing
name. Half of them are not called "Estate" — `Greenfern Habitat`, `Coridale`,
`Cloverton` — and an estate name left in the query is the segment most likely
to make a provider give up and answer with the suburb.

Measured over the live lines: **29 resolve to street level and 3 to rooftop**
where all of them previously went as polluted strings, with 6 genuinely
locality-only because no street is named at all.

## The source fix, and why it is separate

`docs/integrations/blueprints/apply-address-fix.py` patches the live Make
scenario (`NPC Email 1 New`, id 9618493) to compose the geocode query from the
parts and to stop the write-back overwriting the eight extracted columns. It
**chains** from `apply-sender-fix.py` rather than rebuilding from the original,
because both write the same file and running it standalone would silently drop
the forwarded-sender repair.

The two layers are independent by design. The dashboard composes the address
itself before geocoding, so **the map is correct with or without the Make
patch**. The patch stops the source record being degraded, which matters for
every other consumer of that base.

## What none of this fixes

A street number that was never in the email. Roughly a quarter of live listings
and 68 of 124 builder lots have no street number at source — an estate lot has
none until its plan of subdivision is registered. Those resolve to street or
suburb level and say so. Reporting them as exact would be the same class of
mistake this whole area keeps making.
