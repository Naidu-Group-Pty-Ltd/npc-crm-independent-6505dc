/**
 * WHY THE BUILDER NETWORK MIRROR STOPPED MOVING. Read-only, this side only.
 *
 * WHAT IT IS FOR. The mirror holds 1,019 rows, every one of them `archived`,
 * none touched since 18 Sep 2026 01:31 — and the Builder Stock page therefore
 * draws nothing at all. That is a symptom with at least seven candidate
 * causes, and each of them reports as ordinary quiet operation: a flag that
 * is off answers 503 and the network's queue simply waits; a connection that
 * was never given a URL is RELEASED rather than dead; an unprocessed inbound
 * event looks exactly like an inbox nobody has written to.
 *
 * So this prints the chain in order, on THIS database, and names the first
 * link that is not doing its job. Its network-side counterpart is
 * `scripts/ops/network-sync-state.ts` on `aurixa-builders`; the two together
 * are the trace, because a stopped mirror can be caused on either side and
 * neither database can see the other.
 *
 * WRITES NOTHING, AND CANNOT. `sql()` refuses any statement that does not
 * begin with `select` or `with` — a property of this file rather than a
 * promise about how it is called, the same guard `builder-stock-mirror-state.mjs`
 * has. It does not call the apply function, does not touch the flag, and
 * does not deliver anything: the whole point of this pass is to establish the
 * broken step BEFORE anything changes, because a repair applied first
 * destroys the evidence that would have named it.
 *
 * NOTHING SENSITIVE IS PRINTED. An HMAC secret is reported as present or
 * absent and never echoed; a URL is reported as its origin and path.
 *
 *   node .github/scripts/builder-network-sync-state.mjs
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
  console.error('::error::SUPABASE_ACCESS_TOKEN is not set — nothing can be read.');
  process.exit(1);
}

/** SELECT only. The label is logged; the statement never is. */
async function sql(label, text) {
  if (!/^\s*(select|with)\b/i.test(text)) {
    throw new Error(`[${label}] refused: this lane runs SELECT statements only.`);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: text }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 400)}`);
  const parsed = JSON.parse(body);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * A SECTION THAT CANNOT BE READ SAYS SO AND THE TRACE CONTINUES.
 *
 * A missing table or a renamed column is itself a finding here — this
 * repository's own history records a class of defect where a column that does
 * not exist reads exactly like a row that is absent — so one failing question
 * must never cost the other twelve answers.
 */
const findings = [];
async function section(title, text) {
  console.log(`\n${'='.repeat(92)}\n${title}\n${'='.repeat(92)}`);
  try {
    const rows = await sql(title, text);
    if (!rows.length) console.log('  (no rows)');
    else console.table(rows);
    return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  COULD NOT BE READ: ${message}`);
    findings.push(`${title}: ${message}`);
    return null;
  }
}

const one = (rows, key, fallback = null) =>
  (rows && rows.length && rows[0][key] !== undefined ? rows[0][key] : fallback);

console.log(`Builder Network inbound trace — project ${REF} — ${new Date().toISOString()}`);
console.log('READ-ONLY. Nothing below writes, applies, delivers or re-enables anything.');

// ---------------------------------------------------------------------------
// 1. THE DOOR'S OWN GATE. `builder-network-inbound` answers 503
//    `network_disabled` while this flag is false, and the network's worker
//    treats that as retryable — so a false flag stops the mirror with a queue
//    that is patiently full rather than an error anywhere.
// ---------------------------------------------------------------------------
/*
 * THE TWO FLAGS ARE READ BY DIFFERENT RULES, so both readings are printed
 * rather than one column called "enabled". `builderNetworkEnabled` requires
 * `value === true` EXACTLY, while `coerceFlagEnabled` — which the Builder
 * Stock tab uses — also accepts `"true"` and `{ "enabled": true }`. A row
 * holding `{"enabled": true}` is therefore a flag an operator believes is on,
 * that draws the tab, and that the network door still refuses; measuring one
 * rule and labelling it the other is how a lane comes to disagree with the
 * product it is measuring.
 */
const flag = await section('1. feature_flags — the two gates, each read its own way', `
  select key,
         value::text             as raw_value,
         jsonb_typeof(value)     as value_type,
         (value = 'true'::jsonb) as strict_true_inbound_door,
         (value = 'true'::jsonb
          or value = '"true"'::jsonb
          or value -> 'enabled' = 'true'::jsonb) as coerced_marketplace_tab,
         updated_at
  from public.feature_flags
  where key ilike 'builder_network%' or key ilike 'builder_stock%'
  order by key
`);

// ---------------------------------------------------------------------------
// 2. THE CONNECTION THIS SIDE HOLDS. The inbound door looks a delivery up by
//    the NETWORK's connection id and refuses anything that is not `active`
//    with a secret; the apply sweep then reads `builder_organisation_id` as
//    the authority over which organisation's stock may land.
// ---------------------------------------------------------------------------
const conn = await section('2. builder_network_connections (every column but the secret)', `
  select jsonb_pretty(
           (to_jsonb(c) - 'outbound_hmac_secret')
           || jsonb_build_object(
                'has_hmac_secret',
                (c.outbound_hmac_secret is not null and length(c.outbound_hmac_secret) > 0),
                'inbound_url_shape_ok',
                (c.network_inbound_url like '%/builder-network-inbound'))
         ) as connection
  from public.builder_network_connections c
  order by c.created_at
`);
if (conn) for (const row of conn) console.log(row.connection);

// ---------------------------------------------------------------------------
// 3. THE INBOX. Whether anything is arriving at all, and whether what arrived
//    was applied. An unprocessed row means the door works and the sweep does
//    not; no recent row at all means nothing is being delivered to the door.
// ---------------------------------------------------------------------------
await section('3. builder_network_inbound_events — by type and state', `
  select event_type,
         (processed_at is not null) as processed,
         count(*)                   as events,
         min(received_at)           as first_received,
         max(received_at)           as last_received,
         max(processed_at)          as last_processed,
         min(source_version)        as min_version,
         max(source_version)        as max_version
  from public.builder_network_inbound_events
  group by 1, 2
  order by 1, 2
`);

await section('3b. the twenty most recent inbound events', `
  select event_type,
         received_at,
         processed_at,
         source_version,
         left(dedupe_key, 68) as dedupe_key,
         octet_length(payload::text) as payload_bytes
  from public.builder_network_inbound_events
  order by received_at desc
  limit 20
`);

await section('3c. apply outcome columns, where this schema carries them', `
  select coalesce(apply_error, '(none)') as apply_error,
         count(*)          as events,
         max(apply_attempts) as max_attempts,
         max(received_at)  as last_received
  from public.builder_network_inbound_events
  group by 1
  order by 2 desc
`);

// ---------------------------------------------------------------------------
// 4. THE SWEEP'S DRIVER. pg_cron reports on the SQL it queued, so a green run
//    here is evidence the function was CALLED, never that an event moved.
// ---------------------------------------------------------------------------
await section('4. cron.job — the inbound sweep', `
  select jobid, jobname, schedule, active, database, username
  from cron.job
  where jobname ilike '%builder%' or command ilike '%builder_network%'
  order by jobname
`);

await section('4b. cron.job_run_details — the last 15 runs of that sweep', `
  select d.jobid, j.jobname, d.status, d.start_time, d.end_time,
         left(coalesce(d.return_message, ''), 160) as return_message
  from cron.job_run_details d
  join cron.job j on j.jobid = d.jobid
  where j.jobname ilike '%builder%'
  order by d.start_time desc
  limit 15
`);

// ---------------------------------------------------------------------------
// 5. THE MIRROR ITSELF — what the marketplace would read today.
// ---------------------------------------------------------------------------
await section('5. builder_network_stock_items — lifecycle, versions, currency', `
  select lifecycle_status,
         count(*)                                  as items,
         count(primary_image_id)                   as with_primary,
         min(source_version)                       as min_version,
         max(source_version)                       as max_version,
         max(updated_at)                           as last_updated,
         max(created_at)                           as last_created
  from public.builder_network_stock_items
  group by 1
  order by 2 desc
`);

await section('5b. the mirrored organisations', `
  select o.id, left(o.legal_name, 42) as legal_name, o.source_version, o.updated_at,
         (select count(*) from public.builder_network_stock_items i
           where i.organisation_id = o.id and i.lifecycle_status = 'active') as active_items,
         (select count(*) from public.builder_network_stock_items i
           where i.organisation_id = o.id) as all_items
  from public.builder_network_stock_organisations o
  order by o.updated_at desc
`);

// ---------------------------------------------------------------------------
// 6. THE STAMP the door writes on every accepted delivery. Its `updated_at`
//    is the last moment a delivery was ACCEPTED here, whatever happened next.
// ---------------------------------------------------------------------------
await section('6. builder_network_stamps', `
  select connection_id, side, source_version, updated_at, stamp
  from public.builder_network_stamps
  order by side
`);

// ---------------------------------------------------------------------------
// 7. WHAT THIS SIDE COMPLAINED ABOUT. A refusal is recorded as an operational
//    event, so a mirror that is being fed and refusing says so here.
// ---------------------------------------------------------------------------
await section('7. portal_operational_events — builder_network_*, last 14 days', `
  select event_name, severity, success, count(*) as events,
         min(occurred_at) as first_seen, max(occurred_at) as last_seen,
         left(max(metadata::text), 200) as sample_metadata
  from public.portal_operational_events
  where event_name ilike 'builder_network%'
    and occurred_at > now() - interval '14 days'
  group by 1, 2, 3
  order by 6 desc
  limit 30
`);

// ---------------------------------------------------------------------------
// 8. IS THE DOOR EVEN DEPLOYED, AND DID THE MIGRATIONS THAT BUILT THIS PATH
//    ACTUALLY RUN HERE? A ledger is not a record of what ran, so the
//    functions are asked for by name as well.
// ---------------------------------------------------------------------------
await section('8. the consumer objects, asked for by name', `
  select p.proname as function_name,
         (p.proname is not null) as present
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('builder_network_apply_inbound_events',
                      'builder_network_mark_inbound_refused',
                      'builder_network_announce_stock_selection')
  order by 1
`);

await section('8b. migration ledger tail', `
  select version
  from supabase_migrations.schema_migrations
  order by version desc
  limit 8
`);

// ---------------------------------------------------------------------------
// 9. THE READING. Nothing here is derived from a second copy of the rules —
//    each line restates a row printed above.
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(92)}\n9. WHAT THIS SIDE SAYS\n${'='.repeat(92)}`);

/*
 * A READ THAT FAILED IS NOT A ROW THAT IS ABSENT, and this is the one place
 * in the lane that could confuse them. `section()` answers null when the
 * query could not be run at all — a transient Management API error, a token
 * without the access, schema drift — and answers an empty array when the
 * question was asked and the table holds nothing. Collapsing those two with
 * a falsy test would print "NO SUCH FLAG ROW" and "NO CONNECTION ROW" off a
 * lost signal, which is a definite claim about configuration, printed
 * directly under this lane's own "COULD NOT BE READ", sending an operator to
 * the wrong repair. It is also the exact defect the product has already paid
 * for twice — `useAmlAccess` collapsing a failed read into the server's "no",
 * and the partner surface reading an RLS-filtered `[]` as every flag off.
 *
 * So `unread` is checked FIRST and is its own sentence, and it names the
 * limit of what the reading can say rather than guessing past it.
 */
const unread = (rows) => rows === null;
const flagRow = (key) => (flag ? flag.find((r) => r.key === key) : undefined);

const enabled = flagRow('builder_network_enabled');
console.log(unread(flag)
  ? '  builder_network_enabled  : COULD NOT BE READ — this says nothing about how the flag is set.'
  : enabled
    ? `  builder_network_enabled  : value=${enabled.raw_value} (${enabled.value_type}) — the inbound door reads this as ${enabled.strict_true_inbound_door}`
    : '  builder_network_enabled  : no such flag row — the door answers 503 network_disabled to every delivery.');

const tab = flagRow('builder_stock_marketplace');
console.log(unread(flag)
  ? '  builder_stock_marketplace: COULD NOT BE READ — this says nothing about how the flag is set.'
  : tab
    ? `  builder_stock_marketplace: value=${tab.raw_value} (${tab.value_type}) — the marketplace tab reads this as ${tab.coerced_marketplace_tab}`
    : '  builder_stock_marketplace: no such flag row — the Builder Stock tab is not drawn at all.');

if (unread(conn)) {
  console.log('  connection               : COULD NOT BE READ — whether one exists here is unknown, not absent.');
} else if (!conn.length) {
  console.log('  connection               : NO ROW — the door refuses every delivery with delivery_refused (401).');
}
if (findings.length) {
  console.log('\n  Questions this database could not answer:');
  for (const f of findings) console.log(`   - ${f}`);
}
console.log('\nRead-only trace complete. Nothing was changed.');
