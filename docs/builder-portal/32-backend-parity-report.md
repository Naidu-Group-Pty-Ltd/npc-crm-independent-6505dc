# Builder Portal — Backend Parity Review (Step 4)

Every item is classified as exactly one of:

- 🟢 **shared** — shared implementation already reused
- ✅ **mirrored** — Solicitor implementation correctly mirrored
- ➖ **n/a** — not applicable, with the documented Builder-domain difference
- ⛔ **missing** — missing and required before release
- ⚠️ **defective** — present but defective

---

| # | Item | Class | Evidence / reason |
|---|---|---|---|
| 1 | Transactional mutation commands | ✅ | Every Builder state change runs through a `builder_*` plpgsql command. Edge Functions never `.insert()`/`.update()`/`.delete()` a Builder domain table |
| 2 | Trusted audit logging | ✅ | `builder_portal_activity_log` + `builder_log_activity`, append-only via trigger |
| 3 | Audit rollback | ✅ | `builder_log_activity` **raises** rather than swallowing, so a failed audit aborts the transaction. Proven live: *"a transition whose audit write fails is rejected"* + *"the state change was rolled back with the failed audit"*. This is the inverse of `logSolicitorActivity()` |
| 4 | Transactional outbox | ➖ / ⚠️ | **No Builder record leaves the database.** Builder has no email, webhook or third-party delivery path, so there is nothing for an outbox to make reliable. Becomes ⚠️ the moment email notification is wired — recorded as **R3** |
| 5 | Retry handling | ➖ | Same reason as 4 |
| 6 | Dead-letter handling | ➖ | Same reason as 4. Readiness reports `no_unreplayed_builder_dead_letters` as `not_applicable` with that reason |
| 7 | Correlation IDs | 🟢 | `record_portal_operational_event` takes `_correlation_id`; `builder-portal-admin` supplies one per command |
| 8 | Operational alerts | 🟢 | `portal_operational_alerts` / `portal_operational_events`, filtered by `portal='builder'` |
| 9 | Integration health | ➖ | Builder integrates with no external provider. Solicitor's integration-health panel covers provider connections Builder does not have |
| 10 | Canonical conversations | ✅ | `builder_conversations` + `builder_conversation_participants`; a thread is visible on participation, and participation is validated against the parent scope |
| 11 | Participant validation | ✅ | `trg_builder_conversations_scope` |
| 12 | Notification delivery | ⚠️ | In-portal only, direct insert. See 4 / **R3** |
| 13 | Notification filtering | ✅ | Notifications carry a **pointer** (`scope_type`, `scope_id`, `entity_kind`, `entity_id`), never a copy of the record, so a stale notification cannot leak a withdrawn one. Stronger than Solicitor |
| 14 | Immutable document versions | ✅ | `trg_builder_document_versions_immutable`; versions are append-only and `UNIQUE (document_id, version_number)` |
| 15 | Document quarantine | ⛔ | **No quarantine.** See **B1** |
| 16 | Malware scanning | ⛔ | **No scanning.** `builder_document_versions` has no `malware_scan_status`. **Release blocker** — see **B1** |
| 17 | Document processing | ⛔ | No processing state machine |
| 18 | Signed download URLs | ✅ | Issued per request through the Edge Function, never persisted |
| 19 | Document access acknowledgement | ➖ | Solicitor acknowledgement exists for legal-privilege audit obligations. Builder documents carry no privilege obligation; grants and downloads are already audited |
| 20 | Audience-filtered projections | ✅ | `builder_visible_activity` refuses identity and administration entity types outright and resolves everything else through the resolver that governs the record |
| 21 | Controlled rollout | ✅ | **Completed on this branch.** Was ⛔ |
| 22 | Readiness checks | ✅ | **Completed on this branch.** Was ⛔ |
| 23 | Approval evidence | ✅ | **Completed on this branch.** Four types, evidence required, revocable |
| 24 | Rollout history | ✅ | `cross_portal_rollout_history` with a readiness snapshot per transition |
| 25 | Stable-window enforcement | ✅ | `minimum_stable_window_complete`, measured from entry into `shadow`; cleared by rollback so recovery must observe again |
| 26 | Immediate rollback | ✅ | Reachable from `shadow` and `cutover`, never gated on readiness — that is the point of rollback |
| 27 | Observability | ✅ | `get_builder_operational_health` + the Command Centre panel |

---

## Summary

| Class | Count |
|---|---|
| 🟢 shared | 3 |
| ✅ mirrored | 15 |
| ➖ not applicable | 5 |
| ⛔ missing and required | 3 |
| ⚠️ present but defective | 2 |

All three ⛔ items are the single document-safety blocker **B1**. Both ⚠️ items are the single
notification-delivery gap **R3**.

Legal-specific features were **not** forced into Builder: document access acknowledgement,
integration health and the outbox are each marked not-applicable with a stated domain difference,
not silently dropped.

---

## The unused contracts permission key

`BUILDER_FORBIDDEN_KEYS` in `_shared/builderPortalAuth.ts` keeps the contracts key
deny-by-default. Verified on this branch that no runtime path resolves it and no product
requirement references it.

**Left deny-by-default, unchanged.** The task's instruction is explicit and the precondition for
changing it — a real runtime consumer plus an explicit product requirement — is not met.
