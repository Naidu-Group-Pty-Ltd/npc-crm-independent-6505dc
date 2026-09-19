/**
 * WP-20: which columns a request body may write, per AML table.
 *
 * ## Why these tables and not others
 *
 * Several AML operations took a request sub-object and wrote it straight to a
 * table — `const a = body.alert ?? {}` then `aml.from('alerts').update(a)`. Every
 * column the caller chose to name got written, including ones no UI exposes.
 *
 * These are behind `requireWrite()` / MLRO gates, so this is not an anonymous
 * hole; it is an authorised AML user reaching columns the workflow never meant
 * them to set. In this domain that matters more than usual: `resolved_by` and
 * `resolved_at` are the record of who closed an alert and when, and an AML file
 * that says the wrong thing about that is a compliance problem rather than a
 * data-quality one. `AGENTS.md` §2 treats the AML trail as evidence.
 *
 * ## Where these lists come from
 *
 * Read from `information_schema.columns` on the live project, minus the
 * identity and audit columns no request may ever set:
 *
 *     id, created_at, created_by, updated_at, updated_by, deleted_at,
 *     deleted_by, tenant_id, org_id, organisation_id, row_version
 *
 * then narrowed further per table where a column belongs to a *different*
 * operation — see the notes below. Adding a column to a table does not add it
 * here, which is the point: a new column is not writable from a request body
 * until somebody decides it should be.
 *
 * Used with `pickAllowed` from `_shared/wp09Guards.ts`.
 */

/**
 * `aml.alerts` via `upsert_alert`.
 *
 * `resolved_at`, `resolved_by` and `resolution_note` are deliberately absent.
 * They are the closure record and are written by `resolve_alert`, which stamps
 * `resolved_by` from the verified session rather than from the body. Leaving
 * them writable here let one operator record another as having closed an alert.
 */
export const ALERT_WRITABLE = new Set([
  'case_id', 'rule_id', 'event_id', 'severity', 'status', 'title', 'summary',
  'assigned_to', 'metadata',
]);

/** `aml.monitoring_rules` via `upsert_rule`. */
export const MONITORING_RULE_WRITABLE = new Set([
  'name', 'description', 'trigger_kind', 'criteria', 'severity', 'is_enabled',
  'cooldown_minutes',
]);

/** `aml.risk_factors` via `upsert_factor` (MLRO only). */
export const RISK_FACTOR_WRITABLE = new Set([
  'key', 'label', 'category', 'weight', 'active', 'description', 'scoring',
]);

/** `aml.mandatory_triggers` via `upsert_trigger` (MLRO only). */
export const MANDATORY_TRIGGER_WRITABLE = new Set([
  'key', 'label', 'description', 'severity', 'rule', 'active',
]);

/** `aml.transaction_parties` via `upsert_party`. */
export const TRANSACTION_PARTY_WRITABLE = new Set([
  'transaction_id', 'case_id', 'party_type', 'capacity', 'display_name',
  'entity_id', 'external_reference', 'contact', 'metadata',
]);

/**
 * `aml.finance_comparisons` via `upsert_comparison`.
 *
 * `captured_by` is absent: it records which operator captured the figures and is
 * stamped from the verified session at the call site.
 */
export const FINANCE_COMPARISON_WRITABLE = new Set([
  'case_id', 'purchase_file_id', 'source', 'captured_at', 'purchase_price',
  'loan_amount', 'lender', 'lvr', 'borrower_contribution', 'refi_equity',
  'gift_amount', 'gift_source', 'smsf_lrba', 'smsf_details', 'loan_purpose',
  'funding_notes', 'raw_payload',
]);

/**
 * `aml.evidence_references` via `attach_evidence`.
 *
 * `added_by` is absent for the same reason, and `external_url` is absent because
 * the call site writes a *validated* absolute URL rather than the raw one — an
 * allowlist that let the unvalidated value through would undo that check.
 */
export const EVIDENCE_REFERENCE_WRITABLE = new Set([
  'case_id', 'comparison_id', 'reference_type', 'reference_id', 'label',
  'detail', 'metadata',
]);

/**
 * `aml.source_of_funds` via `upsert_sof`.
 *
 * `verified_by` and `verified_at` are absent. The call site stamps them from the
 * verified session when the item is marked verified — but it only did so on
 * INSERT, so on the update path a caller could set `verified: true` alongside a
 * `verified_by` naming somebody else. In an EDD file the question "who checked
 * this source of funds" has a regulator behind it; it is not a field the
 * subject of the check gets to answer.
 */
export const SOURCE_OF_FUNDS_WRITABLE = new Set([
  'edd_case_id', 'case_id', 'source_type', 'description', 'amount', 'currency',
  'evidence_path', 'evidence_provider', 'verified', 'notes', 'metadata',
]);

/**
 * `aml.source_of_wealth` via `upsert_sow`.
 *
 * The same table one column apart: `wealth_type`/`estimated_value` where funds
 * has `source_type`/`amount`, and no `evidence_provider`. Kept as two sets
 * rather than one union so a column that exists on only one table cannot be
 * written to the other — the union would have quietly accepted `amount` on
 * `source_of_wealth` and let PostgREST reject it at runtime instead.
 */
export const SOURCE_OF_WEALTH_WRITABLE = new Set([
  'edd_case_id', 'case_id', 'wealth_type', 'description', 'estimated_value',
  'currency', 'evidence_path', 'verified', 'notes', 'metadata',
]);

/**
 * `aml.existing_customer_reviews` via `upsert_review`.
 *
 * Two groups are deliberately absent.
 *
 * The **closure record** — `outcome`, `outcome_at`, `outcome_by` — is written by
 * `complete_review`, which stamps the actor from the session. This is the same
 * shape as `ALERT_WRITABLE`'s missing `resolved_*`: letting the generic upsert
 * set an outcome produces a completed review with nobody's name on it.
 *
 * The **extension ledger** — `original_due_at`, `extension_count`,
 * `extension_reason` — is maintained by `extend_review`, which reads the current
 * row and increments. A caller who could set `extension_count` directly could
 * reset a review's extension history to zero, and that history is the audit
 * trail for how long a periodic review has been allowed to slip.
 *
 * `trigger_event_id` is absent for the same reason: it links the review to the
 * event that raised it and is set by the op that raises it.
 */
export const CUSTOMER_REVIEW_WRITABLE = new Set([
  'case_id', 'client_id', 'classification', 'status', 'priority', 'due_at',
  'assigned_to', 'reviewer_notes', 'trigger_kind', 'metadata',
]);

/**
 * `aml.counterparty_attempts` via `add_cp_attempt`.
 *
 * `actor_id` is absent because the call site stamps it. That call site already
 * spread the body *before* the stamp, so the stamp won and this one was never
 * forgeable — but the ordering was the only thing making it safe, and ordering
 * is not a control anybody can see from the schema.
 */
export const COUNTERPARTY_ATTEMPT_WRITABLE = new Set([
  'request_id', 'counterparty_case_id', 'attempted_at', 'channel', 'outcome',
  'notes', 'metadata',
]);
