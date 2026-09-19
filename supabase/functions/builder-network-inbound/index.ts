/**
 * Builders Network → this workspace: the delivery door (extraction plan §7
 * Phase 3). The byte-for-byte counterpart of the network's own inbound —
 * per-connection symmetric HMAC over the raw body, idempotent landing by
 * dedupe_key, privacy contract enforced on ARRIVAL (a sender that ships a
 * forbidden field has a composition bug; storing the survivable subset
 * would hide it), stamp updated monotonically.
 *
 * FLAG-GATED, and the refusal is 503 by NAME: while
 * feature_flags.builder_network_enabled is false this door answers
 * `network_disabled`, which the network's outbox worker treats as an
 * ordinary retryable failure — deliveries WAIT for the flag, they are
 * never lost to it.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { enforceRawBodyLimit } from '../_shared/requestSecurity.ts';
import {
  HMAC_CONNECTION_HEADER,
  verifyDelivery,
} from '../_shared/builderNetworkHmac.ts';
import {
  BuilderNetworkPrivacyViolation,
  assertPayloadCrossesClean,
} from '../_shared/builderNetworkPrivacy.pure.ts';
import { buildStamp } from '../_shared/builderNetworkStamp.pure.ts';
import { builderNetworkEnabled, connectionByNetworkId } from '../_shared/builderNetwork.ts';

const MAX_BODY_BYTES = 256 * 1024;

Deno.serve(async (req) => {
  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (!(await builderNetworkEnabled(supabase))) {
      return json({ error: 'network_disabled' }, 503);
    }

    const bounded = await enforceRawBodyLimit(req, MAX_BODY_BYTES);
    if (!bounded.ok) return bounded.error;

    const refuse = () => json({ error: 'delivery_refused' }, 401);

    const networkConnectionId = req.headers.get(HMAC_CONNECTION_HEADER) || '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(networkConnectionId)) {
      return refuse();
    }
    const connection = await connectionByNetworkId(supabase, networkConnectionId);
    if (!connection || connection.state !== 'active' || !connection.outbound_hmac_secret) {
      return refuse();
    }

    const verdict = await verifyDelivery(connection.outbound_hmac_secret, req.headers, bounded.raw);
    if (!verdict.ok) return refuse();

    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(bounded.raw) as Record<string, unknown>;
    } catch {
      return json({ error: 'invalid_envelope' }, 400);
    }
    const eventType = String(envelope.event_type || '').trim();
    const dedupeKey = String(envelope.dedupe_key || '').trim();
    const sourceVersion = Number(envelope.source_version ?? 0);
    if (!eventType || !dedupeKey || !Number.isFinite(sourceVersion)) {
      return json({ error: 'invalid_envelope' }, 400);
    }

    try {
      assertPayloadCrossesClean(envelope.payload ?? {});
    } catch (violation) {
      if (violation instanceof BuilderNetworkPrivacyViolation) {
        console.error('[builder-network-inbound] privacy violation', {
          connection: connection.id,
          event_type: eventType,
          paths: violation.paths.slice(0, 20),
        });
        return json({ error: 'privacy_contract_failed' }, 422);
      }
      throw violation;
    }

    const { error: insertError } = await supabase
      .from('builder_network_inbound_events')
      .insert({
        connection_id: connection.id,
        event_type: eventType,
        dedupe_key: dedupeKey,
        payload: envelope.payload ?? {},
        source_version: sourceVersion,
      });
    if (insertError) {
      if (String(insertError.code) === '23505') {
        return json({ accepted: true, duplicate: true });
      }
      console.error('[builder-network-inbound] insert failed', insertError);
      return json({ error: 'delivery_not_recorded' }, 500);
    }

    // The sweep converges; this door only LANDS. One opportunistic pass
    // keeps latency low; the pg_cron drive of the same idempotent function
    // is the guarantee, so a failure here is logged and the delivery still
    // answers accepted.
    const { error: applyError } = await supabase
      .rpc('builder_network_apply_inbound_events', { _limit: 25 });
    if (applyError) {
      console.error('[builder-network-inbound] opportunistic apply failed', applyError.message);
    }

    const { count } = await supabase
      .from('builder_network_inbound_events')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', connection.id)
      .is('processed_at', null);
    const { data: latest } = await supabase
      .from('builder_network_inbound_events')
      .select('received_at')
      .eq('connection_id', connection.id)
      .is('processed_at', null)
      .order('received_at', { ascending: false })
      .limit(1);
    const stamp = buildStamp({
      count: count ?? 0,
      latest: latest?.[0]?.received_at ?? null,
      pendingRequests: count ?? 0,
      attention: 0,
    });
    const { data: existingStamp } = await supabase
      .from('builder_network_stamps')
      .select('source_version')
      .eq('connection_id', connection.id)
      .eq('side', 'inbound')
      .maybeSingle();
    await supabase.from('builder_network_stamps').upsert({
      connection_id: connection.id,
      side: 'inbound',
      stamp,
      source_version: Math.max(Number(existingStamp?.source_version ?? 0), sourceVersion),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'connection_id,side' });

    return json({ accepted: true });
  } catch (error) {
    console.error('[builder-network-inbound] error', error);
    return json({ error: 'delivery_failed' }, 500);
  }
});
