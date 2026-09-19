import { readFileSync } from 'node:fs';
const source = readFileSync('supabase/functions/market-updates-digest/index.ts', 'utf8');
const failures = [];
for (const required of [
  "requireModulePermission(sb, { userId: auth.userId, authMethod: auth.authMethod }, 'market_updates', 'can_edit')",
  'consumeRateLimit(sb, `market-digest:user:${interactiveUserId}`',
  "consumeRateLimit(sb, 'market-digest:global'",
  // The idempotency key is (period, period_key); it was (period, period_start)
  // when this gate was written. And the early return is now conditional on the
  // window actually being COMPLETE: a digest left `queued`/`failed`/`no_data`
  // is re-attempted instead of being treated as a finished window forever,
  // which is why `if (existingDigest) return json` no longer appears verbatim.
  // Both needles still pin the same property — one authoritative row per
  // window, resolved before any provider spend.
  ".eq('period', period).eq('period_key', periodKey).maybeSingle()",
  "if (existingDigest && existingDigest.status === 'published') return json",
]) if (!source.includes(required)) failures.push(`missing digest control: ${required}`);
const provider = source.indexOf('await synthesizeWithAI(period');
const idempotency = source.indexOf("if (existingDigest && existingDigest.status === 'published') return json");
if (idempotency < 0 || provider < 0 || idempotency > provider) failures.push('idempotency check does not precede provider call');
if (failures.length) { console.error(`Market digest authorization FAILED:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('Market digest authorization check passed.');
