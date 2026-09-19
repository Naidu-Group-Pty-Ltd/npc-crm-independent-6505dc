# One living record, versioned history

**Read this before touching `attestationCurrency.pure.ts`,
`attestationForGrantRead`, the manifest carry-forward in `issue_attestation`,
or anything that resolves which attestation a reader gets.**

The question that produced this was the right one: *why is version management
mine? This is live documentation — the most recent version should always be
there, with the history filed.*

## Why versions exist at all, and why they stay

An attestation is a frozen, hash-stamped statement of the customer due
diligence that was performed. Freezing it is not ceremony. A partner relying
under AML/CTF Act Pt 2 Div 7 must be able to say afterwards *which* record
they relied on, and a hash that changes underneath them makes that
unanswerable. So versions are real and they remain.

What was wrong was not that versions existed. It was that **the operator was
made responsible for them**, and the mechanism actively fought the outcome
they were asking for.

## The defect

A grant pins `attestation_id` at the moment it is minted, and every read path
resolved the document through that pin. So the instant the MLRO issued v2 —
the ordinary consequence of a material change — every existing partner's read
answered:

```
409 attestation_superseded
"This attestation has been superseded. Ask the issuing organisation for
 current access."
```

Nothing failed. It worked exactly as written. But **issuing a new version
silently revoked every partner who already held the Passport**, and the only
repair was for the operator to re-send it to each of them by hand — work the
product never told them was now owed, and precisely the work they were
objecting to.

Under schema v2 there was a second, independent reason for the same outcome:
a v2 grant reads through a disclosure manifest scoped to one attestation, and
`issue_attestation` wrote the new version and nothing else. Even with the
supersession check removed, every read would have failed `manifest_missing`.

## The rule

**A grant authorises a PARTNER to read a CASE's attested record. It does not
freeze which version of that record they see.**

A read resolves the case's current attestation. The version actually served is
recorded on `reliance_access_log` — where an auditor needs it — instead of
being enforced by breaking the link.

Three rules carry it.

**The grant's pin is history, never the reading.** `attestation_id` still
records what the grant was issued against and is never rewritten: that is the
audit fact. It stops being the thing that decides what is served. Nothing in
the carry-forward mutates a grant.

**Current means CURRENT, not merely newer.** A version flagged for refresh is
withheld exactly as before, and that is a different question from
supersession: superseded means *"there is a better one, here it is"*, while
refresh-required means *"we know this one is wrong and there is nothing better
yet"*. Serving the second would let a partner rely on a record we have already
contradicted. The refusal now promises them they need **no new link** — it
will appear when the new version is issued.

**A widening is never implicit.** Following the current version requires a
manifest for that version, so `issue_attestation` carries every live grant's
manifest forward. It is additive — one new row per live grant, with the
allowed attribute codes, record classes, denied classes and expiry **copied
from the manifest it succeeds**. A partner's authorisation after a re-issue is
exactly what it was before it. A grant whose predecessor had no manifest gets
none: absence of evidence is not authority, and it fails closed on read.

A carry-forward that fails is logged and never fails the issue itself. The
version is the compliance act; a grant that could not be carried forward fails
closed, which is the safe direction.

## Where the version is now visible

The Command Centre keeps the version register — that is the history, filed.
Every reader sees the current record, and a reader who has been moved forward
is **told**: `record_currency` carries `moved_forward`, the version they are
reading and the version their access was issued against, because what a
partner may rely on is the record in front of them and not the one they
remember.

The emailed link and the in-portal page use the same resolver
(`attestationForGrantRead`), so two surfaces cannot disagree about one record.

## Tests

`src/lib/aml/passport/attestationCurrency.test.ts` — the resolver, the
carry-forward set, and the source wiring: both read paths use the one
resolver, the pin is never rewritten, the carry copies scope rather than
inventing it, and a superseded document is still never served.
