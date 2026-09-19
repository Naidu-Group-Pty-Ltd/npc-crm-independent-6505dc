import { actorIsSuperadmin } from './authz.ts';

export async function canAccessClient(
  supabase: any,
  actor: { userId: string | null; authMethod?: string | null },
  clientId: string,
): Promise<boolean> {
  if (actor.authMethod === 'service_role' || actor.userId === 'service_role') return true;
  if (!actor.userId) return false;
  if (await actorIsSuperadmin(supabase, actor.userId)) return true;

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .or(`created_by.eq.${actor.userId},assigned_team_user_id.eq.${actor.userId}`)
    .maybeSingle();

  return Boolean(client);
}

/**
 * The verdict `canAccessClient` gives for every id, in a handful of round
 * trips instead of one per id.
 *
 * Audit item 36 — every CRM conversation was labelled "Unknown". The data was
 * fine: 802 of 804 rows carry a `client_id`, all 722 distinct ids exist as
 * client rows. The page resolves those names through `get-client-data`, which
 * authorised them with
 *
 *     for (const id of idsToFetch) { if (!await canAccessClient(...)) ... }
 *
 * — 722 sequential round trips, each carrying an `actorIsSuperadmin` read of
 * its own, on every load of the page. At 80ms each that is 58 seconds against
 * a browser that aborts at 60, so the name lookup failed, `clientMap` stayed
 * empty, and `clientMap[c.client_id]?.name || "Unknown"` did the rest — for
 * every row at once, which is what the report describes.
 *
 * The verdict here is IDENTICAL to the loop's, deliberately: all-or-nothing,
 * because a partial answer would turn this broker into an id oracle, which is
 * what the caller's comment says it must not become. Only the cost changes.
 *
 *   • The superadmin question is asked ONCE, not once per id.
 *   • Accessibility is one query per 100 ids rather than one per id, and the
 *     batches run together.
 *   • An empty list is accessible, matching a loop that never runs.
 */
export async function canAccessAllOf(
  supabase: any,
  actor: { userId: string | null; authMethod?: string | null },
  clientIds: readonly string[],
): Promise<boolean> {
  if (actor.authMethod === 'service_role' || actor.userId === 'service_role') return true;
  if (clientIds.length === 0) return true;
  if (!actor.userId) return false;
  if (await actorIsSuperadmin(supabase, actor.userId)) return true;

  const unique = [...new Set(clientIds)];
  // PostgREST puts an `in` list in the URL, and 722 uuids do not fit in one.
  const CHUNK = 100;
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK));

  const results = await Promise.all(chunks.map(async (chunk) => {
    const { data, error } = await supabase
      .from('clients')
      .select('id')
      .in('id', chunk)
      .or(`created_by.eq.${actor.userId},assigned_team_user_id.eq.${actor.userId}`);
    // A failed read is not an absent row. `canAccessClient` discards its error
    // and returns false, and denying on a database fault is the safe reading —
    // so this denies too, rather than letting a broken query read as access.
    if (error) return false;
    return (data ?? []).length === chunk.length;
  }));

  return results.every(Boolean);
}

export async function canAccessAllClients(
  supabase: any,
  actor: { userId: string | null; authMethod?: string | null },
): Promise<boolean> {
  return actor.authMethod === 'service_role' ||
    actor.userId === 'service_role' ||
    Boolean(actor.userId && await actorIsSuperadmin(supabase, actor.userId));
}
