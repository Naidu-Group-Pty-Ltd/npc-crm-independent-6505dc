-- Update existing inbound squad call logs with correct assistants based on call intent
-- Fix capitalization and show only relevant agents (frontdesk + specific booking agent)

-- Update calls with discovery_booking intent
UPDATE public.vapi_call_logs 
SET 
  agent_name = 'NPC Inbound Agent',
  assistants_involved = '[{"id":"npc-inbound-agent","name":"NPC Inbound Agent","role":"receptionist"},{"id":"discovery-booking-agent","name":"Discovery Booking Agent","role":"booking"}]'::jsonb,
  handoff_sequence = '[{"fromAssistant":"npc-inbound-agent","toAssistant":"discovery-booking-agent","timestamp":"2025-12-16T09:30:00.000Z","reason":"Call transferred based on intent: discovery booking"}]'::jsonb
WHERE is_squad_call = true AND squad_name = 'Inbound Reception Squad' AND call_intent = 'discovery_booking';

-- Update calls with strategy_booking intent  
UPDATE public.vapi_call_logs 
SET 
  agent_name = 'NPC Inbound Agent',
  assistants_involved = '[{"id":"npc-inbound-agent","name":"NPC Inbound Agent","role":"receptionist"},{"id":"strategy-booking-agent","name":"Strategy Session Agent","role":"booking"}]'::jsonb,
  handoff_sequence = '[{"fromAssistant":"npc-inbound-agent","toAssistant":"strategy-booking-agent","timestamp":"2025-12-16T09:30:00.000Z","reason":"Call transferred based on intent: strategy booking"}]'::jsonb
WHERE is_squad_call = true AND squad_name = 'Inbound Reception Squad' AND call_intent = 'strategy_booking';

-- Update calls with finance_consult intent
UPDATE public.vapi_call_logs 
SET 
  agent_name = 'NPC Inbound Agent',
  assistants_involved = '[{"id":"npc-inbound-agent","name":"NPC Inbound Agent","role":"receptionist"},{"id":"finance-consult-agent","name":"Finance Consult Agent","role":"booking"}]'::jsonb,
  handoff_sequence = '[{"fromAssistant":"npc-inbound-agent","toAssistant":"finance-consult-agent","timestamp":"2025-12-16T09:30:00.000Z","reason":"Call transferred based on intent: finance consult"}]'::jsonb
WHERE is_squad_call = true AND squad_name = 'Inbound Reception Squad' AND call_intent = 'finance_consult';

-- Update calls with no recognized intent (just show frontdesk agent)
UPDATE public.vapi_call_logs 
SET 
  agent_name = 'NPC Inbound Agent',
  assistants_involved = '[{"id":"npc-inbound-agent","name":"NPC Inbound Agent","role":"receptionist"}]'::jsonb,
  handoff_sequence = '[]'::jsonb
WHERE is_squad_call = true AND squad_name = 'Inbound Reception Squad' 
  AND (call_intent IS NULL OR call_intent NOT IN ('discovery_booking', 'strategy_booking', 'finance_consult'));