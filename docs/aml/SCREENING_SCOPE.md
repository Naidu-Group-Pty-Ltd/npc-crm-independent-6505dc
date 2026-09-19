# What Stage 5 requires, and the one way sanctions can be stood down

Read this before touching `deriveScreeningScope`, `reconcileSubjectToScope`,
`aml.case_screening_scopes`, `aml.case_screening_perimeter`, or anything that
decides whether a case needs sanctions screening.

## The rule

Every screening scope is decided **independently**, server-side, and each
carries its own reason code:

| scope | who requires it | can it be stood down |
| --- | --- | --- |
| `sanctions` | sanctions law | only by a perimeter finding |
| `pep` | AML/CTF CDD | only by a perimeter finding |
| `adverse_media` | risk-based CDD | yes, by the risk rule |
| `watchlist` | risk-based CDD | yes, by the risk rule |

A case can be sanctions `not_required` with PEP still mandatory, or the
reverse. They answer to different obligations, and coupling them would mean
one finding silently standing down a control nobody assessed.

## Why the perimeter, and never the risk rating

Targeted financial sanctions under the **Charter of the United Nations Act
1945** and the **Autonomous Sanctions Act 2011** bind every person and every
dealing. They are not a risk-based control. No rating, profile or
questionnaire answer reduces them, which is why this module refused for so
long to let anything stand sanctions down, and why **"low risk" must never
appear as a reason code**. A test asserts no reason code can even be spelled
in terms of risk.

What *can* be true is that a case is **not a dealing at all**:

| reason code | meaning |
| --- | --- |
| `no_designated_service` | no designated service is or will be provided |
| `enquiry_only` | an enquiry or quotation; the relationship was never entered |
| `duplicate_record` | an administrative duplicate; the CDD sits on another case |
| `service_declined_pre_commencement` | declined before it commenced |

In none of those is NPC providing a designated service, so there is nothing
for the obligation to attach to. That is a question of **perimeter**, and it
is the only lever that reaches sanctions.

## Why the perimeter is recorded, not inferred

Nothing in the schema says whether a designated service is being provided —
the concept lives in the agreements and the consent catalogue and nowhere
queryable. Inferring it from incidental columns (an empty `purchase_file_id`,
a terminated service gate) would be guessing about the one fact the whole
exemption rests on, and a wrong guess reads as *"no sanctions screening
required"* on a case that needed it.

So a **reviewer or MLRO records it**, with a reason code from the fixed list
above and the scopes the finding removes. `canWrite` includes analysts;
standing down a sanctions obligation is a compliance act, not data entry.

**The default is always inside.** An unclassified case, an unrecognised reason
code, a superseded row, or a finding that excludes no scopes all resolve to
sanctions required. There is no data state in these tables that produces an
exemption by accident, and no client-writable path reaches them — the
operation takes a *classification* and a *reason code*, never a `required`
flag, so a payload claiming `required: false` is ignored because nothing
reads it.

## `not_required` is not `clear`

This is the distinction the whole change exists to protect.

```
required      an obligation exists
not_required  no obligation arose — NOBODY WAS SCREENED
completed     screened, and nothing matched   ← a RESULT, and a different thing
```

`case_screening_scopes.state` is deliberately only `required` | `not_required`.
Screening lifecycle belongs to `party_screening_subjects` and
`screening_checks`. The client reading carries `notRequired` separately from
`resolved` so no caller can take "satisfied for the stage" and render it as a
screening outcome, and a test asserts the rendered text never says *clear*,
*no match* or *screened*.

## Provider readiness is a property of a scope

Readiness split into two questions that used to be one:

- `provider_ready` — can the sanctions provider run right now
- `provider_relevant` — does that bear on this case at all

When the second is false, an unloaded DFAT list is a fact that does not apply
rather than a blocker to clear. **DFAT is required when a required scope needs
it, and for a voluntary run; it is irrelevant otherwise.** Conflating the two
is exactly what let an empty list hold up cases with no sanctions obligation.

Auto-execution additionally requires `scope.sanctions.required`: a provider
call costs money, and running one for an exempt case would both spend it and
produce evidence the policy record says was never obtained.

## Optional means optional

A scope recorded `not_required` can still be screened. `run_optional_screening`
uses the **normal** pipeline — same provider, same claim, same check and
matches — and the only difference is that the obligation never existed.

It does not rewrite the policy decision. `required` stays false throughout,
and the operation writes nothing to `case_screening_scopes`. What it records
is that a named person chose to run it and when: `voluntary_run_at` /
`voluntary_run_by` on the subject, stamped **before** the run so a check can
never exist without it, and `voluntary: true` + `policy_required: false` +
`scope_decision_id` on the check itself, so evidence read on its own still
says it was voluntary.

If the provider cannot run, the operation says so and **changes nothing** — it
does not fail the subject and does not hold the stage, because the case never
needed this screening.

## What an exemption must never do

- **Un-know a finding.** A subject holding a possible or confirmed match stays
  `required = true` whatever the perimeter says. The duty to deal with a
  positive result comes from the sanction itself, not from the screening
  obligation that surfaced it.
- **Destroy evidence.** A completed check keeps its result and its
  `screening_check_id`; only the obligation flag moves.
- **Cancel authorised work.** An in-flight *voluntary* run is left alone.
- **Invent a result on withdrawal.** Restoring the obligation returns a subject
  to `not_started`, never to `completed`.

## Existing cases

Nothing is backfilled and no historical decision is rewritten. Rows are
superseded rather than updated, so a case that moves between policy versions
carries both decisions. Every case with no perimeter row — which is all of
them until somebody classifies one — behaves exactly as it did: sanctions
required. An open case picks up the new shape the next time
`sync_screening_stage` runs, which records the decision it was already making.
