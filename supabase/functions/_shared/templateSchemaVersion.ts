/**
 * templateSchemaVersion — explicit validate + migrate for ReportTemplate
 * schema versions (rehaul Phase 4 / output quality hardening).
 *
 * Replaces the old behaviour of blindly stamping `schema.version = 1` on
 * every server-side write, which silently clobbered whatever version the
 * payload declared and would mask incompatible (newer) schemas instead of
 * rejecting them.
 *
 * Policy:
 * - missing/null version  → legacy payload, treated as v1
 * - version === supported → accepted as-is
 * - version < supported   → migrated stepwise via MIGRATIONS
 * - version > supported   → rejected (client is newer than this deployment)
 * - non-integer / < 1     → rejected
 */

export const SUPPORTED_TEMPLATE_SCHEMA_VERSION = 1;

export class TemplateSchemaVersionError extends Error {
  readonly received: unknown;

  constructor(received: unknown, detail: string) {
    super(`Unsupported template schema version ${JSON.stringify(received)}: ${detail}`);
    this.name = 'TemplateSchemaVersionError';
    this.received = received;
  }
}

/**
 * Stepwise migrations keyed by *source* version: MIGRATIONS[1] upgrades a v1
 * schema to v2, and so on. Each entry mutates the schema in place and must
 * leave `schema.version` bumped. Empty while v1 is current.
 */
const MIGRATIONS: Record<number, (schema: Record<string, unknown>) => void> = {};

/**
 * Validates the declared version and migrates the schema (already cloned by
 * the caller) up to SUPPORTED_TEMPLATE_SCHEMA_VERSION. Returns the same
 * object for chaining. Throws TemplateSchemaVersionError on invalid or
 * future versions — callers should surface this as a 4xx, not a silent fix.
 */
export function validateAndMigrateTemplateSchemaVersion<T extends Record<string, unknown>>(schema: T): T {
  const raw = (schema as { version?: unknown }).version;
  const version = raw === undefined || raw === null ? 1 : Number(raw);

  if (!Number.isInteger(version) || version < 1) {
    throw new TemplateSchemaVersionError(raw, 'version must be a positive integer');
  }
  if (version > SUPPORTED_TEMPLATE_SCHEMA_VERSION) {
    throw new TemplateSchemaVersionError(
      raw,
      `this deployment supports up to v${SUPPORTED_TEMPLATE_SCHEMA_VERSION}; refusing to downgrade a newer schema`,
    );
  }

  let current = version;
  (schema as Record<string, unknown>).version = current;
  while (current < SUPPORTED_TEMPLATE_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[current];
    if (!migrate) {
      throw new TemplateSchemaVersionError(raw, `no migration registered from v${current}`);
    }
    migrate(schema);
    const next = Number((schema as { version?: unknown }).version);
    if (!Number.isInteger(next) || next <= current) {
      throw new TemplateSchemaVersionError(raw, `migration from v${current} did not advance the version`);
    }
    current = next;
  }

  return schema;
}
