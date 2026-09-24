import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { formatFullName } from '@/utils/nameFormatting';
import { isAfter, startOfDay, subDays } from 'date-fns';
import {
  DEFAULT_REMINDER_PRIORITY,
  type ReminderPriority,
} from '@/lib/reminders/priority.pure';

export interface UnifiedReminder {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  /**
   * The column's own vocabulary, all four values of it.
   *
   * This used to read `'high' | 'medium' | 'low'`, which is narrower than
   * `client_reminders.priority`'s CHECK constraint and narrower than what
   * the reminder forms write. TypeScript then vouched for the hub's
   * three-key badge lookup as total, and an urgent reminder crashed the
   * page — see `lib/reminders/priority.pure`.
   */
  priority: ReminderPriority;
  status: 'pending' | 'completed' | 'snoozed';
  source: 'client_reminder' | 'follow_up' | 'deal_milestone';
  source_label: string;
  reminder_type: string;
  client_id: string | null;
  client_name: string;
  deal_id?: string;
  completed_at: string | null;
  created_at: string;
  // For mutations
  raw_source: 'client_reminders' | 'clients' | 'client_deals';
  raw_id: string;
}

export function useAllReminders() {
  return useQuery({
    queryKey: ['all-reminders'],
    queryFn: async (): Promise<UnifiedReminder[]> => {
      // Fetch all three data sources in parallel
      const [remindersRes, clientsRes, dealsRes] = await Promise.all([
        invokeSecureFunction('get-client-data', {
          listMode: true,
          listOptions: {
            table: 'client_reminders',
            select: '*',
            orderBy: 'due_date',
            orderAsc: true,
          },
        }),
        invokeSecureFunction('get-client-data', {
          mode: 'list',
          listOptions: {
            select: 'id, primary_first_name, primary_surname, follow_up_date',
            orderBy: 'follow_up_date',
            orderAsc: true,
          },
        }),
        invokeSecureFunction('get-client-data', {
          listMode: true,
          listOptions: {
            table: 'client_deals',
            select: 'id, client_id, deal_type, property_address, settlement_date, finance_clause_expiry, land_settlement_date, expected_build_start, estimated_completion, clawback_expiry_date, current_stage, critical_date_completions, created_at',
            orderBy: 'settlement_date',
            orderAsc: true,
          },
        }),
      ]);

      const reminders: any[] = remindersRes.data?.records || [];
      const clients: any[] = clientsRes.data?.clients || [];
      const deals: any[] = dealsRes.data?.records || [];

      // Build client name map
      const clientMap: Record<string, string> = {};
      for (const c of clients) {
        const cl = c.client || c;
        clientMap[c.id || cl.id] = formatFullName(cl.primary_first_name, cl.primary_surname) || 'Unknown';
      }

      const unified: UnifiedReminder[] = [];

      // 1) Client Reminders. Team-scoped rows live in the same table but
      // belong to the Team tab — without this guard a team reminder was
      // listed here too, tagged "Client Reminder".
      for (const r of reminders) {
        if (r.reminder_scope === 'team') continue;
        unified.push({
          id: `cr-${r.id}`,
          title: r.title,
          description: r.description,
          due_date: r.due_date,
          // `|| DEFAULT_…` restores the column's own default for a row with
          // none; it never re-labels a priority the row actually carries.
          priority: r.priority || DEFAULT_REMINDER_PRIORITY,
          status: r.status === 'completed' ? 'completed' : 'pending',
          source: 'client_reminder',
          // A reminder with no client is not a client reminder. The Email
          // Copilot's "Remind me" writes one for a thread that has no customer
          // behind it (`reminder_scope: 'personal'`), and calling it a client
          // reminder about "Unknown" invents a customer who does not exist.
          source_label: r.client_id ? 'Client Reminder' : 'Personal Reminder',
          reminder_type: r.reminder_type || 'general',
          client_id: r.client_id,
          client_name: r.client_id ? (clientMap[r.client_id] || 'Unknown') : '',
          completed_at: r.completed_at,
          created_at: r.created_at,
          raw_source: 'client_reminders',
          raw_id: r.id,
        });
      }

      // 2) Client Follow-Ups
      for (const c of clients) {
        const cl = c.client || c;
        const followUpDate = cl.follow_up_date || c.follow_up_date;
        if (!followUpDate) continue;
        const clientId = c.id || cl.id;
        unified.push({
          id: `fu-${clientId}`,
          title: `Follow up with ${clientMap[clientId] || 'client'}`,
          description: null,
          due_date: followUpDate,
          priority: DEFAULT_REMINDER_PRIORITY,
          status: 'pending',
          source: 'follow_up',
          source_label: 'Client Follow-Up',
          reminder_type: 'follow_up',
          client_id: clientId,
          client_name: clientMap[clientId] || 'Unknown',
          completed_at: null,
          created_at: followUpDate,
          raw_source: 'clients',
          raw_id: clientId,
        });
      }

      // 3) Deal Milestones
      const milestoneFields: { field: string; label: string; type: string; priority: ReminderPriority }[] = [
        { field: 'settlement_date', label: 'Settlement', type: 'settlement', priority: 'high' },
        { field: 'finance_clause_expiry', label: 'Finance Clause Expiry', type: 'finance', priority: 'high' },
        { field: 'land_settlement_date', label: 'Land Settlement', type: 'settlement', priority: 'high' },
        { field: 'expected_build_start', label: 'Build Start', type: 'construction', priority: 'medium' },
        { field: 'estimated_completion', label: 'Estimated Completion', type: 'construction', priority: 'medium' },
        { field: 'clawback_expiry_date', label: 'Clawback Expiry', type: 'clawback', priority: 'high' },
      ];

      for (const deal of deals) {
        const clientName = clientMap[deal.client_id] || 'Unknown';
        const address = deal.property_address || deal.current_stage || '';
        /**
         * Which of this deal's critical dates have been marked done.
         *
         * A milestone is synthesised from a date COLUMN, so it has no row of
         * its own and no status of its own — and `status` here was the literal
         * `'pending'`. The client card's Critical Dates panel records
         * completion in `client_deals.critical_date_completions`, keyed by the
         * same column name, and this hook simply never read it: an operator
         * ticked "Done" on the finance clause expiry and the reminder stayed
         * on the Reminders page for ever. (19 Sep 2026 clone audit.)
         *
         * The shape is read defensively because it is JSONB: a row written
         * before the panel existed holds null.
         */
        const completions: Record<string, unknown> =
          deal.critical_date_completions && typeof deal.critical_date_completions === 'object'
            && !Array.isArray(deal.critical_date_completions)
            ? deal.critical_date_completions
            : {};

        for (const m of milestoneFields) {
          const dateVal = deal[m.field];
          if (!dateVal) continue;
          const completedAt = typeof completions[m.field] === 'string' ? (completions[m.field] as string) : null;

          unified.push({
            id: `dm-${deal.id}-${m.field}`,
            title: `${m.label} — ${clientName}`,
            description: address ? `Property: ${address}` : null,
            due_date: dateVal,
            priority: m.priority,
            status: completedAt ? 'completed' : 'pending',
            source: 'deal_milestone',
            source_label: 'Deal Milestone',
            reminder_type: m.type,
            client_id: deal.client_id,
            client_name: clientName,
            deal_id: deal.id,
            completed_at: completedAt,
            created_at: deal.created_at || dateVal,
            raw_source: 'client_deals',
            raw_id: deal.id,
          });
        }
      }

      // Filter: only show items from yesterday onward (keep overdue visible)
      const cutoff = startOfDay(subDays(new Date(), 7));
      const filtered = unified.filter(r => {
        if (r.status === 'completed') return false;
        return isAfter(new Date(r.due_date), cutoff);
      });

      // Sort by due_date ascending
      filtered.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());

      return filtered;
    },
    staleTime: 30000,
  });
}
