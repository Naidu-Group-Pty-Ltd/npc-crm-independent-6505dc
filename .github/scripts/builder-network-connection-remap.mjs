/**
 * POINT THIS SIDE'S CONNECTION AT THE BUILDER WHOSE STOCK IT IS TO CARRY.
 *
 * WHAT WENT WRONG, measured 19 Sep 2026 by the two halves of the sync trace.
 * The transport is entirely healthy: 91 of 91 events delivered on the first
 * attempt, nothing pending, nothing dead, the network's three producer
 * triggers enabled, its composer current, the HMAC secret present and this
 * project's inbound URL correct. And this marketplace still draws no cards,
 * because the single connection serves organisation `00f9e45f` — Bob The
 * Builder, whose 205 items are all archived — while the 46 live properties
 * belong to `dfdbff19`, Mairandi Developers, created on the network at
 * 2026-09-18 08:53:46 with its stock at 09:26.
 *
 * The network's `builder_network_enqueue_stock_item` reaches a connection
 * only through `i.organisation_id = c.builder_organisation_id`, so nothing
 * has been composed for those 46 since they were created. Nothing failed;
 * an event that is never composed is indistinguishable from a builder who
 * changed nothing, which is why it ran a day with nothing reporting it.
 *
 * WHY THIS SIDE GOES FIRST, AND IT IS NOT A PREFERENCE.
 * `builder_network_apply_inbound_events` refuses a payload whose
 * organisation_id is not this connection's, as `organisation_mismatch` at
 * severity critical — and a refusal CONSUMES the event, stamping
 * `processed_at`, so it is never retried. If the network were re-pointed
 * first, its whole 47-event backfill would arrive at a clone that still
 * disagreed and be burnt. The network's own half of this repair refuses to
 * run until this side already names the target.
 *
 * WHAT IT WRITES: one column of one row, guarded by the value it replaces.
 * No secret moves, no event is touched, no mirrored stock row is written or
 * deleted. `statement()` accepts exactly one shape of UPDATE against exactly
 * this table, which is a property of this file rather than a promise about
 * how it is called. Reversible by its own inverse.
 *
 * Nothing archives as a result: the network's reconcile archives only rows of
 * the TARGET organisation that it did not list, and this mirror holds none of
 * that organisation's rows yet. The 1,019 already-archived rows belong to two
 * other builders and are not reachable by it.
 *
 * DRY RUN unless APPLY=true. Idempotent.
 *
 *   TARGET_ORGANISATION_ID=<uuid> node .github/scripts/builder-network-connection-remap.mjs
 *
 * Needs SUPABASE_ACCESS_TOKEN. The project is PROJECT_REF, else the one this
 * checkout's own supabase/config.toml names (`scripts/lib/projectRef.mjs`).
 * Never a literal: this file is on every clone's repository too.
 */
import { projectRef } from '../../scripts/lib/projectRef.mjs';

const REF = projectRef(process.env);
if (!REF) {
  console.error('::error::No Supabase project: set PROJECT_REF, or name one as project_id in supabase/config.toml.');
  process.exit(1);
}
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
if (!TOKEN) {
  console.error('::error::SUPABASE_ACCESS_TOKEN is not set — nothing can be read or written.');
  process.exit(1);
}
const APPLY = (process.env.APPLY || '') === 'true' || process.argv.includes('--apply');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ids are CHECKED, never quoted and hoped for. Thirty-six characters of hex
 * and hyphen can hold no quote, comma or operator, so a composed predicate
 * cannot become a second statement however the value arrived — and this one
 * arrives from a dispatch box a person types into.
 */
function checkedId(label, raw) {
  const value = String(raw || '').trim();
  if (!UUID.test(value)) {
    console.error(`::error::${label} must be a uuid`);
    process.exit(1);
  }
  return value.toLowerCase();
}
const TARGET_ORG = checkedId('TARGET_ORGANISATION_ID', process.env.TARGET_ORGANISATION_ID);

/**
 * SELECTS, AND ONE SHAPE OF UPDATE. Anything else is refused here rather than
 * at review time: this lane exists to move one mapping, and a lane that can
 * express more than its purpose is one that will eventually be used for more.
 */
const ALLOWED_UPDATE =
  /^\s*update\s+public\.builder_network_connections\s+set\s+builder_organisation_id\s*=\s*'[0-9a-f-]{36}'::uuid\s*,\s*updated_at\s*=\s*now\(\)\s+where\s+id\s*=\s*'[0-9a-f-]{36}'::uuid\s+and\s+state\s*=\s*'active'\s+and\s+builder_organisation_id\s*=\s*'[0-9a-f-]{36}'::uuid\s+returning\s+[^;]*$/i;

async function statement(label, text) {
  const isRead = /^\s*(select|with)\b/i.test(text);
  if (!isRead && !ALLOWED_UPDATE.test(text)) {
    throw new Error(`[${label}] refused: this lane runs SELECTs and one shape of UPDATE.`);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: text }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`[${label}] HTTP ${res.status}: ${body.slice(0, 400)}`);
  const parsed = JSON.parse(body);
  return Array.isArray(parsed) ? parsed : [];
}
const refuse = (why) => {
  console.error(`\n::error::REFUSED: ${why}`);
  process.exit(1);
};

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — connection re-point on ${REF}`);
console.log(`target organisation ${TARGET_ORG}\n`);

// --------------------------------------------------------------------------
// 1. THE CONNECTION. The only live one, never "the first of several".
// --------------------------------------------------------------------------
const rows = await statement('connections', `
  select id::text as id, state,
         network_connection_id::text   as network_connection_id,
         builder_organisation_id::text as organisation_id,
         (outbound_hmac_secret is not null)                       as has_secret,
         (network_inbound_url like '%/builder-network-inbound')   as url_shape_ok,
         coalesce(substring(network_inbound_url from '^https?://[^/]+'), '(none)') as network_origin
    from public.builder_network_connections
   where state <> 'revoked'
   order by created_at`);
if (!rows.length) refuse('no live connection on this side.');
if (rows.length > 1) {
  console.table(rows);
  refuse(`${rows.length} live connections — this lane moves one and will not choose.`);
}
const connection = rows[0];
console.log(`connection ${connection.id} (network ${connection.network_connection_id})`);
console.log(`  state=${connection.state} organisation=${connection.organisation_id}`);
console.log(`  secret=${connection.has_secret} network_origin=${connection.network_origin} shape_ok=${connection.url_shape_ok}`);
if (connection.state !== 'active') refuse(`connection is ${connection.state}, not active.`);

/*
 * THE IMAGE URL IS DERIVED FROM THIS FIELD, so a wrong one is not cosmetic.
 * `builder_network_apply_inbound_events` mints a mirrored image row only when
 * `network_inbound_url LIKE '%/builder-network-inbound'`, replacing that
 * suffix with `/builder-network-stock-image?id=`. Anything else and the stock
 * lands with no image at all and every card draws blank — a repair that looks
 * like it worked until somebody opens the page.
 */
if (!connection.url_shape_ok) {
  refuse('network_inbound_url is not the network\'s inbound door, so no mirrored row could carry an image.');
}

// --------------------------------------------------------------------------
// 2. WHAT THIS MIRROR HOLDS TODAY — printed, because the only thing that
//    makes this repair safe is that nothing of the target organisation's is
//    here to be reconciled away.
// --------------------------------------------------------------------------
const held = await statement('mirror', `
  select organisation_id::text as organisation_id,
         lifecycle_status,
         count(*) as items,
         max(updated_at) as last_updated
    from public.builder_network_stock_items
   group by 1, 2
   order by 3 desc`);
console.table(held);
const targetHere = held.filter((r) => r.organisation_id === TARGET_ORG);
console.log(targetHere.length
  ? `This mirror already holds ${targetHere.reduce((n, r) => n + Number(r.items), 0)} row(s) of the target.`
  : 'This mirror holds nothing of the target organisation — the network\'s reconcile can archive nothing.');

if (connection.organisation_id === TARGET_ORG) {
  console.log('\nAlready pointing there. Nothing to do on this side.');
  process.exit(0);
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing was written. Re-run with APPLY=true to re-point.');
  process.exit(0);
}

// --------------------------------------------------------------------------
// 3. THE RE-POINT — guarded by the value it replaces, so a row somebody else
//    moved in the meantime is not overwritten.
// --------------------------------------------------------------------------
const moved = await statement('remap',
  `update public.builder_network_connections set builder_organisation_id = '${TARGET_ORG}'::uuid, updated_at = now() `
  + `where id = '${connection.id}'::uuid and state = 'active' and builder_organisation_id = '${connection.organisation_id}'::uuid `
  + `returning id::text as id, builder_organisation_id::text as organisation_id`);
if (!moved.length) refuse('the connection was not re-pointed — it changed underneath this run.');
console.log(`\nre-pointed: ${JSON.stringify(moved[0])}`);

// --------------------------------------------------------------------------
// 4. ASSERTED BY EFFECT, never by what was sent.
// --------------------------------------------------------------------------
const after = await statement('verify', `
  select (select builder_organisation_id::text from public.builder_network_connections
           where id = '${connection.id}'::uuid)                       as now_serving,
         (select count(*) from public.builder_network_stock_items)    as mirror_rows,
         (select count(*) from public.builder_network_stock_items
           where lifecycle_status = 'active')                         as mirror_active,
         (select count(*) from public.builder_network_inbound_events
           where processed_at is null)                                as unprocessed_events`);
console.log(`\nafter: ${JSON.stringify(after[0] ?? {})}`);
if (String(after[0]?.now_serving) !== TARGET_ORG) {
  refuse('this side is not serving the target organisation.');
}
console.log('\nThis side now names the target. Run the network\'s re-point and backfill next;'
  + ' it reads this row and refuses if this step has not happened.');
