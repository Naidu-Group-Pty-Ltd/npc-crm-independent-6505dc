# Duplicate listing records

Why the Property Marketplace showed 148 listings for 107 properties, and what
now happens about it.

## The measurement

Taken from `listings_cache` on 2026-08-19 — the same 148 records the page renders.

| | |
| --- | --- |
| Records on the page | 148 |
| Records carrying an address | 145 |
| **Distinct addresses** | **107** |
| Repeat groups | 23 |
| **Redundant cards** | **38 — 26% of the page** |

Four of them are visible twice in a single screenshot of the grid: `14 Yillowra
Street` and `7 New Street, Auburn` each appear as two cards a few rows apart.

## What is actually happening

`14 Yillowra St, Auburn` exists **four times**:

| Record | Created | Price | Agency |
| --- | --- | --- | --- |
| `rec13OFeA8GW4Xal9` | 22:34:47 | 1380000 | First National Real Estate Waters & Carpenter |
| `recrC0C9oTXI2BqSa` | 22:37:34 | 1380000 | First National Real Estate Waters & Carpenter |
| `recO6W0tSn0NnFVdm` | 22:41:28 | 1380000 | Waters & Carpenter First National Auburn |
| `rec1ZRVM0b3GNr4R0` | 22:44:53 | 1380000 | First National Real Estate Waters & Carpenter |

Same evening, roughly three minutes apart, same price, same four photographs.
Across the whole corpus **every** repeat group was created inside ten minutes,
and 19 of 23 carry an identical price. That is not two agents listing one
property; it is one message written more than once.

The message headers settle it. All eight records for `14 Yillowra St` and `7 New
St` come from one thread — *"Fwd: 2025 August Sales Update Newsletter"* — under
two `Internet Message ID`s, and **each of those two messages produced both
properties twice**:

```
<CAAhO+ASg_+8…>  22:34:46  7 New St     22:34:47  14 Yillowra St
<CAAhO+ASg_+8…>  22:37:33  7 New St     22:37:34  14 Yillowra St   ← same message, again
<CAAhO+ARxCJv…>  22:41:27  7 New St     22:41:28  14 Yillowra St
<CAAhO+ARxCJv…>  22:44:51  7 New St     22:44:53  14 Yillowra St   ← same message, again
```

So there are two faults stacked:

1. **The intake scenario has no idempotency key.** It re-processes a message it
   has already written and files a second set of records. This is the fault to
   fix at source — `NPC Email 1 New` (Make id `9618493`) should look for the
   `Internet Message ID` before it creates, not after.
2. **The same newsletter was forwarded twice**, producing two message ids for
   one set of properties. Nothing upstream can prevent that; it has to be caught
   on the property, not on the message.

Note that a newsletter legitimately carries several properties, so the message
id **alone is not the key** — one email is *supposed* to become several
listings. What identifies a listing is the property.

## The case that constrains any fix

Eleven records share the address `City Beach WA 6015`. They are **eleven
different properties** whose street number never got extracted:

| Price | Type |
| --- | --- |
| $3.4-$4M | House |
| $4-$5Ms | House |
| Mid $3Ms | House |
| $18-20M | House |
| $1.65M | Villa |
| Pre-Register your interest | Land |

They were written one *second* apart, from a single pass over a single email —
the signature of one email carrying many properties, which is the opposite of
the fault above. **Merging on address alone would delete nine real listings.**

## The rule

`_shared/listingDuplicates.pure.ts`. Two records are the same listing when they
agree on **street address, price text, property type, bedrooms and land size**.

- **An address with no street number is never a key.** That is what protects
  City Beach.
- **The price text is part of the identity, not a tie-break.** `93 Auburn Rd`
  correctly stays two cards, because its two pairs are priced `$555,000` and
  `$500,000 - $550,000`.
- **A record with no price text is never merged.** 70 of the 148 are not keyed
  at all, and are left exactly as they are.

Applied to production: **148 records → 122 cards, 26 merged**, across 20 groups.
Every group was created within 2–10 minutes, and every one agrees on all five
fields. None looks like two properties.

## Where it runs

`propertyDataService.buildResult` — the single funnel every listings read
returns through, cached or fresh. So the Overview totals and the quantitative
reports stop counting one property four times, not just the marketplace grid.

Nothing is deleted in Airtable and nothing is hidden from a reconciliation: the
survivor carries `duplicateCount`, and `debugInfo.duplicatesRemoved` — a field
that has existed and been hardcoded to `0` since the service was written —
finally means something.

The survivor is the copy with the **most photographs**, then the most recently
filed. The four `7 New St` records hold 12, 12, 9 and 12 images; the reader
should get a twelve-photograph gallery rather than whichever record happened to
be written last.

## Why not in `airtable-proxy`, which already tags duplicates

It already groups on `address|suburb|beds|baths`, marks the runners-up with
`duplicateOf`, sets `duplicateCount` on the best one — and deliberately removes
nothing, because an earlier version silently dropped 268 of 1,441 records on
every read. It left the decision to the client. **No client ever made it**;
`duplicateOf` is read nowhere in `src/`.

Honouring that tag as it stands would be worse than ignoring it: its key carries
no price and no street-number guard, so the eleven City Beach records fall into
one group and nine real listings would disappear. It also groups **within a
single 100-record page**, so what it matches is partly an accident of
pagination.

The client-side rule sees the whole set and cannot make either mistake. The
proxy's tags are left as they are.

## What is still worth fixing at source

This module makes the page correct. It does not stop the table growing:

- Airtable keeps accumulating records — 26 redundant of 148 today, and the
  30-day purge is what currently bounds it.
- The listing image library harvests photographs for every copy, so the same
  gallery is downloaded and stored several times. 236 of 471 listings in
  `listing_images` hold a gallery that is byte-identical to another listing's,
  which is almost entirely this.

The durable fix is an idempotency key in `NPC Email 1 New`: search
`Property Intake Master` for the incoming `Internet Message ID` **and** the
extracted address before creating a record, and update rather than insert. See
[`NPC_EMAIL_1_AUDIT.md`](../integrations/NPC_EMAIL_1_AUDIT.md) for the scenario's
other 22 defects.
