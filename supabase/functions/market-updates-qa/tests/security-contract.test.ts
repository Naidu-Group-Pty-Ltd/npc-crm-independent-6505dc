import { assert, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
const qa = await Deno.readTextFile(new URL('../index.ts', import.meta.url));
const voice = await Deno.readTextFile(new URL('../../market-updates-voice-transcribe/index.ts', import.meta.url));
Deno.test('Market AI endpoints enforce verified identity before provider access', () => {
  assertStringIncludes(qa, 'requireHumanOrSignedInternal');
  assertStringIncludes(voice, 'verifyHuman');
  for (const source of [qa, voice]) {
    assertStringIncludes(source, 'requireModulePermission');
    assertStringIncludes(source, 'consumeRateLimit');
  }
});
Deno.test('scheduled Market Q&A callers use signed internal invocation with a target user', async () => {
  const subscriptions = await Deno.readTextFile(new URL('../../market-qa-subscriptions/index.ts', import.meta.url));
  const digestRunner = await Deno.readTextFile(new URL('../../market-qa-digest-runner/index.ts', import.meta.url));
  for (const source of [subscriptions, digestRunner]) {
    assertStringIncludes(source, "callInternalFunction('market-updates-qa'");
    assertStringIncludes(source, "internal_action: 'scheduled_qa'");
    assertStringIncludes(source, 'target_user_id');
    assert(!source.includes("x-internal-edge-secret': Deno.env.get('INTERNAL_EDGE_SECRET')"));
  }
  assertStringIncludes(qa, "['market-qa-subscriptions', 'market-qa-digest-runner']");
  assertStringIncludes(qa, "parsed.value?.internal_action !== 'scheduled_qa'");
});
Deno.test('Market AI endpoints keep provider failures generic and bound input', () => {
  assertStringIncludes(voice, 'enforceBase64Limit'); assertStringIncludes(voice, 'transcription_unavailable');
  assertStringIncludes(qa, 'enforceJsonBodyLimit');
  assertStringIncludes(qa, "'market_updates_qa_fast'");
  assertStringIncludes(qa, "'market_updates_qa_deep'");
  assertStringIncludes(qa, 'callLLM({');
  assert(!qa.includes('ai.gateway.lovable.dev'));
  assert(!qa.includes('anonymous callers still get an answer'));
  assert(!voice.includes('details: lastDetails'));
});
Deno.test('Market Q&A keeps retrieval grounded and authenticated-origin safe', () => {
  assertStringIncludes(qa, 'createCorsHeaders');
  assertStringIncludes(qa, 'enforceCsrf');
  assert(!qa.includes("'Access-Control-Allow-Origin': '*'"));
  assertStringIncludes(qa, ".eq('status','published')");
  assertStringIncludes(qa, "code:'retrieval_failed'");
  assertStringIncludes(qa, 'contextIds.has(k.source_id!)');
  assertStringIncludes(qa, 'The generated answer could not be validated against the retrieved source records.');
});
