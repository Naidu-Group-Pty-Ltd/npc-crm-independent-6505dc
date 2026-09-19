/**
 * Generate the Investment Compass catalogue modules from the approved source.
 *
 * ## Why this is generated
 *
 * `source.json` is a verbatim evaluation of `FAMILIES` and `COLOURWAYS` from
 * the approved Claude Design catalogue (`Template Catalogue.dc.html`). Ten
 * families × five variants × ten colourways is 500 colour values and roughly
 * 250 manifest entries. Hand-transcribing that is not a thing a person does
 * correctly, and a single mistyped hex is a design change nobody approved and
 * nobody can see in review.
 *
 * So the transcription is mechanical, and
 * `investmentCompassSource.spec.ts` re-checks the emitted modules against
 * `source.json` on every run — a hand-edit to a generated file fails the suite
 * rather than silently becoming the new truth.
 *
 * Run:  npm run templates:compass:generate
 *
 * Emits:
 *   - `families.generated.ts`            (families, variants, manifests)
 *   - `_shared/templateColourways.generated.ts` (all 100 colourways)
 *
 * To re-sync after a change in Claude Design: re-extract `source.json` from the
 * Design project, re-run this, and read the diff.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../../..');
const SOURCE = resolve(__dirname, 'source.json');

interface SourceVariantRow extends Array<unknown> {
  0: string;  // name
  1: string;  // id
  2: string;  // ground
  3: string;  // density
  4: string;  // architecture
  5: string;  // recommended use
  6: string;  // description
  7: Record<string, string>; // overrides
}

interface SourceFamily {
  code: string;
  no: string;
  name: string;
  note: string;
  faces: string;
  face: string;
  nameWeight: number;
  mode: string;
  pal: Record<string, string>;
  base: Record<string, string>;
  variants: SourceVariantRow[];
}

interface Source {
  FAMILIES: SourceFamily[];
  COLOURWAYS: Record<string, Array<[string, string, string, string, string, string, string]>>;
}

const source: Source = JSON.parse(readFileSync(SOURCE, 'utf8'));

/** `Gold on Obsidian` → `pb-gold-on-obsidian`. */
function colourwayId(familyCode: string, name: string): string {
  return `${familyCode}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/** Family key from the manifest's own `design_family`. */
function familyKey(family: SourceFamily): string {
  return family.base.design_family;
}

function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function manifestLiteral(entries: Record<string, string>, indent: string): string {
  const keys = Object.keys(entries);
  if (keys.length === 0) return '{}';
  return `{\n${keys.map((k) => `${indent}  ${k}: ${q(entries[k])},`).join('\n')}\n${indent}}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Colourways
// ─────────────────────────────────────────────────────────────────────────────

function emitColourways(): string {
  const blocks: string[] = [];
  const registry: string[] = [];

  for (const family of source.FAMILIES) {
    const key = familyKey(family);
    const constName = `${key.toUpperCase()}_COLOURWAYS`;
    const rows = source.COLOURWAYS[family.code];
    const lines = rows.map(([name, paper, ink, accent, rule, muted, ground]) =>
      `  { id: ${q(colourwayId(family.code, name))}, name: ${q(name)}, `
      + `paper: ${q(paper)}, ink: ${q(ink)}, accent: ${q(accent)}, `
      + `rule: ${q(rule)}, muted: ${q(muted)}, ground: ${q(ground)} },`);

    const lightCount = rows.filter((r) => r[6] === 'light').length;
    blocks.push(
      `/**\n`
      + ` * ${family.no} — ${family.name}. ${family.note}.\n`
      + ` *\n`
      + ` * ${lightCount} light ground${lightCount === 1 ? '' : 's'} and `
      + `${rows.length - lightCount} dark. Index 0 is the family default.\n`
      + ` */\n`
      + `export const ${constName}: readonly ApprovedColourway[] = [\n${lines.join('\n')}\n];`,
    );
    registry.push(`  ${key}: ${constName},`);
  }

  return `/**
 * Investment Compass colourways — GENERATED, do not hand-edit.
 *
 * Emitted by \`scripts/template-library/investmentCompass/generate.ts\` from
 * \`source.json\`, which is a verbatim evaluation of \`COLOURWAYS\` in the
 * approved Claude Design catalogue. Its own key order is declared there as
 * \`CW_KEYS = ['colourway','paper','ink','accent','rule','muted','ground']\`.
 *
 * Every value here is a design decision taken in Claude Design. Editing one to
 * fix a contrast problem is a design change made by an engineer — take it to
 * the Design source instead. \`investmentCompassSource.spec.ts\` compares this
 * file against \`source.json\` and fails if they disagree.
 *
 * The derivations that turn these six values into every colour role a block can
 * address live in \`templateColourways.pure.ts\`.
 */
/* eslint-disable no-restricted-syntax --
 * Token DEFINITIONS. These hexes are what \`token:*\` resolves to; see the
 * contract note in templateColourways.pure.ts.
 */
import type { ApprovedColourway } from './templateColourways.pure.ts';

${blocks.join('\n\n')}

/** Every family's colourways, keyed by \`design_family\`. */
export const COLOURWAYS_BY_FAMILY: Readonly<Record<string, readonly ApprovedColourway[]>> = {
${registry.join('\n')}
};
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Families
// ─────────────────────────────────────────────────────────────────────────────

function emitFamilies(): string {
  const blocks: string[] = [];
  const registry: string[] = [];

  for (const family of source.FAMILIES) {
    const key = familyKey(family);
    const constName = key.toUpperCase();
    const variants = family.variants.map((row) => {
      const [name, code, ground, density, architecture, use, description, overrides] = row as unknown as
        [string, string, string, string, string, string, string, Record<string, string>];
      return `    {\n`
        + `      name: ${q(name)},\n`
        + `      code: ${q(code)},\n`
        + `      ground: ${q(ground)},\n`
        + `      density: ${q(density)},\n`
        + `      architecture: ${q(architecture)},\n`
        + `      use: ${q(use)},\n`
        + `      description:\n        ${q(description)},\n`
        + `      overrides: ${manifestLiteral(overrides, '      ')},\n`
        + `    },`;
    });

    blocks.push(
      `/** ${family.no} — ${family.name}. ${family.note}. */\n`
      + `export const ${constName}: DesignFamily = {\n`
      + `  key: ${q(key)},\n`
      + `  code: ${q(family.code)},\n`
      + `  ordinal: ${q(family.no)},\n`
      + `  name: ${q(family.name)},\n`
      + `  note: ${q(family.note)},\n`
      + `  faces: ${q(family.faces)},\n`
      + `  base: ${manifestLiteral(family.base, '  ')},\n`
      + `  variants: [\n${variants.join('\n')}\n  ],\n`
      + `};`,
    );
    registry.push(`  ${constName},`);
  }

  // The recommended-use buckets, transcribed from USE_MATCH but derived here
  // from the variants themselves so the two cannot disagree.
  return `/**
 * Investment Compass design families — GENERATED, do not hand-edit.
 *
 * Emitted by \`scripts/template-library/investmentCompass/generate.ts\` from
 * \`source.json\`, a verbatim evaluation of \`FAMILIES\` in the approved Claude
 * Design catalogue. Ten families, five structural variants each.
 *
 * A family is a \`base\` manifest plus, per variant, a sparse override object;
 * the resolved manifest is \`Object.assign({}, base, overrides)\`, which is
 * exactly how the catalogue itself resolves it. \`resolveManifest()\` in
 * \`family.ts\` is that operation.
 *
 * \`investmentCompassSource.spec.ts\` compares this file against
 * \`source.json\` and fails if they disagree.
 */
import type { DesignFamily } from './family';

${blocks.join('\n\n')}

/** The ten approved families, in catalogue order. */
export const DESIGN_FAMILIES: readonly DesignFamily[] = [
${registry.join('\n')}
];
`;
}

function main(): void {
  const colourways = resolve(REPO, 'supabase/functions/_shared/templateColourways.generated.ts');
  const families = resolve(__dirname, 'families.generated.ts');

  writeFileSync(colourways, emitColourways());
  writeFileSync(families, emitFamilies());

  const familyCount = source.FAMILIES.length;
  const variantCount = source.FAMILIES.reduce((n, f) => n + f.variants.length, 0);
  const colourwayCount = Object.values(source.COLOURWAYS).reduce((n, c) => n + c.length, 0);

  console.log('✓ generated from the approved Claude Design source');
  console.log(`  ${familyCount} families, ${variantCount} masters, ${colourwayCount} colourways`);
  console.log(`  → ${families.replace(`${REPO}/`, '')}`);
  console.log(`  → ${colourways.replace(`${REPO}/`, '')}`);
}

main();
