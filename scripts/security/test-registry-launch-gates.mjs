import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = 'supabase/functions-registry/SECURITY_REGISTRY.json';
const dir = mkdtempSync(join(tmpdir(), 'registry-gate-'));
const fixture = join(dir, 'SECURITY_REGISTRY.json');
const trackerFixture = join(dir, 'CODEX_SECURITY_REMEDIATION_TRACKER.md');
try {
  const registry = JSON.parse(readFileSync(source, 'utf8'));
  registry.functions.__synthetic_unreviewed__ = {
    exposure_class: 'needs-review', owner: 'security-test', verify_jwt: false, reviewed: false,
  };
  writeFileSync(fixture, JSON.stringify(registry));
  for (const script of ['scripts/security/check-function-registry.mjs', 'scripts/security/wp15-launch-gate.mjs']) {
    const result = spawnSync(process.execPath, [script], { env: { ...process.env, SECURITY_REGISTRY_PATH: fixture }, encoding: 'utf8' });
    if (result.status === 0) throw new Error(`${script} accepted a synthetic unreviewed registry entry`);
    if (!`${result.stdout}\n${result.stderr}`.includes('__synthetic_unreviewed__') && script.includes('check-function')) throw new Error(`${script} did not report the synthetic entry`);
  }
  writeFileSync(trackerFixture, '{"findings":[]} trailing data');
  const trackerResult = spawnSync(process.execPath, ['scripts/security/wp15-launch-gate.mjs'], {
    env: { ...process.env, SECURITY_TRACKER_PATH: trackerFixture }, encoding: 'utf8',
  });
  if (trackerResult.status === 0) throw new Error('WP-15 launch gate accepted a malformed remediation tracker');
  if (!`${trackerResult.stdout}\n${trackerResult.stderr}`.includes('Failed to read remediation tracker')) {
    throw new Error('WP-15 launch gate did not report the malformed remediation tracker');
  }
  console.log('Registry and WP-15 launch gates reject synthetic unreviewed entries and malformed tracker JSON.');
} finally { rmSync(dir, { recursive: true, force: true }); }
