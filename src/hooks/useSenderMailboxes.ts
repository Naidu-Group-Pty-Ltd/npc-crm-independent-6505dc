/**
 * The accounts this person may send email as — asked of the function that
 * decides, rather than assembled in a composer.
 *
 * ## Why it is a round trip rather than a table read
 *
 * `send-email-reply` resolves the sending mailbox server-side from exactly two
 * facts: `custom_users.personal_mailbox` for the authenticated user, and the
 * MICROSOFT_MAILBOX_EMAIL secret for the organisation's shared mailbox. The
 * second of those is a secret; a browser cannot read it. So every composer in
 * the product built its own list from the half it could see, and put the label
 * "Organisation shared mailbox" where the address belongs — a person sending a
 * client's report could not tell which account it would arrive from.
 *
 * The composers also disagreed with the server about *whose* mailboxes to
 * offer. Several select every row in `custom_users` with a personal mailbox
 * set, so a staff member is shown colleagues' addresses; the send then fails
 * 403, because `senderMailboxId` must equal the authenticated user. This hook
 * asks the send function itself, so the list is what will be accepted.
 *
 * The server remains the authority either way: choosing an identity here does
 * not grant it, and `send-email-reply` re-checks the selection on every send.
 */
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface SenderMailbox {
  /**
   * `custom_users.id` for a personal mailbox — the value the send path
   * authorises against — or the literal `'admin'` for the shared mailbox.
   */
  id: string;
  source: 'personal' | 'admin';
  /** The address the email will actually leave from. */
  emailAddress: string;
  /** A person or the organisation, never a repeat of the address. */
  displayName: string;
  isDefault: boolean;
}

export function useSenderMailboxes(enabled = true) {
  const query = useQuery<SenderMailbox[]>({
    queryKey: ['sender-mailboxes'],
    enabled,
    // Mailboxes change when an administrator edits a profile, not between two
    // openings of a composer.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('send-email-reply', { action: 'list_senders' });
      if (error) throw new Error(error.message || 'Unable to retrieve authorised sending accounts');
      if (!data?.success) throw new Error(data?.error || 'Unable to retrieve authorised sending accounts');
      return (data.senders || []) as SenderMailbox[];
    },
  });

  const mailboxes = query.data ?? [];
  return {
    mailboxes,
    defaultMailbox: mailboxes.find((mailbox) => mailbox.isDefault) ?? mailboxes[0],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
}
