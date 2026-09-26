# The address service — G-NAF and our own Photon, on one machine

Approved by the owner on 24 Sep 2026 ("proceed with both"), the day the public
Nominatim refused this product's egress (`GEOCODING_WITHOUT_GOOGLE.md` §17).
Two durable answers were approved: **our own copy of the lookup service**, so
no public operator can switch the chain off, and **G-NAF**, the Commonwealth's
national address register, so an address is placed on its own lot rather than
somewhere on its street. They are one service: one Fly.io machine, one URL,
one token, one deploy.

| Path (behind `https://<app>.fly.dev/<token>`) | What answers |
|---|---|
| `/gnaf/v1/manifest.json` | Which G-NAF release this is, and every count the build made |
| `/gnaf/v1/localities.json.gz` | Which postal areas hold addresses in each locality |
| `/gnaf/v1/<STATE>/<postcode>.psv.gz` | Every address the register files under that postal area |
| `/photon/api/?q=…` (and `/structured`, `/reverse`) | Photon 1.3.0 over OpenStreetMap's Australia–Oceania index |
| `/healthz` (no token) | Photon's own `/status`: 200 only once its index is open |

The chain reads it through two settings the deploy workflow writes:
`GEOCODER_GNAF_URL` (`…/<token>/gnaf`) and `GEOCODER_PHOTON_URL`
(`…/<token>/photon`), plus `AUTOCOMPLETE_PHOTON_URL` for the address field
where that is unset or already ours. With neither set the chain behaves exactly
as it did: `gnaf` is skipped without a request and Photon means the public
instance.

## 1. Why a register at all

OpenStreetMap is thin on Australian house numbers. Even on a day the public
services answer, most Australian addresses come back from them at **street**
precision — a point somewhere on one segment of the road. That is what
`planningCoordinate.pure.ts` has to disclose as "at a point on the property's
street", because a zone boundary running down the street can put the lot on
the other side of it.

G-NAF holds **15,949,543** current addresses (August 2026 release; 15,108,510
principal). **98.11%** are geocoded at the address itself, as a property,
building or unit centroid or a frontage point. It is published quarterly by
Geoscape Australia on data.gov.au under the **Open G-NAF End User Licence
Agreement**: CC BY 4.0 with one restriction, which is no mailing lists compiled
from it without verifying each address against another source. Commercial use
is permitted. Where the register knows an address, nothing else the chain can
ask knows it better, so `gnaf` leads the default order
(`gnaf,nominatim,photon,abs_locality`).

## 2. Why it is not in the database

The obvious design was a table. Measured on the research branch on 24 Sep
2026, it is the wrong one:

- **Size.** A lean national table with its two lookup indexes is ~3.7 GB, 230
  bytes a row, measured on 2M synthetic G-NAF-shaped rows. That is sixty per
  cent on top of the production database as it stood (5,807 MB), and a swap
  load needs ~7.4 GB free transiently.
- **Loading needs a credential this repository does not hold.** PostgREST runs
  every request under an 8-second statement timeout, so the indexes cannot be
  built through it. The fast route (`psql \copy`) needs `SUPABASE_DB_URL`,
  which the prime's repository does not carry.
- **A clone would never have it.** A clone gets the schema, never the rows a
  loader writes (`CLONE_PROVISIONING_GAPS.md`). Every clone would need its own
  3.7 GB load, or would silently have none.

Served as static files, the same register is ~200–300 MB compressed. It needs
no database, no credential and no load, and every deployment reads it through
one URL — a clone is pointed at it by configuration. A question costs one
request of a few tens of kilobytes, and the edge function remembers the last
sixteen postal areas it read for an hour.

## 3. The register, as built

`scripts/gnaf/build_gnaf_shards.py` works in these steps.

**`resolve` asks data.gov.au's catalogue which file is current.** It reads
`package_show` for package `19432f89-dc3a-4ef3-b943-5326ef1dbecc` and takes the
active **GDA2020** zip, newest first. It never uses a hard-coded URL: the
resource id changes every quarter, and the catalogue lists GDA94 first.

**`build` verifies the zip, extracts, joins and writes.**
- The zip's size must equal the catalogue's, and its first bytes must be a
  zip.
- It extracts only six tables per jurisdiction and checks every column it
  reads is in each header.
- It joins them in DuckDB 1.5.5, then reads the askable addresses back
  **sorted** — every address of one number on one street together, and every
  postal area together — and chooses each site and writes each file in **one
  pass**, holding one postal area at a time.

That last step is the one the first real run failed at (24 Sep 2026). It was a
window function, then `DISTINCT ON` and a join back, over all 16.3 million
addresses at once, and DuckDB ran out of memory in it: `4.6 GiB/4.6 GiB used`,
under the 5 GB the workflow gives it. DuckDB sorts out of core, so the one-pass
build does not have that ceiling. It was proved locally before it was pushed:

- on a synthetic release with the real layout and 17.2 million addresses, the
  old build failed with the same message at the same statement;
- the one-pass build finished in 5.4 minutes, with a peak of 4.47 GiB;
- on a million-address release small enough for both builds to finish, the two
  wrote the same files, the same rows in each, the same counts and the same
  locality index.

What the join keeps:

- **Current addresses only.** Retirement is `CONFIDENCE = -1`, G-NAF's own
  rule, and a retired default geocode is not the default.
- **Askable addresses only:** with a point, a postcode, a street, and a street
  number or a lot. Those without are counted in the manifest, not served.
- **One site row per number on a street.** It stands at the base address's own
  point, or, where a building has no base row, at the point most of its units
  share.
- **A unit row only where the register places that unit somewhere else** (a
  villa, a townhouse on its own lot). Every other unit stands at its
  building's point, which is exactly the site row.
- Ranges (`225-245`), suffixes (`16A`), street suffixes (`N`, `CN`) and aliases
  are kept as G-NAF writes them.
- **Other Territories** (Christmas Island, Cocos, Jervis Bay) are read and
  counted, not served: `AuState` has no code for them.

It **refuses** when any of these holds. Everything is written beside the
served directory and moved into place only once it adds up, so a refusal, or a
build that dies part-way, leaves the previous register standing:
- the national total of current addresses is below 14,000,000 (a partial
  release is a smaller register, and every address it lost would read as "no
  such address");
- any served state has no rows;
- collapsing units removed more than 60% of the askable addresses.

Output is gzipped with a zero mtime, and a file's lines are in a total order
(street, locality, number, then the pid, which is unique), so an unchanged
release builds identical bytes.

**The shard format** (`GNAF_SHARD_FORMAT = 1`) is pipe-separated. The header
must be exactly `n1p|n1|n1s|n2p|n2|n2s|lot|flat|street|type|suffix|locality|lat|lng|gt|pid`,
and any other header is a refusal, never a best-effort read. `gt` is G-NAF's
geocode type: `STL` reads as `street`, `LOC` is left to the ABS (the register
places it no finer than its locality), and everything else, including the
interpolated `GG`, reads as `address`.

## 4. The match

`supabase/functions/_shared/geocode/gnafShard.pure.ts`. An answer becomes the
point every planning register, amenity count and commute is measured from, so
it stands only where it can be **shown** to be the address asked about:

1. **The number and the street both agree** after one normalisation both sides
   go through:
   - `Ave`/`AVENUE` are one street; `Street`/`Road` are two;
   - `St Kilda`/`Saint Kilda` and `Mt`/`Mount` are one;
   - a direction letter counts only after the street's type.

   A plain number falls inside a ranged address only where the range spans at
   most 100 and runs down the same side of the street.

   The dwelling is read the ways an Australian address files one:
   `1408/5`, `G01/5`, `3/13-17`, `5/Lot 2880`, `Unit 3/13`, `U3 13`, and
   `Unit 3, 13 Smith Street`, where the dwelling is a comma-separated part of
   its own. A level is not a dwelling: `Level 3, 5 Second Avenue` is asked at
   the building. The plan leaves `Unit 3, 13 Smith Street` with no street line,
   because a part reading `Unit 3` names no street. That is right for a
   free-text provider, so `gnafStreetLineOf` joins the part back on for the
   register alone. The national-scale check found these forms among the
   register's own addresses. `parseAddress`, which the listing-photo match
   keeps deliberately strict, could not read them.
2. **A lot is never a street number** (`ADDRESS_COMPOSITION.md`). `Lot 12`
   matches the register's lot 12, never house 12.
3. **The place.** The postal area is the shard.
   - Where the ask names a suburb, the answer must stand in it or in the
     listing's bracketed alternative (Schofields/Tallawong).
   - Where it names none, the candidates must all stand in one locality. A
     postal area often covers several towns, and `5 Church Street` in the next
     town is somebody else's house.
   - Candidates at one number more than 200 m apart are refused.

**The service tells an address's absence from its own.** A postal area with no
addresses has no file, and its 404 is the one answer that is about an address.
A missing manifest is an **outage**, and the provider rests for five minutes.
The right token on a wrong path is a 400, no token is a 403, and any other
refusal pauses the provider like any other (`geocodeChainPolicy.pure.ts`).

## 5. How it is proved before it serves

`.github/workflows/address-service.yml` runs on every change to the service
and does all of the following inside the CI runner, before anything leaves it:

1. **The builder's own tests** run on a miniature release with the real layout
   (`scripts/gnaf/test_build_gnaf_shards.py`). The tests cover:
   - every collapse rule;
   - every refusal;
   - byte-identical rebuilds.
2. **The real release** is resolved, downloaded, verified and built.
3. **The register is checked against itself**
   (`scripts/gnaf/verify-gnaf-shards.ts`):
   - every shard is read, and the rows must equal the manifest's count;
   - every postal area the index names must be a file;
   - a seeded sample of the register's own addresses is written out the way a
     report files an address, planned by the chain's own `planGeocode`, and
     matched by the chain's own matcher.

   The files are read one at a time, and the sample is chosen before any is
   read: holding every row at once peaked at 4.9 GB on a national-scale
   register, past a runner's Node heap, and one file at a time peaks at
   0.19 GB. A sampled address found at the **wrong place** fails the build,
   and so does more than 2% not found. An address the register holds twice, far apart, is
   refused and counted as a correct refusal, not a miss. This is the check
   that matters: fixtures are rows somebody wrote, and the register is fifteen
   million rows nobody did.
4. **The image is built and run in the runner.** Its size is read twice,
   once as the layers stored and once as the filesystem a machine would see.
   Either past 7.5 GB fails the run, because Fly refuses an image past ~8 GB
   uncompressed. The Photon index is handed to the service's user in the layer
   that unpacks it: a `chown -R` in a later layer copies every file it touches,
   and the image carried the index twice. The same layer deletes the index's
   **lock files**. The dump ships the `node.lock` and `write.lock` files of the
   machine that built it. Lucene checks a lock file's creation time before and
   after opening it for writing, and Docker's overlay filesystem copies a file
   from an image layer into the container's layer when it is opened for
   writing, as a new file with a new creation time. So OpenSearch refused to
   start ("Underlying file changed by an external force") seven seconds in. A
   local overlay mount reproduces it exactly, and the same index without its
   locks answers in ten seconds. The health wait also stops the moment the
   container exits, rather than waiting out its five minutes. The door checks
   (`address-service/prove-doors.sh`) cover:
   - health;
   - Photon through the token;
   - the manifest and the index;
   - a 404 for a postal area with no addresses;
   - a 403 without the token, and a 400 for a wrong path.
5. **The real geocoding chain** asks the running service for the owner's
   report addresses (`src/lib/geocode/__tests__/addressServiceLive.spec.ts`,
   skipped everywhere else). Only the service's two providers are configured,
   so an answer cannot have come from anywhere else. At least three must come
   back from the register at the address itself, and the table of every answer
   goes to the run's summary.

A pull-request run reads no secret and deploys nothing. An unreachable
publisher on a pull request is reported and the proof skipped, because a build
must not be decided by another party's uptime; on a deploy it fails.

## 6. Deploying

Actions → **Address service (G-NAF + Photon)** → Run workflow, `deploy: true`.
After steps 1–5, the run:

6. **Derives the path token** as an HMAC of the app name under
   `FLY_API_TOKEN`. It is derived rather than minted, so a redeploy keeps the
   URL the edge functions already hold. Rotating `FLY_API_TOKEN` rotates it,
   and the repoint follows.
7. **Pushes the image it just proved, as it is.** It never rebuilds, because a
   rebuild would be a different image from the one proved.
8. **Deploys it bluegreen.** The image has no volume, so a new machine boots
   beside the old one, and traffic moves only when its health check passes.
9. **Proves the Fly machine** with the same door checks and the same chain
   proof.
10. **Only then writes the settings** into the Supabase project:
    - `GEOCODER_GNAF_URL` and `GEOCODER_PHOTON_URL`.
    - `AUTOCOMPLETE_PHOTON_URL` only where it is unset or already ours. The
      secret list carries each value's SHA-256, and an operator who pointed
      the address field at another Photon is not overruled.

**Always on, deliberately.** Photon's start measured 5.5–9.9 s on four unshared
vCPUs, and the chain gives a provider 6 s. A machine that stopped when idle
would fail the first geocode after every quiet spell, and that geocode would
fall to a suburb centroid, which is the failure this service exists to end.

**Prove it by effect afterwards:** the next report generation logs `placed at
address precision by gnaf` in `location-intelligence-service`, and its
planning page reads "at the property's own address point" followed by the
G-NAF attribution.

## 7. What it costs

One `shared-cpu-2x` machine with 2 GB, always on, in `syd`. At Fly's rates from
1 Oct 2026 ($0.70 per shared vCPU, $6.00 per GB of memory a month) that is
**US$13.39 a month**, or up to ~US$16.74 if Sydney carries the regional premium
the research could not measure from here. That is **≈ A$19–24 a month**. There
is no volume. Egress is well under 1 GB a month (a few cents), and a
pull-request run costs Actions minutes only. The first deploy is the owner's
decision, not the workflow's.

## 8. Licences, on the page

- **G-NAF.** Every answer carries `GNAF_ATTRIBUTION`, the EULA's own wording
  for material developed from the register, with the dataset's address. The
  planning page prints it wherever the point the registers were asked at came
  from the register (`planningFacts.pure.ts`, "Where the address point comes
  from"). Nothing here compiles addresses for mail.
- **OpenStreetMap.** Photon's answers carry `OSM_ATTRIBUTION` (ODbL), as the
  public instance's always did.

## 9. Refreshing

G-NAF releases quarterly (February, May, August, November), and the Photon
index is rebuilt upstream weekly. A refresh is a dispatch with `deploy: true`:
the register is rebuilt from whatever the catalogue calls current, the image
from the current index, and the same proofs gate both. A failed build changes
nothing, because the live machine keeps serving what it has.

## 10. What is measured, and what is not yet

**Measured by the first real run (24 Sep 2026).** GitHub's runners reach the
zip on data.gov.au. The AUG 2026 GDA2020 release was 1,854,931,188 bytes,
exactly the catalogue's figure, with sha256
`16820cc91c3ea32a3997b88024c8d0e576c1db10fe8645380be49b457e952df5`. It
downloaded at ~22 MB/s in 79 s. Its 54 tables unpacked to 3,435,172,421 bytes
in 13 s, and the join into DuckDB finished. The build then failed on memory in
the step §3 records.

**Measured by the second (24 Sep 2026, one postal area at a time).**

| Reading | Value |
|---|---|
| Current addresses | 15,949,543 (17 with neither a number nor a lot) |
| Rows chosen | 12,875,507: 11,042,485 sites and 1,833,022 units at a point of their own |
| Rows served | 12,872,133. The other 3,374 are in Other Territories (Christmas Island, Cocos, Jervis Bay), which are read and counted but not served, because the chain has no state for them |
| Postal areas | 2,652 files, 168 MB, plus 19,533 locality names |
| Build time | 313 s in the runner, with no memory failure |
| Geocoded at a surveyed point on the property (every type but the three below) | 12,532,735 of the 12,875,507 chosen rows (97.3%) |
| Interpolated between known points on the street (`GG`) | 92,155 (0.7%). The chain counts these as address precision, because G-NAF places them at the address |
| Street (`STL`) or locality (`LOC`) only | 241,945 (1.9%) and 8,672 (0.07%). The chain reports these as street and locality precision |
| Self-check | 1,996 sampled asks in each form, 99.90% found at their own point, **none at the wrong place** |
| Photon index | reached from the runner, 2.4 GB unpacked |
| Image | 3.15 GB, as layers and as unpacked filesystem alike |

The self-check's two misses are one address asked two ways each. Each has a
lettered prefix on its number (`L1 Ikartuka Terrace`, `M508 Longs Hill Road`),
which the matcher does not read as a street number. The run then failed on the
index's lock files, as §5 records.

**Still unverified:**

- Photon's start and its first answers on the **real** index. The CI run after
  the lock fix decides it.
- Whether 2 GB of memory holds the page cache for a 2.4 GB index comfortably.
  The first week of answer times decides whether it should be 4 GB.
- Fly's **`syd` price** after 1 Oct 2026.
- How many of the owner's addresses the register holds. The chain proof's
  table is the answer.
