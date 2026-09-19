const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const AdmZip = require('adm-zip');

test('uploaded package scripts are never executed', async (t) => {
  const marker = path.join(os.tmpdir(), `render-source-marker-${process.pid}`);
  const token = 'security-test-token';
  const port = 18000 + (process.pid % 1000);
  const zip = new AdmZip();
  zip.addFile('package.json', Buffer.from(JSON.stringify({
    scripts: { preinstall: `node -e "require('fs').writeFileSync('${marker}', 'executed')"` },
  })));

  fs.rmSync(marker, { force: true });
  const server = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      RENDER_SOURCE_TOKEN: token,
      RENDER_SOURCE_ALLOW_BUILD: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    server.kill();
    fs.rmSync(marker, { force: true });
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server did not start')), 5000);
    server.once('exit', (code) => reject(new Error(`server exited with ${code}`)));
    server.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('render-source listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  const response = await fetch(`http://127.0.0.1:${port}/render`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zipBase64: zip.toBuffer().toString('base64') }),
  });
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.match(body.error, /only static\/exported project zips are supported/);
  assert.equal(fs.existsSync(marker), false);
});
