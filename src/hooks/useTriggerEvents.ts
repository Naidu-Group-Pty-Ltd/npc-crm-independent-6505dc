/**
 * Captured platform events, filtered to the ones this workflow would act on.
 *
 * "Live" is otherwise unobservable: a workflow is armed, something happens in
 * the business, and nothing on screen changes. Showing the events its triggers
 * accepted — and, just as usefully, that none arrived — is what turns the status
 * from a claim into something checkable.
 *
 * Matching happens here rather than in the query because the rule is not
 * expressible in SQL: a trigger's config narrows it (`toStatus: 'settled'`,
 * `minDurationSeconds: 60`), and that rule already exists, tested, in
 * `runtime/triggerMatch.ts`. Re-implementing it as a `where` clause would give
 * two answers to one question.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { matchTrigger, type TriggerEvent } from '@/lib/workflow/runtime/triggerMatch';
import type { WorkflowGraph } from '@/lib/workflow/types';

export interface CapturedEvent {
  id: string;
  triggerType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  status: string;
  attempts: number;
  lastError: string | null;
}

interface EventRow {
  id: string;
  trigger_type: string;
  payload: unknown;
  occurred_at: string;
  status: string;
  attempts: number;
  last_error: string | null;
}

/** Enough to show a pattern without turning the panel into a log viewer. */
const LIMIT = 25;

const toEvent = (row: EventRow): CapturedEvent => ({
  id: row.id,
  triggerType: row.trigger_type,
  payload: (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>,
  occurredAt: row.occurred_at,
  status: row.status,
  attempts: row.attempts ?? 0,
  lastError: row.last_error,
});

export function useTriggerEvents(graph: WorkflowGraph, status: string) {
  const { supabase, isAuthenticated } = useAuthenticatedSupabase();
  const [events, setEvents] = useState<CapturedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  /** Everything captured, not just this workflow's — context for an empty list. */
  const [totalCaptured, setTotalCaptured] = useState(0);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      // `workflow_trigger_events` postdates the generated Database types, so the
      // typed client has no overload for it. Narrowed to the row shape above on
      // the way out, which is the part that has to be right.
      const client = supabase as unknown as {
        from: (table: string) => {
          select: (columns: string, options?: { count?: 'exact' }) => {
            order: (column: string, options: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: EventRow[] | null; count: number | null }>;
            };
          };
        };
      };

      const { data, count } = await client
        .from('workflow_trigger_events')
        .select('id, trigger_type, payload, occurred_at, status, attempts, last_error', { count: 'exact' })
        .order('occurred_at', { ascending: false })
        .limit(200);

      const captured = ((data ?? []) as EventRow[]).map(toEvent);
      setTotalCaptured(count ?? captured.length);

      // Ask the same matcher the dispatcher would, so what is listed here is
      // exactly what would run — including a filter that excludes everything.
      const mine = captured.filter((event) => {
        const candidate: TriggerEvent = { triggerType: event.triggerType, payload: event.payload };
        return matchTrigger(candidate, [{ workflowId: 'self', status, graph }]).length > 0;
      });

      setEvents(mine.slice(0, LIMIT));
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [graph, isAuthenticated, status, supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { events, loading, totalCaptured, refresh };
}
