/**
 * styleClipboard — module-scoped in-memory clipboard for overlay style
 * properties. Lets designers copy the "look" of one overlay (font, color,
 * alignment, decoration, padding, opacity, rotation) and paste onto another
 * without affecting content, position, size, or bindings.
 *
 * Intentionally lightweight — no persistence across reloads (matches Figma
 * behaviour). The shape is intentionally permissive (`Record<string, any>`)
 * so it works across text/shape/image overlay variants.
 */
import type { Overlay } from './templateSchema';

// Keys that describe LOOK, never structure/content/identity.
const STYLE_KEYS_COMMON = [
  'rotation', 'opacity',
] as const;
const STYLE_KEYS_TEXT = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'align',
  'lineHeight', 'letterSpacing', 'textDecoration', 'textTransform',
  'textShadow', 'whiteSpace', 'hyphens', 'columns', 'columnGap',
  'paragraphIndent', 'paragraphSpacing', 'verticalAlign',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'kerning', 'ligatures', 'fontVariantNumeric', 'fontFeatureSettings',
  'fontVariationSettings',
] as const;
const STYLE_KEYS_SHAPE = [
  'fill', 'stroke', 'strokeWidth', 'borderRadius',
] as const;
const STYLE_KEYS_IMAGE = [
  'fit',
] as const;

let clipboard: { sourceType: Overlay['type']; style: Record<string, any> } | null = null;

export function copyOverlayStyle(o: Overlay): void {
  const picked: Record<string, any> = {};
  const keys: readonly string[] = [
    ...STYLE_KEYS_COMMON,
    ...(o.type === 'text' ? STYLE_KEYS_TEXT : []),
    ...(o.type === 'shape' ? STYLE_KEYS_SHAPE : []),
    ...(o.type === 'image' ? STYLE_KEYS_IMAGE : []),
  ];
  for (const k of keys) {
    const v = (o as any)[k];
    if (v !== undefined && v !== null) picked[k] = v;
  }
  clipboard = { sourceType: o.type, style: picked };
}

export function hasOverlayStyle(): boolean {
  return clipboard !== null;
}

export function clipboardSourceType(): Overlay['type'] | null {
  return clipboard?.sourceType ?? null;
}

/**
 * Pastes style fields onto an overlay. Only fields that already exist on the
 * target overlay's type-specific schema are applied (e.g. pasting a text
 * style onto a shape will only apply rotation/opacity).
 */
export function pasteOverlayStyle(o: Overlay): Overlay {
  if (!clipboard) return o;
  const allowedByType: readonly string[] = [
    ...STYLE_KEYS_COMMON,
    ...(o.type === 'text' ? STYLE_KEYS_TEXT : []),
    ...(o.type === 'shape' ? STYLE_KEYS_SHAPE : []),
    ...(o.type === 'image' ? STYLE_KEYS_IMAGE : []),
  ];
  const next: any = { ...o };
  for (const [k, v] of Object.entries(clipboard.style)) {
    if (allowedByType.includes(k)) next[k] = v;
  }
  return next as Overlay;
}
