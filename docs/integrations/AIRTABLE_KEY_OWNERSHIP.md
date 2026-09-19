# Who owns the Airtable key

Two different things on this platform talk to Airtable, and until 6 Sep 2026
they shared one secret name by accident.

## The Listings & Overview pipeline

`airtable-proxy`, `listings-cache`, `listing-images`, `listing-enrichment` and
`auto-report-sync` read the **Property Intake Master** table through six
environment names:

| Name | What it is |
|---|---|
| `AIRTABLE_TOKEN` | The personal access token the pipeline reads with |
| `AIRTABLE_BASE_ID` | The `NPC Emails` base |
| `AIRTABLE_TABLE_NAME` | The intake table (an id in this deployment) |
| `AIRTABLE_TABLE_ALLOWLIST` | The tables `airtable-proxy` may serve |
| `AIRTABLE_TABLE_ALIASES` | Alias overrides for table names |
| `AIRTABLE_IMAGE_LIBRARY_FIELD` | The attachment field `listing-images` harvests |

By the owner's decision every deployment reads the same intake. Nothing on a
deployment's own pages sets any of these names.

**But two of the six no longer travel, and that is the point of the arrangement
below.** `AIRTABLE_TOKEN` and `AIRTABLE_BASE_ID` are held by Mission Control and
never forwarded — their ledger status on every clone is `withheld`, and the
`brokered` secret class refuses them ahead of fleet policy and any per-clone
row, so a clone provisioned tomorrow cannot be given them either. The other four
are configuration rather than credentials and forward as before
(`prime_secret_forwards` still carries all six as `inherit = true`; the class
check is what stops two of them).

The names live once, in `supabase/functions/_shared/listingsPipelineSecrets.pure.ts`.

## Which base is live, and why a valid token can still be refused

**There are two `NPC Emails` bases, in two different Airtable accounts, and only
one of them is live.** The live one is `apptyShYE0yzL4IGB`. It was rebuilt into a
second account as `appFNPL7iYiuQyHAO` on 2026-08-18 and **the cutover was never
completed** — so both are documented as though the move had happened
([`REBUILT_BASE.md`](./airtable/npc-emails/REBUILT_BASE.md) describes the target,
[`MAKE_CUTOVER.md`](./make/MAKE_CUTOVER.md) records the re-pointed blueprints),
and nothing in either file says the switch was never thrown. That is the trap:
it all reads like a finished migration.

Measured 2026-09-08:

| | `apptyShYE0yzL4IGB` (live) | `appFNPL7iYiuQyHAO` (rebuild) |
|---|---|---|
| Property Intake Master | `tblWIg5cs85O30pcY` | `tblumTIRYBn92B2ST` |
| Records | growing | **148, unchanged since the copy** |
| Newest record | `2026-09-08 04:11` | `2026-08-18 13:20:37` |
| Created timestamps | spread over weeks | **every one of the 148 identical** — one bulk write |

The prime's `listings_cache` holds 222 rows of which **171 were created after
that copy** (the other 51 are archived and all predate it), landing on 3
separate days in the last week alone. The intake scenario is still writing to
the base the rebuild was meant to replace.

Two things follow, and both have already cost time.

**A perfectly good token can be refused, and the 401 says nothing about the
token.** A personal access token is minted inside one account and can only ever
reach that account's bases. A `pat…` from the account that owns
`appFNPL7iYiuQyHAO` is well-formed, unrevoked and correctly scoped — and still
answers 401 against `apptyShYE0yzL4IGB`, which its account does not own.
(Measured: a credential holding `appFNPL7iYiuQyHAO` gets **403** merely listing
`apptyShYE0yzL4IGB`'s tables.) So when a brokered read is refused, the first
question is not whether the token is valid but **which account minted it**; the
prime reads this base successfully, so the prime's account is the comparison.
Mission Control's `describeCredential` leads its remedy with this cause for
exactly that reason, and records the verdict in
`api_usage_events.metadata.credential_shape` so the next occurrence is
diagnosable from the ledger alone.

**Re-pointing the dashboard at the rebuild would destroy the marketplace.** It
substitutes 148 records frozen on 18 August for a table that has grown by 171
since, and `listings_cache` is an archive with nothing anywhere that can rebuild
a listing — see [`AIRTABLE_RETENTION.md`](./AIRTABLE_RETENTION.md), which
records what a thirty-day fuse on this table already nearly cost. Completing the
cutover is a legitimate decision, but it begins with moving the live data and
re-pointing the Make scenario, **not** with changing a base id. Until it is
made, `AIRTABLE_BASE_ID` names `apptyShYE0yzL4IGB` on the prime and in Mission
Control, and `TABLE_KEY_ALIASES` in `src/lib/listingsCacheApi.ts` correctly
resolves `Property Intake Master` to `tblWIg5cs85O30pcY`. The base id itself
lives only in the environment; the table id is the one identifier written in
source, which is why it is named here.

## Reading it: the credential stops, the call travels

An Airtable personal access token carries its **whole scope** — a set of bases
and a set of permissions, fixed when it was minted — and nothing in the
credential narrows it to one table. A forwarded token on a tenant's Supabase
project therefore reaches every base its scope admits, and if that scope
includes `data.records:write` it can rewrite the shared intake table every other
deployment reads. Airtable publishes no per-tenant sub-credential. Two more
reasons that are not about secrecy: one base has one rate limit (5 req/s) and a
cold Listings read is sequential pages, so forwarded, one clone refreshing
starves the others against a budget none of them can see; and a forwarded token
is rotated by re-forwarding to every clone and hoping.

So Mission Control runs the read: `GET /api/public/listings/{tables|records|selftest}`,
authenticated by the Mission Control key the clone already holds.
`_shared/airtableListingsRoute.pure.ts` is the one module that decides where a
read goes — `direct` where the token is held (the prime), `broker` where the
Mission Control pair is, and `unconfigured` otherwise, named rather than silent.

Four rules carry it.

- **The base is Mission Control's and a caller never names one.** A broker that
  accepted a caller's base would let any tenant read every base the token
  reaches — the identical leak, through the thing built to close it. The
  `broker` branch of `ListingsRoute` has no `baseId` field at all.
- **A token with no base id is `unconfigured`, never brokered.** Brokering it
  would read a different base from the one the deployment was set up for and
  produce a plausible marketplace of somebody else's listings.
- **A brokered read is not metered at the clone.** Mission Control writes the
  usage row because Mission Control made the vendor call; `meter` is `true`
  only on the direct route, and both ends billing is worse than neither.
- **Who refused is read from a header.** `x-mission-control-refusal` is set on
  Mission Control's own refusals and never on what it relays, because both ends
  answer 401/403/429 with similar JSON and send an operator to opposite
  remedies.

## Writing to it: the write-back never leaves the account holder

`listing-images` writes the durable image URLs into the enrichment column and
`listing-enrichment` writes resolved field values. Both are correct on the prime,
which owns the base, and wrong from a clone for a reason that has nothing to do
with secrecy: every deployment reads the **same** table, and what a clone would
write are signed URLs into **its own** bucket. Publishing those into the shared
record hands every other tenant links that are useless to them.

So the broker is **read-only by construction** — a write operation would hand a
tenant the ability to rewrite the table every other tenant reads, which is the
leak the whole arrangement exists to close. `resolveWritebackRoute` is the other
half: it answers `direct` where the token is held and `refused` everywhere else,
and the refusal names the RULE rather than a missing setting, because a clone
will never hold this token and "not configured" would send an operator looking
for something to fix that must not exist. Both sweeps report `skipped` rather
than failing, since nothing failed.

## The one read that needs a query language, and how it is admitted

`listing-images` asks for the photograph columns of the listings it has claimed
— which is what puts pictures on a listing card — and Airtable spells that
`filterByFormula=OR(RECORD_ID()='rec…',…)`. A query language reaching a shared
table through a credential the caller does not hold is an exfiltration primitive
with a friendly name, so the formula is never sent.

The caller sends **ids**; each is checked against `rec` plus fourteen
alphanumerics; Mission Control composes the formula itself. An id matching that
pattern can hold no quote, no parenthesis, no comma and no operator, so a
formula built from checked ids can only be the OR of record handles it was meant
to be. That is the difference between *the caller may name rows* and *the caller
may ask questions*, and only the first is safe to broker. The check is a
character allow-list — never an escape, never a blocklist — and it is read twice
on purpose: once where the caller can learn about it, and once in the function
that actually reaches the vendor.

Refusing beats filtering: a caller that asked for twelve listings and silently
received eleven would fingerprint the twelfth as having no photographs and
re-arm its schedule having done nothing.

## The Integrations page's Airtable card

The card on `/integrations` collected an "API Key" as `AIRTABLE_API_KEY` and a
"Base ID" as `AIRTABLE_BASE_ID`, and `SUPABASE_SECRET_ALIASES` mapped the first
onto `AIRTABLE_TOKEN` before `update-integration-secret` wrote both into the
project's environment through the Management API. So a key typed on that page
**superseded the pipeline's key** on whichever deployment it was typed on, and
a base id typed there re-pointed the pipeline at another base. Nothing failed
loudly; the Listings page simply read somebody else's Airtable, or nothing.

The card is the **workflow connection** now — what the Workflow Playground's
Airtable operations (`airtable.list_records`, `create_record`,
`update_record`) authenticate with — under its own names:

| Field | Secret |
|---|---|
| API key (workflows) | `AIRTABLE_API_KEY` |
| Base ID (workflows) | `AIRTABLE_WORKFLOW_BASE_ID` |

The alias is gone, the generated allow-list no longer contains any pipeline
name (so the endpoint cannot be asked for one by a hand-built request either),
and `update-integration-secret` refuses the six pipeline names **before** the
allow-list check with a message that names the rule, because "not in
allowlist" reads as a typo and this is a decision.

## Three rules

1. **A pipeline name is never written from a deployment's own pages.** If the
   value has to change, it changes on Mission Control and travels.
2. **The workflow connection and the pipeline are different credentials with
   different names**, even where an operator would use the same Airtable
   account for both. Sharing a name is how one page came to overwrite the other.
3. **The list is the contract.** `listingsPipelineSecrets.test.ts` reads the
   pipeline functions and fails if any of them reads an `AIRTABLE_*` name
   the list does not carry, or if any Integrations field resolves to one it does.
4. **No pipeline function names `api.airtable.com` itself.** Every read and
   every write goes through `airtableListingsRoute.pure.ts`, asserted by
   `src/lib/listings/airtableListingsRoute.spec.ts` over all five functions —
   which is what stops a new call site quietly re-acquiring the direct path.
