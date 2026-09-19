/**
 * Which private artifact, if any, a staged path is.
 *
 * ## Why this file exists
 *
 * This rule was written TWICE — once here, inline in
 * `pdf-import-release-gate.mjs`, and once in
 * `src/lib/reportTemplate/ingestion/releaseGate/releaseGateSafetyScanner.ts`.
 * The TypeScript copy is the one the unit tests exercise. The `.mjs` copy is
 * the one CI actually runs.
 *
 * On 30 Aug 2026 that difference cost a full round trip. A brand asset repair
 * was failing the gate, so the classification was narrowed — in the TypeScript
 * copy. Four new specs passed, the change merged, it cascaded to the clone, and
 * `pdf-import-release-gate` failed on exactly the same file, because the copy
 * that decides had not moved.
 *
 * The script runs under plain `node` with no build step and nothing in
 * `scripts/` imports from `src/`, so one shared module is not available across
 * that boundary. What IS available is making each side a real module and
 * pinning them to each other: this file is the script's implementation, and
 * `pdfImportArtifactClassContract.spec.ts` imports both and fails when they
 * answer differently. Two implementations that cannot disagree without a red
 * test is the honest version of one implementation.
 *
 * Pure. No imports, no side effects — so a test can load it without running the
 * gate.
 */

/**
 * Trees whose whole purpose is to hold committed assets.
 *
 * A raster inside one of these is part of the application — bundled by Vite or
 * served from `public/` to every visitor — and is reviewed as such. A raster
 * anywhere else is a candidate artifact: something a PDF-import run rendered
 * and somebody committed by accident, which is what this scan exists to catch.
 *
 * The classification used to be the extension alone, and that made a brand
 * asset unlandable. `public/brand/aurixa-emblem-240.png` had been corrupted on
 * a downstream clone and the repair could not merge, because the pull request
 * carrying it failed `[critical] no_generated_images_staged` — naming a file
 * that is *supposed* to be in the repository. This repository carries 33
 * committed rasters across these two trees; under the old rule, touching any
 * one of them failed the gate.
 *
 * This is a real narrowing and worth stating plainly: a rendered page from a
 * client's document, placed deliberately in the shipped asset tree, is no
 * longer caught here. What still catches it is that `.pdf` remains critical
 * EVERYWHERE including these trees, the log/env and signed-URL rules are
 * untouched, and putting a customer artifact into the publicly served bundle
 * is a conspicuous act in review rather than the quiet slip this rule is aimed
 * at — a scratch file left behind in `reports/`, `tmp/` or the repository root.
 */
export const COMMITTED_ASSET_TREES = [/^public\//, /^src\/assets\//];

export function isCommittedAsset(path) {
  return COMMITTED_ASSET_TREES.some((rx) => rx.test(path));
}

/**
 * `[code, checkId]` for a staged path, or `[null, null]` when it is ordinary.
 *
 * Order matters and is asserted by the contract spec: `.pdf` is judged BEFORE
 * the asset-tree exemption, because a PDF under `public/` is not a brand asset
 * — it is a document published to the internet.
 */
export function classifyArtifact(path) {
  const l = String(path).toLowerCase();
  if (l.endsWith('.pdf')) return ['private_pdf', 'no_private_pdfs_staged'];
  if (/\.(png|jpe?g|webp)$/.test(l) && !isCommittedAsset(String(path))) {
    return ['private_image', 'no_generated_images_staged'];
  }
  if (l.endsWith('.log') || isSecretDotenv(l)) {
    return ['private_log_or_env', 'no_logs_or_env_staged'];
  }
  if (
    l.includes('signed-url') ||
    l.includes('signed_url') ||
    l.includes('cloud-run-log') ||
    l.includes('supabase-log')
  ) {
    return ['signed_url_or_log_dump', 'no_signed_url_dumps_staged'];
  }
  if (l.includes('audit-output/') || l.includes('supabase/config.toml.before-')) {
    return ['private_log_or_env', 'no_logs_or_env_staged'];
  }
  return [null, null];
}

/** The dotenv names that are templates rather than secrets. */
export const DOTENV_TEMPLATES = ['.env.example', '.env.sample', '.env.template'];

/**
 * Whether a path is a dotenv file holding secrets.
 *
 * The rule was `endsWith('.env') || includes('/.env')`, which catches `.env`
 * and `dir/.env` and misses **`.env.local`** — the file this project's own
 * `.gitignore` names as where secrets live ("secrets live only in `.env` /
 * `.env.local`, never in a committed file"). A check called "No logs or .env
 * staged" that cannot see `.env.local` at the repository root is not doing the
 * one job its name claims, and the contract spec found it the first time both
 * copies were asked the same question.
 *
 * `.env.example` is committed on purpose and is the single `!` exception in
 * `.gitignore`, so it and its two conventional siblings are excluded by name.
 * That cannot leak a secret unless somebody puts one in a file called
 * `.example`, which is a different problem from this one.
 */
export function isSecretDotenv(lowerPath) {
  const base = lowerPath.slice(lowerPath.lastIndexOf('/') + 1);
  if (!base.startsWith('.env')) return false;
  return !DOTENV_TEMPLATES.includes(base);
}
