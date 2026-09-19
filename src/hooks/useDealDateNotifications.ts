import { useEffect, useRef } from 'react';
import { useNotifications } from '@/contexts/NotificationsContext';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { differenceInDays, isPast } from 'date-fns';

interface DealRecord {
  id: string;
  client_id: string;
  deal_type: string;
  finance_clause_expiry: string | null;
  settlement_date: string | null;
  land_settlement_date: string | null;
  expected_build_start: string | null;
  estimated_completion: string | null;
}

/**
 * Hook that monitors deal critical dates and triggers notifications
 * for dates that are approaching (within 7 days) or overdue.
 */
export function useDealDateNotifications() {
  const { addNotification } = useNotifications();
  const processedKeys = useRef<Set<string>>(new Set());
  const lastCheckRef = useRef<string | null>(null);

  useEffect(() => {
    const checkDealDates = async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().split('T')[0];

      if (lastCheckRef.current === todayStr) return;

      try {
        // Fetch all deals via the secure edge function
        const { data, error } = await invokeSecureFunction('get-client-data', {
          listMode: true,
          listOptions: {
            table: 'client_deals',
            select: 'id,client_id,deal_type,finance_clause_expiry,settlement_date,land_settlement_date,expected_build_start,estimated_completion',
            orderBy: 'created_at',
            orderAsc: false,
          },
        });

        if (error || !data?.success) {
          console.error('[DealDateNotifications] Error fetching deals:', error);
          return;
        }

        const deals: DealRecord[] = data.records || [];
        if (deals.length === 0) {
          lastCheckRef.current = todayStr;
          return;
        }

        // Fetch client names
        const clientIds = [...new Set(deals.map(d => d.client_id))];
        const { data: clientsData } = await invokeSecureFunction('get-client-data', {
          clientIds,
          include: { client: true, properties: false, employment: false, income: false, assets: false, liabilities: false, expenses: false },
        });

        const clientMap: Record<string, string> = {};
        if (clientsData?.success && clientsData.clients) {
          for (const c of clientsData.clients) {
            if (c.client) {
              clientMap[c.id] = [c.client.primary_first_name, c.client.primary_surname].filter(Boolean).join(' ') || 'Unknown';
            }
          }
        }

        // Define which date fields to check
        const dateChecks: {
          key: keyof DealRecord;
          label: string;
          warningType: 'deal_finance_expiry_warning' | 'deal_settlement_warning' | 'deal_build_date_warning';
          overdueType: 'deal_finance_expiry_overdue' | 'deal_settlement_overdue' | 'deal_build_date_warning';
          showFor: 'all' | 'house_and_land';
        }[] = [
          { key: 'finance_clause_expiry', label: 'Finance Clause Expiry', warningType: 'deal_finance_expiry_warning', overdueType: 'deal_finance_expiry_overdue', showFor: 'all' },
          { key: 'settlement_date', label: 'Settlement Date', warningType: 'deal_settlement_warning', overdueType: 'deal_settlement_overdue', showFor: 'all' },
          { key: 'land_settlement_date', label: 'Land Settlement Date', warningType: 'deal_settlement_warning', overdueType: 'deal_settlement_overdue', showFor: 'house_and_land' },
          { key: 'expected_build_start', label: 'Expected Build Start', warningType: 'deal_build_date_warning', overdueType: 'deal_build_date_warning', showFor: 'house_and_land' },
          { key: 'estimated_completion', label: 'Estimated Completion', warningType: 'deal_build_date_warning', overdueType: 'deal_build_date_warning', showFor: 'house_and_land' },
        ];

        for (const deal of deals) {
          const clientName = clientMap[deal.client_id] || 'Unknown Client';

          for (const check of dateChecks) {
            if (check.showFor === 'house_and_land' && deal.deal_type !== 'house_and_land') continue;

            const dateStr = deal[check.key] as string | null;
            if (!dateStr) continue;

            const uniqueKey = `${deal.id}_${check.key}`;
            if (processedKeys.current.has(uniqueKey)) continue;

            const date = new Date(dateStr);
            date.setHours(0, 0, 0, 0);
            const daysAway = differenceInDays(date, today);

            // Notify if overdue or within 7 days
            if (isPast(date)) {
              processedKeys.current.add(uniqueKey);
              await addNotification({
                type: check.overdueType,
                title: `Overdue: ${check.label}`,
                message: `${clientName}'s ${check.label.toLowerCase()} was due on ${date.toLocaleDateString('en-AU')}`,
                entityId: deal.client_id,
              });
            } else if (daysAway <= 7) {
              processedKeys.current.add(uniqueKey);
              await addNotification({
                type: check.warningType,
                title: `${check.label} in ${daysAway} day${daysAway !== 1 ? 's' : ''}`,
                message: `${clientName}'s ${check.label.toLowerCase()} is on ${date.toLocaleDateString('en-AU')}`,
                entityId: deal.client_id,
              });
            }
          }
        }

        lastCheckRef.current = todayStr;
      } catch (err) {
        console.error('[DealDateNotifications] Error:', err);
      }
    };

    checkDealDates();
    const interval = setInterval(checkDealDates, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [addNotification]);
}
