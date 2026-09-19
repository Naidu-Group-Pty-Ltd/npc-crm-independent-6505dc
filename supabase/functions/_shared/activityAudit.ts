/**
 * Writing an `activity_logs` row, and noticing when it does not happen.
 *
 * ## The defect this exists to end
 *
 * `activity_logs.entity_type` is the Postgres enum `activity_entity_type`, and
 * `update-integration-secret` wrote `entity_type: 'settings'` — which is not one
 * of its 26 values. The insert was `await`ed without its `error` being read, so
 * PostgREST's rejection was discarded and the handler carried on to return
 * `success: true`.
 *
 * The result: **every credential change ever made through the Integrations page
 * failed to record who changed which secret, and told the operator it had
 * worked.** Measured 2026-09-08 — `activity_logs` holds 5,037 rows across 22
 * enum values and not one `settings` row has ever existed, because not one
 * could.
 *
 * An audit row that silently does not get written is worse than no audit trail
 * at all, because the absence reads as "nothing happened" rather than as
 * "nothing was recorded".
 *
 * ## Three rules
 *
 * **The vocabulary is checked before the write, not by the database.** A
 * PostgREST enum rejection arrives as an opaque `22P02` at runtime, on a code
 * path that may run rarely. {@link isActivityEntityType} makes the same mistake
 * a local, named failure — and a CI guard
 * (`scripts/security/check-activity-entity-types.mjs`) makes it a build
 * failure.
 *
 * **A failed audit write is reported, never swallowed.** {@link recordActivity}
 * returns an outcome instead of throwing: the caller decides whether the
 * failure should fail its own operation, but it can no longer fail to notice.
 * For a secret update the surrounding act has already succeeded at the
 * Management API, so failing the request would be a lie in the other
 * direction — the honest answer is to succeed and say the audit row is missing.
 *
 * **Never put a credential in an audit row.** Metadata carries secret NAMES
 * only. `assertNoSecretValues` is a cheap structural guard, not a substitute
 * for the caller being careful.
 */

/**
 * Every value of the `activity_entity_type` enum, in its declared order.
 *
 * Read from the live database on 2026-09-08. If a migration adds a value it
 * must be added here too — the CI guard compares code literals against this
 * list, so a new value that is not declared here fails the build rather than
 * failing silently at runtime, which is the whole point.
 */
export const ACTIVITY_ENTITY_TYPES = [
  'investment_report',
  'property_comparison',
  'cash_flow_analysis',
  'email',
  'call_log',
  'call_alert_rule',
  'qa_conversation',
  'automation_switch',
  'template',
  'branding_profile',
  'user',
  'whitelabel_settings',
  'bulk_generation_job',
  'system',
  'session',
  'branding',
  'client',
  'deal',
  'client_file',
  'client_note',
  'appointment',
  'checklist',
  'data_import',
  'portfolio_report',
  'agency_agreement',
  'portal_message',
] as const;

export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

const ENTITY_TYPE_SET: ReadonlySet<string> = new Set(ACTIVITY_ENTITY_TYPES);

/** Is this a value the column will actually accept? */
export function isActivityEntityType(value: unknown): value is ActivityEntityType {
  return typeof value === 'string' && ENTITY_TYPE_SET.has(value);
}

export interface ActivityEntry {
  entity_type: ActivityEntityType;
  entity_name: string;
  action_type: string;
  user_id?: string | null;
  username?: string | null;
  entity_id?: string | null;
  metadata?: Record<string, unknown>;
}

export type ActivityOutcome =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Minimal shape of the Supabase client this needs — keeps the module testable.
 *
 * `insert` returns a `PromiseLike`, not a `Promise`: supabase-js hands back a
 * `PostgrestFilterBuilder`, which is a thenable and has no `catch`/`finally`.
 * Typing it as `Promise` compiles against a test double and fails against the
 * real client, which is the wrong way round.
 */
export interface ActivityWriter {
  from(table: string): { insert(row: Record<string, unknown>): PromiseLike<{ error: unknown }> };
}

/**
 * Keys whose VALUE must never reach an audit row.
 *
 * The Integrations page handles credentials, and an audit trail is one of the
 * places a secret most easily leaks — it is long-lived, widely readable and
 * nobody looks at it until an incident.
 */
const FORBIDDEN_METADATA_KEYS = /(secret|token|password|api[_-]?key|credential|private[_-]?key)/i;

/**
 * Throws when metadata carries something that looks like a credential VALUE.
 *
 * A key called `updated_secrets` holding a list of NAMES is fine and is the
 * intended use; a key called `secret_value` is not. The test is on the key, and
 * a string value long enough to be a token under a suspicious key is refused.
 */
export function assertNoSecretValues(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return;
  for (const [key, value] of Object.entries(metadata)) {
    if (!FORBIDDEN_METADATA_KEYS.test(key)) continue;
    const looksLikeAValue =
      (typeof value === 'string' && value.length > 0) ||
      (typeof value === 'object' && value !== null && !Array.isArray(value));
    if (looksLikeAValue) {
      throw new Error(
        `activity audit: metadata key "${key}" may carry a credential value; ` +
          'audit rows record secret NAMES only.',
      );
    }
  }
}

/**
 * Write one audit row and say plainly whether it landed.
 *
 * Never throws for a database fault — the caller gets an outcome. It does throw
 * for a programming error the caller can fix (an entity type the column will
 * reject, or metadata that looks like it carries a credential), because those
 * should fail loudly in development rather than quietly in production.
 */
export async function recordActivity(
  client: ActivityWriter,
  entry: ActivityEntry,
): Promise<ActivityOutcome> {
  if (!isActivityEntityType(entry.entity_type)) {
    throw new Error(
      `activity audit: "${entry.entity_type}" is not an activity_entity_type. ` +
        `Valid values: ${ACTIVITY_ENTITY_TYPES.join(', ')}`,
    );
  }
  assertNoSecretValues(entry.metadata);

  try {
    const { error } = await client.from('activity_logs').insert({
      user_id: entry.user_id ?? null,
      username: entry.username ?? null,
      action_type: entry.action_type,
      entity_type: entry.entity_type,
      entity_name: entry.entity_name,
      ...(entry.entity_id ? { entity_id: entry.entity_id } : {}),
      ...(entry.metadata ? { metadata: entry.metadata } : {}),
    });
    if (error) {
      const reason = describeError(error);
      console.error('[activity-audit] audit row was NOT written', {
        entity_type: entry.entity_type,
        entity_name: entry.entity_name,
        action_type: entry.action_type,
        reason,
      });
      return { ok: false, reason };
    }
    return { ok: true };
  } catch (cause) {
    const reason = describeError(cause);
    console.error('[activity-audit] audit row threw', {
      entity_type: entry.entity_type,
      action_type: entry.action_type,
      reason,
    });
    return { ok: false, reason };
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    const parts = [e.code, e.message, e.details].filter((p) => typeof p === 'string' && p);
    if (parts.length) return parts.join(': ');
  }
  return String(error);
}
