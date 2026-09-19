/**
 * Builders Network — the clone side's one entry point (extraction plan §7
 * Phase 3).
 *
 * Everything network-facing on this workspace resolves through here: the
 * flag, the connection rows, and the queue writer. Three rules:
 *
 *  * **The flag is read SERVER-SIDE and fails closed.** A browser read of
 *    feature_flags returns [] for anon and coerces every flag false — the
 *    trap this platform hit three times (useAmlV3Flags et al.). This module
 *    runs only in edge functions with the service role, and an unreadable
 *    flag is OFF, because a sync plane must never run on a guess.
 *
 *  * **The mirror is a boundary, not a cache.** `builder_network_connections`
 *    records this workspace's links; the NETWORK is authoritative for state.
 *    Nothing here invents a connection.
 *
 *  * **Queueing goes through the privacy gate, and the gate THROWS.** The
 *    forbidden families (client PII, internal notes, staff identity, other
 *    connections, cost/margin, AML) are `builderNetworkPrivacy.pure.ts`,
 *    byte-identical with the network's copy — one contract, two ends.
 */
import { assertPayloadCrossesClean } from './builderNetworkPrivacy.pure.ts';

export const BUILDER_NETWORK_FLAG = 'builder_network_enabled';

/** OFF unless the row exists, reads true, and the read SUCCEEDED. */
export async function builderNetworkEnabled(supabase: any): Promise<boolean> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('value')
    .eq('key', BUILDER_NETWORK_FLAG)
    .maybeSingle();
  if (error || !data) return false;
  return data.value === true;
}

export interface BuilderNetworkConnection {
  id: string;
  network_connection_id: string;
  builder_org_label: string | null;
  state: 'invited' | 'active' | 'revoked';
  scopes: string[];
  outbound_hmac_secret: string | null;
  network_inbound_url: string | null;
}

const CONNECTION_SELECT = `id, network_connection_id, builder_org_label, state,
  scopes, outbound_hmac_secret, network_inbound_url`;

/** Resolve one connection by the network's shared id. */
export async function connectionByNetworkId(
  supabase: any,
  networkConnectionId: string,
): Promise<BuilderNetworkConnection | null> {
  if (!networkConnectionId) return null;
  const { data } = await supabase
    .from('builder_network_connections')
    .select(CONNECTION_SELECT)
    .eq('network_connection_id', networkConnectionId)
    .maybeSingle();
  return (data as BuilderNetworkConnection | null) ?? null;
}

/** Every ACTIVE connection carrying a given scope. */
export async function activeConnectionsWithScope(
  supabase: any,
  scopeKey: string,
): Promise<BuilderNetworkConnection[]> {
  const { data } = await supabase
    .from('builder_network_connections')
    .select(CONNECTION_SELECT)
    .eq('state', 'active')
    .contains('scopes', [scopeKey]);
  return (data as BuilderNetworkConnection[] | null) ?? [];
}

/**
 * Queue one event for the network. The privacy gate runs HERE, at compose
 * time, so a forbidden payload fails the caller loudly instead of
 * dead-lettering later — and the worker gates AGAIN before the wire,
 * because two ends of a queue can disagree about what was deployed.
 * Idempotent by dedupe_key; a duplicate is the success it already was.
 */
export async function queueBuilderNetworkEvent(
  supabase: any,
  input: {
    connectionId: string;
    eventType: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
    sourceVersion: number;
  },
): Promise<{ ok: true; duplicate: boolean } | { ok: false; error: string }> {
  assertPayloadCrossesClean(input.payload);
  const { error } = await supabase.from('builder_network_outbox').insert({
    connection_id: input.connectionId,
    event_type: input.eventType,
    dedupe_key: input.dedupeKey,
    payload: input.payload,
    source_version: input.sourceVersion,
  });
  if (!error) return { ok: true, duplicate: false };
  if (String(error.code) === '23505') return { ok: true, duplicate: true };
  return { ok: false, error: error.message ?? 'insert_failed' };
}
