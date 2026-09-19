/**
 * Extract the canonical Market News Feed source registry from the migrations
 * that define it, and emit it as a generated TypeScript manifest.
 *
 * ## Why this exists
 *
 * `market_sources` is reference data that migrations INSERT. A clone is
 * provisioned by copying the schema and the migration ledger, and the rows
 * those migrations insert do not travel — measured 19 Sep 2026 on
 * `plisdzywzleljorrphxv`: all seven seeding migrations recorded as applied,
 * `market_sources` holding **0 rows**. The Market News Feed on that deployment
 * is correctly but permanently empty, and no amount of pressing Ingest changes
 * it.
 *
 * So the registry has to be able to travel as CODE, which every deployment
 * already gets. This reads the migrations rather than restating them, for the
 * same reason `investmentCompassSource.spec.ts` exists: ~40 sources with
 * adapter configs is not something anyone transcribes correctly, and a
 * mistyped selector is a source that silently returns nothing.
 *
 * Run: `npm run market:registry:generate`
 * Check: `npm run market:registry:check` (fails when the manifest has drifted)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const OUT = join(
  process.cwd(), 'supabase', 'functions', '_shared', 'marketSources',
  'canonicalRegistry.generated.ts',
);

/**
 * Pull every `jsonb_to_recordset('[...]')` payload out of a migration, with
 * the `enabled` and `registry_status` literals from the INSERT that consumes
 * it — a source's enablement is a property of the statement, not of the JSON.
 */
function blocksIn(sql) {
  const out = [];
  // `jsonb_to_recordset('[ … ]'::jsonb)` — the cast is part of the call.
  const re = /jsonb_to_recordset\(\s*'(\[[\s\S]*?\])'\s*(?:::jsonb)?\s*\)/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    // The `select` list between the preceding `insert into` and this call
    // carries the literals. Take the nearest preceding insert.
    const before = sql.slice(0, m.index);
    const insertAt = before.toLowerCase().lastIndexOf('insert into public.market_sources');
    const head = insertAt === -1 ? '' : before.slice(insertAt);
    // Postgres escapes a single quote inside a dollarless literal by doubling.
    const json = m[1].replace(/''/g, "'");
    let rows;
    try {
      rows = JSON.parse(json);
    } catch (e) {
      throw new Error(`could not parse a jsonb_to_recordset payload: ${e.message}`);
    }
    // `enabled` appears as a bare `true`/`false` in the select list.
    const enabled = /,\s*(true|false)\s*,\s*x\.adapter_type/i.exec(head)?.[1]
      ?? (/\btrue\b/.test(head) && !/\bfalse\b/.test(head) ? 'true' : null);
    const registryStatus = /'(canonical|unresolved_legacy|archived_legacy)'/i.exec(head)?.[1] ?? null;
    out.push({ rows, enabled, registryStatus });
  }
  return out;
}

const files = readdirSync(MIGRATIONS)
  .filter((f) => /^\d{14}_.*\.sql$/.test(f))
  .sort();

/** source_key -> the LAST definition seen, so a later migration wins. */
const bySourceKey = new Map();
const provenance = new Map();

for (const file of files) {
  const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
  if (!/insert\s+into\s+public\.market_sources/i.test(sql)) continue;
  for (const block of blocksIn(sql)) {
    for (const row of block.rows) {
      if (!row.source_key) continue;
      bySourceKey.set(row.source_key, {
        ...row,
        enabled: block.enabled === 'false' ? false : true,
        registry_status: block.registryStatus ?? 'canonical',
      });
      provenance.set(row.source_key, file);
    }
  }
}

/**
 * Normalise to the declared shape.
 *
 * The migrations' JSON is not uniform — `adapter_config` is absent on sources
 * whose adapter needs no configuration, and the disabled ones carry a
 * `disabled_reason` the others do not. Emitting the union verbatim produces a
 * manifest that does not typecheck, which is how the shape drift was found.
 * Every field is stated here, so a consumer never has to ask whether one is
 * present.
 */
const FIELDS = [
  'source_key', 'name', 'description', 'adapter_type', 'primary_url',
  'feed_urls', 'listing_urls', 'source_authority', 'reliability_tier',
  'default_segments', 'category', 'refresh_frequency_minutes',
  'copyright_mode', 'perspective', 'adapter_config', 'disabled_reason',
  'enabled', 'registry_status',
];

const DEFAULTS = {
  feed_urls: [], listing_urls: [], default_segments: [],
  adapter_config: {}, perspective: null, disabled_reason: null,
  description: '', copyright_mode: 'public_metadata_and_summary',
  source_authority: 'unclassified', reliability_tier: 'standard',
  category: 'economy', refresh_frequency_minutes: 60,
};

const sources = [...bySourceKey.entries()]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([, v]) => {
    const row = {};
    for (const f of FIELDS) {
      row[f] = v[f] !== undefined && v[f] !== null ? v[f] : (DEFAULTS[f] ?? v[f] ?? null);
    }
    // `enabled` is a boolean and `false` must survive the coalesce above.
    row.enabled = v.enabled === false ? false : true;
    return row;
  });

const unexpected = new Set();
for (const v of bySourceKey.values()) {
  for (const k of Object.keys(v)) if (!FIELDS.includes(k)) unexpected.add(k);
}
if (unexpected.size > 0) {
  console.error(`Refusing to write: the migrations carry field(s) this generator does not declare: ${[...unexpected].join(', ')}`);
  console.error('Add them to FIELDS and to the CanonicalMarketSource interface, or the manifest silently drops real data.');
  process.exit(1);
}

if (sources.length === 0) {
  console.error('Extracted no sources. The migrations changed shape — fix this script rather than shipping an empty registry.');
  process.exit(1);
}

const body = `/**
 * The Market News Feed's canonical source registry, as CODE.
 *
 * GENERATED by \`scripts/market-sources/extract-registry.mjs\` from the
 * migrations that define it. Do not hand-edit: run
 * \`npm run market:registry:generate\`, and
 * \`npm run market:registry:check\` fails CI when this file has drifted from
 * them.
 *
 * ## Why the registry has to be able to travel as code
 *
 * \`market_sources\` is reference data a migration INSERTs. A clone is
 * provisioned by copying the schema and the migration LEDGER, and the rows
 * those migrations insert do not come with it — measured 19 Sep 2026 on the
 * clone \`plisdzywzleljorrphxv\`: all seven seeding migrations recorded as
 * applied, the table holding **0 rows**, 310 ingestion runs having produced
 * nothing. The feed was correctly but permanently empty and no operator act
 * available in the product could change it.
 *
 * Code reaches every deployment. Rows do not. So the registry ships here and
 * \`registrySeed.pure.ts\` decides when a deployment may seed itself from it.
 */

export interface CanonicalMarketSource {
  source_key: string;
  name: string;
  description: string;
  adapter_type: string;
  primary_url: string;
  feed_urls: string[];
  listing_urls: string[];
  source_authority: string;
  reliability_tier: string;
  default_segments: string[];
  category: string;
  refresh_frequency_minutes: number;
  copyright_mode: string;
  perspective: string | null;
  /** \`{}\` where the adapter needs no configuration. */
  adapter_config: Record<string, unknown>;
  /** Why a disabled source is disabled, in the defining migration's words. */
  disabled_reason: string | null;
  /** The enablement the defining migration gave it. */
  enabled: boolean;
  registry_status: string;
}

export const CANONICAL_MARKET_SOURCES: readonly CanonicalMarketSource[] =
${JSON.stringify(sources, null, 2)} as const;

/** How many sources this manifest carries. Asserted by the check script. */
export const CANONICAL_MARKET_SOURCE_COUNT = ${sources.length};
`;

writeFileSync(OUT, body);
console.log(`Wrote ${OUT}`);
console.log(`  ${sources.length} canonical sources`);
console.log(`  enabled: ${sources.filter((s) => s.enabled).length}, disabled: ${sources.filter((s) => !s.enabled).length}`);
