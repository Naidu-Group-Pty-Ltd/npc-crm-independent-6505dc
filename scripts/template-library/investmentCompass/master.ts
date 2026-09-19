/**
 * The part of a family master that is the same whatever the report is about.
 *
 * A master is two things: a **document** (the pages, which are entirely a
 * property of the report format) and a **shell** — tokens compiled from the
 * family's colourway and measured type scale, the Google Fonts faces, the
 * catalogue metadata, the slug and the tags. The shell does not care whether
 * the pages inside it argue about a property or about someone's borrowing
 * capacity, so it lives here and both formats compile through it.
 *
 * Written when the second format arrived. The alternative was a second copy of
 * sixty lines of token and `design_meta` assembly, which is the kind of
 * duplication that stays in step for exactly as long as nobody edits it: the
 * first colourway or font-axis change would have repainted one catalogue and
 * left the other on the old palette, and nothing would have said so.
 */
import {
  axisFor,
  useBucketFor,
  type DesignFamily,
  type TemplateManifest,
  type VariantDefinition,
} from './family';
import type { Compass, PageDef } from './blocks';
import {
  colourwayColors,
  colourwaysForFamily,
  defaultColourwayFor,
} from '../../../supabase/functions/_shared/templateColourways.pure';

/**
 * The `category` values `template_library_entries_category_check` accepts.
 *
 * This was `string`, and that is the whole reason 50 Client Details masters
 * shipped with `category: 'client_details'` — a plausible value, matching the
 * format's `report_type`, that the column has never allowed. `tsc` had nothing
 * to object to, the seed builder did not check the vocabulary, and the defect
 * surfaced only when Postgres rejected the 30th chunk of a real apply.
 *
 * Keep in step with the CHECK constraint. `report_type` is a *different*
 * vocabulary and deliberately not this one: a Client Details Form is
 * report_type `client_details` and category `client_form`.
 */
export type LibraryCategory =
  | 'investment'
  | 'suburb'
  | 'postcode'
  | 'statewide'
  | 'comparison'
  | 'cash_flow'
  | 'client_form'
  | 'compliance'
  | 'finance'
  | 'portfolio';

/**
 * What a report format contributes to the shell.
 *
 * Everything here is routing and catalogue vocabulary — none of it is design.
 * A format cannot change how a family looks; that is the whole point of the
 * family system, and it is what lets the ten designs serve every format.
 */
export interface ReportFormat {
  /** Slug prefix and primary tag, e.g. `investment-compass`. */
  key: string;
  /** `report_type` on the library row. Normalised by the adapter registry. */
  reportType: string;
  /** `category` on the library row. Constrained by the column's CHECK. */
  category: LibraryCategory;
  /** `tier` on the library row. */
  tier: string;
  /** Human name of the format, used in the long description. */
  label: string;
  /** Extra tags beyond the family/variant/density ones every master carries. */
  extraTags?: string[];
}

export interface CompassDesignMeta {
  familyKey: string;
  familyCode: string;
  familyName: string;
  familyNote: string;
  familyOrdinal: string;
  faces: string;
  templateCode: string;
  variantAxis: string;
  architecture: string;
  density: string;
  printDensity: string;
  ground: string;
  recommendedUse: string;
  useBucket: string | null;
  manifest: TemplateManifest;
  overrides: Partial<TemplateManifest>;
  isFamilyReference: boolean;
  defaultColourway: string;
  colourways: string[];
  archetypeCoverage: string;
  source: string;
  /** Which report format this master documents. */
  reportFormat: string;
}

export interface CompassSeedTemplate {
  slug: string;
  name: string;
  description: string;
  longDescription: string;
  category: string;
  reportType: string | null;
  tier?: string | null;
  industry: string[];
  tags: string[];
  style: string;
  accessTier: string;
  designMeta: CompassDesignMeta;
  schema: {
    version: 1;
    name: string;
    tokens: Record<string, unknown>;
    pages: PageDef[];
  };
}

/**
 * The catalogue's `style` axis, per family.
 *
 * The library's existing Style filter predates the family system and has to
 * keep returning something sensible for these entries. Each family is mapped to
 * the voice whose subject matter it shares — not to a voice it is built in,
 * which it is not.
 */
export const FAMILY_STYLE: Record<string, string> = {
  private_banking: 'luxury',
  institutional_research: 'technical',
  luxury_editorial: 'editorial',
  modern_fintech: 'minimal',
  architectural_property: 'minimal',
  swiss_minimal: 'minimal',
  corporate_advisory: 'corporate',
  wealth_management: 'corporate',
  data_analyst: 'technical',
  dark_executive: 'technical',
};

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Google Fonts stylesheet URL.
 *
 * Written here rather than taken from `fontCatalog` because that helper emits a
 * fixed weight axis, and these ten families need different ones — Playfair
 * needs its italic axis for the standfirst, Cinzel has none, Lato ships a 300
 * and Noto Serif an italic.
 */
export function googleFontsCss(family: string, axis: string): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${axis}&display=swap`;
}

/** The tokens a master compiles with: the family's default colourway and scale. */
export function compassTokens(c: Compass, familyKey: string): Record<string, unknown> {
  const defaultColourway = defaultColourwayFor(familyKey);
  if (!defaultColourway) throw new Error(`Family "${familyKey}" has no colourways`);

  const faces = [
    { role: 'display' as const, family: c.type.display },
    { role: 'heading' as const, family: c.type.heading },
    { role: 'body' as const, family: c.type.body },
    { role: 'mono' as const, family: c.type.mono },
  ];
  // A family that sets one face for every role must not load it four times.
  const uniqueFaces = faces.filter(
    (f, i) => faces.findIndex((g) => g.family === f.family) === i,
  );

  return {
    // The default colourway is compiled in. Selecting another is a token
    // override at preview time and a bake at copy time — never a second
    // template. See `templateColourways.pure.ts`.
    colors: colourwayColors(defaultColourway),
    fonts: {
      display: `${c.type.display}, ${c.type.displayGeneric}`,
      heading: `${c.type.heading}, ${c.type.headingGeneric}`,
      body: `${c.type.body}, ${c.type.bodyGeneric}`,
      mono: `${c.type.mono}, ${c.type.monoGeneric}`,
    },
    spacing: {
      gutter: c.spacing.gap,
      sectionGap: c.spacing.sectionGap,
      padding: c.margin,
    },
    radii: { sm: c.radius, md: c.radius, lg: c.radius },
    typeScale: {
      eyebrow: c.scale.eyebrow,
      body: c.scale.body,
      heading: c.scale.heading,
      cover: c.scale.coverTitle,
    },
    // Without these the template names a face and WeasyPrint silently renders
    // the engine default, which is a serif that is not it.
    fontFaces: uniqueFaces.map((f) => ({
      family: f.family,
      cssUrl: googleFontsCss(f.family, c.type.axes[f.role] ?? 'wght@400;500;600;700'),
    })),
  };
}

/** Wrap a composed page sequence in the catalogue shell. */
export function assembleMaster(input: {
  family: DesignFamily;
  variant: VariantDefinition;
  manifest: TemplateManifest;
  c: Compass;
  pages: PageDef[];
  format: ReportFormat;
}): CompassSeedTemplate {
  const { family, variant, manifest, c, pages, format } = input;

  const defaultColourway = defaultColourwayFor(family.key);
  if (!defaultColourway) throw new Error(`Family "${family.key}" has no colourways`);

  const axis = axisFor(family, variant);
  const bucket = useBucketFor(variant.code);
  const style = FAMILY_STYLE[family.key];
  if (!style) throw new Error(`No style axis mapped for family "${family.key}"`);

  return {
    slug: `${format.key}-${variant.code}-${slugify(variant.name)}`,
    name: variant.name,
    description: variant.description,
    longDescription:
      `${variant.description} ${family.name} is ${family.note.toLowerCase()}. `
      + `Recommended use: ${variant.use.toLowerCase()}. `
      + `Ten colourways compose with this layout.`,
    category: format.category,
    reportType: format.reportType,
    tier: format.tier,
    industry: ['property', 'finance'],
    tags: [
      format.key,
      family.key.replace(/_/g, '-'),
      variant.code,
      manifest.density,
      axis.split(' ')[0].toLowerCase(),
      ...(bucket ? [bucket.toLowerCase().replace(/\s+/g, '-')] : []),
      ...(format.extraTags ?? []),
    ],
    style,
    accessTier: 'premium',
    designMeta: {
      familyKey: family.key,
      familyCode: family.code,
      familyName: family.name,
      familyNote: family.note,
      familyOrdinal: family.ordinal,
      faces: family.faces,
      templateCode: variant.code,
      variantAxis: axis,
      architecture: variant.architecture,
      density: manifest.density,
      printDensity: manifest.print_density,
      ground: variant.ground,
      recommendedUse: variant.use,
      useBucket: bucket,
      manifest,
      overrides: variant.overrides,
      isFamilyReference: Object.keys(variant.overrides).length === 0,
      defaultColourway: defaultColourway.id,
      // The ids this entry offers, in the approved order. Stored on the row so
      // the server can validate a requested colourway against *this template's*
      // curated set — an id is only meaningful inside its own family.
      colourways: colourwaysForFamily(family.key).map((cw) => cw.id),
      archetypeCoverage: Object.keys(variant.overrides).length === 0 ? 'built' : 'manifest',
      source: 'claude-design/investment-compass-template-catalogue',
      reportFormat: format.key,
    },
    schema: {
      version: 1 as const,
      name: variant.name,
      tokens: compassTokens(c, family.key),
      pages,
    },
  };
}
