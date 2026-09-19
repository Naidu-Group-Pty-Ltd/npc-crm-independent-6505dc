/**
 * Reading a library entry's design-family facts.
 *
 * One place, because the card, the reader and the "Use template" dialog all
 * need the same three answers — which colourways does this entry offer, which
 * one is selected, and what token overrides does that imply — and three copies
 * of that arithmetic is how a card ends up previewing a different palette from
 * the reader it opens.
 *
 * Every function here tolerates a non-family entry. The forty voice templates
 * carry no `designMeta`, and they must keep browsing, previewing and copying
 * exactly as they did before this feature existed.
 */
import {
  colourwaysForFamily,
  colourwayTokenOverride,
  findColourway,
  resolveColourway,
  type ApprovedColourway,
} from './colourways';
import type { TemplateLibraryListEntry } from './types';

/** True when the entry belongs to an Investment Compass design family. */
export function isFamilyEntry(entry: TemplateLibraryListEntry | null | undefined): boolean {
  return !!entry?.designMeta?.familyKey;
}

/**
 * The colourways this entry offers, in the approved order.
 *
 * Intersected with the entry's own stored list rather than taken straight from
 * the family registry. The stored list is what the server validates against, so
 * a UI that offered more than it would accept would put a rejection behind a
 * click that looked legitimate.
 */
export function entryColourways(
  entry: TemplateLibraryListEntry | null | undefined,
): readonly ApprovedColourway[] {
  const meta = entry?.designMeta;
  if (!meta?.familyKey) return [];
  const offered = new Set(meta.colourways ?? []);
  const family = colourwaysForFamily(meta.familyKey);
  if (offered.size === 0) return family;
  return family.filter((c) => offered.has(c.id));
}

/** The colourway the stored schema was compiled in. */
export function entryDefaultColourwayId(
  entry: TemplateLibraryListEntry | null | undefined,
): string | null {
  const meta = entry?.designMeta;
  if (!meta?.familyKey) return null;
  if (meta.defaultColourway && findColourway(meta.familyKey, meta.defaultColourway)) {
    return meta.defaultColourway;
  }
  return entryColourways(entry)[0]?.id ?? null;
}

/**
 * Token overrides for a chosen colourway, or `undefined` to render as stored.
 *
 * Returns `undefined` — not an empty object — when the selection matches what
 * the schema already carries. The renderer folds `tokenOverrides` into its page
 * cache key, so handing it a fresh object every render would defeat the cache
 * for no visual difference.
 */
export function colourwayOverridesFor(
  entry: TemplateLibraryListEntry | null | undefined,
  colourwayId: string | null | undefined,
): { colors: Record<string, string> } | undefined {
  const meta = entry?.designMeta;
  if (!meta?.familyKey || !colourwayId) return undefined;
  if (colourwayId === entryDefaultColourwayId(entry)) return undefined;
  const colourway = findColourway(meta.familyKey, colourwayId);
  return colourway ? colourwayTokenOverride(colourway) : undefined;
}

/**
 * The ground a reader is actually looking at.
 *
 * The entry's declared `ground` describes the template before a palette is
 * chosen; the answer that matters for a Light/Dark filter is the ground of the
 * SELECTED colourway. A Chancery in Obsidian Reverse is a dark document.
 */
export function effectiveGround(
  entry: TemplateLibraryListEntry | null | undefined,
  colourwayId?: string | null,
): 'light' | 'dark' | null {
  const meta = entry?.designMeta;
  if (!meta?.familyKey) return null;
  const id = colourwayId ?? entryDefaultColourwayId(entry);
  const colourway = id ? findColourway(meta.familyKey, id) : null;
  return colourway?.ground ?? meta.ground ?? null;
}

/** Paper and accent for a colourway, for a swatch or a card edge. */
export function colourwaySwatch(
  entry: TemplateLibraryListEntry | null | undefined,
  colourwayId?: string | null,
): { paper: string; accent: string; name: string } | null {
  const meta = entry?.designMeta;
  if (!meta?.familyKey) return null;
  const id = colourwayId ?? entryDefaultColourwayId(entry);
  const colourway = id ? findColourway(meta.familyKey, id) : null;
  if (!colourway) return null;
  const resolved = resolveColourway(colourway);
  return { paper: resolved.surface, accent: resolved.primary, name: colourway.name };
}

/** Human label for a density step. */
export function densityLabel(density: string | null | undefined): string | null {
  if (!density) return null;
  return density.charAt(0).toUpperCase() + density.slice(1);
}

/** The short variant name, e.g. `C · expansive` → `expansive`. */
export function axisLabel(axis: string | null | undefined): string | null {
  if (!axis) return null;
  const parts = axis.split('·').map((p) => p.trim());
  return parts[1] ?? parts[0] ?? null;
}
