/**
 * Put a rendered document on disk, so somebody can look at it.
 *
 * Every format in this programme is asserted with `toContain` against an
 * in-memory string. That catches what can be written down — a section that
 * never rendered, a client's name interpolated unescaped, a contents page
 * listing something that was not built. It catches nothing about the *page*:
 * a chapter opening two lines from the foot of a sheet, a table torn across a
 * break with no label on the second half, a near-empty page, a KPI label that
 * wrapped and pushed its own value below its neighbours'.
 *
 * Those were all found by rendering and reading, and until this file existed
 * only two of the ten formats could be rendered at all — the Borrowing Capacity
 * Snapshot, which wrote its own HTML, and the converter, done by hand. The
 * other eight had never been seen as a page by anybody.
 *
 * `reports/` is gitignored, so these are local artefacts, not fixtures. The
 * loop they serve:
 *
 *     npx tsx scripts/reports/renderAll.mts
 *
 * which runs the specs to produce this directory, renders each file through
 * WeasyPrint, and measures and judges the result.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The repo root, from any `src/lib/reports/<format>/__tests__` directory. */
const REPO = resolve(__dirname, '../../../..');

export const RENDER_ARTIFACT_DIR = resolve(REPO, 'reports/html');

/**
 * Write one document, named for its format.
 *
 * The name is the archetype id rather than the document's title, because
 * `renderAll.mts` reads these back and reports per format, and an archetype id
 * is the one name a format has in exactly one form.
 */
export function writeRenderArtifact(archetypeId: string, html: string): string {
  const out = resolve(RENDER_ARTIFACT_DIR, `${archetypeId}.html`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return out;
}
