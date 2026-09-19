/**
 * Which Finance Partners could receive *this client's* report.
 *
 * ## Why this is not `useFinanceContacts`
 *
 * `useFinanceContacts` lists the organisation's finance contacts. That is the
 * right list for Settings, and it was the wrong list for a send: a contact is a
 * portal identity, and `share-report-with-finance` refuses one that has no
 * portal account, is not assigned to the client, or may not see that client's
 * documents. Nothing on screen knew any of that, so the menus named a recipient
 * by taking the first contact row — and in production not one contact is
 * flagged default, which made "first row" mean insertion order. The partner
 * that produced has no portal account, so every send under that name was
 * refused after the document had been rendered.
 *
 * This hook asks `share-report-with-finance` itself, which answers from the
 * same module it enforces with. A partner listed as eligible here is one that
 * function will accept.
 */
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export type FinanceRecipientBlockReason =
  | 'contact_inactive'
  | 'no_portal_account'
  | 'portal_account_revoked'
  | 'not_assigned_to_client'
  | 'documents_not_permitted';

export interface FinanceReportRecipient {
  id: string;
  name: string;
  email: string;
  company: string | null;
  /** Assigned to this client in the Finance Portal — the platform's own answer. */
  is_assigned_to_client: boolean;
  /** `clients.finance_contact_id` — the typed answer, which can disagree. */
  is_client_finance_contact: boolean;
  eligible: boolean;
  blocked_reason: FinanceRecipientBlockReason | null;
  blocked_message: string | null;
}

export function useFinanceReportRecipients(clientId: string | undefined, enabled = true) {
  const query = useQuery<FinanceReportRecipient[]>({
    queryKey: ['finance-report-recipients', clientId],
    enabled: enabled && !!clientId,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('share-report-with-finance', {
        action: 'list_recipients',
        client_id: clientId,
      });
      if (error) throw new Error(error.message || 'Unable to load finance partners');
      if (!data?.success) throw new Error(data?.error || 'Unable to load finance partners');
      return (data.recipients || []) as FinanceReportRecipient[];
    },
  });

  const recipients = query.data ?? [];
  const eligible = recipients.filter((recipient) => recipient.eligible);

  /**
   * The partner to open on. Assignment first, because that is what authorises
   * the send; the typed `finance_contact_id` second; then the only eligible
   * partner there is. A single *ineligible* partner is never preselected — it
   * would put the same name in front of someone that the old menu did.
   */
  const suggested =
    eligible.find((recipient) => recipient.is_assigned_to_client && recipient.is_client_finance_contact) ??
    eligible.find((recipient) => recipient.is_assigned_to_client) ??
    eligible.find((recipient) => recipient.is_client_finance_contact) ??
    (eligible.length === 1 ? eligible[0] : undefined);

  return {
    recipients,
    eligible,
    suggested,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
