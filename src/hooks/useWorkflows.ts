/**
 * Saved workflows, read and written straight against Postgres under RLS.
 *
 * These used to go through the `manage-templates` broker so the `integrations`
 * module permission was checked server-side. That indirection turned out to be
 * the wrong trade: the broker keeps a hand-maintained `validTables` allow-list,
 * so the feature could not work until a *separate deployment* of a function
 * shared by 38 other call sites caught up with the migration that created these
 * tables. It didn't, and every "New workflow" returned `Invalid table:
 * workflows` — a deployment gap surfacing as a user-facing error.
 *
 * Talking to the table directly removes that coupling entirely. The access rule
 * is not weakened, it moves: `workflows` carries admin-or-superadmin policies on
 * all four verbs (`auth.uid()` against `user_roles`), so Postgres enforces on
 * every statement what the broker enforced on every call — and a new table
 * cannot be forgotten in an allow-list, because there isn't one.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import { EMPTY_GRAPH, type WorkflowGraph, type WorkflowRecord } from '@/lib/workflow/types';

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  graph: unknown;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Saved graphs come back as untyped JSON. Anything malformed degrades to an
 * empty graph so one bad row cannot stop the page rendering the rest.
 */
function toGraph(value: unknown): WorkflowGraph {
  if (!value || typeof value !== 'object') return EMPTY_GRAPH;
  const candidate = value as Partial<WorkflowGraph>;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return EMPTY_GRAPH;
  return { nodes: candidate.nodes, edges: candidate.edges };
}

const toRecord = (row: WorkflowRow): WorkflowRecord => ({
  id: row.id,
  name: row.name,
  description: row.description,
  graph: toGraph(row.graph),
  status: (['draft', 'live', 'paused'] as const).includes(row.status as never)
    ? (row.status as WorkflowRecord['status'])
    : 'draft',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * RLS answers "not allowed" by returning no rows on a read and a violation on a
 * write, neither of which says *why*. Naming the likely cause keeps the person
 * from hunting through their own graph for a problem that is in their access.
 */
const describe = (message: string | undefined, fallback: string): string => {
  const text = String(message ?? '');
  if (/row-level security|violates row-level/i.test(text)) {
    return 'You do not have permission to change workflows. An administrator can grant Integrations access from User Management.';
  }
  if (/JWT|not authenticated|invalid claim/i.test(text)) {
    return 'Your sign-in session has expired. Sign out, sign back in, and try again.';
  }
  return text || fallback;
};

export function useWorkflows() {
  const { supabase, isAuthenticated } = useAuthenticatedSupabase();
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Without a token every query is anonymous and RLS returns nothing, which
    // would render as "no workflows yet" rather than as a sign-in problem.
    // `loading` has to be cleared on the way out: it starts true, so returning
    // early left the library showing loading skeletons for ever — and the
    // effect re-runs the moment a session resolves, so nothing is lost.
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error: queryError } = await supabase
        .from('workflows')
        .select('id, name, description, graph, status, created_at, updated_at')
        .order('updated_at', { ascending: false });

      if (queryError) {
        setError(describe(queryError.message, 'Could not load workflows.'));
        return;
      }
      setWorkflows(((data ?? []) as WorkflowRow[]).map(toRecord));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load workflows.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (name: string, description?: string): Promise<WorkflowRecord | null> => {
      const { data, error: insertError } = await supabase
        .from('workflows')
        // The generated row types model `graph` as `Json`, which a structural
        // WorkflowGraph does not satisfy even though it round-trips exactly.
        // `toGraph` re-validates on the way back out, which is where it matters.
        .insert({
          name,
          description: description ?? null,
          graph: EMPTY_GRAPH as unknown as never,
          status: 'draft',
        })
        .select('id, name, description, graph, status, created_at, updated_at')
        .single();

      if (insertError || !data) {
        setError(describe(insertError?.message, 'Could not create the workflow.'));
        return null;
      }
      const record = toRecord(data as WorkflowRow);
      setWorkflows((current) => [record, ...current]);
      setError(null);
      return record;
    },
    [supabase],
  );

  const save = useCallback(
    async (id: string, changes: Partial<Pick<WorkflowRecord, 'name' | 'description' | 'graph' | 'status'>>) => {
      const { error: updateError } = await supabase
        .from('workflows')
        .update({ ...changes, updated_at: new Date().toISOString() } as never)
        .eq('id', id);

      if (updateError) {
        setError(describe(updateError.message, 'Could not save the workflow.'));
        return false;
      }
      setWorkflows((current) =>
        current.map((w) => (w.id === id ? { ...w, ...changes, updatedAt: new Date().toISOString() } : w)),
      );
      setError(null);
      return true;
    },
    [supabase],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error: deleteError } = await supabase.from('workflows').delete().eq('id', id);
      if (deleteError) {
        setError(describe(deleteError.message, 'Could not delete the workflow.'));
        return false;
      }
      setWorkflows((current) => current.filter((w) => w.id !== id));
      setError(null);
      return true;
    },
    [supabase],
  );

  return { workflows, loading, error, refresh, create, save, remove };
}
