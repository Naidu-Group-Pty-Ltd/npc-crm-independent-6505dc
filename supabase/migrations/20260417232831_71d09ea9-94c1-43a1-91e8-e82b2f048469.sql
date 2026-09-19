INSERT INTO public.agent_model_assignments (agent_key, agent_label, agent_category, agent_description, route, model_id, fallback_chain, temperature, max_tokens)
VALUES (
  'vapi_call_analysis',
  'Vapi Call Analysis',
  'voice_intelligence',
  'Post-call transcript analysis: sentiment, root cause, escalation severity, recovery priority, and AI recommendations for Vapi call logs.',
  'gateway',
  'google/gemini-3-flash-preview',
  '["openai/gpt-5-mini", "openai/gpt-4o-mini"]'::jsonb,
  0.3,
  800
)
ON CONFLICT (agent_key) DO NOTHING;