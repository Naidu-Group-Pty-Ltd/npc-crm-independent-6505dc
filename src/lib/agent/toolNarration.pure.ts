/**
 * Tool narration — what Aurixa is doing, said the way a colleague would say it.
 *
 * The agent streams `tool` events carrying the raw function name
 * (`get_upcoming_calendar`, `search_clients`, …). Until now the widget printed
 * that name in a monospace line under the composer, which read like a log
 * file. This module turns a name into the two sentences a person would use —
 * one while the work is happening ("Checking your calendar") and one once it
 * is done ("Checked your calendar") — plus the area of the business it
 * touches, so the trace can draw a fitting icon.
 *
 * Three rules hold it:
 *
 * - **Nothing is invented.** A narration describes the CALL, never its
 *   outcome. "Looked up clients" is true whether it found one or none; "Found
 *   3 clients" would be a claim this module cannot see.
 * - **An unknown tool still reads as English.** The server exposes ~215 tools
 *   and adds more; a name with no override is humanised from its verb and
 *   object rather than shown raw, so a new tool never reaches the page as
 *   `snake_case`.
 * - **The meta tools are one step.** `list_tool_domains`, `search_tools` and
 *   `load_tools` are the model choosing what to use, not work done for the
 *   user, so all three narrate as "Choosing the right tools".
 */

export type ToolDomain =
  | 'clients'
  | 'deals'
  | 'reminders'
  | 'financial'
  | 'email'
  | 'calendar'
  | 'calls'
  | 'reports'
  | 'operations'
  | 'plans'
  | 'analytics'
  | 'team'
  | 'listings'
  | 'admin'
  | 'memory'
  | 'tools'
  | 'general';

export interface ToolNarration {
  /** The raw function name, kept for keys and for the expandable detail. */
  name: string;
  /** Present tense, shown while the call is running. No trailing ellipsis. */
  active: string;
  /** Past tense, shown once the call has ended. */
  done: string;
  domain: ToolDomain;
}

export const META_TOOLS = new Set(['list_tool_domains', 'search_tools', 'load_tools']);

/**
 * The two tools that only talk to the panel — a plan, a page to open. They are
 * drawn as what they are (a checklist, a button), so they are never a step in
 * the trace and never an action on an approval card.
 */
export const PANEL_TOOLS = new Set(['show_plan', 'open_page']);

const OVERRIDES: Record<string, { active: string; done: string; domain?: ToolDomain }> = {
  list_tool_domains: { active: 'Choosing the right tools', done: 'Chose the right tools', domain: 'tools' },
  search_tools: { active: 'Choosing the right tools', done: 'Chose the right tools', domain: 'tools' },
  load_tools: { active: 'Choosing the right tools', done: 'Chose the right tools', domain: 'tools' },

  get_upcoming_calendar: { active: 'Checking your calendar', done: 'Checked your calendar' },
  get_todays_schedule: { active: "Checking today's schedule", done: "Checked today's schedule" },
  get_free_slots: { active: 'Finding free time', done: 'Found free time' },
  get_all_reminders: { active: 'Reviewing your reminders', done: 'Reviewed your reminders' },
  get_overdue_reminders: { active: 'Finding overdue reminders', done: 'Checked overdue reminders' },
  get_dashboard_summary: { active: 'Reading your dashboard', done: 'Read your dashboard' },
  get_pipeline_overview: { active: 'Reviewing your pipeline', done: 'Reviewed your pipeline' },
  get_proactive_insights: { active: 'Scanning for insights', done: 'Scanned for insights' },
  get_notification_summary: { active: 'Checking your notifications', done: 'Checked your notifications' },
  search_clients: { active: 'Looking up clients', done: 'Looked up clients' },
  get_client_details: { active: 'Opening the client file', done: 'Opened the client file' },
  get_client_deals: { active: 'Pulling up their deals', done: 'Pulled up their deals' },
  get_stale_deals: { active: 'Spotting stale deals', done: 'Checked for stale deals' },
  get_settlement_countdown: { active: 'Checking upcoming settlements', done: 'Checked upcoming settlements' },
  get_clawback_monitor: { active: 'Checking clawback risk', done: 'Checked clawback risk' },
  get_commission_forecast: { active: 'Forecasting commission', done: 'Forecast commission' },
  get_revenue_forecast: { active: 'Forecasting revenue', done: 'Forecast revenue' },
  get_weekly_digest: { active: 'Compiling your weekly digest', done: 'Compiled your weekly digest' },
  get_top_clients: { active: 'Ranking your top clients', done: 'Ranked your top clients' },
  get_borrowing_capacity: { active: 'Assessing borrowing capacity', done: 'Assessed borrowing capacity' },
  run_system_health_check: { active: 'Running a health check', done: 'Ran a health check' },
  generate_chart_data: { active: 'Building a chart', done: 'Built a chart' },
  what_if_analysis: { active: 'Running a what-if scenario', done: 'Ran a what-if scenario' },
  smart_search: { active: 'Searching across everything', done: 'Searched across everything' },
  send_email: { active: 'Drafting an email', done: 'Drafted an email' },
  draft_follow_up: { active: 'Drafting a follow-up', done: 'Drafted a follow-up' },
  trigger_investment_report: { active: 'Preparing an investment report', done: 'Prepared an investment report' },
  get_playbooks: { active: 'Opening your playbooks', done: 'Opened your playbooks' },
  run_playbook: { active: 'Running a playbook', done: 'Ran a playbook' },
  recall_memories: { active: 'Recalling what I know', done: 'Recalled what I know', domain: 'memory' },
  search_semantic_memory: { active: 'Recalling what I know', done: 'Recalled what I know', domain: 'memory' },
  save_memory: { active: 'Making a note of this', done: 'Made a note of this', domain: 'memory' },
  save_semantic_memory: { active: 'Making a note of this', done: 'Made a note of this', domain: 'memory' },
  undo_action: { active: 'Undoing that action', done: 'Undid that action' },
};

/** Verb → [present participle, past tense]. Anything missing falls back to "Working on". */
const VERBS: Record<string, [string, string]> = {
  get: ['Looking at', 'Looked at'],
  search: ['Searching', 'Searched'],
  find: ['Finding', 'Found'],
  list: ['Listing', 'Listed'],
  create: ['Setting up', 'Set up'],
  add: ['Adding', 'Added'],
  update: ['Updating', 'Updated'],
  set: ['Setting', 'Set'],
  toggle: ['Switching', 'Switched'],
  delete: ['Removing', 'Removed'],
  remove: ['Removing', 'Removed'],
  revoke: ['Revoking', 'Revoked'],
  cancel: ['Cancelling', 'Cancelled'],
  reschedule: ['Rescheduling', 'Rescheduled'],
  calculate: ['Calculating', 'Calculated'],
  compare: ['Comparing', 'Compared'],
  generate: ['Generating', 'Generated'],
  export: ['Exporting', 'Exported'],
  run: ['Running', 'Ran'],
  link: ['Linking', 'Linked'],
  log: ['Logging', 'Logged'],
  send: ['Preparing', 'Prepared'],
  draft: ['Drafting', 'Drafted'],
  share: ['Sharing', 'Shared'],
  complete: ['Completing', 'Completed'],
  bulk: ['Batch-updating', 'Batch-updated'],
  trigger: ['Starting', 'Started'],
  save: ['Saving', 'Saved'],
  recall: ['Recalling', 'Recalled'],
  undo: ['Undoing', 'Undid'],
};

const PROPER: Record<string, string> = {
  ghl: 'GHL',
  qa: 'QA',
  api: 'API',
  lmi: 'LMI',
  docusign: 'DocuSign',
  outlook: 'Outlook',
  kpi: 'KPI',
  kpis: 'KPIs',
  csv: 'CSV',
  ai: 'AI',
};

/** Ordered keyword → domain rules. The first rule that matches wins. */
const DOMAIN_RULES: Array<[RegExp, ToolDomain]> = [
  [/memory|memories/, 'memory'],
  [/game_plan|digest|performance_metrics/, 'plans'],
  [/email/, 'email'],
  [/calendar|appointment|schedule$|todays_schedule|free_slots|outlook|availability/, 'calendar'],
  [/call/, 'calls'],
  [/report|depreciation/, 'reports'],
  [/listing|data_sources/, 'listings'],
  [/borrowing|income|expense|liabilit|asset|employment|cash_flow|stamp_duty|lmi|loan|rental_yield|equity|lending|lender|rates|what_if/, 'financial'],
  [/deal|pipeline|commission|clawback|settlement|build_|builder|conversion|velocity/, 'deals'],
  [/reminder|follow_up|scheduled_task|upcoming_milestones/, 'reminders'],
  [/checklist|playbook|switch|bulk_|document_readiness|auto_report/, 'operations'],
  [/share|collaborat|team|preference|audit|undo/, 'team'],
  [/client|contact|note/, 'clients'],
  [/insight|summary|trend|forecast|chart|export|smart_search|top_clients|engagement|activity|health|notification|usage|cache/, 'analytics'],
  [/branding|template|import|monitoring|error|integration|cloudflare|user|agreement|attribution|campaign|marketing|portal|lead_source|upload/, 'admin'],
];

function humanizeWords(words: string[]): string {
  return words
    .map((w) => PROPER[w] ?? w)
    .join(' ')
    .replace(/\bid\b/g, 'ID')
    .trim();
}

export function toolDomain(name: string): ToolDomain {
  const override = OVERRIDES[name]?.domain;
  if (override) return override;
  if (META_TOOLS.has(name)) return 'tools';
  for (const [re, domain] of DOMAIN_RULES) {
    if (re.test(name)) return domain;
  }
  return 'general';
}

export function narrateTool(name: string | null | undefined): ToolNarration {
  const raw = (name ?? '').trim();
  if (!raw) {
    return { name: '', active: 'Working on it', done: 'Worked on it', domain: 'general' };
  }
  const override = OVERRIDES[raw];
  if (override) {
    return { name: raw, active: override.active, done: override.done, domain: toolDomain(raw) };
  }

  const parts = raw.toLowerCase().split(/[_\s-]+/).filter(Boolean);
  const [verb, ...rest] = parts;
  const tense = VERBS[verb];
  if (tense && rest.length > 0) {
    const object = humanizeWords(rest);
    return { name: raw, active: `${tense[0]} ${object}`, done: `${tense[1]} ${object}`, domain: toolDomain(raw) };
  }
  const object = humanizeWords(parts);
  return { name: raw, active: `Working on ${object}`, done: `Worked on ${object}`, domain: toolDomain(raw) };
}

// ── Pending actions (the approval card) ─────────────────────────────────

const IMPERATIVE_OVERRIDES: Record<string, string> = {
  send_email: 'Send an email',
  create_reminder: 'Create a reminder',
  update_reminder: 'Update a reminder',
  delete_reminder: 'Delete a reminder',
  create_appointment: 'Book an appointment',
  reschedule_appointment: 'Reschedule an appointment',
  cancel_appointment: 'Cancel an appointment',
  update_deal_stage: 'Move a deal to a new stage',
  create_client: 'Create a client',
  create_client_note: 'Add a client note',
  update_client_field: 'Update a client record',
  create_deal: 'Create a deal',
  set_follow_up_date: 'Set a follow-up date',
  create_playbook: 'Save a playbook',
  run_playbook: 'Run a playbook',
  create_scheduled_task: 'Schedule a task',
  trigger_investment_report: 'Generate an investment report',
  send_agreement_docusign: 'Send an agreement for signature',
  send_portal_invite: 'Send a portal invite',
  create_outlook_event: 'Add an Outlook event',
};

/** Arguments worth surfacing beside the action, in order of how much they say. */
const SALIENT_ARGS = [
  'subject',
  'title',
  'name',
  'client_name',
  'to',
  'new_stage',
  'stage',
  'field',
  'playbook_name',
  'description',
] as const;

export interface PendingActionSummary {
  name: string;
  title: string;
  detail: string | null;
  domain: ToolDomain;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Summarise one pending tool call for the approval card. Accepts the
 * OpenAI-shaped `{ function: { name, arguments } }` the server stores, and a
 * bare `{ name, arguments }` for safety.
 */
export function describePendingAction(toolCall: unknown): PendingActionSummary | null {
  if (!toolCall || typeof toolCall !== 'object') return null;
  const tc = toolCall as { function?: { name?: string; arguments?: unknown }; name?: string; arguments?: unknown };
  const name = tc.function?.name ?? tc.name;
  if (!name || META_TOOLS.has(name) || PANEL_TOOLS.has(name)) return null;
  const args = parseArgs(tc.function?.arguments ?? tc.arguments);

  let title = IMPERATIVE_OVERRIDES[name];
  if (!title) {
    const [verb, ...rest] = name.toLowerCase().split('_').filter(Boolean);
    const object = humanizeWords(rest);
    const v = verb ? verb.charAt(0).toUpperCase() + verb.slice(1) : 'Run';
    title = object ? `${v} ${object}` : v;
  }

  let detail: string | null = null;
  for (const key of SALIENT_ARGS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      detail = value.trim().length > 90 ? `${value.trim().slice(0, 87)}…` : value.trim();
      break;
    }
  }
  return { name, title, detail, domain: toolDomain(name) };
}

/** Every action a reply proposes, described once each, in the order proposed. */
export function summarisePendingActions(toolCalls: unknown[] | undefined): PendingActionSummary[] {
  const out: PendingActionSummary[] = [];
  for (const tc of toolCalls ?? []) {
    const s = describePendingAction(tc);
    if (s && !out.some((o) => o.title === s.title && o.detail === s.detail)) out.push(s);
  }
  return out;
}
