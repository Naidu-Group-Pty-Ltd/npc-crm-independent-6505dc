import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = join(dirname(fileURLToPath(import.meta.url)), 'dependency-audit.mjs');

function runWithAuditResponse(payload, exitCode = 0) {
  return runWithRawAuditResponse(JSON.stringify(payload), exitCode);
}

function runWithRawAuditResponse(output, exitCode = 0) {
  return runWithShim(`printf '%s\\n' '${output}'\nexit ${exitCode}`);
}

/**
 * Run the gate against an `npm` whose body is the given shell script.
 *
 * The shim counts its own invocations into `calls` beside itself, because the
 * retry tests are about HOW MANY TIMES the registry was asked — an outcome the
 * exit code alone cannot distinguish from a single attempt.
 *
 * The retry pause is zeroed here and only here: production keeps its moment
 * between attempts, while a deterministic shim gains nothing from waiting.
 */
function runWithShim(body, env = {}) {
  const binDir = mkdtempSync(join(tmpdir(), 'dependency-audit-test-'));
  const npmShim = join(binDir, 'npm');
  writeFileSync(npmShim, [
    '#!/bin/sh',
    `shim_dir="${binDir}"`,
    'count_file="$shim_dir/calls"',
    'calls=$(cat "$count_file" 2>/dev/null || echo 0)',
    'calls=$((calls + 1))',
    'printf %s "$calls" > "$count_file"',
    body,
    '',
  ].join('\n'));
  chmodSync(npmShim, 0o755);

  try {
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      // A gate that loses its time bound would hang this suite; the harness's
      // own ceiling turns that into a visible failure instead.
      timeout: 30_000,
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH}`,
        SECURITY_AUDIT_RETRY_DELAY_MS: '0',
        ...env,
      },
    });
    let calls = 0;
    try { calls = Number(readFileSync(join(binDir, 'calls'), 'utf8')) || 0; } catch { /* never ran */ }
    let shimPid = null;
    try { shimPid = Number(readFileSync(join(binDir, 'pid'), 'utf8')) || null; } catch { /* not recorded */ }
    return { ...result, calls, shimPid };
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
}

const metadata = { vulnerabilities: { total: 0, critical: 0, high: 0, moderate: 0, low: 0 } };

test('passes a valid clean npm audit report', () => {
  const result = runWithAuditResponse({ vulnerabilities: {}, metadata });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dependency audit passed/);
});

test('evaluates a valid vulnerability report returned with exit code 1', () => {
  const vulnerabilities = {
    unsafe: { severity: 'critical', via: [{ source: 123, url: 'https://example.test/advisory' }] },
  };
  const result = runWithAuditResponse({ vulnerabilities, metadata }, 1);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dependency audit FAILED/);
});

test('fails closed when npm returns a parseable operational error', () => {
  const result = runWithAuditResponse({ error: { code: 'E403', summary: 'Forbidden' } }, 1);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid audit report/);
  assert.doesNotMatch(result.stdout, /Dependency audit passed/);
});

test('fails closed when npm returns malformed output', () => {
  const result = runWithRawAuditResponse('not-json', 1);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /could not run\/parse/);
  assert.doesNotMatch(result.stdout, /Dependency audit passed/);
});

test('recovers when the registry answers on a later attempt', () => {
  const clean = JSON.stringify({ vulnerabilities: {}, metadata });
  const result = runWithShim([
    'if [ "$calls" -ge 2 ]; then',
    `  printf '%s\\n' '${clean}'`,
    '  exit 0',
    'fi',
    "printf '%s\\n' 'registry-fell-over'",
    'exit 1',
  ].join('\n'));
  assert.equal(result.status, 0);
  assert.equal(result.calls, 2);
  assert.match(result.stdout, /Dependency audit passed/);
  assert.match(result.stderr, /attempt 1 of 3 failed/);
});

test('still fails closed when every attempt fails, and says how many were made', () => {
  const result = runWithShim("printf '%s\\n' 'registry-fell-over'\nexit 1");
  assert.equal(result.status, 2);
  assert.equal(result.calls, 3);
  assert.match(result.stderr, /could not run\/parse/);
  assert.match(result.stderr, /3 attempts/);
  assert.doesNotMatch(result.stdout, /Dependency audit passed/);
});

test('a hanging npm is killed at the time bound rather than holding the build', () => {
  const started = Date.now();
  // `exec` keeps the shim's own PID on the sleeping process, so the liveness
  // check below is a check of the process the gate was supposed to kill.
  const result = runWithShim('printf %s "$$" > "$shim_dir/pid"\nexec sleep 30',
    { SECURITY_AUDIT_TIMEOUT_MS: '400' });
  assert.equal(result.signal ?? null, null, 'the gate itself must exit, not be killed by the harness');
  assert.equal(result.status, 2);
  assert.equal(result.calls, 3);
  assert.match(result.stderr, /did not answer within 400ms/);
  assert.match(result.stderr, /3 attempts/);
  assert.ok(Date.now() - started < 20_000, 'three bounded attempts must not take the old seven minutes');

  /*
   * AND NOTHING IS LEFT BEHIND. The first bounded run in CI killed the shell
   * `execSync` had put in front of npm, and the runner's post-job cleanup then
   * found two orphaned `npm audit` processes — the kill has to land on the
   * process doing the work, not on a wrapper around it.
   */
  assert.ok(result.shimPid, 'the shim recorded its pid');
  const deadline = Date.now() + 2_000;
  for (;;) {
    let alive = true;
    try { process.kill(result.shimPid, 0); } catch { alive = false; }
    if (!alive) break;
    assert.ok(Date.now() < deadline, `pid ${result.shimPid} outlived the gate: the kill hit a wrapper, not npm`);
  }
});
