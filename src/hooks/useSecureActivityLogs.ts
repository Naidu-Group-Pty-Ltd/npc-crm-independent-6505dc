import { useState, useCallback } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';

export interface ActivityLog {
  id: string;
  user_id: string | null;
  username: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface ActivityStats {
  eventsToday: number;
  uniqueUsers: number;
  topAction: { type: string; count: number } | null;
  failures: number;
  sampleSize: number;
  sampleCapped: boolean;
}

interface FetchLogsOptions {
  actionFilter?: string | string[];
  entityFilter?: string | string[];
  userFilter?: string | string[];
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
  limit?: number;
  includeStats?: boolean;
}

interface FetchLogsResult {
  logs: ActivityLog[];
  uniqueUsers: string[];
  total: number;
  stats: ActivityStats | null;
  error: string | null;
}

export function useSecureActivityLogs() {
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async (options: FetchLogsOptions = {}): Promise<FetchLogsResult> => {
    setLoading(true);

    try {
      const { data, error } = await invokeSecureFunction('get-activity-logs', {
        action_filter: options.actionFilter,
        entity_filter: options.entityFilter,
        user_filter: options.userFilter,
        start_date: options.startDate,
        end_date: options.endDate,
        page: options.page,
        page_size: options.pageSize,
        limit: options.limit,
        include_stats: options.includeStats !== false,
      });

      if (error) {
        console.error('[useSecureActivityLogs] Edge function error:', error);
        return { logs: [], uniqueUsers: [], total: 0, stats: null, error: error.message };
      }

      if (!data?.success) {
        const errorMsg = data?.error || 'Failed to fetch activity logs';
        return { logs: [], uniqueUsers: [], total: 0, stats: null, error: errorMsg };
      }

      return {
        logs: data.logs as ActivityLog[],
        uniqueUsers: data.uniqueUsers as string[],
        total: (data.total as number) ?? (data.logs?.length ?? 0),
        stats: (data.stats as ActivityStats) ?? null,
        error: null,
      };
    } catch (error) {
      console.error('[useSecureActivityLogs] Unexpected error:', error);
      return { logs: [], uniqueUsers: [], total: 0, stats: null, error: 'Failed to fetch activity logs' };
    } finally {
      setLoading(false);
    }
  }, []);

  return { fetchLogs, loading };
}
