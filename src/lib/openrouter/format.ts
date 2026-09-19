// OpenRouter catalog helpers — pure formatting + selectors.
// Reads the `raw_metadata` blob that `check-model-availability` already caches
// from https://openrouter.ai/api/v1/models. No new DB fields required.

export interface ORRawModel {
  id?: string;
  name?: string;
  description?: string;
  created?: number; // unix seconds
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
    tokenizer?: string;
    instruct_type?: string | null;
  };
  top_provider?: {
    name?: string;
    max_completion_tokens?: number | null;
    is_moderated?: boolean;
  };
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    image?: string | number;
    request?: string | number;
    web_search?: string | number;
    internal_reasoning?: string | number;
  };
  per_request_limits?: Record<string, unknown> | null;
}

export interface ORExtras {
  description?: string;
  releasedAt?: string;                // ISO
  inputModalities: string[];
  outputModalities: string[];
  tokenizer?: string;
  topProviderName?: string;
  isModerated?: boolean;
  maxCompletionTokens?: number;
  imagePricePerK?: number;            // $ per 1K images
  requestPrice?: number;              // $ per request
  isNew: boolean;                     // released ≤ 30d
}

export function extractExtras(raw: unknown): ORExtras {
  const m = (raw ?? {}) as ORRawModel;
  const arch = m.architecture ?? {};
  const tp = m.top_provider ?? {};
  const pr = m.pricing ?? {};

  const releasedAt = m.created ? new Date(m.created * 1000).toISOString() : undefined;
  const isNew = releasedAt
    ? Date.now() - new Date(releasedAt).getTime() < 30 * 864e5
    : false;

  const asNum = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  return {
    description: typeof m.description === 'string' && m.description.trim() ? m.description.trim() : undefined,
    releasedAt,
    inputModalities: Array.isArray(arch.input_modalities) && arch.input_modalities.length
      ? arch.input_modalities
      : arch.modality?.split('->')[0]?.split('+').map((s) => s.trim()).filter(Boolean) ?? ['text'],
    outputModalities: Array.isArray(arch.output_modalities) && arch.output_modalities.length
      ? arch.output_modalities
      : arch.modality?.split('->')[1]?.split('+').map((s) => s.trim()).filter(Boolean) ?? ['text'],
    tokenizer: arch.tokenizer || undefined,
    topProviderName: tp.name || undefined,
    isModerated: typeof tp.is_moderated === 'boolean' ? tp.is_moderated : undefined,
    maxCompletionTokens: tp.max_completion_tokens ?? undefined,
    imagePricePerK: asNum(pr.image) !== undefined ? Number(pr.image) * 1000 : undefined,
    requestPrice: asNum(pr.request),
    isNew,
  };
}

export function familyFromId(id: string): string {
  return id.split('/')[0] ?? 'other';
}

export function formatPricePerM(n?: number | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  if (n === 0) return 'Free';
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

export function formatContext(n?: number | null): string {
  if (!n || n <= 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export function formatReleased(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

// Semantic tint per family — uses existing tokens only.
export function familyTint(family: string): { chip: string; ring: string; dot: string } {
  const table: Record<string, { chip: string; ring: string; dot: string }> = {
    openai:     { chip: 'bg-success/10 text-success border-success/25',     ring: 'ring-success/25',     dot: 'bg-success' },
    anthropic:  { chip: 'bg-warning/10 text-warning border-warning/25',     ring: 'ring-warning/25',     dot: 'bg-warning' },
    google:     { chip: 'bg-info/10 text-info border-info/25',              ring: 'ring-info/25',        dot: 'bg-info' },
    'meta-llama': { chip: 'bg-primary/10 text-primary border-primary/25',   ring: 'ring-primary/25',     dot: 'bg-primary' },
    mistralai:  { chip: 'bg-accent/10 text-accent border-accent/25',        ring: 'ring-accent/25',      dot: 'bg-accent' },
    deepseek:   { chip: 'bg-primary/10 text-primary border-primary/25',     ring: 'ring-primary/25',     dot: 'bg-primary' },
    qwen:       { chip: 'bg-info/10 text-info border-info/25',              ring: 'ring-info/25',        dot: 'bg-info' },
    perplexity: { chip: 'bg-accent/10 text-accent border-accent/25',        ring: 'ring-accent/25',      dot: 'bg-accent' },
    'x-ai':     { chip: 'bg-muted text-foreground border-border',           ring: 'ring-border',         dot: 'bg-foreground' },
    cohere:     { chip: 'bg-warning/10 text-warning border-warning/25',     ring: 'ring-warning/25',     dot: 'bg-warning' },
  };
  return table[family] ?? { chip: 'bg-muted text-muted-foreground border-border/60', ring: 'ring-border/60', dot: 'bg-muted-foreground' };
}

export type SortKey = 'popular' | 'newest' | 'context-desc' | 'price-asc' | 'name-asc';

export const SORT_LABELS: Record<SortKey, string> = {
  popular: 'Popular',
  newest: 'Newest',
  'context-desc': 'Largest context',
  'price-asc': 'Cheapest input',
  'name-asc': 'Name (A–Z)',
};
