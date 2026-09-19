-- Seed the model assignment for template reconstruction (plan WS2).
--
-- Policy (locked): Claude-primary on the latest model, with the existing
-- Gemini/GPT gateway models retained as a resilience fallback chain.
--
-- Note: `template-design-agent` currently calls Claude DIRECTLY via
-- `_shared/claudeReconstruct.ts` (the router's native Anthropic path does not do
-- tool-calling). This row documents the policy and makes the model swappable from
-- the admin model-assignment UI; it becomes load-bearing once reconstruction is
-- routed through `callLLM`. Idempotent so re-running is safe.

insert into public.agent_model_assignments
  (agent_key, agent_label, agent_category, agent_description,
   route, model_id, fallback_chain, temperature, max_tokens, reasoning_effort, is_locked)
values
  ('template_reconstruct_agent',
   'Template Reconstruction',
   'template',
   'Reconstructs PDFs / images / code into editable templates (Claude-primary; native vision + PDF, strict tool output).',
   'native',
   'claude-opus-4-8',
   '[{"route":"gateway","model_id":"google/gemini-3-pro-preview"},{"route":"gateway","model_id":"openai/gpt-5"}]'::jsonb,
   null,
   8192,
   'high',
   false)
on conflict (agent_key) do update set
  agent_label       = excluded.agent_label,
  agent_category    = excluded.agent_category,
  agent_description = excluded.agent_description,
  route             = excluded.route,
  model_id          = excluded.model_id,
  fallback_chain    = excluded.fallback_chain,
  max_tokens        = excluded.max_tokens,
  reasoning_effort  = excluded.reasoning_effort,
  updated_at        = now();
