/**
 * Where Aurixa may send somebody, and how a record becomes a link.
 *
 * The agent can now offer to open a page — "take me to the pipeline", or the
 * client it has just found. That makes a URL something a model composes, and a
 * model composing a URL is a model that can compose any URL. So nothing here
 * accepts one. The model names a PAGE from a closed list or an ENTITY by kind
 * and id; this module builds the path, and `isAgentHref` is asked again by the
 * browser before it navigates, because the two ends deploy separately and the
 * end that moves the user is the one that must refuse.
 *
 * Three rules.
 *
 * - **An id is checked before it reaches a path.** Clients, deals and reports
 *   are UUIDs; a listing is an Airtable record id. Anything else is refused,
 *   which is also what keeps a query string from being smuggled in.
 * - **A link is same-origin and relative**: it starts with one `/`, never two,
 *   never a scheme.
 * - **Only a request moves the page.** The model may OFFER a page on any turn;
 *   the panel follows it unasked only when the user's own words asked to go
 *   somewhere (`wantsNavigation`), and only on a screen wide enough that the
 *   panel stays open beside the page. Otherwise it is a button.
 */

export type AgentPage = { readonly path: string; readonly label: string };

/**
 * The staff routes the agent may name, by the key it uses. Each path is a route
 * `App.tsx` declares; a renamed route is a broken button, and
 * `agentProtocol.spec.ts` checks every one against the router.
 */
export const AGENT_PAGES = {
  dashboard: { path: '/dashboard', label: 'Dashboard' },
  clients: { path: '/clients', label: 'Clients' },
  client_tracker: { path: '/client-tracker', label: 'Client tracker' },
  pipeline: { path: '/deal-pipeline', label: 'Deal pipeline' },
  reminders: { path: '/reminders', label: 'Reminders' },
  calendar: { path: '/calendar', label: 'Calendar' },
  conversations: { path: '/conversations', label: 'Conversations' },
  calls: { path: '/call-logs', label: 'Call logs' },
  email: { path: '/email-copilot', label: 'Email copilot' },
  reports: { path: '/reports', label: 'Reports' },
  generated_reports: { path: '/generated-reports', label: 'Generated reports' },
  portfolio_reviews: { path: '/portfolio-reports', label: 'Portfolio reviews' },
  cash_flow: { path: '/cash-flow-analysis', label: 'Cash flow analysis' },
  listings: { path: '/listings', label: 'Listings' },
  market_updates: { path: '/market-updates', label: 'Market updates' },
  commissions: { path: '/commissions', label: 'Commissions' },
  lenders: { path: '/lenders', label: 'Lenders' },
  agreements: { path: '/agreements', label: 'Agreements' },
  commercial: { path: '/commercial', label: 'Commercial' },
  insights: { path: '/agent-insights', label: 'Agent insights' },
  memories: { path: '/agent/memories', label: 'Aurixa memories' },
  plans: { path: '/agent/plans', label: 'Aurixa plans' },
  skills: { path: '/agent/skills', label: 'Aurixa skills' },
  settings: { path: '/settings', label: 'Settings' },
} as const satisfies Record<string, AgentPage>;

export type AgentPageKey = keyof typeof AGENT_PAGES;

export const AGENT_PAGE_KEYS = Object.keys(AGENT_PAGES) as AgentPageKey[];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AIRTABLE_RECORD = /^rec[A-Za-z0-9]{14}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * The client-record tabs a link may open on — a subset of the workspace's own
 * registry (`clientWorkspaceRegistry.ts`), which the spec holds it to. An
 * unknown tab is dropped rather than refused: the record still opens.
 */
export const AGENT_CLIENT_TABS = [
  'overview', 'personal', 'properties', 'deals', 'financials', 'reports', 'emails', 'conversations',
  'appointments', 'notes', 'reminders', 'files', 'activity', 'borrowing', 'lenders',
] as const;

export type AgentEntity = 'client' | 'deal' | 'report' | 'listing';

export type EntityTarget = {
  readonly entity: AgentEntity;
  readonly id?: unknown;
  readonly clientId?: unknown;
  readonly tab?: unknown;
};

/** A record's own page, or null when the ids do not check out. */
export function entityHref(target: EntityTarget): string | null {
  const { entity, id } = target;
  if (entity === 'client') {
    if (!isUuid(id)) return null;
    const tab = typeof target.tab === 'string' && (AGENT_CLIENT_TABS as readonly string[]).includes(target.tab) ? target.tab : null;
    return `/clients?clientId=${id}${tab ? `&tab=${tab}` : ''}`;
  }
  if (entity === 'deal') {
    if (!isUuid(id) || !isUuid(target.clientId)) return null;
    return `/clients?clientId=${target.clientId}&tab=deals&dealId=${id}`;
  }
  if (entity === 'report') return isUuid(id) ? `/investment-report/${id}` : null;
  if (entity === 'listing') {
    return typeof id === 'string' && (AIRTABLE_RECORD.test(id) || UUID.test(id)) ? `/listings/${id}` : null;
  }
  return null;
}

export type ResolvedTarget = { readonly href: string; readonly label: string };

/**
 * Resolve what the model asked to open. `page` wins when both are given,
 * because a page key cannot be wrong in a way that lands somewhere surprising.
 */
export function resolveAgentTarget(args: unknown): ResolvedTarget | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  const label = typeof a.label === 'string' ? cleanLabel(a.label) : '';
  if (typeof a.page === 'string' && a.page in AGENT_PAGES) {
    const page = AGENT_PAGES[a.page as AgentPageKey];
    return { href: page.path, label: label || page.label };
  }
  if (typeof a.entity === 'string') {
    const href = entityHref({ entity: a.entity as AgentEntity, id: a.id, clientId: a.client_id, tab: a.tab });
    if (!href) return null;
    return { href, label: label || defaultEntityLabel(a.entity as AgentEntity) };
  }
  return null;
}

function defaultEntityLabel(entity: AgentEntity): string {
  if (entity === 'client') return 'Client record';
  if (entity === 'deal') return 'Deal';
  if (entity === 'report') return 'Investment report';
  return 'Listing';
}

/** A label is a few words of plain text, never markup. */
export function cleanLabel(raw: string): string {
  return raw.replace(/[<>`*_[\]#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);
}

const PAGE_PATHS = new Set<string>(Object.values(AGENT_PAGES).map((p) => p.path));
const ENTITY_PATHS: readonly RegExp[] = [
  /^\/clients\?clientId=[0-9a-f-]{36}(?:&tab=[a-z-]+)?(?:&dealId=[0-9a-f-]{36})?$/i,
  /^\/investment-report\/[0-9a-f-]{36}$/i,
  /^\/listings\/(?:rec[A-Za-z0-9]{14}|[0-9a-f-]{36})$/i,
];

/** True when `href` is a link this module could have built. The browser asks before it moves. */
export function isAgentHref(href: unknown): href is string {
  if (typeof href !== 'string' || href.length > 200) return false;
  if (!href.startsWith('/') || href.startsWith('//')) return false;
  if (PAGE_PATHS.has(href)) return true;
  return ENTITY_PATHS.some((re) => re.test(href));
}

/**
 * True when the user's own words ask to go somewhere. Deliberately narrow:
 * "what open deals do I have" must not move the page, so "open" counts only as
 * the verb that starts a request.
 */
export function wantsNavigation(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (/\b(?:take me|bring me|go|navigate|jump|head|switch) (?:to|back to|over to)\b/.test(t)) return true;
  if (/^(?:(?:hey |ok |okay )?aurixa,? )?(?:please |can you |could you |would you )?(?:open|pull up|bring up|show me) (?:up )?(?:the |my |their |his |her |that |this )?[\w' -]{1,40}?(?:page|record|file|profile|screen|pipeline|calendar|dashboard|deal|client|report|listing|reminders)\b/.test(t)) return true;
  return false;
}
