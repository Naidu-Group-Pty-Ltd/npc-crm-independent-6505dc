#!/usr/bin/env node
/**
 * PDF Extraction V3 · E12 — private-artifact leakage scanner V2.
 *
 * Fails (exit 1) when the repository / staged files / evidence directories / report
 * JSON contain a private PDF or image binary (outside the approved generated temp
 * scope), a signed/blob/data URL, a bearer token / credential, a Document AI
 * processor resource, a service endpoint, or a `.env`. No blanket exclusion for
 * report directories. False positives are reported (not silently ignored).
 *
 * Usage:
 *   node artifact-scan.mjs [--staged] [--dir <path>] [--json]
 */
import { execSync } from 'node:child_process';
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const stagedOnly = args.includes('--staged');
const jsonOut = args.includes('--json');
const dirArgIdx = args.indexOf('--dir');
const scanDir = dirArgIdx >= 0 ? args[dirArgIdx + 1] : null;

// Approved generated-only temp scope; anything else is subject to the media ban.
const APPROVED_TMP = /(^|\/)\.pdf-v3-tmp\//;
const MEDIA_EXT = /\.(pdf|png|jpe?g|webp|gif|bmp|tiff?)$/i;
const FONT_MODEL_EXT = /\.(ttf|otf|woff2?|onnx|pt|bin|safetensors|gguf)$/i;

const SIGNED_URL_RE = /(https?:\/\/[^\s"']*(token|signature|x-goog|amz-)[^\s"']*)|blob:[^\s"']+|data:[^\s"']{40,}/i;
const BEARER_RE = /bearer\s+[a-z0-9._-]{16,}/i;
const CRED_RE = /(service_role|SUPABASE_SERVICE_ROLE_KEY|api[_-]?key\s*[:=]|secret\s*[:=]|password\s*[:=])/i;
const PROCESSOR_RE = /projects\/[^/\s"']+\/locations\/[^/\s"']+\/processors\//i;
const ENDPOINT_RE = /https?:\/\/[a-z0-9-]+\.run\.app/i;

function listFiles() {
  if (scanDir) {
    if (!existsSync(scanDir)) return [];
    const out = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { if (!/node_modules|\.git/.test(full)) walk(full); }
        else out.push(path.relative(ROOT, full));
      }
    };
    walk(scanDir);
    return out;
  }
  const cmd = stagedOnly ? 'git diff --cached --name-only' : 'git ls-files';
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n').filter(Boolean); }
  catch { return []; }
}

const findings = [];
function flag(file, code, detail) { findings.push({ file, code, detail }); }

for (const file of listFiles()) {
  const rel = file.replace(/\\/g, '/');
  // 1. Binary media / font / model files anywhere tracked (approved temp is ignored by git).
  if (MEDIA_EXT.test(rel) && !APPROVED_TMP.test(rel)) flag(rel, 'private_media_committed', 'media binary outside approved temp scope');
  if (FONT_MODEL_EXT.test(rel)) flag(rel, 'font_or_model_binary_committed', 'font/model binary');
  if (/(^|\/)\.env(\.|$)/.test(rel)) flag(rel, 'env_file', '.env committed');

  // 2. Text-content scan (skip binaries / lockfiles / this scanner).
  const full = path.join(ROOT, file);
  if (!existsSync(full)) continue;
  let size = 0;
  try { size = statSync(full).size; } catch { continue; }
  if (size > 2_000_000) continue;
  if (MEDIA_EXT.test(rel) || FONT_MODEL_EXT.test(rel)) continue;
  // The scanner's own pattern-definition files legitimately CONTAIN the detection
  // vocabulary; exempt them from the TEXT scan only (they are still media-scanned
  // above, so a committed binary in them is still caught). This is a targeted,
  // documented exemption — never a blanket report-directory exclusion.
  const SCANNER_MACHINERY = [
    /scripts\/regression\/pdf-extraction-v3\/artifact-scan\.mjs$/,
    /ingestion\/releaseV3\/redaction\.ts$/,
  ];
  if (SCANNER_MACHINERY.some((re) => re.test(rel))) continue;
  let text = '';
  try { text = readFileSync(full, 'utf8'); } catch { continue; }
  if (SIGNED_URL_RE.test(text)) flag(rel, 'signed_url', 'signed/blob/data URL present');
  if (BEARER_RE.test(text)) flag(rel, 'bearer_token', 'bearer token present');
  if (CRED_RE.test(text)) flag(rel, 'credential', 'credential-like assignment present');
  if (PROCESSOR_RE.test(text)) flag(rel, 'processor_resource', 'Document AI processor resource present');
  if (ENDPOINT_RE.test(text)) flag(rel, 'service_endpoint', 'Cloud Run endpoint URL present');
}

const report = {
  version: 'pdf-artifact-scan-v2',
  scanned: stagedOnly ? 'staged' : (scanDir ?? 'tracked'),
  leakCount: findings.length,
  findings,
};

if (jsonOut) console.log(JSON.stringify(report, null, 2));
else {
  if (findings.length === 0) console.log(`✓ artifact-scan: no private-artifact leaks (${report.scanned})`);
  else {
    console.error(`✗ artifact-scan: ${findings.length} leak(s) detected (${report.scanned})`);
    for (const f of findings) console.error(`  - [${f.code}] ${f.file}: ${f.detail}`);
  }
}
process.exit(findings.length === 0 ? 0 : 1);
