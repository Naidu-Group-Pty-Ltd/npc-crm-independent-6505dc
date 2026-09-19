import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { consumeRateLimit, enforceBase64Limit, enforceJsonBodyLimit, enforceRawBodyLimit, getTrustedClientIp, securityJsonError, verifyRequiredCronSecret, verifyRequiredWebhookSecret, verifySignedInternal } from '../requestSecurity.ts';
import { signInternalRequest } from '../auth_v2.ts';
import { getClientIp } from '../publicAbuseControls.ts';

Deno.test('shared request security exports human authentication for edge handlers', () => {
  assertEquals(typeof verifyHuman, 'function');
});

Deno.test('request limits reject oversized JSON before parsing', async () => {
  const req = new Request('https://example.test', { method: 'POST', headers: { 'content-length': '1000' }, body: '{"ok":true}' });
  const result = await enforceJsonBodyLimit(req, 32);
  assert(!result.ok); assertEquals(result.error.status, 413);
});

Deno.test('raw request limits stop streaming bodies without a content length', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(20)); },
    cancel() { cancelled = true; },
  });
  const req = new Request('https://example.test', { method: 'POST', body });
  const result = await enforceRawBodyLimit(req, 32);
  assert(!result.ok); assertEquals(result.error.status, 413); assert(cancelled);
});

Deno.test('raw request limits preserve accepted UTF-8 bodies for signature checks', async () => {
  const raw = JSON.stringify({ source: 'crøn' });
  const req = new Request('https://example.test', { method: 'POST', body: raw });
  assertEquals(await enforceRawBodyLimit(req, 64), { ok: true, raw });
});

Deno.test('base64 limits reject malformed and decoded oversize data', () => {
  assert(!enforceBase64Limit('@@@@', 100, 100).ok);
  assert(!enforceBase64Limit('QUFBQQ==', 100, 3).ok);
  const accepted = enforceBase64Limit('QUFB', 100, 3);
  assert(accepted.ok); assertEquals(accepted.decodedBytes, 3);
});

Deno.test('trusted client IP ignores caller-controlled forwarded chains', () => {
  assertEquals(getTrustedClientIp(new Headers({ 'x-forwarded-for': '198.51.100.10' })), null);
  assertEquals(getTrustedClientIp(new Headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' })), '203.0.113.7');
  assertEquals(getTrustedClientIp(new Headers({ 'cf-connecting-ip': '203.0.113.7, 1.2.3.4' })), null);
});

Deno.test('public abuse controls use only validated trusted client IP headers', () => {
  assertEquals(getClientIp(new Request('https://example.test', { headers: { 'x-forwarded-for': '198.51.100.10' } })), null);
  assertEquals(getClientIp(new Request('https://example.test', { headers: { 'cf-connecting-ip': 'not-an-ip' } })), null);
  assertEquals(getClientIp(new Request('https://example.test', { headers: { 'x-real-ip': '2001:DB8::1' } })), '2001:db8::1');
});

Deno.test('webhook and cron secrets fail closed when weak or missing', () => {
  assert(!verifyRequiredWebhookSecret(undefined, 'x'.repeat(32)));
  assert(!verifyRequiredWebhookSecret('short', 'short'));
  assert(!verifyRequiredCronSecret('x'.repeat(16), 'wrong'));
  assert(verifyRequiredCronSecret('x'.repeat(16), 'x'.repeat(16)));
});

Deno.test('signed internal requests bind method, body and approved caller', async () => {
  Deno.env.set('INTERNAL_EDGE_SECRET', 'a'.repeat(32));
  const body = JSON.stringify({ action: 'run' });
  const headers = await signInternalRequest('POST', '/functions/v1/receiver', body, 'approved-worker');
  const nonceStore = new Set<string>();
  const supabase = { from: () => ({ insert: ({ nonce }: { nonce: string }) => ({ error: nonceStore.has(nonce) ? { code: '23505' } : (nonceStore.add(nonce), null) }) }) };
  const req = new Request('https://example.test/functions/v1/receiver', { method: 'POST', headers, body });
  assert((await verifySignedInternal(supabase, req, body, ['approved-worker'])).ok);
  assert(!(await verifySignedInternal(supabase, req, body, ['approved-worker'])).ok, 'replayed nonce must fail');
  const unapprovedHeaders = await signInternalRequest('POST', '/functions/v1/receiver', body, 'other-worker');
  const unapprovedReq = new Request('https://example.test/functions/v1/receiver', { method: 'POST', headers: unapprovedHeaders, body });
  assert(!(await verifySignedInternal(supabase, unapprovedReq, body, ['approved-worker'])).ok);
});

Deno.test('security errors are generic and carry a correlation ID', async () => {
  const response = securityJsonError(503, 'rate_limit_unavailable', 'test-correlation');
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: 'Service unavailable', code: 'rate_limit_unavailable', correlation_id: 'test-correlation' });
});

Deno.test('signed internal verification rejects a changed body and stale timestamp', async () => {
  Deno.env.set('INTERNAL_EDGE_SECRET', 'b'.repeat(32));
  const body = '{"ok":true}';
  const headers = await signInternalRequest('POST', '/functions/v1/receiver', body, 'worker');
  const supabase = { from: () => ({ insert: () => ({ error: null }) }) };
  const changedBody = new Request('https://example.test/functions/v1/receiver', { method: 'POST', headers, body: '{"ok":false}' });
  assert(!(await verifySignedInternal(supabase, changedBody, '{"ok":false}', ['worker'])).ok);
  const stale = new Headers(headers); stale.set('X-Internal-Timestamp', '1');
  const staleRequest = new Request('https://example.test/functions/v1/receiver', { method: 'POST', headers: stale, body });
  assert(!(await verifySignedInternal(supabase, staleRequest, body, ['worker'])).ok);
});

Deno.test('rate limit helper consumes the atomic RPC result and rejects unsafe keys', async () => {
  let call: unknown;
  const supabase = { rpc: (name: string, args: unknown) => { call = { name, args }; return Promise.resolve({ data: [{ allowed: false, count: 3, remaining: 0, retry_after_seconds: 42 }], error: null }); } };
  assertEquals(await consumeRateLimit(supabase, 'user:abc', 2, 60), { allowed: false, count: 3, remaining: 0, retryAfterSeconds: 42 });
  assertEquals(call, { name: 'security_consume_rate_limit', args: { p_key: 'user:abc', p_max: 2, p_window_seconds: 60 } });
  await Promise.all(Array.from({ length: 3 }, () => consumeRateLimit(supabase, 'user:abc', 2, 60)));
  await Promise.resolve();
  try { await consumeRateLimit(supabase, 'bad key', 2, 60); throw new Error('unsafe key accepted'); } catch (error) { assert(String(error).includes('Invalid rate limit parameters')); }
});
