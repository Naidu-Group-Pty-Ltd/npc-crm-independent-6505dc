# Stage 6's working surface — record, verify, and what the Passport makes of it

Read this before touching `fundingEvidence.pure.ts`, `FundingEvidencePanel`,
the `upsert_sof` op in `aml-monitoring`, or the SOURCE OF FUNDS REVIEWED stamp.

## What was missing

Everything below the API. `aml.source_of_funds` had a complete server op —
allowlisted columns, server-stamped verifier, write-role gated — and a client
API (`amlMonitoringApi.upsertSof`). **No UI called it.** Stage 6 said "No
source of funds recorded", its own button opened a section whose only card was
a read-only view of the finance module's comparisons, and the customer's
declared funding sat unread in the submission snapshot:

```json
{ "deposit": "200000", "sources": ["Salary savings", "Loan / mortgage"],
  "overseas": "no", "narrative": "Family and savings", "institutions": "Cba" }
```

The analyst's actual Stage 6 job — turn that declaration into recorded,
verified evidence — had no surface anywhere in the product.

## The flow now

The customer declared → the analyst records → the analyst verifies → the stage
settles → the Passport stamps.

- **Declared sources are seeded, never auto-recorded.** The panel shows what
  the customer declared and offers one button per source; a person presses it,
  so the record of who put each row there is true.
- **A draft cannot spell `verified`.** The `SofDraft` type has no such field.
  A declaration is evidence towards verification, never the verification —
  the same line the PEP declaration holds, one stage over.
- **No per-source amount is ever invented.** The declared deposit is a total
  across every source; the customer never said how it splits. `deposit /
  sources.length` would put a number the customer never stated into a CDD
  evidence table. The total travels in the notes as context; the analyst
  records the real amount when they verify.
- **Verification is an explicit act with a name on it.** The server stamps
  `verified_by` from the session and discards any caller-supplied value
  (`upsert_sof` has done this all along). Withdrawal is equally explicit.
- **An unrecognised declared label becomes `other`, words kept verbatim.**
  The failure mode of a new portal option is an ugly code, never a silently
  wrong classification.
- **A failed list read is not an empty list.** The panel refuses to offer
  recording over a list it cannot see — doubling what is already there is the
  cheap mistake, and it is permanent.

## The Aurixa Passport

The connection already existed at the data level:
`passportStamps.pure.ts` mints **SOURCE OF FUNDS REVIEWED** — green,
`client_safe: true`, shown to the customer and relying partners — when at
least one `source_of_funds` row is verified, dated by the newest
`verified_at`. What was missing was any way to get a row verified, and any
place the verifying analyst could see what their act produces.

`passportSofStampReadiness` mirrors that rule and the panel renders it:
unearned, it says *"recording alone does not earn it"*; earned, it names the
date. A source test reads the passport module and fails if the rule ever
changes shape — **this panel must never promise a stamp the passport will not
mint.**

## The documents, reviewed where the verification happens

Verifying a source of funds means looking at a document, and the documents
lived two stages back: read "Verify against evidence", go to Stage 4, find the
statement, review it, come back, verify — with nothing on the record
connecting the two acts.

Both halves of the connection already existed in the data:

- every client upload carries a **requirement code**, and `source_of_funds` is
  one of the seeded requirements — which documents ARE the funding evidence is
  a fact on file;
- `aml.source_of_funds.evidence_path` has been writable since the table was
  created and **never once written** — no verification had ever named the
  document it rested on.

### The rules

- **Membership is the requirement code, never the filename.** Matching on
  "bank" or "savings" would classify documents by what they happen to be
  called, and a mis-filed passport named `savings.pdf` would become funding
  evidence. Documents bound to other requirements stay in Stage 4, which the
  panel names as the fallback rather than duplicating.
- **Reviewing here writes the record Stage 4 writes** — the same
  `review_document` op, so the two surfaces cannot disagree. A rejection
  requires a reason the client will read.
- **Verification asks which documents it rested on.** Accepted documents
  arrive pre-ticked; a merely-uploaded one can be ticked but never is by
  default — pre-ticking unreviewed evidence into a verification would launder
  its review status. `evidence_path` records a stable `aml_document:<id>`
  reference (a filename would break on rename) and `metadata` carries the ids
  and the names as read at the time, merged over what other surfaces stored.
- **Verifying with nothing named stays legal, and explicit.** Evidence can be
  something no upload holds — sighted in person, a register checked. The
  button then says "Verify without naming a document"; nothing pretends a
  document was involved.

### The next step, said once and derived

One line, computed from the same facts the panel renders, so it can never
point at work the panel does not show:

| state | next step |
| --- | --- |
| nothing recorded | record the declared sources |
| documents awaiting review | review them first — before verifying against them |
| no document on file / all rejected | request evidence, or verify from evidence sighted outside the platform — never a dead end |
| accepted documents, unverified sources | verify each; the verification names its documents |
| settled | **Continue to Stage 7 · Submission review** — the button exists only in this state |

The Continue button appears only when the stage is settled: a continue beside
unfinished work is an invitation to skip it.

## What was deliberately not done

- No auto-verification from the declaration, ever.
- No write path for the client portal: the customer declares in the
  questionnaire; evidence is recorded and verified by staff.
- No second store. The panel writes the same `aml.source_of_funds` rows the
  journey model, the MLRO dossier, the finance comparisons and the passport
  already read — which is why the stage, the next action and the stamp all
  move the moment a row changes, with no new synchronisation.

## Where the tests are

- `src/lib/aml/fundingEvidence.test.ts` — the mapping, the no-invented-amount
  rule, dedupe, progress, and the stamp-rule mirror
- `src/components/aml/__tests__/fundingEvidencePanel.test.tsx` — the wiring:
  person-pressed recording, explicit verification, role gating, failed reads
