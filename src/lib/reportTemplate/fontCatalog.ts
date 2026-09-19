/**
 * Curated Google Fonts catalog for the Template Builder.
 * Organised by visual category. Each entry carries a Google Fonts CSS URL
 * (with sensible weight set) and a list of suggested body-font pairings.
 */

export type FontCategory = 'Sans' | 'Serif' | 'Display' | 'Mono' | 'Handwriting' | 'Slab';

export interface CatalogFont {
  family: string;
  category: FontCategory;
  cssUrl: string;
  /** Suggested body families when this font is used for headings. */
  pairings?: string[];
  weights?: number[];
  italics?: boolean;
  /** True = the font looks great as a display/heading face. */
  display?: boolean;
  notes?: string;
}

export const googleFontsCssUrl = (family: string, weightSpec = 'wght@300;400;500;600;700;800', italics = false): string => {
  const fam = encodeURIComponent(family.trim().replace(/\s+/g, ' ')).replace(/%20/g, '+');
  const spec = italics ? `ital,${weightSpec.replace('wght@', 'wght@0,')};1,${weightSpec.split('@')[1] ?? ''}` : weightSpec;
  return `https://fonts.googleapis.com/css2?family=${fam}:${spec}&display=swap`;
};

const g = googleFontsCssUrl;

export const FONT_CATALOG: CatalogFont[] = [
  // ── Sans ────────────────────────────────────────────────────────────────────
  { family: 'Inter', category: 'Sans', cssUrl: g('Inter'), pairings: ['Inter', 'Source Serif Pro'], weights: [300,400,500,600,700,800] },
  { family: 'Manrope', category: 'Sans', cssUrl: g('Manrope'), pairings: ['Manrope', 'Lora'], weights: [300,400,500,600,700,800] },
  { family: 'DM Sans', category: 'Sans', cssUrl: g('DM Sans', 'wght@400;500;700'), pairings: ['DM Sans', 'DM Serif Display'] },
  { family: 'Space Grotesk', category: 'Sans', cssUrl: g('Space Grotesk', 'wght@300;400;500;600;700'), pairings: ['DM Sans', 'Inter'] },
  { family: 'Archivo', category: 'Sans', cssUrl: g('Archivo'), pairings: ['Archivo', 'Lora'] },
  { family: 'Work Sans', category: 'Sans', cssUrl: g('Work Sans'), pairings: ['Work Sans'] },
  { family: 'Plus Jakarta Sans', category: 'Sans', cssUrl: g('Plus Jakarta Sans'), pairings: ['Plus Jakarta Sans', 'Lora'] },
  { family: 'Outfit', category: 'Sans', cssUrl: g('Outfit'), pairings: ['Outfit', 'Lora'] },
  { family: 'Sora', category: 'Sans', cssUrl: g('Sora', 'wght@300;400;500;600;700;800'), pairings: ['Sora'] },
  { family: 'Be Vietnam Pro', category: 'Sans', cssUrl: g('Be Vietnam Pro'), pairings: ['Be Vietnam Pro'] },
  { family: 'Public Sans', category: 'Sans', cssUrl: g('Public Sans'), pairings: ['Public Sans', 'Source Serif Pro'] },
  { family: 'Figtree', category: 'Sans', cssUrl: g('Figtree'), pairings: ['Figtree'] },
  { family: 'Nunito Sans', category: 'Sans', cssUrl: g('Nunito Sans'), pairings: ['Nunito Sans'] },
  { family: 'Lato', category: 'Sans', cssUrl: g('Lato', 'wght@300;400;700;900'), pairings: ['Lato', 'Merriweather'] },
  { family: 'Open Sans', category: 'Sans', cssUrl: g('Open Sans'), pairings: ['Open Sans', 'Merriweather'] },
  { family: 'Roboto', category: 'Sans', cssUrl: g('Roboto', 'wght@300;400;500;700;900'), pairings: ['Roboto', 'Roboto Slab'] },
  { family: 'Montserrat', category: 'Sans', cssUrl: g('Montserrat'), pairings: ['Montserrat', 'Merriweather'] },
  { family: 'Poppins', category: 'Sans', cssUrl: g('Poppins'), pairings: ['Poppins', 'Lora'] },

  // ── Serif ───────────────────────────────────────────────────────────────────
  { family: 'Playfair Display', category: 'Serif', cssUrl: g('Playfair Display', 'wght@400;600;700;800', true), pairings: ['Inter', 'DM Sans', 'Source Sans 3'], display: true },
  { family: 'Fraunces', category: 'Serif', cssUrl: g('Fraunces', 'opsz,wght@9..144,300..900', true), pairings: ['Inter', 'Manrope'], display: true },
  { family: 'Cormorant Garamond', category: 'Serif', cssUrl: g('Cormorant Garamond', 'wght@400;600;700', true), pairings: ['Inter', 'Lato'], display: true },
  { family: 'Libre Caslon Text', category: 'Serif', cssUrl: g('Libre Caslon Text', 'wght@400;700', true), pairings: ['Inter'] },
  { family: 'Crimson Pro', category: 'Serif', cssUrl: g('Crimson Pro', 'wght@300..900', true), pairings: ['Inter', 'Work Sans'] },
  { family: 'Lora', category: 'Serif', cssUrl: g('Lora', 'wght@400;500;600;700', true), pairings: ['Inter', 'Manrope'] },
  { family: 'Merriweather', category: 'Serif', cssUrl: g('Merriweather', 'wght@300;400;700;900', true), pairings: ['Montserrat', 'Open Sans'] },
  { family: 'Source Serif Pro', category: 'Serif', cssUrl: g('Source Serif Pro', 'wght@400;600;700', true), pairings: ['Inter', 'Source Sans 3'] },
  { family: 'EB Garamond', category: 'Serif', cssUrl: g('EB Garamond', 'wght@400;500;600;700', true), pairings: ['Inter', 'Work Sans'] },
  { family: 'DM Serif Display', category: 'Serif', cssUrl: g('DM Serif Display', 'wght@400'), pairings: ['DM Sans'], display: true },
  { family: 'Cardo', category: 'Serif', cssUrl: g('Cardo', 'wght@400;700', true), pairings: ['Inter'] },
  { family: 'Bitter', category: 'Serif', cssUrl: g('Bitter', 'wght@300;400;600;700', true), pairings: ['Bitter', 'Inter'] },

  // ── Slab ────────────────────────────────────────────────────────────────────
  { family: 'Roboto Slab', category: 'Slab', cssUrl: g('Roboto Slab', 'wght@300;400;500;700'), pairings: ['Roboto'] },
  { family: 'Zilla Slab', category: 'Slab', cssUrl: g('Zilla Slab', 'wght@300;400;500;600;700', true), pairings: ['Inter'] },
  { family: 'Arvo', category: 'Slab', cssUrl: g('Arvo', 'wght@400;700', true), pairings: ['Open Sans'] },

  // ── Display ─────────────────────────────────────────────────────────────────
  { family: 'Bricolage Grotesque', category: 'Display', cssUrl: g('Bricolage Grotesque', 'wght@300;400;500;600;700;800'), pairings: ['Inter', 'DM Sans'], display: true },
  { family: 'Unbounded', category: 'Display', cssUrl: g('Unbounded'), pairings: ['Inter'], display: true },
  { family: 'Syne', category: 'Display', cssUrl: g('Syne', 'wght@400;500;600;700;800'), pairings: ['Inter', 'Sora'], display: true },
  { family: 'Bebas Neue', category: 'Display', cssUrl: g('Bebas Neue', 'wght@400'), pairings: ['Inter', 'Lato'], display: true },
  { family: 'Abril Fatface', category: 'Display', cssUrl: g('Abril Fatface', 'wght@400'), pairings: ['Lato', 'Open Sans'], display: true },
  { family: 'Cinzel', category: 'Display', cssUrl: g('Cinzel', 'wght@400;500;600;700;800;900'), pairings: ['Lato'], display: true },
  { family: 'Italiana', category: 'Display', cssUrl: g('Italiana', 'wght@400'), pairings: ['Inter'], display: true },
  { family: 'Marcellus', category: 'Display', cssUrl: g('Marcellus', 'wght@400'), pairings: ['Inter'], display: true },

  // ── Monospace ───────────────────────────────────────────────────────────────
  { family: 'JetBrains Mono', category: 'Mono', cssUrl: g('JetBrains Mono', 'wght@300;400;500;700', true), pairings: ['Inter'] },
  { family: 'IBM Plex Mono', category: 'Mono', cssUrl: g('IBM Plex Mono', 'wght@300;400;500;700', true), pairings: ['IBM Plex Sans'] },
  { family: 'Fira Code', category: 'Mono', cssUrl: g('Fira Code', 'wght@300;400;500;700'), pairings: ['Inter'] },
  { family: 'Space Mono', category: 'Mono', cssUrl: g('Space Mono', 'wght@400;700', true), pairings: ['Space Grotesk'] },

  // ── Handwriting / Script ────────────────────────────────────────────────────
  { family: 'Caveat', category: 'Handwriting', cssUrl: g('Caveat', 'wght@400;600;700'), pairings: ['Inter'] },
  { family: 'Dancing Script', category: 'Handwriting', cssUrl: g('Dancing Script', 'wght@400;600;700'), pairings: ['Lato'] },
  { family: 'Great Vibes', category: 'Handwriting', cssUrl: g('Great Vibes', 'wght@400'), pairings: ['Lato'] },
  { family: 'Sacramento', category: 'Handwriting', cssUrl: g('Sacramento', 'wght@400'), pairings: ['Inter'] },
];

export const FONT_CATEGORIES: FontCategory[] = ['Sans', 'Serif', 'Slab', 'Display', 'Mono', 'Handwriting'];

export const BUILT_IN_FAMILIES = ['Helvetica', 'Times', 'Courier', 'Georgia', 'Arial'];

export function findCatalogFont(family: string): CatalogFont | undefined {
  return FONT_CATALOG.find((f) => f.family === family);
}

/** First family of a CSS font stack, unquoted: `"Open Sans", sans-serif` → `Open Sans`. */
export function primaryFamily(stack: string): string {
  return String(stack ?? '').split(',')[0].replace(/["']/g, '').trim();
}

export function findCatalogFontLoose(family: string): CatalogFont | undefined {
  const fam = primaryFamily(family).toLowerCase();
  if (!fam) return undefined;
  return FONT_CATALOG.find((f) => f.family.toLowerCase() === fam);
}

function collectFamilies(template: any): Set<string> {
  const found = new Set<string>();
  const add = (v: unknown) => {
    const fam = typeof v === 'string' ? primaryFamily(v) : '';
    if (fam) found.add(fam);
  };
  for (const v of Object.values(template?.tokens?.fonts ?? {})) add(v);
  for (const page of template?.pages ?? []) {
    for (const block of page?.blocks ?? []) {
      for (const overlay of block?.overlays ?? []) {
        add(overlay?.fontFamily);
        for (const run of overlay?.runs ?? []) add(run?.fontFamily);
      }
    }
  }
  return found;
}

/**
 * Make every catalog-known font family used by a template actually loadable:
 * append a `cssUrl` (Google Fonts) `fontFaces` entry for each referenced family
 * that has no face yet. Without this, imported templates name fonts like
 * "Inter" or "Playfair Display" but neither the editor preview nor the
 * WeasyPrint export has any @font-face for them — text silently falls back to
 * the engine default and the reference typography is lost.
 *
 * Pure (returns a new template object); built-ins (Helvetica/Arial/…) and
 * families already covered by an embedded/declared face are left untouched.
 */
export function ensureCatalogFontFaces<T extends { tokens?: any }>(template: T): T {
  const families = collectFamilies(template);
  const existingFaces: any[] = template?.tokens?.fontFaces ?? [];
  // Only a face that can actually LOAD (cssUrl or src) covers a family; bare
  // `{ family }` placeholders (e.g. harvested DOM font names) must still be
  // upgraded to a loadable catalog face.
  const covered = new Set(
    existingFaces
      .filter((f: any) => f?.cssUrl || f?.src)
      .map((f: any) => primaryFamily(String(f?.family ?? '')).toLowerCase()),
  );
  for (const f of existingFaces) if (f?.family) families.add(primaryFamily(String(f.family)));
  if (!families.size) return template;
  const additions: Array<{ family: string; cssUrl: string }> = [];
  for (const family of families) {
    const lower = family.toLowerCase();
    if (covered.has(lower)) continue;
    if (BUILT_IN_FAMILIES.some((b) => b.toLowerCase() === lower)) continue;
    const cat = findCatalogFontLoose(family);
    if (!cat) continue;
    additions.push({ family: cat.family, cssUrl: cat.cssUrl });
    covered.add(lower);
  }
  if (!additions.length) return template;
  // Drop unloadable placeholder faces that the catalog now covers.
  const additionFamilies = new Set(additions.map((a) => a.family.toLowerCase()));
  const keptFaces = existingFaces.filter((f: any) =>
    f?.cssUrl || f?.src || !additionFamilies.has(primaryFamily(String(f?.family ?? '')).toLowerCase()));
  return {
    ...template,
    tokens: {
      ...(template.tokens ?? {}),
      fontFaces: [...keptFaces, ...additions],
    },
  };
}

/** Curated pairing presets — one click sets a heading + body family. */
export interface FontPairPreset {
  id: string;
  label: string;
  heading: string;
  body: string;
  mood: string;
}

export const FONT_PAIR_PRESETS: FontPairPreset[] = [
  { id: 'editorial-luxe', label: 'Editorial Luxe', heading: 'Playfair Display', body: 'Inter', mood: 'Premium magazine / private client' },
  { id: 'modern-tech', label: 'Modern Tech', heading: 'Space Grotesk', body: 'Inter', mood: 'Crisp SaaS / fintech' },
  { id: 'classic-finance', label: 'Classic Finance', heading: 'Fraunces', body: 'Manrope', mood: 'Trustworthy, considered' },
  { id: 'soft-warm', label: 'Soft & Warm', heading: 'Cormorant Garamond', body: 'Lato', mood: 'Wellness, hospitality' },
  { id: 'bold-display', label: 'Bold Display', heading: 'Bricolage Grotesque', body: 'DM Sans', mood: 'High-energy marketing' },
  { id: 'serif-stack', label: 'Pure Serif', heading: 'EB Garamond', body: 'EB Garamond', mood: 'Long-form report' },
  { id: 'minimal-sans', label: 'Minimal Sans', heading: 'Inter', body: 'Inter', mood: 'Quiet, neutral' },
  { id: 'editorial-syne', label: 'Editorial Syne', heading: 'Syne', body: 'Sora', mood: 'Contemporary studio' },
];
