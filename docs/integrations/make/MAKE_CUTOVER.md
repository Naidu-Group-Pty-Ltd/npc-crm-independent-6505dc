# Make cutover — what is left, and the webhook table

> **The Airtable half of this cutover was never thrown.** The blueprints below
> are re-pointed at `appFNPL7iYiuQyHAO`, but the scenario that is actually
> running still writes `apptyShYE0yzL4IGB`, and that is where every listing the
> product serves comes from. `appFNPL7iYiuQyHAO` held 148 empty shells from the
> copy until 2026-09-15, when they were deleted; it now holds **2** real
> listings against the live base's 171. Importing these blueprints as they stand
> therefore still *moves* intake to a base nothing reads. Read
> [`AIRTABLE_KEY_OWNERSHIP.md`](../AIRTABLE_KEY_OWNERSHIP.md) and
> [`BASE_BACKFILL.md`](../../listings/BASE_BACKFILL.md) before acting on this
> file.


State of the migration into the new Make account (team `2731020`, org `8699071`,
zone **us2**) as of 2026-08-18. 31 scenarios were cloned through the API; this
file covers what is not done and what has to change outside Make.

## Three things are outstanding

| | Why | Who can do it |
| --- | --- | --- |
| ~~6 scenarios still to import~~ | ~~blueprint too large to pass as an inline tool argument~~ | **Already done** — all six exist and are valid; verified 2026-09-15 |
| ~~2 scenarios cannot be created~~ | ~~their data store does not fit on the Free plan~~ | **Done 2026-09-15** — see below |
| every external caller | the zone changed, so every webhook URL changed | a person, in Vapi / Twilio / GHL / the website |

**Nothing structural is outstanding in Make.** What is left is the re-pointing
of external callers, and one decision that sits above all of it — see
"The base question" below.

## The six UI imports are now fully wired

The files are in
[`../blueprints/make/_import-ready/`](../blueprints/make/_import-ready/). They
were originally prepared with the **old** Airtable base still in them. As of
2026-08-18 they point at the migrated base:

- base `apptyShYE0yzL4IGB` → **`appFNPL7iYiuQyHAO`**
- 6 table ids and **576 field references** rewritten to the new base's ids
- the three Aurixa scenarios keep the us2 hooks minted for them (2705081/2/3)

The rewrite touched **only** id tokens: masking every `app…`/`tbl…`/`fld…`
token makes the before and after byte-identical, so the 36.5 KB HTML email
bodies in the Aurixa scenarios are provably unchanged. One near-miss worth
recording: `applicantTimeZone` matches the shape of an Airtable base id
(`app` + 14 characters) and appears in Stage 3 — the rewriter substitutes only
ids it has an actual mapping for, so that string survived untouched.

### How the field map was built, and why it is trustworthy

There is no API that returns "old field id → new field id". The map was built by
resolving old id → field **name** (from the export) → new id (from the target),
and the target's name→id map was recovered by aligning creation order against
the live schema. That is an inference, so it was checked two ways before use:

- **41 (name, id) pairs** confirmed independently by earlier `get_table_schema`
  and `create_field` responses — all 41 agree.
- **374 fields** cross-checked on type: every aligned pair's live field type
  matches the type the creation plan declared. 374 match, 0 mismatch.

The first attempt failed both checks, which is the reason they exist: the four
`CREATED_TIME()` substitutes were appended after everything else rather than in
plan position, and `Aurixa Waitlist`'s computed tail was created in dependency
order (counts, then rollups, then formulas) rather than plan order. Naive
order-zipping silently produced wrong ids for those; the checks caught it.

## The two scenarios that could not be created — created 2026-09-15

`NPC Twilio - Store Active Call Context` and
`NPC Vapi - Transfer Caller to Human via Twilio Redirect` both read a data store
called **`Vapi Calls Human Transfer`**, and on the Free plan it could not exist.
Creating it returned, verbatim: **`Not enough space in storage.`** Two limits
produced that — `dsslimit` of 1,048,576 bytes total against a 1 MB minimum
allocation, and `dslimit: 1`, one data store whatever its size.

**The organisation is now on Core and both limits are gone**: `dslimit` is
**1000** and `dsslimit` is **157,286,400**. The blocked half of the migration
was completed on 2026-09-15.

| | Created | Notes |
| --- | --- | --- |
| Data structure `My data structure` (`463357`) | already existed | byte-faithful to the legacy `583111` |
| Data structure `Key Field` (`463358`) | already existed | byte-faithful to the legacy `104789` |
| Data store **`Vapi Calls Human Transfer`** | **`150577`** | 50 MB, matching the legacy `163613` ceiling |
| Data store **`Property Posting Tracker`** | **`150578`** | 1 MB, matching the legacy `27908` ceiling |
| Scenario **`NPC Twilio - Store Active Call Context`** | **`6279258`** | hook `2704905`, the orphan minted for it |
| Scenario **`NPC Vapi - Transfer Caller to Human via Twilio Redirect`** | **`6279259`** | hook **`2815231`**, newly minted |

Only the structures pre-existed; the stores had never been creatable. Both
scenarios are **inactive**, as every other clone is.

The rewrite was three id substitutions, verified the same way the blueprint
rewrite was: masking each rewritten id in the before and after makes the
remainder byte-identical, so nothing but ids moved.

| Token | Old (eu2) | New (us2) | Occurrences |
| --- | --- | --- | ---: |
| `datastore` | `163613` | `150577` | 3 |
| `hook` (store context) | `4141282` | `2704905` | 1 |
| `hook` (transfer) | `4141547` | `2815231` | 1 |
| `__IMTCONN__` (Twilio) | `13284122` | `10496977` | 1 |

**`{{SECRET:TWILIO_ACCOUNT_SID}}` had to be restored in the transfer scenario.**
It is a repository redaction placeholder rather than Make syntax — see
[`../blueprints/make/SECRETS.md`](../blueprints/make/SECRETS.md), which records
that it is substituted only because GitHub push protection classes the SID as a
secret, and "needs restoring on import but not rotating". It sits in a live
mapper (`/2010-04-01/Accounts/<SID>/Calls/{{2.twilioParentCallSid}}`), so left
as the placeholder the Twilio redirect would have POSTed to a path that 404s.
The value was taken from the `uid` of the Twilio connection the module already
authenticates as (`10496977`), which is correct by construction — the URL has to
name the account the call is made against. It was written straight into Make and
deliberately not into any file here.

The store-context scenario carried the same placeholder only inside
`metadata.designer.samples`, which slimming drops, so it needed no restoration.

### The stores were migrated as archives, not replayed

`GHL Contact IDs` (`133627`) already held **2** records, and they are the right
two: the legacy store's 74 rows contain exactly two keyed by phone number
(`+61480845459`, `+61433005110`), and those are the ones the README identifies as
"what the intended behaviour looks like". The other 72 are keyed by `vapiCallId`,
so they are call-scoped, spent, and cannot be matched on phone by anything.
Nothing to do.

`Property Posting Tracker` is empty in the legacy account too. Correct as created.

**`Vapi Calls Human Transfer` was deliberately created empty**, and that is a
change of plan from "load the three well-formed rows". Five of the eight legacy
rows are malformed and were never in question. The other three are not loadable
either, for a reason the blueprint settles: the transfer scenario's router
branches on **`twilioParentCallSid` existing** and reads neither `expiresAt` nor
`status`. All three rows carry `status: "active"` with an `expiresAt` one hour
after a `createdAt` in May, July and August. A stale row is therefore
indistinguishable from a live one, and loading them would make a transfer request
from any of those three numbers redirect against a Twilio call that ended months
ago. An empty store takes the "no active call" branch and answers correctly.

## Activated 2026-09-15, and what was deliberately left off

The thirteen scenarios the Vapi tools will point at are **live**. Activating a
webhook scenario is inert on its own — nothing runs until something calls the
hook, and nothing calls these until Vapi is re-pointed — so this is the
prerequisite done, not the cutover.

| Active now | Serves |
| --- | --- |
| `Vapi - GHL Contact Resolver v4` | `ghl_resolve_contact` |
| `NPC Vapi - get_call_context v1` | `get_call_context` |
| `NPC Vapi - Transfer Caller to Human` | `transfer_to_human` |
| `NPC Twilio - Store Active Call Context` | the write half of the transfer pair |
| `Vapi - GHL Availability Intent Router (Native)` | `ghl_check_availability` |
| `Vapi - GHL Booking Intent Router (Native)` **and** `(Generic HTTP PIT)` | `ghl_create_booking` — both, because which one the eu2 tool belongs to is unresolved; whichever it is, it is live |
| `NPC Delete Booking Test` | `ghl_delete_event_npc` |
| `NPC Delete Strategy Session` / `(Zoom)` | `ghl_delete_event_npc_2` / `_2_1` |
| `NPC Delete IFC Session` / `(Zoom)` | `ghl_delete_event_npc_3` / `_3_1` |
| `Vapi - phoneNumber_inject v2` | `phoneNumber_inject` (`9789b720…`) |

Re-counted live on 2026-09-15: **thirteen** scenarios in this team are active,
and the row above is the thirteenth. It was resolved in
[`VAPI_REPOINT.md`](../vapi/npc-services/VAPI_REPOINT.md) but omitted from this
table, so the table said twelve while the account said thirteen. A fourteenth
scenario, `Aurixa — Builder Stock Sheet Link Recovery` (`6102712`), is also
active and belongs to a different piece of work.

**Everything that touches Airtable was left off, on purpose.** None of the
thirteen holds the Airtable connection — they are GoHighLevel, Twilio and OpenAI
only — which is what makes them safe to switch on while the base question is
open. Still inactive and staying that way: `NPC Delete Opt In Call`,
`NPC Delete Quiz Sub Call`, `Aurixa Stage 3 Access`, `Aurixa Waitlist Stage 1`,
`2` and `3`, `NPC Opt-In Follow Up Test`, `NPC Quiz Submission Follow Up Test`,
and the three `NPC Email` intake scenarios.

They have **not been tested**. A real test fires real GoHighLevel and Twilio
calls — creating contacts, bookings and redirects — so it needs a controlled
payload and a person watching, not an automated run.

## The base question, which sits above all of it

All six import-ready scenarios point at **`appFNPL7iYiuQyHAO`**, the rebuild, and
at the live base zero times. Counted in the blueprints: 26 references each in the
three `NPC Email` scenarios, 3 / 1 / 3 in the Aurixa trio.

**That base receives almost nothing, and the Aurixa half is still frozen.**
Re-measured 2026-09-15, and it has moved since the note above was written:

- `Property Intake Master` — the 148 migrated shells were **deleted**, and the
  table now holds **2 real listings** (a pilot, and one record from the backfill
  script's validation run). Neither came from Make; `NPC Email 1 New` is inactive
  and has no execution history in this account.
- `Aurixa Waitlist` — still **10 rows**, all stamped `2026-08-18T13:22:03`,
  newest `Date Added` **2026-08-15**. Unchanged. Frozen at the copy.

So activating the three `NPC Email` scenarios moves listing intake to a base that
holds two listings, and activating the Aurixa trio drives the invite funnel off
ten stale applicants while missing every new one. Neither is a Make problem and
neither has a Make fix.

**The listings half now has a remedy, and it is a prerequisite rather than a
decision.** `npm run listings:backfill-intake` copies the 171 live rows from
`listings_cache` into the rebuild, so a cutover stops presenting the whole
marketplace to `planReconciliation` as having vanished. Read
[`BASE_BACKFILL.md`](../../listings/BASE_BACKFILL.md) before running it — it
records what can and cannot travel, and why running it commits to nothing.

The Aurixa half has no equivalent: those ten applicants are the only copy, and
the live base has taken more since. That decision — which Airtable base is
authoritative — is still open, and until it is made the six stay off.

## Webhook re-pointing

Every URL moved from `hook.eu2.make.com` to `hook.us2.make.com` **and** got a new
random path, because a hook is minted per account. Nothing an external system
calls today reaches the new account.

Where the "old" column is filled in, that URL was observed in the exported
blueprints; the others are blank because the old account's token is zone-bound
and `hooks_get` against it answers *Access denied*, so the old paths cannot be
read back. Match those by scenario name.

| Scenario | Old (eu2) | New (us2) |
| --- | --- | --- |
| Aurixa Stage 3 Access | — | `https://hook.us2.make.com/t1a5ihubtgkrc38rq073gw4i1v427yxm` |
| Aurixa Waitlist Stage 1 | — | `https://hook.us2.make.com/eku2vhixkfc8uw3ua43a6apuri9x45fc` |
| Aurixa Waitlist Stage 2 | — | `https://hook.us2.make.com/xqat3ism55qanlbhu67qqx4t31yvcy6h` |
| Aurixa Waitlist Stage 3 | — | `https://hook.us2.make.com/gu22njaaq9smhe87feuflr4aksd7wnnp` |
| Discovery Call Handoff | — (see note) | `https://hook.us2.make.com/8k9ofpknay6jvcjuz9h8cg4vbpm51rrw` |
| GHL MCP - Get Contact By Phone via HTTP | — | `https://hook.us2.make.com/eexehoud6y1tfoinmepbvp8fcv1qfuj1` |
| Integration Webhooks, PDFMonkey | — | `https://hook.us2.make.com/l8laqb9a7y3kegqxe8a1b64eic1yxt74` |
| NPC Active Nurturing | — | `https://hook.us2.make.com/q4qyrh4kdblw23bwsa2rdltkkngv1snm` |
| NPC Active Nurturing Call Report | `…/wzvaxu6ye39jxx2w6l6jac9ab7rf4175` | `https://hook.us2.make.com/my4fk4f1hyvrtq3qwl88oae8ntiku3v4` |
| NPC Delete Booking Test | — | `https://hook.us2.make.com/jutejxif2dfkrqazi8ynjpq3cotdn0k7` |
| NPC Delete IFC Session | — | `https://hook.us2.make.com/h28wac173fn5xh2s28be6jdzb2gw5x5p` |
| NPC Delete IFC Session (Zoom) | — | `https://hook.us2.make.com/f87otoag2wcaol7rz4xeq93g1aythodg` |
| NPC Delete Opt In Call | — | `https://hook.us2.make.com/ert4tdi8k15qhmmxsqicexv74ia1q51i` |
| NPC Delete Quiz Sub Call | — | `https://hook.us2.make.com/s0yylebfdgytsvzo3uhsztwr44sfsvky` |
| NPC Delete Strategy Session | — | `https://hook.us2.make.com/asr1irn2e2iti84buwxvxgqnoydwtjkk` |
| NPC Delete Strategy Session (Zoom) | — | `https://hook.us2.make.com/brtnxcxdd8onngjgcxvkaiog14w5ovh1` |
| NPC Discovery Call Live | — | `https://hook.us2.make.com/otky3bah9ksxphhpvhzwm1ncsf5ndxg1` |
| NPC Discovery Call No Show Live | — | `https://hook.us2.make.com/txye1sx5fvfg5vofprxjaardu3un1vli` |
| NPC Discovery Call Test | — | `https://hook.us2.make.com/dqnothm6fwbvua1fiy32ied4fv1cja80` |
| NPC IFC Follow Up Test | — | `https://hook.us2.make.com/dwkqevibwxdftos6icdogaop9wb3tjc8` |
| NPC IFC No Show | — | `https://hook.us2.make.com/44tbnk20e6y9o0s9mxgjmn7dkk6k6fde` |
| NPC Opt-In Follow Up Test | — | `https://hook.us2.make.com/me8str56pir0gxknu3s279ti9950wgcr` |
| NPC Quiz Submission Follow Up Test | — | `https://hook.us2.make.com/xxhfg3ayu3h7yhmzgnzpfenlv76kjmvd` |
| NPC Strategy Session Follow Up Test | — | `https://hook.us2.make.com/9ebqzi0xmtorn6ynqe3j5sb2365593v8` |
| NPC Strategy Session Follow Up Zoom | — | `https://hook.us2.make.com/s8ny42w7po89hat5zplc1oj8nn7ovzvw` |
| NPC Strategy Session No Show | — | `https://hook.us2.make.com/6o13hcomme3bighypclz2d7m1b0k8g2v` |
| NPC Twilio - Store Active Call Context | — | `https://hook.us2.make.com/ydaccnot9sfslqi255w651nmc428umpn` |
| NPC Vapi - Transfer Caller to Human via Twilio Redirect | `…/jb85m14jchgktf09sfxt4jmf8yggaw32` | `https://hook.us2.make.com/a783hucnh5qyxwq8o5cclbf2edwkr5up` |
| NPC Vapi - get_call_context v1 | `…/o51u3jb5g1nn1lxiluziezpr7gh5vvt8` | `https://hook.us2.make.com/7lw416w6whh5gfat56o9190vbbqc10pj` |
| Vapi - GHL Availability Intent Router (Native) | — | `https://hook.us2.make.com/ik45qbx1lvykjpndcfkdsy6ljqt9y9v9` |
| Vapi - GHL Booking Intent Router (Generic HTTP PIT) | — | `https://hook.us2.make.com/017xspgxrpxqh93feqi7bms3pmxmv19e` |
| Vapi - GHL Booking Intent Router (Native) | — | `https://hook.us2.make.com/17y0m4ovieujdl4acsrq8lgslnqrayoc` |
| Vapi - GHL Contact Resolver v3 PRODUCTION | `…/0j9gs0k50m1vgf9gv65gy1mteanfduyx` | `https://hook.us2.make.com/9t8up9akpn5a1frmkwwec05u09ueuxma` |
| Vapi - GHL Contact Resolver v4 CANONICAL VARIABLES | `…/db3ws2lmqi4qh9ozsyt1tvn3j8tbeahm` | `https://hook.us2.make.com/gukfea8c5p61cm2pmdzf3sfl74y9huws` |
| Vapi phoneNumber_inject v2 | — | `https://hook.us2.make.com/hdgcn4brzcuv4u81dao7zp4r97ov2lv8` |

**The two `vapi2` hooks are different.** `NPC Active Nurturing Call Report` and
`Discovery Call Handoff` are Vapi *app* hooks, bound to an assistant id
(`cc46d882-…` and `bfff143e-…`) through connection `10496920`. They are not
editable as plain URLs — re-pointing those means updating the assistant in Vapi.

### One row in this table was wrong, and why

**`2ubukyatwc0ig8zinphjjc4dciwhigqg` was never `Discovery Call Handoff`'s hook.**
It is the server URL of the Vapi tool `phoneNumber_inject` (`9789b720…`),
confirmed against the live Vapi API on 2026-09-15 and already agreed by six other
files in this repository. The row above is corrected to blank.

The error came from the method described below, and the method is the lesson:
searching the blueprints for an eu2 udid finds it, but **every occurrence of
every such udid sits inside `metadata.designer.samples`** and none sits in live
configuration. A sample is a cached Vapi payload, so a sample in scenario A
routinely carries scenario B's URL — `9inh27jw…` appears in the samples of five
different delete scenarios, which one tool cannot own. A blueprint hit shows
that a scenario *saw* a URL, never that it *owns* one.

The eu2 hook→scenario binding is readable only from the legacy account, whose
token is zone-bound. It cannot be recovered from these exports.
[`../vapi/npc-services/VAPI_REPOINT.md`](../vapi/npc-services/VAPI_REPOINT.md)
carries the map that could be resolved without it — ten of thirteen — and names
the one that could not.

### Where the eu2 URLs were found, and what that means

The old URLs turned up in `metadata.designer.samples` — cached payloads from Vapi
test runs, not live configuration. Two consequences, and the second is the useful
one:

- **No cloned scenario calls the old account.** Slimming dropped
  `metadata.expect`, `interface` and `restore`, and with them these samples. A
  grep for `hook.eu2.make.com` across every blueprint used to create the 31
  clones, and across the six import-ready files, returns nothing.
- **The samples record what Vapi was pointed at.** A sample containing
  `server.url: https://hook.eu2.make.com/…` is evidence that a Vapi assistant
  tool calls that URL — which is exactly the list of external callers to change.

## Still to do outside this file

- Rotate the Vapi key and both GHL keys, then apply the 7 GHL contact-cache key
  edits in the Make UI.
- `NPC Discovery Call Summary` was deliberately skipped: its Airtable step writes
  an empty value into one field of base `appFOpIVCltTyJKgM`, which is outside
  this migration.
