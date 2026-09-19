#!/usr/bin/env node
/**
 * PDF Extraction V3 · E12 — environment profile detector.
 *
 * Emits a deterministic environment-profile id so performance comparisons never
 * cross incompatible hardware/OS/browser profiles. Absolute performance
 * enforcement is only permitted on profiles that declare it. This script reads
 * NO secret and performs NO network I/O.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';

function safe(cmd) {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return null; }
}

export function detectEnvironmentProfile() {
  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  const chromiumPath = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  const hasChromium = existsSync(chromiumPath);
  const nodeVersion = process.version;
  const pythonVersion = safe('python3 --version');
  const platform = `${os.platform()}-${os.arch()}`;

  let profileId = 'local-development';
  if (isCI && os.platform() === 'linux') profileId = process.env.PDF_V3_NIGHTLY === '1' ? 'nightly-linux-chromium' : 'ci-linux-chromium';
  if (process.env.PDF_V3_PRIVATE === '1') profileId = 'private-controlled';
  if (process.env.PDF_V3_RUNTIME === '1') profileId = 'zero-traffic-runtime';

  return {
    environmentProfileId: profileId,
    operatingSystem: platform,
    nodeVersion,
    pythonVersion,
    hasChromium,
    chromiumPath: hasChromium ? chromiumPath : null,
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    // Absolute perf enforcement only on stable, declared CI profiles.
    allowAbsolutePerformanceEnforcement: profileId === 'nightly-linux-chromium',
    isCI,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(detectEnvironmentProfile(), null, 2));
}
