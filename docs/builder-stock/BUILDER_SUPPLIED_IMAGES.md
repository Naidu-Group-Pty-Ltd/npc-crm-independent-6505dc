# The picture a builder hands over

Read this before touching `builderSuppliedImage.pure.ts`,
`attachBuilderImage.ts`, `roleFromBuilderProperty`, the
`create_builder_image` / `attach_builder_image` operations, or
`BuilderPropertyImage.tsx`. Read
[`SUPPLIED_EVIDENCE.md`](./SUPPLIED_EVIDENCE.md) first if you are here because
a card is blank — a blank card is almost never this module's business.

## What this is

**A manual override for ONE property, and never part of ordinary ingestion.**
A builder (or the Command Centre acting on their behalf, gated on `listings`
edit) can attach a picture to one named property. It is stored as an ordinary
`builder_stock_item_images` row — `uploaded_document` / `source_supplied`,
evidence level 1 — so it travels every existing rule unchanged:
`isDisplayableSourceImage` admits it, the eligibility sweep judges its pixels,
and `chooseCardImage` orders it. Nothing here writes `primary_image_id`.

Level 1 is what makes it an override: the builder said "this is that
property's picture", and nothing was read, inferred or matched to arrive at
it, so it outranks anything taken out of a document.

The bytes are validated **server-side, out of storage**: the browser gets a
signed upload URL, PUTs, and a second call downloads what was actually stored
and validates that. A storage path arriving in a request body is a lookup key,
never authority — `isBuilderSuppliedPath` accepts exactly one prefix,
`builder-supplied/<org>/<item>/<file>`.

## What this deliberately is NOT — the withdrawn design renders

This module briefly carried a second scope: **"Design renders"** — a panel
listing the house designs a builder's stock states, an "Add render" button,
and a fan-out that copied one uploaded picture onto every lot stating that
design, and onto every future lot of it, for ever
(`builder_design_images`, `fanOutDesignImage`, `applyDesignRenderFor`,
`roleFromBuilderDesign`, `list_designs`, `delete_design_image`,
`BuilderDesignRenders.tsx`). **It is withdrawn**, and
`20261104000000_builder_stock_withdraw_design_renders.sql` dropped its table —
safely, because production held **zero** design images, zero fan-out rows and
zero stored objects: nothing was ever supplied through it.

Two reasons, and the second would have stood even if the first had not.

**It was a workaround for a data-loss bug.** The "13 rows with no document"
it was built for *do* carry documents — a Dropbox brochure behind the word
`Brochure` — and the reasons they were not read were faults in the readers: a
package path that refused every host but Google Drive, a worker killed
decoding twelve pages of a 13 MB PDF before anything was decided, and an
attempt claim released before the recovered picture was durable. All three
are fixed. Asking a person to upload pictures one design at a time was asking
them to hand-compensate for the product's own record-keeping, for ever.

**A design string is not evidence about a house.** The fan-out attributed a
photograph to properties nobody had looked at, on nothing stronger than two
cells matching. The rule everywhere else in this subsystem is that a picture
reaches a card only on evidence about *that property*, and that a correct
blank beats a plausible wrong house. A manually uploaded generic render is
exactly the "wrong generic image" the fallback ladder already refuses when it
finds one on the open internet.

**Hiding was not enough; the machinery is deleted** — the panel, the fan-out,
the design endpoints, the design storage path, and the second accepted storage
prefix. A dormant fan-out is one import away from putting one picture on
eleven cards again.

## The precedence that keeps the override honest

```
1  builder attached to THIS property        (this module — level 1)
2  brochure page naming THIS lot            (package reader)
4  design brochure / design-level evidence  (read from a document, never uploaded)
6+ verified web fallback, Street View       (only after supplied evidence is exhausted)
```

A brochure naming the exact lot can never be displaced by this module's
absence, and the external ladder can never run while the builder's own
sources are unfinished — that gate lives in `suppliedEvidence.pure.ts` and is
documented in [`SUPPLIED_EVIDENCE.md`](./SUPPLIED_EVIDENCE.md).
