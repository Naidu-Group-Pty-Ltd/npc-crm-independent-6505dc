/**
 * Packet Config Loader
 * --------------------
 * Controls which keys/columns get inlined into the data_packet sent to the LLM
 * for each scope. Lives in report_engine_config under config_key='packet_config'
 * (with scope-specific overrides under config_key='packet_config:<scope>').
 *
 * Schema of the JSON value:
 * {
 *   inline_keys: string[],         // packet keys to always include (whitelist; empty = include all defaults)
 *   exclude_keys: string[],        // packet keys to strip even if present
 *   inline_columns: string[],      // investment_reports columns to also pull and inline
 *   per_section_overrides: {       // optional: per section_key, override include/exclude
 *     [section_key: string]: { inline_keys?: string[]; exclude_keys?: string[] }
 *   },
 *   max_bytes_per_key?: number,    // soft cap: truncate any single key's serialised value
 * }
 */

// deno-lint-ignore-file no-explicit-any

export const DEFAULT_PACKET_KEYS = [
  'report_id',
  'property_address',
  'report_scope',
  'report_tier',
  'report_variant',
  'manual_overrides',
  'financial_calculations',
  'demographics_data',
  'economic_data',
  'investment_score',
  'location_intelligence',
  'property_specs',
  'validation_flags',
  'data_sources',
];

export interface PacketConfig {
  inline_keys: string[];
  exclude_keys: string[];
  inline_columns: string[];
  per_section_overrides: Record<string, { inline_keys?: string[]; exclude_keys?: string[] }>;
  max_bytes_per_key?: number;
  source: 'default' | 'global' | 'scope';
}

const EMPTY: PacketConfig = {
  inline_keys: [],
  exclude_keys: [],
  inline_columns: [],
  per_section_overrides: {},
  source: 'default',
};

export async function loadPacketConfig(supabase: any, scope: string): Promise<PacketConfig> {
  const { data } = await supabase
    .from('report_engine_config').select('config_key, scope, value')
    .in('config_key', ['packet_config', `packet_config:${scope}`]);
  if (!data?.length) return { ...EMPTY };

  // Scope-specific row wins
  const scoped = (data as any[]).find((r) => r.config_key === `packet_config:${scope}` || r.scope === scope);
  const global = (data as any[]).find((r) => r.config_key === 'packet_config' && (r.scope === 'global' || r.scope === 'default'));
  const v = scoped?.value ?? global?.value ?? null;
  if (!v || typeof v !== 'object') return { ...EMPTY };
  return {
    inline_keys: Array.isArray(v.inline_keys) ? v.inline_keys : [],
    exclude_keys: Array.isArray(v.exclude_keys) ? v.exclude_keys : [],
    inline_columns: Array.isArray(v.inline_columns) ? v.inline_columns : [],
    per_section_overrides: (v.per_section_overrides && typeof v.per_section_overrides === 'object') ? v.per_section_overrides : {},
    max_bytes_per_key: typeof v.max_bytes_per_key === 'number' ? v.max_bytes_per_key : undefined,
    source: scoped ? 'scope' : 'global',
  };
}

/**
 * Apply a PacketConfig to a candidate packet object, returning a filtered shallow
 * copy plus a trace describing what was stripped/truncated.
 */
export function applyPacketConfig(
  packet: Record<string, any>,
  cfg: PacketConfig,
  sectionKey?: string,
): { filtered: Record<string, any>; trace: { kept: string[]; excluded: string[]; truncated: string[]; source: string } } {
  const sectionOverride = sectionKey ? cfg.per_section_overrides[sectionKey] : undefined;
  const inlineAllow = (sectionOverride?.inline_keys?.length ? sectionOverride.inline_keys : cfg.inline_keys) ?? [];
  const exclude = new Set([...(sectionOverride?.exclude_keys ?? []), ...cfg.exclude_keys]);

  const filtered: Record<string, any> = {};
  const trace = { kept: [] as string[], excluded: [] as string[], truncated: [] as string[], source: cfg.source };

  for (const [k, v] of Object.entries(packet)) {
    if (exclude.has(k)) { trace.excluded.push(k); continue; }
    if (inlineAllow.length && !inlineAllow.includes(k)) { trace.excluded.push(k); continue; }
    let value = v;
    if (cfg.max_bytes_per_key && v != null) {
      const ser = JSON.stringify(v);
      if (ser.length > cfg.max_bytes_per_key) {
        value = { __truncated: true, original_bytes: ser.length, preview: ser.slice(0, cfg.max_bytes_per_key) };
        trace.truncated.push(k);
      }
    }
    filtered[k] = value;
    trace.kept.push(k);
  }
  return { filtered, trace };
}
