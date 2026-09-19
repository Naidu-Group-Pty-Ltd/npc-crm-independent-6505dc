import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const harness = fileURLToPath(new URL('./wp15-negative-tests.mjs', import.meta.url));

async function runHarness(adminError) {
  const outputDir = await mkdtemp(join(tmpdir(), 'wp15-negative-tests-'));
  const server = createServer((req, res) => {
    const isAdminTest = req.url?.endsWith('/admin-user-management');
    res.writeHead(isAdminTest ? 403 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: isAdminTest ? adminError : 'Expected test denial' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [harness], {
        env: {
          ...process.env,
          SUPABASE_URL: `http://127.0.0.1:${port}`,
          SUPABASE_ANON_KEY: 'test-anon-key',
          NON_SUPERADMIN_JWT: 'test-token',
          OUTPUT_DIR: outputDir,
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    const evidence = await readFile(join(outputDir, 'negative-tests.jsonl'), 'utf8');
    return { ...result, evidence };
  } finally {
    server.close();
    await rm(outputDir, { recursive: true, force: true });
  }
}

test('NT-11 accepts an authenticated non-superadmin authorization denial', async () => {
  const result = await runHarness('Unauthorized: Superadmin access required');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.evidence, /"id":"NT-11".*"result":"expected_denial"/);
});

test('NT-11 rejects a generic authentication denial with the same status', async () => {
  const result = await runHarness('Authentication required');
  assert.equal(result.code, 1);
  assert.match(result.evidence, /"id":"NT-11".*"observedError":"Authentication required".*"result":"FAIL"/);
});
