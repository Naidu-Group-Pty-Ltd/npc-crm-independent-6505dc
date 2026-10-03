/**
 * Which fields of a tool's result the agent's model is shown.
 *
 * `ai-dashboard-agent` trims each list a read tool returns down to the fields
 * that matter before handing it to the model, because a row of `select('*')`
 * carries sync stamps, JSON blobs and audit columns that buy nothing and cost
 * context. The trim is a whitelist, and a whitelist written against names the
 * tool does not return is not a trim: it is a delete.
 *
 * That is what the old inline map did, measured against the executors on
 * 2 Oct 2026. Of its twenty-five entries:
 *
 *   - **Twelve deleted meaning.** `search_clients` and
 *     `get_clients_by_pipeline_status` return `name`; the map listed
 *     `first_name`, `last_name`, so every client search reached the model as
 *     ids and statuses with NO NAMES. `get_deals_by_stage` / `_risk` and
 *     `get_client_deals` return `current_stage` and `property_address`; the map
 *     listed `stage` and `address`, so a deal was an id and a client. Reports
 *     lost `property_address`, listings lost `beds` and `baths` (the map said
 *     `bedrooms`), the calendar lost each appointment's status, and
 *     `get_recent_activity` lost what happened (`activity_logs` rows carry
 *     `action_type` / `entity_name`, not `title`), and `get_portfolio_reviews`
 *     lost the score and the health reading.
 *   - **Eight did nothing**, because they named an `arrayKey` the tool does not
 *     return (`deals` for `settlements`, `reminders` for `overdue_reminders`,
 *     `appointments` for `events` …) or an empty field list. They are removed
 *     rather than "corrected": removing them changes nothing the model sees.
 *   - **Five were right**, and survive below — widened where the executor
 *     returns a field worth keeping, never narrowed.
 *
 * Where a tool already selects a narrow set of columns (the client searches,
 * the reports, the listings, the calendar) the entry is simply gone: the
 * executor is the projection, and a second list can only drift from it.
 *
 * Two rules now hold it.
 *
 * - **A field list is checked against the executor that fills it** —
 *   `agentProtocol.spec.ts` reads `ai-dashboard-agent` and fails on any
 *   projected field the executor (or, for `select('*')`, its table) cannot
 *   produce. A misspelt name is invisible in production, which is how this
 *   survived; it is not invisible to the spec.
 * - **A row the list does not describe is passed through whole.** If any
 *   listed field is absent from an item the projection is not applied to it,
 *   so drift costs context rather than meaning. A larger payload is
 *   recoverable — `smartTruncateResult` caps it — and a deleted name is not.
 */

export type ToolProjection = {
  /** The key on the result whose array is trimmed. */
  readonly arrayKey: string;
  /** The fields kept on each item of that array, when the item has all of them. */
  readonly fields: readonly string[];
};

export const TOOL_FIELD_PROJECTIONS: Readonly<Record<string, ToolProjection>> = {
  // client_deals `select('*')` — 49 columns; these are what a broker asks about.
  get_client_deals: {
    arrayKey: 'deals',
    fields: [
      'id', 'client_id', 'deal_type', 'current_stage', 'current_stage_number', 'risk_status',
      'property_address', 'loan_amount', 'settlement_date', 'finance_clause_expiry',
      'commission_estimate', 'clawback_risk_active', 'responsible_person', 'updated_at',
    ],
  },
  // Already a narrow select plus a joined client; the nested `clients` object is
  // the same fact as `client_name`, so it is the one dropped.
  // `client_id` travels so the agent can open the deal (a deal's page is its
  // client's record), which is what it is most often asked to do next.
  get_deals_by_stage: {
    arrayKey: 'deals',
    fields: ['id', 'client_id', 'deal_type', 'current_stage', 'property_address', 'loan_amount', 'risk_status', 'client_name'],
  },
  get_deals_by_risk: {
    arrayKey: 'deals',
    fields: ['id', 'client_id', 'deal_type', 'current_stage', 'property_address', 'loan_amount', 'risk_status', 'client_name'],
  },
  get_client_reminders: {
    arrayKey: 'reminders',
    fields: ['id', 'client_id', 'title', 'description', 'due_date', 'status', 'priority', 'reminder_type'],
  },
  get_client_activities: {
    arrayKey: 'activities',
    fields: ['id', 'title', 'activity_type', 'description', 'event_timestamp', 'created_at', 'source_actor_name'],
  },
  get_recent_activity: {
    arrayKey: 'activities',
    fields: ['id', 'action_type', 'entity_type', 'entity_name', 'entity_id', 'username', 'created_at'],
  },
  get_portfolio_reviews: {
    arrayKey: 'reviews',
    fields: [
      'id', 'client_id', 'status', 'review_date', 'overall_score', 'portfolio_health',
      'risk_level', 'next_review_due', 'created_at',
    ],
  },
  // GoHighLevel events carry these four; the local-records branch does not, and
  // the pass-through rule leaves those rows whole.
  get_appointments_for_client: { arrayKey: 'appointments', fields: ['id', 'title', 'startTime', 'endTime'] },
  get_recent_calls: {
    arrayKey: 'calls',
    fields: ['id', 'agent_name', 'customer_name', 'duration_seconds', 'call_outcome', 'sentiment', 'created_at'],
  },
  search_calls: {
    arrayKey: 'calls',
    fields: ['id', 'agent_name', 'customer_name', 'duration_seconds', 'call_outcome', 'created_at'],
  },
};

/** Keep `fields` of `item` — or the whole item, when it does not have every one of them. */
export function projectItem(item: unknown, fields: readonly string[]): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item) || !fields.length) return item;
  const record = item as Record<string, unknown>;
  for (const f of fields) if (!(f in record)) return item;
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = record[f];
  return out;
}

/** Trim a tool's result for the model. Never removes a key the projection does not name. */
export function applyToolProjection(name: string, result: unknown): unknown {
  const proj = TOOL_FIELD_PROJECTIONS[name];
  if (!proj || !result || typeof result !== 'object' || Array.isArray(result)) return result;
  const source = result as Record<string, unknown>;
  const list = source[proj.arrayKey];
  if (!Array.isArray(list)) return result;
  return { ...source, [proj.arrayKey]: list.map((it) => projectItem(it, proj.fields)) };
}
