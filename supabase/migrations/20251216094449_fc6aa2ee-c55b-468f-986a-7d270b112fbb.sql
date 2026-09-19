-- Update existing inbound squad call logs with correct primary agent and assistants
UPDATE public.vapi_call_logs 
SET 
  agent_name = 'NPC inbound agent',
  assistants_involved = '[{"id":"npc-inbound-agent","name":"NPC inbound agent","role":"receptionist"},{"id":"discovery-booking-agent","name":"Discovery Booking Agent","role":"booking"},{"id":"strategy-booking-agent","name":"Strategy Session Agent","role":"booking"},{"id":"finance-consult-agent","name":"Finance Consult Agent","role":"booking"}]'::jsonb
WHERE is_squad_call = true AND squad_name = 'Inbound Reception Squad' AND (agent_name IS NULL OR assistants_involved = '[]'::jsonb);