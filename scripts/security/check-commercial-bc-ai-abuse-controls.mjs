import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../supabase/functions/commercial-bc-scenario-agent/index.ts', import.meta.url), 'utf8');

for (const required of [
  'enforceJsonBodyLimit<RequestBody>(req, MAX_REQUEST_BYTES)',
  'prompt.length > MAX_PROMPT_CHARS',
  'body.history.length > MAX_HISTORY_TURNS',
  'turn.content.length > MAX_TURN_CHARS',
  'snapshotJson.length > MAX_SNAPSHOT_CHARS',
  'consumeRateLimit(supabase, `commercial-bc-ai:user:${userId}:minute`',
  'consumeRateLimit(supabase, `commercial-bc-ai:user:${userId}:day`',
  'signal: controller.signal',
  "error.name === 'AbortError'",
  'max_tokens: AI_MAX_TOKENS',
  'logApiUsage(supabase',
]) assert.ok(source.includes(required), `missing AI abuse control: ${required}`);

assert.doesNotMatch(source, /const body: RequestBody = await req\.json\(\)/, 'request body must be bounded before JSON parsing');
assert.match(source, /catch \(error\) \{[\s\S]*?rate limit unavailable[\s\S]*?jsonError\(corsHeaders, 503/, 'rate limiter must fail closed');

console.log('Commercial BC AI request budgets, persistent quotas, timeout, output cap, and usage logging are enforced.');
