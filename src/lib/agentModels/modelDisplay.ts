/**
 * Small helpers for turning a raw `vendor/model` id into user-facing
 * display metadata (short label, vendor name, brand hex). Keep this
 * purely presentational — no network, no side effects.
 */

export type ModelDisplay = {
  raw: string;
  vendor: string;
  vendorLabel: string;
  shortLabel: string;
  longLabel: string;
  accent: string;
};

const VENDOR_META: Record<string, { label: string; accent: string }> = {
  openai: { label: 'OpenAI', accent: '#10A37F' },
  google: { label: 'Google', accent: '#4285F4' },
  anthropic: { label: 'Anthropic', accent: '#D97757' },
  xai: { label: 'xAI', accent: '#0F0F0F' },
  meta: { label: 'Meta', accent: '#1877F2' },
  mistral: { label: 'Mistral', accent: '#FA5A0A' },
  openrouter: { label: 'OpenRouter', accent: '#6D28D9' },
  cohere: { label: 'Cohere', accent: '#39594D' },
  perplexity: { label: 'Perplexity', accent: '#20B8CD' },
  groq: { label: 'Groq', accent: '#F55036' },
};

/** Split `vendor/model` into vendor + model, tolerating bare model ids. */
function splitId(modelId: string): { vendor: string; model: string } {
  if (!modelId) return { vendor: 'unknown', model: 'unassigned' };
  const idx = modelId.indexOf('/');
  if (idx === -1) return { vendor: 'native', model: modelId };
  return { vendor: modelId.slice(0, idx).toLowerCase(), model: modelId.slice(idx + 1) };
}

/** Turn `google/gemini-2.5-flash-lite` into `Gemini 2.5 Flash Lite`. */
function humanizeModel(model: string): string {
  return model
    .replace(/-preview$/i, ' Preview')
    .replace(/-lite$/i, ' Lite')
    .replace(/-mini$/i, ' Mini')
    .replace(/-nano$/i, ' Nano')
    .replace(/-pro$/i, ' Pro')
    .replace(/^gpt-/i, 'GPT-')
    .replace(/^gemini-?/i, 'Gemini ')
    .replace(/^claude-?/i, 'Claude ')
    .replace(/^grok-?/i, 'Grok ')
    .replace(/^llama-?/i, 'Llama ')
    .replace(/^mistral-?/i, 'Mistral ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatModelDisplay(modelId: string | null | undefined): ModelDisplay {
  const raw = modelId ?? '';
  const { vendor, model } = splitId(raw);
  const meta = VENDOR_META[vendor] ?? { label: vendor.replace(/\b\w/g, (c) => c.toUpperCase()), accent: '#6B7280' };
  const shortLabel = model ? humanizeModel(model) : 'Unassigned';
  return {
    raw,
    vendor,
    vendorLabel: meta.label,
    shortLabel,
    longLabel: raw ? `${meta.label} · ${shortLabel}` : 'Unassigned',
    accent: meta.accent,
  };
}
