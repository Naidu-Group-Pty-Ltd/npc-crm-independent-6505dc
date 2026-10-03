/**
 * What Aurixa found, drawn as the thing itself rather than described.
 *
 * The agent has always answered in prose. When it looked up the pipeline the
 * user got a paragraph *about* the pipeline, and a client it found was a name
 * in a sentence with nothing to click. A view is the structured half of the
 * same answer: the rows the tool returned, shaped for a card, each one a link
 * to its own record. The prose still explains; the view is what you act on.
 *
 * Built on the server from the tool's RAW result — before any trimming for the
 * model — so a card is never thinner than the facts. Three rules.
 *
 * - **Derived, never invented.** Every field on a card is a field the tool
 *   returned. Nothing is estimated, totalled across tools or ranked by a
 *   guess; an absent value leaves its slot empty rather than printing a zero.
 * - **Small and closed.** At most `MAX_ITEMS` rows, plain strings only, and
 *   `sanitizeView` is applied by the browser to anything it receives — the
 *   live stream and the stored receipt alike — so a view is data the panel
 *   chooses how to draw, never markup.
 * - **A date travels as a date.** The server runs in UTC and a broker in
 *   Perth or Sydney does not, so a row carries `when` as ISO and the browser
 *   writes it in the reader's own day.
 */

import { AGENT_PAGES, entityHref, isAgentHref, isUuid } from './agentRoutes.pure.ts';

export const MAX_ITEMS = 8;
const MAX_TEXT = 140;

export type AgentTone = 'neutral' | 'positive' | 'caution' | 'critical';

export type AgentBadge = { readonly label: string; readonly tone: AgentTone };

export type AgentRecord = {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly meta?: string;
  /** ISO timestamp; the browser formats it in the reader's own timezone. */
  readonly when?: string;
  readonly badge?: AgentBadge;
  readonly href?: string;
};

export type AgentRecordEntity = 'client' | 'deal' | 'settlement' | 'reminder' | 'event' | 'call';

export type AgentMetric = { readonly label: string; readonly value: string; readonly tone?: AgentTone };

export type AgentBar = { readonly label: string; readonly value: number; readonly display: string };

export type AgentView =
  | {
      readonly kind: 'records';
      readonly entity: AgentRecordEntity;
      readonly title: string;
      readonly items: readonly AgentRecord[];
      /** How many the tool found, when that is more than the card shows. */
      readonly total?: number;
      readonly href?: string;
    }
  | { readonly kind: 'metrics'; readonly title: string; readonly items: readonly AgentMetric[]; readonly href?: string }
  | { readonly kind: 'breakdown'; readonly title: string; readonly items: readonly AgentBar[]; readonly href?: string };

// ── formatting ──────────────────────────────────────────────────────────────

/** `1250000` → `$1.25m`, `84000` → `$84k`, `9400` → `$9,400`. Null for nothing to say. */
export function formatAud(value: unknown): string | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) return null;
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) {
    const m = a / 1_000_000;
    return `${sign}$${m.toFixed(m >= 10 ? 1 : 2).replace(/\.?0+$/, '')}m`;
  }
  if (a >= 10_000) return `${sign}$${Math.round(a / 1000)}k`;
  return `${sign}$${String(Math.round(a)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export function formatCount(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : null;
}

/** `needs_follow_up` → `Needs follow up`. */
export function humanise(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function text(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const t = String(value).replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function iso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function joinMeta(...parts: Array<string | null | undefined>): string | undefined {
  const kept = parts.filter((p): p is string => typeof p === 'string' && p.length > 0);
  return kept.length ? kept.join(' · ') : undefined;
}

function nameOf(row: Record<string, unknown>): string | undefined {
  if (typeof row.client_name === 'string' && row.client_name.trim()) return row.client_name.trim();
  const c = row.clients as Record<string, unknown> | undefined;
  if (c && typeof c === 'object') {
    const n = `${c.primary_first_name ?? ''} ${c.primary_surname ?? ''}`.trim();
    if (n) return n;
  }
  return undefined;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
}

// ── tones ───────────────────────────────────────────────────────────────────

export function riskTone(risk: unknown): AgentTone {
  if (risk === 'urgent' || risk === 'at_risk' || risk === 'critical') return 'critical';
  if (risk === 'needs_follow_up' || risk === 'watch') return 'caution';
  if (risk === 'on_track' || risk === 'healthy') return 'positive';
  return 'neutral';
}

function sentimentTone(s: unknown): AgentTone {
  if (s === 'negative') return 'critical';
  if (s === 'mixed') return 'caution';
  if (s === 'positive') return 'positive';
  return 'neutral';
}

function priorityTone(p: unknown): AgentTone {
  if (p === 'urgent' || p === 'high') return 'critical';
  if (p === 'medium') return 'caution';
  return 'neutral';
}

function badge(label: unknown, tone: AgentTone): AgentBadge | undefined {
  const l = humanise(label);
  return l ? { label: text(l, 28)!, tone } : undefined;
}

// ── per-tool builders ───────────────────────────────────────────────────────

const page = (key: keyof typeof AGENT_PAGES) => AGENT_PAGES[key].path;

function capped<T>(items: T[]): { items: T[]; total?: number } {
  return items.length > MAX_ITEMS ? { items: items.slice(0, MAX_ITEMS), total: items.length } : { items };
}

function clientRecords(list: unknown, title: string): AgentView | null {
  const items: AgentRecord[] = [];
  for (const c of rows(list)) {
    const id = typeof c.id === 'string' ? c.id : null;
    const name = text(c.name);
    if (!id || !name) continue;
    const status = c.pipeline_status ?? c.status;
    items.push({
      id,
      title: name,
      subtitle: joinMeta(text(c.email, 60), text(c.mobile, 24)),
      when: iso(c.follow_up_date),
      badge: badge(status, 'neutral'),
      href: entityHref({ entity: 'client', id }) ?? undefined,
    });
  }
  if (!items.length) return null;
  return { kind: 'records', entity: 'client', title, ...capped(items), href: page('clients') };
}

function dealRecords(list: unknown, title: string, opts: { stale?: boolean } = {}): AgentView | null {
  const items: AgentRecord[] = [];
  for (const d of rows(list)) {
    const id = typeof d.id === 'string' ? d.id : null;
    if (!id) continue;
    const headline = text(d.property_address) ?? humanise(d.deal_type) ?? 'Deal';
    const stale = typeof d.days_stale === 'number' ? `Quiet for ${d.days_stale} days` : null;
    items.push({
      id,
      title: headline,
      subtitle: joinMeta(nameOf(d), humanise(d.current_stage)),
      meta: joinMeta(formatAud(d.loan_amount), opts.stale ? stale : null),
      when: opts.stale ? undefined : iso(d.settlement_date),
      badge: d.risk_status ? badge(d.risk_status, riskTone(d.risk_status)) : undefined,
      href: (isUuid(d.client_id) ? entityHref({ entity: 'deal', id, clientId: d.client_id }) : null) ?? undefined,
    });
  }
  if (!items.length) return null;
  return { kind: 'records', entity: 'deal', title, ...capped(items), href: page('pipeline') };
}

function settlementRecords(list: unknown): AgentView | null {
  const items: AgentRecord[] = [];
  for (const d of rows(list)) {
    const id = typeof d.id === 'string' ? d.id : null;
    if (!id) continue;
    const days = typeof d.days_remaining === 'number' ? d.days_remaining : null;
    items.push({
      id,
      title: text(d.property_address) ?? 'Settlement',
      subtitle: joinMeta(nameOf(d), humanise(d.current_stage)),
      meta: formatAud(d.loan_amount) ?? undefined,
      when: iso(d.settlement_date),
      badge: days === null ? undefined
        : { label: days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`, tone: days <= 7 ? 'caution' : 'neutral' },
      href: (isUuid(d.client_id) ? entityHref({ entity: 'deal', id, clientId: d.client_id }) : null) ?? undefined,
    });
  }
  if (!items.length) return null;
  return { kind: 'records', entity: 'settlement', title: 'Settlements coming up', ...capped(items), href: page('pipeline') };
}

function reminderRecords(list: unknown, title: string, now: number, overdueLabel = true): AgentView | null {
  const items: AgentRecord[] = [];
  for (const r of rows(list)) {
    const id = typeof r.id === 'string' ? r.id : null;
    const t = text(r.title);
    if (!id || !t) continue;
    const due = iso(r.due_date);
    const overdue = overdueLabel && due !== undefined && Date.parse(due) < now;
    items.push({
      id,
      title: t,
      subtitle: nameOf(r),
      when: due,
      badge: overdue ? { label: 'Overdue', tone: 'critical' }
        : r.priority && r.priority !== 'low' && r.priority !== 'normal' ? badge(r.priority, priorityTone(r.priority)) : undefined,
      href: (isUuid(r.client_id) ? entityHref({ entity: 'client', id: r.client_id, tab: 'reminders' }) : null) ?? undefined,
    });
  }
  if (!items.length) return null;
  return { kind: 'records', entity: 'reminder', title, ...capped(items), href: page('reminders') };
}

function eventRecords(list: unknown): AgentView | null {
  const items: AgentRecord[] = [];
  for (const e of rows(list)) {
    const id = typeof e.id === 'string' ? e.id : null;
    const t = text(e.title);
    if (!id || !t) continue;
    items.push({
      id,
      title: t,
      subtitle: text(e.calendarName, 48),
      when: iso(e.startTime),
      badge: e.status && e.status !== 'confirmed' ? badge(e.status, e.status === 'cancelled' ? 'critical' : 'neutral') : undefined,
    });
  }
  if (!items.length) return null;
  return { kind: 'records', entity: 'event', title: 'Coming up', ...capped(items), href: page('calendar') };
}

function callRecords(list: unknown, title: string): AgentView | null {
  const items: AgentRecord[] = [];
  for (const c of rows(list)) {
    const id = typeof c.id === 'string' ? c.id : null;
    if (!id) continue;
    const secs = typeof c.duration_seconds === 'number' ? c.duration_seconds : null;
    items.push({
      id,
      title: text(c.customer_name, 60) ?? text(c.phone_number, 24) ?? 'Call',
      subtitle: text(c.summary, 110),
      meta: joinMeta(text(c.agent_name, 32), secs !== null ? `${Math.max(1, Math.round(secs / 60))} min` : null),
      when: iso(c.created_at),
      badge: c.sentiment && c.sentiment !== 'neutral' ? badge(c.sentiment, sentimentTone(c.sentiment)) : undefined,
    });
  }
  if (!items.length) return null;
  return { kind: 'records', entity: 'call', title, ...capped(items), href: page('calls') };
}

function metric(label: string, value: string | null, tone?: AgentTone): AgentMetric | null {
  return value === null ? null : tone ? { label, value, tone } : { label, value };
}

function metrics(title: string, list: Array<AgentMetric | null>, href: string): AgentView | null {
  const items = list.filter((m): m is AgentMetric => m !== null);
  return items.length ? { kind: 'metrics', title, items, href } : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(ym: unknown): string | null {
  if (typeof ym !== 'string') return null;
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? `${MONTHS[i]} ${m[1].slice(2)}` : null;
}

/**
 * The cards a tool's result becomes. Empty for a tool with nothing to draw, an
 * error, or a result whose shape it does not recognise — never a throw, because
 * a card is decoration on an answer and must not be able to cost the answer.
 */
export function viewsForTool(tool: string, raw: unknown, now: number = Date.now()): AgentView[] {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const r = raw as Record<string, unknown>;
    if (r.error || r.success === false) return [];
    const out: Array<AgentView | null> = [];
    switch (tool) {
      case 'search_clients':
        out.push(clientRecords(r.clients, 'Clients'));
        break;
      case 'get_clients_by_pipeline_status':
        out.push(clientRecords(r.clients, humanise((rows(r.clients)[0] ?? {}).status) ?? 'Clients'));
        break;
      case 'get_client_deals':
        out.push(dealRecords(r.deals, 'Deals'));
        break;
      case 'get_deals_by_stage':
        out.push(dealRecords(r.deals, 'Deals at this stage'));
        break;
      case 'get_deals_by_risk':
        out.push(dealRecords(r.deals, 'Deals needing attention'));
        break;
      case 'get_stale_deals':
        out.push(dealRecords(r.stale_deals, 'Deals gone quiet', { stale: true }));
        break;
      case 'get_settlement_countdown':
        out.push(settlementRecords(r.settlements));
        break;
      case 'get_overdue_reminders':
        out.push(reminderRecords(r.overdue_reminders, 'Overdue reminders', now));
        break;
      case 'get_client_reminders':
        out.push(reminderRecords(r.reminders, 'Reminders', now));
        break;
      case 'get_all_reminders': {
        const all = [...rows(r.overdue), ...rows(r.today), ...rows(r.upcoming)];
        out.push(reminderRecords(all, 'Reminders', now));
        break;
      }
      case 'get_upcoming_calendar':
      case 'search_calendar_events':
        out.push(eventRecords(r.appointments ?? r.events));
        break;
      case 'get_recent_calls':
        out.push(callRecords(r.calls, 'Recent calls'));
        break;
      case 'search_calls':
        out.push(callRecords(r.calls, 'Calls'));
        break;
      case 'get_flagged_calls':
        out.push(callRecords(r.flagged_calls, 'Calls to review'));
        break;
      case 'get_pipeline_overview': {
        out.push(metrics('Pipeline', [
          metric('Deals', formatCount(r.total_deals)),
          metric('Pipeline value', formatAud(r.total_pipeline_value)),
          metric('Commission', formatAud(r.total_commission)),
          metric('At risk', formatCount(r.at_risk), typeof r.at_risk === 'number' && r.at_risk > 0 ? 'critical' : undefined),
          metric('Settling in 30 days', formatCount(r.upcoming_settlements)),
        ], page('pipeline')));
        const byStage = r.by_stage && typeof r.by_stage === 'object' ? Object.entries(r.by_stage as Record<string, unknown>) : [];
        const bars = byStage
          .filter(([, v]) => typeof v === 'number' && v > 0)
          .sort((a, b) => (b[1] as number) - (a[1] as number))
          .slice(0, 10)
          .map(([k, v]) => ({ label: text(humanise(k) ?? k, 40)!, value: v as number, display: formatCount(v)! }));
        if (bars.length > 1) out.push({ kind: 'breakdown', title: 'Deals by stage', items: bars, href: page('pipeline') });
        break;
      }
      case 'get_dashboard_summary': {
        const clients = (r.clients ?? {}) as Record<string, unknown>;
        const deals = (r.deals ?? {}) as Record<string, unknown>;
        const reminders = (r.reminders ?? {}) as Record<string, unknown>;
        out.push(metrics('Today', [
          metric('Clients', formatCount(clients.total)),
          metric('Active deals', formatCount(deals.active)),
          metric('Pipeline value', formatAud(deals.total_pipeline_value)),
          metric('Deals at risk', formatCount(deals.at_risk), typeof deals.at_risk === 'number' && deals.at_risk > 0 ? 'critical' : undefined),
          metric('Overdue reminders', formatCount(reminders.overdue), typeof reminders.overdue === 'number' && reminders.overdue > 0 ? 'caution' : undefined),
          metric('Under management', formatAud(r.total_aum)),
        ], page('dashboard')));
        break;
      }
      case 'get_notification_summary': {
        const warn = (v: unknown, tone: AgentTone) => (typeof v === 'number' && v > 0 ? tone : undefined);
        out.push(metrics('Needs you', [
          metric('Overdue reminders', formatCount(r.overdue_reminders), warn(r.overdue_reminders, 'caution')),
          metric('Urgent deals', formatCount(r.urgent_deals), warn(r.urgent_deals, 'critical')),
          metric('Settling this week', formatCount(r.upcoming_settlements)),
          metric('Unread call alerts', formatCount(r.unread_call_alerts), warn(r.unread_call_alerts, 'caution')),
          metric('Clawback watch', formatCount(r.clawback_risk_deals), warn(r.clawback_risk_deals, 'caution')),
        ], page('dashboard')));
        break;
      }
      case 'get_commission_forecast': {
        const bars = rows(r.forecast)
          .map((f) => ({ label: monthLabel(f.month), value: typeof f.amount === 'number' ? f.amount : NaN }))
          .filter((b): b is { label: string; value: number } => b.label !== null && Number.isFinite(b.value))
          .slice(0, 12)
          .map((b) => ({ ...b, display: formatAud(b.value)! }));
        if (bars.some((b) => b.value > 0)) out.push({ kind: 'breakdown', title: 'Commission by settlement month', items: bars, href: page('commissions') });
        break;
      }
      default:
        break;
    }
    return out.filter((v): v is AgentView => v !== null);
  } catch {
    return [];
  }
}

/** The tools `viewsForTool` draws. The server asks this before it spends a build. */
export const VIEW_TOOLS: ReadonlySet<string> = new Set([
  'search_clients', 'get_clients_by_pipeline_status', 'get_client_deals', 'get_deals_by_stage', 'get_deals_by_risk',
  'get_stale_deals', 'get_settlement_countdown', 'get_overdue_reminders', 'get_client_reminders', 'get_all_reminders',
  'get_upcoming_calendar', 'search_calendar_events', 'get_recent_calls', 'search_calls', 'get_flagged_calls',
  'get_pipeline_overview', 'get_dashboard_summary', 'get_notification_summary', 'get_commission_forecast',
]);

// ── the browser's gate ──────────────────────────────────────────────────────

const TONES: ReadonlySet<string> = new Set(['neutral', 'positive', 'caution', 'critical']);
const ENTITIES: ReadonlySet<string> = new Set(['client', 'deal', 'settlement', 'reminder', 'event', 'call']);

function cleanTone(t: unknown): AgentTone | undefined {
  return typeof t === 'string' && TONES.has(t) ? (t as AgentTone) : undefined;
}

function cleanHref(h: unknown): string | undefined {
  return isAgentHref(h) ? h : undefined;
}

function cleanBadge(b: unknown): AgentBadge | undefined {
  if (!b || typeof b !== 'object') return undefined;
  const o = b as Record<string, unknown>;
  const label = text(o.label, 28);
  return label ? { label, tone: cleanTone(o.tone) ?? 'neutral' } : undefined;
}

/**
 * Re-check a view received from anywhere — the stream or a stored receipt —
 * before it is drawn. Unknown kinds, foreign links and oversized lists are
 * dropped or cut; what survives is plain text and links `isAgentHref` accepts.
 */
export function sanitizeView(value: unknown): AgentView | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const title = text(v.title, 60);
  if (!title || !Array.isArray(v.items)) return null;
  const href = cleanHref(v.href);
  if (v.kind === 'records') {
    if (typeof v.entity !== 'string' || !ENTITIES.has(v.entity)) return null;
    const items: AgentRecord[] = [];
    for (const raw of v.items.slice(0, MAX_ITEMS)) {
      if (!raw || typeof raw !== 'object') continue;
      const it = raw as Record<string, unknown>;
      const id = text(it.id, 64);
      const t = text(it.title);
      if (!id || !t) continue;
      items.push({
        id,
        title: t,
        ...(text(it.subtitle) ? { subtitle: text(it.subtitle) } : {}),
        ...(text(it.meta) ? { meta: text(it.meta) } : {}),
        ...(iso(it.when) ? { when: iso(it.when) } : {}),
        ...(cleanBadge(it.badge) ? { badge: cleanBadge(it.badge) } : {}),
        ...(cleanHref(it.href) ? { href: cleanHref(it.href) } : {}),
      });
    }
    if (!items.length) return null;
    const total = typeof v.total === 'number' && v.total > items.length ? Math.round(v.total) : undefined;
    return {
      kind: 'records', entity: v.entity as AgentRecordEntity, title, items,
      ...(total ? { total } : {}), ...(href ? { href } : {}),
    };
  }
  if (v.kind === 'metrics') {
    const items: AgentMetric[] = [];
    for (const raw of v.items.slice(0, 8)) {
      if (!raw || typeof raw !== 'object') continue;
      const m = raw as Record<string, unknown>;
      const label = text(m.label, 40);
      const value2 = text(m.value, 24);
      if (!label || !value2) continue;
      const tone = cleanTone(m.tone);
      items.push(tone ? { label, value: value2, tone } : { label, value: value2 });
    }
    return items.length ? { kind: 'metrics', title, items, ...(href ? { href } : {}) } : null;
  }
  if (v.kind === 'breakdown') {
    const items: AgentBar[] = [];
    for (const raw of v.items.slice(0, 12)) {
      if (!raw || typeof raw !== 'object') continue;
      const b = raw as Record<string, unknown>;
      const label = text(b.label, 40);
      const display = text(b.display, 24);
      if (!label || !display || typeof b.value !== 'number' || !Number.isFinite(b.value)) continue;
      items.push({ label, value: b.value, display });
    }
    return items.length ? { kind: 'breakdown', title, items, ...(href ? { href } : {}) } : null;
  }
  return null;
}
