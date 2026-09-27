/**
 * What `manage-templates` may do with the tables it brokers that no module
 * permission covers.
 *
 * ## Why this exists
 *
 * `manage-templates` runs on the service-role client and brokers about thirty
 * tables for the Template Builder and a handful of other pages. Its
 * `assertTemplatePermission` maps checklists, workflows and the report
 * templates to a module permission and returns early for everything else, so
 * for every other table in its allow-list the only check was that the caller
 * had signed in. Read from the handler on 26 Sep 2026, with no call made:
 *
 *  - `custom_users` answered `list` with whatever `select` the caller named, so
 *    any staff login could read every user's `password_hash`,
 *    `mfa_secret_encrypted` and `mfa_recovery_codes_hash`. And `update` wrote
 *    any column, so any staff login could set its own `role` to `superadmin`,
 *    which is one of the two things `getModulePermissionContext` reads to
 *    decide who is a superadmin.
 *  - `integration_configs` holds each credential's `key_value` in plain text,
 *    and any staff login could read and overwrite it, while both screens that
 *    use it (Integrations, Workflow Playground) require the Integrations
 *    module.
 *  - `global_report_settings` and `finance_agent_contacts` (bank details
 *    included) could be rewritten by any staff login, though nothing in the
 *    product writes either through this broker: both are written through the
 *    ordinary client, under their own row-level policies.
 *
 * ## The rule
 *
 * Each is narrowed to exactly what the product sends, and the rest is refused.
 *
 *  - `custom_users` is read-only here, through a fixed set of columns: the
 *    team list the product reads is `id, username, email, is_active`. A
 *    `select`, a filter or an ordering that names anything else is refused
 *    rather than trimmed, because a request that asks for a password hash is
 *    not one to answer in part.
 *  - `integration_configs` belongs to the Integrations module. That mapping
 *    sits beside the others in `assertTemplatePermission`.
 *  - A write to `global_report_settings` or `finance_agent_contacts` through
 *    this broker needs a superadmin.
 *
 * Pure, so every rule is executed by the test suite.
 */

export type BrokerOperation = 'list' | 'get' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc';

/** The table that stores staff accounts, and the one this module exists for first. */
export const USER_DIRECTORY_TABLE = 'custom_users';

/**
 * The columns of `custom_users` the broker may return, filter or order by.
 * Everything else in that row is a credential, a second factor or an
 * authorisation fact.
 */
export const USER_DIRECTORY_COLUMNS: readonly string[] = Object.freeze([
  'id',
  'username',
  'email',
  'first_name',
  'last_name',
  'is_active',
]);

/** Tables the broker may read for any signed-in user but write only for a superadmin. */
export const SUPERADMIN_WRITE_TABLES: readonly string[] = Object.freeze([
  'global_report_settings',
  'finance_agent_contacts',
]);

const WRITE_OPERATIONS: ReadonlySet<string> = new Set(['insert', 'update', 'upsert', 'delete', 'rpc']);
const COLUMN_NAME = /^[a-z_][a-z0-9_]*$/;

export interface BrokerListOptions {
  select?: unknown;
  orderBy?: unknown;
  orderAsc?: unknown;
  limit?: unknown;
  filters?: unknown;
}

export interface BrokerRefusal {
  status: 403;
  message: string;
}

/** Whether this request can only proceed for a superadmin. */
export function brokerWriteNeedsSuperadmin(table: string, operation: string): boolean {
  return SUPERADMIN_WRITE_TABLES.includes(table) && WRITE_OPERATIONS.has(operation);
}

/**
 * A superadmin-only write attempted by somebody else, or null.
 *
 * The caller works out `isSuperadmin` only where `brokerWriteNeedsSuperadmin`
 * says it matters, so an ordinary read costs no extra query.
 */
export function superadminWriteRefusal(
  table: string,
  operation: string,
  isSuperadmin: boolean,
): BrokerRefusal | null {
  if (!brokerWriteNeedsSuperadmin(table, operation) || isSuperadmin) return null;
  return { status: 403, message: `${table} is changed from its own settings page, not through this service.` };
}

/**
 * The columns a `select` names, or null when it names anything that is not a
 * plain column: `*`, an alias, a cast, an embedded resource or a JSON path.
 */
function plainColumns(select: string): string[] | null {
  const parts = select.split(',').map((part) => part.trim());
  if (parts.some((part) => !COLUMN_NAME.test(part))) return null;
  return parts;
}

/** The team list's own projection: every column the directory may return. */
export const USER_DIRECTORY_SELECT = USER_DIRECTORY_COLUMNS.join(', ');

export type UserDirectoryRequest =
  | { ok: true; select: string; filters: Record<string, unknown>; orderBy: string | undefined }
  | { ok: false; refusal: BrokerRefusal };

const refused = (message: string): UserDirectoryRequest => ({ ok: false, refusal: { status: 403, message } });

/**
 * A request against `custom_users`, reduced to what the directory may answer,
 * or refused.
 *
 * - Only `list` and `get` are answered.
 * - `select` defaults to the directory's own columns and may name only those.
 * - Every filter key and the ordering column must be one of those columns, so
 *   a credential can be neither returned nor used as a search key.
 */
export function vetUserDirectoryRequest(
  operation: string,
  listOptions: BrokerListOptions | null | undefined,
): UserDirectoryRequest {
  if (operation !== 'list' && operation !== 'get') {
    return refused('Staff accounts are read-only through this service.');
  }
  const options = listOptions ?? {};

  let select = USER_DIRECTORY_SELECT;
  if (options.select !== undefined && options.select !== null && String(options.select).trim() !== '') {
    if (typeof options.select !== 'string') return refused('That field list is not available for staff accounts.');
    const columns = plainColumns(options.select);
    if (!columns || columns.some((column) => !USER_DIRECTORY_COLUMNS.includes(column))) {
      return refused('That field list is not available for staff accounts.');
    }
    select = columns.join(', ');
  }

  const filters: Record<string, unknown> = {};
  if (options.filters !== undefined && options.filters !== null) {
    if (typeof options.filters !== 'object' || Array.isArray(options.filters)) {
      return refused('That filter is not available for staff accounts.');
    }
    for (const [key, value] of Object.entries(options.filters as Record<string, unknown>)) {
      if (!USER_DIRECTORY_COLUMNS.includes(key)) return refused('That filter is not available for staff accounts.');
      filters[key] = value;
    }
  }

  let orderBy: string | undefined;
  if (options.orderBy !== undefined && options.orderBy !== null && options.orderBy !== '') {
    if (typeof options.orderBy !== 'string' || !USER_DIRECTORY_COLUMNS.includes(options.orderBy)) {
      return refused('That ordering is not available for staff accounts.');
    }
    orderBy = options.orderBy;
  }

  return { ok: true, select, filters, orderBy };
}
