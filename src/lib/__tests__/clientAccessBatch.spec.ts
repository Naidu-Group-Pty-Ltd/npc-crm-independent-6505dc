/**
 * `canAccessAllOf` — the same verdict as the loop, at a fraction of the cost.
 *
 * Audit item 36 — every CRM conversation was labelled "Unknown". The data was
 * fine: 802 of 804 rows carry a `client_id` and all 722 distinct ids exist as
 * client rows. The names are resolved through `get-client-data`, which
 * authorised the caller-supplied ids with
 *
 *     for (const id of idsToFetch) { if (!await canAccessClient(...)) ... }
 *
 * — one sequential round trip per id, each carrying an `actorIsSuperadmin`
 * read of its own, on every load of the page. At 80ms apiece that is 58
 * seconds against a browser that aborts at 60. The lookup failed, `clientMap`
 * stayed empty, and `clientMap[c.client_id]?.name || "Unknown"` did the rest —
 * for every row at once, which is exactly what was reported.
 *
 * Because this is an authorization path, the point of these is that the
 * VERDICT is unchanged. Only the number of queries differs.
 */
import { describe, expect, it, vi } from 'vitest';

import { canAccessAllOf } from '../../../supabase/functions/_shared/clientAccess.ts';

/**
 * A Supabase stub that answers the two shapes this path uses: the superadmin
 * probe (`custom_users` / `user_roles`) and the accessibility query
 * (`clients` … `.in(...).or(...)`).
 */
function stubSupabase(opts: {
  superadmin?: boolean;
  accessibleIds?: string[];
  failClientsRead?: boolean;
}) {
  const calls = { clientsQueries: 0, superadminProbes: 0 };
  const accessible = new Set(opts.accessibleIds ?? []);

  const supabase = {
    from(table: string) {
      if (table === 'custom_users') {
        calls.superadminProbes++;
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: opts.superadmin ? 'superadmin' : 'agent' } }) }) }),
        };
      }
      if (table === 'user_roles') {
        return { select: () => ({ eq: async () => ({ data: [] }) }) };
      }
      if (table === 'clients') {
        calls.clientsQueries++;
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => ({
              or: async () => opts.failClientsRead
                ? { data: null, error: { message: 'boom' } }
                : { data: ids.filter((id) => accessible.has(id)).map((id) => ({ id })), error: null },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { supabase, calls };
}

const human = { userId: 'user-1', authMethod: 'human' };

describe('the verdict is the loop’s', () => {
  it('allows the service role without asking anything', async () => {
    const { supabase, calls } = stubSupabase({});
    expect(await canAccessAllOf(supabase, { userId: null, authMethod: 'service_role' }, ['a', 'b'])).toBe(true);
    expect(calls.clientsQueries).toBe(0);
  });

  it('allows an empty list, because a loop that never runs never refuses', async () => {
    const { supabase, calls } = stubSupabase({});
    expect(await canAccessAllOf(supabase, human, [])).toBe(true);
    expect(calls.clientsQueries).toBe(0);
  });

  it('refuses an anonymous caller', async () => {
    const { supabase } = stubSupabase({});
    expect(await canAccessAllOf(supabase, { userId: null }, ['a'])).toBe(false);
  });

  it('allows a superadmin', async () => {
    const { supabase, calls } = stubSupabase({ superadmin: true });
    expect(await canAccessAllOf(supabase, human, ['a', 'b', 'c'])).toBe(true);
    expect(calls.clientsQueries).toBe(0);
  });

  it('allows when every id is accessible', async () => {
    const { supabase } = stubSupabase({ accessibleIds: ['a', 'b'] });
    expect(await canAccessAllOf(supabase, human, ['a', 'b'])).toBe(true);
  });

  it('refuses the whole set when one id is not', async () => {
    // All-or-nothing, deliberately: a partial answer would turn the broker
    // into an id oracle, which is what its own comment says it must not be.
    const { supabase } = stubSupabase({ accessibleIds: ['a'] });
    expect(await canAccessAllOf(supabase, human, ['a', 'b'])).toBe(false);
  });

  it('refuses on a failed read rather than reading it as access', async () => {
    const { supabase } = stubSupabase({ accessibleIds: ['a'], failClientsRead: true });
    expect(await canAccessAllOf(supabase, human, ['a'])).toBe(false);
  });
});

describe('the cost', () => {
  it('asks the superadmin question once, not once per id', async () => {
    const { supabase, calls } = stubSupabase({
      accessibleIds: Array.from({ length: 300 }, (_, i) => `id-${i}`),
    });
    await canAccessAllOf(supabase, human, Array.from({ length: 300 }, (_, i) => `id-${i}`));
    expect(calls.superadminProbes).toBe(1);
  });

  it('batches 722 ids into a handful of queries, not 722', async () => {
    const ids = Array.from({ length: 722 }, (_, i) => `id-${i}`);
    const { supabase, calls } = stubSupabase({ accessibleIds: ids });
    expect(await canAccessAllOf(supabase, human, ids)).toBe(true);
    // 722 ids at 100 per query.
    expect(calls.clientsQueries).toBe(8);
  });

  it('collapses duplicates before asking', async () => {
    const { supabase, calls } = stubSupabase({ accessibleIds: ['a'] });
    expect(await canAccessAllOf(supabase, human, ['a', 'a', 'a'])).toBe(true);
    expect(calls.clientsQueries).toBe(1);
  });
});
