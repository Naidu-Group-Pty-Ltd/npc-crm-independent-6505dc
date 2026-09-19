// Declarative registry for the client workspace: every tab and header
// action, in render order, with the capability that gates it.
//
// Replaces two divergent hardcoded sources in ClientDetailsModal — the JSX
// trigger list and the separate `tabOrder` swipe array, which had drifted
// (four rendered tabs were unreachable by swipe). Tab visibility, swipe
// order, initialTab validation and deep-link validation all derive from this
// one table now, so they cannot disagree.

import type { LucideIcon } from 'lucide-react';
import { Calendar, Inbox, MessageSquare, Send } from 'lucide-react';
import type { CapabilityKey } from '@/lib/entitlements';

export interface ClientTabDef {
  value: string;
  label: string;
  capability: CapabilityKey;
  icon?: LucideIcon;
  /** Show the client's property count beside the label. */
  showsPropertyCount?: boolean;
}

/** All client tabs in canonical render + swipe order. */
export const CLIENT_TABS: readonly ClientTabDef[] = [
  { value: 'overview', label: 'Overview', capability: 'client.overview' },
  { value: 'personal', label: 'Personal', capability: 'client.personal' },
  { value: 'properties', label: 'Properties', capability: 'client.properties', showsPropertyCount: true },
  { value: 'deals', label: 'Deals', capability: 'client.deals' },
  { value: 'employment', label: 'Employment', capability: 'client.employment' },
  { value: 'financials', label: 'Financials', capability: 'client.financials' },
  { value: 'reports', label: 'Reports', capability: 'client.reports' },
  { value: 'sent-reports', label: 'Sent Reports', capability: 'client.sent_reports', icon: Send },
  { value: 'report-requests', label: 'Requests', capability: 'client.requests', icon: Inbox },
  { value: 'emails', label: 'Emails', capability: 'client.emails', icon: Inbox },
  { value: 'conversations', label: 'Conversations', capability: 'client.conversations', icon: MessageSquare },
  { value: 'appointments', label: 'Appointments', capability: 'client.appointments', icon: Calendar },
  { value: 'portal-messages', label: 'Portal Messages', capability: 'client.portal_messages', icon: MessageSquare },
  { value: 'finance-messages', label: 'Finance Messages', capability: 'client.finance_messages', icon: MessageSquare },
  { value: 'notes', label: 'Notes', capability: 'client.notes' },
  { value: 'reminders', label: 'Reminders', capability: 'client.reminders' },
  { value: 'formara-forms', label: 'Client Forms', capability: 'client.forms' },
  { value: 'files', label: 'Files', capability: 'client.files' },
  { value: 'activity', label: 'Activity / Documents', capability: 'client.activity' },
  { value: 'borrowing', label: 'Borrowing Capacity', capability: 'client.borrowing_capacity' },
  { value: 'commercial-industrial', label: 'Commercial / Industrial', capability: 'client.commercial_industrial' },
  { value: 'lenders', label: 'Lenders', capability: 'client.lenders' },
  { value: 'insights', label: 'AI', capability: 'client.ai' },
];

/** Header actions and the capability each requires. */
export const CLIENT_ACTION_CAPABILITIES = {
  downloadPdf: 'client.download_pdf',
  sendToFinance: 'client.send_to_finance',
  review: 'client.review',
  portfolioAnalysis: 'client.portfolio_analysis',
  sendPortfolio: 'client.send_portfolio',
  sendAgreement: 'client.send_agreement',
  portalAccess: 'client.portal_access',
  viewAsClient: 'client.view_as_client',
} as const satisfies Record<string, CapabilityKey>;

/**
 * Validate a requested tab (initialTab prop, URL/query deep link) against the
 * currently visible set. Invalid or unavailable values land on the first
 * visible tab rather than an empty pane.
 */
export function resolveClientTab(
  requested: string | null | undefined,
  visibleValues: readonly string[],
): string {
  if (requested && visibleValues.includes(requested)) return requested;
  return visibleValues[0] ?? 'overview';
}
