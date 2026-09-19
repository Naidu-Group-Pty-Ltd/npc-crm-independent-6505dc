/**
 * Check the committed Claude Design manifest against the print tokens.
 *
 * `npm run brand:sync`
 *
 * ## What is committed, and why
 *
 * `claudeDesign/npc-services.manifest.json` is the consumed subset of
 * `_ds_manifest.json` from the **NPC Services Design System** project on
 * claude.ai/design (`f624bc09-6668-478c-90de-6193961cf023`). It is the file the
 * brand-systems page seeds the house system from, and the fixture
 * `src/lib/brandDesign/__tests__/import.spec.ts` runs the derivation against.
 *
 * It is committed rather than fetched because the app cannot reach
 * claude.ai/design: `DesignSync` is a Claude Code tool authenticated by a
 * person's claude.ai login, and neither the browser (anon key) nor an edge
 * function (service role) holds one. This mirrors the direction the repo
 * already has — `.design-system/report-templates/` is generated here and pushed
 * *to* the project — with one flowing the other way.
 *
 * ## Refreshing it
 *
 * Ask Claude Code, in a session with design-system authorization:
 *
 *   1. `DesignSync { method: 'list_projects' }` — find the project id.
 *   2. `DesignSync { method: 'get_file', path: '_ds_manifest.json' }`.
 *   3. Keep `namespace`, `globalCssPaths`, `themes`, `fonts`, `brandFonts`,
 *      `tokens` and `cards`; drop `components`, `startingPoints` and
 *      `templates`, which this consumes nothing of.
 *   4. Run `npm run brand:sync`.
 *
 * ## What this asserts
 *
 * That the derivation in `brandDesign/import.pure.ts` still reproduces the
 * print tokens exactly. `reportDesign/tokens.pure.ts` states every print value
 * as a derivation of a named design-system variable — `paper` is
 * `--background`, the cover `field` is `--aurixa-obsidian`, and so on — and
 * until the import existed that was prose in a comment. This is the check that
 * keeps the prose true, in both directions: it fails if somebody edits a print
 * token without moving the design system, and if somebody re-syncs a design
 * system that has moved without the print tokens following.
 *
 * A failure is not necessarily a bug. It means the two have diverged and a
 * person has to decide which is right — which is exactly what the repo's own
 * precedence rule says (`FRONTEND_TOOLING.md`: where they disagree, the repo
 * wins and the project needs re-syncing).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveReportNeutrals,
  readDesignSystemManifest,
} from '../../supabase/functions/_shared/brandDesign/import.pure.ts';
import {
  PRINT_BRAND,
  PRINT_INK,
  PRINT_SURFACE,
} from '../../supabase/functions/_shared/reportDesign/tokens.pure.ts';
import {
  auditPaletteContrast,
  resolveReportPalette,
} from '../../supabase/functions/_shared/reportDesign/brandResolve.pure.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MANIFEST_PATH = resolve(HERE, 'claudeDesign/npc-services.manifest.json');

/** What the derivation must reproduce, and where each value is stated. */
const EXPECTED: Array<[string, string, string]> = [
  ['paper', PRINT_SURFACE.paper, '--background'],
  ['paperAlt', PRINT_SURFACE.paperAlt, '--muted'],
  ['paperBright', PRINT_SURFACE.paperBright, '--card'],
  ['field', PRINT_SURFACE.field, '--aurixa-obsidian'],
  ['rule', PRINT_SURFACE.rule, '--border'],
  ['bodyInk', PRINT_INK.body, '--foreground'],
  ['mutedInk', PRINT_INK.muted, '--muted-foreground'],
];

function main(): void {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const read = readDesignSystemManifest(raw);
  if (!read.ok) {
    console.error(`✖ the committed manifest is unreadable: ${read.error}`);
    process.exit(1);
  }

  const { manifest } = read;
  const colours = manifest.tokens.filter((t) => t.kind === 'color').length;
  console.log(`Design system : ${manifest.namespace}`);
  console.log(`Tokens        : ${manifest.tokens.length} (${colours} colours)`);
  console.log(`Cards         : ${manifest.cards.length}`);
  console.log(`Themes        : ${manifest.themes.map((t) => t.label || t.selector).join(', ') || '—'}`);
  console.log(`Brand fonts   : ${manifest.brandFonts.map((f) => f.family).join(', ') || '—'}`);
  console.log('');

  const derived = deriveReportNeutrals(manifest.tokens);
  if (!derived.ok) {
    console.error(`✖ the derivation refused this manifest: ${derived.error}`);
    process.exit(1);
  }

  const failures: string[] = [];
  for (const [role, expected, source] of EXPECTED) {
    const got = derived.derived.neutrals[role as keyof typeof derived.derived.neutrals];
    const from = derived.derived.sources[role as keyof typeof derived.derived.sources];
    const ok = got === expected;
    console.log(
      `  ${ok ? '✓' : '✖'} ${role.padEnd(12)} ${String(from).padEnd(22)} ${got}`
      + (ok ? '' : `   expected ${expected} (from ${source})`),
    );
    if (!ok) failures.push(`${role}: got ${got}, tokens.pure.ts says ${expected}`);
  }

  const brandOk = derived.derived.brandHex === PRINT_BRAND.base;
  console.log(
    `  ${brandOk ? '✓' : '✖'} ${'brand'.padEnd(12)} ${String(derived.derived.sources.brand).padEnd(22)}`
    + ` ${derived.derived.brandHex}`
    + (brandOk ? '' : `   expected ${PRINT_BRAND.base}`),
  );
  if (!brandOk) failures.push(`brand: got ${derived.derived.brandHex}, tokens.pure.ts says ${PRINT_BRAND.base}`);

  if (derived.derived.notes.length) {
    console.log('\nSubstitutions:');
    for (const note of derived.derived.notes) console.log(`  · ${note}`);
    failures.push(
      `${derived.derived.notes.length} role(s) needed a substitution — the house design system `
      + 'has lost a variable the print layer depends on',
    );
  }

  const problems = auditPaletteContrast(resolveReportPalette({
    neutrals: derived.derived.neutrals,
    brandHex: derived.derived.brandHex,
  }));
  if (problems.length) {
    console.log('\nContrast:');
    for (const p of problems) {
      console.log(`  ✖ ${p.role} on ${p.ground} is ${p.ratio.toFixed(2)}:1 against ${p.floor.toFixed(1)}:1`);
    }
    failures.push(`${problems.length} contrast failure(s)`);
  }

  if (failures.length) {
    console.error('\n✖ The design system and the print tokens have diverged:\n');
    for (const f of failures) console.error(`   ${f}`);
    console.error(
      '\n  Decide which is right. FRONTEND_TOOLING.md says the repo wins and the\n'
      + '  project needs re-syncing — but if the brand genuinely moved, move\n'
      + '  reportDesign/tokens.pure.ts to match and re-run.\n',
    );
    process.exit(1);
  }

  console.log('\n✓ The derivation reproduces every print token exactly.');
}

main();
