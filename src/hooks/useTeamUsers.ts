import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { isAssignablePerson } from '@/lib/team/assignablePerson.pure';

export interface TeamUser {
  id: string;
  username: string;
  email: string | null;
  is_active: boolean;
}

/**
 * Fetches all active team members from custom_users via the secure edge function.
 * Used for assigning reminders and deals to specific users.
 */
export function useTeamUsers() {
  return useQuery({
    queryKey: ['team-users'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'custom_users',
        listOptions: {
          select: 'id, username, email, is_active',
          filters: { is_active: true },
          orderBy: 'username',
          orderAsc: true,
        },
      });

      if (error) throw error;
      // Edge function returns { success, records, count }
      const records = data?.records || data || [];
      // Seeded compliance accounts are addressed at reserved domains that
      // resolve nowhere, so an invite to one could never arrive. They were
      // being offered as meeting attendees (audit item 28). Filtered here
      // rather than deleted: both hold real AML case history.
      return (Array.isArray(records) ? records : [])
        .filter((user: TeamUser) => isAssignablePerson(user)) as TeamUser[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
