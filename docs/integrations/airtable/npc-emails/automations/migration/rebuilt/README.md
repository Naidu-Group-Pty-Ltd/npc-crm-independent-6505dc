# The five automations as they were actually created

These are the exact `create_automation` payloads used to rebuild the target base
(`appFNPL7iYiuQyHAO`) on 2026-08-18 — the files in [`../../source/`](../source)
with every `tbl…`/`fld…` reference rewritten to the target's ids, and nothing else
changed. `_id-map.json` is the substitution that produced them.

They are kept because an automation cannot be exported back out as a create
payload: replaying or auditing this step later means starting from these files,
not from the live base.

| File | Created as |
| --- | --- |
| `link-stage-2-response-to-applicant.json` | `wflyGxwKaLbVsv14E` |
| `link-stage-2-detailed-response-to-applicant.json` | `wfl37KYYbuQv15cRP` |
| `link-stage-3-booking-to-applicant.json` | `wfls49xnPmVibeeLs` |
| `send-confirmation-email-on-new-business-readiness-response.json` | `wflh77ndoCHYMbs6Q` |
| `notify-aurixa-team-on-new-business-readiness-submission.json` | `wflbWecuoA3q6sQLj` |

## The three `structure-*.json` files

These are the **structure-only** rebuilds of the script-bearing automations, as
the target base returned them — trigger and nodes with the `customScript` removed,
because the API refuses it (`readOnlyNodeType`).

| File | Created as | Scripts still to paste |
| --- | --- | ---: |
| `structure-aurixa-lead-capture.json` | `wflEQ1wsJH1x7GQhL` | 2 |
| `structure-delete-records-after-30-days.json` | `wflz5O9df5UjBzd3X` | 1 |
| `structure-delete-property-intake-records-after-30-days.json` | `wflOrWaQohUvhvcFb` | 1 |

| `structure-auto-generate-report.json` | `wflIvnXu2Jcs7eQ95` | 1 (and it must be edited) |

`Auto-generate report` is the exception in two ways. It is the only automation
here that contains a node **not in the source** — an inert placeholder
`findRecords` inside the conditional branch, present only because the API refuses
both an empty branch outside a loop and a script node, which between them leave
no creatable node at all. And it is the only one whose exported script must not
be pasted as-is. Both are covered in
[`AUTO_GENERATE_REPORT.md`](./AUTO_GENERATE_REPORT.md).

**`noOp` does not work as a script placeholder.** It is in the type enum but is
rejected as `readOnlyNodeType`. An empty `repeatingGroup` body is accepted, which
is how both purges hold the shape open.

## Two things to know before reusing these

**Node keys in these files are the source's, and Airtable ignores them.** The
`key` on every node is minted fresh on create, and the internal `$ref` wiring is
re-pointed to the new keys as part of the same call. That is why verification
canonicalises keys positionally rather than comparing them: a diff that expects
the keys to survive will report five false failures.

**~~`_id-map.json` covers 24 of the 54 ids the bundle references.~~ Corrected
2026-09-15 — the map is complete and nothing needs extending.** Counted:
`id-references.json` holds 54 ids (1 base, 6 tables, 37 fields, **10
automations**) and `_id-map.json` holds 44 — the base, all 6 tables and all 37
fields. **Zero `tbl…`/`fld…` ids are unmapped.** The 10 left over are `wfl…`
automation ids, which are not remappable references: each rebuilt automation was
minted a fresh id, listed in the tables above. The four script-bearing
automations can be finished without adding a single mapping. See
[`SCRIPT_NODES.md`](./SCRIPT_NODES.md).
