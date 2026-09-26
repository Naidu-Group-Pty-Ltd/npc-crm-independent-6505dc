/**
 * The catalogue's fifty designs, as the standard documents draw them.
 *
 * ## Why this exists
 *
 * A chosen template changes how a document looks and nothing else (the
 * owner's rule, 26 Sep 2026). For every report type but Investment that means
 * the report's own standard document is drawn in the chosen design: its cover
 * ground, its typefaces, its colourway, its table and heading treatment. The
 * masters' page sequences are never drawn for those report types.
 *
 * Everything a design is lives in this directory — `families.generated.ts`,
 * `family.ts` and `resolvers.ts` — and none of it can be imported by an edge
 * function: `family.ts` imports `./families.generated` without an extension,
 * which Deno cannot resolve. So the facts the standard documents need are
 * emitted here, mechanically, into a Deno-parseable module beside the
 * stylesheet that reads them. `templateDesignCatalogue.spec.ts` derives the
 * same rows in memory and fails if the file disagrees, exactly as
 * `investmentCompassSource.spec.ts` does for the families themselves.
 *
 * Run:    npm run templates:design:generate
 * Check:  npm run templates:design:check
 *
 * Emits: `supabase/functions/_shared/reportDesign/templateDesignCatalogue.generated.pure.ts`
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  axisFor,
  DESIGN_FAMILIES,
  resolveManifest,
  scaleFor,
  typographyFor,
  type Density,
} from './family';
import { coverPlan, hasRail, sectionHeaderKind, tablePlan } from './resolvers';
import { defaultColourwayFor } from '../../../supabase/functions/_shared/templateColourways.pure';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../..');
export const DESIGN_CATALOGUE_PATH = resolve(
  REPO,
  'supabase/functions/_shared/reportDesign/templateDesignCatalogue.generated.pure.ts',
);

/** One design, in the vocabulary the standard stylesheet reads. */
export interface CatalogueDesignRow {
  code: string;
  name: string;
  familyKey: string;
  familyCode: string;
  familyName: string;
  axis: string;
  ground: 'light' | 'dark';
  density: Density;
  cover: { ground: 'field' | 'band' | 'paper'; frame: boolean; rail: boolean };
  rail: boolean;
  sectionKind: 'eyebrow' | 'numeral' | 'bare' | 'band' | 'decimal' | 'standfirst';
  dropCap: boolean;
  table: {
    headerStyle: 'fill' | 'rule';
    rowRule: boolean;
    outerBorder: boolean;
    gridLines: boolean;
    stripe: boolean;
    tight: boolean;
    doubleRuleTotals: boolean;
  };
  radius: number;
  fonts: {
    display: string; displayGeneric: string;
    heading: string; headingGeneric: string;
    body: string; bodyGeneric: string;
    mono: string; monoGeneric: string;
  };
  coverTitlePt: number;
  defaultColourway: string;
}

/** `'4px'` → 4, `'0'` → 0. A radius the manifest does not state is none. */
function radiusOf(value: string | undefined): number {
  const n = Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Every design, in catalogue order: family by family, reference variant first. */
export function buildCatalogueDesignRows(): CatalogueDesignRow[] {
  const rows: CatalogueDesignRow[] = [];
  for (const family of DESIGN_FAMILIES) {
    const type = typographyFor(family.key);
    const colourway = defaultColourwayFor(family.key);
    if (!colourway) throw new Error(`No colourway for family "${family.key}"`);
    for (const variant of family.variants) {
      const manifest = resolveManifest(family, variant);
      const cover = coverPlan(manifest.cover_overlay);
      const plan = tablePlan(manifest.table_style);
      rows.push({
        code: variant.code,
        name: variant.name,
        familyKey: family.key,
        familyCode: family.code,
        familyName: family.name,
        axis: axisFor(family, variant),
        ground: variant.ground,
        density: variant.density,
        cover: { ground: cover.ground, frame: cover.frame === true, rail: cover.rail === true },
        rail: hasRail(manifest.navigation_style),
        sectionKind: sectionHeaderKind(manifest.section_header_style),
        dropCap: manifest.section_header_style === 'drop_cap_opener',
        table: {
          headerStyle: plan.headerStyle,
          rowRule: plan.rowRule,
          outerBorder: plan.outerBorder,
          gridLines: plan.gridLines,
          stripe: plan.stripe,
          tight: plan.tight,
          doubleRuleTotals: plan.doubleRuleTotals,
        },
        radius: radiusOf(manifest.radius),
        fonts: {
          display: type.display, displayGeneric: type.displayGeneric,
          heading: type.heading, headingGeneric: type.headingGeneric,
          body: type.body, bodyGeneric: type.bodyGeneric,
          mono: type.mono, monoGeneric: type.monoGeneric,
        },
        coverTitlePt: scaleFor(family.key, variant.density).coverTitle,
        defaultColourway: colourway.id,
      });
    }
  }
  return rows;
}

/** A TypeScript literal for a row, stable key order, single-quoted strings. */
function literal(value: unknown, indent: string): string {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const inner = `${indent}  `;
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${inner}${k}: ${literal(v, inner)},`);
    return `{\n${entries.join('\n')}\n${indent}}`;
  }
  throw new Error(`Cannot emit ${String(value)}`);
}

/** The module text. Deterministic for a given catalogue. */
export function renderCatalogueModule(rows: CatalogueDesignRow[]): string {
  const body = rows.map((row) => `  ${literal(row, '  ')},`).join('\n');
  return `/**
 * The catalogue's fifty designs, as the standard documents draw them —
 * GENERATED, do not hand-edit.
 *
 * Emitted by \`scripts/template-library/investmentCompass/designCatalogue.ts\`
 * from the approved families (\`families.generated.ts\`), the measured type
 * table (\`family.ts\`) and the manifest resolvers (\`resolvers.ts\`) — the same
 * three sources every master is built from, so a design cannot mean one thing
 * on a master and another on a standard document.
 *
 * \`templateDesignCatalogue.spec.ts\` derives these rows again and fails if this
 * file disagrees. Change a design in Claude Design, bring it through
 * \`npm run templates:compass:generate\`, then run
 * \`npm run templates:design:generate\` and read the diff.
 *
 * Pure data, no imports: it is read by edge functions and by the browser.
 */

export interface CatalogueVariantDesign {
  /** The approved catalogue code, e.g. \`pb-01\`. */
  readonly code: string;
  /** The approved design name, e.g. \`Chancery\`. */
  readonly name: string;
  readonly familyKey: string;
  readonly familyCode: string;
  readonly familyName: string;
  /** The variant axis, e.g. \`A · reference\`. */
  readonly axis: string;
  /** The ground the design was drawn on. The colourway decides the one printed. */
  readonly ground: 'light' | 'dark';
  readonly density: 'compact' | 'balanced' | 'spacious';
  /** How the cover is grounded, from the manifest's \`cover_overlay\`. */
  readonly cover: {
    readonly ground: 'field' | 'band' | 'paper';
    readonly frame: boolean;
    readonly rail: boolean;
  };
  /** A vertical rail down the binding edge of every page. */
  readonly rail: boolean;
  /** How a section announces itself, from \`section_header_style\`. */
  readonly sectionKind: 'eyebrow' | 'numeral' | 'bare' | 'band' | 'decimal' | 'standfirst';
  /** A drop capital opens the first paragraph of a section. */
  readonly dropCap: boolean;
  /** How a data table is ruled, from \`table_style\`. */
  readonly table: {
    readonly headerStyle: 'fill' | 'rule';
    readonly rowRule: boolean;
    readonly outerBorder: boolean;
    readonly gridLines: boolean;
    readonly stripe: boolean;
    readonly tight: boolean;
    readonly doubleRuleTotals: boolean;
  };
  /** Corner radius in points. Non-zero on one family only. */
  readonly radius: number;
  /** The four type roles, as the family's pages set them. */
  readonly fonts: {
    readonly display: string; readonly displayGeneric: string;
    readonly heading: string; readonly headingGeneric: string;
    readonly body: string; readonly bodyGeneric: string;
    readonly mono: string; readonly monoGeneric: string;
  };
  /** The measured cover title size at this design's density, in points. */
  readonly coverTitlePt: number;
  /** The family's default colourway id. */
  readonly defaultColourway: string;
}

export const CATALOGUE_VARIANT_DESIGNS: readonly CatalogueVariantDesign[] = [
${body}
];
`;
}

function main(): void {
  const check = process.argv.includes('--check');
  const text = renderCatalogueModule(buildCatalogueDesignRows());
  if (check) {
    let current = '';
    try { current = readFileSync(DESIGN_CATALOGUE_PATH, 'utf8'); } catch { /* absent is drift */ }
    if (current !== text) {
      console.error(`✗ ${DESIGN_CATALOGUE_PATH} is not what the catalogue produces. Run npm run templates:design:generate.`);
      process.exit(1);
    }
    console.log('✓ the design catalogue module matches the approved families');
    return;
  }
  writeFileSync(DESIGN_CATALOGUE_PATH, text);
  console.log(`wrote ${DESIGN_CATALOGUE_PATH}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
