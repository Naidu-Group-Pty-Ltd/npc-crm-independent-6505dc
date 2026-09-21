# 48 — The Network → Clone stock sync, and the one mapping that silences it

Read this before touching `builder_network_enqueue_stock_item`,
`builder_network_backfill_stock_sync`, `workspace_connections.builder_organisation_id`
on the network, `builder_network_connections.builder_organisation_id` here, or
either half of the connection re-point.

On 18 September 2026 this marketplace stopped drawing Builder Stock cards. It
drew none at all for about 22 hours. **Nothing was broken**, nothing failed,
nothing was logged, and every health signal on both databases read green
throughout.

## What was measured, 19 September 2026

Both halves read-only, before anything was changed —
`network-sync-state` on `aurixa-builders` and `builder-network-sync-state` here.

The transport was **entirely healthy**:

| | |
| --- | --- |
| outbox | 91 events, **91 delivered**, 0 pending, 0 dead, max attempts **1** |
| outbox worker | every minute, HTTP 200, `{"claimed":0,"delivered":0,"retried":0,"dead":0}` |
| producer triggers | all three enabled (`tgenabled = 'O'`) |
| payload composer | current — it carries `source_column` |
| connection | `active`, HMAC present, `inbound_url` correct on both sides |
| cron | `builder-network-outbox-worker-1min` and `builder-network-inbound-apply-1min` both active and succeeding |
| `portal_operational_events` | **no `builder_network_*` row in 14 days, on either database** |

And the enqueue's own join returned **zero**.

Six builder organisations existed on the network. Exactly one had a connection,
and it was the only one with nothing to send:

| organisation | builder | created | active items | active connections |
| --- | --- | --- | --- | --- |
| `dfdbff19` | **Mairandi Developers** | 18 Sep 08:53:46 | **46** | **0** |
| `00f9e45f` | Bob The Builder | 07 Sep | 0 | **1** |
| `4dc94d3c` | Kopi Jantan Builders | 04 Aug | 0 | 0 |
| `7a637853` | NPC Services | 18 Sep 09:47 | 0 | 0 |
| `ffbfa1be` | XT | 18 Sep 11:46 | 0 | 0 |
| `484b9618` | Bob The Builder Pty Ltd | 18 Sep 12:11 | 0 | 0 |

## The fault

`builder_network_enqueue_stock_item` reaches a connection only through

```sql
JOIN public.workspace_connections c ON i.organisation_id = c.builder_organisation_id
WHERE c.state = 'active'
```

The connection was wired on 16 September to a **test** organisation. The real
builder was onboarded on 18 September under a **new** organisation that no
connection served. So for every one of the 46 live properties that join is
empty: the trigger fires, the payload composes, and nothing is inserted.

**First broken step: the outbox producer, from 2026-09-18 09:26:06 UTC.**

### Why nothing reported it

An event that is never composed is indistinguishable from a builder who changed
nothing. There is no row to be pending, no attempt to fail, no error to log, and
every downstream component correctly reports that it has nothing to do. The
worker truthfully answers `claimed: 0` sixty times an hour.

This is the same shape as the gaps recorded in
[CLONE_PROVISIONING_GAPS](../operations/CLONE_PROVISIONING_GAPS.md): *before
concluding a deployment is missing something, check whether the thing is present
anywhere*. Here the inverse applies — **before concluding a pipeline is broken,
check whether it has anything to carry.**

## The reported symptom was the last correct delivery

"The mirror stopped updating on 18 Sep around 01:31" is true and is not the
fault:

| when (UTC) | what |
| --- | --- |
| 16 Sep 06:09:26 | connection accepted → activation backfill enqueued |
| 16 Sep ~06:11:30 | those delivered and applied — the mirror's `last_seen` |
| 18 Sep 01:29:17 | Bob The Builder's 205 items archived on the network |
| 18 Sep 01:30:04–01:31:38 | delivered, first attempt; applied here at **01:31:37.988854** |
| 18 Sep 08:53:46 | Mairandi Developers created |
| **18 Sep 09:26:06** | **its 46 properties created — no connection serves them** |
| 18 Sep 18:07:00 | daily reconcile fired and delivered correctly, carrying an empty id set |

The mirror did not stop. It ran out of things to be told. **A last-updated
timestamp names the last thing that happened, never the moment something broke**
— and reading it as the latter is what sends an investigation to the transport,
which is where every green signal already was.

## The repair, and why it is shaped this way

### Re-point, do not mint a second connection

`workspace_connections_live_key` is unique on
`(workspace_id, builder_organisation_id) WHERE state <> 'revoked'`, so a
workspace may hold one live connection per builder and a **second builder will
genuinely need a second connection**. That act needs a secret: acceptance mints
it, `provision_transport` returns it exactly once, and Mission Control is meant
to install it clone-side — a catcher this platform never wrote (see
[CLONE_PROVISIONING_GAPS](../operations/CLONE_PROVISIONING_GAPS.md): nothing
anywhere writes `builder_network_connections`).

Hand-carrying an HMAC secret between two databases through an operator console
and a CI log is a worse thing to do than moving a mapping. The re-point changes
one column on each side, moves no credential, and is reversible by its own
inverse.

**This is a limitation, not a solution.** The day a second builder has live
stock, that connection has to be minted properly, and the clone-side installer
is the piece that does not exist.

### The order is enforced, never remembered

`builder_network_apply_inbound_events` refuses a payload whose organisation is
not its connection's, as `organisation_mismatch` at severity **critical** — and
a refusal **consumes** the event, stamping `processed_at`. It is never retried.

So re-pointing the network first burns the entire backfill against a clone that
still disagrees, and leaves 47 consumed events and a still-empty marketplace.

**The clone goes first.** The network's half reads the clone's row and refuses
until it names the target; a clone that cannot be read is a refusal too, because
a check that could not be made is not a check that passed. That guard was proved
against production before the repair ran — its dry run refused in exactly those
words.

### What each half refuses

The network half (`network-connection-remap`) refuses: a target organisation
with no active stock (that would send a reconcile naming an empty catalogue,
which is how a marketplace is emptied by hand), a second live connection already
serving the target, a connection with no usable transport, more than one live
connection when it was not told which, and a clone that disagrees or cannot be
read.

The clone half (`builder-network-connection-remap`) refuses: more than one live
connection, one that is not `active`, and one whose `network_inbound_url` is not
the network's inbound door. That last is not cosmetic — the mirrored image URL
is **derived** from that field by replacing the suffix with
`/builder-network-stock-image?id=`, so a wrong one lands the stock with no image
and draws every card blank, which is a repair that looks like it worked until
somebody opens the page.

Its `statement()` accepts SELECTs and exactly one shape of UPDATE, which is a
property of the file rather than a promise about how it is called.
`builderNetworkRemapGuard.spec.ts` executes that expression against the
statement the lane composes and against six shapes it must refuse; four mutants
of the expression are caught.

## Rules

1. **A pipeline with nothing to carry is indistinguishable from a broken one.**
   Every counter reads zero and every component is correct. Ask what the
   producer's own predicate selects before reading any transport signal.
2. **A last-updated timestamp names the last thing that happened**, not the
   moment something stopped. On this incident the reported time was the last
   *correct* delivery, 8 hours before the fault.
3. **A refusal that consumes its event makes ordering load-bearing.** Where two
   databases must agree before one sends, the sender reads the receiver and
   refuses — and an unreadable receiver is a refusal, not a pass.
4. **The connection's organisation mapping is the single point of failure for
   the whole mirror**, it is written by nothing, and no surface displays it.
   Anything that onboards a builder has to answer it.
