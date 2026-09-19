import { readFileSync } from 'node:fs';
const paths = {
  ingest:'supabase/functions/market-updates-ingest/index.ts',
  digest:'supabase/functions/market-updates-digest/index.ts',
  qa:'supabase/functions/market-updates-qa/index.ts',
  router:'supabase/functions/_shared/llmRouter.ts',
  migration:'supabase/migrations/20260726170000_market_updates_central_llm_router.sql',
};
const files = Object.fromEntries(Object.entries(paths).map(([key,path]) => [key,readFileSync(path,'utf8')]));
const fail = message => { throw new Error(`Market Updates LLM router validation failed: ${message}`); };
const requireText = (text, token, context) => { if (!text.includes(token)) fail(`${context} missing ${token}`); };
for (const name of ['ingest','digest','qa']) {
  requireText(files[name], 'callLLM({', name);
  if (files[name].includes('ai.gateway.lovable.dev') || files[name].includes('LOVABLE_API_KEY')) fail(`${name} still has an independent Lovable provider call`);
}
for (const [name,key] of [['ingest','market_updates_classifier'],['digest','market_updates_digest'],['qa','market_updates_qa_fast'],['qa','market_updates_qa_deep']]) requireText(files[name], key, `${name} assignment`);
for (const field of ['model_used','route_used','provider_attempts','fallback_used','ai_latency_ms','ai_failure_reason']) requireText(files.migration,`add column if not exists ${field}`,'telemetry migration');
for (const field of ['is_active','last_tested_at','last_test_success','last_test_result']) requireText(files.migration,`add column if not exists ${field}`,'assignment lifecycle');
requireText(files.migration,'on conflict (agent_key) do nothing','administrator assignment preservation');
requireText(files.migration,"where route = 'openrouter'",'existing OpenRouter preference');
requireText(files.ingest,'provider_readiness','classifier readiness gate');
for (const event of ["sseEvent('start'","sseEvent('delta'","sseEvent('metadata'","sseEvent('done'"]) requireText(files.qa,event,'Q&A SSE completion');
for (const token of ['RETRYABLE_STATUSES','NON_RETRYABLE_STATUSES','deadlineAt','timeoutMs','attempts']) requireText(files.router,token,'shared router fallback contract');
for (const token of ["requested?.is_active === false", "Assignment '${agentKey}' is disabled", 'fallback?.is_active === false', 'Default assignment is disabled']) {
  requireText(files.router,token,'disabled assignment fail-closed contract');
}
if (files.router.includes("find((r) => r.agent_key === agentKey && r.is_active !== false)")) fail('inactive requested assignments are still treated as missing');
console.log('Validated four Market agent assignments, central routing, telemetry, fallback controls, readiness gate, and SSE completion.');
