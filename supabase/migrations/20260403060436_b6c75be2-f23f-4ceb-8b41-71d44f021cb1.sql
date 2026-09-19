
-- Create trigger function for inbound conversation message notifications
CREATE OR REPLACE FUNCTION public.notify_conversation_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_client_id uuid;
  v_channel_type text;
  v_client_name text;
  v_channel_label text;
  v_preview text;
BEGIN
  -- Only fire for inbound messages
  IF NEW.direction <> 'inbound' THEN
    RETURN NEW;
  END IF;

  -- Look up the conversation to get client_id and channel
  SELECT gc.client_id, gc.channel_type
  INTO v_client_id, v_channel_type
  FROM public.ghl_conversations gc
  WHERE gc.id = NEW.conversation_id;

  IF v_client_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get client name
  SELECT COALESCE(c.primary_first_name || ' ' || c.primary_surname, 'Unknown')
  INTO v_client_name
  FROM public.clients c
  WHERE c.id = v_client_id;

  IF v_client_name IS NULL THEN
    v_client_name := 'Unknown Contact';
  END IF;

  -- Normalize channel label
  v_channel_label := UPPER(COALESCE(v_channel_type, 'sms'));

  -- Build preview (truncated)
  v_preview := LEFT(COALESCE(NEW.body, '(Attachment)'), 100);

  -- Insert notification
  INSERT INTO public.notifications (type, title, message, entity_id, read)
  VALUES (
    'conversation_reply',
    'New ' || v_channel_label || ' from ' || v_client_name,
    v_preview,
    v_client_id::text,
    false
  );

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS on_inbound_conversation_message ON public.ghl_conversation_messages;
CREATE TRIGGER on_inbound_conversation_message
  AFTER INSERT ON public.ghl_conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_conversation_reply();

-- Add ghl_conversations and ghl_conversation_messages to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.ghl_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ghl_conversation_messages;
