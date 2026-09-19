/**
 * Inline the product's default report assets into a module the Edge Function
 * can import.
 *
 * ## Why this exists
 *
 * `render-investment-report-pdf/index.ts` referenced its cover art by absolute
 * URL — `https://npc-property-dashbord.lovable.app/templates/…` — on a
 * client-facing premium PDF. Three problems, all silent:
 *
 *  1. It is a **preview host**, not the production origin.
 *  2. Every render makes an outbound fetch from the WeasyPrint container, which
 *     the SSRF guard has to resolve and allow. A slow or 404 response prints a
 *     blank cover; nothing raises.
 *  3. A re-issue of an old report depends on that host still serving that path,
 *     so the document is not reproducible.
 *
 * Inlining fixes all three and changes no pixels — it is the same file.
 *
 * ## Why a generated module rather than a runtime file read
 *
 * Edge Functions bundle their TypeScript; whether a sibling binary is deployed
 * alongside depends on the CLI version, and "the cover silently vanished after
 * a CLI upgrade" is exactly the class of failure this is removing. A module is
 * unambiguous.
 *
 *   npm run reportkit:assets          # regenerate
 *   npm run reportkit:assets:check    # CI — fails if the module has drifted
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_ASSET_BYTES,
  base64ByteLength,
  inlineAsset,
} from '../../src/lib/reportDesign/assets.pure';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '../..');
const OUT = resolve(REPO, 'scripts/reportDesign/generated/defaultAssets.generated.ts');

interface AssetSpec {
  /** Exported constant name. */
  name: string;
  /** Path relative to the repo root. */
  file: string;
  mime: 'image/jpeg' | 'image/png';
  /** Why this asset exists, written into the generated file. */
  note: string;
}

const ASSETS: AssetSpec[] = [
  {
    name: 'NPC_HOUSE_COVER_ART',
    file: 'public/templates/npc-portfolio-cover-new.jpg',
    mime: 'image/jpeg',
    note: 'HOUSE ASSET — NOT TENANT-NEUTRAL. 1131x1600. This is not a photograph: '
      + 'it is a finished NPC cover with "NAIDU PROPERTY CONSULTING SERVICES", the '
      + 'tagline and the monogram burned into the pixels. It exists here only so '
      + 'the legacy renderer stops fetching it from a preview host over the '
      + 'network. It must NEVER be a white-label fallback — a tenant whose report '
      + 'carries our company name on the cover is the defect this programme is '
      + 'removing, not one to reintroduce.',
  },
  {
    name: 'NPC_HOUSE_MARK',
    file: 'public/images/npc-logo-monogram.png',
    mime: 'image/png',
    note: 'HOUSE ASSET. The woven-N monogram, 559x447 on transparency. Passed to '
      + 'the snapshot builder only when the issuing company IS us; a tenant who '
      + 'has uploaded no mark gets no mark, not ours. It is the only clean mark in '
      + 'the repo — every other "logo" file is an email-signature banner with the '
      + 'director\'s mobile number burned into the pixels, which must never reach '
      + 'a client PDF.',
  },
];

function toDataUri(spec: AssetSpec): { uri: string; bytes: number } {
  const buf = readFileSync(resolve(REPO, spec.file));
  const uri = `data:${spec.mime};base64,${buf.toString('base64')}`;

  // The generated module must satisfy the same policy the render enforces,
  // rather than being exempt because it ships with the product.
  const check = inlineAsset(uri);
  if (!check.ok) {
    throw new Error(`${spec.file}: ${check.reason} — ${check.detail}`);
  }
  if (buf.byteLength !== base64ByteLength(uri.split(',')[1])) {
    throw new Error(`${spec.file}: base64 length disagrees with the file length`);
  }
  return { uri, bytes: buf.byteLength };
}

function render(): string {
  const blocks = ASSETS.map((spec) => {
    const { uri, bytes } = toDataUri(spec);
    const wrapped = uri.replace(/(.{100})/g, '$1\\\n');
    return `/**
 * ${spec.note.replace(/\n/g, '\n * ')}
 *
 * Source: \`${spec.file}\` (${bytes.toLocaleString('en-AU')} bytes, ${spec.mime}).
 */
export const ${spec.name} = '${wrapped}';`;
  });

  // No eslint-disable directive: the payload trips no rule, and an unused
  // directive is itself a warning.
  return `/**
 * Default report assets, inlined — GENERATED. Do not edit.
 *
 * Generator: \`scripts/reportDesign/buildDefaultAssets.ts\`.
 * Regenerate: \`npm run reportkit:assets\`. CI runs \`:check\` and fails on drift.
 *
 * These are \`data:\` URIs because a report must render without the network. See
 * \`assets.pure.ts\` for the policy and \`weasyprint-service/app.py\` lines 39-40
 * for the guard that exempts \`data:\` from SSRF resolution.
 *
 * Total inlined: ${ASSETS.reduce((n, s) => n + toDataUri(s).bytes, 0).toLocaleString('en-AU')} bytes
 * decoded, against a ${MAX_ASSET_BYTES.toLocaleString('en-AU')}-byte per-asset cap.
 */

${blocks.join('\n\n')}
`;
}

const next = render();
const check = process.argv.includes('--check');

if (check) {
  let current = '';
  try {
    current = readFileSync(OUT, 'utf8');
  } catch {
    console.error(`✗ ${OUT} does not exist — run \`npm run reportkit:assets\``);
    process.exit(1);
  }
  if (current !== next) {
    console.error('✗ default report assets have drifted from the source files.');
    console.error('  Run `npm run reportkit:assets` and commit the result.');
    process.exit(1);
  }
  console.log('✓ default report assets match their source files');
} else {
  writeFileSync(OUT, next, 'utf8');
  console.log(`✓ wrote ${OUT}`);
  for (const spec of ASSETS) {
    console.log(`  ${spec.name} ← ${spec.file} (${toDataUri(spec).bytes.toLocaleString('en-AU')} bytes)`);
  }
}
