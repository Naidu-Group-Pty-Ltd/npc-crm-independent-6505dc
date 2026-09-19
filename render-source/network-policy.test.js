const test = require('node:test');
const assert = require('node:assert/strict');
const { assertPublicUrl, installNetworkPolicy, isPrivateAddress } = require('./network-policy');

test('recognises private and reserved IP address ranges', () => {
  for (const address of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '172.20.0.1', '192.168.1.1', '::1', '::ffff:7f00:1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('93.184.216.34'), false);
  assert.equal(isPrivateAddress('2606:2800:220:1:248:1893:25c8:1946'), false);
});

test('rejects a public hostname when DNS resolves it to a private address', async () => {
  const lookup = async () => [{ address: '169.254.169.254', family: 4 }];
  await assert.rejects(assertPublicUrl('https://attacker.example/redirect', lookup), /private\/reserved/);
});

test('intercepts redirects and subresources and aborts private destinations', async () => {
  let handler;
  const page = { route: async (_pattern, callback) => { handler = callback; } };
  await installNetworkPolicy(page);

  const invoke = async (url) => {
    let action;
    await handler({
      request: () => ({ url: () => url }),
      continue: () => { action = 'continue'; },
      abort: () => { action = 'abort'; },
    });
    return action;
  };

  assert.equal(await invoke('http://127.0.0.1/redirect-target'), 'abort');
  assert.equal(await invoke('http://169.254.169.254/latest/meta-data'), 'abort');
  assert.equal(await invoke('data:text/plain,safe'), 'continue');
});

test('allows only the renderer static origin for zip renders', async () => {
  let handler;
  const page = { route: async (_pattern, callback) => { handler = callback; } };
  await installNetworkPolicy(page, { localOrigin: 'http://127.0.0.1:8080' });
  const action = async (url) => {
    let result;
    await handler({ request: () => ({ url: () => url }), continue: () => { result = 'continue'; }, abort: () => { result = 'abort'; } });
    return result;
  };
  assert.equal(await action('http://127.0.0.1:8080/__build/id/app.js'), 'continue');
  assert.equal(await action('http://127.0.0.1:9000/secret'), 'abort');
});
