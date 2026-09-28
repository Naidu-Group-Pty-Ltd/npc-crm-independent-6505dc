/**
 * WHAT THIS MARKETPLACE WOULD DRAW, MEASURED AGAINST WHAT THE NETWORK DRAWS.
 *
 * WHY IT EXISTS. The collateral-column rule was written and proved on
 * `aurixa-builders`, where `scripts/ops/stock-item-state.ts` can measure the
 * live stock directly. This side has no such lane, and "the clone now behaves
 * the same" is a claim about a different database — so it is asked of that
 * database rather than inferred from the fact that the files match.
 *
 * WHAT IT IS MEASURING. This repository reads the `builder_network_stock_*`
 * mirror, whose seed copies EVERY image row with its whole `source_detail`.
 * Measured 19 Sep 2026: 1,019 items and 2,860 image rows — so an item here
 * routinely holds several pictures where the network's card holds one. The
 * exposure the rule closes is a card whose primary is refused for some other
 * reason ranking DOWN onto a collateral sibling. That is counted explicitly
 * below, because it is the number that says whether the port mattered.
 *
 * WRITES NOTHING, AND CANNOT. `sql()` refuses any statement that does not
 * begin with `select` or `with` — a property of this file rather than a
 * promise about how it is called, the same guard `stock-item-state.ts` has.
 *
 * THE RULE IS IMPORTED, NEVER RESTATED. The verdicts below come from
 * `columnDeclaration.pure.ts` — the module the product runs — so this cannot
 * measure one thing while the marketplace does another.
 *
 *   node .github/scripts/builder-stock-mirror-state.mjs
 *
 * Needs SUPABASE_ACCESS_TOKEN. The project is PROJECT_REF, else the one this
 * checkout's own supabase/config.toml names (`scripts/lib/projectRef.mjs`).
 * Never a literal: this file is on every clone's repository too.
 */
import { readFileSync } from 'node:fs';
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

/*
 * THE RULE, READ OUT OF THE MODULE THE PRODUCT RUNS.
 *
 * Node cannot import the TypeScript source directly and this lane must not
 * depend on a build, so the token list is parsed out of it — the ONE list,
 * from the ONE file. A second copy typed here is the thing the whole port
 * exists to avoid, and a parse that fails is a hard error rather than a
 * fallback, because a fallback vocabulary would measure the wrong rule
 * silently.
 */
const MODULE = 'supabase/functions/_shared/builderStock/columnDeclaration.pure.ts';
const source = readFileSync(MODULE, 'utf8');
const listed = source.match(/export const COLLATERAL_COLUMN_TOKENS[^=]*=\s*\[([\s\S]*?)\];/);
if (!listed) {
  console.error(`::error::${MODULE} no longer exports COLLATERAL_COLUMN_TOKENS as a list`);
  process.exit(1);
}
const tokens = [...listed[1].replace(/\/\/[^\n]*/g, '').matchAll(/'([^']+)'/g)]
  .map((m) => m[1].replace(/\\\\/g, '\\'));
if (tokens.length < 20) {
  console.error(`::error::only ${tokens.length} tokens parsed from ${MODULE} — refusing to measure`);
  process.exit(1);
}
const COLLATERAL = new RegExp(`\\b(${tokens.join('|')})s?\\b`);

/** `readColumnDeclaration`, in the two answers this lane needs. */
function declaresCollateral(heading) {
  if (heading === null || heading === undefined) return false;
  if (typeof heading !== 'string') return true;
  if (!heading.trim()) return false;
  const words = heading.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!words) return true;
  return COLLATERAL.test(words);
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
  if (!res.ok) throw new Error(`[${label}] HTTP ${res.status}: ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body);
  return Array.isArray(parsed) ? parsed : [];
}

const heading = (t) => console.log(`\n${'='.repeat(92)}\n${t}\n${'='.repeat(92)}`);

console.log(`BUILDER STOCK MIRROR — what this marketplace would draw, on ${REF}`);
console.log(`rule: ${tokens.length} tokens read from ${MODULE}`);

// ---------------------------------------------------------------------------
// 1. The set a card can be drawn for at all.
// ---------------------------------------------------------------------------
const scope = await sql('mirror scope', `
  select count(*) as items,
         count(*) filter (where lifecycle_status = 'active') as active,
         count(*) filter (where lifecycle_status = 'active' and primary_image_id is not null)
           as active_with_primary
    from public.builder_network_stock_items`);
heading('MIRROR SCOPE');
for (const row of scope) console.log(`  ${JSON.stringify(row)}`);

/*
 * AND THE BREAKDOWN, because "0 active" is a claim about an empty page.
 *
 * The mirror's `lifecycle_status` DEFAULTS to 'active' and the marketplace
 * filters on it, so a zero there means this surface draws no Builder Stock
 * card at all. That is a big enough statement to be asked for directly
 * rather than inferred from one count, and the freshest row's timestamp says
 * whether the mirror is being fed or was seeded once and left.
 */
const lifecycles = await sql('lifecycle breakdown', `
  select lifecycle_status,
         count(*) as items,
         count(primary_image_id) as with_primary,
         max(last_seen_at)::text as newest_last_seen,
         max(updated_at)::text as newest_update
    from public.builder_network_stock_items
   group by lifecycle_status
   order by items desc`);
heading('MIRROR SCOPE — by lifecycle, and how fresh it is');
for (const row of lifecycles) {
  console.log(`  ${String(row.lifecycle_status).padEnd(12)} ${
    String(row.items).padStart(5)} item(s)  with_primary=${
    String(row.with_primary).padStart(5)}  last_seen<=${row.newest_last_seen
    }  updated<=${row.newest_update}`);
}

// ---------------------------------------------------------------------------
// 2. Which column each active card's primary image came out of.
//
// The same question `stock-item-state.ts` asks of the network, so the two
// answers are comparable line for line.
// ---------------------------------------------------------------------------
const leads = await sql('what leads each active card', `
  select coalesce(nullif(im.source_detail ->> 'source_column', ''), '(no heading)') as source_column,
         count(*) as cards,
         count(*) filter (where im.source_detail ->> 'marketplace_display_eligible' = 'true')
           as eligible
    from public.builder_network_stock_items as i
    join public.builder_network_stock_item_images as im on im.id = i.primary_image_id
   where i.lifecycle_status = 'active'
   group by 1
   order by cards desc`);
heading('ACTIVE CARDS — which document each one\'s primary image came out of');
let drawn = 0; let blocked = 0;
for (const row of leads) {
  const refused = declaresCollateral(row.source_column === '(no heading)' ? null : row.source_column);
  if (refused) blocked += Number(row.cards);
  else drawn += Number(row.cards);
  console.log(`  ${String(row.cards).padStart(4)} card(s)  ${
    String(row.source_column).slice(0, 44).padEnd(46)} eligible=${
    String(row.eligible).padStart(4)}  ${refused ? 'REFUSED by the column rule' : 'permitted'}`);
}
console.log(`\n  permitted by the column rule: ${drawn}    refused: ${blocked}`);

// ---------------------------------------------------------------------------
// 3. THE EXPOSURE THIS PORT CLOSED, counted.
//
// A card whose PRIMARY is not servable, that also holds a collateral image
// the old ranking would have accepted. Before the port every one of these
// drew a plan or a map; after it, every one draws nothing — which is what the
// network does for the same property.
// ---------------------------------------------------------------------------
const exposure = await sql('cards that would have ranked down onto collateral', `
  with candidates as (
    select i.id,
           im.source_detail ->> 'source_column' as lead_column,
           im.source_detail ->> 'marketplace_display_eligible' as lead_eligible
      from public.builder_network_stock_items as i
      left join public.builder_network_stock_item_images as im on im.id = i.primary_image_id
     where i.lifecycle_status = 'active')
  select c.id::text as id,
         coalesce(c.lead_column, '(none)') as lead_column,
         coalesce(c.lead_eligible, 'null') as lead_eligible,
         (select count(*) from public.builder_network_stock_item_images as s
           where s.stock_item_id = c.id
             and s.source_stage = 'uploaded_document'
             and s.verification_status = 'source_supplied'
             and s.processing_status = 'ready'
             and coalesce(s.storage_path, s.external_url) is not null
             and s.source_detail ->> 'marketplace_display_eligible' = 'true'
             and coalesce(s.source_detail ->> 'source_column', '') <> '') as eligible_siblings,
         (select string_agg(distinct s.source_detail ->> 'source_column', ' | ')
            from public.builder_network_stock_item_images as s
           where s.stock_item_id = c.id
             and s.source_detail ->> 'marketplace_display_eligible' = 'true'
             and coalesce(s.source_detail ->> 'source_column', '') <> '') as sibling_columns
    from candidates as c
   where c.lead_eligible is distinct from 'true'
   order by c.id`);
heading('THE EXPOSURE — active cards whose primary is not servable');
if (!exposure.length) console.log('  none — every active card carries a servable primary');
let wouldHaveDrawnCollateral = 0;
for (const row of exposure) {
  const siblings = String(row.sibling_columns ?? '');
  const collateralSibling = siblings.split(' | ').filter(Boolean).some(declaresCollateral);
  if (collateralSibling) wouldHaveDrawnCollateral += 1;
  console.log(`  ${row.id}  lead=${String(row.lead_column).slice(0, 34).padEnd(36)} ${
    collateralSibling ? 'WOULD HAVE RANKED DOWN ONTO COLLATERAL' : 'no collateral sibling'}`);
  if (siblings) console.log(`      eligible siblings: ${siblings.slice(0, 160)}`);
}
console.log(`\n  ${wouldHaveDrawnCollateral} active card(s) would have drawn a plan or map `
  + 'before this rule; each now draws nothing, as the network does.');

// ---------------------------------------------------------------------------
// 4. And the collateral imagery present in this database at all.
// ---------------------------------------------------------------------------
const present = await sql('collateral imagery in the mirror', `
  select coalesce(nullif(source_detail ->> 'source_column', ''), '(no heading)') as source_column,
         count(*) as images,
         count(*) filter (where source_detail ->> 'marketplace_display_eligible' = 'true')
           as eligible
    from public.builder_network_stock_item_images
   group by 1
   order by images desc
   limit 25`);
heading('EVERY MIRRORED IMAGE — by the column it was filed under');
for (const row of present) {
  const refused = declaresCollateral(row.source_column === '(no heading)' ? null : row.source_column);
  console.log(`  ${String(row.images).padStart(5)} image(s)  ${
    String(row.source_column).slice(0, 44).padEnd(46)} eligible=${
    String(row.eligible).padStart(4)}  ${refused ? 'REFUSED' : 'permitted'}`);
}

console.log('\nRead-only run complete. Nothing was written.');
