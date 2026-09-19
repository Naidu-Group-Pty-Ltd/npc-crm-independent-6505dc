# Where a listing's pin goes, and what may draw a mark

Read this before touching `resolve-listing-coordinates`, any
`supabase/functions/_shared/au*.pure.ts`, `src/lib/listingsMap.ts` or
`ListingsMapView`. Four rounds of "the pins are in the wrong place" were
reported against this map; three of them were four separate faults, and one of
them was my own previous fix. What follows is what each one actually was, so
the next attempt does not start from the same wrong model.

## The map has never had an API key, and must never need one

The first report was watermarks, not pins: CARTO stopped serving anonymous
raster tiles, so every tile came back stamped **API KEY REQUIRED** and the
marketplace drew its listings over a wall of them. A key cannot fix it here —
this dashboard is cloned per tenant and a provisioned clone has nowhere to
inherit a CARTO account from, and a `VITE_`-prefixed token is inlined into
every clone's bundle in any case. `BASEMAP_CATALOG` therefore holds **only
providers that work with no credential at all**. Adding one that needs a token
re-breaks every clone, silently, for whoever is not the prime.

## `country:AU` does not mean "search Australia"

It means "the answer must be in Australia". When nothing matches, the provider
does not fail — it returns **the centre of the continent**, `-25.2744,
133.7751`, with HTTP 200 and `location_type: APPROXIMATE`.

This is how eight listings came to draw a tidy cluster in the desert. Their
addresses are `London`, `Marylebone Street`, `Pittsburgh`, `Matteson`,
`Salford`, `Kerry`, `Ripley` — intake extracted an overseas locality, and
asking an Australia-restricted geocoder to find `London` can only ever end
this way. Every gate waved it through, because the centre of Australia is
inside Australia, is on land, and contradicts no state the record named.

**It was introduced by the previous fix in this same area.** Before it, those
records were plotted at the overseas coordinates the source supplied; stopping
that (correctly) sent them to the geocoder, which answered with the centroid.
A gate that rejects a bad input has to be paired with a judgement about what
the fallback then returns, or the failure simply moves.

`geocodeGranularity.pure.ts` is that judgement, and it asks the provider's own
answer rather than measuring distance:

- `results[0].types` says what **kind** of thing was matched. `street_address`
  or `premise` is an address; `locality` is a suburb; `country` or
  `administrative_area_level_1` is the container, not the property.
- A result whose types say nothing at all is **refused**, because a silent
  fallback is indistinguishable from a match and that is the whole situation
  this exists for.
- The centroid itself is refused by coordinate as well, belt and braces: a
  provider may label its fallback however it likes, and this point is a known
  sentinel.

Two rules bite. **`locality` is acceptable** — a suburb centroid is the honest
answer for a record that carries only a suburb, and it is imprecise rather than
wrong; refusing it would empty the map of every builder-stock item, which is
the very thing this work exists to place. And **the check runs on the cache
read as well as the provider reply**, because a cached wrong answer outlives
the bug that made it and this cache holds rows written before any of this was
understood.

A refused geocode is written `status: 'suspect'` with null coordinates. The
listing then appears in the unmapped panel with a reason — visible and
explainable — rather than as a confident pin somewhere nobody lives.

## The one plottability rule

`isTrustworthyAuPoint(lat, lng, state, postcode)` is asked in one place and
answers for both the cache and a fresh geocode. In order:

1. Finite numbers.
2. Not the country centroid — the provider's "I found nothing", wherever it
   reaches us from.
3. `assessAuPoint` — inside Australia, and inside the state the record names.
4. `assessAuPostcodePoint` — inside the postcode's own band. This is the only
   gate that catches a Sunshine Coast property geocoded to Cairns: both are
   Queensland and both are on land.

A fresh geocode is judged by two more things the cache path cannot ask: the
granularity above, and `assessAgainstConsensus` — the corpus as its own control
group, since a fresh answer hundreds of kilometres from every verified
neighbour in the same suburb is a wrong-town geocode no rectangle can catch.

Failing is **not an error and never an exception**. The coordinate is simply
not an answer, and the record falls through to the next method.

## A bare suburb is resolved before it is geocoded

`Donnybrook` is a Melbourne growth suburb and a town in Western Australia,
and the geocoder picked WA. `auSuburbGazetteer.pure.ts` resolves a locality
against `public.suburb_directory` (18,519 Australian localities) first, using
the rest of the batch as a cohort to decide the state. This is what makes a
suburb-only builder-stock record land in the right one.

## Only co-location may put more than one property behind one mark

Proximity clustering was removed. This is the part that took three attempts to
see clearly, so it is worth stating plainly: **a proximity bubble's position
carries no information.** It is drawn at one member's coordinate (or, in the
library's default, the arithmetic mean of them) while standing for properties
spread over hundreds of kilometres. A reader has no way to distinguish a
legitimate bubble from a misplaced pin — and every single time one was looked
at, it was reported as a misplaced pin: over Bass Strait, over the Southern
Ocean, and finally over the centre of the continent, where that time the pins
really were wrong.

Two rounds were spent making the bubble sit on a better member
(`robustClusterAnchor`, a coordinate-wise median). It worked, and it did not
help, because the objection was never that the bubble was on the wrong member.

`groupByCoordinate` groups by **exact coordinate**, rounded to five decimal
places (about a metre — two geocodes of one address agree far more precisely
than that, and two different addresses are never that close). A mark that says
"26" is then **true**: all twenty-six really are at that point. It stays true at
every zoom, because the grouping is by coordinate and not by screen distance.
**Nothing is ever drawn where no property stands**, which is the property the
old bubble could not have.

Zooming reveals more, but by a different mechanism than clustering: there are
simply no bubbles left swallowing distinct coordinates, so every property that
is anywhere different from its neighbours has its own pin at every zoom.

### The stack this leaves, and the control it needs

Co-location is not a rare edge. The corpus stacks hard: twenty-six listings
share `104 Grubb Avenue, Traralgon`; sixteen builder releases share one
Armstrong Creek suburb centroid. Those pins are exactly on top of one another
and no zoom separates them, because they are the same point.

`leaflet.markercluster` used to handle that by **spiderfying** identical points
apart on click, so removing clustering removed the only way to reach a property
sitting underneath another one. Without a replacement, the count badge is a
promise the map cannot keep. `ListingStackPager` is that replacement: the popup
carries "k of N here" with two arrows, `resolveStack` finds the members and
`stepStackIndex` walks them, wrapping at both ends so neither arrow is ever a
dead end.

Three rules. The pager is **never drawn for a stack of one** — a "1 of 1" with
two arrows is a control that cannot be operated, which reads as a broken one.
The popup is keyed by the **coordinate** and the card inside it by the
**listing**, so stepping does not tear the popup down and re-run Leaflet's
auto-pan at the same point, while the card's carousel and photo lookup still
reset per property. And the hover card **says what the click does**, because
otherwise a reader has no way to know the properties under the top one are
reachable at all.

## Builder stock is on the same map, and is marked by where it came from

`builderStockMapPoint.ts` projects a builder's inventory onto `PropertyListing`
so it travels the same pipeline — the same trust gate, the same grouping, the
same popup. Its glyph is `builder`, keyed on the record's **origin** and not
its property type: a builder's house and an agent's house are the same type,
and a reader needs to tell the two offers apart.

Builder stock carries a suburb and no street address, so it resolves to a
suburb centroid and lands as a stack. That is correct, and it is why
`locality` must stay acceptable in the granularity gate.
