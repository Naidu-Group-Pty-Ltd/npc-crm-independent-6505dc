# The public office-holder index

Read this before touching `_shared/aml/pepOfficeholderIndex.pure.ts`,
`scripts/aml/load-pep-officeholders.mjs`, `pepOfficeholderParsers.mjs`, the
`search_pep_officeholders` operation, or `PepOfficeholderIndexPanel`.

It is the second register this platform loads, and it is **not the same kind
of thing** as the first. Read
[`SANCTIONS_LIST_LOADING.md`](./SANCTIONS_LIST_LOADING.md) for that one and
[`PEP_DETERMINATION_EVIDENCE.md`](./PEP_DETERMINATION_EVIDENCE.md) for what a
determination has to rest on.

## The one rule

**A hit is a candidate. A miss is nothing.**

A sanctions list is authoritative: DFAT publishes who is designated, and a
match against it is an outcome. No such register exists for political
exposure. Every public source is partial, none lists family members or close
associates at all, and they disagree with each other about spelling, titles
and dates.

So an index built from them is useful for exactly the reason a commercial PEP
database is useful — it surfaces a name worth looking at — and dangerous for
exactly one reason: **it returns zero rows for a person it never covered, and
zero rows reads like an answer.**

This platform has already shipped that shape once. `aml.sanctions_entries` was
empty from the day it was built, and every screening against it would have
cleared everybody. The lesson is written into the **read** path here, not into
a policy document:

- `searchVerdict` produces four readings and **none of them is a clearance** —
  a test asserts no branch can be paraphrased into one.
- **Coverage travels with every result**, including the empty one, which is
  the one that needs it. What the sources hold, what they do not, how many
  entries loaded, and the source's own as-at.
- An index that has never loaded, or whose **latest load failed**, reads as
  `unavailable` rather than as no candidates. It has not looked.
- A database fault answers `pep_index_search_failed` with a 503. A technical
  condition returned as "nothing found" is how an error becomes an outcome —
  the same defect the screening consumers had when they discarded a claim's
  error.

## What is in it, and why

| source | tier | what it holds |
| --- | --- | --- |
| `aph_commonwealth_parliament` | **A** — the Parliament's own register | The senators and members **currently sitting**, and the ministerial and parliamentary offices each holds. Measured 2026-08-20: **225 people, 275 distinct offices**. |
| `wikidata_au_public_office` | **C** — collaboratively edited | Offices whose **jurisdiction** is Australia or one of its states and territories, and the people recorded as having held them — current **and former**. Measured 2026-08-19: **724 offices, 10,569 people**. |

### Two sources, and the authoritative one is the narrower

This is the shape of what is public, not a gap waiting to be closed.

`aph_commonwealth_parliament` is Parliament publishing its own membership.
Every row is authoritative and current — and the files carry **no dates at
all**. They are a snapshot of who sits today, so `position_start` and
`position_end` are null, `currently_held` is true, and **not one former member
or senator is in it**. AUSTRAC is explicit that leaving office does not end the
risk, so that exclusion is written into the source's `excludes` prose and
travels with every result, including the empty one.

`wikidata_au_public_office` is the opposite trade: far broader, carries former
holders and their dates, and is edited by anyone. A hit is a lead to confirm.

Neither replaces the other. **An absence from both is still not an answer about
anybody**, which is the rule at the top of this file and the reason adding a
second source changes nothing about what a miss means.

### The website blocks automated clients; the register it publishes does not

Those are different facts, and the product asserted the first as though it were
the second. `SERVER_UNREACHABLE_SOURCES` in `pepScreeningEngine.pure.ts` carried
an entry reading *"Parliament of Australia — senators and members · Blocks
automated requests. Open it from the manual checks below."*

`www.aph.gov.au/Senators_and_Members/Members` **does** answer 403 to a scripted
client, from every environment measured. But Parliament publishes the same
membership as CSV on `static.aph.gov.au`, and both files download cleanly from
a GitHub runner and from this repository's own container — 150 members, 75
senators, every attempt. The link APH labels `Members_List.csv` is a **PDF**,
which is how the whole source came to be written off.

So an authoritative federal register sat one URL away while the product named
it unreachable and sent operators to open it by hand. A test now asserts the
two lists — "what we read for you" and "what you must read yourself" — share no
source.

### A carriage return is not a missing delimiter

The members' file separates multiple ministerial titles with a **bare `\r`
inside a quoted cell**, and its rows with LF. A terminal prints `\r` by
returning the cursor to the start of the line and overwriting what is there, so
the titles appear to run together with no separator at all:

```
Minister for Small BusinessMinister for International DevelopmentMinister for …
```

That reading produced a confident diagnosis of a broken government export, and
what nearly shipped on the back of it was a list of English phrases —
*"Minister for"*, *"Cabinet Secretary"*, *"Assistant Minister"* — with a rule
guessing where one office title ends and the next begins. It gave the right
answer on all four strings it was tested against.

`od -c` settles it: the delimiter was there the whole time. `splitTitleCell`
splits on `\r`, `\n` and `;` — the characters the two files actually use — and
knows nothing about what an Australian ministry is called. A cell with no
delimiter survives whole, so the failure mode of an unrecognised title is an
intact string rather than a mangled one. The fixtures under
`tests/aml/fixtures/` are verbatim bytes for exactly this reason.

### What is deliberately left behind

These are **address-label** files. Two thirds of every row is an electorate
office street address, a postal address and three phone numbers.

None of it is ingested. A PEP index answers whether a name holds public office;
it has no business accumulating the contact details of 225 people because they
arrived in the same download. A test greps the parsed output for
address-shaped and phone-shaped values and fails on any of them.

### A derived key that collides is refused

The files carry no identifier of any kind — no MPID, no PHID, nothing — so
`external_id` is derived from chamber, surname, given name and seat. That is
fine only while it cannot silently merge two people, so a collision **throws**
and fails the load. An index quietly holding 149 of 150 members is the
empty-register failure at one-row scale, and it reads as a clean load for as
long as nobody counts.

## Telling a candidate apart from a namesake

The index searches on name tokens alone, and that is correct: a common surname
must still surface the office holder, so the search is built for recall. The
consequence is that an operator is handed candidates who are frequently a
different person, with nothing on the card connecting them to the customer
except an office title.

A date of birth is the strongest discriminator any of these sources publishes.
Measured against the live endpoint, **1,247 of 1,254** people in one office
batch carry `P569` — 99%.

### The rule: a date of birth ORDERS candidates. It never removes one.

The threshold deciding whether a candidate reaches a person is applied to the
**name score alone**. `admitCandidate` in
`_shared/aml/pepCandidateMatch.pure.ts` takes one argument and it is the name
score — expressed in the signature so it cannot be quietly relaxed, and pinned
by a test that scans both endpoints for a filter on an adjusted score.

The sanctions path does the opposite, and correctly: there the adjustment
decides whether something is REFERRED at all, and the cost of over-referring is
a reviewer's minute. Here the candidate is already in front of the reviewer
whose job is to reach the determination, so removing an office holder because a
birth date disagrees would be the automation reaching it — and the operator
would never learn the namesake existed.

The concrete number: a 0.9 name score times the sanctions mismatch factor of
0.75 is **0.675**, under the 0.7 floor. Applying the adjustment before the
threshold would silently drop a strong name match.

### Why the column is `text` and not `date`

Because the source publishes partial dates, and a partial date in a `date`
column has to be padded to something.

Wikidata records precision explicitly — `wikibase:timePrecision` 11 day, 10
month, 9 year — and renders a full timestamp either way. A year-precision birth
in 1961 comes back as `1961-01-01T00:00:00Z`. **46 of those 1,247 people are
year-precision.** Storing the timestamp would assert that all 46 were born on
1 January, and the comparison would then report a confident MISMATCH against a
customer genuinely born in August.

A fabricated discriminator is worse than none: it demotes a real lead with a
reason that sounds decisive. So the column carries precision in the shape of
the string — `1961`, `1961-03`, `1961-03-02` — which is the convention
`aml.sanctions_entries.date_of_birth` already uses and the one `compareDob` in
`_shared/aml/matching.ts` is written against. One convention, one comparator,
no second precision column to drift. An unstated precision truncates to the
**year**, because over-truncating only understates agreement while
under-truncating invents a birthday.

### Two things a shared year can mean

`DobAgreement` returns `year_match` both when the register publishes *only* a
year and when two full dates share a year but fall on different days. The first
is weak corroboration; the second is close to a disagreement. The agreement is
left alone — it feeds the ranking and has to rank the way the sanctions
screening does — and `comparePepDob` computes a separate **reading** for the
sentence that goes on the page.

Nothing it can produce reads as an identification or an exclusion. A
disagreement says *"worth confirming against the official register before
relying on either"*, and an **absent** date says *"that is not a difference —
there is nothing to compare"*. Reading a register that publishes no date as a
date that disagrees is the empty-register failure pointed the other way.

The party's own date is resolved by one function used by both the assisted
search and the recorded run. Two derivations would let the list an operator
browses rank differently from the record kept of what was searched, and both
would look right on their own.

## Coverage against the AML/CTF Rules, measured

"10,558 people across 676 offices" is a number about a database. The question
an operator has when a search returns nothing is whether it had ever looked at
judges, or ambassadors, or the Chief of Navy.

`_shared/aml/pepRuleCoverage.pure.ts` classifies the office titles a load
actually holds against the Rules' own vocabulary. The **loader** measures it and
writes it to `pep_officeholder_syncs.detail.rule_categories`; the endpoint
renders it from there. Same module both sides.

### Why a classifier is safe here when one was deleted next door

A heuristic was removed from the APH parser because it guessed where one office
title ended and the next began, and a wrong guess **altered the data**. This one
alters nothing — every row is stored exactly as the source published it — and
its two failure directions are not symmetrical:

- a title it does not recognise is counted as **unclassified and disclosed**, so
  every count is a floor and the prose says *"at least"*;
- a category with nothing recognised reads as **not evidenced**, which sends the
  operator to check by hand. The cost is a check somebody may not have needed.

The unsafe direction — claiming a category is covered when it is not — is the
one it exists to prevent, and it was not hypothetical.

### The category that would have been wrong

The Rules mean **Australian** diplomatic positions: our ambassadors and high
commissioners posted overseas.

Production holds 16 offices containing "ambassador", "high commissioner" or
"consul". **Fifteen** are of the form `ambassador of Botswana to Australia` —
foreign envoys posted *here*, which is the opposite of the category. The
sixteenth is a bare `high commissioner` with no direction stated. Australian
diplomats abroad: **zero**.

A keyword classifier would have reported *"diplomatic: 16 offices"*, and an
operator would reasonably have concluded Australian ambassadors were searched.
So the direction is part of the match, and the foreign envoys get their own
category — a foreign ambassador in Canberra is a foreign PEP, which the Rules
treat more strictly, and folding them into the Australian count or dropping
them silently are both wrong.

Three more that a plausible rule gets wrong, all real rows:

| title | naive | correct |
| --- | --- | --- |
| `Governor of the Reserve Bank of Australia` | vice-regal | an accountable authority |
| `Justice of the Peace for South Australia` | judiciary | not a judicial officer |
| `Minister for Defence` | defence | ministry |

Councillors and aldermen are deliberately **not** counted as local government:
the Rules name *heads* of local government, and the index holds hundreds of
council members who are not heads.

### What each register evidences

Measured, not asserted:

| register | categories evidenced |
| --- | --- |
| `aph_commonwealth_parliament` | legislature (179 offices), ministry (77) — and nothing else. It is a register of seats and portfolios. |
| `wikidata_au_public_office` | the broader set, including judiciary, vice-regal, public administration, Defence and local government |

The spike found no reachable Tier A source for the judiciary, Defence or
diplomatic positions. That is a gap in **adapters**, not necessarily a gap in
the index: judges, the Chief of Navy and state Governors are already loaded,
from the collaboratively edited source. The operator needs both facts, and the
panel now says which categories are evidenced and which are not.

### The query, and the one that was wrong

Offices are found by `P1001` — *applies to jurisdiction* — where the
jurisdiction is Australia itself or anything whose country (`P17`) is
Australia. That reaches the states and territories without naming them; a
hand-written list of eight is a list that goes stale in silence.

**The first version walked a subclass tree from `wd:Q18912794` and was
wrong.** That entity is not a class of Australian public offices — it *is*
"member of the Australian House of Representatives". The load succeeded, wrote
**1,254 people across two offices** (the House and its Speaker), and the
product then told operators on screen that it covered ministers, judges, heads
of agency and every state. No senators. No ministers. Nothing from any state.

That is the worst failure this feature can have, and it is not the empty one.
An unavailable index says it has not looked. An **overstated** index tells an
operator that an absence means more than it does.

### Coverage is measured, not claimed

So the prose in `PEP_INDEX_SOURCES` now describes only the *shape* of the
source, and a test asserts it **contains no digits at all**. Everything
countable — how many offices were reached, how many people, which ones — is
recorded by the loader into `pep_officeholder_syncs.detail` and rendered from
there. A sentence somebody typed once cannot be checked against a load; a
number the loader measured can be.

`officeCount` is `null` when a load recorded no detail, never `0` — unknown
and none are different facts and only one of them is alarming.

The count is over **every office a row records**, not the one it leads with.
`position_title` is the office shown on the candidate — the current one, else
the most recent — so counting those answers "how many offices do people lead
with", which is not a coverage number: the first corrected load measured 371
while 676 offices were actually represented, out of 724 queried.

### `pep_type` is left NULL, deliberately

The AUSTRAC category — foreign, domestic, international organisation — belongs
to the **determination a person reaches**, not to an index that surfaces a
candidate. It is also not available here: an Australian-jurisdiction office
correctly includes foreign ambassadors posted to Australia, so stamping every
row `domestic` was wrong on the face of the data as well as in principle.

Wikidata is the only reachable public source that carries **former** holders,
which is the gap the current government directory leaves and the one AUSTRAC
is most explicit about: leaving office does not end the risk, and the
treatment is a risk assessment rather than an expiry date. So the loader
carries the dates and never filters on them.

### The endpoint fails by lying

`query.wikidata.org` enforces a 60-second limit, and it does **not** fail
cleanly when a query exceeds it. A batch of 60 offices answered **HTTP 200
with 8.5 MB of JSON cut off mid-value** — no error field, no marker, nothing
to test but the parse.

Two consequences are built in. The holder query collapses aliases and
positions with `GROUP_CONCAT` so the server does that work: the same shape at
20 offices is 198 KB in about 2.5 seconds, which leaves the ceiling a wide
margin. And a response that does not parse is reported as a **truncated
download by name**, because that is what it is and because the distinction
tells the next person which lever to pull. Offices are read in batches of 20,
and the accumulator is threaded through all of them so a person holding
offices in several batches ends up as one row rather than as whichever batch
wrote last.

Throttling (`429`) and gateway errors are retried with backoff, honouring
`Retry-After` where the server states one. Neither is a failed load.

It is also **collaboratively edited**, which is precisely why a hit from it is
a lead rather than a source. Every row carries `confirm_url`, the panel says
"collaboratively edited" on screen, and `candidateToMethodDraft` produces a
source row whose `result` is **empty** — the operator confirms the candidate
against the official register and writes what they saw. The platform writing
that sentence for them is what would make the record indefensible. A test
asserts the drafted source never names the index itself.

**The APH parliamentarian search is not a source here**, though it is offered
as a one-click search in the dialog: `aph.gov.au` answers a scripted client
with a WAF block page, exactly as DFAT does. OpenSanctions' PEP dataset is
deliberately not used for the same reason its sanctions data is not — the
aggregation is CC-BY-NC and we are a commercial user.

## The index is a living thing

Two properties nothing was measuring: it goes **stale**, and it **changes**.

### How current it is, which is not whether it loaded

This index makes a claim no sanctions list makes: **`currently_held`**.

Every row from the Parliament register carries `currently_held: true` by
construction — the files are a snapshot of who sits on the day they are
downloaded, with no dates in them at all. That is accurate at the load and
decays from then on. A member who loses their seat at an election reads as
**Current** for as long as nothing reloads, and that word travels into the
evidence a determination rests on: `candidateToMethodDraft` writes "current"
or "former" into the source row.

Nothing measured it. `indexIsUsable` asks whether a load succeeded and holds
rows, so a load from eight months ago passes exactly as this morning's does —
the same shape as the sanctions failure where freshness of the **load** was
read as currency of the **data**.

`assessIndexRecency` reads the age of the last successful load. The refresh is
weekly, so the thresholds are counted in missed runs: **`fresh` ≤ 14 days,
`ageing` ≤ 45, `stale` beyond**, and a register with no successful load is
`never` — neither current nor out of date, simply unread, which points at a
different remedy.

**Usability and currency stay separate.** `indexIsUsable` is unchanged and
does not consult this. A stale register is still searched: its rows are still
leads, and refusing to read it would remove the only assistance the operator
has. What it cannot do is support an assertion about today — so the assertion
is what gets qualified.

`describeTenure` has no branch that produces the bare word "Current". A held
seat is `Held as at 2026-08-19`, and past `fresh` it carries how long ago that
was. A former holder is still named a former holder: leaving office is a risk
assessment, not an expiry date.

On the run itself, a stale-but-searched register raises a **`coverage_gap`**
indicator. Deliberately that kind: coverage gaps are excluded from the real
findings, so a stale register can never turn an empty search into
`indicators_found` — that would report a fact about our loader as a fact about
the customer. It does force a person to look, which is the whole of what an old
register warrants. An `ageing` register gets its sentence on the source row and
no gap: one missed weekly run is not a hole in the search.

### A refresh is a monitoring event

Political exposure is not established once at onboarding. A customer determined
not to be a PEP in March and elected in September is a PEP from September, and
knowing that is ongoing CDD.

What existed was a review **date**: every determination, `not_pep` included,
carries `review_due_at` twelve months out, and `aml-monitoring` raises an alert
when it lapses. That is a periodic reconsideration by a person and it is
necessary. On its own it is also a window of up to a year in which a customer
can take public office and nothing notices — while the index reloads every week
and nobody asks it the obvious question: **does any name in here now match a
party we have already screened?** It is the same overlap query the screening
runs, pointed the other way.

`pepIndexChange.pure.ts` compares what the index returns now against what the
last recorded run returned, and `runScheduledScans` raises an alert.

**A new candidate is a change in the SEARCH, not a change in the person.**
There are three ways a name that returned nothing last month returns something
today and only one of them is "they took office":

| origin | what it means |
| --- | --- |
| `source_added_since` | the whole register was first loaded after that screening. The **coverage** grew; nothing is said about the person |
| `entered_since` | the register was already being searched and this row entered it since — consistent with an appointment or election |
| `already_present` | the row was there and did not match before. A corrected name or a new alias — the **search** changed |
| `unknown` | no creation time recorded, so these cannot be told apart — reported as unknown rather than guessed |

That distinction is what makes the alert actionable. An operator told "this
person has just taken office" about a spelling correction is sent into the
wrong enquiry entirely.

**`source_added_since` is checked first, and it nearly did not exist.** The
obvious rule is "a row created since the last run means the person entered the
register". Checked against production it is wrong in the case that matters
most: **226 rows entered the index in the hour after the only screening runs on
file**, because the Parliament register was loaded for the first time. Every one
of them is newer than the run and not one is a person who took office. A bulk
register addition is when the most cases change at once, so a reading that
mislabels it is wrong at its own peak.

The distinguishing fact is the register's **first** successful load, never its
most recent — the weekly refresh moves "last loaded" every week, and keying on
that would make every register look permanently new and every candidate a
coverage artefact. That is the same error pointed the other way, and equally
silent.

Three rules bind it:

- **It writes an alert and nothing else.** No determination, no supersession,
  no change to a standing conclusion — only a reviewer or MLRO moves that, and
  a test asserts the scan cannot write to `pep_determinations`.
- **A case nobody has screened has not changed.** It is *unscreened*, a
  different state with a different remedy, and sweeping it in here would bury
  the cases that did change.
- **A failed index read is skipped, never counted as "no change".** Reporting a
  database fault as no change is how a broken sweep looks exactly like a
  working one.

Severity orders a queue and reverses nothing. A new match against a case where
somebody has recorded **not a PEP** is `urgent` — it cuts against a conclusion
the file says is settled. A case nobody has determined is `high`, an ordinary
lead. A further office on a known PEP is `normal`: relevant to the risk
assessment and to enhanced due diligence, and not news about whether they are
one.

## Loading it

`npm run test:aml-pep-index` runs the parser and loader contracts, and the
workflow runs them **before** anything is written.

```
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
  node scripts/aml/load-pep-officeholders.mjs [--dry-run] [--file q.json]
```

Both sources load by default; `--source` narrows it. A source that exists and
is never scheduled is a source that is empty, which is the reading this index
exists to avoid producing, so a test asserts the workflow names both.

`.github/workflows/aml-pep-officeholders-refresh.yml` runs it weekly. Weekly
rather than nightly, and this asymmetry is deliberate: a stale sanctions list
is a live compliance failure and fails screening closed, while a stale
office-holder index degrades an **assistance** — the searches still open, the
operator still checks the official register, and the determination is still
made on what they record.

Every rule the sanctions loader learned the expensive way is repeated here,
because each one cost a production incident:

- **Never publish a source that parsed to zero entries.** An empty index is
  not "nobody holds public office"; it is a download that failed, and it
  answers a search with the same zero rows a real search would.
- **A shrink is a truncated response until a person says otherwise.**
  `PRUNE_SHRINK_FLOOR` keeps the old entries and exits non-zero.
- **The prune's `or()` must name `sync_id` in the RETURNING projection.** On a
  mutation PostgREST resolves those columns against the projection rather than
  the table and answers `42703 column … does not exist` for a column the table
  plainly has. On the sanctions loader that failed **every** load it was part
  of.
- **Node 22.** `createClient` builds a `RealtimeClient` whose constructor
  demands a native WebSocket. On 20 the loader dies before reading a byte.
- **Missing credentials fail the job.** A refresh that silently downgrades
  itself to a dry run is how a register goes stale behind a green tick.

## Normalisation is server-side, always

`normalised_names` is written by the **same** `normaliseName` the query uses —
imported from `sanctionsParsers.mjs` rather than re-implemented. A second
implementation that dropped one more honorific would write rows no query can
ever match, which looks exactly like an index that works. A row with no
searchable tokens is dropped by the loader **and** refused by a column
constraint, because such a row is not an entry, it is a silent hole in
coverage.

The search overlaps on **any** token and scores in code with `scoreNames`, the
same matcher the sanctions screening uses — recall first, because requiring
every token would miss the partial-name cases the search exists to catch.

## Access

Service role only, both tables, exactly like the sanctions tables. Every read
goes through `search_pep_officeholders`, which is where the coverage statement
is attached: a direct client grant would let a caller obtain a bare "0 rows"
with nothing beside it, which is the reading this whole table is built to
prevent.

## Where the tests are

| | |
| --- | --- |
| the readings, and that none is a clearance | `src/lib/aml/pepOfficeholderIndex.test.ts` |
| the parser and the loader's rules | `tests/aml/pep-officeholders.test.mjs` (`npm run test:aml-pep-index`) |
| the panel, including the empty state | `src/components/aml/__tests__/pepOfficeholderIndexPanel.test.tsx` |
| the edge operation | `src/lib/aml/amlScreeningRepair.contract.test.ts` |
