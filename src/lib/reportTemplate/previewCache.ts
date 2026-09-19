/**
 * Content keys for memoizing the editor's iframe renders (Phase 5.3 / 5.4,
 * reworked in rehaul Phase 3).
 *
 * Both preview surfaces re-run the (expensive) HTML renderer whenever the
 * `template` prop changes *reference* — which happens on every edit, even when
 * the bytes that actually get rendered are unchanged. Keying the render `useMemo`
 * on a stable *content* signature instead lets identical content reuse the prior
 * HTML string, so the iframe's `srcDoc` doesn't churn (no reload/flicker).
 *
 * Phase 3 rework: the keys keep their content semantics, but serialization is
 * memoized per object identity (WeakMap). The editor mutates the document
 * immutably with structural sharing, so an edit re-serializes only the changed
 * page/field — key computation is O(changed) instead of O(whole document)
 * `JSON.stringify` on every keystroke.
 *
 * IMPORTANT: this assumes serialized values are immutable (never mutated in
 * place after first use). All editor mutations go through the store's
 * immutable updates, so this holds.
 *
 * Pure and deterministic so the perf-correctness invariants are unit-testable.
 */
import type { Page, ReportTemplate } from './templateSchema';

const SEP = ' ';

// ── Identity-memoized serialization ──────────────────────────────────────────

const jsonByIdentity = new WeakMap<object, string>();

/**
 * `JSON.stringify` memoized by object identity. Safe because editor values are
 * immutable; identical references always have identical content. Recreated
 * objects with identical content miss the memo but still produce an equal
 * string, so key *equality* semantics are exactly JSON-content equality.
 */
export function stableJson(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    const hit = jsonByIdentity.get(value as object);
    if (hit !== undefined) return hit;
    const out = JSON.stringify(value);
    jsonByIdentity.set(value as object, out);
    return out;
  }
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

const templateKeyByIdentity = new WeakMap<object, string>();
const templateMetaKeyByIdentity = new WeakMap<object, string>();

/**
 * Content key for everything in the template EXCEPT `pages` (tokens, themes,
 * slots, canvas, masters, metadata, …). Field-wise so unchanged fields reuse
 * their memoized serialization.
 */
export function templateMetaKey(template: ReportTemplate): string {
  const hit = templateMetaKeyByIdentity.get(template);
  if (hit !== undefined) return hit;
  const parts: string[] = [];
  for (const key of Object.keys(template).sort()) {
    if (key === 'pages') continue;
    parts.push(`${key}=${stableJson((template as Record<string, unknown>)[key])}`);
  }
  const out = parts.join(';');
  templateMetaKeyByIdentity.set(template, out);
  return out;
}

/** Full-document content key: meta fields + each page, all identity-memoized. */
export function templateContentKey(template: ReportTemplate): string {
  const hit = templateKeyByIdentity.get(template);
  if (hit !== undefined) return hit;
  const out =
    templateMetaKey(template) +
    ';pages=[' +
    template.pages.map((p) => stableJson(p)).join(',') +
    ']';
  templateKeyByIdentity.set(template, out);
  return out;
}

// ── Preview keys ──────────────────────────────────────────────────────────────

/** Stable content key for the full live preview (overlays are visible here). */
export function makePreviewKey(
  template: ReportTemplate,
  sampleData: unknown,
  customCss: string | undefined,
): string {
  return templateContentKey(template) + SEP + stableJson(sampleData) + SEP + (customCss ?? '');
}

/**
 * Stable content key for the editorial canvas iframe.
 *
 * R3 — the canvas iframe renders the FULL page, overlays included: it is the
 * single renderer of overlay pixels, and the React layer above it draws only
 * hit-targets and selection chrome. The key therefore includes overlay content:
 * a *committed* overlay change rebuilds the srcDoc (the canvas double-buffers
 * the swap so nothing flashes), while transient drag state never touches the
 * template — the canvas mirrors live geometry onto the iframe DOM directly via
 * `[data-overlay-id]`, so no pointer tick ever forces a reload.
 */
export function makeCanvasRenderKey(
  template: ReportTemplate,
  page: Page,
  sampleData: unknown,
  customCss: string | undefined,
): string {
  return (
    templateMetaKey(template) +
    SEP +
    stableJson(page) +
    SEP +
    stableJson(sampleData) +
    SEP +
    (customCss ?? '')
  );
}
