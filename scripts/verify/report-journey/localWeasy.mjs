/**
 * The production render engine, run locally.
 *
 * `weasyprint-service/requirements.txt` pins the engine; the machine running
 * this check must have the SAME version installed, and this refuses to run if
 * it does not, because a document drawn by a different engine version is not
 * evidence about production. The render options are the ones the production
 * routes send (`pdf/ua-1`, tagged, optimised images).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function pinnedWeasyVersion(repoRoot) {
  const req = fs.readFileSync(path.join(repoRoot, 'weasyprint-service/requirements.txt'), 'utf8');
  return req.match(/^weasyprint==([\d.]+)/mi)?.[1] ?? null;
}

export function localWeasyVersion() {
  const r = spawnSync('python3', ['-c', 'import weasyprint; print(weasyprint.__version__)'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function assertEngineMatchesPin(repoRoot) {
  const pinned = pinnedWeasyVersion(repoRoot);
  const local = localWeasyVersion();
  if (!local) throw new Error('WeasyPrint is not installed locally (python3 -c "import weasyprint").');
  if (pinned && local !== pinned) {
    throw new Error(`Local WeasyPrint ${local} differs from the production pin ${pinned}; install the pinned version.`);
  }
  return local;
}

/** HTML → PDF bytes, with the production route's options. Returns null on failure. */
export function renderHtmlWithWeasy(html, { timeoutMs = 120_000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-weasy-'));
  const inFile = path.join(dir, 'in.html'); const outFile = path.join(dir, 'out.pdf');
  fs.writeFileSync(inFile, html);
  const py = `
import warnings, sys
warnings.filterwarnings("ignore")
from weasyprint import HTML
HTML(filename=sys.argv[1], base_url=sys.argv[1]).write_pdf(sys.argv[2], pdf_variant='pdf/ua-1', optimize_images=True, presentational_hints=False)
`;
  try {
    execFileSync('python3', ['-c', py, inFile, outFile], { timeout: timeoutMs, stdio: ['ignore', 'ignore', 'pipe'] });
    return fs.readFileSync(outFile);
  } catch (e) {
    fs.writeFileSync(path.join(dir, 'error.txt'), String(e?.stderr ?? e));
    console.error(`[localWeasy] render failed; inputs kept at ${dir}`);
    return null;
  }
}
